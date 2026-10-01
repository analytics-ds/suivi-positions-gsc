# Suivi de positions GSC

Outil datashake de suivi quotidien des positions à partir de la Google Search Console. On déclare des couples mot-clé / page, un workflow GitHub Actions récupère chaque matin la donnée GSC, l'historise dans le repo et régénère un dashboard publié sur GitHub Pages.

## Fonctionnement

- `config/tracking.yaml` : les sites, leur propriété GSC et les couples mot-clé / page suivis.
- `scripts/tracker.py fetch` : interroge l'API Search Analytics sur les 10 derniers jours (`dataState: all`, donc J-1 inclus en donnée fraîche) et met à jour `data/positions.csv`. Les jours de la fenêtre sont réécrits à chaque run : la donnée provisoire est remplacée par la donnée consolidée.
- `scripts/tracker.py build` : génère `docs/data.json`, lu par le dashboard `docs/index.html`.
- `.github/workflows/daily.yml` : tous les jours à 6h UTC, à chaque modification de `config/`, ou à la main (onglet Actions, « Run workflow », avec un nombre de jours à récupérer, 480 max pour reconstruire 16 mois d'historique).

## Ajouter des mots-clés ou un client

Éditer `config/tracking.yaml`, puis commit et push. Le workflow se relance tout seul et récupère l'historique des 10 derniers jours. Pour plus d'historique, lancer le workflow à la main avec `days` = 90 par exemple.

```yaml
sites:
  - name: celio
    label: Celio
    property: sc-domain:celio.com
    keywords:
      - keyword: jean homme
        page: https://www.celio.com/fr-fr/c/jeans
      - keyword: chemise homme   # sans page : position globale du site, toutes pages confondues
```

Le mot-clé est matché à l'identique dans la GSC (pas de variante, pas de pluriel automatique).

## Connecter la Search Console

L'outil lit la GSC avec les droits d'un compte Google @datashake.fr, via OAuth. Aucun utilisateur n'est ajouté sur les propriétés clients (l'agence n'en a pas le droit).

- App OAuth : client « Application de bureau » du projet Google Cloud `ds-suivi-positions-gsc` (organisation datashake.fr, écran de consentement en mode Interne, donc réservé aux comptes @datashake.fr et sans validation Google).
- Compte connecté aujourd'hui : theo@datashake.fr. Seules les propriétés GSC où ce compte est déclaré sont accessibles.
- Secrets GitHub du repo : `GSC_CLIENT_ID`, `GSC_CLIENT_SECRET`, `GSC_REFRESH_TOKEN`.

Pour (re)connecter un compte, par exemple si le token est révoqué ou pour changer de compte :

```bash
pip install -r requirements.txt
python scripts/oauth_login.py chemin/vers/client_secret.json --env-file chemin/vers/.claude/secrets/.env
```

Le navigateur s'ouvre, on se connecte avec le compte voulu, le script vérifie l'accès et pose les trois secrets GitHub. Aucune valeur n'est affichée.

## Lancer en local

```bash
pip install -r requirements.txt
GSC_CLIENT_ID=… GSC_CLIENT_SECRET=… GSC_REFRESH_TOKEN=… python scripts/tracker.py fetch --days 30
python scripts/tracker.py build
python -m http.server 8765 -d docs
```

## Limites de la donnée GSC

- Position moyenne pondérée par les impressions, pas un rang mesuré à un instant T.
- Un jour sans impression sur le couple mot-clé / page n'a pas de donnée : la courbe s'interrompt.
- Les 3 derniers jours sont provisoires et réécrits aux runs suivants.
- Seule la page suivie est comptée : si une autre URL du site ranke sur le mot-clé, elle n'apparaît pas.

## Confidentialité

Le repo et la page GitHub Pages sont publics (choix pour la phase de test). Les données clients sont donc visibles par quiconque a l'URL. Pour passer en production : repo privé + dashboard derrière une authentification (Cloudflare Pages + Cloudflare Access par exemple).
