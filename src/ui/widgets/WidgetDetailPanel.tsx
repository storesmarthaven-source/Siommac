import { useState } from 'preact/hooks';
import type { VNode } from 'preact';
import type { WidgetDef, WidgetSizeKey } from './types';
import { WidgetLivePreview } from './WidgetLivePreview';
import { WidgetConfigureModal } from './WidgetConfigureModal';
import { LucideIcon, type LucideName } from '../LucideIcon';

const WIDGET_ICONS: Record<string, LucideName> = {
  'fa-chart-column': 'ChartColumn', 'fa-chart-line': 'ChartSpline',
  'fa-rotate': 'RefreshCcw', 'fa-list-check': 'ListChecks',
};

function formatRefresh(ms?: number): string {
  if (!ms) return 'Manual';
  return `Every ${Math.round(ms / 60000)} min`;
}

export function WidgetDetailPanel({ widget, pageKey, zoneId, selectedSizeKey, config, locked, added, livePreview, onSizeChange, onConfigChange, onAddWidget, onPreviewOnBoard }: {
  widget: WidgetDef | null;
  pageKey: string;
  zoneId: string;
  selectedSizeKey: WidgetSizeKey;
  config: Record<string, unknown>;
  locked: boolean;
  added: boolean;
  livePreview: boolean;
  onSizeChange: (key: WidgetSizeKey) => void;
  onConfigChange: (config: Record<string, unknown>) => void;
  onAddWidget: () => void;
  onPreviewOnBoard: () => void;
}): VNode {
  const [activeTab, setActiveTab] = useState<'overview' | 'access' | 'settings'>('overview');
  const [configOpen, setConfigOpen] = useState(false);

  if (!widget) {
    return <aside class="wlib-inspector empty"><LucideIcon name="LayoutGrid" size={30} /><h2>Select a widget</h2><p>Choose an approved widget to inspect it.</p></aside>;
  }

  const permissions = widget.permissions?.requiredPermissions ?? widget.dataSource.permissions;
  const accessLabel = locked ? 'Restricted' : widget.runtimeState === 'static-preview' ? 'Preview only' : 'Authorized';
  const accessTone = locked ? 'gray' : widget.runtimeState === 'static-preview' ? 'amber' : 'green';
  const showLiveData = livePreview && widget.runtimeState !== 'static-preview';

  return (
    <aside class="wlib-inspector">
      <header class="wlib-inspect-head">
        <span class="wlib-widget-icon"><LucideIcon name={WIDGET_ICONS[widget.icon] ?? 'PanelsTopLeft'} size={19} strokeWidth={1.8} /></span>
        <div><h2>{widget.title}</h2><p>{widget.module.toUpperCase()} · {widget.category}</p></div>
      </header>
      <nav class="wlib-inspect-tabs" aria-label="Widget details">
        <button type="button" class={activeTab === 'overview' ? 'on' : ''} onClick={() => setActiveTab('overview')}>Overview</button>
        <button type="button" class={activeTab === 'access' ? 'on' : ''} onClick={() => setActiveTab('access')}>Data &amp; access</button>
        <button type="button" class={activeTab === 'settings' ? 'on' : ''} onClick={() => setActiveTab('settings')}>Settings</button>
      </nav>
      <div class="wlib-inspect-body">
        {activeTab === 'overview' ? <>
          <section class="wlib-preview-card">
            <div class="wlib-preview-card-top"><span>{showLiveData ? 'Live preview' : 'Static preview'}</span><span class={`wlib-pill ${accessTone}`}>{accessLabel}</span></div>
            <div class={`wlib-inspector-preview${widget.previewAspect ? '' : ' natural-size'}`}><WidgetLivePreview widget={widget} config={config} sizeKey={selectedSizeKey} pageKey={pageKey} zoneId={zoneId} live={showLiveData} showHeader={false} /></div>
          </section>
          <section class="wlib-panel"><h3>Widget information</h3><div class="wlib-detail-list">
            <div><span>Data source</span><strong>{widget.dataSource.label}</strong></div>
            <div><span>View permission</span><strong>{permissions.join(', ') || 'Page access'}</strong></div>
            <div><span>Refresh</span><strong>{formatRefresh(widget.dataSource.refreshIntervalMs)}</strong></div>
            <div><span>Supported pages</span><strong>{widget.supportedPages.join(' · ') || 'Application-wide'}</strong></div>
            <div><span>Available sizes</span><strong>{widget.allowedSizes.map(size => size.label).join(' · ')}</strong></div>
          </div></section>
        </> : null}

        {activeTab === 'access' ? <>
          <section class="wlib-panel"><h3>Data &amp; access</h3><div class="wlib-detail-list">
            <div><span>Source key</span><strong>{widget.dataSource.sourceKey}</strong></div>
            <div><span>Permissions</span><strong>{permissions.join(', ') || 'Page access'}</strong></div>
            <div><span>Dependencies</span><strong>{widget.dataSource.dependencies?.map(item => item.label).join(', ') || 'None'}</strong></div>
            <div><span>Record scope</span><strong>Enforced by authenticated server API</strong></div>
            <div><span>Realtime</span><strong>Invalidation and refetch only</strong></div>
          </div></section>
        </> : null}

        {activeTab === 'settings' ? <>
          <section class="wlib-panel"><h3>Available sizes</h3><div class="wlib-size-options">
            {widget.allowedSizes.map(size => <button type="button" key={size.key} class={selectedSizeKey === size.key ? 'on' : ''} onClick={() => onSizeChange(size.key)}><strong>{size.label}</strong><span>{size.grid.w} × {size.grid.h}</span></button>)}
          </div></section>
          <section class="wlib-panel"><h3>Widget settings</h3><div class="wlib-settings-copy"><p>{widget.configSchema.length ? 'Configure the options declared by this widget.' : 'This widget has no configurable options.'}</p><button type="button" class="wlib-btn" disabled={!widget.configSchema.length} onClick={() => setConfigOpen(true)}>Configure widget</button></div></section>
        </> : null}

        <div class={`wlib-access-note ${accessTone}`}><strong>{locked ? 'Access restricted' : 'Access verified'}</strong>{locked ? widget.lockedReason ?? 'The current user cannot mount this widget.' : 'The widget may mount for your current permissions. Its API still enforces record and organizational scope.'}</div>
      </div>
      <footer class="wlib-inspect-actions">
        <button type="button" class="wlib-btn" onClick={onPreviewOnBoard} disabled={locked || added}><LucideIcon name="Eye" size={15} /> Preview on board</button>
        <button type="button" class="wlib-btn primary" onClick={onAddWidget} disabled={locked || added}><LucideIcon name={added ? 'Check' : 'Plus'} size={15} /> {added ? 'On this page' : 'Add to board'}</button>
      </footer>
      {configOpen ? <WidgetConfigureModal open widget={widget} config={config} sizeKey={selectedSizeKey} pageKey={pageKey} zoneId={zoneId} onClose={() => setConfigOpen(false)} onSave={next => { onConfigChange(next); setConfigOpen(false); }} /> : null}
    </aside>
  );
}
