/**
 * src/ui/widgets/bundles.ts — first-party SIOMAC widget bundles.
 *
 * ─── TERMINOLOGY ────────────────────────────────────────────────────────────
 *
 *   BUNDLE   — a curated, FIRST-PARTY set of widgets, defined here in code
 *              (this file). Bundles are owned and shipped by the SIOMAC
 *              platform team; they reference real widget ids from the
 *              compiled registry packages (registry.*.tsx). The "Add bundle"
 *              action in the Widget Library modal adds every member widget
 *              that is currently registered AND not already placed AND not
 *              locked — it gracefully skips anything that isn't ready yet.
 *
 *   PACKAGE  — an INSTALLABLE THIRD-PARTY widget set. A package is a
 *              `manifest.json` (or `.zip`) uploaded by an admin via
 *              "Widget Library → Install package" and stored in the
 *              `ui_widget_packages` database table. Packages are declarative
 *              (no compiled JS) and are managed by `installWidgetPackage` /
 *              `uninstallWidgetPackage` (see `@api/widgets` + `runtimeRegistry.ts`).
 *
 * These are intentionally DISTINCT concepts. Bundles appear in the library as
 * a "Bundles" section (above the per-category tiles). Packages appear in the
 * library's own catalog tiles once installed. Never conflate the two.
 *
 * ─── AUTHORING A BUNDLE ─────────────────────────────────────────────────────
 *
 * 1. Add an entry to WIDGET_BUNDLES below.
 * 2. List `widgetIds` — reference ids that already exist in a registry.*tsx
 *    file AND ids that will exist (placeholder forward-references are fine;
 *    `resolveBundleWidgets` silently skips any id not currently registered).
 * 3. Set `module` to the owning module's ModuleKey (drives the module chip
 *    filter in the library if we add bundle filtering later).
 * 4. Keep descriptions concise (one or two sentences max).
 *
 * ─── ADDING NEW BUNDLES ──────────────────────────────────────────────────────
 *
 * Only add a bundle when there are at least 2 real (non-locked, registered)
 * widget ids in its list — a bundle with 0 addable members is disabled in
 * the UI, and a bundle with 1 widget is no better than clicking that tile
 * directly. The id strings below that don't exist yet are forward-references;
 * they are harmlessly skipped until the matching registry.*.tsx file ships.
 */

import type { ModuleKey } from './types';

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

/** A curated, first-party set of widgets shipped with the SIOMAC platform.
 *  Distinguished from "packages" (third-party installable declarative sets
 *  uploaded by admins — see `installWidgetPackage` / `runtimeRegistry.ts`). */
export interface WidgetBundle {
  /** Stable id — never rename (used as a React key). */
  id: string;
  /** Display title shown on the bundle card. */
  title: string;
  /** One-sentence description of what the bundle gives you. */
  description: string;
  /** Font Awesome icon class (e.g. `fa-users`). */
  icon: string;
  /** Owning module — for future filter alignment. */
  module: ModuleKey;
  /** Pages where this bundle is relevant. */
  supportedPages: string[];
  /** Member widget ids. May include forward-references to widgets not yet
   *  registered; `resolveBundleWidgets` filters them out at runtime. */
  widgetIds: string[];
}

// ---------------------------------------------------------------------------
// First-party bundle catalogue
// ---------------------------------------------------------------------------

export const WIDGET_BUNDLES: WidgetBundle[] = [
  {
    id: 'bundle.hr.onboarding.manager',
    title: 'Onboarding Manager Pack',
    description: 'Key onboarding metrics, readiness gates, active-case pipeline, and task health — everything a manager needs at a glance.',
    icon: 'fa-user-plus',
    module: 'hr',
    supportedPages: ['hr.onboarding.case'],
    widgetIds: [
      'hr.onboarding.readinessGates',   // ✅ registered — registry.hrOnboarding.tsx
      'hr.onboarding.activeCases',      // forward-ref — Phase 5 rebuild
      'hr.onboarding.packageReadiness', // forward-ref — Phase 5 rebuild
      'hr.onboarding.recentActivity',   // forward-ref — Phase 5 rebuild
    ],
  },
  {
    id: 'bundle.hr.employees.essentials',
    title: 'Employee Master Essentials',
    description: 'Headcount overview, department breakdown, and active-employee insights for the HR Employee Master board.',
    icon: 'fa-users',
    module: 'hr',
    supportedPages: ['hr.employees.overview'],
    widgetIds: [
      'hr.employees.headcount',         // forward-ref — Employee Master Phase 5
      'hr.employees.departments',        // forward-ref — Employee Master Phase 5
      'hr.employees.recentJoiners',      // forward-ref — Employee Master Phase 5
    ],
  },
  {
    id: 'bundle.hr.attendance.ops',
    title: 'Attendance & Leave Ops',
    description: 'Daily attendance status, pending leave requests, and overtime highlights for shift and operations teams.',
    icon: 'fa-clock',
    module: 'hr',
    supportedPages: ['hr.attendance.overview', 'hr.leave.overview'],
    widgetIds: [
      'hr.attendance.todayStatus',      // forward-ref — HR Attendance Phase 5
      'hr.leave.pendingApprovals',       // forward-ref — HR Leave Phase 5
      'hr.overtime.summary',             // forward-ref — HR Overtime Phase 5
    ],
  },
];

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Returns only the member ids from `bundle.widgetIds` that are currently
 * registered (present in `allWidgetIds`). This gracefully skips forward-
 * references to widgets not yet shipped. The caller should also filter out
 * ids that are already placed or locked before invoking the add action.
 *
 * @param bundle       The bundle to resolve.
 * @param allWidgetIds The full set of registered widget ids (from `allWidgets().map(w => w.id)`).
 */
export function resolveBundleWidgets(bundle: WidgetBundle, allWidgetIds: string[]): string[] {
  const registeredSet = new Set(allWidgetIds);
  return bundle.widgetIds.filter(id => registeredSet.has(id));
}
