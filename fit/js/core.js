// /fit — shared data model, metric config, zones and formatting.
//
// Modules (no build step; loaded as ES modules from index.html):
//   core.js        data model (build), METRICS config, zones, formatting, DOM helpers
//   today.js       Today tab: readiness, last 7 days, patterns, personal bests
//   metrics.js     Metrics tab: chart, stats, day-of-week, metric list
//   activities.js  Activities tab: calendar, totals, history, by type
//   app.js         loading, tabs, ranges, URL-hash routing
//
// To add a metric: have scripts/garmin.py store it under days[date][key], then add an
// entry to METRICS. Charts, zones, stats and the metric list pick it up automatically.

export const NS = "http://www.w3.org/2000/svg";
export const DAY = 86400000;
export const COLOR = { good: "#00c805", mid: "#c7c7cc", bad: "#ff5000" };
export const STATUS = ["bad", "mid", "good"];
export const REST = /meditation|breathwork/;   // logged as activities, but not training

export const RANGES = [
  { id: "1W", days: 7, label: "Past week", w: 1 },
  { id: "1M", days: 30, label: "Past month", w: 1 },
  { id: "3M", days: 91, label: "Past 3 months", w: 7 },
  { id: "YTD", days: null, label: "Year to date", w: 7 },
  { id: "1Y", days: 365, label: "Past year", w: 14 },
  { id: "5Y", days: 1826, label: "Past 5 years", w: 30 },
  { id: "ALL", days: Infinity, label: "All time", w: 30 },
];

// Loaded data. Index i on the day axis ↔ date T0 + i days.
export const D = { T0: 0, N: 0, units: "metric", updated: null, series: {}, activities: [], trainMin: null, hard: null };
export const state = { tab: "today", metric: "rhr", range: "1Y" };
export const hooks = { select: () => {} };    // set by app.js: select({ tab, metric, range })

// ---------------------------------------------------------------- formatting
export const imperial = () => D.units === "statute_us" || D.units === "statute_uk";
const NF = {};
export const fmtN = (v, d = 0) =>
  (NF[d] ||= new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })).format(v);
export const hm = (h) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
export const hmShort = (h) => { const m = Math.round(Math.abs(h) * 60); return m < 60 ? `${m}m` : hm(Math.abs(h)); };
export const dist = (m) => imperial() ? m / 1609.344 : m / 1000;
export const distUnit = () => imperial() ? "mi" : "km";
const wUnit = () => imperial() ? "lb" : "kg";
// "+3 bpm" / "−3 bpm" / "0 bpm": no sign when the shown number rounds to zero
export const signed = (txt, delta) =>
  (parseFloat(String(txt).replace(/[^0-9.]/g, "")) ? (delta > 0 ? "+" : "−") : "") + txt;

// ---------------------------------------------------------------- metrics
// unit: after the big number · du: after deltas, stats, thresholds
// better: which direction is good · zone: [lo, hi] fixed thresholds, or "personal"
//   (your middle 60% over the last 90 days) · labels: [bad, normal, good]
// night: measured overnight (final once you wake) · weekly: plotted as a 7-day total
export const METRICS = [
  { key: "rhr", name: "Resting heart rate", short: "Resting HR", unit: "bpm", du: "bpm", better: "down", dec: 0,
    zone: "personal", labels: ["Elevated", "Normal", "Low"] },
  { key: "hrv", name: "Heart rate variability", short: "HRV", unit: "ms", du: "ms", better: "up", dec: 0, night: true,
    zone: "personal", labels: ["Low", "Normal", "High"] },
  { key: "sleep", name: "Sleep", better: "up", dec: 1, night: true, fmt: hm,
    zone: [6, 7], labels: ["Short", "OK", "Good"] },
  { key: "sleepScore", name: "Sleep score", better: "up", dec: 0, night: true,
    zone: [60, 80], labels: ["Poor", "Fair", "Good"] },
  { key: "steps", name: "Steps", unit: "per day", better: "up", dec: 0,
    zone: [5000, 10000], labels: ["Low", "Moderate", "Active"] },
  { key: "workout", name: "Workouts", unit: "per week", better: "up", dec: 1, weekly: true, fmt: hm, total: hmShort,
    acts: (a) => REST.test(a.t) ? 0 : (a.s || 0) / 3600,
    zone: "personal", labels: ["Light week", "Usual", "Big week"],
    longest: { label: "Longest workout", fmt: (a) => hm(a.s / 3600), sub: (a) => `${typeName(a.t)} · ${fmtDate(toT(a.d))}` } },
  { key: "run", name: "Running", unit: () => `${distUnit()} / week`, du: () => `${distUnit()}/wk`, better: "up", dec: 1, weekly: true, minActs: 10,
    total: (v) => `${fmtN(v, 1)} ${distUnit()}`, acts: (a) => /run/.test(a.t) ? dist(a.m || 0) : 0,
    zone: "personal", labels: ["Light week", "Usual", "Big week"],
    longest: { label: "Longest run", fmt: (a) => `${fmtN(dist(a.m), 1)} ${distUnit()}`, sub: (a) => fmtDate(toT(a.d)) } },
  { key: "im", name: "Intensity minutes", short: "Intensity min", unit: "min / week", du: "min/wk", better: "up", dec: 0, weekly: true,
    total: (v) => `${fmtN(v, 0)} min`, zone: [75, 150], labels: ["Low", "OK", "Goal met"] },
  { key: "bb", name: "Body Battery", unit: "peak", better: "up", dec: 0,
    zone: [51, 76], labels: ["Low", "Medium", "High"] },
  { key: "stress", name: "Stress", unit: "avg", better: "down", dec: 0,
    zone: [25, 50], labels: ["High", "Normal", "Restful"] },
  { key: "kcal", name: "Active calories", short: "Active cal", unit: "kcal", du: "kcal", better: "up", dec: 0,
    zone: "personal", labels: ["Below usual", "Usual", "Above usual"] },
  { key: "vo2", name: "VO₂ max", better: "up", dec: 1, ffill: true, night: true, hidden: true,
    zone: "personal", labels: ["Below usual", "Usual", "Above usual"] },
  { key: "weight", name: "Weight", unit: wUnit, du: wUnit, better: null, dec: 1, zone: null,
    conv: (kg) => imperial() ? kg * 2.20462 : kg },
];
export const metric = (key) => METRICS.find((m) => m.key === key);
export const resolve = (u) => (typeof u === "function" ? u() : u) || "";
export const unitOf = (m) => resolve(m.unit);
export const fmtV = (m, v) => m.fmt ? m.fmt(v) : fmtN(v, m.dec);
export const fmtU = (m, v) => fmtV(m, v) + (resolve(m.du) ? " " + resolve(m.du) : "");
export const fmtT = (m, v) => m.fmt ? (Number.isInteger(v) ? `${v}h` : m.fmt(v)) : fmtU(m, v);
export const fmtDelta = (m, delta) => signed(m.fmt ? hmShort(delta) : fmtU(m, Math.abs(delta)), delta);
export const visible = (m) => !m.hidden && lastIdx(D.series[m.key]) >= 0 && (!m.minActs || m.count >= m.minActs);

// 0 bad · 1 normal · 2 good · null (no zones or no value)
export function status(m, v) {
  const z = m.z;
  if (!z || v == null || isNaN(v)) return null;
  if (m.better === "down") return v <= z.lo ? 2 : v > z.hi ? 0 : 1;
  return v >= z.hi ? 2 : v < z.lo ? 0 : 1;
}
export const colorOf = (s) => COLOR[s == null ? "mid" : STATUS[s]];
export const labelOf = (m, s) => (s == null ? "" : m.labels[s]);
// +1 when a change is an improvement, −1 when worse, 0 when flat / no direction
export const direction = (m, delta) => !m.better || !delta ? 0 : (m.better === "up") === delta > 0 ? 1 : -1;

// ---------------------------------------------------------------- dates
export const toT = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
export const toS = (t) => new Date(t).toISOString().slice(0, 10);
export const idx = (k) => Math.round((toT(k) - D.T0) / DAY);
export const tOf = (i) => D.T0 + i * DAY;
export const weekday = (i) => new Date(tOf(i)).getUTCDay();
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const fmtDate = (t, withYear = true) => new Date(t).toLocaleDateString("en-US",
  { month: "short", day: "numeric", year: withYear ? "numeric" : undefined, timeZone: "UTC" });
export const fmtDay = (i) => new Date(tOf(i)).toLocaleDateString("en-US",
  { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
export const clock = (tm) => {
  if (!tm) return "";
  const [h, mi] = tm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(mi).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  return `${Math.round(s / 86400)} days ago`;
}

// ---------------------------------------------------------------- arrays
export function lastIdx(a) { if (!a) return -1; for (let i = a.length - 1; i >= 0; i--) if (!isNaN(a[i])) return i; return -1; }
export function firstIdx(a) { if (!a) return -1; for (let i = 0; i < a.length; i++) if (!isNaN(a[i])) return i; return -1; }
export const latestIdx = (m) => m.ffill ? m.lastReal : lastIdx(D.series[m.key]);
export const mean = (xs) => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;
export function windowMean(a, from, to) {
  const xs = [];
  for (let i = Math.max(0, from); i <= to; i++) if (!isNaN(a[i])) xs.push(a[i]);
  return { avg: mean(xs), n: xs.length };
}

// ---------------------------------------------------------------- build
export function build(data) {
  D.units = data.units || "metric";
  D.updated = data.updated || null;
  const keys = Object.keys(data.days || {}).sort();
  D.activities = (data.activities || []).slice().sort((a, b) => (b.d + (b.tm || "")).localeCompare(a.d + (a.tm || "")));
  if (!keys.length) return false;
  D.T0 = toT(keys[0]);
  D.N = Math.round((toT(keys[keys.length - 1]) - D.T0) / DAY) + 1;
  const N = D.N;

  // The first day (watch setup) and the newest day (still in progress) are partial.
  // Keep only overnight metrics from them (final once you wake) plus finished activities.
  const updatedDay = D.updated ? localDay(new Date(D.updated)) : null;
  const partial = updatedDay && keys[keys.length - 1] >= updatedDay;

  for (const m of METRICS) {
    const a = new Float64Array(N).fill(NaN);
    if (m.acts) {
      for (const k of keys) a[idx(k)] = 0;
      m.count = 0;
      for (const x of D.activities) {
        const v = m.acts(x), i = idx(x.d);
        if (!v || i < 0 || i >= N) continue;
        a[i] += v; m.count++;
      }
    } else {
      for (const k of keys) { const v = data.days[k][m.key]; if (v != null) a[idx(k)] = v; }
    }
    if (m.conv) for (let i = 0; i < N; i++) if (!isNaN(a[i])) a[i] = m.conv(a[i]);
    const dropToday = partial && !m.night && !m.acts;
    if (dropToday) a[N - 1] = NaN;
    if (!m.night && !m.acts && N > 1) a[0] = NaN;
    m.lastReal = lastIdx(a);
    m.raw = Float64Array.from(a);
    if (m.ffill) { let last = NaN; for (let i = 0; i < N; i++) { if (!isNaN(a[i])) last = a[i]; else a[i] = last; } }
    if (m.weekly) {
      // trailing 7-day total; days without a watch count as 0
      const out = new Float64Array(N).fill(NaN);
      let sum = 0, seen = 0;
      for (let i = 0; i < N; i++) {
        sum += isNaN(a[i]) ? 0 : a[i]; seen += isNaN(a[i]) ? 0 : 1;
        if (i >= 7) { sum -= isNaN(a[i - 7]) ? 0 : a[i - 7]; seen -= isNaN(a[i - 7]) ? 0 : 1; }
        if (i >= 6 && seen > 0) out[i] = sum;
      }
      if (dropToday) out[N - 1] = NaN;
      m.daily = a;
      D.series[m.key] = out;
      m.raw = out;
    } else {
      D.series[m.key] = a;
    }
    const recent = recentValues(m.raw);
    m.usual = recent.length ? recent[Math.floor(recent.length / 2)] : NaN;
    m.z = zoneFor(m, recent);
  }

  // training minutes and hard sessions per day (for patterns)
  D.trainMin = new Float64Array(N);
  D.hard = new Uint8Array(N);
  for (const a of D.activities) {
    const i = idx(a.d);
    if (i < 0 || i >= N || REST.test(a.t)) continue;
    D.trainMin[i] += (a.s || 0) / 60;
    if ((a.te || 0) >= 3 || (a.load || 0) >= 60) D.hard[i] = 1;
  }
  return true;
}

// sorted values from the last 90 days (all history if that's too thin)
function recentValues(a) {
  const end = lastIdx(a);
  if (end < 0) return [];
  let vals = [];
  for (let i = Math.max(0, end - 89); i <= end; i++) if (!isNaN(a[i])) vals.push(a[i]);
  if (vals.length < 10) { vals = []; for (let i = 0; i <= end; i++) if (!isNaN(a[i])) vals.push(a[i]); }
  return vals.sort((x, y) => x - y);
}

// Zones: fixed thresholds, or your own middle 60% of the last 90 days.
function zoneFor(m, vals) {
  if (Array.isArray(m.zone)) return { lo: m.zone[0], hi: m.zone[1], personal: false };
  if (m.zone !== "personal" || vals.length < 3) return null;
  const q = (p) => { const k = (vals.length - 1) * p, f = Math.floor(k), c = Math.ceil(k); return vals[f] + (vals[c] - vals[f]) * (k - f); };
  const round = (x) => Number(x.toFixed(m.dec));
  const lo = round(q(0.2));
  return { lo, hi: Math.max(round(q(0.8)), lo + Math.pow(10, -m.dec)), personal: true };
}

// ---------------------------------------------------------------- ranges + smoothing
// trailing mean over w calendar days, skipping days without data;
// waits for half a window of history before plotting
export function smooth(a, w, from, to) {
  const out = [];
  const warm = firstIdx(a) + Math.ceil(w / 2) - 1;
  const s = Math.max(0, from - w + 1);
  let sum = 0, cnt = 0;
  for (let i = s; i <= to; i++) {
    if (!isNaN(a[i])) { sum += a[i]; cnt++; }
    const j = i - w;
    if (j >= s && !isNaN(a[j])) { sum -= a[j]; cnt--; }
    if (i >= from && i >= warm && cnt > 0 && (w > 1 || !isNaN(a[i]))) out.push([i, sum / cnt]);
  }
  return out;
}

function startOf(r, end) {
  if (r.days === Infinity) return 0;
  if (r.days === null) return idx(`${toS(tOf(end)).slice(0, 4)}-01-01`);
  return end - r.days + 1;
}
// the range on one metric's own data
export function rangeBounds(a, r) {
  const end = lastIdx(a);
  if (end < 0) return null;
  return { start: Math.max(startOf(r, end), firstIdx(a), 0), end };
}
// the range on the whole day axis (activities)
export function globalRange(r) {
  const end = D.N - 1;
  return { start: Math.max(0, startOf(r, end)), end };
}
export const currentRange = () => RANGES.find((r) => r.id === state.range) || RANGES[4];

export function computeView(m, r) {
  const b = rangeBounds(D.series[m.key], r);
  if (!b) return null;
  const w = m.ffill ? 1 : r.w;
  return { m, r, w, pts: smooth(D.series[m.key], w, b.start, b.end), start: b.start, end: b.end };
}

// ---------------------------------------------------------------- activity helpers
const TYPE = {
  running: "Run", trail_running: "Trail run", treadmill_running: "Treadmill run", track_running: "Track run",
  virtual_run: "Virtual run", indoor_running: "Indoor run", cycling: "Ride", road_biking: "Road ride",
  mountain_biking: "Mountain bike", indoor_cycling: "Indoor ride", virtual_ride: "Virtual ride", gravel_cycling: "Gravel ride",
  walking: "Walk", hiking: "Hike", lap_swimming: "Pool swim", open_water_swimming: "Open water swim",
  strength_training: "Strength", yoga: "Yoga", hiit: "HIIT", indoor_rowing: "Row", rowing: "Row",
  elliptical: "Elliptical", stair_climbing: "Stairs", pilates: "Pilates", cardio: "Cardio", indoor_cardio: "Indoor cardio",
  tennis: "Tennis", pickleball: "Pickleball", basketball: "Basketball", soccer: "Soccer", meditation: "Meditation",
  breathwork: "Breathwork", bouldering: "Bouldering", indoor_climbing: "Climbing", resort_skiing: "Skiing",
  resort_skiing_snowboarding_ws: "Ski / snowboard", other: "Other",
};
export const typeName = (t) => TYPE[t] || t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

// ---------------------------------------------------------------- DOM
export const $ = (id) => document.getElementById(id);
export const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
export function stat(k, v, s, color) {
  const e = el("div", "stat");
  e.append(el("div", "k", k));
  const val = el("div", "v num", v);
  if (color) val.style.color = color;
  e.append(val);
  if (s) e.append(el("div", "s", s));
  return e;
}
export function statusChip(m, s) {
  const wrap = el("span", "st");
  if (s == null) return wrap;
  const dot = el("i"); dot.style.background = colorOf(s);
  const lab = el("span", null, labelOf(m, s)); lab.style.color = colorOf(s);
  wrap.append(dot, lab);
  return wrap;
}
