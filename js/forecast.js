// forecast.js — Prognosen, Ziele & Milestones aus der Progression.

import { round1 } from './calc.js';

// Prognostiziertes e1RM in N Wochen (linearer Trend).
export function forecastValue(prog, weeks) {
  if (!prog || prog.current == null) return null;
  return round1(prog.current + (prog.slopePerWeek || 0) * weeks);
}

// Wochen bis ein Zielgewicht (e1RM) erreicht ist. null, wenn kein Fortschritt.
export function weeksToTarget(prog, target) {
  if (!prog || !(prog.slopePerWeek > 0)) return null;
  if (target <= prog.current) return 0;
  return Math.ceil((target - prog.current) / prog.slopePerWeek);
}

// Nächster "schöner" Meilenstein oberhalb des aktuellen Werts.
// Schrittweite: <60 → 5er, sonst 10er.
export function nextMilestone(current) {
  const step = current < 60 ? 5 : 10;
  const next = Math.floor(current / step) * step + step;
  return next;
}

// Fortschritt zum nächsten Meilenstein in Prozent (0–100), bezogen auf den
// vorherigen Meilenstein als Basis.
export function milestoneProgress(current) {
  const step = current < 60 ? 5 : 10;
  const prev = Math.floor(current / step) * step;
  const next = prev + step;
  const pct = Math.max(0, Math.min(100, Math.round(((current - prev) / step) * 100)));
  return { prev, next, pct };
}
