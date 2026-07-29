/**
 * src/api/hr/employeeProfile.ts — typed client for the ONE Employee Profile shell
 * contract, shared by the drawer and the full employee page.
 *
 * The shell is what both surfaces open with; large per-tab datasets stay on their
 * own tab-scoped hooks so opening the drawer never pulls a full document list,
 * audit history or offboarding record.
 */
import { useQuery, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import { useRecordQuery } from '@lib/recordQuery';
import { hrEmployeeKeys } from '../queryKeys';
import type {
  EmployeeProfileShell, EmployeeAttentionResponse, EmployeeAttentionItem,
  ProfileTabIndicator, ProfileTabKey, AttentionSeverity, AttentionDomain, AttentionDueState,
  ProfileReadinessSummary, ProfileIdentity, ProfileEmploymentFacts, ProfileContactSummary,
  ProfileAccountHealth, ProfileActivityEntry, ProfileCapabilities,
} from '../../../types/hrEmployeeProfile';

export type {
  EmployeeProfileShell, EmployeeAttentionResponse, EmployeeAttentionItem,
  ProfileTabIndicator, ProfileTabKey, AttentionSeverity, AttentionDomain, AttentionDueState,
  ProfileReadinessSummary, ProfileIdentity, ProfileEmploymentFacts, ProfileContactSummary,
  ProfileAccountHealth, ProfileActivityEntry, ProfileCapabilities,
};

async function call<T>(path: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const res = await apiPost<{ success: boolean; message?: string; data: T }>(path, args, { signal });
  if (!res.success) throw new Error(res.message ?? 'Request failed.');
  return res.data;
}

/**
 * The profile shell for one employee.
 *
 * Stale-switch protection: the employee id is part of the query key AND is
 * re-checked on the resolved payload. TanStack already scopes a response to the
 * key that requested it, but `identity.employeeId` is asserted here as a hard
 * backstop so a mis-routed or replayed response can never be rendered under a
 * different employee's name.
 */
export function useEmployeeProfileShell(employeeId: string | null, enabled = true) {
  const record = useRecordQuery<EmployeeProfileShell>({
    recordId: employeeId,
    queryKey: hrEmployeeKeys.profileShell(employeeId ?? ''),
    enabled: !!employeeId && enabled,
    queryFn: async (signal) => {
      const shell = await call<EmployeeProfileShell>('hr/employees/profile-shell', { employeeId }, signal);
      assertShellMatches(shell, employeeId);
      return shell;
    },
    // No `placeholderData: keepPreviousData` — showing the previous employee's
    // shell under the newly selected employee is exactly the defect this contract
    // exists to prevent.
    getId: shell => shell.identity.employeeId,
    staleTime: 30_000,
  });
  return {
    ...record.query,
    data: record.data,
    ready: record.ready,
    isPending: record.isLoading,
  };
}

/** Full unresolved-work list — the Needs Attention panel's "view all" source. */
export function useEmployeeAttention(employeeId: string | null, enabled = true) {
  return useQuery({
    queryKey: hrEmployeeKeys.attention(employeeId ?? ''),
    enabled: !!employeeId && enabled,
    queryFn: () => call<EmployeeAttentionResponse>('hr/employees/attention', { employeeId }),
    staleTime: 30_000,
  });
}

/**
 * Throw if a shell payload does not belong to the employee it was requested for.
 *
 * Exported so the regression test can drive it directly: under rapid employee
 * switching a late response for employee A must never be accepted while B is
 * selected.
 */
export function assertShellMatches(shell: EmployeeProfileShell, employeeId: string | null): void {
  if (employeeId && shell.identity.employeeId !== employeeId) {
    throw new Error(
      `Profile shell mismatch: received ${shell.identity.employeeId} while ${employeeId} is selected.`,
    );
  }
}

/** Warm the shell on row hover/focus so opening the drawer is instant. */
export function usePrefetchEmployeeProfileShell() {
  const qc = useQueryClient();
  return (employeeId: string) => {
    if (!employeeId) return;
    void qc.prefetchQuery({
      queryKey: hrEmployeeKeys.profileShell(employeeId),
      queryFn: async () => {
        const shell = await call<EmployeeProfileShell>('hr/employees/profile-shell', { employeeId });
        assertShellMatches(shell, employeeId);
        return shell;
      },
      staleTime: 30_000,
    });
  };
}

/**
 * Invalidate only the profile queries affected by a mutation on this employee —
 * never the whole HR cache, which would re-fetch every open register page.
 */
export function useInvalidateEmployeeProfile() {
  const qc = useQueryClient();
  return (employeeId: string) => {
    void qc.invalidateQueries({ queryKey: hrEmployeeKeys.profileShell(employeeId) });
    void qc.invalidateQueries({ queryKey: hrEmployeeKeys.attention(employeeId) });
    void qc.invalidateQueries({ queryKey: hrEmployeeKeys.detail(employeeId) });
  };
}

/** Indicator for one tab, or null when that tab has no unresolved work. */
export function tabIndicatorFor(
  indicators: ProfileTabIndicator[] | undefined,
  tab: ProfileTabKey,
): ProfileTabIndicator | null {
  return indicators?.find(i => i.tab === tab && i.unresolvedCount > 0) ?? null;
}
