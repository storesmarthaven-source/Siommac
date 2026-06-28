// src/ui/widgets/registry.samples.tsx — sample DECLARATIVE widgets (data-defined, no code).
// These exercise the declarative engine that will back installable .zip widget packages, and
// double as format examples for a package's manifest.json. Auto-registered like any package.
import type { WidgetDef } from './types';
import type { DeclarativeWidgetSpec } from './declarative/types';
import { declarativeToWidgetDef } from './declarative/declarativeToWidgetDef';

const SPECS: DeclarativeWidgetSpec[] = [
  {
    id: 'custom.sample.metric',
    title: 'Sample Metric', description: 'A data-defined metric widget (declarative — no code).',
    icon: 'fa-gauge', category: 'Custom', tags: ['sample', 'declarative', 'custom'],
    defaultSize: 'compact', allowedSizes: ['compact', 'standard'],
    view: { kind: 'metric', metric: 128, supporting: 'Sample metric value', footer: 'declarative · embedded sample' },
  },
  {
    id: 'custom.sample.list',
    title: 'Sample List', description: 'A data-defined list widget (declarative — no code).',
    icon: 'fa-list', category: 'Custom', tags: ['sample', 'declarative', 'custom'],
    defaultSize: 'tall', allowedSizes: ['tall', 'large'],
    view: { kind: 'list', rows: [
      { primary: 'First item', secondary: 'sample detail', right: 'OK', tone: 'ok' },
      { primary: 'Second item', secondary: 'sample detail', right: '2', tone: 'warn' },
      { primary: 'Third item', secondary: 'sample detail', right: 'Late', tone: 'danger' },
    ] },
  },
];

export const widgets: WidgetDef[] = SPECS.map(declarativeToWidgetDef);
