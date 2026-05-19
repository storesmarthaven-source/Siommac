/**
 * src/components/sections/Profile/mount.ts
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { h, render }           from 'preact';
import { QueryClientProvider } from '@tanstack/preact-query';
import type { QueryClient }    from '@tanstack/query-core';
import { MyProfileSection }    from './MyProfileSection';

export function mountProfileSection(
  container: Element,
  opts: { queryClient: QueryClient },
): void {
  render(
    h(QueryClientProvider, { client: opts.queryClient },
      h(MyProfileSection, null),
    ),
    container,
  );
}

export function unmountProfileSection(container: Element): void {
  render(null, container);
}
