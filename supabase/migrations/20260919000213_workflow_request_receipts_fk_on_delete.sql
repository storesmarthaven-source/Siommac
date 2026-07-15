-- ============================================================================
-- workflow_request_receipts.workflow_id FK → ON DELETE SET NULL (cleanup hygiene)
-- Follow-up to 20260919000210. Operator-applied; idempotent (drop-if-exists + add).
-- ============================================================================
-- The receipt's FK to workflow_instances was created with NO ON DELETE action, so a
-- receipt PINNED its workflow_instance alive — surfaced when the E2E orphan-sweeper
-- (and any legitimate instance deletion) hit workflow_request_receipts_workflow_id_fkey
-- and could not delete test workflow_instances (which then blocked app_user cleanup).
--
-- A receipt is an idempotency-ledger row whose stored `result` jsonb ALREADY carries
-- the workflowId; it can safely outlive the instance. So SET NULL — NOT CASCADE — we
-- keep the ledger row (a retry after the instance is gone still returns the stored
-- result), we just drop the hard reference. workflow_id is nullable (mig 210), so
-- SET NULL is valid.
--
-- (Not fixed here — separate, pre-existing sweeper FK blocks: workflow_transitions
--  .task_id → workflow_tasks (mig 150) and finance_pay_component_change_requests
--  .created_by → app_users. Those are their own cleanup-order concerns.)
-- ============================================================================

alter table wf_internal.workflow_request_receipts
  drop constraint if exists workflow_request_receipts_workflow_id_fkey;

alter table wf_internal.workflow_request_receipts
  add constraint workflow_request_receipts_workflow_id_fkey
    foreign key (workflow_id) references public.workflow_instances(id) on delete set null;

-- wf_internal is off the PostgREST API surface, so no schema reload is required, but
-- harmless to run:  NOTIFY pgrst, 'reload schema';
