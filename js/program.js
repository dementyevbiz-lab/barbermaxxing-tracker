// Вкладка «Программа» и окно пункта
import { $, esc, state, openSheet, setSheet, sheetOpen, toast, haptic } from './core.js';
import * as L from './logic.js';
import * as data from './data.js';
import { ICON, KIND, checkSvg } from './ui.js';

export function itemSheet(id, { onChange, readOnly } = {}) {
  const D = state.D, it = D.items.find((i) => i.id === id); if (!it) return;
  const build = () => {
    const done = data.isDone(id), notes = data.hasNotes(id);
    const head = [KIND[it.kind], it.est_minutes ? it.est_minutes + ' мин' : '', L.itemXp(it, D.settings.xp) + ' опыта'].filter(Boolean).join(' · ');
    return `<span class="dim cap">${esc(head)}</span><h2 class="sh-title"><span class="ink">${esc(it.title)}</span></h2>
      ${it.description ? `<p class="dim" style="white-space:pre-wrap">${esc(it.description)}</p>` : ''}
      ${it.kind === 'short_task' ? [['Зачем', it.why], ['Как', it.how], ['Результат', it.result]].filter((x) => x[1]).map((x) => `<div class="kv" style="flex-direction:column;gap:2px"><span class="dim cap">${x[0]}</span><span class="ink">${esc(x[1])}</span></div>`).join('') : ''}
      ${it.kind === 'homework' ? '<p class="cap"><span class="dim">Проверяется публично, отмечаешь сам</span></p>' : ''}
      ${readOnly ? '' : `<div class="btns" style="margin-top:6px"><button class="btn ${done ? '' : 'pri'}" data-a="toggle"><span class="${done ? 'ink' : 'onlime'}">${done ? 'Снять отметку' : 'Отметить'}</span></button>
        ${it.has_notes ? `<button class="btn" data-a="notes"><span class="ink">${notes ? 'Конспект сделан ✓' : 'Конспект сделан'}</span></button>` : ''}</div>`}`;
  };
  const mount = (sh) => {
    const t = sh.querySelector('[data-a="toggle"]'), n = sh.querySelector('[data-a="notes"]');
    if (t) t.onclick = () => { data.toggleDone(id); haptic(); toast(data.isDone(id) ? 'Засчитано' : 'Отметка снята'); setSheet(build(), mount); onChange && onChange(); };
    if (n) n.onclick = () => { data.toggleNotes(id); haptic(); toast(data.hasNotes(id) ? 'Конспект засчитан' : 'Отметка снята'); setSheet(build(), mount); onChange && onChange(); };
  };
  if (sheetOpen()) setSheet(build(), mount); else openSheet(build(), mount);
}

export function renderProgram(root) {
  const D = state.D, today = L.startOfDay(), info = L.weekInfo(D.profile, D.profile.tariff, today);
  const weeks = info.weeks || D.profile.tariff?.weeks || 0;
  const items = L.visibleItems(D);
  const maxOpen = info.state === 'finished' ? weeks : info.state === 'active' ? info.n : 0; // модуль 0 до старта, потом по неделям; следующие закрыты полностью
  let sel = Math.min(state.programWeek ?? Math.max(L.curWeek(info), 0), maxOpen);
  const readOnly = D.profile.status === 'paused' || info.state === 'finished';
  const calls = D.calls.filter((c) => c.scheduled_at).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  const CK = { call: 'Созвон', strategy: 'Стратегическая сессия', city_strategy: 'Стратегия под город', bonus: 'Дополнительный созвон' };

  root.innerHTML = `<div class="stack"><div class="pagehead"><h1 class="h1s grow"><span class="ink">Программа</span></h1></div>
    <div class="segscroll" id="wkSeg"></div><div class="stack-s" id="wkBody"></div>
    ${calls.length && D.profile.ui_overrides?.hide?.includes('calls') !== true ? `<div class="card"><div class="h"><span class="ink">Созвоны</span></div><div class="stack-s">${calls.map((c) => {
      const d = new Date(c.scheduled_at); return `<div class="kv col"><span class="ink">${esc(CK[c.kind] || 'Созвон')}</span><span class="dim">${L.fmtDay(d)}, ${L.fmtTime(d)}</span></div>`; }).join('')}</div></div>` : ''}</div>`;

  function drawSeg() {
    $('#wkSeg', root).innerHTML = Array.from({ length: weeks + 1 }, (_, i) => i).map((w) => {
      const closed = w > maxOpen;
      return `<button class="${w === sel ? 'on' : closed ? 'fut lock' : ''}" data-w="${w}" ${closed ? 'disabled aria-disabled="true"' : ''}><span class="${w === sel ? 'onlime' : closed ? 'dim' : 'ink'}">${w === 0 ? 'М0' : w}</span></button>`;
    }).join('');
  }
  function drawBody() {
    const list = items.filter((i) => i.week === sel);
    const body = $('#wkBody', root);
    if (sel > maxOpen) return;
    const st = L.weekState(D, sel, info, items);
    if (!list.length) { body.innerHTML = '<div class="empty-note"><span class="dim">Задания этой недели появятся позже</span></div>'; return; }
    body.innerHTML = `<div class="h"><span class="ink">${esc(L.weekTitle(D, sel))}</span><span class="grow"></span><span class="dim cap">${list.filter((i) => i.required).length ? list.filter((i) => i.required && data.isDone(i.id)).length + ' из ' + list.filter((i) => i.required).length : ''}</span></div>
      <div class="rows">${list.map((it) => {
        const det = [it.on_date ? L.fmtDay(L.parseDay(it.on_date)) : '', it.est_minutes ? it.est_minutes + ' мин' : '', it.required ? '' : 'по желанию', data.hasNotes(it.id) ? 'конспект есть' : ''].filter(Boolean).join(' · ');
        return `<div class="row${data.isDone(it.id) ? ' done' : ''}" data-id="${it.id}"><span class="ico">${ICON[it.kind]}</span>
          <button class="row-main" data-open><span class="t"><span class="ink">${esc(it.title)}</span></span><span class="d cap"><span class="dim">${esc(KIND[it.kind] + (det ? ' · ' + det : ''))}</span></span></button>
          <button class="chk${data.isDone(it.id) ? ' on' : ''}" data-chk aria-label="Отметить">${checkSvg}</button></div>`; }).join('')}</div>`;
  }
  drawSeg(); drawBody();
  root.addEventListener('click', (e) => {
    const w = e.target.closest('[data-w]'); if (w && !w.disabled) { sel = Number(w.dataset.w); state.programWeek = sel; drawSeg(); drawBody(); return; }
    const row = e.target.closest('.row[data-id]'); if (!row) return;
    if (e.target.closest('[data-chk]')) {
      if (readOnly) return toast(D.profile.status === 'paused' ? 'Программа на паузе' : 'Программа завершена');
      data.toggleDone(row.dataset.id); haptic(); toast(data.isDone(row.dataset.id) ? 'Засчитано' : 'Отметка снята'); drawBody();
    } else if (e.target.closest('[data-open]')) itemSheet(row.dataset.id, { onChange: drawBody, readOnly });
  });
}
