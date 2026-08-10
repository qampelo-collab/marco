// coach.js — Regelbasierte Vorschläge ("was ergänzt dein Training sinnvoll?").
// Ausgabe: Liste von {type, level, title, text}. level: 'info' | 'tip' | 'warn' | 'good'

import { progression, weeklyVolumeByCategory, dayKey, round1 } from './calc.js';
import { getLang } from './i18n.js';

const DAY = 24 * 60 * 60 * 1000;
const en = () => getLang() === 'en';
const pick = (de, enStr) => (en() ? enStr : de);

export function buildSuggestions({ enrichedSets, exercises, body, nutrition, activity, formula = 'epley' }) {
  const out = [];
  const now = Date.now();

  // 1) Fortschritt / Plateau je Übung.
  // Beurteilt wird das BESTE geschätzte 1RM in der jüngeren vs. der früheren
  // Trainingshälfte. Das ist robuster als eine einzelne Trendlinie, die bei
  // wechselnden Wiederholungsbereichen/Trainingsblöcken fälschlich flach
  // wirken kann, obwohl die Höchstleistung klar gestiegen ist.
  const byExercise = groupBy(enrichedSets, (s) => s.exerciseId);
  for (const [exId, sets] of byExercise) {
    const prog = progression(sets, formula);
    if (prog.sessions < 4) continue;                 // erst ab genug Historie beurteilen
    const name = sets[0].exerciseName || pick('Übung', 'exercise');
    const series = prog.series;                       // pro Tag bestes e1RM, aufsteigend
    const half = Math.floor(series.length / 2);
    const earlierBest = Math.max(...series.slice(0, half).map((p) => p.value));
    const recentBest = Math.max(...series.slice(half).map((p) => p.value));
    const gain = round1(recentBest - earlierBest);

    if (recentBest > earlierBest + 0.5) {             // Höchstleistung gestiegen → Fortschritt
      out.push({ type: 'progress', level: 'good',
        title: pick(`Fortschritt: ${name}`, `Progress: ${name}`),
        text: pick(
          `Dein bestes geschätztes 1RM ist von ${earlierBest} auf ${recentBest} kg gestiegen (+${gain} kg). Weiter so – Gewicht/Wdh. Schritt für Schritt steigern.`,
          `Your best estimated 1RM rose from ${earlierBest} to ${recentBest} kg (+${gain} kg). Keep it up — add weight/reps step by step.`),
      });
    } else if (recentBest < earlierBest - 0.5) {      // zuletzt schwächer als früher
      out.push({ type: 'regress', level: 'tip',
        title: pick(`${name}: zuletzt schwächer`, `${name}: recently weaker`),
        text: pick(
          `Bestes e1RM zuletzt ${recentBest} kg gegenüber ${earlierBest} kg früher (${gain} kg). ` +
          `Oft nur Tagesform/Erholung – im Blick behalten, ggf. Schlaf/Ernährung/Deload prüfen.`,
          `Best e1RM recently ${recentBest} kg vs ${earlierBest} kg earlier (${gain} kg). ` +
          `Often just recovery/day-to-day — keep an eye on it, check sleep/nutrition/deload.`),
      });
    } else {                                          // Höchstleistung stagniert → echtes Plateau
      out.push({ type: 'plateau', level: 'warn',
        title: pick(`Plateau bei ${name}?`, `Plateau on ${name}?`),
        text: pick(
          `Dein bestes geschätztes 1RM bewegt sich seit ${prog.sessions} Einheiten um ${recentBest} kg. ` +
          `Idee: Deload-Woche, Variation der Übung oder Wiederholungsbereich wechseln.`,
          `Your best estimated 1RM has hovered around ${recentBest} kg for ${prog.sessions} sessions. ` +
          `Idea: a deload week, an exercise variation, or switch the rep range.`),
      });
    }
  }

  // 2) Progressive Overload
  for (const [exId, sets] of byExercise) {
    const sorted = [...sets].sort((a, b) => new Date(b.date) - new Date(a.date));
    const last = sorted[0];
    if (last && last.reps >= 12 && last.weight > 0) {
      out.push({ type: 'overload', level: 'tip',
        title: pick(`Mehr Gewicht bei ${last.exerciseName}?`, `More weight on ${last.exerciseName}?`),
        text: pick(
          `Zuletzt ${last.reps} Wdh. bei ${last.weight} kg geschafft. ` +
          `Wenn die Form sauber war: nächstes Mal ~2,5–5 % mehr Gewicht, dafür weniger Wdh.`,
          `Last time you did ${last.reps} reps at ${last.weight} kg. ` +
          `If your form was clean: next time ~2.5–5% more weight and fewer reps.`),
      });
    }
  }

  // 3) Muskelgruppen-Balance
  const vol = weeklyVolumeByCategory(enrichedSets, 7);
  const push = vol.push || 0, pull = vol.pull || 0, legs = vol.legs || 0;
  if (push + pull + legs > 0) {
    if (pull > 0 && push > pull * 1.8) {
      out.push({ type: 'balance', level: 'tip',
        title: pick('Balance: mehr Ziehen', 'Balance: more pulling'),
        text: pick(
          'Diese Woche deutlich mehr Druck- als Zugvolumen. Für gesunde Schultern: mehr Rudern/Klimmzüge einplanen.',
          'Much more pushing than pulling volume this week. For healthy shoulders: add more rows/pull-ups.') });
    }
    if (push > 0 && pull > push * 1.8) {
      out.push({ type: 'balance', level: 'tip',
        title: pick('Balance: mehr Drücken', 'Balance: more pushing'),
        text: pick(
          'Zugvolumen dominiert. Ein zusätzlicher Druck-Tag (Bank/Schulter) bringt die Balance zurück.',
          'Pulling volume dominates. An extra push day (bench/shoulders) restores the balance.') });
    }
    if (legs < (push + pull) * 0.3) {
      out.push({ type: 'balance', level: 'tip',
        title: pick('Beine nicht vergessen', 'Don’t forget legs'),
        text: pick(
          'Beinvolumen ist gering im Vergleich zum Oberkörper. Kniebeugen/Kreuzheben/Beinpresse ergänzen.',
          'Leg volume is low compared to upper body. Add squats/deadlifts/leg press.') });
    }
  }

  // 4) Protein pro kg Körpergewicht
  const latestBody = latestBy(body, 'date');
  const latestNut = latestBy(nutrition, 'date');
  if (latestBody?.weight && latestNut?.protein) {
    const perKg = Math.round((latestNut.protein / latestBody.weight) * 100) / 100;
    if (perKg < 1.6) {
      const lo = Math.round(latestBody.weight * 1.6), hi = Math.round(latestBody.weight * 2.2);
      out.push({ type: 'protein', level: 'tip',
        title: pick('Mehr Protein für Muskelaufbau', 'More protein for muscle growth'),
        text: pick(
          `Zuletzt ${perKg} g Protein/kg. Für Muskelaufbau werden oft 1,6–2,2 g/kg empfohlen ` +
          `(≈ ${lo}–${hi} g/Tag bei ${latestBody.weight} kg).`,
          `Last ${perKg} g protein/kg. For muscle growth 1.6–2.2 g/kg is often recommended ` +
          `(≈ ${lo}–${hi} g/day at ${latestBody.weight} kg).`) });
    } else {
      out.push({ type: 'protein', level: 'good',
        title: pick('Proteinzufuhr im Zielbereich', 'Protein intake on target'),
        text: pick(`${perKg} g/kg – solide Basis für Muskelaufbau.`,
                   `${perKg} g/kg — a solid base for muscle growth.`) });
    }
  }

  // 5) Schritte / NEAT
  const recentSteps = (activity || [])
    .filter((a) => a.steps > 0 && (now - new Date(a.date).getTime()) < 7 * DAY)
    .map((a) => a.steps);
  if (recentSteps.length) {
    const avg = Math.round(recentSteps.reduce((a, b) => a + b, 0) / recentSteps.length);
    if (avg < 7000) {
      out.push({ type: 'steps', level: 'tip',
        title: pick('Mehr Alltagsbewegung', 'More daily movement'),
        text: pick(
          `Ø ${avg.toLocaleString('de-DE')} Schritte/Tag. Ein Ziel um 8.000–10.000 unterstützt Regeneration und Kaloriendefizit.`,
          `Avg ${avg.toLocaleString('en-US')} steps/day. A target around 8,000–10,000 supports recovery and a calorie deficit.`) });
    }
  }

  // 6) Trainingsfrequenz
  for (const [exId, sets] of byExercise) {
    const sorted = [...sets].sort((a, b) => new Date(b.date) - new Date(a.date));
    const last = sorted[0];
    const daysAgo = Math.round((now - new Date(last.date).getTime()) / DAY);
    if (daysAgo > 14) {
      out.push({ type: 'frequency', level: 'info',
        title: pick(`${last.exerciseName} länger nicht trainiert`, `${last.exerciseName} not trained for a while`),
        text: pick(
          `Zuletzt vor ${daysAgo} Tagen. Wieder einplanen, um den Fortschritt zu halten.`,
          `Last done ${daysAgo} days ago. Plan it back in to keep your progress.`) });
    }
  }

  // 7) Körpergewicht aktualisieren
  if (!latestBody || (now - new Date(latestBody.date).getTime()) > 7 * DAY) {
    out.push({ type: 'body', level: 'info',
      title: pick('Körpergewicht aktualisieren?', 'Update body weight?'),
      text: pick(
        'Länger kein Gewicht/Maß eingetragen. Ein wöchentlicher Wert macht Trends aussagekräftiger.',
        'No weight/measurement logged for a while. A weekly value makes trends more meaningful.') });
  }

  const order = { warn: 0, tip: 1, good: 2, info: 3 };
  out.sort((a, b) => order[a.level] - order[b.level]);
  return out;
}

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) { const k = keyFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
}
function latestBy(arr, field) {
  if (!arr || !arr.length) return null;
  return [...arr].sort((a, b) => new Date(b[field]) - new Date(a[field]))[0];
}
