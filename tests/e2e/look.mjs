// Быстрый осмотр экранов глазами: создаёт тестового ученика, делает скриншоты, удаляет. Запуск: NODE_USE_ENV_PROXY=1 node tests/e2e/look.mjs [префикс]
import { connect, sessionFor, makeStudent, cleanupE2E } from './lib.mjs';
import { startServer, launch, openApp, wait } from './browser.mjs';
const root = new URL('../../', import.meta.url).pathname; const pre = process.argv[2] || 'l';
const c = await connect(); const srv = await startServer(root, 8095); const browser = await launch();
try {
  const p = await makeStudent(c, { name: 'E2E Осмотр', startDaysAgo: Number(process.argv[3] || 3), onboardingDone: true });
  const { data: cps } = await c.admin.from('checkpoints').select('*').eq('user_id', p.id).order('idx');
  await c.admin.from('checkpoints').update({ submitted_at: new Date(Date.now() - 3 * 864e5).toISOString() }).eq('id', cps[0].id);
  await c.admin.from('checkpoint_values').insert([{ checkpoint_id: cps[0].id, metric_key: 'avg_check', value: 1500 }]);
  await c.admin.from('goals').insert([{ user_id: p.id, metric_key: 'avg_check', a_value: 1500, b_value: 2500 }, { user_id: p.id, metric_key: 'booking_fill', a_value: 55, b_value: 85 }]);
  await c.admin.from('goal_text').insert({ user_id: p.id, why_text: 'Полная запись и чек выше' });
  await c.admin.from('program_items').insert([{ kind: 'live', week: 1, ord: 1, title: 'E2E Первый эфир', est_minutes: 90, user_id: p.id, tariffs: ['barbermax'], has_notes: true }]);
  await c.admin.from('insights').insert({ user_id: p.id, body: 'вывод', entry_date: new Date().toISOString().slice(0, 10) });
  const session = await sessionFor(c, p.id);
  for (const [tag, w, h, mobile] of [['d', 1440, 900, false], ['m', 390, 844, true]]) {
    const { page, errors } = await openApp(browser, srv.url, session, { w, h, mobile });
    await page.waitForSelector('.today', { timeout: 20000 }); await wait(1200);
    await page.screenshot({ path: `/tmp/claude-0/shots/${pre}-${tag}-today.png`, fullPage: true });
    await page.click('[data-tab="notes"]'); await page.waitForSelector('#seg'); await wait(600);
    await page.screenshot({ path: `/tmp/claude-0/shots/${pre}-${tag}-notes.png` });
    await page.click('[data-tab="path"]'); await wait(800); await page.screenshot({ path: `/tmp/claude-0/shots/${pre}-${tag}-path.png` });
    if (errors.length) console.log(tag, 'ошибки:', errors);
  }
} finally { await browser.close(); srv.stop(); await cleanupE2E(c); }
