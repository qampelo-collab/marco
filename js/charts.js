// charts.js — Winzige, abhängigkeitsfreie SVG-Diagramme (offline-tauglich).

function ns(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// Liniendiagramm für Zeitreihen: data = [{date:'YYYY-MM-DD', value:Number}]
export function lineChart(data, { width = 320, height = 160, color = '#4ade80', unit = '', zeroBased = false } = {}) {
  const svg = ns('svg', {
    viewBox: `0 0 ${width} ${height}`, width: '100%', height: 'auto',
    class: 'chart', preserveAspectRatio: 'xMidYMid meet',
  });
  if (!data || data.length === 0) {
    const t = ns('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', fill: '#94a3b8', 'font-size': '12' });
    t.textContent = 'Noch keine Daten';
    svg.appendChild(t);
    return svg;
  }

  const pad = { l: 34, r: 10, t: 12, b: 20 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;

  const values = data.map((d) => d.value);
  let min = Math.min(...values), max = Math.max(...values);
  if (zeroBased) min = 0;              // Achse bei 0 beginnen (z.B. Volumen)
  if (min === max) { min -= 1; max += 1; }
  const range = max - min;

  const n = data.length;
  const x = (i) => pad.l + (n === 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v) => pad.t + h - ((v - min) / range) * h;

  // Gitter + Achsenbeschriftung (min/max)
  for (const val of [min, (min + max) / 2, max]) {
    const gy = y(val);
    svg.appendChild(ns('line', { x1: pad.l, y1: gy, x2: width - pad.r, y2: gy, stroke: '#1e293b', 'stroke-width': 1 }));
    const lbl = ns('text', { x: pad.l - 4, y: gy + 3, 'text-anchor': 'end', fill: '#64748b', 'font-size': '9' });
    lbl.textContent = Math.round(val * 10) / 10;
    svg.appendChild(lbl);
  }

  // Fläche + Linie
  const linePts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ');
  const areaPts = `${pad.l},${pad.t + h} ${linePts} ${x(n - 1)},${pad.t + h}`;
  svg.appendChild(ns('polygon', { points: areaPts, fill: color, opacity: '0.12' }));
  svg.appendChild(ns('polyline', { points: linePts, fill: 'none', stroke: color, 'stroke-width': 2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

  // Punkte
  data.forEach((d, i) => {
    svg.appendChild(ns('circle', { cx: x(i), cy: y(d.value), r: n > 20 ? 1.5 : 3, fill: color }));
  });

  // Erste/letzte Datumsbeschriftung
  const dLabel = (s) => s.slice(8, 10) + '.' + s.slice(5, 7) + '.';
  const t1 = ns('text', { x: pad.l, y: height - 6, fill: '#64748b', 'font-size': '9' });
  t1.textContent = dLabel(data[0].date);
  svg.appendChild(t1);
  if (n > 1) {
    const t2 = ns('text', { x: width - pad.r, y: height - 6, 'text-anchor': 'end', fill: '#64748b', 'font-size': '9' });
    t2.textContent = dLabel(data[n - 1].date);
    svg.appendChild(t2);
  }
  return svg;
}

// Fortschrittsring (z.B. "3 von 4 Einheiten diese Woche"): value/max als
// Kreisbogen. Farben werden vom Aufrufer übergeben (Theme-abhängig).
export function progressRing(value, max, { size = 120, color = '#4ade80', trackColor = '#334155', textColor = '#e2e8f0' } = {}) {
  const svg = ns('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'ring' });
  const r = size / 2 - 10;
  const cx = size / 2, cy = size / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  svg.appendChild(ns('circle', { cx, cy, r, fill: 'none', stroke: trackColor, 'stroke-width': 10 }));
  if (pct > 0) {
    svg.appendChild(ns('circle', {
      cx, cy, r, fill: 'none', stroke: color, 'stroke-width': 10, 'stroke-linecap': 'round',
      'stroke-dasharray': `${c}`, 'stroke-dashoffset': `${c * (1 - pct)}`,
      transform: `rotate(-90 ${cx} ${cy})`,
    }));
  }
  const t = ns('text', { x: cx, y: cy + size * 0.07, 'text-anchor': 'middle', fill: textColor, 'font-size': size * 0.22, 'font-weight': '700' });
  t.textContent = `${value}/${max}`;
  svg.appendChild(t);
  return svg;
}

// Balkendiagramm für Kategorien: data = [{label, value, color?}]
// Gestapeltes Balkendiagramm: data = [{label, segments: [{value, color}, ...]}]
// (Segmente werden von unten nach oben in der angegebenen Reihenfolge
// gestapelt, z.B. für "bewegtes Gewicht pro Woche nach Kategorie").
export function stackedBarChart(data, { width = 320, height = 160 } = {}) {
  const svg = ns('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height: 'auto',
    class: 'chart', preserveAspectRatio: 'xMidYMid meet' });
  if (!data || data.length === 0) {
    const t = ns('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', fill: '#94a3b8', 'font-size': '12' });
    t.textContent = 'Noch keine Daten';
    svg.appendChild(t);
    return svg;
  }
  const pad = { l: 10, r: 10, t: 12, b: 28 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const totals = data.map((d) => d.segments.reduce((sum, seg) => sum + (seg.value || 0), 0));
  const max = Math.max(...totals, 1);
  const bw = w / data.length * 0.6;
  const gap = w / data.length;

  data.forEach((d, i) => {
    const total = totals[i];
    const bx = pad.l + i * gap + (gap - bw) / 2;
    let yCursor = pad.t + h;
    for (const seg of d.segments) {
      if (!(seg.value > 0)) continue;
      const segH = (seg.value / max) * h;
      const by = yCursor - segH;
      svg.appendChild(ns('rect', { x: bx, y: by, width: bw, height: segH, fill: seg.color || '#4ade80' }));
      yCursor = by;
    }
    const lbl = ns('text', { x: bx + bw / 2, y: height - 14, 'text-anchor': 'middle', fill: '#94a3b8', 'font-size': '10' });
    lbl.textContent = d.label;
    svg.appendChild(lbl);
    if (total > 0) {
      const val = ns('text', { x: bx + bw / 2, y: pad.t + h - (total / max) * h - 3, 'text-anchor': 'middle', fill: '#e2e8f0', 'font-size': '9' });
      val.textContent = Math.round(total);
      svg.appendChild(val);
    }
  });
  return svg;
}

export function barChart(data, { width = 320, height = 160 } = {}) {
  const svg = ns('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height: 'auto',
    class: 'chart', preserveAspectRatio: 'xMidYMid meet' });
  if (!data || data.length === 0) {
    const t = ns('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', fill: '#94a3b8', 'font-size': '12' });
    t.textContent = 'Noch keine Daten';
    svg.appendChild(t);
    return svg;
  }
  const pad = { l: 10, r: 10, t: 12, b: 28 };
  const w = width - pad.l - pad.r;
  const h = height - pad.t - pad.b;
  const max = Math.max(...data.map((d) => d.value), 1);
  const bw = w / data.length * 0.6;
  const gap = w / data.length;

  data.forEach((d, i) => {
    const bh = (d.value / max) * h;
    const bx = pad.l + i * gap + (gap - bw) / 2;
    const by = pad.t + h - bh;
    svg.appendChild(ns('rect', { x: bx, y: by, width: bw, height: bh, rx: 3, fill: d.color || '#4ade80' }));
    const lbl = ns('text', { x: bx + bw / 2, y: height - 14, 'text-anchor': 'middle', fill: '#94a3b8', 'font-size': '10' });
    lbl.textContent = d.label;
    svg.appendChild(lbl);
    const val = ns('text', { x: bx + bw / 2, y: by - 3, 'text-anchor': 'middle', fill: '#e2e8f0', 'font-size': '9' });
    val.textContent = Math.round(d.value);
    svg.appendChild(val);
  });
  return svg;
}
