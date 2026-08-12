/**
 * src/ui/registry/comparisons/tabs.cmp.tsx — every real tab strip.
 *
 * Only the strips on currently-built pages are candidates. The Onboarding strip
 * is plain buttons in a row — no tablist, no roving tabindex, no arrow keys — so
 * its BEHAVIOUR is not on the ballot; the v2 engine is kept regardless. Its
 * VISUAL treatment is entirely a live option, and "use the Onboarding look with
 * the v2 engine" is exactly the kind of answer this screen is for.
 *
 * The `PanelTabs` (`.ui-panel-tab`) specimen was REMOVED on 2026-08-10. It was
 * restored here on the premise that the Statutory rate-version drawer still
 * shipped it; that premise is now false — the drawer renders the canonical
 * `<Tabs variant="contained" size="sm">` (StatutoryConfigOverview.tsx). A design
 * no page renders is not a candidate, and leaving it on the ballot invites
 * choosing a treatment that cannot be pointed at anywhere in the app.
 */

import { type ComparisonSet } from '../types';
import { Tabs } from '../../navigation/Tabs';
import { LucideIcon } from '../../LucideIcon';

const noop = (): void => { /* preview */ };

export const TABS_COMPARISON: ComparisonSet = {
  summary:
    'One legacy tab treatment is still on a currently-built page — the Onboarding strip (bold label + a count pill) — plus the v2 rebuild, which the Statutory drawer already renders. The HSE tab bars and the pre-kit drawer tabs belong to legacy pages and are listed for removal.',

  specimens: [
    {
      id: 'B',
      name: 'Onboarding / Package detail tabs (`.obx-*`)',
      source: 'src/components/sections/HR — .obx-tab-panel + the package detail strip',
      generation: 'recent',
      consumers: 16,
      consumerNote: 'The Onboarding surface, including the newest enterprise screens.',
      usedByRecentScreens: true,
      features: ['plain label + count', 'section-wrapped panels', 'no icons'],
      a11y: ['Plain buttons — no tablist'],
      render: () => (
        <div class="obx-section" style={{ padding: '10px' }}>
          <div style={{ display: 'flex', gap: '18px', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
            {[['Task templates', '12'], ['Handoff templates', '3'], ['Custom actions', '5']].map(([l, n], i) => (
              <button key={l} type="button" class={`obx-btn${i === 0 ? ' primary' : ''}`} style={{ border: 'none', background: 'transparent', fontWeight: 600, color: i === 0 ? 'var(--siomac-navy)' : 'var(--text-muted)' }}>
                {l} <span class="obx-pill blue" style={{ marginLeft: 4 }}>{n}</span>
              </button>
            ))}
          </div>
        </div>
      ),
    },
    {
      id: 'C',
      name: 'Canonical Tabs (UI Kit v2)',
      source: 'src/ui/navigation/Tabs/',
      generation: 'v2',
      consumers: 3,
      consumerNote: 'HSE Documents, HR package detail, the Statutory drawer.',
      usedByRecentScreens: false,
      features: [
        '3 variants (underline / contained / subtle) × 2 orientations × 3 sizes',
        'icons, sub-labels, count badges (0 renders)', 'disabled with a reason',
        'maxVisible → a canonical "More" menu', 'right-aligned actions slot', 'automatic vs manual activation',
      ],
      a11y: [
        'Real tablist / tab / tabpanel with aria-controls + aria-labelledby',
        'Roving tabindex — the SET is one tab stop, not nine',
        '← → horizontal, ↑ ↓ vertical, Home/End, disabled skipped and wrapped',
        'Accessible name built explicitly so a count does not announce as "Tasks4"',
        'The "More" trigger is not role="tab"',
      ],
      defects: ['The red underline, the 2px indicator and the neutral badge were chosen by the recipe defaults, not against these alternatives.'],
      render: () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Tabs id="cmp-underline" label="Underline" value="docs" onChange={noop}
            items={[
              { id: 'docs', label: 'Documents',   description: 'Controlled library', icon: <LucideIcon name="FolderOpen" />, badge: 4 },
              { id: 'sds',  label: 'SDS Library', description: 'Chemical register',  icon: <LucideIcon name="FlaskConical" />, badge: 4 },
              { id: 'arch', label: 'Archive',     description: 'Superseded',         icon: <LucideIcon name="Archive" /> },
            ]} />
          <Tabs id="cmp-contained" label="Contained" variant="contained" size="sm" value="paye" onChange={noop}
            items={[
              { id: 'summary', label: 'Summary' }, { id: 'paye', label: 'PAYE Bands' },
              { id: 'nis', label: 'NIS Classes' }, { id: 'hs', label: 'Health Surcharge' },
              { id: 'runs', label: 'Linked Runs' }, { id: 'audit', label: 'Audit' },
            ]} maxVisible={4} />
          <Tabs id="cmp-subtle" label="Subtle" variant="subtle" size="sm" value="tasks" onChange={noop}
            items={[{ id: 'details', label: 'Details' }, { id: 'tasks', label: 'Tasks', badge: 4 }, { id: 'audit', label: 'Audit' }]} />
        </div>
      ),
    },
  ],

  aspects: [
    { id: 'selected',   label: 'Selected treatment', question: 'Bold navy text + a blue count pill (Onboarding) · the v2 red underline / tinted chip / filled pill.' },
    { id: 'height',     label: 'Height & padding',   question: 'The Onboarding strip inherits its button padding; the v2 scale is sm/md/lg.' },
    { id: 'content',    label: 'Tab content',        question: 'Label + count pill (Onboarding) · the v2 icon + label + sub-label + badge.' },
    { id: 'rail',       label: 'Rail / divider',     question: 'A full-width rule under the strip, or none.' },
    { id: 'badge',      label: 'Count badge',        question: 'Blue pill (Onboarding) or the v2 neutral pill that inverts when selected.' },
    { id: 'overflow',   label: 'Overflow',           question: 'A "More" menu showing the active label, or a horizontally scrolling strip.' },
    { id: 'width',      label: 'Tab width',          question: 'Content-width tabs (the Onboarding strip) or equal-width columns.' },
  ],

  retire: [
    { name: 'TabBar (.hse-tabs-bar)', source: 'src/ui/components/ModuleTabs.tsx',
      usedBy: '12 HSE pages + the Notification Centre', uses: 13 },
    { name: 'ModuleTabs / AreaTabs (.hse-tabs-container)', source: 'src/ui/components/ModuleTabs.tsx',
      usedBy: '1 file via ModulePageLayout. Its header duplicates PageHeader.', uses: 1 },
    { name: '@ui/Tabs (.inv-tab-btn, LegacyTabs)', source: 'src/ui/components/Tabs.tsx',
      usedBy: '10 HSE + HR detail drawers', uses: 10 },
  ],

  keepRegardless: [
    'The v2 accessibility engine — tablist/tab/tabpanel, roving tabindex, arrow keys, Home/End, disabled handling. NEITHER current strip has any of it.',
    'The explicit accessible name (so a count does not announce as "Tasks4").',
    'TabPanel unmounting rather than hiding, so a switch does not keep seven queries mounted.',
    'manual activation for panels that cost a request.',
    'The Tabs test suite (27 assertions, mostly keyboard).',
  ],
};
