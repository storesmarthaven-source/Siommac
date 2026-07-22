/**
 * src/components/sections/Finance/payRunDetail/panels.tsx
 *
 * The eight run-workspace tab panels (exact-mockup markup, scoped `.prw`), each
 * wired to a real endpoint — no fabricated data. Read/review panels (Summary,
 * Population, Reconciliation, Approvals, Audit) are new mockup markup; the
 * interactive panels (Inputs, Exceptions, Release) reuse the moved drawer tab
 * bodies from ./interactiveTabs. F-02 policy evidence lives in the Inputs panel
 * + chips in the header/summary.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { useQuery } from '@tanstack/preact-query';
import {
  useRunLines, useCalculationVersions, useCalculationComparison, usePolicyEvidence,
  useRunAuditLog, financePayrollApi,
  type PayrollRun, type PayrollRunWorkspace, type PayrollReleasePreflight,
  type PayrollControlFinding, type PayrollInputSnapshotInfo, type PolicyEvidence,
} from '@api/finance/payroll';
import { useWorkflow } from '@api/workflows';
import { useEmployeeNames } from '@api/finance/lookups';
import { fmtMoney, humanize } from '../financeShared';
import { EmployeeCell, EmployeeCellResolved } from '../_shared/EmployeeCell';
import { InputsTab, WorksheetTab, WarningsTab, PayslipsTab, GlTab, ExportsTab, fmtDateTime, type PayRunDrawerActions } from './interactiveTabs';
import { PayCreateDisbursementDialog, PayCreateRemittanceDialog } from '../PayBridgeDialog';
import { CloseReleaseCard } from './CloseReleaseCard';
import { initials, dayLabel } from './parts';

// ── shared atoms ────────────────────────────────────────────────────────────────

function Pill({ intent, children }: { intent: 'green' | 'amber' | 'red' | 'grey' | 'blue'; children: ComponentChildren }): VNode {
  return <span class={`pill ${intent}`}>{children}</span>;
}

function SecHead({ ico, title, sub, aux }: { ico: string; title: string; sub?: string; aux?: VNode | string }): VNode {
  return (
    <div class="sec-head">
      <div class="sec-ico">{ico}</div>
      <div><div class="sec-title">{title}</div>{sub && <div class="sec-sub">{sub}</div>}</div>
      {aux != null && <div class="aux">{aux}</div>}
    </div>
  );
}

function Empty({ children }: { children: ComponentChildren }): VNode {
  return <div class="prw-empty">{children}</div>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════════

interface Gate { label: string; intent: 'green' | 'amber' | 'red' | 'grey'; result: string; evidence: string; }

function deriveGates(workspace: PayrollRunWorkspace | undefined, preflight: PayrollReleasePreflight | undefined): Gate[] {
  const snap = workspace?.inputSnapshot ?? null;
  const calc = workspace?.currentCalculationVersion ?? null;
  const blockers = workspace?.findingSummary.blockers ?? 0;
  return [
    { label: 'Input snapshot complete',
      intent: snap ? 'green' : 'grey',
      result: snap ? 'Passed' : 'Pending',
      evidence: snap ? `Snapshot v${snap.snapshotNo} · checksum ${snap.checksum.slice(0, 8)}…` : 'Lock inputs to snapshot' },
    { label: 'Calculation current',
      intent: calc ? 'green' : 'grey',
      result: calc ? 'Passed' : 'Pending',
      evidence: calc ? `Version ${calc.versionNo} · ${calc.employeeCount} employees` : 'Run Calculate' },
    { label: 'Findings clear',
      intent: blockers === 0 ? 'green' : 'red',
      result: blockers === 0 ? 'Passed' : 'Blocked',
      evidence: blockers === 0 ? 'No open blocking findings' : `${blockers} blocking finding${blockers === 1 ? '' : 's'} open` },
    { label: 'Bank accounts ready',
      intent: (preflight?.missingBankAccountCount ?? 0) === 0 ? 'green' : 'red',
      result: (preflight?.missingBankAccountCount ?? 0) === 0 ? 'Passed' : 'Blocked',
      evidence: (preflight?.missingBankAccountCount ?? 0) === 0 ? 'All payees have a primary account' : `${preflight?.missingBankAccountCount} missing bank account(s)` },
    { label: 'Approval certified',
      intent: preflight?.certificationId ? 'green' : 'grey',
      result: preflight?.certificationId ? 'Certified' : 'Pending',
      evidence: preflight?.certificationId ? 'Control certification recorded' : 'Certified at submission' },
    { label: 'Funding confirmed',
      intent: preflight?.fundingConfirmationId ? 'green' : 'grey',
      result: preflight?.fundingConfirmationId ? 'Confirmed' : 'Pending',
      evidence: preflight?.fundingConfirmationId ? 'Treasury confirmed funding' : 'Confirmed before release' },
    { label: 'Journal posted',
      intent: preflight?.glJournalId ? 'green' : 'grey',
      result: preflight?.glJournalId ? 'Posted' : 'Pending',
      evidence: preflight?.glJournalId ? 'GL journal posted' : 'Posted after approval' },
  ];
}

export function SummaryPanel({ run, workspace, preflight }: {
  run: PayrollRun; workspace: PayrollRunWorkspace | undefined; preflight: PayrollReleasePreflight | undefined;
}): VNode {
  const gates = deriveGates(workspace, preflight);
  const passed = gates.filter(g => g.intent === 'green').length;
  const findings = workspace?.priorityFindings ?? [];
  const audit = workspace?.audit ?? [];
  const employerCost = run.grossTotal + run.nisEmployerTotal;

  return (
    <div class="section-grid">
      <div class="stack">
        <section class="card">
          <SecHead ico="✓" title="Control certification" sub="Evidence required before the payroll can enter approval."
            aux={<Pill intent={passed === gates.length ? 'green' : 'amber'}>{passed} of {gates.length} passed</Pill>} />
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Control</th><th>Result</th><th>Evidence</th></tr></thead>
              <tbody>
                {gates.map(g => (
                  <tr key={g.label}>
                    <td><strong>{g.label}</strong></td>
                    <td><Pill intent={g.intent}>{g.result}</Pill></td>
                    <td>{g.evidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section class="card">
          <SecHead ico="!" title="Exceptions & findings" sub="Open control findings prioritised by severity."
            aux={<Pill intent={(workspace?.findingSummary.blockers ?? 0) > 0 ? 'red' : (workspace?.findingSummary.warnings ?? 0) > 0 ? 'amber' : 'green'}>
              {workspace?.findingSummary.actionable ?? 0} actionable</Pill>} />
          {findings.length === 0
            ? <Empty>No open findings for this run.</Empty>
            : (
              <div class="attention-list">
                {findings.slice(0, 6).map(f => (
                  <div class="attention-row" key={f.id}>
                    <span class={`signal ${f.severity === 'blocker' ? 'red' : f.severity === 'warning' ? 'amber' : 'blue'}`} />
                    <div class="row-copy"><strong>{f.title}</strong><small>{f.detail}</small></div>
                    <span class="row-meta">{humanize(f.domain)}</span>
                  </div>
                ))}
              </div>
            )}
        </section>
      </div>

      <aside class="stack">
        <section class="card">
          <SecHead ico="$" title="Financial summary" />
          <div class="fin">
            <div class="fin-row"><span class="k">Gross payroll</span><span class="v">{fmtMoney(run.grossTotal)}</span></div>
            <div class="fin-row"><span class="k">Total deductions</span><span class="v">{fmtMoney(run.deductionTotal)}</span></div>
            <div class="fin-row total"><span class="k">Net payroll</span><span class="v">{fmtMoney(run.netTotal)}</span></div>
            <div class="fin-mini"><span>Employer NIS</span><span class="v">{fmtMoney(run.nisEmployerTotal)}</span></div>
            <div class="fin-mini"><span>Employer cost</span><span class="v">{fmtMoney(employerCost)}</span></div>
          </div>
        </section>

        <section class="card">
          <SecHead ico="↻" title="Recent activity" />
          {audit.length === 0
            ? <Empty>No activity recorded yet.</Empty>
            : audit.slice(0, 6).map(a => (
              <div class="act-row" key={a.id}>
                <div class={`act-dot ${a.action.includes('reject') || a.action.includes('fail') ? 'red' : a.action.includes('lock') || a.action.includes('release') ? 'green' : 'blue'}`}>•</div>
                <div><div class="act-t">{humanize(a.action)}</div><div class="act-s">{a.actorId ? <EmployeeCell employeeId={a.actorId} /> : 'System'}{a.reason ? ` · ${a.reason}` : ''}</div></div>
                <div class="act-m">{fmtDateTime(a.createdAt)}</div>
              </div>
            ))}
        </section>
      </aside>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Population
// ═══════════════════════════════════════════════════════════════════════════════

interface VariationRow { employee_id: string; status: string; net?: number; net_delta?: number; gross?: number; }

export function PopulationPanel({ runId }: { runId: string }): VNode {
  const { data: lines, isLoading } = useRunLines(runId);
  const variationQ = useQuery({
    queryKey: ['finance', 'payroll', 'report', 'variation', runId],
    queryFn:  () => financePayrollApi.runReport({ report: 'variation', params: { runId } }),
    enabled:  !!runId,
    retry:    false,
  });
  const ids = (lines ?? []).map(l => l.employeeId);
  const { data: nameMap } = useEmployeeNames(ids);

  const varByEmp = new Map<string, VariationRow>();
  const rows = (variationQ.data?.rows ?? []) as unknown as VariationRow[];
  for (const r of rows) if (r.employee_id) varByEmp.set(r.employee_id, r);

  if (isLoading) return <section class="card"><SecHead ico="P" title="Calculated employee population" /><Empty>Loading population…</Empty></section>;
  if (!lines || lines.length === 0) return <section class="card"><SecHead ico="P" title="Calculated employee population" /><Empty>No calculated lines yet — run Calculate first.</Empty></section>;

  return (
    <section class="card">
      <SecHead ico="P" title="Calculated employee population" sub={`${lines.length} employees${variationQ.data ? ' · net variance vs prior period' : ''}.`} />
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th class="num">Gross</th>
              <th class="num">Net</th>
              <th class="num">Net variance</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(l => {
              const v = varByEmp.get(l.employeeId);
              const delta = v?.net_delta;
              const pct = delta != null && v?.net != null && (v.net - delta) !== 0
                ? (delta / (v.net - delta)) * 100 : null;
              return (
                <tr key={l.id}>
                  <td><EmployeeCellResolved resolved={nameMap?.get(l.employeeId)} fallbackId={l.employeeId} /></td>
                  <td class="num">{fmtMoney(l.gross)}</td>
                  <td class="num">{fmtMoney(l.net)}</td>
                  <td class={`num ${pct == null ? '' : pct >= 0 ? 'delta-up' : 'delta-down'}`}>
                    {v == null ? '—' : v.status === 'added' ? 'New' : delta == null ? '—' : `${delta >= 0 ? '+' : ''}${fmtMoney(delta)}`}
                  </td>
                  <td>{v == null ? <Pill intent="grey">No prior</Pill> : v.status === 'added' ? <Pill intent="blue">New hire</Pill> : v.status === 'changed' ? <Pill intent="amber">Changed</Pill> : <Pill intent="green">Unchanged</Pill>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {variationQ.isError && <div class="prw-empty" style={{ padding: '10px 22px' }}>Prior-period comparison unavailable (no earlier run).</div>}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Reconciliation
// ═══════════════════════════════════════════════════════════════════════════════

export function ReconciliationPanel({ runId }: { runId: string }): VNode {
  const { data: versions, isLoading } = useCalculationVersions(runId);
  const sorted = [...(versions ?? [])].sort((a, b) => a.versionNo - b.versionNo);
  const latest = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];
  const cmp = useCalculationComparison(prev?.id ?? null, latest?.id ?? null);

  if (isLoading) return <section class="card"><SecHead ico="R" title="Payroll reconciliation" /><Empty>Loading calculation versions…</Empty></section>;
  if (!versions || versions.length === 0) return <section class="card"><SecHead ico="R" title="Payroll reconciliation" /><Empty>No calculation versions yet — run Calculate first.</Empty></section>;

  return (
    <div class="section-grid">
      <section class="card">
        <SecHead ico="R" title="Payroll reconciliation" sub="Calculation version history and version-over-version movement."
          aux={<Pill intent="grey">{versions.length} version{versions.length === 1 ? '' : 's'}</Pill>} />
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Version</th><th class="num">Employees</th><th class="num">Gross</th><th class="num">Net</th><th class="num">Employer NIS</th><th>Published</th></tr></thead>
            <tbody>
              {sorted.slice().reverse().map(v => (
                <tr key={v.id}>
                  <td><strong>v{v.versionNo}</strong></td>
                  <td class="num">{v.employeeCount}</td>
                  <td class="num">{fmtMoney(v.grossTotal)}</td>
                  <td class="num">{fmtMoney(v.netTotal)}</td>
                  <td class="num">{fmtMoney(v.nisEmployerTotal)}</td>
                  <td>{dayLabel(v.publishedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <aside class="stack">
        <section class="card">
          <SecHead ico="Δ" title="Latest movement" sub={prev && latest ? `v${prev.versionNo} → v${latest.versionNo}` : 'Single version'} />
          {!prev || !latest
            ? <Empty>Only one calculation version — nothing to compare.</Empty>
            : cmp.isLoading
              ? <Empty>Comparing…</Empty>
              : cmp.data
                ? (
                  <div class="fin">
                    <div class="fin-row"><span class="k">Gross delta</span><span class="v">{fmtMoney(cmp.data.totals.grossDelta)}</span></div>
                    <div class="fin-row"><span class="k">Net delta</span><span class="v">{fmtMoney(cmp.data.totals.netDelta)}</span></div>
                    <div class="fin-row"><span class="k">Employer NIS delta</span><span class="v">{fmtMoney(cmp.data.totals.nisEmployerDelta)}</span></div>
                    <div class="fin-row"><span class="k">Employees changed</span><span class="v">{cmp.data.changedEmployees}</span></div>
                    <div class="fin-row total"><span class="k">Added / removed</span><span class="v">+{cmp.data.addedEmployees} / −{cmp.data.removedEmployees}</span></div>
                  </div>
                )
                : <Empty>Comparison unavailable.</Empty>}
        </section>
      </aside>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Approvals
// ═══════════════════════════════════════════════════════════════════════════════

export function ApprovalsPanel({ run }: { run: PayrollRun }): VNode {
  const wf = useWorkflow(run.workflowId ?? '');
  const tasks = wf.data?.tasks ?? [];
  const actorIds = tasks.map(t => t.assigned_user_id).filter((x): x is string => !!x);
  const { data: nameMap } = useEmployeeNames(actorIds);

  if (!run.workflowId) {
    return (
      <section class="card">
        <SecHead ico="A" title="Approval route" sub="Sequential maker-checker route starts after all submission controls pass."
          aux={<Pill intent="grey">Not submitted</Pill>} />
        <Empty>This run has not been submitted for approval yet. The route appears once it is submitted.</Empty>
      </section>
    );
  }

  function decisionChip(status: string, decision: string | null): VNode {
    if (decision === 'approved') return <span class="chip ok">Approved</span>;
    if (decision === 'rejected' || decision === 'returned') return <span class="chip aw">Returned</span>;
    if (status === 'completed') return <span class="chip ok">Complete</span>;
    return <span class="chip wt">Waiting</span>;
  }

  return (
    <section class="card">
      <SecHead ico="A" title="Approval route" sub="Sequential maker-checker route — creator cannot approve their own run."
        aux={<Pill intent={run.status === 'approved' ? 'green' : run.status === 'returned' ? 'red' : 'amber'}>{humanize(run.status)}</Pill>} />
      {wf.isLoading
        ? <Empty>Loading approval route…</Empty>
        : tasks.length === 0
          ? <Empty>No approval steps recorded.</Empty>
          : (
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>Step</th><th>Approver</th><th>Role</th><th>Decision</th><th>When</th></tr></thead>
                <tbody>
                  {tasks.map((t, i) => (
                    <tr key={t.id}>
                      <td><span class={`stepn ${t.decision === 'approved' ? 'g' : t.status === 'completed' ? 'g' : i === 0 ? 'a' : 'gr'}`}>{i + 1}</span></td>
                      <td>
                        <div class="appr-person">
                          <span class={`appr-av ${i % 3 === 0 ? 'b' : i % 3 === 1 ? 't' : 'v'}`}>{initials(t.assigned_user_id ? nameMap?.get(t.assigned_user_id)?.fullName : null, '?')}</span>
                          <div>
                            <div class="nm">{t.assigned_user_id ? (nameMap?.get(t.assigned_user_id)?.fullName ?? <EmployeeCell employeeId={t.assigned_user_id} />) : (t.assigned_role ? humanize(t.assigned_role) : 'Unassigned')}</div>
                            <div class="rl">{humanize(t.step_key)}</div>
                          </div>
                        </div>
                      </td>
                      <td>{t.assigned_role ? humanize(t.assigned_role) : '—'}</td>
                      <td>{decisionChip(t.status, t.decision)}</td>
                      <td>{t.completed_at ? fmtDateTime(t.completed_at) : t.due_at ? `Due ${dayLabel(t.due_at)}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Audit
// ═══════════════════════════════════════════════════════════════════════════════

export function AuditPanel({ runId }: { runId: string }): VNode {
  const { data: entries, isLoading } = useRunAuditLog(runId);
  return (
    <section class="card">
      <SecHead ico="A" title="Audit history" sub="Immutable record of state changes, calculation attempts, control decisions and exports."
        aux={<Pill intent="grey">{entries?.length ?? 0} events</Pill>} />
      <div class="panel-body">
        {isLoading
          ? <Empty>Loading audit log…</Empty>
          : !entries || entries.length === 0
            ? <Empty>No audit events recorded for this run yet.</Empty>
            : entries.map(e => (
              <div class="audit-row" key={e.id}>
                <span class="when">{fmtDateTime(e.createdAt)}</span>
                <strong>{e.actorId ? <EmployeeCell employeeId={e.actorId} /> : 'System'}</strong>
                <span>{humanize(e.action)}{e.reason ? ` — ${e.reason}` : ''}</span>
                <span class="code">{e.action.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 18)}</span>
              </div>
            ))}
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Inputs (snapshot + worksheet + F-02 policy evidence)
// ═══════════════════════════════════════════════════════════════════════════════

export function InputsPanel({ run, canManage, inputSnapshot }: {
  run: PayrollRun; canManage: boolean; inputSnapshot: PayrollInputSnapshotInfo | null | undefined;
}): VNode {
  const ev = usePolicyEvidence(run.currentInputSnapshotId ? run.id : null);
  return (
    <div class="stack">
      <section class="card">
        <SecHead ico="I" title="Frozen input snapshot"
          sub={inputSnapshot ? `Snapshot v${inputSnapshot.snapshotNo} · locked ${fmtDateTime(inputSnapshot.lockedAt)} · checksum ${inputSnapshot.checksum.slice(0, 8)}…` : 'Inputs not locked yet.'}
          aux={inputSnapshot ? <Pill intent="green">{inputSnapshot.employeeCount} employees</Pill> : <Pill intent="grey">Draft</Pill>} />
        <div class="panel-body">
          <InputsTab runId={run.id} runStatus={run.status} canManage={canManage} />
        </div>
      </section>

      {ev.data && <PolicyEvidencePanel evidence={ev.data} />}

      <section class="card">
        <SecHead ico="W" title="Worksheet adjustments" sub="Per-employee earnings / deductions, mass-edit and back pay (pre-approval only)." />
        <div class="panel-body">
          <WorksheetTab runId={run.id} runStatus={run.status} />
        </div>
      </section>
    </div>
  );
}

export function PolicyEvidencePanel({ evidence }: { evidence: PolicyEvidence }): VNode {
  const cal = evidence.calendar;
  return (
    <section class="card">
      <SecHead ico="§" title="Pay-policy evidence" sub="The governed pay policy pinned to this run's input snapshot."
        aux={evidence.checksum ? <span class="evchip"><span class="k">checksum</span><code>{evidence.checksum.slice(0, 12)}</code></span> : undefined} />
      <div class="panel-body">
        {evidence.components.length > 0 && (
          <>
            <div class="sec-sub" style={{ marginBottom: 6 }}>Components ({evidence.components.length})</div>
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>Component</th><th>Basis</th><th>Rate source</th><th>Required</th></tr></thead>
                <tbody>
                  {evidence.components.map(c => (
                    <tr key={c.componentId}>
                      <td><strong>{c.componentCode ?? c.componentId.slice(0, 8)}</strong></td>
                      <td>{humanize(c.calculationBasis ?? '—')}</td>
                      <td>{humanize(c.rateSource ?? '—')}</td>
                      <td>{c.isRequired ? <Pill intent="blue">Required</Pill> : <Pill intent="grey">Optional</Pill>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {evidence.sourceRules.length > 0 && (
          <>
            <div class="sec-sub" style={{ margin: '14px 0 6px' }}>Source rules ({evidence.sourceRules.length})</div>
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>Source</th><th>Owner</th><th>Required</th><th>Conflict outcome</th></tr></thead>
                <tbody>
                  {evidence.sourceRules.map(r => (
                    <tr key={r.sourceType}>
                      <td><strong>{humanize(r.sourceType)}</strong></td>
                      <td>{r.ownerRole ? humanize(r.ownerRole) : '—'}</td>
                      <td>{r.required ? 'Yes' : 'No'}</td>
                      <td>{r.conflictOutcome ? humanize(r.conflictOutcome) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {evidence.sourceConflicts.length > 0 && (
          <div class="attention-list" style={{ marginTop: 12 }}>
            {evidence.sourceConflicts.map((c, i) => (
              <div class="attention-row" key={i}>
                <span class="signal amber" />
                <div class="row-copy"><strong>{humanize(c.sourceType)} — {humanize(c.conflictOutcome)}</strong><small>Employee {c.employeeId}</small></div>
                <span class="row-meta">{humanize(c.reasonCode)}</span>
              </div>
            ))}
          </div>
        )}

        {evidence.excludedEmployees.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <span class="pill red">{evidence.excludedEmployees.length} employee(s) excluded from calculation</span>
          </div>
        )}

        {cal && (
          <>
            <div class="sec-sub" style={{ margin: '16px 0 6px' }}>
              Working-days calendar — {cal.workCalendarName ?? '—'} (v{cal.workCalendarVersionNo ?? '?'}) · holidays {cal.holidayCalendarName ?? '—'}
              {cal.holidayChecksumShort ? ` · ${cal.holidayChecksumShort}` : ''} · period denominator {cal.periodDenominator ?? '—'}
            </div>
            {cal.employees.length > 0 && (
              <div class="table-wrap">
                <table class="data-table">
                  <thead><tr><th>Employee</th><th class="num">Working days</th><th class="num">Period days</th><th class="num">Excluded</th></tr></thead>
                  <tbody>
                    {cal.employees.map(e => (
                      <tr key={e.employeeId}>
                        <td>{e.employeeName}</td>
                        <td class="num">{e.numerator}</td>
                        <td class="num">{e.denominator}</td>
                        <td class="num">{e.excludedCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Exceptions
// ═══════════════════════════════════════════════════════════════════════════════

export function ExceptionsPanel({ run, workspace, canManage }: {
  run: PayrollRun; workspace: PayrollRunWorkspace | undefined; canManage: boolean;
}): VNode {
  const findings = workspace?.priorityFindings ?? [];
  const blockers = findings.filter((f: PayrollControlFinding) => f.severity === 'blocker');
  return (
    <div class="section-grid">
      <section class="card">
        <SecHead ico="!" title="Blocking exceptions" sub="The run cannot be submitted while any blocker remains open."
          aux={<Pill intent={blockers.length > 0 ? 'red' : 'green'}>{blockers.length} open</Pill>} />
        {findings.length === 0
          ? <Empty>No control findings for this run.</Empty>
          : (
            <div class="attention-list">
              {findings.map(f => (
                <div class="attention-row" key={f.id}>
                  <div class={`readiness-count ${f.severity === 'blocker' ? 'bad' : f.severity === 'warning' ? 'warn' : 'ok'}`}>{f.severity === 'blocker' ? '!' : f.severity === 'warning' ? '·' : 'i'}</div>
                  <div class="row-copy"><strong>{f.title}</strong><small>{f.detail}</small></div>
                  <span class="row-meta">{humanize(f.domain)}{f.state !== 'open' ? ` · ${humanize(f.state)}` : ''}</span>
                </div>
              ))}
            </div>
          )}
      </section>

      <aside class="stack">
        <section class="card">
          <SecHead ico="⚠" title="Calculation warnings" sub="NIS / statutory input warnings raised at calculation." />
          <div class="panel-body">
            <WarningsTab runId={run.id} canManage={canManage} />
          </div>
        </section>
      </aside>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Release & Accounting
// ═══════════════════════════════════════════════════════════════════════════════

export function ReleasePanel({ run, preflight, canManage, actions }: {
  run: PayrollRun; preflight: PayrollReleasePreflight | undefined; canManage: boolean; actions: PayRunDrawerActions;
}): VNode {
  const [bridge, setBridge] = useState<null | 'disb' | 'rem'>(null);
  const locked = run.status === 'locked' || run.status === 'exported' || run.status === 'released';
  const pf = preflight;

  const items: { intent: 'green' | 'amber' | 'red' | 'grey'; state: string; title: string; body: string; action?: VNode }[] = [
    { intent: pf?.disbursementId ? 'green' : locked ? 'amber' : 'grey', state: pf?.disbursementId ? 'Created' : locked ? 'Ready' : 'Locked',
      title: 'Bank disbursement', body: 'Create the bank file from eligible net-pay lines and reconcile the control total.',
      action: canManage && locked ? <button class="btn sm primary" type="button" onClick={() => setBridge('disb')}>Create / open</button> : <button class="btn sm" type="button" disabled>Prepare file</button> },
    { intent: (pf?.missingBankAccountCount ?? 0) > 0 ? 'red' : pf?.fundingConfirmationId ? 'green' : 'grey',
      state: pf?.fundingConfirmationId ? 'Confirmed' : (pf?.missingBankAccountCount ?? 0) > 0 ? 'Blocked' : 'Pending',
      title: 'Payroll funding', body: pf ? `Net disbursement ${fmtMoney(pf.netPayroll)}. Treasury confirmation required before release.` : 'Funding confirmation required before release.' },
    { intent: pf?.glJournalId ? 'green' : (pf?.invalidGlAccountCount ?? 0) > 0 ? 'red' : 'grey',
      state: pf?.glJournalId ? 'Posted' : (pf?.invalidGlAccountCount ?? 0) > 0 ? 'Blocked' : 'Locked',
      title: 'General ledger', body: 'Post a balanced journal using the approved payroll GL mappings and dimensions. See the GL card below.' },
    { intent: (pf?.renderedPayslipCount ?? 0) > 0 ? 'green' : 'grey', state: pf ? `${pf.renderedPayslipCount}/${pf.payslipCount}` : 'Locked',
      title: 'Payslips', body: 'Render and distribute password-protected employee payslips. See the payslips card below.',
      action: canManage && locked ? <button class="btn sm" type="button" onClick={() => actions.onGenPayslips(run)}>Generate</button> : undefined },
    { intent: 'grey', state: locked ? 'Ready' : 'Locked', title: 'Statutory remittances', body: 'Create PAYE, NIS and Health Surcharge remittance records.',
      action: canManage && locked ? <button class="btn sm" type="button" onClick={() => setBridge('rem')}>Create</button> : <button class="btn sm" type="button" disabled>Create records</button> },
    { intent: pf?.alreadyReleased ? 'green' : 'grey', state: pf?.alreadyReleased ? 'Released' : 'Locked', title: 'Release certificate',
      body: 'Capture output checksums, totals, actors and the release timestamp.',
      action: canManage && run.status === 'locked' ? <button class="btn sm" type="button" onClick={() => actions.onExport(run)}>Export run</button> : undefined },
  ];

  return (
    <div class="stack">
      {/* F-08 — governed close-out: close controls, attestation-gated release certificate, correction boundary */}
      <CloseReleaseCard run={run} preflight={preflight} />

      <div class="section-grid">
        <section class="card">
          <SecHead ico="L" title="Release and accounting outputs" sub="Available from the approved and locked calculation version."
            aux={<Pill intent={pf?.ready ? 'green' : locked ? 'amber' : 'grey'}>{pf?.alreadyReleased ? 'Released' : pf?.ready ? 'Ready' : locked ? 'In progress' : 'Awaiting approval'}</Pill>} />
          <div class="release-grid">
            {items.map(it => (
              <div class="release-item" key={it.title}>
                <span class={`pill ${it.intent}`}>{it.state}</span>
                <h3>{it.title}</h3>
                <p>{it.body}</p>
                {it.action}
              </div>
            ))}
          </div>
        </section>

        <aside class="stack">
          <section class="card">
            <SecHead ico="$" title="Funding forecast" />
            <div class="fin">
              <div class="fin-row"><span class="k">Expected net disbursement</span><span class="v">{fmtMoney(pf?.netPayroll ?? run.netTotal)}</span></div>
              <div class="fin-row"><span class="k">GL debit / credit</span><span class="v">{fmtMoney(pf?.glDebit ?? 0)} / {fmtMoney(pf?.glCredit ?? 0)}</span></div>
              <div class="fin-row total"><span class="k">Missing bank accounts</span><span class="v" style={{ color: (pf?.missingBankAccountCount ?? 0) > 0 ? 'var(--red)' : undefined }}>{pf?.missingBankAccountCount ?? 0}</span></div>
            </div>
          </section>
        </aside>
      </div>

      <section class="card">
        <SecHead ico="G" title="General ledger" sub="Balanced journal preview and posting." />
        <div class="panel-body"><GlTab runId={run.id} runStatus={run.status} /></div>
      </section>

      <section class="card">
        <SecHead ico="P" title="Payslips" sub="Render, download and distribute employee payslips." />
        <div class="panel-body"><PayslipsTab run={run} canManage={canManage} /></div>
      </section>

      <section class="card">
        <SecHead ico="E" title="Bank & statutory exports" sub="Generated export files for this run." />
        <div class="panel-body"><ExportsTab runId={run.id} canExport={canManage} /></div>
      </section>

      {bridge === 'disb' && <PayCreateDisbursementDialog run={run} onClose={() => setBridge(null)} onCreated={() => setBridge(null)} />}
      {bridge === 'rem' && <PayCreateRemittanceDialog run={run} onClose={() => setBridge(null)} onCreated={() => setBridge(null)} />}
    </div>
  );
}
