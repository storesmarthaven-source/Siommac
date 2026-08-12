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
import { Badge, Button, type BadgeTone } from '@ui';
import { RunPanel } from './parts';

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
      <RunPanel
        ico="R"
        title="Root-cause diagnosis"
        sub="Fix these at the source, then retry — payroll never overrides a failed control."
        aux={<Badge tone={blockers.length > 0 ? 'danger' : 'success'}>{blockers.length} blocking record{blockers.length === 1 ? '' : 's'}</Badge>}
        style={{ marginTop: 16 }}
        flush
      >
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
                    <td><Badge tone={f.state === 'in_progress' ? 'warning' : 'danger'}>{humanize(f.state)}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div class="prw-empty">No blocking findings were recorded for this attempt — see the diagnostic detail below for the failure cause.</div>
        )}
      </RunPanel>

      {/* controlled recovery — derived from the real blocker state */}
      <RunPanel
        ico="1"
        title="Controlled recovery"
        sub="Retry is enabled only when every blocking control passes against refreshed source data."
        style={{ marginTop: 16 }}
        flush
      >
        <div>
          <RecoveryStep n={1} title="Correct the authoritative source records"
            detail="Update and approve the effective records in their owning module — do not override the failure in payroll."
            pill={clear ? { tone: 'success', label: 'Done' } : { tone: 'warning', label: 'Action needed' }} />
          <RecoveryStep n={2} title="Refresh and re-check source readiness"
            detail="Re-validate the inputs so the retry runs against corrected data."
            pill={{ tone: 'neutral', label: 'Manual' }} />
          <RecoveryStep n={3} title="Retain snapshot + failed attempt as evidence"
            detail="The failed attempt and its input snapshot stay immutable for audit; the retry creates the next attempt."
            pill={{ tone: 'neutral', label: 'Automatic' }} />
          <RecoveryStep n={4} title="Retry as the next calculation attempt"
            detail="Uses an idempotent job key and commits a new result version only after every employee completes."
            pill={clear ? { tone: 'success', label: 'Ready' } : { tone: 'danger', label: 'Blocked' }} />
        </div>
      </RunPanel>

      {/* diagnostic detail — support-safe technical evidence */}
      {attempt && (
        <RunPanel
          ico="D"
          title="Diagnostic detail"
          sub="Support-safe technical evidence — employee pay amounts are excluded."
          aux={<Button variant="secondary" onClick={copyCorrelation}>{copied ? 'Copied ✓' : 'Copy correlation ID'}</Button>}
          style={{ marginTop: 16 }}
        >
            <div class="failure-code">{[
              attempt.errorCode ?? 'PAYROLL_CALCULATION_FAILED',
              `attempt_id: ${attempt.id}`,
              `attempt_no: ${attempt.attemptNo}`,
              `failed_stage: ${attempt.stage}`,
              `correlation_id: ${attempt.correlationId}`,
              ...(attempt.errorMessage ? ['', attempt.errorMessage] : []),
            ].join('\n')}</div>
        </RunPanel>
      )}

      {/* recent activity */}
      <RunPanel title="Recent activity" style={{ marginTop: 16 }} flush>
        {activity.length > 0 ? activity.map(a => (
          <div class="act-row" key={a.id}>
            <div class={`act-dot ${a.action.includes('fail') || a.action.includes('reject') ? 'red' : a.action.includes('lock') || a.action.includes('release') ? 'green' : 'blue'}`}>•</div>
            <div><div class="act-t">{humanize(a.action)}</div><div class="act-s">{a.actorId ? <EmployeeCell employeeId={a.actorId} /> : 'System'}{a.reason ? ` · ${a.reason}` : ''}</div></div>
            <div class="act-m">{fmtDateTime(a.createdAt)}</div>
          </div>
        )) : <div class="prw-empty">No recent activity recorded for this run.</div>}
      </RunPanel>
    </div>
  );
}

function RecoveryStep({ n, title, detail, pill }: {
  n: number; title: string; detail: string; pill: { tone: BadgeTone; label: string };
}): VNode {
  return (
    <div class="recovery-step">
      <div class="n">{n}</div>
      <div><strong>{title}</strong><small>{detail}</small></div>
      <Badge tone={pill.tone}>{pill.label}</Badge>
    </div>
  );
}
