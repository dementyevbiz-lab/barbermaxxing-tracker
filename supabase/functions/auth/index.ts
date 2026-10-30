// Вход в Mini App (разделы 5 и 18 ТЗ)
// 1. Проверяет подпись initData токеном бота и свежесть auth_date (не старше суток)
// 2. Находит ученика по telegram_id или привязывает одноразовый код приглашения (start_param)
// 3. Выдаёт обычную сессию Supabase, чтобы auth.uid() = profiles.id и работал RLS
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? SERVICE;
const MAX_AGE_SEC = 24 * 60 * 60;
const EMAIL_DOMAIN = "users.barbermaxxing.invalid";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
}
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Проверка по документации Telegram: data_check_string из всех полей кроме hash, по алфавиту
async function verifyInitData(initData: string) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dcs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = await hmac(new TextEncoder().encode("WebAppData"), BOT_TOKEN);
  const calc = hex(await hmac(secret, dcs));
  if (!safeEqual(calc, hash)) return null;
  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_SEC) return { expired: true } as const;
  const user = JSON.parse(params.get("user") || "null");
  if (!user?.id) return null;
  return { expired: false, user, startParam: params.get("start_param") || "" } as const;
}

async function log(tg: { id: number; username?: string; first_name?: string }, ok: boolean, reason: string) {
  await admin.from("login_log").insert({ telegram_id: tg.id, tg_username: tg.username ?? null, first_name: tg.first_name ?? null, ok, reason });
}

async function failedLastHour(tgId: number) {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from("login_log").select("id", { count: "exact", head: true })
    .eq("telegram_id", tgId).eq("ok", false).in("reason", ["bad_code", "no_invite"]).gte("created_at", since);
  return count ?? 0;
}

// Сессия без пароля: одноразовая ссылка генерируется и сразу подтверждается на сервере, письмо никуда не уходит
async function sessionFor(email: string) {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data?.properties?.hashed_token) throw error ?? new Error("no token");
  const pub = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: s, error: e2 } = await pub.auth.verifyOtp({ type: "magiclink", token_hash: data.properties.hashed_token });
  if (e2 || !s.session) throw e2 ?? new Error("no session");
  return { access_token: s.session.access_token, refresh_token: s.session.refresh_token, expires_at: s.session.expires_at };
}

// Админ без профиля ученика: отдельный пользователь auth с почтой по Telegram ID
async function adminOnlyUser(tgId: number) {
  const email = `admin-${tgId}@${EMAIL_DOMAIN}`;
  const { error } = await admin.auth.admin.createUser({ email, email_confirm: true, app_metadata: { telegram_id: tgId } });
  if (error && !/already|registered|exists/i.test(error.message)) throw error;
  return email;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!BOT_TOKEN) return json({ error: "no_bot_token" }, 500);

  let initData = "";
  try { initData = String((await req.json()).initData || ""); } catch { /* пусто */ }
  if (!initData) return json({ error: "no_init_data" }, 400);

  const v = await verifyInitData(initData);
  if (!v) return json({ error: "bad_signature" }, 401);
  if (v.expired) return json({ error: "expired" }, 401);
  const tg = v.user as { id: number; username?: string; first_name?: string; last_name?: string };

  try {
    const limits = (await admin.from("settings").select("value").eq("key", "invite_rate_limit").maybeSingle()).data?.value;
    const maxFailed = Number(limits?.max_failed_per_hour ?? 10);

    let { data: profile } = await admin.from("profiles").select("*").eq("telegram_id", tg.id).maybeSingle();

    // Первый вход по приглашению
    if (!profile && v.startParam) {
      if ((await failedLastHour(tg.id)) >= maxFailed) {
        await log(tg, false, "rate_limited");
        return json({ error: "rate_limited" }, 429);
      }
      const { data: invited } = await admin.from("profiles").select("*")
        .eq("invite_code", v.startParam).is("telegram_id", null).neq("status", "disabled").maybeSingle();
      if (invited) {
        const { data: bound, error } = await admin.from("profiles")
          .update({ telegram_id: tg.id, tg_username: tg.username ?? null, invite_code: null,
                    status: invited.status === "invited" ? "active" : invited.status })
          .eq("id", invited.id).is("telegram_id", null).select("*").maybeSingle();
        if (error) throw error;
        if (bound) {
          await admin.auth.admin.updateUserById(bound.id, { app_metadata: { telegram_id: tg.id } });
          profile = bound;
        }
      } else {
        await log(tg, false, "bad_code");
      }
    }

    const { data: adm } = await admin.from("admins").select("telegram_id").eq("telegram_id", tg.id).maybeSingle();
    const isAdmin = !!adm;

    if (profile?.status === "disabled") profile = null;

    if (!profile && !isAdmin) {
      if (!v.startParam) await log(tg, false, "no_invite");
      return json({ access: false, telegram_id: tg.id });
    }

    let email: string;
    if (profile) {
      const { data: u, error } = await admin.auth.admin.getUserById(profile.id);
      if (error || !u.user?.email) throw error ?? new Error("no user");
      email = u.user.email;
      if (u.user.app_metadata?.telegram_id !== tg.id) {
        await admin.auth.admin.updateUserById(profile.id, { app_metadata: { telegram_id: tg.id } });
      }
      await admin.from("profiles").update({ last_seen_at: new Date().toISOString(), tg_username: tg.username ?? null }).eq("id", profile.id);
    } else {
      email = await adminOnlyUser(tg.id);
    }

    const session = await sessionFor(email);
    await log(tg, true, "ok");
    return json({
      access: true,
      role: isAdmin ? "admin" : "student",
      is_student: !!profile,
      telegram_id: tg.id,
      first_name: tg.first_name ?? "",
      session,
    });
  } catch (e) {
    console.error(e);
    return json({ error: "server", message: String((e as Error)?.message ?? e) }, 503);
  }
});
