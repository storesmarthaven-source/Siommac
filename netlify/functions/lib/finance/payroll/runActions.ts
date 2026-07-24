/**
 * netlify/functions/lib/finance/payroll/runActions.ts
 *
 * P0-2 (payroll certification): the AUTHORITATIVE per-run action capability
 * object, computed server-side from (a) the run's current state machine
 * position, (b) the actor's real permissions via userCan(), and (c)
 * separation-of-duty rules (maker cannot approve their own run). The UI renders
 * actions exclusively from this object — it never re-derives capabilities from
 * broad flags. Backend route authorization remains final; this object exists so
 * the UI can only offer actions that the corresponding command would accept.
 *
 * State guards MIRROR the command implementations (do not invent):
 *  - lock-inputs:        draft                      (runs/lock-inputs, run.manage)
 *  - calculate:          input_locked|returned|calculation_failed (run.manage)
 *  - certify:            calculated                 (runs/certify, certify)
 *  - submit:             calculated|returned        (runs/submit, run.manage)
 *  - approve/reject:     pending_approval           (approve; SoD: actor ≠ creator)
 *  - lock:               approved                   (runs/lock, lock)
 *  - reopen:             locked                     (runs/reopen, lock; released/exported rejected)
 *  - confirm-funding:    locked                     (releases/confirm-funding, funding.approve)
 *  - release:            locked                     (releases/release, release)
 *  - payslips generate:  locked|exported            (payrollPayslips allowlist, payslips.generate)
 *  - payslips distribute:locked|released|exported   (payslips.distribute)
 *  - gl preview:         requires a current calculation version (gl.preview)
 *  - gl post:            locked                     (payrollGl guard, gl.post)
 *  - export:             released ONLY              (payrollExports guard, export) — P0-3
 */

import { userCan } from '../../auth';
import type { PayrollRunActions } from '../../../../../types/payrollRuns';

export type { PayrollRunActions };

export interface RunActionsInput {
  status: string;
  createdBy: string | null;
  hasCurrentCalculationVersion: boolean;
}

interface ActionSpec {
  key: Exclude<keyof PayrollRunActions, 'disabledReasons'>;
  permission: string;
  /** Statuses in which the command's own guard would accept the run. */
  states: readonly string[] | 'any';
  stateReason: string;
  /** Additional non-state gate (SoD, data preconditions). */
  extra?: (input: RunActionsInput, actorId: string) => string | null;
}

const SOD_REASON = 'Separation of duties: the preparer of a run cannot decide its approval.';

const ACTION_SPECS: readonly ActionSpec[] = [
  { key: 'canLockInputs', permission: 'finance.payroll.run.manage', states: ['draft'], stateReason: 'Inputs can only be locked on a draft run.' },
  // 'calculated' is included so a calculated run can be RE-calculated (e.g. after
  // a worksheet override) before submission — the calculateRun command already
  // permits it; the capability now advertises it (surfaced as "Recalculate").
  { key: 'canCalculate', permission: 'finance.payroll.run.manage', states: ['input_locked', 'returned', 'calculation_failed', 'calculated'], stateReason: 'Calculation requires locked inputs (or a returned/failed/calculated run).' },
  { key: 'canCertify', permission: 'finance.payroll.certify', states: ['calculated'], stateReason: 'Certification requires a calculated run.' },
  { key: 'canSubmit', permission: 'finance.payroll.run.manage', states: ['calculated', 'returned'], stateReason: 'Submission requires a calculated (or returned) run.' },
  {
    key: 'canApprove', permission: 'finance.payroll.approve', states: ['pending_approval'], stateReason: 'Approval requires a run pending approval.',
    extra: (input, actorId) => (input.createdBy != null && input.createdBy === actorId ? SOD_REASON : null),
  },
  {
    key: 'canReject', permission: 'finance.payroll.approve', states: ['pending_approval'], stateReason: 'Rejection requires a run pending approval.',
    extra: (input, actorId) => (input.createdBy != null && input.createdBy === actorId ? SOD_REASON : null),
  },
  { key: 'canLock', permission: 'finance.payroll.lock', states: ['approved'], stateReason: 'Only an approved run can be locked.' },
  { key: 'canReopen', permission: 'finance.payroll.lock', states: ['locked'], stateReason: 'Only a locked run can be reopened; released or exported runs cannot.' },
  { key: 'canConfirmFunding', permission: 'finance.payroll.funding.approve', states: ['locked'], stateReason: 'Funding is confirmed on a locked run.' },
  { key: 'canRelease', permission: 'finance.payroll.release', states: ['locked'], stateReason: 'Release requires a locked run (with funding and preflight complete).' },
  { key: 'canGeneratePayslips', permission: 'finance.payroll.payslips.generate', states: ['locked', 'exported'], stateReason: 'Payslips can only be generated for a locked run.' },
  { key: 'canDistributePayslips', permission: 'finance.payroll.payslips.distribute', states: ['locked', 'released', 'exported'], stateReason: 'Payslips can only be distributed after the run is locked.' },
  {
    key: 'canPreviewGl', permission: 'finance.payroll.gl.preview', states: 'any', stateReason: '',
    extra: input => (input.hasCurrentCalculationVersion ? null : 'GL preview requires a current calculation version.'),
  },
  { key: 'canPostGl', permission: 'finance.payroll.gl.post', states: ['locked'], stateReason: 'GL can only be posted for a locked run.' },
  // P0-3: export is the RELEASE export command — offered only for released runs.
  { key: 'canExport', permission: 'finance.payroll.export', states: ['released'], stateReason: 'Only a released run can be exported.' },
];

/** Compute the authoritative action capability object for one actor + run. */
export async function computeRunActions(
  actor: { id: string; role?: string | null },
  input: RunActionsInput,
): Promise<PayrollRunActions> {
  // One userCan() per distinct permission (single override/role load each; auth caches role sets).
  const permissions = [...new Set(ACTION_SPECS.map(s => s.permission))];
  const grants = new Map<string, boolean>(
    await Promise.all(permissions.map(async p => [p, await userCan(actor, p)] as const)),
  );

  const actions = { disabledReasons: {} } as PayrollRunActions;
  for (const spec of ACTION_SPECS) {
    const stateOk = spec.states === 'any' || spec.states.includes(input.status);
    const permOk = grants.get(spec.permission) === true;
    const extraReason = spec.extra ? spec.extra(input, actor.id) : null;
    const allowed = stateOk && permOk && extraReason == null;
    actions[spec.key] = allowed;
    if (!allowed) {
      // Most specific reason first: SoD/data precondition → state → permission.
      actions.disabledReasons[spec.key] =
        extraReason ?? (!stateOk ? spec.stateReason : `Requires the ${spec.permission} permission.`);
    }
  }
  return actions;
}
