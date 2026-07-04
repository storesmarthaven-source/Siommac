/**
 * WIDGET_SYSTEM_TYPES.ts — SIOMAC Enterprise Widget System — TYPE CONTRACT (design reference).
 *
 * INTERFACES ONLY. No runtime/implementation. This is the target contract Codex implements in
 * `src/ui/widgets/types.ts` (extending, not replacing, the existing v2 contract).
 *
 * Relationship to the EXISTING contract (`src/ui/widgets/types.ts`):
 *   - `WidgetDefinition`  is a SUPERSET of the existing `WidgetDef`  → keep `WidgetDef` as an alias.
 *   - `WidgetInstance`    extends the existing `WidgetInstance`      → same name, added optional fields.
 *   - `BoardLayout`, `PreviewWidgetInstance`, `LocalWidget`         → unchanged (re-declared here for context).
 * All new fields are OPTIONAL where needed so existing `registry.hr*.tsx` widgets keep compiling.
 *
 * NOTE: `VNode` below is the Preact `VNode` (import type { VNode } from 'preact'). It is aliased as
 * `unknown` here only so this reference file is self-contained; the real file imports it from preact.
 */

type VNode = unknown; // → import type { VNode } from 'preact'

/* ─────────────────────────────── Scalars & enums ─────────────────────────────── */

/** Active modules only. `platform` = enterprise surfaces (Settings/Console/Profile/Messages/
 *  Notifications/Tickets). `enterprise` kept as a deprecated alias of `platform`. NO legacy. */
export type WidgetModuleScope = 'hr' | 'finance' | 'hse' | 'platform' | 'operations' | 'enterprise';

/** Enterprise size vocabulary. `compact/standard/hero` are DEPRECATED aliases (normalizeSizeKey maps
 *  compact→small, standard→medium, hero→full) so existing widgets keep working. */
export type WidgetSize =
  | 'mini' | 'small' | 'medium' | 'large' | 'wide' | 'tall' | 'full'
  | 'compact' | 'standard' | 'hero'; // deprecated aliases

export type WidgetTone = 'default' | 'info' | 'success' | 'warning' | 'danger' | 'muted';

export type WidgetAnimationPreset =
  | 'none' | 'fade-in' | 'slide-up' | 'pulse-soft' | 'count-up' | 'sparkline-draw'
  | 'chart-grow' | 'alert-pulse' | 'progress-fill' | 'skeleton-shimmer'
  | 'status-change-flash' | 'drag-lift' | 'resize-settle';

export type WidgetChrome = 'standard' | 'none';

export type WidgetDataSourceType = 'static' | 'api' | 'query' | 'realtime' | 'derived';

export type WidgetRenderStatus = 'loading' | 'ready' | 'empty' | 'error' | 'stale';

export type WidgetLifecycleState =
  | 'loading' | 'ready' | 'empty' | 'error' | 'stale' | 'locked' | 'unavailable';

export type WidgetConfigFieldType =
  | 'text' | 'select' | 'multiSelect' | 'dateRange' | 'number' | 'boolean'
  | 'threshold' | 'statusFilter' | 'chartType' | 'refreshInterval' | 'animationPreset';

export type WidgetPreviewVariant =
  | 'metric' | 'trend' | 'donut' | 'task-board' | 'timeline' | 'people'
  | 'table' | 'checklist' | 'risk' | 'flow-map' | 'matrix' | 'status-stack';

/* ─────────────────────────────── Sizing ─────────────────────────────── */

export interface WidgetGridSize { w: number; h: number }

export interface WidgetSizeDef {
  key: WidgetSize;
  label: string;
  grid: WidgetGridSize;          // canonical footprint on the 12-col grid
  min?: WidgetGridSize;
  max?: WidgetGridSize;
  description?: string;
}

/** A content "slot" appears only when the current size >= minSize (size order:
 *  mini<small<medium<large≈wide≈tall<full). Drives responsive show/hide (Section 7). */
export interface WidgetContentPriorityRule {
  slot: string;                  // e.g. 'value' | 'sparkline' | 'chart' | 'table' | 'filters' | 'actions' | 'legend'
  minSize: WidgetSize;           // smallest size at which this slot is shown
  collapseTo?: string;           // what it collapses into below minSize (e.g. chart→sparkline)
  truncate?: boolean;            // labels ellipsis below minSize
  tooltipFallback?: boolean;     // expose hidden content via title/tooltip
}

export interface WidgetDensityRules {
  chart?: { simplifyBelow?: WidgetSize; hideBelow?: WidgetSize };
  legend?: { showAtOrAbove?: WidgetSize };            // else tooltip-only
  labels?: { truncateBelow?: WidgetSize; hideBelow?: WidgetSize };
  actions?: { menuBelow?: WidgetSize; hideBelow?: WidgetSize };
  numbers?: { abbreviateBelow?: WidgetSize };         // 1.2k / 3.4M
}

export interface WidgetResizeBehavior {
  keepAspect?: boolean;
  reflow?: 'content-priority' | 'scale' | 'fixed';
}

/* ─────────────────────────────── Animation ─────────────────────────────── */

export interface WidgetAnimationConfig {
  default?: WidgetAnimationPreset;                    // clamped by the animation layer rules
  byState?: Partial<Record<WidgetLifecycleState, WidgetAnimationPreset>>;
  countUpOnValueChangeOnly?: boolean;                 // default true
  suppressChartAnimForRealtime?: boolean;             // default true (refresh<15s → suppress)
  alertPulseMaxCount?: number;                        // default 3, then rest
}

/* ─────────────────────────────── Config ─────────────────────────────── */

export interface WidgetConfigOption { label: string; value: string }

export interface WidgetConfigField {
  key: string;
  label: string;
  type: WidgetConfigFieldType;
  defaultValue?: unknown;
  required?: boolean;
  options?: WidgetConfigOption[];
  helpText?: string;
  editableBy?: 'user' | 'admin';                      // NEW — admin-only fields hidden from user modal
  permission?: string;                                // NEW — RBAC key required to edit this field
  validation?: { min?: number; max?: number; pattern?: string; message?: string };
}

/* ─────────────────────────────── Data source & provider ─────────────────────────────── */

export interface WidgetDependencyDef {
  key: string;
  label: string;
  required: boolean;
  description?: string;
}

/** Descriptive metadata for gating/detail/governance — NOT a generic fetcher (reuse-hooks model). */
export interface WidgetDataSourceDef {
  dataSourceType: WidgetDataSourceType;
  sourceKey: string;                                  // stable id, e.g. 'hr.offboarding.dashboardStats'
  label: string;
  apiRoute?: string;                                  // for route-availability governance check
  queryKey?: readonly unknown[];                      // TanStack key for invalidation
  refreshIntervalMs?: number;
  realtimeChannel?: string;                           // realtime only TRIGGERS refetch
  requiredPermissions: string[];                      // ALL required to view (exact catalogue keys)
  fallbackData?: unknown;
  dependencies?: WidgetDependencyDef[];
}

export interface WidgetDataResult<T = unknown> {
  status: WidgetRenderStatus;
  data: T | null;
  meta: { lastUpdated?: string; source: string };
  lastUpdated?: string;
  error?: { message: string; code?: string };
  refresh: () => void;
}

/** A thin wrapper over the widget's own TanStack hook (NOT a generic fetcher). */
export interface WidgetDataProvider<T = unknown, TConfig = Record<string, unknown>> {
  sourceKey: string;
  use: (def: WidgetDefinition<TConfig>, config: TConfig) => WidgetDataResult<T>;
}

/* ─────────────────────────────── Permissions & actions ─────────────────────────────── */

export interface WidgetActionDef {
  key: string;
  label: string;
  icon?: string;
  permission: string;                                 // action gate — independent of visibility
  intent?: 'default' | 'primary' | 'danger';
  minSize?: WidgetSize;                               // action hidden below this size
}

export interface WidgetPermissionSpec {
  requiredPermissions: string[];                      // view (ALL required)
  optionalPermissions?: string[];                     // enrich if present
  installPermission: string;                          // install the carrying package
  configurePermission?: string;                       // change instance config (default: view)
  viewPermission?: string;                            // explicit primary view key
}

/* ─────────────────────────────── Definition ─────────────────────────────── */

export interface WidgetRendererProps<TConfig = Record<string, unknown>> {
  widgetId: string;
  instanceId: string;
  pageKey: string;
  zoneId: string;
  sizeKey: WidgetSize;
  config: TConfig;
  preview?: boolean;                                  // board preview (unsaved)
}

export interface WidgetPreviewProps<TConfig = Record<string, unknown>> {
  widgetId: string;
  sizeKey: WidgetSize;
  config: TConfig;
}

export interface WidgetDefinition<TConfig = Record<string, unknown>> {
  id: string;
  module: WidgetModuleScope;
  area: string;

  title: string;
  description: string;
  longDescription?: string;

  icon: string;
  category: string;
  tags: string[];

  previewVariant: WidgetPreviewVariant;
  chrome?: WidgetChrome;                              // default 'standard'
  previewAspect?: number;

  supportedPages: string[];
  supportedZones: string[];

  // sizing
  defaultSize: WidgetSize;
  allowedSizes: WidgetSizeDef[];
  contentPriorityRules?: WidgetContentPriorityRule[]; // NEW
  densityRules?: WidgetDensityRules;                  // NEW
  resizeBehavior?: WidgetResizeBehavior;              // NEW

  // config
  defaultConfig: TConfig;
  configSchema: WidgetConfigField[];

  // data + permissions
  dataSource: WidgetDataSourceDef;
  permissions: WidgetPermissionSpec;                  // NEW (supersedes bare dataSource.permissions)
  actions?: WidgetActionDef[];                        // NEW — per-action gates

  // animation
  animation?: WidgetAnimationConfig;                  // NEW

  // versioning / packaging
  version?: string;                                   // NEW — semver of the widget def
  packageId?: string;                                 // NEW — owning package
  schemaVersion?: number;                             // NEW — widget schema version

  // catalogue governance hints
  recommendedFor?: string[];
  lockedReason?: string;

  // render
  render: (props: WidgetRendererProps<TConfig>) => VNode;
  renderPreview?: (props: WidgetPreviewProps<TConfig>) => VNode;
}

/** Deprecated alias — existing code imports `WidgetDef`. Keep. */
export type WidgetDef<TConfig = Record<string, unknown>> = WidgetDefinition<TConfig>;

/* ─────────────────────────────── Instance & layout ─────────────────────────────── */

export interface WidgetInstance<TConfig = Record<string, unknown>> {
  instanceId: string;
  widgetId: string;
  pageKey: string;
  zoneId: string;
  x: number; y: number; w: number; h: number;
  sizeKey: WidgetSize;
  config: Partial<TConfig>;
  titleOverride?: string;
  isHidden?: boolean;
  lockedByAdmin?: boolean;
  // NEW (optional; set by governance/uninstall):
  unavailable?: boolean;                              // owning package uninstalled
  packageId?: string;
  defVersion?: string;
}

export interface PreviewWidgetInstance<TConfig = Record<string, unknown>>
  extends WidgetInstance<TConfig> {
  preview: true;
  previewId: string;
  source: 'widget-library';
}

export type BoardWidgetInstance = WidgetInstance | PreviewWidgetInstance;

export interface WidgetLayoutItem {                   // gridstack cell descriptor
  instanceId: string;
  widgetId: string;
  x: number; y: number; w: number; h: number;
  sizeKey: WidgetSize;
  locked?: boolean;
  noResize?: boolean;
  noMove?: boolean;
}

export interface LocalWidget {
  render: (props: WidgetRendererProps) => VNode;
  chrome?: WidgetChrome;
  title?: string;
}
export type LocalWidgetMap = Record<string, LocalWidget>;

export interface BoardLayout {
  pageKey: string;
  zones: Record<string, WidgetInstance[]>;
  updatedAt?: string;
}

/* ─────────────────────────────── Packaging & install ─────────────────────────────── */

export interface WidgetPackageWidget {
  /** Either an inline declarative spec, or a reference to a code widget id shipped in-repo. */
  kind: 'declarative' | 'code-ref';
  widgetId: string;
  spec?: unknown;                                     // DeclarativeWidgetSpec when kind==='declarative'
}

export interface WidgetPackageDependency { packageId: string; versionRange: string }

export interface WidgetPackageInstallDefaults {
  enabled?: boolean;                                  // default enablement (governance)
  allowedRoles?: string[] | null;                     // null = all roles
  allowedModules?: string[] | null;
  defaultLayoutHints?: Array<{ pageKey: string; widgetId: string; sizeKey: WidgetSize }>;
}

export interface WidgetPackageManifest {
  packageId: string;
  name: string;
  description: string;
  version: string;                                    // semver
  publisher: string;                                  // 'SIOMAC' | org | vendor
  module: WidgetModuleScope;
  widgets: WidgetPackageWidget[];
  requiredPermissions: string[];                      // validated vs RBAC catalogue
  requiredRoutes: string[];                           // validated vs backend
  requiredFeatureFlags?: string[];
  compatibleSiomacVersion: string;                    // semver range
  dependencies?: WidgetPackageDependency[];
  migrationNotes?: string;
  installDefaults?: WidgetPackageInstallDefaults;
  uninstallBehavior?: 'preserve-instances-disabled' | 'remove-instances';
  signature?: string;                                 // optional integrity signature
}

export interface WidgetValidationIssue {
  level: 'error' | 'warning';
  code: string;                                       // e.g. 'DUP_ID' | 'PERM_NOT_IN_CATALOGUE' | 'ROUTE_MISSING' | 'NO_SIZES' | 'NO_STATES'
  message: string;
  widgetId?: string;
  path?: string;
}

export interface WidgetValidationResult {
  ok: boolean;
  issues: WidgetValidationIssue[];
}

export interface WidgetInstallResult {
  ok: boolean;
  packageId: string;
  installedWidgetIds: string[];
  fromVersion?: string;                               // set on update
  toVersion: string;
  validation: WidgetValidationResult;
  auditId?: string;
}

/* ─────────────────────────────── Governance ─────────────────────────────── */

export interface WidgetPolicy {
  id: string;
  subjectType: 'package' | 'widget';
  subjectId: string;
  enabled: boolean;
  allowedRoles: string[] | null;                      // null = all
  allowedModules: string[] | null;
  locked: boolean;                                    // seeded + non-removable
  hiddenFromCatalog: boolean;
  defaultConfig?: Record<string, unknown> | null;
  updatedAt: string;
  updatedBy: string;
}

/* ─────────────────────────────── Registry API ─────────────────────────────── */

export interface WidgetRegistry {
  registerWidget: (def: WidgetDefinition) => void;                    // runtime (installer)
  unregisterWidget: (widgetId: string) => void;                       // runtime (uninstall)
  getWidgetDefinition: (widgetId: string) => WidgetDefinition | undefined;
  listWidgetsByModule: (module: WidgetModuleScope) => WidgetDefinition[];
  listWidgetsByPermission: (userPermissions: string[]) => WidgetDefinition[];
  listWidgetsForPage: (pageKey: string) => WidgetDefinition[];
  listInstalledPackages: () => Promise<WidgetPackageManifest[]>;
  validateWidgetManifest: (manifest: WidgetPackageManifest) => WidgetValidationResult;
  resolveWidgetDataProvider: (def: WidgetDefinition) => WidgetDataProvider | undefined;
  resolveWidgetRenderer: (
    ref: WidgetDefinition | WidgetInstance,
    localWidgets?: LocalWidgetMap,
  ) => ((props: WidgetRendererProps) => VNode) | undefined;
}

/* ─────────────────────────────── Type guards (signatures only) ─────────────────────────────── */

export declare function isPreviewWidget(item: BoardWidgetInstance): item is PreviewWidgetInstance;
export declare function normalizeSizeKey(size: WidgetSize): Exclude<WidgetSize, 'compact' | 'standard' | 'hero'>;
