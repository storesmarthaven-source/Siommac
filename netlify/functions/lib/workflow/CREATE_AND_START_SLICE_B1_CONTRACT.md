# Create-and-start slice B1 — `hr_overtime_entries` (finding #3, Shape B)

Establishes the shared `public.workflow_create_and_start_tx` RPC (the Shape-B analogue of
`workflow_submit_for_record_tx`). Shape B = INSERT the business row **and** start the workflow in ONE
transaction — fixing the create→start strand + compensating-delete band-aid in `submitOvertimeEntry`.

One shared fn, per-table branches, one migration per slice (Shape-A precedent). B1 = first branch.

## RPC
`public.workflow_create_and_start_tx(p_source_table text, p_actor_id text, p_binding_id uuid,
 p_request_key text, p_business jsonb)` — SECURITY INVOKER, service_role-only.

Flow (shared): validate → receipt-key claim (`actor|create_and_start|table|key`, md5 hash; duplicate →
return stored result) → per-table INSERT branch → reload binding `FOR SHARE` + published version →
derive first-step assignees via `_resolve_and_validate_assignee` → `_create_instance` → per-table link
`workflow_id` + business event + module audit → `_record_request` → return.

## `hr_overtime_entries` branch (REQUIRED)
- **p_business:** `employeeId` (req), `workDate`, `hours` (>0, else WF422), `multiplier` (def 1.5), `otType?`, `reason?`.
- **INSERT** `hr_overtime_entries(employee_id, work_date, hours, multiplier, ot_type, reason, status='submitted', created_by=actor)` RETURNING id, ref=`coalesce(overtime_no,'OVT-'||upper(left(id,8)))`.
- module=`hr_overtime`, type=`hr_overtime_approval`, trigger=`hr.overtime.submitted`, owner=`employeeId`, priority=`medium` (default).
- first step = static role `manager` (verified in the live binding — NO dynamic resolution, NO mig-219 dependency).
- **link:** `UPDATE hr_overtime_entries SET workflow_id`. **event:** app_events `hr.overtime.submitted` (entity `overtime_entry`, dedupe `hr.overtime.submitted:<ref>:<wf>`). **audit:** `hr_audit_log`(submodule `hr_overtime`, action `overtime.submitted`, prev null, new {status,employeeId,workDate,hours,workflowId}). NO handoff.
- **return:** `{recordId, ref, workflowId, workflowNo, eventId, firstTasks[]}`.

## FORBIDDEN
- No status-flip-then-start, no insert-then-compensating-delete, no swallowed workflow error.
- No dup business events (primitive owns workflow.started/task.assigned; wrapper owns the business event+audit).
- No server-side idempotencyKey fallback (required end-to-end on the binding path).

## DEFERRED (later slices / follow-ups)
- Remaining Shape-B branches: `hr_leave_requests`(+accrual satellite), `hr_requests`, `hr_org_change_requests`, statutory profile, `finance_pay_component_change_requests`, routes/hr employee-change, and the generic `moduleServiceAdapter` cutover (largest — the MUTATION_BACKBONE surface) LAST.
- **No-binding path** stays a plain TS insert (no workflow to strand; single write). idempotencyKey is required only on the binding/RPC path.

## Caller wiring (`submitOvertimeEntry`)
`selectWorkflowBinding` → if binding: `sb.rpc('workflow_create_and_start_tx', …)` → `rpcHttpError` → post-commit `notifyUsersByRole('manager', …)` (role-assigned first step) → refetch `getOvertimeEntry(recordId)` (null → 503). If no binding: plain insert (submitted, no workflow) + audit + event (unchanged opt-in behavior). DELETE `startWorkflowForRecord` + compensating rollback (grep-gate). Route/api/types/FE carry a required `idempotencyKey`; FE `useRef` stable-per-attempt key.
