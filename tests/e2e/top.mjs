// Рейтинг на настоящей базе: общий зачёт и таблицы по метрикам, листание, скрытие из рейтинга
import { connect, sessionFor, makeStudent, cleanupE2E } from './lib.mjs';
import { startServer, launch, openApp, wait } from './browser.mjs';
const root = new URL('../../', import.meta.url).pathname;
const results = []; const ok = (n, c, x = '') => { results.push([n, !!c]); console.log((c ? 'OK  ' : 'FAIL') + ' ' + n + (c ? '' : ' ' + x)); };
const c = await connect(); const srv = await startServer(root, 8092); const browser = await launch();
async function withGain(name, a, now) {
  const p = await makeStudent(c, { name, startDaysAgo: 20, onboardingDone: true });
  await c.admin.from('profiles').update({ demo: false }).eq('id', p.id); // демо в рейтинг не попадают
  await c.admin.from('goals').insert([{ user_id: p.id, metric_key: 'avg_check', a_value: a, b_value: a * 2 }, { user_id: p.id, metric_key: 'followers', a_value: 100, b_value: 1000 }]);
  await c.admin.from('checkpoints').update({ submitted_at: new Date().toISOString() }).eq('user_id', p.id).eq('idx', 0);
  const { data: cp } = await c.admin.from('checkpoints').select('id').eq('user_id', p.id).eq('idx', 1).single();
  await c.admin.from('checkpoint_values').insert([{ checkpoint_id: cp.id, metric_key: 'avg_check', value: now }, { checkpoint_id: cp.id, metric_key: 'followers', value: 150 }]);
  await c.admin.from('checkpoints').update({ submitted_at: new Date().toISOString() }).eq('id', cp.id);
  return p;
}
try {
  const a = await withGain('E2E Топ Первый', 1000, 1500);   // +50%
  const b = await withGain('E2E Топ Второй', 1000, 1100);   // +10%
  const sess = await sessionFor(c, b.id);
  const { page, errors } = await openApp(browser, srv.url, sess);
  await page.waitForSelector('.today', { timeout: 25000 }); await wait(1500);
  ok('на «Сегодня» есть кнопка рейтинга', await page.locator('#topBtnT').isVisible());
  await page.locator('#topBtnT').scrollIntoViewIfNeeded(); await page.click('#topBtnT');
  await page.waitForSelector('#pager .top-row', { timeout: 15000 }); await wait(600);
  const chips = await page.locator('#topChips [data-i]').count();
  const act = (await c.admin.from('metrics').select('key').eq('active', true)).data.length;
  ok('вкладок: общий и по каждой активной метрике', chips === act + 1, `${chips} / ${act + 1}`);
  const total = await page.locator('.pg').nth(0).innerText();
  ok('в общем зачёте оба ученика, первый выше', total.indexOf('E2E Топ Первый') >= 0 && total.indexOf('E2E Топ Первый') < total.indexOf('E2E Топ Второй'), total.slice(0, 200));
  ok('своя строка помечена', total.includes('E2E Топ Второй (ты)'));
  ok('очки: 4×50 + 1×50 = 250 и 4×10 + 1×50 = 90', total.includes('250') && total.includes('90'), total.slice(0, 300));
  ok('начальные цифры не показаны', !total.includes('1 500') && !total.includes('1500') && !total.includes('1 100'));
  await page.screenshot({ path: '/tmp/top1.png' });
  // листание: вторая таблица (первая по порядку метрика с данными)
  await page.click('#topChips [data-i="1"]'); await wait(900);
  const idx = await page.evaluate(() => Math.round(document.getElementById('pager').scrollLeft / document.getElementById('pager').clientWidth));
  ok('кнопка вкладки листает к таблице', idx === 1, String(idx));
  ok('вкладка отмечена', await page.locator('#topChips [data-i="1"].pri').count() === 1);
  const metric = await page.locator('.pg').nth(1).innerText();
  ok('в таблице метрики виден прирост в процентах', metric.includes('+50') && metric.includes('+10'), metric.slice(0, 200));
  await page.screenshot({ path: '/tmp/top2.png' });
  // кнопка во вкладке «Прогресс» тоже открывает рейтинг
  await page.evaluate(() => document.querySelector('#page [data-back]')?.click()); await wait(300);
  await page.click('[data-tab="progress"]'); await page.waitForSelector('#topBtnP'); await page.click('#topBtnP');
  await page.waitForSelector('#pager .top-row', { timeout: 15000 });
  ok('кнопка во вкладке «Прогресс» открывает рейтинг', (await page.locator('.pg').nth(0).innerText()).includes('E2E Топ Первый'));
  // скрыться из рейтинга
  await page.evaluate(() => document.querySelector('#page [data-back]')?.click()); await wait(300);
  await page.click('[data-tab="profile"]'); await page.waitForSelector('#topT'); await page.click('#topT'); await wait(900);
  const pr = (await c.admin.from('profiles').select('prefs').eq('id', b.id).single()).data.prefs;
  ok('скрытие сохраняется в профиле', pr.hide_top === true);
  const { data: lb } = await (await (async () => { const u = c.anon(); await u.auth.setSession({ access_token: sess.access_token, refresh_token: sess.refresh_token }); return u; })()).rpc('leaderboard');
  ok('скрывшийся не виден в рейтинге и знает об этом', lb.hidden === true && !JSON.stringify(lb.rows).includes('E2E Топ Второй') && JSON.stringify(lb.rows).includes('E2E Топ Первый'));
  ok('рейтинг не отдаёт чужих цифр', !JSON.stringify(lb).includes('1500'));
  ok('без ошибок в консоли', errors.length === 0, errors.join(' | '));
} catch (e) { console.log('СБОЙ СЦЕНАРИЯ:', e.message.slice(0, 600)); results.push(['сценарий дошёл до конца', false]); }
finally { await browser.close(); srv.stop(); console.log('очистка:', await cleanupE2E(c)); const bad = results.filter((r) => !r[1]); console.log(`\nпроверок: ${results.length}, не прошло: ${bad.length}`); process.exit(bad.length ? 1 : 0); }
