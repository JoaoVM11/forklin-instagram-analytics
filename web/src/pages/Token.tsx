import { useState } from "react";
import { api, type TokenStatus } from "../lib/api";
import { useData } from "../lib/useData";
import { Card, Loading, PageHead } from "../components/ui";

function statusOf(t: TokenStatus) {
  if (!t.configured) return { cls: "critical", text: "Nenhum token configurado" };
  if (!t.valid) return { cls: "critical", text: "Token inválido ou expirado" };
  if (t.days_left != null && t.days_left <= 7) return { cls: "warning", text: `Expira em ${t.days_left} dia(s)` };
  return { cls: "good", text: t.days_left != null ? `Válido · ${t.days_left} dias restantes` : "Válido" };
}

export default function TokenPage() {
  const { data, error, reload } = useData(() => api.tokenStatus(), []);
  const [pw, setPw] = useState("");
  const [adminSession, setAdmin] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [newPw, setNewPw] = useState(""); const [newPw2, setNewPw2] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [groqKey, setGroqKey] = useState("");
  const [groqModel, setGroqModel] = useState("");
  const [groqMsg, setGroqMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function unlock() {
    setBusy(true); setMsg(null);
    try {
      const r = await api.login(pw, "admin");
      setAdmin(r.session); setPw("");
      setTimeout(() => setAdmin(null), r.expires_in * 1000);
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }
  async function saveToken() {
    if (!adminSession) return;
    setBusy(true); setMsg(null);
    try {
      const r = await api.setToken(adminSession, token);
      setToken("");
      setMsg({ ok: true, text: `Token salvo para @${r.username}. Válido até ${r.expires_at ? new Date(r.expires_at).toLocaleDateString("pt-BR") : "—"}.` });
      reload();
      api.sync("auto").then(() => window.dispatchEvent(new Event("fia:refresh"))).catch(() => {});
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }
  async function savePw() {
    if (!adminSession) return;
    if (newPw !== newPw2) { setMsg({ ok: false, text: "As senhas não conferem." }); return; }
    setBusy(true); setMsg(null);
    try {
      await api.changePassword(adminSession, newPw);
      setNewPw(""); setNewPw2("");
      setMsg({ ok: true, text: "Senha alterada. Você vai precisar entrar novamente." });
      setTimeout(() => window.dispatchEvent(new Event("fia:logout")), 2500);
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  async function saveGroq() {
    if (!adminSession) return;
    setBusy(true); setGroqMsg(null);
    try {
      const r = await api.setGroq(adminSession, groqKey, groqModel);
      setGroqKey("");
      const warn = r.model_available === false ? ` Atenção: o modelo ${r.groq.model} não aparece na sua conta do Groq; ajuste o campo "Modelo de visão".` : "";
      setGroqMsg({ ok: r.model_available !== false, text: `Chave salva (${r.groq.masked ?? "—"}). Modelo: ${r.groq.model}.${warn}` });
      reload();
    } catch (e) { setGroqMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  const st = data ? statusOf(data) : null;

  return (
    <>
      <PageHead title="Token e chaves" subtitle="Credenciais do sistema: token da Meta (renove a cada ~60 dias) e chave do Groq usada pelo Curador." />
      {!data ? <Loading error={error} /> : (
        <div className="grid two">
          <Card title="Situação atual">
            <div className={`status-pill ${st!.cls}`} role="status">{st!.cls === "good" ? "✓" : "!"} {st!.text}</div>
            <table style={{ marginTop: 16 }}>
              <tbody>
                <tr><td>Token</td><td><code>{data.masked ?? "—"}</code></td></tr>
                <tr><td>Expira em</td><td>{data.expires_at ? new Date(data.expires_at).toLocaleString("pt-BR") : "—"}</td></tr>
                <tr><td>Acesso aos dados até</td><td>{data.data_access_expires_at ? new Date(data.data_access_expires_at).toLocaleDateString("pt-BR") : "—"}</td></tr>
                <tr><td>Atualizado em</td><td>{data.updated_at ? new Date(data.updated_at).toLocaleString("pt-BR") : "—"}</td></tr>
                <tr><td>Permissões</td><td style={{ fontSize: 12 }}>{data.scopes?.join(", ") ?? "—"}</td></tr>
              </tbody>
            </table>
            {!!data.missing_scopes?.length && <div className="err">Faltam permissões: {data.missing_scopes.join(", ")}</div>}
            {data.error && <div className="err">{data.error}</div>}
          </Card>

          <Card title="Trocar token" sub="Área protegida: confirme a senha do app para alterar.">
            {!adminSession ? (
              <form onSubmit={(e) => { e.preventDefault(); unlock(); }}>
                <label htmlFor="pw" style={{ fontSize: 12, color: "var(--forklin-muted)" }}>Senha do app</label>
                <input id="pw" className="field" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
                <div style={{ height: 12 }} />
                <button className="btn" disabled={!pw || busy}>{busy ? "Verificando…" : "Desbloquear"}</button>
              </form>
            ) : (
              <>
                <label htmlFor="tk" style={{ fontSize: 12, color: "var(--forklin-muted)" }}>Novo token de longa duração</label>
                <textarea id="tk" className="field" rows={4} value={token} onChange={(e) => setToken(e.target.value)} placeholder="EAA…" spellCheck={false} />
                <div style={{ height: 12 }} />
                <button className="btn" disabled={token.length < 50 || busy} onClick={saveToken}>{busy ? "Validando com a Meta…" : "Validar e salvar"}</button>
                <div style={{ borderTop: "1px solid var(--forklin-line)", margin: "20px 0 16px" }} />
                <b style={{ fontSize: 13 }}>Trocar senha do app</b>
                <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                  <input className="field" type="password" placeholder="Nova senha (mín. 8 caracteres)" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
                  <input className="field" type="password" placeholder="Repita a nova senha" autoComplete="new-password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} />
                  <button className="btn ghost" disabled={newPw.length < 8 || busy} onClick={savePw}>Alterar senha</button>
                </div>
                <p style={{ fontSize: 12, color: "var(--forklin-muted)" }}>A área fica desbloqueada por 15 minutos.</p>
              </>
            )}
            {msg && <div className={msg.ok ? "ok-msg" : "err"}>{msg.text}</div>}
          </Card>
        </div>
      )}

      {data && (
        <>
          <div className="section-title">Chave do Groq (Curador de posts)</div>
          <div className="card">
            <div className={`status-pill ${data.groq?.configured ? "good" : "warning"}`} role="status">
              {data.groq?.configured ? `✓ Configurada · ${data.groq.masked}` : "! Não configurada"}
            </div>
            <p style={{ fontSize: 13, color: "var(--forklin-muted)", margin: "10px 0 14px" }}>
              Usada pelo Curador para analisar imagens e vídeos e sugerir copies. Modelo de visão atual: <code>{data.groq?.model}</code>.
              A chave fica guardada no banco, nunca aparece inteira de novo e não vai para o navegador.
            </p>
            {!adminSession ? (
              <p style={{ fontSize: 13 }}>Desbloqueie a área protegida acima (senha do app) para cadastrar ou trocar a chave.</p>
            ) : (
              <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
                <label htmlFor="gk" style={{ fontSize: 12, color: "var(--forklin-muted)" }}>Chave da API do Groq (começa com gsk_)</label>
                <input id="gk" className="field" type="password" autoComplete="off" spellCheck={false} placeholder="gsk_…" value={groqKey} onChange={(e) => setGroqKey(e.target.value)} />
                <label htmlFor="gm" style={{ fontSize: 12, color: "var(--forklin-muted)" }}>Modelo de visão (opcional)</label>
                <input id="gm" className="field" placeholder={data.groq?.model} value={groqModel} onChange={(e) => setGroqModel(e.target.value)} />
                <div><button className="btn" disabled={busy || (!groqKey && !groqModel)} onClick={saveGroq}>{busy ? "Validando com o Groq…" : "Validar e salvar"}</button></div>
              </div>
            )}
            {groqMsg && <div className={groqMsg.ok ? "ok-msg" : "err"}>{groqMsg.text}</div>}
          </div>
        </>
      )}

      <div className="section-title">Como gerar um token novo</div>
      <div className="card">
        <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
          <li>Abra o <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer">Explorador da Graph API</a> e selecione o app <b>Analytcs forklin</b>.</li>
          <li>Em Permissões, confirme: <code>instagram_basic</code>, <code>instagram_manage_insights</code>, <code>pages_show_list</code>, <code>pages_read_engagement</code>, <code>business_management</code>.</li>
          <li>Clique em <b>Generate Access Token</b> e autorize a Página <b>Forklin</b> e o <b>@forklinbr</b>.</li>
          <li>Copie o token, abra o <a href="https://developers.facebook.com/tools/debug/accesstoken/" target="_blank" rel="noreferrer">Depurador de Token</a>, cole, clique em <b>Depurar</b> e depois em <b>Estender token de acesso</b>.</li>
          <li>Cole o token estendido aqui em cima e clique em <b>Validar e salvar</b>. O sistema confere as permissões antes de gravar.</li>
        </ol>
      </div>
    </>
  );
}
