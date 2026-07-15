-- Ultreia producer-side B2 outbox constraint migration.
--
-- Review and run this whole file once in the shared Supabase project's SQL Editor.
-- Do not run it through automation. It does not seed outbox rows, dispatch a Report,
-- or update/delete any existing row. Any error rolls back the whole transaction.
-- For a no-commit rehearsal, replace the final COMMIT with ROLLBACK.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- Block concurrent outbox writes while constraints and the preservation snapshot
-- are checked. This lock does not affect reads.
lock table public.agent_report_outbox in share row exclusive mode;

do $preflight$
declare
  v_definition text;
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.agent_report_outbox'::regclass
      and not convalidated
  ) then
    raise exception 'agent_report_outbox has an existing unvalidated constraint; aborting';
  end if;

  if (
    select count(*)
    from pg_constraint
    where conrelid = 'public.agent_report_outbox'::regclass
      and contype = 'c'
      and convalidated
      and conname = any (array[
        'agent_report_outbox_report_type',
        'agent_report_outbox_signal_kind',
        'agent_report_outbox_pending_bundle',
        'agent_report_outbox_lease_pair'
      ])
  ) <> 4 then
    raise exception 'expected four validated B1 constraints are not present; aborting';
  end if;

  select pg_get_constraintdef(oid, true)
    into v_definition
  from pg_constraint
  where conrelid = 'public.agent_report_outbox'::regclass
    and conname = 'agent_report_outbox_report_type';
  if v_definition <> 'CHECK (report_type = ''training_state_change''::text)' then
    raise exception 'report_type constraint drifted: %', v_definition;
  end if;

  select pg_get_constraintdef(oid, true)
    into v_definition
  from pg_constraint
  where conrelid = 'public.agent_report_outbox'::regclass
    and conname = 'agent_report_outbox_signal_kind';
  if v_definition <> 'CHECK (signal_kind = ''repeated_plan_deviation''::text)' then
    raise exception 'signal_kind constraint drifted: %', v_definition;
  end if;

  select pg_get_constraintdef(oid, true)
    into v_definition
  from pg_constraint
  where conrelid = 'public.agent_report_outbox'::regclass
    and conname = 'agent_report_outbox_pending_bundle';
  if position('training_state_change.v1' in coalesce(v_definition, '')) = 0
     or position('pending_report_id' in coalesce(v_definition, '')) = 0
     or position('pending_content_hash' in coalesce(v_definition, '')) = 0
     or position('contract_version' in coalesce(v_definition, '')) = 0
     or position('source_product' in coalesce(v_definition, '')) = 0 then
    raise exception 'pending_bundle constraint is not the reviewed B1 shape: %', v_definition;
  end if;

  select pg_get_constraintdef(oid, true)
    into v_definition
  from pg_constraint
  where conrelid = 'public.agent_report_outbox'::regclass
    and conname = 'agent_report_outbox_lease_pair';
  if position('pending' in coalesce(v_definition, '')) = 0
     or position('retry_wait' in coalesce(v_definition, '')) = 0
     or position('lease_token' in coalesce(v_definition, '')) = 0
     or position('lease_expires_at' in coalesce(v_definition, '')) = 0 then
    raise exception 'lease_pair constraint is not the reviewed B1 shape: %', v_definition;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.agent_report_outbox'::regclass
      and conname = 'agent_report_outbox_scope_unique'
      and contype = 'u'
      and convalidated
      and pg_get_constraintdef(oid, true) = 'UNIQUE (user_id, report_type, signal_kind)'
  ) then
    raise exception 'outbox scope unique key is missing or drifted; aborting';
  end if;
end
$preflight$;

-- Verify the reviewed paused B1 envelope without placing its raw identifiers or
-- payload in this public repository. The same opaque digests are checked again
-- before commit. The table lock prevents a concurrent outbox write in between.
do $paused_b1_preflight$
begin
  if not exists (
    select 1
    from public.agent_report_outbox as o
    where report_type = 'training_state_change'
      and signal_kind = 'repeated_plan_deviation'
      and status = 'paused'
      and paused_until = '2026-07-15 19:30:00.386+00'::timestamptz
      and md5(pending_report_id) = '29bcfa75cf614bbaff56eeb75b0aba86'
      and md5(pending_content_hash) = '45d2bda41e80f06da0b4d62f976e7e33'
      and md5((pending_envelope -> 'typed_payload')::text) = 'f0f1b531eae8fa89a1814daf034676c1'
      and md5(pending_envelope::text) = '9cbbda3a1341529ac9547d853bcc1ef7'
      and md5(to_jsonb(o)::text) = 'c8210da65d3ec3dfbf7bb159fb0c85b0'
  ) or (
    select count(*)
    from public.agent_report_outbox
    where report_type = 'training_state_change'
      and signal_kind = 'repeated_plan_deviation'
  ) <> 1 then
    raise exception 'reviewed paused B1 envelope baseline does not match; aborting';
  end if;
end
$paused_b1_preflight$;

alter table public.agent_report_outbox
  add constraint agent_report_outbox_catalog_pair_b2
  check (
    (report_type = 'training_state_change' and signal_kind = 'repeated_plan_deviation')
    or (report_type = 'training_load_change' and signal_kind = 'rapid_training_load_change')
    or (report_type = 'recovery_state_change' and signal_kind = 'recovery_risk_trend')
    or (report_type = 'goal_context_change' and signal_kind = 'target_race_context_change')
    or (report_type = 'training_preference_change' and signal_kind = 'preference_context_invalidated')
    or (report_type = 'training_progress_change' and signal_kind = 'notable_progress_or_milestone')
    or (report_type = 'health_risk_change' and signal_kind = 'recurring_injury_or_health_risk_pattern')
  ) not valid;

alter table public.agent_report_outbox
  add constraint agent_report_outbox_pending_bundle_b2
  check (
    (
      status in ('pending', 'retry_wait', 'paused', 'blocked')
      and jsonb_typeof(pending_envelope) = 'object'
      and pending_report_id is not null
      and pending_content_hash is not null
      and pending_created_at is not null
      and (pending_envelope ->> 'id') is not distinct from pending_report_id
      and (pending_envelope ->> 'content_hash') is not distinct from pending_content_hash
      and (pending_envelope ->> 'contract_version') is not distinct from 'agent_report.v1'
      and (pending_envelope ->> 'source_product') is not distinct from 'ultreia'
      and (pending_envelope #>> '{typed_payload,type}') is not distinct from report_type
      and (pending_envelope #>> '{typed_payload,signal_kind}') is not distinct from signal_kind
      and (
        (
          report_type = 'training_state_change'
          and signal_kind = 'repeated_plan_deviation'
          and (pending_envelope #>> '{typed_payload,schema_version}') is not distinct from 'training_state_change.v1'
        )
        or (
          report_type = 'training_load_change'
          and signal_kind = 'rapid_training_load_change'
          and (pending_envelope #>> '{typed_payload,schema_version}') is not distinct from 'training_load_change.v1'
        )
        or (
          report_type = 'recovery_state_change'
          and signal_kind = 'recovery_risk_trend'
          and (pending_envelope #>> '{typed_payload,schema_version}') is not distinct from 'recovery_state_change.v1'
        )
        or (
          report_type = 'goal_context_change'
          and signal_kind = 'target_race_context_change'
          and (pending_envelope #>> '{typed_payload,schema_version}') is not distinct from 'goal_context_change.v1'
        )
        or (
          report_type = 'training_preference_change'
          and signal_kind = 'preference_context_invalidated'
          and (pending_envelope #>> '{typed_payload,schema_version}') is not distinct from 'training_preference_invalidation.v1'
        )
        or (
          report_type = 'training_progress_change'
          and signal_kind = 'notable_progress_or_milestone'
          and (pending_envelope #>> '{typed_payload,schema_version}') is not distinct from 'training_progress_change.v1'
        )
        or (
          report_type = 'health_risk_change'
          and signal_kind = 'recurring_injury_or_health_risk_pattern'
          and (pending_envelope #>> '{typed_payload,schema_version}') is not distinct from 'health_risk_change.v1'
        )
      )
    )
    or (
      status in ('idle', 'delivered')
      and pending_envelope is null
      and pending_report_id is null
      and pending_content_hash is null
      and pending_created_at is null
    )
  ) not valid;

alter table public.agent_report_outbox
  add constraint agent_report_outbox_lease_pair_b2
  check (
    (lease_token is null and lease_expires_at is null)
    or (lease_token is not null and lease_expires_at is not null)
  ) not valid;

-- Validation scans all existing rows. Any incompatible row aborts the transaction
-- before an old constraint is removed.
alter table public.agent_report_outbox
  validate constraint agent_report_outbox_catalog_pair_b2;
alter table public.agent_report_outbox
  validate constraint agent_report_outbox_pending_bundle_b2;
alter table public.agent_report_outbox
  validate constraint agent_report_outbox_lease_pair_b2;

alter table public.agent_report_outbox
  drop constraint agent_report_outbox_report_type,
  drop constraint agent_report_outbox_signal_kind,
  drop constraint agent_report_outbox_pending_bundle,
  drop constraint agent_report_outbox_lease_pair;

alter table public.agent_report_outbox
  rename constraint agent_report_outbox_catalog_pair_b2 to agent_report_outbox_catalog_pair;
alter table public.agent_report_outbox
  rename constraint agent_report_outbox_pending_bundle_b2 to agent_report_outbox_pending_bundle;
alter table public.agent_report_outbox
  rename constraint agent_report_outbox_lease_pair_b2 to agent_report_outbox_lease_pair;

do $postflight$
begin
  if (
    select count(*)
    from pg_constraint
    where conrelid = 'public.agent_report_outbox'::regclass
      and contype = 'c'
      and convalidated
      and conname = any (array[
        'agent_report_outbox_catalog_pair',
        'agent_report_outbox_pending_bundle',
        'agent_report_outbox_lease_pair'
      ])
  ) <> 3 then
    raise exception 'B2 constraints were not installed and validated as one set';
  end if;

  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.agent_report_outbox'::regclass
      and conname = any (array[
        'agent_report_outbox_report_type',
        'agent_report_outbox_signal_kind'
      ])
  ) then
    raise exception 'B1-only report_type/signal_kind constraints still exist';
  end if;

  if not exists (
    select 1
    from public.agent_report_outbox as o
    where report_type = 'training_state_change'
      and signal_kind = 'repeated_plan_deviation'
      and status = 'paused'
      and paused_until = '2026-07-15 19:30:00.386+00'::timestamptz
      and md5(pending_report_id) = '29bcfa75cf614bbaff56eeb75b0aba86'
      and md5(pending_content_hash) = '45d2bda41e80f06da0b4d62f976e7e33'
      and md5((pending_envelope -> 'typed_payload')::text) = 'f0f1b531eae8fa89a1814daf034676c1'
      and md5(pending_envelope::text) = '9cbbda3a1341529ac9547d853bcc1ef7'
      and md5(to_jsonb(o)::text) = 'c8210da65d3ec3dfbf7bb159fb0c85b0'
  ) or (
    select count(*)
    from public.agent_report_outbox
    where report_type = 'training_state_change'
      and signal_kind = 'repeated_plan_deviation'
  ) <> 1 then
    raise exception 'paused B1 envelope preservation check failed';
  end if;
end
$postflight$;

commit;
