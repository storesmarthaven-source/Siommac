/**
 * src/ui — barrel.
 *
 * One import surface for the Siomac design system: `import { ... } from '@ui'`.
 * Adding a component = one export line here + an entry in examples/UIKitPage.tsx.
 * See README.md for the rules on what belongs here.
 */

// ── Status source of truth ──
export * from './status/statusTokens';

// ── Page-shape components ──
export {
  PageHero, AreaHero, HeroFooter,
  type PageHeroProps,
  type HeroStatDef, type HeroFooterItem, type HeroMetric, type HeroBadge,
} from './components/PageHero';
export {
  ModuleTabs, TabBar, AreaTabs, withCounts,
  type ModuleTab, type AreaTab, type ModuleTabsProps,
} from './components/ModuleTabs';
export { PageHeader, type PageHeaderProps, type PageMetaChip } from './components/PageHeader';
export { SectionHead, type SectionHeadProps } from './components/SectionHead';
export { MetricRow, ReorderableRow, type MetricRowProps, type MetricCardItem } from './components/MetricRow';
export { NewMenu, type NewMenuProps, type NewMenuItem } from './components/NewMenu';
export { useCardReorder, ArrangeControls, type CardReorder } from './components/reorder';

// ── Cards & metrics ──
export { Card, MetricCard, type CardProps } from './components/MetricCard';
export { StatusPill } from './components/StatusPill';
export { SparkCard, type SparkDef } from './components/SparkCard';
export { StatsCard, type StatsCardProps, type StatStatus } from './components/StatsCard';
export { ChartCard, type ChartCardProps } from './components/ChartCard';
export { MiniCard, RecordRow, Record } from './components/Card';

// ── Charts ──
export { Sparkline, type SparklineProps } from './charts/Sparkline';
export { BarRow, type BarRowProps } from './charts/BarRow';
export { ProgressBar, type ProgressBarProps } from './charts/ProgressBar';

// ── Inputs & forms ──
export { Button, type ButtonVariant } from './components/Button';
export { Toolbar, SearchInput, FilterSelect } from './components/Toolbar';
export { Field, TextInput, SelectInput, TextareaInput, FormGrid } from './components/Field';

// ── Data ──
export { Tabs, type TabDef } from './components/Tabs';
export { RegisterTable, type Column } from './components/RegisterTable';
export { Pagination, usePagination, DEFAULT_PAGE_SIZE, type PaginationProps, type PaginationState } from './components/Pagination';

// ── Overlays (standard window) ──
export { Modal, HseModal, type ModalProps } from './components/Modal';
export { Wizard, type WizardProps } from './components/Wizard';
export { Drawer, HseDrawer, DetailDrawer, type DrawerProps, type DrawerDetail } from './components/Drawer';
export { DetailGrid, type DetailGridProps, type DetailItem } from './components/DetailGrid';
export { SidePanel, SidePanelItem, type SidePanelProps, type SidePanelItemProps, type SidePanelTab, type SidePanelTone } from './components/SidePanel';

// ── Layouts ──
export { ModulePageLayout, type ModulePageLayoutProps } from './layouts/ModulePageLayout';
export { SplitLayout } from './layouts/SplitLayout';
export { RegisterLayout } from './layouts/RegisterLayout';

// ── Utilities ──
export { exportCsv, toCsv, type CsvColumn } from './lib/exportCsv';
