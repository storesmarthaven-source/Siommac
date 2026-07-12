/**
 * src/components/sections/Finance/DisbursementsOverview.tsx
 *
 * Finance ▸ Payroll Bank Disbursements (F2) — Aurora rebuild.
 * Tabs: Disbursements · Lines · Bank Accounts · Bank Files · Payments · Reports
 * KPIs: Pending, Approved, Generated bank files, Paid MTD, Missing bank accounts, Failed lines
 *
 * Replaces the old `hr-offboarding fin-page` / `obx-*` shell with the Aurora
 * `.hrfin` system (HrfinPageHeader + QuickActionStrip + KpiCard strip + HrfinTable).
 *
 * Zero legacy classes: no obx-*, no hr-offboarding, no fin-page.
 */

import { type VNode } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import { toast } from '@store';
import { can } from '@lib/permissions';
import {
  HrfinPageHeader,
  QuickActionStrip,
  KpiCard,
  HrfinTable,
  HrfinPill,
  TrendArea,
  type HrfinColumn,
  type HrfinTone,
} from '@ui';
import {
  useDisbursements,
  useDisbursementKpis,
  useDisbursementLinesDetail,
  useDisbursementReport,
  useDisbursementAuditLog,
  useFinanceAuditLog,
  useBankFileStatusReport,
  useBankAccountReadinessReport,
  useDisbursementMutation,
  financeDisbursementsApi,
  type Disbursement,
  type DisbursementStatus,
  type BankFileStatusRow,
  type BankAccountReadinessRow,
} from '@api/finance/disbursements';
import {
  useBankAccounts,
  useBankAccountMutation,
  financeBankAccountsApi,
  type BankAccount,
} from '@api/finance/bankAccounts';
import { useEmployeeNames } from '@api/finance/lookups';
import { EmployeeCellResolved, EmployeeCell } from './_shared/EmployeeCell';
import { EmployeePicker } from './_shared/pickers';
import { ReportPanel, type ReportColumn } from './_shared/reports';
import { DisbComputeWizard } from './DisbComputeWizard';
import { DisbDrawer, type DisbDrawerActions, type DisbDrawerTab } from './DisbDrawer';
import { money } from './hrfinFormat';
import { dialog } from '@lib/dialog';

// ── Formatters ────────────────────────────────────────────────────────────────

const fmtDate = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const humanize = (s: string): string =>
  s.replace(/[_]/g, ' ').replace(/\b\w/g, m => m.toUpperCase());

function disbStatusTone(s: DisbursementStatus): HrfinTone {
  switch (s) {
    case 'paid':           return 'ok';
    case 'approved':       return 'ok';
    case 'file_generated': return 'nu';
    case 'submitted':      return 'wn';
    case 'draft':          return 'dr';
    case 'cancelled':      return 'bad';
    default:               return 'dr';
  }
}

// ── Page-level tab set ────────────────────────────────────────────────────────

type PageTab = 'disbursements' | 'lines' | 'bank-accounts' | 'bank-files' | 'payments' | 'reports';
const PAGE_TABS: { key: PageTab; label: string }[] = [
  { key: 'disbursements',  label: 'Disbursements' },
  { key: 'lines',          label: 'Lines' },
  { key: 'bank-accounts',  label: 'Bank Accounts' },
  { key: 'bank-files',     label: 'Bank Files' },
  { key: 'payments',       label: 'Payments' },
  { key: 'reports',        label: 'Reports' },
];

// ── Client-side pagination helper ────────────────────────────────────────────

const PAGE_SIZE = 25;
function paginate<T>(rows: T[], page: number): { rows: T[]; pageCount: number; total: number } {
  return {
    rows:      rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    pageCount: Math.max(1, Math.ceil(rows.length / PAGE_SIZE)),
    total:     rows.length,
  };
}

// ── CSV export helper ─────────────────────────────────────────────────────────

function downloadCsv(headers: string[], rows: string[][], filename: string): void {
  const esc = (v: string) => (v.includes(',') || v.includes('"') || v.includes('\n'))
    ? `"${v.replace(/"/g, '""')}"`
    : v;
  const csv = [headers, ...rows].map(r => r.map(esc).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Disbursements tab ─────────────────────────────────────────────────────────

type SortKey = 'disbursementNo' | 'totalAmount' | 'employeeCount' | 'status' | 'createdAt';
type SortDir = 'asc' | 'desc';

function DisbursementsTab({
  canManage,
  canApprove,
  onOpenDrawer,
  onCreated,
}: {
  canManage: boolean;
  canApprove: boolean;
  onOpenDrawer: (id: string) => void;
  onCreated: () => void;
}): VNode {
  const [search, setSearch]       = useState('');
  const [statusFilter, setStatus] = useState<DisbursementStatus | ''>('');
  const [page, setPage]           = useState(0);
  const [wizOpen, setWizOpen]     = useState(false);
  const [sortKey, setSortKey]     = useState<SortKey>('createdAt');
  const [sortDir, setSortDir]     = useState<SortDir>('desc');

  const allQ = useDisbursements();
  const disbursements = allQ.data ?? [];

  function toggleSort(key: SortKey): void {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
    setPage(0);
  }

  const filtered = useMemo(() => {
    let rows = disbursements;
    if (statusFilter) rows = rows.filter(d => d.status === statusFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(d =>
        d.disbursementNo.toLowerCase().includes(q) ||
        d.currency.toLowerCase().includes(q),
      );
    }
    // Client-side sort
    rows = [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'disbursementNo') cmp = a.disbursementNo.localeCompare(b.disbursementNo);
      else if (sortKey === 'totalAmount') cmp = a.totalAmount - b.totalAmount;
      else if (sortKey === 'employeeCount') cmp = a.employeeCount - b.employeeCount;
      else if (sortKey === 'status') cmp = a.status.localeCompare(b.status);
      else cmp = a.createdAt.localeCompare(b.createdAt);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [disbursements, search, statusFilter, sortKey, sortDir]);

  const paged = paginate(filtered, page);

  const submitMut   = useDisbursementMutation(financeDisbursementsApi.submit);
  const approveMut  = useDisbursementMutation(financeDisbursementsApi.approve);
  const genFileMut  = useDisbursementMutation(financeDisbursementsApi.generateFile);
  const markPaidMut = useDisbursementMutation(financeDisbursementsApi.markPaid);
  const cancelMut   = useDisbursementMutation(financeDisbursementsApi.cancel);

  async function run(p: Promise<unknown>, ok: string): Promise<void> {
    try { await p; toast(ok); }
    catch (e) { toast((e as Error).message ?? 'Action failed.'); }
  }

  const sortArrow = (key: SortKey) => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  function handleExport(): void {
    const headers = ['Reference', 'Employees', 'Net Pay', 'Currency', 'Status', 'Created'];
    const rows = filtered.map(d => [
      d.disbursementNo,
      String(d.employeeCount),
      String(d.totalAmount),
      d.currency,
      d.status,
      fmtDate(d.createdAt),
    ]);
    downloadCsv(headers, rows, 'disbursements-export.csv');
  }

  const COLS: HrfinColumn<Disbursement>[] = [
    {
      key: 'ref',
      label: 'Reference' + sortArrow('disbursementNo'),
      render: d => <strong style={{ fontFamily: 'monospace', fontSize: 12 }}>{d.disbursementNo}</strong>,
    },
    {
      key: 'employees',
      label: 'Employees' + sortArrow('employeeCount'),
      render: d => <span style={{ color: 'var(--muted)', fontSize: 13 }}>{d.employeeCount}</span>,
    },
    {
      key: 'amount',
      label: 'Net Pay' + sortArrow('totalAmount'),
      render: d => <b>{money(d.totalAmount)}</b>,
    },
    {
      key: 'currency',
      label: 'Currency',
      render: d => <span style={{ color: 'var(--muted)' }}>{d.currency}</span>,
    },
    {
      key: 'status',
      label: 'Status' + sortArrow('status'),
      render: d => <HrfinPill tone={disbStatusTone(d.status)}>{humanize(d.status)}</HrfinPill>,
    },
    {
      key: 'created',
      label: 'Created' + sortArrow('createdAt'),
      render: d => <span style={{ color: 'var(--muted)', fontSize: 12 }}>{fmtDate(d.createdAt)}</span>,
    },
  ];

  return (
    <>
      {canManage && (
        <DisbComputeWizard
          open={wizOpen}
          onClose={() => setWizOpen(false)}
          onCreated={() => { setWizOpen(false); onCreated(); }}
        />
      )}

      {/* Sort + Export controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Sort by:</span>
        {([
          ['disbursementNo', 'Reference'],
          ['totalAmount',    'Net Pay'],
          ['employeeCount',  'Employees'],
          ['status',         'Status'],
          ['createdAt',      'Created'],
        ] as [SortKey, string][]).map(([key, label]) => (
          <button
            key={key}
            type="button"
            class={`hrfin-action${sortKey === key ? ' is-primary' : ''}`}
            style={{ fontSize: 11, padding: '3px 8px' }}
            onClick={() => toggleSort(key)}
          >
            {label}{sortArrow(key)}
          </button>
        ))}
        <div style={{ marginLeft: 'auto' }}>
          <button
            type="button"
            class="hrfin-action"
            style={{ fontSize: 12 }}
            onClick={handleExport}
          >
            Export CSV
          </button>
        </div>
      </div>

      <HrfinTable
        tabs={PAGE_TABS}
        activeTab="disbursements"
        onTab={() => { /* tab change handled by parent */ }}
        searchValue={search}
        onSearch={v => { setSearch(v); setPage(0); }}
        searchPlaceholder="Search disbursements…"
        filters={[
          { label: 'All', onClick: () => { setStatus(''); setPage(0); } },
          { label: 'Draft', onClick: () => { setStatus('draft'); setPage(0); } },
          { label: 'Pending', onClick: () => { setStatus('submitted'); setPage(0); } },
          { label: 'Approved', onClick: () => { setStatus('approved'); setPage(0); } },
          { label: 'Paid', onClick: () => { setStatus('paid'); setPage(0); } },
        ]}
        columns={COLS}
        rows={paged.rows}
        rowKey={d => d.id}
        onRowClick={d => onOpenDrawer(d.id)}
        rowActions={d => [
          ...(canManage && d.status === 'draft' ? [{
            key: 'submit', label: 'Submit for approval', icon: 'send' as const,
            onClick: () => void run(submitMut.mutateAsync({ id: d.id }), 'Submitted.'),
          }] : []),
          ...(canApprove && d.status === 'submitted' ? [{
            key: 'approve', label: 'Approve', icon: 'check' as const,
            onClick: () => void run(approveMut.mutateAsync({ id: d.id }), 'Approved.'),
          }] : []),
          ...(canApprove && d.status === 'approved' ? [{
            key: 'genfile', label: 'Generate bank file', icon: 'file' as const,
            onClick: () => void run(genFileMut.mutateAsync({ id: d.id }), 'Bank file generated.'),
          }] : []),
          ...(canApprove && d.status === 'file_generated' ? [{
            key: 'markpaid', label: 'Mark paid', icon: 'check' as const,
            onClick: () => void run(markPaidMut.mutateAsync({ id: d.id }), 'Marked as paid.'),
          }] : []),
          { key: 'view', label: 'View details', icon: 'file' as const, onClick: () => onOpenDrawer(d.id) },
          ...(canManage && ['draft', 'submitted'].includes(d.status) ? [{
            key: 'cancel', label: 'Cancel', icon: 'close' as const, tone: 'danger' as const,
            onClick: async () => {
              const reason = await dialog.prompt({ title: 'Cancel disbursement', text: 'Reason for cancellation:', confirmText: 'Cancel', cancelText: 'Keep' });
              if (!reason) return;
              await run(cancelMut.mutateAsync({ id: d.id, reason }), 'Cancelled.');
            },
          }] : []),
        ]}
        page={page}
        pageCount={paged.pageCount}
        total={paged.total}
        pageSize={PAGE_SIZE}
        onPage={setPage}
        noun="disbursements"
        loading={allQ.isLoading}
        emptyMessage="No disbursements yet. Use Compute & Create to derive a disbursement from an approved payroll run."
      />
    </>
  );
}

// ── Lines tab ─────────────────────────────────────────────────────────────────

function LinesTab(): VNode {
  const [search, setSearch] = useState('');
  const [page, setPage]     = useState(0);

  // Lines across ALL disbursements — we list all disbursements and show their lines
  const allQ = useDisbursements();
  const disbursements = allQ.data ?? [];

  // Pick the most recent disbursement to show lines for, or let user pick
  const [selectedDisbId, setSelectedDisbId] = useState<string | null>(null);
  const disbId = selectedDisbId ?? disbursements[0]?.id ?? null;

  const linesQ = useDisbursementLinesDetail(disbId);
  const lines  = linesQ.data ?? [];

  const allEmpIds = lines.map(l => l.employeeId);
  const { data: nameMap } = useEmployeeNames(allEmpIds);

  const filtered = useMemo(() => {
    if (!search.trim()) return lines;
    const q = search.trim().toLowerCase();
    return lines.filter(l =>
      l.employeeId.toLowerCase().includes(q) ||
      (l.bankName ?? '').toLowerCase().includes(q),
    );
  }, [lines, search]);

  const paged = paginate(filtered, page);

  type LineRow = typeof lines[number];
  const COLS: HrfinColumn<LineRow>[] = [
    {
      key: 'employee',
      label: 'Employee',
      render: l => <EmployeeCellResolved resolved={nameMap?.get(l.employeeId)} fallbackId={l.employeeId} />,
    },
    {
      key: 'bank',
      label: 'Bank',
      render: l => <span style={{ color: 'var(--muted)', fontSize: 12 }}>{l.bankName ?? '—'}</span>,
    },
    {
      key: 'account',
      label: 'Account (masked)',
      render: l => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{l.accountNumberMasked ?? '—'}</span>,
    },
    {
      key: 'net',
      label: 'Net Pay',
      render: l => <b>{money(l.netAmount)}</b>,
    },
    {
      key: 'status',
      label: 'Bank',
      render: l => l.bankAccountId
        ? <HrfinPill tone="ok">Ready</HrfinPill>
        : <HrfinPill tone="bad">Missing</HrfinPill>,
    },
  ];

  return (
    <div>
      {disbursements.length > 1 && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: 'var(--muted)', marginRight: 8 }}>Disbursement:</label>
          <select
            class="hrfin-input"
            style={{ width: 'auto', fontSize: 12 }}
            value={disbId ?? ''}
            onChange={e => setSelectedDisbId((e.currentTarget).value || null)}
          >
            {disbursements.map(d => (
              <option key={d.id} value={d.id}>{d.disbursementNo} — {humanize(d.status)}</option>
            ))}
          </select>
        </div>
      )}

      <HrfinTable
        searchValue={search}
        onSearch={v => { setSearch(v); setPage(0); }}
        searchPlaceholder="Search lines…"
        columns={COLS}
        rows={paged.rows}
        rowKey={l => l.id}
        page={page}
        pageCount={paged.pageCount}
        total={paged.total}
        pageSize={PAGE_SIZE}
        onPage={setPage}
        noun="lines"
        loading={linesQ.isLoading || allQ.isLoading}
        emptyMessage={disbId ? 'No lines for this disbursement.' : 'No disbursements found.'}
      />
    </div>
  );
}

// ── Bank Accounts tab ─────────────────────────────────────────────────────────

// ── Bank Account Audit Panel ──────────────────────────────────────────────────

function BankAccountAuditPanel({ accountId, onClose }: { accountId: string; onClose: () => void }): VNode {
  const auditQ = useFinanceAuditLog('finance_bank_accounts', accountId);
  const entries = auditQ.data ?? [];
  const fmtDateTime = (iso: string) =>
    new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const humanizeAction = (a: string) =>
    a.replace(/^bank_account\./, '').replace(/\./g, ' → ').replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16, background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Bank Account Audit Log</h3>
        <button type="button" class="hrfin-action" onClick={onClose} style={{ fontSize: 12 }}>Close</button>
      </div>
      {auditQ.isLoading && <div class="hrfin-empty" style={{ fontSize: 12 }}>Loading…</div>}
      {!auditQ.isLoading && entries.length === 0 && (
        <div class="hrfin-empty" style={{ fontSize: 12 }}>No audit entries for this account.</div>
      )}
      {entries.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '4px 8px', textAlign: 'left' }}>Date / Time</th>
              <th style={{ padding: '4px 8px', textAlign: 'left' }}>Action</th>
              <th style={{ padding: '4px 8px', textAlign: 'left' }}>By</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '6px 8px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmtDateTime(e.createdAt)}</td>
                <td style={{ padding: '6px 8px' }}>{humanizeAction(e.action)}</td>
                <td style={{ padding: '6px 8px' }}><EmployeeCell employeeId={e.actorId} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Bank Accounts form ────────────────────────────────────────────────────────

interface BankAccountFormState {
  employeeId:         string | null;
  bankName:           string;
  branch:             string;
  accountType:        'savings' | 'chequing';
  accountNumber:      string;
  transitNumber:      string;
  isPrimary:          boolean;
  routingNumber:      string;
  verificationStatus: 'unverified' | 'pending' | 'verified' | 'failed';
}

const emptyBankForm = (): BankAccountFormState => ({
  employeeId: null, bankName: '', branch: '', accountType: 'savings', accountNumber: '',
  transitNumber: '', isPrimary: true, routingNumber: '', verificationStatus: 'unverified',
});

function BankAccountsTab({ canManage }: { canManage: boolean }): VNode {
  const [search, setSearch]     = useState('');
  const [page, setPage]         = useState(0);
  const [showAdd, setShowAdd]   = useState(false);
  const [editId, setEditId]     = useState<string | null>(null);
  const [form, setForm]         = useState<BankAccountFormState>(emptyBankForm());
  const [errors, setErrors]     = useState<Record<string, string>>({});
  const [auditAcctId, setAuditAcctId] = useState<string | null>(null);

  const listQ       = useBankAccounts({ includeInactive: false });
  const upsertMut   = useBankAccountMutation(financeBankAccountsApi.upsert);
  const deactivateMut = useBankAccountMutation(financeBankAccountsApi.deactivate);

  const accounts = listQ.data ?? [];
  const allEmpIds = accounts.map(a => a.employeeId);
  const { data: nameMap } = useEmployeeNames(allEmpIds);

  const filtered = useMemo(() => {
    if (!search.trim()) return accounts;
    const q = search.trim().toLowerCase();
    return accounts.filter(a =>
      a.bankName.toLowerCase().includes(q) ||
      a.accountNumberMasked.toLowerCase().includes(q),
    );
  }, [accounts, search]);

  const paged = paginate(filtered, page);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.employeeId) e.employeeId = 'Employee is required.';
    if (!form.bankName.trim()) e.bankName = 'Bank name is required.';
    if (form.accountNumber.replace(/\s/g, '').length < 4) e.accountNumber = 'Account number must be at least 4 digits.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async (): Promise<void> => {
    if (!validate()) return;
    try {
      await upsertMut.mutateAsync({
        id:            editId ?? undefined,
        employeeId:    form.employeeId ?? undefined,
        bankName:      form.bankName,
        branch:        form.branch || null,
        accountType:   form.accountType,
        accountNumber: form.accountNumber,
        transitNumber: form.transitNumber || null,
        isPrimary:     form.isPrimary,
        metadata:      {
          routingNumber:      form.routingNumber || null,
          verificationStatus: form.verificationStatus,
        },
      });
      toast(editId ? 'Bank account updated.' : 'Bank account added.');
      setShowAdd(false);
      setEditId(null);
      setForm(emptyBankForm());
      setErrors({});
    } catch (e) {
      toast((e as Error).message ?? 'Failed.');
    }
  };

  const COLS: HrfinColumn<BankAccount>[] = [
    {
      key: 'employee',
      label: 'Employee',
      render: a => <EmployeeCellResolved resolved={nameMap?.get(a.employeeId)} fallbackId={a.employeeId} />,
    },
    {
      key: 'bank',
      label: 'Bank',
      render: a => <span>{a.bankName}{a.branch ? ` · ${a.branch}` : ''}</span>,
    },
    {
      key: 'account',
      label: 'Account (masked)',
      render: a => (
        <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
          {a.accountNumberMasked}
          {a.transitNumber && <span style={{ color: 'var(--muted)', display: 'block', fontSize: 11 }}>transit {a.transitNumber}</span>}
        </span>
      ),
    },
    {
      key: 'routing',
      label: 'Routing / IFSC',
      render: a => <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--muted)' }}>
        {(a.metadata?.routingNumber as string) || '—'}
      </span>,
    },
    {
      key: 'type',
      label: 'Type',
      render: a => <span style={{ color: 'var(--muted)', fontSize: 12 }}>{humanize(a.accountType)}</span>,
    },
    {
      key: 'primary',
      label: 'Default',
      render: a => a.isPrimary ? <HrfinPill tone="ok">Primary</HrfinPill> : <HrfinPill tone="dr">Secondary</HrfinPill>,
    },
    {
      key: 'verification',
      label: 'Verification',
      render: a => {
        const vs = (a.metadata?.verificationStatus as string) ?? 'unverified';
        const tone: HrfinTone = vs === 'verified' ? 'ok' : vs === 'failed' ? 'bad' : vs === 'pending' ? 'wn' : 'dr';
        return <HrfinPill tone={tone}>{humanize(vs)}</HrfinPill>;
      },
    },
    {
      key: 'updated',
      label: 'Last Updated',
      render: a => <span style={{ color: 'var(--muted)', fontSize: 12 }}>{fmtDate(a.updatedAt)}</span>,
    },
  ];

  return (
    <div>
      {/* Inline add / edit form */}
      {(showAdd || editId) && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16, background: 'var(--surface)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>{editId ? 'Edit Bank Account' : 'Add Bank Account'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <EmployeePicker
                label="Employee"
                value={form.employeeId}
                onChange={v => { setForm(f => ({ ...f, employeeId: v })); setErrors(e => { const n = { ...e }; delete n.employeeId; return n; }); }}
                error={errors.employeeId ?? null}
                required
              />
            </div>
            <label>
              <span class="hrfin-wiz-label">Bank name *</span>
              <input
                class="hrfin-input"
                placeholder="e.g. Republic Bank"
                value={form.bankName}
                onInput={e => { setForm(f => ({ ...f, bankName: (e.currentTarget).value })); setErrors(er => { const n = { ...er }; delete n.bankName; return n; }); }}
              />
              {errors.bankName && <span style={{ color: 'var(--danger, #d33)', fontSize: 11 }}>{errors.bankName}</span>}
            </label>
            <label>
              <span class="hrfin-wiz-label">Branch (optional)</span>
              <input
                class="hrfin-input"
                placeholder="e.g. Port of Spain"
                value={form.branch}
                onInput={e => setForm(f => ({ ...f, branch: (e.currentTarget).value }))}
              />
            </label>
            <label>
              <span class="hrfin-wiz-label">Account type</span>
              <select
                class="hrfin-input"
                value={form.accountType}
                onChange={e => setForm(f => ({ ...f, accountType: (e.currentTarget).value as 'savings' | 'chequing' }))}
              >
                <option value="savings">Savings</option>
                <option value="chequing">Chequing</option>
              </select>
            </label>
            <label>
              <span class="hrfin-wiz-label">Account number *</span>
              <input
                class="hrfin-input"
                placeholder="Full account number"
                value={form.accountNumber}
                onInput={e => { setForm(f => ({ ...f, accountNumber: (e.currentTarget).value })); setErrors(er => { const n = { ...er }; delete n.accountNumber; return n; }); }}
              />
              {errors.accountNumber && <span style={{ color: 'var(--danger, #d33)', fontSize: 11 }}>{errors.accountNumber}</span>}
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>Stored masked — only last 4 digits visible.</span>
            </label>
            <label>
              <span class="hrfin-wiz-label">Branch transit number (optional)</span>
              <input
                class="hrfin-input"
                placeholder="e.g. 001"
                value={form.transitNumber}
                onInput={e => setForm(f => ({ ...f, transitNumber: (e.currentTarget).value }))}
              />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>Branch routing/transit written into the direct-credit bank file.</span>
            </label>
            <label>
              <span class="hrfin-wiz-label">Routing / IFSC number (optional)</span>
              <input
                class="hrfin-input"
                placeholder="e.g. 026009593"
                value={form.routingNumber}
                onInput={e => setForm(f => ({ ...f, routingNumber: (e.currentTarget).value }))}
              />
            </label>
            <label>
              <span class="hrfin-wiz-label">Verification status</span>
              <select
                class="hrfin-input"
                value={form.verificationStatus}
                onChange={e => setForm(f => ({ ...f, verificationStatus: (e.currentTarget).value as BankAccountFormState['verificationStatus'] }))}
              >
                <option value="unverified">Unverified</option>
                <option value="pending">Pending verification</option>
                <option value="verified">Verified</option>
                <option value="failed">Failed</option>
              </select>
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, gridColumn: '1 / -1' }}>
              <input
                type="checkbox"
                id="isPrimary"
                checked={form.isPrimary}
                onChange={e => setForm(f => ({ ...f, isPrimary: (e.currentTarget).checked }))}
              />
              <label for="isPrimary" style={{ fontSize: 13 }}>Set as primary (default) account</label>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button
              type="button"
              class="hrfin-action is-primary"
              onClick={() => void save()}
              disabled={upsertMut.isPending}
            >
              {upsertMut.isPending ? 'Saving…' : (editId ? 'Save changes' : 'Add account')}
            </button>
            <button
              type="button"
              class="hrfin-action"
              onClick={() => { setShowAdd(false); setEditId(null); setForm(emptyBankForm()); setErrors({}); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Toolbar — Add Bank Account button */}
      {canManage && !showAdd && !editId && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <button
            type="button"
            class="hrfin-action is-primary"
            onClick={() => { setShowAdd(true); setAuditAcctId(null); setForm(emptyBankForm()); setErrors({}); }}
          >
            + Add Bank Account
          </button>
        </div>
      )}

      {/* Inline audit trail panel — shown when "View audit" row action is clicked */}
      {auditAcctId && (
        <BankAccountAuditPanel
          accountId={auditAcctId}
          onClose={() => setAuditAcctId(null)}
        />
      )}

      <HrfinTable
        searchValue={search}
        onSearch={v => { setSearch(v); setPage(0); }}
        searchPlaceholder="Search bank accounts…"
        columns={COLS}
        rows={paged.rows}
        rowKey={a => a.id}
        rowActions={a => [
          {
            key: 'edit', label: 'Edit', icon: 'user' as const,
            disabled: !canManage,
            disabledReason: 'Requires finance.bank_accounts.manage',
            onClick: () => {
              setEditId(a.id);
              setForm({
                employeeId:         a.employeeId,
                bankName:           a.bankName,
                branch:             a.branch ?? '',
                accountType:        a.accountType,
                accountNumber:      '',
                transitNumber:      a.transitNumber ?? '',
                isPrimary:          a.isPrimary,
                routingNumber:      (a.metadata?.routingNumber as string) ?? '',
                verificationStatus: ((a.metadata?.verificationStatus as string) ?? 'unverified') as BankAccountFormState['verificationStatus'],
              });
              setShowAdd(false);
              setAuditAcctId(null);
            },
          },
          {
            key: 'view-audit', label: 'View audit', icon: 'book' as const,
            onClick: () => { setAuditAcctId(a.id); setShowAdd(false); setEditId(null); },
          },
          {
            key: 'deactivate', label: 'Deactivate', icon: 'close' as const, tone: 'danger' as const,
            disabled: !canManage || !a.isActive,
            disabledReason: !canManage ? 'Requires finance.bank_accounts.manage' : 'Already inactive',
            onClick: async () => {
              try {
                await deactivateMut.mutateAsync({ id: a.id });
                toast('Bank account deactivated.');
              } catch (e) {
                toast((e as Error).message ?? 'Failed.');
              }
            },
          },
        ]}
        page={page}
        pageCount={paged.pageCount}
        total={paged.total}
        pageSize={PAGE_SIZE}
        onPage={setPage}
        noun="bank accounts"
        loading={listQ.isLoading}
        emptyMessage="No active bank accounts found. Add one using the button above."
      />
    </div>
  );
}

// ── Bank Files tab ────────────────────────────────────────────────────────────

function BankFilesTab({ canApprove, onOpenDrawer }: { canApprove: boolean; onOpenDrawer: (id: string, tab: DisbDrawerTab) => void }): VNode {
  const [search, setSearch] = useState('');
  const [page, setPage]     = useState(0);

  const allQ = useDisbursements();
  const withFiles = (allQ.data ?? []).filter(d => !!d.bankFilePath);

  const filtered = useMemo(() => {
    if (!search.trim()) return withFiles;
    const q = search.trim().toLowerCase();
    return withFiles.filter(d =>
      d.disbursementNo.toLowerCase().includes(q) ||
      (d.bankFilePath ?? '').toLowerCase().includes(q),
    );
  }, [withFiles, search]);

  const paged = paginate(filtered, page);

  const getUrlMut = useDisbursementMutation(financeDisbursementsApi.bankFileUrl);

  async function download(d: Disbursement): Promise<void> {
    try {
      const res = await getUrlMut.mutateAsync({ disbursementId: d.id });
      window.open(res.signedUrl, '_blank');
    } catch (e) {
      toast((e as Error).message ?? 'Download failed.');
    }
  }

  type D = Disbursement;
  const COLS: HrfinColumn<D>[] = [
    {
      key: 'filename',
      label: 'File Name',
      render: d => (
        <span style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>
          {(d.bankFilePath ?? '').split('/').pop()}
        </span>
      ),
    },
    {
      key: 'disbursement',
      label: 'Disbursement',
      render: d => <strong style={{ fontSize: 12 }}>{d.disbursementNo}</strong>,
    },
    {
      key: 'format',
      label: 'Format',
      render: () => <span style={{ color: 'var(--muted)', fontSize: 12 }}>Direct credit (per bank)</span>,
    },
    {
      key: 'bank-files',
      label: 'Bank Files',
      render: d => {
        const n = Number(d.metadata?.bankFileCount ?? 0);
        return <span style={{ color: 'var(--muted)', fontSize: 12 }}>{n ? `${n} file${n === 1 ? '' : 's'}` : '—'}</span>;
      },
    },
    {
      key: 'generated-by',
      label: 'Generated By',
      render: d => <EmployeeCell employeeId={(d.metadata?.fileGeneratedBy as string) ?? null} />,
    },
    {
      key: 'employees',
      label: 'Lines',
      render: d => <span style={{ color: 'var(--muted)', fontSize: 12 }}>{d.employeeCount}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      render: d => <HrfinPill tone={disbStatusTone(d.status)}>{humanize(d.status)}</HrfinPill>,
    },
    {
      key: 'created',
      label: 'Generated At',
      render: d => <span style={{ color: 'var(--muted)', fontSize: 12 }}>
        {(d.metadata?.fileGeneratedAt as string) ? fmtDate(d.metadata.fileGeneratedAt as string) : fmtDate(d.updatedAt)}
      </span>,
    },
  ];

  return (
    <HrfinTable
      searchValue={search}
      onSearch={v => { setSearch(v); setPage(0); }}
      searchPlaceholder="Search bank files…"
      columns={COLS}
      rows={paged.rows}
      rowKey={d => d.id}
      onRowClick={d => onOpenDrawer(d.id, 'bank-file')}
      rowActions={d => [
        {
          key: 'view-files', label: 'View per-bank files', icon: 'file' as const,
          onClick: () => onOpenDrawer(d.id, 'bank-file'),
        },
        {
          key: 'download', label: 'Download manifest', icon: 'download' as const,
          disabled: !canApprove || !d.bankFilePath,
          disabledReason: !canApprove ? 'Requires finance.disbursement.bank_file.download' : 'No file generated',
          onClick: () => void download(d),
        },
      ]}
      page={page}
      pageCount={paged.pageCount}
      total={paged.total}
      pageSize={PAGE_SIZE}
      onPage={setPage}
      noun="bank files"
      loading={allQ.isLoading}
      emptyMessage="No bank files generated yet."
    />
  );
}

// ── Payments tab ──────────────────────────────────────────────────────────────

function PaymentsTab(): VNode {
  const [search, setSearch] = useState('');
  const [page, setPage]     = useState(0);

  const allQ = useDisbursements({ status: 'paid' });
  const paid = allQ.data ?? [];

  const filtered = useMemo(() => {
    if (!search.trim()) return paid;
    const q = search.trim().toLowerCase();
    return paid.filter(d => d.disbursementNo.toLowerCase().includes(q));
  }, [paid, search]);

  const paged = paginate(filtered, page);

  type D = Disbursement;
  const COLS: HrfinColumn<D>[] = [
    {
      key: 'ref',
      label: 'Reference',
      render: d => <strong style={{ fontSize: 12, fontFamily: 'monospace' }}>{d.disbursementNo}</strong>,
    },
    {
      key: 'employees',
      label: 'Employees',
      render: d => <span style={{ color: 'var(--muted)', fontSize: 12 }}>{d.employeeCount}</span>,
    },
    {
      key: 'amount',
      label: 'Amount',
      render: d => <b>{money(d.totalAmount)}</b>,
    },
    {
      key: 'currency',
      label: 'Currency',
      render: d => <span style={{ color: 'var(--muted)', fontSize: 12 }}>{d.currency}</span>,
    },
    {
      key: 'approver',
      label: 'Approved By',
      render: d => <EmployeeCell employeeId={d.approvedBy} />,
    },
    {
      key: 'created',
      label: 'Date',
      render: d => <span style={{ color: 'var(--muted)', fontSize: 12 }}>{fmtDate(d.updatedAt)}</span>,
    },
  ];

  return (
    <HrfinTable
      searchValue={search}
      onSearch={v => { setSearch(v); setPage(0); }}
      searchPlaceholder="Search payments…"
      columns={COLS}
      rows={paged.rows}
      rowKey={d => d.id}
      page={page}
      pageCount={paged.pageCount}
      total={paged.total}
      pageSize={PAGE_SIZE}
      onPage={setPage}
      noun="payments"
      loading={allQ.isLoading}
      emptyMessage="No paid disbursements yet."
    />
  );
}

// ── Reports tab ───────────────────────────────────────────────────────────────

const DISB_REPORTS = [
  { key: 'disbursement_summary',   label: 'Disbursement Summary',   description: 'All disbursements with status and totals' },
  { key: 'bank_file_status',       label: 'Bank File Status',       description: 'Disbursements with generated bank files' },
  { key: 'bank_account_readiness', label: 'Bank Account Readiness', description: 'Employees without primary bank accounts' },
];

const SUMMARY_COLS: ReportColumn[] = [
  { key: 'disbursementNo', header: 'Reference' },
  { key: 'status',         header: 'Status' },
  { key: 'totalAmount',    header: 'Total',      format: 'currency' },
  { key: 'employeeCount',  header: 'Employees',  format: 'number' },
  { key: 'currency',       header: 'Currency' },
  { key: 'createdAt',      header: 'Created',    format: 'date' },
];

const BANK_FILE_COLS: ReportColumn[] = [
  { key: 'disbursementNo',  header: 'Reference' },
  { key: 'status',          header: 'Status' },
  { key: 'totalAmount',     header: 'Total',      format: 'currency' },
  { key: 'employeeCount',   header: 'Lines',      format: 'number' },
  { key: 'currency',        header: 'Currency' },
  { key: 'bankFilePath',    header: 'File Path' },
  { key: 'fileGeneratedAt', header: 'Generated',  format: 'date' },
];

const READINESS_COLS: ReportColumn[] = [
  { key: 'fullName',             header: 'Employee' },
  { key: 'email',                header: 'Email' },
  { key: 'hasPrimaryBankAccount', header: 'Has Bank Account' },
];

function ReportsTab(): VNode {
  const [selectedReport, setSelectedReport] = useState<string | null>('disbursement_summary');
  const [statusFilter, setStatusFilter]     = useState<DisbursementStatus | ''>('');

  // Each report type pulls from its own dedicated endpoint
  const summaryQ    = useDisbursementReport(statusFilter ? { status: statusFilter } : {});
  const bankFileQ   = useBankFileStatusReport();
  const readinessQ  = useBankAccountReadinessReport();

  const activeQ =
    selectedReport === 'bank_file_status'       ? bankFileQ  :
    selectedReport === 'bank_account_readiness' ? readinessQ :
    summaryQ;

  const activeCols =
    selectedReport === 'bank_file_status'       ? BANK_FILE_COLS  :
    selectedReport === 'bank_account_readiness' ? READINESS_COLS  :
    SUMMARY_COLS;

  const result = activeQ.data
    ? {
        report:      selectedReport ?? 'disbursement_summary',
        generatedAt: new Date().toISOString(),
        rows:        (activeQ.data as unknown as Record<string, unknown>[]),
      }
    : null;

  const params = selectedReport === 'disbursement_summary' ? (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
      <label style={{ fontSize: 12 }}>
        <span style={{ color: 'var(--muted)', display: 'block', marginBottom: 2 }}>Status filter</span>
        <select
          class="hrfin-input"
          style={{ width: 'auto', fontSize: 12 }}
          value={statusFilter}
          onChange={e => setStatusFilter((e.currentTarget).value as DisbursementStatus | '')}
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="submitted">Submitted</option>
          <option value="approved">Approved</option>
          <option value="file_generated">File Generated</option>
          <option value="paid">Paid</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </label>
    </div>
  ) : undefined;

  const exportFilename =
    selectedReport === 'bank_file_status'       ? 'bank-file-status-report'       :
    selectedReport === 'bank_account_readiness' ? 'bank-account-readiness-report' :
    'disbursements-report';

  return (
    <ReportPanel
      reports={DISB_REPORTS}
      selectedReport={selectedReport}
      onSelectReport={key => { setSelectedReport(key); setStatusFilter(''); }}
      params={params}
      result={result}
      columns={activeCols}
      exportFilename={exportFilename}
      loading={activeQ.isLoading}
      error={activeQ.error ? (activeQ.error).message : null}
    />
  );
}

// ── Analytics chart ───────────────────────────────────────────────────────────

function DisbursementTrend(): VNode {
  const kpisQ = useDisbursementKpis();
  const trend = kpisQ.data?.trend ?? [];

  if (kpisQ.isLoading || trend.length === 0) {
    return (
      <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 12 }}>
        {kpisQ.isLoading ? 'Loading chart…' : 'No trend data yet.'}
      </div>
    );
  }

  return (
    <TrendArea
      title="Monthly disbursements (6 months)"
      labels={trend.map(t => t.month)}
      seriesA={trend.map(t => t.total)}
      seriesALabel="Total paid"
    />
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function DisbursementsOverview(): VNode {
  const [activeTab, setActiveTab]       = useState<PageTab>('disbursements');
  const [drawerOpen, setDrawerOpen]     = useState(false);
  const [selectedId, setSelectedId]     = useState<string | null>(null);
  const [drawerTab, setDrawerTab]       = useState<DisbDrawerTab>('summary');
  const [wizOpen, setWizOpen]           = useState(false);

  const kpisQ    = useDisbursementKpis();
  const kpis     = kpisQ.data;

  const canManage   = can('finance.disbursement.manage');
  const canApprove  = can('finance.disbursement.approve');
  const canBankMgmt = can('finance.bank_accounts.manage');
  const canDownload = can('finance.disbursement.bank_file.download');

  function openDrawer(id: string, tab: DisbDrawerTab = 'summary'): void {
    setSelectedId(id);
    setDrawerTab(tab);
    setDrawerOpen(true);
  }

  const submitMut   = useDisbursementMutation(financeDisbursementsApi.submit);
  const approveMut  = useDisbursementMutation(financeDisbursementsApi.approve);
  const genFileMut  = useDisbursementMutation(financeDisbursementsApi.generateFile);
  const markPaidMut = useDisbursementMutation(financeDisbursementsApi.markPaid);
  const cancelMut   = useDisbursementMutation(financeDisbursementsApi.cancel);

  async function run(p: Promise<unknown>, ok: string): Promise<void> {
    try { await p; toast(ok); }
    catch (e) { toast((e as Error).message ?? 'Action failed.'); }
  }

  const drawerActions: DisbDrawerActions = {
    onSubmit:       d => void run(submitMut.mutateAsync({ id: d.id }), 'Submitted.'),
    onApprove:      d => void run(approveMut.mutateAsync({ id: d.id }), 'Approved.'),
    onGenerateFile: d => void run(genFileMut.mutateAsync({ id: d.id }), 'Bank file generated.'),
    onMarkPaid:     d => void run(markPaidMut.mutateAsync({ id: d.id }), 'Marked as paid.'),
    onCancel:       async d => {
      const reason = await dialog.prompt({ title: 'Cancel disbursement', text: 'Reason for cancellation:', confirmText: 'Cancel', cancelText: 'Keep' });
      if (!reason) return;
      await run(cancelMut.mutateAsync({ id: d.id, reason }), 'Cancelled.');
    },
  };

  return (
    <div class="hrfin">
      {/* Aurora page header */}
      <HrfinPageHeader
        icon="bank"
        title="Payroll Bank Disbursements"
        sub="Generate per-bank direct-credit files (generic layout — verify against each bank's spec) and disburse net pay from approved payroll runs."
        chips={[
          ...(kpis?.pending
            ? [{ icon: 'clock' as const, label: `${kpis.pending} pending`, tone: 'warning' as const }]
            : []),
          ...(kpis?.missingBankAccountCount
            ? [{ icon: 'alert' as const, label: `${kpis.missingBankAccountCount} missing bank`, tone: 'danger' as const }]
            : []),
        ]}
      />

      {/* Quick action strip */}
      <QuickActionStrip
        actions={[
          ...(canManage ? [{
            key: 'create',
            label: 'Compute & Create',
            icon: 'plus' as const,
            variant: 'primary' as const,
            onClick: () => setWizOpen(true),
          }] : []),
          {
            key: 'bank-accounts',
            label: 'Bank Accounts',
            icon: 'bank' as const,
            onClick: () => setActiveTab('bank-accounts'),
          },
          {
            key: 'reports',
            label: 'Reports',
            icon: 'file' as const,
            onClick: () => setActiveTab('reports'),
          },
        ]}
      />

      {/* KPI strip */}
      <section class="hrfin-kpi-row">
        <KpiCard
          label="Pending Approval"
          value={kpis ? String(kpis.pending) : undefined}
          badge={kpis?.pending ? 'Action needed' : undefined}
          badgeTone="warning"
          support="Submitted, awaiting approver"
          loading={kpisQ.isLoading}
          tone="accent"
        />
        <KpiCard
          label="Approved"
          value={kpis ? String(kpis.approved) : undefined}
          support="Ready for bank file generation"
          loading={kpisQ.isLoading}
          tone="success"
        />
        <KpiCard
          label="Bank Files Generated"
          value={kpis ? String(kpis.fileGenerated) : undefined}
          support="Awaiting payment confirmation"
          loading={kpisQ.isLoading}
          tone="accent"
        />
        <KpiCard
          label="Paid MTD"
          value={kpis ? String(kpis.paidMtd) : undefined}
          support={kpis ? money(kpis.totalMtdAmount) + ' this month' : undefined}
          visual="bars"
          values={kpis?.trend.map(t => t.count) ?? []}
          loading={kpisQ.isLoading}
          tone="success"
        />
        <KpiCard
          label="Missing Bank Accounts"
          value={kpis ? String(kpis.missingBankAccountCount) : undefined}
          badge={kpis?.missingBankAccountCount ? 'Fix needed' : undefined}
          badgeTone={kpis?.missingBankAccountCount ? 'danger' : 'success'}
          support="Employees without primary bank"
          loading={kpisQ.isLoading}
          tone="danger"
        />
        <KpiCard
          label="Failed Lines"
          value={kpis ? String(kpis.failedLineCount) : undefined}
          support="Lines with errors"
          loading={kpisQ.isLoading}
          tone="accent"
        />
      </section>

      {/* Analytics chart */}
      <section class="hrfin-chart-section" style={{ marginBottom: 24 }}>
        <div class="hrfin-section-head" style={{ marginBottom: 10 }}>
          <span class="hrfin-section-title">Monthly Disbursement Trend</span>
          <span class="hse-muted" style={{ fontSize: 11 }}>Last 6 months · total net pay</span>
        </div>
        <DisbursementTrend />
      </section>

      {/* Main table with tabs */}
      <section class="hrfin-main-section">
        {/* Tab switcher row above table */}
        <div class="hrfin-tabs" style={{ marginBottom: 0 }}>
          {PAGE_TABS.map(t => (
            <button
              key={t.key}
              type="button"
              class={t.key === activeTab ? 'is-active' : ''}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === 'disbursements' && (
          <DisbursementsTab
            canManage={canManage}
            canApprove={canApprove}
            onOpenDrawer={openDrawer}
            onCreated={() => setActiveTab('disbursements')}
          />
        )}
        {activeTab === 'lines'         && <LinesTab />}
        {activeTab === 'bank-accounts' && <BankAccountsTab canManage={canBankMgmt} />}
        {activeTab === 'bank-files'    && <BankFilesTab canApprove={canDownload} onOpenDrawer={openDrawer} />}
        {activeTab === 'payments'      && <PaymentsTab />}
        {activeTab === 'reports'       && <ReportsTab />}
      </section>

      {/* Wizard (standalone modal, also accessible from QuickActionStrip) */}
      {canManage && (
        <DisbComputeWizard
          open={wizOpen}
          onClose={() => setWizOpen(false)}
          onCreated={() => { setWizOpen(false); setActiveTab('disbursements'); }}
        />
      )}

      {/* Detail drawer */}
      <DisbDrawer
        disbursementId={selectedId}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        canManage={canManage}
        canApprove={canApprove}
        actions={drawerActions}
        initialTab={drawerTab}
      />
    </div>
  );
}
