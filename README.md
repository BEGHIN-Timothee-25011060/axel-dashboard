# 🎮 Tableau de bord — Axel

Tableau de bord public d'avancement et de contributions pour **Axel**, le jeu
développé sous Godot pour la game jam **Pixel en Provence** (thème : développement
durable). Page statique publiée sur **GitHub Pages**, alimentée par un collecteur
qui agrège les métriques du dépôt du jeu
[`BANTI-Hugo-25004176/Game-Jam`](https://github.com/BANTI-Hugo-25004176/Game-Jam).

➡️ **URL publique** : https://beghin-timothee-25011060.github.io/axel-dashboard/

> Adapté du tableau de bord multi-équipes de la SAÉ 2.01 (un projet Java). Comme
> Axel est **un seul dépôt de jeu Godot**, on garde la moitié « collaboration »
> (commits, lignes, PR, revues, issues, activité, podiums, badges) — qui s'applique
> telle quelle — et on remplace la moitié « qualité Java » (JaCoCo, PMD, Spotless,
> ArchUnit) par une section **jeu jouable** (export HTML5 automatique).

## Ce qui est affiché

- **Statistiques générales** : contributeurs actifs, commits, lignes écrites, PR
  mergées, revues, issues, jours actifs, part du travail le week-end / la nuit ;
- **🕹️ Le jeu** : la dernière version jouable (export HTML5 par la CI) et son statut de build ;
- **🏆 Podiums** : des classements ludiques et indicatifs (le hibou 🦉, le castor 🦫, …) ;
- **Classement des contributeurs** (login GitHub) : commits, lignes, PR ouvertes/mergées,
  revues données, issues, **part de contribution**, **voyant qualité de revue**
  (🟢 vraies revues / 🟡 léger / 🔴 tampon / ⚪ aucune) et des **badges** ;
- détail dépliable par contributeur : PR, parts par dimension, diagrammes d'activité.

> Les voyants et indicateurs collaboratifs sont des **repères heuristiques,
> indicatifs et non des notes**. Les chiffres bruts sont toujours affichés.

## Architecture

```
tools/collecte.py   -> interroge GitHub (gh) + clone le dépôt du jeu, écrit
                       site/data.json et historise dans history/history.jsonl
site/               -> page statique (index.html + style.css + app.js + data.json)
site/play/          -> export HTML5 du jeu (généré par la CI, non commité)
history/            -> instantanés (commit automatique du bot) pour les tendances
.github/workflows/build-dashboard.yml -> toutes les 30 min : collecte + export Godot -> Pages
```

Le dépôt du jeu est **public** : le collecteur n'a besoin que du `GITHUB_TOKEN`
par défaut (lecture des PR/issues/commits publics) pour fonctionner.

## Mise en place (une fois)

1. **GitHub Pages** : *Settings > Pages > Build and deployment > Source : GitHub Actions*.
2. (Optionnel) **Variable `DASHBOARD_ALIASES`** (*Settings > Secrets and variables >
   Actions > Variables*) : JSON `{"nom-git": "login-github"}` pour fusionner les
   identités d'un contributeur qui a commité avec un e-mail non rattaché à son
   compte GitHub. Un alias par défaut est déjà câblé dans `tools/collecte.py`.
3. Lancer le workflow **Build dashboard** une première fois (onglet *Actions > Run workflow*).

## Lancer en local

```bash
GH_TOKEN=$(gh auth token) python3 tools/collecte.py     # génère site/data.json
python3 -m http.server --directory site                 # http://localhost:8000
```

Options : `--repo OWNER/NAME` (cibler un autre dépôt), `--no-history`
(ne pas écrire l'historique).

## L'export du jeu

À chaque exécution, la CI récupère le code du jeu, installe Godot + les templates
d'export, force le rendu `gl_compatibility` (WebGL2, compatible navigateur —
Forward+/WebGPU passe mal sur le web) **sans threads** (GitHub Pages n'envoie pas
les en-têtes COOP/COEP) et exporte en HTML5 dans `site/play/`. L'étape est
**best-effort** : si elle échoue, le tableau de bord est tout de même publié et la
section « jeu » affiche le statut d'échec.

## Réglages

Les seuils du voyant qualité de revue (`SEUIL_VERT`, `SEUIL_ROUGE_TAMPON`) et les
alias d'identité (`ALIASES`) sont en tête de `tools/collecte.py`. La pondération de
la part de contribution (lignes 30 %, PR 30 %, issues 15 %, revues 15 %, en cours
10 %) est dans `CONTRIB_DIMS`, en tête de `site/app.js`.
