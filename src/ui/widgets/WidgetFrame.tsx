// src/ui/widgets/WidgetFrame.tsx — chrome around a board widget.
//   chrome 'standard' → header (drag handle + title, + remove ✕ in edit mode) + bordered body.
//   chrome 'none'     → bare: the widget renders its own card; edit/preview tools FLOAT
//                       top-right (the float bar is the drag handle).
// A PREVIEW widget is draggable from its WHOLE frame (so you can grab anywhere to move it);
// its Add/Discard buttons stopPropagation on mousedown so clicking them never starts a drag.
import type { JSX, VNode } from 'preact';
import { resolveBoardWidget } from './resolveBoardWidget';
import { WidgetRenderer } from './WidgetRenderer';
import type { BoardWidgetInstance, LocalWidgetMap } from './types';

// Pressing an action button must not start a gridstack drag.
const noDrag = (e: JSX.TargetedMouseEvent<HTMLButtonElement>): void => e.stopPropagation();

export function WidgetFrame({ item, editing, isPreview, local, demo, onCommitPreview, onDiscardPreview, onRemove }: {
  item: BoardWidgetInstance;
  editing?: boolean;
  isPreview?: boolean;
  local?: LocalWidgetMap;
  demo?: boolean;
  onCommitPreview?: () => void;
  onDiscardPreview?: () => void;
  onRemove?: () => void;
}): VNode {
  const resolved = resolveBoardWidget(item.widgetId, local);
  const title = item.titleOverride ?? resolved?.title ?? '';
  const bare = resolved?.chrome === 'none';

  const previewActions = (
    <span class="wbi-preview-actions">
      <button type="button" class="wbi-act" onMouseDown={noDrag} onClick={onCommitPreview}>Add to board</button>
      <button type="button" class="wbi-act muted" onMouseDown={noDrag} onClick={onDiscardPreview}>Discard</button>
    </span>
  );

  if (bare) {
    const showTools = isPreview || editing;
    // Preview: the whole bare frame is the drag handle (grab anywhere).
    return (
      <div class={`wbi-bare${isPreview ? ' wbi-bare--preview wbi-drag' : ''}`}>
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
    <section class={`wbi-frame${isPreview ? ' wbi-frame--preview wbi-drag' : ''}`}>
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
