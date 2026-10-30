// Тест проверки подписи Telegram: deno test supabase/tests/verify_test.ts
import { verifyInitData } from "../functions/_shared/common.ts";

async function sign(params: Record<string, string>, token: string): Promise<string> {
  const enc = new TextEncoder();
  const k1 = await crypto.subtle.importKey("raw", enc.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const secret = await crypto.subtle.sign("HMAC", k1, enc.encode(token));
  const k2 = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const dcs = Object.entries(params).map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const h = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", k2, enc.encode(dcs))), (b) => b.toString(16).padStart(2, "0")).join("");
  return new URLSearchParams({ ...params, hash: h }).toString();
}

const TOKEN = "123456:TEST";
const now = Math.floor(Date.now() / 1000);
const base = { auth_date: String(now), query_id: "AAE", user: JSON.stringify({ id: 42, first_name: "Саня" }), start_param: "abc234" };

function assert(c: boolean, m: string) { if (!c) throw new Error(m); }

Deno.test("верная подпись проходит", async () => {
  const r = await verifyInitData(await sign(base, TOKEN), TOKEN);
  assert(r?.user.id === 42 && r.start_param === "abc234", "должно пройти");
});
Deno.test("чужой токен не проходит", async () => {
  assert((await verifyInitData(await sign(base, "999:OTHER"), TOKEN)) === null, "чужой токен");
});
Deno.test("подмена данных не проходит", async () => {
  const s = (await sign(base, TOKEN)).replace("abc234", "zzz999");
  assert((await verifyInitData(s, TOKEN)) === null, "подмена");
});
Deno.test("старше суток не проходит", async () => {
  const old = { ...base, auth_date: String(now - 86401) };
  assert((await verifyInitData(await sign(old, TOKEN), TOKEN)) === null, "старая");
});
