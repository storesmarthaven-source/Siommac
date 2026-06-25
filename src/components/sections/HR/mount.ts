/**
 * src/components/sections/HR/mount.ts
 */

import { h, render }           from 'preact';
import { QueryClientProvider } from '@tanstack/preact-query';
import type { QueryClient }    from '@tanstack/query-core';
import { HRSection }           from './HRSection';

export function mountHRSection(
  container: Element,
  opts: { queryClient: QueryClient },
): void {
  render(
    h(QueryClientProvider, { client: opts.queryClient },
      h(HRSection, null),
    ),
    container,
  );
}

export function unmountHRSection(container: Element): void {
  render(null, container);
}
