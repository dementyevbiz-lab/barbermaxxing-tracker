// Браузер для сквозной проверки: локальный сервер, прокси окружения, подмена Telegram
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

export async function startServer(root, port = 8099) {
  const srv = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  return { url: `http://127.0.0.1:${port}`, stop: () => srv.kill() };
}
export async function launch() {
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined;
  return chromium.launch({ proxy });
}
export async function openApp(browser, base, session, { w = 390, h = 844, hash = '#test', mobile = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, acceptDownloads: true });
  await ctx.route('https://telegram.org/**', (r) => r.fulfill({ body: '' }));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  if (session) await page.addInitScript((s) => { localStorage.setItem('bmx-auth', JSON.stringify(s)); }, session);
  await page.goto(base + '/index.html' + hash);
  return { ctx, page, errors };
}
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
