/**
 * src/components/sections/AdminLeave/hooks.ts
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { useQuery } from '@tanstack/preact-query';
import { useSessionStore } from '@store/session';
import { listAllLeaves } from './api';
import type { LeaveRecord, LeaveStats } from './types';

export interface AdminLeaveData {
  records: LeaveRecord[];
  stats:   LeaveStats;
}

export function useAdminLeaveData() {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  return useQuery<AdminLeaveData>({
    queryKey: ['admin', 'leaves'],
    queryFn:  async ({ signal }) => {
      const records = await listAllLeaves(signal);
      const stats: LeaveStats = {
        pending:  records.filter(r => r.status === 'pending').length,
        approved: records.filter(r => r.status === 'approved').length,
        rejected: records.filter(r => r.status === 'rejected').length,
        total:    records.length,
      };
      return { records, stats };
    },
    staleTime: 60_000,
    enabled:  isAuthenticated,
  });
}
