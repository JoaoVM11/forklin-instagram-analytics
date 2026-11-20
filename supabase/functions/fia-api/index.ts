// Leitura dos dados para o painel (exige sessão).
// GET  ?r=overview&days=30 | ?r=posts | ?r=stories&days=30 | ?r=refs | ?r=status
// POST { action: "add_ref", username, label? } | { action: "remove_ref", username }
import { admin, cors, json, readSession } from "../_shared/core.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin();
  if (!(await readSession(db, req))) return json({ error: "Sessão expirada. Entre novamente." }, 401);

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const username = String(body.username || "").replace(/^@/, "").trim().toLowerCase();
    if (!/^[a-z0-9._]{1,30}$/.test(username)) return json({ error: "@ inválido." }, 400);
    if (body.action === "add_ref") {
      const { error } = await db.from("fia_ref_accounts").upsert({ username, label: body.label ?? null, active: true });
      return error ? json({ error: error.message }, 400) : json({ ok: true });
    }
    if (body.action === "remove_ref") {
      await db.from("fia_ref_accounts").delete().eq("username", username);
      return json({ ok: true });
    }
    return json({ error: "Ação desconhecida." }, 400);
  }

  const url = new URL(req.url);
  const r = url.searchParams.get("r") ?? "overview";
  const days = Math.min(Number(url.searchParams.get("days") ?? 30), 365);
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

  if (r === "overview") {
    const [acc, daily, profile, demo] = await Promise.all([
      db.from("fia_account").select("*").limit(1).maybeSingle(),
      db.from("fia_account_insights_daily").select("*").gte("day", since).order("day"),
      db.from("fia_profile_daily").select("*").gte("day", since).order("day"),
      db.from("fia_demographics").select("breakdown,dimension,value").order("value", { ascending: false }),
    ]);
    return json({ account: acc.data, daily: daily.data ?? [], profile: profile.data ?? [], demographics: demo.data ?? [] });
  }

  if (r === "posts") {
    const { data } = await db.from("fia_media").select("*").order("posted_at", { ascending: false }).limit(200);
    const acc = await db.from("fia_account").select("followers_count").limit(1).maybeSingle();
    return json({ posts: data ?? [], followers: acc.data?.followers_count ?? null });
  }

  if (r === "stories") {
    const { data } = await db.from("fia_stories").select("*").gte("posted_at", since).order("posted_at", { ascending: false });
    return json({ stories: data ?? [] });
  }

  if (r === "refs") {
    const [refs, media, own, ownMedia] = await Promise.all([
      db.from("fia_ref_accounts").select("*").order("followers_count", { ascending: false, nullsFirst: false }),
      db.from("fia_ref_media").select("*").order("posted_at", { ascending: false }).limit(2000),
      db.from("fia_account").select("username,followers_count,media_count,profile_picture_url").limit(1).maybeSingle(),
      db.from("fia_media").select("media_id,media_type,media_product_type,caption,permalink,posted_at,like_count,comments_count").order("posted_at", { ascending: false }).limit(60),
    ]);
    return json({ refs: refs.data ?? [], media: media.data ?? [], own: own.data, ownMedia: ownMedia.data ?? [] });
  }

  if (r === "status") {
    const { data } = await db.from("fia_sync_runs").select("*").order("started_at", { ascending: false }).limit(5);
    return json({ runs: data ?? [] });
  }

  return json({ error: "Recurso desconhecido." }, 400);
});
