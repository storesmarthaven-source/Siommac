/**
 * src/ui/widgets/index.ts — public entry for the SIOMAC Widget Platform v3 (instance/zone
 * board + preview-on-board). Import from '@ui/widgets'. The legacy v1 card board has been
 * deleted (no dual system); this is the only widget board now.
 */

// contract
export * from './types';
export { migrateBoardLayout, createV3Layout } from './migration';
export { deriveResponsivePlacements, placeWidgetsAtBottom, BREAKPOINT_COLUMNS } from './placement';
export { resolveWidgetAccess, type WidgetAccessContext, type WidgetAccessDecision } from './access';
export { registerWidgetDataSource, findWidgetDataSource, listWidgetDataSources } from './dataSources';
export { setWidgetGovernancePolicies, getWidgetGovernancePolicy, listWidgetGovernancePolicies, effectiveWidgetPolicy, isWidgetDiscoverable } from './governance';

// registry
export {
  WIDGET_REGISTRY, allWidgets, getWidgetDef, findWidgetDef, getWidgetsForPage, getWidgetsByModule,
} from './registry';

// declarative (no-code) widgets + installable packages
export type { DeclarativeWidgetSpec, DeclarativeView, DeclarativePackageManifest } from './declarative/types';
export { declarativeToWidgetDef } from './declarative/declarativeToWidgetDef';
export {
  useInstalledWidgetPackages, useRuntimeWidgetsVersion, useRefreshInstalledPackages, WIDGET_PACKAGES_KEY,
} from './runtimeRegistry';

// instance helpers
export { createWidgetInstance } from './createWidgetInstance';
export { createPreviewWidgetInstance } from './createPreviewWidgetInstance';
export { commitPreviewWidget } from './commitPreviewWidget';
export { splitCommittedAndPreview } from './splitCommittedAndPreview';

// animation toolkit (the sanctioned way to animate a widget — see WIDGET_AUTHORING_GUIDE.md)
export { reducedMotion, useMountReveal, useValuePulse, useStaggerReveal, type MountRevealOpts } from './motion';

// board + persistence
export { useBoardLayout, type UseBoardLayoutResult } from './useBoardLayout';
export { WidgetBoard, type WidgetBoardProps } from './WidgetBoard';
export { WidgetBoardZone, type WidgetBoardZoneProps } from './WidgetBoardZone';
export { WidgetBoardToolbar, type WidgetBoardToolbarProps } from './WidgetBoardToolbar';
export { WidgetRenderer } from './WidgetRenderer';
export { WidgetFrame } from './WidgetFrame';

// first-party bundles (curated code sets — distinct from third-party installable packages)
export { WIDGET_BUNDLES, resolveBundleWidgets, type WidgetBundle } from './bundles';

// library modal
export { WidgetLibraryModal, type WidgetLibraryModalProps } from './WidgetLibraryModal';
export { WidgetConfigureModal } from './WidgetConfigureModal';
export { WidgetDetailPanel } from './WidgetDetailPanel';
export { WidgetCatalog } from './WidgetCatalog';
export { WidgetLivePreview } from './WidgetLivePreview';
