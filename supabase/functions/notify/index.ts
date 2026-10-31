// Напоминания бота. Вызывается по расписанию (pg_cron) с секретом в заголовке x-cron-secret.
// Тело: { mode: 'daily' | 'calls' | 'all', dry?: true }. При dry сообщения не отправляются, функция только показывает план
import { adminClient, corsHeaders, env, json } from "../_shared/common.ts";
import { plan, type Msg } from "../_shared/notify.ts";

async function send(token: string, m: Msg, appUrl: string): Promise<{ ok: boolean; blocked: boolean }> {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: m.chat_id, text: m.text, reply_markup: { inline_keyboard: [[{ text: 'Открыть', web_app: { url: appUrl } }]] } }),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: !!j.ok, blocked: r.status === 403 };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const secret = Deno.env.get('NOTIFY_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json({ ok: false }, 403);
  try {
    const body = await req.json().catch(() => ({}));
    const mode = ['daily', 'calls', 'all'].includes(body.mode) ? body.mode : 'all';
    const db = adminClient();
    const [{ data: profiles }, { data: checkpoints }, { data: calls }, { data: sentRows }, { data: st }] = await Promise.all([
      db.from('profiles').select('id, telegram_id, display_name, status, prefs'),
      db.from('checkpoints').select('id, user_id, idx, due_date, submitted_at').is('submitted_at', null),
      db.from('calls').select('id, user_id, kind, scheduled_at').gte('scheduled_at', new Date(Date.now() - 3600_000).toISOString()),
      db.from('notifications').select('user_id, kind, ref_id'),
      db.from('settings').select('value').eq('key', 'bot_notifications').maybeSingle(),
    ]);
    const cfg = (st?.value || {}) as { checkpoint_days_before?: number; retry_after_days?: number; tz?: string };
    const sent = new Set((sentRows || []).map((r) => `${r.user_id}|${r.kind}|${r.ref_id ?? ''}`));
    const msgs = plan({ mode, now: new Date(), tz: cfg.tz || 'Asia/Almaty', profiles: profiles || [], checkpoints: checkpoints || [], calls: calls || [], sent,
      daysBefore: cfg.checkpoint_days_before ?? 2, retryAfterDays: cfg.retry_after_days ?? 2 });
    if (body.dry) return json({ ok: true, dry: true, planned: msgs.map((m) => ({ kind: m.kind, user_id: m.user_id, text: m.text })) });
    const token = env('TELEGRAM_BOT_TOKEN'), appUrl = Deno.env.get('APP_URL') ?? 'https://dementyevbiz-lab.github.io/barbermaxxing-tracker/';
    let ok = 0, blocked = 0, failed = 0;
    for (const m of msgs) {
      const r = await send(token, m, appUrl);
      if (r.ok || r.blocked) { await db.from('notifications').insert({ user_id: m.user_id, kind: m.kind, ref_id: m.ref_id }); }
      if (r.ok) ok++; else if (r.blocked) blocked++; else failed++;
    }
    return json({ ok: true, planned: msgs.length, sent: ok, blocked, failed });
  } catch (e) { console.error(e); return json({ ok: false, message: String((e as Error).message ?? e) }, 500); }
});
