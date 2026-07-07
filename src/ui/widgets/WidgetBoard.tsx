// src/ui/widgets/WidgetBoard.tsx — renders the instance/zone board for a page: one
// gridstack grid per zone. Preview state (the ephemeral preview-on-board widget) is
// owned by the host page and threaded through to whichever zone it targets.
// Pages may supply page-local widget renderers + a default layout.
import type { VNode } from 'preact';
import { WidgetBoardZone } from './WidgetBoardZone';
import { useInstalledWidgetPackages } from './runtimeRegistry';
import type { BoardLayout, LocalWidgetMap, PreviewWidgetInstance } from './types';

export interface WidgetBoardProps {
  pageKey: string;
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
  /** RGL compactType — 'vertical' (default, Employee Master), 'horizontal', or null.
   *  Set to null on the Onboarding board so tiles honour their saved x/y positions
   *  without being re-compacted into the top-left, preserving the multi-column layout. */
  compact?: 'vertical' | 'horizontal' | null;
  /** When false, tiles can be DRAG-REORDERED in edit mode but NOT resized (uniform-size
   *  zones like the onboarding KPI row: pick which widgets + reorder, never resize). Default true. */
  resizable?: boolean;
  preview?: PreviewWidgetInstance | null;
  onPreviewChange?: (preview: PreviewWidgetInstance) => void;
  onCommitPreview?: (preview: PreviewWidgetInstance) => void;
  onDiscardPreview?: () => void;
}

export function WidgetBoard({ pageKey, zones = ['main'], editing, localWidgets, defaultLayout, demo, cellHeight, column, compact, resizable, preview, onPreviewChange, onCommitPreview, onDiscardPreview }: WidgetBoardProps): VNode {
  // Load installed declarative packages into the runtime registry so they resolve on the board.
  // `isSuccess` = the installed-package list is authoritative — only THEN may a zone prune board
  // instances whose widget no longer resolves (a transient/stale-dist error must NOT drop widgets).
  const pkgQuery = useInstalledWidgetPackages();
  return (
    <div class="wbi-board">
      {zones.map(zoneId => (
        <WidgetBoardZone
          key={zoneId} pageKey={pageKey} zoneId={zoneId} editing={editing}
          localWidgets={localWidgets} defaultLayout={defaultLayout} demo={demo}
          cellHeight={cellHeight} column={column} compact={compact} resizable={resizable}
          registryReady={pkgQuery.isSuccess}
          preview={preview} onPreviewChange={onPreviewChange}
          onCommitPreview={onCommitPreview} onDiscardPreview={onDiscardPreview}
        />
      ))}
    </div>
  );
}
