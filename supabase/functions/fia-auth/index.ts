// POST { password, scope?: "view" | "admin" } -> { session, scope, expires_in }
import { admin, checkLockout, clearFailures, cors, getConfig, issueSession, json, registerFailure, verifyPassword } from "../_shared/core.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const db = admin();
  if (await checkLockout(db)) return json({ error: "Muitas tentativas. Aguarde 15 minutos." }, 429);

  const { password, scope = "view" } = await req.json().catch(() => ({}));
  const stored = await getConfig(db, "app_password_hash");
  if (!stored) return json({ error: "Senha do app ainda não configurada." }, 500);

  if (!password || !(await verifyPassword(String(password), stored))) {
    await registerFailure(db);
    return json({ error: "Senha incorreta." }, 401);
  }
  await clearFailures(db);

  const ttl = scope === "admin" ? 15 * 60 : 12 * 60 * 60;
  const session = await issueSession(db, scope === "admin" ? "admin" : "view", ttl);
  return json({ session, scope, expires_in: ttl });
});
