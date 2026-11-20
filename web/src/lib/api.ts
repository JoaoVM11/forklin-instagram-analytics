// Cliente das Edge Functions do Supabase
const BASE = (import.meta.env.VITE_SUPABASE_FUNCTIONS_URL as string) || "https://goxwnxfgusvxvqyijcyo.supabase.co/functions/v1";
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const KEY = "fia_session";

export function getSession(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const { s, exp } = JSON.parse(raw);
    if (Date.now() > exp) { sessionStorage.removeItem(KEY); return null; }
    return s;
  } catch { return null; }
}
export function setSession(s: string, ttl: number) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ s, exp: Date.now() + ttl * 1000 - 30_000 })); } catch { /* sem storage */ }
}
export function clearSession() { try { sessionStorage.removeItem(KEY); } catch { /* */ } }

async function call<T>(fn: string, opts: { method?: string; body?: unknown; query?: string; session?: string | null } = {}): Promise<T> {
  const res = await fetch(`${BASE}/${fn}${opts.query ? `?${opts.query}` : ""}`, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      ...(ANON ? { apikey: ANON, Authorization: `Bearer ${ANON}` } : {}),
      ...(opts.session !== undefined ? (opts.session ? { "x-session": opts.session } : {}) : (getSession() ? { "x-session": getSession()! } : {})),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && fn !== "fia-auth") {
    clearSession();
    window.dispatchEvent(new Event("fia:logout"));
  }
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data as T;
}

export const api = {
  login: (password: string, scope: "view" | "admin" = "view") =>
    call<{ session: string; expires_in: number }>("fia-auth", { body: { password, scope }, session: null }),
  get: <T>(r: string, params = "") => call<T>("fia-api", { query: `r=${r}${params ? `&${params}` : ""}` }),
  post: <T>(body: unknown) => call<T>("fia-api", { body }),
  sync: (scope = "auto") => call<{ ok: boolean; detail: Record<string, unknown> }>("fia-sync", { body: { scope } }),
  tokenStatus: () => call<TokenStatus>("fia-token"),
  setToken: (adminSession: string, token: string) =>
    call<{ ok: boolean; username: string; expires_at: string }>("fia-token", { body: { action: "set_token", token }, session: adminSession }),
  changePassword: (adminSession: string, new_password: string) =>
    call<{ ok: boolean }>("fia-token", { body: { action: "change_password", new_password }, session: adminSession }),
};

export type TokenStatus = {
  configured: boolean; valid?: boolean; expires_at?: string | null; days_left?: number | null;
  data_access_expires_at?: string | null; scopes?: string[]; missing_scopes?: string[];
  updated_at?: string; masked?: string; error?: string;
};

export type Media = {
  media_id: string; media_type: string; media_product_type: string; caption: string | null; permalink: string;
  thumbnail_url: string | null; media_url: string | null; posted_at: string; like_count: number | null; comments_count: number | null;
  reach: number | null; views: number | null; likes: number | null; comments: number | null; shares: number | null;
  saved: number | null; reposts: number | null; total_interactions: number | null; follows: number | null; profile_visits: number | null;
};
export type Story = {
  story_id: string; media_type: string; permalink: string; media_url: string | null; thumbnail_url: string | null; posted_at: string;
  reach: number | null; views: number | null; replies: number | null; shares: number | null; total_interactions: number | null;
  follows: number | null; profile_visits: number | null; navigation: number | null; taps_forward: number | null;
  taps_back: number | null; swipe_forward: number | null; exits: number | null;
};
export type Daily = {
  day: string; reach: number | null; views: number | null; accounts_engaged: number | null; total_interactions: number | null;
  likes: number | null; comments: number | null; shares: number | null; saves: number | null; replies: number | null;
  reposts: number | null; profile_views: number | null; website_clicks: number | null; profile_links_taps: number | null;
  follows: number | null; unfollows: number | null;
};
export type RefAccount = {
  username: string; label: string | null; active: boolean; name: string | null; biography: string | null;
  profile_picture_url: string | null; followers_count: number | null; media_count: number | null; last_error: string | null; updated_at: string | null;
};
export type RefMedia = {
  media_id: string; username: string; media_type: string; media_product_type: string; caption: string | null;
  permalink: string; posted_at: string; like_count: number | null; comments_count: number | null;
};
