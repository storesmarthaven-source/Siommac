/**
 * src/components/sections/HSE/mount.ts
 */

import { h, render }           from 'preact';
import { QueryClientProvider } from '@tanstack/preact-query';
import type { QueryClient }    from '@tanstack/query-core';
import { HSESection }          from './HSESection';

export function mountHSESection(
  container: Element,
  opts: { queryClient: QueryClient },
): void {
  render(
    h(QueryClientProvider, { client: opts.queryClient },
      h(HSESection, null),
    ),
    container,
  );
}

export function unmountHSESection(container: Element): void {
  render(null, container);
}
