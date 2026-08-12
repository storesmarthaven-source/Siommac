/**
 * src/ui/registry/planned.ts — components the kit does NOT have yet.
 *
 * Registering what is missing is the point. Before this file, "what is still
 * missing from the design system?" was answered by a manual audit every few
 * weeks; now it is a number the coverage report prints and a set of cards the
 * Gallery shows greyed out with their planned API.
 *
 * ⭐ `category: 'patterns'` entries are NOT kit gaps. They are module-owned
 * compositions — `PayrollApprovalTable` is payroll, `DayOneGateCard` is
 * onboarding, `HseActionMenu` is HSE — built FROM canonical primitives by the
 * module that owns the domain. A design system that owns them is not a design
 * system; it is the application. `check-ui-kit-coverage.mjs` therefore excludes
 * them from catalogue completeness and reports them on their own line. No built
 * component has ever used this category, and none should.
 *
 * Counting them as gaps read as "45% complete" against a real primitive gap of
 * eight — a number that argued for building payroll features inside the kit.
 *
 * Rules for this file:
 *   • An entry moves OUT of here the moment the component is built — it is not a
 *     backlog that lives alongside the implementation, it is the absence of one.
 *   • `migration.replaces` still matters for a missing component: it is what
 *     tells the coverage report how much legacy the gap is currently costing.
 *   • `plannedApi` is a real proposal, not a placeholder. It is what the next
 *     person implements against, and reviewing it is cheaper than reviewing code.
 *
 * Derived from docs/UI_KIT_V2_AUDIT.md §3.6.
 */

import { type ComponentDef, type ComponentCategory } from './types';

interface Planned {
  id: string;
  name: string;
  category: ComponentCategory;
  description: string;
  plannedApi: string;
  replaces?: readonly string[];
  deprecatedImports?: readonly string[];
  rawPatterns?: readonly string[];
}

const PLANNED: Planned[] = [
  /* ── Forms ──────────────────────────────────────────────────────────────*/
  /* ── Selection ──────────────────────────────────────────────────────────*/
  /* ── People ─────────────────────────────────────────────────────────────*/
  { id: 'avatar-group', name: 'AvatarGroup', category: 'people',
    description: 'Overlapping avatars with a +N overflow.',
    plannedApi: `<AvatarGroup people={crew} max={4} />` },

  /* ── Overlays ───────────────────────────────────────────────────────────*/
  { id: 'drawer', name: 'Drawer', category: 'overlays',
    description: 'ONE side panel. Three overlapping exports exist today (Drawer / HseDrawer / DetailDrawer); they become one `side` + `size` API.',
    plannedApi: `<Drawer open={o} side="right" size="lg" onClose={close}>…</Drawer>`,
    deprecatedImports: ['HseDrawer', 'DetailDrawer'],
    replaces: ['.ui-rdrawer'] },
  { id: 'popover', name: 'Popover', category: 'overlays',
    description: 'Anchored, dismissible surface for rich content. AnchoredPopup exists as the primitive; the public component does not.',
    plannedApi: `<Popover anchor={el} open={o} onClose={close}>…</Popover>` },
  { id: 'tooltip', name: 'Tooltip', category: 'overlays',
    description: 'Hover/focus hint on any element. `InfoTip` covers only the info-icon case.',
    plannedApi: `<Tooltip content="Locked after approval"><IconButton … /></Tooltip>` },
  /* ── Data ───────────────────────────────────────────────────────────────*/
  /* ── Navigation ─────────────────────────────────────────────────────────*/
  { id: 'breadcrumbs', name: 'Breadcrumbs', category: 'navigation',
    description: 'Ancestor trail with overflow collapsing.',
    plannedApi: `<Breadcrumbs items={[{label:'HR', href:'/hr'}, {label:'Onboarding'}]} />` },
  /* PageActionBar moved OUT when it was built — see page-header.def.tsx. */
  /* ── Feedback ───────────────────────────────────────────────────────────*/
  { id: 'alert', name: 'Alert', category: 'feedback',
    description: 'ONE message component. Inline vs page-level banner is a `placement` prop, not a second component.',
    plannedApi: `<Alert tone="warning" placement="inline|page" title="Approval required" onDismiss={hide}>…</Alert>` },
  { id: 'progress', name: 'Progress', category: 'feedback',
    description: 'Determinate and indeterminate progress. Bar, ring and meter are a `shape` prop — the same value rendered three ways.',
    plannedApi: `<Progress value={0.4} shape="bar|ring|meter" label="Uploading evidence" />` },

  /* ── Containers ─────────────────────────────────────────────────────────*/
  /* Card moved OUT of this file when it was built — see containers.defs.tsx. */
  { id: 'accordion', name: 'Accordion', category: 'containers',
    description: 'Collapsible sections with single or multiple expansion.',
    plannedApi: `<Accordion items={SECTIONS} multiple />` },

  /* ── Status ─────────────────────────────────────────────────────────────*/
  /* ── Enterprise patterns ────────────────────────────────────────────────*/
  { id: 'employee-picker-dialog', name: 'EmployeePickerDialog', category: 'patterns',
    description: 'Full-dialog employee search with filters and multi-select — for bulk assignment.',
    plannedApi: `<EmployeePickerDialog open={o} multiple onConfirm={setIds} onClose={close} />` },
  { id: 'approval-dialog', name: 'ApprovalDialog', category: 'patterns',
    description: 'Approve/reject with a mandatory reason, routed through the workflow engine and enforcing creator ≠ approver.',
    plannedApi: `<ApprovalDialog binding={b} onDecision={decide} requireReason />` },
  { id: 'settings-form', name: 'SettingsForm', category: 'patterns',
    description: 'The standard settings surface — scope, inheritance, reset-to-inherited, audit link.',
    plannedApi: `<SettingsForm scope={scope} schema={SCHEMA} values={v} onSave={save} />` },
  { id: 'data-table-page', name: 'DataTablePage', category: 'patterns',
    description: 'Register page shell: header, KPI strip, toolbar, table, pagination, drawer.',
    plannedApi: `<DataTablePage header={…} kpis={…} table={…} drawer={…} />` },
  /* Wizard moved OUT of this file when it was built — see wizard.def.tsx. */
  { id: 'audit-timeline', name: 'AuditTimeline', category: 'patterns',
    description: 'app_events / audit_logs rendered as a timeline with actor, action and diff.',
    plannedApi: `<AuditTimeline entityType="hr_onboarding_case" entityId={id} />` },
  { id: 'comment-thread', name: 'CommentThread', category: 'patterns',
    description: 'Record-linked discussion, wired to the communications backbone.',
    plannedApi: `<CommentThread recordType="case" recordId={id} />` },
  { id: 'evidence-uploader', name: 'EvidenceUploader', category: 'patterns',
    description: 'Attach evidence to a requirement — upload, classify, verify.',
    plannedApi: `<EvidenceUploader requirementId={id} onUploaded={refetch} />` },
  { id: 'document-card', name: 'DocumentCard', category: 'patterns',
    description: 'A document with its type, expiry, verification state and actions.',
    plannedApi: `<DocumentCard doc={d} onVerify={verify} onReplace={replace} />` },
  { id: 'assignment-control', name: 'AssignmentControl', category: 'patterns',
    description: 'Assign a record to a person or team, emitting the handoff.',
    plannedApi: `<AssignmentControl recordId={id} assignee={a} onAssign={assign} />` },
  { id: 'permission-aware-action-menu', name: 'PermissionAwareActionMenu', category: 'patterns',
    description: 'A menu that hides — or disables with a reason — actions the user cannot perform.',
    plannedApi: `<PermissionAwareActionMenu actions={ACTIONS} />` },
  { id: 'status-transition-control', name: 'StatusTransitionControl', category: 'patterns',
    description: 'Renders only the transitions the state machine actually permits.',
    plannedApi: `<StatusTransitionControl machine="onboarding" state={s} onTransition={go} />` },
  { id: 'change-reason-prompt', name: 'ChangeReasonPrompt', category: 'patterns',
    description: 'The mandatory-reason prompt for governed changes, written to the audit trail.',
    plannedApi: `<ChangeReasonPrompt open={o} onConfirm={reason => save(reason)} />` },
  { id: 'governance-confirmation', name: 'GovernanceConfirmation', category: 'patterns',
    description: 'High-consequence confirmation: impact summary, typed acknowledgement, audit note.',
    plannedApi: `<GovernanceConfirmation impact={summary} requireTyped="DELETE" onConfirm={go} />` },
  { id: 'diff-viewer', name: 'DiffViewer', category: 'patterns',
    description: 'Field-level before/after for an audited change.',
    plannedApi: `<DiffViewer before={a} after={b} fields={FIELDS} />` },
  { id: 'requirement-review-dialog', name: 'RequirementReviewDialog', category: 'patterns',
    description: 'Review an onboarding requirement: evidence, decision, reason.',
    plannedApi: `<RequirementReviewDialog requirementId={id} onDecision={decide} />` },
  { id: 'day-one-gate-card', name: 'DayOneGateCard', category: 'patterns',
    description: 'The day-one readiness gate with its blocking reasons.',
    plannedApi: `<DayOneGateCard caseId={id} />` },
  { id: 'package-lifecycle-header', name: 'PackageLifecycleHeader', category: 'patterns',
    description: 'Package state, version and lifecycle actions as one header.',
    plannedApi: `<PackageLifecycleHeader package={p} onPublish={publish} />` },
  { id: 'case-action-toolbar', name: 'CaseActionToolbar', category: 'patterns',
    description: 'The case-level action row shared by onboarding and offboarding.',
    plannedApi: `<CaseActionToolbar caseId={id} state={s} />` },
  { id: 'payroll-approval-table', name: 'PayrollApprovalTable', category: 'patterns',
    description: 'Payroll approval with segregation of duties enforced in the UI as well as the API.',
    plannedApi: `<PayrollApprovalTable runId={id} />` },
  { id: 'hse-action-menu', name: 'HseActionMenu', category: 'patterns',
    description: 'The HSE record action menu — permits, incidents, JSA.',
    plannedApi: `<HseActionMenu record={r} />` },
];

export const PLANNED_DEFS: readonly ComponentDef[] = PLANNED.map(p => ({
  id: p.id,
  name: p.name,
  category: p.category,
  description: p.description,
  status: 'missing' as const,
  plannedApi: p.plannedApi,
  importFrom: '@ui',
  migration: {
    replaces: p.replaces,
    deprecatedImports: p.deprecatedImports,
    rawPatterns: p.rawPatterns,
  },
}));
