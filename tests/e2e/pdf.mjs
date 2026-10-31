// Проверка итогового PDF: кнопка закрыта до последней недели, затем скачивается настоящий PDF с одним листом А4
import { readFileSync } from 'node:fs';
import { connect, sessionFor, makeStudent, cleanupE2E } from './lib.mjs';
import { startServer, launch, openApp, wait } from './browser.mjs';
const root = new URL('../../', import.meta.url).pathname;
const results = []; const ok = (n, c, x = '') => { results.push([n, !!c]); console.log((c ? 'OK  ' : 'FAIL') + ' ' + n + (c ? '' : ' ' + x)); };
const c = await connect(); const srv = await startServer(root, 8096); const browser = await launch();
try {
  const mid = await makeStudent(c, { name: 'E2E Середина', startDaysAgo: 10, onboardingDone: true });
  const fin = await makeStudent(c, { name: 'E2E Финиш', startDaysAgo: 52, onboardingDone: true });
  const { data: cps } = await c.admin.from('checkpoints').select('*').eq('user_id', fin.id).order('idx');
  const img = readFileSync('/tmp/claude-0/e2e/small.png');
  const metrics = { avg_check: [1500, 2500, 1800, 2200], booking_fill: [55, 85, 62, 74], followers: [800, 3000, 1000, 1700] };
  await c.admin.from('goals').insert(Object.entries(metrics).map(([k, v]) => ({ user_id: fin.id, metric_key: k, a_value: v[0], b_value: v[1] })));
  await c.admin.from('goal_text').insert({ user_id: fin.id, why_text: 'Полная запись и чек выше' });
  for (const [i, cp] of cps.slice(0, 2).entries()) {
    await c.admin.from('checkpoints').update({ submitted_at: new Date(Date.now() - (50 - i * 40) * 864e5).toISOString() }).eq('id', cp.id);
    await c.admin.from('checkpoint_values').insert(Object.entries(metrics).map(([k, v]) => ({ checkpoint_id: cp.id, metric_key: k, value: v[i === 0 ? 0 : 3] })));
    for (const kind of ['video_1', 'video_2', 'instagram_profile']) {
      const path = `${fin.id}/${cp.id}/${kind}.png`; await c.admin.storage.from('screenshots').upload(path, img, { contentType: 'image/png' });
      await c.admin.from('screenshots').insert({ user_id: fin.id, checkpoint_id: cp.id, kind, storage_path: path, size_bytes: img.length });
    }
  }
  await c.admin.from('video_logs').insert([{ user_id: fin.id, kind: 'client', logged_on: new Date().toISOString().slice(0, 10) }, { user_id: fin.id, kind: 'life', logged_on: new Date().toISOString().slice(0, 10) }]);

  // середина программы: кнопка закрыта
  let app = await openApp(browser, srv.url, await sessionFor(c, mid.id)); let page = app.page;
  await page.waitForSelector('.today', { timeout: 20000 }); await page.click('[data-tab="profile"]'); await page.waitForSelector('#pdfBtn');
  ok('PDF закрыт до последней недели', await page.locator('#pdfBtn[disabled]').count() === 1); await app.ctx.close();

  // финиш
  app = await openApp(browser, srv.url, await sessionFor(c, fin.id)); page = app.page;
  await page.waitForSelector('.today', { timeout: 20000 }); await wait(500);
  ok('после программы на «Сегодня» сообщение о завершении', (await page.locator('.today').innerText()).toLowerCase().includes('программа пройдена'));
  await page.click('[data-tab="profile"]'); await page.waitForSelector('#pdfBtn'); await wait(300);
  ok('PDF открыт после программы', await page.locator('#pdfBtn[disabled]').count() === 0);
  const dl = page.waitForEvent('download', { timeout: 60000 }).catch((e) => null);
  await page.click('#pdfBtn'); const d = await dl;
  ok('PDF скачивается', !!d);
  if (d) {
    const path = '/tmp/claude-0/e2e/itog.pdf'; await d.saveAs(path); const buf = readFileSync(path);
    ok('файл настоящий PDF', buf.slice(0, 5).toString() === '%PDF-' && buf.length > 20000, buf.length);
    ok('в PDF один лист', (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length === 1);
    console.log('размер PDF, КБ:', Math.round(buf.length / 1024));
  }
  const png = await page.evaluate(async () => { const m = await import('/js/pdf.js'); const { canvas } = await m.buildPdf(); return canvas.toDataURL('image/png'); });
  (await import('node:fs')).writeFileSync('/tmp/claude-0/shots/pdf.png', Buffer.from(png.split(',')[1], 'base64'));
  ok('без ошибок в консоли', app.errors.length === 0, app.errors.join(' | '));
} catch (e) { console.log('СБОЙ:', e.message.slice(0, 600)); results.push(['дошёл до конца', false]); }
finally { await browser.close(); srv.stop(); await c.admin.storage.from('screenshots').list(''); console.log('очистка:', await cleanupE2E(c)); const bad = results.filter((r) => !r[1]); console.log(`проверок: ${results.length}, не прошло: ${bad.length}`); process.exit(bad.length ? 1 : 0); }
