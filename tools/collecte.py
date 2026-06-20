#!/usr/bin/env python3
"""Collecte des metriques de contribution du depot du jeu (Game-Jam / Axel).

Adapte du tableau de bord de la SAE 2.01 (multi-equipes Java) vers un depot
unique de jeu Godot : on garde la moitie « collaboration » (commits, lignes,
PR, revues, issues, activite par jour/heure, badges) qui s'applique telle quelle,
on laisse tomber les portes qualite Java (JaCoCo/PMD/Spotless/ArchUnit) qui n'ont
pas de sens ici.

Sortie : site/data.json (consomme par site/app.js) + un instantane journalier
ajoute a history/history.jsonl (pour les tendances).

Sources :
  - clone git du depot cible -> commits (toutes branches), horodatage (heure de
    Paris), lignes ajoutees/supprimees par auteur, travail en cours (branches non
    mergees) ;
  - API GitHub via `gh` -> PR (etat, lignes, revues), issues, et surtout le
    mapping e-mail d'auteur -> login GitHub (fait foi).

Usage :
  GH_TOKEN=$(gh auth token) python3 tools/collecte.py
Options : --repo OWNER/NAME (defaut $DASHBOARD_REPO ou BANTI-Hugo-25004176/Game-Jam),
          --no-history (n'ecrit pas l'historique).
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
    PARIS = ZoneInfo("Europe/Paris")
except Exception:  # pragma: no cover - secours si tzdata absent
    PARIS = timezone.utc

RACINE = Path(__file__).resolve().parent.parent
SITE = RACINE / "site"
HISTORY = RACINE / "history"
DEFAUT_REPO = os.environ.get("DASHBOARD_REPO", "BANTI-Hugo-25004176/Game-Jam")

# Alias d'identite : certains commits sont faits avec un e-mail non rattache au
# compte GitHub de leur auteur, donc l'API ne peut pas les relier au bon login.
# On fusionne manuellement ces identites (nom git OU e-mail, en minuscules) vers
# le login GitHub canonique. Surchargeable via le secret/variable DASHBOARD_ALIASES
# (JSON {"cle": "login"}).
ALIASES = {
    "hugo-banti": "BANTI-Hugo-25004176",
    "hugo.banti@epitech.eu": "BANTI-Hugo-25004176",
}
try:
    ALIASES.update(json.loads(os.environ.get("DASHBOARD_ALIASES", "{}")))
except json.JSONDecodeError:
    pass

# Seuils du voyant « qualite de revue » (heuristique, pas une note). Une revue
# est « substantielle » si elle apporte un commentaire de fond ou demande des
# changements ; une approbation nue compte comme « tampon ».
SEUIL_VERT = 0.5          # >= 50 % de revues substantielles -> vert
SEUIL_ROUGE_TAMPON = 0.5  # >= 50 % d'approbations a vide -> rouge


def run(cmd, **kw):
    """Execute une commande et renvoie stdout (texte). Leve si code != 0."""
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", **kw)
    if res.returncode != 0:
        raise RuntimeError(f"echec {cmd!r}\n{res.stderr.strip()}")
    return res.stdout


def gh_json(args):
    """Appelle `gh` et parse la sortie JSON."""
    out = run(["gh", *args])
    return json.loads(out) if out.strip() else []


def gh_paginate(endpoint, jq=None):
    """Appelle l'API GitHub paginee. Renvoie une liste d'objets (jq par ligne)."""
    cmd = ["gh", "api", "--paginate", endpoint]
    if jq:
        cmd += ["--jq", jq]
    out = run(cmd)
    if not out.strip():
        return []
    if jq:
        return [json.loads(l) for l in out.splitlines() if l.strip()]
    # sans jq : --paginate concatene plusieurs tableaux JSON -> on tente un parse
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        objets = []
        for bloc in out.replace("][", "]\n[").splitlines():
            if bloc.strip():
                objets.extend(json.loads(bloc))
        return objets


# --------------------------------------------------------------------------
# 1. Activite git (commits, horodatage, lignes) depuis un clone
# --------------------------------------------------------------------------
def collecte_git(repo, tmp):
    """Clone le depot et extrait l'activite par auteur (e-mail)."""
    url = f"https://github.com/{repo}.git"
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if token:
        url = f"https://x-access-token:{token}@github.com/{repo}.git"
    chemin = Path(tmp) / "repo"
    print(f"clone {repo} ...", file=sys.stderr)
    run(["git", "clone", "--quiet", url, str(chemin)])

    def git(*a):
        return run(["git", "-C", str(chemin), *a])

    defaut = git("rev-parse", "--abbrev-ref", "HEAD").strip()

    # Commits de la branche par defaut (origin/<defaut>) : sert de reference pour
    # distinguer le « travail en cours » (commits hors de cette branche).
    shas_defaut = set(git("rev-list", f"origin/{defaut}").split())

    # Tous les commits, toutes branches distantes, dedoublonnes par SHA.
    # Format : SHA | e-mail | nom | date ISO (auteur) | branche par defaut ?
    fmt = "%H%x09%ae%x09%an%x09%aI"
    lignes = git("log", "--all", "--no-merges", f"--pretty=format:{fmt}").splitlines()

    par_email = defaultdict(lambda: {
        "name": "", "commits": 0, "branch_commits": 0,
        "by_day": defaultdict(int), "by_weekday": [0] * 7, "by_hour": [0] * 24,
    })
    activite_globale = {
        "total": 0, "by_day": defaultdict(int),
        "by_weekday": [0] * 7, "by_hour": [0] * 24,
        "first_day": None, "last_day": None,
    }
    vus = set()
    for ligne in lignes:
        if not ligne.strip():
            continue
        sha, email, nom, date_iso = ligne.split("\t", 3)
        if sha in vus:
            continue
        vus.add(sha)
        email = email.lower()
        d = par_email[email]
        d["name"] = d["name"] or nom
        try:
            dt = datetime.fromisoformat(date_iso).astimezone(PARIS)
        except ValueError:
            continue
        jour = dt.strftime("%Y-%m-%d")
        wd = dt.weekday()       # 0 = lundi
        hr = dt.hour
        d["commits"] += 1
        d["by_day"][jour] += 1
        d["by_weekday"][wd] += 1
        d["by_hour"][hr] += 1
        if sha not in shas_defaut:
            d["branch_commits"] += 1
        activite_globale["total"] += 1
        activite_globale["by_day"][jour] += 1
        activite_globale["by_weekday"][wd] += 1
        activite_globale["by_hour"][hr] += 1
        if not activite_globale["first_day"] or jour < activite_globale["first_day"]:
            activite_globale["first_day"] = jour
        if not activite_globale["last_day"] or jour > activite_globale["last_day"]:
            activite_globale["last_day"] = jour

    # Lignes ajoutees / supprimees par auteur (toutes branches, hors merges).
    lignes_stat = git("log", "--all", "--no-merges",
                      "--pretty=format:%H%x09%ae", "--numstat").splitlines()
    email_courant = None
    sha_courant = None
    vus_diff = set()
    for ligne in lignes_stat:
        if "\t" in ligne and ligne.count("\t") == 1 and len(ligne.split("\t")[0]) == 40:
            sha_courant, email_courant = ligne.split("\t", 1)
            email_courant = email_courant.lower()
            continue
        parts = ligne.split("\t")
        if len(parts) == 3 and email_courant and sha_courant not in vus_diff:
            add, dele, _ = parts
            if add.isdigit():
                par_email[email_courant].setdefault("lines_added", 0)
                par_email[email_courant]["lines_added"] += int(add)
            if dele.isdigit():
                par_email[email_courant].setdefault("lines_deleted", 0)
                par_email[email_courant]["lines_deleted"] += int(dele)
    # le marqueur de SHA n'est ecrit qu'une fois par commit -> pas de double compte

    return par_email, activite_globale, defaut


# --------------------------------------------------------------------------
# 2. Mapping e-mail -> login GitHub (l'API fait foi)
# --------------------------------------------------------------------------
def mapping_logins(repo):
    """Renvoie {email_minuscule: login} d'apres les commits attribues par GitHub."""
    commits = gh_paginate(
        f"repos/{repo}/commits",
        jq=".[] | {email: .commit.author.email, login: (.author.login // null)}",
    )
    m = {}
    for c in commits:
        email = (c.get("email") or "").lower()
        login = c.get("login")
        if email and login and email not in m:
            m[email] = login
    return m


# --------------------------------------------------------------------------
# 3. Pull requests + revues
# --------------------------------------------------------------------------
def collecte_prs(repo):
    """Renvoie (par_login_pr, prs_par_login) : compteurs PR + revues par login."""
    prs = gh_json([
        "pr", "list", "--repo", repo, "--state", "all", "--limit", "300",
        "--json", "number,title,url,state,author,additions,deletions,reviews,mergedAt",
    ])
    par_login = defaultdict(lambda: {
        "prs_open": 0, "prs_merged": 0, "reviews_given": 0, "reviews_received": 0,
        "inline_comments": 0, "changes_requested": 0, "empty_approvals": 0,
        "substantial_reviews": 0, "prs": [],
    })
    for pr in prs:
        auteur = (pr.get("author") or {}).get("login")
        if not auteur:
            continue
        merged = pr.get("state") == "MERGED"
        d = par_login[auteur]
        if merged:
            d["prs_merged"] += 1
        elif pr.get("state") == "OPEN":
            d["prs_open"] += 1
        d["prs"].append({
            "number": pr["number"], "title": pr.get("title", ""),
            "url": pr.get("url", ""), "state": pr.get("state"),
            "merged": merged, "additions": pr.get("additions", 0),
            "deletions": pr.get("deletions", 0),
        })
        # Revues de cette PR : donnees par les relecteurs, recues par l'auteur.
        relecteurs_substantiels = set()
        for rev in pr.get("reviews", []):
            relog = (rev.get("author") or {}).get("login")
            if not relog or relog == auteur:
                continue
            etat = rev.get("state")
            corps = (rev.get("body") or "").strip()
            r = par_login[relog]
            r["reviews_given"] += 1
            d["reviews_received"] += 1
            substantielle = bool(corps) or etat == "CHANGES_REQUESTED"
            if etat == "CHANGES_REQUESTED":
                r["changes_requested"] += 1
            if corps:
                r["inline_comments"] += 1
            if etat == "APPROVED" and not corps:
                r["empty_approvals"] += 1
            if substantielle:
                r["substantial_reviews"] += 1
            relecteurs_substantiels.add(relog)
    return par_login


# --------------------------------------------------------------------------
# 4. Issues (fermees / assignees par login)
# --------------------------------------------------------------------------
def collecte_issues(repo):
    issues = gh_json([
        "issue", "list", "--repo", repo, "--state", "all", "--limit", "300",
        "--json", "number,state,assignees",
    ])
    closed = defaultdict(int)
    assigned = defaultdict(int)
    total = 0
    done = 0
    for it in issues:
        total += 1
        ferme = it.get("state") == "CLOSED"
        if ferme:
            done += 1
        for a in it.get("assignees", []):
            login = a.get("login")
            if not login:
                continue
            assigned[login] += 1
            if ferme:
                closed[login] += 1
    return closed, assigned, total, done


# --------------------------------------------------------------------------
# 5. Voyant qualite de revue (par login)
# --------------------------------------------------------------------------
def voyant_revue(s):
    n = s.get("reviews_given", 0)
    if n == 0:
        return "na"
    sub = s.get("substantial_reviews", 0)
    vides = s.get("empty_approvals", 0)
    if sub / n >= SEUIL_VERT:
        return "green"
    if vides / n >= SEUIL_ROUGE_TAMPON:
        return "red"
    return "yellow"


# --------------------------------------------------------------------------
# Assemblage
# --------------------------------------------------------------------------
def fusionne(repo, no_history):
    with tempfile.TemporaryDirectory() as tmp:
        par_email, activite, defaut = collecte_git(repo, tmp)
    email2login = mapping_logins(repo)
    pr_data = collecte_prs(repo)
    iss_closed, iss_assigned, iss_total, iss_done = collecte_issues(repo)

    # Regroupe l'activite git (par e-mail) sous le login GitHub.
    par_login = defaultdict(lambda: {
        "commits": 0, "branch_commits": 0, "lines_added": 0, "lines_deleted": 0,
        "name": "", "by_day": defaultdict(int),
        "by_weekday": [0] * 7, "by_hour": [0] * 24,
    })
    act_par_login = {}
    inconnus = defaultdict(int)
    for email, d in par_email.items():
        login = email2login.get(email)
        if not login:
            # e-mail non rattache a un compte GitHub : on tente un alias manuel
            # (par e-mail puis par nom git), sinon on retombe sur le nom lisible.
            login = (ALIASES.get(email) or ALIASES.get((d["name"] or "").lower()))
            if not login:
                inconnus[d["name"] or email] += d["commits"]
                login = d["name"] or email   # fallback lisible
        p = par_login[login]
        p["name"] = p["name"] or d["name"]
        p["commits"] += d["commits"]
        p["branch_commits"] += d["branch_commits"]
        p["lines_added"] += d.get("lines_added", 0)
        p["lines_deleted"] += d.get("lines_deleted", 0)
        for k, v in d["by_day"].items():
            p["by_day"][k] += v
        for i in range(7):
            p["by_weekday"][i] += d["by_weekday"][i]
        for i in range(24):
            p["by_hour"][i] += d["by_hour"][i]

    # Construit la liste des etudiants en fusionnant toutes les sources.
    logins = set(par_login) | set(pr_data) | set(iss_assigned) | set(iss_closed)
    students = []
    activite_by_student = {}
    for login in logins:
        g = par_login.get(login, {})
        pr = pr_data.get(login, {})
        s = {
            "login": login,
            "name": g.get("name", ""),
            "commits": g.get("commits", 0),
            "branch_commits": g.get("branch_commits", 0),
            "lines_added": g.get("lines_added", 0),
            "lines_deleted": g.get("lines_deleted", 0),
            "prs_open": pr.get("prs_open", 0),
            "prs_merged": pr.get("prs_merged", 0),
            "reviews_given": pr.get("reviews_given", 0),
            "reviews_received": pr.get("reviews_received", 0),
            "inline_comments": pr.get("inline_comments", 0),
            "changes_requested": pr.get("changes_requested", 0),
            "empty_approvals": pr.get("empty_approvals", 0),
            "substantial_reviews": pr.get("substantial_reviews", 0),
            "issues_closed": iss_closed.get(login, 0),
            "issues_assigned": iss_assigned.get(login, 0),
            "prs": sorted(pr.get("prs", []), key=lambda x: -x["number"]),
        }
        s["review_quality"] = voyant_revue(s)
        students.append(s)
        if g.get("commits"):
            activite_by_student[login] = {
                "total": g["commits"],
                "by_day": dict(g["by_day"]),
                "by_weekday": g["by_weekday"],
                "by_hour": g["by_hour"],
            }

    students.sort(key=lambda s: (-s["prs_merged"], -s["commits"], s["login"]))

    # « Contributeurs actifs » = toute personne ayant une trace de travail (commits,
    # PR, revues ou issues). Plus juste que de ne compter que les auteurs de commits :
    # l'attribution commit->login cote GitHub peut rater un commit isole, et un
    # relecteur sans commit reste un contributeur.
    def actif(s):
        return bool(s["commits"] or s["branch_commits"] or s["prs_open"]
                    or s["prs_merged"] or s["reviews_given"] or s["issues_closed"])
    nb_contributeurs = sum(1 for s in students if actif(s))

    repo_info = gh_json([
        "repo", "view", repo, "--json", "name,url,description,defaultBranchRef",
    ])

    data = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "repo": {
            "name": repo_info.get("name", repo),
            "full_name": repo,
            "url": repo_info.get("url", f"https://github.com/{repo}"),
            "description": repo_info.get("description", ""),
            "default_branch": defaut,
        },
        "totals": {
            "commits": activite["total"],
            "contributors": nb_contributeurs,
            "prs_merged": sum(s["prs_merged"] for s in students),
            "prs_open": sum(s["prs_open"] for s in students),
            "reviews": sum(s["reviews_given"] for s in students),
            "lines_added": sum(s["lines_added"] for s in students),
            "lines_deleted": sum(s["lines_deleted"] for s in students),
            "issues_total": iss_total,
            "issues_done": iss_done,
        },
        "activity": {
            "total": activite["total"],
            "first_day": activite["first_day"],
            "last_day": activite["last_day"],
            "by_day": dict(activite["by_day"]),
            "by_weekday": activite["by_weekday"],
            "by_hour": activite["by_hour"],
            "by_student": activite_by_student,
        },
        "students": students,
        # Section jeu : remplie par le workflow apres l'export Godot (statut, lien
        # jouable). Valeurs par defaut tant que rien n'est construit.
        "game": {
            "build_status": None,
            "play_url": None,
            "built_at": None,
        },
    }
    if inconnus:
        data["unmapped_authors"] = dict(inconnus)

    SITE.mkdir(parents=True, exist_ok=True)
    (SITE / "data.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"site/data.json ecrit : {len(students)} contributeurs, "
          f"{activite['total']} commits.", file=sys.stderr)

    if not no_history:
        ecrire_history(data)

    return data


def ecrire_history(data):
    """Ajoute un instantane compact a history/history.jsonl (1 / jour, dedup)."""
    HISTORY.mkdir(parents=True, exist_ok=True)
    fichier = HISTORY / "history.jsonl"
    jour = datetime.now(PARIS).strftime("%Y-%m-%d")
    snap = {
        "day": jour,
        "ts": data["generated_at"],
        "commits": data["totals"]["commits"],
        "prs_merged": data["totals"]["prs_merged"],
        "issues_done": data["totals"]["issues_done"],
        "per_student": {
            s["login"]: {"commits": s["commits"], "prs_merged": s["prs_merged"]}
            for s in data["students"]
        },
    }
    lignes = []
    if fichier.exists():
        lignes = [l for l in fichier.read_text(encoding="utf-8").splitlines() if l.strip()]
    # remplace l'instantane du jour s'il existe deja (garde le plus recent)
    lignes = [l for l in lignes if json.loads(l).get("day") != jour]
    lignes.append(json.dumps(snap, ensure_ascii=False))
    fichier.write_text("\n".join(lignes) + "\n", encoding="utf-8")
    print(f"history : instantane {jour} enregistre.", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser(description="Collecte des metriques du depot du jeu.")
    ap.add_argument("--repo", default=DEFAUT_REPO, help="OWNER/NAME du depot cible")
    ap.add_argument("--no-history", action="store_true", help="n'ecrit pas l'historique")
    args = ap.parse_args()
    try:
        fusionne(args.repo, args.no_history)
    except Exception as e:  # message lisible plutot qu'une trace brute
        print(f"ERREUR : {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
