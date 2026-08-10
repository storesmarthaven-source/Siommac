export type EmailTemplateFamily = 'onboarding' | 'user_invitation' | 'worker_invitation';
export type EmailTemplateStatus =
  | 'draft'
  | 'in_review'
  | 'changes_requested'
  | 'approved'
  | 'published'
  | 'superseded'
  | 'archived';
export type EmailApprovalState = 'not_required' | 'not_submitted' | 'pending' | 'approved' | 'changes_requested';
export type EmailBlockType =
  | 'heading'
  | 'paragraph'
  | 'image'
  | 'company_logo'
  | 'profile_photo'
  | 'button'
  | 'divider'
  | 'spacer'
  | 'section'
  | 'columns'
  | 'information_card'
  | 'callout'
  | 'signature'
  | 'icon_list'
  | 'smart_fact_grid'
  | 'smart_progress'
  | 'smart_status_list'
  | 'welcome_header'
  | 'employee_details'
  | 'manager_contact'
  | 'start_date_summary'
  | 'pending_tasks'
  | 'required_documents'
  | 'training_assignments'
  | 'equipment_ppe'
  | 'invitation_action'
  | 'invitation_expiry'
  | 'security_notice'
  | 'support_contact'
  | 'legal_footer';

export type EmailTextAlign = 'left' | 'center' | 'right';
export type EmailVerticalAlign = 'top' | 'middle' | 'bottom';
export type EmailBlockTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';

export interface EmailBoxSpacing {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface EmailBlockStyles {
  backgroundColor: string;
  color: string;
  align: EmailTextAlign;
  fontSize: number;
  fontWeight: 400 | 500 | 600 | 700;
  lineHeight: number;
  /** Tracking in px. Negative tightens; used by display headings and eyebrows. */
  letterSpacing: number;
  padding: EmailBoxSpacing;
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
}

/** One row in a Smart Block status checklist. */
export interface EmailStatusItem {
  title: string;
  meta: string;
  status: 'done' | 'current' | 'pending';
}

/** One tile in a Smart Block fact grid. An empty icon renders no icon. */
export interface EmailFactTile {
  icon: string;
  label: string;
  value: string;
  caption: string;
}

/**
 * Semantic icon colours.
 *
 * Icons are NOT arbitrary hex in production email: Gmail strips inline SVG, so a delivered icon is
 * a pre-rendered PNG and its colour is baked into the file. A closed set keeps the published asset
 * matrix finite and guarantees every authored colour actually has an asset behind it. See
 * `src/lib/emailIcons.ts`.
 */
export type EmailIconColor =
  | 'navy'
  | 'blue'
  | 'green'
  | 'amber'
  | 'red'
  | 'slate'
  | 'white';

/** One link in the legal footer's policy row. */
export interface EmailFooterLink {
  label: string;
  href: string;
}

export interface EmailBlockProperties {
  html?: string;
  label?: string;
  href?: string;
  src?: string;
  alt?: string;
  width?: number;
  height?: number;
  level?: 1 | 2 | 3;
  tone?: EmailBlockTone;
  variableKey?: string;
  maxItems?: number;
  emptyText?: string;
  contactEmail?: string;
  contactPhone?: string;
  iconItems?: Array<{ icon: string; text: string; label?: string; meta?: string }>;
  /** Set on blocks owned by the shared header/footer chrome. */
  chromeRole?: EmailChromeRole;
  /** Legal footer: repeatable policy links rendered as one separated row. */
  footerLinks?: EmailFooterLink[];
  /** Legal footer: closing notice under the links. Empty hides the line. */
  replyNotice?: string;
  /** Smart Block: repeatable fact tiles (icon + label + value + caption). */
  factTiles?: EmailFactTile[];
  /** Tile content alignment inside its cell. */
  factTileAlign?: EmailTextAlign;
  /** Draw hairlines between tiles and above/below the grid. */
  factDividers?: boolean;
  /** Icon square size in px. */
  iconSize?: number;
  /** Smart Block: progress percent (0-100). */
  percent?: number;
  /** Smart Block: supporting caption under/next to the progress bar. */
  progressCaption?: string;
  /** Smart Block: status checklist rows. */
  statusItems?: EmailStatusItem[];
  iconShape?: 'circle' | 'square' | 'rounded';
  iconTreatment?: 'plain' | 'outline' | 'solid';
  /**
   * Semantic token, never a hex value — the email renderer resolves it to a published PNG.
   * `normalizeEmailDocument` rewrites legacy hex to the nearest token, so a stored document is
   * migrated in the MODEL rather than silently reinterpreted at render time.
   */
  iconColor?: EmailIconColor;
  iconBackground?: string;
  columns?: 1 | 2 | 3 | 4;
  /** Width of the block inside the email canvas. Email tables use this value as a percentage. */
  widthPercent?: number;
  /** Minimum editing/rendering height. The content may make the block taller. */
  minHeight?: number;
  /** Vertical position of content inside the block's available height. */
  verticalAlign?: EmailVerticalAlign;
  /** Relative column widths, stored as percentages and normalized to 100 by the editor. */
  columnWidths?: number[];
  /** Email-safe space outside the element. Rendered on the wrapping table cell. */
  outerSpacing?: EmailBoxSpacing;
  /** Section background image. The background colour stays the fallback. */
  backgroundImage?: string;
  backgroundDisplay?: 'scale' | 'fit' | 'tile';
}

/**
 * Canonical, renderer-neutral email block. The editor stores this document;
 * MJML/HTML/plain-text outputs are always derived and are never editable state.
 */
export interface EmailTemplateBlock {
  id: string;
  type: EmailBlockType;
  name: string;
  properties: EmailBlockProperties;
  styles: EmailBlockStyles;
  children: EmailTemplateBlock[];
  locked: boolean;
  hidden: boolean;
}

/** One entry in the document-wide typography scale. */
export interface EmailTypographyStyle {
  fontSize: number;
  color: string;
}

export interface EmailTypographyScale {
  body: EmailTypographyStyle;
  h1: EmailTypographyStyle;
  h2: EmailTypographyStyle;
  h3: EmailTypographyStyle;
  textLineHeight: number;
  headingLineHeight: number;
}

export interface EmailDocumentSettings {
  width: number;
  outerBackground: string;
  contentBackground: string;
  linkColor: string;
  linkUnderline: boolean;
  primaryColor: string;
  /** Document-wide defaults applied to headings, body copy and new blocks. */
  typography: EmailTypographyScale;
}

/** Source-of-truth document owned by the SIOMAC editor. */
export interface EmailEditorSchema {
  schemaVersion: 1;
  settings: EmailDocumentSettings;
  blocks: EmailTemplateBlock[];
}

export interface EmailTemplateSummary {
  id: string;
  key: string;
  name: string;
  description: string | null;
  family: EmailTemplateFamily;
  triggerKey: string;
  triggerLabel: string;
  audience: string;
  language: string;
  businessUnitLabel: string;
  ownerLabel: string;
  status: EmailTemplateStatus;
  approvalState: EmailApprovalState;
  currentVersion: number;
  activeUsageCount: number;
  protected: boolean;
  updatedAt: string;
}

export interface EmailTemplateDraft extends EmailTemplateSummary {
  subject: string;
  preheader: string;
  editorSchema: EmailEditorSchema;
  compiledHtml: string;
  compiledText: string;
}

/**
 * Marks a block as belonging to the shared header/footer chrome. Blocks that
 * carry a role are kept in sync with the shared chrome record; a template can
 * detach by clearing the role (the block then becomes ordinary content).
 */
export type EmailChromeRole = 'header' | 'footer';

/**
 * The company-wide email chrome. Templates hold their own copy of these blocks
 * so a published version stays reproducible; saving the chrome re-syncs every
 * editable template, which is the snapshot-at-publish rule in practice.
 */
export interface EmailChromeDocument {
  header: EmailTemplateBlock[];
  footer: EmailTemplateBlock[];
  updatedAt: string;
  updatedBy: string;
}

export interface UpdateEmailChromeArgs {
  header: EmailTemplateBlock[];
  footer: EmailTemplateBlock[];
}

/** Outcome of re-syncing templates after the shared chrome changed. */
export interface EmailChromeSyncResult {
  chrome: EmailChromeDocument;
  syncedTemplateIds: string[];
  skippedTemplateIds: string[];
}

/** A reusable section the user saved from a template. */
export interface EmailSavedSection {
  id: string;
  name: string;
  /** The saved container, stored exactly as the editor holds it. */
  block: EmailTemplateBlock;
  createdAt: string;
}

export interface CreateSavedSectionArgs {
  name: string;
  block: EmailTemplateBlock;
}

export interface EmailTemplateTriggerDefinition {
  key: string;
  label: string;
  families: EmailTemplateFamily[];
  audiences: string[];
}

export interface EmailTemplateCatalog {
  triggers: EmailTemplateTriggerDefinition[];
  languages: string[];
  businessUnits: string[];
  owners: string[];
}

export interface EmailTemplateListArgs {
  query?: string;
  families?: EmailTemplateFamily[];
  statuses?: EmailTemplateStatus[];
  language?: string;
  owner?: string;
  usedByActiveWorkflow?: boolean;
  sort?: 'name' | 'status' | 'updated_at' | 'owner' | 'usage';
  direction?: 'asc' | 'desc';
}

export interface CreateEmailTemplateArgs {
  family: EmailTemplateFamily;
  startingPoint: 'blank' | 'company_default' | 'existing' | 'system_template';
  sourceTemplateId?: string | null;
  name: string;
  description?: string | null;
  key: string;
  audience: string;
  triggerKey: string;
  language: string;
  businessUnitLabel: string;
  ownerLabel: string;
  approvalRequired: boolean;
}

export interface UpdateEmailTemplateDraftArgs {
  id: string;
  name?: string;
  subject?: string;
  preheader?: string;
  editorSchema?: EmailEditorSchema;
  compiledHtml?: string;
  compiledText?: string;
}
