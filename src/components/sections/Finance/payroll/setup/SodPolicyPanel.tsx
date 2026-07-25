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

  const [level, setLevel] = useState<2 | 3 | 4 | null>(null);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [chainOpen, setChainOpen] = useState(false);

  const invalidate = (): void => { void qc.invalidateQueries({ queryKey: ['finance', 'payroll', 'sod-policy'] }); };

  const proposeMut = useMutation({
    mutationFn: () => financePayrollApi.proposeSodChange({ sodLevel: level!, reason: reason.trim() }),
    onSuccess: () => { toast('SoD change proposed — it needs a different approver.'); setLevel(null); setReason(''); setErrors({}); invalidate(); },
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

  const submitProposal = (): void => {
    const e: Record<string, string> = {};
    if (!level) e.level = 'Choose the level you want.';
    if (level && level === activeLevel) e.level = `The policy is already ${level}-person.`;
    if (reason.trim().length < 10) e.reason = 'Give a reason of at least 10 characters (this is audited).';
    setErrors(e);
    if (Object.keys(e).length === 0) proposeMut.mutate();
  };

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

      {/* ── Propose a change ── */}
      {canPropose && !pending && (
        <section class="hrfin-card">
          <div class="hrfin-card-head">
            <div>
              <h2>Propose a change</h2>
              <span>Proposing does not change anything on its own — another authorised approver must approve it.</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {LEVELS.map(l => (
                <label key={l.level} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12.5, cursor: l.level === activeLevel ? 'default' : 'pointer', opacity: l.level === activeLevel ? 0.6 : 1 }}>
                  <input type="radio" name="sod-level" checked={level === l.level} disabled={l.level === activeLevel}
                    onChange={() => setLevel(l.level)} style={{ marginTop: 3 }} />
                  <span>
                    <strong>{l.title}</strong>{l.level === activeLevel && ' — current'}
                    <br /><span style={{ color: 'var(--muted)' }}>{l.detail}</span>
                  </span>
                </label>
              ))}
              {errors.level && <small style={{ color: 'var(--danger)', fontSize: 11.5 }}>{errors.level}</small>}
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5 }}>
              <span>Reason <em style={{ fontStyle: 'normal', color: 'var(--muted)' }}>(audited)</em></span>
              <textarea class="hrfin-input" rows={2} style={{ height: 'auto', padding: '8px 12px' }} value={reason} maxLength={2000}
                placeholder="e.g. Finance team is three people; a fourth approver is not available."
                onInput={e => setReason((e.target as HTMLTextAreaElement).value)} />
              {errors.reason && <small style={{ color: 'var(--danger)', fontSize: 11.5 }}>{errors.reason}</small>}
            </label>
            <div>
              <button type="button" class="hrfin-action is-primary" disabled={proposeMut.isPending} onClick={submitProposal}>
                {proposeMut.isPending ? 'Submitting…' : 'Submit for approval'}
              </button>
            </div>
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
    </div>
  );
}
