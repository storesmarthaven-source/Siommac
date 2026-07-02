-- HR Document Requirements — policy table for required document types per scope.
-- Operator-applied. Run after: 20260702000004_hr_employee_master_profile_docs.sql

create table if not exists public.hr_document_requirements (
  id uuid primary key default gen_random_uuid(),
  document_type text not null,
  label text not null,
  applies_to_scope text not null default 'all'
    check (applies_to_scope in ('all','role','employment_type','department')),
  applies_to_value text,                          -- null for 'all'; role/type/dept id otherwise
  requires_expiry boolean not null default false, -- if true, a present doc without expiry_date is non-compliant
  reminder_days integer[] not null default '{30,7,0}',   -- per-requirement override; else settings default
  min_confidentiality text
    check (min_confidentiality in ('internal','confidential','restricted_hr','legal','medical')),
  is_active boolean not null default true,
  created_by text references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  unique (document_type, applies_to_scope, applies_to_value)
);

create index if not exists hr_doc_req_active_idx on public.hr_document_requirements(is_active);

alter table public.hr_document_requirements enable row level security;

-- After applying, run:  NOTIFY pgrst, 'reload schema';
