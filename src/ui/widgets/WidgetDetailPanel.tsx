// src/ui/widgets/WidgetDetailPanel.tsx — right-hand detail pane (ported from the v4
// prototype): live preview, size selector, data-source metadata, the dense-grid notice,
// and the Add widget / Configure actions. (Board preview lives in the modal header.)
import { useState, useRef } from 'preact/hooks';
import type { VNode } from 'preact';
import { DetailGrid, EmptyState } from '@ui';
import type { WidgetDef, WidgetSizeKey } from './types';
import { WidgetSizeSelector } from './WidgetSizeSelector';
import { WidgetLivePreview } from './WidgetLivePreview';
import { WidgetConfigureModal } from './WidgetConfigureModal';

function formatRefresh(ms?: number): string {
  if (!ms) return 'Manual';
  return `Every ${Math.round(ms / 60000)} min`;
}

export function WidgetDetailPanel({ widget, pageKey, zoneId, selectedSizeKey, config, locked, added, livePreview, canManagePackages, installBusy, onSizeChange, onConfigChange, onAddWidget, onInstallPackage, onManagePackages }: {
  widget: WidgetDef | null; pageKey: string; zoneId: string; selectedSizeKey: WidgetSizeKey;
  config: Record<string, unknown>; locked: boolean; added: boolean; livePreview: boolean;
  canManagePackages?: boolean; installBusy?: boolean;
  onSizeChange: (key: WidgetSizeKey) => void; onConfigChange: (config: Record<string, unknown>) => void;
  onAddWidget: () => void; onInstallPackage?: () => void; onManagePackages?: () => void;
}): VNode {
  const [configOpen, setConfigOpen] = useState(false);
  const [pkgMenuOpen, setPkgMenuOpen] = useState(false);
  const caretRef = useRef<HTMLButtonElement>(null);
  // Fixed-position coords so the menu escapes the detail pane's scroll/overflow clipping.
  const [menuPos, setMenuPos] = useState<{ bottom: number; right: number } | null>(null);

  function togglePkgMenu(): void {
    if (pkgMenuOpen) { setPkgMenuOpen(false); return; }
    const r = caretRef.current?.getBoundingClientRect();
    if (r) setMenuPos({ bottom: Math.round(window.innerHeight - r.top + 6), right: Math.round(window.innerWidth - r.right) });
    setPkgMenuOpen(true);
  }

  if (!widget) {
    return (
      <div class="wlib-detail" style={{ display: 'grid', placeItems: 'center', padding: '24px' }}>
        <EmptyState icon="fa-table-cells-large" title="Select a widget" text="Choose a widget to preview, size, and add." />
      </div>
    );
  }

  return (
    <div class="wlib-detail">
      <header class="wlib-detail-head">
        <span class="wlib-tile-icon"><i class={`fas ${widget.icon}`} /></span>
        <div>
          <h2>{widget.title}</h2>
          <p>{widget.recommendedFor?.includes(pageKey) ? 'Recommended · ' : ''}{widget.category}</p>
        </div>
      </header>

      <div class="wlib-detail-body">
        <WidgetLivePreview widget={widget} config={config} sizeKey={selectedSizeKey} pageKey={pageKey} zoneId={zoneId} live={livePreview} />

        <WidgetSizeSelector widget={widget} selectedSizeKey={selectedSizeKey} onChange={onSizeChange} />

        <DetailGrid items={[
          { icon: 'fa-database', label: 'Data source', value: widget.dataSource.label },
          { icon: 'fa-rotate', label: 'Refresh', value: formatRefresh(widget.dataSource.refreshIntervalMs) },
          { icon: 'fa-layer-group', label: 'Category', value: widget.category },
        ]} />

        {widget.dataSource.dependencies?.length ? (
          <div class="wlib-deps"><strong>Dependencies</strong>{widget.dataSource.dependencies.map(d => d.label).join(', ')}</div>
        ) : null}

        {locked ? (
          <div class="wlib-deps" style={{ borderColor: '#ffd1d6', background: 'var(--wlib-danger-soft)', color: 'var(--wlib-danger)' }}>
            <strong>Locked</strong>{widget.lockedReason ?? 'You do not have permission for this widget.'}
          </div>
        ) : added ? (
          <div class="wlib-deps" style={{ borderColor: '#ccefdc', background: 'var(--wlib-success-soft)', color: 'var(--wlib-success)' }}>
            <strong>Already on this page</strong>This widget is already on the board — remove it there to add it again.
          </div>
        ) : (
          <div class="wlib-notice">
            <i class="fas fa-circle-info" aria-hidden="true" />
            <div>This version uses dense grid placement and widget-size classes so previews do not compress into the wrong size or leave large empty gaps.</div>
          </div>
        )}

        <div class="wlib-actions">
          <div class="wlib-split">
            <button type="button" class="wlib-btn wlib-btn-primary wlib-split-main" onClick={onAddWidget} disabled={locked || added}>{added ? 'Added' : 'Add widget'}</button>
            {canManagePackages ? (
              <button ref={caretRef} type="button" class="wlib-btn wlib-btn-primary wlib-split-caret" aria-label="Package options" aria-expanded={pkgMenuOpen} onClick={togglePkgMenu}>
                <i class="fas fa-chevron-down" />
              </button>
            ) : null}
            {pkgMenuOpen && menuPos ? (
              <>
                <div class="wlib-split-scrim" onClick={() => setPkgMenuOpen(false)} />
                <div class="wlib-split-menu" style={{ position: 'fixed', bottom: `${menuPos.bottom}px`, right: `${menuPos.right}px`, left: 'auto', top: 'auto' }}>
                  <button type="button" class="wlib-split-item" onClick={() => { setPkgMenuOpen(false); onInstallPackage?.(); }}>
                    <i class={`fas ${installBusy ? 'fa-spinner fa-spin' : 'fa-file-arrow-up'}`} />
                    <span class="wlib-split-text"><strong>Install package</strong><small>Add widgets from a .zip or .html file</small></span>
                  </button>
                  <button type="button" class="wlib-split-item" onClick={() => { setPkgMenuOpen(false); onManagePackages?.(); }}>
                    <i class="fas fa-box-open" />
                    <span class="wlib-split-text"><strong>Manage packages</strong><small>View or remove installed packages</small></span>
                  </button>
                </div>
              </>
            ) : null}
          </div>
          <button type="button" class="wlib-btn wlib-btn-secondary" onClick={() => setConfigOpen(true)} disabled={widget.configSchema.length === 0}>Configure</button>
        </div>
      </div>

      {configOpen && (
        <WidgetConfigureModal
          open widget={widget} config={config} sizeKey={selectedSizeKey} pageKey={pageKey} zoneId={zoneId}
          onClose={() => setConfigOpen(false)}
          onSave={c => { onConfigChange(c); setConfigOpen(false); }}
        />
      )}
    </div>
  );
}
