"""Transforme une issue GitHub (formulaires action / mot-cle / projet) en modification de la config.

Lancé par .github/workflows/issues.yml. Lit l'événement dans GITHUB_EVENT_PATH, écrit dans config/,
puis imprime sur la sortie standard deux lignes lues par le workflow :
  RESULT=<message à poster en commentaire>
  SITE=<projet concerné>          KIND=<action|mot-cle|projet>
Sort en erreur (code 1) avec RESULT=… si le formulaire est invalide.
"""

import json
import os
import re
import sys
from datetime import date
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
CONF = ROOT / "config"

LABELS = {
    "Projet": "projet", "Date de mise en ligne": "date", "Page concernée": "page", "Type d'action": "type",
    "Intitulé": "titre", "Détail": "description", "Consultant": "auteur", "Mot-clé": "mot_cle", "Page suivie": "page",
    "Variantes": "variantes", "Tags": "tags", "Note": "note", "Identifiant": "nom", "Nom affiché": "label",
    "Propriété GSC": "propriete", "Compte Google connecté": "compte", "Consultant référent": "referent", "Regex de marque": "marque",
}


def parse(body):
    out, cur = {}, None
    for line in (body or "").splitlines():
        m = re.match(r"^###\s+(.*)$", line)
        if m:
            cur = LABELS.get(m.group(1).strip())
            if cur:
                out[cur] = []
            continue
        if cur:
            out[cur].append(line)
    res = {}
    for k, v in out.items():
        txt = "\n".join(v).strip()
        res[k] = "" if txt == "_No response_" else txt
    return res


def q(s):
    return json.dumps(s, ensure_ascii=False)  # une chaîne JSON est une chaîne YAML valide


def fail(msg):
    print(f"RESULT={msg}")
    sys.exit(1)


def sites():
    return {s["name"]: s for s in (yaml.safe_load((CONF / "sites.yaml").read_text(encoding="utf-8")) or {}).get("sites", [])}


def append_item(path, list_key, lines):
    txt = path.read_text(encoding="utf-8") if path.exists() else f"{list_key}:\n"
    txt = re.sub(rf"^{list_key}:\s*\[\]\s*$", f"{list_key}:", txt, flags=re.M)
    if not re.search(rf"^{list_key}:", txt, flags=re.M):
        txt = txt.rstrip("\n") + f"\n\n{list_key}:\n"
    path.write_text(txt.rstrip("\n") + "\n" + "\n".join(lines) + "\n", encoding="utf-8")
    yaml.safe_load(path.read_text(encoding="utf-8"))  # vérifie que le fichier reste valide


def main():
    ev = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
    issue = ev["issue"]
    labels = {l["name"] for l in issue.get("labels", [])}
    d = parse(issue.get("body"))
    author = issue["user"]["login"]

    if "action" in labels:
        s = d.get("projet", "").strip().lower()
        if s not in sites():
            fail(f"Projet « {s} » inconnu. Projets existants : {', '.join(sites())}.")
        try:
            dt = date.fromisoformat(d.get("date", "").strip())
        except ValueError:
            fail("Date invalide, format attendu AAAA-MM-JJ.")
        page = d.get("page", "").strip()
        if not page.startswith("http"):
            fail("La page doit être une URL complète (https://…).")
        lines = [f"  - date: {dt}", f"    page: {page}", f"    type: {d.get('type') or 'autre'}", f"    title: {q(d.get('titre', '').strip())}"]
        if d.get("description"):
            lines.append(f"    description: {q(d['description'])}")
        lines.append(f"    author: {q(d.get('auteur') or author)}")
        append_item(CONF / "actions" / f"{s}.yaml", "actions", lines)
        print(f"RESULT=Action ajoutée au journal de {s} ({dt}, {page}). L'impact sera calculé dès 7 jours de recul.")
        print(f"SITE={s}\nKIND=action")

    elif "mot-cle" in labels:
        s = d.get("projet", "").strip().lower()
        if s not in sites():
            fail(f"Projet « {s} » inconnu. Projets existants : {', '.join(sites())}.")
        kw = d.get("mot_cle", "").strip().lower()
        if not kw:
            fail("Mot-clé manquant.")
        path = CONF / "keywords" / f"{s}.yaml"
        existing = (yaml.safe_load(path.read_text(encoding="utf-8")) or {}).get("keywords") or [] if path.exists() else []
        page = d.get("page", "").strip()
        if any(str(k["keyword"]) == kw and (k.get("page") or "") == page for k in existing):
            fail(f"« {kw} » est déjà suivi sur cette page.")
        if page and not page.startswith("http"):
            fail("La page doit être une URL complète (https://…).")
        lines = [f"  - keyword: {q(kw)}"]
        if page:
            lines.append(f"    page: {page}")
        split = lambda v: [x.strip() for x in (v or "").split(",") if x.strip()]
        if split(d.get("variantes")):
            lines.append(f"    variants: [{', '.join(q(x.lower()) for x in split(d['variantes']))}]")
        if split(d.get("tags")):
            lines.append(f"    tags: [{', '.join(q(x) for x in split(d['tags']))}]")
        if d.get("note"):
            lines.append(f"    note: {q(d['note'])}")
        append_item(path, "keywords", lines)
        print(f"RESULT=« {kw} » ajouté au suivi de {s}. Les 16 mois d'historique arrivent avec la synchro qui vient d'être lancée.")
        print(f"SITE={s}\nKIND=mot-cle")

    elif "projet" in labels:
        name = d.get("nom", "").strip().lower()
        if not re.fullmatch(r"[a-z0-9-]+", name):
            fail("Identifiant invalide : minuscules, chiffres et tirets uniquement.")
        if name in sites():
            fail(f"Le projet « {name} » existe déjà.")
        prop = d.get("propriete", "").strip()
        if not (prop.startswith("sc-domain:") or prop.startswith("http")):
            fail("Propriété GSC invalide (sc-domain:exemple.com ou https://www.exemple.com/).")
        try:
            re.compile(d.get("marque", ""))
        except re.error:
            fail("La regex de marque est invalide.")
        lines = [f"  - name: {name}", f"    label: {q(d.get('label') or name)}", f"    property: {prop}",
                 f"    account: {d.get('compte') or 'default'}", f"    owner: {q(d.get('referent') or author)}",
                 f"    brand_regex: {q(d.get('marque', ''))}"]
        append_item(CONF / "sites.yaml", "sites", lines)
        (CONF / "actions" / f"{name}.yaml").write_text("# Journal des actions SEO (voir config/actions/celio.yaml pour les champs).\n\nactions: []\n", encoding="utf-8")
        print(f"RESULT=Projet « {name} » créé. Les 20 premiers mots-clés hors marque sont pré-remplis et l'historique arrive avec la synchro.")
        print(f"SITE={name}\nKIND=projet")
    else:
        fail("Issue sans label reconnu (action, mot-cle, projet).")


if __name__ == "__main__":
    main()
