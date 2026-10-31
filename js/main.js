// Запуск: вход через Telegram, каркас с вкладками, запоминание места
import { $, esc, sb, tg, state, store, callFn, initTelegram, bindGlobalUi, startQueueWatch, closeSheet, sheetOpen } from './core.js';
import * as data from './data.js';
import { loadAll, syncProgress } from './data.js';
import { needsOnboarding, runOnboarding } from './onboarding.js';
import { renderToday } from './today.js';
import { renderPath } from './path.js';
import { renderProgram } from './program.js';
import { renderNotes } from './notes.js';
import { renderProfile } from './profile.js';
import { pageOpen } from './ui.js';

const root = $('#root');
initTelegram(); bindGlobalUi();

function screen(title, sub, { loading, retry, chip } = {}) {
  root.innerHTML = `<div class="center-screen"><div class="big-card">
    <div class="logo"><img src="assets/logo.webp" alt="Трекер прогресса"></div>
    <span class="brand-t limet">BARBERMAXXING</span>
    <h1 class="h1"><span class="ink">${esc(title)}</span></h1>
    ${sub ? `<p class="cap"><span class="dim">${esc(sub)}</span></p>` : ''}
    ${chip ? `<span class="pill" style="align-self:center"><span class="ink">${esc(chip)}</span></span>` : ''}
    ${loading ? '<div class="spin"></div>' : ''}
    ${retry ? '<button class="btn" id="retry" style="align-self:center"><span class="ink">Попробовать снова</span></button>' : ''}</div></div>`;
  const r = $('#retry'); if (r) r.onclick = boot;
}

// ---------- вход ----------
async function login() {
  const initData = tg && tg.initData;
  if (!initData) {
    // Проверка вне Telegram: только с уже выданной сессией и меткой #test
    if (location.hash === '#test') {
      const { data: s } = await sb.auth.getSession();
      if (s.session) { const { data: adm } = await sb.rpc('is_admin'); return { status: 'ok', user_id: s.session.user.id, is_admin: !!adm, first_name: '' }; }
    }
    return { status: 'no_telegram' };
  }
  let r;
  try { r = await callFn('tg-auth', { initData }); } catch (e) { return { status: 'offline' }; }
  if (r.status === 'ok') await sb.auth.setSession({ access_token: r.session.access_token, refresh_token: r.session.refresh_token });
  return r;
}

async function boot() {
  screen('Входим', '', { loading: true });
  const r = await login();
  const id = r.telegram_id ? `Твой Telegram ID: ${r.telegram_id}` : '';
  switch (r.status) {
    case 'ok': break;
    case 'no_telegram': return screen('Привет', 'Открой приложение через бота в Telegram');
    case 'invite_required': return screen('Доступ по приглашению', 'Попроси ссылку у команды программы', { chip: id });
    case 'invite_invalid': return screen('Ссылка не работает', 'Её уже использовали или заменили. Попроси новую у команды программы', { chip: id });
    case 'blocked': return screen('Доступ закрыт', 'Если это ошибка, напиши команде программы');
    case 'too_many': return screen('Слишком много попыток', 'Попробуй через час');
    case 'offline': return screen('Нет связи', 'Проверь интернет и попробуй снова', { retry: true });
    default: screen('Обновляем данные', 'Зайди через минуту', { retry: true }); if (!boot.retried) { boot.retried = true; setTimeout(boot, 7000); } return;
  }
  state.userId = r.user_id; state.admin = r.is_admin;
  if (r.is_admin) { const m = await import('./admin/index.js'); return m.startAdmin(root, r); }
  try { state.D = await loadAll(r.user_id); }
  catch (e) { console.warn(e); screen('Обновляем данные', 'Зайди через минуту', { retry: true }); if (!boot.retried) { boot.retried = true; setTimeout(boot, 7000); } return; }
  state.loadedAt = Date.now();
  data.initRank();
  startStudent();
}

// ---------- ученик ----------
const TABS = [
  ['today', 'Сегодня', '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.8v2.2M12 19v2.2M2.8 12H5M19 12h2.2M5.5 5.5l1.6 1.6M16.9 16.9l1.6 1.6M5.5 18.5l1.6-1.6M16.9 7.1l1.6-1.6"/>'],
  ['path', 'Путь', '<circle cx="5" cy="18.5" r="2"/><circle cx="19" cy="5.5" r="2"/><path d="M6.8 17.4c3-1.6 1.2-5.6 5.2-6.4s2.6-3.9 5.3-4.6"/>'],
  ['program', 'Программа', '<rect x="4" y="3.5" width="16" height="17" rx="4"/><path d="M8 8.5h8M8 12h8M8 15.5h5"/>'],
  ['notes', 'Выводы', '<path d="M5 19.5h4l10-10a2.8 2.8 0 0 0-4-4l-10 10z"/><path d="M13.5 7l3.5 3.5"/>'],
  ['profile', 'Профиль', '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.8 20c1.2-3.6 4-5.3 7.2-5.3s6 1.7 7.2 5.3"/>'],
];
const SCREENS = { today: renderToday, path: renderPath, program: renderProgram, notes: renderNotes, profile: renderProfile };
let cleanup = null;

function startStudent() {
  const D = state.D, p = D.profile;
  if (p.status === 'blocked') return screen('Доступ закрыт', 'Если это ошибка, напиши команде программы');
  if (!D.checkpoints.length) return screen(`Привет, ${p.display_name}`, 'Команда программы скоро назначит дату старта. Мы напишем, когда всё будет готово', { chip: p.tariff?.name });
  if (needsOnboarding(D) && p.status !== 'paused') {
    screen('Привет', '', { loading: true });
    return runOnboarding(() => startStudent());
  }
  root.innerHTML = `<div class="app"><nav class="tabs" id="tabs"><div class="brand"><span class="logo-s"><img src="assets/logo.webp" alt=""></span><span class="limet">BARBERMAXXING</span></div>
    ${TABS.map(([k, t, svg]) => `<button class="tab" data-tab="${k}"><svg viewBox="0 0 24 24">${svg}</svg><span class="lbl dim">${t}</span></button>`).join('')}</nav>
    <main class="main" id="main"></main></div>`;
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (b) go(b.dataset.tab); });
  window.addEventListener('scroll', saveScroll, { passive: true });
  state.app = { go, refresh };
  startQueueWatch(() => syncProgress());
  const t = store.get('tab', 'today');
  go(SCREENS[t] ? t : 'today', true);
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || Date.now() - state.loadedAt < 60000 || sheetOpen() || pageOpen()) return;
    try { state.D = await loadAll(state.userId); state.loadedAt = Date.now(); refresh(); } catch (e) {}
  });
}

let scrollT;
function saveScroll() { clearTimeout(scrollT); scrollT = setTimeout(() => store.set('scroll.' + state.tab, window.scrollY), 150); }

function go(tab, restore) {
  const same = state.tab === tab && !restore;
  if (cleanup) { try { cleanup(); } catch (e) {} cleanup = null; }
  closeSheet();
  state.tab = tab; store.set('tab', tab);
  $$tabs(tab);
  const main = $('#main'); main.innerHTML = '<div class="appbar"><span class="logo-s"><img src="assets/logo.webp" alt=""></span><span class="brand-t limet">BARBERMAXXING</span></div>';
  const holder = document.createElement('div'); main.appendChild(holder);
  cleanup = SCREENS[tab](holder) || null;
  const y = restore || same ? store.get('scroll.' + tab, 0) : 0;
  requestAnimationFrame(() => window.scrollTo(0, y));
}
function refresh() {
  const y = window.scrollY; go(state.tab, true); requestAnimationFrame(() => window.scrollTo(0, y));
}
function $$tabs(tab) {
  document.querySelectorAll('#tabs .tab').forEach((b) => {
    const on = b.dataset.tab === tab; b.classList.toggle('on', on);
    b.querySelector('.lbl').className = 'lbl ' + (on ? 'limet' : 'dim');
  });
}

boot();
