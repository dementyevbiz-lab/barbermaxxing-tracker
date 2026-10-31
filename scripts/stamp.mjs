// Подписывает файлы приложения версией (по содержимому), чтобы Telegram и браузеры не показывали старую закэшированную версию.
// Запускать перед каждой выкладкой: node scripts/stamp.mjs
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const root = new URL('../', import.meta.url).pathname;
const walk = (d) => readdirSync(join(root, d)).flatMap((f) => (statSync(join(root, d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const files = [...walk('js'), 'css/app.css', 'config.js'].sort();
const h = createHash('sha1'); for (const f of files) h.update(f + readFileSync(join(root, f)));
const v = h.digest('hex').slice(0, 10);
const map = Object.fromEntries(files.filter((f) => f.startsWith('js/')).map((f) => ['./' + f, `./${f}?v=${v}`]));
let html = readFileSync(join(root, 'index.html'), 'utf8');
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>\n?/, '');
html = html.replace('<script src="https://telegram.org', `<script type="importmap">${JSON.stringify({ imports: map })}</script>\n<script src="https://telegram.org`);
html = html.replace(/config\.js(\?v=\w+)?"/, `config.js?v=${v}"`).replace(/css\/app\.css(\?v=\w+)?"/, `css/app.css?v=${v}"`).replace(/js\/main\.js(\?v=\w+)?"/, `js/main.js?v=${v}"`);
writeFileSync(join(root, 'index.html'), html);
console.log('версия', v, 'файлов', files.length);
