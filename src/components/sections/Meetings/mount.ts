import { h, render } from 'preact';
import { QueryClientProvider } from '@tanstack/preact-query';
import type { QueryClient } from '@tanstack/query-core';
import { MeetingsPage } from './MeetingsPage';

export function mountMeetingsSection(container: Element, options: { queryClient: QueryClient }): void {
  render(h(QueryClientProvider, { client: options.queryClient }, h(MeetingsPage, null)), container);
}

export function unmountMeetingsSection(container: Element): void { render(null, container); }
