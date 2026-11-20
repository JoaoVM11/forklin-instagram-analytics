export const nf = new Intl.NumberFormat("pt-BR");
export const fmt = (n: number | null | undefined) => (n == null ? "—" : nf.format(Math.round(n)));
export const pct = (n: number | null | undefined, digits = 1) =>
  n == null || !isFinite(n) ? "—" : `${(n * 100).toLocaleString("pt-BR", { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`;
export const compact = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(n);
export const dateBR = (s: string) => new Date(s).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
export const dateTimeBR = (s: string) =>
  new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
export const sum = <T,>(arr: T[], f: (x: T) => number | null | undefined) => arr.reduce((a, x) => a + (f(x) ?? 0), 0);
export const avg = <T,>(arr: T[], f: (x: T) => number | null | undefined) => {
  const v = arr.map(f).filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
export const median = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export function formatLabel(m: { media_type: string; media_product_type?: string }) {
  if (m.media_product_type === "REELS") return "Reels";
  if (m.media_type === "CAROUSEL_ALBUM") return "Carrossel";
  if (m.media_type === "VIDEO") return "Vídeo";
  return "Imagem";
}
export const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export const mult = (n: number, d = 2) => `${n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d })}×`;
export const dec = (n: number, d = 1) => n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
