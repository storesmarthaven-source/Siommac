import type { WidgetDataSourceRegistration } from './types';

const sources = new Map<string, WidgetDataSourceRegistration>();
export function registerWidgetDataSource(source: WidgetDataSourceRegistration): void {
  if (!source.endpoint.startsWith('/api/')) throw new Error(`Widget data source "${source.key}" must use an authenticated /api/ endpoint.`);
  if (!source.permission) throw new Error(`Widget data source "${source.key}" must declare a permission.`);
  if (sources.has(source.key)) throw new Error(`Duplicate widget data source: ${source.key}`);
  sources.set(source.key, Object.freeze({ ...source }));
}
export function findWidgetDataSource(key: string): WidgetDataSourceRegistration | undefined { return sources.get(key); }
export function listWidgetDataSources(): WidgetDataSourceRegistration[] { return [...sources.values()]; }
export function clearWidgetDataSourcesForTests(): void { sources.clear(); }
