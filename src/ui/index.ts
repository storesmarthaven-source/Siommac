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
export { Stepper, type StepperProps, type StepperStep } from './components/Stepper';
export { SectionHead, type SectionHeadProps } from './components/SectionHead';
export { MetricRow, ReorderableRow, type MetricRowProps, type MetricCardItem } from './components/MetricRow';
export { NewMenu, type NewMenuProps, type NewMenuItem } from './components/NewMenu';
export { useCardReorder, ArrangeControls, type CardReorder } from './components/reorder';

// ── Cards & metrics ──
export { Card, MetricCard, type CardProps } from './components/MetricCard';
export { StatusPill } from './components/StatusPill';
export { SparkCard, type SparkDef } from './components/SparkCard';
export { StatsCard, type StatsCardProps, type StatStatus } from './components/StatsCard';
export { KpiTile, type KpiTileProps, type KpiTileLink, type KpiTone } from './components/KpiTile';
export { ChartCard, type ChartCardProps } from './components/ChartCard';
export { MiniCard, RecordRow, Record } from './components/Card';

// ── Charts ──
export { Sparkline, type SparklineProps } from './charts/Sparkline';
export { BarRow, type BarRowProps } from './charts/BarRow';
export { ProgressBar, type ProgressBarProps } from './charts/ProgressBar';

// ── Inputs & forms ──
export { Button, type ButtonVariant } from './components/Button';
export { LucideIcon, type LucideName } from './LucideIcon';
export { InfoTip, type InfoTipProps } from './InfoTip';
export { DataTable, type DataTableProps, type DtColumn, type DtAction, type DtAlign, type DtRowStatus, type DtActiveFilter } from './DataTable';
export {
  TableSearch, FilterDropdown, AdvancedFilter, ActiveFilters, useFilterDropdowns, FILTER_DROPDOWN_ATTR,
  type FilterDropdownProps, type AdvancedFilterProps, type AdvTab, type AdvSection, type ActiveChip,
} from './table/FilterBar';
export { PersonCell, type PersonCellProps } from './table/PersonCell';
export { Toolbar, SearchInput, FilterSelect } from './components/Toolbar';
export { Field, TextInput, SelectInput, TextareaInput, FormGrid } from './components/Field';
export { PersonSearchSelect, type PersonSearchOption, type PersonSearchSelectProps } from './components/PersonSearchSelect';

// ── Loading placeholders (cold-path only) ──
export {
  Skeleton, SkeletonText, TableSkeleton, ListSkeleton, SkeletonFields, SkeletonStatGrid,
  type SkeletonProps, type SkeletonTextProps, type TableSkeletonProps, type ListSkeletonProps,
  type SkeletonFieldsProps, type SkeletonStatGridProps,
} from './components/Skeleton';
export { Spinner, type SpinnerProps } from './components/Spinner';
export { EmptyState, type EmptyStateProps, type EmptyTone } from './components/EmptyState';

// ── Widget library (v2: instance/zone board + preview-on-board) lives under '@ui/widgets' ──

// ── Data ──
export { Tabs, type TabDef } from './components/Tabs';
export { RegisterTable, type Column } from './components/RegisterTable';
export { Pagination, usePagination, DEFAULT_PAGE_SIZE, type PaginationProps, type PaginationState } from './components/Pagination';

// ── Overlays (standard window) ──
export { Modal, HseModal, ModalSection, type ModalProps } from './components/Modal';
export { Wizard, type WizardProps } from './components/Wizard';
export { WizardShell, type WizardShellProps, type WizardStepDef, type WizardInfoPanel, type WizardInfoRow } from './components/WizardShell';
export { Drawer, HseDrawer, DetailDrawer, type DrawerProps, type DrawerDetail } from './components/Drawer';
export { DetailGrid, type DetailGridProps, type DetailItem } from './components/DetailGrid';
export { SidePanel, type SidePanelProps, type SidePanelSection } from './components/SidePanel';
export { Menu, type MenuProps, type MenuItem } from './components/Menu';

// ── Rich detail-panel primitives (SidePanel/Drawer body + dialogs) ──
export { EntityHead, PanelStats, type EntityHeadProps, type PanelStatItem } from './components/EntityHead';
export { PanelTabs, type PanelTabsProps } from './components/PanelTabs';
export { InfoCard, FieldList, FieldRow, MiniTable, Pill, PanelEmpty, Callout, ActivityList, type PillTone, type ActivityEntry } from './components/InfoCard';
export { SystemActionsPanel, type SystemActionsPanelProps } from './components/SystemActionsPanel';

// ── Layouts ──
export { ModulePageLayout, type ModulePageLayoutProps } from './layouts/ModulePageLayout';
export { SplitLayout } from './layouts/SplitLayout';
export { RegisterLayout } from './layouts/RegisterLayout';

// ── Utilities ──
export { exportCsv, toCsv, type CsvColumn } from './lib/exportCsv';

// ── HR & Finance "Aurora" language (docs/HR_FINANCE_DESIGN_SPEC.md) ──
export * from './hrfin';
