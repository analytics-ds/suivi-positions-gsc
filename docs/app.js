"use strict";
// Suivi de positions datashake : application statique (GitHub Pages) qui lit docs/data/*.json.
// Une seule définition de la position : la position du jour de référence (dernier jour disponible, ou dernier jour
// définitif si les jours provisoires sont exclus). Les variations comparent deux jours.

const REPO = "analytics-ds/suivi-positions-gsc";
const GH = "https://github.com/" + REPO;
// Palette catégorielle validée (ordre fixe par mot-clé sélectionné, jamais cyclée sur le rang).
const PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const MAX_SEL = 8, NEUTRAL = "#9A9A9A", INK = "#101010", MUTED = "rgba(16,16,16,0.62)", GRID = "#F0F0EF", CMP = "#B9B9B9";
const NA = "-";
const EXT = '<svg class="i" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
const PLUS = '<svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
const VIEWS = [["mots-cles", "Mots-clés"], ["trafic", "Trafic du site"], ["actions", "Actions"], ["opportunites", "Opportunités"], ["rapport", "Rapport"], ["a-traiter", "À traiter"]];
const RANGE_VIEWS = ["mots-cles", "trafic"];
const FRESH_VIEWS = ["mots-cles", "trafic", "opportunites"];
const SEV = { critique: "Urgent", attention: "À surveiller", info: "Info" };
const TYPES = { baisse: "Recul", top3: "Sortie du top 3", top10: "Sortie du top 10", hausse: "Progression", disparue: "Page disparue",
  impressions: "Baisse d'impressions", page: "Une autre page prend le relais", indexation: "Indexation", canonical: "Canonique", synchro: "Synchro", inspection: "Indexation" };
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const STATUS = { "à travailler": "À travailler", "en cours": "En cours", "acquis": "Acquis" };
const DIST = [
  { name: "Top 3", test: p => p != null && p <= 3, color: "#2a78d6" }, { name: "4 à 10", test: p => p > 3 && p <= 10, color: "#86b6ef" },
  { name: "11 à 20", test: p => p > 10 && p <= 20, color: "#cde2fb" }, { name: "Au-delà de 20", test: p => p > 20, color: "#D4D4D4" },
  { name: "Sans donnée", test: p => p == null, color: "#EFEFEE" }];
const MIN_IMPR_DAY = 20; // identique à tracker.py : seuil des mouvements et des alertes

// Définitions affichées dans les info-bulles et reprises dans le guide
const DEF = {
  position: "Position Google de la page suivie le jour de référence : le dernier jour disponible, ou le dernier jour définitif si les jours provisoires sont exclus. Sans impression ce jour-là, la dernière position connue dans les 7 jours précédents est reprise (en gris).",
  posMoy: "Moyenne des positions des mots-clés au jour de référence. La variation compare au dernier jour de la période de comparaison, sur les mots-clés qui ont une position aux deux dates.",
  d7: "Position du jour de référence contre position 7 jours plus tôt. C'est la même variation qui alimente les mouvements de la semaine et les alertes (avec au moins 20 impressions chacun des deux jours).",
  d28: "Position du jour de référence contre position 28 jours plus tôt.",
  dcmp: "Position du jour de référence contre position au dernier jour de la période de comparaison.",
  best: "Meilleure position journalière sur la période affichée.",
  url: "Page du site qui a reçu le plus d'impressions sur le mot-clé le jour de référence, quand ce n'est pas la page suivie.",
  demande: "Impressions du site sur le mot-clé, toutes pages, sur les 28 jours qui finissent au jour de référence. C'est la demande réellement vue dans la Search Console.",
  positionSite: "Position du site toutes pages confondues. Si elle diffère de la page suivie, une autre page du site se positionne aussi.",
  top: "Nombre de mots-clés dont la page est dans le top 3 ou le top 10 au jour de référence.",
  clicsSuivis: "Clics apportés par les mots-clés suivis, sur leur page suivie uniquement, sur la période.",
  visibilite: "Clics captés au jour de référence par rapport à ce que le site obtiendrait en 1re position sur tous ses mots-clés suivis, pondérés par leurs impressions sur 28 jours. 100 % = tout en 1re position.",
  aGagner: "Clics supplémentaires par mois si la page atteint son objectif (ou, sans objectif, le top 3, ou la 1re place si elle y est déjà), calculés avec le taux de clic réel du client à chaque position.",
  objectif: "Position visée pour le mot-clé, saisie dans le suivi. Elle sert au calcul des clics à gagner.",
  horsMarque: "Clics Google sur toutes les requêtes qui ne contiennent pas le nom de la marque (fautes de frappe comprises).",
  marque: "Clics Google sur les requêtes qui contiennent le nom de la marque.",
  anonymes: "Requêtes trop rares que Google masque dans le détail : leurs clics comptent dans le total mais ni en marque ni en hors marque.",
  n1: "Même période, un an plus tôt (décalée de 364 jours pour comparer les mêmes jours de la semaine).",
  provisoire: "Les 2 à 3 derniers jours de la Search Console ne sont pas consolidés : ils sont tracés en pointillés et réécrits à la synchro suivante.",
  impact: "Clics par jour après l'action moins clics par jour avant, corrigés de la tendance des mots-clés non travaillés (groupe témoin), ramenés à un mois.",
};
const info = key => `<i class="info" title="${esc(DEF[key] || key)}">i</i>`;

const fmt = n => n == null || !isFinite(n) ? NA : Math.round(n).toLocaleString("fr-FR");
const fmt1 = n => n == null || !isFinite(n) ? NA : n.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtDate = d => new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const fmtDateL = d => new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const fmtDateY = d => new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const shift = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const ndays = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const calDates = (a, b) => { const out = []; for (let d = a; d <= b; d = shift(d, 1)) out.push(d); return out; };
const path = u => { if (!u || u === "*") return "Toutes pages"; try { const x = new URL(u); return x.pathname + x.search; } catch { return u; } };
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = (a, b) => b ? (a - b) / b * 100 : null;
const $ = id => document.getElementById(id);
const issue = (template, params) => `${GH}/issues/new?template=${template}&` + new URLSearchParams(params).toString();
const norm = u => (u || "").replace(/\/$/, "");
const fold = s => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const isRankingUpdate = u => (u.service ? u.service === "Ranking" : /update/i.test(u.title)) && !/discover/i.test(u.title);
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  json: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  put: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const COLS = [
  { id: "page", label: "Page suivie", on: true }, { id: "url", label: "URL du jour", on: true },
  { id: "dcmp", label: "Comparaison", on: true }, { id: "d7", label: "7 j", on: true }, { id: "d28", label: "28 j", on: true },
  { id: "best", label: "Meilleure", on: true }, { id: "demand", label: "Impr. / mois", on: true },
  { id: "clicks", label: "Clics", on: true }, { id: "impr", label: "Impressions", on: false }, { id: "ctr", label: "Taux de clic", on: false },
  { id: "potential", label: "À gagner / mois", on: true }, { id: "status", label: "Statut", on: true }, { id: "target", label: "Objectif", on: true },
  { id: "trend", label: "Tendance", on: true }, { id: "tags", label: "Tags", on: true }];
const defaultCols = () => COLS.filter(c => c.on).map(c => c.id);

let IDX = null, P = null, route = { site: null, view: "" };
const cache = {}, charts = {};
const ui = {
  fresh: store.get("fresh") !== "0",
  range: store.json("range", { preset: "28" }), cmp: store.json("cmp", { mode: "n1" }),
  cols: new Set(store.json("cols", defaultCols())), sort: store.json("sort", { key: "demand", dir: -1 }),
  sel: {}, query: "", tags: new Set(), statuses: new Set(), view: "", openKw: null, pendingKw: null,
  sug: "all", sugSel: new Set(), month: null, kwMode: "kw", who: store.get("who") || "",
  chartOpen: store.get("chartOpen") === "1", metric: "position", trafSeg: "nonbrand",
  ovOpen: store.get("ovOpen2") === "1", ovChart: store.get("ovChart") || "pos",
};

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

const marketOf = name => {
  const p = IDX.projects.find(x => x.name === name);
  return store.get("market:" + name) || (p && p.market) || "all";
};

async function project(name, market) {
  const key = name + "|" + market;
  if (!cache[key]) {
    const file = market === "all" ? name : `${name}.${market}`;
    const r = await fetch(`data/${file}.json?v=` + Date.now());
    if (!r.ok) throw new Error("introuvable");
    const p = await r.json();
    p.keywords.forEach(k => { k.map = new Map(k.s.map(x => [x[0], x])); k.smap = new Map(k.ss.map(x => [x[0], x])); k.alt = k.alt || {}; });
    p.seg = {};
    Object.entries(p.segments).forEach(([s, rows]) => p.seg[s] = new Map(rows.map(x => [x[0], x])));
    p.dates = p.segments.total.map(x => x[0]);
    if (!p.dates.length) p.dates = [...new Set(p.keywords.flatMap(k => k.s.map(x => x[0])))].sort();
    p.moves = p.moves || [];
    cache[key] = p;
  }
  return cache[key];
}

async function onRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  let site = parts[0] || null, view = parts[1] || "";
  if (view === "alertes") view = "a-traiter";                 // anciennes adresses
  if (site && site !== "guide" && !view) view = "mots-cles";   // onglet d'arrivée d'un projet
  if (view === "pages") { view = "mots-cles"; ui.kwMode = "page"; }
  closeDrawer();
  closeCmdk();
  $("app").classList.remove("nav-open");
  if (site !== route.site) { ui.tags.clear(); ui.statuses.clear(); ui.query = ""; ui.month = null; ui.sugSel.clear(); }
  route = { site, view };
  destroyCharts();
  if (site === "guide") { P = null; renderChrome(); return renderGuide(); }
  if (site) {
    $("view").innerHTML = '<div class="loading">Chargement…</div>';
    try { P = await project(site, marketOf(site)); }
    catch {
      try { store.set("market:" + site, "all"); P = await project(site, "all"); }
      catch { P = null; $("view").innerHTML = '<div class="empty">Projet introuvable.</div>'; return; }
    }
  } else P = null;
  renderChrome();
  renderView();
  window.scrollTo(0, 0);
}

function renderView() {
  destroyCharts();
  if (!P) return renderPortfolio();
  ({ "a-traiter": renderToday, "mots-cles": renderKeywords, trafic: renderTraffic, actions: renderActions, opportunites: renderOpps, rapport: renderReport }[route.view] || renderKeywords)();
  if (ui.pendingKw != null) { const i = ui.pendingKw; ui.pendingKw = null; openDrawer(i); }
}

function destroyCharts() {
  Object.values(charts).forEach(c => c.destroy());
  for (const k in charts) delete charts[k];
}

function bindChrome() {
  $("menu-btn").onclick = () => $("app").classList.toggle("nav-open");
  $("scrim").onclick = () => closeDrawer();
  document.addEventListener("keydown", e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("cmdk").hidden ? openCmdk() : closeCmdk(); return; }
    if (e.key === "Escape") { closeCmdk(); closeDrawer(); closeMenus(); }
  });
  document.addEventListener("click", e => { if (!e.target.closest(".menu-wrap")) closeMenus(); });
  $("cmdk-btn").onclick = openCmdk;
  $("filters-btn").onclick = () => { document.querySelector(".topbar").classList.toggle("f-open"); syncTopbar(); };
  $("cmdk").onclick = e => { if (e.target.id === "cmdk") closeCmdk(); };
  $("lnk-project").href = issue("projet.yml", { title: "Projet : " });
  $("lnk-sync").href = `${GH}/actions/workflows/daily.yml`;
  $("lnk-doc").href = "#/guide";
  $("lnk-doc").removeAttribute("target");

  // Filtres de la barre du haut
  $("f-fresh").checked = ui.fresh;
  $("f-fresh").onchange = e => { ui.fresh = e.target.checked; store.set("fresh", ui.fresh ? "1" : "0"); renderChrome(); rerender(); };
  $("f-market").onchange = async e => {
    if (!P) return;
    store.set("market:" + P.name, e.target.value);
    const keep = ui.openKw;
    P = await project(P.name, e.target.value);
    renderChrome(); renderView();
    if (keep != null) openDrawer(keep);
  };
  document.querySelectorAll("#f-range button").forEach(b => b.onclick = () => {
    const v = b.dataset.v;
    ui.range = v === "custom" ? { preset: "custom", from: ui.range.from || (P ? shift(refDay(), -27) : null), to: ui.range.to || (P ? refDay() : null) } : { preset: v };
    store.put("range", ui.range); renderChrome(); rerender();
  });
  ["f-from", "f-to"].forEach(id => $(id).onchange = () => {
    ui.range = { preset: "custom", from: $("f-from").value, to: $("f-to").value };
    if (ui.range.from && ui.range.to && ui.range.from <= ui.range.to) { store.put("range", ui.range); rerender(); }
  });
  $("f-cmp").onchange = e => {
    const v = e.target.value;
    if (v === "custom" && P) { const R = ranges(); ui.cmp = { mode: "custom", from: ui.cmp.from || shift(R.from, -364), to: ui.cmp.to || shift(R.to, -364) }; }
    else ui.cmp = { mode: v };
    store.put("cmp", ui.cmp); renderChrome(); rerender();
  };
  ["f-cfrom", "f-cto"].forEach(id => $(id).onchange = () => {
    ui.cmp = { mode: "custom", from: $("f-cfrom").value, to: $("f-cto").value };
    if (ui.cmp.from && ui.cmp.to && ui.cmp.from <= ui.cmp.to) { store.put("cmp", ui.cmp); rerender(); }
  });
}

// Re-rendu de la vue courante en gardant le panneau de détail ouvert
function rerender() {
  const keep = ui.openKw;
  renderView();
  if (keep != null && P) openDrawer(keep);
}

const owners = () => [...new Set(IDX.projects.map(p => p.owner).filter(Boolean))].sort();
const myProjects = () => IDX.projects.filter(p => !ui.who || p.owner === ui.who);
const nAlerts = p => p.alerts.critique + p.alerts.attention;

function renderChrome() {
  const sev = p => p.alerts.critique ? "ko" : p.alerts.attention ? "warn" : "ok";
  $("projects").innerHTML = `<div class="who"><select id="who" aria-label="Consultant"><option value="">Tous les consultants</option>${owners().map(o => `<option ${o === ui.who ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></div>`
    + myProjects().map(p => `<a href="#/${p.name}" class="${route.site === p.name ? "active" : ""}">
    <span class="avatar">${esc(p.label[0].toUpperCase())}</span>${esc(p.label)}
    ${nAlerts(p) ? `<span class="count ${sev(p)}" title="Alertes à traiter (${esc(p.market_label || "")})">${nAlerts(p)}</span>` : ""}</a>`).join("");
  $("who").onchange = e => { ui.who = e.target.value; store.set("who", ui.who); renderChrome(); if (!route.site) renderPortfolio(); };
  $("nav-portfolio").classList.toggle("active", !route.site);
  $("lnk-doc").classList.toggle("active", route.site === "guide");
  const site = P ? P.name : "";
  $("lnk-action").href = issue("action.yml", { projet: site, title: "Action : " });
  $("lnk-kw").href = issue("mot-cle.yml", { projet: site, title: "Mots-clés : " });

  // Fraîcheur : une seule date, avec le nombre de jours provisoires
  const today = new Date().toISOString().slice(0, 10);
  const states = IDX.projects.map(p => ({ p, ko: p.status && p.status.ok === false, late: p.last_date ? ndays(p.last_date, today) : 99 }));
  const worst = states.find(s => s.ko) || states.find(s => s.late > 4);
  const gen = new Date(IDX.generated_at).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const ref = P || IDX.projects.slice().sort((a, b) => (b.last_date || "").localeCompare(a.last_date || ""))[0];
  const fresh = ref && ref.last_date && ref.last_final ? ndays(ref.last_final, ref.last_date) : 0;
  $("sync").innerHTML = `<div class="sync"><span class="dot ${worst ? "ko" : "ok"}"></span>${worst ? "Synchro en échec" : "Données à jour"}</div>
    <div>Jusqu'au ${ref && ref.last_date ? fmtDate(ref.last_date) : NA}${fresh ? `, dont ${plural(fresh, "jour provisoire", "jours provisoires")}` : ""}</div>
    <div class="light">Synchro du ${gen}</div>
    ${worst ? `<div style="color:var(--status-ko);margin-top:4px">${esc(worst.p.label)} : ${esc(worst.ko ? worst.p.status.error : "pas de donnée depuis " + worst.late + " jours")}</div>` : ""}`;

  // Barre de filtres
  const view = route.view;
  $("f-market").hidden = !P || !(P.markets && P.markets.length > 1);
  if (P && P.markets) $("f-market").innerHTML = P.markets.map(m => `<option value="${m.code}" ${m.code === P.market ? "selected" : ""}>${esc(m.label)}</option>`).join("");
  const showRange = !!P && RANGE_VIEWS.includes(view);
  $("g-range").hidden = $("g-cmp").hidden = !showRange;
  $("g-fresh").hidden = P ? !FRESH_VIEWS.includes(view) : route.site === "guide";
  $("f-fresh").checked = ui.fresh;
  const anyFilter = [$("f-market"), $("g-range"), $("g-fresh")].some(el => !el.hidden);
  $("filters-btn").hidden = !anyFilter;
  if (anyFilter) {
    const rl = { "7": "7 j", "28": "28 j", "90": "90 j", "365": "12 mois", "0": "Tout", custom: "Dates" }[String(ui.range.preset)];
    $("filters-btn").textContent = "Filtres · " + [!$("f-market").hidden && P ? P.market_label : null, showRange ? rl : null, showRange && ui.cmp.mode !== "none" ? cmpLabel() : null].filter(Boolean).join(" · ");
  }
  if (showRange) {
    const R = ranges();
    document.querySelectorAll("#f-range button").forEach(b => b.classList.toggle("active", b.dataset.v === String(ui.range.preset)));
    $("d-range").hidden = ui.range.preset !== "custom";
    $("f-from").value = R.from; $("f-to").value = R.to;
    $("f-from").min = $("f-to").min = P.dates[0] || ""; $("f-from").max = $("f-to").max = refDay();
    $("f-cmp").value = ui.cmp.mode;
    $("d-cmp").hidden = ui.cmp.mode !== "custom";
    if (R.cmp) { $("f-cfrom").value = R.cmp.from; $("f-cto").value = R.cmp.to; }
  }

  const crumbs = $("crumbs");
  if (!P) {
    crumbs.innerHTML = route.site === "guide" ? "Guide d'utilisation" : (ui.who ? `Projets de ${esc(ui.who)}` : "Portefeuille");
    $("subnav").hidden = true;
    document.title = `${route.site === "guide" ? "Guide" : "Portefeuille"} · Positions · datashake`;
    syncTopbar();
    return;
  }
  const vlabel = (VIEWS.find(v => v[0] === view) || VIEWS[0])[1];
  crumbs.innerHTML = `<span>${esc(P.label)}</span><span class="sep">/</span><span class="muted">${vlabel}</span><span class="chip" title="Propriété Search Console">${esc(P.property)}</span>`;
  const n = P.alerts.length;
  $("subnav").hidden = false;
  $("subnav").innerHTML = VIEWS.map(([v, l]) => `<a href="#/${P.name}/${v}" class="${view === v ? "active" : ""}${v === "a-traiter" ? " last" : ""}">${l}${
    v === "a-traiter" && n ? ` <span class="badge ${P.alerts.some(a => a.severity === "critique") ? "ko" : "warn"}">${n}</span>` : ""}${
    v === "actions" && P.actions.length ? ` <span class="badge">${P.actions.length}</span>` : ""}</a>`).join("");
  document.title = `${P.label} · ${vlabel} · Positions`;
  syncTopbar();
}

// La sous-navigation colle sous la barre du haut, dont la hauteur varie avec les filtres affichés
const syncTopbar = () => requestAnimationFrame(() => {
  const s = document.documentElement.style;
  s.setProperty("--tb", document.querySelector(".topbar").offsetHeight + "px");
  s.setProperty("--sn", ($("subnav").hidden ? 0 : $("subnav").offsetHeight) + "px");
});
window.addEventListener("resize", syncTopbar);

// ---------------------------------------------------------------- jour de référence, périodes, comparaisons

const refDay = () => (ui.fresh ? P.last_date : P.last_final) || P.last_date;

function ranges() {
  const ref = refDay(), first = P.dates[0] || ref;
  let from, to;
  if (ui.range.preset === "custom" && ui.range.from && ui.range.to) { from = ui.range.from; to = ui.range.to < ref ? ui.range.to : ref; }
  else if (String(ui.range.preset) === "0") { from = first; to = ref; }
  else { to = ref; from = shift(ref, -(+ui.range.preset || 28) + 1); }
  if (from > to) from = to;
  const len = ndays(from, to) + 1;
  let c = null;
  if (ui.cmp.mode === "prev") c = [shift(from, -len), shift(from, -1)];
  else if (ui.cmp.mode === "n1") c = [shift(from, -364), shift(to, -364)];
  else if (ui.cmp.mode === "custom" && ui.cmp.from && ui.cmp.to) c = [ui.cmp.from, ui.cmp.to];
  return { from, to, len, dates: calDates(from, to), cmp: c && { from: c[0], to: c[1], dates: calDates(c[0], c[1]) } };
}
const cmpLabel = () => ({ n1: "vs N-1", prev: "vs période préc.", custom: "vs comparaison" }[ui.cmp.mode] || "");
const rangeText = R => `${fmtDateY(R.from)} au ${fmtDateY(R.to)}`;
const dShort = (d, ref) => fmtDate(d) + (ref && d.slice(0, 4) !== ref.slice(0, 4) ? " " + d.slice(2, 4) : "");
// Jour de départ des mouvements de la vue d'ensemble : la veille du premier jour de la période (7 j = J-7, 28 j = J-28)
const periodBase = R => shift(R.from, -1);

// Position au jour d, sinon dernière position connue dans les 7 jours précédents
function posAt(m, d, lookback = 7) {
  for (let n = 0; n <= lookback; n++) { const x = m.get(shift(d, -n)); if (x && x[1] != null) return x; }
  return null;
}
const sumImpr = (m, end, n) => { let s = 0; for (let j = 0; j < n; j++) { const x = m.get(shift(end, -j)); if (x) s += x[3]; } return s; };

function kstats(k, R) {
  const m = k.map;
  const pts = R.dates.map(d => m.get(d) || null), present = pts.filter(Boolean);
  const clicks = present.reduce((a, p) => a + p[2], 0), impr = present.reduce((a, p) => a + p[3], 0);
  const cur = posAt(m, R.to), at = d => posAt(m, d);
  const dl = x => cur && x ? +(x[1] - cur[1]).toFixed(1) : null; // positif = gain de places
  const ps = present.map(p => p[1]).filter(v => v != null);
  const st = { pts, present, clicks, impr, ctr: impr ? clicks / impr * 100 : null, cur, pos: cur ? cur[1] : null, exact: !!cur && cur[0] === R.to,
    d7: dl(at(shift(R.to, -7))), d28: dl(at(shift(R.to, -28))), dcmp: R.cmp ? dl(at(R.cmp.to)) : null,
    best: ps.length ? Math.min(...ps) : null, demand: sumImpr(k.smap, R.to, 28), alt: k.alt[R.to] || null };
  st.potential = potential(k, st.pos, st.demand);
  return st;
}

function ctrAt(pos) {
  const c = P.ctr_curve;
  if (!c || pos == null) return 0;
  if (pos <= 1) return c[0];
  if (pos >= 20) return c[19];
  const lo = Math.floor(pos);
  return c[lo - 1] + (c[lo] - c[lo - 1]) * (pos - lo);
}
const targetOf = (k, pos) => k.target || (pos != null && pos <= 3 ? 1 : 3);
function potential(k, pos, demand) {
  if (!P.ctr_curve || pos == null) return null;
  return Math.round(demand * Math.max(0, ctrAt(targetOf(k, pos)) - ctrAt(pos)));
}

function visibilityAt(kws, d) {
  let a = 0, b = 0;
  kws.forEach(k => { const x = posAt(k.map, d), w = sumImpr(k.smap, d, 28); if (x && w) { a += w * ctrAt(x[1]); b += w * ctrAt(1); } });
  return b ? a / b * 100 : null;
}

function segSum(seg, dates) {
  const m = P.seg[seg]; let c = 0, i = 0;
  dates.forEach(d => { const x = m && m.get(d); if (x) { c += x[2]; i += x[3]; } });
  return { clicks: c, impr: i };
}

function trackedClicks(kws, dates) {
  let c = 0;
  kws.forEach(k => dates.forEach(d => { const x = k.map.get(d); if (x) c += x[2]; }));
  return c;
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
  if (!ui.sel[P.name]) ui.sel[P.name] = new Map();
  return ui.sel[P.name];
}
const colorOf = k => { const s = selection(); return s.has(k.i) ? PALETTE[s.get(k.i)] : NEUTRAL; };

function toggleSel(i) {
  const sel = selection();
  if (sel.has(i)) sel.delete(i);
  else if (sel.size < MAX_SEL) {
    const used = new Set(sel.values());
    sel.set(i, [...Array(MAX_SEL).keys()].find(s => !used.has(s)));
    ui.chartOpen = true; store.set("chartOpen", "1");
  }
  renderKeywords();
}

// ---------------------------------------------------------------- composants

function deltaPill(d, { pct: isPct = false, suffix = "" } = {}) {
  if (d == null || !isFinite(d)) return `<span class="pill flat">${NA}</span>`;
  if (Math.abs(d) < (isPct ? 0.5 : 0.05)) return `<span class="pill flat">=</span>`;
  const txt = isPct ? Math.round(Math.abs(d)) + " %" : fmt1(Math.abs(d)) + suffix;
  return `<span class="pill ${d > 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"} ${txt}</span>`;
}
const placesPill = d => deltaPill(d);
const countPill = d => d == null ? `<span class="pill flat">${NA}</span>` : d === 0 ? '<span class="pill flat">=</span>' : `<span class="pill ${d > 0 ? "up" : "down"}">${d > 0 ? "+" : "−"}${Math.abs(d)}</span>`;

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
  if (ok.length < 2) return `<span class="light">${NA}</span>`;
  const w = 68, h = 22, lo = Math.min(...ok), hi = Math.max(...ok), span = hi - lo || 1;
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
const statusTag = s => s ? `<span class="st st-${s.replace(/\W+/g, "")}">${STATUS[s] || esc(s)}</span>` : "";
const targetLabel = t => t == null ? NA : t <= 1 ? "1re place" : t === 3 ? "Top 3" : t === 10 ? "Top 10" : "≤ " + fmt(t);
const kpi = (lbl, val, sub, key) => `<div class="stat"><div class="lbl${key ? " def" : ""}" ${key ? `title="${esc(DEF[key])}"` : ""}>${lbl}</div><div class="row"><span class="val">${val}</span><span class="sub">${sub || ""}</span></div></div>`;
const vsPct = (cur, ref) => ref ? `<span>${deltaPill(pct(cur, ref), { pct: true })} ${cmpLabel()}</span>` : "";
const posCell = st => st.pos == null ? `<span class="light">${NA}</span>`
  : `<span class="pos-cell">${rankTag(st.pos)}<span class="pos ${st.exact ? "" : "stale"}" ${st.exact ? "" : `title="Pas d'impression ce jour-là : dernière position connue, le ${fmtDate(st.cur[0])}"`}>${fmt1(st.pos)}</span></span>`;
const viewBar = (left, right = "") => `<div class="view-bar"><div class="left">${left}</div><div class="right">${right}</div></div>`;
const btnLink = (href, label, cls = "btn") => `<a class="${cls}" href="${href}" target="_blank" rel="noopener">${PLUS}${label}</a>`;

function sortable(tableId, render) {
  document.querySelectorAll(`#${tableId} th[data-sort]`).forEach(th => {
    const on = th.dataset.sort === ui.sort.key;
    th.classList.toggle("sorted", on);
    const ar = th.querySelector(".arrow"); if (ar) ar.textContent = on ? (ui.sort.dir > 0 ? "↑" : "↓") : "↕";
    th.onclick = e => {
      if (e.target.closest(".info")) return;
      const k = th.dataset.sort;
      ui.sort = ui.sort.key === k ? { key: k, dir: -ui.sort.dir } : { key: k, dir: ["keyword", "page", "pos", "best", "target", "status"].includes(k) ? 1 : -1 };
      store.put("sort", ui.sort); render();
    };
  });
}

function closeMenus() { document.querySelectorAll(".menu-wrap.open").forEach(m => m.classList.remove("open")); }
function menuToggle(btnId) {
  const b = $(btnId); if (!b) return;
  b.onclick = e => { e.stopPropagation(); const w = b.closest(".menu-wrap"), was = w.classList.contains("open"); closeMenus(); w.classList.toggle("open", !was); };
}

// ---------------------------------------------------------------- Portefeuille

function renderPortfolio() {
  const list = myProjects();
  const tag = ui.fresh ? "last" : "final";
  const rows = list.map(p => {
    const pos = p["pos_" + tag], prev = p["pos_" + tag + "_prev"];
    return `<tr class="click" onclick="location.hash='#/${p.name}'">
    <td><span class="kw"><span class="avatar">${esc(p.label[0])}</span>${esc(p.label)}</span><div class="light" style="font-size:12px">${esc(p.property)} · ${esc(p.market_label || "Tous pays")}</div></td>
    <td>${esc(p.owner || NA)}</td>
    <td onclick="event.stopPropagation();location.hash='#/${p.name}/a-traiter'" title="Ouvrir À traiter">${p.alerts.critique ? `<span class="badge ko">${p.alerts.critique} urgent${p.alerts.critique > 1 ? "es" : "e"}</span> ` : ""}${p.alerts.attention ? `<span class="badge warn">${p.alerts.attention} à surveiller</span>` : ""}${!nAlerts(p) ? '<span class="badge ok">Rien à signaler</span>' : ""}</td>
    <td class="num">${fmt(p.nonbrand_clicks)}</td>
    <td class="num">${deltaPill(p.nonbrand_vs_n1, { pct: true })}</td>
    <td class="num">${fmt1(pos)} ${placesPill(pos != null && prev != null ? prev - pos : null)}</td>
    <td class="num">${p["top10_" + tag] ?? NA} / ${p.n_keywords}</td>
    <td>${p.last_date ? fmtDate(p.last_date) : NA}</td></tr>`;
  }).join("");
  const ups = (IDX.google_updates || []).filter(isRankingUpdate).slice(-5).reverse();
  $("view").innerHTML = viewBar(`<h1>${ui.who ? `Projets de ${esc(ui.who)}` : "Portefeuille"}</h1>`, btnLink(issue("projet.yml", { title: "Projet : " }), "Nouveau projet"))
    + `<div class="card" style="margin-bottom:18px"><div class="table-wrap"><table>
      <thead><tr><th>Projet</th><th>Consultant</th><th>À traiter</th>
        <th class="num">Clics hors marque 28 j ${info("horsMarque")}</th><th class="num">vs N-1 ${info("n1")}</th>
        <th class="num">Position moyenne ${info("posMoy")}</th><th class="num">Top 10</th><th>Données au</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="8" class="big-empty">Aucun projet${ui.who ? " pour ce consultant" : ""}.</td></tr>`}</tbody></table></div></div>
    <div class="card"><div class="card-head"><h2>Mises à jour de Google</h2></div>
      <div class="card-body">${ups.map(u => `<div class="feed-row"><span class="light" style="width:90px">${fmtDate(u.begin)}</span><a href="${esc(u.url)}" target="_blank" rel="noopener">${esc(u.title)}</a><span class="light">${u.end ? "terminée le " + fmtDate(u.end) : "en cours"}</span></div>`).join("") || '<div class="empty-note">Aucune.</div>'}</div></div>`;
}

// ---------------------------------------------------------------- À traiter (toujours sur le dernier jour définitif)

function renderToday() {
  const lf = P.last_final;
  const kw = i => P.keywords.find(k => k.i === i);
  const moves = P.moves.map(m => ({ ...m, k: kw(m.i) })).filter(m => m.k);
  const ups = moves.filter(x => x.d >= 0.5).sort((a, b) => b.d - a.d).slice(0, 8);
  const downs = moves.filter(x => x.d <= -0.5).sort((a, b) => a.d - b.d).slice(0, 8);
  const measuring = P.actions.filter(a => a.days_after >= 0 && a.days_after < 28);
  // Dernier point connu après la date de l'alerte (souvent provisoire) : montre si le recul est confirmé ou déjà rattrapé
  const since = a => {
    const k = a.i != null && P.keywords.find(x => x.i === a.i), last = k && k.s.length ? k.s[k.s.length - 1] : null;
    if (!last || last[0] <= a.date || last[1] == null) return "";
    const back = (a.type === "top3" && last[1] <= 3) || (a.type === "top10" && last[1] <= 10);
    return `<div class="since">Depuis : <b>${fmt1(last[1])}</b> le ${fmtDate(last[0])}${last[4] ? " (provisoire)" : ""}${back ? ` <span class="badge ok">revenu dans le ${a.type === "top3" ? "top 3" : "top 10"}</span>` : ""}</div>`;
  };
  const alertCard = a => `<div class="card item">${sevTag(a.severity)}<div>
      <h3>${a.keyword ? esc(a.keyword) : esc(TYPES[a.type] || a.type)} <span class="light" style="font-weight:500">· ${esc(TYPES[a.type] || a.type)}</span></h3><p>${esc(a.text)}</p>${since(a)}
      <div class="meta">${a.page && a.page !== "*" ? urlLink(a.page) : ""}<span>au ${fmtDate(a.date)}</span></div></div>
      <div class="num">${a.impact ? `<div class="pos">${fmt(a.impact)}</div><div class="light" style="font-size:12px">clics / mois en jeu</div>` : ""}
      ${a.i != null ? `<button class="btn ghost sm" data-open="${a.i}" style="margin-top:6px">Ouvrir</button>` : ""}</div></div>`;
  const moveRow = x => `<tr class="click" data-i="${x.k.i}"><td><b>${esc(x.k.keyword)}</b></td><td class="num">${fmt1(x.p0)} → <b>${fmt1(x.p1)}</b></td><td class="num">${placesPill(x.d)}</td></tr>`;
  const evs = P.events.filter(e => e.date >= shift(lf, -30) && (e.severity !== "info" || e.type === "hausse")).slice(0, 60);
  const byDay = {};
  evs.forEach(e => (byDay[e.date] = byDay[e.date] || []).push(e));
  const mvHint = `${fmtDate(shift(lf, -7))} → ${fmtDate(lf)}`;

  $("view").innerHTML = `
    <div class="section-title first"><h2>Alertes ${P.alerts.length ? `<span class="badge ${P.alerts.some(a => a.severity === "critique") ? "ko" : "warn"}">${P.alerts.length}</span>` : ""}</h2><span>au ${fmtDateL(lf)}, dernier jour définitif</span></div>
    <div class="list">${P.alerts.map(alertCard).join("") || '<div class="card big-empty"><b>Rien à signaler.</b></div>'}</div>
    <div class="section-title"><h2>Mouvements sur 7 jours</h2><span>${mvHint} ${info("d7")}</span></div>
    <div class="mv">
      <div class="card"><div class="card-head"><h2>Hausses</h2></div><div class="table-wrap"><table><tbody>${ups.map(moveRow).join("") || '<tr><td class="empty-note">Aucune hausse d\'au moins une demi-place.</td></tr>'}</tbody></table></div></div>
      <div class="card"><div class="card-head"><h2>Baisses</h2></div><div class="table-wrap"><table><tbody>${downs.map(moveRow).join("") || '<tr><td class="empty-note">Aucune baisse d\'au moins une demi-place.</td></tr>'}</tbody></table></div></div>
    </div>
    ${measuring.length ? `<div class="section-title"><h2>Actions en cours de mesure</h2><a href="#/${P.name}/actions">Journal</a></div>
      <div class="list">${measuring.map(a => `<div class="card item"><span class="badge">${esc(a.type || "autre")}</span><div><h3>${esc(a.title)}</h3><div class="meta"><span>${fmtDateL(a.date)}</span>${a.page ? urlLink(a.page) : ""}<span>${a.days_after} / 28 jours de recul</span></div></div><div></div></div>`).join("")}</div>` : ""}
    <details class="fold"><summary>Historique des 30 derniers jours</summary><div class="grid-2">
      <div class="card"><div class="card-body">${Object.keys(byDay).sort().reverse().map(d => `<div class="feed-day">${fmtDateL(d)}</div>` + byDay[d].map(e =>
        `<div class="feed-row">${sevTag(e.severity)}<span style="min-width:150px">${e.i != null ? `<span class="k" data-i="${e.i}">${esc(e.keyword)}</span>` : urlLink(e.page || "*")}</span><span class="muted">${esc(e.text)}</span></div>`).join("")).join("") || '<div class="empty-note">Aucun événement.</div>'}</div></div>
      <div class="card"><div class="card-head"><h2>Mises à jour de Google</h2></div><div class="card-body">${(IDX.google_updates || []).filter(isRankingUpdate).slice().reverse().map(u => `<div class="feed-row" style="flex-direction:column;gap:0"><a href="${esc(u.url)}" target="_blank" rel="noopener" style="font-weight:600">${esc(u.title)}</a><span class="light">${fmtDateL(u.begin)}${u.end ? " au " + fmtDateL(u.end) : ", en cours"}</span></div>`).join("")}</div></div>
    </div></details>`;
  document.querySelectorAll("[data-open], [data-i]").forEach(el => el.onclick = () => openDrawer(+(el.dataset.open ?? el.dataset.i)));
}

// ---------------------------------------------------------------- Mots-clés

function matcher(q) {
  if (!q) return null;
  try { return new RegExp(q, "i"); } catch { const l = fold(q); return { test: s => fold(s).includes(l) }; }
}

function filteredKws(kws) {
  const m = matcher(ui.query);
  return kws.filter(k => (!m || m.test(k.keyword) || m.test(k.page) || k.variants.some(v => m.test(v)))
    && (!ui.tags.size || k.tags.some(t => ui.tags.has(t)))
    && (!ui.statuses.size || ui.statuses.has(k.status || "")));
}

function renderKeywords() {
  if (!P) return;
  const R = ranges();
  const all = P.keywords.map(k => ({ ...k, st: kstats(k, R) }));
  const sel = selection();
  all.forEach(k => { k.on = sel.has(k.i); k.color = colorOf(k); });
  const kws = filteredKws(all);
  const mode = ui.kwMode;
  const filtered = kws.length !== all.length;

  // Indicateurs sur l'ensemble filtré (segment)
  const now = kws.filter(k => k.st.pos != null);
  const pairs = R.cmp ? kws.map(k => [k.st.pos, (posAt(k.map, R.cmp.to) || [])[1]]).filter(([a, b]) => a != null && b != null) : [];
  const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
  const avg = mean(now.map(k => k.st.pos));
  const dAvg = pairs.length ? mean(pairs.map(p => p[1])) - mean(pairs.map(p => p[0])) : null;
  const cmpPos = R.cmp ? kws.map(k => (posAt(k.map, R.cmp.to) || [])[1]).filter(v => v != null) : [];
  const t3 = now.filter(k => k.st.pos <= 3).length, t10 = now.filter(k => k.st.pos <= 10).length;
  const c3 = R.cmp ? cmpPos.filter(v => v <= 3).length : null, c10 = R.cmp ? cmpPos.filter(v => v <= 10).length : null;
  const clicks = trackedClicks(kws, R.dates), cClicks = R.cmp ? trackedClicks(kws, R.cmp.dates) : null;
  const vis = visibilityAt(kws, R.to), cVis = R.cmp ? visibilityAt(kws, R.cmp.to) : null;
  const cl = cmpLabel();
  const sub = x => R.cmp ? `<span>${x} vs ${dShort(R.cmp.to, R.to)}</span>` : "";

  $("view").innerHTML = viewBar(`<div class="tabs" id="kw-mode"><button data-m="kw" class="${mode === "kw" ? "active" : ""}">Par mot-clé</button><button data-m="page" class="${mode === "page" ? "active" : ""}">Par page</button></div>
      <span class="light ref-note">Positions au ${fmtDateL(R.to)}${P.last_date === R.to && P.last_date !== P.last_final ? " (provisoire)" : ""}${R.cmp ? `, comparées au ${fmtDateL(R.cmp.to)}` : ""}${filtered ? ` · ${kws.length} mots-clés sur ${all.length}` : ""}</span>`,
      btnLink(issue("mot-cle.yml", { projet: P.name, title: "Mots-clés : " }), "Suivre des mots-clés", "btn sm"))
    + `<div class="card stats">
      ${kpi("Position moyenne", fmt1(avg), sub(placesPill(dAvg)), "posMoy")}
      ${kpi("Top 3", `${t3}<small> / ${kws.length}</small>`, sub(countPill(c3 == null ? null : t3 - c3)), "top")}
      ${kpi("Top 10", `${t10}<small> / ${kws.length}</small>`, sub(countPill(c10 == null ? null : t10 - c10)), "top")}
      ${kpi("Clics", fmt(clicks), R.cmp ? vsPct(clicks, cClicks) : "", "clicsSuivis")}
      ${kpi("Visibilité", vis == null ? NA : fmt1(vis) + "<small> %</small>", sub(deltaPill(vis != null && cVis != null ? vis - cVis : null, { suffix: " pt" })), "visibilite")}
    </div>${mode === "kw" ? `<details class="card overview" id="ov" ${ui.ovOpen ? "open" : ""}><summary><h2>Vue d'ensemble</h2><span class="hint" id="ov-hint"></span></summary><div id="ov-body"></div></details>` : ""}<div id="kw-body"></div>`;
  document.querySelectorAll("#kw-mode button").forEach(b => b.onclick = () => { ui.kwMode = b.dataset.m; renderKeywords(); });
  if (mode === "page") return renderByPage();
  renderByKeyword(all, kws, R);
  $("ov").addEventListener("toggle", e => { ui.ovOpen = e.target.open; store.set("ovOpen2", ui.ovOpen ? "1" : "0"); if (ui.ovOpen) renderOverview(kws, R); });
  renderOverview(kws, R);
}

function renderByKeyword(all, kws, R) {
  const alertKw = new Set(P.alerts.filter(a => a.i != null).map(a => a.i));
  const sel = selection();
  const views = store.json("views:" + P.name, []);
  const tags = [...new Set(P.keywords.flatMap(k => k.tags))].sort();
  const statuses = Object.keys(STATUS).filter(s => P.keywords.some(k => k.status === s));
  $("kw-body").innerHTML = `
    <div class="card">
      <div class="toolbar">
        <label class="search"><svg class="i" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="q" placeholder="Mot-clé ou URL (regex acceptée)" value="${esc(ui.query)}"></label>
        <select id="views" class="ctl" aria-label="Vues enregistrées"><option value="">Vue par défaut</option>${views.map((v, n) => `<option value="${n}" ${ui.view === String(n) ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select>
        <button class="btn ghost sm" id="v-save">Enregistrer la vue</button>
        ${ui.view !== "" && views[+ui.view] ? '<button class="btn ghost sm" id="v-del">Supprimer la vue</button>' : ""}
        <span class="spacer"></span>
        <div class="menu-wrap"><button class="btn ghost sm" id="cols-btn">Colonnes</button>
          <div class="menu">${COLS.map(c => `<label><input type="checkbox" data-col="${c.id}" ${ui.cols.has(c.id) ? "checked" : ""}> ${c.id === "dcmp" ? "Comparaison (" + (cmpLabel() || "aucune") + ")" : c.label}${(c.id === "status" || c.id === "target") && !P.keywords.some(k => k[c.id]) ? ' <span class="light">(aucune donnée)</span>' : ""}</label>`).join("")}
            <button class="btn ghost sm" id="cols-reset" style="margin-top:6px">Par défaut</button></div></div>
        <button class="btn ghost sm" id="csv"><svg class="i" viewBox="0 0 24 24"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/></svg>CSV</button>
      </div>
      ${tags.length || statuses.length ? `<div class="chips" id="chips">
        ${statuses.length ? `<span class="chip-l">Statut</span>${statuses.map(s => `<button class="${ui.statuses.has(s) ? "on" : ""}" data-s="${esc(s)}">${STATUS[s]}</button>`).join("")}` : ""}
        ${tags.length ? `<span class="chip-l">Tags</span>${tags.map(t => `<button class="${ui.tags.has(t) ? "on" : ""}" data-t="${esc(t)}">${esc(t)}</button>`).join("")}` : ""}
        ${ui.tags.size || ui.statuses.size || ui.query ? '<button class="clear" id="clear">Effacer les filtres</button>' : ""}</div>` : ""}
      <div class="table-wrap"><table id="t-kw"><thead id="thead"></thead><tbody id="tbody"></tbody></table></div>
      <div class="table-foot"><span id="t-count"></span><span>Pointillés et valeurs en gris : jours provisoires ou dernière position connue ${info("provisoire")}</span></div>
    </div>
    <details class="card chart-card" id="chart-fold" ${ui.chartOpen ? "open" : ""}>
      <summary><h2>Courbes des mots-clés cochés</h2><span class="hint">${sel.size ? plural(sel.size, "mot-clé", "mots-clés") : "coche des lignes du tableau"}</span></summary>
      <div class="card-body">
        <div class="chart-tools"><div class="tabs" id="metric">${[["position", "Position"], ["clicks", "Clics"], ["impressions", "Impressions"]].map(([m, l]) => `<button data-m="${m}" class="${ui.metric === m ? "active" : ""}">${l}</button>`).join("")}</div></div>
        <div class="legend" id="legend"></div><div class="chart-box"><canvas id="c-main"></canvas></div><div id="marks-main"></div></div>
    </details>`;

  $("q").oninput = e => { ui.query = e.target.value.trim(); ui.view = ""; renderKwTable(all, alertKw, R); };
  $("q").onchange = () => renderKeywords();
  $("csv").onclick = () => exportCsv(filteredKws(all), R);
  menuToggle("cols-btn");
  document.querySelectorAll("[data-col]").forEach(cb => cb.onchange = () => {
    cb.checked ? ui.cols.add(cb.dataset.col) : ui.cols.delete(cb.dataset.col);
    store.put("cols", [...ui.cols]); renderKwTable(all, alertKw, R);
  });
  $("cols-reset").onclick = () => { ui.cols = new Set(defaultCols()); store.put("cols", [...ui.cols]); renderKeywords(); };
  $("views").onchange = e => {
    ui.view = e.target.value;
    const v = views[+ui.view];
    if (ui.view === "" || !v) { ui.query = ""; ui.tags.clear(); ui.statuses.clear(); }
    else {
      ui.query = v.q || ""; ui.tags = new Set(v.tags || []); ui.statuses = new Set(v.statuses || []);
      if (v.cols) { ui.cols = new Set(v.cols); store.put("cols", v.cols); }
      if (v.sort) ui.sort = v.sort;
    }
    renderKeywords();
  };
  $("v-save").onclick = () => {
    const name = prompt("Nom de la vue (ex. Outerwear à travailler)");
    if (!name) return;
    views.push({ name, q: ui.query, tags: [...ui.tags], statuses: [...ui.statuses], cols: [...ui.cols], sort: ui.sort });
    store.put("views:" + P.name, views); ui.view = String(views.length - 1); renderKeywords();
  };
  if ($("v-del")) $("v-del").onclick = () => { views.splice(+ui.view, 1); store.put("views:" + P.name, views); ui.view = ""; renderKeywords(); };
  document.querySelectorAll("#chips [data-t]").forEach(b => b.onclick = () => { const t = b.dataset.t; ui.tags.has(t) ? ui.tags.delete(t) : ui.tags.add(t); ui.view = ""; renderKeywords(); });
  document.querySelectorAll("#chips [data-s]").forEach(b => b.onclick = () => { const s = b.dataset.s; ui.statuses.has(s) ? ui.statuses.delete(s) : ui.statuses.add(s); ui.view = ""; renderKeywords(); });
  if ($("clear")) $("clear").onclick = () => { ui.tags.clear(); ui.statuses.clear(); ui.query = ""; ui.view = ""; renderKeywords(); };
  $("chart-fold").addEventListener("toggle", e => { ui.chartOpen = e.target.open; store.set("chartOpen", ui.chartOpen ? "1" : "0"); if (ui.chartOpen) drawMainChart(kws, R); });
  document.querySelectorAll("#metric button").forEach(b => b.onclick = () => { ui.metric = b.dataset.m; renderKeywords(); });
  renderKwTable(all, alertKw, R);
  if (ui.chartOpen) drawMainChart(kws, R);
}

function drawMainChart(kws, R) {
  const dates = R.dates;
  const sel = selection();
  const on = P.keywords.filter(k => sel.has(k.i)).sort((a, b) => sel.get(a.i) - sel.get(b.i));
  $("legend").innerHTML = on.length ? on.map(k => `<button data-i="${k.i}" title="Retirer du graphique"><span class="sw" style="background:${colorOf(k)}"></span>${esc(k.keyword)}<span class="x">×</span></button>`).join("")
    + `<span class="hint">${on.length} / ${MAX_SEL}</span>` : '<span class="hint">Coche des mots-clés dans le tableau (case de gauche) pour tracer leurs courbes, 8 au maximum.</span>';
  document.querySelectorAll("#legend button").forEach(b => b.onclick = () => toggleSel(+b.dataset.i));
  const val = p => p ? (ui.metric === "position" ? p[1] : ui.metric === "clicks" ? p[2] : p[3]) : null;
  const series = on.map(k => ({ k, b: bucket(dates.map(d => k.map.get(d) || null), dates) }));
  const base = series[0] ? series[0].b : bucket(dates.map(() => null), dates);
  const mk = marksFor(base.ranges);
  const ds = series.map(({ k, b }) => lineDs(k.keyword, b.pts.map(val), colorOf(k), { fresh: b.pts.map(p => p && p[4]) }));
  chart("c-main", { type: "line", data: { labels: base.labels, datasets: ds },
    options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, layout: { padding: { top: 12 } },
      scales: { y: ui.metric === "position" ? posScale(ds.flatMap(d => d.data)) : linScale(), x: xScale() },
      plugins: { legend: { display: false }, marks: { items: mk.items }, tooltip: tooltip({ label: c => ` ${c.dataset.label} : ${ui.metric === "position" ? fmt1(c.parsed.y) : fmt(c.parsed.y)}` }) } } });
  $("marks-main").innerHTML = mk.html;
}

// ---------------------------------------------------------------- Vue d'ensemble des mots-clés (haut de l'onglet)

// Variation de chaque mot-clé entre un jour de base et le jour de référence
function ovRows(kws, refD) {
  return kws.map(k => {
    const a = posAt(k.map, refD), b = k.st.cur;
    return { k, p0: a && a[1], p1: b && b[1], d: a && b ? +(a[1] - b[1]).toFixed(1) : null };
  });
}

// Série globale jour par jour (semaine par semaine au-delà de 3 mois) : position moyenne, visibilité ou clics
function globalSeries(kws, dates, metric) {
  const day = d => {
    if (metric === "pos") { const v = kws.map(k => posAt(k.map, d)).filter(Boolean).map(x => x[1]); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
    if (metric === "vis") return visibilityAt(kws, d);
    let c = 0, any = false; kws.forEach(k => { const x = k.map.get(d); if (x) { c += x[2]; any = true; } }); return any ? c : null;
  };
  const vals = dates.map(day);
  if (dates.length <= 92) return { labels: dates.map(fmtDate), ranges: dates.map(d => [d, d]), vals, fresh: dates.map(d => d > P.last_final) };
  const labels = [], ranges = [], out = [], fresh = [];
  for (let end = dates.length; end > 0; end -= 7) {
    const a = Math.max(0, end - 7), chunk = vals.slice(a, end).filter(v => v != null);
    labels.unshift("sem. du " + fmtDate(dates[a])); ranges.unshift([dates[a], dates[end - 1]]); fresh.unshift(dates[end - 1] > P.last_final);
    out.unshift(chunk.length ? (metric === "clicks" ? chunk.reduce((s, v) => s + v, 0) : chunk.reduce((s, v) => s + v, 0) / chunk.length) : null);
  }
  return { labels, ranges, vals: out, fresh };
}

// Données de la vue d'ensemble : variations sur la période choisie
function ovData(kws, R) {
  const refD = periodBase(R);
  const rows = ovRows(kws, refD), valid = rows.filter(r => r.d != null);
  const ups = valid.filter(r => r.d >= 0.5).sort((a, b) => b.d - a.d), downs = valid.filter(r => r.d <= -0.5).sort((a, b) => a.d - b.d);
  const cross = lim => ({ in: rows.filter(r => r.p1 != null && r.p1 <= lim && (r.p0 == null || r.p0 > lim)),
    out: rows.filter(r => r.p0 != null && r.p0 <= lim && (r.p1 == null || r.p1 > lim)) });
  return { refD, rows, ups, downs, stable: valid.length - ups.length - downs.length, c3: cross(3), c10: cross(10) };
}

function renderOverview(kws, R) {
  if (!$("ov-hint")) return;
  const { refD, rows, ups, downs, stable, c3, c10 } = ovData(kws, R);
  const span = `${dShort(refD, R.to)} → ${dShort(R.to, refD)}`;
  // Résumé lisible même replié
  $("ov-hint").innerHTML = `<span class="ov-sum"><b class="up">${ups.length}</b> en hausse</span><span class="ov-sum"><b class="down">${downs.length}</b> en baisse</span>`
    + `<span class="ov-sum"><b class="up">${c3.in.length}</b> entrent dans le top 3</span><span class="ov-sum"><b class="down">${c3.out.length}</b> en sortent</span>`
    + `<span class="light">sur la période, ${span}</span>`;
  if (!ui.ovOpen || !$("ov-body")) return;

  const moveTable = (list, empty) => `<table class="mini"><thead><tr><th>Mot-clé</th><th class="num">Position</th><th class="num">Variation</th></tr></thead><tbody>
    ${list.slice(0, 6).map(r => `<tr class="click" data-i="${r.k.i}"><td><b>${esc(r.k.keyword)}</b><div class="light sub" title="${esc(DEF.demande)}">${fmt(r.k.st.demand)} impr./mois</div></td><td class="num">${fmt1(r.p0)} → <b>${fmt1(r.p1)}</b></td><td class="num">${placesPill(r.d)}</td></tr>`).join("")
      || `<tr><td colspan="3" class="empty-note">${empty}</td></tr>`}</tbody></table>`;
  const chips = (list, cls) => list.length ? list.map(r => `<button class="kchip ${cls}" data-i="${r.k.i}" title="${esc(r.k.keyword)} : ${r.p0 == null ? "absent" : fmt1(r.p0)} → ${r.p1 == null ? "absent" : fmt1(r.p1)}">${esc(r.k.keyword)} <span class="kp">${r.p0 == null ? "absent" : fmt1(r.p0)} → ${r.p1 == null ? "absent" : fmt1(r.p1)}</span></button>`).join("") : '<span class="light">aucun</span>';

  // Par tag : position moyenne, variation sur la même base, clics vs comparaison
  const tags = [...new Set(kws.flatMap(k => k.tags))];
  const byTag = tags.map(tg => {
    const rs = rows.filter(r => r.k.tags.includes(tg)), ks = rs.map(r => r.k);
    const now = rs.filter(r => r.p1 != null).map(r => r.p1), pr = rs.filter(r => r.d != null);
    const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
    const clicks = trackedClicks(ks, R.dates), cc = R.cmp ? trackedClicks(ks, R.cmp.dates) : null;
    return { tg, n: ks.length, pos: mean(now), d: pr.length ? mean(pr.map(r => r.p0)) - mean(pr.map(r => r.p1)) : null, top3: now.filter(v => v <= 3).length, clicks, dc: cc ? pct(clicks, cc) : null };
  }).sort((a, b) => b.clicks - a.clicks);

  const charts_ = [["pos", "Position moyenne"], ["vis", "Visibilité"], ["clicks", "Clics"], ["dist", "Répartition"]];
  $("ov-body").innerHTML = `
    <div class="ov-grid3">
      <div class="ov-card"><h3>Plus fortes hausses <span class="badge ok">${ups.length}</span><span class="light h-note">${span}</span></h3>${moveTable(ups, "Aucune hausse d'au moins une demi-place.")}</div>
      <div class="ov-card"><h3>Plus fortes baisses <span class="badge ko">${downs.length}</span><span class="light h-note">${span}</span></h3>${moveTable(downs, "Aucune baisse d'au moins une demi-place.")}</div>
      <div class="ov-card"><h3>Entrées et sorties <span class="light h-note">${span}</span></h3>
        <div class="io"><div class="l">Entrent dans le top 3</div><div>${chips(c3.in, "up")}</div></div>
        <div class="io"><div class="l">Sortent du top 3</div><div>${chips(c3.out, "down")}</div></div>
        <div class="io"><div class="l">Entrent dans le top 10</div><div>${chips(c10.in, "up")}</div></div>
        <div class="io"><div class="l">Sortent du top 10</div><div>${chips(c10.out, "down")}</div></div></div>
    </div>
    <div class="grid-eq" style="margin:12px 0 0">
      <div class="ov-card"><div class="ov-head"><h3>Évolution, ${rangeText(R)}</h3><div class="tabs" id="ov-chart">${charts_.map(([v, l]) => `<button data-v="${v}" class="${ui.ovChart === v ? "active" : ""}">${l}</button>`).join("")}</div></div>
        <div class="legend" id="ov-legend"></div><div class="chart-box sm"><canvas id="c-ov"></canvas></div><div id="ov-marks"></div></div>
      <div class="ov-card"><h3>Par tag</h3>${byTag.length ? `<div class="table-wrap"><table class="mini"><thead><tr><th>Tag</th><th class="num def" title="${esc(DEF.posMoy)}">Position moy.</th><th class="num" title="Sur la période, ${span}">Évol. position</th><th class="num">Top 3</th><th class="num">Clics</th>${R.cmp ? `<th class="num">Clics ${cmpLabel()}</th>` : ""}</tr></thead><tbody>
        ${byTag.map(x => `<tr class="click" data-tag="${esc(x.tg)}" title="Filtrer le tableau sur ce tag"><td><span class="tag">${esc(x.tg)}</span> <span class="light">${x.n}</span></td><td class="num">${fmt1(x.pos)}</td><td class="num">${placesPill(x.d)}</td><td class="num">${x.top3}/${x.n}</td><td class="num">${fmt(x.clicks)}</td>${R.cmp ? `<td class="num">${deltaPill(x.dc, { pct: true })}</td>` : ""}</tr>`).join("")}
        </tbody></table></div>` : '<p class="empty-note">Aucun tag sur ces mots-clés. Les tags se saisissent avec les mots-clés (silo, type de page, priorité…).</p>'}</div>
    </div>`;
  document.querySelectorAll("#ov-body [data-i]").forEach(el => el.onclick = () => openDrawer(+el.dataset.i));
  document.querySelectorAll("#ov-body [data-tag]").forEach(el => el.onclick = () => { ui.tags = new Set([el.dataset.tag]); ui.view = ""; renderKeywords(); document.querySelector("#t-kw").scrollIntoView({ behavior: "smooth", block: "start" }); });
  document.querySelectorAll("#ov-chart button").forEach(b => b.onclick = () => { ui.ovChart = b.dataset.v; store.set("ovChart", ui.ovChart); renderOverview(kws, R); });
  drawOverviewChart(kws, R);
}

function drawOverviewChart(kws, R) {
  const m = ui.ovChart;
  if (m === "dist") {
    // Combien de mots-clés dans chaque tranche de position, jour par jour
    const per = kws.map(k => bucket(R.dates.map(d => k.map.get(d) || null), R.dates));
    const base = per[0] || bucket(R.dates.map(() => null), R.dates);
    const ds = DIST.map(b => ({ label: b.name, data: base.labels.map((_, i) => per.filter(x => b.test(x.pts[i] ? x.pts[i][1] : null)).length),
      backgroundColor: b.color, borderWidth: 0, borderRadius: 2, maxBarThickness: 22, stack: "s" }));
    $("ov-legend").innerHTML = DIST.map(b => `<span class="lg"><span class="sw sq" style="background:${b.color}"></span>${b.name}</span>`).join("");
    const mk = marksFor(base.ranges);
    chart("c-ov", { type: "bar", data: { labels: base.labels, datasets: ds },
      options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, layout: { padding: { top: 12 } },
        scales: { y: { ...linScale(), stacked: true, ticks: { precision: 0 } }, x: { ...xScale(), stacked: true } },
        plugins: { legend: { display: false }, marks: { items: mk.items }, tooltip: tooltip({ label: c => ` ${c.dataset.label} : ${c.parsed.y}` }) } } });
    $("ov-marks").innerHTML = mk.html;
    return;
  }
  const cur = globalSeries(kws, R.dates, m);
  const ds = [lineDs(rangeText(R), cur.vals, INK, { fresh: cur.fresh })];
  if (R.cmp) {
    const c = globalSeries(kws, R.cmp.dates, m);
    ds.push(lineDs(rangeText(R.cmp), cur.labels.map((_, n) => c.vals[n] ?? null), CMP, { dash: [4, 4], width: 1.5 }));
  }
  $("ov-legend").innerHTML = `<span class="lg"><span class="line-sw" style="border-color:${INK}"></span>${rangeText(R)}</span>${R.cmp ? `<span class="lg"><span class="line-sw dash" style="border-color:${CMP}"></span>${rangeText(R.cmp)}</span>` : ""}`;
  const mk = marksFor(cur.ranges);
  const f = v => m === "pos" ? fmt1(v) : m === "vis" ? fmt1(v) + " %" : fmt(v);
  chart("c-ov", { type: "line", data: { labels: cur.labels, datasets: ds },
    options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, layout: { padding: { top: 12 } },
      scales: { y: m === "pos" ? posScale(ds.flatMap(d => d.data)) : linScale(), x: xScale() },
      plugins: { legend: { display: false }, marks: { items: mk.items }, tooltip: tooltip({ label: c => ` ${c.dataset.label} : ${f(c.parsed.y)}` }) } } });
  $("ov-marks").innerHTML = mk.html;
}

function renderKwTable(all, alertKw, R) {
  // Colonnes sans aucune donnée sur le projet (statut, objectif) masquées d'office
  const empty = { status: !P.keywords.some(k => k.status), target: !P.keywords.some(k => k.target) };
  const C = id => ui.cols.has(id) && !empty[id];
  const cl = cmpLabel();
  const th = (label, key, def, cls = "num", sub = "") => `<th class="${cls}${def ? " def" : ""}" data-sort="${key}" ${def ? `title="${esc(DEF[def])}"` : ""}>${label}<span class="arrow">↕</span>${sub ? `<span class="th-sub">${sub}</span>` : ""}</th>`;
  $("thead").innerHTML = `<tr><th style="width:30px" title="Tracer la courbe (8 maximum)"></th>${th("Mot-clé", "keyword", "", "")}
    ${C("page") ? th("Page suivie", "page", "", "") : ""}${C("url") && !C("page") ? `<th class="def" title="${esc(DEF.url)}">URL du jour</th>` : ""}
    ${th("Position", "pos", "position", "num", dShort(R.to))}
    ${C("dcmp") && R.cmp ? th(cl, "dcmp", "dcmp", "num", "vs " + dShort(R.cmp.to, R.to)) : ""}${C("d7") ? th("7 j", "d7", "d7", "num", "vs " + dShort(shift(R.to, -7))) : ""}${C("d28") ? th("28 j", "d28", "d28", "num", "vs " + dShort(shift(R.to, -28))) : ""}
    ${C("best") ? th("Meilleure", "best", "best") : ""}${C("demand") ? th("Impr./mois", "demand", "demande") : ""}
    ${C("clicks") ? th("Clics", "clicks", "clicsSuivis") : ""}${C("impr") ? th("Impressions", "impr", "") : ""}${C("ctr") ? th("Taux de clic", "ctr", "") : ""}
    ${C("potential") ? th("À gagner", "potential", "aGagner") : ""}
    ${C("status") ? th("Statut", "status", "", "") : ""}${C("target") ? th("Objectif", "target", "objectif") : ""}
    ${C("trend") ? "<th>Tendance</th>" : ""}</tr>`;
  const sv = { keyword: k => k.keyword, page: k => k.page, pos: k => k.st.pos ?? 999, dcmp: k => k.st.dcmp ?? -999, d7: k => k.st.d7 ?? -999, d28: k => k.st.d28 ?? -999,
    best: k => k.st.best ?? 999, demand: k => k.st.demand, clicks: k => k.st.clicks, impr: k => k.st.impr, ctr: k => k.st.ctr ?? -1,
    potential: k => k.st.potential ?? -1, status: k => Object.keys(STATUS).indexOf(k.status ?? "") + 1 || 9, target: k => k.target ?? 999 }[ui.sort.key] || (k => k.st.demand);
  const rows = filteredKws(all).sort((a, b) => { const x = sv(a), y = sv(b); return (x < y ? -1 : x > y ? 1 : 0) * ui.sort.dir; });
  const sel = selection();
  $("tbody").innerHTML = rows.map(k => {
    const st = k.st;
    const pick = `<button class="pick ${k.on ? "on" : ""}" data-pick="${k.i}" ${!k.on && sel.size >= MAX_SEL ? "disabled" : ""} style="${k.on ? `background:${k.color}` : ""}" title="${k.on ? "Retirer du graphique" : "Tracer la courbe"}" aria-label="Graphique : ${esc(k.keyword)}"></button>`;
    const reached = k.target && st.pos != null && st.pos <= k.target;
    const altTag = st.alt ? `<span class="badge warn alt" title="Le ${fmtDate(R.to)}, ${esc(path(st.alt[0]))} a reçu ${fmt(st.alt[1])} impressions (position ${fmt1(st.alt[2])}) contre ${fmt(st.alt[3])} pour la page suivie">Le ${fmtDate(R.to)} : ${esc(path(st.alt[0]))}</span>` : "";
    return `<tr class="click ${k.i === ui.openKw ? "selected" : ""}" data-i="${k.i}">
      <td>${pick}</td>
      <td><span class="kw">${esc(k.keyword)}${k.variants.length ? ` <span class="badge" title="Variantes regroupées : ${esc(k.variants.join(", "))}">+${k.variants.length}</span>` : ""}${alertKw.has(k.i) ? ' <span class="warn-ico" title="Alerte ouverte">●</span>' : ""}</span>
        ${C("tags") && k.tags.length ? `<div class="tags">${k.tags.map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}</td>
      ${C("page") ? `<td class="page-cell">${urlLink(k.page)}${C("url") && altTag ? `<div>${altTag}</div>` : ""}</td>` : ""}
      ${C("url") && !C("page") ? `<td class="alt-cell">${altTag || '<span class="light">=</span>'}</td>` : ""}
      <td class="num">${posCell(st)}</td>
      ${C("dcmp") && R.cmp ? `<td class="num">${placesPill(st.dcmp)}</td>` : ""}
      ${C("d7") ? `<td class="num">${placesPill(st.d7)}</td>` : ""}${C("d28") ? `<td class="num">${placesPill(st.d28)}</td>` : ""}
      ${C("best") ? `<td class="num">${fmt1(st.best)}</td>` : ""}${C("demand") ? `<td class="num">${fmt(st.demand)}</td>` : ""}
      ${C("clicks") ? `<td class="num">${fmt(st.clicks)}</td>` : ""}${C("impr") ? `<td class="num">${fmt(st.impr)}</td>` : ""}${C("ctr") ? `<td class="num">${st.ctr == null ? NA : fmt1(st.ctr) + " %"}</td>` : ""}
      ${C("potential") ? `<td class="num">${st.potential ? "+" + fmt(st.potential) : NA}</td>` : ""}
      ${C("status") ? `<td>${statusTag(k.status) || `<span class="light">${NA}</span>`}</td>` : ""}
      ${C("target") ? `<td class="num">${k.target ? `<span class="${reached ? "badge ok" : "muted"}">${targetLabel(k.target)}</span>` : `<span class="light">${NA}</span>`}</td>` : ""}
      ${C("trend") ? `<td>${sparkline(st.pts, k.on ? k.color : "#8a8a8a")}</td>` : ""}</tr>`;
  }).join("") || `<tr><td colspan="20" class="empty">Aucun mot-clé ne correspond.</td></tr>`;
  $("tbody").querySelectorAll("tr[data-i]").forEach(tr => tr.onclick = () => openDrawer(+tr.dataset.i));
  $("tbody").querySelectorAll("[data-pick]").forEach(b => b.onclick = e => { e.stopPropagation(); toggleSel(+b.dataset.pick); });
  const wrap = $("t-kw").closest(".table-wrap");
  wrap.classList.remove("sticky");
  requestAnimationFrame(() => wrap.classList.toggle("sticky", wrap.scrollWidth <= wrap.clientWidth + 1 && innerWidth > 860));
  $("t-count").textContent = `${rows.length} mot${rows.length > 1 ? "s" : ""}-clé${rows.length > 1 ? "s" : ""} sur ${all.length}`;
  sortable("t-kw", () => renderKwTable(all, alertKw, R));
}

function exportCsv(kws, R) {
  const head = ["mot-cle", "variantes", "tags", "statut", "objectif", "page", "position", "date_position", "evolution_comparaison", "evolution_7j", "evolution_28j",
    "meilleure_position", "url_du_jour", "impressions_28j", "clics", "impressions", "ctr", "clics_a_gagner_mois"];
  const cell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const num = v => v == null ? "" : String(v).replace(".", ",");
  const lines = [head.join(";")].concat(kws.map(k => { const s = k.st; return [cell(k.keyword), cell(k.variants.join(", ")), cell(k.tags.join(", ")), cell(k.status || ""), num(k.target), cell(k.page),
    num(s.pos), s.cur ? s.cur[0] : "", num(s.dcmp), num(s.d7), num(s.d28), num(s.best), cell(s.alt ? s.alt[0] : ""), s.demand,
    s.clicks, s.impr, num(s.ctr != null ? +s.ctr.toFixed(2) : null), s.potential ?? ""].join(";"); }));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" }));
  a.download = `${P.name}-${P.market}-mots-cles-${R.to}.csv`;
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
          <span class="badge">Dernier passage de Google : ${insp.lastCrawlTime ? fmtDate(insp.lastCrawlTime.slice(0, 10)) : NA}</span>
          ${canon ? `<span class="badge warn">Canonique retenue : ${esc(path(insp.googleCanonical))}</span>` : ""}</div>
        ${hist.length ? `<div class="note-box">${hist.map(h => `${fmtDate(h.date)} : ${esc(h.field)} passe de « ${esc(h.old)} » à « ${esc(h.new)} »`).join("<br>")}</div>` : ""}
        <div class="box"><table><thead><tr><th>Requête (28 j, en gras les mots-clés suivis)</th><th class="num">Clics</th><th class="num">Impressions</th><th class="num">Position moy.</th><th class="num">vs 28 j préc.</th></tr></thead><tbody>
        ${cur.slice(0, 30).map(r => { const p = prev.get(r[0]); return `<tr ${tracked.has(r[0]) ? 'style="font-weight:600"' : ""}><td>${esc(r[0])}</td>
          <td class="num">${fmt(r[1])}</td><td class="num">${fmt(r[2])}</td><td class="num">${fmt1(r[3])}</td><td class="num">${p ? placesPill(p[3] - r[3]) : '<span class="badge info">nouvelle</span>'}</td></tr>`; }).join("") || '<tr><td colspan="5" class="empty">Pas de donnée.</td></tr>'}
        </tbody></table></div></div></details>`;
  }).join("");
  $("kw-body").innerHTML = cards || '<div class="card empty">Aucune page suivie.</div>';
}

// ---------------------------------------------------------------- panneau de détail d'un mot-clé

function openDrawer(i) {
  if (!P) return;
  const k0 = P.keywords.find(k => k.i === i);
  if (!k0) return;
  ui.openKw = i;
  const R = ranges();
  const st = kstats(k0, R);
  const k = { ...k0 };
  const color = colorOf(k0) === NEUTRAL ? PALETTE[0] : colorOf(k0);
  const al = P.alerts.filter(a => a.i === i);
  const insp = P.inspection && P.inspection.current[k.page];
  const others = (k.pages || []).filter(p => !p.tracked && p.share >= 5);
  const cl = cmpLabel();
  $("drawer").innerHTML = `
    <div class="drawer-head"><div style="min-width:0"><h3>${esc(k.keyword)}</h3>${urlLink(k.page)}
      <div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">${statusTag(k.status)}${k.target ? `<span class="badge">Objectif : ${targetLabel(k.target)}</span>` : ""}${k.tags.map(t => `<span class="tag">${esc(t)}</span>`).join("")}${k.variants.map(v => `<span class="badge" title="Variante regroupée">+ ${esc(v)}</span>`).join("")}</div></div>
      <button class="icon-btn" id="d-close" aria-label="Fermer"><svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    <div class="drawer-body">
      ${al.map(a => `<div class="note-box" style="background:var(--status-${a.severity === "critique" ? "ko" : "warn"}-bg)">${sevTag(a.severity)} ${esc(a.text)}</div>`).join("")}
      ${st.alt ? `<div class="note-box">Le ${fmtDate(R.to)}, Google a surtout montré <b>${esc(path(st.alt[0]))}</b> (${fmt(st.alt[1])} impressions, position ${fmt1(st.alt[2])}) au lieu de la page suivie (${fmt(st.alt[3])} impressions).</div>` : ""}
      ${others.length ? `<div class="note-box">Sur 28 jours, ${others.length === 1 ? "une autre page" : others.length + " autres pages"} du site capte${others.length > 1 ? "nt" : ""} aussi des impressions : ${others.map(p => esc(path(p.page)) + " (" + fmt1(p.share) + " %)").join(", ")}.</div>` : ""}
      ${k.note ? `<div class="note-box"><b>Note :</b> ${esc(k.note)}</div>` : ""}
      <div class="mini-kpis">
        <div><div class="l">Position au ${fmtDate(R.to)}</div><div class="v">${posCell(st)}</div></div>
        ${R.cmp ? `<div><div class="l">${cl}</div><div class="v">${placesPill(st.dcmp)}</div></div>` : ""}
        <div><div class="l">7 j</div><div class="v">${placesPill(st.d7)}</div></div>
        <div><div class="l">28 j</div><div class="v">${placesPill(st.d28)}</div></div>
        <div><div class="l">Meilleure</div><div class="v">${fmt1(st.best)}</div></div>
        <div><div class="l">Clics</div><div class="v">${fmt(st.clicks)}</div></div>
        <div><div class="l">Impr. / mois</div><div class="v">${fmt(st.demand)}</div></div>
        <div><div class="l">À gagner / mois</div><div class="v">${st.potential ? "+" + fmt(st.potential) : NA}</div></div>
      </div>
      <h4><span>Position, ${rangeText(R)}</span></h4>
      <div class="legend-static"><span><span class="line-sw" style="border-color:${color}"></span>Page suivie</span><span><span class="line-sw dash" style="border-color:#8a8a8a"></span>Site, toutes pages ${info("positionSite")}</span>${R.cmp ? `<span><span class="line-sw dash" style="border-color:${CMP}"></span>${cl.replace("vs ", "")} (${fmtDate(R.cmp.from)} au ${fmtDate(R.cmp.to)})</span>` : ""}</div>
      <div class="chart-box"><canvas id="d-pos"></canvas></div><div id="d-marks"></div>
      <h4>Impressions et clics</h4><div class="chart-box"><canvas id="d-impr"></canvas></div>
      ${k.pages && k.pages.length ? `<h4>Qui se positionne sur ce mot-clé ? <span class="light">part des impressions</span></h4><div class="box"><table><thead><tr><th>Page du site</th><th class="num">28 j</th><th class="num">7 j</th><th class="num">Position moy.</th><th class="num">Clics</th></tr></thead><tbody>
        ${k.pages.map(p => `<tr ${p.tracked ? 'style="font-weight:600"' : ""}><td>${urlLink(p.page)}${p.tracked ? ' <span class="badge info">suivie</span>' : ""}</td><td class="num">${fmt1(p.share)} %</td><td class="num">${fmt1(p.share7)} %</td><td class="num">${fmt1(p.pos)}</td><td class="num">${fmt(p.clicks)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      ${k.variants_detail && k.variants_detail.length > 1 ? `<h4>Détail des variantes <span class="light">28 derniers jours définitifs</span></h4><div class="box"><table><thead><tr><th>Requête</th><th class="num">Position moy.</th><th class="num">Clics</th><th class="num">Impressions</th></tr></thead><tbody>
        ${k.variants_detail.map(v => `<tr><td>${esc(v.query)}</td><td class="num">${fmt1(v.pos)}</td><td class="num">${fmt(v.clicks)}</td><td class="num">${fmt(v.impr)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      ${insp ? `<h4>La page vue par Google</h4><div class="insp"><span class="badge ${insp.verdict === "PASS" ? "ok" : "ko"}">${insp.verdict === "PASS" ? "Indexée" : esc(insp.coverageState || insp.verdict)}</span>
        <span class="badge">Dernier passage ${insp.lastCrawlTime ? fmtDate(insp.lastCrawlTime.slice(0, 10)) : NA}</span>
        ${insp.googleCanonical && norm(insp.googleCanonical) !== norm(insp.userCanonical) ? `<span class="badge warn">Canonique retenue : ${esc(path(insp.googleCanonical))}</span>` : '<span class="badge ok">Canonique respectée</span>'}</div>` : ""}
      <details class="fold"><summary>Appareils${P.market === "all" ? ", pays" : ""} et historique jour par jour</summary><div>
        ${k.splits ? `<div class="grid-eq" style="margin:0">${["device", "country"].map(dim => k.splits[dim] && k.splits[dim].length ? `<div><h4>${dim === "device" ? "Appareils" : "Pays"} (28 j)</h4><div class="box"><table><tbody>
          ${k.splits[dim].slice(0, 5).map(x => `<tr><td>${esc(dim === "device" ? ({ MOBILE: "Mobile", DESKTOP: "Ordinateur", TABLET: "Tablette" }[x.key] || x.key) : x.key.toUpperCase())}</td><td class="num">pos. ${fmt1(x.pos)}</td><td class="num">${fmt(x.clicks)} clics</td></tr>`).join("")}</tbody></table></div></div>` : "").join("")}</div>` : ""}
        <h4>Jour par jour <span class="light">60 derniers jours</span></h4>
        <div class="box"><table><thead><tr><th>Date</th><th class="num">Position</th><th class="num">Site</th><th class="num">Clics</th><th class="num">Impressions</th><th>Page en tête</th></tr></thead><tbody>
          ${k0.s.slice(-60).reverse().map(p => { const s = k0.smap.get(p[0]), a = k0.alt[p[0]]; return `<tr><td>${fmtDate(p[0])}${p[4] ? '<span class="fresh-tag">provisoire</span>' : ""}</td><td class="num">${fmt1(p[1])}</td><td class="num">${fmt1(s && s[1])}</td><td class="num">${fmt(p[2])}</td><td class="num">${fmt(p[3])}</td><td>${a ? `<span class="badge warn">${esc(path(a[0]))}</span>` : '<span class="light">suivie</span>'}</td></tr>`; }).join("")}</tbody></table></div>
      </div></details>
      <div style="margin-top:18px;display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn ghost sm" href="${issue("action.yml", { projet: P.name, page: k.page === "*" ? "" : k.page, title: "Action : " })}" target="_blank" rel="noopener">Consigner une action sur cette page</a></div>
    </div>`;
  $("d-close").onclick = () => closeDrawer();
  const pts = d => R.dates.map(x => d.get(x) || null);
  const b = bucket(pts(k0.map), R.dates), bs = bucket(pts(k0.smap), R.dates);
  const mk = marksFor(b.ranges, { page: k.page });
  const ds = [lineDs("Page suivie", b.pts.map(p => p && p[1]), color, { fresh: b.pts.map(p => p && p[4]) }),
    lineDs("Site", bs.pts.map(p => p && p[1]), "#8a8a8a", { dash: [4, 3], width: 1.5 })];
  if (R.cmp) {
    const bc = bucket(R.cmp.dates.map(x => k0.map.get(x) || null), R.cmp.dates);
    ds.push(lineDs(cl.replace("vs ", ""), b.labels.map((_, n) => bc.pts[n] ? bc.pts[n][1] : null), CMP, { dash: [2, 3], width: 1.5 }));
  }
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

function closeDrawer() {
  $("app").classList.remove("drawer-open");
  $("drawer").setAttribute("aria-hidden", "true");
  ["d-pos", "d-impr"].forEach(id => { if (charts[id]) { charts[id].destroy(); delete charts[id]; } });
  ui.openKw = null;
  document.querySelectorAll("#tbody tr.selected").forEach(tr => tr.classList.remove("selected"));
}

// ---------------------------------------------------------------- Trafic du site

function renderTraffic() {
  const R = ranges();
  const cl = cmpLabel();
  const S = ["nonbrand", "brand", "total"].reduce((o, s) => ({ ...o, [s]: segSum(s, R.dates), [s + "c"]: R.cmp ? segSum(s, R.cmp.dates) : null }), {});
  const sub = (cur, ref) => R.cmp ? vsPct(cur, ref) : "";
  const SEGS = [["nonbrand", "Hors marque"], ["brand", "Marque"], ["total", "Total"], ["impr", "Impressions"]];
  const seg = ui.trafSeg, segData = seg === "impr" ? "total" : seg, idx = seg === "impr" ? 3 : 2;
  const months = []; const lm = R.to.slice(0, 7);
  for (let i = 12; i >= 0; i--) months.push(shiftMonth(lm, -i));
  $("view").innerHTML = viewBar(`<span class="light ref-note">${rangeText(R)}${R.cmp ? ` · comparé au ${rangeText(R.cmp)}` : ""}${P.market !== "all" ? ` · ${esc(P.market_label)}${P.market_path ? ` (URL contenant ${esc(P.market_path)})` : ""}` : ""}</span>`)
    + `<div class="card stats">
      ${kpi("Clics hors marque", fmt(S.nonbrand.clicks), sub(S.nonbrand.clicks, S.nonbrandc && S.nonbrandc.clicks), "horsMarque")}
      ${kpi("Clics marque", fmt(S.brand.clicks), sub(S.brand.clicks, S.brandc && S.brandc.clicks), "marque")}
      ${kpi("Clics au total", fmt(S.total.clicks), sub(S.total.clicks, S.totalc && S.totalc.clicks))}
      ${kpi("Impressions au total", fmt(S.total.impr), sub(S.total.impr, S.totalc && S.totalc.impr))}
    </div>
    <div class="card" style="margin-bottom:12px"><div class="card-head"><h2>Par jour</h2>
      <div class="tabs" id="t-seg">${SEGS.map(([v, l]) => `<button data-v="${v}" class="${seg === v ? "active" : ""}">${l}</button>`).join("")}</div></div>
      <div class="card-body"><div class="legend-static"><span><span class="line-sw" style="border-color:${INK}"></span>${rangeText(R)}</span>${R.cmp ? `<span><span class="line-sw dash" style="border-color:${CMP}"></span>${rangeText(R.cmp)}</span>` : ""}</div>
      <div class="chart-box"><canvas id="c-traffic"></canvas></div><div id="marks-traffic"></div></div></div>
    <div class="card"><div class="card-head"><h2>Par mois</h2><span class="hint">13 mois, ${SEGS.find(s => s[0] === seg)[1].toLowerCase()}</span></div>
      <div class="card-body"><div class="chart-box sm"><canvas id="c-months"></canvas></div></div></div>
    ${P.anonymized_share != null ? `<p class="footnote">${fmt1(P.anonymized_share)} % des clics viennent de requêtes masquées par Google ${info("anonymes")}, comptées dans le total seulement.</p>` : ""}`;
  document.querySelectorAll("#t-seg button").forEach(b => b.onclick = () => { ui.trafSeg = b.dataset.v; renderTraffic(); });
  const segPts = ds_ => ds_.map(d => (P.seg[segData] && P.seg[segData].get(d)) || null);
  const tb = bucket(segPts(R.dates), R.dates);
  const ds = [lineDs(rangeText(R), tb.pts.map(p => p && p[idx]), INK, { fresh: tb.pts.map(p => p && p[4]) })];
  if (R.cmp) { const tc = bucket(segPts(R.cmp.dates), R.cmp.dates); ds.push(lineDs(rangeText(R.cmp), tb.labels.map((_, n) => tc.pts[n] ? tc.pts[n][idx] : null), CMP, { dash: [4, 4], width: 1.5 })); }
  const mk = marksFor(tb.ranges, { actions: false });
  chart("c-traffic", { type: "line", data: { labels: tb.labels, datasets: ds },
    options: { maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, layout: { padding: { top: 12 } }, scales: { y: linScale(), x: xScale() },
      plugins: { legend: { display: false }, marks: { items: mk.items }, tooltip: tooltip({ label: c => ` ${c.dataset.label} : ${fmt(c.parsed.y)}` }) } } });
  $("marks-traffic").innerHTML = mk.html;
  const mval = x => { const s = segSum(segData, monthDates(x)); return seg === "impr" ? s.impr : s.clicks; };
  chart("c-months", { type: "bar", data: { labels: months.map(x => MONTHS[+x.slice(5) - 1].slice(0, 4) + ". " + x.slice(2, 4)),
      datasets: [{ data: months.map(mval), backgroundColor: months.map((x, i) => i === months.length - 1 ? "#C9C9C9" : "#101010"), borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom", maxBarThickness: 36 }] },
    options: { maintainAspectRatio: false, scales: { y: linScale(), x: { grid: { display: false } } }, plugins: { legend: { display: false }, tooltip: tooltip({ label: c => ` ${fmt(c.parsed.y)}` }) } } });
}

// ---------------------------------------------------------------- Actions

function renderActions() {
  const kwName = i => (P.keywords.find(k => k.i === i) || {}).keyword;
  const cards = P.actions.map(a => {
    const im = a.impact;
    const adj = im && im.clicks_month_adjusted;
    const verdict = adj == null ? "" : adj > 0 ? `<span class="pill up">▲ +${fmt(adj)} clics / mois</span>` : adj < 0 ? `<span class="pill down">▼ ${fmt(adj)} clics / mois</span>` : '<span class="pill flat">Pas d\'effet mesurable</span>';
    const body = im ? `<div class="impact">
        <div><div class="l">Position moy. avant → après</div><div class="v">${fmt1(im.pos_before)} → ${fmt1(im.pos_after)}</div></div>
        <div><div class="l">Clics par jour avant → après</div><div class="v">${fmt1(im.clicks_day_before)} → ${fmt1(im.clicks_day_after)}</div></div>
        <div><div class="l">Impressions par jour</div><div class="v">${fmt(im.impr_day_before)} → ${fmt(im.impr_day_after)}</div></div>
        <div><div class="l">Effet de l'action ${info("impact")}</div><div class="v">${verdict}</div></div></div>
        <div class="meta" style="margin-top:8px">Mesuré sur ${im.window_after} jours après la mise en ligne${im.window_after < 28 ? " (définitif à 28 jours)" : ""}.</div>`
      : `<div class="meta" style="margin-top:8px">${esc(a.reason || "")}</div>`;
    return `<div class="card item"><span class="badge">${esc(a.type || "autre")}</span><div>
      <h3>${esc(a.title || "Action")}</h3>${a.description ? `<p>${esc(a.description)}</p>` : ""}
      <div class="meta"><span>${fmtDateL(a.date)}</span>${a.page ? urlLink(a.page) : ""}${a.author ? `<span>${esc(a.author)}</span>` : ""}
      ${a.keywords && a.keywords.length ? `<span>Mesuré sur : ${a.keywords.map(i => `<span class="k" data-i="${i}" style="cursor:pointer;text-decoration:underline">${esc(kwName(i))}</span>`).join(", ")}</span>` : ""}</div>${body}</div><div></div></div>`;
  }).join("");
  $("view").innerHTML = viewBar(`<span class="light ref-note">${plural(P.actions.length, "action", "actions")}</span>`, btnLink(issue("action.yml", { projet: P.name, title: "Action : " }), "Ajouter une action"))
    + `<div class="list">${cards || `<div class="card big-empty">Aucune action consignée.</div>`}</div>
    <details class="fold"><summary>Méthode de mesure</summary><div class="explain">28 jours avant la mise en ligne contre 28 jours après (7 minimum), sur les mots-clés suivis de la page, en position moyenne et en clics. La tendance des mots-clés non touchés (groupe témoin) est retirée, puis le résultat est ramené à un mois. L'action apparaît en repère « A » sur les courbes.</div></details>`;
  document.querySelectorAll("[data-i]").forEach(el => el.onclick = () => openDrawer(+el.dataset.i));
}

// ---------------------------------------------------------------- Opportunités

function renderOpps() {
  const R = ranges();
  const kws = P.keywords.map(k => ({ ...k, st: kstats(k, R) })).filter(k => k.st.potential).sort((a, b) => b.st.potential - a.st.potential);
  const flagsL = { top: "Fait déjà des clics", striking: "Proche de la 1re page", nouvelle: "Nouvelle requête" };
  const sug = P.suggestions.filter(s => ui.sug === "all" || s.flags.includes(ui.sug));
  const bulk = () => issue("mot-cle.yml", { projet: P.name, mots_cles: P.suggestions.filter(s => ui.sugSel.has(s.query)).map(s => `${s.query} | ${s.page || ""}`).join("\n"), title: `Mots-clés : ${ui.sugSel.size} suggestions` });
  $("view").innerHTML = viewBar(`<span class="light ref-note">Positions au ${fmtDateL(R.to)}${P.market !== "all" ? " · " + esc(P.market_label) : ""}</span>`)
    + `<div class="section-title first"><h2>Mots-clés suivis à pousser</h2><span>${info("aGagner")}</span></div>
    <div class="card"><div class="table-wrap"><table>
      <thead><tr><th>Mot-clé</th><th>Page</th><th class="num">Position</th><th class="num">Objectif</th><th class="num">Impr. / mois</th><th class="num">Clics à gagner / mois</th></tr></thead><tbody>
      ${kws.slice(0, 20).map(k => `<tr class="click" data-i="${k.i}"><td><b>${esc(k.keyword)}</b> ${statusTag(k.status)}</td><td>${urlLink(k.page)}</td><td class="num">${posCell(k.st)}</td><td class="num">${targetLabel(targetOf(k, k.st.pos))}${k.target ? "" : ' <span class="light">(auto)</span>'}</td><td class="num">${fmt(k.st.demand)}</td><td class="num"><b>+${fmt(k.st.potential)}</b></td></tr>`).join("") || '<tr><td colspan="6" class="empty">Pas de potentiel calculable.</td></tr>'}
      </tbody></table></div></div>
    <div class="section-title"><h2>Requêtes à commencer à suivre</h2><span>hors marque, 28 derniers jours</span></div>
    <div class="card">
      <div class="toolbar"><div class="tabs" id="sug-f">${[["all", "Toutes"], ["top", "Font déjà des clics"], ["striking", "Proches de la 1re page"], ["nouvelle", "Nouvelles"]].map(([v, l]) => `<button data-v="${v}" class="${ui.sug === v ? "active" : ""}">${l}</button>`).join("")}</div>
        <span class="spacer"></span><a class="btn sm ${ui.sugSel.size ? "" : "disabled"}" id="bulk" target="_blank" rel="noopener" href="${ui.sugSel.size ? bulk() : "#"}">${PLUS}Suivre la sélection (${ui.sugSel.size})</a></div>
      <div class="table-wrap"><table><thead><tr><th style="width:30px"><input type="checkbox" id="sug-all" aria-label="Tout cocher"></th><th>Requête</th><th>Page qui ressort</th><th class="num">Position moy. 28 j</th><th class="num">Clics</th><th class="num">Impressions</th><th class="num">Clics à gagner / mois</th><th>Pourquoi</th><th></th></tr></thead><tbody>
      ${sug.map(s => `<tr><td><input type="checkbox" data-q="${esc(s.query)}" ${ui.sugSel.has(s.query) ? "checked" : ""}></td><td><b>${esc(s.query)}</b></td><td>${urlLink(s.page)}</td><td class="num">${fmt1(s.pos)}</td><td class="num">${fmt(s.clicks)}</td><td class="num">${fmt(s.impr)}</td>
        <td class="num">${s.potential ? "+" + fmt(s.potential) : NA}</td>
        <td>${s.flags.map(f => `<span class="badge ${f === "nouvelle" ? "info" : f === "striking" ? "warn" : ""}">${flagsL[f]}</span>`).join(" ")}</td>
        <td><a class="btn ghost sm" target="_blank" rel="noopener" href="${issue("mot-cle.yml", { projet: P.name, mots_cles: `${s.query} | ${s.page || ""}`, title: "Mots-clés : " + s.query })}">Suivre</a></td></tr>`).join("") || '<tr><td colspan="9" class="empty">Aucune suggestion.</td></tr>'}
      </tbody></table></div>
      <div class="table-foot"><span>${sug.length} requêtes</span></div>
    </div>
    <details class="fold" id="ctr-fold"><summary>Taux de clic du client par position</summary><div class="card"><div class="card-body"><div class="chart-box sm"><canvas id="c-ctr"></canvas></div></div></div></details>`;
  document.querySelectorAll("tr[data-i]").forEach(tr => tr.onclick = () => openDrawer(+tr.dataset.i));
  document.querySelectorAll("#sug-f button").forEach(b => b.onclick = () => { ui.sug = b.dataset.v; renderOpps(); });
  const sync = () => { const a = $("bulk"); a.textContent = ""; a.insertAdjacentHTML("beforeend", `${PLUS}Suivre la sélection (${ui.sugSel.size})`); a.classList.toggle("disabled", !ui.sugSel.size); a.href = ui.sugSel.size ? bulk() : "#"; };
  document.querySelectorAll("[data-q]").forEach(cb => cb.onchange = () => { cb.checked ? ui.sugSel.add(cb.dataset.q) : ui.sugSel.delete(cb.dataset.q); sync(); });
  $("sug-all").onchange = e => { document.querySelectorAll("[data-q]").forEach(cb => { cb.checked = e.target.checked; e.target.checked ? ui.sugSel.add(cb.dataset.q) : ui.sugSel.delete(cb.dataset.q); }); sync(); };
  $("bulk").onclick = e => { if (!ui.sugSel.size) e.preventDefault(); };
  $("ctr-fold").addEventListener("toggle", e => {
    if (e.target.open && P.ctr_curve && !charts["c-ctr"]) chart("c-ctr", { type: "bar", data: { labels: P.ctr_curve.map((_, i) => i + 1), datasets: [{ data: P.ctr_curve.map(v => v * 100), backgroundColor: "#2a78d6", borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom" }] },
      options: { maintainAspectRatio: false, scales: { y: { ...linScale(), ticks: { callback: v => v + " %" } }, x: { grid: { display: false }, title: { display: true, text: "Position" } } },
        plugins: { legend: { display: false }, tooltip: tooltip({ title: c => "Position " + c[0].label, label: c => ` Taux de clic : ${fmt1(c.parsed.y)} %` }) } } });
  });
}

// ---------------------------------------------------------------- Rapport mensuel (figé sur son mois, données définitives)

const REPORT_BLOCKS = [["synthese", "Synthèse"], ["chiffres", "Chiffres clés"], ["trafic", "Trafic 13 mois"], ["motscles", "Mots-clés suivis"],
  ["actions", "Actions du mois"], ["vigilance", "Points de vigilance"], ["suite", "Prochaines étapes"]];

function renderReport() {
  const lf = P.last_final;
  const finals = P.dates.filter(d => d <= lf);
  const months = [...new Set(finals.map(d => d.slice(0, 7)))].sort().reverse();
  const complete = m => finals.includes(lastDay(m));
  if (!ui.month || !months.includes(ui.month)) ui.month = months.find(complete) || months[0];
  const m = ui.month, pm = shiftMonth(m, -1), nm = shiftMonth(m, -12);
  const md = monthDates(m).filter(d => d <= lf), pmd = monthDates(pm), nmd = monthDates(nm);
  const end = md[md.length - 1], pend = lastDay(pm), nend = lastDay(nm);
  const mlabel = x => MONTHS[+x.slice(5) - 1] + " " + x.slice(0, 4);
  const blocks = new Set(store.json("reportBlocks:" + P.name, REPORT_BLOCKS.map(b => b[0])));
  const saveKey = `report:${P.name}:${P.market}:${m}`;
  const saved = store.json(saveKey, {});
  const nb = segSum("nonbrand", md), nbp = segSum("nonbrand", pmd), nb1 = segSum("nonbrand", nmd);
  const cl = trackedClicks(P.keywords, md), clp = trackedClicks(P.keywords, pmd), cl1 = trackedClicks(P.keywords, nmd);
  const rows = P.keywords.map(k => {
    const c = posAt(k.map, end), p = posAt(k.map, pend), n = posAt(k.map, nend);
    const clicks = md.reduce((a, d) => a + ((k.map.get(d) || [])[2] || 0), 0), pclicks = pmd.reduce((a, d) => a + ((k.map.get(d) || [])[2] || 0), 0);
    const impr = md.reduce((a, d) => a + ((k.map.get(d) || [])[3] || 0), 0);
    return { k, c: c && c[1], p: p && p[1], n: n && n[1], d: c && p ? +(p[1] - c[1]).toFixed(1) : null, clicks, pclicks, impr };
  });
  const withPos = rows.filter(x => x.c != null);
  const avg = withPos.length ? withPos.reduce((a, x) => a + x.c, 0) / withPos.length : null;
  const prevPos = rows.filter(x => x.p != null), avgP = prevPos.length ? prevPos.reduce((a, x) => a + x.p, 0) / prevPos.length : null;
  const top3 = withPos.filter(x => x.c <= 3).length, top10 = withPos.filter(x => x.c <= 10).length;
  const top3p = prevPos.filter(x => x.p <= 3).length;
  const ranked = rows.filter(x => x.d != null && x.impr >= 100);
  const best = ranked.slice().sort((a, b) => b.d - a.d)[0], worst = ranked.slice().sort((a, b) => a.d - b.d)[0];
  const acts = P.actions.filter(a => a.date && a.date.slice(0, 7) === m);
  const sign = x => x == null ? "" : (x > 0 ? "+" : "") + Math.round(x) + " %";
  const partial = !complete(m);
  const ups = (IDX.google_updates || []).filter(u => isRankingUpdate(u) && u.begin.slice(0, 7) === m);
  // Points de vigilance : événements du mois (figés), un par mot-clé et par règle, le plus récent
  const seen = new Set();
  const vig = P.events.filter(e => e.date.slice(0, 7) === m && e.severity !== "info").filter(e => { const id = (e.keyword || e.page) + "|" + e.type; if (seen.has(id)) return false; seen.add(id); return true; })
    .sort((a, b) => (a.severity === "critique" ? 0 : 1) - (b.severity === "critique" ? 0 : 1) || b.date.localeCompare(a.date));

  // Commentaire construit uniquement à partir des chiffres (modifiable)
  const s = [];
  s.push(`En ${mlabel(m)}${partial ? ` (données jusqu'au ${fmtDateL(end)})` : ""}, le site a généré ${fmt(nb.clicks)} clics hors marque depuis Google${nb1.clicks ? `, ${sign(pct(nb.clicks, nb1.clicks))} par rapport à ${mlabel(nm)}` : ""}${nbp.clicks ? ` et ${sign(pct(nb.clicks, nbp.clicks))} par rapport à ${mlabel(pm)}` : ""}.`);
  s.push(`Au ${fmtDateL(end)}, ${top3} des ${rows.length} mots-clés suivis sont dans le top 3 (${top3p} fin ${MONTHS[+pm.slice(5) - 1]}) et ${top10} dans le top 10, pour une position moyenne de ${fmt1(avg)}${avgP != null ? ` contre ${fmt1(avgP)} un mois plus tôt` : ""}.`);
  if (best && best.d > 0.2) s.push(`Plus forte progression : « ${best.k.keyword} », de la position ${fmt1(best.p)} à ${fmt1(best.c)}.`);
  if (worst && worst.d < -0.2) s.push(`Plus fort recul : « ${worst.k.keyword} », de ${fmt1(worst.p)} à ${fmt1(worst.c)}.`);
  s.push(acts.length ? `${plural(acts.length, "action SEO mise en ligne", "actions SEO mises en ligne")} ce mois-ci.` : "Aucune action SEO consignée ce mois-ci.");
  if (ups.length) s.push(`Google a déployé ${ups.map(u => `la « ${u.title} » (${fmtDateL(u.begin)})`).join(" et ")}.`);
  const lede = saved.lede ?? s.join(" ");

  const last13 = []; for (let i = 12; i >= 0; i--) last13.push(shiftMonth(m, -i));
  const monthly = last13.map(x => segSum("nonbrand", monthDates(x)).clicks);
  let num = 0;
  const sec = (id, title, body) => blocks.has(id) ? `<section><div class="section-head"><h2>${title}</h2><span class="section-num">${String(++num).padStart(2, "0")}</span></div>${body}</section>` : "";

  $("view").innerHTML = `
    <div class="view-bar no-print"><div class="left">
      <select id="month" class="ctl">${months.map(x => `<option value="${x}" ${x === m ? "selected" : ""}>${mlabel(x)}${complete(x) ? "" : " (en cours)"}</option>`).join("")}</select>
      <div class="menu-wrap"><button class="btn ghost sm" id="blocks-btn">Blocs</button><div class="menu">${REPORT_BLOCKS.map(([id, l]) => `<label><input type="checkbox" data-b="${id}" ${blocks.has(id) ? "checked" : ""}> ${l}</label>`).join("")}</div></div>
      <button class="btn ghost sm" id="r-reset" ${saved.lede == null && saved.next == null ? "hidden" : ""}>Rétablir le texte automatique</button>
      <span class="light ref-note">Les textes se modifient directement dans le rapport.</span></div>
      <div class="right"><button class="btn" onclick="window.print()"><svg class="i" viewBox="0 0 24 24"><path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M6 14h12v7H6z"/></svg>Imprimer / PDF</button></div></div>
    <div class="report">
      <div class="report-head"><div class="logo">${document.querySelector(".brand svg").outerHTML}datashake</div>
        <div class="meta"><div><strong>Client</strong> ${esc(P.label)}</div><div><strong>Période</strong> ${mlabel(m)}</div>${P.market !== "all" ? `<div><strong>Pays</strong> ${esc(P.market_label)}</div>` : ""}<div><strong>Consultant</strong> ${esc(P.owner || "")}</div><div><strong>Source</strong> Google Search Console</div></div></div>
      <h1>Rapport SEO · ${mlabel(m)}</h1>
      ${blocks.has("synthese") ? `<p class="lede editable" contenteditable="true" id="r-lede">${esc(lede)}</p>` : ""}
      ${blocks.has("chiffres") ? `<div class="hero">
        <div><div class="num">${fmt(nb.clicks)}</div><div class="lbl">Clics hors marque (site)</div><div class="cmp">${sign(pct(nb.clicks, nb1.clicks)) || NA} vs N-1 · ${sign(pct(nb.clicks, nbp.clicks)) || NA} vs M-1</div></div>
        <div><div class="num">${fmt(cl)}</div><div class="lbl">Clics mots-clés suivis</div><div class="cmp">${sign(pct(cl, cl1)) || NA} vs N-1 · ${sign(pct(cl, clp)) || NA} vs M-1</div></div>
        <div><div class="num">${top3} / ${top10}</div><div class="lbl">Top 3 / top 10 au ${fmtDate(end)}</div><div class="cmp">sur ${rows.length} mots-clés suivis</div></div>
        <div><div class="num">${fmt1(avg)}</div><div class="lbl">Position moyenne au ${fmtDate(end)}</div><div class="cmp">${fmt1(avgP)} au ${fmtDate(pend)}</div></div>
      </div>` : ""}
      ${sec("trafic", "Trafic hors marque, 13 derniers mois", '<div class="chart-box sm"><canvas id="r-months"></canvas></div>')}
      ${sec("motscles", "Mots-clés suivis", `<div class="box"><table><thead><tr><th>Mot-clé</th><th class="num">Position au ${fmtDate(end)}</th><th class="num">au ${fmtDate(pend)}</th><th class="num">Évolution</th><th class="num">N-1</th><th class="num">Clics</th><th class="num">vs M-1</th></tr></thead><tbody>
        ${rows.sort((a, b) => b.clicks - a.clicks).map(x => `<tr><td><b>${esc(x.k.keyword)}</b></td><td class="num">${fmt1(x.c)}</td><td class="num">${fmt1(x.p)}</td><td class="num">${placesPill(x.d)}</td><td class="num">${fmt1(x.n)}</td><td class="num">${fmt(x.clicks)}</td><td class="num">${deltaPill(pct(x.clicks, x.pclicks), { pct: true })}</td></tr>`).join("")}
        </tbody></table></div>`)}
      ${sec("actions", "Actions du mois", acts.length ? `<div class="box"><table><thead><tr><th>Date</th><th>Action</th><th>Page</th><th class="num">Position moy. avant → après</th><th class="num">Effet</th></tr></thead><tbody>
          ${acts.map(a => `<tr><td>${fmtDate(a.date)}</td><td><b>${esc(a.title)}</b><div class="light">${esc(a.type || "")}</div></td><td>${a.page ? urlLink(a.page) : ""}</td>
          <td class="num">${a.impact ? fmt1(a.impact.pos_before) + " → " + fmt1(a.impact.pos_after) : NA}</td><td class="num">${a.impact && a.impact.clicks_month_adjusted != null ? (a.impact.clicks_month_adjusted > 0 ? "+" : "") + fmt(a.impact.clicks_month_adjusted) + " clics / mois" : esc(a.reason || NA)}</td></tr>`).join("")}</tbody></table></div>`
          : '<p class="muted">Aucune action consignée ce mois-ci.</p>')}
      ${sec("vigilance", "Points de vigilance du mois", vig.length ? vig.slice(0, 12).map(e => `<div class="feed-row">${sevTag(e.severity)}<span class="light" style="min-width:56px">${fmtDate(e.date)}</span><b>${esc(e.keyword || path(e.page) || "")}</b><span class="muted">${esc(e.text)}</span></div>`).join("") : '<p class="muted">Aucune alerte ce mois-ci.</p>')}
      ${sec("suite", "Prochaines étapes", `<div class="editable next" contenteditable="true" id="r-next" data-placeholder="Écris ici les prochaines étapes.">${esc(saved.next || "")}</div>`)}
      <div class="footer"><div>datashake · Rapport SEO · ${esc(P.label)}</div><div>${fmtDateL(new Date().toISOString().slice(0, 10))}</div></div>
    </div>`;
  $("month").onchange = e => { ui.month = e.target.value; renderReport(); };
  menuToggle("blocks-btn");
  document.querySelectorAll("[data-b]").forEach(cb => cb.onchange = () => {
    cb.checked ? blocks.add(cb.dataset.b) : blocks.delete(cb.dataset.b);
    store.put("reportBlocks:" + P.name, [...blocks]); renderReport();
  });
  const persist = () => {
    const cur = store.json(saveKey, {});
    if ($("r-lede")) cur.lede = $("r-lede").innerText.trim();
    if ($("r-next")) cur.next = $("r-next").innerText.trim();
    store.put(saveKey, cur); $("r-reset").hidden = false;
  };
  ["r-lede", "r-next"].forEach(id => { if ($(id)) $(id).oninput = persist; });
  $("r-reset").onclick = () => { try { localStorage.removeItem(saveKey); } catch {} renderReport(); };
  if (blocks.has("trafic")) chart("r-months", { type: "bar", data: { labels: last13.map(x => MONTHS[+x.slice(5) - 1].slice(0, 4) + ". " + x.slice(2, 4)), datasets: [{ data: monthly,
      backgroundColor: last13.map(x => x === m ? "#101010" : "#C9C9C9"), borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "bottom", maxBarThickness: 36 }] },
    options: { maintainAspectRatio: false, animation: false, scales: { y: linScale(), x: { grid: { display: false } } }, plugins: { legend: { display: false }, tooltip: tooltip({ label: c => ` ${fmt(c.parsed.y)} clics` }) } } });
}

const monthDates = m => { const out = []; let d = m + "-01"; while (d.slice(0, 7) === m) { out.push(d); d = shift(d, 1); } return out; };
const lastDay = m => monthDates(m).pop();
const shiftMonth = (m, n) => { const t = new Date(m + "-01T00:00:00Z"); t.setUTCMonth(t.getUTCMonth() + n); return t.toISOString().slice(0, 7); };

// ---------------------------------------------------------------- Recherche rapide (Cmd+K)

let cmdItems = [], cmdIdx = 0;
function openCmdk() {
  $("cmdk").hidden = false;
  $("cmdk-q").value = "";
  cmdkRender();
  $("cmdk-q").focus();
  $("cmdk-q").oninput = cmdkRender;
  $("cmdk-q").onkeydown = e => {
    if (e.key === "ArrowDown") { e.preventDefault(); cmdIdx = Math.min(cmdIdx + 1, cmdItems.length - 1); cmdkPaint(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); cmdIdx = Math.max(cmdIdx - 1, 0); cmdkPaint(); }
    else if (e.key === "Enter" && cmdItems[cmdIdx]) { e.preventDefault(); cmdkGo(cmdItems[cmdIdx]); }
  };
}
function closeCmdk() { if ($("cmdk")) $("cmdk").hidden = true; }
function cmdkRender() {
  const q = fold($("cmdk-q").value.trim());
  const items = [{ group: "Navigation", label: "Portefeuille", go: "#/" }, { group: "Navigation", label: "Guide d'utilisation", go: "#/guide" }];
  IDX.projects.forEach(p => items.push({ group: "Projets", label: p.label, hint: p.property, go: `#/${p.name}` }));
  if (P) VIEWS.forEach(([v, l]) => items.push({ group: P.label, label: l, go: `#/${P.name}/${v}` }));
  // Mots-clés de tous les projets, le projet ouvert en premier
  IDX.projects.slice().sort((a, b) => (P && b.name === P.name) - (P && a.name === P.name)).forEach(p => (p.kw || []).forEach(([i, kw]) =>
    items.push({ group: "Mots-clés · " + p.label, label: kw, kw: i, site: p.name, hint: P && P.name === p.name ? path((P.keywords.find(k => k.i === i) || {}).page) : "" })));
  cmdItems = (q ? items.filter(it => fold(it.label + " " + (it.hint || "")).includes(q)) : items).slice(0, 40);
  cmdIdx = 0;
  cmdkPaint();
}
function cmdkPaint() {
  let g = null;
  $("cmdk-list").innerHTML = cmdItems.map((it, n) => {
    const head = it.group !== g ? `<div class="cmdk-g">${esc(it.group)}</div>` : "";
    g = it.group;
    return head + `<div class="cmdk-it ${n === cmdIdx ? "on" : ""}" data-n="${n}"><span>${esc(it.label)}</span>${it.hint ? `<span class="light">${esc(it.hint)}</span>` : ""}</div>`;
  }).join("") || '<div class="cmdk-g">Aucun résultat</div>';
  $("cmdk-list").querySelectorAll("[data-n]").forEach(el => { el.onclick = () => cmdkGo(cmdItems[+el.dataset.n]); });
  const on = $("cmdk-list").querySelector(".on"); if (on) on.scrollIntoView({ block: "nearest" });
}
function cmdkGo(it) {
  closeCmdk();
  if (it.kw != null) {
    const target = `#/${it.site}/mots-cles`;
    if (location.hash === target) openDrawer(it.kw);
    else { ui.pendingKw = it.kw; location.hash = target; }
  } else location.hash = it.go;
}

// ---------------------------------------------------------------- Guide d'utilisation

function renderGuide() {
  const first = IDX.projects[0] ? IDX.projects[0].name : "";
  $("view").innerHTML = `<div class="guide">
    ${viewBar("<h1>Guide d'utilisation</h1>")}
    <div class="card"><h2>Les onglets</h2><div class="qa">
      <a href="#/${first}/mots-cles"><b>Mots-clés</b><span>L'onglet d'arrivée : vue d'ensemble (hausses, baisses, entrées et sorties du top, évolution globale, tags), puis la position du jour de chaque mot-clé. Par page : indexation et requêtes de chaque page suivie.</span></a>
      <a href="#/${first}/trafic"><b>Trafic du site</b><span>Clics hors marque, marque, total et impressions, comparés à la période choisie.</span></a>
      <a href="#/${first}/actions"><b>Actions</b><span>Journal des optimisations et leur effet mesuré.</span></a>
      <a href="#/${first}/opportunites"><b>Opportunités</b><span>Mots-clés suivis à pousser et requêtes à ajouter au suivi.</span></a>
      <a href="#/${first}/rapport"><b>Rapport</b><span>Rapport mensuel figé sur son mois, modifiable, imprimable en PDF.</span></a>
      <a href="#/${first}/a-traiter"><b>À traiter</b><span>Alertes et mouvements sur 7 jours, au dernier jour définitif.</span></a>
    </div></div>
    <div class="card"><h2>La position</h2><ul>
      <li><b>Une seule définition</b> : la position Google de la page suivie <b>un jour donné</b>, le jour de référence. Par défaut c'est le dernier jour disponible dans la Search Console. Décocher « Jours provisoires » prend le dernier jour consolidé (la Search Console garde 2 à 3 jours provisoires).</li>
      <li>Sans impression ce jour-là, la dernière position connue dans les 7 jours précédents est reprise et affichée en gris.</li>
      <li><b>7 j</b> et <b>28 j</b> comparent la position du jour à celle de 7 et 28 jours plus tôt. La colonne de comparaison compare au dernier jour de la période de comparaison choisie en haut.</li>
      <li>Les <b>mouvements de la semaine</b> et les <b>alertes</b> utilisent exactement la variation 7 j, au dernier jour définitif, avec au moins ${MIN_IMPR_DAY} impressions chacun des deux jours.</li>
      <li>Les tableaux « Qui se positionne », les variantes, les suggestions et la mesure des actions donnent des <b>positions moyennes</b> sur une durée : elles sont libellées « Position moy. ».</li>
    </ul></div>
    <div class="card"><h2>La barre du haut</h2><ul>
      <li><b>Pays</b> : chaque projet peut déclarer ses pays (et un dossier d'URL par pays). Tout l'outil se recalcule pour le pays choisi : positions, alertes, trafic, suggestions, rapport. « Tous pays » reste disponible.</li>
      <li><b>Période</b> : boutons 7 j, 28 j, 90 j, 12 mois, Tout ou Dates (dates au choix). Elle fixe le jour de référence (sa fin), les cumuls (clics, meilleure position, graphiques) et les mouvements de la vue d'ensemble (hausses, baisses, entrées et sorties : position la veille du premier jour contre position du dernier jour).</li>
      <li><b>Comparaison</b> : année précédente (par défaut, mêmes jours de la semaine), période précédente, dates au choix, ou aucune.</li>
      <li><b>⌘K</b> (Ctrl+K sur Windows) : aller directement à un projet, un onglet ou un mot-clé.</li>
    </ul></div>
    <div class="card"><h2>Le tableau des mots-clés</h2><ul>
      <li>Le filtre accepte du texte ou une <b>regex</b> sur le mot-clé, ses variantes et l'URL (ex. <code>^jean|jeans</code>, <code>/c/costumes</code>). Les indicateurs du haut se recalculent sur les mots-clés filtrés.</li>
      <li><b>Statut</b> et <b>tags</b> se filtrent en un clic. <b>Colonnes</b> choisit ce qui s'affiche. <b>Enregistrer la vue</b> garde filtres, colonnes et tri sous un nom (dans ton navigateur).</li>
      <li><b>URL du jour</b> : signale quand une autre page du site a capté le mot-clé ce jour-là.</li>
      <li><b>Impr. / mois</b> : la demande vue par la Search Console sur 28 jours, faute de volume de recherche (l'outil n'utilise que la GSC).</li>
      <li>Le graphique est replié : « Répartition » montre combien de mots-clés sont dans chaque tranche de position jour après jour, « Mots-clés cochés » trace les courbes des lignes cochées.</li>
    </ul></div>
    <div class="card"><h2>Saisir</h2><ol>
      <li><b>Suivre des mots-clés</b> : un mot-clé par ligne, suivi si besoin de « | URL » pour fixer la page (ex. <code>jean homme | https://www.celio.com/fr-fr/c/jeans</code>). Statut, objectif et tags s'appliquent à toute la liste. Depuis Opportunités, cocher des requêtes puis « Suivre la sélection » pré-remplit la liste.</li>
      <li><b>Ajouter une action</b> dès qu'une optimisation est en ligne : son effet est mesuré à 7 puis 28 jours.</li>
      <li><b>Nouveau projet</b> : propriété GSC, regex de marque et pays suivis. Les 20 requêtes hors marque qui font le plus de clics sont ajoutées.</li>
      <li>Les formulaires passent par GitHub (compte collaborateur du repo). Compter 2 à 3 minutes avant de voir le résultat.</li>
    </ol></div>
    <div class="card"><h2>Le rapport</h2><ul>
      <li>Il est <b>figé sur son mois</b> : positions au dernier jour du mois, comparées à la fin du mois précédent et à N-1, alertes survenues pendant le mois.</li>
      <li>La synthèse et les prochaines étapes se modifient directement dans la page (gardées dans ton navigateur). « Blocs » choisit les sections imprimées.</li>
    </ul></div>
    <div class="card"><h2>Lexique</h2><dl>
      <dt>Position</dt><dd>${DEF.position}</dd>
      <dt>Position moyenne</dt><dd>${DEF.posMoy}</dd>
      <dt>Meilleure</dt><dd>${DEF.best}</dd>
      <dt>Visibilité</dt><dd>${DEF.visibilite}</dd>
      <dt>Clics à gagner</dt><dd>${DEF.aGagner}</dd>
      <dt>Statut et objectif</dt><dd>À travailler, en cours ou acquis, et position visée, saisis dans le suivi. ${DEF.objectif}</dd>
      <dt>Hors marque / marque</dt><dd>${DEF.horsMarque} ${DEF.marque}</dd>
      <dt>Requêtes masquées</dt><dd>${DEF.anonymes}</dd>
      <dt>Urgent / À surveiller</dt><dd>Urgent : sortie du top 10, page qui ne reçoit plus d'impressions, page non indexée, synchro en échec. À surveiller : recul, sortie du top 3, baisse d'impressions, autre page du site en tête, canonique non respectée.</dd>
      <dt>Effet d'une action</dt><dd>${DEF.impact}</dd>
      <dt>Données provisoires</dt><dd>${DEF.provisoire}</dd>
      <dt>Repères G et A</dt><dd>G = mise à jour de classement Google, A = action SEO consignée.</dd>
    </dl></div>
    <div class="card"><h2>Limites</h2><ul>
      <li>La Search Console donne une position par jour, moyennée sur toutes les recherches de la journée : sur un mot-clé peu recherché, elle varie beaucoup d'un jour à l'autre.</li>
      <li>Un mot-clé sans impression n'a pas de position : l'outil ne voit pas au-delà de ce que la Search Console a affiché.</li>
    </ul><p style="margin-top:10px">Documentation technique : <a href="${GH}#readme" target="_blank" rel="noopener">README du repo</a>.</p></div>
  </div>`;
}

load();
