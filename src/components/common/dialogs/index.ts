/**
 * src/components/common/dialogs/index.ts — public surface of the enterprise form system.
 */
export { EnterpriseFormModal } from './EnterpriseFormModal';
export { DialogContextPanel } from './DialogContextPanel';
export {
  orgPositionContext, orgCostCenterContext, moveOrgUnitContext,
  uploadDocumentContext, documentRequirementContext,
} from './dialogContextPresets';
export type {
  DialogTone, DialogBreadcrumbItem, DialogPreviewBadge, DialogLivePreview,
  DialogContextMetric, DialogContextField, DialogContextSection,
  DialogValidationItem, DialogWhatNextItem, DialogApprovalNotice, DialogContextPanelConfig,
} from './dialogContextTypes';
