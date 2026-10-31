// Чистая логика трекера: уровни, недели, результат R, перспектива P, триггеры, подбор цитат.
// Без обращений к странице и сети, поэтому проверяется тестами в node (tests/logic.test.mjs)

// ---------- даты ----------
export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function parseDay(s) {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export const diffDays = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / 86400000);
export const dayOf = (ts) => startOfDay(new Date(ts));

// ---------- уровни и звания ----------
export const levelBase = (L, step = 50) => step * (L - 1) * L;
export function levelOf(xp, step = 50) { let L = 1; while (levelBase(L + 1, step) <= xp) L++; return L; }
export const DEFAULT_RANKS = [
  { level: 1, name: 'Новичок' }, { level: 3, name: 'Подмастерье' }, { level: 5, name: 'Барбер' },
  { level: 7, name: 'Опытный барбер' }, { level: 9, name: 'Профи' }, { level: 12, name: 'Мастер' },
  { level: 15, name: 'Мастер кресла' }, { level: 18, name: 'Эксперт' }, { level: 22, name: 'Бренд' },
  { level: 26, name: 'Лидер мнений' }, { level: 31, name: 'Топ-мастер' }, { level: 40, name: 'Легенда' },
  { level: 50, name: 'Барбермаксер' },
];
export function rankOf(L, ranks = DEFAULT_RANKS) {
  let r = ranks[0]?.name || '';
  for (const x of [...ranks].sort((a, b) => a.level - b.level)) if (L >= x.level) r = x.name;
  return r;
}
export const xpTotal = (ledger) => (ledger || []).reduce((s, r) => s + (r.undone_at ? 0 : r.xp), 0);

// Локальная оценка опыта за пункт, как на сервере (для мгновенного ответа интерфейса)
export function itemXp(it, xp = {}) {
  if (it.kind === 'lesson' || it.kind === 'live') {
    if (!(it.est_minutes > 0)) return xp.lesson_default ?? 10;
    return Math.min(xp.lesson_max ?? 30, Math.round(it.est_minutes / (xp.lesson_per_minutes ?? 3)));
  }
  if (it.kind === 'homework') return xp.homework ?? 30;
  return it.xp || 0; // материал, короткое задание, задача челленджа: опыт задан у пункта
}

// ---------- неделя ученика ----------
// state: before (ещё не стартовал), active, finished
export function weekInfo(profile, tariff, today = startOfDay()) {
  const start = parseDay(profile?.start_date);
  const weeks = tariff?.weeks || 0;
  if (!start || !tariff) return { state: 'nostart', n: 0, weeks, start };
  const days = diffDays(today, start);
  if (days < 0) return { state: 'before', n: 0, weeks, start, daysToStart: -days };
  const raw = Math.floor(days / 7) + 1;
  if (raw > weeks) return { state: 'finished', n: weeks, weeks, start, raw };
  return { state: 'active', n: raw, weeks, start };
}
export const weekStart = (start, w) => addDays(start, (w - 1) * 7);
export const weekEnd = (start, w) => addDays(start, w * 7 - 1);

// ---------- данные ученика ----------
export function visibleItems(D) {
  const code = D.profile?.tariff?.code;
  return (D.items || []).filter((i) => i.active && !i.deleted_at && (!i.user_id || i.user_id === D.profile.id) && (!code || (i.tariffs || []).includes(code)))
    .sort((a, b) => a.week - b.week || a.ord - b.ord);
}
export function doneSets(D) {
  const done = new Set(), notes = new Set();
  for (const c of D.completions || []) {
    if (c.undone_at) continue;
    (c.kind === 'notes' ? notes : done).add(c.item_id);
  }
  return { done, notes };
}
export const liveVideos = (D) => (D.videos || []).filter((v) => !v.undone_at);

export const CORE_KINDS = ['lesson', 'live', 'homework', 'material']; // пункты программы, из которых считается прохождение
const WEIGHTS = { lesson: 1, live: 1, homework: 2, material: 1 };
export const videoWeight = 1, notesWeight = 0.5;

// Состояние недели w: full | partial | none | future
// Текущая неделя ученика: до старта это модуль 0
export const curWeek = (info) => (info.state === 'before' ? 0 : info.state === 'active' || info.state === 'finished' ? info.n : -1);
export function weekTitle(D, w) { return D.settings?.week_titles?.[String(w)] || (w === 0 ? 'Модуль 0. Предобучение' : `Неделя ${w}`); }
export function weekState(D, w, info, items = visibleItems(D)) {
  if (info.state === 'nostart' || w > curWeek(info)) return 'future';
  const { done, notes } = doneSets(D);
  const wk = items.filter((i) => i.week === w);
  const req = wk.filter((i) => i.required && CORE_KINDS.includes(i.kind));
  const from = w === 0 ? new Date(0) : weekStart(info.start, w), to = w === 0 ? addDays(info.start, -1) : weekEnd(info.start, w);
  const vids = liveVideos(D).filter((v) => { const d = parseDay(v.logged_on); return d >= from && d <= to; }).length;
  const any = wk.some((i) => done.has(i.id) || notes.has(i.id)) || vids > 0;
  if (req.length) return req.every((i) => done.has(i.id)) ? 'full' : any ? 'partial' : 'none';
  const need = D.settings?.week_full_videos ?? 2;
  return vids >= need ? 'full' : any ? 'partial' : 'none';
}

// ---------- замеры и метрики ----------
export function submittedCheckpoints(D) {
  return (D.checkpoints || []).filter((c) => c.submitted_at).sort((a, b) => a.idx - b.idx);
}
// Последние значения метрик из отправленных замеров после точки А
export function latestValues(D) {
  const out = {};
  for (const c of submittedCheckpoints(D)) {
    if (c.idx === 0) continue;
    for (const [k, v] of Object.entries(D.cpValues?.[c.id] || {})) if (v != null) out[k] = v;
  }
  return out;
}
export function metricSeries(D, key) {
  const pts = [];
  for (const c of submittedCheckpoints(D)) {
    const v = D.cpValues?.[c.id]?.[key];
    if (v != null) pts.push({ idx: c.idx, date: c.submitted_at, value: Number(v), cp: c });
  }
  return pts;
}

// Реальный результат R: среднее продвижение метрик от А к Б
export function calcR(D) {
  const cur = latestValues(D);
  const rows = [];
  for (const m of (D.metrics || []).filter((x) => x.active)) {
    const g = D.goals?.[m.key];
    if (!g || g.a == null || g.b == null || Number(g.a) === Number(g.b)) continue;
    const now = cur[m.key];
    if (now == null) { rows.push({ key: m.key, a: Number(g.a), b: Number(g.b), cur: null, progress: null }); continue; }
    const p = Math.min(1, Math.max(0, (Number(now) - Number(g.a)) / (Number(g.b) - Number(g.a))));
    rows.push({ key: m.key, a: Number(g.a), b: Number(g.b), cur: Number(now), progress: p });
  }
  const used = rows.filter((r) => r.progress != null);
  if (!used.length) return { R: null, rows };
  return { R: used.reduce((s, r) => s + r.progress, 0) / used.length, rows };
}

// Перспектива P = R + (1 − R)·k·D
export function calcP(D, R, info, items = visibleItems(D)) {
  const cfg = D.settings?.perspective || {};
  const k = cfg.k ?? 0.6, w = { ...WEIGHTS, ...(cfg.weights || {}) };
  const wVideo = w.video ?? videoWeight, wNotes = w.notes ?? notesWeight;
  const n = curWeek(info);
  if (n < 0) return Math.max(R || 0, 0);
  const { done, notes } = doneSets(D);
  let expected = Math.max(0, n - 1) * (cfg.videos_per_week ?? 2) * wVideo, got = 0;
  for (const it of items) {
    if (!CORE_KINDS.includes(it.kind) || it.week > n) continue;
    const wt = w[it.kind] ?? w.lesson ?? 1;
    if (it.required) expected += wt;
    if (it.required && done.has(it.id)) got += wt;
    if (notes.has(it.id)) got += wNotes;
  }
  got += liveVideos(D).length * wVideo;
  const Dn = expected > 0 ? Math.min(1, got / expected) : 0;
  const r = R || 0;
  return Math.min(1, Math.max(r, r + (1 - r) * k * Dn));
}

// ---------- следующий замер и созвон ----------
export function nextCheckpoint(D, today = startOfDay()) {
  const openDays = D.settings?.checkpoint_open_days ?? 2;
  const list = (D.checkpoints || []).filter((c) => !c.submitted_at && c.idx > 0).sort((a, b) => a.idx - b.idx);
  for (const c of list) {
    const left = diffDays(parseDay(c.due_date), today);
    if (left <= openDays) return { cp: c, left, overdue: left < 0 };
  }
  return null;
}
export function nextCall(D, now = new Date()) {
  const upcoming = (D.calls || []).filter((c) => c.scheduled_at && new Date(c.scheduled_at) >= startOfDay(now))
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  return upcoming[0] || null;
}

// ---------- триггеры вопросов ----------
export const TRIGGER_ORDER = ['no_checkpoint', 'homework_overdue', 'stuck_lesson', 'lessons_skipped', 'no_actions_3d', 'metric_dropped',
  'metric_flat', 'video_zero_direction', 'video_views_low', 'notes_none', 'insights_none', 'booking_low', 'price_flat', 'perspective_gap', 'ahead_plan'];
export const VIDEO_KINDS = { client: 'С клиентом', expert: 'Экспертное', life: 'Лайф' };

export function evaluateTriggers(D, today = startOfDay()) {
  const info = weekInfo(D.profile, D.profile?.tariff, today);
  if (info.state !== 'active' && info.state !== 'finished') return [];
  const active = new Set((D.triggers || []).filter((t) => t.active).map((t) => t.code));
  const prm = (code) => (D.triggers || []).find((t) => t.code === code)?.params || {};
  const items = visibleItems(D);
  const { done, notes } = doneSets(D);
  const fired = [];
  const add = (code, ctx = {}) => { if (active.has(code)) fired.push({ code, ...ctx }); };
  const daysSinceStart = diffDays(today, info.start);

  // 1 ничего не отмечено N дней
  const lastTs = [
    ...(D.completions || []).filter((c) => !c.undone_at).map((c) => dayOf(c.completed_at)),
    ...liveVideos(D).map((v) => parseDay(v.logged_on)),
  ].sort((a, b) => b - a)[0];
  const quiet = lastTs ? diffDays(today, lastTs) : daysSinceStart;
  if (daysSinceStart >= (prm('no_actions_3d').days ?? 3) && quiet >= (prm('no_actions_3d').days ?? 3)) add('no_actions_3d');

  // 2 домашка прошлой недели не отмечена
  const hw = items.find((i) => i.kind === 'homework' && i.required && i.week < info.n && !done.has(i.id));
  if (hw && info.state === 'active') add('homework_overdue', { item: hw });

  // 3 два урока подряд не отмечены (из закрытых недель)
  const past = items.filter((i) => ['lesson', 'live', 'material'].includes(i.kind) && i.week < info.n);
  if (past.length >= 2) { const [a, b] = past.slice(-2); if (!done.has(a.id) && !done.has(b.id)) add('lessons_skipped'); }

  // 4 урок открыт и не отмечен 5 дней
  const stuck = items.find((i) => ['lesson', 'live', 'material'].includes(i.kind) && !done.has(i.id) && i.week <= info.n
    && diffDays(today, weekStart(info.start, i.week)) >= (prm('stuck_lesson').days ?? 5));
  if (stuck) add('stuck_lesson', { item: stuck });

  // 5 срок замера прошёл
  const late = (D.checkpoints || []).find((c) => c.idx > 0 && !c.submitted_at && parseDay(c.due_date) < today);
  if (late) add('no_checkpoint');

  // метрики по двум последним замерам
  for (const m of (D.metrics || []).filter((x) => x.active)) {
    const s = metricSeries(D, m.key);
    if (s.length < 2) continue;
    const a = s[s.length - 2].value, b = s[s.length - 1].value;
    const worse = m.better === 'down' ? b > a : b < a;
    if (worse) add('metric_dropped', { metric: m });
    else if (a === b) add('metric_flat', { metric: m });
  }

  // 8 нет видео по направлению за 2 недели
  const days = prm('video_zero_direction').days ?? 14;
  if (daysSinceStart >= days) {
    const recent = liveVideos(D).filter((v) => diffDays(today, parseDay(v.logged_on)) < days);
    const miss = Object.keys(VIDEO_KINDS).find((k) => !recent.some((v) => v.kind === k));
    if (miss) add('video_zero_direction', { direction: miss });
  }

  // 9 после 5 видео просмотры лучших не растут
  const tv = metricSeries(D, 'top_views_avg');
  if (liveVideos(D).length >= (prm('video_views_low').videos ?? 5) && tv.length >= 2 && tv[tv.length - 1].value <= tv[tv.length - 2].value) add('video_views_low');

  // 10 нет конспекта после созвона 2 дня
  const call = (D.calls || []).filter((c) => c.scheduled_at && diffDays(today, dayOf(c.scheduled_at)) >= (prm('notes_none').days ?? 2)
    && diffDays(today, dayOf(c.scheduled_at)) <= 14).sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at))[0];
  if (call && !(D.completions || []).some((c) => !c.undone_at && c.kind === 'notes' && new Date(c.completed_at) >= new Date(call.scheduled_at))) add('notes_none');

  // 11 выводов нет 10 дней
  const lastIns = (D.insights || []).filter((i) => !i.deleted_at).map((i) => dayOf(i.created_at)).sort((a, b) => b - a)[0];
  if ((lastIns ? diffDays(today, lastIns) : daysSinceStart) >= (prm('insights_none').days ?? 10)) add('insights_none');

  // 12 перспектива сильно впереди результата
  const { R } = calcR(D);
  const P = calcP(D, R, info, items);
  if (P - (R || 0) >= (prm('perspective_gap').gap ?? 0.3)) add('perspective_gap');

  // 13 сделано больше плана недели
  const curReq = items.filter((i) => i.week === info.n && i.required && CORE_KINDS.includes(i.kind));
  if (info.state === 'active' && curReq.length && curReq.every((i) => done.has(i.id)) && items.some((i) => i.week > info.n && done.has(i.id))) add('ahead_plan');

  // 14 средний чек не менялся 4 недели
  const ac = metricSeries(D, 'avg_check');
  if (ac.length >= 2) {
    const last = ac[ac.length - 1];
    const base = [...ac].reverse().find((p) => diffDays(parseDay(last.date.slice(0, 10)), parseDay(p.date.slice(0, 10))) >= (prm('price_flat').weeks ?? 4) * 7);
    if (base && base.value === last.value) add('price_flat');
  }

  // 15 заполненность ниже порога два замера подряд
  const bf = metricSeries(D, 'booking_fill');
  const thr = prm('booking_low').threshold ?? 50;
  if (bf.length >= 2 && bf.slice(-2).every((p) => p.value < thr)) add('booking_low');

  return fired.sort((x, y) => TRIGGER_ORDER.indexOf(x.code) - TRIGGER_ORDER.indexOf(y.code));
}

export function triggerText(D, f) {
  const t = (D.triggers || []).find((x) => x.code === f.code);
  let text = t?.question_text || '';
  if (f.direction) text = text.replace('этого направления', 'направления ' + VIDEO_KINDS[f.direction]);
  return text;
}

// Какой вопрос показать сегодня. Возвращает { trigger, text, reuse } или null
export function pickSuggestion(D, fired, today = startOfDay()) {
  const cfg = D.settings?.triggers_cfg || {};
  const showDays = cfg.silence_after_show_days ?? 7, dismissDays = cfg.silence_after_dismiss_days ?? 14;
  const log = D.triggerLog || [];
  const saved = (D.questions || []).filter((q) => q.origin === 'trigger');
  const shownToday = log.filter((l) => l.shown_at && diffDays(today, dayOf(l.shown_at)) === 0);
  for (const l of shownToday) {
    if (l.dismissed_at) return null;
    if (saved.some((q) => q.trigger_code === l.trigger_code && diffDays(today, dayOf(q.created_at)) === 0)) return null;
    const f = fired.find((x) => x.code === l.trigger_code) || { code: l.trigger_code };
    return { trigger: f, text: triggerText(D, f), log: l, reuse: true };
  }
  if (shownToday.length) return null;
  for (const f of fired) {
    const rows = log.filter((l) => l.trigger_code === f.code);
    const lastShown = rows.filter((l) => l.shown_at).map((l) => dayOf(l.shown_at)).sort((a, b) => b - a)[0];
    const lastDismiss = rows.filter((l) => l.dismissed_at).map((l) => dayOf(l.dismissed_at)).sort((a, b) => b - a)[0];
    if (lastShown && diffDays(today, lastShown) < showDays) continue;
    if (lastDismiss && diffDays(today, lastDismiss) < dismissDays) continue;
    return { trigger: f, text: triggerText(D, f), reuse: false };
  }
  return null;
}

// Подсказки при добавлении вопроса: до трёх из сработавших триггеров
export function questionHints(D, fired) {
  return fired.slice(0, 3).map((f) => ({ code: f.code, text: triggerText(D, f) }));
}

// ---------- цитата дня, короткое задание, фильм ----------
export function pickQuote(D, tags = [], today = startOfDay()) {
  const quotes = (D.quotes || []).filter((q) => q.verified);
  if (!quotes.length) return null;
  const shown = D.quoteShown || [];
  const t = shown.find((s) => diffDays(today, parseDay(s.shown_on)) === 0);
  if (t) { const q = quotes.find((x) => x.id === t.quote_id); if (q) return { quote: q, action: null }; }
  const seen = new Set(shown.map((s) => s.quote_id));
  const unseen = quotes.filter((q) => !seen.has(q.id)).sort((a, b) => a.id.localeCompare(b.id));
  if (unseen.length) {
    const byTag = unseen.find((q) => (q.tags || []).some((x) => tags.includes(x)));
    return { quote: byTag || unseen[0], action: 'insert' };
  }
  const oldest = [...shown].sort((a, b) => parseDay(a.shown_on) - parseDay(b.shown_on))[0];
  const q = quotes.find((x) => x.id === oldest?.quote_id);
  return q ? { quote: q, action: 'update' } : null;
}

export function pickShortTask(D, info, tags = []) {
  if (info.state !== 'active' && info.state !== 'finished') return null;
  const { done } = doneSets(D);
  const open = visibleItems(D).filter((i) => i.kind === 'short_task' && i.week <= info.n && !done.has(i.id));
  return open.find((i) => (i.tags || []).some((x) => tags.includes(x))) || open[0] || null;
}

export function pickMovie(D, tags = [], weekN = 1) {
  const all = (D.movies || []).filter((m) => m.verified).sort((a, b) => a.title.localeCompare(b.title));
  const hit = all.find((m) => (m.tags || []).some((x) => tags.includes(x)));
  if (hit) return { movie: hit, byTag: true };
  if (D.settings?.movies_fallback !== false && all.length) {
    // нечётные недели фильм, чётные книга
    const w = Math.max(1, weekN), kind = w % 2 === 1 ? 'film' : 'book';
    const pool = all.filter((m) => (m.kind || 'film') === kind), list = pool.length ? pool : all;
    return { movie: list[Math.floor((w - 1) / 2) % list.length], byTag: false };
  }
  return null;
}

// Прогресс по ачивкам: текущее значение счётчика и ближайшая ступень (повторяет серверные счётчики)
export function achievementProgress(D) {
  const items = new Map((D.items || []).map((i) => [i.id, i]));
  const live = (D.completions || []).filter((c) => !c.undone_at);
  const cnt = (pred) => live.filter((c) => c.kind === 'done' && pred(items.get(c.item_id))).length;
  const vids = liveVideos(D);
  const earned = (D.userAch || []).filter((u) => !u.revoked_at);
  const counter = (key) => {
    if (key === 'videos') return vids.length;
    if (key === 'videos_each_dir') return Math.min(...['client', 'expert', 'life'].map((k) => vids.filter((v) => v.kind === k).length));
    if (key === 'lessons') return cnt((i) => i && ['lesson', 'live', 'material'].includes(i.kind));
    if (key === 'homework') return cnt((i) => i && i.kind === 'homework');
    if (key === 'notes') return live.filter((c) => c.kind === 'notes').length;
    if (key === 'checkpoints_ontime') return (D.checkpoints || []).filter((c) => c.submitted_at && c.submitted_at.slice(0, 10) <= c.due_date).length;
    if (key === 'insights') return (D.insights || []).filter((i) => !i.deleted_at).length;
    if (key === 'questions_asked') return (D.questions || []).filter((q) => q.status === 'asked' && !q.deleted_at).length;
    if (key.startsWith('challenge:')) { const code = key.slice(10); return cnt((i) => i && i.kind === 'challenge_task' && (i.tags || []).includes(code)); }
    return 0;
  };
  const total = (key) => key === 'checkpoints_ontime' ? (D.checkpoints || []).length
    : key.startsWith('challenge:') ? visibleItems(D).filter((i) => i.kind === 'challenge_task' && (i.tags || []).includes(key.slice(10))).length : 0;
  return (D.achievements || []).map((a) => {
    const got = earned.filter((u) => u.code === a.code).map((u) => u.tier), value = counter(a.counter);
    const tiers = [...a.tiers].sort((x, y) => x.tier - y.tier), next = tiers.find((t) => !got.includes(t.tier));
    const thr = next ? (next.threshold ?? total(a.counter)) : null;
    const noTasks = a.counter.startsWith('challenge:') && total(a.counter) === 0 && !got.length;
    return { a, value, got, top: got.length ? Math.max(...got) : 0, next, thr, complete: !next, secret: a.secret, hidden: noTasks, ord: a.ord ?? 100,
      ratio: next && thr > 0 ? Math.min(1, value / thr) : next ? 0 : 1 };
  });
}

// ---------- видео и сопоставление с замерами ----------
export function videoCounts(D, from, to) {
  const c = { client: 0, expert: 0, life: 0, total: 0 };
  for (const v of liveVideos(D)) {
    const d = parseDay(v.logged_on);
    if ((from && d < from) || (to && d > to)) continue;
    c[v.kind]++; c.total++;
  }
  return c;
}
export function videoComparison(D) {
  const cps = submittedCheckpoints(D);
  if (cps.length < 2) return null;
  const a = cps[cps.length - 2], b = cps[cps.length - 1];
  const from = addDays(dayOf(a.submitted_at), 1), to = dayOf(b.submitted_at);
  const counts = videoCounts(D, from, to);
  const tv = metricSeries(D, 'top_views_avg').slice(-2);
  return { counts, from, to, views: tv.length === 2 ? [tv[0].value, tv[1].value] : null };
}

// ---------- форматирование ----------
export const fmtNum = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString('ru-RU'));
export const fmtDay = (d) => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
export const fmtDayShort = (d) => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
export const fmtTime = (d) => d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
export function daysWord(n) {
  if (n < 0) return 'просрочен';
  if (n === 0) return 'сегодня';
  if (n === 1) return 'завтра';
  return 'через ' + n + ' ' + (n < 5 ? 'дня' : 'дней');
}
export function plural(n, one, few, many) {
  const m = Math.abs(n) % 100, d = m % 10;
  if (m > 10 && m < 20) return many;
  if (d > 1 && d < 5) return few;
  if (d === 1) return one;
  return many;
}

// Ачивки открываются по очереди: сначала три, за каждую полученную открывается ещё одна
export function achievementView(D) {
  const all = achievementProgress(D).filter((x) => !x.hidden && (!x.secret || x.got.length)).sort((a, b) => a.ord - b.ord);
  const earned = all.filter((x) => x.got.length).length;
  const open = all.filter((x, i) => i < 3 + earned || x.got.length);
  return { open, locked: all.length - open.length };
}

// ---------- данные для графиков прогресса ----------
// Доля пройденных обязательных пунктов по неделям (модуль 0 и недели до текущей)
export function passageSeries(D, info) {
  const cur = curWeek(info), items = visibleItems(D), { done } = doneSets(D), out = [];
  for (let w = 0; w <= cur; w++) {
    const req = items.filter((i) => i.week === w && i.required && CORE_KINDS.includes(i.kind));
    out.push({ week: w, total: req.length, done: req.filter((i) => done.has(i.id)).length, pct: req.length ? Math.round(req.filter((i) => done.has(i.id)).length / req.length * 100) : null });
  }
  return out;
}
// Накопленный опыт по дням
export function xpSeries(D) {
  const byDay = new Map();
  for (const l of D.ledger || []) { if (l.undone_at || !l.created_at) continue; const d = ymd(dayOf(l.created_at)); byDay.set(d, (byDay.get(d) || 0) + l.xp); }
  let sum = 0; return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, v]) => ({ date: d, value: (sum += v) }));
}
// Видео по неделям: 0 это всё до старта
export function videoWeeks(D, info) {
  const cur = curWeek(info), out = [];
  for (let w = 0; w <= Math.max(cur, 0); w++) {
    const from = w === 0 ? null : weekStart(info.start, w), to = w === 0 ? (info.start ? addDays(info.start, -1) : null) : weekEnd(info.start, w);
    out.push({ week: w, ...videoCounts(D, from, to) });
  }
  return out;
}
export const requiredTotals = (D, info) => {
  const cur = curWeek(info), items = visibleItems(D).filter((i) => i.required && CORE_KINDS.includes(i.kind) && i.week <= Math.max(cur, 0)), { done } = doneSets(D);
  return { total: items.length, done: items.filter((i) => done.has(i.id)).length };
};
