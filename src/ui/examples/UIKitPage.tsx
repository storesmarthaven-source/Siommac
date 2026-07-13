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
  PageHero, ModuleTabs, TabBar, PageHeader, MetricRow, withCounts, SectionHead,
  Card, SparkCard, StatsCard, KpiTile, ChartCard, MiniCard, RecordRow, StatusPill,
  Sparkline, BarRow, ProgressBar,
  Button, NewMenu, Field, TextInput, SelectInput, TextareaInput, FormGrid,
  Toolbar, SearchInput, FilterSelect,
  PersonSearchSelect, type PersonSearchOption,
  PersonCell, TableSearch, FilterDropdown, AdvancedFilter, ActiveFilters, useFilterDropdowns, type AdvTab,
  RegisterTable, Tabs,
  Skeleton, SkeletonText, TableSkeleton, ListSkeleton, SkeletonFields, SkeletonStatGrid,
  Spinner, EmptyState,
  Modal, Wizard, Drawer,
  SplitLayout,
  type ModuleTab, type TabDef, type Column,
} from '@ui';
import { ThemeEditor } from './ThemeEditor';
import { UserPill } from '@shared/UserPill';
import { AccountPill } from '@shared/AccountPill';

// ── Catalog scaffolding ─────────────────────────────────────────────────────────

function Section({ id, title, sub, children }: { id: string; title: string; sub: string; children: ComponentChildren }): VNode {
  return (
    <section id={id} style={{ marginBottom: 'var(--space-10)', scrollMarginTop: '16px' }}>
      <div style={{ borderBottom: '2px solid var(--border)', paddingBottom: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        <h3 style={{ color: 'var(--siomac-navy)', fontSize: '1rem', fontWeight: 'var(--font-weight-bold)', margin: 0 }}>{title}</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: '4px 0 0' }}>{sub}</p>
      </div>
      {children}
    </section>
  );
}

const DEMO_PEOPLE: PersonSearchOption[] = [
  { id: 'p1', name: 'Amara Diallo', subtitle: 'EMP-0010 · Field Engineer', photoUrl: null },
  { id: 'p2', name: 'Jordan Alexander', subtitle: 'EMP-0021 · Supervisor', photoUrl: null },
  { id: 'p3', name: 'Priya Ramkissoon', subtitle: 'EMP-0034 · HR Officer', photoUrl: null },
];

/** A labelled example tile with a soft surface so components read clearly. */
function Demo({ label, children, wide }: { label: string; children: ComponentChildren; wide?: boolean }): VNode {
  return (
    <div style={{
      gridColumn: wide ? '1 / -1' : undefined,
      border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
      background: 'var(--bg-subtle)', padding: 'var(--space-4)',
    }}>
      <div style={{ fontSize: '0.66rem', fontWeight: 'var(--font-weight-bold)', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>{label}</div>
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
  const [personId, setPersonId] = useState('');

  // Table toolbox demo state — PersonCell + the shared @ui/table filter toolbar.
  const { openId, setOpenId } = useFilterDropdowns();
  const [kitSearch, setKitSearch] = useState('');
  const [kitStatus, setKitStatus] = useState<string[]>([]);
  const [kitDept, setKitDept]     = useState<string[]>([]);
  const [kitFrom, setKitFrom]     = useState('');
  const [kitTo, setKitTo]         = useState('');
  const [kitMin, setKitMin]       = useState('');
  const [kitMax, setKitMax]       = useState('');
  const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
  const kitAdvTabs: AdvTab[] = [
    { name: 'Organization', blurb: 'Filter by department.', sections: [
      { type: 'checklist', title: 'Department', options: ['Operations', 'Finance', 'HR'], selected: kitDept, onChange: setKitDept },
    ] },
    { name: 'Dates & range', sections: [
      { type: 'dateRange', title: 'Hired between', from: kitFrom, to: kitTo, onChange: (f, t) => { setKitFrom(f); setKitTo(t); } },
      { type: 'numberRange', title: 'Rate', unit: '%', min: kitMin, max: kitMax, onChange: (mn, mx) => { setKitMin(mn); setKitMax(mx); } },
    ] },
  ];
  const kitChips = [
    ...kitStatus.map(s => ({ label: cap(s), onRemove: () => setKitStatus(kitStatus.filter(x => x !== s)) })),
    ...kitDept.map(d => ({ label: d, onRemove: () => setKitDept(kitDept.filter(x => x !== d)) })),
  ];

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

      {/* PAGE GUIDE ----------------------------------------------------------- */}
      <Section id="uikit-guide" title="Building a page — the standard" sub="Two page shapes. Build from these primitives only — see src/ui/PAGE_GUIDE.md for the full guide + skeleton.">
        <Grid min="340px">
          <Demo label="Module dashboard (one per module)">
            <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '0.8rem', color: 'var(--text-primary)', lineHeight: 1.7 }}>
              <li><strong>PageHero</strong> — dark hero, 4 rearrangeable stat cards (<code>pageKey</code>)</li>
              <li>KPI footer + dashboard content</li>
            </ul>
          </Demo>
          <Demo label="Sub-module page (Incidents, Risk &amp; JSA, …)">
            <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '0.8rem', color: 'var(--text-primary)', lineHeight: 1.7 }}>
              <li><strong>PageHeader</strong> — light, info-only (breadcrumb + title + sub + meta chips)</li>
              <li><strong>MetricRow</strong> — 4 rearrangeable cards (<code>pageKey</code>)</li>
              <li><strong>TabBar</strong> — bare tabs, then content</li>
            </ul>
          </Demo>
        </Grid>
        <div style={{ height: 'var(--space-3)' }} />
        <Demo label="The rules" wide>
          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '0.8rem', color: 'var(--text-primary)', lineHeight: 1.8 }}>
            <li>Headers are <strong>info-only</strong> — no action buttons (those go in the tab content)</li>
            <li><strong>One UserPill</strong> per page (the app header) — never in a page/hero</li>
            <li><strong>All cards use <code>&lt;Card&gt;</code></strong> — never hand-roll <code>.inc-mini-card</code></li>
            <li>Four-card rows are <strong>rearrangeable</strong> (<code>pageKey</code>: <code>&lt;module&gt;.&lt;area&gt;</code>)</li>
            <li>Overlays use <strong>Modal / Wizard / Drawer</strong>; forms use <strong>Field</strong> + inputs</li>
            <li>Theme through <strong>tokens only</strong>; data through <strong>authenticated APIs</strong> + the module service adapter</li>
          </ul>
        </Demo>
      </Section>

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
            actionLabel="New Record" onAction={() => { /* noop */ }}
          />
        </Demo>
        <div style={{ height: 'var(--space-3)' }} />
        <Demo label="PageHeader — standard sub-module header (breadcrumb + meta chips + actions)" wide>
          <PageHeader
            icon="fa-triangle-exclamation" module="HSE" title="Incidents"
            sub="Report, triage and investigate workplace incidents and near-misses."
            meta={[
              { icon: 'fa-calendar', label: 'Jan – Jun 2026' },
              { icon: 'fa-location-dot', label: 'All sites' },
              { icon: 'fa-hashtag', label: '6 records' },
            ]}
          />
        </Demo>
        <div style={{ height: 'var(--space-3)' }} />
        <Demo label="MetricRow — rearrangeable cards. Click Arrange, then drag: the card fades to a placeholder, neighbours glide out of the way (FLIP), the drop target rings red. Order persists per-user." wide>
          <MetricRow cards={[
            { key: 'a', node: <SparkCard spark={{ label: 'Open', value: '14', sub: 'in progress', sparkPoints: [4, 6, 5, 8, 6, 14], sparkColor: '#f59e0b' }} /> },
            { key: 'b', node: <SparkCard spark={{ label: 'Overdue', value: '3', sub: 'need action', delta: '2', deltaUp: true, sparkPoints: [1, 0, 2, 1, 3, 3], sparkColor: '#ef4444' }} /> },
            { key: 'c', node: <SparkCard spark={{ label: 'Closure', value: '76%', progress: { pct: 76, color: '#22c55e', target: 'Target: 80%' } }} /> },
            { key: 'd', node: <SparkCard spark={{ label: 'Closed', value: '114', sub: 'this year', sparkPoints: [80, 88, 95, 102, 110, 114], sparkColor: '#16a34a' }} /> },
          ]} />
        </Demo>
        <div style={{ height: 'var(--space-3)' }} />
        <Demo label="TabBar — bare tabs (sit under PageHeader; no second header)" wide>
          <TabBar tabs={SAMPLE_TABS} active={tab} onSelect={setTab} />
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
        <div style={{ height: 'var(--space-3)' }} />
        <Demo label="Header action buttons — the page-header standard (40px · navy primary · Lucide #667085 menu icons)" wide>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" class="hse-btn"><i class="fas fa-download" /> Export</button>
            <NewMenu items={[
              { label: 'New Rate Version',   icon: 'FilePlus2', sub: 'Draft a statutory version', onSelect: () => { /* noop */ } },
              { label: 'New Pay Component',  icon: 'Layers',    sub: 'Add an earning or deduction', onSelect: () => { /* noop */ } },
              { label: 'Import NIS Classes', icon: 'FileInput', sub: 'Bulk-load from CSV',          onSelect: () => { /* noop */ } },
            ]} />
          </div>
        </Demo>
      </Section>

      {/* USER PILL (global top bar) ------------------------------------------- */}
      <Section id="uikit-userpill" title="UserPill — the global top bar" sub="The single top bar mounted once in the app shell on every page: global search (⌘K) + AI assistant, and the AccountPill (notifications / messages / tickets + profile + account menu) in the corner. Bare <UserPill /> is the search + account bar; pass title/sub/module/crumbs/meta/nav to add page context.">
        <Demo label="Global bar — bare (search + account)" wide><UserPill /></Demo>
        <div style={{ height: 'var(--space-3)' }} />
        <Demo label="With page context (title · breadcrumb · meta)" wide>
          <UserPill icon="fa-users" title="Employee Master" sub="All personnel records" module="HR" crumbs={['People']} meta={[{ icon: 'fa-circle-dot', label: '128 active' }]} />
        </Demo>
      </Section>

      {/* ACCOUNT PILL --------------------------------------------------------- */}
      <Section id="uikit-accountpill" title="AccountPill — profile & quick actions" sub="The account cluster inside UserPill: profile menu (My Profile · Settings · About · Log out) plus notification / message / ticket quick actions. Self-populates from the session store. Customize with variant · iconsFirst · showNotif/showMsg/showTicket · compact.">
        <Grid min="300px">
          <Demo label="Default"><AccountPill /></Demo>
          <Demo label="Icons first (top bar corner)"><AccountPill iconsFirst /></Demo>
          <Demo label="Compact — avatar + caret only"><AccountPill compact /></Demo>
          <Demo label="Notifications only (msg + ticket off)"><AccountPill showMsg={false} showTicket={false} /></Demo>
          <Demo label="No quick-action icons"><AccountPill showNotif={false} showMsg={false} showTicket={false} /></Demo>
          <Demo label="On a dark panel (variant='onDark')">
            <div style={{ background: 'var(--siomac-navy)', padding: 'var(--space-4)', borderRadius: 'var(--radius-sm)' }}>
              <AccountPill variant="onDark" />
            </div>
          </Demo>
        </Grid>
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
      <Section id="uikit-statscard" title="StatsCard — the standard summary card" sub="The DEFAULT skeleton for the four top cards on every module page. Configure header colour + slots (metric, supporting, status dots, chart, percent bar, footer). Body always fills — percentage cards MUST pass `percent` for a compliance bar.">
        <div class="ui-stat-row" style={{ marginBottom: '16px' }}>
          <StatsCard icon="fa-list-check" title="Open Actions" metric={27} metricUnit="open"
            statuses={[
              { label: 'Critical', value: 4, color: '#ef4444' },
              { label: 'High',     value: 9, color: '#f59e0b' },
              { label: 'Medium',   value: 14, color: '#60a5fa' },
            ]}
            footer="5 due this week" />
          <StatsCard icon="fa-gauge-high" title="Overall Compliance" metric="25%"
            supporting="Current / total competency slots"
            percent={25} percentColor="#f59e0b" percentTarget="Target 85%" />
          <StatsCard icon="fa-bolt" title="Severity Mix" variant="navy" metric={34} metricUnit="incidents"
            chart={
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <BarRow label="Critical" value={6}  max={34} color="#ef4444" />
                <BarRow label="High"     value={11} max={34} color="#f59e0b" />
                <BarRow label="Moderate" value={17} max={34} color="#60a5fa" />
              </div>
            } />
          <StatsCard icon="fa-shield-halved" title="Control Coverage" variant="navy" metric="82%"
            supporting="Hazards with verified controls"
            percent={82} percentColor="#4ade80" percentTarget="Target 85%" />
        </div>
      </Section>

      <Section id="uikit-kpitile" title="KpiTile — the standard plain KPI card" sub="The compact metric tile for the KPI strip at the top of a page: coloured icon chip + number + name, one supporting line, and an optional drill link. This is the PLAIN tile — distinct from the chart cards above (StatsCard). Use variant='text' for a label value like an active-version name.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '14px', marginBottom: '16px' }}>
          <KpiTile icon="fa-pen-to-square" tone="purple" label="Draft Versions" value={3}
            sub="2 awaiting review" link={{ label: 'View versions', onClick: () => { /* demo: no navigation */ } }} />
          <KpiTile icon="fa-layer-group" tone="teal" label="Pay Components" value={18}
            sub="4 inactive" link={{ label: 'View components', onClick: () => { /* demo: no navigation */ } }} />
          <KpiTile icon="fa-clock" tone="amber" label="Verification Queue" value={5}
            sub={<><span class="ui-kpi-dot ui-kpi-dot--amber" />Needs attention</>}
            link={{ label: 'View queue', onClick: () => { /* demo: no navigation */ } }} />
          <KpiTile variant="text" icon="fa-file-lines" label="Active Version" value="2026 T&T Statutory v1"
            sub={<><span class="ui-kpi-dot ui-kpi-dot--green" />Effective 05 Jan 2026</>} />
        </div>
        <Demo label="KpiTile loading">
          <div style={{ width: '220px' }}><KpiTile icon="fa-users" tone="blue" label="NIS Classes" value="" loading /></div>
        </Demo>
      </Section>

      <Section id="uikit-skeleton" title="Skeletons — cold-load placeholders" sub="USE ONLY when there is no data yet. Where cached/placeholder data exists, render the real data. Never a fake '0'. Gate with loading={q.isLoading && !q.data}.">
        <Grid>
          <Demo label="StatsCard loading">
            <StatsCard icon="fa-list-check" title="Open Actions" loading />
          </Demo>
          <Demo label="Skeleton + SkeletonText">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
              <Skeleton circle width={40} />
              <Skeleton height={14} width={140} />
            </div>
            <SkeletonText lines={3} />
          </Demo>
          <Demo label="ListSkeleton">
            <ListSkeleton rows={4} />
          </Demo>
          <Demo label="SkeletonFields (FieldList / DetailGrid loading)">
            <SkeletonFields rows={4} />
          </Demo>
          <Demo label="TableSkeleton — firstCellAvatar (register rows with an avatar)" wide>
            <table class="vt-table"><tbody><TableSkeleton rows={4} cols={5} firstCellAvatar /></tbody></table>
          </Demo>
          <Demo label="SkeletonStatGrid (KPI row cold load)" wide>
            <SkeletonStatGrid count={4} />
          </Demo>
          <Demo label="Spinner — compact / numeric sections (not a full skeleton)">
            <Spinner center label="Loading…" />
          </Demo>
          <Demo label="EmptyState — rich section empty (icon · title · text · note)" wide>
            <EmptyState icon="fa-folder-open" title="No documents uploaded"
              text="Add employee IDs, contracts, certificates or onboarding records."
              note="Uploaded files appear here with type, expiry, verification status and audit history." />
          </Demo>
        </Grid>
      </Section>

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
          <Demo label="Card — standard shell (header + body)">
            <Card icon="fa-list-check" title="Open Actions" headerRight={<span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>MTD</span>}>
              <div style={{ fontSize: '1.6rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--siomac-navy)' }}>27</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>5 due this week</div>
            </Card>
          </Demo>
          <Demo label="Card — navy variant (control/watch tiles)">
            <Card icon="fa-file-shield" title="Regulatory Watch" variant="navy">
              <div style={{ fontSize: '1.6rem', fontWeight: 'var(--font-weight-bold)', color: '#fca5a5' }}>2</div>
              <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,.55)' }}>OSH reviews due</div>
            </Card>
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
        <div style={{ height: 'var(--space-3)' }} />
        <Demo label="PersonSearchSelect — search a person by name/ID, see their photo" wide>
          <div style={{ maxWidth: '360px' }}>
            <Field label="Worker">
              <PersonSearchSelect options={DEMO_PEOPLE} value={personId} onChange={setPersonId} placeholder="Search by name or ID…" />
            </Field>
          </div>
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

      {/* TABLE TOOLBOX -------------------------------------------------------- */}
      <Section id="uikit-tabletoolbox" title="Table toolbox" sub="Person cells and the shared filter toolbar (search · basic filter · advanced filter · active chips) — one source of truth for every register table (Employee Master, the statutory registers, DataTable).">
        <Demo label="PersonCell — profile photo (or coloured initials) + name, optional meta / sub. Drop into any DataTable column.">
          <div style={{ display: 'grid', gap: '10px' }}>
            <PersonCell name="Camille Rampersad" meta="· EMP-FIN01" />
            <PersonCell name="Amara Diallo" sub="Field Engineer · Operations" meta="· EMP-0010" />
            <PersonCell name="" loading />
          </div>
        </Demo>
        <div style={{ height: 'var(--space-3)' }} />
        <Demo label="Filter toolbar — TableSearch · FilterDropdown (basic) · AdvancedFilter (tabbed) · ActiveFilters chips" wide>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <TableSearch value={kitSearch} onChange={setKitSearch} placeholder="Search records…" />
            <FilterDropdown id="kit-status" label="Status" options={['active', 'pending', 'retired']} selected={kitStatus}
              onChange={setKitStatus} openId={openId} setOpenId={setOpenId} labelFn={cap} />
            <AdvancedFilter id="kit-adv" tabs={kitAdvTabs} openId={openId} setOpenId={setOpenId}
              onReset={() => { setKitDept([]); setKitFrom(''); setKitTo(''); setKitMin(''); setKitMax(''); }} />
          </div>
          <div style={{ height: 'var(--space-2)' }} />
          {kitChips.length
            ? <ActiveFilters chips={kitChips} onClearAll={() => { setKitStatus([]); setKitDept([]); }} />
            : <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>Pick a Status or Department to see active-filter chips.</p>}
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
          <Field label="Name"><TextInput value="" onInput={() => { /* noop */ }} placeholder="Enter a name" /></Field>
          <Field label="Type"><SelectInput value="" onInput={() => { /* noop */ }} options={['Type A', 'Type B']} placeholder="Select…" /></Field>
          <Field label="Notes" wide><TextareaInput value="" onInput={() => { /* noop */ }} placeholder="Optional notes" /></Field>
        </FormGrid>
      </Modal>

      <Wizard
        open={wizardOpen} icon="fa-wand-magic-sparkles" title="Standard Wizard"
        steps={['Details', 'Options', 'Review']}
        step={wizardStep} onStepChange={setWizardStep}
        onClose={() => setWizardOpen(false)}
        onSubmit={() => setWizardOpen(false)} submitLabel="Create"
      >
        {wizardStep === 0 && <FormGrid><Field label="Title" wide><TextInput value="" onInput={() => { /* noop */ }} placeholder="Step 1 — details" /></Field></FormGrid>}
        {wizardStep === 1 && <FormGrid><Field label="Option" wide><SelectInput value="" onInput={() => { /* noop */ }} options={['One', 'Two']} placeholder="Step 2 — choose" /></Field></FormGrid>}
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
