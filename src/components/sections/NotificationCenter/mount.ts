/**
 * src/components/sections/NotificationCenter/mount.ts
 *
 * Mounts the global Notification Center into the s-notification-center panel.
 */

import { h, render }           from 'preact';
import { QueryClientProvider } from '@tanstack/preact-query';
import type { QueryClient }    from '@tanstack/query-core';
import { NotificationCenter }  from './NotificationCenter';

export function mountNotificationCenterSection(
  container: Element,
  opts: { queryClient: QueryClient },
): void {
  render(
    h(QueryClientProvider, { client: opts.queryClient },
      h(NotificationCenter, null),
    ),
    container,
  );
}

export function unmountNotificationCenterSection(container: Element): void {
  render(null, container);
}
