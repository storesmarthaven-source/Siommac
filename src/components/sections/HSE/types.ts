/**
 * src/components/sections/HSE/types.ts
 *
 * Typed data models for the HSE / PPE Manager module. This is a UI-only build —
 * the `mock*` exports below stand in for a future backend. Keeping the models
 * here (rather than inline in JSX) means wiring real data later is a drop-in:
 * replace the mock arrays with query hooks returning the same shapes.
 */

// ── Incidents (HSE Dashboard) ─────────────────────────────────────────────────

export type IncidentSeverity = 'high' | 'medium' | 'low';
export type IncidentStatus   = 'open' | 'investigating' | 'review' | 'resolved';

export interface Incident {
  id:       string;
  title:    string;
  site:     string;
  severity: IncidentSeverity;
  status:   IncidentStatus;
}

export const mockIncidents: Incident[] = [
  { id: 'INC-1042', title: 'Chemical spill in Lab A',        site: 'Houston',   severity: 'high',   status: 'open' },
  { id: 'INC-1038', title: 'Fall from height (scaffold)',    site: 'Dubai',     severity: 'high',   status: 'investigating' },
  { id: 'INC-1029', title: 'Electrical shock - minor',       site: 'London',    severity: 'medium', status: 'review' },
  { id: 'INC-1021', title: 'Gas leak detected',              site: 'Singapore', severity: 'high',   status: 'open' },
  { id: 'INC-1015', title: 'Slip & trip injury',             site: 'Houston',   severity: 'low',    status: 'resolved' },
  { id: 'INC-1008', title: 'Near miss: crane swing',         site: 'Dubai',     severity: 'medium', status: 'investigating' },
];

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
