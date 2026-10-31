// Вебхук бота: на любое сообщение отвечает кнопкой «Открыть». Настройка вебхука: POST { action: 'setup' } с токеном админа
import { adminClient, corsHeaders, env, json } from "../_shared/common.ts";

const tgApi = (token: string, method: string, body: unknown) => fetch(`https://api.telegram.org/bot${token}/${method}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const token = env('TELEGRAM_BOT_TOKEN'), appUrl = Deno.env.get('APP_URL') ?? 'https://dementyevbiz-lab.github.io/barbermaxxing-tracker/';
  const hook = Deno.env.get('BOT_WEBHOOK_SECRET');
  try {
    // Установка вебхука: только для админа
    if (req.headers.get('x-telegram-bot-api-secret-token') === null && req.headers.get('authorization')) {
      const db = adminClient();
      const { data: u } = await db.auth.getUser((req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, ''));
      const tgId = Number(u?.user?.app_metadata?.telegram_id);
      const { data: adm } = tgId ? await db.from('admins').select('telegram_id').eq('telegram_id', tgId).maybeSingle() : { data: null };
      if (!adm) return json({ ok: false, message: 'Только для команды программы' }, 403);
      const body = await req.json().catch(() => ({}));
      if (body.action !== 'setup') return json({ ok: false, message: 'Неизвестное действие' }, 400);
      const url = `${env('SUPABASE_URL')}/functions/v1/bot`;
      const r = await tgApi(token, 'setWebhook', { url, secret_token: hook, allowed_updates: ['message'], drop_pending_updates: true });
      return json({ ok: !!r.ok, description: r.description });
    }
    // Обновления от Telegram
    if (!hook || req.headers.get('x-telegram-bot-api-secret-token') !== hook) return json({ ok: false }, 403);
    const upd = await req.json();
    const chat = upd.message?.chat?.id;
    if (chat) {
      const first = upd.message.from?.first_name || 'друг';
      await tgApi(token, 'sendMessage', { chat_id: chat, text: `Привет, ${first}! Трекер Barbermaxxing открывается кнопкой ниже`,
        reply_markup: { inline_keyboard: [[{ text: 'Открыть', web_app: { url: appUrl } }]] } });
    }
    return json({ ok: true });
  } catch (e) { console.error(e); return json({ ok: false }, 200); }
});
