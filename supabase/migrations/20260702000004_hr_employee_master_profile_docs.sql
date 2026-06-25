-- ============================================================================
-- HR Employee Master — profile fields + employee documents (enterprise build)
-- ============================================================================
-- Additive, building on the green foundation (HR fields live on app_users). Adds
-- the remaining profile fields and the private HR-documents table. Keyed to
-- app_users.id (TEXT), consistent with the other HR satellites (employee_id).
-- Run manually + NOTIFY pgrst.
-- ============================================================================

-- ── app_users: remaining Employee-Master profile fields ───────────────────────
alter table public.app_users add column if not exists emergency_contact_name         text;
alter table public.app_users add column if not exists emergency_contact_phone        text;
alter table public.app_users add column if not exists emergency_contact_relationship text;
alter table public.app_users add column if not exists sensitive_notes                text;
alter table public.app_users add column if not exists position_id                    uuid
  references public.hr_positions(id) on delete set null;

create index if not exists app_users_position_idx on public.app_users(position_id) where position_id is not null;

-- ── hr_employee_documents — private HR documents (contract, ID, letters, etc.) ──
create table if not exists public.hr_employee_documents (
  id              uuid primary key default gen_random_uuid(),
  employee_id     text not null references public.app_users(id) on delete cascade,
  document_type   text not null,
  title           text not null,
  file_path       text not null,
  file_name       text not null,
  mime_type       text,
  file_size       bigint,
  confidentiality text not null default 'internal'
                  check (confidentiality in ('internal','confidential','restricted_hr','legal','medical')),
  status          text not null default 'uploaded'
                  check (status in ('uploaded','verified','rejected','archived')),
  expiry_date     date,
  uploaded_by     text references public.app_users(id) on delete set null,
  uploaded_at     timestamptz not null default now(),
  verified_by     text references public.app_users(id) on delete set null,
  verified_at     timestamptz,
  rejected_reason text,
  archived_at     timestamptz,
  metadata        jsonb not null default '{}'::jsonb
);
create index if not exists hr_emp_docs_employee_idx on public.hr_employee_documents(employee_id, status);
create index if not exists hr_emp_docs_expiry_idx on public.hr_employee_documents(expiry_date) where expiry_date is not null;
alter table public.hr_employee_documents enable row level security;
