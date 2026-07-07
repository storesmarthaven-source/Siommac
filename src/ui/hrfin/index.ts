/**
 * src/ui/hrfin/index.ts
 *
 * The Aurora component library for HR & Finance pages — a 1:1 port of the
 * approved Codex finance mockups (docs/HR_FINANCE_DESIGN_SPEC.md). Re-exported
 * through the main `@ui` barrel. Every page imports `./tokens.css` (once, here)
 * and wraps its root in `<div class="hrfin">`.
 */

import './tokens.css';

export { HrfinIcon, type HrfinIconName } from './icon';
export { HrfinPageHeader, type HrfinPageHeaderProps, type HrfinChip } from './HrfinPageHeader';
export { QuickActionStrip, type QuickAction } from './QuickActionStrip';
export { KpiCard, type KpiCardProps, type KpiVisual, type KpiTone } from './KpiCard';
export { RailCard, type RailCardProps } from './RailCard';
export { DeadlineList, type DeadlineItem } from './DeadlineList';
export { ActivityFeed, type ActivityItem } from './ActivityFeed';
export { InsightBanner, type InsightBannerProps, type InsightAction } from './InsightBanner';
export { HrfinPill, type HrfinTone } from './HrfinPill';
export { HrfinTable, type HrfinColumn, type HrfinTab, type HrfinFilter, type HrfinTableProps } from './HrfinTable';
export { RowActionMenu, type RowActionItem } from './RowActionMenu';
export { HrfinWizardModal, type HrfinWizardModalProps } from './HrfinWizardModal';
export { EntityPicker, type EntityPickerProps, type EntityOption } from './EntityPicker';
export { TrendArea, type TrendAreaProps } from './charts/TrendArea';
export { HorizontalBars, type HBarItem } from './charts/HorizontalBars';
export { DonutRing, type DonutRingProps } from './charts/DonutRing';
