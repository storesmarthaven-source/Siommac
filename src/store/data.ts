/**
 * src/store/data.ts  —  Shared reference data bridge
 *
 * Architecture note — single cache rule:
 *   TanStack Query is the authoritative cache for all server data.
 *   This store does NOT duplicate that cache.  Its only job is to hold the
 *   derived, transformed copies that legacy JS modules need to read without
 *   access to a React query client (e.g. the live-map section reading the
 *   employee list synchronously).
 *
 *   Once all sections are ported to Preact (Phase 7), this store is removed
 *   entirely — sections will use `useSuspenseQuery` hooks directly.
 *
 * What lives here:
 *   ✓ Slim, transformed views of reference lists (no raw DB rows)
 *   ✓ Loading flags for sections that render a skeleton while data arrives
 *   ✓ `patchEmployee` for optimistic updates (writes to both this store and
 *     the TanStack Query cache via the registered queryClient)
 *
 * What does NOT live here:
 *   ✗ Raw API response data — use TanStack Query cache
 *   ✗ Per-section data (attendance rows, payslips, messages) — query cache only
 *   ✗ Derived aggregations that TanStack Query selectors can compute
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md
 */

import { create }            from 'zustand';
import type { QueryClient }  from '@tanstack/query-core';
import type { AppUser, Department, ProjectSite } from '../../types/db';

// ── Slim employee representation ──────────────────────────────────────────────
// Strips the password hash and bulky fields not needed client-side.

export interface EmployeeSummary {
  id:             string;
  username:       string;
  fullName:       string;
  role:           AppUser['role'];
  status:         AppUser['status'];
  departmentId:   string | null;
  position:       string | null;
  /** Signed URL (preferred) falling back to raw storage path */
  profileImage:   string | null;
  employeeNumber: string | null;
}

/** Map a full AppUser DB row → client-safe summary */
export function toEmployeeSummary(u: AppUser): EmployeeSummary {
  return {
    id:             u.id,
    username:       u.username,
    fullName:       u.full_name,
    role:           u.role,
    status:         u.status,
    departmentId:   u.department_id,
    position:       u.position,
    profileImage:   u.signed_url ?? u.profile_image,
    employeeNumber: u.employee_number,
  };
}

// ── State shape ───────────────────────────────────────────────────────────────

export interface DataState {
  employees:    EmployeeSummary[];
  departments:  Department[];
  projectSites: ProjectSite[];

  /** Derived count — kept in sync with employees array */
  totalActiveEmployees: number;

  /** Per-list loading flags — set true before fetch, false in setXxx actions */
  employeesLoading:    boolean;
  departmentsLoading:  boolean;
  sitesLoading:        boolean;

  // ── Actions ────────────────────────────────────────────────────────────────

  /**
   * Called by TanStack Query's onSuccess (or by legacy JS after apiAction).
   * Updates this store AND invalidates the 'employees' query key so any
   * active useQuery hooks re-render with fresh data.
   */
  setEmployees:    (list: EmployeeSummary[]) => void;
  setDepartments:  (list: Department[])      => void;
  setProjectSites: (list: ProjectSite[])     => void;

  setEmployeesLoading:   (v: boolean) => void;
  setDepartmentsLoading: (v: boolean) => void;
  setSitesLoading:       (v: boolean) => void;

  /**
   * Optimistic update — patches one employee in this store immediately, then
   * invalidates the TanStack Query cache so the next background refetch
   * reconciles any discrepancy.
   */
  patchEmployee: (id: string, patch: Partial<EmployeeSummary>) => void;

  /** Called on logout — clears all lists and resets flags */
  reset: () => void;
}

// ── QueryClient bridge ────────────────────────────────────────────────────────
// Registered once by the app root after the QueryClient is created.
// Allows this store to invalidate query cache entries without importing
// React hooks (which would create a circular dependency).

let _queryClient: QueryClient | null = null;

export function registerQueryClient(qc: QueryClient): void {
  _queryClient = qc;
}

function _invalidate(...queryKey: string[]): void {
  _queryClient?.invalidateQueries({ queryKey });
}

// ── Initial (empty) state ─────────────────────────────────────────────────────

const EMPTY = {
  employees:            [] as EmployeeSummary[],
  departments:          [] as Department[],
  projectSites:         [] as ProjectSite[],
  totalActiveEmployees: 0,
  employeesLoading:     false,
  departmentsLoading:   false,
  sitesLoading:         false,
} as const;

// ── Store ─────────────────────────────────────────────────────────────────────

export const useDataStore = create<DataState>()((set) => ({
  ...EMPTY,

  setEmployees(list) {
    const active = list.filter((e) => e.status === 'active').length;
    set({
      employees:            list,
      totalActiveEmployees: active,
      employeesLoading:     false,
    });
    // Keep TanStack Query cache in sync
    _invalidate('employees');
  },

  setDepartments(list) {
    set({ departments: list, departmentsLoading: false });
    _invalidate('departments');
  },

  setProjectSites(list) {
    set({ projectSites: list, sitesLoading: false });
    _invalidate('projectSites');
  },

  setEmployeesLoading(v)   { set({ employeesLoading:   v }); },
  setDepartmentsLoading(v) { set({ departmentsLoading: v }); },
  setSitesLoading(v)       { set({ sitesLoading:       v }); },

  patchEmployee(id, patch) {
    set((s) => ({
      employees: s.employees.map((e) => e.id === id ? { ...e, ...patch } : e),
    }));
    // Invalidate so next render reconciles from server
    _invalidate('employees');
  },

  reset() {
    set(EMPTY);
    // Invalidate all reference data on logout
    _invalidate('employees');
    _invalidate('departments');
    _invalidate('projectSites');
  },
}));

// ── Selectors ─────────────────────────────────────────────────────────────────

export const selectEmployees    = (s: DataState) => s.employees;
export const selectDepartments  = (s: DataState) => s.departments;
export const selectProjectSites = (s: DataState) => s.projectSites;
export const selectTotalActive  = (s: DataState) => s.totalActiveEmployees;

/** Stable selector factory — memoised by deptId at the component level */
export const selectDeptName = (deptId: string | null) => (s: DataState): string =>
  deptId ? (s.departments.find((d) => d.id === deptId)?.name ?? '') : '';
