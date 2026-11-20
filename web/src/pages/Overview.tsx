import { useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type Daily } from "../lib/api";
import { compact, dateBR, fmt, sum } from "../lib/format";
import { useData } from "../lib/useData";
import { Bars, Card, ChartTip, Kpi, Loading, PageHead, Range } from "../components/ui";

type Overview = {
  account: { username: string; followers_count: number; media_count: number; profile_picture_url: string; name: string } | null;
  daily: Daily[]; profile: { day: string; followers_count: number }[];
  demographics: { breakdown: string; dimension: string; value: number }[];
};

const axis = { stroke: "#77808E", fontSize: 11, tickLine: false, axisLine: false };

export default function OverviewPage() {
  const [days, setDays] = useState(30);
  const { data, error } = useData(() => api.get<Overview>("overview", `days=${days * 2}`), [days]);
  if (!data) return <><PageHead title="Visão geral" subtitle="Awareness e alcance da marca no Instagram"><Range value={days} onChange={setDays} /></PageHead><Loading error={error} /></>;

  const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const cur = data.daily.filter((d) => d.day >= cutoff);
  const prev = data.daily.filter((d) => d.day < cutoff);
  const k = (f: (d: Daily) => number | null) => {
    const a = sum(cur, f), b = sum(prev, f);
    return { v: a, d: prev.length >= Math.min(days, 3) && b > 0 ? (a - b) / b : null };
  };
  const reach = k((d) => d.reach), views = k((d) => d.views), pv = k((d) => d.profile_views),
    web = k((d) => (d.website_clicks ?? 0) + (d.profile_links_taps ?? 0)), eng = k((d) => d.accounts_engaged),
    follows = k((d) => d.follows);

  const series = cur.map((d) => ({ day: d.day, Alcance: d.reach ?? 0, Visitas: d.profile_views ?? 0 }));
  const interactions = [
    { label: "Curtidas", value: sum(cur, (d) => d.likes) },
    { label: "Compartilhamentos", value: sum(cur, (d) => d.shares), hint: "Envios por direct/encaminhamentos e compartilhamentos" },
    { label: "Comentários", value: sum(cur, (d) => d.comments) },
    { label: "Salvos", value: sum(cur, (d) => d.saves) },
    { label: "Reposts", value: sum(cur, (d) => d.reposts) },
    { label: "Respostas a stories", value: sum(cur, (d) => d.replies) },
  ];
  const followers = data.profile.filter((p) => p.day >= cutoff).map((p) => ({ day: p.day, Seguidores: p.followers_count }));
  const demo = (b: string, n = 8) => data.demographics.filter((x) => x.breakdown === b).slice(0, n).map((x) => ({ label: x.dimension.replace(", São Paulo (state)", " (SP)").replace(/ \(state\)$/, ""), value: x.value }));
  const gender = demo("gender").map((g) => ({ ...g, label: g.label === "F" ? "Feminino" : g.label === "M" ? "Masculino" : "Não informado" }));

  return (
    <>
      <PageHead title="Visão geral" subtitle={`Awareness e alcance de @${data.account?.username ?? "forklinbr"}`}>
        <Range value={days} onChange={setDays} />
      </PageHead>

      <div className="grid kpis">
        <Kpi label="Seguidores" value={fmt(data.account?.followers_count)} hint={follows.v ? `+${fmt(follows.v)} novos no período` : "Total atual"} />
        <Kpi label="Contas alcançadas" value={compact(reach.v)} delta={reach.d} />
        <Kpi label="Visualizações" value={compact(views.v)} delta={views.d} />
        <Kpi label="Visitas ao perfil" value={fmt(pv.v)} delta={pv.d} />
        <Kpi label="Cliques no site e links" value={fmt(web.v)} delta={web.d} />
        <Kpi label="Contas com engajamento" value={fmt(eng.v)} delta={eng.d} />
      </div>
      <p className="sub" style={{ color: "var(--forklin-muted)", fontSize: 12, marginTop: 8 }}>
        Alcance somado por dia (uma conta que vê seu conteúdo em dois dias conta duas vezes).
      </p>

      <div className="section-title">Alcance da marca</div>
      <div className="grid two">
        <Card title="Contas alcançadas por dia" sub="Pessoas únicas que viram qualquer conteúdo (posts, reels, stories)">
          {series.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={series} margin={{ left: -16, right: 8, top: 8 }}>
                <defs><linearGradient id="g1" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#1F66C2" stopOpacity={0.18} /><stop offset="1" stopColor="#1F66C2" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid stroke="#EEF1F5" vertical={false} />
                <XAxis dataKey="day" tickFormatter={dateBR} {...axis} minTickGap={24} />
                <YAxis {...axis} allowDecimals={false} />
                <Tooltip content={<ChartTip labelFmt={dateBR} />} cursor={{ stroke: "#DCE1E8" }} />
                <Area type="monotoneX" dataKey="Alcance" stroke="#1F66C2" strokeWidth={2} fill="url(#g1)" dot={false} activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          ) : <div className="empty">Os dados diários aparecem após a primeira sincronização.</div>}
        </Card>
        <Card title="Visitas ao perfil por dia" sub="Sinal de interesse pela marca depois de ver um conteúdo">
          {series.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={series} margin={{ left: -16, right: 8, top: 8 }}>
                <CartesianGrid stroke="#EEF1F5" vertical={false} />
                <XAxis dataKey="day" tickFormatter={dateBR} {...axis} minTickGap={24} />
                <YAxis {...axis} allowDecimals={false} />
                <Tooltip content={<ChartTip labelFmt={dateBR} />} cursor={{ fill: "#F3F6FA" }} />
                <Bar dataKey="Visitas" fill="#1F66C2" radius={[4, 4, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="empty">Sem dados ainda.</div>}
        </Card>
      </div>

      <div className="section-title">Interações e crescimento</div>
      <div className="grid two">
        <Card title="Interações no período" sub="Somatório da conta: posts, reels e stories">
          <Bars rows={interactions} />
        </Card>
        <Card title="Seguidores" sub="Registrado uma vez por dia pela sincronização">
          {followers.length > 1 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={followers} margin={{ left: -8, right: 8, top: 8 }}>
                <CartesianGrid stroke="#EEF1F5" vertical={false} />
                <XAxis dataKey="day" tickFormatter={dateBR} {...axis} minTickGap={24} />
                <YAxis {...axis} domain={["dataMin - 2", "dataMax + 2"]} allowDecimals={false} />
                <Tooltip content={<ChartTip labelFmt={dateBR} />} />
                <Area type="monotoneX" dataKey="Seguidores" stroke="#1F66C2" strokeWidth={2} fill="none" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : <div className="empty">A curva de seguidores se forma a partir dos próximos dias de coleta.</div>}
        </Card>
      </div>

      <div className="section-title">Quem segue a Forklin</div>
      <div className="grid two">
        <Card title="Principais cidades"><Bars rows={demo("city")} /></Card>
        <Card title="Faixa etária e gênero">
          <Bars rows={demo("age")} />
          <div style={{ height: 12 }} />
          <Bars rows={gender} />
        </Card>
      </div>
    </>
  );
}
