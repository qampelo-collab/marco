// theme.js — Hell/Dunkel-Modus und Akzentfarbe.

export const ACCENTS = {
  gruen:   { name: 'Grün',   primary: '#22c55e', ink: '#052e16' },
  smaragd: { name: 'Smaragd', primary: '#10b981', ink: '#022c22' },
  blau:    { name: 'Blau',   primary: '#3b82f6', ink: '#0b1e40' },
  cyan:    { name: 'Cyan',   primary: '#06b6d4', ink: '#042f38' },
  violett: { name: 'Violett', primary: '#8b5cf6', ink: '#1e1b4b' },
  pink:    { name: 'Pink',   primary: '#ec4899', ink: '#3b0a26' },
  orange:  { name: 'Orange', primary: '#f97316', ink: '#2a1206' },
  rot:     { name: 'Rot',    primary: '#ef4444', ink: '#2a0606' },
};

export const DEFAULT_ACCENT = 'gruen';
export const DEFAULT_THEME = 'dark';

// Theme + Akzent auf das Dokument anwenden (live).
export function applyTheme(theme, accentKey) {
  const root = document.documentElement;
  root.dataset.theme = theme === 'light' ? 'light' : 'dark';
  const a = ACCENTS[accentKey] || ACCENTS[DEFAULT_ACCENT];
  root.style.setProperty('--primary', a.primary);
  root.style.setProperty('--primary-ink', a.ink);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'light' ? '#f4f6fb' : '#0f172a';
}
