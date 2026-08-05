-- Migration: 20260930000002_hr_onboarding_work_queue_foundation.sql
--
-- Schema foundation for the unified Onboarding Work Queue (executable work, not cases).
-- Two approved gaps, plus the indexes the cross-case queue needs.
--
--   Gap A — hr_onboarding_handoffs has no due date, so a unified Due State filter and
--           due sort could not include handoff rows. Adds a REAL nullable due_at.
--   Gap B — evidence lived as an append-only array in hr_onboarding_tasks.metadata,
--           which cannot carry a per-submission review decision. Adds a proper evidence
--           ARTIFACT table. The onboarding TASK remains the authoritative unit of work;
--           this table holds documents and their review history, not work items.
--
-- DELIBERATELY NOT DONE HERE
--   * No SLA is invented. due_at stays NULL unless the frozen plan supplies an
--     authoritative date; NULL is classified "Unscheduled" by the read model.
--   * No audit rows are written from SQL. Audit/event/notification emission stays in the
--     backend (writeHrAudit / emitAppEvent), because a SQL-side app_events insert bypasses
--     emitAppEvent and would silently skip audit_logs + notifications.
--   * metadata.evidence is NOT dropped. Legacy entries are COPIED into the new table; the
--     JSON stays in place, read-only, until reads are verified and the legacy write path
--     is removed in a later increment. Nothing is destroyed by this migration.
--
-- PENDING OPERATOR ACTION — never self-apply.

-- ════════════════════════════════════════════════════════════════════════════════
-- Gap A — authoritative handoff due date
-- ════════════════════════════════════════════════════════════════════════════════

alter table public.hr_onboarding_handoffs
  add column if not exists due_at timestamptz;

comment on column public.hr_onboarding_handoffs.due_at is
  'Authoritative due date resolved from the frozen package handoff template schedule at '
  'creation, or supplied explicitly for a manual handoff. NULL means no deterministic due '
  'date exists and the row is classified Unscheduled. Never derived from created_at.';

-- Handoff templates carry a trigger_rule but no schedule, so there was nothing for a
-- handoff due date to be resolved FROM. Mirrors hr_onboarding_task_templates.due_rule.
alter table public.hr_onboarding_handoff_templates
  add column if not exists due_rule jsonb not null default '{}'::jsonb;

comment on column public.hr_onboarding_handoff_templates.due_rule is
  'Frozen-plan schedule, same single format as hr_onboarding_task_templates.due_rule: '
  '{"offsetDays": <integer>} counted from the case target_start_date (negative = before, '
  '0 = the start day, positive = after). An empty object means Unscheduled.';

-- The one supported due-rule format, stated on the pre-existing task-template column too so
-- both sides of the frozen plan document the same contract. This column already existed but
-- was read nowhere; it is now interpreted at case creation.
comment on column public.hr_onboarding_task_templates.due_rule is
  'Frozen-plan schedule: {"offsetDays": <integer>} counted from the case target_start_date '
  '(negative = before, 0 = the start day, positive = after). An empty object, a missing key '
  'or a non-integer means the task has no deterministic due date (Unscheduled). There is no '
  'second format and no fallback anchor — never created_at.';

-- No backfill of existing handoffs: no frozen plan currently supplies an authoritative
-- handoff date (due_rule is new and empty on every template), so every historical row
-- correctly remains NULL / Unscheduled. Backfilling from created_at is exactly the
-- invented SLA this design forbids.

-- ════════════════════════════════════════════════════════════════════════════════
-- Gap B — evidence artifact table with a real review lifecycle
-- ════════════════════════════════════════════════════════════════════════════════

create table if not exists public.hr_onboarding_task_evidence (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references public.hr_onboarding_tasks(id) on delete cascade,
  -- case_id is denormalised deliberately: the Work Queue scope predicate filters by
  -- case_id across a UNION, and a task never moves between cases, so this cannot drift.
  case_id        uuid not null references public.hr_onboarding_cases(id) on delete cascade,

  file_name      text,
  file_path      text,
  mime_type      text,
  file_size      bigint,

  submitted_by   text references public.app_users(id) on delete set null,
  submitted_at   timestamptz not null default now(),

  review_status  text not null default 'pending_review'
                   check (review_status in ('pending_review', 'approved', 'returned')),
  reviewed_by    text references public.app_users(id) on delete set null,
  reviewed_at    timestamptz,
  review_note    text,

  version        int  not null default 1,
  supersedes_id  uuid references public.hr_onboarding_task_evidence(id) on delete set null,

  -- Copied from metadata.evidence rather than submitted through the upload flow. Such a
  -- row may lack a usable storage path, so it is flagged and left awaiting review — it is
  -- never presented as an approved fact.
  is_legacy      boolean not null default false,
  legacy_payload jsonb,

  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz,

  -- A submission made through the upload flow must be retrievable.
  constraint hr_onboarding_task_evidence_path_required
    check (is_legacy or (file_name is not null and file_path is not null)),

  -- A decision must record who made it and when; an undecided row must record neither.
  constraint hr_onboarding_task_evidence_review_complete
    check (
      (review_status = 'pending_review' and reviewed_at is null and reviewed_by is null)
      or (review_status in ('approved', 'returned') and reviewed_at is not null)
    ),

  -- Returning evidence to the submitter requires a reason they can act on.
  constraint hr_onboarding_task_evidence_return_reason
    check (review_status <> 'returned' or coalesce(btrim(review_note), '') <> ''),

  constraint hr_onboarding_task_evidence_version_positive check (version >= 1),
  constraint hr_onboarding_task_evidence_not_self_superseding check (supersedes_id <> id)
);

comment on table public.hr_onboarding_task_evidence is
  'Evidence ARTIFACTS submitted against an onboarding task, each with its own review '
  'decision and history. This is not a second work store: hr_onboarding_tasks remains the '
  'authoritative unit of work. A pending_review row surfaces in the Work Queue as an '
  'actionable evidence-review item linked back to its task and case.';

alter table public.hr_onboarding_task_evidence enable row level security;
grant select, insert, update, delete on table public.hr_onboarding_task_evidence to service_role;

drop trigger if exists trg_hr_onboarding_task_evidence_updated_at on public.hr_onboarding_task_evidence;
create trigger trg_hr_onboarding_task_evidence_updated_at before update on public.hr_onboarding_task_evidence
  for each row execute function public.set_updated_at();

-- ── Legacy migration from hr_onboarding_tasks.metadata.evidence ─────────────────
-- Every historical entry becomes a row awaiting review. Entries whose structure is
-- reliable (both fileName and filePath present) are mapped field by field; the rest keep
-- their original JSON verbatim in legacy_payload so nothing is lost or guessed. Neither
-- kind is ever marked approved. Idempotent: re-running inserts nothing new.
insert into public.hr_onboarding_task_evidence
  (id, task_id, case_id, file_name, file_path, mime_type, file_size,
   submitted_by, submitted_at, review_status, is_legacy, legacy_payload)
select
  case when (e.entry ->> 'id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       then (e.entry ->> 'id')::uuid else gen_random_uuid() end,
  t.id,
  t.case_id,
  nullif(e.entry ->> 'fileName', ''),
  nullif(e.entry ->> 'filePath', ''),
  nullif(e.entry ->> 'mimeType', ''),
  case when (e.entry ->> 'fileSize') ~ '^[0-9]+$' then (e.entry ->> 'fileSize')::bigint end,
  nullif(e.entry ->> 'byId', ''),
  coalesce((e.entry ->> 'at')::timestamptz, t.created_at),
  'pending_review',
  true,
  e.entry
from public.hr_onboarding_tasks t
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(t.metadata -> 'evidence') = 'array'
       then t.metadata -> 'evidence' else '[]'::jsonb end
) as e(entry)
where jsonb_typeof(e.entry) = 'object'
on conflict (id) do nothing;

-- ════════════════════════════════════════════════════════════════════════════════
-- Cross-case queue indexes
--
-- Every pre-existing index on these tables is case_id-leading, which serves Case Detail
-- but not a queue that filters by accountable person and due state ACROSS cases and sorts
-- by due date. Each index below is PARTIAL over the open lifecycle states, so it stays
-- small as completed work accumulates.
-- ════════════════════════════════════════════════════════════════════════════════

create index if not exists hr_onboarding_tasks_active_owner_idx
  on public.hr_onboarding_tasks (assigned_to, due_at)
  where status in ('pending', 'open', 'in_progress', 'blocked');

create index if not exists hr_onboarding_tasks_active_due_idx
  on public.hr_onboarding_tasks (due_at, id)
  where status in ('pending', 'open', 'in_progress', 'blocked');

create index if not exists hr_onboarding_handoffs_active_owner_idx
  on public.hr_onboarding_handoffs (owner_id, status, due_at)
  where status in ('pending', 'sent', 'accepted', 'blocked', 'failed');

create index if not exists hr_onboarding_handoffs_active_due_idx
  on public.hr_onboarding_handoffs (due_at, id)
  where status in ('pending', 'sent', 'accepted', 'blocked', 'failed');

create index if not exists hr_onboarding_blockers_active_owner_idx
  on public.hr_onboarding_blockers (owner_id, due_at)
  where status in ('active', 'acknowledged', 'waiting_on_owner', 'escalated');

create index if not exists hr_onboarding_task_evidence_pending_idx
  on public.hr_onboarding_task_evidence (case_id, submitted_at desc)
  where review_status = 'pending_review';

create index if not exists hr_onboarding_task_evidence_task_idx
  on public.hr_onboarding_task_evidence (task_id, version desc);

-- ════════════════════════════════════════════════════════════════════════════════
-- VERIFICATION — run after applying. Expected results stated per query.
-- ════════════════════════════════════════════════════════════════════════════════

-- V1 — the two new columns exist. Expect exactly 2 rows.
select table_name, column_name
from information_schema.columns
where (table_name = 'hr_onboarding_handoffs'           and column_name = 'due_at')
   or (table_name = 'hr_onboarding_handoff_templates'  and column_name = 'due_rule')
order by table_name;

-- V2 — evidence table exists with RLS enabled. Expect 1 row, rowsecurity = true.
select relname, relrowsecurity as rowsecurity
from pg_class where relname = 'hr_onboarding_task_evidence';

-- V3 — no legacy evidence was silently approved. Expect 0.
select count(*) as legacy_not_pending
from public.hr_onboarding_task_evidence
where is_legacy and review_status <> 'pending_review';

-- V4 — every legacy JSON entry produced exactly one row. Expect equal counts.
select
  (select count(*) from public.hr_onboarding_tasks t
     cross join lateral jsonb_array_elements(
       case when jsonb_typeof(t.metadata -> 'evidence') = 'array'
            then t.metadata -> 'evidence' else '[]'::jsonb end) e(entry)
   where jsonb_typeof(e.entry) = 'object')                as json_entries,
  (select count(*) from public.hr_onboarding_task_evidence where is_legacy) as migrated_rows;

-- V5 — the seven queue indexes exist. Expect 7 rows.
select indexname from pg_indexes
where schemaname = 'public'
  and indexname in (
    'hr_onboarding_tasks_active_owner_idx',
    'hr_onboarding_tasks_active_due_idx',
    'hr_onboarding_handoffs_active_owner_idx',
    'hr_onboarding_handoffs_active_due_idx',
    'hr_onboarding_blockers_active_owner_idx',
    'hr_onboarding_task_evidence_pending_idx',
    'hr_onboarding_task_evidence_task_idx')
order by indexname;

-- V6 — no handoff received an invented due date. Expect 0.
select count(*) as handoffs_with_due_date
from public.hr_onboarding_handoffs where due_at is not null;
