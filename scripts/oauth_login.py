"""Connexion OAuth à la Search Console avec un compte Google @datashake.fr.

Usage :
  python scripts/oauth_login.py chemin/vers/client_secret.json [--repo analytics-ds/suivi-positions-gsc]

Ouvre le navigateur, on se connecte avec le compte qui a accès aux propriétés GSC,
puis le script pose directement GSC_CLIENT_ID, GSC_CLIENT_SECRET et GSC_REFRESH_TOKEN
dans les secrets GitHub du repo. Aucune valeur n'est affichée.

Le fichier client_secret.json vient d'un client OAuth « Application de bureau »
créé dans le projet Google Cloud ds-suivi-positions-gsc (écran de consentement en mode Interne).
"""

import argparse
import json
import subprocess
import sys

import requests
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("client_secret")
    ap.add_argument("--repo", default="analytics-ds/suivi-positions-gsc")
    ap.add_argument("--env-file", help="fichier de secrets local où enregistrer aussi le refresh token")
    a = ap.parse_args()

    flow = InstalledAppFlow.from_client_secrets_file(a.client_secret, SCOPES)
    # prompt=consent garantit qu'un refresh token est renvoyé même si l'app a déjà été autorisée
    creds = flow.run_local_server(port=0, prompt="consent", access_type="offline")
    if not creds.refresh_token:
        sys.exit("Pas de refresh token renvoyé par Google.")

    sites = requests.get("https://searchconsole.googleapis.com/webmasters/v3/sites",
                         headers={"Authorization": f"Bearer {creds.token}"}, timeout=30).json()
    props = [s["siteUrl"] for s in sites.get("siteEntry", [])]
    print(f"Connexion OK : {len(props)} propriétés GSC accessibles.")

    client = json.load(open(a.client_secret))
    client = client.get("installed") or client.get("web")
    for name, value in [("GSC_CLIENT_ID", client["client_id"]),
                        ("GSC_CLIENT_SECRET", client["client_secret"]),
                        ("GSC_REFRESH_TOKEN", creds.refresh_token)]:
        subprocess.run(["gh", "secret", "set", name, "-R", a.repo, "--body", value], check=True)
    print(f"Secrets GitHub posés sur {a.repo}.")

    if a.env_file:
        # Remplace la ligne existante du refresh token ou l'ajoute à la fin du fichier de secrets local
        key = "GSC_SUIVI_POSITIONS_REFRESH_TOKEN"
        lines = [l for l in open(a.env_file).read().splitlines() if not l.startswith(key + "=")]
        lines.append(f"{key}={creds.refresh_token}")
        open(a.env_file, "w").write("\n".join(lines) + "\n")
        print(f"{key} enregistré dans {a.env_file}.")


if __name__ == "__main__":
    main()
