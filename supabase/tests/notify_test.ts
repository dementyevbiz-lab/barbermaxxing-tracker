// deno test supabase/tests/notify_test.ts
import { plan, localDay } from '../functions/_shared/notify.ts';
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const now = new Date('2026-10-31T05:00:00Z'); // 10:00 в Алматы
const tz = 'Asia/Almaty';
const P = (id: string, extra = {}) => ({ id, telegram_id: 1, display_name: 'Артём', status: 'active', prefs: {}, ...extra });
const cp = (id: string, user_id: string, idx: number, due_date: string, submitted_at: string | null = null) => ({ id, user_id, idx, due_date, submitted_at });

Deno.test('день по часовому поясу', () => { eq(localDay(new Date('2026-10-31T20:30:00Z'), tz), '2026-11-01', 'сдвиг'); });
Deno.test('замер: за 2 дня, в день срока, одно повторное через 2 дня, потом тишина', () => {
  const profiles = [P('a')];
  const run = (due: string) => plan({ mode: 'daily', now, tz, profiles, checkpoints: [cp('c1', 'a', 1, due)], calls: [], sent: new Set(['a|welcome|']) }).map((m) => m.kind);
  eq(run('2026-11-02'), ['checkpoint_2d'], 'за 2 дня'); eq(run('2026-10-31'), ['checkpoint_due'], 'в день срока');
  eq(run('2026-10-29'), ['checkpoint_retry'], 'повтор'); eq(run('2026-10-28'), [], 'дальше тишина'); eq(run('2026-11-05'), [], 'рано');
});
Deno.test('не шлёт повторно и не шлёт про отправленный замер и точку А', () => {
  const profiles = [P('a')];
  eq(plan({ mode: 'daily', now, tz, profiles, checkpoints: [cp('c1', 'a', 1, '2026-10-31')], calls: [], sent: new Set(['a|welcome|', 'a|checkpoint_due|c1']) }), [], 'уже отправлено');
  eq(plan({ mode: 'daily', now, tz, profiles, checkpoints: [cp('c1', 'a', 1, '2026-10-31', '2026-10-30T00:00:00Z'), cp('c0', 'a', 0, '2026-10-31')], calls: [], sent: new Set(['a|welcome|']) }), [], 'отправлен и точка А');
});
Deno.test('созвон: за сутки и за час', () => {
  const profiles = [P('a')]; const sent = new Set(['a|welcome|']);
  const at = (mins: number) => new Date(now.getTime() + mins * 60000).toISOString();
  const run = (mins: number) => plan({ mode: 'calls', now, tz, profiles, checkpoints: [], calls: [{ id: 'k', user_id: 'a', kind: 'strategy', scheduled_at: at(mins) }], sent }).map((m) => m.kind);
  eq(run(23 * 60), ['call_1d'], 'за сутки'); eq(run(40), ['call_1h'], 'за час'); eq(run(3 * 24 * 60), [], 'рано'); eq(run(-30), [], 'прошёл');
});
Deno.test('приветствие один раз, выключенным и без Telegram ничего', () => {
  eq(plan({ mode: 'daily', now, tz, profiles: [P('a')], checkpoints: [], calls: [], sent: new Set() }).map((m) => m.kind), ['welcome'], 'приветствие');
  const off = [P('a', { prefs: { notifications: false } }), P('b', { prefs: { admin_mute: true } }), P('c', { telegram_id: null }), P('d', { status: 'paused' }), P('e', { status: 'invited' })];
  eq(plan({ mode: 'all', now, tz, profiles: off, checkpoints: [cp('c1', 'a', 1, '2026-10-31')], calls: [], sent: new Set() }), [], 'выключено');
});
