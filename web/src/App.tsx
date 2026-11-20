import { useEffect, useState } from "react";
import { HashRouter, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { api, clearSession, getSession, setSession } from "./lib/api";
import { dateTimeBR } from "./lib/format";
import nameWhite from "./assets/forklin-nome-branco.png";
import symbol from "./assets/forklin-simbolo.png";
import OverviewPage from "./pages/Overview";
import PostsPage from "./pages/Posts";
import StoriesPage from "./pages/Stories";
import RefsPage from "./pages/Refs";
import TokenPage from "./pages/Token";

function Login({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const r = await api.login(pw); setSession(r.session, r.expires_in); onDone(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="login">
      <form className="box" onSubmit={submit}>
        <img src={symbol} width={44} height={44} alt="Forklin" />
        <h1>Instagram Analytics</h1>
        <p>Painel de métricas do @forklinbr</p>
        <label htmlFor="pw" style={{ fontSize: 12, color: "var(--forklin-muted)" }}>Senha</label>
        <input id="pw" className="field" type="password" autoFocus autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <div style={{ height: 14 }} />
        <button className="btn" style={{ width: "100%" }} disabled={!pw || busy}>{busy ? "Entrando…" : "Entrar"}</button>
        {err && <div className="err">{err}</div>}
      </form>
    </div>
  );
}

function SyncButton() {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  useEffect(() => {
    api.get<{ runs: { finished_at: string | null; ok: boolean }[] }>("status")
      .then((r) => setLast(r.runs.find((x) => x.finished_at)?.finished_at ?? null)).catch(() => {});
  }, [busy]);
  return (
    <div style={{ marginBottom: 12 }}>
      <button className="sync" disabled={busy}
        onClick={async () => { setBusy(true); try { await api.sync("auto"); window.dispatchEvent(new Event("fia:refresh")); } finally { setBusy(false); } }}>
        {busy ? "Atualizando…" : "Atualizar agora"}
      </button>
      {last && <div style={{ marginTop: 6 }}>Última coleta: {dateTimeBR(last)}</div>}
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(!!getSession());
  useEffect(() => {
    const out = () => { clearSession(); setAuthed(false); };
    window.addEventListener("fia:logout", out);
    return () => window.removeEventListener("fia:logout", out);
  }, []);
  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  const links = [
    ["/", "Visão geral"], ["/posts", "Posts"], ["/stories", "Stories"], ["/referencias", "Referências"], ["/token", "Token de acesso"],
  ];
  return (
    <HashRouter>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <img className="sym" src={symbol} alt="" />
            <div><img className="name" src={nameWhite} alt="Forklin" /><small>Instagram Analytics</small></div>
          </div>
          <nav className="nav">
            {links.map(([to, label]) => <NavLink key={to} to={to} end={to === "/"}>{label}</NavLink>)}
          </nav>
          <div className="foot">
            <SyncButton />
            <button className="link" onClick={() => window.dispatchEvent(new Event("fia:logout"))}>Sair</button>
          </div>
        </aside>
        <main className="main">
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/posts" element={<PostsPage />} />
            <Route path="/stories" element={<StoriesPage />} />
            <Route path="/referencias" element={<RefsPage />} />
            <Route path="/token" element={<TokenPage />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
