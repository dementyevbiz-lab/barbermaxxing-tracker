// Помощники для сквозной проверки на настоящем Supabase. Ключ берётся через Management API на лету и нигде не сохраняется.
// Все тестовые ученики помечены demo и именем «E2E …», в конце удаляются
import { createRequire } from 'node:module';
const require = createRequire(process.env.E2E_NODE_MODULES || '/tmp/claude-0/e2e/');
const { createClient } = require('@supabase/supabase-js');
export const REF = 'nltremspmuuasksxbqtk';
export const URL_ = `https://${REF}.supabase.co`;
export const ANON = 'sb_publishable_EB1WIiL4hcJNxK40-OqDlQ_94uiWrrz';

export async function connect() {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys`);
  const keys = await r.json();
  const svc = keys.find((k) => k.name === 'service_role')?.api_key;
  if (!svc) throw new Error('нет доступа к ключам: ' + JSON.stringify(keys).slice(0, 100));
  const admin = createClient(URL_, svc, { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  return { admin, anon };
}

export async function sessionFor(c, userId) {
  const { data: u } = await c.admin.auth.admin.getUserById(userId);
  const { data: l, error } = await c.admin.auth.admin.generateLink({ type: 'magiclink', email: u.user.email });
  if (error) throw error;
  const { data: s, error: e2 } = await c.anon().auth.verifyOtp({ type: 'magiclink', token_hash: l.properties.hashed_token });
  if (e2) throw e2;
  return s.session;
}

export async function makeStudent(c, { name, tariff = 'barbermax', startDaysAgo = 0, onboardingDone = false, status = 'active' }) {
  const { data: t } = await c.admin.from('tariffs').select('id').eq('code', tariff).single();
  const { data: au, error } = await c.admin.auth.admin.createUser({ email: `bmx-e2e-${Math.random().toString(36).slice(2)}@example.com`, email_confirm: true, app_metadata: {} });
  if (error) throw error;
  const start = new Date(Date.now() - startDaysAgo * 86400000).toISOString().slice(0, 10);
  const { data: p, error: pe } = await c.admin.from('profiles').insert({
    id: au.user.id, display_name: name, tariff_id: t.id, start_date: start, demo: true, status,
    onboarding: onboardingDone ? { done: true, step: 7, consent_at: new Date().toISOString() } : {},
  }).select('*').single();
  if (pe) throw pe;
  return p;
}

export async function cleanupE2E(c) {
  const { data } = await c.admin.from('profiles').select('id').like('display_name', 'E2E %');
  for (const p of data || []) await c.admin.auth.admin.deleteUser(p.id);
  await c.admin.from('program_items').delete().like('title', 'E2E %');
  await c.admin.from('admins').delete().eq('telegram_id', 900000009);
  const { data: au } = await c.admin.auth.admin.listUsers({ perPage: 200 });
  for (const u of au?.users || []) if (/^bmx-e2e-/.test(u.email || '')) await c.admin.auth.admin.deleteUser(u.id);
  await c.admin.from('quotes').delete().like('author', 'E2E %');
  await c.admin.from('movies').delete().like('title', 'E2E %');
  return (data || []).length;
}
export const ledgerSum = async (c, uid, kind) => {
  let q = c.admin.from('xp_ledger').select('xp').eq('user_id', uid).is('undone_at', null);
  if (kind) q = q.eq('kind', kind);
  const { data } = await q; return (data || []).reduce((s, r) => s + r.xp, 0);
};

export async function makeAdmin(c) {
  const { data: au, error } = await c.admin.auth.admin.createUser({ email: `bmx-e2e-admin-${Math.random().toString(36).slice(2)}@example.com`, email_confirm: true, app_metadata: { telegram_id: 900000009 } });
  if (error) throw error;
  await c.admin.from('admins').insert({ telegram_id: 900000009, name: 'E2E админ', user_id: au.user.id });
  return au.user;
}
