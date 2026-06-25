-- ============================================================================
-- Notification rules for the central workflow engine's app_events
-- ============================================================================
-- The engine emits workflow.* app_events with notification CONTENT and the
-- DYNAMIC recipients it must resolve itself (the per-task assignee role→users,
-- plus the requester/owner) passed as explicitRecipients — because the
-- recipientResolver delegates the `assignee`/`owner` kinds to the calling code
-- (a static rule cannot know a per-task role). These rows put that recipient
-- policy in the canonical event_rules table so it is VISIBLE and TUNABLE like
-- every other module's events, and so role-based broadcasts can be added later
-- (e.g. add a ('workflow.rejected','role','manager') row) without code changes.
--
-- recipient_kind 'assignee'/'owner' are honored from the engine's
-- explicitRecipients; these rows therefore formalize (not duplicate) the policy.
--
-- NOT seeded: workflow.started (the requester just submitted — no notification),
-- and workflow.overdue (no overdue sweep emits it yet). Add when those exist.
--
-- Idempotent (id PK + on conflict do nothing). Run manually, then NOTIFY pgrst.
-- ============================================================================

insert into public.event_rules (id, event_type, recipient_kind, recipient_value, notify, active) values
  -- A task was assigned → notify the assignee (role→users resolved by the engine).
  ('evrule-wf-task-assigned', 'workflow.task.assigned', 'assignee', null, true, true),
  -- Terminal outcomes → notify the requester + record owner.
  ('evrule-wf-completed',     'workflow.completed',     'owner',    null, true, true),
  ('evrule-wf-returned',      'workflow.returned',      'owner',    null, true, true),
  ('evrule-wf-rejected',      'workflow.rejected',      'owner',    null, true, true),
  ('evrule-wf-cancelled',     'workflow.cancelled',     'owner',    null, true, true)
on conflict (id) do nothing;

-- After applying:  NOTIFY pgrst, 'reload schema';
