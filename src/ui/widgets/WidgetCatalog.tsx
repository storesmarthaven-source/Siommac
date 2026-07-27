import type { VNode } from 'preact';
import { useState } from 'preact/hooks';
import type { WidgetDef } from './types';
import { WidgetPreviewScaler } from './WidgetPreviewScaler';
import { resolveWidgetAccess } from './access';
import { can } from '@lib/permissions';
import { LucideIcon } from '../LucideIcon';
import { availableWidgetModules, widgetModuleMeta } from './catalogueTaxonomy';

const STATE_LABEL = {
  'live-api': 'Live API', 'static-preview': 'Static preview', restricted: 'Restricted',
  'action-gated': 'Action gated', disabled: 'Disabled', missing: 'Missing',
} as const;

function stateTone(state: keyof typeof STATE_LABEL): string {
  if (state === 'live-api') return 'green';
  if (state === 'static-preview' || state === 'action-gated') return 'amber';
  // restricted / disabled / missing all resolve to gray — same as the exhaustive default.
  return 'gray';
}

function defaultGridArea(widget: WidgetDef): number {
  const size = widget.allowedSizes.find(candidate => candidate.key === widget.defaultSize) ?? widget.allowedSizes[0];
  return size ? size.grid.w * size.grid.h : 0;
}

function catalogueFootprint(widget: WidgetDef): 'compact' | 'wide' {
  // Catalogue density is a presentation concern, not a mirror of the board footprint.
  // Landscape designs use two catalogue columns; all other designs use one.
  return (widget.previewAspect ?? 1) >= 1.55 ? 'wide' : 'compact';
}

function slug(value: string): string { return value.replace(/[^a-z0-9]+/gi, '-').toLowerCase(); }

function WidgetTile({ widget, pageKey, selected, added, locked, multiSelect, multiSelected, onSelect, onToggleMulti, onPreview, onAdd }: {
  widget: WidgetDef;
  pageKey: string;
  selected: boolean;
  added: boolean;
  locked: boolean;
  multiSelect: boolean;
  multiSelected: boolean;
  onSelect: (widget: WidgetDef) => void;
  onToggleMulti: (widget: WidgetDef) => void;
  onPreview: (widget: WidgetDef) => void;
  onAdd: (widget: WidgetDef) => void;
}): VNode {
  const access = resolveWidgetAccess(widget, { pageKey, has: can });
  const selfContained = widget.chrome === 'none' && !!widget.renderPreview;
  const footprint = catalogueFootprint(widget);
  const unavailable = locked || added;
  const activate = (): void => multiSelect ? onToggleMulti(widget) : onSelect(widget);

  return (
    <article
      data-widget-id={widget.id}
      class={`wlib-widget${selfContained ? ' self-contained' : ''} catalogue-${footprint}${selected ? ' selected' : ''}${multiSelected ? ' multi-selected' : ''}${locked ? ' locked' : ''}${added ? ' added' : ''}`}
      aria-label={`${widget.title}. ${STATE_LABEL[access.state]}`}
    >
      {!selfContained ? <div class="wlib-widget-top">
        <span class="wlib-widget-icon"><LucideIcon name="PanelsTopLeft" size={18} strokeWidth={1.8} /></span>
        <div><h3>{widget.title}</h3><p>{widget.description}</p></div>
        <span class={`wlib-status-dot ${stateTone(access.state)}`} aria-hidden="true" />
      </div> : null}
      <div class="wlib-widget-preview" role="button" tabIndex={unavailable ? -1 : 0} aria-disabled={unavailable}
        aria-label={`${multiSelect ? 'Select' : 'Inspect'} ${widget.title}`}
        onClick={() => { if (!unavailable) activate(); }}
        onKeyDown={event => { if ((event.key === 'Enter' || event.key === ' ') && !unavailable) { event.preventDefault(); activate(); } }}>
        {widget.renderPreview
          ? (widget.previewAspect
              ? <WidgetPreviewScaler aspect={widget.previewAspect} constraints={widget.sizeConstraints}>{widget.renderPreview({ widgetId: widget.id, sizeKey: widget.defaultSize, config: widget.defaultConfig })}</WidgetPreviewScaler>
              : widget.renderPreview({ widgetId: widget.id, sizeKey: widget.defaultSize, config: widget.defaultConfig }))
          : <div class="wlib-preview-empty"><LucideIcon name="ImageOff" size={17} /><span>Preview unavailable</span></div>}
      </div>
      {!selfContained ? <div class="wlib-widget-meta">
        <span class="wlib-pill blue">{widgetModuleMeta(widget.module).label}</span>
        <span class={`wlib-pill ${stateTone(access.state)}`}>{STATE_LABEL[access.state]}</span>
      </div> : null}
      {multiSelect ? <footer class="wlib-card-selection-state">
        <button type="button" class="wlib-multi-check" aria-label={`${multiSelected ? 'Deselect' : 'Select'} ${widget.title}`} aria-pressed={multiSelected} disabled={unavailable} onClick={() => onToggleMulti(widget)}>
          {multiSelected ? <LucideIcon name="Check" size={13} strokeWidth={3} /> : null}
        </button>
        <span>{added ? 'Already on this page' : locked ? 'Unavailable' : multiSelected ? 'Selected' : 'Select this widget'}</span>
      </footer> : <footer class="wlib-card-actions">
        <button type="button" class="wlib-btn" disabled={unavailable} onClick={() => onPreview(widget)}><LucideIcon name="Eye" size={15} /> Preview on board</button>
        <button type="button" class="wlib-btn primary" disabled={unavailable} onClick={() => onAdd(widget)}><LucideIcon name={added ? 'Check' : 'Plus'} size={15} /> {added ? 'Added' : 'Add widget'}</button>
      </footer>}
    </article>
  );
}

export function WidgetCatalog({ widgets, pageKey, heading = 'Approved widgets', subheading, selectedWidgetId, placedIds, lockedIds, multiSelect = false, multiSelectedIds = new Set<string>(), onSelect, onToggleMulti, onPreview, onAdd }: {
  widgets: WidgetDef[];
  pageKey: string;
  heading?: string;
  subheading?: string;
  selectedWidgetId: string | null;
  placedIds: Set<string>;
  lockedIds: Set<string>;
  multiSelect?: boolean;
  multiSelectedIds?: Set<string>;
  onSelect: (widget: WidgetDef) => void;
  onToggleMulti: (widget: WidgetDef) => void;
  onPreview: (widget: WidgetDef) => void;
  onAdd: (widget: WidgetDef) => void;
}): VNode {
  const catalogueStates = widgets.map(widget => resolveWidgetAccess(widget, { pageKey, has: can }).state);
  const allStaticPreviews = catalogueStates.length > 0 && catalogueStates.every(state => state === 'static-preview');
  const orderedWidgets = [...widgets].sort((a, b) => defaultGridArea(a) - defaultGridArea(b));
  const modules = availableWidgetModules(orderedWidgets);
  const [collapsedModules, setCollapsedModules] = useState<string[]>([]);

  return (
    <section class="wlib-catalogue-section">
      <header class="wlib-section-line">
        <div><h2>{heading}</h2>{subheading ? <p>{subheading}</p> : null}</div>
        <span>{widgets.length} available · {allStaticPreviews ? 'Static design previews' : 'Live data unless marked otherwise'}</span>
      </header>
      {widgets.length === 0 ? <div class="wlib-catalogue-empty"><LucideIcon name="LayoutGrid" size={28} /><h3>No widgets approved</h3><p>No widgets match the current module, subcategory, and search filters.</p></div> : null}
      {modules.map(module => {
        const moduleWidgets = orderedWidgets.filter(widget => widget.module === module.key);
        const collapsed = collapsedModules.includes(module.key);
        const areas = Array.from(new Set(moduleWidgets.map(widget => widget.area)));
        return <section class="wlib-module-group" key={module.key} aria-labelledby={`wlib-module-${module.key}`}>
          <button type="button" class="wlib-module-head" aria-expanded={!collapsed} onClick={() => setCollapsedModules(current => current.includes(module.key) ? current.filter(key => key !== module.key) : [...current, module.key])}>
            <span class="wlib-module-icon"><LucideIcon name={module.icon} size={17} /></span>
            <span><strong id={`wlib-module-${module.key}`}>{module.label}</strong><small>{moduleWidgets.length} widget{moduleWidgets.length === 1 ? '' : 's'}</small></span>
            <LucideIcon name={collapsed ? 'ChevronDown' : 'ChevronUp'} size={16} />
          </button>
          {!collapsed ? <div class="wlib-module-content">
            {areas.map(area => {
              const areaWidgets = moduleWidgets.filter(widget => widget.area === area);
              const categories = Array.from(new Set(areaWidgets.map(widget => widget.category)));
              return <section class="wlib-area-group" key={area} aria-labelledby={`wlib-area-${slug(`${module.key}-${area}`)}`}>
                <header class="wlib-area-head"><h3 id={`wlib-area-${slug(`${module.key}-${area}`)}`}>{area}</h3><span>{areaWidgets.length}</span></header>
                {categories.map(category => {
                  const categoryWidgets = areaWidgets.filter(widget => widget.category === category);
                  return <section class="wlib-category" key={category} aria-labelledby={`wlib-category-${slug(`${module.key}-${area}-${category}`)}`}>
                    <header class="wlib-category-head"><h4 id={`wlib-category-${slug(`${module.key}-${area}-${category}`)}`}>{category}</h4><span>{categoryWidgets.length} widget{categoryWidgets.length === 1 ? '' : 's'}</span></header>
                    <div class="wlib-cards">
                      {categoryWidgets.map(widget => <WidgetTile key={widget.id} widget={widget} pageKey={pageKey}
                        selected={selectedWidgetId === widget.id} added={placedIds.has(widget.id)} locked={lockedIds.has(widget.id)}
                        multiSelect={multiSelect} multiSelected={multiSelectedIds.has(widget.id)} onSelect={onSelect}
                        onToggleMulti={onToggleMulti} onPreview={onPreview} onAdd={onAdd} />)}
                    </div>
                  </section>;
                })}
              </section>;
            })}
          </div> : null}
        </section>;
      })}
    </section>
  );
}
