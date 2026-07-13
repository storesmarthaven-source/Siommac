// src/ui/widgets/WidgetFrame.tsx — chrome around a board widget.
//   chrome 'standard' → header (drag handle + title, + remove ✕ in edit mode) + bordered body.
//   chrome 'none'     → bare: the widget renders its own card; edit/preview tools FLOAT
//                       top-right (the float bar is the drag handle).
// A PREVIEW widget is draggable from its WHOLE frame (so you can grab anywhere to move it);
// its Add/Discard buttons stopPropagation on mousedown so clicking them never starts a drag.
import type { VNode, TargetedMouseEvent } from 'preact';
import { resolveBoardWidget } from './resolveBoardWidget';
import { WidgetRenderer } from './WidgetRenderer';
import { useMountReveal } from './motion';
import type { BoardWidgetInstance, LocalWidgetMap } from './types';

// Pressing an action button must not start a drag.
const noDrag = (e: TargetedMouseEvent<HTMLButtonElement>): void => e.stopPropagation();

export function WidgetFrame({ item, editing, isPreview, local, demo, revealOnMount = true, onCommitPreview, onDiscardPreview, onRemove }: {
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
}): VNode {
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

  if (bare) {
    const showTools = isPreview ?? editing;
    // Preview: the whole bare frame is the drag handle (grab anywhere).
    return (
      <div ref={rootRef} class={`wbi-bare${isPreview ? ' wbi-bare--preview wbi-drag' : ''}`}>
        {showTools && (
          <div class={`wbi-bare-tools${isPreview ? '' : ' wbi-drag'}`}>
            {isPreview
              ? <><span class="wbi-preview-chip">Preview</span>{previewActions}</>
              : <>
                  <i class="fas fa-grip-vertical wbi-grip" aria-hidden="true" />
                  {onRemove ? <button type="button" class="wbi-remove" onMouseDown={noDrag} onClick={onRemove} aria-label="Remove widget"><i class="fas fa-xmark" /></button> : null}
                </>}
          </div>
        )}
        <div class="wbi-bare-body"><WidgetRenderer item={item} preview={isPreview} local={local} demo={demo} /></div>
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
        {isPreview ? previewActions : (editing && onRemove ? (
          <button type="button" class="wbi-remove" onMouseDown={noDrag} onClick={onRemove} aria-label="Remove widget"><i class="fas fa-xmark" /></button>
        ) : null)}
      </header>
      <div class="wbi-body"><WidgetRenderer item={item} preview={isPreview} local={local} demo={demo} /></div>
    </section>
  );
}
