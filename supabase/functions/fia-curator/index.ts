// Curador de posts (Groq).
// POST { action: "transcribe", audio_base64 }                     -> texto da fala (Whisper)
// POST { action: "analyze", kind, images[], draft?, context?, goal?, transcript?, thumb? } -> análise + copies
// GET  ?history=1                                                 -> últimas análises
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { admin, cors, getConfig, json, readSession } from "../_shared/core.ts";

const GROQ = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "qwen/qwen3.8-27b";
const FALLBACK_MODEL = "qwen/qwen3.6-27b";
const MAX_IMAGES = 3;

type Post = { caption: string | null; media_type: string; media_product_type: string; posted_at: string; like_count: number | null; comments_count: number | null };

const fmt = (m: { media_type: string; media_product_type: string }) =>
  m.media_product_type === "REELS" ? "Reels" : m.media_type === "CAROUSEL_ALBUM" ? "Carrossel" : m.media_type === "VIDEO" ? "Vídeo" : "Imagem";
const clip = (s: string | null, n = 600) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const median = (v: number[]) => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Contexto: melhores posts da Forklin + posts das referências acima do típico de cada conta
async function buildContext(db: SupabaseClient) {
  const [own, refs, refMedia, acc] = await Promise.all([
    db.from("fia_media").select("caption,media_type,media_product_type,posted_at,reach,total_interactions,shares,saved,reposts,follows").order("posted_at", { ascending: false }).limit(60),
    db.from("fia_ref_accounts").select("username,followers_count"),
    db.from("fia_ref_media").select("username,caption,media_type,media_product_type,posted_at,like_count,comments_count").order("posted_at", { ascending: false }).limit(1500),
    db.from("fia_account").select("username,biography,followers_count").limit(1).maybeSingle(),
  ]);

  const ownPosts = (own.data ?? []).filter((p) => p.reach != null);
  const reachMed = median(ownPosts.map((p) => p.reach ?? 0)) || 1;
  const topOwn = [...ownPosts]
    .map((p) => ({ ...p, score: (p.total_interactions ?? 0) / Math.max(p.reach ?? 1, 1) + (p.reach ?? 0) / reachMed / 10 }))
    .sort((a, b) => b.score - a.score).slice(0, 6)
    .map((p) => `- [${fmt(p)}] alcance ${p.reach}, interações ${p.total_interactions}, compart. ${p.shares}, reposts ${p.reposts}, seguidores ${p.follows ?? "?"}: "${clip(p.caption, 400)}"`);

  const byUser: Record<string, Post[]> = {};
  for (const m of (refMedia.data ?? []) as (Post & { username: string })[]) (byUser[m.username] ??= []).push(m);
  const lifted: { u: string; lift: number; p: Post }[] = [];
  for (const [u, posts] of Object.entries(byUser)) {
    const hidden = posts.filter((p) => p.like_count == null).length / posts.length > 0.3;
    const score = (p: Post) => (hidden ? p.comments_count : p.like_count == null ? null : p.like_count + (p.comments_count ?? 0));
    const vals = posts.map(score).filter((x): x is number => x != null);
    const med = Math.max(median(vals), 1);
    for (const p of posts) { const v = score(p); if (v != null) lifted.push({ u, lift: v / med, p }); }
  }
  const topRefs = lifted.filter((x) => Date.now() - new Date(x.p.posted_at).getTime() < 120 * 86400_000)
    .sort((a, b) => b.lift - a.lift).slice(0, 12)
    .map((x) => `- @${x.u} [${fmt(x.p)}] ${x.lift.toFixed(1)}× o típico da conta: "${clip(x.p.caption, 350)}"`);

  // Melhores dias/horários (posts das referências, relativo ao típico da conta)
  const days = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  const byDay: number[][] = days.map(() => []); const byHour: Record<string, number[]> = {};
  for (const x of lifted) {
    const d = new Date(new Date(x.p.posted_at).getTime() - 3 * 3600_000);
    byDay[d.getUTCDay()].push(x.lift);
    const h = d.getUTCHours(); const b = h < 6 ? "madrugada" : h < 12 ? "manhã" : h < 18 ? "tarde" : "noite";
    (byHour[b] ??= []).push(x.lift);
  }
  const bestDays = byDay.map((v, i) => ({ d: days[i], m: median(v), n: v.length })).filter((x) => x.n >= 3).sort((a, b) => b.m - a.m).slice(0, 2).map((x) => x.d);
  const bestHour = Object.entries(byHour).filter(([, v]) => v.length >= 3).map(([k, v]) => ({ k, m: median(v) })).sort((a, b) => b.m - a.m)[0]?.k;

  return {
    account: acc.data,
    refsList: (refs.data ?? []).map((r) => `@${r.username}`).join(", "),
    topOwn: topOwn.join("\n") || "(sem dados ainda)",
    topRefs: topRefs.join("\n") || "(sem dados ainda)",
    timing: `Melhores dias nas referências: ${bestDays.join(" e ") || "sem dados"}. Melhor faixa: ${bestHour ?? "sem dados"}.`,
  };
}

const SYSTEM = `Você é o curador de conteúdo do Instagram da Forklin (@forklinbr), empresa brasileira de softwares e automações (linhas FOR Education, para instituições de ensino, e FOR Sales, para times comerciais; conceito "soluções que simplificam").
Identidade visual: azul navy #083B87, ciano #10C7FC, azul luminoso #1F66C2, fundo claro #F7F9FB, fonte Montserrat, símbolo hexagonal.
Você analisa a peça (imagens ou quadros de vídeo) e escreve copies em português do Brasil, tom profissional, próximo e direto, sem clichês de IA e sem exagero de emojis.
Baseie as recomendações nos padrões dos posts de melhor desempenho que serão informados (da própria Forklin e das referências). Não copie textos das referências: adapte o padrão (estrutura, gancho, CTA) para a Forklin.
Responda SOMENTE com um objeto JSON válido, sem markdown.`;

const SCHEMA = `Formato de resposta (JSON):
{
  "resumo": "1-2 frases sobre o que a peça comunica",
  "nota": número de 0 a 10,
  "pontos_fortes": ["..."],
  "melhorias": ["ações concretas para melhorar a peça"],
  "gancho": {"avaliacao": "o primeiro quadro/primeira imagem prende atenção? por quê", "sugestao": "como melhorar o gancho"},
  "texto_na_arte": {"avaliacao": "legibilidade e quantidade de texto", "sugestao": "..."},
  "identidade_visual": "aderência às cores, fonte e símbolo da Forklin",
  "formato_recomendado": "Reels, Carrossel ou Imagem, com justificativa curta",
  "copies": [
    {"tipo": "curta", "texto": "legenda pronta para publicar", "por_que": "padrão de sucesso em que se baseia"},
    {"tipo": "media", "texto": "...", "por_que": "..."},
    {"tipo": "longa", "texto": "...", "por_que": "..."}
  ],
  "cta": "chamada para ação recomendada",
  "hashtags": ["#..."],
  "melhor_horario": {"dia": "...", "faixa": "...", "justificativa": "..."},
  "referencias_usadas": ["quais posts/padrões inspiraram as sugestões"]
}`;

async function groqChat(key: string, model: string, messages: unknown[]) {
  const call = async (m: string, extra: Record<string, unknown>) => fetch(`${GROQ}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: m, messages, temperature: 0.6, max_completion_tokens: 3500, response_format: { type: "json_object" }, ...extra }),
  });
  // Tenta esconder o raciocínio (modelos Qwen); se o parâmetro não for aceito, repete sem ele.
  let r = await call(model, { reasoning_format: "hidden" });
  if (r.status === 400) {
    const t = await r.text();
    if (/reasoning/i.test(t)) r = await call(model, {});
    else if (/model/i.test(t) && model !== FALLBACK_MODEL) { model = FALLBACK_MODEL; r = await call(model, { reasoning_format: "hidden" }); }
    else return { error: `Groq: ${t.slice(0, 300)}`, model };
  }
  if (r.status === 404 && model !== FALLBACK_MODEL) { model = FALLBACK_MODEL; r = await call(model, { reasoning_format: "hidden" }); }
  if (!r.ok) return { error: `Groq HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`, model };
  const data = await r.json();
  const content: string = data.choices?.[0]?.message?.content ?? "";
  const jsonText = content.replace(/^[\s\S]*?(\{)/, "$1").replace(/\}[^}]*$/, "}");
  try { return { result: JSON.parse(jsonText), model, usage: data.usage }; }
  catch { return { error: "A IA respondeu fora do formato esperado. Tente novamente.", model, raw: content.slice(0, 500) }; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin();
  if (!(await readSession(db, req))) return json({ error: "Sessão expirada. Entre novamente." }, 401);

  if (req.method === "GET") {
    const { data } = await db.from("fia_curator_runs").select("id,created_at,kind,draft,context,goal,transcript,thumb,model,result,error").order("created_at", { ascending: false }).limit(20);
    return json({ runs: data ?? [] });
  }

  const key = await getConfig(db, "groq_api_key");
  if (!key) return json({ error: "Chave do Groq não configurada. Cadastre em Token e chaves." }, 400);
  const body = await req.json().catch(() => ({}));

  if (body.action === "transcribe") {
    const b64 = String(body.audio_base64 || "");
    if (!b64 || b64.length > 30_000_000) return json({ error: "Áudio inválido ou grande demais." }, 400);
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const fd = new FormData();
    fd.append("file", new File([bin], "audio.wav", { type: "audio/wav" }));
    fd.append("model", "whisper-large-v3-turbo");
    fd.append("language", "pt");
    fd.append("response_format", "json");
    const r = await fetch(`${GROQ}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: fd });
    if (!r.ok) return json({ error: `Transcrição falhou (HTTP ${r.status}): ${(await r.text()).slice(0, 200)}` }, 400);
    const t = await r.json();
    return json({ text: (t.text ?? "").trim() });
  }

  if (body.action === "analyze") {
    const images: string[] = (Array.isArray(body.images) ? body.images : []).filter((s: unknown) => typeof s === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(s as string)).slice(0, MAX_IMAGES);
    if (!images.length) return json({ error: "Envie pelo menos uma imagem ou um vídeo." }, 400);
    const kind = ["image", "carousel", "video"].includes(body.kind) ? body.kind : "image";
    const ctx = await buildContext(db);
    const model = (await getConfig(db, "groq_vision_model")) ?? DEFAULT_MODEL;

    const desc = kind === "video"
      ? "As imagens são do VÍDEO: a primeira é o quadro de abertura (gancho, primeiros segundos); a seguinte é uma grade com quadros ao longo do vídeo, em ordem."
      : kind === "carousel" ? "As imagens são de um CARROSSEL, na ordem dos slides (grades indicam vários slides em sequência)." : "A imagem é um post de feed único.";
    const userText = [
      desc,
      body.transcript ? `Fala do vídeo (transcrição):\n"${clip(body.transcript, 3000)}"` : "",
      body.goal ? `Objetivo do post: ${clip(body.goal, 200)}` : "",
      body.context ? `Contexto/produto: ${clip(body.context, 400)}` : "",
      body.draft ? `Rascunho ou ideia de legenda enviada pelo time:\n"${clip(body.draft, 2000)}"` : "",
      `Bio atual do perfil: "${clip(ctx.account?.biography ?? "", 300)}" (${ctx.account?.followers_count ?? "?"} seguidores).`,
      `POSTS DE MAIOR SUCESSO DA FORKLIN (alcance e interação):\n${ctx.topOwn}`,
      `POSTS QUE MAIS SE DESTACARAM NAS REFERÊNCIAS (${ctx.refsList}), medidos contra o típico de cada conta:\n${ctx.topRefs}`,
      ctx.timing,
      SCHEMA,
    ].filter(Boolean).join("\n\n");

    const messages = [
      { role: "system", content: SYSTEM },
      { role: "user", content: [{ type: "text", text: userText }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))] },
    ];
    const out = await groqChat(key, model, messages);
    const thumb = typeof body.thumb === "string" && body.thumb.length < 60_000 ? body.thumb : null;
    const { data: run } = await db.from("fia_curator_runs").insert({
      kind, draft: body.draft ?? null, context: body.context ?? null, goal: body.goal ?? null, transcript: body.transcript ?? null,
      thumb, model: out.model, result: "result" in out ? out.result : null, error: "error" in out ? out.error : null,
    }).select("id,created_at").single();
    if ("error" in out) return json({ error: out.error, id: run?.id }, 502);
    return json({ id: run?.id, created_at: run?.created_at, model: out.model, result: out.result });
  }

  return json({ error: "Ação desconhecida." }, 400);
});
