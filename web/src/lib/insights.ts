// Análise de benchmark: compara a Forklin com os perfis de referência
// a partir dos dados públicos da Business Discovery (curtidas, comentários, formato, horário, legenda).
import type { RefAccount, RefMedia } from "./api";
import { dec, formatLabel, median, mult, WEEKDAYS } from "./format";

export type PostLite = {
  media_type: string; media_product_type: string; caption: string | null; posted_at: string;
  like_count: number | null; comments_count: number | null; permalink: string; username?: string;
};

export type AccountStats = {
  username: string; followers: number | null; posts: number; postsPerWeek: number;
  medianInteractions: number | null; engagementRate: number | null; // mediana (curtidas+coment.)/seguidores
  formatMix: Record<string, number>; topFormat: string | null;
};

const inter = (p: PostLite) => (p.like_count ?? 0) + (p.comments_count ?? 0);

export function accountStats(username: string, followers: number | null, posts: PostLite[]): AccountStats {
  const recent = posts.filter((p) => Date.now() - new Date(p.posted_at).getTime() < 90 * 86400_000);
  const sample = recent.length >= 5 ? recent : posts.slice(0, 20);
  const times = sample.map((p) => new Date(p.posted_at).getTime());
  const spanWeeks = times.length > 1 ? Math.max((Math.max(...times) - Math.min(...times)) / (7 * 86400_000), 1) : 1;
  const med = median(sample.map(inter));
  const mix: Record<string, number> = {};
  for (const p of sample) mix[formatLabel(p)] = (mix[formatLabel(p)] ?? 0) + 1;
  const byFmt = groupMedian(sample, (p) => formatLabel(p));
  const topFormat = Object.entries(byFmt).filter(([, v]) => v.n >= 2).sort((a, b) => b[1].median - a[1].median)[0]?.[0] ?? null;
  return {
    username, followers, posts: sample.length,
    postsPerWeek: sample.length / spanWeeks,
    medianInteractions: med,
    engagementRate: followers && med != null ? med / followers : null,
    formatMix: mix, topFormat,
  };
}

function groupMedian(posts: PostLite[], key: (p: PostLite) => string) {
  const g: Record<string, number[]> = {};
  for (const p of posts) (g[key(p)] ??= []).push(inter(p));
  const out: Record<string, { median: number; n: number }> = {};
  for (const [k, v] of Object.entries(g)) out[k] = { median: median(v) ?? 0, n: v.length };
  return out;
}

// Desempenho relativo: interações do post ÷ mediana da própria conta (normaliza tamanho de perfil)
export function relativePosts(refs: RefAccount[], media: RefMedia[]) {
  const medByUser: Record<string, number> = {};
  for (const r of refs) {
    const v = media.filter((m) => m.username === r.username).map(inter);
    medByUser[r.username] = median(v) ?? 1;
  }
  return media.map((m) => ({ ...m, lift: inter(m) / Math.max(medByUser[m.username] || 1, 1) }));
}

export function formatPerformance(refs: RefAccount[], media: RefMedia[]) {
  const rel = relativePosts(refs, media);
  const g: Record<string, number[]> = {};
  for (const m of rel) (g[formatLabel(m)] ??= []).push(m.lift);
  return Object.entries(g).map(([fmt, v]) => ({ fmt, lift: median(v) ?? 0, n: v.length })).sort((a, b) => b.lift - a.lift);
}

export function weekdayPerformance(refs: RefAccount[], media: RefMedia[]) {
  const rel = relativePosts(refs, media);
  const g: number[][] = Array.from({ length: 7 }, () => []);
  for (const m of rel) g[new Date(m.posted_at).getDay()].push(m.lift);
  return g.map((v, i) => ({ day: WEEKDAYS[i], lift: median(v) ?? 0, n: v.length }));
}

export function hourPerformance(refs: RefAccount[], media: RefMedia[]) {
  const rel = relativePosts(refs, media);
  const buckets = [
    { label: "Madrugada (0–6h)", from: 0, to: 6 }, { label: "Manhã (6–12h)", from: 6, to: 12 },
    { label: "Tarde (12–18h)", from: 12, to: 18 }, { label: "Noite (18–24h)", from: 18, to: 24 },
  ];
  return buckets.map((b) => {
    const v = rel.filter((m) => {
      const h = Number(new Date(m.posted_at).toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" })) % 24;
      return h >= b.from && h < b.to;
    }).map((m) => m.lift);
    return { label: b.label, lift: median(v) ?? 0, n: v.length };
  });
}

// Traços de legenda que aparecem mais nos posts acima da mediana
export function captionSignals(refs: RefAccount[], media: RefMedia[]) {
  const rel = relativePosts(refs, media);
  const feats: [string, (c: string) => boolean][] = [
    ["Pergunta na legenda", (c) => /\?/.test(c)],
    ["Chamada para comentar", (c) => /coment(e|a|ário)|deixa aqui|me conta|responde/i.test(c)],
    ["Pede para salvar/compartilhar", (c) => /salv(a|e)|compartilh|envi(a|e) para|manda pra/i.test(c)],
    ["Lista ou passo a passo", (c) => /(^|\n)\s*(\d+[.)]|[-•✅👉➡️])/m.test(c)],
    ["Legenda longa (300+ caracteres)", (c) => c.length >= 300],
    ["Legenda curta (até 80 caracteres)", (c) => c.length <= 80],
    ["Usa hashtags", (c) => /#\w/.test(c)],
    ["Menciona IA", (c) => /\b(ia|i\.a\.|inteligência artificial|chatgpt|gpt|claude|ai)\b/i.test(c)],
  ];
  return feats.map(([name, test]) => {
    const withF = rel.filter((m) => test(m.caption ?? "")).map((m) => m.lift);
    const without = rel.filter((m) => !test(m.caption ?? "")).map((m) => m.lift);
    return { name, with: median(withF), without: median(without), n: withF.length };
  }).filter((f) => f.n >= 4 && f.with != null && f.without != null)
    .map((f) => ({ ...f, effect: (f.with! / Math.max(f.without!, 0.01)) - 1 }))
    .sort((a, b) => b.effect - a.effect);
}

export type Insight = { kind: "ok" | "bad" | "tip"; title: string; text: string };

export function buildInsights(own: AccountStats | null, refStats: AccountStats[], refs: RefAccount[], media: RefMedia[]): Insight[] {
  const out: Insight[] = [];
  if (!media.length) return out;
  const fmt = formatPerformance(refs, media).filter((f) => f.n >= 4);
  if (fmt.length >= 2) {
    const best = fmt[0], worst = fmt[fmt.length - 1];
    out.push({ kind: "ok", title: `${best.fmt} é o formato que mais rende nas referências`,
      text: `Nos perfis acompanhados, ${best.fmt.toLowerCase()} tem desempenho mediano ${mult(best.lift)} o típico de cada conta (${best.n} posts). ${worst.fmt} fica em ${mult(worst.lift)}.` });
    if (own && own.formatMix[best.fmt] == null)
      out.push({ kind: "tip", title: `A Forklin ainda não publica ${best.fmt.toLowerCase()}`,
        text: `É o formato com melhor resposta entre as referências. Vale testar 1 a 2 por semana e comparar o alcance com os carrosséis.` });
  }
  const wd = weekdayPerformance(refs, media).filter((d) => d.n >= 3).sort((a, b) => b.lift - a.lift);
  if (wd.length >= 3)
    out.push({ kind: "tip", title: `Melhores dias: ${wd.slice(0, 2).map((d) => d.day).join(" e ")}`,
      text: `Posts publicados nesses dias performam acima da mediana das referências. ${wd[wd.length - 1].day} é o dia mais fraco.` });
  const hr = hourPerformance(refs, media).filter((h) => h.n >= 3).sort((a, b) => b.lift - a.lift);
  if (hr.length >= 2) out.push({ kind: "tip", title: `Melhor faixa de horário: ${hr[0].label}`, text: `Posts nessa faixa rendem ${mult(hr[0].lift)} a mediana de cada conta.` });
  const cap = captionSignals(refs, media);
  const good = cap.filter((c) => c.effect > 0.15).slice(0, 2);
  const bad = cap.filter((c) => c.effect < -0.15).slice(-1);
  for (const c of good) out.push({ kind: "ok", title: `${c.name} está associado a mais interação`, text: `Posts com esse traço rendem ${Math.round(c.effect * 100)}% a mais que os sem (${c.n} posts).` });
  for (const c of bad) out.push({ kind: "bad", title: `${c.name} tende a render menos`, text: `Posts com esse traço rendem ${Math.round(-c.effect * 100)}% a menos que os sem (${c.n} posts).` });
  if (own) {
    const refFreq = median(refStats.map((r) => r.postsPerWeek));
    if (refFreq && own.postsPerWeek < refFreq * 0.6)
      out.push({ kind: "bad", title: "Frequência abaixo das referências",
        text: `A Forklin publica ~${dec(own.postsPerWeek)} posts/semana; a mediana das referências é ~${dec(refFreq)}. Constância pesa no alcance.` });
    const refEng = median(refStats.map((r) => r.engagementRate).filter((x): x is number => x != null));
    if (refEng && own.engagementRate != null)
      out.push(own.engagementRate >= refEng
        ? { kind: "ok", title: "Engajamento por seguidor acima das referências", text: `Taxa da Forklin: ${dec(own.engagementRate * 100)}% vs ${dec(refEng * 100)}% de mediana. Base pequena e engajada é um bom ponto de partida para escalar alcance.` }
        : { kind: "bad", title: "Engajamento por seguidor abaixo das referências", text: `Taxa da Forklin: ${dec(own.engagementRate * 100)}% vs ${dec(refEng * 100)}% de mediana.` });
  }
  out.push({ kind: "tip", title: "Como ler estes números",
    text: "A Meta só libera curtidas e comentários de perfis de terceiros (não alcance, salvos ou compartilhamentos). Por isso a comparação usa o desempenho de cada post relativo ao típico da própria conta, o que evita que perfis grandes dominem a análise." });
  return out;
}
