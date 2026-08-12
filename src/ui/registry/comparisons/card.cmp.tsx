/**
 * src/ui/registry/comparisons/card.cmp.tsx — every real card surface.
 *
 * Only the card treatments on currently-built pages are candidates. They differ
 * mostly in radius, elevation and where the figure sits — which is the argument
 * for one recipe. But WHICH radius and WHICH elevation is a design decision, and
 * it has not been made yet.
 *
 * The canonical Card currently uses `--radius-sm` (10px) and `--shadow-card`,
 * inherited from the DataTable frame. Nothing chose that.
 */

import { type ComparisonSet } from '../types';
import { Card, CardHeader, CardFooter } from '../../containers/Card';
import { KpiTile } from '../../components/KpiTile';
import { InfoCard, FieldList, FieldRow } from '../../components/InfoCard';
import { KpiCard } from '../../hrfin/KpiCard';
import { RailCard } from '../../hrfin/RailCard';
import { LucideIcon } from '../../LucideIcon';
import { Badge } from '../../primitives/Badge';

const noop = (): void => { /* preview */ };

export const CARD_COMPARISON: ComparisonSet = {
  summary:
    'Three card treatments on the currently-built pages — KpiTile (Payroll/Statutory/Employee Master), the Aurora KpiCard/RailCard (Finance) and InfoCard (the detail drawers) — plus the v2 rebuild. The HSE and Employees card systems belong to legacy pages and are listed for removal.',

  specimens: [
    {
      id: 'A',
      name: 'KpiTile (`.ui-kpi`)',
      source: 'src/ui/components/KpiTile.tsx',
      generation: 'module',
      consumers: 5,
      consumerNote: 'Payroll command centre, Statutory dashboard, Employee Master, messenger compliance.',
      usedByRecentScreens: true,
      features: ['tinted icon chip in 8 tones', 'number + name inline', 'sub line', 'footer drill link', 'text variant', 'loading shimmer'],
      a11y: ['A plain <div>', 'The drill link IS a real button', 'loading shows a shimmer rather than a fake 0'],
      render: () => (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <KpiTile icon="fa-folder-open" tone="blue" label="Active Cases" value={24} sub="Approved & active"
            link={{ label: 'View active', onClick: noop }} />
          <KpiTile icon="fa-clock" tone="amber" label="Pending Approval" value={3} sub="Awaiting decision"
            link={{ label: 'Review pending', onClick: noop }} />
        </div>
      ),
    },
    {
      id: 'B',
      name: 'hrfin KpiCard + RailCard (Aurora)',
      source: 'src/ui/hrfin/KpiCard.tsx · RailCard.tsx',
      generation: 'recent',
      consumers: 12,
      consumerNote: 'The whole HR/Finance surface. Built to a mockup, 1:1.',
      usedByRecentScreens: true,
      features: [
        'label + badge head', 'big value', 'support line',
        'absolutely-positioned sparkline / mini-bars / progress meter', 'footer', 'loading skeleton',
        'RailCard: the aside variant with its own title + action',
      ],
      a11y: ['<article> element', 'Visual is aria-hidden', 'No heading element'],
      render: () => (
        <div class="hrfin" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <KpiCard label="Payroll cost" value="TT$1.24M" badge="+3.1%" badgeTone="success"
            support="This period vs last" visual="line" values={[8, 11, 9, 14, 12, 17]} />
          <RailCard title="Approvals">
            <div style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>3 waiting on you</div>
          </RailCard>
        </div>
      ),
    },
    {
      id: 'C',
      name: 'InfoCard (`.ui-info-card`)',
      source: 'src/ui/components/InfoCard.tsx',
      generation: 'module',
      consumers: 3,
      consumerNote: 'The rich detail drawer body — Employee onboarding summary, Drawer, EntityHead.',
      usedByRecentScreens: true,
      features: ['title + head action', 'field list / mini table / pill / callout / activity list', 'loading skeletons per part'],
      a11y: ['<section> with an <h4> title — the only one of the nine with a real heading'],
      render: () => (
        <div style={{ maxWidth: '320px' }}>
          <InfoCard title="Employment" action={<button type="button" class="ui-mini-btn">Edit</button>}>
            <FieldList>
              <FieldRow label="Position" value="Safety Officer" />
              <FieldRow label="Department" value="HSE" />
              <FieldRow label="Started" value="8 Mar 2021" />
            </FieldList>
          </InfoCard>
        </div>
      ),
    },
    {
      id: 'D',
      name: 'Canonical Card (UI Kit v2)',
      source: 'src/ui/containers/Card/Card.tsx + card.recipe.css',
      generation: 'v2',
      consumers: 3,
      consumerNote: 'The three proof migrations only.',
      usedByRecentScreens: false,
      features: [
        '4 variants × 3 densities × 6 tones', 'header/footer slots', 'accent bar (left/top)',
        'interactive with a stretched hit target', 'selected / disabled', 'loading shimmer shaped per variant', 'flush mode',
      ],
      a11y: [
        'Actionable card is a <div> + stretched <button>/<a>, so nested controls stay valid',
        'Real heading element via CardHeader, with level={null} for KPI strips',
        'Focus ring drawn inside the surface so a clipping card cannot hide it',
        'aria-pressed only when `selected` is actually passed',
      ],
      defects: ['Radius (10px) and elevation were inherited from the DataTable frame, not chosen. That is the main thing to decide here.'],
      render: () => (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <Card variant="metric" density="compact" header={<CardHeader title="Open incidents" level={null} />}>
            <div style={{ fontSize: '1.75rem', fontWeight: 600, lineHeight: 1 }}>18</div>
            <span style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>4 overdue</span>
          </Card>
          <Card variant="panel" density="compact" tone="warning"
            header={<CardHeader title="Corrective actions" actions={<Badge tone="warning" size="sm">2 open</Badge>} />}
            footer={<CardFooter><span>Updated 2 min ago</span></CardFooter>}>
            <span style={{ fontSize: '.78rem', color: 'var(--text-muted)' }}>Both due this Friday.</span>
          </Card>
          <Card variant="action" onClick={noop} actionLabel="Start a new inspection"
            header={<CardHeader icon={<LucideIcon name="ClipboardCheck" />} title="New inspection" description="Start from a template" />} />
          <Card loading variant="metric" density="compact" header={<CardHeader title="Loading" level={null} />}>0</Card>
        </div>
      ),
    },
  ],

  aspects: [
    { id: 'radius',    label: 'Corner radius',   question: '8px (Aurora) · 10px (v2) · the KpiTile / InfoCard radii.' },
    { id: 'elevation', label: 'Border & shadow', question: 'Hairline border, soft shadow, both, or neither.' },
    { id: 'header',    label: 'Header treatment',question: 'Label-only head (Aurora) · title + head action (InfoCard) · icon chip beside the figure (KpiTile) · plain title + actions (v2).' },
    { id: 'padding',   label: 'Padding & rhythm',question: 'The internal spacing scale and the gap between a figure and its caption.' },
    { id: 'kpi',       label: 'KPI/metric look', question: 'Tinted icon chip beside the number (KpiTile) or number-first with a delta badge (Aurora).' },
    { id: 'footer',    label: 'Footer',          question: 'Tinted band with a drill link, a plain line, or none.' },
    { id: 'hover',     label: 'Interactive feel',question: 'No lift, or the v2 1px/2px lift.' },
    { id: 'tone',      label: 'Semantic accent', question: 'Accent bar, tinted header, tinted surface, or colour only on the figure.' },
  ],

  retire: [
    { name: 'StatsCard (.ui-stat-card)', source: 'src/ui/components/StatsCard.tsx',
      usedBy: 'Every HSE insight strip — Incidents, Permits, Inspections, RiskJsa, Training', uses: 10 },
    { name: 'SparkCard + ChartCard (.hse-spark-card)', source: 'src/ui/components/SparkCard.tsx · ChartCard.tsx (deleted)',
      usedBy: 'The metric row under every HSE page hero', uses: 8 },
    { name: 'MetricCard (.inc-mini-card)', source: 'src/ui/components/MetricCard.tsx — already deleted',
      usedBy: 'HSE Incidents. Its only importer was itself dead code.', uses: 1 },
    { name: 'MiniCard + RecordRow (.ppe-mini-card)', source: 'src/ui/components/Card.tsx — already deleted',
      usedBy: 'HSE PPE Manager', uses: 1 },
    { name: 'Employee card (.emp-card)', source: 'assets/styles/views.css',
      usedBy: 'The legacy Employees card grid', uses: 1 },
  ],

  keepRegardless: [
    'The stretched-hit-target technique for actionable cards — a <button> wrapper cannot legally contain the row actions these cards carry.',
    'The real heading element and the level={null} escape hatch for KPI strips.',
    'The loading shimmer shaped per variant (never a fake "0").',
    'The Card test suite.',
  ],
};
