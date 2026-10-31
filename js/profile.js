// Вкладка «Профиль»
import { $, esc, state, openSheet, closeSheet, toast, tg, haptic } from './core.js';
import * as L from './logic.js';
import * as data from './data.js';

export function renderProfile(root) {
  const D = state.D, info = L.weekInfo(D.profile, D.profile.tariff, L.startOfDay());
  const t = D.profile.tariff || {}, prefs = D.profile.prefs || {};
  const xp = data.xpNow(), step = data.lvlStep(), Lv = L.levelOf(xp, step), ranks = [...data.ranksList()].sort((a, b) => a.level - b.level);
  const base = L.levelBase(Lv, step), next = L.levelBase(Lv + 1, step), cur = L.rankOf(Lv, ranks);
  const tierNames = D.settings.tier_names || ['Бронза', 'Серебро', 'Золото', 'Платина'];
  const achs = L.achievementProgress(D).filter((x) => !x.secret || x.got.length);
  const finalSent = D.checkpoints.some((c) => c.kind === 'final' && c.submitted_at);
  const pdfOpen = info.state === 'finished' || (info.state === 'active' && info.n === info.weeks) || finalSent;
  const calls = D.calls.filter((c) => c.scheduled_at).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  const incl = [t.calls_included ? `Созвон: ${t.calls_included}` : '', t.strategy_sessions ? `Стратегические сессии: ${t.strategy_sessions}` : '', t.city_strategy_sessions ? `Стратегия под город: ${t.city_strategy_sessions}` : ''].filter(Boolean);
  const support = t.support && D.settings.support_chat_url && !D.profile.ui_overrides?.hide?.includes('support') ? D.settings.support_chat_url : '';
  const CK = { call: 'Созвон', strategy: 'Стратегическая сессия', city_strategy: 'Стратегия под город', bonus: 'Дополнительный созвон' };

  root.innerHTML = `<div class="stack"><div class="pagehead"><h1 class="h1s grow"><span class="ink">Профиль</span></h1></div>
    <div class="grid-cards"><section class="card"><div class="hdr"><div class="lvl"><span class="onlime">${Lv}</span></div>
        <div class="hdr-mid"><div class="rank"><span class="ink">${esc(cur)}</span></div><div class="xpbar"><i style="width:${Math.max(2, Math.min(100, (xp - base) / (next - base) * 100))}%"></i></div></div></div>
      <div class="kv"><span class="dim">Опыт</span><span class="ink">${L.fmtNum(xp)}</span></div>
      <div class="kv"><span class="dim">До ${Lv + 1}-го уровня</span><span class="ink">${L.fmtNum(next - xp)}</span></div>
      <p class="dim cap">${esc(D.profile.display_name)}${D.profile.tg_username ? ' · @' + esc(D.profile.tg_username) : ''}</p></section>
    <section class="card"><div class="h"><span class="ink">Звания</span></div><div class="ladder">${ranks.map((r, i) => {
      const nextL = ranks[i + 1]?.level ?? Infinity, on = Lv >= r.level && Lv < nextL;
      return `<div class="rk ${on ? 'on' : Lv < r.level ? 'off' : ''}"><span class="lv ${on ? 'onlime' : 'ink'}">${r.level}</span><span class="${on ? 'onlime' : 'ink'}">${esc(r.name)}</span></div>`; }).join('')}</div></section></div>
    ${achs.length ? `<section class="card"><div class="h"><span class="ink">Ачивки</span></div><div class="stack-s">${achs.map((x) => `<div class="ach"><div class="grow"><span class="title2 ink">${esc(x.a.name)}</span>
        <div class="dim cap">${x.top ? 'Сейчас: ' + esc(tierNames[x.top - 1] || '') : 'Пока не открыта'}${x.next ? ` · до ступени «${esc(tierNames[x.next.tier - 1] || '')}»: ${x.value} из ${x.thr || '—'}` : ' · все ступени пройдены'}</div>
        ${x.next ? `<div class="progress" style="margin-top:8px"><i style="width:${Math.round(x.ratio * 100)}%"></i></div>` : ''}
        <div class="tiers">${x.a.tiers.map((tr) => `<i class="${x.got.includes(tr.tier) ? 'on' : ''}"></i>`).join('')}</div></div></div>`).join('')}</div></section>` : ''}
    <section class="card"><div class="h"><span class="ink">Тариф</span></div><p class="title2 ink">${esc(t.name || '')}</p>
      <p class="dim cap">${t.weeks} ${L.plural(t.weeks, 'неделя', 'недели', 'недель')}${D.profile.start_date ? ' · старт ' + L.fmtDay(L.parseDay(D.profile.start_date)) : ''}</p>
      ${incl.map((x) => `<div class="kv"><span class="ink">${esc(x)}</span></div>`).join('')}
      ${calls.map((c) => { const d = new Date(c.scheduled_at); return `<div class="kv"><span class="ink">${esc(CK[c.kind] || 'Созвон')}</span><span class="dim">${L.fmtDay(d)}, ${L.fmtTime(d)}</span></div>`; }).join('')}
      ${support ? '<button class="btn pri" id="supportBtn" style="align-self:flex-start"><span class="onlime">Чат сопровождения</span></button>' : ''}</section>
    <section class="card"><div class="h"><span class="ink">Итог программы</span></div>
      <p class="dim cap">${pdfOpen ? 'Один лист с твоим путём, скриншотами и цифрами' : 'Откроется на последней неделе программы'}</p>
      <button class="btn pri" id="pdfBtn" style="align-self:flex-start" ${pdfOpen ? '' : 'disabled'}><span class="onlime">Итог программы (PDF)</span></button></section>
    <section class="card"><div class="h"><span class="ink">Настройки</span></div>
      <div class="row static"><span class="row-main"><span class="ink t">Уведомления от бота</span><span class="dim cap">Сроки замеров и даты созвонов</span></span><button class="toggle ${prefs.notifications === false ? '' : 'on'}" id="notifT" aria-label="Уведомления"></button></div>
      <div class="row static"><span class="row-main"><span class="ink t">Валюта среднего чека</span></span><div class="btns"><button class="btn sm ${prefs.currency === 'KZT' ? '' : 'pri'}" data-cur="RUB"><span class="${prefs.currency === 'KZT' ? 'ink' : 'onlime'}">₽</span></button><button class="btn sm ${prefs.currency === 'KZT' ? 'pri' : ''}" data-cur="KZT"><span class="${prefs.currency === 'KZT' ? 'onlime' : 'ink'}">₸</span></button></div></div>
      <button class="row" id="trashBtn"><span class="row-main"><span class="ink t">Корзина</span></span></button></section></div>`;

  if (support) $('#supportBtn', root).onclick = () => { try { (tg && support.includes('t.me') && tg.openTelegramLink) ? tg.openTelegramLink(support) : window.open(support, '_blank'); } catch (e) { window.open(support, '_blank'); } };
  $('#pdfBtn', root).onclick = async (e) => {
    if (e.currentTarget.disabled) return;
    toast('Собираем PDF…');
    try { const m = await import('./pdf.js'); await m.makeSummaryPdf(); } catch (err) { console.warn(err); toast('Не получилось собрать PDF'); }
  };
  $('#notifT', root).onclick = async (e) => { const on = !e.currentTarget.classList.contains('on'); e.currentTarget.classList.toggle('on', on); await data.setPrefs({ notifications: on }); toast(on ? 'Уведомления включены' : 'Уведомления выключены'); };
  root.querySelectorAll('[data-cur]').forEach((b) => b.onclick = async () => { await data.setPrefs({ currency: b.dataset.cur }); state.app.refresh(); });
  $('#trashBtn', root).onclick = trash;

  function trash() {
    const rows = () => [
      ...D.insights.filter((i) => i.deleted_at).map((i) => ({ k: 'ins', id: i.id, t: 'Вывод', s: i.title || i.body, at: i.deleted_at })),
      ...D.questions.filter((q) => q.deleted_at).map((q) => ({ k: 'q', id: q.id, t: 'Вопрос', s: q.body, at: q.deleted_at })),
      ...D.screenshots.filter((s) => s.deleted_at).map((s) => ({ k: 'sh', id: s.id, t: 'Скриншот', s: s.kind, at: s.deleted_at })),
      ...D.videos.filter((v) => v.undone_at).map((v) => ({ k: 'v', id: v.id, t: 'Видео', s: L.VIDEO_KINDS[v.kind] + ' · ' + L.fmtDay(L.parseDay(v.logged_on)), at: v.undone_at })),
    ].sort((a, b) => b.at.localeCompare(a.at));
    const html = () => `<h2 class="sh-title"><span class="ink">Корзина</span></h2>${rows().map((r) => `<div class="kv" data-k="${r.k}" data-id="${r.id}"><span class="grow" style="min-width:0"><span class="dim cap">${r.t}</span><br><span class="ink">${esc(String(r.s).slice(0, 80))}</span></span><button class="btn sm" data-back><span class="ink">Вернуть</span></button></div>`).join('') || '<p class="dim">Пусто</p>'}`;
    const mount = (sh) => sh.querySelectorAll('[data-back]').forEach((b) => b.onclick = async () => {
      const { k, id } = b.closest('[data-id]').dataset;
      if (k === 'ins') await data.setInsightDeleted(id, false); else if (k === 'q') await data.updateQuestion(id, { deleted_at: null });
      else if (k === 'sh') await data.setScreenshotDeleted(id, false); else await data.setVideoUndone(id, false);
      toast('Возвращено'); haptic(); import('./core.js').then((c) => c.setSheet(html(), mount));
    });
    openSheet(html(), mount);
  }
}
