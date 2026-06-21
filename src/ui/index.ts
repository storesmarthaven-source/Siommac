/**
 * src/ui — barrel.
 *
 * One import surface for the design system: `import { Button, StatusPill } from '@ui'`.
 * Adding a component = one export line here + an entry in examples/UIKitPage.tsx.
 * See README.md for the rules on what belongs here.
 */

// ── Status source of truth ──
export * from './status/statusTokens';

// ── Components ──
export { Button, type ButtonVariant } from './components/Button';
export { StatusPill } from './components/StatusPill';
export { MetricCard } from './components/MetricCard';
export { SectionHead } from './components/SectionHead';
export { Toolbar, SearchInput, FilterSelect } from './components/Toolbar';
export { Tabs, type TabDef } from './components/Tabs';
export { RegisterTable, type Column } from './components/RegisterTable';
export { Drawer } from './components/Drawer';

// ── Layouts ──
export { RegisterLayout } from './layouts/RegisterLayout';

// ── Utilities ──
export { exportCsv, toCsv, type CsvColumn } from './lib/exportCsv';
