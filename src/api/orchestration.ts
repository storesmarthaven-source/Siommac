// src/api/orchestration.ts — Cross-module orchestration API hooks.
//
// Backed by /api/orchestration/* (lib/orchestration). Today: the unified record
// timeline. Hooks follow the repo convention (useQuery + apiPost → res.data).

import { useQuery } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';

export type TimelineItemType = 'event' | 'audit' | 'handoff' | 'workflow' | 'message' | 'ticket';

export interface TimelineItem {
  id: string;
  item_type: TimelineItemType;
  title: string;
  description?: string;
  actor_id?: string | null;
  actor_name?: string;
  severity?: string;
  created_at: string;
  source_url?: string;
  metadata?: Record<string, unknown>;
}

export interface TimelineRef {
  module: string;
  recordType: string;
  recordId: string;
  includeAudit?: boolean;
}

/** Unified cross-module activity timeline for one record. Pass null to disable
 *  (e.g. until the hosting tab is opened). */
export function useRecordTimeline(ref: TimelineRef | null) {
  return useQuery({
    queryKey: ['orchestration', 'timeline', ref],
    enabled:  !!(ref && ref.module && ref.recordType && ref.recordId),
    queryFn:  async ({ signal }) => {
      const res = await apiPost<{ success: boolean; data: TimelineItem[] }>(
        'orchestration/timeline/get',
        ref as unknown as Record<string, unknown>,
        { signal },
      );
      return res.data;
    },
  });
}
