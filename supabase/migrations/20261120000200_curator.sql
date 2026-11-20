-- Curador de posts: histórico das análises
create table if not exists fia_curator_runs (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  kind text not null,          -- image | carousel | video
  draft text,                  -- rascunho/ideia enviada
  context text,                -- linha de produto / contexto
  goal text,                   -- objetivo do post
  transcript text,             -- fala do vídeo (Whisper)
  thumb text,                  -- miniatura (data URL ~320px) para o histórico
  model text,
  result jsonb,
  error text
);
create index if not exists fia_curator_runs_created_idx on fia_curator_runs (created_at desc);
alter table fia_curator_runs enable row level security;
revoke all on fia_curator_runs from anon, authenticated;
revoke all on sequence fia_curator_runs_id_seq from anon, authenticated;
