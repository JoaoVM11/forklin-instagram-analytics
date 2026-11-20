-- Coleta automática de hora em hora (minuto 7). O segredo é lido de fia_app_config,
-- então nada sensível fica neste arquivo. Troque <PROJECT_REF> pelo ref do projeto.
select cron.schedule('fia-sync-hourly', '7 * * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/fia-sync',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.fia_app_config where key='cron_secret')),
    body := '{"scope":"auto"}'::jsonb,
    timeout_milliseconds := 150000
  );
$$);
