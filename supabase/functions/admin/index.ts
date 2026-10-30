// Действия админа, которым нужен сервисный ключ (раздел 12.1 и 18 ТЗ):
// добавить ученика, перевыпустить приглашение, создать и удалить демо-учеников, удалить ученика целиком.
// Кто админ, проверяется здесь по токену и таблице admins, клиенту не доверяем
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EMAIL_DOMAIN = "users.barbermaxxing.invalid";
const BUCKET = "screenshots";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const db = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

// Код без похожих символов, 12 знаков: перебрать невозможно
function inviteCode() {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes].map((b) => abc[b % abc.length]).join("");
}

async function createStudent(p: { display_name: string; tariff_code: string; start_date: string; demo?: boolean }, actor: number) {
  const name = String(p.display_name || "").trim();
  if (!name) throw new Error("name_required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.start_date || ""))) throw new Error("start_date_required");
  const { data: tariff } = await db.from("tariffs").select("id").eq("code", p.tariff_code).maybeSingle();
  if (!tariff) throw new Error("tariff_not_found");

  const email = `student-${crypto.randomUUID()}@${EMAIL_DOMAIN}`;
  const { data: u, error } = await db.auth.admin.createUser({ email, email_confirm: true });
  if (error || !u.user) throw error ?? new Error("create_user_failed");

  const { data: profile, error: e2 } = await db.from("profiles").insert({
    id: u.user.id, display_name: name, tariff_id: tariff.id, start_date: p.start_date,
    invite_code: inviteCode(), demo: !!p.demo,
  }).select("*").single();
  if (e2) { await db.auth.admin.deleteUser(u.user.id); throw e2; }
  await audit(actor, "create", "profiles", profile.id, null, profile);
  return profile;
}

async function deleteStudent(id: string, actor: number) {
  const { data: before } = await db.from("profiles").select("*").eq("id", id).maybeSingle();
  if (!before) return;
  // файлы ученика из хранилища
  const { data: shots } = await db.from("screenshots").select("storage_path").eq("user_id", id);
  const paths = (shots ?? []).map((s) => s.storage_path);
  if (paths.length) await db.storage.from(BUCKET).remove(paths);
  const { error } = await db.auth.admin.deleteUser(id); // профиль и его данные удаляются каскадом
  if (error) throw error;
  await audit(actor, "delete", "profiles", id, before, null);
}

async function audit(actor: number, action: string, entity: string, id: string, before: unknown, after: unknown) {
  await db.from("audit_log").insert({ actor_telegram_id: actor, action, entity, entity_id: id, before, after });
}

function daysAgo(n: number) {
  const d = new Date(Date.now() - n * 86400_000);
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: who } = await db.auth.getUser(token);
  const tgId = Number(who?.user?.app_metadata?.telegram_id || 0);
  if (!tgId) return json({ error: "unauthorized" }, 401);
  const { data: adm } = await db.from("admins").select("telegram_id").eq("telegram_id", tgId).maybeSingle();
  if (!adm) return json({ error: "forbidden" }, 403);

  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { /* пусто */ }

  try {
    switch (body.action) {
      case "create_student": {
        const profile = await createStudent(body, tgId);
        return json({ profile });
      }
      case "reissue_invite": {
        // Новый код, старый перестаёт работать. Привязка к Telegram снимается:
        // по новой ссылке можно войти с другого аккаунта
        const { data: before } = await db.from("profiles").select("*").eq("id", body.profile_id).maybeSingle();
        if (!before) return json({ error: "not_found" }, 404);
        const { data: profile, error } = await db.from("profiles")
          .update({ invite_code: inviteCode(), telegram_id: null, status: before.status === "disabled" ? "disabled" : "invited" })
          .eq("id", body.profile_id).select("*").single();
        if (error) throw error;
        await db.auth.admin.updateUserById(profile.id, { app_metadata: { telegram_id: null } });
        await audit(tgId, "reissue_invite", "profiles", profile.id, before, profile);
        return json({ profile });
      }
      case "set_status": {
        if (!["active", "paused", "finished", "disabled"].includes(body.status)) return json({ error: "bad_status" }, 400);
        const { data: profile, error } = await db.from("profiles").update({ status: body.status }).eq("id", body.profile_id).select("*").single();
        if (error) throw error;
        await audit(tgId, "set_status", "profiles", profile.id, null, { status: body.status });
        return json({ profile });
      }
      case "create_demo": {
        const a = await createStudent({ display_name: "Демо Артём", tariff_code: "barbermax", start_date: daysAgo(21), demo: true }, tgId);
        const b = await createStudent({ display_name: "Демо Илья", tariff_code: "personal", start_date: daysAgo(10), demo: true }, tgId);
        return json({ profiles: [a, b] });
      }
      case "delete_demo": {
        const { data: demos } = await db.from("profiles").select("id").eq("demo", true);
        for (const d of demos ?? []) await deleteStudent(d.id, tgId);
        return json({ deleted: (demos ?? []).length });
      }
      case "delete_student": {
        await deleteStudent(body.profile_id, tgId);
        return json({ deleted: 1 });
      }
      default:
        return json({ error: "unknown_action" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ error: "server", message: String((e as Error)?.message ?? e) }, 500);
  }
});
