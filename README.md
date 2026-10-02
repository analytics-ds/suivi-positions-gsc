# Suivi de positions GSC

Outil datashake de suivi et de reporting SEO à partir de la Google Search Console. Une collecte tourne chaque matin dans GitHub Actions, historise la donnée dans le repo et régénère un dashboard statique publié sur GitHub Pages : https://analytics-ds.github.io/suivi-positions-gsc/

## Ce que fait le dashboard

- **Une seule définition de la position** : la position Google de la page suivie un jour donné, le jour de référence (dernier jour disponible, ou dernier jour consolidé si l'on décoche « Jours provisoires »). Sans impression ce jour-là, la dernière position connue dans les 7 jours est reprise et affichée en gris.
- **Barre du haut** : pays (déclarés par projet), période (7 j, 28 j, 3 mois, 12 mois, tout, dates au choix), comparaison (année précédente par défaut, période précédente, dates au choix, aucune), jours provisoires inclus ou non, recherche rapide ⌘K / Ctrl+K (projets, onglets, mots-clés).
- **Portefeuille** : un projet par ligne (alertes, clics hors marque 28 j et N-1, position moyenne, top 10).
- **Ordre des onglets** : Mots-clés (onglet d'arrivée d'un projet), Trafic du site, Actions, Opportunités, Rapport, et À traiter tout à droite (`#/<projet>/a-traiter`).
- **À traiter** : alertes et mouvements sur 7 jours, au dernier jour définitif. Alertes et mouvements utilisent la même variation (jour J contre J-7, 20 impressions minimum chacun des deux jours).
- **Mots-clés** : section repliable « Vue d'ensemble » en haut (plus fortes hausses et baisses, entrées et sorties du top 3 et du top 10, évolution de la position moyenne, de la visibilité, des clics ou de la répartition avec la période de comparaison, tableau par tag), variation au choix vs comparaison, 7 j ou 28 j. Puis le tableau (position du jour, variation vs comparaison, 7 j, 28 j, meilleure position, URL du jour, impressions sur 28 j, clics, clics à gagner, statut, objectif, tendance), filtre texte ou regex, filtres statut et tags, choix des colonnes, vues enregistrées, export CSV. Indicateurs recalculés sur les mots-clés filtrés. Graphique replié : répartition des positions dans le temps, ou courbes des mots-clés cochés. Vue « Par page » : indexation et requêtes de chaque page suivie.
- **Détail d'un mot-clé** : position du jour et variations, courbe page suivie, site et période de comparaison, URL du jour, pages qui captent le mot-clé, variantes, indexation, appareils et pays, historique jour par jour avec la page en tête.
- **Trafic du site** : clics hors marque, marque, total, impressions, contre la période de comparaison, par jour et par mois.
- **Actions** : journal des actions SEO avec mesure d'impact avant/après corrigée par un groupe témoin.
- **Opportunités** : clics à gagner des mots-clés suivis (vers leur objectif), suggestions de requêtes à suivre, sélection multiple pour les ajouter en une fois.
- **Rapport** : rapport mensuel figé sur son mois (positions au dernier jour du mois, alertes du mois), synthèse et prochaines étapes modifiables, blocs au choix, impression PDF.
- **Repères** sur les courbes : G = mise à jour de classement Google, A = action SEO.

## Saisir depuis le dashboard

Les boutons « Ajouter une action », « Suivre un mot-clé » et « Nouveau projet » ouvrent un formulaire GitHub (issue). À l'envoi, le workflow `issues.yml` vérifie que l'auteur est collaborateur du repo, écrit dans `config/`, recalcule ou relance la synchro, commente l'issue puis la ferme. Il faut un compte GitHub collaborateur du repo `analytics-ds/suivi-positions-gsc`.

Le formulaire « Suivre des mots-clés » accepte une liste (un mot-clé par ligne, « mot-clé | URL » pour fixer la page) ; tags, statut et objectif s'appliquent à toute la liste.

On peut aussi éditer directement les fichiers :

- `config/sites.yaml` : les projets (propriété GSC, compte Google, référent, regex de marque, pays suivis).
- `config/keywords/<projet>.yaml` : les mots-clés, leur page, leurs variantes, tags, statut (`à travailler`, `en cours`, `acquis`), objectif de position (`target`) et note.
- `config/actions/<projet>.yaml` : le journal des actions.

Un nouveau mot-clé, un nouveau projet ou un nouveau pays déclenche automatiquement la récupération de 16 mois d'historique. Un nouveau projet est pré-rempli avec ses 20 premières requêtes hors marque par clics.

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

Le navigateur s'ouvre, on se connecte, le script liste les propriétés accessibles et pose le secret `GSC_REFRESH_TOKEN_PIERRE`. Ensuite :

1. ajouter la ligne `GSC_REFRESH_TOKEN_PIERRE: ${{ secrets.GSC_REFRESH_TOKEN_PIERRE }}` dans les blocs `env` de `.github/workflows/daily.yml` et `issues.yml` (GitHub bloque les workflows qui reçoivent tous les secrets d'un coup, chaque secret doit donc être nommé) ;
2. déclarer `account: pierre` sur les projets de ce compte dans `config/sites.yaml`.

Sans `--label`, le script remplace le compte principal.

## Digest Slack (optionnel)

Avec un secret `SLACK_WEBHOOK_URL` (webhook entrant Slack), la synchro du matin poste les nouvelles alertes, et le lundi un récap de tous les projets. Sans ce secret, l'étape ne fait rien.

## Pays

Chaque projet peut déclarer ses pays dans `config/sites.yaml` (`countries: [fra, bel]` ou forme longue `{code: fra, label: France, path: /fr-fr/}`). La collecte tourne une fois par marché : « tous pays », puis chaque pays avec le filtre pays de la GSC. `path` limite en plus les totaux du site, la position « site » des mots-clés et les suggestions aux URL qui contiennent ce dossier. Le premier pays déclaré est celui affiché par défaut et celui du portefeuille et du digest Slack.

## Données et calculs

- `data/positions.csv` : couples mot-clé / page suivie, 16 mois, par marché (colonne `country`, `all` = tous pays).
- `data/keywords.csv` : mots-clés toutes pages confondues (position du site), 16 mois, par marché.
- `data/query_pages.csv` : toutes les pages qui reçoivent des impressions sur les mots-clés suivis, 90 jours, par marché.
- `data/site.csv` : totaux du site, de la marque et du hors marque, 16 mois, par marché.
- `data/extras/<projet>[.<pays>].json`, `data/inspection/`, `data/google_updates.json`, `data/status.json` : répartitions, requêtes par page, suggestions, inspection d'URL, mises à jour Google, statut de synchro.
- `docs/data/<projet>.json` (tous pays) et `docs/data/<projet>.<pays>.json` : tout le calculé d'un marché.
- Position : celle du jour (point quotidien de la GSC). Variations : jour J contre J-7, J-28 ou dernier jour de la période de comparaison.
- Alertes et mouvements : variation J contre J-7 au dernier jour définitif, 20 impressions minimum chacun des deux jours. Recul : 1 place si top 3, 2 si top 10, 3 sinon. Sortie du top 3 ou du top 10 : recul d'au moins 1 place. Les règles sont évaluées sur tout l'historique : le rapport d'un mois passé reprend les alertes de ce mois.
- Courbe de CTR : calculée par position sur les mots-clés suivis du client (90 jours), sans courbe générique.
- Clics à gagner : impressions du site sur 28 jours × (CTR à l'objectif − CTR à la position du jour). Objectif saisi, sinon top 3, ou 1re place si déjà dans le top 3.
- Indice de visibilité : clics potentiels captés au jour de référence / clics potentiels en 1re position, pondérés par les impressions sur 28 jours.
- Impact d'une action : 28 jours avant contre 28 jours après (7 minimum), en position moyenne et en clics, corrigé par la tendance des mots-clés non travaillés.

## Lancer en local

```bash
pip install -r requirements.txt
GSC_CLIENT_ID=… GSC_CLIENT_SECRET=… GSC_REFRESH_TOKEN=… python scripts/tracker.py fetch --days 10
python scripts/tracker.py build
python -m http.server 8765 -d docs
```

## Limites

- La GSC donne une position par jour, moyennée sur toutes les recherches de la journée : sur un mot-clé peu recherché, elle varie beaucoup d'un jour à l'autre.
- Un jour sans impression n'a pas de donnée : la courbe s'interrompt, la position du jour reprend la dernière connue (7 jours au plus).
- Les 2 à 3 derniers jours sont provisoires et réécrits aux runs suivants.
- Une part des clics vient de requêtes anonymisées par Google, invisibles dans le détail (la part est affichée sous le trafic).
- Pas de volume de recherche ni de relevé de SERP : l'outil n'utilise que la Search Console. La colonne « Impr./mois » donne la demande vue par la GSC.
- Les vues enregistrées, les colonnes choisies et les textes modifiés du rapport sont gardés dans le navigateur de chaque consultant.
- Le contrôle du contenu des pages (catalogue, title) n'est pas possible depuis GitHub Actions sur les sites protégés contre les robots (Celio renvoie 403).

## Confidentialité

Le repo et la page GitHub Pages sont publics (phase de test). Pour passer en production : repo privé et dashboard derrière une authentification (Cloudflare Pages + Cloudflare Access par exemple).
