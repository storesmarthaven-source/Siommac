/**
 * src/components/sections/ProjectSites/mount.ts
 *
 * Preact mount / unmount helpers consumed by src/main.tsx.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { h, render }              from 'preact';
import { QueryClientProvider }    from '@tanstack/preact-query';
import type { QueryClient }       from '@tanstack/query-core';
import { ProjectSitesSection }    from './ProjectSitesSection';

export function mountProjectSitesSection(
  container: Element,
  opts: { queryClient: QueryClient },
): void {
  render(
    h(QueryClientProvider, { client: opts.queryClient },
      h(ProjectSitesSection, null),
    ),
    container,
  );
}

export function unmountProjectSitesSection(container: Element): void {
  render(null, container);
}
