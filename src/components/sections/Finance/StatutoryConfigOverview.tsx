/**
 * src/components/sections/Finance/StatutoryConfigOverview.tsx
 *
 * Finance ▸ Statutory Configuration — self-contained enterprise dashboard.
 * Surfaces: Rate Versions · NIS Classes · Pay Components · NIS Verification · Reports.
 *
 * A faithful, fully-scoped port of conv-statutory-config-dashboard.html:
 * StatutoryDashboard (`.sdb` design system — header · 6 stat cards · combo chart ·
 * readiness donut · upcoming dates · tabbed register + side stack) rendered as a
 * normal page (NOT a widget-board tile). Every tab's register uses the scoped
 * StatTable/StatBadge (no `.hrfin` dependency) so tables/badges/pager are styled
 * standalone. The detail Drawer + Edit dialog remain self-scoped `.hrfin` overlays.
 * All mutations use the backbone server-side; FE raises toast on success/error.
 * SoD enforced server-side (assertDifferentApprover); FE reflects the 422 message.
 */

import { type VNode } from 'preact';
import { useState, useMemo, useEffect } from 'preact/hooks';
import { toast } from '@store';
import { can } from '@lib/permissions';
import { dialog } from '@lib/dialog';
import {
  HrfinPill, HrfinWizardModal, Drawer, exportCsv, PageHeader, NewMenu,
  type RowActionItem, type ActivityItem,
} from '@ui';
import { StatTable, StatBadge, type StatColumn } from './StatTable';
import { StatutoryDashboard, type MainTab as StatMainTab } from './StatutoryDashboard';
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
import { AppTopBar } from '@shared/AppTopBar';
import { EmployeeCell, EmployeeCellResolved } from './_shared/EmployeeCell';
import { fmtMoney, fmtPercent, fmtDate, humanize, toRoman } from './financeShared';
import { ReportPanel, type ReportColumn } from './_shared/reports';
import { StatNisBandPage } from './StatNisBandPage';
import { StatPayComponentPage } from './StatPayComponentPage';
import { StatNisImportPage } from './StatNisImportPage';
import { StatNewVersionPage } from './StatNewVersionPage';
import './finance.css';

// Full-page sub-views (design pivot): rendered in place of the register as a full-page
// takeover, NOT modals. One discriminated union scales across the statutory forms.
type StatSubView =
  | { kind: 'nisBand'; versionId: string; edit?: NisClass }
  | { kind: 'payComponent'; edit?: PayComponent }
  | { kind: 'import'; versionId: string }
  | { kind: 'newVersion' };

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

// Re-use the type exported by StatutoryDashboard so both files share the same literal.
type MainTab = StatMainTab;

// ── Page ──────────────────────────────────────────────────────────────────────

export function StatutoryConfigOverview(): VNode {
  const [tab, setTab] = useState<MainTab>('versions');
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [drawerInitialTab, setDrawerInitialTab] = useState<string>('summary');
  const [editVersion, setEditVersion] = useState<StatutoryVersion | null>(null);
  const [subView, setSubView] = useState<StatSubView | null>(null);

  const openDrawer = (id: string) => { setDrawerInitialTab('summary'); setDrawerId(id); };
  const openDrawerAtRuns = (id: string) => { setDrawerInitialTab('runs'); setDrawerId(id); };

  const versionsQ   = useStatutoryVersions();
  const componentsQ = usePayComponents({ activeOnly: false });
  const nisProfilesQ = useNisProfiles({ status: 'pending_verification' });
  const verifiedProfilesQ = useNisProfiles({ status: 'verified' });

  const versions   = versionsQ.data ?? [];
  const components = componentsQ.data ?? [];
  const activeVer  = versions.find(v => v.isActive) ?? null;

  // NIS bands of the active version — powers the dashboard's NIS contribution chart.
  const activeNisClassesQ = useNisClasses(activeVer?.id ?? null);
  const activeNisClasses  = activeNisClassesQ.data ?? [];

  const canManage  = can('finance.statutory.manage');
  const canApprove = can('finance.statutory.approve');
  const canView    = can('finance.statutory.view');

  // KPI counts
  const drafts    = versions.filter(v => v.status === 'draft').length;
  const pending   = versions.filter(v => v.status === 'pending_approval').length;
  const activeComponents = components.filter(c => c.isActive).length;
  const verifyQueue = nisProfilesQ.data?.length ?? 0;
  const verifiedNisCount = verifiedProfilesQ.data?.length ?? 0;

  // Recent activity from versions list (passed into dashboard for the Activity feed)
  const activityItems: ActivityItem[] = useMemo(() =>
    versions.slice(0, 5).map(v => ({
      icon: v.isActive ? 'check' : v.status === 'pending_approval' ? 'gavel' : 'file',
      title: v.label,
      meta: `${humanize(v.status)} · ${fmtDate(v.effectiveFrom)}`,
    })),
  [versions]);

  // Export handler — shared between header button and any future export entrypoint.
  const handleExport = (): void => {
    exportCsv(versions, [
      { header: 'Label',          value: r => r.label },
      { header: 'Effective From', value: r => r.effectiveFrom },
      { header: 'Jurisdiction',   value: r => r.jurisdiction },
      { header: 'Status',         value: r => r.status },
      { header: 'PAYE Allowance', value: r => r.payePersonalAllowance },
      { header: 'Band 1 Rate',    value: r => fmtPercent(r.payeBand1Rate) },
      { header: 'Band 2 Rate',    value: r => fmtPercent(r.payeBand2Rate) },
      { header: 'HS Monthly',     value: r => r.hsMonthlyThreshold },
      { header: 'Created At',     value: r => r.createdAt },
    ], 'statutory-versions');
    toast('Exported statutory versions CSV.');
  };

  // Full-page sub-view takeover (design pivot): statutory editors are full pages, not
  // modals. Rendered in place of the dashboard; Cancel/Close returns to the dashboard.
  if (subView?.kind === 'nisBand') {
    const vId = subView.versionId;
    return (
      <StatNisBandPage
        versionId={subView.versionId}
        edit={subView.edit}
        onClose={() => setSubView(null)}
        onViewVersion={() => { setSubView(null); openDrawer(vId); }}
      />
    );
  }
  if (subView?.kind === 'payComponent') {
    return <StatPayComponentPage edit={subView.edit} onClose={() => setSubView(null)} />;
  }
  if (subView?.kind === 'import') {
    return <StatNisImportPage versionId={subView.versionId} onClose={() => setSubView(null)} />;
  }
  if (subView?.kind === 'newVersion') {
    return <StatNewVersionPage onClose={() => setSubView(null)} />;
  }

  // ── Tab content (computed here so tab sub-components keep closing over parent state) ─
  const tabContent = (
    <div>
      {tab === 'versions'   && <VersionsTab versions={versions} loading={versionsQ.isLoading} error={versionsQ.error ? String(versionsQ.error) : undefined} canManage={canManage} canApprove={canApprove} onOpenDrawer={openDrawer} onOpenDrawerAtRuns={openDrawerAtRuns} onNew={() => setSubView({ kind: 'newVersion' })} onEdit={setEditVersion} />}
      {tab === 'nis'        && <NisClassesTab versions={versions} versionsError={versionsQ.error ? String(versionsQ.error) : undefined} canManage={canManage} onAdd={v => setSubView({ kind: 'nisBand', versionId: v })} onEdit={(v, c) => setSubView({ kind: 'nisBand', versionId: v, edit: c })} onImport={v => setSubView({ kind: 'import', versionId: v })} />}
      {tab === 'components' && <PayComponentsTab components={components} loading={componentsQ.isLoading} error={componentsQ.error ? String(componentsQ.error) : undefined} canManage={canManage} onNew={() => setSubView({ kind: 'payComponent' })} onEdit={c => setSubView({ kind: 'payComponent', edit: c })} />}
      {tab === 'verify'     && <NisVerifyTab canVerify={can('finance.payroll.nis.verify')} />}
      {tab === 'reports'    && canView && <StatReportsTab />}
    </div>
  );

  // ── Page: the dashboard is a self-contained enterprise page (its own `.sdb`
  // design system), rendered directly — NOT wrapped in the widget board, which
  // was pure ceremony that fought the background and clipped the height. ────────
  return (
    <>
      <AppTopBar />
      <PageHeader
        icon="fa-scale-balanced"
        module="Finance · Statutory Configuration"
        title="Statutory Configuration"
        sub="Manage Trinidad & Tobago statutory rate versions, NIS classes and pay components."
        meta={activeVer
          ? [{ icon: 'fa-circle-dot', label: `Active: ${activeVer.label}` }]
          : [{ icon: 'fa-circle-exclamation', label: 'No active version' }]}
        hidePill
        actions={
          <>
            <button type="button" class="hse-btn" onClick={handleExport}><i class="fas fa-download" /> Export</button>
            {canManage && (
              <NewMenu items={[
                { label: 'New Rate Version',  icon: 'fa-file-circle-plus', onSelect: () => setSubView({ kind: 'newVersion' }) },
                { label: 'New Pay Component', icon: 'fa-layer-group',      onSelect: () => setSubView({ kind: 'payComponent' }) },
                { label: 'Import NIS Classes', icon: 'fa-file-import', sub: activeVer ? undefined : 'Needs an active version',
                  onSelect: () => { if (activeVer) setSubView({ kind: 'import', versionId: activeVer.id }); } },
              ]} />
            )}
          </>
        }
      />
      <StatutoryDashboard
        versions={versions}
        components={components}
        activeVer={activeVer}
        activeNisClasses={activeNisClasses}
        verifiedNisCount={verifiedNisCount}
        drafts={drafts}
        pending={pending}
        activeComponents={activeComponents}
        verifyQueue={verifyQueue}
        activityItems={activityItems}
        versionsLoading={versionsQ.isLoading}
        onVerifyNis={() => setTab('verify')}
        tab={tab}
        onTabChange={setTab}
        tabContent={tabContent}
      />

      {/* Detail drawer — rendered outside the board so it layers above */}
      <StatVersionDrawer
        id={drawerId}
        open={!!drawerId}
        initialTab={drawerInitialTab}
        onClose={() => setDrawerId(null)}
        canManage={canManage}
        canApprove={canApprove}
        onShowNisForm={(vId) => setSubView({ kind: 'nisBand', versionId: vId })}
      />

      {/* Edit draft version dialog */}
      {editVersion && (
        <StatEditVersionDialog version={editVersion} onClose={() => setEditVersion(null)} />
      )}
    </>
  );
}

// ── Rate Versions tab ─────────────────────────────────────────────────────────

function VersionsTab({ versions, loading, error, canManage, canApprove, onOpenDrawer, onOpenDrawerAtRuns, onNew, onEdit }: {
  versions: StatutoryVersion[];
  loading: boolean;
  error?: string;
  canManage: boolean;
  canApprove: boolean;
  onOpenDrawer: (id: string) => void;
  onOpenDrawerAtRuns: (id: string) => void;
  onNew: () => void;
  onEdit: (v: StatutoryVersion) => void;
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

  // Batch-resolve createdBy + approvedBy IDs for Owner and Approval State columns (§20).
  const actorIds = useMemo(
    () => [...new Set(versions.flatMap(v => [v.createdBy, v.approvedBy].filter((x): x is string => !!x)))],
    [versions],
  );
  const { data: nameMap } = useEmployeeNames(actorIds);

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

  const columns: ReadonlyArray<StatColumn<StatutoryVersion>> = [
    {
      key: 'label', label: 'Version', sortable: true,
      render: v => (
        <div>
          <div class="sdb-vname">{v.label}</div>
          <div class="sdb-cell-sub">{v.jurisdiction} · {v.currency}</div>
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
        <div>
          <div>Allow: {fmtMoney(v.payePersonalAllowance)}</div>
          <div class="sdb-cell-sub">{fmtPercent(v.payeBand1Rate)} / {fmtPercent(v.payeBand2Rate)}</div>
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
        <StatBadge tone={statusTone(v.status)}>
          {v.isActive ? 'Active' : humanize(v.status)}
        </StatBadge>
      ),
    },
    // §11 / §20 mandated columns ──────────────────────────────────────────────
    {
      key: 'owner', label: 'Owner',
      render: v => v.createdBy
        ? <EmployeeCellResolved resolved={nameMap?.get(v.createdBy)} fallbackId={v.createdBy} />
        : <span class="sdb-muted-txt">—</span>,
    },
    {
      key: 'linkedRuns', label: 'Linked Runs',
      render: v => {
        const count = v.linkedPayrollRunCount ?? 0;
        return count > 0 ? (
          <button
            type="button" class="sdb-link"
            onClick={e => { e.stopPropagation(); onOpenDrawerAtRuns(v.id); }}
          >
            {count} run{count !== 1 ? 's' : ''}
          </button>
        ) : <span class="sdb-muted-txt">—</span>;
      },
    },
    {
      key: 'approvalState', label: 'Approval',
      render: v => {
        if (v.status === 'draft') return <span class="sdb-cell-sub">Not submitted</span>;
        if (v.status === 'pending_approval') return <StatBadge tone="wn">Awaiting</StatBadge>;
        if (v.approvedBy) return (
          <div>
            <StatBadge tone="ok">Approved</StatBadge>
            <div class="sdb-cell-sub" style={{ marginTop: 3 }}>
              <EmployeeCellResolved resolved={nameMap?.get(v.approvedBy)} fallbackId={v.approvedBy} />
            </div>
          </div>
        );
        return <span class="sdb-muted-txt">—</span>;
      },
    },
  ];

  const rowActions = (v: StatutoryVersion): RowActionItem[] => [
    { key: 'view', label: 'View details', icon: 'file', onClick: () => onOpenDrawer(v.id) },
    ...(canManage && v.status === 'draft' ? [
      {
        key: 'edit', label: 'Edit rates', icon: 'refresh' as const,
        onClick: () => onEdit(v),
      },
      {
        key: 'submit', label: 'Submit for approval', icon: 'send' as const,
        onClick: () => run(submitMut.mutateAsync({ id: v.id }), 'Submitted for approval.'),
      },
    ] : []),
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
    <StatTable
      searchValue={search}
      onSearch={v => { setSearch(v); setPage(0); }}
      searchPlaceholder="Search by label or date…"
      toolbarLeft={statusFilters.map(f => (
        <button
          key={f.key} type="button"
          class={`sdb-chip${statusFilter === f.key ? ' sdb-chip--on' : ''}`}
          onClick={() => { setStatusFilter(f.key); setPage(0); }}
        >{f.label}</button>
      ))}
      toolbarRight={canManage
        ? <button type="button" class="sdb-btn sdb-btn--pri" onClick={onNew}>+ New Rate Version</button>
        : undefined}
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
  );
}

// ── NIS Classes tab ───────────────────────────────────────────────────────────

function NisClassesTab({ versions, versionsError, canManage, onAdd, onEdit, onImport }: {
  versions: StatutoryVersion[];
  versionsError?: string;
  canManage: boolean;
  onAdd: (versionId: string) => void;
  onEdit: (versionId: string, cls: NisClass) => void;
  onImport: (versionId: string) => void;
}): VNode {
  const [versionId, setVersionId] = useState<string>(() => versions.find(v => v.isActive)?.id ?? versions[0]?.id ?? '');
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const effectiveId = versionId || (versions[0]?.id ?? '');
  const classesQ   = useNisClasses(effectiveId || null);
  const allClasses = classesQ.data ?? [];
  const selectedVer = versions.find(v => v.id === effectiveId);
  // Mirror the server gate (upsertNisClasses): bands are editable on draft OR approved.
  const canEdit    = canManage && (selectedVer?.status === 'draft' || selectedVer?.status === 'approved');

  // §20: register has search — filter within the version's classes.
  const classes = useMemo(() => {
    if (!search.trim()) return allClasses;
    const q = search.toLowerCase();
    return allClasses.filter(c =>
      String(c.classNo).includes(q) ||
      toRoman(c.classNo).toLowerCase().includes(q) ||
      String(c.weeklyMin).includes(q) ||
      (c.weeklyMax != null && String(c.weeklyMax).includes(q)) ||
      (c.assumedAverageWeekly != null && String(c.assumedAverageWeekly).includes(q)) ||
      String(c.employeeWeekly).includes(q) ||
      String(c.employerWeekly).includes(q),
    );
  }, [allClasses, search]);

  const deleteMut = useStatutoryMutation(financeStatutoryApi.deleteNisClass);
  const handleDelete = async (id: string, classNo: number): Promise<void> => {
    const confirmed = await dialog.confirm({ title: `Delete NIS Contribution Band ${classNo}?`, text: 'This removes the band from this rate version. This cannot be undone.', danger: true, confirmText: 'Delete band' });
    if (!confirmed) return;
    try { await deleteMut.mutateAsync({ id }); toast(`NIS Contribution Band ${classNo} deleted.`); }
    catch (e) { toast.error((e as Error).message); }
  };

  const columns: ReadonlyArray<StatColumn<NisClass>> = [
    { key: 'classNo',        label: 'Class',          render: c => <b>{toRoman(c.classNo)}</b> },
    { key: 'weeklyMin',      label: 'Weekly Min',     render: c => fmtMoney(c.weeklyMin) },
    { key: 'weeklyMax',      label: 'Weekly Max',     render: c => c.weeklyMax == null ? <span class="sdb-muted-txt">and over</span> : fmtMoney(c.weeklyMax) },
    { key: 'assumedAvg',     label: 'Assumed Avg',    render: c => c.assumedAverageWeekly == null ? <span class="sdb-muted-txt">—</span> : fmtMoney(c.assumedAverageWeekly) },
    { key: 'employeeWeekly', label: 'Employee / wk',  render: c => fmtMoney(c.employeeWeekly) },
    { key: 'employerWeekly', label: 'Employer / wk',  render: c => fmtMoney(c.employerWeekly) },
    { key: 'totalWeekly',    label: 'Total / wk',     render: c => <b>{fmtMoney(c.employeeWeekly + c.employerWeekly)}</b> },
    { key: 'classZ',         label: 'Class Z / wk',   render: c => c.classZWeekly == null ? <span class="sdb-muted-txt">—</span> : <span class="sdb-muted-txt">{fmtMoney(c.classZWeekly)}</span> },
  ];

  const rowActions = (c: NisClass): RowActionItem[] => [
    {
      key: 'open', label: canEdit ? 'Edit band' : 'View band', icon: 'file' as const,
      onClick: () => onEdit(effectiveId, c),
    },
    ...(canEdit ? [{
      key: 'del', label: 'Delete', icon: 'close' as const, tone: 'danger' as const,
      onClick: () => handleDelete(c.id, c.classNo),
    }] : []),
  ];

  const pageCount = Math.max(1, Math.ceil(classes.length / PAGE_SIZE));

  return (
    <>
      <StatTable
        searchValue={search}
        onSearch={v => { setSearch(v); setPage(0); }}
        searchPlaceholder="Search by class # or amount…"
        toolbarLeft={
          <>
            <select
              class="sdb-select"
              value={effectiveId}
              onChange={e => { setVersionId((e.currentTarget as HTMLSelectElement).value); setPage(0); }}
              style={{ minWidth: 220 }}
              aria-label="Rate version"
            >
              {versions.map(v => (
                <option key={v.id} value={v.id}>{v.label} · {humanize(v.status)}</option>
              ))}
            </select>
            {selectedVer && <StatBadge tone={statusTone(selectedVer.status)}>{humanize(selectedVer.status)}</StatBadge>}
          </>
        }
        toolbarRight={canEdit
          ? <>
              <button type="button" class="sdb-btn" onClick={() => onImport(effectiveId)}>Import CSV</button>
              <button type="button" class="sdb-btn sdb-btn--pri" onClick={() => onAdd(effectiveId)}>+ Add Band</button>
            </>
          : undefined}
        columns={columns}
        rows={classes.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)}
        rowKey={c => c.id}
        rowActions={rowActions}
        page={page}
        pageCount={pageCount}
        total={classes.length}
        pageSize={PAGE_SIZE}
        onPage={setPage}
        noun="bands"
        loading={classesQ.isLoading}
        error={versionsError ?? (classesQ.error ? String(classesQ.error) : undefined)}
        emptyMessage="No NIS contribution bands for this version."
      />
      <p class="sdb-note">
        NIBTT weekly Earnings-Class schedule (contribution rate 16.2% — employee ⅓, employer ⅔). “Assumed Avg” is the earnings figure the contribution is based on. “Class Z” is the reduced weekly rate for workers over pensionable age (employment-injury portion only).
      </p>
    </>
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
  const [sortField, setSortField] = useState<string>('code');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

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
    // §20: register has sort
    rows = [...rows].sort((a, b) => {
      const aVal = String(a[sortField as keyof typeof a] ?? '');
      const bVal = String(b[sortField as keyof typeof b] ?? '');
      return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });
    return rows;
  }, [components, showActive, filter, search, sortField, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const columns: ReadonlyArray<StatColumn<PayComponent>> = [
    { key: 'code',      label: 'Code',     sortable: true, render: c => <b style={{ fontFamily: 'monospace' }}>{c.code}</b> },
    { key: 'name',      label: 'Name',     sortable: true, render: c => c.name },
    { key: 'kind',      label: 'Kind',     sortable: true, render: c => <StatBadge tone={c.kind === 'earning' ? 'ok' : 'wn'}>{humanize(c.kind)}</StatBadge> },
    { key: 'taxable',   label: 'Taxable',  align: 'center', render: c => c.isTaxable ? '✓' : '—' },
    { key: 'statutory', label: 'Statutory', align: 'center', render: c => c.isStatutory ? '✓' : '—' },
    {
      key: 'isActive', label: 'Status', sortable: true,
      render: c => <StatBadge tone={c.isActive ? 'ok' : 'dr'}>{c.isActive ? 'Active' : 'Retired'}</StatBadge>,
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
    <StatTable
      searchValue={search}
      onSearch={v => { setSearch(v); setPage(0); }}
      searchPlaceholder="Search by code or name…"
      toolbarLeft={
        <>
          {(['all', 'earning', 'deduction'] as const).map(k => (
            <button key={k} type="button" class={`sdb-chip${filter === k ? ' sdb-chip--on' : ''}`} onClick={() => { setFilter(k); setPage(0); }}>
              {k === 'all' ? 'All' : humanize(k)}
            </button>
          ))}
          <label class="sdb-check">
            <input type="checkbox" checked={showActive} onChange={e => setShowActive((e.currentTarget as HTMLInputElement).checked)} />
            Active only
          </label>
        </>
      }
      toolbarRight={canManage
        ? <button type="button" class="sdb-btn sdb-btn--pri" onClick={onNew}>+ New Component</button>
        : undefined}
      sortField={sortField}
      sortDir={sortDir}
      onSort={(f, d) => { setSortField(f); setSortDir(d); setPage(0); }}
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
  );
}

// ── NIS Verification tab ──────────────────────────────────────────────────────

function NisVerifyTab({ canVerify }: { canVerify: boolean }): VNode {
  const profilesQ = useNisProfiles({ status: 'pending_verification' });
  const verifyMut = usePayrollMutation(financePayrollApi.verifyNisProfile);
  const rejectMut = usePayrollMutation(financePayrollApi.rejectNisProfile);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<string>('nisNumber');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

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

  // Dual-key accessor (backend may return camelCase or snake_case).
  const dv = (r: NisProfileRow, camel: string, snake: string): string => {
    const c = val(r, camel); return c !== '—' ? c : val(r, snake);
  };

  // §20: register has search/filter/sort.
  const filteredProfiles = useMemo(() => {
    let rows = profiles;
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        dv(r, 'nisNumber', 'nis_number').toLowerCase().includes(q) ||
        dv(r, 'employeeId', 'employee_id').toLowerCase().includes(q) ||
        dv(r, 'previousEmployerName', 'previous_employer_name').toLowerCase().includes(q),
      );
    }
    return [...rows].sort((a, b) => {
      const aVal = dv(a, sortField, sortField.replace(/([A-Z])/g, '_$1').toLowerCase());
      const bVal = dv(b, sortField, sortField.replace(/([A-Z])/g, '_$1').toLowerCase());
      return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });
  }, [profiles, search, sortField, sortDir]);

  const columns: ReadonlyArray<StatColumn<NisProfileRow>> = [
    {
      key: 'employeeId', label: 'Employee', sortable: true,
      render: r => {
        const empId = dv(r, 'employeeId', 'employee_id');
        return empId === '—'
          ? <span class="sdb-muted-txt">—</span>
          : <EmployeeCellResolved resolved={nameMap?.get(empId)} fallbackId={empId} />;
      },
    },
    { key: 'nisNumber',    label: 'NIS #',             sortable: true, render: r => dv(r, 'nisNumber', 'nis_number') },
    { key: 'prevEmployer', label: 'Previous Employer',  sortable: true, render: r => dv(r, 'previousEmployerName', 'previous_employer_name') },
    { key: 'openingYtd',  label: 'Opening YTD (EE)',   render: r => dv(r, 'openingYtdNisEmployee', 'opening_ytd_nis_employee') },
    {
      key: 'nisStatus', label: 'Status', sortable: true,
      render: r => <StatBadge tone="wn">{humanize(String(r['nisStatus'] ?? r['nis_status'] ?? 'pending_verification'))}</StatBadge>,
    },
  ];

  const rowActions = (r: NisProfileRow): RowActionItem[] => {
    const id = String(r['id'] ?? '');
    return canVerify && id ? [
      { key: 'verify', label: 'Verify', icon: 'check',  onClick: () => verify(r) },
      { key: 'reject', label: 'Reject', icon: 'close', tone: 'danger', onClick: () => reject(r) },
    ] : [];
  };

  const pageCount = Math.max(1, Math.ceil(filteredProfiles.length / PAGE_SIZE));

  return (
    <StatTable
      searchValue={search}
      onSearch={v => { setSearch(v); setPage(0); }}
      searchPlaceholder="Search by NIS #, employee or employer…"
      sortField={sortField}
      sortDir={sortDir}
      onSort={(f, d) => { setSortField(f); setSortDir(d); setPage(0); }}
      columns={columns}
      rows={filteredProfiles.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) as NisProfileRow[]}
      rowKey={(r: NisProfileRow) => String(r['id'] ?? Math.random())}
      rowActions={canVerify ? rowActions : undefined}
      page={page}
      pageCount={pageCount}
      total={filteredProfiles.length}
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

function StatVersionDrawer({ id, open, initialTab = 'summary', onClose, canManage, canApprove, onShowNisForm }: {
  id: string | null;
  open: boolean;
  initialTab?: string;
  onClose: () => void;
  canManage: boolean;
  canApprove: boolean;
  onShowNisForm: (versionId: string) => void;
}): VNode {
  const [dtab, setDtab] = useState<DrawerTab>('summary');

  // Reset to the requested tab whenever the drawer opens for a new version or initial tab changes.
  useEffect(() => {
    if (open && id) setDtab(initialTab as DrawerTab);
  }, [open, id, initialTab]);
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

// ── Edit draft Rate Version dialog ────────────────────────────────────────────
//
// Surfaces the /versions/update backend route — corrects Gap 2 (accept-and-drop:
// the route existed but was never wired in the FE). Only shown for draft versions.
// All updatable rate fields are included (label, PAYE, HS, NIS ceiling).

function StatEditVersionDialog({ version, onClose }: {
  version: StatutoryVersion;
  onClose: () => void;
}): VNode {
  const [f, setF] = useState({
    label:                 version.label,
    payePersonalAllowance: String(version.payePersonalAllowance),
    payeBand1Ceiling:      String(version.payeBand1Ceiling),
    payeBand1Rate:         String(version.payeBand1Rate),
    payeBand2Rate:         String(version.payeBand2Rate),
    hsMonthlyThreshold:    String(version.hsMonthlyThreshold),
    hsWeeklyHigh:          String(version.hsWeeklyHigh),
    hsWeeklyLow:           String(version.hsWeeklyLow),
    nisMonthyCeiling:      version.nisMonthyCeiling != null ? String(version.nisMonthyCeiling) : '',
  });

  const updateMut = useStatutoryMutation(financeStatutoryApi.updateVersion);

  const fieldErrors: string[] = [];
  if (!f.label.trim()) fieldErrors.push('Label is required.');
  if (isNaN(Number(f.payePersonalAllowance)) || Number(f.payePersonalAllowance) < 0) fieldErrors.push('PAYE personal allowance must be ≥ 0.');
  if (isNaN(Number(f.payeBand1Rate)) || Number(f.payeBand1Rate) > 1 || Number(f.payeBand1Rate) < 0) fieldErrors.push('Band 1 rate must be between 0 and 1.');
  if (isNaN(Number(f.payeBand2Rate)) || Number(f.payeBand2Rate) > 1 || Number(f.payeBand2Rate) < 0) fieldErrors.push('Band 2 rate must be between 0 and 1.');

  const submit = async (): Promise<void> => {
    if (fieldErrors.length) return;
    try {
      await updateMut.mutateAsync({
        id: version.id,
        label: f.label.trim(),
        payePersonalAllowance: Number(f.payePersonalAllowance),
        payeBand1Ceiling:      Number(f.payeBand1Ceiling),
        payeBand1Rate:         Number(f.payeBand1Rate),
        payeBand2Rate:         Number(f.payeBand2Rate),
        hsMonthlyThreshold:    Number(f.hsMonthlyThreshold),
        hsWeeklyHigh:          Number(f.hsWeeklyHigh),
        hsWeeklyLow:           Number(f.hsWeeklyLow),
        nisMonthyCeiling:      f.nisMonthyCeiling === '' ? null : Number(f.nisMonthyCeiling),
      });
      toast('Draft version updated.');
      onClose();
    } catch (e) { toast.error((e as Error).message); }
  };

  const inputStyle = { padding: '7px 10px', border: '1px solid var(--hrfin-border, #2a3347)', borderRadius: 6, background: 'var(--hrfin-surface-2, #1e2535)', color: 'var(--hrfin-text-primary, #e8eaf2)', fontSize: 14, width: '100%' };
  const labelStyle = { fontSize: 12, fontWeight: 600 as const, color: 'var(--muted)' };
  const fieldStyle = { display: 'flex', flexDirection: 'column' as const, gap: 4 };

  return (
    <HrfinWizardModal
      open
      title={`Edit: ${version.label}`}
      stepCount={1}
      activeStep={0}
      onClose={onClose}
      primaryLabel="Save changes"
      onPrimary={() => void submit()}
      primaryDisabled={fieldErrors.length > 0 || updateMut.isPending}
      primaryLoading={updateMut.isPending}
    >
      <div style={{ display: 'grid', gap: 18 }}>
        <p style={{ fontSize: 12, opacity: 0.65, margin: 0 }}>
          Editing draft <b>{version.label}</b> · effective {fmtDate(version.effectiveFrom)} · {version.jurisdiction}.
          Effective date and jurisdiction cannot be changed after creation.
        </p>

        <div style={fieldStyle}>
          <label style={labelStyle}>Version label *</label>
          <input type="text" style={inputStyle} value={f.label}
            onInput={e => setF(p => ({ ...p, label: (e.currentTarget as HTMLInputElement).value }))} />
        </div>

        <fieldset style={{ border: '1px solid var(--hrfin-border, #2a3347)', borderRadius: 6, padding: '12px 14px', margin: 0 }}>
          <legend style={{ fontSize: 12, fontWeight: 500, padding: '0 6px', color: 'var(--muted)' }}>PAYE Bands</legend>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Personal Allowance (annual, TTD)</label>
              <input type="number" style={inputStyle} step="0.01" value={f.payePersonalAllowance}
                onInput={e => setF(p => ({ ...p, payePersonalAllowance: (e.currentTarget as HTMLInputElement).value }))} />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Band 1 Ceiling (annual, TTD)</label>
              <input type="number" style={inputStyle} step="0.01" value={f.payeBand1Ceiling}
                onInput={e => setF(p => ({ ...p, payeBand1Ceiling: (e.currentTarget as HTMLInputElement).value }))} />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Band 1 Rate (0–1, e.g. 0.25 = 25%)</label>
              <input type="number" style={inputStyle} step="0.001" min={0} max={1} value={f.payeBand1Rate}
                onInput={e => setF(p => ({ ...p, payeBand1Rate: (e.currentTarget as HTMLInputElement).value }))} />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Band 2 Rate (0–1)</label>
              <input type="number" style={inputStyle} step="0.001" min={0} max={1} value={f.payeBand2Rate}
                onInput={e => setF(p => ({ ...p, payeBand2Rate: (e.currentTarget as HTMLInputElement).value }))} />
            </div>
          </div>
        </fieldset>

        <fieldset style={{ border: '1px solid var(--hrfin-border, #2a3347)', borderRadius: 6, padding: '12px 14px', margin: 0 }}>
          <legend style={{ fontSize: 12, fontWeight: 500, padding: '0 6px', color: 'var(--muted)' }}>Health Surcharge</legend>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Monthly Threshold (TTD)</label>
              <input type="number" style={inputStyle} step="0.01" value={f.hsMonthlyThreshold}
                onInput={e => setF(p => ({ ...p, hsMonthlyThreshold: (e.currentTarget as HTMLInputElement).value }))} />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Weekly Rate — High (TTD)</label>
              <input type="number" style={inputStyle} step="0.01" value={f.hsWeeklyHigh}
                onInput={e => setF(p => ({ ...p, hsWeeklyHigh: (e.currentTarget as HTMLInputElement).value }))} />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Weekly Rate — Low (TTD)</label>
              <input type="number" style={inputStyle} step="0.01" value={f.hsWeeklyLow}
                onInput={e => setF(p => ({ ...p, hsWeeklyLow: (e.currentTarget as HTMLInputElement).value }))} />
            </div>
          </div>
        </fieldset>

        <div style={fieldStyle}>
          <label style={labelStyle}>NIS Monthly Ceiling (TTD, blank = no ceiling)</label>
          <input type="number" style={inputStyle} step="0.01" placeholder="Optional"
            value={f.nisMonthyCeiling}
            onInput={e => setF(p => ({ ...p, nisMonthyCeiling: (e.currentTarget as HTMLInputElement).value }))} />
        </div>

        {fieldErrors.map((e, i) => (
          <p key={i} style={{ fontSize: 12, color: 'var(--danger, #e53)', margin: 0 }}>{e}</p>
        ))}
      </div>
    </HrfinWizardModal>
  );
}
