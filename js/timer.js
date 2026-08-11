// timer.js — Pausen-Timer mit großem Countdown + akustischem Signal.
// Läuft direkt in der App; das Element hängt an <body>, überlebt Neu-Rendern.

import { getLang } from './i18n.js';

const t = (de, en) => (getLang() === 'en' ? en : de);

let audioCtx = null;
// Audio im Browser freischalten (muss aus einer Nutzer-Geste passieren).
export function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { /* ignore */ }
}

function beep() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  [0, 0.28, 0.56].forEach((off) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    osc.connect(gain); gain.connect(audioCtx.destination);
    gain.gain.setValueAtTime(0.0001, now + off);
    gain.gain.exponentialRampToValueAtTime(0.5, now + off + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + off + 0.22);
    osc.start(now + off); osc.stop(now + off + 0.24);
  });
}

let el = null, iv = null, endAt = 0, total = 0, finished = false, hideTimer = null;
let doneCb = null, advanced = false;

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
  el.querySelector('.rt-m15').onclick = () => { endAt -= 15000; if (endAt < Date.now()) endAt = Date.now(); tick(); };
  el.querySelector('.rt-p15').onclick = () => { endAt += 15000; finished = false; el.classList.remove('done'); if (!iv) iv = setInterval(tick, 200); tick(); };
}

function render(rem) {
  el.querySelector('.rt-label').textContent = finished ? t('Bereit!', 'Ready!') : t('Pause', 'Rest');
  el.querySelector('.rt-time').textContent = finished ? t('▶ Nächster Satz', '▶ Next set') : fmt(rem);
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
    beep();
    if (navigator.vibrate) { try { navigator.vibrate([250, 120, 250]); } catch (e) {} }
    fireDone();                                   // Timer durch → nächster Satz
    hideTimer = setTimeout(stopRest, 10000);
  }
}

// Pause starten (Sekunden). Ersetzt einen laufenden Timer.
export function startRest(seconds) {
  unlockAudio();
  clearInterval(iv); iv = null;
  clearTimeout(hideTimer); hideTimer = null;
  total = seconds; endAt = Date.now() + seconds * 1000; finished = false; advanced = false;
  build();
  el.classList.remove('done');
  iv = setInterval(tick, 200);
  tick();
}

export function stopRest() {
  clearInterval(iv); iv = null;
  clearTimeout(hideTimer); hideTimer = null;
  if (el) { el.remove(); el = null; }
}
