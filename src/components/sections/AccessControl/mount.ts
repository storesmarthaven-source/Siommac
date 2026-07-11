/**
 * src/components/sections/AccessControl/mount.ts
 *
 * Own Preact render root (separate from AppShell) so it carries its own providers.
 * StepUpProvider hosts the step-up dialog the Approvals page needs via useStepUp().
 */

import { h, render }           from 'preact';
import { QueryClientProvider } from '@tanstack/preact-query';
import type { QueryClient }    from '@tanstack/query-core';
import { StepUpProvider }      from '@/hooks/useStepUp';
import { AccessControlSection } from './AccessControlSection';

export function mountAccessControlSection(container: Element, opts: { queryClient: QueryClient }): void {
  render(
    h(QueryClientProvider, { client: opts.queryClient },
      h(StepUpProvider, null, h(AccessControlSection, null)),
    ),
    container,
  );
}

export function unmountAccessControlSection(container: Element): void {
  render(null, container);
}
