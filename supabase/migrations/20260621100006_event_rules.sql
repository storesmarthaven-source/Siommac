-- event_rules — data-driven recipient routing for the notification engine.
--
-- The recipientResolver loads active rules matching an event's type (or '*')
-- and resolves recipients by kind. This table belongs to the canonical uuid
-- backbone (20260621100000_erp_backbone_core.sql). An earlier text-id draft
-- (20260621000000_app_events.sql) also defined it but was superseded and never
-- applied; this is the authoritative definition.
--
-- Keyed by event_type (a string) — there is no FK to app_events; a rule is a
-- standing routing policy, not tied to a specific event row.

create table if not exists public.event_rules (
  id              text        primary key,                       -- evrule-<slug>
  event_type      text        not null,                          -- e.g. 'hse.incident.submitted' or '*'
  recipient_kind  text        not null,                          -- actor|owner|assignee|dept_manager|site_manager|role|watcher|explicit
  recipient_value text,                                          -- role name for 'role'; user id for 'explicit'; else null
  notify          boolean     not null default true,             -- emit a notification to these recipients
  active          boolean     not null default true,
  created_at      timestamptz not null default now()
);

create index if not exists idx_event_rules_type on public.event_rules(event_type) where active;

-- Service-role (Netlify routes) bypasses RLS; browser clients get nothing.
alter table public.event_rules enable row level security;

-- ── Default rules ─────────────────────────────────────────────────────────────
insert into public.event_rules (id, event_type, recipient_kind, recipient_value, notify, active) values
  -- HSE incident submitted → HSE managers + the reporter (actor)
  ('evrule-inc-sub-mgr',   'hse.incident.submitted',     'role',  'manager', true, true),
  ('evrule-inc-sub-actor', 'hse.incident.submitted',     'actor', null,      true, true),

  -- Investigation assigned → notify the actor; assignee passed explicitly by caller
  ('evrule-inv-asg-actor', 'hse.investigation.assigned', 'actor', null,      true, true),

  -- CAPA overdue → HSE managers (owner passed explicitly by the scheduled sweep)
  ('evrule-capa-ovd-mgr',  'hse.capa.overdue',           'role',  'manager', true, true),

  -- Workflow task assigned / approved / rejected → managers (assignee passed explicitly)
  ('evrule-wf-task-mgr',   'workflow.task.assigned',     'role',  'manager', true, true),
  ('evrule-wf-approved',   'workflow.approved',          'role',  'manager', true, true),
  ('evrule-wf-rejected',   'workflow.rejected',          'role',  'manager', true, true),

  -- Handoff created → receiving module admins (passed explicitly by caller)
  ('evrule-handoff-actor', 'handoff.created',            'actor', null,      false, true)
on conflict (id) do nothing;
