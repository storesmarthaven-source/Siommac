/**
 * src/components/common/dialogs/dialogContextPresets.ts
 *
 * Per-form builders that assemble a DialogContextPanelConfig from a small args bag, so
 * each page doesn't hand-roll the right-hand context pane. One builder per enterprise
 * form. See docs/DIALOGS_AND_FORMS_DESIGN_SPEC.md §10–11.
 */

import type { DialogContextPanelConfig } from './dialogContextTypes';

// ── Organization ▸ Position ──────────────────────────────────────────────────────
export function orgPositionContext(args: {
  title: string;
  positionKey?: string;
  departmentName?: string;
  siteName?: string;
  reportsToTitle?: string;
  defaultSupervisorName?: string;
  headcountBudget?: number | null;
  incumbentCount?: number;
  isSafetyCritical?: boolean;
  duplicateKey?: boolean;
}): DialogContextPanelConfig {
  const filled = args.incumbentCount ?? 0;
  const budget = args.headcountBudget ?? null;
  const vacancy = budget === null ? null : budget - filled;
  return {
    eyebrow: 'HR Organization',
    title: 'Position Context',
    description: 'Preview where this position sits and what it affects.',
    breadcrumb: [
      { label: 'Org Unit', value: args.departmentName ?? 'Not selected' },
      { label: 'Site', value: args.siteName ?? 'No site selected' },
    ],
    preview: {
      icon: 'POS',
      title: args.title || 'Untitled Position',
      subtitle: args.positionKey ?? 'Position key not set',
      badges: [
        { label: args.isSafetyCritical ? 'Safety Critical' : 'Standard Position', tone: args.isSafetyCritical ? 'danger' : 'info' },
      ],
      meta: [
        { label: 'Reports To', value: args.reportsToTitle ?? 'No reporting line selected' },
        { label: 'Default Supervisor', value: args.defaultSupervisorName ?? 'Not assigned' },
      ],
    },
    metrics: [
      { label: 'Filled', value: filled, tone: filled > 0 ? 'info' : 'muted' },
      { label: 'Budget', value: budget ?? '—', tone: 'default' },
      {
        label: 'Vacancy',
        value: vacancy ?? '—',
        tone: vacancy === null ? 'muted' : vacancy < 0 ? 'danger' : vacancy === 0 ? 'success' : 'warning',
      },
    ],
    validation: [
      ...(args.duplicateKey ? [{ message: 'This position key is already in use.', tone: 'danger' as const }] : []),
      ...(args.isSafetyCritical ? [{ message: 'Safety-critical vacancies will appear as critical organization health issues.', tone: 'warning' as const }] : []),
    ],
    impact: {
      title: 'Headcount Impact',
      fields: [
        { label: 'Current Filled', value: filled },
        { label: 'Budgeted Headcount', value: budget ?? 'Not set' },
        {
          label: 'Vacancy Result',
          value: vacancy ?? 'Cannot calculate',
          tone: vacancy === null ? 'muted' : vacancy < 0 ? 'danger' : vacancy === 0 ? 'success' : 'warning',
        },
      ],
    },
    whatNext: [
      { label: 'Position register updates', description: 'This position becomes available for employee assignment.' },
      { label: 'Org health recalculates', description: 'Headcount, vacancy, and safety-critical checks update after save.' },
      { label: 'Audit and event are written', description: 'The position action is recorded in the organization timeline.' },
    ],
  };
}

// ── Organization ▸ Cost Centre ───────────────────────────────────────────────────
export function orgCostCenterContext(args: {
  name: string;
  code?: string;
  owningUnitName?: string;
  ownerName?: string;
  assignedUnitCount?: number;
  positionCount?: number;
  duplicateCode?: boolean;
}): DialogContextPanelConfig {
  return {
    eyebrow: 'HR Organization',
    title: 'Cost Centre Context',
    description: 'Cost centres are shared reference data used by HR, Finance, and reporting.',
    breadcrumb: [{ label: 'Owning Unit', value: args.owningUnitName ?? 'Not assigned' }],
    preview: {
      icon: 'CC',
      title: args.name || 'Untitled Cost Centre',
      subtitle: args.code ?? 'Code not set',
      badges: [{ label: 'Shared Finance Reference', tone: 'info' }],
      meta: [
        { label: 'Owner', value: args.ownerName ?? 'No owner selected' },
        { label: 'Code', value: args.code ?? 'Not set' },
      ],
    },
    metrics: [
      { label: 'Org Units', value: args.assignedUnitCount ?? 0, tone: args.assignedUnitCount ? 'info' : 'muted' },
      { label: 'Positions', value: args.positionCount ?? 0, tone: args.positionCount ? 'warning' : 'muted' },
    ],
    validation: [
      ...(args.duplicateCode ? [{ message: 'This cost centre code is already in use.', tone: 'danger' as const }] : []),
    ],
    impact: {
      title: 'Usage Impact',
      fields: [
        { label: 'Units Using This', value: args.assignedUnitCount ?? 0 },
        { label: 'Positions Affected', value: args.positionCount ?? 0 },
      ],
    },
    whatNext: [
      { label: 'Cost centre becomes selectable', description: 'Organization units can reference this cost centre.' },
      { label: 'Finance uses the same record', description: 'This must reuse finance_cost_centers. Do not create an HR-only duplicate.' },
      { label: 'Audit and event are written', description: 'Changes are recorded for enterprise traceability.' },
    ],
  };
}

// ── Organization ▸ Move Unit ─────────────────────────────────────────────────────
export function moveOrgUnitContext(args: {
  unitName: string;
  fromPath: string;
  toPath: string;
  childCount: number;
  employeeCount: number;
  positionCount: number;
  cycleWarning?: boolean;
  requiresApproval?: boolean;
}): DialogContextPanelConfig {
  const affectedRecords = args.childCount + args.employeeCount + args.positionCount;
  return {
    eyebrow: 'HR Organization',
    title: 'Move Impact',
    description: 'Preview the hierarchy change before moving this unit.',
    preview: {
      icon: 'ORG',
      title: args.unitName,
      subtitle: 'Organization unit move',
      badges: [{ label: args.requiresApproval ? 'Approval Route' : 'Direct Change', tone: args.requiresApproval ? 'warning' : 'success' }],
    },
    derived: {
      title: 'Before → After',
      fields: [
        { label: 'Current Placement', value: args.fromPath },
        { label: 'New Placement', value: args.toPath },
      ],
    },
    metrics: [
      { label: 'Child Units', value: args.childCount, tone: args.childCount ? 'warning' : 'success' },
      { label: 'Employees', value: args.employeeCount, tone: args.employeeCount ? 'warning' : 'success' },
      { label: 'Positions', value: args.positionCount, tone: args.positionCount ? 'warning' : 'success' },
    ],
    validation: [
      ...(args.cycleWarning ? [{ message: 'This unit cannot be moved under one of its own descendants.', tone: 'danger' as const }] : []),
    ],
    impact: {
      title: 'Records Moving With This Unit',
      fields: [
        { label: 'Affected Records', value: affectedRecords, tone: affectedRecords > 0 ? 'warning' : 'success' },
        { label: 'Subtree Units', value: args.childCount },
        { label: 'Assigned Employees', value: args.employeeCount },
        { label: 'Linked Positions', value: args.positionCount },
      ],
    },
    approval: {
      required: Boolean(args.requiresApproval),
      risk: args.requiresApproval ? 'high' : 'low',
      message: args.requiresApproval
        ? 'This move affects active records and routes through approval when Phase B enterprise controls are enabled.'
        : 'This move can be applied directly.',
    },
    whatNext: [
      { label: 'Hierarchy updates', description: 'The selected unit and its subtree move under the new parent.' },
      { label: 'Org health recalculates', description: 'Reporting lines, vacancies, and affected references may change.' },
      { label: 'Audit and event are written', description: 'The move appears in the organization timeline.' },
    ],
  };
}

// ── Documents ▸ Upload ───────────────────────────────────────────────────────────
export function uploadDocumentContext(args: {
  employeeName?: string;
  departmentName?: string;
  documentType?: string;
  documentTypeDescription?: string;
  fileName?: string;
  fileSize?: string;
  fileType?: string;
  expiryDate?: string;
  expiryPreview?: string;
  satisfiesRequirement?: string | null;
  replacesExisting?: boolean;
  fileWarning?: string | null;
}): DialogContextPanelConfig {
  return {
    eyebrow: 'HR Documents',
    title: 'Upload Context',
    description: 'Preview how this document will affect the employee file.',
    breadcrumb: [
      { label: 'Employee', value: args.employeeName ?? 'No employee selected' },
      { label: 'Department', value: args.departmentName ?? 'No department' },
    ],
    preview: {
      icon: 'DOC',
      title: args.documentType ?? 'Document Type Not Selected',
      subtitle: args.fileName ?? 'No file selected',
      badges: [{ label: args.satisfiesRequirement ? 'Satisfies Requirement' : 'General Document', tone: args.satisfiesRequirement ? 'success' : 'info' }],
      meta: [
        { label: 'File Size', value: args.fileSize ?? 'No file' },
        { label: 'File Type', value: args.fileType ?? 'Unknown' },
        { label: 'Expiry', value: args.expiryPreview ?? 'No expiry date set' },
      ],
    },
    derived: {
      title: 'Compliance Preview',
      fields: [
        { label: 'Document Description', value: args.documentTypeDescription ?? 'No description configured' },
        {
          label: 'Requirement Match',
          value: args.satisfiesRequirement ?? 'This document does not currently satisfy an open requirement.',
          tone: args.satisfiesRequirement ? 'success' : 'muted',
        },
        { label: 'Expiry Date', value: args.expiryDate ?? 'Not provided', tone: args.expiryDate ? 'info' : 'warning' },
      ],
    },
    validation: [
      ...(args.replacesExisting ? [{ message: 'An existing document of this type is already on file. This upload may supersede the existing record.', tone: 'warning' as const }] : []),
      ...(args.fileWarning ? [{ message: args.fileWarning, tone: 'danger' as const }] : []),
    ],
    whatNext: [
      { label: 'Private upload URL is generated', description: 'The file uploads to the private HR document bucket using the existing upload flow.' },
      { label: 'Document row is committed', description: 'The document appears in the employee file and cross-employee register.' },
      { label: 'Verification may be required', description: 'Uploaded documents usually remain pending until HR verifies them.' },
    ],
  };
}

// ── Documents ▸ Requirement ──────────────────────────────────────────────────────
export function documentRequirementContext(args: {
  documentType?: string;
  label?: string;
  scopeLabel?: string;
  affectedEmployees?: number;
  requiresExpiry?: boolean;
  exampleSatisfiedBy?: string;
  duplicateRequirement?: boolean;
}): DialogContextPanelConfig {
  return {
    eyebrow: 'HR Documents',
    title: 'Requirement Policy Context',
    description: 'Preview who will be evaluated by this requirement.',
    preview: {
      icon: 'REQ',
      title: args.label ?? args.documentType ?? 'Required Document',
      subtitle: args.scopeLabel ?? 'Applies to all employees',
      badges: [{ label: args.requiresExpiry ? 'Expiry Required' : 'No Expiry Required', tone: args.requiresExpiry ? 'warning' : 'info' }],
    },
    metrics: [
      { label: 'Employees Evaluated', value: args.affectedEmployees ?? '—', tone: args.affectedEmployees ? 'warning' : 'muted', helper: args.affectedEmployees === undefined ? 'Computed on save' : undefined },
    ],
    derived: {
      title: 'What Counts As Satisfied',
      fields: [
        { label: 'Document Type', value: args.documentType ?? 'Not selected' },
        { label: 'Satisfied By', value: args.exampleSatisfiedBy ?? 'A verified document with the matching document type.' },
        { label: 'Expiry Required', value: Boolean(args.requiresExpiry), tone: args.requiresExpiry ? 'warning' : 'info' },
      ],
    },
    validation: [
      ...(args.duplicateRequirement ? [{ message: 'A requirement already exists for this document type and scope.', tone: 'danger' as const }] : []),
    ],
    whatNext: [
      { label: 'Compliance recalculates', description: 'Employees in scope may appear as missing or expired until documents are uploaded and verified.' },
      { label: 'Requirement policy updates', description: 'The requirement becomes part of HR document compliance checks.' },
      { label: 'Audit and event are written', description: 'The policy change is recorded in HR audit and app events.' },
    ],
  };
}
