/**
 * src/lib/recordQuery.ts
 *
 * useRecordQuery — a useQuery wrapper for "detail of ONE record" surfaces (drawers,
 * profile panels). It enforces the loading-system rules for record-scoped reads:
 *
 *   1. Instant open — an optional `placeholder()` (built from a parent list cache)
 *      seeds the view with REAL data we already hold, but only if that placeholder
 *      belongs to `recordId` (never a different record's row).
 *   2. No cross-record bleed — the returned `data` is surfaced ONLY when it belongs
 *      to `recordId` (verified via `getId`). During an A→B switch the previous
 *      record's data is withheld, so the UI shows a skeleton, never stale tags.
 *   3. One `ready` flag — the UI gate: render the record only when `ready`, else a
 *      skeleton.
 *
 * Do NOT use `placeholderData: keepPreviousData` on record-scoped reads — that
 * intentionally surfaces the previous record and violates rule (2).
 *
 * @see docs/SKELETON_LOADING_SYSTEM.md
 */

import { useQuery, type QueryKey, type UseQueryOptions, type UseQueryResult } from '@tanstack/preact-query';

export interface RecordQueryResult<T> {
  /** Data ONLY when it belongs to the requested record; otherwise undefined. */
  data: T | undefined;
  /** True when `data` is present, belongs to the record, and not errored. */
  ready: boolean;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  /** Escape hatch to the underlying query (refetch, raw flags, etc.). */
  query: UseQueryResult<T>;
}

export interface UseRecordQueryOptions<T> {
  recordId: string | null;
  queryKey: QueryKey;
  queryFn: (signal?: AbortSignal) => Promise<T>;
  /** How to read the record id off the fetched data (for the belongs-to check). */
  getId: (data: T) => string | null | undefined;
  /** Optional instant placeholder (e.g. from a parent list cache). */
  placeholder?: () => T | undefined;
  enabled?: boolean;
  staleTime?: number;
}

export function useRecordQuery<T>({
  recordId,
  queryKey,
  queryFn,
  getId,
  placeholder,
  enabled = true,
  staleTime = 60_000,
}: UseRecordQueryOptions<T>): RecordQueryResult<T> {
  // Seed from the placeholder ONLY when it is this record's data. Cast is isolated
  // here because TanStack's NonFunctionGuard<T> can't see, for a generic T, that T
  // isn't a function — the runtime is correct and the public API stays fully typed.
  const placeholderData = (() => {
    if (!recordId || !placeholder) return undefined;
    const value = placeholder();
    return value && getId(value) === recordId ? value : undefined;
  }) as unknown as UseQueryOptions<T, Error, T>['placeholderData'];

  const query = useQuery<T, Error, T>({
    queryKey,
    enabled: enabled && !!recordId,
    staleTime,
    queryFn: ({ signal }) => queryFn(signal),
    placeholderData,
  }) as UseQueryResult<T>;

  const raw = query.data;
  const belongs = !!raw && !!recordId && getId(raw) === recordId;
  const data = belongs ? raw : undefined;

  return {
    data,
    ready: !!data && !query.isError,
    // Treat "have data but it's the wrong record" as still-loading (show skeleton).
    isLoading: query.isLoading || (!!raw && !belongs),
    isError: query.isError,
    isFetching: query.isFetching,
    query,
  };
}
