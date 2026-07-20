import { h, render } from 'preact';
import { QueryClientProvider } from '@tanstack/preact-query';
import type { QueryClient } from '@tanstack/query-core';
import { TicketCenter } from './TicketCenter';
import { TicketDropdown } from './TicketDropdown';

export function mountTicketCenter(container: Element, opts: { queryClient: QueryClient }): void {
  render(h(QueryClientProvider, { client: opts.queryClient }, h(TicketCenter, null)), container);
}

export function unmountTicketCenter(container: Element): void {
  render(null, container);
}

export function mountTicketDropdown(container: Element, opts: { queryClient: QueryClient }): void {
  render(h(QueryClientProvider, { client: opts.queryClient }, h(TicketDropdown, null)), container);
}
