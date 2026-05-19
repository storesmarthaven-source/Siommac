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
import {
  listEmployees, getEmployee, addEmployee, updateEmployee, deleteEmployee,
  listDepartments, listManagers, addDepartment, updateDepartment, deleteDepartment,
  getMyLeaves, getPendingLeavesForManager, listAllLeaves,
  submitLeave, updateLeave, deleteLeave, approveLeave, rejectLeave,
  getMyHistory, getMyPayslips,
  getDeptStats, getDeptEmployees,
  getAdminStats, getRecentAttendance,
} from './api';
import {
  employeeKeys, departmentKeys, leaveKeys, historyKeys,
  payslipKeys, dashboardKeys,
} from './queryKeys';

// ── Employee queries ──────────────────────────────────────────────────────────

export function useEmployeeList() {
  return useQuery({
    queryKey: employeeKeys.list(),
    queryFn:  ({ signal }) => listEmployees(signal),
    staleTime: 60_000,
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
  return useQuery({
    queryKey: departmentKeys.list(),
    queryFn:  ({ signal }) => listDepartments(signal),
    staleTime: 60_000,
  });
}

export function useManagerList() {
  return useQuery({
    queryKey: departmentKeys.managers(),
    queryFn:  ({ signal }) => listManagers(signal),
    staleTime: 60_000,
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

// ── Leave queries ─────────────────────────────────────────────────────────────

export function useMyLeaves() {
  return useQuery({
    queryKey: leaveKeys.mine(),
    queryFn:  ({ signal }) => getMyLeaves(signal),
    staleTime: 30_000,
  });
}

export function useManagerLeaves(managerUsername: string | null) {
  return useQuery({
    queryKey: leaveKeys.manager(managerUsername ?? ''),
    queryFn:  ({ signal }) => getPendingLeavesForManager(managerUsername!, signal),
    enabled:  !!managerUsername,
    staleTime: 30_000,
  });
}

export function useAdminLeaves() {
  return useQuery({
    queryKey: leaveKeys.admin(),
    queryFn:  ({ signal }) => listAllLeaves(signal),
    staleTime: 30_000,
  });
}

// ── Leave mutations ───────────────────────────────────────────────────────────

export function useSubmitLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: submitLeave,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: leaveKeys.all });
      toast.success('Leave request submitted.');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to submit leave request.');
    },
  });
}

export function useUpdateLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateLeave,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: leaveKeys.all });
      toast.success('Leave request updated.');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to update leave request.');
    },
  });
}

export function useDeleteLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteLeave,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: leaveKeys.all });
      toast.success('Leave request deleted.');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to delete leave request.');
    },
  });
}

export function useApproveLeave(managerUsername?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: approveLeave,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: leaveKeys.all });
      if (managerUsername) void qc.invalidateQueries({ queryKey: leaveKeys.manager(managerUsername) });
      toast.success('Leave approved.');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to approve leave.');
    },
  });
}

export function useRejectLeave(managerUsername?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: rejectLeave,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: leaveKeys.all });
      if (managerUsername) void qc.invalidateQueries({ queryKey: leaveKeys.manager(managerUsername) });
      toast.success('Leave rejected.');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to reject leave.');
    },
  });
}

// ── History query ─────────────────────────────────────────────────────────────

export function useMyHistory(days = 30) {
  return useQuery({
    queryKey: historyKeys.mine(days),
    queryFn:  ({ signal }) => getMyHistory(days, signal),
    staleTime: 5 * 60_000,   // history doesn't change frequently
  });
}

// ── Payslips query ────────────────────────────────────────────────────────────

export function useMyPayslips() {
  return useQuery({
    queryKey: payslipKeys.mine(),
    queryFn:  ({ signal }) => getMyPayslips(signal),
    staleTime: 5 * 60_000,
  });
}

// ── Dashboard queries ─────────────────────────────────────────────────────────

export function useAdminStats() {
  return useQuery({
    queryKey: dashboardKeys.adminStats,
    queryFn:  ({ signal }) => getAdminStats(signal),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,   // poll every 5 min for live dashboard feel
  });
}

export function useRecentAttendance() {
  return useQuery({
    queryKey: dashboardKeys.recentAttendance,
    queryFn:  ({ signal }) => getRecentAttendance(10, signal),
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
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
