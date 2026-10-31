// Админка: карточка ученика. Выводов и вопросов ученика здесь нет
import { $, esc, sb, state, callFn, openSheet, closeSheet, toast, confirmBox, uuid } from '../core.js';
import * as L from '../logic.js';
import { openPage, closePage, pathSvg, pathLegend, placeMarkers, fmtMetric, sparkline, SCREEN_KINDS } from '../ui.js';
import { A, summarize, formSheet, fmtDT, toLocalInput, dbOk } from './common.js';
import { linkSheet } from './students.js';

const CK = { call: 'Созвон', strategy: 'Стратегическая сессия', city_strategy: 'Стратегия под город', bonus: 'Дополнительный созвон' };
const STATUS = { invited: 'Приглашён', active: 'Идёт', paused: 'Пауза', finished: 'Завершил', blocked: 'Доступ закрыт' };
const BLOCKS = [['challenge', 'Челлендж'], ['quote', 'Цитата дня'], ['next', 'Следующий шаг'], ['question', 'Предложенный вопрос'], ['calls', 'Созвоны'], ['support', 'Поддержка'], ['video', 'Кнопка «Снял видео»']];

export function openCard(id) {
  const p = A.profiles.find((x) => x.id === id); if (!p) return;
  const s = summarize(p), D = s.D, info = s.info;
  const { rows } = L.calcR(D);
  const done = L.doneSets(D).done;
  const today = L.startOfDay();
  const cnt = (days) => ({ c: D.completions.filter((c) => !c.undone_at && L.diffDays(today, L.dayOf(c.completed_at)) < days).length, v: D.videos.filter((v) => !v.undone_at && L.diffDays(today, L.parseDay(v.logged_on)) < days).length });
  const a7 = cnt(7), a14 = cnt(14), vAll = L.videoCounts(D);
  const Lv = L.levelOf(s.xp, A.settings.level_step ?? 50), rank = L.rankOf(Lv, A.settings.ranks || L.DEFAULT_RANKS);
  const tierNames = A.settings.tier_names || ['Бронза', 'Серебро', 'Золото', 'Платина'];
  const fired = L.evaluateTriggers(D, today).filter((f) => f.code !== 'insights_none');
  const notes = A.notes.filter((n) => n.user_id === id).sort((a, b) => (b.pinned - a.pinned) || b.created_at.localeCompare(a.created_at));
  const calls = D.calls.sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  const hide = p.ui_overrides?.hide || [];
  const ch = A.challenges.find((c) => c.code === 'quick_booking');
  const chRes = ch ? A.challengeResults.find((r) => r.user_id === id && r.challenge_id === ch.id) : null;
  const myAch = D.userAch.filter((u) => !u.revoked_at);
  const link = p.invite_code ? `https://t.me/${window.BMX_CONFIG.botUsername}?startapp=${p.invite_code}` : null;
  const baseline = D.checkpoints.find((c) => c.idx === 0);

  const html = `
    <div class="card"><div style="display:flex;gap:8px;flex-wrap:wrap"><span class="plate lime"><span class="onlime">${esc(STATUS[p.status])}</span></span><span class="plate"><span class="onlime">${esc(p.tariff?.name || 'без тарифа')}</span></span>
        ${info.state === 'active' || info.state === 'finished' ? `<span class="plate"><span class="onlime">Неделя ${info.n} из ${info.weeks}</span></span>` : ''}</div>
      <p class="dim cap">${p.tg_username ? '@' + esc(p.tg_username) + ' · ' : ''}старт ${p.start_date ? L.fmtDay(L.parseDay(p.start_date)) : 'не назначен'}${p.last_seen_at ? ' · заходил ' + fmtDT(p.last_seen_at) : ''}</p>
      <div class="kv"><span class="dim">Уровень</span><span class="ink">${Lv} · ${esc(rank)}</span></div><div class="kv"><span class="dim">Опыт</span><span class="ink">${L.fmtNum(s.xp)}</span></div>
      ${link ? `<div class="link-box">${esc(link)}</div>` : ''}</div>

    ${s.expected.length || s.cp || fired.length || s.inactive ? `<div class="card"><div class="h"><span class="ink">На что нацелить внимание</span></div><div class="stack-s">
      ${s.lagging ? `<div class="hint ink">Сделано ${Math.round(s.share * 100)}% обязательного к этой неделе</div>` : ''}
      ${s.inactive ? '<div class="hint ink">Давно не заходил в приложение</div>' : ''}
      ${s.cpState === 'overdue' ? `<div class="hint ink">Замер ${s.cp.idx} просрочен: срок был ${L.fmtDay(L.parseDay(s.cp.due_date))}</div>` : ''}
      ${fired.map((f) => `<div class="hint ink">${esc((A.triggers.find((t) => t.code === f.code) || {}).title || f.code)}${f.metric ? ': ' + esc(f.metric.name) : ''}${f.direction ? ': ' + esc(L.VIDEO_KINDS[f.direction]) : ''}</div>`).join('')}
      ${!s.lagging && !s.inactive && !fired.length && s.cpState !== 'overdue' ? '<p class="dim">Тревожных меток нет</p>' : ''}</div></div>` : ''}

    <div class="card"><div class="h"><span class="ink">Метрики</span></div>
      <table class="tbl"><tr><th></th><th>А</th><th>Сейчас</th><th>Б</th></tr>${A.metrics.filter((m) => m.active).map((m) => {
        const g = D.goals[m.key] || {}, ser = L.metricSeries(D, m.key), cur = ser.filter((x) => x.idx > 0).slice(-1)[0]?.value;
        return `<tr data-a="${m.key}"><td class="ink">${esc(m.name)}</td><td class="ink">${esc(fmtMetric(m, g.a))}</td><td class="ink">${esc(fmtMetric(m, cur))}</td><td class="ink">${esc(fmtMetric(m, g.b))}</td></tr>`; }).join('')}</table>
      <p class="dim cap">Нажмите на строку, чтобы изменить точку А. После первого замера её меняет только команда</p>
      ${D.goalText ? `<p class="goal ink">${esc(D.goalText)}</p>` : ''}</div>

    <div class="card"><div class="h"><span class="ink">Путь</span></div>${pathSvg('a')}${pathLegend(s.R != null)}</div>

    <div class="card"><div class="h"><span class="ink">Активность</span></div>
      <div class="stat-grid"><div class="stat"><span class="dim cap">За 7 дней</span><span class="big-num ink">${a7.c + a7.v}</span><span class="dim cap">отметок ${a7.c} · видео ${a7.v}</span></div>
      <div class="stat"><span class="dim cap">За 14 дней</span><span class="big-num ink">${a14.c + a14.v}</span><span class="dim cap">отметок ${a14.c} · видео ${a14.v}</span></div></div>
      <div class="kv"><span class="dim">Видео</span><span class="ink">с клиентом ${vAll.client} · экспертных ${vAll.expert} · лайф ${vAll.life}</span></div>
      <div class="kv"><span class="dim">Обязательное к этой неделе</span><span class="ink">${s.share == null ? '—' : Math.round(s.share * 100) + '%'}</span></div></div>

    <div class="card"><div class="h"><span class="ink">Скриншоты</span></div><div id="cShots"></div></div>

    ${myAch.length ? `<div class="card"><div class="h"><span class="ink">Ачивки</span></div><div class="stack-s">${[...new Set(myAch.map((u) => u.code))].map((code) => { const a = A.achievements.find((x) => x.code === code), top = Math.max(...myAch.filter((u) => u.code === code).map((u) => u.tier)); return `<div class="kv"><span class="ink">${esc(a?.name || code)}</span><span class="dim">${esc(tierNames[top - 1] || '')}</span></div>`; }).join('')}</div></div>` : ''}

    <div class="card"><div class="h"><span class="ink">Заметки</span><span class="grow"></span><button class="btn sm" id="nAdd"><span class="ink">Добавить</span></button></div>
      <div class="stack-s">${notes.map((n) => `<button class="note-card" data-n="${n.id}"><span class="dim cap">${n.pinned ? 'Закреплено · ' : ''}${fmtDT(n.created_at)}</span><span class="body ink">${esc(n.body)}</span></button>`).join('') || '<p class="dim">Ученик заметок не видит</p>'}</div></div>

    <div class="card"><div class="h"><span class="ink">Созвоны</span><span class="grow"></span><button class="btn sm" id="callAdd"><span class="ink">Добавить</span></button></div>
      <div class="stack-s">${calls.map((c) => `<button class="kv" data-call="${c.id}" style="text-align:left;width:100%"><span class="ink">${esc(CK[c.kind] || c.kind)}</span><span class="dim">${fmtDT(c.scheduled_at)}</span></button>`).join('') || '<p class="dim">Дат пока нет. Ученик видит только даты</p>'}</div></div>

    ${ch && ch.active ? `<div class="card"><div class="h"><span class="ink">${esc(ch.title)}</span></div><div class="kv"><span class="dim">Награда: ${esc(ch.reward_text || '')}</span><span class="ink">${{ none: 'пока нет', earned: 'заслужена', given: 'выдана' }[chRes?.reward_status || 'none']}</span></div>
      ${chRes?.reward_status === 'earned' ? '<button class="btn pri" id="rewGive" style="align-self:flex-start"><span class="onlime">Награда выдана</span></button>' : ''}
      ${chRes?.reward_status === 'given' ? '<button class="btn" id="rewBack" style="align-self:flex-start"><span class="ink">Вернуть в «заслужена»</span></button>' : ''}</div>` : ''}

    <div class="card"><div class="h"><span class="ink">Действия</span></div><div class="stack-s">
      <button class="opt" id="aTariff"><span class="grow"><span class="ink">Сменить тариф или дату старта</span></span></button>
      <button class="opt" id="aShift"><span class="grow"><span class="ink">Сдвинуть срок замера</span></span></button>
      <button class="opt" id="aItem"><span class="grow"><span class="ink">Добавить персональный пункт программы</span></span></button>
      <button class="opt" id="aBlocks"><span class="grow"><span class="ink">Блоки интерфейса ученика</span><span class="cap dim">Выключено: ${hide.length ? hide.map((h) => BLOCKS.find((b) => b[0] === h)?.[1] || h).join(', ') : 'ничего'}</span></span></button>
      <button class="opt" id="aStatus"><span class="grow"><span class="ink">${p.status === 'paused' ? 'Снять с паузы' : 'Поставить на паузу'}</span></span></button>
      <button class="opt" id="aNotif"><span class="grow"><span class="ink">${p.prefs?.admin_mute ? 'Включить уведомления бота' : 'Отключить уведомления бота'}</span></span></button>
      ${link ? '<button class="opt" id="aCopy"><span class="grow"><span class="ink">Скопировать ссылку-приглашение</span></span></button>' : ''}
      <button class="opt" id="aReissue"><span class="grow"><span class="ink">Новая ссылка-приглашение</span><span class="cap dim">Старая перестанет работать, прошлый аккаунт Telegram отвяжется</span></span></button>
      <button class="opt" id="aBlock"><span class="grow"><span class="ink">${p.status === 'blocked' ? 'Открыть доступ' : 'Закрыть доступ'}</span></span></button>
      <button class="opt" id="aDel"><span class="grow"><span class="redt">Удалить ученика со всеми данными</span></span></button></div></div>`;

  openPage(html, (body) => {
    placeMarkers(body, 'a', s.R, s.P, false);
    drawShots(body);
    const q = (sel) => body.querySelector(sel);
    const act = (sel, fn) => { const el = q(sel); if (el) el.onclick = fn; };
    const reload = async () => { await state.app.reload(); openCard(id); };
    const patch = async (obj, msg) => { await dbOk(sb.from('profiles').update(obj).eq('id', id)); toast(msg || 'Сохранено'); await reload(); };

    body.querySelectorAll('[data-a]').forEach((tr) => tr.onclick = () => {
      const m = A.metrics.find((x) => x.key === tr.dataset.a), g = D.goals[m.key] || {};
      formSheet({ title: m.name, fields: [{ k: 'a', label: 'Точка А', type: 'number' }, { k: 'b', label: 'Точка Б', type: 'number' }], initial: { a: g.a, b: g.b },
        onSave: async (v) => {
          await dbOk(sb.from('goals').upsert({ user_id: id, metric_key: m.key, a_value: v.a, b_value: v.b }, { onConflict: 'user_id,metric_key' }));
          if (baseline) await dbOk(sb.from('checkpoint_values').upsert({ checkpoint_id: baseline.id, metric_key: m.key, value: v.a }, { onConflict: 'checkpoint_id,metric_key' }));
          toast('Сохранено'); reload(); } });
    });
    act('#nAdd', () => formSheet({ title: 'Заметка об ученике', fields: [{ k: 'body', label: 'Текст', type: 'area', required: true }], onSave: async (v) => { await dbOk(sb.from('admin_notes').insert({ user_id: id, body: v.body })); reload(); } }));
    body.querySelectorAll('[data-n]').forEach((b) => b.onclick = () => {
      const n = A.notes.find((x) => x.id === b.dataset.n);
      formSheet({ title: 'Заметка', fields: [{ k: 'body', label: 'Текст', type: 'area', required: true }, { k: 'pinned', label: 'Закрепить', type: 'check' }], initial: n,
        onSave: async (v) => { await dbOk(sb.from('admin_notes').update({ body: v.body, pinned: !!v.pinned }).eq('id', n.id)); reload(); },
        danger: { label: 'Удалить', confirm: 'Удалить заметку?', run: async () => { await dbOk(sb.from('admin_notes').delete().eq('id', n.id)); reload(); } } });
    });
    const callForm = (c) => formSheet({ title: c ? 'Созвон' : 'Новый созвон', fields: [{ k: 'kind', label: 'Тип', type: 'select', options: Object.entries(CK) }, { k: 'at', label: 'Дата и время', type: 'datetime', required: true }],
      initial: { kind: c?.kind || 'call', at: toLocalInput(c?.scheduled_at) },
      onSave: async (v) => { const row = { user_id: id, kind: v.kind, scheduled_at: new Date(v.at).toISOString() }; await dbOk(c ? sb.from('calls').update(row).eq('id', c.id) : sb.from('calls').insert(row)); reload(); },
      danger: c ? { label: 'Удалить', confirm: 'Удалить созвон?', run: async () => { await dbOk(sb.from('calls').delete().eq('id', c.id)); reload(); } } : null });
    act('#callAdd', () => callForm());
    body.querySelectorAll('[data-call]').forEach((b) => b.onclick = () => callForm(A.calls.find((x) => x.id === b.dataset.call)));
    act('#rewGive', async () => { await dbOk(sb.from('challenge_results').update({ reward_status: 'given' }).eq('user_id', id).eq('challenge_id', ch.id)); toast('Отмечено'); callForm(); });
    act('#rewBack', async () => { await dbOk(sb.from('challenge_results').update({ reward_status: 'earned' }).eq('user_id', id).eq('challenge_id', ch.id)); toast('Возвращено'); reload(); });
    act('#aTariff', () => formSheet({ title: 'Тариф и старт', fields: [{ k: 'tariff_id', label: 'Тариф', type: 'select', options: A.tariffs.map((t) => [t.id, t.name]) }, { k: 'start_date', label: 'Дата старта', type: 'date' }],
      initial: { tariff_id: p.tariff_id, start_date: p.start_date }, extra: '<p class="dim cap">История сохранится, пересчитаются только недели, сроки замеров и видимость пунктов</p>',
      onSave: (v) => patch({ tariff_id: Number(v.tariff_id), start_date: v.start_date }) }));
    act('#aShift', () => {
      const cps = D.checkpoints.filter((c) => !c.submitted_at);
      if (!cps.length) return toast('Все замеры отправлены');
      formSheet({ title: 'Срок замера', fields: [{ k: 'id', label: 'Замер', type: 'select', options: cps.map((c) => [c.id, `Замер ${c.idx} · сейчас ${L.fmtDay(L.parseDay(c.due_date))}`]) }, { k: 'due', label: 'Новый срок', type: 'date', required: true }], initial: { id: cps[0].id, due: cps[0].due_date },
        onSave: async (v) => { await dbOk(sb.from('checkpoints').update({ due_date: v.due, due_shifted: true }).eq('id', v.id)); toast('Срок сдвинут'); reload(); } });
    });
    act('#aItem', () => itemForm({ user_id: id, week: info.state === 'active' ? info.n : 1 }, reload));
    act('#aBlocks', () => formSheet({ title: 'Что видит ученик', fields: BLOCKS.map(([k, t]) => ({ k, label: t, type: 'check' })), initial: Object.fromEntries(BLOCKS.map(([k]) => [k, !hide.includes(k)])),
      extra: '<p class="dim cap">Выключенный блок у этого ученика скрыт</p>', onSave: (v) => patch({ ui_overrides: { ...(p.ui_overrides || {}), hide: BLOCKS.map((b) => b[0]).filter((k) => !v[k]) } }) }));
    act('#aStatus', () => patch({ status: p.status === 'paused' ? 'active' : 'paused' }, p.status === 'paused' ? 'Пауза снята' : 'Поставлено на паузу'));
    act('#aNotif', () => patch({ prefs: { ...(p.prefs || {}), admin_mute: !p.prefs?.admin_mute } }, 'Сохранено'));
    act('#aCopy', () => linkSheet('Ссылка-приглашение', link, `Для ученика ${p.display_name}`));
    act('#aReissue', async () => { if (!await confirmBox('Старая ссылка перестанет работать. Прошлый аккаунт Telegram отвяжется. Продолжить?')) return; const r = await callFn('admin', { action: 'reissue_invite', user_id: id }, true); if (!r.ok) return toast(r.message || 'Не получилось'); await state.app.reload(); linkSheet('Новая ссылка', r.invite_link, `Для ученика ${p.display_name}`); });
    act('#aBlock', () => patch({ status: p.status === 'blocked' ? (p.telegram_id ? 'active' : 'invited') : 'blocked' }, p.status === 'blocked' ? 'Доступ открыт' : 'Доступ закрыт'));
    act('#aDel', async () => { if (!await confirmBox(`Удалить ${p.display_name} и все его данные? Это не отменить`)) return; const r = await callFn('admin', { action: 'delete_student', user_id: id }, true); if (!r.ok) return toast(r.message || 'Не получилось'); closePage(); toast('Удалено'); state.app.reload(); });
  }, { title: p.display_name });

  async function drawShots(body) {
    const el = body.querySelector('#cShots'), shots = D.screenshots.filter((x) => !x.deleted_at);
    if (!shots.length) { el.innerHTML = '<p class="dim">Скриншотов пока нет</p>'; return; }
    const { data } = await sb.storage.from('screenshots').createSignedUrls(shots.map((x) => x.storage_path), 3600);
    const urls = Object.fromEntries((data || []).map((r) => [r.path, r.signedUrl]));
    el.innerHTML = D.checkpoints.filter((c) => shots.some((x) => x.checkpoint_id === c.id)).map((c) => `<div class="stack-s" style="margin-bottom:16px"><span class="dim cap">${c.idx === 0 ? 'Точка А' : 'Замер ' + c.idx}</span>
      <div class="gal">${shots.filter((x) => x.checkpoint_id === c.id).map((x) => `<button class="shot" data-big="${esc(urls[x.storage_path] || '')}"><img src="${esc(urls[x.storage_path] || '')}" alt="" loading="lazy"><span class="tag"><span class="plate"><span class="onlime">${esc((SCREEN_KINDS.find((k) => k[0] === x.kind) || [0, 'Другое'])[1])}</span></span></span></button>`).join('')}</div></div>`).join('');
    el.onclick = (e) => { const b = e.target.closest('[data-big]'); if (b) openSheet(`<img src="${esc(b.dataset.big)}" alt="" style="width:100%;border-radius:36px">`); };
  }
}

// Форма пункта программы. preset: значения по умолчанию; after: что сделать после сохранения
export function itemForm(preset, after, existing) {
  const e = existing || {};
  const students = A.profiles.map((p) => [p.id, p.display_name]);
  const init = { kind: 'lesson', week: 1, ord: 0, required: true, has_notes: false, xp: 10, tariffs: ['barbermax', 'personal'], tags: [], active: true, user_id: '', ...preset, ...e };
  if (!init.user_id) init.user_id = '';
  formSheet({
    title: existing ? 'Пункт программы' : 'Новый пункт',
    fields: [
      { k: 'kind', label: 'Тип', type: 'select', options: [['lesson', 'Урок'], ['live', 'Эфир'], ['homework', 'Домашка'], ['short_task', 'Короткое задание'], ['challenge_task', 'Задача челленджа']] },
      { k: 'week', label: 'Неделя', type: 'number', required: true }, { k: 'title', label: 'Название', type: 'text', required: true }, { k: 'description', label: 'Описание', type: 'area' },
      { k: 'est_minutes', label: 'Минуты', type: 'number' }, { k: 'xp', label: 'Опыт (для коротких заданий и задач челленджа)', type: 'number' },
      { k: 'why', label: 'Зачем (короткое задание)', type: 'text' }, { k: 'how', label: 'Как (короткое задание)', type: 'area' }, { k: 'result', label: 'Что считать результатом', type: 'text' },
      { k: 'required', label: 'Обязательный пункт недели', type: 'check' }, { k: 'has_notes', label: 'Можно отметить конспект', type: 'check' },
      { k: 'tags', label: 'Метки ситуации и код челленджа', type: 'tags', hint: 'Для задач Быстрой записи: quick_booking' },
      { k: 'tariffs', label: 'Тарифы', type: 'checks', options: A.tariffs.map((t) => [t.code, t.name]) },
      { k: 'user_id', label: 'Только для ученика', type: 'select', options: [['', 'Для всех'], ...students] },
      { k: 'active', label: 'Показывать ученикам', type: 'check' },
    ],
    initial: init, saveLabel: existing ? 'Сохранить' : 'Добавить',
    onSave: async (v) => {
      const row = { kind: v.kind, week: Number(v.week), title: v.title, description: v.description || null, est_minutes: v.est_minutes, xp: v.xp ?? 10, why: v.why || null, how: v.how || null, result: v.result || null,
        required: !!v.required, has_notes: !!v.has_notes, tags: v.tags || [], tariffs: v.tariffs || [], user_id: v.user_id || null, active: !!v.active, updated_at: new Date().toISOString() };
      if (!existing) { const same = A.items.filter((i) => i.week === row.week && !i.deleted_at); row.ord = same.length ? Math.max(...same.map((i) => i.ord)) + 1 : 1; }
      await dbOk(existing ? sb.from('program_items').update(row).eq('id', existing.id) : sb.from('program_items').insert(row));
      toast(existing ? 'Сохранено' : 'Добавлено'); after && after();
    },
    danger: existing ? { label: 'В корзину', confirm: 'Убрать пункт? Его можно вернуть из корзины', run: async () => { await dbOk(sb.from('program_items').update({ deleted_at: new Date().toISOString() }).eq('id', existing.id)); toast('Убрано'); after && after(); } } : null,
  });
}
