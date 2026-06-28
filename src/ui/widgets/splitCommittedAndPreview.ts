// src/ui/widgets/splitCommittedAndPreview.ts — separate the persisted widgets from the
// single ephemeral preview, so the board only ever saves the committed ones.
import type { BoardWidgetInstance, PreviewWidgetInstance, WidgetInstance } from './types';
import { isPreviewWidget } from './types';

export function splitCommittedAndPreview(items: BoardWidgetInstance[]): {
  committed: WidgetInstance[];
  preview: PreviewWidgetInstance | null;
} {
  const committed: WidgetInstance[] = [];
  let preview: PreviewWidgetInstance | null = null;
  for (const item of items) {
    if (isPreviewWidget(item)) preview = item;
    else committed.push(item);
  }
  return { committed, preview };
}
