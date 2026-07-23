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
  usePayrollRun, useRunWorkspace, useReleasePreflight, PayrollApiError,
  type PayrollRun, type PayrollRunActions,
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
import { CalcFailurePanel } from './payRunDetail/CalcFailurePanel';

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

// canApprove stays in the prop contract for callers, but rendering now derives
// approval capability from the server-computed workspace.actions (P0-2).
export function PayRunDetailPage({ runId, onBack, canManage, canApprove: _canApprove, actions }: {
  runId: string;
  onBack: () => void;
  canManage: boolean;
  canApprove: boolean;
  actions: PayRunDrawerActions;
}): VNode {
  const [tab, setTab] = useState<TabKey>('summary');
  const runQ = usePayrollRun(runId);
  const workspaceQ = useRunWorkspace(runId);
  // P0-6.5: release preflight is REQUIRED only for the states where release
  // gates are meaningful — never fetched (and never gating) elsewhere.
  const preflightRelevant = ['approved', 'locked', 'released', 'exported'].includes(runQ.data?.status ?? '');
  const preflightQ = useReleasePreflight(preflightRelevant ? runId : null);
  const run = runQ.data;
  const workspace = workspaceQ.data;
  const preflight = preflightQ.data;

  // ── P0-6: atomic required-query gate ─────────────────────────────────────────
  // The run header, lifecycle, metrics, banner and initial tab render from run +
  // workspace (+ preflight when relevant). Until EVERY required query settles the
  // whole surface stays behind one stable skeleton; if any REQUIRED query fails,
  // a page error band (typed code + correlation id + Retry) replaces it at the
  // same footprint. Counts below the gate never fall back to a fake zero.
  const requiredError = runQ.error ?? workspaceQ.error ?? (preflightRelevant ? preflightQ.error : null);
  const requiredSettled = !!run && !!workspace && (!preflightRelevant || !!preflight);
  if (requiredError != null) {
    const typed = requiredError instanceof PayrollApiError ? requiredError : null;
    return (
      <div class="prw">
        <button type="button" class="back-link" onClick={onBack}>← Payroll runs</button>
        <div class="prw-page-error" role="alert">
          <i class="fa-solid fa-triangle-exclamation" aria-hidden="true" />
          <h3>Couldn’t load this payroll run</h3>
          <p>{requiredError instanceof Error ? requiredError.message : 'The run workspace failed to load.'}</p>
          {typed?.correlationId && <span class="prw-panel-error-meta">{typed.code} · ref {typed.correlationId}</span>}
          <button type="button" class="btn primary"
            onClick={() => { void runQ.refetch(); void workspaceQ.refetch(); if (preflightRelevant) void preflightQ.refetch(); }}>
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (!requiredSettled) {
    return (
      <div class="prw">
        <button type="button" class="back-link" onClick={onBack}>← Payroll runs</button>
        <div class="prw-page-skel" role="status" aria-busy="true" aria-label="Loading payroll run workspace">
          <div class="ps-block ps-head" /><div class="ps-block ps-life" />
          <div class="ps-block ps-metrics" /><div class="ps-block ps-panel" />
        </div>
      </div>
    );
  }

  const steps = lifecycleSteps(run.status);
  const curIdx = Math.max(0, steps.findIndex(s => s.state === 'cur'));
  const curStage = steps.find(s => s.state === 'cur')?.label ?? steps[steps.length - 1]?.label ?? '—';
  // Post-gate: workspace is guaranteed present — these are REAL counts, not
  // loading fallbacks (P0-6.4: never substitute zero for an unavailable count).
  const blockers = workspace.findingSummary.blockers;
  const warnings = workspace.findingSummary.warnings;
  const deductionPct = run.grossTotal > 0 ? Math.round((run.deductionTotal / run.grossTotal) * 1000) / 10 : 0;

  return (
    <div class="prw">
      {/* breadcrumb + page header */}
      <div>
        <div class="crumbs">
          {/* WP-6: real buttons, not href-less anchors (keyboard + AT reachable). */}
          <button type="button" class="crumb-link" onClick={onBack}>Payroll</button><span class="sep">›</span>
          <button type="button" class="crumb-link" onClick={onBack}>Payroll runs</button><span class="sep">›</span>
          <b>{run.runNo}</b>
        </div>
        <div class="page-header">
          <div>
            <h1>{runTitle(run)}</h1>
            <div class="sub">{run.runNo} · statutory version pinned · {curStage} stage</div>
          </div>
          <div class="ha"><HeaderActions run={run} caps={workspace.actions} actions={actions} /></div>
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
          <div class="lc-stat"><span>◎</span><div><div class="k">Employees</div><div class="v">{workspace.currentCalculationVersion?.employeeCount ?? run.employeeCount}<small> / {run.employeeCount}</small></div></div></div>
          <div class="lc-stat"><span>↻</span><div><div class="k">Calculation version</div><div class="v">{workspace.currentCalculationVersion?.versionNo ?? '—'}</div></div></div>
          <div class="lc-stat"><span>◷</span><div><div class="k">Attempts</div><div class="v">{workspace.calculationAttempts.length}</div></div></div>
          <div class="lc-stat"><span>✓</span><div><div class="k">Open findings</div><div class="v">{workspace.findingSummary.actionable}</div></div></div>
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
      <NextActionBanner status={run.status} blockers={blockers} attempt={workspace.calculationAttempts.length} preflight={preflight} onGo={() => setTab('exceptions')} />

      {run.status === 'calculation_failed' ? (
        /* F-05 — calculation-failure recovery replaces the tabs while the run is failed */
        <CalcFailurePanel workspace={workspace} />
      ) : (
        <Fragment>
          {/* tabs — WP-6: real tab semantics (tablist/tab/tabpanel, aria-selected,
              aria-controls, roving tabindex + Arrow/Home/End keyboard navigation). */}
          <nav class="run-tabs" role="tablist" aria-label="Payroll run sections"
            onKeyDown={e => {
              const keys: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, Home: 0, End: 0 };
              if (!(e.key in keys)) return;
              e.preventDefault();
              const idx = TAB_DEFS.findIndex(t => t.key === tab);
              const next = e.key === 'Home' ? 0
                : e.key === 'End' ? TAB_DEFS.length - 1
                : (idx + keys[e.key]! + TAB_DEFS.length) % TAB_DEFS.length;
              const nextKey = TAB_DEFS[next]!.key;
              setTab(nextKey);
              (e.currentTarget.querySelector<HTMLElement>(`#run-tab-${nextKey}`))?.focus();
            }}>
            {TAB_DEFS.map(t => (
              <button type="button" role="tab" id={`run-tab-${t.key}`}
                aria-selected={tab === t.key} aria-controls="run-tabpanel"
                tabIndex={tab === t.key ? 0 : -1}
                class={`tab${tab === t.key ? ' on' : ''}`} key={t.key} onClick={() => setTab(t.key)}>
                {t.label}
                {t.key === 'exceptions' && blockers > 0 && <span class="pill red" style={{ padding: '2px 8px', fontSize: 11 }}>{blockers}</span>}
              </button>
            ))}
          </nav>

          {/* active panel */}
          <div class="run-panel on" role="tabpanel" id="run-tabpanel" aria-labelledby={`run-tab-${tab}`}>
            {tab === 'summary'        && <SummaryPanel run={run} workspace={workspace} preflight={preflight} />}
            {tab === 'population'     && <PopulationPanel runId={run.id} />}
            {tab === 'inputs'         && <InputsPanel run={run} canManage={canManage} inputSnapshot={workspace.inputSnapshot} />}
            {tab === 'reconciliation' && <ReconciliationPanel runId={run.id} />}
            {tab === 'exceptions'     && <ExceptionsPanel run={run} workspace={workspace} canManage={canManage} />}
            {tab === 'approvals'      && <ApprovalsPanel run={run} />}
            {tab === 'release'        && <ReleasePanel run={run} preflight={preflight} canManage={canManage} actions={actions} />}
            {tab === 'audit'          && <AuditPanel runId={run.id} />}
          </div>
        </Fragment>
      )}

      <div class="footer-note">Payroll run workspace · {run.runNo}</div>
    </div>
  );
}

// ── header lifecycle actions (P0-2: rendered EXCLUSIVELY from the server-computed
//    capability object; P0-3: Export appears only when canExport = released) ─────

export function HeaderActions({ run, caps, actions }: {
  run: PayrollRun; caps: PayrollRunActions | undefined; actions: PayRunDrawerActions;
}): VNode {
  // Capabilities arrive with the workspace query; until then offer nothing rather
  // than guessing (the backend remains final either way).
  if (!caps) return <button class="btn" type="button" disabled>Loading actions…</button>;
  const s = run.status;
  const btns: VNode[] = [];
  if (caps.canLockInputs) btns.push(<button class="btn primary" type="button" onClick={() => actions.onLockInputs(run)}>Lock Inputs</button>);
  if (caps.canCalculate) btns.push(<button class="btn primary" type="button" onClick={() => actions.onCalculate(run)}>{s === 'calculation_failed' ? 'Retry Calculation' : 'Calculate'}</button>);
  if (caps.canSubmit) btns.push(<button class="btn primary" type="button" onClick={() => actions.onSubmit(run)}>{s === 'returned' ? 'Resubmit For Approval' : 'Submit For Approval'}</button>);
  if (caps.canApprove) btns.push(<button class="btn primary" type="button" onClick={() => actions.onApprove(run)}>Approve</button>);
  if (caps.canReject) btns.push(<button class="btn danger" type="button" onClick={() => actions.onReject(run)}>Reject</button>);
  if (caps.canLock) btns.push(<button class="btn primary" type="button" onClick={() => actions.onLockRun(run)}>Lock Run</button>);
  if (caps.canGeneratePayslips) btns.push(<button class="btn" type="button" onClick={() => actions.onGenPayslips(run)}>Generate Payslips</button>);
  if (caps.canExport) btns.push(<button class="btn" type="button" onClick={() => actions.onExport(run)}>Export</button>);
  if (caps.canReopen) btns.push(<button class="btn" type="button" onClick={() => actions.onReopen(run)}>Reopen</button>);
  if (btns.length === 0) {
    const reason = caps.disabledReasons.canLockInputs ?? caps.disabledReasons.canCalculate
      ?? caps.disabledReasons.canSubmit ?? caps.disabledReasons.canApprove ?? undefined;
    btns.push(<button class="btn" type="button" disabled title={reason}>No actions available</button>);
  }
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

function NextActionBanner({ status, blockers, attempt, preflight, onGo }: {
  status: string; blockers: number; attempt: number; preflight: { ready?: boolean; alreadyReleased?: boolean } | undefined; onGo: () => void;
}): VNode | null {
  if (status === 'calculation_failed') {
    return (
      <section class="banner danger">
        <div class="b-ico">!</div>
        <div>
          <div class="b-eyebrow">CALCULATION STOPPED</div>
          <div class="b-title">{attempt > 0 ? `Calculation attempt ${attempt} failed` : 'The calculation failed'} without committing any results</div>
          <div class="b-sub">No partial payroll was written. Correct the source records below, then retry as a new attempt.</div>
        </div>
      </section>
    );
  }
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
