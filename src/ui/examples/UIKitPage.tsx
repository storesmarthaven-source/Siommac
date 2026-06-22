/**
 * src/ui/examples/UIKitPage.tsx
 *
 * The living catalog for the Siomac UI System — a read-only reference that
 * renders every `@ui` component with realistic props and all its variants.
 * Mounted as the "UI Kit" tab in the Superadmin Console.
 *
 * Rule: every component exported from `@ui` should appear here. If it's worth
 * being in the design system, it's worth showing in the catalog. (A future
 * superadmin theme-editor will live alongside this view.)
 */

import { type VNode, type ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import {
  PageHero, ModuleTabs, withCounts, SectionHead,
  MetricCard, SparkCard, ChartCard, MiniCard, RecordRow, StatusPill,
  Sparkline, BarRow, ProgressBar,
  Button, Field, TextInput, SelectInput, TextareaInput, FormGrid,
  Toolbar, SearchInput, FilterSelect,
  RegisterTable, Tabs,
  Modal, Wizard, Drawer,
  SplitLayout,
  type ModuleTab, type TabDef, type Column,
} from '@ui';
import { ThemeEditor } from './ThemeEditor';

// ── Catalog scaffolding ─────────────────────────────────────────────────────────

function Section({ id, title, sub, children }: { id: string; title: string; sub: string; children: ComponentChildren }): VNode {
  return (
    <section id={id} style={{ marginBottom: 'var(--space-10)', scrollMarginTop: '16px' }}>
      <div style={{ borderBottom: '2px solid var(--border)', paddingBottom: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        <h3 style={{ color: 'var(--siomac-navy)', fontSize: '1rem', fontWeight: 700, margin: 0 }}>{title}</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: '4px 0 0' }}>{sub}</p>
      </div>
      {children}
    </section>
  );
}

/** A labelled example tile with a soft surface so components read clearly. */
function Demo({ label, children, wide }: { label: string; children: ComponentChildren; wide?: boolean }): VNode {
  return (
    <div style={{
      gridColumn: wide ? '1 / -1' : undefined,
      border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
      background: 'var(--bg-subtle)', padding: 'var(--space-4)',
    }}>
      <div style={{ fontSize: '0.66rem', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>{label}</div>
      {children}
    </div>
  );
}

function Grid({ children, min = '260px' }: { children: ComponentChildren; min?: string }): VNode {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${min}, 1fr))`, gap: 'var(--space-3)' }}>{children}</div>;
}

// ── Sample data ─────────────────────────────────────────────────────────────────

const SAMPLE_TABS: ModuleTab[] = withCounts(
  [
    { key: 'register',  label: 'Register',    sublabel: 'All records', icon: 'fa-list-ul' },
    { key: 'open',      label: 'Open',        sublabel: 'In progress', icon: 'fa-folder-open' },
    { key: 'closed',    label: 'Closed',      sublabel: 'Resolved',    icon: 'fa-circle-check' },
  ],
  { register: 128, open: 14, closed: 114 },
);

const DRAWER_TABS: TabDef[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'timeline', label: 'Timeline' },
];

const TABLE_COLS: Column[] = [
  { label: 'Ref' }, { label: 'Title' }, { label: 'Owner' }, { label: 'Status', width: '120px' },
];

const TONES = ['positive', 'caution', 'negative', 'critical', 'info', 'neutral'] as const;

// ── Page ─────────────────────────────────────────────────────────────────────────

export function UIKitPage(): VNode {
  const [tab, setTab]         = useState('register');
  const [drawerTab, setDrawerTab] = useState('overview');
  const [text, setText]       = useState('');
  const [sel, setSel]         = useState('Medium');
  const [area, setArea]       = useState('');
  const [search, setSearch]   = useState('');
  const [filter, setFilter]   = useState('');

  const [modalOpen, setModalOpen]   = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing]       = useState(false);

  return (
    <div style={{ maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0, flex: 1 }}>
          Every component below comes from <code>@ui</code> and is themed entirely through design
          tokens. This is the single source of truth for how the app looks. Toggle the theme editor
          to change tokens live and persist them app-wide — the catalog doubles as a preview.
        </p>
        <Button variant={editing ? 'primary' : 'blue'} icon="fa-palette" onClick={() => setEditing(e => !e)}>
          {editing ? 'Close editor' : 'Edit theme'}
        </Button>
      </div>

      {editing && <ThemeEditor />}

      {/* PAGE SHAPE ----------------------------------------------------------- */}
      <Section id="uikit-pageshape" title="Page shape" sub="The standard module page: hero (four stat cards) → optional spark row → navigation tabs → content.">
        <Demo label="PageHero — four stat cards + KPI footer" wide>
          <PageHero
            icon="fa-shield-halved"
            title="Example Module"
            watermarkClass="hse-wm-risk"
            stats={[
              { icon: 'fa-list-ul',              label: 'Records',      value: 128, sub: 'on register', color: 'blue' },
              { icon: 'fa-folder-open',          label: 'Open',         value: 14,  sub: 'in progress', color: 'gold' },
              { icon: 'fa-triangle-exclamation', label: 'Overdue',      value: 3,   sub: 'need action', color: 'red', trend: '2', trendDown: false },
              { icon: 'fa-circle-check',         label: 'Closed',       value: 114, sub: 'this year',   color: 'green' },
            ]}
            footerItems={[
              { icon: 'fa-gauge', label: 'Completion', value: '89% closed', progress: 89 },
              { icon: 'fa-clock', label: 'Avg. cycle', value: '4.2 days', pill: '● On target', pillVariant: 'green' },
            ]}
          />
        </Demo>
        <div style={{ height: 'var(--space-3)' }} />
        <Demo label="ModuleTabs — navigation with counts + sublabels" wide>
          <ModuleTabs
            icon="fa-shield-halved" title="Example Module" sub="Navigation tabs with per-tab counts"
            tabs={SAMPLE_TABS} active={tab} onSelect={setTab}
            actionLabel="New Record" onAction={() => {}}
          />
        </Demo>
        <div style={{ height: 'var(--space-3)' }} />
        <Demo label="SectionHead — table/register header" wide>
          <SectionHead variant="register" icon="fa-list-ul" title="Incidents" sub="All reported incidents"
            actions={<Button variant="secondary" icon="fa-download">Export</Button>} />
        </Demo>
      </Section>

      {/* BUTTONS -------------------------------------------------------------- */}
      <Section id="uikit-buttons" title="Buttons" sub="One Button component, five variants. Footer/CTA buttons across the app use these.">
        <Demo label="Variants" wide>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
            <Button variant="primary" icon="fa-circle-plus">Primary</Button>
            <Button variant="blue" icon="fa-paper-plane">Blue</Button>
            <Button variant="secondary" icon="fa-download">Secondary</Button>
            <Button variant="outline" icon="fa-pen">Outline</Button>
            <Button variant="accent" icon="fa-trash">Accent</Button>
            <Button variant="primary" disabled>Disabled</Button>
          </div>
        </Demo>
      </Section>

      {/* STATUS --------------------------------------------------------------- */}
      <Section id="uikit-status" title="Status pills" sub="All status colour comes through statusTokens — never a local colour switch.">
        <Demo label="Tones" wide>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {TONES.map(t => <StatusPill key={t} tone={t}>{t}</StatusPill>)}
          </div>
        </Demo>
      </Section>

      {/* CARDS & METRICS ------------------------------------------------------ */}
      <Section id="uikit-cards" title="Cards & metrics" sub="The metric vocabulary used in the spark row and inside tabs.">
        <Grid>
          <Demo label="SparkCard — sparkline">
            <SparkCard spark={{ label: 'Incidents', value: '12', sub: 'last 6 months', delta: '8%', deltaUp: false, sparkPoints: [8, 6, 9, 5, 7, 4], sparkColor: '#ef4444' }} />
          </Demo>
          <Demo label="SparkCard — progress">
            <SparkCard spark={{ label: 'CAPA closure', value: '76%', sub: 'on-time', progress: { pct: 76, color: '#22c55e', target: 'Target: 80%' } }} />
          </Demo>
          <Demo label="SparkCard — bars">
            <SparkCard spark={{ label: 'By type', value: '34', sub: 'open hazards', bars: [
              { label: 'Safety', value: 18, max: 34, color: '#ef4444' },
              { label: 'Health', value: 9, max: 34, color: '#f59e0b' },
              { label: 'Env.',   value: 7, max: 34, color: '#3b82f6' },
            ] }} />
          </Demo>
          <Demo label="MetricCard — shell with custom body">
            <MetricCard icon="fa-list-check" title="Open Actions">
              <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--siomac-navy)' }}>27</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>5 due this week</div>
            </MetricCard>
          </Demo>
          <Demo label="ChartCard — titled container">
            <ChartCard label="Trend" headerRight={<StatusPill tone="positive">▲ 12%</StatusPill>}>
              <Sparkline points={[3, 5, 4, 8, 6, 11]} color="#22c55e" />
            </ChartCard>
          </Demo>
          <Demo label="MiniCard">
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <MiniCard icon="fa-helmet-safety" value="240" label="PPE issued" />
              <MiniCard icon="fa-user-check" value="98%" label="Compliance" />
            </div>
          </Demo>
          <Demo label="RecordRow">
            <div style={{ display: 'grid', gap: '6px' }}>
              <RecordRow icon="fa-check" title="Harness inspection" sub="No defects found." pill="Pass" pillClass="vt-pill is-on" />
              <RecordRow icon="fa-xmark" title="Glove contamination" sub="Disposal required." pill="Fail" pillClass="vt-pill is-off" />
            </div>
          </Demo>
        </Grid>
      </Section>

      {/* CHARTS --------------------------------------------------------------- */}
      <Section id="uikit-charts" title="Charts" sub="Standalone mini-chart primitives for building breakdowns anywhere.">
        <Grid>
          <Demo label="Sparkline"><Sparkline points={[4, 7, 5, 9, 6, 10]} color="#3b82f6" /></Demo>
          <Demo label="ProgressBar"><ProgressBar pct={64} color="#22c55e" target="Target: 80%" /></Demo>
          <Demo label="BarRow">
            <div style={{ display: 'grid', gap: '10px' }}>
              <BarRow label="Critical" value={2} max={20} color="#ef4444" />
              <BarRow label="High" value={6} max={20} color="#f59e0b" />
              <BarRow label="Medium" value={12} max={20} color="#3b82f6" />
            </div>
          </Demo>
        </Grid>
      </Section>

      {/* FORMS ---------------------------------------------------------------- */}
      <Section id="uikit-forms" title="Forms" sub="The standard field + control spec. Every form in every module uses these.">
        <Demo label="FormGrid + Field + inputs" wide>
          <FormGrid>
            <Field label="Title"><TextInput value={text} onInput={setText} placeholder="e.g. Confined space entry" /></Field>
            <Field label="Severity"><SelectInput value={sel} onInput={setSel} options={['Low', 'Medium', 'High', 'Critical']} /></Field>
            <Field label="Description" wide><TextareaInput value={area} onInput={setArea} placeholder="Describe the item…" /></Field>
          </FormGrid>
        </Demo>
        <div style={{ height: 'var(--space-3)' }} />
        <Demo label="Toolbar — SearchInput + FilterSelect" wide>
          <Toolbar>
            <SearchInput value={search} onInput={setSearch} placeholder="Search records…" />
            <FilterSelect value={filter} onChange={setFilter} options={['Open', 'Closed', 'Overdue']} allLabel="All statuses" />
          </Toolbar>
        </Demo>
      </Section>

      {/* DATA ----------------------------------------------------------------- */}
      <Section id="uikit-data" title="Data" sub="Register table and the in-panel tab bar.">
        <Demo label="RegisterTable" wide>
          <RegisterTable columns={TABLE_COLS} footer={<span>Showing 3 of 128</span>}>
            {[
              ['INC-2026-0001', 'Slip near loading bay', 'A. Baptiste', <StatusPill tone="caution">Open</StatusPill>],
              ['INC-2026-0002', 'Chemical spill — Lab 2', 'R. Singh', <StatusPill tone="critical">Critical</StatusPill>],
              ['INC-2026-0003', 'Near miss — forklift', 'M. Joseph', <StatusPill tone="positive">Closed</StatusPill>],
            ].map((r, i) => (
              <tr key={i}>
                {r.map((cell, j) => <td key={j} style={{ padding: '9px 16px', fontSize: '0.8rem' }}>{cell}</td>)}
              </tr>
            ))}
          </RegisterTable>
        </Demo>
        <div style={{ height: 'var(--space-3)' }} />
        <Demo label="Tabs — in-panel bar" wide>
          <Tabs tabs={DRAWER_TABS} active={drawerTab} onChange={setDrawerTab} />
        </Demo>
      </Section>

      {/* OVERLAYS ------------------------------------------------------------- */}
      <Section id="uikit-overlays" title="Overlays — the standard window" sub="Modal, Wizard and Drawer all obey one window spec: header, close top-right, footer buttons bottom-right.">
        <Demo label="Open the live overlays" wide>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <Button variant="primary" icon="fa-window-maximize" onClick={() => setModalOpen(true)}>Open Modal</Button>
            <Button variant="blue" icon="fa-wand-magic-sparkles" onClick={() => { setWizardStep(0); setWizardOpen(true); }}>Open Wizard</Button>
            <Button variant="secondary" icon="fa-table-columns" onClick={() => setDrawerOpen(true)}>Open Drawer</Button>
          </div>
        </Demo>
      </Section>

      {/* LAYOUTS -------------------------------------------------------------- */}
      <Section id="uikit-layouts" title="Layouts" sub="SplitLayout — wide content column + context aside, used inside area tabs.">
        <Demo label="SplitLayout" wide>
          <SplitLayout
            main={<RegisterTable columns={[{ label: 'Item' }, { label: 'Status', width: '120px' }]}>
              <tr><td style={{ padding: '9px 16px', fontSize: '0.8rem' }}>Main content column</td><td style={{ padding: '9px 16px' }}><StatusPill tone="info">Wide</StatusPill></td></tr>
            </RegisterTable>}
            aside={<div class="hse-aside-card"><div class="hse-aside-head"><i class="fas fa-circle-info" /><span>Context aside</span></div><p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: '8px 0' }}>Narrow sidebar for queues, summaries, and details.</p></div>}
          />
        </Demo>
      </Section>

      {/* ── Live overlay instances ── */}
      <Modal
        open={modalOpen} icon="fa-circle-info" title="Standard Modal"
        sub="One header, one close button top-right, footer buttons bottom-right."
        onClose={() => setModalOpen(false)}
        onSubmit={() => setModalOpen(false)} submitLabel="Save"
      >
        <FormGrid>
          <Field label="Name"><TextInput value="" onInput={() => {}} placeholder="Enter a name" /></Field>
          <Field label="Type"><SelectInput value="" onInput={() => {}} options={['Type A', 'Type B']} placeholder="Select…" /></Field>
          <Field label="Notes" wide><TextareaInput value="" onInput={() => {}} placeholder="Optional notes" /></Field>
        </FormGrid>
      </Modal>

      <Wizard
        open={wizardOpen} icon="fa-wand-magic-sparkles" title="Standard Wizard"
        steps={['Details', 'Options', 'Review']}
        step={wizardStep} onStepChange={setWizardStep}
        onClose={() => setWizardOpen(false)}
        onSubmit={() => setWizardOpen(false)} submitLabel="Create"
      >
        {wizardStep === 0 && <FormGrid><Field label="Title" wide><TextInput value="" onInput={() => {}} placeholder="Step 1 — details" /></Field></FormGrid>}
        {wizardStep === 1 && <FormGrid><Field label="Option" wide><SelectInput value="" onInput={() => {}} options={['One', 'Two']} placeholder="Step 2 — choose" /></Field></FormGrid>}
        {wizardStep === 2 && <p style={{ fontSize: '0.85rem' }}>Step 3 — review and confirm. The footer shows Back · Cancel · Create.</p>}
      </Wizard>

      <Drawer
        open={drawerOpen} title="Standard Drawer" sub="Slide-in detail panel"
        onClose={() => setDrawerOpen(false)}
        details={[
          { label: 'Reference', value: 'INC-2026-0001' },
          { label: 'Status', value: <StatusPill tone="caution">Open</StatusPill> },
          { label: 'Owner', value: 'A. Baptiste' },
          { label: 'Opened', value: '22 Jun 2026' },
        ]}
      >
        <Tabs tabs={DRAWER_TABS} active={drawerTab} onChange={setDrawerTab} />
        <div style={{ padding: 'var(--space-3) 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          {drawerTab === 'overview' ? 'Overview content for the selected record.' : 'A timeline of events for this record.'}
        </div>
      </Drawer>
    </div>
  );
}
