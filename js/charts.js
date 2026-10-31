// Простые графики: линия по точкам с подписями и целевая линия, столбики. Только SVG, без библиотек
import { esc } from './core.js';
import * as L from './logic.js';

const W = 320;
const fmt = (v) => (Math.abs(v) >= 10000 ? L.fmtNum(Math.round(v / 100) / 10) + ' тыс' : L.fmtNum(Math.round(v * 10) / 10));

// points: [{ label, value }] (value null = нет данных, точка пропускается). goal: число или null. fmtV: форматирование значений
export function lineChart({ points, goal = null, height = 150, fmtV = fmt, goalLabel = 'Цель', yMin = null, yMax = null }) {
  const real = points.map((p, i) => ({ ...p, i })).filter((p) => p.value != null);
  if (real.length < 2) return ''; // график из одной точки ничего не показывает
  const padL = 10, padR = 10, padT = 22, padB = 24, h = height;
  const vals = real.map((p) => p.value).concat(goal != null ? [goal] : []);
  let lo = yMin ?? Math.min(...vals), hi = yMax ?? Math.max(...vals);
  if (hi === lo) { hi += 1; lo -= 1; }
  const m = (hi - lo) * 0.12; if (yMin == null) lo -= m; if (yMax == null) hi += m;
  const n = Math.max(points.length - 1, 1);
  const X = (i) => padL + (points.length === 1 ? (W - padL - padR) / 2 : (i / n) * (W - padL - padR));
  const Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB);
  const pts = real.map((p) => [X(p.i), Y(p.value), p]);
  const line = pts.map((q, k) => (k ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ');
  const area = pts.length > 1 ? `${line} L${pts[pts.length - 1][0].toFixed(1)} ${h - padB} L${pts[0][0].toFixed(1)} ${h - padB} Z` : '';
  const labelAll = points.length <= 7;
  return `<svg class="chart" viewBox="0 0 ${W} ${h}" width="100%" role="img" aria-hidden="false" preserveAspectRatio="xMidYMid meet">
    <line x1="${padL}" y1="${h - padB}" x2="${W - padR}" y2="${h - padB}" stroke="rgba(255,255,255,.12)" stroke-width="1"/>
    ${goal != null ? `<line x1="${padL}" y1="${Y(goal).toFixed(1)}" x2="${W - padR}" y2="${Y(goal).toFixed(1)}" stroke="url(#gLimePath)" stroke-width="1.6" stroke-dasharray="5 5"/><text x="${W - padR}" y="${(Y(goal) - 5).toFixed(1)}" text-anchor="end" font-size="10" font-weight="700" fill="#BBFF68" font-family="Golos Text, system-ui, sans-serif">${esc(goalLabel)} ${esc(fmtV(goal))}</text>` : ''}
    ${area ? `<path d="${area}" fill="url(#gLimeDim)" opacity=".35"/>` : ''}
    ${pts.length > 1 ? `<path d="${line}" fill="none" stroke="url(#gLimePath)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    ${pts.map((q, k) => `<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="${k === pts.length - 1 ? 5.5 : 4}" fill="${k === pts.length - 1 ? 'url(#gLimePath)' : '#576624'}" stroke="#121212" stroke-width="1.5"/>
      ${labelAll || k === 0 || k === pts.length - 1 ? `<text x="${Math.min(W - padR - 6, Math.max(padL + 6, q[0])).toFixed(1)}" y="${(q[1] - 9).toFixed(1)}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#fff" font-family="Golos Text, system-ui, sans-serif">${esc(fmtV(q[2].value))}</text>` : ''}`).join('')}
    ${points.map((p, i) => (labelAll || i === 0 || i === points.length - 1) ? `<text x="${Math.min(W - padR - 6, Math.max(padL + 6, X(i))).toFixed(1)}" y="${h - 7}" text-anchor="middle" font-size="10" fill="#B5B5B5" font-family="Golos Text, system-ui, sans-serif">${esc(p.label)}</text>` : '').join('')}
  </svg>`;
}

// bars: [{ label, value }]
export function barChart({ bars, height = 130, fmtV = (v) => v }) {
  if (bars.length < 2) return '';
  const padL = 10, padR = 10, padT = 20, padB = 24, h = height, max = Math.max(1, ...bars.map((b) => b.value));
  const bw = Math.min(34, (W - padL - padR) / bars.length - 6), gap = (W - padL - padR - bw * bars.length) / Math.max(bars.length, 1);
  return `<svg class="chart" viewBox="0 0 ${W} ${h}" width="100%" role="img">
    <line x1="${padL}" y1="${h - padB}" x2="${W - padR}" y2="${h - padB}" stroke="rgba(255,255,255,.12)"/>
    ${bars.map((b, i) => { const x = padL + gap / 2 + i * (bw + gap), bh = Math.max(b.value ? 3 : 0, (b.value / max) * (h - padT - padB)), y = h - padB - bh;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="8" fill="url(#gLimePath)"/>
      <text x="${(x + bw / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#fff" font-family="Golos Text, system-ui, sans-serif">${esc(String(fmtV(b.value)))}</text>
      <text x="${(x + bw / 2).toFixed(1)}" y="${h - 7}" text-anchor="middle" font-size="10" fill="#B5B5B5" font-family="Golos Text, system-ui, sans-serif">${esc(b.label)}</text>`; }).join('')}
  </svg>`;
}
