-- Phase 0A: Platform-level workflow and cross-module handoff tables
-- These are NOT module-specific — every module (HSE, HR, Finance, Operations, Payroll)
-- shares these tables. Do not add module-specific columns here.
--
-- Replaces: localStorage key `siomac.hse.workflow.v1` (frontend optimistic cache stays
-- as a read-only fallback during offline/loading; all mutations go through the API).

-- ── Updated-at trigger function (reused across all new tables) ────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── workflow_instances ────────────────────────────────────────────────────────
-- One row per workflow run (an incident under review, a permit pending approval, etc.)

create table if not exists public.workflow_instances (
  id            text        primary key,                     -- wf-<ulid>
  template_id   text        not null,                        -- maps to frontend workflow templates
  record_ref    text        not null,                        -- e.g. 'INC-2026-001', 'PTW-2026-042'
  source_module text        not null,                        -- 'hse'|'hr'|'finance'|'operations'|'payroll'
  target_module text,                                        -- set for cross-module workflows
  status        text        not null default 'pending'
                            check (status in ('pending','in_review','returned','approved','rejected','closed')),
  stage_key     text        not null default 'submitted',
  priority      text        not null default 'normal'
                            check (priority in ('low','normal','high','critical')),
  due_date      timestamptz,
  created_by    uuid        references public.app_users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  metadata      jsonb       not null default '{}'
);

create index if not exists idx_workflow_instances_source_module on public.workflow_instances(source_module);
create index if not exists idx_workflow_instances_status        on public.workflow_instances(status);
create index if not exists idx_workflow_instances_record_ref    on public.workflow_instances(record_ref);
create index if not exists idx_workflow_instances_created_by    on public.workflow_instances(created_by);

create trigger trg_workflow_instances_updated_at
  before update on public.workflow_instances
  for each row execute function public.set_updated_at();

alter table public.workflow_instances enable row level security;

-- Service-role (backend) has full access; RLS further scoped per-user in policies below.
create policy "workflow_instances: creator can read own"
  on public.workflow_instances for select
  using (created_by = auth.uid());

create policy "workflow_instances: superadmin/admin full access"
  on public.workflow_instances for all
  using (
    exists (
      select 1 from public.app_users
      where id = auth.uid() and role in ('superadmin', 'admin', 'manager')
    )
  );

-- ── approval_tasks ────────────────────────────────────────────────────────────
-- One row per approval step within a workflow instance.

create table if not exists public.approval_tasks (
  id            text        primary key,                     -- apr-<ulid>
  workflow_id   text        not null references public.workflow_instances(id) on delete cascade,
  approver_role text        not null,                        -- role that can claim/decide this task
  approver_id   uuid        references public.app_users(id) on delete set null,  -- set when claimed
  status        text        not null default 'pending'
                            check (status in ('pending','approved','returned','rejected')),
  evidence      jsonb       not null default '[]',           -- [{ key, label, attached: bool }]
  comment       text,
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_approval_tasks_workflow_id    on public.approval_tasks(workflow_id);
create index if not exists idx_approval_tasks_approver_role  on public.approval_tasks(approver_role);
create index if not exists idx_approval_tasks_status         on public.approval_tasks(status);

create trigger trg_approval_tasks_updated_at
  before update on public.approval_tasks
  for each row execute function public.set_updated_at();

alter table public.approval_tasks enable row level security;

create policy "approval_tasks: approver role can read pending"
  on public.approval_tasks for select
  using (
    exists (
      select 1 from public.app_users
      where id = auth.uid() and role = approval_tasks.approver_role
    )
  );

create policy "approval_tasks: admin/manager full access"
  on public.approval_tasks for all
  using (
    exists (
      select 1 from public.app_users
      where id = auth.uid() and role in ('superadmin', 'admin', 'manager')
    )
  );

-- ── workflow_events ───────────────────────────────────────────────────────────
-- Append-only audit log of every state transition in a workflow.

create table if not exists public.workflow_events (
  id          text        primary key,                       -- wfe-<ulid>
  workflow_id text        not null references public.workflow_instances(id) on delete cascade,
  at          timestamptz not null default now(),
  actor_id    uuid        references public.app_users(id) on delete set null,
  event       text        not null
              check (event in ('submitted','approved','returned','rejected','escalated','closed','reopened','commented')),
  detail      jsonb       not null default '{}'
);

create index if not exists idx_workflow_events_workflow_id on public.workflow_events(workflow_id);
create index if not exists idx_workflow_events_at          on public.workflow_events(at);
create index if not exists idx_workflow_events_actor_id    on public.workflow_events(actor_id);

-- workflow_events is append-only — no update trigger needed.
alter table public.workflow_events enable row level security;

create policy "workflow_events: admin/manager read"
  on public.workflow_events for select
  using (
    exists (
      select 1 from public.app_users
      where id = auth.uid() and role in ('superadmin', 'admin', 'manager')
    )
  );

create policy "workflow_events: actor can read own"
  on public.workflow_events for select
  using (actor_id = auth.uid());

-- ── handoff_outbox ────────────────────────────────────────────────────────────
-- Source module writes here when a workflow completes and a cross-module action
-- must be taken. Target module's intake route reads and processes these.
-- Designed for reliable at-least-once delivery with retry tracking.

create table if not exists public.handoff_outbox (
  id            text        primary key,                     -- hox-<ulid>
  source_module text        not null,
  target_module text        not null,
  record_ref    text        not null,
  handoff_type  text        not null,                        -- 'injury-record'|'cost-claim'|'work-clearance'|'competency-update'|'ema-levy'|'disciplinary-note'
  payload       jsonb       not null,
  status        text        not null default 'pending'
                            check (status in ('pending','delivered','failed')),
  attempts      int         not null default 0,
  last_attempt  timestamptz,
  delivered_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists idx_handoff_outbox_status        on public.handoff_outbox(status);
create index if not exists idx_handoff_outbox_target_module on public.handoff_outbox(target_module);
create index if not exists idx_handoff_outbox_source_module on public.handoff_outbox(source_module);

alter table public.handoff_outbox enable row level security;

-- Backend (service role) manages delivery; users cannot read/write handoff rows directly.
create policy "handoff_outbox: admin read-only"
  on public.handoff_outbox for select
  using (
    exists (
      select 1 from public.app_users
      where id = auth.uid() and role in ('superadmin', 'admin')
    )
  );

-- ── handoff_inbox ─────────────────────────────────────────────────────────────
-- Target module's intake route writes here after processing a handoff_outbox row,
-- then marks processed = true. Preserves the received payload for audit purposes.

create table if not exists public.handoff_inbox (
  id            text        primary key,                     -- hin-<ulid>
  outbox_id     text        references public.handoff_outbox(id) on delete set null,
  source_module text        not null,
  handoff_type  text        not null,
  record_ref    text        not null,
  payload       jsonb       not null,
  processed     bool        not null default false,
  processed_at  timestamptz,
  received_at   timestamptz not null default now()
);

create index if not exists idx_handoff_inbox_processed     on public.handoff_inbox(processed);
create index if not exists idx_handoff_inbox_source_module on public.handoff_inbox(source_module);
create index if not exists idx_handoff_inbox_handoff_type  on public.handoff_inbox(handoff_type);

alter table public.handoff_inbox enable row level security;

create policy "handoff_inbox: admin read-only"
  on public.handoff_inbox for select
  using (
    exists (
      select 1 from public.app_users
      where id = auth.uid() and role in ('superadmin', 'admin')
    )
  );

-- ── payroll_approvals: add nis_employer column ────────────────────────────────
-- Back-fill the employer NIS cost column added in the NIS rate fix.
-- NIBTT 2026: employer rate is 10.8% (separate from the 5.4% employee deduction).

alter table public.payroll_approvals
  add column if not exists nis_employer numeric(12,2) not null default 0;
