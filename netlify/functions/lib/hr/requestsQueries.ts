// lib/hr/requestsQueries.ts — HR Requests: read queries.
//
// All queries join to app_users for human-readable names. Columns follow the
// snake_case → camelCase DTO convention. Self-scope filtering is done HERE by
// passing employeeId; the route layer resolves which scope applies.

import { sb } from '../db';
import type { HrRequestRow } from '../../../../types/hrRequests';

// ── Snake→camel mapper ────────────────────────────────────────────────────────

function mapRow(r: Record<string, unknown>): HrRequestRow {
  return {
    id:               r['id'] as string,
    requestNo:        r['request_no'] as string,
    employeeId:       r['employee_id'] as string,
    employeeName:     (r['employee_name'] as string | null) ?? null,
    requestType:      r['request_type'] as string,
    title:            r['title'] as string,
    details:          (r['details'] as Record<string, unknown>) ?? {},
    status:           r['status'] as HrRequestRow['status'],
    priority:         r['priority'] as HrRequestRow['priority'],
    workflowId:       (r['workflow_id'] as string | null) ?? null,
    requestedBy:      r['requested_by'] as string,
    requestedByName:  (r['requested_by_name'] as string | null) ?? null,
    decidedBy:        (r['decided_by'] as string | null) ?? null,
    decidedByName:    (r['decided_by_name'] as string | null) ?? null,
    fulfilledBy:      (r['fulfilled_by'] as string | null) ?? null,
    fulfilledByName:  (r['fulfilled_by_name'] as string | null) ?? null,
    decisionComment:  (r['decision_comment'] as string | null) ?? null,
    resolution:       (r['resolution'] as Record<string, unknown>) ?? {},
    requestedAt:      r['requested_at'] as string,
    decidedAt:        (r['decided_at'] as string | null) ?? null,
    fulfilledAt:      (r['fulfilled_at'] as string | null) ?? null,
    createdAt:        r['created_at'] as string,
    updatedAt:        (r['updated_at'] as string | null) ?? null,
  };
}

// The SELECT expression joins app_users three times (employee, requester,
// decider) to resolve human-readable names. Supabase PostgREST foreign-key
// embeds can't alias duplicate FKs cleanly, so we use a raw RPC-style select
// with the service-role client instead.
const SELECT_COLS = `
  id, request_no, employee_id, request_type, title, details, status, priority,
  workflow_id, requested_by, decided_by, fulfilled_by, decision_comment,
  resolution, requested_at, decided_at, fulfilled_at, created_at, updated_at,
  emp:app_users!hr_requests_employee_id_fkey(full_name),
  req_by:app_users!hr_requests_requested_by_fkey(full_name),
  dec_by:app_users!hr_requests_decided_by_fkey(full_name),
  ful_by:app_users!hr_requests_fulfilled_by_fkey(full_name)
`.trim();

type RawRow = Record<string, unknown> & {
  emp?: { full_name?: string } | null;
  req_by?: { full_name?: string } | null;
  dec_by?: { full_name?: string } | null;
  ful_by?: { full_name?: string } | null;
};

function flattenRow(r: RawRow): Record<string, unknown> {
  return {
    ...r,
    employee_name:      r.emp?.full_name ?? null,
    requested_by_name:  r.req_by?.full_name ?? null,
    decided_by_name:    r.dec_by?.full_name ?? null,
    fulfilled_by_name:  r.ful_by?.full_name ?? null,
  };
}

// ── Queries ───────────────────────────────────────────────────────────────────

/** All requests for a specific employee (self-scope path). */
export async function listMyRequests(employeeId: string): Promise<HrRequestRow[]> {
  const { data, error } = await sb
    .from('hr_requests')
    .select(SELECT_COLS)
    .eq('employee_id', employeeId)
    .order('requested_at', { ascending: false });
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  return ((data as unknown as RawRow[]) ?? []).map(r => mapRow(flattenRow(r)));
}

/** All requests — HR triage view. Optional filters. */
export async function listAllRequests(filters: {
  status?: string;
  requestType?: string;
  employeeId?: string;
}): Promise<HrRequestRow[]> {
  let q = sb.from('hr_requests').select(SELECT_COLS);
  if (filters.status)      q = q.eq('status', filters.status);
  if (filters.requestType) q = q.eq('request_type', filters.requestType);
  if (filters.employeeId)  q = q.eq('employee_id', filters.employeeId);
  const { data, error } = await q.order('requested_at', { ascending: false });
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  return ((data as unknown as RawRow[]) ?? []).map(r => mapRow(flattenRow(r)));
}

/** Single request by id. Returns null if not found. */
export async function getRequest(requestId: string): Promise<HrRequestRow | null> {
  const { data, error } = await sb
    .from('hr_requests')
    .select(SELECT_COLS)
    .eq('id', requestId)
    .maybeSingle<RawRow>();
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  if (!data) return null;
  return mapRow(flattenRow(data));
}
