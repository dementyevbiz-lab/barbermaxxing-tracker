// Вход через Telegram. Приложение присылает initData, функция проверяет подпись токеном бота,
// находит ученика или админа, при первом входе привязывает приглашение и выдаёт сессию Supabase.
// Ответ status: ok | invite_required | invite_invalid | blocked | too_many | bad_signature | error
import {
  accountEmail,
  adminClient,
  corsHeaders,
  env,
  issueSession,
  json,
  verifyInitData,
} from "../_shared/common.ts";

const MAX_FAILS_PER_HOUR = 10; // неверные коды с одного аккаунта Telegram
const MAX_FAILS_TOTAL_HOUR = 200; // неверные коды всего, защита от перебора

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ status: "error", message: "POST only" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const init = await verifyInitData(String(body.initData ?? ""), env("TELEGRAM_BOT_TOKEN"));
    if (!init) return json({ status: "bad_signature" }, 401);

    const tg = init.user;
    const db = adminClient();
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const code = (init.start_param ?? "").trim().toLowerCase();

    const logAttempt = (ok: boolean, reason: string) =>
      db.from("auth_attempts").insert({ telegram_id: tg.id, ok, reason });

    const { data: adminRow } = await db.from("admins").select("*").eq("telegram_id", tg.id).maybeSingle();
    let { data: profile } = await db.from("profiles").select("*").eq("telegram_id", tg.id).maybeSingle();

    // Первый вход по приглашению. Админ по чужой ссылке не привязывается
    if (!profile && code && !adminRow) {
      const { count: myFails } = await db.from("auth_attempts").select("id", { count: "exact", head: true })
        .eq("telegram_id", tg.id).eq("ok", false).gte("at", hourAgo);
      const { count: allFails } = await db.from("auth_attempts").select("id", { count: "exact", head: true })
        .eq("ok", false).gte("at", hourAgo);
      if ((myFails ?? 0) >= MAX_FAILS_PER_HOUR || (allFails ?? 0) >= MAX_FAILS_TOTAL_HOUR) {
        return json({ status: "too_many" }, 429);
      }

      const { data: invited } = await db.from("profiles").select("*")
        .eq("invite_code", code).is("telegram_id", null).maybeSingle();
      if (!invited || invited.status === "blocked") {
        await logAttempt(false, "invite_invalid");
        return json({ status: "invite_invalid", telegram_id: tg.id });
      }

      // Привязка одноразовая: код гасится, второй раз по нему не войти
      const { data: bound, error: bindErr } = await db.from("profiles")
        .update({
          telegram_id: tg.id,
          tg_username: tg.username ?? null,
          invite_code: null,
          status: invited.status === "invited" ? "active" : invited.status,
        })
        .eq("id", invited.id).is("telegram_id", null)
        .select("*").maybeSingle();
      if (bindErr || !bound) {
        await logAttempt(false, "bind_race");
        return json({ status: "invite_invalid", telegram_id: tg.id });
      }
      profile = bound;
    }

    if (profile?.status === "blocked") {
      await logAttempt(false, "blocked");
      return json({ status: "blocked" });
    }
    if (!profile && !adminRow) {
      return json({ status: "invite_required", telegram_id: tg.id });
    }

    // Аккаунт Supabase: у ученика это его профиль, у админа без профиля отдельный аккаунт
    let userId: string = profile?.id ?? adminRow?.user_id ?? "";
    if (!userId) {
      const { data: created, error } = await db.auth.admin.createUser({
        email: accountEmail(`admin-${tg.id}`),
        email_confirm: true,
        app_metadata: { telegram_id: tg.id },
      });
      if (error || !created.user) throw new Error("createUser: " + error?.message);
      userId = created.user.id;
      await db.from("admins").update({ user_id: userId }).eq("telegram_id", tg.id);
    }

    // Telegram ID в app_metadata: его видит база через auth.jwt(), менять может только сервер
    const { data: u, error: uErr } = await db.auth.admin.getUserById(userId);
    if (uErr || !u.user) throw new Error("getUserById: " + uErr?.message);
    if (u.user.app_metadata?.telegram_id !== tg.id) {
      await db.auth.admin.updateUserById(userId, { app_metadata: { ...u.user.app_metadata, telegram_id: tg.id } });
    }

    const session = await issueSession(db, u.user.email!);

    if (profile) {
      await db.from("profiles").update({ last_seen_at: new Date().toISOString(), tg_username: tg.username ?? null })
        .eq("id", profile.id);
    }
    await logAttempt(true, adminRow ? "admin" : "student");

    return json({
      status: "ok",
      session,
      user_id: userId,
      is_admin: !!adminRow,
      has_profile: !!profile,
      first_name: tg.first_name ?? "",
    });
  } catch (e) {
    console.error(e);
    return json({ status: "error", message: String((e as Error).message ?? e) }, 500);
  }
});
