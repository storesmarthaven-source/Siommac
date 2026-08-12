/**
 * src/ui/registry/containers.defs.tsx — Containers.
 *
 * ONE Card card. Surface, panel, metric and action are its `variant`; compact /
 * standard / comfortable are its `density`; the semantic accent is its `tone`.
 * They are shown as props and examples INSIDE one entry, never as sibling
 * entries — reproducing "KpiCard, MetricCard, RailCard, SummaryCard" in a nicer
 * Gallery would rebuild exactly the fragmentation this kit exists to remove.
 */

import { LucideIcon } from '../LucideIcon';
import { Badge } from '../primitives/Badge';
import { Button } from '../primitives/Button';
import { Card, CardHeader, CardFooter } from '../containers/Card';
import { CARD_COMPARISON } from './comparisons';
import { type ComponentDef, type PropValues } from './types';
import { type CardVariant, type CardTone, type CardDensity, type CardAccent } from '../containers/Card';

const s = (v: PropValues[string] | undefined, f = ''): string => (typeof v === 'string' ? v : f);
const b = (v: PropValues[string] | undefined): boolean => v === true;
const noop = (): void => { /* preview */ };

/** The figure content a metric card carries. Deliberately NOT part of Card. */
function Figure({ value, caption, delta }: { value: string; caption: string; delta?: string }): preact.JSX.Element {
  return (
    <>
      <div style={{ fontSize: '1.75rem', fontWeight: 600, lineHeight: 1, letterSpacing: '-0.02em' }}>{value}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{caption}</span>
        {delta && <Badge tone="success" size="sm">{delta}</Badge>}
      </div>
    </>
  );
}

export const cardDef: ComponentDef = {
  id: 'card',
  name: 'Card',
  category: 'containers',
  description: 'ONE surface container. It owns padding, border, radius, background, elevation, header/footer spacing, the interactive/selected/disabled states and the semantic accent — and nothing about content. KPI, metric, panel and action are variants of it, not components beside it.',
  status: 'stable',
  componentPath: 'src/ui/containers/Card/Card.tsx',
  importFrom: '@ui',
  migration: {
    replaces: ['.inc-mini-card', '.hse-spark-card', '.ppe-mini-card', '.ui-stat-card', '.ui-kpi', '.ui-info-card', '.emp-card'],
    deprecatedImports: ['MetricCard', 'ChartCard', 'MiniCard', 'RecordRow', 'StatsCard', 'SparkCard', 'KpiTile', 'InfoCard', 'StatCard'],
    nextSurface: 'DataTable',
    notes: [
      'MetricCard, ChartCard and MiniCard/RecordRow are DELETED. StatsCard, SparkCard, KpiTile and InfoCard survive as legacy CONTENT compositions and migrate one surface at a time — build-new → migrate → delete, never a dual system.',
      'A migration is not finished when <Card> appears in the JSX. The superseded surface CSS must be deleted in the same change, because a recipe can never out-rank a legacy `!important` (RECIPES.md §4).',
      'The payroll creation wizard is the first completed pure-surface family: all 17 legacy `.card` frames and their duplicate frame/header/body CSS were removed while its SummaryCard composition was preserved.',
      'The payroll run workspace completes the clean Card surface pass: 33 legacy frame definitions/call sites now use Card through the preserved RunPanel, close/release, calculation-failure and crew compositions; the scoped frame/header/body CSS is deleted.',
      'Domain compositions (StatsCard, KpiTile, SparkCard, InfoCard, EmployeeCard, weather/deadline/widget/toast cards) are preserved. PPEManager.tsx and Incidents.tsx remain named debt because their existing lint blockers make them unsafe Card batches.',
      'An actionable card is a <div> with a stretched control on top, not a <button> wrapping the content: a <button> may not contain the edit/delete overlays and drill-through links real cards carry. The trade-off is that text in an actionable card is not selectable.',
    ],
  },


  comparison: CARD_COMPARISON,
  props: {
    variant:     { type: 'segmented', label: 'Variant', options: ['surface', 'panel', 'metric', 'action'], default: 'surface' },
    density:     { type: 'segmented', label: 'Density', options: ['compact', 'standard', 'comfortable'], default: 'standard' },
    tone:        { type: 'select',    label: 'Tone', options: ['neutral', 'accent', 'success', 'warning', 'danger', 'info'], default: 'neutral', help: 'Meaning, not decoration. It colours the accent, the hover border and the selected ring — never the whole surface. A repainted surface is an Alert.' },
    accent:      { type: 'segmented', label: 'Accent', options: ['none', 'left', 'top'], default: 'none', help: 'Defaults to `left` on its own as soon as a non-neutral tone is set.' },
    header:      { type: 'boolean',   label: 'Header', default: true },
    description: { type: 'boolean',   label: 'Header description', default: false },
    headerAction:{ type: 'boolean',   label: 'Header action', default: false },
    footer:      { type: 'boolean',   label: 'Footer', default: false },
    interactive: { type: 'boolean',   label: 'Actionable (whole card)', default: false },
    selected:    { type: 'boolean',   label: 'Selected', default: false },
    disabled:    { type: 'boolean',   label: 'Disabled', default: false },
    loading:     { type: 'boolean',   label: 'Loading', default: false },
    flush:       { type: 'boolean',   label: 'Flush body', default: false, help: 'The frame only — for content that owns its own padding (a media band, a table).' },
  },

  style: [
    { label: 'Frame', controls: [
      { name: '--ui-card-radius',       label: 'Corner radius', kind: 'size' },
      { name: '--ui-card-border',       label: 'Border', kind: 'color' },
      { name: '--ui-card-border-width', label: 'Border width', kind: 'size' },
      { name: '--ui-card-bg',           label: 'Background', kind: 'color' },
      { name: '--ui-card-shadow',       label: 'Elevation', kind: 'text' },
    ] },
    { label: 'Rhythm', controls: [
      { name: '--ui-card-pad-x', label: 'Padding X', kind: 'size' },
      { name: '--ui-card-pad-y', label: 'Padding Y', kind: 'size' },
      { name: '--ui-card-gap',   label: 'Body gap', kind: 'size' },
    ] },
    { label: 'Header & footer', controls: [
      { name: '--ui-card-header-bg',          label: 'Header background', kind: 'color' },
      { name: '--ui-card-header-border',      label: 'Header rule', kind: 'color' },
      { name: '--ui-card-header-font-size',   label: 'Title size', kind: 'size' },
      { name: '--ui-card-header-font-weight', label: 'Title weight', kind: 'text' },
      { name: '--ui-card-desc-fg',            label: 'Description text', kind: 'color' },
      { name: '--ui-card-footer-bg',          label: 'Footer background', kind: 'color' },
      { name: '--ui-card-footer-fg',          label: 'Footer text', kind: 'color' },
    ] },
    { label: 'States', controls: [
      { name: '--ui-card-hover-shadow',     label: 'Hover elevation', kind: 'text' },
      { name: '--ui-card-hover-lift',       label: 'Hover lift', kind: 'size' },
      { name: '--ui-card-selected-bg',      label: 'Selected background', kind: 'color' },
      { name: '--ui-card-selected-ring',    label: 'Selected ring', kind: 'color-alpha' },
      { name: '--ui-card-disabled-opacity', label: 'Disabled opacity', kind: 'text' },
      { name: '--ui-card-accent-width',     label: 'Accent width', kind: 'size' },
    ] },
    { label: 'Tones', controls: [
      { name: '--ui-card-tone-accent',  label: 'Accent', kind: 'color' },
      { name: '--ui-card-tone-success', label: 'Success', kind: 'color' },
      { name: '--ui-card-tone-warning', label: 'Warning', kind: 'color' },
      { name: '--ui-card-tone-danger',  label: 'Danger', kind: 'color' },
      { name: '--ui-card-tone-info',    label: 'Info', kind: 'color' },
    ] },
  ],

  states: ['default', 'hover', 'focus', 'active', 'selected', 'disabled', 'loading'],
  compare: ['default', 'hover', 'selected', 'disabled'],

  a11y: {
    role: 'None on a static card — it is a grouping box, and a role would make a screen reader announce every tile in a strip.',
    name: 'Its heading, via `CardHeader`. An ACTIONABLE card takes the required `actionLabel`, because the stretched control has no text of its own.',
    keyboard: [
      { keys: 'Tab',           does: 'Reaches an actionable card once, then any controls inside it.' },
      { keys: 'Enter / Space', does: 'Activates an actionable card — from the native <button>, so Space does not also scroll the page.' },
    ],
    focus: 'The focus ring is drawn INSIDE the surface (a negative outline offset), because cards legitimately clip their content and an outset ring on a descendant is silently clipped away.',
    notes: [
      'An actionable card is a <div> with a stretched control over it, NOT a <button> wrapping the content — a <button> may not contain a button or a link, and card overlays, drill-through links and row menus are exactly that.',
      'Nested controls must be raised above the hit target. `CardHeader`\'s actions are raised automatically; anything else needs the `ui-card-raise` class.',
      'Pass `selected` ONLY for a card that is genuinely a toggle: on an actionable card it emits aria-pressed, which promises that clicking flips it.',
      'Set `level={null}` on CardHeader for tiles in a KPI strip. A strip of <h3>s destroys the heading outline a screen-reader user navigates by.',
      'Tone is never the only signal. A danger card still needs a word — the accent bar is reinforcement, not the message.',
    ],
  },

  render: (p, st) => {
    const variant = s(p.variant, 'surface') as CardVariant;
    const tone = s(p.tone, 'neutral') as CardTone;
    const interactive = b(p.interactive) || st === 'selected';
    const selected = b(p.selected) || st === 'selected';

    const header = b(p.header)
      ? (
        <CardHeader
          title={variant === 'metric' ? 'Open incidents' : 'Overall compliance'}
          level={variant === 'metric' ? null : 3}
          description={b(p.description) ? 'Rolling 30 days, all sites.' : undefined}
          icon={<LucideIcon name="ShieldCheck" />}
          actions={b(p.headerAction)
            ? <Button variant="ghost" size="sm" iconOnly aria-label="Card options" iconLeft={<LucideIcon name="EllipsisVertical" />} />
            : undefined}
        />
      )
      : undefined;

    const footer = b(p.footer)
      ? <CardFooter><span>Updated 2 minutes ago</span><Button variant="link" size="sm">View all</Button></CardFooter>
      : undefined;

    const body = variant === 'metric'
      ? <Figure value="18" caption="4 overdue" delta="−12%" />
      : <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Every site reported on time this period. Two corrective actions remain open against the Q2 audit.
        </p>;

    const common = {
      variant,
      tone,
      accent: s(p.accent, 'none') as CardAccent,
      density: s(p.density, 'standard') as CardDensity,
      header,
      footer,
      selected: b(p.selected) || st === 'selected' ? true : undefined,
      disabled: b(p.disabled) || st === 'disabled',
      loading: b(p.loading) || st === 'loading',
      flush: b(p.flush),
      forceState: st,
    } as const;

    return interactive || selected
      ? <Card {...common} onClick={noop} actionLabel="Open overall compliance">{body}</Card>
      : <Card {...common}>{body}</Card>;
  },

  code: p => {
    const variant = s(p.variant, 'surface');
    const lines = [
      '<Card',
      variant !== 'surface' ? `  variant="${variant}"` : '',
      s(p.tone, 'neutral') !== 'neutral' ? `  tone="${s(p.tone)}"` : '',
      s(p.density, 'standard') !== 'standard' ? `  density="${s(p.density)}"` : '',
      b(p.flush) ? '  flush' : '',
      b(p.loading) ? '  loading={query.isLoading && !query.data}' : '',
      b(p.disabled) ? '  disabled' : '',
      b(p.selected) ? '  selected' : '',
      b(p.interactive) ? '  onClick={() => open(id)}\n  actionLabel="Open overall compliance"' : '',
      b(p.header)
        ? `  header={<CardHeader title="Overall compliance"${b(p.description) ? ' description="Rolling 30 days, all sites."' : ''}${variant === 'metric' ? ' level={null}' : ''}${b(p.headerAction) ? ' actions={<Button variant="ghost" size="sm" iconOnly aria-label="Card options"><MoreVertical /></Button>}' : ''} />}`
        : '',
      b(p.footer) ? '  footer={<CardFooter>Updated 2 minutes ago</CardFooter>}' : '',
      '>',
      '  {/* CONTENT — the figure, the chart, the list. The card owns the surface, not this. */}',
      '  <ComplianceFigure value={data.percent} />',
      '</Card>',
    ];
    return lines.filter(Boolean).join('\n');
  },

  presets: [
    { label: 'Content card',   props: { variant: 'surface', density: 'standard', tone: 'neutral', accent: 'none', header: true, description: true, headerAction: false, footer: false, interactive: false, selected: false, disabled: false, loading: false, flush: false } },
    { label: 'Section panel',  props: { variant: 'panel', density: 'standard', tone: 'neutral', accent: 'none', header: true, description: true, headerAction: true, footer: true, interactive: false, selected: false, disabled: false, loading: false, flush: false } },
    { label: 'KPI tile',       props: { variant: 'metric', density: 'compact', tone: 'neutral', accent: 'none', header: true, description: false, headerAction: false, footer: false, interactive: false, selected: false, disabled: false, loading: false, flush: false } },
    { label: 'Action card',    props: { variant: 'action', density: 'standard', tone: 'neutral', accent: 'none', header: true, description: true, headerAction: true, footer: false, interactive: true, selected: false, disabled: false, loading: false, flush: false } },
    { label: 'Selected',       props: { variant: 'action', density: 'standard', tone: 'accent', accent: 'left', header: true, description: false, headerAction: false, footer: false, interactive: true, selected: true, disabled: false, loading: false, flush: false } },
    { label: 'Toned (danger)', props: { variant: 'surface', density: 'standard', tone: 'danger', accent: 'left', header: true, description: true, headerAction: false, footer: false, interactive: false, selected: false, disabled: false, loading: false, flush: false } },
    { label: 'Cold load',      props: { variant: 'metric', density: 'compact', tone: 'neutral', accent: 'none', header: true, description: false, headerAction: false, footer: false, interactive: false, selected: false, disabled: false, loading: true, flush: false } },
  ],

  examples: [
    {
      id: 'one-surface',
      title: 'One surface, four rhythms',
      description: 'Nine card components differed in what they DREW, not in what kind of surface they were. These are the same component.',
      render: () => (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px' }}>
          <Card variant="metric" density="compact" header={<CardHeader title="Open incidents" level={null} />}>
            <Figure value="18" caption="4 overdue" />
          </Card>
          <Card variant="surface" header={<CardHeader title="Site note" />}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Night shift handover completed.</span>
          </Card>
          <Card variant="panel" density="compact" header={<CardHeader title="Corrective actions" actions={<Badge tone="warning" size="sm">2 open</Badge>} />}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Both due this Friday.</span>
          </Card>
          <Card variant="action" onClick={noop} actionLabel="Start a new inspection"
            header={<CardHeader icon={<LucideIcon name="ClipboardCheck" />} title="New inspection" description="Start from a template" />} />
        </div>
      ),
    },
    {
      id: 'tone-scale',
      title: 'Tone is meaning, not decoration',
      description: 'A tone colours the accent, the hover border and the selected ring. It never repaints the surface — a repainted card reads as a banner, which is Alert\'s job.',
      render: () => (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
          {(['success', 'warning', 'danger', 'info'] as CardTone[]).map(tone => (
            <Card key={tone} variant="metric" density="compact" tone={tone}
              header={<CardHeader title={`${tone[0]!.toUpperCase()}${tone.slice(1)} signal`} level={null} />}>
              <Figure value="7" caption="this week" />
            </Card>
          ))}
        </div>
      ),
    },
    {
      id: 'actionable-with-controls',
      title: 'An actionable card that still has its own controls',
      description: 'This is why the card is a <div> with a stretched control rather than a <button> wrapper. The Edit button is a real button, reachable by Tab, and clicking it does not fire the card.',
      render: () => (
        <div style={{ maxWidth: '320px' }}>
          <Card
            variant="action"
            onClick={noop}
            actionLabel="View Sarah James"
            header={<CardHeader
              icon={<LucideIcon name="User" />}
              title="Sarah James"
              description="Safety Officer · EMP-00484"
              actions={<Button variant="ghost" size="sm" iconOnly aria-label="Edit Sarah James" iconLeft={<LucideIcon name="Pencil" />} />}
            />}
            footer={<CardFooter><span>Started 8 Mar 2021</span><Badge tone="success" size="sm" dot>Active</Badge></CardFooter>}
          >
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>HSE · Georgetown</span>
          </Card>
        </div>
      ),
    },
  ],
};

export const CONTAINER_DEFS: readonly ComponentDef[] = [cardDef];
