/**
 * netlify/functions/lib/hr/rosterQueries.ts
 *
 * All READ operations for the roster module:
 *  - listRosters / getRoster (with assignments grouped by employee/day)
 *  - getCoverageGaps (requirements vs assignments)
 *  - getMyShifts (employee self-view, published only)
 *  - getExpectedShift (Attendance feed — one employee, one date)
 */

import { sb } from '../db';
import type {
  RosterRow, RosterDetail, ShiftAssignment, CoverageGap, MyShift,
} from '../../../../types/hrRoster';

// ── Mappers ───────────────────────────────────────────────────────────────────

function toRosterRow(
  r: Record<string, unknown>,
  sites: Map<string, string>,
  depts: Map<string, string>,
  creators: Map<string, string>,
): RosterRow {
  return {
    id:                r['id'] as string,
    rosterNo:          r['roster_no'] as string,
    title:             r['title'] as string,
    siteId:            r['site_id'] as string,
    siteName:          sites.get(r['site_id'] as string) ?? null,
    departmentId:      (r['department_id'] as string | null) ?? null,
    departmentName:    r['department_id'] ? (depts.get(r['department_id'] as string) ?? null) : null,
    periodStart:       r['period_start'] as string,
    periodEnd:         r['period_end'] as string,
    status:            r['status'] as RosterRow['status'],
    rotationPatternId: (r['rotation_pattern_id'] as string | null) ?? null,
    workflowId:        (r['workflow_id'] as string | null) ?? null,
    assignmentCount:   (r['assignment_count'] as number) ?? 0,
    openShiftCount:    (r['open_shift_count'] as number) ?? 0,
    createdBy:         (r['created_by'] as string | null) ?? null,
    createdByName:     r['created_by'] ? (creators.get(r['created_by'] as string) ?? null) : null,
    publishedBy:       (r['published_by'] as string | null) ?? null,
    publishedAt:       (r['published_at'] as string | null) ?? null,
    createdAt:         r['created_at'] as string,
    updatedAt:         r['updated_at'] as string,
  };
}

// ── List rosters ──────────────────────────────────────────────────────────────

export async function listRosters(filters: {
  siteId?: string;
  departmentId?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
} = {}): Promise<RosterRow[]> {
  let q = sb.from('hr_rosters').select('*').order('period_start', { ascending: false }).limit(filters.limit ?? 200);
  if (filters.siteId)       q = q.eq('site_id', filters.siteId);
  if (filters.departmentId) q = q.eq('department_id', filters.departmentId);
  if (filters.status && filters.status !== 'all') q = q.eq('status', filters.status);
  if (filters.from)         q = q.gte('period_start', filters.from);
  if (filters.to)           q = q.lte('period_end', filters.to);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  const rows = (data ?? []) as Record<string, unknown>[];
  return enrichRosterRows(rows);
}

async function enrichRosterRows(rows: Record<string, unknown>[]): Promise<RosterRow[]> {
  if (!rows.length) return [];
  const siteIds    = Array.from(new Set(rows.map(r => r['site_id'] as string).filter(Boolean)));
  const deptIds    = Array.from(new Set(rows.map(r => r['department_id'] as string | null).filter((x): x is string => !!x)));
  const creatorIds = Array.from(new Set(rows.map(r => r['created_by'] as string | null).filter((x): x is string => !!x)));

  const [sitesRes, deptsRes, creatorsRes] = await Promise.all([
    siteIds.length    ? sb.from('project_sites').select('id, name').in('id', siteIds)    : Promise.resolve({ data: [] }),
    deptIds.length    ? sb.from('departments').select('id, name').in('id', deptIds)       : Promise.resolve({ data: [] }),
    creatorIds.length ? sb.from('app_users').select('id, full_name').in('id', creatorIds) : Promise.resolve({ data: [] }),
  ]);

  const sites    = new Map(((sitesRes.data ?? []) as { id: string; name: string }[]).map(x => [x.id, x.name]));
  const depts    = new Map(((deptsRes.data ?? []) as { id: string; name: string }[]).map(x => [x.id, x.name]));
  const creators = new Map(((creatorsRes.data ?? []) as { id: string; full_name: string | null }[]).map(x => [x.id, x.full_name ?? x.id]));

  return rows.map(r => toRosterRow(r, sites, depts, creators));
}

// ── Get roster with assignments ────────────────────────────────────────────────

export async function getRoster(id: string): Promise<RosterDetail | null> {
  const { data: r } = await sb.from('hr_rosters').select('*').eq('id', id).maybeSingle<Record<string, unknown>>();
  if (!r) return null;

  const [rosterRows, { data: asgns }, { data: tmplData }] = await Promise.all([
    enrichRosterRows([r]),
    sb.from('hr_shift_assignments').select('*').eq('roster_id', id).order('work_date').order('employee_id'),
    sb.from('hr_shift_templates').select('id, code, name, colour, starts_at, ends_at, paid_hours'),
  ]);

  const roster = rosterRows[0];
  if (!roster) return null;

  const assignments = (asgns ?? []) as Record<string, unknown>[];
  const templates = new Map(
    ((tmplData ?? []) as { id: string; code: string; name: string; colour: string | null; starts_at: string; ends_at: string; paid_hours: number }[])
      .map(t => [t.id, t])
  );

  // Enrich with employee names
  const empIds = Array.from(new Set(assignments.map(a => a['employee_id'] as string)));
  let empMap = new Map<string, string | null>();
  if (empIds.length) {
    const { data: emps } = await sb.from('app_users').select('id, full_name, department_id').in('id', empIds);
    empMap = new Map(((emps ?? []) as { id: string; full_name: string | null }[]).map(e => [e.id, e.full_name]));
  }

  const mappedAssignments: ShiftAssignment[] = assignments.map(a => {
    const tmplId = a['shift_template_id'] as string | null;
    const tmpl = tmplId ? templates.get(tmplId) ?? null : null;
    return {
      id:              a['id'] as string,
      rosterId:        a['roster_id'] as string,
      employeeId:      a['employee_id'] as string,
      employeeName:    empMap.get(a['employee_id'] as string) ?? null,
      workDate:        a['work_date'] as string,
      shiftTemplateId: tmplId,
      shiftCode:       tmpl?.code ?? null,
      shiftName:       tmpl?.name ?? null,
      shiftColour:     tmpl?.colour ?? null,
      kind:            a['kind'] as ShiftAssignment['kind'],
      hours:           a['hours'] != null ? Number(a['hours']) : null,
      note:            (a['note'] as string | null) ?? null,
      source:          (a['source'] as ShiftAssignment['source']) ?? 'manual',
      createdBy:       (a['created_by'] as string | null) ?? null,
      createdAt:       a['created_at'] as string,
      updatedAt:       a['updated_at'] as string,
    };
  });

  // Employee summary list (for the grid rows)
  const { data: empDetail } = empIds.length
    ? await sb.from('app_users').select('id, full_name, department_id').in('id', empIds)
    : { data: [] };
  const employees = ((empDetail ?? []) as { id: string; full_name: string | null; department_id: string | null }[])
    .map(e => ({ id: e.id, fullName: e.full_name, departmentId: e.department_id }));

  return { roster, assignments: mappedAssignments, employees };
}

// ── Coverage gaps ─────────────────────────────────────────────────────────────
// Compare coverage_requirements against actual assignments for each date in the
// roster's period. Returns rows where assigned < required.

export async function getCoverageGaps(rosterId: string): Promise<CoverageGap[]> {
  const { data: r } = await sb.from('hr_rosters').select('site_id, department_id, period_start, period_end').eq('id', rosterId).maybeSingle<{
    site_id: string; department_id: string | null; period_start: string; period_end: string;
  }>();
  if (!r) throw Object.assign(new Error('Roster not found.'), { status: 404 });

  const [{ data: reqData }, { data: asgData }, { data: tmplData }] = await Promise.all([
    sb.from('hr_coverage_requirements')
      .select('id, site_id, department_id, position_id, shift_template_id, required_headcount, day_of_week')
      .or(`site_id.eq.${r.site_id},site_id.is.null`)
      .eq('is_active', true),
    sb.from('hr_shift_assignments')
      .select('work_date, shift_template_id, kind')
      .eq('roster_id', rosterId)
      .eq('kind', 'shift'),
    sb.from('hr_shift_templates').select('id, code, name'),
  ]);

  const requirements = (reqData ?? []) as {
    id: string; site_id: string | null; department_id: string | null; position_id: string | null;
    shift_template_id: string; required_headcount: number; day_of_week: number | null;
  }[];
  const assignments = (asgData ?? []) as { work_date: string; shift_template_id: string | null; kind: string }[];
  const tmplMap = new Map(((tmplData ?? []) as { id: string; code: string; name: string }[]).map(t => [t.id, t]));

  // Count assignments per date + template
  const assigned = new Map<string, number>();
  for (const a of assignments) {
    if (!a.shift_template_id) continue;
    const key = `${a.work_date}|${a.shift_template_id}`;
    assigned.set(key, (assigned.get(key) ?? 0) + 1);
  }

  // Enumerate dates in period
  const dates: string[] = [];
  const d = new Date(r.period_start + 'T00:00:00Z');
  const end = new Date(r.period_end + 'T00:00:00Z');
  while (d <= end) {
    dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }

  const gaps: CoverageGap[] = [];
  for (const req of requirements) {
    // Filter by dept if the requirement has one
    if (req.department_id && req.department_id !== r.department_id) continue;

    const tmpl = tmplMap.get(req.shift_template_id);
    for (const workDate of dates) {
      // day_of_week: 0=Sun…6=Sat (JS getUTCDay)
      if (req.day_of_week !== null) {
        const dow = new Date(workDate + 'T00:00:00Z').getUTCDay();
        if (dow !== req.day_of_week) continue;
      }
      const key = `${workDate}|${req.shift_template_id}`;
      const cnt = assigned.get(key) ?? 0;
      if (cnt < req.required_headcount) {
        gaps.push({
          workDate,
          shiftTemplateId:  req.shift_template_id,
          shiftCode:        tmpl?.code ?? req.shift_template_id,
          shiftName:        tmpl?.name ?? req.shift_template_id,
          siteId:           req.site_id,
          departmentId:     req.department_id,
          positionId:       req.position_id,
          required:         req.required_headcount,
          assigned:         cnt,
          gap:              req.required_headcount - cnt,
        });
      }
    }
  }

  return gaps.sort((a, b) => a.workDate.localeCompare(b.workDate));
}

// ── My shifts (employee self-view) ────────────────────────────────────────────

export async function getMyShifts(employeeId: string, from: string, to: string): Promise<MyShift[]> {
  const { data: asgns, error } = await sb
    .from('hr_shift_assignments')
    .select('work_date, kind, shift_template_id, hours, note, roster_id')
    .eq('employee_id', employeeId)
    .gte('work_date', from)
    .lte('work_date', to)
    .order('work_date');
  if (error) throw Object.assign(new Error(error.message), { status: 500 });

  const rows = (asgns ?? []) as Record<string, unknown>[];

  // Only return assignments from PUBLISHED rosters
  const rosterIds = Array.from(new Set(rows.map(r => r['roster_id'] as string)));
  let publishedSet = new Set<string>();
  if (rosterIds.length) {
    const { data: rosters } = await sb.from('hr_rosters').select('id, site_id, department_id').in('id', rosterIds).eq('status', 'published');
    const pub = (rosters ?? []) as { id: string; site_id: string; department_id: string | null }[];
    publishedSet = new Set(pub.map(p => p.id));

    const siteIds = Array.from(new Set(pub.map(p => p.site_id)));
    let siteMap = new Map<string, string>();
    let deptMap = new Map<string, string>();
    if (siteIds.length) {
      const [{ data: sites }, { data: depts }] = await Promise.all([
        sb.from('project_sites').select('id, name').in('id', siteIds),
        sb.from('departments').select('id, name'),
      ]);
      siteMap = new Map(((sites ?? []) as { id: string; name: string }[]).map(s => [s.id, s.name]));
      deptMap = new Map(((depts ?? []) as { id: string; name: string }[]).map(d => [d.id, d.name]));
    }

    const tmplIds = Array.from(new Set(rows.map(r => r['shift_template_id'] as string | null).filter((x): x is string => !!x)));
    let tmplMap = new Map<string, { code: string; name: string; starts_at: string; ends_at: string; paid_hours: number }>();
    if (tmplIds.length) {
      const { data: tmpls } = await sb.from('hr_shift_templates').select('id, code, name, starts_at, ends_at, paid_hours').in('id', tmplIds);
      tmplMap = new Map(((tmpls ?? []) as { id: string; code: string; name: string; starts_at: string; ends_at: string; paid_hours: number }[]).map(t => [t.id, t]));
    }

    const rosterMeta = new Map(pub.map(p => [p.id, p]));

    return rows
      .filter(r => publishedSet.has(r['roster_id'] as string))
      .map(r => {
        const tmplId = r['shift_template_id'] as string | null;
        const tmpl = tmplId ? tmplMap.get(tmplId) ?? null : null;
        const rosterId = r['roster_id'] as string;
        const meta = rosterMeta.get(rosterId);
        return {
          workDate:     r['work_date'] as string,
          kind:         r['kind'] as MyShift['kind'],
          shiftCode:    tmpl?.code ?? null,
          shiftName:    tmpl?.name ?? null,
          startsAt:     tmpl?.starts_at ?? null,
          endsAt:       tmpl?.ends_at ?? null,
          paidHours:    tmpl ? Number(tmpl.paid_hours) : null,
          siteId:       meta?.site_id ?? null,
          siteName:     meta ? (siteMap.get(meta.site_id) ?? null) : null,
          departmentId: meta?.department_id ?? null,
          note:         (r['note'] as string | null) ?? null,
        };
      });
  }
  return [];
}

// ── Expected shift (Attendance feed) ─────────────────────────────────────────
// Returns the expected shift for a given employee on a date (from the published
// roster). Returns null if the employee has a day off/leave or no roster.

export async function getExpectedShift(employeeId: string, workDate: string): Promise<{
  kind: string; shiftCode: string | null; startsAt: string | null; endsAt: string | null; paidHours: number | null;
} | null> {
  // Find a published roster that covers this date for the employee's site/dept.
  const { data: emp } = await sb.from('app_users').select('site_id, department_id').eq('id', employeeId).maybeSingle<{ site_id: string | null; department_id: string | null }>();
  if (!emp) return null;

  let rosterQ = sb.from('hr_rosters').select('id').eq('status', 'published').lte('period_start', workDate).gte('period_end', workDate);
  if (emp.site_id) rosterQ = rosterQ.eq('site_id', emp.site_id);

  const { data: rosters } = await rosterQ;
  const rosterIds = ((rosters ?? []) as { id: string }[]).map(r => r.id);
  if (!rosterIds.length) return null;

  const { data: asgn } = await sb.from('hr_shift_assignments')
    .select('kind, shift_template_id, hours')
    .in('roster_id', rosterIds)
    .eq('employee_id', employeeId)
    .eq('work_date', workDate)
    .limit(1)
    .maybeSingle<{ kind: string; shift_template_id: string | null; hours: number | null }>();
  if (!asgn) return null;

  let tmpl = null;
  if (asgn.shift_template_id) {
    const { data: t } = await sb.from('hr_shift_templates').select('code, starts_at, ends_at, paid_hours').eq('id', asgn.shift_template_id).maybeSingle<{ code: string; starts_at: string; ends_at: string; paid_hours: number }>();
    tmpl = t;
  }

  return {
    kind:      asgn.kind,
    shiftCode: tmpl?.code ?? null,
    startsAt:  tmpl?.starts_at ?? null,
    endsAt:    tmpl?.ends_at ?? null,
    paidHours: tmpl ? Number(tmpl.paid_hours) : null,
  };
}
