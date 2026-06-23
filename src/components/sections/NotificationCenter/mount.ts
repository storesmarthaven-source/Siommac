/**
 * src/components/sections/NotificationCenter/mount.ts
 *
 * Mounts the global Notification Center into the s-notification-center panel.
 */

import { h, render }            from 'preact';
import { QueryClientProvider }  from '@tanstack/preact-query';
import type { QueryClient }     from '@tanstack/query-core';
import { NotificationCenter }   from './NotificationCenter';
import { NotificationDropdown } from './NotificationDropdown';

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

/** Bell dropdown — mounted into #preact-notif-dropdown-root inside the bell modal. */
export function mountNotificationDropdown(
  container: Element,
  opts: { queryClient: QueryClient },
): void {
  render(
    h(QueryClientProvider, { client: opts.queryClient },
      h(NotificationDropdown, null),
    ),
    container,
  );
}
