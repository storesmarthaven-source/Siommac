/**
 * src/ui/gallery/UiKitGallery.tsx — the UI Kit v2 workbench.
 *
 * A top-level section with its own sidebar, ported from the approved mockup.
 *
 *   ┌────────────┬──────────────────────────────┬─────────────┐
 *   │ Sidebar    │ Topbar                       │             │
 *   │ (own nav)  ├──────────────────────────────┤ Inspector   │
 *   │ Foundations│ Overview → Canvas / Compare  │ Props Style │
 *   │ Components │                              │ States A11Y │
 *   │ Patterns   │                              │ Code Migr.  │
 *   └────────────┴──────────────────────────────┴─────────────┘
 *
 * NOTHING here is a hand-written catalogue. Every nav row, overview card,
 * preview and inspector control is derived from `src/ui/registry` — including
 * the components that do not exist yet, which render as `missing` cards with
 * their planned API. Adding a component to the workbench is adding a registry
 * entry, and there is no second list to forget.
 *
 * The canvas carries `data-ui-preview-scope`, so draft token and recipe edits
 * restyle the preview and nothing else until Apply.
 */

/* eslint-disable react-hooks/refs -- `ref={hook.setSomething}` is a ref CALLBACK
   returned from a hook, not a ref object being read during render. The rule
   cannot tell the two apart; the callback form is the pattern it wants. */
import { type VNode } from 'preact';
import { useCallback, useMemo, useState } from 'preact/hooks';
import { LucideIcon, type LucideName } from '../LucideIcon';
import { Button } from '../primitives/Button';
import { TextInput } from '../primitives/TextInput';
import { SegmentedControl } from '../primitives/actions';
import { PREVIEW_WIDTHS, type UiState } from '../tokens';
import {
  componentsByCategory, findComponent, defaultProps, registryTotals, isBuilt,
  type ComponentDef, type PropValues, type CategoryGroup,
} from '../registry';
import { PREVIEW_SCOPE_ATTR } from '../theme/applyTheme';
import { PortalRootContext, PREVIEW_PORTAL_ATTR } from '../overlays/portalRoot';
import { useGalleryDraft, type GalleryDraft } from './galleryStore';
import { ComponentInspector, type InspectorTab } from './ComponentInspector';
import { FoundationsPanel } from './FoundationsPanel';
import { BrandThemePanel } from './BrandThemePanel';
import { CompareExisting } from './CompareExisting';
import './gallery.css';

type Mode = 'canvas' | 'grid' | 'compare' | 'existing';
const OVERVIEW = '__overview__';
const FOUNDATIONS = '__foundations__';
/* Foundations has two pages now: the token editor, and the logo-driven Brand
   Theme engine that WRITES those tokens. Both edit the same draft. */
const BRAND_THEME = '__brandTheme__';

const CATEGORY_ICON: Record<string, LucideName> = {
  actions: 'MousePointerClick',
  forms: 'TextCursorInput',
  selection: 'ListFilter',
  people: 'Users',
  overlays: 'Layers',
  data: 'Table',
  navigation: 'Compass',
  feedback: 'MessageSquareWarning',
  containers: 'SquareStack',
  status: 'BadgeCheck',
  patterns: 'Blocks',
};

export interface UiKitGalleryProps {
  /** Leaves the full-page workbench and returns to the ERP shell. */
  onExit?: () => void;
  /** The company logo already on file — the Brand Theme page extracts from it. */
  logoUrl?: string | null;
  /**
   * Persists a new company logo. Injected rather than imported so the kit keeps
   * no dependency on the Settings module's transport; the Gallery host wires it
   * to the branding endpoint that already exists.
   */
  onUploadLogo?: (dataUrl: string) => Promise<string>;
}

export function UiKitGallery({ onExit, logoUrl, onUploadLogo }: UiKitGalleryProps = {}): VNode {
  const groups = useMemo(() => componentsByCategory(), []);
  const totals = useMemo(() => registryTotals(), []);

  const [selectedId, setSelectedId] = useState<string>(OVERVIEW);
  const [mode, setMode] = useState<Mode>('canvas');
  const [tab, setTab] = useState<InspectorTab>('props');
  const [state, setState] = useState<UiState>('default');
  const [width, setWidth] = useState<number>(0);   // 0 = fill available
  const [query, setQuery] = useState('');

  const draft = useGalleryDraft();
  /* State, not a ref: the provider has to re-render once the element exists, or
     the first overlay opened would still resolve to document.body. */
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const isFoundationPage = selectedId === OVERVIEW || selectedId === FOUNDATIONS || selectedId === BRAND_THEME;
  const def = isFoundationPage ? undefined : findComponent(selectedId);

  // Props are per-component: switching components restores that component's own
  // declared defaults rather than carrying the previous one's values across.
  const [propsById, setPropsById] = useState<Record<string, PropValues>>({});
  const props: PropValues = def ? (propsById[def.id] ?? defaultProps(def)) : {};

  const setProp = useCallback((key: string, value: string | number | boolean) => {
    if (!def) return;
    setPropsById(prev => ({ ...prev, [def.id]: { ...(prev[def.id] ?? defaultProps(def)), [key]: value } }));
  }, [def]);

  const setAllProps = useCallback((values: PropValues) => {
    if (!def) return;
    setPropsById(prev => ({ ...prev, [def.id]: { ...defaultProps(def), ...values } }));
  }, [def]);

  const resetProps = useCallback(() => {
    if (!def) return;
    setPropsById(prev => ({ ...prev, [def.id]: defaultProps(def) }));
  }, [def]);

  function select(id: string): void {
    setSelectedId(id);
    setState('default');
    setMode('canvas');
    setTab('props');
  }

  const q = query.trim().toLowerCase();
  const filtered: CategoryGroup[] = q
    ? groups
      .map(g => ({ ...g, items: g.items.filter(i => i.name.toLowerCase().includes(q) || i.id.includes(q)) }))
      .filter(g => g.items.length > 0)
    : groups;

  /* The inspector is hidden in Compare-existing mode. It edits the CANONICAL
     component's props and recipe variables, which is exactly the assumption
     that mode exists to suspend — and the comparison needs the full width to
     put a table specimen beside a table specimen honestly. */
  const showInspector = def !== undefined && isBuilt(def) && mode !== 'existing';

  return (
    <PortalRootContext.Provider value={portalRoot}>
    <div class="ui-gallery-shell">
      <div class="ui-gallery">
        <GallerySidebar
          groups={filtered}
          selectedId={selectedId}
          onSelect={select}
          onExit={onExit}
        />

        <div class="ui-gal-main">
          <header class="ui-gal-topbar">
            <div style={{ minWidth: 0 }}>
              <div class="ui-gal-title-row">
                <h1>{def ? def.name : selectedId === FOUNDATIONS ? 'Foundations' : selectedId === BRAND_THEME ? 'Brand Theme' : 'UI Kit Gallery'}</h1>
                <span class="ui-gal-version">v2.0.0</span>
                {def && <StatusPill status={def.status} />}
              </div>
              <p>
                {def
                  ? def.description
                  : selectedId === FOUNDATIONS
                    ? 'Global tokens every canonical component reads from. Editing one re-themes the whole system.'
                    : selectedId === BRAND_THEME
                      ? 'Generate the semantic colour roles from a customer logo, check them against WCAG, then publish through the same draft mechanism.'
                      : 'The canonical SIOMAC component library. Everything here is driven by the component registry — including what is still missing.'}
              </p>
            </div>

            <div class="ui-gal-top-actions">
              <div class="ui-gal-search">
                <TextInput
                  size="sm"
                  type="search"
                  clearable
                  value={query}
                  onInput={setQuery}
                  iconLeft={<LucideIcon name="Search" />}
                  placeholder="Search components…"
                  aria-label="Search components"
                />
              </div>
              <select
                class="ui-gal-select"
                style={{ width: 'auto' }}
                value={String(width)}
                onChange={e => setWidth(Number((e.target as HTMLSelectElement).value))}
                aria-label="Preview width"
              >
                <option value="0">Fill width</option>
                {PREVIEW_WIDTHS.map(w => <option key={w.key} value={String(w.width)}>{w.label} · {w.width}px</option>)}
              </select>
              <button
                type="button"
                class="ui-gal-apply"
                disabled={draft.dirtyCount === 0}
                onClick={() => { void draft.publish(); }}
              >
                <LucideIcon name="Check" />
                {draft.dirtyCount > 0 ? `Apply ${draft.dirtyCount} change${draft.dirtyCount === 1 ? '' : 's'}` : 'Apply theme'}
              </button>
            </div>
          </header>

          <div class={`ui-gal-workspace${showInspector ? '' : ' ui-gal-workspace--wide'}`}>
            {/*
              The preview scope. Draft variables are set inline on THIS element,
              so they cascade to everything inside and nothing outside — the rest
              of the app, and every other user, are untouched.
            */}
            <div class="ui-gallery-canvas" ref={draft.attachScope} {...{ [PREVIEW_SCOPE_ATTR]: 'true' }}>
              {/*
                Portalled overlays (Dialog, and every AnchoredPopup-based menu,
                select and combobox) mount HERE rather than in document.body, so
                they stay inside the preview scope and inherit the draft tokens.
                Writing the draft to :root instead would re-theme the live app
                for whoever is using the workbench — the exact defect the draft
                layer exists to prevent.
              */}
              <div ref={setPortalRoot} {...{ [PREVIEW_PORTAL_ATTR]: 'true' }} />
              {selectedId === OVERVIEW && (
                <Overview totals={totals} groups={filtered} onSelect={select} query={query} />
              )}

              {selectedId === FOUNDATIONS && (
                <>
                  <BackBar onBack={() => select(OVERVIEW)} />
                  <FoundationsPanel draft={draft} />
                </>
              )}

              {selectedId === BRAND_THEME && (
                <>
                  <BackBar onBack={() => select(OVERVIEW)} />
                  <BrandThemePanel draft={draft} logoUrl={logoUrl} onUploadLogo={onUploadLogo} />
                </>
              )}

              {def && (
                <>
                  <div class="ui-gal-detail-bar">
                    <BackBar onBack={() => select(OVERVIEW)} inline />
                    {isBuilt(def) && (
                      <SegmentedControl
                        label="View mode"
                        value={mode}
                        onChange={setMode}
                        options={[
                          { value: 'canvas',  label: 'Canvas',  icon: <LucideIcon name="Square" /> },
                          { value: 'grid',    label: 'Grid',    icon: <LucideIcon name="LayoutGrid" /> },
                          { value: 'compare', label: 'Compare', icon: <LucideIcon name="Columns2" /> },
                          /* The visual selection pass. Marked when a family has
                             not been surveyed yet, because "no comparison" is
                             the state that has to be visible. */
                          { value: 'existing', label: def.comparison ? 'Compare existing' : 'Compare existing —', icon: <LucideIcon name="GitCompare" /> },
                        ]}
                      />
                    )}
                  </div>

                  {!isBuilt(def)
                    ? <MissingDetail def={def} />
                    : (
                      <div class="ui-gallery-frame" style={{ width: width ? `${width}px` : '100%' }}>
                        {mode === 'canvas' && (
                          <div class={`ui-gallery-stage${def.id === 'dialog' ? ' ui-gallery-stage--stretch' : ''}`}>
                            {def.render?.(props, state)}
                          </div>
                        )}
                        {mode === 'grid' && <GridMode def={def} props={props} />}
                        {mode === 'compare' && <CompareMode def={def} props={props} />}
                        {mode === 'existing' && <CompareExisting def={def} />}
                        {mode === 'canvas' && def.examples && def.examples.length > 0 && (
                          <Examples def={def} />
                        )}
                      </div>
                    )}
                </>
              )}
            </div>

            {showInspector && (
              <ComponentInspector
                def={def}
                tab={tab}
                onTab={setTab}
                props={props}
                onProp={setProp}
                onPreset={setAllProps}
                onResetProps={resetProps}
                state={state}
                onState={setState}
                draft={draft}
                footer={<GalleryActions draft={draft} />}
              />
            )}
          </div>
        </div>
      </div>
    </div>
    </PortalRootContext.Provider>
  );
}

/* ── Sidebar ───────────────────────────────────────────────────────────────*/

function GallerySidebar(
  { groups, selectedId, onSelect, onExit }:
  { groups: CategoryGroup[]; selectedId: string; onSelect: (id: string) => void; onExit?: () => void },
): VNode {
  return (
    <aside class="ui-gal-sidebar">
      <div class="ui-gal-brand">
        <span class="ui-gal-brand-mark" aria-hidden="true">
          <svg viewBox="0 0 32 32">
            <path d="M16 3 27 9v14l-11 6L5 23V9l11-6Z" fill="none" stroke="currentColor" stroke-width="2.4" />
            <path d="M10 12.5 16 9l6 3.5v7L16 23l-6-3.5v-7Z" fill="none" stroke="currentColor" stroke-width="2.2" />
          </svg>
        </span>
        <div style={{ minWidth: 0 }}>
          <div class="ui-gal-brand-title">SIOMAC</div>
          <div class="ui-gal-brand-sub">UI Kit v2</div>
        </div>
      </div>

      <nav class="ui-gal-nav" aria-label="UI Kit navigation">
        <button type="button" class="ui-gal-nav-item" aria-current={selectedId === OVERVIEW} onClick={() => onSelect(OVERVIEW)}>
          <LucideIcon name="LayoutDashboard" />
          <span class="ui-gal-nav-label">Overview</span>
        </button>
        <button type="button" class="ui-gal-nav-item" aria-current={selectedId === FOUNDATIONS} onClick={() => onSelect(FOUNDATIONS)}>
          <LucideIcon name="Palette" />
          <span class="ui-gal-nav-label">Foundations</span>
        </button>
        <button type="button" class="ui-gal-nav-item" aria-current={selectedId === BRAND_THEME} onClick={() => onSelect(BRAND_THEME)}>
          <LucideIcon name="Sparkles" />
          <span class="ui-gal-nav-label">Brand Theme</span>
        </button>

        {groups.map(g => (
          <div key={g.category}>
            <div class="ui-gal-nav-section">{g.label}</div>
            {g.items.map(item => (
              <button
                key={item.id}
                type="button"
                class="ui-gal-nav-item"
                data-missing={!isBuilt(item) ? 'true' : undefined}
                aria-current={selectedId === item.id}
                onClick={() => onSelect(item.id)}
              >
                <LucideIcon name={CATEGORY_ICON[item.category] ?? 'Box'} />
                <span class="ui-gal-nav-label">{item.name}</span>
                {!isBuilt(item) && <span class="ui-gal-nav-count">—</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div class="ui-gal-sidebar-foot">
        {/* Not a button: coverage is a build artefact, and a control that could
            not actually run it would be a control that lies. */}
        <div class="ui-gal-sidebar-btn" title="Run the coverage report from a terminal">
          <LucideIcon name="Gauge" />
          npm run ui:coverage
        </div>
        {onExit && (
          <button type="button" class="ui-gal-sidebar-btn ui-gal-exit" onClick={onExit}>
            <LucideIcon name="LogOut" />
            Back to SIOMAC
          </button>
        )}
      </div>
    </aside>
  );
}

/* ── Overview ──────────────────────────────────────────────────────────────*/

function Overview(
  { totals, groups, onSelect, query }:
  { totals: ReturnType<typeof registryTotals>; groups: CategoryGroup[]; onSelect: (id: string) => void; query: string },
): VNode {
  const builtTotal = groups.reduce((n, g) => n + g.built, 0);
  const allTotal = groups.reduce((n, g) => n + g.total, 0);

  return (
    <>
      <section class="ui-gal-coverage" aria-label="UI Kit coverage">
        <div class="ui-gal-cov-stats">
          <div class="ui-gal-cov-stat">
            <div class="ui-gal-cov-value ui-gal-cov-value--accent">{totals.canonical + totals.beta}</div>
            <div class="ui-gal-cov-label">Canonical components</div>
          </div>
          <div class="ui-gal-cov-stat">
            <div class="ui-gal-cov-value ui-gal-cov-value--missing">{totals.missing}</div>
            <div class="ui-gal-cov-label">Still missing</div>
          </div>
          <div class="ui-gal-cov-stat">
            <div class="ui-gal-cov-value">{totals.total}</div>
            <div class="ui-gal-cov-label">Registered total</div>
          </div>
          <div class="ui-gal-cov-stat">
            <div class="ui-gal-cov-value">{Math.round(totals.completeness * 100)}%</div>
            <div class="ui-gal-cov-label">Catalogue completeness</div>
          </div>
        </div>

        <div class="ui-gal-cov-cats">
          {groups.map(g => {
            const missing = g.total - g.built;
            return (
              <div key={g.category} class="ui-gal-cov-cat">
                <div class="ui-gal-cov-cat-name">{g.label}</div>
                <div class="ui-gal-cov-cat-count">{g.built} / {g.total}</div>
                {missing > 0 && <div class="ui-gal-cov-cat-note">{missing} missing</div>}
                <div class="ui-gal-cov-bar"><i style={{ width: `${g.total ? (g.built / g.total) * 100 : 0}%` }} /></div>
              </div>
            );
          })}
        </div>
      </section>

      {groups.map(g => (
        <section key={g.category}>
          <div class="ui-gal-section-h">
            <h2>{g.label}</h2>
            <span>{g.built} of {g.total} built</span>
          </div>
          <div class="ui-gal-cards">
            {g.items.map(item => <ComponentCard key={item.id} def={item} onOpen={() => onSelect(item.id)} />)}
          </div>
        </section>
      ))}

      {groups.length === 0 && (
        <div class="ui-gallery-empty">
          <LucideIcon name="SearchX" size={20} />
          <span>No component matches &ldquo;{query}&rdquo;.</span>
        </div>
      )}

      <p style={{ marginTop: 'var(--space-6)', color: 'var(--text-muted)', fontSize: '10px' }}>
        {builtTotal} of {allTotal} registered components exist. Adoption across the app —
        legacy classes, deprecated imports, module-local reimplementations and raw markup —
        is reported by <code>npm run ui:coverage</code>, and ratcheted by <code>npm run ui:coverage:check</code>.
      </p>
    </>
  );
}

function ComponentCard({ def, onOpen }: { def: ComponentDef; onOpen: () => void }): VNode {
  const built = isBuilt(def);
  const variantCount = def.props?.variant && (def.props.variant.type === 'select' || def.props.variant.type === 'segmented')
    ? def.props.variant.options.length
    : undefined;

  return (
    <button
      type="button"
      class={`ui-gal-card${built ? '' : ' ui-gal-card--missing'}`}
      onClick={onOpen}
    >
      <div class="ui-gal-card-head">
        <div style={{ minWidth: 0 }}>
          <h3>{def.name}</h3>
          <span class="ui-gal-card-sub">
            {built
              ? variantCount ? `${variantCount} variants` : 'Canonical'
              : 'Not built yet'}
          </span>
        </div>
        <StatusPill status={def.status} />
      </div>

      {built
        ? <div class="ui-gal-card-preview">{def.render?.(defaultProps(def), 'default')}</div>
        : <pre class="ui-gal-card-planned">{def.plannedApi}</pre>}

      <div class="ui-gal-card-foot">
        <span>{migrationSummary(def)}</span>
        <span class="ui-gal-card-link">{built ? 'Open →' : 'View spec →'}</span>
      </div>
    </button>
  );
}

/** One line of migration context, or nothing if there is none worth showing. */
function migrationSummary(def: ComponentDef): string {
  const m = def.migration;
  if (!m) return isBuilt(def) ? 'No legacy' : 'Planned';
  const parts: string[] = [];
  if (m.replaces?.length) parts.push(`${m.replaces.length} legacy class${m.replaces.length === 1 ? '' : 'es'}`);
  if (m.deprecatedImports?.length) parts.push(`${m.deprecatedImports.length} deprecated import${m.deprecatedImports.length === 1 ? '' : 's'}`);
  return parts.length ? `Replaces ${parts.join(', ')}` : (isBuilt(def) ? 'No legacy' : 'Planned');
}

function StatusPill({ status }: { status: ComponentDef['status'] }): VNode {
  return <span class={`ui-gal-status ui-gal-status--${status}`}>{status}</span>;
}

/* ── Missing-component detail ──────────────────────────────────────────────*/

function MissingDetail({ def }: { def: ComponentDef }): VNode {
  const m = def.migration;
  return (
    <div class="ui-gallery-frame">
      <div class="ui-gallery-note ui-gallery-note--warn" style={{ marginBottom: 'var(--space-4)' }}>
        <LucideIcon name="TriangleAlert" size={13} />
        <span>
          <strong>{def.name}</strong> is registered but not built. It appears here so the gap is
          visible and countable — see <code>npm run ui:coverage</code>. Building it means adding the
          component and changing <code>status</code> to <code>stable</code>; nothing else needs updating.
        </span>
      </div>

      <div class="ui-gallery-kv" style={{ marginBottom: 'var(--space-4)' }}>
        <div class="ui-gallery-kv-key">Planned API</div>
      </div>
      <pre class="ui-gallery-code">{def.plannedApi}</pre>

      {m && ((m.replaces?.length ?? 0) + (m.deprecatedImports?.length ?? 0) + (m.rawPatterns?.length ?? 0)) > 0 && (
        <div style={{ marginTop: 'var(--space-5)', display: 'grid', gap: 'var(--space-3)' }}>
          <div class="ui-gallery-kv-key">What it will replace</div>
          <div class="ui-gal-chiplist">
            {m.replaces?.map(c => <span key={c} class="ui-gal-chip">{c}</span>)}
            {m.deprecatedImports?.map(c => <span key={c} class="ui-gal-chip ui-gal-chip--danger">{c}</span>)}
            {m.rawPatterns?.map(c => <span key={c} class="ui-gal-chip">{c}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Examples ──────────────────────────────────────────────────────────────*/

function Examples({ def }: { def: ComponentDef }): VNode {
  return (
    <div style={{ marginTop: 'var(--space-6)', display: 'grid', gap: 'var(--space-4)' }}>
      <div class="ui-gallery-section-title">Examples</div>
      {def.examples?.map(ex => (
        <div key={ex.id} class="ui-gallery-cell">
          <div>
            <div class="ui-gallery-cell-label">{ex.title}</div>
            {ex.description && <div class="ui-gallery-control-help" style={{ marginTop: '4px' }}>{ex.description}</div>}
          </div>
          <div class="ui-gallery-cell-body">{ex.render()}</div>
        </div>
      ))}
    </div>
  );
}

/* ── Shared bits ───────────────────────────────────────────────────────────*/

function BackBar({ onBack, inline = false }: { onBack: () => void; inline?: boolean }): VNode {
  return (
    <button type="button" class="ui-gal-back" style={inline ? undefined : { marginBottom: 'var(--space-4)' }} onClick={onBack}>
      <LucideIcon name="ArrowLeft" />
      All components
    </button>
  );
}

function GalleryActions({ draft }: { draft: GalleryDraft }): VNode {
  function exportTheme(): void {
    const blob = new Blob([draft.exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'siomac-theme.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div class="ui-gallery-actions">
      {draft.dirtyCount > 0
        ? <span class="ui-gallery-dirty">{draft.dirtyCount} unpublished</span>
        : <span class="ui-gallery-clean">No draft changes</span>}
      <Button variant="ghost" size="sm" iconLeft={<LucideIcon name="RotateCcw" />} onClick={draft.resetAll} disabled={draft.dirtyCount === 0}>
        Reset
      </Button>
      <Button variant="outline" size="sm" iconLeft={<LucideIcon name="Download" />} onClick={exportTheme} disabled={draft.dirtyCount === 0}>
        Export
      </Button>
    </div>
  );
}

/* ── Grid mode ─────────────────────────────────────────────────────────────
   Every value of the component's primary variant axis, at every size. The view
   that makes an inconsistent variant obvious at a glance. */

function GridMode({ def, props }: { def: ComponentDef; props: PropValues }): VNode {
  const axis = def.props?.variant;
  const sizes = def.props?.size;

  if (!axis || (axis.type !== 'select' && axis.type !== 'segmented')) {
    return (
      <div class="ui-gallery-empty">
        <LucideIcon name="LayoutGrid" size={20} />
        <span>{def.name} has no variant axis — use Canvas or Compare.</span>
      </div>
    );
  }

  const sizeOptions: readonly string[] =
    sizes && (sizes.type === 'segmented' || sizes.type === 'select') ? sizes.options : ['md'];

  return (
    <div class="ui-gallery-grid">
      {axis.options.map(variant => (
        <div key={variant} class="ui-gallery-cell">
          <div class="ui-gallery-cell-label">{variant}</div>
          {sizeOptions.map(sz => (
            <div key={sz} class="ui-gallery-cell-body">
              {def.render?.({ ...props, variant, size: sz }, 'default')}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ── Compare mode ──────────────────────────────────────────────────────────
   The same component in every state it declares, side by side. Where "disabled
   and read-only look identical" becomes impossible to miss. */

function CompareMode({ def, props }: { def: ComponentDef; props: PropValues }): VNode {
  const states = def.compare ?? def.states ?? ['default'];
  return (
    <div class="ui-gallery-compare">
      {states.map(s => (
        <div key={s} class="ui-gallery-cell">
          <div class="ui-gallery-cell-label">{s}</div>
          <div class="ui-gallery-cell-body">{def.render?.(props, s)}</div>
        </div>
      ))}
    </div>
  );
}
