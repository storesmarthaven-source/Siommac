import type {
  EmailBlockStyles,
  EmailBlockType,
  EmailDocumentSettings,
  EmailEditorSchema,
  EmailChromeRole,
  EmailFactTile,
  EmailFooterLink,
  EmailStatusItem,
  EmailTemplateBlock,
  EmailTemplateFamily,
  EmailTypographyScale,
} from '../../types/emailTemplates';
import * as lucide from 'lucide';

export type EmailBlockGroup = 'Basics' | 'Media' | 'Actions' | 'Smart Blocks' | 'Transactional';

export interface EmailBlockDefinition {
  type: EmailBlockType;
  label: string;
  description: string;
  icon: string;
  group: EmailBlockGroup;
}

export const EMAIL_BLOCK_DEFINITIONS: readonly EmailBlockDefinition[] = [
  { type: 'heading', label: 'Heading', description: 'Section title', icon: 'fa-heading', group: 'Basics' },
  { type: 'paragraph', label: 'Rich Text', description: 'Editable body copy', icon: 'fa-align-left', group: 'Basics' },
  { type: 'divider', label: 'Divider', description: 'Visual separator', icon: 'fa-minus', group: 'Basics' },
  { type: 'spacer', label: 'Spacer', description: 'Controlled whitespace', icon: 'fa-arrows-up-down', group: 'Basics' },
  { type: 'information_card', label: 'Information Card', description: 'Boxed supporting content', icon: 'fa-square', group: 'Basics' },
  { type: 'callout', label: 'Callout', description: 'Important message', icon: 'fa-circle-info', group: 'Basics' },
  { type: 'image', label: 'Image', description: 'Upload or approved asset', icon: 'fa-image', group: 'Media' },
  { type: 'company_logo', label: 'Company Logo', description: 'Brand profile logo', icon: 'fa-building', group: 'Media' },
  { type: 'profile_photo', label: 'Profile Photo', description: 'Recipient profile image', icon: 'fa-circle-user', group: 'Media' },
  { type: 'button', label: 'Button', description: 'Primary or secondary action', icon: 'fa-arrow-pointer', group: 'Actions' },
  { type: 'signature', label: 'Signature', description: 'Named sender sign-off', icon: 'fa-signature', group: 'Actions' },
  { type: 'icon_list', label: 'Icon List', description: 'Lucide icons with editable text', icon: 'fa-list-ul', group: 'Basics' },
  { type: 'smart_fact_grid', label: 'Fact Tiles', description: 'Editable fact tiles with icons', icon: 'fa-calendar-day', group: 'Smart Blocks' },
  { type: 'smart_progress', label: 'Progress Bar', description: 'Percent bar with caption', icon: 'fa-bars-progress', group: 'Smart Blocks' },
  { type: 'smart_status_list', label: 'Status Checklist', description: 'Steps with status pills', icon: 'fa-list-check', group: 'Smart Blocks' },
  { type: 'welcome_header', label: 'Welcome Header', description: 'Branded introduction', icon: 'fa-hand-sparkles', group: 'Transactional' },
  { type: 'employee_details', label: 'Employee Details', description: 'Employee record summary', icon: 'fa-id-card', group: 'Transactional' },
  { type: 'manager_contact', label: 'Manager Contact', description: 'Manager name and contact', icon: 'fa-user-tie', group: 'Transactional' },
  { type: 'start_date_summary', label: 'Start-Date Summary', description: 'Date, time and location', icon: 'fa-calendar-day', group: 'Transactional' },
  { type: 'pending_tasks', label: 'Pending Tasks', description: 'Outstanding onboarding work', icon: 'fa-list-check', group: 'Transactional' },
  { type: 'required_documents', label: 'Required Documents', description: 'Outstanding documents', icon: 'fa-file-shield', group: 'Transactional' },
  { type: 'training_assignments', label: 'Training', description: 'Required training list', icon: 'fa-graduation-cap', group: 'Transactional' },
  { type: 'equipment_ppe', label: 'Equipment & PPE', description: 'Assigned equipment and PPE', icon: 'fa-helmet-safety', group: 'Transactional' },
  { type: 'invitation_action', label: 'Invitation Action', description: 'Secure server-bound invitation', icon: 'fa-user-plus', group: 'Transactional' },
  { type: 'invitation_expiry', label: 'Invitation Expiry', description: 'Expiry warning', icon: 'fa-clock', group: 'Transactional' },
  { type: 'security_notice', label: 'Security Notice', description: 'Account safety guidance', icon: 'fa-shield-halved', group: 'Transactional' },
  { type: 'support_contact', label: 'Support Contact', description: 'Approved support details', icon: 'fa-headset', group: 'Transactional' },
  { type: 'legal_footer', label: 'Legal Footer', description: 'Company legal information', icon: 'fa-scale-balanced', group: 'Transactional' },
] as const;

/** SIOMAC email uses ONE typeface. There is no font picker by design. */
export const EMAIL_FONT_STACK = '"Helvetica Neue", Helvetica, Arial, sans-serif';

const DEFAULT_STYLES: EmailBlockStyles = {
  backgroundColor: 'transparent',
  color: '#24314d',
  align: 'left',
  fontSize: 16,
  fontWeight: 400,
  lineHeight: 1.55,
  letterSpacing: 0,
  padding: { top: 12, right: 28, bottom: 12, left: 28 },
  borderColor: '#dfe4ec',
  borderWidth: 0,
  borderRadius: 0,
};

const uid = (): string => globalThis.crypto.randomUUID();
const ZERO_SPACING = { top: 0, right: 0, bottom: 0, left: 0 } as const;

/**
 * Legal-footer links and notice used to be hard-coded in the renderers, so
 * documents saved before they became editable carry neither property. `??`
 * (not `||`) restores those legacy documents while still honouring a user who
 * deliberately removed every link or cleared the notice.
 */
export const DEFAULT_FOOTER_LINKS: EmailFooterLink[] = [
  { label: 'Privacy Policy', href: '{{company.privacyUrl}}' },
  { label: 'Help Center', href: '{{company.helpUrl}}' },
];
export const DEFAULT_REPLY_NOTICE = 'Please do not reply to this email.';

const defaultsByType: Partial<Record<EmailBlockType, Partial<EmailTemplateBlock>>> = {
  heading: { properties: { html: 'A clear, helpful heading', level: 2 } },
  paragraph: { properties: { html: 'Add your message here. Keep it concise, useful and easy to understand.' } },
  image: { properties: { src: '', alt: '', width: 540 }, styles: { ...DEFAULT_STYLES, align: 'center', padding: { top: 16, right: 28, bottom: 16, left: 28 } } },
  company_logo: { properties: { src: '{{company.logoUrl}}', alt: '{{company.name}} logo', width: 170 }, styles: { ...DEFAULT_STYLES, backgroundColor: '#061a3c', align: 'left', padding: { top: 25, right: 46, bottom: 25, left: 46 }, borderRadius: 0 } },
  profile_photo: { properties: { src: '{{recipient.profilePhotoUrl}}', alt: '{{recipient.fullName}}', width: 72 }, styles: { ...DEFAULT_STYLES, align: 'center' } },
  button: { properties: { label: 'View details', href: '#' }, styles: { ...DEFAULT_STYLES, backgroundColor: '#0b57d0', color: '#ffffff', align: 'center', fontWeight: 600, lineHeight: 1.2, borderRadius: 6, padding: { top: 13, right: 24, bottom: 13, left: 24 } } },
  divider: { styles: { ...DEFAULT_STYLES, borderColor: '#dfe4ec', borderWidth: 1, padding: { top: 12, right: 28, bottom: 12, left: 28 } } },
  spacer: { properties: { height: 24 }, styles: { ...DEFAULT_STYLES, padding: { top: 0, right: 0, bottom: 0, left: 0 } } },
  information_card: { properties: { html: '<strong>Helpful information</strong><br>Add supporting details here.' }, styles: { ...DEFAULT_STYLES, backgroundColor: '#f5f7fa', borderWidth: 1, borderRadius: 8, padding: { top: 18, right: 20, bottom: 18, left: 20 } } },
  callout: { properties: { html: '<strong>Please note</strong><br>Add an important message here.', tone: 'brand' }, styles: { ...DEFAULT_STYLES, backgroundColor: '#eef4ff', borderColor: '#bfd2f5', borderWidth: 1, borderRadius: 8, padding: { top: 18, right: 20, bottom: 18, left: 20 } } },
  signature: { properties: { html: 'Kind regards,<br><strong>{{sender.displayName}}</strong><br>{{company.name}}' } },
  icon_list: { properties: { iconItems: [{ icon: 'Mail', text: '{{support.email}}' }, { icon: 'Phone', text: '{{support.phone}}' }], iconShape: 'rounded', iconTreatment: 'outline', iconColor: '#173f76', iconBackground: '#ffffff' }, styles: { ...DEFAULT_STYLES, color: '#24314d', padding: { top: 14, right: 24, bottom: 14, left: 24 } } },
  smart_fact_grid: {
    properties: {
      html: 'Your first-day overview',
      columns: 4,
      factTiles: [
        { icon: 'CalendarDays', label: 'Start date', value: '{{employee.startDate}}', caption: '{{employee.startDay}}' },
        { icon: 'Clock3', label: 'Arrival time', value: '{{employee.startTime}}', caption: 'Please arrive 10 mins early' },
        { icon: 'MapPin', label: 'Worksite', value: '{{employee.workAddress}}', caption: '{{employee.workLocation}}' },
        { icon: 'UserRound', label: 'Report to', value: '{{manager.fullName}}', caption: '{{manager.jobTitle}}' },
      ],
      iconTreatment: 'outline',
      iconShape: 'rounded',
      iconColor: '#173f76',
      iconBackground: '#ffffff',
      iconSize: 38,
      factTileAlign: 'center',
      factDividers: true,
    },
    styles: { ...DEFAULT_STYLES, backgroundColor: 'transparent', color: '#082450', fontSize: 12, fontWeight: 700, lineHeight: 1.4, letterSpacing: 1.35, borderColor: '#dce5ef', padding: { top: 0, right: 0, bottom: 0, left: 0 } },
  },
  smart_progress: {
    properties: { html: 'Your progress', percent: 65, progressCaption: '' },
    styles: { ...DEFAULT_STYLES, backgroundColor: 'transparent', color: '#082450', fontSize: 12, fontWeight: 700, lineHeight: 1.4, letterSpacing: 1.35, padding: { top: 0, right: 0, bottom: 0, left: 0 } },
  },
  smart_status_list: {
    properties: {
      statusItems: [
        { title: 'Personal information', meta: 'Confirmed', status: 'done' },
        { title: 'Required documents', meta: '2 of 4 uploaded', status: 'current' },
        { title: 'Review & confirmation', meta: 'Pending HR review', status: 'pending' },
      ],
    },
    styles: { ...DEFAULT_STYLES, backgroundColor: 'transparent', color: '#102442', fontSize: 13, borderColor: '#dce5ef', padding: { top: 0, right: 0, bottom: 0, left: 0 } },
  },
  welcome_header: { properties: { html: 'Welcome to {{company.name}}, {{recipient.firstName}}' }, styles: { ...DEFAULT_STYLES, backgroundColor: '#102a56', color: '#ffffff', align: 'center', fontSize: 28, fontWeight: 700, lineHeight: 1.25, padding: { top: 36, right: 32, bottom: 36, left: 32 }, borderRadius: 0 } },
  employee_details: { properties: { html: '<strong>{{employee.fullName}}</strong><br>{{employee.jobTitle}} · {{employee.department}}', variableKey: 'employee' }, styles: { ...DEFAULT_STYLES, backgroundColor: '#f7f9fc', borderWidth: 1, padding: { top: 18, right: 20, bottom: 18, left: 20 } } },
  manager_contact: { properties: { html: '<strong>Your manager</strong><br>{{manager.fullName}} · {{manager.email}}', variableKey: 'manager' }, styles: { ...DEFAULT_STYLES, backgroundColor: '#f4faf9', borderColor: '#cfe5e1', borderWidth: 1, padding: { top: 18, right: 20, bottom: 18, left: 20 } } },
  start_date_summary: { properties: { html: '<strong>Your first day</strong><br>{{employee.startDate}} · {{employee.startTime}}', variableKey: 'startDate' }, styles: { ...DEFAULT_STYLES, backgroundColor: '#f7f9fc', borderWidth: 1, padding: { top: 18, right: 20, bottom: 18, left: 20 } } },
  pending_tasks: { properties: { html: '<strong>Pending onboarding tasks</strong>', variableKey: 'onboarding.pendingTasks', maxItems: 5, emptyText: 'You have no pending tasks.' }, styles: { ...DEFAULT_STYLES, backgroundColor: '#ffffff', borderWidth: 1, padding: { top: 20, right: 20, bottom: 20, left: 20 } } },
  required_documents: { properties: { html: '<strong>Documents still required</strong>', variableKey: 'onboarding.requiredDocuments', maxItems: 5, emptyText: 'No documents are outstanding.' }, styles: { ...DEFAULT_STYLES, backgroundColor: '#fbf9ff', borderColor: '#ddd4ef', borderWidth: 1, padding: { top: 20, right: 20, bottom: 20, left: 20 } } },
  training_assignments: { properties: { html: '<strong>Required training</strong>', variableKey: 'onboarding.trainingAssignments', maxItems: 5, emptyText: 'No training is assigned.' }, styles: { ...DEFAULT_STYLES, backgroundColor: '#fffaf1', borderColor: '#ecd9b1', borderWidth: 1, padding: { top: 20, right: 20, bottom: 20, left: 20 } } },
  equipment_ppe: { properties: { html: '<strong>Equipment and PPE</strong>', variableKey: 'onboarding.equipment', maxItems: 5, emptyText: 'No equipment is currently assigned.' }, styles: { ...DEFAULT_STYLES, backgroundColor: '#f4f8ff', borderColor: '#cfdbef', borderWidth: 1, padding: { top: 20, right: 20, bottom: 20, left: 20 } } },
  invitation_action: { properties: { label: 'Set up your account', href: '{{invitation.acceptUrl}}', variableKey: 'invitation.acceptUrl' }, styles: { ...DEFAULT_STYLES, backgroundColor: '#0b57d0', color: '#ffffff', align: 'center', fontWeight: 600, lineHeight: 1.2, borderRadius: 6, padding: { top: 14, right: 24, bottom: 14, left: 24 } } },
  invitation_expiry: { properties: { html: 'This secure invitation expires {{invitation.expiresAt}}.', variableKey: 'invitation.expiresAt', tone: 'warning' }, styles: { ...DEFAULT_STYLES, backgroundColor: '#fff7e8', borderColor: '#f2cf8b', borderWidth: 1, padding: { top: 15, right: 18, bottom: 15, left: 18 } } },
  security_notice: { properties: { html: '<strong>Security reminder</strong><br>SIOMAC will never ask you to share your password or invitation code.', tone: 'neutral' }, styles: { ...DEFAULT_STYLES, backgroundColor: '#102a56', color: '#ffffff', padding: { top: 18, right: 20, bottom: 18, left: 20 } } },
  support_contact: { properties: { html: '<strong>We’re here to support you</strong><br>If you have any questions, our People Operations team is here to help.', variableKey: 'support', contactEmail: '{{support.email}}', contactPhone: '{{support.phone}}' }, styles: { ...DEFAULT_STYLES, backgroundColor: '#061a3c', color: '#ffffff', borderWidth: 0, padding: { top: 34, right: 48, bottom: 34, left: 48 }, borderRadius: 0 } },
  legal_footer: {
    properties: {
      html: '{{company.legalName}}<br>{{company.address}}',
      footerLinks: DEFAULT_FOOTER_LINKS,
      replyNotice: DEFAULT_REPLY_NOTICE,
    },
    styles: { ...DEFAULT_STYLES, backgroundColor: '#ffffff', color: '#74849b', align: 'left', fontSize: 12, padding: { top: 28, right: 48, bottom: 34, left: 48 }, borderRadius: 0 },
  },
};

export function createEmailBlock(type: EmailBlockType): EmailTemplateBlock {
  const definition = EMAIL_BLOCK_DEFINITIONS.find(item => item.type === type);
  const defaults = defaultsByType[type];
  return {
    id: uid(),
    type,
    name: definition?.label ?? 'Email block',
    properties: { ...(defaults?.properties ?? {}) },
    styles: { ...DEFAULT_STYLES, ...(defaults?.styles ?? {}), padding: { ...DEFAULT_STYLES.padding, ...(defaults?.styles?.padding ?? {}) } },
    children: [],
    locked: false,
    hidden: false,
  };
}

export function isEmailContainer(block: Pick<EmailTemplateBlock, 'type'>): boolean {
  return block.type === 'section' || block.type === 'columns';
}

/**
 * Content never lives directly on the email canvas. A section owns its visual
 * background, spacing and dimensions; content owns only its own presentation.
 */
export function createEmailSection(children: EmailTemplateBlock[] = []): EmailTemplateBlock {
  const section = createEmailBlock('section');
  section.name = 'Content section';
  section.properties.columns = 1;
  section.properties.widthPercent = 100;
  section.properties.minHeight = children.length ? 0 : 96;
  section.styles.backgroundColor = '#ffffff';
  section.styles.borderWidth = 0;
  section.styles.borderRadius = 0;
  section.styles.padding = { top: 8, right: 8, bottom: 8, left: 8 };
  // A spacer's wrapper must be WEIGHTLESS: the default padding and white fill
  // would silently add 16px and a band of colour around a pure-space block.
  if (children.length > 0 && children.every(child => child.type === 'spacer')) {
    section.styles.backgroundColor = 'transparent';
    section.styles.padding = { top: 0, right: 0, bottom: 0, left: 0 };
  }
  section.children = children;
  return section;
}

/**
 * Canonicalize documents at the editor boundary. This is a one-way schema
 * normalization, not a compatibility renderer: every root node becomes a
 * container and every columns child becomes a section-owned column.
 */
export function normalizeEmailDocument(document: EmailEditorSchema): EmailEditorSchema {
  const normalizeContainer = (block: EmailTemplateBlock): EmailTemplateBlock => {
    const normalized = {
      ...block,
      styles: {
        ...DEFAULT_STYLES,
        ...block.styles,
        padding: { ...DEFAULT_STYLES.padding, ...block.styles.padding },
      },
    };
    if (normalized.type === 'columns') {
      const columns = normalized.children.map(child => child.type === 'section'
        ? normalizeContainer(child)
        : createEmailSection([child]));
      return { ...normalized, children: columns };
    }
    if (normalized.type === 'section') {
      return {
        ...normalized,
        children: normalized.children.map(child => isEmailContainer(child) ? normalizeContainer(child) : {
          ...child,
          styles: { ...DEFAULT_STYLES, ...child.styles, padding: { ...DEFAULT_STYLES.padding, ...child.styles.padding } },
        }),
      };
    }
    return normalized;
  };

  return {
    ...structuredClone(document),
    settings: normalizeEmailSettings(document.settings),
    blocks: document.blocks.map(block => isEmailContainer(block)
      ? normalizeContainer(structuredClone(block))
      : normalizeContainer(createEmailSection([structuredClone(block)]))),
  };
}

export const DEFAULT_EMAIL_TYPOGRAPHY: EmailTypographyScale = {
  body: { fontSize: 16, color: '#24314d' },
  h1: { fontSize: 30, color: '#14213d' },
  h2: { fontSize: 22, color: '#14213d' },
  h3: { fontSize: 17, color: '#14213d' },
  textLineHeight: 1.55,
  headingLineHeight: 1.25,
};

export const DEFAULT_EMAIL_SETTINGS: EmailDocumentSettings = {
  width: 640,
  outerBackground: '#eef1f5',
  contentBackground: '#ffffff',
  linkColor: '#0b57d0',
  linkUnderline: true,
  primaryColor: '#0b57d0',
  typography: DEFAULT_EMAIL_TYPOGRAPHY,
};

/** Documents saved before the typography scale existed are filled in here. */
export function normalizeEmailSettings(
  settings: Partial<EmailDocumentSettings> | undefined,
): EmailDocumentSettings {
  const scale = settings?.typography;
  return {
    ...DEFAULT_EMAIL_SETTINGS,
    ...settings,
    linkUnderline: settings?.linkUnderline ?? DEFAULT_EMAIL_SETTINGS.linkUnderline,
    typography: {
      ...DEFAULT_EMAIL_TYPOGRAPHY,
      ...scale,
      body: { ...DEFAULT_EMAIL_TYPOGRAPHY.body, ...scale?.body },
      h1: { ...DEFAULT_EMAIL_TYPOGRAPHY.h1, ...scale?.h1 },
      h2: { ...DEFAULT_EMAIL_TYPOGRAPHY.h2, ...scale?.h2 },
      h3: { ...DEFAULT_EMAIL_TYPOGRAPHY.h3, ...scale?.h3 },
    },
  };
}

/**
 * Applies the document-wide scale to a newly created block, so a heading or a
 * paragraph added from the palette matches the rest of the email immediately.
 */
export function applyDocumentTypography(
  block: EmailTemplateBlock,
  settings: EmailDocumentSettings,
): EmailTemplateBlock {
  const { typography } = settings;
  if (block.type === 'heading') {
    const level = block.properties.level ?? 2;
    const scale = level === 1 ? typography.h1 : level === 2 ? typography.h2 : typography.h3;
    return {
      ...block,
      styles: {
        ...block.styles,
        fontSize: scale.fontSize,
        color: scale.color,
        lineHeight: typography.headingLineHeight,
      },
    };
  }
  if (block.type === 'paragraph') {
    return {
      ...block,
      styles: {
        ...block.styles,
        fontSize: typography.body.fontSize,
        color: typography.body.color,
        lineHeight: typography.textLineHeight,
      },
    };
  }
  return block;
}

export function createBlankEmailDocument(): EmailEditorSchema {
  return {
    schemaVersion: 1,
    settings: { ...DEFAULT_EMAIL_SETTINGS, typography: { ...DEFAULT_EMAIL_TYPOGRAPHY } },
    blocks: [],
  };
}

const polishBlock = (
  type: EmailBlockType,
  properties: Partial<EmailTemplateBlock['properties']> = {},
  styles: Partial<EmailBlockStyles> = {},
): EmailTemplateBlock => {
  const block = createEmailBlock(type);
  block.properties = { ...block.properties, ...properties };
  block.styles = { ...block.styles, ...styles, padding: { ...block.styles.padding, ...(styles.padding ?? {}) } };
  return block;
};

const emailSection = (...blocks: EmailTemplateBlock[]): EmailTemplateBlock => {
  const section = createEmailSection(blocks);
  section.styles.padding = { top: 0, right: 0, bottom: 0, left: 0 };
  section.properties.minHeight = 0;
  return section;
};

const headingSection = (eyebrow: string, title: string, copy: string): EmailTemplateBlock => {
  const eyebrowBlock = polishBlock('paragraph', { html: `<strong>${eyebrow}</strong>` }, { color: '#b07b08', fontSize: 12, fontWeight: 700, lineHeight: 1.2, padding: { top: 28, right: 32, bottom: 5, left: 32 } });
  const heading = polishBlock('heading', { html: title, level: 1 }, { color: '#14213d', fontSize: 29, fontWeight: 700, lineHeight: 1.2, padding: { top: 0, right: 32, bottom: 9, left: 32 } });
  const paragraph = polishBlock('paragraph', { html: copy }, { color: '#5f6b80', fontSize: 15, lineHeight: 1.55, padding: { top: 0, right: 32, bottom: 26, left: 32 } });
  return emailSection(eyebrowBlock, heading, paragraph);
};

const flushSection = (...children: EmailTemplateBlock[]): EmailTemplateBlock => {
  const section = emailSection(...children);
  section.styles.padding = { top: 0, right: 0, bottom: 0, left: 0 };
  section.styles.backgroundColor = 'transparent';
  return section;
};

/**
 * Reusable CTA card preset composed entirely from normal editor blocks.
 * The card owns the surface while the heading, copy, and button remain
 * independently selectable and editable in the layer tree.
 */
export const createCallToActionSection = (
  heading = 'What\'s next?',
  copy = 'Add a concise explanation of the next action.',
  label = 'Continue',
  href = '#',
): EmailTemplateBlock => {
  const title = polishBlock('heading', { html: heading, level: 3 }, {
    color: '#102442', fontSize: 17, fontWeight: 700, lineHeight: 1.3,
    padding: { top: 0, right: 0, bottom: 6, left: 0 },
  });
  title.name = 'CTA heading';
  const message = polishBlock('paragraph', { html: copy }, {
    color: '#64748b', fontSize: 13, lineHeight: 1.55,
    padding: { top: 0, right: 0, bottom: 16, left: 0 },
  });
  message.name = 'CTA supporting text';
  const action = polishBlock('button', { label, href }, {
    backgroundColor: '#173f76', color: '#ffffff', align: 'left', fontSize: 13,
    fontWeight: 600, borderColor: '#173f76', borderWidth: 1, borderRadius: 6,
    padding: { top: 11, right: 17, bottom: 11, left: 17 },
  });
  action.name = 'CTA button';
  const card = emailSection(title, message, action);
  card.name = 'Call to action card';
  card.styles.backgroundColor = '#f7f9fc';
  card.styles.borderColor = '#dce5ef';
  card.styles.borderWidth = 1;
  card.styles.borderRadius = 10;
  card.styles.padding = { top: 22, right: 24, bottom: 22, left: 24 };
  card.properties.outerSpacing = { top: 24, right: 0, bottom: 0, left: 0 };
  return card;
};

const emailColumns = (columns: EmailTemplateBlock[][], widths?: number[], name = 'Columns'): EmailTemplateBlock => {
  const layout = createEmailBlock('columns');
  layout.name = name;
  layout.properties.columns = Math.min(4, Math.max(1, columns.length)) as 1 | 2 | 3 | 4;
  layout.properties.columnWidths = widths ?? columns.map(() => 1);
  layout.styles.backgroundColor = 'transparent';
  layout.styles.padding = { top: 0, right: 0, bottom: 0, left: 0 };
  layout.children = columns.map((children, index) => {
    const column = emailSection(...children);
    column.name = `${name} · Column ${index + 1}`;
    column.styles.backgroundColor = 'transparent';
    column.styles.padding = { top: 0, right: 0, bottom: 0, left: 0 };
    return column;
  });
  return layout;
};

const welcomeHeroSection = (): EmailTemplateBlock => {
  const title = polishBlock('heading', { html: 'Welcome aboard,<br>{{recipient.firstName}}.', level: 1 }, {
    color: '#102442', fontSize: 32, fontWeight: 700, lineHeight: 1.13, letterSpacing: -0.5,
    padding: { top: 0, right: 0, bottom: 13, left: 0 },
  });
  title.name = 'Welcome title';
  const body = polishBlock('paragraph', { html: 'We are pleased to welcome you as our new <strong>{{employee.jobTitle}}</strong>.<br>Your first-day briefing and key contacts are outlined below.' }, {
    color: '#405471', fontSize: 14, lineHeight: 1.57,
    padding: { top: 7, right: 0, bottom: 7, left: 0 },
  });
  body.name = 'Welcome message';
  const action = polishBlock('button', {
    label: 'Open Onboarding Workspace', href: '{{onboarding.hubUrl}}',
    outerSpacing: { top: 25, right: 0, bottom: 0, left: 0 },
  }, {
    backgroundColor: '#222D4E', color: '#ffffff', align: 'left', fontSize: 13, fontWeight: 700,
    lineHeight: 1.2, padding: { top: 14, right: 20, bottom: 14, left: 20 }, borderRadius: 8,
  });
  action.name = 'Onboarding hub button';

  const photo = polishBlock('profile_photo', { src: '{{recipient.profilePhotoUrl}}', alt: '{{recipient.fullName}}', width: 118 }, {
    align: 'center', padding: { top: 0, right: 0, bottom: 12, left: 0 },
  });
  photo.name = 'Employee profile photo';
  const name = polishBlock('heading', { html: '{{employee.fullName}}', level: 3 }, {
    color: '#102442', align: 'center', fontSize: 16, fontWeight: 700, lineHeight: 1.3,
    padding: { top: 0, right: 0, bottom: 4, left: 0 },
  });
  name.name = 'Employee name';
  const role = polishBlock('paragraph', { html: '{{employee.jobTitle}}' }, {
    color: '#74849b', align: 'center', fontSize: 12, lineHeight: 1.35,
    padding: { top: 0, right: 0, bottom: 10, left: 0 },
  });
  role.name = 'Employee job title';
  const employeeId = polishBlock('information_card', {
    html: '<strong>Employee ID:&nbsp; </strong><span style="font-weight:400">{{employee.number}}</span>',
    widthPercent: 89,
  }, {
    backgroundColor: '#fbfcfe', color: '#173f76', align: 'center', fontSize: 12, fontWeight: 700,
    borderColor: '#dce5ef', borderWidth: 1, borderRadius: 6,
    padding: { top: 5, right: 8, bottom: 5, left: 7 },
  });
  employeeId.name = 'Employee ID';

  const layout = emailColumns([[title, body, action], [photo, name, role, employeeId]], [70, 30], 'Welcome layout');
  const copyColumn = layout.children[0];
  if (copyColumn) copyColumn.properties.minHeight = 224;
  const section = emailSection(layout);
  section.name = 'Welcome hero';
  section.styles.backgroundColor = '#ffffff';
  section.styles.padding = { top: 36, right: 36, bottom: 36, left: 36 };
  section.locked = true;
  return section;
};

/**
 * Reusable first-day overview preset composed entirely from normal editor
 * blocks: an editable title, a four-column fact grid (start date, arrival
 * time, worksite, report-to) and a call-to-action card. Every part remains
 * independently selectable and customizable.
 */
export const createFirstDayOverviewSection = (): EmailTemplateBlock => {
  const grid = createEmailBlock('smart_fact_grid');
  grid.name = 'Overview tiles';
  grid.properties.html = 'Your First-Day Overview';
  grid.styles.fontSize = 16;
  const nextSteps = createCallToActionSection(
    'What&rsquo;s next?',
    'Complete your pre-arrival tasks, review your schedule, and get ready for day one.',
    'View Your Onboarding Roadmap',
    '{{onboarding.roadmapUrl}}',
  );
  nextSteps.styles.backgroundColor = '#F2F7FD';
  nextSteps.styles.borderColor = '#D4E2F2';
  const ctaButton = nextSteps.children[2];
  if (ctaButton) {
    ctaButton.styles.backgroundColor = '#1F2D51';
    ctaButton.styles.borderColor = '#EBC24F';
    ctaButton.styles.borderWidth = 0;
    ctaButton.styles.borderRadius = 8;
  }
  const section = emailSection(grid, nextSteps);
  section.name = 'First-day overview';
  section.styles.backgroundColor = '#ffffff';
  section.styles.borderColor = '#dce5ef';
  section.styles.padding = { top: 34, right: 34, bottom: 34, left: 34 };
  return section;
};

const brandSection = (): EmailTemplateBlock => {
  const logo = polishBlock('company_logo', { src: '/assets/images/email/company-logo.png', width: 269 }, {
    backgroundColor: '#1F2D51', padding: { top: 25, right: 46, bottom: 25, left: 20 },
  });
  logo.name = 'Company logo';
  const rule = polishBlock('divider', {}, {
    borderColor: '#f7b900', borderWidth: 3,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  rule.name = 'Brand rule';
  return flushSection(logo, rule);
};
const supportSection = (): EmailTemplateBlock => {
  const heading = polishBlock('heading', { html: 'We&rsquo;re here to support you', level: 3 }, {
    backgroundColor: 'transparent', color: '#ffffff', fontSize: 14, fontWeight: 700, lineHeight: 1.43,
    padding: { top: 0, right: 0, bottom: 5, left: 0 },
  });
  const copy = polishBlock('paragraph', { html: 'If you have any questions, our People Operations team is here to help.' }, {
    backgroundColor: 'transparent', color: '#d8e4f1', fontSize: 12, lineHeight: 1.55,
    padding: { top: 0, right: 0, bottom: 15, left: 0 },
  });
  const contacts = polishBlock('icon_list', {
    iconItems: [
      { icon: 'Mail', text: '{{support.email}}' },
      { icon: 'Phone', text: '{{support.phone}}' },
    ],
    iconShape: 'rounded',
    iconTreatment: 'plain',
    iconColor: '#FFFFFF',
    iconBackground: '#f7b900',
  }, {
    backgroundColor: 'transparent', color: '#ffffff', fontSize: 12, fontWeight: 600,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  const section = emailSection(heading, copy, contacts);
  section.name = 'Support section';
  section.styles.backgroundColor = '#222D4E';
  section.styles.padding = { top: 34, right: 48, bottom: 34, left: 48 };
  return section;
};
/** Minimal legal footer baked from the user's approved Copy Layout design. */
const legalSection = (): EmailTemplateBlock => {
  const footer = polishBlock('legal_footer', {
    html: '{{company.legalName}}<br><span style="font-weight:400">{{company.address}}</span>',
  }, {
    backgroundColor: '#ffffff', color: '#74849b', fontSize: 12, lineHeight: 1.55,
    padding: { top: 28, right: 48, bottom: 34, left: 48 },
  });
  footer.name = 'Legal Footer';
  const section = emailSection(footer);
  section.name = 'Legal footer';
  section.styles.backgroundColor = '#ffffff';
  section.styles.padding = { top: 8, right: 8, bottom: 8, left: 8 };
  return section;
};
const supportAndLegal = (): EmailTemplateBlock[] => [supportSection(), legalSection()];

/** Tags a top-level block as part of the shared chrome. */
const asChrome = (
  block: EmailTemplateBlock,
  chromeRole: EmailChromeRole,
): EmailTemplateBlock => {
  block.properties.chromeRole = chromeRole;
  return block;
};

/** The company chrome every starter ships with. */
export function createDefaultEmailChrome(): { header: EmailTemplateBlock[]; footer: EmailTemplateBlock[] } {
  return {
    header: [asChrome(brandSection(), 'header')],
    footer: supportAndLegal().map(block => asChrome(block, 'footer')),
  };
}

/** The chrome blocks currently held by a document, in document order. */
export function extractEmailChrome(document: EmailEditorSchema): { header: EmailTemplateBlock[]; footer: EmailTemplateBlock[] } {
  return {
    header: document.blocks.filter(block => block.properties.chromeRole === 'header'),
    footer: document.blocks.filter(block => block.properties.chromeRole === 'footer'),
  };
}

/** True when the document's chrome still matches the shared chrome. */
export function documentMatchesChrome(
  document: EmailEditorSchema,
  chrome: { header: EmailTemplateBlock[]; footer: EmailTemplateBlock[] },
): boolean {
  const current = extractEmailChrome(document);
  // Ids are regenerated on every copy, so compare everything except them.
  const strip = (blocks: EmailTemplateBlock[]): string =>
    JSON.stringify(blocks, (key, value) => (key === 'id' ? undefined : value));
  return (
    strip(current.header) === strip(chrome.header) &&
    strip(current.footer) === strip(chrome.footer)
  );
}

/**
 * Replaces a document's chrome blocks with fresh copies of the shared chrome,
 * keeping the header at the top and the footer at the bottom. Content blocks
 * and their order are untouched; a document that has detached its chrome
 * (no tagged blocks) gets the chrome re-attached at the correct ends.
 */
export function applyEmailChrome(
  document: EmailEditorSchema,
  chrome: { header: EmailTemplateBlock[]; footer: EmailTemplateBlock[] },
): EmailEditorSchema {
  const content = document.blocks.filter(block => !block.properties.chromeRole);
  const copy = (blocks: EmailTemplateBlock[], role: EmailChromeRole): EmailTemplateBlock[] =>
    blocks.map(block => {
      const clone = cloneEmailBlock(block);
      clone.properties.chromeRole = role;
      return clone;
    });
  return {
    ...document,
    blocks: [...copy(chrome.header, 'header'), ...content, ...copy(chrome.footer, 'footer')],
  };
}

/**
 * Complete, purpose-specific corporate starter. Trigger-aware composition keeps
 * operational templates relevant instead of applying one cosmetic family shell.
 */

const EMAIL_ASSET_BASE = '/assets/images/email';

/** Hero used by every non-welcome template: copy column + circular illustration. */
const illustrationHero = (
  eyebrow: string,
  titleHtml: string,
  copyHtml: string,
  asset: string,
  options: { ctaLabel?: string; ctaHref?: string; expiry?: string } = {},
): EmailTemplateBlock => {
  const eyebrowBlock = polishBlock('paragraph', { html: `<strong>${eyebrow}</strong>` }, {
    color: '#2f639d', fontSize: 12, fontWeight: 700, lineHeight: 1.4, letterSpacing: 1.4,
    padding: { top: 0, right: 0, bottom: 10, left: 0 },
  });
  eyebrowBlock.name = 'Eyebrow';
  const title = polishBlock('heading', { html: titleHtml, level: 1 }, {
    color: '#102442', fontSize: 28, fontWeight: 700, lineHeight: 1.18, letterSpacing: -0.4,
    padding: { top: 0, right: 0, bottom: 12, left: 0 },
  });
  title.name = 'Title';
  const copy = polishBlock('paragraph', { html: copyHtml }, {
    color: '#405471', fontSize: 14, lineHeight: 1.57,
    padding: { top: 0, right: 0, bottom: options.ctaLabel ? 20 : 0, left: 0 },
  });
  copy.name = 'Intro copy';
  const left: EmailTemplateBlock[] = [eyebrowBlock, title, copy];
  if (options.ctaLabel) {
    const action = polishBlock('button', { label: `${options.ctaLabel}  →`, href: options.ctaHref ?? '#' }, {
      backgroundColor: '#082450', color: '#ffffff', align: 'left', fontSize: 13, fontWeight: 700,
      lineHeight: 1.2, padding: { top: 14, right: 20, bottom: 14, left: 20 }, borderRadius: 5,
    });
    action.name = 'Primary action';
    left.push(action);
  }
  if (options.expiry) {
    const expiry = polishBlock('paragraph', { html: options.expiry }, {
      color: '#74849b', fontSize: 12, lineHeight: 1.5,
      padding: { top: 12, right: 0, bottom: 0, left: 0 },
    });
    expiry.name = 'Expiry note';
    left.push(expiry);
  }
  const illustration = polishBlock('image', { src: `${EMAIL_ASSET_BASE}/${asset}`, alt: '', width: 168 }, {
    align: 'center', padding: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  illustration.name = 'Illustration';
  const section = emailSection(emailColumns([left, [illustration]], [66, 34], 'Hero layout'));
  section.name = 'Hero';
  section.styles.backgroundColor = '#ffffff';
  section.styles.padding = { top: 36, right: 36, bottom: 36, left: 36 };
  return section;
};

const contentSection = (name: string, ...blocks: EmailTemplateBlock[]): EmailTemplateBlock => {
  const section = emailSection(...blocks);
  section.name = name;
  section.styles.backgroundColor = '#ffffff';
  section.styles.borderColor = '#dce5ef';
  section.styles.padding = { top: 26, right: 36, bottom: 26, left: 36 };
  return section;
};

const sectionTitle = (text: string): EmailTemplateBlock => {
  const title = polishBlock('paragraph', { html: `<strong>${text}</strong>` }, {
    color: '#082450', fontSize: 12, fontWeight: 700, lineHeight: 1.4, letterSpacing: 1.35,
    padding: { top: 0, right: 0, bottom: 14, left: 0 },
  });
  title.name = `${text} title`;
  return title;
};

const sectionRule = (): EmailTemplateBlock => {
  const rule = polishBlock('divider', {}, {
    backgroundColor: '#ffffff', borderColor: '#dce5ef', borderWidth: 1,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  rule.name = 'Section rule';
  return rule;
};

const infoCard = (name: string, html: string): EmailTemplateBlock => {
  const card = polishBlock('information_card', { html }, {
    backgroundColor: '#f2f7fd', color: '#405471', fontSize: 12, lineHeight: 1.55,
    borderColor: '#d4e2f2', borderWidth: 1, borderRadius: 5,
    padding: { top: 17, right: 19, bottom: 17, left: 19 },
  });
  card.name = name;
  return card;
};

const statusList = (items: EmailStatusItem[]): EmailTemplateBlock => {
  const list = createEmailBlock('smart_status_list');
  list.properties.statusItems = items;
  return list;
};

const progressBar = (label: string, percent: number, caption: string): EmailTemplateBlock => {
  const bar = createEmailBlock('smart_progress');
  bar.properties.html = label;
  bar.properties.percent = percent;
  bar.properties.progressCaption = caption;
  return bar;
};

const factGrid = (
  name: string,
  tiles: { icon: string; label: string; value: string; caption: string }[],
  options: { perRow?: 1 | 2 | 3 | 4; dividers?: boolean; align?: 'left' | 'center' } = {},
): EmailTemplateBlock => {
  const grid = createEmailBlock('smart_fact_grid');
  grid.name = name;
  grid.properties.html = '';
  grid.properties.factTiles = tiles;
  grid.properties.columns = options.perRow ?? (Math.min(4, Math.max(1, tiles.length)) as 1 | 2 | 3 | 4);
  grid.properties.factTileAlign = options.align ?? 'center';
  grid.properties.factDividers = options.dividers ?? true;
  return grid;
};

const primaryButton = (label: string, href: string): EmailTemplateBlock => {
  const action = polishBlock('button', { label: `${label}  →`, href }, {
    backgroundColor: '#082450', color: '#ffffff', align: 'left', fontSize: 13, fontWeight: 700,
    lineHeight: 1.2, padding: { top: 14, right: 20, bottom: 14, left: 20 }, borderRadius: 5,
  });
  action.name = label;
  return action;
};

const expiryNote = (html: string): EmailTemplateBlock => {
  const note = polishBlock('paragraph', { html }, {
    color: '#74849b', fontSize: 12, lineHeight: 1.5,
    padding: { top: 12, right: 0, bottom: 0, left: 0 },
  });
  note.name = 'Expiry note';
  return note;
};

export function createStarterEmailDocument(family: EmailTemplateFamily, triggerKey?: string): EmailEditorSchema {
  const document = createBlankEmailDocument();
  const trigger = triggerKey ?? (family === 'onboarding' ? 'onboarding.case_created' : family === 'user_invitation' ? 'identity.invitation_created' : 'worker.invitation_created');
  document.settings.width = 680;
  document.settings.outerBackground = '#eef3f8';
  const sections: EmailTemplateBlock[] = [asChrome(brandSection(), 'header')];

  if (trigger === 'onboarding.case_created') {
    const heroRule = polishBlock('divider', {}, {
      backgroundColor: '#ffffff', borderColor: '#dce5ef', borderWidth: 1,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    heroRule.name = 'Section rule';
    sections.push(welcomeHeroSection(), flushSection(heroRule), createFirstDayOverviewSection());
  } else if (trigger === 'onboarding.tasks_pending') {
    sections.push(
      illustrationHero('Keep moving forward', 'Complete your<br>onboarding tasks', 'You&rsquo;re making great progress. Finish the remaining items to stay on track for a successful start.', 'envelope-user.png', { ctaLabel: 'Go to my tasks', ctaHref: '{{onboarding.hubUrl}}' }),
      flushSection(sectionRule()),
      contentSection('Onboarding progress',
        sectionTitle('Your onboarding progress'),
        progressBar('', 65, ''),
      ),
      contentSection('Task checklist',
        statusList([
          { title: 'Personal information', meta: 'Confirmed', status: 'done' },
          { title: 'Employment details', meta: 'Confirmed', status: 'done' },
          { title: 'Required documents', meta: '2 of 4 uploaded', status: 'current' },
          { title: 'Review & confirmation', meta: 'Pending HR review', status: 'pending' },
          { title: 'Day-one instructions', meta: 'Available closer to start date', status: 'pending' },
        ]),
      ),
      contentSection('Remaining tasks',
        sectionTitle('Remaining tasks'),
        polishBlock('icon_list', {
          iconItems: [
            { icon: 'FileText', text: 'Upload identification — government-issued photo ID' },
            { icon: 'FileText', text: 'Tax documents — personal tax registration form' },
            { icon: 'UserRound', text: 'Emergency contact — add your emergency contacts' },
          ],
          iconShape: 'rounded', iconTreatment: 'outline', iconColor: '#173f76', iconBackground: '#ffffff',
        }, { color: '#405471', fontSize: 12, lineHeight: 1.55, padding: { top: 0, right: 0, bottom: 16, left: 0 } }),
        primaryButton('Continue my tasks', '{{onboarding.hubUrl}}'),
      ),
    );
  } else if (trigger === 'onboarding.documents_missing') {
    sections.push(
      illustrationHero('Action required', 'You have missing<br>documents', 'To keep your onboarding on track, please upload the documents listed below.', 'folder-alert.png'),
      flushSection(sectionRule()),
      contentSection('Deadline callout',
        infoCard('Start date approaching', '<strong>Your start date is approaching.</strong><br>Please complete these items by <strong>{{invitation.expiresAt}}</strong>.'),
      ),
      contentSection('Missing documents',
        sectionTitle('Missing documents'),
        polishBlock('icon_list', {
          iconItems: [
            { icon: 'FileText', text: 'Proof of address — utility bill or bank statement' },
            { icon: 'Award', text: 'Education certificate — highest qualification certificate' },
            { icon: 'FileText', text: 'Tax registration — TIN or TRN document' },
          ],
          iconShape: 'rounded', iconTreatment: 'outline', iconColor: '#173f76', iconBackground: '#ffffff',
        }, { color: '#405471', fontSize: 12, lineHeight: 1.55, padding: { top: 0, right: 0, bottom: 16, left: 0 } }),
        primaryButton('Upload documents', '{{onboarding.hubUrl}}'),
      ),
      contentSection('Why this matters',
        infoCard('Why this matters', '<strong>Why this matters</strong><br>We&rsquo;re required to collect these documents before your first day.'),
      ),
    );
  } else if (trigger === 'onboarding.start_approaching') {
    sections.push(
      illustrationHero('Get ready for day one', 'Here&rsquo;s everything you<br>need to know', 'We look forward to welcoming you. Review your schedule and important day-one details below.', 'calendar-illustration.png'),
      flushSection(sectionRule()),
      contentSection('Day-one schedule',
        sectionTitle('Your day-one schedule'),
        factGrid('Schedule', [
          { icon: '', label: '8:30 AM', value: 'Arrival & check-in', caption: 'Main Reception' },
          { icon: '', label: '9:00 AM', value: 'Welcome & introductions', caption: 'People Operations team' },
          { icon: '', label: '10:00 AM', value: 'Site orientation', caption: 'HSE & safety briefing' },
          { icon: '', label: '11:30 AM', value: 'Team overview', caption: 'Meet your teammates' },
          { icon: '', label: '1:00 PM', value: 'Lunch break', caption: 'Team lunch' },
          { icon: '', label: '2:00 PM', value: 'Systems & tools setup', caption: 'IT & access setup' },
          { icon: '', label: '4:00 PM', value: 'Wrap-up & next steps', caption: 'End of day' },
        ], { perRow: 1, dividers: true, align: 'left' }),
      ),
      contentSection('What to bring',
        sectionTitle('What to bring'),
        factGrid('Bring list', [
          { icon: 'CreditCard', label: 'Photo ID', value: 'Government-issued', caption: '' },
          { icon: 'HardHat', label: 'Safety gear', value: 'If applicable', caption: '' },
          { icon: 'Mail', label: 'This email', value: 'For check-in', caption: '' },
        ], { perRow: 3 }),
      ),
      contentSection('Worksite',
        sectionTitle('Worksite'),
        polishBlock('paragraph', { html: '<strong>{{employee.workAddress}}</strong><br>{{employee.workLocation}}' }, {
          color: '#405471', fontSize: 12, lineHeight: 1.6, padding: { top: 0, right: 0, bottom: 14, left: 0 },
        }),
        primaryButton('View on map', '{{employee.workMapUrl}}'),
      ),
    );
  } else if (trigger === 'onboarding.completed') {
    sections.push(
      illustrationHero('Onboarding complete', 'You&rsquo;re all set!<br>Welcome to the SIOMAC team.', 'Your onboarding is complete. We&rsquo;re excited to have you on board.', 'success-check.png', { ctaLabel: 'Go to employee hub', ctaHref: '{{onboarding.hubUrl}}' }),
      flushSection(sectionRule()),
      contentSection('Completion summary',
        factGrid('Completion stats', [
          { icon: 'CheckCircle', label: 'All tasks', value: 'Completed', caption: '' },
          { icon: 'FileText', label: 'Documents', value: 'Verified', caption: '' },
          { icon: 'Lock', label: 'Access', value: 'Activated', caption: '' },
        ], { perRow: 3 }),
      ),
      contentSection('Next steps',
        infoCard('What is next', '<strong>What&rsquo;s next?</strong><br>Continue exploring resources, connect with your team, and let&rsquo;s achieve great things together.'),
      ),
    );
  } else if (trigger === 'identity.invitation_created') {
    sections.push(
      illustrationHero('You&rsquo;re invited', 'Join SIOMAC<br>onboarding portal', 'You&rsquo;ve been invited to start your onboarding journey with SIOMAC.<br>Create your account to access tasks, documents, and important information.', 'envelope-user.png', { ctaLabel: 'Accept invitation', ctaHref: '{{invitation.acceptUrl}}', expiry: 'This invitation link will expire on {{invitation.expiresAt}}.' }),
      flushSection(sectionRule()),
      contentSection('Portal highlights',
        factGrid('Highlights', [
          { icon: 'ShieldCheck', label: 'Secure & private', value: 'Your information is protected', caption: '' },
          { icon: 'FileText', label: 'One place', value: 'Tasks, documents, progress', caption: '' },
          { icon: 'Laptop', label: 'Mobile friendly', value: 'Access from any device', caption: '' },
        ], { perRow: 3 }),
      ),
    );
  } else if (trigger === 'identity.invitation_reminder') {
    sections.push(
      illustrationHero('Just a reminder', 'Your invitation is<br>still waiting', 'We noticed you haven&rsquo;t accepted your invitation to join the SIOMAC onboarding portal.<br>Accept your invitation to get started.', 'bell-alert.png', { ctaLabel: 'Accept invitation', ctaHref: '{{invitation.acceptUrl}}', expiry: 'This invitation link will expire on {{invitation.expiresAt}}.' }),
      flushSection(sectionRule()),
      contentSection('Already accepted',
        infoCard('Already accepted', '<strong>Already accepted?</strong><br>If you&rsquo;ve already accepted the invitation, you can ignore this message.'),
      ),
    );
  } else if (trigger === 'identity.invitation_expiring') {
    sections.push(
      illustrationHero('Time sensitive', 'Your invitation<br>expires soon', 'Hi {{recipient.firstName}}. Your invitation to join SIOMAC will expire soon.', 'clock-alert.png'),
      flushSection(sectionRule()),
      contentSection('Countdown',
        sectionTitle('Invitation expires in'),
        factGrid('Countdown', [
          { icon: '', label: 'Days', value: '{{invitation.daysLeft}}', caption: '' },
          { icon: '', label: 'Hours', value: '{{invitation.hoursLeft}}', caption: '' },
          { icon: '', label: 'Mins', value: '{{invitation.minutesLeft}}', caption: '' },
        ], { perRow: 3 }),
        expiryNote('Expires on {{invitation.expiresAt}}'),
      ),
      contentSection('Complete registration',
        polishBlock('paragraph', { html: 'Complete your registration now to secure your access and get started with your onboarding.' }, {
          color: '#405471', fontSize: 12, lineHeight: 1.6, padding: { top: 0, right: 0, bottom: 16, left: 0 },
        }),
        primaryButton('Complete registration', '{{invitation.acceptUrl}}'),
      ),
      contentSection('Why it matters',
        infoCard('Why it matters', '<strong>Why it matters</strong><br>Finishing on time helps your team stay on track and ensures a smooth start on site.'),
      ),
    );
  } else if (trigger === 'identity.invitation_reissued') {
    sections.push(
      illustrationHero('Reissued invitation', 'We&rsquo;ve reissued<br>your invitation', 'Your previous invitation link has been replaced with a new, secure link for your protection.', 'reissued-envelope.png', { ctaLabel: 'Accept new invitation', ctaHref: '{{invitation.acceptUrl}}', expiry: 'This invitation link will expire on {{invitation.expiresAt}}.' }),
      flushSection(sectionRule()),
      contentSection('What changed',
        infoCard('What changed', '<strong>What changed?</strong><br>&bull; A new secure link has been generated.<br>&bull; Your previous link is no longer valid.<br>&bull; If you did not request this reissue, contact our support team.'),
      ),
    );
  } else if (trigger === 'worker.invitation_created') {
    sections.push(
      illustrationHero('You&rsquo;re invited', 'Join SIOMAC and<br>complete your registration', 'You&rsquo;ve been invited to register as a worker.<br>Join our team and get ready to work safely.', 'worker-avatar.png'),
      flushSection(sectionRule()),
      contentSection('Registration summary',
        sectionTitle('Registration summary'),
        factGrid('Summary', [
          { icon: 'Briefcase', label: 'Role', value: '{{employee.jobTitle}}', caption: '' },
          { icon: 'MapPin', label: 'Worksite', value: '{{employee.workAddress}}', caption: '{{employee.workLocation}}' },
          { icon: 'UserRound', label: 'Supervisor', value: '{{manager.fullName}}', caption: '{{manager.jobTitle}}' },
          { icon: 'CalendarDays', label: 'Start date (planned)', value: '{{employee.startDate}}', caption: '' },
        ], { perRow: 2, align: 'left' }),
        primaryButton('Start registration', '{{invitation.acceptUrl}}'),
        expiryNote('This invitation link will expire on {{invitation.expiresAt}}.'),
      ),
      contentSection('What you will need',
        sectionTitle('What you&rsquo;ll need'),
        polishBlock('icon_list', {
          iconItems: [
            { icon: 'CreditCard', text: 'Valid photo ID — driver&rsquo;s licence or national ID' },
            { icon: 'ShieldCheck', text: 'Work eligibility — right to work in Trinidad & Tobago' },
            { icon: 'Phone', text: 'Contact details — personal email and phone number' },
          ],
          iconShape: 'rounded', iconTreatment: 'outline', iconColor: '#173f76', iconBackground: '#ffffff',
        }, { color: '#405471', fontSize: 12, lineHeight: 1.55, padding: { top: 0, right: 0, bottom: 0, left: 0 } }),
      ),
    );
  } else if (trigger === 'worker.site_assigned') {
    sections.push(
      illustrationHero('Site assignment', 'You&rsquo;ve been assigned<br>to a worksite', 'Review your site details, reporting instructions, and start date below.', 'map-pin.png'),
      flushSection(sectionRule()),
      contentSection('Assignment details',
        sectionTitle('Assignment details'),
        factGrid('Assignment', [
          { icon: 'MapPin', label: 'Worksite', value: '{{employee.workAddress}}', caption: '{{employee.workLocation}}' },
          { icon: 'CalendarDays', label: 'Start date', value: '{{employee.startDate}}', caption: '' },
          { icon: 'Clock3', label: 'Shift', value: 'Day Shift', caption: '7:00 AM – 3:30 PM' },
          { icon: 'UserRound', label: 'Supervisor', value: '{{manager.fullName}}', caption: '{{manager.jobTitle}}' },
        ], { perRow: 2, align: 'left' }),
      ),
      contentSection('Reporting guidance',
        infoCard('Reporting guidance', '<strong>Reporting guidance</strong><br>Report to Main Reception on your first day.<br>Bring a valid photo ID and arrive 10 minutes early.'),
        primaryButton('View assignment details', '{{invitation.acceptUrl}}'),
        expiryNote('This invitation link will expire on {{invitation.expiresAt}}.'),
      ),
    );
  } else if (trigger === 'worker.documents_required') {
    sections.push(
      illustrationHero('Compliance checklist', 'Complete your<br>compliance requirements', 'These requirements help us maintain a safe, compliant, and productive workplace.', 'shield-check.png'),
      flushSection(sectionRule()),
      contentSection('Compliance progress',
        sectionTitle('Compliance progress'),
        progressBar('', 50, '3 of 6 completed'),
      ),
      contentSection('Compliance items',
        statusList([
          { title: 'HSE Induction', meta: 'Completed 12 Sep 2026', status: 'done' },
          { title: 'Site Safety Brief', meta: 'Completed 12 Sep 2026', status: 'done' },
          { title: 'Drug & Alcohol Policy', meta: 'Due 18 Sep 2026', status: 'current' },
          { title: 'Cyber Security Awareness', meta: 'Due 18 Sep 2026', status: 'current' },
          { title: 'Code of Conduct', meta: 'Due 18 Sep 2026', status: 'pending' },
          { title: 'Right to Work Verification', meta: 'Due 18 Sep 2026', status: 'pending' },
        ]),
      ),
      contentSection('Why this matters',
        infoCard('Why this matters', '<strong>Why this matters</strong><br>Completing these items ensures your safety, protects our team, and keeps projects on track.'),
        primaryButton('Continue compliance', '{{invitation.acceptUrl}}'),
      ),
    );
  } else if (trigger === 'worker.invitation_reminder') {
    sections.push(
      illustrationHero('Action needed', 'Your registration<br>is not complete', 'We noticed you haven&rsquo;t completed your registration yet.<br>Let&rsquo;s get you across the finish line.', 'bell-alert.png'),
      flushSection(sectionRule()),
      contentSection('Incomplete registration',
        infoCard('Registration incomplete', '<strong>Your registration is incomplete</strong><br>Finish the remaining steps to secure your access and start on time.'),
      ),
      contentSection('Next steps',
        sectionTitle('Next steps'),
        factGrid('Steps', [
          { icon: '', label: 'Step 01', value: 'Log in to your invitation', caption: 'Use the link below to continue.' },
          { icon: '', label: 'Step 02', value: 'Complete remaining tasks', caption: 'Update your details and upload documents.' },
          { icon: '', label: 'Step 03', value: 'Submit for review', caption: 'We&rsquo;ll review and confirm your access.' },
        ], { perRow: 1, dividers: true, align: 'left' }),
        primaryButton('Continue registration', '{{invitation.acceptUrl}}'),
        expiryNote('This invitation link will expire on {{invitation.expiresAt}}.'),
      ),
    );
  }

  sections.push(...supportAndLegal().map(block => asChrome(block, 'footer')));
  document.blocks = sections;
  return document;
}

export function cloneEmailBlock(block: EmailTemplateBlock): EmailTemplateBlock {
  const clone = structuredClone(block);
  const renew = (item: EmailTemplateBlock): void => {
    item.id = uid();
    item.children.forEach(renew);
  };
  renew(clone);
  return clone;
}

function richTextHref(attributes: string): string {
  const match = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributes);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim();
}

export function sanitizeRichText(input: string): string {
  return input
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|embed|form)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (match, attributes: string, content: string) => {
      const href = richTextHref(attributes);
      return /^(?:https?:|mailto:|tel:|\{\{)/i.test(href) ? match : content;
    })
    .replace(/<a\b([^>]*)>/gi, (_match, attributes: string) => {
      const href = richTextHref(attributes);
      if (!/^(?:https?:|mailto:|tel:|\{\{)/i.test(href)) return '<a>';
      const safe = href.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<a href="${safe}" target="_blank" rel="noreferrer">`;
    })
    .replace(/<(?!\/?(?:strong|b|em|i|u|s|br|p|div|h1|h2|h3|ul|ol|li|a|blockquote|span)\b)[^>]*>/gi, '')
    .replace(/<(strong|b|em|i|u|s|p|div|h1|h2|h3|ul|ol|li|blockquote)\b[^>]*>/gi, '<$1>')
    // Spans exist so UN-formatting survives: browsers express "not bold inside
    // a bold-styled block" as <span style="font-weight:normal">. Keep ONLY a
    // curated set of formatting styles; every other span attribute is dropped.
    .replace(/<span\b[^>]*>/gi, match => {
      const styles: string[] = [];
      if (/font-weight:\s*(?:normal|400)/i.test(match)) styles.push('font-weight:400');
      else if (/font-weight:\s*(?:bold|[5-9]00)/i.test(match)) styles.push('font-weight:700');
      if (/font-style:\s*italic/i.test(match)) styles.push('font-style:italic');
      else if (/font-style:\s*normal/i.test(match)) styles.push('font-style:normal');
      if (/text-decoration(?:-line)?:[^;"']*underline/i.test(match)) styles.push('text-decoration:underline');
      else if (/text-decoration(?:-line)?:[^;"']*line-through/i.test(match)) styles.push('text-decoration:line-through');
      return styles.length ? `<span style="${styles.join(';')}">` : '<span>';
    });
}

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char] ?? char);
/** Safe interpolation into a `<style>` block: strip anything that could close it. */
const cssValue = (value: string): string => value.replace(/[<>{}\\;]/g, '').trim();
const backgroundImageCss = (block: EmailTemplateBlock): string => {
  const url = block.properties.backgroundImage?.trim();
  if (!url) return '';
  // Several clients drop background images entirely — the colour is the fallback.
  const display = block.properties.backgroundDisplay ?? 'scale';
  const repeat = display === 'tile' ? 'repeat' : 'no-repeat';
  const size = display === 'scale' ? 'cover' : display === 'fit' ? 'contain' : 'auto';
  return `background-image:url('${escapeHtml(url)}');background-repeat:${repeat};background-size:${size};background-position:center center;`;
};

const css = (block: EmailTemplateBlock): string => {
  const { styles } = block;
  const border = styles.borderWidth ? `${styles.borderWidth}px solid ${styles.borderColor}` : 'none';
  return `background:${styles.backgroundColor};color:${styles.color};font-family:${escapeHtml(EMAIL_FONT_STACK)};text-align:${styles.align};font-size:${styles.fontSize}px;font-weight:${styles.fontWeight};line-height:${styles.lineHeight};letter-spacing:${styles.letterSpacing}px;padding:${styles.padding.top}px ${styles.padding.right}px ${styles.padding.bottom}px ${styles.padding.left}px;border:${border};border-radius:${styles.borderRadius}px;${backgroundImageCss(block)}`;
};

const safeHref = (value: string | undefined): string => {
  const href = value?.trim() ?? '';
  return href === '#' || href.startsWith('{{') || /^(?:https?:|mailto:|tel:)/i.test(href) ? href : '#';
};

const sampleList = (type: EmailBlockType): string[] => {
  if (type === 'required_documents') return ['Proof of address', 'Bank account confirmation'];
  if (type === 'training_assignments') return ['Workplace orientation', 'Information security'];
  if (type === 'equipment_ppe') return ['Laptop and charger', 'Access badge'];
  return ['Complete your employee profile', 'Review and upload required documents'];
};

const transactionalIcon = (type: EmailBlockType): string => {
  if (type === 'pending_tasks') return '&#10003;';
  if (type === 'required_documents') return '&#128196;';
  if (type === 'training_assignments') return '&#9733;';
  if (type === 'equipment_ppe') return '&#9635;';
  if (type === 'manager_contact') return 'M';
  if (type === 'start_date_summary') return '17';
  if (type === 'invitation_expiry') return '!';
  if (type === 'security_notice') return '&#10003;';
  if (type === 'support_contact') return '?';
  return 'i';
};

/**
 * Email SVG is generated from Lucide's own icon data, so the canvas and the
 * delivered email always draw the SAME glyph. Hand-copied paths previously
 * capped the set at eight icons and silently substituted a checkmark for
 * anything else.
 */
type LucideIconNode = [string, Record<string, string | number>][];

const lucideNode = (name: string): LucideIconNode | null => {
  const candidate = (lucide as unknown as Record<string, unknown>)[name];
  return Array.isArray(candidate) ? (candidate as LucideIconNode) : null;
};

/** Icons offered by the picker. Every one renders in both surfaces. */
export const EMAIL_ICON_CHOICES: readonly string[] = [
  'CalendarDays', 'Clock3', 'MapPin', 'UserRound', 'Users', 'Mail', 'Phone', 'Globe',
  'Briefcase', 'Building2', 'Laptop', 'Key', 'FileText', 'BookOpen', 'GraduationCap', 'Award',
  'HardHat', 'ShieldCheck', 'CheckCircle', 'Info', 'Bell', 'Star', 'Target', 'Heart',
  'Coffee', 'Gift', 'Home', 'Car', 'Truck', 'Package', 'CreditCard', 'Wallet',
  'Lock', 'Wifi',
].filter(name => lucideNode(name) !== null);

const renderLucideIcon = (name: string, color: string, size = 18): string => {
  const node = lucideNode(name) ?? lucideNode('CheckCircle');
  const inner = (node ?? [])
    .map(([tag, attrs]) => {
      const parts = Object.entries(attrs)
        .filter(([key]) => key !== 'key')
        .map(([key, value]) => `${key}="${escapeHtml(String(value))}"`)
        .join(' ');
      return `<${tag} ${parts}/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${escapeHtml(color)}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
};

function renderTransactionalContent(block: EmailTemplateBlock): string | null {
  const html = sanitizeRichText(block.properties.html ?? '');
  if (block.type === 'welcome_header') {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#102a56;background-image:linear-gradient(135deg,rgba(255,255,255,.055),rgba(16,42,86,0) 48%)"><tr><td align="center" style="padding-bottom:10px"><span style="display:inline-block;width:38px;height:38px;line-height:38px;border:1px solid #806f31;border-radius:50%;background:#233c63;color:#f3c02f;text-align:center;font-size:18px">&#10022;</span></td></tr><tr><td align="center" style="padding-bottom:10px;color:#f3c02f;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase">Welcome to SIOMAC</td></tr><tr><td align="center" style="color:inherit;font-size:inherit;font-weight:inherit;line-height:inherit">${html}</td></tr><tr><td align="center" style="padding-top:14px"><span style="display:inline-block;width:42px;border-top:3px solid #f3c02f">&nbsp;</span></td></tr></table>`;
  }
  if (block.type === 'employee_details') {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="58" valign="middle"><img src="{{recipient.profilePhotoUrl}}" width="46" height="46" alt="{{recipient.fullName}}" style="display:block;width:46px;height:46px;border-radius:50%;object-fit:cover"></td><td valign="middle" style="color:inherit;font-size:inherit;line-height:inherit">${html}</td><td width="80" align="right" valign="middle"><span style="display:inline-block;padding:5px 9px;border-radius:999px;background:#e9f6ec;color:#24743a;font-size:11px;font-weight:700">Employee</span></td></tr></table>`;
  }
  if (block.type === 'start_date_summary') {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="58" valign="middle"><table role="presentation" width="44" cellpadding="0" cellspacing="0" style="width:44px;border:1px solid #cfd9e7;border-radius:9px;background:#ffffff"><tr><td align="center" style="padding:3px 2px;background:#102a56;color:#ffffff;font-size:8px;font-weight:700;letter-spacing:1px;text-transform:uppercase">Start</td></tr><tr><td align="center" style="padding:4px 2px 5px;color:#102a56;font-size:18px;font-weight:700;line-height:1">&#128197;</td></tr></table></td><td valign="middle"><span style="display:block;margin-bottom:4px;color:#768198;font-size:11px;font-weight:700;letter-spacing:.7px;text-transform:uppercase">Confirmed first-day schedule</span><span style="color:inherit;font-size:inherit;line-height:inherit">${html}</span></td><td width="132" align="right" valign="middle"><span style="display:inline-block;padding:6px 9px;border-radius:999px;background:#edf3fb;color:#415875;font-size:11px;font-weight:700">&#9679;&nbsp; {{employee.workLocation}}</span></td></tr></table>`;
  }
  if (block.type === 'manager_contact') {
    const label = 'Accountable contact';
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="48" valign="middle"><span style="display:inline-block;width:36px;height:36px;line-height:36px;border-radius:9px;background:#102a56;color:#ffffff;text-align:center;font-size:12px;font-weight:700">${transactionalIcon(block.type)}</span></td><td valign="middle"><span style="display:block;margin-bottom:4px;color:#768198;font-size:11px;font-weight:700;letter-spacing:.7px;text-transform:uppercase">${label}</span><span style="color:inherit;font-size:inherit;line-height:inherit">${html}</span></td></tr></table>`;
  }
  const listTypes: EmailBlockType[] = ['pending_tasks', 'required_documents', 'training_assignments', 'equipment_ppe'];
  if (listTypes.includes(block.type)) {
    const sourceItems = sampleList(block.type).slice(0, block.properties.maxItems ?? 5);
    const items = sourceItems.map((item, index) => `<tr><td width="24" valign="top" style="padding:${index ? 9 : 12}px 0 0"><span style="display:inline-block;width:17px;height:17px;line-height:17px;border-radius:50%;background:${index ? '#eef1f5' : '#fff2ce'};color:${index ? '#68748c' : '#8a6511'};text-align:center;font-size:11px">${index + 1}</span></td><td style="padding:${index ? 9 : 12}px 0 0;color:#34415c;font-size:13px;line-height:1.4">${escapeHtml(item)}</td></tr>`).join('');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="42" valign="middle"><span style="display:inline-block;width:32px;height:32px;line-height:32px;border-radius:8px;background:#102a56;color:#ffffff;text-align:center;font-size:13px">${transactionalIcon(block.type)}</span></td><td valign="middle" style="color:inherit;font-size:16px;line-height:1.35">${html}</td><td width="54" align="right"><span style="color:#768198;font-size:11px">${sourceItems.length} items</span></td></tr>${items}</table>`;
  }
  if (block.type === 'support_contact') {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding-bottom:12px;color:#d8e4f1;font-size:12px;line-height:1.65">${html}</td></tr><tr><td style="padding:5px 0;color:#ffffff;font-size:12px"><span style="color:#f7b900">&#9993;</span>&nbsp;&nbsp; ${escapeHtml(block.properties.contactEmail ?? '{{support.email}}')}</td></tr><tr><td style="padding:5px 0;color:#ffffff;font-size:12px"><span style="color:#f7b900">&#9742;</span>&nbsp;&nbsp; ${escapeHtml(block.properties.contactPhone ?? '{{support.phone}}')}</td></tr></table>`;
  }
  if (block.type === 'icon_list') {
    const plainIcon = block.properties.iconTreatment === 'plain';
    const radius = plainIcon ? '0' : block.properties.iconShape === 'circle' ? '50%' : block.properties.iconShape === 'square' ? '0' : '7px';
    const iconColor = block.properties.iconColor ?? block.styles.color;
    const iconBackground = plainIcon ? 'transparent' : (block.properties.iconBackground ?? '#ffffff');
    const iconBorder = plainIcon || block.properties.iconTreatment === 'solid' ? 'none' : '1px solid #dce5ef';
    const rowPad = Math.max(1, Math.round(Math.max(2, (block.styles.lineHeight - 1) * block.styles.fontSize) / 2));
    const rows = (block.properties.iconItems ?? []).map(item => `<tr><td width="38" valign="middle" style="padding:${rowPad}px 10px ${rowPad}px 0"><span style="display:inline-block;width:28px;height:23px;padding-top:5px;border:${iconBorder};border-radius:${radius};background:${escapeHtml(iconBackground)};text-align:center">${renderLucideIcon(item.icon, iconColor)}</span></td><td valign="middle" style="padding:${rowPad}px 0;color:${escapeHtml(block.styles.color)};font-size:${block.styles.fontSize}px;line-height:${block.styles.lineHeight}">${escapeHtml(item.text)}</td></tr>`).join('');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
  }
  if (block.type === 'smart_progress') {
    const percent = Math.max(0, Math.min(100, Math.round(block.properties.percent ?? 0)));
    const heading = sanitizeRichText(block.properties.html ?? '');
    const caption = block.properties.progressCaption?.trim() ?? '';
    const headRow = `<tr><td style="padding-bottom:9px;color:${escapeHtml(block.styles.color)};font-size:${block.styles.fontSize}px;font-weight:${block.styles.fontWeight};letter-spacing:${block.styles.letterSpacing}px;line-height:${block.styles.lineHeight}">${heading}</td><td align="right" style="padding-bottom:9px;color:#102442;font-size:14px;font-weight:700">${percent}%</td></tr>`;
    const captionRow = caption
      ? `<tr><td colspan="2" style="padding-top:7px;color:#74849b;font-size:11px;line-height:1.4">${escapeHtml(caption)}</td></tr>`
      : '';
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%">${headRow}<tr><td colspan="2"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate"><tr><td style="height:10px;border-radius:999px;background:#e8edf4;font-size:1px;line-height:10px"><table role="presentation" width="${percent}%" cellpadding="0" cellspacing="0" style="width:${percent}%;border-collapse:separate"><tr><td style="height:10px;border-radius:999px;background:#0f8a4d;font-size:1px;line-height:10px">&nbsp;</td></tr></table></td></tr></table></td></tr>${captionRow}</table>`;
  }
  if (block.type === 'smart_status_list') {
    const palette: Record<EmailStatusItem['status'], { label: string; color: string; bg: string }> = {
      done: { label: 'Completed', color: '#1d7a3f', bg: '#e9f6ec' },
      current: { label: 'In progress', color: '#8a6511', bg: '#fff5d8' },
      pending: { label: 'Pending', color: '#64748b', bg: '#eef1f5' },
    };
    const listRule = `1px solid ${escapeHtml(block.styles.borderColor)}`;
    const rows = (block.properties.statusItems ?? []).map((item, index) => {
      const tone = palette[item.status] ?? palette.pending;
      return `<tr><td style="padding:11px 0;${index > 0 ? `border-top:${listRule};` : ''}color:${escapeHtml(block.styles.color)};font-size:${block.styles.fontSize}px;font-weight:700;line-height:1.4">${escapeHtml(item.title)}<div style="padding-top:3px;color:#74849b;font-size:11px;font-weight:400;line-height:1.4">${escapeHtml(item.meta)}</div></td><td align="right" valign="middle" style="padding:11px 0;${index > 0 ? `border-top:${listRule};` : ''}"><span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${tone.bg};color:${tone.color};font-size:10px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;white-space:nowrap">${escapeHtml(tone.label)}</span></td></tr>`;
    }).join('');
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%">${rows}</table>`;
  }
  if (block.type === 'smart_fact_grid') {
    const tiles = block.properties.factTiles ?? [];
    const heading = sanitizeRichText(block.properties.html ?? '');
    const perRow = Math.min(4, Math.max(1, block.properties.columns ?? 4));
    const tileAlign = block.properties.factTileAlign ?? 'left';
    const dividers = block.properties.factDividers ?? false;
    const rule = `1px solid ${escapeHtml(block.styles.borderColor)}`;
    const iconSize = Math.max(16, block.properties.iconSize ?? 28);
    const plainIcon = block.properties.iconTreatment === 'plain';
    const radius = plainIcon ? '0' : block.properties.iconShape === 'circle' ? '50%' : block.properties.iconShape === 'square' ? '0' : '7px';
    const iconColor = block.properties.iconColor ?? block.styles.color;
    const iconBackground = plainIcon ? 'transparent' : (block.properties.iconBackground ?? '#ffffff');
    const iconBorder = plainIcon || block.properties.iconTreatment === 'solid' ? 'none' : '1px solid #dce5ef';
    // Email HTML is CONTENT-box: padding-top must come OUT of the height or
    // the icon square renders stretched. The glyph scales with the box.
    const glyphSize = Math.round(iconSize * 0.55);
    const iconPad = Math.max(0, Math.round((iconSize - glyphSize) / 2));
    const cellWidth = (100 / perRow).toFixed(2);
    const cell = (tile: EmailFactTile, position: number): string =>
      `<td class="stack-tile" width="${cellWidth}%" valign="top" align="${tileAlign}" style="width:${cellWidth}%;padding:18px 10px;${dividers && position > 0 ? `border-left:${rule};` : ''}">`
      + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">`
      + (tile.icon.trim()
        ? `<tr><td align="${tileAlign}" style="padding-bottom:10px"><span style="display:inline-block;width:${iconSize}px;height:${iconSize - iconPad}px;padding-top:${iconPad}px;border:${iconBorder};border-radius:${radius};background:${escapeHtml(iconBackground)};text-align:center">${renderLucideIcon(tile.icon, iconColor, glyphSize)}</span></td></tr>`
        : '')
      + `<tr><td align="${tileAlign}" style="padding-bottom:5px;color:#74849b;font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase">${escapeHtml(tile.label)}</td></tr>`
      + `<tr><td align="${tileAlign}" style="padding-bottom:4px;color:${escapeHtml(block.styles.color)};font-size:14px;font-weight:700;line-height:1.38">${escapeHtml(tile.value)}</td></tr>`
      + (tile.caption ? `<tr><td align="${tileAlign}" style="color:#74849b;font-size:12px;line-height:1.55">${escapeHtml(tile.caption)}</td></tr>` : '')
      + `</table></td>`;
    const rows: string[] = [];
    for (let index = 0; index < tiles.length; index += perRow) {
      const slice = tiles.slice(index, index + perRow);
      const filler = slice.length < perRow
        ? `<td width="${((perRow - slice.length) * (100 / perRow)).toFixed(2)}%"></td>`
        : '';
      rows.push(`<tr>${slice.map(cell).join('')}${filler}</tr>`);
    }
    const gridBorders = dividers ? `border-top:${rule};border-bottom:${rule};` : '';
    const headingRow = heading
      ? `<tr><td style="padding-bottom:16px;color:${escapeHtml(block.styles.color)};font-size:${block.styles.fontSize}px;font-weight:${block.styles.fontWeight};line-height:${block.styles.lineHeight};letter-spacing:${block.styles.letterSpacing}px">${heading}</td></tr>`
      : '';
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%">${headingRow}<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;${gridBorders}">${rows.join('')}</table></td></tr></table>`;
  }
  if (block.type === 'invitation_expiry' || block.type === 'security_notice') {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="42" valign="middle"><span style="display:inline-block;width:30px;height:30px;line-height:30px;border:1px solid ${escapeHtml(block.styles.borderColor)};border-radius:50%;background:#ffffff;color:#102a56;text-align:center;font-size:12px;font-weight:700">${transactionalIcon(block.type)}</span></td><td valign="middle" style="color:inherit;font-size:inherit;line-height:inherit">${html}</td></tr></table>`;
  }
  if (block.type === 'legal_footer') {
    // Trust chips mirror the canvas rendering: real Lucide icons in 34px bordered chips.
    const chip = (icon: string): string =>
      `<span style="display:inline-block;width:34px;height:25px;padding-top:9px;border:1px solid #dce5ef;border-radius:6px;background:#ffffff;text-align:center">${renderLucideIcon(icon, '#173f76', 16)}</span>`;
    const links = (block.properties.footerLinks ?? DEFAULT_FOOTER_LINKS)
      .filter(link => link.label.trim())
      .map(link => (link.href.trim()
        ? `<a href="${escapeHtml(safeHref(link.href))}" style="color:#173f76;text-decoration:none">${escapeHtml(link.label)}</a>`
        : escapeHtml(link.label)))
      .join('&nbsp;&nbsp;&middot;&nbsp;&nbsp;');
    const linkRow = links
      ? `<tr><td style="padding-top:7px;color:#173f76;font-size:11px">${links}</td></tr>`
      : '';
    const notice = (block.properties.replyNotice ?? DEFAULT_REPLY_NOTICE).trim();
    const noticeRow = notice
      ? `<tr><td style="padding-top:7px;color:#74849b;font-size:11px">${escapeHtml(notice)}</td></tr>`
      : '';
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding-bottom:18px">${chip('Building2')}&nbsp;&nbsp;${chip('Clock3')}&nbsp;&nbsp;${chip('ShieldCheck')}</td></tr><tr><td style="color:#102442;font-size:11px;font-weight:700;line-height:1.55">${html}</td></tr>${linkRow}${noticeRow}</table>`;
  }
  return null;
}

function renderBlock(block: EmailTemplateBlock): string {
  if (block.hidden) return '';
  const buttonBlock = block.type === 'button' || block.type === 'invitation_action';
  const style = block.type === 'divider'
    ? `background:${block.styles.backgroundColor};padding:${block.styles.padding.top}px ${block.styles.padding.right}px ${block.styles.padding.bottom}px ${block.styles.padding.left}px;border:none;`
    : buttonBlock
    ? `background:transparent;color:${block.styles.color};font-family:${escapeHtml(EMAIL_FONT_STACK)};text-align:${block.styles.align};font-size:${block.styles.fontSize}px;font-weight:${block.styles.fontWeight};line-height:${block.styles.lineHeight};padding:0;border:none;`
    : css(block);
  const width = Math.max(20, Math.min(100, block.properties.widthPercent ?? 100));
  const minHeight = Math.max(0, block.properties.minHeight ?? 0);
  // The canvas treats minHeight as the block's BORDER-box height, but a td's
  // height attribute sizes the CONTENT box — padding was being added on top,
  // making the email taller than the canvas after every resize.
  const innerMinHeight = Math.max(
    0,
    minHeight - block.styles.padding.top - block.styles.padding.bottom,
  );
  const outer = block.properties.outerSpacing ?? ZERO_SPACING;
  const verticalAlign = block.properties.verticalAlign ?? 'top';
  // table-layout:fixed makes the resized percentage width FIRM. Under auto layout a
  // table/cell percentage is only a suggestion — content min-width redistributes it,
  // so a canvas resize (widthPercent) rendered at a different size in the email.
  const open = `<tr><td align="${block.styles.align}" style="padding:${outer.top}px ${outer.right}px ${outer.bottom}px ${outer.left}px"><table role="presentation" width="${width}%" cellpadding="0" cellspacing="0" align="${block.styles.align}" style="width:${width}%;min-height:${minHeight}px;border-collapse:separate;table-layout:fixed"><tr><td valign="${verticalAlign}"${innerMinHeight ? ` height="${innerMinHeight}"` : ''} style="${style};min-height:${innerMinHeight}px">`;
  const close = '</td></tr></table></td></tr>';
  if (block.type === 'section') {
    const children = block.children.map(renderBlock).join('');
    return `${open}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate">${children}</table>${close}`;
  }
  if (block.type === 'columns') {
    const rawWidths = block.properties.columnWidths?.length === block.children.length
      ? block.properties.columnWidths
      : block.children.map(() => 100 / Math.max(1, block.children.length));
    const total = rawWidths.reduce((sum, value) => sum + Math.max(1, value), 0);
    const cells = block.children.map((column, index) => {
      const columnWidth = (Math.max(1, rawWidths[index] ?? 1) / total) * 100;
      const columnMinHeight = Math.max(0, column.properties.minHeight ?? 0);
      // Render the column block itself — a section column carries its own surface and
      // resize geometry (widthPercent/minHeight/background/border/padding), which the
      // canvas always shows. Unwrapping to its children silently dropped all of it.
      return `<td class="stack-col" width="${columnWidth.toFixed(2)}%" valign="${column.properties.verticalAlign ?? 'top'}"${columnMinHeight ? ` height="${columnMinHeight}"` : ''} style="width:${columnWidth.toFixed(2)}%;min-height:${columnMinHeight}px;padding:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate">${renderBlock(column)}</table></td>`;
    }).join('');
    // Fixed layout keeps the stack-col percentage widths firm (matches the canvas flex
    // basis); auto layout would let a long cell steal width from its siblings.
    return `${open}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate;table-layout:fixed"><tr>${cells}</tr></table>${close}`;
  }
  if (block.type === 'divider') return `${open}<div style="border-top:${Math.max(1, block.styles.borderWidth)}px solid ${escapeHtml(block.styles.borderColor)}"></div>${close}`;
  if (block.type === 'spacer') return `${open}<div style="height:${block.properties.height ?? 24}px;line-height:${block.properties.height ?? 24}px">&nbsp;</div>${close}`;
  if (block.type === 'image' || block.type === 'company_logo' || block.type === 'profile_photo') {
    const src = block.properties.src?.trim();
    const imageTag = src
      ? `<img src="${escapeHtml(src)}" width="${block.properties.width ?? 320}" alt="${escapeHtml(block.properties.alt ?? '')}" style="display:inline-block;max-width:100%;height:auto;${block.type === 'profile_photo' ? 'border-radius:999px;' : ''}">`
      : `<div style="padding:28px;border:1px dashed #c7cfdb;color:#77839a;text-align:center">Image placeholder</div>`;
    const image = block.properties.href ? `<a href="${escapeHtml(safeHref(block.properties.href))}" style="text-decoration:none">${imageTag}</a>` : imageTag;
    return `${open}${image}${close}`;
  }
  if (block.type === 'invitation_action') {
    return `${open}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #cfdbef;border-radius:8px;background:#f4f8ff"><tr><td width="54" valign="middle" style="padding:18px 0 18px 20px"><span style="display:inline-block;width:34px;height:34px;line-height:34px;border-radius:9px;background:#102a56;color:#ffffff;text-align:center;font-size:15px">&#9993;</span></td><td valign="middle" style="padding:18px 12px"><span style="display:block;margin-bottom:4px;color:#768198;font-size:11px;font-weight:700;letter-spacing:.7px;text-transform:uppercase">Secure account invitation</span><strong style="color:#24314d;font-size:14px">Complete your SIOMAC access setup</strong></td><td align="right" valign="middle" style="padding:18px 20px 18px 0"><a href="${escapeHtml(safeHref(block.properties.href))}" style="display:inline-block;width:auto;background:${escapeHtml(block.styles.backgroundColor)};color:${escapeHtml(block.styles.color)};font-family:${escapeHtml(EMAIL_FONT_STACK)};font-size:${block.styles.fontSize}px;font-weight:${block.styles.fontWeight};line-height:${block.styles.lineHeight};text-decoration:none;border-radius:${block.styles.borderRadius}px;padding:${block.styles.padding.top}px ${block.styles.padding.right}px ${block.styles.padding.bottom}px ${block.styles.padding.left}px">${escapeHtml(block.properties.label ?? 'Continue')}</a></td></tr></table>${close}`;
  }
  if (buttonBlock) {
    return `${open}<a href="${escapeHtml(safeHref(block.properties.href))}" style="display:inline-block;width:auto;background:${escapeHtml(block.styles.backgroundColor)};color:${escapeHtml(block.styles.color)};font-family:${escapeHtml(EMAIL_FONT_STACK)};font-size:${block.styles.fontSize}px;font-weight:${block.styles.fontWeight};line-height:${block.styles.lineHeight};letter-spacing:${block.styles.letterSpacing}px;text-decoration:none;border-radius:${block.styles.borderRadius}px;padding:${block.styles.padding.top}px ${block.styles.padding.right}px ${block.styles.padding.bottom}px ${block.styles.padding.left}px">${escapeHtml(block.properties.label ?? 'Continue')}</a>${close}`;
  }
  const transactional = renderTransactionalContent(block);
  if (transactional !== null) return `${open}${transactional}${close}`;
  return `${open}${sanitizeRichText(block.properties.html ?? '')}${close}`;
}

/**
 * Schema -> MJML source. This is the production renderer interface mandated by
 * the Email Template Studio contract: the canonical block document compiles to
 * MJML, and MJML (pinned) compiles that into client-compatible HTML with
 * Outlook conditionals. Simple blocks map to native mj-* components; blocks
 * with bespoke geometry (surfaces, smart blocks, transactional designs) embed
 * their table markup via mj-raw, which MJML passes through untouched.
 */
export function renderEmailMjml(document: EmailEditorSchema, title: string): string {
  const settings = normalizeEmailSettings(document.settings);
  const { typography } = settings;
  const pad = (spacing: EmailTemplateBlock['styles']['padding']): string =>
    `${spacing.top}px ${spacing.right}px ${spacing.bottom}px ${spacing.left}px`;
  const combinePad = (block: EmailTemplateBlock): string => {
    const outer = block.properties.outerSpacing ?? ZERO_SPACING;
    const inner = block.styles.padding;
    return `${outer.top + inner.top}px ${outer.right + inner.right}px ${outer.bottom + inner.bottom}px ${outer.left + inner.left}px`;
  };
  // Bespoke table markup must NOT travel via mj-raw inside a column: mj-raw drops the
  // fragment directly into the column table's <tbody>, and a <table> start tag there is
  // invalid HTML — browsers recover by force-closing the outer table, which unravels the
  // whole document (sections escape the padded/background wrapper to body level).
  // mj-text places its content inside a proper <td><div>, where a nested table is valid,
  // so the enclosing section/wrapper geometry survives intact.
  const rawBlock = (block: EmailTemplateBlock): string =>
    `<mj-text align="left" padding="0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate">${renderBlock(block)}</table></mj-text>`;
  // Only the genuinely simple rich types map to mj-text; every block with a
  // bespoke table design (transactional, smart, icon list) travels via mj-raw.
  const plainTextTypes: EmailBlockType[] = ['paragraph', 'heading', 'signature'];
  const isPlainText = (block: EmailTemplateBlock): boolean =>
    plainTextTypes.includes(block.type)
    && block.properties.html !== undefined
    && block.styles.backgroundColor === 'transparent'
    && block.styles.borderWidth === 0
    && block.styles.borderRadius === 0
    && (block.properties.widthPercent ?? 100) === 100
    && (block.properties.minHeight ?? 0) === 0;
  const isPlainGeometry = (block: EmailTemplateBlock): boolean =>
    (block.properties.widthPercent ?? 100) === 100 && (block.properties.minHeight ?? 0) === 0;

  const contentBlock = (block: EmailTemplateBlock): string => {
    if (block.hidden) return '';
    if (isPlainText(block)) {
      return `<mj-text align="${block.styles.align}" color="${escapeHtml(block.styles.color)}" font-size="${block.styles.fontSize}px" font-weight="${block.styles.fontWeight}" line-height="${block.styles.lineHeight}" letter-spacing="${block.styles.letterSpacing}px" padding="${combinePad(block)}">${sanitizeRichText(block.properties.html ?? '')}</mj-text>`;
    }
    if (block.type === 'button' && isPlainGeometry(block)) {
      const outer = block.properties.outerSpacing ?? ZERO_SPACING;
      return `<mj-button href="${escapeHtml(safeHref(block.properties.href))}" align="${block.styles.align}" background-color="${escapeHtml(block.styles.backgroundColor)}" color="${escapeHtml(block.styles.color)}" font-size="${block.styles.fontSize}px" font-weight="${block.styles.fontWeight}" line-height="${block.styles.lineHeight}" letter-spacing="${block.styles.letterSpacing}px" border-radius="${block.styles.borderRadius}px" inner-padding="${pad(block.styles.padding)}" padding="${pad(outer)}">${escapeHtml(block.properties.label ?? 'Continue')}</mj-button>`;
    }
    if ((block.type === 'image' || block.type === 'company_logo' || block.type === 'profile_photo') && isPlainGeometry(block) && block.properties.src?.trim()) {
      const bg = block.styles.backgroundColor !== 'transparent'
        ? ` container-background-color="${escapeHtml(block.styles.backgroundColor)}"`
        : '';
      const radius = block.type === 'profile_photo' ? ' border-radius="999px"' : '';
      const href = block.properties.href ? ` href="${escapeHtml(safeHref(block.properties.href))}"` : '';
      return `<mj-image src="${escapeHtml(block.properties.src.trim())}" alt="${escapeHtml(block.properties.alt ?? '')}" width="${block.properties.width ?? 320}px" align="${block.styles.align}" padding="${combinePad(block)}"${bg}${radius}${href} />`;
    }
    if (block.type === 'divider' && isPlainGeometry(block)) {
      const bg = block.styles.backgroundColor !== 'transparent'
        ? ` container-background-color="${escapeHtml(block.styles.backgroundColor)}"`
        : '';
      return `<mj-divider border-color="${escapeHtml(block.styles.borderColor)}" border-width="${Math.max(1, block.styles.borderWidth)}px" padding="${combinePad(block)}"${bg} />`;
    }
    if (block.type === 'spacer' && isPlainGeometry(block)) {
      return `<mj-spacer height="${block.properties.height ?? 24}px" padding="0" />`;
    }
    return rawBlock(block);
  };

  const isNativeContent = (block: EmailTemplateBlock): boolean =>
    isPlainText(block)
    || (block.type === 'button' && isPlainGeometry(block))
    || ((block.type === 'image' || block.type === 'company_logo' || block.type === 'profile_photo') && isPlainGeometry(block) && Boolean(block.properties.src?.trim()))
    || (block.type === 'divider' && isPlainGeometry(block))
    || (block.type === 'spacer' && isPlainGeometry(block));

  const columnsSection = (block: EmailTemplateBlock): string => {
    const rawWidths = block.properties.columnWidths?.length === block.children.length
      ? block.properties.columnWidths
      : block.children.map(() => 100 / Math.max(1, block.children.length));
    const total = rawWidths.reduce((sum, value) => sum + Math.max(1, value), 0);
    // mj-raw fragments inside mj-column break MJML's column table structure
    // (cells stack and content escapes). If ANY cell holds a block that cannot
    // map to a native mj-* component, the WHOLE columns block ships as our own
    // proven table markup instead.
    // A section column that carries its own surface or resize geometry cannot map to a
    // bare mj-column either — the native path would silently drop it (the canvas shows
    // it), so it must travel through the raw markup path where renderBlock keeps it.
    const columnCarriesSurface = (column: EmailTemplateBlock): boolean => {
      if (column.type !== 'section') return false;
      const spacing = column.properties.outerSpacing ?? ZERO_SPACING;
      return (column.properties.widthPercent ?? 100) !== 100
        || (column.properties.minHeight ?? 0) > 0
        || column.styles.backgroundColor !== 'transparent'
        || column.styles.borderWidth > 0
        || column.styles.borderRadius > 0
        || column.styles.padding.top > 0 || column.styles.padding.right > 0
        || column.styles.padding.bottom > 0 || column.styles.padding.left > 0
        || spacing.top > 0 || spacing.right > 0 || spacing.bottom > 0 || spacing.left > 0;
    };
    const nonNative = block.children.some(column =>
      columnCarriesSurface(column)
      || (column.type === 'section' ? column.children : [column]).some(child => !child.hidden && !isNativeContent(child)));
    if (nonNative) return `<mj-section padding="0"><mj-column width="100%">${rawBlock(block)}</mj-column></mj-section>`;
    const cells = block.children.map((column, index) => {
      const width = ((Math.max(1, rawWidths[index] ?? 1) / total) * 100).toFixed(2);
      const children = column.type === 'section' ? column.children : [column];
      const vertical = column.properties.verticalAlign ?? 'top';
      return `<mj-column width="${width}%" vertical-align="${vertical}">${children.map(contentBlock).join('')}</mj-column>`;
    }).join('');
    return `<mj-section padding="0">${cells}</mj-section>`;
  };

  const wrapperFor = (section: EmailTemplateBlock): string => {
    if (section.hidden) return '';
    const runs: string[] = [];
    let current: EmailTemplateBlock[] = [];
    const flush = (): void => {
      if (!current.length) return;
      runs.push(`<mj-section padding="0"><mj-column width="100%">${current.map(contentBlock).join('')}</mj-column></mj-section>`);
      current = [];
    };
    const children = section.type === 'columns' ? [] : section.children;
    for (const child of children) {
      if (child.hidden) continue;
      if (child.type === 'columns') {
        flush();
        runs.push(columnsSection(child));
      } else if (child.type === 'section') {
        // Nested sections keep their bespoke geometry via raw markup.
        flush();
        runs.push(`<mj-section padding="0"><mj-column width="100%">${rawBlock(child)}</mj-column></mj-section>`);
      } else {
        current.push(child);
      }
    }
    flush();
    const body = section.type === 'columns' ? columnsSection(section) : runs.join('');
    const background = section.styles.backgroundColor !== 'transparent'
      ? ` background-color="${escapeHtml(section.styles.backgroundColor)}"`
      : '';
    const radius = section.styles.borderRadius > 0 ? ` border-radius="${section.styles.borderRadius}px"` : '';
    return `<mj-wrapper padding="${pad(section.styles.padding)}"${background}${radius}>${body}</mj-wrapper>`;
  };

  const headingRule = (tag: string, style: { fontSize: number; color: string }): string =>
    `${tag} { margin: 0; font-family: ${cssValue(EMAIL_FONT_STACK)}; font-size: ${style.fontSize}px; color: ${cssValue(style.color)}; line-height: ${typography.headingLineHeight}; }`;
  return `<mjml>`
    + `<mj-head>`
    + `<mj-title>${escapeHtml(title)}</mj-title>`
    + `<mj-attributes><mj-all font-family="${escapeHtml(EMAIL_FONT_STACK)}" /></mj-attributes>`
    + `<mj-style>a { color: ${cssValue(settings.linkColor)}; text-decoration: ${settings.linkUnderline ? 'underline' : 'none'}; } p { margin: 0; font-size: inherit; color: inherit; line-height: inherit; } ${headingRule('h1', typography.h1)} ${headingRule('h2', typography.h2)} ${headingRule('h3', typography.h3)} @media only screen and (max-width:620px){ .stack-col{display:block!important;width:100%!important;box-sizing:border-box} .stack-tile{display:inline-block!important;width:50%!important;box-sizing:border-box;vertical-align:top} }</mj-style>`
    + `</mj-head>`
    + `<mj-body width="${settings.width}px" background-color="${escapeHtml(settings.outerBackground)}">`
    + document.blocks.map(wrapperFor).join('')
    + `</mj-body>`
    + `</mjml>`;
}

export function renderEmailPreview(document: EmailEditorSchema, title: string): { html: string; text: string } {
  const rows = document.blocks.map(renderBlock).join('');
  const settings = normalizeEmailSettings(document.settings);
  const { typography } = settings;
  // `<style>` content is RAWTEXT: HTML entities are NOT decoded there, so
  // escapeHtml would emit a literal `&quot;` and break the declaration.
  const headingRule = (tag: string, style: { fontSize: number; color: string }): string =>
    `${tag}{margin:0;font-family:${cssValue(EMAIL_FONT_STACK)};font-size:${style.fontSize}px;color:${cssValue(style.color)};line-height:${typography.headingLineHeight}}`;
  const responsiveStyles = `<style>`
    + `a{color:${cssValue(settings.linkColor)};text-decoration:${settings.linkUnderline ? 'underline' : 'none'}}`
    // `p` must INHERIT the owning block's styling. Hard-coding the body scale
    // here overrode every block's own size and flattened the layout; the body
    // scale is applied when a block is created instead.
    + `p{margin:0;font-size:inherit;color:inherit;line-height:inherit}`
    + headingRule('h1', typography.h1)
    + headingRule('h2', typography.h2)
    + headingRule('h3', typography.h3)
    + `@media only screen and (max-width:620px){body{padding:0!important}.stack-col{display:block!important;width:100%!important;box-sizing:border-box}.stack-tile{display:inline-block!important;width:50%!important;box-sizing:border-box;vertical-align:top}}</style>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title>${responsiveStyles}</head><body style="margin:0;padding:24px;background:${escapeHtml(settings.outerBackground)}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="${settings.width}" cellpadding="0" cellspacing="0" style="width:100%;max-width:${settings.width}px;background:${escapeHtml(settings.contentBackground)};font-family:${escapeHtml(EMAIL_FONT_STACK)};border-collapse:separate">${rows}</table></td></tr></table></body></html>`;
  const flatten = (blocks: EmailTemplateBlock[]): EmailTemplateBlock[] => blocks.flatMap(block => [block, ...flatten(block.children)]);
  const text = flatten(document.blocks)
    .filter(block => !block.hidden)
    .map(block => `${block.properties.label ?? ''} ${block.properties.html ?? ''}`.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim())
    .filter(Boolean)
    .join('\n\n');
  return { html, text };
}

export const SAMPLE_PROFILE_PHOTO = "/assets/images/email/sample-employee-avatar.png";
export const SAMPLE_COMPANY_LOGO =
  "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 208 52%22%3E%3Cg fill=%22none%22%3E%3Ctext x=%220%22 y=%2236%22 fill=%22%23fff%22 font-family=%22Arial%22 font-size=%2229%22 font-weight=%22800%22%3ESI%3C/text%3E%3Cg transform=%22translate(42 5)%22 fill=%22%23f7b900%22%3E%3Ccircle cx=%2220%22 cy=%2220%22 r=%2210%22/%3E%3Ccircle cx=%2220%22 cy=%2220%22 r=%225%22 fill=%22%230a2854%22/%3E%3C/g%3E%3Ctext x=%2284%22 y=%2236%22 fill=%22%23fff%22 font-family=%22Arial%22 font-size=%2229%22 font-weight=%22800%22%3EMAC%3C/text%3E%3Ctext x=%22173%22 y=%2234%22 fill=%22%23fff%22 font-family=%22Arial%22 font-size=%229%22 font-weight=%22700%22%3ELTD.%3C/text%3E%3C/g%3E%3C/svg%3E";
export const SAMPLE_VARIABLES: Record<string, string> = {
  "{{company.name}}": "SIOMAC",
  "{{company.legalName}}":
    "SIOMAC Integrated Operations & Maintenance Company Limited",
  "{{company.address}}":
    "#64–70 Lady Hailes Avenue, San Fernando, Trinidad and Tobago",
  "{{company.logoUrl}}": SAMPLE_COMPANY_LOGO,
  "{{recipient.firstName}}": "Maya",
  "{{recipient.fullName}}": "Maya Thompson",
  "{{recipient.profilePhotoUrl}}": SAMPLE_PROFILE_PHOTO,
  "{{invitation.daysLeft}}": "02",
  "{{invitation.hoursLeft}}": "16",
  "{{invitation.minutesLeft}}": "47",
  "{{employee.workMapUrl}}": "https://maps.example/siomac",
  "{{employee.fullName}}": "Maya Thompson",
  "{{employee.number}}": "SI-2841",
  "{{employee.jobTitle}}": "Operations Coordinator",
  "{{employee.department}}": "Operations",
  "{{employee.startDate}}": "14 Sep 2026",
  "{{employee.startDay}}": "Monday",
  "{{employee.startTime}}": "8:30 AM",
  "{{employee.workAddress}}": "#64–70 Lady Hailes Avenue",
  "{{employee.workLocation}}": "San Fernando",
  "{{manager.fullName}}": "Daniel Reyes",
  "{{manager.jobTitle}}": "Operations Manager",
  "{{manager.email}}": "daniel.reyes@example.com",
  "{{support.email}}": "people.operations@siomac.tt",
  "{{support.phone}}": "+1 (868) 657-2457 ext. 112",
  "{{onboarding.hubUrl}}": "#",
  "{{onboarding.roadmapUrl}}": "#",
  "{{invitation.expiresAt}}": "14 August 2026 at 5:00 PM",
  "{{invitation.acceptUrl}}": "https://example.invalid/accept-invitation",
  "{{sender.displayName}}": "HR Operations",
};
/**
 * Substitutes {{variable}} tokens with sample values so a preview shows a
 * realistic message instead of raw placeholders. Shared by the builder's demo
 * mode and the library's preview face.
 */
export const applySampleVariables = (value: string): string =>
  Object.entries(SAMPLE_VARIABLES).reduce(
    (result, [token, sample]) => result.split(token).join(sample),
    value,
  );
