import { h, render } from 'preact';
import { QueryClientProvider } from '@tanstack/preact-query';
import type { QueryClient } from '@tanstack/query-core';
import { WorkerOnboardingPage } from './WorkerOnboardingPage';

export function mountWorkerOnboarding(container: Element, queryClient: QueryClient): void {
  render(h(QueryClientProvider, { client: queryClient }, h(WorkerOnboardingPage, null)), container);
}
export function unmountWorkerOnboarding(container: Element): void { render(null, container); }
