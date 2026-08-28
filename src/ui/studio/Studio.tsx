/**
 * src/ui/studio/Studio.tsx — the SIOMAC Design System Studio shell.
 *
 * Layout replicates the Untitled UI documentation site supplied as the
 * reference: a 248px white rail of iconed, grouped nav items; a breadcrumb
 * topbar; a two-tone hero with a CTA; then category sections, each a heading
 * plus description over a grid of preview cards captioned with a component and
 * variant count. Measured from the reference rather than eyeballed — its rhythm
 * (16px body, 24px/600 hero, 16px/600 section, 14px/600 card label, 12px count,
 * 32px nav rows) supersedes the earlier larger-control direction.
 *
 * Two rules this file exists to enforce:
 *
 *  1. The catalogue is READ FROM THE REGISTRY. There is no second list here. A
 *     component appears because a definition exists, never because someone
 *     remembered to add a card — the whole reason the registry is authoritative.
 *     Cards use theme-aware HTML/CSS catalogue scenes for fast visual scanning;
 *     live canonical renders belong to the focused editors.
 *
 *  2. `patterns` are NOT kit gaps. PayrollApprovalTable belongs to payroll and
 *     DayOneGateCard to onboarding; they are built FROM primitives by the module
 *     that owns the domain. They get their own section, exactly as the reference
 *     separates "Base components" from "Application UI components".
 */

import { type CSSProperties, type VNode } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Workbench } from './Workbench';
import { ButtonBrowser } from './ButtonBrowser';
import { FamilyBrowser } from './FamilyBrowser';
import { BrandOverview } from './BrandOverview';
import { AppPreview, type Scene } from './AppPreview';
import { PreviewScope } from './PreviewScope';
import {
  COMPONENT_DEFS, componentsByCategory, registryTotals, findComponent,
  isBuilt, familyOfComponent, findFamily, findButtonPattern,
  type ComponentDef, type ComponentFamily, type CatalogueNode,
} from '../registry';
import { LucideIcon, type LucideName } from '../LucideIcon';
import { Breadcrumbs, type BreadcrumbItem } from '../navigation/Breadcrumbs';
import { useGalleryDraft, type GalleryDraft } from '../gallery/galleryStore';
import { FoundationsPanel, FOUNDATION_SECTIONS, type FoundationSectionId } from '../gallery/FoundationsPanel';
import { BrandThemePanel } from '../gallery/BrandThemePanel';
import { TOKEN_GROUPS } from '../theme/tokens';
import './studio.css';
import { StudioPublishBar } from './StudioPublishBar';
import { CatalogueShowcase } from './CatalogueShowcase';
import { ComponentThumbnail } from './componentThumbnail';

export interface StudioProps {
  onExit?: () => void;
  logoUrl?: string | null;
  /** Resolves to the stored logo URL — the host owns the upload endpoint. */
  onUploadLogo?: (dataUrl: string) => Promise<string>;
}

/* ── Navigation ───────────────────────────────────────────────────────────── */

type SectionId =
  | 'brand-overview' | 'brand-theme'
  | 'foundations'
  | 'components'
  | 'app-shell' | 'app-dashboard' | 'app-forms' | 'app-data' | 'app-workflow';

interface NavItem { id: SectionId; label: string; icon: LucideName }
interface NavGroup { label: string; items: NavItem[] }

const NAV: NavGroup[] = [
  { label: 'Brand', items: [
    { id: 'brand-overview', label: 'Brand Overview',  icon: 'Sparkles' },
    { id: 'brand-theme',    label: 'Theme Generator', icon: 'Palette' },
  ] },
  { label: 'Foundations', items: [
    { id: 'foundations', label: 'Tokens', icon: 'Ruler' },
  ] },
  { label: 'Components', items: [
    { id: 'components', label: 'Overview', icon: 'LayoutGrid' },
  ] },
  { label: 'Application', items: [
    { id: 'app-shell',     label: 'App Shell',  icon: 'PanelsTopLeft' },
    { id: 'app-dashboard', label: 'Dashboard',  icon: 'LayoutDashboard' },
    { id: 'app-forms',     label: 'Forms',      icon: 'TextCursorInput' },
    { id: 'app-data',      label: 'Data Views', icon: 'Table' },
    { id: 'app-workflow',  label: 'Workflow',   icon: 'GitBranch' },
  ] },
];

/**
 * Component nav rows, in catalogue order.
 *
 * A family becomes ONE parent row with its members nested beneath it, so the
 * rail reads `Buttons ▸ Action / Dropdown / Split` instead of three unrelated
 * siblings. Built only: a planned component has no workbench to open, and a nav
 * row that opens nothing is a dead control.
 */
type NavComponentRow =
  | { kind: 'one'; def: ComponentDef }
  | { kind: 'family'; family: ComponentFamily; children: ComponentDef[] };

const COMPONENT_ROWS: NavComponentRow[] = componentsByCategory()
  .filter(g => g.category !== 'patterns')
  .flatMap(g => g.nodes.flatMap((node): NavComponentRow[] => {
    if (node.kind === 'component') {
      return isBuilt(node.def) ? [{ kind: 'one', def: node.def }] : [];
    }
    const children = node.members.filter(isBuilt);
    return children.length > 0 ? [{ kind: 'family', family: node.family, children }] : [];
  }));

const COMPONENT_ORDER: ComponentDef[] = COMPONENT_ROWS.flatMap(row =>
  row.kind === 'family' ? row.children : [row.def],
);

/** Which scene each Application nav item opens on. */
const APP_SCENE: Partial<Record<SectionId, Scene>> = {
  'app-shell': 'dashboard', 'app-dashboard': 'dashboard', 'app-forms': 'forms',
  'app-data': 'data', 'app-workflow': 'workflow',
};

const SECTION_COPY: Record<string, string> = {
  actions:    'Buttons and action controls — everything that performs or triggers work.',
  forms:      'Inputs, selects and pickers for capturing and editing data.',
  selection:  'Choice controls — one value or many, from a small set.',
  people:     'Avatars, person pickers and everything that represents a human.',
  overlays:   'Dialogs, drawers and anchored surfaces layered over the page.',
  data:       'Tables and data display for registers, reports and records.',
  navigation: 'Tabs, wizards and headers that move a user through the product.',
  feedback:   'Empty, loading and status states — what the product says back.',
  containers: 'Cards and surfaces that group and frame content.',
  status:     'Badges and indicators that carry operational meaning.',
};

/* ── Catalogue ────────────────────────────────────────────────────────────── */

interface PaletteItem {
  label: string;
  token: string;
  fallback: string;
}

const BRAND_PALETTE: PaletteItem[] = [
  { label: 'Primary', token: '--ui-color-action-primary', fallback: '#1b2d54' },
  { label: 'Primary hover', token: '--ui-color-action-primary-hover', fallback: '#13213d' },
  { label: 'Navigation', token: '--ui-color-nav-background', fallback: '#1b2d54' },
  { label: 'Accent', token: '--ui-color-navigation-active', fallback: '#e40c0c' },
  { label: 'Page', token: '--ui-color-surface-page', fallback: '#f6f7f9' },
  { label: 'Surface', token: '--ui-color-surface-default', fallback: '#ffffff' },
];

const SEMANTIC_ROLES: { label: string; items: PaletteItem[] }[] = [
  { label: 'Actions', items: [
    { label: 'Primary', token: '--ui-color-action-primary', fallback: '#1b2d54' },
    { label: 'Secondary', token: '--ui-color-action-secondary', fallback: '#1b2d54' },
  ] },
  { label: 'Surfaces', items: [
    { label: 'Default', token: '--ui-color-surface-default', fallback: '#ffffff' },
    { label: 'Subtle', token: '--ui-color-surface-subtle', fallback: '#f6f7f9' },
  ] },
  { label: 'Navigation', items: [
    { label: 'Background', token: '--ui-color-nav-background', fallback: '#1b2d54' },
    { label: 'Active', token: '--ui-color-nav-active-indicator', fallback: '#7382a1' },
  ] },
  { label: 'States', items: [
    { label: 'Success', token: '--ui-color-success', fallback: '#16865b' },
    { label: 'Warning', token: '--ui-color-warning', fallback: '#c97912' },
    { label: 'Danger', token: '--ui-color-danger', fallback: '#d92d20' },
    { label: 'Info', token: '--ui-color-info', fallback: '#1570ef' },
  ] },
];

function resolvedToken(draft: GalleryDraft, item: PaletteItem): string {
  const value = draft.read(item.token).trim();
  return value || item.fallback;
}

function PaletteBoard({ draft }: { draft: GalleryDraft }): VNode {
  return (
    <section class="sds-board-panel sds-board-palette" aria-labelledby="brand-palette-title">
      <div class="sds-board-panel__heading">
        <span>01</span>
        <div><h2 id="brand-palette-title">Brand palette</h2><p>Live values inherited from the active theme.</p></div>
      </div>
      <div class="sds-board-palette__grid">
        {BRAND_PALETTE.map(item => {
          const value = resolvedToken(draft, item);
          return (
            <article class="sds-board-swatch" key={item.token}>
              <i style={{ background: value }} aria-hidden="true" />
              <strong>{item.label}</strong>
              <span>{value}</span>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function SemanticBoard({ draft }: { draft: GalleryDraft }): VNode {
  return (
    <section class="sds-board-panel sds-board-semantics" aria-labelledby="semantic-roles-title">
      <div class="sds-board-panel__heading">
        <span>02</span>
        <div><h2 id="semantic-roles-title">Semantic roles</h2><p>Purpose-led colors shared by every canonical component.</p></div>
      </div>
      <div class="sds-board-semantics__groups">
        {SEMANTIC_ROLES.map(group => (
          <div class="sds-board-role" key={group.label}>
            <strong>{group.label}</strong>
            <div>
              {group.items.map(item => {
                const value = resolvedToken(draft, item);
                return <span key={item.token} title={`${item.label}: ${value}`}><i style={{ background: value }} />{item.label}</span>;
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function builtNodes(nodes: CatalogueNode[]): CatalogueNode[] {
  const result: CatalogueNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'component') {
      if (isBuilt(node.def)) result.push(node);
      continue;
    }
    const members = node.members.filter(isBuilt);
    if (members.length > 0) result.push({ ...node, members });
  }
  return result;
}

function _RetiredCatalogue({ onOpen, draft }: { onOpen: (id: string) => void; draft: GalleryDraft }): VNode {
  const groups = componentsByCategory();
  const visibleGroups = groups
    .map(group => ({ ...group, nodes: builtNodes(group.nodes) }))
    .filter(group => group.nodes.length > 0);
  const t = registryTotals();
  const builtTotal = t.canonical + t.beta;
  const boardStyle = {
    '--sds-board-brand': resolvedToken(draft, { label: 'Brand', token: '--ui-color-nav-background', fallback: '#1b2d54' }),
    '--sds-board-action': resolvedToken(draft, { label: 'Action', token: '--ui-color-action-primary', fallback: '#1b2d54' }),
    '--sds-board-accent': resolvedToken(draft, { label: 'Accent', token: '--ui-color-navigation-active', fallback: '#e40c0c' }),
    '--sds-board-page': resolvedToken(draft, { label: 'Page', token: '--ui-color-surface-page', fallback: '#f6f7f9' }),
    '--sds-board-surface': resolvedToken(draft, { label: 'Surface', token: '--ui-color-surface-default', fallback: '#ffffff' }),
  } as CSSProperties;

  return (
    <div class="sds-cat sds-atlas" style={boardStyle}>
      <aside class="sds-atlas-rail">
        <header><span><i /><i /><i /><i /></span><div><strong>SIOMAC</strong><small>System Atlas · v2</small></div></header>
        <div class="sds-atlas-coverage">
          <span>Library coverage</span>
          <div><strong>{builtTotal}</strong><small>components</small></div>
          <div><strong>{visibleGroups.length}</strong><small>groups</small></div>
          <div><strong>{t.missingPrimitives}</strong><small>gaps</small></div>
        </div>
        <nav aria-label="System Atlas chapters">
          <span>Explore chapters</span>
          {[
            ['03', 'Buttons', 'library-buttons'], ['04', 'Inputs', 'library-inputs'], ['05', 'Data table', 'library-data'],
            ['06', 'Controls', 'library-navigation-controls'], ['07', 'Status', 'library-status'], ['08', 'App shell', 'library-shell'],
            ['09', 'Menu', 'library-menu'], ['10', 'Dialog', 'library-dialog'], ['11', 'Form', 'library-form'],
          ].map(([number, label, target]) => <button type="button" key={target} onClick={() => document.querySelector(`#${target}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><i>{number}</i><span>{label}</span><LucideIcon name="ArrowRight" /></button>)}
        </nav>
        <footer><span>Theme signal</span><div>{BRAND_PALETTE.slice(0, 4).map(item => <i key={item.token} style={{ background: resolvedToken(draft, item) }} title={item.label} />)}</div><small><i /> Draft preview active</small></footer>
      </aside>

      <div class="sds-atlas-canvas">
        <header class="sds-atlas-intro">
          <div><span>Production interface language</span><h1>System<br />Atlas</h1></div>
          <div><p>A complete map of SIOMAC’s visual foundations and canonical components—designed to adapt to every approved company theme.</p><button type="button" onClick={() => document.querySelector('#library-buttons')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Start exploring <LucideIcon name="ArrowDown" /></button></div>
        </header>

        <section class="sds-atlas-foundations">
          <header><span>01—02</span><div><h2>Foundations</h2><p>Theme values become stable semantic roles before they reach a component.</p></div></header>
          <div><PaletteBoard draft={draft} /><SemanticBoard draft={draft} /></div>
        </section>

        <div class="sds-atlas-section-label"><span>03—12</span><strong>Component system</strong><i /></div>
        <main class="sds-atlas-showcases"><CatalogueShowcase groups={visibleGroups} onOpen={onOpen} /></main>

        <footer class="sds-atlas-principles">
          <div><span>01</span><strong>Theme linked</strong><p>Brand and semantic tokens flow through every canonical recipe.</p></div>
          <div><span>02</span><strong>Registry driven</strong><p>New definitions join navigation, catalogue and inspectors automatically.</p></div>
          <div><span>03</span><strong>Governed</strong><p>Accessibility and interaction contracts remain protected.</p></div>
        </footer>
      </div>
    </div>
  );
}

function variantCount(def: ComponentDef): number {
  const variant = def.props?.variant;
  if (!variant || (variant.type !== 'select' && variant.type !== 'segmented')) return 0;
  return variant.options.length;
}

function ComponentCard({ def, onOpen }: { def: ComponentDef; onOpen?: (id: string) => void }): VNode {
  const built = isBuilt(def);
  const variants = variantCount(def);
  const caption = built
    ? (variants > 0 ? `1 component · ${variants} variants` : '1 component')
    : def.category === 'patterns' ? 'Application pattern' : 'Planned';
  const body = <>
    <div class="sds-card__preview">
      <ComponentThumbnail kind={def.thumbnail} />
      {!built && <span class="sds-card__missing">{def.category === 'patterns' ? 'Owned by its module' : 'Planned'}</span>}
    </div>
    <div class="sds-card__foot"><strong>{def.name}</strong><span>{caption}</span></div>
  </>;
  if (!built || !onOpen) return <article class="sds-card sds-card--unbuilt">{body}</article>;
  return <button type="button" class="sds-card sds-card--open" onClick={() => onOpen(def.id)}>{body}</button>;
}

function FamilyCard({ family, members, onOpen }: { family: ComponentFamily; members: ComponentDef[]; onOpen: (id: string) => void }): VNode {
  return <button type="button" class="sds-card sds-card--open sds-card--family" onClick={() => onOpen(family.id)}>
    <div class="sds-card__preview"><ComponentThumbnail kind={family.thumbnail} /></div>
    <div class="sds-card__foot"><strong>{family.name}</strong><span>{members.length} component types</span></div>
  </button>;
}

function CatalogueNodeCard({ node, onOpen }: { node: CatalogueNode; onOpen: (id: string) => void }): VNode {
  if (node.kind === 'component') return <ComponentCard def={node.def} onOpen={onOpen} />;
  return <FamilyCard family={node.family} members={node.members} onOpen={onOpen} />;
}

/** The original registry-driven overview: familiar component cards, not a new layout. */
function Catalogue({ onOpen }: { onOpen: (id: string) => void }): VNode {
  const groups = componentsByCategory().filter(group => group.category !== 'patterns');
  const totals = registryTotals();
  return <div class="sds-cat">
    <header class="sds-hero">
      <h1><strong>SIOMAC</strong> Design System</h1>
      <p>{totals.canonical + totals.beta} canonical base components — buttons, inputs, badges and the primitives every SIOMAC surface is built from — use semantic tokens and CSS recipes, with {totals.missingPrimitives} primitive gaps. Browse the visual catalogue and open any component to edit its live canonical preview.</p>
      <button type="button" class="sds-hero__cta" onClick={() => document.querySelector('.sds-sec--first')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Explore components</button>
    </header>
    <div class="sds-rule" />
    {groups.map((group, index) => <section class={`sds-sec${index === 0 ? ' sds-sec--first' : ''}`} key={group.category}>
      <h3>{group.label} <span>{group.built}/{group.total} built</span></h3>
      {SECTION_COPY[group.category] && <p>{SECTION_COPY[group.category]}</p>}
      <div class="sds-grid">{group.nodes.map(node => <CatalogueNodeCard node={node} onOpen={onOpen} key={node.kind === 'family' ? node.family.id : node.def.id} />)}</div>
    </section>)}
  </div>;
}

/** Sections whose Studio implementation is a later phase. States the phase
 *  rather than pretending to be a feature. */
export function Studio({ onExit, logoUrl, onUploadLogo }: StudioProps = {}): VNode {
  const mainRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState<SectionId>('components');
  const [openId, setOpenId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [tokenSectionId, setTokenSectionId] = useState<FoundationSectionId>('colours');
  const [tokenGroupId, setTokenGroupId] = useState<string | null>(null);
  const draft = useGalleryDraft();
  /* Destructured so the lint rule can tell a scope-callback from a ref: every
     preview surface must ATTACH the scope, not merely carry the attribute — the
     draft applies its values to the one element handed to attachScope. */
  const attachScope = draft.attachScope;

  const flat = NAV.flatMap(g => g.items);
  const current = flat.find(i => i.id === active) ?? flat[0];
  if (!current) throw new Error('Studio navigation is empty');
  /* IDs resolve through authoritative registries: components open their
     generated workbench; the family and governed patterns open the browser. */
  const openDef = openId ? findComponent(openId) : undefined;
  const openPattern = openId ? findButtonPattern(openId) : undefined;
  const openFamily = openId
    ? (findFamily(openId) ?? familyOfComponent(openId) ?? (openPattern ? findFamily('buttons') : undefined))
    : undefined;
  const resolvedDef = openDef ?? (openFamily?.id === openId
    ? findComponent(openFamily.defaultComponentId)
    : undefined);
  const groupOf = NAV.find(g => g.items.some(i => i.id === active))?.label ?? '';
  const componentIndex = resolvedDef ? COMPONENT_ORDER.findIndex(def => def.id === resolvedDef.id) : -1;
  const previousComponent = componentIndex > 0 ? COMPONENT_ORDER[componentIndex - 1] : undefined;
  const nextComponent = componentIndex >= 0 && componentIndex < COMPONENT_ORDER.length - 1
    ? COMPONENT_ORDER[componentIndex + 1] : undefined;
  const tokenSection = FOUNDATION_SECTIONS.find(section => section.id === tokenSectionId) ?? FOUNDATION_SECTIONS[0]!;
  const tokenGroups = TOKEN_GROUPS.filter(tokenSection.includes);
  const tokenGroup = tokenGroupId ? tokenGroups.find(group => group.id === tokenGroupId) : undefined;
  const openComponents = (): void => { setActive('components'); setOpenId(null); };
  const openGroup = (): void => {
    if (groupOf === 'Components') return openComponents();
    const first = NAV.find(group => group.label === groupOf)?.items[0];
    if (first) { setActive(first.id); setOpenId(null); }
  };
  const isComponentPath = groupOf === 'Components';
  const breadcrumbItems: BreadcrumbItem[] = [
    { label: 'Studio home', icon: <LucideIcon name="Home" size={19} />, iconOnly: true, onSelect: openComponents },
    ...(!isComponentPath ? [{ label: groupOf, onSelect: openGroup }] : []),
    ...(openFamily && openId !== openFamily.id ? [{ label: openFamily.name, onSelect: () => setOpenId(openFamily.id) }] : []),
    { label: openDef?.name ?? openPattern?.name ?? openFamily?.name ?? current.label },
    ...(active === 'foundations' && tokenGroup ? [{ label: tokenGroup.label.replace(/^Semantic\s*[—-]\s*/i, '') }] : []),
  ];

  /* The Studio swaps views inside one persistent scrolling main element. Without
     resetting it, opening a card near the bottom of Overview lands halfway down
     the editor and hides the live-preview header and component title. */
  useEffect(() => {
    const main = mainRef.current;
    if (typeof main?.scrollTo === 'function') main.scrollTo({ top: 0, behavior: 'auto' });
  }, [active, openId, tokenSectionId, tokenGroupId]);

  return (
    <div class="sds">
      <aside class="sds-nav">
        <div class="sds-nav__brand">
          <span class="sds-nav__mark">SIOMAC</span>
          <span class="sds-nav__sub">Design System</span>
        </div>

        {active === 'foundations' ? (
          <nav class="sds-token-nav" aria-label="Token modules">
            <button type="button" class="sds-token-nav__back" onClick={openComponents}>
              <LucideIcon name="ArrowLeft" size={15} /> Back to Studio
            </button>
            <header><span>Token modules</span><small>Design tokens</small></header>
            <ul>
              {FOUNDATION_SECTIONS.map(section => {
                const selected = section.id === tokenSectionId;
                const groups = TOKEN_GROUPS.filter(section.includes);
                return <li key={section.id}>
                  <button type="button" class={`sds-token-nav__module${selected ? ' is-active' : ''}`}
                    aria-expanded={selected} onClick={() => { setTokenSectionId(section.id); setTokenGroupId(null); }}>
                    <LucideIcon name={section.icon} size={16} /><span>{section.label}</span><em>{groups.reduce((total, group) => total + group.tokens.length, 0)}</em><LucideIcon name={selected ? 'ChevronDown' : 'ChevronRight'} size={13} />
                  </button>
                  {selected && <ul class="sds-token-nav__children">
                    <li><button type="button" class={!tokenGroupId ? 'is-active' : ''} onClick={() => setTokenGroupId(null)}>All {section.label.toLowerCase()}</button></li>
                    {groups.map(group => <li key={group.id}><button type="button" class={tokenGroupId === group.id ? 'is-active' : ''}
                      onClick={() => setTokenGroupId(group.id)}>{group.label.replace(/^Semantic\s*[—-]\s*/i, '')}<em>{group.tokens.length}</em></button></li>)}
                  </ul>}
                </li>;
              })}
            </ul>
            <footer><LucideIcon name="ShieldCheck" size={16} /><span><strong>Draft only</strong><small>Nothing reaches the app until publish.</small></span></footer>
          </nav>
        ) : <div class="sds-nav__menu">
            <button type="button" class={`sds-nav__home${active === 'components' && !openId ? ' is-active' : ''}`}
              aria-current={active === 'components' && !openId ? 'page' : undefined}
              onClick={openComponents}>
              <LucideIcon name="Home" size={16} /> Overview
            </button>
            {NAV.map(group => (
              <nav class="sds-nav__group" data-nav-group={group.label} key={group.label}>
              <button type="button" class="sds-nav__gh"
                aria-expanded={!collapsed[group.label]}
                onClick={() => setCollapsed(current => ({ ...current, [group.label]: !current[group.label] }))}>
                {group.label}
                <LucideIcon name={collapsed[group.label] ? 'ChevronDown' : 'ChevronUp'} size={14} />
              </button>
              {!collapsed[group.label] && <ul>
                {/* Every built component gets its OWN row, as the reference does
                    — one list of everything was a catalogue, not navigation.
                    Read from the registry, so a new component appears here by
                    existing. A family collapses to one row with its members
                    nested, which is the only grouping in this rail. */}
                {group.items.filter(item => !(group.label === 'Components' && item.id === 'components')).map(item => (
                  <li key={item.id}>
                    <button type="button"
                      class={`sds-nav__item${item.id === active && !openId ? ' is-active' : ''}`}
                      aria-current={item.id === active && !openId ? 'page' : undefined}
                      onClick={() => { setActive(item.id); setOpenId(null); }}>
                      <LucideIcon name={item.icon} size={16} />
                      {item.label}
                    </button>
                  </li>
                ))}
                {group.label === 'Components' && COMPONENT_ROWS.flatMap(row => row.kind === 'family'
                  ? row.children.map(def => <li key={def.id}>
                      <button type="button" class={`sds-nav__item sds-nav__item--sub${openId === def.id ? ' is-active' : ''}`}
                        aria-current={openId === def.id ? 'page' : undefined}
                        onClick={() => { setActive('components'); setOpenId(def.id); }}>
                        {def.name}
                      </button>
                    </li>)
                  : <li key={row.def.id}>
                      <button type="button" class={`sds-nav__item sds-nav__item--sub${openId === row.def.id ? ' is-active' : ''}`}
                        aria-current={openId === row.def.id ? 'page' : undefined}
                        onClick={() => { setActive('components'); setOpenId(row.def.id); }}>
                        {row.def.name}
                      </button>
                    </li>
                )}
              </ul>
              }
              </nav>
            ))}
          </div>}

        {onExit && (
          <button type="button" class="sds-nav__exit" onClick={onExit}>
            <LucideIcon name="ArrowLeft" size={16} /> Back to SIOMAC
          </button>
        )}
      </aside>

      <div class="sds-col">
        <header class="sds-top">
          <StudioPublishBar draft={draft} />
          <div class="sds-top__navrow">
            <Breadcrumbs class="sds-crumbs" items={breadcrumbItems} maxVisible={4} />
            <span class="sds-top__meta">{COMPONENT_DEFS.length} definitions</span>
          </div>
        </header>

        <main ref={mainRef} class="sds-main">
          {active === 'components' && openId && (
            <div class="sds-component-nav" aria-label="Component navigation">
              <button type="button" class="sds-component-nav__all" onClick={openComponents}>
                <LucideIcon name="LayoutGrid" size={15} /> Components
              </button>
              <span aria-hidden="true" />
              <button type="button" aria-label={previousComponent ? `Previous component: ${previousComponent.name}` : 'No previous component'}
                title={previousComponent?.name} disabled={!previousComponent} onClick={() => previousComponent && setOpenId(previousComponent.id)}>
                <LucideIcon name="ArrowLeft" size={16} />
              </button>
              <button type="button" aria-label={nextComponent ? `Next component: ${nextComponent.name}` : 'No next component'}
                title={nextComponent?.name} disabled={!nextComponent} onClick={() => nextComponent && setOpenId(nextComponent.id)}>
                <LucideIcon name="ArrowRight" size={16} />
              </button>
            </div>
          )}
          {APP_SCENE[active] && (
            /* One preview; the nav item chooses its opening scene. `key` remounts
               it so switching nav moves the scene rather than keeping stale state. */
            <PreviewScope attach={attachScope}>
              <AppPreview key={active} initialScene={APP_SCENE[active]} />
            </PreviewScope>
          )}
          {active === 'brand-overview' && (
            <BrandOverview draft={draft} logoUrl={logoUrl} onOpenThemeGenerator={() => { setActive('brand-theme'); setOpenId(null); }} />
          )}
          {active === 'components' && (openFamily?.id === 'buttons' && (openFamily.id === openId || openPattern)
            ? <ButtonBrowser family={openFamily} draft={draft} selectedPattern={openPattern}
                onOpenComponent={setOpenId} onOpenPattern={setOpenId} />
            : openFamily?.id === openId
              ? <FamilyBrowser family={openFamily} onOpenComponent={setOpenId} />
            : resolvedDef ? (
              <Workbench
                def={resolvedDef}
                draft={draft}
                onSelectMember={setOpenId}
              />
            )
            : <Catalogue onOpen={setOpenId} />)}
          {active === 'foundations' && (
            <PreviewScope attach={attachScope}><FoundationsPanel draft={draft} activeSection={tokenSectionId} activeGroupId={tokenGroupId} /></PreviewScope>
          )}
          {active === 'brand-theme' && (
            <PreviewScope attach={attachScope}>
              <BrandThemePanel draft={draft} logoUrl={logoUrl ?? null} onUploadLogo={onUploadLogo} />
            </PreviewScope>
          )}
        </main>
      </div>
    </div>
  );
}
