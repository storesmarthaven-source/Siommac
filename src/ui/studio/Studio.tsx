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

import { type VNode } from 'preact';
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
import { useGalleryDraft } from '../gallery/galleryStore';
import { FoundationsPanel } from '../gallery/FoundationsPanel';
import { BrandThemePanel } from '../gallery/BrandThemePanel';
import './studio.css';
import { StudioPublishBar } from './StudioPublishBar';
import { ComponentThumbnail } from './componentThumbnail';

export interface StudioProps {
  onExit?: () => void;
  logoUrl?: string | null;
  /** Resolves to the stored logo URL — the host owns the upload endpoint. */
  onUploadLogo?: (dataUrl: string) => Promise<string>;
}

/* ── Navigation ───────────────────────────────────────────────────────────── */

type SectionId =
  | 'brand-overview' | 'brand-theme' | 'brand-assets'
  | 'foundations'
  | 'components'
  | 'app-shell' | 'app-dashboard' | 'app-forms' | 'app-data' | 'app-workflow';

interface NavItem { id: SectionId; label: string; icon: LucideName; phase?: number }
interface NavGroup { label: string; items: NavItem[] }

const NAV: NavGroup[] = [
  { label: 'Brand', items: [
    { id: 'brand-overview', label: 'Brand Overview',  icon: 'Sparkles' },
    { id: 'brand-theme',    label: 'Theme Generator', icon: 'Palette' },
    { id: 'brand-assets',   label: 'Logo & Assets',   icon: 'Image', phase: 3 },
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

/** Section copy, mirroring the reference's per-tier descriptions. */
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

/**
 * "1 component · N variants", counted the way the reference counts it: variants
 * are PROPS of one component, never separate components. Derived from the
 * definition's own `variant` options, so it cannot disagree with the API.
 */
function variantCount(def: ComponentDef): number {
  const v = def.props?.variant;
  if (!v || (v.type !== 'select' && v.type !== 'segmented')) return 0;
  return v.options.length;
}

function ComponentCard({ def, onOpen }: { def: ComponentDef; onOpen?: (id: string) => void }): VNode {
  const built = isBuilt(def);
  const variants = variantCount(def);
  const caption = built
    ? (variants > 0 ? `1 component · ${variants} variants` : '1 component')
    : def.category === 'patterns' ? 'Application pattern' : 'Planned';

  const body = (
    <>
      <div class="sds-card__preview">
        <ComponentThumbnail id={def.id} category={def.category} built={built} />
        {!built && <span class="sds-card__missing">{def.category === 'patterns' ? 'Owned by its module' : 'Planned'}</span>}
      </div>
      <div class="sds-card__foot">
        <strong>{def.name}</strong>
        <span>{caption}</span>
      </div>
    </>
  );

  if (!built || !onOpen) return <article class="sds-card sds-card--unbuilt">{body}</article>;
  return <button type="button" class="sds-card sds-card--open" onClick={() => onOpen(def.id)}>{body}</button>;
}

/**
 * A family's catalogue card — one entry, one thumbnail.
 *
 * The catalogue answers "what is in the kit", so a family reads as ONE thing
 * here, exactly like every other card: a single image and a caption saying
 * how many types it holds. Previewing all three turned one card into a stacked
 * list and broke the grid's rhythm — the family browser is the place to compare
 * real members with governed usage patterns.
 *
 * Selecting the card opens the browser before any focused editor.
 */
function FamilyCard(
  { family, members, onOpen }:
  { family: ComponentFamily; members: ComponentDef[]; onOpen: (id: string) => void },
): VNode {
  return (
    <button type="button" class="sds-card sds-card--open sds-card--family"
      onClick={() => onOpen(family.id)}>
      <div class="sds-card__preview">
        <ComponentThumbnail id={family.id} category="family" />
      </div>
      <div class="sds-card__foot">
        <strong>{family.name}</strong>
        <span>{members.length} component types</span>
      </div>
    </button>
  );
}

function CatalogueNodeCard(
  { node, onOpen }: { node: CatalogueNode; onOpen?: (id: string) => void },
): VNode {
  if (node.kind === 'component') return <ComponentCard def={node.def} onOpen={onOpen} />;
  return <FamilyCard family={node.family} members={node.members} onOpen={onOpen ?? (() => undefined)} />;
}

function Catalogue({ onOpen }: { onOpen: (id: string) => void }): VNode {
  const groups = componentsByCategory();
  const primitives = groups.filter(g => g.category !== 'patterns');
  const t = registryTotals();

  return (
    <div class="sds-cat">
      <header class="sds-hero">
        <h1><strong>SIOMAC</strong> Design System</h1>
        <p>
          {t.canonical + t.beta} canonical base components — buttons, inputs, badges and the
          primitives every SIOMAC surface is built from — use semantic tokens and CSS recipes,
          with {t.missingPrimitives} primitive gaps. Browse the visual catalogue and open any
          component to edit its live canonical preview.
        </p>
        <button type="button" class="sds-hero__cta"
          onClick={() => document.querySelector('.sds-sec--first')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          Explore components
        </button>
      </header>

      <div class="sds-rule" />

      {primitives.map((g, index) => (
        <section class={`sds-sec${index === 0 ? ' sds-sec--first' : ''}`} key={g.category}>
          <h3>{g.label} <span>{g.built}/{g.total} built</span></h3>
          {SECTION_COPY[g.category] && <p>{SECTION_COPY[g.category]}</p>}
          <div class="sds-grid">
            {g.nodes.map(n => (
              <CatalogueNodeCard node={n} onOpen={onOpen}
                key={n.kind === 'family' ? n.family.id : n.def.id} />
            ))}
          </div>
        </section>
      ))}

      {/*
        The "Application patterns" section is HIDDEN from the catalogue.

        PayrollApprovalTable and DayOneGateCard are page/module compositions,
        not kit components — listing them made the Studio look like it owned
        payroll and onboarding. They remain registered so the coverage gate and
        `registryTotals` still count them separately (they are `missing`, so no
        code was deleted); this is a display decision, reversible by restoring
        this block.
      */}
    </div>
  );
}

/** Sections whose Studio implementation is a later phase. States the phase
 *  rather than pretending to be a feature. */
function PhasePlaceholder({ title, phase }: { title: string; phase: number }): VNode {
  return (
    <div class="sds-placeholder">
      <h3>{title}</h3>
      <p>Arrives in Studio phase {phase}. Not yet implemented here, and deliberately not faked.</p>
    </div>
  );
}

export function Studio({ onExit, logoUrl, onUploadLogo }: StudioProps = {}): VNode {
  const mainRef = useRef<HTMLElement>(null);
  const [active, setActive] = useState<SectionId>('components');
  const [openId, setOpenId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
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
  ];

  /* The Studio swaps views inside one persistent scrolling main element. Without
     resetting it, opening a card near the bottom of Overview lands halfway down
     the editor and hides the live-preview header and component title. */
  useEffect(() => {
    const main = mainRef.current;
    if (typeof main?.scrollTo === 'function') main.scrollTo({ top: 0, behavior: 'auto' });
  }, [active, openId]);

  return (
    <div class="sds">
      <aside class="sds-nav">
        <div class="sds-nav__brand">
          <span class="sds-nav__mark">SIOMAC</span>
          <span class="sds-nav__sub">Design System</span>
        </div>

        {NAV.map(group => (
          <nav class="sds-nav__group" data-nav-group={group.label} key={group.label}>
            <button type="button" class="sds-nav__gh"
              aria-expanded={!collapsed[group.label]}
              onClick={() => setCollapsed(c => ({ ...c, [group.label]: !c[group.label] }))}>
              {group.label}
              <LucideIcon name={collapsed[group.label] ? 'ChevronDown' : 'ChevronUp'} size={14} />
            </button>
            {!collapsed[group.label] && (
              <ul>
                {group.items.map(item => (
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

                {/* Every built component gets its OWN row, as the reference does
                    — one list of everything was a catalogue, not navigation.
                    Read from the registry, so a new component appears here by
                    existing. A family collapses to one row with its members
                    nested, which is the only grouping in this rail. */}
                {group.label === 'Components' && COMPONENT_ROWS.map(row => (row.kind === 'family'
                  ? (
                    <li key={row.family.id}>
                      <button type="button"
                        class={`sds-nav__item sds-nav__item--sub${openFamily?.id === row.family.id ? ' is-active' : ''}`}
                        onClick={() => { setActive('components'); setOpenId(row.family.id); }}>
                        {row.family.name}
                        <span class="sds-nav__count">{row.children.length}</span>
                      </button>
                      <ul class="sds-nav__kids">
                        {row.children.map(d => (
                          <li key={d.id}>
                            <button type="button"
                              class={`sds-nav__item sds-nav__item--kid${openId === d.id ? ' is-active' : ''}`}
                              aria-current={openId === d.id ? 'page' : undefined}
                              onClick={() => { setActive('components'); setOpenId(d.id); }}>
                              {d.name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </li>
                  )
                  : (
                    <li key={row.def.id}>
                      <button type="button"
                        class={`sds-nav__item sds-nav__item--sub${openId === row.def.id ? ' is-active' : ''}`}
                        aria-current={openId === row.def.id ? 'page' : undefined}
                        onClick={() => { setActive('components'); setOpenId(row.def.id); }}>
                        {row.def.name}
                      </button>
                    </li>
                  )))}
              </ul>
            )}
          </nav>
        ))}

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
            <BrandOverview draft={draft} logoUrl={logoUrl} onUploadLogo={onUploadLogo} />
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
            <PreviewScope attach={attachScope}><FoundationsPanel draft={draft} /></PreviewScope>
          )}
          {active === 'brand-theme' && (
            <PreviewScope attach={attachScope}>
              <BrandThemePanel draft={draft} logoUrl={logoUrl ?? null} onUploadLogo={onUploadLogo} />
            </PreviewScope>
          )}
          {current.phase != null && <PhasePlaceholder title={current.label} phase={current.phase} />}
        </main>
      </div>
    </div>
  );
}
