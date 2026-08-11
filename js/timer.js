// timer.js — Pausen-Timer mit großem Countdown + akustischem Signal (Glocke).
// Läuft direkt in der App; das Element hängt an <body>, überlebt Neu-Rendern.
// Der Zustand wird in localStorage gespiegelt, damit eine laufende Pause auch
// überlebt, wenn iOS die Seite im Hintergrund neu lädt (dann wird sie beim
// nächsten Start automatisch fortgesetzt statt einfach zu verschwinden).

import { getLang } from './i18n.js';

const t = (de, en) => (getLang() === 'en' ? en : de);
const STORAGE_KEY = 'kraft-tracker-resttimer';

let audioCtx = null;
// Audio im Browser freischalten (muss aus einer Nutzer-Geste passieren).
export function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { /* ignore */ }
}

// Glocken-Klang (statt kurzer Beeps): Grundton + ein paar Obertöne mit langem
// Ausklang, wie eine Ring-/Boxglocke. Rein synthetisiert (Web Audio), keine
// Audiodatei nötig – funktioniert offline.
function ringBell() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const strikes = [0, 0.5];       // zwei Schläge ("Ding-Ding")
  const partials = [1, 2.01, 3.0, 4.2]; // typische Glocken-Obertöne
  const fundamental = 660;
  strikes.forEach((strikeOff) => {
    partials.forEach((mult, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = fundamental * mult;
      osc.connect(gain); gain.connect(audioCtx.destination);
      const peak = 0.4 / (i + 1);
      const start = now + strikeOff;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.1 - i * 0.12);
      osc.start(start); osc.stop(start + 1.2);
    });
  });
}

let el = null, iv = null, endAt = 0, total = 0, finished = false, hideTimer = null;
let doneCb = null, advanced = false, readyText = null;

// Callback, das nach der Pause (Timer abgelaufen ODER „Fertig") ausgelöst wird –
// z.B. um in der App direkt zum nächsten Satz zu springen. „✕" löst es NICHT aus.
export function setRestDoneCallback(fn) { doneCb = typeof fn === 'function' ? fn : null; }
function fireDone() {
  if (advanced) return;
  advanced = true;
  if (doneCb) { try { doneCb(); } catch (e) { /* ignore */ } }
}

function fmt(sec) {
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ endAt, total, readyText })); } catch (e) { /* ignore */ }
}
function clearPersist() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
}

function build() {
  if (el) return;
  el = document.createElement('div');
  el.className = 'rest-timer';
  el.innerHTML =
    `<div class="rt-top"><span class="rt-label"></span><button class="rt-x" aria-label="close">✕</button></div>` +
    `<div class="rt-time">0:00</div>` +
    `<div class="rt-bar"><i></i></div>` +
    `<div class="rt-actions">` +
      `<button class="rt-m15">−15s</button>` +
      `<button class="rt-p15">+15s</button>` +
      `<button class="rt-skip">${t('Fertig', 'Done')}</button>` +
    `</div>`;
  document.body.appendChild(el);
  el.querySelector('.rt-x').onclick = stopRest;                        // Abbrechen: kein Weiter
  el.querySelector('.rt-skip').onclick = () => { fireDone(); stopRest(); }; // „Fertig": weiter zum nächsten Satz
  el.querySelector('.rt-m15').onclick = () => { endAt -= 15000; if (endAt < Date.now()) endAt = Date.now(); persist(); tick(); };
  el.querySelector('.rt-p15').onclick = () => { endAt += 15000; finished = false; el.classList.remove('done'); persist(); if (!iv) iv = setInterval(tick, 200); tick(); };
}

function render(rem) {
  el.querySelector('.rt-label').textContent = finished ? t('Bereit!', 'Ready!') : t('Pause', 'Rest');
  el.querySelector('.rt-time').textContent = finished ? (readyText || t('▶ Nächster Satz', '▶ Next set')) : fmt(rem);
  const pct = total > 0 ? Math.max(0, Math.min(100, (rem / total) * 100)) : 0;
  el.querySelector('.rt-bar > i').style.width = (finished ? 100 : pct) + '%';
}

function tick() {
  const rem = Math.round((endAt - Date.now()) / 1000);
  render(Math.max(0, rem));
  if (rem <= 0 && !finished) {
    finished = true;
    clearInterval(iv); iv = null;
    el.classList.add('done');
    render(0);
    ringBell();
    if (navigator.vibrate) { try { navigator.vibrate([250, 120, 250]); } catch (e) {} }
    fireDone();                                   // Timer durch → nächster Satz
    clearPersist();
    hideTimer = setTimeout(stopRest, 10000);
  }
}

// Pause starten (Sekunden). Ersetzt einen laufenden Timer.
// opts.readyText: alternativer Text, sobald die Zeit um ist (z.B. für einen
// freien Timer ohne Übungsbezug, statt „Nächster Satz").
export function startRest(seconds, opts = {}) {
  unlockAudio();
  clearInterval(iv); iv = null;
  clearTimeout(hideTimer); hideTimer = null;
  total = seconds; endAt = Date.now() + seconds * 1000; finished = false; advanced = false;
  readyText = opts.readyText || null;
  build();
  el.classList.remove('done');
  persist();
  iv = setInterval(tick, 200);
  tick();
}

export function stopRest() {
  clearInterval(iv); iv = null;
  clearTimeout(hideTimer); hideTimer = null;
  clearPersist();
  if (el) { el.remove(); el = null; }
}

// Beim App-Start aufrufen: eine zuvor laufende Pause wiederherstellen, falls
// die Seite (z.B. durch iOS im Hintergrund) neu geladen wurde, während sie lief.
export function resumeRestTimer() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { return; }
  if (!saved || !(saved.endAt > 0) || !(saved.total > 0)) return;
  const remain = saved.endAt - Date.now();
  if (remain < -120000) { clearPersist(); return; } // seit >2 Min abgelaufen: verwerfen
  endAt = saved.endAt; total = saved.total; readyText = saved.readyText || null;
  finished = remain <= 0; advanced = false;
  build();
  if (finished) { el.classList.add('done'); render(0); hideTimer = setTimeout(stopRest, 10000); }
  else { el.classList.remove('done'); iv = setInterval(tick, 200); tick(); }
}
