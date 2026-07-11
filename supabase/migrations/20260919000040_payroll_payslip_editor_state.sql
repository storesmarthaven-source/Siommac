-- ============================================================================
-- payroll_payslip_editor_state -- per-user Payslip Studio scratch state
-- ============================================================================
-- Replaces the studio's browser-localStorage autosave so NOTHING is browser-only:
-- the in-progress working draft (`draft_design`) and the "which saved template is
-- open" pointer (`open_ref`) now live in the DB, per user. One row per user
-- (user_id PK). This is private per-user UI/scratch state (like ui_layout), so it
-- is NOT a business record: no app_events / audit / workflow. app_users.id is TEXT.
-- ASCII + idempotent.
-- ============================================================================

create table if not exists public.payroll_payslip_editor_state (
  user_id      text primary key references public.app_users(id) on delete cascade,
  draft_design jsonb,                                    -- live working design (autosave)
  open_ref     jsonb,                                    -- { id, name } of the open saved template, or null
  updated_at   timestamptz not null default now()
);

-- RLS -- enabled on every table. Reads/writes go through the authenticated
-- Netlify functions (service role), which scope every query to the calling user.
alter table public.payroll_payslip_editor_state enable row level security;
grant select, insert, update, delete on public.payroll_payslip_editor_state to service_role;

-- After applying, run: NOTIFY pgrst, 'reload schema';
