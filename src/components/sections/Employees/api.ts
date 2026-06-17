/**
 * src/components/sections/Employees/api.ts
 *
 * Typed API client for the Employees feature domain.
 * All calls go through the shared apiFetch/apiPost helpers from @lib/api,
 * which handle auth headers, retry, and token refresh automatically.
 *
 * The backend uses a single POST /api endpoint with { action, args } dispatch.
 * Each function here maps one action → one typed Promise.
 *
 * No SWR cache here — TanStack Query is the cache layer.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 * @see docs/PHASE_PLAN.md
 */

import { apiPost } from '@lib/api';
import type {
  EmployeeListItem,
  EmployeeDetail,
  AddEmployeePayload,
  UpdateEmployeePayload,
  Department,
  Manager,
  AddDepartmentPayload,
  UpdateDepartmentPayload,
  LeaveRequest,
  SubmitLeavePayload,
  UpdateLeavePayload,
  HistoryRecord,
  Payslip,
  DeptStats,
  DeptEmployee,
  AdminStats,
  RecentAttendanceRow,
} from './types';

// ── Typed API response wrapper ────────────────────────────────────────────────

interface ApiOk<T>  { success: true;  data: T }
interface ApiErr    { success: false; message: string }
type ApiResult<T>   = ApiOk<T> | ApiErr;

/** Throw if the response indicates failure; otherwise return the data. */
function unwrap<T>(res: ApiResult<T>): T {
  if (!res.success) throw new Error(res.message);
  return res.data;
}

// ── Employee endpoints ────────────────────────────────────────────────────────

export async function listEmployees(signal?: AbortSignal): Promise<EmployeeListItem[]> {
  const res = await apiPost<ApiResult<EmployeeListItem[]>>('listEmployees', {}, signal ? { signal } : undefined);
  return unwrap(res);
}

export async function getEmployee(username: string, signal?: AbortSignal): Promise<EmployeeDetail> {
  const res = await apiPost<ApiResult<EmployeeDetail>>('getEmployeeByUsername', { username }, signal ? { signal } : undefined);
  return unwrap(res);
}

export async function addEmployee(payload: AddEmployeePayload): Promise<{ id: string; employeeNumber: string }> {
  const res = await apiPost<ApiResult<{ id: string; employeeNumber: string }>>('addEmployee', payload as unknown as Record<string, unknown>);
  return unwrap(res);
}

export async function updateEmployee(payload: UpdateEmployeePayload): Promise<void> {
  const res = await apiPost<ApiResult<never>>('updateEmployee', payload as unknown as Record<string, unknown>);
  if (!res.success) throw new Error(res.message);
}

export async function deleteEmployee(username: string): Promise<void> {
  const res = await apiPost<ApiResult<never>>('deleteEmployee', { username });
  if (!res.success) throw new Error(res.message);
}

// ── Department endpoints ──────────────────────────────────────────────────────

export async function listDepartments(signal?: AbortSignal): Promise<Department[]> {
  const res = await apiPost<ApiResult<Department[]>>('listDepartments', {}, signal ? { signal } : undefined);
  return unwrap(res);
}

export async function listManagers(signal?: AbortSignal): Promise<Manager[]> {
  const res = await apiPost<ApiResult<Manager[]>>('listManagers', {}, signal ? { signal } : undefined);
  return unwrap(res);
}

export interface AssignableRole { name: string; label: string; }

/** Roles selectable in the employee form (excludes superadmin). */
export async function listAssignableRoles(signal?: AbortSignal): Promise<AssignableRole[]> {
  const res = await apiPost<{ success: boolean; roles?: AssignableRole[] }>('listAssignableRoles', {}, signal ? { signal } : undefined);
  return res.success && res.roles ? res.roles : [];
}

export async function addDepartment(payload: AddDepartmentPayload): Promise<{ id: string }> {
  const res = await apiPost<ApiResult<{ id: string }>>('addDepartment', payload as unknown as Record<string, unknown>);
  return unwrap(res);
}

export async function updateDepartment(payload: UpdateDepartmentPayload): Promise<void> {
  const res = await apiPost<ApiResult<never>>('updateDepartment', payload as unknown as Record<string, unknown>);
  if (!res.success) throw new Error(res.message);
}

export async function deleteDepartment(id: string): Promise<void> {
  const res = await apiPost<ApiResult<never>>('deleteDepartment', { id });
  if (!res.success) throw new Error(res.message);
}

// ── Leave endpoints ───────────────────────────────────────────────────────────

export async function getMyLeaves(signal?: AbortSignal): Promise<LeaveRequest[]> {
  const res = await apiPost<ApiResult<LeaveRequest[]>>('getMyLeaves', {}, signal ? { signal } : undefined);
  return unwrap(res);
}

export async function getPendingLeavesForManager(managerUsername: string, signal?: AbortSignal): Promise<LeaveRequest[]> {
  const res = await apiPost<ApiResult<LeaveRequest[]>>('getPendingLeavesForManager', { managerUsername }, signal ? { signal } : undefined);
  return unwrap(res);
}

export async function listAllLeaves(signal?: AbortSignal): Promise<LeaveRequest[]> {
  const res = await apiPost<ApiResult<LeaveRequest[]>>('listAllLeaves', {}, signal ? { signal } : undefined);
  return unwrap(res);
}

export async function submitLeave(payload: SubmitLeavePayload): Promise<void> {
  const res = await apiPost<ApiResult<never>>('submitLeave', payload as unknown as Record<string, unknown>);
  if (!res.success) throw new Error(res.message);
}

export async function updateLeave(payload: UpdateLeavePayload): Promise<void> {
  const res = await apiPost<ApiResult<never>>('updateLeave', payload as unknown as Record<string, unknown>);
  if (!res.success) throw new Error(res.message);
}

export async function deleteLeave(leaveId: string): Promise<void> {
  const res = await apiPost<ApiResult<never>>('deleteLeave', { leaveId });
  if (!res.success) throw new Error(res.message);
}

export async function approveLeave(leaveId: string): Promise<void> {
  const res = await apiPost<ApiResult<never>>('approveLeave', { leaveId });
  if (!res.success) throw new Error(res.message);
}

export async function rejectLeave(leaveId: string): Promise<void> {
  const res = await apiPost<ApiResult<never>>('rejectLeave', { leaveId });
  if (!res.success) throw new Error(res.message);
}

// ── Attendance history endpoint ───────────────────────────────────────────────

export async function getMyHistory(days = 30, signal?: AbortSignal): Promise<HistoryRecord[]> {
  const res = await apiPost<ApiResult<HistoryRecord[]>>('getMyHistory', { days }, signal ? { signal } : undefined);
  return unwrap(res);
}

// ── Payslip endpoint ──────────────────────────────────────────────────────────

export async function getMyPayslips(signal?: AbortSignal): Promise<Payslip[]> {
  const res = await apiPost<ApiResult<Payslip[]>>('getMyPayslips', {}, signal ? { signal } : undefined);
  return unwrap(res);
}

// ── Manager dashboard endpoints ───────────────────────────────────────────────

export async function getDeptStats(managerUsername: string, signal?: AbortSignal): Promise<DeptStats> {
  const res = await apiPost<ApiResult<DeptStats>>('getDeptStats', { managerUsername }, signal ? { signal } : undefined);
  return unwrap(res);
}

export async function getDeptEmployees(managerUsername: string, signal?: AbortSignal): Promise<DeptEmployee[]> {
  const res = await apiPost<ApiResult<DeptEmployee[]>>('getDeptEmployees', { managerUsername }, signal ? { signal } : undefined);
  return unwrap(res);
}

// ── Admin dashboard endpoints ─────────────────────────────────────────────────

export async function getAdminStats(signal?: AbortSignal): Promise<AdminStats> {
  const res = await apiPost<ApiResult<AdminStats>>('getAdminStats', {}, signal ? { signal } : undefined);
  return unwrap(res);
}

export async function getRecentAttendance(limit = 10, signal?: AbortSignal): Promise<RecentAttendanceRow[]> {
  const res = await apiPost<ApiResult<RecentAttendanceRow[]>>('getRecentAttendance', { limit }, signal ? { signal } : undefined);
  return unwrap(res);
}
