// Админка: рейтинг учеников. Видны все ученики, скрытые помечены, строка открывает карточку
import { $ } from '../core.js';
import { A } from './common.js';
import { loadTop, mountTop } from '../top.js';
import { openCard } from './card.js';

export async function renderTopAdmin(root) {
  root.innerHTML = '<div class="stack"><div class="pagehead"><h1 class="h1s grow"><span class="ink">Рейтинг</span></h1></div><div class="stack-s" id="topBody"><div class="spin"></div></div></div>';
  const body = $('#topBody', root);
  let top;
  try { top = await loadTop(true); } catch (e) { console.warn(e); body.innerHTML = '<p class="dim">Не получилось загрузить рейтинг. Обновите страницу</p>'; return; }
  mountTop(body, top, A.metrics.filter((m) => m.active), { admin: true, onRow: (id) => openCard(id) });
}
