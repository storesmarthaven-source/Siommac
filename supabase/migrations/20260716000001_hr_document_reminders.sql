-- HR Document Reminders — dedupe ledger for expiry reminder notifications.
-- Idempotent: unique constraint prevents re-notifying on the same (doc, window, expiry).
-- Operator-applied.

create table if not exists public.hr_document_reminders (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.hr_employee_documents(id) on delete cascade,
  threshold_days integer not null,                -- which reminder window fired
  expiry_date date not null,                      -- guards re-fire if the doc's expiry is later changed
  sent_at timestamptz not null default now(),
  unique (document_id, threshold_days, expiry_date)
);

create index if not exists hr_doc_reminders_doc_idx on public.hr_document_reminders(document_id);

alter table public.hr_document_reminders enable row level security;

-- After applying, run:  NOTIFY pgrst, 'reload schema';
