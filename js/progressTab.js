// Вкладка «Прогресс»: как ученик проходит программу. Графики прохождения, опыта, видео, цифр, ачивки
import { $, esc, state, openSheet } from './core.js';
import * as L from './logic.js';
import * as data from './data.js';
import { VIDEO_ICON, fmtMetric } from './ui.js';
import { lineChart, barChart } from './charts.js';
import { openVideoSheet, openVideoEdit } from './forms.js';
import { achievementsHtml } from './progress.js';
import { metricChart } from './path.js';
import { topButtonHtml, bindTopButton } from './top.js';
import { helpBtn } from './ui.js';

export function renderProgressTab(root) {
  const D = state.D, info = L.weekInfo(D.profile, D.profile.tariff, L.startOfDay());
  const cur = L.curWeek(info), tot = L.requiredTotals(D, info), xp = data.xpNow(), Lv = L.levelOf(xp, data.lvlStep());
  const vids = L.liveVideos(D), all = L.videoCounts(D), withViews = vids.filter((v) => v.views != null);
  const pass = L.passageSeries(D, info), xpS = L.xpSeries(D), vw = L.videoWeeks(D, info);
  const wk = (w) => (w === 0 ? 'М0' : String(w));
  const myVids = vids.slice().sort((a, b) => b.logged_on.localeCompare(a.logged_on));
  const showAll = state.showAllVids === true;
  const metrics = D.metrics.filter((m) => m.active && (D.goals[m.key]?.a != null || L.metricSeries(D, m.key).length));
  const { rows } = L.calcR(D);

  root.innerHTML = `<div class="stack"><div class="pagehead"><h1 class="h1s grow"><span class="ink">Прогресс</span>${cur >= 0 ? `<span class="plate" style="margin-left:12px"><span class="onlime">${esc(cur === 0 ? 'Модуль 0' : 'Неделя ' + cur + ' из ' + info.weeks)}</span></span>` : ''}</h1></div>
    ${topButtonHtml(0, 'topBtnP')}
    <div class="stat-grid three">
      <div class="stat"><span class="dim cap">Пройдено</span><span class="big-num ink">${tot.done}<span class="dim" style="font-size:20px"> из ${tot.total}</span></span></div>
      <div class="stat"><span class="dim cap">Опыт</span><span class="big-num ink">${L.fmtNum(xp)}</span></div>
      <div class="stat"><span class="dim cap">Видео</span><span class="big-num ink">${all.total}</span></div></div>
    <div class="grid-cards">
      <section class="card"><div class="h"><span class="ink">Прохождение программы</span><span class="grow"></span>${helpBtn('passage')}</div>
        ${lineChart({ points: pass.map((s) => ({ label: wk(s.week), value: s.pct })), height: 160, yMin: 0, yMax: 100, fmtV: (v) => v + '%' }) || `<p class="title2 ink">${esc(L.weekTitle(D, Math.max(cur, 0)))}: пройдено ${pass.length ? pass[pass.length - 1].done : 0} из ${pass.length ? pass[pass.length - 1].total : 0}</p>`}
</section>
      <section class="card"><div class="h"><span class="ink">Опыт</span><span class="grow"></span>${helpBtn('xp')}</div>
        ${lineChart({ points: xpS.map((p) => ({ label: p.date.slice(8, 10) + '.' + p.date.slice(5, 7), value: p.value })), height: 160, yMin: 0, fmtV: (v) => L.fmtNum(Math.round(v)) }) || `<p class="title2 ink">${L.fmtNum(xp)} опыта, уровень ${Lv}</p>`}</section></div>
    <section class="card"><div class="h"><span class="ink">Видео</span>${helpBtn('videoWeeks')}<span class="grow"></span><button class="btn sm pri" id="vAdd"><span class="onlime">Добавить видео</span></button></div>
      <div class="stack-s" style="gap:14px">${Object.entries(L.VIDEO_KINDS).map(([k, t]) => `<div class="prog-row"><div class="top"><span class="ink">${VIDEO_ICON[k]} ${t}</span><span class="vals dim">${all[k]}</span></div><div class="progress"><i style="width:${all.total ? Math.round(all[k] / Math.max(all.client, all.expert, all.life, 1) * 100) : 0}%"></i></div></div>`).join('')}</div>
      ${vw.length > 1 && all.total > 0 ? `<div>${barChart({ bars: vw.map((x) => ({ label: wk(x.week), value: x.total })), height: 120 })}</div>` : ''}
      ${withViews.length ? `<p class="ink">Лучшее видео: ${L.fmtNum(Math.max(...withViews.map((v) => v.views)))} просмотров, всего ${L.fmtNum(withViews.reduce((s, v) => s + v.views, 0))}</p>` : ''}
      <div class="h" style="margin-top:4px"><span class="ink">Мои видео</span></div>
      <div class="stack-s">${(showAll ? myVids : myVids.slice(0, 6)).map((v) => `<button class="row" data-vid="${v.id}" style="padding-right:20px"><span class="ico">${VIDEO_ICON[v.kind]}</span><span class="row-main"><span class="ink t">${L.VIDEO_KINDS[v.kind]}</span><span class="dim cap">${L.fmtDay(L.parseDay(v.logged_on))} · ${v.views != null ? 'просмотры ' + L.fmtNum(v.views) : 'добавить просмотры'}</span></span></button>`).join('') || '<p class="dim cap">Видео появятся здесь. Просмотры можно добавлять, когда они накопятся</p>'}${myVids.length > 6 && !showAll ? '<button class="btn sm" id="vAll"><span class="ink">Показать все</span></button>' : ''}</div></section>
    ${metrics.length ? `<div class="h"><span class="ink">Цифры</span></div><div class="grid-cards">${metrics.map((m) => { const { svg, ser, g } = metricChart(D, m, 130), last = ser.length ? ser[ser.length - 1].value : null, r = rows.find((x) => x.key === m.key);
      return `<button class="card mc" data-m="${m.key}"><span class="title2 ink">${esc(m.name)}</span>${svg}<p class="dim cap">Старт ${esc(fmtMetric(m, g.a))}, сейчас ${esc(fmtMetric(m, last ?? g.a))}${g.b != null ? ', цель ' + esc(fmtMetric(m, g.b)) : ''}${r && r.progress != null ? `. Пройдено ${Math.round(r.progress * 100)}% до цели` : ''}</p></button>`;
  }).join('')}</div>` : ''}
    ${achievementsHtml(D, 0)}</div>`;
  bindTopButton(root, 'topBtnP');

  root.addEventListener('click', (e) => {
    if (e.target.closest('#vAdd')) return openVideoSheet({ onSaved: () => state.app.refresh() });
    if (e.target.closest('#vAll')) { state.showAllVids = true; return state.app.refresh(); }
    const vr = e.target.closest('[data-vid]'); if (vr) return openVideoEdit(vr.dataset.vid, { onChanged: () => state.app.refresh() });
    const mc = e.target.closest('[data-m]'); if (mc) { state.app.go('path'); }
  });
}
