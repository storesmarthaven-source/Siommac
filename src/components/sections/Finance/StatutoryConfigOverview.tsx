/**
 * src/components/sections/Finance/StatutoryConfigOverview.tsx
 *
 * Finance ▸ Statutory Configuration — Aurora .hrfin rebuild (Wave 2B).
 * Surfaces: Rate Versions · NIS Classes · Pay Components · NIS Verification · Reports.
 *
 * Aurora shell: HrfinPageHeader + QuickActionStrip + 6-KPI strip +
 * AnalyticsRow (HorizontalBars) + HrfinTable (search/filter/sort/pager/⋮/CSV) +
 * detail Drawer (9 tabs) + 6-step New Rate Version wizard +
 * NIS Class add/import dialogs + Pay Component create/edit.
 * All mutations use the backbone server-side; FE raises toast on success/error.
 * SoD enforced server-side (assertDifferentApprover); FE reflects the 422 message.
 */

import { type VNode } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import { toast } from '@store';
import { can } from '@lib/permissions';
import { dialog } from '@lib/dialog';
import {
  HrfinPageHeader, QuickActionStrip, KpiCard, RailCard, InsightBanner, ActivityFeed,
  HrfinPill, HrfinTable, HrfinWizardModal, Drawer, exportCsv,
  HorizontalBars, TrendArea, type HrfinColumn, type HrfinTab, type RowActionItem,
  type HBarItem, type ActivityItem,
} from '@ui';
import {
  useStatutoryVersions, useNisClasses, usePayComponents, useVersionDetail,
  useStatutoryReport, useStatutoryMutation,
  financeStatutoryApi,
  type StatutoryVersion, type NisClass, type PayComponent,
  type CreateStatutoryVersionArgs, type StatutoryReportKey,
} from '@api/finance/statutory';
import {
  useNisProfiles, usePayrollMutation, financePayrollApi, type NisProfileRow,
} from '@api/finance/payroll';
import { useEmployeeNames } from '@api/finance/lookups';
import { EmployeeCell, EmployeeCellResolved } from './_shared/EmployeeCell';
import { fmtMoney, fmtPercent, fmtDate, humanize } from './financeShared';
import { ReportPanel, type ReportColumn } from './_shared/reports';
import './finance.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

const num = (v: string): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function statusTone(s: string): 'ok' | 'bad' | 'wn' | 'nu' | 'dr' {
  switch (s) {
    case 'active':   return 'ok';
    case 'approved': return 'nu';
    case 'pending_approval': return 'wn';
    case 'rejected':
    case 'retired':  return 'dr';
    default:         return 'dr';
  }
}

function dateMonthKey(iso: string): string {
  return iso.slice(0, 7); // "2026-07"
}

const PAGE_SIZE = 10;

// ── Main tabs ─────────────────────────────────────────────────────────────────

type MainTab = 'versions' | 'nis' | 'components' | 'verify' | 'reports';
const MAIN_TABS: HrfinTab[] = [
  { key: 'versions',    label: 'Rate Versions' },
  { key: 'nis',         label: 'NIS Classes' },
  { key: 'components',  label: 'Pay Components' },
  { key: 'verify',      label: 'NIS Verification' },
  { key: 'reports',     label: 'Reports' },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export function StatutoryConfigOverview(): VNode {
  const [tab, setTab] = useState<MainTab>('versions');
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [showNisForm, setShowNisForm] = useState<{ versionId: string; edit?: NisClass } | null>(null);
  const [showNisImport, setShowNisImport] = useState<string | null>(null); // versionId
  const [showCompForm, setShowCompForm] = useState<{ edit?: PayComponent } | null>(null);

  const versionsQ   = useStatutoryVersions();
  const componentsQ = usePayComponents({ activeOnly: false });
  const nisProfilesQ = useNisProfiles({ status: 'pending_verification' });

  const versions   = versionsQ.data ?? [];
  const components = componentsQ.data ?? [];
  const activeVer  = versions.find(v => v.isActive) ?? null;

  const canManage  = can('finance.statutory.manage');
  const canApprove = can('finance.statutory.approve');
  const canView    = can('finance.statutory.view');

  // KPI counts
  const drafts    = versions.filter(v => v.status === 'draft').length;
  const pending   = versions.filter(v => v.status === 'pending_approval').length;
  const activeComponents = components.filter(c => c.isActive).length;
  const verifyQueue = nisProfilesQ.data?.length ?? 0;

  // Analytics chart: version distribution by status
  const statusLabels  = ['Active', 'Approved', 'Pending', 'Draft', 'Retired'];
  const statusCounts  = [
    versions.filter(v => v.status === 'active').length,
    versions.filter(v => v.status === 'approved').length,
    versions.filter(v => v.status === 'pending_approval').length,
    drafts,
    versions.filter(v => v.status === 'retired').length,
  ];
  const maxCount = Math.max(...statusCounts, 1);
  const barItems: HBarItem[] = statusLabels.map((label, i) => ({
    label,
    value: String(statusCounts[i] ?? 0),
    percent: Math.round(((statusCounts[i] ?? 0) / maxCount) * 100),
    tone: i === 0 ? 'success' : i === 2 ? 'warning' : i === 4 ? undefined : 'accent',
  }));

  // Trend area: versions added by month (last 6 months)
  const trendLabels = useMemo(() => {
    const out: string[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push(d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }));
    }
    return out;
  }, []);

  const trendSeries = useMemo(() => {
    const now = new Date();
    return trendLabels.map((_, relIdx) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - relIdx), 1);
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return versions.filter(v => dateMonthKey(v.createdAt) === mk).length;
    });
  }, [versions, trendLabels]);

  // Recent activity from versions list
  const activityItems: ActivityItem[] = useMemo(() =>
    versions.slice(0, 5).map(v => ({
      icon: v.isActive ? 'check' : v.status === 'pending_approval' ? 'gavel' : 'file',
      title: v.label,
      meta: `${humanize(v.status)} · ${fmtDate(v.effectiveFrom)}`,
    })),
  [versions]);

  const quickActions = [
    ...(canManage ? [{
      key: 'new', label: 'New Rate Version', icon: 'plus' as const, variant: 'primary' as const,
      onClick: () => setShowWizard(true),
    }] : []),
    ...(canManage ? [{
      key: 'import-nis', label: 'Import NIS Classes', icon: 'upload' as const,
      badge: activeVer ? undefined : '!',
      onClick: () => setShowNisImport(activeVer?.id ?? ''),
      disabled: !activeVer,
    }] : []),
    {
      key: 'export', label: 'Export Versions', icon: 'download' as const,
      onClick: () => {
        exportCsv(versions, [
          { header: 'Label',            value: r => r.label },
          { header: 'Effective From',   value: r => r.effectiveFrom },
          { header: 'Jurisdiction',     value: r => r.jurisdiction },
          { header: 'Status',           value: r => r.status },
          { header: 'PAYE Allowance',   value: r => r.payePersonalAllowance },
          { header: 'Band 1 Rate',      value: r => fmtPercent(r.payeBand1Rate) },
          { header: 'Band 2 Rate',      value: r => fmtPercent(r.payeBand2Rate) },
          { header: 'HS Monthly',       value: r => r.hsMonthlyThreshold },
          { header: 'Created At',       value: r => r.createdAt },
        ], 'statutory-versions');
        toast('Exported statutory versions CSV.');
      },
    },
  ];

  return (
    <div class="hrfin">
      <HrfinPageHeader
        icon="book"
        title="Statutory Configuration"
        sub="NIS, PAYE and Health Surcharge rate versions, the pay-component catalogue, and NIS continuity verification."
        chips={[
          ...(activeVer ? [{ icon: 'check' as const, label: activeVer.label, tone: 'success' as const }] : []),
          ...(pending > 0 ? [{ icon: 'gavel' as const, label: `${pending} pending approval`, tone: 'warning' as const }] : []),
          ...(verifyQueue > 0 ? [{ icon: 'user' as const, label: `${verifyQueue} to verify`, tone: 'danger' as const }] : []),
        ]}
      />

      <QuickActionStrip actions={quickActions} />

      {/* KPI strip */}
      <div class="hrfin-kpi-strip">
        {/* wrap clickable cards; KpiCard has no onClick */}
        <button type="button" class="hrfin-kpi-link" style={{ all: 'unset', cursor: activeVer ? 'pointer' : 'default', display: 'block', width: '100%' }} onClick={() => activeVer && setDrawerId(activeVer.id)} aria-label="Open active version detail">
          <KpiCard label="Active Version" value={activeVer?.label ?? '—'} support={activeVer ? `Effective ${fmtDate(activeVer.effectiveFrom)}` : 'No active version'} loading={versionsQ.isLoading} tone="success" />
        </button>
        <KpiCard label="Draft Versions" value={String(drafts)} support="Awaiting submission" loading={versionsQ.isLoading} tone="accent" badge={drafts > 0 ? String(drafts) : undefined} badgeTone="warning" />
        <KpiCard label="Pay Components" value={String(activeComponents)} support={`${components.length - activeComponents} retired`} loading={componentsQ.isLoading} tone="accent" />
        <button type="button" class="hrfin-kpi-link" style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }} onClick={() => setTab('nis')} aria-label="Go to NIS Classes tab">
          <KpiCard label="NIS Classes" value={activeVer ? 'View ▸' : '—'} support={activeVer ? `In ${activeVer.label}` : 'Select a version'} loading={versionsQ.isLoading} />
        </button>
        <KpiCard label="Pending Approval" value={String(pending)} support="Awaiting finance manager" loading={versionsQ.isLoading} tone={pending > 0 ? 'danger' : 'accent'} />
        <button type="button" class="hrfin-kpi-link" style={{ all: 'unset', cursor: verifyQueue > 0 ? 'pointer' : 'default', display: 'block', width: '100%' }} onClick={() => verifyQueue > 0 && setTab('verify')} aria-label="Go to NIS Verification tab">
          <KpiCard label="Verification Queue" value={String(verifyQueue)} support="NIS profiles to verify" loading={nisProfilesQ.isLoading} tone={verifyQueue > 0 ? 'danger' : 'accent'} />
        </button>
      </div>

      {/* Analytics row */}
      {!versionsQ.isLoading && versions.length > 0 && (
        <div class="hrfin-analytics-row">
          <article class="hrfin-chart-card">
            <div class="hrfin-card-head"><h2>Version Status Distribution</h2></div>
            <HorizontalBars items={barItems} />
          </article>
          <article class="hrfin-chart-card">
            <div class="hrfin-card-head"><h2>Versions Added (6 months)</h2></div>
            <TrendArea labels={trendLabels} seriesA={trendSeries} seriesALabel="Versions" title="Versions added per month" />
          </article>
        </div>
      )}

      {/* Main grid: register + rail */}
      <div class="hrfin-page-grid">
        <div class="hrfin-register">
          {tab === 'versions'   && <VersionsTab versions={versions} loading={versionsQ.isLoading} error={versionsQ.error ? String(versionsQ.error) : undefined} canManage={canManage} canApprove={canApprove} onOpenDrawer={setDrawerId} onNew={() => setShowWizard(true)} />}
          {tab === 'nis'        && <NisClassesTab versions={versions} versionsError={versionsQ.error ? String(versionsQ.error) : undefined} canManage={canManage} onAdd={v => setShowNisForm({ versionId: v })} onImport={setShowNisImport} />}
          {tab === 'components' && <PayComponentsTab components={components} loading={componentsQ.isLoading} error={componentsQ.error ? String(componentsQ.error) : undefined} canManage={canManage} onNew={() => setShowCompForm({})} onEdit={c => setShowCompForm({ edit: c })} />}
          {tab === 'verify'     && <NisVerifyTab canVerify={can('finance.payroll.nis.verify')} />}
          {tab === 'reports'    && canView && <StatReportsTab />}
        </div>

        <aside class="hrfin-rail">
          {activeVer && (
            <InsightBanner
              title={`Active: ${activeVer.label}`}
              sub={`Effective ${fmtDate(activeVer.effectiveFrom)} · PAYE ${fmtPercent(activeVer.payeBand1Rate)} / ${fmtPercent(activeVer.payeBand2Rate)}`}
              actions={[{ label: 'View details', onClick: () => setDrawerId(activeVer.id) }]}
            />
          )}
          {pending > 0 && (
            <InsightBanner
              title={`${pending} version${pending !== 1 ? 's' : ''} awaiting approval`}
              sub="A different finance manager must approve."
              actions={canApprove ? [{ label: 'Review', primary: true, onClick: () => setTab('versions') }] : []}
              dismissible
            />
          )}
          <RailCard title="Quick Stats">
            <div class="hrfin-metric-list">
              <div class="hrfin-metric-row"><span>Total versions</span><b>{versions.length}</b></div>
              <div class="hrfin-metric-row"><span>Pay components</span><b>{components.length}</b></div>
              <div class="hrfin-metric-row"><span>Statutory components</span><b>{components.filter(c => c.isStatutory).length}</b></div>
              <div class="hrfin-metric-row"><span>NIS verify queue</span><b>{verifyQueue}</b></div>
            </div>
          </RailCard>
          <RailCard title="Recent Activity">
            <ActivityFeed items={activityItems} />
          </RailCard>
        </aside>
      </div>

      {/* Tab switcher (rendered below analytics so it overlays the grid) */}
      <div class="hrfin-tabs" style={{ marginBottom: '1rem', order: -1 }}>
        {MAIN_TABS.map(t => (
          <button key={t.key} type="button" class={tab === t.key ? 'is-active' : ''} onClick={() => setTab(t.key as MainTab)}>
            {t.label}
            {t.key === 'verify' && verifyQueue > 0 && <b style={{ marginLeft: 6, background: 'var(--hrfin-danger, #e53)', color: '#fff', borderRadius: 99, padding: '0 5px', fontSize: 11 }}>{verifyQueue}</b>}
          </button>
        ))}
      </div>

      {/* Detail drawer */}
      <StatVersionDrawer
        id={drawerId}
        open={!!drawerId}
        onClose={() => setDrawerId(null)}
        canManage={canManage}
        canApprove={canApprove}
        onShowNisForm={(vId) => setShowNisForm({ versionId: vId })}
      />

      {/* New Rate Version wizard */}
      {showWizard && <StatNewVersionWizard onClose={() => setShowWizard(false)} />}

      {/* NIS Class add/edit dialog */}
      {showNisForm && (
        <StatNisClassDialog
          versionId={showNisForm.versionId}
          edit={showNisForm.edit}
          onClose={() => setShowNisForm(null)}
        />
      )}

      {/* NIS Classes import dialog */}
      {showNisImport && (
        <StatNisImportDialog
          versionId={showNisImport}
          onClose={() => setShowNisImport(null)}
        />
      )}

      {/* Pay Component create/edit dialog */}
      {showCompForm !== null && (
        <StatPayComponentDialog
          edit={showCompForm.edit}
          onClose={() => setShowCompForm(null)}
        />
      )}
    </div>
  );
}

// ── Rate Versions tab ─────────────────────────────────────────────────────────

function VersionsTab({ versions, loading, error, canManage, canApprove, onOpenDrawer, onNew }: {
  versions: StatutoryVersion[];
  loading: boolean;
  error?: string;
  canManage: boolean;
  canApprove: boolean;
  onOpenDrawer: (id: string) => void;
  onNew: () => void;
}): VNode {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(0);
  const [sortField, setSortField] = useState<string>('effectiveFrom');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const submitMut   = useStatutoryMutation(financeStatutoryApi.submitVersion);
  const approveMut  = useStatutoryMutation(financeStatutoryApi.approveVersion);
  const rejectMut   = useStatutoryMutation(financeStatutoryApi.rejectVersion);
  const activateMut = useStatutoryMutation(financeStatutoryApi.activateVersion);
  const retireMut   = useStatutoryMutation(financeStatutoryApi.retireVersion);

  const run = async (p: Promise<unknown>, ok: string): Promise<void> => {
    try { await p; toast(ok); } catch (e) { toast.error((e as Error).message); }
  };

  const filtered = useMemo(() => {
    let rows = versions;
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(v => v.label.toLowerCase().includes(q) || v.effectiveFrom.includes(q) || v.jurisdiction.toLowerCase().includes(q));
    }
    if (statusFilter !== 'all') rows = rows.filter(v => v.status === statusFilter);
    // Apply sort
    rows = [...rows].sort((a, b) => {
      const aVal = String(a[sortField as keyof StatutoryVersion] ?? '');
      const bVal = String(b[sortField as keyof StatutoryVersion] ?? '');
      return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });
    return rows;
  }, [versions, search, statusFilter, sortField, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows  = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const statusFilters = [
    { key: 'all', label: 'All' }, { key: 'draft', label: 'Draft' },
    { key: 'pending_approval', label: 'Pending' }, { key: 'approved', label: 'Approved' },
    { key: 'active', label: 'Active' }, { key: 'retired', label: 'Retired' },
  ];

  const columns: ReadonlyArray<HrfinColumn<StatutoryVersion>> = [
    {
      key: 'label', label: 'Version', sortable: true,
      render: v => (
        <div>
          <div style={{ fontWeight: 600 }}>{v.label}</div>
          <div style={{ fontSize: 12, opacity: 0.65 }}>{v.jurisdiction} · {v.currency}</div>
        </div>
      ),
    },
    {
      key: 'effectiveFrom', label: 'Effective', sortable: true,
      render: v => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtDate(v.effectiveFrom)}</span>,
    },
    {
      key: 'paye', label: 'PAYE Bands',
      render: v => (
        <div style={{ fontSize: 13 }}>
          <div>Allow: {fmtMoney(v.payePersonalAllowance)}</div>
          <div style={{ opacity: 0.7 }}>{fmtPercent(v.payeBand1Rate)} / {fmtPercent(v.payeBand2Rate)}</div>
        </div>
      ),
    },
    {
      key: 'hs', label: 'HS Threshold',
      render: v => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(v.hsMonthlyThreshold)}/mo</span>,
    },
    {
      key: 'status', label: 'Status', sortable: true,
      render: v => (
        <HrfinPill tone={statusTone(v.status)}>
          {v.isActive ? 'Active' : humanize(v.status)}
        </HrfinPill>
      ),
    },
  ];

  const rowActions = (v: StatutoryVersion): RowActionItem[] => [
    { key: 'view', label: 'View details', icon: 'file', onClick: () => onOpenDrawer(v.id) },
    ...(canManage && v.status === 'draft' ? [{
      key: 'submit', label: 'Submit for approval', icon: 'send' as const,
      onClick: () => run(submitMut.mutateAsync({ id: v.id }), 'Submitted for approval.'),
    }] : []),
    ...(canApprove && v.status === 'pending_approval' ? [
      { key: 'approve', label: 'Approve', icon: 'check' as const, onClick: () => run(approveMut.mutateAsync({ id: v.id }), 'Version approved.') },
      { key: 'reject',  label: 'Reject',  icon: 'close' as const, tone: 'danger' as const, onClick: async () => {
        const reason = await dialog.prompt({ title: 'Rejection reason', text: 'Provide a reason for returning this version to draft.', placeholder: 'Rejection reason (required)', confirmText: 'Reject' });
        if (!reason?.trim()) return;
        await run(rejectMut.mutateAsync({ id: v.id, reason }), 'Version returned to draft.');
      } },
    ] : []),
    ...(canApprove && v.status === 'approved' ? [{
      key: 'activate', label: 'Activate', icon: 'check' as const,
      onClick: () => run(activateMut.mutateAsync({ id: v.id }), 'Version activated.'),
    }] : []),
    ...(canManage && v.status === 'active' ? [{
      key: 'retire', label: 'Retire', icon: 'close' as const, tone: 'danger' as const,
      onClick: () => run(retireMut.mutateAsync({ id: v.id }), 'Version retired.'),
    }] : []),
  ];

  return (
    <div>
      {/* Status filter strip */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {statusFilters.map(f => (
          <button
            key={f.key} type="button"
            class={`hrfin-chip${statusFilter === f.key ? ' is-active' : ''}`}
            onClick={() => { setStatusFilter(f.key); setPage(0); }}
          >{f.label}</button>
        ))}
        {canManage && (
          <button type="button" class="hrfin-action is-primary" style={{ marginLeft: 'auto' }} onClick={onNew}>
            + New Rate Version
          </button>
        )}
      </div>

      <HrfinTable
        searchValue={search}
        onSearch={v => { setSearch(v); setPage(0); }}
        searchPlaceholder="Search by label or date…"
        columns={columns}
        rows={pageRows}
        rowKey={v => v.id}
        onRowClick={v => onOpenDrawer(v.id)}
        rowActions={rowActions}
        page={page}
        pageCount={pageCount}
        total={filtered.length}
        pageSize={PAGE_SIZE}
        onPage={setPage}
        noun="versions"
        loading={loading}
        error={error}
        sortField={sortField}
        sortDir={sortDir}
        onSort={(f, d) => { setSortField(f); setSortDir(d); setPage(0); }}
        emptyMessage="No statutory versions match the current filter."
      />

    </div>
  );
}

// ── NIS Classes tab ───────────────────────────────────────────────────────────

function NisClassesTab({ versions, versionsError, canManage, onAdd, onImport }: {
  versions: StatutoryVersion[];
  versionsError?: string;
  canManage: boolean;
  onAdd: (versionId: string) => void;
  onImport: (versionId: string) => void;
}): VNode {
  const [versionId, setVersionId] = useState<string>(() => versions.find(v => v.isActive)?.id ?? versions[0]?.id ?? '');
  const [page, setPage] = useState(0);
  const effectiveId = versionId || (versions[0]?.id ?? '');
  const classesQ   = useNisClasses(effectiveId || null);
  const classes    = classesQ.data ?? [];
  const selectedVer = versions.find(v => v.id === effectiveId);
  const canEdit    = canManage && selectedVer?.status === 'draft';

  const deleteMut = useStatutoryMutation(financeStatutoryApi.deleteNisClass);
  const handleDelete = async (id: string, classNo: number): Promise<void> => {
    const confirmed = await dialog.confirm({ title: `Delete NIS Class ${classNo}?`, text: 'This cannot be undone.', danger: true, confirmText: 'Delete' });
    if (!confirmed) return;
    try { await deleteMut.mutateAsync({ id }); toast(`NIS Class ${classNo} deleted.`); }
    catch (e) { toast.error((e as Error).message); }
  };

  const columns: ReadonlyArray<HrfinColumn<NisClass>> = [
    { key: 'classNo',        label: 'Class #',       render: c => <b>{c.classNo}</b> },
    { key: 'weeklyMin',      label: 'Weekly Min',    render: c => fmtMoney(c.weeklyMin) },
    { key: 'weeklyMax',      label: 'Weekly Max',    render: c => c.weeklyMax == null ? '∞' : fmtMoney(c.weeklyMax) },
    { key: 'employeeWeekly', label: 'Employee / wk', render: c => fmtMoney(c.employeeWeekly) },
    { key: 'employerWeekly', label: 'Employer / wk', render: c => fmtMoney(c.employerWeekly) },
  ];

  const rowActions = (c: NisClass): RowActionItem[] => [
    ...(canEdit ? [{
      key: 'del', label: 'Delete', icon: 'close' as const, tone: 'danger' as const,
      onClick: () => handleDelete(c.id, c.classNo),
    }] : []),
  ];

  const pageCount = Math.max(1, Math.ceil(classes.length / PAGE_SIZE));

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          class="hrfin-select"
          value={effectiveId}
          onChange={e => { setVersionId((e.currentTarget as HTMLSelectElement).value); setPage(0); }}
          style={{ minWidth: 240 }}
        >
          {versions.map(v => (
            <option key={v.id} value={v.id}>{v.label} · {humanize(v.status)}</option>
          ))}
        </select>
        {selectedVer && <HrfinPill tone={statusTone(selectedVer.status)}>{humanize(selectedVer.status)}</HrfinPill>}
        {canEdit && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button type="button" class="hrfin-action" onClick={() => onImport(effectiveId)}>Import CSV</button>
            <button type="button" class="hrfin-action is-primary" onClick={() => onAdd(effectiveId)}>+ Add Class</button>
          </div>
        )}
      </div>

      <HrfinTable
        columns={columns}
        rows={classes.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)}
        rowKey={c => c.id}
        rowActions={canEdit ? rowActions : undefined}
        page={page}
        pageCount={pageCount}
        total={classes.length}
        pageSize={PAGE_SIZE}
        onPage={setPage}
        noun="classes"
        loading={classesQ.isLoading}
        error={versionsError ?? (classesQ.error ? String(classesQ.error) : undefined)}
        emptyMessage="No NIS classes for this version."
      />
    </div>
  );
}

// ── Pay Components tab ────────────────────────────────────────────────────────

function PayComponentsTab({ components, loading, error, canManage, onNew, onEdit }: {
  components: PayComponent[];
  loading: boolean;
  error?: string;
  canManage: boolean;
  onNew: () => void;
  onEdit: (c: PayComponent) => void;
}): VNode {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'earning' | 'deduction'>('all');
  const [showActive, setShowActive] = useState(true);
  const [page, setPage] = useState(0);

  const retireMut = useStatutoryMutation(financeStatutoryApi.retireComponent);
  const handleRetire = async (c: PayComponent): Promise<void> => {
    const confirmed = await dialog.confirm({ title: `Retire "${c.name}" (${c.code})?`, text: 'It will no longer appear for new pay items.', danger: true, confirmText: 'Retire' });
    if (!confirmed) return;
    try { await retireMut.mutateAsync({ id: c.id }); toast('Component retired.'); }
    catch (e) { toast.error((e as Error).message); }
  };

  const filtered = useMemo(() => {
    let rows = components;
    if (showActive) rows = rows.filter(c => c.isActive);
    if (filter !== 'all') rows = rows.filter(c => c.kind === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(c => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q));
    }
    return rows;
  }, [components, showActive, filter, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const columns: ReadonlyArray<HrfinColumn<PayComponent>> = [
    { key: 'code',      label: 'Code',     render: c => <b style={{ fontFamily: 'monospace' }}>{c.code}</b> },
    { key: 'name',      label: 'Name',     render: c => c.name },
    { key: 'kind',      label: 'Kind',     render: c => <HrfinPill tone={c.kind === 'earning' ? 'ok' : 'wn'}>{humanize(c.kind)}</HrfinPill> },
    { key: 'taxable',   label: 'Taxable',  render: c => c.isTaxable ? '✓' : '—' },
    { key: 'statutory', label: 'Statutory',render: c => c.isStatutory ? '✓' : '—' },
    {
      key: 'status', label: 'Status',
      render: c => <HrfinPill tone={c.isActive ? 'ok' : 'dr'}>{c.isActive ? 'Active' : 'Retired'}</HrfinPill>,
    },
  ];

  const rowActions = (c: PayComponent): RowActionItem[] => [
    ...(canManage ? [{ key: 'edit', label: 'Edit', icon: 'refresh' as const, onClick: () => onEdit(c) }] : []),
    ...(canManage && c.isActive && !c.isStatutory ? [{
      key: 'retire', label: 'Retire', icon: 'close' as const, tone: 'danger' as const,
      onClick: () => handleRetire(c),
    }] : []),
  ];

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['all', 'earning', 'deduction'] as const).map(k => (
          <button key={k} type="button" class={`hrfin-chip${filter === k ? ' is-active' : ''}`} onClick={() => { setFilter(k); setPage(0); }}>
            {k === 'all' ? 'All' : humanize(k)}
          </button>
        ))}
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer', marginLeft: 8 }}>
          <input type="checkbox" checked={showActive} onChange={e => setShowActive((e.currentTarget as HTMLInputElement).checked)} />
          Active only
        </label>
        {canManage && (
          <button type="button" class="hrfin-action is-primary" style={{ marginLeft: 'auto' }} onClick={onNew}>
            + New Component
          </button>
        )}
      </div>

      <HrfinTable
        searchValue={search}
        onSearch={v => { setSearch(v); setPage(0); }}
        searchPlaceholder="Search by code or name…"
        columns={columns}
        rows={filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)}
        rowKey={c => c.id}
        rowActions={canManage ? rowActions : undefined}
        page={page}
        pageCount={pageCount}
        total={filtered.length}
        pageSize={PAGE_SIZE}
        onPage={setPage}
        noun="components"
        loading={loading}
        error={error}
        emptyMessage="No pay components match the current filter."
      />
    </div>
  );
}

// ── NIS Verification tab ──────────────────────────────────────────────────────

function NisVerifyTab({ canVerify }: { canVerify: boolean }): VNode {
  const profilesQ = useNisProfiles({ status: 'pending_verification' });
  const verifyMut = usePayrollMutation(financePayrollApi.verifyNisProfile);
  const rejectMut = usePayrollMutation(financePayrollApi.rejectNisProfile);
  const [page, setPage] = useState(0);

  const profiles = profilesQ.data ?? [];

  // Bulk-resolve employee IDs so table rows use EmployeeCellResolved (one API call).
  const employeeIds = useMemo(
    () => profiles.map(r => String(r['employeeId'] ?? r['employee_id'] ?? '')).filter(Boolean),
    [profiles],
  );
  const { data: nameMap } = useEmployeeNames(employeeIds);

  const verify = async (r: NisProfileRow): Promise<void> => {
    const id = String(r['id'] ?? '');
    if (!id || !canVerify) return;
    try {
      await verifyMut.mutateAsync({ id, verificationNote: null });
      toast('NIS profile verified.');
    } catch (e) { toast.error((e as Error).message); }
  };

  const reject = async (r: NisProfileRow): Promise<void> => {
    const id = String(r['id'] ?? '');
    if (!id || !canVerify) return;
    const reason = await dialog.prompt({ title: 'Rejection reason', text: 'Finance cannot verify this profile. HR must correct and re-submit.', placeholder: 'Rejection reason (required)', confirmText: 'Return to HR' });
    if (!reason?.trim()) return;
    try {
      await rejectMut.mutateAsync({ id, reason });
      toast('NIS profile returned to HR.');
    } catch (e) { toast.error((e as Error).message); }
  };

  const val = (r: NisProfileRow, k: string): string => {
    const v = r[k];
    return v == null || v === '' ? '—' : String(v);
  };

  const columns: ReadonlyArray<HrfinColumn<NisProfileRow>> = [
    {
      key: 'employeeId', label: 'Employee',
      render: r => {
        const empId = val(r, 'employeeId') !== '—' ? val(r, 'employeeId') : val(r, 'employee_id');
        return empId === '—'
          ? <span style={{ opacity: 0.5 }}>—</span>
          : <EmployeeCellResolved resolved={nameMap?.get(empId)} fallbackId={empId} />;
      },
    },
    { key: 'nisNumber',     label: 'NIS #',            render: r => val(r, 'nisNumber') !== '—' ? val(r, 'nisNumber') : val(r, 'nis_number') },
    { key: 'prevEmployer',  label: 'Previous Employer', render: r => val(r, 'previousEmployerName') !== '—' ? val(r, 'previousEmployerName') : val(r, 'previous_employer_name') },
    { key: 'openingYtd',   label: 'Opening YTD (EE)',  render: r => val(r, 'openingYtdNisEmployee') !== '—' ? val(r, 'openingYtdNisEmployee') : val(r, 'opening_ytd_nis_employee') },
    {
      key: 'status', label: 'Status',
      render: r => <HrfinPill tone="wn">{humanize(String(r['nisStatus'] ?? r['nis_status'] ?? 'pending_verification'))}</HrfinPill>,
    },
  ];

  const rowActions = (r: NisProfileRow): RowActionItem[] => {
    const id = String(r['id'] ?? '');
    return canVerify && id ? [
      { key: 'verify', label: 'Verify', icon: 'check',  onClick: () => verify(r) },
      { key: 'reject', label: 'Reject', icon: 'close', tone: 'danger', onClick: () => reject(r) },
    ] : [];
  };

  const pageCount = Math.max(1, Math.ceil(profiles.length / PAGE_SIZE));

  return (
    <HrfinTable
      columns={columns}
      rows={profiles.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) as NisProfileRow[]}
      rowKey={(r: NisProfileRow) => String(r['id'] ?? Math.random())}
      rowActions={canVerify ? rowActions : undefined}
      page={page}
      pageCount={pageCount}
      total={profiles.length}
      pageSize={PAGE_SIZE}
      onPage={setPage}
      noun="profiles"
      loading={profilesQ.isLoading}
      error={profilesQ.error ? String(profilesQ.error) : undefined}
      emptyMessage="No NIS continuity profiles are awaiting verification."
    />
  );
}

// ── Reports tab ───────────────────────────────────────────────────────────────

const REPORTS = [
  { key: 'statutory_version_summary' as StatutoryReportKey, label: 'Version Summary', description: 'All statutory versions with status and dates.' },
  { key: 'nis_class_summary'         as StatutoryReportKey, label: 'NIS Class Summary', description: 'NIS weekly class bands across all versions.' },
  { key: 'pay_component_map'         as StatutoryReportKey, label: 'Pay Component Map', description: 'Pay component catalogue with tax treatment.' },
  { key: 'statutory_approval_history' as StatutoryReportKey, label: 'Approval History', description: 'Full lifecycle audit for all rate versions.' },
];

const REPORT_COLUMNS: Record<StatutoryReportKey, ReportColumn[]> = {
  statutory_version_summary: [
    { header: 'Label',       key: 'label' },
    { header: 'Effective',   key: 'effectiveFrom', format: 'date' },
    { header: 'Jurisdiction',key: 'jurisdiction' },
    { header: 'Status',      key: 'status' },
    { header: 'Active',      value: r => String(r['isActive'] ?? '—') },
    { header: 'Approved By', key: 'approvedBy' },
    { header: 'Activated By',key: 'activatedBy' },
    { header: 'Created At',  key: 'createdAt', format: 'date' },
  ],
  nis_class_summary: [
    { header: 'Class #',         key: 'classNo',         format: 'number' },
    { header: 'Weekly Min',      key: 'weeklyMin',        format: 'currency' },
    { header: 'Weekly Max',      key: 'weeklyMax',        format: 'currency' },
    { header: 'Employee / wk',   key: 'employeeWeekly',  format: 'currency' },
    { header: 'Employer / wk',   key: 'employerWeekly',  format: 'currency' },
    { header: 'Version ID',      key: 'versionId',        hiddenInTable: true },
  ],
  pay_component_map: [
    { header: 'Code',             key: 'code' },
    { header: 'Name',             key: 'name' },
    { header: 'Kind',             key: 'kind' },
    { header: 'Statutory',        value: r => String(r['isStatutory'] ?? '—') },
    { header: 'Taxable',          value: r => String(r['isTaxable'] ?? '—') },
    { header: 'Reduces Charge.',  value: r => String(r['reducesChargeable'] ?? '—') },
    { header: 'Active',           value: r => String(r['isActive'] ?? '—') },
  ],
  statutory_approval_history: [
    { header: 'Action',     key: 'action' },
    { header: 'Actor',      key: 'actorId' },
    { header: 'Version ID', key: 'versionId', hiddenInTable: true },
    { header: 'Reason',     key: 'reason' },
    { header: 'At',         key: 'createdAt', format: 'date' },
  ],
};

function StatReportsTab(): VNode {
  const [selectedReport, setSelectedReport] = useState<StatutoryReportKey | null>(null);
  const reportQ = useStatutoryReport(selectedReport);

  return (
    <ReportPanel
      reports={REPORTS}
      selectedReport={selectedReport}
      onSelectReport={k => setSelectedReport(k as StatutoryReportKey)}
      result={reportQ.data ?? null}
      columns={selectedReport ? (REPORT_COLUMNS[selectedReport] ?? []) : []}
      exportFilename={`statutory-${selectedReport ?? 'report'}`}
      loading={reportQ.isLoading}
      error={reportQ.error ? String(reportQ.error) : null}
    />
  );
}

// ── Rate Version Drawer ───────────────────────────────────────────────────────

type DrawerTab = 'summary' | 'paye' | 'nis' | 'hs' | 'components' | 'runs' | 'history' | 'timeline' | 'audit';
const DRAWER_TABS: { key: DrawerTab; label: string }[] = [
  { key: 'summary',    label: 'Summary' },
  { key: 'paye',       label: 'PAYE Bands' },
  { key: 'nis',        label: 'NIS Classes' },
  { key: 'hs',         label: 'Health Surcharge' },
  { key: 'components', label: 'Pay Components' },
  { key: 'runs',       label: 'Linked Runs' },
  { key: 'history',    label: 'Approval History' },
  { key: 'timeline',   label: 'Timeline' },
  { key: 'audit',      label: 'Audit' },
];

function StatVersionDrawer({ id, open, onClose, canManage, canApprove, onShowNisForm }: {
  id: string | null;
  open: boolean;
  onClose: () => void;
  canManage: boolean;
  canApprove: boolean;
  onShowNisForm: (versionId: string) => void;
}): VNode {
  const [dtab, setDtab] = useState<DrawerTab>('summary');
  const detailQ = useVersionDetail(open ? id : null);
  const componentsQ = usePayComponents({ isStatutory: true });
  const d = detailQ.data;

  // Bulk-resolve actor IDs from the timeline for history/timeline/audit tabs.
  const actorIds = useMemo(
    () => [...new Set((d?.approvalTimeline ?? []).map(e => e.actorId).filter(Boolean))],
    [d],
  );
  const approvedByIds = useMemo(
    () => [...new Set([d?.approvedBy, d?.activatedBy, d?.retiredBy, d?.createdBy].filter((x): x is string => !!x))],
    [d],
  );
  const allActorIds = useMemo(() => [...new Set([...actorIds, ...approvedByIds])], [actorIds, approvedByIds]);
  const { data: nameMap } = useEmployeeNames(allActorIds);

  const submitMut   = useStatutoryMutation(financeStatutoryApi.submitVersion);
  const approveMut  = useStatutoryMutation(financeStatutoryApi.approveVersion);
  const retireMut   = useStatutoryMutation(financeStatutoryApi.retireVersion);

  const run = async (p: Promise<unknown>, ok: string): Promise<void> => {
    try { await p; toast(ok); onClose(); }
    catch (e) { toast.error((e as Error).message); }
  };

  const drawerTitle = d?.label ?? 'Statutory Version';
  const drawerSub   = d ? `${d.jurisdiction} · ${humanize(d.status)} · Effective ${fmtDate(d.effectiveFrom)}` : '';

  const footer = d ? (
    <div style={{ display: 'flex', gap: 8, width: '100%' }}>
      {canManage && d.status === 'draft' && (
        <button class="hrfin-action is-primary" type="button" onClick={() => run(submitMut.mutateAsync({ id: d.id }), 'Submitted for approval.')}>Submit</button>
      )}
      {canApprove && d.status === 'pending_approval' && (
        <>
          <button class="hrfin-action is-primary" type="button" onClick={() => run(approveMut.mutateAsync({ id: d.id }), 'Version approved.')}>Approve</button>
        </>
      )}
      {canManage && d.status === 'active' && (
        <button class="hrfin-action is-danger" type="button" style={{ marginLeft: 'auto' }} onClick={() => run(retireMut.mutateAsync({ id: d.id }), 'Version retired.')}>Retire</button>
      )}
    </div>
  ) : undefined;

  return (
    <Drawer open={open} onClose={onClose} title={drawerTitle} sub={drawerSub} panelClass="hrfin" foot={footer} noFooter={!footer}>
      {!d ? (
        <div class="hrfin"><div class="hrfin-empty">Loading…</div></div>
      ) : (
        <div class="hrfin">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <HrfinPill tone={statusTone(d.status)}>{d.isActive ? 'Active' : humanize(d.status)}</HrfinPill>
            {d.linkedPayrollRunCount > 0 && (
              <span style={{ fontSize: 12, opacity: 0.7 }}>{d.linkedPayrollRunCount} linked payroll run{d.linkedPayrollRunCount !== 1 ? 's' : ''}</span>
            )}
          </div>

          <div class="hrfin-tabs" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
            {DRAWER_TABS.map(t => (
              <button key={t.key} type="button" class={dtab === t.key ? 'is-active' : ''} onClick={() => setDtab(t.key)}>{t.label}</button>
            ))}
          </div>

          {dtab === 'summary' && (
            <div class="hrfin-metric-list">
              <div class="hrfin-metric-row"><span>Label</span><b>{d.label}</b></div>
              <div class="hrfin-metric-row"><span>Effective from</span><b>{fmtDate(d.effectiveFrom)}</b></div>
              <div class="hrfin-metric-row"><span>Jurisdiction</span><b>{d.jurisdiction}</b></div>
              <div class="hrfin-metric-row"><span>Currency</span><b>{d.currency}</b></div>
              <div class="hrfin-metric-row"><span>Status</span><b>{humanize(d.status)}</b></div>
              <div class="hrfin-metric-row"><span>Active</span><b>{d.isActive ? 'Yes' : 'No'}</b></div>
              <div class="hrfin-metric-row"><span>Created</span><b>{fmtDate(d.createdAt)}</b></div>
              {d.approvedBy && <div class="hrfin-metric-row"><span>Approved by</span><b><EmployeeCellResolved resolved={nameMap?.get(d.approvedBy)} fallbackId={d.approvedBy} /></b></div>}
              {d.activatedAt && <div class="hrfin-metric-row"><span>Activated</span><b>{fmtDate(d.activatedAt)}</b></div>}
              {d.retiredAt && <div class="hrfin-metric-row"><span>Retired</span><b>{fmtDate(d.retiredAt)}</b></div>}
            </div>
          )}

          {dtab === 'paye' && (
            <div class="hrfin-metric-list">
              <div class="hrfin-metric-row"><span>Personal Allowance (annual)</span><b>{fmtMoney(d.payePersonalAllowance)}</b></div>
              <div class="hrfin-metric-row"><span>Band 1 Ceiling (annual)</span><b>{fmtMoney(d.payeBand1Ceiling)}</b></div>
              <div class="hrfin-metric-row"><span>Band 1 Rate</span><b>{fmtPercent(d.payeBand1Rate)}</b></div>
              <div class="hrfin-metric-row"><span>Band 2 Rate</span><b>{fmtPercent(d.payeBand2Rate)}</b></div>
            </div>
          )}

          {dtab === 'nis' && (
            <div>
              {d.nisClasses.length === 0 ? (
                <div class="hrfin-empty">No NIS classes configured for this version.
                  {canManage && d.status === 'draft' && (
                    <button type="button" class="hrfin-action is-primary" style={{ marginTop: 12 }} onClick={() => onShowNisForm(d.id)}>+ Add Class</button>
                  )}
                </div>
              ) : (
                <table class="hrfin-detail-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--hrfin-border)' }}>Class</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid var(--hrfin-border)' }}>Weekly Min</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid var(--hrfin-border)' }}>Weekly Max</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid var(--hrfin-border)' }}>EE / wk</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid var(--hrfin-border)' }}>ER / wk</th>
                  </tr></thead>
                  <tbody>{d.nisClasses.map(c => (
                    <tr key={c.id} style={{ borderBottom: '1px solid var(--hrfin-border)' }}>
                      <td style={{ padding: '6px 8px', fontWeight: 600 }}>{c.classNo}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(c.weeklyMin)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.weeklyMax == null ? '∞' : fmtMoney(c.weeklyMax)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(c.employeeWeekly)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(c.employerWeekly)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          )}

          {dtab === 'hs' && (
            <div class="hrfin-metric-list">
              <div class="hrfin-metric-row"><span>Monthly Threshold</span><b>{fmtMoney(d.hsMonthlyThreshold)}</b></div>
              <div class="hrfin-metric-row"><span>Weekly Rate (High)</span><b>{fmtMoney(d.hsWeeklyHigh)}</b></div>
              <div class="hrfin-metric-row"><span>Weekly Rate (Low)</span><b>{fmtMoney(d.hsWeeklyLow)}</b></div>
            </div>
          )}

          {dtab === 'components' && (
            <div>
              <p style={{ fontSize: 13, opacity: 0.7, marginBottom: 12 }}>Statutory pay components in this configuration. Manage the full catalogue in the Pay Components tab.</p>
              {(componentsQ.data ?? []).filter(c => c.isStatutory && c.isActive).length === 0 ? (
                <div class="hrfin-empty">No statutory pay components found.</div>
              ) : (
                <div class="hrfin-metric-list">
                  {(componentsQ.data ?? []).filter(c => c.isStatutory && c.isActive).map(c => (
                    <div key={c.id} class="hrfin-metric-row">
                      <span><b style={{ fontFamily: 'monospace', marginRight: 6 }}>{c.code}</b>{c.name}</span>
                      <HrfinPill tone={c.kind === 'earning' ? 'ok' : 'wn'}>{humanize(c.kind)}</HrfinPill>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {dtab === 'runs' && (
            <div>
              <div class="hrfin-metric-list">
                <div class="hrfin-metric-row"><span>Linked payroll runs</span><b>{d.linkedPayrollRunCount}</b></div>
              </div>
              {d.linkedPayrollRunCount === 0 && (
                <div class="hrfin-empty" style={{ marginTop: 16 }}>No payroll runs are linked to this version.</div>
              )}
              {d.linkedPayrollRunCount > 0 && (
                <div style={{ marginTop: 16 }}>
                  <p style={{ fontSize: 13, opacity: 0.7, margin: '0 0 12px' }}>
                    {d.linkedPayrollRunCount} payroll run{d.linkedPayrollRunCount !== 1 ? 's' : ''} used this statutory version. Open the Payroll module to drill into individual runs.
                  </p>
                  <button
                    type="button"
                    class="hrfin-action is-primary"
                    onClick={() => {
                      onClose();
                      window.dispatchEvent(new CustomEvent('siomac:section', { detail: 's-finance-payroll' }));
                    }}
                  >
                    Open Payroll module ▸
                  </button>
                </div>
              )}
            </div>
          )}

          {dtab === 'history' && (
            <div>
              {d.approvalTimeline.filter(e => ['statutory_version.submitted', 'statutory_version.approved', 'statutory_version.rejected', 'statutory_version.activated', 'statutory_version.retired'].includes(e.action)).length === 0 ? (
                <div class="hrfin-empty">No approval events recorded for this version.</div>
              ) : (
                <div class="hrfin-metric-list">
                  {d.approvalTimeline
                    .filter(e => ['statutory_version.submitted', 'statutory_version.approved', 'statutory_version.rejected', 'statutory_version.activated', 'statutory_version.retired'].includes(e.action))
                    .map(e => (
                      <div key={e.id} class="hrfin-metric-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                        <b>{humanize(e.action)}</b>
                        <span style={{ fontSize: 12, opacity: 0.7 }}>
                          {fmtDate(e.createdAt)} · by <EmployeeCellResolved resolved={nameMap?.get(e.actorId)} fallbackId={e.actorId} />
                          {e.reason && <> · {e.reason}</>}
                        </span>
                      </div>
                    ))
                  }
                </div>
              )}
            </div>
          )}

          {dtab === 'timeline' && (
            <div>
              {d.approvalTimeline.length === 0 ? (
                <div class="hrfin-empty">No timeline events found.</div>
              ) : (
                <ul class="hrfin-activity-list">
                  {d.approvalTimeline.map(e => (
                    <li key={e.id}>
                      <span><svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={1.5}><circle cx="12" cy="12" r="4" /></svg></span>
                      <div>
                        <b>{humanize(e.action)}</b>
                        <small>{fmtDate(e.createdAt)} · <EmployeeCellResolved resolved={nameMap?.get(e.actorId)} fallbackId={e.actorId} />{e.reason ? ` · ${e.reason}` : ''}</small>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {dtab === 'audit' && (
            <div>
              {d.approvalTimeline.length === 0 ? (
                <div class="hrfin-empty">No audit log entries found.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead><tr>
                      {['Action', 'Actor', 'At', 'Reason'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '5px 8px', borderBottom: '1px solid var(--hrfin-border)', fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>{d.approvalTimeline.map(e => (
                      <tr key={e.id}>
                        <td style={{ padding: '5px 8px', borderBottom: '1px solid var(--hrfin-border)' }}>{e.action}</td>
                        <td style={{ padding: '5px 8px', borderBottom: '1px solid var(--hrfin-border)' }}><EmployeeCellResolved resolved={nameMap?.get(e.actorId)} fallbackId={e.actorId} /></td>
                        <td style={{ padding: '5px 8px', borderBottom: '1px solid var(--hrfin-border)' }}>{fmtDate(e.createdAt)}</td>
                        <td style={{ padding: '5px 8px', borderBottom: '1px solid var(--hrfin-border)', opacity: 0.7 }}>{e.reason ?? '—'}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

// ── New Rate Version Wizard (6 steps) ─────────────────────────────────────────

const EMPTY_VERSION: CreateStatutoryVersionArgs = {
  effectiveFrom: '', label: '', jurisdiction: 'TT', currency: 'TTD',
  payePersonalAllowance: 84000, payeBand1Ceiling: 1000000,
  payeBand1Rate: 0.25, payeBand2Rate: 0.30,
  hsMonthlyThreshold: 469.99, hsWeeklyHigh: 4.80, hsWeeklyLow: 2.40,
  nisMonthyCeiling: null,
};

const STEP_LABELS = ['Metadata', 'PAYE Bands', 'Health Surcharge', 'NIS Config', 'Components', 'Review'];

function StatNewVersionWizard({ onClose }: { onClose: () => void }): VNode {
  const [step, setStep] = useState(0);
  const [f, setF] = useState<CreateStatutoryVersionArgs>({ ...EMPTY_VERSION });
  const createMut = useStatutoryMutation(financeStatutoryApi.createVersion);
  const componentsQ = usePayComponents({ isStatutory: true });

  const set = <K extends keyof CreateStatutoryVersionArgs>(k: K, v: CreateStatutoryVersionArgs[K]) =>
    setF(prev => ({ ...prev, [k]: v }));
  const numField = (k: keyof CreateStatutoryVersionArgs) => (e: Event) =>
    set(k, num((e.currentTarget as HTMLInputElement).value) as CreateStatutoryVersionArgs[typeof k]);

  const canNext = step === 0 ? !!(f.effectiveFrom && f.label.trim()) : true;

  const submit = async (): Promise<void> => {
    try {
      await createMut.mutateAsync({ ...f, label: f.label.trim() });
      toast('Rate version created as draft. Submit it for approval when ready.');
      onClose();
    } catch (e) { toast.error((e as Error).message); }
  };

  const fieldStyle = { display: 'flex', flexDirection: 'column' as const, gap: 4 };
  const labelStyle = { fontSize: 12, fontWeight: 600, color: 'var(--muted)' };
  const inputStyle = { padding: '7px 10px', border: '1px solid var(--hrfin-border, #2a3347)', borderRadius: 6, background: 'var(--hrfin-surface-2, #1e2535)', color: 'var(--hrfin-text-primary, #e8eaf2)', fontSize: 14, width: '100%' };

  return (
    <HrfinWizardModal
      open
      title="New Rate Version"
      stepCount={STEP_LABELS.length}
      activeStep={step}
      onClose={onClose}
      onBack={step > 0 ? () => setStep(s => s - 1) : undefined}
      primaryLabel={step < STEP_LABELS.length - 1 ? `Next: ${STEP_LABELS[step + 1]}` : 'Create draft'}
      onPrimary={() => { if (step < STEP_LABELS.length - 1) setStep(s => s + 1); else void submit(); }}
      primaryDisabled={!canNext || createMut.isPending}
      primaryLoading={createMut.isPending}
    >
      {step === 0 && (
        <div style={{ display: 'grid', gap: 14 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Step 1 — Metadata</h3>
          <div style={fieldStyle}>
            <label style={labelStyle}>Effective from *</label>
            <input type="date" style={inputStyle} value={f.effectiveFrom} onInput={e => set('effectiveFrom', (e.currentTarget as HTMLInputElement).value)} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>Version label *</label>
            <input type="text" style={inputStyle} placeholder="e.g. TT 2026 Statutory" value={f.label} onInput={e => set('label', (e.currentTarget as HTMLInputElement).value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Jurisdiction</label>
              <select style={inputStyle} value={f.jurisdiction} onChange={e => set('jurisdiction', (e.currentTarget as HTMLSelectElement).value as 'TT')}>
                <option value="TT">Trinidad and Tobago (TT)</option>
              </select>
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Currency</label>
              <select style={inputStyle} value={f.currency} onChange={e => set('currency', (e.currentTarget as HTMLSelectElement).value as 'TTD')}>
                <option value="TTD">TTD</option>
              </select>
            </div>
          </div>
          {!f.effectiveFrom && <p style={{ fontSize: 12, color: 'var(--danger, #e53)', margin: 0 }}>Effective date is required.</p>}
          {!f.label.trim() && <p style={{ fontSize: 12, color: 'var(--danger, #e53)', margin: 0 }}>Label is required.</p>}
        </div>
      )}

      {step === 1 && (
        <div style={{ display: 'grid', gap: 14 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Step 2 — PAYE Bands</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Personal Allowance (annual, TTD)</label>
              <input type="number" style={inputStyle} step="0.01" value={f.payePersonalAllowance} onInput={numField('payePersonalAllowance')} />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Band 1 Ceiling (annual, TTD)</label>
              <input type="number" style={inputStyle} step="0.01" value={f.payeBand1Ceiling} onInput={numField('payeBand1Ceiling')} />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Band 1 Rate (fraction, e.g. 0.25 = 25%)</label>
              <input type="number" style={inputStyle} step="0.001" min={0} max={1} value={f.payeBand1Rate} onInput={numField('payeBand1Rate')} />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Band 2 Rate (fraction)</label>
              <input type="number" style={inputStyle} step="0.001" min={0} max={1} value={f.payeBand2Rate} onInput={numField('payeBand2Rate')} />
            </div>
          </div>
          {(f.payeBand1Rate > 1 || f.payeBand2Rate > 1) && (
            <p style={{ fontSize: 12, color: 'var(--warning-fg, #f90)', margin: 0 }}>Rates are stored as fractions (0.25 = 25%). A value greater than 1 looks incorrect.</p>
          )}
        </div>
      )}

      {step === 2 && (
        <div style={{ display: 'grid', gap: 14 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Step 3 — Health Surcharge</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Monthly Threshold (TTD)</label>
              <input type="number" style={inputStyle} step="0.01" value={f.hsMonthlyThreshold} onInput={numField('hsMonthlyThreshold')} />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Weekly Rate — High (TTD)</label>
              <input type="number" style={inputStyle} step="0.01" value={f.hsWeeklyHigh} onInput={numField('hsWeeklyHigh')} />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Weekly Rate — Low (TTD)</label>
              <input type="number" style={inputStyle} step="0.01" value={f.hsWeeklyLow} onInput={numField('hsWeeklyLow')} />
            </div>
          </div>
          <p style={{ fontSize: 12, opacity: 0.65, margin: 0 }}>Health Surcharge applies to employee earnings above the monthly threshold. High rate applies to earnings ≥ threshold; low rate below.</p>
        </div>
      )}

      {step === 3 && (
        <div style={{ display: 'grid', gap: 14 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Step 4 — NIS Configuration</h3>
          <div style={fieldStyle}>
            <label style={labelStyle}>NIS Monthly Ceiling (TTD, leave blank for no ceiling)</label>
            <input
              type="number" style={inputStyle} step="0.01"
              value={f.nisMonthyCeiling ?? ''}
              placeholder="Optional"
              onInput={e => {
                const v = (e.currentTarget as HTMLInputElement).value;
                set('nisMonthyCeiling', v === '' ? null : num(v));
              }}
            />
          </div>
          <p style={{ fontSize: 12, opacity: 0.65, margin: 0 }}>NIS class bands are configured after the version is created (in the NIS Classes tab). You can also import them via CSV.</p>
        </div>
      )}

      {step === 4 && (
        <div style={{ display: 'grid', gap: 14 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Step 5 — Pay Component Mappings</h3>
          <p style={{ fontSize: 13, opacity: 0.7, margin: 0 }}>The following statutory pay components are currently active in the catalogue. They will be available for mapping in payroll runs using this version.</p>
          {(componentsQ.data ?? []).filter(c => c.isStatutory && c.isActive).length === 0 ? (
            <div class="hrfin-empty">No statutory pay components defined. Add them in the Pay Components tab after creating this version.</div>
          ) : (
            <div class="hrfin-metric-list">
              {(componentsQ.data ?? []).filter(c => c.isStatutory && c.isActive).map(c => (
                <div key={c.id} class="hrfin-metric-row">
                  <span><b style={{ fontFamily: 'monospace' }}>{c.code}</b> — {c.name}</span>
                  <HrfinPill tone={c.kind === 'earning' ? 'ok' : 'wn'}>{humanize(c.kind)}</HrfinPill>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {step === 5 && (
        <div style={{ display: 'grid', gap: 14 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Step 6 — Review &amp; Create</h3>
          <div class="hrfin-metric-list">
            <div class="hrfin-metric-row"><span>Label</span><b>{f.label}</b></div>
            <div class="hrfin-metric-row"><span>Effective from</span><b>{fmtDate(f.effectiveFrom)}</b></div>
            <div class="hrfin-metric-row"><span>Jurisdiction</span><b>{f.jurisdiction} — {f.currency}</b></div>
            <div class="hrfin-metric-row"><span>PAYE Allowance</span><b>{fmtMoney(f.payePersonalAllowance)}</b></div>
            <div class="hrfin-metric-row"><span>Band 1 Ceiling</span><b>{fmtMoney(f.payeBand1Ceiling)}</b></div>
            <div class="hrfin-metric-row"><span>Band 1 / 2 Rate</span><b>{fmtPercent(f.payeBand1Rate)} / {fmtPercent(f.payeBand2Rate)}</b></div>
            <div class="hrfin-metric-row"><span>HS Monthly Threshold</span><b>{fmtMoney(f.hsMonthlyThreshold)}</b></div>
            <div class="hrfin-metric-row"><span>HS Weekly (High / Low)</span><b>{fmtMoney(f.hsWeeklyHigh)} / {fmtMoney(f.hsWeeklyLow)}</b></div>
            <div class="hrfin-metric-row"><span>NIS Monthly Ceiling</span><b>{f.nisMonthyCeiling != null ? fmtMoney(f.nisMonthyCeiling) : 'None'}</b></div>
          </div>
          <p style={{ fontSize: 12, opacity: 0.65, margin: 0 }}>
            The version will be created as <b>Draft</b>. Submit it for approval, and a different finance manager must approve before it can be activated. NIS class bands are added after creation.
          </p>
        </div>
      )}
    </HrfinWizardModal>
  );
}

// ── NIS Class add/edit dialog ─────────────────────────────────────────────────

function StatNisClassDialog({ versionId, edit, onClose }: {
  versionId: string;
  edit?: NisClass;
  onClose: () => void;
}): VNode {
  const [f, setF] = useState({
    classNo:        edit ? String(edit.classNo) : '',
    weeklyMin:      edit ? String(edit.weeklyMin) : '',
    weeklyMax:      edit?.weeklyMax != null ? String(edit.weeklyMax) : '',
    employeeWeekly: edit ? String(edit.employeeWeekly) : '',
    employerWeekly: edit ? String(edit.employerWeekly) : '',
  });
  const upsertMut = useStatutoryMutation(financeStatutoryApi.upsertNisClass);

  const fieldErrors: string[] = [];
  if (!f.classNo || num(f.classNo) < 1) fieldErrors.push('Class number is required and must be ≥ 1.');
  if (f.weeklyMin === '' || isNaN(Number(f.weeklyMin))) fieldErrors.push('Weekly min is required.');
  if (f.weeklyMax !== '' && num(f.weeklyMax) < num(f.weeklyMin)) fieldErrors.push('Weekly max must be ≥ weekly min.');

  const submit = async (): Promise<void> => {
    if (fieldErrors.length) return;
    try {
      await upsertMut.mutateAsync({
        statutoryVersionId: versionId,
        classNo: num(f.classNo), weeklyMin: num(f.weeklyMin),
        weeklyMax: f.weeklyMax === '' ? null : num(f.weeklyMax),
        employeeWeekly: num(f.employeeWeekly), employerWeekly: num(f.employerWeekly),
      });
      toast(edit ? 'NIS class updated.' : 'NIS class added.');
      onClose();
    } catch (e) { toast.error((e as Error).message); }
  };

  const inputStyle = { padding: '7px 10px', border: `1px solid var(--hrfin-border, #2a3347)`, borderRadius: 6, background: 'var(--hrfin-surface-2, #1e2535)', color: 'var(--hrfin-text-primary, #e8eaf2)', fontSize: 14, width: '100%' };

  return (
    <HrfinWizardModal
      open
      title={edit ? 'Edit NIS Class' : 'Add NIS Class'}
      stepCount={1}
      activeStep={0}
      onClose={onClose}
      primaryLabel={edit ? 'Save changes' : 'Add class'}
      onPrimary={() => void submit()}
      primaryDisabled={fieldErrors.length > 0 || upsertMut.isPending}
      primaryLoading={upsertMut.isPending}
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Class # *</label>
            <input type="number" style={inputStyle} value={f.classNo} onInput={e => setF(p => ({ ...p, classNo: (e.currentTarget as HTMLInputElement).value }))} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Weekly Min (TTD) *</label>
            <input type="number" step="0.01" style={inputStyle} value={f.weeklyMin} onInput={e => setF(p => ({ ...p, weeklyMin: (e.currentTarget as HTMLInputElement).value }))} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Weekly Max (TTD, blank=∞)</label>
            <input type="number" step="0.01" style={inputStyle} value={f.weeklyMax} placeholder="No ceiling" onInput={e => setF(p => ({ ...p, weeklyMax: (e.currentTarget as HTMLInputElement).value }))} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Employee / wk (TTD) *</label>
            <input type="number" step="0.01" style={inputStyle} value={f.employeeWeekly} onInput={e => setF(p => ({ ...p, employeeWeekly: (e.currentTarget as HTMLInputElement).value }))} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Employer / wk (TTD) *</label>
            <input type="number" step="0.01" style={inputStyle} value={f.employerWeekly} onInput={e => setF(p => ({ ...p, employerWeekly: (e.currentTarget as HTMLInputElement).value }))} />
          </div>
        </div>
        {fieldErrors.map((e, i) => (
          <p key={i} style={{ fontSize: 12, color: 'var(--danger, #e53)', margin: 0 }}>{e}</p>
        ))}
      </div>
    </HrfinWizardModal>
  );
}

// ── NIS Classes import dialog ─────────────────────────────────────────────────

function StatNisImportDialog({ versionId, onClose }: { versionId: string; onClose: () => void }): VNode {
  const [csvText, setCsvText] = useState('');
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [parsed, setParsed] = useState<Array<{ classNo: number; weeklyMin: number; weeklyMax: number | null; employeeWeekly: number; employerWeekly: number }>>([]);
  const importMut = useStatutoryMutation(financeStatutoryApi.importNisClasses);

  const TEMPLATE = 'classNo,weeklyMin,weeklyMax,employeeWeekly,employerWeekly\n1,0,299.99,12.95,19.40\n2,300,399.99,17.15,25.70\n3,400,,21.35,32.00';

  const parseCSV = (text: string): void => {
    const lines = text.trim().split('\n');
    if (lines.length < 2) { setParseErrors(['No data rows found. Expected CSV with header row.']); setParsed([]); return; }
    const header = lines[0]!.trim().toLowerCase().split(',');
    const idx = (k: string) => header.indexOf(k);
    const errors: string[] = [];
    const rows: typeof parsed = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i]!.trim().split(',');
      const rn = i;
      const classNo = parseInt(cols[idx('classno')] ?? '', 10);
      const weeklyMin = parseFloat(cols[idx('weeklymin')] ?? '');
      const weeklyMaxStr = (cols[idx('weeklymax')] ?? '').trim();
      const weeklyMax = weeklyMaxStr === '' ? null : parseFloat(weeklyMaxStr);
      const employeeWeekly = parseFloat(cols[idx('employeeweekly')] ?? '');
      const employerWeekly = parseFloat(cols[idx('employerweekly')] ?? '');
      if (isNaN(classNo) || classNo < 1) { errors.push(`Row ${rn}: classNo invalid`); continue; }
      if (isNaN(weeklyMin) || weeklyMin < 0) { errors.push(`Row ${rn}: weeklyMin invalid`); continue; }
      if (isNaN(employeeWeekly) || employeeWeekly < 0) { errors.push(`Row ${rn}: employeeWeekly invalid`); continue; }
      if (isNaN(employerWeekly) || employerWeekly < 0) { errors.push(`Row ${rn}: employerWeekly invalid`); continue; }
      rows.push({ classNo, weeklyMin, weeklyMax, employeeWeekly, employerWeekly });
    }
    setParseErrors(errors);
    setParsed(rows);
  };

  const submit = async (): Promise<void> => {
    if (!parsed.length || parseErrors.length) return;
    try {
      const result = await importMut.mutateAsync({ statutoryVersionId: versionId, rows: parsed });
      if (result.errors.length > 0) {
        setParseErrors(result.errors.map(e => e.message));
        return;
      }
      toast(`${result.imported} NIS classes imported successfully.`);
      onClose();
    } catch (e) { toast.error((e as Error).message); }
  };

  const inputStyle = { padding: '7px 10px', border: '1px solid var(--hrfin-border, #2a3347)', borderRadius: 6, background: 'var(--hrfin-surface-2, #1e2535)', color: 'var(--hrfin-text-primary, #e8eaf2)', fontSize: 13, width: '100%', fontFamily: 'monospace', minHeight: 160, resize: 'vertical' as const };

  return (
    <HrfinWizardModal
      open
      title="Import NIS Classes (CSV)"
      stepCount={1}
      activeStep={0}
      onClose={onClose}
      primaryLabel={`Import ${parsed.length > 0 ? `${parsed.length} class${parsed.length !== 1 ? 'es' : ''}` : ''}`}
      onPrimary={() => void submit()}
      primaryDisabled={!parsed.length || parseErrors.length > 0 || importMut.isPending}
      primaryLoading={importMut.isPending}
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <p style={{ fontSize: 13, opacity: 0.7, margin: 0 }}>Paste CSV with columns: classNo, weeklyMin, weeklyMax (blank = no ceiling), employeeWeekly, employerWeekly. Existing class numbers will be updated.</p>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button type="button" class="hrfin-action" onClick={() => { setCsvText(TEMPLATE); parseCSV(TEMPLATE); }}>Load template</button>
        </div>
        <textarea
          style={inputStyle}
          placeholder={TEMPLATE}
          value={csvText}
          onInput={e => { const v = (e.currentTarget as HTMLTextAreaElement).value; setCsvText(v); parseCSV(v); }}
        />
        {parseErrors.length > 0 && (
          <div>
            {parseErrors.map((e, i) => <p key={i} style={{ fontSize: 12, color: 'var(--danger, #e53)', margin: '2px 0' }}>{e}</p>)}
          </div>
        )}
        {parsed.length > 0 && parseErrors.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--success-fg, #2d9)', margin: 0 }}>✓ {parsed.length} valid row{parsed.length !== 1 ? 's' : ''} ready to import.</p>
        )}
      </div>
    </HrfinWizardModal>
  );
}

// ── Pay Component create/edit dialog ─────────────────────────────────────────

function StatPayComponentDialog({ edit, onClose }: { edit?: PayComponent; onClose: () => void }): VNode {
  const [f, setF] = useState({
    code:               edit?.code ?? '',
    name:               edit?.name ?? '',
    kind:               edit?.kind ?? 'earning',
    isStatutory:        edit?.isStatutory ?? false,
    isTaxable:          edit?.isTaxable ?? true,
    reducesChargeable:  edit?.reducesChargeable ?? false,
    glAccountCode:      edit?.glAccountCode ?? '',
    costAllocationRequired: edit?.costAllocationRequired ?? false,
  });

  const createMut = useStatutoryMutation(financeStatutoryApi.createComponent);
  const updateMut = useStatutoryMutation(financeStatutoryApi.updateComponent);

  const fieldErrors: string[] = [];
  if (!f.code.trim()) fieldErrors.push('Code is required.');
  if (!f.name.trim()) fieldErrors.push('Name is required.');
  if (!/^[A-Za-z0-9_]+$/.test(f.code.trim())) fieldErrors.push('Code must be alphanumeric or underscore only.');

  const submit = async (): Promise<void> => {
    if (fieldErrors.length) return;
    try {
      if (edit) {
        await updateMut.mutateAsync({ id: edit.id, name: f.name.trim(), isStatutory: f.isStatutory, isTaxable: f.isTaxable, reducesChargeable: f.reducesChargeable, glAccountCode: f.glAccountCode.trim() || null, costAllocationRequired: f.costAllocationRequired });
        toast('Pay component updated.');
      } else {
        await createMut.mutateAsync({ code: f.code.trim().toUpperCase(), name: f.name.trim(), kind: f.kind as 'earning' | 'deduction', isStatutory: f.isStatutory, isTaxable: f.isTaxable, reducesChargeable: f.reducesChargeable, glAccountCode: f.glAccountCode.trim() || null, costAllocationRequired: f.costAllocationRequired });
        toast('Pay component created.');
      }
      onClose();
    } catch (e) { toast.error((e as Error).message); }
  };

  const inputStyle = { padding: '7px 10px', border: '1px solid var(--hrfin-border, #2a3347)', borderRadius: 6, background: 'var(--hrfin-surface-2, #1e2535)', color: 'var(--hrfin-text-primary, #e8eaf2)', fontSize: 14, width: '100%' };
  const checkStyle = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' };

  return (
    <HrfinWizardModal
      open
      title={edit ? 'Edit Pay Component' : 'New Pay Component'}
      stepCount={1}
      activeStep={0}
      onClose={onClose}
      primaryLabel={edit ? 'Save changes' : 'Create component'}
      onPrimary={() => void submit()}
      primaryDisabled={fieldErrors.length > 0 || createMut.isPending || updateMut.isPending}
      primaryLoading={createMut.isPending || updateMut.isPending}
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Code * (UPPERCASE)</label>
            <input type="text" style={inputStyle} value={f.code} disabled={!!edit} placeholder="e.g. NIS_EE" onInput={e => setF(p => ({ ...p, code: (e.currentTarget as HTMLInputElement).value }))} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Name *</label>
            <input type="text" style={inputStyle} value={f.name} placeholder="e.g. National Insurance — Employee" onInput={e => setF(p => ({ ...p, name: (e.currentTarget as HTMLInputElement).value }))} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Kind</label>
            <select style={inputStyle} value={f.kind} disabled={!!edit} onChange={e => setF(p => ({ ...p, kind: (e.currentTarget as HTMLSelectElement).value as 'earning' | 'deduction' }))}>
              <option value="earning">Earning</option>
              <option value="deduction">Deduction</option>
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>GL Account Code (optional)</label>
            <input type="text" style={inputStyle} value={f.glAccountCode} placeholder="Optional" onInput={e => setF(p => ({ ...p, glAccountCode: (e.currentTarget as HTMLInputElement).value }))} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={checkStyle}><input type="checkbox" checked={f.isStatutory}    onChange={e => setF(p => ({ ...p, isStatutory: (e.currentTarget as HTMLInputElement).checked }))} />Statutory</label>
          <label style={checkStyle}><input type="checkbox" checked={f.isTaxable}      onChange={e => setF(p => ({ ...p, isTaxable: (e.currentTarget as HTMLInputElement).checked }))} />Taxable</label>
          <label style={checkStyle}><input type="checkbox" checked={f.reducesChargeable} onChange={e => setF(p => ({ ...p, reducesChargeable: (e.currentTarget as HTMLInputElement).checked }))} />Reduces chargeable income</label>
          <label style={checkStyle}><input type="checkbox" checked={f.costAllocationRequired} onChange={e => setF(p => ({ ...p, costAllocationRequired: (e.currentTarget as HTMLInputElement).checked }))} />Cost allocation required</label>
        </div>
        {fieldErrors.map((e, i) => (
          <p key={i} style={{ fontSize: 12, color: 'var(--danger, #e53)', margin: 0 }}>{e}</p>
        ))}
      </div>
    </HrfinWizardModal>
  );
}
