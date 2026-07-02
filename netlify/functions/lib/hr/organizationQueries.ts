// lib/hr/organizationQueries.ts — reads for the Organization Structure module.
//
// `departments` is the org-unit tree; `hr_positions` the positions; the shared
// `finance_cost_centers` the cost-centre registry. Names are resolved server-side
// via in-memory maps (small admin datasets) — the frontend consumes the camelCase
// DTOs in types/hrOrganization.ts and builds the tree from the flat list.

import { sb } from '../db';
import type {
  OrgUnit, OrgUnitType, OrgUnitDetail, Position, PositionDetail, CostCenter, OrgStats,
} from '../../../../types/hrOrganization';

interface DeptRow {
  id: string; name: string; code: string | null; description: string | null;
  parent_id: string | null; org_unit_type: string; site_id: string | null;
  manager_id: string | null; cost_center_id: string | null; is_active: boolean;
  sort_order: number | null; updated_at: string | null;
}
interface PosRow {
  id: string; position_key: string; title: string; grade: string | null;
  department_id: string | null; site_id: string | null; default_supervisor_id: string | null;
  reports_to_position_id: string | null; is_safety_critical: boolean; is_active: boolean;
  headcount_budget: number | null; updated_at: string | null;
}
interface CcRow {
  id: string; code: string | null; name: string; currency: string | null;
  annual_budget: number | null; is_active: boolean; manager_id: string | null;
  department_id: string | null; updated_at: string | null;
}
interface UserLite { id: string; full_name: string | null; department_id: string | null; position_id: string | null; supervisor_id: string | null; status: string | null; role: string | null; }

const DEPT_COLS = 'id, name, code, description, parent_id, org_unit_type, site_id, manager_id, cost_center_id, is_active, sort_order, updated_at';
const POS_COLS = 'id, position_key, title, grade, department_id, site_id, default_supervisor_id, reports_to_position_id, is_safety_critical, is_active, headcount_budget, updated_at';
const CC_COLS = 'id, code, name, currency, annual_budget, is_active, manager_id, department_id, updated_at';

/** id → display name for app_users (managers/supervisors). */
async function nameMap(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (!uniq.length) return new Map();
  const { data } = await sb.from('app_users').select('id, full_name').in('id', uniq);
  return new Map(((data ?? []) as { id: string; full_name: string | null }[]).map(u => [u.id, u.full_name ?? u.id]));
}

// ── Org units ──────────────────────────────────────────────────────────────────

export async function listOrgUnits(): Promise<OrgUnit[]> {
  const [{ data: depts }, { data: users }, { data: sites }, { data: ccs }, { data: positions }] = await Promise.all([
    sb.from('departments').select(DEPT_COLS).order('sort_order').order('name'),
    sb.from('app_users').select('id, full_name, department_id'),
    sb.from('project_sites').select('id, name'),
    sb.from('finance_cost_centers').select('id, name'),
    sb.from('hr_positions').select('id, department_id'),
  ]);
  const deptRows = (depts ?? []) as DeptRow[];
  const userRows = (users ?? []) as { id: string; full_name: string | null; department_id: string | null }[];
  const siteMap = new Map(((sites ?? []) as { id: string; name: string }[]).map(s => [s.id, s.name]));
  const ccMap = new Map(((ccs ?? []) as { id: string; name: string }[]).map(c => [c.id, c.name]));
  const managerMap = new Map(userRows.map(u => [u.id, u.full_name ?? u.id]));

  const employeeCounts = new Map<string, number>();
  for (const u of userRows) if (u.department_id) employeeCounts.set(u.department_id, (employeeCounts.get(u.department_id) ?? 0) + 1);
  const positionCounts = new Map<string, number>();
  for (const p of (positions ?? []) as { department_id: string | null }[]) if (p.department_id) positionCounts.set(p.department_id, (positionCounts.get(p.department_id) ?? 0) + 1);
  const childCounts = new Map<string, number>();
  for (const d of deptRows) if (d.parent_id) childCounts.set(d.parent_id, (childCounts.get(d.parent_id) ?? 0) + 1);

  return deptRows.map(d => toOrgUnit(d, { siteMap, ccMap, managerMap, employeeCounts, positionCounts, childCounts }));
}

function toOrgUnit(
  d: DeptRow,
  m: {
    siteMap: Map<string, string>; ccMap: Map<string, string>; managerMap: Map<string, string>;
    employeeCounts: Map<string, number>; positionCounts: Map<string, number>; childCounts: Map<string, number>;
  },
): OrgUnit {
  return {
    id: d.id, name: d.name, code: d.code ?? null, description: d.description ?? null,
    parentId: d.parent_id ?? null, orgUnitType: (d.org_unit_type as OrgUnitType) ?? 'department',
    siteId: d.site_id ?? null, siteName: d.site_id ? (m.siteMap.get(d.site_id) ?? null) : null,
    managerId: d.manager_id ?? null, managerName: d.manager_id ? (m.managerMap.get(d.manager_id) ?? null) : null,
    costCenterId: d.cost_center_id ?? null, costCenterName: d.cost_center_id ? (m.ccMap.get(d.cost_center_id) ?? null) : null,
    isActive: d.is_active !== false, sortOrder: d.sort_order ?? 0,
    employeeCount: m.employeeCounts.get(d.id) ?? 0, positionCount: m.positionCounts.get(d.id) ?? 0,
    childCount: m.childCounts.get(d.id) ?? 0, updatedAt: d.updated_at ?? null,
  };
}

export async function getOrgUnit(unitId: string): Promise<OrgUnitDetail | null> {
  const { data: dept } = await sb.from('departments').select(DEPT_COLS).eq('id', unitId).maybeSingle<DeptRow>();
  if (!dept) return null;

  const [{ data: positions }, { data: employees }, { data: children }] = await Promise.all([
    sb.from('hr_positions').select('id, title').eq('department_id', unitId).order('title'),
    sb.from('app_users').select('id, full_name, position_id').eq('department_id', unitId).order('full_name'),
    sb.from('departments').select('id, name, org_unit_type, is_active').eq('parent_id', unitId).order('name'),
  ]);
  const posRows = (positions ?? []) as { id: string; title: string }[];
  const empRows = (employees ?? []) as { id: string; full_name: string | null; position_id: string | null }[];

  // incumbent counts for this unit's positions + position titles for employees
  const posIds = posRows.map(p => p.id);
  const incumbentCounts = new Map<string, number>();
  if (posIds.length) {
    const { data: inc } = await sb.from('app_users').select('position_id').in('position_id', posIds);
    for (const r of (inc ?? []) as { position_id: string | null }[]) if (r.position_id) incumbentCounts.set(r.position_id, (incumbentCounts.get(r.position_id) ?? 0) + 1);
  }
  const posTitleMap = new Map(posRows.map(p => [p.id, p.title]));

  // resolve names for the base unit
  const base = await listUnitLookups(dept);

  return {
    ...base,
    positions: posRows.map(p => ({ id: p.id, title: p.title, incumbentCount: incumbentCounts.get(p.id) ?? 0 })),
    employees: empRows.map(e => ({ id: e.id, fullName: e.full_name ?? e.id, positionTitle: e.position_id ? (posTitleMap.get(e.position_id) ?? null) : null })),
    children: ((children ?? []) as { id: string; name: string; org_unit_type: string; is_active: boolean }[])
      .map(c => ({ id: c.id, name: c.name, orgUnitType: (c.org_unit_type as OrgUnitType) ?? 'department', isActive: c.is_active !== false })),
  };
}

async function listUnitLookups(d: DeptRow): Promise<OrgUnit> {
  const [{ data: sites }, { data: ccs }] = await Promise.all([
    d.site_id ? sb.from('project_sites').select('id, name').eq('id', d.site_id) : Promise.resolve({ data: [] }),
    d.cost_center_id ? sb.from('finance_cost_centers').select('id, name').eq('id', d.cost_center_id) : Promise.resolve({ data: [] }),
  ]);
  const mgr = await nameMap([d.manager_id]);
  const [{ count: employeeCount }, { count: positionCount }, { count: childCount }] = await Promise.all([
    sb.from('app_users').select('id', { count: 'exact', head: true }).eq('department_id', d.id),
    sb.from('hr_positions').select('id', { count: 'exact', head: true }).eq('department_id', d.id),
    sb.from('departments').select('id', { count: 'exact', head: true }).eq('parent_id', d.id),
  ]);
  const siteName = ((sites ?? []) as { id: string; name: string }[])[0]?.name ?? null;
  const ccName = ((ccs ?? []) as { id: string; name: string }[])[0]?.name ?? null;
  return {
    id: d.id, name: d.name, code: d.code ?? null, description: d.description ?? null,
    parentId: d.parent_id ?? null, orgUnitType: (d.org_unit_type as OrgUnitType) ?? 'department',
    siteId: d.site_id ?? null, siteName,
    managerId: d.manager_id ?? null, managerName: d.manager_id ? (mgr.get(d.manager_id) ?? null) : null,
    costCenterId: d.cost_center_id ?? null, costCenterName: ccName,
    isActive: d.is_active !== false, sortOrder: d.sort_order ?? 0,
    employeeCount: employeeCount ?? 0, positionCount: positionCount ?? 0, childCount: childCount ?? 0,
    updatedAt: d.updated_at ?? null,
  };
}

// ── Positions ──────────────────────────────────────────────────────────────────

export async function listPositions(): Promise<Position[]> {
  const [{ data: positions }, { data: depts }, { data: sites }, { data: incumbents }] = await Promise.all([
    sb.from('hr_positions').select(POS_COLS).order('title'),
    sb.from('departments').select('id, name'),
    sb.from('project_sites').select('id, name'),
    sb.from('app_users').select('position_id'),
  ]);
  const posRows = (positions ?? []) as PosRow[];
  const deptMap = new Map(((depts ?? []) as { id: string; name: string }[]).map(d => [d.id, d.name]));
  const siteMap = new Map(((sites ?? []) as { id: string; name: string }[]).map(s => [s.id, s.name]));
  const titleMap = new Map(posRows.map(p => [p.id, p.title]));
  const supMap = await nameMap(posRows.map(p => p.default_supervisor_id));
  const incumbentCounts = new Map<string, number>();
  for (const r of (incumbents ?? []) as { position_id: string | null }[]) if (r.position_id) incumbentCounts.set(r.position_id, (incumbentCounts.get(r.position_id) ?? 0) + 1);

  return posRows.map(p => toPosition(p, deptMap, siteMap, titleMap, supMap, incumbentCounts.get(p.id) ?? 0));
}

function toPosition(
  p: PosRow, deptMap: Map<string, string>, siteMap: Map<string, string>,
  titleMap: Map<string, string>, supMap: Map<string, string>, incumbentCount: number,
): Position {
  const vacancy = p.headcount_budget == null ? null : p.headcount_budget - incumbentCount;
  return {
    id: p.id, positionKey: p.position_key, title: p.title, grade: p.grade ?? null,
    departmentId: p.department_id ?? null, departmentName: p.department_id ? (deptMap.get(p.department_id) ?? null) : null,
    siteId: p.site_id ?? null, siteName: p.site_id ? (siteMap.get(p.site_id) ?? null) : null,
    defaultSupervisorId: p.default_supervisor_id ?? null, defaultSupervisorName: p.default_supervisor_id ? (supMap.get(p.default_supervisor_id) ?? null) : null,
    reportsToPositionId: p.reports_to_position_id ?? null, reportsToPositionTitle: p.reports_to_position_id ? (titleMap.get(p.reports_to_position_id) ?? null) : null,
    isSafetyCritical: !!p.is_safety_critical, isActive: p.is_active !== false,
    headcountBudget: p.headcount_budget ?? null, incumbentCount, vacancy, updatedAt: p.updated_at ?? null,
  };
}

export async function getPosition(positionId: string): Promise<PositionDetail | null> {
  const { data: pos } = await sb.from('hr_positions').select(POS_COLS).eq('id', positionId).maybeSingle<PosRow>();
  if (!pos) return null;
  const [{ data: depts }, { data: sites }, { data: incumbents }] = await Promise.all([
    sb.from('departments').select('id, name'),
    sb.from('project_sites').select('id, name'),
    sb.from('app_users').select('id, full_name').eq('position_id', positionId).order('full_name'),
  ]);
  const deptMap = new Map(((depts ?? []) as { id: string; name: string }[]).map(d => [d.id, d.name]));
  const siteMap = new Map(((sites ?? []) as { id: string; name: string }[]).map(s => [s.id, s.name]));
  const supMap = await nameMap([pos.default_supervisor_id]);
  let reportsToTitle: string | null = null;
  if (pos.reports_to_position_id) {
    const { data: rt } = await sb.from('hr_positions').select('title').eq('id', pos.reports_to_position_id).maybeSingle<{ title: string }>();
    reportsToTitle = rt?.title ?? null;
  }
  const incRows = (incumbents ?? []) as { id: string; full_name: string | null }[];
  const base = toPosition(pos, deptMap, siteMap, new Map(), supMap, incRows.length);
  base.reportsToPositionTitle = reportsToTitle;
  return { ...base, incumbents: incRows.map(i => ({ id: i.id, fullName: i.full_name ?? i.id })) };
}

// ── Cost centres ───────────────────────────────────────────────────────────────

export async function listCostCenters(): Promise<CostCenter[]> {
  const [{ data: ccs }, { data: depts }] = await Promise.all([
    sb.from('finance_cost_centers').select(CC_COLS).order('name'),
    sb.from('departments').select('cost_center_id'),
  ]);
  const ccRows = (ccs ?? []) as CcRow[];
  const managerMap = await nameMap(ccRows.map(c => c.manager_id));
  const assignedCounts = new Map<string, number>();
  for (const d of (depts ?? []) as { cost_center_id: string | null }[]) if (d.cost_center_id) assignedCounts.set(d.cost_center_id, (assignedCounts.get(d.cost_center_id) ?? 0) + 1);

  return ccRows.map(c => ({
    id: c.id, code: c.code ?? null, name: c.name, currency: c.currency ?? 'TTD',
    annualBudget: c.annual_budget ?? null, isActive: c.is_active !== false,
    managerId: c.manager_id ?? null, managerName: c.manager_id ? (managerMap.get(c.manager_id) ?? null) : null,
    departmentId: c.department_id ?? null, assignedUnitCount: assignedCounts.get(c.id) ?? 0, updatedAt: c.updated_at ?? null,
  }));
}

// ── Stats ──────────────────────────────────────────────────────────────────────

export async function getOrgStats(): Promise<OrgStats> {
  const [{ data: depts }, { data: positions }, { data: ccs }, { data: users }] = await Promise.all([
    sb.from('departments').select('id, is_active, manager_id, cost_center_id'),
    sb.from('hr_positions').select('id, is_active, is_safety_critical, headcount_budget'),
    sb.from('finance_cost_centers').select('id, is_active'),
    sb.from('app_users').select('id, department_id, position_id, supervisor_id, status, role'),
  ]);
  const deptRows = (depts ?? []) as { id: string; is_active: boolean; manager_id: string | null; cost_center_id: string | null }[];
  const posRows = (positions ?? []) as { id: string; is_active: boolean; is_safety_critical: boolean; headcount_budget: number | null }[];
  const ccRows = (ccs ?? []) as { id: string; is_active: boolean }[];
  // Real staff only — exclude the system superadmin (mirrors the HR dashboard KPI convention).
  const staff = ((users ?? []) as UserLite[]).filter(u => u.role !== 'superadmin');

  const incumbentByPos = new Map<string, number>();
  for (const u of staff) if (u.position_id) incumbentByPos.set(u.position_id, (incumbentByPos.get(u.position_id) ?? 0) + 1);

  const positionsOverBudget = posRows.filter(p => p.headcount_budget != null && (incumbentByPos.get(p.id) ?? 0) > p.headcount_budget).length;
  const vacantSafetyCriticalPositions = posRows.filter(p => p.is_active !== false && p.is_safety_critical && (incumbentByPos.get(p.id) ?? 0) === 0).length;
  const budgetedHeadcount = posRows.filter(p => p.is_active !== false).reduce((s, p) => s + (p.headcount_budget ?? 0), 0);

  return {
    unitCount: deptRows.length,
    activeUnitCount: deptRows.filter(d => d.is_active !== false).length,
    positionCount: posRows.length,
    activePositionCount: posRows.filter(p => p.is_active !== false).length,
    filledHeadcount: staff.filter(u => !!u.position_id).length,
    budgetedHeadcount,
    costCenterCount: ccRows.filter(c => c.is_active !== false).length,
    employeesWithoutUnit: staff.filter(u => !u.department_id).length,
    employeesWithoutSupervisor: staff.filter(u => !u.supervisor_id).length,
    employeesWithoutPosition: staff.filter(u => !u.position_id).length,
    departmentsWithoutManager: deptRows.filter(d => d.is_active !== false && !d.manager_id).length,
    departmentsWithoutCostCenter: deptRows.filter(d => d.is_active !== false && !d.cost_center_id).length,
    positionsOverBudget,
    vacantSafetyCriticalPositions,
  };
}
