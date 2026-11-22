// Today tab: readiness from last night, last 7 days vs the 7 before, patterns in your
// own data, personal bests.
import {
  D, REST, hooks, metric, status, colorOf, labelOf, direction, unitOf, fmtV, fmtU, fmtDelta, fmtN, fmtDate, fmtDay,
  hm, idx, tOf, weekday, WEEKDAYS, latestIdx, windowMean, mean, $, el, stat, statusChip,
} from "./core.js";

export function renderToday() {
  renderReadiness();
  renderWeek();
  renderPatterns();
  renderBests();
}

// ---------------------------------------------------------------- readiness
const SIGNALS = ["sleep", "hrv", "rhr", "bb"];
const NOUN = { sleep: "sleep", hrv: "HRV", rhr: "resting HR", bb: "Body Battery" };

function renderReadiness() {
  const box = $("signals"); box.replaceChildren();
  const night = latestIdx(metric("sleep"));
  let score = 0, n = 0;
  const good = [], bad = [];
  for (const k of SIGNALS) {
    const m = metric(k), i = latestIdx(m);
    if (i < 0) continue;
    const v = D.series[k][i], s = status(m, v);
    if (s != null) {
      score += s - 1; n++;
      if (s === 2) good.push(`${labelOf(m, s).toLowerCase()} ${NOUN[k]}`);
      if (s === 0) bad.push(`${labelOf(m, s).toLowerCase()} ${NOUN[k]}`);
    }
    const card = el("button", "sig");
    card.append(el("div", "k", m.short || m.name));
    const val = el("div", "v num", fmtV(m, v));
    if (unitOf(m)) val.append(el("small", null, unitOf(m)));
    const st = el("div", "s"); st.append(statusChip(m, s));
    const note = [!isNaN(m.usual) ? `usual ${fmtU(m, m.usual)}` : "", i !== night ? fmtDate(tOf(i), false) : ""].filter(Boolean).join(" · ");
    card.append(val, st, el("div", "u", note));
    card.setAttribute("aria-label", `${m.name}: ${fmtU(m, v)}${s != null ? ", " + labelOf(m, s) : ""}. Open chart.`);
    card.addEventListener("click", () => hooks.select({ tab: "metrics", metric: k, range: "1M" }));
    box.append(card);
  }

  $("todayWhen").textContent = night >= 0 ? `${fmtDay(night)} · based on last night` : "";
  const h = $("verdict"); h.replaceChildren();
  const list = (xs) => xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0];
  let s, title, text;
  if (!n) { s = null; title = "No recent data"; text = "Wear your watch overnight and this fills in after the next sync."; }
  else if (score >= 2) { s = 2; title = "Well recovered"; text = `Better than usual: ${list(good)}. A good day for a harder workout.`; }
  else if (score <= -2) { s = 0; title = "Under-recovered"; text = `Off today: ${list(bad)}. Consider an easier day and an earlier night.`; }
  else {
    s = 1; title = "Normal";
    text = bad.length ? `Mostly your usual range, but watch the ${list(bad)}.`
      : good.length ? `Your usual range, with ${list(good)}. Train as planned.`
      : "Everything is in your usual range. Train as planned.";
  }
  const dot = el("span", "dot"); dot.style.background = colorOf(s);
  h.append(dot, document.createTextNode(title));
  $("verdictText").textContent = text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------- last 7 days
const WEEK = [
  { key: "im", goal: 150 },
  { key: "workout" },
  { key: "sleep", hit: [7, "nights 7h+", (v) => v >= 7] },
  { key: "steps", hit: [10000, "days 10k+", (v) => v >= 10000] },
  { key: "rhr" },
  { key: "stress" },
];

function renderWeek() {
  const box = $("week"); box.replaceChildren();
  for (const row of WEEK) {
    const m = metric(row.key), e = latestIdx(m);
    if (e < 6) continue;
    let cur, prev, sub = "";
    if (m.weekly) {
      cur = D.series[m.key][e]; prev = D.series[m.key][e - 7];
    } else {
      cur = windowMean(m.raw, e - 6, e).avg; prev = windowMean(m.raw, e - 13, e - 7).avg;
    }
    if (isNaN(cur)) continue;
    if (row.goal) sub = cur >= row.goal ? `Goal met (${row.goal} min)` : `${fmtN(row.goal - cur, 0)} min to the ${row.goal} goal`;
    else if (m.key === "workout") {
      const sessions = D.activities.filter((a) => { const i = idx(a.d); return i > e - 7 && i <= e && !REST.test(a.t); }).length;
      sub = `${sessions} ${sessions === 1 ? "session" : "sessions"}`;
    } else if (row.hit) {
      let hits = 0, days = 0;
      for (let i = e - 6; i <= e; i++) if (!isNaN(m.raw[i])) { days++; if (row.hit[2](m.raw[i])) hits++; }
      sub = `${hits} of ${days} ${row.hit[1]}`;
    } else if (!isNaN(m.usual)) sub = `usual ${fmtU(m, m.usual)}`;

    const b = el("button", "wrow");
    const left = el("div");
    left.append(el("div", "n", m.short || m.name), el("div", "d", sub));
    const right = el("div", "r");
    const v = el("div", "v num", m.weekly && m.total ? m.total(cur) : m.fmt ? m.fmt(cur) : fmtU(m, cur));
    v.style.color = colorOf(status(m, cur));
    right.append(v);
    if (!isNaN(prev)) {
      const delta = cur - prev, dir = direction(m, delta);
      const c = el("div", "c num", fmtDelta(m, delta));
      c.style.color = dir > 0 ? colorOf(2) : dir < 0 ? colorOf(0) : "var(--muted)";
      right.append(c);
    }
    b.append(left, right);
    if (row.goal) {
      const bar = el("div", "prog"), fill = el("i");
      fill.style.width = `${Math.min(100, (cur / row.goal) * 100)}%`;
      fill.style.background = colorOf(status(m, cur));
      bar.append(fill); b.append(bar);
    }
    b.addEventListener("click", () => hooks.select({ tab: "metrics", metric: m.key, range: "1M" }));
    box.append(b);
  }
}

// ---------------------------------------------------------------- patterns
// Simple group comparisons over your whole history. Shown only with enough days in
// both groups and a gap big enough to matter; strongest first.
const MIN_DAYS = 6;

function compare(A, B, minGap) {
  if (A.length < MIN_DAYS || B.length < MIN_DAYS) return null;
  const a = mean(A), b = mean(B);
  if (Math.abs(a - b) < minGap) return null;
  return { a, b, na: A.length, nb: B.length, strength: Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) };
}

function findPatterns() {
  const S = D.series, N = D.N, out = [];
  const sleep = S.sleep, hrv = S.hrv, rhr = S.rhr, score = S.sleepScore, stress = S.stress;
  const more = (c) => (c.a > c.b ? "higher" : "lower");

  { // sleep length → that night's HRV
    const A = [], B = [];
    for (let i = 0; i < N; i++) {
      if (isNaN(sleep[i]) || isNaN(hrv[i])) continue;
      if (sleep[i] >= 7) A.push(hrv[i]); else if (sleep[i] < 6) B.push(hrv[i]);
    }
    const c = compare(A, B, 2), m = metric("hrv");
    if (c) out.push({ title: "Sleep and HRV", m, c, la: "7h+ nights", lb: "Under 6h", unit: "nights",
      text: `On nights you sleep 7h or more, your HRV averages ${fmtU(m, c.a)}, ${fmtU(m, Math.abs(c.a - c.b))} ${more(c)} than on nights under 6h.` });
  }
  { // training day → that night's sleep score (sleep is dated the morning after)
    const A = [], B = [];
    for (let i = 0; i < N - 1; i++) {
      if (isNaN(score[i + 1])) continue;
      if (D.trainMin[i] >= 20) A.push(score[i + 1]); else if (D.trainMin[i] === 0) B.push(score[i + 1]);
    }
    const c = compare(A, B, 2), m = metric("sleepScore");
    if (c) out.push({ title: "Training and sleep", m, c, la: "After training", lb: "After rest days", unit: "nights",
      text: `After days you train, your sleep score averages ${fmtV(m, c.a)}, ${fmtV(m, Math.abs(c.a - c.b))} points ${more(c)} than after rest days.` });
  }
  { // hard session → next morning's resting HR
    const A = [], B = [];
    for (let i = 0; i < N - 1; i++) {
      if (isNaN(rhr[i + 1])) continue;
      if (D.hard[i]) A.push(rhr[i + 1]); else if (D.trainMin[i] === 0) B.push(rhr[i + 1]);
    }
    const c = compare(A, B, 1), m = metric("rhr");
    if (c) out.push({ title: "Hard sessions and resting HR", m, c, la: "After hard days", lb: "After rest days", unit: "mornings",
      text: `The morning after a hard session, your resting HR averages ${fmtU(m, c.a)}, ${fmtU(m, Math.abs(c.a - c.b))} ${more(c)} than after rest days.` });
  }
  { // short night → that day's stress
    const A = [], B = [];
    for (let i = 0; i < N; i++) {
      if (isNaN(sleep[i]) || isNaN(stress[i])) continue;
      if (sleep[i] < 6) A.push(stress[i]); else if (sleep[i] >= 7) B.push(stress[i]);
    }
    const c = compare(A, B, 2), m = metric("stress");
    if (c) out.push({ title: "Sleep and stress", m, c, la: "After under 6h", lb: "After 7h+", unit: "days",
      text: `After a short night (under 6h), your average stress is ${fmtV(m, c.a)}, vs ${fmtV(m, c.b)} after 7h or more.` });
  }
  { // which nights of the week are shortest
    const g = Array.from({ length: 7 }, () => []);
    for (let i = 0; i < N; i++) if (!isNaN(sleep[i])) g[(weekday(i) + 6) % 7].push(sleep[i]);
    const avgs = g.map((xs) => (xs.length >= 3 ? mean(xs) : NaN));
    const ok = avgs.map((a, d) => [a, d]).filter(([a]) => !isNaN(a));
    if (ok.length >= 5) {
      const lo = ok.reduce((x, y) => (y[0] < x[0] ? y : x)), hi = ok.reduce((x, y) => (y[0] > x[0] ? y : x));
      if (hi[0] - lo[0] >= 1 / 3) {
        const m = metric("sleep");
        out.push({ title: "Your week", m, c: { a: hi[0], b: lo[0], na: g[hi[1]].length, nb: g[lo[1]].length, strength: (hi[0] - lo[0]) / hi[0] },
          la: `${WEEKDAYS[hi[1]]} nights`, lb: `${WEEKDAYS[lo[1]]} nights`, unit: "nights",
          text: `You sleep most on ${WEEKDAYS[hi[1]]} nights (${hm(hi[0])}) and least on ${WEEKDAYS[lo[1]]} nights (${hm(lo[0])}).` });
      }
    }
  }
  return out.sort((x, y) => y.c.strength - x.c.strength).slice(0, 4);
}

function renderPatterns() {
  const box = $("patterns"); box.replaceChildren();
  const found = findPatterns();
  if (!found.length) { box.append(el("div", "empty-row", "Not enough data for patterns yet. They appear as your history grows.")); return; }
  for (const p of found) {
    const card = el("div", "insight");
    card.append(el("div", "t", p.title), el("p", null, p.text));
    const max = Math.max(p.c.a, p.c.b);
    for (const [label, val] of [[p.la, p.c.a], [p.lb, p.c.b]]) {
      const row = el("div", "ibar");
      const track = el("div", "track"), fill = el("i");
      fill.style.width = `${(val / max) * 100}%`;
      fill.style.background = colorOf(status(p.m, val));
      track.append(fill);
      row.append(el("span", "l", label), track, el("span", "v num", fmtV(p.m, val)));
      card.append(row);
    }
    card.append(el("div", "n", `${p.c.na} vs ${p.c.nb} ${p.unit}`));
    box.append(card);
  }
}

// ---------------------------------------------------------------- personal bests
const BESTS = [
  ["rhr", "min", "Lowest resting HR"], ["hrv", "max", "Highest HRV"], ["sleep", "max", "Longest sleep"],
  ["sleepScore", "max", "Best sleep score"], ["steps", "max", "Most steps"], ["workout", "max", "Biggest training week"],
];

function renderBests() {
  const box = $("bests"); box.replaceChildren();
  for (const [key, kind, label] of BESTS) {
    const m = metric(key), a = m.raw;
    let best = NaN, at = -1;
    for (let i = 0; i < a.length; i++) {
      if (isNaN(a[i])) continue;
      if (isNaN(best) || (kind === "min" ? a[i] < best : a[i] > best)) { best = a[i]; at = i; }
    }
    if (at < 0) continue;
    const value = m.weekly ? m.total(best) : fmtU(m, best);
    box.append(stat(label, value, m.weekly ? `week ending ${fmtDate(tOf(at))}` : fmtDate(tOf(at))));
  }
}
