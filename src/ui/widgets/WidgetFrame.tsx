// src/ui/widgets/WidgetFrame.tsx — chrome around a board widget.
//   chrome 'standard' → header (drag handle + title, + remove ✕ in edit mode) + bordered body.
//   chrome 'none'     → bare: the widget renders its own card; edit/preview tools FLOAT
//                       top-right (the float bar is the drag handle).
// A PREVIEW widget is draggable from its WHOLE frame (so you can grab anywhere to move it);
// its Add/Discard buttons stopPropagation on mousedown so clicking them never starts a drag.
import type { VNode, TargetedMouseEvent } from 'preact';
import { useState } from 'preact/hooks';
import { resolveBoardWidget } from './resolveBoardWidget';
import { findWidgetDef } from './registry';
import { WidgetConfigureModal } from './WidgetConfigureModal';
import { WidgetRenderer } from './WidgetRenderer';
import { useMountReveal } from './motion';
import type { BoardWidgetInstance, LocalWidgetMap } from './types';
import { toast } from '@store';

// Pressing an action button must not start a drag.
const noDrag = (e: TargetedMouseEvent<HTMLButtonElement>): void => e.stopPropagation();

function copyWidgetSize(e: TargetedMouseEvent<HTMLButtonElement>, item: BoardWidgetInstance, title: string): void {
  e.stopPropagation();
  const gridItem = e.currentTarget.closest<HTMLElement>('.react-grid-item');
  const rect = gridItem?.getBoundingClientRect();
  const width = rect ? Math.round(rect.width) : null;
  const height = rect ? Math.round(rect.height) : null;
  // Emits the size as a DEFAULT, never as a minimum.
  //
  // This used to emit a "Minimum size snippet" — `minColumns/minRows` taken from whatever the tile
  // currently measured. Pasting that made the size you liked the size the widget could never go
  // BELOW, so minRows crept up to equal defaultRows and the widget stopped being resizable at all.
  // A captured size is a statement about how the widget should be PLACED (defaultColumns/
  // defaultRows), not about the smallest it can render — that floor stays low so users can resize.
  const lines = [
    `Widget: ${title || item.widgetId}`,
    `widgetId: ${item.widgetId}`,
    `instanceId: ${item.instanceId}`,
    `pageKey: ${item.pageKey}`,
    `zoneId: ${item.zoneId}`,
    `grid: w=${item.w}, h=${item.h}  (position x=${item.x}, y=${item.y})`,
    width != null && height != null ? `pixels: width=${width}, height=${height}` : null,
    '',
    'Default size snippet (registry widget):',
    `sizeConstraints: { defaultColumns: ${item.w}, defaultRows: ${item.h}${width != null ? `, minWidth: ${width}` : ''}${height != null ? `, minHeight: ${height}` : ''} }`,
    '',
    "Board default-layout line (widgets placed by the page's own default):",
    `defInst('${item.widgetId}', ${item.x}, ${item.y}, ${item.w}, ${item.h}, '${item.sizeKey}'),`,
  ].filter((line): line is string => line != null).join('\n');
  void navigator.clipboard.writeText(lines)
    .then(() => toast.success('Widget size copied.'))
    .catch(() => toast.error('Widget size could not be copied.'));
}

export function WidgetFrame({ item, editing, isPreview, local, demo, revealOnMount = true, onCommitPreview, onDiscardPreview, onRemove, onConfigure }: {
  item: BoardWidgetInstance;
  editing?: boolean;
  isPreview?: boolean;
  local?: LocalWidgetMap;
  demo?: boolean;
  /** When false, the tile skips the fade+rise mount reveal (boards that should paint instantly). */
  revealOnMount?: boolean;
  onCommitPreview?: () => void;
  onDiscardPreview?: () => void;
  onRemove?: () => void;
  onConfigure?: (config: Record<string, unknown>) => void;
}): VNode {
  const [configOpen, setConfigOpen] = useState(false);
  const resolved = resolveBoardWidget(item.widgetId, local);
  const title = item.titleOverride ?? resolved?.title ?? '';
  const bare = resolved?.chrome === 'none';
  // Gentle fade+rise when a committed tile mounts (board load / add-from-library). The preview
  // tile is intentionally left un-animated (it's already a distinct dashed affordance), and a
  // board may opt out entirely (revealOnMount=false) to paint instantly. No-ops under
  // prefers-reduced-motion. Attached to whichever root renders (bare vs framed).
  const revealRef = useMountReveal();
  const rootRef = (isPreview || !revealOnMount) ? undefined : revealRef;

  const previewActions = (
    <span class="wbi-preview-actions">
      <button type="button" class="wbi-act" onMouseDown={noDrag} onClick={onCommitPreview}>Add to board</button>
      <button type="button" class="wbi-act muted" onMouseDown={noDrag} onClick={onDiscardPreview}>Discard</button>
    </span>
  );
  const definition = findWidgetDef(item.widgetId);
  const configure = editing && !isPreview && definition?.configSchema.length ? (
    <button type="button" class="wbi-remove" onMouseDown={noDrag} onClick={() => setConfigOpen(true)} aria-label="Configure widget"><i class="fas fa-gear" /></button>
  ) : null;
  const copySize = editing && !isPreview ? (
    <button type="button" class="wbi-remove" onMouseDown={noDrag} onClick={event => copyWidgetSize(event, item, title)} aria-label={`Copy ${title || item.widgetId} size`} title="Copy widget size"><i class="fas fa-copy" /></button>
  ) : null;
  const configModal = definition ? <WidgetConfigureModal open={configOpen} widget={definition} config={item.config} sizeKey={item.sizeKey} pageKey={item.pageKey} zoneId={item.zoneId} onClose={() => setConfigOpen(false)} onSave={next => { onConfigure?.(next); setConfigOpen(false); }} /> : null;
  // Settings are ALWAYS a small window — one surface for every widget, whatever its size.
  //
  // Configuration used to flip into the widget's own body for bare, fixed-height tiles. That
  // could never work in general: the config face is a real form (labels, colour inputs,
  // Save/Cancel) rendered inside the tile, so it was clipped by whatever height the tile
  // happened to have — invisible in a 96px KPI card, cramped in a chart. Gating the flip by
  // height only moved the boundary; the form still competed with the tile for space. One small
  // dialog is sized by its content instead of by the board, so it reads the same everywhere.

  if (bare) {
    const showTools = isPreview ?? editing;
    // Preview: the whole bare frame is the drag handle (grab anywhere).
    return (
      <div ref={rootRef} class={`wbi-bare${isPreview ? ' wbi-bare--preview wbi-drag' : editing ? ' wbi-drag' : ''}`}>
        {showTools && (
          <div class={`wbi-bare-tools${isPreview ? '' : ' wbi-drag'}`}>
            {isPreview
              ? <><span class="wbi-preview-chip">Preview</span>{previewActions}</>
              : <>
                  <i class="fas fa-grip-vertical wbi-grip" aria-hidden="true" />
                  {copySize}{configure}{onRemove ? <button type="button" class="wbi-remove" onMouseDown={noDrag} onClick={onRemove} aria-label="Remove widget"><i class="fas fa-xmark" /></button> : null}
                </>}
          </div>
        )}
        <div class="wbi-bare-body">
          <WidgetRenderer item={item} preview={isPreview} local={local} demo={demo} />
        </div>{configModal}
      </div>
    );
  }

  // Preview: whole frame draggable; otherwise only the header is the handle.
  return (
    <section ref={rootRef} class={`wbi-frame${isPreview ? ' wbi-frame--preview wbi-drag' : ''}`}>
      <header class={`wbi-head${isPreview ? '' : ' wbi-drag'}`}>
        {isPreview
          ? <span class="wbi-preview-chip">Preview — not added</span>
          : <span class="wbi-title"><i class="fas fa-grip-vertical wbi-grip" aria-hidden="true" /> {title}</span>}
        {isPreview ? previewActions : <>{copySize}{configure}{editing && onRemove ? <button type="button" class="wbi-remove" onMouseDown={noDrag} onClick={onRemove} aria-label="Remove widget"><i class="fas fa-xmark" /></button> : null}</>}
      </header>
      <div class="wbi-body"><WidgetRenderer item={item} preview={isPreview} local={local} demo={demo} /></div>{configModal}
    </section>
  );
}
