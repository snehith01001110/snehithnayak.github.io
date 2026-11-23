// Activities tab: headline, training calendar, totals, history, breakdown by type.
import {
  D, REST, state, imperial, fmtN, hmShort, dist, distUnit, fmtDate, fmtDay, clock, idx, tOf, toT,
  typeName, globalRange, currentRange, $, el, stat, oneColumn, scrollBehavior,
} from "./core.js";

const ZONE_COLORS = ["#8e8e93", "#0a84ff", "#30d158", "#ff9f0a", "#ff453a"];   // Garmin Z1–Z5
let filter = null;      // { type } or { day }
let limit = 10;

export function renderActivities() {
  const r = currentRange(), rg = globalRange(r);
  const list = D.activities.filter((a) => { const i = idx(a.d); return i >= rg.start && i <= rg.end; });
  const training = list.filter((a) => !REST.test(a.t));
  const secs = training.reduce((s, a) => s + (a.s || 0), 0);
  const weeks = Math.max(1, (rg.end - rg.start + 1) / 7);

  // headline: training time in range
  const v = $("actValue");
  v.textContent = hmShort(secs / 3600);
  v.append(el("span", "unit", "training"));
  $("actSub").textContent = `${training.length} ${training.length === 1 ? "session" : "sessions"} · ${hmShort(secs / 3600 / weeks)} per week · ${r.label.toLowerCase()}`;

  // totals
  const activeDays = new Set(training.map((a) => a.d)).size;
  const meters = list.reduce((s, a) => s + (a.m || 0), 0);
  const kcal = list.reduce((s, a) => s + (a.kcal || 0), 0);
  const longest = training.reduce((b, a) => (!b || (a.s || 0) > (b.s || 0) ? a : b), null);
  const tiles = $("actTiles"); tiles.replaceChildren();
  tiles.append(
    stat("Active days", fmtN(activeDays, 0), `of ${fmtN(rg.end - rg.start + 1, 0)}`),
    stat("Distance", `${fmtN(dist(meters), 1)} ${distUnit()}`, "walks, runs, rides"),
    stat("Calories", `${fmtN(kcal, 0)} kcal`, "during activities"),
    stat("Longest session", longest ? hmShort(longest.s / 3600) : "—", longest ? `${typeName(longest.t)} · ${fmtDate(toT(longest.d), false)}` : ""),
  );

  renderCalendar(rg);
  renderTypes(list);
  renderHistory(list);
}

export function initActivities() {
  const cal = $("cal"), tip = $("tip");
  cal.addEventListener("pointerover", (e) => {
    const c = e.target.closest("[data-i]");
    if (!c) return;
    const i = +c.dataset.i;
    const acts = D.activities.filter((a) => idx(a.d) === i);
    tip.replaceChildren(el("b", null, fmtDay(i)));
    if (!acts.length) tip.append(document.createTextNode(" · Rest day"));
    else {
      const t = acts.filter((a) => !REST.test(a.t)).reduce((s, a) => s + (a.s || 0), 0);
      tip.append(document.createTextNode(` · ${hmShort(t / 3600)} · ${acts.map((a) => typeName(a.t)).join(", ")}`));
    }
    tip.hidden = false;
    // centre over the day, but keep the whole tip on screen (phones are narrow)
    const rect = c.getBoundingClientRect(), half = tip.offsetWidth / 2 + 8;
    tip.style.left = Math.max(half, Math.min(innerWidth - half, rect.left + rect.width / 2)) + "px";
    tip.style.top = rect.top + "px";
  });
  cal.addEventListener("pointerleave", () => { tip.hidden = true; });
  cal.addEventListener("click", (e) => {
    const c = e.target.closest("[data-i]");
    if (!c) return;
    const i = +c.dataset.i;
    filter = filter && filter.day === i ? null : { day: i };
    limit = 10;
    renderActivities();
    $("actList").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  addEventListener("scroll", () => { tip.hidden = true; }, { passive: true });
  $("more").addEventListener("click", () => { limit += 20; renderActivities(); });
  new ResizeObserver(() => { if (state.tab === "activities" && D.N) renderCalendar(globalRange(currentRange())); }).observe($("calBox"));
}

// GitHub-style grid: one square per day, darker green = more training time.
function renderCalendar(rg) {
  const cal = $("cal"), months = $("calMonths"), sc = $("calScroll");
  cal.replaceChildren(); months.replaceChildren();
  const mins = D.trainMin;
  const startI = -new Date(D.T0).getUTCDay();            // the Sunday on or before day 0
  const weeks = Math.ceil((D.N - startI) / 7);
  // cells grow to fill the width; long histories scroll instead of shrinking
  const avail = $("calBox").clientWidth || 600;
  const cell = Math.max(10, Math.min(18, Math.floor((avail + 3) / weeks) - 3));
  sc.style.setProperty("--cell", `${cell}px`);

  const marks = [];
  for (let w = 0; w < weeks; w++) {
    const t = tOf(Math.max(0, startI + w * 7)), mo = new Date(t).getUTCMonth();
    if (!marks.length || marks[marks.length - 1].mo !== mo) marks.push({ w, mo, t });
  }
  marks.forEach((mk, k) => {
    if (k + 1 < marks.length && marks[k + 1].w - mk.w < 3) return;   // too close to the next label
    const lab = el("span", null, new Date(mk.t).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }));
    lab.style.gridColumn = `${mk.w + 1} / span 3`; lab.style.gridRow = 1;
    months.append(lab);
  });
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const i = startI + w * 7 + d;
      const c = el("div");
      c.style.gridColumn = w + 1; c.style.gridRow = d + 1;
      if (i < 0 || i >= D.N) { c.className = "void"; cal.append(c); continue; }
      const v = mins[i];
      c.className = v <= 0 ? "" : v < 20 ? "l1" : v < 45 ? "l2" : v < 75 ? "l3" : "l4";
      if (i < rg.start || i > rg.end) c.classList.add("out");
      if (filter && filter.day === i) c.classList.add("sel");
      c.dataset.i = i;
      cal.append(c);
    }
  }
  sc.scrollLeft = sc.scrollWidth;
}

function renderTypes(list) {
  const box = $("types"); box.replaceChildren();
  const groups = new Map();
  for (const a of list) {
    const g = groups.get(a.t) || { t: a.t, n: 0, s: 0, m: 0 };
    g.n++; g.s += a.s || 0; g.m += a.m || 0;
    groups.set(a.t, g);
  }
  const rows = [...groups.values()].sort((a, b) => b.s - a.s);
  const max = rows.length ? rows[0].s : 1;
  if (!rows.length) box.append(el("div", "empty-row", "No activities in this range."));
  for (const g of rows) {
    const b = el("button", "trow");
    b.setAttribute("aria-pressed", String(!!filter && filter.type === g.t));
    const left = el("div", "tn");
    left.append(el("b", null, typeName(g.t)), el("small", null, `${g.n} ${g.n === 1 ? "session" : "sessions"}`));
    const right = el("div", "tv num", hmShort(g.s / 3600));
    right.append(el("small", null, g.m > 50 ? `${fmtN(dist(g.m), 1)} ${distUnit()}` : "—"));
    const bar = el("div", "tbar"), fill = el("i");
    fill.style.width = `${Math.max(1, (g.s / max) * 100)}%`;
    bar.append(fill);
    b.append(left, right, bar);
    b.addEventListener("click", () => {
      filter = filter && filter.type === g.t ? null : { type: g.t };
      limit = 10;
      renderActivities();
      // on one column the history is below this card: bring the filtered list into view
      if (filter && oneColumn()) $("historySec").scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    });
    box.append(b);
  }
}

const dur = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}:${String(sec).padStart(2, "0")}`;
};
function pace(a) {
  if (!a.m || a.m < 50 || !a.s) return null;
  if (/run|walk|hik/.test(a.t)) {
    const sec = a.s / dist(a.m);
    return ["Pace", `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")} /${distUnit()}`];
  }
  if (/cycl|bik|ride/.test(a.t)) return ["Speed", `${fmtN(dist(a.m) / (a.s / 3600), 1)} ${imperial() ? "mph" : "km/h"}`];
  return null;
}
const titleCase = (s) => s.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

function renderHistory(list) {
  const chip = $("filterChip"); chip.replaceChildren();
  let shown = list;
  if (filter) {
    const label = filter.type ? typeName(filter.type) : fmtDay(filter.day);
    shown = filter.type ? list.filter((a) => a.t === filter.type) : D.activities.filter((a) => idx(a.d) === filter.day);
    const b = el("button", "chip", `${label}  ✕`);
    b.setAttribute("aria-label", `Clear filter: ${label}`);
    b.addEventListener("click", () => { filter = null; renderActivities(); });
    chip.append(b);
  }
  const box = $("actList"); box.replaceChildren();
  if (!shown.length) box.append(el("div", "empty-row", filter && filter.day != null ? "Rest day: no activities." : "No activities in this range."));
  const thisYear = new Date().getFullYear();
  for (const a of shown.slice(0, limit)) {
    const det = el("details", "act");
    const sum = el("summary");
    const when = toT(a.d);
    const left = el("div");
    left.append(el("div", "a", typeName(a.t)),
      el("div", "b", [fmtDate(when, new Date(when).getUTCFullYear() !== thisYear), clock(a.tm)].filter(Boolean).join(" · ")));
    const right = el("div", "r num");
    const big = el("div", "a"), small = el("div", "b");
    if (a.m && a.m > 50) { big.textContent = `${fmtN(dist(a.m), 2)} ${distUnit()}`; small.textContent = a.s ? dur(a.s) : ""; }
    else { big.textContent = a.s ? dur(a.s) : ""; small.textContent = a.kcal ? `${fmtN(a.kcal, 0)} kcal` : ""; }
    big.append(el("span", "chev", "›"));
    right.append(big, small);
    sum.append(left, right);
    det.append(sum);
    det.addEventListener("toggle", () => {
      if (det.open && !det.dataset.built) { det.append(detail(a)); det.dataset.built = "1"; }
    });
    box.append(det);
  }
  const more = $("more");
  more.hidden = shown.length <= limit;
  more.textContent = `Show more (${shown.length - limit})`;
}

function detail(a) {
  const body = el("div", "act-body"), facts = el("div", "facts");
  const add = (k, v) => {
    if (v == null || v === "") return;
    const f = el("div", "fact");
    f.append(el("div", "k", k), el("div", "v num", v));
    facts.append(f);
  };
  if (a.s) add("Duration", dur(a.s));
  if (a.m > 50) add("Distance", `${fmtN(dist(a.m), 2)} ${distUnit()}`);
  const p = pace(a); if (p) add(p[0], p[1]);
  if (a.hr) add("Avg heart rate", `${a.hr} bpm`);
  if (a.mx) add("Max heart rate", `${a.mx} bpm`);
  if (a.kcal) add("Calories", `${fmtN(a.kcal, 0)} kcal`);
  if (a.te != null) add("Training effect", `${a.te.toFixed(1)} aerobic · ${(a.ate || 0).toFixed(1)} anaerobic`);
  if (a.lbl) add("Main benefit", titleCase(a.lbl));
  if (a.load) add("Training load", fmtN(a.load, 0));
  if (a.el) add("Elevation gain", imperial() ? `${fmtN(a.el * 3.28084, 0)} ft` : `${fmtN(a.el, 0)} m`);
  if (a.st) add("Steps", fmtN(a.st, 0));
  if (a.sets) add("Sets", fmtN(a.sets, 0));
  if (a.bb != null) add("Body Battery", `${a.bb > 0 ? "+" : a.bb < 0 ? "−" : ""}${Math.abs(a.bb)}`);
  body.append(facts);

  if (a.z && a.z.some((x) => x > 0)) {
    const total = a.z.reduce((s, x) => s + x, 0);
    const zones = el("div", "zones");
    zones.append(el("div", "k", "Time in heart rate zones"));
    const bar = el("div", "zbar"), lab = el("div", "zlab");
    a.z.forEach((sec, k) => {
      if (sec > 0) { const seg = el("i"); seg.style.flex = String(sec / total); seg.style.background = ZONE_COLORS[k]; bar.append(seg); }
      const sp = el("span"), sw = el("i");
      sw.style.background = ZONE_COLORS[k];
      sp.append(sw, el("b", null, `Z${k + 1}`), document.createTextNode(hmShort(sec / 3600)));
      lab.append(sp);
    });
    zones.append(bar, lab);
    body.append(zones);
  }
  return body;
}
