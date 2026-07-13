/**
 * src/components/nav/navCore.ts
 *
 * Pure DOM-manipulation helpers ported from nav.js.
 * No Preact imports — these are called from NavController's useEffect.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import type { SiomacConfig, SectionItem, NavGroupItem, NavGroupId } from './types';
import { updateColorScheme, updateLayoutMode } from './api';
import { navIconSvg } from './navIcons';
import { getModulesForRole, getModuleForSection } from '@lib/moduleRegistry';
import { isVisible, resolveVisible, resolveOrder } from '@lib/navVisibility';
import { setActivePanel } from '../../shell/sections/useActiveSection';

// ── Config access (loaded by config.js before main.tsx) ──────────────────────

function cfg(): SiomacConfig {
  return (window as unknown as { SiomacConfig: SiomacConfig }).SiomacConfig;
}

/**
 * Nav items contributed by registered feature modules for a role — flattened
 * to SectionItem[], carrying each child's `defaultVisible`. Per-parent show/hide
 * AND reorder is applied later in the render layer (see customizeChildren),
 * keyed by parent id, so every collapsible sub-menu is customizable uniformly.
 */
export function moduleSectionItems(role: string): SectionItem[] {
  const out: SectionItem[] = [];
  for (const mod of getModulesForRole(role)) {
    for (const it of mod.navItems) {
      out.push({ id: it.id, label: it.label, icon: it.icon, sub: it.sub, group: mod.navGroup?.id, parent: it.parent, defaultVisible: it.defaultVisible });
    }
  }
  return out;
}

/** Every nav item visible to a role (config + modules), flattened. */
function allItemsForRole(role: string): SectionItem[] {
  const { SECTION_DEFS, BASELINE_SECTIONS, COMMON_ITEMS } = cfg();
  const personal = isEmployeeRole() ? BASELINE_SECTIONS : [];
  return ([] as SectionItem[]).concat(SECTION_DEFS[role] ?? [], personal, COMMON_ITEMS, moduleSectionItems(role));
}

// ── Global Nav Catalog (super-admin customizer) ───────────────────────────────

/**
 * Module ids that are system-essential and cannot be hidden by the super-admin.
 * These items render with a lock affordance in the global customizer.
 */
export const REQUIRED_MODULE_IDS = new Set<string>([
  's-settings',
  's-profile',
  's-about',
]);

export interface GlobalChildEntry {
  id:          string;
  label:       string;
  icon:        string;
  description: string;
  visible:     boolean;
  required:    boolean;
}

export interface GlobalModuleEntry {
  id:             string;
  label:          string;
  icon:           string;
  description:    string;
  visible:        boolean;
  required:       boolean;
  defaultVisible: boolean;
  /** The nav-group namespace that owns this top-level item's visibility/order. */
  groupId:        string;
  children:       GlobalChildEntry[] | null;
}

/** One sidebar group (HR, Finance, HSE, Settings…) with its top-level items. */
export interface NavGlobalGroup {
  id:    string;
  label: string;
  items: GlobalModuleEntry[];
}

export interface NavGlobalCatalog {
  groups: NavGlobalGroup[];
  stats: {
    total:      number;
    visible:    number;
    hidden:     number;
    groupCount: number;
  };
}

/** Display label for a nav group — the flat 'overview' group carries no label. */
function groupDisplayLabel(g: NavGroupItem): string {
  const l = (g.label ?? '').trim();
  if (l) return l;
  if (g.id === 'overview') return 'Overview';
  return g.id.charAt(0).toUpperCase() + g.id.slice(1);
}

/**
 * Build the navigation catalog for the super-admin global customizer, ORGANISED
 * BY SIDEBAR GROUP (HR shows all HR items, Finance all Finance, etc.) — the same
 * grouping the sidebar itself uses, so the customizer mirrors what the user sees.
 * Each group's items are top-level entries in their saved order; a parent item
 * carries its (ordered) children. Visibility + order come from the localStorage
 * store so the snapshot reflects the current customization.
 */
export function navGlobalCatalog(role: string): NavGlobalCatalog {
  const all = allItemsForRole(role);
  const { NAV_GROUPS } = cfg();
  const groupDefs = mergeModuleGroups(NAV_GROUPS, role);

  const groups: NavGlobalGroup[] = [];
  let total = 0, visible = 0;

  for (const group of groupDefs) {
    const groupItems = all.filter(i => (i.group ?? 'overview') === group.id);
    const tops       = groupItems.filter(i => !i.parent);
    if (tops.length === 0) continue;

    const visItems = tops.map(t => ({ id: t.id, defaultVisible: t.defaultVisible ?? true }));
    const orderedTops = resolveOrder(group.id, visItems);
    const items: GlobalModuleEntry[] = [];

    for (const v of orderedTops) {
      const t = tops.find(x => x.id === v.id);
      if (!t) continue;
      const kids = groupItems.filter(i => i.parent === t.id);
      const topVis = isVisible(group.id, visItems, t.id);

      let children: GlobalChildEntry[] | null = null;
      if (kids.length > 0) {
        const kidVisItems = kids.map(k => ({ id: k.id, defaultVisible: k.defaultVisible ?? true }));
        const orderedKids = resolveOrder(t.id, kidVisItems);
        children = orderedKids.map(v2 => {
          const k = kids.find(x => x.id === v2.id);
          if (!k) return null;
          return {
            id:          k.id,
            label:       k.label,
            icon:        k.icon,
            description: k.sub ?? '',
            visible:     isVisible(t.id, kidVisItems, k.id),
            required:    REQUIRED_MODULE_IDS.has(k.id),
          } satisfies GlobalChildEntry;
        }).filter((x): x is GlobalChildEntry => x != null);
      }

      items.push({
        id:             t.id,
        label:          t.label,
        icon:           t.icon,
        description:    t.sub ?? '',
        visible:        topVis,
        required:       REQUIRED_MODULE_IDS.has(t.id),
        defaultVisible: t.defaultVisible ?? true,
        groupId:        group.id,
        children,
      });
      total++;
      if (topVis) visible++;
    }

    groups.push({ id: group.id, label: groupDisplayLabel(group), items });
  }

  return {
    groups,
    stats: { total, visible, hidden: total - visible, groupCount: groups.length },
  };
}

/**
 * Apply a namespace's custom order + show/hide to a list of items. Used for BOTH
 * a group's top-level items (ns = group id) and a sub-menu's children (ns =
 * parent id). Hidden items are dropped; the rest come back in the saved order
 * (registry order if unsaved).
 */
function applyCustomization(ns: string, items: SectionItem[]): SectionItem[] {
  if (items.length === 0) return items;
  const visItems = items.map(k => ({ id: k.id, defaultVisible: k.defaultVisible ?? true }));
  const ordered    = resolveOrder(ns, visItems);
  const visibleIds = new Set(resolveVisible(ns, visItems));
  const byId = new Map(items.map(k => [k.id, k]));
  return ordered.filter(v => visibleIds.has(v.id)).map(v => byId.get(v.id)!);
}

/**
 * Merge module-declared nav groups into the built-in ordered group list for a
 * role. New module groups are inserted just before 'administration' (or
 * appended if that group is absent), so a module owns its group without editing
 * config. Duplicate ids are ignored.
 */
export function mergeModuleGroups(builtin: NavGroupItem[], role: string): NavGroupItem[] {
  const present = new Set(builtin.map(g => g.id));
  const moduleGroups: NavGroupItem[] = [];
  for (const mod of getModulesForRole(role)) {
    const g = mod.navGroup;
    if (g && !present.has(g.id)) { present.add(g.id); moduleGroups.push({ id: g.id, label: g.label }); }
  }
  if (moduleGroups.length === 0) return builtin;
  const adminIdx = builtin.findIndex(g => g.id === 'administration');
  if (adminIdx === -1) return [...builtin, ...moduleGroups];
  return [...builtin.slice(0, adminIdx), ...moduleGroups, ...builtin.slice(adminIdx)];
}

export function allSectionItems(): SectionItem[] {
  const { SECTION_DEFS, BASELINE_SECTIONS, COMMON_ITEMS } = cfg();
  return ([] as SectionItem[]).concat(BASELINE_SECTIONS, ...Object.values(SECTION_DEFS), COMMON_ITEMS);
}

// ── AppState helpers ──────────────────────────────────────────────────────────

function appState(): { get: (k: string) => string; set: (k: string, v: unknown) => void } {
  return (window as unknown as { AppState: { get: (k: string) => string; set: (k: string, v: unknown) => void } }).AppState;
}

export function getRole():         string { return appState().get('currentRole')         || ''; }
export function getUser():         string { return appState().get('currentUser')        || ''; }
export function getFullName():     string { return appState().get('currentFullName')    || ''; }
export function getProfileImage(): string { return appState().get('_currentProfileImage') || ''; }
export function getScheme():       string { return appState().get('currentColorScheme') || 'navy'; }
export function getLayout():       string { return appState().get('currentLayoutMode')  || 'sidebar'; }

// ── escapeHtml ────────────────────────────────────────────────────────────────

export function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c] ?? c,
  );
}

// ── Sidebar / top-tabs ────────────────────────────────────────────────────────

/** Whether the current role is a clocking employee (gets the Personal group). */
function isEmployeeRole(): boolean {
  const as = (window as unknown as { AppState?: { get(k: string): unknown } }).AppState;
  // superadmin is never a clocking employee — guard against a stale/missing flag
  // (e.g. an old persisted session) so it never gets the self-service Personal group.
  if (as?.get('currentRole') === 'superadmin') return false;
  return as?.get('currentIsEmployee') !== false;   // default true if unknown
}

const renderNavItem = (it: SectionItem) =>
  `<li><button data-section="${esc(it.id)}" title="${esc(it.label)}">` +
  `${navIconSvg(it.icon)}<span>${esc(it.label)}</span></button></li>`;

/**
 * Render a top-level item that may own collapsible children. Any parent with
 * children (`hasChildren`) gets a chevron toggle (data-parent-toggle), a
 * "customize" gear (data-nav-customize) to show/hide + reorder its sub-items,
 * and a nested indented <ul>. `children` is the already-customized (ordered +
 * visible) subset; `hasChildren` reflects the registry so the gear stays even
 * when every child is hidden. Leaf items render as normal. One level of nesting.
 */
function renderNavTreeItem(it: SectionItem, children: SectionItem[], open: boolean, hasChildren: boolean): string {
  if (!hasChildren) return renderNavItem(it);
  // No per-sub-menu gear: customization is driven by ONE gear on the group header
  // (see buildSidebar), which manages this sub-menu AND its siblings/children.
  // The main button navigates (icon + label); the chevron is a SEPARATE button
  // that toggles open/closed. Keeping them separate fixes the "expands but won't
  // collapse" issue (the nav click no longer forces-open) and lets the chevron
  // sit cleanly at the row's trailing edge.
  return `<li class="sb-parent${open ? ' open' : ''}" data-parent="${esc(it.id)}">`
    + `<div class="sb-parent-row">`
    + `<button class="sb-parent-main" data-section="${esc(it.id)}" title="${esc(it.label)}">`
    + `${navIconSvg(it.icon)}<span>${esc(it.label)}</span></button>`
    + `<button type="button" class="sb-parent-toggle" data-parent-toggle="${esc(it.id)}" aria-expanded="${open}" aria-label="${open ? 'Collapse' : 'Expand'} ${esc(it.label)}"><i class="fas fa-chevron-down sb-parent-chevron"></i></button>`
    + `</div>`
    + `<ul class="sb-children">` + children.map(renderNavItem).join('') + `</ul>`
    + `</li>`;
}

/** Render a group's items, nesting children under their parent (customized). The
 *  group's top-level order/visibility is keyed by groupId; each sub-menu's
 *  children by parent id. */
function renderGroupItems(items: SectionItem[], expandedParents: Set<string>, groupId: string): string {
  const childrenOf = new Map<string, SectionItem[]>();
  for (const it of items) {
    if (it.parent) (childrenOf.get(it.parent) ?? childrenOf.set(it.parent, []).get(it.parent)!).push(it);
  }
  const tops = applyCustomization(groupId, items.filter(it => !it.parent));
  return tops
    .map(it => {
      const allKids = childrenOf.get(it.id) ?? [];
      return renderNavTreeItem(it, applyCustomization(it.id, allKids), expandedParents.has(it.id), allKids.length > 0);
    })
    .join('');
}

const _groupTitle = (label: string) =>
  `<li class="sidebar-menu-title" aria-hidden="true">${esc(label)}</li>`;

// ── Accordion sidebar (Meridian-style IA, H) ──────────────────────────────────

const NAV_EXPAND_KEY = (role: string) => `siomac_nav_groups_${role}`;

/** Read which accordion groups are expanded (persisted per role). */
function loadExpandedGroups(role: string): Set<string> | null {
  try {
    const raw = localStorage.getItem(NAV_EXPAND_KEY(role));
    if (!raw) return null;
    const arr = JSON.parse(raw) as string[];
    return Array.isArray(arr) ? new Set(arr) : null;
  } catch { return null; }
}

function saveExpandedGroups(role: string, expanded: Set<string>): void {
  try { localStorage.setItem(NAV_EXPAND_KEY(role), JSON.stringify([...expanded])); } catch (_) { /* empty */ }
}

// Collapsible parent (sub-menu) expansion — persisted per role, like groups.
const NAV_PARENT_KEY = (role: string) => `siomac_nav_parents_${role}`;

function loadExpandedParents(role: string): Set<string> {
  try {
    const raw = localStorage.getItem(NAV_PARENT_KEY(role));
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch { return new Set(); }
}

function saveExpandedParents(role: string, expanded: Set<string>): void {
  try { localStorage.setItem(NAV_PARENT_KEY(role), JSON.stringify([...expanded])); } catch (_) { /* empty */ }
}

/** Wire collapsible parent (sub-menu) toggles — chevron button expands/collapses + persists. */
function _wireParentToggles(menu: HTMLElement, role: string): void {
  menu.querySelectorAll<HTMLButtonElement>('button[data-parent-toggle]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const li = btn.closest<HTMLElement>('.sb-parent');
      if (!li) return;
      const willOpen = !li.classList.contains('open');
      li.classList.toggle('open', willOpen);
      btn.setAttribute('aria-expanded', String(willOpen));
      const expanded = loadExpandedParents(role);
      const id = li.dataset.parent ?? '';
      if (willOpen) expanded.add(id); else expanded.delete(id);
      saveExpandedParents(role, expanded);
    });
  });

  // "Customize navigation" gear → open the GLOBAL NavCustomizer (all modules &
  // sections across every group in one enterprise surface). No per-group panel.
  menu.querySelectorAll<HTMLButtonElement>('button[data-nav-customize]').forEach(gear => {
    gear.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      (window as unknown as { openNavCustomizer?: () => void }).openNavCustomizer?.();
    });
  });
}

/** The currently-active section id (from localStorage last-section or the DOM). */
function activeSectionId(role: string): string {
  const active = document.querySelector<HTMLElement>('.app-section.active');
  if (active?.id) return active.id;
  try { return localStorage.getItem('siomac_last_section_' + role) ?? ''; } catch { return ''; }
}

/**
 * Build the accordion sidebar grouped by NAV_GROUPS:
 *   - 'overview' (and any label-less group) renders its items flat — no header.
 *   - other groups render a collapsible header (label + count + chevron) over an
 *     indented list of items.
 *   - the 'personal' group is included only for clocking-employee roles.
 *   - groups with no items for the role are skipped.
 * Multiple groups may be open at once; expanded state is persisted per role, and
 * the group containing the active section is always expanded.
 */
export function buildSidebar(role: string): void {
  const { SECTION_DEFS, BASELINE_SECTIONS, COMMON_ITEMS, NAV_GROUPS } = cfg();
  const main     = SECTION_DEFS[role] ?? [];
  const personal = isEmployeeRole() ? BASELINE_SECTIONS : [];
  // Static config sections + sections contributed by registered feature modules.
  const all: SectionItem[] = ([] as SectionItem[]).concat(main, personal, COMMON_ITEMS, moduleSectionItems(role));

  // Bucket items by group, preserving definition order within each group.
  const byGroup = new Map<NavGroupId, SectionItem[]>();
  for (const it of all) {
    const g = (it.group ?? 'overview');
    (byGroup.get(g) ?? byGroup.set(g, []).get(g)!).push(it);
  }

  // Effective group order = built-in groups + any groups declared by registered
  // modules (inserted before 'administration'), so a module can introduce its
  // own group without editing config.
  const orderedGroups = mergeModuleGroups(NAV_GROUPS, role);
  const groups = orderedGroups.filter(g => (byGroup.get(g.id)?.length ?? 0) > 0);
  // Count only top-level items per group (children render nested under a parent).
  const topCount = (g: NavGroupId) => (byGroup.get(g)?.filter(i => !i.parent).length ?? 0);

  // Resolve expanded GROUP state: persisted, else default open everything; the
  // active section's group is forced open so the current page is always visible.
  let expanded = loadExpandedGroups(role);
  if (!expanded) expanded = new Set(groups.map(g => g.id));
  const activeId   = activeSectionId(role);
  const activeItem = all.find(i => i.id === activeId);
  if (activeItem?.group) expanded.add(activeItem.group);

  // Expanded PARENT state (collapsible sub-menus). The active child's parent is
  // always open so the current page is visible.
  const expandedParents = loadExpandedParents(role);
  if (activeItem?.parent) expandedParents.add(activeItem.parent);

  let html = '';
  for (const g of groups) {
    const items = byGroup.get(g.id) ?? [];
    if (!g.label) {
      // Flat group (overview): items with no collapsible header.
      html += `<li class="sb-group sb-group--flat" data-group="${esc(g.id)}"><ul class="sb-group-items">`
        + renderGroupItems(items, expandedParents, g.id) + `</ul></li>`;
      continue;
    }
    const isOpen = expanded.has(g.id);
    // Header row: the expand/collapse button + a "customize" gear that opens the
    // global navigation customizer (all modules & sections, every group).
    html += `<li class="sb-group${isOpen ? ' open' : ''}" data-group="${esc(g.id)}">`
      + `<div class="sb-group-headrow">`
      + `<button type="button" class="sb-group-header" data-group-toggle="${esc(g.id)}" aria-expanded="${isOpen}">`
      + `<span class="sb-group-label">${esc(g.label)}</span>`
      + `<span class="sb-group-count">${topCount(g.id)}</span>`
      + `<i class="fas fa-chevron-down sb-group-chevron"></i>`
      + `</button>`
      + `<button type="button" class="sb-group-gear" data-nav-customize title="Customize navigation" aria-label="Customize navigation"><i class="fas fa-gear"></i></button>`
      + `</div>`
      + `<ul class="sb-group-items">` + renderGroupItems(items, expandedParents, g.id) + `</ul>`
      + `</li>`;
  }

  const menu = document.getElementById('sidebarMenu');
  if (menu) {
    menu.innerHTML = html;
    saveExpandedGroups(role, expanded);
    _wireGroupToggles(menu, role);
    _wireParentToggles(menu, role);
  }
  // Reflect the active item's highlight + ensure its group is open.
  if (activeId) {
    menu?.querySelectorAll<HTMLButtonElement>('button[data-section]').forEach(b =>
      b.classList.toggle('active', b.dataset.section === activeId));
  }
  refreshNavBadges(0);
}

/** Wire accordion group headers to expand/collapse + persist (idempotent). */
function _wireGroupToggles(menu: HTMLElement, role: string): void {
  menu.querySelectorAll<HTMLButtonElement>('button[data-group-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const li = btn.closest<HTMLElement>('.sb-group');
      if (!li) return;
      const open = li.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
      const expanded = loadExpandedGroups(role) ?? new Set<string>();
      const id = li.dataset.group ?? '';
      if (open) expanded.add(id); else expanded.delete(id);
      saveExpandedGroups(role, expanded);
    });
  });
}

export function buildTopTabs(role: string): void {
  const { SECTION_DEFS, BASELINE_SECTIONS, COMMON_ITEMS } = cfg();
  const personal = isEmployeeRole() ? BASELINE_SECTIONS : [];
  // Top-tabs are flat: management first, then personal, then account.
  const items = (SECTION_DEFS[role] ?? []).concat(personal, COMMON_ITEMS);
  const tabs = document.getElementById('topTabs');
  if (tabs) {
    tabs.innerHTML = items.map(it =>
      `<button data-section="${esc(it.id)}" title="${esc(it.label)}">` +
      `<i class="fas ${esc(it.icon)}"></i><span>${esc(it.label)}</span></button>`,
    ).join('');
  }
  refreshNavBadges(0);
}

// ── Palette / layout ──────────────────────────────────────────────────────────

export function applyPalette(id: string): void {
  const { PALETTES } = cfg();
  const p = PALETTES.find(x => x.id === id) ?? PALETTES[0];
  if (!p) return;
  const root = document.documentElement.style;
  root.setProperty('--navy-primary', p.primary);
  root.setProperty('--navy-dark',    p.dark);
  root.setProperty('--navy-light',   p.light);
  root.setProperty('--navy-accent',  p.accent);
  root.setProperty('--navy-hover',   p.hover);
  try { localStorage.setItem('colorScheme', p.id); } catch (_) { /* empty */ }
}

export function renderPalettes(): void {
  const { PALETTES } = cfg();
  const current = getScheme();
  const html = PALETTES.map(p =>
    `<div class="palette-card ${p.id === current ? 'active' : ''}" data-palette="${esc(p.id)}">` +
    `<div class="palette-name">${esc(p.name)}</div>` +
    `<div class="palette-swatches">` +
    `<div class="palette-swatch" style="background:${esc(p.primary)};"></div>` +
    `<div class="palette-swatch" style="background:${esc(p.dark)};"></div>` +
    `<div class="palette-swatch" style="background:${esc(p.light)};"></div>` +
    `<div class="palette-swatch" style="background:${esc(p.accent)};"></div>` +
    `<div class="palette-swatch" style="background:${esc(p.hover)};"></div>` +
    `</div>` +
    `<div class="palette-preview" style="background:linear-gradient(135deg,${esc(p.primary)} 0%,${esc(p.accent)} 100%);"></div>` +
    `</div>`,
  ).join('');
  const grid = document.getElementById('paletteGrid');
  if (grid) grid.innerHTML = html;
}

export function applyLayout(mode: string): void {
  const { LAYOUTS } = cfg();
  const valid = LAYOUTS.find(l => l.id === mode) ? mode : 'sidebar';
  document.body.classList.remove('layout-sidebar', 'layout-tabs');
  document.body.classList.add('layout-' + valid);
  try { localStorage.setItem('layoutMode', valid); } catch (_) { /* empty */ }
  if (valid === 'tabs' && getRole()) buildTopTabs(getRole());
}

export function renderLayouts(): void {
  const { LAYOUTS } = cfg();
  const html = LAYOUTS.map(l =>
    `<div class="layout-card ${l.id === getLayout() ? 'active' : ''}" data-layout="${esc(l.id)}">` +
    `<div class="layout-icon"><i class="fas ${esc(l.icon)}"></i></div>` +
    `<div class="layout-name">${esc(l.name)}</div>` +
    `<div class="layout-desc">${esc(l.desc)}</div></div>`,
  ).join('');
  const grid = document.getElementById('layoutGrid');
  if (grid) grid.innerHTML = html;
}

export async function savePalette(id: string): Promise<void> {
  const prev = getScheme();
  appState().set('currentColorScheme', id);
  applyPalette(id);
  renderPalettes();
  // Reload charts if on dashboard
  const win = window as unknown as Record<string, { loadDashboardCharts?: (f?: boolean) => void; loadChart?: () => void; loadTrendChart?: () => void }>;
  if (document.getElementById('s-adm-dashboard')?.classList.contains('active')) win.Dashboard?.loadDashboardCharts?.(true);
  const sc = win.SiomacCharts as { hasAttendanceChart?: () => boolean; hasTrendChart?: () => boolean } | undefined;
  if (sc?.hasAttendanceChart?.()) win.Dashboard?.loadChart?.();
  if (sc?.hasTrendChart?.())      win.Dashboard?.loadTrendChart?.();

  const res = await updateColorScheme({ username: getUser(), scheme: id });
  if (!res.success) {
    appState().set('currentColorScheme', prev);
    applyPalette(prev);
    renderPalettes();
    (window as unknown as { showPopup?: (t: string, h: string, m: string) => void }).showPopup?.('error', 'Failed to save', res.message || 'Could not persist theme');
  } else {
    (window as unknown as { showPopup?: (t: string, h: string, m: string) => void }).showPopup?.('success', 'Theme Saved', `${cfg().PALETTES.find(p => p.id === id)?.name ?? id} applied.`);
  }
}

export async function saveLayout(mode: string): Promise<void> {
  if (mode === getLayout()) return;
  const prev = getLayout();
  appState().set('currentLayoutMode', mode);
  applyLayout(mode);
  renderLayouts();
  const res = await updateLayoutMode({ username: getUser(), mode });
  if (!res.success) {
    appState().set('currentLayoutMode', prev);
    applyLayout(prev);
    renderLayouts();
    (window as unknown as { showPopup?: (t: string, h: string, m: string) => void }).showPopup?.('error', 'Failed to save', res.message || 'Could not switch layout');
  } else {
    (window as unknown as { showPopup?: (t: string, h: string, m: string) => void }).showPopup?.('success', 'Layout Saved', `${cfg().LAYOUTS.find(l => l.id === mode)?.name ?? mode} layout active.`);
  }
}

// ── Section routing ───────────────────────────────────────────────────────────

export function showSection(id: string): void {
  const win = window as unknown as Record<string, { getDashEditMode?: () => boolean; toggleEditMode?: () => void }>;
  if (id !== 's-adm-dashboard' && win.Dashboard?.getDashEditMode?.()) {
    win.Dashboard.toggleEditMode?.();
  }

  // Registered modules serve every one of their nav items from a single panel
  // (declared as mount.sectionId). Route the logical id to that panel; the
  // module's shell renders the matching page from the 'siomac:section' event.
  const mod = getModuleForSection(id);
  const panelId = mod ? mod.mount.sectionId : id;

  // Publish the active panel to the shared store: Preact renders each panel's
  // `active` class from it, so shell re-renders can't drop it (see
  // shell/sections/useActiveSection.ts). The imperative toggle below stays as a
  // first-paint fallback for any non-Preact panels.
  setActivePanel(panelId);
  document.querySelectorAll('.app-section').forEach(s => s.classList.remove('active'));
  document.getElementById(panelId)?.classList.add('active');

  // Broadcast the logical section id so module shells can render the right page.
  try { window.dispatchEvent(new CustomEvent('siomac:section', { detail: id })); } catch (_) { /* empty */ }

  if (id === 's-adm-projects') {
    setTimeout(() => {
      const miniMaps = (window as unknown as { _getSiteMiniMaps?: () => Record<string, unknown> })._getSiteMiniMaps?.() ?? {};
      Object.values(miniMaps).forEach(m => {
        if (m && m !== 'pending') {
          try { (m as { invalidateSize: () => void }).invalidateSize(); } catch (_) { /* empty */ }
        }
      });
    }, 80);
  }

  try { localStorage.setItem('siomac_last_section_' + getRole(), id); } catch (_) { /* empty */ }

  document.querySelectorAll('.sidebar-menu button[data-section]').forEach(b =>
    b.classList.toggle('active', (b as HTMLButtonElement).dataset.section === id));
  document.querySelectorAll('#topTabs button').forEach(b =>
    b.classList.toggle('active', (b as HTMLButtonElement).dataset.section === id));

  // Ensure the active item's accordion group is expanded so it stays visible.
  const activeBtn = document.querySelector<HTMLButtonElement>(`#sidebarMenu button[data-section="${id}"]`);
  const grp = activeBtn?.closest<HTMLElement>('.sb-group');
  if (grp && !grp.classList.contains('sb-group--flat') && !grp.classList.contains('open')) {
    grp.classList.add('open');
    grp.querySelector('[data-group-toggle]')?.setAttribute('aria-expanded', 'true');
    const role = getRole();
    const expanded = loadExpandedGroups(role) ?? new Set<string>();
    expanded.add(grp.dataset.group ?? '');
    saveExpandedGroups(role, expanded);
  }

  document.getElementById('sidebar')?.classList.remove('mobile-open');
  document.getElementById('sidebarBackdrop')?.classList.remove('active');

  refreshSection(id);
}

export function refreshSection(id: string): void {
  const role = getRole();
  const win  = window as unknown as Record<string, Record<string, ((...a: unknown[]) => unknown) | undefined> | undefined>;
  const checkStatus = (window as unknown as { checkStatus?: () => void }).checkStatus;

  switch (id) {
    case 's-settings':
      win.SettingsView?._stgActivatePanel?.((role === 'admin' || role === 'superadmin') ? 'company' : 'appearance');
      renderPalettes(); renderLayouts();
      win.SettingsView?.loadAdminBrandingSettings?.();
      break;
    case 's-profile':
      document.querySelectorAll('.ep-tab-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
      document.querySelectorAll('.ep-tab-pane').forEach((p, i) => p.classList.toggle('active', i === 0));
      win.Profile?.loadMyProfile?.();
      break;
    case 's-emp-attendance':
      checkStatus?.();
      (win.Dashboard as { loadChart?: () => void; loadTrendChart?: () => void } | undefined)?.loadChart?.();
      (win.Dashboard as { loadChart?: () => void; loadTrendChart?: () => void } | undefined)?.loadTrendChart?.();
      break;
    case 's-emp-history':     win.Employees?.loadHistoryInline?.();           break;
    case 's-projectMap': {
      const lmap = (window as unknown as { AppState?: { get: (k: string) => unknown } }).AppState?.get('map');
      setTimeout(() => { if (!lmap) win.LiveMap?.initializeMap?.(); else (lmap as { invalidateSize: () => void }).invalidateSize(); }, 80);
      win.LiveMap?.loadLiveAttendance?.();
      (window as unknown as { _clearMapBadge?: () => void })._clearMapBadge?.();
      break;
    }
    case 's-emp-leave':       win.Employees?.loadLeaveRequests?.();            break;
    case 's-emp-payroll':     win.Employees?.loadMyPayslips?.();               break;
    case 's-mgr-overview':    win.Employees?.loadDepartmentData?.();           break;
    case 's-mgr-employees':   win.Employees?.loadDepartmentEmployees?.();      break;
    case 's-mgr-leaves':      win.Employees?.loadManagerLeaveApplications?.(); break;
    case 's-adm-dashboard':
      win.Employees?.loadDashboardData?.();
      (win.Dashboard as { loadDashboardCharts?: () => void; initDashboardLayoutEditor?: () => void } | undefined)?.loadDashboardCharts?.();
      (win.Dashboard as { loadDashboardCharts?: () => void; initDashboardLayoutEditor?: () => void } | undefined)?.initDashboardLayoutEditor?.();
      break;
    case 's-adm-employees':   win.Employees?.loadEmployeeList?.();             break;
    case 's-adm-departments': win.Employees?.loadDepartments?.();              break;
    case 's-adm-projects':    win.Sites?.loadProjectSites?.();                 break;
    case 's-adm-attendance':  win.AttendanceView?.loadAttendanceData?.();      break;
    case 's-adm-leaves':      win.LeaveView?.loadLeaveApplications?.();        break;
    case 's-adm-rates':       win.Payroll?.loadHourlyRates?.();               break;
    case 's-payroll':         win.Payroll?.initPayrollSection?.();             break;
  }
}

// ── Skeleton helpers (used by legacy JS modules that remain) ──────────────────

export function setSkel(id: string, html: string): void {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

export function skelStatValues(ids: string[]): void {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<div class="skeleton skel-text-lg" style="width:60px;margin:0 auto;"></div>';
  });
}

export function skelTableRows(cols: number, rows: number): string {
  let html = '';
  for (let r = 0; r < rows; r++) {
    html += '<tr>';
    for (let c = 0; c < cols; c++)
      html += `<td><div class="skeleton skel-text" style="width:${50 + Math.floor(Math.random() * 40)}%;"></div></td>`;
    html += '</tr>';
  }
  return html;
}

export function skelStatCards(n: number): string {
  let html = '';
  for (let i = 0; i < n; i++)
    html += `<div class="skel-stat-card"><div class="skeleton skel-icon"></div><div class="skeleton skel-text-lg" style="width:50%;"></div><div class="skeleton skel-text" style="width:75%;"></div></div>`;
  return html;
}

export function skelCards(n: number): string {
  let html = '';
  for (let i = 0; i < n; i++)
    html += `<div class="skel-card"><div class="skeleton skel-text-lg" style="width:55%;"></div><div class="skeleton skel-text" style="width:90%;"></div><div class="skeleton skel-text" style="width:65%;"></div><div class="skeleton skel-text" style="width:80%;"></div></div>`;
  return html;
}

export function skelList(n: number): string {
  let html = '';
  for (let i = 0; i < n; i++)
    html += `<div class="lm-emp-item lm-emp-item--skel"><div class="lm-emp-avatar skeleton"></div><div class="lm-emp-info"><div class="skeleton skel-text" style="width:55%;"></div><div class="skeleton skel-text-sm" style="width:75%;margin-top:6px;"></div></div></div>`;
  return html;
}

// ── Badge helpers ─────────────────────────────────────────────────────────────

const _badgeLastCount = new WeakMap<Element, number>();

export function setHdrBadge(badge: Element | null, count: number, dot?: boolean): void {
  if (!badge) return;
  const prev = _badgeLastCount.get(badge);
  if (prev === count) return;
  _badgeLastCount.set(badge, count);
  if (dot) {
    badge.textContent = '';
    (badge as HTMLElement).style.display = count > 0 ? '' : 'none';
    return;
  }
  const label = count > 0 ? (count > 99 ? '99+' : String(count)) : '';
  badge.textContent = label;
  (badge as HTMLElement).style.display = count > 0 ? '' : 'none';
  if (count > 0 && (prev === undefined || prev === 0)) {
    (badge as HTMLElement).style.animation = 'none';
    void (badge as HTMLElement).offsetWidth; // reflow — forces browser to flush styles
    (badge as HTMLElement).style.animation = '';
  }
}

// ── Nav leave badges ──────────────────────────────────────────────────────────

const LEAVE_SECTION_IDS = ['s-adm-leaves', 's-mgr-leaves', 's-emp-leave'];
const _sbBadgeLastLabel = new Map<string, string>();

function _setSbBadge(btn: HTMLButtonElement, count: number) {
  const key   = btn.dataset.section ?? btn.id;
  const label = count > 0 ? (count > 99 ? '99+' : String(count)) : '';
  if (_sbBadgeLastLabel.get(key) === label) return;
  _sbBadgeLastLabel.set(key, label);
  let b = btn.querySelector<HTMLElement>('.sb-nav-badge');
  if (count > 0) {
    if (!b) {
      b = document.createElement('span');
      b.className = 'sb-nav-badge';
      b.style.animation = 'none';
      btn.appendChild(b);
      void b.offsetWidth; // reflow
    }
    b.textContent = label;
    b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
    b.classList.remove('sb-badge-bounce'); void b.offsetWidth; b.classList.add('sb-badge-bounce');
  } else {
    if (b) b.remove();
  }
}

export function refreshNavBadges(unreadLeaveCount: number): void {
  ['#sidebarMenu', '#topTabs'].forEach(sel => {
    document.querySelectorAll<HTMLButtonElement>(`${sel} button[data-section]`).forEach(btn => {
      if (LEAVE_SECTION_IDS.includes(btn.dataset.section ?? '')) {
        _setSbBadge(btn, unreadLeaveCount);
      }
    });
  });
}
