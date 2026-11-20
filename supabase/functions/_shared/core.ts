// Utilitários compartilhados pelas Edge Functions
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const GRAPH = "https://graph.facebook.com/v23.0";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-session, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

export function admin(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

export async function getConfig(db: SupabaseClient, key: string): Promise<string | null> {
  const { data } = await db.from("fia_app_config").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}

export async function setConfig(db: SupabaseClient, key: string, value: string) {
  const { error } = await db.from("fia_app_config").upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// ---------- senha (PBKDF2-SHA256, sem dependências) ----------
const enc = new TextEncoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function hashPassword(password: string, iterations = 210_000): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return `pbkdf2$${iterations}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, it, saltB64, hashB64] = stored.split("$");
  if (alg !== "pbkdf2") return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: unb64(saltB64), iterations: Number(it) }, key, 256));
  const expected = unb64(hashB64);
  if (bits.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < bits.length; i++) diff |= bits[i] ^ expected[i];
  return diff === 0;
}

// ---------- sessão (HMAC-SHA256) ----------
async function hmacKey(db: SupabaseClient) {
  let secret = await getConfig(db, "session_secret");
  if (!secret) {
    secret = b64(crypto.getRandomValues(new Uint8Array(32)));
    await setConfig(db, "session_secret", secret);
  }
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function issueSession(db: SupabaseClient, scope: "view" | "admin", ttlSeconds: number) {
  const payload = b64(enc.encode(JSON.stringify({ scope, exp: Math.floor(Date.now() / 1000) + ttlSeconds })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(db), enc.encode(payload)));
  return `${payload}.${b64(sig)}`;
}

export async function readSession(db: SupabaseClient, req: Request): Promise<{ scope: string } | null> {
  const token = req.headers.get("x-session");
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(db), unb64(sig), enc.encode(payload));
  if (!ok) return null;
  const data = JSON.parse(new TextDecoder().decode(unb64(payload)));
  if (data.exp < Date.now() / 1000) return null;
  return data;
}

// Limite simples contra força bruta: guarda tentativas falhas em app_config
export async function checkLockout(db: SupabaseClient): Promise<boolean> {
  const raw = await getConfig(db, "login_failures");
  if (!raw) return false;
  const { count, since } = JSON.parse(raw);
  return count >= 8 && Date.now() - since < 15 * 60_000;
}
export async function registerFailure(db: SupabaseClient) {
  const raw = await getConfig(db, "login_failures");
  let st = raw ? JSON.parse(raw) : { count: 0, since: Date.now() };
  if (Date.now() - st.since > 15 * 60_000) st = { count: 0, since: Date.now() };
  st.count++;
  await setConfig(db, "login_failures", JSON.stringify(st));
}
export async function clearFailures(db: SupabaseClient) {
  await setConfig(db, "login_failures", JSON.stringify({ count: 0, since: Date.now() }));
}

// ---------- Graph API ----------
export async function graph(path: string, token: string): Promise<any> {
  const url = `${GRAPH}/${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  const body = await res.json();
  if (body.error) {
    const err = new Error(body.error.message);
    (err as any).code = body.error.code;
    throw err;
  }
  return body;
}

export async function debugToken(token: string) {
  const d = await graph(`debug_token?input_token=${encodeURIComponent(token)}`, token);
  return d.data as { is_valid: boolean; expires_at: number; data_access_expires_at: number; scopes: string[]; user_id: string };
}
