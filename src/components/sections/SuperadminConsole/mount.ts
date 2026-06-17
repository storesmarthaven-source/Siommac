/**
 * src/components/sections/SuperadminConsole/mount.ts
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { h, render }           from 'preact';
import { QueryClientProvider } from '@tanstack/preact-query';
import type { QueryClient }    from '@tanstack/query-core';
import { ConsoleSection }      from './ConsoleSection';

export function mountSuperadminConsoleSection(
  container: Element,
  opts: { queryClient: QueryClient },
): void {
  render(
    h(QueryClientProvider, { client: opts.queryClient },
      h(ConsoleSection, null),
    ),
    container,
  );
}

export function unmountSuperadminConsoleSection(container: Element): void {
  render(null, container);
}
