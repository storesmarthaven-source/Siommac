/**
 * src/components/sections/Settings/mount.ts
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { h, render }           from 'preact';
import { QueryClientProvider } from '@tanstack/preact-query';
import type { QueryClient }    from '@tanstack/query-core';
import { SettingsSection }     from './SettingsSection';

export function mountSettingsSection(
  container: Element,
  opts: { queryClient: QueryClient },
): void {
  render(
    h(QueryClientProvider, { client: opts.queryClient },
      h(SettingsSection, null),
    ),
    container,
  );
}

export function unmountSettingsSection(container: Element): void {
  render(null, container);
}
