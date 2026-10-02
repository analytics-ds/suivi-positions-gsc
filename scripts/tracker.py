"""Suivi de positions GSC datashake.

Commandes :
  python scripts/tracker.py fetch [--days 10] [--site celio]   collecte GSC + inspection d'URL + mises à jour Google
  python scripts/tracker.py build                               calculs (alertes, impact, opportunités…) et docs/data/*.json
  python scripts/tracker.py seed <site> [--n 20]                pré-remplit les mots-clés d'un nouveau projet (top hors marque)
  python scripts/tracker.py notify                              digest Slack (si SLACK_WEBHOOK_URL est défini)

Authentification OAuth (voir README) :
  GSC_CLIENT_ID + GSC_CLIENT_SECRET + GSC_REFRESH_TOKEN pour le compte « default »,
  GSC_REFRESH_TOKEN_<COMPTE> pour un autre compte déclaré dans config/sites.yaml (account: <compte>).
  En GitHub Actions, chaque secret est passé nommément dans le bloc env des workflows.
"""

import argparse
import csv
import json
import os
import re
import sys
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

import requests
import yaml

ROOT = Path(__file__).resolve().parent.parent
CONF = ROOT / "config"
DATA = ROOT / "data"
OUT = ROOT / "docs" / "data"

API = "https://searchconsole.googleapis.com/webmasters/v3/sites/{}/searchAnalytics/query"
INSPECT_API = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect"
GOOGLE_STATUS = "https://status.search.google.com/incidents.json"

FINAL_AFTER_DAYS = 3        # en dessous, la donnée GSC est provisoire et peut encore bouger
BACKFILL_DAYS = 480         # ~16 mois, le maximum conservé par la GSC
QUERY_PAGES_DAYS = 90       # historique conservé pour la détection de changement de page
SITE_LEVEL = "*"
ALL = "all"                 # marché « tous pays »
MIN_IMPR_DAY = 20           # impressions minimales d'un jour pour qu'une variation de position compte (alertes, mouvements)
LOOKBACK = 7                # sans impression le jour J, on reprend la dernière position connue dans les 7 jours

F_POS = ["date", "site", "country", "keyword", "page", "position", "clicks", "impressions", "ctr", "data_state"]
F_KW = ["date", "site", "country", "query", "position", "clicks", "impressions", "data_state"]
F_QP = ["date", "site", "country", "query", "page", "position", "clicks", "impressions"]
F_SITE = ["date", "site", "country", "segment", "position", "clicks", "impressions", "data_state"]

COUNTRIES = {"fra": "France", "bel": "Belgique", "che": "Suisse", "lux": "Luxembourg", "can": "Canada", "mco": "Monaco",
             "esp": "Espagne", "ita": "Italie", "deu": "Allemagne", "gbr": "Royaume-Uni", "usa": "États-Unis",
             "nld": "Pays-Bas", "prt": "Portugal", "aut": "Autriche", "irl": "Irlande", "pol": "Pologne", "mar": "Maroc"}
STATUSES = ("à travailler", "en cours", "acquis")


# ---------------------------------------------------------------- config & stockage

def load_yaml(p, default=None):
    if not p.exists():
        return default
    with open(p, encoding="utf-8") as f:
        return yaml.safe_load(f) or default


def load_sites():
    sites = load_yaml(CONF / "sites.yaml", {}).get("sites", [])
    for s in sites:
        s.setdefault("account", "default")
        s["keywords"] = (load_yaml(CONF / "keywords" / f"{s['name']}.yaml", {}) or {}).get("keywords") or []
        s["actions"] = (load_yaml(CONF / "actions" / f"{s['name']}.yaml", {}) or {}).get("actions") or []
        for k in s["keywords"]:
            k["keyword"] = str(k["keyword"])
            k["page"] = k.get("page") or SITE_LEVEL
            k["variants"] = [str(v) for v in (k.get("variants") or []) if v]
            k["tags"] = [str(t) for t in (k.get("tags") or [])]
            k["queries"] = [k["keyword"]] + k["variants"]
            st = str(k.get("status") or "").strip().lower()
            k["status"] = st if st in STATUSES else None
            try:
                k["target"] = float(k["target"]) if k.get("target") not in (None, "") else None
            except (TypeError, ValueError):
                k["target"] = None
    return sites


def markets(s):
    """Marchés d'un projet : « tous pays » puis les pays déclarés (code ISO 3 lettres, libellé et dossier d'URL optionnels)."""
    out = [{"code": ALL, "label": "Tous pays", "path": None}]
    for c in s.get("countries") or []:
        c = {"code": c} if isinstance(c, str) else dict(c)
        code = str(c["code"]).strip().lower()
        out.append({"code": code, "label": c.get("label") or COUNTRIES.get(code, code.upper()), "path": c.get("path") or None})
    return out


def default_market(s):
    ms = markets(s)
    return ms[1]["code"] if len(ms) > 1 else ALL


def suffix(code):
    return "" if code == ALL else "." + code


def read_csv(p):
    if not p.exists():
        return []
    with open(p, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    for r in rows:  # les lignes d'avant le découpage par pays valent « tous pays »
        if "country" in r or "site" in r:
            r["country"] = r.get("country") or ALL
    return rows


def write_csv(p, fields, rows, key):
    rows.sort(key=key)
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def read_json(p, default):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def write_json(p, obj, compact=False):
    p.parent.mkdir(parents=True, exist_ok=True)
    txt = json.dumps(obj, ensure_ascii=False, separators=(",", ":")) if compact else json.dumps(obj, ensure_ascii=False, indent=1)
    p.write_text(txt, encoding="utf-8")


# ---------------------------------------------------------------- authentification & API GSC

def secrets():
    s = dict(os.environ)
    if os.environ.get("SECRETS_JSON"):
        s.update({k: v for k, v in json.loads(os.environ["SECRETS_JSON"]).items() if v})
    return s


_tokens = {}


def token(account):
    if account in _tokens:
        return _tokens[account]
    from google.oauth2.credentials import Credentials
    import google.auth.transport.requests as gat
    s = secrets()
    suffix = "" if account == "default" else "_" + re.sub(r"\W", "_", account).upper()
    refresh = s.get("GSC_REFRESH_TOKEN" + suffix)
    if not refresh or not s.get("GSC_CLIENT_ID"):
        raise RuntimeError(f"pas de jeton OAuth pour le compte « {account} » (secret GSC_REFRESH_TOKEN{suffix})")
    c = Credentials(None, refresh_token=refresh, client_id=s["GSC_CLIENT_ID"], client_secret=s["GSC_CLIENT_SECRET"],
                    token_uri="https://oauth2.googleapis.com/token")
    c.refresh(gat.Request())
    _tokens[account] = c.token
    return c.token


def post(url, tok, body):
    for attempt in range(5):
        r = requests.post(url, json=body, headers={"Authorization": f"Bearer {tok}"}, timeout=90)
        if r.status_code in (429, 500, 503):
            time.sleep(2 ** attempt * 3)
            continue
        if r.status_code != 200:
            raise RuntimeError(f"{r.status_code} {r.text[:300]}")
        return r.json()
    raise RuntimeError(f"{r.status_code} après 5 essais")


def gsc(tok, prop, start, end, dims, filters=(), max_rows=None):
    body = {"startDate": str(start), "endDate": str(end), "type": "web", "dataState": "all", "dimensions": list(dims)}
    if filters:
        body["dimensionFilterGroups"] = [{"filters": list(filters)}]
    rows, startRow = [], 0
    while True:
        limit = 25000 if max_rows is None else min(25000, max_rows - len(rows))
        batch = post(API.format(quote(prop, safe="")), tok, {**body, "rowLimit": limit, "startRow": startRow}).get("rows", [])
        rows += batch
        if len(batch) < limit or (max_rows and len(rows) >= max_rows):
            return rows
        startRow += limit


def rx_exact(values):
    return "^(" + "|".join(re.escape(v) for v in sorted(values)) + ")$"


def f(dim, op, expr):
    return {"dimension": dim, "operator": op, "expression": expr}


def norm_url(u):
    return u.rstrip("/") if u and u != SITE_LEVEL else u


# ---------------------------------------------------------------- collecte

def fetch(days, only=None):
    sites = [s for s in load_sites() if not only or s["name"] == only]
    status = read_json(DATA / "status.json", {})
    backfilled = read_json(DATA / "backfilled.json", {})
    today = datetime.now(timezone.utc).date()
    end = today - timedelta(days=1)
    final_limit = today - timedelta(days=FINAL_AFTER_DAYS)
    state = lambda d: "final" if date.fromisoformat(d) <= final_limit else "fresh"

    for s in sites:
        name, prop = s["name"], s["property"]
        st = status.setdefault(name, {})
        st["last_run"] = datetime.now(timezone.utc).isoformat(timespec="minutes")
        try:
            tok = token(s["account"])
            kws = s["keywords"]
            queries = sorted({q for k in kws for q in k["queries"]})
            pages = sorted({k["page"] for k in kws if k["page"] != SITE_LEVEL})
            wanted = {(q, k["page"]) for k in kws if k["page"] != SITE_LEVEL for q in k["queries"]}
            brand = "(?i)(" + s.get("brand_regex", "^$") + ")"
            done = set(backfilled.get(name, []))

            # Un passage par marché : tous pays, puis chaque pays déclaré (filtre pays + dossier d'URL éventuel)
            for m in markets(s):
                mk = m["code"]
                sfx = "" if mk == ALL else "|" + mk
                keys = {f"{q}|{p}{sfx}" for q, p in wanted} | {f"{q}|*{sfx}" for q in queries} | {"__site__" + sfx}
                window = BACKFILL_DAYS if not keys <= done else days
                start = today - timedelta(days=window)
                dates_window = {str(start + timedelta(days=i)) for i in range(window + 1)}
                geo = [f("country", "equals", mk)] if mk != ALL else []
                scope = geo + ([f("page", "contains", m["path"])] if m.get("path") else [])
                print(f"[{name}/{mk}] fenêtre {window} jours ({start} → {end}), {len(queries)} requêtes, {len(pages)} pages")

                def upsert(fname, fields, new_rows, key, prune_before=None):
                    old = [r for r in read_csv(DATA / fname)
                           if not (r["site"] == name and r["country"] == mk and r["date"] in dates_window)
                           and not (prune_before and r["site"] == name and r["date"] < prune_before)]
                    write_csv(DATA / fname, fields, old + new_rows, key)

                if queries:
                    # Couples mot-clé / page suivie, historique complet
                    pos = []
                    if pages:
                        for r in gsc(tok, prop, start, end, ["date", "query", "page"],
                                     [f("query", "includingRegex", rx_exact(queries)), f("page", "includingRegex", rx_exact(pages))] + geo):
                            d, q, p = r["keys"]
                            if (q, p) in wanted:
                                pos.append({"date": d, "site": name, "country": mk, "keyword": q, "page": p, "position": round(r["position"], 1),
                                            "clicks": int(r["clicks"]), "impressions": int(r["impressions"]),
                                            "ctr": round(r["ctr"] * 100, 2), "data_state": state(d)})
                    upsert("positions.csv", F_POS, pos, lambda r: (r["site"], r["country"], r["keyword"], r["page"], r["date"]))

                    # Mot-clé toutes pages confondues (position du site)
                    kwr = [{"date": r["keys"][0], "site": name, "country": mk, "query": r["keys"][1], "position": round(r["position"], 1),
                            "clicks": int(r["clicks"]), "impressions": int(r["impressions"]), "data_state": state(r["keys"][0])}
                           for r in gsc(tok, prop, start, end, ["date", "query"], [f("query", "includingRegex", rx_exact(queries))] + scope)]
                    upsert("keywords.csv", F_KW, kwr, lambda r: (r["site"], r["country"], r["query"], r["date"]))

                    # Toutes les pages qui reçoivent des impressions sur les mots-clés suivis (changement d'URL)
                    qp_start = max(start, today - timedelta(days=QUERY_PAGES_DAYS))
                    qp = [{"date": r["keys"][0], "site": name, "country": mk, "query": r["keys"][1], "page": r["keys"][2],
                           "position": round(r["position"], 1), "clicks": int(r["clicks"]), "impressions": int(r["impressions"])}
                          for r in gsc(tok, prop, qp_start, end, ["date", "query", "page"], [f("query", "includingRegex", rx_exact(queries))] + scope)
                          if r["impressions"] >= 2]
                    upsert("query_pages.csv", F_QP, qp, lambda r: (r["site"], r["country"], r["query"], r["date"], r["page"]),
                           prune_before=str(today - timedelta(days=QUERY_PAGES_DAYS)))

                # Totaux du marché : tout, marque, hors marque
                seg = []
                for segment, flt in [("total", []), ("brand", [f("query", "includingRegex", brand)]),
                                     ("nonbrand", [f("query", "excludingRegex", brand)])]:
                    for r in gsc(tok, prop, start, end, ["date"], flt + scope):
                        seg.append({"date": r["keys"][0], "site": name, "country": mk, "segment": segment, "position": round(r["position"], 1),
                                    "clicks": int(r["clicks"]), "impressions": int(r["impressions"]), "data_state": state(r["keys"][0])})
                upsert("site.csv", F_SITE, seg, lambda r: (r["site"], r["country"], r["segment"], r["date"]))

                extras = fetch_extras(tok, s, queries, pages, end, brand, geo, scope)
                write_json(DATA / "extras" / f"{name}{suffix(mk)}.json", extras, compact=True)
                done |= keys
                backfilled[name] = sorted(done)

            inspect_pages(tok, s, pages)
            last = max((r["date"] for r in read_csv(DATA / "site.csv") if r["site"] == name), default=None)
            st.update({"ok": True, "error": None, "last_data_date": last, "last_success": st["last_run"]})
        except Exception as e:  # on note l'erreur dans le statut et on passe au projet suivant
            print(f"[{name}] ERREUR : {e}")
            st.update({"ok": False, "error": str(e)[:300]})

    write_json(DATA / "status.json", status)
    write_json(DATA / "backfilled.json", backfilled)
    fetch_google_updates()


def fetch_extras(tok, s, queries, pages, end, brand, geo=(), scope=()):
    prop = s["property"]
    geo, scope = list(geo), list(scope)
    c_start, p_end = end - timedelta(days=27), end - timedelta(days=28)
    p_start = p_end - timedelta(days=27)
    out = {"period": [str(c_start), str(end)], "prev_period": [str(p_start), str(p_end)]}

    # Répartition appareil / pays des couples suivis, 28 derniers jours (pays seulement en « tous pays »)
    out["splits"] = {}
    if queries and pages:
        flt = [f("query", "includingRegex", rx_exact(queries)), f("page", "includingRegex", rx_exact(pages))] + geo
        for dim in ("device",) if geo else ("device", "country"):
            out["splits"][dim] = [[*r["keys"], int(r["clicks"]), int(r["impressions"]), round(r["position"], 1)]
                                  for r in gsc(tok, prop, c_start, end, ["query", "page", dim], flt)]

    # Requêtes de chaque page suivie, 28 jours vs 28 jours précédents
    out["page_queries"] = {}
    if pages:
        for label, a, b in (("cur", c_start, end), ("prev", p_start, p_end)):
            rows = gsc(tok, prop, a, b, ["page", "query"], [f("page", "includingRegex", rx_exact(pages))] + geo)
            per = defaultdict(list)
            for r in rows:
                per[r["keys"][0]].append([r["keys"][1], int(r["clicks"]), int(r["impressions"]), round(r["position"], 1)])
            for p, lst in per.items():
                lst.sort(key=lambda x: -x[2])
                out["page_queries"].setdefault(p, {})[label] = lst[:60]

    # Requêtes hors marque du site (suggestions de mots-clés)
    cur = gsc(tok, prop, c_start, end, ["query", "page"], [f("query", "excludingRegex", brand)] + scope, max_rows=25000)
    agg = {}
    for r in cur:
        q, p = r["keys"]
        a = agg.setdefault(q, {"clicks": 0, "impressions": 0, "pw": 0.0, "best": None, "best_impr": -1})
        a["clicks"] += r["clicks"]; a["impressions"] += r["impressions"]; a["pw"] += r["position"] * r["impressions"]
        if r["impressions"] > a["best_impr"]:
            a["best"], a["best_impr"] = p, r["impressions"]
    top = sorted(agg.items(), key=lambda kv: -kv[1]["impressions"])[:3000]
    prev = {r["keys"][0]: int(r["impressions"]) for r in
            gsc(tok, prop, p_start, p_end, ["query"], [f("query", "excludingRegex", brand)] + scope, max_rows=25000)}
    out["queries"] = [[q, int(a["clicks"]), int(a["impressions"]), round(a["pw"] / a["impressions"], 1) if a["impressions"] else None,
                       a["best"], prev.get(q, 0)] for q, a in top]
    return out


def inspect_pages(tok, s, pages):
    p = DATA / "inspection" / f"{s['name']}.json"
    store = read_json(p, {"current": {}, "history": []})
    today = str(datetime.now(timezone.utc).date())
    fields = ["verdict", "coverageState", "indexingState", "robotsTxtState", "pageFetchState", "googleCanonical", "userCanonical"]
    for url in pages:
        try:
            r = post(INSPECT_API, tok, {"inspectionUrl": url, "siteUrl": s["property"], "languageCode": "fr-FR"})
        except Exception as e:
            print(f"  inspection {url} : {e}")
            continue
        res = r.get("inspectionResult", {}).get("indexStatusResult", {})
        cur = {k: res.get(k) for k in fields + ["lastCrawlTime", "crawledAs"]}
        cur["checked"] = today
        old = store["current"].get(url)
        if old:
            for k in fields:
                if old.get(k) != cur.get(k):
                    store["history"].append({"date": today, "url": url, "field": k, "old": old.get(k), "new": cur.get(k)})
        store["current"][url] = cur
    store["current"] = {u: v for u, v in store["current"].items() if u in pages}
    store["history"] = store["history"][-500:]
    write_json(p, store)


def fetch_google_updates():
    p = DATA / "google_updates.json"
    known = {u["id"]: u for u in read_json(p, [])}
    try:
        for i in requests.get(GOOGLE_STATUS, timeout=30).json():
            uri = (i.get("uri") or "").lstrip("/")
            known[i["id"]] = {"id": i["id"], "begin": (i.get("begin") or "")[:10], "end": (i.get("end") or "")[:10],
                              "title": i.get("external_desc") or "", "service": i.get("service_name") or "",
                              "url": f"https://status.search.google.com/{uri}"}
    except Exception as e:
        print(f"mises à jour Google : {e}")
    write_json(p, sorted(known.values(), key=lambda u: u["begin"]))


# ---------------------------------------------------------------- calculs

def wavg(rows):
    impr = sum(r[2] for r in rows)
    clicks = sum(r[1] for r in rows)
    pos = sum(r[0] * r[2] for r in rows) / impr if impr else None
    return pos, clicks, impr


def daily(rows, queries, page=None):
    """Agrège par jour (position pondérée par les impressions) les lignes des requêtes d'un groupe."""
    by = defaultdict(list)
    fresh = set()
    for r in rows:
        if r.get("keyword", r.get("query")) in queries and (page is None or r.get("page") == page):
            by[r["date"]].append((float(r["position"]), int(r["clicks"]), int(r["impressions"])))
            if r.get("data_state") == "fresh":
                fresh.add(r["date"])
    out = []
    for d in sorted(by):
        p, c, i = wavg(by[d])
        out.append([d, round(p, 1) if p is not None else None, c, i, 1 if d in fresh else 0])
    return out


def window_stats(series, a, b):
    rows = [(x[1], x[2], x[3]) for x in series if a <= x[0] <= b and x[1] is not None]
    return wavg(rows)


def ctr_curve(pos_rows, last_final):
    """Courbe de CTR par position calculée sur les données du client (90 derniers jours, données définitives)."""
    since = str(date.fromisoformat(last_final) - timedelta(days=90))
    b = defaultdict(lambda: [0, 0])
    for r in pos_rows:
        if since <= r["date"] <= last_final:
            k = min(20, max(1, round(float(r["position"]))))
            b[k][0] += int(r["clicks"]); b[k][1] += int(r["impressions"])
    pts = {k: v[0] / v[1] for k, v in b.items() if v[1] >= 100}
    if not pts:
        return None
    curve, known = [], sorted(pts)
    for k in range(1, 21):
        if k in pts:
            v = pts[k]
        else:
            lo = max([x for x in known if x < k], default=None)
            hi = min([x for x in known if x > k], default=None)
            v = pts[lo] + (pts[hi] - pts[lo]) * (k - lo) / (hi - lo) if lo and hi else pts[lo or hi]
        curve.append(v)
    for i in range(1, 20):  # une position plus basse ne peut pas avoir un meilleur CTR
        curve[i] = min(curve[i], curve[i - 1])
    return [round(v, 5) for v in curve]


def ctr_at(curve, pos):
    if not curve or pos is None:
        return 0
    if pos <= 1:
        return curve[0]
    if pos >= 20:
        return curve[19]
    lo = int(pos)
    return curve[lo - 1] + (curve[lo] - curve[lo - 1]) * (pos - lo)


def fr(x):
    return f"{x:.1f}".replace(".", ",")


def dshift(d, n):
    return str(date.fromisoformat(d) + timedelta(days=n))


def pos_at(series_map, d, lookback=LOOKBACK):
    """Position au jour d, sinon la dernière connue dans les `lookback` jours précédents. Renvoie le point ou None."""
    for n in range(lookback + 1):
        x = series_map.get(dshift(d, -n))
        if x and x[1] is not None:
            return x
    return None


def build():
    sites = load_sites()
    raw = {n: read_csv(DATA / n) for n in ("positions.csv", "keywords.csv", "query_pages.csv", "site.csv")}
    by = {n: defaultdict(list) for n in raw}
    for n, rows in raw.items():
        for r in rows:
            by[n][(r["site"], r["country"])].append(r)
    status = read_json(DATA / "status.json", {})
    updates = read_json(DATA / "google_updates.json", [])
    generated = datetime.now(timezone.utc).isoformat(timespec="minutes")
    index = {"generated_at": generated, "google_updates": updates, "projects": []}
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()

    for s in sites:
        name = s["name"]
        ms, dm = markets(s), default_market(s)
        insp = read_json(DATA / "inspection" / f"{name}.json", {"current": {}, "history": []})
        for m in ms:
            key = (name, m["code"])
            extras = read_json(DATA / "extras" / f"{name}{suffix(m['code'])}.json", {})
            p = build_project(s, m, ms, dm, by["positions.csv"][key], by["keywords.csv"][key], by["query_pages.csv"][key],
                              by["site.csv"][key], extras, insp, status.get(name, {}), generated)
            write_json(OUT / f"{name}{suffix(m['code'])}.json", p, compact=True)
            if m["code"] == dm:
                index["projects"].append(summary(p))
            print(f"[{name}/{m['code']}] {len(p['keywords'])} mots-clés, {len(p['alerts'])} alertes, {len(p['events'])} événements, "
                  f"{len(p['actions'])} actions")

    write_json(OUT / "index.json", index, compact=True)


def build_project(s, m, ms, dm, pos_rows, kw_rows, qp_rows, site_rows, extras, insp, st, generated):
    name = s["name"]
    today = str(datetime.now(timezone.utc).date())
    all_dates = sorted({r["date"] for r in site_rows} | {r["date"] for r in kw_rows})
    finals = sorted({r["date"] for r in site_rows if r["data_state"] == "final"} | {r["date"] for r in kw_rows if r["data_state"] == "final"})
    last = all_dates[-1] if all_dates else None
    lf = finals[-1] if finals else last
    curve = ctr_curve(pos_rows, lf) if lf else None

    # Pages qui reçoivent des impressions sur chaque requête, par jour (changement d'URL)
    qp_day = defaultdict(lambda: defaultdict(list))
    for r in qp_rows:
        qp_day[r["query"]][r["date"]].append(r)

    groups = []
    for i, k in enumerate(s["keywords"]):
        qs = set(k["queries"])
        site_s = daily(kw_rows, qs)
        tracked = site_s if k["page"] == SITE_LEVEL else daily(pos_rows, qs, k["page"])
        g = {"i": i, "keyword": k["keyword"], "page": k["page"], "variants": k["variants"], "tags": k["tags"],
             "note": k.get("note"), "status": k["status"], "target": k["target"], "s": tracked, "ss": site_s}
        if lf:
            a28 = dshift(lf, -27)
            g["variants_detail"] = []
            for q in k["queries"]:
                vp = window_stats(daily(pos_rows, {q}, k["page"]) if k["page"] != SITE_LEVEL else daily(kw_rows, {q}), a28, lf)
                vs = window_stats(daily(kw_rows, {q}), a28, lf)
                g["variants_detail"].append({"query": q, "pos": r1(vp[0]), "clicks": vp[1], "impr": vp[2], "site_pos": r1(vs[0]), "site_impr": vs[2]})
            g["pages"] = competing(qp_rows, qs, k["page"], dshift(lf, -27), lf, dshift(lf, -6))
            g["splits"] = splits_for(extras.get("splits", {}), qs, k["page"])
        # Page qui capte le plus d'impressions chaque jour, quand ce n'est pas la page suivie
        if k["page"] != SITE_LEVEL:
            alt = {}
            dates = {d for q in qs for d in qp_day[q]}
            for d in dates:
                per = defaultdict(list)
                for q in qs:
                    for r in qp_day[q].get(d, []):
                        per[r["page"]].append((float(r["position"]), int(r["clicks"]), int(r["impressions"])))
                agg = {pg: wavg(v) for pg, v in per.items()}
                lead = max(agg, key=lambda pg: agg[pg][2])
                if lead != k["page"] and agg[lead][2] > agg.get(k["page"], (None, 0, 0))[2]:
                    alt[d] = [lead, agg[lead][2], r1(agg[lead][0]), agg.get(k["page"], (None, 0, 0))[2]]
            g["alt"] = alt
        groups.append(g)

    alerts, events, moves = detect(groups, qp_rows, curve, finals)
    for url, cur in insp.get("current", {}).items():
        if cur.get("verdict") and cur["verdict"] != "PASS":
            alerts.append(alert("critique", "indexation", None, url, f"Page non indexée : {cur.get('coverageState')}", lf))
        elif cur.get("googleCanonical") and cur.get("userCanonical") and norm_url(cur["googleCanonical"]) != norm_url(cur["userCanonical"]):
            alerts.append(alert("attention", "canonical", None, url, f"Google retient une autre canonique : {cur['googleCanonical']}", lf))
    for h in insp.get("history", []):
        events.append({"date": h["date"], "severity": "attention", "type": "inspection", "page": h["url"],
                       "text": f"Inspection : {h['field']} passe de « {h['old']} » à « {h['new']} »"})
    if st.get("ok") is False:
        alerts.append(alert("critique", "synchro", None, None, f"La dernière synchro a échoué : {st.get('error')}", today))
    elif last and (date.fromisoformat(today) - date.fromisoformat(last)).days > 4:
        alerts.append(alert("critique", "synchro", None, None, f"Pas de nouvelle donnée depuis le {last}", today))
    alerts.sort(key=lambda a: ({"critique": 0, "attention": 1, "info": 2}[a["severity"]], -(a.get("impact") or 0)))
    events.sort(key=lambda e: e["date"], reverse=True)

    actions = impact(s["actions"], groups, finals)
    segs = {seg: [[r["date"], float(r["position"]), int(r["clicks"]), int(r["impressions"]), 1 if r["data_state"] == "fresh" else 0]
                  for r in sorted(site_rows, key=lambda r: r["date"]) if r["segment"] == seg] for seg in ("total", "brand", "nonbrand")}
    anonymized = None
    if lf:
        a28 = dshift(lf, -27)
        tot = sum(x[2] for x in segs["total"] if a28 <= x[0] <= lf)
        named = sum(x[2] for sg in ("brand", "nonbrand") for x in segs[sg] if a28 <= x[0] <= lf)
        anonymized = round((tot - named) / tot * 100, 1) if tot else None

    crit = sum(a["severity"] == "critique" for a in alerts)
    att = sum(a["severity"] == "attention" for a in alerts)
    tracked_q = {q for k in s["keywords"] for q in k["queries"]}
    return {
        "name": name, "label": s.get("label", name), "property": s["property"], "owner": s.get("owner"),
        "account": s["account"], "generated_at": generated, "last_date": last, "last_final": lf,
        "market": m["code"], "market_label": m["label"], "market_path": m.get("path"), "default_market": dm,
        "markets": [{"code": x["code"], "label": x["label"]} for x in ms],
        "status": st, "health": max(0, 100 - 15 * crit - 5 * att), "ctr_curve": curve, "anonymized_share": anonymized,
        "keywords": groups, "alerts": alerts, "events": events[:3000], "moves": moves, "actions": actions,
        "segments": segs, "inspection": insp, "page_queries": extras.get("page_queries", {}), "extras_period": extras.get("period"),
        "suggestions": suggestions(extras.get("queries", []), tracked_q, curve),
    }


def r1(v):
    return round(v, 1) if v is not None else None


def competing(qp_rows, qs, tracked_page, a28, lf, a7):
    per = defaultdict(lambda: [[], []])
    for r in qp_rows:
        if r["query"] in qs and a28 <= r["date"] <= lf:
            t = (float(r["position"]), int(r["clicks"]), int(r["impressions"]))
            per[r["page"]][0].append(t)
            if r["date"] >= a7:
                per[r["page"]][1].append(t)
    tot28 = sum(sum(x[2] for x in v[0]) for v in per.values()) or 1
    tot7 = sum(sum(x[2] for x in v[1]) for v in per.values()) or 1
    out = []
    for p, (l28, l7) in per.items():
        p28, c28, i28 = wavg(l28)
        p7, c7, i7 = wavg(l7)
        out.append({"page": p, "tracked": p == tracked_page, "pos": r1(p28), "clicks": c28, "impr": i28,
                    "share": round(i28 / tot28 * 100, 1), "pos7": r1(p7), "impr7": i7, "share7": round(i7 / tot7 * 100, 1)})
    out.sort(key=lambda x: -x["impr"])
    return out[:10]


def splits_for(splits, qs, page):
    out = {}
    for dim, rows in splits.items():
        agg = defaultdict(list)
        for q, p, val, c, i, pos in rows:
            if q in qs and (page == SITE_LEVEL or p == page):
                agg[val].append((pos, c, i))
        lst = []
        for k, v in agg.items():
            pos, c, i = wavg(v)
            lst.append({"key": k, "pos": r1(pos), "clicks": c, "impr": i})
        lst.sort(key=lambda x: -x["impr"])
        out[dim] = lst[:8]
    return out


def alert(sev, typ, g, page, text, d, impact_clicks=None):
    return {"severity": sev, "type": typ, "keyword": g["keyword"] if g else None, "i": g["i"] if g else None,
            "page": page, "text": text, "date": d, "impact": impact_clicks}


def detect(groups, qp_rows, curve, finals):
    """Règles d'alerte évaluées sur chaque jour définitif de l'historique.

    La variation de position est la même partout dans l'outil : position du jour J contre position du jour J-7
    (colonne « 7 j » du tableau, mouvements de la semaine, alertes). Elle ne compte que si chacun des deux jours
    a au moins MIN_IMPR_DAY impressions.
    Alertes = règles vraies au dernier jour définitif. Événements = jours où une règle devient vraie.
    Mouvements = toutes les variations sur 7 jours valides au dernier jour définitif."""
    if not finals:
        return [], [], []
    lf = finals[-1]
    qp_by = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))   # requête -> date -> page -> impressions
    for r in qp_rows:
        qp_by[r["query"]][r["date"]][r["page"]] += int(r["impressions"])
    qp_first = min((r["date"] for r in qp_rows), default=None)
    alerts, events, moves = [], [], []

    def wsum(mp, a, n):  # impressions des n jours qui finissent le jour a
        return sum(mp[dshift(a, -j)][3] for j in range(n) if dshift(a, -j) in mp)

    for g in groups:
        s = {x[0]: x for x in g["s"] if not x[4] and x[1] is not None}
        ss = {x[0]: x for x in g["ss"] if not x[4] and x[1] is not None}
        qs = [g["keyword"]] + g["variants"]
        prev_flags = set()
        for D in finals:
            flags = {}
            c, r = s.get(D), s.get(dshift(D, -7))
            if c and r and c[3] >= MIN_IMPR_DAY and r[3] >= MIN_IMPR_DAY:
                p0, p1 = r[1], c[1]
                d = round(p1 - p0, 1)                      # positif = recul
                if D == lf:
                    moves.append({"i": g["i"], "p0": p0, "p1": p1, "d": -d, "i0": r[3], "i1": c[3]})
                thr = 1 if p0 <= 3 else 2 if p0 <= 10 else 3
                i28 = wsum(ss, D, 28)
                lost = round(i28 * (ctr_at(curve, p0) - ctr_at(curve, p1))) if curve else None
                if p0 <= 10 < p1 and d >= 1:
                    flags["top10"] = ("critique", f"Sort du top 10 : {fr(p0)} → {fr(p1)} en 7 jours", lost)
                elif p0 <= 3 < p1 and d >= 1:
                    flags["top3"] = ("attention", f"Sort du top 3 : {fr(p0)} → {fr(p1)} en 7 jours", lost)
                elif d >= thr:
                    flags["baisse"] = ("attention", f"Perd {fr(d)} place{'s' if d >= 2 else ''} en 7 jours : {fr(p0)} → {fr(p1)}", lost)
                if -d >= thr:
                    flags["hausse"] = ("info", f"Gagne {fr(-d)} place{'s' if -d >= 2 else ''} en 7 jours : {fr(p0)} → {fr(p1)}", -lost if lost else None)
            if g["page"] != SITE_LEVEL and wsum(s, dshift(D, -3), 7) >= 30 and wsum(s, D, 3) == 0:
                flags["disparue"] = ("critique", "La page suivie ne reçoit plus aucune impression sur ce mot-clé depuis 3 jours", None)
            w1, w0 = wsum(s, D, 7), wsum(s, dshift(D, -7), 7)
            if w0 >= 200 and w1 <= 0.7 * w0:
                sw1, sw0 = wsum(ss, D, 7), wsum(ss, dshift(D, -7), 7)
                demand = bool(sw0) and sw1 <= 0.75 * sw0
                flags["impressions"] = ("info" if demand else "attention",
                                        f"Impressions de la page : {w0} → {w1} sur 7 jours ({(w1 - w0) / w0 * 100:+.0f} %)"
                                        + (", la demande baisse aussi" if demand else ", alors que la demande sur le mot-clé tient"), None)
            if g["page"] != SITE_LEVEL and qp_first and dshift(D, -6) >= qp_first:
                per = defaultdict(int)
                for q in qs:
                    for j in range(7):
                        for pg, n in qp_by[q].get(dshift(D, -j), {}).items():
                            per[pg] += n
                if per:
                    lead = max(per, key=per.get)
                    if lead != g["page"] and per[lead] > per.get(g["page"], 0) and per[lead] >= 50:
                        flags["page"] = ("attention", f"Une autre page est en tête sur 7 jours : {lead} ({per[lead]} impressions contre {per.get(g['page'], 0)})", None)
            for t, (sev, text, imp) in flags.items():
                if t not in prev_flags:
                    events.append({"date": D, "severity": sev, "type": t, "keyword": g["keyword"], "i": g["i"], "page": g["page"], "text": text, "impact": imp})
            prev_flags = set(flags)
            if D == lf:
                for t, (sev, text, imp) in flags.items():
                    if sev != "info":
                        alerts.append(alert(sev, t, g, g["page"], text, D, imp))
    return alerts, events, moves


def impact(actions, groups, finals):
    out = []
    if not finals:
        return out
    lf = finals[-1]
    touched = defaultdict(list)
    for a in actions:
        if a.get("date") and a.get("page"):
            touched[norm_url(a["page"])].append(str(a["date"]))
    for n, a in enumerate(sorted(actions, key=lambda a: str(a.get("date")), reverse=True)):
        D = str(a.get("date"))
        res = {**{k: (str(v) if isinstance(v, date) else v) for k, v in a.items()}, "id": n}
        aff = [g for g in groups if a.get("page") and norm_url(g["page"]) == norm_url(a["page"])]
        res["keywords"] = [g["i"] for g in aff]
        days_after = (date.fromisoformat(lf) - date.fromisoformat(D)).days if D <= lf else -1
        res["days_after"] = days_after
        if not aff:
            res["impact"] = None
            res["reason"] = "Aucun mot-clé suivi sur cette page"
        elif days_after < 7:
            res["impact"] = None
            res["reason"] = f"Pas assez de recul ({max(days_after, 0)} jour{'s' if days_after > 1 else ''} de données définitives après l'action, 7 minimum)"
        else:
            n_after = min(days_after, 28)
            b0, b1, a0, a1 = dshift(D, -28), dshift(D, -1), dshift(D, 1), dshift(D, n_after)

            def agg(gs, x, y):
                rows = [(p[1], p[2], p[3]) for g in gs for p in g["s"] if x <= p[0] <= y and p[1] is not None and not p[4]]
                return wavg(rows)
            pb, cb, ib = agg(aff, b0, b1)
            pa, ca, ia = agg(aff, a0, a1)
            ctrl = [g for g in groups if g not in aff and not any(abs((date.fromisoformat(d) - date.fromisoformat(D)).days) <= 28
                                                                  for d in touched.get(norm_url(g["page"]), []))]
            _, ccb, _ = agg(ctrl, b0, b1)
            _, cca, _ = agg(ctrl, a0, a1)
            per_b, per_a = cb / 28, ca / n_after
            ctrl_ratio = (cca / n_after) / (ccb / 28) if ccb else None
            adj = per_a - per_b * ctrl_ratio if ctrl_ratio else None
            res["impact"] = {"window_after": n_after, "pos_before": r1(pb), "pos_after": r1(pa),
                             "clicks_day_before": round(per_b, 1), "clicks_day_after": round(per_a, 1),
                             "impr_day_before": round(ib / 28, 1), "impr_day_after": round(ia / n_after, 1),
                             "control_ratio": round(ctrl_ratio, 3) if ctrl_ratio else None, "control_size": len(ctrl),
                             "clicks_month_adjusted": round(adj * 28) if adj is not None else None}
        out.append(res)
    return out


def suggestions(queries, tracked, curve):
    out = []
    for q, c, i, p, best, prev in queries:
        if q in tracked or not p:
            continue
        flags = []
        if 4 <= p <= 20 and i >= 100:
            flags.append("striking")
        if i >= 50 and prev <= i * 0.1:
            flags.append("nouvelle")
        target = 1 if p <= 3 else 3
        pot = round(i * max(0, ctr_at(curve, target) - ctr_at(curve, p))) if curve else None
        out.append({"query": q, "clicks": c, "impr": i, "pos": p, "page": best, "prev_impr": prev, "flags": flags, "potential": pot})
    by_clicks = sorted(out, key=lambda x: -x["clicks"])[:40]
    for x in by_clicks:
        x["flags"].insert(0, "top")
    keep = {x["query"]: x for x in by_clicks}
    for x in sorted(out, key=lambda x: -(x["potential"] or 0))[:60]:
        keep.setdefault(x["query"], x)
    for x in out:
        if "nouvelle" in x["flags"] or "striking" in x["flags"]:
            keep.setdefault(x["query"], x)
    return sorted(keep.values(), key=lambda x: -(x["potential"] or 0))[:200]


def summary(p):
    """Résumé d'un projet pour le portefeuille (marché par défaut). Positions données au dernier jour et au dernier jour définitif."""
    lf, last = p["last_final"], p["last_date"]
    out = {k: p[k] for k in ("name", "label", "property", "owner", "health", "last_date", "last_final", "status", "market", "market_label")}
    out["n_keywords"] = len(p["keywords"])
    out["kw"] = [[g["i"], g["keyword"]] for g in p["keywords"]]   # recherche rapide du dashboard
    out["alerts"] = {s: sum(a["severity"] == s for a in p["alerts"]) for s in ("critique", "attention")}
    if lf:
        nb = p["segments"]["nonbrand"]
        win = lambda a, b: sum(x[2] for x in nb if a <= x[0] <= b)
        cur, prev = win(dshift(lf, -27), lf), win(dshift(lf, -55), dshift(lf, -28))
        n1 = win(dshift(lf, -27 - 364), dshift(lf, -364))
        out["nonbrand_clicks"] = cur
        out["nonbrand_vs_prev"] = round((cur - prev) / prev * 100, 1) if prev else None
        out["nonbrand_vs_n1"] = round((cur - n1) / n1 * 100, 1) if n1 else None
        maps = [{x[0]: x for x in g["s"]} for g in p["keywords"]]
        for tag, D in (("final", lf), ("last", last)):
            now = [x[1] for x in (pos_at(mp, D) for mp in maps) if x]
            before = [x[1] for x in (pos_at(mp, dshift(D, -28)) for mp in maps) if x]
            out[f"pos_{tag}"] = r1(sum(now) / len(now)) if now else None
            out[f"pos_{tag}_prev"] = r1(sum(before) / len(before)) if before else None
            out[f"top10_{tag}"] = sum(1 for v in now if v <= 10)
    return out


# ---------------------------------------------------------------- nouveau projet : mots-clés de départ

def seed(site_name, n):
    s = next(x for x in load_sites() if x["name"] == site_name)
    path = CONF / "keywords" / f"{site_name}.yaml"
    if s["keywords"]:
        print("Le projet a déjà des mots-clés, rien à faire.")
        return
    tok = token(s["account"])
    end = datetime.now(timezone.utc).date() - timedelta(days=FINAL_AFTER_DAYS)
    brand = "(?i)(" + s.get("brand_regex", "^$") + ")"
    rows = gsc(tok, s["property"], end - timedelta(days=27), end, ["query", "page"], [f("query", "excludingRegex", brand)], max_rows=25000)
    agg = {}
    for r in rows:
        q, p = r["keys"]
        a = agg.setdefault(q, {"clicks": 0, "best": None, "bi": -1})
        a["clicks"] += r["clicks"]
        if r["impressions"] > a["bi"]:
            a["best"], a["bi"] = p, r["impressions"]
    top = sorted(agg.items(), key=lambda kv: -kv[1]["clicks"])[:n]
    lines = [f"# Mots-clés suivis pour {s.get('label', site_name)}, pré-remplis avec les {n} premières requêtes hors marque par clics (28 jours).",
             "# Voir config/keywords/celio.yaml pour le détail des champs.", "", "keywords:"]
    for q, a in top:
        lines += [f"  - keyword: {json.dumps(q, ensure_ascii=False)}", f"    page: {a['best']}"]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"{len(top)} mots-clés écrits dans {path.relative_to(ROOT)}")


# ---------------------------------------------------------------- digest Slack

def notify():
    hook = secrets().get("SLACK_WEBHOOK_URL")
    if not hook:
        print("SLACK_WEBHOOK_URL absent, pas de digest.")
        return
    sent_p = DATA / "alerts_sent.json"
    sent = set(read_json(sent_p, []))
    base = secrets().get("DASHBOARD_URL", "https://analytics-ds.github.io/suivi-positions-gsc/")
    idx = read_json(OUT / "index.json", {"projects": []})
    lines, now_ids = [], set()
    for sp in idx["projects"]:
        p = read_json(OUT / f"{sp['name']}{suffix(sp.get('market') or ALL)}.json", {})   # marché par défaut du projet
        new = []
        for a in p.get("alerts", []):
            aid = f"{sp['name']}|{a['type']}|{a.get('keyword')}|{a.get('page')}"
            now_ids.add(aid)
            if aid not in sent:
                new.append(a)
        if new:
            lines.append(f"*{sp['label']}* ({sp.get('market_label') or 'Tous pays'}) <{base}#/{sp['name']}/a-traiter|voir ce qui est à traiter>")
            lines += [f"• [{a['severity']}] {a.get('keyword') or a.get('page') or ''} : {a['text']}" for a in new[:10]]
    if datetime.now(timezone.utc).weekday() == 0:
        lines.append("\n*Récap de la semaine*")
        for sp in idx["projects"]:
            lines.append(f"• {sp['label']} : {sp.get('nonbrand_clicks', '-')} clics hors marque sur 28 j "
                         f"({sp.get('nonbrand_vs_prev') or 0:+} % vs 28 j précédents), position moyenne {sp.get('pos_final')}, "
                         f"{sp['alerts']['critique']} urgente(s), {sp['alerts']['attention']} à surveiller")
    if lines:
        requests.post(hook, json={"text": "\n".join(lines)}, timeout=30).raise_for_status()
        print(f"Digest envoyé ({len(lines)} lignes).")
    write_json(sent_p, sorted(now_ids))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    fa = sub.add_parser("fetch")
    fa.add_argument("--days", type=int, default=10)
    fa.add_argument("--site")
    sub.add_parser("build")
    sa = sub.add_parser("seed")
    sa.add_argument("site")
    sa.add_argument("--n", type=int, default=20)
    sub.add_parser("notify")
    a = ap.parse_args()
    if a.cmd == "fetch":
        fetch(a.days, a.site)
    elif a.cmd == "build":
        build()
    elif a.cmd == "seed":
        seed(a.site, a.n)
    else:
        notify()
