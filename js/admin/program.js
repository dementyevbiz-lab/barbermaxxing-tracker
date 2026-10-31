// Админка: редактор программы. Изменения видны ученикам сразу, правки пишутся в историю
import { $, esc, sb, state, openSheet, closeSheet, setSheet, toast, haptic } from '../core.js';
import * as L from '../logic.js';
import { ICON, KIND } from '../ui.js';
import { A, summarize, dbOk, csvParse, formSheet, visTariffs } from './common.js';
import { itemForm } from './card.js';
import { tri } from '../ui.js';

let selWeek = null;

export function currentCohortWeek() {
  const ws = A.profiles.filter((p) => p.status === 'active' && p.start_date).map((p) => summarize(p).info).filter((i) => i.state === 'active').map((i) => i.n);
  return ws.length ? Math.max(...ws) : 1;
}

export function renderProgramAdmin(root) {
  const maxW = Math.max(8, ...A.tariffs.map((t) => t.weeks), ...A.items.map((i) => i.week));
  if (selWeek == null) selWeek = currentCohortWeek();
  root.innerHTML = `<div class="stack"><div class="pagehead"><h1 class="h1s grow"><span class="ink">Программа</span></h1><button class="btn pri sm" id="pAdd"><span class="onlime">Добавить</span></button></div>
    <div class="segscroll" id="pw"></div><div class="stack-s" id="pList"></div>
    <div class="btns"><button class="btn" id="pPrev"><span class="ink">Как видит ученик</span></button><button class="btn" id="pImp"><span class="ink">Импорт</span></button><button class="btn" id="pTrash"><span class="ink">Корзина</span></button><button class="btn" id="pHist"><span class="ink">История правок</span></button></div></div>`;
  const reload = () => state.app.reload();
  const weekItems = () => A.items.filter((i) => i.week === selWeek && !i.deleted_at).sort((a, b) => a.ord - b.ord);

  function draw() {
    $('#pw', root).innerHTML = Array.from({ length: maxW }, (_, i) => i + 1).map((w) => `<button class="${w === selWeek ? 'on' : ''}" data-w="${w}"><span class="${w === selWeek ? 'onlime' : 'ink'}">${w}</span></button>`).join('');
    const list = weekItems();
    $('#pList', root).innerHTML = list.map((it, i) => `<div class="row" data-id="${it.id}" style="${it.active ? '' : 'opacity:.5'}"><span class="ico">${ICON[it.kind]}</span>
      <button class="row-main" data-edit><span class="t"><span class="ink">${esc(it.title)}</span></span><span class="d cap"><span class="dim">${KIND[it.kind]}${it.est_minutes ? ' · ' + it.est_minutes + ' мин' : ''}${it.required ? '' : ' · по желанию'} · ${(it.tariffs || []).map((c) => A.tariffs.find((t) => t.code === c)?.name || c).join(', ') || 'никому'}${it.user_id ? ' · персонально ' + esc(A.profiles.find((p) => p.id === it.user_id)?.display_name || '') : ''}${it.active ? '' : ' · скрыт'}</span></span></button>
      <button class="up-btn" data-drag aria-label="Перетащить" style="touch-action:none;cursor:grab"><svg width="16" height="12" viewBox="0 0 16 12"><path d="M1 1.5h14M1 6h14M1 10.5h14" stroke="url(#gDim)" stroke-width="2" stroke-linecap="round"/></svg></button>
      <span style="display:flex;flex-direction:column;gap:4px"><button class="up-btn" data-up ${i ? '' : 'disabled style="opacity:.3"'} aria-label="Выше">${tri('u')}</button><button class="up-btn" data-down ${i < list.length - 1 ? '' : 'disabled style="opacity:.3"'} aria-label="Ниже">${tri('d')}</button></span></div>`).join('')
      || '<p class="dim empty-note">В этой неделе пока ничего нет</p>';
  }
  async function move(id, dir) {
    const list = weekItems(), i = list.findIndex((x) => x.id === id), j = i + dir; if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    await Promise.all(list.map((it, k) => sb.from('program_items').update({ ord: k + 1 }).eq('id', it.id)));
    list.forEach((it, k) => { it.ord = k + 1; }); draw();
  }
  // перетаскивание за ручку: строка едет за пальцем, соседи расступаются, при отпускании порядок сохраняется
  root.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('[data-drag]'); if (!h) return;
    const row = h.closest('.row[data-id]'), list = row.parentElement; e.preventDefault();
    h.setPointerCapture(e.pointerId);
    let startY = e.clientY; row.style.transition = 'none'; row.style.position = 'relative'; row.style.zIndex = 5; row.style.opacity = '.9';
    const move = (ev) => {
      let dy = ev.clientY - startY; row.style.transform = `translateY(${dy}px)`;
      const rect = row.getBoundingClientRect(), c = rect.top + rect.height / 2;
      const next = row.nextElementSibling, prev = row.previousElementSibling;
      if (next && c > next.getBoundingClientRect().top + next.getBoundingClientRect().height / 2) { const hgt = next.getBoundingClientRect().height + 8; list.insertBefore(row, next.nextSibling); startY += hgt; row.style.transform = `translateY(${ev.clientY - startY}px)`; }
      else if (prev && prev.matches('.row[data-id]') && c < prev.getBoundingClientRect().top + prev.getBoundingClientRect().height / 2) { const hgt = prev.getBoundingClientRect().height + 8; list.insertBefore(row, prev); startY -= hgt; row.style.transform = `translateY(${ev.clientY - startY}px)`; }
    };
    const up = async () => {
      h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
      row.style.cssText = ''; haptic();
      const ids = [...list.querySelectorAll('.row[data-id]')].map((r) => r.dataset.id);
      await Promise.all(ids.map((id, k) => sb.from('program_items').update({ ord: k + 1 }).eq('id', id)));
      ids.forEach((id, k) => { const it = A.items.find((x) => x.id === id); if (it) it.ord = k + 1; }); draw();
    };
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  });
  root.addEventListener('click', (e) => {
    const w = e.target.closest('[data-w]'); if (w) { selWeek = Number(w.dataset.w); return draw(); }
    const row = e.target.closest('.row[data-id]'); if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest('[data-up]')) return move(id, -1);
    if (e.target.closest('[data-down]')) return move(id, 1);
    if (e.target.closest('[data-edit]')) itemForm({}, reload, A.items.find((x) => x.id === id));
  });
  $('#pAdd', root).onclick = () => itemForm({ week: selWeek }, reload);
  $('#pPrev', root).onclick = () => preview();
  $('#pImp', root).onclick = () => importSheet(reload);
  $('#pTrash', root).onclick = () => trash(reload);
  $('#pHist', root).onclick = () => history();
  draw();

  function preview() {
    let code = 'barbermax', week = selWeek;
    const build = () => {
      const fake = { profile: { id: 'preview', tariff: { code } }, items: A.items };
      const list = L.visibleItems(fake).filter((i) => i.week === week && !i.user_id);
      return `<h2 class="sh-title"><span class="ink">Как видит ученик</span></h2>
        <div class="btns">${visTariffs().map((t) => `<button class="btn sm ${t.code === code ? 'pri' : ''}" data-t="${t.code}"><span class="${t.code === code ? 'onlime' : 'ink'}">${esc(t.name)}</span></button>`).join('')}</div>
        <div class="btns"><button class="btn sm" data-wk="-1">${tri('l')}</button><span class="pill">Неделя ${week}</span><button class="btn sm" data-wk="1">${tri('r')}</button></div>
        ${list.map((i) => `<div class="row static"><span class="ico">${ICON[i.kind]}</span><span class="row-main"><span class="ink t">${esc(i.title)}</span><span class="dim cap">${KIND[i.kind]}${i.est_minutes ? ' · ' + i.est_minutes + ' мин' : ''}${i.required ? '' : ' · по желанию'}</span></span></div>`).join('') || '<p class="dim">Задания этой недели появятся позже</p>'}`;
    };
    const mount = (sh) => {
      sh.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { code = b.dataset.t; setSheet(build(), mount); });
      sh.querySelectorAll('[data-wk]').forEach((b) => b.onclick = () => { week = Math.max(1, week + Number(b.dataset.wk)); setSheet(build(), mount); });
    };
    openSheet(build(), mount);
  }
}

export function parseItems(text) {
  const t = text.trim(); if (!t) return [];
  let rows;
  if (t.startsWith('[') || t.startsWith('{')) { rows = JSON.parse(t); if (!Array.isArray(rows)) rows = [rows]; }
  else {
    const csv = csvParse(t), head = csv[0].map((h) => h.trim().toLowerCase());
    rows = csv.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]?.trim()])));
  }
  const list = (v) => Array.isArray(v) ? v : String(v || '').split(/[|;\s]+/).map((x) => x.trim()).filter(Boolean);
  return rows.map((r, i) => {
    const title = r.title || r.название; const week = Number(r.week ?? r.неделя);
    if (!title || !week) throw new Error(`Строка ${i + 1}: нужны week и title`);
    const hasShort = r.why || r.how || r.result;
    const kind = r.kind || r.тип || (hasShort ? 'short_task' : 'short_task');
    if (!['lesson', 'live', 'homework', 'short_task', 'challenge_task'].includes(kind)) throw new Error(`Строка ${i + 1}: неизвестный тип ${kind}`);
    return { kind, week, title, on_date: r.date || r.on_date || r.дата || null, description: r.description || r.описание || null, why: r.why || null, how: r.how || null, result: r.result || null,
      est_minutes: Number(r.minutes ?? r.est_minutes) || null, xp: Number(r.xp) || 10, tags: list(r.tags), tariffs: list(r.tariffs).length ? list(r.tariffs) : ['barbermax', 'personal'],
      required: r.required === undefined ? kind !== 'short_task' && kind !== 'challenge_task' : !['false', '0', 'нет', 'no'].includes(String(r.required).toLowerCase()), has_notes: ['true', '1', 'да', 'yes'].includes(String(r.notes ?? r.has_notes).toLowerCase()) };
  });
}

function importSheet(reload) {
  openSheet(`<h2 class="sh-title"><span class="ink">Импорт программы</span></h2>
    <p class="dim cap">Вставьте JSON или CSV. JSON: список объектов с полями week, title, why, how, result, minutes, xp, tags, tariffs, при желании kind. CSV: первая строка с названиями колонок, например week,kind,title,minutes</p>
    <textarea class="field area" id="impText" style="min-height:160px" placeholder='[{"week":3,"title":"Название","why":"Зачем","how":"Как","result":"Результат","minutes":15,"xp":20}]'></textarea>
    <input type="file" id="impFile" accept=".json,.csv,.txt" class="field" style="padding-top:14px">
    <div class="btns"><button class="btn" id="impCheck"><span class="ink">Проверить</span></button><button class="btn pri" id="impGo" style="flex:1"><span class="onlime">Загрузить</span></button></div><p class="dim cap" id="impMsg"></p>`,
  (sh) => {
    const ta = sh.querySelector('#impText'), msg = sh.querySelector('#impMsg');
    sh.querySelector('#impFile').onchange = async (e) => { const f = e.target.files[0]; if (f) ta.value = await f.text(); };
    const check = () => { try { const r = parseItems(ta.value); msg.textContent = r.length ? `Готово к загрузке: ${r.length}` : 'Пусто'; return r; } catch (e) { msg.textContent = 'Ошибка: ' + e.message; return null; } };
    sh.querySelector('#impCheck').onclick = check;
    sh.querySelector('#impGo').onclick = async () => {
      const rows = check(); if (!rows || !rows.length) return;
      const next = {}; rows.forEach((r) => { const base = next[r.week] ?? Math.max(0, ...A.items.filter((i) => i.week === r.week).map((i) => i.ord)); next[r.week] = base + 1; r.ord = next[r.week]; });
      try { await dbOk(sb.from('program_items').insert(rows)); closeSheet(); toast(`Загружено: ${rows.length}`); reload(); } catch (e) { msg.textContent = 'Ошибка: ' + e.message; }
    };
  });
}

function trash(reload) {
  const list = A.items.filter((i) => i.deleted_at);
  openSheet(`<h2 class="sh-title"><span class="ink">Корзина программы</span></h2>${list.map((i) => `<div class="kv" data-id="${i.id}"><span class="grow" style="min-width:0"><span class="dim cap">Неделя ${i.week} · ${KIND[i.kind]}</span><br><span class="ink">${esc(i.title)}</span></span><button class="btn sm" data-back><span class="ink">Вернуть</span></button></div>`).join('') || '<p class="dim">Пусто</p>'}`,
  (sh) => sh.querySelectorAll('[data-back]').forEach((b) => b.onclick = async () => { await dbOk(sb.from('program_items').update({ deleted_at: null }).eq('id', b.closest('[data-id]').dataset.id)); closeSheet(); toast('Возвращено'); reload(); }));
}

async function history() {
  const rows = await dbOk(sb.from('audit_log').select('*').order('created_at', { ascending: false }).limit(60));
  const nm = { insert: 'добавлено', update: 'изменено', delete: 'удалено' };
  openSheet(`<h2 class="sh-title"><span class="ink">История правок</span></h2>${rows.map((r) => `<div class="kv" style="flex-direction:column;gap:2px"><span class="dim cap">${new Date(r.created_at).toLocaleString('ru-RU')} · ${esc(r.entity)} · ${nm[r.action] || esc(r.action)}</span><span class="ink">${esc((r.after || r.before || {}).title || (r.after || r.before || {}).name || (r.after || r.before || {}).key || r.entity_id || '')}</span></div>`).join('') || '<p class="dim">Пока пусто</p>'}`);
}
