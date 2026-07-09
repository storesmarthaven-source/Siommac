/**
 * src/components/sections/HSE/Incidents.tsx  — Enterprise edition
 *
 * Four in-page tabs:
 *   Register       — KPI sparklines + filterable/searchable incident table + open-work sidebar
 *   Report         — Full multi-section intake form (type, severity, classification, injury
 *                    fields, people involved, witnesses, immediate actions, OSH notification)
 *   Investigations — Table + editable 5-Whys panel + CAPA creation from investigation
 *   CAPA           — Table + priority breakdown + overdue queue + closure verification
 *
 * All data: live via TanStack Query hooks; falls back to rich mock arrays while DB is empty.
 * All mutations: call real backend; optimistic UI via query invalidation.
 */

import { type VNode, type ComponentChildren, cloneElement, toChildArray } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import {
  PageHeader, TabBar, HseModal, HseDrawer, Field,
  TextInput, SelectInput, TextareaInput, useCardReorder, ArrangeControls,
  MetricRow, StatsCard, Sparkline, NewMenu, Pagination, usePagination, DetailGrid, type AreaTab,
} from '@ui';
import {
  hsePill, HSE_SITES,
  type IncidentRecord, type Investigation, type CapaItem, type IncidentType,
} from './types';
import { toneClass } from '@ui/status/statusTokens';
import { exportCsv } from '@ui/lib/exportCsv';
import {
  useHseIncidents, useHseIncidentDetail, useHseInvestigations, useHseCapa,
  useCreateIncident, useUpdateIncident,
  useCreateInvestigation, useUpdateInvestigation,
  useCreateCapa, useUpdateCapa,
  useHseDashboardKpis,
  type HseIncident, type HseInvestigation, type HseCapa,
  type IncidentSeverity, type IncidentType as DbIncidentType,
  type IncidentPersonInput,
} from '@api/hse/incidents';

// ── UI-only form types ────────────────────────────────────────────────────────
//
// OSH classification, people, and witnesses are intake-form concerns. They are
// persisted into hse_incidents.metadata / hse_incident_people on the backend,
// not as first-class incident columns, so they live here as local UI types.

type OshClass =
  | 'first-aid' | 'medical-treatment' | 'restricted-duty' | 'lost-time'
  | 'fatality' | 'property-damage' | 'environmental' | 'near-miss' | 'dangerous-occurrence';

interface PersonInvolved {
  name: string; employeeId?: string; role?: string; contractor?: boolean;
}
interface Witness {
  name: string; employeeId?: string; statement?: string;
}

// ── DB → UI shape adapters ────────────────────────────────────────────────────
//
// The canonical backend stores OSH/injury data as first-class incident columns;
// involved people and witnesses live in hse_incident_people (fetched alongside).

function dbSeverityToUi(s: string): IncidentRecord['severity'] {
  if (s === 'critical') return 'danger';
  if (s === 'high')     return 'warning';
  if (s === 'moderate') return 'info';
  return 'success';
}

function dbTypeToUi(t: string): IncidentType {
  const map: Record<string, IncidentType> = {
    'injury':            'Injury',
    'near_miss':         'Near Miss',
    'environmental':     'Environmental',
    'property_damage':   'Property Damage',
    'unsafe_act':        'Unsafe Act',
    'unsafe_condition':  'Unsafe Condition',
  };
  return map[t] ?? 'Near Miss';
}

function dbStatusToUi(s: string): string {
  const map: Record<string, string> = {
    open:             'Open',
    triage:           'Triage',
    investigation:    'Investigation',
    capa:             'CAPA Raised',
    awaiting_closure: 'In Review',
    closed:           'Closed',
    cancelled:        'Cancelled',
  };
  return map[s] ?? 'Open';
}

function dbToIncidentRecord(i: HseIncident): IncidentRecord {
  return {
    ref:                 i.ref,
    date:                new Date(i.incident_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    type:                dbTypeToUi(i.incident_type),
    severity:            dbSeverityToUi(i.severity),
    site:                i.location_text ?? i.site_id ?? '—',
    status:              dbStatusToUi(i.status),
    reporter:            i.reported_by ?? '—',
    description:         i.description ?? '',
    immediateActions:    i.immediate_action ?? '—',
    lostTime:            i.lost_time,
    oshNotificationDue:  i.osh_notification_due,
    oshNotifiedAt:       i.osh_notified_at,
  };
}

function dbInvStatusToUi(s: string): string {
  const map: Record<string, string> = {
    assigned:            'Open',
    collecting_evidence: 'In Progress',
    root_cause:          'In Progress',
    findings:            'In Review',
    review:              'In Review',
    closed:              'Closed',
    overdue:             'Overdue',
  };
  return map[s] ?? 'Open';
}

function dbToInvestigation(inv: HseInvestigation): Investigation {
  return {
    id:            inv.id,
    ref:           inv.ref,
    incidentRef:   inv.incident_id,
    incidentDesc:  '',
    severity:      'warning',
    method:        inv.root_cause_method === '5why' ? '5-Whys'
                 : inv.root_cause_method === 'fishbone' ? 'Fishbone'
                 : inv.root_cause_method === 'taproot' ? 'TapRooT'
                 : '5-Whys',
    status:        dbInvStatusToUi(inv.status),
    lead:          inv.investigator_user_id ?? '—',
    due:           inv.due_at ? new Date(inv.due_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
    evidenceTotal: 0,
    evidenceDone:  0,
    capaCount:     0,
    rcaCategory:   '',
    stage:         0,
    whys:          inv.findings ? [inv.findings] : [],
    rootCause:     inv.summary ?? '(Not yet recorded)',
    witnesses:     [],
    regulatory:    [],
  };
}

function dbCapaStatusToUi(s: string): string {
  const map: Record<string, string> = {
    open:          'Open',
    in_progress:   'In Progress',
    implemented:   'Pending Evidence',
    verification:  'Pending Evidence',
    returned:      'Returned',
    closed:        'Closed',
    overdue:       'Overdue',
    cancelled:     'Cancelled',
  };
  return map[s] ?? 'Open';
}

function dbToCapa(c: HseCapa): CapaItem {
  const pMap: Record<string, CapaItem['priority']> = {
    critical: 'danger', high: 'warning', medium: 'info', low: 'success',
  };
  return {
    id:       c.id,
    ref:      c.ref,
    title:    c.title,
    source:   c.source_id,
    owner:    c.owner_user_id ?? '—',
    due:      c.due_at ? new Date(c.due_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
    status:   dbCapaStatusToUi(c.status),
    priority: pMap[c.priority] ?? 'info',
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS: AreaTab[] = [
  { key: 'register',       label: 'Register',        sublabel: 'All incidents',   icon: 'fa-list-ul' },
  { key: 'investigations', label: 'Investigations',  sublabel: 'Root cause',      icon: 'fa-magnifying-glass-chart' },
  { key: 'capa',           label: 'CAPA / Actions',  sublabel: 'Corrective plans', icon: 'fa-list-check' },
];

const INCIDENT_TYPES: IncidentType[] = [
  'Injury', 'Near Miss', 'Environmental', 'Property Damage', 'Unsafe Act', 'Unsafe Condition',
];
const SEVERITIES = ['Critical', 'High', 'Moderate', 'Minor'] as const;

const OSH_CLASSES: Array<{ value: OshClass; label: string }> = [
  { value: 'first-aid',            label: 'First Aid Case (FAC)' },
  { value: 'medical-treatment',    label: 'Medical Treatment Case (MTC)' },
  { value: 'restricted-duty',      label: 'Restricted Work Case (RWC)' },
  { value: 'lost-time',            label: 'Lost Time Injury (LTI)' },
  { value: 'fatality',             label: 'Fatality' },
  { value: 'dangerous-occurrence', label: 'Dangerous Occurrence' },
  { value: 'near-miss',            label: 'Near Miss / Close Call' },
  { value: 'property-damage',      label: 'Property Damage' },
  { value: 'environmental',        label: 'Environmental Release' },
];

const BODY_PARTS = [
  'Head / Skull', 'Face', 'Eye(s)', 'Ear(s)', 'Neck', 'Shoulder', 'Upper Arm',
  'Elbow', 'Forearm', 'Wrist', 'Hand', 'Finger(s)', 'Thumb', 'Chest / Thorax',
  'Back (Upper)', 'Back (Lower)', 'Abdomen', 'Hip', 'Thigh', 'Knee',
  'Lower Leg', 'Ankle', 'Foot', 'Toe(s)', 'Multiple Locations', 'Other',
];

const INJURY_TYPES = [
  'Laceration / Cut', 'Bruise / Contusion', 'Fracture', 'Sprain / Strain',
  'Burn / Scald', 'Crush Injury', 'Eye Injury', 'Amputation', 'Dislocation',
  'Puncture / Penetrating Wound', 'Chemical Exposure', 'Electric Shock',
  'Heat Stress / Heat Stroke', 'Hearing Loss / Noise Exposure',
  'Respiratory Exposure / Inhalation', 'Slip / Trip / Fall', 'Other',
];

const SEVERITY_META: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  danger:  { label: 'Critical', icon: 'fa-triangle-exclamation', color: '#ef4444', bg: 'rgba(239,68,68,.15)' },
  warning: { label: 'High',     icon: 'fa-circle-exclamation',   color: '#f59e0b', bg: 'rgba(245,158,11,.15)' },
  info:    { label: 'Medium',   icon: 'fa-circle-info',           color: '#3b82f6', bg: 'rgba(59,130,246,.15)' },
  success: { label: 'Low',      icon: 'fa-circle-check',          color: '#22c55e', bg: 'rgba(34,197,94,.15)' },
};

const TYPE_ICONS: Record<string, string> = {
  'Injury':           'fa-person-falling',
  'Near Miss':        'fa-eye',
  'Environmental':    'fa-droplet',
  'Property Damage':  'fa-building-circle-exclamation',
  'Unsafe Act':       'fa-user-slash',
  'Unsafe Condition': 'fa-triangle-exclamation',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Whole-day count from a "DD Mon YYYY" date string to today; 0 if unparseable. */
function daysOpen(dateStr: string): number {
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.round((Date.now() - t) / 86_400_000));
}

// ── OWQ Panel ─────────────────────────────────────────────────────────────────

type OWQFilter = 'all' | 'critical' | 'capa' | 'overdue';

export function OWQPanel({ incidents, capa, onOpenIncident, onOpenCapa }: {
  incidents: IncidentRecord[];
  capa: CapaItem[];
  onOpenIncident: (i: IncidentRecord) => void;
  onOpenCapa: () => void;
}): VNode {
  const [owqFilter, setOwqFilter] = useState<OWQFilter>('all');

  type OWQItem = {
    key: string;
    icon: string;
    iconClass: string;
    ref: string;
    title: string;
    site: string;
    owner: string;
    due: string;
    status: string;
    priority: 'critical' | 'overdue' | 'normal';
    nextAction: string;
    type: 'incident' | 'capa';
    raw: IncidentRecord | CapaItem;
  };

  const allItems: OWQItem[] = [
    // Critical unassigned incidents
    ...incidents
      .filter(i => i.severity === 'danger' && !/closed/i.test(i.status))
      .map(i => ({
        key: `inc-${i.ref}`,
        icon: 'fa-triangle-exclamation',
        iconClass: 'owq-icon-critical',
        ref: i.ref,
        title: i.type,
        site: i.site,
        owner: i.reporter,
        due: `${daysOpen(i.date)}d open`,
        status: i.status,
        priority: 'critical' as const,
        nextAction: 'Assign owner',
        type: 'incident' as const,
        raw: i,
      })),
    // Investigations missing root cause
    ...incidents
      .filter(i => /investigation/i.test(i.status))
      .map(i => ({
        key: `inv-${i.ref}`,
        icon: 'fa-magnifying-glass',
        iconClass: 'owq-icon-invest',
        ref: i.ref,
        title: 'Investigation pending',
        site: i.site,
        owner: i.reporter,
        due: `${daysOpen(i.date)}d`,
        status: 'Investigating',
        priority: 'normal' as const,
        nextAction: 'Root cause',
        type: 'incident' as const,
        raw: i,
      })),
    // Overdue CAPAs
    ...capa
      .filter(c => /overdue/i.test(c.status))
      .map(c => ({
        key: `capa-od-${c.ref}`,
        icon: 'fa-clock',
        iconClass: 'owq-icon-overdue',
        ref: c.ref,
        title: c.title,
        site: '—',
        owner: c.owner,
        due: `Due ${c.due}`,
        status: 'Overdue',
        priority: 'overdue' as const,
        nextAction: 'Escalate',
        type: 'capa' as const,
        raw: c,
      })),
    // Other open CAPAs (due soon)
    ...capa
      .filter(c => !/closed|verified|overdue/i.test(c.status))
      .slice(0, 4)
      .map(c => ({
        key: `capa-${c.ref}`,
        icon: 'fa-list-check',
        iconClass: 'owq-icon-capa',
        ref: c.ref,
        title: c.title,
        site: '—',
        owner: c.owner,
        due: `Due ${c.due}`,
        status: c.status,
        priority: 'normal' as const,
        nextAction: 'Update',
        type: 'capa' as const,
        raw: c,
      })),
  ];

  const filtered = allItems.filter(item => {
    if (owqFilter === 'critical') return item.priority === 'critical';
    if (owqFilter === 'capa')     return item.type === 'capa';
    if (owqFilter === 'overdue')  return item.priority === 'overdue';
    return true;
  });

  const totalCount    = allItems.length;
  const critCount     = allItems.filter(i => i.priority === 'critical').length;
  const capaCount     = allItems.filter(i => i.type === 'capa').length;
  const overdueCount  = allItems.filter(i => i.priority === 'overdue').length;

  return (
    <div class="owq-panel owq-panel-navy">
      <div class="owq-panel-header">
        <div class="owq-panel-title">
          <i class="fas fa-bell" />
          <span>Open Work Queue</span>
          <span class="owq-panel-count">{totalCount}</span>
        </div>
        <div class="owq-panel-tabs">
          {([
            { key: 'all',      label: 'All',      count: totalCount },
            { key: 'critical', label: 'Critical', count: critCount },
            { key: 'capa',     label: 'CAPA',     count: capaCount },
            { key: 'overdue',  label: 'Overdue',  count: overdueCount },
          ] as { key: OWQFilter; label: string; count: number }[]).map(t => (
            <button
              key={t.key}
              class={`owq-tab ${owqFilter === t.key ? 'active' : ''}`}
              onClick={() => setOwqFilter(t.key)}
            >
              {t.label}
              {t.count > 0 && <span class="owq-tab-count">{t.count}</span>}
            </button>
          ))}
        </div>
      </div>
      <div class="owq-panel-list">
        {filtered.length === 0 ? (
          <div class="owq-panel-empty">
            <i class="fas fa-circle-check" />
            <span>No items in this view</span>
          </div>
        ) : filtered.map(item => (
          <div
            key={item.key}
            class={`owq-item owq-item-${item.priority}`}
            onClick={() => item.type === 'incident' ? onOpenIncident(item.raw as IncidentRecord) : onOpenCapa()}
          >
            <span class={`owq-item-icon ${item.iconClass}`}>
              <i class={`fas ${item.icon}`} />
            </span>
            <div class="owq-item-body">
              <div class="owq-item-ref">{item.ref} <span class="owq-item-title">{item.title}</span></div>
              <div class="owq-item-meta">
                <span><i class="fas fa-location-dot" />{item.site}</span>
                <span><i class="fas fa-user" />{item.owner}</span>
                <span><i class="fas fa-clock" />{item.due}</span>
              </div>
            </div>
            <div class="owq-item-right">
              <span class="owq-item-action">{item.nextAction}</span>
              <i class="fas fa-chevron-right owq-item-chevron" />
            </div>
          </div>
        ))}
      </div>
      <button class="owq-panel-footer" onClick={onOpenCapa}>
        Open CAPA Register <i class="fas fa-arrow-right" />
      </button>
    </div>
  );
}

// ── Investigation Pipeline ────────────────────────────────────────────────────

function InvestigationPipeline({ incidents, investigations }: {
  incidents: IncidentRecord[];
  investigations: Investigation[];
}): VNode {
  const stages = [
    { key: 'Reported',     icon: 'fa-file-circle-plus',    count: incidents.filter(i => i.status === 'Open').length },
    { key: 'Assigned',     icon: 'fa-user-check',          count: incidents.filter(i => /assigned/i.test(i.status)).length },
    { key: 'Investigation',icon: 'fa-magnifying-glass',    count: incidents.filter(i => /investigation/i.test(i.status)).length },
    { key: 'Root Cause',   icon: 'fa-diagram-project',     count: investigations.filter(i => !i.rootCause).length },
    { key: 'CAPA Raised',  icon: 'fa-list-check',          count: incidents.filter(i => /capa/i.test(i.status)).length },
    { key: 'Verification', icon: 'fa-clipboard-check',     count: incidents.filter(i => /verif/i.test(i.status)).length },
    { key: 'Closed',       icon: 'fa-circle-check',        count: incidents.filter(i => /closed/i.test(i.status)).length },
  ];
  return (
    <div class="inc-pipeline">
      {stages.map((s, idx) => (
        <div key={s.key} class={`inc-pipeline-stage${s.count > 0 ? ' has-items' : ''}`}>
          <div class="inc-pipeline-icon"><i class={`fas ${s.icon}`} /></div>
          <div class="inc-pipeline-count">{s.count}</div>
          <div class="inc-pipeline-label">{s.key}</div>
          {idx < stages.length - 1 && <div class="inc-pipeline-arrow"><i class="fas fa-chevron-right" /></div>}
        </div>
      ))}
    </div>
  );
}

// ── CAPA Summary Strip (horizontal, shown above incident register) ─────────────

/**
 * Wraps the four bespoke control-strip cards in the standard rearrange behaviour
 * (drag to reorder, persisted via ui_layout). Drag handlers are cloned onto each
 * `.inc-mini-card` directly so the `.capa-strip-four-cards` grid layout is kept.
 */
function ReorderStrip({ pageKey, keys, children }: {
  pageKey: string; keys: string[]; children: ComponentChildren;
}): VNode {
  const kids = toChildArray(children) as VNode[];
  const r = useCardReorder(pageKey, keys);
  const byKey = new Map<string, VNode>();
  keys.forEach((k, i) => { const node = kids[i]; if (node) byKey.set(k, node); });
  const order = r.enabled ? r.order : keys;
  return (
    <div>
      {r.enabled && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-2)' }}>
          <ArrangeControls reorder={r} variant="light" />
        </div>
      )}
      <div class="capa-strip-four-cards">
        {order.map(k => {
          const node = byKey.get(k);
          if (!node) return null;
          return cloneElement(node, {
            key: k,
            ...r.dragHandlers(k),
            style: r.arranging
              ? { cursor: 'grab', outline: '1px dashed var(--border)', borderRadius: '14px', opacity: r.dragKey === k ? 0.4 : 1 }
              : undefined,
          });
        })}
      </div>
    </div>
  );
}

function IncidentControlStrip({ incidents, investigations, capa, closurePct, avgDaysToClose, pageTab }: {
  incidents: IncidentRecord[];
  investigations: Investigation[];
  capa: CapaItem[];
  closurePct: number;
  avgDaysToClose: number;
  pageTab: string;
}): VNode {
  const now           = new Date();
  const startOfMonth  = new Date(now.getFullYear(), now.getMonth(), 1);
  const mtdIncidents  = incidents.filter(i => i.date && new Date(i.date) >= startOfMonth);

  const activeInvest = incidents.filter(i => /investigation/i.test(i.status)).length;
  const needsTriage  = incidents.filter(i => /open/i.test(i.status)).length;
  const linkedCapas  = capa.filter(c => !/closed|verified/i.test(c.status)).length;
  const pendingEv    = capa.filter(c => /pending|evidence/i.test(c.status)).length;
  const emaNotifs    = incidents.filter(i => i.type === 'Environmental' && !/closed/i.test(i.status));
  const oshRequired  = incidents.filter(i => i.oshNotificationDue && !i.oshNotifiedAt && !/closed/i.test(i.status));
  const ltiCount     = incidents.filter(i => i.lostTime === true).length;
  const overdueActs  = capa.filter(c => /overdue/i.test(c.status)).length;
  const priority     = emaNotifs[0] ?? oshRequired[0] ?? null;

  const sevCounts = {
    danger:  mtdIncidents.filter(i => i.severity === 'danger').length,
    warning: mtdIncidents.filter(i => i.severity === 'warning').length,
    info:    mtdIncidents.filter(i => i.severity === 'info').length,
    success: mtdIncidents.filter(i => i.severity === 'success').length,
  };
  const total = mtdIncidents.length || 1;
  const SEV_COLORS  = { danger: '#ef4444', warning: '#f59e0b', info: '#60a5fa', success: '#4ade80' };
  const SEV_FADED   = { danger: 'rgba(239,68,68,.15)', warning: 'rgba(245,158,11,.15)', info: 'rgba(96,165,250,.15)', success: 'rgba(74,222,128,.15)' };
  const cx = 44, cy = 44, r = 34, circ = 2 * Math.PI * r;
  let offset = 0;
  const slices = (['danger','warning','info','success'] as const).map(k => {
    const pct = sevCounts[k] / total;
    const len = pct * circ;
    const rot = offset;
    offset += pct * 360;
    return { k, len, dash: `${len} ${circ - len}`, rot, color: SEV_COLORS[k], faded: SEV_FADED[k] };
  }).filter(s => s.len > 0);

  // ── Investigation tab KPI derivations ──
  const invOpen    = investigations.filter(i => /open/i.test(i.status)).length;
  const invReview  = investigations.filter(i => /review/i.test(i.status)).length;
  const invCrit    = investigations.filter(i => i.severity === 'danger').length;
  const evTotal    = investigations.reduce((s, i) => s + i.evidenceTotal, 0);
  const evDone     = investigations.reduce((s, i) => s + i.evidenceDone,  0);
  const evPending  = evTotal - evDone;
  const evPct      = evTotal > 0 ? Math.round((evDone / evTotal) * 100) : 0;
  const rcaFound   = investigations.filter(i => i.rootCause && i.rootCause !== '(Not yet recorded)').length;
  const rcaPct     = Math.round((rcaFound / Math.max(investigations.length, 1)) * 100);
  const invRefs    = new Set(investigations.map(i => i.incidentRef));
  const invCapa    = capa.filter(c => invRefs.has(c.source));
  const capaOvd    = invCapa.filter(c => /overdue/i.test(c.status)).length;
  const capaOpn    = invCapa.filter(c => /open/i.test(c.status)).length;
  const capaOther  = invCapa.length - capaOvd - capaOpn;

  if (pageTab === 'capa') {
    const openActs     = capa.filter(c => !/closed|verified/i.test(c.status));
    const overdueActs2 = capa.filter(c => /overdue/i.test(c.status));
    const pendingEvActs= capa.filter(c => /pending|evidence/i.test(c.status));
    const critActs     = capa.filter(c => c.priority === 'danger');
    const firstOverdue = overdueActs2[0];
    const firstPendEv  = pendingEvActs[0];
    return (
      <ReorderStrip pageKey={`hse.incidents.${pageTab}`} keys={['open', 'overdue', 'verification', 'ownership']}>

        {/* CAPA Card 1 — Open Actions */}
        <div class="inc-mini-card">
          <div class="inc-mini-card-header">
            <i class="fas fa-list-check" />
            <span>Open Actions</span>
          </div>
          <div class="inc-mini-card-body" style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
            <div style={{ display:'flex', alignItems:'baseline', gap:'8px' }}>
              <span style={{ fontSize:'2.4rem', fontWeight: 600, color:'var(--siomac-navy)', lineHeight:1, letterSpacing:'-0.03em' }}>{openActs.length}</span>
              <span style={{ fontSize:'0.65rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.05em' }}>open</span>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'5px' }}>
              {([
                { val: critActs.length, label: 'Critical', color: '#ef4444' },
                { val: capa.filter(c => c.priority==='warning' && !/closed|verified/i.test(c.status)).length, label: 'High', color: '#f59e0b' },
                { val: capa.filter(c => c.priority==='info'    && !/closed|verified/i.test(c.status)).length, label: 'Medium', color: '#60a5fa' },
              ] as const).map(d => d.val > 0 && (
                <div key={d.label} style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'0.72rem' }}>
                  <span style={{ width:'7px', height:'7px', borderRadius:'50%', background:d.color, flexShrink:0 }} />
                  <span style={{ color:'var(--text-muted)' }}>{d.val} {d.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* CAPA Card 2 — Overdue */}
        <div class="inc-mini-card">
          <div class="inc-mini-card-header">
            <i class="fas fa-clock" style={{ color:'#ef4444' }} />
            <span>Overdue</span>
          </div>
          <div class="inc-mini-card-body" style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
            <div style={{ display:'flex', alignItems:'baseline', gap:'8px' }}>
              <span style={{ fontSize:'2.4rem', fontWeight: 600, color: overdueActs2.length > 0 ? '#ef4444' : '#16a34a', lineHeight:1, letterSpacing:'-0.03em' }}>{overdueActs2.length}</span>
              <span style={{ fontSize:'0.65rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.05em' }}>{overdueActs2.length === 1 ? 'action' : 'actions'}</span>
            </div>
            {firstOverdue ? (
              <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:'8px', padding:'8px 10px' }}>
                <div style={{ fontSize:'0.72rem', fontWeight: 'var(--font-weight-bold)', color:'#dc2626' }}>{firstOverdue.ref}</div>
                <div style={{ fontSize:'0.65rem', color:'#ef4444', marginTop:'2px' }}>Due {firstOverdue.due}</div>
              </div>
            ) : (
              <div style={{ fontSize:'0.72rem', color:'var(--text-muted)' }}>No overdue actions</div>
            )}
          </div>
        </div>

        {/* CAPA Card 3 — Verification Queue */}
        <div class="inc-mini-card inc-mini-card-navy">
          <div class="inc-mini-card-header inc-mini-card-header-navy">
            <i class="fas fa-clipboard-check" />
            <span>Verification Queue</span>
          </div>
          <div class="inc-mini-card-body" style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
            {(() => {
              const ready   = capa.filter(c => /ready|complete/i.test(c.status) && !/closed|verified/i.test(c.status));
              const pending = capa.filter(c => /pending|evidence/i.test(c.status));
              const missing = capa.filter(c => !/closed|verified|pending|evidence|ready|complete/i.test(c.status) && !/closed|verified/i.test(c.status));
              if (ready.length === 0 && pending.length === 0)
                return <div style={{ fontSize:'0.72rem', color:'rgba(255,255,255,.45)' }}>No items in queue</div>;
              return (
                <>
                  {([
                    { count: ready.length,   label: 'Ready to verify', color: '#4ade80' },
                    { count: pending.length, label: 'Pending evidence', color: '#fbbf24' },
                    { count: missing.length, label: 'Evidence missing', color: '#ef4444' },
                  ] as const).map(r => r.count > 0 && (
                    <div key={r.label} style={{ display:'flex', alignItems:'center', gap:'8px', fontSize:'0.72rem' }}>
                      <span style={{ width:'7px', height:'7px', borderRadius:'50%', background:r.color, flexShrink:0 }} />
                      <span style={{ color:'rgba(255,255,255,.7)', flex:1 }}>{r.label}</span>
                      <span style={{ color:r.color, fontWeight: 'var(--font-weight-bold)' }}>{r.count}</span>
                    </div>
                  ))}
                  {ready[0] && (
                    <div style={{ background:'rgba(74,222,128,.1)', border:'1px solid rgba(74,222,128,.2)', borderRadius:'8px', padding:'7px 10px', marginTop:'2px' }}>
                      <div style={{ fontSize:'0.72rem', fontWeight: 'var(--font-weight-bold)', color:'#4ade80' }}>{ready[0].ref}</div>
                      <div style={{ fontSize:'0.65rem', color:'rgba(255,255,255,.5)', marginTop:'2px' }}>Ready · {ready[0].owner}</div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>

        {/* CAPA Card 4 — Ownership */}
        <div class="inc-mini-card inc-mini-card-navy">
          <div class="inc-mini-card-header inc-mini-card-header-navy">
            <i class="fas fa-users" />
            <span>Ownership</span>
          </div>
          <div class="inc-mini-card-body" style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
            {(() => {
              const ownerMap = new Map<string, { open: number; overdue: number }>();
              capa.filter(c => !/closed|verified/i.test(c.status)).forEach(c => {
                const e = ownerMap.get(c.owner) ?? { open: 0, overdue: 0 };
                e.open++;
                if (/overdue/i.test(c.status)) e.overdue++;
                ownerMap.set(c.owner, e);
              });
              if (ownerMap.size === 0)
                return <div style={{ fontSize:'0.72rem', color:'rgba(255,255,255,.45)' }}>No open actions</div>;
              return [...ownerMap.entries()].slice(0, 4).map(([owner, s]) => (
                <div key={owner} style={{ display:'flex', alignItems:'center', gap:'7px', fontSize:'0.7rem' }}>
                  <div style={{ width:'20px', height:'20px', borderRadius:'50%', background:'rgba(255,255,255,.12)', display:'grid', placeItems:'center', fontSize:'0.55rem', fontWeight: 'var(--font-weight-bold)', color:'rgba(255,255,255,.7)', flexShrink:0 }}>
                    {owner.split(' ').map((n: string) => n[0]).join('').slice(0,2)}
                  </div>
                  <span style={{ flex:1, color:'rgba(255,255,255,.7)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{owner.split(' ')[0]}</span>
                  <span style={{ color: s.overdue > 0 ? '#ef4444' : 'rgba(255,255,255,.45)', fontWeight: s.overdue > 0 ? 700 : 400, flexShrink:0 }}>
                    {s.open}{s.overdue > 0 ? ` (${s.overdue}od)` : ''}
                  </span>
                </div>
              ));
            })()}
          </div>
        </div>

      </ReorderStrip>
    );
  }

  if (pageTab === 'investigations') {
    return (
      <ReorderStrip pageKey={`hse.incidents.${pageTab}`} keys={['active', 'evidence', 'rootcause', 'capa']}>

        {/* Inv Card 1 — Open Investigations (white) */}
        <div class="inc-mini-card">
          <div class="inc-mini-card-header">
            <i class="fas fa-magnifying-glass-chart" />
            <span>Open Investigations</span>
          </div>
          <div class="inc-mini-card-body" style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
            <div style={{ display:'flex', alignItems:'baseline', gap:'8px' }}>
              <span style={{ fontSize:'2.4rem', fontWeight: 600, color:'var(--siomac-navy)', lineHeight:1, letterSpacing:'-0.03em' }}>{invOpen + invReview}</span>
              <span style={{ fontSize:'0.65rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.05em' }}>active</span>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'5px' }}>
              {invCrit > 0 && (
                <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'0.72rem' }}>
                  <span style={{ width:'7px', height:'7px', borderRadius:'50%', background:'#ef4444', flexShrink:0 }} />
                  <span style={{ color:'var(--text-muted)' }}>{invCrit} Critical</span>
                </div>
              )}
              <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'0.72rem' }}>
                <span style={{ width:'7px', height:'7px', borderRadius:'50%', background:'#f59e0b', flexShrink:0 }} />
                <span style={{ color:'var(--text-muted)' }}>{invOpen} Open</span>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'0.72rem' }}>
                <span style={{ width:'7px', height:'7px', borderRadius:'50%', background:'#60a5fa', flexShrink:0 }} />
                <span style={{ color:'var(--text-muted)' }}>{invReview} In Review</span>
              </div>
            </div>
          </div>
        </div>

        {/* Inv Card 2 — Evidence Pending (white) */}
        <div class="inc-mini-card">
          <div class="inc-mini-card-header">
            <i class="fas fa-folder-open" />
            <span>Evidence Pending</span>
          </div>
          <div class="inc-mini-card-body" style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
            <div style={{ display:'flex', alignItems:'baseline', gap:'8px' }}>
              <span style={{ fontSize:'2.4rem', fontWeight: 600, color: evPending > 0 ? '#d97706' : '#16a34a', lineHeight:1, letterSpacing:'-0.03em' }}>{evPending}</span>
              <span style={{ fontSize:'0.65rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'.05em' }}>pending</span>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:'0.67rem', color:'var(--text-muted)', marginBottom:'2px' }}>
                <span>Evidence collected</span><span style={{ fontWeight:600, color:'var(--text-primary)' }}>{evPct}%</span>
              </div>
              <div style={{ height:'6px', borderRadius:'99px', background:'var(--border)', overflow:'hidden' }}>
                <div style={{ width:`${evPct}%`, height:'100%', background: evPct===100 ? '#16a34a' : '#3b82f6', borderRadius:'99px', transition:'width .3s' }} />
              </div>
              <div style={{ display:'flex', gap:'10px', fontSize:'0.67rem', color:'var(--text-muted)', marginTop:'2px' }}>
                <span><span style={{ color:'#16a34a', fontWeight: 'var(--font-weight-bold)' }}>{evDone}</span> collected</span>
                <span><span style={{ color:'#d97706', fontWeight: 'var(--font-weight-bold)' }}>{evPending}</span> pending</span>
              </div>
            </div>
          </div>
        </div>

        {/* Inv Card 3 — Root Cause Complete (navy) */}
        <div class="inc-mini-card inc-mini-card-navy">
          <div class="inc-mini-card-header inc-mini-card-header-navy">
            <i class="fas fa-bullseye" />
            <span>Root Cause Complete</span>
          </div>
          <div class="inc-mini-card-body" style={{ display:'flex', alignItems:'center', gap:'16px' }}>
            <div style={{ position:'relative', flexShrink:0 }}>
              <svg width="84" height="84" viewBox="0 0 84 84">
                <circle cx="42" cy="42" r="34" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="7" />
                <circle cx="42" cy="42" r="34" fill="none"
                  stroke={rcaPct === 100 ? '#4ade80' : '#60a5fa'} stroke-width="7"
                  stroke-dasharray={`${(rcaPct / 100) * 213.6} 213.6`}
                  stroke-linecap="round"
                  transform="rotate(-90 42 42)" />
              </svg>
              <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:'1px' }}>
                <span style={{ fontSize:'1.3rem', fontWeight: 600, color: rcaPct===100 ? '#4ade80' : '#fff', lineHeight:1 }}>{rcaPct}%</span>
              </div>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
              <div style={{ fontSize:'0.7rem', color:'rgba(255,255,255,.55)' }}>{rcaFound} of {investigations.length} confirmed</div>
              <div style={{ display:'flex', alignItems:'center', gap:'4px', fontSize:'0.67rem', color:'rgba(255,255,255,.35)' }}>
                <i class="fas fa-bullseye" style={{ fontSize:'0.6rem' }} /> Target 100%
              </div>
              {rcaPct < 100 && (
                <div style={{ fontSize:'0.67rem', color:'#f59e0b', fontWeight:600 }}>{investigations.length - rcaFound} pending</div>
              )}
              {rcaPct === 100 && (
                <div style={{ fontSize:'0.67rem', color:'#4ade80', fontWeight:600 }}><i class="fas fa-circle-check" style={{ marginRight:'4px' }} />All confirmed</div>
              )}
            </div>
          </div>
        </div>

        {/* Inv Card 4 — CAPA Raised (navy) */}
        <div class="inc-mini-card inc-mini-card-navy">
          <div class="inc-mini-card-header inc-mini-card-header-navy">
            <i class="fas fa-list-check" />
            <span>CAPA Raised</span>
          </div>
          <div class="inc-mini-card-body" style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
            <div style={{ display:'flex', alignItems:'baseline', gap:'8px' }}>
              <span style={{ fontSize:'2.4rem', fontWeight: 600, color:'#fff', lineHeight:1, letterSpacing:'-0.03em' }}>{invCapa.length}</span>
              <span style={{ fontSize:'0.65rem', color:'rgba(255,255,255,.45)', textTransform:'uppercase', letterSpacing:'.05em' }}>actions</span>
            </div>
            {invCapa.length > 0 && (
              <>
                <div style={{ display:'flex', height:'7px', borderRadius:'4px', overflow:'hidden', gap:'2px' }}>
                  {capaOvd   > 0 && <div style={{ flex:capaOvd,   background:'#ef4444' }} />}
                  {capaOpn   > 0 && <div style={{ flex:capaOpn,   background:'#f59e0b' }} />}
                  {capaOther > 0 && <div style={{ flex:capaOther, background:'rgba(74,222,128,.6)' }} />}
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
                  {capaOvd   > 0 && <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'0.7rem', color:'rgba(255,255,255,.65)' }}><span style={{ width:'7px', height:'7px', borderRadius:'50%', background:'#ef4444', flexShrink:0 }} />{capaOvd} overdue</div>}
                  {capaOpn   > 0 && <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'0.7rem', color:'rgba(255,255,255,.65)' }}><span style={{ width:'7px', height:'7px', borderRadius:'50%', background:'#f59e0b', flexShrink:0 }} />{capaOpn} open</div>}
                  {capaOther > 0 && <div style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'0.7rem', color:'rgba(255,255,255,.65)' }}><span style={{ width:'7px', height:'7px', borderRadius:'50%', background:'#4ade80', flexShrink:0 }} />{capaOther} on track</div>}
                </div>
              </>
            )}
          </div>
        </div>

      </ReorderStrip>
    );
  }

  // ── Enterprise stats — Severity Mix · Open Investigations · Corrective Actions · Trend ──
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const thisMonthCount = mtdIncidents.length;
  const lastMonthCount = incidents.filter(i => i.date && new Date(i.date) >= prevMonthStart && new Date(i.date) < startOfMonth).length;
  const trendPct = lastMonthCount > 0 ? Math.round(((thisMonthCount - lastMonthCount) / lastMonthCount) * 100) : (thisMonthCount > 0 ? 100 : 0);
  const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthly = Array.from({ length: 6 }, (_, idx) => {
    const ms = new Date(now.getFullYear(), now.getMonth() - (5 - idx), 1);
    const me = new Date(now.getFullYear(), now.getMonth() - (5 - idx) + 1, 1);
    return incidents.filter(i => i.date && new Date(i.date) >= ms && new Date(i.date) < me).length;
  });
  const monthLabels = Array.from({ length: 6 }, (_, idx) => MONTH_ABBR[(now.getMonth() - (5 - idx) + 12) % 12]!);
  const capaTotal = capa.length;
  const capaDone  = capa.filter(c => /closed|verified/i.test(c.status)).length;
  const capaPct   = capaTotal > 0 ? Math.round((capaDone / capaTotal) * 100) : 0;

  return (
    <MetricRow pageKey={`hse.incidents.${pageTab}`} rowClass="ui-stat-row" cards={[
      { key: 'severity', node: (
        <StatsCard icon="fa-chart-pie" title="Severity Mix"
          chart={
            <div style={{ display: 'flex', alignItems: 'center', gap: '26px' }}>
              <div style={{ position: 'relative', flexShrink: 0, width: 142, height: 142 }}>
                <svg width="142" height="142" viewBox="0 0 150 150">
                  <circle cx="75" cy="75" r="62" fill="none" stroke="#eef0f5" stroke-width="15" />
                  {(() => {
                    const R = 62, C = 2 * Math.PI * R; let offset = 0;
                    return (['danger','warning','info','success'] as const).map(k => {
                      const val = sevCounts[k];
                      if (val <= 0) return null;
                      const len = (val / total) * C;
                      const node = (
                        <circle key={k} cx="75" cy="75" r={R} fill="none" stroke={SEV_COLORS[k]} stroke-width="15"
                          stroke-dasharray={`${Math.max(0, len - 3)} ${C}`} stroke-dashoffset={-offset}
                          transform="rotate(-90 75 75)" stroke-linecap="butt" />
                      );
                      offset += len;
                      return node;
                    });
                  })()}
                </svg>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontSize: '2.4rem', fontWeight: 600, color: 'var(--siomac-navy)', lineHeight: 1, letterSpacing: '-0.03em' }}>{mtdIncidents.length}</span>
                  <span style={{ fontSize: '0.58rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.07em', marginTop: '3px' }}>Incidents MTD</span>
                </div>
              </div>
              <div style={{ flex: 1, display: 'grid', gap: '9px', minWidth: 0 }}>
                {([['danger','Critical'],['warning','High'],['info','Medium'],['success','Low']] as const).map(([k, label]) => (
                  <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '0.74rem' }}>
                    <span style={{ width: '9px', height: '9px', borderRadius: '2px', background: SEV_COLORS[k], flexShrink: 0 }} />
                    <span style={{ color: 'var(--text-muted)', flex: 1 }}>{label}</span>
                    <span style={{ fontWeight: 'var(--font-weight-bold)', color: 'var(--siomac-navy)' }}>{sevCounts[k]}</span>
                  </div>
                ))}
              </div>
            </div>
          }
          footer={`${sevCounts.danger + sevCounts.warning} high-risk this month`} />
      ) },
      { key: 'investigations', node: (
        <StatsCard icon="fa-magnifying-glass" title="Open Investigations"
          metric={investigations.filter(i => !/closed/i.test(i.status)).length} metricUnit="open"
          supporting={`${rcaPct}% root-caused · ${activeInvest} incidents under investigation`}
          statuses={[
            { label: 'Critical',  value: invCrit,   color: '#ef4444' },
            { label: 'In review', value: invReview, color: '#f59e0b' },
          ]}
          footer={`${evPending} evidence items outstanding`} />
      ) },
      { key: 'corrective', node: (
        <StatsCard icon="fa-list-check" title="Corrective Actions" variant="navy"
          metric={`${capaPct}%`} supporting={`${capaDone} / ${capaTotal} corrective actions completed`}
          percent={capaPct} percentColor={capaPct >= 95 ? '#4ade80' : '#fbbf24'} percentTarget="Target 95%"
          footer={`Avg close ${avgDaysToClose > 0 ? `${avgDaysToClose}d` : '—'}`} />
      ) },
      { key: 'trend', node: (
        <StatsCard icon="fa-chart-line" title="Incident Trend"
          metric={thisMonthCount} metricUnit="this month"
          supporting={`${trendPct >= 0 ? '+' : ''}${trendPct}% vs last month`}
          chart={
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <Sparkline points={monthly} color={trendPct > 0 ? '#ef4444' : '#16a34a'} height={72} />
              <div class="hse-spark-months">{monthLabels.map(m => <span key={m}>{m}</span>)}</div>
            </div>
          }
          footer="Incidents — last 6 months" />
      ) },
    ]} />
  );
}

// ── CAPA Health Card ──────────────────────────────────────────────────────────

function CapaHealthCard({ capa, onViewAll, closurePct, overdueCapa, avgDaysToClose, avgTarget }: {
  capa: CapaItem[];
  onViewAll: () => void;
  closurePct: number;
  overdueCapa: number;
  avgDaysToClose: number;
  avgTarget: number;
}): VNode {
  const openCount   = capa.filter(c => !/closed|verified/i.test(c.status)).length;
  const pendingEv   = capa.filter(c => /pending|evidence/i.test(c.status)).length;
  const closedMonth = capa.filter(c => /closed|verified/i.test(c.status)).length;
  const highestRisk = capa.filter(c => c.priority === 'danger' && !/closed/i.test(c.status))[0];
  const oldestOpen  = capa.filter(c => !/closed|verified/i.test(c.status))
    .sort((a, b) => new Date(a.due).getTime() - new Date(b.due).getTime())[0];

  const rows = [
    { icon: 'fa-folder-open',  label: 'Open',             val: String(openCount),    cls: '' },
    { icon: 'fa-clock',        label: 'Overdue',           val: String(overdueCapa),  cls: overdueCapa > 0 ? 'capa-row-warn' : '' },
    { icon: 'fa-paperclip',    label: 'Pending Evidence',  val: String(pendingEv),    cls: '' },
    { icon: 'fa-circle-check', label: 'Closed',            val: String(closedMonth),  cls: 'capa-row-good' },
    { icon: 'fa-chart-line',   label: 'Closure Rate',      val: `${closurePct}%`,     cls: closurePct >= 95 ? 'capa-row-good' : 'capa-row-warn' },
    { icon: 'fa-hourglass',    label: 'Avg Days to Close', val: avgDaysToClose > 0 ? `${avgDaysToClose}d` : '—', cls: avgDaysToClose > avgTarget ? 'capa-row-warn' : '' },
  ];

  return (
    <div class="capa-health-card">
      <div class="capa-health-header">
        <span class="capa-health-title"><i class="fas fa-list-check" /> CAPA Health</span>
      </div>
      <div class="capa-health-rows">
        {rows.map(r => (
          <div key={r.label} class={`capa-health-row ${r.cls}`}>
            <i class={`fas ${r.icon}`} />
            <span class="capa-health-row-label">{r.label}</span>
            <span class="capa-health-row-val">{r.val}</span>
          </div>
        ))}
      </div>
      <div class="capa-health-bar-row">
        <div class="capa-health-bar-track">
          <div class="capa-health-bar-fill" style={{ width: `${closurePct}%`, background: closurePct >= 95 ? '#16a34a' : closurePct >= 70 ? '#d97706' : '#ef4444' }} />
        </div>
        <span class="capa-health-bar-pct">{closurePct}% closure</span>
      </div>
      {(highestRisk || oldestOpen) && (
        <div class="capa-health-alerts">
          {highestRisk && (
            <div class="capa-alert-row capa-alert-critical">
              <i class="fas fa-triangle-exclamation" />
              <span>Highest risk: <strong>{highestRisk.ref}</strong></span>
            </div>
          )}
          {oldestOpen && (
            <div class="capa-alert-row capa-alert-warn">
              <i class="fas fa-clock" />
              <span>Oldest: <strong>{oldestOpen.ref}</strong> · {oldestOpen.owner}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────

export function IncidentsArea({ tab: _tab }: { tab: string }): VNode {
  const [openIncident, setOpenIncident] = useState<IncidentRecord | null>(null);

  const incidentsQ       = useHseIncidents({ limit: 200 });
  const investigationsQ  = useHseInvestigations();
  const capaQ            = useHseCapa({ limit: 200 });
  const kpisQ            = useHseDashboardKpis();
  const createIncident      = useCreateIncident();
  const createInvestigation = useCreateInvestigation();

  const incidents      = incidentsQ.data?.map(dbToIncidentRecord)     ?? [];
  const investigations = investigationsQ.data?.map(dbToInvestigation) ?? [];
  const capa           = capaQ.data?.map(dbToCapa)                    ?? [];

  const ltiFreeDays = kpisQ.data?.ltiFreeDays ?? 47;


  const openCount = incidents.filter(i => !/closed/i.test(i.status)).length;
  const critCount = incidents.filter(i => i.severity === 'danger').length;
  const openCapa  = capa.filter(c => !/closed/i.test(c.status)).length;

  const closedCount = incidents.filter(i => /closed/i.test(i.status)).length;
  const closurePct  = incidents.length ? Math.round((closedCount / incidents.length) * 100) : 0;

  const overdueCapa = capa.filter(c => /overdue/i.test(c.status)).length;

  // Avg days to close — only closed incidents with a parseable date
  const closedWithDate = incidents.filter(i => /closed/i.test(i.status) && i.date);
  const avgDaysToClose = closedWithDate.length
    ? Math.round(closedWithDate.reduce((sum, i) => sum + Math.max(1, Math.round((Date.now() - new Date(i.date).getTime()) / 86400e3)), 0) / closedWithDate.length)
    : 0;
  const avgTarget = 14; // target: close within 14 days

  async function handleReportSubmit(payload: {
    type: IncidentType; severity: string; site: string;
    classification?: OshClass; injuryType?: string; bodyPart?: string;
    lostDays?: number; returnToWork?: string;
    description: string; immediateActions: string;
    peopleInvolved: PersonInvolved[]; witnesses: Witness[];
    costImpact: boolean; equipmentDamage: boolean;
  }) {
    const dbSeverity: IncidentSeverity =
        payload.severity === 'Critical' ? 'critical'
      : payload.severity === 'High'     ? 'high'
      : payload.severity === 'Moderate' ? 'moderate'
      : 'minor';
    const TYPE_TO_DB: Record<IncidentType, DbIncidentType> = {
      'Injury':            'injury',
      'Near Miss':         'near_miss',
      'Environmental':     'environmental',
      'Property Damage':   'property_damage',
      'Unsafe Act':        'other',
      'Unsafe Condition':  'other',
    };
    const dbType = TYPE_TO_DB[payload.type];

    // Involved people and witnesses both persist to hse_incident_people.
    const people: IncidentPersonInput[] = [
      ...payload.peopleInvolved.map((p): IncidentPersonInput => ({
        personType:    p.contractor ? 'contractor' : 'injured',
        fullName:      p.name,
        userId:        p.employeeId ?? null,
        roleOrCompany: p.role ?? null,
      })),
      ...payload.witnesses.map((w): IncidentPersonInput => ({
        personType:        'witness',
        fullName:          w.name,
        userId:            w.employeeId ?? null,
        injuryDescription: w.statement ?? null,
      })),
    ];

    try {
      // The backend starts the incident_investigation workflow on create
      // (runModuleMutation → startWorkflowForRecord); the frontend must NOT
      // start a second one by templateKey (that produced a duplicate workflow).
      await createIncident.mutateAsync({
        title:           payload.description.slice(0, 120) || `${payload.type} incident`,
        incidentType:    dbType,
        severity:        dbSeverity,
        incidentDate:    new Date().toISOString(),
        locationText:    payload.site,
        oshClassification: payload.classification ?? null,
        injuryType:      payload.injuryType ?? null,
        bodyPart:        payload.bodyPart ?? null,
        lostDays:        payload.lostDays ?? 0,
        returnToWork:    payload.returnToWork ?? null,
        lostTime:        (payload.lostDays ?? 0) > 0 || payload.classification === 'lost-time',
        costImpact:      payload.costImpact,
        equipmentDamage: payload.equipmentDamage,
        description:     payload.description,
        immediateAction: payload.immediateActions,
        people,
      });
    } catch { /* non-fatal */ }
    setPageTab('incidents');
  }

  // Wizard open state — Report Incident is now a modal wizard, not a tab
  const [wizardOpen, setWizardOpen] = useState(false);

  // Page-level tabs: Incidents | Investigations | CAPA Actions.
  // Analytics/trends live in the (future) HSE Reports page, kept separate from
  // this operational workspace — not as a tab here.
  const PAGE_TABS: AreaTab[] = [
    { key: 'incidents',      label: 'Incidents',        sublabel: 'Table & queue',   icon: 'fa-list-ul',                count: incidents.length },
    { key: 'investigations', label: 'Investigations',   sublabel: 'Root cause',      icon: 'fa-magnifying-glass-chart', count: investigations.length },
    { key: 'capa',           label: 'CAPA Actions',     sublabel: 'Corrective work', icon: 'fa-list-check',             count: openCapa },
  ];

  // Status filter chips for Incidents tab
  const VIEWS = [
    { key: 'all',      label: 'All',       count: incidents.length },
    { key: 'open',     label: 'Open',      count: incidents.filter(i => /open/i.test(i.status)).length },
    { key: 'critical', label: 'Critical',  count: incidents.filter(i => i.severity === 'danger').length },
    { key: 'capa',     label: 'CAPA Open', count: openCapa },
    { key: 'closed',   label: 'Closed',    count: closedCount },
  ] as const;

  const [pageTab,    setPageTab]    = useState<string>('incidents');
  const [savedView,  setSavedView]  = useState<string>('all');

  return (
    <div class="hse-tab hse-dash inc-workspace">

      {/* ── Page header ── */}
      <PageHeader
        icon="fa-triangle-exclamation"
        module="HSE"
        title="Incidents"
        sub="Report, triage and investigate workplace incidents and near-misses, and track corrective actions."
        meta={[
          { icon: 'fa-calendar', label: 'Jan – Jun 2026' },
          { icon: 'fa-location-dot', label: 'All sites' },
          { icon: 'fa-hashtag', label: `${incidents.length} records` },
        ]}
      />

      {/* ── Tab-aware summary cards ── */}
      <IncidentControlStrip
        incidents={incidents}
        investigations={investigations}
        capa={capa}
        closurePct={closurePct}
        avgDaysToClose={avgDaysToClose}
        pageTab={pageTab}
      />

      {/* ── Tab workspace — nav + standard New ▾ menu on the right ── */}
      <div style={{ display: 'flex', alignItems: 'stretch', gap: '12px', marginTop: '20px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <TabBar tabs={PAGE_TABS} active={pageTab} onSelect={setPageTab} />
        </div>
        <div style={{ flexShrink: 0 }}>
          <NewMenu label="New Incident" fill items={[
            { label: 'Report Injury',        icon: 'fa-person-falling-burst', sub: 'Personal harm',     onSelect: () => setWizardOpen(true) },
            { label: 'Report Near Miss',     icon: 'fa-triangle-exclamation', sub: 'Close call',        onSelect: () => setWizardOpen(true) },
            { label: 'Report Environmental', icon: 'fa-leaf',                 sub: 'Spill / release',   onSelect: () => setWizardOpen(true) },
            { label: 'Report Property',      icon: 'fa-wrench',               sub: 'Asset damage',      onSelect: () => setWizardOpen(true) },
          ]} />
        </div>
      </div>

      {/* ── Quick KPI spark row ── */}
      <div style={{ marginTop: '16px' }}>
        <div class="hse-spark-row">
          <div class="hse-spark">
            <div class="hse-spark-header"><span class="hse-spark-label">Total Incidents</span></div>
            <div class="hse-spark-val">{incidents.length}</div>
            <div class="hse-spark-sub">All recorded cases</div>
          </div>
          <div class="hse-spark">
            <div class="hse-spark-header"><span class="hse-spark-label">Open</span></div>
            <div class="hse-spark-val" style={{ color: '#f59e0b' }}>{incidents.filter(i => !/closed/i.test(i.status)).length}</div>
            <div class="hse-spark-sub">Awaiting closure</div>
          </div>
          <div class="hse-spark">
            <div class="hse-spark-header"><span class="hse-spark-label">Lost-Time</span></div>
            <div class="hse-spark-val" style={{ color: '#ef4444' }}>{incidents.filter(i => i.lostTime).length}</div>
            <div class="hse-spark-sub">LTI reportable</div>
          </div>
          <div class="hse-spark">
            <div class="hse-spark-header"><span class="hse-spark-label">Closure Rate</span></div>
            <div class="hse-spark-val" style={{ color: '#22c55e' }}>{closurePct}%</div>
            <div class="hse-spark-sub">Closed of total</div>
          </div>
        </div>
      </div>

      {/* Tab content — consistent top gap below nav */}
      <div style={{ marginTop: '20px' }}>
        {pageTab === 'incidents' && (
          <RegisterTab incidents={incidents} savedView={savedView} setSavedView={setSavedView} views={VIEWS} capa={capa} onOpen={setOpenIncident} onReport={() => setWizardOpen(true)} />
        )}
        {pageTab === 'investigations' && <InvestigationsTab investigations={investigations} capa={capa} />}
        {pageTab === 'capa' && <CapaTab capa={capa} closurePct={closurePct} avgDaysToClose={avgDaysToClose} />}
      </div>

      {/* Report Incident wizard modal */}
      <IncidentReportWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSubmit={handleReportSubmit}
      />

      <IncidentDrawer
        incident={openIncident}
        incidentId={openIncident ? incidentsQ.data?.find(i => i.ref === openIncident.ref)?.id ?? null : null}
        onClose={() => setOpenIncident(null)}
        onInvestigate={async () => {
          if (!openIncident) return;
          const dbId = incidentsQ.data?.find(i => i.ref === openIncident.ref)?.id;
          // Create the investigation record on the backend (it links to the
          // incident, advances status, and notifies the assigned investigator).
          if (dbId) {
            try { await createInvestigation.mutateAsync({ incidentId: dbId, rootCauseMethod: '5why' }); }
            catch { /* non-fatal — surfaced via query error state */ }
          }
          setOpenIncident(null); setPageTab('investigations');
        }}
      />
    </div>
  );
}

// ── Register tab ──────────────────────────────────────────────────────────────

function nextStep(i: IncidentRecord): string {
  if (/closed/i.test(i.status))      return 'Closed';
  if (/capa/i.test(i.status))        return 'Verify CAPA';
  if (/investigation/i.test(i.status)) return 'Root cause';
  if (/review/i.test(i.status))      return 'HSE review';
  return 'Assign owner';
}



function RegisterTab({ incidents, savedView, setSavedView, views, capa, onOpen, onReport }: {
  incidents: IncidentRecord[];
  savedView: string;
  setSavedView: (v: string) => void;
  views: ReadonlyArray<{ key: string; label: string; count: number }>;
  capa: CapaItem[];
  onOpen: (i: IncidentRecord) => void;
  onReport: () => void;
}): VNode {
  const [search,     setSearch]   = useState('');
  const [typeFilter, setType]     = useState('All types');
  const [siteFilter, setSite]     = useState('All sites');
  const [auditOpen,  setAuditOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return incidents.filter(i => {
      // saved view filter
      if (savedView === 'open'     && !/open/i.test(i.status))                                   return false;
      if (savedView === 'critical' && i.severity !== 'danger')                                    return false;
      if (savedView === 'overdue'  && (daysOpen(i.date) < 7 || /closed/i.test(i.status)))        return false;
      if (savedView === 'invest'   && !/investigation/i.test(i.status))                           return false;
      if (savedView === 'closed'   && !/closed/i.test(i.status))                                  return false;
      // text + dropdown filters
      if (q && !i.ref.toLowerCase().includes(q) && !i.description.toLowerCase().includes(q)
             && !i.site.toLowerCase().includes(q) && !i.reporter.toLowerCase().includes(q))       return false;
      if (typeFilter !== 'All types' && i.type !== typeFilter)                                    return false;
      if (siteFilter !== 'All sites' && i.site !== siteFilter)                                    return false;
      return true;
    });
  }, [incidents, savedView, search, typeFilter, siteFilter]);

  const pg = usePagination(filtered);

  // Audit trail — derived from the visible register, newest first. Every incident
  // contributes its lifecycle events (reported → investigation → CAPA → closed).
  const auditEntries = useMemo(() => buildAuditTrail(filtered, capa), [filtered, capa]);

  return (
    <div>

      {/* ── Main register ── */}
      <div class="hse-table-card">
        <div class="hse-table-card-top">
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px' }}>
            <div class="vt-section-titlewrap">
              <span class="vt-section-icon"><i class="fas fa-list-ul" /></span>
              <div>
                <div class="vt-section-title">Incident Register</div>
                <div class="vt-section-sub">All reported incidents · click any row to open detail</div>
              </div>
            </div>
            <button class="inc-action-btn secondary" onClick={() => setAuditOpen(true)}>
              <i class="fas fa-clock-rotate-left" /> Audit Log
            </button>
          </div>
          <div class="vt-toolbar" style={{ marginBottom: 0, marginTop: '12px' }}>
            <div class="vt-search" style={{ flex: '1 1 180px' }}>
              <i class="fas fa-search" />
              <input type="search" placeholder="Search ref, site, reporter…"
                value={search} onInput={e => setSearch((e.target as HTMLInputElement).value)} />
            </div>
            <select class="emp-filter-select" value={savedView} onChange={e => setSavedView((e.target as HTMLSelectElement).value)}>
              {views.map(v => <option key={v.key} value={v.key}>{v.label} ({v.count})</option>)}
            </select>
            <select class="emp-filter-select" value={typeFilter} onChange={e => setType((e.target as HTMLSelectElement).value)}>
              <option>All types</option>
              {INCIDENT_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            <select class="emp-filter-select" value={siteFilter} onChange={e => setSite((e.target as HTMLSelectElement).value)}>
              <option>All sites</option>
              {HSE_SITES.map(s => <option key={s}>{s}</option>)}
            </select>
            <button class="inc-action-btn blue" onClick={() => exportCsv(filtered, [
              { header: 'Ref',                value: i => i.ref },
              { header: 'Date',               value: i => i.date },
              { header: 'Type',               value: i => i.type },
              { header: 'Severity',           value: i => SEVERITY_META[i.severity]?.label ?? i.severity },
              { header: 'Site',               value: i => i.site },
              { header: 'Reporter',           value: i => i.reporter },
              { header: 'Status',             value: i => i.status },
              { header: 'Description',        value: i => i.description },
              { header: 'Immediate Actions',  value: i => i.immediateActions },
            ], 'incident-register')}><i class="fas fa-download" /> Export</button>
          </div>
        </div>
        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead>
              <tr>
                <th style={{ width: '110px' }}>Ref / Date</th>
                <th style={{ width: '78px' }}>Severity</th>
                <th style={{ width: '100px' }}>Type</th>
                <th>Description</th>
                <th style={{ width: '120px' }}>Reporter / Site</th>
                <th style={{ width: '100px' }}>Status</th>
                <th style={{ width: '52px' }}>SLA</th>
                <th style={{ width: '80px' }}>Invest.</th>
                <th style={{ width: '52px' }}>CAPA</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign:'center', color:'var(--text-muted)', padding:'28px' }}>No incidents match.</td></tr>
              ) : pg.pageItems.map(i => {
                const days      = daysOpen(i.date);
                const closed    = /closed/i.test(i.status);
                const sev       = SEVERITY_META[i.severity] ?? SEVERITY_META['success']!;
                const summary   = i.description.length > 55 ? i.description.slice(0, 53) + '…' : i.description;
                const isInvest  = /investigation/i.test(i.status);
                const capaCount = capa.filter(c => c.source === i.ref && !/closed|verified/i.test(c.status)).length;
                return (
                  <tr key={i.ref} onClick={() => onOpen(i)} style={{ cursor: 'pointer' }}>
                    <td>
                      <span class="vt-cell-mono">{i.ref}</span>
                      <div class="vt-cell-subtext">{i.date}</div>
                    </td>
                    <td>
                      <span class="inc-sev-chip" style={{ background: sev.bg, color: sev.color }}>
                        <i class={`fas ${sev.icon}`} style={{ fontSize: '0.6rem' }} /> {sev.label}
                      </span>
                    </td>
                    <td>{i.type}</td>
                    <td>
                      <span class="inc-summary-text" title={`${i.description}\n\nImmediate: ${i.immediateActions}`}>{summary}</span>
                    </td>
                    <td>
                      <span class="vt-cell-name" style={{ fontSize: '0.78rem' }}>{i.reporter}</span>
                      <div class="vt-cell-subtext">{i.site}</div>
                    </td>
                    <td><span class={incidentPill(i.status, i.severity)}>{i.status}</span></td>
                    <td>
                      <span class={`days-open${!closed && days >= 5 ? ' overdue' : ''}`}>
                        {closed ? '—' : `${days}d`}
                      </span>
                    </td>
                    <td>
                      {isInvest
                        ? <span class="inc-badge-invest"><i class="fas fa-magnifying-glass" /> Active</span>
                        : closed
                          ? <span class="inc-badge-done"><i class="fas fa-circle-check" /> Done</span>
                          : <span style={{ color:'var(--text-muted)' }}>—</span>
                      }
                    </td>
                    <td>
                      {capaCount > 0
                        ? <span class="inc-badge-capa">{capaCount}</span>
                        : <span style={{ color:'var(--text-muted)' }}>—</span>
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination page={pg.page} pageCount={pg.pageCount} total={pg.total} pageSize={pg.pageSize} onPage={pg.setPage} noun="incidents" />
      </div>

      {/* ── Audit Log ── */}
      <HseModal open={auditOpen} title="Incident Audit Log" sub={`${auditEntries.length} events · newest first`} icon="fa-clock-rotate-left" size="lg" onClose={() => setAuditOpen(false)}>
        {auditEntries.length === 0 ? (
          <div class="hse-empty" style={{ padding: '28px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <i class="fas fa-shield-halved" style={{ fontSize: '1.6rem', opacity: 0.4 }} />
            <div style={{ marginTop: '8px' }}>No audit events for the current filter.</div>
          </div>
        ) : (
          <div class="inc-audit-list">
            {auditEntries.map((e, idx) => (
              <div class="inc-audit-row" key={`${e.ref}-${e.action}-${idx}`}>
                <span class="inc-audit-dot" style={{ background: e.color }} />
                <div class="inc-audit-body">
                  <div class="inc-audit-head">
                    <span class="inc-audit-action">{e.action}</span>
                    <span class="vt-cell-mono inc-audit-ref">{e.ref}</span>
                  </div>
                  <div class="inc-audit-meta">{e.actor} · {e.detail}</div>
                </div>
                <span class="inc-audit-date">{e.date}</span>
              </div>
            ))}
          </div>
        )}
      </HseModal>

    </div>
  );
}

// ── Audit trail ────────────────────────────────────────────────────────────────

interface AuditEntry {
  ref: string; action: string; actor: string; detail: string;
  date: string; ts: number; color: string;
}

/** Parse the seed date strings ("12 Jun 2026") into a sortable timestamp. */
function auditTs(date: string): number {
  const t = Date.parse(date);
  return Number.isNaN(t) ? 0 : t;
}

/** Build a reverse-chronological lifecycle trail from the incident register. */
function buildAuditTrail(incidents: IncidentRecord[], capa: CapaItem[]): AuditEntry[] {
  const entries: AuditEntry[] = [];
  const ts = (d: string) => auditTs(d);

  for (const i of incidents) {
    const sev = SEVERITY_META[i.severity] ?? SEVERITY_META['success']!;
    // Reported
    entries.push({
      ref: i.ref, action: 'Incident reported', actor: i.reporter,
      detail: `${i.type} · ${i.site}`, date: i.date, ts: ts(i.date), color: sev.color,
    });
    // OSH regulator notification
    if (i.oshNotifiedAt) {
      entries.push({
        ref: i.ref, action: 'OSH Agency notified', actor: 'HSE Manager',
        detail: 'Statutory notification filed', date: i.oshNotifiedAt, ts: ts(i.oshNotifiedAt), color: '#ef4444',
      });
    }
    // Investigation
    if (/investigation/i.test(i.status)) {
      entries.push({
        ref: i.ref, action: 'Investigation opened', actor: 'HSE Team',
        detail: 'Root-cause analysis in progress', date: i.date, ts: ts(i.date) + 1, color: '#3b82f6',
      });
    }
    // CAPA raised
    const capaCount = capa.filter(c => c.source === i.ref).length;
    if (capaCount > 0) {
      entries.push({
        ref: i.ref, action: 'CAPA raised', actor: 'HSE Team',
        detail: `${capaCount} corrective action${capaCount > 1 ? 's' : ''} assigned`, date: i.date, ts: ts(i.date) + 2, color: '#f59e0b',
      });
    }
    // Closed
    if (/closed/i.test(i.status)) {
      entries.push({
        ref: i.ref, action: 'Closed out', actor: 'HSE Manager',
        detail: 'Verified · audit trail locked', date: i.date, ts: ts(i.date) + 3, color: '#22c55e',
      });
    }
  }

  return entries.sort((a, b) => b.ts - a.ts);
}

function matchSev(uiSeverity: string, filter: string): boolean {
  if (filter === 'Critical / High') return uiSeverity === 'danger' || uiSeverity === 'warning';
  if (filter === 'Moderate')        return uiSeverity === 'info';
  if (filter === 'Minor')           return uiSeverity === 'success';
  return true;
}

function priorityClass(sev: string): string {
  if (sev === 'danger')  return 'high';
  if (sev === 'warning') return 'high';
  if (sev === 'info')    return 'medium';
  return 'low';
}
function priorityLabel(sev: string): string {
  if (sev === 'danger' || sev === 'warning') return 'High';
  if (sev === 'info')  return 'Medium';
  return 'Low';
}
/** vt-pill variant for incident status, with critical override for danger-severity open items. */
function incidentPill(status: string, sev: string): string {
  if (sev === 'danger' && !/closed/i.test(status)) return toneClass('critical');
  return hsePill(status);
}

// ── Incident Report Wizard ────────────────────────────────────────────────────

const HSE_AREAS   = ['Process Area', 'Storage / Tank Farm', 'Workshop', 'Offices', 'Marine Jetty', 'Construction Site', 'Control Room', 'Laboratory', 'Utility Area', 'Loading Bay'];
const HSE_SHIFTS  = ['Day (06:00–18:00)', 'Night (18:00–06:00)', 'Morning (06:00–14:00)', 'Afternoon (14:00–22:00)'];
const SPILL_TYPES = ['Oil / Hydrocarbon', 'Chemical', 'Produced Water', 'Drilling Fluid', 'Sewage', 'Other'];
const SPILL_MEDIA = ['Soil / Ground', 'Storm Drain', 'Watercourse / River', 'Sea / Marine', 'Bund / Containment', 'Air / Atmosphere'];

type ReportPayload = {
  type: IncidentType; severity: string; site: string;
  classification?: OshClass; injuryType?: string; bodyPart?: string;
  lostDays?: number; returnToWork?: string;
  description: string; immediateActions: string;
  peopleInvolved: PersonInvolved[]; witnesses: Witness[];
  costImpact: boolean; equipmentDamage: boolean;
};

const WIZARD_STEPS = [
  { label: 'Event Basics',    icon: 'fa-tag',            sub: 'Type, severity, site, date & location' },
  { label: 'What Happened',   icon: 'fa-align-left',     sub: 'Description, controls, immediate actions' },
  { label: 'People',          icon: 'fa-users',          sub: 'Involved persons, injury details, witnesses' },
  { label: 'Work Controls',   icon: 'fa-gears',          sub: 'Equipment, contractor, permits, LOTO' },
  { label: 'Regulatory',      icon: 'fa-gavel',          sub: 'OSH, EMA, emergency services, evidence' },
  { label: 'Review',          icon: 'fa-circle-check',   sub: 'Summary, routing preview, submit' },
] as const;

function IncidentReportWizard({ open, onClose, onSubmit }: {
  open: boolean;
  onClose: () => void;
  onSubmit: (p: ReportPayload) => void | Promise<void>;
}): VNode {
  const [step, setStep] = useState(0);

  // ── Core classification
  const [type,           setType]     = useState<IncidentType>('Near Miss');
  const [severity,       setSeverity] = useState('High');
  const [site,           setSite]     = useState<string>(HSE_SITES[0] ?? '');
  // ── Date / time / shift
  const todayStr = new Date().toISOString().split('T')[0] ?? '';
  const nowStr   = new Date().toTimeString().slice(0, 5);
  const [incDate,   setIncDate]  = useState(todayStr);
  const [incTime,   setIncTime]  = useState(nowStr);
  const [repDate,   setRepDate]  = useState(todayStr);
  const [shift,     setShift]    = useState('');
  // ── Location detail
  const [area,      setArea]     = useState('');
  const [location,  setLoc]      = useState('');
  const [workOrder, setWO]       = useState('');
  const [ptwRef,    setPTW]      = useState('');
  const [jsaRef,    setJSA]      = useState('');
  // ── Reporter
  const [repName,   setRepName]  = useState('');
  const [repRole,   setRepRole]  = useState('');
  const [repPhone,  setRepPhone] = useState('');
  const [onBehalf,  setOnBehalf] = useState(false);
  // ── Description
  const [description, setDesc]   = useState('');
  // ── Immediate controls
  const [ctrlStop,   setCtrlStop]   = useState<boolean | null>(null);
  const [ctrlIso,    setCtrlIso]    = useState<boolean | null>(null);
  const [ctrlFA,     setCtrlFA]     = useState<boolean | null>(null);
  const [ctrlSupv,   setCtrlSupv]   = useState<boolean | null>(null);
  const [ctrlHSE,    setCtrlHSE]    = useState<boolean | null>(null);
  const [ctrlEmg,    setCtrlEmg]    = useState<boolean | null>(null);
  const [ctrlActions, setCtrlActions] = useState('');
  // ── Injury (conditional)
  const [classification, setClass]   = useState<OshClass | ''>('');
  const [injuredName,    setInjName] = useState('');
  const [injuryType,     setInjury]  = useState('');
  const [bodyPart,       setBodyPart] = useState('');
  const [medLevel,       setMedLevel] = useState('');
  const [sentToClinic,   setClinic]  = useState<boolean | null>(null);
  const [rtwRestriction, setRTWR]    = useState<boolean | null>(null);
  const [lostDays,       setLostDays] = useState('0');
  const [returnToWork,   setRTW]      = useState('');
  // ── Environmental (conditional)
  const [spillType,  setSpillType] = useState('');
  const [spillQty,   setSpillQty]  = useState('');
  const [spillMedia, setSpillMedia] = useState('');
  const [drainAffected, setDrain]  = useState<boolean | null>(null);
  const [containmentOk, setContain] = useState<boolean | null>(null);
  const [emaReqd,    setEmaReqd]   = useState<boolean | null>(null);
  // ── Work controls
  const [equipment,      setEquipment]  = useState('');
  const [lotoInvolved,   setLOTO]       = useState<boolean | null>(null);
  const [equipmentDmg,   setEquipDmg]   = useState(false);
  const [costImpact,     setCostImpact] = useState(false);
  const [contractorCo,   setConCo]      = useState('');
  // ── Regulatory
  const [oshReportable, setOshRep] = useState<'yes'|'no'|'unknown'>('unknown');
  const [emaNotifReqd,  setEmaNot] = useState<'yes'|'no'|'unknown'>('unknown');
  const [policeNotified, setPolice] = useState(false);
  const [ambulance,      setAmb]   = useState(false);
  const [fire,           setFire]  = useState(false);
  // ── People / witnesses
  const [people,    setPeople]    = useState<PersonInvolved[]>([{ name: '' }]);
  const [witnesses, setWitnesses] = useState<Witness[]>([]);
  // ── Submit state
  const [submitting, setSubmitting] = useState(false);
  const [errors,     setErrors]     = useState<string[]>([]);

  const isInjury   = type === 'Injury';
  const isEnv      = type === 'Environmental';
  const isLTI      = classification === 'lost-time' || classification === 'fatality';
  const needsOsh   = severity === 'Critical' || severity === 'High' || isLTI || classification === 'dangerous-occurrence';
  const isCritical = severity === 'Critical';
  const routeTo    = [
    'HSE Manager',
    ...(isCritical ? ['Site Director', 'Corporate HSE'] : ['Site Supervisor']),
    ...(isEnv ? ['Environmental Lead'] : []),
    ...(isInjury && isLTI ? ['HR Manager'] : []),
  ];

  function addPerson() { setPeople(p => [...p, { name: '' }]); }
  function removePerson(idx: number) { setPeople(p => p.filter((_, i) => i !== idx)); }
  function updatePerson(idx: number, field: keyof PersonInvolved, val: string | boolean) {
    setPeople(p => p.map((x, i) => i === idx ? { ...x, [field]: val } : x));
  }
  function addWitness() { setWitnesses(w => [...w, { name: '' }]); }
  function removeWitness(idx: number) { setWitnesses(w => w.filter((_, i) => i !== idx)); }
  function updateWitness(idx: number, field: keyof Witness, val: string) {
    setWitnesses(w => w.map((x, i) => i === idx ? { ...x, [field]: val } : x));
  }

  function validateStep(s: number): string[] {
    const errs: string[] = [];
    if (s === 0) {
      if (!incDate) errs.push('Incident date is required.');
    }
    if (s === 1) {
      if (!description.trim()) errs.push('Incident description is required.');
    }
    if (s === 2) {
      if (people.some(p => !p.name.trim())) errs.push('All People Involved entries must have a name.');
      if (isInjury && !classification) errs.push('OSH classification is required for injury incidents.');
    }
    return errs;
  }

  function next() {
    const errs = validateStep(step);
    if (errs.length) { setErrors(errs); return; }
    setErrors([]);
    setStep(s => Math.min(s + 1, WIZARD_STEPS.length - 1));
  }
  function back() { setErrors([]); setStep(s => Math.max(s - 1, 0)); }

  async function submit() {
    const errs: string[] = [];
    if (!incDate)           errs.push('Incident date is required.');
    if (!description.trim()) errs.push('Incident description is required.');
    if (isInjury && !classification) errs.push('OSH classification is required.');
    if (people.some(p => !p.name.trim())) errs.push('All People Involved entries must have a name.');
    if (errs.length) { setErrors(errs); return; }
    setErrors([]);
    setSubmitting(true);
    try {
      await onSubmit({
        type, severity, site,
        classification: classification as OshClass || undefined,
        injuryType: injuryType || undefined,
        bodyPart: bodyPart || undefined,
        lostDays: parseInt(lostDays, 10) || 0,
        returnToWork: returnToWork || undefined,
        description,
        immediateActions: ctrlActions,
        peopleInvolved: people.filter(p => p.name.trim()),
        witnesses: witnesses.filter(w => w.name.trim()),
        costImpact,
        equipmentDamage: equipmentDmg,
      });
      onClose();
    } finally { setSubmitting(false); }
  }

  function YNToggle({ value, onChange, labels = ['Yes', 'No'] }: { value: boolean | null; onChange: (v: boolean | null) => void; labels?: [string, string] }) {
    return (
      <div class="ir-yn-toggle">
        <button class={`ir-yn-btn${value === true ? ' active-yes' : ''}`} onClick={() => onChange(value === true ? null : true)}>{labels[0]}</button>
        <button class={`ir-yn-btn${value === false ? ' active-no' : ''}`} onClick={() => onChange(value === false ? null : false)}>{labels[1]}</button>
      </div>
    );
  }

  // Step content
  function stepContent(): VNode {
    if (step === 0) return (
      <div class="wz-step-body">
        <div class="wz-section">
          <div class="wz-section-head">
            <i class="fas fa-tag" /> Event Classification
          </div>
          <div class="hse-form-grid ir-grid-3">
            <Field label="Incident type *">
              <SelectInput value={type} onInput={v => setType(v as IncidentType)} options={INCIDENT_TYPES} />
            </Field>
            <Field label="Severity *">
              <SelectInput value={severity} onInput={setSeverity} options={[...SEVERITIES]} />
            </Field>
            <Field label="Site *">
              <SelectInput value={site} onInput={setSite} options={HSE_SITES} />
            </Field>
          </div>
          {isCritical && (
            <div class="ir-alert ir-alert--critical">
              <i class="fas fa-triangle-exclamation" />
              <span><strong>Critical severity</strong> — OSH Act 2004 s.46 requires immediate notification to Chief Inspector by phone/email and <strong>written notice within 48 hours</strong>.</span>
            </div>
          )}
        </div>
        <div class="wz-section">
          <div class="wz-section-head"><i class="fas fa-calendar-days" /> Date, Time &amp; Shift</div>
          <div class="hse-form-grid ir-grid-4">
            <Field label="Incident date *">
              <input type="date" class="hse-input" value={incDate} onInput={e => setIncDate((e.target as HTMLInputElement).value)} />
            </Field>
            <Field label="Incident time">
              <input type="time" class="hse-input" value={incTime} onInput={e => setIncTime((e.target as HTMLInputElement).value)} />
            </Field>
            <Field label="Date reported">
              <input type="date" class="hse-input" value={repDate} onInput={e => setRepDate((e.target as HTMLInputElement).value)} />
            </Field>
            <Field label="Shift">
              <select class="hse-input" value={shift} onChange={e => setShift((e.target as HTMLSelectElement).value)}>
                <option value="">— Select —</option>
                {HSE_SHIFTS.map(s => <option key={s}>{s}</option>)}
              </select>
            </Field>
          </div>
        </div>
        <div class="wz-section">
          <div class="wz-section-head"><i class="fas fa-map-pin" /> Exact Location</div>
          <div class="hse-form-grid ir-grid-3">
            <Field label="Area / Unit">
              <select class="hse-input" value={area} onChange={e => setArea((e.target as HTMLSelectElement).value)}>
                <option value="">— Select —</option>
                {HSE_AREAS.map(a => <option key={a}>{a}</option>)}
              </select>
            </Field>
            <Field label="Specific location" wide>
              <input type="text" class="hse-input" value={location} placeholder="e.g. Train 2 Separator, Pump P-201 area" onInput={e => setLoc((e.target as HTMLInputElement).value)} />
            </Field>
          </div>
          <div class="hse-form-grid ir-grid-3" style={{ marginTop: '10px' }}>
            <Field label="Work order / Job no.">
              <input type="text" class="hse-input" value={workOrder} placeholder="WO-XXXXX" onInput={e => setWO((e.target as HTMLInputElement).value)} />
            </Field>
            <Field label="Related PTW ref.">
              <input type="text" class="hse-input" value={ptwRef} placeholder="PTW-2026-XXX" onInput={e => setPTW((e.target as HTMLInputElement).value)} />
            </Field>
            <Field label="JSA / Risk assessment ref.">
              <input type="text" class="hse-input" value={jsaRef} placeholder="JSA-XXXX" onInput={e => setJSA((e.target as HTMLInputElement).value)} />
            </Field>
          </div>
        </div>
        <div class="wz-section">
          <div class="wz-section-head"><i class="fas fa-user-tie" /> Reporter Details</div>
          <div class="hse-form-grid ir-grid-3">
            <Field label="Reported by">
              <input type="text" class="hse-input" value={repName} placeholder="Full name" onInput={e => setRepName((e.target as HTMLInputElement).value)} />
            </Field>
            <Field label="Role / Position">
              <input type="text" class="hse-input" value={repRole} placeholder="e.g. HSE Officer, Supervisor" onInput={e => setRepRole((e.target as HTMLInputElement).value)} />
            </Field>
            <Field label="Contact number">
              <input type="tel" class="hse-input" value={repPhone} placeholder="+1 868 XXX XXXX" onInput={e => setRepPhone((e.target as HTMLInputElement).value)} />
            </Field>
          </div>
          <div class="ir-yn-row" style={{ marginTop: '10px' }}>
            <span class="ir-yn-label">Reporting on behalf of another person?</span>
            <YNToggle value={onBehalf ? true : null} onChange={v => setOnBehalf(v === true)} />
          </div>
        </div>
      </div>
    );

    if (step === 1) return (
      <div class="wz-step-body">
        <div class="wz-section">
          <div class="wz-section-head"><i class="fas fa-align-left" /> Incident Description</div>
          <Field label="What occurred? *" wide>
            <TextareaInput value={description} onInput={setDesc}
              placeholder="Describe the sequence of events, conditions at the time, contributing factors, and exact location within the site. Include what was happening immediately before the incident." />
          </Field>
        </div>
        <div class="wz-section">
          <div class="wz-section-head">
            <i class="fas fa-shield-halved" /> Immediate Controls Taken
          </div>
          <div class="ir-checklist">
            {([
              ['Work stopped / area shut down?',    ctrlStop,  setCtrlStop],
              ['Area isolated / barricaded?',       ctrlIso,   setCtrlIso],
              ['First aid administered?',           ctrlFA,    setCtrlFA],
              ['Supervisor notified?',              ctrlSupv,  setCtrlSupv],
              ['HSE department notified?',          ctrlHSE,   setCtrlHSE],
              ['Emergency response activated?',     ctrlEmg,   setCtrlEmg],
            ] as Array<[string, boolean | null, (v: boolean | null) => void]>).map(([label, val, setter]) => (
              <div class="ir-check-row" key={label}>
                <span>{label}</span>
                <YNToggle value={val} onChange={setter} />
              </div>
            ))}
          </div>
          <div style={{ marginTop: '12px' }}>
            <Field label="Additional immediate actions / notes" wide>
              <TextareaInput value={ctrlActions} onInput={setCtrlActions}
                placeholder="Containment measures, emergency services called, management chain notified…" />
            </Field>
          </div>
        </div>
      </div>
    );

    if (step === 2) return (
      <div class="wz-step-body">
        <div class="wz-section">
          <div class="wz-section-head"><i class="fas fa-users" /> People Involved</div>
          {people.map((p, idx) => (
            <div key={idx} class="ir-person-card">
              <div class="ir-person-num">{idx + 1}</div>
              <div class="hse-form-grid ir-grid-4" style={{ flex: 1 }}>
                <Field label="Full name *">
                  <input type="text" class="hse-input" value={p.name} placeholder="Full name" onInput={e => updatePerson(idx, 'name', (e.target as HTMLInputElement).value)} />
                </Field>
                <Field label="Employee / Staff ID">
                  <input type="text" class="hse-input" value={p.employeeId ?? ''} placeholder="EMP-0001" onInput={e => updatePerson(idx, 'employeeId', (e.target as HTMLInputElement).value)} />
                </Field>
                <Field label="Role at time of incident">
                  <input type="text" class="hse-input" value={p.role ?? ''} placeholder="Welder, Supervisor…" onInput={e => updatePerson(idx, 'role', (e.target as HTMLInputElement).value)} />
                </Field>
                <Field label="Employee / Contractor">
                  <select class="hse-input" value={p.contractor ? 'contractor' : 'employee'} onChange={e => updatePerson(idx, 'contractor', (e.target as HTMLSelectElement).value === 'contractor')}>
                    <option value="employee">Employee</option>
                    <option value="contractor">Contractor</option>
                  </select>
                </Field>
              </div>
              {people.length > 1 && (
                <button class="hse-btn-icon-remove" onClick={() => removePerson(idx)} title="Remove"><i class="fas fa-xmark" /></button>
              )}
            </div>
          ))}
          <button class="hse-btn" style={{ marginTop: '8px' }} onClick={addPerson}><i class="fas fa-plus" /> Add Person</button>
        </div>

        {isInjury && (
          <div class="wz-section wz-section--conditional">
            <div class="wz-section-head">
              <i class="fas fa-person-falling" /> Injury Details
              <span class="ir-section-badge">OSH Act 2004</span>
            </div>
            <div class="hse-form-grid ir-grid-3">
              <Field label="Injured person's name">
                <input type="text" class="hse-input" value={injuredName} placeholder="Full name" onInput={e => setInjName((e.target as HTMLInputElement).value)} />
              </Field>
              <Field label="OSH classification *">
                <select class="hse-input" value={classification} onChange={e => setClass((e.target as HTMLSelectElement).value as OshClass | '')}>
                  <option value="">— Select —</option>
                  {OSH_CLASSES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="Nature of injury">
                <select class="hse-input" value={injuryType} onChange={e => setInjury((e.target as HTMLSelectElement).value)}>
                  <option value="">— Select —</option>
                  {INJURY_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Body part affected">
                <select class="hse-input" value={bodyPart} onChange={e => setBodyPart((e.target as HTMLSelectElement).value)}>
                  <option value="">— Select —</option>
                  {BODY_PARTS.map(b => <option key={b}>{b}</option>)}
                </select>
              </Field>
              <Field label="Medical treatment level">
                <select class="hse-input" value={medLevel} onChange={e => setMedLevel((e.target as HTMLSelectElement).value)}>
                  <option value="">— Select —</option>
                  {['First aid only', 'Medical treatment', 'Hospitalisation', 'Lost time', 'Fatality'].map(m => <option key={m}>{m}</option>)}
                </select>
              </Field>
            </div>
            <div class="ir-yn-grid" style={{ marginTop: '12px' }}>
              <div class="ir-yn-row"><span class="ir-yn-label">Sent to clinic / hospital?</span><YNToggle value={sentToClinic} onChange={setClinic} /></div>
              <div class="ir-yn-row"><span class="ir-yn-label">Return-to-work restriction?</span><YNToggle value={rtwRestriction} onChange={setRTWR} /></div>
            </div>
            {isLTI && (
              <div class="hse-form-grid ir-grid-3" style={{ marginTop: '12px' }}>
                <Field label="Estimated lost days">
                  <input type="number" min="0" class="hse-input" value={lostDays} onInput={e => setLostDays((e.target as HTMLInputElement).value)} />
                </Field>
                <Field label="Expected return to work">
                  <input type="date" class="hse-input" value={returnToWork} onInput={e => setRTW((e.target as HTMLInputElement).value)} />
                </Field>
              </div>
            )}
            {needsOsh && (
              <div class="ir-alert ir-alert--osh">
                <i class="fas fa-gavel" />
                <span><strong>Notifiable under OSH Act 2004 (T&amp;T).</strong> Notify Chief Inspector <strong>forthwith</strong> (s.46). Written notice within <strong>48 hrs</strong>. Non-critical injury notice within <strong>4 days</strong> (s.46A). Retain register for <strong>5 years</strong> (s.46(5)).</span>
              </div>
            )}
          </div>
        )}

        <div class="wz-section">
          <div class="wz-section-head"><i class="fas fa-eye" /> Witnesses</div>
          {witnesses.length === 0 && (
            <p class="ir-empty-note">No witnesses added. Click below if there were witnesses present.</p>
          )}
          {witnesses.map((w, idx) => (
            <div key={idx} class="ir-person-card">
              <div class="ir-person-num" style={{ background: 'var(--border)', color: 'var(--text-muted)' }}>{idx + 1}</div>
              <div class="hse-form-grid ir-grid-3" style={{ flex: 1 }}>
                <Field label="Witness name">
                  <input type="text" class="hse-input" value={w.name} placeholder="Full name" onInput={e => updateWitness(idx, 'name', (e.target as HTMLInputElement).value)} />
                </Field>
                <Field label="Employee / Staff ID">
                  <input type="text" class="hse-input" value={w.employeeId ?? ''} placeholder="EMP-0001" onInput={e => updateWitness(idx, 'employeeId', (e.target as HTMLInputElement).value)} />
                </Field>
                <Field label="Statement" wide>
                  <TextareaInput value={w.statement ?? ''} onInput={v => updateWitness(idx, 'statement', v)} placeholder="What did this witness observe?" />
                </Field>
              </div>
              <button class="hse-btn-icon-remove" onClick={() => removeWitness(idx)} title="Remove"><i class="fas fa-xmark" /></button>
            </div>
          ))}
          <button class="hse-btn" style={{ marginTop: '8px' }} onClick={addWitness}><i class="fas fa-plus" /> Add Witness</button>
        </div>
      </div>
    );

    if (step === 3) return (
      <div class="wz-step-body">
        <div class="wz-section">
          <div class="wz-section-head"><i class="fas fa-gears" /> Work Controls &amp; Equipment</div>
          <div class="hse-form-grid ir-grid-3">
            <Field label="Equipment / plant involved" wide>
              <input type="text" class="hse-input" value={equipment} placeholder="e.g. Crane, Forklift, Compressor P-301" onInput={e => setEquipment((e.target as HTMLInputElement).value)} />
            </Field>
            <Field label="Contractor company (if applicable)">
              <input type="text" class="hse-input" value={contractorCo} placeholder="Company name" onInput={e => setConCo((e.target as HTMLInputElement).value)} />
            </Field>
          </div>
          <div class="ir-yn-row" style={{ marginTop: '10px' }}>
            <span class="ir-yn-label">LOTO (Lockout/Tagout) involved?</span>
            <YNToggle value={lotoInvolved} onChange={setLOTO} />
          </div>
          <div class="ir-yn-row" style={{ marginTop: '8px' }}>
            <span class="ir-yn-label">Equipment / asset damage incurred?</span>
            <YNToggle value={equipmentDmg} onChange={v => setEquipDmg(v ?? false)} />
          </div>
          <div class="ir-yn-row" style={{ marginTop: '8px' }}>
            <span class="ir-yn-label">Financial / cost impact to business?</span>
            <YNToggle value={costImpact} onChange={v => setCostImpact(v ?? false)} />
          </div>
        </div>
        <div class="wz-section">
          <div class="wz-section-head"><i class="fas fa-file-shield" /> Permit &amp; Work Control References</div>
          <div class="hse-form-grid ir-grid-3">
            <Field label="Work order / Job no.">
              <input type="text" class="hse-input" value={workOrder} placeholder="WO-XXXXX" onInput={e => setWO((e.target as HTMLInputElement).value)} />
            </Field>
            <Field label="Related PTW ref.">
              <input type="text" class="hse-input" value={ptwRef} placeholder="PTW-2026-XXX" onInput={e => setPTW((e.target as HTMLInputElement).value)} />
            </Field>
            <Field label="JSA / Risk assessment ref.">
              <input type="text" class="hse-input" value={jsaRef} placeholder="JSA-XXXX" onInput={e => setJSA((e.target as HTMLInputElement).value)} />
            </Field>
          </div>
        </div>
      </div>
    );

    if (step === 4) return (
      <div class="wz-step-body">
        <div class="wz-section">
          <div class="wz-section-head">
            <i class="fas fa-gavel" /> Regulatory Triggers
          </div>
          <div class="ir-reg-grid">
            <div class="ir-reg-row">
              <span>OSH Act 2004 — reportable incident?</span>
              <div class="ir-yn-toggle">
                {(['yes','no','unknown'] as const).map(v => (
                  <button key={v} class={`ir-yn-btn${oshReportable === v ? ` active-${v === 'yes' ? 'yes' : v === 'no' ? 'no' : 'unk'}` : ''}`}
                    onClick={() => setOshRep(v)}>{v.charAt(0).toUpperCase() + v.slice(1)}</button>
                ))}
              </div>
            </div>
            <div class="ir-reg-row">
              <span>EMA notification required?</span>
              <div class="ir-yn-toggle">
                {(['yes','no','unknown'] as const).map(v => (
                  <button key={v} class={`ir-yn-btn${emaNotifReqd === v ? ` active-${v === 'yes' ? 'yes' : v === 'no' ? 'no' : 'unk'}` : ''}`}
                    onClick={() => setEmaNot(v)}>{v.charAt(0).toUpperCase() + v.slice(1)}</button>
                ))}
              </div>
            </div>
          </div>
          <div class="ir-services-row" style={{ marginTop: '14px' }}>
            <span class="ir-yn-label">Emergency services notified:</span>
            <div class="ir-services-chips">
              {([['Police', policeNotified, setPolice], ['Ambulance', ambulance, setAmb], ['Fire Service', fire, setFire]] as Array<[string, boolean, (v: boolean) => void]>).map(([label, val, setter]) => (
                <button key={label} class={`ir-service-chip${val ? ' active' : ''}`} onClick={() => setter(!val)}>
                  <i class={`fas ${label === 'Police' ? 'fa-shield-halved' : label === 'Ambulance' ? 'fa-truck-medical' : 'fa-fire-extinguisher'}`} /> {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {isEnv && (
          <div class="wz-section wz-section--conditional">
            <div class="wz-section-head"><i class="fas fa-leaf" /> Environmental Details <span class="ir-section-badge">EMA Act</span></div>
            <div class="hse-form-grid ir-grid-3">
              <Field label="Spill / release type">
                <select class="hse-input" value={spillType} onChange={e => setSpillType((e.target as HTMLSelectElement).value)}>
                  <option value="">— Select —</option>
                  {SPILL_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Estimated quantity (litres)">
                <input type="number" min="0" class="hse-input" value={spillQty} onInput={e => setSpillQty((e.target as HTMLInputElement).value)} />
              </Field>
              <Field label="Media affected">
                <select class="hse-input" value={spillMedia} onChange={e => setSpillMedia((e.target as HTMLSelectElement).value)}>
                  <option value="">— Select —</option>
                  {SPILL_MEDIA.map(m => <option key={m}>{m}</option>)}
                </select>
              </Field>
            </div>
            <div class="ir-yn-grid" style={{ marginTop: '12px' }}>
              <div class="ir-yn-row"><span class="ir-yn-label">Drain / watercourse affected?</span><YNToggle value={drainAffected} onChange={setDrain} /></div>
              <div class="ir-yn-row"><span class="ir-yn-label">Containment complete?</span><YNToggle value={containmentOk} onChange={setContain} /></div>
              <div class="ir-yn-row"><span class="ir-yn-label">EMA notification required?</span><YNToggle value={emaReqd} onChange={setEmaReqd} /></div>
            </div>
          </div>
        )}

        <div class="wz-section">
          <div class="wz-section-head"><i class="fas fa-folder-open" /> Evidence &amp; Uploads</div>
          <div class="wz-evidence-list">
            {([
              { label: 'Scene photographs',            note: 'Required before cleanup disturbance' },
              { label: 'Witness statements',           note: 'Operator and supervisor statements' },
              { label: 'Equipment / maintenance logs', note: 'Service records for involved plant' },
              { label: 'PTW / JSA documentation',      note: 'Permit and risk assessment copies' },
              ...(isEnv ? [{ label: 'EMA evidence file', note: 'Environmental closeout package' }] : []),
            ]).map(e => (
              <label class="wz-evidence-row" key={e.label}>
                <input type="checkbox" />
                <span><strong>{e.label}</strong><em>{e.note}</em></span>
              </label>
            ))}
          </div>
          <p class="ir-empty-note" style={{ marginTop: '10px' }}>File upload will be available after submission — attach documents to the created incident record.</p>
        </div>
      </div>
    );

    // Step 5: Review & Submit
    const missing: string[] = [];
    if (!incDate)              missing.push('Incident date');
    if (!description.trim())   missing.push('Incident description');
    if (isInjury && !classification) missing.push('OSH classification');
    if (people.some(p => !p.name.trim())) missing.push('Name for all people involved');

    return (
      <div class="wz-step-body">
        <div class="wz-section">
          <div class="wz-section-head"><i class="fas fa-list-check" /> Summary</div>
          <div class="wz-review-grid">
            {[
              ['Type',         type],
              ['Severity',     severity],
              ['Site',         site],
              ['Date',         incDate || '—'],
              ['Time',         incTime || '—'],
              ['Shift',        shift || '—'],
              ['Area',         area || '—'],
              ['Reporter',     repName || '—'],
              ['People involved', `${people.filter(p => p.name.trim()).length}`],
              ['Witnesses',    `${witnesses.filter(w => w.name.trim()).length}`],
              ...(isInjury ? [['OSH class', OSH_CLASSES.find(o => o.value === classification)?.label || '—']] : []),
              ...(isEnv    ? [['Spill type', spillType || '—']] : []),
            ].map(([k, v]) => (
              <div class="wz-review-row" key={k}>
                <span class="wz-review-key">{k}</span>
                <span class="wz-review-val">{v}</span>
              </div>
            ))}
          </div>
        </div>

        {missing.length > 0 && (
          <div class="wz-missing-banner">
            <i class="fas fa-circle-exclamation" /> <strong>Required fields missing:</strong>
            <ul>{missing.map(m => <li key={m}>{m}</li>)}</ul>
          </div>
        )}

        <div class="wz-section">
          <div class="wz-section-head"><i class="fas fa-route" /> Routing Preview</div>
          <div class="wz-route-chips">
            {routeTo.map((r, i) => (
              <div class="wz-route-chip" key={r}>
                <span class="wz-route-num">{i + 1}</span>
                <span>{r}</span>
              </div>
            ))}
          </div>
        </div>

        {errors.length > 0 && (
          <div class="ir-error-banner">
            {errors.map((e, i) => <div key={i}><i class="fas fa-circle-exclamation" /> {e}</div>)}
          </div>
        )}
      </div>
    );
  }

  // Side panel content per step
  function sideContent(): VNode {
    const SEV_BY_LABEL: Record<string, { icon: string; color: string }> = {
      'Critical': { icon: 'fa-triangle-exclamation', color: '#ef4444' },
      'High':     { icon: 'fa-circle-exclamation',   color: '#f97316' },
      'Medium':   { icon: 'fa-circle-info',           color: '#f59e0b' },
      'Low':      { icon: 'fa-circle-check',          color: '#60a5fa' },
    };
    const sevMeta  = SEV_BY_LABEL[severity] ?? { icon: 'fa-circle', color: '#94a3b8' };
    const typeIcon = TYPE_ICONS[type] ?? 'fa-triangle-exclamation';

    // Shared: state summary — clean 2×2 grid, no watermarks
    const stateCards = (
      <>
        <h4 style={{ display:'flex', alignItems:'center', gap:'7px', color:'rgba(255,255,255,.5)', fontSize:'0.62rem', fontWeight:600, textTransform:'uppercase', letterSpacing:'.07em', marginBottom:'6px' }}>
          <i class="fas fa-circle-dot" style={{ fontSize:'0.72rem' }} /> Record State
        </h4>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px', marginBottom:'4px' }}>
          {[
            { val: String(step + 1),  label: `of ${WIZARD_STEPS.length} steps`, color: '#fff'           },
            { val: 'Draft',           label: 'Status',                           color: 'rgba(255,255,255,.75)' },
            { val: type,              label: 'Type',                             color: 'rgba(255,255,255,.85)' },
            { val: severity,          label: 'Severity',                         color: sevMeta.color    },
          ].map(k => (
            <div key={k.label} style={{ padding:'10px', borderRadius:'10px', background:'rgba(255,255,255,.08)', textAlign:'center' }}>
              <div style={{ fontSize:'0.85rem', fontWeight: 'var(--font-weight-bold)', color:k.color, lineHeight:1.2 }}>{k.val}</div>
              <div style={{ fontSize:'0.6rem', color:'rgba(255,255,255,.45)', marginTop:'3px' }}>{k.label}</div>
            </div>
          ))}
        </div>
        <div style={{ borderTop:'1px solid rgba(255,255,255,.08)', margin:'4px 0 2px' }} />
      </>
    );

    // Shared: approval route preview
    const approvalRoute = (
      <div class="wz-side-panel">
        <div class="wz-side-head"><i class="fas fa-route" /> Approval Route</div>
        <div class="wz-approval-route">
          {routeTo.map((r, i) => (
            <div class="wz-approval-step" key={r}>
              <b>{r}</b>
              <span>{i === 0 ? 'Lead reviewer' : i === routeTo.length - 1 ? 'Final approver' : 'Reviewer'}</span>
              <span class={`wz-badge wz-badge--${i === 0 ? 'draft' : 'pending'}`}>{i === 0 ? 'Draft' : 'Pending'}</span>
            </div>
          ))}
        </div>
      </div>
    );

    if (step === 0) return (
      <>
        {stateCards}
        <div class="wz-side-panel">
          <div class="wz-side-head"><i class="fas fa-lightbulb" /> Classification Guide</div>
          <div class="wz-guide-list">
            {([
              ['Injury',            'Any physical harm to a person'],
              ['Near Miss',         'Potential harm — no injury occurred'],
              ['Unsafe Act',        'Behaviour breaching safe work rules'],
              ['Unsafe Condition',  'Physical hazard in the workplace'],
              ['Environmental',     'Spill, release or ecological impact'],
              ['Property Damage',   'Damage to equipment or infrastructure'],
            ] as [string, string][]).map(([t, d]) => (
              <div class="wz-guide-row" key={t}><strong>{t}</strong><span>{d}</span></div>
            ))}
          </div>
        </div>
      </>
    );

    if (step === 1) return (
      <>
        {stateCards}
        <div class="wz-side-panel">
          <div class="wz-side-head"><i class="fas fa-pen-to-square" /> Description Tips</div>
          <ul class="wz-tip-list">
            <li>State what, where, when, and who was involved</li>
            <li>Describe conditions immediately before the event</li>
            <li>Note contributing equipment or procedures</li>
            <li>Include environmental conditions (weather, lighting)</li>
            <li>Record facts and sequence — avoid assigning blame</li>
          </ul>
        </div>
        <div class="wz-side-panel">
          <div class="wz-side-head"><i class="fas fa-shield-halved" /> Controls Priority Order</div>
          <div class="wz-guide-list">
            {([
              ['1. Stop work',    'Prevent escalation immediately'],
              ['2. Isolate area', 'Secure scene for investigation'],
              ['3. First aid',    'Treat injured persons'],
              ['4. Notify chain', 'Supervisor → HSE → Management'],
            ] as [string, string][]).map(([t, d]) => (
              <div class="wz-guide-row" key={t}><strong>{t}</strong><span>{d}</span></div>
            ))}
          </div>
        </div>
      </>
    );

    if (step === 2) return (
      <>
        {stateCards}
        <div class="wz-side-panel">
          <div class="wz-side-head"><i class="fas fa-users" /> Who to Include</div>
          <ul class="wz-tip-list">
            <li>All persons present at or near the event</li>
            <li>Injured parties and their direct supervisor</li>
            <li>Contractors performing related work</li>
            <li>Witnesses who observed the event or conditions</li>
          </ul>
        </div>
        {isInjury && (
          <div class="wz-side-panel wz-side-panel--alert">
            <div class="wz-side-head"><i class="fas fa-gavel" /> OSH Classification</div>
            <div class="wz-guide-list">
              {OSH_CLASSES.map(o => (
                <div class="wz-guide-row" key={o.value}><strong>{o.label}</strong></div>
              ))}
            </div>
          </div>
        )}
      </>
    );

    if (step === 3) return (
      <>
        {stateCards}
        <div class="wz-side-panel">
          <div class="wz-side-head"><i class="fas fa-gears" /> Work Control Tips</div>
          <ul class="wz-tip-list">
            <li>Link all active permits within scope of the work</li>
            <li>Record equipment serial numbers and tag IDs</li>
            <li>LOTO records will be required during investigation</li>
            <li>Contractor information feeds the HSE–Finance handoff</li>
          </ul>
        </div>
        {approvalRoute}
      </>
    );

    if (step === 4) return (
      <>
        {stateCards}
        <div class="wz-side-panel wz-side-panel--alert">
          <div class="wz-side-head"><i class="fas fa-gavel" /> Statutory Deadlines</div>
          <div class="ir-osh-items">
            {[
              { deadline: 'Forthwith', desc: 'Notify Chief Inspector — death or critical injury (OSH Act s.46(1))' },
              { deadline: '48 hrs',    desc: 'Written notice to Chief Inspector in prescribed form (OSH Act s.46(1))' },
              { deadline: '4 days',    desc: 'Written notice — non-critical injury requiring medical attention (OSH Act s.46A)' },
              { deadline: '72 hrs',    desc: 'EMA notification for significant spill or release (Environmental Management Act)' },
              { deadline: '5 yrs',     desc: 'Accident register retained on site (OSH Act s.46(5))' },
            ].map(o => (
              <div class="ir-osh-item" key={o.deadline}>
                <span class="ir-osh-deadline">{o.deadline}</span>
                <span class="ir-osh-desc">{o.desc}</span>
              </div>
            ))}
          </div>
        </div>
        <div class="wz-side-panel">
          <div class="wz-side-head"><i class="fas fa-folder-open" /> Evidence Requirements</div>
          <ul class="wz-tip-list">
            <li>Photograph scene before any cleanup or recovery</li>
            <li>Preserve physical evidence (tools, PPE, materials)</li>
            <li>Secure CCTV footage immediately</li>
            <li>Collect witness statements while memories are fresh</li>
          </ul>
        </div>
      </>
    );

    // Step 5: Review
    return (
      <>
        {approvalRoute}
        <div class="wz-side-panel">
          <div class="wz-side-head"><i class="fas fa-diagram-project" /> What Happens Next</div>
          <div class="ir-next-steps">
            {[
              { icon: 'fa-file-circle-check', label: 'Record created',       note: 'Ref number auto-assigned' },
              { icon: 'fa-route',             label: 'Routed for review',    note: 'HSE Manager notified' },
              { icon: 'fa-magnifying-glass',  label: 'Investigation opens',  note: '5-Whys / RCA process' },
              { icon: 'fa-list-check',        label: 'CAPA raised',          note: 'Corrective actions assigned' },
              { icon: 'fa-circle-check',      label: 'Closed out',           note: 'Verified and audit-locked' },
            ].map(s => (
              <div class="ir-next-step" key={s.label}>
                <div class="ir-next-icon"><i class={`fas ${s.icon}`} /></div>
                <div><strong>{s.label}</strong><span>{s.note}</span></div>
              </div>
            ))}
          </div>
        </div>
        <div class="wz-side-panel">
          <div class="wz-side-head"><i class="fas fa-chart-bar" /> YTD by Type</div>
          <div class="ir-ytd-bars">
            {[
              { label: 'Near Miss',        count: 9,  color: '#f59e0b' },
              { label: 'Unsafe Condition', count: 6,  color: '#60a5fa' },
              { label: 'Injury',           count: 4,  color: '#ef4444' },
              { label: 'Unsafe Act',       count: 3,  color: '#a78bfa' },
              { label: 'Environmental',    count: 2,  color: '#34d399' },
              { label: 'Property Damage',  count: 1,  color: '#94a3b8' },
            ].map(b => {
              const pct = Math.round((b.count / 25) * 100);
              return (
                <div key={b.label} class="ir-ytd-bar-row">
                  <div class="ir-ytd-bar-label"><span>{b.label}</span><span style={{ color: b.color, fontWeight: 'var(--font-weight-bold)' }}>{b.count}</span></div>
                  <div class="ir-ytd-bar-track"><div class="ir-ytd-bar-fill" style={{ width: `${pct}%`, background: b.color }} /></div>
                </div>
              );
            })}
          </div>
        </div>
      </>
    );
  }

  if (!open) return <></>;

  const isLast = step === WIZARD_STEPS.length - 1;

  return (
    <div class="wz-backdrop" onClick={e => { if ((e.target as HTMLElement).classList.contains('wz-backdrop')) onClose(); }}>
      <div class="wz-modal" role="dialog" aria-modal="true" aria-label="Report Incident Wizard">

        {/* ── Wizard header ── */}
        <div class="wz-header">
          <div class="wz-header-left">
            <div class="wz-header-icon"><i class="fas fa-triangle-exclamation" /></div>
            <div>
              <div class="wz-header-title">Report Incident</div>
              <div class="wz-header-sub">Incident reporting, investigation, corrective actions, HR impact, and regulatory closeout.</div>
            </div>
          </div>
          <button class="wz-close" onClick={onClose} aria-label="Close"><i class="fas fa-xmark" /></button>
        </div>

        {/* ── Step bar — card-per-step (erp-suite wizard-steps pattern) ── */}
        <div class="wz-step-bar">
          {WIZARD_STEPS.map((s, i) => (
            <div
              key={i}
              class={`wz-step-tab${i === step ? ' active' : i < step ? ' done' : ''}`}
              onClick={() => { if (i < step) { setErrors([]); setStep(i); } }}
            >
              <b class="wz-step-num">{i < step ? <i class="fas fa-check" style={{ fontSize: '0.6rem' }} /> : i + 1}</b>
              <strong class="wz-step-tab-label">{s.label}</strong>
              <span class="wz-step-tab-sub">{s.sub}</span>
            </div>
          ))}
        </div>

        {/* ── Body: main + side ── */}
        <div class="wz-body">
          <div class="wz-main">
            {errors.length > 0 && step !== 5 && (
              <div class="wz-missing-banner" style={{ marginBottom: '12px' }}>
                <strong><i class="fas fa-circle-exclamation" /> Required to continue</strong>
                <ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
              </div>
            )}
            {stepContent()}
          </div>
          <aside class="wz-side">
            {sideContent()}
          </aside>
        </div>

        {/* ── Footer ── */}
        <div class="wz-footer">
          <button class="hse-btn" onClick={onClose}><i class="fas fa-xmark" /> Cancel</button>
          <div class="wz-footer-nav">
            {step > 0 && (
              <button class="hse-btn" onClick={back}><i class="fas fa-arrow-left" /> Back</button>
            )}
            {!isLast && (
              <button class="hse-btn primary" onClick={next}>Next <i class="fas fa-arrow-right" /></button>
            )}
            {isLast && (
              <button class="hse-btn primary" onClick={submit} disabled={submitting}>
                {submitting
                  ? <><i class="fas fa-spinner fa-spin" /> Submitting…</>
                  : <><i class="fas fa-paper-plane" /> Submit Incident Report</>}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Investigations tab ────────────────────────────────────────────────────────

const INV_STAGES = [
  { label: 'Scene documented',     icon: 'fa-camera' },
  { label: 'Evidence collected',   icon: 'fa-folder-open' },
  { label: 'Witness statements',   icon: 'fa-comments' },
  { label: '5-Whys / RCA',         icon: 'fa-sitemap' },
  { label: 'Root cause confirmed', icon: 'fa-bullseye' },
  { label: 'CAPA raised',          icon: 'fa-list-check' },
  { label: 'Verification',         icon: 'fa-circle-check' },
] as const;

const RCA_CATEGORIES = [
  'Procedure gap', 'Training / Competency', 'Supervision',
  'Equipment / Maintenance', 'PPE', 'Work Planning',
  'Permit Control', 'Housekeeping', 'Human Factors',
] as const;

const INV_TABS = ['Progress', 'Overview', 'Evidence', '5-Whys', 'Root Cause', 'CAPA', 'Closeout'] as const;

function InvestigationsTab({ investigations, capa }: { investigations: Investigation[]; capa: CapaItem[] }): VNode {
  const [selected,    setSelected]    = useState<Investigation | null>(null);
  const [invTab,      setInvTab]      = useState<typeof INV_TABS[number]>('Overview');
  const [whyDraft,    setWhyDraft]    = useState<Array<{ why: string; because: string }>>([]);
  const [rootCause,   setRootCause]   = useState('');
  const [rcaCat,      setRcaCat]      = useState('');
  const [capaOpen,    setCapaOpen]    = useState(false);
  const [saving,      setSaving]      = useState(false);

  const updateInv  = useUpdateInvestigation();
  const createCapa = useCreateCapa();

  function openInv(inv: Investigation) {
    setSelected(inv);
    setInvTab('Overview');
    setWhyDraft(inv.whys.map(w => {
      const parts = w.split(' → ');
      return { why: parts[0] ?? '', because: parts[1] ?? '' };
    }));
    setRootCause(inv.rootCause === '(Not yet recorded)' ? '' : inv.rootCause);
    setRcaCat(inv.rcaCategory ?? '');
  }

  async function saveWhys() {
    if (!selected?.id) return;
    setSaving(true);
    try {
      // Serialise the 5-Whys chain into the investigation's findings text and
      // record the confirmed root cause as the summary.
      const findingsText = whyDraft
        .filter(w => w.why.trim())
        .map((w, idx) => `${idx + 1}. ${w.why}${w.because ? ` → ${w.because}` : ''}`)
        .join('\n');
      await updateInv.mutateAsync({
        investigationId: selected.id,
        findings:        findingsText || null,
        summary:         rootCause || null,
        status:          rootCause ? 'closed' : 'root_cause',
      });
    } finally { setSaving(false); }
  }

  const linkedCapa = selected ? capa.filter(c => c.source === selected.incidentRef) : [];

  return (
    <div>

      {/* ── Register ── */}
      <div class="hse-table-card">
        <div class="hse-table-card-top">
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px' }}>
            <div class="vt-section-titlewrap">
              <span class="vt-section-icon"><i class="fas fa-magnifying-glass-chart" /></span>
              <div>
                <div class="vt-section-title">Investigation Register</div>
                <div class="vt-section-sub">All active investigations · click any row to open workspace</div>
              </div>
            </div>
            <div style={{ display:'flex', gap:'8px', flexShrink:0 }}>
              <button class="inc-action-btn blue" onClick={() => exportCsv(investigations, [
                { header: 'Ref',           value: v => v.ref },
                { header: 'Incident',      value: v => v.incidentRef },
                { header: 'Severity',      value: v => SEVERITY_META[v.severity]?.label ?? v.severity },
                { header: 'Method',        value: v => v.method },
                { header: 'Lead',          value: v => v.lead },
                { header: 'Evidence',      value: v => `${v.evidenceDone}/${v.evidenceTotal}` },
                { header: 'Root Cause',    value: v => v.rcaCategory || v.rootCause },
                { header: 'CAPA Count',    value: v => v.capaCount },
                { header: 'Status',        value: v => v.status },
                { header: 'Due',           value: v => v.due },
              ], 'investigation-register')}><i class="fas fa-download" /> Export</button>
            </div>
          </div>
          <div class="vt-toolbar" style={{ marginBottom:0, marginTop:'12px' }}>
            <div class="vt-search" style={{ flex:'1 1 220px' }}>
              <i class="fas fa-search" />
              <input type="search" placeholder="Search ref, incident, lead…" />
            </div>
            <select class="emp-filter-select">
              <option>All methods</option>
              <option>5-Whys</option>
              <option>RCA</option>
              <option>Fishbone</option>
            </select>
            <select class="emp-filter-select">
              <option>All statuses</option>
              <option>Open</option>
              <option>In Review</option>
              <option>Closed</option>
            </select>
          </div>
        </div>
        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead>
              <tr>
                <th>Ref</th><th>Incident</th><th>Sev</th><th>Method</th>
                <th>Lead</th><th>Evidence</th><th>Root Cause</th>
                <th>CAPA</th><th>Status</th><th>Due</th>
              </tr>
            </thead>
            <tbody>
              {investigations.map(inv => {
                const sev   = SEVERITY_META[inv.severity];
                const evPct = inv.evidenceTotal > 0 ? Math.round((inv.evidenceDone / inv.evidenceTotal) * 100) : 0;
                return (
                  <tr key={inv.ref} onClick={() => openInv(inv)} style={{ cursor: 'pointer' }}
                    class={selected?.ref === inv.ref ? 'selected' : ''}>
                    <td><span class="vt-cell-mono">{inv.ref}</span></td>
                    <td>
                      <div style={{ fontSize:'0.76rem', fontWeight:600, color:'var(--text-primary)' }}>{inv.incidentRef}</div>
                      <div style={{ fontSize:'0.67rem', color:'var(--text-muted)', maxWidth:'180px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{inv.incidentDesc}</div>
                    </td>
                    <td>
                      <span style={{ display:'inline-flex', alignItems:'center', gap:'4px', fontSize:'0.7rem', fontWeight: 'var(--font-weight-bold)', color: sev?.color }}>
                        <i class={`fas ${sev?.icon}`} style={{ fontSize:'0.6rem' }} /> {sev?.label ?? inv.severity}
                      </span>
                    </td>
                    <td style={{ color:'var(--text-muted)', fontSize:'0.76rem' }}>{inv.method}</td>
                    <td style={{ color:'var(--text-muted)', fontSize:'0.76rem' }}>{inv.lead}</td>
                    <td>
                      <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                        <div style={{ flex:1, height:'4px', background:'var(--border)', borderRadius:'99px' }}>
                          <div style={{ width:`${evPct}%`, height:'100%', background: evPct===100 ? '#4ade80' : '#60a5fa', borderRadius:'99px' }} />
                        </div>
                        <span style={{ fontSize:'0.67rem', color:'var(--text-muted)', whiteSpace:'nowrap' }}>{inv.evidenceDone}/{inv.evidenceTotal}</span>
                      </div>
                    </td>
                    <td>
                      {inv.rcaCategory
                        ? <span style={{ fontSize:'0.7rem', color:'var(--text-primary)', fontWeight:500 }}>{inv.rcaCategory}</span>
                        : <span style={{ fontSize:'0.7rem', color:'var(--text-muted)' }}>Pending</span>}
                    </td>
                    <td>
                      {inv.capaCount > 0
                        ? <span class="vt-pill is-info">{inv.capaCount} action{inv.capaCount > 1 ? 's' : ''}</span>
                        : <span style={{ fontSize:'0.7rem', color:'var(--text-muted)' }}>—</span>}
                    </td>
                    <td><span class={hsePill(inv.status)}>{inv.status}</span></td>
                    <td style={{ color:'var(--text-muted)', fontSize:'0.76rem', whiteSpace:'nowrap' }}>{inv.due}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>{/* /hse-table-card */}

      {/* ── Investigation drawer ── */}
      <div class={`hse-drawer-backdrop${selected ? ' show' : ''}`} onClick={() => setSelected(null)} />
      <aside class={`hse-drawer inv-drawer${selected ? ' show' : ''}`} role="dialog" aria-modal="true" aria-hidden={!selected}>
        {selected && (() => {
          const sev = SEVERITY_META[selected.severity] ?? SEVERITY_META.info;
          const evPct = selected.evidenceTotal > 0 ? Math.round((selected.evidenceDone / selected.evidenceTotal) * 100) : 0;
          return (
            <>
              {/* ── Hero (matches IncidentDrawer) ── */}
              <div class="hse-idrawer-hero">
                <div class="hse-idrawer-hero-left">
                  <div class="hse-idrawer-type-chip" style={{ background: sev?.bg }}>
                    <i class="fas fa-magnifying-glass-chart" style={{ color: sev?.color }} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div class="hse-idrawer-ref">{selected.ref}</div>
                    <div class="hse-idrawer-type">{selected.incidentRef} · <span style={{ opacity: .6 }}>{selected.method}</span></div>
                  </div>
                </div>
                <div class="hse-idrawer-hero-right">
                  <div class="hse-idrawer-sev-badge" style={{ background: sev?.bg, color: sev?.color }}>
                    <i class={`fas ${sev?.icon}`} /> {sev?.label}
                  </div>
                </div>
              </div>

              {/* ── Info grid (same as incident drawer) ── */}
              <div class="hse-idrawer-grid inv-meta-grid">
                <div class="hse-idrawer-cell"><i class="fas fa-circle-dot" /><span>Status</span><strong><span class={hsePill(selected.status)}>{selected.status}</span></strong></div>
                <div class="hse-idrawer-cell"><i class="fas fa-user-tie" /><span>Lead</span><strong>{selected.lead}</strong></div>
                <div class="hse-idrawer-cell"><i class="fas fa-calendar-day" /><span>Due Date</span><strong>{selected.due}</strong></div>
                <div class="hse-idrawer-cell"><i class="fas fa-sitemap" /><span>Method</span><strong>{selected.method}</strong></div>
              </div>

              {/* ── Tab bar ── */}
              <div class="inv-tab-bar">
                {INV_TABS.map(t => (
                  <button key={t} class={`inv-tab${invTab === t ? ' active' : ''}`} onClick={() => setInvTab(t)}>{t}</button>
                ))}
              </div>

              {/* ── Scrollable body ── */}
              <div class="inv-drawer-body">

                {/* Progress — vertical rail */}
                {invTab === 'Progress' && (
                  <div class="inv-tab-content">
                    <div class="inv-rail">
                      {INV_STAGES.map((s, idx) => {
                        const done   = idx < selected.stage;
                        const active = idx === selected.stage;
                        const last   = idx === INV_STAGES.length - 1;
                        return (
                          <div key={s.label} class="inv-rail-step">
                            <div class="inv-rail-col">
                              <div class={`inv-rail-dot${done ? ' done' : active ? ' active' : ''}`}>
                                {done ? <i class="fas fa-check" /> : <span>{idx + 1}</span>}
                              </div>
                              {!last && <div class={`inv-rail-line${done ? ' done' : ''}`} />}
                            </div>
                            <div class="inv-rail-body">
                              <div class={`inv-rail-lbl${active ? ' active' : done ? ' done' : ' pend'}`}>{s.label}</div>
                              {done   && <div class="inv-rail-sub">Completed</div>}
                              {active && <div class="inv-rail-sub" style={{ color:'var(--siomac-navy)', fontWeight:600 }}>In progress</div>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Overview */}
                {invTab === 'Overview' && (
                  <div class="inv-tab-content">
                    <div class="inv-stat-row">
                      <div class="inv-stat-cell">
                        <div class="inv-stat-val">{selected.evidenceDone}/{selected.evidenceTotal}</div>
                        <div class="inv-stat-key">Evidence</div>
                        <div class="inv-stat-bar"><div style={{ width:`${evPct}%`, background: evPct === 100 ? '#4ade80' : '#60a5fa' }} /></div>
                      </div>
                      <div class="inv-stat-cell">
                        <div class="inv-stat-val">{selected.capaCount}</div>
                        <div class="inv-stat-key">CAPAs raised</div>
                      </div>
                      <div class="inv-stat-cell">
                        <div class="inv-stat-val" style={{ fontSize:'0.85rem' }}>{selected.rcaCategory || '—'}</div>
                        <div class="inv-stat-key">Root cause</div>
                      </div>
                    </div>
                    <div class="inv-field-block">
                      <div class="inv-field-label"><i class="fas fa-triangle-exclamation" /> Problem Statement</div>
                      <div class="inv-field-text">{selected.incidentDesc}</div>
                    </div>
                    <div class="inv-field-block">
                      <div class="inv-field-label"><i class="fas fa-shield-halved" /> Immediate Controls</div>
                      <div class="inv-field-text" style={{ color:'var(--text-muted)' }}>Area secured, work stopped pending investigation.</div>
                    </div>
                    {selected.regulatory.length > 0 && (
                      <div class="inv-alert-block">
                        <div class="inv-field-label"><i class="fas fa-scale-balanced" /> Regulatory Notifications</div>
                        {selected.regulatory.map(r => (
                          <div class="inv-alert-row" key={r}><i class="fas fa-gavel" />{r}</div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Evidence */}
                {invTab === 'Evidence' && (
                  <div class="inv-tab-content">
                    <div class="inv-field-label" style={{ marginBottom:'10px' }}><i class="fas fa-folder-open" /> Evidence Checklist</div>
                    {[
                      { label: 'Scene photographs',             done: true,  icon: 'fa-camera' },
                      { label: 'Witness statement',             done: selected.witnesses.length > 0, icon: 'fa-comments' },
                      { label: 'PTW / JSA copies',              done: true,  icon: 'fa-file-shield' },
                      { label: 'Equipment maintenance records', done: true,  icon: 'fa-gears' },
                      { label: 'Cleanup / disposal manifest',   done: false, icon: 'fa-trash-arrow-up' },
                    ].map(e => (
                      <div class={`inv-check-row${e.done ? ' done' : ''}`} key={e.label}>
                        <i class={`fas ${e.done ? 'fa-circle-check' : 'fa-circle'}`} />
                        <i class={`fas ${e.icon} inv-check-icon`} />
                        <span>{e.label}</span>
                        {e.done ? <span class="inv-badge inv-badge--ok">Collected</span> : <span class="inv-badge">Pending</span>}
                      </div>
                    ))}
                    {selected.witnesses.length > 0 && (
                      <>
                        <div class="inv-field-label" style={{ marginTop:'16px', marginBottom:'8px' }}><i class="fas fa-users" /> Witnesses</div>
                        {selected.witnesses.map(w => (
                          <div class="inv-check-row done" key={w}>
                            <i class="fas fa-circle-check" />
                            <i class="fas fa-user inv-check-icon" />
                            <span>{w}</span>
                            <span class="inv-badge inv-badge--ok">Statement taken</span>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}

                {/* 5-Whys */}
                {invTab === '5-Whys' && (
                  <div class="inv-tab-content">
                    <div class="inv-problem-stmt"><span>Problem:</span> {selected.incidentDesc}</div>
                    <div class="inv-why-chain">
                      {whyDraft.map((w, i) => (
                        <div class="inv-why-row" key={i}>
                          <div class="inv-why-num">{i + 1}</div>
                          <div class="inv-why-fields">
                            <input type="text" class="hse-input" placeholder={`Why ${i + 1}…`} value={w.why}
                              onInput={e => setWhyDraft(d => d.map((x, j) => j === i ? { ...x, why: (e.target as HTMLInputElement).value } : x))} />
                            <input type="text" class="hse-input inv-because" placeholder="Because…" value={w.because}
                              onInput={e => setWhyDraft(d => d.map((x, j) => j === i ? { ...x, because: (e.target as HTMLInputElement).value } : x))} />
                          </div>
                          <button class="hse-btn-icon-remove" onClick={() => setWhyDraft(d => d.filter((_, j) => j !== i))}>
                            <i class="fas fa-xmark" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div style={{ display:'flex', gap:'8px', marginTop:'12px' }}>
                      <button class="hse-btn" onClick={() => setWhyDraft(d => [...d, { why:'', because:'' }])}><i class="fas fa-plus" /> Add Why</button>
                      <button class="hse-btn primary" onClick={saveWhys} disabled={saving} style={{ marginLeft:'auto' }}>
                        {saving ? <><i class="fas fa-spinner fa-spin" /> Saving…</> : <><i class="fas fa-floppy-disk" /> Save</>}
                      </button>
                    </div>
                  </div>
                )}

                {/* Root Cause */}
                {invTab === 'Root Cause' && (
                  <div class="inv-tab-content">
                    <div class="inv-field-label" style={{ marginBottom:'8px' }}><i class="fas fa-bullseye" /> Root Cause Category</div>
                    <div class="inv-rca-cats">
                      {RCA_CATEGORIES.map(c => (
                        <button key={c} class={`inv-rca-cat${rcaCat === c ? ' active' : ''}`} onClick={() => setRcaCat(c)}>{c}</button>
                      ))}
                    </div>
                    <div class="inv-field-label" style={{ marginTop:'16px', marginBottom:'6px' }}><i class="fas fa-file-lines" /> Root Cause Statement</div>
                    <textarea class="hse-input" rows={4} style={{ width:'100%', resize:'vertical' }}
                      placeholder="Describe the confirmed root cause…"
                      value={rootCause} onInput={e => setRootCause((e.target as HTMLTextAreaElement).value)} />
                    <button class="hse-btn primary" style={{ marginTop:'10px' }} onClick={saveWhys} disabled={saving}>
                      {saving ? <><i class="fas fa-spinner fa-spin" /> Saving…</> : <><i class="fas fa-circle-check" /> Confirm Root Cause</>}
                    </button>
                  </div>
                )}

                {/* CAPA */}
                {invTab === 'CAPA' && (
                  <div class="inv-tab-content">
                    {linkedCapa.length === 0
                      ? <div class="inv-empty"><i class="fas fa-list-check" /><span>No CAPA items linked yet.</span></div>
                      : linkedCapa.map(c => (
                          <div class="inv-capa-card" key={c.ref}>
                            <div class="inv-capa-card-top">
                              <span class="vt-cell-mono">{c.ref}</span>
                              <span class={hsePill(c.status)}>{c.status}</span>
                            </div>
                            <div class="inv-capa-card-title">{c.title}</div>
                            <div class="inv-capa-card-meta">
                              <span><i class="fas fa-user" /> {c.owner}</span>
                              <span><i class="fas fa-calendar-day" /> {c.due}</span>
                            </div>
                            <button class="hse-btn" style={{ marginTop:'8px', fontSize:'0.72rem' }}>
                              <i class="fas fa-circle-check" /> Verify
                            </button>
                          </div>
                        ))
                    }
                  </div>
                )}

                {/* Closeout */}
                {invTab === 'Closeout' && (
                  <div class="inv-tab-content">
                    <div class="inv-field-label" style={{ marginBottom:'10px' }}><i class="fas fa-circle-check" /> Closeout Checklist</div>
                    {[
                      { label: 'Investigation summary written', done: !!selected.rootCause },
                      { label: 'Root cause confirmed',          done: !!selected.rcaCategory },
                      { label: 'CAPA items raised',             done: selected.capaCount > 0 },
                      { label: 'CAPA accepted by owner',        done: false },
                      { label: 'Evidence pack complete',        done: selected.evidenceDone >= selected.evidenceTotal },
                      { label: 'HSE Manager approval received', done: false },
                    ].map(c => (
                      <div class={`inv-check-row${c.done ? ' done' : ''}`} key={c.label}>
                        <i class={`fas ${c.done ? 'fa-circle-check' : 'fa-circle'}`} />
                        <span>{c.label}</span>
                      </div>
                    ))}
                    <button class="hse-btn primary" style={{ marginTop:'16px', width:'100%' }} disabled>
                      <i class="fas fa-lock" /> Submit for HSE Manager Approval
                    </button>
                  </div>
                )}

              </div>

              {/* ── Footer ── */}
              <div class="inv-drawer-foot">
                <button class="hse-btn primary" onClick={() => setCapaOpen(true)}><i class="fas fa-plus" /> Raise CAPA</button>
                <button class="hse-btn" style={{ marginLeft:'auto' }}>
                  <i class="fas fa-paper-plane" /> Submit Review
                </button>
                <button class="hse-btn" onClick={() => setSelected(null)}>Close</button>
              </div>
            </>
          );
        })()}
      </aside>

      <CreateCapaModal
        open={capaOpen}
        sourceRef={selected?.incidentRef ?? ''}
        sourceType="incident"
        onClose={() => setCapaOpen(false)}
        createCapa={createCapa}
      />
    </div>
  );
}

// ── CAPA tab ──────────────────────────────────────────────────────────────────

function CapaTab({ capa, closurePct, avgDaysToClose }: { capa: CapaItem[]; closurePct: number; avgDaysToClose: number }): VNode {
  const [search,     setSearch]  = useState('');
  const [statFilter, setStat]    = useState('All statuses');
  const [priFilter,  setPri]     = useState('All priorities');
  const [verifyOpen, setVerify]  = useState(false);
  const [verifyItem, setVerifyItem] = useState<CapaItem | null>(null);
  const [newCapaOpen, setNewCapa] = useState(false);

  const createCapa = useCreateCapa();
  const updateCapa = useUpdateCapa();

  const overdue = capa.filter(c => /overdue/i.test(c.status));

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return capa.filter(c => {
      if (q && !c.ref.toLowerCase().includes(q) && !c.title.toLowerCase().includes(q) && !c.owner.toLowerCase().includes(q)) return false;
      if (statFilter !== 'All statuses'   && !c.status.toLowerCase().includes(statFilter.toLowerCase())) return false;
      if (priFilter  !== 'All priorities' && !priLabel(c.priority).toLowerCase().includes(priFilter.toLowerCase())) return false;
      return true;
    });
  }, [capa, search, statFilter, priFilter]);

  return (
    <div>

      {/* ── CAPA register ── */}
      <div class="vt-table-card">
        <div class="hse-table-card-top">
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px' }}>
            <div class="vt-section-titlewrap">
              <span class="vt-section-icon"><i class="fas fa-list-check" /></span>
              <div>
                <div class="vt-section-title">CAPA Register</div>
                <div class="vt-section-sub">Corrective &amp; preventive actions · click a row to view details</div>
              </div>
            </div>
            <div style={{ display:'flex', gap:'8px', flexShrink:0 }}>
              <button class="inc-action-btn secondary" onClick={() => setNewCapa(true)}><i class="fas fa-plus" /> Raise CAPA</button>
              <button class="inc-action-btn blue" onClick={() => exportCsv(filtered, [
                { header: 'Ref',       value: c => c.ref },
                { header: 'Action',    value: c => c.title },
                { header: 'Source',    value: c => c.source },
                { header: 'Priority',  value: c => priLabel(c.priority) },
                { header: 'Owner',     value: c => c.owner },
                { header: 'Due',       value: c => c.due },
                { header: 'Status',    value: c => c.status },
              ], 'capa-register')}><i class="fas fa-download" /> Export</button>
            </div>
          </div>
          <div class="vt-toolbar" style={{ marginBottom:0, marginTop:'12px' }}>
            <div class="vt-search" style={{ flex:'1 1 180px' }}>
              <i class="fas fa-search" />
              <input type="search" placeholder="Search ref, action, owner…" value={search}
                onInput={e => setSearch((e.target as HTMLInputElement).value)} />
            </div>
            <select class="emp-filter-select" value={statFilter} onChange={e => setStat((e.target as HTMLSelectElement).value)}>
              <option>All statuses</option>
              {['Open', 'In Progress', 'Overdue', 'Closed', 'Verified'].map(s => <option key={s}>{s}</option>)}
            </select>
            <select class="emp-filter-select" value={priFilter} onChange={e => setPri((e.target as HTMLSelectElement).value)}>
              <option>All priorities</option>
              {['Critical', 'High', 'Medium', 'Low'].map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
        </div>
        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead>
              <tr>
                <th style={{ width:'88px' }}>Ref</th>
                <th>Action</th>
                <th style={{ width:'100px' }}>Source</th>
                <th style={{ width:'78px' }}>Priority</th>
                <th style={{ width:'120px' }}>Owner</th>
                <th style={{ width:'86px' }}>Due</th>
                <th style={{ width:'82px' }}>Evidence</th>
                <th style={{ width:'92px' }}>Verification</th>
                <th style={{ width:'88px' }}>Status</th>
                <th style={{ width:'65px' }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={10} style={{ textAlign:'center', color:'var(--text-muted)', padding:'28px' }}>No CAPA items match the current filters.</td></tr>
              ) : filtered.map((c: CapaItem) => {
                const isOverdue = /overdue/i.test(c.status);
                const evStatus  = /pending|evidence/i.test(c.status) ? 'Pending' : /closed|verified/i.test(c.status) ? 'Complete' : 'Missing';
                const evColor   = evStatus === 'Complete' ? '#16a34a' : evStatus === 'Pending' ? '#d97706' : '#ef4444';
                const verStatus = /verified/i.test(c.status) ? 'Verified' : /ready|complete/i.test(c.status) ? 'Ready' : 'Required';
                const verColor  = verStatus === 'Verified' ? '#16a34a' : verStatus === 'Ready' ? '#2563eb' : 'var(--text-muted)';
                return (
                  <tr key={c.ref}>
                    <td><span class="vt-cell-mono">{c.ref}</span></td>
                    <td><span class="vt-cell-name" style={{ fontWeight:500 }}>{c.title}</span></td>
                    <td><span style={{ fontSize:'0.72rem', color:'var(--text-muted)' }}>{c.source}</span></td>
                    <td>
                      <span class={`vt-pill ${c.priority === 'danger' ? 'is-off' : c.priority === 'warning' ? 'is-warn' : 'is-info'}`}>
                        {priLabel(c.priority)}
                      </span>
                    </td>
                    <td style={{ color:'var(--text-muted)', fontSize:'0.78rem' }}>{c.owner}</td>
                    <td>
                      <span style={{ color: isOverdue ? 'var(--siomac-red)' : 'inherit', fontWeight: isOverdue ? 600 : 400, fontSize:'0.78rem' }}>
                        {c.due}
                      </span>
                    </td>
                    <td><span style={{ fontSize:'0.72rem', fontWeight:600, color: evColor }}>{evStatus}</span></td>
                    <td><span style={{ fontSize:'0.72rem', fontWeight:600, color: verColor }}>{verStatus}</span></td>
                    <td><span class={hsePill(c.status)}>{c.status}</span></td>
                    <td>
                      {!/closed|verified/i.test(c.status) && (
                        <button class="hse-btn" style={{ padding:'3px 10px', fontSize:'0.72rem' }}
                          onClick={() => { setVerifyItem(c); setVerify(true); }}>
                          <i class="fas fa-circle-check" /> Verify
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding:'8px 16px', borderTop:'1px solid var(--border)', fontSize:'0.72rem', color:'var(--text-muted)' }}>
          Showing {filtered.length} of {capa.length} actions
        </div>
      </div>

      {verifyItem && (
        <CapaVerifyModal
          open={verifyOpen}
          item={verifyItem}
          onClose={() => { setVerify(false); setVerifyItem(null); }}
          onVerify={async (_note) => {
            if (!verifyItem.id) return;
            // Verification closes the CAPA and records effectiveness.
            await updateCapa.mutateAsync({
              capaId:              verifyItem.id,
              status:              'closed',
              effectivenessResult: 'effective',
            });
            setVerify(false); setVerifyItem(null);
          }}
        />
      )}

      <CreateCapaModal
        open={newCapaOpen}
        sourceRef=""
        sourceType="audit"
        onClose={() => setNewCapa(false)}
        createCapa={createCapa}
      />
    </div>
  );
}

function priLabel(p: string): string {
  return p === 'danger' ? 'Critical' : p === 'warning' ? 'High' : p === 'info' ? 'Medium' : 'Low';
}

// ── Shared modals ─────────────────────────────────────────────────────────────

const CAPA_STEPS = ['Action', 'Source', 'Ownership', 'Verification'] as const;
type CapaStep = typeof CAPA_STEPS[number];

function CreateCapaModal({ open, sourceRef, sourceType, onClose, createCapa }: {
  open: boolean; sourceRef: string; sourceType: string; onClose: () => void;
  createCapa: ReturnType<typeof useCreateCapa>;
}): VNode | null {
  const [step,        setStep]       = useState<CapaStep>('Action');
  const [title,       setTitle]      = useState('');
  const [desc,        setDesc]       = useState('');
  const [capaType,    setCapaType]   = useState<'corrective'|'preventive'|'containment'>('corrective');
  const [priority,    setPriority]   = useState<'critical'|'high'|'medium'|'low'>('medium');
  const [linkedRef,   setLinkedRef]  = useState(sourceRef);
  const [linkedType,  setLinkedType] = useState(sourceType || 'incident');
  const [rootCauseCat,setRootCause]  = useState('');
  const [owner,       setOwner]      = useState('');
  const [dept,        setDept]       = useState('');
  const [due,         setDue]        = useState('');
  const [evidenceReq, setEvidReq]    = useState<string[]>([]);
  const [verifier,    setVerifier]   = useState('');
  const [verRequired, setVerReq]     = useState(true);
  const [saving,      setSaving]     = useState(false);

  if (!open) return null;

  const stepIdx = CAPA_STEPS.indexOf(step);
  const isLast  = stepIdx === CAPA_STEPS.length - 1;

  function toggleEvidence(val: string) {
    setEvidReq(prev => prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]);
  }

  function canAdvance(): boolean {
    if (step === 'Action')    return title.trim().length > 0;
    if (step === 'Ownership') return due.length > 0;
    return true;
  }

  function handleClose() {
    setStep('Action');
    setTitle(''); setDesc(''); setCapaType('corrective'); setPriority('medium');
    setLinkedRef(sourceRef); setLinkedType(sourceType || 'incident'); setRootCause('');
    setOwner(''); setDept(''); setDue(''); setEvidReq([]); setVerifier(''); setVerReq(true);
    onClose();
  }

  async function submit() {
    if (!title.trim() || !due) return;
    setSaving(true);
    const descBlock = [
      desc,
      `CAPA Type: ${capaType}`,
      rootCauseCat ? `Root Cause Category: ${rootCauseCat}` : '',
      dept ? `Department/Site: ${dept}` : '',
      verRequired ? `Verification Required: Yes · Verifier: ${verifier || 'TBD'}` : 'Verification Required: No',
      evidenceReq.length ? `Evidence Required: ${evidenceReq.join(', ')}` : '',
    ].filter(Boolean).join('\n');
    try {
      await createCapa.mutateAsync({
        sourceType:  linkedType,
        sourceId:    linkedRef || 'MANUAL',
        title,
        description: descBlock,
        ownerUserId: owner || null,
        dueAt:       due,
        priority,
      });
      handleClose();
    } finally { setSaving(false); }
  }

  const SLA_DAYS: Record<string, number> = { critical: 3, high: 7, medium: 14, low: 30 };
  function applySlaDue() {
    const d = new Date();
    d.setDate(d.getDate() + (SLA_DAYS[priority] ?? 14));
    setDue(d.toISOString().slice(0, 10));
  }

  return (
    <>
      <div class="hse-modal-backdrop show" onClick={handleClose} />
      <section class="hse-modal capa-wizard show" role="dialog" aria-modal="true">

        {/* ── Wizard header ── */}
        <div class="capa-wizard-head">
          <div class="capa-wizard-title">
            <i class="fas fa-list-check" />
            <div>
              <h3>Raise CAPA</h3>
              <p>{linkedRef ? `Linked to ${linkedRef}` : 'Standalone corrective / preventive action'}</p>
            </div>
          </div>
          <button class="hse-icon-btn" onClick={handleClose} aria-label="Close"><i class="fas fa-xmark" /></button>
        </div>

        {/* ── Step rail ── */}
        <div class="capa-wizard-rail">
          {CAPA_STEPS.map((s, i) => (
            <div key={s} class={`capa-wizard-step${s === step ? ' active' : i < stepIdx ? ' done' : ''}`}>
              <div class="capa-wizard-step-dot">
                {i < stepIdx ? <i class="fas fa-check" /> : <span>{i + 1}</span>}
              </div>
              <span>{s}</span>
            </div>
          ))}
        </div>

        {/* ── Step bodies ── */}
        <div class="capa-wizard-body">

          {step === 'Action' && (
            <div class="capa-wizard-cols">
              <div class="capa-wizard-col">
                <Field label="Action title *" wide>
                  <TextInput value={title} onInput={setTitle} placeholder="What corrective action is required?" />
                </Field>
                <Field label="Description" wide>
                  <TextareaInput value={desc} onInput={setDesc} placeholder="Describe the action in detail, expected outcomes, and acceptance criteria…" />
                </Field>
              </div>
              <div class="capa-wizard-col">
                <Field label="CAPA type">
                  <select class="hse-select-input" value={capaType} onChange={e => setCapaType((e.target as HTMLSelectElement).value as typeof capaType)}>
                    <option value="corrective">Corrective — fix the root cause</option>
                    <option value="preventive">Preventive — stop recurrence</option>
                    <option value="containment">Containment — immediate interim fix</option>
                  </select>
                </Field>
                <Field label="Risk / priority">
                  <select class="hse-select-input" value={priority} onChange={e => setPriority((e.target as HTMLSelectElement).value as typeof priority)}>
                    <option value="critical">Critical — complete within 3 days</option>
                    <option value="high">High — complete within 7 days</option>
                    <option value="medium">Medium — complete within 14 days</option>
                    <option value="low">Low — complete within 30 days</option>
                  </select>
                </Field>
              </div>
            </div>
          )}

          {step === 'Source' && (
            <div class="capa-wizard-cols">
              <div class="capa-wizard-col">
                <Field label="Source type">
                  <select class="hse-select-input" value={linkedType} onChange={e => setLinkedType((e.target as HTMLSelectElement).value)}>
                    {['incident','investigation','audit','inspection','observation','permit','training-gap'].map(t => (
                      <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1).replace(/-/g, ' ')}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Linked record ref">
                  <TextInput value={linkedRef} onInput={setLinkedRef} placeholder="e.g. INC-2026-001" />
                </Field>
              </div>
              <div class="capa-wizard-col">
                <Field label="Root cause category">
                  <select class="hse-select-input" value={rootCauseCat} onChange={e => setRootCause((e.target as HTMLSelectElement).value)}>
                    <option value="">Select category…</option>
                    {['Human error','Procedure gap','Equipment failure','Training gap','Communication failure','Environmental','Design deficiency','Management system gap'].map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
          )}

          {step === 'Ownership' && (
            <div class="capa-wizard-cols">
              <div class="capa-wizard-col">
                <Field label="Action owner">
                  <TextInput value={owner} onInput={setOwner} placeholder="Full name or employee ID" />
                </Field>
                <Field label="Department / site">
                  <TextInput value={dept} onInput={setDept} placeholder="e.g. HSE · Point Lisas" />
                </Field>
              </div>
              <div class="capa-wizard-col">
                <Field label="Due date *">
                  <div style={{ display:'flex', gap:'8px', alignItems:'center' }}>
                    <input type="date" class="hse-text-input" style={{ flex:1 }} value={due}
                      onInput={e => setDue((e.target as HTMLInputElement).value)} />
                    <button type="button" class="hse-btn" style={{ whiteSpace:'nowrap', fontSize:'0.72rem' }}
                      onClick={applySlaDue}>
                      SLA default
                    </button>
                  </div>
                </Field>
                <div class="capa-sla-hint">
                  <i class="fas fa-circle-info" />
                  {priority === 'critical' ? 'Critical: must close within 3 days'
                  : priority === 'high'    ? 'High: must close within 7 days'
                  : priority === 'medium'  ? 'Medium: must close within 14 days'
                  : 'Low: must close within 30 days'}
                </div>
              </div>
            </div>
          )}

          {step === 'Verification' && (
            <div class="capa-wizard-cols">
              <div class="capa-wizard-col">
                <Field label="Verification required">
                  <div style={{ display:'flex', gap:'10px' }}>
                    {(['Yes','No'] as const).map(v => (
                      <label key={v} style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'0.82rem', cursor:'pointer' }}>
                        <input type="radio" name="verReq" checked={verRequired === (v === 'Yes')}
                          onChange={() => setVerReq(v === 'Yes')} />
                        {v}
                      </label>
                    ))}
                  </div>
                </Field>
                {verRequired && (
                  <Field label="Verifier role">
                    <select class="hse-select-input" value={verifier} onChange={e => setVerifier((e.target as HTMLSelectElement).value)}>
                      <option value="">Select verifier…</option>
                      {['HSE Manager','HSE Officer','Operations Manager','Supervisor','Department Head'].map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </Field>
                )}
              </div>
              <div class="capa-wizard-col">
                <div class="hse-form-field">
                  <label class="hse-form-label">Evidence required</label>
                  <div style={{ display:'flex', flexDirection:'column', gap:'8px', marginTop:'4px' }}>
                    {['Photo / video','Document / procedure update','Training record','Inspection sign-off','Supervisor sign-off','Test / measurement result'].map(ev => (
                      <label key={ev} style={{ display:'flex', alignItems:'center', gap:'8px', fontSize:'0.8rem', cursor:'pointer' }}>
                        <input type="checkbox" checked={evidenceReq.includes(ev)} onChange={() => toggleEvidence(ev)} />
                        {ev}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* ── Footer ── */}
        <div class="capa-wizard-foot">
          <button class="hse-btn" onClick={handleClose}>Cancel</button>
          <div style={{ display:'flex', gap:'8px' }}>
            {stepIdx > 0 && (
              <button class="hse-btn" onClick={() => setStep(CAPA_STEPS[stepIdx - 1]!)}>
                <i class="fas fa-chevron-left" /> Back
              </button>
            )}
            {isLast ? (
              <button class="hse-btn primary" onClick={submit} disabled={saving || !title.trim() || !due}>
                {saving ? 'Saving…' : 'Create CAPA'}
              </button>
            ) : (
              <button class="hse-btn primary" onClick={() => canAdvance() && setStep(CAPA_STEPS[stepIdx + 1]!)} disabled={!canAdvance()}>
                Next <i class="fas fa-chevron-right" />
              </button>
            )}
          </div>
        </div>

      </section>
    </>
  );
}

function CapaVerifyModal({ open, item, onClose, onVerify }: {
  open: boolean; item: CapaItem; onClose: () => void;
  onVerify: (note: string) => Promise<void>;
}): VNode | null {
  const [note,   setNote]   = useState('');
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  async function submit() {
    setSaving(true);
    try { await onVerify(note); } finally { setSaving(false); }
  }

  return (
    <HseModal open={open} title="Verify CAPA Closure" sub={`${item.ref} — ${item.title}`}
      onClose={onClose} onSubmit={submit} submitLabel={saving ? 'Verifying…' : 'Mark Verified'}>
      <div class="hse-form-grid">
        <div style={{ gridColumn: '1 / -1', padding: '12px 14px', borderRadius: '8px', background: 'rgba(255,255,255,.06)', marginBottom: '4px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 14px', fontSize: '0.78rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>Owner</span>    <span>{item.owner}</span>
            <span style={{ color: 'var(--text-muted)' }}>Due</span>      <span>{item.due}</span>
            <span style={{ color: 'var(--text-muted)' }}>Source</span>   <span>{item.source}</span>
            <span style={{ color: 'var(--text-muted)' }}>Priority</span> <span>{priLabel(item.priority)}</span>
          </div>
        </div>
        <Field label="Verification note / evidence summary" wide>
          <TextareaInput value={note} onInput={setNote}
            placeholder="Describe how closure was verified — reference evidence, inspection, or confirmation of action implementation…" />
        </Field>
        <div style={{ gridColumn: '1 / -1', fontSize: '0.74rem', color: 'rgba(255,255,255,.5)' }}>
          <i class="fas fa-info-circle" style={{ marginRight: '6px' }} />
          Once verified, this CAPA is locked in the audit trail and counts toward the closure rate KPI.
        </div>
      </div>
    </HseModal>
  );
}

// ── Incident detail drawer ────────────────────────────────────────────────────

type DrawerTab = 'overview' | 'evidence' | 'investigation' | 'capa' | 'workflow' | 'timeline';

const DRAWER_TABS: { key: DrawerTab; icon: string; label: string }[] = [
  { key: 'overview',     icon: 'fa-circle-info',          label: 'Overview'     },
  { key: 'evidence',     icon: 'fa-paperclip',            label: 'Evidence'     },
  { key: 'investigation',icon: 'fa-magnifying-glass-chart',label: 'Investigation'},
  { key: 'capa',         icon: 'fa-list-check',           label: 'CAPA'         },
  { key: 'workflow',     icon: 'fa-diagram-project',      label: 'Workflow'     },
  { key: 'timeline',     icon: 'fa-clock-rotate-left',    label: 'Timeline'     },
];

const PERSON_TYPE_ICON: Record<string, string> = {
  injured:    'fa-person-falling',
  witness:    'fa-eye',
  reporter:   'fa-megaphone',
  supervisor: 'fa-user-tie',
  contractor: 'fa-helmet-safety',
  visitor:    'fa-id-badge',
};

const PERSON_TYPE_COLOR: Record<string, string> = {
  injured:    'var(--hse-danger)',
  witness:    'var(--hse-info)',
  reporter:   'var(--siomac-gold)',
  supervisor: 'var(--hse-info)',
  contractor: 'var(--hse-warn)',
  visitor:    'var(--text-muted)',
};

const EVIDENCE_TYPE_ICON: Record<string, string> = {
  photo:       'fa-image',
  document:    'fa-file-lines',
  statement:   'fa-comment-lines',
  inspection:  'fa-clipboard-check',
  measurement: 'fa-ruler',
  other:       'fa-paperclip',
};

const EVENT_TYPE_LABEL: Record<string, string> = {
  'hse.incident.submitted':     'Incident submitted',
  'hse.incident.updated':       'Incident updated',
  'hse.investigation.assigned': 'Investigation assigned',
  'hse.investigation.updated':  'Investigation updated',
  'hse.capa.assigned':          'CAPA assigned',
  'hse.capa.closed':            'CAPA closed',
};

function DrawerTabBar({ active, onChange }: { active: DrawerTab; onChange: (t: DrawerTab) => void }): VNode {
  return (
    <div class="hse-idrawer-tabbar">
      {DRAWER_TABS.map(t => (
        <button
          key={t.key}
          class={`hse-idrawer-tab${active === t.key ? ' active' : ''}`}
          onClick={() => onChange(t.key)}
        >
          <i class={`fas ${t.icon}`} />
          {t.label}
        </button>
      ))}
    </div>
  );
}

function IncidentDrawer({ incident: i, incidentId, onClose, onInvestigate }: {
  incident: IncidentRecord | null;
  incidentId: string | null;
  onClose: () => void;
  onInvestigate: () => void | Promise<void>;
}): VNode {
  const open      = !!i;
  const sev       = (i ? (SEVERITY_META[i.severity] ?? SEVERITY_META.info) : SEVERITY_META.info)!;
  const updateInc = useUpdateIncident();
  const [activeTab,  setActiveTab]  = useState<DrawerTab>('overview');
  const [markingOsh, setMarkingOsh] = useState(false);

  const detailQ = useHseIncidentDetail(incidentId ?? '');
  const detail  = detailQ.data ?? null;
  const inc     = detail?.incident ?? null;

  const oshDue      = inc?.osh_notification_due ?? null;
  const oshNotified = inc?.osh_notified_at      ?? null;
  const oshOverdue  = oshDue && !oshNotified && new Date(oshDue) < new Date();

  async function markOshVerbal() {
    if (!inc) return;
    setMarkingOsh(true);
    try { await updateInc.mutateAsync({ incidentId: inc.id, oshNotifiedAt: new Date().toISOString() }); }
    finally { setMarkingOsh(false); }
  }

  // ── Tab content ────────────────────────────────────────────────────────────

  function renderOverview(): VNode {
    return (
      <div>
        {/* OSH banners */}
        {oshDue && !oshNotified && (
          <div class={`hse-idrawer-banner${oshOverdue ? ' hse-idrawer-banner--danger' : ' hse-idrawer-banner--warn'}`}>
            <i class={`fas ${oshOverdue ? 'fa-triangle-exclamation' : 'fa-gavel'}`} />
            <div class="hse-idrawer-banner-text">
              <strong>{oshOverdue ? 'OSH Verbal Notification — OVERDUE' : 'OSH Verbal Notification Required'}</strong>
              <span>Due: {new Date(oshDue).toLocaleString('en-GB')} · OSH Act 2004 s.19</span>
            </div>
            <button class="hse-btn" style={{ padding: '4px 10px', fontSize: '0.72rem', flexShrink: 0 }}
              onClick={markOshVerbal} disabled={markingOsh}>
              {markingOsh ? 'Saving…' : 'Mark Notified'}
            </button>
          </div>
        )}
        {oshDue && oshNotified && !inc?.osh_written_at && (
          <div class="hse-idrawer-banner hse-idrawer-banner--warn">
            <i class="fas fa-circle-check" />
            <div class="hse-idrawer-banner-text">
              <strong>Verbal notification logged</strong>
              <span>Written report due within 7 days · {new Date(oshNotified).toLocaleString('en-GB')}</span>
            </div>
          </div>
        )}
        {oshNotified && inc?.osh_written_at && (
          <div class="hse-idrawer-banner hse-idrawer-banner--ok">
            <i class="fas fa-circle-check" />
            <div class="hse-idrawer-banner-text">
              <strong>OSH notifications complete</strong>
              <span>Verbal and written report filed.</span>
            </div>
          </div>
        )}

        {/* Info grid */}
        <DetailGrid hideEmpty items={[
          { icon: 'fa-circle-dot',        label: 'Status',     value: <span class={hsePill(inc?.status ?? '')}>{inc?.status ?? i?.status ?? '—'}</span> },
          { icon: 'fa-calendar-day',      label: 'Date',       value: inc?.incident_date ? new Date(inc.incident_date).toLocaleDateString('en-GB') : (i?.date ?? '—') },
          { icon: 'fa-user-tie',          label: 'Reporter',   value: inc?.reported_by ?? i?.reporter ?? '—' },
          { icon: 'fa-tag',               label: 'Type',       value: inc?.incident_type ?? i?.type ?? '—' },
          { icon: 'fa-location-dot',      label: 'Location',   value: inc?.location_text ?? '' },
          { icon: 'fa-gavel',             label: 'OSH Class',  value: inc?.osh_classification ? (OSH_CLASSES.find(o => o.value === inc.osh_classification)?.label ?? inc.osh_classification) : '' },
          { icon: 'fa-calendar-xmark',    label: 'Lost days',  value: inc && inc.lost_days > 0 ? inc.lost_days : '' },
          { icon: 'fa-scale-balanced',    label: 'Reg. class', value: inc?.regulatory_class ?? '' },
          { icon: 'fa-flag',              label: 'Recordable', value: inc ? (inc.recordable ? 'Yes' : 'No') : '—' },
          { icon: 'fa-clock-rotate-left', label: 'Lost Time',  value: inc ? (inc.lost_time ? 'Yes' : 'No') : '—' },
        ]} />

        {/* Description */}
        <div class="hse-idrawer-section">
          <div class="hse-idrawer-section-head"><i class="fas fa-align-left" /> Incident Description</div>
          <p class="hse-idrawer-body-text">{inc?.description ?? i?.description ?? '—'}</p>
          {(inc?.immediate_action ?? i?.immediateActions) && (
            <div class="hse-idrawer-action-note">
              <i class="fas fa-bolt" /> <strong>Immediate action:</strong> {inc?.immediate_action ?? i?.immediateActions}
            </div>
          )}
        </div>

        {/* Injury detail */}
        {inc && (!!inc.injury_type || !!inc.body_part) && (
          <div class="hse-idrawer-section">
            <div class="hse-idrawer-section-head"><i class="fas fa-person-falling" /> Injury Details</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.8rem' }}>
              {inc.injury_type    && <><span style={{ color: 'var(--text-muted)' }}>Nature:</span><span>{inc.injury_type}</span></>}
              {inc.body_part      && <><span style={{ color: 'var(--text-muted)' }}>Body part:</span><span>{inc.body_part}</span></>}
              {inc.return_to_work && <><span style={{ color: 'var(--text-muted)' }}>Return to work:</span><span>{new Date(inc.return_to_work).toLocaleDateString('en-GB')}</span></>}
            </div>
          </div>
        )}

        {/* People involved */}
        {(() => {
          const people = detail?.people ?? [];
          if (!people.length) return null;
          const grouped: Record<string, typeof people> = {};
          for (const p of people) {
            const k = p.person_type ?? 'other';
            if (!grouped[k]) grouped[k] = [];
            grouped[k]!.push(p);
          }
          return (
            <div class="hse-idrawer-section">
              <div class="hse-idrawer-section-head"><i class="fas fa-users" /> People Involved</div>
              {Object.entries(grouped).map(([type, persons]) => (
                <div key={type} style={{ marginBottom: '10px' }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', color: PERSON_TYPE_COLOR[type] ?? 'var(--text-muted)', marginBottom: '6px' }}>
                    <i class={`fas ${PERSON_TYPE_ICON[type] ?? 'fa-user'}`} style={{ marginRight: '4px' }} />
                    {type.charAt(0).toUpperCase() + type.slice(1)}{persons.length > 1 ? ` (${persons.length})` : ''}
                  </div>
                  {persons.map((p, idx) => (
                    <div key={idx} style={{ marginBottom: '6px', padding: '8px 10px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: '8px' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.8rem' }}>
                        {p.full_name}{p.user_id ? <span style={{ fontWeight: 400, opacity: .6 }}> · {p.user_id}</span> : null}
                      </div>
                      {p.role_or_company && <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{p.role_or_company}</div>}
                      {p.injury_description && <p style={{ margin: '4px 0 0', fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{p.injury_description}</p>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          );
        })()}
      </div>
    );
  }

  function renderPeople(): VNode {
    const people = detail?.people ?? [];
    if (detailQ.isLoading) return <div class="hse-idrawer-empty"><i class="fas fa-spinner fa-spin" /> Loading…</div>;
    if (people.length === 0) return (
      <div class="hse-idrawer-empty">
        <i class="fas fa-users" style={{ fontSize: '1.8rem', opacity: .3 }} />
        <span>No people recorded for this incident.</span>
      </div>
    );
    const grouped: Record<string, typeof people> = {};
    for (const p of people) {
      const k = p.person_type ?? 'other';
      if (!grouped[k]) grouped[k] = [];
      grouped[k]!.push(p);
    }
    return (
      <div>
        {Object.entries(grouped).map(([type, persons]) => (
          <div class="hse-idrawer-section" key={type}>
            <div class="hse-idrawer-section-head">
              <i class={`fas ${PERSON_TYPE_ICON[type] ?? 'fa-user'}`} style={{ color: PERSON_TYPE_COLOR[type] ?? 'var(--text-muted)' }} />
              {' '}{type.charAt(0).toUpperCase() + type.slice(1)}{persons.length > 1 ? `s (${persons.length})` : ''}
            </div>
            {persons.map((p, idx) => (
              <div key={idx} style={{ marginBottom: '8px', padding: '10px 12px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: '10px' }}>
                <div style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: '2px' }}>
                  {p.full_name}{p.user_id ? <span style={{ fontWeight: 400, opacity: .6 }}> · {p.user_id}</span> : null}
                </div>
                {p.role_or_company && <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>{p.role_or_company}</div>}
                {p.injury_description && <p style={{ margin: '6px 0 0', fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{p.injury_description}</p>}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  function renderEvidence(): VNode {
    const evidence = detail?.evidence ?? [];
    if (detailQ.isLoading) return <div class="hse-idrawer-empty"><i class="fas fa-spinner fa-spin" /> Loading…</div>;
    if (!detail?.investigation) return (
      <div class="hse-idrawer-empty">
        <i class="fas fa-paperclip" style={{ fontSize: '1.8rem', opacity: .3 }} />
        <span>No investigation opened yet. Evidence is collected during investigation.</span>
      </div>
    );
    if (evidence.length === 0) return (
      <div class="hse-idrawer-empty">
        <i class="fas fa-paperclip" style={{ fontSize: '1.8rem', opacity: .3 }} />
        <span>No evidence collected yet.</span>
        <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '4px' }}>Evidence is added through the Investigation workflow.</span>
      </div>
    );
    return (
      <div>
        {evidence.map((ev, idx) => (
          <div key={idx} style={{ marginBottom: '8px', padding: '10px 12px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <i class={`fas ${EVIDENCE_TYPE_ICON[ev.evidence_type] ?? 'fa-paperclip'}`} style={{ color: 'var(--siomac-gold)', fontSize: '0.85rem' }} />
              <strong style={{ fontSize: '0.82rem' }}>{ev.title}</strong>
              <span class={`hse-pill hse-pill--${ev.status === 'collected' ? 'success' : 'info'}`} style={{ marginLeft: 'auto', fontSize: '0.7rem' }}>{ev.status}</span>
            </div>
            {ev.description && <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{ev.description}</p>}
            {ev.collected_at && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>Collected: {new Date(ev.collected_at).toLocaleDateString('en-GB')}</div>}
          </div>
        ))}
      </div>
    );
  }

  function renderInvestigation(): VNode {
    const inv       = detail?.investigation ?? null;
    const rootCauses = detail?.rootCauses ?? [];
    if (detailQ.isLoading) return <div class="hse-idrawer-empty"><i class="fas fa-spinner fa-spin" /> Loading…</div>;
    if (!inv) return (
      <div class="hse-idrawer-empty">
        <i class="fas fa-magnifying-glass-chart" style={{ fontSize: '1.8rem', opacity: .3 }} />
        <span>No investigation opened yet.</span>
        <button class="hse-btn primary" style={{ marginTop: '12px' }} onClick={onInvestigate}>
          <i class="fas fa-plus" /> Open Investigation
        </button>
      </div>
    );
    const INV_STATUS_COLOR: Record<string, string> = {
      assigned: 'var(--hse-info)', collecting_evidence: 'var(--siomac-gold)',
      root_cause: 'var(--siomac-gold)', findings: 'var(--hse-warn)',
      review: 'var(--hse-warn)', closed: 'var(--hse-success)', overdue: 'var(--hse-danger)',
    };
    return (
      <div>
        <div class="hse-idrawer-grid">
          <div class="hse-idrawer-cell"><i class="fas fa-circle-dot" /><span>Status</span>
            <strong><span style={{ color: INV_STATUS_COLOR[inv.status] ?? 'inherit' }}>{inv.status.replace(/_/g, ' ')}</span></strong>
          </div>
          <div class="hse-idrawer-cell"><i class="fas fa-hashtag" /><span>Ref</span><strong>{inv.ref}</strong></div>
          {inv.investigator_user_id && (
            <div class="hse-idrawer-cell"><i class="fas fa-user-magnifying-glass" /><span>Investigator</span><strong>{inv.investigator_user_id}</strong></div>
          )}
          {inv.due_at && (
            <div class="hse-idrawer-cell"><i class="fas fa-calendar-day" /><span>Due</span>
              <strong>{new Date(inv.due_at).toLocaleDateString('en-GB')}</strong>
            </div>
          )}
          {inv.root_cause_method && (
            <div class="hse-idrawer-cell"><i class="fas fa-sitemap" /><span>Method</span>
              <strong>{inv.root_cause_method === '5why' ? '5-Whys' : inv.root_cause_method}</strong>
            </div>
          )}
          {inv.closed_at && (
            <div class="hse-idrawer-cell"><i class="fas fa-circle-check" /><span>Closed</span>
              <strong>{new Date(inv.closed_at).toLocaleDateString('en-GB')}</strong>
            </div>
          )}
        </div>

        {inv.summary && (
          <div class="hse-idrawer-section">
            <div class="hse-idrawer-section-head"><i class="fas fa-align-left" /> Summary</div>
            <p class="hse-idrawer-body-text">{inv.summary}</p>
          </div>
        )}
        {inv.findings && (
          <div class="hse-idrawer-section">
            <div class="hse-idrawer-section-head"><i class="fas fa-lightbulb" /> Findings</div>
            <p class="hse-idrawer-body-text">{inv.findings}</p>
          </div>
        )}
        {inv.recommendations && (
          <div class="hse-idrawer-section">
            <div class="hse-idrawer-section-head"><i class="fas fa-list-ul" /> Recommendations</div>
            <p class="hse-idrawer-body-text">{inv.recommendations}</p>
          </div>
        )}

        {rootCauses.length > 0 && (
          <div class="hse-idrawer-section">
            <div class="hse-idrawer-section-head"><i class="fas fa-sitemap" /> Root Causes ({rootCauses.length})</div>
            {rootCauses.map((rc, idx) => (
              <div key={idx} style={{ marginBottom: '8px', padding: '10px 12px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: '10px' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: '4px' }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', paddingTop: '1px' }}>{rc.category}</span>
                  {rc.contributing_factor && <span class="hse-pill hse-pill--warn" style={{ fontSize: '0.68rem' }}>Contributing</span>}
                </div>
                <p style={{ margin: 0, fontSize: '0.8rem', lineHeight: 1.5 }}>{rc.cause}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderCapa(): VNode {
    const capas = detail?.capa ?? [];
    if (detailQ.isLoading) return <div class="hse-idrawer-empty"><i class="fas fa-spinner fa-spin" /> Loading…</div>;
    if (capas.length === 0) return (
      <div class="hse-idrawer-empty">
        <i class="fas fa-list-check" style={{ fontSize: '1.8rem', opacity: .3 }} />
        <span>No CAPA actions raised for this incident.</span>
      </div>
    );
    const PRIO_COLOR: Record<string, string> = { critical: 'var(--hse-danger)', high: 'var(--hse-warn)', medium: 'var(--hse-info)', low: 'var(--text-muted)' };
    return (
      <div>
        {capas.map((ca, idx) => {
          const overdue = ca.due_at && ca.status !== 'closed' && ca.status !== 'cancelled' && new Date(ca.due_at) < new Date();
          return (
            <div key={idx} style={{ marginBottom: '10px', padding: '12px', background: 'var(--bg-subtle)', border: `1px solid ${overdue ? 'rgba(239,68,68,.3)' : 'var(--border)'}`, borderRadius: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
                <i class="fas fa-list-check" style={{ color: PRIO_COLOR[ca.priority] ?? 'var(--text-muted)', marginTop: '2px' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: '2px' }}>{ca.title}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{ca.ref}</div>
                </div>
                <span class={`hse-pill hse-pill--${ca.status === 'closed' ? 'success' : overdue ? 'danger' : 'info'}`} style={{ fontSize: '0.7rem', flexShrink: 0 }}>
                  {overdue && ca.status !== 'closed' ? 'Overdue' : ca.status.replace(/_/g,' ')}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                {ca.owner_user_id && <span><i class="fas fa-user" /> {ca.owner_user_id}</span>}
                {ca.due_at && <span><i class="fas fa-calendar-day" /> {new Date(ca.due_at).toLocaleDateString('en-GB')}</span>}
                {ca.effectiveness_result && <span><i class="fas fa-star" /> {ca.effectiveness_result.replace(/_/g,' ')}</span>}
                <span><i class="fas fa-flag" /> {ca.priority}</span>
              </div>
              {ca.description && <p style={{ margin: '8px 0 0', fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{ca.description}</p>}
            </div>
          );
        })}
      </div>
    );
  }

  function renderWorkflow(): VNode {
    const wf    = detail?.workflow    ?? null;
    const tasks = detail?.workflowTasks ?? [];
    if (detailQ.isLoading) return <div class="hse-idrawer-empty"><i class="fas fa-spinner fa-spin" /> Loading…</div>;

    const isInvestigating = /investigation/i.test(i?.status ?? '');
    const isClosed        = /closed/i.test(i?.status ?? '');
    const isCapaRaised    = /capa|action/i.test(i?.status ?? '') || isClosed;

    const steps = [
      { icon: 'fa-file-circle-check', label: 'Incident recorded',     sub: `Reported by ${i?.reporter ?? '—'} · ${i?.date ?? ''}`, done: true,            active: false },
      { icon: 'fa-route',             label: 'Routed to HSE Manager', sub: 'Auto-routed · SLA 24 hrs',                              done: !!wf,            active: !wf && !isClosed },
      { icon: 'fa-magnifying-glass',  label: 'Investigation opened',  sub: 'Root cause analysis',                                   done: isInvestigating, active: !!wf && !isInvestigating && !isClosed },
      { icon: 'fa-list-check',        label: 'CAPA raised',           sub: 'Corrective & preventive actions',                       done: isCapaRaised,    active: isInvestigating && !isCapaRaised },
      { icon: 'fa-circle-check',      label: 'Closed out',            sub: 'Verified by HSE Manager',                               done: isClosed,        active: isCapaRaised && !isClosed },
    ];

    return (
      <div>
        {wf && (
          <div class="hse-idrawer-grid" style={{ marginBottom: '16px' }}>
            <div class="hse-idrawer-cell"><i class="fas fa-hashtag" /><span>Workflow</span><strong>{wf.ref}</strong></div>
            <div class="hse-idrawer-cell"><i class="fas fa-circle-dot" /><span>Status</span>
              <strong><span class={hsePill(wf.status)}>{wf.status}</span></strong>
            </div>
            <div class="hse-idrawer-cell"><i class="fas fa-flag" /><span>Priority</span><strong>{wf.priority}</strong></div>
            {wf.due_at && <div class="hse-idrawer-cell"><i class="fas fa-calendar-day" /><span>Due</span><strong>{new Date(wf.due_at).toLocaleDateString('en-GB')}</strong></div>}
          </div>
        )}

        <div class="hse-idrawer-section">
          <div class="hse-idrawer-section-head"><i class="fas fa-diagram-project" /> Progress</div>
          <div class="hse-idrawer-wf-steps">
            {steps.map((step, idx) => (
              <div key={idx} class={`hse-idrawer-wf-step${step.done ? ' wf-done' : step.active ? ' wf-active' : ' wf-pending'}`}>
                {idx < steps.length - 1 && <div class="hse-idrawer-wf-line" />}
                <div class="hse-idrawer-wf-icon"><i class={`fas ${step.done ? 'fa-check' : step.icon}`} /></div>
                <div class="hse-idrawer-wf-card">
                  <div class="hse-idrawer-wf-label">{step.label}</div>
                  <div class="hse-idrawer-wf-sub">{step.sub}</div>
                  {step.done   && <span class="hse-idrawer-wf-badge wf-badge-done"><i class="fas fa-circle-check" /> Complete</span>}
                  {step.active && <span class="hse-idrawer-wf-badge wf-badge-active"><i class="fas fa-circle-dot" /> In Progress</span>}
                  {!step.done && !step.active && <span class="hse-idrawer-wf-badge wf-badge-pending"><i class="fas fa-clock" /> Pending</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {tasks.length > 0 && (
          <div class="hse-idrawer-section">
            <div class="hse-idrawer-section-head"><i class="fas fa-list-check" /> Tasks ({tasks.length})</div>
            {tasks.map((t, idx) => (
              <div key={idx} style={{ marginBottom: '8px', padding: '10px 12px', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <i class={`fas ${t.status === 'completed' || t.status === 'approved' ? 'fa-circle-check' : t.status === 'open' ? 'fa-circle-dot' : 'fa-circle'}`}
                    style={{ color: t.status === 'completed' || t.status === 'approved' ? 'var(--hse-success)' : t.status === 'open' ? 'var(--siomac-gold)' : 'var(--text-muted)' }} />
                  <strong style={{ fontSize: '0.82rem', flex: 1 }}>{t.title}</strong>
                  <span class={`hse-pill hse-pill--${t.status === 'completed' || t.status === 'approved' ? 'success' : t.status === 'open' ? 'info' : 'warn'}`} style={{ fontSize: '0.68rem' }}>{t.status}</span>
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  {t.assigned_role && <span><i class="fas fa-shield-halved" /> {t.assigned_role}</span>}
                  {t.assigned_user_id && <span style={{ marginLeft: '8px' }}><i class="fas fa-user" /> {t.assigned_user_id}</span>}
                  {t.due_at && <span style={{ marginLeft: '8px' }}><i class="fas fa-calendar-day" /> {new Date(t.due_at).toLocaleDateString('en-GB')}</span>}
                </div>
                {t.note && <p style={{ margin: '6px 0 0', fontSize: '0.76rem', color: 'var(--text-muted)' }}>{t.note}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  function renderTimeline(): VNode {
    const events = detail?.timeline ?? [];
    if (detailQ.isLoading) return <div class="hse-idrawer-empty"><i class="fas fa-spinner fa-spin" /> Loading…</div>;
    if (events.length === 0) return (
      <div class="hse-idrawer-empty">
        <i class="fas fa-clock-rotate-left" style={{ fontSize: '1.8rem', opacity: .3 }} />
        <span>No events recorded yet.</span>
      </div>
    );
    const SEV_COLOR: Record<string, string> = {
      critical: 'var(--hse-danger)', high: 'var(--hse-warn)',
      info: 'var(--hse-info)', success: 'var(--hse-success)',
    };
    return (
      <div class="hse-idrawer-timeline">
        {events.map((ev, idx) => (
          <div key={idx} class="hse-timeline-row">
            <div class="hse-timeline-dot" style={{ background: SEV_COLOR[ev.severity] ?? 'var(--border)' }} />
            {idx < events.length - 1 && <div class="hse-timeline-line" />}
            <div class="hse-timeline-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                <strong style={{ fontSize: '0.8rem' }}>{EVENT_TYPE_LABEL[ev.event_type] ?? ev.event_type.replace(/\./g,' ')}</strong>
                <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {new Date(ev.created_at).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}
                </span>
              </div>
              {ev.actor_user_id && <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}><i class="fas fa-user" /> {ev.actor_user_id}</div>}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const TAB_RENDER: Record<DrawerTab, () => VNode> = {
    overview:      renderOverview,
    evidence:      renderEvidence,
    investigation: renderInvestigation,
    capa:          renderCapa,
    workflow:      renderWorkflow,
    timeline:      renderTimeline,
  };

  return (
    <>
      <div class={`hse-drawer-backdrop${open ? ' show' : ''}`} onClick={onClose} />
      <aside class={`hse-drawer hse-drawer--rich${open ? ' show' : ''}`} role="dialog" aria-modal="true" aria-hidden={!open}>

        {/* ── Hero ── */}
        <div class="hse-idrawer-hero">
          <div class="hse-idrawer-hero-left">
            <div class="hse-idrawer-type-chip" style={{ background: sev.bg }}>
              <i class={`fas ${i ? (TYPE_ICONS[i.type] ?? 'fa-file-exclamation') : 'fa-file'}`} style={{ color: sev.color }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div class="hse-idrawer-ref">{i?.ref ?? '—'}</div>
              <div class="hse-idrawer-type">{i?.type ?? '—'} · <span style={{ opacity: .6 }}>{i?.date ?? ''}</span></div>
              <div class="hse-idrawer-site"><i class="fas fa-location-dot" /> {i?.site ?? '—'}</div>
            </div>
          </div>
          <div class="hse-idrawer-hero-right">
            <div class="hse-idrawer-sev-badge" style={{ background: sev.bg, color: sev.color }}>
              <i class={`fas ${sev.icon}`} /> {sev.label}
            </div>
          </div>
        </div>

        {/* ── Tab bar ── */}
        <DrawerTabBar active={activeTab} onChange={setActiveTab} />

        {/* ── Scrollable body ── */}
        <div class="hse-drawer-body">
          <div class="hse-idrawer-tab-content">
            {detailQ.isError && (
              <div class="hse-idrawer-banner hse-idrawer-banner--danger">
                <i class="fas fa-triangle-exclamation" />
                <div class="hse-idrawer-banner-text">
                  <strong>Failed to load incident detail</strong>
                  <span>{(detailQ.error as Error)?.message ?? 'Unknown error'}</span>
                </div>
              </div>
            )}
            {(TAB_RENDER[activeTab] ?? renderOverview)()}
          </div>
        </div>

        {/* ── Footer ── */}
        <div class="hse-drawer-foot">
          <button class="hse-btn" onClick={onClose}>Close</button>
          {activeTab !== 'investigation' && (
            <button class="hse-btn primary" onClick={onInvestigate}>
              <i class="fas fa-magnifying-glass-chart" /> Open Investigation
            </button>
          )}
        </div>
      </aside>
    </>
  );
}

// ── Form section wrapper ──────────────────────────────────────────────────────

function FormSection({ icon, title, children }: {
  icon: string; title: string; children: ComponentChildren;
}): VNode {
  return (
    <div style={{ marginBottom: '24px', paddingBottom: '24px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <i class={`fas ${icon}`} style={{ color: 'var(--siomac-gold)', fontSize: '0.9rem' }} />
        <span style={{ fontWeight: 600, fontSize: '0.88rem', color: 'rgba(255,255,255,.9)' }}>{title}</span>
      </div>
      {children}
    </div>
  );
}
