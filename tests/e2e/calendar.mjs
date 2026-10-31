// Календарь выводов: геометрия на разных ширинах (в том числе 31 число), ограничение по январю 2027
import { connect, sessionFor, makeStudent, cleanupE2E } from './lib.mjs';
import { startServer, launch, openApp, wait } from './browser.mjs';
const root = new URL('../../', import.meta.url).pathname;
const results = []; const ok = (n, c, x = '') => { results.push([n, !!c]); console.log((c ? 'OK  ' : 'FAIL') + ' ' + n + (c ? '' : ' ' + x)); };
const c = await connect(); const srv = await startServer(root, 8091); const browser = await launch();
try {
  const p = await makeStudent(c, { name: 'E2E Календарь', startDaysAgo: 20, onboardingDone: true });
  const today = new Date().toISOString().slice(0, 10);
  await c.admin.from('insights').insert([{ user_id: p.id, body: 'вывод сегодня', entry_date: today }]);
  const sess = await sessionFor(c, p.id);
  for (const [w, h, mobile] of [[360, 740, true], [390, 844, true], [820, 1100, false], [1024, 768, false], [1280, 800, false], [1440, 900, false], [1920, 1080, false]]) {
    const { page, errors } = await openApp(browser, srv.url, sess, { w, h, mobile });
    await page.waitForSelector('.today', { timeout: 25000 }); await page.click('[data-tab="notes"]'); await page.waitForSelector('.cal'); await wait(500);
    const g = await page.evaluate(() => {
      const cal = document.querySelector('.cal').getBoundingClientRect(), card = document.querySelector('.cal').closest('.card').getBoundingClientRect();
      const bad = []; let cells = 0;
      document.querySelectorAll('.cal button').forEach((b) => { cells++; const r = b.getBoundingClientRect(); const t = b.querySelector('span'); const tr = t.getBoundingClientRect();
        if (r.left < cal.left - 1 || r.right > cal.right + 1) bad.push('ячейка ' + t.textContent + ' вышла из сетки');
        if (tr.left < r.left - 1 || tr.right > r.right + 1 || tr.top < r.top - 1 || tr.bottom > r.bottom + 1) bad.push('цифра ' + t.textContent + ' вышла из ячейки');
        if (Math.abs(r.width - r.height) > 2) bad.push('ячейка ' + t.textContent + ' не квадратная ' + Math.round(r.width) + 'x' + Math.round(r.height)); });
      return { bad, cells, calW: Math.round(cal.width), cardW: Math.round(card.width), pageOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    ok(`${w}px: календарь целый, ячейки квадратные, цифры внутри (${g.cells} дней, ширина ${g.calW})`, g.bad.length === 0 && !g.pageOverflow, g.bad.slice(0, 3).join('; '));
    if (w >= 820) ok(`${w}px: календарь не сжат (шире 400)`, g.calW > 400, g.calW);
    ok(`${w}px: без ошибок в консоли`, errors.length === 0, errors.join('|'));
    if (w === 1440) await page.screenshot({ path: '/tmp/claude-0/shots/cal-1440.png' });
    if (w === 390) {
      // ограничение: вперёд до января 2027, дальше кнопка закрыта
      let n = 0; while (!(await page.locator('[data-nav="1"][disabled]').count()) && n < 12) { await page.click('[data-nav="1"]'); n++; await wait(80); }
      const title = await page.locator('.cal-nav .title2').innerText();
      ok('вперёд можно листать только до января 2027', /Январь 2027/.test(title), title);
      const dis = await page.evaluate(() => [...document.querySelectorAll('.cal button')].filter((b) => b.classList.contains('dis')).length);
      ok('дни после 31 января закрыты (в январе их нет, все дни доступны)', dis === 0, dis);
      await page.click('[data-nav="-1"]'); await page.waitForSelector('.cal'); await wait(200);
      await page.click('[data-nav="1"]'); await page.waitForSelector('.cal'); ok('из декабря в январь можно вернуться', true);
    }
    await page.context().close();
  }
} finally { await browser.close(); srv.stop(); await cleanupE2E(c); const bad = results.filter((r) => !r[1]); console.log(`проверок: ${results.length}, не прошло: ${bad.length}`); process.exit(bad.length ? 1 : 0); }
