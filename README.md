# 🏋️ Kraft-Tracker

Persönliche PWA (Progressive Web App) zum Tracken von Krafttraining, Progression,
Körpermaßen, Ernährung und Alltagsaktivität. **Läuft komplett offline, alle Daten
bleiben lokal auf deinem Gerät** (IndexedDB) – kein Server, kein Account, kein Tracking.

## Funktionen

- **Training erfassen** – Einheiten anlegen, Sätze (Übung, Gewicht, Wdh., RPE) eingeben.
  Optional ein **Foto** pro Satz (Maschinen-Display / Beleg / Fortschrittsbild) direkt
  über die Handy-Kamera aufnehmen; Bilder werden automatisch verkleinert gespeichert.
- **Kraftentwicklung** – geschätztes 1-Rep-Max (1RM) pro Satz und Übung, mit Verlauf,
  %-Steigerung und Trend (kg/Woche über lineare Regression).
- **Coach-Vorschläge** – regelbasierte Tipps: Plateau-Erkennung, Muskelgruppen-Balance
  (Drücken/Ziehen/Beine), progressive Belastungssteigerung, Protein pro kg Körpergewicht,
  Schritte, Trainingsfrequenz.
- **Körper** – Körpergewicht und Maße (Brust, Taille, Arm, Oberschenkel) mit Verlaufsgrafik.
- **Ernährung** – Protein und Kalorien pro Tag.
- **Aktivität** – Schritte pro Tag.
- **Backup** – Export/Import aller Daten als JSON-Datei.

## Berechnungen (Modul `js/calc.js`)

Bewusst als eigenes, dokumentiertes Modul, damit die Formeln leicht anpassbar sind.

- **Geschätztes 1RM**
  - *Epley* (Standard): `1RM = Gewicht × (1 + Wdh / 30)`
  - *Brzycki* (Alternative): `1RM = Gewicht × 36 / (37 − Wdh)`
  - Bei 1 Wiederholung = verwendetes Gewicht. Formel umstellbar unter *Mehr → 1RM-Formel*.
- **Volumen (Tonnage)** = `Gewicht × Wiederholungen` (pro Satz / Einheit / Übung / Woche).
- **Progression** je Übung: bestes e1RM pro Tag als Zeitreihe, aktueller vs. erster Wert
  (absolut & %), Trend als kg/Woche via linearer Regression.

## Nutzung / Start

Weil die App Module und einen Service Worker nutzt, muss sie über HTTP(S) laufen
(nicht per Doppelklick als `file://`). Lokal z. B.:

```bash
# im Projektordner
python3 -m http.server 8000
# dann im Browser öffnen:
#   http://localhost:8000
```

Auf dem Handy: die Seite im Browser öffnen und über „Zum Startbildschirm hinzufügen"
als App installieren. Danach läuft sie offline wie eine native App.

### Hosting

Da es sich um reine statische Dateien handelt, kann die App auf jedem statischen
Host laufen (GitHub Pages, Netlify, eigener Webserver …). Einfach den Ordnerinhalt
hochladen.

## Projektstruktur

```
index.html              App-Shell + Navigation
manifest.webmanifest    PWA-Manifest (installierbar)
sw.js                   Service Worker (Offline-Cache)
css/style.css           Styling (mobile-first, dunkles Theme)
icons/                  App-Icons (SVG + PNG)
js/
  app.js                Startpunkt (Seed, UI-Init, SW-Registrierung)
  db.js                 IndexedDB-Wrapper, Schema, Seed, Backup
  calc.js               1RM, Volumen, Trend, Progression
  coach.js              Regelbasierte Vorschläge
  charts.js             Abhängigkeitsfreie SVG-Diagramme
  ui.js                 Router + alle Ansichten
```

## Datenschutz

Alle Daten (inkl. Fotos) liegen ausschließlich lokal im Browser deines Geräts.
Es findet keine Übertragung an einen Server statt. Für ein Backup nutze den
Export unter *Mehr → Backup*.

## Ausbaustufen (Ideen)

- **Foto-Auslesen (Vision/OCR):** Gewicht/Wiederholungen automatisch aus dem Foto des
  Maschinen-Displays oder handschriftlichen Logs erkennen.
- Trainingspläne/Templates, Aufwärm-Sätze, Supersätze.
- Erweiterte Statistiken (Wochen-/Monatsvolumen je Muskelgruppe, PR-Historie).
- Optionale geräteübergreifende Synchronisierung.
