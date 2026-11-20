// GET  (sessão view)  -> status do token da Meta (validade, dias restantes, permissões)
// POST (sessão admin) { action: "set_token", token }            -> valida e grava um token novo
// POST (sessão admin) { action: "change_password", new_password } -> troca a senha do app
// POST (sessão admin) { action: "set_groq", key?, model? }     -> valida e grava a chave do Groq (curador)
import { admin, cors, debugToken, getConfig, graph, hashPassword, json, readSession, setConfig } from "../_shared/core.ts";

const DEFAULT_GROQ_MODEL = "qwen/qwen3.8-27b";
const mask = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;

async function groqStatus(db: ReturnType<typeof admin>) {
  const key = await getConfig(db, "groq_api_key");
  const model = (await getConfig(db, "groq_vision_model")) ?? DEFAULT_GROQ_MODEL;
  return key ? { configured: true, masked: mask(key), model } : { configured: false, model };
}

const REQUIRED = ["instagram_basic", "instagram_manage_insights", "pages_show_list", "pages_read_engagement"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin();
  const session = await readSession(db, req);
  if (!session) return json({ error: "Sessão expirada. Entre novamente." }, 401);

  if (req.method === "GET") {
    const token = await getConfig(db, "meta_token");
    const updated = await db.from("fia_app_config").select("updated_at").eq("key", "meta_token").maybeSingle();
    const groq = await groqStatus(db);
    if (!token) return json({ configured: false, groq });
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
        groq,
      });
    } catch (e) {
      return json({ configured: true, valid: false, error: (e as Error).message, updated_at: updated.data?.updated_at, groq });
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

  if (body.action === "set_groq") {
    const key = String(body.key || "").trim();
    const model = String(body.model || "").trim();
    if (key) {
      if (!/^gsk_[A-Za-z0-9]{20,}$/.test(key)) return json({ error: "A chave do Groq começa com gsk_ e tem pelo menos 24 caracteres." }, 400);
      const r = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: `Bearer ${key}` } });
      if (!r.ok) return json({ error: `O Groq recusou a chave (HTTP ${r.status}).` }, 400);
      const models = (await r.json()).data?.map((m: { id: string }) => m.id) ?? [];
      const wanted = model || (await getConfig(db, "groq_vision_model")) || DEFAULT_GROQ_MODEL;
      await setConfig(db, "groq_api_key", key);
      if (model) await setConfig(db, "groq_vision_model", model);
      return json({ ok: true, groq: await groqStatus(db), model_available: models.includes(wanted), models: models.filter((m: string) => !m.includes("whisper")).slice(0, 40) });
    }
    if (model) {
      await setConfig(db, "groq_vision_model", model);
      return json({ ok: true, groq: await groqStatus(db) });
    }
    return json({ error: "Informe a chave ou o modelo." }, 400);
  }

  return json({ error: "Ação desconhecida." }, 400);
});
