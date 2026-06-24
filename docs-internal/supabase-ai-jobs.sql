-- Desktop Codex provider POC.
--
-- Purpose:
-- - Edge Functions create ai_jobs for model tasks that should be handled by a
--   local desktop Codex runner.
-- - The runner polls Supabase, claims one queued job with a lease, calls local
--   Codex, then writes the text result back.
-- - If no runner is online, a job expires, or the runner fails, Edge Functions
--   can fall back to the existing DeepSeek path.
--
-- Run manually in Supabase Dashboard SQL Editor before deploying the
-- desktop_codex provider route.

create table if not exists public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  kind text not null check (
    kind in (
      'coach_chat',
      'weekly_report',
      'memory_update',
      'plan_extract',
      'plan_deviation_rescue',
      'daily_checkin'
    )
  ),

  status text not null default 'queued' check (
    status in (
      'queued',
      'claimed',
      'running',
      'completed',
      'failed',
      'fallback_used',
      'expired'
    )
  ),

  provider_requested text not null default 'desktop_codex',
  provider_actual text,
  fallback_provider text,
  fallback_reason text,

  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error text,

  runner_id text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,

  attempt_count integer not null default 0,
  max_attempts integer not null default 1,

  expires_at timestamptz not null default now() + interval '2 minutes',
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ai_jobs_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint ai_jobs_result_object check (jsonb_typeof(result) = 'object')
);

create index if not exists ai_jobs_user_created_idx
  on public.ai_jobs (user_id, created_at desc);

create index if not exists ai_jobs_queue_idx
  on public.ai_jobs (status, provider_requested, expires_at, created_at);

create index if not exists ai_jobs_runner_lease_idx
  on public.ai_jobs (runner_id, lease_expires_at)
  where status in ('claimed', 'running');

create table if not exists public.ai_runners (
  id text primary key,
  provider text not null default 'desktop_codex',
  status text not null default 'offline' check (status in ('online', 'offline')),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ai_runners_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index if not exists ai_runners_provider_seen_idx
  on public.ai_runners (provider, status, last_seen_at desc);

alter table public.user_settings
  add column if not exists ai_provider_preference text not null default 'auto';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_settings_ai_provider_preference_check'
      and conrelid = 'public.user_settings'::regclass
  ) then
    alter table public.user_settings
      add constraint user_settings_ai_provider_preference_check
      check (ai_provider_preference in ('auto', 'prefer_codex', 'deepseek_only'));
  end if;
end $$;

create or replace function public.set_ai_jobs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ai_jobs_set_updated_at on public.ai_jobs;
create trigger ai_jobs_set_updated_at
before update on public.ai_jobs
for each row
execute function public.set_ai_jobs_updated_at();

create or replace function public.set_ai_runners_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ai_runners_set_updated_at on public.ai_runners;
create trigger ai_runners_set_updated_at
before update on public.ai_runners
for each row
execute function public.set_ai_runners_updated_at();

create or replace function public.claim_ai_job(
  p_runner_id text,
  p_lease_seconds integer default 120
)
returns public.ai_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.ai_jobs;
begin
  update public.ai_runners
  set status = 'online',
      last_seen_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('last_claim_attempt_at', now())
  where id = p_runner_id;

  select *
  into v_job
  from public.ai_jobs
  where status = 'queued'
    and provider_requested = 'desktop_codex'
    and expires_at > now()
  order by created_at asc
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update public.ai_jobs
  set status = 'claimed',
      runner_id = p_runner_id,
      lease_expires_at = now() + make_interval(secs => greatest(30, p_lease_seconds)),
      heartbeat_at = now(),
      attempt_count = attempt_count + 1
  where id = v_job.id
  returning * into v_job;

  return v_job;
end;
$$;

create or replace function public.expire_stale_ai_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.ai_jobs
  set status = 'expired',
      error = coalesce(error, 'expired')
  where status in ('queued', 'claimed', 'running')
    and (
      expires_at <= now()
      or (lease_expires_at is not null and lease_expires_at <= now())
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

alter table public.ai_jobs enable row level security;
alter table public.ai_runners enable row level security;

drop policy if exists "ai_jobs_select_own" on public.ai_jobs;
create policy "ai_jobs_select_own"
on public.ai_jobs
for select
using (auth.uid() = user_id);

-- Inserts/updates/deletes are intentionally left to service-role Edge Functions
-- and the local runner. No anon/client-side write policy is created.
