/**
 * src/components/nav/NavCustomizer.tsx
 *
 * Reusable "customize sub-menu" overlay. ANY collapsible nav parent whose module
 * declares a `visibilityNamespace` gets a gear (added generically in navCore);
 * the gear calls window.openNavCustomizer(parentId), which this component
 * handles. It resolves the owning module + that parent's toggleable children
 * from the registry and renders a checklist bound to the navVisibility store.
 *
 * No module-specific code — works for PPE today and any future module sub-menu.
 *
 * Mount once via mountNavCustomizer(); it self-exposes window.openNavCustomizer.
 */

import { h, render, type VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { getModuleForSection, type ModuleNavItem } from '@lib/moduleRegistry';
import { isVisible, setVisible, resetVisibility } from '@lib/navVisibility';
import './NavCustomizer.css';

interface OpenState {
  parentId: string;
  ns:       string;
  title:    string;
  items:    ModuleNavItem[];   // toggleable children
}

/** Resolve the customizer payload for a parent id, or null if not customizable. */
function resolveOpen(parentId: string): OpenState | null {
  const mod = getModuleForSection(parentId);
  if (!mod?.visibilityNamespace) return null;
  const items = mod.navItems.filter(i => i.parent === parentId && i.defaultVisible !== undefined);
  if (items.length === 0) return null;
  const title = mod.navItems.find(i => i.id === parentId)?.label ?? 'Menu';
  return { parentId, ns: mod.visibilityNamespace, title, items };
}

function NavCustomizer(): VNode | null {
  const [open, setOpen] = useState<OpenState | null>(null);
  const [, force]       = useState(0);   // re-render after a toggle

  useEffect(() => {
    (window as unknown as Record<string, unknown>)['openNavCustomizer'] = (parentId: string) => {
      setOpen(resolveOpen(parentId));
    };
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(null); }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      delete (window as unknown as Record<string, unknown>)['openNavCustomizer'];
    };
  }, []);

  if (!open) return null;

  /** Rebuild the sidebar so visibility changes show immediately. */
  function rebuildSidebar() {
    const nav = (window as unknown as { Nav?: { buildSidebar?: (r: string) => void } }).Nav;
    const role = (window as unknown as { AppState?: { get(k: string): string } }).AppState?.get('currentRole') ?? '';
    nav?.buildSidebar?.(role);
  }

  function toggle(id: string, next: boolean) {
    setVisible(open!.ns, id, next);
    rebuildSidebar();
    force(n => n + 1);
  }

  function resetAll() {
    resetVisibility(open!.ns);
    rebuildSidebar();
    force(n => n + 1);
  }

  const close = () => setOpen(null);
  const visibleCount = open.items.filter(i => isVisible(open.ns, open.items.map(x => ({ id: x.id, defaultVisible: x.defaultVisible! })), i.id)).length;

  return (
    <div class="navcust-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div class="navcust-panel" role="dialog" aria-modal="true" aria-label={`Customize ${open.title} menu`}>
        <div class="navcust-head">
          <div>
            <div class="navcust-title"><i class="fas fa-sliders" /> Customize {open.title}</div>
            <div class="navcust-sub">{visibleCount} of {open.items.length} shown · choose which appear in the sidebar</div>
          </div>
          <button type="button" class="navcust-close" onClick={close} aria-label="Close">&times;</button>
        </div>

        <div class="navcust-list">
          {open.items.map(it => {
            const on = isVisible(open.ns, open.items.map(x => ({ id: x.id, defaultVisible: x.defaultVisible! })), it.id);
            return (
              <label class="navcust-row" key={it.id}>
                <span class="navcust-row-icon"><i class={`fas ${it.icon}`} /></span>
                <span class="navcust-row-label">{it.label}</span>
                <input type="checkbox" class="navcust-row-toggle" checked={on} onChange={(e) => toggle(it.id, (e.target as HTMLInputElement).checked)} />
                <span class={`navcust-switch${on ? ' on' : ''}`} aria-hidden="true" />
              </label>
            );
          })}
        </div>

        <div class="navcust-foot">
          <button type="button" class="btn btn-outline-secondary btn-sm has-label" onClick={resetAll}><i class="fas fa-rotate-left" /> Reset to defaults</button>
          <button type="button" class="btn btn-danger-primary btn-sm" onClick={close}>Done</button>
        </div>
      </div>
    </div>
  );
}

export function mountNavCustomizer(root: HTMLElement): void {
  render(h(NavCustomizer, null), root);
}
