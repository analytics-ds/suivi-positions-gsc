"use strict";
// Suivi de positions datashake : application statique (GitHub Pages) qui lit docs/data/*.json.
// Une vue = une question du consultant : À traiter, Mots-clés, Trafic du site, Actions, Opportunités, Rapport.

const REPO = "analytics-ds/suivi-positions-gsc";
const GH = "https://github.com/" + REPO;
// Palette catégorielle validée (ordre fixe par mot-clé sélectionné, jamais cyclée sur le rang).
const PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const MAX_SEL = 8, NEUTRAL = "#9A9A9A", INK = "#101010", MUTED = "rgba(16,16,16,0.5)", GRID = "#F0F0EF", N1 = "#B9B9B9";
const EXT = '<svg class="i" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
const VIEWS = [["", "À traiter"], ["mots-cles", "Mots-clés"], ["trafic", "Trafic du site"], ["actions", "Actions"], ["opportunites", "Opportunités"], ["rapport", "Rapport"]];
const PERIOD_VIEWS = ["mots-cles", "trafic"];
const SEV = { critique: "Urgent", attention: "À surveiller", info: "Info" };
const TYPES = { baisse: "Recul", top3: "Sortie du top 3", top10: "Sortie du top 10", hausse: "Progression", disparue: "Page disparue",
  impressions: "Baisse d'impressions", page: "Une autre page prend le relais", indexation: "Indexation", canonical: "Canonique", synchro: "Synchro", inspection: "Indexation" };
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

// Définitions affichées dans les info-bulles et reprises dans le guide
const DEF = {
  position: "Position moyenne Google de la page suivie sur le mot-clé, pondérée par les impressions (moyenne GSC, pas un relevé ponctuel).",
  positionSite: "Position moyenne du site toutes pages confondues. Si elle diffère de la page suivie, une autre page du site se positionne aussi.",
  top: "Nombre de mots-clés suivis dont la page est dans le top 3 ou le top 10 au dernier jour de la période.",
  clicsSuivis: "Clics apportés par les mots-clés suivis, sur leur page suivie uniquement.",
  visibilite: "Part des clics captés par rapport à ce que le site obtiendrait en 1re position sur tous ses mots-clés suivis. 100 % = tout en 1re position.",
  aGagner: "Clics supplémentaires par mois si la page monte dans le top 3 (ou à la 1re place si elle y est déjà), calculés avec le taux de clic réel du client à chaque position.",
  horsMarque: "Clics Google sur toutes les requêtes qui ne contiennent pas le nom de la marque (fautes de frappe comprises).",
  marque: "Clics Google sur les requêtes qui contiennent le nom de la marque.",
  anonymes: "Requêtes trop rares que Google masque dans le détail : leurs clics comptent dans le total mais ne sont ni en marque ni en hors marque.",
  n1: "Même période, un an plus tôt (décalée de 364 jours pour comparer les mêmes jours de la semaine).",
  provisoire: "Les 3 derniers jours de la Search Console ne sont pas définitifs : ils sont tracés en pointillés et réécrits à la synchro suivante.",
  impact: "Clics par jour après l'action moins clics par jour avant, corrigés de la tendance des mots-clés non travaillés (groupe témoin), ramenés à un mois.",
};
const info = key => `<i class="info" title="${esc(DEF[key] || key)}">i</i>`;

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
const norm = u => (u || "").replace(/\/$/, "");
const isRankingUpdate = u => (u.service ? u.service === "Ranking" : /update/i.test(u.title)) && !/discover/i.test(u.title);
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

let IDX = null, P = null, route = { site: null, view: "" };
const cache = {}, charts = {};
const ui = { days: 28, metric: "position", sel: {}, sort: { key: "impr", dir: -1 }, query: "", tags: new Set(), openKw: null,
  n1: false, sug: "all", month: null, kwMode: "kw", who: store.get("who") || "" };

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
  let site = parts[0] || null, view = parts[1] || "";
  if (view === "alertes") view = "";                          // anciennes adresses
  if (view === "pages") { view = "mots-cles"; ui.kwMode = "page"; }
  closeDrawer(true);
  $("app").classList.remove("nav-open");
  if (site !== route.site) { ui.openKw = null; ui.tags.clear(); ui.query = ""; ui.month = null; }
  route = { site, view };
  Object.values(charts).forEach(c => c.destroy());
  for (const k in charts) delete charts[k];
  if (site === "guide") { P = null; renderChrome(); return renderGuide(); }
  if (site) {
    $("view").innerHTML = '<div class="loading">Chargement…</div>';
    try { P = await project(site); } catch { $("view").innerHTML = '<div class="empty">Projet introuvable.</div>'; return; }
  } else P = null;
  renderChrome();
  if (!P) return renderPortfolio();
  ({ "": renderToday, "mots-cles": renderKeywords, trafic: renderTraffic, actions: renderActions, opportunites: renderOpps, rapport: renderReport }[view] || renderToday)();
  window.scrollTo(0, 0);
}

function bindChrome() {
  $("menu-btn").onclick = () => $("app").classList.toggle("nav-open");
  $("scrim").onclick = () => closeDrawer();
  document.addEventListener("keydown", e => e.key === "Escape" && closeDrawer());
  document.querySelectorAll("#period button").forEach(b => b.onclick = () => {
    ui.days = +b.dataset.days;
    document.querySelectorAll("#period button").forEach(x => x.classList.toggle("active", x === b));
    route.view === "trafic" ? renderTraffic() : renderKeywords();
  });
  $("lnk-project").href = issue("projet.yml", { title: "Projet : " });
  $("lnk-sync").href = `${GH}/actions/workflows/daily.yml`;
  $("lnk-doc").href = "#/guide";
  $("lnk-doc").removeAttribute("target");
}

const owners = () => [...new Set(IDX.projects.map(p => p.owner).filter(Boolean))].sort();
const myProjects = () => IDX.projects.filter(p => !ui.who || p.owner === ui.who);
const nAlerts = p => p.alerts.critique + p.alerts.attention;

function renderChrome() {
  const sev = p => p.alerts.critique ? "ko" : p.alerts.attention ? "warn" : "ok";
  $("projects").innerHTML = `<div class="who"><select id="who" aria-label="Consultant"><option value="">Tous les consultants</option>${owners().map(o => `<option ${o === ui.who ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>`
    + myProjects().map(p => `<a href="#/${p.name}" class="${route.site === p.name ? "active" : ""}">
    <span class="avatar">${esc(p.label[0].toUpperCase())}</span>${esc(p.label)}
    ${nAlerts(p) ? `<span class="count ${sev(p)}" title="Alertes à traiter">${nAlerts(p)}</span>` : ""}</a>`).join("");
  $("who").onchange = e => { ui.who = e.target.value; store.set("who", ui.who); renderChrome(); if (!route.site) renderPortfolio(); };
  $("nav-portfolio").classList.toggle("active", !route.site);
  $("lnk-doc").classList.toggle("active", route.site === "guide");
  const site = P ? P.name : "";
  $("lnk-action").href = issue("action.yml", { projet: site, title: "Action : " });
  $("lnk-kw").href = issue("mot-cle.yml", { projet: site, title: "Mot-clé : " });

  // Statut de synchro réel : le pire des projets
  const today = new Date().toISOString().slice(0, 10);
  const states = IDX.projects.map(p => ({ p, ko: p.status && p.status.ok === false, late: p.last_date ? Math.round((Date.parse(today) - Date.parse(p.last_date)) / 864e5) : 99 }));
  const worst = states.find(s => s.ko) || states.find(s => s.late > 4);
  const gen = new Date(IDX.generated_at).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const last = states.map(s => s.p.last_date).filter(Boolean).sort().pop();
  $("sync").innerHTML = `<div class="sync"><span class="dot ${worst ? "ko" : "ok"}"></span>${worst ? "Synchro en échec" : "Données à jour"}</div>
    <div>Mis à jour le ${gen}</div><div>Search Console jusqu'au ${last ? fmtDate(last) : "–"}</div>
    ${worst ? `<div style="color:var(--status-ko);margin-top:4px">${esc(worst.p.label)} : ${esc(worst.ko ? worst.p.status.error : "pas de donnée depuis " + worst.late + " jours")}</div>` : ""}`;

  const crumbs = $("crumbs");
  $("period").hidden = !(P && PERIOD_VIEWS.includes(route.view));
  document.querySelectorAll("#period button").forEach(x => x.classList.toggle("active", +x.dataset.days === ui.days));
  if (!P) {
    crumbs.innerHTML = route.site === "guide" ? "Guide d'utilisation" : "Portefeuille";
    $("chip-prop").hidden = true; $("subnav").hidden = true;
    document.title = `${route.site === "guide" ? "Guide" : "Portefeuille"} · Positions · datashake`;
    return;
  }
  const vlabel = (VIEWS.find(v => v[0] === route.view) || VIEWS[0])[1];
  crumbs.innerHTML = `<span>${esc(P.label)}</span><span class="sep">/</span><span class="muted">${vlabel}</span>`;
  $("chip-prop").hidden = false; $("chip-prop").textContent = P.property;
  const n = P.alerts.length;
  $("subnav").hidden = false;
  $("subnav").innerHTML = VIEWS.map(([v, l]) => `<a href="#/${P.name}${v ? "/" + v : ""}" class="${route.view === v ? "active" : ""}">${l}${
    v === "" && n ? ` <span class="badge ${P.alerts.some(a => a.severity === "critique") ? "ko" : "warn"}">${n}</span>` : ""}${
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
const periodLabel = dates => dates.length ? `du ${fmtDate(dates[0])} au ${fmtDate(dates[dates.length - 1])}` : "";

function kstats(k, dates, src = "map") {
  const m = k[src];
  const pts = dates.map(d => m.get(d) || null), present = pts.filter(Boolean);
  const clicks = present.reduce((a, p) => a + p[2], 0), impr = present.reduce((a, p) => a + p[3], 0);
  const wpos = impr ? present.reduce((a, p) => a + p[1] * p[3], 0) / impr : null;
  const first = present[0] || null, last = present[present.length - 1] || null;
  const delta = first && last && first !== last ? +(first[1] - last[1]).toFixed(1) : null; // positif = gain de places
  return { pts, present, clicks, impr, wpos, first, last, delta, ctr: impr ? clicks / impr * 100 : null };
}

function segSum(seg, dates) {
  const m = P.seg[seg]; let c = 0, i = 0;
  dates.forEach(d => { const x = m && m.get(d); if (x) { c += x[2]; i += x[3]; } });
  return { clicks: c, impr: i };
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
  (IDX.google_updates || []).filter(isRankingUpdate).forEach(u => { const idx = find(u.begin); if (idx >= 0) { items.push({ idx, kind: "g" }); legend.push(`<span><span class="mk g">G</span>${fmtDate(u.begin)} · <a href="${esc(u.url)}" target="_blank" rel="noopener">${esc(u.title)}</a></span>`); } });
  if (opts.actions !== false) (P.actions || []).filter(a => !opts.page || norm(a.page) === norm(opts.page)).forEach(a => {
    const idx = find(a.date); if (idx >= 0) { items.push({ idx, kind: "a" }); legend.push(`<span><span class="mk a">A</span>${fmtDate(a.date)} · ${esc(a.title)}</span>`); }
  });
  return { items, html: legend.length ? `<div class="marks">${legend.join("")}</div>` : "" };
}

function selection() {
  if (!ui.sel[P.name]) {
    const m = new Map(), d28 = P.dates.slice(-28);
    P.keywords.map(k => ({ k, c: kstats(k, d28).clicks })).sort((a, b) => b.c - a.c).slice(0, MAX_SEL).forEach((x, slot) => m.set(x.k.i, slot));
    ui.sel[P.name] = m;
  }
  return ui.sel[P.name];
}
const colorOf = k => { const s = selection(); return s.has(k.i) ? PALETTE[s.get(k.i)] : NEUTRAL; };

function toggleSel(i) {
  const sel = selection();
  if (sel.has(i)) sel.delete(i);
  else if (sel.size < MAX_SEL) { const used = new Set(sel.values()); sel.set(i, [...Array(MAX_SEL).keys()].find(s => !used.has(s))); }
  renderKeywords();
}

// Mouvements de la semaine : 7 derniers jours définitifs vs 7 jours précédents
function weekMoves() {
  const lf = P.last_final, a = shift(lf, -6), b0 = shift(lf, -13), b1 = shift(lf, -7);
  const win = (k, x, y) => { let c = 0, i = 0, pw = 0; k.s.forEach(p => { if (!p[4] && p[0] >= x && p[0] <= y) { c += p[2]; i += p[3]; pw += p[1] * p[3]; } }); return { c, i, pos: i ? pw / i : null }; };
  return P.keywords.map(k => { const n = win(k, a, lf), o = win(k, b0, b1); return { k, now: n, before: o, d: n.pos != null && o.pos != null ? o.pos - n.pos : null }; })
    .filter(x => x.d != null && x.now.i >= 30);
}

// ---------------------------------------------------------------- composants

function deltaPill(d, { pct: isPct = false, suffix = "" } = {}) {
  if (d == null || !isFinite(d)) return `<span class="pill flat">–</span>`;
  if (Math.abs(d) < (isPct ? 0.5 : 0.05)) return `<span class="pill flat">=</span>`;
  const txt = isPct ? Math.round(Math.abs(d)) + " %" : fmt1(Math.abs(d)) + suffix;
  return `<span class="pill ${d > 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"} ${txt}</span>`;
}
const placesPill = d => deltaPill(d, { suffix: d != null && Math.abs(d) >= 2 ? " places" : " place" });

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
const sevTag = s => `<span class="sev ${s}">${SEV[s] || s}</span>`;
const kpi = (lbl, val, sub, key) => `<div class="card kpi"><div class="lbl"><span>${lbl}</span>${key ? info(key) : ""}</div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
const vs = (cur, ref, label) => `<span>${ref ? deltaPill(pct(cur, ref), { pct: true }) : '<span class="pill flat">–</span>'} ${label}</span>`;
const intro = (title, text, right = "", scope = "") => `<div class="intro"><div>${scope ? `<div class="scope">${scope}</div>` : ""}<h1>${title}</h1><p>${text}</p></div>${right}</div>`;

function sortable(tableId, render) {
  document.querySelectorAll(`#${tableId} th[data-sort]`).forEach(th => {
    const on = th.dataset.sort === ui.sort.key;
    th.classList.toggle("sorted", on);
    const ar = th.querySelector(".arrow"); if (ar) ar.textContent = on ? (ui.sort.dir > 0 ? "↑" : "↓") : "↕";
    th.onclick = () => { const k = th.dataset.sort; ui.sort = ui.sort.key === k ? { key: k, dir: -ui.sort.dir } : { key: k, dir: ["keyword", "page", "pos"].includes(k) ? 1 : -1 }; render(); };
  });
}

// ---------------------------------------------------------------- Portefeuille

function renderPortfolio() {
  const list = myProjects();
  const rows = list.map(p => `<tr class="click" onclick="location.hash='#/${p.name}'">
    <td><span class="kw"><span class="avatar">${esc(p.label[0])}</span>${esc(p.label)}</span><div class="light" style="font-size:12px">${esc(p.property)}</div></td>
    <td>${esc(p.owner || "–")}</td>
    <td>${p.alerts.critique ? `<span class="badge ko">${p.alerts.critique} urgent${p.alerts.critique > 1 ? "es" : "e"}</span> ` : ""}${p.alerts.attention ? `<span class="badge warn">${p.alerts.attention} à surveiller</span>` : ""}${!nAlerts(p) ? '<span class="badge ok">Rien à signaler</span>' : ""}</td>
    <td class="num">${fmt(p.nonbrand_clicks)}</td>
    <td class="num">${deltaPill(p.nonbrand_vs_n1, { pct: true })}</td>
    <td class="num">${fmt1(p.position)} ${placesPill(p.position_prev != null && p.position != null ? p.position_prev - p.position : null)}</td>
    <td class="num">${p.top10 ?? "–"} / ${p.n_keywords}</td>
    <td>${p.last_date ? fmtDate(p.last_date) : "–"}</td></tr>`).join("");
  const ups = (IDX.google_updates || []).filter(isRankingUpdate).slice(-5).reverse();
  $("view").innerHTML = intro(ui.who ? `Projets de ${esc(ui.who)}` : "Portefeuille",
      "Un projet par ligne, sur les 28 derniers jours de données définitives. Commence par les projets qui ont des alertes à traiter.",
      `<a class="btn" href="${issue("projet.yml", { title: "Projet : " })}" target="_blank" rel="noopener"><svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Nouveau projet</a>`)
    + `<div class="card" style="margin-bottom:18px"><div class="table-wrap"><table>
      <thead><tr><th>Projet</th><th>Consultant</th><th>À traiter</th>
        <th class="num">Clics hors marque ${info("horsMarque")}</th><th class="num">vs N-1 ${info("n1")}</th>
        <th class="num">Position moyenne ${info("position")}</th><th class="num">Mots-clés en top 10</th><th>Données au</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="8" class="big-empty">Aucun projet${ui.who ? " pour ce consultant" : ""}. Crée le premier avec « Nouveau projet ».</td></tr>`}</tbody></table></div></div>
    <div class="card"><div class="card-head"><h2>Dernières mises à jour de Google</h2><span class="hint">elles peuvent expliquer des mouvements sur tous les projets</span></div>
      <div class="card-body">${ups.map(u => `<div class="feed-row"><span class="light" style="width:90px">${fmtDate(u.begin)}</span><a href="${esc(u.url)}" target="_blank" rel="noopener">${esc(u.title)}</a><span class="light">${u.end ? "terminée le " + fmtDate(u.end) : "en cours"}</span></div>`).join("") || '<div class="empty-note">Aucune.</div>'}</div></div>`;
}

// ---------------------------------------------------------------- À traiter

function renderToday() {
  const moves = weekMoves();
  const ups = moves.filter(x => x.d >= 0.5).sort((a, b) => b.d - a.d).slice(0, 5);
  const downs = moves.filter(x => x.d <= -0.5).sort((a, b) => a.d - b.d).slice(0, 5);
  const measuring = P.actions.filter(a => a.days_after >= 0 && a.days_after < 28);
  const lf = P.last_final;
  const alertCard = a => `<div class="card item">${sevTag(a.severity)}<div>
      <h3>${a.keyword ? esc(a.keyword) : esc(TYPES[a.type] || a.type)} <span class="light" style="font-weight:500">· ${esc(TYPES[a.type] || a.type)}</span></h3><p>${esc(a.text)}</p>
      <div class="meta">${a.page && a.page !== "*" ? urlLink(a.page) : ""}<span>constaté au ${fmtDate(a.date)}</span></div></div>
      <div class="num">${a.impact ? `<div class="pos">−${fmt(a.impact)}</div><div class="light" style="font-size:11px">clics / mois en jeu</div>` : ""}
      ${a.i != null ? `<button class="btn ghost sm" data-open="${a.i}" style="margin-top:6px">Ouvrir le mot-clé</button>` : ""}</div></div>`;
  const moveRow = x => `<tr class="click" data-i="${x.k.i}"><td><b>${esc(x.k.keyword)}</b></td><td class="num">${fmt1(x.before.pos)} → <b>${fmt1(x.now.pos)}</b></td><td class="num">${placesPill(x.d)}</td></tr>`;
  const evs = P.events.filter(e => e.severity !== "info" || e.type === "hausse").slice(0, 40);
  const byDay = {};
  evs.forEach(e => (byDay[e.date] = byDay[e.date] || []).push(e));

  $("view").innerHTML = intro(`À traiter sur ${esc(P.label)}`,
      `Ce qui demande ton attention, calculé chaque matin sur les données définitives de la Search Console (jusqu'au ${fmtDateL(lf)}).`)
    + `<div class="kpis k3">
        ${kpi("Alertes à traiter", P.alerts.length, `<span>${P.alerts.filter(a => a.severity === "critique").length} urgente(s), ${P.alerts.filter(a => a.severity === "attention").length} à surveiller</span>`)}
        ${kpi("Mouvements de la semaine", `${ups.length}<small> hausses</small> · ${downs.length}<small> baisses</small>`, `<span>7 derniers jours vs 7 jours précédents</span>`)}
        ${kpi("Actions en cours de mesure", measuring.length, `<span>${P.actions.length} action(s) dans le journal</span>`)}
      </div>
      <div class="section-title"><h2>Alertes à traiter</h2><span>une alerte reste ouverte tant que le problème est constaté</span></div>
      <div class="list">${P.alerts.map(alertCard).join("") || '<div class="card big-empty"><b>Rien à signaler.</b> Aucune alerte ouverte sur ce projet.</div>'}</div>
      <div class="section-title"><h2>Cette semaine</h2><span>position moyenne, ${fmtDate(shift(lf, -6))} au ${fmtDate(lf)} vs 7 jours précédents</span></div>
      <div class="mv">
        <div class="card"><div class="card-head"><h2>Plus fortes hausses</h2></div><div class="table-wrap"><table><tbody>${ups.map(moveRow).join("") || '<tr><td class="empty-note">Aucune hausse d\'au moins une demi-place.</td></tr>'}</tbody></table></div></div>
        <div class="card"><div class="card-head"><h2>Plus fortes baisses</h2></div><div class="table-wrap"><table><tbody>${downs.map(moveRow).join("") || '<tr><td class="empty-note">Aucune baisse d\'au moins une demi-place.</td></tr>'}</tbody></table></div></div>
      </div>
      ${measuring.length ? `<div class="section-title"><h2>Actions en cours de mesure</h2><a href="#/${P.name}/actions">Tout le journal</a></div>
        <div class="list">${measuring.map(a => `<div class="card item"><span class="badge">${esc(a.type || "autre")}</span><div><h3>${esc(a.title)}</h3><div class="meta"><span>${fmtDateL(a.date)}</span>${a.page ? urlLink(a.page) : ""}<span>${a.days_after} jour(s) de recul sur 28</span></div></div><div></div></div>`).join("")}</div>` : ""}
      <details class="fold"><summary>Historique des 30 derniers jours et mises à jour Google</summary><div class="grid-2">
        <div class="card"><div class="card-body">${Object.keys(byDay).sort().reverse().map(d => `<div class="feed-day">${fmtDateL(d)}</div>` + byDay[d].map(e =>
          `<div class="feed-row">${sevTag(e.severity)}<span style="min-width:150px">${e.i != null ? `<span class="k" data-i="${e.i}">${esc(e.keyword)}</span>` : urlLink(e.page || "*")}</span><span class="muted">${esc(e.text)}</span></div>`).join("")).join("") || '<div class="empty-note">Aucun événement.</div>'}</div></div>
        <div class="card"><div class="card-body">${(IDX.google_updates || []).filter(isRankingUpdate).slice().reverse().map(u => `<div class="feed-row" style="flex-direction:column;gap:0"><a href="${esc(u.url)}" target="_blank" rel="noopener" style="font-weight:600">${esc(u.title)}</a><span class="light">${fmtDateL(u.begin)}${u.end ? " au " + fmtDateL(u.end) : ", en cours"}</span></div>`).join("")}</div></div>
      </div></details>`;
  document.querySelectorAll("[data-open], [data-i]").forEach(el => el.onclick = () => openDrawer(+(el.dataset.open ?? el.dataset.i)));
}

// ---------------------------------------------------------------- Mots-clés

function renderKeywords() {
  if (!P) return;
  const { dates, prev } = periodDates();
  const kws = P.keywords.map(k => ({ ...k, st: kstats(k, dates), site: kstats(k, dates, "smap") }));
  const sel = selection();
  kws.forEach(k => { k.on = sel.has(k.i); k.color = colorOf(k); });
  const tr = trackedSum(dates), trp = trackedSum(prev);
  const v = visAvg(dates), vp = visAvg(prev);
  const top3 = kws.filter(k => k.st.last && k.st.last[1] <= 3).length, top10 = kws.filter(k => k.st.last && k.st.last[1] <= 10).length;
  const mode = ui.kwMode;

  $("view").innerHTML = intro("Positions des mots-clés suivis",
      `Uniquement les ${kws.length} mots-clés que tu suis, chacun sur sa page. Période ${periodLabel(dates)}, comparée à la période précédente de même durée.`,
      `<div style="display:flex;gap:8px;align-items:center"><div class="tabs" id="kw-mode"><button data-m="kw" class="${mode === "kw" ? "active" : ""}">Par mot-clé</button><button data-m="page" class="${mode === "page" ? "active" : ""}">Par page</button></div>
       <a class="btn sm" href="${issue("mot-cle.yml", { projet: P.name, title: "Mot-clé : " })}" target="_blank" rel="noopener"><svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Suivre un mot-clé</a></div>`,
      "Mots-clés suivis")
    + `<div class="kpis k5">
      ${kpi("Position moyenne", fmt1(tr.pos), `<span>${placesPill(trp.pos != null && tr.pos != null ? trp.pos - tr.pos : null)} vs période préc.</span>`, "position")}
      ${kpi("En top 3", `${top3}<small> / ${kws.length}</small>`, "<span>au dernier jour de la période</span>", "top")}
      ${kpi("En top 10", `${top10}<small> / ${kws.length}</small>`, "<span>au dernier jour de la période</span>", "top")}
      ${kpi("Clics sur ces mots-clés", fmt(tr.clicks), vs(tr.clicks, trp.clicks, "vs période préc."), "clicsSuivis")}
      ${kpi("Visibilité", v == null ? "–" : fmt1(v) + "<small> %</small>", `<span>${deltaPill(v != null && vp != null ? v - vp : null, { suffix: " pt" })} vs période préc.</span>`, "visibilite")}
    </div><div id="kw-body"></div>`;
  document.querySelectorAll("#kw-mode button").forEach(b => b.onclick = () => { ui.kwMode = b.dataset.m; renderKeywords(); });
  mode === "page" ? renderByPage() : renderByKeyword(kws, dates);
  if (ui.openKw != null) openDrawer(ui.openKw, true);
}

function renderByKeyword(kws, dates) {
  const sel = selection();
  const alertKw = new Set(P.alerts.filter(a => a.i != null).map(a => a.i));
  $("kw-body").innerHTML = `
    <div class="grid-2">
      <div class="card"><div class="card-head"><h2>Évolution</h2>
        <div class="tabs" id="metric">${[["position", "Position"], ["clicks", "Clics"], ["impressions", "Impressions"]].map(([m, l]) => `<button data-m="${m}" class="${ui.metric === m ? "active" : ""}">${l}</button>`).join("")}</div></div>
        <div class="card-body"><div class="legend" id="legend"></div><div class="chart-box"><canvas id="c-main"></canvas></div><div id="marks-main"></div></div></div>
      <div class="card"><div class="card-head"><h2>Où sont les mots-clés</h2><span class="hint">au dernier jour</span></div>
        <div class="card-body"><div class="dist-bar" id="dist-bar"></div><div id="dist-rows"></div></div></div>
    </div>
    <div class="card">
      <div class="toolbar"><h2>Tous les mots-clés suivis</h2>
        <label class="search"><svg class="i" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="q" placeholder="Mot-clé ou URL" value="${esc(ui.query)}"></label>
        <button class="btn ghost sm" id="csv"><svg class="i" viewBox="0 0 24 24"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/></svg>Exporter</button></div>
      <div class="chips" id="tags"></div>
      <div class="table-wrap"><table id="t-kw"><thead><tr>
        <th style="width:30px" title="Afficher sur le graphique (8 maximum)"></th>
        <th data-sort="keyword">Mot-clé<span class="arrow">↕</span></th><th data-sort="page">Page suivie<span class="arrow">↕</span></th>
        <th class="num" data-sort="pos">Position ${info("position")}<span class="arrow">↕</span></th><th class="num" data-sort="delta">Évolution<span class="arrow">↕</span></th>
        <th>Tendance</th><th class="num" data-sort="clicks">Clics<span class="arrow">↕</span></th><th class="num" data-sort="impr">Impressions<span class="arrow">↕</span></th>
        <th class="num" data-sort="potential">Clics à gagner / mois ${info("aGagner")}<span class="arrow">↕</span></th>
      </tr></thead><tbody id="tbody"></tbody></table></div>
      <div class="table-foot"><span id="t-count"></span><span>Clique sur une ligne pour le détail. La case de gauche ajoute le mot-clé au graphique. Les pointillés = données provisoires ${info("provisoire")}</span></div>
    </div>`;
  document.querySelectorAll("#metric button").forEach(b => b.onclick = () => { ui.metric = b.dataset.m; renderKeywords(); });
  $("q").oninput = e => { ui.query = e.target.value.trim().toLowerCase(); renderKwTable(kws, alertKw); };
  $("csv").onclick = () => exportCsv(kws, dates);

  const on = kws.filter(k => k.on).sort((a, b) => sel.get(a.i) - sel.get(b.i));
  $("legend").innerHTML = on.map(k => `<button data-i="${k.i}" title="Retirer du graphique"><span class="sw" style="background:${k.color}"></span>${esc(k.keyword)}<span class="x">×</span></button>`).join("")
    + `<span class="hint">${on.length} / ${MAX_SEL} affichés · les 8 qui font le plus de clics par défaut</span>`;
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

  const buckets = [
    { name: "Top 3", test: p => p != null && p <= 3, color: "#2a78d6" }, { name: "Positions 4 à 10", test: p => p > 3 && p <= 10, color: "#86b6ef" },
    { name: "Positions 11 à 20", test: p => p > 10 && p <= 20, color: "#cde2fb" }, { name: "Au-delà de 20", test: p => p > 20, color: "#D4D4D4" },
    { name: "Sans donnée", test: p => p == null, color: "#EDEDED" }];
  const lasts = kws.map(k => k.st.last ? k.st.last[1] : null);
  buckets.forEach(b => b.n = lasts.filter(b.test).length);
  const shown = buckets.filter(b => b.n || b.name !== "Sans donnée");
  $("dist-bar").innerHTML = shown.filter(b => b.n).map(b => `<div title="${b.name} : ${b.n}" style="flex:${b.n};background:${b.color}"></div>`).join("");
  $("dist-rows").innerHTML = shown.map(b => `<div class="dist-row"><span class="sw" style="background:${b.color}"></span><span class="muted">${b.name}</span><span class="n">${b.n}</span></div>`).join("");

  const all = [...new Set(P.keywords.flatMap(k => k.tags))].sort();
  $("tags").hidden = !all.length;
  $("tags").innerHTML = `<span class="light" style="font-size:12px;align-self:center">Filtrer :</span><button class="${ui.tags.size ? "" : "on"}" data-t="">Tous</button>` + all.map(t => `<button class="${ui.tags.has(t) ? "on" : ""}" data-t="${esc(t)}">${esc(t)}</button>`).join("");
  document.querySelectorAll("#tags button").forEach(b => b.onclick = () => {
    const t = b.dataset.t;
    if (!t) ui.tags.clear(); else ui.tags.has(t) ? ui.tags.delete(t) : ui.tags.add(t);
    renderKeywords();
  });
  renderKwTable(kws, alertKw);
}

function filteredKws(kws) {
  return kws.filter(k => (!ui.query || k.keyword.toLowerCase().includes(ui.query) || k.page.toLowerCase().includes(ui.query) || k.variants.some(v => v.includes(ui.query)))
    && (!ui.tags.size || k.tags.some(t => ui.tags.has(t))));
}

function renderKwTable(kws, alertKw) {
  const sv = { keyword: k => k.keyword, page: k => k.page, pos: k => k.st.last ? k.st.last[1] : 999, delta: k => k.st.delta ?? -999,
    clicks: k => k.st.clicks, impr: k => k.st.impr, potential: k => k.potential ?? -1 }[ui.sort.key] || (k => k.st.impr);
  const rows = filteredKws(kws).sort((a, b) => { const x = sv(a), y = sv(b); return (x < y ? -1 : x > y ? 1 : 0) * ui.sort.dir; });
  const sel = selection();
  $("tbody").innerHTML = rows.map(k => {
    const pos = k.st.last ? k.st.last[1] : null;
    const pick = `<button class="pick ${k.on ? "on" : ""}" data-pick="${k.i}" ${!k.on && sel.size >= MAX_SEL ? "disabled" : ""} style="${k.on ? `background:${k.color}` : ""}" title="${k.on ? "Retirer du graphique" : "Afficher sur le graphique"}" aria-label="Graphique : ${esc(k.keyword)}"></button>`;
    return `<tr class="click ${k.i === ui.openKw ? "selected" : ""}" data-i="${k.i}">
      <td>${pick}</td>
      <td><span class="kw">${esc(k.keyword)}${k.variants.length ? ` <span class="badge" title="Variantes regroupées : ${esc(k.variants.join(", "))}">+${k.variants.length}</span>` : ""}${alertKw.has(k.i) ? ' <span class="warn-ico" title="Alerte ouverte">●</span>' : ""}</span>
        ${k.tags.length ? `<div style="margin-top:3px;display:flex;gap:4px">${k.tags.map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}</td>
      <td>${urlLink(k.page)}</td>
      <td class="num"><span class="pos-cell">${rankTag(pos)}<span class="pos">${fmt1(pos)}</span></span></td>
      <td class="num">${placesPill(k.st.delta)}</td>
      <td>${sparkline(k.st.pts, k.on ? k.color : "#8a8a8a")}</td>
      <td class="num">${fmt(k.st.clicks)}</td><td class="num">${fmt(k.st.impr)}</td>
      <td class="num">${k.potential ? "+" + fmt(k.potential) : "–"}</td></tr>`;
  }).join("") || `<tr><td colspan="9" class="empty">Aucun mot-clé ne correspond.</td></tr>`;
  $("tbody").querySelectorAll("tr[data-i]").forEach(tr => tr.onclick = () => openDrawer(+tr.dataset.i));
  $("tbody").querySelectorAll("[data-pick]").forEach(b => b.onclick = e => { e.stopPropagation(); toggleSel(+b.dataset.pick); });
  $("t-count").textContent = `${rows.length} mot${rows.length > 1 ? "s" : ""}-clé${rows.length > 1 ? "s" : ""} sur ${kws.length}`;
  sortable("t-kw", () => renderKwTable(kws, alertKw));
}

function exportCsv(kws, dates) {
  const head = ["mot-cle", "variantes", "tags", "page", "position_dernier_jour", "position_moyenne", "evolution_places", "position_site", "clics", "impressions", "ctr", "clics_a_gagner_mois"];
  const cell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const num = v => v == null ? "" : String(v).replace(".", ",");
  const lines = [head.join(";")].concat(filteredKws(kws).map(k => [cell(k.keyword), cell(k.variants.join(", ")), cell(k.tags.join(", ")), cell(k.page),
    num(k.st.last ? k.st.last[1] : null), num(k.st.wpos != null ? +k.st.wpos.toFixed(1) : null), num(k.st.delta), num(k.site.wpos != null ? +k.site.wpos.toFixed(1) : null),
    k.st.clicks, k.st.impr, num(k.st.ctr != null ? +k.st.ctr.toFixed(2) : null), k.potential ?? ""].join(";")));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }));
  a.download = `${P.name}-mots-cles-${dates[0]}-${dates[dates.length - 1]}.csv`;
  a.click();
}

function renderByPage() {
  const pages = {};
  P.keywords.filter(k => k.page !== "*").forEach(k => (pages[k.page] = pages[k.page] || []).push(k));
  const cards = Object.entries(pages).map(([url, kws]) => {
    const insp = P.inspection.current[url] || {};
    const pq = P.page_queries[url] || {};
    const prev = new Map((pq.prev || []).map(r => [r[0], r]));
    const tracked = new Set(kws.flatMap(k => [k.keyword, ...k.variants]));
    const cur = pq.cur || [];
    const tc = cur.reduce((a, r) => a + r[1], 0);
    const canon = insp.googleCanonical && norm(insp.googleCanonical) !== norm(insp.userCanonical);
    const hist = (P.inspection.history || []).filter(h => h.url === url).slice(-3).reverse();
    return `<details class="card page-card"><summary>
        <span class="badge ${insp.verdict === "PASS" ? "ok" : insp.verdict ? "ko" : ""}">${insp.verdict === "PASS" ? "Indexée" : esc(insp.coverageState || "Non vérifiée")}</span>
        ${canon ? '<span class="badge warn">Google retient une autre canonique</span>' : ""}
        <b>${esc(path(url))}</b><span class="light">${kws.map(k => esc(k.keyword)).join(", ")}</span>
        <span class="spacer"></span><span class="muted">${fmt(tc)} clics sur 28 j</span></summary>
      <div class="body">
        <div class="insp"><a class="url" href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}${EXT}</a>
          <span class="badge">Dernier passage de Google : ${insp.lastCrawlTime ? fmtDate(insp.lastCrawlTime.slice(0, 10)) : "–"}</span>
          ${canon ? `<span class="badge warn">Canonique retenue : ${esc(path(insp.googleCanonical))}</span>` : ""}</div>
        ${hist.length ? `<div class="note-box">${hist.map(h => `${fmtDate(h.date)} : ${esc(h.field)} passe de « ${esc(h.old)} » à « ${esc(h.new)} »`).join("<br>")}</div>` : ""}
        <p class="muted" style="font-size:13px;margin-bottom:8px">Toutes les requêtes qui amènent du trafic sur cette page, 28 derniers jours vs 28 jours précédents. En gras : les mots-clés suivis.</p>
        <div class="box"><table><thead><tr><th>Requête</th><th class="num">Clics</th><th class="num">Impressions</th><th class="num">Position</th><th class="num">Évolution</th></tr></thead><tbody>
        ${cur.slice(0, 30).map(r => { const p = prev.get(r[0]); return `<tr ${tracked.has(r[0]) ? 'style="font-weight:600"' : ""}><td>${esc(r[0])}</td>
          <td class="num">${fmt(r[1])}</td><td class="num">${fmt(r[2])}</td><td class="num">${fmt1(r[3])}</td><td class="num">${p ? placesPill(p[3] - r[3]) : '<span class="badge info">nouvelle</span>'}</td></tr>`; }).join("") || '<tr><td colspan="5" class="empty">Pas de donnée.</td></tr>'}
        </tbody></table></div></div></details>`;
  }).join("");
  $("kw-body").innerHTML = `<p class="muted" style="margin-bottom:10px;font-size:13px">Une carte par page suivie : son état d'indexation (vérifié chaque jour auprès de Google) et toutes ses requêtes. C'est la base de travail pour briefer une optimisation.</p>${cards || '<div class="card empty">Aucune page suivie.</div>'}`;
}

// ---------------------------------------------------------------- panneau de détail d'un mot-clé

function openDrawer(i, silent = false) {
  if (!P) return;
  ui.openKw = i;
  const k0 = P.keywords.find(k => k.i === i);
  if (!k0) return;
  const { dates, n1 } = periodDates();
  const k = { ...k0, st: kstats(k0, dates), site: kstats(k0, dates, "smap"), n1s: kstats(k0, n1) };
  const color = colorOf(k0) === NEUTRAL ? PALETTE[0] : colorOf(k0);
  const pos = k.st.last ? k.st.last[1] : null;
  const al = P.alerts.filter(a => a.i === i);
  const insp = P.inspection && P.inspection.current[k.page];
  const others = (k.pages || []).filter(p => !p.tracked && p.share >= 5);
  $("drawer").innerHTML = `
    <div class="drawer-head"><div style="min-width:0"><h3>${esc(k.keyword)}</h3>${urlLink(k.page)}
      <div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">${k.tags.map(t => `<span class="tag">${esc(t)}</span>`).join("")}${k.variants.map(v => `<span class="badge" title="Variante regroupée">+ ${esc(v)}</span>`).join("")}</div></div>
      <button class="icon-btn" id="d-close" aria-label="Fermer"><svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    <div class="drawer-body">
      ${al.map(a => `<div class="note-box" style="background:var(--status-${a.severity === "critique" ? "ko" : "warn"}-bg)">${sevTag(a.severity)} ${esc(a.text)}</div>`).join("")}
      ${others.length ? `<div class="note-box">${others.length === 1 ? "Une autre page" : others.length + " autres pages"} du site capte${others.length > 1 ? "nt" : ""} aussi des impressions sur ce mot-clé (${others.map(p => esc(path(p.page)) + " : " + fmt1(p.share) + " %").join(", ")}). Voir le détail plus bas.</div>` : ""}
      ${k.note ? `<div class="note-box"><b>Note :</b> ${esc(k.note)}</div>` : ""}
      <div class="mini-kpis">
        <div><div class="l">Position ${info("position")}</div><div class="v">${fmt1(pos)}</div></div>
        <div><div class="l">Évolution</div><div class="v">${placesPill(k.st.delta)}</div></div>
        <div><div class="l">Clics</div><div class="v">${fmt(k.st.clicks)}</div></div>
        <div><div class="l">Taux de clic</div><div class="v">${k.st.ctr == null ? "–" : fmt1(k.st.ctr) + " %"}</div></div>
        <div><div class="l">À gagner / mois ${info("aGagner")}</div><div class="v">${k.potential ? "+" + fmt(k.potential) : "–"}</div></div>
      </div>
      <h4><span>Position ${periodLabel(dates)}</span><label class="toggle"><input type="checkbox" id="d-n1" ${ui.n1 ? "checked" : ""}> Comparer à l'an dernier</label></h4>
      <div class="legend-static"><span><span class="line-sw" style="border-color:${color}"></span>Page suivie</span><span><span class="line-sw dash" style="border-color:#8a8a8a"></span>Site, toutes pages ${info("positionSite")}</span>${ui.n1 ? `<span><span class="line-sw dash" style="border-color:${N1}"></span>Il y a un an</span>` : ""}</div>
      <div class="chart-box"><canvas id="d-pos"></canvas></div><div id="d-marks"></div>
      <h4>Impressions et clics</h4><div class="chart-box"><canvas id="d-impr"></canvas></div>
      ${k.pages && k.pages.length ? `<h4>Qui se positionne sur ce mot-clé ? <span class="light">part des impressions</span></h4><div class="box"><table><thead><tr><th>Page du site</th><th class="num">28 j</th><th class="num">7 j</th><th class="num">Position</th><th class="num">Clics</th></tr></thead><tbody>
        ${k.pages.map(p => `<tr ${p.tracked ? 'style="font-weight:600"' : ""}><td>${urlLink(p.page)}${p.tracked ? ' <span class="badge info">suivie</span>' : ""}</td><td class="num">${fmt1(p.share)} %</td><td class="num">${fmt1(p.share7)} %</td><td class="num">${fmt1(p.pos)}</td><td class="num">${fmt(p.clicks)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      ${k.variants_detail && k.variants_detail.length > 1 ? `<h4>Détail des variantes <span class="light">28 derniers jours</span></h4><div class="box"><table><thead><tr><th>Requête</th><th class="num">Position</th><th class="num">Clics</th><th class="num">Impressions</th></tr></thead><tbody>
        ${k.variants_detail.map(v => `<tr><td>${esc(v.query)}</td><td class="num">${fmt1(v.pos)}</td><td class="num">${fmt(v.clicks)}</td><td class="num">${fmt(v.impr)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      ${insp ? `<h4>La page vue par Google</h4><div class="insp"><span class="badge ${insp.verdict === "PASS" ? "ok" : "ko"}">${insp.verdict === "PASS" ? "Indexée" : esc(insp.coverageState || insp.verdict)}</span>
        <span class="badge">Dernier passage ${insp.lastCrawlTime ? fmtDate(insp.lastCrawlTime.slice(0, 10)) : "–"}</span>
        ${insp.googleCanonical && norm(insp.googleCanonical) !== norm(insp.userCanonical) ? `<span class="badge warn">Canonique retenue : ${esc(path(insp.googleCanonical))}</span>` : '<span class="badge ok">Canonique respectée</span>'}</div>` : ""}
      <details class="fold"><summary>Appareils, pays et historique jour par jour</summary><div>
        ${k.splits ? `<div class="grid-eq" style="margin:0">${["device", "country"].map(dim => k.splits[dim] && k.splits[dim].length ? `<div><h4>${dim === "device" ? "Appareils" : "Pays"} (28 j)</h4><div class="box"><table><tbody>
          ${k.splits[dim].slice(0, 5).map(x => `<tr><td>${esc(dim === "device" ? ({ MOBILE: "Mobile", DESKTOP: "Ordinateur", TABLET: "Tablette" }[x.key] || x.key) : x.key.toUpperCase())}</td><td class="num">pos. ${fmt1(x.pos)}</td><td class="num">${fmt(x.clicks)} clics</td></tr>`).join("")}</tbody></table></div></div>` : "").join("")}</div>` : ""}
        <h4>Jour par jour <span class="light">60 derniers jours</span></h4>
        <div class="box"><table><thead><tr><th>Date</th><th class="num">Position</th><th class="num">Site</th><th class="num">Clics</th><th class="num">Impressions</th></tr></thead><tbody>
          ${k0.s.slice(-60).reverse().map(p => { const s = k0.smap.get(p[0]); return `<tr><td>${fmtDate(p[0])}${p[4] ? '<span class="fresh-tag">provisoire</span>' : ""}</td><td class="num">${fmt1(p[1])}</td><td class="num">${fmt1(s && s[1])}</td><td class="num">${fmt(p[2])}</td><td class="num">${fmt(p[3])}</td></tr>`; }).join("")}</tbody></table></div>
      </div></details>
      <div style="margin-top:18px;display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn ghost sm" href="${issue("action.yml", { projet: P.name, page: k.page === "*" ? "" : k.page, title: "Action : " })}" target="_blank" rel="noopener">Consigner une action sur cette page</a></div>
    </div>`;
  $("d-close").onclick = () => closeDrawer();
  $("d-n1").onchange = e => { ui.n1 = e.target.checked; openDrawer(i, true); };
  const b = bucket(k.st.pts, dates), bs = bucket(k.site.pts, dates), b1 = bucket(k.n1s.pts, n1);
  const mk = marksFor(b.ranges, { page: k.page });
  const ds = [lineDs("Page suivie", b.pts.map(p => p && p[1]), color, { fresh: b.pts.map(p => p && p[4]) }),
    lineDs("Site", bs.pts.map(p => p && p[1]), "#8a8a8a", { dash: [4, 3], width: 1.5 })];
  if (ui.n1) ds.push(lineDs("Il y a un an", b1.pts.map(p => p && p[1]), N1, { dash: [2, 3], width: 1.5 }));
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

// ---------------------------------------------------------------- Trafic du site

function renderTraffic() {
  const { dates, prev, n1 } = periodDates();
  const t = segSum("total", dates), tp = segSum("total", prev), t1 = segSum("total", n1);
  const nb = segSum("nonbrand", dates), nbp = segSum("nonbrand", prev), nb1 = segSum("nonbrand", n1);
  const br = segSum("brand", dates), brp = segSum("brand", prev), br1 = segSum("brand", n1);
  const both = (cur, p, y) => vs(cur, p, "vs période préc.") + vs(cur, y, "vs an dernier");
  const months = []; const lm = P.last_final.slice(0, 7);
  for (let i = 12; i >= 0; i--) months.push(shiftMonth(lm, -i));
  $("view").innerHTML = intro("Trafic Google du site",
      `Tout le trafic du site depuis Google, au-delà des mots-clés suivis. Période ${periodLabel(dates)}, comparée à la période précédente et à la même période l'an dernier.`, "", "Site entier")
    + `<div class="kpis k4">
      ${kpi("Clics hors marque", fmt(nb.clicks), both(nb.clicks, nbp.clicks, nb1.clicks), "horsMarque")}
      ${kpi("Clics marque", fmt(br.clicks), both(br.clicks, brp.clicks, br1.clicks), "marque")}
      ${kpi("Clics au total", fmt(t.clicks), both(t.clicks, tp.clicks, t1.clicks))}
      ${kpi("Impressions au total", fmt(t.impr), both(t.impr, tp.impr, t1.impr))}
    </div>
    <div class="card" style="margin-bottom:12px"><div class="card-head"><h2>Clics par jour</h2></div>
      <div class="card-body"><div class="legend-static"><span><span class="line-sw" style="border-color:${INK}"></span>Hors marque</span><span><span class="line-sw dash" style="border-color:${N1}"></span>Hors marque, l'an dernier</span><span><span class="line-sw" style="border-color:#77B0ED"></span>Marque</span></div>
      <div class="chart-box"><canvas id="c-traffic"></canvas></div><div id="marks-traffic"></div></div></div>
    <div class="card"><div class="card-head"><h2>Clics hors marque par mois</h2><span class="hint">13 derniers mois, le mois en cours est partiel</span></div>
      <div class="card-body"><div class="chart-box sm"><canvas id="c-months"></canvas></div></div></div>
    <p class="footnote">${P.anonymized_share != null ? `${fmt1(P.anonymized_share)} % des clics du site viennent de requêtes que Google masque ${info("anonymes")} : elles comptent dans le total mais ni en marque ni en hors marque. ` : ""}Repère G = mise à jour de classement Google.</p>`;
  const segPts = (seg, ds_) => ds_.map(d => (P.seg[seg] && P.seg[seg].get(d)) || null);
  const tb = bucket(segPts("nonbrand", dates), dates), tb1 = bucket(segPts("nonbrand", n1), n1), tbb = bucket(segPts("brand", dates), dates);
  const mk = marksFor(tb.ranges, { actions: false });
  chart("c-traffic", { type: "line", data: { labels: tb.labels, datasets: [
      lineDs("Hors marque", tb.pts.map(p => p && p[2]), INK, { fresh: tb.pts.map(p => p && p[4]) }),
      lineDs("Hors marque, l'an dernier", tb1.pts.map(p => p && p[2]), N1, { dash: [4, 4], width: 1.5 }),
      lineDs("Marque", tbb.pts.map(p => p && p[2]), "#77B0ED", { width: 1.5 })] },
    options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, layout: { padding: { top: 12 } }, scales: { y: linScale(), x: xScale() },
      plugins: { legend: { display: false }, marks: { items: mk.items }, tooltip: tooltip({ label: c => ` ${c.dataset.label} : ${fmt(c.parsed.y)}` }) } } });
  $("marks-traffic").innerHTML = mk.html;
  chart("c-months", { type: "bar", data: { labels: months.map(x => MONTHS[+x.slice(5) - 1].slice(0, 4) + ". " + x.slice(2, 4)),
      datasets: [{ data: months.map(x => segSum("nonbrand", monthDates(x)).clicks), backgroundColor: months.map((x, i) => i === months.length - 1 ? "#C9C9C9" : "#101010"), borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom", maxBarThickness: 36 }] },
    options: { maintainAspectRatio: false, scales: { y: linScale(), x: { grid: { display: false } } }, plugins: { legend: { display: false }, tooltip: tooltip({ label: c => ` ${fmt(c.parsed.y)} clics hors marque` }) } } });
}

// ---------------------------------------------------------------- Actions

function renderActions() {
  const kwName = i => (P.keywords.find(k => k.i === i) || {}).keyword;
  const cards = P.actions.map(a => {
    const im = a.impact;
    const adj = im && im.clicks_month_adjusted;
    const verdict = adj == null ? "" : adj > 0 ? `<span class="pill up">▲ +${fmt(adj)} clics / mois</span>` : adj < 0 ? `<span class="pill down">▼ ${fmt(adj)} clics / mois</span>` : '<span class="pill flat">Pas d\'effet mesurable</span>';
    const body = im ? `<div class="impact">
        <div><div class="l">Position avant → après</div><div class="v">${fmt1(im.pos_before)} → ${fmt1(im.pos_after)}</div></div>
        <div><div class="l">Clics par jour avant → après</div><div class="v">${fmt1(im.clicks_day_before)} → ${fmt1(im.clicks_day_after)}</div></div>
        <div><div class="l">Impressions par jour</div><div class="v">${fmt(im.impr_day_before)} → ${fmt(im.impr_day_after)}</div></div>
        <div><div class="l">Effet de l'action ${info("impact")}</div><div class="v">${verdict}</div></div></div>
        <div class="meta" style="margin-top:8px">Mesuré sur ${im.window_after} jours après la mise en ligne${im.window_after < 28 ? " (mesure en cours, définitive à 28 jours)" : ""}.</div>`
      : `<div class="meta" style="margin-top:8px">${esc(a.reason || "")}</div>`;
    return `<div class="card item"><span class="badge">${esc(a.type || "autre")}</span><div>
      <h3>${esc(a.title || "Action")}</h3>${a.description ? `<p>${esc(a.description)}</p>` : ""}
      <div class="meta"><span>${fmtDateL(a.date)}</span>${a.page ? urlLink(a.page) : ""}${a.author ? `<span>${esc(a.author)}</span>` : ""}
      ${a.keywords && a.keywords.length ? `<span>Mesuré sur : ${a.keywords.map(i => `<span class="k" data-i="${i}" style="cursor:pointer;text-decoration:underline">${esc(kwName(i))}</span>`).join(", ")}</span>` : ""}</div>${body}</div><div></div></div>`;
  }).join("");
  $("view").innerHTML = intro("Journal des actions",
      "Chaque optimisation mise en ligne (contenu, technique, maillage, netlinking), avec son effet mesuré sur les mots-clés suivis de la page concernée.",
      `<a class="btn" href="${issue("action.yml", { projet: P.name, title: "Action : " })}" target="_blank" rel="noopener"><svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>Ajouter une action</a>`)
    + `<div class="list">${cards || `<div class="card big-empty">Aucune action pour l'instant. Dès qu'une optimisation est en ligne, consigne-la avec « Ajouter une action » : son effet sera mesuré automatiquement.</div>`}</div>
    <details class="fold"><summary>Comment l'effet est mesuré</summary><div class="explain">On compare les 28 jours avant la mise en ligne aux 28 jours après (7 jours minimum), sur les mots-clés suivis de la page. Pour isoler l'effet de l'action, on retire la tendance générale observée sur les mots-clés qu'on n'a pas touchés (le « groupe témoin ») : si tout le site a baissé de 10 % à cause de la saison, l'action n'est pas pénalisée pour autant. Le résultat est ramené à un mois. L'action apparaît aussi comme repère « A » sur les courbes.<br><br>La saisie passe par un formulaire GitHub : l'action est ajoutée à <code>config/actions/${esc(P.name)}.yaml</code> et le dashboard est recalculé en 1 à 2 minutes.</div></details>`;
  document.querySelectorAll("[data-i]").forEach(el => el.onclick = () => openDrawer(+el.dataset.i));
}

// ---------------------------------------------------------------- Opportunités

function renderOpps() {
  const d28 = P.dates.slice(-28);
  const kws = P.keywords.filter(k => k.potential).sort((a, b) => b.potential - a.potential);
  const flagsL = { top: "Fait déjà des clics", striking: "Proche de la 1re page", nouvelle: "Nouvelle requête" };
  const sug = P.suggestions.filter(s => ui.sug === "all" || s.flags.includes(ui.sug));
  $("view").innerHTML = intro("Opportunités",
      "Où gagner des clics : d'abord sur les mots-clés déjà suivis, puis sur des requêtes du site qu'il faudrait commencer à suivre.")
    + `<div class="section-title"><h2>1. Mots-clés suivis qui peuvent rapporter le plus</h2><span>${info("aGagner")}</span></div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Mot-clé</th><th>Page</th><th class="num">Position actuelle</th><th class="num">Objectif</th><th class="num">Clics à gagner / mois</th></tr></thead><tbody>
      ${kws.slice(0, 15).map(k => `<tr class="click" data-i="${k.i}"><td><b>${esc(k.keyword)}</b></td><td>${urlLink(k.page)}</td><td class="num">${fmt1(kstats(k, d28).wpos)}</td><td class="num">${k.potential_target === 1 ? "1re place" : "Top 3"}</td><td class="num"><b>+${fmt(k.potential)}</b></td></tr>`).join("") || '<tr><td colspan="5" class="empty">Pas de potentiel calculable.</td></tr>'}
      </tbody></table></div></div>
    <div class="section-title"><h2>2. Requêtes à commencer à suivre</h2><span>hors marque, 28 derniers jours</span></div>
    <div class="card">
      <div class="toolbar"><div class="tabs" id="sug-f">${[["all", "Toutes"], ["top", "Font déjà des clics"], ["striking", "Proches de la 1re page"], ["nouvelle", "Nouvelles"]].map(([v, l]) => `<button data-v="${v}" class="${ui.sug === v ? "active" : ""}">${l}</button>`).join("")}</div></div>
      <div class="table-wrap"><table><thead><tr><th>Requête</th><th>Page qui ressort</th><th class="num">Position</th><th class="num">Clics</th><th class="num">Impressions</th><th class="num">Clics à gagner / mois</th><th>Pourquoi</th><th></th></tr></thead><tbody>
      ${sug.map(s => `<tr><td><b>${esc(s.query)}</b></td><td>${urlLink(s.page)}</td><td class="num">${fmt1(s.pos)}</td><td class="num">${fmt(s.clicks)}</td><td class="num">${fmt(s.impr)}</td>
        <td class="num">${s.potential ? "+" + fmt(s.potential) : "–"}</td>
        <td>${s.flags.map(f => `<span class="badge ${f === "nouvelle" ? "info" : f === "striking" ? "warn" : ""}">${flagsL[f]}</span>`).join(" ")}</td>
        <td><a class="btn ghost sm" target="_blank" rel="noopener" href="${issue("mot-cle.yml", { projet: P.name, mot_cle: s.query, page: s.page || "", title: "Mot-clé : " + s.query })}">Suivre</a></td></tr>`).join("") || '<tr><td colspan="8" class="empty">Aucune suggestion.</td></tr>'}
      </tbody></table></div>
      <div class="table-foot"><span>${sug.length} requêtes</span><span>« Suivre » ouvre le formulaire pré-rempli : l'historique arrive en 2 à 3 minutes.</span></div>
    </div>
    <details class="fold"><summary>Comment les clics à gagner sont calculés</summary><div class="grid-2"><div class="explain" style="margin:0">On prend les impressions des 28 derniers jours et on les multiplie par l'écart de taux de clic entre la position actuelle et l'objectif (top 3, ou 1re place si la page y est déjà). Les taux de clic ne sont pas une moyenne du marché : ils sont mesurés sur les mots-clés de ce client (90 jours), ci-contre.</div>
      <div class="card"><div class="card-head"><h2>Taux de clic du client par position</h2></div><div class="card-body"><div class="chart-box sm"><canvas id="c-ctr"></canvas></div></div></div></div></details>`;
  document.querySelectorAll("tr[data-i]").forEach(tr => tr.onclick = () => openDrawer(+tr.dataset.i));
  document.querySelectorAll("#sug-f button").forEach(b => b.onclick = () => { ui.sug = b.dataset.v; renderOpps(); });
  const fold = document.querySelector("details.fold");
  fold.addEventListener("toggle", () => {
    if (fold.open && P.ctr_curve && !charts["c-ctr"]) chart("c-ctr", { type: "bar", data: { labels: P.ctr_curve.map((_, i) => i + 1), datasets: [{ data: P.ctr_curve.map(v => v * 100), backgroundColor: "#2a78d6", borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom" }] },
      options: { maintainAspectRatio: false, scales: { y: { ...linScale(), ticks: { callback: v => v + " %" } }, x: { grid: { display: false }, title: { display: true, text: "Position" } } },
        plugins: { legend: { display: false }, tooltip: tooltip({ title: c => "Position " + c[0].label, label: c => ` Taux de clic : ${fmt1(c.parsed.y)} %` }) } } });
  });
}

// ---------------------------------------------------------------- Rapport mensuel

function renderReport() {
  const finals = P.dates.filter(d => d <= P.last_final);
  const months = [...new Set(finals.map(d => d.slice(0, 7)))].sort().reverse();
  const complete = m => finals.includes(lastDay(m));
  if (!ui.month || !months.includes(ui.month)) ui.month = months.find(complete) || months[0];
  const m = ui.month, pm = shiftMonth(m, -1), nm = shiftMonth(m, -12);
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

  const last13 = []; for (let i = 12; i >= 0; i--) last13.push(shiftMonth(m, -i));
  const monthly = last13.map(x => segSum("nonbrand", monthDates(x)).clicks);

  $("view").innerHTML = `
    <div class="intro no-print"><div><h1>Rapport mensuel</h1><p>Prêt à envoyer au client après relecture. Le commentaire est construit uniquement à partir des chiffres : complète-le avec ton analyse.</p></div>
      <div style="display:flex;gap:8px"><select id="month" class="btn ghost">${months.map(x => `<option value="${x}" ${x === m ? "selected" : ""}>${mlabel(x)}${complete(x) ? "" : " (en cours)"}</option>`).join("")}</select>
      <button class="btn" onclick="window.print()"><svg class="i" viewBox="0 0 24 24"><path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M6 14h12v7H6z"/></svg>Imprimer / PDF</button></div></div>
    <div class="report">
      <div class="report-head"><div class="logo">${document.querySelector(".brand svg").outerHTML}datashake</div>
        <div class="meta"><div><strong>Client</strong> ${esc(P.label)}</div><div><strong>Période</strong> ${mlabel(m)}</div><div><strong>Consultant</strong> ${esc(P.owner || "")}</div><div><strong>Source</strong> Google Search Console</div></div></div>
      <h1>Rapport SEO · ${mlabel(m)}</h1>
      <p class="lede">${s.map(esc).join(" ")}</p>
      <div class="hero">
        <div><div class="num">${fmt(nb.clicks)}</div><div class="lbl">Clics hors marque (site)</div><div class="cmp">${sign(pct(nb.clicks, nbp.clicks)) || "–"} vs M-1 · ${sign(pct(nb.clicks, nb1.clicks)) || "–"} vs N-1</div></div>
        <div><div class="num">${fmt(tr.clicks)}</div><div class="lbl">Clics mots-clés suivis</div><div class="cmp">${sign(pct(tr.clicks, trp.clicks)) || "–"} vs M-1 · ${sign(pct(tr.clicks, tr1.clicks)) || "–"} vs N-1</div></div>
        <div><div class="num">${fmt1(tr.pos)}</div><div class="lbl">Position moyenne suivie</div><div class="cmp">${fmt1(trp.pos)} le mois précédent</div></div>
        <div><div class="num">${top3} / ${top10}</div><div class="lbl">Top 3 / top 10</div><div class="cmp">sur ${rows.length} mots-clés · visibilité ${fmt1(v)} % (${vp != null && v != null ? (v - vp >= 0 ? "+" : "") + fmt1(v - vp) + " pt" : "–"})</div></div>
      </div>
      <section><div class="section-head"><h2>Trafic hors marque, 13 derniers mois</h2><span class="section-num">01</span></div><div class="chart-box sm"><canvas id="r-months"></canvas></div></section>
      <section><div class="section-head"><h2>Mots-clés suivis</h2><span class="section-num">02</span></div>
        <div class="box"><table><thead><tr><th>Mot-clé</th><th class="num">Position ${MONTHS[+m.slice(5) - 1]}</th><th class="num">Mois précédent</th><th class="num">Évolution</th><th class="num">Clics</th><th class="num">vs M-1</th></tr></thead><tbody>
        ${rows.sort((a, b) => b.c.clicks - a.c.clicks).map(x => `<tr><td><b>${esc(x.k.keyword)}</b></td><td class="num">${fmt1(x.c.wpos)}</td><td class="num">${fmt1(x.p.wpos)}</td><td class="num">${placesPill(x.d)}</td><td class="num">${fmt(x.c.clicks)}</td><td class="num">${deltaPill(pct(x.c.clicks, x.p.clicks), { pct: true })}</td></tr>`).join("")}
        </tbody></table></div></section>
      <section><div class="section-head"><h2>Actions du mois</h2><span class="section-num">03</span></div>
        ${acts.length ? `<div class="box"><table><thead><tr><th>Date</th><th>Action</th><th>Page</th><th class="num">Position avant → après</th><th class="num">Effet</th></tr></thead><tbody>
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

// ---------------------------------------------------------------- Guide d'utilisation

function renderGuide() {
  const first = IDX.projects[0] ? IDX.projects[0].name : "";
  $("view").innerHTML = `<div class="guide">
    ${intro("Guide d'utilisation", "Tout ce qu'il faut pour suivre ses clients dans l'outil, en 5 minutes de lecture.")}
    <div class="card"><h2>Chaque onglet répond à une question</h2><div class="qa">
      <a href="#/${first}"><b>À traiter</b><span>Qu'est-ce qui demande mon attention ? Alertes et mouvements de la semaine.</span></a>
      <a href="#/${first}/mots-cles"><b>Mots-clés</b><span>Où en sont mes positions ? Uniquement les mots-clés suivis, par mot-clé ou par page.</span></a>
      <a href="#/${first}/trafic"><b>Trafic du site</b><span>Comment va le site dans Google ? Clics marque et hors marque, comparés à l'an dernier.</span></a>
      <a href="#/${first}/actions"><b>Actions</b><span>Est-ce que mon travail a payé ? Effet mesuré de chaque optimisation.</span></a>
      <a href="#/${first}/opportunites"><b>Opportunités</b><span>Où gagner des clics ? Mots-clés à pousser et requêtes à suivre.</span></a>
      <a href="#/${first}/rapport"><b>Rapport</b><span>Qu'est-ce que je dis au client ? Rapport mensuel prêt à imprimer en PDF.</span></a>
    </div></div>
    <div class="card"><h2>La routine conseillée</h2><ol>
      <li><b>Chaque matin</b> : ouvre le Portefeuille, filtré sur ton nom dans la barre latérale (le choix est mémorisé). Ouvre les projets qui ont des alertes et regarde l'onglet <b>À traiter</b>.</li>
      <li><b>Dès qu'une optimisation est en ligne</b> : « Ajouter une action ». Son effet sera mesuré tout seul au bout de 7 jours, puis 28 jours.</li>
      <li><b>Chaque semaine</b> : l'onglet <b>Opportunités</b> pour choisir les prochaines pages à travailler et les requêtes à ajouter au suivi.</li>
      <li><b>Chaque début de mois</b> : l'onglet <b>Rapport</b>, choisis le mois, relis, complète le commentaire, puis « Imprimer / PDF ».</li>
    </ol></div>
    <div class="card"><h2>Démarrer avec un nouveau client</h2><ol>
      <li><b>Ton compte Google doit voir la propriété Search Console du client.</b> L'outil lit la GSC avec le compte d'un consultant (on n'ajoute jamais d'utilisateur sur la propriété du client). Si le client est sur ton compte et pas sur celui de Théo, demande à brancher ton compte (une commande, voir la documentation technique).</li>
      <li><b>« Nouveau projet »</b> dans la barre latérale : identifiant, nom, propriété GSC, ton nom, et la regex de marque (le nom de la marque et ses fautes de frappe, séparés par |). Les 20 requêtes hors marque qui font le plus de clics sont ajoutées automatiquement.</li>
      <li><b>Ajuste les mots-clés</b> : « Suivre un mot-clé » pour en ajouter, ou les suggestions de l'onglet Opportunités. Indique les variantes (pluriel, orthographe) pour qu'elles soient additionnées.</li>
      <li>Les formulaires passent par GitHub : il faut un compte GitHub ajouté comme collaborateur du repo. Après l'envoi, compte 2 à 3 minutes avant de voir le résultat.</li>
    </ol></div>
    <div class="card"><h2>Lexique</h2><dl>
      <dt>Position</dt><dd>${DEF.position}</dd>
      <dt>Page suivie / site</dt><dd>${DEF.positionSite}</dd>
      <dt>Variantes</dt><dd>Formulations proches regroupées avec un mot-clé (ex. « jean homme » et « jeans homme ») : leurs clics et impressions sont additionnés.</dd>
      <dt>Visibilité</dt><dd>${DEF.visibilite}</dd>
      <dt>Clics à gagner</dt><dd>${DEF.aGagner}</dd>
      <dt>Hors marque / marque</dt><dd>${DEF.horsMarque} ${DEF.marque}</dd>
      <dt>Requêtes masquées</dt><dd>${DEF.anonymes}</dd>
      <dt>Urgent / À surveiller</dt><dd>Urgent : sortie du top 10, page qui ne reçoit plus d'impressions, page non indexée, synchro en échec. À surveiller : recul de position, sortie du top 3, baisse d'impressions, autre page du site qui prend le relais, canonique non respectée.</dd>
      <dt>Effet d'une action</dt><dd>${DEF.impact}</dd>
      <dt>Données provisoires</dt><dd>${DEF.provisoire}</dd>
      <dt>Repères G et A</dt><dd>Sur les courbes : G = mise à jour de classement Google, A = action SEO consignée dans le journal.</dd>
    </dl></div>
    <div class="card"><h2>Ce que les chiffres ne disent pas</h2><ul>
      <li>La Search Console donne une position <b>moyenne</b>, pas un relevé à un instant T comme un outil de suivi de SERP : un mot-clé peu recherché aura une courbe irrégulière.</li>
      <li>Un jour sans impression n'a pas de valeur : la courbe s'interrompt, ça ne veut pas dire que la page a disparu.</li>
      <li>La donnée arrive avec 2 à 3 jours de décalage et les derniers jours bougent encore.</li>
    </ul><p style="margin-top:10px">Documentation technique : <a href="${GH}#readme" target="_blank" rel="noopener">README du repo</a>.</p></div>
  </div>`;
}

load();
