import type { ReactNode } from "react";
import { fmt } from "../lib/format";

export function PageHead({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
        <div className="signature" />
      </div>
      {children && <div className="filters">{children}</div>}
    </div>
  );
}

export function Kpi({ label, value, delta, hint }: { label: string; value: string; delta?: number | null; hint?: string }) {
  const cls = delta == null || !isFinite(delta) ? "" : delta > 0 ? "up" : delta < 0 ? "down" : "";
  return (
    <div className="card kpi" title={hint}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {delta != null && isFinite(delta) ? (
        <div className={`delta ${cls}`}>{delta > 0 ? "▲" : delta < 0 ? "▼" : "•"} {Math.abs(delta * 100).toFixed(0)}% vs período anterior</div>
      ) : hint ? <div className="delta">{hint}</div> : null}
    </div>
  );
}

export function Card({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="card">
      <h3>{title}</h3>
      {sub && <div className="sub">{sub}</div>}
      {children}
    </div>
  );
}

export function Range({ value, onChange, options = [7, 30, 90] }: { value: number; onChange: (n: number) => void; options?: number[] }) {
  return (
    <div className="seg" role="group" aria-label="Período">
      {options.map((o) => (
        <button key={o} className={o === value ? "on" : ""} onClick={() => onChange(o)}>{o} dias</button>
      ))}
    </div>
  );
}

export function ChartTip({ active, payload, label, labelFmt }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tooltip">
      <div className="t">{labelFmt ? labelFmt(label) : label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <i style={{ width: 8, height: 8, borderRadius: 2, background: p.color, display: "inline-block" }} />
          <span>{p.name}: <b>{fmt(p.value)}</b></span>
        </div>
      ))}
    </div>
  );
}

export function Bars({ rows, valueFmt = fmt }: { rows: { label: string; value: number; hint?: string }[]; valueFmt?: (n: number) => string }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  if (!rows.length) return <div className="empty">Sem dados ainda.</div>;
  return (
    <div>
      {rows.map((r) => (
        <div className="bar-row" key={r.label} title={r.hint}>
          <span className="cap" style={{ maxWidth: 190 }} title={r.label}>{r.label}</span>
          <div className="track"><div className="fill" style={{ width: `${(r.value / max) * 100}%` }} /></div>
          <span className="num" style={{ textAlign: "right" }}>{valueFmt(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function Loading({ error }: { error?: string | null }) {
  return <div className="empty">{error ? <span className="err">{error}</span> : "Carregando…"}</div>;
}
