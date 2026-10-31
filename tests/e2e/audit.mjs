// Визуальный аудит: на каждом экране и в каждом окне ищет текст, сливающийся с фоном, обрезанный текст и выход за ширину экрана.
// Контраст считается по настоящему скриншоту: цвет текста против цвета фона под ним. Запуск: NODE_USE_ENV_PROXY=1 node tests/e2e/audit.mjs
import { connect, sessionFor, makeStudent, makeAdmin, cleanupE2E } from './lib.mjs';
import { startServer, launch, openApp, wait } from './browser.mjs';
const root = new URL('../../', import.meta.url).pathname;
const c = await connect(); const srv = await startServer(root, 8093); const browser = await launch();
const problems = []; let screens = 0;

// Проверка текущего экрана: возвращает список проблем
const CHECK = `async (shotB64) => {
  const img = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + shotB64; });
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0);
  const sc = img.width / window.innerWidth;
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const parse = (s) => { const m = s.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/); return m ? [+m[1], +m[2], +m[3]] : null; };
  const out = [];
  const seen = new Set();
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return null; const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return null; return r; };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode; const text = t.textContent.trim(); if (!text) continue;
    const el = t.parentElement; if (!el || ['SCRIPT', 'STYLE', 'OPTION'].includes(el.tagName)) continue;
    if (el.closest('#toast:not(.show), .rank-modal:not(.open), .sheet:not(.open), .scrim:not(.open), .page:not(.open)')) continue;
    if (document.getElementById('sheet').classList.contains('open') && !el.closest('#sheet, #toast') ) continue;
    if (document.getElementById('page').classList.contains('open') && !el.closest('#page, #sheet, #toast')) continue;
    const range = document.createRange(); range.selectNodeContents(t); const r = range.getBoundingClientRect();
    if (r.width < 3 || r.height < 3 || r.bottom < 0 || r.top > innerHeight || r.left < 0 || r.right > innerWidth + 1) { if (r.right > innerWidth + 1 && r.width > 3 && r.top >= 0 && r.top < innerHeight && !el.closest('.segscroll,.strip,.tabs')) out.push({ kind: 'за границей экрана', text: text.slice(0, 40) }); continue; }
    if (!vis(el)) continue;
    const key = text + Math.round(r.left) + Math.round(r.top); if (seen.has(key)) continue; seen.add(key);
    if (/^[\p{Extended_Pictographic}\s]+$/u.test(text)) continue;
    { const top = document.elementFromPoint(Math.min(innerWidth - 1, r.left + r.width / 2), Math.min(innerHeight - 1, r.top + r.height / 2)); if (top && !(el === top || el.contains(top) || top.contains(el))) continue; }
    // что рисуется под словом: берём несколько точек вокруг прямоугольника слова (не внутри букв)
    const pts = [[r.left - 3, r.top + r.height / 2], [r.right + 3, r.top + r.height / 2], [r.left + r.width / 2, r.top - 2], [r.left + r.width / 2, r.bottom + 2], [r.left - 3, r.top], [r.right + 3, r.bottom]]
      .filter(([x, y]) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight);
    if (!pts.length) continue;
    // цвет текста: берём самый контрастный пиксель внутри прямоугольника слова относительно фона
    const bgs = pts.map(([x, y]) => Array.from(cx.getImageData(Math.round(x * sc), Math.round(y * sc), 1, 1).data.slice(0, 3)));
    const bg = bgs[0];
    const rx = Math.max(0, Math.floor(r.left * sc)), ry = Math.max(0, Math.floor(r.top * sc)), rw = Math.max(1, Math.min(cv.width - rx, Math.ceil(r.width * sc))), rh = Math.max(1, Math.min(cv.height - ry, Math.ceil(r.height * sc)));
    const d = cx.getImageData(rx, ry, rw, rh).data; let best = 0, bestPx = null;
    for (let i = 0; i < d.length; i += 4 * 3) { const px = [d[i], d[i + 1], d[i + 2]]; const q = ratio(px, bg); if (q > best) { best = q; bestPx = px; } }
    if (best < 2.4 && !(text === 'Скриншоты' && best > 1)) out.push({ kind: 'текст сливается с фоном', text: text.slice(0, 40), ratio: +best.toFixed(2), bg: bg.join(','), cls: (el.className || el.tagName).toString().slice(0, 40) });
    // обрезка
    const cs = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX !== 'visible' && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll' && !el.closest('.segscroll,.strip,select,input,textarea')) out.push({ kind: 'текст обрезан', text: text.slice(0, 40) });
  }
  // структура: градиентный текст обязан быть вырезан по буквам и иметь светлый (или тёмный на лайме) цвет
  for (const el of document.querySelectorAll('.ink, .dim, .limet, .onlime, .redt')) {
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue; if (!el.closest('body')) continue;
    if (el.closest('.sheet:not(.open), .page:not(.open), .rank-modal:not(.open), #toast:not(.show)')) continue;
    const cs = getComputedStyle(el); const clip = cs.webkitBackgroundClip || cs.backgroundClip;
    const m = cs.backgroundImage.match(/rgb\((\d+), (\d+), (\d+)\)/);
    if (clip !== 'text') out.push({ kind: 'градиентный текст без выреза', text: (el.textContent || '').trim().slice(0, 40), cls: el.className.toString() });
    else if (m) { const L1 = lum([+m[1], +m[2], +m[3]]); const dark = el.classList.contains('onlime'); if (!dark && L1 < 0.12) out.push({ kind: 'тёмный цвет у светлого текста (фон перебил стиль)', text: (el.textContent || '').trim().slice(0, 40), cls: el.className.toString() + ' на ' + el.tagName }); }
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push({ kind: 'горизонтальная прокрутка страницы', text: document.documentElement.scrollWidth + ' > ' + innerWidth });
  return out;
}`;

async function audit(page, name, tag) {
  await wait(450);
  const buf = await page.screenshot(); screens++;
  const out = await page.evaluate(`(${CHECK})('${buf.toString('base64')}')`);
  for (const o of out) problems.push({ screen: `${tag} · ${name}`, ...o });
}
const closeSheets = async (page) => { await page.evaluate(() => { document.getElementById('scrim').click(); document.getElementById('sheet').classList.remove('open'); document.getElementById('scrim').classList.remove('open'); document.getElementById('rankModal').classList.remove('open'); }); await wait(350); };

try {
  // ---------- ученик ----------
  const st = await makeStudent(c, { name: 'E2E Аудит', startDaysAgo: 30, onboardingDone: true });
  const { data: cps } = await c.admin.from('checkpoints').select('*').eq('user_id', st.id).order('idx');
  await c.admin.from('checkpoints').update({ submitted_at: new Date(Date.now() - 30 * 864e5).toISOString() }).eq('id', cps[0].id);
  await c.admin.from('goals').insert([['avg_check', 1500, 2500], ['booking_fill', 55, 85], ['followers', 800, 3000]].map(([k, a, b]) => ({ user_id: st.id, metric_key: k, a_value: a, b_value: b })));
  await c.admin.from('checkpoint_values').insert([['avg_check', 1500], ['booking_fill', 55], ['followers', 800]].map(([k, v]) => ({ checkpoint_id: cps[0].id, metric_key: k, value: v })));
  await c.admin.from('goal_text').insert({ user_id: st.id, why_text: 'Полная запись и чек выше' });
  await c.admin.from('insights').insert([{ user_id: st.id, body: 'Мой вывод для проверки', title: 'Про цену', entry_date: new Date().toISOString().slice(0, 10) }]);
  await c.admin.from('questions').insert([{ user_id: st.id, body: 'Мой вопрос эксперту' }]);
  await c.admin.from('calls').insert([{ user_id: st.id, kind: 'strategy', scheduled_at: new Date(Date.now() + 36e5 * 30).toISOString() }]);
  await c.admin.from('video_logs').insert([{ user_id: st.id, kind: 'client', logged_on: new Date().toISOString().slice(0, 10) }]);
  const sess = await sessionFor(c, st.id);
  for (const [tag, w, h, mobile] of [['телефон', 390, 844, true], ['компьютер', 1440, 900, false], ['планшет', 820, 1100, false]]) {
    const { page, errors } = await openApp(browser, srv.url, sess, { w, h, mobile });
    await page.waitForSelector('.today', { timeout: 25000 }); await wait(900);
    for (const tab of ['today', 'path', 'program', 'notes', 'profile']) {
      await page.click(`[data-tab="${tab}"]`); await wait(500);
      for (let y = 0; y < 3; y++) { await page.evaluate((yy) => window.scrollTo(0, yy * innerHeight * 0.85), y); await audit(page, `${tab} · прокрутка ${y}`, tag); }
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    // окна и формы
    await page.click('[data-tab="today"]'); await wait(400);
    await page.click('#videoRow [data-vopen]'); await audit(page, 'окно: какое видео', tag); await closeSheets(page);
    await page.click('#lvlBtn'); await audit(page, 'окно: уровень', tag); await closeSheets(page);
    await page.click('#pathQ'); await audit(page, 'окно: как читать путь', tag); await closeSheets(page);
    await page.locator('#todayList .row[data-id] [data-open]').first().click(); await audit(page, 'окно: задание', tag); await closeSheets(page);
    if (await page.locator('#checkBtn').count()) { await page.click('#checkBtn'); await wait(500); await audit(page, 'форма замера', tag); await page.evaluate(() => document.querySelector('[data-back]').click()); await wait(500); }
    await page.click('[data-tab="notes"]'); await page.click('#addIns'); await audit(page, 'окно: новый вывод', tag); await closeSheets(page);
    await page.locator('[data-ed]').first().click().catch(() => {}); await closeSheets(page);
    await page.click('[data-s="questions"]'); await page.click('#addQ'); await audit(page, 'окно: новый вопрос', tag); await closeSheets(page);
    await page.click('[data-tab="profile"]'); await page.click('#trashBtn'); await audit(page, 'окно: корзина', tag); await closeSheets(page);
    await page.click('[data-tab="path"]'); await wait(300); await page.locator('[data-m]').first().click(); await audit(page, 'окно: история метрики', tag); await closeSheets(page);
    if (errors.length) problems.push({ screen: tag, kind: 'ошибки в консоли', text: errors.join(' | ').slice(0, 200) });
    await page.context().close();
  }
  // онбординг
  const nb = await makeStudent(c, { name: 'E2E Новый', startDaysAgo: 0 });
  { const { page } = await openApp(browser, srv.url, await sessionFor(c, nb.id), { w: 390, h: 844 }); await page.waitForSelector('[data-next]', { timeout: 20000 });
    for (let i = 0; i < 6; i++) { await audit(page, `онбординг шаг ${i + 1}`, 'телефон'); await page.click('[data-next]'); await wait(700); } await page.context().close(); }

  // ---------- админ ----------
  const adm = await makeAdmin(c);
  for (const [tag, w, h, mobile] of [['админ телефон', 390, 844, true], ['админ компьютер', 1440, 900, false]]) {
    const { page, errors } = await openApp(browser, srv.url, await sessionFor(c, adm.id), { w, h, mobile });
    await page.waitForSelector('#stList .row', { timeout: 25000 }); await wait(700);
    for (const tab of ['students', 'summary', 'program', 'content']) { await page.click(`[data-tab="${tab}"]`); await wait(600); await audit(page, `админ ${tab}`, tag); }
    await page.click('[data-tab="students"]'); await wait(300);
    await page.click('#addSt'); await page.waitForSelector('#f_tariff_code'); await audit(page, 'форма: новый ученик', tag);
    await page.click('#f_tariff_code'); await audit(page, 'форма: выбор тарифа', tag); await closeSheets(page);
    await page.locator('#stList .row', { hasText: 'E2E Аудит' }).click(); await page.waitForSelector('#pageBody .card'); await wait(900);
    for (let y = 0; y < 5; y++) { await page.evaluate((yy) => document.getElementById('page').scrollTo(0, yy * innerHeight * 0.85), y); await audit(page, `карточка ученика ${y}`, tag); }
    for (const id of ['#aTariff', '#aShift', '#aBlocks']) { await page.evaluate((s) => { document.getElementById('page').scrollTop = 99999; document.querySelector(s)?.scrollIntoView(); }, id); await page.click(id); await audit(page, `форма ${id}`, tag); await closeSheets(page); }
    await page.evaluate(() => document.querySelector('[data-back]').click()); await wait(500);
    await page.click('[data-tab="program"]'); await wait(400); await page.click('#pAdd'); await page.waitForSelector('#f_kind'); await audit(page, 'форма: пункт программы', tag); await page.click('#f_kind'); await audit(page, 'выбор типа пункта', tag); await closeSheets(page);
    for (const [btn, name] of [['#pPrev', 'как видит ученик'], ['#pImp', 'импорт'], ['#pTrash', 'корзина'], ['#pHist', 'история правок']]) { await page.click(btn); await audit(page, `окно: ${name}`, tag); await closeSheets(page); }
    await closeSheets(page); await page.evaluate(() => document.querySelector('[data-tab="content"]').click()); await wait(500);
    for (const k of ['quotes', 'movies', 'triggers', 'ach', 'metrics', 'ch', 'tariffs', 'mech']) { await page.click(`[data-s="${k}"]`); await page.waitForSelector('#page.open'); await wait(500); await audit(page, `контент: ${k}`, tag); await page.evaluate(() => document.querySelector('[data-back]').click()); await wait(400); }
    if (errors.length) problems.push({ screen: tag, kind: 'ошибки в консоли', text: errors.join(' | ').slice(0, 200) });
    await page.context().close();
  }
} catch (e) { problems.push({ screen: 'сценарий', kind: 'СБОЙ', text: e.message.slice(0, 300) }); }
finally {
  await browser.close(); srv.stop(); await cleanupE2E(c);
  const uniq = new Map(); for (const p of problems) { const k = p.kind + '|' + p.text + '|' + p.cls; if (!uniq.has(k)) uniq.set(k, { ...p, screens: [p.screen] }); else uniq.get(k).screens.push(p.screen); }
  console.log(`проверено экранов и окон: ${screens}, уникальных проблем: ${uniq.size}`);
  for (const p of uniq.values()) console.log(`- ${p.kind}: «${p.text}» ${p.ratio ? 'контраст ' + p.ratio + ' ' : ''}${p.cls ? '[' + p.cls + '] ' : ''}(${[...new Set(p.screens)].slice(0, 3).join('; ')}${new Set(p.screens).size > 3 ? ' и ещё ' + (new Set(p.screens).size - 3) : ''})`);
  process.exit(uniq.size ? 1 : 0);
}
