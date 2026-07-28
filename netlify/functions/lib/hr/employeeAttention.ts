/**
 * lib/hr/employeeAttention.ts — the canonical unresolved-work aggregation for an
 * employee.
 *
 * ONE source of truth: the Needs Attention panel and the tab indicators are both
 * derived from `buildAttentionItems`. Indicator counts are never maintained as
 * separate UI values (readiness collaboration note, "Employee Profile UI").
 *
 * `buildAttentionItems` is deliberately PURE — it takes already-read rows and
 * returns items — so the rules are unit-testable without a database. The reads
 * live in `loadAttentionInput`.
 */

import { sb } from '../db';
import type {
  EmployeeAttentionItem, ProfileTabIndicator, AttentionSeverity, AttentionDomain,
} from '../../../../types/hrEmployeeProfile';
import { ATTENTION_SEVERITY_RANK } from '../../../../types/hrEmployeeProfile';

/** A document is "expiring soon" inside this window. Matches the Documents tab. */
export const EXPIRY_SOON_DAYS = 30;

export interface AttentionEmployee {
  id: string;
  supervisor_id: string | null;
  department_id: string | null;
  site_id: string | null;
  employment_status: string | null;
  status: string;
}

export interface AttentionStatutory {
  payroll_ready_status: string | null;
  missing_blockers: string[] | null;
}

export interface AttentionDocument {
  id: string;
  document_type: string;
  title: string;
  status: string;
  expiry_date: string | null;
}

export interface AttentionRequirement {
  document_type: string;
  label: string;
  requires_expiry: boolean;
}

export interface AttentionCertificate {
  id: string;
  course_name: string | null;
  status: string;
  expires_at: string | null;
}

export interface AttentionChangeRequest {
  id: string;
  change_no: string | null;
  change_type: string;
  status: string;
}

export interface AttentionCase {
  id: string;
  case_no: string | null;
  status: string;
  dueAt: string | null;
}

export interface AttentionInput {
  employee: AttentionEmployee;
  statutory: AttentionStatutory | null;
  documents: AttentionDocument[];
  requirements: AttentionRequirement[];
  certificates: AttentionCertificate[];
  changeRequests: AttentionChangeRequest[];
  onboarding: AttentionCase | null;
  offboarding: AttentionCase | null;
  /** ISO date (YYYY-MM-DD). Injected so the rules are deterministic under test. */
  today: string;
}

/** Capability a VIEWER needs before an item of this domain may be returned. */
const DOMAIN_CAPABILITY: Record<AttentionDomain, string | null> = {
  employment:  null,
  statutory:   'hr.employees.payroll_readiness.view',
  payroll:     'hr.employees.payroll_readiness.view',
  documents:   'hr.employee_documents.view',
  training:    null,
  access:      null,
  onboarding:  'hr.onboarding.view',
  offboarding: 'hr.offboarding.view',
};

/** Canonical destination for each domain — never inferred from display text. */
const DOMAIN_TARGET: Record<AttentionDomain, EmployeeAttentionItem['actionTarget']> = {
  employment:  'employment',
  statutory:   'readiness',
  payroll:     'readiness',
  documents:   'documents',
  training:    'readiness',
  access:      'access',
  onboarding:  'overview',
  offboarding: 'offboarding',
};

const DAY_MS = 86_400_000;

function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(`${fromISO.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${toISO.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return Math.round((b - a) / DAY_MS);
}

function humanize(value: string): string {
  return value.replace(/[_.]/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
}

/**
 * Build the unresolved-work list for one employee.
 *
 * Ordering is severity-first then due-date, so the drawer's two visible rows are
 * always the most urgent ones and paging through reveals the rest in priority order.
 */
export function buildAttentionItems(input: AttentionInput): EmployeeAttentionItem[] {
  const items: EmployeeAttentionItem[] = [];
  const { today } = input;

  const push = (
    item: Omit<EmployeeAttentionItem, 'requiredCapability' | 'actionTarget'>
      & Partial<Pick<EmployeeAttentionItem, 'actionTarget'>>,
  ): void => {
    items.push({
      ...item,
      actionTarget: item.actionTarget ?? DOMAIN_TARGET[item.domain],
      requiredCapability: DOMAIN_CAPABILITY[item.domain],
    });
  };

  // ── Employment / assignment ────────────────────────────────────────────────
  // A record cannot be payroll- or reporting-complete without these three.
  const missingAssignment: [string, string][] = [];
  if (!input.employee.supervisor_id) missingAssignment.push(['supervisor', 'Supervisor']);
  if (!input.employee.department_id) missingAssignment.push(['department', 'Department']);
  if (!input.employee.site_id)       missingAssignment.push(['site', 'Work Location']);
  for (const [key, label] of missingAssignment) {
    push({
      id: `employment.missing:${key}`,
      domain: 'employment',
      title: `${label} Not Assigned`,
      detail: `The employment record has no ${label.toLowerCase()} on file.`,
      severity: 'warning',
      dueState: 'none',
      dueDate: null,
      owner: 'HR Operations',
      responsibleParty: 'HR Operations',
      actionLabel: 'Open Employment',
    });
  }

  // ── Statutory / payroll readiness ──────────────────────────────────────────
  // One item per real blocker recorded by the statutory profile — not a synthesised
  // "payroll is blocked" summary row.
  const payrollStatus = input.statutory?.payroll_ready_status ?? null;
  const blockers = input.statutory?.missing_blockers ?? [];
  if (payrollStatus === 'blocked' || blockers.length) {
    for (const blocker of blockers) {
      push({
        id: `payroll.blocker:${blocker}`,
        domain: 'payroll',
        title: `${humanize(blocker)} Required`,
        detail: 'Payroll cannot process this employee until the statutory record is complete.',
        severity: 'critical',
        dueState: 'none',
        dueDate: null,
        owner: 'Payroll Team',
        responsibleParty: 'Payroll Team',
        actionLabel: 'Open Readiness',
      });
    }
    if (!blockers.length) {
      push({
        id: 'payroll.blocker:unspecified',
        domain: 'payroll',
        title: 'Payroll Readiness Blocked',
        detail: 'The statutory record is marked blocked without a recorded reason.',
        severity: 'critical',
        dueState: 'none',
        dueDate: null,
        owner: 'Payroll Team',
        responsibleParty: 'Payroll Team',
        actionLabel: 'Open Readiness',
      });
    }
  }

  // ── Documents: expired, expiring, and missing against active requirements ──
  const liveDocs = input.documents.filter(d => d.status !== 'archived' && d.status !== 'rejected');
  for (const doc of liveDocs) {
    if (!doc.expiry_date) continue;
    const days = daysBetween(today, doc.expiry_date);
    if (Number.isNaN(days)) continue;
    if (days < 0) {
      push({
        id: `documents.expired:${doc.id}`,
        domain: 'documents',
        title: `${doc.title} Expired`,
        detail: `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago.`,
        severity: 'critical',
        dueState: 'overdue',
        dueDate: doc.expiry_date,
        owner: 'HR Operations',
        responsibleParty: 'HR Operations',
        actionLabel: 'Open Documents',
      });
    } else if (days <= EXPIRY_SOON_DAYS) {
      push({
        id: `documents.expiring:${doc.id}`,
        domain: 'documents',
        title: `${doc.title} Expiring`,
        detail: `Expires in ${days} day${days === 1 ? '' : 's'}.`,
        severity: 'warning',
        dueState: 'due_soon',
        dueDate: doc.expiry_date,
        owner: 'HR Operations',
        responsibleParty: 'HR Operations',
        actionLabel: 'Open Documents',
      });
    }
  }

  // A requirement is satisfied by a live, non-rejected document of that type.
  const presentTypes = new Set(liveDocs.map(d => d.document_type));
  for (const req of input.requirements) {
    if (presentTypes.has(req.document_type)) continue;
    push({
      id: `documents.missing:${req.document_type}`,
      domain: 'documents',
      title: `${req.label} Missing`,
      detail: 'A required employee document has not been provided.',
      severity: 'critical',
      dueState: 'none',
      dueDate: null,
      owner: 'HR Operations',
      responsibleParty: 'Employee',
      actionLabel: 'Add Document',
    });
  }

  // Uploaded-but-unverified documents are review work, not a compliance failure.
  for (const doc of liveDocs.filter(d => d.status === 'uploaded')) {
    push({
      id: `documents.unverified:${doc.id}`,
      domain: 'documents',
      title: `${doc.title} Awaiting Verification`,
      detail: 'The document has been provided but not yet verified.',
      severity: 'warning',
      dueState: 'none',
      dueDate: null,
      owner: 'HR Operations',
      responsibleParty: 'HR Operations',
      actionLabel: 'Open Documents',
    });
  }

  // ── Training evidence ──────────────────────────────────────────────────────
  const TERMINAL_CERT = new Set(['revoked', 'archived', 'rejected']);
  for (const cert of input.certificates) {
    if (TERMINAL_CERT.has(cert.status)) continue;
    const name = cert.course_name ?? 'Training Certificate';
    const days = cert.expires_at ? daysBetween(today, cert.expires_at) : Number.NaN;
    const expired = cert.status === 'expired' || (!Number.isNaN(days) && days < 0);
    if (expired) {
      push({
        id: `training.expired:${cert.id}`,
        domain: 'training',
        title: `${name} Expired`,
        detail: 'Training evidence is no longer valid.',
        severity: 'critical',
        dueState: 'overdue',
        dueDate: cert.expires_at,
        owner: 'Learning Team',
        responsibleParty: 'Learning Team',
        actionLabel: 'Open Readiness',
      });
    } else if (!Number.isNaN(days) && days <= EXPIRY_SOON_DAYS) {
      push({
        id: `training.expiring:${cert.id}`,
        domain: 'training',
        title: `${name} Due`,
        detail: `Expires in ${days} day${days === 1 ? '' : 's'}.`,
        severity: 'warning',
        dueState: 'due_soon',
        dueDate: cert.expires_at,
        owner: 'Learning Team',
        responsibleParty: 'Learning Team',
        actionLabel: 'Open Readiness',
      });
    }
  }

  // ── Access: change requests awaiting a decision ────────────────────────────
  for (const cr of input.changeRequests.filter(r => r.status === 'pending')) {
    push({
      id: `access.change_request:${cr.id}`,
      domain: 'access',
      title: `${humanize(cr.change_type)} In Review`,
      detail: `Request ${cr.change_no ?? cr.id} is awaiting a decision.`,
      severity: 'warning',
      dueState: 'none',
      dueDate: null,
      owner: 'HR Operations',
      responsibleParty: 'Authorised Reviewer',
      actionLabel: 'Open Access',
    });
  }

  // ── Onboarding / offboarding ───────────────────────────────────────────────
  const ONBOARDING_OPEN = new Set(['open', 'in_progress', 'draft', 'paused']);
  if (input.onboarding && ONBOARDING_OPEN.has(input.onboarding.status)) {
    const days = input.onboarding.dueAt ? daysBetween(today, input.onboarding.dueAt) : Number.NaN;
    const overdue = !Number.isNaN(days) && days < 0;
    push({
      id: `onboarding.case:${input.onboarding.id}`,
      domain: 'onboarding',
      title: overdue ? 'Onboarding Overdue' : 'Onboarding In Progress',
      detail: `Case ${input.onboarding.case_no ?? input.onboarding.id} is ${humanize(input.onboarding.status).toLowerCase()}.`,
      severity: overdue ? 'critical' : 'info',
      dueState: overdue ? 'overdue' : input.onboarding.dueAt ? 'scheduled' : 'none',
      dueDate: input.onboarding.dueAt,
      owner: 'HR Operations',
      responsibleParty: 'HR Operations',
      actionLabel: 'Open Onboarding',
    });
  }

  const OFFBOARDING_OPEN = new Set(['open', 'in_progress', 'ready_for_exit', 'blocked', 'paused', 'draft']);
  if (input.offboarding && OFFBOARDING_OPEN.has(input.offboarding.status)) {
    push({
      id: `offboarding.case:${input.offboarding.id}`,
      domain: 'offboarding',
      title: 'Offboarding In Progress',
      detail: `Case ${input.offboarding.case_no ?? input.offboarding.id} is ${humanize(input.offboarding.status).toLowerCase()}.`,
      severity: input.offboarding.status === 'blocked' ? 'critical' : 'info',
      dueState: input.offboarding.dueAt ? 'scheduled' : 'none',
      dueDate: input.offboarding.dueAt,
      owner: 'HR Operations',
      responsibleParty: 'HR Operations',
      actionLabel: 'Open Offboarding',
    });
  }

  return sortAttention(items);
}

/** Severity first, then the nearest due date, then a stable id tiebreak. */
export function sortAttention(items: EmployeeAttentionItem[]): EmployeeAttentionItem[] {
  return [...items].sort((a, b) => {
    const sev = ATTENTION_SEVERITY_RANK[b.severity] - ATTENTION_SEVERITY_RANK[a.severity];
    if (sev !== 0) return sev;
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Drop items the viewer is not cleared to see. Applied BEFORE the response leaves. */
export function filterAttentionByCapability(
  items: EmployeeAttentionItem[],
  granted: ReadonlySet<string>,
): EmployeeAttentionItem[] {
  return items.filter(item => !item.requiredCapability || granted.has(item.requiredCapability));
}

/**
 * Roll the (already capability-filtered) items into per-tab indicators.
 *
 * Only tabs with unresolved work appear, so the UI shows no indicator for a clean
 * tab rather than a zero badge.
 */
export function buildTabIndicators(items: EmployeeAttentionItem[]): ProfileTabIndicator[] {
  const byTab = new Map<string, { count: number; severity: AttentionSeverity }>();
  for (const item of items) {
    const current = byTab.get(item.actionTarget);
    if (!current) { byTab.set(item.actionTarget, { count: 1, severity: item.severity }); continue; }
    current.count += 1;
    if (ATTENTION_SEVERITY_RANK[item.severity] > ATTENTION_SEVERITY_RANK[current.severity]) {
      current.severity = item.severity;
    }
  }
  return [...byTab.entries()]
    .map(([tab, v]) => ({
      tab: tab as ProfileTabIndicator['tab'],
      unresolvedCount: v.count,
      highestSeverity: v.severity,
    }))
    .sort((a, b) => (a.tab < b.tab ? -1 : a.tab > b.tab ? 1 : 0));
}

/**
 * Read every source the aggregation needs.
 *
 * Each read is error-checked; a failed read throws rather than silently degrading
 * the attention list to "nothing needs attention", which would be a dangerous lie.
 */
export async function loadAttentionInput(
  employee: AttentionEmployee,
  today: string,
): Promise<AttentionInput> {
  const [docsRes, reqRes, certsRes, crRes, onbRes, offRes, statRes] = await Promise.all([
    sb.from('hr_employee_documents')
      .select('id, document_type, title, status, expiry_date')
      .eq('employee_id', employee.id).neq('status', 'archived'),
    sb.from('hr_document_requirements')
      .select('document_type, label, requires_expiry, applies_to_scope, applies_to_value')
      .eq('is_active', true),
    sb.from('hse_worker_certificates')
      .select('id, course_name, status, expires_at').eq('worker_id', employee.id),
    sb.from('hr_employee_change_requests')
      .select('id, change_no, change_type, status').eq('employee_id', employee.id).eq('status', 'pending'),
    sb.from('hr_onboarding_cases')
      .select('id, case_no, status, due_at').eq('employee_id', employee.id)
      .order('started_at', { ascending: false }).limit(1).maybeSingle<{ id: string; case_no: string | null; status: string; due_at: string | null }>(),
    sb.from('hr_offboarding_cases')
      .select('id, case_no, status, last_working_day').eq('employee_id', employee.id)
      .order('started_at', { ascending: false }).limit(1).maybeSingle<{ id: string; case_no: string | null; status: string; last_working_day: string | null }>(),
    sb.from('hr_employee_statutory_profiles')
      .select('payroll_ready_status, missing_blockers')
      .eq('employee_id', employee.id).eq('jurisdiction', 'TT').maybeSingle<AttentionStatutory>(),
  ]);

  const errors = [docsRes.error, reqRes.error, certsRes.error, crRes.error, onbRes.error, offRes.error, statRes.error]
    .filter((e): e is NonNullable<typeof e> => !!e);
  if (errors.length) throw new Error(`Employee attention read failed: ${errors[0].message}`);

  // Only requirements that actually apply to this employee become "missing" items.
  const requirements = (reqRes.data as {
    document_type: string; label: string; requires_expiry: boolean;
    applies_to_scope: string; applies_to_value: string | null;
  }[]).filter(r => {
    if (r.applies_to_scope === 'all') return true;
    if (r.applies_to_scope === 'department') return r.applies_to_value === employee.department_id;
    // role / employment_type scopes are resolved by the caller's employee row; an
    // unmatched scope must NOT silently become a missing-document blocker.
    return false;
  }).map(r => ({ document_type: r.document_type, label: r.label, requires_expiry: r.requires_expiry }));

  return {
    employee,
    statutory: statRes.data,
    documents: docsRes.data as AttentionDocument[],
    requirements,
    certificates: certsRes.data as AttentionCertificate[],
    changeRequests: crRes.data as AttentionChangeRequest[],
    onboarding: onbRes.data ? { id: onbRes.data.id, case_no: onbRes.data.case_no, status: onbRes.data.status, dueAt: onbRes.data.due_at } : null,
    offboarding: offRes.data ? { id: offRes.data.id, case_no: offRes.data.case_no, status: offRes.data.status, dueAt: offRes.data.last_working_day } : null,
    today,
  };
}
