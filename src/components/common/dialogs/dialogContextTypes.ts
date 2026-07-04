/**
 * src/components/common/dialogs/dialogContextTypes.ts
 *
 * Types for the enterprise dialog context panel — the right-hand pane that turns a
 * plain form into an enterprise workflow surface (placement, live preview, inherited
 * & derived values, related counts, live validation, impact, what-happens-next, and
 * approval routing). Framework-agnostic data shapes; the <DialogContextPanel> renders
 * them. See docs/DIALOGS_AND_FORMS_DESIGN_SPEC.md.
 */

export type DialogTone =
  | 'default'
  | 'muted'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger';

export interface DialogBreadcrumbItem {
  label: string;
  value?: string;
}

export interface DialogPreviewBadge {
  label: string;
  tone?: DialogTone;
}

export interface DialogLivePreview {
  title: string;
  subtitle?: string;
  /** Short glyph text ("POS") or a font-awesome class fragment via the icon slot. */
  icon?: string;
  badges?: DialogPreviewBadge[];
  meta?: Array<{
    label: string;
    value: string | number | null | undefined;
    tone?: DialogTone;
  }>;
}

export interface DialogContextMetric {
  label: string;
  value: string | number;
  helper?: string;
  tone?: DialogTone;
}

export interface DialogContextField {
  label: string;
  value: string | number | boolean | null | undefined;
  helper?: string;
  tone?: DialogTone;
}

export interface DialogContextSection {
  title: string;
  description?: string;
  fields: DialogContextField[];
}

export interface DialogValidationItem {
  message: string;
  tone?: 'info' | 'warning' | 'danger' | 'success';
}

export interface DialogWhatNextItem {
  label: string;
  description?: string;
}

export interface DialogApprovalNotice {
  required: boolean;
  risk?: 'low' | 'medium' | 'high' | 'critical';
  message: string;
}

export interface DialogContextPanelConfig {
  eyebrow?: string;
  title?: string;
  description?: string;
  breadcrumb?: DialogBreadcrumbItem[];
  preview?: DialogLivePreview;
  inherited?: DialogContextSection;
  derived?: DialogContextSection;
  metrics?: DialogContextMetric[];
  validation?: DialogValidationItem[];
  impact?: DialogContextSection;
  whatNext?: DialogWhatNextItem[];
  approval?: DialogApprovalNotice;
}
