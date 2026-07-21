import { type VNode } from 'preact';
import { HrApiError } from '@api/hr/client';

export interface HrQueryStateLike {
  data?: unknown;
  error?: unknown;
  isError: boolean;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
}

function messageFor(error: unknown): string {
  if (error instanceof HrApiError && error.isConflict) {
    return 'This record changed since it was loaded. Refresh the page data, review the latest values, and try again.';
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'HR data could not be loaded. Check your connection and try again.';
}

/**
 * Shared non-destructive query feedback. Cached content remains rendered during
 * background refreshes and refresh failures; an actionable retry sits above it.
 */
export function HRQueryNotice({ queries }: { queries: readonly HrQueryStateLike[] }): VNode | null {
  const failed = queries.find(query => query.isError);
  const refreshing = queries.some(query => query.isFetching && query.data !== undefined);

  if (failed) {
    return (
      <div class="ui-callout ui-callout--danger" role="alert" data-testid="hr-query-error">
        <div>
          <strong>Unable to refresh HR data</strong>
          <p>{messageFor(failed.error)}</p>
        </div>
        <button class="obx-btn obx-btn-sm" type="button" onClick={() => void failed.refetch()}>
          <i class="fas fa-rotate-right" aria-hidden="true" /> Retry
        </button>
      </div>
    );
  }

  if (refreshing) {
    return (
      <div class="obx-meta" role="status" data-testid="hr-background-refresh" aria-live="polite">
        <i class="fas fa-spinner fa-spin" aria-hidden="true" /> Refreshing…
      </div>
    );
  }

  return null;
}
