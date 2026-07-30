/**
 * src/ui/widgets/types.ts — the SIOMAC Widget Platform contract (v3).
 *
 * Adapted from the spec to our stack: Preact (`render`/`renderPreview` return VNode),
 * single-tenant (no org_id), and the REUSE-HOOKS data model — a widget's render
 * component fetches its own data via the module's existing TanStack hooks, so there
 * is NO generic data resolver and WidgetRenderProps carries no `data`. `dataSource`
 * stays as descriptive metadata (label/refresh/permissions/deps) for the detail panel
 * + permission gating. `renderPreview` is a lightweight, representative catalog thumbnail.
 *
 * Four core concepts:
 *   WidgetDef            — the reusable definition in the registry (code-based)
 *   WidgetInstance       — a saved widget placed on a board (persisted)
 *   PreviewWidgetInstance — a temporary widget on the board, NOT saved
 *   BoardLayout          — the persisted layout (zones of WidgetInstance) in ui_layout jsonb
 */

import type { VNode } from 'preact';
import type { WidgetSkeletonVariant } from '../components/Skeleton';

export type { WidgetSkeletonVariant };

export const WIDGET_CONTRACT_VERSION = 3 as const;
export const WIDGET_DESKTOP_COLUMNS = 12 as const;
export type WidgetContractVersion = typeof WIDGET_CONTRACT_VERSION;
export type WidgetRuntimeState =
  | 'live-api' | 'static-preview' | 'restricted' | 'action-gated'
  | 'disabled' | 'missing';
export type WidgetGovernanceState = 'enabled' | 'disabled' | 'preview';
export type WidgetMotionKind = 'none' | 'count-up' | 'progress' | 'chart-draw' | 'pulse' | 'sequence';
export type WidgetBreakpoint = 'desktop' | 'tablet' | 'mobile';

export interface WidgetPlacement { x: number; y: number; w: number; h: number }
export type WidgetResponsivePlacements = Partial<Record<WidgetBreakpoint, WidgetPlacement>>;

export interface WidgetGovernancePolicy {
  widgetId: string;
  state: WidgetGovernanceState;
  discoverable: boolean;
  mandatory?: boolean;
  hidden?: boolean;
  allowedPages?: string[];
  requiredCapabilities?: string[];
  packageId?: string;
}

export interface WidgetMotionSpec {
  kind: WidgetMotionKind;
  durationMs?: number;
  /** Motion always resolves to a static end-state when reduced motion is requested. */
  reducedMotion: 'static';
}

export interface WidgetDataSourceRegistration {
  key: string;
  label: string;
  endpoint: string;
  permission: string;
  scope: 'user' | 'organization' | 'record';
  refresh: { mode: 'manual' | 'interval' | 'realtime-invalidation'; intervalMs?: number };
  authenticated: true;
}

export type ModuleKey = 'hr' | 'hse' | 'finance' | 'operations' | 'enterprise';

export type WidgetSizeKey = 'compact' | 'standard' | 'wide' | 'large' | 'tall' | 'hero';

/** Board chrome around a widget. `standard` = framed header + bordered body;
 *  `none` = bare (the widget renders its own card, e.g. StatsCard/ChartCard, or a
 *  full interactive surface like the employee register) — edit/preview tools float. */
export type WidgetChrome = 'standard' | 'none';

export type WidgetPreviewVariant =
  | 'metric' | 'trend' | 'donut' | 'task-board' | 'timeline' | 'people'
  | 'table' | 'checklist' | 'risk' | 'flow-map' | 'matrix' | 'status-stack';

/** Lifecycle states a widget can be in on the board (beyond its own render). */
export type WidgetLifecycleState = 'loading' | 'ready' | 'empty' | 'error' | 'locked' | 'unavailable';

/** A named content slot inside a widget's body, gated by minimum size. */
export interface WidgetContentPriorityRule {
  slot: string;
  minSize: WidgetSizeKey;
  collapseTo?: string;
}

/** Optional per-size behavior hints for chart/label/action density. Consumed by
 *  `createResponsiveContext` (responsive.ts) — a widget MAY read `responsive` off
 *  its render props to adapt; omitting this is fine (the widget just doesn't adapt). */
export interface WidgetDensityRules {
  chart?: { simplifyBelow?: WidgetSizeKey; hideBelow?: WidgetSizeKey };
  labels?: { truncateBelow?: WidgetSizeKey; hideBelow?: WidgetSizeKey };
  actions?: { menuBelow?: WidgetSizeKey; hideBelow?: WidgetSizeKey };
  numbers?: { abbreviateBelow?: WidgetSizeKey };
}

export interface WidgetResponsiveContext {
  sizeKey: WidgetSizeKey;
  visibleSlots: Set<string>;
  chartMode: 'none' | 'sparkline' | 'compact' | 'full';
  labelMode: 'hidden' | 'truncated' | 'full';
  actionMode: 'hidden' | 'menu' | 'inline';
  numberMode: 'abbreviated' | 'full';
}

/** Explicit view/action permission spec. Falls back to `dataSource.permissions`
 *  when omitted — most widgets don't need this, it exists for widgets whose
 *  actions require MORE than plain view access. */
export interface WidgetPermissionSpec {
  requiredPermissions?: string[];
  actions?: Record<string, string>;
}

export interface WidgetGridSize { w: number; h: number }

export interface WidgetSizeConstraints {
  defaultColumns: number;
  defaultRows: number;
  minColumns: number;
  minRows: number;
  minWidth?: number;
  minHeight?: number;
  resizeStrategy: 'fixed-minimum' | 'content-measured';
}

export interface WidgetSizeDef {
  key: WidgetSizeKey;
  label: string;
  grid: WidgetGridSize;
  min?: WidgetGridSize;
  max?: WidgetGridSize;
  description?: string;
}

export interface WidgetConfigOption { label: string; value: string; description?: string }

export type WidgetConfigFieldType =
  | 'text' | 'color' | 'select' | 'multiSelect' | 'dateRange' | 'number' | 'boolean' | 'threshold' | 'statusFilter';

export interface WidgetConfigField {
  key: string;
  label: string;
  type: WidgetConfigFieldType;
  defaultValue?: unknown;
  required?: boolean;
  options?: WidgetConfigOption[];
  helpText?: string;
}

export interface WidgetDependencyDef {
  key: string;
  label: string;
  required: boolean;
  description?: string;
}

/** Descriptive metadata for the detail panel + permission gating — NOT a data resolver. */
export interface WidgetDataSourceDef {
  sourceKey: string;
  label: string;
  refreshIntervalMs?: number;
  permissions: string[];
  dependencies?: WidgetDependencyDef[];
}

export interface WidgetRenderProps<TConfig = Record<string, unknown>> {
  widgetId: string;
  instanceId: string;
  pageKey: string;
  zoneId: string;
  sizeKey: WidgetSizeKey;
  config: TConfig;
  /** True when rendered as a board PREVIEW (unsaved) — render can lighten if desired. */
  preview?: boolean;
}

export interface WidgetPreviewProps<TConfig = Record<string, unknown>> {
  widgetId: string;
  sizeKey: WidgetSizeKey;
  config: TConfig;
}

export interface WidgetDef<TConfig = Record<string, unknown>> {
  /** Versioned definition contract. Omitted v2 definitions are upgraded by the registry. */
  contractVersion?: WidgetContractVersion;
  id: string;

  module: ModuleKey;
  area: string;

  title: string;
  description: string;
  longDescription?: string;

  icon: string;
  category: string;
  tags: string[];

  previewVariant: WidgetPreviewVariant;

  /** Cold-state density for the layout-driven board skeleton. Optional: it is derived
   *  from `previewVariant` when omitted (see skeletonVariant.ts) — set it only when the
   *  loading shape should differ from the catalogue thumbnail's shape. */
  skeletonVariant?: WidgetSkeletonVariant;

  /** Board chrome (default 'standard'). Use 'none' when the widget renders its own card. */
  chrome?: WidgetChrome;

  /** Tile HEIGHT auto-fits the rendered content (gridstack sizeToContent): no internal
   *  scrollbar, no background gap below a short card, no hand-tuned `h`. Width stays
   *  user-resizable. Use for bare cards with a natural design height; leave off for
   *  widgets that intentionally scroll inside a fixed tile (e.g. the employee register). */
  sizeToContent?: boolean;

  /** Fixed-size catalogue widget. It remains draggable in edit mode but has no resize
   * handle; its single declared size is code-owned and stale saved geometry self-heals. */
  resizable?: boolean;

  supportedPages: string[];
  supportedZones: string[];

  defaultSize: WidgetSizeKey;
  allowedSizes: WidgetSizeDef[];
  /** Content-safe board floor. Grid constraints stop the handle; pixel constraints and the
   * runtime fit validator protect typography, charts, legends, actions, and dynamic content. */
  sizeConstraints?: WidgetSizeConstraints;

  /** Library-preview hint for widgets that size with viewport/relative units (HTML design widgets):
   *  the thumbnail is rendered at a board-like canvas of this width/height ratio, then scaled down
   *  to the preview box — so `vmin`/`clamp` text keeps real proportions instead of collapsing to its
   *  min in a tiny box. Omit for fluid DOM widgets (StatsCard etc.), which preview fine at any size. */
  previewAspect?: number;

  defaultConfig: TConfig;
  configSchema: WidgetConfigField[];

  dataSource: WidgetDataSourceDef;

  /** Package-owned catalogue defaults. Runtime governance may override these values. */
  governance?: Omit<WidgetGovernancePolicy, 'widgetId'>;
  /** Optional presentation motion. It never controls data refresh or authorization. */
  motion?: WidgetMotionSpec;

  /** Optional adaptive-content contract — see WidgetContentPriorityRule/WidgetDensityRules.
   *  Omitting these is fine; the widget just renders the same content at every size. */
  contentPriorityRules?: WidgetContentPriorityRule[];
  densityRules?: WidgetDensityRules;

  /** Explicit permission override. Most widgets should leave this unset — the board
   *  gates on `dataSource.permissions` by default (see WidgetRenderer). */
  permissions?: WidgetPermissionSpec;

  recommendedFor?: string[];
  /** When set, the widget is shown LOCKED in the catalogue (no data/module/permission yet). */
  lockedReason?: string;
  runtimeState?: Extract<WidgetRuntimeState, 'live-api' | 'static-preview' | 'action-gated'>;
  dataSourceKey?: string;

  /** Live render — a component that fetches its own data via the module's hooks. */
  render: (props: WidgetRenderProps<TConfig>) => VNode;
  /** Representative catalogue thumbnail (illustrative, not live data). */
  renderPreview?: (props: WidgetPreviewProps<TConfig>) => VNode;
}

export interface WidgetInstance<TConfig = Record<string, unknown>> {
  instanceId: string;
  widgetId: string;

  pageKey: string;
  zoneId: string;

  x: number;
  y: number;
  w: number;
  h: number;

  sizeKey: WidgetSizeKey;

  config: Partial<TConfig>;

  titleOverride?: string;
  isHidden?: boolean;
  lockedByAdmin?: boolean;
  responsive?: WidgetResponsivePlacements;
}

export interface PreviewWidgetInstance<TConfig = Record<string, unknown>>
  extends WidgetInstance<TConfig> {
  preview: true;
  previewId: string;
  source: 'widget-library';
}

export type BoardWidgetInstance = WidgetInstance | PreviewWidgetInstance;

/**
 * A PAGE-LOCAL widget renderer — a render function the host page supplies for a
 * board instance whose `widgetId` is NOT in the global registry (so it can close
 * over page state, e.g. the employee register's filters/selection/modals). Local
 * widgets are not offered in the library catalogue; they live in the page's
 * default layout. The board resolves a board item's renderer from `localWidgets`
 * first, then the global registry.
 */
export interface LocalWidget {
  render: (props: WidgetRenderProps) => VNode;
  chrome?: WidgetChrome;
  title?: string;
  /** Same shape/purpose as `WidgetDef.allowedSizes` — set this when the tile has fixed,
   *  non-reflowing content (e.g. a ported mockup card) so the board's resize floor holds
   *  (see WidgetBoardZone.gridNode). Omit for content that reflows safely at any size
   *  (tables, lists) — those keep the generic 2-cell floor. */
  allowedSizes?: WidgetSizeDef[];
  sizeConstraints?: WidgetSizeConstraints;
  /** Same as `WidgetDef.sizeToContent` — tile height auto-fits the rendered card. */
  sizeToContent?: boolean;
  /** Cold-state density for the board skeleton. A page-local widget has no registry
   *  entry to derive one from, so declare it here (e.g. the employee register: 'table'). */
  skeletonVariant?: WidgetSkeletonVariant;
  /** Set false for a FIXED-size tile the user can move but never resize (e.g. KPI cards
   *  that must stay a uniform size). Default true. */
  resizable?: boolean;
  /** Set true to PIN the tile in place (RGL `static`) — it can't be dragged, resized, or
   *  displaced by other tiles, so it always stays where the default layout puts it. */
  locked?: boolean;
}
export type LocalWidgetMap = Record<string, LocalWidget>;

export interface BoardLayout {
  version?: WidgetContractVersion;
  pageKey: string;
  /** Desktop grid width for this page. Most boards use 12; selected dense workspaces may use 24. */
  columns?: number;
  zones: Record<string, WidgetInstance[]>;
  updatedAt?: string;
}

export function isPreviewWidget(item: BoardWidgetInstance): item is PreviewWidgetInstance {
  return (item as PreviewWidgetInstance).preview;
}
