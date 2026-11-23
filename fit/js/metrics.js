// Metrics tab: zone-coloured line chart with scrub, stats, day-of-week, metric list.
import {
  NS, COLOR, STATUS, D, state, hooks, METRICS, metric, visible, status, colorOf, labelOf,
  fmtV, fmtU, fmtT, fmtN, fmtDelta, fmtDate, unitOf, latestIdx, idx, tOf, weekday, WEEKDAYS,
  computeView, currentRange, $, el, stat, mean, oneColumn, scrollBehavior,
} from "./core.js";

const svg = $("chart"), wrap = $("chartWrap");
const PAD_T = 8, PAD_B = 12, K = 240;
let view = null, shown = null, hoverIdx = null, anim = 0, W = 0, H = 0;

export function renderMetrics(animate) {
  const m = metric(state.metric);
  view = computeView(m, currentRange());
  renderLegend(m);
  drawChart(animate);
  setHover(null);
  renderStats(m);
  renderWeekdays(m);
  renderPicker();
  renderList();
}

export function initMetrics() {
  wrap.addEventListener("pointermove", (e) => { if (view && view.g) setHover(nearest(e.clientX)); });
  wrap.addEventListener("pointerdown", (e) => { if (view && view.g) setHover(nearest(e.clientX)); });
  wrap.addEventListener("pointerleave", () => setHover(null));
  wrap.addEventListener("pointercancel", () => setHover(null));
  wrap.addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") setHover(null); });
  wrap.addEventListener("blur", () => setHover(null));
  wrap.addEventListener("keydown", (e) => {
    if (!view || !view.g) return;
    const n = view.days.length;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const at = hoverIdx == null ? n - 1 : hoverIdx;
      const step = e.shiftKey ? Math.ceil(n / 10) : 1;
      setHover(at + (e.key === "ArrowLeft" ? -step : step));
    } else if (e.key === "Escape") setHover(null);
  });
  new ResizeObserver(() => { if (state.tab === "metrics") { drawChart(false); setHover(hoverIdx); } }).observe(wrap);
}

// ---------------------------------------------------------------- chart
// the y-axis fits both the line and every daily reading, so hover dots never leave the chart
function geometry(v) {
  let lo = Infinity, hi = -Infinity;
  for (const p of v.pts) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }
  for (const p of v.days) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); }
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

// Vertical gradient with hard stops at the zone edges: the line is green, light grey
// or orange-red depending on which zone it is in.
export function setZoneGradient(grad, m, yOf, height) {
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

// resample to K evenly spaced y's so any two lines can morph into each other
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
const setPath = (d) => { $("lineOn").setAttribute("d", d); $("lineOff").setAttribute("d", d); };

function drawChart(animate) {
  W = wrap.clientWidth; H = wrap.clientHeight;
  if (!W || !H) return;                         // tab hidden; redrawn when shown
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const v = view;
  const ok = v && v.pts.length >= 2;
  $("empty").hidden = ok;
  svg.style.visibility = ok ? "visible" : "hidden";
  $("note").textContent = ok && v.w > 1 ? `Dots: each day · line: ${v.w}-day average` : "";
  $("pts").replaceChildren();
  $("raw").replaceChildren();
  if (!ok) { $("empty").textContent = "Not enough data for this range yet."; shown = null; return; }

  const g = geometry(v);
  v.g = g;
  setZoneGradient($("zg"), v.m, g.y, H);

  const band = $("band"), hiL = $("zlHi"), loL = $("zlLo");
  if (v.m.z) {
    const yh = g.y(v.m.z.hi), yl = g.y(v.m.z.lo);
    band.setAttribute("y", yh); band.setAttribute("height", Math.max(0, yl - yh)); band.setAttribute("width", W);
    hiL.textContent = fmtT(v.m, v.m.z.hi); hiL.setAttribute("x", W); hiL.setAttribute("y", Math.max(11, yh - 5));
    loL.textContent = fmtT(v.m, v.m.z.lo); loL.setAttribute("x", W); loL.setAttribute("y", Math.min(H - 1, yl + 13));
  } else {
    band.setAttribute("height", 0); hiL.textContent = ""; loL.textContent = "";
  }

  // one dot per day on short ranges, so each day's colour is easy to read
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

  // when the line is an average, each day's own reading sits behind it as a faint dot;
  // the hover marker lands on these, so the marker and the headline number always agree
  if (v.w > 1) {
    const r = Math.max(1.25, Math.min(2.25, W / v.days.length / 2.5));
    const frag = document.createDocumentFragment();
    for (const [i, val] of v.days) {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("class", "rd"); c.setAttribute("r", r);
      c.setAttribute("cx", g.x(i)); c.setAttribute("cy", g.y(val));
      c.setAttribute("fill", colorOf(status(v.m, val)));
      frag.append(c);
    }
    $("raw").append(frag);
  }

  const dots = [$("pts"), $("raw")];
  const showDots = (on) => { for (const d of dots) d.style.opacity = on ? "" : 0; };
  const target = resample(v, g), finalD = pathFromPts(v.pts, g);
  cancelAnimationFrame(anim);
  if (!animate || !shown || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    setPath(finalD); showDots(true); shown = target; return;
  }
  const from = shown, t0 = performance.now(), dur = 420, tmp = new Float64Array(K);
  showDots(false);
  const step = (now) => {
    const t = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - t, 3);
    for (let k = 0; k < K; k++) tmp[k] = from[k] + (target[k] - from[k]) * e;
    if (t < 1) { setPath(pathFromYs(tmp)); anim = requestAnimationFrame(step); }
    else { setPath(finalD); showDots(true); }
  };
  shown = target;
  anim = requestAnimationFrame(step);
}

// ---------------------------------------------------------------- hover / scrub
// Hover steps through days that have a reading (k indexes view.days). The marker sits on
// that day's own value, the same number the headline shows; on averaged ranges the label
// also gives the line's value there.
function setHover(k) {
  const v = view;
  if (!v || !v.g || v.pts.length < 2 || !v.days.length) { renderHeadline(null); return; }
  if (k == null) {
    hoverIdx = null;
    $("cursor").setAttribute("visibility", "hidden");
    $("dot").setAttribute("visibility", "hidden");
    $("hoverLabel").hidden = true;
    $("note").style.visibility = "visible";
    $("clipOnRect").setAttribute("width", 100000);
    $("clipOffRect").setAttribute("x", 100000);
    renderHeadline(null);
    return;
  }
  hoverIdx = Math.max(0, Math.min(v.days.length - 1, k));
  const [i, val] = v.days[hoverIdx];
  const x = v.g.x(i), y = v.g.y(val);
  const c = $("cursor");
  c.setAttribute("x1", x); c.setAttribute("x2", x); c.setAttribute("y1", 0); c.setAttribute("y2", H);
  c.setAttribute("visibility", "visible");
  const dot = $("dot");
  dot.setAttribute("cx", x); dot.setAttribute("cy", y); dot.setAttribute("visibility", "visible");
  dot.setAttribute("fill", colorOf(status(v.m, val)));
  $("clipOnRect").setAttribute("width", Math.max(0, x + 10));
  $("clipOffRect").setAttribute("x", x);
  const lab = $("hoverLabel");
  const avg = v.w > 1 ? lineAt(v, i) : NaN;
  lab.textContent = fmtDate(tOf(i)) + (isNaN(avg) ? "" : ` · ${v.w}-day avg ${fmtU(v.m, avg)}`);
  lab.hidden = false;
  const half = lab.offsetWidth / 2;
  lab.style.left = Math.max(half, Math.min(W - half, x)) + "px";
  $("note").style.visibility = "hidden";
  renderHeadline(i);
}

// first index in a list of [day, value] pairs (sorted by day) whose day is >= i
function lowerBound(list, i) {
  let lo = 0, hi = list.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid][0] < i) lo = mid + 1; else hi = mid; }
  return lo;
}
// the plotted line's value on day i (NaN where the line hasn't started)
function lineAt(v, i) {
  const k = lowerBound(v.pts, i);
  return k < v.pts.length && v.pts[k][0] === i ? v.pts[k][1] : NaN;
}

function nearest(clientX) {
  const v = view, X = clientX - wrap.getBoundingClientRect().left;
  const span = Math.max(1, v.end - v.start), day = v.start + (X / W) * span;
  const lo = lowerBound(v.days, day);
  let best = Math.min(lo, v.days.length - 1), bd = Infinity;
  for (const k of [lo - 1, lo]) {
    if (k < 0 || k >= v.days.length) continue;
    const d = Math.abs(v.days[k][0] - day);
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

// The headline shows one day's own reading: the latest, or the hovered day.
function renderHeadline(day) {
  const m = metric(state.metric);
  $("title").textContent = m.name;
  const valEl = $("value"), stEl = $("status");
  const i = day == null ? latestIdx(m) : day;
  const val = i >= 0 ? D.series[m.key][i] : NaN;
  const when = i < 0 ? "" : m.weekly ? `7 days to ${fmtDate(tOf(i), false)}` : fmtDate(tOf(i), false);
  stEl.replaceChildren();
  if (isNaN(val)) {
    valEl.textContent = "—";
    stEl.append(el("span", "when", when ? `No reading · ${when}` : "No data"));
    return;
  }
  valEl.textContent = fmtV(m, val);
  if (unitOf(m)) valEl.append(el("span", "unit", unitOf(m)));
  const s = status(m, val);
  if (s != null) {
    const dot = el("span", "dot"); dot.style.background = colorOf(s);
    const lab = el("span", null, labelOf(m, s)); lab.style.color = colorOf(s);
    stEl.append(dot, lab);
  }
  if (!isNaN(m.usual) && day == null && !m.weekly) {
    stEl.append(el("span", "when", `${s != null ? "· " : ""}${when} · usual ${fmtU(m, m.usual)}`));
  } else if (when) stEl.append(el("span", "when", (s != null ? "· " : "") + when));
}

function renderLegend(m) {
  const box = $("legend"); box.replaceChildren();
  const z = m.z;
  if (!z) return;
  const T = (x) => fmtT(m, x), L = m.labels;
  const items = m.better === "down"
    ? [[2, `${L[2]} · ${T(z.lo)} or less`], [1, L[1]], [0, `${L[0]} · over ${T(z.hi)}`]]
    : [[2, `${L[2]} · ${T(z.hi)}+`], [1, L[1]], [0, `${L[0]} · under ${T(z.lo)}`]];
  for (const [s, text] of items) {
    const sp = el("span"), sw = el("i");
    sw.style.background = colorOf(s);
    sp.append(sw, document.createTextNode(text));
    box.append(sp);
  }
  box.append(el("span", "src", z.personal ? "Zones from your last 90 days" : ""));
}

// ---------------------------------------------------------------- stats
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
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "");

function renderStats(m) {
  const box = $("stats"); box.replaceChildren();
  const v = view;
  if (!v) return;
  const on = (i) => fmtDate(tOf(i));
  const li = latestIdx(m), latest = D.series[m.key][li], ls = status(m, latest);
  const trend = v.pts.length >= 2 ? v.pts[v.pts.length - 1][1] - v.pts[0][1] : NaN;
  const trendTxt = isNaN(trend) ? "—" : fmtDelta(m, trend);

  if (m.weekly) {
    let total = 0, active = 0;
    for (let i = v.start; i <= v.end; i++) if (m.daily[i] > 0) { total += m.daily[i]; active++; }
    const days = v.end - v.start + 1, wk = extremes(D.series[m.key], v.start, v.end), T = m.total;
    box.append(
      stat("This week", T(latest), labelOf(m, ls), colorOf(ls)),
      stat("Weekly average", T(total / Math.max(1, days / 7)), v.r.label),
      stat("Total", T(total), v.r.label),
      stat("Best week", wk.n ? T(wk.hi) : "—", wk.n ? `ending ${on(wk.hiI)}` : ""),
      stat("Active days", fmtN(active, 0), `of ${fmtN(days, 0)}`),
    );
    if (m.longest) {
      const inRange = D.activities.filter((a) => { const i = idx(a.d); return m.acts(a) && i >= v.start && i <= v.end; });
      const best = inRange.reduce((b, a) => (!b || m.acts(a) > m.acts(b) ? a : b), null);
      box.append(stat(m.longest.label, best ? m.longest.fmt(best) : "—", best ? m.longest.sub(best) : ""));
    } else box.append(stat("Trend", trendTxt, v.r.label));
    return;
  }
  const raw = D.series[m.key], r = extremes(raw, v.start, v.end);
  let good = 0, bad = 0;
  for (let i = v.start; i <= v.end; i++) {
    const s = status(m, raw[i]);
    if (s === 2) good++; else if (s === 0) bad++;
  }
  box.append(
    stat("Latest", fmtU(m, latest), `${ls != null ? labelOf(m, ls) + " · " : ""}${on(li)}`, colorOf(ls)),
    stat("Average", r.n ? fmtU(m, r.avg) : "—", v.r.label),
    stat("Trend", trendTxt, `${v.r.label}${v.w > 1 ? ` · ${v.w}-day avg` : ""}`),
  );
  if (m.z) {
    box.append(
      stat("Green days", `${fmtN(good, 0)} of ${fmtN(r.n, 0)}`, `${pct(good, r.n)} · ${m.labels[2].toLowerCase()}`),
      stat("Red days", `${fmtN(bad, 0)} of ${fmtN(r.n, 0)}`, `${pct(bad, r.n)} · ${m.labels[0].toLowerCase()}`),
    );
  }
  box.append(stat("Range", r.n ? `${fmtV(m, r.lo)} – ${fmtU(m, r.hi)}` : "—",
    r.n ? `low ${fmtDate(tOf(r.loI), false)} · high ${fmtDate(tOf(r.hiI), false)}` : ""));
}

// Average per weekday in the selected range. Overnight metrics are grouped by the
// night they started (the reading is dated the morning you wake up).
function renderWeekdays(m) {
  const sec = $("weekdaysSec"), box = $("weekdays");
  box.replaceChildren();
  const v = view;
  if (!v || m.weekly) { sec.hidden = true; return; }
  const groups = Array.from({ length: 7 }, () => []);
  const raw = D.series[m.key];
  for (let i = v.start; i <= v.end; i++) {
    if (isNaN(raw[i])) continue;
    groups[m.night ? (weekday(i) + 6) % 7 : weekday(i)].push(raw[i]);
  }
  const avgs = groups.map((g) => (g.length >= 2 ? mean(g) : NaN));
  if (avgs.filter((x) => !isNaN(x)).length < 5) { sec.hidden = true; return; }
  sec.hidden = false;
  $("weekdaysHint").textContent = m.night ? "by the night it started" : "";
  const max = Math.max(...avgs.filter((x) => !isNaN(x)));
  const order = [1, 2, 3, 4, 5, 6, 0];                          // Mon … Sun
  for (const d of order) {
    const col = el("div", "b");
    const a = avgs[d];
    col.append(el("span", "val num", isNaN(a) ? "—" : fmtV(m, a)));
    const bar = el("i");
    bar.style.height = `${isNaN(a) ? 0 : Math.max(2, (a / max) * 96)}px`;
    bar.style.background = colorOf(status(m, a));
    bar.title = `${WEEKDAYS[d]}: ${isNaN(a) ? "no data" : fmtU(m, a)} (${groups[d].length} days)`;
    col.append(bar, el("span", "lab", WEEKDAYS[d]));
    box.append(col);
  }
}

// ---------------------------------------------------------------- metric picker (phones)
// A swipeable row of metrics above the chart; on one column the full list sits at the bottom.
function renderPicker() {
  const box = $("picker"); box.replaceChildren();
  let active = null;
  for (const m of METRICS) {
    if (!visible(m)) continue;
    const b = el("button");
    b.setAttribute("aria-pressed", String(m.key === state.metric));
    const d = el("i");
    d.style.background = colorOf(status(m, D.series[m.key][latestIdx(m)]));
    b.append(d, document.createTextNode(m.short || m.name));
    b.addEventListener("click", () => hooks.select({ metric: m.key }));
    box.append(b);
    if (m.key === state.metric) active = b;
  }
  if (active && box.clientWidth) box.scrollLeft = active.offsetLeft - (box.clientWidth - active.offsetWidth) / 2;
}

// ---------------------------------------------------------------- metric list
function renderList() {
  const box = $("list"); box.replaceChildren();
  const r = currentRange();
  for (const m of METRICS) {
    if (!visible(m)) continue;
    const v = computeView(m, r);
    const btn = el("button", "row");
    btn.setAttribute("aria-pressed", String(m.key === state.metric));
    const li = latestIdx(m), latest = D.series[m.key][li], s = status(m, latest);
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
    btn.addEventListener("click", () => {
      hooks.select({ metric: m.key });
      if (oneColumn()) scrollTo({ top: 0, behavior: scrollBehavior() });   // list is below the chart
    });
    box.append(btn);
  }
}
