// src/ui/widgets/WidgetBoard.tsx — renders the instance/zone board for a page: one
// react-grid-layout grid per zone. Preview state (the ephemeral preview-on-board widget) is
// owned by the host page and threaded through to whichever zone it targets.
// Pages may supply page-local widget renderers + a default layout.
import type { VNode } from 'preact';
import { useEffect } from 'preact/hooks';
import { WidgetBoardZone } from './WidgetBoardZone';
import { useInstalledWidgetPackages } from './runtimeRegistry';
import { LucideIcon } from '../LucideIcon';
import type { BoardLayout, LocalWidgetMap, PreviewWidgetInstance, WidgetRuntimeContext } from './types';
import { registerSectionNavigationGuard } from '@components/nav/navCore';
import { dialog } from '@lib/dialog';

export interface WidgetBoardProps {
  pageKey: string;
  /** Transient per-request context forwarded to widgets. NOT persisted (see WidgetRuntimeContext). */
  runtime?: WidgetRuntimeContext;
  /** Ordered zone ids to render; defaults to a single 'main' zone. */
  zones?: string[];
  editing?: boolean;
  /** Page-local widget renderers (e.g. the employee register) keyed by widgetId. */
  localWidgets?: LocalWidgetMap;
  /** Layout used when the user has no saved layout for this page. */
  defaultLayout?: BoardLayout;
  /** Demo mode — registry widgets render their static sample instead of live data. */
  demo?: boolean;
  /** Gridstack row height in px (default 88). Boards dominated by sizeToContent tiles
   *  should use a SMALL value (e.g. 12): tile heights quantize to this, so a fine grid
   *  lets each tile hug its card instead of leaving up to a row's worth of background
   *  gap below it. Coarse boards (fixed-height tiles the user drags to size) keep 88. */
  cellHeight?: number;
  /** Gridstack column count (default 12). A finer grid (e.g. 24) makes width-resize
   *  feel near-fluid — snap steps halve — at the cost of looser column alignment.
   *  NOTE: every x/w/minW in the board's default layout and its widgets' allowedSizes
   *  is expressed in THESE units — they must match the column count. */
  column?: number;
  /** Explicit [horizontal, vertical] px gap between tiles, independent of cellHeight.
   *  Omit to keep the cellHeight-derived default (`[12, vMargin]`). */
  gap?: [number, number];
  /** RGL compactType — 'vertical' (default, Employee Master), 'horizontal', or null.
   *  Set to null on the Onboarding board so tiles honour their saved x/y positions
   *  without being re-compacted into the top-left, preserving the multi-column layout. */
  compact?: 'vertical' | 'horizontal' | null;
  /** When false, tiles can be DRAG-REORDERED in edit mode but NOT resized (uniform-size
   *  zones like the onboarding KPI row: pick which widgets + reorder, never resize). Default true. */
  resizable?: boolean;
  /** Hard cap on grid rows (RGL `maxRows`). Set to a single tile-height (a tile's `h`) with
   *  `isBounded` to lock a one-row grid to HORIZONTAL-only movement — tiles can't be dragged into a
   *  second row. Default unbounded. */
  maxRows?: number;
  /** Keep tiles inside the grid while dragging (RGL `isBounded`). Pair with `maxRows` for a locked
   *  horizontal row. Default false. */
  isBounded?: boolean;
  /** When false, tiles paint instantly instead of the fade+rise mount reveal (boards that
   *  shouldn't animate on load). Default true. */
  revealOnMount?: boolean;
  preview?: PreviewWidgetInstance | null;
  onPreviewChange?: (preview: PreviewWidgetInstance) => void;
  onCommitPreview?: (preview: PreviewWidgetInstance) => void;
  onDiscardPreview?: () => void;
  /** When provided, an edit-mode banner (with a "Done" button that calls this) shows across
   *  the top of the board while `editing` — so it's obvious you're editing and how to leave it.
   *  Opt-in: boards that don't pass it get no banner. */
  onFinishEditing?: () => void;
  onSaveEditing?: () => void | Promise<void>;
  onCancelEditing?: () => void | Promise<void>;
  /** Opens the page's Widget Library from the persistent edit bar. */
  onOpenLibrary?: () => void;
  /** Admin "Set as default" surfaced IN the edit banner (the contextual place to promote a
   *  freshly rearranged board). Shown when both this and `canSetDefault` are set; disabled when
   *  `defaultDirty === false` (the layout already matches the default — nothing to promote). */
  onSetDefault?: () => void;
  canSetDefault?: boolean;
  defaultDirty?: boolean;
  /** True when this page has staged changes that have not been committed. */
  isDirty?: boolean;
  /** True while the personal-layout save request is in flight. */
  saving?: boolean;
  /** True while a Set-as-default promote is in flight — the banner button disables and
   *  reads "Saving…" so it can't be double-clicked into duplicate saves/toasts. */
  defaultSaving?: boolean;
}

export function WidgetBoard({ runtime, pageKey, zones = ['main'], editing, localWidgets, defaultLayout, demo, cellHeight, column, gap, compact, resizable, maxRows, isBounded, revealOnMount, preview, onPreviewChange, onCommitPreview, onDiscardPreview, onFinishEditing, onSaveEditing, onCancelEditing, onOpenLibrary, onSetDefault, canSetDefault, defaultDirty, isDirty, saving, defaultSaving }: WidgetBoardProps): VNode {
  // Load installed declarative packages into the runtime registry so they resolve on the board.
  // Package readiness changes placeholder resolution only. It never removes saved instances.
  const pkgQuery = useInstalledWidgetPackages();
  useEffect(() => {
    if (!editing || !isDirty || !onCancelEditing) return undefined;
    const unregister = registerSectionNavigationGuard(async () => {
      const discard = await dialog.confirm({
        title: 'Discard unsaved widget changes?',
        text: 'Your widget arrangement has not been saved. Discard it and leave this page?',
        confirmText: 'Discard and leave',
        danger: false,
      });
      if (!discard) return false;
      await onCancelEditing();
      return true;
    });
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      // preventDefault() is the supported way to trigger the unsaved-changes prompt;
      // the legacy event.returnValue assignment is deprecated.
      event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      unregister();
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [editing, isDirty, onCancelEditing]);

  return (
    <div class={`wbi-board${editing ? ' is-editing' : ''}${onFinishEditing ? ' has-edit-banner' : ''}`}>
      {/* Edit-mode banner (opt-in) — the clear "you're editing / click Done to finish" affordance.
          Hidden while previewing a widget, when the host's own preview banner takes over.
          The wrapper stays MOUNTED so entering/leaving edit mode animates the banner's space
          (grid-rows collapse) instead of the content jumping. */}
      {onFinishEditing && (
        <div class={`wbi-edit-banner-wrap${editing && !preview ? ' is-open' : ''}`} aria-hidden={!(editing && !preview)}>
          <div class="wbi-edit-banner">
            <span class="wbi-edit-banner-txt">
              <span class="wbi-edit-banner-ic"><LucideIcon name="Move" size={18} /></span>
              <span class="wbi-edit-banner-lines">
                <span class="wbi-edit-banner-title">Editing layout{isDirty ? ' · Unsaved changes' : ''}</span>
                <span class="wbi-edit-banner-sub" aria-live="polite">{isDirty ? 'Save or cancel before leaving this page' : 'Drag, resize or add widgets to rearrange'}</span>
              </span>
            </span>
            <span class="wbi-edit-banner-actions">
              {onOpenLibrary && <button type="button" class="wbi-edit-banner-secondary" onClick={onOpenLibrary}><LucideIcon name="LayoutGrid" size={14} /> Widget library</button>}
              {canSetDefault && onSetDefault && (
                <button type="button" class="wbi-edit-banner-secondary"
                  disabled={defaultDirty === false || defaultSaving}
                  title={defaultDirty === false ? 'Rearrange the board to enable' : undefined}
                  onClick={onSetDefault}>
                  <LucideIcon name="Star" size={14} /> {defaultSaving ? 'Saving…' : 'Set as default'}
                </button>
              )}
              {onCancelEditing && <button type="button" class="wbi-edit-banner-secondary" onClick={() => void onCancelEditing()}><LucideIcon name="X" size={14} /> Cancel</button>}
              <button type="button" class="wbi-edit-banner-done" disabled={saving}
                onClick={() => void (onSaveEditing ? onSaveEditing() : onFinishEditing())}>
                <LucideIcon name="Check" size={15} /> {saving ? 'Saving…' : isDirty ? 'Save layout' : 'Done'}
              </button>
            </span>
          </div>
        </div>
      )}
      {zones.map(zoneId => (
        <WidgetBoardZone
          runtime={runtime}
          key={zoneId} pageKey={pageKey} zoneId={zoneId} editing={editing}
          localWidgets={localWidgets} defaultLayout={defaultLayout} demo={demo}
          cellHeight={cellHeight} column={column} gap={gap} compact={compact} resizable={resizable}
          maxRows={maxRows} isBounded={isBounded}
          revealOnMount={revealOnMount}
          registryReady={pkgQuery.isSuccess}
          preview={preview} onPreviewChange={onPreviewChange}
          onCommitPreview={onCommitPreview} onDiscardPreview={onDiscardPreview}
        />
      ))}
    </div>
  );
}
