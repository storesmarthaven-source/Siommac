// src/ui/widgets/WidgetLibraryModal.tsx — the Widget Library: a wide two-pane modal
// (catalogue + detail panel) for adding, sizing, configuring, and previewing widgets.
// Custom scoped shell (the @ui Modal is too narrow for the two-pane layout); reuses @ui
// primitives inside. "Preview on board" emits an ephemeral preview and closes so the user
// can position it on the live page board.
import './widgetLibrary.css';
import { useRef, useState } from 'preact/hooks';
import type { VNode, TargetedEvent } from 'preact';
import type { ModuleKey, PreviewWidgetInstance, WidgetDef, WidgetInstance, WidgetSizeKey } from './types';
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
import { can } from '@lib/permissions';
import { effectiveWidgetPolicy, isWidgetDiscoverable, normalizePageKey } from './governance';
import { listWidgetDataSources } from './dataSources';
import { availableWidgetModules, widgetAreas } from './catalogueTaxonomy';
import { requestWidgetBoardReveal } from './boardReveal';
import {
  ActiveFilters, FilterDropdown, LucideIcon, TableSearch, useFilterDropdowns,
  type LucideName,
} from '@ui';

type LibraryView = 'catalogue' | 'recommended' | 'bundles' | 'layouts' | 'packages' | 'governance' | 'sources';
const supportsPage = (pages: string[] | undefined, pageKey: string): boolean =>
  !!pages?.length && (pages.includes('*')
    || pages.some(page => normalizePageKey(page) === normalizePageKey(pageKey)));

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
  onAddWidgets: (instances: WidgetInstance[]) => void | Promise<void>;
}

function BundlesSection({ widgetDefs, placedIds, lockedIds, pageKey, zoneId, onAddWidgets }: BundlesSectionProps): VNode | null {
  const registeredIds = widgetDefs.map(d => d.id);

  // Only show bundles that have at least one currently registered widget id.
  // Bundles whose every member is a forward-reference (not yet shipped) are hidden
  // rather than shown disabled — they add no value to the UI yet.
  const visibleBundles = WIDGET_BUNDLES.filter(b => supportsPage(b.supportedPages, pageKey) && resolveBundleWidgets(b, registeredIds).length > 0);
  if (visibleBundles.length === 0) return null;

  function addBundle(bundleId: string): void {
    const bundle = WIDGET_BUNDLES.find(b => b.id === bundleId);
    if (!bundle) return;
    // Resolve the member defs: registered + not placed + not locked.
    const instances: WidgetInstance[] = [];
    for (const id of resolveBundleWidgets(bundle, registeredIds)) {
      if (placedIds.has(id) || lockedIds.has(id)) continue;
      const def = widgetDefs.find(d => d.id === id);
      if (!def) continue;
      instances.push(createWidgetInstance({ widget: def, pageKey, zoneId, sizeKey: def.defaultSize, config: def.defaultConfig }));
    }
    if (instances.length) void onAddWidgets(instances);
  }

  return (
    <section class="wlib-section wlib-bundles">
      <div class="wlib-section-head">
        <div>
          <h3>Recommended for this page</h3>
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
                <span class="wlib-bundle-icon"><LucideIcon name="Layers3" size={18} /></span>
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
                  <LucideIcon name="CirclePlus" size={15} />
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
  onAddWidgets: (instances: WidgetInstance[]) => void | Promise<void>;
  onPreviewOnBoard: (preview: PreviewWidgetInstance) => void;
}

export function WidgetLibraryModal({
  open, pageKey, zoneId, placedWidgetIds = [], userPermissions,
  onClose, onAddWidget, onAddWidgets, onPreviewOnBoard,
}: WidgetLibraryModalProps): VNode | null {
  // ONE library across all pages — every registered widget is available everywhere;
  // `recommendedFor`/`supportedPages` only drives the "Recommended for this page" section.
  // Re-render when installed (declarative) packages change so they appear/disappear live.
  useRuntimeWidgetsVersion();
  const widgets = allWidgets();
  const [query, setQuery] = useState('');
  const [categoryFilters, setCategoryFilters] = useState<string[]>([]);
  const { openId: filterOpenId, setOpenId: setFilterOpenId } = useFilterDropdowns();
  const [activeModule, setActiveModule] = useState<ModuleKey | null>(null);
  const [activeArea, setActiveArea] = useState<string | null>(null);
  const [expandedModules, setExpandedModules] = useState<ModuleKey[]>(() => availableWidgetModules(widgets).map(module => module.key));
  const [multiSelect, setMultiSelect] = useState(false);
  const [multiSelectedIds, setMultiSelectedIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(widgets[0]?.id ?? null);
  const [sizeKey, setSizeKey] = useState<WidgetSizeKey>(widgets[0]?.defaultSize ?? 'standard');
  const [config, setConfig] = useState<Record<string, unknown>>(widgets[0]?.defaultConfig ?? {});
  const [activeView, setActiveView] = useState<LibraryView>('catalogue');
  const packageManager = can('ui.widgets.packages.manage');
  const packageViewer = packageManager || can('ui.widgets.packages.view');
  const shellRef = useMountReveal({ y: 14, duration: 0.26 });
  // Package install/manage state (admin).
  const fileRef = useRef<HTMLInputElement>(null);
  const [installBusy, setInstallBusy] = useState(false);
  const packagesQuery = useInstalledWidgetPackages();
  const refreshPackages = useRefreshInstalledPackages();

  async function onPackageFile(e: TargetedEvent<HTMLInputElement>): Promise<void> {
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
  const lockedIds = new Set(widgets.filter(w =>
    !!w.lockedReason || effectiveWidgetPolicy(w).state === 'disabled'
    || (userPermissions ? !w.dataSource.permissions.every(p => userPermissions.includes(p)) : false),
  ).map(w => w.id));
  // A widget already on the board can't be added again (one instance per page).
  const selectedAdded = selected ? placedIds.has(selected.id) : false;
  const canPlaceSelected = !!selected && !lockedIds.has(selected.id) && !selectedAdded;

  const q = query.trim().toLowerCase();
  const filtered = widgets.filter(w => {
    const qOk = !q || [w.title, w.description, w.dataSource.label, ...w.tags].some(s => s.toLowerCase().includes(q));
    const viewOk = activeView === 'recommended' ? (supportsPage(w.recommendedFor, pageKey) || (!w.recommendedFor?.length && supportsPage(w.supportedPages, pageKey)))
      : activeView === 'layouts' ? placedIds.has(w.id) : true;
    return isWidgetDiscoverable(w, pageKey, can) && viewOk && qOk
      && (!activeModule || w.module === activeModule)
      && (!activeArea || w.area === activeArea)
      && (!categoryFilters.length || categoryFilters.includes(w.category));
  });
  const categories = Array.from(new Set(widgets.map(w => w.category)));
  const discoverableWidgets = widgets.filter(widget => isWidgetDiscoverable(widget, pageKey, can));
  const browseModules = availableWidgetModules(discoverableWidgets);
  const activeFilterChips = [
    ...categoryFilters.map(value => ({ label: value, onRemove: () => setCategoryFilters(categoryFilters.filter(item => item !== value)) })),
  ];
  const clearFilters = (): void => setCategoryFilters([]);
  const navigation: { id: LibraryView; label: string; icon: LucideName }[] = [
    { id: 'catalogue', label: 'Catalogue', icon: 'LayoutGrid' },
    { id: 'recommended', label: 'Recommended', icon: 'Sparkles' },
    { id: 'bundles', label: 'Bundles', icon: 'Layers3' },
    { id: 'layouts', label: 'My layouts', icon: 'PanelTop' },
    ...(packageViewer ? [{ id: 'packages' as const, label: 'Installed packages', icon: 'PackageOpen' as const }] : []),
    ...(can('ui.widgets.governance.view') ? [{ id: 'governance' as const, label: 'Governance', icon: 'ShieldCheck' as const }] : []),
    ...(can('ui.widgets.sources.view') ? [{ id: 'sources' as const, label: 'Data Sources', icon: 'Database' as const }] : []),
  ];
  const pageLabel = pageKey.split(/[./:_-]+/).filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  const navGroups = [
    { label: 'Discover', ids: ['catalogue', 'recommended', 'bundles'] as LibraryView[] },
    { label: 'Manage', ids: ['layouts', 'packages'] as LibraryView[] },
    { label: 'Administration', ids: ['governance', 'sources'] as LibraryView[] },
  ];
  const governanceRows = widgets.map(widget => ({ widget, policy: effectiveWidgetPolicy(widget) }));
  const governanceEnabled = governanceRows.filter(row => row.policy.state === 'enabled').length;
  const governanceRestricted = governanceRows.filter(row => (row.policy.requiredCapabilities?.length ?? 0) > 0 || row.policy.hidden).length;
  const governanceReview = governanceRows.filter(row => row.policy.state === 'preview').length;
  const registeredSources = listWidgetDataSources();

  function selectWidget(w: WidgetDef): void { setSelectedId(w.id); setSizeKey(w.defaultSize); setConfig({ ...w.defaultConfig }); }
  function toggleMultiWidget(widget: WidgetDef): void {
    if (lockedIds.has(widget.id) || placedIds.has(widget.id)) return;
    setMultiSelectedIds(current => current.includes(widget.id) ? current.filter(id => id !== widget.id) : [...current, widget.id]);
  }
  function leaveMultiSelect(): void { setMultiSelect(false); setMultiSelectedIds([]); }
  async function requestClose(): Promise<void> {
    if (multiSelect && multiSelectedIds.length) {
      const discard = await dialog.confirm({ title: 'Discard widget selection?', text: `${multiSelectedIds.length} selected widget${multiSelectedIds.length === 1 ? '' : 's'} have not been added.`, confirmText: 'Discard selection', danger: false });
      if (!discard) return;
    }
    leaveMultiSelect();
    onClose();
  }
  async function addSingle(widget: WidgetDef, nextSize = widget.defaultSize, nextConfig = widget.defaultConfig): Promise<void> {
    if (lockedIds.has(widget.id) || placedIds.has(widget.id)) return;
    const instance = createWidgetInstance({ widget, pageKey, zoneId, sizeKey: nextSize, config: nextConfig });
    await onAddWidget(instance);
    onClose();
    requestAnimationFrame(() => requestWidgetBoardReveal({ pageKey, zoneId, instanceIds: [instance.instanceId] }));
  }
  function previewWidget(widget: WidgetDef, nextSize = widget.defaultSize, nextConfig = widget.defaultConfig): void {
    if (lockedIds.has(widget.id) || placedIds.has(widget.id)) return;
    const instance = createPreviewWidgetInstance({ widget, pageKey, zoneId, sizeKey: nextSize, config: nextConfig });
    onPreviewOnBoard(instance);
    onClose();
    requestAnimationFrame(() => requestWidgetBoardReveal({ pageKey, zoneId, instanceIds: [instance.instanceId] }));
  }
  async function addBatch(instances: WidgetInstance[]): Promise<void> {
    if (!instances.length) return;
    await onAddWidgets(instances);
    leaveMultiSelect();
    onClose();
    requestAnimationFrame(() => requestWidgetBoardReveal({ pageKey, zoneId, instanceIds: instances.map(instance => instance.instanceId) }));
  }
  /** Copies the multi-selected widgets as `id — Title` lines, for curating the catalogue: pick
   *  the ones to retire, paste the list, and the registry entries can be removed by id. Titles
   *  ride along so the list stays readable and a wrong id is obvious before anything is deleted. */
  function copySelectedIds(): void {
    const chosen = widgets.filter(widget => multiSelectedIds.includes(widget.id));
    if (!chosen.length) return;
    const text = chosen.map(widget => `${widget.id} — ${widget.title}`).join('\n');
    void navigator.clipboard.writeText(text)
      .then(() => toast.success(`${chosen.length} widget id${chosen.length === 1 ? '' : 's'} copied.`))
      .catch(() => toast.error('Widget ids could not be copied.'));
  }

  async function handleAddSelected(): Promise<void> {
    const selectedWidgets = widgets.filter(widget => multiSelectedIds.includes(widget.id) && !lockedIds.has(widget.id) && !placedIds.has(widget.id));
    if (!selectedWidgets.length) return;
    const instances = selectedWidgets.map(widget => createWidgetInstance({ widget, pageKey, zoneId, sizeKey: widget.defaultSize, config: widget.defaultConfig }));
    await addBatch(instances);
  }
  function handleAdd(): void {
    if (!canPlaceSelected) return;
    void addSingle(selected, sizeKey, config);
  }
  function handlePreview(): void { if (canPlaceSelected) previewWidget(selected, sizeKey, config); }

  return (
    <div class="wlib-backdrop" onClick={e => { if (e.target === e.currentTarget) void requestClose(); }}>
      <div ref={shellRef} class="wlib-shell" role="dialog" aria-modal="true" aria-label="Widget Library">
        <header class="wlib-head">
          <span class="wlib-head-icon"><LucideIcon name="LayoutDashboard" size={18} strokeWidth={1.8} /></span>
          <div class="wlib-head-copy">
            <div class="wlib-title-line"><h2>Widget Library</h2></div>
            <p>Add approved widgets to {pageLabel || pageKey}.</p>
          </div>
          <div class="wlib-head-actions">
            {/* Install/Manage live in the Add-widget dropdown; this hidden input is its file picker. */}
            {packageManager ? <input ref={fileRef} type="file" accept=".html,.htm,.zip,.json,.siowidget" style={{ display: 'none' }} onChange={e => void onPackageFile(e)} /> : null}
            <button class="wlib-close" onClick={() => void requestClose()} aria-label="Close"><LucideIcon name="X" size={18} /></button>
          </div>
        </header>

        {/* Left-pane column: bundles section (first-party) then per-category catalog tiles. */}
        <div class="wlib-body wlib-body-v3">
          <nav class="wlib-nav" aria-label="Widget library sections">
            {navGroups.map(group => {
              const items = navigation.filter(item => group.ids.includes(item.id));
              return items.length ? <div class="wlib-nav-group" key={group.label}>
                <div class="wlib-nav-label">{group.label}</div>
                {items.map(item => <button key={item.id} type="button" class={activeView === item.id ? 'active' : ''} aria-current={activeView === item.id ? 'page' : undefined} onClick={() => setActiveView(item.id)}>
                  <LucideIcon name={item.icon} size={17} strokeWidth={1.8} /><span>{item.label}</span>
                  {item.id === 'catalogue' ? <b>{widgets.length}</b> : item.id === 'recommended' ? <b>{widgets.filter(w => supportsPage(w.recommendedFor, pageKey)).length}</b> : item.id === 'bundles' ? <b>{WIDGET_BUNDLES.length}</b> : null}
                </button>)}
              </div> : null;
            })}
            {(['catalogue', 'recommended', 'bundles'] as LibraryView[]).includes(activeView) ? <div class="wlib-taxonomy">
              <div class="wlib-nav-label">Browse widgets</div>
              <button type="button" class={!activeModule && !activeArea ? 'active' : ''} onClick={() => { setActiveModule(null); setActiveArea(null); setCategoryFilters([]); }}>
                <LucideIcon name="Boxes" size={17} /><span>All widgets</span><b>{discoverableWidgets.length}</b>
              </button>
              {browseModules.map(module => {
                const expanded = expandedModules.includes(module.key);
                const areas = widgetAreas(discoverableWidgets, module.key);
                const moduleCount = discoverableWidgets.filter(widget => widget.module === module.key).length;
                return <div class="wlib-taxonomy-module" key={module.key}>
                  <div class="wlib-taxonomy-row">
                    <button type="button" class={activeModule === module.key && !activeArea ? 'active' : ''} onClick={() => { setActiveModule(module.key); setActiveArea(null); setExpandedModules(current => current.includes(module.key) ? current : [...current, module.key]); }}>
                      <LucideIcon name={module.icon} size={17} /><span>{module.label}</span><b>{moduleCount}</b>
                    </button>
                    <button type="button" class="wlib-taxonomy-toggle" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${module.label}`} aria-expanded={expanded} onClick={() => setExpandedModules(current => current.includes(module.key) ? current.filter(key => key !== module.key) : [...current, module.key])}>
                      <LucideIcon name={expanded ? 'ChevronUp' : 'ChevronDown'} size={14} />
                    </button>
                  </div>
                  {expanded ? <div class="wlib-subcategories">
                    <button type="button" class={activeModule === module.key && !activeArea ? 'active' : ''} onClick={() => { setActiveModule(module.key); setActiveArea(null); }}>All {module.label}</button>
                    {areas.map(({ area, count }) => <button type="button" key={area} class={activeModule === module.key && activeArea === area ? 'active' : ''} onClick={() => { setActiveModule(module.key); setActiveArea(area); }}><span>{area}</span><b>{count}</b></button>)}
                  </div> : null}
                </div>;
              })}
            </div> : null}
            <div class="wlib-nav-note"><LucideIcon name="ShieldCheck" size={18} /><strong>Permission-aware</strong><span>The catalogue never grants data access. Every widget is filtered and mounted using effective permissions.</span></div>
          </nav>
          {activeView === 'layouts' ? (
            <section class="wlib-admin-panel" aria-label="My layouts">
              <div class="wlib-admin-heading"><div><h3>My layouts</h3><p>Personal arrangements saved per page. Organization defaults remain unchanged.</p></div><span class="wlib-admin-mode"><LucideIcon name="UserRound" size={15} /> Personal</span></div>
              <div class="wlib-metric-row"><article><span>Customized pages</span><strong>{placedIds.size ? 1 : 0}</strong></article><article><span>Widgets placed</span><strong>{placedIds.size}</strong></article><article><span>Storage</span><strong class="text">ui_layout</strong></article></div>
              <div class="wlib-table-card"><table class="wlib-manage-table"><thead><tr><th>Page</th><th>Zone</th><th>Widgets</th><th>Based on</th><th>State</th></tr></thead><tbody><tr><td><strong>{pageLabel || pageKey}</strong><small>{pageKey}</small></td><td>{zoneId}</td><td>{placedIds.size}</td><td>Authorized organization default</td><td><span class="wlib-pill green">Current</span></td></tr></tbody></table></div>
            </section>
          ) : activeView === 'governance' ? (
            <section class="wlib-admin-panel" aria-label="Widget governance">
              <div class="wlib-admin-heading"><div><h3>Widget governance</h3><p>Control availability without changing the permissions that protect underlying data.</p></div>{can('ui.widgets.governance.manage') ? <span class="wlib-admin-mode"><LucideIcon name="ShieldCheck" size={15} /> Manage capability</span> : null}</div>
              <div class="wlib-metric-row">
                <article><span>Enabled widgets</span><strong>{governanceEnabled}</strong></article>
                <article><span>Restricted</span><strong>{governanceRestricted}</strong></article>
                <article><span>Needs review</span><strong class="warning">{governanceReview}</strong></article>
              </div>
              <div class="wlib-table-card">
                <table class="wlib-manage-table">
                  <thead><tr><th>Subject</th><th>Scope</th><th>Required capabilities</th><th>Catalogue</th><th>Policy state</th></tr></thead>
                  <tbody>{governanceRows.map(({ widget, policy }) => <tr key={widget.id}>
                    <td><strong>{widget.title}</strong><small>{widget.module.toUpperCase()} · {widget.category}</small></td>
                    <td>{(policy.allowedPages?.length ? policy.allowedPages : widget.supportedPages).join(' · ') || 'Application-wide'}</td>
                    <td>{(policy.requiredCapabilities?.length ? policy.requiredCapabilities : widget.permissions?.requiredPermissions ?? widget.dataSource.permissions).join(', ') || 'Page access'}</td>
                    <td>{policy.hidden || !policy.discoverable ? <span class="wlib-pill">Hidden</span> : policy.state === 'preview' ? <span class="wlib-pill warning">Preview only</span> : <span class="wlib-pill success">Visible when permitted</span>}</td>
                    <td><span class={`wlib-pill ${policy.state === 'enabled' ? 'success' : policy.state === 'preview' ? 'warning' : 'danger'}`}>{policy.state}</span>{policy.mandatory ? <small>Mandatory</small> : null}</td>
                  </tr>)}</tbody>
                </table>
              </div>
              <p class="wlib-admin-note">Policies are owned by first-party modules or installed packages. Governance controls discovery and placement; business-data authorization remains server-enforced.</p>
            </section>
          ) : activeView === 'sources' ? (
            <section class="wlib-admin-panel" aria-label="Approved widget data sources">
              <div class="wlib-admin-heading"><div><h3>Approved data sources</h3><p>Server-controlled sources available to first-party and declarative live widgets.</p></div><span class="wlib-admin-mode"><LucideIcon name="LockKeyhole" size={15} /> JWT APIs only</span></div>
              <div class="wlib-source-table">
                {registeredSources.map(source => <article class="wlib-source-card" key={source.key}>
                  <span class="wlib-source-icon"><LucideIcon name="Database" size={19} /></span>
                  <div><h4>{source.label}</h4><p>{source.endpoint} · {source.permission}</p><small>{source.scope} scope · {source.refresh.mode === 'interval' && source.refresh.intervalMs ? `every ${Math.round(source.refresh.intervalMs / 60000)} min` : source.refresh.mode.replace('-', ' ')}</small></div>
                  <span class="wlib-pill success">Available</span>
                </article>)}
                {registeredSources.length === 0 ? <article class="wlib-source-card empty"><span class="wlib-source-icon warning"><LucideIcon name="Info" size={19} /></span><div><h4>No registry sources configured</h4><p>Existing first-party widgets continue to use their authenticated module TanStack hooks.</p><small>Register an approved /api/ source before a declarative live widget can bind to it.</small></div><span class="wlib-pill warning">Registry empty</span></article> : null}
              </div>
              <p class="wlib-admin-note">Realtime signals may invalidate and refetch these sources. They never authorize a user or widen server-side record scope.</p>
            </section>
          ) : activeView === 'packages' ? (
            <section class="wlib-admin-panel" aria-label="Installed widget packages">
              <div class="wlib-admin-heading"><div><h3>Installed packages</h3><p>Approved packages available to this organization. Package administration never grants access to widget data.</p></div>{packageManager ? <button type="button" class="wlib-btn wlib-btn-primary" disabled={installBusy} onClick={() => fileRef.current?.click()}><LucideIcon name="Upload" size={16} /> {installBusy ? 'Installing…' : 'Install package'}</button> : null}</div>
              <div class="wlib-metric-row"><article><span>Packages</span><strong>{(packagesQuery.data ?? []).length}</strong></article><article><span>Package widgets</span><strong>{(packagesQuery.data ?? []).reduce((sum, item) => sum + item.widgets.length, 0)}</strong></article><article><span>Registry widgets</span><strong>{widgets.length}</strong></article></div>
              {(packagesQuery.data ?? []).length ? <div class="wlib-table-card"><table class="wlib-manage-table"><thead><tr><th>Package</th><th>Version</th><th>State</th><th>Widgets</th><th>Administration</th></tr></thead><tbody>{(packagesQuery.data ?? []).map(pkg => <tr key={pkg.id}><td><strong>{pkg.name}</strong><small>{pkg.id}</small></td><td>{pkg.version ?? '1.0.0'}</td><td><span class="wlib-pill green">Installed</span></td><td>{pkg.widgets.length}</td><td>{packageManager ? <button type="button" class="wlib-text-action" onClick={() => void onUninstall(pkg.id, pkg.name)}>Uninstall</button> : 'View only'}</td></tr>)}</tbody></table></div> : <div class="wlib-empty-panel">No packages installed.</div>}
            </section>
          ) : <>
          <div class="wlib-catalog-col">
            <div class="wlib-filters">
              <div class="wlib-filters-top">
                <TableSearch value={query} onChange={setQuery} placeholder="Search widgets, sources, permissions or tags…" ariaLabel="Search widgets" />
                <FilterDropdown id="widget-category-filter" label="Category" options={categories} selected={categoryFilters} onChange={setCategoryFilters} openId={filterOpenId} setOpenId={setFilterOpenId} />
                <button type="button" class="wlib-btn wlib-multi-trigger" onClick={() => multiSelect ? leaveMultiSelect() : setMultiSelect(true)}><LucideIcon name={multiSelect ? 'X' : 'ListChecks'} size={15} /> {multiSelect ? 'Cancel' : 'Select multiple'}</button>
              </div>
              <ActiveFilters chips={activeFilterChips} onClearAll={clearFilters} />
            </div>
            {multiSelect ? <div class="wlib-multi-toolbar" role="status" aria-live="polite">
              <div><strong>{multiSelectedIds.length} selected</strong><span>Add them to the board together, or copy their ids to curate the catalogue.</span></div>
              <div>
                <button type="button" class="wlib-btn" onClick={leaveMultiSelect}>Cancel selection</button>
                <button type="button" class="wlib-btn" disabled={!multiSelectedIds.length} onClick={copySelectedIds}>
                  <LucideIcon name="Copy" size={15} /> Copy ids
                </button>
                <button type="button" class="wlib-btn primary" disabled={!multiSelectedIds.length} onClick={() => void handleAddSelected()}><LucideIcon name="Plus" size={15} /> Add selected widgets</button>
              </div>
            </div> : null}
            {!multiSelect && (activeView === 'catalogue' || activeView === 'bundles') && <BundlesSection
              widgetDefs={widgets}
              placedIds={placedIds}
              lockedIds={lockedIds}
              pageKey={pageKey}
              zoneId={zoneId}
              onAddWidgets={instances => void addBatch(instances)}
            />}
            {activeView === 'recommended' ? <section class="wlib-recommended-intro" aria-label="Recommended widget guidance">
              <span class="wlib-recommended-icon"><LucideIcon name="Sparkles" size={19} /></span>
              <div><strong>Recommended starting set</strong><p>A balanced activity and workload view for the Employee Master page.</p></div>
              <b>{filtered.length} curated</b>
            </section> : null}
            <WidgetCatalog widgets={filtered} pageKey={pageKey}
              heading={activeView === 'recommended' ? `Recommended for ${pageLabel || pageKey}` : 'Approved widgets'}
              subheading={activeView === 'recommended' ? 'Based on this page, your permissions, and the organization’s approved catalogue.' : undefined}
              selectedWidgetId={selectedId} placedIds={placedIds} lockedIds={lockedIds}
              multiSelect={multiSelect} multiSelectedIds={new Set(multiSelectedIds)} onToggleMulti={toggleMultiWidget}
              onSelect={selectWidget} onPreview={previewWidget} onAdd={widget => void addSingle(widget)} />
          </div>
          {multiSelect ? <aside class="wlib-inspector empty wlib-multi-inspector" aria-label="Multi-select guidance">
            <LucideIcon name="ListChecks" size={30} />
            <h2>Select widgets</h2>
            <p>Choose widgets in the catalogue, then add the batch from the selection bar.</p>
            <span class="wlib-pill gray">{multiSelectedIds.length} selected</span>
          </aside> : <WidgetDetailPanel
              widget={selected} pageKey={pageKey} zoneId={zoneId} selectedSizeKey={sizeKey} config={config}
              locked={selected ? lockedIds.has(selected.id) : false} added={selectedAdded} livePreview
              onSizeChange={setSizeKey} onConfigChange={setConfig} onAddWidget={handleAdd} onPreviewOnBoard={handlePreview}
            />}
          </>}
        </div>
      </div>
    </div>
  );
}
