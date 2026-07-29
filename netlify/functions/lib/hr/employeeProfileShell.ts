/**
 * lib/hr/employeeProfileShell.ts — the ONE profile-shell read contract shared by
 * the Employee Profile drawer and the full employee page.
 *
 * Optimised for immediate open and fast employee switching: it returns identity,
 * employment facts, the readiness summary, an attention preview, tab indicators,
 * contact and account-health summaries and a short activity preview — and NOT the
 * large per-tab datasets (full document list, audit history, access events,
 * offboarding records), which load when their tab opens.
 *
 * Every sensitive block is permission-filtered here, server-side. The frontend
 * capability map is presentation only.
 */

import { sb } from '../db';
import { resolveProfileImageUrl } from '../photos';
import { todayISO, firstNonBlank } from './employeeCore';
import {
  buildAttentionItems, buildTabIndicators, filterAttentionByCapability, loadAttentionInput,
  type AttentionEmployee,
} from './employeeAttention';
import { getReadinessSummary } from './readinessService';
import type {
  EmployeeProfileShell, ProfileAccountHealth, ProfileActivityEntry, ProfileCapabilities,
  ProfileContactSummary, ProfileEmploymentFacts, ProfileIdentity, ProfileReadinessSummary,
  EmployeeAttentionItem, ProfileTabIndicator,
} from '../../../../types/hrEmployeeProfile';

/** Rows the locked drawer shows before paging through the remaining work. */
export const ATTENTION_PREVIEW_SIZE = 2;
/** Entries in the shell's activity preview. The Activity tab reads the full list. */
export const ACTIVITY_PREVIEW_SIZE = 5;

export interface ShellEmployeeRow extends AttentionEmployee {
  full_name: string | null;
  display_name?: string | null;
  username?: string | null;
  employee_number?: string | null;
  position?: string | null;
  // employment_type is inherited from AttentionEmployee as `string | null`;
  // re-declaring it optional here would weaken the canonical resolver's input.
  work_schedule?: string | null;
  start_date?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile_phone?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  emergency_contact_relationship?: string | null;
  cost_center?: string | null;
  employee_grade?: string | null;
  probation_end_date?: string | null;
  contractor_flag?: boolean | null;
  [k: string]: unknown;
}

export interface ShellContext {
  departmentName: string | null;
  siteName: string | null;
  supervisorName: string | null;
  payGroupName: string | null;
  accessProfileLabel: string | null;
  payrollStatus: ProfileReadinessSummary['payrollStatus'];
  trainingStatus: ProfileReadinessSummary['trainingStatus'];
  /** From the canonical single-tenant employer profile, not a profile-local copy. */
  legalEmployer: string | null;
  /** From the CURRENT effective-dated assignment row. */
  weeklyHours: number | null;
  fte: number | null;
  /** Contractual notice in days, also from the current assignment period. */
  noticePeriodDays: number | null;
  /** Start of the current assignment period. */
  assignmentEffectiveFrom: string | null;
  /** Cycle of the assigned pay group, e.g. monthly. */
  payFrequency: string | null;
}

/**
 * Whole months of continuous service.
 *
 * Counts completed months only — a start date 29 days ago is 0 months, not "1
 * month" — so tenure never overstates service on a payroll-adjacent surface.
 */
export function tenureMonths(startDate: string | null, today: string): number | null {
  if (!startDate) return null;
  const start = new Date(`${startDate.slice(0, 10)}T00:00:00Z`);
  const now = new Date(`${today.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(now.getTime())) return null;
  if (start > now) return 0;
  let months = (now.getUTCFullYear() - start.getUTCFullYear()) * 12
    + (now.getUTCMonth() - start.getUTCMonth());
  if (now.getUTCDate() < start.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

// The former `readinessSummary()` lived here and scored readiness from three
// hard-coded booleans (assignment / payroll / training). It has been DELETED,
// not wrapped: readiness is now the typed control model in
// `lib/hr/readinessService.ts`, and keeping a second calculation alive would
// have let the drawer gauge and the Readiness tab disagree about the same
// employee. Callers use `getReadinessSummary()`.

function identityOf(employee: ShellEmployeeRow, ctx: ShellContext): ProfileIdentity {
  return {
    employeeId: employee.id,
    employeeNo: employee.employee_number ?? null,
    displayName: firstNonBlank(employee.display_name, employee.full_name, employee.username) ?? employee.id,
    profileImageUrl: resolveProfileImageUrl(employee as Parameters<typeof resolveProfileImageUrl>[0]),
    employmentStatus: employee.employment_status ?? 'active',
    accountStatus: employee.status,
    position: employee.position ?? null,
    departmentName: ctx.departmentName,
    siteName: ctx.siteName,
  };
}

/**
 * Full-Time / Part-Time in words, from FTE.
 *
 * The locked mockup renders the pair as "Full-Time · 1.0 FTE", so the
 * arrangement IS the FTE — not a separate stored field. Returns null when FTE is
 * unknown rather than defaulting to Full-Time: assuming a full-time arrangement
 * for someone with no recorded FTE would misstate an employment term.
 */
export function workArrangementFromFte(fte: number | null): string | null {
  if (fte === null || !Number.isFinite(fte) || fte <= 0) return null;
  return fte >= 1 ? 'Full-Time' : 'Part-Time';
}

function employmentOf(employee: ShellEmployeeRow, ctx: ShellContext, today: string): ProfileEmploymentFacts {
  return {
    employmentBasis: employee.employment_type ?? null,
    workArrangement: workArrangementFromFte(ctx.fte),
    workSchedule: employee.work_schedule ?? null,
    startDate: employee.start_date ?? null,
    tenureMonths: tenureMonths(employee.start_date ?? null, today),
    supervisorName: ctx.supervisorName,
    payGroupName: ctx.payGroupName,
    legalEmployer: ctx.legalEmployer,
    weeklyHours: ctx.weeklyHours,
    fte: ctx.fte,
    costCentre: employee.cost_center ?? null,
    employeeGrade: employee.employee_grade ?? null,
    probationEndDate: employee.probation_end_date ?? null,
    noticePeriodDays: ctx.noticePeriodDays,
    payFrequency: ctx.payFrequency,
    // contractor_flag is the only worker-category source; a null flag is an
    // employee, which is the column's own default.
    workerCategory: employee.contractor_flag ? 'Contractor' : 'Employee',
    assignmentEffectiveFrom: ctx.assignmentEffectiveFrom,
  };
}

function contactOf(employee: ShellEmployeeRow): ProfileContactSummary {
  return {
    workEmail: employee.email ?? null,
    workPhone: employee.phone ?? null,
    mobilePhone: employee.mobile_phone ?? null,
    emergencyContactName: employee.emergency_contact_name ?? null,
    emergencyContactPhone: employee.emergency_contact_phone ?? null,
    emergencyContactRelationship: employee.emergency_contact_relationship ?? null,
  };
}

/**
 * Read the short activity preview from the canonical HR audit log, resolving actor
 * names server-side so no raw id reaches the UI.
 */
async function activityPreview(employeeId: string): Promise<ProfileActivityEntry[]> {
  const { data, error } = await sb.from('hr_audit_log')
    .select('id, action, submodule_key, actor_id, created_at')
    .eq('employee_id', employeeId)
    .order('created_at', { ascending: false })
    .limit(ACTIVITY_PREVIEW_SIZE);
  if (error) throw new Error(`Employee activity preview failed: ${error.message}`);

  const rows = data as { id: string; action: string; submodule_key: string | null; actor_id: string | null; created_at: string }[];
  const actorIds = Array.from(new Set(rows.map(r => r.actor_id).filter((x): x is string => !!x)));
  const actorMap = new Map<string, string | null>();
  if (actorIds.length) {
    const { data: actors, error: actorsError } = await sb.from('app_users')
      .select('id, full_name').in('id', actorIds);
    if (actorsError) throw new Error(`Employee activity actor resolution failed: ${actorsError.message}`);
    for (const a of actors as { id: string; full_name: string | null }[]) actorMap.set(a.id, a.full_name);
  }
  return rows.map(r => ({
    id: r.id,
    action: r.action,
    area: r.submodule_key ?? 'employee',
    actorName: r.actor_id ? (actorMap.get(r.actor_id) ?? null) : null,
    occurredAt: r.created_at,
  }));
}

/** Statuses that mean an account-support request is still outstanding. */
const OPEN_SUPPORT_STATUSES = ['open', 'in_progress'];

/**
 * Count the employee's outstanding account-support requests, from the canonical
 * `support_tickets` store (the existing Ticket Center — never a second system).
 *
 * Matches on EITHER side of the link:
 *   from_user_id — the request the employee raised themselves (populated today);
 *   subject_id   — a request raised ON BEHALF of the employee.
 *
 * `subject_type`/`subject_id` exist on the table but are not yet written by any
 * code path, so today this resolves to self-raised requests only. The
 * on-behalf-of half starts counting as soon as the account-assistance slice
 * writes those columns — no contract change needed here.
 *
 * A read failure throws: reporting "0 open requests" because a query broke would
 * be a false clean bill of health on an account-health panel.
 */
async function openSupportRequestCount(employeeId: string): Promise<number> {
  const { count, error } = await sb.from('support_tickets')
    .select('id', { count: 'exact', head: true })
    .or(`from_user_id.eq.${employeeId},subject_id.eq.${employeeId}`)
    .in('status', OPEN_SUPPORT_STATUSES);
  if (error) throw new Error(`Account support request count failed: ${error.message}`);
  return count ?? 0;
}

/**
 * Assemble the permission-filtered shell.
 *
 * `granted` is the set of capabilities the ACTOR holds, resolved once by the route.
 */
export async function buildProfileShell(
  employee: ShellEmployeeRow,
  ctx: ShellContext,
  granted: ReadonlySet<string>,
): Promise<EmployeeProfileShell> {
  const today = todayISO();

  const capabilities: ProfileCapabilities = {
    viewStatutory:       granted.has('hr.employees.statutory.view'),
    viewReadiness:       granted.has('hr.employees.readiness.view')
                         || granted.has('hr.employees.payroll_readiness.view')
                         || granted.has('hr.employees.statutory.view'),
    viewDocuments:       granted.has('hr.employee_documents.view'),
    viewAudit:           granted.has('hr.audit.view'),
    viewOnboarding:      granted.has('hr.onboarding.view'),
    viewOffboarding:     granted.has('hr.offboarding.view'),
    viewAccountSecurity: granted.has('auth.security.view'),
  };

  const attentionInput = await loadAttentionInput(employee, today);
  const allItems = buildAttentionItems(attentionInput);
  const visibleItems = filterAttentionByCapability(allItems, granted);
  const tabIndicators = buildTabIndicators(visibleItems);

  // Readiness comes from the typed control instances, NOT from the attention
  // list: an attention item is anything needing action, while readiness counts
  // controls. Conflating them was what made the old gauge disagree with the tab.
  const readiness = capabilities.viewReadiness
    ? await getReadinessSummary(employee.id, ctx.payrollStatus, ctx.trainingStatus)
    : null;

  const recentActivity = capabilities.viewAudit ? await activityPreview(employee.id) : [];

  const accountHealth: ProfileAccountHealth = {
    accountStatus: employee.status,
    hasLoginIdentity: !!employee.username,
    accessProfileLabel: ctx.accessProfileLabel,
    openSupportRequests: await openSupportRequestCount(employee.id),
  };

  return {
    identity: identityOf(employee, ctx),
    employment: employmentOf(employee, ctx, today),
    readiness,
    attentionPreview: visibleItems.slice(0, ATTENTION_PREVIEW_SIZE),
    attentionTotal: visibleItems.length,
    tabIndicators,
    contact: contactOf(employee),
    accountHealth,
    recentActivity,
    capabilities,
  };
}

export type { EmployeeAttentionItem, ProfileTabIndicator };
