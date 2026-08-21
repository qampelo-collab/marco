// coach.js — nur RELEVANTE Signale: Risiken, Dysbalancen, Fehltraining.
// Bewusst knapp und priorisiert (max. 3 Hinweise), damit Wichtiges nicht
// in generischem Coaching untergeht. Ausgabe: [{type, level, title, text}].

import { progression, weeklyVolumeByCategory } from './calc.js';
import { getLang } from './i18n.js';

const DAY = 24 * 60 * 60 * 1000;
const en = () => getLang() === 'en';
const pick = (de, enStr) => (en() ? enStr : de);

export function buildSuggestions({ enrichedSets, exercises, body, activity, formula = 'epley' }) {
  const cand = []; // {p (Priorität), level, title, text}
  const now = Date.now();
  const byExercise = groupBy(enrichedSets, (s) => s.exerciseId);

  // 1) Dysbalance Push/Pull (Verletzungsrisiko) — letzte 14 Tage (nicht 7:
  //    bei einem Split mit fixen Wochentagen (z.B. Push Di, Pull Do) sieht ein
  //    7-Tage-Fenster mitten in der Woche fast immer "zu wenig X" – die
  //    passende Einheit war schlicht noch nicht dran, nicht vernachlässigt.
  //    14 Tage decken auch mittwochs zuverlässig zwei komplette Zyklen ab.
  const vol = weeklyVolumeByCategory(enrichedSets, 14);
  const push = vol.push || 0, pull = vol.pull || 0, legs = vol.legs || 0;
  if (pull > 0 && push > pull * 1.8) {
    cand.push({ p: 95, level: 'warn',
      title: pick('Dysbalance: zu wenig Pull', 'Imbalance: too little pull'),
      text: pick('In den letzten 2 Wochen deutlich mehr Push- als Pull-Volumen – auf Dauer Schulterrisiko. Mehr Rudern/Klimmzüge.',
        'Much more push than pull volume over the last 2 weeks — shoulder risk over time. Add rows/pull-ups.') });
  } else if (push > 0 && pull > push * 1.8) {
    cand.push({ p: 90, level: 'warn',
      title: pick('Dysbalance: zu wenig Push', 'Imbalance: too little push'),
      text: pick('Pull dominiert klar in den letzten 2 Wochen. Ein zusätzlicher Push-Tag bringt die Balance zurück.',
        'Pull clearly dominates over the last 2 weeks. An extra push day restores balance.') });
  }
  if (push + pull > 0 && legs < (push + pull) * 0.3) {
    cand.push({ p: 70, level: 'tip',
      title: pick('Legs vernachlässigt', 'Legs neglected'),
      text: pick('Bein-Volumen niedrig gegenüber dem Oberkörper (letzte 2 Wochen). Squats/Kreuzheben einplanen.',
        'Leg volume low vs. upper body (last 2 weeks). Add squats/deadlifts.') });
  }

  // 2) Rückgang oder Plateau — nur der auffälligste Lift. Für gewichtsbasierte
  //    Übungen anhand des besten e1RM, für Körpergewichts-Übungen (0 kg, z.B.
  //    Klimmzüge) anhand der Gesamt-Wiederholungen je Einheit.
  const stalls = [];
  for (const [, sets] of byExercise) {
    const prog = progression(sets, formula);
    if (prog.sessions < 4) continue;
    const name = sets[0].exerciseName || pick('Übung', 'exercise');
    const bodyweight = sets.every((s) => !(s.weight > 0)) && sets.some((s) => s.reps > 0);
    let series, unit;
    if (bodyweight) {
      const byDay = new Map();
      for (const s of sets) { if (s.reps > 0 && s.date) byDay.set(s.date, (byDay.get(s.date) || 0) + s.reps); }
      series = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => ({ value: v }));
      unit = pick('Wdh.', 'reps');
    } else {
      series = prog.series;
      unit = 'kg';
    }
    if (series.length < 4) continue;
    const half = Math.floor(series.length / 2);
    const earlierBest = Math.max(...series.slice(0, half).map((p) => p.value));
    const recentBest = Math.max(...series.slice(half).map((p) => p.value));
    if (recentBest < earlierBest - 0.5) {
      stalls.push({ kind: 'regress', name, unit, earlierBest, recentBest, gap: earlierBest - recentBest });
    } else if (recentBest <= earlierBest + 0.5) {
      stalls.push({ kind: 'plateau', name, unit, recentBest, sessions: series.length });
    }
  }
  stalls.sort((a, b) => (b.kind === 'regress') - (a.kind === 'regress') || (b.gap || 0) - (a.gap || 0) || (b.sessions || 0) - (a.sessions || 0));
  if (stalls[0]) {
    const s = stalls[0];
    if (s.kind === 'regress') {
      cand.push({ p: 88, level: 'warn',
        title: pick(`${s.name}: zuletzt schwächer`, `${s.name}: recently weaker`),
        text: pick(`Bestwert von ${s.earlierBest} auf ${s.recentBest} ${s.unit} gefallen. Erholung/Deload prüfen.`,
          `Best dropped from ${s.earlierBest} to ${s.recentBest} ${s.unit}. Check recovery/deload.`) });
    } else {
      cand.push({ p: 72, level: 'tip',
        title: pick(`${s.name}: Plateau`, `${s.name}: plateau`),
        text: pick(`Bestwert seit ${s.sessions} Einheiten bei ~${s.recentBest} ${s.unit}. Deload oder Reiz variieren.`,
          `Best stuck around ${s.recentBest} ${s.unit} for ${s.sessions} sessions. Deload or vary the stimulus.`) });
    }
  }

  // 3) Zuvor regelmäßiger Lift lange nicht trainiert — nur der überfälligste.
  let overdue = null;
  for (const [, sets] of byExercise) {
    if (sets.length < 3) continue;
    const last = [...sets].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    const days = Math.round((now - new Date(last.date).getTime()) / DAY);
    if (days > 14 && (!overdue || days > overdue.days)) overdue = { name: last.exerciseName, days };
  }
  if (overdue) {
    cand.push({ p: 60, level: 'tip',
      title: pick(`${overdue.name} lange nicht trainiert`, `${overdue.name} not trained for a while`),
      text: pick(`Zuletzt vor ${overdue.days} Tagen – wieder einplanen, sonst geht Fortschritt verloren.`,
        `Last done ${overdue.days} days ago — plan it back in before progress fades.`) });
  }

  // Nach Priorität sortieren, nur die Top 3 – der Rest ist Rauschen.
  cand.sort((a, b) => b.p - a.p);
  const top = cand.slice(0, 3).map(({ level, title, text }) => ({ type: 'tip', level, title, text }));

  if (!top.length) {
    return [{ type: 'info', level: 'good',
      title: pick('Alles im grünen Bereich', 'All good'),
      text: pick('Keine Auffälligkeiten – Balance, Frequenz und Progression passen. Weiter so.',
        'Nothing to flag — balance, frequency and progression look solid. Keep it up.') }];
  }
  return top;
}

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) { const k = keyFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
}
