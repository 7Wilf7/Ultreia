-- Run this whole file once in the shared Supabase project's SQL Editor.
-- It reuses the CRON_SECRET already embedded in an existing Ultreia cron job,
-- so the secret is not copied into this repository or query history.

do $setup$
declare
  v_secret text;
begin
  select (regexp_match(command, '''x-cron-secret'',\s*''([^'']+)'''))[1]
    into v_secret
  from cron.job
  where command like '%x-cron-secret%'
  order by jobid
  limit 1;

  if v_secret is null or length(v_secret) < 16 then
    raise exception 'No existing CRON_SECRET-bearing job found; aborting safely';
  end if;

  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'ultreia-agent-report-dispatch';

  perform cron.schedule(
    'ultreia-agent-report-dispatch',
    '*/30 * * * *',
    format($command$
      select net.http_post(
        url := 'https://ihibmkfgfznqwzavaeiq.functions.supabase.co/agent-report-dispatch',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', %L
        ),
        body := '{"force":false}'::jsonb
      );
    $command$, v_secret)
  );
end
$setup$;

select jobid, jobname, schedule, active,
       command like '%agent-report-dispatch%' as target_ok,
       command like '%x-cron-secret%' as secret_header_ok
from cron.job
where jobname = 'ultreia-agent-report-dispatch';
