// coach.js — Regelbasierte Vorschläge ("was ergänzt dein Training sinnvoll?").
// Ausgabe: Liste von {type, level, title, text}. level: 'info' | 'tip' | 'warn' | 'good'
// Bewusst einfach & transparent gehalten – Regeln lassen sich leicht erweitern.

import { progression, weeklyVolumeByCategory, dayKey } from './calc.js';

const DAY = 24 * 60 * 60 * 1000;

// enrichedSets: Sätze inkl. .date, .weight, .reps, .exerciseId, .category, .exerciseName
export function buildSuggestions({ enrichedSets, exercises, body, nutrition, activity, formula = 'epley' }) {
  const out = [];
  const now = Date.now();

  // 1) Plateau-Erkennung je Übung (>=4 Einheiten, Trend flach/negativ)
  const byExercise = groupBy(enrichedSets, (s) => s.exerciseId);
  for (const [exId, sets] of byExercise) {
    const prog = progression(sets, formula);
    if (prog.sessions >= 4 && prog.slopePerWeek <= 0.05) {
      const name = sets[0].exerciseName || 'Übung';
      out.push({
        type: 'plateau', level: 'warn',
        title: `Plateau bei ${name}?`,
        text: `Dein geschätztes 1RM stagniert (Trend ${prog.slopePerWeek} kg/Woche über ${prog.sessions} Einheiten). ` +
              `Idee: Deload-Woche, Variation der Übung oder Wiederholungsbereich wechseln.`,
      });
    } else if (prog.sessions >= 3 && prog.slopePerWeek > 0.3) {
      const name = sets[0].exerciseName || 'Übung';
      out.push({
        type: 'progress', level: 'good',
        title: `Starke Entwicklung: ${name}`,
        text: `+${prog.slopePerWeek} kg/Woche im e1RM-Trend. Weiter so – ggf. Gewicht leicht erhöhen.`,
      });
    }
  }

  // 2) Progressive Overload: letzte Einheit einer Übung mit hohen Wdh -> Gewicht hoch
  for (const [exId, sets] of byExercise) {
    const sorted = [...sets].sort((a, b) => new Date(b.date) - new Date(a.date));
    const last = sorted[0];
    if (last && last.reps >= 12 && last.weight > 0) {
      out.push({
        type: 'overload', level: 'tip',
        title: `Mehr Gewicht bei ${last.exerciseName}?`,
        text: `Zuletzt ${last.reps} Wdh. bei ${last.weight} kg geschafft. ` +
              `Wenn die Form sauber war: nächstes Mal ~2,5–5 % mehr Gewicht, dafür weniger Wdh.`,
      });
    }
  }

  // 3) Muskelgruppen-Balance (Wochen-Volumen Push/Pull/Beine)
  const vol = weeklyVolumeByCategory(enrichedSets, 7);
  const push = vol.push || 0, pull = vol.pull || 0, legs = vol.legs || 0;
  if (push + pull + legs > 0) {
    if (pull > 0 && push > pull * 1.8) {
      out.push({ type: 'balance', level: 'tip', title: 'Balance: mehr Ziehen',
        text: 'Diese Woche deutlich mehr Druck- als Zugvolumen. Für gesunde Schultern: mehr Rudern/Klimmzüge einplanen.' });
    }
    if (push > 0 && pull > push * 1.8) {
      out.push({ type: 'balance', level: 'tip', title: 'Balance: mehr Drücken',
        text: 'Zugvolumen dominiert. Ein zusätzlicher Druck-Tag (Bank/Schulter) bringt die Balance zurück.' });
    }
    if (legs < (push + pull) * 0.3) {
      out.push({ type: 'balance', level: 'tip', title: 'Beine nicht vergessen',
        text: 'Beinvolumen ist gering im Vergleich zum Oberkörper. Kniebeugen/Kreuzheben/Beinpresse ergänzen.' });
    }
  }

  // 4) Protein pro kg Körpergewicht
  const latestBody = latestBy(body, 'date');
  const latestNut = latestBy(nutrition, 'date');
  if (latestBody?.weight && latestNut?.protein) {
    const perKg = latestNut.protein / latestBody.weight;
    if (perKg < 1.6) {
      out.push({ type: 'protein', level: 'tip', title: 'Mehr Protein für Muskelaufbau',
        text: `Zuletzt ${Math.round(perKg * 100) / 100} g Protein/kg. Für Muskelaufbau werden oft 1,6–2,2 g/kg empfohlen ` +
              `(≈ ${Math.round(latestBody.weight * 1.6)}–${Math.round(latestBody.weight * 2.2)} g/Tag bei ${latestBody.weight} kg).` });
    } else {
      out.push({ type: 'protein', level: 'good', title: 'Proteinzufuhr im Zielbereich',
        text: `${Math.round(perKg * 100) / 100} g/kg – solide Basis für Muskelaufbau.` });
    }
  }

  // 5) Schritte / NEAT
  const recentSteps = (activity || [])
    .filter((a) => a.steps > 0 && (now - new Date(a.date).getTime()) < 7 * DAY)
    .map((a) => a.steps);
  if (recentSteps.length) {
    const avg = Math.round(recentSteps.reduce((a, b) => a + b, 0) / recentSteps.length);
    if (avg < 7000) {
      out.push({ type: 'steps', level: 'tip', title: 'Mehr Alltagsbewegung',
        text: `Ø ${avg.toLocaleString('de-DE')} Schritte/Tag. Ein Ziel um 8.000–10.000 unterstützt Regeneration und Kaloriendefizit.` });
    }
  }

  // 6) Trainingsfrequenz: Übung lange nicht mehr trainiert
  for (const [exId, sets] of byExercise) {
    const sorted = [...sets].sort((a, b) => new Date(b.date) - new Date(a.date));
    const last = sorted[0];
    const daysAgo = (now - new Date(last.date).getTime()) / DAY;
    if (daysAgo > 14) {
      out.push({ type: 'frequency', level: 'info', title: `${last.exerciseName} länger nicht trainiert`,
        text: `Zuletzt vor ${Math.round(daysAgo)} Tagen. Wieder einplanen, um den Fortschritt zu halten.` });
    }
  }

  // 7) Körpergewichts-Frage, wenn lange kein Eintrag
  if (!latestBody || (now - new Date(latestBody.date).getTime()) > 7 * DAY) {
    out.push({ type: 'body', level: 'info', title: 'Körpergewicht aktualisieren?',
      text: 'Länger kein Gewicht/Maß eingetragen. Ein wöchentlicher Wert macht Trends aussagekräftiger.' });
  }

  // Priorisieren: warn > tip > good > info
  const order = { warn: 0, tip: 1, good: 2, info: 3 };
  out.sort((a, b) => order[a.level] - order[b.level]);
  return out;
}

function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

function latestBy(arr, field) {
  if (!arr || !arr.length) return null;
  return [...arr].sort((a, b) => new Date(b[field]) - new Date(a[field]))[0];
}
