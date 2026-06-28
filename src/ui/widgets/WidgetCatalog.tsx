// src/ui/widgets/WidgetCatalog.tsx — left pane. "Recommended for this page" + per-category
// sections, each a dense grid of selectable tiles. Tiles show the representative renderPreview;
// locked tiles are dimmed + not selectable; already-added tiles are greyscale.
import type { VNode } from 'preact';
import type { WidgetDef } from './types';
import { WidgetPreviewScaler } from './WidgetPreviewScaler';

const VARIANT_TONE: Record<string, string> = {
  donut: 'success', 'task-board': 'warning', risk: 'danger', people: 'teal',
  timeline: 'purple', checklist: 'success', matrix: 'purple',
};

function sizeLabel(w: WidgetDef): string {
  const s = w.allowedSizes.find(x => x.key === w.defaultSize);
  return s ? `${s.label} · ${s.grid.w}×${s.grid.h}` : w.defaultSize;
}

export function WidgetCatalog({ widgets, pageKey, selectedWidgetId, placedIds, lockedIds, onSelect }: {
  widgets: WidgetDef[]; pageKey: string; selectedWidgetId: string | null;
  placedIds: Set<string>; lockedIds: Set<string>; onSelect: (widget: WidgetDef) => void;
}): VNode {
  const recommended = widgets.filter(w => w.recommendedFor?.includes(pageKey));
  const byCat = new Map<string, WidgetDef[]>();
  for (const w of widgets) { const list = byCat.get(w.category) ?? []; list.push(w); byCat.set(w.category, list); }

  const sections: { key: string; title: string; sub?: string; list: WidgetDef[] }[] = [];
  if (recommended.length) sections.push({ key: '__rec', title: 'Recommended for this page', sub: 'Featured for the active module and board.', list: recommended });
  for (const [cat, list] of byCat) sections.push({ key: cat, title: cat, list });

  return (
    <div class="wlib-catalog">
      {sections.map(sec => (
        <section class="wlib-section" key={sec.key}>
          <div class="wlib-section-head">
            <div><h3>{sec.title}</h3>{sec.sub ? <p>{sec.sub}</p> : null}</div>
            <span class="wlib-section-count">{sec.list.length} widget{sec.list.length === 1 ? '' : 's'}</span>
          </div>
          <div class="wlib-grid">
            {sec.list.map(w => {
              const locked = lockedIds.has(w.id);
              const added = placedIds.has(w.id);
              const tone = VARIANT_TONE[w.previewVariant] ?? '';
              return (
                <article
                  key={w.id}
                  class={`wlib-tile size-${w.defaultSize}${selectedWidgetId === w.id ? ' selected' : ''}${locked ? ' locked' : ''}${added ? ' added' : ''}`}
                  onClick={() => { if (!locked && !added) onSelect(w); }}
                >
                  <div class="wlib-tile-top">
                    <span class={`wlib-tile-icon${tone ? ' ' + tone : ''}`}><i class={`fas ${w.icon}`} /></span>
                    <div class="wlib-tile-title"><h3>{w.title}</h3><p>{w.description}</p></div>
                  </div>
                  <div class="wlib-tile-preview">
                    {w.renderPreview
                      ? (w.previewAspect
                          ? <WidgetPreviewScaler aspect={w.previewAspect}>{w.renderPreview({ widgetId: w.id, sizeKey: w.defaultSize, config: w.defaultConfig })}</WidgetPreviewScaler>
                          : w.renderPreview({ widgetId: w.id, sizeKey: w.defaultSize, config: w.defaultConfig }))
                      : null}
                  </div>
                  <div class="wlib-tile-badges">
                    {locked ? <span class="wlib-pill"><i class="fas fa-lock" /> Locked</span> : <span class="wlib-pill primary">{sizeLabel(w)}</span>}
                    {added ? <span class="wlib-pill success">Added</span> : null}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
