/**
 * src/components/sections/Finance/PayRunDetailPage.tsx
 *
 * Full-page payroll run workspace — a faithful port of
 * mockups/payroll-enterprise/run.html (scoped `.prw`). Replaces the old
 * PayRunDrawer: breadcrumb + page-header (state-aware lifecycle actions) +
 * run header (with F-02 policy / calendar chips) + lifecycle stepper + metrics
 * strip + next-action banner + 8 page-level tabs, each wired to a real endpoint.
 *
 * Opened in place by PayrollCommandCenter (detailRunId → this page; onBack → register).
 */

import { type VNode, Fragment } from 'preact';
import { useState } from 'preact/hooks';
import './payrunWorkspace.css';
import {
  usePayrollRun, useRunWorkspace, useReleasePreflight,
  type PayrollRun,
} from '@api/finance/payroll';
import { humanize } from './financeShared';
import { EmployeeCell } from './_shared/EmployeeCell';
import { type PayRunDrawerActions } from './payRunDetail/interactiveTabs';
import {
  PolicyChip, CalendarChip, lifecycleSteps, statusIntent, runTitle,
  dayLabel, initials, fmtCompact, monthLabel,
} from './payRunDetail/parts';
import {
  SummaryPanel, PopulationPanel, ReconciliationPanel, ApprovalsPanel, AuditPanel,
  InputsPanel, ExceptionsPanel, ReleasePanel,
} from './payRunDetail/panels';

type TabKey = 'summary' | 'population' | 'inputs' | 'reconciliation' | 'exceptions' | 'approvals' | 'release' | 'audit';

const TAB_DEFS: { key: TabKey; label: string }[] = [
  { key: 'summary',        label: 'Summary' },
  { key: 'population',     label: 'Population' },
  { key: 'inputs',         label: 'Inputs' },
  { key: 'reconciliation', label: 'Reconciliation' },
  { key: 'exceptions',     label: 'Exceptions' },
  { key: 'approvals',      label: 'Approvals' },
  { key: 'release',        label: 'Release & Accounting' },
  { key: 'audit',          label: 'Audit' },
];

export function PayRunDetailPage({ runId, onBack, canManage, canApprove, actions }: {
  runId: string;
  onBack: () => void;
  canManage: boolean;
  canApprove: boolean;
  actions: PayRunDrawerActions;
}): VNode {
  const [tab, setTab] = useState<TabKey>('summary');
  const runQ = usePayrollRun(runId);
  const workspaceQ = useRunWorkspace(runId);
  const preflightQ = useReleasePreflight(runId);
  const run = runQ.data;
  const workspace = workspaceQ.data;
  const preflight = preflightQ.data;

  if (!run) {
    return (
      <div class="prw">
        <button type="button" class="back-link" onClick={onBack}>← Payroll runs</button>
        <div class="card"><div class="prw-empty">{runQ.isError ? 'Failed to load this run.' : 'Loading run…'}</div></div>
      </div>
    );
  }

  const steps = lifecycleSteps(run.status);
  const curIdx = Math.max(0, steps.findIndex(s => s.state === 'cur'));
  const curStage = steps.find(s => s.state === 'cur')?.label ?? steps[steps.length - 1]?.label ?? '—';
  const blockers = workspace?.findingSummary.blockers ?? preflight?.blockers.length ?? 0;
  const warnings = workspace?.findingSummary.warnings ?? 0;
  const deductionPct = run.grossTotal > 0 ? Math.round((run.deductionTotal / run.grossTotal) * 1000) / 10 : 0;

  return (
    <div class="prw">
      {/* breadcrumb + page header */}
      <div>
        <div class="crumbs">
          <a onClick={onBack}>Payroll</a><span class="sep">›</span>
          <a onClick={onBack}>Payroll runs</a><span class="sep">›</span>
          <b>{run.runNo}</b>
        </div>
        <div class="page-header">
          <div>
            <h1>{runTitle(run)}</h1>
            <div class="sub">{run.runNo} · statutory version pinned · {curStage} stage</div>
          </div>
          <div class="ha"><HeaderActions run={run} canManage={canManage} canApprove={canApprove} actions={actions} /></div>
        </div>
      </div>

      {/* run header card */}
      <section class="card runhead">
        <div class="rh-cell">
          <div class="rh-ico">P</div>
          <div><div class="rh-name">{monthLabel(run.periodMonth)}</div><div class="rh-id">{run.runNo}</div></div>
        </div>
        <div class="rh-cell">
          <div class="rh-ci">i</div>
          <div><div class="k">Status</div><span class={`pill ${statusIntent(run.status)}`}>{humanizeStatus(run.status)}</span></div>
        </div>
        <div class="rh-cell">
          <div><div class="k">Current stage</div><div class="v">{curStage}</div>
            <div class="rh-stagebar"><span style={{ width: `${((curIdx + 1) / steps.length) * 100}%` }} /></div></div>
        </div>
        <div class="rh-cell">
          <div class="rh-owner">
            <span class="av">{initials(run.createdBy ?? undefined, 'PR')}</span>
            <div><div class="k">Owner</div><div class="v">{run.createdBy ? <EmployeeName id={run.createdBy} /> : '—'}</div></div>
          </div>
        </div>
        <div class="rh-cell"><div><div class="k">Pay group</div><div class="v">{run.payGroup ?? 'Ad-hoc'}</div></div></div>
        <div class="rh-cell"><div><div class="k">Pay period</div><div class="v">{monthLabel(run.periodMonth)}</div></div></div>
        <div class="rh-cell"><div><div class="k">Pay date</div><div class="v">{dayLabel(run.payDate)}</div></div></div>
        <div class="rh-cell"><div><div class="k">Employees</div><div class="v">{run.employeeCount}</div></div></div>
        <div class="rh-chips">
          <PolicyChip run={run} />
          <CalendarChip run={run} />
        </div>
      </section>

      {/* lifecycle stepper */}
      <section class="card">
        <div class="lifecycle">
          {steps.map((s, i) => (
            <Fragment key={s.key}>
              <div class={`lc-step ${s.state}`}>
                <div class="lc-c">{s.state === 'done' ? '✓' : s.state === 'fail' ? '✕' : String(i + 1)}</div>
                <div>
                  <div class="lc-l">{s.label}</div>
                  <div class="lc-s">{s.state === 'done' ? 'Complete' : s.state === 'cur' ? 'Current' : s.state === 'fail' ? 'Returned' : 'Pending'}</div>
                </div>
              </div>
              {i < steps.length - 1 && <div class="lc-chev">›</div>}
            </Fragment>
          ))}
        </div>
        <div class="lc-stats">
          <div class="lc-stat"><span>◎</span><div><div class="k">Employees</div><div class="v">{workspace?.currentCalculationVersion?.employeeCount ?? run.employeeCount}<small> / {run.employeeCount}</small></div></div></div>
          <div class="lc-stat"><span>↻</span><div><div class="k">Calculation version</div><div class="v">{workspace?.currentCalculationVersion?.versionNo ?? '—'}</div></div></div>
          <div class="lc-stat"><span>◷</span><div><div class="k">Attempts</div><div class="v">{workspace?.calculationAttempts.length ?? 0}</div></div></div>
          <div class="lc-stat"><span>✓</span><div><div class="k">Open findings</div><div class="v">{workspace?.findingSummary.actionable ?? 0}</div></div></div>
        </div>
      </section>

      {/* metrics strip */}
      <section class="card metrics">
        <Metric ico="#" tone="blue" k="Employees" v={String(run.employeeCount)} s="on this run" />
        <Metric ico="$" tone="blue" k="Gross payroll" v={fmtCompact(run.grossTotal)} s="period gross" />
        <Metric ico="$" tone="green" k="Net payroll" v={fmtCompact(run.netTotal)} s="to be paid" />
        <Metric ico="%" tone="blue" k="Deductions" v={fmtCompact(run.deductionTotal)} s={`${deductionPct}% of gross`} />
        <Metric ico="!" tone="red" k="Blockers" v={String(blockers)} s={blockers > 0 ? 'submission disabled' : 'none open'} />
        <Metric ico="↗" tone="amber" k="Warnings" v={String(warnings)} s="open findings" />
      </section>

      {/* next-action banner */}
      <NextActionBanner status={run.status} blockers={blockers} preflight={preflight} onGo={() => setTab('exceptions')} />

      {/* tabs */}
      <nav class="run-tabs">
        {TAB_DEFS.map(t => (
          <button type="button" class={`tab${tab === t.key ? ' on' : ''}`} key={t.key} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === 'exceptions' && blockers > 0 && <span class="pill red" style={{ padding: '2px 8px', fontSize: 11 }}>{blockers}</span>}
          </button>
        ))}
      </nav>

      {/* active panel */}
      <div class="run-panel on">
        {tab === 'summary'        && <SummaryPanel run={run} workspace={workspace} preflight={preflight} />}
        {tab === 'population'     && <PopulationPanel runId={run.id} />}
        {tab === 'inputs'         && <InputsPanel run={run} canManage={canManage} inputSnapshot={workspace?.inputSnapshot} />}
        {tab === 'reconciliation' && <ReconciliationPanel runId={run.id} />}
        {tab === 'exceptions'     && <ExceptionsPanel run={run} workspace={workspace} canManage={canManage} />}
        {tab === 'approvals'      && <ApprovalsPanel run={run} />}
        {tab === 'release'        && <ReleasePanel run={run} preflight={preflight} canManage={canManage} actions={actions} />}
        {tab === 'audit'          && <AuditPanel runId={run.id} />}
      </div>

      <div class="footer-note">Payroll run workspace · {run.runNo}</div>
    </div>
  );
}

// ── header lifecycle actions (state-aware, permission-gated) ────────────────────

function HeaderActions({ run, canManage, canApprove, actions }: {
  run: PayrollRun; canManage: boolean; canApprove: boolean; actions: PayRunDrawerActions;
}): VNode {
  const s = run.status;
  const btns: VNode[] = [];
  if (s === 'draft' && canManage) btns.push(<button class="btn primary" type="button" onClick={() => actions.onLockInputs(run)}>Lock Inputs</button>);
  if ((s === 'input_locked' || s === 'returned') && canManage) btns.push(<button class="btn primary" type="button" onClick={() => actions.onCalculate(run)}>Calculate</button>);
  if ((s === 'calculated' || s === 'returned') && canManage) btns.push(<button class="btn primary" type="button" onClick={() => actions.onSubmit(run)}>{s === 'returned' ? 'Resubmit For Approval' : 'Submit For Approval'}</button>);
  if (s === 'pending_approval' && canApprove) {
    btns.push(<button class="btn primary" type="button" onClick={() => actions.onApprove(run)}>Approve</button>);
    btns.push(<button class="btn danger" type="button" onClick={() => actions.onReject(run)}>Reject</button>);
  }
  if (s === 'approved' && canManage) btns.push(<button class="btn primary" type="button" onClick={() => actions.onLockRun(run)}>Lock Run</button>);
  if (s === 'locked' && canManage) {
    btns.push(<button class="btn" type="button" onClick={() => actions.onExport(run)}>Export</button>);
    btns.push(<button class="btn" type="button" onClick={() => actions.onGenPayslips(run)}>Generate Payslips</button>);
  }
  if (s === 'locked' && canApprove) btns.push(<button class="btn" type="button" onClick={() => actions.onReopen(run)}>Reopen</button>);
  if (btns.length === 0) btns.push(<button class="btn" type="button" disabled>No actions available</button>);
  return <>{btns}</>;
}

function Metric({ ico, tone, k, v, s }: { ico: string; tone: string; k: string; v: string; s: string }): VNode {
  return (
    <div class="metric">
      <div class={`m-ico ${tone}`}>{ico}</div>
      <div><div class="k">{k}</div><div class="v">{v}</div><div class="s">{s}</div></div>
    </div>
  );
}

function NextActionBanner({ status, blockers, preflight, onGo }: {
  status: string; blockers: number; preflight: { ready?: boolean; alreadyReleased?: boolean } | undefined; onGo: () => void;
}): VNode | null {
  if (blockers > 0) {
    return (
      <section class="banner danger">
        <div class="b-ico">!</div>
        <div>
          <div class="b-eyebrow">NEXT REQUIRED ACTION</div>
          <div class="b-title">Resolve {blockers} blocking exception{blockers === 1 ? '' : 's'}</div>
          <div class="b-sub">Submission remains disabled until every blocking control passes.</div>
        </div>
        <div class="b-btns"><button class="btn danger" type="button" onClick={onGo}>Open exceptions</button></div>
      </section>
    );
  }
  if (status === 'pending_approval') {
    return (
      <section class="banner warning">
        <div class="b-ico">◷</div>
        <div>
          <div class="b-eyebrow">AWAITING APPROVAL</div>
          <div class="b-title">This run is pending maker-checker approval</div>
          <div class="b-sub">A different Finance Manager must approve before it can be locked.</div>
        </div>
      </section>
    );
  }
  if (preflight?.alreadyReleased) {
    return (
      <section class="banner ok">
        <div class="b-ico">✓</div>
        <div><div class="b-eyebrow">RELEASED</div><div class="b-title">This payroll has been released</div></div>
      </section>
    );
  }
  return null;
}

// ── small helpers ───────────────────────────────────────────────────────────────

function EmployeeName({ id }: { id: string }): VNode { return <EmployeeCell employeeId={id} />; }
function humanizeStatus(s: string): string { return humanize(s); }
