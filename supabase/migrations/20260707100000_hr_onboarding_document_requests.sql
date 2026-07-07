-- ============================================================================
-- HR Onboarding — document request improvements
-- Phase 1: add per-requirement blocking/waive flags to hr_document_requirements
-- Phase 2: hr_onboarding_document_requests (case-specific document tracking)
-- Phase 3: scheduled_launch_at on hr_onboarding_cases
--
-- Operator-applied; depends on 20260716000000 (hr_document_requirements) and
-- 20260714000000 (hr_onboarding_management). app_users.id is TEXT — all user
-- FKs are text references. After applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── Phase 1: per-requirement blocking / waive flags ─────────────────────────
-- blocks_onboarding: when true, a missing/expired doc prevents case launch
-- can_waive:         when true, HR may waive the requirement with a reason
alter table public.hr_document_requirements
  add column if not exists blocks_onboarding boolean not null default false,
  add column if not exists can_waive         boolean not null default false;

-- ── Phase 2: hr_onboarding_document_requests ────────────────────────────────
-- One row per required document per onboarding case. Created at launch so
-- workers and HR managers can track per-case document fulfilment.
create table if not exists public.hr_onboarding_document_requests (
  id                  uuid        primary key default gen_random_uuid(),
  case_id             uuid        not null references public.hr_onboarding_cases(id) on delete cascade,
  requirement_id      uuid        references public.hr_document_requirements(id) on delete set null,
  employee_id         text        not null references public.app_users(id) on delete cascade,
  document_type       text        not null,
  label               text        not null,
  status              text        not null default 'pending'
                        check (status in ('pending','uploaded','use_existing','waived','verified','rejected')),
  -- populated when status = 'use_existing' or 'uploaded' or 'verified'
  document_id         uuid        references public.hr_employee_documents(id) on delete set null,
  -- populated when status = 'waived'
  waiver_reason       text,
  waived_by           text        references public.app_users(id) on delete set null,
  waived_at           timestamptz,
  -- populated when status = 'rejected'
  rejection_reason    text,
  rejected_by         text        references public.app_users(id) on delete set null,
  rejected_at         timestamptz,
  -- flags copied from requirement at launch time (snapshot — requirement may change)
  is_required         boolean     not null default true,
  blocks_onboarding   boolean     not null default false,
  can_waive           boolean     not null default false,
  requires_expiry     boolean     not null default false,
  -- metadata for notes / additional context
  metadata            jsonb       not null default '{}'::jsonb,
  created_by          text        references public.app_users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz
);

create index if not exists hr_ob_doc_req_case_idx       on public.hr_onboarding_document_requests(case_id, status);
create index if not exists hr_ob_doc_req_employee_idx   on public.hr_onboarding_document_requests(employee_id);
create index if not exists hr_ob_doc_req_requirement_idx on public.hr_onboarding_document_requests(requirement_id);

alter table public.hr_onboarding_document_requests enable row level security;
grant select, insert, update, delete on table public.hr_onboarding_document_requests to service_role;

drop trigger if exists trg_hr_ob_doc_req_updated_at on public.hr_onboarding_document_requests;
create trigger trg_hr_ob_doc_req_updated_at before update on public.hr_onboarding_document_requests
  for each row execute function public.set_updated_at();

-- ── Phase 3: scheduled_launch_at on hr_onboarding_cases ─────────────────────
alter table public.hr_onboarding_cases
  add column if not exists scheduled_launch_at timestamptz;

-- After applying:  NOTIFY pgrst, 'reload schema';
