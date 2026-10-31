// Итоговый PDF: один лист А4 в стиле презентации. Собирается на устройстве (html2canvas + jsPDF), без сторонних сервисов.
// В нём только факты: цифры, скриншоты, активность. Без инструкций и выводов эксперта
import { state, esc, toast } from './core.js';
import * as L from './logic.js';
import * as data from './data.js';
import { fmtMetric, SCREEN_KINDS } from './ui.js';

const LIBS = [
  ['html2canvas', 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'],
  ['jspdf', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'],
];
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Не загрузилась библиотека PDF')); document.head.appendChild(s); });
}
async function libs() { for (const [g, src] of LIBS) if (!window[g]) await loadScript(src); }

const TRI = '<svg width="9" height="9" viewBox="0 0 12 12" style="margin:0 4px"><path d="M2.5 1 L10 6 L2.5 11 Z" fill="#BBFF68"/></svg>';
const LIME = '#BBFF68', LIME2 = '#F1FF6E', CARD = 'linear-gradient(135deg,#3D403D,#1C1F1C)', ROW = 'linear-gradient(135deg,#262626,#121212)';

async function imageUrls(shots) {
  const urls = await data.signedUrls(shots.map((s) => s.storage_path));
  const out = {};
  for (const s of shots) { try { const r = await fetch(urls[s.storage_path]); out[s.id] = URL.createObjectURL(await r.blob()); } catch (e) { out[s.id] = ''; } }
  return out;
}

function spark(points, w = 120, h = 28) {
  if (!points.length) return '';
  const v = points.map((p) => p.value), min = Math.min(...v), max = Math.max(...v), span = max - min || 1, step = points.length > 1 ? (w - 8) / (points.length - 1) : 0;
  const xy = points.map((p, i) => [4 + i * step, h - 4 - ((p.value - min) / span) * (h - 8)]);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${points.length > 1 ? `<path d="${xy.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ')}" fill="none" stroke="#576624" stroke-width="2.5" stroke-linecap="round"/>` : ''}${xy.map((q, i) => `<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="${i === xy.length - 1 ? 4 : 3}" fill="${i === xy.length - 1 ? LIME : '#576624'}"/>`).join('')}</svg>`;
}

export async function buildPdf() {
  await libs();
  const D = state.D, p = D.profile, t = p.tariff || {};
  const info = L.weekInfo(p, t, L.startOfDay()), items = L.visibleItems(D);
  const { R, rows } = L.calcR(D), P = L.calcP(D, R, info, items);
  const xp = data.xpNow(), step = data.lvlStep(), Lv = L.levelOf(xp, step), rank = L.rankOf(Lv, data.ranksList());
  const { done, notes } = L.doneSets(D);
  const cnt = { lesson: 0, homework: 0, notes: notes.size };
  for (const i of items) if (done.has(i.id)) { if (i.kind === 'lesson' || i.kind === 'live' || i.kind === 'material') cnt.lesson++; if (i.kind === 'homework') cnt.homework++; }
  const vids = L.videoCounts(D);
  const metrics = D.metrics.filter((m) => m.active && (D.goals[m.key] || L.metricSeries(D, m.key).length));
  const tierNames = D.settings.tier_names || ['Бронза', 'Серебро', 'Золото', 'Платина'];
  const topAch = D.userAch.filter((u) => !u.revoked_at).sort((a, b) => b.tier - a.tier).slice(0, 3).map((u) => ({ a: D.achievements.find((x) => x.code === u.code), tier: u.tier }));
  const sent = L.submittedCheckpoints(D);
  const first = sent[0], last = sent.length > 1 ? sent[sent.length - 1] : null;
  const pick = (cp, n) => cp ? D.screenshots.filter((s) => s.checkpoint_id === cp.id && !s.deleted_at).sort((a, b) => SCREEN_KINDS.findIndex((k) => k[0] === a.kind) - SCREEN_KINDS.findIndex((k) => k[0] === b.kind)).slice(0, n) : [];
  const shotsA = pick(first, 3), shotsB = pick(last, 3);
  const urls = await imageUrls([...shotsA, ...shotsB]);

  const start = p.start_date ? L.parseDay(p.start_date) : null, end = start ? L.addDays(start, (t.weeks || 0) * 7 - 1) : null;
  const probe = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); probe.setAttribute('width', '0'); probe.style.position = 'fixed';
  const probePath = document.createElementNS('http://www.w3.org/2000/svg', 'path'); probePath.setAttribute('d', 'M26 170 C 74 178, 98 124, 142 120 C 192 116, 194 66, 238 58 C 266 53, 284 42, 294 32');
  probe.appendChild(probePath); document.body.appendChild(probe);
  const gp = (tt) => probePath.getPointAtLength(Math.max(0, Math.min(1, tt)) * probePath.getTotalLength());
  const ptR = R != null ? gp(R) : null, ptP = gp(P); probe.remove();

  const root = document.createElement('div');
  root.id = 'pdfRoot';
  root.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;height:1123px;background:#0B0C0B;color:#fff;font-family:"Golos Text",system-ui,sans-serif;overflow:hidden';
  const final = D.checkpoints.find((c) => c.kind === 'final' && c.submitted_at);
  const nowLabel = final ? 'Итог' : 'Сейчас';
  const dateOf = (cp) => cp ? L.fmtDay(new Date(cp.submitted_at)) : '';
  const shotBlock = (list, title, cp) => `<div style="flex:1;min-width:0"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:8px"><span style="font-weight:700;text-transform:uppercase;letter-spacing:-.02em">${title}</span><span style="color:#8A8A8A">${esc(dateOf(cp))}</span></div>
    <div style="display:flex;gap:8px">${list.length ? list.map((s) => `<div style="flex:1;height:236px;border-radius:26px;padding:2px;background:linear-gradient(135deg,${LIME},${LIME2})"><img src="${urls[s.id]}" style="width:100%;height:100%;object-fit:cover;border-radius:24px;display:block"></img></div>`).join('') : '<div style="flex:1;height:236px;border-radius:26px;background:' + ROW + ';display:flex;align-items:center;justify-content:center;font-size:12px;color:#6E6E6E">Скриншотов нет</div>'}</div></div>`;
  const card = (inner, extra = '') => `<div style="background:${CARD};border-radius:44px;padding:20px 24px;border:1px solid rgba(255,255,255,.08);${extra}">${inner}</div>`;
  const hd = (t, right = '') => `<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px"><span style="font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:-.02em">${t}</span><span style="font-size:12px;color:#8A8A8A">${right}</span></div>`;
  const bar = (pct) => `<div style="height:8px;border-radius:8px;background:rgba(255,255,255,.1);overflow:hidden"><div style="height:100%;width:${Math.round(pct)}%;border-radius:8px;background:linear-gradient(135deg,${LIME},${LIME2})"></div></div>`;
  const maxV = Math.max(vids.client, vids.expert, vids.life, 1);
  const tile = (n, v) => `<div style="flex:1;background:${ROW};border-radius:30px;padding:12px 16px"><div style="font-weight:700;font-size:28px;letter-spacing:-.03em;line-height:1">${v}</div><div style="font-size:12px;color:#A6A6A6;margin-top:6px">${n}</div></div>`;
  root.innerHTML = `
    <div style="padding:40px 46px;display:flex;flex-direction:column;gap:18px;height:100%;box-sizing:border-box;background:linear-gradient(135deg,#000,#1C1E1C)">
      <div style="display:flex;align-items:flex-end;justify-content:space-between">
        <div><div style="font-weight:700;font-size:13px;letter-spacing:-.02em;color:${LIME}">BARBERMAXXING · ИТОГ ПРОГРАММЫ</div><div style="font-weight:700;font-size:38px;letter-spacing:-.03em;line-height:1.05;margin-top:6px">${esc(p.display_name)}</div>
          <div style="font-size:14px;color:#A6A6A6;margin-top:6px">${esc(t.name || '')}${start ? ' · с ' + L.fmtDay(start) + ' по ' + L.fmtDay(end) : ''}</div></div>
        <div style="display:flex;align-items:center;gap:14px"><div style="width:62px;height:62px;border-radius:50%;background:linear-gradient(135deg,${LIME},${LIME2});color:#0F0F0F;font-weight:700;font-size:28px;display:flex;align-items:center;justify-content:center">${Lv}</div>
          <div><div style="font-weight:700;font-size:20px">${esc(rank)}</div><div style="font-size:13px;color:#A6A6A6">${L.fmtNum(xp)} опыта</div></div></div>
      </div>
      <div style="display:flex;gap:16px">
        ${card(`${hd('Мой путь')}<svg viewBox="0 0 320 204" width="100%" style="display:block"><path d="M26 170 C 74 178, 98 124, 142 120 C 192 116, 194 66, 238 58 C 266 53, 284 42, 294 32" fill="none" stroke="${LIME}" stroke-width="4" stroke-linecap="round" stroke-dasharray="9 11"/>
            <circle cx="26" cy="170" r="10" fill="#3D4A1A" stroke="${LIME}" stroke-width="2"/><circle cx="294" cy="32" r="12" fill="${LIME}"/>
            <text x="8" y="199" font-weight="700" font-size="14" fill="#fff">Старт</text><text x="262" y="12" font-weight="700" font-size="14" fill="#fff">Цель</text>
            ${ptR ? `<circle cx="${ptR.x.toFixed(1)}" cy="${ptR.y.toFixed(1)}" r="8.5" fill="${LIME}" stroke="#121212" stroke-width="3"/>` : ''}
            <circle cx="${ptP.x.toFixed(1)}" cy="${ptP.y.toFixed(1)}" r="13" fill="none" stroke="${LIME}" stroke-width="2.2" stroke-dasharray="4 4"/></svg>
          <div style="font-size:12px;color:#A6A6A6;display:flex;gap:16px;margin-top:2px">${ptR ? `<span style="color:${LIME}">●</span><span>${nowLabel}</span>` : ''}<span style="color:${LIME}">◌</span><span>Куда ведёт текущий темп</span></div>
          ${D.goalText ? `<div style="font-size:14px;margin-top:8px">${esc(D.goalText)}</div>` : ''}`, 'flex:1.1;')}
        <div style="flex:1;display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;gap:10px">${tile('Уроков и материалов', cnt.lesson)}${tile('Домашек', cnt.homework)}${tile('Конспектов', cnt.notes)}</div>
          <div style="background:${ROW};border-radius:30px;padding:14px 18px"><div style="display:flex;justify-content:space-between;margin-bottom:8px"><span style="font-weight:700;font-size:12px;text-transform:uppercase">Видео по направлениям</span><span style="font-size:12px;color:#A6A6A6">всего ${vids.total}</span></div>
            ${[['С клиентом', vids.client], ['Экспертное', vids.expert], ['Лайф', vids.life]].map(([n, v]) => `<div style="margin-top:8px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span>${n}</span><span style="color:#A6A6A6">${v}</span></div>${bar(v / maxV * 100)}</div>`).join('')}</div>
          <div style="background:${ROW};border-radius:30px;padding:14px 18px;flex:1"><div style="font-weight:700;font-size:12px;text-transform:uppercase;margin-bottom:6px">Три лучшие ачивки</div>
            ${topAch.length ? topAch.map((x) => `<div style="display:flex;justify-content:space-between;font-size:14px;padding:3px 0"><span>${esc(x.a?.name || '')}</span><span style="color:${LIME};font-weight:700">${esc(tierNames[x.tier - 1] || '')}</span></div>`).join('') : '<div style="font-size:13px;color:#6E6E6E">Пока нет</div>'}</div>
        </div>
      </div>
      ${card(`${hd('Цифры от старта к итогу', 'А'+TRI+nowLabel+TRI+'Б')}
        ${metrics.map((m) => { const g = D.goals[m.key] || {}, ser = L.metricSeries(D, m.key), nowV = ser.length > 1 ? ser[ser.length - 1].value : null, r = rows.find((x) => x.key === m.key);
          return `<div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-top:1px solid rgba(255,255,255,.07)"><div style="width:150px;font-size:13px;font-weight:500">${esc(m.name)}</div>
            <div style="width:84px;font-size:12px;color:#A6A6A6">${esc(fmtMetric(m, g.a))}</div>
            <div style="flex:1">${r && r.progress != null ? bar(r.progress * 100) : '<div style="height:8px"></div>'}</div>
            <div style="width:96px;font-size:14px;font-weight:700;color:${LIME};text-align:right">${esc(fmtMetric(m, nowV))}</div>
            <div style="width:84px;font-size:12px;color:#A6A6A6;text-align:right">${esc(fmtMetric(m, g.b))}</div>
            <div style="width:110px">${spark(ser, 110, 30)}</div></div>`; }).join('') || '<div style="font-size:13px;color:#A6A6A6">Цифры появятся после замеров</div>'}`)}
      <div style="display:flex;gap:16px">${shotBlock(shotsA, 'Старт', first)}${shotBlock(shotsB, last ? (last.kind === 'final' ? 'Итог' : 'Последний замер') : 'Итог', last)}</div>
      <div style="margin-top:auto;font-size:11px;color:#6E6E6E;display:flex;justify-content:space-between"><span>Barbermaxxing</span><span>${L.fmtDay(new Date())}</span></div>
    </div>`;
  document.body.appendChild(root);
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await Promise.all([...root.querySelectorAll('img')].map((im) => im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; })));
    const canvas = await window.html2canvas(root, { scale: 2, useCORS: true, backgroundColor: '#0B0C0B', logging: false });
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 210, 297);
    return { blob: pdf.output('blob'), canvas };
  } finally { root.remove(); }
}

export async function makeSummaryPdf() {
  const { blob } = await buildPdf();
  const name = `barbermaxxing-itog-${(state.D.profile.display_name || 'uchenik').replace(/\s+/g, '-')}.pdf`;
  await data.saveFile(blob, name);
  toast('PDF готов');
}
