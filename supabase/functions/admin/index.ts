// Действия админа, которым нужен сервисный ключ: завести ученика с приглашением, перевыпустить ссылку,
// удалить ученика со всеми данными, завести и удалить демо-учеников.
// Остальное админ делает напрямую через базу, права дают RLS-политики
import {
  accountEmail,
  adminClient,
  corsHeaders,
  inviteLink,
  json,
  newInviteCode,
} from "../_shared/common.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

type Body = Record<string, unknown> & { action?: string };

async function requireAdmin(db: SupabaseClient, req: Request): Promise<number | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  const tgId = Number(data.user.app_metadata?.telegram_id);
  if (!tgId) return null;
  const { data: row } = await db.from("admins").select("telegram_id").eq("telegram_id", tgId).maybeSingle();
  return row ? tgId : null;
}

async function audit(db: SupabaseClient, actor: number, action: string, id: string, after: unknown = null) {
  await db.from("audit_log").insert({ actor_telegram_id: actor, action, entity: "profiles", entity_id: id, after });
}

async function createStudent(
  db: SupabaseClient,
  p: { display_name: string; tariff_code: string; start_date?: string | null; demo?: boolean },
) {
  const name = String(p.display_name ?? "").trim();
  if (!name) throw new Error("Нужно имя");
  const { data: tariff } = await db.from("tariffs").select("id").eq("code", p.tariff_code).maybeSingle();
  if (!tariff) throw new Error("Нет такого тарифа");

  const { data: created, error } = await db.auth.admin.createUser({
    email: accountEmail(crypto.randomUUID()),
    email_confirm: true,
    app_metadata: {},
  });
  if (error || !created.user) throw new Error("createUser: " + error?.message);

  const code = newInviteCode();
  const { data: profile, error: pErr } = await db.from("profiles").insert({
    id: created.user.id,
    display_name: name,
    tariff_id: tariff.id,
    start_date: p.start_date || null,
    invite_code: code,
    demo: !!p.demo,
  }).select("*").single();
  if (pErr) {
    await db.auth.admin.deleteUser(created.user.id);
    throw new Error("profile: " + pErr.message);
  }
  return { profile, invite_link: inviteLink(code) };
}

async function removeFiles(db: SupabaseClient, userId: string) {
  // Папка ученика: user_id/checkpoint_id/файл
  const bucket = db.storage.from("screenshots");
  const { data: dirs } = await bucket.list(userId, { limit: 1000 });
  const paths: string[] = [];
  for (const d of dirs ?? []) {
    const { data: files } = await bucket.list(`${userId}/${d.name}`, { limit: 1000 });
    if (files?.length) for (const f of files) paths.push(`${userId}/${d.name}/${f.name}`);
    else paths.push(`${userId}/${d.name}`);
  }
  if (paths.length) await bucket.remove(paths);
}

async function deleteStudent(db: SupabaseClient, userId: string) {
  await removeFiles(db, userId);
  // Профиль и все строки ученика удаляются каскадом вместе с аккаунтом
  const { error } = await db.auth.admin.deleteUser(userId);
  if (error) throw new Error("deleteUser: " + error.message);
}

// Демо-ученики: цели, точка А, один замер, немного видео. Чтобы было на чём проверять экраны
async function seedDemo(db: SupabaseClient) {
  const today = new Date();
  const daysAgo = (n: number) => new Date(today.getTime() - n * 86400_000).toISOString().slice(0, 10);
  const demos = [
    { display_name: "Демо Артём", tariff_code: "barbermax", start: 24 },
    { display_name: "Демо Тимур", tariff_code: "personal", start: 10 },
  ];
  const out = [];
  for (const d of demos) {
    const { profile, invite_link } = await createStudent(db, {
      display_name: d.display_name, tariff_code: d.tariff_code, start_date: daysAgo(d.start), demo: true,
    });
    const uid = profile.id;
    const goals: Record<string, [number, number, number]> = {
      // метрика: точка А, точка Б, значение второго замера
      avg_check: [1500, 2500, 1800],
      booking_fill: [55, 85, 62],
      work_days: [6, 5, 6],
      clients_social: [3, 15, 6],
      followers: [800, 3000, 1150],
      top_views_avg: [400, 3000, 1200],
    };
    await db.from("goals").insert(Object.entries(goals).map(([k, v]) => ({ user_id: uid, metric_key: k, a_value: v[0], b_value: v[1] })));
    await db.from("goal_text").insert({ user_id: uid, why_text: "Демо-цель: полная запись и чек выше" });

    const { data: cps } = await db.from("checkpoints").select("*").eq("user_id", uid).order("idx");
    const base = cps?.[0];
    if (base) {
      await db.from("checkpoints").update({ submitted_at: new Date(daysAgo(d.start)).toISOString() }).eq("id", base.id);
      await db.from("checkpoint_values").insert(Object.entries(goals).map(([k, v]) => ({ checkpoint_id: base.id, metric_key: k, value: v[0] })));
    }
    const second = cps?.[1];
    if (second && new Date(second.due_date) <= today) {
      await db.from("checkpoints").update({ submitted_at: new Date(second.due_date).toISOString() }).eq("id", second.id);
      await db.from("checkpoint_values").insert(Object.entries(goals).map(([k, v]) => ({ checkpoint_id: second.id, metric_key: k, value: v[2] })));
    }
    const kinds = ["client", "expert", "life", "client", "expert"];
    await db.from("video_logs").insert(kinds.map((k, i) => ({ user_id: uid, kind: k, logged_on: daysAgo(i * 2 + 1) })));
    out.push({ id: uid, display_name: d.display_name, invite_link });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, message: "POST only" }, 405);

  try {
    const db = adminClient();
    const actor = await requireAdmin(db, req);
    if (!actor) return json({ ok: false, message: "Только для команды программы" }, 403);
    const body: Body = await req.json().catch(() => ({}));

    switch (body.action) {
      case "create_student": {
        const r = await createStudent(db, body as never);
        await audit(db, actor, "create_student", r.profile.id, r.profile);
        return json({ ok: true, ...r });
      }
      case "reissue_invite": {
        // Новая ссылка гасит старую и отвязывает прошлый аккаунт Telegram
        const id = String(body.user_id ?? "");
        const code = newInviteCode();
        const { data: p, error } = await db.from("profiles")
          .update({ invite_code: code, telegram_id: null, status: "invited" })
          .eq("id", id).select("*").maybeSingle();
        if (error || !p) throw new Error("Ученик не найден");
        const { data: u } = await db.auth.admin.getUserById(id);
        if (u?.user) {
          // Прошлый аккаунт Telegram больше не войдёт: его ID нет ни в профиле, ни в токене
          await db.auth.admin.updateUserById(id, { app_metadata: { ...u.user.app_metadata, telegram_id: null } });
        }
        await audit(db, actor, "reissue_invite", id);
        return json({ ok: true, invite_link: inviteLink(code) });
      }
      case "invite_link": {
        const { data: p } = await db.from("profiles").select("invite_code").eq("id", String(body.user_id ?? "")).maybeSingle();
        return json({ ok: true, invite_link: p?.invite_code ? inviteLink(p.invite_code) : null });
      }
      case "delete_student": {
        const id = String(body.user_id ?? "");
        const { data: p } = await db.from("profiles").select("id, display_name").eq("id", id).maybeSingle();
        if (!p) throw new Error("Ученик не найден");
        await deleteStudent(db, id);
        await audit(db, actor, "delete_student", id, p);
        return json({ ok: true });
      }
      case "seed_demo": {
        const r = await seedDemo(db);
        await audit(db, actor, "seed_demo", "demo", r);
        return json({ ok: true, students: r });
      }
      case "delete_demo": {
        const { data: list } = await db.from("profiles").select("id").eq("demo", true);
        for (const p of list ?? []) await deleteStudent(db, p.id);
        await audit(db, actor, "delete_demo", "demo", { count: list?.length ?? 0 });
        return json({ ok: true, deleted: list?.length ?? 0 });
      }
      default:
        return json({ ok: false, message: "Неизвестное действие" }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ ok: false, message: String((e as Error).message ?? e) }, 500);
  }
});
