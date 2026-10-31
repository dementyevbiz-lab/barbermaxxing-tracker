// Вкладка «Путь»: линия А к Б, метрики, история замеров, видео, скриншоты
import { $, $$, esc, state, openSheet, toast } from './core.js';
import * as L from './logic.js';
import * as data from './data.js';
import { pathSvg, pathLegend, placeMarkers, pathHelpSheet, fmtMetric, unitOf, sparkline, SCREEN_KINDS, VIDEO_ICON } from './ui.js';
import { openCheckpoint, openVideoSheet, openVideoEdit } from './forms.js';
import { progressHtml } from './progress.js';

const CP_NAME = (cp) => (cp.idx === 0 ? 'Точка А' : cp.kind === 'final' ? 'Итоговый замер' : 'Замер ' + cp.idx);

export function renderPath(root) {
  const D = state.D, today = L.startOfDay(), info = L.weekInfo(D.profile, D.profile.tariff, today);
  const { R, rows } = L.calcR(D), P = L.calcP(D, R, info);
  const hasNow = R != null;
  const metrics = D.metrics.filter((m) => m.active && (D.goals[m.key]?.a != null || D.goals[m.key]?.b != null || L.metricSeries(D, m.key).length));
  const cps = (D.checkpoints || []).slice().sort((a, b) => a.idx - b.idx);
  const sent = L.submittedCheckpoints(D);
  const cmp = L.videoComparison(D);
  const wkVideos = info.state === 'active' ? L.videoCounts(D, L.weekStart(info.start, info.n), L.weekEnd(info.start, info.n)) : { client: 0, expert: 0, life: 0, total: 0 };
  const all = L.videoCounts(D);
  const myVids = L.liveVideos(D).slice().sort((a, b) => b.logged_on.localeCompare(a.logged_on));
  const withViews = myVids.filter((v) => v.views != null);
  const showAllVids = state.showAllVids === true;

  root.innerHTML = `<div class="stack"><div class="pagehead"><h1 class="h1s grow"><span class="ink">Путь</span></h1></div>
    <div class="grid-cards">${progressHtml(D, info, L.visibleItems(D), rows, 0)}<section class="card">
      <div class="h"><span class="ink">Мой путь</span><span class="grow"></span><button class="qbtn" id="pQ"><span class="dim">?</span></button></div>
      ${pathSvg('q')}${pathLegend(hasNow)}${D.goalText ? `<p class="goal ink">${esc(D.goalText)}</p>` : ''}</section>
    <section class="card"><div class="h"><span class="ink">Видео</span><span class="grow"></span><span class="dim cap">всего ${all.total}</span></div>
      <div class="stack-s" style="gap:14px">${Object.entries(L.VIDEO_KINDS).map(([k, t]) => `<div class="prog-row"><div class="top"><span class="ink">${VIDEO_ICON[k]} ${t}</span><span class="vals dim">за неделю ${wkVideos[k]} · всего ${all[k]}</span></div><div class="progress"><i style="width:${all.total ? Math.round(all[k] / Math.max(all.client, all.expert, all.life, 1) * 100) : 0}%"></i></div></div>`).join('')}</div>
      ${cmp ? `<p class="ink">За период между замерами ${cmp.counts.total} ${L.plural(cmp.counts.total, 'видео', 'видео', 'видео')} (${cmp.counts.client} с клиентом, ${cmp.counts.expert} экспертных, ${cmp.counts.life} лайф)${cmp.views ? `, просмотры лучших с ${L.fmtNum(cmp.views[0])} до ${L.fmtNum(cmp.views[1])}` : ''}</p>` : '<p class="dim cap">После второго замера здесь появится сопоставление видео с цифрами</p>'}
      <div class="h" style="margin-top:6px"><span class="ink">Мои видео</span><span class="grow"></span><button class="btn sm pri" id="vAdd"><span class="onlime">Добавить видео</span></button></div>
      ${withViews.length ? `<p class="ink">Лучшее видео: ${L.fmtNum(Math.max(...withViews.map((v) => v.views)))} просмотров · всего ${L.fmtNum(withViews.reduce((s, v) => s + v.views, 0))}</p>` : ''}
      <div class="stack-s">${(showAllVids ? myVids : myVids.slice(0, 6)).map((v) => `<button class="row" data-vid="${v.id}" style="padding-right:20px"><span class="ico">${VIDEO_ICON[v.kind]}</span><span class="row-main"><span class="ink t">${L.VIDEO_KINDS[v.kind]}</span><span class="dim cap">${L.fmtDay(L.parseDay(v.logged_on))} · ${v.views != null ? 'просмотры ' + L.fmtNum(v.views) : 'добавить просмотры'}</span></span></button>`).join('') || '<p class="dim cap">Записанные видео появятся здесь. Просмотры можно добавлять, когда они накопятся</p>'}${myVids.length > 6 && !showAllVids ? '<button class="btn sm" id="vAll"><span class="ink">Показать все</span></button>' : ''}</div></section></div>
    ${metrics.length ? `<div class="grid-cards grid-3">${metrics.map((m) => metricCard(D, m, rows)).join('')}</div>` : '<div class="empty-note"><span class="dim">Цифры появятся после первых замеров</span></div>'}
    <section class="card"><div class="h"><span class="ink">Замеры</span></div><div class="stack-s">${cps.map((cp) => `<button class="row" data-cp="${cp.id}" style="padding-right:20px"><span class="row-main"><span class="ink t">${CP_NAME(cp)}</span>
      <span class="dim cap">${cp.submitted_at ? 'Отправлен ' + L.fmtDay(new Date(cp.submitted_at)) : 'До ' + L.fmtDay(L.parseDay(cp.due_date))}</span></span>${cp.submitted_at ? '<span class="plate lime"><span class="onlime">Готово</span></span>' : ''}</button>`).join('') || '<p class="dim">Замеров пока нет</p>'}</div></section>
    <section class="card"><div class="h"><span class="ink">Скриншоты</span></div><div id="gallery"></div></section></div>`;

  placeMarkers(root, 'q', R, P, false);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => placeMarkers(root, 'q', R, P, false));
  $('#pQ', root).onclick = () => openSheet(pathHelpSheet(hasNow));

  root.addEventListener('click', (e) => {
    const mc = e.target.closest('[data-m]'); if (mc) return metricHistory(mc.dataset.m);
    if (e.target.closest('#vAdd')) return openVideoSheet({ onSaved: () => state.app.refresh() });
    if (e.target.closest('#vAll')) { state.showAllVids = true; return state.app.refresh(); }
    const vr = e.target.closest('[data-vid]'); if (vr) return openVideoEdit(vr.dataset.vid, { onChanged: () => state.app.refresh() });
    const c = e.target.closest('[data-cp]'); if (c) return cpSheet(D.checkpoints.find((x) => x.id === c.dataset.cp));
    const g = e.target.closest('[data-big]'); if (g) openSheet(`<img src="${esc(g.dataset.big)}" alt="" style="width:100%;border-radius:36px">`);
  });
  drawGallery();

  async function drawGallery() {
    const shots = D.screenshots.filter((s) => !s.deleted_at);
    const el = $('#gallery', root);
    if (!shots.length) { el.innerHTML = '<p class="dim">Скриншоты появятся вместе с замерами</p>'; return; }
    const urls = await data.signedUrls(shots.map((s) => s.storage_path));
    el.innerHTML = cps.filter((cp) => shots.some((s) => s.checkpoint_id === cp.id)).map((cp) => `<div class="stack-s" style="margin-bottom:18px"><span class="dim cap">${CP_NAME(cp)}</span>
      <div class="gal">${shots.filter((s) => s.checkpoint_id === cp.id).map((s) => `<button class="shot" data-big="${esc(urls[s.storage_path] || '')}"><img src="${esc(urls[s.storage_path] || '')}" alt="" loading="lazy"></button>`).join('')}</div></div>`).join('');
  }

  function cpSheet(cp) {
    const laterSent = sent.some((c) => c.idx > cp.idx);
    const editable = (!cp.submitted_at && (L.nextCheckpoint(D)?.cp.id === cp.id)) || (cp.submitted_at && !laterSent);
    const vals = D.cpValues[cp.id] || {};
    openSheet(`<span class="dim cap">${cp.submitted_at ? 'Отправлен ' + L.fmtDay(new Date(cp.submitted_at)) : 'До ' + L.fmtDay(L.parseDay(cp.due_date))}</span>
      <h2 class="sh-title"><span class="ink">${CP_NAME(cp)}</span></h2>
      ${D.metrics.filter((m) => m.active).map((m) => `<div class="kv"><span class="dim">${esc(m.name)}</span><span class="ink">${esc(fmtMetric(m, vals[m.key]))}</span></div>`).join('')}
      ${cp.note ? `<p class="dim cap">${esc(cp.note)}</p>` : ''}
      ${editable ? '<button class="btn pri wide" id="cpEdit"><span class="onlime">' + (cp.submitted_at ? 'Исправить' : 'Заполнить') + '</span></button>' : ''}`,
    (sh) => { const b = sh.querySelector('#cpEdit'); if (b) b.onclick = () => { $('#scrim').click(); openCheckpoint(cp.id, { onDone: () => state.app.refresh() }); }; });
  }

  function metricHistory(key) {
    const m = D.metrics.find((x) => x.key === key), s = L.metricSeries(D, key), g = D.goals[key] || {};
    openSheet(`<h2 class="sh-title"><span class="ink">${esc(m.name)}</span></h2>
      <div class="kv"><span class="dim">Точка А</span><span class="ink">${esc(fmtMetric(m, g.a))}</span></div>
      <div class="kv"><span class="dim">Точка Б</span><span class="ink">${esc(fmtMetric(m, g.b))}</span></div>
      ${s.map((p, i) => { const prev = s[i - 1]; const d = prev ? p.value - prev.value : null;
        return `<div class="kv"><span class="dim">${p.idx === 0 ? 'Точка А' : CP_NAME(p.cp)} · ${L.fmtDayShort(new Date(p.date))}</span><span class="ink">${esc(fmtMetric(m, p.value))}${d ? ` <span class="dim">(${d > 0 ? '+' : ''}${L.fmtNum(Math.round(d * 100) / 100)})</span>` : ''}</span></div>`; }).join('')}
      ${m.hint ? `<p class="dim cap">${esc(m.hint)}</p>` : ''}`);
  }
}

function metricCard(D, m, rows) {
  const g = D.goals[m.key] || {}, series = L.metricSeries(D, m.key), cur = series.length ? series[series.length - 1].value : g.a;
  const r = rows.find((x) => x.key === m.key);
  return `<button class="card mc" data-m="${m.key}">
    <div class="mc-top"><span class="title2 ink">${esc(m.name)}</span></div>
    <div class="mc-vals"><div><span class="dim cap">Было</span><span class="ink">${esc(fmtMetric(m, g.a))}</span></div>
      <div><span class="dim cap">Сейчас</span><span class="title2 limet">${esc(fmtMetric(m, cur))}</span></div>
      <div><span class="dim cap">Цель</span><span class="ink">${esc(fmtMetric(m, g.b))}</span></div></div>
    ${r && r.progress != null ? `<div class="progress"><i style="width:${Math.round(r.progress * 100)}%"></i></div>` : ''}
    ${sparkline(series)}</button>`;
}
