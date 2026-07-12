/**
 * src/components/sections/AttendanceDashboard/mount.ts
 *
 * Imperative mount/unmount helpers called from main.tsx.
 *
 * Unlike the section pattern (full HTML replacement), this controller is
 * headless — it mounts into a hidden <div> and drives the surrounding vanilla
 * HTML via DOM writes + event listeners, keeping full backward compat with
 * nav.js and app.js shell code that still controls the attendance section.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { h, render }          from 'preact';
import { QueryClient }        from '@tanstack/query-core';
import { QueryClientProvider } from '@tanstack/preact-query';
import { AttendanceDashboard } from './AttendanceDashboard';

function getUsername(): string {
  const win = window as unknown as Record<string, unknown>;
  const AS  = win.AppState as { get?: (k: string) => string } | undefined;
  return AS?.get?.('currentUser') ?? '';
}

export function mountAttendanceDashboard(
  container: Element,
  opts: { queryClient: QueryClient },
): void {
  const username = getUsername();
  render(
    h(QueryClientProvider, { client: opts.queryClient },
      h(AttendanceDashboard, { username })
    ),
    container,
  );
}

export function unmountAttendanceDashboard(container: Element): void {
  render(null, container);
}
