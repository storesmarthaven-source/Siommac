/**
 * src/components/sections/UiKit/mount.ts
 *
 * Own Preact render root, matching the other feature modules. The gallery needs
 * no providers beyond the query client — the workbench is deliberately
 * self-contained and reads nothing from the ERP except the theme on Apply.
 *
 * The two branding props are the exception, and they are injected here rather
 * than imported inside the kit: the Brand Theme page extracts colours from the
 * company logo and can replace it, and both of those already have an owner —
 * `settings.company_logo` and the branding upload endpoint. The kit must not
 * grow its own copy of either, so the HOST supplies them and `@ui` keeps no
 * dependency on the Settings module.
 */

import { h, render }           from 'preact';
import { QueryClientProvider } from '@tanstack/preact-query';
import type { QueryClient }    from '@tanstack/query-core';
import { showSection }         from '@components/nav/navCore';
import { Studio }              from '@ui/studio/Studio';
import { useSessionStore }     from '@store/session';
import { uploadLogoApi }       from '@sections/Settings/api';

/** Where "Back to SIOMAC" returns to. The dashboard is the safe universal target. */
const EXIT_SECTION = 's-adm-dashboard';

export function mountUiKitSection(container: Element, opts: { queryClient: QueryClient }): void {
  render(
    h(QueryClientProvider, { client: opts.queryClient },
      h(Studio, {
        onExit: () => showSection(EXIT_SECTION),
        logoUrl: useSessionStore.getState().companyLogoUrl,
        onUploadLogo: (dataUrl: string) => uploadLogoApi(dataUrl),
      }),
    ),
    container,
  );
}

export function unmountUiKitSection(container: Element): void {
  render(null, container);
}
