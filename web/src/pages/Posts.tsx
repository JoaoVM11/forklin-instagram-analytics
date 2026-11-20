import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type Media } from "../lib/api";
import { avg, compact, dateBR, fmt, formatLabel, pct, sum } from "../lib/format";
import { useData } from "../lib/useData";
import { Bars, Card, ChartTip, Kpi, Loading, PageHead } from "../components/ui";

type Col = { key: keyof Media | "er"; label: string };
const COLS: Col[] = [
  { key: "reach", label: "Alcance" }, { key: "views", label: "Views" }, { key: "likes", label: "Curtidas" },
  { key: "comments", label: "Coment." }, { key: "shares", label: "Compart." }, { key: "saved", label: "Salvos" },
  { key: "reposts", label: "Reposts" }, { key: "profile_visits", label: "Visitas" }, { key: "follows", label: "Seguiram" },
  { key: "er", label: "Engaj./alcance" },
];
const axis = { stroke: "#77808E", fontSize: 11, tickLine: false, axisLine: false };

const er = (m: Media) => (m.reach ? (m.total_interactions ?? ((m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saved ?? 0))) / m.reach : null);

export default function PostsPage() {
  const { data, error } = useData(() => api.get<{ posts: Media[]; followers: number }>("posts"), []);
  const [sort, setSort] = useState<Col["key"]>("reach");
  const [fmtFilter, setFmtFilter] = useState("Todos");

  const posts = useMemo(() => {
    const all = (data?.posts ?? []).filter((p) => fmtFilter === "Todos" || formatLabel(p) === fmtFilter);
    return [...all].sort((a, b) => {
      const va = sort === "er" ? er(a) : (a[sort as keyof Media] as number | null);
      const vb = sort === "er" ? er(b) : (b[sort as keyof Media] as number | null);
      return (vb ?? -1) - (va ?? -1);
    });
  }, [data, sort, fmtFilter]);

  if (!data) return <><PageHead title="Posts" subtitle="Desempenho de cada publicação do feed e reels" /><Loading error={error} /></>;
  const formats = ["Todos", ...Array.from(new Set(data.posts.map(formatLabel)))];
  const last30 = data.posts.filter((p) => Date.now() - new Date(p.posted_at).getTime() < 30 * 86400_000);

  const byFormat = Object.entries(
    data.posts.reduce<Record<string, Media[]>>((acc, p) => ((acc[formatLabel(p)] ??= []).push(p), acc), {}),
  ).map(([label, arr]) => ({ label: `${label} (${arr.length})`, value: avg(arr, (p) => p.reach) ?? 0 }));

  const chart = [...data.posts].reverse().slice(-20).map((p) => ({
    id: p.media_id, day: p.posted_at, Alcance: p.reach ?? 0,
  }));

  return (
    <>
      <PageHead title="Posts" subtitle="Curtidas, compartilhamentos, salvos, reposts e alcance por publicação">
        <div className="seg">{formats.map((f) => <button key={f} className={f === fmtFilter ? "on" : ""} onClick={() => setFmtFilter(f)}>{f}</button>)}</div>
      </PageHead>

      <div className="grid kpis">
        <Kpi label="Posts (últimos 30 dias)" value={fmt(last30.length)} />
        <Kpi label="Alcance médio por post" value={compact(avg(last30.length ? last30 : data.posts, (p) => p.reach))} />
        <Kpi label="Curtidas (30 dias)" value={fmt(sum(last30, (p) => p.likes ?? p.like_count))} />
        <Kpi label="Compartilhamentos (30 dias)" value={fmt(sum(last30, (p) => p.shares))} />
        <Kpi label="Salvos (30 dias)" value={fmt(sum(last30, (p) => p.saved))} />
        <Kpi label="Reposts (30 dias)" value={fmt(sum(last30, (p) => p.reposts))} />
      </div>

      <div className="section-title">Tendência</div>
      <div className="grid two">
        <Card title="Alcance dos últimos 20 posts" sub="Em ordem de publicação">
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={chart} margin={{ left: -16, right: 8, top: 8 }}>
              <CartesianGrid stroke="#EEF1F5" vertical={false} />
              <XAxis dataKey="day" tickFormatter={dateBR} {...axis} minTickGap={16} />
              <YAxis {...axis} allowDecimals={false} />
              <Tooltip content={<ChartTip labelFmt={dateBR} />} cursor={{ fill: "#F3F6FA" }} />
              <Bar dataKey="Alcance" fill="#1F66C2" radius={[4, 4, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Alcance médio por formato" sub="Qual tipo de post leva a marca mais longe">
          <Bars rows={byFormat.sort((a, b) => b.value - a.value)} />
        </Card>
      </div>

      <div className="section-title">Todas as publicações</div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Post</th><th>Formato</th><th>Data</th>
              {COLS.map((c) => <th key={c.key} className="num" onClick={() => setSort(c.key)} aria-sort={sort === c.key ? "descending" : "none"}>{c.label}{sort === c.key ? " ↓" : ""}</th>)}
            </tr>
          </thead>
          <tbody>
            {posts.map((p) => (
              <tr key={p.media_id}>
                <td>
                  <a href={p.permalink} target="_blank" rel="noreferrer" style={{ display: "flex", gap: 10, alignItems: "center", textDecoration: "none", color: "inherit" }}>
                    <img className="thumb" src={p.thumbnail_url || p.media_url || ""} alt="" loading="lazy" />
                    <span className="cap">{p.caption?.split("\n")[0] || "(sem legenda)"}</span>
                  </a>
                </td>
                <td><span className="tag">{formatLabel(p)}</span></td>
                <td style={{ whiteSpace: "nowrap" }}>{dateBR(p.posted_at)}</td>
                {COLS.map((c) => (
                  <td key={c.key} className="num">{c.key === "er" ? pct(er(p)) : fmt((p[c.key] as number | null) ?? (c.key === "likes" ? p.like_count : c.key === "comments" ? p.comments_count : null))}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!posts.length && <div className="empty">Nenhum post sincronizado ainda.</div>}
      </div>
    </>
  );
}
