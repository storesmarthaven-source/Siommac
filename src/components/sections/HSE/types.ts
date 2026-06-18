/**
 * src/components/sections/HSE/types.ts
 *
 * Typed data models for the HSE / PPE Manager module. This is a UI-only build —
 * the `mock*` exports below stand in for a future backend. Keeping the models
 * here (rather than inline in JSX) means wiring real data later is a drop-in:
 * replace the mock arrays with query hooks returning the same shapes.
 */

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

/** HSE status text → Siomac .vt-pill variant. */
export function hsePill(text: string): string {
  const t = text.toLowerCase();
  if (/critical|blocked|overdue|stopped/.test(t)) return 'vt-pill is-off';
  if (/hold|pending|due|high|review/.test(t))     return 'vt-pill is-warn';
  if (/live|ready|complete|open/.test(t))         return 'vt-pill is-on';
  return 'vt-pill is-info';
}

/** Severity → left-accent color (for KPI/readiness cards). */
export function hseSeverityColor(s: HseSeverity): string {
  switch (s) {
    case 'danger':  return 'var(--siomac-red)';
    case 'warning': return '#d97706';
    case 'success': return '#16a34a';
    default:        return '#2563eb';
  }
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
  { id: 1, name: 'John Doe',       role: 'Welder',       department: 'Production',   site: 'Houston',   supervisor: 'Sarah Chen' },
  { id: 2, name: 'Jane Smith',     role: 'Electrician',  department: 'Maintenance',  site: 'Dubai',     supervisor: 'Mike Okafor' },
  { id: 3, name: 'Carlos Garcia',  role: 'Rigger',       department: 'Construction', site: 'London',    supervisor: 'Lisa Wang' },
  { id: 4, name: 'Anna Kowalski',  role: 'HSE Officer',  department: 'HSE',          site: 'Singapore', supervisor: 'Sarah Chen' },
  { id: 5, name: 'David Chen',     role: 'Site Manager', department: 'Management',    site: 'Houston',   supervisor: 'Sarah Chen' },
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

export function ppePillClass(status: string): string {
  switch (status) {
    case 'available':
    case 'compliant':
    case 'active':
    case 'current':
    case 'pass':
    case 'ready':       return 'vt-pill is-on';
    case 'low':
    case 'upcoming':
    case 'pending':
    case 'review':
    case 'due':         return 'vt-pill is-warn';
    case 'expired':
    case 'overdue':
    case 'missing':
    case 'fail':
    case 'urgent':      return 'vt-pill is-off';
    default:            return 'vt-pill is-info';
  }
}
