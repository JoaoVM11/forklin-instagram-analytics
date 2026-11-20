import { useMemo, useState } from "react";
import { api, type RefAccount, type RefMedia } from "../lib/api";
import { compact, dateBR, dec, fmt, formatLabel, mult, pct } from "../lib/format";
import { useData } from "../lib/useData";
import { accountStats, likesHidden, buildInsights, captionSignals, formatPerformance, relativePosts, weekdayPerformance } from "../lib/insights";
import { Bars, Card, Loading, PageHead } from "../components/ui";

type RefsData = {
  refs: RefAccount[]; media: RefMedia[];
  own: { username: string; followers_count: number; media_count: number } | null;
  ownMedia: RefMedia[];
};

export default function RefsPage() {
  const { data, error, reload } = useData(() => api.get<RefsData>("refs"), []);
  const [newRef, setNewRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const analysis = useMemo(() => {
    if (!data) return null;
    const refStats = data.refs.filter((r) => r.followers_count).map((r) => accountStats(r.username, r.followers_count, data.media.filter((m) => m.username === r.username)));
    const own = data.own ? accountStats(data.own.username, data.own.followers_count, data.ownMedia) : null;
    return {
      refStats, own,
      insights: buildInsights(own, refStats, data.refs, data.media),
      formats: formatPerformance(data.refs, data.media),
      weekdays: weekdayPerformance(data.refs, data.media),
      captions: captionSignals(data.refs, data.media),
      top: relativePosts(data.refs, data.media).filter((m) => Date.now() - new Date(m.posted_at).getTime() < 60 * 86400_000).sort((a, b) => b.lift - a.lift).slice(0, 10),
    };
  }, [data]);

  async function add() {
    setBusy(true); setMsg(null);
    try {
      await api.post({ action: "add_ref", username: newRef });
      await api.sync("refs");
      setNewRef(""); reload();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  async function remove(u: string) {
    if (!confirm(`Parar de acompanhar @${u}? O histórico coletado será apagado.`)) return;
    await api.post({ action: "remove_ref", username: u }); reload();
  }

  if (!data || !analysis) return <><PageHead title="Referências" subtitle="Benchmark com perfis do segmento" /><Loading error={error} /></>;
  const rows = [...(analysis.own ? [{ ...analysis.own, isOwn: true }] : []), ...analysis.refStats.map((r) => ({ ...r, isOwn: false }))];

  return (
    <>
      <PageHead title="Referências" subtitle="O que está funcionando (e o que não está) em perfis do segmento">
        <input className="field" style={{ width: 200 }} placeholder="@perfil" value={newRef} onChange={(e) => setNewRef(e.target.value)} onKeyDown={(e) => e.key === "Enter" && newRef && add()} />
        <button className="btn" disabled={!newRef || busy} onClick={add}>{busy ? "Buscando…" : "Acompanhar"}</button>
      </PageHead>
      {msg && <div className="err">{msg}</div>}

      <div className="section-title">Insights</div>
      <div className="card">
        {analysis.insights.length ? analysis.insights.map((i, k) => (
          <div className="insight" key={k}>
            <div className={`ico ${i.kind}`}>{i.kind === "ok" ? "✓" : i.kind === "bad" ? "!" : "→"}</div>
            <div><b>{i.title}</b><p>{i.text}</p></div>
          </div>
        )) : <div className="empty">Os insights aparecem depois da primeira coleta das referências.</div>}
      </div>

      <div className="section-title">Comparativo</div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Perfil</th><th className="num">Seguidores</th><th className="num">Posts/semana</th><th className="num">Interações/post (mediana)</th><th className="num">Engaj./seguidor</th><th>Formato mais usado</th><th>Formato que mais rende</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => {
              const ref = data.refs.find((x) => x.username === r.username);
              const mostUsed = Object.entries(r.formatMix).sort((a, b) => b[1] - a[1])[0]?.[0];
              return (
                <tr key={r.username} style={r.isOwn ? { background: "#F3F7FD" } : undefined}>
                  <td><b>@{r.username}</b>{r.isOwn && <span className="tag" style={{ marginLeft: 8 }}>Forklin</span>}{!r.isOwn && likesHidden(data.media.filter((m) => m.username === r.username)) && <div style={{ fontSize: 11, color: "var(--forklin-muted)" }}>Curtidas ocultas · medido por comentários</div>}{ref?.last_error && <div className="err" style={{ fontSize: 11 }}>{ref.last_error}</div>}</td>
                  <td className="num">{compact(r.followers)}</td>
                  <td className="num">{dec(r.postsPerWeek)}</td>
                  <td className="num">{fmt(r.medianInteractions)}</td>
                  <td className="num">{pct(r.engagementRate, 2)}</td>
                  <td>{mostUsed ?? "—"}</td>
                  <td>{r.topFormat ?? "—"}</td>
                  <td>{!r.isOwn && <button className="btn ghost" style={{ padding: "4px 10px" }} onClick={() => remove(r.username)}>Remover</button>}</td>
                </tr>
              );
            })}
            {data.refs.filter((r) => !r.followers_count).map((r) => (
              <tr key={r.username}><td><b>@{r.username}</b>{r.last_error ? <div className="err" style={{ fontSize: 11 }}>{r.last_error}</div> : <div style={{ fontSize: 11, color: "var(--forklin-muted)" }}>Aguardando coleta</div>}</td><td colSpan={6} /><td><button className="btn ghost" style={{ padding: "4px 10px" }} onClick={() => remove(r.username)}>Remover</button></td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ color: "var(--forklin-muted)", fontSize: 12 }}>Engajamento por seguidor = mediana de (curtidas + comentários) por post ÷ seguidores. Perfis que escondem curtidas são medidos só por comentários, então a taxa deles aparece menor. Perfis menores costumam ter taxas maiores.</p>

      <div className="section-title">Padrões nas referências</div>
      <div className="grid two">
        <Card title="Desempenho por formato" sub="1,0× = post típico da própria conta">
          <Bars rows={analysis.formats.filter((f) => f.n >= 3).map((f) => ({ label: `${f.fmt} (${f.n})`, value: f.lift }))} valueFmt={(n) => mult(n)} />
        </Card>
        <Card title="Desempenho por dia da semana" sub="1,0× = post típico da própria conta">
          <Bars rows={analysis.weekdays.filter((d) => d.n).map((d) => ({ label: `${d.day} (${d.n})`, value: d.lift }))} valueFmt={(n) => mult(n)} />
        </Card>
      </div>
      <div style={{ height: 16 }} />
      <Card title="Traços de legenda" sub="Quanto posts com cada traço rendem a mais (ou a menos) que os sem">
        <Bars rows={analysis.captions.filter((c) => c.effect > 0).map((c) => ({ label: c.name, value: c.effect }))} valueFmt={(n) => `+${Math.round(n * 100)}%`} />
        {analysis.captions.some((c) => c.effect <= 0) && (
          <p style={{ color: "var(--forklin-muted)", fontSize: 12, marginTop: 12 }}>
            Rendem menos: {analysis.captions.filter((c) => c.effect <= 0).map((c) => `${c.name} (${Math.round(c.effect * 100)}%)`).join(" · ")}
          </p>
        )}
      </Card>

      <div className="section-title">Posts que mais se destacaram (60 dias)</div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Perfil</th><th>Post</th><th>Formato</th><th>Data</th><th className="num">Curtidas</th><th className="num">Coment.</th><th className="num">vs típico</th></tr></thead>
          <tbody>
            {analysis.top.map((m) => (
              <tr key={m.media_id}>
                <td>@{m.username}</td>
                <td><a href={m.permalink} target="_blank" rel="noreferrer" className="cap" style={{ display: "block" }}>{m.caption?.split("\n")[0] || "(sem legenda)"}</a></td>
                <td><span className="tag">{formatLabel(m)}</span></td>
                <td>{dateBR(m.posted_at)}</td>
                <td className="num">{fmt(m.like_count)}</td><td className="num">{fmt(m.comments_count)}</td>
                <td className="num"><b>{mult(m.lift, 1)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!analysis.top.length && <div className="empty">Sem posts coletados ainda.</div>}
      </div>
    </>
  );
}
