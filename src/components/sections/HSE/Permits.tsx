/**
 * src/components/sections/HSE/Permits.tsx
 *
 * Permit to Work (PTW) — real-data wired.
 * Mirrors RiskJsa.tsx: PageHeader + stats cards + TabBar + NewMenu + register table + wizard.
 *
 * Tabs: Permits | Approvals | Isolations | Gas Tests | SIMOPS | Templates | Archive
 * Coming-soon tabs (Isolations / Gas Tests / SIMOPS / Templates) render a clean empty state —
 * those sub-registers are deferred to a later phase.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import {
  PageHeader, TabBar, withCounts, NewMenu, Pagination, usePagination,
  type AreaTab,
} from '@ui';
import { hsePill, HSE_SITES } from './types';
import {
  usePermits,
  usePermitStats,
  type PermitListRow,
  type PermitStatus,
} from '@api/hse/ptw';
import { NewPermitWizard } from './ptw/dialogs/NewPermitWizard';
import { PermitDetailDrawer } from './ptw/PermitDetailDrawer';

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS: AreaTab[] = [
  { key: 'permits',   label: 'Permits',     sublabel: 'Active & recent',      icon: 'fa-file-shield' },
  { key: 'approvals', label: 'Approvals',   sublabel: 'Awaiting decision',     icon: 'fa-clipboard-check' },
  { key: 'isolations',label: 'Isolations',  sublabel: 'Lock-out / tag-out',   icon: 'fa-lock' },
  { key: 'gastests',  label: 'Gas Tests',   sublabel: 'Atmospheric readings',  icon: 'fa-flask-vial' },
  { key: 'simops',    label: 'SIMOPS',      sublabel: 'Conflict management',   icon: 'fa-diagram-project' },
  { key: 'templates', label: 'Templates',   sublabel: 'Workflow blueprints',   icon: 'fa-copy' },
  { key: 'archive',   label: 'Archive',     sublabel: 'Closed & cancelled',    icon: 'fa-box-archive' },
];

/** Page-level tabs whose sub-register management lives inside the permit drawer. */
const DRAWER_MANAGED_TABS = ['isolations', 'gastests', 'simops'];
/** Templates tab: truly deferred (no backend endpoint yet). */
const TEMPLATES_TAB = 'templates';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** ISO datetime → short locale display */
function fmtDt(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Map permit status → .vt-pill tone class (reuses hsePill). */
function statusPill(status: PermitStatus): VNode {
  const label = status.replace(/_/g, ' ');
  return <span class={hsePill(status)}>{label}</span>;
}

/** Map risk level → pill */
function riskPill(level: string | null): VNode {
  if (!level) return <span class="hse-muted">—</span>;
  const cls =
    level === 'critical' ? 'vt-pill is-off'
    : level === 'high'   ? 'vt-pill is-warn'
    : level === 'medium' ? 'vt-pill is-amber'
    : 'vt-pill is-on';
  return <span class={cls}>{level.charAt(0).toUpperCase() + level.slice(1)}</span>;
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
                <th style={{ width: '120px' }}>Permit No</th>
                <th style={{ width: '120px' }}>Type</th>
                <th>Title</th>
                <th style={{ width: '140px' }}>Site / Location</th>
                <th style={{ width: '120px' }}>Status</th>
                <th style={{ width: '80px' }}>Risk</th>
                <th style={{ width: '110px' }}>Start</th>
                <th style={{ width: '110px' }}>End</th>
                <th style={{ width: '60px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>Loading permits…</td></tr>
              )}
              {!isLoading && permits.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>No permits match.</td></tr>
              )}
              {pg.pageItems.map((p: PermitListRow) => (
                <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => onOpenPermit(p)}>
                  <td>
                    <span class="vt-cell-mono">{p.permit_number ?? '—'}</span>
                    <div class="vt-cell-subtext">{fmtDt(p.created_at).split(',')[0]}</div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <i class={`fas ${typeIcon(p.permit_type)}`} style={{ color: 'var(--siomac-navy)', opacity: 0.6, fontSize: '0.78rem', flexShrink: 0 }} />
                      <span style={{ fontSize: '0.78rem' }}>{p.permit_type.replace(/_/g, ' ')}</span>
                    </div>
                  </td>
                  <td>
                    <span class="vt-cell-name">{p.title}</span>
                    {p.specific_location && <div class="vt-cell-subtext">{p.specific_location}</div>}
                  </td>
                  <td class="hse-muted" style={{ fontSize: '0.76rem' }}>{p.site_id ?? '—'}</td>
                  <td>{statusPill(p.status)}</td>
                  <td>{riskPill(p.risk_level)}</td>
                  <td class="hse-muted" style={{ fontSize: '0.71rem' }}>{fmtDt(p.start_datetime)}</td>
                  <td class="hse-muted" style={{ fontSize: '0.71rem' }}>{fmtDt(p.end_datetime)}</td>
                  <td>
                    <button
                      class="inc-action-btn blue"
                      style={{ padding: '3px 8px', fontSize: '0.7rem' }}
                      onClick={e => { e.stopPropagation(); onOpenPermit(p); }}
                      title="View permit"
                    >
                      Open
                    </button>
                  </td>
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

// ── Coming-soon empty state ───────────────────────────────────────────────────

function ComingSoonTab({ icon, label, detail }: { icon: string; label: string; detail: string }): VNode {
  return (
    <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
      <i class={`fas ${icon}`} style={{ fontSize: '2.4rem', opacity: 0.25, marginBottom: '16px', display: 'block' }} />
      <div style={{ fontSize: '0.92rem', fontWeight: 600, marginBottom: '6px', color: 'var(--text-body)' }}>{label}</div>
      <div style={{ fontSize: '0.78rem', maxWidth: '380px', margin: '0 auto', lineHeight: 1.6 }}>{detail}</div>
      <div style={{ marginTop: '12px', display: 'inline-block', padding: '4px 12px', borderRadius: '6px', background: 'rgba(27,45,84,.07)', fontSize: '0.72rem', fontWeight: 600, color: 'var(--siomac-navy)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Coming in a later phase
      </div>
    </div>
  );
}

// ── Stats cards strip ─────────────────────────────────────────────────────────

function PtwStatsRow({ onFilterActive, onFilterExpiring, onFilterApprovals }: {
  onFilterActive:    () => void;
  onFilterExpiring:  () => void;
  onFilterApprovals: () => void;
}): VNode {
  const { data, isLoading } = usePermitStats();
  const stats = data?.data;

  const totalActive    = stats?.activePermits.total         ?? 0;
  const highRisk       = stats?.activePermits.highRisk       ?? 0;
  const criticalAreas  = stats?.activePermits.criticalAreas  ?? 0;
  const byType         = stats?.activePermits.byType         ?? [];
  const expiring       = stats?.expiringSoon.total           ?? 0;
  const withinTwo      = stats?.expiringSoon.withinTwoHours  ?? 0;
  const isoPct         = stats?.isolationReadiness.percentage ?? 100;
  const isoVerified    = stats?.isolationReadiness.verified   ?? 0;
  const isoRequired    = stats?.isolationReadiness.required   ?? 0;
  const bottlenecks    = stats?.approvalBottlenecks.total     ?? 0;
  const byStage        = stats?.approvalBottlenecks.byStage   ?? [];

  const loadingStyle = isLoading ? { opacity: 0.45 } : {};

  return (
    <div class="hse-spark-row" style={loadingStyle}>
      {/* Card 1 — Active Permits */}
      <button
        class="hse-spark"
        style={{ cursor: 'pointer', textAlign: 'left', background: 'none', border: '1px solid var(--border)', borderRadius: '10px', padding: '14px 16px' }}
        onClick={onFilterActive}
        title="View active permits"
        type="button"
      >
        <div class="hse-spark-header">
          <span class="hse-spark-label"><i class="fas fa-file-shield" style={{ marginRight: '5px', opacity: 0.6 }} />Active Permits</span>
        </div>
        <div class="hse-spark-val" style={{ color: '#22c55e' }}>{totalActive}</div>
        <div class="hse-spark-sub">
          {highRisk > 0 ? (
            <span style={{ color: '#ef4444' }}>{highRisk} high / {criticalAreas} critical</span>
          ) : 'All within normal risk'}
        </div>
        {byType.length > 0 && (
          <div style={{ marginTop: '8px', display: 'grid', gap: '3px' }}>
            {byType.slice(0, 4).map(bt => {
              const pct = totalActive > 0 ? Math.round((bt.count / totalActive) * 100) : 0;
              return (
                <div key={bt.type} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.67rem', color: 'rgba(255,255,255,.6)' }}>
                  <span style={{ width: '70px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bt.type.replace(/_/g, ' ')}</span>
                  <div style={{ flex: 1, height: '3px', borderRadius: '99px', background: 'rgba(255,255,255,.12)' }}>
                    <div style={{ width: `${pct}%`, height: '100%', borderRadius: '99px', background: '#22c55e' }} />
                  </div>
                  <span style={{ minWidth: '12px', textAlign: 'right' }}>{bt.count}</span>
                </div>
              );
            })}
          </div>
        )}
      </button>

      {/* Card 2 — Expiring Soon */}
      <button
        class="hse-spark"
        style={{ cursor: 'pointer', textAlign: 'left', background: 'none', border: '1px solid var(--border)', borderRadius: '10px', padding: '14px 16px' }}
        onClick={onFilterExpiring}
        title="View expiring permits"
        type="button"
      >
        <div class="hse-spark-header">
          <span class="hse-spark-label"><i class="fas fa-clock" style={{ marginRight: '5px', opacity: 0.6 }} />Expiring Soon</span>
        </div>
        <div class="hse-spark-val" style={{ color: expiring > 0 ? '#f59e0b' : '#22c55e' }}>{expiring}</div>
        <div class="hse-spark-sub">
          {withinTwo > 0 ? <span style={{ color: '#ef4444' }}>{withinTwo} within 2h</span> : 'None critical'}
        </div>
        <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
          {(stats?.expiringSoon.buckets ?? []).map(b => (
            <div key={b.label} style={{ flex: 1, textAlign: 'center', background: 'rgba(255,255,255,.06)', borderRadius: '6px', padding: '5px 0' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: b.label === '<2h' && b.count > 0 ? '#ef4444' : '#f59e0b' }}>{b.count}</div>
              <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,.45)' }}>{b.label}</div>
            </div>
          ))}
        </div>
      </button>

      {/* Card 3 — Isolation Readiness */}
      <div
        class="hse-spark"
        style={{ border: '1px solid var(--border)', borderRadius: '10px', padding: '14px 16px' }}
      >
        <div class="hse-spark-header">
          <span class="hse-spark-label"><i class="fas fa-lock" style={{ marginRight: '5px', opacity: 0.6 }} />Isolation Readiness</span>
        </div>
        <div class="hse-spark-val" style={{ color: isoPct >= 90 ? '#22c55e' : isoPct >= 70 ? '#f59e0b' : '#ef4444' }}>
          {isoPct}%
        </div>
        <div class="hse-spark-sub">{isoVerified} / {isoRequired} points verified</div>
        <div style={{ marginTop: '10px', height: '6px', borderRadius: '99px', background: 'rgba(255,255,255,.12)' }}>
          <div style={{
            width:        `${isoPct}%`,
            height:       '100%',
            borderRadius: '99px',
            background:   isoPct >= 90 ? '#22c55e' : isoPct >= 70 ? '#f59e0b' : '#ef4444',
            transition:   'width .4s',
          }} />
        </div>
      </div>

      {/* Card 4 — Approval Bottlenecks */}
      <button
        class="hse-spark"
        style={{ cursor: 'pointer', textAlign: 'left', background: 'none', border: `1px solid ${bottlenecks > 0 ? 'rgba(245,158,11,.4)' : 'var(--border)'}`, borderRadius: '10px', padding: '14px 16px' }}
        onClick={onFilterApprovals}
        title="View approval queue"
        type="button"
      >
        <div class="hse-spark-header">
          <span class="hse-spark-label"><i class="fas fa-triangle-exclamation" style={{ marginRight: '5px', opacity: 0.6 }} />Approval Bottlenecks</span>
        </div>
        <div class="hse-spark-val" style={{ color: bottlenecks > 0 ? '#f59e0b' : '#22c55e' }}>{bottlenecks}</div>
        <div class="hse-spark-sub">{bottlenecks > 0 ? 'Permits stalled in review' : 'All clear'}</div>
        {byStage.length > 0 && (
          <div style={{ marginTop: '8px', display: 'grid', gap: '3px' }}>
            {byStage.slice(0, 4).map(s => (
              <div key={s.stage} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.67rem', color: 'rgba(255,255,255,.55)' }}>
                <span>{s.stage.replace(/_/g, ' ')}</span>
                <span style={{ fontWeight: 700, color: '#f59e0b' }}>{s.count}</span>
              </div>
            ))}
          </div>
        )}
      </button>
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

// ── Root component ────────────────────────────────────────────────────────────

export function PermitsArea({ tab }: { tab: string }): VNode {
  const [active,         setActive]         = useState(tab);
  const [wizardOpen,     setWizardOpen]     = useState(false);
  const [selectedPermit, setSelectedPermit] = useState<PermitListRow | null>(null);

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

      {/* ── Stats cards ── */}
      <PtwStatsRow
        onFilterActive={() => setActive('permits')}
        onFilterExpiring={() => setActive('permits')}
        onFilterApprovals={() => setActive('approvals')}
      />

      {/* ── Tab bar + New Permit button ── */}
      <div style={{ display: 'flex', alignItems: 'stretch', gap: '12px', marginTop: '20px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <TabBar tabs={tabsWithCounts} active={active} onSelect={setActive} />
        </div>
        <div style={{ flexShrink: 0 }}>
          <NewMenu label="New Permit" fill items={[
            {
              label:    'New Permit to Work',
              icon:     'fa-file-shield',
              sub:      'Request PTW via evidence-gated approval',
              onSelect: () => setWizardOpen(true),
            },
          ]} />
        </div>
      </div>

      {/* ── Tab content ── */}

      {active === 'permits' && (
        <PermitsTab onOpenPermit={p => setSelectedPermit(p)} />
      )}

      {active === 'approvals' && (
        <PermitsTab statusFilter="awaiting_approval" onOpenPermit={p => setSelectedPermit(p)} />
      )}

      {active === 'archive' && (
        <PermitsTab statusFilter="archived" onOpenPermit={p => setSelectedPermit(p)} />
      )}

      {/* Isolations / Gas Tests / SIMOPS: sub-register endpoints are per-permit.
          There is no list-all endpoint, so page-level tabs point users to the drawer. */}
      {DRAWER_MANAGED_TABS.includes(active) && (() => {
        const MAP: Record<string, { icon: string; label: string; detail: string }> = {
          isolations: {
            icon:   'fa-lock',
            label:  'Isolations',
            detail: 'Lock-out / tag-out isolation points are managed per permit. Open a permit from the Permits tab, then switch to the Isolations tab inside the drawer to apply, verify, or remove isolation points.',
          },
          gastests: {
            icon:   'fa-flask-vial',
            label:  'Gas Tests',
            detail: 'Atmospheric readings and gas test results are recorded per permit. Open a permit from the Permits tab, then switch to the Gas Tests tab inside the drawer to log readings and manage results.',
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

      {active === TEMPLATES_TAB && (
        <ComingSoonTab
          icon="fa-copy"
          label="PTW Templates"
          detail="Pre-configured permit templates for common work types. Template management will be added in a later phase."
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
    </div>
  );
}
