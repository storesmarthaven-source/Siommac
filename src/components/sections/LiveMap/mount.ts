/**
 * src/components/sections/LiveMap/mount.ts
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { h }                   from 'preact';
import { render }              from 'preact';
import { QueryClientProvider } from '@tanstack/preact-query';
import type { QueryClient }    from '@tanstack/query-core';
import { LiveMapController }   from './LiveMapController';

export function mountLiveMapController(container: Element, opts: { queryClient: QueryClient }): void {
  render(
    h(QueryClientProvider, { client: opts.queryClient },
      h(LiveMapController, null),
    ),
    container,
  );
}

export function unmountLiveMapController(container: Element): void {
  render(null, container);
}
