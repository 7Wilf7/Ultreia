-- Diagnose whether Memory facts were saved to the cloud, and compare them
-- with recent memory_update Action Log records.
--
-- Replace the email if checking another account.

with target_user as (
  select id
  from auth.users
  where email = 'wilf7wufan@gmail.com'
)
select
  'coach_memory_facts' as source,
  count(*) as row_count
from public.coach_memory_facts
where user_id = (select id from target_user)
union all
select
  'agent_actions_memory_update' as source,
  count(*) as row_count
from public.agent_actions
where user_id = (select id from target_user)
  and type = 'memory_update';

select
  client_id,
  category,
  status,
  content_en,
  content_zh,
  source,
  source_summary,
  metadata,
  created_at,
  updated_at
from public.coach_memory_facts
where user_id = (
  select id
  from auth.users
  where email = 'wilf7wufan@gmail.com'
)
order by updated_at desc;

select
  client_id,
  status,
  source,
  payload -> 'memory' as proposed_memory,
  result,
  error,
  created_at,
  updated_at,
  executed_at
from public.agent_actions
where user_id = (
  select id
  from auth.users
  where email = 'wilf7wufan@gmail.com'
)
  and type = 'memory_update'
order by updated_at desc
limit 10;
