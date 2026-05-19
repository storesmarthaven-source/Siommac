/**
 * src/components/sections/AdminLeave/mount.ts
 *
 * Imperative mount / unmount helpers called from main.tsx.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { h, render }              from 'preact';
import { QueryClientProvider }    from '@tanstack/preact-query';
import type { QueryClient }       from '@tanstack/query-core';
import { AdminLeaveSection }      from './AdminLeaveSection';

export function mountAdminLeaveSection(
  container: Element,
  opts: { queryClient: QueryClient },
): void {
  render(
    h(QueryClientProvider, { client: opts.queryClient },
      h(AdminLeaveSection, null),
    ),
    container,
  );
}

export function unmountAdminLeaveSection(container: Element): void {
  render(null, container);
}
