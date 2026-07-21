/**
 * src/components/sections/Finance/payRunDetail/CalcFailurePanel.tsx
 *
 * F-05 Calculation-Failure Recovery — the failed-state body of the run workspace
 * (rendered by PayRunDetailPage in place of the normal tabs when
 * run.status === 'calculation_failed'). Faithful to mockups/payroll-enterprise/
 * failed.html (scoped `.prw`) but wired ONLY to real workspace data:
 *   · attempt band + diagnostic code  → the latest FAILED calculation attempt
 *   · root-cause diagnosis            → blocker findings (priorityFindings)
 *   · controlled-recovery steps       → derived from the real blocker count
 *   · recent activity                 → workspace.audit
 * No fabricated fields: the mockup's "Component/Expected" columns have no backing
 * data, so the table maps to the finding fields that DO exist (Control/Problem/
 * Owner/State). The diagnostic block shows ONLY support-safe attempt fields
 * (error_code / error_message / stage / correlation_id) — `technical_detail` is
 * deliberately NOT exposed by the attempt API (raw stack trace; guarded by
 * financePayroll E2E). "Retry Calculation" is the run's real `calculate` command
 * (the RPC accepts a calculation_failed run — mig 421); there is no diagnostics-
 * export endpoint, so that mockup button is replaced by a real "Copy correlation ID".
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { type PayrollRunWorkspace, type PayrollCalculationAttempt } from '@api/finance/payroll';
import { humanize } from '../financeShared';
import { EmployeeCell } from '../_shared/EmployeeCell';
import { fmtDateTime } from './interactiveTabs';

function shortId(id: string | null | undefined): string {
  if (!id) return '—';
  return id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}

/** Pick the attempt that actually failed (highest attempt_no), else the latest attempt. */
function failedAttemptOf(attempts: PayrollCalculationAttempt[]): PayrollCalculationAttempt | null {
  const failed = attempts.filter(a => a.status === 'failed');
  const pool = failed.length > 0 ? failed : attempts;
  const first = pool[0];
  if (!first) return null;
  return pool.reduce((max, a) => (a.attemptNo > max.attemptNo ? a : max), first);
}

export function CalcFailurePanel({ workspace }: {
  workspace: PayrollRunWorkspace | undefined;
}): VNode {
  const attempts = workspace?.calculationAttempts ?? [];
  const attempt = failedAttemptOf(attempts);
  const blockers = (workspace?.priorityFindings ?? []).filter(
    f => f.severity === 'blocker' && (f.state === 'open' || f.state === 'in_progress'),
  );
  const activity = (workspace?.audit ?? []).slice(0, 6);
  const clear = blockers.length === 0;
  const [copied, setCopied] = useState(false);

  const copyCorrelation = (): void => {
    if (!attempt) return;
    // navigator.clipboard is typed non-null but is undefined in insecure contexts.
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (!clipboard) return;
    void clipboard.writeText(attempt.correlationId).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
      () => { /* clipboard write failed — no-op */ },
    );
  };

  return (
    <div class="run-panel on">
      {/* attempt band — immutable failure evidence */}
      {attempt && (
        <section class="attempt-band">
          <div class="attempt-title">
            <strong>Attempt {attempt.attemptNo} is immutable</strong>
            <small>Failure evidence is retained after a successful retry for audit and root-cause analysis.</small>
          </div>
          <div><div class="k">Started</div><div class="v">{fmtDateTime(attempt.startedAt)}</div></div>
          <div><div class="k">Failed</div><div class="v">{attempt.completedAt ? fmtDateTime(attempt.completedAt) : '—'}</div></div>
          <div><div class="k">Input snapshot</div><div class="v">{shortId(attempt.inputSnapshotId)}</div></div>
          <div><div class="k">Correlation ID</div><div class="v">{shortId(attempt.correlationId)}</div></div>
        </section>
      )}

      {/* root-cause diagnosis — blocker findings */}
      <section class="card" style={{ marginTop: 16 }}>
        <div class="sec-head">
          <div class="sec-ico">R</div>
          <div>
            <div class="sec-title">Root-cause diagnosis</div>
            <div class="sec-sub">Fix these at the source, then retry — payroll never overrides a failed control.</div>
          </div>
          <div class="aux"><span class={`pill ${blockers.length > 0 ? 'red' : 'green'}`}>{blockers.length} blocking record{blockers.length === 1 ? '' : 's'}</span></div>
        </div>
        {blockers.length > 0 ? (
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Employee</th><th>Control</th><th>Problem</th><th>Owner</th><th>State</th></tr></thead>
              <tbody>
                {blockers.map(f => (
                  <tr key={f.id}>
                    <td>{f.employeeId ? <EmployeeCell employeeId={f.employeeId} /> : <span class="muted">Run-level</span>}</td>
                    <td><strong>{humanize(f.domain)}</strong><small>{humanize(f.findingType)}</small></td>
                    <td><strong>{f.title}</strong>{f.detail && <small>{f.detail}</small>}</td>
                    <td>{f.assigneeId ? <EmployeeCell employeeId={f.assigneeId} /> : <span class="muted">{humanize(f.domain)} owner</span>}</td>
                    <td><span class={`pill ${f.state === 'in_progress' ? 'amber' : 'red'}`}>{humanize(f.state)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div class="panel-body"><div class="prw-empty">No blocking findings were recorded for this attempt — see the diagnostic detail below for the failure cause.</div></div>
        )}
      </section>

      {/* controlled recovery — derived from the real blocker state */}
      <section class="card" style={{ marginTop: 16 }}>
        <div class="sec-head">
          <div class="sec-ico">1</div>
          <div>
            <div class="sec-title">Controlled recovery</div>
            <div class="sec-sub">Retry is enabled only when every blocking control passes against refreshed source data.</div>
          </div>
        </div>
        <div>
          <RecoveryStep n={1} title="Correct the authoritative source records"
            detail="Update and approve the effective records in their owning module — do not override the failure in payroll."
            pill={clear ? { cls: 'green', label: 'Done' } : { cls: 'amber', label: 'Action needed' }} />
          <RecoveryStep n={2} title="Refresh and re-check source readiness"
            detail="Re-validate the inputs so the retry runs against corrected data."
            pill={{ cls: 'grey', label: 'Manual' }} />
          <RecoveryStep n={3} title="Retain snapshot + failed attempt as evidence"
            detail="The failed attempt and its input snapshot stay immutable for audit; the retry creates the next attempt."
            pill={{ cls: 'grey', label: 'Automatic' }} />
          <RecoveryStep n={4} title="Retry as the next calculation attempt"
            detail="Uses an idempotent job key and commits a new result version only after every employee completes."
            pill={clear ? { cls: 'green', label: 'Ready' } : { cls: 'red', label: 'Blocked' }} />
        </div>
      </section>

      {/* diagnostic detail — support-safe technical evidence */}
      {attempt && (
        <section class="card" style={{ marginTop: 16 }}>
          <div class="sec-head">
            <div class="sec-ico">D</div>
            <div>
              <div class="sec-title">Diagnostic detail</div>
              <div class="sec-sub">Support-safe technical evidence — employee pay amounts are excluded.</div>
            </div>
            <div class="aux"><button type="button" class="btn" onClick={copyCorrelation}>{copied ? 'Copied ✓' : 'Copy correlation ID'}</button></div>
          </div>
          <div class="panel-body">
            <div class="failure-code">{[
              attempt.errorCode ?? 'PAYROLL_CALCULATION_FAILED',
              `attempt_id: ${attempt.id}`,
              `attempt_no: ${attempt.attemptNo}`,
              `failed_stage: ${attempt.stage}`,
              `correlation_id: ${attempt.correlationId}`,
              ...(attempt.errorMessage ? ['', attempt.errorMessage] : []),
            ].join('\n')}</div>
          </div>
        </section>
      )}

      {/* recent activity */}
      <section class="card" style={{ marginTop: 16 }}>
        <div class="sec-head"><div class="sec-title">Recent activity</div></div>
        {activity.length > 0 ? activity.map(a => (
          <div class="act-row" key={a.id}>
            <div class={`act-dot ${a.action.includes('fail') || a.action.includes('reject') ? 'red' : a.action.includes('lock') || a.action.includes('release') ? 'green' : 'blue'}`}>•</div>
            <div><div class="act-t">{humanize(a.action)}</div><div class="act-s">{a.actorId ? <EmployeeCell employeeId={a.actorId} /> : 'System'}{a.reason ? ` · ${a.reason}` : ''}</div></div>
            <div class="act-m">{fmtDateTime(a.createdAt)}</div>
          </div>
        )) : <div class="panel-body"><div class="prw-empty">No recent activity recorded for this run.</div></div>}
      </section>
    </div>
  );
}

function RecoveryStep({ n, title, detail, pill }: {
  n: number; title: string; detail: string; pill: { cls: string; label: string };
}): VNode {
  return (
    <div class="recovery-step">
      <div class="n">{n}</div>
      <div><strong>{title}</strong><small>{detail}</small></div>
      <span class={`pill ${pill.cls}`}>{pill.label}</span>
    </div>
  );
}
