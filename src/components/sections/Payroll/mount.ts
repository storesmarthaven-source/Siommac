/**
 * src/components/sections/Payroll/mount.ts
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { h }                   from 'preact';
import { render }              from 'preact';
import { QueryClientProvider } from '@tanstack/preact-query';
import type { QueryClient }    from '@tanstack/query-core';
import { PayrollSection }      from './PayrollSection';

export function mountPayrollSection(container: Element, opts: { queryClient: QueryClient }): void {
  render(
    h(QueryClientProvider, { client: opts.queryClient },
      h(PayrollSection, null),
    ),
    container,
  );
}

export function unmountPayrollSection(container: Element): void {
  render(null, container);
}
