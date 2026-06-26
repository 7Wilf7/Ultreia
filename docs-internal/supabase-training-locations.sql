-- Training locations / weather places
-- Run in Supabase Dashboard -> SQL Editor before wiring the app to read/write
-- multiple saved training locations.
--
-- This keeps the existing user_settings.default_* columns for backward
-- compatibility, and copies the current default location into the new table
-- as an initial default weather place when coordinates exist.

create extension if not exists pgcrypto;

create table if not exists public.training_locations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  client_id text,
  name text,
  city_name text,
  address text,
  lat double precision,
  lng double precision,
  source text default 'manual',
  is_default_weather boolean default false,
  is_archived boolean default false,
  sort_order integer default 0,
  notes text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.training_locations
  add column if not exists user_id uuid,
  add column if not exists client_id text,
  add column if not exists name text,
  add column if not exists city_name text,
  add column if not exists address text,
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists source text default 'manual',
  add column if not exists is_default_weather boolean default false,
  add column if not exists is_archived boolean default false,
  add column if not exists sort_order integer default 0,
  add column if not exists notes text,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table public.training_locations
  alter column id set default gen_random_uuid(),
  alter column source set default 'manual',
  alter column is_default_weather set default false,
  alter column is_archived set default false,
  alter column sort_order set default 0,
  alter column metadata set default '{}'::jsonb,
  alter column created_at set default now(),
  alter column updated_at set default now();

update public.training_locations
set
  client_id = coalesce(nullif(client_id, ''), id::text),
  name = coalesce(nullif(name, ''), 'Training place'),
  source = coalesce(nullif(source, ''), 'manual'),
  is_default_weather = coalesce(is_default_weather, false),
  is_archived = coalesce(is_archived, false),
  sort_order = coalesce(sort_order, 0),
  metadata = coalesce(metadata, '{}'::jsonb),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, now());

alter table public.training_locations
  alter column client_id set not null,
  alter column name set not null,
  alter column source set not null,
  alter column is_default_weather set not null,
  alter column is_archived set not null,
  alter column sort_order set not null,
  alter column metadata set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'training_locations_user_id_fkey'
      and conrelid = 'public.training_locations'::regclass
  ) then
    alter table public.training_locations
      add constraint training_locations_user_id_fkey
      foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'training_locations_user_client_unique'
      and conrelid = 'public.training_locations'::regclass
  ) then
    alter table public.training_locations
      add constraint training_locations_user_client_unique unique (user_id, client_id);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'training_locations_name_not_blank'
      and conrelid = 'public.training_locations'::regclass
  ) then
    alter table public.training_locations
      add constraint training_locations_name_not_blank check (length(btrim(name)) > 0);
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'training_locations_coords_valid'
      and conrelid = 'public.training_locations'::regclass
  ) then
    alter table public.training_locations
      add constraint training_locations_coords_valid check (
        lat is not null and lng is not null
        and lat between -90 and 90
        and lng between -180 and 180
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'training_locations_source_check'
      and conrelid = 'public.training_locations'::regclass
  ) then
    alter table public.training_locations
      add constraint training_locations_source_check check (
        source in ('manual', 'map_pick', 'search', 'current_location', 'legacy_default')
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'training_locations_metadata_object'
      and conrelid = 'public.training_locations'::regclass
  ) then
    alter table public.training_locations
      add constraint training_locations_metadata_object check (jsonb_typeof(metadata) = 'object');
  end if;
end;
$$;

create index if not exists training_locations_user_sort_idx
  on public.training_locations (user_id, is_archived, sort_order, created_at desc);

create index if not exists training_locations_user_default_idx
  on public.training_locations (user_id, is_default_weather)
  where is_default_weather = true and is_archived = false;

create unique index if not exists training_locations_one_default_weather_idx
  on public.training_locations (user_id)
  where is_default_weather = true and is_archived = false;

create or replace function public.set_training_locations_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists training_locations_set_updated_at on public.training_locations;
create trigger training_locations_set_updated_at
before update on public.training_locations
for each row
execute function public.set_training_locations_updated_at();

alter table public.training_locations enable row level security;

drop policy if exists "training_locations_select_own" on public.training_locations;
create policy "training_locations_select_own"
on public.training_locations
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "training_locations_insert_own" on public.training_locations;
create policy "training_locations_insert_own"
on public.training_locations
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "training_locations_update_own" on public.training_locations;
create policy "training_locations_update_own"
on public.training_locations
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "training_locations_delete_own" on public.training_locations;
create policy "training_locations_delete_own"
on public.training_locations
for delete
to authenticated
using (auth.uid() = user_id);

insert into public.training_locations (
  user_id,
  client_id,
  name,
  lat,
  lng,
  source,
  is_default_weather,
  sort_order,
  metadata
)
select
  user_id,
  'legacy-default-location',
  coalesce(nullif(default_location_name, ''), '默认训练地点'),
  default_lat,
  default_lng,
  'legacy_default',
  true,
  0,
  jsonb_build_object('from', 'user_settings.default_location')
from public.user_settings
where default_lat is not null
  and default_lng is not null
  and default_lat between -90 and 90
  and default_lng between -180 and 180
  and not exists (
    select 1
    from public.training_locations tl
    where tl.user_id = public.user_settings.user_id
      and tl.client_id = 'legacy-default-location'
  );
