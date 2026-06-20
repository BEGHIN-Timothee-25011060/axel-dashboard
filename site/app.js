"use strict";

// Tableau de bord d'un depot unique (le jeu Axel). Adapte du tableau de bord
// multi-equipes de la SAE : on garde la vue « contributeurs » (commits, lignes,
// PR, revues, issues, activite, podiums, badges, part de contribution) et on
// ajoute une section « jeu jouable ».

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function relTime(iso) {
  if (!iso) return "n/d";
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (d < 1 / 24) return "à l'instant";
  if (d < 1) return "aujourd'hui";
  if (d < 2) return "hier";
  if (d < 30) return "il y a " + Math.floor(d) + " j";
  return "il y a " + Math.floor(d / 30) + " mois";
}

function bar(value, total, cls, medianPct) {
  const p = total ? Math.round(100 * value / total) : 0;
  const med = medianPct != null
    ? `<i class="mediane" style="left:${medianPct}%"></i>` : "";
  return `<div class="barre ${cls}"><span style="width:${p}%"></span>${med}</div>`;
}

// Petite sparkline des commits cumules d'un contributeur sur la duree du projet.
function sparkStudent(login) {
  const a = (window.__data && window.__data.activity) || {};
  const src = (a.by_student || {})[login];
  if (!src || !a.first_day || !a.last_day) return "";
  const jours = plageJours(a.first_day, a.last_day);
  if (jours.length < 2) return "";
  let cum = 0;
  const vals = jours.map(d => (cum += src.by_day[d] || 0));
  const max = Math.max(...vals, 1);
  const w = 90, h = 18, n = vals.length;
  const pts = vals.map((v, i) =>
    `${((i / (n - 1)) * w).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(" ");
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<polyline fill="none" stroke="#27ae60" stroke-width="1.5" points="${pts}"/></svg>`;
}

function voyantTip(c) {
  return `revues=${c.reviews_given} | substantielles=${c.substantial_reviews} | `
    + `changements demandés=${c.changes_requested} | approbations à vide=${c.empty_approvals}`;
}

let badgeCtx = null;

// Avatar GitHub d'un login (masqué proprement si le login n'est pas un vrai
// compte — cas d'un nom git de repli).
function avatar(login) {
  if (!login) return "";
  return `<img class="avatar" src="https://github.com/${encodeURIComponent(login)}.png?size=48"`
    + ` alt="" loading="lazy" onerror="this.style.display='none'">`;
}

function deltaBadge(n) {
  return n > 0 ? ` <span class="delta pos" title="depuis le dernier relevé">+${n}</span>` : "";
}

function render(data) {
  const r = data.repo || {};
  let meta = `Généré le ${new Date(data.generated_at).toLocaleString("fr-FR")} `
    + `— ${data.totals.contributors} contributeurs, ${data.totals.commits} commits, `
    + `${data.totals.prs_merged} PR mergées.`;
  const dc = data.trends && data.trends.delta && data.trends.delta.commits;
  if (dc > 0) meta += ` (+${dc} commits depuis le dernier relevé)`;
  document.getElementById("meta").textContent = meta;
  const fr = document.getElementById("footer-repo");
  if (fr && r.url) { fr.href = r.url; fr.textContent = r.full_name || r.name || "du jeu"; }

  badgeCtx = contexteBadges(data.students);
  startCountdown(data);
  renderAlertes(data);
  renderStats(data);
  renderJeu(data);
  renderCodebase(data);
  renderPodiums(data);
  renderFeed(data);
  renderContribs(data);
}

// --- compte à rebours + confettis ------------------------------------------
let cdTimer = null;
function startCountdown(data) {
  const el = document.getElementById("countdown");
  if (!el || !data.deadline) return;
  const fin = new Date(data.deadline).getTime();
  const boite = (v, l) => `<span class="cd-box"><b>${String(v).padStart(2, "0")}</b><small>${l}</small></span>`;
  let fete = false;
  const tick = () => {
    const apercu = typeof location !== "undefined" && /[?&]fini\b/.test(location.search);
    const ms = fin - Date.now();
    if (ms <= 0 || apercu) {
      el.innerHTML = `<div class="cd-haut"><span class="cd-fini">🎆 Projet rendu — bravo à toute l'équipe ! 🎮</span></div>`;
      el.hidden = false;
      if (cdTimer) { clearInterval(cdTimer); cdTimer = null; }
      if (!fete) { fete = true; lancerConfetti(); }
      return;
    }
    const s = Math.floor(ms / 1000);
    el.innerHTML = `<div class="cd-haut">`
      + `<span class="cd-lbl">⏳ Temps restant avant le rendu <small>(lun. 22/06 à 8 h 30)</small></span>`
      + `<span class="cd-boites">`
      + boite(Math.floor(s / 86400), "jours") + boite(Math.floor(s % 86400 / 3600), "heures")
      + boite(Math.floor(s % 3600 / 60), "min") + boite(s % 60, "s")
      + `</span></div>`;
    el.hidden = false;
  };
  if (cdTimer) clearInterval(cdTimer);
  cdTimer = setInterval(tick, 1000);
  tick();
}

function lancerConfetti() {
  const c = document.getElementById("confetti");
  if (!c || !c.getContext) return;
  const ctx = c.getContext("2d");
  const resize = () => { c.width = window.innerWidth; c.height = window.innerHeight; };
  resize(); window.addEventListener("resize", resize);
  c.style.display = "block";
  const cols = ["#1a5276", "#27ae60", "#e8a838", "#e74c3c", "#4a90d9"];
  const parts = Array.from({ length: 180 }, (_, i) => ({
    x: Math.random() * c.width, y: -20 - Math.random() * c.height,
    r: 4 + Math.random() * 7, vy: 2 + Math.random() * 4, vx: -2 + Math.random() * 4,
    col: cols[i % cols.length], rot: Math.random() * 6, vr: -0.2 + Math.random() * 0.4,
  }));
  let t = 0;
  const frame = () => {
    ctx.clearRect(0, 0, c.width, c.height);
    parts.forEach(p => {
      p.y += p.vy; p.x += p.vx; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.col; ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6); ctx.restore();
      if (p.y > c.height + 20) { p.y = -20; p.x = Math.random() * c.width; }
    });
    if (++t < 650) requestAnimationFrame(frame); else c.style.display = "none";
  };
  frame();
}

// --- points de vigilance ---------------------------------------------------
function renderAlertes(data) {
  const out = [];
  (data.students || []).forEach(s => (s.prs || []).forEach(p => {
    if (p.state === "OPEN" && (p.reviews || 0) === 0)
      out.push(`<span class="alerte warn" title="PR ouverte sans relecture">👀 PR #${p.number} sans revue — ${esc(s.login)}</span>`);
  }));
  const rc = data.recent_commits || [];
  if (rc.length) {
    const h = (Date.now() - new Date(rc[0].date).getTime()) / 3600000;
    if (h > 12) out.push(`<span class="alerte">⏰ aucun commit depuis ${Math.floor(h)} h</span>`);
  }
  if (data.game && data.game.build_status === "failed")
    out.push(`<span class="alerte danger">🛠️ l'export web du jeu a échoué</span>`);
  const sec = document.getElementById("alertes");
  if (out.length) {
    document.getElementById("alertes-contenu").innerHTML = out.join(" ");
    sec.hidden = false;
  } else { sec.hidden = true; }
}

// --- flux des derniers commits ---------------------------------------------
function renderFeed(data) {
  const ul = document.getElementById("feed"), sec = document.getElementById("feed-sec");
  const rc = data.recent_commits || [];
  if (!ul || !rc.length) { if (sec) sec.hidden = true; return; }
  sec.hidden = false;
  const repo = (data.repo && data.repo.url) || "";
  ul.innerHTML = rc.map(c => `<li class="feed-item">
    ${avatar(c.login)}
    <span class="feed-msg">${esc(c.message)}</span>
    <span class="feed-meta">${repo ? `<a class="pod-login" href="${esc(repo)}/commit/${esc(c.sha)}" target="_blank" rel="noopener">${esc(c.sha)}</a>` : esc(c.sha)} · ${esc(c.login)} · ${relTime(c.date)}</span>
  </li>`).join("");
}

// --- composition du code ---------------------------------------------------
function renderCodebase(data) {
  const cb = data.codebase, sec = document.getElementById("codebase-sec");
  const box = document.getElementById("codebase");
  if (!cb || !cb.by_ext || !cb.by_ext.length || !box) { if (sec) sec.hidden = true; return; }
  sec.hidden = false;
  const items = cb.by_ext.map(e => ({ label: e.label, value: e.lines,
    title: `${e.label} : ${e.lines} lignes, ${e.files} fichier(s)` }));
  const totalLines = items.reduce((a, b) => a + b.value, 0);
  const kb = Math.round((cb.assets.bytes || 0) / 1024);
  box.innerHTML = `<div class="chart"><h3>Lignes de code par type <small>(${totalLines.toLocaleString("fr-FR")} au total)</small></h3>`
    + `<div class="barchart">${barChart(items)}</div></div>`
    + `<div class="stats-kpi" style="margin-top:.8rem">`
    + skpi(totalLines.toLocaleString("fr-FR"), "lignes de code")
    + skpi((cb.assets.count || 0).toLocaleString("fr-FR"), "fichiers de ressources", "sprites, sons, polices…")
    + skpi(kb.toLocaleString("fr-FR") + " Ko", "poids des ressources")
    + `</div>`;
}

// --- section jeu jouable ---------------------------------------------------
function renderJeu(data) {
  const sec = document.getElementById("jeu-section");
  const box = document.getElementById("jeu");
  if (!sec || !box) return;
  sec.hidden = false;
  const g = data.game || {};
  const r = data.repo || {};
  const statut = g.build_status;
  const lienDepot = r.url
    ? `<a class="btn-jeu ghost" href="${esc(r.url)}" target="_blank" rel="noopener">↗ Dépôt GitHub</a>` : "";
  let badge, corps;
  if (statut === "success" && g.play_url) {
    badge = `<span class="badge ok">build à jour</span>`
      + (g.built_at ? `<small class="aide">exporté ${relTime(g.built_at)}</small>` : "");
    corps = `<div class="jeu-cadre"><iframe src="${esc(g.play_url)}" allow="autoplay; fullscreen; gamepad" allowfullscreen></iframe></div>`;
  } else if (statut === "failed") {
    badge = `<span class="badge ko">export en échec</span>`;
    corps = `<div class="jeu-indispo"><span class="gros">🛠️</span>
      <strong>L'export web a échoué au dernier build.</strong>
      <small>Le jeu reste jouable en le lançant depuis le dépôt. La CI réessaiera au prochain commit.</small></div>`;
  } else {
    badge = `<span class="badge nd">pas encore exporté</span>`;
    corps = `<div class="jeu-indispo"><span class="gros">🎮</span>
      <strong>La version jouable arrive bientôt.</strong>
      <small>Le jeu sera exporté en HTML5 par l'intégration continue dès la prochaine exécution.</small></div>`;
  }
  const lienJouer = (statut === "success" && g.play_url)
    ? `<a class="btn-jeu" href="${esc(g.play_url)}" target="_blank" rel="noopener">▶ Jouer en plein écran</a>` : "";
  box.innerHTML = `<div class="jeu-haut">
      <div class="jeu-statut">${badge}</div>
      <div class="jeu-liens">${lienJouer}${lienDepot}</div>
    </div>${corps}`;
}

// --- podiums « superlatifs » -----------------------------------------------
const PODIUMS = [
  { emoji: "🦉", nom: "Le hibou", desc: "le plus de commits la nuit (22 h–6 h)", unit: "commits",
    val: (s, a) => a ? [22, 23, 0, 1, 2, 3, 4, 5].reduce((x, h) => x + (a.by_hour[h] || 0), 0) : 0 },
  { emoji: "🦫", nom: "Le castor affairé", desc: "le plus de commits", unit: "commits",
    val: (s, a) => a ? a.total : 0 },
  { emoji: "🔍", nom: "L'œil de lynx", desc: "le plus de revues de code données", unit: "revues",
    val: s => s.reviews_given || 0 },
  { emoji: "🐓", nom: "Le coq matinal", desc: "le plus de commits tôt (6 h–9 h)", unit: "commits",
    val: (s, a) => a ? [6, 7, 8].reduce((x, h) => x + (a.by_hour[h] || 0), 0) : 0 },
  { emoji: "🐗", nom: "Le sanglier du week-end", desc: "le plus de commits le samedi/dimanche", unit: "commits",
    val: (s, a) => a ? (a.by_weekday[5] || 0) + (a.by_weekday[6] || 0) : 0 },
  { emoji: "🐜", nom: "La fourmi laborieuse", desc: "le plus d'issues fermées", unit: "issues",
    val: s => s.issues_closed || 0 },
  { emoji: "🐢", nom: "La tortue régulière", desc: "le plus de jours actifs distincts", unit: "jours",
    val: (s, a) => a ? Object.values(a.by_day).filter(v => v > 0).length : 0 },
  { emoji: "🧹", nom: "L'élagueur", desc: "le plus de lignes supprimées (nettoyage)", unit: "lignes",
    val: s => s.lines_deleted || 0 },
];
const POD_MEDS = ["🥇", "🥈", "🥉"];

function renderPodiums(data) {
  const grid = document.getElementById("podiums-grid");
  if (!grid) return;
  const acts = (data.activity && data.activity.by_student) || {};
  const students = data.students || [];
  grid.innerHTML = PODIUMS.map(p => {
    const top = students.map(s => ({ s, v: p.val(s, acts[s.login]) }))
      .filter(o => o.v > 0)
      .sort((a, b) => b.v - a.v || a.s.login.localeCompare(b.s.login))
      .slice(0, 3);
    const lignes = top.length
      ? top.map((o, i) => `<li><span class="pod-med">${POD_MEDS[i]}</span>`
          + `${avatar(o.s.login)}<span class="pod-login">${esc(o.s.login)}</span>`
          + `<span class="pod-val">${o.v} ${esc(p.unit)}</span></li>`).join("")
      : `<li class="pod-vide">Personne pour l'instant</li>`;
    return `<div class="podium"><div class="pod-titre"><span class="pod-emoji">${p.emoji}</span> ${esc(p.nom)}</div>`
      + `<div class="pod-desc">${esc(p.desc)}</div><ol class="pod-liste">${lignes}</ol></div>`;
  }).join("");
}

// --- statistiques generales ------------------------------------------------
const JOURS_SEM = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

function barChart(items, maxH = 120) {
  const max = Math.max(1, ...items.map(it => it.value || 0));
  const bars = items.map(it => {
    const v = it.value || 0;
    const h = v ? Math.max(2, Math.round(v / max * maxH)) : 0;
    return `<div class="bc-col ${it.cls || ""}" title="${esc(it.title || (it.label + " : " + v))}">`
      + `<span class="bc-v">${v || ""}</span>`
      + `<span class="bc-bar" style="height:${h}px"></span></div>`;
  }).join("");
  const labels = items.map(it => `<span class="bc-l ${it.cls || ""}">${esc(it.label)}</span>`).join("");
  return `<div class="bc-bars" style="height:${maxH + 18}px">${bars}</div>`
    + `<div class="bc-labels">${labels}</div>`;
}

function plageJours(d1, d2) {
  const out = [];
  for (let d = new Date(d1 + "T00:00:00Z"), fin = new Date(d2 + "T00:00:00Z");
       d <= fin; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function skpi(val, label, title) {
  return `<div class="skpi"${title ? ` title="${esc(title)}"` : ""}><b>${val}</b><small>${esc(label)}</small></div>`;
}

function renderStats(data) {
  const sec = document.getElementById("stats");
  const a = data.activity;
  if (!sec) return;
  if (!a || !a.total) { sec.hidden = true; return; }
  sec.hidden = false;
  const nf = n => (n || 0).toLocaleString("fr-FR");
  const t = data.totals;
  const nbJours = (a.first_day && a.last_day) ? plageJours(a.first_day, a.last_day).length
    : Object.keys(a.by_day).length;
  const joursActifs = Object.keys(a.by_day).filter(k => a.by_day[k] > 0).length;
  const weCommits = (a.by_weekday[5] || 0) + (a.by_weekday[6] || 0);
  const partWe = Math.round(100 * weCommits / a.total);
  const nuitCommits = a.by_hour.reduce((s, v, h) => s + ((h >= 22 || h < 6) ? v : 0), 0);
  const partNuit = Math.round(100 * nuitCommits / a.total);
  const pctRelues = t.prs_merged ? Math.round(100 * Math.min(t.prs_merged, t.reviews) / t.prs_merged) : null;
  document.getElementById("stats-kpi").innerHTML = [
    skpi(nf(t.contributors), "contributeurs actifs"),
    skpi(nf(a.total), "commits", "Total des commits horodatés (toutes branches, dédoublonnés)"),
    skpi(nf(t.lines_added + t.lines_deleted), "lignes écrites", "lignes ajoutées + supprimées"),
    skpi(nf(t.prs_merged), "PR mergées"),
    skpi(nf(t.reviews), "revues de code", "revues de pull request données"),
    skpi(`${t.issues_done} / ${t.issues_total}`, "issues fermées"),
    skpi(`${joursActifs} / ${nbJours}`, "jours actifs", "jours du projet avec au moins un commit"),
    skpi(`${partWe} %`, "le week-end", `${weCommits} commits le samedi ou le dimanche`),
    skpi(`${partNuit} %`, "la nuit", `${nuitCommits} commits entre 22 h et 6 h`),
  ].join("");
  document.getElementById("stats-charts").innerHTML = blocCharts(a);
  bindStatsToggle();
}

let statsToggleBound = false;
function bindStatsToggle() {
  if (statsToggleBound) return;
  statsToggleBound = true;
  const btn = document.getElementById("stats-toggle");
  const charts = document.getElementById("stats-charts");
  if (!btn || !charts) return;
  btn.hidden = false;
  btn.addEventListener("click", () => {
    charts.hidden = !charts.hidden;
    btn.setAttribute("aria-expanded", String(!charts.hidden));
    const ch = btn.querySelector(".chevron");
    if (ch) ch.textContent = charts.hidden ? "▶" : "▼";
  });
}

function chartJour(src) {
  const a = (window.__data && window.__data.activity) || {};
  const byDay = src.by_day || {};
  const jours = (a.first_day && a.last_day) ? plageJours(a.first_day, a.last_day)
    : Object.keys(byDay).sort();
  return barChart(jours.map(d => {
    const wd = (new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7;
    const [, mm, dd] = d.split("-");
    return { label: `${dd}/${mm}`, value: byDay[d] || 0, cls: wd >= 5 ? "we" : "",
             title: `${d} (${JOURS_SEM[wd]}) : ${byDay[d] || 0} commits` };
  }));
}

function chartSemaine(src) {
  const byWd = src.by_weekday || [];
  return barChart(JOURS_SEM.map((lbl, i) =>
    ({ label: lbl, value: byWd[i] || 0, cls: i >= 5 ? "we" : "" })));
}

function chartHeure(src) {
  const byHr = src.by_hour || [];
  return barChart(Array.from({ length: 24 }, (_, h) =>
    ({ label: String(h), value: byHr[h] || 0, cls: (h < 7 || h >= 20) ? "nuit" : "",
       title: `${h} h–${h + 1} h : ${byHr[h] || 0} commits` })));
}

function blocCharts(src) {
  if (!src || !src.total)
    return `<p class="aide">Aucune activité (commit) enregistrée sur la période.</p>`;
  return `<div class="charts">
    <div class="chart"><h3>Contributions par jour du projet</h3><div class="barchart">${chartJour(src)}</div></div>
    <div class="chart"><h3>Par jour de la semaine</h3><div class="barchart">${chartSemaine(src)}</div></div>
    <div class="chart"><h3>Par heure du jour</h3><div class="barchart">${chartHeure(src)}</div></div>
  </div>`;
}

function blocActivite(src, titre) {
  if (!src || !src.total) return "";
  return `<div class="frise-titre" style="margin-top:1rem">${esc(titre)} <small>${src.total} commits</small></div>`
    + blocCharts(src);
}

// --- part de contribution + facteur d'effort -------------------------------
const CONTRIB_DIMS = [
  { label: "lignes ajoutées", poids: 0.30, tot: "lines_added", val: s => s.lines_added || 0 },
  { label: "PR mergées", poids: 0.30, tot: "prs_merged", val: s => s.prs_merged || 0 },
  { label: "issues fermées", poids: 0.15, tot: "issues_closed", val: s => s.issues_closed || 0 },
  { label: "revues données", poids: 0.15, tot: "reviews_given", val: s => s.reviews_given || 0 },
  { label: "travail en cours", poids: 0.10, tot: "branch_commits", val: s => s.branch_commits || 0 },
];

function totauxEquipe(data) {
  const cs = data.students || [];
  const som = f => cs.reduce((a, c) => a + (f(c) || 0), 0);
  const actif = s => (s.commits + s.prs_merged + s.reviews_given + (s.branch_commits || 0)) > 0;
  return {
    lines: som(c => (c.lines_added || 0) + (c.lines_deleted || 0)),
    lines_added: som(c => c.lines_added),
    prs: som(c => (c.prs_open || 0) + (c.prs_merged || 0)),
    prs_merged: som(c => c.prs_merged),
    issues_closed: som(c => c.issues_closed),
    commits: som(c => c.commits),
    reviews_given: som(c => c.reviews_given),
    branch_commits: som(c => c.branch_commits),
    members: cs.filter(actif).length,
  };
}

function tauxContribution(s, tot) {
  if (!tot) return { taux: null, parts: [] };
  const actives = CONTRIB_DIMS.filter(d => (tot[d.tot] || 0) > 0);
  const sommePoids = actives.reduce((a, d) => a + d.poids, 0);
  if (!sommePoids) return { taux: null, parts: [] };
  let taux = 0;
  const parts = actives.map(d => {
    const poids = d.poids / sommePoids;
    const part = d.val(s) / tot[d.tot];
    const apport = poids * part;
    taux += apport;
    return { label: d.label, poids, part, apport };
  });
  return { taux, parts };
}

function facteurEffort(taux, n) {
  if (taux == null || !n) return null;
  return Math.min(1, taux * n);
}

function badgeFacteur(f) {
  if (f == null) return `<span class="badge nd">n/d</span>`;
  const cls = f >= 0.999 ? "plein" : "partiel";
  return `<span class="facteur ${cls}" title="Facteur d'effort applicable à la note">`
    + `<span class="facteur-jauge"><span style="width:${Math.round(f * 100)}%"></span></span>`
    + `${f.toFixed(2)}</span>`;
}

function tauxTip(parts) {
  if (!parts.length) return "Aucune dimension mesurable.";
  const lignes = parts.map(p =>
    `• ${p.label} : ${Math.round(p.part * 100)} % de l'équipe × poids ${Math.round(p.poids * 100)} % = ${Math.round(p.apport * 100)} pts`
  ).join("\n");
  return "D'où vient ce taux (somme des points = le taux) :\n" + lignes;
}

function partPct(v, total) { return total ? Math.round(100 * v / total) : 0; }

function kpiPart(label, valHtml, val, total) {
  const p = partPct(val, total);
  return `<div class="kpi part">
    <b>${valHtml}</b><small>${esc(label)}</small>
    <div class="barre part-barre"><span style="width:${p}%"></span></div>
    <small class="part-lbl">${total ? p + " % de l'équipe" : "n/d"}</small>
  </div>`;
}

// Equilibre du travail : entropie de Shannon normalisee des commits par membre.
function equilibre(data) {
  const xs = (data.students || []).map(s => s.commits || 0).filter(v => v > 0);
  const n = xs.length;
  if (n <= 1) return { balance: n ? 100 : null, members: n, active: n };
  const tot = xs.reduce((a, b) => a + b, 0);
  let H = 0;
  xs.forEach(v => { const p = v / tot; H -= p * Math.log(p); });
  return { balance: Math.round(100 * H / Math.log(n)), members: data.students.length, active: n };
}

// --- badges ----------------------------------------------------------------
function plusGrossePR(s) { return Math.max(0, ...((s.prs || []).map(p => p.additions || 0))); }
function nbPetitesPR(s) { return (s.prs || []).filter(p => p.merged && (p.additions || 0) <= 30).length; }

function contexteBadges(students) {
  const max = k => Math.max(0, ...students.map(s => s[k] || 0));
  const mediane = k => {
    const xs = students.map(s => s[k] || 0).sort((a, b) => a - b);
    const n = xs.length;
    return n ? (n % 2 ? xs[(n - 1) / 2] : (xs[n / 2 - 1] + xs[n / 2]) / 2) : 0;
  };
  return {
    commits: max("commits"), reviews_given: max("reviews_given"),
    prs_merged: max("prs_merged"), inline_comments: max("inline_comments"),
    reviews_received: max("reviews_received"), changes_requested: max("changes_requested"),
    grossePR: Math.max(0, ...students.map(plusGrossePR)),
    petitesPR: Math.max(0, ...students.map(nbPetitesPR)),
    med: {
      commits: mediane("commits"), prs_merged: mediane("prs_merged"),
      reviews_given: mediane("reviews_given"), reviews_received: mediane("reviews_received"),
      issues_closed: mediane("issues_closed"),
    },
  };
}

function badgesEtudiant(s, c) {
  const b = [];
  if (s.commits > 0 && s.commits === c.commits) b.push(["🏗️", "Bâtisseur : le plus de commits"]);
  if (s.reviews_given > 0 && s.reviews_given === c.reviews_given) b.push(["🔍", "La loupe : le plus de revues de code"]);
  if (s.prs_merged > 0 && s.prs_merged === c.prs_merged) b.push(["🚀", "Locomotive : le plus de PR mergées"]);
  if (s.inline_comments > 0 && s.inline_comments === c.inline_comments) b.push(["💬", "Bavard utile : le plus de commentaires de revue"]);
  if (s.reviews_received > 0 && s.reviews_received === c.reviews_received) b.push(["🌟", "La star : le code le plus relu par les autres"]);
  if (s.changes_requested > 0 && s.changes_requested === c.changes_requested) b.push(["🛡️", "Le gardien : le plus de changements demandés en revue"]);
  { const g = plusGrossePR(s); if (g > 0 && g === c.grossePR) b.push(["🐘", "L'éléphant : la plus grosse PR"]); }
  { const p = nbPetitesPR(s); if (p > 0 && p === c.petitesPR) b.push(["🐿️", "L'écureuil : le plus de toutes petites PR (≤ 30 lignes)"]); }
  if ((s.commits || 0) > c.med.commits && (s.prs_merged || 0) > c.med.prs_merged
      && (s.reviews_given || 0) > c.med.reviews_given && (s.issues_closed || 0) > c.med.issues_closed)
    b.push(["🐝", "Couteau suisse : au-dessus de la médiane sur le code, les PR, les revues et les issues"]);
  if (c.med.reviews_given > 0 && (s.reviews_given || 0) >= c.med.reviews_given
      && (s.reviews_received || 0) >= c.med.reviews_received
      && Math.abs((s.reviews_given || 0) - (s.reviews_received || 0)) <= 2)
    b.push(["🤝", "Fair-play : relit autant qu'il est relu, à un niveau soutenu"]);
  if (s.review_quality === "green" && s.changes_requested >= 1) b.push(["🧐", "Œil de lynx : vraies revues, demande des changements"]);
  if (s.review_quality === "red") b.push(["🦆", "Tampon : approbations à vide"]);
  if (s.taux != null && s.taux < 0.05) b.push(["👻", "Passager clandestin : moins de 5 % du travail de l'équipe"]);
  return b;
}

// --- tableau des contributeurs ---------------------------------------------
const ESTRING = new Set(["login"]);
const ETIEBREAK = ["prs_merged", "commits", "lines_added", "issues_closed"];
let currentESort = "prs_merged";

function compareStudents(a, b) {
  if (ESTRING.has(currentESort)) return String(a[currentESort]).localeCompare(String(b[currentESort]));
  for (const k of [currentESort, ...ETIEBREAK.filter(k => k !== currentESort)]) {
    const d = (b[k] || 0) - (a[k] || 0);
    if (d) return d;
  }
  return a.login.localeCompare(b.login);
}

function idEtudiant(login) { return "etu-" + String(login).replace(/[^a-zA-Z0-9_-]/g, "_"); }

function prListEtudiant(s) {
  const prs = s.prs || [];
  if (!prs.length) return `<p class="aide">Aucune pull request (ouverte ou mergée).</p>`;
  const rows = prs.map(p => {
    const etat = p.merged ? `<span class="badge ok">mergée</span>`
      : (p.state === "OPEN" ? `<span class="badge nd">ouverte</span>` : `<span class="badge ko">fermée</span>`);
    return `<tr>
      <td><a href="${esc(p.url)}" target="_blank" rel="noopener">#${p.number} ${esc(p.title)} ↗</a></td>
      <td class="num">${etat}</td>
      <td class="num diff"><span class="add">+${p.additions}</span> <span class="del">−${p.deletions}</span></td>
    </tr>`;
  }).join("");
  return `<table class="contribs prs">
    <thead><tr><th>Pull request</th><th class="num">État</th><th class="num">Lignes</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

function detailEtudiant(s, tot) {
  const add = s.lines_added || 0, del = s.lines_deleted || 0;
  const lignes = add + del;
  const prCount = (s.prs_open || 0) + (s.prs_merged || 0);
  const lignesHtml = `<span class="add">+${add}</span> <span class="del">−${del}</span>`;
  const { taux, parts } = tauxContribution(s, tot);
  const n = tot.members || 0;
  const f = facteurEffort(taux, n);
  const ideal = n ? Math.round(100 / n) : null;
  const tauxPct = taux == null ? "n/d" : Math.round(taux * 100) + " %";
  const synthese = `<div class="contrib-synth">
    <div class="cs-bloc">
      <div class="cs-titre">Taux de contribution</div>
      <div class="cs-val" title="${esc(tauxTip(parts))}">${tauxPct}</div>
      <div class="barre"><span style="width:${taux == null ? 0 : Math.round(taux * 100)}%"></span></div>
      <small class="aide">part du travail de l'équipe (survol = détail)</small>
    </div>
    <div class="cs-bloc">
      <div class="cs-titre">Facteur d'effort</div>
      <div class="cs-val">${badgeFacteur(f)}</div>
      <small class="aide">${ideal == null ? "effectif inconnu"
        : `part attendue ${ideal} % (équipe de ${n}) : atteinte → facteur 1, sinon proportionnel`}</small>
    </div>
  </div>`;
  return `<div class="panneau">
    ${synthese}
    <div class="qualite">
      ${kpiPart("lignes modifiées", lignesHtml, lignes, tot.lines)}
      ${kpiPart("PR ouvertes + mergées", String(prCount), prCount, tot.prs)}
      ${kpiPart("issues fermées", String(s.issues_closed || 0), s.issues_closed || 0, tot.issues_closed)}
      ${kpiPart("commits", String(s.commits || 0), s.commits || 0, tot.commits)}
      ${kpiPart("revues données", String(s.reviews_given || 0), s.reviews_given || 0, tot.reviews_given)}
    </div>
    <div class="frise-titre">Pull requests <small>${(s.prs || []).length}</small></div>
    ${prListEtudiant(s)}
    ${blocActivite((window.__data && window.__data.activity && window.__data.activity.by_student || {})[s.login],
      "Activité individuelle (commits)")}
  </div>`;
}

function renderContribs(data) {
  const corps = document.getElementById("contribs-corps");
  if (!corps) return;
  const tot = totauxEquipe(data);
  const students = [...(data.students || [])];
  const ctx = badgeCtx || contexteBadges(students);
  students.forEach(s => {
    s.taux = tauxContribution(s, tot).taux;
    s.facteur = facteurEffort(s.taux, tot.members);
  });
  // mediane du taux pour le repere sur la barre de contribution
  const tauxTries = students.map(s => s.taux).filter(v => v != null).sort((a, b) => a - b);
  const medTaux = tauxTries.length
    ? (tauxTries.length % 2 ? tauxTries[(tauxTries.length - 1) / 2]
        : (tauxTries[tauxTries.length / 2 - 1] + tauxTries[tauxTries.length / 2]) / 2) : null;
  students.sort(compareStudents);
  const trd = (data.trends && data.trends.per_student) || {};
  corps.innerHTML = "";
  if (!students.length) {
    corps.innerHTML = '<tr><td colspan="12">Aucun contributeur détecté.</td></tr>';
    return;
  }
  students.forEach((s, i) => {
    const dlt = trd[s.login] || {};
    const bs = badgesEtudiant(s, ctx)
      .map(([e, t]) => `<span class="badge-emoji" title="${esc(t)}">${e}</span>`).join(" ");
    const tauxCell = s.taux == null ? '<span class="badge nd">n/d</span>'
      : `${bar(Math.round(s.taux * 100), 100, "", medTaux != null ? Math.round(medTaux * 100) : null)}`
        + `<span class="barre-label">${Math.round(s.taux * 100)} %</span>`;
    const tr = document.createElement("tr");
    tr.className = "etudiant";
    tr.id = idEtudiant(s.login);
    tr.innerHTML = `
      <td class="rang"><span class="rang-badge">${i + 1}</span></td>
      <td class="login"><span class="chevron">▶</span>${avatar(s.login)}${esc(s.login)}${sparkStudent(s.login)}</td>
      <td class="num">${tauxCell}</td>
      <td class="num">${s.commits}${deltaBadge(dlt.commits)}</td>
      <td class="num">${(s.lines_added || 0).toLocaleString("fr-FR")}</td>
      <td class="num">${s.branch_commits ?? 0}</td>
      <td class="num">${s.prs_open}</td>
      <td class="num">${s.prs_merged}${deltaBadge(dlt.prs_merged)}</td>
      <td class="num">${s.reviews_given}</td>
      <td class="num">${s.issues_closed}/${s.issues_assigned}</td>
      <td class="num"><span class="pastille ${s.review_quality}" title="${esc(voyantTip(s))}"></span></td>
      <td class="badges">${bs || "—"}</td>`;
    const detail = document.createElement("tr");
    detail.className = "detail";
    detail.hidden = true;
    detail.innerHTML = `<td colspan="12">${detailEtudiant(s, tot)}</td>`;
    tr.addEventListener("click", e => {
      if (e.target.closest("a")) return;
      detail.hidden = !detail.hidden;
      tr.querySelector(".chevron").textContent = detail.hidden ? "▶" : "▼";
    });
    corps.appendChild(tr);
    corps.appendChild(detail);
  });
}

function bindTri() {
  document.querySelectorAll("th[data-esort]").forEach(th => {
    th.addEventListener("click", () => {
      currentESort = th.dataset.esort;
      renderContribs(window.__data);
    });
  });
}

fetch("data.json", { cache: "no-store" })
  .then(r => r.json())
  .then(data => { window.__data = data; render(data); bindTri(); })
  .catch(e => {
    document.getElementById("meta").textContent =
      "Erreur de chargement de data.json : " + e;
  });
