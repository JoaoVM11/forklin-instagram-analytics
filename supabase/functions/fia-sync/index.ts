// Sincroniza dados da Graph API para o banco.
// Chamada pelo pg_cron (header x-cron-secret) a cada hora, ou pelo botão "Atualizar agora" (sessão).
// Body opcional: { scope?: "auto" | "all" | "refs", backfill_days?: number }
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { admin, cors, getConfig, graph, json, readSession } from "../_shared/core.ts";

const TZ_OFFSET_H = 3; // America/Sao_Paulo (UTC-3)
const ACCOUNT_METRICS = [
  "reach", "views", "accounts_engaged", "total_interactions", "likes", "comments", "shares",
  "saves", "replies", "reposts", "profile_views", "website_clicks", "profile_links_taps",
];
const MEDIA_METRICS = ["reach", "views", "likes", "comments", "shares", "saved", "reposts", "total_interactions", "follows", "profile_visits"];
const STORY_METRICS = ["reach", "views", "replies", "shares", "total_interactions", "follows", "profile_visits", "navigation"];

function dayBounds(d: Date) {
  // Dia local (BRT) -> [since, until] em epoch segundos
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), TZ_OFFSET_H) / 1000;
  return { since: start, until: start + 86400 };
}
function localToday(): Date {
  const now = new Date(Date.now() - TZ_OFFSET_H * 3600_000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function metricsWithFallback(path: string, metrics: string[], token: string, extra = "") {
  // Tenta todas as métricas de uma vez; se a Meta recusar alguma, busca uma a uma.
  const out: Record<string, number | null> = {};
  try {
    const r = await graph(`${path}/insights?metric=${metrics.join(",")}${extra}`, token);
    for (const m of r.data ?? []) out[m.name] = m.total_value?.value ?? m.values?.[0]?.value ?? null;
    return out;
  } catch {
    for (const m of metrics) {
      try {
        const r = await graph(`${path}/insights?metric=${m}${extra}`, token);
        const it = r.data?.[0];
        out[m] = it?.total_value?.value ?? it?.values?.[0]?.value ?? null;
      } catch { out[m] = null; }
    }
    return out;
  }
}

async function syncProfile(db: SupabaseClient, ig: string, token: string) {
  const p = await graph(`${ig}?fields=username,name,biography,website,profile_picture_url,followers_count,follows_count,media_count`, token);
  await db.from("fia_account").upsert({
    ig_user_id: ig, username: p.username, name: p.name, biography: p.biography, website: p.website,
    profile_picture_url: p.profile_picture_url, followers_count: p.followers_count,
    follows_count: p.follows_count, media_count: p.media_count, updated_at: new Date().toISOString(),
  });
  await db.from("fia_profile_daily").upsert({
    ig_user_id: ig, day: iso(localToday()), followers_count: p.followers_count,
    follows_count: p.follows_count, media_count: p.media_count,
  });
  return p.followers_count;
}

async function syncAccountDays(db: SupabaseClient, ig: string, token: string, days: number) {
  const today = localToday();
  let n = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(today.getTime() - i * 86400_000);
    const { since, until } = dayBounds(d);
    const vals = await metricsWithFallback(ig, ACCOUNT_METRICS, token, `&period=day&metric_type=total_value&since=${since}&until=${until}`);
    let follows: number | null = null, unfollows: number | null = null;
    try {
      const fu = await graph(`${ig}/insights?metric=follows_and_unfollows&period=day&metric_type=total_value&breakdown=follow_type&since=${since}&until=${until}`, token);
      for (const r of fu.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? []) {
        if (r.dimension_values?.[0] === "FOLLOWER") follows = r.value;
        if (r.dimension_values?.[0] === "NON_FOLLOWER") unfollows = r.value;
      }
    } catch { /* métrica indisponível para contas pequenas */ }
    await db.from("fia_account_insights_daily").upsert({
      ig_user_id: ig, day: iso(d), ...vals, follows, unfollows, fetched_at: new Date().toISOString(),
    });
    n++;
  }
  return n;
}

async function syncDemographics(db: SupabaseClient, ig: string, token: string) {
  for (const b of ["city", "country", "age", "gender"]) {
    try {
      const r = await graph(`${ig}/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=${b}`, token);
      const rows = (r.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? []).map((x: any) => ({
        ig_user_id: ig, breakdown: b, dimension: x.dimension_values.join(" / "), value: x.value, fetched_at: new Date().toISOString(),
      }));
      await db.from("fia_demographics").delete().eq("ig_user_id", ig).eq("breakdown", b);
      if (rows.length) await db.from("fia_demographics").insert(rows);
    } catch { /* exige 100+ seguidores */ }
  }
}

async function syncMedia(db: SupabaseClient, ig: string, token: string) {
  const r = await graph(`${ig}/media?fields=id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count&limit=50`, token);
  let n = 0;
  for (const m of r.data ?? []) {
    const ageDays = (Date.now() - new Date(m.timestamp).getTime()) / 86400_000;
    const row: Record<string, unknown> = {
      media_id: m.id, ig_user_id: ig, media_type: m.media_type, media_product_type: m.media_product_type,
      caption: m.caption, permalink: m.permalink, thumbnail_url: m.thumbnail_url, media_url: m.media_url,
      posted_at: m.timestamp, like_count: m.like_count, comments_count: m.comments_count, updated_at: new Date().toISOString(),
    };
    if (ageDays <= 120) {
      const v = await metricsWithFallback(m.id, MEDIA_METRICS, token);
      Object.assign(row, v);
      await db.from("fia_media").upsert(row);
      await db.from("fia_media_snapshots").insert({
        media_id: m.id, reach: v.reach, views: v.views, likes: v.likes, comments: v.comments,
        shares: v.shares, saved: v.saved, reposts: v.reposts, total_interactions: v.total_interactions,
      });
    } else {
      await db.from("fia_media").upsert(row);
    }
    n++;
  }
  return n;
}

async function syncStories(db: SupabaseClient, ig: string, token: string) {
  const r = await graph(`${ig}/stories?fields=id,media_type,permalink,media_url,thumbnail_url,timestamp`, token);
  let n = 0;
  for (const s of r.data ?? []) {
    const v = await metricsWithFallback(s.id, STORY_METRICS, token);
    const nav: Record<string, number | null> = { taps_forward: null, taps_back: null, swipe_forward: null, exits: null };
    try {
      const b = await graph(`${s.id}/insights?metric=navigation&breakdown=story_navigation_action_type`, token);
      for (const x of b.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? []) {
        const k = x.dimension_values?.[0];
        if (k === "tap_forward") nav.taps_forward = x.value;
        if (k === "tap_back") nav.taps_back = x.value;
        if (k === "swipe_forward") nav.swipe_forward = x.value;
        if (k === "tap_exit") nav.exits = x.value;
      }
    } catch { /* sem breakdown */ }
    await db.from("fia_stories").upsert({
      story_id: s.id, ig_user_id: ig, media_type: s.media_type, permalink: s.permalink, media_url: s.media_url,
      thumbnail_url: s.thumbnail_url, posted_at: s.timestamp, ...v, ...nav, updated_at: new Date().toISOString(),
    });
    n++;
  }
  return n;
}

async function syncRefs(db: SupabaseClient, ig: string, token: string, force: boolean) {
  const { data: refs } = await db.from("fia_ref_accounts").select("*").eq("active", true);
  let n = 0;
  for (const ref of refs ?? []) {
    const stale = !ref.updated_at || Date.now() - new Date(ref.updated_at).getTime() > 20 * 3600_000;
    if (!force && !stale) continue;
    try {
      const r = await graph(
        `${ig}?fields=business_discovery.username(${ref.username}){id,username,name,biography,website,profile_picture_url,followers_count,follows_count,media_count,media.limit(40){id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count}}`,
        token,
      );
      const b = r.business_discovery;
      await db.from("fia_ref_accounts").update({
        ig_user_id: b.id, name: b.name, biography: b.biography, website: b.website, profile_picture_url: b.profile_picture_url,
        followers_count: b.followers_count, follows_count: b.follows_count, media_count: b.media_count,
        last_error: null, updated_at: new Date().toISOString(),
      }).eq("username", ref.username);
      await db.from("fia_ref_profile_daily").upsert({ username: ref.username, day: iso(localToday()), followers_count: b.followers_count, media_count: b.media_count });
      const rows = (b.media?.data ?? []).map((m: any) => ({
        media_id: m.id, username: ref.username, media_type: m.media_type, media_product_type: m.media_product_type,
        caption: m.caption, permalink: m.permalink, posted_at: m.timestamp, like_count: m.like_count ?? null,
        comments_count: m.comments_count ?? null, updated_at: new Date().toISOString(),
      }));
      if (rows.length) await db.from("fia_ref_media").upsert(rows);
      n++;
    } catch (e) {
      await db.from("fia_ref_accounts").update({ last_error: (e as Error).message, updated_at: new Date().toISOString() }).eq("username", ref.username);
    }
  }
  return n;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin();

  const cronSecret = await getConfig(db, "cron_secret");
  const fromCron = cronSecret && req.headers.get("x-cron-secret") === cronSecret;
  if (!fromCron && !(await readSession(db, req))) return json({ error: "Não autorizado." }, 401);

  const body = await req.json().catch(() => ({}));
  const scope: string = body.scope ?? "auto";
  const token = await getConfig(db, "meta_token");
  const ig = await getConfig(db, "ig_user_id");
  if (!token || !ig) return json({ error: "Token da Meta não configurado." }, 400);

  const { data: run } = await db.from("fia_sync_runs").insert({ scope }).select("id").single();
  const detail: Record<string, unknown> = {};
  let ok = true;
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try { detail[name] = await fn(); } catch (e) { ok = false; detail[name] = { error: (e as Error).message }; }
  };

  if (scope === "refs") {
    await step("refs", () => syncRefs(db, ig, token, true));
  } else {
    const { count } = await db.from("fia_account_insights_daily").select("*", { count: "exact", head: true });
    const days = body.backfill_days ?? (count && count > 0 ? 2 : 30);
    await step("profile", () => syncProfile(db, ig, token));
    await step("stories", () => syncStories(db, ig, token));
    await step("media", () => syncMedia(db, ig, token));
    await step("account_days", () => syncAccountDays(db, ig, token, days));
    const hour = new Date().getUTCHours();
    if (scope === "all" || hour === 9 || !count) await step("demographics", () => syncDemographics(db, ig, token));
    await step("refs", () => syncRefs(db, ig, token, scope === "all"));
  }

  await db.from("fia_sync_runs").update({ finished_at: new Date().toISOString(), ok, detail }).eq("id", run!.id);
  return json({ ok, detail });
});
