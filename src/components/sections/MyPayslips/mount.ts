/**
 * src/components/sections/MyPayslips/mount.ts
 *
 * Mount shell for the standalone "My Payslips" self-service section (F-11). Renders
 * the existing MyPayslipsOverview page. Kept as its own top-level module so EVERY
 * staff role can reach it (the Finance module is admin/superadmin-only).
 */

import { h, render }           from 'preact';
import { QueryClientProvider } from '@tanstack/preact-query';
import type { QueryClient }    from '@tanstack/query-core';
import { MyPayslipsOverview }  from '@sections/Finance/MyPayslipsOverview';

export function mountMyPayslips(
  container: Element,
  opts: { queryClient: QueryClient },
): void {
  render(
    h(QueryClientProvider, { client: opts.queryClient },
      h(MyPayslipsOverview, null),
    ),
    container,
  );
}

export function unmountMyPayslips(container: Element): void {
  render(null, container);
}
