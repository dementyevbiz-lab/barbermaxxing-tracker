// Данные ученика: загрузка и действия. Интерфейс отвечает сразу, запись идёт в фоне, опыт сверяется с сервером
import { sb, state, write, readOrThrow, uuid, store, showRank, toast, tg } from './core.js';
import * as L from './logic.js';

export const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));

const sel = (t, f) => (f ? f(sb.from(t).select('*')) : sb.from(t).select('*'));

export async function loadAll(userId) {
  const get = (t, f) => readOrThrow(sel(t, f));
  const [profile, settings, metrics, goals, goalText, items, completions, videos, checkpoints, cpValues, screenshots, ledger, userAch,
    achievements, challenges, challengeResults, calls, insights, questions, quotes, quoteShown, movies, triggers, triggerLog] = await Promise.all([
    readOrThrow(sb.from('profiles').select('*, tariff:tariffs(*)').eq('id', userId).single()),
    get('settings'), get('metrics', (q) => q.order('ord')), get('goals'), get('goal_text'),
    get('program_items', (q) => q.order('week').order('ord')), get('completions'), get('video_logs'),
    get('checkpoints', (q) => q.order('idx')), get('checkpoint_values'), get('screenshots'), get('xp_ledger'), get('user_achievements'),
    get('achievements'), get('challenges'), get('challenge_results'), get('calls'), get('insights'), get('questions'),
    get('quotes'), get('quote_shown'), get('movies'), get('triggers'), get('trigger_log'),
  ]);
  const D = {
    profile, metrics, items, completions, videos, checkpoints, screenshots, ledger, userAch,
    achievements, challenges, challengeResults, calls, insights, questions, quotes, quoteShown, movies, triggers, triggerLog,
    settings: Object.fromEntries(settings.map((s) => [s.key, s.value])),
    goals: Object.fromEntries(goals.map((g) => [g.metric_key, { a: g.a_value, b: g.b_value }])),
    goalText: goalText[0]?.why_text || '',
    cpValues: {},
  };
  for (const v of cpValues) (D.cpValues[v.checkpoint_id] ||= {})[v.metric_key] = v.value;
  return D;
}

// Сверка опыта, ачивок и наград с сервером
export async function syncProgress() {
  const D = state.D; if (!D) return;
  try {
    const [ledger, userAch, challengeResults] = await Promise.all([
      readOrThrow(sb.from('xp_ledger').select('*')), readOrThrow(sb.from('user_achievements').select('*')), readOrThrow(sb.from('challenge_results').select('*'))]);
    D.ledger = ledger; D.userAch = userAch; D.challengeResults = challengeResults;
    checkRank();
    emit('progress');
  } catch (e) { console.warn('sync', e); }
}

export const xpNow = () => L.xpTotal(state.D.ledger);
export const lvlStep = () => state.D.settings.level_step ?? 50;
export const ranksList = () => state.D.settings.ranks || L.DEFAULT_RANKS;
export const levelNow = () => L.levelOf(xpNow(), lvlStep());

export function initRank() {
  const D = state.D, lv = L.levelOf(xpNow(), lvlStep()), key = 'rank.' + D.profile.id;
  if (!store.get(key, null)) store.set(key, { L: lv, r: L.rankOf(lv, ranksList()) });
}
function checkRank() {
  const D = state.D, xp = xpNow(), lv = L.levelOf(xp, lvlStep()), rk = L.rankOf(lv, ranksList());
  const key = 'rank.' + D.profile.id, last = store.get(key, null);
  if (!last) { store.set(key, { L: lv, r: rk }); return; }
  if (rk !== last.r && lv > last.L) showRank(rk, lv);
  if (lv !== last.L || rk !== last.r) store.set(key, { L: lv, r: rk });
}

// Временная запись опыта до ответа сервера. Реальные данные придут из syncProgress
function tempXp(kind, ref, xp) { if (xp) state.D.ledger.push({ id: 'tmp-' + uuid(), user_id: state.D.profile.id, kind, ref_id: ref, xp, undone_at: null, tmp: true }); }
function tempUndo(kind, ref) { for (const r of state.D.ledger) if (r.kind === kind && r.ref_id === ref && !r.undone_at) r.undone_at = new Date().toISOString(); }

const nowIso = () => new Date().toISOString();
const uid = () => state.D.profile.id;

// ---------- пункты программы ----------
export function isDone(itemId) { return state.D.completions.some((c) => c.item_id === itemId && c.kind === 'done' && !c.undone_at); }
export function hasNotes(itemId) { return state.D.completions.some((c) => c.item_id === itemId && c.kind === 'notes' && !c.undone_at); }

async function toggleCompletion(itemId, kind) {
  const D = state.D;
  const live = D.completions.find((c) => c.item_id === itemId && c.kind === kind && !c.undone_at);
  const item = D.items.find((i) => i.id === itemId);
  if (live) {
    live.undone_at = nowIso();
    tempUndo(kind === 'notes' ? 'notes' : 'completion', live.id);
    const r = await write({ t: 'completions', m: 'update', row: { undone_at: live.undone_at }, match: { id: live.id } });
    if (!r.ok) { live.undone_at = null; toast('Не получилось, попробуй ещё раз'); }
    syncProgress();
    return false;
  }
  const row = { id: uuid(), user_id: uid(), item_id: itemId, kind, completed_at: nowIso(), undone_at: null };
  D.completions.push(row);
  tempXp(kind === 'notes' ? 'notes' : 'completion', row.id, kind === 'notes' ? (D.settings.xp?.notes ?? 10) : L.itemXp(item, D.settings.xp));
  const r = await write({ t: 'completions', m: 'insert', row: { id: row.id, user_id: row.user_id, item_id: itemId, kind, completed_at: row.completed_at } });
  if (!r.ok) { D.completions = D.completions.filter((c) => c.id !== row.id); toast('Не получилось, попробуй ещё раз'); }
  syncProgress();
  return true;
}
export const toggleDone = (itemId) => toggleCompletion(itemId, 'done');
export const toggleNotes = (itemId) => toggleCompletion(itemId, 'notes');

// ---------- видео ----------
export async function logVideo(kind, views) {
  const D = state.D, day = L.ymd(new Date());
  const row = { id: uuid(), user_id: uid(), kind, logged_on: day, views: views ?? null, note: null, undone_at: null };
  D.videos.push(row);
  const todayCount = D.videos.filter((v) => v.logged_on === day && !v.undone_at && v.id !== row.id && D.ledger.some((l) => l.ref_id === v.id && l.kind === 'video' && !l.undone_at)).length;
  if (todayCount < (D.settings.xp?.video_daily_max ?? 3)) tempXp('video', row.id, D.settings.xp?.video ?? 15);
  const r = await write({ t: 'video_logs', m: 'insert', row: { id: row.id, user_id: row.user_id, kind, logged_on: day, views: row.views } });
  if (!r.ok) { D.videos = D.videos.filter((v) => v.id !== row.id); toast('Не получилось, попробуй ещё раз'); }
  syncProgress();
  return row;
}
export async function setVideoUndone(id, undone) {
  const v = state.D.videos.find((x) => x.id === id); if (!v) return;
  v.undone_at = undone ? nowIso() : null;
  if (undone) tempUndo('video', id);
  await write({ t: 'video_logs', m: 'update', row: { undone_at: v.undone_at }, match: { id } });
  syncProgress();
}

// ---------- выводы и вопросы ----------
export async function saveInsight(data) {
  const D = state.D;
  if (data.id) {
    const i = D.insights.find((x) => x.id === data.id); Object.assign(i, data, { updated_at: nowIso() });
    await write({ t: 'insights', m: 'update', row: { entry_date: i.entry_date, source: i.source, title: i.title, body: i.body, updated_at: i.updated_at }, match: { id: i.id } });
    return i;
  }
  const row = { id: uuid(), user_id: uid(), entry_date: data.entry_date, source: data.source, title: data.title || null, body: data.body, deleted_at: null, created_at: nowIso() };
  D.insights.push(row); tempXp('insight', row.id, D.settings.xp?.insight ?? 5);
  await write({ t: 'insights', m: 'insert', row: { id: row.id, user_id: row.user_id, entry_date: row.entry_date, source: row.source, title: row.title, body: row.body } });
  syncProgress();
  return row;
}
export async function setInsightDeleted(id, del) {
  const i = state.D.insights.find((x) => x.id === id); if (!i) return;
  i.deleted_at = del ? nowIso() : null; if (del) tempUndo('insight', id);
  await write({ t: 'insights', m: 'update', row: { deleted_at: i.deleted_at }, match: { id } });
  syncProgress();
}
export async function addQuestion(body, origin = 'manual', code = null) {
  const row = { id: uuid(), user_id: uid(), body, status: 'open', origin, trigger_code: code, deleted_at: null, created_at: nowIso() };
  state.D.questions.push(row);
  await write({ t: 'questions', m: 'insert', row: { id: row.id, user_id: row.user_id, body, status: 'open', origin, trigger_code: code } });
  return row;
}
export async function updateQuestion(id, patch) {
  const q = state.D.questions.find((x) => x.id === id); if (!q) return;
  Object.assign(q, patch);
  await write({ t: 'questions', m: 'update', row: patch, match: { id } });
  syncProgress();
}

// ---------- журнал предложенных вопросов ----------
export async function logTriggerShown(code) {
  const row = { id: uuid(), user_id: uid(), trigger_code: code, shown_at: nowIso(), dismissed_at: null };
  state.D.triggerLog.push(row);
  await write({ t: 'trigger_log', m: 'insert', row });
  return row;
}
export async function dismissTrigger(log, on = true) {
  log.dismissed_at = on ? nowIso() : null;
  await write({ t: 'trigger_log', m: 'update', row: { dismissed_at: log.dismissed_at }, match: { id: log.id } });
}

// ---------- цитата дня ----------
export async function markQuoteShown(q, action) {
  const D = state.D, day = L.ymd(new Date());
  if (action === 'insert') {
    D.quoteShown.push({ user_id: uid(), quote_id: q.id, shown_on: day });
    await write({ t: 'quote_shown', m: 'insert', row: { user_id: uid(), quote_id: q.id, shown_on: day } });
  } else if (action === 'update') {
    const s = D.quoteShown.find((x) => x.quote_id === q.id); if (s) s.shown_on = day;
    await write({ t: 'quote_shown', m: 'update', row: { shown_on: day }, match: { user_id: uid(), quote_id: q.id } });
  }
}

// ---------- цели и замеры ----------
export async function saveGoal(metricKey, field, value) {
  const D = state.D, g = (D.goals[metricKey] ||= { a: null, b: null });
  g[field] = value;
  await write({ t: 'goals', m: 'upsert', onConflict: 'user_id,metric_key', row: { user_id: uid(), metric_key: metricKey, a_value: g.a, b_value: g.b } });
}
export async function saveGoalText(text) {
  state.D.goalText = text;
  await write({ t: 'goal_text', m: 'upsert', onConflict: 'user_id', row: { user_id: uid(), why_text: text, updated_at: nowIso() } });
}
export async function saveCpValue(cpId, metricKey, value) {
  const D = state.D; (D.cpValues[cpId] ||= {})[metricKey] = value;
  await write({ t: 'checkpoint_values', m: 'upsert', onConflict: 'checkpoint_id,metric_key', row: { checkpoint_id: cpId, metric_key: metricKey, value } });
}
export async function saveCpNote(cpId, note) {
  const cp = state.D.checkpoints.find((c) => c.id === cpId); cp.note = note;
  await write({ t: 'checkpoints', m: 'update', row: { note }, match: { id: cpId } });
}
export async function submitCheckpoint(cpId) {
  const D = state.D, cp = D.checkpoints.find((c) => c.id === cpId);
  cp.submitted_at = nowIso();
  tempXp('checkpoint', cp.id, D.settings.xp?.checkpoint ?? 40);
  const shots = D.screenshots.filter((s) => s.checkpoint_id === cpId && !s.deleted_at).length;
  if (shots >= (D.settings.xp?.screenshots_min ?? 3)) tempXp('screenshots', cp.id, D.settings.xp?.screenshots_bonus ?? 10);
  const r = await write({ t: 'checkpoints', m: 'update', row: { submitted_at: cp.submitted_at }, match: { id: cpId } });
  if (!r.ok) { cp.submitted_at = null; toast('Не получилось, попробуй ещё раз'); }
  syncProgress();
  return r.ok;
}

// ---------- профиль ----------
export async function saveProfilePatch(patch) {
  Object.assign(state.D.profile, patch);
  await write({ t: 'profiles', m: 'update', row: patch, match: { id: uid() } });
}
export function setOnboarding(patch) {
  const next = { ...(state.D.profile.onboarding || {}), ...patch };
  return saveProfilePatch({ onboarding: next });
}
export function setPrefs(patch) {
  const next = { ...(state.D.profile.prefs || {}), ...patch };
  return saveProfilePatch({ prefs: next });
}

// ---------- скриншоты ----------
const urlCache = new Map();
export async function signedUrls(paths) {
  const need = paths.filter((p) => !urlCache.has(p) || urlCache.get(p).exp < Date.now());
  if (need.length) {
    const { data } = await sb.storage.from('screenshots').createSignedUrls(need, 3600);
    for (const r of data || []) if (r.signedUrl) urlCache.set(r.path, { url: r.signedUrl, exp: Date.now() + 3300_000 });
  }
  return Object.fromEntries(paths.map((p) => [p, urlCache.get(p)?.url]));
}

// Сжатие на устройстве: длинная сторона до 1600 px, до ~350 КБ, без EXIF (перерисовка через canvas)
export async function compressImage(file, { maxSide = 1600, targetKb = 350 } = {}) {
  const bmp = await (window.createImageBitmap ? createImageBitmap(file, { imageOrientation: 'from-image' }) : new Promise((res, rej) => {
    const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = URL.createObjectURL(file);
  }));
  let w = bmp.width, h = bmp.height, side = maxSide;
  for (let attempt = 0; attempt < 6; attempt++) {
    const k = Math.min(1, side / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
    const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
    for (const q of [0.82, 0.7, 0.58, 0.46]) {
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
      if (blob && blob.size <= targetKb * 1024) return blob;
      if (q === 0.46 && blob && attempt === 5) return blob;
    }
    side = Math.round(side * 0.82);
  }
}

export async function uploadScreenshot(cpId, kind, file) {
  const D = state.D;
  const blob = await compressImage(file, { maxSide: D.settings.screenshots_cfg?.max_side_px ?? 1600, targetKb: D.settings.screenshots_cfg?.target_kb ?? 350 });
  const id = uuid(), path = `${uid()}/${cpId}/${id}.jpg`;
  const up = await sb.storage.from('screenshots').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (up.error) throw new Error(/failed to fetch|network/i.test(up.error.message) ? 'Нет связи' : up.error.message);
  const row = { id, user_id: uid(), checkpoint_id: cpId, kind, storage_path: path, size_bytes: blob.size, deleted_at: null, created_at: nowIso() };
  const r = await write({ t: 'screenshots', m: 'insert', row: { id, user_id: row.user_id, checkpoint_id: cpId, kind, storage_path: path, size_bytes: blob.size } });
  if (!r.ok) throw new Error(r.error?.message || 'Не удалось сохранить');
  D.screenshots.push(row);
  syncProgress();
  return row;
}
export async function setScreenshotDeleted(id, del) {
  const s = state.D.screenshots.find((x) => x.id === id); if (!s) return;
  s.deleted_at = del ? nowIso() : null;
  await write({ t: 'screenshots', m: 'update', row: { deleted_at: s.deleted_at }, match: { id } });
  syncProgress();
}

// Сохранение файла: в Telegram через его загрузку (по подписанной ссылке), в браузере обычным скачиванием
export async function saveFile(blob, name) {
  const browserSave = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000); };
  if (tg && tg.downloadFile && tg.isVersionAtLeast && tg.isVersionAtLeast('8.0')) {
    try {
      const path = `${state.D.profile.id}/${name}`;
      const up = await sb.storage.from('exports').upload(path, blob, { upsert: true, contentType: blob.type });
      if (up.error) throw up.error;
      const { data } = await sb.storage.from('exports').createSignedUrl(path, 600, { download: name });
      if (!data?.signedUrl) throw new Error('no url');
      tg.downloadFile({ url: data.signedUrl, file_name: name }, (ok) => { if (!ok) { try { tg.openLink(data.signedUrl); } catch (e) { browserSave(); } } });
      return;
    } catch (e) { console.warn('tg download', e); }
  }
  browserSave();
}
