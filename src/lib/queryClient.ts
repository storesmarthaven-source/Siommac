/**
 * src/lib/queryClient.ts
 *
 * TanStack Query client singleton.
 *
 * WHY A SINGLETON:
 *   Components and hooks need access to the QueryClient for imperative
 *   invalidations (e.g. from Realtime event handlers). Passing it as a prop
 *   to every section mount is verbose. A module-level singleton — registered
 *   once at boot and read anywhere — avoids prop-drilling without needing a
 *   React context provider at every mount point.
 *
 * USAGE:
 *   // At app boot (main.tsx) — call once:
 *   import { setQueryClient } from '@lib/queryClient';
 *   setQueryClient(new QueryClient({ ... }));
 *
 *   // Anywhere else — read the singleton:
 *   import { getQueryClient } from '@lib/queryClient';
 *   getQueryClient().invalidateQueries({ queryKey: attendanceKeys.all });
 *
 * TESTING:
 *   In tests, call setQueryClient(new QueryClient()) in beforeEach to get a
 *   fresh cache with no stale data.
 *
 * THREAD SAFETY:
 *   JavaScript is single-threaded; no locks needed. setQueryClient must be
 *   called before getQueryClient or getQueryClient will throw.
 *
 * @see docs/ARCHITECTURE.md §TanStack-Query
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md §Phase-2a
 */

import { QueryClient } from '@tanstack/query-core';

let _client: QueryClient | null = null;

/**
 * Register the application-wide QueryClient.
 * Call exactly once at boot (main.tsx) before any hooks run.
 */
export function setQueryClient(client: QueryClient): void {
  _client = client;
}

/**
 * Retrieve the application-wide QueryClient.
 * Throws if called before setQueryClient — signals a boot-order bug.
 */
export function getQueryClient(): QueryClient {
  if (!_client) {
    throw new Error(
      '[queryClient] getQueryClient() called before setQueryClient(). ' +
      'Ensure main.tsx calls setQueryClient() during boot.',
    );
  }
  return _client;
}

/**
 * Create the default QueryClient with enterprise-grade settings.
 * main.tsx calls this, then passes the result to setQueryClient().
 *
 * Settings:
 *   staleTime 60 s   — matches legacy SWR TTL; avoids thundering-herd on mount
 *   gcTime    5 min  — keep inactive queries in cache for quick back-navigation
 *   retry     2      — retry read queries twice on network/5xx failure
 *   mutations retry 0 — never auto-retry writes (idempotency not guaranteed)
 */
export function createDefaultQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime:            60_000,
        gcTime:               5 * 60_000,
        retry:                2,
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}
