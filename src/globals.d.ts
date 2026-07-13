/**
 * Ambient declarations for CDN-loaded globals.
 *
 * These libraries are NOT bundled by Vite — they are loaded via <script> tags
 * in index.html and accessed through their window globals.  Declaring them here
 * gives TypeScript full type-checking without bundling the libraries twice.
 *
 * If a library is eventually bundled (Phase 5+), remove its declaration here
 * and import the package normally instead.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

// ── Leaflet ──────────────────────────────────────────────────────────────────
import type * as LeafletNS from 'leaflet';
declare global {
  const L: typeof LeafletNS;
}

// ── Chart.js ─────────────────────────────────────────────────────────────────
import type * as ChartNS from 'chart.js';
declare global {
  const Chart: typeof ChartNS.Chart;
}

// ── jQuery ────────────────────────────────────────────────────────────────────
import type * as JQueryNS from 'jquery';
declare global {
  const $: JQueryNS.JQueryStatic;
  const jQuery: JQueryNS.JQueryStatic;
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
// bootstrap is loaded via CDN; re-export its namespace so `bootstrap.Modal` etc. work.
// The package ships no type declarations, so we use a minimal hand-rolled shape.
interface BootstrapModalConfig { backdrop: string | boolean; keyboard: boolean }
interface BootstrapModalInstance { _config: BootstrapModalConfig }
interface BootstrapModalStatic {
  getInstance(element: Element): BootstrapModalInstance | null | undefined;
}
interface BootstrapBundle { Modal?: BootstrapModalStatic }
declare global {
  const bootstrap: BootstrapBundle;
  interface Window { bootstrap?: BootstrapBundle }
}

// ── Supabase (UMD bundle) ─────────────────────────────────────────────────────
declare global {
  // The CDN UMD bundle exposes `supabase.createClient` on both `window.supabase`
  // and the bare global `supabase`.
  const supabase: { createClient: typeof import('@supabase/supabase-js').createClient };

  interface Window {
    supabase: { createClient: typeof import('@supabase/supabase-js').createClient };
  }
}

// ── SortableJS ────────────────────────────────────────────────────────────────
import type SortableNS from 'sortablejs';
declare global {
  const Sortable: typeof SortableNS;
}

// ── Flatpickr ─────────────────────────────────────────────────────────────────
import type flatpickrNS from 'flatpickr';
declare global {
  const flatpickr: typeof flatpickrNS;
}

// ── Legacy view shims set by NavController + the pre-Preact view modules ───────
// Each is a bag of imperative functions the legacy boot sequence installs on
// `window` (window.Nav.buildSidebar, window.Employees.loadEmployeeList, …).
// NavController writes them via an `as unknown as Win` cast; declaring them here
// gives the boot-invariant tests (src/lib/boot.test.ts) real types instead of
// `any`. Retire a shim's entry here when its module is fully ported to Preact.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- legacy shim functions have varied signatures; unknown[] is too strict for existing callers
type LegacyViewShim = Record<string, (...args: any[]) => unknown>;

declare global {
  // ── Window extension — app-specific globals set by legacy scripts ───────────
  interface Window {
    /** Preloaded profile image set by the inline preload script in index.html */
    _preloadedProfileImage?: HTMLImageElement;
    _preloadedProfileUrl?:   string;

    /**
     * jQuery — also available as the bare global `$`.
     * Declared on Window so DataTable.tsx can access it as `window.$`
     * without TypeScript complaining.
     */
    $:      JQueryNS.JQueryStatic;
    jQuery: JQueryNS.JQueryStatic;

    // Legacy navigation + per-section view shims (see LegacyViewShim above).
    Nav:            LegacyViewShim;
    AppState:       { get: (key: string) => unknown; set: (key: string, value: unknown) => void; _photoCache: Record<string, unknown> };
    Dashboard:      LegacyViewShim;
    SettingsView:   LegacyViewShim;
    Payroll:        LegacyViewShim;
    Sites:          LegacyViewShim;
    Employees:      LegacyViewShim;
    Profile:        LegacyViewShim;
    LeaveView:      LegacyViewShim;
    AttendanceView: LegacyViewShim;
  }
}

export {};
