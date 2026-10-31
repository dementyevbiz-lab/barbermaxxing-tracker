// Админка: сводка «на что обратить внимание» по всем. Только правила и цифры, каждое замечание с данными и советом
import { esc, state } from '../core.js';
import * as L from '../logic.js';
import { A, summarize } from './common.js';
import { openCard } from './card.js';

export function insights() {
  const today = L.startOfDay(), rules = A.settings.admin_rules || {};
  const lowShare = rules.item_low_share ?? 0.5;
  const act = A.profiles.filter((p) => p.status === 'active' && p.start_date).map((p) => summarize(p, today));
  const out = [];

  // 1 и 2: пункты, которые не отметила большая часть тех, у кого неделя уже прошла
  for (const it of A.items.filter((i) => !i.deleted_at && i.active && i.required && L.CORE_KINDS.includes(i.kind) && !i.user_id)) {
    const who = act.filter((s) => (it.tariffs || []).includes(s.p.tariff?.code) && s.info.state !== 'before' && s.info.n >= it.week && (s.info.n > it.week || s.info.state === 'finished'));
    if (who.length < 2) continue;
    const notDone = who.filter((s) => !L.doneSets(s.D).done.has(it.id));
    if (notDone.length / who.length > lowShare) {
      const hw = it.kind === 'homework';
      out.push({ k: hw ? 'hw' : 'item', title: `${hw ? 'Домашка' : 'Пункт'} ${it.title} (неделя ${it.week}) почти не отмечается`, data: `Не отметили ${notDone.length} из ${who.length}: ${notDone.map((s) => s.p.display_name).join(', ')}`,
        advice: hw ? 'Проверьте, понятно ли задание, и напомните про домашку в общем чате' : 'Возможно, пункт трудно найти или он слишком большой. Напомните о нём или разбейте на части' });
    }
  }
  // 3: метрика не растёт у большинства за 2 замера
  for (const m of A.metrics.filter((x) => x.active)) {
    let n = 0, stuck = [];
    for (const s of act) {
      const ser = L.metricSeries(s.D, m.key); if (ser.length < 2) continue; n++;
      const a = ser[ser.length - 2].value, b = ser[ser.length - 1].value;
      if (m.better === 'down' ? b >= a : b <= a) stuck.push(s.p.display_name);
    }
    if (n >= 2 && stuck.length / n > 0.5) out.push({ k: 'metric', title: `${m.name}: не растёт у большинства`, data: `Не улучшилась за два последних замера у ${stuck.length} из ${n}: ${stuck.join(', ')}`, advice: 'Обсудите на общем эфире, что мешает именно в этой метрике' });
  }
  // 4: нет замера
  const late = act.filter((s) => s.cpState === 'overdue');
  if (late.length) out.push({ k: 'cp', title: 'Есть просроченные замеры', data: late.map((s) => `${s.p.display_name} (замер ${s.cp.idx}, срок ${L.fmtDayShort(L.parseDay(s.cp.due_date))})`).join('; '), advice: 'Напишите лично: без свежих цифр трекер не показывает движение' });
  // 5: давно не заходили
  const gone = act.filter((s) => s.inactive);
  if (gone.length) out.push({ k: 'seen', title: 'Давно не заходили', data: gone.map((s) => s.p.display_name).join(', '), advice: 'Спросите лично, всё ли в порядке и не мешает ли что-то' });
  // 6: направление видео почти никто не снимает
  const started = act.filter((s) => s.info.state === 'active' && L.diffDays(today, s.info.start) >= 14);
  if (started.length >= 2) for (const [k, t] of Object.entries(L.VIDEO_KINDS)) {
    const has = started.filter((s) => L.liveVideos(s.D).some((v) => v.kind === k && L.diffDays(today, L.parseDay(v.logged_on)) < 14)).length;
    if (has / started.length < 0.25) out.push({ k: 'video', title: `Направление ${t} почти никто не снимает`, data: `За 14 дней сняли ${has} из ${started.length}`, advice: 'Дайте пример такого видео или короткое задание на него' });
  }
  return { out, count: act.length };
}

export function renderSummary(root) {
  const { out, count } = insights();
  root.innerHTML = `<div class="stack"><div class="pagehead"><h1 class="h1s grow"><span class="ink">Сводка</span></h1></div>
    ${out.map((o) => `<div class="card"><span class="plate"><span class="onlime">${{ hw: 'Домашка', item: 'Программа', metric: 'Цифры', cp: 'Замеры', seen: 'Активность', video: 'Видео' }[o.k]}</span></span>
      <p class="title2 ink">${esc(o.title)}</p><p class="ink">${esc(o.data)}</p><p class="dim cap">Что можно сделать: ${esc(o.advice)}</p></div>`).join('')
      || `<div class="empty-note"><span class="dim">${count ? 'Замечаний нет. Пороги можно поменять в разделе Контент' : 'Пока нет учеников со стартом'}</span></div>`}
    ${count ? `<p class="dim cap">Считаются правилами по данным ${count} ${L.plural(count, 'ученика', 'учеников', 'учеников')} на сегодня</p>` : ''}</div>`;
}
