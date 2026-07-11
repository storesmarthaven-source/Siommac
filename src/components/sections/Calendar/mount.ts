/**
 * src/components/sections/Calendar/mount.ts
 */

import { h, render }           from 'preact';
import { QueryClientProvider } from '@tanstack/preact-query';
import type { QueryClient }    from '@tanstack/query-core';
import { CalendarPage }        from './CalendarPage';

export function mountCalendarSection(container: Element, opts: { queryClient: QueryClient }): void {
  render(
    h(QueryClientProvider, { client: opts.queryClient }, h(CalendarPage, null)),
    container,
  );
}

export function unmountCalendarSection(container: Element): void {
  render(null, container);
}
