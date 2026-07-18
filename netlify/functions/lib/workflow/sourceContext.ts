// ============================================================================
// Canonical source context for public explicit workflow starts.
// ============================================================================
// Public routes never accept source snapshots or assignees from the caller. This
// registry loads the real source row, enforces the actor's data scope, and builds
// the context consumed by the template assignee resolver.

import { sb } from '../db';
import { assertInScope } from '../permissions';
import type { AppUser } from '../../../../types/db';
import type { ModuleWorkflowContext } from './definitionTypes';

interface SourceSpec {
  table: string;
  idKind?: 'text' | 'uuid';
  select?: string;
  refColumns: string[];
  ownerColumns: string[];
  subjectColumns: string[];
  supervisorColumns?: string[];
  areaOwnerColumns?: string[];
}

const SOURCE_SPECS: Partial<Record<string, SourceSpec>> = {
  hr_onboarding: {
    table: 'hr_onboarding_cases', refColumns: ['case_no'],
    ownerColumns: ['owner_id', 'case_owner_id', 'employee_id', 'created_by'],
    subjectColumns: ['employee_id'],
  },
  hr_employee_master: {
    table: 'app_users', idKind: 'text',
    select: 'id, employee_number, department_id, supervisor_id, site_id, role, status, position, employment_type',
    refColumns: ['employee_number', 'id'], ownerColumns: ['id'], subjectColumns: ['id'],
    supervisorColumns: ['supervisor_id'],
  },
  hr_requests: {
    table: 'hr_requests', refColumns: ['request_no'],
    ownerColumns: ['employee_id', 'requested_by'], subjectColumns: ['employee_id', 'requested_by'],
  },
  hr_attendance: {
    table: 'hr_timesheets', refColumns: ['timesheet_no', 'id'],
    ownerColumns: ['employee_id', 'created_by'], subjectColumns: ['employee_id'],
  },
  hr_leave: {
    table: 'hr_leave_requests', refColumns: ['case_no', 'id'],
    ownerColumns: ['employee_id'], subjectColumns: ['employee_id'],
  },
  hse_incidents: {
    table: 'hse_incidents', refColumns: ['ref'],
    ownerColumns: ['reported_by', 'created_by'], subjectColumns: ['reported_by'],
  },
  hse_risk_assessments: {
    table: 'hse_risk_assessments', refColumns: ['ref'],
    ownerColumns: ['owner_user_id', 'created_by'], subjectColumns: ['owner_user_id', 'created_by'],
  },
  hse_jsa: {
    table: 'hse_jsa', refColumns: ['ref'],
    ownerColumns: ['owner_user_id', 'created_by'], subjectColumns: ['owner_user_id', 'created_by'],
  },
  hse_hazards: {
    table: 'hse_hazards', refColumns: ['ref'],
    ownerColumns: ['owner_user_id', 'created_by'], subjectColumns: ['owner_user_id', 'created_by'],
  },
  hse_capa: {
    table: 'hse_capa_actions', refColumns: ['ref'],
    ownerColumns: ['owner_user_id', 'created_by'], subjectColumns: ['owner_user_id', 'created_by'],
  },
  ptw: {
    table: 'hse_permits', refColumns: ['permit_number', 'ref'],
    ownerColumns: ['requester_id', 'requestor_id', 'created_by'],
    subjectColumns: ['requester_id', 'requestor_id', 'created_by'],
    supervisorColumns: ['work_supervisor_id'], areaOwnerColumns: ['area_authority_id'],
  },
  finance_payroll: {
    table: 'finance_payroll_runs', refColumns: ['run_no'],
    ownerColumns: ['created_by'], subjectColumns: ['created_by'],
  },
  finance_statutory: {
    table: 'finance_statutory_versions', refColumns: ['label'],
    ownerColumns: ['created_by'], subjectColumns: ['created_by'],
  },
  finance_ap: {
    table: 'finance_ap_bills', refColumns: ['bill_no'],
    ownerColumns: ['created_by'], subjectColumns: ['created_by'],
  },
  finance_expenses: {
    table: 'finance_expense_claims', refColumns: ['claim_no'],
    ownerColumns: ['claimant_id', 'created_by'], subjectColumns: ['claimant_id', 'created_by'],
  },
  finance_remittances: {
    table: 'finance_remittances', refColumns: ['remittance_no'],
    ownerColumns: ['created_by'], subjectColumns: ['created_by'],
  },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SENSITIVE_KEYS = new Set([
  'password_hash', 'totp_secret', 'backup_codes', 'account_number',
  'routing_code', 'iban', 'swift', 'token_hash',
]);

type SourceRow = Record<string, unknown>;

function workflowError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function asObject(value: unknown): SourceRow {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as SourceRow
    : {};
}

function firstText(row: SourceRow, columns: string[]): string | null {
  for (const column of columns) {
    const value = row[column];
    if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) {
      return String(value);
    }
  }
  return null;
}

function camelCase(key: string): string {
  return key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function sourceSnapshot(row: SourceRow): SourceRow {
  const snapshot: SourceRow = {
    ...asObject(row.metadata),
    ...asObject(row.details),
  };
  for (const [key, value] of Object.entries(row)) {
    if (SENSITIVE_KEYS.has(key) || key === 'metadata' || key === 'details') continue;
    snapshot[camelCase(key)] = value;
  }
  return snapshot;
}

async function loadUser(userId: string | null): Promise<Pick<AppUser, 'id' | 'department_id' | 'site_id' | 'supervisor_id'> | null> {
  if (!userId) return null;
  const { data, error } = await sb.from('app_users')
    .select('id, department_id, site_id, supervisor_id')
    .eq('id', userId)
    .maybeSingle<Pick<AppUser, 'id' | 'department_id' | 'site_id' | 'supervisor_id'>>();
  if (error) throw workflowError(500, `Unable to resolve workflow subject: ${error.message}`);
  return data ?? null;
}

async function departmentManager(departmentId: string | null): Promise<string | null> {
  if (!departmentId) return null;
  const { data, error } = await sb.from('departments')
    .select('manager_id').eq('id', departmentId)
    .maybeSingle<{ manager_id: string | null }>();
  if (error) throw workflowError(500, `Unable to resolve department manager: ${error.message}`);
  return data?.manager_id ?? null;
}

async function siteManager(siteId: string | null): Promise<string | null> {
  if (!siteId) return null;
  const { data, error } = await sb.from('app_users')
    .select('id').eq('site_id', siteId).eq('role', 'manager').eq('status', 'active')
    .order('id').limit(1).maybeSingle<{ id: string }>();
  if (error) throw workflowError(500, `Unable to resolve site manager: ${error.message}`);
  return data?.id ?? null;
}

async function hseManager(siteId: string | null, departmentId: string | null): Promise<string | null> {
  let query = sb.from('app_users').select('id').eq('role', 'hse_staff').eq('status', 'active');
  if (siteId) query = query.eq('site_id', siteId);
  else if (departmentId) query = query.eq('department_id', departmentId);
  const { data, error } = await query.order('id').limit(1).maybeSingle<{ id: string }>();
  if (error) throw workflowError(500, `Unable to resolve HSE manager: ${error.message}`);
  return data?.id ?? null;
}

export interface CanonicalStartInput {
  moduleKey: string;
  workflowType: string;
  triggerEvent: string;
  sourceRecordId: string;
  requestedBy: string;
  actor: Pick<AppUser, 'id' | 'role' | 'department_id'>;
}

function sourcePriority(row: SourceRow): ModuleWorkflowContext['priority'] {
  switch (firstText(row, ['priority', 'severity'])?.toLowerCase()) {
    case 'critical': return 'critical';
    case 'high': return 'high';
    case 'low':
    case 'minor': return 'low';
    case 'normal': return 'normal';
    default: return 'medium';
  }
}

/** Load and authorize the source row, then derive every assignment input. */
export async function buildCanonicalStartContext(input: CanonicalStartInput): Promise<ModuleWorkflowContext> {
  const spec = SOURCE_SPECS[input.moduleKey];
  if (!spec) throw workflowError(422, `Explicit workflow start is not configured for module ${input.moduleKey}.`);
  if ((spec.idKind ?? 'uuid') === 'uuid' && !UUID_RE.test(input.sourceRecordId)) {
    throw workflowError(400, 'sourceRecordId must be the canonical UUID for this module.');
  }

  const { data, error } = await sb.from(spec.table)
    .select(spec.select ?? '*')
    .eq('id', input.sourceRecordId)
    .maybeSingle<SourceRow>();
  if (error) throw workflowError(500, `Unable to load workflow source: ${error.message}`);
  if (!data) throw workflowError(404, 'Source record not found.');

  const ownerId = firstText(data, spec.ownerColumns);
  const subject = await loadUser(firstText(data, spec.subjectColumns));
  const siteId = firstText(data, ['site_id']) ?? subject?.site_id ?? null;
  const departmentId = firstText(data, ['department_id']) ?? subject?.department_id ?? null;
  await assertInScope(input.actor, departmentId);

  const requester = await loadUser(input.requestedBy);
  const snapshot = sourceSnapshot(data);
  snapshot.supervisorId = firstText(data, spec.supervisorColumns ?? ['supervisor_id']) ?? subject?.supervisor_id ?? null;
  snapshot.departmentManagerId = await departmentManager(departmentId);
  snapshot.siteManagerId = await siteManager(siteId);
  snapshot.hseManagerId = firstText(data, ['safety_officer_id']) ?? await hseManager(siteId, departmentId);
  snapshot.ownerId = ownerId;
  snapshot.areaOwnerId = firstText(data, spec.areaOwnerColumns ?? ['area_owner_id']);
  snapshot.requesterManagerId = requester?.supervisor_id ?? null;

  return {
    moduleKey: input.moduleKey,
    workflowType: input.workflowType,
    triggerEvent: input.triggerEvent,
    sourceRecordId: input.sourceRecordId,
    sourceRecordRef: firstText(data, spec.refColumns) ?? input.sourceRecordId,
    siteId,
    departmentId,
    requestedBy: input.requestedBy,
    ownerId,
    priority: sourcePriority(data),
    recordData: snapshot,
  };
}
