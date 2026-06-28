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
import { StepUpProvider }      from '@/hooks/useStepUp';
import { SettingsSection }     from './SettingsSection';

export function mountSettingsSection(
  container: Element,
  opts: { queryClient: QueryClient },
): void {
  // StepUpProvider hosts the step-up dialog needed by the Security panel and the
  // embedded console tools (User Security / Security Policy) — this is its own
  // render root, so it must provide its own context (mirrors the old console mount).
  render(
    h(QueryClientProvider, { client: opts.queryClient },
      h(StepUpProvider, null,
        h(SettingsSection, null),
      ),
    ),
    container,
  );
}

export function unmountSettingsSection(container: Element): void {
  render(null, container);
}
