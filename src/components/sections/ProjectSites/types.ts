/**
 * src/components/sections/ProjectSites/types.ts
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

export interface AssignedEmployee {
  id:       string;
  name:     string;
  photoUrl?: string;
}

export interface ProjectSite {
  id:                string | number;
  name:              string;
  address:           string;
  latitude:          number | string;
  longitude:         number | string;
  radius:            number;
  description?:      string;
  /** Owning department id; '' = org-wide / unassigned. */
  departmentId?:     string;
  assignedEmployees: AssignedEmployee[];
  /** Derived client-side from liveData */
  isActive?:         boolean;
}

export interface EmployeeListItem {
  id:       string;
  name:     string;
  photoUrl?: string;
}

export interface SiteFormValues {
  name:         string;
  address:      string;
  latitude:     string;
  longitude:    string;
  radius:       string;
  description:  string;
  departmentId: string;
}

export const EMPTY_FORM: SiteFormValues = {
  name:         '',
  address:      '',
  latitude:     '',
  longitude:    '',
  radius:       '200',
  description:  '',
  departmentId: '',
};

export interface DeptOption {
  id:   string;
  name: string;
}

export type SiteFilter = 'all' | 'active' | 'inactive';

/** Row shape from getLiveAttendance used for computing isActive */
export interface LiveRow {
  siteId?:     string | number;
  isCheckedOut?: boolean;
  status?:     string;
}
