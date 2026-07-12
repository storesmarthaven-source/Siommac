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
import { useSessionStore, selectUserId } from '@store/session';
import { can } from '@lib/permissions';
import { dialog } from '@lib/dialog';
import {
  HrfinPill, HrfinWizardModal, Drawer, exportCsv, NewMenu,
  DataTable, type DtColumn, type DtAction,
  FilterDropdown, AdvancedFilter, useFilterDropdowns,
  type RowActionItem,
} from '@ui';
import { StatTable, StatBadge } from './StatTable';
import { StatutoryDashboard, type MainTab as StatMainTab } from './StatutoryDashboard';
import {
  useStatutoryVersions, useNisClasses, usePayComponents, useVersionDetail,
  useStatutoryReport, useStatutoryMutation, usePayComponentChangeRequests,
  financeStatutoryApi,
  type StatutoryVersion, type NisClass, type PayComponent, type PayComponentChangeRequest,
  type CreateStatutoryVersionArgs, type StatutoryReportKey,
} from '@api/finance/statutory';
import {
  useNisProfiles, usePayrollMutation, financePayrollApi, type NisProfileRow,
} from '@api/finance/payroll';
import { useEmployeeNames } from '@api/finance/lookups';
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

  const versions   = versionsQ.data ?? [];
  const components = componentsQ.data ?? [];
  const activeVer  = versions.find(v => v.isActive) ?? null;

  // NIS bands of the active version — powers the dashboard's NIS contribution chart.
  const activeNisClassesQ = useNisClasses(activeVer?.id ?? null);
  const activeNisClasses  = activeNisClassesQ.data ?? [];

  const currentUserId = useSessionStore(selectUserId);
  const canManage  = can('finance.statutory.manage');
  const canApprove = can('finance.statutory.approve');
  const canView    = can('finance.statutory.view');
  const canManageComponents  = can('finance.payroll.components.manage');
  const canApproveComponents = can('finance.payroll.components.approve');

  // KPI counts
  const drafts    = versions.filter(v => v.status === 'draft').length;
  const pending   = versions.filter(v => v.status === 'pending_approval').length;
  const activeComponents = components.filter(c => c.isActive).length;
  const verifyQueue = nisProfilesQ.data?.length ?? 0;

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
      {tab === 'versions'   && <VersionsTab versions={versions} loading={versionsQ.isLoading} error={versionsQ.error ? String(versionsQ.error) : undefined} canManage={canManage} canApprove={canApprove} onOpenDrawer={openDrawer} onOpenDrawerAtRuns={openDrawerAtRuns} onEdit={setEditVersion} />}
      {tab === 'nis'        && <NisClassesTab versions={versions} versionsError={versionsQ.error ? String(versionsQ.error) : undefined} canManage={canManage} onAdd={v => setSubView({ kind: 'nisBand', versionId: v })} onEdit={(v, c) => setSubView({ kind: 'nisBand', versionId: v, edit: c })} onImport={v => setSubView({ kind: 'import', versionId: v })} />}
      {tab === 'components' && <PayComponentsTab components={components} loading={componentsQ.isLoading} error={componentsQ.error ? String(componentsQ.error) : undefined} canManage={canManageComponents} canApproveComponents={canApproveComponents} currentUserId={currentUserId} onEdit={c => setSubView({ kind: 'payComponent', edit: c })} />}
      {tab === 'verify'     && <NisVerifyTab canVerify={can('finance.payroll.nis.verify')} />}
      {tab === 'reports'    && canView && <StatReportsTab />}
    </div>
  );

  // ── Page: the dashboard is a self-contained enterprise page (its own `.sdb`
  // design system), rendered directly — NOT wrapped in the widget board, which
  // was pure ceremony that fought the background and clipped the height. ────────
  const headerActions = (
    <>
      <button type="button" class="hse-btn" onClick={handleExport}><i class="fas fa-download" /> Export</button>
      {canManage && (
        <NewMenu items={[
          { label: 'New Rate Version',  icon: 'FilePlus2', onSelect: () => setSubView({ kind: 'newVersion' }) },
          { label: 'New Pay Component', icon: 'Layers',    onSelect: () => setSubView({ kind: 'payComponent' }) },
          { label: 'Import NIS Classes', icon: 'FileInput', sub: activeVer ? undefined : 'Needs an active version',
            onSelect: () => { if (activeVer) setSubView({ kind: 'import', versionId: activeVer.id }); } },
        ]} />
      )}
    </>
  );

  return (
    <>
      <StatutoryDashboard
        headerActions={headerActions}
        versions={versions}
        components={components}
        activeVer={activeVer}
        activeNisClasses={activeNisClasses}
        drafts={drafts}
        pending={pending}
        activeComponents={activeComponents}
        verifyQueue={verifyQueue}
        versionsLoading={versionsQ.isLoading}
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

function VersionsTab({ versions, loading, error, canManage, canApprove, onOpenDrawer, onOpenDrawerAtRuns, onEdit }: {
  versions: StatutoryVersion[];
  loading: boolean;
  error?: string;
  canManage: boolean;
  canApprove: boolean;
  onOpenDrawer: (id: string) => void;
  onOpenDrawerAtRuns: (id: string) => void;
  onEdit: (v: StatutoryVersion) => void;
}): VNode {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string[]>([]);      // basic filter (multi-select)
  const [effFrom, setEffFrom] = useState('');              // advanced: effective-date range
  const [effTo, setEffTo] = useState('');
  const [rateMin, setRateMin] = useState('');              // advanced: NIS-rate range
  const [rateMax, setRateMax] = useState('');
  const [owner, setOwner] = useState<string[]>([]);        // advanced: owner
  const [page, setPage] = useState(0);
  const [sortField, setSortField] = useState<string>('effectiveFrom');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const { openId, setOpenId } = useFilterDropdowns();

  const submitMut   = useStatutoryMutation(financeStatutoryApi.submitVersion);
  const approveMut  = useStatutoryMutation(financeStatutoryApi.approveVersion);
  const rejectMut   = useStatutoryMutation(financeStatutoryApi.rejectVersion);
  const activateMut = useStatutoryMutation(financeStatutoryApi.activateVersion);
  const retireMut   = useStatutoryMutation(financeStatutoryApi.retireVersion);
  const currentUserId = useSessionStore(selectUserId);

  // Batch-resolve createdBy + approvedBy IDs for Owner and Approval State columns (§20).
  const actorIds = useMemo(
    () => [...new Set(versions.flatMap(v => [v.createdBy, v.approvedBy].filter((x): x is string => !!x)))],
    [versions],
  );
  const { data: nameMap } = useEmployeeNames(actorIds);

  const run = async (p: Promise<unknown>, ok: string): Promise<void> => {
    try { await p; toast(ok); } catch (e) { toast.error((e as Error).message); }
  };

  const ownerOptions = useMemo(
    () => [...new Set(versions.map(v => v.createdBy).filter((x): x is string => !!x))],
    [versions],
  );

  const filtered = useMemo(() => {
    let rows = versions;
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(v => v.label.toLowerCase().includes(q) || v.effectiveFrom.includes(q) || v.jurisdiction.toLowerCase().includes(q));
    }
    if (status.length) rows = rows.filter(v => status.includes(v.status));
    if (effFrom) rows = rows.filter(v => v.effectiveFrom >= effFrom);
    if (effTo)   rows = rows.filter(v => v.effectiveFrom <= effTo);
    if (rateMin) rows = rows.filter(v => v.nisRatePercent != null && v.nisRatePercent >= Number(rateMin));
    if (rateMax) rows = rows.filter(v => v.nisRatePercent != null && v.nisRatePercent <= Number(rateMax));
    if (owner.length) rows = rows.filter(v => v.createdBy != null && owner.includes(v.createdBy));
    rows = [...rows].sort((a, b) => {
      const aVal = String(a[sortField as keyof StatutoryVersion] ?? '');
      const bVal = String(b[sortField as keyof StatutoryVersion] ?? '');
      return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });
    return rows;
  }, [versions, search, status, effFrom, effTo, rateMin, rateMax, owner, sortField, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows  = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Locked register columns (T&T-tailored): Version · Effective · NIS Rate · Status ·
  // Owner · Linked Runs · Approval. PAYE bands + Health Surcharge tiers live in the
  // version drawer, not the list. NIS Rate is the headline effective-rate marker.
  const columns: DtColumn<StatutoryVersion>[] = [
    {
      key: 'label', label: 'Version', isPinned: true, sortAccessor: v => v.label,
      renderCell: v => <span class="sdb-vname">{v.label}</span>,
    },
    {
      key: 'effectiveFrom', label: 'Effective', sortAccessor: v => v.effectiveFrom,
      renderCell: v => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtDate(v.effectiveFrom)}</span>,
    },
    {
      key: 'nisRatePercent', label: 'NIS Rate', align: 'right', sortAccessor: v => v.nisRatePercent ?? -1,
      renderCell: v => v.nisRatePercent != null
        ? <b style={{ fontVariantNumeric: 'tabular-nums' }}>{v.nisRatePercent}%</b>
        : <span class="sdb-muted-txt">—</span>,
    },
    {
      key: 'status', label: 'Status', sortAccessor: v => v.status,
      renderCell: v => <StatBadge tone={statusTone(v.status)}>{v.isActive ? 'Active' : humanize(v.status)}</StatBadge>,
    },
    {
      key: 'owner', label: 'Owner',
      renderCell: v => v.createdBy
        ? <EmployeeCellResolved resolved={nameMap?.get(v.createdBy)} fallbackId={v.createdBy} />
        : <span class="sdb-muted-txt">—</span>,
    },
    {
      key: 'linkedRuns', label: 'Linked Runs', align: 'center',
      renderCell: v => {
        const count = v.linkedPayrollRunCount ?? 0;
        return count > 0
          ? <button type="button" class="sdb-link" onClick={e => { e.stopPropagation(); onOpenDrawerAtRuns(v.id); }}>{count} run{count !== 1 ? 's' : ''}</button>
          : <span class="sdb-muted-txt">—</span>;
      },
    },
    {
      key: 'approvalState', label: 'Approval',
      renderCell: v => {
        // Retired versions are superseded — approval state no longer applies.
        if (v.status === 'retired') return <span class="sdb-muted-txt">—</span>;
        if (v.status === 'draft') return <span class="sdb-cell-sub">Not submitted</span>;
        if (v.status === 'pending_approval') return <StatBadge tone="wn">Awaiting</StatBadge>;
        if (v.approvedBy) return <StatBadge tone="ok">Approved</StatBadge>;
        return <span class="sdb-muted-txt">—</span>;
      },
    },
  ];

  const rowActions = (v: StatutoryVersion): RowActionItem[] => {
    // Segregation of duties (mirrors the backend `assertDifferentApprover`): the creator
    // of a version must not see Approve on their own submission — they'd only hit a 422.
    const isOwnVersion = !!currentUserId && v.createdBy === currentUserId;
    return [
      { key: 'view', label: 'View details', icon: 'file', onClick: () => onOpenDrawer(v.id) },
      ...(canManage && v.status === 'draft' ? [
        { key: 'edit', label: 'Edit rates', icon: 'refresh' as const, onClick: () => onEdit(v) },
        { key: 'submit', label: 'Submit for approval', icon: 'send' as const, onClick: () => run(submitMut.mutateAsync({ id: v.id }), 'Submitted for approval.') },
      ] : []),
      ...(canApprove && v.status === 'pending_approval' ? [
        ...(!isOwnVersion ? [{ key: 'approve', label: 'Approve', icon: 'check' as const, onClick: () => run(approveMut.mutateAsync({ id: v.id }), 'Version approved.') }] : []),
        { key: 'reject', label: 'Reject', icon: 'close' as const, tone: 'danger' as const, onClick: async () => {
          const reason = await dialog.prompt({ title: 'Rejection reason', text: 'Provide a reason for returning this version to draft.', placeholder: 'Rejection reason (required)', confirmText: 'Reject' });
          if (!reason?.trim()) return;
          await run(rejectMut.mutateAsync({ id: v.id, reason }), 'Version returned to draft.');
        } },
      ] : []),
      ...(canApprove && v.status === 'approved' ? [{
        key: 'activate', label: 'Activate', icon: 'check' as const,
        onClick: async () => {
          const ok = await dialog.confirm({ title: `Activate "${v.label}"?`, text: 'This becomes the active statutory configuration and retires the currently-active version. All new payroll runs will use these rates.', confirmText: 'Activate' });
          if (!ok) return;
          await run(activateMut.mutateAsync({ id: v.id }), 'Version activated.');
        },
      }] : []),
      ...(canManage && v.status === 'active' ? [{
        key: 'retire', label: 'Retire', icon: 'close' as const, tone: 'danger' as const,
        onClick: async () => {
          const ok = await dialog.confirm({ title: `Retire "${v.label}"?`, text: 'The active version will be retired and no longer used for new payroll runs. Activate another version to replace it.', danger: true, confirmText: 'Retire' });
          if (!ok) return;
          await run(retireMut.mutateAsync({ id: v.id }), 'Version retired.');
        },
      }] : []),
    ];
  };

  return (
    <DataTable<StatutoryVersion>
      columns={columns}
      rows={pageRows}
      rowKey={v => v.id}
      rowActions={rowActions}
      onRowClick={v => onOpenDrawer(v.id)}
      loading={loading}
      emptyState={{ icon: 'fa-file-invoice-dollar', title: error ? 'Could not load versions' : 'No rate versions', text: error ?? 'Create a rate version to configure PAYE, NIS and Health Surcharge.' }}
      globalSearch={{ value: search, onChange: v => { setSearch(v); setPage(0); }, placeholder: 'Search by label or date…' }}
      filterChips={
        <FilterDropdown id="ver-status" label="Status" openId={openId} setOpenId={setOpenId} labelFn={humanize}
          options={['draft', 'pending_approval', 'approved', 'active', 'retired']}
          selected={status} onChange={v => { setStatus(v); setPage(0); }} />
      }
      advancedFilter={
        <AdvancedFilter openId={openId} setOpenId={setOpenId}
          onReset={() => { setEffFrom(''); setEffTo(''); setRateMin(''); setRateMax(''); setOwner([]); setPage(0); }}
          tabs={[
            { name: 'Version', blurb: 'Filter by effective date and NIS rate.', sections: [
              { type: 'dateRange', title: 'Effective date', from: effFrom, to: effTo, onChange: (f, t) => { setEffFrom(f); setEffTo(t); setPage(0); } },
              { type: 'numberRange', title: 'NIS rate', unit: '%', step: '0.1', min: rateMin, max: rateMax, onChange: (mn, mx) => { setRateMin(mn); setRateMax(mx); setPage(0); } },
            ] },
            { name: 'Owner', blurb: 'Filter by who created the version.', sections: [
              { type: 'checklist', title: 'Owner', options: ownerOptions, selected: owner, onChange: v => { setOwner(v); setPage(0); }, labelFn: id => nameMap?.get(id)?.fullName ?? id },
            ] },
          ]} />
      }
      sort={{ field: sortField, dir: sortDir, onSort: (f, d) => { setSortField(f); setSortDir(d); setPage(0); } }}
      pagination={{ page, pageCount, total: filtered.length, onPage: setPage }}
      noun="versions"
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
  const { openId, setOpenId } = useFilterDropdowns();
  const effectiveId = versionId || (versions[0]?.id ?? '');
  const classesQ   = useNisClasses(effectiveId || null);
  const allClasses = classesQ.data ?? [];
  const selectedVer = versions.find(v => v.id === effectiveId);
  // Mirror the server gates exactly: bands are EDITABLE on draft OR approved
  // (upsertNisClasses), but DELETE + IMPORT are draft-only (deleteNisClass /
  // importNisClasses). Splitting these avoids showing buttons the server will 422.
  const canEdit      = canManage && (selectedVer?.status === 'draft' || selectedVer?.status === 'approved');
  const canDraftOps  = canManage && selectedVer?.status === 'draft';

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

  // NIBTT schedule reference — kept complete (Assumed Avg is the contribution basis,
  // Class Z is the over-pensionable-age rate). Weekly Min/Max merged into one range.
  const tnum = { fontVariantNumeric: 'tabular-nums' as const };
  const columns: DtColumn<NisClass>[] = [
    { key: 'classNo', label: 'Class', isPinned: true, align: 'center', renderCell: c => <b>{toRoman(c.classNo)}</b> },
    {
      key: 'weeklyEarnings', label: 'Weekly Earnings',
      renderCell: c => <span style={tnum}>{fmtMoney(c.weeklyMin)} {c.weeklyMax == null ? <span class="sdb-muted-txt">and over</span> : <>– {fmtMoney(c.weeklyMax)}</>}</span>,
    },
    { key: 'assumedAvg', label: 'Assumed Avg', align: 'right', renderCell: c => c.assumedAverageWeekly == null ? <span class="sdb-muted-txt">—</span> : <span style={tnum}>{fmtMoney(c.assumedAverageWeekly)}</span> },
    { key: 'employeeWeekly', label: 'Employee', align: 'right', renderCell: c => <span style={tnum}>{fmtMoney(c.employeeWeekly)}</span> },
    { key: 'employerWeekly', label: 'Employer', align: 'right', renderCell: c => <span style={tnum}>{fmtMoney(c.employerWeekly)}</span> },
    { key: 'totalWeekly', label: 'Total', align: 'right', renderCell: c => <b style={tnum}>{fmtMoney(c.employeeWeekly + c.employerWeekly)}</b> },
    { key: 'classZ', label: 'Class Z', align: 'right', renderCell: c => c.classZWeekly == null ? <span class="sdb-muted-txt">—</span> : <span class="sdb-muted-txt" style={tnum}>{fmtMoney(c.classZWeekly)}</span> },
  ];

  // Delete is draft-only (server gate) — do NOT offer it on approved versions.
  const rowActions = canDraftOps
    ? (c: NisClass): DtAction<NisClass>[] => [{ key: 'del', label: 'Delete band', icon: 'close', tone: 'danger', onClick: () => handleDelete(c.id, c.classNo) }]
    : undefined;

  const pageCount = Math.max(1, Math.ceil(classes.length / PAGE_SIZE));

  return (
    <>
      <DataTable<NisClass>
        columns={columns}
        rows={classes.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)}
        rowKey={c => c.id}
        rowActions={rowActions}
        onRowClick={c => onEdit(effectiveId, c)}
        loading={classesQ.isLoading}
        emptyState={{ icon: 'fa-layer-group', title: 'No contribution bands', text: versionsError ?? (classesQ.error ? String(classesQ.error) : 'This version has no NIS bands yet.') }}
        globalSearch={{ value: search, onChange: v => { setSearch(v); setPage(0); }, placeholder: 'Search by class # or amount…' }}
        filterChips={
          <div class="tf-wrap">
            <button type="button" class="tf-select" style={{ minWidth: 240 }} aria-haspopup="menu" aria-expanded={openId === 'nis-version'}
              onClick={e => { e.stopPropagation(); setOpenId(openId === 'nis-version' ? null : 'nis-version'); }}>
              <span class="tf-select-text">
                <span class="tf-select-label">Rate Version</span>
                <span class="tf-select-value">{selectedVer ? selectedVer.label : '—'}</span>
              </span>
              {selectedVer && <StatBadge tone={statusTone(selectedVer.status)}>{humanize(selectedVer.status)}</StatBadge>}
            </button>
            {openId === 'nis-version' && (
              <div class="tf-menu" role="menu" aria-label="Rate version" onClick={e => e.stopPropagation()}>
                <div class="tf-menu-head"><strong>Rate Version</strong><span>Select a version to view its bands.</span></div>
                <div class="tf-menu-list">
                  {versions.map(v => (
                    <button key={v.id} type="button" role="menuitemradio" aria-checked={v.id === effectiveId}
                      class={`tf-check ${v.id === effectiveId ? 'active' : ''}`}
                      onClick={() => { setVersionId(v.id); setPage(0); setOpenId(null); }}>
                      <span class="tf-radio" aria-hidden="true" />
                      <span class="tf-check-label">{v.label}</span>
                      <StatBadge tone={statusTone(v.status)}>{humanize(v.status)}</StatBadge>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        }
        toolbarRight={canEdit
          ? <>
              {/* Import CSV is draft-only (server gate); Add Band works on draft + approved. */}
              {canDraftOps && <button type="button" class="sdb-btn" onClick={() => onImport(effectiveId)}>Import CSV</button>}
              <button type="button" class="sdb-btn sdb-btn--pri" onClick={() => onAdd(effectiveId)}>+ Add Band</button>
            </>
          : undefined}
        pagination={{ page, pageCount, total: classes.length, onPage: setPage }}
        noun="bands"
      />
      <p class="sdb-note">
        NIBTT weekly Earnings-Class schedule (contribution rate 16.2% — employee ⅓, employer ⅔). “Assumed Avg” is the earnings figure the contribution is based on. “Class Z” is the reduced weekly rate for workers over pensionable age (employment-injury portion only).
      </p>
    </>
  );
}

// ── Pay Components tab ────────────────────────────────────────────────────────

function PayComponentsTab({ components, loading, error, canManage, canApproveComponents, currentUserId, onEdit }: {
  components: PayComponent[];
  loading: boolean;
  error?: string;
  canManage: boolean;
  canApproveComponents: boolean;
  currentUserId: string | null;
  onEdit: (c: PayComponent) => void;
}): VNode {
  const [search, setSearch] = useState('');
  const [kinds, setKinds] = useState<string[]>([]);        // Category basic filter (multi-select)
  const [statuses, setStatuses] = useState<string[]>(['active']); // Status basic filter
  const [page, setPage] = useState(0);
  const [sortField, setSortField] = useState<string>('code');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const { openId, setOpenId } = useFilterDropdowns();

  // Pending change requests — drives the approval panel below the main table.
  const crsQ = usePayComponentChangeRequests({ status: 'pending_approval' });
  const pendingCRs: PayComponentChangeRequest[] = crsQ.data ?? [];

  const approveMut = useStatutoryMutation(financeStatutoryApi.approveComponentChangeRequest);
  const rejectMut  = useStatutoryMutation(financeStatutoryApi.rejectComponentChangeRequest);

  const handleApprove = async (cr: PayComponentChangeRequest): Promise<void> => {
    const confirmed = await dialog.confirm({ title: 'Approve this change?', text: `Change type: ${humanize(cr.changeType)}. The change will be applied immediately.`, confirmText: 'Approve' });
    if (!confirmed) return;
    try { await approveMut.mutateAsync({ id: cr.id }); toast('Change request approved and applied.'); }
    catch (e) { toast.error((e as Error).message); }
  };

  const handleReject = async (cr: PayComponentChangeRequest): Promise<void> => {
    const reason = await dialog.prompt({ title: 'Reject this change?', text: 'The component will remain unchanged. Provide a reason (optional):', placeholder: 'e.g. GL code is incorrect' });
    if (reason === null) return; // cancelled
    try { await rejectMut.mutateAsync({ id: cr.id, reason: reason || undefined }); toast('Change request rejected.'); }
    catch (e) { toast.error((e as Error).message); }
  };

  const retireMut = useStatutoryMutation(financeStatutoryApi.retireComponent);
  const handleRetire = async (c: PayComponent): Promise<void> => {
    const confirmed = await dialog.confirm({ title: `Submit retire request for "${c.name}" (${c.code})?`, text: 'A retire request will be sent for approval. The component remains active until approved.', danger: true, confirmText: 'Submit retire request' });
    if (!confirmed) return;
    try { await retireMut.mutateAsync({ id: c.id }); toast('Retire request submitted for approval.'); }
    catch (e) { toast.error((e as Error).message); }
  };

  const filtered = useMemo(() => {
    let rows = components;
    if (kinds.length) rows = rows.filter(c => kinds.includes(c.kind));
    if (statuses.length) rows = rows.filter(c => statuses.includes(c.isActive ? 'active' : 'retired'));
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
  }, [components, kinds, statuses, search, sortField, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  // Build a set of component IDs with a pending CR for badge display.
  const pendingCrComponentIds = useMemo(
    () => new Set(pendingCRs.map(cr => cr.componentId).filter((id): id is string => id !== null)),
    [pendingCRs],
  );

  const columns: DtColumn<PayComponent>[] = [
    {
      key: 'name', label: 'Component', isPinned: true, sortAccessor: c => c.name,
      renderCell: c => (
        <div>
          <div class="sdb-vname">
            {c.name}
            {pendingCrComponentIds.has(c.id) && (
              <span style={{ marginLeft: 6, fontSize: 10 }}><StatBadge tone="wn">Pending</StatBadge></span>
            )}
          </div>
          <div class="sdb-cell-sub" style={{ fontFamily: 'monospace' }}>{c.code}</div>
        </div>
      ),
    },
    { key: 'kind', label: 'Category', sortAccessor: c => c.kind, renderCell: c => <StatBadge tone={c.kind === 'earning' ? 'ok' : 'wn'}>{humanize(c.kind)}</StatBadge> },
    { key: 'taxable', label: 'Taxable', align: 'center', renderCell: c => c.isTaxable ? <span class="sdb-ck tax">Taxable</span> : <span class="sdb-muted-txt">—</span> },
    { key: 'statutory', label: 'Statutory', align: 'center', renderCell: c => c.isStatutory ? <span class="sdb-ck stat">Statutory</span> : <span class="sdb-muted-txt">—</span> },
    {
      key: 'calculation', label: 'Calculation', align: 'center',
      renderCell: c => c.kind === 'deduction'
        ? (c.reducesChargeable ? <span class="sdb-ck pre">Pre-tax</span> : <span class="sdb-ck post">Post-tax</span>)
        : <span class="sdb-muted-txt">—</span>,
    },
    { key: 'isActive', label: 'Status', sortAccessor: c => c.isActive ? '1' : '0', renderCell: c => <StatBadge tone={c.isActive ? 'ok' : 'dr'}>{c.isActive ? 'Active' : 'Retired'}</StatBadge> },
  ];

  const rowActions = canManage
    ? (c: PayComponent): DtAction<PayComponent>[] => (c.isActive && !c.isStatutory
        ? [{ key: 'retire', label: 'Submit retire request', icon: 'close', tone: 'danger', onClick: () => void handleRetire(c) }]
        : [])
    : undefined;

  // Pending Changes panel: visible to approvers.
  const crApproveDisabled = approveMut.isPending || rejectMut.isPending;

  return (
    <div>
      <DataTable<PayComponent>
        columns={columns}
        rows={filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)}
        rowKey={c => c.id}
        rowActions={rowActions}
        onRowClick={canManage ? (c => onEdit(c)) : undefined}
        loading={loading}
        emptyState={{ icon: 'fa-money-bill-wave', title: error ? 'Could not load components' : 'No pay components', text: error ?? 'Add earnings and deductions to build the payroll catalogue.' }}
        globalSearch={{ value: search, onChange: v => { setSearch(v); setPage(0); }, placeholder: 'Search by code or name…' }}
        filterChips={
          <>
            <FilterDropdown id="pc-kind" label="Category" openId={openId} setOpenId={setOpenId} labelFn={humanize}
              options={['earning', 'deduction']} selected={kinds} onChange={v => { setKinds(v); setPage(0); }} />
            <FilterDropdown id="pc-status" label="Status" openId={openId} setOpenId={setOpenId} labelFn={humanize}
              options={['active', 'retired']} selected={statuses} onChange={v => { setStatuses(v); setPage(0); }} />
          </>
        }
        sort={{ field: sortField, dir: sortDir, onSort: (f, d) => { setSortField(f); setSortDir(d); setPage(0); } }}
        pagination={{ page, pageCount, total: filtered.length, onPage: setPage }}
        noun="components"
      />

      {/* Pending Changes panel — visible to users with approve permission */}
      {(canApproveComponents || (canManage && pendingCRs.length > 0)) && (
        <div class="sdb-section" style={{ marginTop: 28 }}>
          <div class="sdb-section-head">
            <span class="sdb-section-title">Pending Changes</span>
            {pendingCRs.length > 0 && <StatBadge tone="wn">{pendingCRs.length}</StatBadge>}
          </div>
          {crsQ.isLoading ? (
            <div class="sdb-muted-txt" style={{ padding: '16px 0' }}>Loading…</div>
          ) : pendingCRs.length === 0 ? (
            <div class="sdb-empty-inline"><span class="sdb-muted-txt">No pending change requests.</span></div>
          ) : (
            <table class="vt-table" style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>Change Type</th><th>Component</th><th>Submitted</th><th class="tc">SoD</th><th class="tc">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingCRs.map(cr => {
                  const isOwnCR = !!currentUserId && cr.createdBy === currentUserId;
                  const relatedComponent = components.find(c => c.id === cr.componentId);
                  const label = cr.changeType === 'create'
                    ? `New: ${String(cr.payload.code ?? cr.payload.name ?? '—')}`
                    : relatedComponent ? `${relatedComponent.name} (${relatedComponent.code})` : cr.componentId ?? '—';
                  return (
                    <tr key={cr.id}>
                      <td><StatBadge tone={cr.changeType === 'retire' ? 'dr' : cr.changeType === 'create' ? 'ok' : 'nu'}>{humanize(cr.changeType)}</StatBadge></td>
                      <td>{label}</td>
                      <td class="sdb-muted-txt">{fmtDate(cr.createdAt)}</td>
                      <td class="tc">
                        {isOwnCR
                          ? <span class="sdb-ck warn" title="You submitted this request and cannot approve it (segregation of duties).">Cannot approve own</span>
                          : <span class="sdb-ck ok">Can approve</span>}
                      </td>
                      <td class="tc">
                        {canApproveComponents && !isOwnCR && (
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                            <button type="button" class="sdb-btn sdb-btn--sm sdb-btn--pri" disabled={crApproveDisabled} onClick={() => void handleApprove(cr)}>Approve</button>
                            <button type="button" class="sdb-btn sdb-btn--sm sdb-btn--danger" disabled={crApproveDisabled} onClick={() => void handleReject(cr)}>Reject</button>
                          </div>
                        )}
                        {isOwnCR && <span class="sdb-muted-txt" style={{ fontSize: 11 }}>Awaiting approval</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
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
    () => profiles.map(r => String(r.employeeId ?? r.employee_id ?? '')).filter(Boolean),
    [profiles],
  );
  const { data: nameMap } = useEmployeeNames(employeeIds);

  const verify = async (r: NisProfileRow): Promise<void> => {
    const id = String(r.id ?? '');
    if (!id || !canVerify) return;
    // Compliance sign-off: confirm, and capture an optional verification note for the audit trail.
    const note = await dialog.prompt({
      title: 'Verify NIS profile',
      text: 'Confirm this NIS profile is correct and cleared for payroll. Add an optional note.',
      placeholder: 'Verification note (optional)', confirmText: 'Verify', type: 'textarea',
    });
    if (note === null) return; // cancelled
    try {
      await verifyMut.mutateAsync({ id, verificationNote: note.trim() || null });
      toast('NIS profile verified.');
    } catch (e) { toast.error((e as Error).message); }
  };

  const reject = async (r: NisProfileRow): Promise<void> => {
    const id = String(r.id ?? '');
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

  const columns: DtColumn<NisProfileRow>[] = [
    {
      key: 'employeeId', label: 'Employee', isPinned: true, sortAccessor: r => dv(r, 'employeeId', 'employee_id'),
      renderCell: r => {
        const empId = dv(r, 'employeeId', 'employee_id');
        return empId === '—' ? <span class="sdb-muted-txt">—</span> : <EmployeeCellResolved resolved={nameMap?.get(empId)} fallbackId={empId} />;
      },
    },
    { key: 'nisNumber', label: 'NIS #', sortAccessor: r => dv(r, 'nisNumber', 'nis_number'), renderCell: r => dv(r, 'nisNumber', 'nis_number') },
    {
      key: 'prevEmployer', label: 'Previous Employer', sortAccessor: r => dv(r, 'previousEmployerName', 'previous_employer_name'),
      renderCell: r => { const v = dv(r, 'previousEmployerName', 'previous_employer_name'); return v === '—' ? <span class="sdb-muted-txt">—</span> : v; },
    },
    { key: 'nisStatus', label: 'Status', sortAccessor: r => String(r.nisStatus ?? r.nis_status ?? ''), renderCell: r => <StatBadge tone="wn">{humanize(String(r.nisStatus ?? r.nis_status ?? 'pending_verification'))}</StatBadge> },
    {
      key: 'lastVerified', label: 'Last Verified',
      renderCell: r => { const v = dv(r, 'verifiedAt', 'verified_at'); return v === '—' ? <span class="sdb-muted-txt">Never</span> : <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtDate(v)}</span>; },
    },
    {
      key: 'action', label: 'Action', align: 'right',
      renderCell: r => {
        const id = String(r.id ?? '');
        if (!canVerify || !id) return <span class="sdb-muted-txt">—</span>;
        return (
          <div class="sdb-vactions">
            <button type="button" class="sdb-vbtn ok" onClick={e => { e.stopPropagation(); void verify(r); }}>Verify</button>
            <button type="button" class="sdb-vbtn bad" onClick={e => { e.stopPropagation(); void reject(r); }}>Reject</button>
          </div>
        );
      },
    },
  ];

  const pageCount = Math.max(1, Math.ceil(filteredProfiles.length / PAGE_SIZE));

  return (
    <DataTable<NisProfileRow>
      columns={columns}
      rows={filteredProfiles.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)}
      rowKey={r => String(r.id ?? '')}
      loading={profilesQ.isLoading}
      emptyState={{ icon: 'fa-user-check', title: 'Queue clear', text: profilesQ.error ? String(profilesQ.error) : 'No NIS profiles are awaiting verification.' }}
      globalSearch={{ value: search, onChange: v => { setSearch(v); setPage(0); }, placeholder: 'Search by NIS #, employee or employer…' }}
      sort={{ field: sortField, dir: sortDir, onSort: (f, d) => { setSortField(f); setSortDir(d); setPage(0); } }}
      pagination={{ page, pageCount, total: filteredProfiles.length, onPage: setPage }}
      noun="profiles"
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
    { header: 'Active',      value: r => String(r.isActive ?? '—') },
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
    { header: 'Statutory',        value: r => String(r.isStatutory ?? '—') },
    { header: 'Taxable',          value: r => String(r.isTaxable ?? '—') },
    { header: 'Reduces Charge.',  value: r => String(r.reducesChargeable ?? '—') },
    { header: 'Active',           value: r => String(r.isActive ?? '—') },
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
  const rejectMut   = useStatutoryMutation(financeStatutoryApi.rejectVersion);
  const activateMut = useStatutoryMutation(financeStatutoryApi.activateVersion);
  const retireMut   = useStatutoryMutation(financeStatutoryApi.retireVersion);
  const currentUserId = useSessionStore(selectUserId);

  const run = async (p: Promise<unknown>, ok: string): Promise<void> => {
    try { await p; toast(ok); onClose(); }
    catch (e) { toast.error((e as Error).message); }
  };

  const drawerTitle = d?.label ?? 'Statutory Version';
  const drawerSub   = d ? `${d.jurisdiction} · ${humanize(d.status)} · Effective ${fmtDate(d.effectiveFrom)}` : '';

  const isOwnVersion = !!d && !!currentUserId && d.createdBy === currentUserId;
  const footer = d ? (
    <div style={{ display: 'flex', gap: 8, width: '100%' }}>
      {canManage && d.status === 'draft' && (
        <button class="hrfin-action is-primary" type="button" onClick={() => run(submitMut.mutateAsync({ id: d.id }), 'Submitted for approval.')}>Submit for approval</button>
      )}
      {canApprove && d.status === 'pending_approval' && (
        <>
          {!isOwnVersion && (
            <button class="hrfin-action is-primary" type="button" onClick={() => run(approveMut.mutateAsync({ id: d.id }), 'Version approved.')}>Approve</button>
          )}
          <button class="hrfin-action is-danger" type="button" onClick={async () => {
            const reason = await dialog.prompt({ title: 'Rejection reason', text: 'Provide a reason for returning this version to draft.', placeholder: 'Rejection reason (required)', confirmText: 'Reject' });
            if (!reason?.trim()) return;
            await run(rejectMut.mutateAsync({ id: d.id, reason }), 'Version returned to draft.');
          }}>Reject</button>
        </>
      )}
      {canApprove && d.status === 'approved' && (
        <button class="hrfin-action is-primary" type="button" onClick={async () => {
          const ok = await dialog.confirm({ title: `Activate "${d.label}"?`, text: 'This becomes the active statutory configuration and retires the currently-active version. All new payroll runs will use these rates.', confirmText: 'Activate' });
          if (!ok) return;
          await run(activateMut.mutateAsync({ id: d.id }), 'Version activated.');
        }}>Activate</button>
      )}
      {canManage && d.status === 'active' && (
        <button class="hrfin-action is-danger" type="button" style={{ marginLeft: 'auto' }} onClick={async () => {
          const ok = await dialog.confirm({ title: `Retire "${d.label}"?`, text: 'The active version will be retired and no longer used for new payroll runs. Activate another version to replace it.', danger: true, confirmText: 'Retire' });
          if (!ok) return;
          await run(retireMut.mutateAsync({ id: d.id }), 'Version retired.');
        }}>Retire</button>
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
            onInput={e => setF(p => ({ ...p, label: (e.currentTarget).value }))} />
        </div>

        <fieldset style={{ border: '1px solid var(--hrfin-border, #2a3347)', borderRadius: 6, padding: '12px 14px', margin: 0 }}>
          <legend style={{ fontSize: 12, fontWeight: 500, padding: '0 6px', color: 'var(--muted)' }}>PAYE Bands</legend>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Personal Allowance (annual, TTD)</label>
              <input type="number" style={inputStyle} step="0.01" value={f.payePersonalAllowance}
                onInput={e => setF(p => ({ ...p, payePersonalAllowance: (e.currentTarget).value }))} />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Band 1 Ceiling (annual, TTD)</label>
              <input type="number" style={inputStyle} step="0.01" value={f.payeBand1Ceiling}
                onInput={e => setF(p => ({ ...p, payeBand1Ceiling: (e.currentTarget).value }))} />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Band 1 Rate (0–1, e.g. 0.25 = 25%)</label>
              <input type="number" style={inputStyle} step="0.001" min={0} max={1} value={f.payeBand1Rate}
                onInput={e => setF(p => ({ ...p, payeBand1Rate: (e.currentTarget).value }))} />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Band 2 Rate (0–1)</label>
              <input type="number" style={inputStyle} step="0.001" min={0} max={1} value={f.payeBand2Rate}
                onInput={e => setF(p => ({ ...p, payeBand2Rate: (e.currentTarget).value }))} />
            </div>
          </div>
        </fieldset>

        <fieldset style={{ border: '1px solid var(--hrfin-border, #2a3347)', borderRadius: 6, padding: '12px 14px', margin: 0 }}>
          <legend style={{ fontSize: 12, fontWeight: 500, padding: '0 6px', color: 'var(--muted)' }}>Health Surcharge</legend>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>Monthly Threshold (TTD)</label>
              <input type="number" style={inputStyle} step="0.01" value={f.hsMonthlyThreshold}
                onInput={e => setF(p => ({ ...p, hsMonthlyThreshold: (e.currentTarget).value }))} />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Weekly Rate — High (TTD)</label>
              <input type="number" style={inputStyle} step="0.01" value={f.hsWeeklyHigh}
                onInput={e => setF(p => ({ ...p, hsWeeklyHigh: (e.currentTarget).value }))} />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>Weekly Rate — Low (TTD)</label>
              <input type="number" style={inputStyle} step="0.01" value={f.hsWeeklyLow}
                onInput={e => setF(p => ({ ...p, hsWeeklyLow: (e.currentTarget).value }))} />
            </div>
          </div>
        </fieldset>

        <div style={fieldStyle}>
          <label style={labelStyle}>NIS Monthly Ceiling (TTD, blank = no ceiling)</label>
          <input type="number" style={inputStyle} step="0.01" placeholder="Optional"
            value={f.nisMonthyCeiling}
            onInput={e => setF(p => ({ ...p, nisMonthyCeiling: (e.currentTarget).value }))} />
        </div>

        {fieldErrors.map((e, i) => (
          <p key={i} style={{ fontSize: 12, color: 'var(--danger, #e53)', margin: 0 }}>{e}</p>
        ))}
      </div>
    </HrfinWizardModal>
  );
}
