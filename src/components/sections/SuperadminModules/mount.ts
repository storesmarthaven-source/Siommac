/**
 * src/components/sections/SuperadminModules/mount.ts
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { h, render }              from 'preact';
import { QueryClientProvider }    from '@tanstack/preact-query';
import type { QueryClient }       from '@tanstack/query-core';
import { SuperadminModulesSection } from './SuperadminModulesSection';

export function mountSuperadminModulesSection(
  container: Element,
  opts: { queryClient: QueryClient },
): void {
  render(
    h(QueryClientProvider, { client: opts.queryClient },
      h(SuperadminModulesSection, null),
    ),
    container,
  );
}

export function unmountSuperadminModulesSection(container: Element): void {
  render(null, container);
}
