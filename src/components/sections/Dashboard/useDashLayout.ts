/**
 * src/components/sections/Dashboard/useDashLayout.ts
 *
 * Manages the drag-and-drop layout editor for the admin dashboard.
 * Mirrors the logic from dashboard.js _dashApplyLayout / _dashToggleEditMode.
 *
 * The dashboard widget grid lives in the HTML shell (app-shell.html) so chart
 * canvases owned by SiomacCharts are not disturbed.  This hook wires Sortable.js
 * and localStorage persistence onto those existing DOM nodes.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { useState, useEffect, useRef, useCallback } from 'preact/hooks';

const LAYOUT_KEY  = 'siomac_dash_layout_v1';
const WIDGET_DEFS = [
  { id: 'trend',    title: 'Weekly Attendance Trend' },
  { id: 'dept',     title: 'Department Distribution' },
  { id: 'status',   title: "Today's Status" },
  { id: 'leave',    title: 'Leave Types · This Month' },
  { id: 'activity', title: 'Recent Activity' },
] as const;

type WidgetId = typeof WIDGET_DEFS[number]['id'];

interface Layout { order: WidgetId[]; hidden: WidgetId[] }

function loadLayout(): Layout {
  try { return (JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null') as Layout | null) ?? { order: [], hidden: [] }; }
  catch { return { order: [], hidden: [] }; }
}

function saveLayout(order: WidgetId[], hidden: WidgetId[]) {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify({ order, hidden }));
}

function snapshotGrid(grid: Element): { order: WidgetId[]; hidden: WidgetId[] } {
  const order: WidgetId[] = [];
  const hidden: WidgetId[] = [];
  grid.querySelectorAll<HTMLElement>('.dash-widget').forEach(w => {
    const id = w.dataset.widgetId as WidgetId | undefined;
    if (!id) return;
    order.push(id);
    if (w.classList.contains('dash-widget-hidden')) hidden.push(id);
  });
  return { order, hidden };
}

export function useDashLayout() {
  const [editMode, setEditMode]   = useState(false);
  const [hidden,   setHidden]     = useState<WidgetId[]>([]);
  const sortableRef               = useRef<{ destroy: () => void } | null>(null);
  const saveTimerRef              = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Apply saved layout to DOM on mount
  useEffect(() => {
    const { order, hidden: h } = loadLayout();
    const grid = document.getElementById('dashWidgetGrid');
    if (!grid) return;

    if (order.length) {
      const map: Record<string, HTMLElement> = {};
      grid.querySelectorAll<HTMLElement>('.dash-widget').forEach(w => {
        const id = w.dataset.widgetId;
        if (id) map[id] = w;
      });
      order.forEach(id => { if (map[id]) grid.appendChild(map[id]); });
    }

    WIDGET_DEFS.forEach(({ id }) => {
      const el = document.querySelector<HTMLElement>(`#s-adm-dashboard .dash-widget[data-widget-id="${id}"]`);
      if (!el) return;
      el.classList.toggle('dash-widget-hidden', h.includes(id));
    });

    setHidden(h);
  }, []);

  const scheduleSave = useCallback((immediate?: boolean) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const doSave = () => {
      const grid = document.getElementById('dashWidgetGrid');
      if (!grid) return;
      const { order, hidden: h } = snapshotGrid(grid);
      saveLayout(order, h);
      setHidden(h);
    };
    if (immediate) doSave();
    else saveTimerRef.current = setTimeout(doSave, 80);
  }, []);

  const hideWidget = useCallback((id: WidgetId) => {
    const el = document.querySelector<HTMLElement>(`.dash-widget[data-widget-id="${id}"]`);
    if (el) el.classList.add('dash-widget-hidden');
    scheduleSave(true);
  }, [scheduleSave]);

  const showWidget = useCallback((id: WidgetId) => {
    const el = document.querySelector<HTMLElement>(`.dash-widget[data-widget-id="${id}"]`);
    if (el) el.classList.remove('dash-widget-hidden');
    scheduleSave(true);
  }, [scheduleSave]);

  const toggleEditMode = useCallback(() => {
    const section = document.getElementById('s-adm-dashboard');
    const grid    = document.getElementById('dashWidgetGrid');
    if (!section || !grid) return;

    setEditMode(prev => {
      const next = !prev;
      section.classList.toggle('dash-edit-mode', next);

      if (next) {
        // Wire Sortable — CDN global typed in globals.d.ts as typeof SortableNS.
        // Using new Sortable(...) instead of the old Function-typed window lookup.
        sortableRef.current = new Sortable(grid, {
          animation:       250,
          ghostClass:      'dash-sortable-ghost',
          dragClass:       'dash-sortable-drag',
          filter:          'button, a, input, select, canvas',
          preventOnFilter: false,
          onEnd:           () => requestAnimationFrame(() => scheduleSave()),
        });
      } else {
        if (sortableRef.current) { sortableRef.current.destroy(); sortableRef.current = null; }
        scheduleSave(true);
      }
      return next;
    });
  }, [scheduleSave]);

  const reset = useCallback(() => {
    localStorage.removeItem(LAYOUT_KEY);
    const grid = document.getElementById('dashWidgetGrid');
    if (grid) {
      (['trend', 'dept', 'status', 'leave', 'activity'] as WidgetId[]).forEach(id => {
        const el = grid.querySelector<HTMLElement>(`.dash-widget[data-widget-id="${id}"]`);
        if (el) grid.appendChild(el);
      });
    }
    document.querySelectorAll<HTMLElement>('.dash-widget').forEach(el => {
      el.classList.remove('dash-widget-hidden');
    });
    setHidden([]);
    setEditMode(prev => {
      if (prev) {
        // Exit edit mode
        document.getElementById('s-adm-dashboard')?.classList.remove('dash-edit-mode');
        if (sortableRef.current) { sortableRef.current.destroy(); sortableRef.current = null; }
      }
      return false;
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => () => {
    if (sortableRef.current) sortableRef.current.destroy();
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  return {
    editMode,
    hidden,
    widgetDefs: WIDGET_DEFS,
    toggleEditMode,
    reset,
    hideWidget,
    showWidget,
  };
}
