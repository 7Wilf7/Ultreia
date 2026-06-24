-- Server-side AI weekly report scheduler.
--
-- Run this in Supabase Dashboard SQL Editor after deploying
-- supabase/functions/daily-coach-dispatch.
--
-- Replace <CRON_SECRET> with the same value stored in Edge Functions Secrets.
-- The cron polls every 30 minutes. The Edge Function reads each user's saved
-- IANA timezone, weekday, and half-hour slot before generating a report.

select cron.unschedule('ultreia-weekly-report')
where exists (
  select 1
  from cron.job
  where jobname = 'ultreia-weekly-report'
);

select cron.schedule(
  'ultreia-weekly-report',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://ihibmkfgfznqwzavaeiq.functions.supabase.co/daily-coach-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body := jsonb_build_object('mode', 'weekly_recap')
  );
  $$
);
