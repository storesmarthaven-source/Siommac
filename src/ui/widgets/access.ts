import { findWidgetDataSource } from './dataSources';
import { effectiveWidgetPolicy, policyAllowsPage } from './governance';
import type { WidgetDef, WidgetRuntimeState } from './types';

export interface WidgetAccessContext { pageKey: string; pagePermission?: string; has: (key: string) => boolean }
export interface WidgetAccessDecision { mount: boolean; state: WidgetRuntimeState; reason?: string }
export function resolveWidgetAccess(def: WidgetDef | undefined, ctx: WidgetAccessContext): WidgetAccessDecision {
  if (!def) return { mount: false, state: 'missing', reason: 'The widget definition or package is unavailable.' };
  if (ctx.pagePermission && !ctx.has(ctx.pagePermission)) return { mount: false, state: 'restricted', reason: 'Page access is required.' };
  const policy = effectiveWidgetPolicy(def);
  if (policy.state === 'disabled') return { mount: false, state: 'disabled', reason: 'Disabled by widget governance.' };
  if (!policyAllowsPage(policy.allowedPages, ctx.pageKey)) return { mount: false, state: 'restricted', reason: 'Not approved for this page.' };
  if (!(policy.requiredCapabilities ?? []).every(ctx.has)) return { mount: false, state: 'restricted', reason: 'Governance capability is required.' };
  const required = def.permissions?.requiredPermissions ?? def.dataSource.permissions;
  if (!required.every(ctx.has)) return { mount: false, state: 'restricted', reason: 'You do not have permission to view this widget.' };
  if (def.dataSourceKey) {
    const source = findWidgetDataSource(def.dataSourceKey);
    if (!source || !ctx.has(source.permission)) return { mount: false, state: 'restricted', reason: 'The approved data source is unavailable.' };
  }
  if (def.lockedReason) return { mount: false, state: 'restricted', reason: def.lockedReason };
  if (policy.state === 'preview' || def.runtimeState === 'static-preview') return { mount: true, state: 'static-preview' };
  return { mount: true, state: def.runtimeState ?? 'live-api' };
}
