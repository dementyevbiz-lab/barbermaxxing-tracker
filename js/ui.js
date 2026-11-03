// Общие элементы интерфейса: линия пути, страницы поверх вкладок, форматирование метрик
import { $, esc, tg, state, reduced, openSheet } from './core.js';
import * as L from './logic.js';

export const ICON = { lesson: '📺', live: '🎙️', homework: '📝', material: '📚', short_task: '⚡', challenge_task: '🎯' };
export const KIND = { lesson: 'Урок', live: 'Эфир', homework: 'Домашка', material: 'Материал', short_task: 'Короткое задание', challenge_task: 'Задача челленджа' };
export const VIDEO_ICON = { client: '✂️', expert: '🎓', life: '☕' };
export const SOURCES = { call: 'Созвон', live: 'Эфир', lesson: 'Урок', other: 'Другое' };
export const SCREEN_KINDS = [
  ['video_1', 'Лучшее видео 1'], ['video_2', 'Лучшее видео 2'], ['video_3', 'Лучшее видео 3'],
  ['instagram_profile', 'Главная Instagram'], ['tiktok_profile', 'Главная TikTok'],
];

// ---------- формат метрик ----------
export function unitOf(m) {
  if (m.key === 'avg_check') return (state.D?.profile?.prefs?.currency === 'KZT') ? '₸' : '₽';
  return m.unit;
}
export const fmtMetric = (m, v) => (v == null || v === '' ? '—' : `${L.fmtNum(v)} ${unitOf(m)}`);

// ---------- линия пути А → Б ----------
export function pathSvg(p = 'p') {
  const d = 'M26 170 C 74 178, 98 124, 142 120 C 192 116, 194 66, 238 58 C 266 53, 284 42, 294 32';
  return `<svg class="path-svg" viewBox="0 0 320 204" role="img" aria-label="Мой путь от старта к цели">
    <path id="${p}Path" d="${d}" fill="none" stroke="url(#gLimeDim)" stroke-width="4" stroke-linecap="round" stroke-dasharray="9 11"/>
    <path id="${p}Fill" d="${d}" pathLength="100" fill="none" stroke="url(#gLimePath)" stroke-width="5" stroke-linecap="round" stroke-dasharray="0 100" style="transition:stroke-dasharray 500ms cubic-bezier(.2,.7,.2,1)"/>
    <circle cx="26" cy="170" r="10" fill="url(#gLimeDim)" stroke="url(#gLimeBox)" stroke-width="2"/>
    <circle cx="294" cy="32" r="12" fill="url(#gLimeBox)"/>
    <text x="8" y="199" font-family="Golos Text, system-ui, sans-serif" font-weight="700" font-size="14" fill="url(#gInk)">Старт</text>
    <text x="262" y="12" font-family="Golos Text, system-ui, sans-serif" font-weight="700" font-size="14" fill="url(#gInk)">Цель</text>
    <circle id="${p}Now" r="8.5" fill="url(#gLimeBox)" stroke="url(#gRow)" stroke-width="3" cx="26" cy="170"/>
    <circle id="${p}Pace" r="13" fill="none" stroke="url(#gLimeBox)" stroke-width="2.2" stroke-dasharray="4 4" cx="26" cy="170"/>
    <circle data-pt="a" cx="26" cy="170" r="24" fill="transparent" style="cursor:pointer" tabindex="0" role="button" aria-label="Старт"/>
    <circle data-pt="b" cx="294" cy="32" r="24" fill="transparent" style="cursor:pointer" tabindex="0" role="button" aria-label="Цель"/>
    <circle id="${p}HitNow" data-pt="now" r="20" fill="transparent" style="cursor:pointer" cx="26" cy="170" tabindex="0" role="button" aria-label="Сейчас"/>
  </svg>`;
}
export function pathLegend(hasNow) {
  return `<div class="legend">
    ${hasNow ? '<span class="lg"><svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="url(#gLimeBox)"/></svg><span class="dim">Сейчас</span></span>' : ''}
    <span class="lg"><svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" fill="none" stroke="url(#gLimeBox)" stroke-width="1.6" stroke-dasharray="3 3"/></svg><span class="dim">Куда ведёт текущий темп</span></span>
  </div>`;
}
const curPos = new Map();
export function placeMarkers(root, p, now, pace, animate = false) {
  const path = root.querySelector('#' + p + 'Path'); if (!path) return;
  const nowEl = root.querySelector('#' + p + 'Now'), paceEl = root.querySelector('#' + p + 'Pace'), fill = root.querySelector('#' + p + 'Fill'), hit = root.querySelector('#' + p + 'HitNow');
  const at = (t) => path.getPointAtLength(Math.max(0, Math.min(1, t)) * path.getTotalLength());
  const set = (el, t) => { const pt = at(t); el.setAttribute('cx', pt.x.toFixed(1)); el.setAttribute('cy', pt.y.toFixed(1)); };
  nowEl.style.display = now == null ? 'none' : ''; if (hit) hit.style.display = now == null ? 'none' : '';
  // заполненная часть пути: от старта до «Сейчас»
  if (fill) fill.setAttribute('stroke-dasharray', `${Math.round((now ?? 0) * 100)} 100`);
  const to = { now: now ?? 0, pace };
  const from = curPos.get(p);
  const place = (n, pc) => { set(nowEl, n); set(paceEl, pc); if (hit) set(hit, n); };
  try {
    if (!animate || reduced || !from) place(to.now, to.pace);
    else {
      const t0 = performance.now(), dur = 320, ease = (x) => 1 - Math.pow(1 - x, 3);
      const step = (ts) => { const k = ease(Math.min(1, (ts - t0) / dur)); place(from.now + (to.now - from.now) * k, from.pace + (to.pace - from.pace) * k); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }
  } catch (e) {}
  curPos.set(p, to);
}
// Кнопка «?» и окно подсказки: описания не занимают место на экране
const HELP = {
  passage: ['Прохождение программы', 'Какая часть пунктов пройдена в каждой неделе. График появится, когда пройдёт больше одной недели'],
  xp: ['Опыт', 'Накопленный опыт по дням. Он растёт за каждое действие и никогда не уменьшается. График появится, когда опыт наберётся за несколько дней'],
  videoWeeks: ['Видео', 'Столбики показывают, сколько видео снято в каждой неделе. Просмотры можно добавлять, когда они накопятся'],
  ach: ['Ачивки', 'Награды за активность в трекере. Новые открываются по мере прохождения'],
  miniProg: ['Прогресс', 'Доля пройденных пунктов по неделям. Цифры замеров и видео смотри во вкладке Прогресс'],
  cp: ['Как заполнять замер', 'Цифры на сегодня. Каждое поле сохраняется само, можно выйти и вернуться. Что не знаешь, оставь пустым'],
  topHide: ['Рейтинг', 'Другие ученики видят только твоё имя и прирост в процентах. Цифры замеров не видны. Скрыться можно в любой момент'],
};
// Ссылки в описаниях: кликабельные, открываются во встроенном браузере Telegram
export const linkify = (t) => esc(t).replace(/https?:\/\/[^\s<]+/g, (u) => `<a class="lnk" href="${u}" data-ext>${u}</a>`);
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-ext]'); if (!a) return;
  e.preventDefault();
  try { tg && tg.openLink ? tg.openLink(a.href) : window.open(a.href, '_blank'); } catch (err) { window.open(a.href, '_blank'); }
});
export const helpBtn = (key) => `<button class="qbtn" data-help="${key}" aria-label="Подсказка"><span class="dim">?</span></button>`;
export const helpSheetHtml = (title, text) => `<h2 class="sh-title"><span class="ink">${esc(title)}</span></h2><p class="dim" style="white-space:pre-wrap">${text}</p>`;
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-help]'); if (!b || !HELP[b.dataset.help]) return;
  const [t, x] = HELP[b.dataset.help]; openSheet(helpSheetHtml(t, esc(x)));
});

export function pathHelpSheet(hasNow) {
  return '<h2 class="sh-title"><span class="ink">Как читать путь</span></h2>' +
    '<div class="kv" style="justify-content:flex-start"><span class="ink">Сейчас: где ты по цифрам последнего замера</span></div>' +
    '<div class="kv" style="justify-content:flex-start"><span class="ink">Куда ведёт текущий темп: куда приводят уроки, домашки и видео, если продолжать так же</span></div>' +
    `<p class="dim cap">Нажми на Старт, Цель или Сейчас, чтобы увидеть детали. Каждый урок, домашка и видео приближают тебя к цели${hasNow ? '' : '. Маркер Сейчас появится после первого замера'}</p>`;
}

// ---------- страница поверх вкладок ----------
let pageClose = null;
export function openPage(html, mount, { back = true, onClose, title = '' } = {}) {
  const el = $('#page');
  el.innerHTML = `<div class="page-in"><div class="page-top">${back ? '<button class="back" data-back aria-label="Назад">' + tri('l') + '</button>' : ''}<h1 class="h1s grow"><span class="ink">${esc(title)}</span></h1></div><div class="stack" id="pageBody">${html}</div></div>`;
  pageClose = onClose || null;
  el.classList.add('open'); el.scrollTop = 0;
  const b = el.querySelector('[data-back]'); if (b) b.onclick = closePage;
  if (tg && tg.BackButton && back) { try { tg.BackButton.show(); tg.BackButton.offClick(closePage); tg.BackButton.onClick(closePage); } catch (e) {} }
  mount && mount($('#pageBody'), el);
}
export function closePage() {
  const el = $('#page'); el.classList.remove('open');
  if (tg && tg.BackButton) { try { tg.BackButton.hide(); tg.BackButton.offClick(closePage); } catch (e) {} }
  const f = pageClose; pageClose = null; f && f();
}
export const pageOpen = () => $('#page').classList.contains('open');

// Мини-график по значениям: точки лаймом, прошлые тусклее
export function sparkline(points, width = 280, height = 56) {
  if (!points.length) return '';
  const vals = points.map((p) => p.value), min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const pad = 8, step = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
  const xy = points.map((p, i) => [pad + i * step, height - pad - ((p.value - min) / span) * (height - pad * 2)]);
  const line = xy.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ');
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
    ${points.length > 1 ? `<path d="${line}" fill="none" stroke="url(#gLimeDim)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    ${xy.map((q, i) => `<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="${i === xy.length - 1 ? 6 : 4}" fill="url(#${i === xy.length - 1 ? 'gLimeBox' : 'gLimeDim'})"/>`).join('')}
  </svg>`;
}

// Стрелки только треугольниками с лаймовым градиентом (ТЗ, раздел 17.4)
export const tri = (d = 'r') => `<svg class="tri ${d}" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 1 L10 6 L2.5 11 Z" fill="url(#gLimeBox)"/></svg>`;
export const checkSvg = '<svg viewBox="0 0 32 32"><path d="M10 16.5l4.2 4.2L22.5 12"/></svg>';
export const plate = (t, lime) => `<span class="plate${lime ? ' lime' : ''}"><span class="onlime">${esc(t)}</span></span>`;
