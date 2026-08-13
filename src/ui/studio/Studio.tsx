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
 *     The card previews are LIVE `def.render()` calls, so unlike the reference's
 *     static thumbnails they cannot go stale.
 *
 *  2. `patterns` are NOT kit gaps. PayrollApprovalTable belongs to payroll and
 *     DayOneGateCard to onboarding; they are built FROM primitives by the module
 *     that owns the domain. They get their own section, exactly as the reference
 *     separates "Base components" from "Application UI components".
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { Workbench } from './Workbench';
import { BrandOverview } from './BrandOverview';
import { AppPreview, type Scene } from './AppPreview';
import { PreviewScope } from './PreviewScope';
import {
  COMPONENT_DEFS, componentsByCategory, registryTotals, findComponent,
  isBuilt, defaultProps, type ComponentDef,
} from '../registry';
import { LucideIcon, type LucideName } from '../LucideIcon';
import { useGalleryDraft } from '../gallery/galleryStore';
import { FoundationsPanel } from '../gallery/FoundationsPanel';
import { BrandThemePanel } from '../gallery/BrandThemePanel';
import './studio.css';

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

/** Built components, in catalogue order — one nav row each. */
const BUILT_COMPONENTS: ComponentDef[] = componentsByCategory()
  .filter(g => g.category !== 'patterns')
  .flatMap(g => g.items.filter(isBuilt));

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
        {built && def.render
          /* A LIVE canonical render, not a screenshot — it cannot go stale. */
          ? <div class="sds-card__specimen">{def.render(defaultProps(def), 'default')}</div>
          : <span class="sds-card__missing">
              {def.category === 'patterns' ? 'Owned by its module' : 'Not built yet'}
            </span>}
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

function Catalogue({ onOpen }: { onOpen: (id: string) => void }): VNode {
  const groups = componentsByCategory();
  const patterns = groups.filter(g => g.category === 'patterns');
  const primitives = groups.filter(g => g.category !== 'patterns');
  const t = registryTotals();

  return (
    <div class="sds-cat">
      <header class="sds-hero">
        <h1><strong>SIOMAC</strong> Design System</h1>
        <p>
          {t.canonical + t.beta} canonical components built on semantic tokens and CSS recipes,
          with {t.missingPrimitives} primitive gaps recorded honestly. Every card below is a live
          render of the real component — change its recipe and this page changes with it.
        </p>
        <button type="button" class="sds-hero__cta"
          onClick={() => document.querySelector('.sds-sec--first')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          Explore components
        </button>
      </header>

      <div class="sds-rule" />

      <section class="sds-sec sds-sec--first">
        <h2>Base components</h2>
        <p>Buttons, inputs, badges — the primitives every SIOMAC surface is built from.</p>
      </section>

      {primitives.map(g => (
        <section class="sds-sec" key={g.category}>
          <h3>{g.label} <span>{g.built}/{g.total} built</span></h3>
          {SECTION_COPY[g.category] && <p>{SECTION_COPY[g.category]}</p>}
          <div class="sds-grid">{g.items.map(d => <ComponentCard def={d} key={d.id} onOpen={onOpen} />)}</div>
        </section>
      ))}

      <div class="sds-rule" />

      {patterns.map(g => (
        <section class="sds-sec" key={g.category}>
          <h2>Application patterns</h2>
          <p>
            Compositions built FROM canonical primitives by the module that owns the domain —
            payroll owns PayrollApprovalTable, onboarding owns DayOneGateCard. Listed so the
            catalogue is honest about the application, never counted as design-system gaps.
          </p>
          <div class="sds-grid">{g.items.map(d => <ComponentCard def={d} key={d.id} />)}</div>
        </section>
      ))}
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
  const [active, setActive] = useState<SectionId>('components');
  const [openId, setOpenId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const draft = useGalleryDraft();
  /* Destructured so the lint rule can tell a scope-callback from a ref: every
     preview surface must ATTACH the scope, not merely carry the attribute — the
     draft applies its values to the one element handed to attachScope. */
  const attachScope = draft.attachScope;

  const flat = NAV.flatMap(g => g.items);
  const current = flat.find(i => i.id === active) ?? flat[0]!;
  const openDef = openId ? findComponent(openId) : undefined;
  const groupOf = NAV.find(g => g.items.some(i => i.id === active))?.label ?? '';

  return (
    <div class="sds">
      <aside class="sds-nav">
        <div class="sds-nav__brand">
          <span class="sds-nav__mark">SIOMAC</span>
          <span class="sds-nav__sub">Design System</span>
        </div>

        {NAV.map(group => (
          <nav class="sds-nav__group" key={group.label}>
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
                    Built only: a planned component has no workbench to open, and
                    a nav row that opens nothing is a dead control. Read from the
                    registry, so a new component appears here by existing. */}
                {group.label === 'Components' && BUILT_COMPONENTS.map(d => (
                  <li key={d.id}>
                    <button type="button"
                      class={`sds-nav__item sds-nav__item--sub${openId === d.id ? ' is-active' : ''}`}
                      aria-current={openId === d.id ? 'page' : undefined}
                      onClick={() => { setActive('components'); setOpenId(d.id); }}>
                      {d.name}
                    </button>
                  </li>
                ))}
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
          <nav class="sds-crumbs" aria-label="Breadcrumb">
            <span>{groupOf}</span>
            <LucideIcon name="ChevronRight" size={14} />
            <span class="is-current">{openDef ? openDef.name : current.label}</span>
          </nav>
          <span class="sds-top__meta">{COMPONENT_DEFS.length} registered definitions</span>
        </header>

        <main class="sds-main">
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
          {active === 'components' && (openDef
            ? <Workbench def={openDef} onBack={() => setOpenId(null)} />
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
