/**
 * src/ui/theme/semanticTokens.ts — the manifest for the semantic colour layer.
 *
 * ONE declaration of every semantic role, consumed by three things that would
 * otherwise each keep their own list and drift apart:
 *
 *   • src/ui/tokens/semantic.css  — the CSS defaults (kept in lockstep by
 *     semanticTokens.test.ts, which fails if either side adds or drops a role)
 *   • src/ui/theme/tokens.ts      — the Foundations editor groups, so every
 *     semantic role is draft-editable through the existing preview/Apply path
 *   • the Brand Theme engine      — which roles a generated brand may set, and
 *     which it must never touch
 *
 * ── `brandDriven` is the important field ────────────────────────────────────
 * `true`  → the Brand Theme engine may derive this role from the customer's
 *           logo (actions, navigation, links, focus, selection, brand-tinted
 *           surfaces).
 * `false` → the engine must leave it alone. Operational state colours mean
 *           something universal; turning `danger` into a shade of a green logo
 *           produces a UI where "delete" and "saved" look identical. Text and
 *           neutral surfaces are also excluded — a brand hue in body copy costs
 *           legibility for no identity gain.
 *
 * @see src/ui/tokens/semantic.css for the values and the layering rationale.
 */

/** The colour-role groups, in the order the editor renders them. */
export type SemanticGroupId =
  | 'action' | 'surface' | 'text' | 'border' | 'focus'
  | 'navigation' | 'selection' | 'state';

export interface SemanticRole {
  /** CSS custom property, e.g. '--ui-color-action-primary'. */
  name: string;
  group: SemanticGroupId;
  /** What this role means — shown in the editor, not a restatement of the name. */
  label: string;
  /** The token the CSS default resolves to, for provenance in the UI. */
  defaultsFrom: string;
  /** May the Brand Theme engine derive this from the customer's logo? */
  brandDriven: boolean;
  /** Colour values carrying alpha need the editor's opacity slider. */
  alpha?: boolean;
}

export interface SemanticGroup {
  id: SemanticGroupId;
  label: string;
  desc: string;
}

export const SEMANTIC_GROUPS: readonly SemanticGroup[] = [
  { id: 'action',     label: 'Action',     desc: 'The two ranks of call-to-action. Destructive actions are a STATE colour, not a red primary.' },
  { id: 'surface',    label: 'Surface',    desc: 'The planes content sits on, from the page backdrop up to floating overlays.' },
  { id: 'text',       label: 'Text',       desc: 'Emphasis ramp for foreground text, plus inverse (on a filled surface) and link.' },
  { id: 'border',     label: 'Border',     desc: 'Dividers and card edges versus the heavier edge of an interactive control.' },
  { id: 'focus',      label: 'Focus',      desc: 'The one focus colour for the whole kit. Geometry lives in the foundation tokens.' },
  { id: 'navigation', label: 'Navigation', desc: 'The app rail is its own colour context — dark chrome around light content.' },
  { id: 'selection',  label: 'Selection',  desc: '“This is chosen”, which is a different statement from “your pointer is here”.' },
  { id: 'state',      label: 'Operational states', desc: 'Success, warning, danger and info carry MEANING. The brand engine may never derive these from a logo.' },
];

export const SEMANTIC_ROLES: readonly SemanticRole[] = [
  /* ── Action ───────────────────────────────────────────────────────────────*/
  { name: '--ui-color-action-primary',        group: 'action', label: 'Primary action fill',            defaultsFrom: '--siomac-red',       brandDriven: true  },
  { name: '--ui-color-action-primary-hover',  group: 'action', label: 'Primary action — hover/pressed', defaultsFrom: '--siomac-red-dark',  brandDriven: true  },
  { name: '--ui-color-action-primary-text',   group: 'action', label: 'Text/icon on a primary fill',    defaultsFrom: '#ffffff',            brandDriven: true  },
  { name: '--ui-color-action-secondary',      group: 'action', label: 'Secondary action fill',          defaultsFrom: '--siomac-navy',      brandDriven: true  },
  { name: '--ui-color-action-secondary-text', group: 'action', label: 'Text/icon on a secondary fill',  defaultsFrom: '#ffffff',            brandDriven: true  },

  /* ── Surface ──────────────────────────────────────────────────────────────*/
  { name: '--ui-color-surface-page',    group: 'surface', label: 'Page backdrop',                  defaultsFrom: '--bg-app',    brandDriven: false },
  { name: '--ui-color-surface-default', group: 'surface', label: 'Card / panel fill',              defaultsFrom: '--bg-card',   brandDriven: false },
  { name: '--ui-color-surface-subtle',  group: 'surface', label: 'Subtle fill (headers, wells)',   defaultsFrom: '--bg-subtle', brandDriven: false },
  { name: '--ui-color-surface-raised',  group: 'surface', label: 'Floating surface (menu, dialog)', defaultsFrom: '--bg-card',  brandDriven: false },

  /* ── Text ─────────────────────────────────────────────────────────────────*/
  { name: '--ui-color-text-primary',   group: 'text', label: 'Body and headings',            defaultsFrom: '--text-primary',     brandDriven: false },
  { name: '--ui-color-text-secondary', group: 'text', label: 'Labels, captions, meta',       defaultsFrom: '--text-muted',       brandDriven: false },
  { name: '--ui-color-text-muted',     group: 'text', label: 'Placeholders and faint hints', defaultsFrom: '--field-placeholder', brandDriven: false },
  { name: '--ui-color-text-inverse',   group: 'text', label: 'Text on a dark/filled surface', defaultsFrom: '#ffffff',           brandDriven: false },
  { name: '--ui-color-text-link',      group: 'text', label: 'Inline links',                 defaultsFrom: '--siomac-navy',      brandDriven: true  },

  /* ── Border ───────────────────────────────────────────────────────────────*/
  { name: '--ui-color-border-default', group: 'border', label: 'Dividers and card edges',    defaultsFrom: '--border',       brandDriven: false },
  { name: '--ui-color-border-strong',  group: 'border', label: 'Interactive control edge',   defaultsFrom: '--field-border', brandDriven: false },

  /* ── Focus ────────────────────────────────────────────────────────────────*/
  { name: '--ui-color-focus-ring',    group: 'focus', label: 'Focus ring (soft halo)', defaultsFrom: '--focus-ring',  brandDriven: true, alpha: true },
  { name: '--ui-color-focus-outline', group: 'focus', label: 'Focus outline (opaque)',  defaultsFrom: '--siomac-navy', brandDriven: true },

  /* ── Navigation ───────────────────────────────────────────────────────────*/
  { name: '--ui-color-nav-background',        group: 'navigation', label: 'Rail background',      defaultsFrom: '--siomac-navy',        brandDriven: true },
  /* Not `#6b7a94` — the legacy rail colour fails AA at 3.12:1. See semantic.css. */
  { name: '--ui-color-nav-text',              group: 'navigation', label: 'Rail item text',       defaultsFrom: '#8d9cb7',              brandDriven: true },
  { name: '--ui-color-nav-active-background', group: 'navigation', label: 'Active item fill',     defaultsFrom: 'rgba(99,112,141,.3)',  brandDriven: true, alpha: true },
  { name: '--ui-color-nav-active-text',       group: 'navigation', label: 'Active item text',     defaultsFrom: '#ffffff',              brandDriven: true },
  { name: '--ui-color-nav-active-indicator',  group: 'navigation', label: 'Active item indicator bar', defaultsFrom: '#7382a1',          brandDriven: true },

  /* ── Selection ────────────────────────────────────────────────────────────*/
  { name: '--ui-color-selection-background', group: 'selection', label: 'Selected row/option fill', defaultsFrom: 'rgba(27,45,84,.06)', brandDriven: true, alpha: true },
  { name: '--ui-color-selection-border',     group: 'selection', label: 'Selected edge/indicator',  defaultsFrom: '--siomac-navy',      brandDriven: true },

  /* ── Operational states ───────────────────────────────────────────────────*/
  { name: '--ui-color-success', group: 'state', label: 'Success / positive', defaultsFrom: '--st-success-strong', brandDriven: false },
  { name: '--ui-color-warning', group: 'state', label: 'Warning / caution',  defaultsFrom: '--st-warning-strong', brandDriven: false },
  { name: '--ui-color-danger',  group: 'state', label: 'Danger / critical',  defaultsFrom: '--st-danger-strong',  brandDriven: false },
  { name: '--ui-color-info',    group: 'state', label: 'Info / neutral',     defaultsFrom: '--st-info-strong',    brandDriven: false },
];

/** Every semantic custom-property name. */
export const SEMANTIC_TOKEN_NAMES: readonly string[] = SEMANTIC_ROLES.map(r => r.name);

/** The roles the Brand Theme engine is allowed to write. */
export const BRAND_DRIVEN_ROLES: readonly SemanticRole[] = SEMANTIC_ROLES.filter(r => r.brandDriven);

/**
 * The roles the engine must NEVER write. Exported (rather than derived at each
 * call site) so the guard in brandTheme.ts and the test that proves it hold the
 * same list.
 */
export const BRAND_LOCKED_ROLES: readonly SemanticRole[] = SEMANTIC_ROLES.filter(r => !r.brandDriven);

export function semanticRolesIn(group: SemanticGroupId): SemanticRole[] {
  return SEMANTIC_ROLES.filter(r => r.group === group);
}
