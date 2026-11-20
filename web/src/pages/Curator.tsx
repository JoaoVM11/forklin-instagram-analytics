import { useRef, useState } from "react";
import { api, type CuratorResult, type CuratorRun } from "../lib/api";
import { dateTimeBR } from "../lib/format";
import { contactSheet, extractAudioWav, extractVideoFrames, imageToDataURL, thumbFrom } from "../lib/media";
import { useData } from "../lib/useData";
import { Card, PageHead } from "../components/ui";

type Prepared = { kind: "image" | "carousel" | "video"; images: string[]; previews: string[]; thumb: string; file?: File; label: string };

const GOALS = ["Alcance / awareness", "Engajamento (comentários e compartilhamentos)", "Gerar leads / vendas", "Autoridade / educativo"];
const CONTEXTS = ["Forklin institucional", "FOR Education", "FOR Sales", "Outro"];

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button className="btn ghost" style={{ padding: "4px 10px", fontSize: 12 }}
      onClick={async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* sem permissão */ } }}>
      {ok ? "Copiado ✓" : "Copiar"}
    </button>
  );
}

function Score({ n }: { n: number }) {
  const cls = n >= 7.5 ? "good" : n >= 5 ? "warning" : "critical";
  return <span className={`status-pill ${cls}`} style={{ fontSize: 15 }}>Nota {n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}/10</span>;
}

export function ResultView({ r }: { r: CuratorResult }) {
  const list = (items?: string[]) => items?.length ? <ul style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <span className="sub">—</span>;
  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Diagnóstico</h3>
          {typeof r.nota === "number" && <Score n={r.nota} />}
        </div>
        <p style={{ margin: "10px 0 0", lineHeight: 1.5 }}>{r.resumo}</p>
      </div>

      <div className="section-title" style={{ margin: "8px 0 0" }}>Copies sugeridas</div>
      {r.copies?.map((c, i) => (
        <div className="card" key={i}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <span className="tag">{c.tipo === "media" ? "Média" : c.tipo.charAt(0).toUpperCase() + c.tipo.slice(1)}</span>
            <CopyBtn text={`${c.texto}${r.hashtags?.length ? `\n\n${r.hashtags.join(" ")}` : ""}`} />
          </div>
          <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.55, margin: "10px 0" }}>{c.texto}</p>
          <div className="sub" style={{ margin: 0 }}>Por quê: {c.por_que}</div>
        </div>
      ))}
      <div className="grid two">
        <Card title="CTA e hashtags">
          <p style={{ margin: "0 0 8px" }}><b>CTA:</b> {r.cta}</p>
          <p style={{ margin: 0, color: "var(--forklin-blue-bright)" }}>{r.hashtags?.join(" ")}</p>
        </Card>
        <Card title="Quando postar">
          <p style={{ margin: "0 0 6px" }}><b>{r.melhor_horario?.dia}</b> · {r.melhor_horario?.faixa}</p>
          <p className="sub" style={{ margin: 0 }}>{r.melhor_horario?.justificativa}</p>
        </Card>
      </div>

      <div className="section-title" style={{ margin: "8px 0 0" }}>Análise da peça</div>
      <div className="grid two">
        <Card title="Pontos fortes">{list(r.pontos_fortes)}</Card>
        <Card title="O que melhorar">{list(r.melhorias)}</Card>
        <Card title="Gancho (primeiros segundos / 1ª imagem)"><p style={{ margin: 0 }}>{r.gancho?.avaliacao}</p><p className="sub" style={{ margin: "8px 0 0" }}>Sugestão: {r.gancho?.sugestao}</p></Card>
        <Card title="Texto na arte"><p style={{ margin: 0 }}>{r.texto_na_arte?.avaliacao}</p><p className="sub" style={{ margin: "8px 0 0" }}>Sugestão: {r.texto_na_arte?.sugestao}</p></Card>
        <Card title="Identidade visual"><p style={{ margin: 0 }}>{r.identidade_visual}</p></Card>
        <Card title="Formato recomendado"><p style={{ margin: 0 }}>{r.formato_recomendado}</p></Card>
      </div>
      {!!r.referencias_usadas?.length && <Card title="Padrões de referência usados">{list(r.referencias_usadas)}</Card>}
    </div>
  );
}

export default function CuratorPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [prep, setPrep] = useState<Prepared | null>(null);
  const [draft, setDraft] = useState("");
  const [goal, setGoal] = useState(GOALS[0]);
  const [context, setContext] = useState(CONTEXTS[0]);
  const [withAudio, setWithAudio] = useState(true);
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<CuratorResult | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [open, setOpen] = useState<CuratorRun | null>(null);
  const history = useData(() => api.curatorHistory(), []);

  async function onFiles(list: FileList | null) {
    setErr(null); setResult(null); setTranscript(null); setOpen(null);
    if (!list?.length) return;
    const files = Array.from(list);
    const video = files.find((f) => f.type.startsWith("video/"));
    try {
      if (video) {
        setStep("Lendo o vídeo e separando os quadros…");
        const v = await extractVideoFrames(video);
        setPrep({ kind: "video", images: [v.hook, v.sheet], previews: [v.hook, ...v.frames], thumb: v.thumb, file: video, label: `${video.name} · ${Math.round(v.duration)}s` });
      } else {
        const imgs = files.filter((f) => f.type.startsWith("image/")).slice(0, 20);
        if (!imgs.length) throw new Error("Formato não suportado. Envie JPG, PNG, WEBP ou um vídeo MP4/MOV.");
        setStep("Preparando as imagens…");
        const urls = await Promise.all(imgs.map((f) => imageToDataURL(f)));
        let images = urls;
        if (urls.length > 3) images = [urls[0], urls[1], await contactSheet(urls.slice(2), 3, 400)];
        setPrep({ kind: urls.length > 1 ? "carousel" : "image", images, previews: urls, thumb: await thumbFrom(urls[0]), label: urls.length > 1 ? `Carrossel · ${urls.length} imagens` : imgs[0].name });
      }
    } catch (e) { setErr((e as Error).message); setPrep(null); } finally { setStep(null); }
  }

  async function analyze() {
    if (!prep) return;
    setErr(null); setResult(null);
    try {
      let t: string | undefined;
      if (prep.kind === "video" && withAudio && prep.file) {
        setStep("Extraindo e transcrevendo o áudio…");
        const wav = await extractAudioWav(prep.file);
        if (wav) { t = (await api.transcribe(wav)).text; setTranscript(t || null); }
      }
      setStep("Analisando a peça e escrevendo as copies…");
      const r = await api.analyze({ kind: prep.kind, images: prep.images, draft: draft || undefined, goal, context, transcript: t, thumb: prep.thumb });
      setResult(r.result);
      history.reload();
    } catch (e) { setErr((e as Error).message); } finally { setStep(null); }
  }

  return (
    <>
      <PageHead title="Curador de posts" subtitle="Envie a arte ou o vídeo: o curador avalia a peça e sugere a melhor copy com base nos posts de mais sucesso da Forklin e das referências." />

      <div className="grid two">
        <div className="card">
          <h3>1. Peça</h3>
          <div className="sub">Imagem, carrossel (várias imagens) ou vídeo/reels</div>
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}
            role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && fileRef.current?.click()}
            style={{ border: "2px dashed var(--forklin-line)", borderRadius: 12, padding: prep ? 12 : "36px 16px", textAlign: "center", cursor: "pointer", background: "#FBFCFE" }}
          >
            {prep ? (
              <>
                <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6 }}>
                  {prep.previews.slice(0, 9).map((p, i) => <img key={i} src={p} alt="" style={{ height: 96, borderRadius: 6, flex: "0 0 auto" }} />)}
                </div>
                <div className="sub" style={{ margin: "6px 0 0" }}>{prep.label} · clique para trocar</div>
              </>
            ) : (
              <>
                <div style={{ fontWeight: 600 }}>Arraste aqui ou clique para escolher</div>
                <div className="sub" style={{ margin: "4px 0 0" }}>JPG, PNG, WEBP · MP4/MOV (os quadros e o áudio são lidos no seu navegador)</div>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" hidden multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" onChange={(e) => onFiles(e.target.files)} />
          {prep?.kind === "video" && (
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, fontSize: 13 }}>
              <input type="checkbox" checked={withAudio} onChange={(e) => setWithAudio(e.target.checked)} /> Transcrever a fala do vídeo (Whisper)
            </label>
          )}
        </div>

        <div className="card">
          <h3>2. Contexto</h3>
          <div className="sub">Opcional, mas melhora muito a sugestão</div>
          <div style={{ display: "grid", gap: 10 }}>
            <div className="grid two" style={{ gap: 10 }}>
              <label style={{ fontSize: 12, color: "var(--forklin-muted)" }}>Objetivo
                <select className="field" value={goal} onChange={(e) => setGoal(e.target.value)}>{GOALS.map((g) => <option key={g}>{g}</option>)}</select>
              </label>
              <label style={{ fontSize: 12, color: "var(--forklin-muted)" }}>Linha / produto
                <select className="field" value={context} onChange={(e) => setContext(e.target.value)}>{CONTEXTS.map((g) => <option key={g}>{g}</option>)}</select>
              </label>
            </div>
            <label style={{ fontSize: 12, color: "var(--forklin-muted)" }}>Ideia ou rascunho da legenda
              <textarea className="field" rows={5} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ex.: lançamento do módulo de matrículas do FOR Education, foco em secretarias escolares" />
            </label>
            <div><button className="btn" disabled={!prep || !!step} onClick={analyze}>{step ? "Processando…" : "Analisar e sugerir copy"}</button></div>
          </div>
        </div>
      </div>

      {step && <div className="card" style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center" }}><span className="spinner" aria-hidden /> {step}</div>}
      {err && <div className="card err" style={{ marginTop: 16 }}>{err}</div>}

      {result && (
        <>
          <div className="section-title">Resultado</div>
          {transcript && <Card title="Fala transcrita do vídeo"><p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{transcript}</p></Card>}
          <div style={{ height: transcript ? 16 : 0 }} />
          <ResultView r={result} />
        </>
      )}

      <div className="section-title">Histórico</div>
      <div className="card">
        {!history.data?.runs.length ? <div className="empty">Nenhuma análise ainda.</div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Peça</th><th>Quando</th><th>Tipo</th><th>Objetivo</th><th className="num">Nota</th><th /></tr></thead>
            <tbody>
              {history.data.runs.map((r) => (
                <tr key={r.id}>
                  <td>{r.thumb ? <img className="thumb" src={r.thumb} alt="" /> : <div className="thumb" />}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{dateTimeBR(r.created_at)}</td>
                  <td><span className="tag">{r.kind === "video" ? "Vídeo" : r.kind === "carousel" ? "Carrossel" : "Imagem"}</span></td>
                  <td className="cap">{r.goal ?? "—"}</td>
                  <td className="num">{r.result?.nota ?? (r.error ? "erro" : "—")}</td>
                  <td>{r.result && <button className="btn ghost" style={{ padding: "4px 10px" }} onClick={() => { setOpen(open?.id === r.id ? null : r); }}>{open?.id === r.id ? "Fechar" : "Ver"}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
      {open?.result && <div style={{ marginTop: 16 }}><ResultView r={open.result} /></div>}
    </>
  );
}
