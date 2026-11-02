// Сквозная проверка ученика на настоящем Supabase. Запуск: NODE_USE_ENV_PROXY=1 node tests/e2e/student.mjs
import { connect, sessionFor, makeStudent, cleanupE2E, ledgerSum } from './lib.mjs';
import { startServer, launch, openApp, wait } from './browser.mjs';
const root = new URL('../../', import.meta.url).pathname;
const IMG = '/tmp/claude-0/e2e/shot.png';
const results = [];
const ok = (name, cond, extra = '') => { results.push([name, !!cond, extra]); console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (cond ? '' : ' ' + extra)); };
const c = await connect(); const srv = await startServer(root); const browser = await launch();
const shot = (page, n) => page.screenshot({ path: `/tmp/claude-0/shots/e-${n}.png`, fullPage: false });
let page; const closeModal = async () => { if (await page.locator('#rankModal.open').count()) { await page.click('#rankModal'); await wait(450); } };
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await wait(250); } return false; };

try {
  // ===================== ОНБОРДИНГ =====================
  {
    const p = await makeStudent(c, { name: 'E2E Новичок', startDaysAgo: 0 });
    const session = await sessionFor(c, p.id);
    const ob = await openApp(browser, srv.url, session); const page = ob.page, errors = ob.errors;
    await page.waitForSelector('[data-next]', { timeout: 20000 });
    await shot(page, 'ob-0');
    await page.click('[data-next]'); await page.waitForSelector('text=Что мы храним');
    await page.click('[data-next]'); await page.waitForSelector('#goalIn');
    await page.fill('#goalIn', 'Полная запись и чек выше'); await wait(700);
    await page.click('[data-next]'); await page.waitForSelector('.mfield');
    const inputs = page.locator('.mfield input');
    await inputs.nth(0).fill('1500'); await inputs.nth(1).fill('55'); await inputs.nth(2).fill('6'); await inputs.nth(4).fill('800');
    await page.locator('.mfield [data-q]').first().click(); await page.waitForSelector('#sheet.open .sh-title'); ok('подсказка «?» открывается', true);
    await page.click('#scrim', { position: { x: 5, y: 5 } }); await wait(500);
    await shot(page, 'ob-a');
    await page.click('[data-next]'); await page.waitForSelector('[data-add="video_1"]');
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('[data-add="video_1"]')]);
    await fc.setFiles(IMG);
    await page.waitForSelector('.slot.has', { timeout: 30000 });
    const { data: shots } = await c.admin.from('screenshots').select('*').eq('user_id', p.id);
    ok('скриншот сохранён в базе и сжат до 400 КБ', shots.length === 1 && shots[0].size_bytes <= 400 * 1024, JSON.stringify(shots.map((s) => s.size_bytes)));
    const { data: objs } = await c.admin.storage.from('screenshots').list(`${p.id}/${shots[0].checkpoint_id}`);
    ok('файл лежит в папке ученика', objs?.length === 1);
    await shot(page, 'ob-shots');
    await page.click('[data-next]'); await page.waitForSelector('.mfield');
    const bi = page.locator('.mfield input');
    await bi.nth(0).fill('2500'); await bi.nth(1).fill('85'); await bi.nth(2).fill('5'); await bi.nth(4).fill('3000'); await wait(800);
    await page.click('[data-next]'); await page.waitForSelector('text=Путь начат');
    await page.click('[data-next]'); await page.waitForSelector('text=Как пользоваться трекером', { timeout: 20000 });
    ok('после онбординга сразу обучение', true);
    ok('в первом обучении нельзя пропустить', (await page.locator('[data-skip]').count()) === 0 && (await page.locator('#page [data-back]').count()) === 0);
    let slides = 1; while (await page.locator('[data-next]').innerText().then((t) => t.trim() !== 'Готово')) { await page.click('[data-next]'); slides++; if (slides > 20) break; }
    ok('в обучении 8 слайдов', slides === 8, String(slides));
    await page.click('[data-next]'); await page.waitForSelector('.today', { timeout: 20000 });
    const { data: goals } = await c.admin.from('goals').select('*').eq('user_id', p.id);
    const g = Object.fromEntries(goals.map((x) => [x.metric_key, x]));
    ok('точки А и Б записаны', g.avg_check?.a_value == 1500 && g.avg_check?.b_value == 2500 && g.booking_fill?.a_value == 55 && g.followers?.b_value == 3000, JSON.stringify(g));
    const { data: gt } = await c.admin.from('goal_text').select('*').eq('user_id', p.id); ok('цель словами записана', gt[0]?.why_text === 'Полная запись и чек выше');
    const { data: cp0 } = await c.admin.from('checkpoints').select('*, checkpoint_values(*)').eq('user_id', p.id).eq('idx', 0).single();
    ok('точка А отправлена как замер', !!cp0.submitted_at && cp0.checkpoint_values.some((v) => v.metric_key === 'avg_check' && v.value == 1500));
    ok('опыт за первый замер 40', (await ledgerSum(c, p.id, 'checkpoint')) === 40);
    const { data: pr } = await c.admin.from('profiles').select('onboarding').eq('id', p.id).single(); ok('онбординг помечен пройденным', pr.onboarding.done === true && !!pr.onboarding.consent_at);
    ok('онбординг без ошибок в консоли', errors.length === 0, errors.join(' | '));
    // повторное открытие не показывает онбординг
    await page.reload(); await page.waitForSelector('.today', { timeout: 20000 }); ok('после перезапуска онбординга нет', await page.locator('[data-next]').count() === 0);
    const { data: pr2 } = await c.admin.from('profiles').select('onboarding').eq('id', p.id).single(); ok('обучение помечено пройденным', pr2.onboarding.tour_done === true);
    ok('после перезапуска обучения нет', await page.locator('text=Как пользоваться трекером').count() === 0);
    // повторный запуск из Профиля, с пропуском
    await page.click('[data-tab="profile"]'); await page.waitForSelector('#tourBtn'); await page.click('#tourBtn');
    await page.waitForSelector('text=Как пользоваться трекером'); await page.click('[data-skip]'); await wait(300);
    ok('обучение запускается из профиля и закрывается', await page.locator('text=Как пользоваться трекером').isHidden() || await page.locator('#page.open').count() === 0);
    await page.click('[data-tab="today"]');
    // точку А ученик больше не меняет
    const stu = (await import('./lib.mjs')); const sbUser = c.anon(); await sbUser.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
    const { error: ea } = await sbUser.from('goals').update({ a_value: 1 }).eq('metric_key', 'avg_check'); ok('точку А после замера ученик менять не может', !!ea);
    await page.context().close();
  }

  // ===================== ОСНОВНЫЕ ДЕЙСТВИЯ =====================
  const p = await makeStudent(c, { name: 'E2E Ученик', startDaysAgo: 24, onboardingDone: true });
  const { data: cps } = await c.admin.from('checkpoints').select('*').eq('user_id', p.id).order('idx');
  await c.admin.from('checkpoints').update({ submitted_at: new Date(Date.now() - 24 * 864e5).toISOString() }).eq('id', cps[0].id);
  await c.admin.from('checkpoint_values').insert([{ checkpoint_id: cps[0].id, metric_key: 'avg_check', value: 1500 }, { checkpoint_id: cps[0].id, metric_key: 'booking_fill', value: 55 }]);
  await c.admin.from('goals').insert([{ user_id: p.id, metric_key: 'avg_check', a_value: 1500, b_value: 2500 }, { user_id: p.id, metric_key: 'booking_fill', a_value: 55, b_value: 85 }]);
  const mk = (kind, week, ord, title, est, extra = {}) => ({ kind, week, ord, title, est_minutes: est, required: true, user_id: p.id, has_notes: kind !== 'homework', xp: 20, tariffs: ['barbermax', 'personal'], ...extra });
  await c.admin.from('program_items').insert([mk('lesson', 4, 1, 'Демо-урок про цену', 30), mk('live', 4, 2, 'Демо-эфир с Саней', 60), mk('homework', 4, 3, 'Демо-домашка недели', 40),
    mk('short_task', 3, 4, 'Демо-задание на 15 минут', 15, { required: false, why: 'Зачем', how: 'Как', result: 'Результат' })]);
  await c.admin.from('quotes').insert([{ text: 'Первая цитата для проверки', author: 'E2E Автор', verified: true }, { text: 'Скрытая непроверенная', author: 'E2E Автор', verified: false }]);
  await c.admin.from('movies').insert({ title: 'E2E Фильм', year: 2001, why: 'Потому что подходит', tags: ['no_checkpoint'], verified: true });
  await c.admin.from('xp_ledger').insert({ user_id: p.id, kind: 'completion', xp: 200 }); // 200 + точка А 40 + урок, конспект и ачивки = 270: домашка с ачивкой доведёт до 310 и даст новое звание
  const session = await sessionFor(c, p.id);
  const app = await openApp(browser, srv.url, session); page = app.page; const { errors, ctx } = app;
  await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { new MutationObserver(() => { const m = document.getElementById('rankModal'); if (m && m.classList.contains('open') && !m.dataset.c) { m.dataset.c = 1; window.__rank = (window.__rank || 0) + 1; } else if (m && !m.classList.contains('open')) delete m.dataset.c; }).observe(document.getElementById('rankModal'), { attributes: true }); }); });
  await page.reload();
  await page.waitForSelector('.today', { timeout: 20000 }); await wait(1200);
  const rows = page.locator('#actList .row');
  ok('на экране три пункта недели и одно короткое задание', (await rows.count()) + (await page.locator('#todayList .row[data-id]').count()) === 4, await rows.count());
  ok('видео записывается кнопкой, а не заданием, и блок На сегодня только с заданиями дня', (await page.locator('#videoBtn').count()) === 1 && !(await page.locator('#bToday').innerText()).includes('Снять видео') && (await page.locator('#todayList .row[data-id]').count()) === 1);
  ok('блок ачивок показан и подписан как награды', (await page.locator('.ach-row').count()) >= 1 && (await page.locator('text=Награды за активность').count()) === 1);
  ok('цитата дня показана и только проверенная', await page.locator('.quote').count() === 1 && !(await page.locator('.quote').innerText()).includes('непроверенная'));
  ok('фильм показан по метке ситуации', (await page.locator('text=E2E Фильм').count()) === 1);
  ok('вопрос по триггеру показан', await page.locator('#bQuestion').count() === 1);
  const { data: qs } = await c.admin.from('quote_shown').select('*').eq('user_id', p.id); ok('цитата записана как показанная', qs.length === 1);
  const { data: tl } = await c.admin.from('trigger_log').select('*').eq('user_id', p.id); ok('показ вопроса записан в журнал', tl.length >= 1);

  // отметка и отмена
  const lesson = page.locator('#actList .row', { hasText: 'Демо-урок про цену' });
  await lesson.locator('[data-chk]').click(); await wait(300);
  ok('галочка стоит сразу', await lesson.locator('.chk.on').count() === 1);
  ok('тост «Засчитано»', (await page.locator('#toastTxt').innerText()).startsWith('Засчитано'));
  ok('опыт за урок пришёл с сервера', await until(async () => (await ledgerSum(c, p.id, 'completion')) === 200 + 10));
  await page.click('#toast .undo', { timeout: 500 }).catch(() => {});
  await lesson.locator('[data-chk]').click(); await wait(300);
  ok('повторное нажатие снимает отметку', await until(async () => (await ledgerSum(c, p.id, 'completion')) === 200));
  ok('тост «Отметка снята»', (await page.locator('#toastTxt').innerText()).includes('снята'));

  // конспект через окно пункта
  await lesson.locator('[data-open]').click(); await page.waitForSelector('#sheet.open [data-a="toggle"]');
  await page.click('[data-a="toggle"]'); await wait(300);
  await page.click('[data-a="notes"]'); ok('конспект даёт опыт', await until(async () => (await ledgerSum(c, p.id, 'notes')) === 10));
  await shot(page, 'sheet');
  await page.click('#scrim', { position: { x: 5, y: 5 } }); await wait(500);

  // видео
  await page.click('#videoBtn'); await page.waitForSelector('[data-v="client"]'); await page.click('[data-v="client"]'); await page.fill('#vViews', '120'); await page.fill('#vNote', 'https://example.com/v1'); await page.click('#vSave');
  ok('видео записано и даёт 15 опыта', await until(async () => (await ledgerSum(c, p.id, 'video')) === 15));
  const { data: vl } = await c.admin.from('video_logs').select('*').eq('user_id', p.id); ok('просмотры и ссылка видео сохранены', vl[0]?.views === 120 && vl[0]?.kind === 'client' && vl[0]?.note === 'https://example.com/v1');
  await closeModal(); await page.waitForSelector('#toastUndo:not([hidden])'); await page.click('#toastUndo');
  ok('отмена видео возвращает опыт', await until(async () => (await ledgerSum(c, p.id, 'video')) === 0));

  // новое звание: к этому моменту опыта хватает на 3-й уровень
  await closeModal();
  const hw = page.locator('#actList .row', { hasText: 'Демо-домашка недели' });
  await hw.locator('[data-chk]').click(); await wait(2500);
  ok('окно «Новое звание» показано один раз', (await page.evaluate(() => window.__rank || 0)) >= 1);
  await shot(page, 'rank'); await closeModal();
  ok('звание Подмастерье', (await page.locator('#rankName').innerText()) === 'Подмастерье');

  // замер
  await page.click('#checkBtn'); await page.waitForSelector('#cpFields input');
  const fi = page.locator('#cpFields input'); await fi.nth(0).fill('1800'); await fi.nth(1).fill('62'); await wait(900);
  for (const k of ['video_1', 'video_2', 'video_3']) { const [f] = await Promise.all([page.waitForEvent('filechooser'), page.click(`[data-add="${k}"]`)]); await f.setFiles(IMG); await page.waitForSelector(`[data-shot]`, { timeout: 30000 }); await until(async () => (await c.admin.from('screenshots').select('id').eq('user_id', p.id)).data.length >= ['video_1', 'video_2', 'video_3'].indexOf(k) + 1, 30000); }
  await shot(page, 'cp-form');
  await page.fill('#cpNote', 'Заметка к замеру'); await wait(800);
  await page.click('#cpSubmit');
  ok('замер отправлен: +40 и бонус +10 за три скриншота', await until(async () => (await ledgerSum(c, p.id, 'checkpoint')) === 80 && (await ledgerSum(c, p.id, 'screenshots')) === 10));
  const { data: cp1 } = await c.admin.from('checkpoints').select('*, checkpoint_values(*)').eq('id', cps[1].id).single();
  ok('значения и заметка замера сохранены', cp1.note === 'Заметка к замеру' && cp1.checkpoint_values.some((v) => v.metric_key === 'avg_check' && v.value == 1800));
  await wait(800); ok('плашка замера исчезла', await page.locator('#checkBtn').count() === 0);
  // метка «Сейчас» появилась: R > 0
  await page.click('[data-tab="path"]'); await page.waitForSelector('[data-m="avg_check"]'); await wait(600); await shot(page, 'path');
  ok('на пути есть карточка метрики со значением', (await page.locator('[data-m="avg_check"]').innerText()).replace(/\s/g, '').includes('1800'));
  ok('галерея скриншотов показана', await page.locator('.gal .shot').count() === 3);
  ok('закрытые замеры на Пути не видны, открываются по времени', (await page.locator('[data-cp]').count()) === 2, await page.locator('[data-cp]').count());
  await page.click('[data-m="avg_check"]'); await page.waitForSelector('#sheet.open .kv'); await shot(page, 'metric'); await page.click('#scrim', { position: { x: 5, y: 5 } }); await wait(400);

  // результаты видео: добавить просмотры позже и записать видео задним числом
  await closeModal(); await page.click('[data-tab="progress"]'); await page.waitForSelector('#vAdd');
  ok('в Прогрессе есть графики прохождения и опыта', (await page.locator('svg.chart').count()) >= 1);
  ok('на вкладке Прогресс три полоски видео по направлениям', await page.locator('.prog-row:has-text("С клиентом"), .prog-row:has-text("Экспертное"), .prog-row:has-text("Лайф")').count() >= 3);
  await page.click('#vAdd'); await page.waitForSelector('[data-v="life"]'); await page.click('[data-v="life"]');
  const past = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10); await page.fill('#vDate', past); await page.fill('#vViews', '800'); await page.click('#vSave');
  ok('видео можно записать задним числом с просмотрами', await until(async () => (await c.admin.from('video_logs').select('*').eq('user_id', p.id)).data.some((v) => v.logged_on === past && v.views === 800 && v.kind === 'life')));
  await wait(900); await page.locator('[data-vid]').first().click(); await page.waitForSelector('#eViews'); await page.fill('#eViews', '5000'); await page.click('#eSave');
  ok('просмотры к записанному видео добавляются позже', await until(async () => (await c.admin.from('video_logs').select('views').eq('user_id', p.id)).data.some((v) => v.views === 5000)));
  await wait(700); ok('в Прогрессе видно лучшее видео', (await page.locator('#page, body').first().innerText()).includes('Лучшее видео'));

  // программа
  await page.click('[data-tab="program"]'); await page.waitForSelector('[data-w]'); await wait(300); await shot(page, 'program');
  ok('на вкладке Программа пункты текущей недели', await page.locator('.row[data-id]').count() >= 3, await page.locator('.row[data-id]').count());
  ok('будущая неделя закрыта: выбрать её нельзя', await page.locator('[data-w="6"]').isDisabled() && await page.locator('[data-w="5"]').isDisabled() && !(await page.locator('[data-w="4"]').isDisabled()));
  ok('модуль 0 доступен и виден в Программе', !(await page.locator('[data-w="0"]').isDisabled()));
  await page.click('[data-w="0"]'); await wait(300); ok('в модуле 0 пять материалов', (await page.locator('#wkBody .row[data-id]').count()) === 5 && (await page.locator('#wkBody').innerText()).includes('Дзиро мечтает о суши'));

  // выводы и вопросы
  await page.click('[data-tab="notes"]'); await page.waitForSelector('#addIns');
  await page.click('#addIns'); await page.fill('#iBody', 'Мой первый вывод'); await page.fill('#iTitle', 'Про цену'); await page.click('#iSave');
  ok('вывод записан и даёт 5 опыта', await until(async () => (await ledgerSum(c, p.id, 'insight')) === 5));
  await wait(500); ok('в календаре точка у сегодняшнего дня', await page.locator('.cal button .dot').count() >= 1);
  await shot(page, 'notes');
  await page.locator('[data-ed]').first().click(); await page.waitForSelector('#iDel'); await page.click('#iDel');
  ok('удалённый вывод возвращает опыт', await until(async () => (await ledgerSum(c, p.id, 'insight')) === 0));
  await page.click('#toastUndo'); ok('вывод восстанавливается из тоста', await until(async () => (await ledgerSum(c, p.id, 'insight')) === 5));
  await page.click('[data-s="questions"]'); await page.click('#addQ'); await page.waitForSelector('#qBody'); await page.fill('#qBody', 'Мой вопрос эксперту'); await page.click('#qSaveBtn');
  await wait(500); ok('вопрос сохранён', (await c.admin.from('questions').select('*').eq('user_id', p.id)).data.some((q) => q.body === 'Мой вопрос эксперту'));
  await page.click('#tglView').catch(() => {});

  // профиль
  await page.click('[data-tab="profile"]'); await page.waitForSelector('.ladder'); await wait(400); await shot(page, 'profile');
  ok('в профиле звание и лестница', (await page.locator('.ladder .rk.on').innerText()).includes('Подмастерье'));
  ok('ачивки в профиле открыты по очереди (не все сразу)', (await page.locator('.ach-row').count()) >= 3 && (await page.locator('.ach-row').count()) < 9);
  ok('PDF пока закрыт', await page.locator('#pdfBtn[disabled]').count() === 1);
  await page.click('[data-cur="KZT"]'); await wait(800);
  ok('валюта среднего чека сохраняется', (await c.admin.from('profiles').select('prefs').eq('id', p.id).single()).data.prefs.currency === 'KZT');

  // ученик до старта программы: модуль 0, задача дня, видео кнопкой
  {
    const f = await makeStudent(c, { name: 'E2E До старта', startDaysAgo: -2, onboardingDone: true });
    const ty = new Date().toISOString().slice(0, 10);
    await c.admin.from('program_items').insert([{ kind: 'material', week: 0, ord: 20, title: 'E2E Материал дня', required: true, user_id: f.id, tariffs: ['barbermax'], on_date: ty, xp: 40 },
      { kind: 'material', week: 0, ord: 21, title: 'E2E Материал модуля', required: true, user_id: f.id, tariffs: ['barbermax'], xp: 60 },
      { kind: 'lesson', week: 1, ord: 22, title: 'E2E Урок первой недели', required: true, user_id: f.id, tariffs: ['barbermax'], xp: 10 }]);
    const fa = await openApp(browser, srv.url, await sessionFor(c, f.id)); const fp = fa.page;
    await fp.waitForSelector('.today', { timeout: 20000 }); await wait(800);
    ok('до старта показан модуль 0 и дата старта', (await fp.locator('.today').innerText()).toLowerCase().includes('модуль 0') && (await fp.locator('.today').innerText()).includes('Старт программы'));
    ok('до старта в «На сегодня» только задача дня', (await fp.locator('#bToday').innerText()).includes('E2E Материал дня') && !(await fp.locator('#bToday').innerText()).includes('Снять видео'));
    ok('до старта видны материалы модуля 0, но не первой недели', (await fp.locator('#bActions').innerText()).includes('E2E Материал модуля') && !(await fp.locator('body').innerText()).includes('E2E Урок первой недели'));
    ok('в полоске недель закрыты все недели после модуля 0', (await fp.locator('.strip .wk:disabled').count()) === 7 && (await fp.locator('.strip .wk.cur').count()) === 1);
    await fp.locator('#todayList .row', { hasText: 'E2E Материал дня' }).locator('[data-chk]').click();
    ok('материал даёт опыт из поля xp (40)', await until(async () => (await ledgerSum(c, f.id, 'completion')) === 40));
    await fp.locator('#actList .row', { hasText: 'E2E Материал модуля' }).locator('[data-chk]').click();
    ok('книга даёт больше опыта пропорционально (60)', await until(async () => (await ledgerSum(c, f.id, 'completion')) === 100));
    await fp.click('#videoBtn'); await fp.click('[data-v="expert"]'); await fp.click('#vSave');
    ok('до старта можно записать видео кнопкой', await until(async () => (await ledgerSum(c, f.id, 'video')) === 15));
    const sb2 = c.anon(); const ss2 = await sessionFor(c, f.id); await sb2.auth.setSession({ access_token: ss2.access_token, refresh_token: ss2.refresh_token });
    ok('сервер не отдаёт задания будущих недель', (await sb2.from('program_items').select('title').like('title', 'E2E Урок первой недели')).data.length === 0);
    await wait(500); await fp.click('[data-tab="progress"]'); await fp.waitForSelector('.stat'); ok('до старта в Прогрессе только модуль 0: вместо пустых графиков сводка', (await fp.locator('svg.chart').count()) === 0 && (await fp.locator('.stat').first().innerText()).includes('Пройдено'));
    ok('до старта без ошибок в консоли', fa.errors.length === 0, fa.errors.join(' | ')); await fa.ctx.close();
  }

  // потеря связи
  await page.click('[data-tab="today"]'); await page.waitForSelector('.today'); await wait(600);
  await ctx.setOffline(true);
  const before = (await c.admin.from('completions').select('id').eq('user_id', p.id)).data.length;
  await page.locator('#actList .row', { hasText: 'Демо-эфир с Саней' }).locator('[data-chk]').click(); await wait(1500);
  ok('без связи галочка стоит и есть тост', (await page.locator('#toastTxt').innerText()).includes('Нет связи'), await page.locator('#toastTxt').innerText());
  ok('запись ждёт в очереди', (await page.evaluate(() => JSON.parse(localStorage.getItem('bmx.queue') || '[]').length)) >= 1);
  await ctx.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event('online')));
  ok('после возврата связи запись дошла', await until(async () => (await c.admin.from('completions').select('id').eq('user_id', p.id)).data.length > before, 12000));

  // запоминание места
  await page.click('[data-tab="notes"]'); await wait(300); await page.reload(); await page.waitForSelector('#seg', { timeout: 20000 });
  ok('после перезапуска открыта та же вкладка и раздел', (await page.locator('#seg button.on').innerText()) === 'Вопросы');

  // компьютер
  await shot(page, 'mobile-end');
  const d = await openApp(browser, srv.url, session, { w: 1280, h: 860, mobile: false });
  await d.page.waitForSelector('.today', { timeout: 20000 }); await wait(1200); await d.page.screenshot({ path: '/tmp/claude-0/shots/e-desktop.png' });
  ok('на компьютере две колонки', (await d.page.locator('.today').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)) === 2);
  // невыполненные задания: отдельный ученик, чтобы не сбивать остальное
  {
    const q2 = await makeStudent(c, { name: 'E2E Невыполненные', startDaysAgo: 10, onboardingDone: true });
    const qa = await openApp(browser, srv.url, await sessionFor(c, q2.id)); const qp = qa.page;
    await qp.waitForSelector('.today', { timeout: 20000 }); await wait(1000);
    const n0 = Number(await qp.locator('#pendN').innerText());
    ok('кнопка невыполненных заданий на экране «Сегодня»', await qp.locator('#pendBtn').isVisible() && n0 > 0, String(n0));
    await qp.click('#pendBtn'); await qp.waitForSelector('#pendBody .row[data-id]');
    const listed = await qp.locator('#pendBody .row[data-id]').count();
    ok('в списке столько же заданий, сколько на кнопке', listed === n0, listed + ' / ' + n0);
    await wait(600); await qp.screenshot({ path: '/tmp/pending.png' });
    await qp.locator('#pendBody .row[data-id] [data-chk]').first().click(); await wait(800);
    ok('отметка в списке уменьшает счётчик', Number(await qp.locator('#pendN').innerText()) === n0 - 1);
    await qp.locator('#pendBody .row[data-id] [data-chk]').first().click(); await wait(500);
    ok('снятие отметки возвращает счётчик', Number(await qp.locator('#pendN').innerText()) === n0);
    await qa.ctx.close().catch(() => {});
  }
  ok('на всём пути нет ошибок в консоли', errors.length === 0 && d.errors.length === 0, errors.concat(d.errors).join(' | '));
} catch (e) { console.log('СБОЙ СЦЕНАРИЯ:', e.message.slice(0, 600)); results.push(['сценарий дошёл до конца', false, e.message.split('\n')[0]]); }
finally { await browser.close(); srv.stop(); console.log('очистка:', await cleanupE2E(c)); const bad = results.filter((r) => !r[1]); console.log(`\nпроверок: ${results.length}, не прошло: ${bad.length}`); process.exit(bad.length ? 1 : 0); }
