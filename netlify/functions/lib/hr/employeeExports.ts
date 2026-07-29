/**
 * lib/hr/employeeExports.ts — the three authenticated employee exports.
 *
 * WHY THESE ARE SERVER-SIDE, not a client-side dump of loaded rows:
 * an export built from browser-held rows can only contain what the browser was
 * given, which means the filtering, the confidentiality tiering and the totals
 * would all be re-derived on the client — where they can be tampered with and
 * where a restricted document that was merely hidden in the UI is still present
 * in memory. Each builder below re-reads the data through the SAME authorised
 * service the screen uses, applies the confidentiality filter BEFORE anything is
 * counted, and only then renders.
 *
 * PERMISSIONS: each export reuses the narrow key that already governs its
 * dataset — `hr.employee_documents.download`, `hr.employees.readiness.view`,
 * `hr.audit.view`. There is deliberately no broad "employee export" permission:
 * one such key would let anyone holding it extract all three datasets, which is
 * precisely the aggregation the narrow keys exist to prevent.
 *
 * FORMATS: csv and pdf only. XLSX is deferred repository-wide — see the note in
 * lib/reportTable.ts. Never re-add an Excel writer to satisfy a dialog option.
 *
 * Every export writes its own `audit_logs` row: taking data out of the system is
 * itself an auditable act, not merely a read.
 */

import { sb } from '../db';
import { renderTableFile, type ExportFileFormat, type ReportTable, type RenderedFile } from '../reportTable';
import { getDocumentHealth } from './documentHealth';
import { getReadinessMatrix } from './readinessService';
import { firstNonBlank } from './employeeCore';
import type { DocumentHealthItem } from '../../../../types/hrEmployeeProfile';

/** Scopes the locked Export Document Index dialog offers. */
export type DocumentIndexScope = 'all_authorised' | 'current_filters' | 'expiring_missing';

export interface ExportRequest {
  actorId: string;
  employeeId: string;
  format: ExportFileFormat;
  /** Free-text justification. Mandatory for the audit export. */
  reason?: string | null;
}

export interface ExportResult extends RenderedFile {
  fileName: string;
  /** Echoed so the caller can correlate the file with its audit row. */
  correlationId: string;
}

const DASH = '—';

async function employeeLabel(employeeId: string): Promise<{ name: string; number: string | null }> {
  const { data, error } = await sb.from('app_users')
    .select('display_name, full_name, username, employee_number').eq('id', employeeId)
    .maybeSingle<{ display_name: string | null; full_name: string | null; username: string | null; employee_number: string | null }>();
  if (error) throw new Error(`Export employee read failed: ${error.message}`);
  if (!data) throw Object.assign(new Error('Employee not found.'), { status: 404 });
  return {
    name: firstNonBlank(data.display_name, data.full_name, data.username) ?? employeeId,
    number: data.employee_number,
  };
}

/** Slug safe for a Content-Disposition filename. */
const slug = (v: string): string => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'employee';

/**
 * Record the export itself.
 *
 * Written AFTER the bytes are produced and BEFORE they are returned, so a
 * failure to audit fails the export rather than leaking an unrecorded file.
 */
async function auditExport(p: {
  actorId: string; employeeId: string; kind: string; format: ExportFileFormat;
  rowCount: number; scope: string; reason: string | null; correlationId: string;
}): Promise<void> {
  const changes = {
    employeeId: p.employeeId, exportKind: p.kind, format: p.format,
    rowCount: p.rowCount, scope: p.scope, reason: p.reason, correlationId: p.correlationId,
  };
  const { error } = await sb.from('audit_logs').insert({
    action: `hr.employee.export.${p.kind}`,
    table_name: 'app_users',
    record_id: p.employeeId,
    user_id: p.actorId,
    changes,
  });
  if (error) throw new Error(`Export audit write failed: ${error.message}`);

  const { error: hrError } = await sb.from('hr_audit_log').insert({
    employee_id: p.employeeId, submodule_key: 'exports', record_id: p.employeeId,
    actor_id: p.actorId, action: `hr.employee.export.${p.kind}`,
    new_state: changes, metadata: { correlationId: p.correlationId },
  });
  if (hrError) throw new Error(`Export HR audit write failed: ${hrError.message}`);
}

// ── 1. Document Index ───────────────────────────────────────────────────────

/**
 * Metadata and status ONLY — never a document binary.
 *
 * The rows are built from `getDocumentHealth`, which applies the sensitive-tier
 * filter server-side before it counts anything. That ordering matters: a
 * restricted document must not be able to leak through a total or a percentage
 * either, so the filter runs before the totals exist, not after.
 */
export async function exportDocumentIndex(
  req: ExportRequest & { scope: DocumentIndexScope; canSeeSensitive: boolean; today: string },
): Promise<ExportResult> {
  const [employee, health] = await Promise.all([
    employeeLabel(req.employeeId),
    getDocumentHealth(req.employeeId, req.canSeeSensitive, req.today),
  ]);

  const all = health.groups.flatMap(g => g.items.map(item => ({ group: g.label, item })));
  const selected = req.scope === 'expiring_missing'
    ? all.filter(r => r.item.state === 'expiring' || r.item.state === 'missing' || r.item.state === 'expired')
    // `current_filters` mirrors the tab's default view: everything the actor may
    // see. It is a distinct scope from `all_authorised` only once per-tab
    // filtering exists on this surface; today they resolve to the same rows, and
    // the applied scope is recorded on the export so the two are never confused.
    : all;

  const table: ReportTable = {
    title: 'Employee Document Index',
    subtitle: `${employee.name}${employee.number ? ` · ${employee.number}` : ''} · scope: ${req.scope.replace(/_/g, ' ')}`,
    headers: ['Category', 'Document', 'State', 'Required', 'Expires', 'Detail'],
    rows: selected.map(({ group, item }: { group: string; item: DocumentHealthItem }) => [
      group, item.title, item.state, item.required ? 'Yes' : 'No',
      item.expiryDate ?? DASH, item.detail,
    ]),
  };

  const generatedAt = new Date().toISOString();
  const rendered = await renderTableFile(table, req.format, generatedAt);
  const correlationId = crypto.randomUUID();
  await auditExport({
    actorId: req.actorId, employeeId: req.employeeId, kind: 'document_index',
    format: req.format, rowCount: rendered.rowCount, scope: req.scope,
    reason: req.reason ?? null, correlationId,
  });

  return { ...rendered, correlationId, fileName: `document-index-${slug(employee.name)}.${rendered.ext}` };
}

// ── 2. Readiness Breakdown ──────────────────────────────────────────────────

/**
 * The employee's REAL readiness matrix — controls, states, owners, blockers and
 * due dates — read through the same service the Readiness tab uses, so an
 * exported breakdown can never disagree with the screen.
 */
export async function exportReadinessBreakdown(
  req: ExportRequest & { granted: ReadonlySet<string> },
): Promise<ExportResult> {
  const [employee, matrix] = await Promise.all([
    employeeLabel(req.employeeId),
    getReadinessMatrix(req.employeeId, req.granted),
  ]);

  const table: ReportTable = {
    title: 'Employee Readiness Breakdown',
    subtitle: `${employee.name}${employee.number ? ` · ${employee.number}` : ''} · `
      + `${matrix.coverage.readyControls} of ${matrix.coverage.totalControls} controls ready (${matrix.coverage.percent}%)`,
    headers: ['Control', 'Domain', 'Resolution Type', 'State', 'Percent', 'Owner', 'Responsible Now', 'Due', 'Age (Days)', 'Evaluated'],
    rows: matrix.controls.map(entry => [
      entry.control.label,
      entry.control.domain,
      entry.control.resolutionType,
      entry.state,
      entry.percent,
      // The fail-closed case is exported as it appears on screen, never blank.
      entry.owner.status === 'resolved' ? (entry.owner.ownerLabel ?? DASH) : 'Owner Required',
      entry.workItem?.nextResponsibleParty ?? DASH,
      entry.workItem?.dueDate ?? DASH,
      entry.workItem?.ageDays ?? 0,
      entry.evaluatedAt ?? DASH,
    ]),
  };

  const generatedAt = new Date().toISOString();
  const rendered = await renderTableFile(table, req.format, generatedAt);
  const correlationId = crypto.randomUUID();
  await auditExport({
    actorId: req.actorId, employeeId: req.employeeId, kind: 'readiness_breakdown',
    format: req.format, rowCount: rendered.rowCount, scope: 'matrix',
    reason: req.reason ?? null, correlationId,
  });

  return { ...rendered, correlationId, fileName: `readiness-breakdown-${slug(employee.name)}.${rendered.ext}` };
}

// ── 3. Audit History ────────────────────────────────────────────────────────

export interface AuditExportFilters {
  /** Inclusive ISO dates. Either may be omitted. */
  dateFrom?: string | null;
  dateTo?: string | null;
  /** `submodule_key` to restrict to, e.g. `documents`. */
  area?: string | null;
}

/**
 * Employee audit history.
 *
 * CAPABILITY MASKING: `reason` and the before/after state can carry sensitive
 * values, so they are included only for an actor who also holds the
 * sensitive-view capability. Everyone else gets the event, the actor and the
 * timestamp — which is what an audit trail is for — without the payload.
 *
 * A business reason is MANDATORY here (enforced by the route) and is written
 * into the export's own audit row.
 */
export async function exportAuditHistory(
  req: ExportRequest & { filters: AuditExportFilters; canSeeSensitive: boolean },
): Promise<ExportResult> {
  const employee = await employeeLabel(req.employeeId);

  let query = sb.from('hr_audit_log')
    .select('id, action, submodule_key, actor_id, reason, created_at')
    .eq('employee_id', req.employeeId)
    .order('created_at', { ascending: false });
  if (req.filters.dateFrom) query = query.gte('created_at', req.filters.dateFrom);
  // Inclusive upper bound: a date-only value must cover the whole day.
  if (req.filters.dateTo) query = query.lte('created_at', `${req.filters.dateTo}T23:59:59.999Z`);
  if (req.filters.area) query = query.eq('submodule_key', req.filters.area);

  const { data, error } = await query;
  if (error) throw new Error(`Audit export read failed: ${error.message}`);
  const rows = data as { id: string; action: string; submodule_key: string | null; actor_id: string | null; reason: string | null; created_at: string }[];

  const actorIds = [...new Set(rows.map(r => r.actor_id).filter((x): x is string => !!x))];
  const actors = new Map<string, string>();
  if (actorIds.length) {
    const { data: actorRows, error: actorError } = await sb.from('app_users')
      .select('id, display_name, full_name, username').in('id', actorIds);
    if (actorError) throw new Error(`Audit export actor read failed: ${actorError.message}`);
    for (const a of actorRows as { id: string; display_name: string | null; full_name: string | null; username: string | null }[]) {
      actors.set(a.id, firstNonBlank(a.display_name, a.full_name, a.username) ?? a.id);
    }
  }

  const headers = ['Recorded At', 'Area', 'Action', 'Actor'];
  if (req.canSeeSensitive) headers.push('Reason');

  const range = [req.filters.dateFrom ?? 'start', req.filters.dateTo ?? 'today'].join(' → ');
  const table: ReportTable = {
    title: 'Employee Audit History',
    subtitle: `${employee.name}${employee.number ? ` · ${employee.number}` : ''} · ${range}`
      + (req.filters.area ? ` · area: ${req.filters.area}` : '')
      + (req.canSeeSensitive ? '' : ' · reason column withheld'),
    headers,
    rows: rows.map(r => {
      const base = [
        r.created_at,
        r.submodule_key ?? 'employee',
        r.action,
        r.actor_id ? (actors.get(r.actor_id) ?? DASH) : DASH,
      ];
      return req.canSeeSensitive ? [...base, r.reason ?? DASH] : base;
    }),
  };

  const generatedAt = new Date().toISOString();
  const rendered = await renderTableFile(table, req.format, generatedAt);
  const correlationId = crypto.randomUUID();
  await auditExport({
    actorId: req.actorId, employeeId: req.employeeId, kind: 'audit_history',
    format: req.format, rowCount: rendered.rowCount,
    scope: `${range}${req.filters.area ? `/${req.filters.area}` : ''}`,
    reason: req.reason ?? null, correlationId,
  });

  return { ...rendered, correlationId, fileName: `audit-history-${slug(employee.name)}.${rendered.ext}` };
}
