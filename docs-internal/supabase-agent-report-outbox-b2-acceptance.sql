-- Read-only acceptance for the Ultreia producer-side B2 outbox migration.
-- Run immediately after supabase-agent-report-outbox-b2.sql and before waiting
-- for a normal Cron. Every row should return PASS. This file performs no DML,
-- DDL, dispatch, force call, or fake Report creation.

begin transaction read only;
set local statement_timeout = '60s';

with
catalog(report_type, signal_kind, schema_version) as (
  values
    ('training_state_change', 'repeated_plan_deviation', 'training_state_change.v1'),
    ('training_load_change', 'rapid_training_load_change', 'training_load_change.v1'),
    ('recovery_state_change', 'recovery_risk_trend', 'recovery_state_change.v1'),
    ('goal_context_change', 'target_race_context_change', 'goal_context_change.v1'),
    ('training_preference_change', 'preference_context_invalidated', 'training_preference_invalidation.v1'),
    ('training_progress_change', 'notable_progress_or_milestone', 'training_progress_change.v1'),
    ('health_risk_change', 'recurring_injury_or_health_risk_pattern', 'health_risk_change.v1')
),
constraints as (
  select conname, contype, convalidated, pg_get_constraintdef(oid, true) as definition
  from pg_constraint
  where conrelid = 'public.agent_report_outbox'::regclass
),
pair_constraint as (
  select *, regexp_replace(lower(definition), '::text|[()[:space:]]|check', '', 'g') as normalized
  from constraints
  where conname = 'agent_report_outbox_catalog_pair'
),
pending_constraint as (
  select *, regexp_replace(lower(definition), '::text\[\]|::text|[()[:space:]]|check', '', 'g') as normalized
  from constraints
  where conname = 'agent_report_outbox_pending_bundle'
),
lease_constraint as (
  select *
  from constraints
  where conname = 'agent_report_outbox_lease_pair'
),
catalog_definition_check as (
  select
    count(*) = 7
    and (select regexp_count(normalized, 'report_type=') from pair_constraint) = 7
    and (select regexp_count(normalized, 'signal_kind=') from pair_constraint) = 7
    and bool_and(
      position(
        format('report_type=''%s''andsignal_kind=''%s''', report_type, signal_kind)
        in (select normalized from pair_constraint)
      ) > 0
    ) as passed
  from catalog
),
schema_definition_check as (
  select
    count(*) = 7
    and (select regexp_count(normalized, 'schema_version') from pending_constraint) = 7
    and bool_and(
      position(
        schema_version
        in split_part(
          split_part(
            (select normalized from pending_constraint),
            format('report_type=''%s''andsignal_kind=''%s''and', report_type, signal_kind),
            2
          ),
          'orreport_type=',
          1
        )
      ) > 0
    ) as passed
  from catalog
),
pair_truth_table as (
  select
    report_types.report_type,
    signal_kinds.signal_kind,
    exists (
      select 1
      from catalog
      where catalog.report_type = report_types.report_type
        and catalog.signal_kind = signal_kinds.signal_kind
    ) as accepted
  from (select distinct report_type from catalog) as report_types
  cross join (select distinct signal_kind from catalog) as signal_kinds
),
checks(sort_order, check_name, passed, details) as (
  select 10, 'four_old_constraints_replaced_and_validated',
    not exists (
      select 1 from constraints
      where conname in ('agent_report_outbox_report_type', 'agent_report_outbox_signal_kind')
    )
    and (
      select count(*) from constraints
      where conname in (
        'agent_report_outbox_catalog_pair',
        'agent_report_outbox_pending_bundle',
        'agent_report_outbox_lease_pair'
      ) and contype = 'c' and convalidated
    ) = 3
    and not exists (select 1 from constraints where not convalidated),
    'B1 type/signal checks removed; catalog pair, pending bundle and lease pair are validated'

  union all
  select 20, 'exact_seven_catalog_pairs',
    coalesce((select passed from catalog_definition_check), false),
    'constraint has exactly seven report_type/signal_kind branches'

  union all
  select 30, 'invalid_cross_pairs_rejected',
    (select count(*) filter (where accepted) = 7 from pair_truth_table)
    and (select count(*) filter (where not accepted) = 42 from pair_truth_table)
    and coalesce((select passed from catalog_definition_check), false),
    'seven valid pairs accepted; all 42 wrong cross-pairings excluded by the exact constraint'

  union all
  select 40, 'schema_version_one_to_one',
    coalesce((select passed from schema_definition_check), false),
    'each catalog pair has exactly its registered schema_version in pending_bundle'

  union all
  select 50, 'pending_envelope_integrity_retained',
    exists (
      select 1
      from pending_constraint
      where convalidated
        and definition like '%pending_report_id%'
        and definition like '%pending_content_hash%'
        and definition like '%pending_created_at%'
        and definition like '%contract_version%'
        and definition like '%agent_report.v1%'
        and definition like '%source_product%'
        and definition like '%ultreia%'
        and definition like '%typed_payload,type%'
        and definition like '%typed_payload,signal_kind%'
        and definition like '%idle%'
        and definition like '%delivered%'
        and definition like '%pending%'
        and definition like '%retry_wait%'
        and definition like '%paused%'
        and definition like '%blocked%'
    ),
    'ID, content hash, source, type, signal and status bundle checks remain present'

  union all
  select 60, 'lease_pair_is_status_independent',
    exists (
      select 1
      from lease_constraint
      where contype = 'c'
        and convalidated
        and definition like '%lease_token%'
        and definition like '%lease_expires_at%'
        and definition not like '%status%'
    ),
    'lease fields are paired without binding leases to selected statuses'

  union all
  select 70, 'paused_b1_envelope_unchanged',
    (
      select count(*) = 1
        and bool_and(md5(pending_report_id) = '29bcfa75cf614bbaff56eeb75b0aba86')
        and bool_and(md5(pending_content_hash) = '45d2bda41e80f06da0b4d62f976e7e33')
        and bool_and(md5((pending_envelope -> 'typed_payload')::text) = 'f0f1b531eae8fa89a1814daf034676c1')
        and bool_and(md5(pending_envelope::text) = '9cbbda3a1341529ac9547d853bcc1ef7')
        and bool_and(md5(to_jsonb(o)::text) = 'c8210da65d3ec3dfbf7bb159fb0c85b0')
        and bool_and(status = 'paused')
        and bool_and(paused_until = '2026-07-15 19:30:00.386+00'::timestamptz)
      from public.agent_report_outbox as o
      where report_type = 'training_state_change'
        and signal_kind = 'repeated_plan_deviation'
    ),
    'opaque pre-migration digests prove report ID, payload, content hash, full row, status and pause are unchanged'

  union all
  select 80, 'scope_unique_key_retained',
    exists (
      select 1 from constraints
      where conname = 'agent_report_outbox_scope_unique'
        and contype = 'u'
        and convalidated
        and definition = 'UNIQUE (user_id, report_type, signal_kind)'
    )
    and exists (
      select 1 from pg_indexes
      where schemaname = 'public'
        and tablename = 'agent_report_outbox'
        and indexname = 'agent_report_outbox_scope_unique'
        and indexdef like 'CREATE UNIQUE INDEX%'
    ),
    'one independent slot per user and exact report pair remains enforced'

  union all
  select 90, 'rls_and_grants_not_weakened',
    exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'agent_report_outbox'
        and c.relrowsecurity
        and c.relforcerowsecurity
    )
    and not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'agent_report_outbox'
    )
    and (
      select count(distinct privilege_type)
      from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name = 'agent_report_outbox'
        and grantee = 'service_role'
        and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
    ) = 7
    and not exists (
      select 1
      from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name = 'agent_report_outbox'
        and grantee in ('PUBLIC', 'anon', 'authenticated')
    ),
    'RLS remains enabled+forced; no browser policies/grants; service_role keeps existing access'

  union all
  select 100, 'other_safety_constraints_retained',
    (
      select count(*)
      from constraints
      where convalidated
        and conname = any (array[
          'agent_report_outbox_attempt_count',
          'agent_report_outbox_delivered_state',
          'agent_report_outbox_delivery_bundle',
          'agent_report_outbox_error_state',
          'agent_report_outbox_last_content_hash',
          'agent_report_outbox_observed_fingerprint',
          'agent_report_outbox_pause_schedule',
          'agent_report_outbox_pending_content_hash',
          'agent_report_outbox_pkey',
          'agent_report_outbox_report_ids',
          'agent_report_outbox_retry_schedule',
          'agent_report_outbox_scope_unique',
          'agent_report_outbox_status',
          'agent_report_outbox_user_id_fkey'
        ])
    ) = 14,
    'all unrelated checks, primary/foreign keys and delivery integrity constraints remain validated'
)
select
  check_name,
  case when passed then 'PASS' else 'FAIL' end as result,
  details
from checks
order by sort_order;

commit;
