// calc.js — Berechnungen zur Kraftentwicklung.
// Bewusst als eigenes, klar dokumentiertes Modul, damit wir die Formeln
// jederzeit gemeinsam anpassen können.

// ---- Geschätztes 1-Rep-Max (1RM) ----
// Epley (Standard):   1RM = w * (1 + reps/30)
// Brzycki:            1RM = w * 36 / (37 - reps)
// Bei 1 Wiederholung entspricht das 1RM dem verwendeten Gewicht.

export function e1rm(weight, reps, formula = 'epley') {
  const w = Number(weight) || 0;
  const r = Number(reps) || 0;
  if (w <= 0 || r <= 0) return 0;
  if (r === 1) return w;
  if (formula === 'brzycki') {
    if (r >= 37) return w; // Formel wird ab 37 Wdh. instabil
    return w * 36 / (37 - r);
  }
  // epley
  return w * (1 + r / 30);
}

export function round1(x) {
  return Math.round(x * 10) / 10;
}

// Volumen eines Satzes = Gewicht * Wiederholungen (Tonnage).
export function setVolume(weight, reps) {
  return (Number(weight) || 0) * (Number(reps) || 0);
}

// ---- Datum-Helfer ----
export function dayKey(d) {
  const x = new Date(d);
  return x.toISOString().slice(0, 10); // YYYY-MM-DD
}

function daysBetween(a, b) {
  return (new Date(b) - new Date(a)) / (1000 * 60 * 60 * 24);
}

// ---- Lineare Regression (Trend) ----
// points: [{x: Zeit-in-Tagen, y: Wert}]  →  {slope, intercept}
export function linreg(points) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: n ? points[0].y : 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of points) {
    sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return { slope: 0, intercept: sy / n };
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

// ---- Progression pro Übung ----
// sets: alle Sätze einer Übung (mit .weight, .reps und Datum .date)
// Liefert Zeitreihe des besten e1RM pro Tag + Kennzahlen.
export function progression(sets, formula = 'epley') {
  const validSets = sets.filter((s) => s.weight > 0 && s.reps > 0 && s.date);
  if (validSets.length === 0) {
    return { series: [], best: 0, current: 0, first: 0,
             changeAbs: 0, changePct: 0, slopePerWeek: 0, sessions: 0 };
  }

  // Bestes e1RM je Tag
  const byDay = new Map();
  for (const s of validSets) {
    const k = dayKey(s.date);
    const val = e1rm(s.weight, s.reps, formula);
    if (!byDay.has(k) || val > byDay.get(k)) byDay.set(k, val);
  }
  const series = [...byDay.entries()]
    .map(([date, value]) => ({ date, value: round1(value) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const first = series[0].value;
  const current = series[series.length - 1].value;
  const best = Math.max(...series.map((p) => p.value));

  // Trend als kg/Woche über lineare Regression
  const t0 = new Date(series[0].date);
  const points = series.map((p) => ({ x: daysBetween(t0, p.date), y: p.value }));
  const { slope } = linreg(points); // kg pro Tag
  const slopePerWeek = round1(slope * 7);

  const changeAbs = round1(current - first);
  const changePct = first > 0 ? round1(((current - first) / first) * 100) : 0;

  return {
    series,
    best: round1(best),
    current: round1(current),
    first: round1(first),
    changeAbs,
    changePct,
    slopePerWeek,
    sessions: series.length,
  };
}

// ---- Wochen-Volumen je Kategorie ----
// sets brauchen .date, .weight, .reps, .category (von der Übung angereichert)
export function weeklyVolumeByCategory(sets, days = 7) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const totals = {};
  for (const s of sets) {
    if (!s.date) continue;
    if (new Date(s.date).getTime() < cutoff) continue;
    const cat = s.category || 'sonstige';
    totals[cat] = (totals[cat] || 0) + setVolume(s.weight, s.reps);
  }
  return totals;
}

// Gesamtvolumen einer Menge von Sätzen
export function totalVolume(sets) {
  return sets.reduce((sum, s) => sum + setVolume(s.weight, s.reps), 0);
}

// Bester Satz einer Menge nach geschätztem 1RM.
// Liefert {value, set} – value gerundet, set der zugehörige Satz (oder null).
export function bestE1rm(sets, formula = 'epley') {
  let best = 0, bestSet = null;
  for (const s of sets) {
    const v = e1rm(s.weight, s.reps, formula);
    if (v > best) { best = v; bestSet = s; }
  }
  return { value: round1(best), set: bestSet };
}
