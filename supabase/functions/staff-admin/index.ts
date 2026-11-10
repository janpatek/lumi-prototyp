// Ospalek – správa týmu administrace (Supabase Edge Function „staff-admin“).
// Zakládání účtů, nastavení hesla a odebrání člena týmu potřebuje tajný klíč Supabase (admin API), ten na web nepatří.
// Proto to dělá tahle funkce na serveru a pustí jen vlastníka (role owner v tabulce staff), přihlášeného i kódem z
// Google Authenticatoru (aal2). Změnu role a zrušení ověření kódem řeší databáze (admin_set_role, admin_reset_mfa).
//
// Nasazení: Supabase → Edge Functions → Deploy a new function → Via editor, název staff-admin, vložit tenhle soubor.
// Token přihlášení ověřuje funkce sama (getUser), „Verify JWT“ může zůstat zapnuté. URL a tajný klíč dodá Supabase sama.
//
// POST { action: 'create', email, name, role, password } | { action: 'password', user_id, password } | { action: 'remove', user_id }

import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

const ROLES = ['owner', 'support', 'content', 'analyst', 'finance'];
const ORIGINS = ['https://ospalek.cz', 'https://www.ospalek.cz'];
// nový tajný klíč (SUPABASE_SECRET_KEYS, JSON { název: klíč }), dokud běží i starý service_role jako záloha
const secretKey = (() => { try { return Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'))[0] as string; } catch { return ''; } })()
  || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

const cors = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin && (ORIGINS.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin)) ? origin : ORIGINS[0],
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
});
class Fail extends Error { constructor(public status: number, msg: string) { super(msg); } }
const claims = (jwt: string) => { try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return {}; } };
const checkPassword = (pw: unknown) => {
  if (typeof pw !== 'string' || pw.length < 12) throw new Fail(400, 'Heslo musí mít aspoň 12 znaků.');
  if (pw.length > 72) throw new Fail(400, 'Heslo může mít nejvýš 72 znaků.');
  return pw;
};
async function staffRow(userId: string) {
  const { data, error } = await admin.from('staff').select('user_id, name, role').eq('user_id', userId).maybeSingle();
  if (error) throw new Fail(500, error.message);
  return data;
}
const audit = (actor: string, action: string, target: string, detail: string) =>
  admin.from('audit_log').insert({ actor, action, target, detail }).then(() => {});

Deno.serve(async (req) => {
  const h = { ...cors(req.headers.get('origin')), 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  try {
    if (req.method !== 'POST') throw new Fail(405, 'Jen POST.');
    // kdo volá: platný token (ověří Supabase), vlastník a přihlášený i kódem
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer /i, '');
    const { data: u, error: ue } = await admin.auth.getUser(jwt);
    if (ue || !u?.user) throw new Fail(401, 'Nejsi přihlášený.');
    if (claims(jwt).aal !== 'aal2') throw new Fail(403, 'Přihlas se i kódem z Google Authenticatoru.');
    const me = await staffRow(u.user.id);
    if (!me || me.role !== 'owner') throw new Fail(403, 'Tým může spravovat jen vlastník.');

    const body = await req.json().catch(() => ({}));
    if (body.action === 'create') {
      const email = String(body.email || '').trim().toLowerCase(), name = String(body.name || '').trim().slice(0, 60);
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) throw new Fail(400, 'Zadej platný e-mail.');
      if (!name) throw new Fail(400, 'Zadej jméno.');
      if (!ROLES.includes(body.role)) throw new Fail(400, 'Neznámá role.');
      const password = checkPassword(body.password);
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw new Fail(error.status === 422 ? 409 : 400, /already/i.test(error.message) ? 'Účet s tímhle e-mailem už existuje.' : error.message);
      const { error: se } = await admin.from('staff').upsert({ user_id: data.user.id, name, role: body.role });
      if (se) { await admin.auth.admin.deleteUser(data.user.id); throw new Fail(500, se.message); }
      await audit(u.user.id, 'team.create', name, `Nový člen týmu · ${email} · ${body.role}`);
      return new Response(JSON.stringify({ user_id: data.user.id }), { status: 200, headers: h });
    }
    if (body.action === 'password' || body.action === 'remove') {
      const target = await staffRow(String(body.user_id || ''));
      if (!target) throw new Fail(404, 'Člen týmu neexistuje.');
      if (body.action === 'password') {
        const { error } = await admin.auth.admin.updateUserById(target.user_id, { password: checkPassword(body.password) });
        if (error) throw new Fail(400, error.message);
        await audit(u.user.id, 'team.password', target.name, 'Nastavené nové heslo');
      } else {
        if (target.user_id === u.user.id) throw new Fail(400, 'Sám sebe odebrat nemůžeš.');
        const { error } = await admin.auth.admin.deleteUser(target.user_id); // řádek ve staff smaže kaskáda
        if (error) throw new Fail(400, error.message);
        await audit(u.user.id, 'team.remove', target.name, 'Odebraný z týmu, účet smazaný');
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: h });
    }
    throw new Fail(400, 'Neznámá akce.');
  } catch (e) {
    const status = e instanceof Fail ? e.status : 500;
    return new Response(JSON.stringify({ message: e instanceof Error ? e.message : String(e) }), { status, headers: h });
  }
});
