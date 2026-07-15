-- Nightly autonomous Memory maintenance scheduler.
--
-- Run this in Supabase Dashboard SQL Editor after deploying
-- supabase/functions/daily-coach-dispatch.
--
-- Replace <CRON_SECRET> with the same value stored in Edge Functions Secrets.
-- Schedule is UTC. 16:05 UTC = 00:05 Asia/Shanghai.

select cron.unschedule('ultreia-nightly-memory-review')
where exists (
  select 1
  from cron.job
  where jobname = 'ultreia-nightly-memory-review'
);

select cron.schedule(
  'ultreia-nightly-memory-review',
  '5 16 * * *',
  $$
  select net.http_post(
    url := 'https://ihibmkfgfznqwzavaeiq.functions.supabase.co/daily-coach-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body := jsonb_build_object('mode', 'memory_update')
  );
  $$
);
