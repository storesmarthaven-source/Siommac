/**
 * src/api/widgets.ts — installable declarative widget packages (no-code), backed by
 * ui_widget_packages via /api/widgets/packages/*.
 */
import { apiPost } from '@lib/api';
import type { DeclarativeWidgetSpec } from '../ui/widgets/declarative/types';

export interface InstalledWidgetPackage {
  id: string;
  name: string;
  version: string | null;
  widgets: DeclarativeWidgetSpec[];
  installedBy: string | null;
  createdAt: string;
}

export async function listInstalledPackages(): Promise<InstalledWidgetPackage[]> {
  const res = await apiPost<{ success: boolean; data?: InstalledWidgetPackage[]; message?: string }>('widgets/packages/list', {});
  // MUST throw on failure (not return []) — a swallowed error makes the TanStack query "succeed"
  // with an empty list, which marks the registry authoritative (registryReady) and prunes
  // installed-package widgets from saved layouts. A transient DB/migration/API error would then
  // wipe user boards. Throwing keeps the query in the error state → registryReady stays false → no prune.
  if (!res.success) throw new Error(res.message ?? 'Failed to load installed widget packages.');
  return res.data ?? [];
}

/** Install a parsed package manifest (admin). The .zip is unpacked client-side first. */
export async function installWidgetPackage(pkg: { name: string; version?: string | null; widgets: DeclarativeWidgetSpec[] }): Promise<void> {
  const res = await apiPost<{ success: boolean; message?: string }>('widgets/packages/install', pkg);
  if (!res.success) throw new Error(res.message ?? 'Failed to install package.');
}

export async function uninstallWidgetPackage(id: string): Promise<void> {
  const res = await apiPost<{ success: boolean; message?: string }>('widgets/packages/uninstall', { id });
  if (!res.success) throw new Error(res.message ?? 'Failed to uninstall package.');
}
