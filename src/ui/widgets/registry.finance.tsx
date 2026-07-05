// src/ui/widgets/registry.finance.tsx — Finance widget definitions for the library.
//
// REUSE-HOOKS model (per docs/SIOMAC_ENTERPRISE_WIDGET_SYSTEM_IMPLEMENTATION.md): each
// `render` fetches its own data via the module's existing TanStack hooks — no generic
// data endpoint. `renderPreview` is a representative catalogue thumbnail (illustrative
// sample, never presented as live data). Auto-registered by registry.ts via `widgets`.
//
// Widgets cover the Finance Tier A/B modules: Remittances (F1), Expenses (F4),
// Budgeting (F5), Bank Disbursement (F2). Each declares its exact RBAC view key.

import type { WidgetDef } from './types';
import { StatsCard } from '@ui';
import { ListRow, WidgetList, humanize, type RowTone } from './inlinePrimitives';
import { useRemittances } from '@api/finance/remittances';
import { useExpenseClaims } from '@api/finance/expenses';
import { useBudgets } from '@api/finance/budgets';
import { useDisbursements } from '@api/finance/disbursements';

const FIN_PAGES = ['finance.overview'];
const FIN_ZONES = ['main', 'overview'];

const KPI_SIZES = [
  { key: 'compact' as const, label: 'Compact', grid: { w: 3, h: 2 }, description: 'Metric summary.' },
  { key: 'standard' as const, label: 'Standard', grid: { w: 4, h: 2 }, description: 'Metric with context.' },
];
const LIST_SIZES = [
  { key: 'standard' as const, label: 'Standard', grid: { w: 4, h: 3 }, description: 'Recent items.' },
  { key: 'tall' as const, label: 'Tall', grid: { w: 4, h: 5 }, description: 'More rows.' },
];

const money = (n: number): string => `$${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const currentFiscalYear = (): number => new Date().getUTCFullYear();

// status → row tone (shared across finance lists)
const finTone = (s: string): RowTone =>
  (s === 'cancelled' || s === 'rejected') ? 'danger'
  : (s === 'draft' || s === 'submitted') ? 'warn'
  : (s === 'approved' || s === 'paid' || s === 'filed' || s === 'reimbursed' || s === 'file_generated') ? 'ok'
  : 'muted';

export const widgets: WidgetDef[] = [
  // ── F1 Remittances — amount due KPI ─────────────────────────────────────────
  {
    id: 'finance.remittances.due',
    module: 'finance', area: 'remittances',
    title: 'Remittances Due',
    description: 'Open statutory remittances (submitted/approved, not yet paid) and total amount due.',
    icon: 'fa-building-columns',
    category: 'Statutory',
    tags: ['finance', 'remittances', 'statutory', 'kpi'],
    previewVariant: 'metric',
    chrome: 'none',
    supportedPages: FIN_PAGES, supportedZones: FIN_ZONES,
    defaultSize: 'compact', allowedSizes: KPI_SIZES,
    defaultConfig: {}, configSchema: [],
    dataSource: { sourceKey: 'finance_remittances', label: 'Statutory Remittances', refreshIntervalMs: 300000, permissions: ['finance.remittances.view'] },
    recommendedFor: FIN_PAGES,
    render: () => {
      const q = useRemittances({});
      const rows = q.data ?? [];
      const open = rows.filter(r => r.status === 'submitted' || r.status === 'approved');
      const due = open.reduce((s, r) => s + (r.totalDue ?? 0), 0);
      return (
        <StatsCard
          icon="fa-building-columns" title="Remittances due"
          loading={q.isLoading && !q.data}
          metric={open.length}
          supporting={money(due) + ' outstanding'}
          footer={`${rows.filter(r => r.status === 'filed').length} filed · ${rows.filter(r => r.status === 'paid').length} paid`}
        />
      );
    },
    renderPreview: () => (
      <StatsCard icon="fa-building-columns" title="Remittances due" metric={3}
        supporting="$18,240.00 outstanding" footer="6 filed · 2 paid" />
    ),
  },

  // ── F1 Remittances — recent list ────────────────────────────────────────────
  {
    id: 'finance.remittances.recent',
    module: 'finance', area: 'remittances',
    title: 'Recent Remittances',
    description: 'Latest statutory remittances by authority with status and amount.',
    icon: 'fa-list',
    category: 'Statutory',
    tags: ['finance', 'remittances', 'list'],
    previewVariant: 'table',
    chrome: 'standard',
    supportedPages: FIN_PAGES, supportedZones: FIN_ZONES,
    defaultSize: 'standard', allowedSizes: LIST_SIZES,
    defaultConfig: {}, configSchema: [],
    dataSource: { sourceKey: 'finance_remittances', label: 'Statutory Remittances', refreshIntervalMs: 300000, permissions: ['finance.remittances.view'] },
    recommendedFor: FIN_PAGES,
    render: () => {
      const q = useRemittances({});
      const rows = (q.data ?? []).slice(0, 8);
      return (
        <WidgetList
          loading={q.isLoading && !q.data}
          empty="No remittances"
          rows={rows.map(r => (
            <ListRow key={r.id} primary={`${humanize(r.authority)} · ${r.periodYear}`}
              secondary={`${r.remittanceNo} · ${humanize(r.status)}`}
              right={money(r.totalDue)} tone={finTone(r.status)} />
          ))}
        />
      );
    },
    renderPreview: () => (
      <WidgetList loading={false} empty="No remittances" rows={[
        <ListRow primary="NIS Nibtt · 2026" secondary="REM-000142 · Filed" right="$8,120.00" tone="ok" />,
        <ListRow primary="Paye Bir · 2026" secondary="REM-000141 · Submitted" right="$12,400.00" tone="warn" />,
      ]} />
    ),
  },

  // ── F4 Expenses — pending claims KPI ────────────────────────────────────────
  {
    id: 'finance.expenses.pending',
    module: 'finance', area: 'expenses',
    title: 'Pending Expense Claims',
    description: 'Submitted expense claims awaiting approval and their total value.',
    icon: 'fa-receipt',
    category: 'Expenses',
    tags: ['finance', 'expenses', 'kpi'],
    previewVariant: 'metric',
    chrome: 'none',
    supportedPages: FIN_PAGES, supportedZones: FIN_ZONES,
    defaultSize: 'compact', allowedSizes: KPI_SIZES,
    defaultConfig: {}, configSchema: [],
    dataSource: { sourceKey: 'finance_expense_claims', label: 'Expense Claims', refreshIntervalMs: 180000, permissions: ['finance.expenses.view'] },
    recommendedFor: FIN_PAGES,
    render: () => {
      const q = useExpenseClaims({ status: 'submitted' });
      const rows = q.data ?? [];
      const total = rows.reduce((s, c) => s + (c.totalAmount ?? 0), 0);
      return (
        <StatsCard
          icon="fa-receipt" title="Pending claims"
          loading={q.isLoading && !q.data}
          metric={rows.length}
          supporting={money(total) + ' awaiting approval'}
        />
      );
    },
    renderPreview: () => (
      <StatsCard icon="fa-receipt" title="Pending claims" metric={7} supporting="$4,310.00 awaiting approval" />
    ),
  },

  // ── F5 Budgeting — budget vs actual KPI ─────────────────────────────────────
  {
    id: 'finance.budgets.variance',
    module: 'finance', area: 'budgets',
    title: 'Budget vs Actual',
    description: 'Total budgeted vs actual for the current fiscal year, with variance.',
    icon: 'fa-chart-pie',
    category: 'Budgeting',
    tags: ['finance', 'budgets', 'variance', 'kpi'],
    previewVariant: 'metric',
    chrome: 'none',
    supportedPages: FIN_PAGES, supportedZones: FIN_ZONES,
    defaultSize: 'standard', allowedSizes: KPI_SIZES,
    defaultConfig: {}, configSchema: [],
    dataSource: { sourceKey: 'finance_budget_lines', label: 'Budget Lines', refreshIntervalMs: 600000, permissions: ['finance.budgets.view'] },
    recommendedFor: FIN_PAGES,
    render: () => {
      const q = useBudgets({ fiscalYear: currentFiscalYear() });
      const rows = q.data ?? [];
      const budgeted = rows.reduce((s, b) => s + (b.budgeted ?? 0), 0);
      const actual = rows.reduce((s, b) => s + (b.actual ?? 0), 0);
      const variance = budgeted - actual;
      const overspent = variance < 0;
      return (
        <StatsCard
          icon="fa-chart-pie" title={`Budget ${currentFiscalYear()}`}
          loading={q.isLoading && !q.data}
          metric={money(actual)}
          supporting={`of ${money(budgeted)} budgeted`}
          footer={`${overspent ? 'Over' : 'Under'} by ${money(Math.abs(variance))}`}
        />
      );
    },
    renderPreview: () => (
      <StatsCard icon="fa-chart-pie" title="Budget 2026" metric="$312,400.00"
        supporting="of $400,000.00 budgeted" footer="Under by $87,600.00" />
    ),
  },

  // ── F2 Bank Disbursement — latest disbursement KPI ──────────────────────────
  {
    id: 'finance.disbursements.latest',
    module: 'finance', area: 'disbursements',
    title: 'Latest Disbursement',
    description: 'Most recent payroll bank disbursement — status and total amount.',
    icon: 'fa-money-bill-transfer',
    category: 'Payroll',
    tags: ['finance', 'disbursement', 'payroll', 'kpi'],
    previewVariant: 'metric',
    chrome: 'none',
    supportedPages: FIN_PAGES, supportedZones: FIN_ZONES,
    defaultSize: 'compact', allowedSizes: KPI_SIZES,
    defaultConfig: {}, configSchema: [],
    dataSource: { sourceKey: 'finance_disbursements', label: 'Bank Disbursements', refreshIntervalMs: 180000, permissions: ['finance.disbursement.view'] },
    recommendedFor: FIN_PAGES,
    render: () => {
      const q = useDisbursements({});
      const latest = (q.data ?? [])[0];
      return (
        <StatsCard
          icon="fa-money-bill-transfer" title="Latest disbursement"
          loading={q.isLoading && !q.data}
          metric={latest ? money(latest.totalAmount) : '—'}
          supporting={latest ? `${latest.disbursementNo} · ${humanize(latest.status)}` : 'No disbursements yet'}
        />
      );
    },
    renderPreview: () => (
      <StatsCard icon="fa-money-bill-transfer" title="Latest disbursement" metric="$142,880.00"
        supporting="DSB-000031 · File generated" />
    ),
  },
];
