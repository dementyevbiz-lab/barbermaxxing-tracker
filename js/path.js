// Вкладка «Путь»: живая линия от старта к цели, цифры по замерам, история замеров, скриншоты
import { $, esc, state, openSheet } from './core.js';
import * as L from './logic.js';
import * as data from './data.js';
import { fmtMetric } from './ui.js';
import { openCheckpoint } from './forms.js';
import { pathCardHtml, bindPathCard } from './pathcard.js';
import { lineChart } from './charts.js';

const CP_NAME = (cp) => (cp.idx === 0 ? 'Старт' : cp.kind === 'final' ? 'Итоговый замер' : 'Замер ' + cp.idx);

export function metricChart(D, m, height = 150) {
  const g = D.goals[m.key] || {}, ser = L.metricSeries(D, m.key);
  const points = L.submittedCheckpoints(D).map((c) => ({ label: c.idx === 0 ? 'Старт' : 'Зам. ' + c.idx, value: D.cpValues[c.id]?.[m.key] ?? null }));
  const unit = (v) => fmtMetric(m, v);
  const svg = lineChart({ points, goal: g.b != null ? Number(g.b) : null, height, fmtV: (v) => unit(Math.round(v * 10) / 10) });
  const r = L.calcR(D).rows.find((x) => x.key === m.key);
  return { svg: svg || `<div class="progress"><i style="width:${r && r.progress != null ? Math.round(r.progress * 100) : 0}%"></i></div>`, ser, g };
}

export function renderPath(root) {
  const D = state.D, today = L.startOfDay(), info = L.weekInfo(D.profile, D.profile.tariff, today);
  const { R, rows } = L.calcR(D), P = L.calcP(D, R, info);
  const metrics = D.metrics.filter((m) => m.active && (D.goals[m.key]?.a != null || D.goals[m.key]?.b != null || L.metricSeries(D, m.key).length));
  const cps = (D.checkpoints || []).slice().sort((a, b) => a.idx - b.idx);
  const sent = L.submittedCheckpoints(D);

  root.innerHTML = `<div class="stack"><div class="pagehead"><h1 class="h1s grow"><span class="ink">Путь</span></h1></div>
    ${pathCardHtml(D, info, R, { p: 'q', order: 0 })}
    ${metrics.length ? `<div class="h"><span class="ink">Цифры по замерам</span></div><div class="grid-cards">${metrics.map((m) => {
      const { svg, ser, g } = metricChart(D, m), last = ser.length ? ser[ser.length - 1].value : null, r = rows.find((x) => x.key === m.key);
      return `<button class="card mc" data-m="${m.key}"><div class="mc-top"><span class="title2 ink">${esc(m.name)}</span></div>${svg}
        <p class="dim cap">Старт ${esc(fmtMetric(m, g.a))}, сейчас ${esc(fmtMetric(m, last ?? g.a))}${g.b != null ? ', цель ' + esc(fmtMetric(m, g.b)) : ''}${r && r.progress != null ? `. Пройдено ${Math.round(r.progress * 100)}% до цели` : ''}</p></button>`; }).join('')}</div>`
      : '<div class="empty-note"><span class="dim">Графики цифр появятся после первых замеров</span></div>'}
    <section class="card"><div class="h"><span class="ink">Замеры</span></div><div class="stack-s">${cps.map((cp) => `<button class="row" data-cp="${cp.id}" style="padding-right:20px"><span class="row-main"><span class="ink t">${CP_NAME(cp)}</span>
      <span class="dim cap">${cp.submitted_at ? 'Отправлен ' + L.fmtDay(new Date(cp.submitted_at)) : 'До ' + L.fmtDay(L.parseDay(cp.due_date))}</span></span>${cp.submitted_at ? '<span class="plate lime"><span class="onlime">Готово</span></span>' : ''}</button>`).join('') || '<p class="dim">Замеров пока нет</p>'}</div></section>
    <section class="card"><div class="h"><span class="ink">Скриншоты</span></div><div id="gallery"></div></section></div>`;

  bindPathCard(root, 'q', D, R, P);
  root.addEventListener('click', (e) => {
    const mc = e.target.closest('[data-m]'); if (mc) return metricHistory(mc.dataset.m);
    const c = e.target.closest('[data-cp]'); if (c) return cpSheet(D.checkpoints.find((x) => x.id === c.dataset.cp));
    const g = e.target.closest('[data-big]'); if (g) openSheet(`<img src="${esc(g.dataset.big)}" alt="" style="width:100%;border-radius:36px">`);
  });
  drawGallery();

  async function drawGallery() {
    const shots = D.screenshots.filter((s) => !s.deleted_at), el = $('#gallery', root);
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
      <div class="kv"><span class="dim">Старт</span><span class="ink">${esc(fmtMetric(m, g.a))}</span></div>
      <div class="kv"><span class="dim">Цель</span><span class="ink">${esc(fmtMetric(m, g.b))}</span></div>
      ${s.map((p, i) => { const prev = s[i - 1]; const d = prev ? p.value - prev.value : null;
        return `<div class="kv"><span class="dim">${CP_NAME(p.cp)} · ${L.fmtDayShort(new Date(p.date))}</span><span class="ink">${esc(fmtMetric(m, p.value))}${d ? ` <span class="dim">(${d > 0 ? '+' : ''}${L.fmtNum(Math.round(d * 100) / 100)})</span>` : ''}</span></div>`; }).join('')}
      ${m.hint ? `<p class="dim cap">${esc(m.hint)}</p>` : ''}`);
  }
}
