"use strict";
// Suivi de positions datashake : application statique (GitHub Pages) qui lit docs/data/*.json.

const REPO = "analytics-ds/suivi-positions-gsc";
const GH = "https://github.com/" + REPO;
// Palette catégorielle validée (ordre fixe par mot-clé sélectionné, jamais cyclée sur le rang).
const PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const MAX_SEL = 8, NEUTRAL = "#9A9A9A", INK = "#101010", MUTED = "rgba(16,16,16,0.5)", GRID = "#F0F0EF", N1 = "#B9B9B9";
const EXT = '<svg class="i" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
const VIEWS = [["", "Vue d'ensemble"], ["alertes", "Alertes"], ["actions", "Actions"], ["opportunites", "Opportunités"], ["pages", "Pages"], ["rapport", "Rapport"]];
const TYPES = { baisse: "Recul", top3: "Sortie du top 3", top10: "Sortie du top 10", hausse: "Progression", disparue: "Page disparue",
  impressions: "Impressions", page: "Changement de page", indexation: "Indexation", canonical: "Canonique", synchro: "Synchro", inspection: "Inspection" };
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

const fmt = n => n == null || !isFinite(n) ? "–" : Math.round(n).toLocaleString("fr-FR");
const fmt1 = n => n == null || !isFinite(n) ? "–" : n.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtDate = d => new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const fmtDateL = d => new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const shift = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const path = u => { if (!u || u === "*") return "Toutes pages"; try { const x = new URL(u); return x.pathname + x.search; } catch { return u; } };
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (a, b) => b ? (a - b) / b * 100 : null;
const $ = id => document.getElementById(id);
const issue = (template, params) => `${GH}/issues/new?template=${template}&` + new URLSearchParams(params).toString();

let IDX = null, P = null, route = { site: null, view: "" };
const cache = {}, charts = {};
const ui = { days: 28, metric: "position", sel: {}, sort: { key: "impr", dir: -1 }, query: "", tags: new Set(), openKw: null,
  n1: false, feed: "all", sug: "all", month: null };

Chart.defaults.font.family = "Inter, -apple-system, sans-serif";
Chart.defaults.font.size = 12;
Chart.defaults.color = MUTED;

// Repères verticaux (mises à jour Google, actions) dessinés sur les graphiques temporels
Chart.register({
  id: "marks",
  afterDatasetsDraw(chart, args, opts) {
    const items = opts && opts.items || [];
    if (!items.length) return;
    const { ctx, chartArea: a, scales: { x } } = chart;
    ctx.save();
    items.forEach(m => {
      const px = x.getPixelForValue(m.idx);
      if (px < a.left - 1 || px > a.right + 1) return;
      ctx.strokeStyle = m.kind === "a" ? "rgba(16,16,16,0.55)" : "rgba(120,120,120,0.5)";
      ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = m.kind === "a" ? INK : "#8a8a8a";
      ctx.fillRect(px - 6, a.top - 1, 12, 12);
      ctx.fillStyle = "#fff"; ctx.font = "700 8px Inter, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(m.kind === "a" ? "A" : "G", px, a.top + 5);
    });
    ctx.restore();
  },
});

// ---------------------------------------------------------------- chargement & routage

async function load() {
  IDX = await (await fetch("data/index.json?v=" + Date.now())).json();
  bindChrome();
  window.addEventListener("hashchange", onRoute);
  onRoute();
}

async function project(name) {
  if (!cache[name]) {
    const p = await (await fetch(`data/${name}.json?v=` + Date.now())).json();
    p.keywords.forEach(k => { k.map = new Map(k.s.map(x => [x[0], x])); k.smap = new Map(k.ss.map(x => [x[0], x])); });
    p.seg = {};
    Object.entries(p.segments).forEach(([s, rows]) => p.seg[s] = new Map(rows.map(x => [x[0], x])));
    p.vis = new Map(p.visibility.map(x => [x[0], x[1]]));
    p.dates = p.segments.total.map(x => x[0]);
    if (!p.dates.length) p.dates = [...new Set(p.keywords.flatMap(k => k.s.map(x => x[0])))].sort();
    cache[name] = p;
  }
  return cache[name];
}

async function onRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const site = parts[0] || null, view = parts[1] || "";
  closeDrawer(true);
  $("app").classList.remove("nav-open");
  if (site !== route.site) { ui.openKw = null; ui.tags.clear(); ui.query = ""; ui.month = null; }
  route = { site, view };
  Object.values(charts).forEach(c => c.destroy());
  for (const k in charts) delete charts[k];
  if (site) {
    $("view").innerHTML = '<div class="loading">Chargement…</div>';
    try { P = await project(site); } catch { $("view").innerHTML = '<div class="empty">Projet introuvable.</div>'; return; }
  } else P = null;
  renderChrome();
  if (!P) return renderPortfolio();
  ({ "": renderOverview, alertes: renderAlerts, actions: renderActions, opportunites: renderOpps, pages: renderPages, rapport: renderReport }[view] || renderOverview)();
  window.scrollTo(0, 0);
}

function bindChrome() {
  $("menu-btn").onclick = () => $("app").classList.toggle("nav-open");
  $("scrim").onclick = () => closeDrawer();
  document.addEventListener("keydown", e => e.key === "Escape" && closeDrawer());
  document.querySelectorAll("#period button").forEach(b => b.onclick = () => {
    document.querySelectorAll("#period button").forEach(x => x.classList.toggle("active", x === b));
    ui.days = +b.dataset.days; renderOverview();
  });
  $("lnk-project").href = issue("projet.yml", { title: "Projet : " });
  $("lnk-sync").href = `${GH}/actions/workflows/daily.yml`;
  $("lnk-doc").href = `${GH}#readme`;
}

function renderChrome() {
  const sev = p => p.alerts.critique ? "ko" : p.alerts.attention ? "warn" : "ok";
  $("projects").innerHTML = IDX.projects.map(p => `<a href="#/${p.name}" class="${route.site === p.name ? "active" : ""}">
    <span class="avatar">${esc(p.label[0].toUpperCase())}</span>${esc(p.label)}
    <span class="count ${sev(p)}" title="Alertes critiques + à surveiller">${p.alerts.critique + p.alerts.attention}</span></a>`).join("");
  $("nav-portfolio").classList.toggle("active", !route.site);
  const site = route.site || "";
  $("lnk-action").href = issue("action.yml", { projet: site, title: "Action : " });
  $("lnk-kw").href = issue("mot-cle.yml", { projet: site, title: "Mot-clé : " });

  // Statut de synchro réel : le pire des projets
  const today = new Date().toISOString().slice(0, 10);
  const states = IDX.projects.map(p => {
    const late = p.last_date ? (Date.parse(today) - Date.parse(p.last_date)) / 864e5 : 99;
    return { p, ko: p.status && p.status.ok === false, late };
  });
  const worst = states.find(s => s.ko) || states.find(s => s.late > 4);
  const gen = new Date(IDX.generated_at).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const last = states.map(s => s.p.last_date).filter(Boolean).sort().pop();
  $("sync").innerHTML = `<div class="sync"><span class="dot ${worst ? "ko" : "ok"}"></span>${worst ? "Synchro en échec" : "Search Console à jour"}</div>
    <div>Calculé le ${gen}</div><div>Données jusqu'au ${last ? fmtDate(last) : "–"}</div>
    ${worst ? `<div style="color:var(--status-ko);margin-top:4px">${esc(worst.p.label)} : ${esc(worst.ko ? worst.p.status.error : "pas de donnée depuis " + worst.late + " jours")}</div>` : ""}`;

  const crumbs = $("crumbs");
  if (!P) { crumbs.innerHTML = "Portefeuille"; $("chip-prop").hidden = true; $("subnav").hidden = true; $("period").hidden = true; document.title = "Portefeuille · Positions · datashake"; return; }
  const vlabel = (VIEWS.find(v => v[0] === route.view) || VIEWS[0])[1];
  crumbs.innerHTML = `<span>${esc(P.label)}</span><span class="sep">/</span><span class="muted">${vlabel}</span>`;
  $("chip-prop").hidden = false; $("chip-prop").textContent = P.property;
  $("period").hidden = route.view !== "";
  const nAlerts = P.alerts.length;
  $("subnav").hidden = false;
  $("subnav").innerHTML = VIEWS.map(([v, l]) => `<a href="#/${P.name}${v ? "/" + v : ""}" class="${route.view === v ? "active" : ""}">${l}${
    v === "alertes" && nAlerts ? ` <span class="badge ${P.alerts.some(a => a.severity === "critique") ? "ko" : "warn"}">${nAlerts}</span>` : ""}${
    v === "actions" && P.actions.length ? ` <span class="badge">${P.actions.length}</span>` : ""}</a>`).join("");
  document.title = `${P.label} · ${vlabel} · Positions`;
}

// ---------------------------------------------------------------- calculs côté client

function periodDates() {
  const all = P.dates, n = ui.days;
  const dates = n ? all.slice(-n) : all;
  const prev = n ? all.slice(-2 * n, -n) : [];
  return { dates, prev, n1: dates.map(d => shift(d, -364)) };
}

function kstats(k, dates, src = "map") {
  const m = k[src];
  const pts = dates.map(d => m.get(d) || null), present = pts.filter(Boolean);
  const clicks = present.reduce((a, p) => a + p[2], 0), impr = present.reduce((a, p) => a + p[3], 0);
  const wpos = impr ? present.reduce((a, p) => a + p[1] * p[3], 0) / impr : null;
  const first = present[0] || null, last = present[present.length - 1] || null;
  const delta = first && last && first !== last ? +(first[1] - last[1]).toFixed(1) : null; // positif = gain de places
  const best = present.length ? Math.min(...present.map(p => p[1])) : null;
  return { pts, present, clicks, impr, wpos, first, last, delta, best, ctr: impr ? clicks / impr * 100 : null };
}

function segSum(seg, dates) {
  const m = P.seg[seg]; let c = 0, i = 0, pw = 0, n = 0;
  dates.forEach(d => { const x = m && m.get(d); if (x) { c += x[2]; i += x[3]; pw += x[1] * x[3]; n++; } });
  return { clicks: c, impr: i, pos: i ? pw / i : null, n };
}

function visAvg(dates) {
  const xs = dates.map(d => P.vis.get(d)).filter(v => v != null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function trackedSum(dates) {
  let c = 0, i = 0, pw = 0;
  P.keywords.forEach(k => dates.forEach(d => { const x = k.map.get(d); if (x) { c += x[2]; i += x[3]; pw += x[1] * x[3]; } }));
  return { clicks: c, impr: i, pos: i ? pw / i : null };
}

// Au-delà de 3 mois, regroupement par semaine (position pondérée, clics et impressions additionnés)
function bucket(pts, dates) {
  if (dates.length <= 92) return { labels: dates.map(fmtDate), ranges: dates.map(d => [d, d]), pts };
  const labels = [], ranges = [], out = [];
  for (let end = dates.length; end > 0; end -= 7) {
    const a = Math.max(0, end - 7), chunk = pts.slice(a, end).filter(Boolean);
    labels.unshift("sem. du " + fmtDate(dates[a])); ranges.unshift([dates[a], dates[end - 1]]);
    if (!chunk.length) { out.unshift(null); continue; }
    const i = chunk.reduce((s, p) => s + p[3], 0), c = chunk.reduce((s, p) => s + p[2], 0);
    out.unshift([dates[a], i ? +(chunk.reduce((s, p) => s + p[1] * p[3], 0) / i).toFixed(1) : chunk[0][1], c, i, chunk.some(p => p[4]) ? 1 : 0]);
  }
  return { labels, ranges, pts: out };
}

function marksFor(ranges, opts = {}) {
  const items = [], legend = [];
  const find = d => ranges.findIndex(r => r[0] <= d && d <= r[1]);
  // Repères : mises à jour de classement de la recherche web uniquement (pas les incidents techniques ni Discover)
  (IDX.google_updates || []).filter(isRankingUpdate).forEach(u => { const idx = find(u.begin); if (idx >= 0) { items.push({ idx, kind: "g" }); legend.push(`<span><span class="mk g">G</span>${fmtDate(u.begin)} · <a href="${esc(u.url)}" target="_blank" rel="noopener">${esc(u.title)}</a></span>`); } });
  (P.actions || []).filter(a => !opts.page || norm(a.page) === norm(opts.page)).forEach(a => {
    const idx = find(a.date); if (idx >= 0) { items.push({ idx, kind: "a" }); legend.push(`<span><span class="mk a">A</span>${fmtDate(a.date)} · ${esc(a.title)}</span>`); }
  });
  return { items, html: legend.length ? `<div class="marks">${legend.join("")}</div>` : "" };
}
const norm = u => (u || "").replace(/\/$/, "");
const isRankingUpdate = u => (u.service ? u.service === "Ranking" : /update/i.test(u.title)) && !/discover/i.test(u.title);

function selection() {
  if (!ui.sel[P.name]) {
    const m = new Map(), { dates } = periodDates();
    P.keywords.map(k => ({ k, c: kstats(k, dates).clicks })).sort((a, b) => b.c - a.c).slice(0, MAX_SEL).forEach((x, slot) => m.set(x.k.i, slot));
    ui.sel[P.name] = m;
  }
  return ui.sel[P.name];
}
const colorOf = k => { const s = selection(); return s.has(k.i) ? PALETTE[s.get(k.i)] : NEUTRAL; };

function toggleSel(i) {
  const sel = selection();
  if (sel.has(i)) sel.delete(i);
  else if (sel.size < MAX_SEL) { const used = new Set(sel.values()); sel.set(i, [...Array(MAX_SEL).keys()].find(s => !used.has(s))); }
  renderOverview();
}

// ---------------------------------------------------------------- composants

function deltaPill(d, { pct: isPct = false, invert = false, suffix = "" } = {}) {
  if (d == null || !isFinite(d)) return `<span class="pill flat">–</span>`;
  if (Math.abs(d) < (isPct ? 0.5 : 0.05)) return `<span class="pill flat">=</span>`;
  const good = invert ? d < 0 : d > 0;
  const txt = isPct ? Math.round(Math.abs(d)) + " %" : fmt1(Math.abs(d)) + suffix;
  return `<span class="pill ${good ? "up" : "down"}">${d > 0 ? "▲" : "▼"} ${txt}</span>`;
}

function tooltip(cb) {
  return { backgroundColor: "#fff", titleColor: INK, bodyColor: INK, borderColor: "#E8E8E8", borderWidth: 1, padding: 10, boxPadding: 5,
    usePointStyle: true, titleFont: { weight: "600" }, callbacks: cb };
}

function lineDs(label, values, color, { fresh = [], dash = null, width = 2 } = {}) {
  return { label, data: values, borderColor: color, backgroundColor: color, borderWidth: width, borderDash: dash || undefined,
    pointRadius: values.length > 45 ? 0 : 3, pointHoverRadius: 5, pointBorderColor: "#fff", pointBorderWidth: 2, tension: 0.3, spanGaps: false,
    segment: { borderDash: ctx => dash || (fresh[ctx.p1DataIndex] ? [5, 4] : undefined) } };
}

function posScale(vals) {
  const max = Math.max(1, ...vals.filter(v => v != null));
  return { reverse: true, min: 1, suggestedMax: Math.max(5, Math.ceil(max) + 1), grid: { color: GRID }, border: { display: false }, ticks: { precision: 0 } };
}
const linScale = () => ({ beginAtZero: true, grid: { color: GRID }, border: { display: false } });
const xScale = () => ({ grid: { display: false }, border: { color: "#E8E8E8" }, ticks: { maxTicksLimit: 9, maxRotation: 0, autoSkip: true } });

function chart(id, cfg) {
  if (charts[id]) charts[id].destroy();
  const el = $(id);
  if (el) charts[id] = new Chart(el, cfg);
}

function sparkline(pts, color) {
  const vals = pts.map(p => p ? p[1] : null), ok = vals.filter(v => v != null);
  if (ok.length < 2) return '<span class="light">–</span>';
  const w = 84, h = 22, lo = Math.min(...ok), hi = Math.max(...ok), span = hi - lo || 1;
  let d = "", pen = false;
  vals.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    const x = (i / (vals.length - 1)) * (w - 4) + 2, y = ((v - lo) / span) * (h - 4) + 2;
    d += (pen ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1); pen = true;
  });
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

const urlLink = (u, cls = "url") => u === "*" ? `<span class="${cls}">Toutes pages</span>`
  : `<a class="${cls}" href="${esc(u)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="${esc(u)}">${esc(path(u))}${EXT}</a>`;
const rankTag = pos => pos == null ? "" : pos <= 3 ? '<span class="rank top3">TOP 3</span>' : pos <= 10 ? '<span class="rank">TOP 10</span>' : "";
const sevTag = s => `<span class="sev ${s}">${s}</span>`;

function sortable(tableId, render) {
  document.querySelectorAll(`#${tableId} th[data-sort]`).forEach(th => {
    const on = th.dataset.sort === ui.sort.key;
    th.classList.toggle("sorted", on);
    const ar = th.querySelector(".arrow"); if (ar) ar.textContent = on ? (ui.sort.dir > 0 ? "↑" : "↓") : "↕";
    th.onclick = () => { const k = th.dataset.sort; ui.sort = ui.sort.key === k ? { key: k, dir: -ui.sort.dir } : { key: k, dir: ["keyword", "page", "pos", "best", "site"].includes(k) ? 1 : -1 }; render(); };
  });
}

// ---------------------------------------------------------------- vue Portefeuille

function renderPortfolio() {
  const hc = h => h >= 80 ? "#3FA34D" : h >= 50 ? "#D9A400" : "#C44A4A";
  const rows = IDX.projects.map(p => `<tr class="click" onclick="location.hash='#/${p.name}'">
    <td><span class="kw"><span class="avatar">${esc(p.label[0])}</span>${esc(p.label)}</span><div class="light" style="font-size:12px">${esc(p.property)}</div></td>
    <td>${esc(p.owner || "–")}</td>
    <td><span class="health"><span class="health-bar"><div style="width:${p.health}%;background:${hc(p.health)}"></div></span>${p.health}</span></td>
    <td>${p.alerts.critique ? `<span class="badge ko">${p.alerts.critique} critique${p.alerts.critique > 1 ? "s" : ""}</span> ` : ""}${p.alerts.attention ? `<span class="badge warn">${p.alerts.attention} à surveiller</span>` : ""}${!p.alerts.critique && !p.alerts.attention ? '<span class="badge ok">RAS</span>' : ""}</td>
    <td class="num">${fmt(p.nonbrand_clicks)}</td>
    <td class="num">${deltaPill(p.nonbrand_vs_prev, { pct: true })}</td>
    <td class="num">${deltaPill(p.nonbrand_vs_n1, { pct: true })}</td>
    <td class="num">${fmt1(p.position)} ${deltaPill(p.position_prev != null && p.position != null ? p.position_prev - p.position : null)}</td>
    <td class="num">${fmt1(p.visibility)} % ${deltaPill(p.visibility != null && p.visibility_prev != null ? p.visibility - p.visibility_prev : null, { suffix: " pt" })}</td>
    <td class="num">${p.top10 ?? "–"} / ${p.n_keywords}</td>
    <td>${p.last_date ? fmtDate(p.last_date) : "–"}</td></tr>`).join("");
  const ups = (IDX.google_updates || []).slice(-6).reverse();
  $("view").innerHTML = `
    <div class="page-head"><div><h1>Portefeuille</h1><p>Tous les projets suivis, sur les 28 derniers jours de données définitives. La santé part de 100 et perd 15 points par alerte critique et 5 par alerte à surveiller.</p></div>
      <a class="btn" href="${issue("projet.yml", { title: "Projet : " })}" target="_blank" rel="noopener"><svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Nouveau projet</a></div>
    <div class="card" style="margin-bottom:18px"><div class="table-wrap"><table>
      <thead><tr><th>Projet</th><th>Référent</th><th>Santé</th><th>Alertes</th><th class="num">Clics hors marque 28 j</th><th class="num">vs 28 j préc.</th><th class="num">vs N-1</th><th class="num">Position suivie</th><th class="num">Visibilité</th><th class="num">Top 10</th><th>Dernière donnée</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="11" class="empty">Aucun projet.</td></tr>'}</tbody></table></div></div>
    <div class="card"><div class="card-head"><h2>Mises à jour Google récentes</h2><span class="hint">Google Search Status Dashboard</span></div>
      <div class="card-body">${ups.map(u => `<div class="feed-row"><span class="light" style="width:90px">${fmtDate(u.begin)}</span><a href="${esc(u.url)}" target="_blank" rel="noopener">${esc(u.title)}</a><span class="light">${u.end ? "terminée le " + fmtDate(u.end) : "en cours"}</span></div>`).join("") || '<div class="empty-note">Aucune.</div>'}</div></div>`;
}

// ---------------------------------------------------------------- vue d'ensemble

function renderOverview() {
  if (!P) return;
  const { dates, prev, n1 } = periodDates();
  const kws = P.keywords.map(k => ({ ...k, st: kstats(k, dates), pv: kstats(k, prev), site: kstats(k, dates, "smap") }));
  const sel = selection();
  kws.forEach(k => { k.on = sel.has(k.i); k.color = colorOf(k); });
  const alertKw = new Set(P.alerts.filter(a => a.i != null).map(a => a.i));

  // KPI
  const nb = segSum("nonbrand", dates), nbp = segSum("nonbrand", prev), nb1 = segSum("nonbrand", n1);
  const tr = trackedSum(dates), trp = trackedSum(prev), tr1 = trackedSum(n1);
  const v = visAvg(dates), vp = visAvg(prev);
  const top3 = kws.filter(k => k.st.last && k.st.last[1] <= 3).length, top10 = kws.filter(k => k.st.last && k.st.last[1] <= 10).length;
  const cmp = (cur, p, n, opts = {}) => `<span>${p ? deltaPill(pct(cur, p), { pct: true, ...opts }) : '<span class="pill flat">–</span>'} vs période préc.</span><span>${n ? deltaPill(pct(cur, n), { pct: true, ...opts }) : '<span class="pill flat">–</span>'} vs N-1</span>`;
  const card = (lbl, val, sub, extra = "") => `<div class="card kpi"><div class="lbl">${lbl}${extra}</div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const range = dates.length ? `${fmtDate(dates[0])} au ${fmtDate(dates[dates.length - 1])}` : "";

  $("view").innerHTML = `
    <div class="kpis">
      ${card("Clics hors marque (site)", fmt(nb.clicks), cmp(nb.clicks, nbp.clicks, nb1.clicks))}
      ${card("Clics mots-clés suivis", fmt(tr.clicks), cmp(tr.clicks, trp.clicks, tr1.clicks))}
      ${card("Position moyenne suivie", fmt1(tr.pos), `<span>${deltaPill(trp.pos != null && tr.pos != null ? trp.pos - tr.pos : null)} vs période préc.</span><span>Pondérée par les impressions</span>`)}
      ${card("Top 3 / Top 10", `${top3}<small> / ${top10}</small>`, `<span>sur ${kws.length} mots-clés</span><span>au dernier jour de la période</span>`)}
      ${card("Indice de visibilité", v == null ? "–" : fmt1(v) + "<small> %</small>", `<span>${deltaPill(v != null && vp != null ? v - vp : null, { suffix: " pt" })} vs période préc.</span><span>Part des clics potentiels captés</span>`)}
      ${card("Santé du projet", `${P.health}<small> / 100</small>`, `<span><a href="#/${P.name}/alertes">${P.alerts.length} alerte${P.alerts.length > 1 ? "s" : ""} ouverte${P.alerts.length > 1 ? "s" : ""}</a></span><span>${range}</span>`)}
    </div>

    <div class="grid-2">
      <div class="card"><div class="card-head"><h2>Évolution des mots-clés</h2>
        <div class="tabs" id="metric">${[["position", "Position"], ["clicks", "Clics"], ["impressions", "Impressions"]].map(([m, l]) => `<button data-m="${m}" class="${ui.metric === m ? "active" : ""}">${l}</button>`).join("")}</div></div>
        <div class="card-body"><div class="legend" id="legend"></div><div class="chart-box"><canvas id="c-main"></canvas></div><div id="marks-main"></div></div></div>
      <div class="card"><div class="card-head"><h2>Répartition</h2><span class="hint">au dernier jour</span></div>
        <div class="card-body"><div class="dist-bar" id="dist-bar"></div><div id="dist-rows"></div><div class="movers" id="movers"></div></div></div>
    </div>

    <div class="grid-eq">
      <div class="card"><div class="card-head"><h2>Trafic hors marque du site</h2><span class="hint">clics, toutes requêtes hors marque</span></div>
        <div class="card-body"><div class="legend-static"><span><span class="line-sw" style="border-color:${INK}"></span>Période</span><span><span class="line-sw dash" style="border-color:${N1}"></span>Même période N-1</span><span><span class="line-sw" style="border-color:#77B0ED"></span>Marque</span></div>
        <div class="chart-box sm"><canvas id="c-traffic"></canvas></div><div id="marks-traffic"></div></div></div>
      <div class="card"><div class="card-head"><h2>Indice de visibilité</h2><span class="hint">moyenne mobile 7 jours</span></div>
        <div class="card-body"><div class="legend-static"><span><span class="line-sw" style="border-color:${INK}"></span>Période</span><span><span class="line-sw dash" style="border-color:${N1}"></span>N-1</span></div>
        <div class="chart-box sm"><canvas id="c-vis"></canvas></div></div></div>
    </div>

    <div class="card">
      <div class="toolbar"><h2>Mots-clés suivis</h2>
        <label class="search"><svg class="i" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="q" placeholder="Mot-clé ou URL" value="${esc(ui.query)}"></label>
        <button class="btn ghost sm" id="csv"><svg class="i" viewBox="0 0 24 24"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/></svg>CSV</button>
        <a class="btn sm" href="${issue("mot-cle.yml", { projet: P.name, title: "Mot-clé : " })}" target="_blank" rel="noopener"><svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Mot-clé</a></div>
      <div class="chips" id="tags"></div>
      <div class="table-wrap"><table id="t-kw"><thead><tr>
        <th style="width:30px" title="Afficher sur le graphique"></th>
        <th data-sort="keyword">Mot-clé<span class="arrow">↕</span></th><th data-sort="page">Page suivie<span class="arrow">↕</span></th>
        <th class="num" data-sort="pos">Position<span class="arrow">↕</span></th><th class="num" data-sort="delta">Évolution<span class="arrow">↕</span></th>
        <th>Tendance</th><th class="num" data-sort="site" title="Position du site toutes pages confondues">Pos. site<span class="arrow">↕</span></th>
        <th class="num" data-sort="clicks">Clics<span class="arrow">↕</span></th><th class="num" data-sort="impr">Impr.<span class="arrow">↕</span></th>
        <th class="num" data-sort="ctr">CTR<span class="arrow">↕</span></th><th class="num" data-sort="potential" title="Clics mensuels supplémentaires si la page atteint le top 3 (la 1re place si elle y est déjà)">Potentiel<span class="arrow">↕</span></th>
      </tr></thead><tbody id="tbody"></tbody></table></div>
      <div class="table-foot"><span id="t-count"></span><span>Coche jusqu'à 8 mots-clés pour le graphique. Les jours provisoires sont en pointillés. Point rouge = alerte ouverte.</span></div>
    </div>
    <p class="footnote">Données Google Search Console${P.anonymized_share != null ? `, dont ${fmt1(P.anonymized_share)} % des clics du site sur des requêtes anonymisées par Google (invisibles dans le détail)` : ""}. Position moyenne pondérée par les impressions, pour la page suivie. Un jour sans impression n'a pas de valeur. Les 3 derniers jours sont provisoires et réécrits à la synchro suivante. Repères : G = mise à jour Google, A = action SEO.</p>`;

  document.querySelectorAll("#metric button").forEach(b => b.onclick = () => { ui.metric = b.dataset.m; renderOverview(); });
  $("q").oninput = e => { ui.query = e.target.value.trim().toLowerCase(); renderKwTable(kws, alertKw); };
  $("csv").onclick = () => exportCsv(kws, dates);

  // Légende et graphique principal
  const on = kws.filter(k => k.on).sort((a, b) => sel.get(a.i) - sel.get(b.i));
  $("legend").innerHTML = on.map(k => `<button data-i="${k.i}" title="Retirer du graphique"><span class="sw" style="background:${k.color}"></span>${esc(k.keyword)}<span class="x">×</span></button>`).join("")
    + `<span class="hint">${on.length} / ${MAX_SEL} affichés</span>`;
  document.querySelectorAll("#legend button").forEach(b => b.onclick = () => toggleSel(+b.dataset.i));
  const val = p => p ? (ui.metric === "position" ? p[1] : ui.metric === "clicks" ? p[2] : p[3]) : null;
  const series = on.map(k => ({ k, b: bucket(k.st.pts, dates) }));
  const base = series[0] ? series[0].b : bucket(dates.map(() => null), dates);
  const mk = marksFor(base.ranges);
  const ds = series.map(({ k, b }) => lineDs(k.keyword, b.pts.map(val), k.color, { fresh: b.pts.map(p => p && p[4]) }));
  chart("c-main", { type: "line", data: { labels: base.labels, datasets: ds },
    options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, layout: { padding: { top: 12 } },
      scales: { y: ui.metric === "position" ? posScale(ds.flatMap(d => d.data)) : linScale(), x: xScale() },
      plugins: { legend: { display: false }, marks: { items: mk.items }, tooltip: tooltip({ label: c => ` ${c.dataset.label} : ${ui.metric === "position" ? fmt1(c.parsed.y) : fmt(c.parsed.y)}` }) } } });
  $("marks-main").innerHTML = mk.html;

  // Trafic hors marque et visibilité, avec N-1
  const segPts = (seg, ds_) => ds_.map(d => { const x = P.seg[seg] && P.seg[seg].get(d); return x || null; });
  const tb = bucket(segPts("nonbrand", dates), dates), tb1 = bucket(segPts("nonbrand", n1), n1), tbb = bucket(segPts("brand", dates), dates);
  const tmk = marksFor(tb.ranges);
  chart("c-traffic", { type: "line", data: { labels: tb.labels, datasets: [
      lineDs("Hors marque", tb.pts.map(p => p && p[2]), INK, { fresh: tb.pts.map(p => p && p[4]) }),
      lineDs("N-1", tb1.pts.map(p => p && p[2]), N1, { dash: [4, 4], width: 1.5 }),
      lineDs("Marque", tbb.pts.map(p => p && p[2]), "#77B0ED", { width: 1.5 })] },
    options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, layout: { padding: { top: 12 } }, scales: { y: linScale(), x: xScale() },
      plugins: { legend: { display: false }, marks: { items: tmk.items }, tooltip: tooltip({ label: c => ` ${c.dataset.label} : ${fmt(c.parsed.y)}` }) } } });
  $("marks-traffic").innerHTML = tmk.html;
  const roll = ds_ => ds_.map((d, i) => { const w = []; for (let j = 0; j < 7; j++) { const v = P.vis.get(shift(d, -j)); if (v != null) w.push(v); } return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null; });
  const visPt = d => { const v = roll([d])[0]; return v == null ? null : [d, v, 0, 1, 0]; };
  const vb = bucket(dates.map(visPt), dates), vb1 = bucket(n1.map(visPt), n1);
  chart("c-vis", { type: "line", data: { labels: vb.labels, datasets: [lineDs("Visibilité", vb.pts.map(p => p && p[1]), INK), lineDs("N-1", vb1.pts.map(p => p && p[1]), N1, { dash: [4, 4], width: 1.5 })] },
    options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, scales: { y: { ...linScale(), ticks: { callback: v => v + " %" } }, x: xScale() },
      plugins: { legend: { display: false }, tooltip: tooltip({ label: c => ` ${c.dataset.label} : ${fmt1(c.parsed.y)} %` }) } } });

  renderDist(kws);
  renderTags();
  renderKwTable(kws, alertKw);
  if (ui.openKw != null) openDrawer(ui.openKw, true);
}

function renderDist(kws) {
  const buckets = [
    { name: "Top 3", test: p => p != null && p <= 3, color: "#2a78d6" }, { name: "Positions 4 à 10", test: p => p > 3 && p <= 10, color: "#86b6ef" },
    { name: "Positions 11 à 20", test: p => p > 10 && p <= 20, color: "#cde2fb" }, { name: "Au-delà de 20", test: p => p > 20, color: "#D4D4D4" },
    { name: "Sans donnée", test: p => p == null, color: "#EDEDED" }];
  const lasts = kws.map(k => k.st.last ? k.st.last[1] : null);
  buckets.forEach(b => b.n = lasts.filter(b.test).length);
  const shown = buckets.filter(b => b.n || b.name !== "Sans donnée");
  $("dist-bar").innerHTML = shown.filter(b => b.n).map(b => `<div title="${b.name} : ${b.n}" style="flex:${b.n};background:${b.color}"></div>`).join("");
  $("dist-rows").innerHTML = shown.map(b => `<div class="dist-row"><span class="sw" style="background:${b.color}"></span><span class="muted">${b.name}</span><span class="n">${b.n}</span></div>`).join("");
  const moved = kws.filter(k => k.st.delta != null);
  const row = k => `<div class="mover" data-i="${k.i}"><span class="sw" style="background:${k.color}"></span><span class="k">${esc(k.keyword)}</span>${deltaPill(k.st.delta)}</div>`;
  const ups = moved.filter(k => k.st.delta > 0).sort((a, b) => b.st.delta - a.st.delta).slice(0, 3);
  const downs = moved.filter(k => k.st.delta < 0).sort((a, b) => a.st.delta - b.st.delta).slice(0, 3);
  $("movers").innerHTML = `<h3>Plus fortes hausses</h3>${ups.map(row).join("") || '<div class="empty-note">Aucune.</div>'}<h3>Plus fortes baisses</h3>${downs.map(row).join("") || '<div class="empty-note">Aucune.</div>'}`;
  document.querySelectorAll("#movers .mover").forEach(m => m.onclick = () => openDrawer(+m.dataset.i));
}

function renderTags() {
  const all = [...new Set(P.keywords.flatMap(k => k.tags))].sort();
  $("tags").hidden = !all.length;
  $("tags").innerHTML = `<button class="${ui.tags.size ? "" : "on"}" data-t="">Tous</button>` + all.map(t => `<button class="${ui.tags.has(t) ? "on" : ""}" data-t="${esc(t)}">${esc(t)}</button>`).join("");
  document.querySelectorAll("#tags button").forEach(b => b.onclick = () => {
    const t = b.dataset.t;
    if (!t) ui.tags.clear(); else ui.tags.has(t) ? ui.tags.delete(t) : ui.tags.add(t);
    renderOverview();
  });
}

function filteredKws(kws) {
  return kws.filter(k => (!ui.query || k.keyword.toLowerCase().includes(ui.query) || k.page.toLowerCase().includes(ui.query) || k.variants.some(v => v.includes(ui.query)))
    && (!ui.tags.size || k.tags.some(t => ui.tags.has(t))));
}

function renderKwTable(kws, alertKw) {
  const sv = { keyword: k => k.keyword, page: k => k.page, pos: k => k.st.last ? k.st.last[1] : 999, delta: k => k.st.delta ?? -999,
    site: k => k.site.wpos ?? 999, clicks: k => k.st.clicks, impr: k => k.st.impr, ctr: k => k.st.ctr ?? -1, potential: k => k.potential ?? -1 }[ui.sort.key] || (k => k.st.impr);
  const rows = filteredKws(kws).sort((a, b) => { const x = sv(a), y = sv(b); return (x < y ? -1 : x > y ? 1 : 0) * ui.sort.dir; });
  const sel = selection();
  $("tbody").innerHTML = rows.map(k => {
    const pos = k.st.last ? k.st.last[1] : null;
    const pick = `<button class="pick ${k.on ? "on" : ""}" data-pick="${k.i}" ${!k.on && sel.size >= MAX_SEL ? "disabled" : ""} style="${k.on ? `background:${k.color}` : ""}" aria-label="Graphique : ${esc(k.keyword)}"></button>`;
    const siteDiff = k.site.wpos != null && pos != null && Math.abs(k.site.wpos - (k.st.wpos ?? pos)) >= 0.5;
    return `<tr class="click ${k.i === ui.openKw ? "selected" : ""}" data-i="${k.i}">
      <td>${pick}</td>
      <td><span class="kw"><span class="sw" style="background:${k.color}"></span>${esc(k.keyword)}${k.variants.length ? ` <span class="badge" title="${esc(k.variants.join(", "))}">+${k.variants.length}</span>` : ""}${alertKw.has(k.i) ? ' <span class="warn-ico" title="Alerte ouverte">●</span>' : ""}</span>
        ${k.tags.length ? `<div style="margin-top:3px;display:flex;gap:4px">${k.tags.map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}</td>
      <td>${urlLink(k.page)}</td>
      <td class="num"><span class="pos-cell">${rankTag(pos)}<span class="pos">${fmt1(pos)}</span></span></td>
      <td class="num">${deltaPill(k.st.delta)}</td>
      <td>${sparkline(k.st.pts, k.on ? k.color : "#8a8a8a")}</td>
      <td class="num ${siteDiff ? "" : "light"}" title="${siteDiff ? "Écart avec la page suivie : une autre page du site se positionne aussi" : ""}">${fmt1(k.site.wpos)}</td>
      <td class="num">${fmt(k.st.clicks)}</td><td class="num">${fmt(k.st.impr)}</td>
      <td class="num">${k.st.ctr == null ? "–" : fmt1(k.st.ctr) + " %"}</td>
      <td class="num">${k.potential ? "+" + fmt(k.potential) : "–"}</td></tr>`;
  }).join("") || `<tr><td colspan="11" class="empty">Aucun mot-clé ne correspond.</td></tr>`;
  $("tbody").querySelectorAll("tr[data-i]").forEach(tr => tr.onclick = () => openDrawer(+tr.dataset.i));
  $("tbody").querySelectorAll("[data-pick]").forEach(b => b.onclick = e => { e.stopPropagation(); toggleSel(+b.dataset.pick); });
  $("t-count").textContent = `${rows.length} mot${rows.length > 1 ? "s" : ""}-clé${rows.length > 1 ? "s" : ""} sur ${kws.length}`;
  sortable("t-kw", () => renderKwTable(kws, alertKw));
}

function exportCsv(kws, dates) {
  const head = ["mot-cle", "variantes", "tags", "page", "position_derniere", "position_moyenne", "evolution", "position_site", "clics", "impressions", "ctr", "potentiel_clics_mois"];
  const lines = [head.join(";")].concat(filteredKws(kws).map(k => [k.keyword, k.variants.join(", "), k.tags.join(", "), k.page,
    k.st.last ? k.st.last[1] : "", k.st.wpos != null ? k.st.wpos.toFixed(1) : "", k.st.delta ?? "", k.site.wpos != null ? k.site.wpos.toFixed(1) : "",
    k.st.clicks, k.st.impr, k.st.ctr != null ? k.st.ctr.toFixed(2) : "", k.potential ?? ""].map(v => `"${String(v).replace(/"/g, '""').replace(".", ",")}"`).join(";")));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }));
  a.download = `${P.name}-mots-cles-${dates[0]}-${dates[dates.length - 1]}.csv`;
  a.click();
}

// ---------------------------------------------------------------- panneau de détail

function openDrawer(i, silent = false) {
  if (!P) return;
  ui.openKw = i;
  const k0 = P.keywords.find(k => k.i === i);
  if (!k0) return;
  const { dates, n1 } = periodDates();
  const k = { ...k0, st: kstats(k0, dates), site: kstats(k0, dates, "smap"), n1s: kstats(k0, n1) };
  const color = colorOf(k0) === NEUTRAL ? PALETTE[0] : colorOf(k0);
  const pos = k.st.last ? k.st.last[1] : null;
  const evs = P.events.filter(e => e.i === i).slice(0, 8);
  const al = P.alerts.filter(a => a.i === i);
  const insp = P.inspection && P.inspection.current[k.page];
  $("drawer").innerHTML = `
    <div class="drawer-head"><div style="min-width:0"><h3>${esc(k.keyword)}</h3>${urlLink(k.page)}
      <div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">${k.tags.map(t => `<span class="tag">${esc(t)}</span>`).join("")}${k.variants.map(v => `<span class="badge">+ ${esc(v)}</span>`).join("")}</div></div>
      <a class="btn ghost sm" href="${issue("action.yml", { projet: P.name, page: k.page === "*" ? "" : k.page, title: "Action : " })}" target="_blank" rel="noopener">Ajouter une action</a>
      <button class="icon-btn" id="d-close" aria-label="Fermer"><svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    <div class="drawer-body">
      ${k.note ? `<div class="note-box">${esc(k.note)}</div>` : ""}
      ${al.map(a => `<div class="note-box" style="background:var(--status-${a.severity === "critique" ? "ko" : "warn"}-bg)">${sevTag(a.severity)} ${esc(a.text)}</div>`).join("")}
      <div class="mini-kpis">
        <div><div class="l">Position page</div><div class="v">${fmt1(pos)}</div></div>
        <div><div class="l">Position site</div><div class="v">${fmt1(k.site.wpos)}</div></div>
        <div><div class="l">Clics</div><div class="v">${fmt(k.st.clicks)}</div></div>
        <div><div class="l">CTR</div><div class="v">${k.st.ctr == null ? "–" : fmt1(k.st.ctr) + " %"}</div></div>
        <div><div class="l">Potentiel / mois</div><div class="v">${k.potential ? "+" + fmt(k.potential) : "–"}</div></div>
      </div>
      <h4>Position <label class="toggle"><input type="checkbox" id="d-n1" ${ui.n1 ? "checked" : ""}> Comparer à N-1</label></h4>
      <div class="legend-static"><span><span class="line-sw" style="border-color:${color}"></span>Page suivie</span><span><span class="line-sw dash" style="border-color:#8a8a8a"></span>Site (toutes pages)</span>${ui.n1 ? `<span><span class="line-sw dash" style="border-color:${N1}"></span>N-1</span>` : ""}</div>
      <div class="chart-box"><canvas id="d-pos"></canvas></div><div id="d-marks"></div>
      <h4>Impressions et clics</h4><div class="chart-box"><canvas id="d-impr"></canvas></div>
      ${k.variants_detail && k.variants_detail.length > 1 ? `<h4>Variantes (28 derniers jours)</h4><div class="box"><table><thead><tr><th>Requête</th><th class="num">Pos. page</th><th class="num">Clics</th><th class="num">Impr.</th><th class="num">Pos. site</th></tr></thead><tbody>
        ${k.variants_detail.map(v => `<tr><td>${esc(v.query)}</td><td class="num">${fmt1(v.pos)}</td><td class="num">${fmt(v.clicks)}</td><td class="num">${fmt(v.impr)}</td><td class="num">${fmt1(v.site_pos)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      ${k.pages && k.pages.length ? `<h4>Pages du site qui reçoivent des impressions <span class="light">28 j / 7 j</span></h4><div class="box"><table><thead><tr><th>Page</th><th class="num">Part 28 j</th><th class="num">Part 7 j</th><th class="num">Pos.</th><th class="num">Clics</th></tr></thead><tbody>
        ${k.pages.map(p => `<tr ${p.tracked ? 'style="font-weight:600"' : ""}><td>${urlLink(p.page)}${p.tracked ? ' <span class="badge info">suivie</span>' : ""}</td><td class="num">${fmt1(p.share)} %</td><td class="num">${fmt1(p.share7)} %</td><td class="num">${fmt1(p.pos)}</td><td class="num">${fmt(p.clicks)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      ${k.splits ? `<div class="grid-eq" style="margin:0">${["device", "country"].map(dim => k.splits[dim] && k.splits[dim].length ? `<div><h4>${dim === "device" ? "Appareils" : "Pays"} (28 j)</h4><div class="box"><table><tbody>
        ${k.splits[dim].slice(0, 5).map(x => `<tr><td>${esc(dim === "device" ? ({ MOBILE: "Mobile", DESKTOP: "Ordinateur", TABLET: "Tablette" }[x.key] || x.key) : x.key.toUpperCase())}</td><td class="num">${fmt1(x.pos)}</td><td class="num">${fmt(x.clicks)} clics</td></tr>`).join("")}</tbody></table></div></div>` : "").join("")}</div>` : ""}
      ${insp ? `<h4>Indexation de la page</h4><div class="insp"><span class="badge ${insp.verdict === "PASS" ? "ok" : "ko"}">${esc(insp.coverageState || insp.verdict)}</span>
        <span class="badge">Dernier crawl ${insp.lastCrawlTime ? fmtDate(insp.lastCrawlTime.slice(0, 10)) : "–"}</span>
        ${insp.googleCanonical && norm(insp.googleCanonical) !== norm(insp.userCanonical) ? `<span class="badge warn">Canonique Google : ${esc(path(insp.googleCanonical))}</span>` : '<span class="badge ok">Canonique respectée</span>'}</div>` : ""}
      ${evs.length ? `<h4>Derniers événements</h4>${evs.map(e => `<div class="feed-row"><span class="light" style="width:60px">${fmtDate(e.date)}</span>${sevTag(e.severity)}<span>${esc(e.text)}</span></div>`).join("")}` : ""}
      <h4>Historique quotidien <span class="light">60 derniers jours</span></h4>
      <div class="box"><table><thead><tr><th>Date</th><th class="num">Position</th><th class="num">Pos. site</th><th class="num">Clics</th><th class="num">Impr.</th></tr></thead><tbody>
        ${k0.s.slice(-60).reverse().map(p => { const s = k0.smap.get(p[0]); return `<tr><td>${fmtDate(p[0])}${p[4] ? '<span class="fresh-tag">provisoire</span>' : ""}</td><td class="num">${fmt1(p[1])}</td><td class="num">${fmt1(s && s[1])}</td><td class="num">${fmt(p[2])}</td><td class="num">${fmt(p[3])}</td></tr>`; }).join("")}</tbody></table></div>
    </div>`;
  $("d-close").onclick = () => closeDrawer();
  $("d-n1").onchange = e => { ui.n1 = e.target.checked; openDrawer(i, true); };
  const b = bucket(k.st.pts, dates), bs = bucket(k.site.pts, dates), b1 = bucket(k.n1s.pts, n1);
  const mk = marksFor(b.ranges, { page: k.page });
  const ds = [lineDs("Page suivie", b.pts.map(p => p && p[1]), color, { fresh: b.pts.map(p => p && p[4]) }),
    lineDs("Site", bs.pts.map(p => p && p[1]), "#8a8a8a", { dash: [4, 3], width: 1.5 })];
  if (ui.n1) ds.push(lineDs("N-1", b1.pts.map(p => p && p[1]), N1, { dash: [2, 3], width: 1.5 }));
  chart("d-pos", { type: "line", data: { labels: b.labels, datasets: ds },
    options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, layout: { padding: { top: 12 } },
      scales: { y: posScale(ds.flatMap(d => d.data)), x: xScale() },
      plugins: { legend: { display: false }, marks: { items: mk.items }, tooltip: tooltip({ label: c => ` ${c.dataset.label} : ${fmt1(c.parsed.y)}` }) } } });
  $("d-marks").innerHTML = mk.html;
  chart("d-impr", { type: "bar", data: { labels: b.labels, datasets: [
      { label: "Impressions", data: b.pts.map(p => p && p[3]), backgroundColor: color, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom", maxBarThickness: 18 }] },
    options: { maintainAspectRatio: false, scales: { y: linScale(), x: xScale() },
      plugins: { legend: { display: false }, tooltip: tooltip({ label: c => { const p = b.pts[c.dataIndex]; return p ? [` Impressions : ${fmt(p[3])}`, ` Clics : ${fmt(p[2])}`] : ""; } }) } } });
  $("app").classList.add("drawer-open");
  $("drawer").setAttribute("aria-hidden", "false");
  document.querySelectorAll("#tbody tr").forEach(tr => tr.classList.toggle("selected", +tr.dataset.i === i));
}

function closeDrawer(keep = false) {
  $("app").classList.remove("drawer-open");
  $("drawer").setAttribute("aria-hidden", "true");
  ["d-pos", "d-impr"].forEach(id => { if (charts[id]) { charts[id].destroy(); delete charts[id]; } });
  if (!keep) ui.openKw = null;
  document.querySelectorAll("#tbody tr.selected").forEach(tr => tr.classList.remove("selected"));
}

// ---------------------------------------------------------------- vue Alertes

function renderAlerts() {
  const kwLink = e => e.i != null ? `<span class="k" data-i="${e.i}">${esc(e.keyword)}</span>` : e.page ? urlLink(e.page) : "";
  const alerts = P.alerts.map(a => `<div class="card item">${sevTag(a.severity)}<div>
      <h3>${a.keyword ? esc(a.keyword) : esc(TYPES[a.type] || a.type)}</h3><p>${esc(a.text)}</p>
      <div class="meta"><span>${esc(TYPES[a.type] || a.type)}</span>${a.page && a.page !== "*" ? urlLink(a.page) : ""}<span>au ${fmtDate(a.date)}</span></div></div>
      <div class="num">${a.impact ? `<div class="pos">−${fmt(a.impact)}</div><div class="light" style="font-size:11px">clics / mois estimés</div>` : ""}
      ${a.i != null ? `<button class="btn ghost sm" data-open="${a.i}" style="margin-top:6px">Voir</button>` : ""}</div></div>`).join("");
  const evs = P.events.filter(e => ui.feed === "all" || e.severity === ui.feed);
  const byDay = {};
  evs.forEach(e => (byDay[e.date] = byDay[e.date] || []).push(e));
  const feed = Object.keys(byDay).sort().reverse().map(d => `<div class="feed-day">${fmtDateL(d)}</div>` + byDay[d].map(e =>
    `<div class="feed-row">${sevTag(e.severity)}<span style="min-width:150px">${kwLink(e)}</span><span class="muted">${esc(e.text)}</span></div>`).join("")).join("");
  const ups = (IDX.google_updates || []).slice().reverse();
  $("view").innerHTML = `
    <div class="page-head"><div><h1>Alertes et changements</h1><p>Les règles tournent chaque matin sur les données définitives. Une alerte reste ouverte tant que la condition est vraie. Le fil liste chaque jour où une règle s'est déclenchée sur les 30 derniers jours.</p></div></div>
    <div class="explain"><strong>Les règles.</strong> Recul : la moyenne des 3 derniers jours perd au moins 1 place (top 3), 2 places (top 10) ou 3 places par rapport aux 7 jours précédents. Sortie du top 3 ou du top 10, avec un recul d'au moins 0,7 et 1 place. Page disparue : plus aucune impression sur 3 jours. Impressions : −30 % sur 7 jours, en vérifiant si la demande baisse aussi. Changement de page : une autre URL du site prend plus d'impressions que la page suivie sur 7 jours. Indexation et canonique via l'API d'inspection d'URL. Le chiffre de droite estime les clics mensuels perdus avec la courbe de CTR propre au client.</div>
    <h2 style="font-size:15px;margin-bottom:10px">Alertes ouvertes (${P.alerts.length})</h2>
    <div class="list" style="margin-bottom:28px">${alerts || '<div class="card empty">Aucune alerte ouverte.</div>'}</div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><h2>Fil des changements</h2>
        <div class="tabs" id="feed-f">${[["all", "Tous"], ["critique", "Critique"], ["attention", "Attention"], ["info", "Info"]].map(([v, l]) => `<button data-v="${v}" class="${ui.feed === v ? "active" : ""}">${l}</button>`).join("")}</div></div>
        <div class="card-body">${feed || '<div class="empty-note">Aucun événement.</div>'}</div></div>
      <div class="card"><div class="card-head"><h2>Mises à jour Google</h2></div><div class="card-body">
        ${ups.map(u => `<div class="feed-row" style="flex-direction:column;gap:0"><a href="${esc(u.url)}" target="_blank" rel="noopener" style="font-weight:600">${esc(u.title)}</a><span class="badge" style="align-self:flex-start">${esc(u.service || "")}</span><span class="light">${fmtDateL(u.begin)}${u.end ? " au " + fmtDateL(u.end) : ", en cours"}</span></div>`).join("")}</div></div>
    </div>`;
  document.querySelectorAll("[data-open], .feed-row .k").forEach(el => el.onclick = () => openDrawer(+(el.dataset.open ?? el.dataset.i)));
  document.querySelectorAll("#feed-f button").forEach(b => b.onclick = () => { ui.feed = b.dataset.v; renderAlerts(); });
}

// ---------------------------------------------------------------- vue Actions

function renderActions() {
  const kwName = i => (P.keywords.find(k => k.i === i) || {}).keyword;
  const cards = P.actions.map(a => {
    const im = a.impact;
    const body = im ? `<div class="impact">
        <div><div class="l">Position avant → après</div><div class="v">${fmt1(im.pos_before)} → ${fmt1(im.pos_after)}</div></div>
        <div><div class="l">Clics / jour avant → après</div><div class="v">${fmt1(im.clicks_day_before)} → ${fmt1(im.clicks_day_after)}</div></div>
        <div><div class="l">Impressions / jour</div><div class="v">${fmt(im.impr_day_before)} → ${fmt(im.impr_day_after)}</div></div>
        <div><div class="l">Impact corrigé (clics / mois)</div><div class="v">${im.clicks_month_adjusted == null ? "–" : (im.clicks_month_adjusted > 0 ? "+" : "") + fmt(im.clicks_month_adjusted)}</div></div></div>
        <div class="meta" style="margin-top:8px">28 jours avant vs ${im.window_after} jours après. Groupe témoin : ${im.control_size} mots-clés non travaillés${im.control_ratio ? `, tendance ×${fmt1(im.control_ratio)}` : ""}.</div>`
      : `<div class="meta" style="margin-top:8px">${esc(a.reason || "")}</div>`;
    return `<div class="card item"><span class="badge">${esc(a.type || "autre")}</span><div>
      <h3>${esc(a.title || "Action")}</h3>${a.description ? `<p>${esc(a.description)}</p>` : ""}
      <div class="meta"><span>${fmtDateL(a.date)}</span>${a.page ? urlLink(a.page) : ""}${a.author ? `<span>${esc(a.author)}</span>` : ""}
      ${a.keywords && a.keywords.length ? `<span>Mots-clés mesurés : ${a.keywords.map(i => `<span class="k" data-i="${i}" style="cursor:pointer;text-decoration:underline">${esc(kwName(i))}</span>`).join(", ")}</span>` : ""}</div>${body}</div><div></div></div>`;
  }).join("");
  $("view").innerHTML = `
    <div class="page-head"><div><h1>Journal des actions</h1><p>Chaque action SEO menée sur une page, avec son impact mesuré sur les mots-clés suivis de cette page.</p></div>
      <a class="btn" href="${issue("action.yml", { projet: P.name, title: "Action : " })}" target="_blank" rel="noopener"><svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Ajouter une action</a></div>
    <div class="explain"><strong>Comment c'est mesuré.</strong> On compare les 28 jours avant la mise en ligne aux 28 jours après (ou moins tant que le recul est insuffisant, 7 jours minimum), sur les mots-clés suivis de la page. Pour isoler l'effet de l'action, la tendance des mots-clés non travaillés sur la même période (groupe témoin) est retirée : « impact corrigé » = clics par jour après − clics par jour avant × tendance du témoin, ramené à 28 jours. Les actions apparaissent aussi comme repères « A » sur les courbes.
      <br><strong>Saisie.</strong> Le bouton ouvre un formulaire GitHub. À l'envoi, l'action est ajoutée à <code>config/actions/${esc(P.name)}.yaml</code> et le dashboard est recalculé en 1 à 2 minutes. On peut aussi éditer ce fichier directement.</div>
    <div class="list">${cards || '<div class="card empty">Aucune action saisie pour l\'instant.</div>'}</div>`;
  document.querySelectorAll("[data-i]").forEach(el => el.onclick = () => openDrawer(+el.dataset.i));
}

// ---------------------------------------------------------------- vue Opportunités

function renderOpps() {
  const kws = P.keywords.filter(k => k.potential).sort((a, b) => b.potential - a.potential);
  const flagsL = { top: "Top clics", striking: "Positions 4 à 20", nouvelle: "Nouvelle" };
  const sug = P.suggestions.filter(s => ui.sug === "all" || s.flags.includes(ui.sug));
  $("view").innerHTML = `
    <div class="page-head"><div><h1>Opportunités</h1><p>Où gagner des clics : le potentiel des mots-clés suivis et les requêtes du site qui mériteraient d'être suivies.</p></div></div>
    <div class="explain"><strong>Le potentiel</strong> estime les clics mensuels supplémentaires si la page atteint le top 3 (ou la 1re place si elle y est déjà) : impressions des 28 derniers jours × (CTR à la position visée − CTR actuel). Les CTR viennent de la courbe propre au client, calculée sur ses mots-clés suivis (90 jours) et affichée ci-dessous.</div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><h2>Mots-clés suivis : potentiel</h2></div><div class="table-wrap"><table>
        <thead><tr><th>Mot-clé</th><th class="num">Position</th><th class="num">Impr. 28 j</th><th class="num">Cible</th><th class="num">Potentiel / mois</th></tr></thead><tbody>
        ${kws.map(k => { const st = kstats(k, P.dates.slice(-28)); return `<tr class="click" data-i="${k.i}"><td><span class="kw">${esc(k.keyword)}</span></td><td class="num">${fmt1(st.wpos)}</td><td class="num">${fmt(kstats(k, P.dates.slice(-28), "smap").impr)}</td><td class="num">${k.potential_target === 1 ? "1re place" : "Top 3"}</td><td class="num"><b>+${fmt(k.potential)}</b></td></tr>`; }).join("") || '<tr><td colspan="5" class="empty">Pas de potentiel calculable.</td></tr>'}
        </tbody></table></div></div>
      <div class="card"><div class="card-head"><h2>Courbe de CTR du client</h2><span class="hint">par position</span></div><div class="card-body"><div class="chart-box sm"><canvas id="c-ctr"></canvas></div></div></div>
    </div>
    <div class="card">
      <div class="toolbar"><h2>Requêtes hors marque à suivre</h2><div class="tabs" id="sug-f">${[["all", "Toutes"], ["top", "Top clics"], ["striking", "Positions 4 à 20"], ["nouvelle", "Nouvelles"]].map(([v, l]) => `<button data-v="${v}" class="${ui.sug === v ? "active" : ""}">${l}</button>`).join("")}</div></div>
      <div class="table-wrap"><table><thead><tr><th>Requête</th><th>Page principale</th><th class="num">Position</th><th class="num">Clics 28 j</th><th class="num">Impr. 28 j</th><th class="num">vs 28 j préc.</th><th class="num">Potentiel / mois</th><th></th><th></th></tr></thead><tbody>
      ${sug.map(s => `<tr><td><b>${esc(s.query)}</b></td><td>${urlLink(s.page)}</td><td class="num">${fmt1(s.pos)}</td><td class="num">${fmt(s.clicks)}</td><td class="num">${fmt(s.impr)}</td>
        <td class="num">${deltaPill(s.prev_impr ? pct(s.impr, s.prev_impr) : null, { pct: true })}</td><td class="num">${s.potential ? "+" + fmt(s.potential) : "–"}</td>
        <td>${s.flags.map(f => `<span class="badge ${f === "nouvelle" ? "info" : f === "striking" ? "warn" : ""}">${flagsL[f]}</span>`).join(" ")}</td>
        <td><a class="btn ghost sm" target="_blank" rel="noopener" href="${issue("mot-cle.yml", { projet: P.name, mot_cle: s.query, page: s.page || "", title: "Mot-clé : " + s.query })}">Suivre</a></td></tr>`).join("") || '<tr><td colspan="9" class="empty">Aucune suggestion.</td></tr>'}
      </tbody></table></div>
      <div class="table-foot"><span>${sug.length} requêtes</span><span>Données ${P.extras_period ? "du " + fmtDate(P.extras_period[0]) + " au " + fmtDate(P.extras_period[1]) : ""}. « Suivre » ouvre le formulaire pré-rempli.</span></div>
    </div>`;
  document.querySelectorAll("tr[data-i]").forEach(tr => tr.onclick = () => openDrawer(+tr.dataset.i));
  document.querySelectorAll("#sug-f button").forEach(b => b.onclick = () => { ui.sug = b.dataset.v; renderOpps(); });
  if (P.ctr_curve) chart("c-ctr", { type: "bar", data: { labels: P.ctr_curve.map((_, i) => i + 1), datasets: [{ data: P.ctr_curve.map(v => v * 100), backgroundColor: "#2a78d6", borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom" }] },
    options: { maintainAspectRatio: false, scales: { y: { ...linScale(), ticks: { callback: v => v + " %" } }, x: { grid: { display: false }, title: { display: true, text: "Position" } } },
      plugins: { legend: { display: false }, tooltip: tooltip({ title: c => "Position " + c[0].label, label: c => ` CTR : ${fmt1(c.parsed.y)} %` }) } } });
}

// ---------------------------------------------------------------- vue Pages

function renderPages() {
  const pages = {};
  P.keywords.filter(k => k.page !== "*").forEach(k => (pages[k.page] = pages[k.page] || []).push(k));
  const cards = Object.entries(pages).map(([url, kws]) => {
    const insp = P.inspection.current[url] || {};
    const pq = P.page_queries[url] || {};
    const prev = new Map((pq.prev || []).map(r => [r[0], r]));
    const tracked = new Set(kws.flatMap(k => [k.keyword, ...k.variants]));
    const cur = pq.cur || [];
    const tc = cur.reduce((a, r) => a + r[1], 0), ti = cur.reduce((a, r) => a + r[2], 0);
    const canon = insp.googleCanonical && norm(insp.googleCanonical) !== norm(insp.userCanonical);
    const hist = (P.inspection.history || []).filter(h => h.url === url).slice(-3).reverse();
    return `<details class="card page-card"><summary>
        <span class="badge ${insp.verdict === "PASS" ? "ok" : insp.verdict ? "ko" : ""}">${esc(insp.coverageState || "Non inspectée")}</span>
        ${canon ? '<span class="badge warn">Canonique différente</span>' : ""}
        <b>${esc(path(url))}</b><span class="light">${kws.length} mot${kws.length > 1 ? "s" : ""}-clé${kws.length > 1 ? "s" : ""} suivi${kws.length > 1 ? "s" : ""}</span>
        <span class="spacer"></span><span class="muted">${fmt(tc)} clics · ${fmt(ti)} impr. sur 28 j (top 60 requêtes)</span></summary>
      <div class="body">
        <div class="insp"><a class="url" href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}${EXT}</a></div>
        <div class="insp">
          <span class="badge">Dernier crawl ${insp.lastCrawlTime ? fmtDate(insp.lastCrawlTime.slice(0, 10)) : "–"} ${insp.crawledAs ? "(" + (insp.crawledAs === "MOBILE" ? "mobile" : "ordinateur") + ")" : ""}</span>
          <span class="badge">Robots.txt : ${esc(insp.robotsTxtState || "–")}</span><span class="badge">Indexation : ${esc(insp.indexingState || "–")}</span>
          ${canon ? `<span class="badge warn">Google retient ${esc(path(insp.googleCanonical))}</span>` : ""}<span class="badge">Vérifiée le ${insp.checked ? fmtDate(insp.checked) : "–"}</span></div>
        ${hist.length ? `<div class="note-box">${hist.map(h => `${fmtDate(h.date)} : ${esc(h.field)} passe de « ${esc(h.old)} » à « ${esc(h.new)} »`).join("<br>")}</div>` : ""}
        <div class="box"><table><thead><tr><th>Requête</th><th class="num">Clics</th><th class="num">Impr.</th><th class="num">Position</th><th class="num">Évol. position</th><th class="num">Évol. impr.</th></tr></thead><tbody>
        ${cur.slice(0, 30).map(r => { const p = prev.get(r[0]); return `<tr ${tracked.has(r[0]) ? 'style="font-weight:600"' : ""}><td>${esc(r[0])}${tracked.has(r[0]) ? ' <span class="badge info">suivi</span>' : ""}</td>
          <td class="num">${fmt(r[1])}</td><td class="num">${fmt(r[2])}</td><td class="num">${fmt1(r[3])}</td><td class="num">${p ? deltaPill(p[3] - r[3]) : '<span class="badge info">nouvelle</span>'}</td><td class="num">${p ? deltaPill(pct(r[2], p[2]), { pct: true }) : ""}</td></tr>`; }).join("") || '<tr><td colspan="6" class="empty">Pas de donnée.</td></tr>'}
        </tbody></table></div></div></details>`;
  }).join("");
  $("view").innerHTML = `<div class="page-head"><div><h1>Pages suivies</h1><p>Pour chaque page suivie : son état d'indexation (API d'inspection d'URL, vérifiée chaque jour) et toutes les requêtes qui lui apportent du trafic, 28 derniers jours vs 28 jours précédents. C'est la base de travail d'un brief d'optimisation.</p></div></div>${cards || '<div class="card empty">Aucune page suivie.</div>'}`;
}

// ---------------------------------------------------------------- vue Rapport mensuel

function renderReport() {
  const finals = P.dates.filter(d => d <= P.last_final);
  const months = [...new Set(finals.map(d => d.slice(0, 7)))].sort().reverse();
  const complete = m => finals.includes(lastDay(m));
  if (!ui.month || !months.includes(ui.month)) ui.month = months.find(complete) || months[0];
  const m = ui.month, pm = prevMonth(m), nm = shiftMonth(m, -12);
  const md = monthDates(m).filter(d => d <= P.last_final), pmd = monthDates(pm), nmd = monthDates(nm);
  const mlabel = x => MONTHS[+x.slice(5) - 1] + " " + x.slice(0, 4);
  const nb = segSum("nonbrand", md), nbp = segSum("nonbrand", pmd), nb1 = segSum("nonbrand", nmd);
  const tr = trackedSum(md), trp = trackedSum(pmd), tr1 = trackedSum(nmd);
  const v = visAvg(md), vp = visAvg(pmd);
  const rows = P.keywords.map(k => ({ k, c: kstats(k, md), p: kstats(k, pmd) })).map(x => ({ ...x, d: x.c.wpos != null && x.p.wpos != null ? x.p.wpos - x.c.wpos : null }));
  const endPos = x => x.c.last ? x.c.last[1] : null;
  const top3 = rows.filter(x => endPos(x) != null && endPos(x) <= 3).length, top10 = rows.filter(x => endPos(x) != null && endPos(x) <= 10).length;
  const ranked = rows.filter(x => x.d != null && x.c.impr >= 100);
  const best = ranked.slice().sort((a, b) => b.d - a.d)[0], worst = ranked.slice().sort((a, b) => a.d - b.d)[0];
  const acts = P.actions.filter(a => a.date && a.date.slice(0, 7) === m);
  const sign = x => x == null ? "" : (x > 0 ? "+" : "") + Math.round(x) + " %";
  const partial = !complete(m);

  // Commentaire construit uniquement à partir des chiffres
  const s = [];
  s.push(`En ${mlabel(m)}${partial ? ` (données jusqu'au ${fmtDateL(md[md.length - 1])})` : ""}, le site a généré ${fmt(nb.clicks)} clics hors marque depuis Google${nbp.clicks ? `, soit ${sign(pct(nb.clicks, nbp.clicks))} par rapport à ${mlabel(pm)}` : ""}${nb1.clicks ? ` et ${sign(pct(nb.clicks, nb1.clicks))} par rapport à ${mlabel(nm)}` : ""}.`);
  s.push(`Les ${rows.length} mots-clés suivis totalisent ${fmt(tr.clicks)} clics${trp.clicks ? ` (${sign(pct(tr.clicks, trp.clicks))} sur un mois)` : ""}, pour une position moyenne de ${fmt1(tr.pos)}${trp.pos ? ` contre ${fmt1(trp.pos)} le mois précédent` : ""}. En fin de mois, ${top3} sont dans le top 3 et ${top10} dans le top 10.`);
  if (best && best.d > 0.2) s.push(`Plus forte progression : « ${best.k.keyword} », de ${fmt1(best.p.wpos)} à ${fmt1(best.c.wpos)} en position moyenne.`);
  if (worst && worst.d < -0.2) s.push(`Plus fort recul : « ${worst.k.keyword} », de ${fmt1(worst.p.wpos)} à ${fmt1(worst.c.wpos)}.`);
  s.push(acts.length ? `${acts.length} action${acts.length > 1 ? "s" : ""} SEO mise${acts.length > 1 ? "s" : ""} en ligne ce mois-ci, détaillée${acts.length > 1 ? "s" : ""} ci-dessous.` : "Aucune action SEO consignée dans le journal ce mois-ci.");
  const ups = (IDX.google_updates || []).filter(u => isRankingUpdate(u) && u.begin.slice(0, 7) === m);
  if (ups.length) s.push(`Google a déployé ${ups.map(u => `la « ${u.title} » (${fmtDateL(u.begin)})`).join(" et ")}.`);

  // 13 derniers mois de clics hors marque
  const last13 = []; for (let i = 12; i >= 0; i--) last13.push(shiftMonth(m, -i));
  const monthly = last13.map(x => segSum("nonbrand", monthDates(x)).clicks);

  $("view").innerHTML = `
    <div class="page-head no-print"><div><h1>Rapport mensuel</h1><p>Généré à partir des données du dashboard. Le commentaire est construit uniquement à partir des chiffres : à relire et compléter avant envoi.</p></div>
      <div style="display:flex;gap:8px"><select id="month" class="btn ghost">${months.map(x => `<option value="${x}" ${x === m ? "selected" : ""}>${mlabel(x)}${complete(x) ? "" : " (en cours)"}</option>`).join("")}</select>
      <button class="btn" onclick="window.print()"><svg class="i" viewBox="0 0 24 24"><path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M6 14h12v7H6z"/></svg>Imprimer / PDF</button></div></div>
    <div class="report">
      <div class="report-head"><div class="logo">${document.querySelector(".brand svg").outerHTML}datashake</div>
        <div class="meta"><div><strong>Client</strong> ${esc(P.label)}</div><div><strong>Période</strong> ${mlabel(m)}</div><div><strong>Consultant</strong> ${esc(P.owner || "")}</div><div><strong>Source</strong> Google Search Console</div></div></div>
      <h1>Rapport SEO · ${mlabel(m)}</h1>
      <p class="lede">${s.map(esc).join(" ")}</p>
      <div class="hero">
        <div><div class="num">${fmt(nb.clicks)}</div><div class="lbl">Clics hors marque</div><div class="cmp">${sign(pct(nb.clicks, nbp.clicks)) || "–"} vs M-1 · ${sign(pct(nb.clicks, nb1.clicks)) || "–"} vs N-1</div></div>
        <div><div class="num">${fmt(tr.clicks)}</div><div class="lbl">Clics mots-clés suivis</div><div class="cmp">${sign(pct(tr.clicks, trp.clicks)) || "–"} vs M-1 · ${sign(pct(tr.clicks, tr1.clicks)) || "–"} vs N-1</div></div>
        <div><div class="num">${fmt1(tr.pos)}</div><div class="lbl">Position moyenne suivie</div><div class="cmp">${fmt1(trp.pos)} le mois précédent</div></div>
        <div><div class="num">${top3} / ${top10}</div><div class="lbl">Top 3 / top 10</div><div class="cmp">sur ${rows.length} mots-clés · visibilité ${fmt1(v)} % (${vp != null && v != null ? (v - vp >= 0 ? "+" : "") + fmt1(v - vp) + " pt" : "–"})</div></div>
      </div>
      <section><div class="section-head"><h2>Trafic hors marque, 13 derniers mois</h2><span class="section-num">01</span></div><div class="chart-box sm"><canvas id="r-months"></canvas></div></section>
      <section><div class="section-head"><h2>Mots-clés suivis</h2><span class="section-num">02</span></div>
        <div class="box"><table><thead><tr><th>Mot-clé</th><th class="num">Position ${MONTHS[+m.slice(5) - 1]}</th><th class="num">M-1</th><th class="num">Évolution</th><th class="num">Clics</th><th class="num">vs M-1</th></tr></thead><tbody>
        ${rows.sort((a, b) => b.c.clicks - a.c.clicks).map(x => `<tr><td><b>${esc(x.k.keyword)}</b></td><td class="num">${fmt1(x.c.wpos)}</td><td class="num">${fmt1(x.p.wpos)}</td><td class="num">${deltaPill(x.d)}</td><td class="num">${fmt(x.c.clicks)}</td><td class="num">${deltaPill(pct(x.c.clicks, x.p.clicks), { pct: true })}</td></tr>`).join("")}
        </tbody></table></div></section>
      <section><div class="section-head"><h2>Actions du mois</h2><span class="section-num">03</span></div>
        ${acts.length ? `<div class="box"><table><thead><tr><th>Date</th><th>Action</th><th>Page</th><th class="num">Position avant → après</th><th class="num">Impact corrigé</th></tr></thead><tbody>
          ${acts.map(a => `<tr><td>${fmtDate(a.date)}</td><td><b>${esc(a.title)}</b><div class="light">${esc(a.type || "")}</div></td><td>${a.page ? urlLink(a.page) : ""}</td>
          <td class="num">${a.impact ? fmt1(a.impact.pos_before) + " → " + fmt1(a.impact.pos_after) : "–"}</td><td class="num">${a.impact && a.impact.clicks_month_adjusted != null ? (a.impact.clicks_month_adjusted > 0 ? "+" : "") + fmt(a.impact.clicks_month_adjusted) + " clics / mois" : esc(a.reason || "–")}</td></tr>`).join("")}</tbody></table></div>`
          : '<p class="muted">Aucune action consignée ce mois-ci.</p>'}</section>
      ${m === months[0] || m === months.find(complete) ? `<section><div class="section-head"><h2>Points de vigilance</h2><span class="section-num">04</span></div>
        ${P.alerts.length ? P.alerts.slice(0, 8).map(a => `<div class="feed-row">${sevTag(a.severity)}<b>${esc(a.keyword || TYPES[a.type] || "")}</b><span class="muted">${esc(a.text)}</span></div>`).join("") : '<p class="muted">Aucune alerte ouverte.</p>'}</section>` : ""}
      <div class="footer"><div>datashake · Rapport SEO · ${esc(P.label)}</div><div>${fmtDateL(new Date().toISOString().slice(0, 10))}</div></div>
    </div>`;
  $("month").onchange = e => { ui.month = e.target.value; renderReport(); };
  chart("r-months", { type: "bar", data: { labels: last13.map(x => MONTHS[+x.slice(5) - 1].slice(0, 4) + ". " + x.slice(2, 4)), datasets: [{ data: monthly,
      backgroundColor: last13.map(x => x === m ? "#101010" : "#C9C9C9"), borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom", maxBarThickness: 36 }] },
    options: { maintainAspectRatio: false, animation: false, scales: { y: linScale(), x: { grid: { display: false } } }, plugins: { legend: { display: false }, tooltip: tooltip({ label: c => ` ${fmt(c.parsed.y)} clics` }) } } });
}

const monthDates = m => { const out = []; let d = m + "-01"; while (d.slice(0, 7) === m) { out.push(d); d = shift(d, 1); } return out; };
const lastDay = m => monthDates(m).pop();
const shiftMonth = (m, n) => { const t = new Date(m + "-01T00:00:00Z"); t.setUTCMonth(t.getUTCMonth() + n); return t.toISOString().slice(0, 7); };
const prevMonth = m => shiftMonth(m, -1);

load();
