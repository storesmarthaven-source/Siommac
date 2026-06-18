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

// ── Nav contribution ──────────────────────────────────────────────────────────

export interface ModuleNavItem {
  /** Section id — also the route target (e.g. 's-hse-dashboard'). */
  id:    string;
  label: string;
  icon:  string;             // Font Awesome class (sidebar maps to a line icon)
  sub?:  string;
  /** If set, this item is a collapsible child nested under the parent item id. */
  parent?: string;
  /** For toggleable children: default sidebar visibility (default true). */
  defaultVisible?: boolean;
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

export type AppRole = 'superadmin' | 'admin' | 'manager' | 'employee';

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
