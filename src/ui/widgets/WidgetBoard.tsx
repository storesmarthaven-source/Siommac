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
  preview?: PreviewWidgetInstance | null;
  onPreviewChange?: (preview: PreviewWidgetInstance) => void;
  onCommitPreview?: (preview: PreviewWidgetInstance) => void;
  onDiscardPreview?: () => void;
}

export function WidgetBoard({ pageKey, zones = ['main'], editing, localWidgets, defaultLayout, demo, preview, onPreviewChange, onCommitPreview, onDiscardPreview }: WidgetBoardProps): VNode {
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
          registryReady={pkgQuery.isSuccess}
          preview={preview} onPreviewChange={onPreviewChange}
          onCommitPreview={onCommitPreview} onDiscardPreview={onDiscardPreview}
        />
      ))}
    </div>
  );
}
