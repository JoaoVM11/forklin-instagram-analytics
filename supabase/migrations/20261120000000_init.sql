-- Forklin Instagram Analytics — schema inicial
-- Tabelas com prefixo fia_ (Forklin Instagram Analytics) para conviver com outras tabelas no mesmo projeto.
-- Todas as tabelas ficam com RLS ligado e SEM políticas para anon/authenticated:
-- o acesso acontece apenas pelas Edge Functions (service role), que exigem sessão.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Configuração privada (token da Meta, hash da senha, segredos de sessão)
create table if not exists fia_app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- Contas do Instagram monitoradas (a própria Forklin)
create table if not exists fia_account (
  ig_user_id text primary key,
  page_id text,
  username text not null,
  name text,
  biography text,
  website text,
  profile_picture_url text,
  followers_count int,
  follows_count int,
  media_count int,
  updated_at timestamptz not null default now()
);

-- Snapshot diário do perfil (seguidores, posts) — base da curva de crescimento
create table if not exists fia_profile_daily (
  ig_user_id text not null references fia_account(ig_user_id) on delete cascade,
  day date not null,
  followers_count int,
  follows_count int,
  media_count int,
  primary key (ig_user_id, day)
);

-- Insights diários da conta (awareness): alcance, views, visitas ao perfil, cliques...
create table if not exists fia_account_insights_daily (
  ig_user_id text not null references fia_account(ig_user_id) on delete cascade,
  day date not null,
  reach int,
  views int,
  accounts_engaged int,
  total_interactions int,
  likes int,
  comments int,
  shares int,
  saves int,
  replies int,
  reposts int,
  profile_views int,
  website_clicks int,
  profile_links_taps int,
  follows int,
  unfollows int,
  fetched_at timestamptz not null default now(),
  primary key (ig_user_id, day)
);

-- Demografia de seguidores (cidade, idade, gênero, país) — snapshot mais recente
create table if not exists fia_demographics (
  ig_user_id text not null references fia_account(ig_user_id) on delete cascade,
  breakdown text not null,       -- city | country | age | gender
  dimension text not null,
  value int not null,
  fetched_at timestamptz not null default now(),
  primary key (ig_user_id, breakdown, dimension)
);

-- Posts / reels / carrosséis
create table if not exists fia_media (
  media_id text primary key,
  ig_user_id text not null references fia_account(ig_user_id) on delete cascade,
  media_type text,
  media_product_type text,
  caption text,
  permalink text,
  thumbnail_url text,
  media_url text,
  posted_at timestamptz,
  like_count int,
  comments_count int,
  reach int,
  views int,
  likes int,
  comments int,
  shares int,
  saved int,
  reposts int,
  total_interactions int,
  follows int,
  profile_visits int,
  updated_at timestamptz not null default now()
);
create index if not exists fia_media_posted_idx on fia_media (ig_user_id, posted_at desc);

-- Histórico de métricas por post (curva de desempenho ao longo do tempo)
create table if not exists fia_media_snapshots (
  media_id text not null references fia_media(media_id) on delete cascade,
  taken_at timestamptz not null default now(),
  reach int, views int, likes int, comments int, shares int, saved int, reposts int, total_interactions int,
  primary key (media_id, taken_at)
);

-- Stories (a API só devolve stories das últimas 24h: coletamos de hora em hora)
create table if not exists fia_stories (
  story_id text primary key,
  ig_user_id text not null references fia_account(ig_user_id) on delete cascade,
  media_type text,
  permalink text,
  media_url text,
  thumbnail_url text,
  posted_at timestamptz,
  reach int,
  views int,
  replies int,
  shares int,
  total_interactions int,
  follows int,
  profile_visits int,
  navigation int,
  taps_forward int,
  taps_back int,
  swipe_forward int,
  exits int,
  updated_at timestamptz not null default now()
);
create index if not exists fia_stories_posted_idx on fia_stories (ig_user_id, posted_at desc);

-- Perfis de referência (benchmark via Business Discovery)
create table if not exists fia_ref_accounts (
  username text primary key,
  label text,
  active boolean not null default true,
  ig_user_id text,
  name text,
  biography text,
  website text,
  profile_picture_url text,
  followers_count int,
  follows_count int,
  media_count int,
  last_error text,
  updated_at timestamptz
);

create table if not exists fia_ref_profile_daily (
  username text not null references fia_ref_accounts(username) on delete cascade,
  day date not null,
  followers_count int,
  media_count int,
  primary key (username, day)
);

create table if not exists fia_ref_media (
  media_id text primary key,
  username text not null references fia_ref_accounts(username) on delete cascade,
  media_type text,
  media_product_type text,
  caption text,
  permalink text,
  posted_at timestamptz,
  like_count int,
  comments_count int,
  updated_at timestamptz not null default now()
);
create index if not exists fia_ref_media_user_idx on fia_ref_media (username, posted_at desc);

-- Log das sincronizações
create table if not exists fia_sync_runs (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  scope text,
  ok boolean,
  detail jsonb
);

alter table fia_app_config enable row level security;
alter table fia_account enable row level security;
alter table fia_profile_daily enable row level security;
alter table fia_account_insights_daily enable row level security;
alter table fia_demographics enable row level security;
alter table fia_media enable row level security;
alter table fia_media_snapshots enable row level security;
alter table fia_stories enable row level security;
alter table fia_ref_accounts enable row level security;
alter table fia_ref_profile_daily enable row level security;
alter table fia_ref_media enable row level security;
alter table fia_sync_runs enable row level security;

-- Defesa extra: nenhuma permissão direta para os papéis públicos da API
revoke all on fia_app_config, fia_account, fia_profile_daily, fia_account_insights_daily, fia_demographics,
  fia_media, fia_media_snapshots, fia_stories, fia_ref_accounts, fia_ref_profile_daily, fia_ref_media, fia_sync_runs
  from anon, authenticated;
revoke all on sequence fia_sync_runs_id_seq from anon, authenticated;
