// Экран «Сегодня»
import { $, $$, esc, state, openSheet, closeSheet, toast, haptic, reduced, fit, store } from './core.js';
import * as L from './logic.js';
import * as data from './data.js';
import { bus } from './data.js';
import { ICON, KIND, VIDEO_ICON, checkSvg, pathSvg, pathLegend, placeMarkers, pathHelpSheet, plate } from './ui.js';
import { openCheckpoint, openVideoSheet } from './forms.js';
import { itemSheet } from './program.js';
import { progressHtml, achievementsHtml } from './progress.js';

export const CALL_KIND = { call: 'Созвон', strategy: 'Стратегическая сессия', city_strategy: 'Стратегия под город', bonus: 'Дополнительный созвон' };
const hiddenBlock = (name) => (state.D.profile.ui_overrides?.hide || []).includes(name);

export function todayModel() {
  const D = state.D, today = L.startOfDay();
  const info = L.weekInfo(D.profile, D.profile.tariff, today);
  const items = L.visibleItems(D);
  const { R } = L.calcR(D);
  const fired = L.evaluateTriggers(D, today);
  const tags = fired.map((f) => f.code);
  const readOnly = D.profile.status === 'paused' || info.state === 'finished';
  return { D, today, info, items, R, P: L.calcP(D, R, info, items), fired, tags, readOnly };
}

// Неделя, по которой показываем задания. До старта это первая неделя: ученик уже видит, что его ждёт, и может отмечать
export const effWeek = (info) => (info.state === 'active' || info.state === 'finished' ? info.n : info.state === 'before' ? 1 : 0);
function actionItems(m) {
  const { info, items, D, tags } = m;
  const wk = info.state === 'active' ? info.n : info.state === 'before' ? 1 : 0;
  if (!wk) return { today: [], week: [] };
  const ty = L.ymd(m.today);
  const base = items.filter((i) => !['short_task', 'challenge_task'].includes(i.kind));
  const st = L.pickShortTask(D, { state: 'active', n: wk }, tags);
  const doneShort = items.filter((i) => i.kind === 'short_task' && data.isDone(i.id) && L.diffDays(L.startOfDay(), L.startOfDay(new Date(D.completions.find((c) => c.item_id === i.id && !c.undone_at)?.completed_at || 0))) === 0);
  const today = [...base.filter((i) => i.on_date === ty), ...(st ? [st] : []), ...doneShort.filter((x) => !st || x.id !== st.id)];
  const week = base.filter((i) => i.week === wk && i.on_date !== ty);
  return { today, week };
}

function videoRowHtml(m) {
  if (m.readOnly || hiddenBlock('video') || !(m.info.state === 'active' || m.info.state === 'before')) return '';
  return `<div class="row" id="videoRow"><span class="ico" aria-hidden="true">🎬</span><button class="row-main" data-vopen><span class="t"><span class="ink">Снять видео</span></span><span class="d cap"><span class="dim" id="videoDetail">С клиентом, экспертное или лайф</span></span></button><button class="chk" data-vchk aria-label="Отметить">${checkSvg}</button></div>`;
}

function rowDetail(it, m) {
  const parts = [];
  if (it.est_minutes) parts.push(it.est_minutes + ' мин');
  if (it.on_date) parts.push(it.on_date === L.ymd(m.today) ? 'сегодня' : L.fmtDay(L.parseDay(it.on_date)));
  else if (it.kind === 'short_task') parts.push('короткое задание');
  else if (it.required && m.info.start) parts.push('обязательно · до ' + L.fmtDay(L.weekEnd(m.info.start, it.week)));
  else if (!it.required) parts.push('по желанию');
  if (it.has_notes && data.hasNotes(it.id)) parts.push('конспект есть');
  return parts.join(' · ');
}
const rowHtml = (it, m) => `<div class="row" data-id="${it.id}">
  <span class="ico" aria-hidden="true">${ICON[it.kind]}</span>
  <button class="row-main" data-open><span class="t"><span class="ink">${esc(it.title)}</span></span><span class="d cap"><span class="dim">${esc(rowDetail(it, m))}</span></span></button>
  <button class="chk" data-chk aria-label="Отметить">${checkSvg}</button></div>`;

export function renderToday(root) {
  const m = todayModel(), { D, info } = m;
  const hasNow = m.R != null;
  const challenge = challengeModel(m);
  const cp = L.nextCheckpoint(D, m.today);
  const call = L.nextCall(D);
  const callSoon = call && L.diffDays(L.dayOf(call.scheduled_at), m.today) <= 2 && !hiddenBlock('calls') ? call : null;
  const openQs = D.questions.filter((q) => q.status === 'open' && !q.deleted_at);

  // побочные эффекты показа: цитата дня и предложенный вопрос
  let quote = hiddenBlock('quote') ? null : L.pickQuote(D, m.tags, m.today);
  if (quote?.action) { data.markQuoteShown(quote.quote, quote.action); quote.action = null; }
  let sug = hiddenBlock('question') ? null : L.pickSuggestion(D, m.fired, m.today);
  let sugLog = sug?.log || null;
  if (sug && !sug.reuse) { data.logTriggerShown(sug.trigger.code); sugLog = D.triggerLog[D.triggerLog.length - 1]; }
  const movieHit = hiddenBlock('next') ? null : L.pickMovie(D, m.tags, effWeek(info) || 1);
  const movie = movieHit?.movie || null;

  root.innerHTML = `<div class="today"><div class="col">
    <section class="hdr" style="order:10">
      <button class="lvl" id="lvlBtn" aria-label="Уровень"><span class="onlime" id="lvlNum">1</span></button>
      <div class="hdr-mid"><div class="rank" id="rankWrap"><span class="ink" id="rankName"></span></div><div class="xpbar"><i id="xpFill"></i></div></div>
      <span class="plate" id="weekChip"><span class="onlime" id="weekChipTxt"></span></span>
    </section>
    <section class="strip-wrap" id="bStrip" style="order:20"><div class="strip" id="strip"></div></section>
    <section class="sec" id="bToday" style="order:35"><div class="h"><span class="ink">На сегодня</span><span class="grow"></span><span class="dim cap" id="todayCount"></span></div><div class="rows" id="todayList">${videoRowHtml(m)}</div></section>
    <section class="sec" id="bActions" style="order:40"><div class="h"><span class="ink">${info.state === 'before' ? 'Скоро, неделя 1' : 'Эта неделя'}</span><span class="grow"></span><span class="dim cap" id="actCount"></span></div><div class="rows" id="actList"></div></section>
    ${challenge ? `<section class="card" id="bChallenge" style="order:45"><div class="h"><span class="ink">${esc(challenge.c.title)}</span><span class="grow"></span><span class="dim cap" id="chProg"></span></div>${challenge.c.rules ? `<p class="dim cap">${esc(challenge.c.rules)}</p>` : ''}<div class="rows" id="chList"></div>
      <p class="dim cap">${challenge.result?.reward_status === 'given' ? 'Награда получена: ' : challenge.result?.completed_at ? 'Пройден. Награда: ' : 'Награда: '}${esc(challenge.c.reward_text || '')}</p></section>` : ''}
  </div><div class="col">
    ${bannerHtml(m)}
    ${progressHtml(D, info, m.items, L.calcR(D).rows)}
    ${achievementsHtml(D)}
    <section class="card" id="bPath" style="order:30">
      <div class="h"><span class="ink">Мой путь</span><span class="grow"></span><button class="qbtn" id="pathQ" aria-label="Что это"><span class="dim">?</span></button></div>
      ${pathSvg('t')}${pathLegend(hasNow)}
      ${D.goalText ? `<p class="goal ink">${esc(D.goalText)}</p>` : ''}
    </section>
    ${quote ? `<section class="card" style="order:60"><p class="quote ink">${esc(quote.quote.text)}</p><span class="dim cap">${esc(quote.quote.author)}${quote.quote.source ? ', ' + esc(quote.quote.source) : ''}</span></section>` : ''}
    ${movie ? `<section class="card" style="order:70"><span class="plate"><span class="onlime">${movieHit.byTag ? 'Следующий шаг' : movie.kind === 'book' ? 'Книга недели' : 'Фильм недели'}</span></span><p class="title2 ink">${esc(movie.title)}${movie.author ? ' · ' + esc(movie.author) : ''}${movie.year ? ', ' + movie.year : ''}</p><p class="dim cap">${esc(movie.why)}</p></section>` : ''}
    ${sug ? `<section class="card" id="bQuestion" style="order:80"><span class="plate"><span class="onlime">Можно спросить</span></span><p class="title2 ink">${esc(sug.text)}</p>
      ${sug.trigger.metric ? `<span class="dim cap">${esc(sug.trigger.metric.name)}</span>` : ''}
      <div class="btns"><button class="btn pri" id="qSave"><span class="onlime">Сохранить в вопросы</span></button><button class="btn" id="qHide"><span class="ink">Скрыть</span></button></div></section>` : ''}
    ${cp ? `<section class="card" style="order:90"><span class="plate lime"><span class="onlime">Замер ${esc(L.daysWord(cp.left))}</span></span>
      <p class="title2 ink">${cp.overdue ? 'Замер ждёт тебя' : 'Замер до ' + L.fmtDay(L.parseDay(cp.cp.due_date))}</p><p class="dim cap">Цифры и скриншоты, минут на 10</p>
      <button class="btn pri" id="checkBtn" style="align-self:flex-start"><span class="onlime">Заполнить</span></button></section>` : ''}
    ${callSoon ? `<section class="card" style="order:100"><button class="call-btn" id="callBtn"><span class="title2 ink">К созвону вопросов: ${openQs.length}</span>
      <span class="dim cap">${esc(CALL_KIND[callSoon.kind] || 'Созвон')} · ${L.fmtDay(new Date(callSoon.scheduled_at))}, ${L.fmtTime(new Date(callSoon.scheduled_at))}</span></button></section>` : ''}
  </div></div>`;

  const q = (s) => root.querySelector(s);

  // ----- шапка, полоска, путь -----
  function renderHeader() {
    const xp = data.xpNow(), step = data.lvlStep(), Lv = L.levelOf(xp, step), base = L.levelBase(Lv, step), next = L.levelBase(Lv + 1, step);
    q('#lvlNum').textContent = Lv; q('#rankName').textContent = L.rankOf(Lv, data.ranksList());
    q('#xpFill').style.width = Math.max(2, Math.min(100, (xp - base) / (next - base) * 100)) + '%';
    q('#weekChipTxt').textContent = info.state === 'active' || info.state === 'finished' ? `Неделя ${info.n} из ${info.weeks}` : info.state === 'before' ? 'Старт ' + L.fmtDayShort(info.start) : D.profile.tariff?.name || '';
    fit(q('#rankWrap'), 21);
  }
  function renderStrip() {
    const el = q('#strip'); el.innerHTML = '';
    if (info.state === 'nostart') { q('#bStrip').hidden = true; return; }
    for (let w = 1; w <= info.weeks; w++) {
      const st = L.weekState(D, w, info, m.items);
      const b = document.createElement('button');
      b.className = 'wk ' + st + ((info.state === 'active' && w === info.n) || (info.state === 'before' && w === 1) ? ' cur' : ''); b.dataset.week = w; b.setAttribute('aria-label', 'Неделя ' + w);
      b.innerHTML = `<span class="${st === 'full' || st === 'partial' ? 'onlime' : 'dim'}">${w}</span>`;
      el.appendChild(b);
    }
  }
  const model2 = () => { const mm = todayModel(); return mm; };
  function renderPath(animate) {
    const mm = model2();
    placeMarkers(root, 't', mm.R, mm.P, animate);
  }
  q('#strip').addEventListener('click', (e) => { const b = e.target.closest('.wk'); if (!b) return; state.programWeek = Number(b.dataset.week); state.app.go('program'); });
  q('#pathQ').onclick = () => openSheet(pathHelpSheet(hasNow));
  q('#lvlBtn').onclick = () => {
    const xp = data.xpNow(), step = data.lvlStep(), Lv = L.levelOf(xp, step);
    openSheet(`<h2 class="sh-title"><span class="ink">Уровень ${Lv} · ${esc(L.rankOf(Lv, data.ranksList()))}</span></h2>
      <div class="kv"><span class="dim">Опыт</span><span class="ink">${L.fmtNum(xp)}</span></div>
      <div class="kv"><span class="dim">До ${Lv + 1}-го уровня</span><span class="ink">${L.fmtNum(L.levelBase(Lv + 1, step) - xp)}</span></div>
      <p class="dim cap">Опыт приходит за уроки, домашки, видео, замеры и выводы. Он никогда не отнимается</p>`);
  };

  // ----- действия: «На сегодня» и «На неделю» -----
  const shown = actionItems(m);
  const lists = [
    { el: q('#todayList'), arr: shown.today, sec: q('#bToday'), count: q('#todayCount'), today: true },
    { el: q('#actList'), arr: shown.week, sec: q('#bActions'), count: q('#actCount') },
  ];
  function updateRow(el, it) {
    const done = data.isDone(it.id);
    el.classList.toggle('done', done);
    const c = el.querySelector('.chk'); c.classList.toggle('on', done); c.setAttribute('aria-pressed', done); c.setAttribute('aria-label', done ? 'Снять отметку' : 'Отметить');
    el.querySelector('.d .dim').textContent = rowDetail(it, m);
  }
  function sortList(x) {
    const els = [...x.el.querySelectorAll('.row[data-id]')], first = new Map(els.map((e) => [e, e.getBoundingClientRect().top]));
    const order = x.arr.map((i) => i.id), vr = x.el.querySelector('#videoRow');
    [...els].sort((a, b) => (a.classList.contains('done') - b.classList.contains('done')) || (order.indexOf(a.dataset.id) - order.indexOf(b.dataset.id))).forEach((e) => x.el.insertBefore(e, vr || null));
    if (reduced) return;
    els.forEach((e) => { const dy = first.get(e) - e.getBoundingClientRect().top; if (Math.abs(dy) > 1 && e.animate) e.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: 300, easing: 'cubic-bezier(.2,.7,.2,1)' }); });
  }
  const videosToday = () => D.videos.filter((v) => !v.undone_at && v.logged_on === L.ymd(new Date())).length;
  function renderList(x, defer) {
    const hasVideo = !!x.el.querySelector('#videoRow');
    if (!x.arr.length && !hasVideo) { x.sec.hidden = true; return; }
    x.sec.hidden = false;
    for (const it of x.arr) {
      let row = x.el.querySelector(`[data-id="${it.id}"]`);
      if (!row) { const vr = x.el.querySelector('#videoRow'); vr ? vr.insertAdjacentHTML('beforebegin', rowHtml(it, m)) : x.el.insertAdjacentHTML('beforeend', rowHtml(it, m)); row = x.el.querySelector(`[data-id="${it.id}"]`); }
      updateRow(row, it);
    }
    if (x.today) {
      const total = x.arr.length + (hasVideo ? 1 : 0), got = x.arr.filter((i) => data.isDone(i.id)).length + (hasVideo && videosToday() ? 1 : 0);
      x.count.textContent = total ? `${got} из ${total}` : '';
    } else { const req = x.arr.filter((i) => i.required); x.count.textContent = req.length ? `${req.filter((i) => data.isDone(i.id)).length} из ${req.length}` : ''; }
    clearTimeout(x.timer); if (defer) x.timer = setTimeout(() => sortList(x), 420); else sortList(x);
  }
  const renderActions = (defer) => lists.forEach((x) => renderList(x, defer));
  if (challenge) {
    const cl = q('#chList'); cl.innerHTML = challenge.tasks.map((i) => rowHtml(i, m)).join('');
    var chRefresh = () => {
      challenge.tasks.forEach((i) => updateRow(cl.querySelector(`[data-id="${i.id}"]`), i));
      q('#chProg').textContent = `${challenge.tasks.filter((i) => data.isDone(i.id)).length} из ${challenge.tasks.length}`;
    };
    chRefresh();
  }
  function afterToggle(id, wasLevel) {
    renderHeader(); renderStrip(); renderPath(true); renderActions(true);
    if (challenge) chRefresh();
  }
  function toggle(id) {
    if (m.readOnly) { toast(D.profile.status === 'paused' ? 'Программа на паузе' : 'Программа завершена'); return; }
    const L0 = L.levelOf(data.xpNow(), data.lvlStep());
    const p = data.toggleDone(id); haptic();
    const done = data.isDone(id);
    const L1 = L.levelOf(data.xpNow(), data.lvlStep());
    afterToggle(id);
    toast(done ? (L1 > L0 ? 'Засчитано · уровень ' + L1 : 'Засчитано') : 'Отметка снята');
    return p;
  }
  root.addEventListener('click', (e) => {
    const row = e.target.closest('.row[data-id]'); if (!row || !root.contains(row)) return;
    if (e.target.closest('[data-chk]')) toggle(row.dataset.id);
    else if (e.target.closest('[data-open]')) itemSheet(row.dataset.id, { onChange: () => afterToggle(row.dataset.id), readOnly: m.readOnly });
  });

  // ----- видео -----
  function renderVideo() {
    const row = q('#videoRow'); if (!row) return;
    const n = videosToday();
    row.classList.toggle('done', n > 0); const c = row.querySelector('.chk'); c.classList.toggle('on', n > 0);
    let week = { total: 0 };
    if (info.state === 'active') week = L.videoCounts(D, L.weekStart(info.start, info.n), L.weekEnd(info.start, info.n));
    row.querySelector('#videoDetail').textContent = n || week.total ? `Сегодня ${n} · на этой неделе ${week.total}` : 'С клиентом, экспертное или лайф';
    renderActions(false);
  }
  const openVideo = () => openVideoSheet({ onSaved: (row) => {
    const L1 = L.levelOf(data.xpNow(), data.lvlStep());
    renderHeader(); renderStrip(); renderPath(true); renderVideo();
    toast('Видео записано. Просмотры можно добавить на вкладке Путь', async () => { await data.setVideoUndone(row.id, true); renderHeader(); renderStrip(); renderPath(true); renderVideo(); toast('Отметка снята'); });
  } });
  const vrow = q('#videoRow');
  if (vrow) vrow.addEventListener('click', (e) => { if (e.target.closest('[data-vopen],[data-vchk]')) openVideo(); });

  // ----- карточки -----
  const qs = q('#qSave');
  if (qs) {
    qs.onclick = async () => {
      const row = await data.addQuestion(sug.text, 'trigger', sug.trigger.code); haptic();
      q('#bQuestion').hidden = true;
      toast('Сохранено в вопросы', async () => { await data.updateQuestion(row.id, { deleted_at: new Date().toISOString() }); q('#bQuestion').hidden = false; });
    };
    q('#qHide').onclick = async () => {
      const log = sugLog;
      if (log) await data.dismissTrigger(log); q('#bQuestion').hidden = true;
      toast('Скрыто на 14 дней', async () => { if (log) await data.dismissTrigger(log, false); q('#bQuestion').hidden = false; });
    };
  }
  const cb = q('#checkBtn'); if (cb) cb.onclick = () => openCheckpoint(cp.cp.id, { onDone: () => state.app.refresh() });
  const cc = q('#callBtn');
  if (cc) cc.onclick = () => openSheet(`<span class="dim cap">${esc(CALL_KIND[callSoon.kind] || 'Созвон')} · ${L.fmtDay(new Date(callSoon.scheduled_at))}, ${L.fmtTime(new Date(callSoon.scheduled_at))}</span>
    <h2 class="sh-title"><span class="ink">Вопросы к созвону</span></h2>
    ${openQs.length ? `<ul class="qlist">${openQs.map((x) => `<li data-q="${x.id}" style="display:flex;gap:10px;align-items:center"><span class="ink" style="flex:1">${esc(x.body)}</span><button class="btn sm" data-ask><span class="ink">Задал</span></button></li>`).join('')}</ul>` : '<p class="dim">Пока вопросов нет. Их можно записать на вкладке Выводы</p>'}`,
    (sh) => sh.querySelectorAll('[data-ask]').forEach((b) => b.onclick = async () => {
      const id = b.closest('[data-q]').dataset.q; await data.updateQuestion(id, { status: 'asked' }); b.closest('li').remove(); toast('Отмечено');
      const t = q('#callBtn .title2 .ink, #callBtn .title2'); if (t) t.textContent = 'К созвону вопросов: ' + D.questions.filter((x) => x.status === 'open' && !x.deleted_at).length;
    }));

  const gp = q('[data-go-profile]'); if (gp) gp.onclick = () => state.app.go('profile');
  renderHeader(); renderStrip(); renderActions(false); renderVideo();
  const onProgress = () => { if (root.isConnected) { renderHeader(); } };
  bus.addEventListener('progress', onProgress);
  const place = () => renderPath(false);
  place();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { fit(q('#rankWrap'), 21); place(); });
  const onResize = () => { if (root.isConnected) { fit(q('#rankWrap'), 21); place(); } else window.removeEventListener('resize', onResize); };
  window.addEventListener('resize', onResize);
  return () => bus.removeEventListener('progress', onProgress);
}

function bannerHtml(m) {
  const { info, D } = m;
  if (D.profile.status === 'paused') return `<section class="card" style="order:5"><span class="plate"><span class="onlime">Пауза</span></span><p class="title2 ink">Программа на паузе</p><p class="dim cap">Всё сохранено, отмечать пока нельзя</p></section>`;
  if (info.state === 'before') return `<section class="card" style="order:5"><span class="plate lime"><span class="onlime">Старт ${esc(L.daysWord(info.daysToStart))}</span></span><p class="title2 ink">Программа начнётся ${L.fmtDay(info.start)}</p><p class="dim cap">Уже можно отмечать задания и видео: опыт засчитается</p></section>`;
  if (info.state === 'finished') return `<section class="card" style="order:5"><span class="plate lime"><span class="onlime">Программа пройдена</span></span><p class="title2 ink">Итог можно скачать в профиле</p><button class="btn pri" data-go-profile style="align-self:flex-start"><span class="onlime">Открыть профиль</span></button></section>`;
  return '';
}

function challengeModel(m) {
  const { D, info } = m;
  if (hiddenBlock('challenge') || D.profile.tariff?.features?.challenges === false || info.state !== 'active') return null;
  const c = D.challenges.find((x) => x.active && info.n >= x.start_week && (!x.end_week || info.n <= x.end_week));
  if (!c) return null;
  const tasks = m.items.filter((i) => i.kind === 'challenge_task' && (i.tags || []).includes(c.code));
  if (!tasks.length) return null;
  return { c, tasks, result: D.challengeResults.find((r) => r.challenge_id === c.id) };
}
