/**
 * src/components/sections/Finance/mount.ts
 */

import { h, render }           from 'preact';
import { QueryClientProvider } from '@tanstack/preact-query';
import type { QueryClient }    from '@tanstack/query-core';
import { FinanceSection }      from './FinanceSection';

export function mountFinanceSection(
  container: Element,
  opts: { queryClient: QueryClient },
): void {
  render(
    h(QueryClientProvider, { client: opts.queryClient },
      h(FinanceSection, null),
    ),
    container,
  );
}

export function unmountFinanceSection(container: Element): void {
  render(null, container);
}
