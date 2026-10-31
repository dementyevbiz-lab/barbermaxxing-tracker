// Сквозные сценарии пути клиента и админа, не вошедшие в student/admin: челлендж до награды, пауза, закрытый доступ,
// вопрос по триггеру, «К созвону», корзина, смена ссылки-приглашения
import { connect, sessionFor, makeStudent, makeAdmin, cleanupE2E, ledgerSum } from './lib.mjs';
import { startServer, launch, openApp, wait } from './browser.mjs';
const root = new URL('../../', import.meta.url).pathname;
const results = []; const ok = (n, c, x = '') => { results.push([n, !!c]); console.log((c ? 'OK  ' : 'FAIL') + ' ' + n + (c ? '' : ' ' + x)); };
const c = await connect(); const srv = await startServer(root, 8090); const browser = await launch();
const until = async (fn, ms = 9000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await wait(250); } return false; };
const closeRank = async (pg) => { if (await pg.locator('#rankModal.open').count()) { await pg.click('#rankModal'); await wait(450); } };
const baseline = async (p) => { const { data: cps } = await c.admin.from('checkpoints').select('*').eq('user_id', p.id).order('idx'); await c.admin.from('checkpoints').update({ submitted_at: new Date(Date.now() - 31 * 864e5).toISOString() }).eq('id', cps[0].id); return cps; };
try {
  // ===== А. Челлендж «Быстрая запись»: от задач до награды, которую выдаёт админ =====
  const chOrig = (await c.admin.from('challenges').select('active, rules').eq('code', 'quick_booking').single()).data;
  await c.admin.from('challenges').update({ active: true, rules: 'E2E правила челленджа: семь задач за неделю' }).eq('code', 'quick_booking');
  const ch = await makeStudent(c, { name: 'E2E Челлендж', startDaysAgo: 30, onboardingDone: true }); await baseline(ch);
  await c.admin.from('program_items').insert(Array.from({ length: 7 }, (_, i) => ({ kind: 'challenge_task', week: 5, ord: i + 1, title: 'E2E Задача челленджа ' + (i + 1), user_id: ch.id, tariffs: ['barbermax'], tags: ['quick_booking'], xp: 20, required: false })));
  const a = await openApp(browser, srv.url, await sessionFor(c, ch.id)); let page = a.page;
  await page.waitForSelector('.today', { timeout: 25000 }); await wait(800);
  ok('на 5-й неделе виден челлендж с правилами', (await page.locator('#bChallenge').innerText()).includes('E2E правила челленджа'));
  ok('в челлендже семь задач', await page.locator('#chList .row[data-id]').count() === 7);
  ok('награда названа', (await page.locator('#bChallenge').innerText()).toLowerCase().includes('награда'));
  const rows = page.locator('#chList .row[data-id] [data-chk]');
  for (let i = 0; i < 7; i++) { await closeRank(page); await rows.nth(i).click(); await wait(300); }
  await wait(1500); await closeRank(page);
  ok('все семь задач засчитаны, счётчик 7 из 7', await until(async () => (await page.locator('#chProg').innerText()).toLowerCase().startsWith('7 из 7')));
  ok('награда и опыт за челлендж пришли с сервера', await until(async () => (await ledgerSum(c, ch.id, 'challenge')) === 300));
  ok('создан результат с наградой «заслужена»', await until(async () => (await c.admin.from('challenge_results').select('reward_status').eq('user_id', ch.id)).data?.[0]?.reward_status === 'earned'));
  await closeRank(page); await rows.nth(3).click();
  ok('снял одну задачу: награда и опыт снялись', await until(async () => (await ledgerSum(c, ch.id, 'challenge')) === 0 && (await c.admin.from('challenge_results').select('reward_status').eq('user_id', ch.id)).data[0].reward_status === 'none'));
  await closeRank(page); await rows.nth(3).click(); await until(async () => (await ledgerSum(c, ch.id, 'challenge')) === 300); await wait(1200); await closeRank(page);
  await closeRank(page); await page.click('[data-tab="profile"]'); await page.waitForSelector('.ach-row'); ok('в профиле ачивки открыты по очереди', (await page.locator('.ach-row').count()) >= 3);
  await a.ctx.close();
  // админ видит и выдаёт награду
  const adm = await makeAdmin(c);
  const ad = await openApp(browser, srv.url, await sessionFor(c, adm.id)); page = ad.page;
  await page.waitForSelector('#stList .row', { timeout: 25000 }); await wait(500);
  await page.locator('#stList .row', { hasText: 'E2E Челлендж' }).click(); await page.waitForSelector('#rewGive', { timeout: 15000 });
  ok('админ видит, что награда заслужена', (await page.locator('#pageBody').innerText()).includes('заслужена'));
  await page.click('#rewGive');
  ok('админ отмечает награду выданной', await until(async () => (await c.admin.from('challenge_results').select('reward_status').eq('user_id', ch.id)).data[0].reward_status === 'given'));
  await ad.ctx.close();

  // ===== Б. Пауза: читать можно, отмечать нельзя =====
  const pa = await makeStudent(c, { name: 'E2E Пауза', startDaysAgo: 10, onboardingDone: true, status: 'paused' }); await baseline(pa);
  await c.admin.from('program_items').insert({ kind: 'lesson', week: 2, ord: 1, title: 'E2E Урок паузы', user_id: pa.id, tariffs: ['barbermax'], required: true });
  const pp = await openApp(browser, srv.url, await sessionFor(c, pa.id)); page = pp.page;
  await page.waitForSelector('.today', { timeout: 25000 }); await wait(700);
  ok('на паузе показана плашка «Программа на паузе»', (await page.locator('.today').innerText()).includes('Программа на паузе'));
  ok('на паузе нет кнопки записи видео', await page.locator('#videoBtn').count() === 0);
  const before = (await c.admin.from('completions').select('id').eq('user_id', pa.id)).data.length;
  await page.locator('#actList .row', { hasText: 'E2E Урок паузы' }).locator('[data-chk]').click(); await wait(900);
  ok('на паузе отметка не ставится', (await c.admin.from('completions').select('id').eq('user_id', pa.id)).data.length === before && (await page.locator('#toastTxt').innerText()).includes('паузе'));
  await pp.ctx.close();

  // ===== В. Закрытый доступ =====
  const bl = await makeStudent(c, { name: 'E2E Закрыт', startDaysAgo: 10, onboardingDone: true, status: 'blocked' });
  const bb = await openApp(browser, srv.url, await sessionFor(c, bl.id)); await bb.page.waitForSelector('text=Доступ закрыт', { timeout: 20000 }); ok('закрытому ученику показан экран «Доступ закрыт»', true); await bb.ctx.close();

  // ===== Г. Вопрос по триггеру → в «Вопросы»; скрытие =====
  const tr = await makeStudent(c, { name: 'E2E Триггер', startDaysAgo: 10, onboardingDone: true }); await baseline(tr);
  const t1 = await openApp(browser, srv.url, await sessionFor(c, tr.id)); page = t1.page;
  await page.waitForSelector('#bQuestion', { timeout: 25000 });
  const qtext = await page.locator('#bQuestion .title2').innerText();
  await page.click('#qSave'); await wait(800);
  ok('предложенный вопрос сохраняется в «Вопросы»', (await c.admin.from('questions').select('*').eq('user_id', tr.id)).data.some((q) => q.body === qtext && q.origin === 'trigger'));
  await page.reload(); await page.waitForSelector('.today'); await wait(900);
  ok('после сохранения в тот же день новый вопрос не предлагается', await page.locator('#bQuestion').count() === 0);
  await page.click('[data-tab="notes"]'); await page.click('[data-s="questions"]'); await wait(300);
  ok('вопрос лежит среди открытых', (await page.locator('.note-card').first().innerText()).includes(qtext.slice(0, 20)));
  await t1.ctx.close();
  const t2 = await makeStudent(c, { name: 'E2E Скрыть', startDaysAgo: 10, onboardingDone: true }); await baseline(t2);
  const h1 = await openApp(browser, srv.url, await sessionFor(c, t2.id)); page = h1.page;
  await page.waitForSelector('#bQuestion', { timeout: 25000 }); await page.click('#qHide'); await wait(800);
  ok('скрытый вопрос записан в журнал как скрытый', (await c.admin.from('trigger_log').select('*').eq('user_id', t2.id)).data.some((l) => l.dismissed_at));
  await page.reload(); await page.waitForSelector('.today'); await wait(800); ok('скрытый вопрос не возвращается в тот же день', await page.locator('#bQuestion').count() === 0); await h1.ctx.close();

  // ===== Д. «К созвону»: вопросы, «Задал» =====
  const cl = await makeStudent(c, { name: 'E2E Созвон', startDaysAgo: 10, onboardingDone: true }); await baseline(cl);
  await c.admin.from('calls').insert({ user_id: cl.id, kind: 'strategy', scheduled_at: new Date(Date.now() + 30 * 36e5).toISOString() });
  await c.admin.from('questions').insert([{ user_id: cl.id, body: 'E2E Вопрос про цену' }, { user_id: cl.id, body: 'E2E Вопрос про видео' }]);
  const k1 = await openApp(browser, srv.url, await sessionFor(c, cl.id)); page = k1.page;
  await page.waitForSelector('#callBtn', { timeout: 25000 });
  ok('за день до созвона плашка «К созвону вопросов: 2»', (await page.locator('#callBtn').innerText()).includes('вопросов: 2'));
  await page.click('#callBtn'); await page.waitForSelector('[data-ask]'); await page.locator('[data-ask]').first().click(); await wait(700);
  ok('«Задал» переводит вопрос в заданные', (await c.admin.from('questions').select('status').eq('user_id', cl.id)).data.filter((q) => q.status === 'asked').length === 1);
  await k1.ctx.close();

  // ===== Е. Выводы: правка и корзина из профиля =====
  const nt = await makeStudent(c, { name: 'E2E Заметки', startDaysAgo: 5, onboardingDone: true }); await baseline(nt);
  await c.admin.from('insights').insert({ user_id: nt.id, body: 'E2E вывод для корзины', entry_date: new Date().toISOString().slice(0, 10) });
  const n1 = await openApp(browser, srv.url, await sessionFor(c, nt.id)); page = n1.page;
  await page.waitForSelector('.today', { timeout: 25000 }); await page.click('[data-tab="notes"]'); await page.waitForSelector('[data-ed]');
  await page.locator('[data-ed]').first().click(); await page.waitForSelector('#iBody'); await page.fill('#iBody', 'E2E вывод после правки'); await page.click('#iSave'); await wait(800);
  ok('правка вывода сохранена', (await c.admin.from('insights').select('body').eq('user_id', nt.id)).data[0].body === 'E2E вывод после правки');
  await page.locator('[data-ed]').first().click(); await page.waitForSelector('#iDel'); await page.click('#iDel'); await wait(800);
  await page.click('[data-tab="profile"]'); await page.click('#trashBtn'); await page.waitForSelector('#sheet.open [data-back]'); await page.click('#sheet [data-back]'); await wait(800);
  ok('из корзины в профиле вывод возвращается', (await c.admin.from('insights').select('deleted_at').eq('user_id', nt.id)).data[0].deleted_at === null);
  await n1.ctx.close();

  // ===== Ж. Админ: новая ссылка-приглашение =====
  const iv = await makeStudent(c, { name: 'E2E Ссылка', startDaysAgo: 2 }); await c.admin.from('profiles').update({ invite_code: 'oldcode12345', demo: false }).eq('id', iv.id);
  const ad2 = await openApp(browser, srv.url, await sessionFor(c, adm.id)); page = ad2.page;
  await page.waitForSelector('#stList .row', { timeout: 25000 }); await wait(500);
  await page.locator('#stList .row', { hasText: 'E2E Ссылка' }).click(); await page.waitForSelector('#aReissue'); await wait(1200);
  page.once('dialog', (d) => d.accept()); await page.click('#aReissue'); await page.waitForSelector('#sheet.open .link-box', { timeout: 15000 });
  const nl = await page.locator('#sheet .link-box').innerText(); const code = nl.split('startapp=')[1].trim();
  const pr = (await c.admin.from('profiles').select('invite_code,telegram_id,status').eq('id', iv.id).single()).data;
  ok('новая ссылка выдана, старый код погашен', pr.invite_code === code && code !== 'oldcode12345' && pr.telegram_id === null && pr.status === 'invited', JSON.stringify({ pr, code }));
  ok('в админке без ошибок', ad2.errors.length === 0, ad2.errors.join('|')); await ad2.ctx.close();
} catch (e) { console.log('СБОЙ СЦЕНАРИЯ:', e.message.slice(0, 600)); results.push(['сценарий дошёл до конца', false]); }
finally { await browser.close(); srv.stop(); try { await c.admin.from('challenges').update({ active: false, rules: null }).eq('code', 'quick_booking'); } catch (e) {} console.log('очистка:', await cleanupE2E(c)); const bad = results.filter((r) => !r[1]); console.log(`проверок: ${results.length}, не прошло: ${bad.length}`); process.exit(bad.length ? 1 : 0); }
