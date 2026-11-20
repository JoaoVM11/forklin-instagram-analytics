import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type Story } from "../lib/api";
import { avg, dateTimeBR, fmt, pct, sum } from "../lib/format";
import { useData } from "../lib/useData";
import { Bars, Card, ChartTip, Kpi, Loading, PageHead, Range } from "../components/ui";

const axis = { stroke: "#77808E", fontSize: 11, tickLine: false, axisLine: false };

export default function StoriesPage() {
  const [days, setDays] = useState(30);
  const { data, error } = useData(() => api.get<{ stories: Story[] }>("stories", `days=${days}`), [days]);
  const head = (
    <PageHead title="Stories" subtitle="Alcance, respostas e retenção de cada story">
      <Range value={days} onChange={setDays} />
    </PageHead>
  );
  if (!data) return <>{head}<Loading error={error} /></>;
  const s = data.stories;

  // Retenção: quem avançou para o próximo story vs quem saiu
  const exits = sum(s, (x) => x.exits), fwd = sum(s, (x) => x.taps_forward), back = sum(s, (x) => x.taps_back), swipe = sum(s, (x) => x.swipe_forward);
  const nav = [
    { label: "Avançaram (toque)", value: fwd }, { label: "Saíram dos stories", value: exits },
    { label: "Voltaram (toque)", value: back }, { label: "Pularam a conta (deslizar)", value: swipe },
  ];
  const chart = [...s].reverse().map((x) => ({ id: x.story_id, at: x.posted_at, Alcance: x.reach ?? 0 }));

  return (
    <>
      {head}
      <div className="grid kpis">
        <Kpi label="Stories publicados" value={fmt(s.length)} />
        <Kpi label="Alcance médio por story" value={fmt(avg(s, (x) => x.reach))} />
        <Kpi label="Views totais" value={fmt(sum(s, (x) => x.views))} />
        <Kpi label="Respostas" value={fmt(sum(s, (x) => x.replies))} />
        <Kpi label="Compartilhamentos" value={fmt(sum(s, (x) => x.shares))} />
        <Kpi label="Visitas ao perfil" value={fmt(sum(s, (x) => x.profile_visits))} />
      </div>
      <p style={{ color: "var(--forklin-muted)", fontSize: 12, marginTop: 8 }}>
        A Meta só disponibiliza stories por 24h. A coleta roda de hora em hora, então o histórico começa a partir do dia em que o sistema foi ligado.
        Curtidas em stories não são liberadas pela API; o equivalente disponível são as respostas e as interações totais.
      </p>

      <div className="section-title">Desempenho</div>
      <div className="grid two">
        <Card title="Alcance por story" sub="Em ordem de publicação">
          {chart.length ? (
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={chart} margin={{ left: -16, right: 8, top: 8 }}>
                <CartesianGrid stroke="#EEF1F5" vertical={false} />
                <XAxis dataKey="at" tickFormatter={(v) => new Date(v).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} {...axis} minTickGap={16} />
                <YAxis {...axis} allowDecimals={false} />
                <Tooltip content={<ChartTip labelFmt={dateTimeBR} />} cursor={{ fill: "#F3F6FA" }} />
                <Bar dataKey="Alcance" fill="#1F66C2" radius={[4, 4, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="empty">Nenhum story coletado neste período ainda.</div>}
        </Card>
        <Card title="Navegação" sub={`Taxa de saída: ${pct(exits && fwd + exits ? exits / (fwd + exits) : null)} (quanto menor, melhor)`}>
          <Bars rows={nav} />
        </Card>
      </div>

      <div className="section-title">Cada story</div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Story</th><th>Publicado</th><th className="num">Alcance</th><th className="num">Views</th><th className="num">Respostas</th><th className="num">Compart.</th><th className="num">Interações</th><th className="num">Avançaram</th><th className="num">Saíram</th><th className="num">Visitas</th></tr></thead>
          <tbody>
            {s.map((x) => (
              <tr key={x.story_id}>
                <td><a href={x.permalink} target="_blank" rel="noreferrer"><img className="thumb" src={x.thumbnail_url || x.media_url || ""} alt="" loading="lazy" /></a></td>
                <td style={{ whiteSpace: "nowrap" }}>{dateTimeBR(x.posted_at)}</td>
                <td className="num">{fmt(x.reach)}</td><td className="num">{fmt(x.views)}</td><td className="num">{fmt(x.replies)}</td>
                <td className="num">{fmt(x.shares)}</td><td className="num">{fmt(x.total_interactions)}</td><td className="num">{fmt(x.taps_forward)}</td>
                <td className="num">{fmt(x.exits)}</td><td className="num">{fmt(x.profile_visits)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!s.length && <div className="empty">Assim que a Forklin publicar stories, eles aparecem aqui.</div>}
      </div>
    </>
  );
}
