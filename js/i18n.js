// i18n.js — Sprachumschaltung DE/EN über eine Übersetzungs-Schicht.
// Quelle ist Deutsch; bei 'en' werden gerenderte Texte übersetzt (DOM-Pass)
// plus sprachbewusste Bausteine (Coach/Vision). Übungsnamen bleiben Daten.

export const DEFAULT_LANG = 'de';
let LANG = DEFAULT_LANG;

export function getLang() { return LANG; }
export function setLang(v) { LANG = v === 'en' ? 'en' : 'de'; }
export function detectLang() {
  const l = (navigator.language || navigator.userLanguage || 'de').toLowerCase();
  return l.startsWith('en') ? 'en' : 'de';
}

// L: für Nicht-DOM-Texte (alert/confirm/toast). Gibt EN aus DICT, sonst DE.
export function L(de) { return LANG === 'en' ? (DICT[de] ?? de) : de; }

// Exakte, vollständige Strings (ganzer Textknoten / Platzhalter / title).
const DICT = {
  // Navigation
  'Übersicht': 'Overview', 'Training': 'Training', 'Übungen': 'Exercises',
  'Körper': 'Body', 'Mehr': 'More', 'Lädt …': 'Loading …',
  // Dashboard
  'Einheiten': 'Sessions', 'Sätze erfasst': 'Sets logged',
  'kg Volumen (7 T.)': 'kg volume (7 d.)', 'Körpergewicht': 'Body weight',
  '🧠 Coach-Vorschläge': '🧠 Coach suggestions',
  'Erfasse ein paar Einheiten – dann bekommst du hier passende Tipps.':
    'Log a few sessions — then you’ll get tailored tips here.',
  '📈 Kraftentwicklung (geschätztes 1RM)': '📈 Strength progression (estimated 1RM)',
  '🏆 Rekorde (bestes 1RM)': '🏆 Records (best 1RM)',
  '⚖️ Körpergewicht': '⚖️ Body weight',
  '+ Training erfassen': '+ Log training',
  // Training
  'Training erfassen': 'Log training', 'Neue Einheit starten': 'Start new session',
  'Datum': 'Date', 'Einheit starten': 'Start session', 'Bisherige Einheiten': 'Past sessions',
  'Fertig / schließen': 'Done / close', '🗑 Einheit löschen': '🗑 Delete session',
  'Satz hinzufügen': 'Add set', 'Übung': 'Exercise', 'Gewicht': 'Weight',
  'Wiederholungen': 'Reps', '📷 Foto (optional – Display/Beleg)': '📷 Photo (optional – display/proof)',
  '🔍 Aus Foto lesen (KI)': '🔍 Read from photo (AI)', '+ Satz speichern': '+ Save set',
  'Noch keine Historie für diese Übung.': 'No history for this exercise yet.',
  '🤖 Lese Foto …': '🤖 Reading photo …',
  'Kein API-Schlüssel – unter „Mehr" hinterlegen.': 'No API key — add it under “More”.',
  'Bitte zuerst ein Foto aufnehmen/auswählen.': 'Please take/select a photo first.',
  'Noch keine Sätze erfasst.': 'No sets logged yet.', 'Unbekannt': 'Unknown',
  // Exercises
  'Übungen ': 'Exercises ', 'Neue Übung': 'New exercise', 'Name': 'Name',
  'Kategorie': 'Category', 'Gerät': 'Equipment', '+ Übung anlegen': '+ Add exercise',
  '📈 Geschätztes 1RM': '📈 Estimated 1RM', '📊 Volumen je Einheit': '📊 Volume per session',
  'Historie': 'History', 'Aktuelles 1RM': 'Current 1RM', 'Bestes 1RM': 'Best 1RM',
  'seit Start': 'since start', 'kg/Woche': 'kg/week',
  '‹ Zurück zu Übungen': '‹ Back to exercises',
  'Noch keine Sätze für diese Übung erfasst.': 'No sets logged for this exercise yet.',
  // Kategorien
  'Drücken': 'Push', 'Ziehen': 'Pull', 'Beine': 'Legs', 'Core': 'Core', 'Sonstige': 'Other',
  // Pläne
  '‹ Zurück zu Mehr': '‹ Back to More',
  'Noch kein Plan installiert.': 'No plan installed yet.',
  '▶ Starten': '▶ Start', 'Plan zurücksetzen / aktualisieren': 'Reset / update plan',
  'Mo Tennis · Di Push · Mi Legs+Schwachstelle · Do Pull · Fr Laufen · Sa Finisher · So Ruhe':
    'Mon tennis · Tue push · Wed legs+weak point · Thu pull · Fri running · Sat finisher · Sun rest',
  'Fokus auf Bankdrücken, Kniebeugen & Klimmzüge: jede Woche +1 Wdh, +2,5 kg oder sauberere Ausführung. Rest: „irgendwie steigern", solange die drei Hauptlifte laufen.':
    'Focus on bench press, squat & pull-ups: each week +1 rep, +2.5 kg or cleaner form. The rest: just progress somehow, as long as the three main lifts keep moving.',
  // Körper
  'Körper ': 'Body ', 'Neuer Eintrag': 'New entry', 'Körpergewicht (kg)': 'Body weight (kg)',
  'Brust': 'Chest', 'Taille': 'Waist', 'Arm': 'Arm', 'Oberschenkel': 'Thigh',
  '+ Speichern': '+ Save', '⚖️ Gewichtsverlauf': '⚖️ Weight trend',
  'Einträge': 'Entries', 'Noch keine Einträge.': 'No entries yet.',
  // Ernährung
  'Ernährung': 'Nutrition', 'Protein (g)': 'Protein (g)', 'Kalorien': 'Calories', 'Notiz': 'Note',
  '🥩 Protein-Verlauf (g/Tag)': '🥩 Protein trend (g/day)',
  // Aktivität
  'Aktivität': 'Activity', 'Schritte': 'Steps', '👟 Schritte-Verlauf': '👟 Steps trend',
  // Einstellungen
  '🎨 Aussehen': '🎨 Appearance', 'Modus': 'Mode', '🌙 Dunkel': '🌙 Dark', '☀️ Hell': '☀️ Light',
  'Akzentfarbe': 'Accent color', 'Sprache': 'Language',
  'Vorlagen starten (4er-Split)': 'Start templates (4-day split)',
  '📊 Fortschritt': '📊 Progress', 'Prognose & Milestones': 'Forecast & milestones',
  '⏱ Pause starten': '⏱ Start rest',
  'Protein & Kalorien erfassen': 'Log protein & calories', 'Schritte erfassen': 'Log steps',
  '1RM-Formel': '1RM formula', 'Formel zur Schätzung deiner Maximalkraft.':
    'Formula to estimate your one-rep max.', 'Epley (Standard)': 'Epley (default)',
  '🤖 KI: Werte aus Foto lesen': '🤖 AI: read values from photo',
  'Optional. Mit einem Anthropic API-Schlüssel liest die App Gewicht/Wiederholungen automatisch aus deinen Fotos aus. Der Schlüssel bleibt lokal auf diesem Gerät. Beim Auslesen wird das jeweilige Foto an die Anthropic-API gesendet.':
    'Optional. With an Anthropic API key the app reads weight/reps automatically from your photos. The key stays local on this device. When reading, that photo is sent to the Anthropic API.',
  'Anthropic API-Schlüssel': 'Anthropic API key', 'Modell': 'Model', 'Speichern': 'Save',
  'Schlüssel erstellen unter console.anthropic.com. Ohne Schlüssel bleibt die App voll nutzbar (manuelle Eingabe).':
    'Create a key at console.anthropic.com. Without a key the app stays fully usable (manual entry).',
  'Alle Daten liegen lokal auf diesem Gerät. Sichere sie regelmäßig als Datei.':
    'All data is stored locally on this device. Back it up to a file regularly.',
  '⬇ Backup exportieren (JSON)': '⬇ Export backup (JSON)', '⬆ Backup importieren': '⬆ Import backup',
  'Zurücksetzen': 'Reset', 'Alle Daten löschen': 'Delete all data',
  'Kraft-Tracker · lokal & offline · v1.0': 'Kraft-Tracker · local & offline · v1.0',
  // Akzentnamen (title)
  'Grün': 'Green', 'Smaragd': 'Emerald', 'Blau': 'Blue', 'Violett': 'Violet', 'Rot': 'Red',
  // Platzhalter
  'Wdh.': 'Reps', 'Name der Übung': 'Exercise name', 'Gerät (z.B. Langhantel)': 'Equipment (e.g. barbell)',
  'Notiz (optional)': 'Note (optional)',
  // Alerts / Confirms / Toasts (via L)
  'Bitte Gewicht und Wiederholungen eingeben.': 'Please enter weight and reps.',
  'Bitte Namen eingeben.': 'Please enter a name.',
  'Bitte mindestens einen Wert eingeben.': 'Please enter at least one value.',
  'Bitte Protein oder Kalorien eingeben.': 'Please enter protein or calories.',
  'Bitte Schritte eingeben.': 'Please enter steps.',
  'Plan neu installieren? Vorhandene Vorlagen dieses Plans werden ersetzt (deine Trainingsdaten bleiben erhalten).':
    'Reinstall plan? Existing templates of this plan are replaced (your training data stays).',
  'Wirklich ALLE Daten löschen? Vorher am besten ein Backup machen.':
    'Really delete ALL data? Best make a backup first.',
  'Import ersetzt die aktuellen Daten. Fortfahren?': 'Import replaces the current data. Continue?',
  'Backup importiert.': 'Backup imported.', 'KI-Einstellungen gespeichert.': 'AI settings saved.',
  'Import fehlgeschlagen: ': 'Import failed: ',
};

// Teil-Ersetzungen für interpolierte Texte (nur wenn kein exakter Treffer).
// Reihenfolge: längere/spezifische zuerst; keine Fragmente, die in Übungsnamen vorkommen.
const SUBST = [
  ['Di – Push (~42 Min)', 'Tue – Push (~42 min)'],
  ['Mi – Legs (reduziert) + Schwachstelle (~40 Min)', 'Wed – Legs (reduced) + weak point (~40 min)'],
  ['Do – Pull (~42 Min)', 'Thu – Pull (~42 min)'],
  ['Sa – Finisher (~40 Min)', 'Sat – Finisher (~40 min)'],
  ['4er-Split · 45 Min', '4-day split · 45 min'],
  ['Trainingspläne', 'Training plans'],
  [' installieren', ' install'],
  ['Sätze dieser Einheit', 'Sets this session'],
  [' Sätze erkannt:', ' sets recognized:'],
  [' Sätze', ' sets'],
  [' · Pause ', ' · rest '],
  ['Letztes Mal (', 'Last time ('],
  [' · Bestes 1RM: ', ' · Best 1RM: '],
  ['Erkannt: ', 'Recognized: '],
  [' (Übung bitte prüfen)', ' (please check exercise)'],
  ['Keine Werte erkannt', 'No values recognized'],
  ['Alle ', 'Apply all '],
  [' übernehmen', ''],
  [' · noch nicht trainiert', ' · not trained yet'],
  ['kg/Wo.', 'kg/wk'],
  ['· Schwachstelle', '· weak point'],
  ['· Seilzug', '· cable'],
  ['Kurzhantel', 'dumbbell'],
  ['höhere Wdh', 'higher reps'],
  ['enger Griff', 'close grip'],
  ['Superset mit ', 'Superset with '],
  ['Brust ', 'Chest '],
  ['Taille ', 'Waist '],
  ['OSchenkel ', 'Thigh '],
  [' g Protein', ' g protein'],
  ['Schritte', 'Steps'],
  ['Fehler: ', 'Error: '],
  ['(Drücken)', '(Push)'],
  ['(Ziehen)', '(Pull)'],
  ['(Beine)', '(Legs)'],
  ['(Sonstige)', '(Other)'],
];

// Übersetzt einen gerenderten Baum (nur bei 'en').
export function applyI18n(root = document.body) {
  if (LANG !== 'en') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let n; while ((n = walker.nextNode())) nodes.push(n);
  for (const node of nodes) {
    const raw = node.nodeValue;
    const key = raw.trim();
    if (!key) continue;
    if (DICT[key] !== undefined) { node.nodeValue = raw.replace(key, DICT[key]); continue; }
    let val = raw, changed = false;
    for (const [de, en] of SUBST) {
      if (val.includes(de)) { val = val.split(de).join(en); changed = true; }
    }
    if (changed) node.nodeValue = val;
  }
  // Attribute
  root.querySelectorAll('[placeholder]').forEach((el) => {
    const k = el.getAttribute('placeholder');
    if (DICT[k] !== undefined) el.setAttribute('placeholder', DICT[k]);
  });
  root.querySelectorAll('[title]').forEach((el) => {
    const k = el.getAttribute('title');
    if (DICT[k] !== undefined) el.setAttribute('title', DICT[k]);
  });
}
