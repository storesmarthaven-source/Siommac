/**
 * src/components/sections/Messages/mount.ts
 *
 * Mounts the canonical Message Center into the s-messages panel and the
 * MessageDropdown into #preact-msg-dropdown-root inside #hdrMsgModal.
 * Mirrors NotificationCenter/mount.ts exactly.
 */

import { h, render }           from 'preact';
import { QueryClientProvider } from '@tanstack/preact-query';
import type { QueryClient }    from '@tanstack/query-core';
import { MessengerWorkspace }  from './messenger/MessengerWorkspace';
import { MessageDropdown }     from './MessageDropdown';

export function mountMessageCenterSection(
  container: Element,
  opts: { queryClient: QueryClient },
): void {
  render(
    h(QueryClientProvider, { client: opts.queryClient },
      h(MessengerWorkspace, null),
    ),
    container,
  );
}

export function unmountMessageCenterSection(container: Element): void {
  render(null, container);
}

/** Message dropdown — mounted into #preact-msg-dropdown-root inside the message modal. */
export function mountMessageDropdown(
  container: Element,
  opts: { queryClient: QueryClient },
): void {
  render(
    h(QueryClientProvider, { client: opts.queryClient },
      h(MessageDropdown, null),
    ),
    container,
  );
}
