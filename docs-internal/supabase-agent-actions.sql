-- Phase 3: Agent Action Log
-- Run in Supabase Dashboard -> SQL Editor before wiring the app to read/write
-- agent_actions.
--
-- This is intentionally written as a repeatable migration. If an older
-- agent_actions table already exists, it adds the missing columns before
-- creating indexes, constraints, triggers, and RLS policies.

create extension if not exists pgcrypto;

create table if not exists public.agent_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  client_id text,
  type text,
  status text default 'proposed',
  title text,
  reason text,
  risk text default 'low',
  requires_confirmation boolean default true,
  source text default 'ai_coach',
  source_ref_type text,
  source_ref_id text,
  payload jsonb default '{}'::jsonb,
  result jsonb default '{}'::jsonb,
  error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  decided_at timestamptz,
  executed_at timestamptz
);

alter table public.agent_actions
  add column if not exists user_id uuid,
  add column if not exists client_id text,
  add column if not exists type text,
  add column if not exists status text default 'proposed',
  add column if not exists title text,
  add column if not exists reason text,
  add column if not exists risk text default 'low',
  add column if not exists requires_confirmation boolean default true,
  add column if not exists source text default 'ai_coach',
  add column if not exists source_ref_type text,
  add column if not exists source_ref_id text,
  add column if not exists payload jsonb default '{}'::jsonb,
  add column if not exists result jsonb default '{}'::jsonb,
  add column if not exists error text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now(),
  add column if not exists decided_at timestamptz,
  add column if not exists executed_at timestamptz;

alter table public.agent_actions
  alter column id set default gen_random_uuid(),
  alter column status set default 'proposed',
  alter column risk set default 'low',
  alter column requires_confirmation set default true,
  alter column source set default 'ai_coach',
  alter column payload set default '{}'::jsonb,
  alter column result set default '{}'::jsonb,
  alter column created_at set default now(),
  alter column updated_at set default now();

update public.agent_actions
set
  client_id = coalesce(nullif(client_id, ''), id::text),
  type = coalesce(nullif(type, ''), 'unknown'),
  status = coalesce(nullif(status, ''), 'proposed'),
  risk = coalesce(nullif(risk, ''), 'low'),
  requires_confirmation = coalesce(requires_confirmation, true),
  source = coalesce(nullif(source, ''), 'ai_coach'),
  payload = coalesce(payload, '{}'::jsonb),
  result = coalesce(result, '{}'::jsonb),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

alter table public.agent_actions
  alter column client_id set not null,
  alter column type set not null,
  alter column status set not null,
  alter column risk set not null,
  alter column requires_confirmation set not null,
  alter column source set not null,
  alter column payload set not null,
  alter column result set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'agent_actions_user_id_fkey'
      and conrelid = 'public.agent_actions'::regclass
  ) then
    alter table public.agent_actions
      add constraint agent_actions_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'agent_actions_user_client_unique'
      and conrelid = 'public.agent_actions'::regclass
  ) then
    alter table public.agent_actions
      add constraint agent_actions_user_client_unique unique (user_id, client_id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'agent_actions_type_not_blank'
      and conrelid = 'public.agent_actions'::regclass
  ) then
    alter table public.agent_actions
      add constraint agent_actions_type_not_blank check (length(btrim(type)) > 0);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'agent_actions_status_check'
      and conrelid = 'public.agent_actions'::regclass
  ) then
    alter table public.agent_actions
      add constraint agent_actions_status_check check (
        status in ('proposed', 'accepted', 'executing', 'executed', 'rejected', 'failed', 'cancelled')
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'agent_actions_risk_check'
      and conrelid = 'public.agent_actions'::regclass
  ) then
    alter table public.agent_actions
      add constraint agent_actions_risk_check check (
        risk in ('low', 'medium', 'high')
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'agent_actions_payload_object'
      and conrelid = 'public.agent_actions'::regclass
  ) then
    alter table public.agent_actions
      add constraint agent_actions_payload_object check (jsonb_typeof(payload) = 'object');
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'agent_actions_result_object'
      and conrelid = 'public.agent_actions'::regclass
  ) then
    alter table public.agent_actions
      add constraint agent_actions_result_object check (jsonb_typeof(result) = 'object');
  end if;
end;
$$;

create index if not exists agent_actions_user_created_idx
  on public.agent_actions (user_id, created_at desc);

create index if not exists agent_actions_user_status_idx
  on public.agent_actions (user_id, status, created_at desc);

create index if not exists agent_actions_user_type_idx
  on public.agent_actions (user_id, type, created_at desc);

create index if not exists agent_actions_user_source_ref_idx
  on public.agent_actions (user_id, source_ref_type, source_ref_id)
  where source_ref_type is not null and source_ref_id is not null;

create or replace function public.set_agent_actions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists agent_actions_set_updated_at on public.agent_actions;
create trigger agent_actions_set_updated_at
before update on public.agent_actions
for each row
execute function public.set_agent_actions_updated_at();

alter table public.agent_actions enable row level security;

drop policy if exists "agent_actions_select_own" on public.agent_actions;
create policy "agent_actions_select_own"
on public.agent_actions
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "agent_actions_insert_own" on public.agent_actions;
create policy "agent_actions_insert_own"
on public.agent_actions
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "agent_actions_update_own" on public.agent_actions;
create policy "agent_actions_update_own"
on public.agent_actions
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "agent_actions_delete_own" on public.agent_actions;
create policy "agent_actions_delete_own"
on public.agent_actions
for delete
to authenticated
using (auth.uid() = user_id);
