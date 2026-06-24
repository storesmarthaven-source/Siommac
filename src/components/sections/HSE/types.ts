/**
 * src/components/sections/HSE/types.ts
 *
 * Typed data models for the HSE / PPE Manager module. This is a UI-only build —
 * the `mock*` exports below stand in for a future backend. Keeping the models
 * here (rather than inline in JSX) means wiring real data later is a drop-in:
 * replace the mock arrays with query hooks returning the same shapes.
 */

import {
  toneClass,
  toneFromText,
  toneFromPpeStatus,
  colorFromSeverity,
} from '@ui/status/statusTokens';

// ── HSE Dashboard (T&T HSE command view) ──────────────────────────────────────

/** Severity tone used across HSE cards/pills. */
export type HseSeverity = 'danger' | 'warning' | 'info' | 'success';

/** Hero summary stat (inside the dark overview panel). */
export interface HeroStat { label: string; value: string; }

export const mockHeroStats: HeroStat[] = [
  { label: 'Workers & contractors', value: '418' },
  { label: 'Open HSE work',         value: '72' },
  { label: 'OSH/EMA blockers',      value: '6' },
  { label: 'PTW active',            value: '11' },
];

/** Overall HSE health score shown in the hero ring. */
export const HSE_HEALTH_SCORE = 82;

/** Rich KPI card (value + label + subtitle + status note + severity). */
export interface HseKpi {
  label:    string;
  value:    string;
  subtitle: string;
  note:     string;
  severity: HseSeverity;
}

export const mockHseKpis: HseKpi[] = [
  { label: 'OSH Recordables', value: '3',   subtitle: 'Cases under OSH classification and notification review', note: '1 pending',    severity: 'danger' },
  { label: 'Lost Time Cases', value: '1',   subtitle: 'Days away / restricted work case tracking',              note: 'Under review', severity: 'warning' },
  { label: 'HiPo Events',     value: '4',   subtitle: 'High-potential near misses at T&T operating sites',      note: '+1 open',      severity: 'danger' },
  { label: 'CAPA Closure',    value: '87%', subtitle: 'Corrective actions closed on time',                      note: 'Target 95%',   severity: 'warning' },
  { label: 'HSE Training',    value: '94%', subtitle: 'PTW, confined space, fire watch, first aid',             note: '22 due',       severity: 'info' },
  { label: 'PPE Compliance',  value: '91%', subtitle: 'Assignment, renewal, and field observations',           note: '3 hot spots',  severity: 'warning' },
];

/** Monthly safety-performance trend point. */
export interface TrendPoint { month: string; incidents: number; nearMisses: number; capaClosure: number; }

export const mockTrend: TrendPoint[] = [
  { month: 'Jan', incidents: 18, nearMisses: 42, capaClosure: 72 },
  { month: 'Feb', incidents: 14, nearMisses: 55, capaClosure: 78 },
  { month: 'Mar', incidents: 20, nearMisses: 68, capaClosure: 74 },
  { month: 'Apr', incidents: 11, nearMisses: 61, capaClosure: 81 },
  { month: 'May', incidents: 9,  nearMisses: 73, capaClosure: 88 },
  { month: 'Jun', incidents: 7,  nearMisses: 64, capaClosure: 87 },
];

/** Critical work-queue item (escalate today). */
export interface QueueItem { title: string; detail: string; status: string; severity: HseSeverity; }

export const mockQueue: QueueItem[] = [
  { title: 'Diesel spill near drain',          detail: 'Point Lisas Plant · EMA evidence and cleanup closeout pending',          status: 'Critical', severity: 'danger' },
  { title: 'Confined space permit hold',       detail: 'Galeota Marine Base · Gas test and rescue plan not attached',            status: 'Blocked',  severity: 'danger' },
  { title: 'Contractor HSE file expired',      detail: 'La Brea Yard · Insurance, induction, and STOW-style evidence due',       status: 'Pending',  severity: 'warning' },
  { title: 'Roof edge maintenance exposure',   detail: 'Port of Spain Office · Work at height control required',                 status: 'Critical', severity: 'danger' },
];

/** Recent incident register row. */
export interface HseIncident {
  ref: string; date: string; site: string; event: string; klass: string; status: string; action: string; owner: string;
}

export const mockHseIncidents: HseIncident[] = [
  { ref: 'INC-2026-041', date: '18 Jun 2026', site: 'Point Lisas Plant',  event: 'Diesel sheen observed near storm drain during transfer line cleanup',              klass: 'Environmental Spill', status: 'Critical',  action: 'EMA evidence pending',     owner: 'HSE Lead' },
  { ref: 'NM-2026-118',  date: '18 Jun 2026', site: 'Galeota Marine Base', event: 'Confined space entry stopped before work due to missing gas test and rescue',        klass: 'Near Miss',           status: 'Blocked',   action: 'Permit hold active',       owner: 'Permit Controller' },
  { ref: 'INC-2026-039', date: '17 Jun 2026', site: 'La Brea Yard',        event: 'Contractor hand laceration during manual handling of sharp-edged material',          klass: 'First Aid',           status: 'Open',      action: 'Supervisor investigation', owner: 'Site HSE Officer' },
  { ref: 'OBS-2026-226', date: '16 Jun 2026', site: 'Piarco Logistics',    event: 'Forklift crossed pedestrian route without spotter during loading bay activity',      klass: 'Unsafe Act',          status: 'In Review', action: 'Traffic plan update',      owner: 'Warehouse Manager' },
  { ref: 'INC-2026-037', date: '15 Jun 2026', site: 'Port of Spain Office', event: 'Roof-edge maintenance task identified without completed work-at-height control pack', klass: 'Unsafe Condition',   status: 'Critical',  action: 'Work stopped',             owner: 'Facilities Lead' },
];

/** Site risk summary. */
export interface SiteRisk { site: string; level: string; detail: string; score: number; open: number; overdue: number; severity: HseSeverity; }

export const mockSiteRisk: SiteRisk[] = [
  { site: 'Point Lisas Plant',  level: 'High',     detail: 'Hot work, chemicals, process maintenance, lifting', score: 76, open: 19, overdue: 4, severity: 'warning' },
  { site: 'Galeota Marine Base', level: 'Critical', detail: 'Marine transfer, confined space, spill response',    score: 69, open: 8,  overdue: 2, severity: 'danger' },
  { site: 'Piarco Logistics',   level: 'Medium',   detail: 'Forklifts, pedestrians, loading bay traffic',        score: 81, open: 11, overdue: 1, severity: 'success' },
];

/** Active permit-to-work row. */
export interface Permit { ref: string; site: string; gate: string; status: string; }

export const mockPermits: Permit[] = [
  { ref: 'PTW-0033', site: 'Galeota Marine Base',  gate: 'Confined space: gas test / rescue plan', status: 'Blocked' },
  { ref: 'PTW-0032', site: 'Point Lisas Plant',    gate: 'Hot work: fire watch / gas free cert',   status: 'Overdue' },
  { ref: 'PTW-0038', site: 'Port of Spain Office',  gate: 'Work at height: harness / edge control', status: 'Live' },
  { ref: 'PTW-0040', site: 'Point Lisas Plant',    gate: 'Electrical isolation: LOTO verification', status: 'Hold' },
];

/** Readiness control row. */
export interface ReadinessRow { label: string; value: string; detail: string; severity: HseSeverity; }

export const mockReadiness: ReadinessRow[] = [
  { label: 'Contractor HSE readiness', value: '88%', detail: 'STOW-style evidence, insurance, induction, competency files',        severity: 'warning' },
  { label: 'PPE compliance',           value: '91%', detail: 'Eye, hand, FR clothing, harness renewal hot spots',                   severity: 'warning' },
  { label: 'Inspection completion',    value: '92%', detail: 'Fire, housekeeping, lifting gear, chemical storage, PTW checks',      severity: 'warning' },
  { label: 'Emergency readiness',      value: '97%', detail: 'TTFS/fire certificate evidence, eyewash, spill kits, AEDs',           severity: 'success' },
];

/** HSE status text → Siomac .vt-pill variant. Delegates to the shared
    status source of truth (@ui/status/statusTokens). */
export function hsePill(text: string | null | undefined): string {
  return toneClass(toneFromText(text));
}

/** Severity → left-accent color (for KPI/readiness cards). */
export function hseSeverityColor(s: HseSeverity): string {
  return colorFromSeverity(s);
}

/**
 * Status text → `.status-badge` tone class (mirrors the source `statusClass`).
 * critical/blocked/overdue → critical · hold/pending/due/high → pending ·
 * live/ready/complete → live · everything else → review.
 */
export function hseStatusClass(text: string): 'critical' | 'pending' | 'live' | 'review' {
  if (/critical|blocked|overdue|stopped/i.test(text)) return 'critical';
  if (/hold|pending|due|high/i.test(text))            return 'pending';
  if (/live|ready|complete|open/i.test(text))         return 'live';
  return 'review';
}

/** Dropdown options for the dashboard filter bar (mirrors the source <select>s). */
export const HSE_SITE_OPTIONS   = ['Point Lisas Plant', 'La Brea Yard', 'Piarco Logistics', 'Port of Spain Office', 'Galeota Marine Base'];
export const HSE_PERIOD_OPTIONS = ['Month to date', 'Quarter to date', 'Year to date'];
export const HSE_RISK_OPTIONS   = ['Critical', 'High', 'Medium'];
export const HSE_OWNER_OPTIONS  = ['HSE', 'Operations', 'Maintenance', 'Contractors'];

/** Split a "Site · detail" queue string into its parts. */
export function splitSiteDetail(text: string): { site: string; detail: string } {
  const [site, detail] = text.split('·').map(x => x.trim());
  return { site: site || 'All locations', detail: detail || text };
}

// ── PPE inventory ─────────────────────────────────────────────────────────────

export type PpeStatus = 'available' | 'low' | 'expired' | 'quarantined';

export interface PpeItem {
  id:        number;
  name:      string;
  type:      string;
  brand:     string;
  stock:     number;
  location:  string;
  threshold: number;
  expiry:    string;
  status:    PpeStatus;
}

export const mockPpeItems: PpeItem[] = [
  { id: 1, name: 'Hard Hat Type A',           type: 'Helmet',         brand: '3M V-Gard',   stock: 45, location: 'Warehouse A', threshold: 10, expiry: '2027-01-15', status: 'available' },
  { id: 2, name: 'Leather Gloves',            type: 'Gloves',         brand: 'Ironclad',    stock: 8,  location: 'Site B',      threshold: 15, expiry: '2026-12-01', status: 'low' },
  { id: 3, name: 'Safety Goggles',            type: 'Safety Glasses', brand: 'Uvex',        stock: 22, location: 'Warehouse A', threshold: 10, expiry: '2027-06-20', status: 'available' },
  { id: 4, name: 'Ear Muffs',                 type: 'Ear Protection', brand: '3M',          stock: 0,  location: 'Vehicle 12',  threshold: 5,  expiry: '2026-08-10', status: 'expired' },
  { id: 5, name: 'High-Vis Vest',             type: 'Vest',           brand: 'Radians',     stock: 18, location: 'Site B',      threshold: 8,  expiry: '2027-03-05', status: 'available' },
  { id: 6, name: 'Fall Harness',              type: 'Harness',        brand: 'Guardian',    stock: 5,  location: 'Warehouse A', threshold: 3,  expiry: '2026-09-30', status: 'low' },
  { id: 7, name: 'Steel Toe Boots',           type: 'Boots',          brand: 'Timberland',  stock: 12, location: 'Site B',      threshold: 6,  expiry: '2027-05-12', status: 'available' },
  { id: 8, name: 'Welding Shield',            type: 'Helmet',         brand: 'Fibre-Metal', stock: 3,  location: 'Warehouse A', threshold: 5,  expiry: '2026-11-20', status: 'low' },
  { id: 9, name: 'Flame-Resistant Coveralls', type: 'Coveralls',     brand: 'Bulwark',     stock: 16, location: 'Warehouse A', threshold: 6,  expiry: '2027-04-18', status: 'available' },
];

// ── Employees (PPE profiles) ──────────────────────────────────────────────────

export interface PpeEmployee {
  id:         number;
  name:       string;
  role:       string;
  department: string;
  site:       string;
  supervisor: string;
}

export const mockPpeEmployees: PpeEmployee[] = [
  { id: 1, name: 'Andre Williams',   role: 'Maintenance Technician', department: 'Maintenance',  site: 'Point Lisas Plant',   supervisor: 'Sarah Chen' },
  { id: 2, name: 'Jamal Lewis',      role: 'Mechanical Fitter',      department: 'Operations',   site: 'La Brea Yard',        supervisor: 'Sarah Chen' },
  { id: 3, name: 'Marlon Joseph',    role: 'Rigger',                 department: 'Construction', site: 'Galeota Marine Base', supervisor: 'Anya Mohammed' },
  { id: 4, name: 'Anya Mohammed',    role: 'HSE Officer',            department: 'HSE',          site: 'La Brea Yard',        supervisor: 'Sarah Chen' },
  { id: 5, name: 'Kavita Persad',    role: 'Process Operator',       department: 'Operations',   site: 'Point Lisas Plant',   supervisor: 'Sarah Chen' },
  { id: 6, name: 'Dwayne Charles',   role: 'Forklift Operator',      department: 'Logistics',    site: 'Piarco Logistics',    supervisor: 'Lisa Ramnarine' },
  { id: 7, name: 'Terrence Baptiste',role: 'Electrician',            department: 'Maintenance',  site: 'Point Lisas Plant',   supervisor: 'Sarah Chen' },
];

// ── Role → required-PPE matrix ────────────────────────────────────────────────

export interface RoleMatrixRow {
  role:     string;
  required: string[];
}

export const mockRoleMatrix: RoleMatrixRow[] = [
  { role: 'Welder',       required: ['Helmet', 'Gloves', 'Safety Glasses', 'Boots'] },
  { role: 'Electrician',  required: ['Helmet', 'Gloves', 'Safety Glasses', 'Vest'] },
  { role: 'Rigger',       required: ['Helmet', 'Gloves', 'Harness', 'Boots'] },
  { role: 'HSE Officer',  required: ['Helmet', 'Vest', 'Safety Glasses'] },
  { role: 'Site Manager', required: ['Helmet', 'Vest'] },
];

/** PPE types shown as columns in the role matrix grid. */
export const PPE_MATRIX_COLUMNS = ['Helmet', 'Gloves', 'Glasses', 'Ear', 'Vest', 'Harness', 'Boots'] as const;

// ── Status-pill mapping (mock status → Siomac .vt-pill variant) ───────────────

/** PPE enum status → Siomac .vt-pill variant. Delegates to the shared
    status source of truth (@ui/status/statusTokens). */
export function ppePillClass(status: string): string {
  return toneClass(toneFromPpeStatus(status));
}

// ═══════════════════════════════════════════════════════════════════════════════
// HSE areas — shared roster + per-area models and mock data (UI-only, ~25 staff,
// Trinidad & Tobago sites). All `mock*` arrays stand in for a future backend.
// ═══════════════════════════════════════════════════════════════════════════════

/** Shared HSE workforce roster (reused by training/JSA/toolbox attendance). */
export interface HseWorker { id: string; name: string; role: string; department: string; site: string; }

export const HSE_SITES = ['Point Lisas Plant', 'La Brea Yard', 'Piarco Logistics', 'Port of Spain Office', 'Galeota Marine Base'] as const;

export const mockHseWorkers: HseWorker[] = [
  { id: 'EMP-0418', name: 'Andre Williams',     role: 'Maintenance Technician', department: 'Maintenance', site: 'Point Lisas Plant' },
  { id: 'EMP-0216', name: 'Jamal Lewis',         role: 'Mechanical Fitter',      department: 'Operations',  site: 'La Brea Yard' },
  { id: 'EMP-0301', name: 'Kavita Persad',       role: 'Process Operator',       department: 'Operations',  site: 'Point Lisas Plant' },
  { id: 'EMP-0088', name: 'Sarah Chen',          role: 'HSE Manager',            department: 'HSE',         site: 'Port of Spain Office' },
  { id: 'EMP-0142', name: 'Marlon Joseph',       role: 'Rigger',                 department: 'Construction', site: 'Galeota Marine Base' },
  { id: 'EMP-0177', name: 'Anya Mohammed',       role: 'Site HSE Officer',       department: 'HSE',         site: 'La Brea Yard' },
  { id: 'EMP-0220', name: 'Dwayne Charles',      role: 'Forklift Operator',      department: 'Logistics',   site: 'Piarco Logistics' },
  { id: 'EMP-0255', name: 'Reza Khan',           role: 'Confined Space Attendant', department: 'Operations', site: 'Galeota Marine Base' },
  { id: 'EMP-0309', name: 'Lisa Ramnarine',      role: 'Warehouse Lead',         department: 'Logistics',   site: 'Piarco Logistics' },
  { id: 'EMP-0344', name: 'Terrence Baptiste',   role: 'Electrician',            department: 'Maintenance', site: 'Point Lisas Plant' },
];

// ── Incidents ──────────────────────────────────────────────────────────────────

export type IncidentType = 'Injury' | 'Near Miss' | 'Environmental' | 'Property Damage' | 'Unsafe Act' | 'Unsafe Condition';

export interface IncidentRecord {
  ref: string; date: string; type: IncidentType; severity: HseSeverity;
  site: string; status: string; reporter: string; description: string; immediateActions: string;
  lostTime?: boolean;
  oshNotificationDue?: string | null;
  oshNotifiedAt?: string | null;
}

export const mockIncidents: IncidentRecord[] = [
  { ref: 'INC-2026-041', date: '18 Jun 2026', type: 'Environmental', severity: 'danger',  site: 'Point Lisas Plant',  status: 'Investigation', reporter: 'A. Mohammed', description: 'Diesel sheen near storm drain during transfer-line cleanup.', immediateActions: 'Drain blocked, spill kit deployed, EMA notified.' },
  { ref: 'NM-2026-118',  date: '18 Jun 2026', type: 'Near Miss',     severity: 'danger',  site: 'Galeota Marine Base', status: 'Open',          reporter: 'R. Khan',      description: 'Confined space entry stopped — gas test and rescue plan missing.', immediateActions: 'Entry halted, permit suspended.' },
  { ref: 'INC-2026-039', date: '17 Jun 2026', type: 'Injury',        severity: 'warning', site: 'La Brea Yard',        status: 'Investigation', reporter: 'A. Mohammed', description: 'Contractor hand laceration during manual handling of sharp material.', immediateActions: 'First aid given, task paused for review.' },
  { ref: 'OBS-2026-226', date: '16 Jun 2026', type: 'Unsafe Act',    severity: 'warning', site: 'Piarco Logistics',    status: 'In Review',     reporter: 'L. Ramnarine', description: 'Forklift crossed pedestrian route without a spotter.', immediateActions: 'Operator coached, route segregation reviewed.' },
  { ref: 'INC-2026-037', date: '15 Jun 2026', type: 'Unsafe Condition', severity: 'danger', site: 'Port of Spain Office', status: 'Closed',       reporter: 'S. Chen',      description: 'Roof-edge maintenance task without a work-at-height control pack.', immediateActions: 'Work stopped, control pack raised.' },
];

/** Investigation (5-Whys / RCA) linked to an incident. */
export interface Investigation {
  id?:         string;  // DB uuid (absent for mock rows); required for live updates
  ref:         string;
  incidentRef: string;
  incidentDesc: string;
  severity:    HseSeverity;
  method:      string;
  status:      string;  // 'Open' | 'In Progress' | 'In Review' | 'Closed'
  lead:        string;
  due:         string;
  evidenceTotal: number;
  evidenceDone:  number;
  capaCount:   number;
  rcaCategory: string;  // '' until confirmed
  stage:       number;  // 0-6 matching workflow steps
  whys:        string[];
  rootCause:   string;
  witnesses:   string[];
  regulatory:  string[];
}

export const mockInvestigations: Investigation[] = [
  {
    ref: 'INV-041', incidentRef: 'INC-2026-041',
    incidentDesc: 'Diesel sheen near storm drain during transfer-line cleanup',
    severity: 'danger', method: '5-Whys', status: 'Open', lead: 'S. Chen',
    due: '24 Jun 2026', evidenceTotal: 5, evidenceDone: 3, capaCount: 2,
    rcaCategory: 'Equipment / Maintenance', stage: 3,
    whys: [
      'Why did diesel reach the drain? → Transfer hose coupling leaked.',
      'Why did the coupling leak? → Seal was past its inspection date.',
      'Why was it past date? → Coupling not in the PM schedule.',
      'Why not scheduled? → Asset register missing the transfer skid.',
      'Why missing? → Skid added after last register review.',
    ],
    rootCause: 'Asset register gap — temporary skid omitted from PM scheduling.',
    witnesses: ['B. Ramdial', 'C. Hosein'],
    regulatory: ['EMA notification filed', 'OSH Act s.46 — forthwith notification sent'],
  },
  {
    ref: 'INV-039', incidentRef: 'INC-2026-039',
    incidentDesc: 'Contractor hand laceration during manual handling of sharp material',
    severity: 'warning', method: '5-Whys', status: 'In Review', lead: 'A. Mohammed',
    due: '27 Jun 2026', evidenceTotal: 3, evidenceDone: 3, capaCount: 1,
    rcaCategory: 'PPE', stage: 5,
    whys: [
      'Why the laceration? → Bare-hand handling of sharp stock.',
      'Why bare-hand? → Cut-resistant gloves out of stock.',
    ],
    rootCause: 'PPE stock-out at point of work.',
    witnesses: ['Site Supervisor'],
    regulatory: ['OSH Act s.46A — 4-day notice submitted'],
  },
];

/** Corrective / preventive action (CAPA). */
export interface CapaItem {
  id?: string;  // DB uuid (absent for mock rows); required for live updates
  ref: string; title: string; source: string; owner: string; due: string; status: string; priority: HseSeverity;
}

export const mockCapa: CapaItem[] = [
  { ref: 'CA-301', title: 'Add transfer skid to PM asset register', source: 'INC-2026-041', owner: 'S. Chen',           due: '24 Jun 2026', status: 'Open',            priority: 'danger'  },
  { ref: 'CA-302', title: 'Run spill-response toolbox talk',        source: 'INC-2026-041', owner: 'Ops Supervisor',    due: '21 Jun 2026', status: 'Pending Evidence', priority: 'warning' },
  { ref: 'CA-303', title: 'Replenish cut-resistant glove stock',    source: 'INC-2026-039', owner: 'L. Ramnarine',      due: '19 Jun 2026', status: 'Overdue',         priority: 'danger'  },
  { ref: 'CA-304', title: 'Install pedestrian barriers at bay 3',   source: 'OBS-2026-226', owner: 'Warehouse Lead',    due: '28 Jun 2026', status: 'Open',            priority: 'warning' },
];

// ── Risk & JSA ──────────────────────────────────────────────────────────────────

export interface HazardRow {
  ref: string; hazard: string; category: string; site: string; likelihood: number; severity: number; controls: string;
}

export const mockHazards: HazardRow[] = [
  { ref: 'HAZ-01', hazard: 'Diesel / chemical spill to ground',     category: 'Environmental', site: 'Point Lisas Plant',  likelihood: 3, severity: 4, controls: 'Bunding, spill kits, transfer checklist' },
  { ref: 'HAZ-02', hazard: 'Confined space atmosphere',             category: 'Health',        site: 'Galeota Marine Base', likelihood: 2, severity: 5, controls: 'Gas test, PTW, standby + rescue plan' },
  { ref: 'HAZ-03', hazard: 'Forklift / pedestrian interaction',     category: 'Safety',        site: 'Piarco Logistics',    likelihood: 4, severity: 3, controls: 'Segregation, spotters, traffic plan' },
  { ref: 'HAZ-04', hazard: 'Work at height (roof edge)',            category: 'Safety',        site: 'Port of Spain Office', likelihood: 2, severity: 4, controls: 'Edge protection, harness, control pack' },
  { ref: 'HAZ-05', hazard: 'Hot work / fire',                       category: 'Safety',        site: 'Point Lisas Plant',  likelihood: 2, severity: 4, controls: 'Hot-work permit, fire watch, gas-free cert' },
];

export interface RiskAssessmentRow {
  ref: string; title: string; site: string; likelihood: number; severity: number; status: string; assessor: string;
}

export const mockRiskAssessments: RiskAssessmentRow[] = [
  { ref: 'RA-2026-12', title: 'Transfer-line cleanup', site: 'Point Lisas Plant',  likelihood: 3, severity: 4, status: 'Active',   assessor: 'S. Chen' },
  { ref: 'RA-2026-13', title: 'Vessel confined entry', site: 'Galeota Marine Base', likelihood: 2, severity: 5, status: 'Review',   assessor: 'A. Mohammed' },
  { ref: 'RA-2026-14', title: 'Loading bay operations', site: 'Piarco Logistics',   likelihood: 4, severity: 3, status: 'Active',   assessor: 'L. Ramnarine' },
];

export interface JsaRow { ref: string; task: string; site: string; steps: number; status: string; reviewed: string; }

export const mockJsas: JsaRow[] = [
  { ref: 'JSA-018', task: 'Diesel transfer & line flush', site: 'Point Lisas Plant',  steps: 7, status: 'Active', reviewed: '12 Jun 2026' },
  { ref: 'JSA-022', task: 'Confined space vessel entry',  site: 'Galeota Marine Base', steps: 9, status: 'Active', reviewed: '08 Jun 2026' },
  { ref: 'JSA-025', task: 'Forklift load / unload',       site: 'Piarco Logistics',    steps: 6, status: 'Review', reviewed: '02 Jun 2026' },
];

/** Map a likelihood (1–5) × severity (1–5) to a risk rating band. */
export function riskRating(likelihood: number, severity: number): { score: number; band: 'Low' | 'Medium' | 'High' | 'Critical'; severity: HseSeverity } {
  const score = likelihood * severity;
  if (score >= 15) return { score, band: 'Critical', severity: 'danger' };
  if (score >= 10) return { score, band: 'High',     severity: 'danger' };
  if (score >= 5)  return { score, band: 'Medium',   severity: 'warning' };
  return { score, band: 'Low', severity: 'success' };
}

// ── Permits to Work ──────────────────────────────────────────────────────────────

export interface PermitRow {
  ref: string; type: string; site: string; gate: string; status: string; holder: string; expiry: string;
}

export const mockPermitRows: PermitRow[] = [
  { ref: 'PTW-0033', type: 'Confined Space', site: 'Galeota Marine Base', gate: 'Gas test / rescue plan',     status: 'Blocked', holder: 'R. Khan',          expiry: 'Today 18:00' },
  { ref: 'PTW-0032', type: 'Hot Work',       site: 'Point Lisas Plant',  gate: 'Fire watch / gas-free cert', status: 'Overdue', holder: 'T. Baptiste',      expiry: 'Today 16:00' },
  { ref: 'PTW-0038', type: 'Work at Height', site: 'Port of Spain Office', gate: 'Harness / edge control',    status: 'Live',    holder: 'M. Joseph',        expiry: 'Tomorrow 12:00' },
  { ref: 'PTW-0040', type: 'Electrical',     site: 'Point Lisas Plant',  gate: 'LOTO verification',          status: 'Hold',    holder: 'T. Baptiste',      expiry: 'Today 20:00' },
];

export const PERMIT_TYPES = ['Confined Space', 'Hot Work', 'Work at Height', 'Electrical (LOTO)', 'Excavation', 'Lifting'] as const;

// ── Inspections & Audits ─────────────────────────────────────────────────────────

export interface InspectionRow {
  ref: string; title: string; type: string; site: string; due: string; status: string; assignee: string;
}

export const mockInspections: InspectionRow[] = [
  { ref: 'INSP-201', title: 'Monthly fire equipment check', type: 'Fire',         site: 'Point Lisas Plant',  due: '20 Jun 2026', status: 'Due',       assignee: 'A. Mohammed' },
  { ref: 'INSP-202', title: 'Lifting gear inspection',      type: 'Equipment',    site: 'Galeota Marine Base', due: '22 Jun 2026', status: 'Scheduled', assignee: 'M. Joseph' },
  { ref: 'INSP-203', title: 'Housekeeping audit',           type: 'Housekeeping', site: 'Piarco Logistics',    due: '19 Jun 2026', status: 'Overdue',   assignee: 'L. Ramnarine' },
  { ref: 'INSP-204', title: 'Chemical storage audit',       type: 'Chemical',     site: 'Point Lisas Plant',  due: '25 Jun 2026', status: 'Scheduled', assignee: 'S. Chen' },
];

export interface FindingRow {
  ref: string; inspection: string; finding: string; severity: HseSeverity; status: string; site: string;
}

export const mockFindings: FindingRow[] = [
  { ref: 'FND-051', inspection: 'INSP-203', finding: 'Blocked emergency exit in bay 3',        severity: 'danger',  status: 'Open',  site: 'Piarco Logistics' },
  { ref: 'FND-052', inspection: 'INSP-203', finding: 'Spill pallet at capacity, not emptied',  severity: 'warning', status: 'Open',  site: 'Piarco Logistics' },
  { ref: 'FND-053', inspection: 'INSP-201', finding: 'Extinguisher overdue for service',       severity: 'warning', status: 'Closed', site: 'Point Lisas Plant' },
];

// ── Training & Competency ────────────────────────────────────────────────────────

export const TRAINING_COURSES = ['Confined Space', 'Work at Height', 'Fire Watch', 'First Aid', 'Spill Response', 'Forklift'] as const;

export type CompetencyStatus = 'current' | 'due' | 'expired' | 'none';

export interface CompetencyCell { course: string; status: CompetencyStatus; expiry?: string; }
export interface CompetencyRow { worker: HseWorker; cells: CompetencyCell[]; }

export const mockCompetency: CompetencyRow[] = mockHseWorkers.slice(0, 8).map((w, i) => ({
  worker: w,
  cells: TRAINING_COURSES.map((course, c) => {
    const seed = (i + c) % 4;
    const status: CompetencyStatus = seed === 0 ? 'expired' : seed === 1 ? 'due' : seed === 3 ? 'none' : 'current';
    return { course, status, expiry: status === 'none' ? undefined : `${10 + ((i + c) % 18)} ${['Jul', 'Aug', 'Sep', 'Oct'][(i + c) % 4]} 2026` };
  }),
}));

export interface CertificationRow {
  ref: string; worker: string; course: string; issued: string; expiry: string; status: string;
}

export const mockCertifications: CertificationRow[] = [
  { ref: 'CERT-1101', worker: 'Reza Khan',         course: 'Confined Space', issued: '12 Jul 2025', expiry: '12 Jul 2026', status: 'Due'     },
  { ref: 'CERT-1102', worker: 'Marlon Joseph',     course: 'Work at Height', issued: '03 Sep 2025', expiry: '03 Sep 2026', status: 'Current' },
  { ref: 'CERT-1103', worker: 'Andre Williams',    course: 'First Aid',      issued: '20 Jan 2024', expiry: '20 Jan 2026', status: 'Expired' },
  { ref: 'CERT-1104', worker: 'Dwayne Charles',    course: 'Forklift',       issued: '15 Mar 2025', expiry: '15 Mar 2027', status: 'Current' },
  { ref: 'CERT-1105', worker: 'Kavita Persad',     course: 'Spill Response', issued: '08 Jun 2025', expiry: '08 Jun 2026', status: 'Due'     },
];

// ── Toolbox Talks ────────────────────────────────────────────────────────────────

export interface ToolboxTalkRow {
  ref: string; topic: string; date: string; site: string; presenter: string; attendees: number; status: string;
}

export const mockToolboxTalks: ToolboxTalkRow[] = [
  { ref: 'TBT-088', topic: 'Spill response & EMA reporting', date: '18 Jun 2026', site: 'Point Lisas Plant',  presenter: 'S. Chen',      attendees: 9,  status: 'Complete' },
  { ref: 'TBT-087', topic: 'Confined space rescue refresh',  date: '17 Jun 2026', site: 'Galeota Marine Base', presenter: 'A. Mohammed', attendees: 6,  status: 'Complete' },
  { ref: 'TBT-086', topic: 'Pedestrian / forklift safety',   date: '16 Jun 2026', site: 'Piarco Logistics',    presenter: 'L. Ramnarine', attendees: 7,  status: 'Complete' },
  { ref: 'TBT-089', topic: 'Hot work & fire watch',          date: '20 Jun 2026', site: 'Point Lisas Plant',  presenter: 'T. Baptiste',  attendees: 0,  status: 'Scheduled' },
];

export const TOOLBOX_TOPICS = ['Spill Response', 'Confined Space', 'Work at Height', 'Manual Handling', 'Traffic Management', 'Hot Work', 'PPE Use', 'Emergency Response'] as const;

// ── Documents & SDS ──────────────────────────────────────────────────────────────

export interface HseDocRow {
  ref: string; title: string; type: string; owner: string; version: string; status: string; review: string;
}

export const mockHseDocs: HseDocRow[] = [
  { ref: 'DOC-HSE-0142', title: 'Chemical Handling Procedure', type: 'SOP',       owner: 'HSE',         version: 'v2.1', status: 'Published',  review: '15 Oct 2026' },
  { ref: 'DOC-HSE-0118', title: 'Permit to Work Standard',     type: 'Procedure', owner: 'HSE',         version: 'v3.0', status: 'Published',  review: '30 Sep 2026' },
  { ref: 'DOC-HSE-0205', title: 'Emergency Response Plan',     type: 'Plan',      owner: 'HSE',         version: 'v1.4', status: 'Review Due', review: '30 Jun 2026' },
  { ref: 'DOC-HSE-0090', title: 'HSE Policy Statement',        type: 'Policy',    owner: 'Management',  version: 'v4.2', status: 'Draft',      review: '01 Dec 2026' },
];

export const HSE_DOC_TYPES = ['Policy', 'Procedure', 'SOP', 'Plan', 'Form', 'Register'] as const;

export interface SdsRow {
  ref: string; chemical: string; supplier: string; hazardClass: string; revision: string; status: string;
}

export const mockSds: SdsRow[] = [
  { ref: 'SDS-001', chemical: 'Diesel (Automotive)',        supplier: 'NP Trinidad',      hazardClass: 'Flammable Liquid 3',  revision: '2025-04', status: 'Current' },
  { ref: 'SDS-002', chemical: 'Sodium Hydroxide 50%',       supplier: 'Caribbean Chem',   hazardClass: 'Corrosive 8',         revision: '2024-11', status: 'Review' },
  { ref: 'SDS-003', chemical: 'Acetylene',                  supplier: 'Industrial Gases', hazardClass: 'Flammable Gas 2',    revision: '2025-01', status: 'Current' },
  { ref: 'SDS-004', chemical: 'Hydraulic Oil ISO 46',       supplier: 'Lubricants Ltd',   hazardClass: 'Not classified',      revision: '2023-08', status: 'Expired' },
];

// ── PPE Assignments ───────────────────────────────────────────────────────────

export interface PpeAssignment {
  id:       string;
  empId:    number;
  empName:  string;
  ppeType:  string;
  item:     string;
  issued:   string;
  expiry:   string;
  status:   'active' | 'due' | 'expired';
}

export const mockPpeAssignments: PpeAssignment[] = [
  { id: 'ASN-001', empId: 1, empName: 'Andre Williams',    ppeType: 'Helmet',    item: 'Hard Hat Type A',          issued: '10 Jan 2026', expiry: '10 Jan 2027', status: 'active'  },
  { id: 'ASN-002', empId: 1, empName: 'Andre Williams',    ppeType: 'Gloves',    item: 'Leather Gloves',           issued: '10 Jan 2026', expiry: '01 Dec 2026', status: 'active'  },
  { id: 'ASN-003', empId: 1, empName: 'Andre Williams',    ppeType: 'Boots',     item: 'Steel Toe Boots',          issued: '10 Jan 2026', expiry: '10 Jan 2027', status: 'active'  },
  { id: 'ASN-004', empId: 2, empName: 'Jamal Lewis',       ppeType: 'Helmet',    item: 'Hard Hat Type A',          issued: '15 Feb 2026', expiry: '15 Feb 2027', status: 'active'  },
  { id: 'ASN-005', empId: 2, empName: 'Jamal Lewis',       ppeType: 'Gloves',    item: 'Leather Gloves',           issued: '15 Feb 2026', expiry: '01 Dec 2026', status: 'due'     },
  { id: 'ASN-006', empId: 3, empName: 'Marlon Joseph',     ppeType: 'Harness',   item: 'Fall Harness',             issued: '01 Mar 2026', expiry: '30 Sep 2026', status: 'due'     },
  { id: 'ASN-007', empId: 3, empName: 'Marlon Joseph',     ppeType: 'Helmet',    item: 'Hard Hat Type A',          issued: '01 Mar 2026', expiry: '01 Mar 2027', status: 'active'  },
  { id: 'ASN-008', empId: 4, empName: 'Anya Mohammed',     ppeType: 'Vest',      item: 'High-Vis Vest',            issued: '20 Jan 2026', expiry: '20 Jan 2027', status: 'active'  },
  { id: 'ASN-009', empId: 5, empName: 'Kavita Persad',     ppeType: 'Helmet',    item: 'Hard Hat Type A',          issued: '08 Feb 2026', expiry: '08 Feb 2027', status: 'active'  },
  { id: 'ASN-010', empId: 6, empName: 'Dwayne Charles',    ppeType: 'Boots',     item: 'Steel Toe Boots',          issued: '12 Mar 2026', expiry: '12 Mar 2027', status: 'active'  },
  { id: 'ASN-011', empId: 7, empName: 'Terrence Baptiste', ppeType: 'Gloves',    item: 'Leather Gloves',           issued: '05 Jan 2026', expiry: '10 Aug 2026', status: 'expired' },
  { id: 'ASN-012', empId: 7, empName: 'Terrence Baptiste', ppeType: 'Helmet',    item: 'Hard Hat Type A',          issued: '05 Jan 2026', expiry: '05 Jan 2027', status: 'active'  },
];

// ── PPE Renewals ───────────────────────────────────────────────────────────────

export interface PpeRenewalRow {
  ref:     string;
  empName: string;
  site:    string;
  item:    string;
  issued:  string;
  expiry:  string;
  status:  'active' | 'upcoming' | 'overdue';
}

export const mockPpeRenewals: PpeRenewalRow[] = [
  { ref: 'RNW-001', empName: 'Andre Williams',    site: 'Point Lisas Plant',   item: 'Hard Hat Type A',  issued: '10 Jan 2026', expiry: '10 Jan 2027', status: 'active'   },
  { ref: 'RNW-002', empName: 'Jamal Lewis',       site: 'La Brea Yard',        item: 'Leather Gloves',   issued: '15 Feb 2026', expiry: '01 Dec 2026', status: 'upcoming' },
  { ref: 'RNW-003', empName: 'Marlon Joseph',     site: 'Galeota Marine Base', item: 'Fall Harness',     issued: '01 Mar 2026', expiry: '30 Sep 2026', status: 'overdue'  },
  { ref: 'RNW-004', empName: 'Terrence Baptiste', site: 'Point Lisas Plant',   item: 'Leather Gloves',   issued: '05 Jan 2026', expiry: '10 Aug 2026', status: 'overdue'  },
  { ref: 'RNW-005', empName: 'Kavita Persad',     site: 'Point Lisas Plant',   item: 'Safety Goggles',   issued: '08 Feb 2026', expiry: '20 Jun 2027', status: 'active'   },
  { ref: 'RNW-006', empName: 'Dwayne Charles',    site: 'Piarco Logistics',    item: 'High-Vis Vest',    issued: '12 Mar 2026', expiry: '15 Mar 2027', status: 'active'   },
];

// ── PPE Returns ────────────────────────────────────────────────────────────────

export interface PpeReturnRow {
  ref:         string;
  item:        string;
  empName:     string;
  site:        string;
  returnDate:  string;
  condition:   string;
  disposition: string;
  status:      string;
}

export const mockPpeReturns: PpeReturnRow[] = [
  { ref: 'RET-001', item: 'Ear Muffs',      empName: 'Jamal Lewis',    site: 'La Brea Yard',        returnDate: '01 Jun 2026', condition: 'Damaged',  disposition: 'Disposal',        status: 'closed'  },
  { ref: 'RET-002', item: 'Fall Harness',   empName: 'Marlon Joseph',  site: 'Galeota Marine Base', returnDate: '15 May 2026', condition: 'Good',     disposition: 'Return to Stock', status: 'closed'  },
  { ref: 'RET-003', item: 'Leather Gloves', empName: 'Terrence Baptiste', site: 'Point Lisas Plant', returnDate: '10 Jun 2026', condition: 'Worn',   disposition: 'Quarantine',      status: 'pending' },
];

// ── PPE Requests ───────────────────────────────────────────────────────────────

export interface PpeRequestRow {
  ref:       string;
  type:      string;
  item:      string;
  empName:   string;
  site:      string;
  reason:    string;
  submitted: string;
  status:    string;
  priority:  'urgent' | 'pending' | 'review' | 'ready';
}

export const mockPpeRequests: PpeRequestRow[] = [
  { ref: 'REQ-1048', type: 'New Issue',     item: 'Confined Space Kit',  empName: 'Reza Khan',         site: 'Galeota Marine Base', reason: 'New site assignment',          submitted: '17 Jun 2026', status: 'Review',  priority: 'review'  },
  { ref: 'REQ-1049', type: 'Replacement',   item: 'Chemical Gloves',     empName: 'Andre Williams',    site: 'Point Lisas Plant',   reason: 'Chemical contamination damage', submitted: '18 Jun 2026', status: 'Urgent',  priority: 'urgent'  },
  { ref: 'REQ-1050', type: 'Role Kit',      item: 'Steel Toe Boots',     empName: 'Dwayne Charles',    site: 'Piarco Logistics',    reason: 'New site assignment kit',       submitted: '16 Jun 2026', status: 'Ready',   priority: 'ready'   },
  { ref: 'REQ-1051', type: 'Replacement',   item: 'Hard Hat Type A',     empName: 'Kavita Persad',     site: 'Point Lisas Plant',   reason: 'Impact damage during lifting',  submitted: '19 Jun 2026', status: 'Pending', priority: 'pending' },
];

// ── PPE Site Kits ──────────────────────────────────────────────────────────────

export interface PpeKitRow {
  site:       string;
  kit:        string;
  custodian:  string;
  lastAudit:  string;
  status:     string;
  missing:    number;
}

export const mockPpeKits: PpeKitRow[] = [
  { site: 'Galeota Marine Base', kit: 'Confined Space Kit',     custodian: 'Reza Khan',          lastAudit: '01 Jun 2026', status: 'Missing item', missing: 1 },
  { site: 'Point Lisas Plant',   kit: 'Hot Work Kit',           custodian: 'Terrence Baptiste',  lastAudit: '07 Jun 2026', status: 'Ready',        missing: 0 },
  { site: 'La Brea Yard',        kit: 'Chemical Handling Kit',  custodian: 'Jamal Lewis',        lastAudit: '29 May 2026', status: 'Ready',        missing: 0 },
  { site: 'Piarco Logistics',    kit: 'Traffic Safety Kit',     custodian: 'Dwayne Charles',     lastAudit: '03 Jun 2026', status: 'Missing item', missing: 2 },
  { site: 'Port of Spain Office',kit: 'First Aid Kit',          custodian: 'Anya Mohammed',      lastAudit: '10 Jun 2026', status: 'Ready',        missing: 0 },
];
