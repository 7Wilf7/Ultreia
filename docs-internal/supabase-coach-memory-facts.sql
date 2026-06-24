-- Phase 4.1: Coach Memory Facts
-- Run in Supabase Dashboard -> SQL Editor before wiring the app to read/write
-- coach_memory_facts.
--
-- This is intentionally written as a repeatable migration. Phase 4.1 keeps the
-- existing coach_memory / coach_memory_zh text memory as the primary fallback;
-- this table is a sidecar fact layer for reviewed, source-traceable facts.

create extension if not exists pgcrypto;

create table if not exists public.coach_memory_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  client_id text,
  category text default 'other',
  content_en text,
  content_zh text,
  source text default 'ai_coach',
  source_ref_type text,
  source_ref_id text,
  source_summary text,
  confidence text default 'user_confirmed',
  status text default 'proposed',
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  proposed_at timestamptz default now(),
  accepted_at timestamptz,
  rejected_at timestamptz,
  archived_at timestamptz,
  last_used_at timestamptz
);

alter table public.coach_memory_facts
  add column if not exists user_id uuid,
  add column if not exists client_id text,
  add column if not exists category text default 'other',
  add column if not exists content_en text,
  add column if not exists content_zh text,
  add column if not exists source text default 'ai_coach',
  add column if not exists source_ref_type text,
  add column if not exists source_ref_id text,
  add column if not exists source_summary text,
  add column if not exists confidence text default 'user_confirmed',
  add column if not exists status text default 'proposed',
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now(),
  add column if not exists proposed_at timestamptz default now(),
  add column if not exists accepted_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists last_used_at timestamptz;

alter table public.coach_memory_facts
  alter column id set default gen_random_uuid(),
  alter column category set default 'other',
  alter column source set default 'ai_coach',
  alter column confidence set default 'user_confirmed',
  alter column status set default 'proposed',
  alter column metadata set default '{}'::jsonb,
  alter column created_at set default now(),
  alter column updated_at set default now(),
  alter column proposed_at set default now();

update public.coach_memory_facts
set
  client_id = coalesce(nullif(client_id, ''), id::text),
  category = coalesce(nullif(category, ''), 'other'),
  source = coalesce(nullif(source, ''), 'ai_coach'),
  confidence = coalesce(nullif(confidence, ''), 'user_confirmed'),
  status = coalesce(nullif(status, ''), 'proposed'),
  metadata = coalesce(metadata, '{}'::jsonb),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now()),
  proposed_at = coalesce(proposed_at, created_at, now());

alter table public.coach_memory_facts
  alter column client_id set not null,
  alter column category set not null,
  alter column source set not null,
  alter column confidence set not null,
  alter column status set not null,
  alter column metadata set not null,
  alter column created_at set not null,
  alter column updated_at set not null,
  alter column proposed_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'coach_memory_facts_user_id_fkey'
      and conrelid = 'public.coach_memory_facts'::regclass
  ) then
    alter table public.coach_memory_facts
      add constraint coach_memory_facts_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'coach_memory_facts_user_client_unique'
      and conrelid = 'public.coach_memory_facts'::regclass
  ) then
    alter table public.coach_memory_facts
      add constraint coach_memory_facts_user_client_unique unique (user_id, client_id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'coach_memory_facts_category_check'
      and conrelid = 'public.coach_memory_facts'::regclass
  ) then
    alter table public.coach_memory_facts
      add constraint coach_memory_facts_category_check check (
        category in ('injury_health', 'goals_races', 'training_preferences', 'coaching_style', 'recurring_patterns', 'other')
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'coach_memory_facts_status_check'
      and conrelid = 'public.coach_memory_facts'::regclass
  ) then
    alter table public.coach_memory_facts
      add constraint coach_memory_facts_status_check check (
        status in ('proposed', 'active', 'rejected', 'archived')
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'coach_memory_facts_confidence_check'
      and conrelid = 'public.coach_memory_facts'::regclass
  ) then
    alter table public.coach_memory_facts
      add constraint coach_memory_facts_confidence_check check (
        confidence in ('user_confirmed', 'ai_suggested', 'inferred')
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'coach_memory_facts_has_content'
      and conrelid = 'public.coach_memory_facts'::regclass
  ) then
    alter table public.coach_memory_facts
      add constraint coach_memory_facts_has_content check (
        length(btrim(coalesce(content_en, ''))) > 0
        or length(btrim(coalesce(content_zh, ''))) > 0
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'coach_memory_facts_metadata_object'
      and conrelid = 'public.coach_memory_facts'::regclass
  ) then
    alter table public.coach_memory_facts
      add constraint coach_memory_facts_metadata_object check (jsonb_typeof(metadata) = 'object');
  end if;
end;
$$;

create index if not exists coach_memory_facts_user_status_idx
  on public.coach_memory_facts (user_id, status, updated_at desc);

create index if not exists coach_memory_facts_user_category_idx
  on public.coach_memory_facts (user_id, category, status, updated_at desc);

create index if not exists coach_memory_facts_user_source_ref_idx
  on public.coach_memory_facts (user_id, source_ref_type, source_ref_id)
  where source_ref_type is not null and source_ref_id is not null;

create or replace function public.set_coach_memory_facts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists coach_memory_facts_set_updated_at on public.coach_memory_facts;
create trigger coach_memory_facts_set_updated_at
before update on public.coach_memory_facts
for each row
execute function public.set_coach_memory_facts_updated_at();

alter table public.coach_memory_facts enable row level security;

drop policy if exists "coach_memory_facts_select_own" on public.coach_memory_facts;
create policy "coach_memory_facts_select_own"
on public.coach_memory_facts
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "coach_memory_facts_insert_own" on public.coach_memory_facts;
create policy "coach_memory_facts_insert_own"
on public.coach_memory_facts
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "coach_memory_facts_update_own" on public.coach_memory_facts;
create policy "coach_memory_facts_update_own"
on public.coach_memory_facts
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "coach_memory_facts_delete_own" on public.coach_memory_facts;
create policy "coach_memory_facts_delete_own"
on public.coach_memory_facts
for delete
to authenticated
using (auth.uid() = user_id);
