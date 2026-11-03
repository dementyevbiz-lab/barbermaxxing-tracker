// «Мой путь»: линия от старта к цели заполняется по мере прохождения. Старт, Цель и Сейчас открываются карточками
import { $, esc, state, openSheet } from './core.js';
import * as L from './logic.js';
import * as data from './data.js';
import { pathSvg, pathLegend, placeMarkers, pathHelpSheet, fmtMetric, tri } from './ui.js';

export function pathCardHtml(D, info, R, { p = 'p', order = 50, big = false } = {}) {
  const hasNow = R != null;
  const next = (D.checkpoints || []).filter((c) => !c.submitted_at && c.idx > 0).sort((a, b) => a.idx - b.idx)[0];
  const cap = hasNow ? `<p class="ink"><span class="limet">Пройдено ${Math.round(R * 100)}% пути к цели</span></p>`
    : `<p class="dim cap">${next ? 'Первый замер до ' + L.fmtDay(L.parseDay(next.due_date)) + ': после него линия начнёт заполняться' : 'После первого замера линия начнёт заполняться'}</p>`;
  return `<section class="card" id="${p}Card" style="order:${order}">
    <div class="h"><span class="ink">Мой путь</span><span class="grow"></span><button class="qbtn" id="${p}Q" aria-label="Что это"><span class="dim">?</span></button></div>
    ${pathSvg(p)}${pathLegend(hasNow)}${cap}
    ${D.goalText ? `<p class="goal ink">${esc(D.goalText)}</p>` : ''}</section>`;
}

const shotsHtml = async (cp) => {
  const D = state.D, shots = D.screenshots.filter((s) => s.checkpoint_id === cp?.id && !s.deleted_at);
  if (!shots.length) return '';
  const urls = await data.signedUrls(shots.map((s) => s.storage_path));
  return `<div class="gal">${shots.map((s) => `<button class="shot" data-big="${esc(urls[s.storage_path] || '')}"><img src="${esc(urls[s.storage_path] || '')}" alt="" loading="lazy"></button>`).join('')}</div>`;
};
const bindBig = (sh) => sh.querySelectorAll('[data-big]').forEach((b) => b.onclick = () => openSheet(`<img src="${esc(b.dataset.big)}" alt="" style="width:100%;border-radius:36px">`));

export function bindPathCard(root, p, D, R, P) {
  const model = { info: L.weekInfo(D.profile, D.profile.tariff, L.startOfDay()) };
  const place = () => placeMarkers(root, p, R, P, false);
  place(); if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
  $('#' + p + 'Q', root).onclick = () => openSheet(pathHelpSheet(R != null));
  const act = (e) => {
    const t = e.target.closest('[data-pt]'); if (!t) return;
    if (t.dataset.pt === 'a') startSheet(); else if (t.dataset.pt === 'b') goalSheet(); else nowSheet();
  };
  const svg = root.querySelector('#' + p + 'Card svg.path-svg');
  svg.addEventListener('click', act); svg.addEventListener('keydown', (e) => { if (e.key === 'Enter') act(e); });

  const baseline = () => D.checkpoints.find((c) => c.idx === 0);
  async function startSheet() {
    const cp = baseline(), vals = D.metrics.filter((m) => m.active && D.goals[m.key]?.a != null);
    const gal = cp ? await shotsHtml(cp) : '';
    openSheet(`<span class="dim cap">${cp?.submitted_at ? 'Внесено ' + L.fmtDay(new Date(cp.submitted_at)) : D.profile.start_date ? 'Старт ' + L.fmtDay(L.parseDay(D.profile.start_date)) : ''}</span>
      <h2 class="sh-title"><span class="ink">Старт</span></h2>
      <p class="dim cap">Где ты был в начале пути</p>
      ${vals.map((m) => `<div class="kv"><span class="dim">${esc(m.name)}</span><span class="ink">${esc(fmtMetric(m, D.goals[m.key].a))}</span></div>`).join('') || '<p class="dim">Твои цифры старта появятся здесь после онбординга</p>'}
      ${cp?.note ? `<p class="ink">${esc(cp.note)}</p>` : ''}${gal}`, bindBig);
  }
  async function goalSheet() {
    const cur = L.latestValues(D);
    const vals = D.metrics.filter((m) => m.active && D.goals[m.key]?.b != null);
    openSheet(`<span class="dim cap">Куда ты идёшь</span><h2 class="sh-title"><span class="ink">Цель</span></h2>
      ${D.goalText ? `<p class="goal ink">${esc(D.goalText)}</p>` : ''}
      ${vals.map((m) => { const b = D.goals[m.key].b, now = cur[m.key] ?? D.goals[m.key].a, left = now != null ? Math.abs(b - now) : null;
        return `<div class="kv" style="flex-direction:column;gap:2px"><div style="display:flex;justify-content:space-between;gap:12px"><span class="dim">${esc(m.name)}</span><span class="limet title2">${esc(fmtMetric(m, b))}</span></div>${left != null && left > 0 ? `<span class="dim cap">Сейчас ${esc(fmtMetric(m, now))}, осталось ${esc(fmtMetric(m, Math.round(left * 100) / 100))}</span>` : left === 0 ? '<span class="dim cap">Цель достигнута</span>' : ''}</div>`; }).join('') || '<p class="dim">Цели по цифрам появятся здесь после онбординга</p>'}`);
  }
  async function nowSheet() {
    const sent = L.submittedCheckpoints(D).filter((c) => c.idx > 0), cp = sent[sent.length - 1];
    if (!cp) return openSheet(`<h2 class="sh-title"><span class="ink">Сейчас</span></h2><p class="dim">После первого замера здесь появятся твои актуальные цифры</p>`);
    const { rows } = L.calcR(D), gal = await shotsHtml(cp);
    openSheet(`<span class="dim cap">Замер ${L.fmtDay(new Date(cp.submitted_at))}</span><h2 class="sh-title"><span class="ink">Сейчас</span></h2>
      ${D.metrics.filter((m) => m.active && D.cpValues[cp.id]?.[m.key] != null).map((m) => { const g = D.goals[m.key] || {}, r = rows.find((x) => x.key === m.key);
        return `<div class="kv" style="flex-direction:column;gap:6px"><div style="display:flex;justify-content:space-between;gap:12px"><span class="dim">${esc(m.name)}</span><span class="limet title2">${esc(fmtMetric(m, D.cpValues[cp.id][m.key]))}</span></div>
          <span class="dim cap">${esc(fmtMetric(m, g.a))} ${tri()} ${esc(fmtMetric(m, D.cpValues[cp.id][m.key]))} ${tri()} ${esc(fmtMetric(m, g.b))}</span>${r && r.progress != null ? `<div class="progress"><i style="width:${Math.round(r.progress * 100)}%"></i></div>` : ''}</div>`; }).join('')}
      ${cp.note ? `<p class="ink">${esc(cp.note)}</p>` : ''}${gal}`, bindBig);
  }
}
