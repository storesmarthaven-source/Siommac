-- ============================================================================
-- HR Onboarding — case communications log (Phase 5)
-- ============================================================================
-- A per-case record of the communications HR sends around an onboarding case:
-- employee welcome, supervisor notification, owner reminders, escalation notices,
-- and free-form manual messages. Each SENT communication also emits an app_event
-- with an in-app notification to the resolved recipient (real delivery via the
-- notification system) — this table is the durable log, not a parallel delivery
-- channel. 'manual' channel = a record of a communication that happened OUTSIDE
-- the system (a call, an in-person chat) with no delivery. app_users.id is TEXT →
-- user FKs are TEXT. Operator-applied; after applying: NOTIFY pgrst, 'reload schema';
-- ============================================================================

create table if not exists public.hr_onboarding_communications (
  id                 uuid primary key default gen_random_uuid(),
  case_id            uuid not null references public.hr_onboarding_cases(id) on delete cascade,
  employee_id        text references public.app_users(id) on delete set null,
  communication_type text not null check (communication_type in (
                       'employee_welcome','supervisor_notification','owner_reminder',
                       'escalation_notice','manual_message')),
  channel            text not null default 'in_app'
                       check (channel in ('email','in_app','sms','manual')),
  recipient_user_id  text references public.app_users(id) on delete set null,
  recipient_email    text,
  subject            text,
  body               text,
  status             text not null default 'draft'
                       check (status in ('draft','queued','sent','failed','cancelled')),
  provider_message_id text,
  failure_reason     text,
  sent_by            text references public.app_users(id) on delete set null,
  sent_at            timestamptz,
  created_at         timestamptz not null default now(),
  metadata           jsonb not null default '{}'::jsonb
);
create index if not exists hr_onboarding_communications_case_idx
  on public.hr_onboarding_communications(case_id, created_at desc);

-- ── RLS + grants (backend-only via service_role) ────────────────────────────────
alter table public.hr_onboarding_communications enable row level security;
grant select, insert, update, delete on table public.hr_onboarding_communications to service_role;

-- No new permission key: gated by the existing hr.onboarding.case.manage (sending a
-- case communication is case-management work) for send/resend, and hr.onboarding.view
-- for the list, consistent with the rest of the module.

-- After applying:  NOTIFY pgrst, 'reload schema';
