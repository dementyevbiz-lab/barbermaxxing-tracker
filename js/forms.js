// Формы: поля метрик с автосохранением, скриншоты, форма замера
import { $, $$, esc, state, openSheet, closeSheet, toast, haptic, confirmBox } from './core.js';
import * as L from './logic.js';
import * as data from './data.js';
import { SCREEN_KINDS, unitOf, openPage, closePage, VIDEO_ICON, helpBtn } from './ui.js';

export function parseNum(s) {
  const t = String(s ?? '').replace(/\s/g, '').replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

// Поля по активным метрикам. getVal(key) → текущее значение, onSave(key, number|null), placeholders(key) → подсказка в поле
export function metricFields(root, { getVal, onSave, placeholders = () => '' }) {
  const ms = state.D.metrics.filter((m) => m.active);
  root.innerHTML = ms.map((m) => `
    <div class="mfield" data-k="${m.key}">
      <div class="top"><span class="ink grow">${esc(m.name)}</span>${m.hint ? `<button class="qbtn" data-q="${m.key}" aria-label="Что это"><span class="dim">?</span></button>` : ''}</div>
      <div class="unit"><input class="field" inputmode="decimal" autocomplete="off" placeholder="${esc(placeholders(m.key))}" value="${esc(getVal(m.key) ?? '')}"><span class="dim">${esc(unitOf(m))}</span></div>
    </div>`).join('');
  const timers = {};
  root.addEventListener('click', (e) => {
    const q = e.target.closest('[data-q]'); if (!q) return;
    const m = ms.find((x) => x.key === q.dataset.q);
    openSheet(`<h2 class="sh-title"><span class="ink">${esc(m.name)}</span></h2><p class="ink">${esc(m.hint)}</p><p class="dim cap">Не знаешь точно, оставь пустым</p>`);
  });
  root.addEventListener('input', (e) => {
    const inp = e.target.closest('input'); if (!inp) return;
    const k = inp.closest('[data-k]').dataset.k;
    clearTimeout(timers[k]);
    timers[k] = setTimeout(() => commit(inp, k), 450);
  });
  root.addEventListener('change', (e) => { const inp = e.target.closest('input'); if (inp) { const k = inp.closest('[data-k]').dataset.k; clearTimeout(timers[k]); commit(inp, k); } });
  function commit(inp, k) {
    const v = parseNum(inp.value);
    if (Number.isNaN(v)) { inp.style.outline = '2px solid #F26161'; return; }
    inp.style.outline = '';
    onSave(k, v);
  }
}

// Сетка скриншотов замера
export function mountShots(root, cpId, { readonly = false } = {}) {
  const D = state.D;
  const max = D.settings.screenshots_cfg?.max_per_checkpoint ?? 8;
  let pickKind = null;
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.hidden = true; root.appendChild(input);
  const box = document.createElement('div'); root.appendChild(box);

  const live = () => D.screenshots.filter((s) => s.checkpoint_id === cpId && !s.deleted_at);
  async function draw() {
    const shots = live();
    const urls = await data.signedUrls(shots.map((s) => s.storage_path));
    const full = shots.length >= max;
    const slot = (kind, label) => {
      const s = shots.find((x) => x.kind === kind);
      if (s) return `<div class="slot has" data-shot="${s.id}"><img src="${esc(urls[s.storage_path] || '')}" alt="${esc(label)}"><div class="tag"><span class="plate"><span class="onlime">${esc(label)}</span></span></div></div>`;
      if (readonly || full) return '';
      return `<button class="slot" data-add="${kind}"><span class="plus"><span class="ink">+</span></span><span class="cap dim">${esc(label)}</span></button>`;
    };
    const others = shots.filter((s) => s.kind === 'other');
    box.innerHTML = `<div class="slots">
      ${SCREEN_KINDS.map(([k, l]) => slot(k, l)).join('')}
      ${others.map((s) => `<div class="slot has" data-shot="${s.id}"><img src="${esc(urls[s.storage_path] || '')}" alt="Другое"><div class="tag"><span class="plate"><span class="onlime">Другое</span></span></div></div>`).join('')}
      ${readonly || full ? '' : '<button class="slot" data-add="other"><span class="plus"><span class="ink">+</span></span><span class="cap dim">Другое</span></button>'}
    </div>${shots.length >= 3 ? '' : ''}<p class="dim cap" style="margin-top:10px">Скриншотов: ${shots.length} из ${max}. Три и больше дают бонус опыта</p>`;
  }
  async function pick(kind, replaceId) {
    pickKind = { kind, replaceId };
    input.value = ''; input.click();
  }
  async function handle(file) {
    if (!file || !pickKind) return;
    if (!/^image\//.test(file.type)) { toast('Нужна картинка'); return; }
    const { kind, replaceId } = pickKind; pickKind = null;
    const tmp = box.querySelector(`[data-add="${kind}"]`) || box.querySelector(`[data-shot="${replaceId}"]`);
    if (tmp) tmp.classList.add('drag');
    toast('Загружаем…');
    try {
      if (replaceId) await data.setScreenshotDeleted(replaceId, true);
      await data.uploadScreenshot(cpId, kind, file);
      toast('Скриншот добавлен'); haptic();
    } catch (e) { toast(e.message || 'Не получилось'); }
    draw();
  }
  input.addEventListener('change', () => handle(input.files[0]));
  box.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]'); if (add) return pick(add.dataset.add);
    const sh = e.target.closest('[data-shot]'); if (!sh || readonly) return;
    const s = D.screenshots.find((x) => x.id === sh.dataset.shot);
    openSheet(`<h2 class="sh-title"><span class="ink">Скриншот</span></h2>
      <button class="btn pri wide" data-a="rep"><span class="onlime">Заменить</span></button>
      <button class="btn wide" data-a="del"><span class="redt">Удалить</span></button>`, (el) => {
      el.querySelector('[data-a="rep"]').onclick = () => { closeSheet(); pick(s.kind, s.id); };
      el.querySelector('[data-a="del"]').onclick = async () => {
        closeSheet(); await data.setScreenshotDeleted(s.id, true); draw();
        toast('Удалено', async () => { await data.setScreenshotDeleted(s.id, false); draw(); });
      };
    });
  });
  // Перетаскивание файла на компьютере
  box.addEventListener('dragover', (e) => { const a = e.target.closest('[data-add]'); if (a) { e.preventDefault(); a.classList.add('drag'); } });
  box.addEventListener('dragleave', (e) => { const a = e.target.closest('[data-add]'); if (a) a.classList.remove('drag'); });
  box.addEventListener('drop', (e) => {
    const a = e.target.closest('[data-add]'); if (!a) return;
    e.preventDefault(); pickKind = { kind: a.dataset.add }; handle(e.dataTransfer.files[0]);
  });
  draw();
  return { redraw: draw };
}

// ---------- форма замера ----------
export function openCheckpoint(cpId, { onDone } = {}) {
  const D = state.D, cp = D.checkpoints.find((c) => c.id === cpId);
  const prevSent = L.submittedCheckpoints(D).filter((c) => c.idx < cp.idx).pop();
  const prevVals = prevSent ? D.cpValues[prevSent.id] || {} : {};
  const sent = !!cp.submitted_at;
  const title = cp.kind === 'final' ? 'Итоговый замер' : 'Замер';
  openPage(`
    <div class="card">
      <span class="plate ${sent ? 'lime' : ''}"><span class="onlime">${sent ? 'Отправлен, можно исправить' : 'До ' + L.fmtDay(L.parseDay(cp.due_date))}</span></span>
      <div class="h"><span class="dim cap">Подсказка по заполнению</span><span class="grow"></span>${helpBtn('cp')}</div>
    </div>
    <div class="card"><div class="h"><span class="ink">Цифры</span></div><div class="stack-s" id="cpFields"></div></div>
    <div class="card">
      <div class="h"><span class="ink">Скриншоты</span><span class="grow"></span><button class="qbtn" id="shotQ"><span class="dim">?</span></button></div>
      <div id="cpShots"></div>
    </div>
    <div class="card"><div class="h"><span class="ink">Заметка к замеру</span></div>
      <textarea class="field area" id="cpNote" placeholder="Если хочется что-то добавить" maxlength="1000">${esc(cp.note || '')}</textarea></div>
    <button class="btn pri wide sticky-actions" id="cpSubmit"><span class="onlime">${sent ? 'Готово' : 'Отправить замер'}</span></button>`,
  (body) => {
    metricFields($('#cpFields', body), {
      getVal: (k) => D.cpValues[cp.id]?.[k],
      onSave: (k, v) => data.saveCpValue(cp.id, k, v),
      placeholders: (k) => (k === 'top_views_avg' && topViewsHint() != null ? 'По твоим видео ' + L.fmtNum(topViewsHint()) : prevVals[k] != null ? 'Было ' + L.fmtNum(prevVals[k]) : ''),
    });
    mountShots($('#cpShots', body), cp.id);
    $('#shotQ', body).onclick = () => openSheet(`<h2 class="sh-title"><span class="ink">Что скриншотить</span></h2><p class="ink">${esc(D.settings.screenshot_help || '')}</p>`);
    let nt; $('#cpNote', body).addEventListener('input', (e) => { clearTimeout(nt); nt = setTimeout(() => data.saveCpNote(cp.id, e.target.value), 500); });
    $('#cpSubmit', body).onclick = async () => {
      if (sent) { closePage(); return; }
      const has = Object.values(D.cpValues[cp.id] || {}).some((v) => v != null);
      if (!has && !D.screenshots.some((s) => s.checkpoint_id === cp.id && !s.deleted_at)) { toast('Впиши хотя бы одну цифру'); return; }
      const ok = await data.submitCheckpoint(cp.id);
      if (ok) { toast('Замер отправлен'); haptic(); closePage(); onDone && onDone(); }
    };
  }, { title });
}

// ---------- видео: запись и результаты ----------
// Окно записи видео: направление, просмотры, дата, ссылка или заметка. onSaved(row) вызывается после записи
export function openVideoSheet({ onSaved } = {}) {
  const today = L.ymd(new Date()), min = L.ymd(L.addDays(new Date(), -30));
  let kind = null;
  openSheet(`<h2 class="sh-title"><span class="ink">Записать видео</span></h2>
    <div class="rows">${Object.entries(L.VIDEO_KINDS).map(([k, t]) => `<button class="opt" data-v="${k}"><span class="ico">${VIDEO_ICON[k]}</span><span class="grow"><span class="ink">${t}</span></span></button>`).join('')}</div>
    <label class="lbl"><span class="cap dim">Просмотры, если уже есть</span><input class="field" id="vViews" type="number" inputmode="numeric" min="0" placeholder="Можно добавить позже"></label>
    <label class="lbl"><span class="cap dim">Дата съёмки</span><input class="field" id="vDate" type="date" value="${today}" min="${min}" max="${today}"></label>
    <label class="lbl"><span class="cap dim">Ссылка или заметка</span><input class="field" id="vNote" maxlength="300" placeholder="Ссылка на ролик или пара слов"></label>
    <button class="btn pri wide" id="vSave" disabled><span class="onlime">Записать видео</span></button>`,
  (sh) => {
    const save = sh.querySelector('#vSave');
    sh.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => { kind = b.dataset.v; sh.querySelectorAll('[data-v]').forEach((x) => x.classList.toggle('pri', x === b)); save.disabled = false; });
    save.onclick = async () => {
      const raw = sh.querySelector('#vViews').value, views = raw === '' ? null : Math.max(0, parseInt(raw, 10) || 0);
      const date = sh.querySelector('#vDate').value || today, note = sh.querySelector('#vNote').value.trim();
      closeSheet(); const row = await data.logVideo(kind, views, { date, note }); haptic(); onSaved && onSaved(row);
    };
  });
}

// Окно видео: добавить просмотры и ссылку позже, убрать в корзину
export function openVideoEdit(id, { onChanged } = {}) {
  const v = state.D.videos.find((x) => x.id === id); if (!v) return;
  openSheet(`<span class="dim cap">${L.fmtDay(L.parseDay(v.logged_on))} · ${L.VIDEO_KINDS[v.kind]}</span><h2 class="sh-title"><span class="ink">Результат видео</span></h2>
    <label class="lbl"><span class="cap dim">Просмотры</span><input class="field" id="eViews" type="number" inputmode="numeric" min="0" value="${v.views ?? ''}"></label>
    <label class="lbl"><span class="cap dim">Ссылка или заметка</span><input class="field" id="eNote" maxlength="300" value="${esc(v.note || '')}"></label>
    <div class="btns"><button class="btn pri" id="eSave" style="flex:1"><span class="onlime">Сохранить</span></button><button class="btn" id="eDel"><span class="redt">В корзину</span></button></div>`,
  (sh) => {
    sh.querySelector('#eSave').onclick = async () => {
      const raw = sh.querySelector('#eViews').value;
      await data.updateVideo(id, { views: raw === '' ? null : Math.max(0, parseInt(raw, 10) || 0), note: sh.querySelector('#eNote').value.trim() || null });
      closeSheet(); toast('Сохранено'); onChanged && onChanged();
    };
    sh.querySelector('#eDel').onclick = async () => { closeSheet(); await data.setVideoUndone(id, true); onChanged && onChanged(); toast('Видео убрано', async () => { await data.setVideoUndone(id, false); onChanged && onChanged(); }); };
  });
}

// Подсказка для поля «Просмотры трёх лучших видео»: среднее по записанным видео за 30 дней
export function topViewsHint() {
  const since = L.addDays(new Date(), -30), v = L.liveVideos(state.D).filter((x) => x.views != null && L.parseDay(x.logged_on) >= since).map((x) => x.views).sort((a, b) => b - a).slice(0, 3);
  return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null;
}
