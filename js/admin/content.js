// Админка: контент и настройки. Цитаты, фильмы, триггеры, ачивки, звания, метрики, челленджи, тарифы, механика, бэкап
import { $, esc, sb, state, openSheet, closeSheet, toast } from '../core.js';
import * as L from '../logic.js';
import * as data from '../data.js';
import { openPage, closePage } from '../ui.js';
import { A, formSheet, dbOk, csvParse } from './common.js';

const reload = () => state.app.reload();
const saveSetting = async (key, value) => { await dbOk(sb.from('settings').upsert({ key, value }, { onConflict: 'key' })); toast('Сохранено'); await state.app.reload(); };
const jsonField = (v) => JSON.stringify(v, null, 1);
const parseJson = (s, what) => { try { return JSON.parse(s); } catch (e) { throw new Error(`${what}: неверный JSON`); } };
const COUNTERS = [['videos', 'Видео снято'], ['videos_each_dir', 'Видео в каждом направлении'], ['lessons', 'Уроков отмечено'], ['homework', 'Домашек отмечено'], ['notes', 'Конспектов'], ['checkpoints_ontime', 'Замеров вовремя'], ['insights', 'Выводов'], ['questions_asked', 'Вопросов задано'], ['challenge:quick_booking', 'Задач Быстрой записи']];

export function renderContent(root) {
  const sections = [
    ['quotes', 'Цитаты', `${A.quotes.filter((q) => q.verified).length} проверенных из ${A.quotes.length}`, quotes],
    ['movies', 'Фильмы', `${A.movies.filter((q) => q.verified).length} проверенных из ${A.movies.length}`, movies],
    ['triggers', 'Вопросы по триггерам', `${A.triggers.filter((t) => t.active).length} включено`, triggers],
    ['ach', 'Ачивки', `${A.achievements.length}`, achievements],
    ['ranks', 'Звания и уровни', `${(A.settings.ranks || []).length} званий`, ranks],
    ['metrics', 'Метрики', `${A.metrics.filter((m) => m.active).length} активных`, metrics],
    ['ch', 'Челленджи', A.challenges.map((c) => c.title + (c.active ? ' (вкл)' : ' (выкл)')).join(', ') || 'нет', challenges],
    ['tariffs', 'Тарифы', A.tariffs.map((t) => t.name).join(', '), tariffs],
    ['mech', 'Механика и тексты', 'опыт, перспектива, пороги сводки, ссылка на чат', mechanics],
    ['bot', 'Бот', 'подключить ответы бота кнопкой «Открыть»', botSetup],
    ['backup', 'Бэкап', 'выгрузить все данные одним файлом', backup],
  ];
  root.innerHTML = `<div class="stack"><div class="pagehead"><h1 class="h1s grow"><span class="ink">Контент</span></h1></div>
    <div class="stack-s">${sections.map(([k, t, sub]) => `<button class="opt" data-s="${k}"><span class="grow"><span class="ink">${t}</span><span class="cap dim">${esc(sub)}</span></span></button>`).join('')}</div></div>`;
  root.addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (b) sections.find((s) => s[0] === b.dataset.s)[3](); });
}

// ---------- общий список в странице ----------
function listPage(title, rows, { add, edit, importer, note, verifyAll }) {
  openPage(`<div class="btns">${add ? '<button class="btn pri" id="lAdd"><span class="onlime">Добавить</span></button>' : ''}${importer ? '<button class="btn" id="lImp"><span class="ink">Импорт</span></button>' : ''}${verifyAll ? '<button class="btn" id="lVer"><span class="ink">Отметить все проверенными</span></button>' : ''}</div>${note ? `<p class="dim cap">${note}</p>` : ''}
    <div class="stack-s">${rows.map((r) => `<button class="note-card" data-r="${esc(r.id)}"><span class="body ink">${esc(r.title)}</span><span class="dim cap">${esc(r.sub || '')}</span></button>`).join('') || '<p class="dim empty-note">Пока пусто</p>'}</div>`,
  (body) => {
    if (add) body.querySelector('#lAdd').onclick = add;
    if (importer) body.querySelector('#lImp').onclick = importer;
    if (verifyAll) body.querySelector('#lVer').onclick = async () => { if (!window.confirm('Отметить все как проверенные? Ученики сразу их увидят')) return; await verifyAll(); toast('Готово'); await state.app.reload(); closePage(); };
    body.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => edit(b.dataset.r));
  }, { title });
}
async function afterSave(reopen) { await state.app.reload(); reopen(); }

function importGeneric(title, hint, mapRow, table, reopen) {
  openSheet(`<h2 class="sh-title"><span class="ink">${esc(title)}</span></h2><p class="dim cap">${hint}</p><textarea class="field area" id="gText" style="min-height:160px"></textarea><input type="file" id="gFile" accept=".json,.csv,.txt" class="field" style="padding-top:14px">
    <button class="btn pri wide" id="gGo"><span class="onlime">Загрузить</span></button><p class="dim cap" id="gMsg"></p>`, (sh) => {
    const ta = sh.querySelector('#gText'), msg = sh.querySelector('#gMsg');
    sh.querySelector('#gFile').onchange = async (e) => { const f = e.target.files[0]; if (f) ta.value = await f.text(); };
    sh.querySelector('#gGo').onclick = async () => {
      try {
        const t = ta.value.trim(); let rows;
        if (t.startsWith('[')) rows = JSON.parse(t); else { const c = csvParse(t), h = c[0].map((x) => x.trim().toLowerCase()); rows = c.slice(1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]?.trim()]))); }
        const out = rows.map(mapRow); if (!out.length) throw new Error('Пусто');
        await dbOk(sb.from(table).insert(out)); closeSheet(); toast(`Загружено: ${out.length}`); await afterSave(reopen);
      } catch (e) { msg.textContent = 'Ошибка: ' + e.message; }
    };
  });
}
const tagList = (v) => Array.isArray(v) ? v : String(v || '').split(/[|;,\s]+/).map((x) => x.trim()).filter(Boolean);
const yes = (v) => v === true || ['true', '1', 'да', 'yes'].includes(String(v).toLowerCase());

// ---------- цитаты ----------
function quotes() {
  const open = () => listPage('Цитаты', A.quotes.map((q) => ({ id: q.id, title: q.text, sub: `${q.author}${q.source ? ', ' + q.source : ''} · ${q.verified ? 'проверена' : 'не проверена, ученикам не показывается'}` })), {
    add: () => quoteForm(), edit: (id) => quoteForm(A.quotes.find((q) => q.id === id)),
    importer: () => importGeneric('Импорт цитат', 'JSON-список или CSV с колонками text, author, source, tags, verified. Показываются только проверенные', (r) => ({ text: r.text, author: r.author, source: r.source || null, tags: tagList(r.tags), verified: yes(r.verified) }), 'quotes', open),
    note: 'До 200 знаков, с автором и проверяемым источником. Ученикам показываются только проверенные. Черновики из подборки не проверены: сверьте источник и отметьте',
    verifyAll: async () => { await dbOk(sb.from('quotes').update({ verified: true }).eq('verified', false)); },
  });
  const quoteForm = (q) => formSheet({ title: q ? 'Цитата' : 'Новая цитата', fields: [{ k: 'text', label: 'Текст', type: 'area', max: 200, required: true }, { k: 'author', label: 'Автор', type: 'text', required: true }, { k: 'source', label: 'Источник', type: 'text' }, { k: 'tags', label: 'Метки ситуации', type: 'tags' }, { k: 'verified', label: 'Проверена', type: 'check' }],
    initial: q || { verified: false, tags: [] }, onSave: async (v) => { const row = { text: v.text, author: v.author, source: v.source || null, tags: v.tags, verified: !!v.verified }; await dbOk(q ? sb.from('quotes').update(row).eq('id', q.id) : sb.from('quotes').insert(row)); await afterSave(open); },
    danger: q ? { label: 'Удалить', confirm: 'Удалить цитату?', run: async () => { await dbOk(sb.from('quotes').delete().eq('id', q.id)); await afterSave(open); } } : null });
  open();
}
// ---------- фильмы ----------
function movies() {
  const open = () => listPage('Фильмы', A.movies.map((m) => ({ id: m.id, title: `${m.kind === 'book' ? 'Книга: ' : ''}${m.title}${m.author ? ', ' + m.author : ''}${m.year ? ', ' + m.year : ''}`, sub: `${m.why} · метки: ${(m.tags || []).join(', ') || 'нет'} · ${m.verified ? 'проверен' : 'не проверен'}` })), {
    add: () => form(), edit: (id) => form(A.movies.find((m) => m.id === id)),
    importer: () => importGeneric('Импорт фильмов', 'JSON-список или CSV с колонками title, year, why, tags, verified', (r) => ({ kind: r.kind === 'book' ? 'book' : 'film', author: r.author || null, title: r.title, year: Number(r.year) || null, why: r.why, tags: tagList(r.tags), verified: yes(r.verified) }), 'movies', open),
    note: 'Показываются в «Следующем шаге» только при совпадении метки ситуации. Метки это коды триггеров, например no_checkpoint или metric_flat. Тексты «почему подходит» черновые: утвердите их',
    verifyAll: async () => { await dbOk(sb.from('movies').update({ verified: true }).eq('verified', false)); },
  });
  const form = (m) => formSheet({ title: m ? 'Фильм' : 'Новый фильм', fields: [{ k: 'kind', label: 'Что это', type: 'select', options: [['film', 'Фильм'], ['book', 'Книга']] }, { k: 'title', label: 'Название', type: 'text', required: true }, { k: 'author', label: 'Автор (для книги)', type: 'text' }, { k: 'year', label: 'Год', type: 'number' }, { k: 'why', label: 'Почему подходит барберу и в какой ситуации', type: 'area', required: true }, { k: 'tags', label: 'Метки ситуации', type: 'tags' }, { k: 'verified', label: 'Проверен', type: 'check' }],
    initial: m || { tags: [], kind: 'film' }, onSave: async (v) => { const row = { kind: v.kind, author: v.author || null, title: v.title, year: v.year, why: v.why, tags: v.tags, verified: !!v.verified }; await dbOk(m ? sb.from('movies').update(row).eq('id', m.id) : sb.from('movies').insert(row)); await afterSave(open); },
    danger: m ? { label: 'Удалить', confirm: 'Удалить фильм?', run: async () => { await dbOk(sb.from('movies').delete().eq('id', m.id)); await afterSave(open); } } : null });
  open();
}
// ---------- триггеры ----------
function triggers() {
  const open = () => listPage('Вопросы по триггерам', A.triggers.map((t) => ({ id: t.code, title: t.title, sub: `${t.active ? 'включён' : 'выключен'} · ${t.question_text}` })), {
    edit: (code) => { const t = A.triggers.find((x) => x.code === code);
      formSheet({ title: t.title, fields: [{ k: 'question_text', label: 'Текст вопроса', type: 'area', required: true }, { k: 'params', label: 'Пороги (JSON)', type: 'area' }, { k: 'active', label: 'Включён', type: 'check' }], initial: { ...t, params: jsonField(t.params) },
        onSave: async (v) => { await dbOk(sb.from('triggers').update({ question_text: v.question_text, params: parseJson(v.params || '{}', 'Пороги'), active: !!v.active }).eq('code', code)); await afterSave(open); } }); },
    note: 'В день не больше одного вопроса. После показа триггер молчит 7 дней, после «Скрыть» 14. Вопрос не должен звучать как упрёк' });
  open();
}
// ---------- ачивки ----------
function achievements() {
  const open = () => listPage('Ачивки', A.achievements.map((a) => ({ id: a.code, title: a.name + (a.secret ? ' (секретная)' : ''), sub: `${a.counter} · ступени: ${a.tiers.map((t) => (t.threshold ?? 'все') + ' → ' + t.xp).join(', ')}` })), {
    add: () => form(), edit: (code) => form(A.achievements.find((a) => a.code === code)),
    note: 'Ступень: порог (null значит «все») и опыт за неё. Выдаются и снимаются сами. Секретные видны ученику только после получения' });
  const form = (a) => formSheet({ title: a ? a.name : 'Новая ачивка', fields: [
      ...(a ? [] : [{ k: 'code', label: 'Код (латиницей)', type: 'text', required: true }]), { k: 'name', label: 'Название', type: 'text', required: true }, { k: 'description', label: 'Описание', type: 'text' },
      ...(a ? [] : [{ k: 'counter', label: 'Счётчик', type: 'select', options: COUNTERS }]), { k: 'tiers', label: 'Ступени (JSON)', type: 'area' }, { k: 'secret', label: 'Секретная', type: 'check' }],
    initial: a ? { ...a, tiers: jsonField(a.tiers) } : { tiers: jsonField([{ tier: 1, threshold: 1, xp: 10 }, { tier: 2, threshold: 5, xp: 20 }, { tier: 3, threshold: 10, xp: 40 }, { tier: 4, threshold: 20, xp: 80 }]), counter: 'videos' },
    onSave: async (v) => { const row = { name: v.name, description: v.description || null, tiers: parseJson(v.tiers, 'Ступени'), secret: !!v.secret }; if (!a) { row.code = v.code; row.counter = v.counter; } await dbOk(a ? sb.from('achievements').update(row).eq('code', a.code) : sb.from('achievements').insert(row)); await afterSave(open); },
    danger: a ? { label: 'Удалить', confirm: 'Удалить ачивку у всех?', run: async () => { await dbOk(sb.from('achievements').delete().eq('code', a.code)); await afterSave(open); } } : null });
  open();
}
// ---------- звания ----------
function ranks() {
  const rk = A.settings.ranks || L.DEFAULT_RANKS;
  formSheet({ title: 'Звания и уровни', fields: [{ k: 'step', label: 'Шаг уровня', type: 'number', hint: 'Опыт для уровня L: шаг × (L − 1) × L. При шаге 50: 100, 300, 600, 1000' }, { k: 'ranks', label: 'Звания: по строке «уровень название»', type: 'area' }],
    initial: { step: A.settings.level_step ?? 50, ranks: rk.map((r) => `${r.level} ${r.name}`).join('\n') },
    onSave: async (v) => { const list = v.ranks.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const m = l.match(/^(\d+)\s+(.+)$/); if (!m) throw new Error('Строка «' + l + '» не по формату'); return { level: Number(m[1]), name: m[2] }; }); if (!list.length) throw new Error('Нужно хотя бы одно звание');
      await dbOk(sb.from('settings').upsert([{ key: 'level_step', value: Number(v.step) || 50 }, { key: 'ranks', value: list }], { onConflict: 'key' })); toast('Сохранено'); await state.app.reload(); } });
}
// ---------- метрики ----------
function metrics() {
  const open = () => listPage('Метрики', A.metrics.map((m) => ({ id: m.key, title: m.name, sub: `${m.unit} · ${m.better === 'up' ? 'лучше выше' : 'лучше ниже'}${m.active ? '' : ' · выключена'}` })), { add: () => form(), edit: (k) => form(A.metrics.find((m) => m.key === k)), note: 'Подсказки «?» ученик видит рядом с полем. Тексты утверждает заказчик' });
  const form = (m) => formSheet({ title: m ? m.name : 'Новая метрика', fields: [...(m ? [] : [{ k: 'key', label: 'Код (латиницей)', type: 'text', required: true }]), { k: 'name', label: 'Название', type: 'text', required: true }, { k: 'unit', label: 'Единица', type: 'text', required: true },
      { k: 'better', label: 'Что лучше', type: 'select', options: [['up', 'Выше'], ['down', 'Ниже']] }, { k: 'hint', label: 'Подсказка «?»', type: 'area' }, { k: 'ord', label: 'Порядок', type: 'number' }, { k: 'active', label: 'Включена', type: 'check' }],
    initial: m || { better: 'up', active: true, ord: A.metrics.length + 1 },
    onSave: async (v) => { const row = { name: v.name, unit: v.unit, better: v.better, hint: v.hint || null, ord: v.ord ?? 0, active: !!v.active }; if (!m) row.key = v.key; await dbOk(m ? sb.from('metrics').update(row).eq('key', m.key) : sb.from('metrics').insert(row)); await afterSave(open); } });
  open();
}
// ---------- челленджи ----------
function challenges() {
  const open = () => listPage('Челленджи', A.challenges.map((c) => ({ id: c.id, title: c.title, sub: `с недели ${c.start_week}${c.end_week ? ' по ' + c.end_week : ''} · награда: ${c.reward_text || 'нет'} · ${c.active ? 'включён' : 'выключен'} · задач: ${A.items.filter((i) => i.kind === 'challenge_task' && !i.deleted_at && (i.tags || []).includes(c.code)).length}` })), {
    edit: (id) => { const c = A.challenges.find((x) => x.id === id);
      formSheet({ title: c.title, fields: [{ k: 'title', label: 'Название', type: 'text', required: true }, { k: 'rules', label: 'Правила для учеников', type: 'area' }, { k: 'start_week', label: 'Со недели', type: 'number', required: true }, { k: 'end_week', label: 'По неделю', type: 'number' }, { k: 'reward_text', label: 'Награда', type: 'text' }, { k: 'completion_xp', label: 'Опыт за прохождение', type: 'number' }, { k: 'active', label: 'Включён', type: 'check', hint: 'Блок появится у учеников, только если есть задачи с меткой ' + c.code }], initial: c,
        onSave: async (v) => { await dbOk(sb.from('challenges').update({ rules: v.rules || null, title: v.title, start_week: v.start_week, end_week: v.end_week, reward_text: v.reward_text || null, completion_xp: v.completion_xp ?? 0, active: !!v.active }).eq('id', id)); await afterSave(open); } }); },
    note: 'Задачи челленджа добавляются в разделе Программа: тип «Задача челленджа», метка с кодом челленджа' });
  open();
}
// ---------- тарифы ----------
function tariffs() {
  const open = () => listPage('Тарифы', A.tariffs.map((t) => ({ id: String(t.id), title: t.name, sub: `${t.weeks} нед. · замеры на неделях ${t.checkpoint_weeks.join(', ')} · созвонов ${t.calls_included}, стратегий ${t.strategy_sessions}+${t.city_strategy_sessions}${t.support ? ' · поддержка' : ''}` })), {
    edit: (id) => { const t = A.tariffs.find((x) => String(x.id) === id);
      formSheet({ title: t.name, fields: [{ k: 'name', label: 'Название', type: 'text', required: true }, { k: 'weeks', label: 'Недель', type: 'number', required: true }, { k: 'checkpoint_weeks', label: 'Недели замеров через запятую', type: 'tags', hint: '0 это точка А, последняя неделя итоговый замер' }, { k: 'calls_included', label: 'Созвонов', type: 'number' }, { k: 'strategy_sessions', label: 'Стратегических сессий', type: 'number' }, { k: 'city_strategy_sessions', label: 'Стратегий под город', type: 'number' }, { k: 'support', label: 'Поддержка', type: 'check' }, { k: 'features', label: 'Блоки (JSON)', type: 'area' }],
        initial: { ...t, checkpoint_weeks: t.checkpoint_weeks.map(String), features: jsonField(t.features) },
        onSave: async (v) => { const cw = v.checkpoint_weeks.map(Number); if (cw.some((n) => !Number.isInteger(n) || n < 0)) throw new Error('Недели замеров: целые числа'); await dbOk(sb.from('tariffs').update({ name: v.name, weeks: v.weeks, checkpoint_weeks: cw, calls_included: v.calls_included ?? 0, strategy_sessions: v.strategy_sessions ?? 0, city_strategy_sessions: v.city_strategy_sessions ?? 0, support: !!v.support, features: parseJson(v.features || '{}', 'Блоки') }).eq('id', t.id)); await afterSave(open); } }); },
    note: 'При смене замеров расписание неотправленных замеров пересчитается при следующем изменении ученика' });
  open();
}
// ---------- механика ----------
function mechanics() {
  const xp = A.settings.xp || {}, S = A.settings;
  openPage(`<div class="stack-s">${[
    ['xp', 'Опыт за действия', 'уроки, домашки, видео, замеры'], ['perspective', 'Перспектива', 'коэффициент и веса'], ['rules', 'Пороги сводки и триггеров', 'сколько считать отставанием'],
    ['support', 'Чат поддержки', S.support_chat_url || 'ссылка не задана'], ['texts', 'Тексты', 'согласие и инструкция по скриншотам'], ['tiers', 'Названия ступеней ачивок', (S.tier_names || []).join(', ')], ['misc', 'Прочее', 'форма замера, скриншоты, бот']].map(([k, t, s]) => `<button class="opt" data-m="${k}"><span class="grow"><span class="ink">${t}</span><span class="cap dim">${esc(s)}</span></span></button>`).join('')}</div>`,
  (body) => body.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => ({
    xp: () => formSheet({ title: 'Опыт за действия', fields: [['lesson_per_minutes', 'Минут урока на 1 опыт'], ['lesson_max', 'Урок: максимум'], ['lesson_default', 'Урок без длительности'], ['homework', 'Домашка'], ['notes', 'Конспект'], ['video', 'Видео'], ['video_daily_max', 'Видео в день с опытом'], ['checkpoint', 'Замер'], ['screenshots_bonus', 'Бонус за скриншоты'], ['screenshots_min', 'Скриншотов для бонуса'], ['insight', 'Вывод'], ['insight_daily_max', 'Выводов в день с опытом']].map(([k, l]) => ({ k, label: l, type: 'number' })), initial: xp, onSave: (v) => saveSetting('xp', { ...xp, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x != null)) }) }),
    perspective: () => formSheet({ title: 'Перспектива', fields: [{ k: 'k', label: 'Коэффициент k', type: 'number' }, { k: 'weights', label: 'Веса (JSON)', type: 'area' }, { k: 'videos_per_week', label: 'Видео в неделю по плану', type: 'number' }], initial: { ...S.perspective, weights: jsonField(S.perspective?.weights || {}) }, onSave: (v) => saveSetting('perspective', { k: v.k ?? 0.6, weights: parseJson(v.weights, 'Веса'), videos_per_week: v.videos_per_week ?? 2 }) }),
    rules: () => formSheet({ title: 'Пороги', fields: [{ k: 'item_low_share', label: 'Доля, при которой пункт считается «не отмечают» (0–1)', type: 'number' }, { k: 'lagging_share', label: 'Доля обязательного, ниже которой ученик отстаёт (0–1)', type: 'number' }, { k: 'inactive_days', label: 'Дней без входа', type: 'number' }], initial: S.admin_rules || {}, onSave: (v) => saveSetting('admin_rules', { ...S.admin_rules, ...v }) }),
    support: () => formSheet({ title: 'Чат поддержки', fields: [{ k: 'url', label: 'Ссылка', type: 'text', hint: 'Например https://t.me/+... Видят ученики тарифа с поддержкой' }], initial: { url: S.support_chat_url || '' }, onSave: (v) => saveSetting('support_chat_url', v.url) }),
    texts: () => formSheet({ title: 'Тексты', fields: [{ k: 'consent_text', label: 'Согласие (онбординг)', type: 'area' }, { k: 'screenshot_help', label: 'Что скриншотить', type: 'area' }], initial: S, onSave: async (v) => { await dbOk(sb.from('settings').upsert([{ key: 'consent_text', value: v.consent_text }, { key: 'screenshot_help', value: v.screenshot_help }], { onConflict: 'key' })); toast('Сохранено'); await state.app.reload(); } }),
    tiers: () => formSheet({ title: 'Ступени ачивок', fields: [{ k: 'names', label: 'Четыре названия через запятую', type: 'tags' }], initial: { names: S.tier_names || [] }, onSave: (v) => saveSetting('tier_names', v.names) }),
    misc: () => formSheet({ title: 'Прочее', fields: [{ k: 'checkpoint_open_days', label: 'Форма замера открывается за N дней до срока', type: 'number' }, { k: 'week_full_videos', label: 'Видео для «полной» недели без заданий', type: 'number' }, { k: 'triggers_cfg', label: 'Показ вопросов (JSON)', type: 'area' }, { k: 'screenshots_cfg', label: 'Скриншоты (JSON)', type: 'area' }, { k: 'bot_notifications', label: 'Уведомления бота (JSON)', type: 'area' }],
      initial: { checkpoint_open_days: S.checkpoint_open_days ?? 2, week_full_videos: S.week_full_videos ?? 2, triggers_cfg: jsonField(S.triggers_cfg || {}), screenshots_cfg: jsonField(S.screenshots_cfg || {}), bot_notifications: jsonField(S.bot_notifications || {}) },
      onSave: async (v) => { await dbOk(sb.from('settings').upsert([{ key: 'checkpoint_open_days', value: v.checkpoint_open_days ?? 2 }, { key: 'week_full_videos', value: v.week_full_videos ?? 2 }, { key: 'triggers_cfg', value: parseJson(v.triggers_cfg, 'Показ вопросов') }, { key: 'screenshots_cfg', value: parseJson(v.screenshots_cfg, 'Скриншоты') }, { key: 'bot_notifications', value: parseJson(v.bot_notifications, 'Бот') }], { onConflict: 'key' })); toast('Сохранено'); await state.app.reload(); } }),
  })[b.dataset.m]()), { title: 'Механика и тексты' });
}
// ---------- бот ----------
async function botSetup() {
  toast('Подключаем…');
  const { data: s } = await sb.auth.getSession();
  const r = await fetch(`${window.BMX_CONFIG.supabaseUrl}/functions/v1/bot`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: window.BMX_CONFIG.supabaseKey, Authorization: 'Bearer ' + s.session.access_token }, body: JSON.stringify({ action: 'setup' }) });
  const j = await r.json().catch(() => ({}));
  openSheet(`<h2 class="sh-title"><span class="ink">${j.ok ? 'Бот подключён' : 'Не получилось'}</span></h2><p class="dim">${j.ok ? 'Теперь на любое сообщение бот отвечает кнопкой «Открыть»' : esc(j.description || j.message || 'Проверьте, что секреты бота заданы (scripts/setup-bot.sh)')}</p>`);
}
// ---------- бэкап ----------
async function backup() {
  toast('Собираем…');
  const tables = ['tariffs', 'admins', 'profiles', 'metrics', 'goals', 'goal_text', 'checkpoints', 'checkpoint_values', 'screenshots', 'program_items', 'completions', 'video_logs', 'calls', 'xp_ledger', 'settings', 'achievements', 'user_achievements', 'challenges', 'challenge_results', 'quotes', 'quote_shown', 'movies', 'triggers', 'trigger_log', 'admin_notes', 'audit_log'];
  const out = { exported_at: new Date().toISOString(), note: 'Выводы и вопросы учеников в выгрузку не входят: админ их не видит' };
  for (const t of tables) { const r = await sb.from(t).select('*'); out[t] = r.error ? { error: r.error.message } : r.data; }
  await data.saveFile(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }), `barbermaxxing-backup-${L.ymd(new Date())}.json`);
  toast('Бэкап готов');
}
