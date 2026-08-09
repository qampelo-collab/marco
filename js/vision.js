// vision.js — Fotos per Cloud-KI (Anthropic Claude) auslesen.
// Nur diese Funktion nutzt das Internet; das Foto wird an die Anthropic-API
// gesendet. Der API-Schlüssel bleibt lokal auf dem Gerät gespeichert.

import { getLang } from './i18n.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const en = () => getLang() === 'en';
const pick = (de, enStr) => (en() ? enStr : de);

// Verfügbare Modelle (alle unterstützen Vision).
export const VISION_MODELS = [
  { id: 'claude-opus-5', label: 'Claude Opus 5 (Standard, am genauesten)' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 (ausgewogen)' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (günstig & schnell)' },
];
export const DEFAULT_VISION_MODEL = 'claude-opus-5';

// Prompt: klare Anweisung, ausschließlich JSON zurückzugeben.
function buildPrompt(exerciseNames) {
  const known = (exerciseNames || []).filter(Boolean);
  const jsonShape = `{"sets":[{"exercise": string|null, "weight": number|null, "reps": integer|null, "unit":"kg"|"lb"|"s"}], "note": string|null}`;
  if (en()) {
    const knownBlock = known.length
      ? `\nKnown exercise names (map the exercise to one of these if possible, otherwise guess the name or use null): ${known.join(', ')}.`
      : '';
    return (
      `You read strength-training data from a photo. The photo shows either a machine display, ` +
      `a handwritten training log, or a whiteboard. Recognize all sets with weight and reps.` +
      knownBlock +
      `\n\nRespond ONLY with a JSON object in exactly this shape, no markdown, no code fence, no explanation:\n` +
      `${jsonShape}\n\n` +
      `Rules: weight in the unit shown (default kg). If a value is not clearly readable, use null. ` +
      `"note" for short hints (e.g. uncertainties), otherwise null. Return only real sets visible in the image — do not invent values.`
    );
  }
  const knownBlock = known.length
    ? `\nBekannte Übungsnamen (ordne die Übung wenn möglich einem davon zu, sonst rate den Namen oder gib null): ${known.join(', ')}.`
    : '';
  return (
    `Du liest Krafttrainings-Daten aus einem Foto aus. Das Foto zeigt entweder das Display ` +
    `eines Trainingsgeräts, ein handschriftliches Trainingslog oder ein Whiteboard. ` +
    `Erkenne alle Sätze mit Gewicht und Wiederholungen.` +
    knownBlock +
    `\n\nAntworte AUSSCHLIESSLICH mit einem JSON-Objekt in genau dieser Form, ohne Markdown, ` +
    `ohne Code-Zaun, ohne erklärenden Text:\n` +
    `${jsonShape}\n\n` +
    `Regeln: Gewicht in der abgebildeten Einheit (Standard kg). Wenn ein Wert nicht sicher lesbar ist, ` +
    `verwende null. "note" für kurze Hinweise (z.B. Unsicherheiten), sonst null. Gib nur reale, im Bild ` +
    `erkennbare Sätze zurück – erfinde keine Werte.`
  );
}

// Baut den Anfrage-Body (reine Funktion – testbar).
export function buildRequestBody({ base64, mediaType, model, exerciseNames }) {
  return {
    model: model || DEFAULT_VISION_MODEL,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: base64 } },
          { type: 'text', text: buildPrompt(exerciseNames) },
        ],
      },
    ],
  };
}

// Zerlegt eine Data-URL in {mediaType, base64}.
export function splitDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || '');
  if (!m) throw new Error(pick('Ungültiges Bildformat.', 'Invalid image format.'));
  return { mediaType: m[1], base64: m[2] };
}

// Extrahiert den Text aus einer Claude-Antwort und parst das JSON robust.
export function parseResponse(apiJson) {
  const blocks = apiJson && apiJson.content;
  if (!Array.isArray(blocks)) throw new Error(pick('Unerwartete API-Antwort.', 'Unexpected API response.'));
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (!text) throw new Error(pick('Die KI hat keinen Text zurückgegeben.', 'The AI returned no text.'));

  // Code-Zäune entfernen und erstes JSON-Objekt herauslösen.
  let cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(pick('Konnte kein JSON in der Antwort finden.', 'Could not find any JSON in the response.'));
  cleaned = cleaned.slice(start, end + 1);

  let data;
  try {
    data = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(pick('Antwort der KI war kein gültiges JSON.', 'The AI response was not valid JSON.'));
  }

  const rawSets = Array.isArray(data.sets) ? data.sets : [];
  const sets = rawSets
    .map((s) => ({
      exercise: s.exercise != null ? String(s.exercise).trim() : null,
      weight: numOrNull(s.weight),
      reps: intOrNull(s.reps),
      unit: ['kg', 'lb', 's'].includes(s.unit) ? s.unit : 'kg',
    }))
    .filter((s) => s.weight != null || s.reps != null);

  return { sets, note: data.note != null ? String(data.note) : null };
}

function numOrNull(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }
function intOrNull(v) { const n = parseInt(v, 10); return isNaN(n) ? null : n; }

// Hauptfunktion: Foto -> erkannte Sätze. `fetchImpl` für Tests injizierbar.
export async function extractSetsFromImage({ dataUrl, apiKey, model, exerciseNames, fetchImpl }) {
  if (!apiKey) throw new Error(pick('Kein API-Schlüssel hinterlegt (unter „Mehr").', 'No API key set (under “More”).'));
  const doFetch = fetchImpl || fetch;
  const { mediaType, base64 } = splitDataUrl(dataUrl);
  const body = buildRequestBody({ base64, mediaType, model, exerciseNames });

  let res;
  try {
    res = await doFetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        // Erlaubt den direkten Aufruf aus dem Browser (CORS).
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(pick('Netzwerkfehler – bist du online?', 'Network error — are you online?'));
  }

  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j?.error?.message || ''; } catch {}
    throw new Error(mapHttpError(res.status, detail));
  }

  const json = await res.json();
  if (json.stop_reason === 'refusal') {
    throw new Error(pick('Die KI hat die Anfrage abgelehnt. Bitte ein anderes Foto versuchen.',
      'The AI declined the request. Please try a different photo.'));
  }
  return parseResponse(json);
}

function mapHttpError(status, detail) {
  switch (status) {
    case 400: return pick('Ungültige Anfrage', 'Invalid request') + (detail ? ': ' + detail : '.');
    case 401: return pick('API-Schlüssel ungültig oder fehlt.', 'API key invalid or missing.');
    case 403: return pick('Zugriff verweigert – prüfe die Berechtigungen des API-Schlüssels.',
      'Access denied — check the API key permissions.');
    case 404: return pick('Modell nicht gefunden – anderes Modell in den Einstellungen wählen.',
      'Model not found — choose a different model in settings.');
    case 413: return pick('Bild zu groß.', 'Image too large.');
    case 429: return pick('Zu viele Anfragen – kurz warten und erneut versuchen.',
      'Too many requests — wait a moment and retry.');
    case 529:
    case 500:
    case 503: return pick('KI-Dienst überlastet – später erneut versuchen.',
      'AI service overloaded — try again later.');
    default: return (en() ? `Error ${status}` : `Fehler ${status}`) + (detail ? ': ' + detail : '.');
  }
}
