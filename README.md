# Suivi de positions GSC

Outil datashake de suivi et de reporting SEO à partir de la Google Search Console. Une collecte tourne chaque matin dans GitHub Actions, historise la donnée dans le repo et régénère un dashboard statique publié sur GitHub Pages : https://analytics-ds.github.io/suivi-positions-gsc/

## Ce que fait le dashboard

- **Portefeuille** : tous les projets sur une ligne (santé, alertes, clics hors marque contre la période précédente et N-1, position, visibilité).
- **Vue d'ensemble d'un projet** : KPI avec comparaison à la période précédente et à N-1, courbes des mots-clés (8 au choix), trafic hors marque avec N-1, indice de visibilité, tableau filtrable par tag avec export CSV.
- **Détail d'un mot-clé** : position de la page suivie contre la position du site, superposition N-1, variantes, pages du site qui captent des impressions (détection de cannibalisation), appareils et pays, état d'indexation, événements, historique quotidien.
- **Alertes** : recul, sortie du top 3 ou du top 10, page disparue, chute d'impressions (en distinguant une baisse de la demande), autre page en tête, indexation, canonique, synchro en échec. Fil des changements sur 30 jours et mises à jour Google.
- **Actions** : journal des actions SEO avec mesure d'impact avant/après corrigée par un groupe témoin.
- **Opportunités** : potentiel en clics de chaque mot-clé suivi, suggestions de requêtes à suivre (top clics, positions 4 à 20, nouvelles requêtes), courbe de CTR du client.
- **Pages** : état d'indexation de chaque page suivie et toutes ses requêtes, 28 jours contre 28 jours précédents.
- **Rapport** : rapport mensuel imprimable en PDF, avec un commentaire construit à partir des chiffres.
- **Repères** sur les courbes : G = mise à jour de classement Google, A = action SEO.

## Saisir depuis le dashboard

Les boutons « Ajouter une action », « Suivre un mot-clé » et « Nouveau projet » ouvrent un formulaire GitHub (issue). À l'envoi, le workflow `issues.yml` vérifie que l'auteur est collaborateur du repo, écrit dans `config/`, recalcule ou relance la synchro, commente l'issue puis la ferme. Il faut un compte GitHub collaborateur du repo `analytics-ds/suivi-positions-gsc`.

On peut aussi éditer directement les fichiers :

- `config/sites.yaml` : les projets (propriété GSC, compte Google, référent, regex de marque).
- `config/keywords/<projet>.yaml` : les mots-clés, leur page, leurs variantes, tags et note.
- `config/actions/<projet>.yaml` : le journal des actions.

Un nouveau mot-clé ou un nouveau projet déclenche automatiquement la récupération de 16 mois d'historique. Un nouveau projet est pré-rempli avec ses 20 premières requêtes hors marque par clics.

## Connecter la Search Console

L'outil lit la GSC avec les droits d'un compte Google @datashake.fr, via OAuth. Aucun utilisateur n'est ajouté sur les propriétés clients (l'agence n'en a pas le droit).

- App OAuth : client « Application de bureau » du projet Google Cloud `ds-suivi-positions-gsc` (organisation datashake.fr, écran de consentement Interne, donc réservé aux comptes @datashake.fr et sans validation Google).
- Compte principal (`default`) : theo@datashake.fr. Seules les propriétés où le compte est déclaré sont accessibles.
- Secrets GitHub : `GSC_CLIENT_ID`, `GSC_CLIENT_SECRET`, `GSC_REFRESH_TOKEN`, plus `GSC_REFRESH_TOKEN_<COMPTE>` par compte supplémentaire.

Pour connecter un compte (le sien, pour suivre ses propres clients) :

```bash
pip install -r requirements.txt
python scripts/oauth_login.py chemin/vers/client_secret.json --label pierre --env-file chemin/vers/.claude/secrets/.env
```

Le navigateur s'ouvre, on se connecte, le script liste les propriétés accessibles et pose le secret `GSC_REFRESH_TOKEN_PIERRE`. Les projets de ce compte déclarent ensuite `account: pierre` dans `config/sites.yaml`. Sans `--label`, le script remplace le compte principal.

## Digest Slack (optionnel)

Avec un secret `SLACK_WEBHOOK_URL` (webhook entrant Slack), la synchro du matin poste les nouvelles alertes, et le lundi un récap de tous les projets. Sans ce secret, l'étape ne fait rien.

## Données et calculs

- `data/positions.csv` : couples mot-clé / page suivie, 16 mois.
- `data/keywords.csv` : mots-clés toutes pages confondues (position du site), 16 mois.
- `data/query_pages.csv` : toutes les pages qui reçoivent des impressions sur les mots-clés suivis, 90 jours.
- `data/site.csv` : totaux du site, de la marque et du hors marque, 16 mois.
- `data/extras/`, `data/inspection/`, `data/google_updates.json`, `data/status.json` : répartitions, requêtes par page, suggestions, inspection d'URL, mises à jour Google, statut de synchro.
- Courbe de CTR : calculée par position sur les mots-clés suivis du client (90 jours), sans courbe générique.
- Potentiel : impressions 28 jours × (CTR visé − CTR actuel), cible top 3, ou 1re place si déjà dans le top 3.
- Indice de visibilité : clics potentiels captés / clics potentiels en 1re position, sur l'univers suivi.
- Santé : 100 − 15 par alerte critique − 5 par alerte à surveiller.
- Impact d'une action : 28 jours avant contre 28 jours après (7 minimum), corrigé par la tendance des mots-clés non travaillés.

## Lancer en local

```bash
pip install -r requirements.txt
GSC_CLIENT_ID=… GSC_CLIENT_SECRET=… GSC_REFRESH_TOKEN=… python scripts/tracker.py fetch --days 10
python scripts/tracker.py build
python -m http.server 8765 -d docs
```

## Limites

- Position moyenne pondérée par les impressions, pas un rang mesuré à un instant T.
- Un jour sans impression n'a pas de donnée : la courbe s'interrompt.
- Les 3 derniers jours sont provisoires et réécrits aux runs suivants.
- Une part des clics vient de requêtes anonymisées par Google, invisibles dans le détail (la part est affichée en bas de la vue d'ensemble).
- Le contrôle du contenu des pages (catalogue, title) n'est pas possible depuis GitHub Actions sur les sites protégés contre les robots (Celio renvoie 403).

## Confidentialité

Le repo et la page GitHub Pages sont publics (phase de test). Pour passer en production : repo privé et dashboard derrière une authentification (Cloudflare Pages + Cloudflare Access par exemple).
