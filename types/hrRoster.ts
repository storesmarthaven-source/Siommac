/**
 * types/hrRoster.ts — shared camelCase DTO for HR Shift / Roster Scheduling.
 * Imported by both backend (netlify/functions/lib/hr/roster*.ts) and frontend
 * (src/api/hr/roster.ts). Never redeclare per side.
 */

// ── Status & kind literals ─────────────────────────────────────────────────────

export type RosterStatus = 'draft' | 'pending_approval' | 'returned' | 'published' | 'archived';
export type AssignmentKind = 'shift' | 'off' | 'leave' | 'open';
export type AssignmentSource = 'manual' | 'rotation' | 'leave_sync';

// ── Shift templates ────────────────────────────────────────────────────────────

export interface ShiftTemplate {
  id:             string;
  code:           string;
  name:           string;
  startsAt:       string;  // HH:MM:SS
  endsAt:         string;  // HH:MM:SS
  crossesMidnight: boolean;
  breakMinutes:   number;
  paidHours:      number;
  colour:         string | null;
  siteId:         string | null;
  isActive:       boolean;
  createdBy:      string | null;
  createdAt:      string;
  updatedAt:      string;
}

export interface UpsertShiftTemplateArgs {
  id?:             string;   // present = update
  code:            string;
  name:            string;
  startsAt:        string;
  endsAt:          string;
  crossesMidnight?: boolean;
  breakMinutes?:   number;
  paidHours:       number;
  colour?:         string | null;
  siteId?:         string | null;
  isActive?:       boolean;
}

// ── Rotation patterns ─────────────────────────────────────────────────────────

export interface RotationPatternDay {
  dayIndex:           number;           // 0-based within cycle
  shiftTemplateCode:  string | 'off';
}

export interface RotationPattern {
  id:         string;
  code:       string;
  name:       string;
  cycleDays:  number;
  pattern:    RotationPatternDay[];
  isActive:   boolean;
  createdBy:  string | null;
  createdAt:  string;
  updatedAt:  string;
}

export interface UpsertRotationPatternArgs {
  id?:        string;
  code:       string;
  name:       string;
  cycleDays:  number;
  pattern:    RotationPatternDay[];
  isActive?:  boolean;
}

// ── Coverage requirements ─────────────────────────────────────────────────────

export interface CoverageRequirement {
  id:                string;
  siteId:            string | null;
  departmentId:      string | null;
  positionId:        string | null;
  shiftTemplateId:   string;
  shiftTemplateName: string | null;
  requiredHeadcount: number;
  dayOfWeek:         number | null;  // 0=Sun..6=Sat, null=every day
  isActive:          boolean;
  createdAt:         string;
  updatedAt:         string;
}

export interface UpsertCoverageRequirementArgs {
  id?:               string;
  siteId?:           string | null;
  departmentId?:     string | null;
  positionId?:       string | null;
  shiftTemplateId:   string;
  requiredHeadcount: number;
  dayOfWeek?:        number | null;
  isActive?:         boolean;
}

// ── Rosters ───────────────────────────────────────────────────────────────────

export interface RosterRow {
  id:                 string;
  rosterNo:           string;
  title:              string;
  siteId:             string;
  siteName:           string | null;
  departmentId:       string | null;
  departmentName:     string | null;
  periodStart:        string;  // YYYY-MM-DD
  periodEnd:          string;
  status:             RosterStatus;
  rotationPatternId:  string | null;
  workflowId:         string | null;
  assignmentCount:    number;
  openShiftCount:     number;
  createdBy:          string | null;
  createdByName:      string | null;
  publishedBy:        string | null;
  publishedAt:        string | null;
  createdAt:          string;
  updatedAt:          string;
}

export interface CreateRosterArgs {
  title:              string;
  siteId:             string;
  departmentId?:      string | null;
  periodStart:        string;
  periodEnd:          string;
  rotationPatternId?: string | null;
}

// ── Shift assignments ─────────────────────────────────────────────────────────

export interface ShiftAssignment {
  id:               string;
  rosterId:         string;
  employeeId:       string;
  employeeName:     string | null;
  workDate:         string;
  shiftTemplateId:  string | null;
  shiftCode:        string | null;
  shiftName:        string | null;
  shiftColour:      string | null;
  kind:             AssignmentKind;
  hours:            number | null;
  note:             string | null;
  source:           AssignmentSource;
  createdBy:        string | null;
  createdAt:        string;
  updatedAt:        string;
}

export interface UpsertAssignmentArgs {
  rosterId:         string;
  employeeId:       string;
  workDate:         string;
  shiftTemplateId?: string | null;
  kind:             AssignmentKind;
  hours?:           number | null;
  note?:            string | null;
  source?:          AssignmentSource;
}

export interface BulkUpsertAssignmentsArgs {
  rosterId:     string;
  assignments:  Omit<UpsertAssignmentArgs, 'rosterId'>[];
}

// ── Coverage gaps ─────────────────────────────────────────────────────────────

export interface CoverageGap {
  workDate:          string;
  shiftTemplateId:   string;
  shiftCode:         string;
  shiftName:         string;
  siteId:            string | null;
  departmentId:      string | null;
  positionId:        string | null;
  required:          number;
  assigned:          number;
  gap:               number;  // required - assigned (>0 = shortfall)
}

// ── My shifts (employee self-view) ────────────────────────────────────────────

export interface MyShift {
  workDate:        string;
  kind:            AssignmentKind;
  shiftCode:       string | null;
  shiftName:       string | null;
  startsAt:        string | null;
  endsAt:          string | null;
  paidHours:       number | null;
  siteId:          string | null;
  siteName:        string | null;
  departmentId:    string | null;
  note:            string | null;
}

// ── Roster detail (list + assignments) ────────────────────────────────────────

export interface RosterDetail {
  roster:       RosterRow;
  assignments:  ShiftAssignment[];
  employees:    { id: string; fullName: string | null; departmentId: string | null }[];
}

// ── Report types ──────────────────────────────────────────────────────────────

export interface RosterStats {
  totalRosters:      number;
  publishedRosters:  number;
  draftRosters:      number;
  openShifts:        number;
  coveragePct:       number;  // (assigned / required) * 100
}

export interface EmployeeHoursSummary {
  employeeId:    string;
  employeeName:  string | null;
  totalHours:    number;
  shiftCount:    number;
  offDays:       number;
  leaveDays:     number;
}
