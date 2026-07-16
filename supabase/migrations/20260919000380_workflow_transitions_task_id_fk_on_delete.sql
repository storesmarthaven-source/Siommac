-- ============================================================================
-- workflow_transitions.task_id FK -> ON DELETE CASCADE (cleanup hygiene)
-- Follow-up to 20260919000150 (the schema migration that defined the FK) and a
-- sibling of 20260919000213 (which fixed workflow_request_receipts the same way
-- and explicitly flagged THIS constraint as a separate cleanup-order concern).
-- Operator-applied; idempotent (drop-if-exists + add).
-- ============================================================================
-- workflow_transitions.task_id -> workflow_tasks(id) was created with NO ON DELETE
-- action (default RESTRICT), so a transition PINNED its workflow_task alive. The
-- E2E orphan-sweeper deletes workflow_tasks BEFORE it deletes workflow_instances
-- (whose CASCADE would otherwise clear the transitions), so the task delete hit
-- workflow_transitions_task_id_fkey and failed -- leaving orphaned tasks and
-- transitions plus the [sweep] "delete failed" noise across the messaging,
-- communications and finance (expenses/remittances/disbursements) suites.
--
-- CASCADE (not SET NULL) is the correct semantics: a workflow_transition is the
-- transactional-outbox delivery machinery for a decision, NOT a durable audit
-- trail. The audit trail lives in workflow_audit_log / workflow_decisions /
-- app_events, none of which reference workflow_tasks with RESTRICT. The SAME table
-- already declares workflow_id -> workflow_instances ON DELETE CASCADE, so a
-- transition is designed to die with its parent; task_id should behave identically.
-- A non-cancel transition with a null task_id is also semantically invalid (only
-- cancel transitions are task-less), which rules SET NULL out. The transition
-- subtree already cascades: workflow_outbox.transition_id and
-- workflow_source_receipts.transition_id are both ON DELETE CASCADE, so deleting a
-- task removes the transition AND its delivery job and source receipt in one
-- consistent teardown.
-- ============================================================================

alter table public.workflow_transitions
  drop constraint if exists workflow_transitions_task_id_fkey;

alter table public.workflow_transitions
  add constraint workflow_transitions_task_id_fkey
    foreign key (task_id) references public.workflow_tasks(id) on delete cascade;

-- The constraint lives on a table exposed through PostgREST; reload the schema
-- cache so the API picks up the redefined relationship immediately.
notify pgrst, 'reload schema';
