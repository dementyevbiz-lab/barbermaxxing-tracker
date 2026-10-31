import { connect, sessionFor, makeStudent, cleanupE2E } from './lib.mjs';
import { startServer, launch, openApp, wait } from './browser.mjs';
const root = new URL('../../', import.meta.url).pathname;
const c = await connect(); const srv = await startServer(root); const browser = await launch();
try {
  const p = await makeStudent(c, { name: 'E2E Смоук', startDaysAgo: 24, onboardingDone: true });
  // базовый замер отправлен
  const { data: cps } = await c.admin.from('checkpoints').select('*').eq('user_id', p.id).order('idx');
  await c.admin.from('checkpoints').update({ submitted_at: new Date(Date.now() - 24 * 864e5).toISOString() }).eq('id', cps[0].id);
  const items = [
    ['lesson', 4, 1, 'Демо-урок про цену', 25, true], ['live', 4, 2, 'Демо-эфир с Саней', 60, true], ['homework', 4, 3, 'Демо-домашка недели', 40, true],
    ['short_task', 3, 4, 'Демо-задание на 15 минут', 15, false],
  ].map(([kind, week, ord, title, est, req]) => ({ kind, week, ord, title, est_minutes: est, required: req, user_id: p.id, has_notes: kind !== 'homework', xp: 20, tariffs: ['barbermax', 'personal'], description: 'Описание для проверки' }));
  await c.admin.from('program_items').insert(items);
  await c.admin.from('goals').insert([{ user_id: p.id, metric_key: 'avg_check', a_value: 1500, b_value: 2500 }]);
  await c.admin.from('goal_text').insert({ user_id: p.id, why_text: 'Средний чек 3 500 ₽ и пять рабочих дней' });
  await c.admin.from('quotes').insert({ text: 'Тестовая цитата для проверки', author: 'E2E Автор', verified: true });
  const session = await sessionFor(c, p.id);
  const { page, errors } = await openApp(browser, srv.url, session);
  await page.waitForSelector('.today', { timeout: 15000 }).catch(async (e) => { console.log('НЕ ОТКРЫЛОСЬ. ошибки:', errors); console.log((await page.innerText('body')).slice(0, 400)); await page.screenshot({ path: '/tmp/claude-0/shots/s-fail.png' }); throw e; });
  await wait(1500);
  await page.screenshot({ path: '/tmp/claude-0/shots/s-today.png', fullPage: true });
  console.log('ошибки:', errors);
} finally { await browser.close(); srv.stop(); console.log('очистка:', await cleanupE2E(c)); }
