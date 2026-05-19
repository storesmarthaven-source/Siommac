/**
 * src/components/sections/Attendance/mount.ts
 *
 * Imperative mount / unmount functions for the Attendance section.
 * Called from main.tsx (or the legacy nav shim) when the user navigates
 * to the admin attendance section ('s-adm-attendance').
 *
 * Usage:
 *   import { mountAttendanceSection, unmountAttendanceSection } from '@sections/Attendance';
 *
 *   // Mount:
 *   mountAttendanceSection(container, { queryClient });
 *
 *   // Unmount (before navigating away):
 *   unmountAttendanceSection(container);
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { render, h } from 'preact';
import { QueryClientProvider } from '@tanstack/preact-query';
import type { QueryClient } from '@tanstack/query-core';
import { ToastContainer } from '@shared/Toast';
import { AttendanceSection } from './AttendanceSection';

// ── Mount options ─────────────────────────────────────────────────────────────

export interface AttendanceMountOptions {
  /** The application-level TanStack QueryClient singleton */
  queryClient: QueryClient;
}

// ── Mount ─────────────────────────────────────────────────────────────────────

/**
 * Mount the Attendance section into a DOM container.
 * Replaces whatever content is currently in the container.
 *
 * @param container - The DOM element to render into
 * @param opts      - Mount options (queryClient)
 */
export function mountAttendanceSection(
  container: Element,
  opts: AttendanceMountOptions,
): void {
  render(
    h(
      QueryClientProvider,
      { client: opts.queryClient },
      h(AttendanceSection, null),
      h(ToastContainer, null),
    ),
    container,
  );
}

// ── Unmount ───────────────────────────────────────────────────────────────────

/**
 * Unmount the Attendance section from a DOM container.
 * Cleans up Preact's virtual DOM and all associated hooks / subscriptions.
 *
 * @param container - The same DOM element passed to mountAttendanceSection
 */
export function unmountAttendanceSection(container: Element): void {
  render(null, container);
}
