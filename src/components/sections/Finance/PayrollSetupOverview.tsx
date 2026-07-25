/**
 * src/components/sections/Finance/PayrollSetupOverview.tsx
 *
 * Finance ▸ Payroll Setup (nav id `s-finance-payroll-setup`).
 *
 * Two configuration surfaces that drive the payroll run engine:
 *   • Pay Groups     — frequency + population buckets; a run scoped to a group
 *                      inherits its frequency and is populated from its members.
 *   • Overtime Rules — effective-dated OT multipliers by event type (T&T norms);
 *                      lockInputs prices approved OT by its ot_type at run time.
 *
 * Both consume existing, permission-gated backend routes:
 *   finance/payroll/pay-groups/{list,create,assign,members}
 *   finance/payroll/overtime-rules/{list,create,set-active}
 *
 * View is gated on finance.payroll.view_all; create/assign on paygroups.manage;
 * rule create/activate on overtime.rules.manage.
 */

import { type VNode } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { toast, useSessionStore } from '@store';
import { useCan } from '@lib/permissions';
import { dialog } from '@lib/dialog';
import {
  HrfinPageHeader,
  QuickActionStrip,
  KpiCard,
  HrfinTable,
  HrfinPill,
  type HrfinColumn,
  type HrfinTone,
  type RowActionItem,
} from '@ui';
import {
  usePayGroups,
  usePayGroupMembers,
  useOvertimeRules,
  useEmployeeLoans,
  usePayrollMutation,
  financePayrollApi,
  type PayGroup,
  type OvertimeRule,
  type OvertimeEventType,
  type EmployeeLoan,
  type LoanType,
} from '@api/finance/payroll';
import { useHrEmployees, type HrEmployeeRow } from '@api/hr/employees';
import { EnterpriseFormModal, type DialogContextPanelConfig } from '@/components/common/dialogs';
import { EmployeePicker } from './_shared/pickers';
import { fmtDate, fmtMoney, humanize } from './financeShared';
import './finance.css';
import './payroll/setup/payPolicySetup.css'; // shared payroll-setup command-centre design system (.pps-*)
import { PayPolicySetup } from './payroll/setup/PayPolicySetup';
import { SodPolicyPanel } from './payroll/setup/SodPolicyPanel';
import { WorkCalendarSetup } from './payroll/setup/WorkCalendarSetup';

const empName = (e: HrEmployeeRow): string =>
  (e.display_name ?? e.full_name ?? `${e.first_name ?? ''} ${e.last_name ?? ''}`.trim()) || e.username || e.id;

const todayIso = (): string => new Date().toISOString().slice(0, 10);

const FREQUENCIES: readonly { value: PayGroup['frequency']; label: string }[] = [
  { value: 'weekly',       label: 'Weekly' },
  { value: 'fortnightly',  label: 'Fortnightly' },
  { value: 'semi_monthly', label: 'Semi-monthly' },
  { value: 'monthly',      label: 'Monthly' },
];

const OT_EVENT_TYPES: readonly { value: OvertimeEventType; label: string; typical: number }[] = [
  { value: 'regular_overtime', label: 'Regular overtime',       typical: 1.5 },
  { value: 'public_holiday',   label: 'Public holiday',         typical: 2 },
  { value: 'rest_day',         label: 'Rest day (e.g. Sunday)', typical: 2 },
  { value: 'callout',          label: 'Call-out',               typical: 1.5 },
  { value: 'night_shift',      label: 'Night shift',            typical: 1.25 },
];
const otEventLabel = (t: string): string => OT_EVENT_TYPES.find(o => o.value === t)?.label ?? humanize(t);

const PAGE_SIZE = 25;
function paginate<T>(rows: T[], page: number): { rows: T[]; pageCount: number; total: number } {
  return {
    rows:      rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    pageCount: Math.max(1, Math.ceil(rows.length / PAGE_SIZE)),
    total:     rows.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main page
// ═══════════════════════════════════════════════════════════════════════════════

type SetupTab = 'pay-policies' | 'pay-groups' | 'overtime-rules' | 'work-calendar' | 'governance';

export function PayrollSetupOverview(): VNode {
  // Payroll config and the shared Work Calendar are gated independently — the calendar is
  // hr.work_calendar.view (shared HR capability), payroll config is finance.payroll.*.
  // useCan (reactive) not can() — a plain can() read at mount returns false while the session
  // store is still hydrating and never re-renders, flashing a false "no permission" that sticks
  // until re-navigation. permsReady distinguishes "still loading" from "genuinely denied".
  const permsReady = useSessionStore(s => s.role !== null);
  // Each useCan() is a hook — call them unconditionally and combine after, never `a() || b()`
  // (|| short-circuits the second call and breaks hook order when the first flips).
  const canViewAllPayroll = useCan('finance.payroll.view_all');
  const canViewPolicies = useCan('finance.payroll.policies.view');
  const canViewPayroll = canViewAllPayroll || canViewPolicies;
  const canViewCalendar = useCan('hr.work_calendar.view');
  // Governance (segregation-of-duties level) is gated on its own capability.
  const canViewSod = useCan('finance.payroll.sod_policy.view');
  const tabs = useMemo<{ key: SetupTab; label: string }[]>(() => [
    ...(canViewPayroll ? [
      { key: 'pay-policies' as const, label: 'Pay Policies' },
      { key: 'pay-groups' as const, label: 'Pay Groups' },
      { key: 'overtime-rules' as const, label: 'Overtime Rules' },
    ] : []),
    ...(canViewCalendar ? [{ key: 'work-calendar' as const, label: 'Work Calendar' }] : []),
    ...(canViewSod ? [{ key: 'governance' as const, label: 'Governance' }] : []),
  ], [canViewPayroll, canViewCalendar, canViewSod]);
  // Held as nullable + derived, not seeded from tabs[0]: the initializer runs once at mount while
  // permissions are still hydrating (tabs is empty then), which would strand a calendar-only user
  // on the Pay Policies tab they can't see.
  const [pickedTab, setPickedTab] = useState<SetupTab | null>(null);
  const tab: SetupTab = pickedTab && tabs.some(t => t.key === pickedTab)
    ? pickedTab
    : (tabs[0]?.key ?? 'pay-policies');
  // Pay Policies opens a full-page wizard / detail view; hide the module header + tabs
  // so it reads as its own page (like the mockup) rather than chrome nested in chrome.
  const [fullPage, setFullPage] = useState(false);

  if (!permsReady) {
    return (
      <div class="hrfin fin-page">
        <HrfinPageHeader icon="book" title="Payroll Setup" sub="Loading…" />
        <div class="hrfin-table-card"><div style={{ padding: 32 }} class="hrfin-empty">Loading payroll configuration…</div></div>
      </div>
    );
  }
  if (!canViewPayroll && !canViewCalendar) {
    return (
      <div class="hrfin fin-page">
        <HrfinPageHeader icon="book" title="Payroll Setup" sub="Pay groups and overtime rules." />
        <div class="hrfin-table-card"><div style={{ padding: 32 }} class="hrfin-empty">
          You do not have permission to view payroll configuration.
        </div></div>
      </div>
    );
  }

  return (
    <div class="hrfin fin-page">
      {!fullPage && (
        <>
          <HrfinPageHeader
            icon="book"
            title="Payroll Setup"
            sub="Governed Pay Policies, Pay Groups, Overtime Rules, And Work Calendars For Local Trinidad And Tobago Payroll."
          />

          <div class="hrfin-tabs" style={{ marginBottom: 14 }}>
            {tabs.map(t => (
              <button key={t.key} type="button" class={tab === t.key ? 'is-active' : ''} onClick={() => setPickedTab(t.key)}>{t.label}</button>
            ))}
          </div>
        </>
      )}

      {tab === 'pay-policies' ? <PayPolicySetup onFullPage={setFullPage} />
        : tab === 'pay-groups' ? <PayGroupsPanel />
        : tab === 'overtime-rules' ? <OvertimeRulesPanel />
        : tab === 'governance' ? <SodPolicyPanel />
        : <WorkCalendarSetup />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Loans & Advances (Wave 5)
// ═══════════════════════════════════════════════════════════════════════════════

const LOAN_TYPES: readonly { value: LoanType; label: string }[] = [
  { value: 'loan',    label: 'Loan' },
  { value: 'advance', label: 'Salary advance' },
];

function loanStatusTone(s: string): HrfinTone {
  switch (s) {
    case 'active':           return 'ok';
    case 'settled':          return 'nu';
    case 'pending_approval': return 'wn';
    case 'draft':            return 'nu';
    case 'cancelled':
    case 'rejected':         return 'bad';
    default:                 return 'nu';
  }
}

function LoansPanel(): VNode {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showNew, setShowNew] = useState(false);

  const canManage = useCan('finance.payroll.loans.manage');
  const loansQ = useEmployeeLoans(statusFilter ? { status: statusFilter } : {});
  const empsQ = useHrEmployees({ limit: 1000 });
  const submitMut = usePayrollMutation(financePayrollApi.submitLoan);
  const settleMut = usePayrollMutation(financePayrollApi.settleLoan);
  const cancelMut = usePayrollMutation(financePayrollApi.cancelLoan);

  const nameOf = useMemo(() => {
    const m = new Map((empsQ.data ?? []).map(e => [e.id, empName(e)]));
    return (id: string) => m.get(id) ?? id;
  }, [empsQ.data]);

  const loans = loansQ.data ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return loans;
    return loans.filter(l => l.reference.toLowerCase().includes(q) || nameOf(l.employeeId).toLowerCase().includes(q));
  }, [loans, search, nameOf]);
  const { rows, pageCount, total } = useMemo(() => paginate(filtered, page), [filtered, page]);

  const activeLoans = loans.filter(l => l.status === 'active');
  const outstanding = activeLoans.reduce((s, l) => s + (l.balance || 0), 0);
  const pendingCount = loans.filter(l => l.status === 'pending_approval').length;

  const run = async (p: Promise<unknown>, ok: string): Promise<void> => {
    try { await p; toast(ok); } catch (e) { void dialog.error(e instanceof Error ? e.message : 'Action failed.'); }
  };

  // Idempotency: one stable key per submit ATTEMPT (per id), held across retries so a
  // lost response recovers via the RPC receipt; cleared only on definitive success.
  const submitKeys = useRef<Map<string, string>>(new Map());
  const doSubmitLoan = async (id: string): Promise<void> => {
    const keys = submitKeys.current;
    const key = keys.get(id) ?? crypto.randomUUID();
    keys.set(id, key);
    try { await submitMut.mutateAsync({ id, idempotencyKey: key }); keys.delete(id); toast('Loan submitted for approval.'); }
    catch (e) { void dialog.error(e instanceof Error ? e.message : 'Action failed.'); }
  };

  const quickActions = [
    ...(canManage ? [{ key: 'new', label: 'New Loan', icon: 'plus' as const, variant: 'primary' as const, onClick: () => setShowNew(true) }] : []),
    { key: 'refresh', label: 'Refresh', icon: 'refresh' as const, onClick: () => { void loansQ.refetch(); } },
  ];

  const COLS: HrfinColumn<EmployeeLoan>[] = [
    { key: 'reference',  label: 'Reference',  render: l => <strong style={{ fontFamily: 'monospace', fontSize: 12 }}>{l.reference}</strong> },
    { key: 'employee',   label: 'Employee',   render: l => <span style={{ fontSize: 13 }}>{nameOf(l.employeeId)}</span> },
    { key: 'type',       label: 'Type',       render: l => <span style={{ fontSize: 12, color: 'var(--hrfin-text-secondary)' }}>{humanize(l.loanType)}</span> },
    { key: 'total',      label: 'Total',      render: l => <span style={{ fontSize: 13, textAlign: 'right', display: 'block', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(l.totalRepayable)}</span> },
    { key: 'installment',label: 'Installment',render: l => <span style={{ fontSize: 12, textAlign: 'right', display: 'block', color: 'var(--hrfin-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(l.installmentAmount)}</span> },
    { key: 'balance',    label: 'Balance',    render: l => <span style={{ fontSize: 13, fontWeight: 600, textAlign: 'right', display: 'block', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(l.balance)}</span> },
    { key: 'status',     label: 'Status',     render: l => <HrfinPill tone={loanStatusTone(l.status)}>{humanize(l.status)}</HrfinPill> },
  ];

  const rowActions = (l: EmployeeLoan): RowActionItem[] => {
    if (!canManage) return [];
    const items: RowActionItem[] = [];
    if (l.status === 'draft' || l.status === 'rejected') {
      items.push({ key: 'submit', label: 'Submit for approval', icon: 'check', onClick: () => void doSubmitLoan(l.id) });
    }
    if (l.status === 'active') {
      items.push({ key: 'settle', label: 'Settle (mark paid off)', icon: 'check', onClick: () => { void (async () => {
        const ok = await dialog.confirm({ title: `Settle ${l.reference}?`, text: `This marks the loan as fully paid off (clears the remaining ${fmtMoney(l.balance)} balance) and stops payroll deductions. Use when the balance is cleared outside payroll (e.g. a lump-sum payment).`, confirmText: 'Settle', icon: 'question' });
        if (ok) void run(settleMut.mutateAsync({ id: l.id }), 'Loan settled.');
      })(); } });
    }
    // An ACTIVE loan cannot be cancelled (outstanding balance is real money) —
    // it is settled (paid off) or written off via approval. Mirrors the BE gate.
    if (['draft', 'pending_approval', 'rejected'].includes(l.status)) {
      items.push({ key: 'cancel', label: 'Cancel', icon: 'close', tone: 'danger', onClick: () => { void (async () => {
        const reason = await dialog.prompt({ title: `Cancel ${l.reference}`, text: 'Cancelling withdraws this loan before it takes effect (any open approval is closed). Provide a reason (audit-logged).', placeholder: 'Reason…', confirmText: 'Cancel loan' });
        if (reason == null) return;
        void run(cancelMut.mutateAsync({ id: l.id, reason: reason.trim() || undefined }), 'Loan cancelled.');
      })(); } });
    }
    return items;
  };

  return (
    <>
      <QuickActionStrip actions={quickActions} />

      <div style={{ margin: '4px 0 12px', padding: '10px 14px', fontSize: 12.5, lineHeight: 1.5, background: 'var(--hrfin-surface-2)', border: '1px solid var(--hrfin-border)', borderRadius: 8, color: 'var(--hrfin-text-secondary)' }}>
        <i class="fas fa-circle-info" style={{ marginRight: 6, color: 'var(--hrfin-accent)' }} />
        A loan/advance is created as a draft, <strong>submitted for Finance Manager approval</strong> (maker-checker, via the approvals inbox), then auto-deducts a fixed installment from each pay run until the balance clears. Deductions post when a run is <strong>locked</strong>.
      </div>

      <section class="hrfin-kpi-strip">
        <KpiCard label="Loans"            value={String(loans.length)}   support={`${activeLoans.length} active`}        loading={loansQ.isLoading && !loansQ.data} />
        <KpiCard label="Outstanding"      value={fmtMoney(outstanding)}  support="active balances"                       loading={loansQ.isLoading && !loansQ.data} />
        <KpiCard label="Pending Approval" value={String(pendingCount)}   support="awaiting a manager"  tone={pendingCount > 0 ? 'danger' : undefined} loading={loansQ.isLoading && !loansQ.data} />
      </section>

      <HrfinTable<EmployeeLoan>
        tabs={[{ key: '', label: 'All' }, { key: 'active', label: 'Active' }, { key: 'pending_approval', label: 'Pending' }, { key: 'draft', label: 'Draft' }, { key: 'settled', label: 'Settled' }]}
        activeTab={statusFilter}
        onTab={k => { setStatusFilter(k); setPage(0); }}
        searchValue={search}
        onSearch={v => { setSearch(v); setPage(0); }}
        searchPlaceholder="Search by reference or employee…"
        columns={COLS}
        rows={rows}
        rowKey={l => l.id}
        rowActions={rowActions}
        page={page}
        pageCount={pageCount}
        total={total}
        pageSize={PAGE_SIZE}
        onPage={setPage}
        noun="loans"
        loading={loansQ.isLoading && !loansQ.data}
        error={loansQ.isError ? (/loan|schema cache|does not exist/i.test((loansQ.error)?.message ?? '') ? 'Loans are unavailable — apply migration 20260918000090 (finance_employee_loans) and reload the PostgREST schema.' : ((loansQ.error)?.message ?? 'Failed to load loans.')) : undefined}
        emptyMessage={search || statusFilter ? 'No loans match.' : 'No loans yet. Click New Loan to create one.'}
      />

      {showNew && <NewLoanModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); void loansQ.refetch(); }} />}
    </>
  );
}

function NewLoanModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }): VNode {
  const createMut = usePayrollMutation(financePayrollApi.createLoan);
  const [f, setF] = useState<{ employeeId: string | null; loanType: LoanType; principal: string; interest: string; installment: string; startPeriod: string; reason: string }>(
    { employeeId: null, loanType: 'loan', principal: '', interest: '', installment: '', startPeriod: '', reason: '' },
  );

  const principal = Number(f.principal);
  const interest = f.interest === '' ? 0 : Number(f.interest);
  const installment = Number(f.installment);
  const totalRepayable = principal > 0 ? Math.round((principal + (interest > 0 ? interest : 0)) * 100) / 100 : 0;
  const termPeriods = installment > 0 && totalRepayable > 0 ? Math.ceil(totalRepayable / installment) : 0;

  const errors = {
    employee:   !f.employeeId ? 'Select an employee.' : null,
    principal:  !(principal > 0) ? 'Principal must be greater than 0.' : null,
    interest:   interest < 0 ? 'Interest cannot be negative.' : null,
    installment:!(installment > 0) ? 'Installment must be greater than 0.'
                : totalRepayable > 0 && installment > totalRepayable ? 'Installment cannot exceed the total repayable.' : null,
  };
  const valid = !errors.employee && !errors.principal && !errors.interest && !errors.installment;

  const submit = async (): Promise<void> => {
    if (!valid || !f.employeeId) return;
    try {
      await createMut.mutateAsync({
        employeeId: f.employeeId, loanType: f.loanType,
        principal, ...(interest > 0 ? { interestAmount: interest } : {}), installmentAmount: installment,
        ...(f.startPeriod ? { startPeriod: f.startPeriod } : {}), reason: f.reason.trim() || null,
      });
      toast('Loan created as draft — submit it for approval.');
      onCreated();
    } catch (e) { void dialog.error(e instanceof Error ? e.message : 'Failed to create loan.'); }
  };

  const context: DialogContextPanelConfig = {
    eyebrow: 'Finance · Payroll', title: 'Loan / Advance', description: 'Created as a draft; submit for Finance Manager approval before it auto-deducts from payroll.',
    preview: { icon: 'LN', title: totalRepayable ? fmtMoney(totalRepayable) : '—', subtitle: `${humanize(f.loanType)} · ${installment > 0 ? fmtMoney(installment) + '/period' : 'set installment'}` },
    metrics: [
      { label: 'Total repayable', value: totalRepayable ? fmtMoney(totalRepayable) : '—', tone: 'info' },
      { label: 'Installment', value: installment > 0 ? fmtMoney(installment) : '—', tone: 'default' },
      { label: 'Term', value: termPeriods > 0 ? `${termPeriods} period${termPeriods === 1 ? '' : 's'}` : '—', tone: 'muted' },
    ],
    validation: [
      ...(errors.employee ? [{ message: errors.employee, tone: 'danger' as const }] : []),
      ...(errors.principal ? [{ message: errors.principal, tone: 'danger' as const }] : []),
      ...(errors.installment ? [{ message: errors.installment, tone: 'danger' as const }] : []),
      ...(interest > 0 ? [{ message: `Flat interest of ${fmtMoney(interest)} added to the principal.`, tone: 'info' as const }] : []),
    ],
    approval: { required: true, risk: 'high', message: 'Financial — routed through Finance Manager maker-checker approval.' },
    whatNext: [
      { label: 'Submit for approval', description: 'A Finance Manager (≠ creator) approves it in the approvals inbox.' },
      { label: 'Auto-deducts', description: 'Once active, the installment deducts from each pay run until cleared.' },
    ],
  };

  return (
    <EnterpriseFormModal open
      title="New Loan / Advance"
      subtitle="Create a repayable loan or salary advance for an employee."
      icon={<i class="fas fa-hand-holding-dollar" />}
      context={context}
      primaryLabel="Create draft"
      loading={createMut.isPending}
      disabled={!valid}
      onCancel={onClose}
      onSubmit={() => void submit()}>
      <div class="fin-form-grid fin-form-grid--tight">
        <div style={{ gridColumn: '1 / -1' }}>
          <EmployeePicker label="Employee" value={f.employeeId} onChange={id => setF(p => ({ ...p, employeeId: id }))} required error={errors.employee} />
        </div>
        <label class="fin-field"><span>Type</span>
          <select value={f.loanType} onChange={e => setF(p => ({ ...p, loanType: (e.currentTarget).value as LoanType }))}>
            {LOAN_TYPES.map(t => <option value={t.value} key={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label class="fin-field"><span>Principal (TTD)</span>
          <input type="number" step="0.01" min="0" value={f.principal} onInput={e => setF(p => ({ ...p, principal: (e.currentTarget).value }))} />
          {errors.principal && <small class="fin-field-error">{errors.principal}</small>}
        </label>
        <label class="fin-field"><span>Interest (flat, optional)</span>
          <input type="number" step="0.01" min="0" value={f.interest} placeholder="0.00" onInput={e => setF(p => ({ ...p, interest: (e.currentTarget).value }))} />
          {errors.interest && <small class="fin-field-error">{errors.interest}</small>}
        </label>
        <label class="fin-field"><span>Installment / period (TTD)</span>
          <input type="number" step="0.01" min="0" value={f.installment} onInput={e => setF(p => ({ ...p, installment: (e.currentTarget).value }))} />
          {errors.installment && <small class="fin-field-error">{errors.installment}</small>}
        </label>
        <label class="fin-field"><span>Start period (optional)</span>
          <input type="date" value={f.startPeriod} onInput={e => setF(p => ({ ...p, startPeriod: (e.currentTarget).value }))} />
        </label>
        <label class="fin-field" style={{ gridColumn: '1 / -1' }}><span>Reason / notes</span>
          <input type="text" maxLength={500} value={f.reason} onInput={e => setF(p => ({ ...p, reason: (e.currentTarget).value }))} />
        </label>
      </div>
    </EnterpriseFormModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pay Groups
// ═══════════════════════════════════════════════════════════════════════════════

function PayGroupsPanel(): VNode {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [membersOf, setMembersOf] = useState<PayGroup | null>(null);

  const canManage = useCan('finance.payroll.paygroups.manage');
  const groupsQ = usePayGroups(false); // include inactive
  const groups = groupsQ.data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(g =>
      g.code.toLowerCase().includes(q) || g.name.toLowerCase().includes(q) || g.frequency.includes(q));
  }, [groups, search]);
  const { rows, pageCount, total } = useMemo(() => paginate(filtered, page), [filtered, page]);

  const totalMembers = groups.reduce((s, g) => s + (g.memberCount ?? 0), 0);
  const activeCount  = groups.filter(g => g.active).length;
  const err = groupsQ.isError ? ((groupsQ.error)?.message ?? 'Failed to load pay groups.') : undefined;

  return (
    <div class="pps">
      {/* Pay Groups reads as a card board — deliberately different from the Pay Policies command centre. */}
      <div class="pps-slim">
        <div class="lead"><div class="pps-sico">G</div><div><strong>Pay groups</strong><span class="sub">Frequency + population buckets that scope a payroll run.</span></div></div>
        <div class="chips">
          <div class="pps-chip"><span>Groups</span><strong>{groups.length}</strong></div>
          <div class="pps-chip"><span>Employees</span><strong>{totalMembers}</strong></div>
          <div class="pps-chip"><span>Active</span><strong>{activeCount}</strong></div>
        </div>
        <div class="actions">
          <button type="button" onClick={() => { void groupsQ.refetch(); }}>Refresh</button>
          {canManage && <button type="button" class="is-primary" onClick={() => setShowNew(true)}>+ New pay group</button>}
        </div>
      </div>

      <div class="pps-bar">
        <input aria-label="Search pay groups" value={search} placeholder="Search by code, name or frequency…"
          onInput={e => { setSearch(e.currentTarget.value); setPage(0); }} />
        <span>{filtered.length} group{filtered.length === 1 ? '' : 's'}</span>
      </div>

      {groupsQ.isLoading && !groupsQ.data ? <section class="pps-card"><div class="pps-state">Loading pay groups…</div></section>
        : err ? <section class="pps-card"><div class="pps-state is-error">{err} <button onClick={() => void groupsQ.refetch()}>Retry</button></div></section>
        : rows.length === 0 ? <section class="pps-card"><div class="pps-state">{search ? 'No pay groups match your search.' : 'No pay groups yet — create the first one.'}</div></section>
        : (
          <div class="pps-ggrid">
            {rows.map(g => (
              <button type="button" class="pps-gcard" data-freq={g.frequency} key={g.id} onClick={() => setMembersOf(g)}>
                <div class="pps-gcard-top">
                  <span class="pps-glyph">{g.code.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'PG'}</span>
                  <div><strong>{g.name}</strong><small>{g.code}</small></div>
                  <HrfinPill tone="nu">{humanize(g.frequency)}</HrfinPill>
                </div>
                <div class="pps-gstats">
                  <div class="pps-gstat"><span>Pay day</span><strong>{g.defaultPayDay ?? '—'}</strong></div>
                  <div class="pps-gstat"><span>Cut-off</span><strong>{g.defaultCutoffOffsetDays}d</strong></div>
                  <div class="pps-gstat"><span>Members</span><strong>{g.memberCount ?? 0}</strong></div>
                </div>
                <div class="pps-gcard-foot"><HrfinPill tone={g.active ? 'ok' : 'bad'}>{g.active ? 'Active' : 'Inactive'}</HrfinPill><span>Open members →</span></div>
              </button>
            ))}
          </div>
        )}

      {pageCount > 1 && (
        <div class="pps-footer">
          <span>{`Showing ${rows.length} of ${total}`}</span>
          <div><button type="button" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Previous</button><button type="button" disabled={page + 1 >= pageCount} onClick={() => setPage(p => p + 1)}>Next</button></div>
        </div>
      )}

      {showNew && <NewPayGroupModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); void groupsQ.refetch(); }} />}
      {membersOf && <PayGroupMembersModal group={membersOf} canManage={canManage} onClose={() => { setMembersOf(null); void groupsQ.refetch(); }} />}
    </div>
  );
}

function NewPayGroupModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }): VNode {
  const createMut = usePayrollMutation(financePayrollApi.createPayGroup);
  const [f, setF] = useState<{ code: string; name: string; frequency: PayGroup['frequency']; defaultPayDay: string; cutoff: string }>(
    { code: '', name: '', frequency: 'monthly', defaultPayDay: '', cutoff: '3' },
  );

  const codeTrim = f.code.trim();
  const nameTrim = f.name.trim();
  const payDayNum = f.defaultPayDay === '' ? null : Number(f.defaultPayDay);
  const cutoffNum = f.cutoff === '' ? 0 : Number(f.cutoff);
  const needsPayDay = f.frequency === 'monthly' || f.frequency === 'semi_monthly';

  const errors = {
    code: !codeTrim ? 'Code is required.' : codeTrim.length < 2 ? 'Code must be at least 2 characters.' : !/^[A-Za-z0-9_-]+$/.test(codeTrim) ? 'Letters, numbers, dash or underscore only.' : null,
    name: !nameTrim ? 'Name is required.' : nameTrim.length < 2 ? 'Name must be at least 2 characters.' : null,
    payDay: payDayNum != null && (!Number.isInteger(payDayNum) || payDayNum < 1 || payDayNum > 31) ? 'Pay day must be between 1 and 31.' : null,
    cutoff: !Number.isInteger(cutoffNum) || cutoffNum < 0 || cutoffNum > 31 ? 'Cut-off offset must be 0–31 days.' : null,
  };
  const valid = !errors.code && !errors.name && !errors.payDay && !errors.cutoff;

  const submit = async (): Promise<void> => {
    if (!valid) return;
    try {
      await createMut.mutateAsync({
        code: codeTrim.toUpperCase(),
        name: nameTrim,
        frequency: f.frequency,
        ...(payDayNum != null ? { defaultPayDay: payDayNum } : {}),
        defaultCutoffOffsetDays: cutoffNum,
      });
      toast('Pay group created.');
      onCreated();
    } catch (e) { void dialog.error(e instanceof Error ? e.message : 'Failed to create pay group.'); }
  };

  const context: DialogContextPanelConfig = {
    eyebrow: 'Finance · Payroll', title: 'Pay Group', description: 'A run scoped to this group inherits its frequency and is populated from its members.',
    preview: { icon: 'PG', title: codeTrim ? codeTrim.toUpperCase() : '—', subtitle: nameTrim || 'Name the group' },
    metrics: [
      { label: 'Frequency', value: humanize(f.frequency), tone: 'info' },
      { label: 'Pay day', value: payDayNum != null ? `Day ${payDayNum}` : '—', tone: 'default' },
      { label: 'Cut-off', value: `${cutoffNum}d`, tone: 'default' },
    ],
    validation: [
      ...(errors.code ? [{ message: errors.code, tone: 'danger' as const }] : []),
      ...(errors.name ? [{ message: errors.name, tone: 'danger' as const }] : []),
      ...(errors.payDay ? [{ message: errors.payDay, tone: 'danger' as const }] : []),
      ...(errors.cutoff ? [{ message: errors.cutoff, tone: 'danger' as const }] : []),
      ...(needsPayDay && payDayNum == null ? [{ message: 'Tip: set a pay day for monthly / semi-monthly groups.', tone: 'warning' as const }] : []),
    ],
    whatNext: [
      { label: 'Assign employees', description: 'Add members from the group’s Members panel.' },
      { label: 'Drives pay runs', description: 'Selecting this group in a new run sets its frequency and population.' },
    ],
  };

  return (
    <EnterpriseFormModal open
      title="New Pay Group"
      subtitle="Define a frequency + population bucket for payroll runs."
      icon={<i class="fas fa-layer-group" />}
      context={context}
      primaryLabel="Create pay group"
      loading={createMut.isPending}
      disabled={!valid}
      onCancel={onClose}
      onSubmit={() => void submit()}>
      <div class="fin-form-grid fin-form-grid--tight">
        <label class="fin-field"><span>Code</span>
          <input type="text" maxLength={20} value={f.code} placeholder="e.g. WKLY-OPS"
            onInput={e => setF(p => ({ ...p, code: (e.currentTarget).value }))} />
          {errors.code && <small class="fin-field-error">{errors.code}</small>}
        </label>
        <label class="fin-field"><span>Name</span>
          <input type="text" maxLength={120} value={f.name} placeholder="e.g. Weekly — Operations"
            onInput={e => setF(p => ({ ...p, name: (e.currentTarget).value }))} />
          {errors.name && <small class="fin-field-error">{errors.name}</small>}
        </label>
        <label class="fin-field"><span>Frequency</span>
          <select value={f.frequency} onChange={e => setF(p => ({ ...p, frequency: (e.currentTarget).value as PayGroup['frequency'] }))}>
            {FREQUENCIES.map(fq => <option value={fq.value} key={fq.value}>{fq.label}</option>)}
          </select>
        </label>
        <label class="fin-field"><span>Default pay day {needsPayDay ? '' : '(optional)'}</span>
          <input type="number" min="1" max="31" value={f.defaultPayDay} placeholder="1–31"
            onInput={e => setF(p => ({ ...p, defaultPayDay: (e.currentTarget).value }))} />
          {errors.payDay && <small class="fin-field-error">{errors.payDay}</small>}
        </label>
        <label class="fin-field"><span>Cut-off (days before pay day)</span>
          <input type="number" min="0" max="31" value={f.cutoff}
            onInput={e => setF(p => ({ ...p, cutoff: (e.currentTarget).value }))} />
          {errors.cutoff && <small class="fin-field-error">{errors.cutoff}</small>}
        </label>
      </div>
    </EnterpriseFormModal>
  );
}

function PayGroupMembersModal({ group, canManage, onClose }: { group: PayGroup; canManage: boolean; onClose: () => void }): VNode {
  const membersQ = usePayGroupMembers(group.id);
  const empsQ = useHrEmployees({ limit: 1000 });
  const assignMut = usePayrollMutation(financePayrollApi.assignPayGroup);

  const nameOf = useMemo(() => {
    const m = new Map((empsQ.data ?? []).map(e => [e.id, empName(e)]));
    return (id: string) => m.get(id) ?? id;
  }, [empsQ.data]);

  const [empId, setEmpId] = useState<string | null>(null);
  const [effFrom, setEffFrom] = useState<string>(todayIso());

  const members = membersQ.data ?? [];
  const alreadyMember = !!empId && members.some(m => m.employeeId === empId && m.effectiveTo == null);
  const canAdd = canManage && !!empId && !!effFrom && !alreadyMember;

  const addMember = async (): Promise<void> => {
    if (!canAdd || !empId) return;
    try {
      await assignMut.mutateAsync({ employeeId: empId, payGroupId: group.id, effectiveFrom: effFrom });
      toast('Employee assigned to pay group.');
      setEmpId(null);
      void membersQ.refetch();
    } catch (e) { void dialog.error(e instanceof Error ? e.message : 'Failed to assign employee.'); }
  };

  const context: DialogContextPanelConfig = {
    eyebrow: 'Finance · Payroll', title: group.name, description: `Members of ${group.code} (${humanize(group.frequency)}).`,
    preview: { icon: 'PG', title: group.code, subtitle: `${members.length} member${members.length === 1 ? '' : 's'}` },
    metrics: [
      { label: 'Members', value: String(members.length), tone: 'info' },
      { label: 'Frequency', value: humanize(group.frequency), tone: 'default' },
    ],
    validation: [
      ...(alreadyMember ? [{ message: 'That employee is already an active member.', tone: 'warning' as const }] : []),
      ...(!canManage ? [{ message: 'You can view members but not assign — requires pay-group management permission.', tone: 'info' as const }] : []),
    ],
    whatNext: [
      { label: 'Population', description: 'Members are picked up when a run is scoped to this group.' },
    ],
  };

  return (
    <EnterpriseFormModal open
      title="Pay Group Members"
      subtitle={`${group.code} — assign employees and review membership`}
      icon={<i class="fas fa-users" />}
      context={context}
      primaryLabel={canManage ? 'Assign employee' : 'Close'}
      loading={assignMut.isPending}
      disabled={canManage ? !canAdd : false}
      cancelLabel="Close"
      onCancel={onClose}
      onSubmit={() => (canManage ? void addMember() : onClose())}>
      <div class="fin-form-grid fin-form-grid--tight">
        {canManage && (
          <>
            <EmployeePicker label="Employee" value={empId} onChange={setEmpId} required
              error={alreadyMember ? 'Already an active member' : null} />
            <label class="fin-field"><span>Effective from</span>
              <input type="date" value={effFrom} onInput={e => setEffFrom((e.currentTarget).value)} />
            </label>
          </>
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--hrfin-text-secondary)', marginBottom: 8 }}>
          Current members
        </div>
        {membersQ.isLoading && !membersQ.data ? (
          <div class="hrfin-empty" style={{ padding: 16 }}>Loading members…</div>
        ) : membersQ.isError ? (
          <div class="fin-field-error" style={{ padding: 8 }}>{(membersQ.error)?.message ?? 'Failed to load members.'}</div>
        ) : members.length === 0 ? (
          <div class="hrfin-empty" style={{ padding: 16 }}>No employees assigned yet.</div>
        ) : (
          <table class="obx-table">
            <thead><tr><th>Employee</th><th>Effective from</th><th>Effective to</th></tr></thead>
            <tbody>{members.map(m => (
              <tr key={`${m.employeeId}-${m.effectiveFrom}`}>
                <td>{nameOf(m.employeeId)}</td>
                <td class="obx-meta">{fmtDate(m.effectiveFrom)}</td>
                <td class="obx-meta">{m.effectiveTo ? fmtDate(m.effectiveTo) : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </EnterpriseFormModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Overtime Rules
// ═══════════════════════════════════════════════════════════════════════════════

function ruleWindowTone(r: OvertimeRule): HrfinTone {
  if (!r.active) return 'bad';
  const today = todayIso();
  if (r.effectiveFrom > today) return 'wn';               // future
  if (r.effectiveTo != null && r.effectiveTo < today) return 'nu'; // expired window
  return 'ok';
}

function OvertimeRulesPanel(): VNode {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);

  const canManage = useCan('finance.payroll.overtime.rules.manage');
  const rulesQ = useOvertimeRules();
  const setActiveMut = usePayrollMutation(financePayrollApi.setOvertimeRuleActive);
  const rules = rulesQ.data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rules;
    return rules.filter(r => r.code.toLowerCase().includes(q) || r.eventType.includes(q));
  }, [rules, search]);
  const { rows, pageCount, total } = useMemo(() => paginate(filtered, page), [filtered, page]);

  const activeCount = rules.filter(r => r.active).length;
  const distinctTypes = new Set(rules.filter(r => r.active).map(r => r.eventType)).size;

  const toggleActive = async (r: OvertimeRule): Promise<void> => {
    const confirmed = await dialog.confirm({
      title: r.active ? `Deactivate ${r.code}?` : `Activate ${r.code}?`,
      text: r.active
        ? 'Deactivating this rule means overtime of this type falls back to the entry’s own multiplier until another active rule covers it.'
        : 'Activating this rule means approved overtime of this type will be priced at its multiplier at lock-inputs time.',
      confirmText: r.active ? 'Deactivate' : 'Activate',
      icon: 'question',
    });
    if (!confirmed) return;
    try { await setActiveMut.mutateAsync({ id: r.id, active: !r.active }); toast(r.active ? 'Rule deactivated.' : 'Rule activated.'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Action failed.'); }
  };

  const today = todayIso();
  const coversType = (t: OvertimeEventType): OvertimeRule | undefined => rules
    .filter(r => r.eventType === t && r.active && r.effectiveFrom <= today && (r.effectiveTo == null || r.effectiveTo >= today))
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0];

  // The finance_overtime_rules table ships with migration 20260918000070. Surface a
  // clear message (not a silent empty) when that migration hasn't been applied yet.
  const loadError = rulesQ.isError
    ? (/overtime_rules|schema cache|does not exist/i.test((rulesQ.error)?.message ?? '')
        ? 'Overtime rules are unavailable — apply migration 20260918000070 (finance_overtime_rules) and reload the PostgREST schema.'
        : ((rulesQ.error)?.message ?? 'Failed to load overtime rules.'))
    : undefined;

  return (
    <div class="pps">
      {/* Overtime reads as an event-coverage board — the 5 T&T event types are the hero. */}
      <div class="pps-slim">
        <div class="lead"><div class="pps-sico">O</div><div><strong>Overtime rules</strong><span class="sub">Approved OT is priced by the active rule for its event type at lock-inputs (latest effective-from wins).</span></div></div>
        <div class="actions">
          <button type="button" onClick={() => { void rulesQ.refetch(); }}>Refresh</button>
          {canManage && <button type="button" class="is-primary" onClick={() => setShowNew(true)}>+ New rule</button>}
        </div>
      </div>

      <div class="pps-otboard" aria-label="Event-type coverage">
        {OT_EVENT_TYPES.map(t => {
          const rule = coversType(t.value);
          return (
            <div class="pps-ottile" data-on={rule ? 'true' : 'false'} key={t.value}>
              <div class="pps-ottile-head"><span class="pps-otdot" /><span>{t.label}</span></div>
              <div class="pps-otmult">{rule ? `${rule.multiplier}×` : '—'}</div>
              <div class="pps-otsub">{rule ? 'Active rule' : 'No active rule'} · typical {t.typical}×</div>
            </div>
          );
        })}
      </div>

      <section class="pps-card">
        <div class="pps-sechead">
          <div class="pps-sico">O</div>
          <div><strong>All overtime rules</strong><span>{activeCount} active · {distinctTypes} of {OT_EVENT_TYPES.length} event types covered</span></div>
        </div>
        <div class="pps-toolbar">
          <input aria-label="Search overtime rules" value={search} placeholder="Search by code or event type…"
            onInput={e => { setSearch(e.currentTarget.value); setPage(0); }} />
          <span>{filtered.length} rule{filtered.length === 1 ? '' : 's'}</span>
        </div>
        <div class="pps-register" aria-live="polite">
          {rulesQ.isLoading && !rulesQ.data ? <div class="pps-state">Loading overtime rules…</div>
            : loadError ? <div class="pps-state is-error">{loadError} <button onClick={() => void rulesQ.refetch()}>Retry</button></div>
            : rows.length === 0 ? <div class="pps-state">{search ? 'No rules match your search.' : 'No overtime rules yet — add the first one.'}</div>
            : (
              <table>
                <thead><tr><th>Rule</th><th>Event type</th><th class="num">Multiplier</th><th class="num">Min hours</th><th>Effective</th><th>Status</th>{canManage && <th aria-label="Actions" />}</tr></thead>
                <tbody>{rows.map(r => (
                  <tr key={r.id}>
                    <td><div class="pps-pkg"><span class="pps-glyph">{otEventLabel(r.eventType).slice(0, 2).toUpperCase()}</span><div><strong>{r.code}</strong><small>{r.multiplier}× multiplier</small></div></div></td>
                    <td>{otEventLabel(r.eventType)}</td>
                    <td class="num" style={{ fontWeight: 600 }}>{r.multiplier}×</td>
                    <td class="num">{r.minimumHours != null ? `${r.minimumHours}h` : '—'}</td>
                    <td>{fmtDate(r.effectiveFrom)}{r.effectiveTo ? ` → ${fmtDate(r.effectiveTo)}` : ' →'}</td>
                    <td><HrfinPill tone={ruleWindowTone(r)}>{r.active ? 'Active' : 'Inactive'}</HrfinPill></td>
                    {canManage && <td><button type="button" onClick={() => void toggleActive(r)}>{r.active ? 'Deactivate' : 'Activate'}</button></td>}
                  </tr>
                ))}</tbody>
              </table>
            )}
        </div>
        {pageCount > 1 && (
          <div class="pps-footer">
            <span>{`Showing ${rows.length} of ${total}`}</span>
            <div><button type="button" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Previous</button><button type="button" disabled={page + 1 >= pageCount} onClick={() => setPage(p => p + 1)}>Next</button></div>
          </div>
        )}
      </section>

      {showNew && <NewOvertimeRuleModal onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); void rulesQ.refetch(); }} />}
    </div>
  );
}

function NewOvertimeRuleModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }): VNode {
  const createMut = usePayrollMutation(financePayrollApi.createOvertimeRule);
  const [f, setF] = useState<{ code: string; eventType: OvertimeEventType; multiplier: string; minHours: string; effFrom: string; effTo: string }>(
    { code: '', eventType: 'regular_overtime', multiplier: '1.5', minHours: '', effFrom: todayIso(), effTo: '' },
  );

  const codeTrim = f.code.trim();
  const multNum = Number(f.multiplier);
  const minNum = f.minHours === '' ? null : Number(f.minHours);

  const errors = {
    code: !codeTrim ? 'Code is required.' : codeTrim.length < 2 ? 'Code must be at least 2 characters.' : !/^[A-Za-z0-9_-]+$/.test(codeTrim) ? 'Letters, numbers, dash or underscore only.' : null,
    multiplier: !(multNum > 0) ? 'Multiplier must be greater than 0.' : multNum > 10 ? 'Multiplier looks too high (max 10×).' : null,
    minHours: minNum != null && (!(minNum > 0) || minNum > 24) ? 'Minimum hours must be between 0 and 24.' : null,
    effFrom: !f.effFrom ? 'Effective-from date is required.' : null,
    effTo: f.effTo && f.effTo < f.effFrom ? 'Effective-to cannot be before effective-from.' : null,
  };
  const valid = !errors.code && !errors.multiplier && !errors.minHours && !errors.effFrom && !errors.effTo;

  const submit = async (): Promise<void> => {
    if (!valid) return;
    try {
      await createMut.mutateAsync({
        code: codeTrim.toUpperCase(),
        eventType: f.eventType,
        multiplier: multNum,
        ...(minNum != null ? { minimumHours: minNum } : {}),
        effectiveFrom: f.effFrom,
        ...(f.effTo ? { effectiveTo: f.effTo } : {}),
      });
      toast('Overtime rule created.');
      onCreated();
    } catch (e) { void dialog.error(e instanceof Error ? e.message : 'Failed to create overtime rule.'); }
  };

  const typical = OT_EVENT_TYPES.find(o => o.value === f.eventType)?.typical;
  const context: DialogContextPanelConfig = {
    eyebrow: 'Finance · Payroll', title: 'Overtime Rule', description: 'Effective-dated multiplier applied to approved overtime of this event type.',
    preview: { icon: 'OT', title: codeTrim ? codeTrim.toUpperCase() : '—', subtitle: `${otEventLabel(f.eventType)} · ${multNum > 0 ? multNum : '—'}×` },
    metrics: [
      { label: 'Event type', value: otEventLabel(f.eventType), tone: 'info' },
      { label: 'Multiplier', value: multNum > 0 ? `${multNum}×` : '—', tone: 'default' },
      { label: 'Min hours', value: minNum != null ? `${minNum}h` : '—', tone: 'muted' },
    ],
    validation: [
      ...(errors.code ? [{ message: errors.code, tone: 'danger' as const }] : []),
      ...(errors.multiplier ? [{ message: errors.multiplier, tone: 'danger' as const }] : []),
      ...(errors.minHours ? [{ message: errors.minHours, tone: 'danger' as const }] : []),
      ...(errors.effTo ? [{ message: errors.effTo, tone: 'danger' as const }] : []),
      ...(typical && multNum > 0 && multNum !== typical ? [{ message: `Typical T&T ${otEventLabel(f.eventType).toLowerCase()} rate is ${typical}×.`, tone: 'warning' as const }] : []),
    ],
    whatNext: [
      { label: 'Prices overtime', description: 'Approved OT of this type is priced at this multiplier at lock-inputs.' },
      { label: 'Effective-dated', description: 'The active rule with the latest effective-from covering the work date wins.' },
    ],
  };

  return (
    <EnterpriseFormModal open
      title="New Overtime Rule"
      subtitle="Configure an overtime multiplier for an event type."
      icon={<i class="fas fa-clock" />}
      context={context}
      primaryLabel="Create rule"
      loading={createMut.isPending}
      disabled={!valid}
      onCancel={onClose}
      onSubmit={() => void submit()}>
      <div class="fin-form-grid fin-form-grid--tight">
        <label class="fin-field"><span>Code</span>
          <input type="text" maxLength={20} value={f.code} placeholder="e.g. OT-HOLIDAY"
            onInput={e => setF(p => ({ ...p, code: (e.currentTarget).value }))} />
          {errors.code && <small class="fin-field-error">{errors.code}</small>}
        </label>
        <label class="fin-field"><span>Event type</span>
          <select value={f.eventType} onChange={e => {
            const eventType = (e.currentTarget).value as OvertimeEventType;
            const t = OT_EVENT_TYPES.find(o => o.value === eventType)?.typical;
            setF(p => ({ ...p, eventType, multiplier: t != null ? String(t) : p.multiplier }));
          }}>
            {OT_EVENT_TYPES.map(o => <option value={o.value} key={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label class="fin-field"><span>Multiplier</span>
          <input type="number" step="0.05" min="0" value={f.multiplier}
            onInput={e => setF(p => ({ ...p, multiplier: (e.currentTarget).value }))} />
          {errors.multiplier && <small class="fin-field-error">{errors.multiplier}</small>}
        </label>
        <label class="fin-field"><span>Minimum billable hours (optional)</span>
          <input type="number" step="0.5" min="0" value={f.minHours} placeholder="e.g. 3 for call-outs"
            onInput={e => setF(p => ({ ...p, minHours: (e.currentTarget).value }))} />
          {errors.minHours && <small class="fin-field-error">{errors.minHours}</small>}
        </label>
        <label class="fin-field"><span>Effective from</span>
          <input type="date" value={f.effFrom} onInput={e => setF(p => ({ ...p, effFrom: (e.currentTarget).value }))} />
          {errors.effFrom && <small class="fin-field-error">{errors.effFrom}</small>}
        </label>
        <label class="fin-field"><span>Effective to (optional)</span>
          <input type="date" min={f.effFrom} value={f.effTo} onInput={e => setF(p => ({ ...p, effTo: (e.currentTarget).value }))} />
          {errors.effTo && <small class="fin-field-error">{errors.effTo}</small>}
        </label>
      </div>
    </EnterpriseFormModal>
  );
}
