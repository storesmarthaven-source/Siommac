/**
 * src/ui — barrel.
 *
 * One import surface for the Siomac design system: `import { ... } from '@ui'`.
 *
 * Adding a CANONICAL (v2) component = one export line here + a definition in
 * `src/ui/registry/definitions.tsx`, which is what puts it in the Gallery. See
 * `RECIPES.md` for the recipe/token rules and README.md for what belongs here.
 *
 * The barrel is preserved through migration on purpose: consumers keep importing
 * `Button` from `@ui` whether they are on the old or the new implementation, so
 * there is never a `ButtonV2` and never two kits running side by side.
 */

// ── Status source of truth ──
export * from './status/statusTokens';

// ── Page-shape components ──
export {
  PageHero, AreaHero, HeroFooter,
  type PageHeroProps,
  type HeroStatDef, type HeroFooterItem, type HeroMetric, type HeroBadge,
} from './components/PageHero';
/** DEPRECATED — superseded by the canonical `Tabs` (Navigation, below).
 *  `TabBar` = `<Tabs variant="underline">`. Deleted as consumers move; the
 *  `AreaTabs` alias and `PanelTabs` are already gone. */
export {
  ModuleTabs, TabBar, withCounts,
  type ModuleTab, type AreaTab, type ModuleTabsProps,
} from './components/ModuleTabs';
export { PageHeader, type PageHeaderProps } from './components/PageHeader';
export { PageActionBar, type PageActionBarProps } from './navigation/PageActionBar';
export { Stepper, type StepperProps, type StepperStep } from './components/Stepper';
export { SectionHead, type SectionHeadProps } from './components/SectionHead';
export { MetricRow, ReorderableRow, type MetricRowProps, type MetricCardItem } from './components/MetricRow';
export { NewMenu, type NewMenuProps, type NewMenuItem } from './components/NewMenu';
export { useCardReorder, ArrangeControls, type CardReorder } from './components/reorder';

/**
 * ── Cards & metrics ───────────────────────────────────────────────────────
 * `Card` is the CANONICAL surface (see the Containers block below). The
 * remaining entries here are legacy CONTENT compositions still awaiting their
 * own migration onto it — they are not alternative cards, and no new code
 * should reach for them.
 *
 * Deleted with the Card consolidation: `MetricCard` (`.inc-mini-card`),
 * `ChartCard` (`.hse-spark-card`), and `MiniCard`/`RecordRow`/`Record`.
 */
export { StatusPill } from './components/StatusPill';
export { SparkCard, type SparkDef } from './components/SparkCard';
export { StatsCard, type StatsCardProps, type StatStatus } from './components/StatsCard';
export { KpiTile, type KpiTileProps, type KpiTileLink, type KpiTone } from './components/KpiTile';

// ── Charts ──
export { Sparkline, type SparklineProps } from './charts/Sparkline';
export { BarRow, type BarRowProps } from './charts/BarRow';
export { ProgressBar, type ProgressBarProps } from './charts/ProgressBar';

// ── UI Kit v2 foundation (imports tokens.css — must load before any recipe) ──
export {
  BREAKPOINTS, PREVIEW_WIDTHS, CONTROL_SIZES, DENSITIES, VALIDATION_STATES,
  type BreakpointKey, type ControlSize, type Density, type ValidationState, type UiState,
} from './tokens';

// ── Actions (canonical, v2) ──
// ONE Button. Icon-only, link, toggle, loading and destructive are props on it —
// `IconButton`, `LinkButton` and `ToggleButton` were deleted because each was a
// fixed-prop wrapper that delegated straight back to Button.
export {
  Button,
  type ButtonVariant, type ButtonProps,
} from './primitives/Button';
export {
  AiActionButton,
  type AiActionButtonProps, type AiActionIconTreatment, type AiActionShape,
} from './patterns/AiActionButton';
export {
  SegmentedControl, DropdownButton, SplitButton,
  type SegmentedControlProps, type SegmentedOption,
  type DropdownButtonProps, type SplitButtonProps,
} from './primitives/actions';
export {
  DropdownMenu, type DropdownMenuProps, type MenuAction, type MenuGroup, type MenuItems,
} from './overlays/DropdownMenu';

// ── Inputs & forms ──
export { LUCIDE_NAMES, LucideIcon, type LucideName } from './LucideIcon';
export { InfoTip, type InfoTipProps } from './InfoTip';
/** Type-only debt for blocked EmailTemplateLibrary.tsx; no legacy runtime remains. */
export interface DtColumn<T> {
  key: string;
  label: string;
  renderCell: (row: T) => preact.ComponentChildren;
  sortAccessor?: (row: T) => string | number | null | undefined;
  align?: 'left' | 'center' | 'right';
  width?: string;
  isPinned?: boolean;
}
export {
  TableSearch, FilterDropdown, AdvancedFilter, ActiveFilters, useFilterDropdowns, FILTER_DROPDOWN_ATTR,
  type FilterDropdownProps, type AdvancedFilterProps, type AdvTab, type AdvSection, type ActiveChip,
} from './table/FilterBar';
export { PersonCell, type PersonCellProps } from './table/PersonCell';
export { Toolbar, SearchInput, FilterSelect } from './components/Toolbar';

/**
 * ── Legacy form primitives — scheduled for deletion ────────────────────────
 * `Field` (42 consumers), `SelectInput` (34) and `TextareaInput` (23) are the
 * pre-v2 controls. They are NOT rebound to the canonical components, because
 * doing so would silently change the rendering of ~40 business pages that this
 * milestone is explicitly not allowed to migrate.
 *
 * They are deleted as their consumers move to `FormField` + the canonical
 * controls — build-new → migrate → delete, one surface at a time. Do NOT use
 * them in new code.
 *
 * `TextInput` and `PersonSearchSelect` are the exceptions: their canonical
 * replacements are prop-compatible and were styled to match, so those names
 * are already bound to the v2 implementations below.
 */
export { Field, SelectInput, TextareaInput, FormGrid } from './components/Field';

// ── Forms (canonical, v2) ──
export { FormField, FormGrid as FormGrid2, type FormFieldProps } from './forms/FormField';
export { FieldContext, useFieldContext, resolveFieldState, type FieldContextValue } from './forms/fieldContext';
export { TextInput, SearchInput as SearchField, type TextInputProps, type TextInputType } from './primitives/TextInput';
export {
  type Option, type OptionGroup, type OptionsInput,
  flattenOptions, filterOptions, findOption, toGroups, hasGroups,
} from './forms/options';
export { Select, type SelectProps } from './forms/Select';
export { Combobox, type ComboboxProps } from './forms/Combobox';
export { PersonSearchSelect, type PersonOption, type PersonSearchSelectProps } from './forms/PersonSearchSelect';
export { Avatar, avatarInitials, type AvatarProps, type AvatarVariant, type AvatarSize, type AvatarNamedSize, type AvatarPresence } from './people/Avatar';
export { AvatarGroup, type AvatarGroupProps, type AvatarGroupPerson } from './people/AvatarGroup';
export { MultiSelect, type MultiSelectProps } from './forms/MultiSelect';

// ── Choice controls (canonical, v2) ──
export {
  Checkbox, Radio, Switch, CheckboxGroup, RadioGroup,
  type CheckboxProps, type RadioProps, type SwitchProps,
  type CheckboxGroupProps, type RadioGroupProps, type ChoiceOption,
} from './primitives/choice';

// ── Typed inputs (canonical, v2) ──
export {
  PasswordInput, NumberInput, CurrencyInput, PercentageInput,
  EmailInput, UrlInput, PhoneInput, Textarea,
  type PasswordInputProps, type NumberInputProps, type CurrencyInputProps,
  type PercentageInputProps, type PhoneInputProps, type TextareaProps,
} from './forms/inputs';

// ── Date & time (canonical, v2) ──
export {
  DateInput, TimeInput, DateTimeInput, MonthInput, DateRangeInput,
  type DateRange, type DateRangeInputProps,
} from './forms/dateInputs';

// ── File & code entry (canonical, v2) ──
export {
  FileInput, OtpInput,
  type FileInputProps, type FileRejection, type OtpInputProps,
} from './forms/FileInput';
export {
  ColorPicker,
  type ColorPickerProps, type HsvColor,
} from './forms/ColorPicker';

// ── Status (canonical, v2) ──
// ONE badge system: status pill, tag, chip, priority and risk are tone/variant.
export { Badge, type BadgeProps, type BadgeTone, type BadgeVariant } from './primitives/Badge';

// ── Data (canonical, v2) ──
// ONE table. Search, filters, sorting, pagination, selection, bulk actions, the
// column chooser and row actions are its CAPABILITIES, not sibling components.
export {
  DataTable,
  type DataTableProps, type DataTableColumn, type DataTableSort, type DataTableSorting,
  type DataTablePagination, type DataTableSelection, type DataTableBulkAction,
  type DataTableSearch, type DataTableFilter, type DataTableAction,
  type DataTableEmptyState, type DataTableDensity,
} from './data/DataTable';

// ── Navigation (canonical, v2) ──
// ONE Tabs. Orientation, appearance, size, icons, count badges and the "More"
// overflow are CONFIGURATION — `VerticalTabs` is `orientation="vertical"`.
// It also owns the keyboard model that three of the five legacy tab APIs lacked.
export {
  Tabs, TabPanel, tabDomId, panelDomId,
  type TabsProps, type TabPanelProps, type TabItem,
  type TabsOrientation, type TabsVariant, type TabsSize, type TabsActivation,
} from './navigation/Tabs';
export { Breadcrumbs, type BreadcrumbsProps, type BreadcrumbItem } from './navigation/Breadcrumbs';
export { TreeView, type TreeViewProps, type TreeNode } from './navigation/TreeView';
export { NextActionButton, type NextActionButtonProps, type NextActionIconTreatment } from './patterns/NextActionButton';
export { ThemeModeSwitch, type ThemeModeSwitchProps, type ThemeMode } from './patterns/ThemeModeSwitch';

// ONE Wizard. Step validation, navigation gating, optional/skipped steps and the
// Back/Continue/Submit footer are its behaviour. It owns NO overlay — a modal
// wizard is <Dialog><Wizard /></Dialog>, never a `WizardModal`.
export {
  Wizard, wizardStepDomId, wizardPanelDomId,
  type WizardProps, type WizardStep, type WizardStepStatus,
  type WizardIssues, type WizardOrientation,
} from './navigation/Wizard';

// ── Containers (canonical, v2) ──
// ONE Card. KPI, metric, panel, action and section are VARIANTS of this surface;
// the number, the chart and the detail list inside are CONTENT. Nine card
// components existed before it.
export {
  Card, CardHeader, CardFooter,
  type CardProps, type CardHeaderProps, type CardFooterProps,
  type CardVariant, type CardTone, type CardAccent, type CardDensity,
} from './containers/Card';
export { Accordion, type AccordionProps, type AccordionItem } from './containers/Accordion';

// ── Overlays (canonical, v2) ──
export { Dialog, type DialogProps, type DialogSize, type DialogVariant } from './overlays/Dialog';
export { AnchoredPopup, type AnchoredPopupProps } from './overlays/AnchoredPopup';
export { Popover, type PopoverProps } from './overlays/Popover';
export { Tooltip, type TooltipProps } from './overlays/Tooltip';

// ── Feedback (canonical, v2) ──
export { Alert, type AlertProps, type AlertTone, type AlertPlacement } from './feedback/Alert';
export { Progress, type ProgressProps, type ProgressShape, type ProgressTone, type ProgressSize } from './feedback/Progress';
export { Toaster, ToastCard, toast, type ToastRecord, type ToastTier, type ToastVariant } from './toast';

// ── Loading placeholders (cold-path only) ──
export {
  Skeleton, SkeletonText, TableSkeleton, ListSkeleton, SkeletonFields, SkeletonStatGrid,
  WidgetSkeleton, PageHeaderSkeleton,
  type SkeletonProps, type SkeletonTextProps, type TableSkeletonProps, type ListSkeletonProps,
  type SkeletonFieldsProps, type SkeletonStatGridProps, type WidgetSkeletonProps,
  type WidgetSkeletonVariant,
} from './components/Skeleton';
export { Spinner, type SpinnerProps } from './components/Spinner';
export { EmptyState, type EmptyStateProps, type EmptyStateSize, type EmptyTone } from './components/EmptyState';

// ── Widget library (v2: instance/zone board + preview-on-board) lives under '@ui/widgets' ──

// ── Data ──
/** DEPRECATED — superseded by the canonical `Tabs` below. Kept under a loud
 *  name while its remaining drawer consumers migrate; deleted when they have. */
export { RegisterTable, type Column } from './components/RegisterTable';
export { Pagination, usePagination, DEFAULT_PAGE_SIZE, type PaginationProps, type PaginationState } from './components/Pagination';

// ── Overlays (standard window) ──
export { Modal, HseModal, ModalSection, type ModalProps } from './components/Modal';
/** DEPRECATED — superseded by the canonical `Wizard` (Navigation, above).
 *  Both owned their own backdrop + modal; the canonical one owns no overlay and
 *  is composed as <Dialog><Wizard /></Dialog>. Deleted as consumers move. */
export { Wizard as LegacyWizard, type WizardProps as LegacyWizardProps } from './components/Wizard';
export { WizardShell, type WizardShellProps, type WizardStepDef, type WizardInfoPanel, type WizardInfoRow } from './components/WizardShell';
export { Drawer, type DrawerProps, type DrawerDetail, type DrawerSide, type DrawerSize } from './components/Drawer';
export { DetailGrid, type DetailGridProps, type DetailItem } from './components/DetailGrid';
export { SidePanel, type SidePanelProps, type SidePanelSection } from './components/SidePanel';

// ── Rich detail-panel primitives (SidePanel/Drawer body + dialogs) ──
export { EntityHead, PanelStats, type EntityHeadProps, type PanelStatItem } from './components/EntityHead';
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
