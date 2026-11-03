// Блок «Мой прогресс»: сколько пройдено, как менялись цифры, что дальше. Только факты по отметкам и замерам
import { esc } from './core.js';
import * as L from './logic.js';
import { fmtMetric, tri, helpBtn } from './ui.js';
import { lineChart } from './charts.js';

export function progressHtml(D, info, items, rows, order = 25) {
  const { done } = L.doneSets(D);
  const core = items.filter((i) => ['lesson', 'live', 'homework'].includes(i.kind) && i.required && !i.deleted_at);
  const dn = (a) => a.filter((i) => done.has(i.id)).length;
  const lessons = core.filter((i) => i.kind !== 'homework'), hw = core.filter((i) => i.kind === 'homework');
  const vids = L.liveVideos(D).length;
  const started = info.state === 'active' || info.state === 'finished';
  let main;
  if (core.length) {
    const pct = Math.round(dn(core) / core.length * 100);
    main = `<div class="prog-row"><div class="top"><span class="title2 ink">Пройдено ${dn(core)} из ${core.length}</span><span class="dim cap">${pct}%</span></div><div class="progress"><i style="width:${pct}%"></i></div>
      <span class="dim cap">Уроков и эфиров ${dn(lessons)} из ${lessons.length}${hw.length ? ` · домашек ${dn(hw)} из ${hw.length}` : ''}</span></div>`;
  } else if (started) {
    const pct = Math.round(info.n / info.weeks * 100);
    main = `<div class="prog-row"><div class="top"><span class="title2 ink">Неделя ${info.n} из ${info.weeks}</span><span class="dim cap">${pct}%</span></div><div class="progress"><i style="width:${pct}%"></i></div></div>`;
  } else main = `<p class="dim">Прогресс появится, когда начнётся программа</p>`;

  const ms = D.metrics.filter((m) => m.active && D.goals[m.key] && (D.goals[m.key].a != null || D.goals[m.key].b != null));
  const metrics = ms.map((m) => {
    const g = D.goals[m.key], r = rows.find((x) => x.key === m.key), cur = r && r.cur != null ? r.cur : null;
    const pct = r && r.progress != null ? Math.round(r.progress * 100) : 0;
    return `<div class="prog-row m"><div class="top"><span class="ink">${esc(m.name)}</span><span class="vals dim">${esc(fmtMetric(m, g.a))} ${tri()} <span class="ink">${esc(fmtMetric(m, cur ?? g.a))}</span> ${tri()} ${esc(fmtMetric(m, g.b))}</span></div><div class="progress"><i style="width:${pct}%"></i></div></div>`;
  }).join('');
  const next = (D.checkpoints || []).filter((c) => !c.submitted_at && c.idx > 0).sort((a, b) => a.idx - b.idx)[0];
  const hint = !rows.some((r) => r.progress != null) && next ? `<p class="dim cap">Первый замер до ${L.fmtDay(L.parseDay(next.due_date))}: после него здесь появится движение цифр</p>` : '';

  return `<section class="card" style="order:${order}"><div class="h"><span class="ink">Мой прогресс</span></div>${main}${metrics ? `<div class="stack-s" style="gap:14px">${metrics}</div>` : ''}${hint}
    ${vids ? `<div class="kv"><span class="dim">Снято видео</span><span class="ink">${vids}</span></div>` : ''}</section>`;
}

// Ачивки: награды за активность, открываются по очереди. Отдельный блок, не задания программы
export function achievementsHtml(D, order = 28) {
  const names = D.settings?.tier_names || ['Бронза', 'Серебро', 'Золото', 'Платина'];
  const { open, locked } = L.achievementView(D);
  const list = open.filter((x) => !x.complete).sort((a, b) => b.ratio - a.ratio || a.ord - b.ord).slice(0, 3);
  if (!list.length) return '';
  return `<section class="card" style="order:${order}"><div class="h"><span class="ink">Ачивки</span>${helpBtn('ach')}<span class="grow"></span><span class="plate"><span class="onlime">Награды</span></span></div>
    ${locked ? `<p class="dim cap">Закрыто ещё ${locked}</p>` : ''}
    <div class="stack-s">${list.map((x) => `<div class="ach-row"><span class="ico" aria-hidden="true">🏅</span><div class="grow"><div class="top" style="display:flex;justify-content:space-between;gap:10px"><span class="ink">${esc(x.a.name)}</span><span class="vals dim">${esc(names[x.next.tier - 1] || '')}: ${x.value} из ${x.thr || '—'}</span></div><div class="progress"><i style="width:${Math.round(x.ratio * 100)}%"></i></div></div></div>`).join('')}</div></section>`;
}

// Компактный прогресс на главной: сколько пройдено и как менялось по неделям. Подробности на вкладке «Прогресс»
export function progressMiniHtml(D, info, order = 55) {
  const tot = L.requiredTotals(D, info), pass = L.passageSeries(D, info);
  const pts = pass.map((s) => ({ label: s.week === 0 ? 'М0' : String(s.week), value: s.pct }));
  return `<section class="card" style="order:${order}"><div class="h"><span class="ink">Прогресс</span>${helpBtn('miniProg')}<span class="grow"></span><button class="btn sm" data-go-progress><span class="ink">Подробнее</span></button></div>
    <p class="title2 ink">Пройдено ${tot.done} из ${tot.total}</p>
    ${pts.filter((x) => x.value != null).length > 1 ? lineChart({ points: pts, height: 110, yMin: 0, yMax: 100, fmtV: (v) => v + '%' }) : ''}</section>`;
}
