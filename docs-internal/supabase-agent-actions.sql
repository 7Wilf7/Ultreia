-- Phase 3: Agent Action Log
-- Run this once in Supabase Dashboard -> SQL Editor before wiring the app to
-- read/write agent_actions.

create extension if not exists pgcrypto;

create table if not exists public.agent_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- Stable app-side action id, e.g. create-plans-<coach_message_id>.
  -- Keeps existing local Action Card ids usable while the table keeps a UUID PK.
  client_id text not null,

  type text not null,
  status text not null default 'proposed',
  title text,
  reason text,
  risk text not null default 'low',
  requires_confirmation boolean not null default true,

  -- Where the action came from. Examples:
  -- source = ai_coach_reply / ai_coach_memory / weekly_report
  -- source_ref_type = coach_message / coach_report / local
  -- source_ref_id = source row id as text
  source text not null default 'ai_coach',
  source_ref_type text,
  source_ref_id text,

  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  executed_at timestamptz,

  constraint agent_actions_user_client_unique unique (user_id, client_id),
  constraint agent_actions_type_not_blank check (length(btrim(type)) > 0),
  constraint agent_actions_status_check check (
    status in ('proposed', 'accepted', 'executing', 'executed', 'rejected', 'failed', 'cancelled')
  ),
  constraint agent_actions_risk_check check (
    risk in ('low', 'medium', 'high')
  ),
  constraint agent_actions_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint agent_actions_result_object check (jsonb_typeof(result) = 'object')
);

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
