/**
 * src/components/sections/SuperadminConsole/mount.ts
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { h, render }           from 'preact';
import { QueryClientProvider } from '@tanstack/preact-query';
import type { QueryClient }    from '@tanstack/query-core';
import { StepUpProvider }      from '@/hooks/useStepUp';
import { ConsoleSection }      from './ConsoleSection';

export function mountSuperadminConsoleSection(
  container: Element,
  opts: { queryClient: QueryClient },
): void {
  // The console is its own Preact render root (separate from AppShell), so it
  // needs its own providers. StepUpProvider hosts the step-up dialog that
  // UserSecurityPanel / SecurityPolicyTab require via useStepUp().
  render(
    h(QueryClientProvider, { client: opts.queryClient },
      h(StepUpProvider, null,
        h(ConsoleSection, null),
      ),
    ),
    container,
  );
}

export function unmountSuperadminConsoleSection(container: Element): void {
  render(null, container);
}
