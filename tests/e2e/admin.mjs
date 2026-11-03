// Сквозная проверка админки на настоящем Supabase. Запуск: NODE_USE_ENV_PROXY=1 node tests/e2e/admin.mjs
import { connect, sessionFor, makeStudent, makeAdmin, cleanupE2E } from './lib.mjs';
import { startServer, launch, openApp, wait } from './browser.mjs';
const root = new URL('../../', import.meta.url).pathname;
const results = [];
const ok = (name, cond, extra = '') => { results.push([name, !!cond, extra]); console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (cond ? '' : ' ' + extra)); };
const c = await connect(); const srv = await startServer(root, 8097); const browser = await launch();
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await wait(250); } return false; };
let page;
const shot = (n) => page.screenshot({ path: `/tmp/claude-0/shots/a-${n}.png` });
const closeSheet = async () => { await page.click('#scrim', { position: { x: 5, y: 5 } }).catch(() => {}); await wait(450); };
const fillSheet = async (vals) => { for (const [k, v] of Object.entries(vals)) await page.fill('#f_' + k, String(v)); };
try {
  const adm = await makeAdmin(c);
  const st1 = await makeStudent(c, { name: 'E2E Отстающий', startDaysAgo: 24, onboardingDone: true });
  const st2 = await makeStudent(c, { name: 'E2E Тариф Личка', tariff: 'personal', startDaysAgo: 3, onboardingDone: true });
  await c.admin.from('profiles').update({ demo: false }).in('id', [st1.id, st2.id]);
  const { data: cps } = await c.admin.from('checkpoints').select('*').eq('user_id', st1.id).order('idx');
  await c.admin.from('checkpoints').update({ submitted_at: new Date(Date.now() - 24 * 864e5).toISOString() }).eq('id', cps[0].id);
  await c.admin.from('goals').insert([{ user_id: st1.id, metric_key: 'avg_check', a_value: 1500, b_value: 2500 }]);
  await c.admin.from('checkpoint_values').insert({ checkpoint_id: cps[0].id, metric_key: 'avg_check', value: 1500 });
  await c.admin.from('insights').insert({ user_id: st1.id, body: 'ЛИЧНЫЙ ВЫВОД УЧЕНИКА' });
  await c.admin.from('questions').insert({ user_id: st1.id, body: 'ЛИЧНЫЙ ВОПРОС УЧЕНИКА' });
  // обязательные пункты прошлых недель, которые ученик не отметил → «отстаёт»
  await c.admin.from('program_items').insert([1, 2, 3].map((w) => ({ kind: 'lesson', week: w, ord: 1, title: 'E2E Урок ' + w, required: true, user_id: st1.id, tariffs: ['barbermax'] })));

  const session = await sessionFor(c, adm.id);
  const app = await openApp(browser, srv.url, session, { w: 390, h: 844 }); page = app.page;
  await page.waitForSelector('#stList .row', { timeout: 25000 });
  await wait(800);
  ok('админ видит список учеников', (await page.locator('#stList .row').count()) >= 2);
  ok('ученик с невыполненным помечен «отстаёт»', (await page.locator('#stList .row', { hasText: 'E2E Отстающий' }).innerText()).includes('отстаёт'));
  ok('просроченный замер помечен', (await page.locator('#stList .row', { hasText: 'E2E Отстающий' }).innerText()).includes('Замер просрочен'));
  await shot('list');

  // добавить ученика
  await page.click('#addSt'); await page.waitForSelector('#f_display_name'); await page.fill('#f_display_name', 'E2E Новый'); await page.click('#fSave');
  await page.waitForSelector('.link-box', { timeout: 20000 });
  const linkTxt = await page.locator('.link-box').innerText();
  ok('создано приглашение вида t.me/бот?startapp=код', /^https:\/\/t\.me\/barbermaxxing_tracker_bot\?startapp=[a-z0-9]{12}$/.test(linkTxt), linkTxt);
  const { data: np } = await c.admin.from('profiles').select('*').eq('display_name', 'E2E Новый').single();
  ok('профиль создан с кодом приглашения', np && np.invite_code && linkTxt.endsWith(np.invite_code) && np.status === 'invited');
  await closeSheet(); await wait(500);

  // карточка
  await page.locator('#stList .row', { hasText: 'E2E Отстающий' }).click(); await page.waitForSelector('#pageBody .card');
  await wait(600); await shot('card');
  const cardText = await page.locator('#pageBody').innerText();
  ok('в карточке есть метки внимания', cardText.toLowerCase().includes('на что нацелить внимание'));
  ok('в карточке нет выводов и вопросов ученика', !cardText.includes('ЛИЧНЫЙ ВЫВОД') && !cardText.includes('ЛИЧНЫЙ ВОПРОС'));
  await page.click('#nAdd'); await page.waitForSelector('#f_body'); await page.fill('#f_body', 'Заметка админа про ученика'); await page.click('#fSave');
  ok('заметка записана', await until(async () => (await c.admin.from('admin_notes').select('*').eq('user_id', st1.id)).data.length === 1));
  const stu = c.anon(); const ss = await sessionFor(c, st1.id); await stu.auth.setSession({ access_token: ss.access_token, refresh_token: ss.refresh_token });
  ok('ученик заметок админа не видит', (await stu.from('admin_notes').select('*')).data.length === 0);
  await page.waitForSelector('#pageBody .card'); await wait(600);
  await page.locator('tr[data-a="avg_check"]').click(); await page.waitForSelector('#f_a'); await page.fill('#f_a', '1600'); await page.click('#fSave');
  ok('админ меняет точку А', await until(async () => (await c.admin.from('goals').select('a_value').eq('user_id', st1.id).eq('metric_key', 'avg_check').single()).data.a_value == 1600));
  await wait(2000); await page.waitForSelector('#callAdd'); await page.click('#callAdd'); await page.waitForSelector('#f_at');
  const dt = new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 16); await page.fill('#f_at', dt); await page.click('#fSave');
  ok('дата созвона записана', await until(async () => (await c.admin.from('calls').select('*').eq('user_id', st1.id)).data.length === 1));
  await wait(2000); await page.waitForSelector('#aShift'); await page.click('#aShift'); await page.waitForSelector('#f_due'); await page.fill('#f_due', new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10)); await page.click('#fSave');
  ok('срок замера сдвинут и не перезатирается', await until(async () => { const r = (await c.admin.from('checkpoints').select('*').eq('user_id', st1.id).eq('idx', 1).single()).data; return r.due_shifted === true && r.due_date > new Date().toISOString().slice(0, 10); }));
  await wait(2000); await page.waitForSelector('#aTariff'); await page.click('#aTariff'); await page.waitForSelector('#f_tariff_id'); await page.selectOption('#f_tariff_id', { label: 'Личное сопровождение' }); await page.click('#fSave');
  ok('смена тарифа пересчитала замеры', await until(async () => (await c.admin.from('checkpoints').select('id').eq('user_id', st1.id)).data.length === 5));
  await wait(2000); await page.waitForSelector('#aBlocks'); await page.click('#aBlocks'); await page.waitForSelector('[data-check="quote"]'); await page.click('[data-check="quote"]'); await page.click('#fSave');
  ok('блок интерфейса выключен у ученика', await until(async () => (await c.admin.from('profiles').select('ui_overrides').eq('id', st1.id).single()).data.ui_overrides.hide?.includes('quote')));
  await wait(2000); await page.waitForSelector('#aTop'); await page.click('#aTop');
  ok('админ скрывает ученика из рейтинга', await until(async () => (await c.admin.from('profiles').select('ui_overrides').eq('id', st1.id).single()).data.ui_overrides.top_hidden === true));
  await wait(2000); await page.waitForSelector('#aStatus'); await page.click('#aStatus');
  ok('пауза ставится', await until(async () => (await c.admin.from('profiles').select('status').eq('id', st1.id).single()).data.status === 'paused'));
  await wait(1800); await page.click('.back'); await page.waitForSelector('#page:not(.open)'); await wait(400);

  // сводка
  await page.click('[data-tab="summary"]'); await page.waitForSelector('.pagehead'); await wait(500); await shot('summary');
  ok('сводка открывается без ошибок', true);

  // программа
  await page.click('[data-tab="program"]'); await page.waitForSelector('#pAdd');
  await page.click('#pAdd'); await page.waitForSelector('#f_title');
  await fillSheet({ title: 'E2E Только Личка', week: 1, est_minutes: 20 });
  await page.evaluate(() => document.querySelectorAll('[data-multi="tariffs"][data-v="barbermax"]').forEach((b) => b.click()));
  await page.click('#fSave');
  ok('пункт добавлен в программу', await until(async () => (await c.admin.from('program_items').select('*').eq('title', 'E2E Только Личка')).data.length === 1));
  await page.click('[data-w="1"]'); await page.waitForSelector('.row[data-id]'); await shot('program-admin');
  // видимость по тарифу
  const { data: pr } = await c.admin.from('program_items').select('*').eq('title', 'E2E Только Личка').single();
  ok('пункт только для тарифа Личка', JSON.stringify(pr.tariffs) === '["personal"]');
  const s1 = c.anon(); const sess1 = await sessionFor(c, st2.id); await s1.auth.setSession({ access_token: sess1.access_token, refresh_token: sess1.refresh_token });
  ok('ученик нужного тарифа видит пункт сразу', (await s1.from('program_items').select('id').eq('id', pr.id)).data.length === 1);
  await c.admin.from('profiles').update({ tariff_id: (await c.admin.from('tariffs').select('id').eq('code', 'barbermax').single()).data.id }).eq('id', st2.id);
  ok('ученик другого тарифа пункт не видит', (await s1.from('program_items').select('id').eq('id', pr.id)).data.length === 0);
  // порядок и корзина
  await page.locator('.row[data-id]', { hasText: 'E2E Только Личка' }).locator('[data-edit]').click(); await page.waitForSelector('#fDanger'); await page.once('dialog', (d) => d.accept()); await page.click('#fDanger');
  ok('пункт уходит в корзину', await until(async () => !!(await c.admin.from('program_items').select('deleted_at').eq('id', pr.id).single()).data.deleted_at));
  await wait(1800); await page.click('#pTrash'); await page.waitForSelector('#sheet [data-back]'); await page.click('#sheet [data-back]');
  ok('пункт возвращается из корзины', await until(async () => !(await c.admin.from('program_items').select('deleted_at').eq('id', pr.id).single()).data.deleted_at));
  // импорт JSON (тариф none: ученикам не виден)
  await page.click('#pImp'); await page.waitForSelector('#impText');
  await page.fill('#impText', JSON.stringify([{ week: 6, title: 'E2E Импорт 1', why: 'Зачем', how: 'Как', result: 'Результат', minutes: 15, xp: 20, tags: ['x'], tariffs: ['none'] }, { week: 6, title: 'E2E Импорт 2', minutes: 10, tariffs: ['none'] }]));
  await page.click('#impGo');
  ok('импорт JSON добавил два задания', await until(async () => (await c.admin.from('program_items').select('*').like('title', 'E2E Импорт%')).data.length === 2));
  const imp = (await c.admin.from('program_items').select('*').eq('title', 'E2E Импорт 1').single()).data; ok('импорт сохранил поля короткого задания', imp.kind === 'short_task' && imp.why === 'Зачем' && imp.xp === 20);
  await page.click('#pPrev'); await page.waitForSelector('[data-t]'); ok('предпросмотр «Как видит ученик»', true); await closeSheet();
  await page.click('#pHist'); await page.waitForSelector('#sheet.open .kv'); ok('история правок показывает записи', (await page.locator('#sheet .kv').count()) >= 1); await closeSheet();

  // контент
  await page.click('[data-tab="content"]'); await page.waitForSelector('[data-s="quotes"]'); await shot('content');
  await page.click('[data-s="quotes"]'); await page.waitForSelector('#lAdd'); await page.click('#lAdd'); await page.waitForSelector('#f_text');
  await fillSheet({ text: 'E2E цитата', author: 'E2E Автор' }); await page.click('[data-check="verified"]'); await page.click('#fSave');
  ok('цитата добавлена', await until(async () => (await c.admin.from('quotes').select('*').eq('author', 'E2E Автор')).data.length === 1));
  await page.click('.back'); await wait(300);
  for (const k of ['movies', 'triggers', 'ach', 'metrics', 'ch', 'tariffs', 'mech']) { await page.click(`[data-s="${k}"]`); await page.waitForSelector('#page.open'); await wait(300); await page.click('.back'); await wait(300); }
  ok('все разделы контента открываются', true);
  await page.click('[data-s="ranks"]'); await page.waitForSelector('#f_ranks'); ok('звания открываются', (await page.inputValue('#f_ranks')).includes('Барбермаксер')); await closeSheet();
  const dl = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
  await page.click('[data-s="backup"]'); const d = await dl; ok('бэкап скачивается файлом', !!d && /barbermaxxing-backup/.test(d.suggestedFilename()));

  // доступ ученика к админским действиям закрыт
  const adminFn = await fetch('https://nltremspmuuasksxbqtk.supabase.co/functions/v1/admin', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: 'sb_publishable_EB1WIiL4hcJNxK40-OqDlQ_94uiWrrz', Authorization: 'Bearer ' + sess1.access_token }, body: JSON.stringify({ action: 'delete_demo' }) });
  ok('ученик не может вызвать функцию админа', adminFn.status === 403);
  const { error: eAdm } = await s1.from('program_items').insert({ week: 1, kind: 'lesson', title: 'E2E взлом', tariffs: ['barbermax'] }); ok('ученик не может писать в программу', !!eAdm);
  ok('без ошибок в консоли админки', app.errors.length === 0, app.errors.join(' | '));
} catch (e) { console.log('СБОЙ СЦЕНАРИЯ:', e.message.slice(0, 700)); results.push(['сценарий дошёл до конца', false, e.message.slice(0, 300)]); try { await page.screenshot({ path: '/tmp/claude-0/shots/a-fail.png' }); } catch (x) {} }
finally { await browser.close(); srv.stop(); console.log('очистка:', await cleanupE2E(c)); const bad = results.filter((r) => !r[1]); console.log(`\nпроверок: ${results.length}, не прошло: ${bad.length}`); process.exit(bad.length ? 1 : 0); }
