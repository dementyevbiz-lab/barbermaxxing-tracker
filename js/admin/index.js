// Админка: каркас и вкладки
import { $, esc, state, store, toast, closeSheet, initTelegram } from '../core.js';
import { loadAdminData, A } from './common.js';
import { renderStudents } from './students.js';
import { renderSummary } from './summary.js';
import { renderProgramAdmin } from './program.js';
import { renderContent } from './content.js';
import { renderTopAdmin } from './top.js';
import { pageOpen, closePage } from '../ui.js';

const TABS = [
  ['students', 'Ученики', '<circle cx="9" cy="8" r="3.4"/><path d="M2.8 20c.9-3.3 3.3-5 6.2-5s5.3 1.7 6.2 5"/><path d="M16 5.2a3.2 3.2 0 0 1 0 6M18.5 15c1.4.7 2.4 2.2 2.9 4.2"/>'],
  ['summary', 'Сводка', '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'],
  ['top', 'Рейтинг', '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H4.5v1.5A3 3 0 0 0 8 10.5M16 6h3.5v1.5A3 3 0 0 1 16 10.5M12 13v4M8.5 20h7"/>'],
  ['program', 'Программа', '<rect x="4" y="3.5" width="16" height="17" rx="4"/><path d="M8 8.5h8M8 12h8M8 15.5h5"/>'],
  ['content', 'Контент', '<path d="M12 3l2.6 5.5 6 .8-4.4 4.2 1.1 6L12 16.6 6.7 19.5l1.1-6L3.4 9.3l6-.8z"/>'],
];
const SCREENS = { students: renderStudents, summary: renderSummary, top: renderTopAdmin, program: renderProgramAdmin, content: renderContent };

export async function startAdmin(root, r) {
  root.innerHTML = `<div class="app"><nav class="tabs" id="tabs"><div class="brand"><span class="logo-s"><img src="assets/logo.webp" alt=""></span><span class="limet">BARBERMAXXING</span></div>
    ${TABS.map(([k, t, svg]) => `<button class="tab" data-tab="${k}"><svg viewBox="0 0 24 24">${svg}</svg><span class="lbl dim">${t}</span></button>`).join('')}</nav>
    <main class="main" id="main"><div class="loading-line"></div></main></div>`;
  $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (b) go(b.dataset.tab); });
  try { await loadAdminData(); } catch (e) { console.warn(e); $('#main').innerHTML = '<div class="empty-note"><span class="dim">Не загрузилось. Обновите страницу</span></div>'; return; }
  let scrollT;
  window.addEventListener('scroll', () => { clearTimeout(scrollT); scrollT = setTimeout(() => store.set('ascroll.' + state.tab, window.scrollY), 150); }, { passive: true });
  state.admin = true; state.first = r.first_name;
  state.app = { go, refresh, reload };
  const t = store.get('atab', 'students'); go(SCREENS[t] ? t : 'students', true);
}

function go(tab, restore) {
  const same = state.tab === tab && !restore;
  closeSheet(); if (pageOpen()) closePage();
  state.tab = tab; store.set('atab', tab);
  document.querySelectorAll('#tabs .tab').forEach((b) => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.querySelector('.lbl').className = 'lbl ' + (on ? 'limet' : 'dim'); });
  const main = $('#main'); main.innerHTML = '<div class="appbar"><span class="logo-s"><img src="assets/logo.webp" alt=""></span><span class="brand-t limet">BARBERMAXXING</span></div>'; const h = document.createElement('div'); main.appendChild(h);
  SCREENS[tab](h);
  const y = restore || same ? store.get('ascroll.' + tab, 0) : 0; requestAnimationFrame(() => window.scrollTo(0, y));
}
function refresh() { const y = window.scrollY; go(state.tab, true); requestAnimationFrame(() => window.scrollTo(0, y)); }
async function reload() { await loadAdminData(); refresh(); }
