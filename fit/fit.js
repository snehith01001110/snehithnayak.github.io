// snehithn.com/fit — renders fit/data.json (written by scripts/garmin.py).
//
// Layout of this file:
//   config      RANGES, METRICS (zones, labels, units per metric)
//   series      build(): data.json → one dense daily array per metric
//   zones       zoneFor()/status(): good / normal / bad for any value
//   chart       drawChart(), hover/scrub, headline, legend, stats
//   activities  tiles, calendar, by-type breakdown, expandable history
//   watchlist   metric list with sparklines
//
// To add a metric: have scripts/garmin.py store it under days[date][key],
// then add an entry to METRICS. Everything else picks it up.
(() => {
  "use strict";

  // ------------------------------------------------------------------ config
  const RANGES = [
    { id: "1W", days: 7, label: "Past week", w: 1 },
    { id: "1M", days: 30, label: "Past month", w: 1 },
    { id: "3M", days: 91, label: "Past 3 months", w: 7 },
    { id: "YTD", days: null, label: "Year to date", w: 7 },
    { id: "1Y", days: 365, label: "Past year", w: 14 },
    { id: "5Y", days: 1826, label: "Past 5 years", w: 30 },
    { id: "ALL", days: Infinity, label: "All time", w: 30 },
  ];
  const NS = "http://www.w3.org/2000/svg";
  const COLOR = { good: "#00c805", mid: "#c7c7cc", bad: "#ff5000" };
  const STATUS = ["bad", "mid", "good"];
  const REST = /meditation|breathwork/;

  let units = "metric";
  const imperial = () => units === "statute_us" || units === "statute_uk";
  const nf = (d) => new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtN = (v, d = 0) => nf(d).format(v);
  const hm = (h) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
  const hmShort = (h) => { const m = Math.round(h * 60); return m < 60 ? `${m}m` : hm(h); };
  const dist = (m) => imperial() ? m / 1609.344 : m / 1000;
  const distUnit = () => imperial() ? "mi" : "km";
  const wUnit = () => imperial() ? "lb" : "kg";

  // unit: after the big number · du: after deltas, stats, thresholds
  // better: which direction is good · zone: [lo, hi] fixed thresholds, or "personal"
  //   (your middle 60% over the last 90 days) · labels: [bad, normal, good]
  const METRICS = [
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
    { key: "vo2", name: "VO₂ max", better: "up", dec: 1, ffill: true, night: true,
      zone: "personal", labels: ["Below usual", "Usual", "Above usual"] },
    { key: "workout", name: "Workouts", unit: "per week", better: "up", dec: 1, weekly: true, fmt: hm, total: hm,
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
    { key: "weight", name: "Weight", unit: wUnit, du: wUnit, better: null, dec: 1, zone: null,
      conv: (kg) => imperial() ? kg * 2.20462 : kg },
  ];
  const resolve = (u) => (typeof u === "function" ? u() : u) || "";
  const unitOf = (m) => resolve(m.unit);
  const fmtV = (m, v) => m.fmt ? m.fmt(v) : fmtN(v, m.dec);
  const fmtU = (m, v) => fmtV(m, v) + (resolve(m.du) ? " " + resolve(m.du) : "");
  const fmtT = (m, v) => m.fmt ? (Number.isInteger(v) ? `${v}h` : m.fmt(v)) : fmtU(m, v);
  const has = (m) => lastIdx(series[m.key]) >= 0 && (!m.minActs || m.count >= m.minActs);
  const cur = () => METRICS.find((x) => x.key === state.metric);

  // 0 bad · 1 normal · 2 good · null (no zones / no value)
  function status(m, v) {
    const z = m.z;
    if (!z || v == null || isNaN(v)) return null;
    if (m.better === "down") return v <= z.lo ? 2 : v > z.hi ? 0 : 1;
    return v >= z.hi ? 2 : v < z.lo ? 0 : 1;
  }
  const colorOf = (s) => COLOR[s == null ? "mid" : STATUS[s]];
  const labelOf = (m, s) => s == null ? "" : m.labels[s];

  // ------------------------------------------------------------------ dates
  const DAY = 86400000;
  const toT = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const toS = (t) => new Date(t).toISOString().slice(0, 10);
  const fmtDate = (t, withYear = true) => new Date(t).toLocaleDateString("en-US",
    { month: "short", day: "numeric", year: withYear ? "numeric" : undefined, timeZone: "UTC" });
  const fmtDay = (i) => new Date(T0 + i * DAY).toLocaleDateString("en-US",
    { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  const clock = (tm) => {
    if (!tm) return "";
    const [h, mi] = tm.split(":").map(Number);
    return `${((h + 11) % 12) + 1}:${String(mi).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  };

  // ------------------------------------------------------------------ state
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  let T0 = 0, N = 0;               // dense day axis: index i ↔ T0 + i*DAY
  const series = {};               // key → Float64Array (NaN = no value)
  let activities = [];
  let state = { metric: "rhr", range: "1Y" };
  let view = null, shown = null, hoverIdx = null;
  let actFilter = null, actLimit = 10;

  // ------------------------------------------------------------------ build series
  function build(data) {
    units = data.units || "metric";
    const keys = Object.keys(data.days || {}).sort();
    activities = (data.activities || []).slice().sort((a, b) =>
      (b.d + (b.tm || "")).localeCompare(a.d + (a.tm || "")));
    if (!keys.length) return false;
    T0 = toT(keys[0]);
    N = Math.round((toT(keys[keys.length - 1]) - T0) / DAY) + 1;

    // The first day (watch setup) and the newest day (still in progress) are partial.
    // Keep only overnight metrics from them (final once you wake) plus finished activities.
    const updatedDay = data.updated ? localDay(new Date(data.updated)) : null;
    const partial = updatedDay && keys[keys.length - 1] >= updatedDay;

    for (const m of METRICS) {
      const a = new Float64Array(N).fill(NaN);
      if (m.acts) {
        for (const k of keys) a[idx(k)] = 0;
        m.count = 0;
        for (const x of activities) {
          const v = m.acts(x), i = idx(x.d);
          if (!v || i < 0 || i >= N) continue;
          a[i] += v; m.count++;
        }
      } else {
        for (const k of keys) {
          const v = data.days[k][m.key];
          if (v != null) a[idx(k)] = v;
        }
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
        series[m.key] = out;
        m.raw = out;
      } else {
        series[m.key] = a;
      }
      m.z = zoneFor(m);
    }
    return true;
  }
  const idx = (k) => Math.round((toT(k) - T0) / DAY);
  const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  function lastIdx(a) { if (!a) return -1; for (let i = a.length - 1; i >= 0; i--) if (!isNaN(a[i])) return i; return -1; }
  function firstIdx(a) { for (let i = 0; i < a.length; i++) if (!isNaN(a[i])) return i; return -1; }
  const latestIdx = (m) => m.ffill ? m.lastReal : lastIdx(series[m.key]);

  // Zones: fixed thresholds, or your own middle 60% of the last 90 days.
  function zoneFor(m) {
    if (Array.isArray(m.zone)) return { lo: m.zone[0], hi: m.zone[1], personal: false };
    if (m.zone !== "personal") return null;
    const a = m.raw, end = lastIdx(a);
    if (end < 0) return null;
    let vals = [];
    for (let i = Math.max(0, end - 89); i <= end; i++) if (!isNaN(a[i])) vals.push(a[i]);
    if (vals.length < 10) { vals = []; for (let i = 0; i <= end; i++) if (!isNaN(a[i])) vals.push(a[i]); }
    if (vals.length < 3) return null;
    vals.sort((x, y) => x - y);
    const q = (p) => { const k = (vals.length - 1) * p, f = Math.floor(k), c = Math.ceil(k); return vals[f] + (vals[c] - vals[f]) * (k - f); };
    const round = (x) => Number(x.toFixed(m.dec));
    const lo = round(q(0.2));
    const hi = Math.max(round(q(0.8)), lo + Math.pow(10, -m.dec));
    return { lo, hi, personal: true };
  }

  // trailing mean over w calendar days, skipping days without data;
  // waits for half a window of history before plotting
  function smooth(a, w, from, to) {
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

  function rangeBounds(a, r) {
    const end = lastIdx(a);
    if (end < 0) return null;
    let start;
    if (r.days === Infinity) start = firstIdx(a);
    else if (r.days === null) start = idx(`${toS(T0 + end * DAY).slice(0, 4)}-01-01`);
    else start = end - r.days + 1;
    return { start: Math.max(start, firstIdx(a), 0), end };
  }
  // the selected range on the whole-data day axis (for activities)
  function globalRange(r) {
    const end = N - 1;
    if (r.days === Infinity) return { start: 0, end };
    if (r.days === null) return { start: Math.max(0, idx(`${toS(T0 + end * DAY).slice(0, 4)}-01-01`)), end };
    return { start: Math.max(0, end - r.days + 1), end };
  }

  function computeView(m, r) {
    const b = rangeBounds(series[m.key], r);
    if (!b) return null;
    const w = m.ffill ? 1 : r.w;
    return { m, r, w, pts: smooth(series[m.key], w, b.start, b.end), start: b.start, end: b.end };
  }

  // ------------------------------------------------------------------ chart
  const svg = $("chart"), wrap = $("chartWrap");
  const PAD_T = 8, PAD_B = 12;
  let W = 0, H = 0;

  function geometry(v) {
    const ys = v.pts.map((p) => p[1]);
    let lo = Math.min(...ys), hi = Math.max(...ys);
    if (v.m.z) { lo = Math.min(lo, v.m.z.lo); hi = Math.max(hi, v.m.z.hi); }
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.08;
    lo -= pad; hi += pad;
    const span = Math.max(1, v.end - v.start);
    return {
      x: (i) => ((i - v.start) / span) * W,
      y: (val) => PAD_T + (1 - (val - lo) / (hi - lo)) * (H - PAD_T - PAD_B),
    };
  }

  // vertical gradient with hard stops at the zone edges → the line is green,
  // light grey or orange-red depending on which zone it is in
  function setZoneGradient(grad, m, yOf, height) {
    const stops = grad.querySelectorAll("stop");
    grad.setAttribute("y2", height);
    const clamp = (f) => Math.max(0, Math.min(1, f));
    let spec;
    if (!m.z) spec = [[0, "mid"], [0, "mid"], [0, "mid"], [1, "mid"], [1, "mid"], [1, "mid"]];
    else {
      const fhi = clamp(yOf(m.z.hi) / height), flo = clamp(yOf(m.z.lo) / height);
      const top = m.better === "down" ? "bad" : "good", bottom = m.better === "down" ? "good" : "bad";
      spec = [[0, top], [fhi, top], [fhi, "mid"], [flo, "mid"], [flo, bottom], [1, bottom]];
    }
    spec.forEach(([o, c], k) => { stops[k].setAttribute("offset", o); stops[k].setAttribute("stop-color", COLOR[c]); });
  }

  // resample a view to K evenly spaced y's in pixel space so any two lines can morph
  const K = 240;
  function resample(v, g) {
    const xs = v.pts.map((p) => g.x(p[0])), ys = v.pts.map((p) => g.y(p[1]));
    const out = new Float64Array(K);
    let j = 0;
    for (let k = 0; k < K; k++) {
      const X = (k / (K - 1)) * W;
      while (j < xs.length - 2 && xs[j + 1] < X) j++;
      const x0 = xs[j], x1 = xs[Math.min(j + 1, xs.length - 1)];
      const t = x1 === x0 ? 0 : Math.min(1, Math.max(0, (X - x0) / (x1 - x0)));
      out[k] = ys[j] + (ys[Math.min(j + 1, ys.length - 1)] - ys[j]) * t;
    }
    return out;
  }
  const pathFromYs = (ys) => {
    let d = "";
    for (let k = 0; k < ys.length; k++) d += (k ? "L" : "M") + ((k / (ys.length - 1)) * W).toFixed(1) + "," + ys[k].toFixed(1);
    return d;
  };
  const pathFromPts = (pts, g) => pts.map((p, k) => (k ? "L" : "M") + g.x(p[0]).toFixed(1) + "," + g.y(p[1]).toFixed(1)).join("");

  let anim = 0;
  function drawChart(animate) {
    W = wrap.clientWidth; H = wrap.clientHeight;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const v = view;
    const ok = v && v.pts.length >= 2;
    $("empty").hidden = ok;
    svg.style.visibility = ok ? "visible" : "hidden";
    $("note").textContent = ok && v.w > 1 ? `${v.w}-day average` : "";
    $("pts").replaceChildren();
    if (!ok) { $("empty").textContent = "Not enough data for this range yet."; shown = null; return; }

    const g = geometry(v);
    v.g = g;
    setZoneGradient($("zg"), v.m, g.y, H);

    // the "normal" band and its edge labels
    const band = $("band"), hiL = $("zlHi"), loL = $("zlLo");
    if (v.m.z) {
      const yh = g.y(v.m.z.hi), yl = g.y(v.m.z.lo);
      band.setAttribute("y", yh); band.setAttribute("height", Math.max(0, yl - yh)); band.setAttribute("width", W);
      hiL.textContent = fmtT(v.m, v.m.z.hi); hiL.setAttribute("x", W); hiL.setAttribute("y", Math.max(11, yh - 5));
      loL.textContent = fmtT(v.m, v.m.z.lo); loL.setAttribute("x", W); loL.setAttribute("y", Math.min(H - 1, yl + 13));
    } else {
      band.setAttribute("height", 0); hiL.textContent = ""; loL.textContent = "";
    }

    // a dot per day on short ranges, so each day's colour is easy to read
    if (v.w === 1 && v.pts.length <= 40) {
      const frag = document.createDocumentFragment();
      for (const [i, val] of v.pts) {
        const c = document.createElementNS(NS, "circle");
        c.setAttribute("class", "pt"); c.setAttribute("r", 3.5);
        c.setAttribute("cx", g.x(i)); c.setAttribute("cy", g.y(val));
        c.setAttribute("fill", colorOf(status(v.m, val)));
        frag.append(c);
      }
      $("pts").append(frag);
    }

    const target = resample(v, g);
    const finalD = pathFromPts(v.pts, g);
    cancelAnimationFrame(anim);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!animate || !shown || reduce) { setPath(finalD); shown = target; return; }
    const from = shown, t0 = performance.now(), dur = 420;
    const tmp = new Float64Array(K);
    $("pts").style.opacity = 0;
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - t, 3);
      for (let k = 0; k < K; k++) tmp[k] = from[k] + (target[k] - from[k]) * e;
      if (t < 1) { setPath(pathFromYs(tmp)); anim = requestAnimationFrame(step); }
      else { setPath(finalD); $("pts").style.opacity = 1; }
    };
    shown = target;
    anim = requestAnimationFrame(step);
  }
  function setPath(d) { $("lineOn").setAttribute("d", d); $("lineOff").setAttribute("d", d); }

  // ------------------------------------------------------------------ hover / scrub
  function setHover(k) {
    const v = view;
    if (!v || !v.g || v.pts.length < 2) return;
    if (k == null) {
      hoverIdx = null;
      $("cursor").setAttribute("visibility", "hidden");
      $("dot").setAttribute("visibility", "hidden");
      $("hoverLabel").hidden = true;
      $("note").style.visibility = "visible";
      $("clipOnRect").setAttribute("width", 100000);
      $("clipOffRect").setAttribute("x", 100000);
      renderHeadline();
      return;
    }
    hoverIdx = Math.max(0, Math.min(v.pts.length - 1, k));
    const [i, val] = v.pts[hoverIdx];
    const x = v.g.x(i), y = v.g.y(val);
    const c = $("cursor");
    c.setAttribute("x1", x); c.setAttribute("x2", x); c.setAttribute("y1", 0); c.setAttribute("y2", H);
    c.setAttribute("visibility", "visible");
    const dot = $("dot");
    dot.setAttribute("cx", x); dot.setAttribute("cy", y); dot.setAttribute("visibility", "visible");
    dot.setAttribute("fill", colorOf(status(v.m, series[v.m.key][i])));
    $("clipOnRect").setAttribute("width", Math.max(0, x + 10));
    $("clipOffRect").setAttribute("x", x);
    const lab = $("hoverLabel");
    lab.textContent = fmtDate(T0 + i * DAY);
    lab.hidden = false;
    const half = lab.offsetWidth / 2;
    lab.style.left = Math.max(half, Math.min(W - half, x)) + "px";
    $("note").style.visibility = "hidden";
    renderHeadline(hoverIdx);
  }

  function nearest(clientX) {
    const v = view;
    const X = clientX - wrap.getBoundingClientRect().left;
    let lo = 0, hi = v.pts.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (v.g.x(v.pts[mid][0]) < X) lo = mid + 1; else hi = mid; }
    let best = lo, bd = Infinity;
    for (const k of [lo - 1, lo]) {
      if (k < 0 || k >= v.pts.length) continue;
      const d = Math.abs(v.g.x(v.pts[k][0]) - X);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }

  wrap.addEventListener("pointermove", (e) => { if (view && view.g) setHover(nearest(e.clientX)); });
  wrap.addEventListener("pointerdown", (e) => { if (view && view.g) setHover(nearest(e.clientX)); });
  wrap.addEventListener("pointerleave", () => setHover(null));
  wrap.addEventListener("pointercancel", () => setHover(null));
  wrap.addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") setHover(null); });
  wrap.addEventListener("keydown", (e) => {
    if (!view || !view.g) return;
    const n = view.pts.length;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const at = hoverIdx == null ? n - 1 : hoverIdx;
      const step = e.shiftKey ? Math.ceil(n / 10) : 1;
      setHover(at + (e.key === "ArrowLeft" ? -step : step));
    } else if (e.key === "Escape") setHover(null);
  });
  wrap.addEventListener("blur", () => setHover(null));

  // ------------------------------------------------------------------ headline + legend
  function renderHeadline(k) {
    const v = view, m = cur();
    $("title").textContent = m.name;
    const valEl = $("value"), stEl = $("status");
    let i, val, when;
    if (k == null || !v) {
      i = latestIdx(m); val = i >= 0 ? series[m.key][i] : NaN;
      when = i >= 0 ? (m.weekly ? `7 days to ${fmtDate(T0 + i * DAY, false)}` : fmtDate(T0 + i * DAY, false)) : "";
    } else {
      // hovering shows that day's own reading, not the smoothed line value
      i = v.pts[k][0];
      val = series[m.key][i];
      when = m.weekly ? `7 days to ${fmtDate(T0 + i * DAY, false)}` : fmtDate(T0 + i * DAY, false);
    }
    if (isNaN(val)) {
      valEl.textContent = "—";
      stEl.replaceChildren(el("span", "when", when ? `No reading · ${when}` : "No reading"));
      return;
    }
    valEl.textContent = fmtV(m, val);
    const u = unitOf(m);
    if (u) valEl.append(el("span", "unit", u));

    const s = status(m, val);
    stEl.replaceChildren();
    if (s != null) {
      const dot = el("span", "dot"); dot.style.background = colorOf(s);
      const lab = el("span", null, labelOf(m, s)); lab.style.color = colorOf(s);
      stEl.append(dot, lab);
    }
    if (when) stEl.append(el("span", "when", (s != null ? "· " : "") + when));
  }

  function renderLegend() {
    const box = $("legend"); box.replaceChildren();
    const m = cur(), z = m.z;
    if (!z) return;
    const T = (x) => fmtT(m, x), L = m.labels;
    const items = m.better === "down"
      ? [[2, `${L[2]} · ${T(z.lo)} or less`], [1, L[1]], [0, `${L[0]} · over ${T(z.hi)}`]]
      : [[2, `${L[2]} · ${T(z.hi)}+`], [1, L[1]], [0, `${L[0]} · under ${T(z.lo)}`]];
    for (const [s, text] of items) {
      const sp = el("span"); const i = el("i"); i.style.background = colorOf(s);
      sp.append(i, document.createTextNode(text)); box.append(sp);
    }
    box.append(el("span", "src", z.personal ? "Zones from your last 90 days" : ""));
  }

  // ------------------------------------------------------------------ stats
  function stat(k, v, s, color) {
    const e = el("div", "stat");
    e.append(el("div", "k", k));
    const val = el("div", "v num", v); if (color) val.style.color = color;
    e.append(val);
    if (s) e.append(el("div", "s", s));
    return e;
  }
  function extremes(a, from, to) {
    let hi = -Infinity, lo = Infinity, hiI = -1, loI = -1, sum = 0, n = 0;
    for (let i = from; i <= to; i++) {
      const x = a[i]; if (isNaN(x)) continue;
      sum += x; n++;
      if (x > hi) { hi = x; hiI = i; }
      if (x < lo) { lo = x; loI = i; }
    }
    return { hi, lo, hiI, loI, avg: n ? sum / n : NaN, n };
  }
  const pct = (a, b) => b ? `${Math.round((a / b) * 100)}%` : "";

  function renderStats() {
    const box = $("stats"); box.replaceChildren();
    const v = view, m = cur();
    if (!v) return;
    const on = (i) => fmtDate(T0 + i * DAY);
    const li = latestIdx(m), latest = series[m.key][li], ls = status(m, latest);
    const trend = v.pts.length >= 2 ? v.pts[v.pts.length - 1][1] - v.pts[0][1] : NaN;
    const trendTxt = isNaN(trend) ? "—" : (m.fmt ? hmShort(Math.abs(trend)) : fmtU(m, Math.abs(trend)));
    const sign = isNaN(trend) || !parseFloat(trendTxt.replace(/[^0-9.]/g, "")) ? "" : trend > 0 ? "+" : "−";

    if (m.weekly) {
      const daily = m.daily;
      let total = 0, active = 0;
      for (let i = v.start; i <= v.end; i++) if (daily[i] > 0) { total += daily[i]; active++; }
      const days = v.end - v.start + 1, wk = extremes(series[m.key], v.start, v.end), T = m.total;
      box.append(
        stat("This week", T(latest), ls != null ? labelOf(m, ls) : "", colorOf(ls)),
        stat("Weekly average", T(total / Math.max(1, days / 7)), v.r.label),
        stat("Total", T(total), v.r.label),
        stat("Best week", wk.n ? T(wk.hi) : "—", wk.n ? `ending ${on(wk.hiI)}` : ""),
        stat("Active days", fmtN(active, 0), `of ${fmtN(days, 0)}`),
      );
      if (m.longest) {
        const inRange = activities.filter((a) => m.acts(a) && idx(a.d) >= v.start && idx(a.d) <= v.end);
        const best = inRange.reduce((b, a) => (!b || m.acts(a) > m.acts(b) ? a : b), null);
        box.append(stat(m.longest.label, best ? m.longest.fmt(best) : "—", best ? m.longest.sub(best) : ""));
      } else {
        box.append(stat("Trend", sign + trendTxt, v.r.label));
      }
      return;
    }
    const raw = series[m.key], r = extremes(raw, v.start, v.end);
    let good = 0, bad = 0;
    for (let i = v.start; i <= v.end; i++) {
      const s = status(m, raw[i]);
      if (s === 2) good++; else if (s === 0) bad++;
    }
    box.append(
      stat("Latest", fmtU(m, latest), `${ls != null ? labelOf(m, ls) + " · " : ""}${on(li)}`, colorOf(ls)),
      stat("Average", r.n ? fmtU(m, r.avg) : "—", v.r.label),
      stat("Trend", sign + trendTxt, v.r.label),
    );
    if (m.z) {
      box.append(
        stat("Green days", `${fmtN(good, 0)} of ${fmtN(r.n, 0)}`, `${pct(good, r.n)} · ${m.labels[2].toLowerCase()}`),
        stat("Red days", `${fmtN(bad, 0)} of ${fmtN(r.n, 0)}`, `${pct(bad, r.n)} · ${m.labels[0].toLowerCase()}`),
      );
    }
    box.append(stat("Range", r.n ? `${fmtV(m, r.lo)} – ${fmtU(m, r.hi)}` : "—", r.n ? `low ${fmtDate(T0 + r.loI * DAY, false)} · high ${fmtDate(T0 + r.hiI * DAY, false)}` : ""));
  }

  // ------------------------------------------------------------------ activities
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
  const typeName = (t) => TYPE[t] || t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  const dur = (s) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.round(s % 60);
    return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}:${String(sec).padStart(2, "0")}`;
  };
  const pace = (a) => {
    if (!a.m || a.m < 50 || !a.s) return null;
    if (/run|walk|hik/.test(a.t)) {
      const sec = a.s / dist(a.m);
      return ["Pace", `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")} /${distUnit()}`];
    }
    if (/cycl|bik|ride/.test(a.t)) return ["Speed", `${fmtN(dist(a.m) / (a.s / 3600), 1)} ${imperial() ? "mph" : "km/h"}`];
    return null;
  };
  const ZONE_COLORS = ["#8e8e93", "#0a84ff", "#30d158", "#ff9f0a", "#ff453a"];
  const titleCase = (s) => s.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

  function inRange(a, rg) { const i = idx(a.d); return i >= rg.start && i <= rg.end; }

  function renderActivities() {
    const r = RANGES.find((x) => x.id === state.range), rg = globalRange(r);
    const list = activities.filter((a) => inRange(a, rg));

    // tiles
    const tiles = $("actTiles"); tiles.replaceChildren();
    const secs = list.reduce((s, a) => s + (a.s || 0), 0);
    const meters = list.reduce((s, a) => s + (a.m || 0), 0);
    const kcal = list.reduce((s, a) => s + (a.kcal || 0), 0);
    tiles.append(
      stat("Activities", fmtN(list.length, 0), r.label),
      stat("Time", hm(secs / 3600), `${hm(secs / 3600 / Math.max(1, (rg.end - rg.start + 1) / 7))} / week`),
      stat("Distance", `${fmtN(dist(meters), 1)} ${distUnit()}`),
      stat("Calories", `${fmtN(kcal, 0)} kcal`),
    );

    renderCalendar(rg);
    renderTypes(list);
    renderHistory(list);
  }

  function renderCalendar(rg) {
    const cal = $("cal"), months = $("calMonths");
    cal.replaceChildren(); months.replaceChildren();
    const mins = new Float64Array(N);
    for (const a of activities) {
      const i = idx(a.d);
      if (i >= 0 && i < N && !REST.test(a.t)) mins[i] += (a.s || 0) / 60;
    }
    const startI = -new Date(T0).getUTCDay();          // the Sunday on or before the first day
    const weeks = Math.ceil((N - startI) / 7);
    // month labels: one per month, dropped when the next month starts too close
    const marks = [];
    for (let w = 0; w < weeks; w++) {
      const t = T0 + Math.max(0, startI + w * 7) * DAY;
      const mo = new Date(t).getUTCMonth();
      if (!marks.length || marks[marks.length - 1].mo !== mo) marks.push({ w, mo, t });
    }
    marks.forEach((mk, k) => {
      if (k + 1 < marks.length && marks[k + 1].w - mk.w < 3) return;
      const lab = el("span", null, new Date(mk.t).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }));
      lab.style.gridColumn = `${mk.w + 1} / span 3`; lab.style.gridRow = 1;
      months.append(lab);
    });
    for (let w = 0; w < weeks; w++) {
      for (let d = 0; d < 7; d++) {
        const i = startI + w * 7 + d;
        const c = el("div");
        c.style.gridColumn = w + 1; c.style.gridRow = d + 1;
        if (i < 0 || i >= N) { c.className = "void"; cal.append(c); continue; }
        const v = mins[i];
        c.className = v <= 0 ? "" : v < 20 ? "l1" : v < 45 ? "l2" : v < 75 ? "l3" : "l4";
        if (i < rg.start || i > rg.end) c.classList.add("out");
        if (actFilter && actFilter.day === i) c.classList.add("sel");
        c.dataset.i = i;
        cal.append(c);
      }
    }
    const sc = $("calScroll");
    sc.scrollLeft = sc.scrollWidth;
  }

  const tip = $("tip");
  $("cal").addEventListener("pointerover", (e) => {
    const c = e.target.closest("[data-i]");
    if (!c) return;
    const i = +c.dataset.i;
    const acts = activities.filter((a) => idx(a.d) === i);
    tip.replaceChildren(el("b", null, fmtDay(i)));
    if (!acts.length) tip.append(document.createTextNode(" · Rest day"));
    else {
      const t = acts.filter((a) => !REST.test(a.t)).reduce((s, a) => s + (a.s || 0), 0);
      tip.append(document.createTextNode(` · ${hmShort(t / 3600)} · ${acts.map((a) => typeName(a.t)).join(", ")}`));
    }
    const rect = c.getBoundingClientRect();
    tip.style.left = Math.max(80, Math.min(innerWidth - 80, rect.left + rect.width / 2)) + "px";
    tip.style.top = rect.top + "px";
    tip.hidden = false;
  });
  $("cal").addEventListener("pointerleave", () => { tip.hidden = true; });
  $("cal").addEventListener("click", (e) => {
    const c = e.target.closest("[data-i]");
    if (!c) return;
    const i = +c.dataset.i;
    actFilter = actFilter && actFilter.day === i ? null : { day: i };
    actLimit = 10;
    renderActivities();
  });
  addEventListener("scroll", () => { tip.hidden = true; }, { passive: true });

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
    if (!rows.length) box.append(el("div", "stat muted", "No activities in this range."));
    for (const g of rows) {
      const b = el("button", "trow");
      b.setAttribute("aria-pressed", String(!!actFilter && actFilter.type === g.t));
      const left = el("div", "tn");
      left.append(el("b", null, typeName(g.t)), el("small", null, `${g.n} ${g.n === 1 ? "activity" : "activities"}`));
      const right = el("div", "tv num", hmShort(g.s / 3600));
      right.append(el("small", null, g.m > 50 ? `${fmtN(dist(g.m), 1)} ${distUnit()}` : "—"));
      const bar = el("div", "tbar"); const fill = el("i"); fill.style.width = `${Math.max(1, (g.s / max) * 100)}%`; bar.append(fill);
      b.append(left, right, bar);
      b.addEventListener("click", () => {
        actFilter = actFilter && actFilter.type === g.t ? null : { type: g.t };
        actLimit = 10;
        renderActivities();
      });
      box.append(b);
    }
  }

  function renderHistory(list) {
    const chip = $("filterChip"); chip.replaceChildren();
    let shownList = list;
    if (actFilter) {
      const label = actFilter.type ? typeName(actFilter.type) : fmtDay(actFilter.day);
      shownList = actFilter.type ? list.filter((a) => a.t === actFilter.type) : activities.filter((a) => idx(a.d) === actFilter.day);
      const b = el("button", "chip", `${label}  ✕`);
      b.setAttribute("aria-label", `Clear filter: ${label}`);
      b.addEventListener("click", () => { actFilter = null; renderActivities(); });
      chip.append(b);
    }
    const box = $("actList"); box.replaceChildren();
    if (!shownList.length) box.append(el("div", "stat muted", actFilter && actFilter.day != null ? "Rest day — no activities." : "No activities in this range."));
    const thisYear = new Date().getFullYear();
    for (const a of shownList.slice(0, actLimit)) {
      const det = el("details", "act");
      const sum = el("summary");
      const left = el("div");
      const when = toT(a.d);
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
      det.addEventListener("toggle", () => { if (det.open && !det.dataset.built) { det.append(activityBody(a)); det.dataset.built = 1; } }, { once: false });
      box.append(det);
    }
    const more = $("more");
    more.hidden = shownList.length <= actLimit;
    more.textContent = `Show more (${shownList.length - actLimit})`;
  }
  $("more").addEventListener("click", () => { actLimit += 20; renderActivities(); });

  function activityBody(a) {
    const body = el("div", "act-body");
    const facts = el("div", "facts");
    const add = (k, v) => { if (v == null || v === "") return; const f = el("div", "fact"); f.append(el("div", "k", k), el("div", "v num", v)); facts.append(f); };
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
        const sp = el("span"); const sw = el("i"); sw.style.background = ZONE_COLORS[k];
        sp.append(sw, el("b", null, `Z${k + 1}`), document.createTextNode(hmShort(sec / 3600)));
        lab.append(sp);
      });
      zones.append(bar, lab);
      body.append(zones);
    }
    if (!a.z && a.te == null && !a.mx) body.append(el("div", "fact k muted", "Detailed metrics arrive with the next sync."));
    return body;
  }

  // ------------------------------------------------------------------ watchlist
  function renderList() {
    const box = $("list"); box.replaceChildren();
    const r = RANGES.find((x) => x.id === state.range);
    for (const m of METRICS) {
      if (!has(m)) continue;
      const v = computeView(m, r);
      const btn = el("button", "row");
      btn.setAttribute("aria-pressed", String(m.key === state.metric));
      const li = latestIdx(m), latest = series[m.key][li], s = status(m, latest);
      const left = el("div");
      const sub = el("div", "l");
      if (s != null) { const d = el("i"); d.style.background = colorOf(s); sub.append(d, document.createTextNode(labelOf(m, s))); }
      else sub.textContent = unitOf(m) || "—";
      left.append(el("div", "n", m.short || m.name), sub);

      const sv = document.createElementNS(NS, "svg");
      sv.setAttribute("viewBox", "0 0 64 28");
      if (v && v.pts.length >= 2) {
        const ys = v.pts.map((p) => p[1]);
        const lo = Math.min(...ys), hi = Math.max(...ys), span = Math.max(1, v.end - v.start);
        const yOf = (y) => 2 + (1 - (y - lo) / ((hi - lo) || 1)) * 24;
        const step = Math.max(1, Math.floor(v.pts.length / 64));
        const pts = v.pts.filter((_, k) => k % step === 0 || k === v.pts.length - 1);
        const defs = document.createElementNS(NS, "defs");
        const grad = document.createElementNS(NS, "linearGradient");
        grad.id = `sg-${m.key}`;
        grad.setAttribute("gradientUnits", "userSpaceOnUse");
        grad.setAttribute("x1", 0); grad.setAttribute("x2", 0); grad.setAttribute("y1", 0);
        for (let k = 0; k < 6; k++) grad.append(document.createElementNS(NS, "stop"));
        setZoneGradient(grad, m, yOf, 28);
        defs.append(grad);
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", pts.map(([i, y], k) => `${k ? "L" : "M"}${(((i - v.start) / span) * 64).toFixed(1)},${yOf(y).toFixed(1)}`).join(""));
        p.setAttribute("stroke", `url(#sg-${m.key})`);
        sv.append(defs, p);
      }
      const pill = el("div", `pill num ${s == null ? "mid" : STATUS[s]}`, isNaN(latest) ? "—" : fmtV(m, latest));
      btn.append(left, sv, pill);
      btn.addEventListener("click", () => select({ metric: m.key }));
      box.append(btn);
    }
  }

  // ------------------------------------------------------------------ ranges
  function renderRanges() {
    const nav = $("ranges"); nav.replaceChildren();
    for (const r of RANGES) {
      if (r.days !== Infinity && r.days !== null && r.days > N * 1.5 && r.id !== state.range) continue;
      const b = el("button", null, r.id);
      b.setAttribute("aria-pressed", String(r.id === state.range));
      b.setAttribute("aria-label", r.label);
      b.addEventListener("click", () => select({ range: r.id }));
      nav.append(b);
    }
  }

  // ------------------------------------------------------------------ orchestration
  function select(patch) {
    const rangeChanged = patch.range && patch.range !== state.range;
    state = { ...state, ...patch };
    history.replaceState(null, "", `#${state.metric}/${state.range}`);
    render(true, rangeChanged);
  }
  function render(animate, activitiesToo = true) {
    view = computeView(cur(), RANGES.find((x) => x.id === state.range));
    renderRanges();
    renderLegend();
    drawChart(animate);
    setHover(null);
    renderStats();
    renderList();
    if (activitiesToo) renderActivities();
  }

  function ago(iso) {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
    return `${Math.round(s / 86400)} days ago`;
  }

  async function init() {
    let data;
    try {
      const res = await fetch("/fit/data.json", { cache: "no-cache" });
      if (!res.ok) throw new Error(res.status);
      data = await res.json();
    } catch (e) {
      $("title").textContent = "No data yet";
      $("empty").hidden = false; $("empty").textContent = "Garmin sync hasn’t run yet.";
      return;
    }
    if (!build(data)) { $("title").textContent = "No data yet"; return; }
    if (data.updated) {
      const age = Date.now() - new Date(data.updated).getTime();
      const u = $("updated");
      u.textContent = `Updated ${ago(data.updated)}`;
      u.title = new Date(data.updated).toLocaleString();
      if (age > 36 * 3600 * 1000) { u.classList.add("stale"); u.textContent = `Sync paused · last updated ${ago(data.updated)}`; }
    }

    const [hm0, hr0] = location.hash.slice(1).split("/");
    const available = METRICS.filter(has).map((m) => m.key);
    state.metric = available.includes(hm0) ? hm0 : available[0] || "rhr";
    if (RANGES.some((r) => r.id === hr0)) state.range = hr0;
    render(false);
    new ResizeObserver(() => { drawChart(false); setHover(hoverIdx); }).observe(wrap);
  }
  init();
})();
