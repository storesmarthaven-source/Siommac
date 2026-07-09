/**
 * src/components/nav/NavCustomizer.tsx
 *
 * The GLOBAL navigation customizer (super-admin): one full-screen enterprise
 * modal that lists every module ORGANISED BY SIDEBAR GROUP — HR shows all HR,
 * Finance all Finance, Settings all Settings, etc. — mirroring the sidebar's own
 * grouping. Opened via window.openNavCustomizer() (no argument); the sidebar
 * group gears all route here. There is no per-group panel.
 *
 * Drag is pointer-event based, transform-only (no DOM reorder mid-drag).
 * Persistence uses the namespaced localStorage store (navVisibility.ts).
 * Changes apply live to the sidebar on every toggle / reorder.
 * "Save Changes" and "Cancel" both close the modal — changes are already live;
 * only "Reset to defaults" reverts.
 *
 * Mount once via mountNavCustomizer(); it self-exposes window.openNavCustomizer.
 */

import { h, render, type VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  navGlobalCatalog,
  REQUIRED_MODULE_IDS,
  type GlobalModuleEntry,
  type NavGlobalCatalog,
  type NavGlobalGroup,
} from './navCore';
import { navIconSvg } from './navIcons';
import {
  setVisible,
  setOrder,
  resetVisibility,
} from '@lib/navVisibility';
import './NavCustomizer.css';

// ── Shared helpers ─────────────────────────────────────────────────────────────

function currentRole(): string {
  return (window as unknown as { AppState?: { get(k: string): string } }).AppState?.get('currentRole') ?? '';
}

function rebuildSidebar(): void {
  const nav = (window as unknown as { Nav?: { buildSidebar?: (r: string) => void } }).Nav;
  nav?.buildSidebar?.(currentRole());
}

// ── Inline Lucide SVGs (paths only, no external dep) ─────────────────────────

function Svg({ w = 16, h: ht = 16, children, cls = '' }: { w?: number; h?: number; children: VNode | VNode[]; cls?: string }): VNode {
  return (
    <svg class={cls || undefined} width={w} height={ht} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
      aria-hidden="true">
      {children}
    </svg>
  );
}

const IcoLayers   = (): VNode => <Svg><path d="M12 2 2 7l10 5 10-5-10-5"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></Svg>;
const IcoEye      = (): VNode => <Svg><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></Svg>;
const IcoEyeOff   = (): VNode => <Svg><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></Svg>;
const IcoGrid     = (): VNode => <Svg><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></Svg>;
const IcoSearch   = (): VNode => <Svg><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></Svg>;
const IcoChevRight= (): VNode => <Svg w={14} h={14}><path d="m9 18 6-6-6-6"/></Svg>;
const IcoChevDown = (): VNode => <Svg w={14} h={14}><path d="m6 9 6 6 6-6"/></Svg>;
const IcoLock     = (): VNode => <Svg w={13} h={13}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></Svg>;
const IcoReset    = (): VNode => <Svg w={15} h={15}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></Svg>;
const IcoInfo     = (): VNode => <Svg w={15} h={15}><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></Svg>;
const IcoClose    = (): VNode => <Svg w={18} h={18}><path d="M18 6 6 18M6 6l12 12"/></Svg>;

const GripDots = (): VNode => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/>
    <circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/>
    <circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/>
  </svg>
);

// ── Shared sub-components ─────────────────────────────────────────────────────

function NavIcon({ fa }: { fa: string }): VNode {
  return <span class="navcust-row-icon" dangerouslySetInnerHTML={{ __html: navIconSvg(fa) }} />;
}

interface SwitchProps { on: boolean; label: string; disabled?: boolean; onToggle: () => void; }
function Switch({ on, label, disabled = false, onToggle }: SwitchProps): VNode {
  return (
    <button type="button"
      class={`navcust-switch${on ? ' on' : ''}${disabled ? ' locked' : ''}`}
      role="switch" aria-checked={on} disabled={disabled}
      aria-label={`${on ? 'Hide' : 'Show'} ${label}`}
      onClick={disabled ? undefined : onToggle} />
  );
}

// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ────
// GLOBAL CUSTOMIZER (full-screen enterprise modal, grouped by sidebar group)
// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ────

type FilterKey = 'all' | 'visible' | 'hidden';

// One pointer-drag session — reused for reordering top-level modules WITHIN a
// group AND children within a parent. The container element carries the
// persistence namespace (group id or parent id) in a data attribute.
interface DragSession {
  ns: string; blockSel: string;
  els: HTMLElement[]; centers: number[]; dragEl: HTMLElement;
  fromIndex: number; targetIndex: number; startY: number; dragH: number;
}

function GlobalCustomizer({ onClose }: { onClose: () => void }): VNode {
  const role = currentRole();
  const freshCatalog = (): NavGlobalCatalog => navGlobalCatalog(role);

  const [catalog,  setCatalog]  = useState<NavGlobalCatalog>(freshCatalog);
  const [filter,   setFilter]   = useState<FilterKey>('all');
  const [search,   setSearch]   = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const drag = useRef<DragSession | null>(null);
  const reload = (): void => setCatalog(freshCatalog());

  // ── Filtering ────────────────────────────────────────────────────────────
  const q = search.trim().toLowerCase();

  function itemMatches(m: GlobalModuleEntry): boolean {
    const text = !q
      || m.label.toLowerCase().includes(q)
      || m.description.toLowerCase().includes(q)
      || (m.children?.some(c => c.label.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)) ?? false);
    if (!text) return false;
    if (filter === 'visible') return m.visible;
    if (filter === 'hidden')  return !m.visible || (m.children?.some(c => !c.visible) ?? false);
    return true;
  }

  const visibleGroups: NavGlobalGroup[] = catalog.groups
    .map(g => ({ ...g, items: g.items.filter(itemMatches) }))
    .filter(g => g.items.length > 0);

  // ── Toggles ──────────────────────────────────────────────────────────────
  function toggleItem(mod: GlobalModuleEntry): void {
    if (mod.required) return;
    setVisible(mod.groupId, mod.id, !mod.visible);
    rebuildSidebar();
    reload();
  }
  function toggleChild(parentId: string, childId: string, childVis: boolean): void {
    if (REQUIRED_MODULE_IDS.has(childId)) return;
    setVisible(parentId, childId, !childVis);
    rebuildSidebar();
    reload();
  }
  function toggleExpand(id: string): void {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // ── Reset all ──────────────────────────────────────────────────────────────
  function resetAll(): void {
    const namespaces = new Set<string>();
    for (const g of catalog.groups) {
      namespaces.add(g.id);
      for (const m of g.items) if (m.children) namespaces.add(m.id);
    }
    for (const ns of namespaces) resetVisibility(ns);
    rebuildSidebar();
    reload();
  }

  // ── Unified pointer-drag (reorder rows within their container) ──────────────
  function startDrag(e: PointerEvent, containerSel: string, blockSel: string, nsAttr: 'group' | 'parent'): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const grip = e.currentTarget as HTMLElement;
    const container = grip.closest<HTMLElement>(containerSel);
    const dragEl    = grip.closest<HTMLElement>(blockSel);
    if (!container || !dragEl) return;
    const els = Array.from(container.querySelectorAll<HTMLElement>(`:scope > ${blockSel}`));
    if (els.length < 2) return;
    const fromIndex = els.indexOf(dragEl);
    if (fromIndex < 0) return;
    const rects = els.map(el => el.getBoundingClientRect());
    drag.current = {
      ns: (nsAttr === 'group' ? container.dataset['group'] : container.dataset['parent']) ?? '',
      blockSel, els, dragEl,
      centers:   rects.map(r => r.top + r.height / 2),
      fromIndex, targetIndex: fromIndex, startY: e.clientY,
      dragH:     (rects[fromIndex]?.height ?? 48) + 8,
    };
    dragEl.classList.add('is-dragging');
    document.body.style.cursor = 'grabbing';
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragUp, { once: true });
  }

  function onDragMove(e: PointerEvent): void {
    const st = drag.current;
    if (!st) return;
    const dy = e.clientY - st.startY;
    st.dragEl.style.transform = `translateY(${dy}px)`;
    const dc = (st.centers[st.fromIndex] ?? 0) + dy;
    let target = st.fromIndex;
    if (dy > 0) { while (target < st.els.length - 1 && dc > (st.centers[target + 1] ?? 0)) target++; }
    else        { while (target > 0               && dc < (st.centers[target - 1] ?? 0)) target--; }
    st.targetIndex = target;
    st.els.forEach((el, i) => {
      if (i === st.fromIndex) return;
      let shift = 0;
      if (st.fromIndex < target && i > st.fromIndex && i <= target) shift = -st.dragH;
      else if (st.fromIndex > target && i < st.fromIndex && i >= target) shift = st.dragH;
      el.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  }

  function onDragUp(): void {
    const st = drag.current;
    drag.current = null;
    window.removeEventListener('pointermove', onDragMove);
    document.body.style.cursor = '';
    if (st) { st.els.forEach(el => { el.style.transform = ''; }); st.dragEl.classList.remove('is-dragging'); }
    if (!st || st.targetIndex === st.fromIndex) return;
    const ids = st.els.map(el => el.dataset['id'] ?? '');
    const [moved] = ids.splice(st.fromIndex, 1);
    ids.splice(st.targetIndex, 0, moved!);
    setOrder(st.ns, ids);
    rebuildSidebar();
    reload();
  }

  // Cleanup any dangling move listener on unmount.
  useEffect(() => () => window.removeEventListener('pointermove', onDragMove), []);

  // ── Render ────────────────────────────────────────────────────────────────
  const { stats } = catalog;
  const filterDefs: { id: FilterKey; label: string; icon: VNode; count: number }[] = [
    { id: 'all',     label: 'All modules', icon: <IcoLayers />, count: stats.total },
    { id: 'visible', label: 'Visible',     icon: <IcoEye />,    count: stats.visible },
    { id: 'hidden',  label: 'Hidden',      icon: <IcoEyeOff />, count: stats.hidden },
  ];

  return (
    <div class="navcfg-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !drag.current) onClose(); }}>
      <div class="navcfg-modal" role="dialog" aria-modal="true" aria-label="Customize Navigation">

        {/* ── Header ── */}
        <div class="navcfg-hdr">
          <div class="navcfg-hdr-icon" aria-hidden="true"><IcoLayers /></div>
          <div class="navcfg-hdr-text">
            <h2 class="navcfg-title">Customize Navigation</h2>
            <p class="navcfg-subtitle">Show, hide, and reorder sidebar modules and sections to match your workflow.</p>
          </div>
          <button type="button" class="navcfg-close-btn" onClick={onClose} aria-label="Close customizer">
            <IcoClose />
          </button>
        </div>

        {/* ── Stats + search bar ── */}
        <div class="navcfg-statsbar">
          <div class="navcfg-stats">
            <div class="navcfg-stat">
              <span class="navcfg-stat-icon"><IcoLayers /></span>
              <span class="navcfg-stat-num">{stats.total}</span>
              <span class="navcfg-stat-lbl">Total modules</span>
            </div>
            <div class="navcfg-stat-div" aria-hidden="true" />
            <div class="navcfg-stat">
              <span class="navcfg-stat-icon navcfg-stat-icon--vis"><IcoEye /></span>
              <span class="navcfg-stat-num">{stats.visible}</span>
              <span class="navcfg-stat-lbl">Visible</span>
            </div>
            <div class="navcfg-stat-div" aria-hidden="true" />
            <div class="navcfg-stat">
              <span class="navcfg-stat-icon navcfg-stat-icon--hid"><IcoEyeOff /></span>
              <span class="navcfg-stat-num">{stats.hidden}</span>
              <span class="navcfg-stat-lbl">Hidden</span>
            </div>
            <div class="navcfg-stat-div" aria-hidden="true" />
            <div class="navcfg-stat">
              <span class="navcfg-stat-icon navcfg-stat-icon--ms"><IcoGrid /></span>
              <span class="navcfg-stat-num">{stats.groupCount}</span>
              <span class="navcfg-stat-lbl">Groups</span>
            </div>
          </div>
          <div class="navcfg-search-wrap">
            <span class="navcfg-search-ico" aria-hidden="true"><IcoSearch /></span>
            <input
              type="search"
              class="navcfg-search"
              placeholder="Search modules or sections…"
              value={search}
              onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
              aria-label="Search modules or sections"
            />
          </div>
        </div>

        {/* ── Body (rail + grouped main) ── */}
        <div class="navcfg-body">

          {/* Left rail — filters only */}
          <aside class="navcfg-rail">
            <div class="navcfg-rail-title">Filter modules</div>
            {filterDefs.map(f => (
              <button
                key={f.id}
                type="button"
                class={`navcfg-filter-row${filter === f.id ? ' active' : ''}`}
                onClick={() => setFilter(f.id)}
              >
                <span class="navcfg-filter-ico">{f.icon}</span>
                <span class="navcfg-filter-lbl">{f.label}</span>
                <span class="navcfg-filter-badge">{f.count}</span>
              </button>
            ))}
          </aside>

          {/* Main — one section per sidebar group */}
          <main class="navcfg-main">

            <div class="navcfg-guide">
              <span class="navcfg-guide-ico" aria-hidden="true"><IcoInfo /></span>
              <p>Drag the <strong>handle</strong> to reorder modules and sections within their group. Use the <strong>toggle</strong> to show or hide an item in the sidebar.</p>
            </div>

            {visibleGroups.length === 0 ? (
              <div class="navcfg-empty">No modules match this filter.</div>
            ) : visibleGroups.map(group => (
              <section class="navcfg-group" key={group.id}>
                <div class="navcfg-group-hd">
                  <span class="navcfg-group-name">{group.label}</span>
                  <span class="navcfg-count-pill">{group.items.length} {group.items.length === 1 ? 'module' : 'modules'}</span>
                </div>

                <div class="navcfg-group-body" data-group={group.id}>
                  {group.items.map((mod, i) => {
                    const isExpanded = expanded.has(mod.id);
                    const childCount = mod.children?.length ?? 0;
                    return (
                      <div
                        class={`navcfg-mod-block${mod.visible ? '' : ' is-hidden'}${isExpanded ? ' is-expanded' : ''}`}
                        key={mod.id}
                        data-id={mod.id}
                      >
                        <div class="navcfg-mod-row">
                          <span class="navcfg-order">{i + 1}</span>
                          <span
                            class="navcfg-grip"
                            aria-label={`Drag to reorder ${mod.label}`}
                            onPointerDown={(e) => startDrag(e as unknown as PointerEvent, '.navcfg-group-body', '.navcfg-mod-block', 'group')}
                          >
                            <GripDots />
                          </span>
                          <span class="navcfg-mod-cell">
                            {childCount > 0 && (
                              <button
                                type="button"
                                class="navcfg-expand"
                                onClick={() => toggleExpand(mod.id)}
                                aria-expanded={isExpanded}
                                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${mod.label}`}
                              >
                                {isExpanded ? <IcoChevDown /> : <IcoChevRight />}
                              </button>
                            )}
                            <NavIcon fa={mod.icon} />
                            <span class="navcfg-mod-name">{mod.label}</span>
                            {childCount > 0 && <span class="navcfg-count-pill navcfg-count-pill--sm">{childCount} sections</span>}
                          </span>
                          <span class="navcfg-desc-cell">{mod.description}</span>
                          <span class="navcfg-vis-cell">
                            {mod.required ? (
                              <span class="navcfg-lock-wrap" title="Required — cannot be hidden"><IcoLock /></span>
                            ) : (
                              <Switch on={mod.visible} label={mod.label} onToggle={() => toggleItem(mod)} />
                            )}
                          </span>
                        </div>

                        {childCount > 0 && isExpanded && mod.children && (
                          <div class="navcfg-child-list" data-parent={mod.id}>
                            {mod.children.map(child => {
                              const effectiveVis = mod.visible && child.visible;
                              const inherited    = !mod.visible;
                              return (
                                <div
                                  class={`navcfg-child-row${effectiveVis ? '' : ' is-hidden'}${inherited ? ' is-inherited' : ''}`}
                                  key={child.id}
                                  data-id={child.id}
                                >
                                  <span
                                    class="navcfg-grip navcfg-grip--child"
                                    aria-label={`Drag to reorder ${child.label}`}
                                    onPointerDown={(e) => startDrag(e as unknown as PointerEvent, '.navcfg-child-list', '.navcfg-child-row', 'parent')}
                                  >
                                    <GripDots />
                                  </span>
                                  <NavIcon fa={child.icon} />
                                  <span class="navcfg-child-name">{child.label}</span>
                                  {inherited && <span class="navcfg-inherited-badge" title="Hidden because the parent group is off">inherited hidden</span>}
                                  <span class="navcfg-vis-cell">
                                    {child.required ? (
                                      <span class="navcfg-lock-wrap" title="Required — cannot be hidden"><IcoLock /></span>
                                    ) : (
                                      <Switch on={child.visible} label={child.label} disabled={inherited} onToggle={() => toggleChild(mod.id, child.id, child.visible)} />
                                    )}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </main>
        </div>

        {/* ── Footer ── */}
        <div class="navcfg-footer">
          <div class="navcfg-footer-reset">
            <button type="button" class="navcfg-reset-btn" onClick={resetAll}>
              <IcoReset />
              <span class="navcfg-reset-label">
                Reset to defaults
                <span class="navcfg-reset-sub">Revert all changes and restore the default navigation.</span>
              </span>
            </button>
          </div>
          <div class="navcfg-footer-actions">
            <button type="button" class="navcfg-cancel-btn" onClick={onClose}>Cancel</button>
            <button type="button" class="navcfg-save-btn" onClick={onClose}>Save Changes</button>
          </div>
        </div>

      </div>
    </div>
  );
}

// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ────
// ROOT COMPONENT — mounts/unmounts the global customizer
// ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ────

function NavCustomizerRoot(): VNode | null {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Any argument (legacy per-group id) is ignored — there is one global surface.
    (window as unknown as Record<string, unknown>)['openNavCustomizer'] = () => setOpen(true);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      delete (window as unknown as Record<string, unknown>)['openNavCustomizer'];
    };
  }, []);

  if (!open) return null;
  return <GlobalCustomizer onClose={() => setOpen(false)} />;
}

// ── Mount ─────────────────────────────────────────────────────────────────────

export function mountNavCustomizer(root: HTMLElement): void {
  render(h(NavCustomizerRoot, null), root);
}
