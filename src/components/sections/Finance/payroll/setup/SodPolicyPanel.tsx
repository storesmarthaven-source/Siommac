/**
 * src/components/sections/Finance/payroll/setup/SodPolicyPanel.tsx
 *
 * Payroll Setup → Governance. The segregation-of-duties level decides how many
 * DISTINCT people the payroll chain needs before money moves:
 *
 *   2 — the funder/releaser must differ from the preparer
 *   3 — …and from the approver            (default)
 *   4 — …and from the certifier           (strictest)
 *
 * The level is snapshotted onto each run at creation, so changing it never alters
 * a run already in flight. Changing it is governed, not a toggle: propose → a
 * DIFFERENT authorised approver approves → it activates for future runs. The
 * eligible-role list is superadmin-only (a finance manager must not be able to
 * make itself the sole approver and defeat maker-checker).
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { financePayrollApi, type PayrollSodPolicy } from '@api/finance/payroll';
import { useCan } from '@lib/permissions';
import { useSessionStore } from '@store/session';
import { toast } from '@store';
import { EmployeeCell } from '../../_shared/EmployeeCell';
import { SodChainDialog } from './SodChainDialog';
import { SodChangeWizard } from './SodChangeWizard';

const LEVELS: { level: 2 | 3 | 4; title: string; detail: string }[] = [
  { level: 2, title: '2-person', detail: 'The person who funds and releases must differ from the preparer.' },
  { level: 3, title: '3-person', detail: 'Also separates the approver — the approver cannot fund or release.' },
  { level: 4, title: '4-person', detail: 'Strictest: also separates the certifier from funding and release.' },
];

const ALL_ROLES = ['superadmin', 'admin', 'finance_manager', 'finance_staff', 'manager'];

export function SodPolicyPanel(): VNode {
  const qc = useQueryClient();
  const myId = useSessionStore(s => s.userId);
  const canPropose = useCan('finance.payroll.sod_policy.propose');
  const canApprove = useCan('finance.payroll.sod_policy.approve');
  const canManageRoles = useCan('finance.payroll.sod_policy.manage_roles');

  const q = useQuery({
    queryKey: ['finance', 'payroll', 'sod-policy'],
    queryFn: () => financePayrollApi.getSodPolicy(),
  });

  const [chainOpen, setChainOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  const invalidate = (): void => { void qc.invalidateQueries({ queryKey: ['finance', 'payroll', 'sod-policy'] }); };

  const proposeMut = useMutation({
    mutationFn: (v: { sodLevel: 2 | 3 | 4; reason: string }) => financePayrollApi.proposeSodChange(v),
    onSuccess: () => { toast('SoD change proposed — it needs a different approver.'); setWizardOpen(false); invalidate(); },
    // Keeps the wizard open on failure (e.g. the server's staffing refusal), so
    // the reason the user typed is not thrown away.
    onError: (e) => toast(e instanceof Error ? e.message : 'Could not propose the change.'),
  });
  const approveMut = useMutation({
    mutationFn: (policyId: string) => financePayrollApi.approveSodChange({ policyId }),
    onSuccess: (p) => { toast(`SoD policy is now ${p.sodLevel}-person for new runs.`); invalidate(); },
    onError: (e) => toast(e instanceof Error ? e.message : 'Approval failed.'),
  });
  const rolesMut = useMutation({
    mutationFn: (roles: string[]) => financePayrollApi.setSodRoles({ roles }),
    onSuccess: () => { toast('Eligible roles updated.'); invalidate(); },
    onError: (e) => toast(e instanceof Error ? e.message : 'Could not update roles.'),
  });

  if (q.isLoading && !q.data) {
    return <div class="hrfin-card"><div style={{ padding: 32 }} class="hrfin-empty">Loading governance policy…</div></div>;
  }
  if (q.isError) {
    return (
      <div class="hrfin-card"><div style={{ padding: 32 }} class="hrfin-empty">
        Could not load the SoD policy. <button type="button" class="hrfin-action" onClick={() => void q.refetch()}>Retry</button>
      </div></div>
    );
  }

  const { active, pending, history } = q.data!;
  const activeLevel = active?.sodLevel ?? 3;
  const activeMeta = LEVELS.find(l => l.level === activeLevel);
  const iProposed = !!pending && pending.proposedBy === myId;

  return (
    <div class="stack" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* ── Active policy ── */}
      <section class="hrfin-card">
        <div class="hrfin-card-head">
          <div>
            <h2>Segregation of duties</h2>
            <span>How many distinct people the payroll chain needs before money moves.</span>
          </div>
          <span class="hrfin-chip is-success">{activeLevel}-person</span>
        </div>
        <div>
          <p style={{ margin: 0, fontSize: 13 }}><strong>{activeMeta?.title}</strong> — {activeMeta?.detail}</p>
          <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--muted)' }}>
            The preparer can never fund or release their own run, at any level. Each run keeps the
            level it was created under, so changing this never affects a run already in progress.
          </p>
          {active?.effectiveAt && (
            <p style={{ margin: '8px 0 0', fontSize: 11.5, color: 'var(--muted)' }}>
              Effective {new Date(active.effectiveAt).toLocaleString('en-GB')}
              {active.approvedBy && <> · approved by <EmployeeCell employeeId={active.approvedBy} /></>}
            </p>
          )}
          <div style={{ marginTop: 12 }}>
            <button type="button" class="hrfin-action" onClick={() => setChainOpen(true)}>
              <i class="fa-solid fa-diagram-project" style={{ fontSize: 12 }} /> View the approval chain
            </button>
          </div>
        </div>
      </section>

      {/* ── Pending proposal ── */}
      {pending && (
        <section class="hrfin-card">
          <div class="hrfin-card-head">
            <div>
              <h2>Change awaiting approval</h2>
              <span>A proposed change takes effect only once a different authorised approver approves it.</span>
            </div>
            <span class="hrfin-chip is-warning">Pending</span>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 13 }}>
              Move to <strong>{pending.sodLevel}-person</strong> (from {activeLevel}-person)
              {pending.proposedBy && <> · proposed by <EmployeeCell employeeId={pending.proposedBy} /></>}
            </p>
            {pending.reason && <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--muted)' }}>“{pending.reason}”</p>}
            <div style={{ marginTop: 12 }}>
              {iProposed ? (
                <small style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  You proposed this change, so you cannot approve it — segregation of duties requires a different approver.
                </small>
              ) : canApprove ? (
                <button type="button" class="hrfin-action is-primary" disabled={approveMut.isPending}
                  onClick={() => approveMut.mutate(pending.id)}>
                  {approveMut.isPending ? 'Approving…' : `Approve ${pending.sodLevel}-person policy`}
                </button>
              ) : (
                <small style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  You do not have permission to approve an SoD change.
                </small>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Propose a change (guided) ── */}
      {canPropose && !pending && (
        <section class="hrfin-card">
          <div class="hrfin-card-head">
            <div>
              <h2>Change the policy</h2>
              <span>A guided review — choose a level, see exactly what it changes, then submit it for approval.</span>
            </div>
          </div>
          <div>
            <button type="button" class="hrfin-action is-primary" onClick={() => setWizardOpen(true)}>
              <i class="fa-solid fa-shield-halved" style={{ fontSize: 12 }} /> Change segregation of duties
            </button>
            <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--muted)' }}>
              Nothing changes on submission — a different authorised approver has to approve it first.
            </p>
          </div>
        </section>
      )}

      {/* ── Eligible roles (superadmin only) ── */}
      {canManageRoles && (
        <section class="hrfin-card">
          <div class="hrfin-card-head">
            <div>
              <h2>Who may change this policy</h2>
              <span>Superadmin only. Superadmin is always retained so the control can never lock itself out.</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {ALL_ROLES.map(r => {
              const on = (active?.eligibleRoles ?? []).includes(r);
              const locked = r === 'superadmin';
              return (
                <label key={r} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5, opacity: locked ? 0.6 : 1 }}>
                  <input type="checkbox" checked={on || locked} disabled={locked || rolesMut.isPending}
                    onChange={e => {
                      const next = new Set(active?.eligibleRoles ?? []);
                      (e.target as HTMLInputElement).checked ? next.add(r) : next.delete(r);
                      next.add('superadmin');
                      rolesMut.mutate([...next]);
                    }} />
                  {r}{locked && ' (always)'}
                </label>
              );
            })}
          </div>
        </section>
      )}

      {/* ── History ── */}
      {history.length > 0 && (
        <section class="hrfin-card">
          <div class="hrfin-card-head"><h2>Change history</h2></div>
          <div>
            {history.map((h: PayrollSodPolicy) => (
              <div key={h.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12.5 }}>
                <strong style={{ minWidth: 72 }}>{h.sodLevel}-person</strong>
                <span style={{ color: 'var(--muted)', flex: 1 }}>{h.reason ?? '—'}</span>
                <span style={{ color: 'var(--muted)', fontSize: 11.5 }}>
                  {h.effectiveAt ? new Date(h.effectiveAt).toLocaleDateString('en-GB') : ''}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Reads the same query as this panel, so approving a level change redraws
          the chain (separation badges + required headcount) on the next render. */}
      {chainOpen && (
        <SodChainDialog chain={q.data!.chain} level={activeLevel} onClose={() => setChainOpen(false)} />
      )}

      {wizardOpen && (
        <SodChangeWizard
          activeLevel={activeLevel}
          feasibility={q.data!.feasibility}
          busy={proposeMut.isPending}
          onSubmit={(sodLevel, reason) => proposeMut.mutate({ sodLevel, reason })}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </div>
  );
}
