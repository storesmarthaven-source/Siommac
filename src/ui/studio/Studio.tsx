/**
 * src/ui/studio/Studio.tsx — the SIOMAC Design System Studio shell.
 *
 * Phase 1 of the Studio programme: structure, navigation, neutral chrome and
 * REAL registry integration. The workbench, brand workflow and application
 * preview layer on top of this in later commits (see the report's §"NEXT
 * SESSION" mandate).
 *
 * Two rules this file exists to enforce:
 *
 *  1. The catalogue is READ FROM THE REGISTRY. There is no second list here. A
 *     component appears in the Studio because a definition exists, never because
 *     someone remembered to add a card — that is the whole reason the registry
 *     is authoritative.
 *
 *  2. `patterns` are NOT kit gaps. PayrollApprovalTable belongs to payroll and
 *     DayOneGateCard to onboarding; they are built FROM primitives by the module
 *     that owns the domain. The Studio shows them in their own shelf, clearly
 *     labelled as application patterns, so nobody reads them as missing
 *     primitives and builds business features into the design system. This
 *     mirrors `registryTotals()` and `check-ui-kit-coverage.mjs`; all three must
 *     agree or the Studio is lying about its own catalogue.
 *
 * Existing panels are REUSED, not reimplemented — Foundations and Brand already
 * exist and work, and duplicating them to fill out a shell would be exactly the
 * "duplicate mock components" failure the mandate forbids.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import {
  COMPONENT_DEFS, componentsByCategory, registryTotals,
  isBuilt, type ComponentDef,
} from '../registry';
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

/* ── Navigation ─────────────────────────────────────────────────────────────
   The four-section structure is a product decision, not a folder listing. */

type SectionId =
  | 'brand-overview' | 'brand-theme' | 'brand-assets'
  | 'foundations'
  | 'components'
  | 'app-shell' | 'app-dashboard' | 'app-forms' | 'app-data' | 'app-workflow';

interface NavGroup { label: string; items: { id: SectionId; label: string; phase?: number }[] }

const NAV: NavGroup[] = [
  { label: 'Brand', items: [
    { id: 'brand-overview', label: 'Brand Overview', phase: 3 },
    { id: 'brand-theme',    label: 'Theme Generator' },
    { id: 'brand-assets',   label: 'Logo & Assets', phase: 3 },
  ] },
  { label: 'Foundations', items: [
    { id: 'foundations', label: 'Tokens' },
  ] },
  { label: 'Components', items: [
    { id: 'components', label: 'Catalogue' },
  ] },
  { label: 'Application', items: [
    { id: 'app-shell',    label: 'App Shell',  phase: 4 },
    { id: 'app-dashboard',label: 'Dashboard',  phase: 4 },
    { id: 'app-forms',    label: 'Forms',      phase: 4 },
    { id: 'app-data',     label: 'Data Views', phase: 4 },
    { id: 'app-workflow', label: 'Workflow',   phase: 4 },
  ] },
];

/* ── Catalogue ──────────────────────────────────────────────────────────────*/

function StatusChip({ def }: { def: ComponentDef }): VNode {
  if (isBuilt(def)) return <span class="sds-chip sds-chip--built">Built</span>;
  if (def.category === 'patterns') return <span class="sds-chip sds-chip--pattern">Application pattern</span>;
  return <span class="sds-chip sds-chip--planned">Planned</span>;
}

function ComponentCard({ def }: { def: ComponentDef }): VNode {
  const built = isBuilt(def);
  return (
    <article class={`sds-card${built ? '' : ' sds-card--unbuilt'}`}>
      <header class="sds-card__head">
        <h4>{def.name}</h4>
        <StatusChip def={def} />
      </header>
      <p class="sds-card__desc">{def.description}</p>
      {!built && def.plannedApi && (
        /* An honest planned state — never a fabricated specimen. */
        <pre class="sds-card__api">{def.plannedApi}</pre>
      )}
    </article>
  );
}

function Catalogue(): VNode {
  const groups = componentsByCategory();
  const patterns = groups.filter(g => g.category === 'patterns');
  const primitives = groups.filter(g => g.category !== 'patterns');
  const t = registryTotals();

  return (
    <div class="sds-catalogue">
      <div class="sds-metrics">
        <div class="sds-metric"><b>{t.canonical + t.beta}</b><span>Canonical components</span></div>
        <div class="sds-metric"><b>{t.missingPrimitives}</b><span>Primitive gaps</span></div>
        <div class="sds-metric"><b>{Math.round(t.completeness * 100)}%</b><span>Catalogue complete</span></div>
        <div class="sds-metric sds-metric--muted"><b>{t.modulePatterns}</b><span>Application patterns</span></div>
      </div>

      {primitives.map(g => (
        <section class="sds-shelf" key={g.category}>
          <h3 class="sds-shelf__title">{g.label}<small>{g.built}/{g.total} built</small></h3>
          <div class="sds-grid">{g.items.map(d => <ComponentCard def={d} key={d.id} />)}</div>
        </section>
      ))}

      {patterns.map(g => (
        <section class="sds-shelf sds-shelf--patterns" key={g.category}>
          <h3 class="sds-shelf__title">
            {g.label}<small>owned by their module — not kit gaps</small>
          </h3>
          <p class="sds-shelf__note">
            These are compositions built FROM canonical primitives by the domain that owns
            them. They are listed so the catalogue is honest about what exists in the
            application, not because the design system should implement them.
          </p>
          <div class="sds-grid">{g.items.map(d => <ComponentCard def={d} key={d.id} />)}</div>
        </section>
      ))}
    </div>
  );
}

/** Sections whose Studio implementation is a later phase. States the phase
 *  rather than pretending to be a feature — a panel that lies is worse than a
 *  panel that is honestly not built yet. */
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
  const draft = useGalleryDraft();

  const flat = NAV.flatMap(g => g.items);
  const current = flat.find(i => i.id === active) ?? flat[0]!;

  return (
    <div class="sds">
      <aside class="sds-nav">
        <div class="sds-nav__brand">
          <span class="sds-nav__mark">SIOMAC</span>
          <span class="sds-nav__sub">Design System</span>
        </div>
        {NAV.map(group => (
          <nav class="sds-nav__group" key={group.label}>
            <h2>{group.label}</h2>
            <ul>
              {group.items.map(item => (
                <li key={item.id}>
                  <button
                    type="button"
                    class={`sds-nav__item${item.id === active ? ' is-active' : ''}`}
                    aria-current={item.id === active ? 'page' : undefined}
                    onClick={() => setActive(item.id)}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        ))}
        {onExit && (
          <button type="button" class="sds-nav__exit" onClick={onExit}>← Back to SIOMAC</button>
        )}
      </aside>

      <main class="sds-main">
        <header class="sds-head">
          <h1>{current.label}</h1>
          <p class="sds-head__sub">
            {COMPONENT_DEFS.length} registered definitions · the registry is the source of truth
          </p>
        </header>

        {/* Only preview surfaces carry the customer draft scope — the Studio
            chrome itself stays neutral. See the second-root note in semantic.css. */}
        <div class="sds-body">
          {active === 'components'  && <Catalogue />}
          {active === 'foundations' && <div data-ui-preview-scope><FoundationsPanel draft={draft} /></div>}
          {active === 'brand-theme' && (
            <div data-ui-preview-scope>
              <BrandThemePanel draft={draft} logoUrl={logoUrl ?? null} onUploadLogo={onUploadLogo} />
            </div>
          )}
          {current.phase != null && <PhasePlaceholder title={current.label} phase={current.phase} />}
        </div>
      </main>
    </div>
  );
}
