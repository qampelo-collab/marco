// vision.js — Fotos per Cloud-KI (Anthropic Claude) auslesen.
// Nur diese Funktion nutzt das Internet; das Foto wird an die Anthropic-API
// gesendet. Der API-Schlüssel bleibt lokal auf dem Gerät gespeichert.

const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

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
    `{"sets":[{"exercise": string|null, "weight": number|null, "reps": integer|null, "unit":"kg"|"lb"|"s"}], "note": string|null}\n\n` +
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
  if (!m) throw new Error('Ungültiges Bildformat.');
  return { mediaType: m[1], base64: m[2] };
}

// Extrahiert den Text aus einer Claude-Antwort und parst das JSON robust.
export function parseResponse(apiJson) {
  const blocks = apiJson && apiJson.content;
  if (!Array.isArray(blocks)) throw new Error('Unerwartete API-Antwort.');
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (!text) throw new Error('Die KI hat keinen Text zurückgegeben.');

  // Code-Zäune entfernen und erstes JSON-Objekt herauslösen.
  let cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Konnte kein JSON in der Antwort finden.');
  cleaned = cleaned.slice(start, end + 1);

  let data;
  try {
    data = JSON.parse(cleaned);
  } catch (e) {
    throw new Error('Antwort der KI war kein gültiges JSON.');
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
  if (!apiKey) throw new Error('Kein API-Schlüssel hinterlegt (unter „Mehr").');
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
    throw new Error('Netzwerkfehler – bist du online?');
  }

  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j?.error?.message || ''; } catch {}
    throw new Error(mapHttpError(res.status, detail));
  }

  const json = await res.json();
  if (json.stop_reason === 'refusal') {
    throw new Error('Die KI hat die Anfrage abgelehnt. Bitte ein anderes Foto versuchen.');
  }
  return parseResponse(json);
}

function mapHttpError(status, detail) {
  switch (status) {
    case 400: return 'Ungültige Anfrage' + (detail ? ': ' + detail : '.');
    case 401: return 'API-Schlüssel ungültig oder fehlt.';
    case 403: return 'Zugriff verweigert – prüfe die Berechtigungen des API-Schlüssels.';
    case 404: return 'Modell nicht gefunden – anderes Modell in den Einstellungen wählen.';
    case 413: return 'Bild zu groß.';
    case 429: return 'Zu viele Anfragen – kurz warten und erneut versuchen.';
    case 529:
    case 500:
    case 503: return 'KI-Dienst überlastet – später erneut versuchen.';
    default: return `Fehler ${status}` + (detail ? ': ' + detail : '.');
  }
}
