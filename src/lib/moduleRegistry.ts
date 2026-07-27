/**
 * src/lib/moduleRegistry.ts
 *
 * Additive module-registration contract for feature modules (HSE, and future
 * Documents / Quality / Assets …). A module declares everything it contributes
 * — nav, mount, and visibility — in one `ModuleDefinition` and self-registers at
 * import time. The host (sidebar + shell) reads the registry ALONGSIDE the
 * existing static `SECTION_DEFS`, so adding a module never touches shared config
 * and never affects the sections already shipping.
 *
 * Contract scope (decided): nav + mount + visibility. RBAC stays with the
 * existing can()/requirePermission system; a module only declares which roles
 * see it in the nav.
 *
 * Design notes:
 *   - Pure data + a tiny register/query API; no framework coupling here.
 *   - `navItems` may nest ONE level: a parent item plus children that carry
 *     `parent: <parentId>`. Children can be toggled via the visibility store
 *     (see src/lib/navVisibility.ts) using `visibilityNamespace`.
 *   - Idempotent registration (re-registering the same id replaces it) so HMR
 *     and double-imports are safe.
 */

import type { NavGroupId } from '@components/nav/types';
import type { UserRole } from '@api/schemas/auth';

// ── Nav contribution ──────────────────────────────────────────────────────────

export interface ModuleNavItem {
  /** Section id — also the route target (e.g. 's-hse-dashboard'). */
  id:    string;
  label: string;
  icon:  string;             // Font Awesome class (sidebar maps to a line icon)
  sub?:  string;
  /** If set, this item is a collapsible child nested under the parent item id. */
  parent?: string;
  /** A group-only parent: the sidebar row expands/collapses its children but does
   *  NOT navigate to a page (it has no section of its own). Use with child items. */
  isGroup?: boolean;
  /** For toggleable children: default sidebar visibility (default true). */
  defaultVisible?: boolean;
  /** Optional role restriction narrower than the owning module's role list. */
  roles?: AppRole[];
  /** Optional capability required for this individual navigation item. */
  permission?: string;
  /** Optional alternative capabilities; access passes when any one is granted. */
  permissionsAny?: readonly string[];
}

export interface ModuleNavGroup {
  id:    NavGroupId;
  label: string;             // '' renders the group's items flat (no header)
}

// ── Mount contract ────────────────────────────────────────────────────────────

export interface ModuleMountContext {
  /** Section id being mounted (lets one shell serve several nav items). */
  sectionId: string;
  /** TanStack Query client, passed through from the host. */
  queryClient: unknown;
}

export interface ModuleMount {
  /** id of the <section class="app-section"> panel the host shows for this
   *  module. All the module's nav items route to this one panel. */
  sectionId: string;
  /** DOM id of the mount root inside that panel. */
  rootId: string;
  mount:   (root: Element, ctx: ModuleMountContext) => void;
  unmount?: (root: Element) => void;
}

// ── Module definition ─────────────────────────────────────────────────────────

// Nav-visibility roles. Includes the departmental RBAC roles defined in the DB
// (`roles` table / `role_permissions`) — NOT just the four base tiers. These are
// real roles a user can hold (e.g. a payroll approver is `finance_manager`), and
// `getModulesForRole` filters the nav by exactly this set, so a role missing here
// is invisible in the sidebar even when it holds every backing permission.
// Per-module `roles` lists + per-item `permission` gates still govern what each
// role actually sees; this union only makes the role expressible in those lists.
// AppRole tracks the canonical UserRole enum (src/api/schemas/auth), which
// already enumerates every base + departmental role, so the two never drift.
export type AppRole = UserRole;

export interface ModuleDefinition {
  /** Stable unique id (e.g. 'hse'). */
  id:    string;
  /** Optional nav group this module's items live in (created if new). */
  navGroup?: ModuleNavGroup;
  /** Nav items contributed (parents + nested children). */
  navItems: ModuleNavItem[];
  /** Roles that see this module in the nav. */
  roles: AppRole[];
  /** Single panel mount (one shell can serve all the module's sections). */
  mount: ModuleMount;
  /** Visibility namespace for toggleable children (navVisibility store). */
  visibilityNamespace?: string;
}

/** Pure item-level authorization used by the DOM navigation and unit tests. */
export function canAccessModuleNavItem(
  item: ModuleNavItem,
  role: string,
  hasPermission: (key: string) => boolean,
): boolean {
  if (item.roles && !item.roles.includes(role as AppRole)) return false;
  if (item.permission && !hasPermission(item.permission)) return false;
  return !item.permissionsAny?.length || item.permissionsAny.some(hasPermission);
}

// ── Registry ──────────────────────────────────────────────────────────────────

const _modules = new Map<string, ModuleDefinition>();

/** Register (or replace) a module. Idempotent — safe under HMR/double-import. */
export function registerModule(def: ModuleDefinition): void {
  _modules.set(def.id, def);
}

/** All registered modules, in registration order. */
export function getModules(): ModuleDefinition[] {
  return [..._modules.values()];
}

/** A module by id, or undefined. */
export function getModule(id: string): ModuleDefinition | undefined {
  return _modules.get(id);
}

/** Modules visible to a given role. */
export function getModulesForRole(role: string): ModuleDefinition[] {
  return getModules().filter(m => m.roles.includes(role as AppRole));
}

/** Find the module that owns a given section id (by any of its nav items). */
export function getModuleForSection(sectionId: string): ModuleDefinition | undefined {
  return getModules().find(m => m.navItems.some(i => i.id === sectionId));
}
