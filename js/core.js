// Ядро: настройки, клиент базы, Telegram, окна, тосты, запись с очередью при плохой связи
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

export const CFG = window.BMX_CONFIG;
export const tg = window.Telegram && window.Telegram.WebApp;
export const sb = createClient(CFG.supabaseUrl, CFG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'bmx-auth' },
});

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
export const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

// Общее состояние приложения
export const state = { D: null, admin: false, tab: 'today', userId: null, preview: false, app: null };

// ---------- память на устройстве (только удобства) ----------
export const store = {
  get(k, d) { try { const v = localStorage.getItem('bmx.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('bmx.' + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem('bmx.' + k); } catch (e) {} },
};

export function initTelegram() {
  if (!tg) return;
  try { tg.ready(); tg.expand(); tg.setHeaderColor && tg.setHeaderColor('#000000'); tg.setBackgroundColor && tg.setBackgroundColor('#000000'); } catch (e) {}
}
export const haptic = () => { try { tg && tg.HapticFeedback && tg.HapticFeedback.impactOccurred('light'); } catch (e) {} };

// ---------- вызов функций Supabase ----------
export async function callFn(name, body, withAuth) {
  const headers = { 'Content-Type': 'application/json', apikey: CFG.supabaseKey };
  if (withAuth) {
    const { data } = await sb.auth.getSession();
    if (data.session) headers.Authorization = 'Bearer ' + data.session.access_token;
  }
  const r = await fetch(`${CFG.supabaseUrl}/functions/v1/${name}`, { method: 'POST', headers, body: JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch (e) {}
  return { http: r.status, ...j };
}

// ---------- тост ----------
let toastT;
export function toast(msg, undo) {
  const t = $('#toast'), u = $('#toastUndo');
  $('#toastTxt').textContent = msg;
  u.hidden = !undo; t.classList.toggle('only', !undo);
  u.onclick = undo ? () => { hideToast(); undo(); } : null;
  t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(hideToast, 2000);
}
export function hideToast() { $('#toast').classList.remove('show'); }

// ---------- окна ----------
let onSheetClose = null;
export function openSheet(html, mount, onClose) {
  const sh = $('#sheet');
  sh.innerHTML = '<div class="grab" aria-hidden="true"></div>' + html;
  onSheetClose = onClose || null;
  mount && mount(sh);
  $('#scrim').classList.add('open'); sh.classList.add('open');
}
export function setSheet(html, mount) { const sh = $('#sheet'); sh.innerHTML = '<div class="grab" aria-hidden="true"></div>' + html; mount && mount(sh); }
export function closeSheet() {
  $('#scrim').classList.remove('open'); $('#sheet').classList.remove('open');
  const f = onSheetClose; onSheetClose = null; f && f();
}
export const sheetOpen = () => $('#sheet').classList.contains('open');

export function showRank(name, L) {
  $('#rmName').textContent = name; $('#rmLvl').textContent = L;
  $('#rankModal').classList.add('open'); haptic();
  requestAnimationFrame(() => fit($('#rmWrap'), 46));
}
export function closeRank() { $('#rankModal').classList.remove('open'); }

export function bindGlobalUi() {
  $('#scrim').addEventListener('click', closeSheet);
  $('#rankModal').addEventListener('click', closeRank);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeSheet(); closeRank(); } });
}

// Уменьшает шрифт блока, пока слово не влезет
export function fit(wrap, max) {
  if (!wrap) return;
  let size = max; wrap.style.fontSize = size + 'px';
  while (wrap.scrollWidth > wrap.clientWidth + 1 && size > 12) { size--; wrap.style.fontSize = size + 'px'; }
}

export function confirmBox(text) {
  return new Promise((res) => (tg && tg.showConfirm) ? tg.showConfirm(text, res) : res(window.confirm(text)));
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Скопировано'); }
  catch (e) { toast('Выделите текст и скопируйте'); }
}

// ---------- запись в базу с очередью ----------
// op = { t: таблица, m: 'insert' | 'upsert' | 'update' | 'delete', row, match, onConflict }
const Q_KEY = 'queue';
let flushing = false;
const isOffline = (res) => res.status === 0 || /failed to fetch|networkerror|load failed|network request failed/i.test(res.error?.message || '');

async function runOp(op) {
  let q = sb.from(op.t);
  if (op.m === 'insert') q = q.insert(op.row);
  else if (op.m === 'upsert') q = q.upsert(op.row, { onConflict: op.onConflict });
  else if (op.m === 'update') q = q.update(op.row).match(op.match);
  else if (op.m === 'delete') q = q.delete().match(op.match);
  try { return await q; } catch (e) { return { error: { message: String(e) }, status: 0 }; }
}

export const pendingCount = () => store.get(Q_KEY, []).length;

// Возвращает { ok, queued, error }
export async function write(op) {
  const res = await runOp(op);
  if (!res.error) return { ok: true };
  if (isOffline(res)) {
    store.set(Q_KEY, [...store.get(Q_KEY, []), op]);
    toast('Нет связи, сохраним при подключении');
    return { ok: true, queued: true };
  }
  if (res.error.code === '23505') return { ok: true, dup: true };
  console.warn('write failed', op, res.error);
  return { ok: false, error: res.error };
}

export async function flushQueue(onDone) {
  if (flushing) return;
  const q = store.get(Q_KEY, []);
  if (!q.length) return;
  flushing = true;
  let sent = 0;
  while (true) {
    const cur = store.get(Q_KEY, []);
    if (!cur.length) break;
    const res = await runOp(cur[0]);
    if (res.error && isOffline(res)) break;
    store.set(Q_KEY, cur.slice(1));
    sent++;
  }
  flushing = false;
  if (sent) { toast('Данные отправлены'); onDone && onDone(); }
}
export function startQueueWatch(onDone) {
  window.addEventListener('online', () => flushQueue(onDone));
  setInterval(() => flushQueue(onDone), 20000);
  flushQueue(onDone);
}

// Чтение с понятной ошибкой «база уснула»
export async function readOrThrow(promise) {
  const res = await promise;
  if (res.error) { const e = new Error(res.error.message); e.code = res.error.code; throw e; }
  return res.data;
}
