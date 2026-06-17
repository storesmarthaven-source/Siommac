/**
 * src/components/sections/SuperadminConsole/hooks.ts
 *
 * TanStack Query hooks for the superadmin console (Modules + Permissions tabs).
 *   - useQuery for reads — cache + dedupe + background refresh
 *   - useMutation for writes — no auto-retry, onSuccess invalidates + toast
 *
 * @see src/components/sections/Employees/hooks.ts (pattern reference)
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { toast } from '@store/ui';
import {
  getModulesApi, setModuleApi, resetModulesApi,
  getManagersApi, setManagerModuleApi, resetManagerModulesApi,
  listUsersApi, getUserPermissionsApi, setUserPermissionApi, clearUserPermissionApi,
  getActiveSessionsApi, revokeSessionApi,
  getAuditLogsApi,
  listRolesApi, getRolePermissionsApi, createRoleApi, updateRoleApi, deleteRoleApi, setRolePermissionApi,
  type ModuleKey, type ModuleMatrix, type ManagerEntry,
  type ConsoleUser, type UserPermissionRow, type ActiveSession,
  type AuditLogFilters, type RoleRow,
} from '@lib/superadminApi';
import { setModuleMatrix } from '@components/nav/navCore';
import { consoleKeys } from './queryKeys';

// ── Modules tab ───────────────────────────────────────────────────────────────

export function useModuleMatrix() {
  return useQuery({
    queryKey: consoleKeys.modules(),
    queryFn:  async () => {
      const res = await getModulesApi();
      if (!res.success || !res.modules) throw new Error('Failed to load modules');
      return res.modules;
    },
  });
}

export function useSetAdminModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ module, enabled }: { module: ModuleKey; enabled: boolean }) =>
      setModuleApi(module, 'admin', enabled),
    retry: false,
    onSuccess: (res, vars) => {
      if (!res.success) { toast.error(res.message ?? 'Failed to update module.'); return; }
      // Keep the legacy nav matrix in sync, then refresh the cache.
      const cur = qc.getQueryData<ModuleMatrix>(consoleKeys.modules());
      if (cur) {
        const next = { ...cur, [vars.module]: { ...cur[vars.module], admin: vars.enabled } };
        setModuleMatrix(next);
      }
      toast.success(`${vars.module.replace('_', ' ')} ${vars.enabled ? 'enabled' : 'disabled'} for admin.`);
      void qc.invalidateQueries({ queryKey: consoleKeys.modules() });
    },
    onError: () => toast.error('Network error. Try again.'),
  });
}

export function useResetAdminModules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => resetModulesApi(),
    retry: false,
    onSuccess: (res) => {
      if (!res.success) { toast.error(res.message ?? 'Failed to reset modules.'); return; }
      toast.success('Admin module permissions reset to defaults.');
      void qc.invalidateQueries({ queryKey: consoleKeys.modules() });
    },
    onError: () => toast.error('Network error. Try again.'),
  });
}

export function useManagers(enabled: boolean) {
  return useQuery({
    queryKey: consoleKeys.managers(),
    enabled,
    queryFn:  async () => {
      const res = await getManagersApi();
      if (!res.success || !res.managers) throw new Error(res.message ?? 'Failed to load managers');
      return res.managers;
    },
  });
}

export function useSetManagerModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, module, enabled }: { userId: string; module: ModuleKey; enabled: boolean }) =>
      setManagerModuleApi(userId, module, enabled),
    retry: false,
    onSuccess: (res, vars) => {
      if (!res.success) { toast.error(res.message ?? 'Failed to update manager module.'); return; }
      qc.setQueryData<ManagerEntry[]>(consoleKeys.managers(), prev =>
        prev?.map(m => m.id === vars.userId
          ? { ...m, modules: { ...m.modules, [vars.module]: vars.enabled } }
          : m));
      toast.success(`${vars.module.replace('_', ' ')} ${vars.enabled ? 'enabled' : 'disabled'}.`);
    },
    onError: () => toast.error('Network error. Try again.'),
  });
}

export function useResetManagerModules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => resetManagerModulesApi(userId),
    retry: false,
    onSuccess: (res) => {
      if (!res.success) { toast.error(res.message ?? 'Failed to reset manager modules.'); return; }
      toast.success('Manager reset to role defaults.');
      void qc.invalidateQueries({ queryKey: consoleKeys.managers() });
    },
    onError: () => toast.error('Network error. Try again.'),
  });
}

// ── Permissions tab ───────────────────────────────────────────────────────────

export function useConsoleUsers(enabled: boolean) {
  return useQuery({
    queryKey: consoleKeys.users(),
    enabled,
    queryFn:  async () => {
      const res = await listUsersApi();
      if (!res.success || !res.users) throw new Error(res.message ?? 'Failed to load users');
      return res.users as ConsoleUser[];
    },
  });
}

export function useUserPermissions(userId: string | null) {
  return useQuery({
    queryKey: consoleKeys.userPerms(userId ?? ''),
    enabled:  !!userId,
    queryFn:  async () => {
      const res = await getUserPermissionsApi(userId!);
      if (!res.success) throw new Error(res.message ?? 'Failed to load permissions');
      return (res.permissions ?? []) as UserPermissionRow[];
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
  return useQuery({
    queryKey: consoleKeys.sessions(),
    enabled,
    refetchInterval: 30_000,   // keep the live-session view reasonably fresh
    queryFn: async () => {
      const res = await getActiveSessionsApi();
      if (!res.success) throw new Error(res.message ?? 'Failed to load sessions');
      return (res.sessions ?? []) as ActiveSession[];
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
  return useQuery({
    queryKey: consoleKeys.audit(filters),
    enabled,
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
  return useQuery({
    queryKey: consoleKeys.roles(),
    enabled,
    queryFn: async () => {
      const res = await listRolesApi();
      if (!res.success || !res.roles) throw new Error(res.message ?? 'Failed to load roles');
      return res.roles as RoleRow[];
    },
  });
}

export function useRolePermissions(roleName: string | null) {
  return useQuery({
    queryKey: consoleKeys.rolePerms(roleName ?? ''),
    enabled:  !!roleName,
    queryFn: async () => {
      const res = await getRolePermissionsApi(roleName!);
      if (!res.success) throw new Error(res.message ?? 'Failed to load role permissions');
      return (res.permissions ?? []) as string[];
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
