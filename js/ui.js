// ui.js — Oberfläche: Router + alle Ansichten.

import { db, exportAll, importAll } from './db.js';
import { e1rm, progression, dayKey, totalVolume, weeklyVolumeByCategory, round1, bestE1rm } from './calc.js';
import { buildSuggestions } from './coach.js';
import { lineChart, barChart } from './charts.js';

const app = document.getElementById('app');
let FORMULA = 'epley';

const CAT_LABEL = { push: 'Drücken', pull: 'Ziehen', legs: 'Beine', core: 'Core', sonstige: 'Sonstige' };
const CAT_COLOR = { push: '#60a5fa', pull: '#f472b6', legs: '#4ade80', core: '#fbbf24', sonstige: '#94a3b8' };

// ---------- kleine DOM-Helfer ----------
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}
function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function fmtDate(s) { return s ? s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4) : ''; }

// ---------- Daten anreichern ----------
async function loadEnrichedSets() {
  const [sets, workouts, exercises] = await Promise.all([
    db.all('sets'), db.all('workouts'), db.all('exercises'),
  ]);
  const wById = new Map(workouts.map((w) => [w.id, w]));
  const eById = new Map(exercises.map((e) => [e.id, e]));
  const enriched = sets.map((s) => {
    const w = wById.get(s.workoutId);
    const ex = eById.get(s.exerciseId);
    return {
      ...s,
      date: w ? w.date : (s.ts ? dayKey(s.ts) : null),
      category: ex ? ex.category : 'sonstige',
      exerciseName: ex ? ex.name : 'Unbekannt',
      unit: ex ? ex.unit : 'kg',
    };
  });
  return { enriched, workouts, exercises };
}

// ==================================================================
//  ROUTER
// ==================================================================
const routes = {
  '': renderDashboard,
  '#dashboard': renderDashboard,
  '#training': renderTraining,
  '#uebungen': renderExercises,
  '#koerper': renderBody,
  '#ernaehrung': renderNutrition,
  '#aktivitaet': renderActivity,
  '#einstellungen': renderSettings,
};

export async function initUI() {
  FORMULA = await db.getMeta('formula', 'epley');
  window.addEventListener('hashchange', route);
  route();
}

async function route() {
  const hash = location.hash.split('?')[0];
  const view = routes[hash] || renderDashboard;
  setActiveNav(hash || '#dashboard');
  clear(app);
  app.appendChild(h('div', { class: 'loading' }, 'Lädt …'));
  try {
    const content = await view();
    clear(app);
    app.appendChild(content);
    window.scrollTo(0, 0);
  } catch (err) {
    clear(app);
    app.appendChild(h('div', { class: 'card error' }, 'Fehler: ' + err.message));
    console.error(err);
  }
}

function setActiveNav(hash) {
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', el.getAttribute('href') === hash);
  });
}

function go(hash) { location.hash = hash; }

// ==================================================================
//  DASHBOARD
// ==================================================================
async function renderDashboard() {
  const { enriched, workouts, exercises } = await loadEnrichedSets();
  const [body, nutrition, activity] = await Promise.all([
    db.all('body'), db.all('nutrition'), db.all('activity'),
  ]);

  const wrap = h('div', { class: 'view' });
  wrap.appendChild(h('h1', {}, 'Übersicht'));

  // KPI-Kacheln
  const thisWeekVol = totalVolume(enriched.filter((s) =>
    s.date && (Date.now() - new Date(s.date).getTime()) < 7 * 864e5));
  const latestBody = [...body].sort((a, b) => b.date.localeCompare(a.date))[0];
  const kpis = h('div', { class: 'kpi-grid' },
    kpi(workouts.length, 'Einheiten'),
    kpi(enriched.length, 'Sätze erfasst'),
    kpi(Math.round(thisWeekVol).toLocaleString('de-DE'), 'kg Volumen (7 T.)'),
    kpi(latestBody ? latestBody.weight + ' kg' : '–', 'Körpergewicht'),
  );
  wrap.appendChild(kpis);

  // Coach-Vorschläge
  const suggestions = buildSuggestions({ enrichedSets: enriched, exercises, body, nutrition, activity, formula: FORMULA });
  const coachCard = h('div', { class: 'card' }, h('h2', {}, '🧠 Coach-Vorschläge'));
  if (suggestions.length === 0) {
    coachCard.appendChild(h('p', { class: 'muted' }, 'Erfasse ein paar Einheiten – dann bekommst du hier passende Tipps.'));
  } else {
    for (const s of suggestions.slice(0, 6)) {
      coachCard.appendChild(h('div', { class: 'suggestion ' + s.level },
        h('div', { class: 'sug-title' }, s.title),
        h('div', { class: 'sug-text' }, s.text),
      ));
    }
  }
  wrap.appendChild(coachCard);

  // Top-Übungen: Progression
  const byExercise = new Map();
  for (const s of enriched) {
    if (!byExercise.has(s.exerciseId)) byExercise.set(s.exerciseId, []);
    byExercise.get(s.exerciseId).push(s);
  }
  const progs = [...byExercise.entries()]
    .map(([id, sets]) => ({ id, name: sets[0].exerciseName, prog: progression(sets, FORMULA) }))
    .filter((p) => p.prog.sessions >= 2)
    .sort((a, b) => b.prog.sessions - a.prog.sessions)
    .slice(0, 3);

  if (progs.length) {
    const card = h('div', { class: 'card' }, h('h2', {}, '📈 Kraftentwicklung (geschätztes 1RM)'));
    for (const p of progs) {
      card.appendChild(h('div', { class: 'chart-block' },
        h('div', { class: 'chart-head' },
          h('span', {}, p.name),
          h('span', { class: p.prog.changeAbs >= 0 ? 'delta up' : 'delta down' },
            (p.prog.changeAbs >= 0 ? '+' : '') + p.prog.changeAbs + ' kg · ' + p.prog.slopePerWeek + ' kg/Wo.'),
        ),
        lineChart(p.prog.series, { color: '#4ade80' }),
      ));
    }
    wrap.appendChild(card);
  }

  // Rekorde (bestes geschätztes 1RM je Übung)
  const records = [...byExercise.entries()]
    .map(([id, sets]) => ({ name: sets[0].exerciseName, ...bestE1rm(sets, FORMULA) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
  if (records.length) {
    const card = h('div', { class: 'card' }, h('h2', {}, '🏆 Rekorde (bestes 1RM)'));
    for (const r of records) {
      card.appendChild(h('div', { class: 'row-item static' },
        h('div', {}, h('strong', {}, r.name),
          r.set ? h('div', { class: 'muted small' }, `${r.set.weight} kg × ${r.set.reps} · ${fmtDate(r.set.date)}`) : null),
        h('span', { class: 'record-val' }, r.value + ' kg'),
      ));
    }
    wrap.appendChild(card);
  }

  // Körpergewicht-Verlauf
  if (body.length >= 2) {
    const series = [...body].sort((a, b) => a.date.localeCompare(b.date))
      .map((b) => ({ date: b.date, value: b.weight }));
    wrap.appendChild(h('div', { class: 'card' },
      h('h2', {}, '⚖️ Körpergewicht'),
      lineChart(series, { color: '#60a5fa' }),
    ));
  }

  wrap.appendChild(h('button', { class: 'fab', onclick: () => go('#training') }, '+ Training erfassen'));
  return wrap;
}

function kpi(value, label) {
  return h('div', { class: 'kpi' }, h('div', { class: 'kpi-val' }, String(value)), h('div', { class: 'kpi-lbl' }, label));
}

// ==================================================================
//  TRAINING ERFASSEN
// ==================================================================
async function renderTraining() {
  const { enriched, workouts: allWorkouts, exercises } = await loadEnrichedSets();
  const workouts = [...allWorkouts].sort((a, b) => b.date.localeCompare(a.date));

  // Zuletzt benutzter Satz einer Übung (für Vorbefüllung).
  const lastSetFor = (exId) => enriched
    .filter((s) => s.exerciseId === exId)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.ts || 0) - (a.ts || 0))[0] || null;

  // aktuelle (offene) Einheit = zuletzt gewählte im Meta, sonst neu über Button
  let currentId = await db.getMeta('currentWorkout', null);
  let current = currentId ? await db.get('workouts', currentId) : null;

  const wrap = h('div', { class: 'view' });
  wrap.appendChild(h('h1', {}, 'Training erfassen'));

  if (!current) {
    const dateInput = h('input', { type: 'date', value: todayStr(), class: 'inp' });
    wrap.appendChild(h('div', { class: 'card' },
      h('h2', {}, 'Neue Einheit starten'),
      h('label', { class: 'field' }, h('span', {}, 'Datum'), dateInput),
      h('button', { class: 'btn primary', onclick: async () => {
        const id = await db.add('workouts', { date: dateInput.value || todayStr(), notes: '' });
        await db.setMeta('currentWorkout', id);
        route();
      } }, 'Einheit starten'),
    ));
    // Vergangene Einheiten
    if (workouts.length) {
      const list = h('div', { class: 'card' }, h('h2', {}, 'Bisherige Einheiten'));
      for (const w of workouts.slice(0, 20)) {
        const sets = await db.byIndex('sets', 'workoutId', w.id);
        list.appendChild(h('div', { class: 'row-item', onclick: async () => {
          await db.setMeta('currentWorkout', w.id); route();
        } },
          h('div', {}, h('strong', {}, fmtDate(w.date)), h('span', { class: 'muted' }, ` · ${sets.length} Sätze`)),
          h('span', { class: 'chev' }, '›'),
        ));
      }
      wrap.appendChild(list);
    }
    return wrap;
  }

  // --- Offene Einheit: Sätze erfassen ---
  const sets = [...await db.byIndex('sets', 'workoutId', current.id)].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const eById = new Map(exercises.map((e) => [e.id, e]));

  const header = h('div', { class: 'card' },
    h('div', { class: 'chart-head' },
      h('h2', {}, 'Einheit vom ' + fmtDate(current.date)),
      h('button', { class: 'btn ghost small', onclick: async () => {
        await db.setMeta('currentWorkout', null); route();
      } }, 'Fertig / schließen'),
    ),
  );
  wrap.appendChild(header);

  // Eingabemaske Satz
  const exSel = h('select', { class: 'inp' },
    ...exercises.map((e) => h('option', { value: e.id }, `${e.name} (${CAT_LABEL[e.category] || e.category})`)));
  const weightInp = h('input', { type: 'number', step: '0.5', inputmode: 'decimal', class: 'inp', placeholder: 'kg' });
  const repsInp = h('input', { type: 'number', step: '1', inputmode: 'numeric', class: 'inp', placeholder: 'Wdh.' });
  const rpeInp = h('input', { type: 'number', step: '0.5', min: '1', max: '10', inputmode: 'decimal', class: 'inp', placeholder: 'RPE (opt.)' });
  const photoInp = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'inp-file' });
  const preview = h('div', { class: 'photo-preview' });
  let photoData = null;
  photoInp.addEventListener('change', async () => {
    const file = photoInp.files[0];
    if (!file) { photoData = null; clear(preview); return; }
    photoData = await downscaleImage(file, 1000, 0.7);
    clear(preview);
    preview.appendChild(h('img', { src: photoData }));
  });

  const e1rmHint = h('div', { class: 'hint' }, '');
  const lastHint = h('div', { class: 'hint last' }, '');
  function updateHint() {
    const v = e1rm(parseFloat(weightInp.value), parseInt(repsInp.value, 10), FORMULA);
    e1rmHint.textContent = v > 0 ? `≈ 1RM: ${round1(v)} kg` : '';
  }
  // Vorbefüllung: zuletzt benutzte Werte + Bestwert-Hinweis für die gewählte Übung.
  function prefillFromLast(overwrite) {
    const exId = parseInt(exSel.value, 10);
    const last = lastSetFor(exId);
    const best = bestE1rm(enriched.filter((s) => s.exerciseId === exId), FORMULA);
    if (last) {
      if (overwrite || !weightInp.value) weightInp.value = last.weight;
      if (overwrite || !repsInp.value) repsInp.value = last.reps;
      lastHint.textContent = `Letztes Mal (${fmtDate(last.date)}): ${last.weight} kg × ${last.reps}` +
        (best.value ? ` · Bestes 1RM: ${best.value} kg` : '');
    } else {
      lastHint.textContent = 'Noch keine Historie für diese Übung.';
    }
    updateHint();
  }
  exSel.addEventListener('change', () => prefillFromLast(true));
  weightInp.addEventListener('input', updateHint);
  repsInp.addEventListener('input', updateHint);

  const form = h('div', { class: 'card' },
    h('h2', {}, 'Satz hinzufügen'),
    h('label', { class: 'field' }, h('span', {}, 'Übung'), exSel),
    lastHint,
    h('div', { class: 'field-row' },
      h('label', { class: 'field' }, h('span', {}, 'Gewicht'), weightInp),
      h('label', { class: 'field' }, h('span', {}, 'Wiederholungen'), repsInp),
      h('label', { class: 'field' }, h('span', {}, 'RPE'), rpeInp),
    ),
    e1rmHint,
    h('label', { class: 'field' }, h('span', {}, '📷 Foto (optional – Display/Beleg)'), photoInp),
    preview,
    h('button', { class: 'btn primary', onclick: async () => {
      const weight = parseFloat(weightInp.value);
      const reps = parseInt(repsInp.value, 10);
      if (!(weight > 0) || !(reps > 0)) { alert('Bitte Gewicht und Wiederholungen eingeben.'); return; }
      const exId = parseInt(exSel.value, 10);
      // Bestwert VOR diesem Satz merken → Rekord-Erkennung.
      const prevBest = bestE1rm(enriched.filter((s) => s.exerciseId === exId), FORMULA).value;
      const newE = round1(e1rm(weight, reps, FORMULA));
      await db.add('sets', {
        workoutId: current.id,
        exerciseId: exId,
        weight, reps,
        rpe: rpeInp.value ? parseFloat(rpeInp.value) : null,
        photo: photoData || null,
        ts: Date.now(),
      });
      if (newE > prevBest && prevBest > 0) {
        const ex = eById.get(exId);
        toast(`🏆 Neuer Rekord bei ${ex ? ex.name : 'Übung'}: ${newE} kg (vorher ${prevBest} kg)`);
      }
      route();
    } }, '+ Satz speichern'),
  );
  wrap.appendChild(form);
  prefillFromLast(false);

  // Liste der Sätze dieser Einheit
  const listCard = h('div', { class: 'card' }, h('h2', {}, `Sätze dieser Einheit (${sets.length})`));
  if (sets.length === 0) {
    listCard.appendChild(h('p', { class: 'muted' }, 'Noch keine Sätze erfasst.'));
  } else {
    for (const s of sets) {
      const ex = eById.get(s.exerciseId);
      listCard.appendChild(h('div', { class: 'set-item' },
        s.photo ? h('img', { class: 'set-thumb', src: s.photo, onclick: () => showPhoto(s.photo) }) : h('div', { class: 'set-thumb empty' }, '—'),
        h('div', { class: 'set-main' },
          h('strong', {}, ex ? ex.name : '?'),
          h('div', { class: 'muted small' }, `${s.weight} kg × ${s.reps}${s.rpe ? ' · RPE ' + s.rpe : ''} · e1RM ${round1(e1rm(s.weight, s.reps, FORMULA))} kg`),
        ),
        h('button', { class: 'btn ghost small danger', onclick: async () => { await db.delete('sets', s.id); route(); } }, '✕'),
      ));
    }
  }
  wrap.appendChild(listCard);
  return wrap;
}

// ==================================================================
//  ÜBUNGEN (Katalog + Detail-Progression)
// ==================================================================
async function renderExercises() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const detailId = params.get('id');
  if (detailId) return renderExerciseDetail(parseInt(detailId, 10));

  const { enriched, exercises } = await loadEnrichedSets();
  const countByEx = new Map();
  for (const s of enriched) countByEx.set(s.exerciseId, (countByEx.get(s.exerciseId) || 0) + 1);

  const wrap = h('div', { class: 'view' });
  wrap.appendChild(h('h1', {}, 'Übungen'));

  // Neue Übung
  const nameInp = h('input', { class: 'inp', placeholder: 'Name der Übung' });
  const catSel = h('select', { class: 'inp' },
    ...Object.entries(CAT_LABEL).map(([v, l]) => h('option', { value: v }, l)));
  const equipInp = h('input', { class: 'inp', placeholder: 'Gerät (z.B. Langhantel)' });
  wrap.appendChild(h('div', { class: 'card' },
    h('h2', {}, 'Neue Übung'),
    h('label', { class: 'field' }, h('span', {}, 'Name'), nameInp),
    h('div', { class: 'field-row' },
      h('label', { class: 'field' }, h('span', {}, 'Kategorie'), catSel),
      h('label', { class: 'field' }, h('span', {}, 'Gerät'), equipInp),
    ),
    h('button', { class: 'btn primary', onclick: async () => {
      if (!nameInp.value.trim()) { alert('Bitte Namen eingeben.'); return; }
      await db.add('exercises', { name: nameInp.value.trim(), category: catSel.value, equipment: equipInp.value.trim(), unit: 'kg' });
      route();
    } }, '+ Übung anlegen'),
  ));

  // Liste
  const byCat = {};
  for (const ex of exercises) { (byCat[ex.category] ||= []).push(ex); }
  for (const [cat, list] of Object.entries(byCat)) {
    const card = h('div', { class: 'card' }, h('h2', { class: 'cat-head' },
      h('span', { class: 'dot', style: `background:${CAT_COLOR[cat] || '#94a3b8'}` }), CAT_LABEL[cat] || cat));
    for (const ex of list.sort((a, b) => a.name.localeCompare(b.name))) {
      const cnt = countByEx.get(ex.id) || 0;
      card.appendChild(h('div', { class: 'row-item', onclick: () => go('#uebungen?id=' + ex.id) },
        h('div', {}, h('strong', {}, ex.name), h('div', { class: 'muted small' }, `${ex.equipment || ''}${cnt ? ' · ' + cnt + ' Sätze' : ' · noch nicht trainiert'}`)),
        h('span', { class: 'chev' }, '›'),
      ));
    }
    wrap.appendChild(card);
  }
  return wrap;
}

async function renderExerciseDetail(id) {
  const ex = await db.get('exercises', id);
  const { enriched } = await loadEnrichedSets();
  const sets = enriched.filter((s) => s.exerciseId === id);
  const prog = progression(sets, FORMULA);

  const wrap = h('div', { class: 'view' });
  wrap.appendChild(h('a', { class: 'back', href: '#uebungen' }, '‹ Zurück zu Übungen'));
  wrap.appendChild(h('h1', {}, ex ? ex.name : 'Übung'));

  if (prog.sessions === 0) {
    wrap.appendChild(h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Noch keine Sätze für diese Übung erfasst.')));
    return wrap;
  }

  wrap.appendChild(h('div', { class: 'kpi-grid' },
    kpi(prog.current + ' kg', 'Aktuelles 1RM'),
    kpi(prog.best + ' kg', 'Bestes 1RM'),
    kpi((prog.changePct >= 0 ? '+' : '') + prog.changePct + '%', 'seit Start'),
    kpi((prog.slopePerWeek >= 0 ? '+' : '') + prog.slopePerWeek, 'kg/Woche'),
  ));

  wrap.appendChild(h('div', { class: 'card' },
    h('h2', {}, '📈 Geschätztes 1RM'),
    lineChart(prog.series, { color: '#4ade80' }),
  ));

  // Volumen-Verlauf
  const volByDay = new Map();
  for (const s of sets) {
    const k = s.date;
    volByDay.set(k, (volByDay.get(k) || 0) + s.weight * s.reps);
  }
  const volSeries = [...volByDay.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
  wrap.appendChild(h('div', { class: 'card' },
    h('h2', {}, '📊 Volumen je Einheit'),
    lineChart(volSeries, { color: '#60a5fa' }),
  ));

  // Historie
  const hist = h('div', { class: 'card' }, h('h2', {}, 'Historie'));
  const sorted = [...sets].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.ts || 0) - (a.ts || 0));
  for (const s of sorted.slice(0, 50)) {
    hist.appendChild(h('div', { class: 'set-item' },
      s.photo ? h('img', { class: 'set-thumb', src: s.photo, onclick: () => showPhoto(s.photo) }) : h('div', { class: 'set-thumb empty' }, '—'),
      h('div', { class: 'set-main' },
        h('strong', {}, `${s.weight} kg × ${s.reps}`),
        h('div', { class: 'muted small' }, `${fmtDate(s.date)} · e1RM ${round1(e1rm(s.weight, s.reps, FORMULA))} kg${s.rpe ? ' · RPE ' + s.rpe : ''}`),
      ),
    ));
  }
  wrap.appendChild(hist);
  return wrap;
}

// ==================================================================
//  KÖRPER (Gewicht + Maße)
// ==================================================================
async function renderBody() {
  const rows = [...await db.all('body')].sort((a, b) => b.date.localeCompare(a.date));
  const wrap = h('div', { class: 'view' });
  wrap.appendChild(h('h1', {}, 'Körper'));

  const dateI = h('input', { type: 'date', value: todayStr(), class: 'inp' });
  const wI = h('input', { type: 'number', step: '0.1', inputmode: 'decimal', class: 'inp', placeholder: 'kg' });
  const chestI = h('input', { type: 'number', step: '0.1', class: 'inp', placeholder: 'cm' });
  const waistI = h('input', { type: 'number', step: '0.1', class: 'inp', placeholder: 'cm' });
  const armI = h('input', { type: 'number', step: '0.1', class: 'inp', placeholder: 'cm' });
  const thighI = h('input', { type: 'number', step: '0.1', class: 'inp', placeholder: 'cm' });

  wrap.appendChild(h('div', { class: 'card' },
    h('h2', {}, 'Neuer Eintrag'),
    h('label', { class: 'field' }, h('span', {}, 'Datum'), dateI),
    h('label', { class: 'field' }, h('span', {}, 'Körpergewicht (kg)'), wI),
    h('div', { class: 'field-row' },
      h('label', { class: 'field' }, h('span', {}, 'Brust'), chestI),
      h('label', { class: 'field' }, h('span', {}, 'Taille'), waistI),
    ),
    h('div', { class: 'field-row' },
      h('label', { class: 'field' }, h('span', {}, 'Arm'), armI),
      h('label', { class: 'field' }, h('span', {}, 'Oberschenkel'), thighI),
    ),
    h('button', { class: 'btn primary', onclick: async () => {
      const weight = parseFloat(wI.value);
      if (!(weight > 0) && !chestI.value && !waistI.value) { alert('Bitte mindestens einen Wert eingeben.'); return; }
      await db.add('body', {
        date: dateI.value || todayStr(),
        weight: weight || null,
        chest: num(chestI.value), waist: num(waistI.value), arm: num(armI.value), thigh: num(thighI.value),
      });
      route();
    } }, '+ Speichern'),
  ));

  if (rows.length >= 2) {
    const series = [...rows].reverse().filter((r) => r.weight).map((r) => ({ date: r.date, value: r.weight }));
    if (series.length >= 2) wrap.appendChild(h('div', { class: 'card' }, h('h2', {}, '⚖️ Gewichtsverlauf'), lineChart(series, { color: '#60a5fa' })));
  }

  const list = h('div', { class: 'card' }, h('h2', {}, 'Einträge'));
  if (!rows.length) list.appendChild(h('p', { class: 'muted' }, 'Noch keine Einträge.'));
  for (const r of rows.slice(0, 40)) {
    const parts = [r.weight ? r.weight + ' kg' : null, r.chest ? 'Brust ' + r.chest : null,
      r.waist ? 'Taille ' + r.waist : null, r.arm ? 'Arm ' + r.arm : null, r.thigh ? 'OSchenkel ' + r.thigh : null].filter(Boolean);
    list.appendChild(h('div', { class: 'set-item' },
      h('div', { class: 'set-main' }, h('strong', {}, fmtDate(r.date)), h('div', { class: 'muted small' }, parts.join(' · '))),
      h('button', { class: 'btn ghost small danger', onclick: async () => { await db.delete('body', r.id); route(); } }, '✕'),
    ));
  }
  wrap.appendChild(list);
  return wrap;
}

// ==================================================================
//  ERNÄHRUNG (Protein / Kalorien)
// ==================================================================
async function renderNutrition() {
  const rows = [...await db.all('nutrition')].sort((a, b) => b.date.localeCompare(a.date));
  const wrap = h('div', { class: 'view' });
  wrap.appendChild(h('h1', {}, 'Ernährung'));

  const dateI = h('input', { type: 'date', value: todayStr(), class: 'inp' });
  const protI = h('input', { type: 'number', step: '1', inputmode: 'numeric', class: 'inp', placeholder: 'g' });
  const kcalI = h('input', { type: 'number', step: '1', inputmode: 'numeric', class: 'inp', placeholder: 'kcal' });
  const noteI = h('input', { class: 'inp', placeholder: 'Notiz (optional)' });

  wrap.appendChild(h('div', { class: 'card' },
    h('h2', {}, 'Neuer Eintrag'),
    h('label', { class: 'field' }, h('span', {}, 'Datum'), dateI),
    h('div', { class: 'field-row' },
      h('label', { class: 'field' }, h('span', {}, 'Protein (g)'), protI),
      h('label', { class: 'field' }, h('span', {}, 'Kalorien'), kcalI),
    ),
    h('label', { class: 'field' }, h('span', {}, 'Notiz'), noteI),
    h('button', { class: 'btn primary', onclick: async () => {
      if (!protI.value && !kcalI.value) { alert('Bitte Protein oder Kalorien eingeben.'); return; }
      await db.add('nutrition', { date: dateI.value || todayStr(), protein: num(protI.value), calories: num(kcalI.value), notes: noteI.value.trim() });
      route();
    } }, '+ Speichern'),
  ));

  if (rows.length >= 2) {
    const series = [...rows].reverse().filter((r) => r.protein).map((r) => ({ date: r.date, value: r.protein }));
    if (series.length >= 2) wrap.appendChild(h('div', { class: 'card' }, h('h2', {}, '🥩 Protein-Verlauf (g/Tag)'), lineChart(series, { color: '#f472b6' })));
  }

  const list = h('div', { class: 'card' }, h('h2', {}, 'Einträge'));
  if (!rows.length) list.appendChild(h('p', { class: 'muted' }, 'Noch keine Einträge.'));
  for (const r of rows.slice(0, 40)) {
    const parts = [r.protein ? r.protein + ' g Protein' : null, r.calories ? r.calories + ' kcal' : null, r.notes || null].filter(Boolean);
    list.appendChild(h('div', { class: 'set-item' },
      h('div', { class: 'set-main' }, h('strong', {}, fmtDate(r.date)), h('div', { class: 'muted small' }, parts.join(' · '))),
      h('button', { class: 'btn ghost small danger', onclick: async () => { await db.delete('nutrition', r.id); route(); } }, '✕'),
    ));
  }
  wrap.appendChild(list);
  return wrap;
}

// ==================================================================
//  AKTIVITÄT (Schritte)
// ==================================================================
async function renderActivity() {
  const rows = [...await db.all('activity')].sort((a, b) => b.date.localeCompare(a.date));
  const wrap = h('div', { class: 'view' });
  wrap.appendChild(h('h1', {}, 'Aktivität'));

  const dateI = h('input', { type: 'date', value: todayStr(), class: 'inp' });
  const stepI = h('input', { type: 'number', step: '100', inputmode: 'numeric', class: 'inp', placeholder: 'Schritte' });

  wrap.appendChild(h('div', { class: 'card' },
    h('h2', {}, 'Neuer Eintrag'),
    h('label', { class: 'field' }, h('span', {}, 'Datum'), dateI),
    h('label', { class: 'field' }, h('span', {}, 'Schritte'), stepI),
    h('button', { class: 'btn primary', onclick: async () => {
      if (!stepI.value) { alert('Bitte Schritte eingeben.'); return; }
      await db.add('activity', { date: dateI.value || todayStr(), steps: num(stepI.value) });
      route();
    } }, '+ Speichern'),
  ));

  if (rows.length >= 2) {
    const series = [...rows].reverse().map((r) => ({ date: r.date, value: r.steps }));
    wrap.appendChild(h('div', { class: 'card' }, h('h2', {}, '👟 Schritte-Verlauf'), lineChart(series, { color: '#fbbf24' })));
  }

  const list = h('div', { class: 'card' }, h('h2', {}, 'Einträge'));
  if (!rows.length) list.appendChild(h('p', { class: 'muted' }, 'Noch keine Einträge.'));
  for (const r of rows.slice(0, 40)) {
    list.appendChild(h('div', { class: 'set-item' },
      h('div', { class: 'set-main' }, h('strong', {}, fmtDate(r.date)), h('div', { class: 'muted small' }, r.steps.toLocaleString('de-DE') + ' Schritte')),
      h('button', { class: 'btn ghost small danger', onclick: async () => { await db.delete('activity', r.id); route(); } }, '✕'),
    ));
  }
  wrap.appendChild(list);
  return wrap;
}

// ==================================================================
//  EINSTELLUNGEN / BACKUP
// ==================================================================
async function renderSettings() {
  const wrap = h('div', { class: 'view' });
  wrap.appendChild(h('h1', {}, 'Mehr'));

  // Weitere Bereiche
  wrap.appendChild(h('div', { class: 'card' },
    h('h2', {}, 'Tracking'),
    h('div', { class: 'row-item', onclick: () => go('#ernaehrung') },
      h('div', {}, h('strong', {}, '🥩 Ernährung'), h('div', { class: 'muted small' }, 'Protein & Kalorien erfassen')),
      h('span', { class: 'chev' }, '›')),
    h('div', { class: 'row-item', onclick: () => go('#aktivitaet') },
      h('div', {}, h('strong', {}, '👟 Aktivität'), h('div', { class: 'muted small' }, 'Schritte erfassen')),
      h('span', { class: 'chev' }, '›')),
  ));

  // 1RM-Formel
  const formulaSel = h('select', { class: 'inp' },
    h('option', { value: 'epley', ...(FORMULA === 'epley' ? { selected: '' } : {}) }, 'Epley (Standard)'),
    h('option', { value: 'brzycki', ...(FORMULA === 'brzycki' ? { selected: '' } : {}) }, 'Brzycki'),
  );
  formulaSel.addEventListener('change', async () => {
    FORMULA = formulaSel.value;
    await db.setMeta('formula', FORMULA);
  });
  wrap.appendChild(h('div', { class: 'card' },
    h('h2', {}, '1RM-Formel'),
    h('p', { class: 'muted small' }, 'Formel zur Schätzung deiner Maximalkraft.'),
    formulaSel,
  ));

  // Backup
  wrap.appendChild(h('div', { class: 'card' },
    h('h2', {}, 'Backup'),
    h('p', { class: 'muted small' }, 'Alle Daten liegen lokal auf diesem Gerät. Sichere sie regelmäßig als Datei.'),
    h('button', { class: 'btn primary', onclick: exportBackup }, '⬇ Backup exportieren (JSON)'),
    h('label', { class: 'btn ghost file-btn' }, '⬆ Backup importieren',
      h('input', { type: 'file', accept: 'application/json', style: 'display:none', onchange: importBackup })),
  ));

  // Gefahrenzone
  wrap.appendChild(h('div', { class: 'card' },
    h('h2', {}, 'Zurücksetzen'),
    h('button', { class: 'btn ghost danger', onclick: async () => {
      if (confirm('Wirklich ALLE Daten löschen? Vorher am besten ein Backup machen.')) {
        for (const s of ['exercises', 'workouts', 'sets', 'body', 'nutrition', 'activity']) await db.clear(s);
        await db.setMeta('currentWorkout', null);
        location.hash = '#dashboard'; route();
      }
    } }, 'Alle Daten löschen'),
  ));

  wrap.appendChild(h('p', { class: 'muted small center' }, 'Kraft-Tracker · lokal & offline · v1.0'));
  return wrap;
}

async function exportBackup() {
  const dump = await exportAll();
  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `kraft-tracker-backup-${todayStr()}.json` });
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

async function importBackup(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!confirm('Import ersetzt die aktuellen Daten. Fortfahren?')) return;
  try {
    const text = await file.text();
    await importAll(JSON.parse(text), { replace: true });
    alert('Backup importiert.');
    location.hash = '#dashboard'; route();
  } catch (err) {
    alert('Import fehlgeschlagen: ' + err.message);
  }
}

// ==================================================================
//  Hilfsfunktionen: Foto & Bild
// ==================================================================
function num(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }

function showPhoto(src) {
  const overlay = h('div', { class: 'overlay', onclick: () => overlay.remove() }, h('img', { src }));
  document.body.appendChild(overlay);
}

// Kurze Einblendung (z.B. bei neuem Rekord).
function toast(msg) {
  const t = h('div', { class: 'toast' }, msg);
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3800);
}

// Foto verkleinern, damit die lokale DB nicht überläuft.
function downscaleImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) { height = height * maxDim / width; width = maxDim; }
        else if (height > maxDim) { width = width * maxDim / height; height = maxDim; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
