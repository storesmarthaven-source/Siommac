/**
 * src/ui/tokens — UI Kit v2 foundation.
 *
 * Importing this module is what puts `tokens.css` into the bundle, so anything
 * that consumes a `--ui-*` token should reach the kit through `@ui`, which
 * imports this once. Components never import `tokens.css` themselves.
 *
 * The editable token MANIFEST (what the Gallery's Token Inspector renders) lives
 * in `src/ui/theme/tokens.ts` — one manifest for the whole system, covering both
 * the original brand/surface/status tokens and the v2 foundation groups added
 * here. This file owns only the values TypeScript needs to know about.
 */

import './tokens.css';
/* The semantic colour layer sits BETWEEN the foundation palette and the
   component recipes. Load order is irrelevant to the cascade (custom properties
   resolve at use time, not at parse time) — it is imported here so that any
   bundle carrying a recipe also carries the roles that recipe reads. */
import './semantic.css';

/**
 * Breakpoints live in TS, not CSS, because `@media` cannot read a custom
 * property — a `--ui-bp-md` token would be silently inert in every media query
 * that referenced it. The Gallery's responsive preview and any container-query
 * authoring read these; `@media` blocks keep literal values.
 */
export const BREAKPOINTS = {
  xs: 375,
  sm: 480,
  md: 768,
  lg: 1024,
  xl: 1280,
  xxl: 1440,
} as const;

export type BreakpointKey = keyof typeof BREAKPOINTS;

/** The responsive-preview presets offered in the Gallery. */
export const PREVIEW_WIDTHS: readonly { key: string; label: string; width: number }[] = [
  { key: 'desktop-xl', label: 'Desktop', width: 1440 },
  { key: 'desktop',    label: 'Laptop',  width: 1280 },
  { key: 'small-lap',  label: 'Small',   width: 1024 },
  { key: 'tablet',     label: 'Tablet',  width: 768 },
  { key: 'mobile-lg',  label: 'Mobile',  width: 480 },
  { key: 'mobile',     label: 'Small phone', width: 375 },
];

/** The three canonical control heights. Every sized control uses this union. */
export type ControlSize = 'sm' | 'md' | 'lg';
export const CONTROL_SIZES: readonly ControlSize[] = ['sm', 'md', 'lg'];

/** Density is opt-in via `data-ui-density` on any ancestor. */
export type Density = 'compact' | 'standard' | 'comfortable';
export const DENSITIES: readonly Density[] = ['compact', 'standard', 'comfortable'];

/**
 * The app-wide validation language. `none` is explicit rather than `undefined`
 * so a component can never be in an ambiguous half-validated state.
 */
export type ValidationState = 'none' | 'error' | 'warning' | 'success';
export const VALIDATION_STATES: readonly ValidationState[] = ['none', 'error', 'warning', 'success'];

/**
 * Every interaction state the kit can render — and, critically, that the Gallery
 * can FORCE for preview. `hover`, `focus` and `active` cannot be triggered
 * synthetically through real pseudo-classes, so recipe CSS pairs each
 * pseudo-class with a `[data-ui-state~='…']` attribute selector and components
 * accept a `forceState` prop. See src/ui/RECIPES.md.
 */
export type UiState =
  | 'default' | 'hover' | 'focus' | 'active' | 'selected' | 'open'
  | 'disabled' | 'readonly' | 'loading' | 'error' | 'warning' | 'success';
