// Админка: список учеников, добавление, демо
import { $, esc, state, callFn, openSheet, closeSheet, toast, confirmBox, copyText, store } from '../core.js';
import * as L from '../logic.js';
import { A, summarize, formSheet, visTariffs } from './common.js';
import { openCard } from './card.js';

const SORTS = [['lag', 'По отставанию'], ['name', 'По имени'], ['xp', 'По опыту']];
const FILTERS = [['all', 'Все'], ['lag', 'Отстают'], ['inactive', 'Не заходят'], ['overdue', 'Замер просрочен']];

export function renderStudents(root) {
  let filter = store.get('afilter', 'all'), sort = store.get('asort', 'lag');
  root.innerHTML = `<div class="stack"><div class="pagehead"><h1 class="h1s grow"><span class="ink">Ученики</span></h1><button class="btn pri sm" id="addSt"><span class="onlime">Добавить</span></button></div>
    <div class="segscroll" id="flt"></div><div class="stack-s admin-list" id="stList"></div>
    <div class="card"><div class="h"><span class="ink">Демо-ученики</span></div><p class="dim cap">Двое с тестовыми цифрами, чтобы проверять экраны. Удаляются одной кнопкой</p>
      <div class="btns"><button class="btn" id="demoAdd"><span class="ink">Добавить демо</span></button><button class="btn" id="demoDel"><span class="ink">Удалить всех демо</span></button></div></div></div>`;
  const rows = () => A.profiles.map((p) => summarize(p));
  function draw() {
    $('#flt', root).innerHTML = FILTERS.map(([k, t]) => `<button class="${k === filter ? 'on' : ''}" data-f="${k}" style="padding:0 18px"><span class="${k === filter ? 'onlime' : 'ink'}">${t}</span></button>`).join('')
      + `<button data-sort style="padding:0 18px"><span class="dim">${SORTS.find((s) => s[0] === sort)[1]}</span></button>`;
    let list = rows();
    if (filter === 'lag') list = list.filter((s) => s.lagging); else if (filter === 'inactive') list = list.filter((s) => s.inactive); else if (filter === 'overdue') list = list.filter((s) => s.cpState === 'overdue');
    list.sort((a, b) => sort === 'name' ? a.p.display_name.localeCompare(b.p.display_name) : sort === 'xp' ? b.xp - a.xp : ((b.lagging - a.lagging) || ((a.share ?? 2) - (b.share ?? 2))));
    $('#stList', root).innerHTML = list.map((s) => {
      const p = s.p, w = s.info.state === 'active' || s.info.state === 'finished' ? `Неделя ${s.info.n} из ${s.info.weeks}` : s.info.state === 'before' ? 'старт ' + L.fmtDayShort(s.info.start) : 'нет даты старта';
      const seen = p.status === 'invited' ? 'ещё не входил' : p.last_seen_at ? 'заходил ' + L.fmtDayShort(new Date(p.last_seen_at)) : 'не заходил';
      const cp = { overdue: ['Замер просрочен', 'red'], soon: ['Замер скоро', ''], ok: ['Замер в срок', 'ok'], done: ['', ''] }[s.cpState];
      return `<button class="row" data-id="${p.id}" style="align-items:flex-start;padding:14px 20px"><span class="row-main" style="gap:6px;padding:0">
        <span class="t"><span class="ink">${esc(p.display_name)}</span>${p.demo ? ' <span class="dim cap">демо</span>' : ''}${p.status !== 'active' ? ` <span class="flag">${{ invited: 'приглашён', paused: 'пауза', finished: 'завершил', blocked: 'закрыт' }[p.status]}</span>` : ''}</span>
        <span class="cap"><span class="dim">${esc(p.tariff?.name || '')} · ${w} · ${seen}</span></span>
        ${s.share != null ? `<span class="progress"><i style="width:${Math.round(s.share * 100)}%"></i></span>` : ''}
        <span style="display:flex;gap:6px;flex-wrap:wrap">${s.lagging ? '<span class="flag red">отстаёт</span>' : ''}${s.inactive ? '<span class="flag">давно не заходил</span>' : ''}${cp[0] ? `<span class="flag ${cp[1]}">${cp[0]}</span>` : ''}</span></span></button>`;
    }).join('') || '<p class="dim empty-note">' + (A.profiles.length ? 'Под фильтр никто не попал' : 'Пока никого. Добавьте ученика') + '</p>';
  }
  root.addEventListener('click', (e) => {
    const f = e.target.closest('[data-f]'); if (f) { filter = f.dataset.f; store.set('afilter', filter); return draw(); }
    if (e.target.closest('[data-sort]')) { sort = SORTS[(SORTS.findIndex((s) => s[0] === sort) + 1) % SORTS.length][0]; store.set('asort', sort); return draw(); }
    const r = e.target.closest('[data-id]'); if (r) openCard(r.dataset.id);
  });
  $('#addSt', root).onclick = () => formSheet({
    title: 'Новый ученик', saveLabel: 'Создать приглашение',
    fields: [{ k: 'display_name', label: 'Имя', type: 'text', required: true }, { k: 'tariff_code', label: 'Тариф', type: 'select', options: visTariffs().map((t) => [t.code, t.name]) }, { k: 'start_date', label: 'Дата старта', type: 'date', hint: 'От неё считаются недели и сроки замеров. У всех потока одна дата' }],
    initial: { tariff_code: 'barbermax', start_date: A.settings.default_start_date || L.ymd(new Date()) },
    onSave: async (v) => {
      const r = await callFn('admin', { action: 'create_student', ...v }, true);
      if (!r.ok) throw new Error(r.message || 'Не получилось');
      await state.app.reload(); setTimeout(() => linkSheet('Приглашение готово', r.invite_link, `Отправьте ссылку ученику ${v.display_name}. Она сработает один раз`), 50);
    },
  });
  $('#demoAdd', root).onclick = async () => { toast('Создаём…'); const r = await callFn('admin', { action: 'seed_demo' }, true); if (!r.ok) return toast(r.message || 'Не получилось'); toast('Демо-ученики добавлены'); state.app.reload(); };
  $('#demoDel', root).onclick = async () => { if (!await confirmBox('Удалить всех демо-учеников вместе с их данными?')) return; const r = await callFn('admin', { action: 'delete_demo' }, true); if (!r.ok) return toast(r.message || 'Не получилось'); toast(`Удалено: ${r.deleted}`); state.app.reload(); };
  draw();
}

export function linkSheet(title, link, note) {
  openSheet(`<h2 class="sh-title"><span class="ink">${esc(title)}</span></h2>${note ? `<p class="dim">${esc(note)}</p>` : ''}<div class="link-box">${esc(link)}</div>
    <button class="btn pri wide" id="cpLink"><span class="onlime">Скопировать ссылку</span></button>`, (sh) => { sh.querySelector('#cpLink').onclick = () => copyText(link); });
}
