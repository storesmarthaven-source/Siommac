/**
 * src/components/sections/Employees/hooks.ts
 *
 * TanStack Query hooks for the Employees domain.
 *
 * Design decisions:
 *   - useQuery for reads  — automatic background refresh, deduplication, caching
 *   - useMutation for writes — no auto-retry, onSuccess invalidates related queries
 *   - queryClient obtained from the module-level singleton (registered in main.tsx)
 *   - AbortSignal threaded through to fetch calls for cancellation on unmount
 *   - Toast feedback on mutation success/error via the ui store helper
 *
 * Adding a new query:
 *   1. Add the fetch function to api.ts
 *   2. Add a query key to queryKeys.ts
 *   3. Add the hook here following the established pattern
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { toast } from '@store/ui';
import { useSessionStore } from '@store/session';
import {
  listEmployees, getEmployee, addEmployee, updateEmployee, deleteEmployee,
  listDepartments, listManagers, listAssignableRoles, addDepartment, updateDepartment, deleteDepartment,
  getMyHistory, getMyPayslips,
  getDeptStats, getDeptEmployees,
  getAdminStats, getRecentAttendance,
} from './api';
import {
  employeeKeys, departmentKeys, historyKeys,
  payslipKeys, dashboardKeys,
} from './queryKeys';

// ── Employee queries ──────────────────────────────────────────────────────────

export function useEmployeeList() {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  return useQuery({
    queryKey: employeeKeys.list(),
    queryFn:  ({ signal }) => listEmployees(signal),
    staleTime: 60_000,
    enabled:  isAuthenticated,
  });
}

export function useEmployee(username: string | null) {
  return useQuery({
    queryKey: employeeKeys.detail(username ?? ''),
    queryFn:  ({ signal }) => getEmployee(username!, signal),
    enabled:  !!username,
    staleTime: 30_000,
  });
}

// ── Employee mutations ────────────────────────────────────────────────────────

export function useAddEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: addEmployee,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: employeeKeys.all });
      toast.success('Employee added successfully.');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to add employee.');
    },
  });
}

export function useUpdateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateEmployee,
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: employeeKeys.all });
      void qc.invalidateQueries({ queryKey: employeeKeys.detail(vars.username) });
      toast.success('Employee updated successfully.');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to update employee.');
    },
  });
}

export function useDeleteEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteEmployee,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: employeeKeys.all });
      toast.success('Employee deleted.');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to delete employee.');
    },
  });
}

// ── Department queries ────────────────────────────────────────────────────────

export function useDepartmentList() {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  return useQuery({
    queryKey: departmentKeys.list(),
    queryFn:  ({ signal }) => listDepartments(signal),
    staleTime: 60_000,
    enabled:  isAuthenticated,
  });
}

export function useManagerList() {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  return useQuery({
    queryKey: departmentKeys.managers(),
    queryFn:  ({ signal }) => listManagers(signal),
    staleTime: 60_000,
    enabled:  isAuthenticated,
  });
}

export function useAssignableRoles() {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  return useQuery({
    queryKey: ['employees', 'assignableRoles'] as const,
    queryFn:  ({ signal }) => listAssignableRoles(signal),
    staleTime: 60_000,
    enabled:  isAuthenticated,
  });
}

// ── Department mutations ──────────────────────────────────────────────────────

export function useAddDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: addDepartment,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: departmentKeys.all });
      // Employee list includes department names — invalidate it too
      void qc.invalidateQueries({ queryKey: employeeKeys.all });
      toast.success('Department added.');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to add department.');
    },
  });
}

export function useUpdateDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateDepartment,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: departmentKeys.all });
      void qc.invalidateQueries({ queryKey: employeeKeys.all });
      toast.success('Department updated.');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to update department.');
    },
  });
}

export function useDeleteDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteDepartment,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: departmentKeys.all });
      void qc.invalidateQueries({ queryKey: employeeKeys.all });
      toast.success('Department deleted.');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to delete department.');
    },
  });
}

// ── History query ─────────────────────────────────────────────────────────────

export function useMyHistory(days = 30) {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  return useQuery({
    queryKey: historyKeys.mine(days),
    queryFn:  ({ signal }) => getMyHistory(days, signal),
    staleTime: 5 * 60_000,   // history doesn't change frequently
    enabled:  isAuthenticated,
  });
}

// ── Payslips query ────────────────────────────────────────────────────────────

export function useMyPayslips() {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  return useQuery({
    queryKey: payslipKeys.mine(),
    queryFn:  ({ signal }) => getMyPayslips(signal),
    staleTime: 5 * 60_000,
    enabled:  isAuthenticated,
  });
}

// ── Dashboard queries ─────────────────────────────────────────────────────────

export function useAdminStats() {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  return useQuery({
    queryKey: dashboardKeys.adminStats,
    queryFn:  ({ signal }) => getAdminStats(signal),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,   // poll every 5 min for live dashboard feel
    enabled:  isAuthenticated,
  });
}

export function useRecentAttendance() {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  return useQuery({
    queryKey: dashboardKeys.recentAttendance,
    queryFn:  ({ signal }) => getRecentAttendance(10, signal),
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
    enabled:  isAuthenticated,
  });
}

export function useDeptStats(managerUsername: string | null) {
  return useQuery({
    queryKey: dashboardKeys.deptStats(managerUsername ?? ''),
    queryFn:  ({ signal }) => getDeptStats(managerUsername!, signal),
    enabled:  !!managerUsername,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useDeptEmployees(managerUsername: string | null) {
  return useQuery({
    queryKey: dashboardKeys.deptEmployees(managerUsername ?? ''),
    queryFn:  ({ signal }) => getDeptEmployees(managerUsername!, signal),
    enabled:  !!managerUsername,
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
  });
}
