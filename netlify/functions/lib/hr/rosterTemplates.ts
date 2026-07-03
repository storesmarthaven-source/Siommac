/**
 * netlify/functions/lib/hr/rosterTemplates.ts
 *
 * CRUD for shift templates, rotation patterns, and coverage requirements.
 * These are the configuration objects that rosters and assignments reference.
 * All writes are audited. Reads are unrestricted (within service_role).
 */

import { sb } from '../db';
import { writeHrAudit } from './employeeCore';
import type {
  ShiftTemplate, RotationPattern, CoverageRequirement,
  UpsertShiftTemplateArgs, UpsertRotationPatternArgs, UpsertCoverageRequirementArgs,
} from '../../../../types/hrRoster';

// ── Shift templates ────────────────────────────────────────────────────────────

function toShiftTemplate(r: Record<string, unknown>): ShiftTemplate {
  return {
    id:              r['id'] as string,
    code:            r['code'] as string,
    name:            r['name'] as string,
    startsAt:        r['starts_at'] as string,
    endsAt:          r['ends_at'] as string,
    crossesMidnight: !!r['crosses_midnight'],
    breakMinutes:    (r['break_minutes'] as number) ?? 0,
    paidHours:       Number(r['paid_hours'] ?? 0),
    colour:          (r['colour'] as string | null) ?? null,
    siteId:          (r['site_id'] as string | null) ?? null,
    isActive:        !!r['is_active'],
    createdBy:       (r['created_by'] as string | null) ?? null,
    createdAt:       r['created_at'] as string,
    updatedAt:       r['updated_at'] as string,
  };
}

export async function listShiftTemplates(filters: { siteId?: string; activeOnly?: boolean } = {}): Promise<ShiftTemplate[]> {
  let q = sb.from('hr_shift_templates').select('*').order('name');
  if (filters.activeOnly !== false) q = q.eq('is_active', true);
  if (filters.siteId) q = q.or(`site_id.eq.${filters.siteId},site_id.is.null`);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  return ((data ?? []) as Record<string, unknown>[]).map(toShiftTemplate);
}

export async function getShiftTemplate(id: string): Promise<ShiftTemplate | null> {
  const { data } = await sb.from('hr_shift_templates').select('*').eq('id', id).maybeSingle<Record<string, unknown>>();
  return data ? toShiftTemplate(data) : null;
}

export async function upsertShiftTemplate(actorId: string, args: UpsertShiftTemplateArgs): Promise<ShiftTemplate> {
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    code: args.code.trim().toUpperCase(),
    name: args.name.trim(),
    starts_at: args.startsAt,
    ends_at: args.endsAt,
    crosses_midnight: args.crossesMidnight ?? false,
    break_minutes: args.breakMinutes ?? 0,
    paid_hours: args.paidHours,
    colour: args.colour ?? null,
    site_id: args.siteId ?? null,
    is_active: args.isActive ?? true,
    updated_at: now,
  };

  if (args.id) {
    const prev = await getShiftTemplate(args.id);
    const { data, error } = await sb.from('hr_shift_templates').update(payload).eq('id', args.id).select('*').single<Record<string, unknown>>();
    if (error) throw Object.assign(new Error(error.message), { status: 500 });
    await writeHrAudit({ submoduleKey: 'roster', recordId: args.id, actorId, action: 'hr.roster.template.updated', previousState: prev, newState: args });
    return toShiftTemplate(data);
  } else {
    payload['created_by'] = actorId;
    payload['created_at'] = now;
    const { data, error } = await sb.from('hr_shift_templates').insert(payload).select('*').single<Record<string, unknown>>();
    if (error) throw Object.assign(new Error(error.message), { status: 500 });
    await writeHrAudit({ submoduleKey: 'roster', recordId: data['id'] as string, actorId, action: 'hr.roster.template.created', newState: args });
    return toShiftTemplate(data);
  }
}

export async function removeShiftTemplate(actorId: string, id: string): Promise<void> {
  const prev = await getShiftTemplate(id);
  if (!prev) throw Object.assign(new Error('Shift template not found.'), { status: 404 });
  // Soft-delete: mark inactive rather than hard delete (assignments reference it).
  const { error } = await sb.from('hr_shift_templates').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  await writeHrAudit({ submoduleKey: 'roster', recordId: id, actorId, action: 'hr.roster.template.removed', previousState: prev });
}

// ── Rotation patterns ─────────────────────────────────────────────────────────

function toRotationPattern(r: Record<string, unknown>): RotationPattern {
  return {
    id:        r['id'] as string,
    code:      r['code'] as string,
    name:      r['name'] as string,
    cycleDays: r['cycle_days'] as number,
    pattern:   (r['pattern'] as unknown[]) as RotationPattern['pattern'],
    isActive:  !!r['is_active'],
    createdBy: (r['created_by'] as string | null) ?? null,
    createdAt: r['created_at'] as string,
    updatedAt: r['updated_at'] as string,
  };
}

export async function listRotationPatterns(activeOnly = true): Promise<RotationPattern[]> {
  let q = sb.from('hr_rotation_patterns').select('*').order('name');
  if (activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  return ((data ?? []) as Record<string, unknown>[]).map(toRotationPattern);
}

export async function upsertRotationPattern(actorId: string, args: UpsertRotationPatternArgs): Promise<RotationPattern> {
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    code: args.code.trim().toUpperCase(),
    name: args.name.trim(),
    cycle_days: args.cycleDays,
    pattern: args.pattern,
    is_active: args.isActive ?? true,
    updated_at: now,
  };

  if (args.id) {
    const { data, error } = await sb.from('hr_rotation_patterns').update(payload).eq('id', args.id).select('*').single<Record<string, unknown>>();
    if (error) throw Object.assign(new Error(error.message), { status: 500 });
    await writeHrAudit({ submoduleKey: 'roster', recordId: args.id, actorId, action: 'hr.roster.rotation.updated', newState: args });
    return toRotationPattern(data);
  } else {
    payload['created_by'] = actorId;
    payload['created_at'] = now;
    const { data, error } = await sb.from('hr_rotation_patterns').insert(payload).select('*').single<Record<string, unknown>>();
    if (error) throw Object.assign(new Error(error.message), { status: 500 });
    await writeHrAudit({ submoduleKey: 'roster', recordId: data['id'] as string, actorId, action: 'hr.roster.rotation.created', newState: args });
    return toRotationPattern(data);
  }
}

// ── Coverage requirements ─────────────────────────────────────────────────────

function toCoverageRequirement(r: Record<string, unknown>, templateName?: string | null): CoverageRequirement {
  return {
    id:                r['id'] as string,
    siteId:            (r['site_id'] as string | null) ?? null,
    departmentId:      (r['department_id'] as string | null) ?? null,
    positionId:        (r['position_id'] as string | null) ?? null,
    shiftTemplateId:   r['shift_template_id'] as string,
    shiftTemplateName: templateName ?? null,
    requiredHeadcount: r['required_headcount'] as number,
    dayOfWeek:         (r['day_of_week'] as number | null) ?? null,
    isActive:          !!r['is_active'],
    createdAt:         r['created_at'] as string,
    updatedAt:         r['updated_at'] as string,
  };
}

export async function listCoverageRequirements(filters: { siteId?: string; activeOnly?: boolean } = {}): Promise<CoverageRequirement[]> {
  let q = sb.from('hr_coverage_requirements').select('*').order('created_at');
  if (filters.activeOnly !== false) q = q.eq('is_active', true);
  if (filters.siteId) q = q.eq('site_id', filters.siteId);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  const rows = (data ?? []) as Record<string, unknown>[];

  // Enrich with template names
  const templateIds = Array.from(new Set(rows.map(r => r['shift_template_id'] as string).filter(Boolean)));
  let nameMap = new Map<string, string>();
  if (templateIds.length) {
    const { data: tmpl } = await sb.from('hr_shift_templates').select('id, name').in('id', templateIds);
    nameMap = new Map(((tmpl ?? []) as { id: string; name: string }[]).map(t => [t.id, t.name]));
  }
  return rows.map(r => toCoverageRequirement(r, nameMap.get(r['shift_template_id'] as string) ?? null));
}

export async function upsertCoverageRequirement(actorId: string, args: UpsertCoverageRequirementArgs): Promise<CoverageRequirement> {
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    site_id: args.siteId ?? null,
    department_id: args.departmentId ?? null,
    position_id: args.positionId ?? null,
    shift_template_id: args.shiftTemplateId,
    required_headcount: args.requiredHeadcount,
    day_of_week: args.dayOfWeek ?? null,
    is_active: args.isActive ?? true,
    updated_at: now,
  };

  if (args.id) {
    const { data, error } = await sb.from('hr_coverage_requirements').update(payload).eq('id', args.id).select('*').single<Record<string, unknown>>();
    if (error) throw Object.assign(new Error(error.message), { status: 500 });
    await writeHrAudit({ submoduleKey: 'roster', recordId: args.id, actorId, action: 'hr.roster.coverage_req.updated', newState: args });
    return toCoverageRequirement(data);
  } else {
    payload['created_at'] = now;
    const { data, error } = await sb.from('hr_coverage_requirements').insert(payload).select('*').single<Record<string, unknown>>();
    if (error) throw Object.assign(new Error(error.message), { status: 500 });
    await writeHrAudit({ submoduleKey: 'roster', recordId: data['id'] as string, actorId, action: 'hr.roster.coverage_req.created', newState: args });
    return toCoverageRequirement(data);
  }
}
