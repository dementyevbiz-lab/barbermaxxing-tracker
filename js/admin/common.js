// Общее для админки: данные, форма в окне, помощники
import { sb, state, esc, readOrThrow, openSheet, closeSheet, toast, confirmBox, uuid } from '../core.js';
import * as L from '../logic.js';

export const A = { loaded: false };
const all = (t, f) => readOrThrow(f ? f(sb.from(t).select('*')) : sb.from(t).select('*'));

export async function loadAdminData() {
  const [profiles, tariffs, metrics, items, completions, videos, checkpoints, cpValues, goals, goalText, ledger, userAch, achievements, calls, notes, challenges, challengeResults, settings, triggers, quotes, movies, screenshots] = await Promise.all([
    all('profiles', (q) => q.order('created_at')), all('tariffs', (q) => q.order('id')), all('metrics', (q) => q.order('ord')),
    all('program_items', (q) => q.order('week').order('ord')), all('completions'), all('video_logs'), all('checkpoints', (q) => q.order('idx')),
    all('checkpoint_values'), all('goals'), all('goal_text'), all('xp_ledger'), all('user_achievements'), all('achievements'), all('calls'),
    all('admin_notes', (q) => q.order('created_at', { ascending: false })), all('challenges'), all('challenge_results'), all('settings'), all('triggers'),
    all('quotes'), all('movies'), all('screenshots'),
  ]);
  Object.assign(A, { profiles, tariffs, metrics, items, completions, videos, checkpoints, goals, goalText, ledger, userAch, achievements, calls, notes, challenges, challengeResults, triggers, quotes, movies, screenshots, loaded: true });
  A.settings = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  A.cpValues = {}; for (const v of cpValues) (A.cpValues[v.checkpoint_id] ||= {})[v.metric_key] = v.value;
  for (const p of A.profiles) p.tariff = A.tariffs.find((t) => t.id === p.tariff_id) || null;
}

// Данные одного ученика в том виде, что понимает logic.js
export function asD(p) {
  const uid = p.id;
  return {
    profile: p, settings: A.settings, metrics: A.metrics, items: A.items,
    goals: Object.fromEntries(A.goals.filter((g) => g.user_id === uid).map((g) => [g.metric_key, { a: g.a_value, b: g.b_value }])),
    goalText: A.goalText.find((g) => g.user_id === uid)?.why_text || '',
    completions: A.completions.filter((c) => c.user_id === uid), videos: A.videos.filter((v) => v.user_id === uid),
    checkpoints: A.checkpoints.filter((c) => c.user_id === uid), cpValues: A.cpValues,
    calls: A.calls.filter((c) => c.user_id === uid), insights: [], questions: [], triggers: A.triggers, triggerLog: [], quotes: [], quoteShown: [], movies: [],
    ledger: A.ledger.filter((l) => l.user_id === uid), userAch: A.userAch.filter((u) => u.user_id === uid), screenshots: A.screenshots.filter((s) => s.user_id === uid),
    achievements: A.achievements, challenges: A.challenges, challengeResults: A.challengeResults.filter((r) => r.user_id === uid),
  };
}

// Сводка по ученику для списка и сводки
export function summarize(p, today = L.startOfDay()) {
  const D = asD(p), info = L.weekInfo(p, p.tariff, today), items = L.visibleItems(D), { done } = L.doneSets(D);
  const expected = info.state === 'active' || info.state === 'finished' ? items.filter((i) => i.required && ['lesson', 'live', 'homework'].includes(i.kind) && i.week <= info.n) : [];
  const share = expected.length ? expected.filter((i) => done.has(i.id)).length / expected.length : null;
  const cp = D.checkpoints.filter((c) => !c.submitted_at).sort((a, b) => a.idx - b.idx)[0];
  const left = cp ? L.diffDays(L.parseDay(cp.due_date), today) : null;
  const cpState = !cp ? 'done' : left < 0 ? 'overdue' : left <= 2 ? 'soon' : 'ok';
  const rules = A.settings.admin_rules || {};
  const seen = p.last_seen_at ? L.diffDays(today, L.startOfDay(new Date(p.last_seen_at))) : null;
  const inactive = p.status === 'active' && (seen == null ? info.state === 'active' && L.diffDays(today, info.start) >= (rules.inactive_days ?? 5) : seen >= (rules.inactive_days ?? 5));
  const lagging = share != null && expected.length >= 2 && share < (rules.lagging_share ?? 0.5) && info.state === 'active';
  const xp = L.xpTotal(D.ledger);
  const { R } = L.calcR(D);
  return { p, D, info, items, share, cp, left, cpState, inactive, lagging, xp, R, P: L.calcP(D, R, info, items), expected };
}

// ---------- форма в окне ----------
// fields: [{ k, label, type: text|area|number|select|check|date|datetime|tags|checks, options: [[value,label]], hint }]
export function formSheet({ title, fields, initial = {}, saveLabel = 'Сохранить', onSave, extra = '', onMount, danger }) {
  const val = (f) => initial[f.k];
  const html = fields.map((f) => {
    const v = val(f), id = 'f_' + f.k;
    if (f.type === 'check') return `<label class="row static" style="gap:14px"><span class="row-main"><span class="ink t">${esc(f.label)}</span>${f.hint ? `<span class="dim cap">${esc(f.hint)}</span>` : ''}</span><button type="button" class="toggle ${v ? 'on' : ''}" data-check="${f.k}"></button></label>`;
    if (f.type === 'checks') return `<div class="lbl"><span class="cap dim">${esc(f.label)}</span><div class="btns">${f.options.map(([o, t]) => `<button type="button" class="btn sm ${(v || []).includes(o) ? 'pri' : ''}" data-multi="${f.k}" data-v="${esc(o)}"><span class="${(v || []).includes(o) ? 'onlime' : 'ink'}">${esc(t)}</span></button>`).join('')}</div></div>`;
    const lbl = `<span class="cap dim">${esc(f.label)}</span>`;
    let inp;
    if (f.type === 'area') inp = `<textarea class="field area" id="${id}" ${f.max ? `maxlength="${f.max}"` : ''}>${esc(v ?? '')}</textarea>`;
    else if (f.type === 'select') inp = `<select class="field" id="${id}">${f.options.map(([o, t]) => `<option value="${esc(o)}" ${String(o) === String(v ?? '') ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
    else if (f.type === 'tags') inp = `<input class="field" id="${id}" value="${esc((v || []).join(', '))}" placeholder="через запятую">`;
    else inp = `<input class="field" id="${id}" type="${f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'datetime' ? 'datetime-local' : 'text'}" ${f.type === 'number' ? 'step="any" inputmode="decimal"' : ''} value="${esc(v ?? '')}">`;
    return `<div class="lbl">${lbl}${inp}${f.hint ? `<span class="cap dim">${esc(f.hint)}</span>` : ''}</div>`;
  }).join('');
  openSheet(`<h2 class="sh-title"><span class="ink">${esc(title)}</span></h2>${html}${extra}
    <div class="btns"><button class="btn pri" id="fSave" style="flex:1"><span class="onlime">${esc(saveLabel)}</span></button>${danger ? `<button class="btn" id="fDanger"><span class="redt">${esc(danger.label)}</span></button>` : ''}</div>`,
  (sh) => {
    const cur = { ...initial };
    sh.querySelectorAll('[data-check]').forEach((b) => b.onclick = () => { b.classList.toggle('on'); cur[b.dataset.check] = b.classList.contains('on'); });
    sh.querySelectorAll('[data-multi]').forEach((b) => b.onclick = () => {
      const k = b.dataset.multi, v = b.dataset.v, set = new Set(cur[k] || []); set.has(v) ? set.delete(v) : set.add(v); cur[k] = [...set];
      const on = set.has(v); b.classList.toggle('pri', on); b.firstElementChild.className = on ? 'onlime' : 'ink';
    });
    onMount && onMount(sh, cur);
    sh.querySelector('#fSave').onclick = async (e) => {
      const out = { ...cur };
      for (const f of fields) {
        if (f.type === 'check' || f.type === 'checks') continue;
        const el = sh.querySelector('#f_' + f.k); let v = el.value;
        if (f.type === 'number') v = v === '' ? null : Number(String(v).replace(',', '.'));
        else if (f.type === 'tags') v = v.split(',').map((x) => x.trim()).filter(Boolean);
        else if (f.type === 'text' || f.type === 'area') v = v.trim();
        else if (v === '') v = null;
        out[f.k] = v;
        if (f.required && (v == null || v === '' || (Array.isArray(v) && !v.length))) { toast('Заполните: ' + f.label); el.focus(); return; }
      }
      const btn = e.currentTarget; btn.disabled = true;
      try { const r = await onSave(out); if (r !== false) closeSheet(); } catch (err) { toast(err.message || 'Не получилось'); }
      btn.disabled = false;
    };
    if (danger) sh.querySelector('#fDanger').onclick = async () => { if (await confirmBox(danger.confirm || 'Точно?')) { await danger.run(); closeSheet(); } };
  });
}

export const fmtDT = (s) => { if (!s) return ''; const d = new Date(s); return `${L.fmtDay(d)}, ${L.fmtTime(d)}`; };
export const toLocalInput = (s) => { if (!s) return ''; const d = new Date(s); return `${d.getFullYear()}-${L.pad(d.getMonth() + 1)}-${L.pad(d.getDate())}T${L.pad(d.getHours())}:${L.pad(d.getMinutes())}`; };
export async function dbOk(p) { const r = await p; if (r.error) throw new Error(r.error.message); return r.data; }
export const csvParse = (text) => {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',' || ch === ';') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else if (ch !== '\r') cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
};
