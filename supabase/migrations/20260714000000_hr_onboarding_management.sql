-- ============================================================================
-- HR Onboarding — management-module foundation (Phase 1)
-- ============================================================================
-- Expands the launch-only backbone (20260709000000_hr_onboarding.sql) into the
-- full case state machine the management module needs:
--   • cases:    richer status state machine + pause timestamp
--   • tasks:    blocking / evidence / dependency / ordering flags + open/cancelled
--   • handoffs: full delivery lifecycle + ownership + lifecycle timestamps
--   • NEW hr_onboarding_blockers (Blocked tab + activation gates)
--
-- Progress %, open/blocking counts, and activation readiness are COMPUTED in the
-- API from tasks/blockers — NOT denormalized here (avoids stale-state band-aids).
-- Additive / forward-only; depends on 20260709000000. app_users.id is TEXT → all
-- user FKs are TEXT. Operator-applied; after applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── cases: expand status state machine + pause timestamp ────────────────────────
alter table public.hr_onboarding_cases drop constraint if exists hr_onboarding_cases_status_check;
alter table public.hr_onboarding_cases add constraint hr_onboarding_cases_status_check
  check (status in ('draft','open','in_progress','blocked','paused','ready_for_activation','completed','cancelled'));

alter table public.hr_onboarding_cases
  add column if not exists paused_at    timestamptz,
  add column if not exists cancelled_by text references public.app_users(id) on delete set null,
  add column if not exists cancelled_at timestamptz;

-- ── tasks: blocking / evidence / dependency / ordering + open/cancelled states ───
alter table public.hr_onboarding_tasks
  add column if not exists is_blocking       boolean not null default false,
  add column if not exists requires_evidence boolean not null default false,
  add column if not exists dependency_keys   jsonb   not null default '[]'::jsonb,
  add column if not exists sort_order        int     not null default 0,
  add column if not exists priority          text,
  add column if not exists blocked_reason    text;

alter table public.hr_onboarding_tasks drop constraint if exists hr_onboarding_tasks_status_check;
alter table public.hr_onboarding_tasks add constraint hr_onboarding_tasks_status_check
  check (status in ('pending','open','in_progress','blocked','completed','skipped','cancelled'));

-- ── handoffs: full delivery lifecycle + ownership + timestamps ───────────────────
alter table public.hr_onboarding_handoffs drop constraint if exists hr_onboarding_handoffs_status_check;
alter table public.hr_onboarding_handoffs add constraint hr_onboarding_handoffs_status_check
  check (status in ('pending','sent','accepted','blocked','delivered','completed','failed','cancelled'));

alter table public.hr_onboarding_handoffs
  add column if not exists handoff_key    text,
  add column if not exists owner_id       text references public.app_users(id) on delete set null,
  add column if not exists accepted_at    timestamptz,
  add column if not exists completed_at   timestamptz,
  add column if not exists failure_reason text,
  add column if not exists last_event_at  timestamptz;

-- ── blockers (Blocked tab + activation gates) ───────────────────────────────────
create table if not exists public.hr_onboarding_blockers (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid not null references public.hr_onboarding_cases(id) on delete cascade,
  task_id         uuid references public.hr_onboarding_tasks(id)    on delete set null,
  handoff_id      uuid references public.hr_onboarding_handoffs(id) on delete set null,
  blocker_key     text not null,
  blocker_title   text not null,
  blocking_module text not null,
  severity        text not null default 'medium'
                    check (severity in ('low','medium','high','critical')),
  status          text not null default 'active'
                    check (status in ('active','acknowledged','waiting_on_owner','escalated','resolved','waived')),
  owner_id        text references public.app_users(id) on delete set null,
  due_at          timestamptz,
  resolved_by     text references public.app_users(id) on delete set null,
  resolved_at     timestamptz,
  waiver_reason   text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz
);
create index if not exists hr_onboarding_blockers_case_idx on public.hr_onboarding_blockers(case_id, status);

-- ── RLS + grants (backend-only via service_role) ────────────────────────────────
alter table public.hr_onboarding_blockers enable row level security;
grant select, insert, update, delete on table public.hr_onboarding_blockers to service_role;

-- ── updated_at trigger ──────────────────────────────────────────────────────────
drop trigger if exists trg_hr_onboarding_blockers_updated_at on public.hr_onboarding_blockers;
create trigger trg_hr_onboarding_blockers_updated_at before update on public.hr_onboarding_blockers
  for each row execute function public.set_updated_at();

-- After applying:  NOTIFY pgrst, 'reload schema';
