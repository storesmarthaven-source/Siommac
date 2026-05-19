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
declare global {
  const bootstrap: typeof import('bootstrap');
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

// ── Window extension — app-specific globals set by legacy scripts ─────────────
declare global {
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
  }
}

export {};
