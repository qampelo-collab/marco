// plan.js — Trainingsplan als wiederverwendbare Vorlagen.
// Dein 4er-Split (Push / Legs+Schwachstelle / Pull / Upper #2), auf 45 Min ausgelegt.

export const PLAN = {
  name: '4er-Split · 45 Min',
  days: [
    {
      key: 'push', title: 'Di – Push (~42 Min)', items: [
        { name: 'Bankdrücken',        cat: 'push', scheme: '4×6-8',   rest: '90-120s' },
        { name: 'Schrägbankdrücken',  cat: 'push', scheme: '3×8-10',  rest: '90s', note: 'Kurzhantel' },
        { name: 'Schulterdrücken',    cat: 'push', scheme: '3×8-10',  rest: '90s', note: 'Kurzhantel' },
        { name: 'Seitheben',          cat: 'push', scheme: '2×12-15', rest: '60s' },
        { name: 'Trizepsdrücken',     cat: 'push', scheme: '2×10-12', rest: '60s', note: 'Seilzug' },
      ],
    },
    {
      key: 'legs', title: 'Mi – Legs (reduziert) + Schwachstelle (~40 Min)', items: [
        { name: 'Kniebeugen',              cat: 'legs', scheme: '3×6-8',    rest: '120s' },
        { name: 'Rumänisches Kreuzheben',  cat: 'legs', scheme: '3×8-10',   rest: '90s' },
        { name: 'Seitheben',               cat: 'push', scheme: '2×12-15',  rest: '60s', note: 'Schwachstelle' },
        { name: 'Trizepsdrücken',          cat: 'push', scheme: '2×10-12',  rest: '60s', note: 'Schwachstelle · Seilzug' },
        { name: 'Plank',                   cat: 'core', scheme: '2×45-60s', rest: '45s' },
      ],
    },
    {
      key: 'pull', title: 'Do – Pull (~42 Min)', items: [
        { name: 'Klimmzüge',       cat: 'pull', scheme: '4×max sauber', rest: '90-120s' },
        { name: 'Langhantelrudern', cat: 'pull', scheme: '3×6-8',    rest: '90-120s' },
        { name: 'Seilzugrudern',    cat: 'pull', scheme: '3×10-12',  rest: '90s' },
        { name: 'Face Pulls',       cat: 'pull', scheme: '2×12-15',  rest: '60s' },
        { name: 'Bizepscurls',      cat: 'pull', scheme: '2×8-12',   rest: '60s' },
      ],
    },
    {
      key: 'upper2', title: 'Sa – Upper #2 (~40 Min)', items: [
        { name: 'Schrägbankdrücken', cat: 'push', scheme: '3×10-12',     rest: '90s', note: 'Kurzhantel · höhere Wdh' },
        { name: 'Seilzugrudern',     cat: 'pull', scheme: '3×10-12',     rest: '90s', note: 'enger Griff' },
        { name: 'Ausfallschritte',   cat: 'legs', scheme: '2×10-12/Bein', rest: '90s', note: 'Kurzhantel' },
        { name: 'Hip Thrust',        cat: 'legs', scheme: '2×8-12',      rest: '90s' },
        { name: 'Hammer Curls',      cat: 'pull', scheme: '2×10-12',     rest: '60s', note: 'Superset mit Trizeps-Dips' },
        { name: 'Trizeps-Dips',      cat: 'push', scheme: '2×10-12',     rest: '60s', note: 'Superset mit Hammer Curls' },
      ],
    },
  ],
  // Hauptlifte mit Progressionsfokus
  mainLifts: ['Bankdrücken', 'Kniebeugen', 'Klimmzüge'],
  progressionNote:
    'Fokus auf Bankdrücken, Kniebeugen & Klimmzüge: jede Woche +1 Wdh, +2,5 kg oder sauberere Ausführung. ' +
    'Rest: „irgendwie steigern", solange die drei Hauptlifte laufen.',
  schedule: 'Mo Tennis · Di Push · Mi Legs+Schwachstelle · Do Pull · Fr Laufen · Sa Upper #2 · So Ruhe',
};

// Zielanzahl Sätze aus einem Schema wie "4×6-8" oder "2×45-60s" lesen.
export function parseTargetSets(scheme) {
  const m = /^\s*(\d+)/.exec(scheme || '');
  return m ? parseInt(m[1], 10) : null;
}

// Plan installieren: fehlende Übungen anlegen, Vorlagen (neu) erstellen. Idempotent.
export async function installPlan(db) {
  const existing = await db.all('exercises');
  const byName = new Map(existing.map((e) => [e.name.toLowerCase(), e]));

  async function ensureExercise(name, cat) {
    const key = name.toLowerCase();
    if (byName.has(key)) return byName.get(key).id;
    const id = await db.add('exercises', {
      name, category: cat, equipment: '', unit: name === 'Plank' ? 's' : 'kg',
    });
    byName.set(key, { id, name, category: cat });
    return id;
  }

  // Vorhandene Vorlagen dieses Plans entfernen (Neuaufbau).
  const tpls = await db.all('templates');
  for (const t of tpls) {
    if (t.plan === PLAN.name) await db.delete('templates', t.id);
  }

  for (const day of PLAN.days) {
    const items = [];
    for (const it of day.items) {
      const exerciseId = await ensureExercise(it.name, it.cat);
      items.push({ exerciseId, exerciseName: it.name, scheme: it.scheme, rest: it.rest, note: it.note || null });
    }
    await db.add('templates', { plan: PLAN.name, key: day.key, name: day.title, items });
  }
  await db.setMeta('planV1Installed', true);
}

// Beim ersten Start automatisch installieren.
export async function installPlanIfNeeded(db) {
  const done = await db.getMeta('planV1Installed', false);
  if (!done) await installPlan(db);
}
