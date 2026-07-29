/**
 * src/api/hr/employeeAccountSupport.ts — typed client for the Employee Profile's
 * account-assistance surface.
 *
 * This is WIRING, not a second implementation: the routes it calls
 * (`createAccountSupportRequest` / `getAccountSupportRequests`) are the Ticket
 * Center's own capability-routed account-support endpoints, which already emit
 * `app_events`, `audit_logs`, the `handoff_outbox` row and the notifications, and
 * already resolve the authorised receiver. The profile must call THAT, never keep
 * a local copy of the routing rules.
 *
 * Permissions are the existing, already-granted keys:
 *   create → `employees.access.request` (+ `employees.access.view` for a subject
 *            other than yourself, which is always the case from this surface)
 *   list   → `employees.access.request`, widened to all subjects by
 *            `employees.access.view`
 * No new key is introduced, so nothing here is dead pending a migration.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';
import { hrEmployeeKeys } from '../queryKeys';
import type { AccountServiceDomain } from '@components/sections/HR/profile/employeeProfilePageModel';

/** One account-support request as the list route returns it. */
export interface AccountSupportRequest {
  id: string;
  fromUsername: string;
  fromName: string | null;
  ticketNumber: string;
  category: string;
  subjectType: string | null;
  subjectId: string | null;
  serviceDomain: string | null;
  requestedAction: string | null;
  requestedCompletionDate: string | null;
  requesterOrg: string | null;
  capabilityTarget: string | null;
  assignedUserId: string | null;
  subject: string;
  body: string;
  status: string;
  priority: string | null;
  resolutionNotes: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface CreateAccountSupportInput {
  subjectId: string;
  serviceDomain: AccountServiceDomain;
  /** Short action phrase stored on the ticket, e.g. "MFA Device Replacement". */
  requestedAction: string;
  subject: string;
  body: string;
  priority: 'low' | 'medium' | 'high';
}

/** The receipt the locked dialog shows after a successful submission. */
export interface AccountSupportReceipt {
  id: string;
  ticketNumber: string;
  assignedTo: string | null;
}

export const accountSupportKeys = {
  forEmployee: (employeeId: string) => ['hr', 'employees', 'account-support', employeeId] as const,
};

/**
 * Account-support requests ABOUT one employee.
 *
 * `subjectId` is applied server-side; the route caps the result at 50 rows, so
 * filtering here would quietly truncate the history rather than scope it.
 */
export function useEmployeeAccountSupportRequests(employeeId: string | null, enabled = true) {
  return useQuery({
    queryKey: accountSupportKeys.forEmployee(employeeId ?? ''),
    enabled: !!employeeId && enabled,
    queryFn: async () => {
      const res = await apiPost<{ success: boolean; message?: string; data: AccountSupportRequest[] }>(
        'getAccountSupportRequests', { subjectId: employeeId },
      );
      if (!res.success) throw new Error(res.message ?? 'Account request history could not be loaded.');
      return res.data;
    },
    staleTime: 30_000,
  });
}

/**
 * Create a capability-routed account-support request for this employee.
 *
 * Not retryable: the route creates a ticket and a handoff, and a replayed POST
 * would open a second request for the same problem.
 */
export function useCreateAccountSupportRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateAccountSupportInput): Promise<AccountSupportReceipt> => {
      const res = await apiPost<{
        success: boolean; message?: string; id: string; ticketNumber: string; assignedTo: string | null;
      }>('createAccountSupportRequest', { ...input }, { retryable: false });
      if (!res.success) throw new Error(res.message ?? 'The account support request could not be created.');
      return { id: res.id, ticketNumber: res.ticketNumber, assignedTo: res.assignedTo };
    },
    onSuccess: (_receipt, input) => {
      void qc.invalidateQueries({ queryKey: accountSupportKeys.forEmployee(input.subjectId) });
      // The shell carries the open-request count shown on Account Health.
      void qc.invalidateQueries({ queryKey: hrEmployeeKeys.profileShell(input.subjectId) });
    },
  });
}
