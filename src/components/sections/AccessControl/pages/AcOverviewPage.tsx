/**
 * src/components/sections/AccessControl/pages/AcOverviewPage.tsx
 *
 * Access Control — Overview (reproduces rbac-mockups/access-control.html), wired
 * to real data:
 *   • stat cards      → useRoles / useConsoleUsers counts + CRITICAL_GRANT_KEYS + override tally
 *   • coverage matrix → computed from ROLE_PERMISSIONS × PERMISSION_META modules (catalogue,
 *                       orientation-only — role DEFAULTS, not per-user grants)
 *   • high-risk list  → CRITICAL_GRANT_KEYS + how many roles hold each
 *   • recent changes  → useAuditLogs (latest privileged actions)
 *   • access summary  → distribution of the matrix cells (Full / Partial / None)
 */

import { type VNode } from 'preact';
import { useMemo, useState, useCallback, useEffect } from 'preact/hooks';
import { useRoles, useConsoleUsers, useAuditLogs } from '@sections/SuperadminConsole/hooks';
import { PERMISSION_KEYS, ROLE_PERMISSIONS, CRITICAL_GRANT_KEYS, type PermissionKey } from '@lib/permissions';
import { PERMISSION_META } from '@lib/permissionMeta';
import { LucideIcon, type LucideName } from '@ui/LucideIcon';
import { PageHeader } from '@ui';

type RoleKey = keyof typeof ROLE_PERMISSIONS;

// Lucide icon per permission-catalogue module (PERMISSION_META.module). Anything not
// listed falls back to a generic box.
const MODULE_LUCIDE: Record<string, LucideName> = {
  HR: 'Users', Employees: 'Contact', 'Attendance & Leave': 'CalendarCheck', Payroll: 'Banknote',
  Finance: 'Landmark', HSE: 'HardHat', 'Sites & Map': 'Map', Calendar: 'CalendarDays',
  Workflow: 'Workflow', Tickets: 'Ticket', Communications: 'MessageSquare', Auth: 'KeyRound',
  Settings: 'Settings', System: 'Server', 'User Management': 'UserCog', Dashboard: 'LayoutDashboard',
};
const moduleLucide = (m: string): LucideName => MODULE_LUCIDE[m] ?? 'Box';

const MATRIX_ROLES: { key: RoleKey; label: string; icon: LucideName }[] = [
  { key: 'superadmin', label: 'Superadmin', icon: 'Users' },
  { key: 'admin',      label: 'Admin',      icon: 'Droplet' },
  { key: 'manager',    label: 'Manager',    icon: 'ShieldCheck' },
  { key: 'employee',   label: 'Employee',   icon: 'Shield' },
];

const PAGE_SIZE = 10;

type Cov = 'full' | 'partial' | 'none';
function coverage(moduleKeys: PermissionKey[], roleSet: ReadonlySet<PermissionKey> | undefined): Cov {
  if (!roleSet || moduleKeys.length === 0) return 'none';
  const g = moduleKeys.filter(k => roleSet.has(k)).length;
  if (g === moduleKeys.length) return 'full';
  if (g > 0) return 'partial';
  return 'none';
}

const CovCell = ({ c }: { c: Cov }): VNode =>
  c === 'full' ? <span class="acc-dot full"><i class="fas fa-check" /></span>
  : c === 'partial' ? <span class="acc-half" />
  : <span class="acc-dot none"><i class="fas fa-minus" /></span>;

// Segmented semicircle gauge (the Statutory-dashboard style) whose fan runs a smooth
// green→amber→grey gradient — Full · Partial · None fading into one another, weighted by
// the real cell counts. Colour anchors sit at each category's proportional centre so the
// three legend colours blend across the arc.
const GAUGE_N = 13;
interface Hsl { h: number; s: number; l: number }
// Anchors in HSL so the blend is clean: green→yellow→amber (hue 142→38 passes through
// yellow, not olive), then amber desaturates+lightens to a warm grey (hue held near amber
// so it never swings toward blue). Full · Partial · None.
const A_GREEN: Hsl = { h: 142, s: 0.71, l: 0.45 }; // #22c55e — legend green
const A_AMBER: Hsl = { h: 38, s: 0.92, l: 0.50 };  // #f59e0b — legend amber
const A_GREY: Hsl = { h: 40, s: 0.10, l: 0.80 };   // warm light grey (blends cleanly from amber)
const GAUGE_BW = 0.06;                              // fade half-width around each legend boundary
function hslToRgb({ h, s, l }: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; } else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; } else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; } else { r = c; b = x; }
  const m = l - c / 2;
  return `rgb(${Math.round((r + m) * 255)},${Math.round((g + m) * 255)},${Math.round((b + m) * 255)})`;
}
function CoverageGauge({ full, partial, total }: { full: number; partial: number; total: number }): VNode {
  const t = total || 1;
  const a = full / t;
  const b = (full + partial) / t;
  // Bands sized to the legend proportions — green [0,a) · amber [a,b) · grey [b,1] —
  // with a short HSL fade centred on each boundary so they melt into one another.
  const mix = (A: Hsl, B: Hsl, f: number): Hsl => {
    const g = Math.min(1, Math.max(0, f));
    return { h: A.h + (B.h - A.h) * g, s: A.s + (B.s - A.s) * g, l: A.l + (B.l - A.l) * g };
  };
  const colorAt = (p: number): string => {
    if (p < a - GAUGE_BW) return hslToRgb(A_GREEN);
    if (p < a + GAUGE_BW) return hslToRgb(mix(A_GREEN, A_AMBER, (p - (a - GAUGE_BW)) / (2 * GAUGE_BW)));
    if (p < b - GAUGE_BW) return hslToRgb(A_AMBER);
    if (p < b + GAUGE_BW) return hslToRgb(mix(A_AMBER, A_GREY, (p - (b - GAUGE_BW)) / (2 * GAUGE_BW)));
    return hslToRgb(A_GREY);
  };
  const cx = 59, cy = 62, rIn = 31, rOut = 42;
  const segs: VNode[] = [];
  for (let i = 0; i < GAUGE_N; i++) {
    const p = i / (GAUGE_N - 1);
    const rot = -90 + i * (180 / (GAUGE_N - 1));
    segs.push(
      <line key={i} x1={cx} y1={cy - rIn} x2={cx} y2={cy - rOut}
        stroke={colorAt(p)} stroke-width={5.6} stroke-linecap="round"
        transform={`rotate(${rot} ${cx} ${cy})`} />,
    );
  }
  return <div class="asum-gauge"><svg viewBox="0 0 118 78">{segs}</svg></div>;
}

const ACTION_LABEL: Record<string, string> = {
  permission_grant: 'Override applied', permission_deny: 'Override denied', permission_clear: 'Override cleared',
  role_create: 'Role created', role_update: 'Role updated', role_delete: 'Role deleted',
  role_perm_grant: 'Role permission granted', role_perm_revoke: 'Role permission revoked',
  permission_grant_requested: 'Grant requested', permission_grant_approved: 'Grant approved',
  permission_grant_rejected: 'Grant rejected', permission_grant_cancelled: 'Grant cancelled',
  session_revoke: 'Session revoked',
};

// Per-action icon + semantic tone for the Recent Access Changes feed (Option 2 design).
const ACTION_ICON: Record<string, { icon: LucideName; tone: 'green' | 'red' | 'amber' | 'blue' | 'slate' }> = {
  permission_grant:           { icon: 'KeyRound',    tone: 'blue' },
  permission_deny:            { icon: 'Ban',         tone: 'red' },
  permission_clear:           { icon: 'RotateCcw',   tone: 'slate' },
  role_create:                { icon: 'ShieldPlus',  tone: 'green' },
  role_update:                { icon: 'Pencil',      tone: 'amber' },
  role_delete:                { icon: 'Trash2',      tone: 'red' },
  role_perm_grant:            { icon: 'ShieldCheck', tone: 'green' },
  role_perm_revoke:           { icon: 'ShieldX',     tone: 'red' },
  permission_grant_requested: { icon: 'Clock',       tone: 'blue' },
  permission_grant_approved:  { icon: 'CircleCheck', tone: 'green' },
  permission_grant_rejected:  { icon: 'CircleX',     tone: 'red' },
  permission_grant_cancelled: { icon: 'Ban',         tone: 'slate' },
  session_revoke:             { icon: 'LogOut',      tone: 'red' },
};

function ago(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
const initials = (s: string) => (s || '?').split(/[\s._-]+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

const goTo = (id: string) => { try { window.dispatchEvent(new CustomEvent('siomac:section', { detail: id })); } catch (_) { /* ignore */ } };

export function AcOverviewPage(): VNode {
  const rolesQ = useRoles(true);
  const usersQ = useConsoleUsers(true);
  const auditQ = useAuditLogs({ limit: 6 }, true);

  const [activeModule, setActiveModule] = useState<string>('all');
  const [groupsCollapsed, setGroupsCollapsed] = useState(false);
  const [moduleSearch, setModuleSearch] = useState('');
  const [matrixPage, setMatrixPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const [hiddenRoles, setHiddenRoles] = useState<Set<RoleKey>>(new Set());
  const [onlyGaps, setOnlyGaps] = useState(false);
  useEffect(() => { setMatrixPage(1); }, [activeModule, onlyGaps, hiddenRoles]);

  // ── stat tallies ────────────────────────────────────────────────────────────
  const rolesCount = rolesQ.data?.length ?? 0;
  const usersCount = usersQ.data?.length ?? 0;
  const highRisk   = CRITICAL_GRANT_KEYS.size;
  const overrideTotal = useMemo(() => (usersQ.data ?? []).reduce((n, u) => n + (u.overrideCount ?? 0), 0), [usersQ.data]);
  const usersWithOverrides = useMemo(() => (usersQ.data ?? []).filter(u => (u.overrideCount ?? 0) > 0).length, [usersQ.data]);

  // Resolve an audit row's target to a readable label (no raw UUIDs): roles → label,
  // users → name, everything else (permission keys) is already human-readable.
  const roleLabelByName = useMemo(() => new Map((rolesQ.data ?? []).map(r => [r.name, r.label])), [rolesQ.data]);
  const userNameById = useMemo(() => new Map((usersQ.data ?? []).map(u => [u.id, u.fullName || u.username])), [usersQ.data]);
  const resolveTarget = (entity: string, entityId: string): string => {
    if (!entityId) return '';
    const e = (entity || '').toLowerCase();
    if (e.includes('role')) return roleLabelByName.get(entityId) ?? entityId;
    if (e.includes('user')) return userNameById.get(entityId) ?? entityId;
    return entityId;
  };

  // ── module × role coverage matrix (from the catalogue) ────────────────────────
  const { modules, keysByModule } = useMemo(() => {
    const byMod = new Map<string, PermissionKey[]>();
    for (const k of PERMISSION_KEYS) {
      const mod = PERMISSION_META[k]?.module ?? 'Other';
      (byMod.get(mod) ?? byMod.set(mod, []).get(mod)!).push(k);
    }
    return { modules: [...byMod.keys()].sort(), keysByModule: byMod };
  }, []);

  // Module filter: clicking a module focuses the matrix on it. Badge = capability count.
  const capCount = useCallback((mod: string) => keysByModule.get(mod)?.length ?? 0, [keysByModule]);
  const visibleModules = useMemo(
    () => (activeModule === 'all' ? modules : modules.filter(m => m === activeModule)),
    [modules, activeModule],
  );
  // Sidebar list filtered by the search box (matrix filter is unaffected).
  const listModules = useMemo(() => {
    const q = moduleSearch.trim().toLowerCase();
    return q ? modules.filter(m => m.toLowerCase().includes(q)) : modules;
  }, [modules, moduleSearch]);

  // Access Matrix filters — visible role columns + "only gaps" row filter.
  const matrixRoles = useMemo(() => MATRIX_ROLES.filter(r => !hiddenRoles.has(r.key)), [hiddenRoles]);
  const matrixModules = useMemo(() => {
    if (!onlyGaps) return visibleModules;
    return visibleModules.filter(mod =>
      matrixRoles.some(r => coverage(keysByModule.get(mod) ?? [], ROLE_PERMISSIONS[r.key]) !== 'full'));
  }, [visibleModules, onlyGaps, matrixRoles, keysByModule]);
  const activeFilters = hiddenRoles.size + (onlyGaps ? 1 : 0);
  const clearFilters = () => { setHiddenRoles(new Set()); setOnlyGaps(false); };

  // Access Matrix pagination (10 modules/page).
  const matrixPages = Math.max(1, Math.ceil(matrixModules.length / PAGE_SIZE));
  const page = Math.min(matrixPage, matrixPages);
  const pageRows = useMemo(() => matrixModules.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [matrixModules, page]);
  const rangeStart = matrixModules.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, matrixModules.length);

  const summary = useMemo(() => {
    const counts = { full: 0, partial: 0, none: 0 };
    for (const mod of modules) for (const r of MATRIX_ROLES) {
      counts[coverage(keysByModule.get(mod) ?? [], ROLE_PERMISSIONS[r.key])]++;
    }
    const total = counts.full + counts.partial + counts.none || 1;
    return { counts, total, pct: (n: number) => Math.round((n / total) * 100) };
  }, [modules, keysByModule]);

  // ── high-risk capabilities: how many roles hold each critical key ─────────────
  const highRiskList = useMemo(() => {
    const allRoles = Object.keys(ROLE_PERMISSIONS) as RoleKey[];
    return [...CRITICAL_GRANT_KEYS]
      .map(k => ({ key: k, roles: allRoles.filter(r => ROLE_PERMISSIONS[r]?.has(k as PermissionKey)).length }))
      .sort((a, b) => b.roles - a.roles)
      .slice(0, 5);
  }, []);

  // Risk posture derived from how broadly a high-risk capability is held across roles.
  const maxCritRoles = highRiskList[0]?.roles ?? 0;
  const posture = maxCritRoles >= 3 ? { label: 'High', cls: 'high' }
    : maxCritRoles === 2 ? { label: 'Medium', cls: 'med' }
    : { label: 'Low', cls: 'low' };

  // Last access-control activity (proxy for the review cycle) — most recent audit entry.
  const lastReviewedIso = (auditQ.data?.logs?.[0] as { created_at?: string } | undefined)?.created_at;
  const lastReviewed = lastReviewedIso
    ? new Date(lastReviewedIso).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
    : '—';
  const reviewedAgo = lastReviewedIso ? `Reviewed ${ago(lastReviewedIso)}` : 'No recent activity';

  // Export the module-by-role coverage matrix as CSV (real data, no dependency).
  const exportCoverage = (): void => {
    const header = ['Module', ...MATRIX_ROLES.map(r => r.label)];
    const body = modules.map(mod =>
      [mod, ...MATRIX_ROLES.map(r => coverage(keysByModule.get(mod) ?? [], ROLE_PERMISSIONS[r.key]))]);
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = [header, ...body].map(row => row.map(esc).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `access-matrix-coverage-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div class="acx">
      <PageHeader
        icon={<LucideIcon name="ShieldCheck" size={22} />}
        module="Access Control"
        title="Overview"
        sub="Manage roles, users, and capability coverage across the organization."
        actions={<>
          <button type="button" class="acx-hdr-btn" onClick={exportCoverage}>
            <LucideIcon name="Download" size={15} /> Export
          </button>
          <button type="button" class="acx-hdr-btn primary" onClick={() => goTo('s-ac-roles')}>
            <LucideIcon name="Plus" size={16} /> New Role
          </button>
        </>}
      />

      {/* Stats */}
      <div class="kpi-row">
        <div class="kpi">
          <div class="kpi-main">
            <span class="kpi-ico ico-purple"><LucideIcon name="Users" size={20} /></span>
            <div class="kpi-body">
              <div class="kpi-numrow"><span class="kpi-num">{rolesQ.isLoading ? '—' : rolesCount}</span> <span class="kpi-name">Roles</span></div>
              <div class="kpi-sub">System &amp; Custom Roles</div>
            </div>
          </div>
          <button class="kpi-link lk-blue" onClick={() => goTo('s-ac-roles')}>View Roles <LucideIcon name="ArrowRight" size={14} /></button>
        </div>

        <div class="kpi">
          <div class="kpi-main">
            <span class="kpi-ico ico-green"><LucideIcon name="UserRound" size={20} /></span>
            <div class="kpi-body">
              <div class="kpi-numrow"><span class="kpi-num">{usersQ.isLoading ? '—' : usersCount}</span> <span class="kpi-name">Users</span></div>
              <div class="kpi-sub">Configurable-Role Users</div>
            </div>
          </div>
          <button class="kpi-link lk-green" onClick={() => goTo('s-ac-users')}>View Users <LucideIcon name="ArrowRight" size={14} /></button>
        </div>

        <div class="kpi">
          <div class="kpi-main">
            <span class="kpi-ico ico-red"><LucideIcon name="Shield" size={20} /></span>
            <div class="kpi-body">
              <div class="kpi-numrow"><span class="kpi-num">{highRisk}</span> <span class="kpi-name">High-Risk Capabilities</span></div>
              <div class="kpi-sub">Require Approval</div>
            </div>
          </div>
          <button class="kpi-link lk-red" onClick={() => goTo('s-ac-coverage')}>View High-Risk <LucideIcon name="ArrowRight" size={14} /></button>
        </div>

        <div class="kpi">
          <div class="kpi-main">
            <span class="kpi-ico ico-blue"><LucideIcon name="RefreshCw" size={20} /></span>
            <div class="kpi-body">
              <div class="kpi-numrow"><span class="kpi-num">{usersQ.isLoading ? '—' : overrideTotal}</span> <span class="kpi-name">Active Overrides</span></div>
              <div class="kpi-sub">Across {usersWithOverrides} User{usersWithOverrides === 1 ? '' : 's'}</div>
            </div>
          </div>
          <button class="kpi-link lk-blue" onClick={() => goTo('s-ac-users')}>View Overrides <LucideIcon name="ArrowRight" size={14} /></button>
        </div>

        <div class="kpi kpi-rev">
          <div class="kpi-main">
            <span class="kpi-rev-ico"><LucideIcon name="CalendarClock" size={22} /></span>
            <div class="kpi-body">
              <div class="kpi-rev-lbl">Last Reviewed</div>
              <div class="kpi-rev-date">{lastReviewed}</div>
            </div>
          </div>
          <div class="kpi-rev-foot">{reviewedAgo}</div>
        </div>
      </div>

      <div class="ov-grid">

        {/* Left rail — Modules filter + supporting cards */}
        <div class="ov-left">

        {/* Modules — filters the coverage matrix to a single module */}
        <div class="mg-card">
          <div class="mg-head">
            <LucideIcon name="Shapes" size={17} class="mg-item-ico" />
            <span class="mg-head-title">Modules</span>
            <button class="mg-collapse" aria-label={groupsCollapsed ? 'Expand' : 'Collapse'} onClick={() => setGroupsCollapsed(v => !v)}>
              <LucideIcon name={groupsCollapsed ? 'ChevronDown' : 'ChevronUp'} size={16} />
            </button>
          </div>
          {!groupsCollapsed && (
            <>
              <div class="mg-search">
                <LucideIcon name="Search" size={15} />
                <input
                  type="text"
                  placeholder="Search modules"
                  value={moduleSearch}
                  onInput={e => setModuleSearch((e.target as HTMLInputElement).value)}
                />
                {moduleSearch && (
                  <button class="mg-search-clear" aria-label="Clear search" onClick={() => setModuleSearch('')}>
                    <LucideIcon name="X" size={14} />
                  </button>
                )}
              </div>
              <div class="mg-list">
                <button class={`mg-item${activeModule === 'all' ? ' active' : ''}`} onClick={() => setActiveModule('all')}>
                  <LucideIcon name="LayoutGrid" size={17} class="mg-item-ico" />
                  <span class="mg-item-label">All Modules</span>
                  <span class="mg-badge">{modules.length}</span>
                </button>
                {listModules.map(mod => (
                  <button key={mod} class={`mg-item${activeModule === mod ? ' active' : ''}`} onClick={() => setActiveModule(mod)}>
                    <LucideIcon name={moduleLucide(mod)} size={17} class="mg-item-ico" />
                    <span class="mg-item-label">{mod}</span>
                    <span class="mg-badge">{capCount(mod)}</span>
                  </button>
                ))}
                {listModules.length === 0 && <div class="mg-empty">No modules match “{moduleSearch}”.</div>}
              </div>
            </>
          )}
        </div>{/* end mg-card */}

        {/* Recent Access Changes */}
        <div class="card">
          <div class="card-head"><div class="card-title">Recent Access Changes</div><span class="link" onClick={() => goTo('s-ac-audit')}>View all</span></div>
          <div style={{ padding: '2px 16px 8px' }}>
            {auditQ.isLoading ? (
              <div class="ac-loading">Loading…</div>
            ) : (auditQ.data?.logs ?? []).length === 0 ? (
              <div class="ac-empty">No recent access changes.</div>
            ) : (auditQ.data!.logs.slice(0, 5) as { id: string; username: string; action: string; entity: string; entity_id: string; created_at: string }[]).map(l => {
              const meta = ACTION_ICON[l.action] ?? { icon: 'Activity' as LucideName, tone: 'slate' as const };
              const target = resolveTarget(l.entity, l.entity_id);
              return (
                <div class="rc2-item" key={l.id}>
                  <span class={`rc2-ico tone-${meta.tone}`}><LucideIcon name={meta.icon} size={16} /></span>
                  <span class="avatar rc2-av">{initials(l.username)}</span>
                  <div class="rc2-body">
                    <div class="rc2-line"><span class="rc2-nm">{l.username || 'System'}</span><span class="rc2-act"> · {ACTION_LABEL[l.action] ?? l.action}</span></div>
                    {target && <span class="rc2-tgt" title={target}>{target}</span>}
                  </div>
                  <span class="rc2-time">{ago(l.created_at)}</span>
                </div>
              );
            })}
          </div>
        </div>

        </div>{/* end ov-left */}

        {/* Main column — Access Summary above the full-width Access Matrix */}
        <div class="ov-main">

        {/* Access Summary — full-width panel above the matrix */}
        <div class="card asum">
          <div class="asum-intro">
            <div class="asum-titlerow">
              <span class="asum-ico"><LucideIcon name="ChartPie" size={19} /></span>
              <div class="asum-title">Access Summary</div>
            </div>
            <div class="asum-sub">Overall access coverage across all modules and roles, showing how fully each role can act across the platform.</div>
          </div>
          <div class="asum-center">
            <div class="asum-gaugewrap">
              <CoverageGauge full={summary.counts.full} partial={summary.counts.partial} total={summary.total} />
              <div class="asum-gauge-c">
                <div class="asum-num">{summary.total}</div>
                <div class="asum-gauge-lbl">Total Capability Access</div>
              </div>
            </div>
            <div class="asum-legend">
              <div class="asum-lrow"><span class="asum-dot" style={{ background: '#22c55e' }} /><span class="asum-lname">Full Access</span><span class="asum-lval">{summary.counts.full}</span><span class="asum-lpct">({summary.pct(summary.counts.full)}%)</span></div>
              <div class="asum-lrow"><span class="asum-dot" style={{ background: '#f59e0b' }} /><span class="asum-lname">Partial Access</span><span class="asum-lval">{summary.counts.partial}</span><span class="asum-lpct">({summary.pct(summary.counts.partial)}%)</span></div>
              <div class="asum-lrow"><span class="asum-dot" style={{ background: '#e2e6ee' }} /><span class="asum-lname">No Access</span><span class="asum-lval">{summary.counts.none}</span><span class="asum-lpct">({summary.pct(summary.counts.none)}%)</span></div>
            </div>
          </div>
          <div class="asum-risk">
            <div class="rp-head">
              <span class="rp-ico"><LucideIcon name="ShieldAlert" size={18} /></span>
              <div>
                <div class="rp-title">Risk Posture</div>
                <div class="rp-sub">Based on High-Risk Capabilities</div>
              </div>
            </div>
            <div class={`rp-level ${posture.cls}`}><span class="rp-dot" /> {posture.label}</div>
            <div class="rp-note"><b>{highRisk}</b> Capabilit{highRisk === 1 ? 'y Requires' : 'ies Require'} Approval</div>
            <button class="rp-link" onClick={() => goTo('s-ac-coverage')}>Review High-Risk Capabilities <LucideIcon name="ArrowRight" size={15} /></button>
          </div>
        </div>

        {/* Access Matrix — compact module-by-role coverage */}
        <div class="card amx">
          <div class="amx-head">
            <div>
              <div class="amx-titlerow">
                <span class="amx-ico"><LucideIcon name="Grid3x3" size={18} /></span>
                <div class="amx-title">Access Matrix</div>
              </div>
              <div class="amx-sub">Module-by-role capability coverage</div>
            </div>
            <div class="amx-actions">
            <div class="amx-legend">
              <span><span class="acc-dot full" style={{ width: '13px', height: '13px' }} /> Full</span>
              <span><span class="acc-half" style={{ width: '12px', height: '12px' }} /> Partial</span>
              <span><span class="acc-dot none" style={{ width: '13px', height: '13px' }} /> None</span>
            </div>
            <div class="amx-filter-wrap">
              <button class={`amx-btn${activeFilters ? ' on' : ''}`} onClick={() => setShowFilters(v => !v)} aria-expanded={showFilters}>
                <LucideIcon name="ListFilter" size={15} /> Filters{activeFilters ? <span class="amx-fbadge">{activeFilters}</span> : null}
              </button>
              {showFilters && (
                <>
                  <div class="amx-pop-back" onClick={() => setShowFilters(false)} />
                  <div class="amx-pop" role="dialog" aria-label="Matrix filters">
                    <div class="amx-pop-head">
                      <span>Filters</span>
                      {activeFilters > 0 && <button class="amx-pop-clear" onClick={clearFilters}>Clear</button>}
                    </div>
                    <div class="amx-pop-sec">Roles</div>
                    {MATRIX_ROLES.map(r => {
                      const on = !hiddenRoles.has(r.key);
                      return (
                        <label class="amx-pop-row" key={r.key}>
                          <input type="checkbox" checked={on} onChange={() => setHiddenRoles(prev => {
                            const n = new Set(prev);
                            if (n.has(r.key)) n.delete(r.key); else n.add(r.key);
                            // never allow hiding every column
                            if (n.size >= MATRIX_ROLES.length) return prev;
                            return n;
                          })} />
                          <LucideIcon name={r.icon} size={14} /> <span>{r.label}</span>
                        </label>
                      );
                    })}
                    <div class="amx-pop-sec">Coverage</div>
                    <label class="amx-pop-row">
                      <input type="checkbox" checked={onlyGaps} onChange={() => setOnlyGaps(v => !v)} />
                      <LucideIcon name="TriangleAlert" size={14} /> <span>Only show gaps</span>
                    </label>
                  </div>
                </>
              )}
            </div>
            </div>{/* end amx-actions */}
          </div>
          <table class="amx-tbl">
            <thead><tr>
              <th class="amx-mod-h">Module</th>
              {matrixRoles.map(r => (
                <th key={r.key}><span class="amx-rh"><LucideIcon name={r.icon} size={14} /> {r.label}</span></th>
              ))}
            </tr></thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr><td colSpan={matrixRoles.length + 1} class="amx-empty">No modules match the current filters.</td></tr>
              ) : pageRows.map(mod => (
                <tr key={mod}>
                  <td><span class="amx-mod"><LucideIcon name={moduleLucide(mod)} size={16} /> <span>{mod}</span></span></td>
                  {matrixRoles.map(r => <td key={r.key}><CovCell c={coverage(keysByModule.get(mod) ?? [], ROLE_PERMISSIONS[r.key])} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <div class="amx-foot">
            <span class="amx-count">Showing {rangeStart} to {rangeEnd} of {matrixModules.length} module{matrixModules.length === 1 ? '' : 's'}</span>
            {matrixPages > 1 && (
              <div class="amx-pager">
                <button disabled={page === 1} aria-label="Previous" onClick={() => setMatrixPage(p => Math.max(1, p - 1))}><LucideIcon name="ChevronLeft" size={15} /></button>
                <span class="amx-page">{page} / {matrixPages}</span>
                <button disabled={page >= matrixPages} aria-label="Next" onClick={() => setMatrixPage(p => p + 1)}><LucideIcon name="ChevronRight" size={15} /></button>
              </div>
            )}
            <button class="amx-viewall" onClick={() => goTo('s-ac-coverage')}>View all <LucideIcon name="ArrowRight" size={14} /></button>
          </div>
        </div>

        </div>{/* end ov-main */}
      </div>
    </div>
  );
}
