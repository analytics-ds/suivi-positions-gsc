"""Suivi de positions GSC.

Deux commandes :
  python scripts/tracker.py fetch [--days 10]   récupère la donnée GSC et met à jour data/positions.csv
  python scripts/tracker.py build                génère docs/data.json pour le dashboard

Authentification (variables d'environnement, une des deux options) :
  - GSC_SERVICE_ACCOUNT_JSON : contenu JSON de la clé d'un compte de service ajouté
    en utilisateur sur chaque propriété GSC suivie (option recommandée)
  - GSC_CLIENT_ID + GSC_CLIENT_SECRET + GSC_REFRESH_TOKEN : OAuth utilisateur
"""

import argparse
import csv
import json
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

import requests
import yaml

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config" / "tracking.yaml"
DATA = ROOT / "data" / "positions.csv"
OUT = ROOT / "docs" / "data.json"

FIELDS = ["date", "site", "keyword", "page", "position", "clicks", "impressions", "ctr", "data_state"]
SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"
API = "https://searchconsole.googleapis.com/webmasters/v3/sites/{}/searchAnalytics/query"
# En dessous de ce délai, la donnée GSC est encore "fraîche" (non consolidée) et peut bouger.
FINAL_AFTER_DAYS = 3
SITE_LEVEL = "*"


def load_config():
    with open(CONFIG, encoding="utf-8") as f:
        return yaml.safe_load(f)["sites"]


def load_rows():
    if not DATA.exists():
        return []
    with open(DATA, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def save_rows(rows):
    rows.sort(key=lambda r: (r["site"], r["keyword"], r["page"], r["date"]))
    with open(DATA, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)


def get_token():
    import google.auth.transport.requests as gat

    sa = os.environ.get("GSC_SERVICE_ACCOUNT_JSON")
    if sa:
        from google.oauth2 import service_account

        creds = service_account.Credentials.from_service_account_info(json.loads(sa), scopes=[SCOPE])
    elif os.environ.get("GSC_REFRESH_TOKEN"):
        from google.oauth2.credentials import Credentials

        creds = Credentials(
            None,
            refresh_token=os.environ["GSC_REFRESH_TOKEN"],
            client_id=os.environ["GSC_CLIENT_ID"],
            client_secret=os.environ["GSC_CLIENT_SECRET"],
            token_uri="https://oauth2.googleapis.com/token",
            scopes=[SCOPE],
        )
    else:
        sys.exit("Aucun identifiant GSC : définir GSC_SERVICE_ACCOUNT_JSON ou GSC_CLIENT_ID/SECRET/REFRESH_TOKEN.")
    creds.refresh(gat.Request())
    return creds.token


def query(token, prop, body):
    url = API.format(quote(prop, safe=""))
    rows, start = [], 0
    while True:
        r = requests.post(url, json={**body, "rowLimit": 25000, "startRow": start},
                          headers={"Authorization": f"Bearer {token}"}, timeout=60)
        if r.status_code != 200:
            raise RuntimeError(f"GSC {prop} : {r.status_code} {r.text[:300]}")
        batch = r.json().get("rows", [])
        rows += batch
        if len(batch) < 25000:
            return rows
        start += 25000


def regex_exact(values):
    return "^(" + "|".join(re.escape(v) for v in values) + ")$"


def fetch(days):
    sites = load_config()
    token = get_token()
    today = datetime.now(timezone.utc).date()
    start, end = today - timedelta(days=days), today - timedelta(days=1)
    final_limit = today - timedelta(days=FINAL_AFTER_DAYS)

    fetched = []
    for site in sites:
        kws = site["keywords"]
        base = {
            "startDate": start.isoformat(),
            "endDate": end.isoformat(),
            "type": "web",
            "dataState": "all",  # inclut la donnée fraîche (J-1), non encore consolidée
        }
        with_page = [k for k in kws if k.get("page")]
        without_page = [k for k in kws if not k.get("page")]

        if with_page:
            wanted = {(k["keyword"], k["page"]) for k in with_page}
            body = {**base, "dimensions": ["date", "query", "page"], "dimensionFilterGroups": [{"filters": [
                {"dimension": "query", "operator": "includingRegex", "expression": regex_exact({k["keyword"] for k in with_page})},
                {"dimension": "page", "operator": "includingRegex", "expression": regex_exact({k["page"] for k in with_page})},
            ]}]}
            for r in query(token, site["property"], body):
                d, q, p = r["keys"]
                if (q, p) in wanted:
                    fetched.append(make_row(site["name"], d, q, p, r, final_limit))

        if without_page:
            body = {**base, "dimensions": ["date", "query"], "dimensionFilterGroups": [{"filters": [
                {"dimension": "query", "operator": "includingRegex", "expression": regex_exact({k["keyword"] for k in without_page})},
            ]}]}
            for r in query(token, site["property"], body):
                d, q = r["keys"]
                fetched.append(make_row(site["name"], d, q, SITE_LEVEL, r, final_limit))

        print(f"{site['label']} : {sum(1 for f in fetched if f['site'] == site['name'])} lignes")

    # Upsert : la donnée récente remplace l'ancienne (la donnée fraîche est consolidée au run suivant).
    # Les jours de la fenêtre sans ligne GSC (aucune impression) sont purgés pour ne pas garder une valeur fraîche périmée.
    window = {(start + timedelta(days=i)).isoformat() for i in range(days)}
    tracked_sites = {s["name"] for s in sites}
    kept = [r for r in load_rows() if not (r["site"] in tracked_sites and r["date"] in window)]
    save_rows(kept + fetched)
    print(f"{len(fetched)} lignes écrites sur {start} → {end}")


def make_row(site, d, q, p, r, final_limit):
    return {
        "date": d, "site": site, "keyword": q, "page": p,
        "position": round(r["position"], 1),
        "clicks": int(r["clicks"]),
        "impressions": int(r["impressions"]),
        "ctr": round(r["ctr"] * 100, 2),
        "data_state": "final" if date.fromisoformat(d) <= final_limit else "fresh",
    }


def build():
    sites = load_config()
    rows = load_rows()
    out = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="minutes"), "sites": []}
    for site in sites:
        tracked = []
        for k in site["keywords"]:
            page = k.get("page") or SITE_LEVEL
            series = [
                {"date": r["date"], "position": float(r["position"]), "clicks": int(r["clicks"]),
                 "impressions": int(r["impressions"]), "ctr": float(r["ctr"]), "fresh": r["data_state"] == "fresh"}
                for r in rows if r["site"] == site["name"] and r["keyword"] == k["keyword"] and r["page"] == page
            ]
            series.sort(key=lambda x: x["date"])
            tracked.append({"keyword": k["keyword"], "page": page, "series": series})
        out["sites"].append({"name": site["name"], "label": site.get("label", site["name"]),
                             "property": site["property"], "keywords": tracked})
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"docs/data.json généré ({len(rows)} lignes)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("fetch")
    f.add_argument("--days", type=int, default=10)
    sub.add_parser("build")
    a = ap.parse_args()
    fetch(a.days) if a.cmd == "fetch" else build()
