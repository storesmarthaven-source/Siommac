/**
 * netlify/functions/lib/hr/rosterCore.ts
 *
 * Core roster mutations:
 *  - createRoster (via runModuleMutation, idempotent)
 *  - generateFromRotation (fill assignments from pattern)
 *  - syncLeave (mark days 'leave' from approved hr_leave_request)
 *  - saveAssignment (with §2.5 validation: overlap / min-rest / max-consecutive / site membership)
 *  - removeAssignment
 *  - bulkUpsertAssignments
 *  - publishRoster (freeze + notify assignees, direct path — no half-wired workflow)
 *  - reopenRoster (audited)
 */

import { sb }                from '../db';
import { emitAppEvent }      from '../appEvents';
import { nextRef }           from '../refGenerator';
import { runModuleMutation } from '../moduleServiceAdapter';
import { writeHrAudit }      from './employeeCore';
import { notify }            from '../notify';
import type {
  RosterRow, CreateRosterArgs, UpsertAssignmentArgs, BulkUpsertAssignmentsArgs, ShiftAssignment,
} from '../../../../types/hrRoster';

// ── Policy defaults (read from settings in a future iteration) ────────────────
const MIN_REST_HOURS   = 11;   // minimum rest between consecutive shifts
const MAX_CONSECUTIVE  = 7;    // max working days in a row

// ── Helpers ───────────────────────────────────────────────────────────────────

function toHHMM(t: string): number {
  // 'HH:MM' or 'HH:MM:SS' → minutes since midnight
  const parts = t.split(':');
  return parseInt(parts[0] ?? '0', 10) * 60 + parseInt(parts[1] ?? '0', 10);
}

async function getRosterOrThrow(rosterId: string): Promise<Record<string, unknown>> {
  const { data, error } = await sb.from('hr_rosters').select('*').eq('id', rosterId).maybeSingle<Record<string, unknown>>();
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  if (!data) throw Object.assign(new Error('Roster not found.'), { status: 404 });
  return data;
}

// ── Create roster ─────────────────────────────────────────────────────────────

export async function createRoster(actorId: string, args: CreateRosterArgs): Promise<{ rosterId: string; rosterNo: string }> {
  if (args.periodEnd < args.periodStart) throw Object.assign(new Error('period_end must be >= period_start.'), { status: 400 });

  const result = await runModuleMutation<{ id: string; rosterNo: string }>({
    context: { actorUserId: actorId, siteId: args.siteId, departmentId: args.departmentId ?? null },
    options: {
      module: 'hr', operation: 'create', entityType: 'roster',
      idempotencyKey: `hr.roster:${args.siteId}:${args.departmentId ?? ''}:${args.periodStart}`,
      eventType: 'hr.roster.created', eventSeverity: 'info',
      getEntityIdentity: (r) => ({ id: r.id, ref: r.rosterNo }),
      buildEventPayload:  (r) => ({ rosterNo: r.rosterNo, periodStart: args.periodStart, periodEnd: args.periodEnd }),
    },
    writeRecord: async () => {
      const rosterNo = await nextRef('ROS');
      const { data, error } = await sb.from('hr_rosters').insert({
        roster_no:          rosterNo,
        title:              args.title.trim(),
        site_id:            args.siteId,
        department_id:      args.departmentId ?? null,
        period_start:       args.periodStart,
        period_end:         args.periodEnd,
        status:             'draft',
        rotation_pattern_id: args.rotationPatternId ?? null,
        created_by:         actorId,
      }).select('id, roster_no').single<{ id: string; roster_no: string }>();
      if (error) throw Object.assign(new Error(error.message), { status: 500 });
      await writeHrAudit({ submoduleKey: 'roster', recordId: data.id, actorId, action: 'hr.roster.created',
        newState: { rosterNo, ...args } });
      return { id: data.id, rosterNo: data.roster_no };
    },
  });

  return { rosterId: result.entityId, rosterNo: result.record.rosterNo };
}

// ── Generate from rotation ────────────────────────────────────────────────────
// Fills shift_assignments for ALL employees in the roster's dept/site using the
// named rotation pattern. Existing assignments are NOT overwritten (only 'open'
// slots are filled to preserve hand-edits). Returns count of rows upserted.

export async function generateFromRotation(
  actorId: string, rosterId: string, patternId?: string,
): Promise<{ generated: number }> {
  const roster = await getRosterOrThrow(rosterId);
  if (roster['status'] === 'published' || roster['status'] === 'archived') {
    throw Object.assign(new Error('Cannot regenerate assignments on a published or archived roster.'), { status: 400 });
  }

  const effectivePatternId = patternId ?? (roster['rotation_pattern_id'] as string | null);
  if (!effectivePatternId) throw Object.assign(new Error('No rotation pattern specified for this roster.'), { status: 400 });

  const { data: pattern } = await sb.from('hr_rotation_patterns').select('cycle_days, pattern').eq('id', effectivePatternId).maybeSingle<{ cycle_days: number; pattern: Array<{ dayIndex: number; shiftTemplateCode: string }> }>();
  if (!pattern) throw Object.assign(new Error('Rotation pattern not found.'), { status: 404 });

  // Load shift templates by code
  const codes = Array.from(new Set(pattern.pattern.map(p => p.shiftTemplateCode).filter(c => c !== 'off')));
  const { data: tmplData } = codes.length
    ? await sb.from('hr_shift_templates').select('id, code, paid_hours').in('code', codes)
    : { data: [] };
  const tmplByCode = new Map(((tmplData ?? []) as { id: string; code: string; paid_hours: number }[]).map(t => [t.code, t]));

  // Employees in scope (site + optionally dept)
  let empQ = sb.from('app_users').select('id').eq('status', 'active');
  if (roster['site_id']) empQ = empQ.eq('site_id', roster['site_id'] as string);
  if (roster['department_id']) empQ = empQ.eq('department_id', roster['department_id'] as string);
  const { data: emps } = await empQ;
  const empIds = ((emps ?? []) as { id: string }[]).map(e => e.id);
  if (!empIds.length) return { generated: 0 };

  // Enumerate dates
  const dates: string[] = [];
  const d = new Date((roster['period_start'] as string) + 'T00:00:00Z');
  const end = new Date((roster['period_end'] as string) + 'T00:00:00Z');
  while (d <= end) {
    dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }

  // Existing assignments (to avoid overwriting hand-edits)
  const { data: existing } = await sb.from('hr_shift_assignments')
    .select('employee_id, work_date').eq('roster_id', rosterId);
  const existingSet = new Set(((existing ?? []) as { employee_id: string; work_date: string }[]).map(e => `${e.employee_id}|${e.work_date}`));

  const toInsert: Record<string, unknown>[] = [];
  const periodStart = new Date((roster['period_start'] as string) + 'T00:00:00Z');

  for (const empId of empIds) {
    for (const workDate of dates) {
      if (existingSet.has(`${empId}|${workDate}`)) continue;
      const daysSinceStart = Math.round((new Date(workDate + 'T00:00:00Z').getTime() - periodStart.getTime()) / 86_400_000);
      const patternIdx = daysSinceStart % pattern.cycle_days;
      const slot = pattern.pattern.find(p => p.dayIndex === patternIdx);
      const code = slot?.shiftTemplateCode ?? 'off';
      const tmpl = code !== 'off' ? tmplByCode.get(code) ?? null : null;

      toInsert.push({
        roster_id:          rosterId,
        employee_id:        empId,
        work_date:          workDate,
        shift_template_id:  tmpl?.id ?? null,
        kind:               code === 'off' ? 'off' : 'shift',
        hours:              tmpl ? Number(tmpl.paid_hours) : null,
        source:             'rotation',
        created_by:         actorId,
      });
    }
  }

  let generated = 0;
  const BATCH = 200;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const batch = toInsert.slice(i, i + BATCH);
    const { error } = await sb.from('hr_shift_assignments').insert(batch);
    if (error) throw Object.assign(new Error(error.message), { status: 500 });
    generated += batch.length;
  }

  // Update roster assignment_count
  const { data: total } = await sb.from('hr_shift_assignments').select('id', { count: 'exact', head: true }).eq('roster_id', rosterId);
  const count = (total as unknown as { count: number } | null)?.count ?? generated;
  await sb.from('hr_rosters').update({ assignment_count: count, updated_at: new Date().toISOString() }).eq('id', rosterId);

  await writeHrAudit({ submoduleKey: 'roster', recordId: rosterId, actorId,
    action: 'hr.roster.generated', newState: { patternId: effectivePatternId, generated } });
  void emitAppEvent({ eventType: 'hr.roster.generated', sourceModule: 'hr', sourceEntityType: 'roster',
    sourceEntityId: rosterId, actorUserId: actorId, severity: 'info', payload: { generated, patternId: effectivePatternId } });

  return { generated };
}

// ── Sync leave ────────────────────────────────────────────────────────────────
// Mark assignment days as 'leave' where an approved hr_leave_request exists for
// the employee within the roster's period. Never writes into the leave module.

export async function syncLeave(actorId: string, rosterId: string): Promise<{ synced: number }> {
  const roster = await getRosterOrThrow(rosterId);
  if (roster['status'] === 'published' || roster['status'] === 'archived') {
    throw Object.assign(new Error('Cannot sync leave on a published or archived roster.'), { status: 400 });
  }

  const { data: leaveRows } = await sb.from('hr_leave_requests')
    .select('employee_id, from_date, to_date')
    .eq('status', 'approved')
    .lte('from_date', roster['period_end'] as string)
    .gte('to_date', roster['period_start'] as string);
  const leaves = (leaveRows ?? []) as { employee_id: string; from_date: string; to_date: string }[];

  let synced = 0;
  for (const leave of leaves) {
    // For each day in the leave, update any matching assignment
    const d = new Date(leave.from_date + 'T00:00:00Z');
    const end = new Date(leave.to_date + 'T00:00:00Z');
    while (d <= end) {
      const workDate = d.toISOString().slice(0, 10);
      if (workDate < (roster['period_start'] as string) || workDate > (roster['period_end'] as string)) {
        d.setUTCDate(d.getUTCDate() + 1);
        continue;
      }
      const { error } = await sb.from('hr_shift_assignments')
        .update({ kind: 'leave', shift_template_id: null, hours: null, source: 'leave_sync', updated_at: new Date().toISOString() })
        .eq('roster_id', rosterId).eq('employee_id', leave.employee_id).eq('work_date', workDate);
      if (!error) synced++;
      d.setUTCDate(d.getUTCDate() + 1);
    }
  }

  await writeHrAudit({ submoduleKey: 'roster', recordId: rosterId, actorId,
    action: 'hr.roster.leave_synced', newState: { synced, leaveCount: leaves.length } });

  return { synced };
}

// ── Save assignment (with §2.5 validation) ────────────────────────────────────

export async function saveAssignment(actorId: string, args: UpsertAssignmentArgs): Promise<ShiftAssignment> {
  const roster = await getRosterOrThrow(args.rosterId);
  if (roster['status'] === 'published' || roster['status'] === 'archived') {
    throw Object.assign(new Error('Roster is locked. Reopen it before editing assignments.'), { status: 400 });
  }

  // Validate work_date within roster period
  const periodStart = roster['period_start'] as string;
  const periodEnd   = roster['period_end'] as string;
  if (args.workDate < periodStart || args.workDate > periodEnd) {
    throw Object.assign(new Error(`work_date ${args.workDate} is outside the roster period (${periodStart}–${periodEnd}).`), { status: 400 });
  }

  // Validate employee belongs to the roster's site/dept
  const { data: emp } = await sb.from('app_users').select('site_id, department_id').eq('id', args.employeeId).maybeSingle<{ site_id: string | null; department_id: string | null }>();
  if (!emp) throw Object.assign(new Error('Employee not found.'), { status: 404 });
  if (roster['site_id'] && emp.site_id !== roster['site_id']) {
    throw Object.assign(new Error('Employee does not belong to the roster\'s site.'), { status: 400 });
  }

  // Shift-specific validation
  if (args.kind === 'shift' && args.shiftTemplateId) {
    const { data: tmpl } = await sb.from('hr_shift_templates')
      .select('starts_at, ends_at, crosses_midnight')
      .eq('id', args.shiftTemplateId).maybeSingle<{ starts_at: string; ends_at: string; crosses_midnight: boolean }>();
    if (!tmpl) throw Object.assign(new Error('Shift template not found.'), { status: 404 });

    // Min rest: check previous and next day's assignments for this employee
    const prevDate = new Date(args.workDate + 'T00:00:00Z');
    prevDate.setUTCDate(prevDate.getUTCDate() - 1);
    const nextDate = new Date(args.workDate + 'T00:00:00Z');
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);

    const { data: adjacent } = await sb.from('hr_shift_assignments')
      .select('work_date, kind, shift_template_id')
      .eq('roster_id', args.rosterId).eq('employee_id', args.employeeId)
      .in('work_date', [prevDate.toISOString().slice(0, 10), nextDate.toISOString().slice(0, 10)]);

    const adjRows = (adjacent ?? []) as { work_date: string; kind: string; shift_template_id: string | null }[];
    if (adjRows.length) {
      const adjTemplIds = adjRows.map(a => a.shift_template_id).filter((x): x is string => !!x);
      let adjTmplMap = new Map<string, { starts_at: string; ends_at: string; crosses_midnight: boolean }>();
      if (adjTemplIds.length) {
        const { data: adjTmpls } = await sb.from('hr_shift_templates').select('id, starts_at, ends_at, crosses_midnight').in('id', adjTemplIds);
        adjTmplMap = new Map(((adjTmpls ?? []) as { id: string; starts_at: string; ends_at: string; crosses_midnight: boolean }[]).map(t => [t.id, t]));
      }
      const newStart = toHHMM(tmpl.starts_at);
      const newEnd   = toHHMM(tmpl.ends_at);

      for (const adj of adjRows) {
        if (adj.kind !== 'shift' || !adj.shift_template_id) continue;
        const adjT = adjTmplMap.get(adj.shift_template_id);
        if (!adjT) continue;
        const adjStart = toHHMM(adjT.starts_at);
        const adjEnd   = toHHMM(adjT.ends_at);

        // Rest = the gap between the EARLIER shift's end and the LATER shift's start,
        // both measured from the earlier day's midnight (adjacents are exactly one day
        // apart, so the later day starts at +1440). A shift that crosses midnight ends on
        // the following day (+1440), which SHORTENS the rest window — the previous formula
        // wrongly added a whole day back, reporting 24h where a NIGHT→morning-DAY pair
        // actually has 0h rest.
        let restMinutes: number;
        if (adj.work_date < args.workDate) {
          // adj is the earlier (previous) day; the new shift is the later one.
          const adjEndAbs = adjEnd + (adjT.crosses_midnight ? 1440 : 0);
          restMinutes = (newStart + 1440) - adjEndAbs;
        } else {
          // adj is the later (next) day; the new shift is the earlier one.
          const newEndAbs = newEnd + (tmpl.crosses_midnight ? 1440 : 0);
          restMinutes = (adjStart + 1440) - newEndAbs;
        }
        const restHours = restMinutes / 60;
        if (restHours < MIN_REST_HOURS) {
          throw Object.assign(
            new Error(`Insufficient rest between shifts: ${restHours.toFixed(1)}h (minimum ${MIN_REST_HOURS}h required).`),
            { status: 400 },
          );
        }
      }
    }

    // Max consecutive working days
    const windowStart = new Date(args.workDate + 'T00:00:00Z');
    windowStart.setUTCDate(windowStart.getUTCDate() - MAX_CONSECUTIVE);
    const windowEnd = new Date(args.workDate + 'T00:00:00Z');
    windowEnd.setUTCDate(windowEnd.getUTCDate() + MAX_CONSECUTIVE);

    const { data: windowRows } = await sb.from('hr_shift_assignments')
      .select('work_date, kind')
      .eq('roster_id', args.rosterId).eq('employee_id', args.employeeId)
      .gte('work_date', windowStart.toISOString().slice(0, 10))
      .lte('work_date', windowEnd.toISOString().slice(0, 10))
      .neq('work_date', args.workDate)  // exclude the slot being saved
      .order('work_date');

    const shiftDates = new Set(((windowRows ?? []) as { work_date: string; kind: string }[]).filter(r => r.kind === 'shift').map(r => r.work_date));
    shiftDates.add(args.workDate); // the new assignment

    // Find the longest consecutive run including args.workDate
    let maxRun = 0, run = 0, prevD: string | null = null;
    const sorted = Array.from(shiftDates).sort();
    for (const dt of sorted) {
      if (prevD) {
        const gap = Math.round((new Date(dt + 'T00:00:00Z').getTime() - new Date(prevD + 'T00:00:00Z').getTime()) / 86_400_000);
        run = gap === 1 ? run + 1 : 1;
      } else { run = 1; }
      if (run > maxRun) maxRun = run;
      prevD = dt;
    }
    if (maxRun > MAX_CONSECUTIVE) {
      throw Object.assign(
        new Error(`This assignment would create a run of ${maxRun} consecutive working days (maximum ${MAX_CONSECUTIVE}).`),
        { status: 400 },
      );
    }
  }

  // Upsert (unique: roster_id + employee_id + work_date)
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    roster_id:         args.rosterId,
    employee_id:       args.employeeId,
    work_date:         args.workDate,
    shift_template_id: args.shiftTemplateId ?? null,
    kind:              args.kind,
    hours:             args.hours ?? null,
    note:              args.note ?? null,
    source:            args.source ?? 'manual',
    created_by:        actorId,
    updated_at:        now,
  };

  const { data: upserted, error } = await sb.from('hr_shift_assignments')
    .upsert(payload, { onConflict: 'roster_id,employee_id,work_date' })
    .select('*').single<Record<string, unknown>>();
  if (error) throw Object.assign(new Error(error.message), { status: 500 });

  await writeHrAudit({ submoduleKey: 'roster', recordId: args.rosterId, actorId,
    action: 'hr.roster.assignment.saved', newState: args });

  // Re-fetch to get template details
  const tmplId = upserted['shift_template_id'] as string | null;
  let tmplInfo: { code: string; name: string; colour: string | null } | null = null;
  if (tmplId) {
    const { data: t } = await sb.from('hr_shift_templates').select('code, name, colour').eq('id', tmplId).maybeSingle<{ code: string; name: string; colour: string | null }>();
    tmplInfo = t;
  }

  const { data: empName } = await sb.from('app_users').select('full_name').eq('id', args.employeeId).maybeSingle<{ full_name: string | null }>();

  return {
    id:              upserted['id'] as string,
    rosterId:        args.rosterId,
    employeeId:      args.employeeId,
    employeeName:    empName?.full_name ?? null,
    workDate:        args.workDate,
    shiftTemplateId: tmplId,
    shiftCode:       tmplInfo?.code ?? null,
    shiftName:       tmplInfo?.name ?? null,
    shiftColour:     tmplInfo?.colour ?? null,
    kind:            args.kind,
    hours:           upserted['hours'] != null ? Number(upserted['hours']) : null,
    note:            (upserted['note'] as string | null) ?? null,
    source:          (upserted['source'] as ShiftAssignment['source']) ?? 'manual',
    createdBy:       (upserted['created_by'] as string | null) ?? null,
    createdAt:       upserted['created_at'] as string,
    updatedAt:       upserted['updated_at'] as string,
  };
}

// ── Remove assignment ─────────────────────────────────────────────────────────

export async function removeAssignment(actorId: string, assignmentId: string): Promise<void> {
  const { data: asgn } = await sb.from('hr_shift_assignments').select('roster_id, employee_id, work_date').eq('id', assignmentId).maybeSingle<{ roster_id: string; employee_id: string; work_date: string }>();
  if (!asgn) throw Object.assign(new Error('Assignment not found.'), { status: 404 });

  const roster = await getRosterOrThrow(asgn.roster_id);
  if (roster['status'] === 'published' || roster['status'] === 'archived') {
    throw Object.assign(new Error('Roster is locked. Reopen it before removing assignments.'), { status: 400 });
  }

  const { error } = await sb.from('hr_shift_assignments').delete().eq('id', assignmentId);
  if (error) throw Object.assign(new Error(error.message), { status: 500 });

  await writeHrAudit({ submoduleKey: 'roster', recordId: asgn.roster_id, actorId,
    action: 'hr.roster.assignment.removed', newState: { assignmentId, ...asgn } });
}

// ── Bulk upsert assignments ───────────────────────────────────────────────────

export async function bulkUpsertAssignments(actorId: string, args: BulkUpsertAssignmentsArgs): Promise<{ count: number }> {
  const roster = await getRosterOrThrow(args.rosterId);
  if (roster['status'] === 'published' || roster['status'] === 'archived') {
    throw Object.assign(new Error('Roster is locked. Reopen it before editing assignments.'), { status: 400 });
  }
  // Bulk insert validates per-row by calling saveAssignment for each — this ensures
  // validation rules are enforced. For large rosters, call the generate endpoint instead.
  let count = 0;
  for (const a of args.assignments) {
    await saveAssignment(actorId, { ...a, rosterId: args.rosterId });
    count++;
  }
  return { count };
}

// ── Publish roster ────────────────────────────────────────────────────────────
// Freeze + emit hr.roster.published + notify every assigned employee.

export async function publishRoster(actorId: string, rosterId: string): Promise<RosterRow> {
  const roster = await getRosterOrThrow(rosterId);
  if (roster['status'] === 'published') throw Object.assign(new Error('Roster is already published.'), { status: 400 });
  if (roster['status'] === 'archived')  throw Object.assign(new Error('Cannot publish an archived roster.'), { status: 400 });

  const now = new Date().toISOString();
  const { data: updated, error } = await sb.from('hr_rosters')
    .update({ status: 'published', published_by: actorId, published_at: now, updated_at: now })
    .eq('id', rosterId).select('*').single<Record<string, unknown>>();
  if (error) throw Object.assign(new Error(error.message), { status: 500 });

  await writeHrAudit({ submoduleKey: 'roster', recordId: rosterId, actorId,
    action: 'hr.roster.published', previousState: { status: roster['status'] }, newState: { status: 'published', publishedAt: now } });
  void emitAppEvent({ eventType: 'hr.roster.published', sourceModule: 'hr', sourceEntityType: 'roster',
    sourceEntityId: rosterId, actorUserId: actorId, severity: 'info',
    payload: { rosterNo: updated['roster_no'], periodStart: updated['period_start'], periodEnd: updated['period_end'] } });

  // Notify all assigned employees (fire-and-forget)
  const { data: assignees } = await sb.from('hr_shift_assignments')
    .select('employee_id').eq('roster_id', rosterId).neq('kind', 'off');
  const uniqueEmployeeIds = Array.from(new Set(((assignees ?? []) as { employee_id: string }[]).map(a => a.employee_id)));

  for (const empId of uniqueEmployeeIds) {
    void notify({
      userId:     empId,
      type:       'hr.roster.published',
      title:      `Your roster has been published: ${updated['roster_no'] as string}`,
      body:       `Your schedule for ${updated['period_start'] as string} – ${updated['period_end'] as string} is now available.`,
      module:     'hr',
      severity:   'info',
      sourceType: 'roster',
      sourceId:   rosterId,
      dedupeKey:  `hr.roster.published:${rosterId}:${empId}`,
    });
  }

  // Return updated roster row (enriched minimally)
  return {
    id:                rosterId,
    rosterNo:          updated['roster_no'] as string,
    title:             updated['title'] as string,
    siteId:            updated['site_id'] as string,
    siteName:          null,
    departmentId:      (updated['department_id'] as string | null) ?? null,
    departmentName:    null,
    periodStart:       updated['period_start'] as string,
    periodEnd:         updated['period_end'] as string,
    status:            'published',
    rotationPatternId: (updated['rotation_pattern_id'] as string | null) ?? null,
    workflowId:        (updated['workflow_id'] as string | null) ?? null,
    assignmentCount:   (updated['assignment_count'] as number) ?? 0,
    openShiftCount:    (updated['open_shift_count'] as number) ?? 0,
    createdBy:         (updated['created_by'] as string | null) ?? null,
    createdByName:     null,
    publishedBy:       actorId,
    publishedAt:       now,
    createdAt:         updated['created_at'] as string,
    updatedAt:         now,
  };
}

// ── Reopen roster ─────────────────────────────────────────────────────────────

export async function reopenRoster(actorId: string, rosterId: string, reason?: string): Promise<{ rosterId: string; status: string }> {
  const roster = await getRosterOrThrow(rosterId);
  if (roster['status'] !== 'published') {
    throw Object.assign(new Error('Only published rosters can be reopened.'), { status: 400 });
  }

  const { error } = await sb.from('hr_rosters').update({ status: 'draft', updated_at: new Date().toISOString() }).eq('id', rosterId);
  if (error) throw Object.assign(new Error(error.message), { status: 500 });

  await writeHrAudit({ submoduleKey: 'roster', recordId: rosterId, actorId,
    action: 'hr.roster.reopened', previousState: { status: 'published' }, newState: { status: 'draft' }, reason: reason ?? null });
  void emitAppEvent({ eventType: 'hr.roster.reopened', sourceModule: 'hr', sourceEntityType: 'roster',
    sourceEntityId: rosterId, actorUserId: actorId, severity: 'warning', payload: { reason: reason ?? null } });

  return { rosterId, status: 'draft' };
}
