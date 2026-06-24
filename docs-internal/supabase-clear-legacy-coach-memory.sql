-- One-off cleanup for Wilf after migrating legacy text Memory into reviewed
-- coach_memory_facts cards.
--
-- Run in Supabase Dashboard SQL Editor after replacing the email if needed.
-- This clears only the legacy free-text fields. It does NOT touch
-- coach_memory_facts, coach_messages, agent_actions, or any training data.

update public.user_settings
set
  coach_memory = null,
  coach_memory_zh = null,
  updated_at = now()
where user_id = (
  select id
  from auth.users
  where email = 'wilf7wufan@gmail.com'
);

select
  user_id,
  coach_memory,
  coach_memory_zh,
  updated_at
from public.user_settings
where user_id = (
  select id
  from auth.users
  where email = 'wilf7wufan@gmail.com'
);
