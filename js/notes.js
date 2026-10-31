// Вкладка «Выводы»: выводы (календарь и список) и вопросы
import { $, esc, state, openSheet, closeSheet, toast, haptic, store } from './core.js';
import * as L from './logic.js';
import * as data from './data.js';
import { SOURCES } from './ui.js';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const QSTAT = { open: 'Открытые', asked: 'Заданные', dropped: 'Снятые' };

export function renderNotes(root) {
  const D = state.D;
  let seg = store.get('notes.seg', 'insights'), view = store.get('notes.view', 'cal'), qst = 'open';
  const now = new Date(); let ym = { y: now.getFullYear(), m: now.getMonth() }, selDay = L.ymd(now);

  root.innerHTML = `<div class="stack"><div class="pagehead"><h1 class="h1s grow"><span class="ink">Выводы</span></h1></div>
    <div class="seg" id="seg"><button data-s="insights">Выводы</button><button data-s="questions">Вопросы</button></div><div id="body"></div></div>`;
  const body = $('#body', root);

  function drawSeg() { root.querySelectorAll('#seg button').forEach((b) => { const on = b.dataset.s === seg; b.classList.toggle('on', on); b.innerHTML = `<span class="${on ? 'onlime' : 'dim'}">${b.textContent}</span>`; }); }
  const live = () => D.insights.filter((i) => !i.deleted_at);
  const entryCard = (i) => `<button class="note-card" data-ed="${i.id}"><span class="dim cap">${L.fmtDay(L.parseDay(i.entry_date))} · ${SOURCES[i.source]}</span>
    ${i.title ? `<span class="title2 ink">${esc(i.title)}</span>` : ''}<span class="body ink">${esc(i.body)}</span></button>`;

  function drawInsights() {
    const byDay = new Map(); live().forEach((i) => byDay.set(i.entry_date, (byDay.get(i.entry_date) || 0) + 1));
    const first = new Date(ym.y, ym.m, 1), lead = (first.getDay() + 6) % 7, days = new Date(ym.y, ym.m + 1, 0).getDate();
    const cells = [...Array(lead).fill('<span class="e"></span>'), ...Array.from({ length: days }, (_, k) => {
      const d = k + 1, key = `${ym.y}-${L.pad(ym.m + 1)}-${L.pad(d)}`;
      return `<button data-d="${key}" class="${key === L.ymd(now) ? 'today ' : ''}${key === selDay ? 'sel' : ''}"><span class="${key === selDay ? 'onlime' : 'ink'}">${d}</span>${byDay.has(key) ? '<i class="dot"></i>' : ''}</button>`; })];
    const dayList = live().filter((i) => i.entry_date === selDay).sort((a, b) => b.created_at.localeCompare(a.created_at));
    const all = live().sort((a, b) => b.entry_date.localeCompare(a.entry_date) || b.created_at.localeCompare(a.created_at));
    body.innerHTML = `<div class="stack"><div class="btns"><button class="btn pri" id="addIns" style="flex:1"><span class="onlime">Записать вывод</span></button>
      <button class="btn" id="tglView"><span class="ink">${view === 'cal' ? 'Список' : 'Календарь'}</span></button></div>
      ${view === 'cal' ? `<div class="grid-cards"><div class="card"><div class="cal-nav"><button data-nav="-1" aria-label="Назад"><span class="ink">‹</span></button><span class="title2 ink">${MONTHS[ym.m]} ${ym.y}</span><button data-nav="1" aria-label="Вперёд"><span class="ink">›</span></button></div>
        <div class="cal">${['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((x) => `<span class="dow dim">${x}</span>`).join('')}${cells.join('')}</div></div>
        <div class="stack-s"><span class="dim cap">${L.fmtDay(L.parseDay(selDay))}</span>${dayList.map(entryCard).join('') || '<p class="dim empty-note">В этот день записей нет</p>'}</div></div>`
      : `<div class="stack-s">${all.map(entryCard).join('') || '<p class="dim empty-note">Здесь будут твои выводы после созвонов, эфиров и уроков</p>'}</div>`}</div>`;
  }

  function drawQuestions() {
    const qs = D.questions.filter((q) => !q.deleted_at && q.status === qst).sort((a, b) => b.created_at.localeCompare(a.created_at));
    body.innerHTML = `<div class="stack"><div class="btns"><button class="btn pri" id="addQ" style="flex:1"><span class="onlime">Добавить вопрос</span></button></div>
      <div class="seg" id="qseg">${Object.entries(QSTAT).map(([k, t]) => `<button data-q="${k}" class="${k === qst ? 'on' : ''}"><span class="${k === qst ? 'onlime' : 'dim'}">${t}</span></button>`).join('')}</div>
      <div class="stack-s">${qs.map((q) => `<button class="note-card" data-qid="${q.id}"><span class="body ink">${esc(q.body)}</span><span class="dim cap">${L.fmtDay(new Date(q.created_at))}${q.origin === 'trigger' ? ' · предложенный' : ''}</span></button>`).join('') || '<p class="dim empty-note">Пока пусто</p>'}</div></div>`;
  }
  function draw() { drawSeg(); seg === 'insights' ? drawInsights() : drawQuestions(); }

  // ----- запись вывода -----
  function insightSheet(id) {
    const i = id ? D.insights.find((x) => x.id === id) : { entry_date: selDay, source: 'other', title: '', body: '' };
    let src = i.source;
    openSheet(`<h2 class="sh-title"><span class="ink">${id ? 'Правка' : 'Новый вывод'}</span></h2>
      <input class="field" type="date" id="iDate" value="${esc(i.entry_date)}" max="${L.ymd(new Date())}">
      <div class="btns" id="iSrc">${Object.entries(SOURCES).map(([k, t]) => `<button class="btn sm ${k === src ? 'pri' : ''}" data-src="${k}"><span class="${k === src ? 'onlime' : 'ink'}">${t}</span></button>`).join('')}</div>
      <input class="field" id="iTitle" maxlength="120" placeholder="Заголовок, если нужен" value="${esc(i.title || '')}">
      <textarea class="field area" id="iBody" maxlength="4000" placeholder="Что понял, что хочешь запомнить">${esc(i.body || '')}</textarea>
      <div class="btns"><button class="btn pri" id="iSave" style="flex:1"><span class="onlime">Сохранить</span></button>${id ? '<button class="btn" id="iDel"><span class="redt">В корзину</span></button>' : ''}</div>`,
    (sh) => {
      sh.querySelectorAll('[data-src]').forEach((b) => b.onclick = () => { src = b.dataset.src; sh.querySelectorAll('[data-src]').forEach((x) => { const on = x.dataset.src === src; x.classList.toggle('pri', on); x.firstElementChild.className = on ? 'onlime' : 'ink'; }); });
      sh.querySelector('#iSave').onclick = async () => {
        const text = sh.querySelector('#iBody').value.trim(); if (!text) { toast('Впиши текст'); return; }
        const row = { id, entry_date: sh.querySelector('#iDate').value || L.ymd(new Date()), source: src, title: sh.querySelector('#iTitle').value.trim(), body: text };
        closeSheet(); await data.saveInsight(row); selDay = row.entry_date; const d = L.parseDay(selDay); ym = { y: d.getFullYear(), m: d.getMonth() };
        haptic(); toast(id ? 'Сохранено' : 'Вывод записан'); draw();
      };
      const del = sh.querySelector('#iDel');
      if (del) del.onclick = async () => { closeSheet(); await data.setInsightDeleted(id, true); draw(); toast('Удалено, вернуть', async () => { await data.setInsightDeleted(id, false); draw(); }); };
    });
  }

  // ----- вопросы -----
  function addQuestionSheet() {
    const fired = L.evaluateTriggers(D), hints = L.questionHints(D, fired);
    const ctx = [];
    const cur = L.latestValues(D);
    D.metrics.filter((m) => m.active && cur[m.key] != null).slice(0, 6).forEach((m) => ctx.push(`${m.name}: ${L.fmtNum(cur[m.key])}`));
    const openN = D.questions.filter((q) => q.status === 'open' && !q.deleted_at).length;
    openSheet(`<h2 class="sh-title"><span class="ink">Новый вопрос</span></h2>
      ${hints.length ? `<span class="dim cap">Можно начать с этого</span><div class="stack-s">${hints.map((h) => `<button class="opt" data-h="${esc(h.text)}" data-c="${h.code}"><span class="grow"><span class="ink">${esc(h.text)}</span></span></button>`).join('')}</div>` : ''}
      <textarea class="field area" id="qBody" maxlength="500" placeholder="Что хочешь спросить у эксперта"></textarea>
      ${ctx.length || openN ? `<div class="hint dim">${ctx.length ? 'Твои цифры: ' + esc(ctx.join(' · ')) + '. ' : ''}${openN ? 'Открытых вопросов: ' + openN : ''}</div>` : ''}
      <button class="btn pri wide" id="qSaveBtn"><span class="onlime">Сохранить</span></button>`,
    (sh) => {
      let code = null;
      sh.querySelectorAll('[data-h]').forEach((b) => b.onclick = () => { sh.querySelector('#qBody').value = b.dataset.h; code = b.dataset.c; });
      sh.querySelector('#qSaveBtn').onclick = async () => {
        const t = sh.querySelector('#qBody').value.trim(); if (!t) { toast('Впиши вопрос'); return; }
        closeSheet(); await data.addQuestion(t, code ? 'trigger' : 'manual', code); toast('Вопрос сохранён'); qst = 'open'; draw();
      };
    });
  }
  function questionSheet(id) {
    const q = D.questions.find((x) => x.id === id);
    const set = async (status, msg) => { closeSheet(); const prev = q.status; await data.updateQuestion(id, { status }); toast(msg, async () => { await data.updateQuestion(id, { status: prev }); draw(); }); draw(); };
    openSheet(`<p class="ink">${esc(q.body)}</p>
      ${q.status !== 'asked' ? '<button class="btn pri wide" data-a="asked"><span class="onlime">Задал</span></button>' : ''}
      ${q.status !== 'open' ? '<button class="btn wide" data-a="open"><span class="ink">Вернуть в открытые</span></button>' : ''}
      ${q.status === 'open' ? '<button class="btn wide" data-a="dropped"><span class="ink">Снять</span></button>' : ''}
      <button class="btn wide" data-a="del"><span class="redt">В корзину</span></button>`,
    (sh) => sh.querySelectorAll('[data-a]').forEach((b) => b.onclick = async () => {
      const a = b.dataset.a;
      if (a === 'del') { closeSheet(); await data.updateQuestion(id, { deleted_at: new Date().toISOString() }); draw(); toast('Удалено, вернуть', async () => { await data.updateQuestion(id, { deleted_at: null }); draw(); }); }
      else set(a, a === 'asked' ? 'Отмечено как заданный' : a === 'dropped' ? 'Вопрос снят' : 'Вопрос открыт');
    }));
  }

  root.addEventListener('click', (e) => {
    const s = e.target.closest('#seg [data-s]'); if (s) { seg = s.dataset.s; store.set('notes.seg', seg); return draw(); }
    if (e.target.closest('#addIns')) return insightSheet();
    if (e.target.closest('#tglView')) { view = view === 'cal' ? 'list' : 'cal'; store.set('notes.view', view); return draw(); }
    const d = e.target.closest('[data-d]'); if (d) { selDay = d.dataset.d; return draw(); }
    const nv = e.target.closest('[data-nav]'); if (nv) { const t = new Date(ym.y, ym.m + Number(nv.dataset.nav), 1); ym = { y: t.getFullYear(), m: t.getMonth() }; return draw(); }
    const ed = e.target.closest('[data-ed]'); if (ed) return insightSheet(ed.dataset.ed);
    if (e.target.closest('#addQ')) return addQuestionSheet();
    const qs = e.target.closest('[data-q]'); if (qs && qs.closest('#qseg')) { qst = qs.dataset.q; return draw(); }
    const q = e.target.closest('[data-qid]'); if (q) return questionSheet(q.dataset.qid);
  });
  draw();
}
