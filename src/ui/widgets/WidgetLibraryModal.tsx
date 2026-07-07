// src/ui/widgets/WidgetLibraryModal.tsx — the Widget Library: a wide two-pane modal
// (catalogue + detail panel) for adding, sizing, configuring, and previewing widgets.
// Custom scoped shell (the @ui Modal is too narrow for the two-pane layout); reuses @ui
// primitives inside. "Preview on board" emits an ephemeral preview and closes so the user
// can position it on the live page board.
import './widgetLibrary.css';
import { useRef, useState } from 'preact/hooks';
import type { JSX, VNode } from 'preact';
import type { PreviewWidgetInstance, WidgetDef, WidgetInstance, WidgetSizeKey } from './types';
import { allWidgets } from './registry';
import { useRuntimeWidgetsVersion, useInstalledWidgetPackages, useRefreshInstalledPackages } from './runtimeRegistry';
import { createWidgetInstance } from './createWidgetInstance';
import { createPreviewWidgetInstance } from './createPreviewWidgetInstance';
import { parseWidgetPackageFile } from './declarative/parsePackageFile';
import { installWidgetPackage, uninstallWidgetPackage } from '@api/widgets';
import { dialog } from '@lib/dialog';
import { toast } from '@store';
import { WidgetCatalog } from './WidgetCatalog';
import { WidgetDetailPanel } from './WidgetDetailPanel';
import { useMountReveal } from './motion';
import { WIDGET_BUNDLES, resolveBundleWidgets } from './bundles';

// ─── Bundles section ──────────────────────────────────────────────────────────
// Rendered at the TOP of the catalog pane (above the per-category widget tiles).
// Each bundle card shows: icon + title + description + "Add N widgets" button.
//
// Resolution logic (applied per bundle on every render):
//   1. Resolve registered ids   — `resolveBundleWidgets(bundle, registeredIds)`.
//   2. Filter already-placed   — skip ids in `placedIds`.
//   3. Filter locked            — skip ids in `lockedIds`.
//   4. If zero addable remain  — button is disabled (but card still renders so
//      the user sees what the bundle WOULD contain).
//
// Distinction from packages: see bundles.ts doc comment.

interface BundlesSectionProps {
  /** Full live WidgetDef list (code + runtime). */
  widgetDefs: WidgetDef[];
  placedIds: Set<string>;
  lockedIds: Set<string>;
  pageKey: string;
  zoneId: string;
  onAddWidget: (instance: WidgetInstance) => void | Promise<void>;
}

function BundlesSection({ widgetDefs, placedIds, lockedIds, pageKey, zoneId, onAddWidget }: BundlesSectionProps): VNode | null {
  const registeredIds = widgetDefs.map(d => d.id);

  // Only show bundles that have at least one currently registered widget id.
  // Bundles whose every member is a forward-reference (not yet shipped) are hidden
  // rather than shown disabled — they add no value to the UI yet.
  const visibleBundles = WIDGET_BUNDLES.filter(b => resolveBundleWidgets(b, registeredIds).length > 0);
  if (visibleBundles.length === 0) return null;

  function addBundle(bundleId: string): void {
    const bundle = WIDGET_BUNDLES.find(b => b.id === bundleId);
    if (!bundle) return;
    // Resolve the member defs: registered + not placed + not locked.
    for (const id of resolveBundleWidgets(bundle, registeredIds)) {
      if (placedIds.has(id) || lockedIds.has(id)) continue;
      const def = widgetDefs.find(d => d.id === id);
      if (!def) continue;
      void onAddWidget(createWidgetInstance({ widget: def, pageKey, zoneId, sizeKey: def.defaultSize, config: def.defaultConfig }));
    }
  }

  return (
    <section class="wlib-section wlib-bundles">
      <div class="wlib-section-head">
        <div>
          <h3>Bundles</h3>
          <p>Curated first-party sets — add several related widgets in one click.</p>
        </div>
        <span class="wlib-section-count">{visibleBundles.length} bundle{visibleBundles.length === 1 ? '' : 's'}</span>
      </div>
      <div class="wlib-bundles-grid">
        {visibleBundles.map(bundle => {
          const registered = resolveBundleWidgets(bundle, registeredIds);
          const addable = registered.filter(id => !placedIds.has(id) && !lockedIds.has(id));
          const disabled = addable.length === 0;
          return (
            <article key={bundle.id} class={`wlib-bundle-card${disabled ? ' disabled' : ''}`}>
              <div class="wlib-bundle-top">
                <span class="wlib-bundle-icon"><i class={`fas ${bundle.icon}`} /></span>
                <div class="wlib-bundle-copy">
                  <h4>{bundle.title}</h4>
                  <p>{bundle.description}</p>
                </div>
              </div>
              <div class="wlib-bundle-foot">
                <span class="wlib-bundle-meta">
                  {registered.length} widget{registered.length === 1 ? '' : 's'}
                  {disabled ? <span class="wlib-bundle-all-added"> · all added</span> : null}
                </span>
                <button
                  type="button"
                  class="wlib-btn wlib-btn-secondary wlib-bundle-btn"
                  disabled={disabled}
                  onClick={() => addBundle(bundle.id)}
                  title={
                    disabled
                      ? 'All widgets in this bundle are already on the board or locked'
                      : `Add ${addable.length} widget${addable.length === 1 ? '' : 's'}`
                  }
                >
                  <i class="fas fa-circle-plus" />
                  {disabled ? 'Added' : `Add ${addable.length} widget${addable.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export interface WidgetLibraryModalProps {
  open: boolean;
  pageKey: string;
  zoneId: string;
  /** Widget ids already on the page (shows an "Added" badge). */
  placedWidgetIds?: string[];
  /** When supplied, widgets whose dataSource.permissions aren't all held are locked. */
  userPermissions?: string[];
  /** Board demo-data toggle (sample data in every widget) — shown next to Live preview. */
  demo?: boolean;
  onToggleDemo?: () => void;
  /** Admin: show Install package / Manage (install + uninstall declarative .zip packages). */
  canManagePackages?: boolean;
  onClose: () => void;
  onAddWidget: (instance: WidgetInstance) => void | Promise<void>;
  onPreviewOnBoard: (preview: PreviewWidgetInstance) => void;
}

export function WidgetLibraryModal({
  open, pageKey, zoneId, placedWidgetIds = [], userPermissions, demo, onToggleDemo, canManagePackages,
  onClose, onAddWidget, onPreviewOnBoard,
}: WidgetLibraryModalProps): VNode | null {
  // ONE library across all pages — every registered widget is available everywhere;
  // `recommendedFor`/`supportedPages` only drives the "Recommended for this page" section.
  // Re-render when installed (declarative) packages change so they appear/disappear live.
  useRuntimeWidgetsVersion();
  const widgets = allWidgets();
  const [query, setQuery] = useState('');
  const [moduleF, setModuleF] = useState('');
  const [categoryF, setCategoryF] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(widgets[0]?.id ?? null);
  const [sizeKey, setSizeKey] = useState<WidgetSizeKey>(widgets[0]?.defaultSize ?? 'standard');
  const [config, setConfig] = useState<Record<string, unknown>>(widgets[0]?.defaultConfig ?? {});
  const [livePreview, setLivePreview] = useState(true);
  // Multi-select: check several widgets, then "Add N widgets" in one action.
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const shellRef = useMountReveal({ y: 14, duration: 0.26 });
  // Info popup shown after a widget is added.
  const [addedInfo, setAddedInfo] = useState<{ widget: WidgetDef } | null>(null);
  // Package install/manage state (admin).
  const fileRef = useRef<HTMLInputElement>(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const packagesQuery = useInstalledWidgetPackages();
  const refreshPackages = useRefreshInstalledPackages();

  async function onPackageFile(e: JSX.TargetedEvent<HTMLInputElement>): Promise<void> {
    const file = (e.currentTarget.files ?? [])[0];
    e.currentTarget.value = ''; // allow re-picking the same file
    if (!file) return;
    setInstallBusy(true);
    try {
      const manifest = await parseWidgetPackageFile(file);
      await installWidgetPackage(manifest);
      refreshPackages();
      void dialog.success('Package installed', `Installed "${manifest.name}" — ${manifest.widgets.length} widget${manifest.widgets.length === 1 ? '' : 's'}.`);
    } catch (err) {
      void dialog.error('Install failed', err instanceof Error ? err.message : 'Could not install the package.');
    } finally {
      setInstallBusy(false);
    }
  }
  async function onUninstall(id: string, name: string): Promise<void> {
    const ok = await dialog.confirm({ title: 'Uninstall package?', text: `Remove "${name}" and its widgets for everyone?`, danger: true, confirmText: 'Uninstall' });
    if (!ok) return;
    try {
      await uninstallWidgetPackage(id); refreshPackages();
      void toast.success(`Removed "${name}"`);
    } catch (err) {
      void dialog.error('Uninstall failed', err instanceof Error ? err.message : 'Could not uninstall.');
    }
  }

  if (!open) return null;

  const selected = widgets.find(w => w.id === selectedId) ?? null;
  const placedIds = new Set(placedWidgetIds);
  const lockedIds = new Set(
    widgets.filter(w => !!w.lockedReason || (userPermissions ? !w.dataSource.permissions.every(p => userPermissions.includes(p)) : false)).map(w => w.id),
  );
  // A widget already on the board can't be added again (one instance per page).
  const selectedAdded = selected ? placedIds.has(selected.id) : false;
  const canPlaceSelected = !!selected && !lockedIds.has(selected.id) && !selectedAdded;

  // Multi-select: only widgets that are checked AND actually addable (not already placed, not locked).
  const addable = [...checked].filter(id => !placedIds.has(id) && !lockedIds.has(id));
  function toggleChecked(id: string): void {
    setChecked(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function addCheckedWidgets(): void {
    for (const id of addable) {
      const w = widgets.find(x => x.id === id);
      if (w) void onAddWidget(createWidgetInstance({ widget: w, pageKey, zoneId, sizeKey: w.defaultSize, config: w.defaultConfig }));
    }
    setChecked(new Set());
  }

  const q = query.trim().toLowerCase();
  const filtered = widgets.filter(w => {
    const qOk = !q || [w.title, w.description, w.dataSource.label, ...w.tags].some(s => String(s).toLowerCase().includes(q));
    return qOk && (!moduleF || w.module === moduleF) && (!categoryF || w.category === categoryF);
  });
  const categories = Array.from(new Set(widgets.map(w => w.category)));
  const modules = Array.from(new Set(widgets.map(w => w.module)));

  function selectWidget(w: WidgetDef): void { setSelectedId(w.id); setSizeKey(w.defaultSize); setConfig({ ...w.defaultConfig }); }
  function handleAdd(): void {
    if (!canPlaceSelected) return;
    void onAddWidget(createWidgetInstance({ widget: selected!, pageKey, zoneId, sizeKey, config }));
    setAddedInfo({ widget: selected! });
  }
  function handlePreview(): void { if (canPlaceSelected) { onPreviewOnBoard(createPreviewWidgetInstance({ widget: selected!, pageKey, zoneId, sizeKey, config })); onClose(); } }

  return (
    <div class="wlib-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={shellRef} class="wlib-shell" role="dialog" aria-modal="true" aria-label="Widget Library">
        <header class="wlib-head">
          <span class="wlib-head-icon"><i class="fas fa-table-cells-large" /></span>
          <div class="wlib-head-copy"><h2>Widget Library</h2><p>Add, preview, size, and configure dashboard widgets.</p></div>
          <div class="wlib-head-actions">
            {/* Install/Manage live in the Add-widget dropdown; this hidden input is its file picker. */}
            {canManagePackages ? <input ref={fileRef} type="file" accept=".html,.htm,.zip,.json,.siowidget" style={{ display: 'none' }} onChange={e => void onPackageFile(e)} /> : null}
            <button type="button" class="wlib-btn wlib-btn-secondary" onClick={handlePreview}
              disabled={!canPlaceSelected}>
              <i class="fas fa-chart-line" /> Board preview
            </button>
            <button class="wlib-close" onClick={onClose} aria-label="Close"><i class="fas fa-xmark" /></button>
          </div>
        </header>

        <div class="wlib-filters">
          <div class="wlib-filters-top">
            <label class="wlib-control wlib-search">
              <i class="fas fa-magnifying-glass" />
              <input type="search" placeholder="Search widgets, data source, or tag..." value={query} onInput={e => setQuery((e.target as HTMLInputElement).value)} />
            </label>
            <div class="wlib-toggles">
              <button type="button" class={`wlib-toggle-chip${livePreview ? ' on' : ''}`} onClick={() => setLivePreview(v => !v)} aria-pressed={livePreview}>
                Live preview <span class="wlib-toggle-switch" aria-hidden="true" />
              </button>
              {onToggleDemo ? (
                <button type="button" class={`wlib-toggle-chip${demo ? ' on' : ''}`} onClick={onToggleDemo} aria-pressed={demo}
                  title="Temporarily fill every widget on the board with demo data">
                  Demo data <span class="wlib-toggle-switch" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
          <div class="wlib-chips" role="group" aria-label="Filter widgets by module and category">
            <button type="button" class={`wlib-chip${!moduleF && !categoryF ? ' on' : ''}`} onClick={() => { setModuleF(''); setCategoryF(''); }}>All</button>
            {modules.map(m => (
              <button type="button" key={m} class={`wlib-chip${moduleF === m ? ' on' : ''}`} onClick={() => setModuleF(moduleF === m ? '' : m)}>{m.toUpperCase()}</button>
            ))}
            {categories.length ? <span class="wlib-chip-sep" aria-hidden="true" /> : null}
            {categories.map(c => (
              <button type="button" key={c} class={`wlib-chip${categoryF === c ? ' on' : ''}`} onClick={() => setCategoryF(categoryF === c ? '' : c)}>{c}</button>
            ))}
          </div>
        </div>

        {/* Left-pane column: bundles section (first-party) then per-category catalog tiles. */}
        <div class="wlib-body">
          <div class="wlib-catalog-col">
            <BundlesSection
              widgetDefs={widgets}
              placedIds={placedIds}
              lockedIds={lockedIds}
              pageKey={pageKey}
              zoneId={zoneId}
              onAddWidget={onAddWidget}
            />
            <WidgetCatalog widgets={filtered} pageKey={pageKey} selectedWidgetId={selectedId} placedIds={placedIds} lockedIds={lockedIds} onSelect={selectWidget} checkedIds={checked} onToggleCheck={toggleChecked} />
          </div>
          <WidgetDetailPanel
            widget={selected} pageKey={pageKey} zoneId={zoneId} selectedSizeKey={sizeKey} config={config}
            locked={selected ? lockedIds.has(selected.id) : false} added={selectedAdded} livePreview={livePreview}
            canManagePackages={canManagePackages} installBusy={installBusy}
            onSizeChange={setSizeKey} onConfigChange={setConfig} onAddWidget={handleAdd}
            onInstallPackage={() => fileRef.current?.click()} onManagePackages={() => setManageOpen(true)}
          />
        </div>

        <footer class="wlib-foot">
          <div class="wlib-foot-left">
            <span class="wlib-foot-dot" />
            {widgets.length} widget{widgets.length === 1 ? '' : 's'} available · {placedIds.size} on this page · layout saved to ui_layout
          </div>
          <div class="wlib-foot-right">
            {addable.length > 0 ? (
              <button type="button" class="wlib-btn wlib-btn-primary wlib-btn-multi" onClick={addCheckedWidgets}>
                <i class="fas fa-circle-plus" /> Add {addable.length} widget{addable.length === 1 ? '' : 's'}
              </button>
            ) : null}
            <button type="button" class="wlib-btn wlib-btn-ghost" onClick={onClose}>Cancel</button>
            <button type="button" class={`wlib-btn ${addable.length > 0 ? 'wlib-btn-secondary' : 'wlib-btn-primary'}`} onClick={onClose}>Done</button>
          </div>
        </footer>

        {addedInfo ? (
          <div class="wlib-added-backdrop" onClick={e => { if (e.target === e.currentTarget) setAddedInfo(null); }}>
            <div class="wlib-added-pop" role="dialog" aria-modal="true">
              <header class="wlib-added-head">
                <span class="wlib-added-check"><i class="fas fa-circle-check" /></span>
                <span class="wlib-added-title">Widget added to the board</span>
                <button class="wlib-close" onClick={() => setAddedInfo(null)} aria-label="Close"><i class="fas fa-xmark" /></button>
              </header>
              <div class="wlib-added-body">
                <article class="wlib-added-card">
                  <div class="wlib-tile-top">
                    <span class="wlib-tile-icon"><i class={`fas ${addedInfo.widget.icon}`} /></span>
                    <div class="wlib-tile-title"><h3>{addedInfo.widget.title}</h3><p>{addedInfo.widget.description}</p></div>
                  </div>
                  <div class="wlib-tile-badges"><span class="wlib-pill primary">{addedInfo.widget.category}</span></div>
                </article>
              </div>
              <footer class="wlib-added-foot">
                <button type="button" class="wlib-btn wlib-btn-primary" onClick={() => setAddedInfo(null)}>Done</button>
              </footer>
            </div>
          </div>
        ) : null}

        {manageOpen ? (
          <div class="wlib-added-backdrop" onClick={e => { if (e.target === e.currentTarget) setManageOpen(false); }}>
            <div class="wlib-added-pop" role="dialog" aria-modal="true">
              <header class="wlib-added-head">
                <span class="wlib-added-check"><i class="fas fa-box-open" /></span>
                <span class="wlib-added-title">Installed packages</span>
                <button class="wlib-close" onClick={() => setManageOpen(false)} aria-label="Close"><i class="fas fa-xmark" /></button>
              </header>
              <div class="wlib-added-body">
                {(packagesQuery.data ?? []).length === 0 ? (
                  <p style={{ color: 'var(--wlib-muted)', fontSize: '13px', margin: 0 }}>No packages installed. Use "Install package" to add a .zip or .json widget file.</p>
                ) : (
                  <div class="wlib-pkg-list">
                    {(packagesQuery.data ?? []).map(pkg => (
                      <div key={pkg.id} class="wlib-pkg-row">
                        <div class="wlib-pkg-meta">
                          <strong>{pkg.name}</strong>
                          <small>v{pkg.version ?? '1.0.0'} · {pkg.widgets.length} widget{pkg.widgets.length === 1 ? '' : 's'}</small>
                        </div>
                        <button type="button" class="wlib-btn wlib-btn-ghost" onClick={() => void onUninstall(pkg.id, pkg.name)}>
                          <i class="fas fa-trash-can" /> Uninstall
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <footer class="wlib-added-foot">
                <button type="button" class="wlib-btn wlib-btn-primary" onClick={() => setManageOpen(false)}>Done</button>
              </footer>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
