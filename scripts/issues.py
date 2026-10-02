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
    "Mots-clés": "mots_cles", "Statut": "statut", "Objectif de position": "objectif", "Pays suivis": "pays",
    "Pages à vérifier": "pages",
}
STATUTS = {"à travailler": "à travailler", "en cours": "en cours", "acquis": "acquis"}


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
        # Garde-fou : la date doit tomber dans l'historique de la Search Console (16 mois) et pas dans le futur
        today = date.today()
        if dt > today:
            fail(f"La date {dt} est dans le futur. Indique la date réelle de mise en ligne (AAAA-MM-JJ).")
        if (today - dt).days > 480:
            fail(f"La date {dt} est trop ancienne : la Search Console ne garde que 16 mois, l'effet ne pourrait pas être mesuré. Vérifie l'année.")
        page = d.get("page", "").strip()
        if not page.startswith("http"):
            fail("La page doit être une URL complète (https://…).")
        kpath = CONF / "keywords" / f"{s}.yaml"
        tracked = (yaml.safe_load(kpath.read_text(encoding="utf-8")) or {}).get("keywords") or [] if kpath.exists() else []
        measurable = any((k.get("page") or "").rstrip("/") == page.rstrip("/") for k in tracked)
        lines = [f"  - date: {dt}", f"    page: {page}", f"    type: {d.get('type') or 'autre'}", f"    title: {q(d.get('titre', '').strip())}"]
        if d.get("description"):
            lines.append(f"    description: {q(d['description'])}")
        lines.append(f"    author: {q(d.get('auteur') or author)}")
        append_item(CONF / "actions" / f"{s}.yaml", "actions", lines)
        warn = "" if measurable else " Attention : aucun mot-clé suivi n'a cette page comme page suivie, l'effet ne sera pas mesuré tant qu'un mot-clé n'y est pas rattaché."
        print(f"RESULT=Action ajoutée au journal de {s} ({dt}, {page}). L'effet sera mesuré dès 7 jours de recul.{warn}")
        print(f"SITE={s}\nKIND=action")

    elif "mot-cle" in labels:
        s = d.get("projet", "").strip().lower()
        if s not in sites():
            fail(f"Projet « {s} » inconnu. Projets existants : {', '.join(sites())}.")
        # Un mot-clé par ligne, « mot-clé | URL » pour fixer la page (ancien formulaire : champ « Mot-clé » unique)
        raw = d.get("mots_cles") or d.get("mot_cle") or ""
        default_page = d.get("page", "").strip()
        items = []
        for line in raw.splitlines():
            line = line.strip().strip("`").strip()
            if not line:
                continue
            kw, _, pg = line.partition("|")
            kw, pg = kw.strip().lower(), (pg.strip() or default_page)
            if kw:
                items.append((kw, pg))
        if not items:
            fail("Aucun mot-clé saisi.")
        bad = [pg for _, pg in items if pg and not pg.startswith("http")]
        if bad:
            fail(f"La page doit être une URL complète (https://…) : {bad[0]}")
        statut = STATUTS.get(d.get("statut", "").strip().lower())
        objectif = d.get("objectif", "").strip().replace(",", ".")
        if objectif:
            try:
                objectif = float(objectif)
                objectif = int(objectif) if objectif.is_integer() else objectif
                assert 1 <= objectif <= 100
            except (ValueError, AssertionError):
                fail("Objectif de position invalide : un nombre entre 1 et 100 (ex. 3).")
        path = CONF / "keywords" / f"{s}.yaml"
        existing = (yaml.safe_load(path.read_text(encoding="utf-8")) or {}).get("keywords") or [] if path.exists() else []
        known = {(str(k["keyword"]), k.get("page") or "") for k in existing}
        split = lambda v: [x.strip() for x in (v or "").split(",") if x.strip()]
        added, skipped, lines = [], [], []
        for kw, pg in items:
            if (kw, pg) in known:
                skipped.append(kw)
                continue
            known.add((kw, pg))
            lines.append(f"  - keyword: {q(kw)}")
            if pg:
                lines.append(f"    page: {pg}")
            if len(items) == 1 and split(d.get("variantes")):
                lines.append(f"    variants: [{', '.join(q(x.lower()) for x in split(d['variantes']))}]")
            if split(d.get("tags")):
                lines.append(f"    tags: [{', '.join(q(x) for x in split(d['tags']))}]")
            if statut:
                lines.append(f"    status: {statut}")
            if objectif:
                lines.append(f"    target: {objectif}")
            if d.get("note"):
                lines.append(f"    note: {q(d['note'])}")
            added.append(kw)
        if not added:
            fail(f"Déjà suivi{'s' if len(skipped) > 1 else ''} sur cette page : {', '.join(skipped)}.")
        append_item(path, "keywords", lines)
        msg = f"{len(added)} mot{'s' if len(added) > 1 else ''}-clé{'s' if len(added) > 1 else ''} ajouté{'s' if len(added) > 1 else ''} au suivi de {s} : {', '.join(added[:20])}{'…' if len(added) > 20 else ''}."
        if skipped:
            msg += f" Déjà suivi{'s' if len(skipped) > 1 else ''} : {', '.join(skipped)}."
        print(f"RESULT={msg} Les 16 mois d'historique arrivent avec la synchro qui vient d'être lancée.")
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
        pays = [x.strip().lower() for x in re.split(r"[,\s]+", d.get("pays", "")) if x.strip()]
        if any(not re.fullmatch(r"[a-z]{3}", x) for x in pays):
            fail("Pays invalides : codes à 3 lettres séparés par des virgules (ex. fra, bel).")
        lines = [f"  - name: {name}", f"    label: {q(d.get('label') or name)}", f"    property: {prop}",
                 f"    account: {d.get('compte') or 'default'}", f"    owner: {q(d.get('referent') or author)}",
                 f"    brand_regex: {q(d.get('marque', ''))}"]
        if pays:
            lines.append(f"    countries: [{', '.join(pays)}]")
        append_item(CONF / "sites.yaml", "sites", lines)
        (CONF / "actions" / f"{name}.yaml").write_text("# Journal des actions SEO (voir config/actions/celio.yaml pour les champs).\n\nactions: []\n", encoding="utf-8")
        print(f"RESULT=Projet « {name} » créé. Les 20 premiers mots-clés hors marque sont pré-remplis et l'historique arrive avec la synchro.")
        print(f"SITE={name}\nKIND=projet")
    elif "inspection" in labels:
        s = d.get("projet", "").strip().lower()
        if s not in sites():
            fail(f"Projet « {s} » inconnu. Projets existants : {', '.join(sites())}.")
        pages = [l.strip() for l in d.get("pages", "").splitlines() if l.strip()]
        bad = [u for u in pages if not u.startswith("http")]
        if bad:
            fail(f"Chaque ligne doit être une URL complète (https://…) : {bad[0]}")
        Path("pages.txt").write_text("\n".join(pages), encoding="utf-8")
        print(f"RESULT=Vérification lancée sur {len(pages) if pages else 'toutes les'} page{'s' if len(pages) != 1 else ''} suivie{'s' if len(pages) != 1 else ''} de {s}.")
        print(f"SITE={s}\nKIND=inspection")
    else:
        fail("Issue sans label reconnu (action, mot-cle, projet, inspection).")


if __name__ == "__main__":
    main()
