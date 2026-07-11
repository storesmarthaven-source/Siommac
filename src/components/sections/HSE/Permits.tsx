/**
 * src/components/sections/HSE/Permits.tsx
 *
 * Permit to Work (PTW) — real-data wired.
 * Mirrors RiskJsa.tsx: PageHeader + stats cards + TabBar + NewMenu + register table + wizard.
 *
 * Tabs: Permits | Approvals | Isolations | SIMOPS | Templates | Archive
 * Coming-soon tabs (Isolations / SIMOPS / Templates) render a clean empty state —
 * those sub-registers are deferred to a later phase.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import {
  PageHeader, TabBar, withCounts, NewMenu, Pagination, usePagination,
  type AreaTab,
} from '@ui';
import { HSE_SITES } from './types';
import {
  usePermits,
  usePermitStats,
  usePermitTemplates,
  useDuplicatePermitTemplate,
  useDeactivatePermitTemplate,
  type PermitListRow,
  type PermitStatus,
  type PermitTemplate,
} from '@api/hse/ptw';
import { NewPermitWizard } from './ptw/dialogs/NewPermitWizard';
import { PermitDetailDrawer } from './ptw/PermitDetailDrawer';
import { PermitTemplateDialog } from './ptw/dialogs/PermitTemplateDialog';
import { PtwRightPanel } from './ptw/PtwRightPanel';
import { PtwInsightCards } from './ptw/PtwInsightCards';

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS: AreaTab[] = [
  { key: 'permits',   label: 'Permits',     sublabel: 'Active & recent',      icon: 'fa-file-shield' },
  { key: 'approvals', label: 'Approvals',   sublabel: 'Awaiting decision',     icon: 'fa-clipboard-check' },
  { key: 'isolations',label: 'Isolations',  sublabel: 'Lock-out / tag-out',   icon: 'fa-lock' },
  { key: 'simops',    label: 'SIMOPS',      sublabel: 'Conflict management',   icon: 'fa-diagram-project' },
  { key: 'templates', label: 'Templates',   sublabel: 'Workflow blueprints',   icon: 'fa-copy' },
  { key: 'archive',   label: 'Archive',     sublabel: 'Closed & cancelled',    icon: 'fa-box-archive' },
];

/** Page-level tabs whose sub-register management lives inside the permit drawer. */
const DRAWER_MANAGED_TABS = ['isolations', 'simops'];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** ISO datetime → short locale display */
function fmtDt(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Per-status colour map — each permit status reads as its own colour. */
const STATUS_COLORS: Record<PermitStatus, { bg: string; fg: string }> = {
  draft:               { bg: '#eceff3', fg: '#5b6b7f' },
  submitted:           { bg: '#e3eefb', fg: '#1d5fa5' },
  risk_review:         { bg: '#ece9fb', fg: '#5b4ab7' },
  isolation_pending:   { bg: '#e0f3ef', fg: '#0f6e56' },
  awaiting_approval:   { bg: '#fdf0d9', fg: '#92600b' },
  changes_requested:   { bg: '#fdeadf', fg: '#9a4516' },
  approved:            { bg: '#e6f4dd', fg: '#3b6d11' },
  active:              { bg: '#dcf2e6', fg: '#0f7a48' },
  suspended:           { bg: '#fde7e7', fg: '#a32d2d' },
  extension_requested: { bg: '#f3e8fb', fg: '#7a3ca8' },
  expired:             { bg: '#f7dede', fg: '#7d1d1d' },
  closed:              { bg: '#e6eaf0', fg: '#42536b' },
  cancelled:           { bg: '#ede9e6', fg: '#6b5e54' },
  rejected:            { bg: '#fce8ee', fg: '#9b2d50' },
  archived:            { bg: '#eef0f2', fg: '#76838f' },
};

/** Map permit status → a uniquely-coloured pill (Title Case via .vt-pill). */
function statusPill(status: PermitStatus): VNode {
  const c = STATUS_COLORS[status] ?? { bg: '#eef0f2', fg: '#5b6b7f' };
  return <span class="vt-pill" style={{ background: c.bg, color: c.fg }}>{status.replace(/_/g, ' ')}</span>;
}

/** Per-risk colour map — each level reads as its own tag (incl. medium). */
const RISK_COLORS: Record<string, { bg: string; fg: string }> = {
  low:      { bg: '#e6f4dd', fg: '#3b6d11' },
  medium:   { bg: '#fbf3c0', fg: '#7a6212' },
  high:     { bg: '#fdeadf', fg: '#9a4516' },
  critical: { bg: '#fde7e7', fg: '#a32d2d' },
};

/** Map risk level → a uniquely-coloured pill (Title Case via .vt-pill). */
function riskPill(level: string | null): VNode {
  if (!level) return <span class="hse-muted">—</span>;
  const c = RISK_COLORS[level] ?? { bg: '#eef0f2', fg: '#5b6b7f' };
  return <span class="vt-pill" style={{ background: c.bg, color: c.fg }}>{level}</span>;
}

/** Permit type → icon. Falls back to fa-file-shield. */
const TYPE_ICON: Record<string, string> = {
  confined_space:   'fa-person-shelter',
  hot_work:         'fa-fire',
  work_at_height:   'fa-person-falling',
  electrical:       'fa-bolt',
  excavation:       'fa-helmet-safety',
  lifting:          'fa-arrow-up-from-bracket',
  line_break:       'fa-pipe-section',
  radiation:        'fa-radiation',
  cold_work:        'fa-snowflake',
  general:          'fa-file-shield',
};

function typeIcon(permitType: string): string {
  return TYPE_ICON[permitType] ?? 'fa-file-shield';
}

// ── Permits table tab ─────────────────────────────────────────────────────────

function PermitsTab({ statusFilter, onOpenPermit }: { statusFilter?: string; onOpenPermit: (p: PermitListRow) => void }): VNode {
  const [search,    setSearch]    = useState('');
  const [type,      setType]      = useState('');
  const [site,      setSite]      = useState('');
  const [riskLevel, setRiskLevel] = useState('');

  const { data, isLoading } = usePermits({
    status:     statusFilter ?? undefined,
    permitType: type         || undefined,
    siteId:     site         || undefined,
    riskLevel:  riskLevel    || undefined,
    search:     search       || undefined,
  });

  const permits = data?.data ?? [];

  // Client-side pagination (mirrors RiskJsa)
  const pg = usePagination(permits);

  const sectionTitle = statusFilter === 'awaiting_approval'
    ? 'Approval Queue'
    : statusFilter === 'archived' || statusFilter === 'closed' || statusFilter === 'cancelled'
      ? 'Archive'
      : 'Permit Register';

  const sectionSub = statusFilter === 'awaiting_approval'
    ? 'Permits awaiting area authority or HSE review and sign-off.'
    : statusFilter === 'archived' || statusFilter === 'closed'
      ? 'Closed, cancelled, and archived permits.'
      : 'All active and recent permits-to-work.';

  return (
    <div class="hse-area-main">
      <div class="hse-table-card">
        <div class="hse-table-card-top">
          <div class="vt-section-titlewrap">
            <span class="vt-section-icon"><i class="fas fa-file-shield" /></span>
            <div>
              <div class="vt-section-title">{sectionTitle}</div>
              <div class="vt-section-sub">{sectionSub}</div>
            </div>
          </div>
          <div class="vt-toolbar" style={{ marginBottom: 0, marginTop: '12px' }}>
            {!statusFilter && (
              <div class="vt-search" style={{ flex: '1 1 200px' }}>
                <i class="fas fa-search" />
                <input
                  type="search"
                  placeholder="Search permits…"
                  value={search}
                  onInput={e => setSearch((e.target as HTMLInputElement).value)}
                />
              </div>
            )}
            <select class="emp-filter-select" value={type} onChange={e => setType((e.target as HTMLSelectElement).value)}>
              <option value="">All types</option>
              <option value="confined_space">Confined Space</option>
              <option value="hot_work">Hot Work</option>
              <option value="work_at_height">Work at Height</option>
              <option value="electrical">Electrical (LOTO)</option>
              <option value="excavation">Excavation</option>
              <option value="lifting">Lifting</option>
              <option value="line_break">Line Break</option>
              <option value="radiation">Radiation</option>
              <option value="general">General</option>
            </select>
            <select class="emp-filter-select" value={site} onChange={e => setSite((e.target as HTMLSelectElement).value)}>
              <option value="">All sites</option>
              {HSE_SITES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select class="emp-filter-select" value={riskLevel} onChange={e => setRiskLevel((e.target as HTMLSelectElement).value)}>
              <option value="">All risk levels</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
        </div>

        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead>
              <tr>
                <th style={{ width: '130px' }}>Permit No</th>
                <th>Title</th>
                <th style={{ width: '120px', textAlign: 'center' }}>Status</th>
                <th style={{ width: '120px', textAlign: 'center' }}>Ends</th>
                <th style={{ width: '80px', textAlign: 'center' }}>Risk</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>Loading permits…</td></tr>
              )}
              {!isLoading && permits.length === 0 && (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>No permits match.</td></tr>
              )}
              {pg.pageItems.map((p: PermitListRow) => (
                <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => onOpenPermit(p)}>
                  <td>
                    <span class="vt-cell-mono">{p.permit_number ?? '—'}</span>
                    <div class="vt-cell-subtext">{fmtDt(p.created_at).split(',')[0]}</div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                      <i class={`fas ${typeIcon(p.permit_type)}`} style={{ color: 'var(--siomac-navy)', opacity: 0.55, fontSize: '0.82rem', flexShrink: 0 }} title={p.permit_type.replace(/_/g, ' ')} />
                      <div style={{ minWidth: 0 }}>
                        <span class="vt-cell-name">{p.title}</span>
                        <div class="vt-cell-subtext">
                          {[p.permit_type.replace(/_/g, ' '), p.site_id, p.specific_location].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ textAlign: 'center' }}>{statusPill(p.status)}</td>
                  <td class="hse-muted" style={{ fontSize: '0.74rem' }}>{fmtDt(p.end_datetime)}</td>
                  <td style={{ textAlign: 'center' }}>{riskPill(p.risk_level)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={pg.page} pageCount={pg.pageCount} total={pg.total} pageSize={pg.pageSize} onPage={pg.setPage} noun="permits" />
      </div>
    </div>
  );
}


// ── Drawer-pointer tab ────────────────────────────────────────────────────────

function DrawerPointerTab({ icon, label, detail }: { icon: string; label: string; detail: string }): VNode {
  return (
    <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
      <i class={`fas ${icon}`} style={{ fontSize: '2.4rem', opacity: 0.25, marginBottom: '16px', display: 'block' }} />
      <div style={{ fontSize: '0.92rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-body)' }}>{label}</div>
      <div style={{ fontSize: '0.78rem', maxWidth: '400px', margin: '0 auto', lineHeight: 1.6 }}>{detail}</div>
      <div style={{ marginTop: '12px', display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 14px', borderRadius: '6px', background: 'rgba(27,45,84,.07)', fontSize: '0.75rem', fontWeight: 600, color: 'var(--siomac-navy)' }}>
        <i class="fas fa-arrow-pointer" style={{ opacity: 0.6 }} />
        Open a permit from the Permits tab to manage its records here
      </div>
    </div>
  );
}

// ── Templates tab ─────────────────────────────────────────────────────────────

function TemplatesTab({ onNew, onEdit }: { onNew: () => void; onEdit: (t: PermitTemplate) => void }): VNode {
  const [activeOnly, setActiveOnly] = useState(false);
  const { data, isLoading } = usePermitTemplates(activeOnly ? true : undefined);
  const templates = data?.data ?? [];

  const duplicate   = useDuplicatePermitTemplate();
  const deactivate  = useDeactivatePermitTemplate();

  function riskPillTemplate(level: string | null): VNode {
    return riskPill(level);
  }

  function checkIcon(val: boolean): VNode {
    return val
      ? <i class="fas fa-circle-check" style={{ color: 'var(--color-success)', fontSize: '0.85rem' }} />
      : <i class="fas fa-circle-xmark" style={{ color: 'var(--text-muted)', fontSize: '0.85rem', opacity: 0.4 }} />;
  }

  return (
    <div class="hse-area-main">
      <div class="hse-table-card">
        <div class="hse-table-card-top">
          <div class="vt-section-titlewrap">
            <span class="vt-section-icon"><i class="fas fa-copy" /></span>
            <div>
              <div class="vt-section-title">Permit Templates</div>
              <div class="vt-section-sub">Pre-configured workflow blueprints for common high-risk work types.</div>
            </div>
          </div>
          <div class="vt-toolbar" style={{ marginBottom: 0, marginTop: '12px', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={activeOnly}
                onChange={e => setActiveOnly((e.target as HTMLInputElement).checked)}
                style={{ accentColor: 'var(--siomac-navy)' }}
              />
              Active only
            </label>
            <button class="inc-action-btn blue" style={{ padding: '6px 14px', fontSize: '0.8rem' }} onClick={onNew} type="button">
              <i class="fas fa-plus" style={{ marginRight: '5px' }} />New Template
            </button>
          </div>
        </div>

        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead>
              <tr>
                <th>Template Name</th>
                <th style={{ width: '130px' }}>Permit Type</th>
                <th style={{ width: '90px' }}>Risk Level</th>
                <th style={{ width: '60px', textAlign: 'center' }}>JSA</th>
                <th style={{ width: '80px', textAlign: 'center' }}>Isolation</th>
                <th style={{ width: '70px', textAlign: 'center' }}>Active</th>
                <th style={{ width: '130px' }}>Last Updated</th>
                <th style={{ width: '110px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>Loading templates…</td></tr>
              )}
              {!isLoading && templates.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '48px', color: 'var(--text-muted)' }}>
                    <i class="fas fa-copy" style={{ fontSize: '2rem', opacity: 0.2, marginBottom: '10px', display: 'block' }} />
                    No templates yet. Click <strong>New Template</strong> to create one.
                  </td>
                </tr>
              )}
              {templates.map((t: PermitTemplate) => (
                <tr key={t.id}>
                  <td>
                    <span class="vt-cell-name" style={{ opacity: t.active ? 1 : 0.5 }}>{t.name}</span>
                    {t.description && <div class="vt-cell-subtext" style={{ opacity: t.active ? 1 : 0.5 }}>{t.description}</div>}
                  </td>
                  <td style={{ fontSize: '0.78rem' }}>{t.permit_type.replace(/_/g, ' ')}</td>
                  <td>{riskPillTemplate(t.risk_level)}</td>
                  <td style={{ textAlign: 'center' }}>{checkIcon(t.requires_jsa)}</td>
                  <td style={{ textAlign: 'center' }}>{checkIcon(t.requires_isolation)}</td>
                  <td style={{ textAlign: 'center' }}>
                    {t.active
                      ? <span class="vt-pill is-on" style={{ fontSize: '0.7rem' }}>Active</span>
                      : <span class="vt-pill is-off" style={{ fontSize: '0.7rem' }}>Inactive</span>
                    }
                  </td>
                  <td class="hse-muted" style={{ fontSize: '0.76rem' }}>
                    {t.updated_at
                      ? new Date(t.updated_at).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' })
                      : new Date(t.created_at).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' })
                    }
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button
                        class="inc-action-btn blue"
                        style={{ padding: '3px 8px', fontSize: '0.7rem' }}
                        title="Edit template"
                        onClick={() => onEdit(t)}
                        type="button"
                      >
                        Edit
                      </button>
                      <button
                        class="inc-action-btn"
                        style={{ padding: '3px 8px', fontSize: '0.7rem' }}
                        title="Duplicate template"
                        disabled={duplicate.isPending}
                        onClick={() => void duplicate.mutateAsync({ templateId: t.id })}
                        type="button"
                      >
                        <i class="fas fa-copy" />
                      </button>
                      <button
                        class={`inc-action-btn ${t.active ? '' : 'blue'}`}
                        style={{ padding: '3px 8px', fontSize: '0.7rem' }}
                        title={t.active ? 'Deactivate template' : 'Activate template'}
                        disabled={deactivate.isPending}
                        onClick={() => void deactivate.mutateAsync({ templateId: t.id, active: !t.active })}
                        type="button"
                      >
                        {t.active ? <i class="fas fa-eye-slash" /> : <i class="fas fa-eye" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────

// ── Compact KPI spark row (standard, under the nav — label / val / sub, no icons) ─

function PtwSparkRow(): VNode {
  const stats = usePermitStats().data?.data;
  const all   = usePermits({}).data?.data ?? [];

  const active      = stats?.activePermits.total      ?? 0;
  const highRisk    = stats?.activePermits.highRisk   ?? 0;
  const bottlenecks = stats?.approvalBottlenecks.total ?? 0;
  const awaiting    = all.filter(p => p.status === 'awaiting_approval').length;
  const suspended   = all.filter(p => p.status === 'suspended').length;

  return (
    <div style={{ marginTop: '16px' }}>
      <div class="hse-spark-row">
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Active Permits</span></div>
          <div class="hse-spark-val">{active}</div>
          <div class="hse-spark-sub">Live authorisations on site</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">High Risk</span></div>
          <div class="hse-spark-val" style={{ color: highRisk > 0 ? '#ef4444' : '#22c55e' }}>{highRisk}</div>
          <div class="hse-spark-sub">{highRisk > 0 ? 'Priority oversight' : 'None active'}</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Awaiting Approval</span></div>
          <div class="hse-spark-val" style={{ color: awaiting > 0 ? '#f59e0b' : '#22c55e' }}>{awaiting}</div>
          <div class="hse-spark-sub">{bottlenecks > 0 ? `${bottlenecks} stalled in review` : 'Queue clear'}</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Suspended / Blocked</span></div>
          <div class="hse-spark-val" style={{ color: suspended > 0 ? '#ef4444' : '#22c55e' }}>{suspended}</div>
          <div class="hse-spark-sub">{suspended > 0 ? 'Work stopped' : 'None blocked'}</div>
        </div>
      </div>
    </div>
  );
}

export function PermitsArea({ tab }: { tab: string }): VNode {
  // Fall back to the Permits register for an unknown/stale tab key so the page
  // never renders blank (e.g. the old 'register' default that matched no tab).
  const [active,          setActive]          = useState(TABS.some(t => t.key === tab) ? tab : 'permits');
  const [wizardOpen,      setWizardOpen]      = useState(false);
  const [selectedPermit,  setSelectedPermit]  = useState<PermitListRow | null>(null);
  const [templateDialog,  setTemplateDialog]  = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PermitTemplate | null>(null);

  // Stats for meta chips in PageHeader
  const { data: statsRes } = usePermitStats();
  const stats = statsRes?.data;
  const totalActive   = stats?.activePermits.total    ?? 0;
  const expiringSoon  = stats?.expiringSoon.total      ?? 0;
  const bottlenecks   = stats?.approvalBottlenecks.total ?? 0;

  // Counts for Permits + Approvals tab badges
  const { data: allPermitsRes }  = usePermits({});
  const { data: approvalsRes }   = usePermits({ status: 'awaiting_approval' });
  const totalCount      = allPermitsRes?.data?.length ?? 0;
  const approvalsCount  = approvalsRes?.data?.length  ?? 0;

  const tabsWithCounts = withCounts(TABS, {
    permits:   totalCount,
    approvals: approvalsCount,
  });

  return (
    <div class="hse-tab hse-dash" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <PageHeader
        icon="fa-file-shield"
        module="HSE"
        title="Permit to Work"
        sub="Evidence-gated work authorisation for high-risk tasks — confined space, hot work, electrical, lifting, and more."
        meta={[
          { icon: 'fa-file-shield',           label: `${totalActive} active` },
          { icon: 'fa-clock',                 label: `${expiringSoon} expiring soon` },
          ...(bottlenecks > 0 ? [{ icon: 'fa-triangle-exclamation', label: `${bottlenecks} bottlenecks` }] : []),
          { icon: 'fa-clipboard-check',       label: `${approvalsCount} awaiting approval` },
        ]}
      />

      {/* ── Standard 4 StatsCards (donut · bars · % · trend), rearrangeable ── */}
      <PtwInsightCards />

      {/* ── Tab bar + New Permit button ── */}
      <div style={{ display: 'flex', alignItems: 'stretch', gap: '12px', marginTop: '20px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <TabBar tabs={tabsWithCounts} active={active} onSelect={setActive} />
        </div>
        <div style={{ flexShrink: 0 }}>
          <NewMenu label="New Permit" fill items={[
            {
              label:    'New Permit to Work',
              icon:     'ShieldCheck',
              sub:      'Request PTW via evidence-gated approval',
              onSelect: () => setWizardOpen(true),
            },
          ]} />
        </div>
      </div>

      {/* ── Compact KPI spark row (under the nav) ── */}
      <PtwSparkRow />

      {/* ── Tab content ── */}

      {/* Register tabs: trimmed register (left) + navy signals rail (right) */}
      {(active === 'permits' || active === 'approvals') && (
        <div class="hse-main-grid">
          <div class="hse-left-col">
            {active === 'permits'
              ? <PermitsTab onOpenPermit={setSelectedPermit} />
              : <PermitsTab statusFilter="awaiting_approval" onOpenPermit={setSelectedPermit} />}
          </div>
          <div class="hse-right-col">
            <PtwRightPanel onOpenPermit={setSelectedPermit} />
          </div>
        </div>
      )}

      {active === 'archive' && (
        <PermitsTab statusFilter="archived" onOpenPermit={p => setSelectedPermit(p)} />
      )}

      {/* Isolations / SIMOPS: sub-register endpoints are per-permit.
          There is no list-all endpoint, so page-level tabs point users to the drawer. */}
      {DRAWER_MANAGED_TABS.includes(active) && (() => {
        const MAP: Record<string, { icon: string; label: string; detail: string }> = {
          isolations: {
            icon:   'fa-lock',
            label:  'Isolations',
            detail: 'Lock-out / tag-out isolation points are managed per permit. Open a permit from the Permits tab, then switch to the Isolations tab inside the drawer to apply, verify, or remove isolation points.',
          },
          simops: {
            icon:   'fa-diagram-project',
            label:  'SIMOPS Conflicts',
            detail: 'Simultaneous operations conflict detection is managed per permit. Open a permit from the Permits tab, then switch to the SIMOPS tab inside the drawer to run a check and resolve conflicts.',
          },
        };
        const cfg = MAP[active] ?? { icon: 'fa-clock', label: active, detail: 'Open a permit to manage this sub-register.' };
        return <DrawerPointerTab icon={cfg.icon} label={cfg.label} detail={cfg.detail} />;
      })()}

      {active === 'templates' && (
        <TemplatesTab
          onNew={() => { setEditingTemplate(null); setTemplateDialog(true); }}
          onEdit={t  => { setEditingTemplate(t);   setTemplateDialog(true); }}
        />
      )}

      {/* Permit detail drawer */}
      {selectedPermit && (
        <PermitDetailDrawer
          permit={selectedPermit}
          onClose={() => setSelectedPermit(null)}
        />
      )}

      {/* New Permit wizard */}
      <NewPermitWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />

      {/* Template create/edit dialog */}
      <PermitTemplateDialog
        open={templateDialog}
        onClose={() => { setTemplateDialog(false); setEditingTemplate(null); }}
        template={editingTemplate}
      />
    </div>
  );
}
