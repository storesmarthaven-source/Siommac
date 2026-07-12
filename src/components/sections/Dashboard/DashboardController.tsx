/**
 * src/components/sections/Dashboard/DashboardController.tsx
 *
 * Headless controller component — renders no visible DOM of its own.
 * It wires:
 *   1. The layout editor (edit mode, hide/show widgets, drag-and-drop, reset)
 *      onto the existing HTML shell buttons (#dashEditBtn, #dashResetBtn, etc.)
 *   2. TanStack Query fetches for getDashboardCharts and getMyChart, delegating
 *      chart rendering back to the legacy SiomacCharts global.
 *
 * Why "headless"?  The dashboard widget grid lives in app-shell.html so that
 * SiomacCharts (charts.js) can paint <canvas> elements directly.  Preact owns
 * the state and wires event handlers; the DOM is the legacy HTML.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { useEffect }        from 'preact/hooks';
import { useQuery }         from '@tanstack/preact-query';
import { useSessionStore }  from '@store/session';
import { getDashboardCharts, getMyChart } from './api';
import { useDashLayout }    from './useDashLayout';

// ── Hidden-widgets restore bar ────────────────────────────────────────────────

interface HiddenBarProps {
  hidden:     { id: string; title: string }[];
  onRestore:  (id: string) => void;
}

function HiddenBar({ hidden, onRestore }: HiddenBarProps) {
  // The DOM lookup lives INSIDE the effect (not before it) so the hook is always
  // called unconditionally — looking it up first and early-returning before the
  // useEffect call violates the Rules of Hooks (the hook would be skipped on any
  // render where the legacy DOM node isn't found yet, e.g. before the HTML shell
  // has mounted, risking a "rendered fewer hooks than expected" crash if that
  // ever flips between renders).
  useEffect(() => {
    const container = document.getElementById('dashHiddenWidgets');
    if (!container) return;
    if (!hidden.length) {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }
    container.style.display = 'flex';
    container.innerHTML = hidden.map(w =>
      `<button class="dash-restore-btn" data-widget-id="${w.id}">` +
      `<i class="fas fa-plus-circle"></i> ${w.title}</button>`,
    ).join('');
    const clickHandler = (e: Event) => {
      const btn = (e.target as Element).closest<HTMLElement>('.dash-restore-btn');
      if (btn?.dataset.widgetId) onRestore(btn.dataset.widgetId);
    };
    container.addEventListener('click', clickHandler);
    return () => container.removeEventListener('click', clickHandler);
  }, [hidden, onRestore]);

  return null; // renders nothing into the Preact tree
}

// ── Edit-mode hide button wiring ──────────────────────────────────────────────

function useHideBtnWiring(editMode: boolean, onHide: (id: string) => void) {
  useEffect(() => {
    if (!editMode) return;
    const section = document.getElementById('s-adm-dashboard');
    if (!section) return;
    const handler = (e: Event) => {
      const btn = (e.target as Element).closest<HTMLElement>('.dash-hide-btn');
      if (btn?.dataset.widgetId) onHide(btn.dataset.widgetId);
    };
    section.addEventListener('click', handler);
    return () => section.removeEventListener('click', handler);
  }, [editMode, onHide]);
}

// ── Today date display ────────────────────────────────────────────────────────

function useTodayDisplay() {
  useEffect(() => {
    const now  = new Date();
    const day  = now.toLocaleDateString('en-US', { weekday: 'long' });
    const date = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const dayEl  = document.getElementById('dashTodayDay');
    const dateEl = document.getElementById('dashTodayDate');
    if (dayEl)  dayEl.textContent  = day;
    if (dateEl) dateEl.textContent = date;
  }, []);
}

// ── Main controller ───────────────────────────────────────────────────────────

export function DashboardController() {
  const username = useSessionStore(s => s.username);

  const { editMode, hidden, widgetDefs, toggleEditMode, reset, hideWidget, showWidget } = useDashLayout();

  useTodayDisplay();
  useHideBtnWiring(editMode, (id) => hideWidget(id as Parameters<typeof hideWidget>[0]));

  // Wire Edit / Reset buttons in the legacy HTML footer
  useEffect(() => {
    const editBtn  = document.getElementById('dashEditBtn');
    const resetBtn = document.getElementById('dashResetBtn');
    if (editBtn) {
      editBtn.onclick = toggleEditMode;
    }
    if (resetBtn) {
      resetBtn.onclick = reset;
    }
  }, [toggleEditMode, reset]);

  // Keep Edit button text in sync
  useEffect(() => {
    const editBtn  = document.getElementById('dashEditBtn');
    const resetBtn = document.getElementById('dashResetBtn');
    if (editBtn) {
      editBtn.classList.toggle('active', editMode);
      editBtn.innerHTML = editMode
        ? '<i class="fas fa-check"></i> Done'
        : '<i class="fas fa-edit"></i> Edit Layout';
    }
    if (resetBtn) {
      resetBtn.style.display = editMode ? '' : 'none';
    }
  }, [editMode]);

  // Hidden widgets bar (portal into #dashHiddenWidgets)
  const hiddenWithTitles: { id: string; title: string }[] = hidden.flatMap(id => {
    const def = widgetDefs.find(w => w.id === id);
    return def ? [{ id: id, title: def.title }] : [];
  });

  const isAuthenticated = useSessionStore(s => s.isAuthenticated);

  // ── Queries — chart data ───────────────────────────────────────────────────

  useQuery({
    queryKey:  ['dashboard', 'charts'],
    queryFn:   ({ signal }) => getDashboardCharts(signal),
    staleTime: 60_000,
    enabled:   isAuthenticated,
    select:    (data) => {
      // Delegate to SiomacCharts — it owns the canvas rendering
      const SC = (window as unknown as Record<string, unknown>).SiomacCharts as
        Record<string, Function> | undefined;
      if (SC) {
        if (typeof SC.renderDashboardCharts === 'function') SC.renderDashboardCharts(data);
        else if (typeof SC.updateDashboardCharts === 'function') SC.updateDashboardCharts(data);
      }
      return data;
    },
  });

  useQuery({
    queryKey:  ['dashboard', 'myChart', username],
    queryFn:   ({ signal }) => getMyChart(username ?? '', signal),
    staleTime: 60_000,
    enabled:   isAuthenticated && !!username,
    select:    (data) => {
      const SC = (window as unknown as Record<string, unknown>).SiomacCharts as
        Record<string, Function> | undefined;
      if (SC && typeof SC.displayAttendanceChart === 'function') SC.displayAttendanceChart(data);
      // Update stat display elements
      const set = (id: string, val: number | undefined) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(val ?? 0);
      };
      set('empPresentDays', data.present);
      set('empLateDays',    data.late ?? 0);
      set('empAbsentDays',  data.absent);
      set('empSundayDays',  data.sundays);
      set('empTotalDays',   (data.present ?? 0) + (data.absent ?? 0));
      return data;
    },
  });

  // Render nothing — all UI is in the HTML shell
  return (
    <HiddenBar hidden={hiddenWithTitles} onRestore={(id) => showWidget(id as Parameters<typeof showWidget>[0])} />
  );
}
