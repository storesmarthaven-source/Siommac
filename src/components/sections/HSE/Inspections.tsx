/**
 * src/components/sections/HSE/Inspections.tsx
 *
 * Inspections & Audits area — Schedule + Findings tabs, wired to the live API
 * (hse/inspections/*). Follows the Siomac page standard: PageHeader → StatsCard
 * row → tab bar [TabBar | NewMenu] → compact spark row → register table (left) +
 * navy signals rail (right). Rows open the detail drawers.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import {
  PageHeader, MetricRow, StatsCard, TabBar, NewMenu, withCounts, SidePanel, HseModal,
  Field, SelectInput, TextInput, type AreaTab, type SidePanelSection,
} from '@ui';
import {
  useInspections, useFindings, useInspectionStats, useInspectionTemplates, useCreateInspection,
  useInspectionTransition,
  type InspectionRow, type FindingRow,
} from '@api/hse/inspections';
import { hsePill, HSE_SITES } from './types';
import { InspectionDetailDrawer } from './inspections/InspectionDetailDrawer';
import { FindingDetailDrawer } from './inspections/FindingDetailDrawer';
import { TemplateBuilderDialog } from './inspections/InspectionDialogs';
import { useEmployeeOptions } from './inspections/useEmployeeOptions';

const TABS: AreaTab[] = [
  { key: 'schedule', label: 'Schedule', sublabel: 'Upcoming & overdue', icon: 'fa-calendar-check' },
  { key: 'findings', label: 'Findings', sublabel: 'Non-conformances',   icon: 'fa-magnifying-glass' },
];

const INSP_TYPES = ['housekeeping', 'fire', 'equipment', 'chemical', 'emergency', 'ppe', 'environmental', 'vehicle', 'site_audit'] as const;
const TYPE_ICONS: Record<string, string> = {
  fire: 'fa-fire-extinguisher', equipment: 'fa-wrench', housekeeping: 'fa-broom',
  chemical: 'fa-flask', emergency: 'fa-kit-medical', ppe: 'fa-helmet-safety',
  environmental: 'fa-leaf', vehicle: 'fa-truck', site_audit: 'fa-clipboard-list',
};

const titleCase = (s?: string | null) => (s ?? '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const fmtDate = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' }) : '—';

const SEV_PILL: Record<string, string> = { critical: 'is-critical', high: 'is-warn', medium: 'is-amber', low: 'is-on', observation: 'is-info' };
function severityPill(sev: string): VNode {
  return <span class={`vt-pill ${SEV_PILL[sev] ?? 'is-info'}`}>{sev}</span>;
}
const isOverdue = (i: InspectionRow) => !!i.due_at && new Date(i.due_at).getTime() < Date.now() && !['completed', 'cancelled'].includes(i.status);

// ── Small data-display helpers (real distributions for the StatsCards) ──────────
const PALETTE = ['#60a5fa', '#f59e0b', '#a78bfa', '#34d399', '#fb923c', '#f472b6'];
const SEV_COLOR: Record<string, string> = { critical: '#ef4444', high: '#f59e0b', medium: '#eab308', low: '#22c55e', observation: '#3b82f6' };
const STATUS_COLOR: Record<string, string> = {
  scheduled: '#60a5fa', due_soon: '#f59e0b', overdue: '#ef4444', in_progress: '#3b82f6',
  submitted: '#a78bfa', under_review: '#8b5cf6', completed: '#22c55e', cancelled: '#94a3b8',
  draft: '#94a3b8', rescheduled: '#fb923c', open: '#f59e0b', assigned: '#60a5fa',
  awaiting_review: '#a78bfa', closed: '#22c55e', reopened: '#fb923c',
};
function tally<T>(rows: T[], key: (r: T) => string | null | undefined): Record<string, number> {
  const m: Record<string, number> = {};
  for (const r of rows) { const k = key(r); if (k) m[k] = (m[k] ?? 0) + 1; }
  return m;
}
type Stat = { label: string; value: number; color: string };
function topStatuses(t: Record<string, number>, colorOf: (k: string) => string, n = 4): Stat[] {
  return Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([k, v]) => ({ label: titleCase(k), value: v, color: colorOf(k) }));
}

// ── Right rail ────────────────────────────────────────────────────────────────

function Signal({ icon, tone, title, sub, tag, tagTone, onClick }: {
  icon: string; tone: string; title: string; sub: string; tag: string; tagTone: string; onClick: () => void;
}): VNode {
  return (
    <div class="ppe-signal" onClick={onClick}>
      <i class={`fas ${icon} ${tone}`} />
      <div class="ppe-signal-text"><strong>{title}</strong><span>{sub}</span></div>
      <span class={`ppe-signal-tag ${tagTone}`}>{tag}</span>
    </div>
  );
}

function ScheduleRail({ inspections, onOpen }: { inspections: InspectionRow[]; onOpen: (id: string) => void }): VNode {
  const overdue = inspections.filter(isOverdue);
  const dueSoon = inspections.filter(i => i.due_at && !isOverdue(i) && new Date(i.due_at).getTime() < Date.now() + 7 * 86400e3 && !['completed', 'cancelled'].includes(i.status));
  const inProg  = inspections.filter(i => i.status === 'in_progress');
  const sections: SidePanelSection[] = [
    {
      id: 'overdue', label: 'Overdue', icon: 'fa-clock', title: 'Overdue', count: overdue.length, empty: 'None overdue',
      children: overdue.slice(0, 6).map(i => <Signal key={i.id} icon="fa-clock" tone="is-danger" title={i.inspection_no ?? i.title ?? '—'} sub={i.title ?? ''} tag="Overdue" tagTone="is-high" onClick={() => onOpen(i.id)} />),
    },
    {
      id: 'due', label: 'Due Soon', icon: 'fa-calendar-day', title: 'Due This Week', count: dueSoon.length, empty: 'Nothing due this week',
      children: dueSoon.slice(0, 6).map(i => <Signal key={i.id} icon="fa-calendar-day" tone="is-warn" title={i.inspection_no ?? i.title ?? '—'} sub={fmtDate(i.due_at)} tag="Due" tagTone="is-due" onClick={() => onOpen(i.id)} />),
    },
    {
      id: 'active', label: 'In Progress', icon: 'fa-spinner', title: 'In Progress', count: inProg.length, empty: 'None in progress',
      children: inProg.slice(0, 6).map(i => <Signal key={i.id} icon="fa-spinner" tone="is-info" title={i.inspection_no ?? i.title ?? '—'} sub={i.title ?? ''} tag="Active" tagTone="is-info" onClick={() => onOpen(i.id)} />),
    },
  ];
  return <SidePanel title="Inspection Signals" icon="fa-bell" sections={sections} />;
}

function FindingsRail({ findings, onOpen }: { findings: FindingRow[]; onOpen: (id: string) => void }): VNode {
  const open     = findings.filter(f => !['closed', 'cancelled'].includes(f.status));
  const critical = open.filter(f => f.severity === 'critical');
  const overdueF = open.filter(f => f.due_at && new Date(f.due_at).getTime() < Date.now());
  const sections: SidePanelSection[] = [
    {
      id: 'critical', label: 'Critical', icon: 'fa-triangle-exclamation', title: 'Critical', count: critical.length, empty: 'No critical findings',
      children: critical.slice(0, 6).map(f => <Signal key={f.id} icon="fa-triangle-exclamation" tone="is-danger" title={f.finding_no ?? '—'} sub={f.title ?? ''} tag="Critical" tagTone="is-high" onClick={() => onOpen(f.id)} />),
    },
    {
      id: 'open', label: 'Open', icon: 'fa-circle-exclamation', title: 'Open Findings', count: open.length, empty: 'No open findings',
      children: open.slice(0, 6).map(f => <Signal key={f.id} icon="fa-circle-exclamation" tone="is-warn" title={f.finding_no ?? '—'} sub={f.title ?? ''} tag={titleCase(f.severity)} tagTone="is-due" onClick={() => onOpen(f.id)} />),
    },
    {
      id: 'overdue', label: 'Overdue', icon: 'fa-clock', title: 'Overdue', count: overdueF.length, empty: 'None overdue',
      children: overdueF.slice(0, 6).map(f => <Signal key={f.id} icon="fa-clock" tone="is-danger" title={f.finding_no ?? '—'} sub={fmtDate(f.due_at)} tag="Overdue" tagTone="is-high" onClick={() => onOpen(f.id)} />),
    },
  ];
  return <SidePanel title="Finding Signals" icon="fa-bell" sections={sections} />;
}

// ── Spark row ─────────────────────────────────────────────────────────────────

function Spark({ label, value, sub, color }: { label: string; value: ComponentChildren; sub: string; color?: string }): VNode {
  return (
    <div class="hse-spark">
      <div class="hse-spark-header"><span class="hse-spark-label">{label}</span></div>
      <div class="hse-spark-val" style={color ? { color } : undefined}>{value}</div>
      <div class="hse-spark-sub">{sub}</div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function InspectionsArea({ tab }: { tab: string }): VNode {
  const [active, setActive] = useState(TABS.some(t => t.key === tab) ? tab : 'schedule');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [openInspection, setOpenInspection] = useState<string | null>(null);
  const [openFinding, setOpenFinding] = useState<string | null>(null);
  const rowTransition = useInspectionTransition();

  const { data: statsRes } = useInspectionStats();
  const s = statsRes?.data;
  const { data: inspRes } = useInspections({ limit: 200 });
  const inspections = inspRes?.data ?? [];
  const { data: findRes } = useFindings({ limit: 200 });
  const findings = findRes?.data ?? [];
  const findingCountByInspection = findings.reduce<Record<string, number>>((m, f) => {
    if (f.inspection_id) m[f.inspection_id] = (m[f.inspection_id] ?? 0) + 1;
    return m;
  }, {});

  const overdue = s?.overdue ?? inspections.filter(isOverdue).length;
  const openFindings = s?.openFindings ?? findings.filter(f => !['closed', 'cancelled'].includes(f.status)).length;
  const completionRate = s?.completionRate ?? 0;
  const criticalFindings = s?.criticalFindings ?? 0;

  // Real distributions for the StatsCard bodies
  const openFindingsList = findings.filter(f => !['closed', 'cancelled'].includes(f.status));
  const typeTally = tally(inspections, i => i.inspection_type ?? i.type);
  const typeKeys = Object.keys(typeTally);
  const typeStatuses    = topStatuses(typeTally, k => PALETTE[typeKeys.indexOf(k) % PALETTE.length] ?? '#60a5fa');
  const overdueStatuses = topStatuses(tally(inspections.filter(isOverdue), i => i.inspection_type ?? i.type), () => '#ef4444', 4);
  const sevOrder = ['critical', 'high', 'medium', 'low', 'observation'];
  const sevTally = tally(openFindingsList, f => f.severity);
  const sevStatuses: Stat[] = sevOrder.filter(s => sevTally[s]).map(s => ({ label: titleCase(s), value: sevTally[s] ?? 0, color: SEV_COLOR[s] ?? '#3b82f6' }));
  const completionStatuses = topStatuses(tally(inspections, i => i.status), k => STATUS_COLOR[k] ?? '#94a3b8', 4);
  const criticalByStatus = topStatuses(tally(findings.filter(f => f.severity === 'critical' && !['closed', 'cancelled'].includes(f.status)), f => f.status), k => STATUS_COLOR[k] ?? '#ef4444', 4);

  const tabsWithCounts = withCounts(TABS, { schedule: inspections.length, findings: findings.length });

  return (
    <div class="hse-tab hse-dash" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <PageHeader
        icon="fa-clipboard-check"
        module="HSE"
        title="Inspections & Audits"
        sub="Schedule inspections, execute checklists, and track findings to closure across all sites."
        meta={[
          { icon: 'fa-calendar-check', label: `${inspections.length} inspections` },
          { icon: 'fa-triangle-exclamation', label: `${overdue} overdue` },
          { icon: 'fa-circle-exclamation', label: `${criticalFindings} critical findings` },
          { icon: 'fa-chart-pie', label: `${completionRate}% completion` },
        ]}
      />

      <MetricRow pageKey={`hse.inspections.${active}`} rowClass="ui-stat-row" cards={active === 'findings' ? [
        { key: 'open', node: (
          <StatsCard icon="fa-magnifying-glass" title="Open Findings" metric={openFindings} metricColor={openFindings > 0 ? '#f59e0b' : '#22c55e'}
            supporting="By severity" statuses={sevStatuses} footer="Require corrective action" />
        ) },
        { key: 'critical', node: (
          <StatsCard icon="fa-triangle-exclamation" title="Critical Findings" metric={criticalFindings} metricColor={criticalFindings > 0 ? '#ef4444' : '#22c55e'}
            supporting="By stage" statuses={criticalByStatus.length ? criticalByStatus : [{ label: 'None open', value: 0, color: '#22c55e' }]} footer={criticalFindings > 0 ? 'Action required' : 'None open'} />
        ) },
        { key: 'closed', node: (
          <StatsCard icon="fa-circle-check" title="Closed YTD" metric={s?.closedFindingsYtd ?? 0}
            supporting="Resolution progress"
            statuses={[{ label: 'Closed', value: s?.closedFindingsYtd ?? 0, color: '#22c55e' }, { label: 'Open', value: openFindings, color: '#f59e0b' }]}
            footer="Year to date" />
        ) },
        { key: 'closure', node: (
          <StatsCard icon="fa-chart-pie" title="Closure Rate" metric={`${s?.closureRate ?? 0}%`}
            supporting="Findings closed within SLA" percent={s?.closureRate ?? 0} percentTarget="Target 90%" />
        ) },
      ] : [
        { key: 'scheduled', node: (
          <StatsCard icon="fa-calendar-check" title="Scheduled This Month" metric={s?.scheduledThisMonth ?? 0}
            supporting="By type" statuses={typeStatuses.length ? typeStatuses : [{ label: 'None', value: 0, color: '#94a3b8' }]} footer="Confirmed schedule" />
        ) },
        { key: 'overdue', node: (
          <StatsCard icon="fa-triangle-exclamation" title="Overdue" metric={overdue} metricColor={overdue > 0 ? '#ef4444' : '#22c55e'}
            supporting="By type" statuses={overdueStatuses.length ? overdueStatuses : [{ label: 'On track', value: 0, color: '#22c55e' }]} footer={overdue > 0 ? 'Action required' : 'On track'} />
        ) },
        { key: 'completion', node: (
          <StatsCard icon="fa-chart-pie" title="Completion Rate" metric={`${completionRate}%`}
            supporting="Status mix" statuses={completionStatuses} percent={completionRate} percentTarget="Target 90%" />
        ) },
        { key: 'findings', node: (
          <StatsCard icon="fa-magnifying-glass" title="Open Findings" metric={openFindings} metricColor={openFindings > 0 ? '#f59e0b' : '#22c55e'}
            supporting="By severity" statuses={sevStatuses.length ? sevStatuses : [{ label: 'None open', value: 0, color: '#22c55e' }]} footer="Require corrective action" />
        ) },
      ]} />

      <div style={{ display: 'flex', alignItems: 'stretch', gap: '12px', marginTop: '6px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <TabBar tabs={tabsWithCounts} active={active} onSelect={setActive} />
        </div>
        <div style={{ flexShrink: 0 }}>
          <NewMenu label="Schedule Inspection" fill items={[
            { label: 'Schedule Inspection', icon: 'fa-calendar-plus', sub: 'Create a new inspection or audit', onSelect: () => setDialogOpen(true) },
            { label: 'New Checklist Template', icon: 'fa-list-check', sub: 'Build a reusable inspection checklist', onSelect: () => setTemplateOpen(true) },
          ]} />
        </div>
      </div>

      {/* Compact KPI spark row (under the nav) */}
      {active === 'schedule' ? (
        <div class="hse-spark-row">
          <Spark label="Overdue" value={overdue} sub="Past due, not completed" color={overdue > 0 ? '#ef4444' : '#22c55e'} />
          <Spark label="Due This Week" value={s?.dueThisWeek ?? 0} sub="Action required soon" color="#f59e0b" />
          <Spark label="Scheduled" value={s?.scheduledThisMonth ?? 0} sub="Confirmed this month" />
          <Spark label="Completion Rate" value={`${completionRate}%`} sub="YTD · Target 90%" color="#22c55e" />
        </div>
      ) : (
        <div class="hse-spark-row">
          <Spark label="Open Findings" value={openFindings} sub="Require corrective action" color={openFindings > 0 ? '#f59e0b' : '#22c55e'} />
          <Spark label="Critical" value={criticalFindings} sub="Immediate action" color={criticalFindings > 0 ? '#ef4444' : '#22c55e'} />
          <Spark label="Closed YTD" value={s?.closedFindingsYtd ?? 0} sub="Resolved this year" />
          <Spark label="Closure Rate" value={`${s?.closureRate ?? 0}%`} sub="Findings closed" color="#22c55e" />
        </div>
      )}

      {/* Schedule tab */}
      {active === 'schedule' && (
        <div class="hse-main-grid">
          <div class="hse-left-col">
            <div class="vt-table-card">
              <div class="vt-table-scroll">
                <table class="vt-table">
                  <thead>
                    <tr>
                      <th>Ref</th><th>Inspection</th><th>Type</th><th>Site / Area</th><th>Assignee</th>
                      <th style={{ textAlign: 'center' }}>Due</th><th style={{ textAlign: 'center' }}>Findings</th>
                      <th style={{ textAlign: 'center' }}>Status</th><th style={{ textAlign: 'center' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inspections.map(i => {
                      const fc = findingCountByInspection[i.id] ?? 0;
                      const canStart = ['scheduled', 'due_soon', 'overdue', 'rescheduled'].includes(i.status);
                      return (
                      <tr key={i.id} style={{ cursor: 'pointer' }} onClick={() => setOpenInspection(i.id)}>
                        <td><span class="vt-cell-mono">{i.inspection_no ?? i.ref ?? '—'}</span></td>
                        <td><span class="vt-cell-name" style={{ fontWeight: 500 }}>{i.title ?? '—'}</span></td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                            <i class={`fas ${TYPE_ICONS[i.inspection_type ?? i.type ?? ''] ?? 'fa-clipboard'}`} style={{ fontSize: '0.72rem' }} /> {titleCase(i.inspection_type ?? i.type)}
                          </div>
                        </td>
                        <td class="vt-cell-subtext">{i.site_name ?? i.site_id ?? '—'}{i.area ? ` · ${i.area}` : ''}</td>
                        <td class="vt-cell-subtext">{i.assignee_id ?? '—'}</td>
                        <td style={{ textAlign: 'center', color: isOverdue(i) ? 'var(--siomac-red)' : 'inherit', fontWeight: isOverdue(i) ? 600 : 400 }}>{fmtDate(i.due_at)}</td>
                        <td style={{ textAlign: 'center' }}>{fc > 0 ? <span class="vt-pill is-warn">{fc}</span> : <span class="hse-muted">—</span>}</td>
                        <td style={{ textAlign: 'center' }}><span class={hsePill(i.status)}>{titleCase(i.status)}</span></td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                          <button class="hse-btn" style={{ padding: '4px 10px' }} onClick={() => setOpenInspection(i.id)}>View</button>
                          {canStart && <button class="hse-btn primary" style={{ padding: '4px 10px', marginLeft: '4px' }} disabled={rowTransition.isPending}
                            onClick={() => rowTransition.mutate({ action: 'start', inspectionId: i.id })}>Start</button>}
                        </td>
                      </tr>
                      );
                    })}
                    {inspections.length === 0 && <tr><td colSpan={9} class="hse-muted" style={{ textAlign: 'center', padding: '24px' }}>No inspections scheduled.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div class="hse-right-col">
            <ScheduleRail inspections={inspections} onOpen={setOpenInspection} />
          </div>
        </div>
      )}

      {/* Findings tab */}
      {active === 'findings' && (
        <div class="hse-main-grid">
          <div class="hse-left-col">
            <div class="vt-table-card">
              <div class="vt-table-scroll">
                <table class="vt-table">
                  <thead>
                    <tr>
                      <th>Ref</th><th>Finding</th><th>Site / Area</th><th style={{ textAlign: 'center' }}>Severity</th>
                      <th>Owner</th><th style={{ textAlign: 'center' }}>Due</th><th style={{ textAlign: 'center' }}>Status</th>
                      <th style={{ textAlign: 'center' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {findings.map(f => (
                      <tr key={f.id} style={{ cursor: 'pointer' }} onClick={() => setOpenFinding(f.id)}>
                        <td><span class="vt-cell-mono">{f.finding_no ?? '—'}</span></td>
                        <td><span class="vt-cell-name" style={{ fontWeight: 500 }}>{f.title ?? f.description ?? '—'}</span></td>
                        <td class="vt-cell-subtext">{f.site_name ?? '—'}{f.area ? ` · ${f.area}` : ''}</td>
                        <td style={{ textAlign: 'center' }}>{severityPill(f.severity)}</td>
                        <td class="vt-cell-subtext">{f.owner_id ?? '—'}</td>
                        <td style={{ textAlign: 'center' }}>{fmtDate(f.due_at)}</td>
                        <td style={{ textAlign: 'center' }}><span class={hsePill(f.status)}>{titleCase(f.status)}</span></td>
                        <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                          <button class="hse-btn" style={{ padding: '4px 10px' }} onClick={() => setOpenFinding(f.id)}>View</button>
                        </td>
                      </tr>
                    ))}
                    {findings.length === 0 && <tr><td colSpan={8} class="hse-muted" style={{ textAlign: 'center', padding: '24px' }}>No findings raised.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div class="hse-right-col">
            <FindingsRail findings={findings} onOpen={setOpenFinding} />
          </div>
        </div>
      )}

      <ScheduleInspectionDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
      <TemplateBuilderDialog open={templateOpen} onClose={() => setTemplateOpen(false)} />

      <InspectionDetailDrawer inspectionId={openInspection} onClose={() => setOpenInspection(null)} />
      <FindingDetailDrawer findingId={openFinding} onClose={() => setOpenFinding(null)} />
    </div>
  );
}

// ── Schedule dialog ───────────────────────────────────────────────────────────

function ScheduleInspectionDialog({ open, onClose }: { open: boolean; onClose: () => void }): VNode {
  const create = useCreateInspection();
  const { data: tplRes } = useInspectionTemplates();
  const templates = tplRes?.data ?? [];
  const users = useEmployeeOptions();

  const [title, setTitle] = useState('');
  const [type, setType] = useState<string>(INSP_TYPES[0]);
  const [site, setSite] = useState<string>(HSE_SITES[0] ?? '');
  const [area, setArea] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [due, setDue] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [reviewerId, setReviewerId] = useState('');
  const [asDraft, setAsDraft] = useState(false);

  const reset = () => { setTitle(''); setArea(''); setDue(''); setTemplateId(''); setPriority('medium'); setAssigneeId(''); setReviewerId(''); setAsDraft(false); };

  const submit = () => {
    if (!title.trim() || !due) return;
    create.mutate({
      title: title.trim(),
      inspectionType: type,
      priority,
      siteId: site || null,
      siteName: site || null,
      area: area || null,
      dueAt: new Date(due).toISOString(),
      templateId: templateId || null,
      assigneeId: assigneeId || null,
      reviewerId: reviewerId || null,
      scheduleImmediately: !asDraft,
    }, { onSuccess: () => { reset(); onClose(); } });
  };

  const matchingTemplates = templates.filter(t => t.inspection_type === type);

  return (
    <HseModal
      open={open} onClose={onClose}
      title="Schedule Inspection" sub="Schedule a new inspection or audit for a site or area."
      submitLabel={create.isPending ? 'Saving…' : (asDraft ? 'Save Draft' : 'Schedule')}
      onSubmit={submit}
    >
      <div class="hse-form-grid">
        <Field label="Title / description" wide><TextInput value={title} onInput={setTitle} placeholder="e.g. Monthly housekeeping audit — Bay 3" /></Field>
        <Field label="Inspection type"><SelectInput value={type} onInput={setType} options={INSP_TYPES.map(t => ({ value: t, label: titleCase(t) }))} /></Field>
        <Field label="Priority"><SelectInput value={priority} onInput={v => setPriority(v as 'low' | 'medium' | 'high' | 'critical')} options={['low', 'medium', 'high', 'critical'].map(p => ({ value: p, label: titleCase(p) }))} /></Field>
        <Field label="Site"><SelectInput value={site} onInput={setSite} options={[...HSE_SITES]} /></Field>
        <Field label="Area / location"><TextInput value={area} onInput={setArea} placeholder="e.g. Bay 3" /></Field>
        <Field label="Assignee"><SelectInput value={assigneeId} onInput={setAssigneeId} options={[{ value: '', label: 'Unassigned' }, ...users]} /></Field>
        <Field label="Reviewer"><SelectInput value={reviewerId} onInput={setReviewerId} options={[{ value: '', label: 'None' }, ...users]} /></Field>
        <Field label="Due date">
          <input class="ui-input" type="date" value={due} onInput={e => setDue((e.target as HTMLInputElement).value)} />
        </Field>
        <Field label="Checklist template">
          <SelectInput value={templateId} onInput={setTemplateId}
            options={[{ value: '', label: 'None' }, ...matchingTemplates.map(t => ({ value: t.id, label: t.name }))]} />
        </Field>
        <Field label="" wide>
          <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.8rem' }}>
            <input type="checkbox" checked={asDraft} onInput={e => setAsDraft((e.target as HTMLInputElement).checked)} />
            <span>Save as draft (don't schedule yet)</span>
          </label>
        </Field>
      </div>
    </HseModal>
  );
}
