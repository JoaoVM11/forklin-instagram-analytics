// GET  (sessão view)  -> status do token da Meta (validade, dias restantes, permissões)
// POST (sessão admin) { action: "set_token", token }            -> valida e grava um token novo
// POST (sessão admin) { action: "change_password", new_password } -> troca a senha do app
import { admin, cors, debugToken, getConfig, graph, hashPassword, json, readSession, setConfig } from "../_shared/core.ts";

const REQUIRED = ["instagram_basic", "instagram_manage_insights", "pages_show_list", "pages_read_engagement"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin();
  const session = await readSession(db, req);
  if (!session) return json({ error: "Sessão expirada. Entre novamente." }, 401);

  if (req.method === "GET") {
    const token = await getConfig(db, "meta_token");
    const updated = await db.from("fia_app_config").select("updated_at").eq("key", "meta_token").maybeSingle();
    if (!token) return json({ configured: false });
    try {
      const d = await debugToken(token);
      const days = d.expires_at ? Math.floor((d.expires_at * 1000 - Date.now()) / 86_400_000) : null;
      return json({
        configured: true,
        valid: d.is_valid,
        expires_at: d.expires_at ? new Date(d.expires_at * 1000).toISOString() : null,
        days_left: days,
        data_access_expires_at: d.data_access_expires_at ? new Date(d.data_access_expires_at * 1000).toISOString() : null,
        scopes: d.scopes,
        missing_scopes: REQUIRED.filter((s) => !d.scopes?.includes(s)),
        updated_at: updated.data?.updated_at,
        masked: `${token.slice(0, 6)}…${token.slice(-4)}`,
      });
    } catch (e) {
      return json({ configured: true, valid: false, error: (e as Error).message, updated_at: updated.data?.updated_at });
    }
  }

  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (session.scope !== "admin") return json({ error: "Confirme a senha para alterar o token." }, 403);
  const body = await req.json().catch(() => ({}));

  if (body.action === "set_token") {
    const token = String(body.token || "").trim();
    if (token.length < 50) return json({ error: "Token inválido." }, 400);
    let d;
    try { d = await debugToken(token); } catch (e) { return json({ error: `A Meta recusou o token: ${(e as Error).message}` }, 400); }
    if (!d.is_valid) return json({ error: "A Meta informou que este token não é válido." }, 400);
    const missing = REQUIRED.filter((s) => !d.scopes?.includes(s));
    if (missing.length) return json({ error: `Faltam permissões no token: ${missing.join(", ")}` }, 400);

    // Descobre a conta do Instagram ligada à Página
    const accounts = await graph("me/accounts?fields=id,name,instagram_business_account{id,username}", token);
    const page = accounts.data?.find((p: any) => p.instagram_business_account);
    if (!page) return json({ error: "Nenhuma Página com Instagram profissional vinculado foi encontrada neste token." }, 400);

    await setConfig(db, "meta_token", token);
    await setConfig(db, "ig_user_id", page.instagram_business_account.id);
    await setConfig(db, "page_id", page.id);
    await db.from("fia_account").upsert({
      ig_user_id: page.instagram_business_account.id,
      page_id: page.id,
      username: page.instagram_business_account.username,
    });
    return json({
      ok: true,
      username: page.instagram_business_account.username,
      expires_at: d.expires_at ? new Date(d.expires_at * 1000).toISOString() : null,
    });
  }

  if (body.action === "change_password") {
    const pw = String(body.new_password || "");
    if (pw.length < 8) return json({ error: "A nova senha precisa ter pelo menos 8 caracteres." }, 400);
    await setConfig(db, "app_password_hash", await hashPassword(pw));
    // Invalida sessões antigas trocando o segredo de sessão
    await setConfig(db, "session_secret", btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))));
    return json({ ok: true });
  }

  return json({ error: "Ação desconhecida." }, 400);
});
