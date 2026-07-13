/**
 * src/components/sections/LiveMap/LiveMapController.tsx
 *
 * Headless controller for the Live Map section (s-projectMap).
 *
 * live-map.js stays in the SCRIPTS chain because:
 *   - It owns the Leaflet map instance (AppState.get('map'))
 *   - sites.js reads _siteLayerMap and _selectLiveSite from the module closure
 *   - Leaflet is imperatively stateful; there's no clean Preact equivalent
 *
 * This controller:
 *   1. Wraps `getLiveAttendance` in a TanStack Query (30-second refetch)
 *   2. Delegates map mutations to window.LiveMap (plotLiveEmployees, renderLivePanel)
 *   3. Wires click delegation for the employee list → focusLiveEmployee
 *   4. Exposes a window.LiveMap polyfill shim entry-point that nav.js can call
 *
 * The Leaflet map initialisation (initializeMap) is still called by app.js on
 * section nav — this controller does not replace that flow.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { useEffect }      from 'preact/hooks';
import { useQuery }       from '@tanstack/preact-query';
import { useSessionStore } from '@store/session';
import { getLiveAttendance } from './api';

interface LiveMapGlobal {
  plotLiveEmployees:    (rows: unknown[]) => void;
  renderLivePanel:      (rows: unknown[]) => void;
  focusLiveEmployee:    (userId: string)  => void;
  loadLiveAttendance:   () => void;
  initializeMap:        () => void;
  updateUserLocationOnMap: () => void;
}

function getLiveMap(): LiveMapGlobal | null {
  return (window as unknown as Record<string, unknown>).LiveMap as LiveMapGlobal | null;
}

// ── Employee list click delegation ────────────────────────────────────────────

function useLiveListClick() {
  useEffect(() => {
    const section = document.getElementById('s-projectMap') ??
                    document.querySelector('.app-section[id="s-projectMap"]');
    if (!section) return;

    const handler = (e: Event) => {
      const item = (e.target as Element).closest<HTMLElement>('[data-id]');
      if (!item?.dataset.id) return;
      const lm = getLiveMap();
      if (lm?.focusLiveEmployee) lm.focusLiveEmployee(item.dataset.id);
    };

    section.addEventListener('click', handler);
    return () => section.removeEventListener('click', handler);
  }, []);
}

// ── Main controller ───────────────────────────────────────────────────────────

export function LiveMapController() {
  const role            = useSessionStore(s => s.role);
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  const scope           = role === 'admin' ? 'all' : 'all';  // manager scoping handled server-side

  useLiveListClick();

  // Poll live attendance every 30 seconds
  useQuery({
    queryKey:       ['liveAttendance', scope],
    queryFn:        ({ signal }) => getLiveAttendance(scope, signal),
    staleTime:      30_000,
    refetchInterval: 30_000,
    enabled:        isAuthenticated,
    select: (rows) => {
      const lm = getLiveMap();
      if (!lm) return rows;

      // Update AppState so sites.js can read liveData directly
      const appState = (window as unknown as Record<string, unknown>).AppState as
        Record<string, ((...args: unknown[]) => unknown)> | undefined;
      if (appState?.set) appState.set('liveData', rows);

      // Delegate map rendering to the Leaflet module
      if (lm.plotLiveEmployees) lm.plotLiveEmployees(rows);
      if (lm.renderLivePanel)   lm.renderLivePanel(rows);

      return rows;
    },
  });

  // Renders nothing — all UI lives in the HTML shell + Leaflet
  return null;
}
