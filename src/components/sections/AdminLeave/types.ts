/**
 * src/components/sections/AdminLeave/types.ts
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

export type LeaveStatus   = 'pending' | 'approved' | 'rejected';
export type LeaveType     = 'sick' | 'casual' | 'annual' | 'medical';
export type LeaveTabFilter = 'all' | 'pending' | 'approved' | 'rejected';

export interface LeaveEmployee {
  fullName:   string;
  position:   string;
  department: string;
  username:   string;
}

/** Full leave record — returned by listAllLeaves */
export interface LeaveRecord {
  id:          string;
  employee:    string;          // employee full name (flat field from list)
  department:  string;
  type:        LeaveType;
  fromDate:    string;          // ISO date
  toDate:      string;
  days:        number;
  status:      LeaveStatus;
  reason:      string;
  appliedOn:   string;          // ISO date
}

/** Detailed leave — returned by getLeaveById */
export interface LeaveDetail {
  id:             string;
  type:           LeaveType;
  fromDate:       string;
  toDate:         string;
  days:           number;
  status:         LeaveStatus;
  reason:         string;
  appliedAt:      string;
  reviewedAt:     string | null;
  reviewedBy:     string | null;
  reviewNotes:    string | null;
  companyName:    string;
  companyLogoUrl: string | null;
  employee: LeaveEmployee;
}

export interface LeaveStats {
  pending:  number;
  approved: number;
  rejected: number;
  total:    number;
}
