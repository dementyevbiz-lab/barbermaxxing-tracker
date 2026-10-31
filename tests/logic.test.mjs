// Запуск: node tests/logic.test.mjs
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';

const today = new Date(2026, 9, 31); // 31 октября 2026
const d = (n) => L.ymd(L.addDays(today, n));
const tariff = { code: 'barbermax', weeks: 7, name: 'Барбермаксер' };
const metrics = [
  { key: 'avg_check', name: 'Средний чек', better: 'up', active: true },
  { key: 'work_days', name: 'Рабочих дней', better: 'down', active: true },
  { key: 'top_views_avg', name: 'Просмотры', better: 'up', active: true },
];
const base = () => ({
  profile: { id: 'u1', start_date: d(-24), tariff }, // неделя 4
  settings: {}, metrics, goals: {
    avg_check: { a: 1500, b: 2500 }, work_days: { a: 6, b: 5 }, top_views_avg: { a: 400, b: 3000 } },
  items: [
    { id: 'l1', week: 1, ord: 1, kind: 'lesson', required: true, active: true, tariffs: ['barbermax'], est_minutes: 30 },
    { id: 'h1', week: 3, ord: 1, kind: 'homework', required: true, active: true, tariffs: ['barbermax'] },
    { id: 'l4', week: 4, ord: 1, kind: 'lesson', required: true, active: true, tariffs: ['barbermax'] },
    { id: 's1', week: 2, ord: 1, kind: 'short_task', required: false, active: true, tariffs: ['barbermax'], tags: ['no_actions_3d'], xp: 20 },
    { id: 'x1', week: 1, ord: 9, kind: 'lesson', required: true, active: true, tariffs: ['personal'] },
  ],
  completions: [], videos: [], checkpoints: [], cpValues: {}, calls: [], insights: [], questions: [],
  triggers: [], triggerLog: [], quotes: [], quoteShown: [], movies: [],
});

// уровни: 2-й 100, 3-й 300, 4-й 600, 5-й 1000
assert.equal(L.levelOf(0), 1); assert.equal(L.levelOf(99), 1); assert.equal(L.levelOf(100), 2);
assert.equal(L.levelOf(300), 3); assert.equal(L.levelOf(1000), 5);
assert.equal(L.rankOf(1), 'Новичок'); assert.equal(L.rankOf(4), 'Подмастерье'); assert.equal(L.rankOf(50), 'Барбермаксер');

// опыт за пункты как на сервере
assert.equal(L.itemXp({ kind: 'lesson', est_minutes: 30 }), 10);
assert.equal(L.itemXp({ kind: 'lesson', est_minutes: 200 }), 30);
assert.equal(L.itemXp({ kind: 'live' }), 10);
assert.equal(L.itemXp({ kind: 'homework' }), 30);
assert.equal(L.itemXp({ kind: 'short_task', xp: 20 }), 20);

// недели
let D = base();
let info = L.weekInfo(D.profile, tariff, today);
assert.deepEqual([info.state, info.n], ['active', 4]);
assert.equal(L.weekInfo({ start_date: d(10) }, tariff, today).state, 'before');
assert.equal(L.weekInfo({ start_date: d(-100) }, tariff, today).state, 'finished');
assert.equal(L.weekInfo({}, tariff, today).state, 'nostart');

// пункты чужого тарифа не видны
assert.ok(!L.visibleItems(D).some((i) => i.id === 'x1'));

// состояния недель
assert.equal(L.weekState(D, 1, info), 'none');
assert.equal(L.weekState(D, 5, info), 'future');
D.completions.push({ item_id: 'l1', kind: 'done', completed_at: new Date().toISOString() });
assert.equal(L.weekState(D, 1, info), 'full');
assert.equal(L.weekState(D, 2, info), 'none'); // обязательных нет, видео нет
D.videos.push({ id: 'v1', kind: 'client', logged_on: d(-16) }, { id: 'v2', kind: 'life', logged_on: d(-15) });
assert.equal(L.weekState(D, 2, info), 'full', 'два видео закрывают неделю без обязательных');

// R: до замеров null, потом среднее
assert.equal(L.calcR(D).R, null);
D.checkpoints = [
  { id: 'c0', idx: 0, submitted_at: d(-24) + 'T10:00:00Z', due_date: d(-24) },
  { id: 'c1', idx: 1, submitted_at: d(-10) + 'T10:00:00Z', due_date: d(-11) },
];
D.cpValues = { c0: { avg_check: 1500, work_days: 6, top_views_avg: 400 }, c1: { avg_check: 2000, work_days: 5.5, top_views_avg: 1200 } };
const r = L.calcR(D);
assert.ok(Math.abs(r.rows.find((x) => x.key === 'avg_check').progress - 0.5) < 1e-9);
assert.ok(Math.abs(r.rows.find((x) => x.key === 'work_days').progress - 0.5) < 1e-9, 'меньше лучше');
assert.ok(Math.abs(r.R - (0.5 + 0.5 + (800 / 2600)) / 3) < 1e-9);
// откат метрики показывается как 0
D.cpValues.c1.avg_check = 1000;
assert.equal(L.calcR(D).rows.find((x) => x.key === 'avg_check').progress, 0);
D.cpValues.c1.avg_check = 2000;

// P не меньше R и не больше 1
const P = L.calcP(D, r.R, info);
assert.ok(P >= r.R && P <= 1);
assert.equal(L.calcP(D, 1, info), 1);
// пустая программа: P считается и растёт от видео
const E = base(); E.items = [];
const P0 = L.calcP(E, null, info, []); E.videos = [{ kind: 'client', logged_on: d(-3) }, { kind: 'client', logged_on: d(-2) }, { kind: 'client', logged_on: d(-1) }];
assert.ok(L.calcP(E, null, info, []) > P0);

// замер: открывается за 2 дня до срока
D.checkpoints.push({ id: 'c2', idx: 2, submitted_at: null, due_date: d(2) });
assert.equal(L.nextCheckpoint(D, today).left, 2);
D.checkpoints[2].due_date = d(3);
assert.equal(L.nextCheckpoint(D, today), null);
D.checkpoints[2].due_date = d(-1);
assert.equal(L.nextCheckpoint(D, today).overdue, true);

// триггеры
D.triggers = ['no_actions_3d', 'homework_overdue', 'no_checkpoint', 'metric_dropped', 'metric_flat', 'video_zero_direction', 'insights_none', 'lessons_skipped', 'stuck_lesson'].map((code) => ({ code, active: true, params: {}, question_text: 'Вопрос ' + code }));
let fired = L.evaluateTriggers(D, today).map((f) => f.code);
assert.ok(fired.includes('homework_overdue'), 'домашка недели 3 не отмечена');
assert.ok(fired.includes('no_checkpoint'), 'срок замера прошёл');
assert.ok(fired.includes('video_zero_direction'));
assert.ok(fired.includes('insights_none'));
D.cpValues.c1.avg_check = 1500; // было 1500 → стало 1500: не менялась
assert.ok(L.evaluateTriggers(D, today).some((f) => f.code === 'metric_flat' && f.metric.key === 'avg_check'));
D.cpValues.c1.avg_check = 1000;
assert.ok(L.evaluateTriggers(D, today).some((f) => f.code === 'metric_dropped' && f.metric.key === 'avg_check'));
D.cpValues.c1.avg_check = 2000;
D.completions.push({ item_id: 'h1', kind: 'done', completed_at: new Date().toISOString() });
assert.ok(!L.evaluateTriggers(D, today).some((f) => f.code === 'homework_overdue'));

// показ вопроса: один в день, молчание 7 и 14 дней
fired = L.evaluateTriggers(D, today);
let pick = L.pickSuggestion(D, fired, today);
assert.ok(pick && !pick.reuse);
D.triggerLog = [{ trigger_code: pick.trigger.code, shown_at: today.toISOString(), dismissed_at: null }];
assert.equal(L.pickSuggestion(D, fired, today).reuse, true, 'в тот же день тот же вопрос');
D.triggerLog[0].dismissed_at = today.toISOString();
assert.equal(L.pickSuggestion(D, fired, today), null, 'скрыт: больше сегодня ничего');
const tomorrow = L.addDays(today, 1);
const next = L.pickSuggestion(D, fired, tomorrow);
assert.ok(!next || next.trigger.code !== pick.trigger.code, 'скрытый молчит 14 дней');
D.triggerLog = [{ trigger_code: pick.trigger.code, shown_at: L.addDays(today, -8).toISOString(), dismissed_at: null }];
assert.equal(L.pickSuggestion(D, fired, today).trigger.code, pick.trigger.code, 'через 7+ дней можно снова');

// цитаты: непоказанная, потом по кругу
D.quotes = [{ id: 'q2', text: 'б', verified: true, tags: [] }, { id: 'q1', text: 'а', verified: true, tags: ['no_actions_3d'] }, { id: 'q3', text: 'в', verified: false, tags: [] }];
let q = L.pickQuote(D, ['no_actions_3d'], today);
assert.equal(q.quote.id, 'q1'); assert.equal(q.action, 'insert');
D.quoteShown = [{ quote_id: 'q1', shown_on: d(0) }];
q = L.pickQuote(D, [], today); assert.equal(q.quote.id, 'q1'); assert.equal(q.action, null, 'в тот же день та же');
D.quoteShown = [{ quote_id: 'q1', shown_on: d(-1) }, { quote_id: 'q2', shown_on: d(-2) }];
q = L.pickQuote(D, [], today); assert.equal(q.quote.id, 'q2'); assert.equal(q.action, 'update', 'проверенные кончились: самая давняя');
D.quotes = []; assert.equal(L.pickQuote(D, [], today), null);

// короткое задание и фильм
assert.equal(L.pickShortTask(D, info, ['no_actions_3d']).id, 's1');
D.completions.push({ item_id: 's1', kind: 'done', completed_at: new Date().toISOString() });
assert.equal(L.pickShortTask(D, info, []), null);
D.movies = [{ title: 'Б', verified: true, tags: ['x'] }, { title: 'А', verified: false, tags: ['x'] }];
assert.equal(L.pickMovie(D, ['x']).movie.title, 'Б'); assert.equal(L.pickMovie(D, ['x']).byTag, true);
assert.equal(L.pickMovie(D, ['y']).byTag, false, 'без совпадения метки фильм недели'); assert.equal(L.pickMovie(D, ['y']).movie.title, 'Б');
D.settings.movies_fallback = false; assert.equal(L.pickMovie(D, ['y']), null, 'запасной показ выключается'); delete D.settings.movies_fallback;

// прогресс по ачивкам
D.achievements = [
  { code: 'first_video', name: 'Видео', counter: 'videos', tiers: [{ tier: 1, threshold: 1, xp: 10 }, { tier: 2, threshold: 5, xp: 20 }], secret: false },
  { code: 'checkpoints', name: 'Замеры', counter: 'checkpoints_ontime', tiers: [{ tier: 1, threshold: 1, xp: 10 }, { tier: 2, threshold: null, xp: 20 }], secret: false },
  { code: 'lessons', name: 'Уроки', counter: 'lessons', tiers: [{ tier: 1, threshold: 3, xp: 10 }], secret: false },
];
D.userAch = [{ code: 'first_video', tier: 1, revoked_at: null }];
let ap = L.achievementProgress(D);
const byCode = Object.fromEntries(ap.map((x) => [x.a.code, x]));
assert.equal(byCode.first_video.value, 2, 'видео в данных: 2'); assert.equal(byCode.first_video.next.tier, 2); assert.equal(byCode.first_video.thr, 5); assert.equal(byCode.first_video.top, 1);
assert.equal(byCode.checkpoints.thr, 1, 'замеры вовремя: первая ступень 1');
assert.equal(byCode.lessons.thr, 3); assert.equal(byCode.lessons.ratio, byCode.lessons.value / 3);
D.userAch.push({ code: 'first_video', tier: 2, revoked_at: null }); assert.equal(L.achievementProgress(D).find((x) => x.a.code === 'first_video').complete, true, 'все ступени пройдены');

// сопоставление видео и замеров
const vc = L.videoComparison(D);
assert.deepEqual(vc.views, [400, 1200]);

// ачивки открываются по очереди: сначала три, за каждую полученную ещё одна
D.achievements = ['a', 'b', 'c', 'd', 'e', 'f'].map((k, i) => ({ code: k, name: k, counter: 'insights', ord: i + 1, secret: false, tiers: [{ tier: 1, threshold: 1000 + i, xp: 10 }] }));
D.userAch = []; let av = L.achievementView(D);
assert.equal(av.open.length, 3, 'сначала открыто три'); assert.equal(av.locked, 3);
D.userAch = [{ code: 'a', tier: 1, revoked_at: null }]; av = L.achievementView(D);
assert.equal(av.open.length, 4, 'за полученную открывается ещё одна');
// ачивка челленджа без задач скрыта
D.achievements.push({ code: 'qb', name: 'qb', counter: 'challenge:quick_booking', ord: 0, secret: false, tiers: [{ tier: 1, threshold: 1, xp: 10 }] });
assert.ok(!L.achievementView(D).open.some((x) => x.a.code === 'qb'), 'ачивка челленджа скрыта, пока нет задач');

console.log('logic.test: все проверки пройдены');
