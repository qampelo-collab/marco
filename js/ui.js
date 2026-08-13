// ui.js — Oberfläche: Router + alle Ansichten.

import { db, exportAll, importAll } from './db.js';
import { e1rm, progression, dayKey, round1, bestE1rm, navyBodyFat, weightForReps, roundToStep } from './calc.js';
import { buildSuggestions } from './coach.js';
import { lineChart, barChart, progressRing } from './charts.js';
import { extractSetsFromImage, VISION_MODELS, DEFAULT_VISION_MODEL } from './vision.js';
import { PLAN, installPlan, parseTargetSets } from './plan.js';
import { applyTheme, ACCENTS, DEFAULT_ACCENT, DEFAULT_THEME, THEME_MODES } from './theme.js';
import { applyI18n, getLang, setLang, detectLang, L } from './i18n.js';
import { startRest, unlockAudio, setRestDoneCallback } from './timer.js';
import { forecastValue, weeksToTarget, milestoneProgress, nextMilestone } from './forecast.js';
import { parseRestSeconds } from './calc.js';

const app = document.getElementById('app');
let FORMULA = 'epley';

// App-Version — muss mit dem CACHE-Namen in sw.js übereinstimmen.
// Wird unter „Mehr" angezeigt, damit man sieht, ob die neueste Version läuft.
const APP_VERSION = 'v64';

const CAT_LABEL = { push: 'Push', pull: 'Pull', legs: 'Legs', core: 'Core', sonstige: 'Sonstige' };
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
// Bestehenden Wert bei Fokus markieren: ein Tipp aufs Feld zeigt den aktuellen
// Stand und das nächste Tippen ersetzt ihn direkt, ohne ihn erst löschen zu müssen.
function selectOnFocus(input) { input.addEventListener('focus', () => input.select()); return input; }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function fmtDate(s) { return s ? s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4) : ''; }
// Sekunden als Chip-Beschriftung: "30s", "1:30".
function fmtSec(sec) { return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }

const MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Monatsüberschrift aus "YYYY-MM" (z.B. "August 2026").
function monthLabel(ym) {
  const [y, m] = ym.split('-');
  const names = getLang() === 'en' ? MONTHS_EN : MONTHS_DE;
  return `${names[parseInt(m, 10) - 1]} ${y}`;
}

// ---- Wochen-Helfer (Woche = Montag–Sonntag) ----
// Montag der Woche von `d` (Date oder "YYYY-MM-DD"), auf Mitternacht gesetzt.
function mondayOf(d) {
  const dt = new Date(typeof d === 'string' ? d + 'T00:00:00' : d);
  const shift = (dt.getDay() + 6) % 7; // Mo=0 ... So=6
  dt.setDate(dt.getDate() - shift);
  dt.setHours(0, 0, 0, 0);
  return dt;
}
function weekKey(d) { return mondayOf(d).toISOString().slice(0, 10); }

// Trainings-Streak: aufeinanderfolgende Wochen (rückwärts ab der letzten
// abgeschlossenen Woche), in denen mind. `goal` unterschiedliche Trainingstage
// erreicht wurden. Die laufende Woche zählt nur mit, wenn sie das Ziel schon
// erreicht hat (sie ist ja noch nicht vorbei, kann die Serie also nicht brechen).
function computeStreak(dateStrings, goal) {
  const byWeek = new Map(); // weekKey -> Set(date)
  for (const d of dateStrings) {
    if (!d) continue;
    const k = weekKey(d);
    if (!byWeek.has(k)) byWeek.set(k, new Set());
    byWeek.get(k).add(d);
  }
  const curKey = weekKey(new Date());
  const curCount = byWeek.get(curKey)?.size || 0;
  let streak = 0;
  const cursor = mondayOf(new Date());
  for (;;) {
    cursor.setDate(cursor.getDate() - 7);
    const k = cursor.toISOString().slice(0, 10);
    const cnt = byWeek.get(k)?.size || 0;
    if (cnt >= goal) streak++; else break;
  }
  const curMet = goal > 0 && curCount >= goal;
  return { streak: curMet ? streak + 1 : streak, curCount, curMet };
}

// Bewegtes Gesamtgewicht (kg) je Woche für die letzten `weeks` Wochen
// (inkl. laufender Woche), als Balkendiagramm-Daten [{label, value}].
function weeklyTonnageSeries(enrichedSets, weeks = 10) {
  const start = mondayOf(new Date());
  const buckets = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(start); d.setDate(d.getDate() - i * 7);
    buckets.push({ key: d.toISOString().slice(0, 10), label: `${d.getDate()}.${d.getMonth() + 1}.`, value: 0 });
  }
  const idx = new Map(buckets.map((b, i) => [b.key, i]));
  for (const s of enrichedSets) {
    if (!s.date) continue;
    const i = idx.get(weekKey(s.date));
    if (i != null) buckets[i].value += (s.weight || 0) * (s.reps || 0);
  }
  return buckets.map((b) => ({ label: b.label, value: Math.round(b.value) }));
}

// Durchschnittliches Körpergewicht je Woche, gleicher 10-Wochen-Zeitraum wie
// weeklyTonnageSeries (gleiche Wochen-Buckets) – zum direkten Vergleich, ob
// das bewegte Gewicht trotz sinkendem Körpergewicht (Cut) weiter steigt.
// Wochen ohne Eintrag übernehmen den letzten bekannten Wert (Fortschreibung);
// Wochen vor dem allerersten Eintrag bleiben leer.
function weeklyBodyweightSeries(bodyRows, weeks = 10) {
  if (!bodyRows.length) return [];
  const start = mondayOf(new Date());
  const buckets = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(start); d.setDate(d.getDate() - i * 7);
    buckets.push({ key: d.toISOString().slice(0, 10), sum: 0, n: 0 });
  }
  const idx = new Map(buckets.map((b, i) => [b.key, i]));
  for (const r of bodyRows) {
    if (!r.date || !(r.weight > 0)) continue;
    const i = idx.get(weekKey(r.date));
    if (i != null) { buckets[i].sum += r.weight; buckets[i].n += 1; }
  }
  let last = null;
  const series = [];
  for (const b of buckets) {
    if (b.n > 0) last = b.sum / b.n;
    if (last != null) series.push({ date: b.key, value: round1(last) });
  }
  return series;
}
// Übungsnamen für den Abgleich vereinheitlichen: Groß/Klein, Umlaute und
// Sonderzeichen ignorieren – verhindert Dubletten wie „Klimmzug"/„Klimmzüge".
function normExName(s) {
  return (s || '').toLowerCase()
    .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}
// Findet die passende Übung zu einem (evtl. abweichend geschriebenen) Namen.
function matchExerciseByName(exercises, name) {
  const n = normExName(name);
  if (!n) return null;
  let ex = exercises.find((e) => normExName(e.name) === n)
    || exercises.find((e) => { const en = normExName(e.name); return en && (en.includes(n) || n.includes(en)); });
  return ex ? ex.id : null;
}

// Trainingsnamen fürs Gruppieren vereinheitlichen: Groß/Klein, Trenner
// (| / - +), Wortreihenfolge und einfacher Plural werden ignoriert.
// „CORE | LEG", „Legs / Core", „Legs | Core" ergeben denselben Schlüssel.
function sessionKey(name) {
  const tokens = (name || '').toLowerCase().match(/[a-zà-ÿ0-9]+/g);
  if (!tokens) return '';
  return tokens.map((w) => (w.endsWith('s') && w.length > 3 ? w.slice(0, -1) : w)).sort().join(' ');
}

// Wochentag-Kürzel aus "YYYY-MM-DD".
function weekdayShort(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return '';
  return (getLang() === 'en' ? WEEKDAYS_EN : WEEKDAYS_DE)[d.getDay()];
}

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
  '#einheiten': renderHistory,
  '#uebungen': renderExercises,
  '#plaene': renderPlans,
  '#fortschritt': renderProgress,
  '#koerper': renderBody,
  '#ernaehrung': renderNutrition,
  '#aktivitaet': renderActivity,
  '#einstellungen': renderSettings,
};

export async function initUI() {
  FORMULA = await db.getMeta('formula', 'epley');
  // Standard ist Deutsch. Englisch nur, wenn der Nutzer es aktiv wählt
  // (unter „Mehr" → Sprache). Kein automatisches Umschalten nach Handysprache
  // mehr – das führte zu einem gemischten DE/EN-Erscheinungsbild.
  const langChosen = await db.getMeta('langChosen', false);
  let lang = await db.getMeta('lang', 'de');
  if (!langChosen) { lang = 'de'; await db.setMeta('lang', 'de'); }
  setLang(lang === 'en' ? 'en' : 'de');
  applyTheme(await db.getMeta('theme', DEFAULT_THEME), await db.getMeta('accent', DEFAULT_ACCENT));
  window.addEventListener('hashchange', route);

  // Bottom-Nav: immer die Startseite des Tabs zeigen. Ist gerade eine Einheit
  // offen (Bearbeitung), vorher nachfragen und sie dann schließen.
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.preventDefault();
      const target = el.getAttribute('href');
      const openSession = await db.getMeta('currentWorkout', null);
      if (openSession != null) {
        if (!confirm(tr('Aktuelle Einheit verlassen? Erfasste Sätze bleiben gespeichert.',
          'Leave the current session? Logged sets stay saved.'))) return;
        await db.setMeta('currentWorkout', null);
      }
      if (location.hash === target) route();   // schon hier → auf Start zurücksetzen
      else location.hash = target;              // sonst per hashchange neu rendern
    });
  });

  // Bottom-Nav ausblenden, solange die (iOS-)Bildschirmtastatur eingeblendet
  // ist (z.B. bei Zahlenfeldern) – sie würde sonst mitten ins Bild rutschen.
  const bottomnav = document.querySelector('.bottomnav');
  if (bottomnav && window.visualViewport) {
    const vv = window.visualViewport;
    const onVVResize = () => {
      const keyboardOpen = (window.innerHeight - vv.height) > 140;
      bottomnav.style.display = keyboardOpen ? 'none' : '';
    };
    vv.addEventListener('resize', onVVResize);
    vv.addEventListener('scroll', onVVResize);
  }

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
    applyI18n(document.body);
    window.scrollTo(0, 0);
  } catch (err) {
    clear(app);
    app.appendChild(h('div', { class: 'card error' }, 'Fehler: ' + err.message));
    applyI18n(document.body);
    console.error(err);
  }
}

function setActiveNav(hash) {
  document.querySelectorAll('.nav-item').forEach((el) => {
    el.classList.toggle('active', el.getAttribute('href') === hash);
  });
}

function go(hash) { location.hash = hash; }

// Inline-Übersetzung für neu erzeugte Texte (umgeht den DOM-Übersetzungspass).
function tr(de, en) { return getLang() === 'en' ? en : de; }

// Tendenz-Anzeige: ＋ (ging mehr, grün) / － (unsauber, gelb) / nichts (neutral).
function tendBadge(t) {
  if (t === '+') return h('span', { class: 'tend-badge plus' }, '＋');
  if (t === '-') return h('span', { class: 'tend-badge minus' }, '－');
  return null;
}
// 3-Wege-Auswahl der Tendenz (kein Button aktiv = neutral). Gibt {el, get, set}.
function tendencyPicker(initial) {
  let val = initial === '+' || initial === '-' ? initial : null;
  const bMinus = h('button', { class: 'btn ghost small tend-minus', type: 'button' }, tr('－ unsauber', '－ grindy'));
  const bPlus = h('button', { class: 'btn ghost small tend-plus', type: 'button' }, tr('＋ ging mehr', '＋ had more'));
  const refresh = () => { bMinus.classList.toggle('on', val === '-'); bPlus.classList.toggle('on', val === '+'); };
  bMinus.onclick = () => { val = val === '-' ? null : '-'; refresh(); };
  bPlus.onclick = () => { val = val === '+' ? null : '+'; refresh(); };
  refresh();
  return { el: h('div', { class: 'seg' }, bMinus, bPlus), get: () => val, set: (v) => { val = (v === '+' || v === '-') ? v : null; refresh(); } };
}

// Einheit inkl. aller Sätze löschen.
async function deleteWorkout(id) {
  const sets = await db.byIndex('sets', 'workoutId', id);
  for (const s of sets) await db.delete('sets', s.id);
  await db.delete('workouts', id);
  const cur = await db.getMeta('currentWorkout', null);
  if (cur === id) await db.setMeta('currentWorkout', null);
}

// Wochenziel (Anzahl Einheiten) für Streak/Wochenring. Ohne explizite
// Einstellung wird es aus der Zahl der Trainingspläne abgeleitet (2–6),
// sonst Standard 4.
async function getWeeklyGoal() {
  const v = await db.getMeta('weeklyGoal', null);
  if (v > 0) return v;
  const n = (await db.all('templates')).length;
  return (n >= 2 && n <= 6) ? n : 4;
}

// IDs der Hauptübungen (Meta). Beim ersten Mal automatisch aus Bankdrücken /
// Kniebeugen / Klimmzüge (falls vorhanden) vorbelegt.
async function getMainLiftIds(exercises) {
  let ids = await db.getMeta('mainLifts', null);
  if (ids == null) {
    const wanted = ['bankdrucken', 'kniebeugen', 'klimmzuge'];
    ids = exercises.filter((e) => wanted.includes(normExName(e.name))).map((e) => e.id);
    await db.setMeta('mainLifts', ids);
  }
  return ids.filter((id) => exercises.some((e) => e.id === id));
}

// Kompakte Zeile für eine Hauptübung (gewichts- oder wiederholungsbasiert).
function mainLiftRow(ex, ss) {
  let subText = tr('noch keine Daten', 'no data yet');
  let chip = null;
  if (ss.length) {
    const bodyweight = ss.every((s) => !(s.weight > 0)) && ss.some((s) => s.reps > 0);
    if (bodyweight) {
      const rp = repsProgression(ss);
      const half = Math.floor(rp.series.length / 2);
      const eaB = rp.series.slice(0, half).reduce((m, p) => Math.max(m, p.value), 0);
      const reB = rp.series.slice(half).reduce((m, p) => Math.max(m, p.value), 0);
      subText = `${rp.current} ${tr('Wdh. gesamt', 'total reps')} · ${tr('Best', 'best')} ${rp.best}`;
      const d = reB - eaB;
      chip = h('span', { class: 'delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : '') }, d > 0 ? '▲' : d < 0 ? '▼' : '–');
    } else {
      const be = bestE1rm(ss, FORMULA);
      const prog = progression(ss, FORMULA);
      const reps = be.set && be.set.reps > 0 ? be.set.reps : 5;
      const tW = roundToStep(weightForReps(nextMilestone(be.value), reps, FORMULA));
      const curW = be.set ? be.set.weight : 0;
      subText = `${curW}×${reps} → ${tW}×${reps} kg`;
      const sl = prog.slopePerWeek;
      chip = h('span', { class: 'delta ' + (sl >= 0 ? 'up' : 'down') }, (sl >= 0 ? '+' : '') + sl + ' kg/' + tr('Wo.', 'wk'));
    }
  }
  return h('div', { class: 'row-item', onclick: () => go('#uebungen?id=' + ex.id) },
    h('div', {}, h('strong', {}, ex.name), h('div', { class: 'muted small' }, subText)),
    h('div', { class: 'row-actions' }, ...(chip ? [chip] : []), h('span', { class: 'chev' }, '›')),
  );
}

// Letzter neuer persönlicher Rekord über alle Übungen hinweg – inkl. welcher
// Rekord es war (Übung + Wert), nicht nur das Datum. Gewichtsbasiert: höheres
// e1RM als je zuvor. Körpergewicht: mehr Gesamt-Wiederholungen in einer
// Einheit als je zuvor.
function lastRecordInfo(enrichedSets, formula) {
  const byEx = new Map();
  for (const s of enrichedSets) { if (!byEx.has(s.exerciseId)) byEx.set(s.exerciseId, []); byEx.get(s.exerciseId).push(s); }
  let latest = null; // {date, name, kind, value, setWeight, setReps}
  for (const [, sets] of byEx) {
    const name = sets[0]?.exerciseName || tr('Übung', 'exercise');
    const bodyweight = sets.every((s) => !(s.weight > 0)) && sets.some((s) => s.reps > 0);
    if (bodyweight) {
      const byDay = new Map();
      for (const s of sets) { if (s.reps > 0 && s.date) byDay.set(s.date, (byDay.get(s.date) || 0) + s.reps); }
      let best = 0;
      for (const [date, total] of [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        if (total > best) {
          best = total;
          if (!latest || date >= latest.date) latest = { date, name, kind: 'bodyweight', value: total };
        }
      }
    } else {
      const sorted = sets.filter((s) => s.date && s.weight > 0 && s.reps > 0)
        .sort((a, b) => a.date.localeCompare(b.date) || (a.ts || 0) - (b.ts || 0));
      let best = 0;
      for (const s of sorted) {
        const v = e1rm(s.weight, s.reps, formula);
        if (v > best + 0.01) {
          best = v;
          if (!latest || s.date >= latest.date) latest = { date: s.date, name, kind: 'weight', value: round1(v), setWeight: s.weight, setReps: s.reps };
        }
      }
    }
  }
  return latest;
}

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

  // 🔥 Streak + 🎯 Wochenring: motivierender als reine Zähl-Kacheln.
  const weeklyGoal = await getWeeklyGoal();
  const { streak, curCount, curMet } = computeStreak(workouts.map((w) => w.date), weeklyGoal);
  const rootStyle = getComputedStyle(document.documentElement);
  const ringColor = rootStyle.getPropertyValue('--primary').trim() || '#4ade80';
  const ringTrack = rootStyle.getPropertyValue('--border').trim() || '#334155';
  const ringText = rootStyle.getPropertyValue('--text').trim() || '#e2e8f0';
  wrap.appendChild(h('div', { class: 'card week-card' },
    h('div', { class: 'streak-block' },
      h('div', { class: 'streak-flame' }, streak > 0 ? '🔥' : '💤'),
      h('div', {},
        h('div', { class: 'streak-num' }, String(streak)),
        h('div', { class: 'muted small' }, streak === 1 ? tr('Woche in Folge', 'week in a row') : tr('Wochen in Folge', 'weeks in a row'))),
    ),
    h('div', { class: 'ring-block' },
      progressRing(curCount, weeklyGoal, { color: ringColor, trackColor: ringTrack, textColor: ringText }),
      h('div', { class: 'muted small center' }, curMet
        ? tr('Diese Woche geschafft ✓', 'This week done ✓')
        : tr(`noch ${Math.max(0, weeklyGoal - curCount)} bis zum Wochenziel`, `${Math.max(0, weeklyGoal - curCount)} to go this week`)),
    ),
  ));

  // 🏆 Rekord-Countdown: seit wann kein neuer persönlicher Rekord mehr –
  // inkl. welche Übung und mit welchem Wert.
  const rec = lastRecordInfo(enriched, FORMULA);
  if (rec) {
    const daysSince = Math.floor((Date.now() - new Date(rec.date + 'T00:00:00').getTime()) / 864e5);
    const hot = daysSince <= 6;
    const level = hot ? 'good' : daysSince <= 20 ? 'tip' : 'warn';
    const valueText = rec.kind === 'bodyweight'
      ? `${rec.value} ${tr('Wdh. gesamt', 'total reps')}`
      : `${rec.value} kg 1RM (${rec.setWeight} kg × ${rec.setReps})`;
    const title = hot
      ? tr(`🏆 Frischer Rekord: ${rec.name}`, `🏆 Fresh record: ${rec.name}`)
      : tr(`🏆 Seit ${daysSince} Tagen kein neuer Rekord`, `🏆 ${daysSince} days since your last record`);
    const text = hot
      ? `${valueText} · ${fmtDate(rec.date)}`
      : tr(`Zuletzt: ${rec.name} mit ${valueText} am ${fmtDate(rec.date)}. Zeit, eine Übung anzugreifen.`,
           `Last one: ${rec.name} with ${valueText} on ${fmtDate(rec.date)}. Time to go attack a lift.`);
    wrap.appendChild(h('div', { class: 'card' },
      h('div', { class: 'suggestion ' + level }, h('div', { class: 'sug-title' }, title), h('div', { class: 'sug-text' }, text))));
  }

  // 📊 Bewegtes Gewicht pro Woche (letzte 10 Wochen) + ⚖️ Ø Körpergewicht im
  // selben Zeitraum darunter, damit direkt sichtbar ist, ob die Tonnage trotz
  // Cut (sinkendem Körpergewicht) weiter steigt.
  const tonnageSeries = weeklyTonnageSeries(enriched, 10);
  if (tonnageSeries.some((b) => b.value > 0)) {
    wrap.appendChild(h('div', { class: 'card' },
      h('h2', {}, '📊 ' + tr('Bewegtes Gewicht pro Woche', 'Weight moved per week')),
      barChart(tonnageSeries.map((b) => ({ ...b, color: ringColor }))),
    ));
    const bwSeries = weeklyBodyweightSeries(body, 10);
    if (bwSeries.length >= 2) {
      wrap.appendChild(h('div', { class: 'card' },
        h('h2', {}, '⚖️ ' + tr('Ø Körpergewicht pro Woche', 'Avg body weight per week')),
        h('p', { class: 'muted small' }, tr('Gleicher Zeitraum wie oben – so siehst du, ob dein bewegtes Gewicht trotz Cut weiter steigt.',
          'Same period as above — so you can see whether your tonnage keeps rising despite a cut.')),
        lineChart(bwSeries, { color: '#60a5fa' }),
      ));
    }
  }

  // 🛟 Backup-Erinnerung: Daten liegen nur auf diesem Gerät. Hinweis, wenn seit
  // >7 Tagen (oder nie) kein Backup gemacht wurde und es überhaupt Daten gibt.
  const lastBackupAt = await db.getMeta('lastBackupAt', null);
  const backupStale = !lastBackupAt || (Date.now() - lastBackupAt) > 7 * 864e5;
  if (workouts.length > 0 && backupStale) {
    const daysTxt = lastBackupAt
      ? tr(`letztes Backup vor ${Math.round((Date.now() - lastBackupAt) / 864e5)} Tagen`, `last backup ${Math.round((Date.now() - lastBackupAt) / 864e5)} days ago`)
      : tr('noch kein Backup', 'no backup yet');
    const card = h('div', { class: 'card' },
      h('div', { class: 'suggestion warn' },
        h('div', { class: 'sug-title' }, tr('🛟 Backup empfohlen', '🛟 Backup recommended')),
        h('div', { class: 'sug-text' }, tr(
          `Deine Daten liegen nur auf diesem Gerät (${daysTxt}). Sichere sie als Datei (in „Dateien“/iCloud), damit nichts verloren geht.`,
          `Your data is only on this device (${daysTxt}). Save it as a file (to Files/iCloud) so nothing gets lost.`))),
      h('div', { class: 'seg', style: 'margin-top:8px' },
        h('button', { class: 'btn primary', onclick: exportBackup }, tr('Jetzt sichern', 'Back up now')),
        h('button', { class: 'btn ghost', onclick: () => go('#einstellungen') }, tr('Optionen', 'Options')),
      ));
    wrap.appendChild(card);
  }

  // ⭐ Hauptübungen – eigener Fokus
  const mainIds = await getMainLiftIds(exercises);
  if (mainIds.length) {
    const setsByEx = new Map();
    for (const s of enriched) { if (!setsByEx.has(s.exerciseId)) setsByEx.set(s.exerciseId, []); setsByEx.get(s.exerciseId).push(s); }
    const card = h('div', { class: 'card' }, h('h2', {}, '⭐ ' + tr('Hauptübungen', 'Main lifts')));
    for (const id of mainIds) {
      const ex = exercises.find((e) => e.id === id);
      if (ex) card.appendChild(mainLiftRow(ex, setsByEx.get(id) || []));
    }
    wrap.appendChild(card);
  }

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

  // Link zur Fortschritts-/Forecast-Ansicht
  wrap.appendChild(h('div', { class: 'card' },
    h('div', { class: 'row-item', style: 'border-top:none', onclick: () => go('#fortschritt') },
      h('div', {}, h('strong', {}, '📊 ' + tr('Fortschritt', 'Progress')),
        h('div', { class: 'muted small' }, tr('So nah bist du an deinen Zielen', 'How close you are to your goals'))),
      h('span', { class: 'chev' }, '›'))));

  // Top-Übungen: Progression
  const byExercise = new Map();
  for (const s of enriched) {
    if (!byExercise.has(s.exerciseId)) byExercise.set(s.exerciseId, []);
    byExercise.get(s.exerciseId).push(s);
  }
  const progs = [...byExercise.entries()]
    .map(([id, sets]) => {
      const prog = progression(sets, FORMULA);
      const bodyweight = sets.every((s) => !(s.weight > 0)) && sets.some((s) => s.reps > 0);
      let series, deltaAbs, unit, zero;
      if (bodyweight) {
        const rp = repsProgression(sets);
        series = rp.series; deltaAbs = rp.changeAbs; unit = 'Wdh.'; zero = true;
      } else {
        series = prog.series; deltaAbs = prog.changeAbs; unit = 'kg'; zero = false;
      }
      return { id, name: sets[0].exerciseName, sessions: prog.sessions, slope: prog.slopePerWeek, series, deltaAbs, unit, zero, bodyweight };
    })
    .filter((p) => p.sessions >= 2)
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 3);

  if (progs.length) {
    const card = h('div', { class: 'card' }, h('h2', {}, '📈 ' + tr('Entwicklung je Übung', 'Progress per exercise')));
    for (const p of progs) {
      card.appendChild(h('div', { class: 'chart-block' },
        h('div', { class: 'chart-head' },
          h('span', {}, p.name),
          h('span', { class: p.deltaAbs >= 0 ? 'delta up' : 'delta down' },
            (p.deltaAbs >= 0 ? '+' : '') + p.deltaAbs + ' ' + p.unit + (p.bodyweight ? '' : ' · ' + p.slope + ' kg/' + tr('Wo.', 'wk'))),
        ),
        lineChart(p.series, { color: '#4ade80', zeroBased: p.zero }),
      ));
    }
    wrap.appendChild(card);
  }

  // Rekorde: gewichtsbasiert (bestes 1RM) + Körpergewicht (meiste Wdh./Einheit)
  const weightedRecords = [...byExercise.entries()]
    .map(([id, sets]) => ({ name: sets[0].exerciseName, ...bestE1rm(sets, FORMULA) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
  const bwRecords = [...byExercise.entries()]
    .map(([id, sets]) => {
      const bodyweight = sets.every((s) => !(s.weight > 0)) && sets.some((s) => s.reps > 0);
      if (!bodyweight) return null;
      const rp = repsProgression(sets);
      let bestSet = null;
      for (const s of sets) { if (s.reps > 0 && (!bestSet || s.reps > bestSet.reps)) bestSet = s; }
      return { name: sets[0].exerciseName, totalBest: rp.best, bestSet };
    })
    .filter((r) => r && r.totalBest > 0)
    .sort((a, b) => b.totalBest - a.totalBest)
    .slice(0, 6);

  if (weightedRecords.length || bwRecords.length) {
    const card = h('div', { class: 'card' }, h('h2', {}, '🏆 ' + tr('Rekorde', 'Records')));
    for (const r of weightedRecords) {
      card.appendChild(h('div', { class: 'row-item static' },
        h('div', {}, h('strong', {}, r.name),
          r.set ? h('div', { class: 'muted small' }, `${r.set.weight} kg × ${r.set.reps} · ${fmtDate(r.set.date)}`) : null),
        h('span', { class: 'record-val' }, r.value + ' kg'),
      ));
    }
    for (const r of bwRecords) {
      card.appendChild(h('div', { class: 'row-item static' },
        h('div', {}, h('strong', {}, r.name),
          r.bestSet ? h('div', { class: 'muted small' }, `${tr('bester Satz', 'best set')} ${r.bestSet.reps} ${tr('Wdh.', 'reps')} · ${fmtDate(r.bestSet.date)}`) : null),
        h('span', { class: 'record-val' }, r.totalBest + ' ' + tr('Wdh.', 'reps')),
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
  setRestDoneCallback(null);   // wird in einer offenen Einheit unten gesetzt
  const { enriched, workouts: allWorkouts, exercises } = await loadEnrichedSets();
  const workouts = [...allWorkouts].sort((a, b) => b.date.localeCompare(a.date));

  // Zuletzt benutzter Satz einer Übung (für Vorbefüllung).
  const lastSetFor = (exId) => enriched
    .filter((s) => s.exerciseId === exId)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.ts || 0) - (a.ts || 0))[0] || null;

  const apiKey = await db.getMeta('apiKey', '');
  const visionModel = await db.getMeta('visionModel', DEFAULT_VISION_MODEL);
  const defaultRest = parseInt(await db.getMeta('defaultRest', 90), 10) || 90;

  // aktuelle (offene) Einheit = zuletzt gewählte im Meta, sonst neu über Button
  let currentId = await db.getMeta('currentWorkout', null);
  let current = currentId ? await db.get('workouts', currentId) : null;

  const wrap = h('div', { class: 'view' });
  wrap.appendChild(h('h1', {}, 'Training erfassen'));

  if (!current) {
    // ============ HAUPTWEG: Training aus Foto der Notizen ============
    const qDate = h('input', { type: 'date', value: todayStr(), class: 'inp' });
    // Datumsfeld bleibt ausgeblendet – erscheint nur, wenn das Foto kein Datum liefert.
    const qDateBox = h('label', { class: 'field', style: 'display:none; margin-top:12px' },
      h('span', {}, tr('📅 Datum (im Foto nicht erkannt – bitte eintragen)', '📅 Date (not found in photo — please enter)')), qDate);
    const qPhotoInp = h('input', { type: 'file', accept: 'image/*', capture: 'environment', style: 'display:none' });
    const qPreview = h('div', { class: 'photo-preview' });
    const qHint = h('div', { class: 'hint' }, '');
    const qAll = h('div', { class: 'quick-all' });
    let qPhoto = null;
    let qRecognized = [];
    let qRecName = null;
    const qMatch = (name) => matchExerciseByName(exercises, name);
    // Ganze erkannte Einheit auf einmal speichern (fehlende Übungen werden angelegt).
    async function saveWholeSession() {
      if (!qRecognized.length) return;
      const date = qDate.value || todayStr();
      const wid = await db.add('workouts', { date, notes: qRecName || '', templateName: qRecName || undefined });
      let first = true, n = 0;
      for (const s of qRecognized) {
        let exId = qMatch(s.exercise);
        if (!exId && s.exercise) exId = await db.add('exercises', { name: s.exercise, category: 'sonstige', equipment: '', unit: 'kg' });
        if (!exId) continue;
        await db.add('sets', { workoutId: wid, exerciseId: exId, weight: s.weight || 0, reps: s.reps || 0, rpe: null, tendency: s.tendency || null, photo: first ? qPhoto : null, ts: Date.now() });
        first = false; n++;
      }
      toast(tr(`Gespeichert ✓ (${n} Sätze)`, `Saved ✓ (${n} sets)`));
      route();
    }
    // Foto auslesen (wird nach dem Fotografieren automatisch aufgerufen).
    async function runExtraction() {
      if (!qPhoto) return;
      if (!apiKey) {
        clear(qHint); qHint.appendChild(document.createTextNode(tr('Kein KI-Schlüssel hinterlegt. ', 'No AI key set. ')));
        qHint.appendChild(h('a', { href: '#einstellungen', class: 'back' }, tr('Unter „Mehr" hinzufügen', 'Add it under “More”')));
        qHint.appendChild(document.createTextNode(tr(' – oder unten manuell erfassen.', ' — or log manually below.')));
        return;
      }
      qHint.textContent = tr('🤖 Lese Foto …', '🤖 Reading photo …'); clear(qAll);
      try {
        const res = await extractSetsFromImage({ dataUrl: qPhoto, apiKey, model: visionModel, exerciseNames: exercises.map((e) => e.name) });
        qRecognized = res.sets || []; qRecName = res.name || null;
        if (res.date) { qDate.value = res.date; qDateBox.style.display = 'none'; }
        clear(qAll);
        if (qRecognized.length) {
          if (!res.date) qDateBox.style.display = '';   // nur zeigen, wenn kein Datum erkannt
          qHint.textContent = (res.name ? res.name + ' · ' : '') +
            tr(`${qRecognized.length} Sätze erkannt`, `${qRecognized.length} sets recognized`) +
            (res.date ? ' · ' + fmtDate(res.date) : ' · ' + tr('Datum bitte unten eintragen', 'enter date below')) +
            (res.note ? ' · ' + res.note : '');
          const list = h('div', { class: 'muted small', style: 'margin:6px 0' });
          for (const x of qRecognized) list.appendChild(h('div', {}, `• ${x.exercise || '?'} — ${x.weight ?? '?'} kg × ${x.reps ?? '?'}${x.tendency === '+' ? ' ＋' : x.tendency === '-' ? ' －' : ''}`));
          qAll.appendChild(list);
          qAll.appendChild(h('button', { class: 'btn primary', onclick: saveWholeSession },
            tr(`✅ Ganzes Training speichern (${qRecognized.length} Sätze)`, `✅ Save whole session (${qRecognized.length} sets)`)));
        } else { qHint.textContent = tr('Keine Werte erkannt. Schärferes Foto versuchen – oder unten manuell erfassen.', 'No values recognized. Try a sharper photo — or log manually below.'); }
      } catch (err) { qHint.textContent = '⚠️ ' + err.message; }
    }
    qPhotoInp.addEventListener('change', async () => {
      const file = qPhotoInp.files[0];
      if (!file) return;
      if (file.lastModified) qDate.value = new Date(file.lastModified).toISOString().slice(0, 10);
      qPhoto = await downscaleImage(file, 1000, 0.7);
      clear(qPreview); qPreview.appendChild(h('img', { src: qPhoto }));
      qRecognized = []; clear(qAll);
      runExtraction();   // sofort automatisch auslesen
    });

    const takeBtn = h('label', { class: 'btn primary big-pause' }, qPhotoInp, tr('📷 Trainingsnotiz fotografieren', '📷 Photograph your notes'));

    wrap.appendChild(h('div', { class: 'card' },
      h('h2', {}, tr('📷 Training aus Foto', '📷 Training from photo')),
      h('p', { class: 'muted small' }, tr(
        'Fotografiere deine Notiz – Datum, Übungen, Sätze, Gewichte und ＋/－ werden automatisch erkannt und als komplettes Training gespeichert.',
        'Photograph your notes — date, exercises, sets, weights and ＋/－ are recognized automatically and saved as a full session.')),
      takeBtn,
      qPreview,
      qHint,
      qAll,
      qDateBox,
    ));

    // ============ Freier Timer (ohne Übungsbezug) ============
    const ftCustom = h('input', { type: 'number', step: '5', min: '5', inputmode: 'numeric', class: 'inp',
      value: defaultRest, placeholder: tr('Sekunden', 'seconds') });
    const ftChip = (sec) => h('button', { class: 'btn ghost small', onclick: () => startFreeTimer(sec) }, fmtSec(sec));
    function startFreeTimer(sec) {
      if (!(sec > 0)) return;
      startRest(sec, { readyText: tr('🔔 Timer fertig!', '🔔 Timer done!') });
    }
    wrap.appendChild(h('div', { class: 'card' },
      h('h2', {}, tr('⏱ Freier Timer', '⏱ Free timer')),
      h('p', { class: 'muted small' }, tr('Einfach eine Pause stoppen, ganz ohne Training zu erfassen.', 'Just time a break, without logging any training.')),
      h('div', { class: 'seg', style: 'flex-wrap:wrap' }, ftChip(30), ftChip(60), ftChip(90), ftChip(120), ftChip(180)),
      h('div', { class: 'field-row', style: 'margin-top:10px' },
        h('label', { class: 'field' }, h('span', {}, tr('Eigene Dauer (Sek.)', 'Custom duration (sec)')), ftCustom),
        h('button', { class: 'btn primary', style: 'align-self:flex-end', onclick: () => startFreeTimer(parseInt(ftCustom.value, 10)) },
          tr('▶ Start', '▶ Start')),
      ),
    ));

    // ============ AUSNAHME: manuell erfassen (eingeklappt) ============
    const mDate = h('input', { type: 'date', value: todayStr(), class: 'inp' });
    const mEx = h('select', { class: 'inp' },
      ...exercises.map((e) => h('option', { value: e.id }, `${e.name} (${CAT_LABEL[e.category] || e.category})`)));
    // type="text" statt "number": nur so unterstützen Browser das Markieren
    // des bestehenden Werts bei Fokus (inputmode sorgt weiterhin für die
    // numerische Bildschirmtastatur).
    const mWeight = selectOnFocus(h('input', { type: 'text', inputmode: 'decimal', class: 'inp', placeholder: tr('kg (0 = Körpergewicht)', 'kg (0 = bodyweight)') }));
    const mReps = selectOnFocus(h('input', { type: 'text', inputmode: 'numeric', class: 'inp', placeholder: tr('Wdh.', 'Reps') }));
    const mTend = tendencyPicker(null);
    const mStartDate = h('input', { type: 'date', value: todayStr(), class: 'inp' });
    const templates = [...await db.all('templates')];

    const manualChildren = [
      h('p', { class: 'muted small' }, tr('Einzelnen Satz ohne Foto erfassen.', 'Log a single set without a photo.')),
      h('label', { class: 'field' }, h('span', {}, tr('Datum', 'Date')), mDate),
      h('label', { class: 'field' }, h('span', {}, tr('Übung', 'Exercise')), mEx),
      h('div', { class: 'field-row' },
        h('label', { class: 'field' }, h('span', {}, tr('Gewicht', 'Weight')), mWeight),
        h('label', { class: 'field' }, h('span', {}, tr('Wiederholungen', 'Reps')), mReps),
      ),
      h('label', { class: 'field' }, h('span', {}, tr('Tendenz (optional)', 'Tendency (optional)')), mTend.el),
      h('button', { class: 'btn primary', onclick: async () => {
        let w = parseFloat(mWeight.value); if (isNaN(w)) w = 0;
        const r = parseInt(mReps.value, 10);
        if (w < 0 || !(r > 0)) { alert(tr('Bitte Gewicht und Wiederholungen eingeben.', 'Please enter weight and reps.')); return; }
        const wid = await db.add('workouts', { date: mDate.value || todayStr(), notes: '' });
        await db.add('sets', { workoutId: wid, exerciseId: parseInt(mEx.value, 10), weight: w, reps: r, rpe: null, tendency: mTend.get(), photo: null, ts: Date.now() });
        toast(tr('Gespeichert ✓ – nächstes', 'Saved ✓ — next'));
        // Werte NICHT leeren: nächster Satz hat oft dasselbe Gewicht/Wdh. –
        // einfach antippen (markiert automatisch) und bei Bedarf überschreiben.
        mTend.set(null); mReps.focus(); mReps.select();
      } }, tr('Speichern & nächstes', 'Save & next')),
    ];

    // Ein komplettes hinterlegtes Training starten (falls Pläne vorhanden).
    if (templates.length) {
      const tSel = h('select', { class: 'inp' }, ...templates.map((t) => h('option', { value: t.id }, t.name)));
      manualChildren.push(
        h('div', { class: 'muted small', style: 'margin:16px 0 6px' }, tr('… oder ein hinterlegtes Training starten:', '… or start a saved workout:')),
        h('label', { class: 'field' }, h('span', {}, tr('Trainingsplan', 'Plan')), tSel),
        h('button', { class: 'btn primary', onclick: async () => {
          const t = templates.find((x) => x.id === parseInt(tSel.value, 10));
          if (!t) return;
          const wid = await db.add('workouts', { date: mStartDate.value || todayStr(), notes: '', templateName: t.name, plan: t.items });
          await db.setMeta('currentWorkout', wid);
          route();
        } }, tr('▶ Training starten', '▶ Start workout')),
      );
    }

    // Oder eine ganz leere Einheit live mitschreiben.
    manualChildren.push(
      h('div', { class: 'muted small', style: 'margin:16px 0 6px' }, tr('… oder eine leere Einheit live mitschreiben:', '… or log an empty session live:')),
      h('label', { class: 'field' }, h('span', {}, tr('Datum', 'Date')), mStartDate),
      h('button', { class: 'btn ghost', onclick: async () => {
        const id = await db.add('workouts', { date: mStartDate.value || todayStr(), notes: '' });
        await db.setMeta('currentWorkout', id);
        route();
      } }, tr('▶ Leere Einheit live starten', '▶ Start empty live session')),
    );

    wrap.appendChild(h('details', { class: 'manual-details' },
      h('summary', {}, tr('✏️ Manuell erfassen / Training starten', '✏️ Log manually / start a workout')),
      h('div', { class: 'card', style: 'margin-top:10px' }, ...manualChildren),
    ));

    // Letzte Einheiten (Kurzvorschau) + Link zum ganzen Verlauf
    if (workouts.length) {
      const setsByW = new Map();
      for (const s of enriched) setsByW.set(s.workoutId, (setsByW.get(s.workoutId) || 0) + 1);
      const list = h('div', { class: 'card' },
        h('div', { class: 'chart-head' },
          h('h2', {}, tr('Letzte Einheiten', 'Recent sessions')),
          h('button', { class: 'btn ghost small', onclick: () => go('#einheiten') }, tr('📅 Ganzer Verlauf', '📅 Full history')),
        ));
      for (const w of workouts.slice(0, 5)) {
        const cnt = setsByW.get(w.id) || 0;
        list.appendChild(h('div', { class: 'row-item', onclick: async () => {
          await db.setMeta('currentWorkout', w.id); route();
        } },
          h('div', {}, h('strong', {}, `${weekdayShort(w.date)}, ${fmtDate(w.date)}`),
            h('span', { class: 'muted' }, ` · ${cnt} ${tr('Sätze', 'sets')}${w.templateName ? ' · ' + w.templateName : ''}`)),
          h('span', { class: 'chev' }, '›'),
        ));
      }
      if (workouts.length > 5) {
        list.appendChild(h('button', { class: 'btn ghost', onclick: () => go('#einheiten') },
          tr(`Alle ${workouts.length} Einheiten ansehen`, `View all ${workouts.length} sessions`)));
      }
      wrap.appendChild(list);
    }
    return wrap;
  }

  // --- Offene Einheit: Sätze erfassen ---
  const sets = [...await db.byIndex('sets', 'workoutId', current.id)].sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const eById = new Map(exercises.map((e) => [e.id, e]));

  // Pausenzeit für eine Übung: Plan > übungseigene Zeit > Standard.
  function restSecondsFor(exId) {
    let sec = defaultRest;
    const ex = eById.get(exId);
    if (ex && ex.rest > 0) sec = ex.rest;
    if (current.plan) {
      const it = current.plan.find((p) => p.exerciseId === exId);
      if (it) { const r = parseRestSeconds(it.rest); if (r) sec = r; }
    }
    return sec;
  }

  const dateEdit = h('input', { type: 'date', class: 'inp', value: current.date || todayStr() });
  dateEdit.addEventListener('change', async () => {
    const v = dateEdit.value;
    if (!v) { dateEdit.value = current.date; return; }
    current.date = v;
    await db.put('workouts', current);
    toast(tr('Datum geändert ✓', 'Date changed ✓'));
  });
  const header = h('div', { class: 'card' },
    h('div', { class: 'chart-head' },
      h('h2', {}, tr('Einheit bearbeiten', 'Edit session')),
      h('button', { class: 'btn ghost small', onclick: async () => {
        await db.setMeta('currentWorkout', null); route();
      } }, tr('Fertig / schließen', 'Done / close')),
    ),
    h('label', { class: 'field' }, h('span', {}, tr('📅 Datum der Einheit', '📅 Session date')), dateEdit),
    h('button', { class: 'btn ghost small danger', onclick: async () => {
      const q = getLang() === 'en'
        ? `Permanently delete this session incl. all ${sets.length} sets?`
        : `Diese Einheit inkl. aller ${sets.length} Sätze endgültig löschen?`;
      if (confirm(q)) {
        await deleteWorkout(current.id); route();
      }
    } }, '🗑 Einheit löschen'),
  );
  wrap.appendChild(header);

  // Plan-Karte (wenn die Einheit aus einer Vorlage gestartet wurde)
  if (current.plan && current.plan.length) {
    const countByEx = {};
    for (const s of sets) countByEx[s.exerciseId] = (countByEx[s.exerciseId] || 0) + 1;
    const planCard = h('div', { class: 'card' }, h('h2', {}, '📋 ' + (current.templateName || 'Plan')));
    for (const it of current.plan) {
      const done = countByEx[it.exerciseId] || 0;
      const target = parseTargetSets(it.scheme);
      const complete = target && done >= target;
      planCard.appendChild(h('div', { class: 'row-item', onclick: () => {
        addDetails.open = true;                 // Erfassungs-Formular aufklappen
        exSel.value = it.exerciseId;
        prefillFromLast(true);
        weightInp.focus();
        weightInp.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } },
        h('div', {}, h('strong', {}, (complete ? '✅ ' : '') + it.exerciseName),
          h('div', { class: 'muted small' }, `${it.scheme} · ${done}/${target || '?'} Sätze · Pause ${it.rest}${it.note ? ' · ' + it.note : ''}`)),
        h('span', { class: 'chev' }, '›'),
      ));
    }
    wrap.appendChild(planCard);
  }

  // Eingabemaske Satz
  const exSel = h('select', { class: 'inp' },
    ...exercises.map((e) => h('option', { value: e.id }, `${e.name} (${CAT_LABEL[e.category] || e.category})`)));
  const weightInp = selectOnFocus(h('input', { type: 'text', inputmode: 'decimal', class: 'inp', placeholder: tr('kg (0 = Körpergewicht)', 'kg (0 = bodyweight)') }));
  const repsInp = selectOnFocus(h('input', { type: 'text', inputmode: 'numeric', class: 'inp', placeholder: 'Wdh.' }));
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

  // --- KI: Werte aus Foto lesen ---
  const aiResult = h('div', { class: 'hint' }, '');
  const matchExercise = (name) => matchExerciseByName(exercises, name);
  const aiBtn = h('button', { class: 'btn ghost', onclick: async () => {
    if (!apiKey) { aiResult.textContent = 'Kein API-Schlüssel – unter „Mehr" hinterlegen.'; return; }
    if (!photoData) { aiResult.textContent = 'Bitte zuerst ein Foto aufnehmen/auswählen.'; return; }
    const orig = aiBtn.textContent;
    aiBtn.textContent = '🤖 Lese Foto …'; aiBtn.disabled = true; aiResult.textContent = '';
    try {
      const { sets, note } = await extractSetsFromImage({
        dataUrl: photoData, apiKey, model: visionModel, exerciseNames: exercises.map((e) => e.name),
      });
      if (!sets.length) { aiResult.textContent = 'Keine Werte erkannt' + (note ? ' – ' + note : '.'); return; }
      if (sets.length === 1) {
        const s = sets[0];
        if (s.weight != null) weightInp.value = s.weight;
        if (s.reps != null) repsInp.value = s.reps;
        addTend.set(s.tendency);
        const exId = matchExercise(s.exercise);
        if (exId) exSel.value = exId;
        updateHint();
        aiResult.textContent = `Erkannt: ${s.exercise || '?'} · ${s.weight ?? '?'} kg × ${s.reps ?? '?'}` +
          (exId ? '' : ' (Übung bitte prüfen)') + (note ? ' · ' + note : '');
      } else {
        // Mehrere Sätze: Liste + "alle übernehmen"
        clear(aiResult);
        aiResult.appendChild(h('div', {}, `${sets.length} Sätze erkannt:`));
        for (const s of sets) {
          aiResult.appendChild(h('div', { class: 'small' },
            `• ${s.exercise || '?'} — ${s.weight ?? '?'} kg × ${s.reps ?? '?'}${s.tendency === '+' ? ' ＋' : s.tendency === '-' ? ' －' : ''}`));
        }
        aiResult.appendChild(h('button', { class: 'btn primary small', onclick: async () => {
          let first = true;
          for (const s of sets) {
            const exId = matchExercise(s.exercise) || parseInt(exSel.value, 10);
            await db.add('sets', {
              workoutId: current.id, exerciseId: exId,
              weight: s.weight || 0, reps: s.reps || 0, rpe: null,
              tendency: s.tendency || null,
              photo: first ? photoData : null, ts: Date.now(),
            });
            first = false;
          }
          route();
        } }, `Alle ${sets.length} übernehmen`));
      }
    } catch (err) {
      aiResult.textContent = '⚠️ ' + err.message;
    } finally {
      aiBtn.textContent = orig; aiBtn.disabled = false;
    }
  } }, '🔍 Aus Foto lesen (KI)');

  const addTend = tendencyPicker(null);
  const form = h('div', { class: 'card' },
    h('h2', {}, 'Satz hinzufügen'),
    h('label', { class: 'field' }, h('span', {}, 'Übung'), exSel),
    lastHint,
    h('div', { class: 'field-row' },
      h('label', { class: 'field' }, h('span', {}, 'Gewicht'), weightInp),
      h('label', { class: 'field' }, h('span', {}, 'Wiederholungen'), repsInp),
    ),
    e1rmHint,
    h('label', { class: 'field' }, h('span', {}, tr('Tendenz (optional)', 'Tendency (optional)')), addTend.el),
    h('label', { class: 'field' }, h('span', {}, '📷 Foto (optional – Display/Beleg)'), photoInp),
    preview,
    aiBtn,
    aiResult,
    h('button', { class: 'btn primary', onclick: async () => {
      let weight = parseFloat(weightInp.value);
      if (isNaN(weight)) weight = 0;              // leer = Körpergewicht (0 kg)
      const reps = parseInt(repsInp.value, 10);
      if (weight < 0 || !(reps > 0)) { alert(L('Bitte Gewicht und Wiederholungen eingeben.')); return; }
      const exId = parseInt(exSel.value, 10);
      // Bestwert VOR diesem Satz merken → Rekord-Erkennung.
      const prevBest = bestE1rm(enriched.filter((s) => s.exerciseId === exId), FORMULA).value;
      const newE = round1(e1rm(weight, reps, FORMULA));
      await db.add('sets', {
        workoutId: current.id,
        exerciseId: exId,
        weight, reps,
        rpe: null,
        tendency: addTend.get(),
        photo: photoData || null,
        ts: Date.now(),
      });
      if (newE > prevBest && prevBest > 0) {
        const ex = eById.get(exId);
        const nm = ex ? ex.name : (getLang() === 'en' ? 'exercise' : 'Übung');
        toast(getLang() === 'en'
          ? `🏆 New record on ${nm}: ${newE} kg (was ${prevBest} kg)`
          : `🏆 Neuer Rekord bei ${nm}: ${newE} kg (vorher ${prevBest} kg)`);
      }
      startRest(restSecondsFor(exId));       // Pause automatisch starten
      route();
    } }, '+ Satz speichern'),
    h('button', { class: 'btn ghost big-pause', onclick: () => startRest(restSecondsFor(parseInt(exSel.value, 10))) },
      '⏱ Pause starten'),
  );

  // Nächste fällige Übung im Plan bestimmen (erste, deren Zielsätze noch nicht
  // voll sind); ohne Plan die zuletzt benutzte Übung fortsetzen.
  function nextUpExerciseId() {
    if (current.plan && current.plan.length) {
      const countByEx = {};
      for (const s of sets) countByEx[s.exerciseId] = (countByEx[s.exerciseId] || 0) + 1;
      for (const it of current.plan) {
        const target = parseTargetSets(it.scheme) || 0;
        if (!target || (countByEx[it.exerciseId] || 0) < target) return it.exerciseId;
      }
      return current.plan[current.plan.length - 1].exerciseId; // alles voll → letzte
    }
    const last = [...sets].sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
    return last ? last.exerciseId : null;
  }
  const nextEx = nextUpExerciseId();
  if (nextEx != null && exercises.some((e) => e.id === nextEx)) exSel.value = nextEx;
  prefillFromLast(false);

  // Liste der Sätze dieser Einheit — nach Übung gruppiert (wie auf deinen
  // Notizen): Übung im Vordergrund, darunter Satz für Satz mit Gewicht × Wdh.
  // Jeder Satz bleibt bearbeitbar, ohne dass dabei eine Pause gestartet wird.
  const listCard = h('div', { class: 'card' }, h('h2', {}, `Sätze dieser Einheit (${sets.length})`));
  if (sets.length === 0) {
    listCard.appendChild(h('p', { class: 'muted' }, 'Noch keine Sätze erfasst.'));
  } else {
    // Nach Übung gruppieren (Reihenfolge = erste Ausführung), Sätze aufsteigend.
    const asc = [...sets].sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const groups = new Map();
    for (const s of asc) {
      if (!groups.has(s.exerciseId)) groups.set(s.exerciseId, []);
      groups.get(s.exerciseId).push(s);
    }
    for (const [exId, exSets] of groups) {
      const ex = eById.get(exId);
      const best = bestE1rm(exSets, FORMULA).value;
      const group = h('div', { class: 'ex-group' },
        h('div', { class: 'ex-group-head' },
          h('strong', {}, ex ? ex.name : '?'),
          h('span', { class: 'muted small' }, `${exSets.length} ${tr('Sätze', 'sets')}${best ? ' · e1RM ' + best + ' kg' : ''}`),
        ),
      );
      exSets.forEach((s, i) => group.appendChild(makeSetRow(s, i + 1)));
      listCard.appendChild(group);
    }
  }
  wrap.appendChild(listCard);

  // „Satz hinzufügen": bei neuer (leerer) Einheit offen zum sofortigen Loslegen,
  // bei einer Einheit mit Sätzen eingeklappt (Fokus auf Ansehen/Korrigieren).
  const addDetails = h('details', { class: 'manual-details' },
    h('summary', {}, tr('➕ Satz hinzufügen / aus Foto', '➕ Add a set / from photo')),
    form,
  );
  // Bei leerer Einheit oder aktivem Plan das Formular offen halten (Log-Modus).
  if (sets.length === 0 || (current.plan && current.plan.length)) addDetails.open = true;
  wrap.appendChild(addDetails);

  // Nach der Pause (Timer durch oder „Fertig") direkt zum nächsten Satz:
  // Formular aufklappen und Gewichtsfeld fokussieren (Übung ist schon gewählt).
  setRestDoneCallback(() => {
    addDetails.open = true;
    try { weightInp.focus(); weightInp.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { /* ignore */ }
  });
  return wrap;

  // Baut eine Satz-Zeile mit Anzeige- und Bearbeiten-Modus.
  // setNo = laufende Satznummer innerhalb der Übung (Satz 1, 2, …).
  function makeSetRow(s, setNo) {
    const row = h('div', { class: 'set-item' });
    const showView = () => {
      clear(row);
      const line = h('div', { class: 'set-line' },
        h('span', { class: 'set-no' }, `${tr('Satz', 'Set')} ${setNo}`),
        h('strong', { class: 'set-load' }, `${s.weight} kg × ${s.reps} ${tr('Wdh.', 'reps')}`),
      );
      const badge = tendBadge(s.tendency);
      if (badge) line.appendChild(badge);
      row.appendChild(h('div', { class: 'set-main' },
        line,
        h('div', { class: 'muted small' }, `${s.rpe ? 'RPE ' + s.rpe + ' · ' : ''}e1RM ${round1(e1rm(s.weight, s.reps, FORMULA))} kg`),
      ));
      row.appendChild(h('button', { class: 'btn ghost small', onclick: showEdit, title: tr('Bearbeiten', 'Edit') }, '✎'));
      row.appendChild(h('button', { class: 'btn ghost small danger', onclick: async () => { await db.delete('sets', s.id); route(); } }, '✕'));
    };
    const showEdit = () => {
      clear(row);
      const exE = h('select', { class: 'inp' },
        ...exercises.map((e) => h('option', { value: e.id }, `${e.name} (${CAT_LABEL[e.category] || e.category})`)));
      exE.value = s.exerciseId;
      const wE = selectOnFocus(h('input', { type: 'text', inputmode: 'decimal', class: 'inp', value: s.weight,
        placeholder: tr('kg (0 = Körpergewicht)', 'kg (0 = bodyweight)') }));
      const rE = selectOnFocus(h('input', { type: 'text', inputmode: 'numeric', class: 'inp', value: s.reps, placeholder: tr('Wdh.', 'Reps') }));
      const tend = tendencyPicker(s.tendency);
      row.appendChild(h('div', { class: 'set-main', style: 'width:100%' },
        exE,
        h('div', { class: 'field-row', style: 'margin-top:8px' },
          h('label', { class: 'field' }, h('span', {}, tr('Gewicht', 'Weight')), wE),
          h('label', { class: 'field' }, h('span', {}, tr('Wiederholungen', 'Reps')), rE),
        ),
        h('label', { class: 'field' }, h('span', {}, tr('Tendenz', 'Tendency')), tend.el),
        h('div', { class: 'seg', style: 'margin-top:4px' },
          h('button', { class: 'btn primary small', onclick: async () => {
            let w = parseFloat(wE.value); if (isNaN(w)) w = 0;
            const r = parseInt(rE.value, 10);
            if (w < 0 || !(r > 0)) { alert(L('Bitte Gewicht und Wiederholungen eingeben.')); return; }
            await db.put('sets', { ...s, exerciseId: parseInt(exE.value, 10), weight: w, reps: r, tendency: tend.get() });
            route();   // kein startRest → keine erzwungene Pause beim Korrigieren
          } }, tr('✓ Speichern', '✓ Save')),
          h('button', { class: 'btn ghost small', onclick: showView }, tr('Abbrechen', 'Cancel')),
        ),
      ));
    };
    showView();
    return row;
  }
}

// ==================================================================
//  VERLAUF (alle Einheiten, nach Monat gruppiert)
// ==================================================================
async function renderHistory() {
  const { enriched, workouts } = await loadEnrichedSets();
  const wrap = h('div', { class: 'view' });
  wrap.appendChild(h('a', { class: 'back', href: '#training' }, tr('‹ Zurück', '‹ Back')));
  wrap.appendChild(h('h1', {}, tr('Trainings-Verlauf', 'Training history')));

  if (!workouts.length) {
    wrap.appendChild(h('div', { class: 'card' }, h('p', { class: 'muted' }, tr('Noch keine Einheiten erfasst.', 'No sessions logged yet.'))));
    return wrap;
  }

  // Kennzahlen je Einheit aus den Sätzen aggregieren.
  const agg = new Map(); // workoutId -> {sets, exIds:Set, volume, cats:Set}
  for (const s of enriched) {
    let a = agg.get(s.workoutId);
    if (!a) { a = { sets: 0, exIds: new Set(), volume: 0, reps: 0, cats: new Set() }; agg.set(s.workoutId, a); }
    a.sets += 1;
    a.exIds.add(s.exerciseId);
    a.volume += (s.weight || 0) * (s.reps || 0);
    a.reps += (s.reps || 0);
    if (s.category) a.cats.add(s.category);
  }

  const allSorted = [...workouts].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.id - a.id));

  // ---- Filter nach Trainingsname (Schreibvarianten werden zusammengefasst) ----
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const nameFilter = params.get('name') || '';

  // Nach normalisiertem Schlüssel gruppieren; häufigste Schreibweise als Anzeige.
  const groups = new Map(); // key -> Map(originalName -> count)
  for (const w of workouts) {
    if (!w.templateName) continue;
    const k = sessionKey(w.templateName);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, new Map());
    const m = groups.get(k);
    m.set(w.templateName, (m.get(w.templateName) || 0) + 1);
  }
  const names = [...groups.entries()].map(([key, m]) => {
    const label = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    return { key, label };
  }).sort((a, b) => a.label.localeCompare(b.label));

  const setFilter = (nameKey) => {
    location.hash = '#einheiten' + (nameKey ? '?name=' + encodeURIComponent(nameKey) : '');
  };
  const nameSel = h('select', { class: 'inp' },
    h('option', { value: '' }, tr('Alle Trainings', 'All sessions')),
    ...names.map(({ key, label }) => h('option', { value: key }, label)));
  nameSel.value = nameFilter;
  nameSel.addEventListener('change', () => setFilter(nameSel.value));

  if (names.length) {
    wrap.appendChild(h('div', { class: 'card' },
      h('label', { class: 'field' }, h('span', {}, tr('Training', 'Session')), nameSel),
      nameFilter
        ? h('button', { class: 'btn ghost small', onclick: () => setFilter('') }, tr('Filter zurücksetzen', 'Clear filter'))
        : h('div', { class: 'muted small' }, tr('Nach Trainingsname filtern.', 'Filter by session name.')),
    ));
  }

  // Filter anwenden (über den normalisierten Schlüssel).
  const sorted = allSorted.filter((w) => !nameFilter || sessionKey(w.templateName) === nameFilter);

  // Kopf-KPIs (auf die gefilterte Auswahl bezogen).
  const thisYM = todayStr().slice(0, 7);
  const inMonth = sorted.filter((w) => (w.date || '').slice(0, 7) === thisYM).length;
  const selVol = sorted.reduce((sum, w) => sum + (agg.get(w.id)?.volume || 0), 0);
  const selSets = sorted.reduce((sum, w) => sum + (agg.get(w.id)?.sets || 0), 0);
  wrap.appendChild(h('div', { class: 'kpi-grid' },
    kpi(String(sorted.length), nameFilter ? tr('Einheiten (gefiltert)', 'Sessions (filtered)') : tr('Einheiten gesamt', 'Total sessions')),
    kpi(String(inMonth), tr('diesen Monat', 'this month')),
    kpi(Math.round(selVol).toLocaleString('de-DE') + ' kg', tr('Volumen', 'Volume')),
    kpi(String(sorted.length ? Math.round(selSets / sorted.length) : 0), tr('Ø Sätze/Einheit', 'Avg sets/session')),
  ));

  if (!sorted.length) {
    wrap.appendChild(h('div', { class: 'card' }, h('p', { class: 'muted' }, tr('Keine Einheiten für diesen Filter.', 'No sessions for this filter.'))));
    return wrap;
  }

  // Nach Monat gruppieren (Reihenfolge: neueste zuerst).
  let curYM = null;
  let card = null;
  for (const w of sorted) {
    const ym = (w.date || '').slice(0, 7);
    if (ym !== curYM) {
      curYM = ym;
      card = h('div', { class: 'card' }, h('h2', {}, monthLabel(ym)));
      wrap.appendChild(card);
    }
    const a = agg.get(w.id) || { sets: 0, exIds: new Set(), volume: 0, cats: new Set() };
    const dots = [...a.cats].map((c) => h('span', { class: 'dot', style: `background:${CAT_COLOR[c] || '#94a3b8'}`, title: CAT_LABEL[c] || c }));
    card.appendChild(h('div', { class: 'row-item', onclick: async () => {
      await db.setMeta('currentWorkout', w.id); go('#training');
    } },
      h('div', {},
        h('div', { class: 'set-line' },
          h('strong', {}, `${weekdayShort(w.date)}, ${fmtDate(w.date)}`),
          ...(w.templateName ? [h('span', { class: 'muted small' }, w.templateName)] : []),
        ),
        h('div', { class: 'muted small' }, `${a.exIds.size} ${tr('Übungen', 'exercises')} · ${a.sets} ${tr('Sätze', 'sets')} · ` +
          (a.volume > 0 ? `${Math.round(a.volume).toLocaleString('de-DE')} kg` : `${a.reps} ${tr('Wdh.', 'reps')}`)),
        h('div', { class: 'cat-dots' }, ...dots),
      ),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn ghost small danger', onclick: async (e) => {
          e.stopPropagation();
          const q = tr(`Einheit vom ${fmtDate(w.date)} inkl. aller ${a.sets} Sätze löschen?`,
            `Delete session from ${fmtDate(w.date)} incl. all ${a.sets} sets?`);
          if (confirm(q)) { await deleteWorkout(w.id); route(); }
        } }, '🗑'),
        h('span', { class: 'chev' }, '›'),
      ),
    ));
  }
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

  // Welche Übungen stecken im Trainingsplan? (für „nur Plan-Übungen behalten")
  const templates = await db.all('templates');
  const planIds = new Set();
  const planNames = new Set();
  for (const t of templates) for (const it of (t.items || [])) {
    if (it.exerciseId != null) planIds.add(it.exerciseId);
    if (it.exerciseName) planNames.add(it.exerciseName.toLowerCase());
  }
  // Sicher entfernbar: nicht im Plan UND keine erfassten Sätze.
  const unused = exercises.filter((e) =>
    (countByEx.get(e.id) || 0) === 0 && !planIds.has(e.id) && !planNames.has(e.name.toLowerCase()));

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
      if (!nameInp.value.trim()) { alert(L('Bitte Namen eingeben.')); return; }
      await db.add('exercises', { name: nameInp.value.trim(), category: catSel.value, equipment: equipInp.value.trim(), unit: 'kg' });
      route();
    } }, '+ Übung anlegen'),
  ));

  // Katalog aufräumen: ungenutzte Übungen entfernen (nur wenn es welche gibt)
  if (unused.length) {
    wrap.appendChild(h('div', { class: 'card' },
      h('h2', {}, tr('🧹 Katalog aufräumen', '🧹 Tidy catalog')),
      h('p', { class: 'muted small' }, tr(
        `${unused.length} Übungen sind nicht in deinem Trainingsplan und haben keine erfassten Sätze. So bleiben nur die Übungen übrig, die du wirklich nutzt.`,
        `${unused.length} exercises aren’t in your plan and have no logged sets. Removing them keeps only the ones you actually use.`)),
      h('button', { class: 'btn ghost danger', onclick: async () => {
        if (!confirm(tr(`${unused.length} ungenutzte Übungen entfernen?`, `Remove ${unused.length} unused exercises?`))) return;
        for (const e of unused) await db.delete('exercises', e.id);
        toast(tr('Aufgeräumt ✓', 'Tidied ✓'));
        route();
      } }, tr(`${unused.length} ungenutzte entfernen`, `Remove ${unused.length} unused`)),
    ));
  }

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

// Wiederholungs-Progression für Körpergewichts-Übungen: SUMME der
// Wiederholungen aus allen Sätzen je Einheit (Tag) als Zeitreihe.
function repsProgression(sets) {
  const byDay = new Map();
  for (const s of sets) {
    if (!(s.reps > 0) || !s.date) continue;
    byDay.set(s.date, (byDay.get(s.date) || 0) + s.reps);
  }
  const series = [...byDay.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
  const first = series.length ? series[0].value : 0;
  const current = series.length ? series[series.length - 1].value : 0;
  const best = series.length ? Math.max(...series.map((p) => p.value)) : 0;
  return { series, first, current, best, sessions: series.length, changeAbs: round1(current - first) };
}

async function renderExerciseDetail(id) {
  const ex = await db.get('exercises', id);
  const { enriched, exercises, workouts } = await loadEnrichedSets();
  const sets = enriched.filter((s) => s.exerciseId === id);
  const prog = progression(sets, FORMULA);
  // Körpergewichts-Übung (alle Sätze 0 kg, z.B. Klimmzüge) → wiederholungs-
  // basiert auswerten statt über 1RM.
  const maxW = sets.reduce((m, s) => Math.max(m, s.weight || 0), 0);
  const bodyweight = sets.length > 0 && maxW === 0;
  const repsProg = bodyweight ? repsProgression(sets) : null;

  const wrap = h('div', { class: 'view' });
  wrap.appendChild(h('a', { class: 'back', href: '#uebungen' }, '‹ Zurück zu Übungen'));
  wrap.appendChild(h('h1', {}, ex ? ex.name : 'Übung'));

  // ⭐ Als Hauptübung markieren (erscheint dann auf der Übersicht).
  if (ex) {
    const isMain = ((await db.getMeta('mainLifts', [])) || []).includes(id);
    wrap.appendChild(h('button', { class: 'btn ghost small' + (isMain ? ' on' : ''), style: 'width:auto',
      onclick: async () => {
        let ids = (await db.getMeta('mainLifts', [])) || [];
        const was = ids.includes(id);
        ids = was ? ids.filter((x) => x !== id) : [...ids, id];
        await db.setMeta('mainLifts', ids);
        toast(was ? tr('Aus Hauptübungen entfernt', 'Removed from main lifts') : tr('Als Hauptübung markiert ★', 'Marked as main lift ★'));
        route();
      } }, isMain ? tr('★ Hauptübung', '★ Main lift') : tr('☆ Als Hauptübung', '☆ Mark as main lift')));
  }

  // Übung bearbeiten (Name, Kategorie, Gerät, Pause) + löschen — eingeklappt,
  // wird erst unten angehängt.
  let editDetails = null;
  if (ex) {
    const nameE = h('input', { class: 'inp', value: ex.name });
    const catE = h('select', { class: 'inp' }, ...Object.entries(CAT_LABEL).map(([v, l]) => h('option', { value: v }, l)));
    catE.value = ex.category;
    const equipE = h('input', { class: 'inp', value: ex.equipment || '', placeholder: tr('Gerät (optional)', 'Equipment (optional)') });
    const restI = h('input', { type: 'number', step: '5', min: '0', inputmode: 'numeric', class: 'inp',
      value: ex.rest || '', placeholder: tr('Standard', 'default') });
    editDetails = h('details', { class: 'manual-details' },
      h('summary', {}, tr('✏️ Übung bearbeiten', '✏️ Edit exercise')),
      h('div', { class: 'card', style: 'margin-top:10px' },
        h('label', { class: 'field' }, h('span', {}, tr('Name', 'Name')), nameE),
        h('div', { class: 'field-row' },
          h('label', { class: 'field' }, h('span', {}, tr('Kategorie', 'Category')), catE),
          h('label', { class: 'field' }, h('span', {}, tr('Gerät', 'Equipment')), equipE),
        ),
        h('label', { class: 'field' }, h('span', {}, tr('⏱ Pause (Sek., leer = Standard)', '⏱ Rest (sec, empty = default)')), restI),
        h('button', { class: 'btn primary', onclick: async () => {
          const nm = nameE.value.trim();
          if (!nm) { alert(L('Bitte Namen eingeben.')); return; }
          ex.name = nm; ex.category = catE.value; ex.equipment = equipE.value.trim();
          const rv = parseInt(restI.value, 10); ex.rest = rv > 0 ? rv : null;
          await db.put('exercises', ex);
          toast(tr('Gespeichert ✓', 'Saved ✓'));
          route();
        } }, tr('✓ Speichern', '✓ Save')),
        h('button', { class: 'btn ghost danger', onclick: async () => {
          const n = sets.length;
          const msg = n
            ? tr(`„${ex.name}" und ${n} zugehörige Sätze löschen?`, `Delete “${ex.name}” and its ${n} sets?`)
            : tr(`„${ex.name}" löschen?`, `Delete “${ex.name}”?`);
          if (!confirm(msg)) return;
          if (n) { const all = await db.byIndex('sets', 'exerciseId', id); for (const s of all) await db.delete('sets', s.id); }
          await db.delete('exercises', id);
          location.hash = '#uebungen'; route();
        } }, tr('🗑 Übung löschen', '🗑 Delete exercise')),
      ));
  }

  // 🔀 Sätze ab einem Datum in eine andere/neue Übung verschieben — eingeklappt,
  // wird ganz unten angehängt.
  let bulkDetails = null;
  if (ex && sets.length) {
    const latestDate = sets.map((s) => s.date).filter(Boolean).sort().pop() || todayStr();
    const fromInp = h('input', { type: 'date', class: 'inp', value: latestDate });
    const others = exercises.filter((e) => e.id !== id).sort((a, b) => a.name.localeCompare(b.name));
    const targetSel = h('select', { class: 'inp' },
      h('option', { value: '__new__' }, tr('➕ Neue Übung anlegen …', '➕ Create new exercise …')),
      ...others.map((e) => h('option', { value: e.id }, `${e.name} (${CAT_LABEL[e.category] || e.category})`)));
    const newName = h('input', { class: 'inp', value: `${ex.name} (Langhantel)` });
    const newCat = h('select', { class: 'inp' }, ...Object.entries(CAT_LABEL).map(([v, l]) => h('option', { value: v }, l)));
    newCat.value = ex.category;
    const newBox = h('div', {},
      h('div', { class: 'field-row' },
        h('label', { class: 'field' }, h('span', {}, tr('Name der neuen Übung', 'New exercise name')), newName),
        h('label', { class: 'field' }, h('span', {}, tr('Kategorie', 'Category')), newCat),
      ));
    const syncNewBox = () => { newBox.style.display = targetSel.value === '__new__' ? '' : 'none'; };
    targetSel.addEventListener('change', syncNewBox); syncNewBox();

    const moveHint = h('div', { class: 'hint' }, '');
    const updateMoveHint = () => {
      const d = fromInp.value || '0000';
      const n = sets.filter((s) => (s.date || '') >= d).length;
      moveHint.textContent = tr(`${n} Sätze ab ${fmtDate(d)} werden verschoben.`, `${n} sets from ${fmtDate(d)} on will be moved.`);
    };
    fromInp.addEventListener('change', updateMoveHint); updateMoveHint();

    bulkDetails = h('details', { class: 'manual-details' },
      h('summary', {}, tr('🔀 Sätze in andere Übung verschieben', '🔀 Move sets to another exercise')),
      h('div', { class: 'card', style: 'margin-top:10px' },
        h('p', { class: 'muted small' }, tr(
          'Verschiebt alle Sätze dieser Übung ab dem gewählten Datum in eine andere (oder neue) Übung – z.B. beim Wechsel Kurzhantel → Langhantel, damit die Progression sauber getrennt bleibt.',
          'Moves all sets of this exercise from the chosen date on into another (or new) exercise — e.g. when switching dumbbell → barbell, to keep the progression clean.')),
        h('label', { class: 'field' }, h('span', {}, tr('Ab Datum (inkl.)', 'From date (incl.)')), fromInp),
        h('label', { class: 'field' }, h('span', {}, tr('Zielübung', 'Target exercise')), targetSel),
        newBox,
        moveHint,
        h('button', { class: 'btn primary', onclick: async () => {
          const d = fromInp.value;
          if (!d) { alert(L('Bitte ein Datum wählen.')); return; }
          let targetId;
          if (targetSel.value === '__new__') {
            const nm = newName.value.trim();
            if (!nm) { alert(L('Bitte Namen eingeben.')); return; }
            targetId = await db.add('exercises', { name: nm, category: newCat.value, equipment: '', unit: ex.unit || 'kg' });
          } else {
            targetId = parseInt(targetSel.value, 10);
          }
          const raw = await db.byIndex('sets', 'exerciseId', id);
          const wDate = new Map(workouts.map((w) => [w.id, w.date]));
          let moved = 0;
          for (const s of raw) {
            const sd = wDate.get(s.workoutId) || (s.ts ? dayKey(s.ts) : '');
            if (sd && sd >= d) { await db.put('sets', { ...s, exerciseId: targetId }); moved++; }
          }
          toast(tr(`${moved} Sätze verschoben ✓`, `${moved} sets moved ✓`));
          location.hash = '#uebungen?id=' + targetId; route();
        } }, tr('Verschieben', 'Move')),
      ));
  }

  // --- Coach-Hinweis zu DIESER Übung (oben, nur wenn relevant) ---
  if (prog.sessions >= 4) {
    const series = bodyweight ? repsProg.series : prog.series;
    const half = Math.floor(series.length / 2);
    const earlierBest = Math.max(...series.slice(0, half).map((p) => p.value));
    const recentBest = Math.max(...series.slice(half).map((p) => p.value));
    const unit = bodyweight ? tr('Wdh.', 'reps') : 'kg';
    const what = bodyweight ? tr('Gesamt-Wdh./Einheit', 'Total reps/session') : tr('Bestes 1RM', 'Best 1RM');
    let level, title, text;
    if (recentBest > earlierBest + (bodyweight ? 0.5 : 0.5)) {
      level = 'good'; title = tr('Im Aufwärtstrend', 'Trending up');
      text = `${what} ${earlierBest} → ${recentBest} ${unit}. ` + tr('Weiter so.', 'Keep it up.');
    } else if (recentBest < earlierBest - 0.5) {
      level = 'warn'; title = tr('Zuletzt schwächer', 'Recently weaker');
      text = `${what} ${earlierBest} → ${recentBest} ${unit}. ` + tr('Erholung/Deload prüfen.', 'Check recovery/deload.');
    } else {
      level = 'tip'; title = tr('Plateau', 'Plateau');
      text = `${what} ${tr('seit', 'for')} ${prog.sessions} ${tr('Einheiten bei ~', 'sessions around ~')}${recentBest} ${unit}. ` +
        tr('Deload oder Reiz variieren (z.B. Zusatzgewicht, Tempo).', 'Deload or vary the stimulus (added weight, tempo).');
    }
    wrap.appendChild(h('div', { class: 'card' },
      h('div', { class: 'suggestion ' + level },
        h('div', { class: 'sug-title' }, title),
        h('div', { class: 'sug-text' }, text))));
  }

  // Wirklich keine Sätze → nur Bearbeiten anbieten.
  if (sets.length === 0) {
    wrap.appendChild(h('div', { class: 'card' }, h('p', { class: 'muted' }, tr('Noch keine Sätze für diese Übung erfasst.', 'No sets logged for this exercise yet.'))));
    if (editDetails) wrap.appendChild(editDetails);
    return wrap;
  }

  // Sätze vorhanden, aber ohne auswertbare Wiederholungen (z.B. Wdh. = 0):
  // trotzdem die Historie zeigen, damit man korrigieren kann.
  if (prog.sessions === 0) {
    wrap.appendChild(h('div', { class: 'card' }, h('p', { class: 'muted' },
      tr('Für die Auswertung fehlen Wiederholungen (Wdh. = 0). Prüfe die Sätze unten und trage die Wiederholungen nach – dann erscheinen hier Verlauf und Kennzahlen.',
        'Reps are missing for the analysis (reps = 0). Check the sets below and add the reps — then charts and stats appear here.'))));
  }

  // --- Übersicht (KPIs + Charts) — nur mit auswertbaren Werten ---
  if (prog.sessions > 0 && bodyweight) {
    wrap.appendChild(h('div', { class: 'kpi-grid' },
      kpi(repsProg.current + ' ' + tr('Wdh.', 'reps'), tr('Aktuell (gesamt)', 'Current (total)')),
      kpi(repsProg.best + ' ' + tr('Wdh.', 'reps'), tr('Bestleistung (gesamt)', 'Best (total)')),
      kpi((repsProg.changeAbs >= 0 ? '+' : '') + repsProg.changeAbs, tr('Wdh. seit Start', 'reps since start')),
      kpi(String(repsProg.sessions), tr('Einheiten', 'sessions')),
    ));
    wrap.appendChild(h('div', { class: 'card' },
      h('h2', {}, '📈 ' + tr('Wiederholungen gesamt / Einheit', 'Total reps / session')),
      lineChart(repsProg.series, { color: '#4ade80', zeroBased: true }),
    ));
    // Zusatz: bester Einzelsatz je Einheit
    const maxByDay = new Map();
    for (const s of sets) { if (s.reps > 0 && s.date) maxByDay.set(s.date, Math.max(maxByDay.get(s.date) || 0, s.reps)); }
    const maxSeries = [...maxByDay.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
    wrap.appendChild(h('div', { class: 'card' },
      h('h2', {}, '📊 ' + tr('Bester Satz (Wdh.)', 'Best set (reps)')),
      lineChart(maxSeries, { color: '#60a5fa', zeroBased: true }),
    ));
  } else if (prog.sessions > 0) {
    wrap.appendChild(h('div', { class: 'kpi-grid' },
      kpi(prog.current + ' kg', tr('Aktuelles 1RM', 'Current 1RM')),
      kpi(prog.best + ' kg', tr('Bestes 1RM', 'Best 1RM')),
      kpi((prog.changePct >= 0 ? '+' : '') + prog.changePct + '%', tr('seit Start', 'since start')),
      kpi((prog.slopePerWeek >= 0 ? '+' : '') + prog.slopePerWeek, tr('kg/Woche', 'kg/week')),
    ));
    wrap.appendChild(h('div', { class: 'card' },
      h('h2', {}, '📈 ' + tr('Geschätztes 1RM', 'Estimated 1RM')),
      lineChart(prog.series, { color: '#4ade80' }),
    ));
    const volByDay = new Map();
    for (const s of sets) { const k = s.date; volByDay.set(k, (volByDay.get(k) || 0) + s.weight * s.reps); }
    const volSeries = [...volByDay.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date));
    wrap.appendChild(h('div', { class: 'card' },
      h('h2', {}, '📊 ' + tr('Volumen je Einheit', 'Volume per session')),
      lineChart(volSeries, { color: '#60a5fa', zeroBased: true }),
    ));
  }

  // Historie – nach Trainingstag gruppiert (neueste zuerst), je Tag die Sätze.
  const hist = h('div', { class: 'card' }, h('h2', {}, tr('Historie', 'History')));
  const byDay = new Map();
  for (const s of sets) {
    const k = s.date || (s.ts ? dayKey(s.ts) : '—');
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(s);
  }
  const days = [...byDay.keys()].sort((a, b) => b.localeCompare(a)).slice(0, 30);
  for (const d of days) {
    const daySets = byDay.get(d).sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const dayHead = bodyweight
      ? `${daySets.reduce((a, s) => a + (s.reps || 0), 0)} ${tr('Wdh. gesamt', 'total reps')}`
      : (() => { const b = bestE1rm(daySets, FORMULA).value; return b ? 'e1RM ' + b + ' kg' : ''; })();
    const group = h('div', { class: 'ex-group' },
      h('div', { class: 'ex-group-head' },
        h('strong', {}, `${weekdayShort(d)}, ${fmtDate(d)}`),
        h('span', { class: 'muted small' }, `${daySets.length} ${tr('Sätze', 'sets')}${dayHead ? ' · ' + dayHead : ''}`),
      ),
    );
    daySets.forEach((s, i) => {
      const load = (bodyweight || !(s.weight > 0)) ? `${s.reps} ${tr('Wdh.', 'reps')}` : `${s.weight} kg × ${s.reps}`;
      const line = h('div', { class: 'set-line' },
        h('span', { class: 'set-no' }, `${tr('Satz', 'Set')} ${i + 1}`),
        h('strong', { class: 'set-load' }, load),
      );
      const badge = tendBadge(s.tendency);
      if (badge) line.appendChild(badge);
      const sub = (bodyweight || !(s.weight > 0))
        ? (s.rpe ? 'RPE ' + s.rpe : '')
        : `e1RM ${round1(e1rm(s.weight, s.reps, FORMULA))} kg${s.rpe ? ' · RPE ' + s.rpe : ''}`;
      group.appendChild(h('div', { class: 'set-item' },
        h('div', { class: 'set-main' }, line,
          sub ? h('div', { class: 'muted small' }, sub) : '')),
      );
    });
    hist.appendChild(group);
  }
  wrap.appendChild(hist);

  // Bearbeiten + Bulk-Op ganz unten, eingeklappt.
  if (editDetails) wrap.appendChild(editDetails);
  if (bulkDetails) wrap.appendChild(bulkDetails);
  return wrap;
}

// ==================================================================
//  TRAININGSPLÄNE (Vorlagen)
// ==================================================================
async function renderPlans() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const editId = params.get('edit');
  if (editId) return renderPlanEdit(parseInt(editId, 10));

  const templates = [...await db.all('templates')];
  const wrap = h('div', { class: 'view' });
  wrap.appendChild(h('a', { class: 'back', href: '#einstellungen' }, '‹ Zurück zu Mehr'));
  wrap.appendChild(h('h1', {}, 'Trainingspläne'));

  if (!templates.length) {
    wrap.appendChild(h('div', { class: 'card' },
      h('p', { class: 'muted' }, 'Noch kein Plan installiert.'),
      h('button', { class: 'btn primary', onclick: async () => { await installPlan(db); route(); } },
        `${PLAN.name} installieren`),
    ));
    return wrap;
  }

  // Info-Karte: Wochenplan + Progression
  wrap.appendChild(h('div', { class: 'card' },
    h('h2', {}, '🗓️ ' + PLAN.name),
    h('div', { class: 'muted small' }, PLAN.schedule),
    h('div', { class: 'sug-text', style: 'margin-top:8px' }, PLAN.progressionNote),
  ));

  for (const t of templates) {
    const card = h('div', { class: 'card' },
      h('div', { class: 'chart-head' },
        h('h2', {}, t.name),
        h('div', { class: 'seg' },
          h('button', { class: 'btn ghost small', onclick: () => go(`#plaene?edit=${t.id}`) }, tr('✎ Bearbeiten', '✎ Edit')),
          h('button', { class: 'btn primary small', onclick: async () => {
            const wid = await db.add('workouts', { date: todayStr(), notes: '', templateName: t.name, plan: t.items });
            await db.setMeta('currentWorkout', wid);
            go('#training');
          } }, '▶ Starten'),
        ),
      ),
    );
    for (const it of t.items) {
      card.appendChild(h('div', { class: 'row-item static' },
        h('div', {}, h('strong', {}, it.exerciseName),
          h('div', { class: 'muted small' }, `${it.scheme} · Pause ${it.rest}${it.note ? ' · ' + it.note : ''}`)),
      ));
    }
    wrap.appendChild(card);
  }

  wrap.appendChild(h('button', { class: 'btn ghost', onclick: async () => {
    if (confirm(L('Plan auf den Ausgangszustand zurücksetzen? Deine eigenen Änderungen an den Plänen gehen dabei verloren (deine Trainingsdaten bleiben erhalten).'))) {
      await installPlan(db); route();
    }
  } }, 'Plan auf Original zurücksetzen'));
  return wrap;
}

// Plan-Editor: einen Trainingstag (Vorlage) anpassen – Name, Übungen,
// Schema, Pause, Notiz; Übungen hinzufügen, entfernen, umsortieren.
async function renderPlanEdit(templateId) {
  const t = await db.get('templates', templateId);
  const exercises = [...await db.all('exercises')].sort((a, b) => a.name.localeCompare(b.name));
  const wrap = h('div', { class: 'view' });
  wrap.appendChild(h('a', { class: 'back', href: '#plaene' }, tr('‹ Zurück zu Trainingspläne', '‹ Back to plans')));

  if (!t) {
    wrap.appendChild(h('div', { class: 'card' }, h('p', { class: 'muted' }, tr('Plan nicht gefunden.', 'Plan not found.'))));
    return wrap;
  }
  if (!exercises.length) {
    wrap.appendChild(h('div', { class: 'card' }, h('p', { class: 'muted' },
      tr('Erst eine Übung anlegen (unter „Übungen").', 'Add an exercise first (under “Exercises”).'))));
    return wrap;
  }

  wrap.appendChild(h('h1', {}, tr('Plan bearbeiten', 'Edit plan')));

  // Arbeitskopie der Übungen dieses Tages.
  let items = (t.items || []).map((x) => ({ ...x }));
  const defExId = exercises[0].id;

  const nameInp = h('input', { class: 'inp', value: t.name });
  wrap.appendChild(h('div', { class: 'card' },
    h('label', { class: 'field' }, h('span', {}, tr('Name des Trainingstags', 'Name of the day')), nameInp)));

  const listCard = h('div', { class: 'card' }, h('h2', {}, tr('Übungen', 'Exercises')));
  const listBox = h('div', {});
  listCard.appendChild(listBox);

  function renderList() {
    clear(listBox);
    if (!items.length) {
      listBox.appendChild(h('p', { class: 'muted small' }, tr('Noch keine Übung. Unten hinzufügen.', 'No exercise yet. Add one below.')));
    }
    items.forEach((it, i) => {
      const exSel = h('select', { class: 'inp' },
        ...exercises.map((e) => h('option', { value: e.id }, `${e.name} (${CAT_LABEL[e.category] || e.category})`)));
      exSel.value = it.exerciseId != null ? it.exerciseId : defExId;
      exSel.addEventListener('change', () => {
        it.exerciseId = parseInt(exSel.value, 10);
        const ex = exercises.find((e) => e.id === it.exerciseId);
        it.exerciseName = ex ? ex.name : it.exerciseName;
      });
      const schemeInp = h('input', { class: 'inp', value: it.scheme || '', placeholder: tr('z.B. 3×8-10', 'e.g. 3×8-10') });
      schemeInp.addEventListener('input', () => { it.scheme = schemeInp.value; });
      const restInp = h('input', { class: 'inp', value: it.rest || '', placeholder: tr('z.B. 90s', 'e.g. 90s') });
      restInp.addEventListener('input', () => { it.rest = restInp.value; });
      const noteInp = h('input', { class: 'inp', value: it.note || '', placeholder: tr('Notiz (optional)', 'Note (optional)') });
      noteInp.addEventListener('input', () => { it.note = noteInp.value.trim() || null; });

      const up = h('button', { class: 'btn ghost small', onclick: () => { if (i > 0) { [items[i - 1], items[i]] = [items[i], items[i - 1]]; renderList(); } } }, '↑');
      const down = h('button', { class: 'btn ghost small', onclick: () => { if (i < items.length - 1) { [items[i + 1], items[i]] = [items[i], items[i + 1]]; renderList(); } } }, '↓');
      const del = h('button', { class: 'btn ghost small danger', onclick: () => { items.splice(i, 1); renderList(); } }, '✕');

      listBox.appendChild(h('div', { class: 'card', style: 'background:var(--bg-elev); margin-bottom:12px' },
        h('div', { class: 'chart-head' },
          h('span', { class: 'muted small' }, `#${i + 1}`),
          h('div', { class: 'seg' }, up, down, del),
        ),
        h('label', { class: 'field' }, h('span', {}, tr('Übung', 'Exercise')), exSel),
        h('div', { class: 'field-row' },
          h('label', { class: 'field' }, h('span', {}, tr('Schema (Sätze×Wdh.)', 'Scheme (sets×reps)')), schemeInp),
          h('label', { class: 'field' }, h('span', {}, tr('Pause', 'Rest')), restInp),
        ),
        h('label', { class: 'field' }, h('span', {}, tr('Notiz', 'Note')), noteInp),
      ));
    });
  }
  renderList();

  listCard.appendChild(h('button', { class: 'btn ghost', onclick: () => {
    const ex = exercises[0];
    items.push({ exerciseId: ex.id, exerciseName: ex.name, scheme: '3×8-10', rest: '90s', note: null });
    renderList();
  } }, tr('+ Übung hinzufügen', '+ Add exercise')));
  wrap.appendChild(listCard);

  wrap.appendChild(h('button', { class: 'btn primary', onclick: async () => {
    const clean = items.map((it) => {
      const ex = exercises.find((e) => e.id === it.exerciseId) || exercises[0];
      return { exerciseId: ex.id, exerciseName: ex.name, scheme: (it.scheme || '').trim() || '3×8-10', rest: (it.rest || '').trim() || '90s', note: it.note || null };
    });
    await db.put('templates', { ...t, name: nameInp.value.trim() || t.name, items: clean });
    toast(tr('Plan gespeichert ✓', 'Plan saved ✓'));
    go('#plaene');
  } }, tr('✓ Speichern', '✓ Save')));

  return wrap;
}

// ==================================================================
//  FORTSCHRITT (Forecast + Milestones)
// ==================================================================
async function renderProgress() {
  const { enriched, exercises } = await loadEnrichedSets();
  const goals = [...await db.all('goals')];
  const wrap = h('div', { class: 'view' });
  wrap.appendChild(h('a', { class: 'back', href: '#dashboard' }, tr('‹ Zurück', '‹ Back')));
  wrap.appendChild(h('h1', {}, tr('Fortschritt', 'Progress')));

  const byEx = new Map();
  for (const s of enriched) { if (!byEx.has(s.exerciseId)) byEx.set(s.exerciseId, []); byEx.get(s.exerciseId).push(s); }
  const progById = new Map();
  for (const [exId, ss] of byEx) progById.set(exId, progression(ss, FORMULA));

  // ----- Eigene Ziele (mit Termin) -----
  const DAY = 86400000;
  const goalsCard = h('div', { class: 'card' }, h('h2', {}, tr('🎯 Deine Ziele', '🎯 Your goals')));
  for (const g of goals.sort((a, b) => (a.deadline || '').localeCompare(b.deadline || ''))) {
    const prog = progById.get(g.exerciseId);
    const cur = prog ? prog.current : 0;
    const pct = Math.max(0, Math.min(100, Math.round((cur / g.target) * 100)));
    const daysLeft = g.deadline ? Math.round((new Date(g.deadline) - new Date(todayStr())) / DAY) : null;
    const wtt = prog ? weeksToTarget(prog, g.target) : null;
    let status, cls;
    if (cur >= g.target) { status = tr('erreicht ✓', 'reached ✓'); cls = 'up'; }
    else if (wtt != null && daysLeft != null && wtt * 7 <= daysLeft) { status = tr('auf Kurs', 'on track'); cls = 'up'; }
    else { status = tr('dranbleiben', 'push harder'); cls = 'down'; }
    const dText = daysLeft == null ? '' :
      daysLeft > 0 ? tr(`noch ${daysLeft} Tage`, `${daysLeft} days left`) :
      daysLeft === 0 ? tr('heute!', 'today!') : tr(`${-daysLeft} Tage überfällig`, `${-daysLeft} days overdue`);
    goalsCard.appendChild(h('div', { class: 'goal' },
      h('div', { class: 'chart-head' },
        h('strong', {}, `${g.exerciseName}: ${cur} → ${g.target} kg`),
        h('button', { class: 'btn ghost small danger', onclick: async () => { await db.delete('goals', g.id); route(); } }, '✕')),
      h('div', { class: 'pbar' }, h('i', { style: `width:${pct}%` })),
      h('div', { class: 'muted small', style: 'margin-top:4px' },
        h('span', { class: 'delta ' + cls }, status), ` · ${dText}` +
        (g.deadline ? ' · ' + fmtDate(g.deadline) : '') +
        (wtt != null && cur < g.target ? ' · ' + tr(`Trend: ~${wtt} Wochen`, `trend: ~${wtt} weeks`) : '')),
    ));
  }
  // Ziel hinzufügen
  const gEx = h('select', { class: 'inp' },
    ...exercises.map((e) => h('option', { value: e.id }, e.name)));
  const gTarget = h('input', { type: 'number', step: '2.5', inputmode: 'decimal', class: 'inp', placeholder: tr('Ziel-1RM (kg)', 'target 1RM (kg)') });
  const gDate = h('input', { type: 'date', class: 'inp' });
  goalsCard.appendChild(h('details', { class: 'goal-add' },
    h('summary', {}, tr('+ Ziel hinzufügen', '+ Add goal')),
    h('label', { class: 'field' }, h('span', {}, tr('Übung', 'Exercise')), gEx),
    h('div', { class: 'field-row' },
      h('label', { class: 'field' }, h('span', {}, tr('Ziel (kg)', 'Target (kg)')), gTarget),
      h('label', { class: 'field' }, h('span', {}, tr('Termin', 'Deadline')), gDate)),
    h('button', { class: 'btn primary', onclick: async () => {
      const t = parseFloat(gTarget.value);
      if (!(t > 0)) { alert(tr('Bitte ein Ziel-Gewicht eingeben.', 'Please enter a target weight.')); return; }
      const exId = parseInt(gEx.value, 10);
      const exName = (exercises.find((e) => e.id === exId) || {}).name || '';
      await db.add('goals', { exerciseId: exId, exerciseName: exName, target: t, deadline: gDate.value || null, createdAt: Date.now() });
      route();
    } }, tr('Ziel speichern', 'Save goal')),
  ));
  wrap.appendChild(goalsCard);

  // ----- Automatische Ziele je Übung (Meilenstein aus deinen Bestwerten) -----
  const items = [...byEx.entries()]
    .map(([id, sets]) => ({ id, name: sets[0].exerciseName, sets, prog: progById.get(id), best: bestE1rm(sets, FORMULA).value }))
    .filter((p) => p.prog.sessions >= 3 && p.best > 0)
    .sort((a, b) => b.sets.length - a.sets.length)   // meist trainierte = relevanteste zuerst
    .slice(0, 6);

  if (!items.length) {
    wrap.appendChild(h('div', { class: 'card' }, h('p', { class: 'muted' },
      tr('Erfasse mind. 3 Einheiten pro Übung – dann setzt dir die App hier automatisch Ziele.',
         'Log at least 3 sessions per exercise — then the app sets automatic goals here.'))));
    return wrap;
  }

  wrap.appendChild(h('p', { class: 'muted small' }, tr(
    'Je Übung ein konkretes nächstes Ziel als Gewicht × Wiederholungen – daran kannst du dich im Training direkt messen. Dazu der nächste kleine Schritt dorthin.',
    'For each exercise a concrete next goal as weight × reps — something you can actually attempt in the gym — plus the next small step toward it.')));

  for (const it of items) {
    const p = it.prog;
    const best = it.best;                                  // bestes e1RM
    const bestSet = bestE1rm(it.sets, FORMULA).set;        // der zugehörige reale Satz
    const target = nextMilestone(best);                    // nächster Meilenstein (1RM)
    const ms = milestoneProgress(best);
    const reached = best >= target;
    const slope = p.slopePerWeek;
    const etaWeeks = slope > 0 ? Math.ceil((target - best) / slope) : null;

    // Trainings-Wiederholungszahl: so, wie er die Übung zuletzt am besten machte.
    const reps = bestSet && bestSet.reps > 0 ? bestSet.reps : 5;
    const curW = bestSet ? bestSet.weight : 0;
    const targetW = roundToStep(weightForReps(target, reps, FORMULA));

    // Konkreter nächster Schritt (klein & machbar): +1 Wdh. oder +2,5 kg.
    const stepA = `${round1(curW)} kg × ${reps + 1}`;
    const stepB = `${round1(curW + 2.5)} kg × ${reps}`;

    // Alternative Ziel-Schemata (gleiches 1RM, andere Wdh.).
    const altReps = [3, 5, 8, 10].filter((r) => r !== reps).slice(0, 2);
    const alts = altReps.map((r) => `${roundToStep(weightForReps(target, r, FORMULA))}×${r}`).join(' · ');

    const etaTxt = reached
      ? tr('Nächste Stufe erreicht 🎉 – neue folgt automatisch', 'Next level reached 🎉 — a new one follows automatically')
      : etaWeeks != null
        ? tr(`Bei aktuellem Tempo: in ~${etaWeeks} Wochen`, `At current pace: in ~${etaWeeks} weeks`)
        : tr('Trend gerade flach – hier lohnt sich der Fokus', 'Trend flat right now — worth focusing here');

    wrap.appendChild(h('div', { class: 'card' },
      h('div', { class: 'chart-head' },
        h('h2', {}, it.name),
        h('span', { class: slope >= 0 ? 'delta up' : 'delta down' },
          (slope >= 0 ? '+' : '') + slope + ' kg/' + tr('Wo.', 'wk'))),
      // Konkretes Ziel: Gewicht × Wiederholungen (daran kannst du dich messen)
      h('div', { class: 'goal-progress' },
        h('strong', {}, curW ? `${round1(curW)} kg × ${reps}` : `${best} kg`),
        h('span', { class: 'muted' }, ' → '),
        h('strong', { class: 'goal-target' }, `${targetW} kg × ${reps}`)),
      h('div', { class: 'pbar' }, h('i', { style: `width:${reached ? 100 : ms.pct}%` })),
      h('div', { class: 'muted small', style: 'margin-top:6px' },
        tr('Nächster Schritt: ', 'Next step: ') + stepA + tr(' oder ', ' or ') + stepB),
      alts ? h('div', { class: 'muted small' }, tr('Gleiches Ziel auch als: ', 'Same goal also as: ') + alts) : '',
      h('div', { class: 'muted small', style: 'margin-top:4px' }, etaTxt +
        ` · ${tr('Meilenstein', 'milestone')} ${target} kg 1RM`),
    ));
  }
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
  const shoulderI = h('input', { type: 'number', step: '0.1', class: 'inp', placeholder: 'cm' });
  const chestI = h('input', { type: 'number', step: '0.1', class: 'inp', placeholder: 'cm' });
  const waistI = h('input', { type: 'number', step: '0.1', class: 'inp', placeholder: 'cm' });
  const neckI = h('input', { type: 'number', step: '0.1', class: 'inp', placeholder: 'cm' });
  const armI = h('input', { type: 'number', step: '0.1', class: 'inp', placeholder: 'cm' });
  const thighI = h('input', { type: 'number', step: '0.1', class: 'inp', placeholder: 'cm' });
  const bfI = h('input', { type: 'number', step: '0.1', inputmode: 'decimal', class: 'inp', placeholder: tr('% (leer = aus Maßen schätzen)', '% (empty = estimate from measures)') });

  // Körpergröße + Geschlecht einmalig (aus Meta), für die KFA-Schätzung.
  const heightVal = parseFloat(await db.getMeta('height', '')) || '';
  const sexVal = await db.getMeta('sex', 'male');
  const heightI = h('input', { type: 'number', step: '0.5', inputmode: 'decimal', class: 'inp', placeholder: 'cm', value: heightVal });
  heightI.addEventListener('change', async () => { const v = parseFloat(heightI.value); await db.setMeta('height', v > 0 ? v : ''); });
  const sexSel = h('select', { class: 'inp' },
    h('option', { value: 'male', ...(sexVal !== 'female' ? { selected: '' } : {}) }, tr('männlich', 'male')),
    h('option', { value: 'female', ...(sexVal === 'female' ? { selected: '' } : {}) }, tr('weiblich', 'female')));
  sexSel.addEventListener('change', () => db.setMeta('sex', sexSel.value));

  const bfHint = h('div', { class: 'hint' }, '');
  const estimateBf = () => navyBodyFat({
    sex: sexSel.value,
    waist: parseFloat(waistI.value),
    neck: parseFloat(neckI.value),
    heightCm: parseFloat(heightI.value),
  });
  const updateBfHint = () => {
    if (bfI.value) { bfHint.textContent = ''; return; }
    const est = estimateBf();
    bfHint.textContent = est != null
      ? tr(`Geschätzt (US-Navy): ${est} % Körperfett`, `Estimated (US Navy): ${est} % body fat`)
      : tr('Für die Schätzung: Größe, Taille und Nacken ausfüllen.', 'For the estimate: fill in height, waist and neck.');
  };
  [waistI, neckI, heightI, bfI].forEach((i) => i.addEventListener('input', updateBfHint));
  sexSel.addEventListener('change', updateBfHint);
  updateBfHint();

  wrap.appendChild(h('div', { class: 'card' },
    h('h2', {}, 'Neuer Eintrag'),
    h('label', { class: 'field' }, h('span', {}, 'Datum'), dateI),
    h('label', { class: 'field' }, h('span', {}, 'Körpergewicht (kg)'), wI),
    h('div', { class: 'field-row' },
      h('label', { class: 'field' }, h('span', {}, 'Schulter'), shoulderI),
      h('label', { class: 'field' }, h('span', {}, 'Brust'), chestI),
    ),
    h('div', { class: 'field-row' },
      h('label', { class: 'field' }, h('span', {}, 'Taille'), waistI),
      h('label', { class: 'field' }, h('span', {}, 'Nacken'), neckI),
    ),
    h('div', { class: 'field-row' },
      h('label', { class: 'field' }, h('span', {}, 'Arm'), armI),
      h('label', { class: 'field' }, h('span', {}, 'Oberschenkel'), thighI),
    ),
    h('label', { class: 'field' }, h('span', {}, tr('Körperfett % (optional)', 'Body fat % (optional)')), bfI),
    bfHint,
    // Einmal-Einstellungen für die Körperfett-Schätzung – eingeklappt.
    h('details', { class: 'manual-details' },
      h('summary', {}, tr('⚙️ Größe & Geschlecht (für die Schätzung, einmalig)', '⚙️ Height & sex (for the estimate, one-time)')),
      h('div', { class: 'field-row', style: 'margin-top:10px' },
        h('label', { class: 'field' }, h('span', {}, tr('Körpergröße (cm)', 'Height (cm)')), heightI),
        h('label', { class: 'field' }, h('span', {}, tr('Geschlecht', 'Sex')), sexSel),
      )),
    h('button', { class: 'btn primary', onclick: async () => {
      const weight = parseFloat(wI.value);
      const bfManual = parseFloat(bfI.value);
      const bf = !isNaN(bfManual) ? round1(bfManual) : estimateBf();
      if (!(weight > 0) && !shoulderI.value && !waistI.value && !neckI.value && !(bf != null)) {
        alert(L('Bitte mindestens einen Wert eingeben.')); return;
      }
      await db.add('body', {
        date: dateI.value || todayStr(),
        weight: weight || null,
        shoulder: num(shoulderI.value),
        chest: num(chestI.value), waist: num(waistI.value), neck: num(neckI.value),
        arm: num(armI.value), thigh: num(thighI.value),
        bodyfat: bf != null ? bf : null,
      });
      route();
    } }, '+ Speichern'),
  ));

  if (rows.length >= 2) {
    const series = [...rows].reverse().filter((r) => r.weight).map((r) => ({ date: r.date, value: r.weight }));
    if (series.length >= 2) wrap.appendChild(h('div', { class: 'card' }, h('h2', {}, '⚖️ Gewichtsverlauf'), lineChart(series, { color: '#60a5fa' })));
    const bfSeries = [...rows].reverse().filter((r) => r.bodyfat).map((r) => ({ date: r.date, value: r.bodyfat }));
    if (bfSeries.length >= 2) wrap.appendChild(h('div', { class: 'card' }, h('h2', {}, tr('📉 Körperfett-Verlauf', '📉 Body-fat trend')), lineChart(bfSeries, { color: '#f472b6' })));
  }

  const list = h('div', { class: 'card' }, h('h2', {}, 'Einträge'));
  if (!rows.length) list.appendChild(h('p', { class: 'muted' }, 'Noch keine Einträge.'));
  for (const r of rows.slice(0, 60)) list.appendChild(makeBodyRow(r));
  wrap.appendChild(list);
  return wrap;

  // Körper-Eintrag mit Anzeige- und Bearbeiten-Modus.
  function makeBodyRow(r) {
    const row = h('div', { class: 'set-item' });
    const showView = () => {
      clear(row);
      const parts = [r.weight ? r.weight + ' kg' : null, r.bodyfat ? 'KFA ' + r.bodyfat + '%' : null,
        r.shoulder ? 'Schulter ' + r.shoulder : null, r.chest ? 'Brust ' + r.chest : null,
        r.waist ? 'Taille ' + r.waist : null, r.neck ? 'Nacken ' + r.neck : null,
        r.arm ? 'Arm ' + r.arm : null, r.thigh ? 'OSchenkel ' + r.thigh : null].filter(Boolean);
      row.appendChild(h('div', { class: 'set-main' },
        h('strong', {}, `${weekdayShort(r.date)}, ${fmtDate(r.date)}`),
        h('div', { class: 'muted small' }, parts.length ? parts.join(' · ') : tr('keine Werte', 'no values'))));
      row.appendChild(h('button', { class: 'btn ghost small', onclick: showEdit, title: tr('Bearbeiten', 'Edit') }, '✎'));
      row.appendChild(h('button', { class: 'btn ghost small danger', onclick: async () => { await db.delete('body', r.id); route(); } }, '✕'));
    };
    const showEdit = () => {
      clear(row);
      const mk = (val) => h('input', { type: 'number', step: '0.1', inputmode: 'decimal', class: 'inp', value: val ?? '' });
      const dE = h('input', { type: 'date', class: 'inp', value: r.date || todayStr() });
      const wE = mk(r.weight), bfE = mk(r.bodyfat), shE = mk(r.shoulder), chE = mk(r.chest);
      const waE = mk(r.waist), neE = mk(r.neck), arE = mk(r.arm), thE = mk(r.thigh);
      const fr = (a, la, b, lb) => h('div', { class: 'field-row' },
        h('label', { class: 'field' }, h('span', {}, la), a),
        h('label', { class: 'field' }, h('span', {}, lb), b));
      row.appendChild(h('div', { class: 'set-main', style: 'width:100%' },
        h('label', { class: 'field' }, h('span', {}, tr('Datum', 'Date')), dE),
        fr(wE, tr('Gewicht (kg)', 'Weight (kg)'), bfE, tr('Körperfett %', 'Body fat %')),
        fr(shE, 'Schulter', chE, 'Brust'),
        fr(waE, 'Taille', neE, 'Nacken'),
        fr(arE, 'Arm', thE, 'Oberschenkel'),
        h('div', { class: 'seg', style: 'margin-top:4px' },
          h('button', { class: 'btn primary small', onclick: async () => {
            await db.put('body', { ...r, date: dE.value || r.date,
              weight: num(wE.value), bodyfat: num(bfE.value), shoulder: num(shE.value), chest: num(chE.value),
              waist: num(waE.value), neck: num(neE.value), arm: num(arE.value), thigh: num(thE.value) });
            toast(tr('Gespeichert ✓', 'Saved ✓'));
            route();
          } }, tr('✓ Speichern', '✓ Save')),
          h('button', { class: 'btn ghost small', onclick: showView }, tr('Abbrechen', 'Cancel')),
        ),
      ));
    };
    showView();
    return row;
  }
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
      if (!protI.value && !kcalI.value) { alert(L('Bitte Protein oder Kalorien eingeben.')); return; }
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
// Tempo aus Distanz (km) + Dauer (Min.) als "M:SS /km".
function paceStr(distanceKm, durationMin) {
  if (!(distanceKm > 0) || !(durationMin > 0)) return null;
  const perKm = durationMin / distanceKm;
  const m = Math.floor(perKm), s = Math.round((perKm - m) * 60);
  return `${m}:${String(s).padStart(2, '0')} /km`;
}
function activityParts(r) {
  return [
    r.steps ? `${r.steps.toLocaleString('de-DE')} ${tr('Schritte', 'steps')}` : null,
    r.distance ? `🏃 ${r.distance} km` : null,
    r.duration ? `${r.duration} ${tr('Min.', 'min')}` : null,
    paceStr(r.distance, r.duration),
  ].filter(Boolean).join(' · ');
}

async function renderActivity() {
  const rows = [...await db.all('activity')].sort((a, b) => b.date.localeCompare(a.date));
  const wrap = h('div', { class: 'view' });
  wrap.appendChild(h('h1', {}, tr('Aktivität', 'Activity')));

  const dateI = h('input', { type: 'date', value: todayStr(), class: 'inp' });
  const stepI = selectOnFocus(h('input', { type: 'text', inputmode: 'numeric', class: 'inp', placeholder: tr('Schritte (optional)', 'Steps (optional)') }));
  const distI = selectOnFocus(h('input', { type: 'text', inputmode: 'decimal', class: 'inp', placeholder: tr('Distanz km (optional)', 'Distance km (optional)') }));
  const durI = selectOnFocus(h('input', { type: 'text', inputmode: 'numeric', class: 'inp', placeholder: tr('Dauer Min. (optional)', 'Duration min (optional)') }));
  const runHint = h('div', { class: 'hint' }, '');
  const updateRunHint = () => { const p = paceStr(parseFloat(distI.value), parseFloat(durI.value)); runHint.textContent = p ? tr('Tempo: ', 'Pace: ') + p : ''; };
  distI.addEventListener('input', updateRunHint); durI.addEventListener('input', updateRunHint);

  wrap.appendChild(h('div', { class: 'card' },
    h('h2', {}, tr('Neuer Eintrag', 'New entry')),
    h('p', { class: 'muted small' }, tr('Schritte und/oder eine Laufeinheit (Distanz + Dauer) erfassen.', 'Log steps and/or a run (distance + duration).')),
    h('label', { class: 'field' }, h('span', {}, tr('Datum', 'Date')), dateI),
    h('label', { class: 'field' }, h('span', {}, tr('Schritte', 'Steps')), stepI),
    h('div', { class: 'field-row' },
      h('label', { class: 'field' }, h('span', {}, tr('🏃 Distanz (km)', '🏃 Distance (km)')), distI),
      h('label', { class: 'field' }, h('span', {}, tr('Dauer (Min.)', 'Duration (min)')), durI),
    ),
    runHint,
    h('button', { class: 'btn primary', onclick: async () => {
      const steps = num(stepI.value), distance = num(distI.value), duration = num(durI.value);
      if (!steps && !distance && !duration) { alert(tr('Bitte Schritte oder eine Laufeinheit eingeben.', 'Please enter steps or a run.')); return; }
      await db.add('activity', { date: dateI.value || todayStr(), steps, distance, duration });
      toast(tr('Gespeichert ✓', 'Saved ✓'));
      stepI.value = ''; distI.value = ''; durI.value = ''; runHint.textContent = '';
      route();
    } }, '+ Speichern'),
  ));

  const stepSeries = rows.filter((r) => r.steps > 0).sort((a, b) => a.date.localeCompare(b.date)).map((r) => ({ date: r.date, value: r.steps }));
  if (stepSeries.length >= 2) {
    wrap.appendChild(h('div', { class: 'card' }, h('h2', {}, '👟 ' + tr('Schritte-Verlauf', 'Steps trend')), lineChart(stepSeries, { color: '#fbbf24' })));
  }
  const runSeries = rows.filter((r) => r.distance > 0).sort((a, b) => a.date.localeCompare(b.date)).map((r) => ({ date: r.date, value: r.distance }));
  if (runSeries.length >= 2) {
    wrap.appendChild(h('div', { class: 'card' }, h('h2', {}, '🏃 ' + tr('Distanz je Lauf', 'Distance per run')), lineChart(runSeries, { color: '#4ade80', zeroBased: true })));
  }

  const list = h('div', { class: 'card' }, h('h2', {}, tr('Einträge', 'Entries')));
  if (!rows.length) list.appendChild(h('p', { class: 'muted' }, tr('Noch keine Einträge.', 'No entries yet.')));
  for (const r of rows.slice(0, 40)) list.appendChild(makeActivityRow(r));
  wrap.appendChild(list);
  return wrap;

  // Aktivitäts-Eintrag mit Anzeige- und Bearbeiten-Modus.
  function makeActivityRow(r) {
    const row = h('div', { class: 'set-item' });
    const showView = () => {
      clear(row);
      row.appendChild(h('div', { class: 'set-main' },
        h('strong', {}, `${weekdayShort(r.date)}, ${fmtDate(r.date)}`),
        h('div', { class: 'muted small' }, activityParts(r) || tr('keine Werte', 'no values'))));
      row.appendChild(h('button', { class: 'btn ghost small', onclick: showEdit, title: tr('Bearbeiten', 'Edit') }, '✎'));
      row.appendChild(h('button', { class: 'btn ghost small danger', onclick: async () => { await db.delete('activity', r.id); route(); } }, '✕'));
    };
    const showEdit = () => {
      clear(row);
      const dE = h('input', { type: 'date', class: 'inp', value: r.date || todayStr() });
      const sE = selectOnFocus(h('input', { type: 'text', inputmode: 'numeric', class: 'inp', value: r.steps ?? '', placeholder: tr('Schritte', 'Steps') }));
      const dsE = selectOnFocus(h('input', { type: 'text', inputmode: 'decimal', class: 'inp', value: r.distance ?? '', placeholder: tr('Distanz km', 'Distance km') }));
      const duE = selectOnFocus(h('input', { type: 'text', inputmode: 'numeric', class: 'inp', value: r.duration ?? '', placeholder: tr('Dauer Min.', 'Duration min') }));
      row.appendChild(h('div', { class: 'set-main', style: 'width:100%' },
        h('label', { class: 'field' }, h('span', {}, tr('Datum', 'Date')), dE),
        h('label', { class: 'field' }, h('span', {}, tr('Schritte', 'Steps')), sE),
        h('div', { class: 'field-row' },
          h('label', { class: 'field' }, h('span', {}, tr('Distanz (km)', 'Distance (km)')), dsE),
          h('label', { class: 'field' }, h('span', {}, tr('Dauer (Min.)', 'Duration (min)')), duE),
        ),
        h('div', { class: 'seg' },
          h('button', { class: 'btn primary small', onclick: async () => {
            await db.put('activity', { ...r, date: dE.value || r.date, steps: num(sE.value), distance: num(dsE.value), duration: num(duE.value) });
            toast(tr('Gespeichert ✓', 'Saved ✓'));
            route();
          } }, tr('✓ Speichern', '✓ Save')),
          h('button', { class: 'btn ghost small', onclick: showView }, tr('Abbrechen', 'Cancel')),
        ),
      ));
    };
    showView();
    return row;
  }
}

// ==================================================================
//  EINSTELLUNGEN / BACKUP
// ==================================================================
async function renderSettings() {
  const wrap = h('div', { class: 'view' });
  wrap.appendChild(h('h1', {}, 'Mehr'));

  // Aussehen: Theme + Akzentfarbe
  const curTheme = await db.getMeta('theme', DEFAULT_THEME);
  const curAccent = await db.getMeta('accent', DEFAULT_ACCENT);
  const darkBtn = h('button', { class: 'btn ghost' + (curTheme === 'dark' ? ' on' : '') }, '🌙 Dunkel');
  const lightBtn = h('button', { class: 'btn ghost' + (curTheme === 'light' ? ' on' : '') }, '☀️ Hell');
  const retroBtn = h('button', { class: 'btn ghost' + (curTheme === 'retro' ? ' on' : '') }, tr('🕹️ Retro', '🕹️ Retro'));
  const setMode = async (mode) => { await db.setMeta('theme', mode); applyTheme(mode, await db.getMeta('accent', DEFAULT_ACCENT)); route(); };
  darkBtn.onclick = () => setMode('dark');
  lightBtn.onclick = () => setMode('light');
  retroBtn.onclick = () => setMode('retro');
  const swatches = h('div', { class: 'swatches' });
  for (const [key, a] of Object.entries(ACCENTS)) {
    swatches.appendChild(h('button', {
      class: 'swatch' + (key === curAccent ? ' active' : ''),
      style: `background:${a.primary}`, title: a.name,
      onclick: async () => { await db.setMeta('accent', key); applyTheme(await db.getMeta('theme', DEFAULT_THEME), key); route(); },
    }));
  }
  // Sprache
  const curLang = getLang();
  const deBtn = h('button', { class: 'btn ghost' + (curLang !== 'en' ? ' on' : '') }, 'Deutsch');
  const enBtn = h('button', { class: 'btn ghost' + (curLang === 'en' ? ' on' : '') }, 'English');
  deBtn.onclick = async () => { await db.setMeta('lang', 'de'); await db.setMeta('langChosen', true); setLang('de'); route(); };
  enBtn.onclick = async () => { await db.setMeta('lang', 'en'); await db.setMeta('langChosen', true); setLang('en'); route(); };

  wrap.appendChild(h('div', { class: 'card' },
    h('h2', {}, '🎨 Aussehen'),
    h('label', { class: 'field' }, h('span', {}, 'Sprache'), h('div', { class: 'seg' }, deBtn, enBtn)),
    h('label', { class: 'field' }, h('span', {}, 'Modus'), h('div', { class: 'seg' }, darkBtn, lightBtn, retroBtn)),
    h('label', { class: 'field' }, h('span', {}, 'Akzentfarbe'), swatches),
  ));

  // Timer: Standard-Pause
  const curRest = parseInt(await db.getMeta('defaultRest', 90), 10) || 90;
  const restInp = h('input', { type: 'number', step: '5', min: '10', inputmode: 'numeric', class: 'inp', value: curRest });
  restInp.addEventListener('change', async () => {
    const v = parseInt(restInp.value, 10);
    if (v >= 5) await db.setMeta('defaultRest', v);
  });
  wrap.appendChild(h('div', { class: 'card' },
    h('h2', {}, tr('⏱ Pausen-Timer', '⏱ Rest timer')),
    h('p', { class: 'muted small' }, tr('Standard-Pause in Sekunden (gilt, wenn die Übung/der Plan keine eigene Zeit hat). Pro Übung einstellbar unter Übungen → Übung öffnen.',
      'Default rest in seconds (used when the exercise/plan has no own time). Set per exercise under Exercises → open an exercise.')),
    h('label', { class: 'field' }, h('span', {}, tr('Standard-Pause (Sek.)', 'Default rest (sec)')), restInp),
  ));

  // Wochenziel für Streak/Wochenring auf der Übersicht
  const curGoal = await getWeeklyGoal();
  const goalInp = h('input', { type: 'number', step: '1', min: '1', inputmode: 'numeric', class: 'inp', value: curGoal });
  goalInp.addEventListener('change', async () => {
    const v = parseInt(goalInp.value, 10);
    if (v > 0) { await db.setMeta('weeklyGoal', v); toast(tr('Gespeichert ✓', 'Saved ✓')); }
  });
  wrap.appendChild(h('div', { class: 'card' },
    h('h2', {}, '🔥 ' + tr('Wochenziel', 'Weekly goal')),
    h('p', { class: 'muted small' }, tr('Anzahl Einheiten pro Woche für Streak und Wochenring auf der Übersicht.',
      'Number of sessions per week for the streak and weekly ring on the overview.')),
    h('label', { class: 'field' }, h('span', {}, tr('Einheiten/Woche', 'Sessions/week')), goalInp),
  ));

  // Weitere Bereiche
  wrap.appendChild(h('div', { class: 'card' },
    h('h2', {}, 'Training'),
    h('div', { class: 'row-item', onclick: () => go('#plaene') },
      h('div', {}, h('strong', {}, '🗓️ Trainingspläne'), h('div', { class: 'muted small' }, 'Vorlagen starten (4er-Split)')),
      h('span', { class: 'chev' }, '›')),
    h('div', { class: 'row-item', onclick: () => go('#fortschritt') },
      h('div', {}, h('strong', {}, '📊 Fortschritt'), h('div', { class: 'muted small' }, 'Prognose & Milestones')),
      h('span', { class: 'chev' }, '›')),
  ));
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

  // KI: Foto-Auslesen
  const apiKey = await db.getMeta('apiKey', '');
  const visionModel = await db.getMeta('visionModel', DEFAULT_VISION_MODEL);
  const keyInp = h('input', { type: 'password', class: 'inp', placeholder: 'sk-ant-...', value: apiKey });
  const modelSel = h('select', { class: 'inp' },
    ...VISION_MODELS.map((m) => h('option', { value: m.id, ...(m.id === visionModel ? { selected: '' } : {}) }, m.label)));
  modelSel.addEventListener('change', () => db.setMeta('visionModel', modelSel.value));
  wrap.appendChild(h('div', { class: 'card' },
    h('h2', {}, '🤖 KI: Werte aus Foto lesen'),
    h('p', { class: 'muted small' }, 'Optional. Mit einem Anthropic API-Schlüssel liest die App Gewicht/Wiederholungen automatisch aus deinen Fotos aus. ' +
      'Der Schlüssel bleibt lokal auf diesem Gerät. Beim Auslesen wird das jeweilige Foto an die Anthropic-API gesendet.'),
    h('label', { class: 'field' }, h('span', {}, 'Anthropic API-Schlüssel'), keyInp),
    h('label', { class: 'field' }, h('span', {}, 'Modell'), modelSel),
    h('button', { class: 'btn primary', onclick: async () => {
      await db.setMeta('apiKey', keyInp.value.trim());
      await db.setMeta('visionModel', modelSel.value);
      toast(L('KI-Einstellungen gespeichert.'));
    } }, 'Speichern'),
    h('p', { class: 'muted small' }, 'Schlüssel erstellen unter console.anthropic.com. Ohne Schlüssel bleibt die App voll nutzbar (manuelle Eingabe).'),
  ));

  // Speicherschutz (persistenter Speicher gegen Verdrängung durch iOS)
  let persisted = false;
  try { persisted = !!(navigator.storage && navigator.storage.persisted && await navigator.storage.persisted()); } catch (e) { /* ignore */ }
  wrap.appendChild(h('div', { class: 'card' },
    h('h2', {}, tr('🔒 Speicherschutz', '🔒 Storage protection')),
    h('p', { class: 'muted small' }, persisted
      ? tr('Aktiv – das System darf deine lokalen Daten nicht mehr einfach löschen.', 'Active — the system may no longer evict your local data.')
      : tr('Noch nicht aktiv. Fordert an, dass iOS deine Daten nicht verdrängt (Hauptursache für plötzlichen Datenverlust). Tipp: Die App zum Home-Bildschirm hinzufügen erhöht die Chance.',
           'Not active yet. Requests that the OS keeps your data (main cause of sudden data loss). Tip: adding the app to the home screen improves the chance.')),
    persisted ? h('p', { class: 'muted small' }, '✓') : h('button', { class: 'btn primary', onclick: async () => {
      let ok = false;
      try { ok = !!(navigator.storage && navigator.storage.persist && await navigator.storage.persist()); } catch (e) { /* ignore */ }
      toast(ok ? tr('Speicherschutz aktiv ✓', 'Storage protection active ✓')
               : tr('Konnte nicht aktiviert werden. App zum Home-Bildschirm hinzufügen und erneut versuchen.', 'Could not enable. Add to home screen and try again.'));
      route();
    } }, tr('🔒 Speicher schützen', '🔒 Protect storage')),
  ));

  // Backup
  const taOut = h('textarea', { class: 'inp', rows: '4', readonly: '', placeholder: tr('Hier erscheint dein Backup-Text …', 'Your backup text appears here …') });
  const taIn = h('textarea', { class: 'inp', rows: '4', placeholder: tr('Backup-Text hier einfügen …', 'Paste backup text here …') });
  wrap.appendChild(h('div', { class: 'card' },
    h('h2', {}, 'Backup'),
    h('p', { class: 'muted small' }, tr(
      'Wichtig (iPhone): Die App im Safari und die zum Home-Bildschirm hinzugefügte App haben getrennte Speicher. Zum Übertragen: im Safari kopieren, in der Home-App einfügen.',
      'Note (iPhone): Safari and the home-screen app use separate storage. To transfer: copy in Safari, paste in the home-screen app.')),

    // Weg 1 (empfohlen, ohne Datei): per Text kopieren & einfügen.
    h('h2', { style: 'font-size:14px; margin-top:6px' }, tr('📋 Per Text übertragen (empfohlen)', '📋 Transfer via text (recommended)')),
    h('p', { class: 'muted small' }, tr('Ohne Fotos, damit der Text klein bleibt. Zahlen/Trainings/Maße sind alle dabei.',
      'Without photos so the text stays small. All numbers/workouts/measures are included.')),
    h('button', { class: 'btn primary', onclick: async () => {
      const dump = await exportAll();
      if (dump.data && Array.isArray(dump.data.sets)) dump.data.sets = dump.data.sets.map(({ photo, ...r }) => r);
      const json = JSON.stringify(dump);
      taOut.value = json;
      taOut.focus(); taOut.select();
      await db.setMeta('lastBackupAt', Date.now());
      try { await navigator.clipboard.writeText(json); toast(tr('Backup kopiert ✓ – jetzt in der anderen App einfügen', 'Backup copied ✓ — paste it in the other app')); }
      catch { toast(tr('Text unten ist markiert – mit „Kopieren" sichern', 'Text below is selected — tap “Copy”')); }
    } }, tr('Backup-Text erzeugen & kopieren', 'Create & copy backup text')),
    taOut,
    h('label', { class: 'field', style: 'margin-top:10px' }, h('span', {}, tr('Backup-Text einfügen und importieren', 'Paste backup text and import')), taIn),
    h('button', { class: 'btn ghost', onclick: async () => {
      const txt = taIn.value.trim();
      if (!txt) { alert(tr('Bitte zuerst den Backup-Text einfügen.', 'Please paste the backup text first.')); return; }
      if (!confirm(L('Import ersetzt die aktuellen Daten. Fortfahren?'))) return;
      try {
        await importAll(JSON.parse(txt), { replace: true });
        await db.setMeta('lastBackupAt', Date.now());
        alert(L('Backup importiert.'));
        location.hash = '#dashboard'; route();
      } catch (err) { alert(L('Import fehlgeschlagen: ') + err.message); }
    } }, tr('Aus Text importieren', 'Import from text')),

    // Weg 2: als Datei (inkl. Fotos).
    h('h2', { style: 'font-size:14px; margin-top:16px' }, tr('📄 Als Datei (inkl. Fotos)', '📄 As a file (incl. photos)')),
    h('button', { class: 'btn ghost', onclick: exportBackup }, '⬇ Backup exportieren (JSON)'),
    h('label', { class: 'btn ghost file-btn' }, '⬆ Backup importieren',
      h('input', { type: 'file', accept: 'application/json,.json', style: 'display:none', onchange: importBackup })),
  ));

  // Gefahrenzone
  wrap.appendChild(h('div', { class: 'card' },
    h('h2', {}, 'Zurücksetzen'),
    h('button', { class: 'btn ghost danger', onclick: async () => {
      if (confirm(L('Wirklich ALLE Daten löschen? Vorher am besten ein Backup machen.'))) {
        for (const s of ['exercises', 'workouts', 'sets', 'body', 'nutrition', 'activity', 'templates', 'goals']) await db.clear(s);
        await db.setMeta('currentWorkout', null);
        await db.setMeta('planV1Installed', false);
        location.hash = '#dashboard'; route();
      }
    } }, 'Alle Daten löschen'),
  ));

  // App-Version + manueller Update-Anstoß (Daten bleiben erhalten).
  wrap.appendChild(h('div', { class: 'card' },
    h('h2', {}, tr('App-Version', 'App version')),
    h('p', { class: 'muted small' }, tr(
      `Installierte Version: ${APP_VERSION}. Normalerweise aktualisiert sich die App von allein. Falls eine Änderung nicht erscheint, hier erzwingen – deine Daten bleiben erhalten.`,
      `Installed version: ${APP_VERSION}. The app normally updates itself. If a change doesn't show up, force it here — your data stays intact.`)),
    h('button', { class: 'btn primary', onclick: forceUpdate }, tr('🔄 Nach Update suchen & neu laden', '🔄 Check for update & reload')),
  ));

  wrap.appendChild(h('p', { class: 'muted small center' }, `Kraft-Tracker · lokal & offline · ${APP_VERSION}`));
  return wrap;
}

// Erzwingt die neueste Version: App-Cache leeren + Service Worker neu
// registrieren, dann neu laden. IndexedDB (deine Trainingsdaten) bleibt
// unangetastet.
async function forceUpdate() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch (e) { /* egal – trotzdem neu laden */ }
  location.reload();
}

async function exportBackup() {
  const dump = await exportAll();
  const json = JSON.stringify(dump, null, 2);
  const fname = `kraft-tracker-backup-${todayStr()}.json`;
  await db.setMeta('lastBackupAt', Date.now());   // Backup-Erinnerung zurücksetzen
  // iPhone/Mobile: über den Teilen-Dialog als Datei sichern (zuverlässiger
  // als ein versteckter Download – „In Dateien sichern", AirDrop, …).
  try {
    const file = new File([json], fname, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Kraft-Tracker Backup' });
      return;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return; // Nutzer hat abgebrochen
    // sonst: Fallback unten
  }
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: fname });
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

async function importBackup(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!confirm(L('Import ersetzt die aktuellen Daten. Fortfahren?'))) return;
  try {
    const text = await file.text();
    await importAll(JSON.parse(text), { replace: true });
    alert(L('Backup importiert.'));
    location.hash = '#dashboard'; route();
  } catch (err) {
    alert(L('Import fehlgeschlagen: ') + err.message);
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
