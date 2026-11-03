// Рейтинг: прирост по метрикам относительно точки А. Общий зачёт в очках и отдельная таблица по каждой метрике, листается свайпом
import { $, esc, sb, state, toast } from './core.js';
import { openPage, helpBtn, helpSheetHtml } from './ui.js';
import { openSheet } from './core.js';

const pct = (g) => (g > 0 ? '+' : g < 0 ? '−' : '') + Math.abs(g).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + '%';
const pts = (n) => Number(n).toLocaleString('ru-RU') + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'очко' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'очка' : 'очков');

export async function loadTop(admin = false) {
  const { data, error } = await sb.rpc(admin ? 'leaderboard_admin' : 'leaderboard');
  if (error) throw error;
  return data;
}

// Таблицы: общая по очкам и по одной на каждую активную метрику
export function buildTables(top, metrics) {
  const rows = top.rows || [], w = top.weights || {}, cap = top.cap ?? 100;
  const tables = [{ key: 'total', title: 'Общий', list: rows.map((r) => ({ id: r.id, hidden: r.hidden, name: r.name, me: r.me, main: pts(r.total), sub: '', v: r.total })) }];
  for (const m of metrics) {
    const list = rows.filter((r) => r.gains && r.gains[m.key] != null).map((r) => ({ id: r.id, hidden: r.hidden, name: r.name, me: r.me, main: pct(r.gains[m.key]), sub: pts(Math.round((w[m.key] ?? 1) * Math.max(0, Math.min(Number(r.gains[m.key]), cap)))), v: Number(r.gains[m.key]) }))
      .sort((a, b) => b.v - a.v);
    tables.push({ key: m.key, title: m.name, list, hint: m.better === 'down' ? 'Чем меньше, тем лучше: снижение даёт прирост' : '' });
  }
  return tables;
}

const HID = { self: 'скрыт учеником', admin: 'скрыт админом' };
const rowHtml = (x, i, admin) => { const sub = [x.sub, admin && x.hidden ? HID[x.hidden] : ''].filter(Boolean).join(' · ');
  return `<div class="row ${admin ? '' : 'static '}top-row${x.me ? ' me' : ''}${admin && x.hidden ? ' off' : ''}"${admin ? ` data-uid="${esc(x.id)}"` : ''}><span class="top-place ${i < 3 ? 'p' + (i + 1) : ''}"><span class="${i < 3 ? 'onlime' : 'ink'}">${i + 1}</span></span>
  <span class="row-main"><span class="t"><span class="ink">${esc(x.name)}${x.me ? ' (ты)' : ''}</span></span>${sub ? `<span class="d cap"><span class="dim">${esc(sub)}</span></span>` : ''}</span>
  <span class="top-val"><span class="${i < 3 ? 'limet' : 'ink'}">${esc(x.main)}</span></span></div>`; };

export function myPlace(top) {
  const rows = top.rows || [], i = rows.findIndex((r) => r.me);
  return { place: i < 0 ? null : i + 1, total: rows.length, hidden: !!top.hidden };
}

// Кнопка-вход. Показывает место, если оно уже есть
export function topButtonHtml(order, id = 'topBtn') {
  return `<section class="sec" style="order:${order}"><button class="pend-btn" id="${id}"><span class="grow"><span class="title2 ink">Рейтинг учеников</span><br><span class="dim cap" data-top-sub hidden></span></span><span class="pend-n" data-top-n hidden><span class="onlime"></span></span></button></section>`;
}
export function bindTopButton(root, id = 'topBtn') {
  const b = $('#' + id, root); if (!b) return;
  b.onclick = openTop;
  loadTop().then((top) => {
    const { place, total } = myPlace(top); if (!place) return;
    const n = $('[data-top-n]', b); n.hidden = false; n.firstElementChild.textContent = place;
    const sub = $('[data-top-sub]', b); sub.hidden = false; sub.textContent = `Ты на ${place} месте из ${total}`;
  }).catch(() => {});
}

// Отрисовка рейтинга в готовый контейнер. admin: видны все ученики с пометкой скрытия, строки открывают карточку
export function mountTop(body, top, metrics, { admin = false, onRow } = {}) {
  const tables = buildTables(top, metrics), me = myPlace(top);
  const msg = admin ? `Учеников в рейтинге: ${tables[0].list.length}` : me.place ? `Ты на ${me.place} месте из ${me.total}` : me.hidden ? 'Ты скрыт из рейтинга. Включить можно в Профиле' : me.total ? 'Тебя пока нет в рейтинге' : 'Рейтинг появится, когда ученики сдадут точку А';
  const w = top.weights || {};
  body.innerHTML = `<div class="h"><span class="dim cap">${esc(msg)}</span><span class="grow"></span>${helpBtn('top')}</div>
    <div class="top-chips" id="topChips">${tables.map((t, i) => `<button class="btn sm ${i ? '' : 'pri'}" data-i="${i}"><span class="${i ? 'ink' : 'onlime'}">${esc(t.title)}</span></button>`).join('')}</div>
    <div class="pager" id="pager">${tables.map((t) => `<section class="pg"><div class="rows">${t.list.length ? t.list.map((x, i) => rowHtml(x, i, admin)).join('') : '<p class="dim">Пока никого. Прирост появится после замеров</p>'}</div></section>`).join('')}</div>`;
  const downs = metrics.filter((m) => m.better === 'down').map((m) => m.name);
  const helpText = `Общий зачёт считается в очках: прирост метрики в процентах от точки А × вес метрики. Вес показывает, насколько метрика влияет на результат.\n\n${metrics.map((m) => `${m.name} ×${w[m.key] ?? 1}`).join('\n')}\n\nПрирост больше ${top.cap ?? 100}% очков не добавляет.${downs.length ? ` Где лучше меньше (${downs.join(', ')}), снижение даёт прирост.` : ''}\n\nТаблицы по метрикам показывают только прирост. Начальные цифры никому не видны`;
  body.querySelector('[data-help="top"]').onclick = (e) => { e.stopPropagation(); openSheet(helpSheetHtml('Как считается рейтинг', esc(helpText))); };
  const pager = $('#pager', body), chips = [...body.querySelectorAll('#topChips [data-i]')];
  const mark = (i) => chips.forEach((c, k) => { c.classList.toggle('pri', k === i); c.firstElementChild.className = k === i ? 'onlime' : 'ink'; if (k === i) c.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); });
  chips.forEach((c) => c.onclick = () => pager.scrollTo({ left: Number(c.dataset.i) * pager.clientWidth, behavior: 'smooth' }));
  let t; pager.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(() => mark(Math.round(pager.scrollLeft / pager.clientWidth)), 60); }, { passive: true });
  if (onRow) pager.addEventListener('click', (e) => { const r = e.target.closest('[data-uid]'); if (r) onRow(r.dataset.uid); });
}

export function openTop() {
  const metrics = state.D.metrics.filter((m) => m.active);
  openPage('<div class="stack-s" id="topBody"><div class="spin"></div></div>', async (body) => {
    let top;
    try { top = await loadTop(); } catch (e) { console.warn(e); body.innerHTML = '<p class="dim">Не получилось загрузить рейтинг. Попробуй ещё раз позже</p>'; return; }
    mountTop(body, top, metrics);
  }, { title: 'Рейтинг' });
}
