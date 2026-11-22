// Entry point: load data, wire tabs and ranges, keep the URL hash in sync.
//   #today · #<metric>/<range> (e.g. #rhr/1Y) · #activities/<range>
import { D, state, hooks, RANGES, METRICS, metric, visible, build, ago, $, el } from "./core.js";
import { initMetrics, renderMetrics } from "./metrics.js";
import { initActivities, renderActivities } from "./activities.js";
import { renderToday } from "./today.js";

const TABS = ["today", "metrics", "activities"];

function renderRanges() {
  for (const nav of document.querySelectorAll("[data-ranges]")) {
    nav.replaceChildren();
    for (const r of RANGES) {
      // hide ranges far longer than the history (keeps 5Y away until it means something)
      if (r.days !== Infinity && r.days !== null && r.days > D.N * 1.5 && r.id !== state.range) continue;
      const b = el("button", null, r.id);
      b.setAttribute("aria-pressed", String(r.id === state.range));
      b.setAttribute("aria-label", r.label);
      b.addEventListener("click", () => select({ range: r.id }));
      nav.append(b);
    }
  }
}

function showTab() {
  for (const t of TABS) {
    $(`view-${t}`).hidden = t !== state.tab;
    const b = $(`tab-${t}`);
    b.setAttribute("aria-selected", String(t === state.tab));
    b.tabIndex = t === state.tab ? 0 : -1;
  }
}

function render(animate) {
  renderRanges();
  if (state.tab === "today") renderToday();
  else if (state.tab === "metrics") renderMetrics(animate);
  else renderActivities();
}

function writeHash() {
  const h = state.tab === "today" ? "#today"
    : state.tab === "activities" ? `#activities/${state.range}`
    : `#${state.metric}/${state.range}`;
  if (location.hash !== h) history.replaceState(null, "", h);
}

function readHash() {
  const [a, b] = decodeURIComponent(location.hash.slice(1)).split("/");
  if (RANGES.some((r) => r.id === b)) state.range = b;
  if (a === "activities") state.tab = "activities";
  else if (METRICS.some((m) => m.key === a && visible(m))) { state.tab = "metrics"; state.metric = a; }
  else state.tab = "today";
}

function select(patch) {
  const before = state.tab;
  Object.assign(state, patch);
  if (patch.metric && !patch.tab) state.tab = "metrics";
  const tabChanged = state.tab !== before;
  writeHash();
  if (tabChanged) { showTab(); scrollTo({ top: 0 }); }
  render(!tabChanged);
}
hooks.select = select;

function wireTabs() {
  for (const t of TABS) $(`tab-${t}`).addEventListener("click", () => select({ tab: t }));
  $("tabs").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const k = TABS.indexOf(state.tab) + (e.key === "ArrowRight" ? 1 : -1);
    const next = TABS[(k + TABS.length) % TABS.length];
    select({ tab: next });
    $(`tab-${next}`).focus();
  });
}

function showUpdated() {
  if (!D.updated) return;
  const u = $("updated");
  u.textContent = `Updated ${ago(D.updated)}`;
  u.title = new Date(D.updated).toLocaleString();
  if (Date.now() - new Date(D.updated).getTime() > 36 * 3600 * 1000) {
    u.classList.add("stale");
    u.textContent = `Sync paused · last updated ${ago(D.updated)}`;
  }
}

async function init() {
  wireTabs();
  initMetrics();
  initActivities();
  let data;
  try {
    const res = await fetch("/fit/data.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    $("verdict").textContent = "No data yet";
    $("verdictText").textContent = "The Garmin sync hasn’t run yet, or the data couldn’t be loaded.";
    return;
  }
  if (!build(data)) { $("verdict").textContent = "No data yet"; return; }
  showUpdated();
  if (!visible(metric(state.metric))) state.metric = (METRICS.find(visible) || METRICS[0]).key;
  readHash();
  showTab();
  render(false);
  addEventListener("hashchange", () => { readHash(); showTab(); render(false); });
}

init();
