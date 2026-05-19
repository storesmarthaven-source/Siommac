/**
 * src/components/sections/HourlyRates/mount.ts
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { h }                     from 'preact';
import { render }                from 'preact';
import { QueryClientProvider }   from '@tanstack/preact-query';
import type { QueryClient }      from '@tanstack/query-core';
import { HourlyRatesSection }    from './HourlyRatesSection';

export function mountHourlyRatesSection(container: Element, opts: { queryClient: QueryClient }): void {
  render(
    h(QueryClientProvider, { client: opts.queryClient },
      h(HourlyRatesSection, null),
    ),
    container,
  );
}

export function unmountHourlyRatesSection(container: Element): void {
  render(null, container);
}
