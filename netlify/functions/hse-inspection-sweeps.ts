// hse-inspection-sweeps.ts — Netlify scheduled function
//
// Hourly sweep covering the Inspections automation rules (spec §14):
//
//   Sweep 1 — Inspection due soon:
//     hse_inspections in (scheduled, rescheduled) with due_at in the next 48 h.
//     Sets status → 'due_soon' and emits hse.inspection.due_soon (warning).
//     dedupeKey: insp-due_soon:<ref>
//
//   Sweep 2 — Inspection overdue:
//     hse_inspections in (scheduled, due_soon, rescheduled, in_progress) with
//     due_at < now. Sets status → 'overdue' and emits hse.inspection.overdue
//     (critical) to assignee / reviewer / creator.
//     dedupeKey: insp-overdue:<ref>
//
//   Sweep 3 — Finding overdue:
//     hse_inspection_findings (not closed/cancelled/overdue) with due_at < now.
//     Sets status → 'overdue' and emits hse.inspection_finding.overdue (warning)
//     to owner / reviewer / creator.
//     dedupeKey: insp-finding-overdue:<ref>
//
// Idempotency: per-user notification dedup is enforced by notify.ts on the
// (user_id, dedupe_key) unique index; status updates are naturally idempotent
// (the row leaves the queried set once transitioned).

import { schedule } from '@netlify/functions';
import { sb }       from './lib/db';
import { emitAppEvent } from './lib/appEvents';

interface ScheduleEvent { headers?: Record<string, string | undefined>; }
function _isScheduledCall(event: ScheduleEvent): boolean {
  return event.headers?.['x-netlify-event'] === 'schedule';
}

interface InspectionRow {
  id: string; inspection_no: string | null; ref: string | null; status: string;
  due_at: string | null; assignee_id: string | null; reviewer_id: string | null;
  created_by: string | null; site_id: string | null; department_id: string | null;
}
interface FindingRow {
  id: string; finding_no: string | null; status: string; severity: string;
  due_at: string | null; owner_id: string | null; reviewer_id: string | null;
  created_by: string | null; site_id: string | null;
}

function uniqueUserIds(...ids: (string | null | undefined)[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const id of ids) if (id && !seen.has(id)) { seen.add(id); out.push(id); }
  return out;
}

export const handler = schedule('0 * * * *', async (event: ScheduleEvent) => {
  if (!_isScheduledCall(event)) {
    console.warn('hse-inspection-sweeps: rejected non-scheduled call');
    return { statusCode: 401, body: 'Unauthorized' };
  }

  const now    = new Date();
  const nowIso = now.toISOString();
  const in48h  = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();

  // ── Sweep 1: due soon ─────────────────────────────────────────────────────────
  const { data: dueSoon } = await sb
    .from('hse_inspections')
    .select('id, inspection_no, ref, status, due_at, assignee_id, reviewer_id, created_by, site_id, department_id')
    .in('status', ['scheduled', 'rescheduled'])
    .gt('due_at', nowIso)
    .lte('due_at', in48h)
    .limit(1000);

  for (const i of (dueSoon ?? []) as InspectionRow[]) {
    const ref = i.inspection_no ?? i.ref ?? i.id;
    await sb.from('hse_inspections').update({ status: 'due_soon', updated_at: nowIso }).eq('id', i.id);
    const recipients = uniqueUserIds(i.assignee_id, i.reviewer_id, i.created_by).map(userId => ({ userId, reason: 'assignee' as const }));
    await emitAppEvent({
      eventType: 'hse.inspection.due_soon', sourceModule: 'hse', sourceEntityType: 'inspection',
      sourceEntityId: ref, actorUserId: null, siteId: i.site_id, departmentId: i.department_id,
      severity: 'warning', payload: { dueAt: i.due_at }, dedupeKey: `insp-due_soon:${ref}`,
      explicitRecipients: recipients.length ? recipients : undefined,
      notification: { title: 'Inspection due soon', body: `${ref} is due ${i.due_at}.`, actionRoute: 'hse/inspections', actionRequired: true, dueAt: i.due_at },
    }).catch(e => console.error('due_soon emit error', e));
  }

  // ── Sweep 2: overdue inspections ──────────────────────────────────────────────
  const { data: overdue } = await sb
    .from('hse_inspections')
    .select('id, inspection_no, ref, status, due_at, assignee_id, reviewer_id, created_by, site_id, department_id')
    .in('status', ['scheduled', 'due_soon', 'rescheduled', 'in_progress'])
    .lt('due_at', nowIso)
    .limit(1000);

  for (const i of (overdue ?? []) as InspectionRow[]) {
    const ref = i.inspection_no ?? i.ref ?? i.id;
    await sb.from('hse_inspections').update({ status: 'overdue', updated_at: nowIso }).eq('id', i.id);
    const recipients = uniqueUserIds(i.assignee_id, i.reviewer_id, i.created_by).map(userId => ({ userId, reason: 'assignee' as const }));
    await emitAppEvent({
      eventType: 'hse.inspection.overdue', sourceModule: 'hse', sourceEntityType: 'inspection',
      sourceEntityId: ref, actorUserId: null, siteId: i.site_id, departmentId: i.department_id,
      severity: 'critical', payload: { dueAt: i.due_at }, dedupeKey: `insp-overdue:${ref}`,
      explicitRecipients: recipients.length ? recipients : undefined,
      notification: { title: 'Inspection overdue', body: `${ref} is past its due date and not completed.`, actionRoute: 'hse/inspections', actionRequired: true, dueAt: i.due_at },
    }).catch(e => console.error('overdue emit error', e));
  }

  // ── Sweep 3: overdue findings ─────────────────────────────────────────────────
  const { data: findOverdue } = await sb
    .from('hse_inspection_findings')
    .select('id, finding_no, status, severity, due_at, owner_id, reviewer_id, created_by, site_id')
    .not('status', 'in', '("closed","cancelled","overdue")')
    .lt('due_at', nowIso)
    .limit(1000);

  for (const f of (findOverdue ?? []) as FindingRow[]) {
    const ref = f.finding_no ?? f.id;
    await sb.from('hse_inspection_findings').update({ status: 'overdue', updated_at: nowIso }).eq('id', f.id);
    const recipients = uniqueUserIds(f.owner_id, f.reviewer_id, f.created_by).map(userId => ({ userId, reason: 'owner' as const }));
    await emitAppEvent({
      eventType: 'hse.inspection_finding.overdue', sourceModule: 'hse', sourceEntityType: 'inspection_finding',
      sourceEntityId: ref, actorUserId: null, siteId: f.site_id,
      severity: f.severity === 'critical' ? 'critical' : 'warning', payload: { dueAt: f.due_at },
      dedupeKey: `insp-finding-overdue:${ref}`,
      explicitRecipients: recipients.length ? recipients : undefined,
      notification: { title: 'Finding overdue', body: `${ref} corrective action is past due.`, actionRoute: 'hse/inspections', actionRequired: true, dueAt: f.due_at },
    }).catch(e => console.error('finding overdue emit error', e));
  }

  return { statusCode: 200, body: 'ok' };
});
