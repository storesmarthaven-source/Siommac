/**
 * src/ui/registry/types.ts — the AUTHORITATIVE component contract.
 *
 * This registry is the single source of truth for what the design system
 * contains. Everything downstream reads it and nothing duplicates it:
 *
 *     Component implementation
 *            ↓
 *     Component Registry            ← this file
 *            ↓
 *     Gallery nav · overview · Canvas/Compare · Inspector
 *            ↓
 *     Coverage report + migration status
 *
 * Two consequences that are the whole point:
 *
 *  1. The Gallery is NOT a hand-written list of cards. Adding a component to the
 *     workbench means adding a definition; there is no second place to update
 *     and therefore no way for the catalogue to drift from the code.
 *
 *  2. GAPS ARE DATA. A component that does not exist yet is registered with
 *     `status: 'missing'` and its planned API. That is what turns "what is still
 *     missing?" from a manual audit every few weeks into a number the build
 *     prints. See scripts/check-ui-kit-coverage.mjs.
 *
 * Deliberately still metadata, not a visual programming framework.
 */

import { type VNode } from 'preact';
import { type UiState } from '../tokens';

/* ── Prop controls ─────────────────────────────────────────────────────────── */

/**
 * How the Props tab renders one editable prop.
 *
 * `default` is the value the Gallery starts from. It should match the
 * component's own default so the initial preview and the initial code example
 * agree with what a developer gets by writing the component with no props.
 */
export type PropControl =
  | { type: 'select';    label: string; options: readonly string[]; default: string; help?: string }
  | { type: 'segmented'; label: string; options: readonly string[]; default: string; help?: string }
  | { type: 'boolean';   label: string; default: boolean; help?: string }
  | { type: 'text';      label: string; default: string; placeholder?: string; help?: string }
  | { type: 'number';    label: string; default: number; min?: number; max?: number; step?: number; help?: string }
  | { type: 'icon';      label: string; default: string; help?: string };

export type PropValues = Record<string, string | number | boolean>;

/* ── Style controls ────────────────────────────────────────────────────────── */

/**
 * One recipe variable exposed in the Style tab.
 *
 * `name` MUST be a `--ui-<component>-…` recipe variable, not a global token.
 * Global tokens belong in the Foundations editor; mixing them here would let
 * someone think they were nudging one Button while re-theming the app.
 */
export interface StyleControl {
  name: string;
  label: string;
  kind: 'color' | 'color-alpha' | 'size' | 'text' | 'select';
  options?: readonly { value: string; label: string }[];
  help?: string;
  /** Theme/semantic value used when Studio mode is Linked. */
  linkedTo?: string;
  /** Governed scope used to generate the Studio scope navigator. */
  scope?: 'shared' | 'variant' | 'state';
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'link';
  state?: 'default' | 'hover' | 'active' | 'focus' | 'disabled' | 'loading';
}

export interface StyleGroup {
  label: string;
  controls: StyleControl[];
}

/* ── Accessibility metadata ────────────────────────────────────────────────── */

export interface KeyBinding {
  keys: string;
  does: string;
}

export interface A11yInfo {
  /** The ARIA role the rendered element actually carries, or `null` if native. */
  role: string | null;
  /** How the component gets its accessible name. */
  name: string;
  keyboard: KeyBinding[];
  /** What the component does with focus — trapping, returning, moving. */
  focus: string;
  /** Anything a consumer MUST do to keep the component accessible. */
  notes?: string[];
}

/* ── Examples ──────────────────────────────────────────────────────────────── */

/**
 * A named, rendered usage. Distinct from a preset: a preset seeds the inspector,
 * an example is a fixed illustration of a real use ("destructive confirm",
 * "toolbar action row") that the Gallery shows without the user configuring it.
 */
export interface ComponentExample {
  id: string;
  title: string;
  /** Why this example exists — the situation it is the right answer to. */
  description?: string;
  render: () => VNode;
  code?: string;
}

/* ── Migration ─────────────────────────────────────────────────────────────── */

/**
 * What this component supersedes.
 *
 * The coverage script counts these across the codebase, which is what makes
 * adoption an objective number instead of an impression. `replaces` are CSS
 * class families and raw-markup patterns; `deprecatedImports` are module paths
 * or symbols that should stop being imported.
 */
export interface MigrationInfo {
  /** Legacy CSS class families this component replaces, e.g. '.inc-action-btn'. */
  replaces?: readonly string[];
  /** Import paths/symbols that are superseded, e.g. '@shared/Modal'. */
  deprecatedImports?: readonly string[];
  /**
   * Raw HTML this component is the canonical answer to. Counted as "unmanaged"
   * so a page full of bare `<button>`s is visible in the report.
   */
  rawPatterns?: readonly string[];
  /** The module queued next for migration — the Gallery shows it as guidance. */
  nextSurface?: string;
  /** Free-text caveats for whoever picks up the migration. */
  notes?: readonly string[];
}

/* ── Existing-implementation comparison ────────────────────────────────────── */

/* ── Component definition ──────────────────────────────────────────────────── */

export type ComponentCategory =
  | 'foundations' | 'actions' | 'forms' | 'selection' | 'people'
  | 'overlays' | 'data' | 'navigation' | 'feedback' | 'containers'
  | 'status' | 'patterns';

/**
 * `missing` is a first-class status, not an absence.
 *
 * Registering a component that does not exist yet — with its planned API and
 * what it will replace — is what lets the coverage report say "18 missing
 * shared patterns" instead of nobody knowing until someone re-audits.
 */
export type ComponentStatus = 'stable' | 'beta' | 'deprecated' | 'missing';

export interface ComponentDef {
  /** Stable id — also the recipe variable prefix (`button` → `--ui-button-*`). */
  id: string;
  name: string;
  category: ComponentCategory;
  /** One sentence: what it is FOR. Shown under the canvas title. */
  description: string;

  status: ComponentStatus;
  /** Source file, relative to the repo. Verified to exist by the coverage script. */
  componentPath?: string;
  /** Import path shown in the Code tab. Always the barrel. */
  importFrom?: string;

  /** Planned API for a `missing` component — rendered instead of a preview. */
  plannedApi?: string;

  props?: Record<string, PropControl>;
  style?: StyleGroup[];

  /**
   * Which states this component can meaningfully be previewed in. Drives both
   * the States tab and the Compare view — so listing a state here is a promise
   * that `render` honours it.
   */
  states?: readonly UiState[];
  /** The states Compare mode shows by default. */
  compare?: readonly UiState[];

  a11y?: A11yInfo;
  examples?: readonly ComponentExample[];
  migration?: MigrationInfo;

  /**
   * Render the component for the given prop values and forced state.
   *
   * `state` is a FORCED visual state for preview (see src/ui/RECIPES.md). Real
   * states that a component owns as props — `disabled`, `loading`, `readonly`,
   * validation — must be applied through those props here, not faked with CSS,
   * so the preview and the real component cannot drift.
   *
   * Absent for `missing` components.
   */
  render?: (props: PropValues, state: UiState) => VNode;

  /** The usage snippet for the Code tab. Must reflect `props` exactly. */
  code?: (props: PropValues, state: UiState) => string;

  /** Named starting points offered above the Props tab. */
  presets?: readonly { label: string; props: PropValues }[];

  /**
   * Render EVERY value of `variant` side by side in the preview, driven together
   * by the other props, instead of one specimen at a time.
   *
   * Opt-in per component because it only reads well for compact specimens. Six
   * live Buttons in a row is the clearest possible answer to "what does this
   * component do"; six live DataTables is unreadable, and six Dialogs is absurd.
   * So Button, SegmentedControl and Badge set it, while Card, Tabs and Dialog —
   * which also have a `variant` prop — deliberately do not.
   *
   * Where it is on, the Studio drops the separate Variants reference block: the
   * axis IS that block, and showing both would state the same thing twice.
   */
  previewAxis?: 'variant';
}

/** Resolve a definition's declared defaults into a starting prop set. */
export function defaultProps(def: ComponentDef): PropValues {
  const out: PropValues = {};
  for (const [key, control] of Object.entries(def.props ?? {})) out[key] = control.default;
  return out;
}

/** Every recipe variable a definition exposes, flattened. */
export function styleVarNames(def: ComponentDef): string[] {
  return (def.style ?? []).flatMap(g => g.controls.map(c => c.name));
}

/** Built (i.e. previewable) components — anything not `missing`. */
export function isBuilt(def: ComponentDef): boolean {
  return def.status !== 'missing';
}
