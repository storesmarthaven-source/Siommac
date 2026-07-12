/**
 * src/components/sections/SuperadminConsole/hooks.ts
 *
 * TanStack Query hooks for the superadmin console (Permissions, Roles, Sessions, Audit).
 *   - useQuery for reads — cache + dedupe + background refresh
 *   - useMutation for writes — no auto-retry, onSuccess invalidates + toast
 *
 * @see src/components/sections/Employees/hooks.ts (pattern reference)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { toast } from '@store/ui';
import { useSessionStore } from '@store/session';
import {
  listUsersApi, getUserPermissionsApi, setUserPermissionApi, clearUserPermissionApi,
  getActiveSessionsApi, revokeSessionApi,
  getAuditLogsApi,
  listRolesApi, getRolePermissionsApi, createRoleApi, updateRoleApi, deleteRoleApi, setRolePermissionApi,
  listApprovalsApi, approveGrantApi, rejectGrantApi, cancelGrantApi,
  type ConsoleUser, type UserPermissionRow, type ActiveSession,
  type AuditLogFilters, type RoleRow,
  type PermissionApproval, type ApprovalStatus,
} from '@lib/superadminApi';
import { useStepUp, withStepUp } from '@/hooks/useStepUp';
import { consoleKeys } from './queryKeys';

// ── Permissions tab ───────────────────────────────────────────────────────────

export function useConsoleUsers(enabled: boolean) {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  return useQuery({
    queryKey: consoleKeys.users(),
    enabled:  enabled && isAuthenticated,
    queryFn:  async () => {
      const res = await listUsersApi();
      if (!res.success || !res.users) throw new Error(res.message ?? 'Failed to load users');
      return res.users;
    },
  });
}

export function useUserPermissions(userId: string | null) {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  return useQuery({
    queryKey: consoleKeys.userPerms(userId ?? ''),
    enabled:  !!userId && isAuthenticated,
    queryFn:  async () => {
      const res = await getUserPermissionsApi(userId!);
      if (!res.success) throw new Error(res.message ?? 'Failed to load permissions');
      return (res.permissions ?? []);
    },
  });
}

export function useSetUserPermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, permission, granted }: { userId: string; permission: string; granted: boolean }) =>
      setUserPermissionApi(userId, permission, granted),
    retry: false,
    onSuccess: (res, vars) => {
      if (!res.success) { toast.error(res.message ?? 'Failed to update permission.'); return; }
      toast.success(`${vars.permission} ${vars.granted ? 'granted' : 'denied'}.`);
      void qc.invalidateQueries({ queryKey: consoleKeys.userPerms(vars.userId) });
    },
    onError: () => toast.error('Network error. Try again.'),
  });
}

export function useClearUserPermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, permission }: { userId: string; permission: string }) =>
      clearUserPermissionApi(userId, permission),
    retry: false,
    onSuccess: (res, vars) => {
      if (!res.success) { toast.error(res.message ?? 'Failed to clear override.'); return; }
      toast.success(`${vars.permission} reverted to role default.`);
      void qc.invalidateQueries({ queryKey: consoleKeys.userPerms(vars.userId) });
    },
    onError: () => toast.error('Network error. Try again.'),
  });
}

// ── Sessions tab ──────────────────────────────────────────────────────────────

export function useActiveSessions(enabled: boolean) {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  return useQuery({
    queryKey: consoleKeys.sessions(),
    enabled:  enabled && isAuthenticated,
    refetchInterval: 30_000,   // keep the live-session view reasonably fresh
    queryFn: async () => {
      const res = await getActiveSessionsApi();
      if (!res.success) throw new Error(res.message ?? 'Failed to load sessions');
      return (res.sessions ?? []);
    },
  });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => revokeSessionApi(userId),
    retry: false,
    onSuccess: (res) => {
      if (!res.success) { toast.error(res.message ?? 'Failed to revoke session.'); return; }
      toast.success('Session revoked — the user must log in again.');
      void qc.invalidateQueries({ queryKey: consoleKeys.sessions() });
    },
    onError: () => toast.error('Network error. Try again.'),
  });
}

// ── Audit log tab ─────────────────────────────────────────────────────────────

export function useAuditLogs(filters: AuditLogFilters, enabled: boolean) {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  return useQuery({
    queryKey: consoleKeys.audit(filters),
    enabled:  enabled && isAuthenticated,
    placeholderData: prev => prev,   // keep previous page visible while fetching next
    queryFn: async () => {
      const res = await getAuditLogsApi(filters);
      if (!res.success) throw new Error(res.message ?? 'Failed to load audit log');
      return {
        logs:     res.logs ?? [],
        total:    res.total ?? 0,
        actions:  res.actions ?? [],
        entities: res.entities ?? [],
      };
    },
  });
}

// ── Roles tab ─────────────────────────────────────────────────────────────────

export function useRoles(enabled: boolean) {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  return useQuery({
    queryKey: consoleKeys.roles(),
    enabled:  enabled && isAuthenticated,
    queryFn: async () => {
      const res = await listRolesApi();
      if (!res.success || !res.roles) throw new Error(res.message ?? 'Failed to load roles');
      return res.roles;
    },
  });
}

export function useRolePermissions(roleName: string | null) {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  return useQuery({
    queryKey: consoleKeys.rolePerms(roleName ?? ''),
    enabled:  !!roleName && isAuthenticated,
    queryFn: async () => {
      const res = await getRolePermissionsApi(roleName!);
      if (!res.success) throw new Error(res.message ?? 'Failed to load role permissions');
      return (res.permissions ?? []);
    },
  });
}

export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (role: { name: string; label: string; description?: string }) => createRoleApi(role),
    retry: false,
    onSuccess: (res) => {
      if (!res.success) { toast.error(res.message ?? 'Failed to create role.'); return; }
      toast.success('Role created.');
      void qc.invalidateQueries({ queryKey: consoleKeys.roles() });
    },
    onError: () => toast.error('Network error. Try again.'),
  });
}

export function useUpdateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roleName, patch }: { roleName: string; patch: { label?: string; description?: string; protected?: boolean } }) =>
      updateRoleApi(roleName, patch),
    retry: false,
    onSuccess: (res) => {
      if (!res.success) { toast.error(res.message ?? 'Failed to update role.'); return; }
      toast.success('Role updated.');
      void qc.invalidateQueries({ queryKey: consoleKeys.roles() });
    },
    onError: () => toast.error('Network error. Try again.'),
  });
}

export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roleName: string) => deleteRoleApi(roleName),
    retry: false,
    onSuccess: (res) => {
      if (!res.success) { toast.error(res.message ?? 'Failed to delete role.'); return; }
      toast.success('Role deleted.');
      void qc.invalidateQueries({ queryKey: consoleKeys.roles() });
    },
    onError: () => toast.error('Network error. Try again.'),
  });
}

export function useSetRolePermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roleName, permission, granted }: { roleName: string; permission: string; granted: boolean }) =>
      setRolePermissionApi(roleName, permission, granted),
    retry: false,
    onSuccess: (res, vars) => {
      if (!res.success) { toast.error(res.message ?? 'Failed to update permission.'); return; }
      toast.success(`${vars.permission} ${vars.granted ? 'granted' : 'revoked'} for role.`);
      void qc.invalidateQueries({ queryKey: consoleKeys.rolePerms(vars.roleName) });
    },
    onError: () => toast.error('Network error. Try again.'),
  });
}

// ── Permission-grant approvals (maker-checker) ────────────────────────────────

export function usePermissionApprovals(status?: ApprovalStatus) {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  return useQuery({
    queryKey: consoleKeys.approvals(status),
    enabled:  isAuthenticated,
    queryFn: async () => {
      const res = await listApprovalsApi(status);
      if (!res.success) throw new Error(res.message ?? 'Failed to load approvals');
      return (res.approvals ?? []);
    },
  });
}

export function useApproveGrant() {
  const qc = useQueryClient();
  const { ensureStepUp } = useStepUp();
  return useMutation({
    mutationFn: async (approvalId: string) => {
      const wrapped = withStepUp(ensureStepUp, () => approveGrantApi(approvalId));
      return wrapped();
    },
    retry: false,
    onSuccess: (res) => {
      if (!res.success) {
        if (res.code === 'self_approval') {
          toast.error('You cannot approve your own request — a different superadmin must review it.');
        } else if (res.code === 'expired') {
          toast.error('This approval request has expired and can no longer be approved.');
        } else {
          toast.error(res.message ?? 'Failed to approve grant.');
        }
        return;
      }
      toast.success('Permission grant approved and applied.');
      void qc.invalidateQueries({ queryKey: consoleKeys.approvals() });
    },
    onError: () => toast.error('Network error. Try again.'),
  });
}

export function useRejectGrant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ approvalId, reason }: { approvalId: string; reason?: string }) =>
      rejectGrantApi(approvalId, reason),
    retry: false,
    onSuccess: (res, vars) => {
      if (!res.success) {
        if (res.code === 'self_approval') {
          toast.error('You cannot reject your own request.');
        } else {
          toast.error(res.message ?? 'Failed to reject grant.');
        }
        return;
      }
      void vars; // suppress unused warning
      toast.success('Permission grant request rejected.');
      void qc.invalidateQueries({ queryKey: consoleKeys.approvals() });
    },
    onError: () => toast.error('Network error. Try again.'),
  });
}

export function useCancelGrant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (approvalId: string) => cancelGrantApi(approvalId),
    retry: false,
    onSuccess: (res) => {
      if (!res.success) { toast.error(res.message ?? 'Failed to cancel request.'); return; }
      toast.success('Approval request cancelled.');
      void qc.invalidateQueries({ queryKey: consoleKeys.approvals() });
    },
    onError: () => toast.error('Network error. Try again.'),
  });
}
