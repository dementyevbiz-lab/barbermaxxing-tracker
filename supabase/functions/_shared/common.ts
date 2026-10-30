// Общее для функций: CORS, ответы, клиенты Supabase, проверка подписи Telegram
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

export function env(name: string, fallback?: string): string {
  const v = Deno.env.get(name) ?? fallback;
  if (v === undefined || v === "") throw new Error(`Не задан секрет ${name}`);
  return v;
}

// Клиент с сервисным ключом: обходит RLS, живёт только внутри функции
export function adminClient(): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Обычный клиент с открытым ключом: им получаем сессию пользователя
export function anonClient(): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const BOT_USERNAME = Deno.env.get("BOT_USERNAME") ?? "barbermaxxing_tracker_bot";

// Технический адрес почты для аккаунта Supabase. Писем на него не шлём
export const EMAIL_DOMAIN = Deno.env.get("ACCOUNT_EMAIL_DOMAIN") ?? "example.com";
export function accountEmail(tag: string): string {
  return `bmx-${tag}@${EMAIL_DOMAIN}`;
}

export function inviteLink(code: string): string {
  return `https://t.me/${BOT_USERNAME}?startapp=${code}`;
}

// Код приглашения: 12 символов, без похожих букв
export function newInviteCode(): string {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => abc[b % abc.length]).join("");
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export type TgUser = { id: number; first_name?: string; last_name?: string; username?: string };
export type InitData = { user: TgUser; start_param?: string; auth_date: number };

// Проверка initData по документации Telegram Mini Apps:
// secret = HMAC_SHA256(key "WebAppData", bot_token), hash = HMAC_SHA256(secret, data_check_string)
export async function verifyInitData(
  initData: string,
  botToken: string,
  maxAgeSec = 86400,
  now = Math.floor(Date.now() / 1000),
): Promise<InitData | null> {
  if (!initData || initData.length > 4096) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const pairs: string[] = [];
  for (const [k, v] of params) pairs.push(`${k}=${v}`);
  pairs.sort();
  const secret = await hmac(new TextEncoder().encode("WebAppData"), botToken);
  const calc = hex(await hmac(secret, pairs.join("\n")));
  if (!safeEqual(calc, hash.toLowerCase())) return null;
  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || now - authDate > maxAgeSec || authDate - now > 300) return null;
  let user: TgUser;
  try {
    user = JSON.parse(params.get("user") ?? "");
  } catch {
    return null;
  }
  if (!user || typeof user.id !== "number") return null;
  const sp = params.get("start_param") ?? undefined;
  return { user, start_param: sp, auth_date: authDate };
}

// Выдать обычную сессию Supabase пользователю: одноразовая ссылка входа и сразу её подтверждение.
// Так auth.uid() в базе = id профиля и работают права RLS
export async function issueSession(admin: SupabaseClient, email: string) {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data?.properties?.hashed_token) throw new Error("generateLink: " + (error?.message ?? "нет токена"));
  const { data: s, error: e2 } = await anonClient().auth.verifyOtp({
    type: "magiclink",
    token_hash: data.properties.hashed_token,
  });
  if (e2 || !s.session) throw new Error("verifyOtp: " + (e2?.message ?? "нет сессии"));
  return {
    access_token: s.session.access_token,
    refresh_token: s.session.refresh_token,
    expires_at: s.session.expires_at,
  };
}
