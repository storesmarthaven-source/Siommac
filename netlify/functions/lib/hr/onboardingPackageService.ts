// lib/hr/onboardingPackageService.ts — DB-backed onboarding packages (Phase 4).
//
// Replaces the former code constant lib/hr/onboardingPackages.ts (DELETED). Packages
// + their task/handoff templates live in hr_onboarding_packages / _task_templates /
// _handoff_templates. `loadPackagePlan` is the SINGLE instantiation source used by
// startOnboardingCase + preview-package; `listPackageSummaries` powers the wizard
// picker + package manager; `packageLabelMap` resolves labels for the cases list.
//
// Package Manager CRUD (createPackage.../deleteHandoffTemplate below) is gated by
// hr.onboarding.packages.manage (oversight-tier, same class as hr.onboarding.case.manage).
// Task/handoff template delete is a REAL delete — neither table has a soft-delete
// column (unlike hr_onboarding_action_templates, which has is_active/retire). This is
// safe because loadPackagePlan only reads templates at case-START time; already-started
// cases own their own hr_onboarding_tasks/_handoffs rows, independent of the template.

import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from './employeeCore';
import type {
  OnboardingPackageSummary, OnboardingPackageDetail, OnboardingPackageMatch, OnboardingTaskTemplateRow, OnboardingHandoffTemplateRow, OnboardingPackageReferenceData,
  CreatePackageArgs, UpdatePackageArgs, SetPackageStatusArgs,
  CreateTaskTemplateArgs, UpdateTaskTemplateArgs, CreateHandoffTemplateArgs, UpdateHandoffTemplateArgs,
} from '../../../../types/hrOnboarding';

const err = (status: number, message: string): Error => Object.assign(new Error(message), { status });
const nowISO = (): string => new Date().toISOString();
const isUniqueViolation = (e: unknown): boolean => (e as { code?: string } | null)?.code === '23505';
const slugify = (s: string): string => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'package';

export async function getPackageReferenceData(): Promise<OnboardingPackageReferenceData> {
  const [documentsResult, trainingResult, workflowsResult] = await Promise.all([
    sb.from('hr_document_requirements')
      .select('id, label, document_type, applies_to_scope, applies_to_value')
      .eq('is_active', true)
      .order('label'),
    sb.from('hse_training_requirements')
      .select('id, competency_id, role_name, site_name, department_name, requirement_level')
      .eq('is_active', true)
      .order('created_at', { ascending: false }),
    sb.from('workflow_templates')
      .select('id, name, module_key, template_key')
      .eq('is_active', true)
      .order('name'),
  ]);
  if (documentsResult.error) throw err(500, documentsResult.error.message);
  if (trainingResult.error) throw err(500, trainingResult.error.message);
  if (workflowsResult.error) throw err(500, workflowsResult.error.message);

  const trainingRows = (trainingResult.data ?? []) as { id: string; competency_id: string; role_name: string | null; site_name: string | null; department_name: string | null; requirement_level: string }[];
  const competencyIds = [...new Set(trainingRows.map(row => row.competency_id))];
  const competencyNames = new Map<string, string>();
  if (competencyIds.length) {
    const { data, error } = await sb.from('hse_training_competencies').select('id, name').in('id', competencyIds);
    if (error) throw err(500, error.message);
    for (const row of (data ?? []) as { id: string; name: string }[]) competencyNames.set(row.id, row.name);
  }

  return {
    documentRequirements: ((documentsResult.data ?? []) as { id: string; label: string; document_type: string; applies_to_scope: string; applies_to_value: string | null }[]).map(row => ({
      id: row.id,
      label: row.label,
      detail: `${row.document_type} · ${row.applies_to_scope}${row.applies_to_value ? `: ${row.applies_to_value}` : ''}`,
    })),
    trainingRequirements: trainingRows.map(row => ({
      id: row.id,
      label: competencyNames.get(row.competency_id) ?? 'Training requirement',
      detail: [row.requirement_level, row.role_name, row.department_name, row.site_name].filter(Boolean).join(' · ') || null,
    })),
    workflowTemplates: ((workflowsResult.data ?? []) as { id: string; name: string; module_key: string; template_key: string }[]).map(row => ({
      id: row.id,
      label: row.name,
      detail: `${row.module_key} · ${row.template_key}`,
    })),
  };
}

async function requireDraftPackageById(packageId: string): Promise<{ id: string; key: string }> {
  const { data, error } = await sb.from('hr_onboarding_packages')
    .select('id, package_key, status')
    .eq('id', packageId)
    .maybeSingle<{ id: string; package_key: string; status: string }>();
  if (error) throw err(500, error.message);
  if (!data) throw err(404, 'Onboarding package not found.');
  if (data.status !== 'draft') throw err(409, 'Published and retired packages are read-only. Create a draft version before changing the package definition.');
  return { id: data.id, key: data.package_key };
}

/**
 * The ONE supported due-rule format: `{ "offsetDays": <integer> }`, counted from the case's
 * target_start_date. Negative is before the start date, positive after, 0 is the day itself.
 * Anything else — an empty object, a missing key, a non-integer — means the item has no
 * deterministic due date and stays Unscheduled. There is deliberately no second format,
 * no anchor other than target_start_date, and no fallback to created_at.
 */
export function dueOffsetDaysFromRule(rule: unknown): number | null {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return null;
  const raw = (rule as Record<string, unknown>)['offsetDays'];
  return typeof raw === 'number' && Number.isInteger(raw) ? raw : null;
}

/**
 * Resolve a parsed offset against the case's planned first day. Returns null — Unscheduled —
 * when either side is absent, because a due date with no anchor would be invented.
 */
export function resolveDueAt(targetStartDate: string | null | undefined, offsetDays: number | null): string | null {
  if (!targetStartDate || offsetDays === null) return null;
  const anchor = new Date(`${targetStartDate.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(anchor.getTime())) return null;
  anchor.setUTCDate(anchor.getUTCDate() + offsetDays);
  return anchor.toISOString();
}

export interface PackageTaskTemplate { taskKey: string; taskTitle: string; ownerRole: string; moduleKey: string | null; isBlocking: boolean; requiresEvidence: boolean; dependencyKeys: string[]; sortOrder: number; dueOffsetDays: number | null }
export interface PackageHandoffTemplate { handoffKey: string; targetModule: string; handoffType: string; payloadTemplate: Record<string, unknown>; dueOffsetDays: number | null }
export interface PackagePlan { id: string; key: string; label: string; status: string; versionNo: number; probationDays: number | null; workerTypes: string[]; tasks: PackageTaskTemplate[]; handoffs: PackageHandoffTemplate[] }

interface PkgDB { id: string; package_key: string; package_name: string; status: string; probation_days: number | null }
interface PkgDBBase { id: string; package_key: string; package_name: string; status: string }
interface TaskTplDB { task_key: string; task_title: string; owner_role: string; module_key: string | null; is_blocking: boolean | null; requires_evidence: boolean | null; dependency_keys: unknown; sort_order: number; due_rule: unknown }
interface HandoffTplDB { handoff_key: string; target_module: string; handoff_type: string; payload_template: unknown; due_rule: unknown }

const ROLE_LABEL: Record<string, string> = { hr: 'HR', supervisor: 'Supervisor', it: 'IT', hse: 'HSE', training: 'Training', payroll: 'Payroll', security: 'Security', facilities: 'Facilities', finance: 'Finance' };
const asStrArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** The instantiation plan for a package, or null if it doesn't exist / is retired. */
export async function loadPackagePlan(packageKey: string): Promise<PackagePlan | null> {
  const { data: pkg } = await sb.from('hr_onboarding_packages').select('id, package_key, package_name, status, version_no, worker_types').eq('package_key', packageKey).maybeSingle<Omit<PkgDB, 'probation_days'> & { version_no: number; worker_types: unknown }>();
  if (!pkg || pkg.status === 'retired') return null;
  const [{ data: tasks }, { data: handoffs }] = await Promise.all([
    sb.from('hr_onboarding_task_templates').select('task_key, task_title, owner_role, module_key, is_blocking, requires_evidence, dependency_keys, sort_order, due_rule').eq('package_id', pkg.id).order('sort_order'),
    sb.from('hr_onboarding_handoff_templates').select('handoff_key, target_module, handoff_type, payload_template, due_rule').eq('package_id', pkg.id).order('sort_order'),
  ]);
  // probation_days is added by a later migration — fetch it separately so loadPackagePlan
  // doesn't break if the column doesn't exist yet in the schema cache.
  // supabase-js returns { data, error } (not a throw) on unknown columns; check error.
  let probationDays: number | null = null;
  { const { data: probRow, error: probErr } = await sb.from('hr_onboarding_packages').select('probation_days').eq('id', pkg.id).maybeSingle<{ probation_days: number | null }>();
    if (!probErr) probationDays = probRow?.probation_days ?? null; }
  return {
    id: pkg.id, key: pkg.package_key, label: pkg.package_name, status: pkg.status, versionNo: pkg.version_no, probationDays, workerTypes: asStrArr(pkg.worker_types),
    tasks: ((tasks ?? []) as TaskTplDB[]).map(t => ({
      taskKey: t.task_key, taskTitle: t.task_title, ownerRole: t.owner_role, moduleKey: t.module_key ?? null,
      isBlocking: !!t.is_blocking, requiresEvidence: !!t.requires_evidence, dependencyKeys: asStrArr(t.dependency_keys), sortOrder: t.sort_order,
      dueOffsetDays: dueOffsetDaysFromRule(t.due_rule),
    })),
    handoffs: ((handoffs ?? []) as HandoffTplDB[]).map(h => ({
      handoffKey: h.handoff_key, targetModule: h.target_module, handoffType: h.handoff_type,
      payloadTemplate: (h.payload_template && typeof h.payload_template === 'object' ? h.payload_template : {}) as Record<string, unknown>,
      dueOffsetDays: dueOffsetDaysFromRule(h.due_rule),
    })),
  };
}

/** Package summaries for the wizard picker + package manager (owners derived from task roles). */
export async function listPackageSummaries(includeRetired = false, employeeId?: string | null): Promise<OnboardingPackageSummary[]> {
  let q = sb.from('hr_onboarding_packages')
    .select('id, package_key, package_name, description, status, worker_types, default_sla_days, default_owner_role, version_no, applies_to_departments, applies_to_sites')
    .order('package_name');
  // A launch picker receives active packages only. Package Manager may explicitly request
  // retired/draft definitions for governance work.
  if (employeeId) q = q.eq('status', 'active');
  else if (!includeRetired) q = q.neq('status', 'retired');
  const { data: pkgs, error: pkgErr } = await q;
  if (pkgErr) throw err(500, pkgErr.message);
  type SummaryDB = {
    id: string; package_key: string; package_name: string; description: string | null; status: string;
    worker_types: unknown; default_sla_days: number; default_owner_role: string | null; version_no: number;
    applies_to_departments: unknown; applies_to_sites: unknown;
  };
  const list = (pkgs ?? []) as SummaryDB[];
  if (!list.length) return [];
  // Fetch probation_days via a separate query so a missing column (pre-migration) returns
  // gracefully (probationDays = null) rather than erroring the whole packages/list endpoint.
  const probationMap = new Map<string, number | null>();
  // probation_days is operator-applied: supabase-js returns an error tuple (not a throw)
  // when the column is missing — check error explicitly and treat as all-null.
  const { data: probRows, error: probErr } = await sb.from('hr_onboarding_packages').select('id, probation_days').in('id', list.map(p => p.id));
  if (!probErr) {
    for (const r of (probRows ?? []) as { id: string; probation_days: number | null }[]) probationMap.set(r.id, r.probation_days ?? null);
  }
  const ids = list.map(p => p.id);
  const [{ data: tasks, error: taskErr }, { data: handoffs, error: handoffErr }] = await Promise.all([
    sb.from('hr_onboarding_task_templates').select('package_id, owner_role, sort_order').in('package_id', ids).order('sort_order'),
    sb.from('hr_onboarding_handoff_templates').select('package_id').in('package_id', ids),
  ]);
  if (taskErr) throw err(500, taskErr.message);
  if (handoffErr) throw err(500, handoffErr.message);
  const tasksByPkg = new Map<string, string[]>();   // package_id → owner roles in order
  for (const t of (tasks ?? []) as { package_id: string; owner_role: string }[]) { const l = tasksByPkg.get(t.package_id) ?? []; l.push(t.owner_role); tasksByPkg.set(t.package_id, l); }
  const handoffCount = new Map<string, number>();
  for (const h of (handoffs ?? []) as { package_id: string }[]) handoffCount.set(h.package_id, (handoffCount.get(h.package_id) ?? 0) + 1);
  let facts: OnboardingPackageMatch['facts'] | null = null;
  if (employeeId) {
    const { data: employee, error: employeeErr } = await sb.from('app_users')
      .select('id, contractor_flag, employment_type, department_id, site_id, position')
      .eq('id', employeeId)
      .maybeSingle<{ id: string; contractor_flag: boolean | null; employment_type: string | null; department_id: string | null; site_id: string | null; position: string | null }>();
    if (employeeErr) throw err(500, employeeErr.message);
    if (!employee) throw err(404, 'Employee not found.');
    const [{ data: department, error: departmentErr }, { data: site, error: siteErr }] = await Promise.all([
      employee.department_id ? sb.from('departments').select('name').eq('id', employee.department_id).maybeSingle<{ name: string | null }>() : Promise.resolve({ data: null, error: null }),
      employee.site_id ? sb.from('project_sites').select('name').eq('id', employee.site_id).maybeSingle<{ name: string | null }>() : Promise.resolve({ data: null, error: null }),
    ]);
    if (departmentErr) throw err(500, departmentErr.message);
    if (siteErr) throw err(500, siteErr.message);
    facts = {
      workerCategory: employee.contractor_flag ? 'contractor' : 'employee',
      employmentType: employee.employment_type ?? null,
      departmentId: employee.department_id ?? null,
      departmentName: department?.name ?? null,
      siteId: employee.site_id ?? null,
      siteName: site?.name ?? null,
      role: employee.position ?? null,
    };
  }

  const summaries = list.map(p => {
    const roles = tasksByPkg.get(p.id) ?? [];
    const owners: string[] = [];
    for (const r of roles) { const lbl = ROLE_LABEL[r] ?? r; if (!owners.includes(lbl)) owners.push(lbl); }
    const workerTypes = asStrArr(p.worker_types);
    const departments = asStrArr(p.applies_to_departments);
    const sites = asStrArr(p.applies_to_sites);
    const allowedWorkerTypes = workerTypes.length ? workerTypes : ['employee'];
    const workerEligible = !facts || allowedWorkerTypes.includes(facts.workerCategory) || (!!facts.employmentType && allowedWorkerTypes.includes(facts.employmentType));
    const departmentEligible = !facts || departments.length === 0 || (!!facts.departmentId && departments.includes(facts.departmentId));
    const siteEligible = !facts || sites.length === 0 || (!!facts.siteId && sites.includes(facts.siteId));
    const eligible = workerEligible && departmentEligible && siteEligible;
    const reasons = facts ? [
      `${facts.workerCategory === 'contractor' ? 'Contractor' : 'Employee'}${facts.employmentType ? ` · ${facts.employmentType}` : ''}`,
      departments.length ? (facts.departmentName ?? 'Department match') : 'All departments',
      sites.length ? (facts.siteName ?? 'Site match') : 'All sites',
      facts.role ?? 'All roles',
    ] : [];
    const match: OnboardingPackageMatch | null = facts ? {
      eligible,
      rank: (workerTypes.length ? 4 : 0) + (departments.length ? 2 : 0) + (sites.length ? 1 : 0),
      reasons,
      facts,
    } : null;
    return {
      id: p.id, key: p.package_key, label: p.package_name, description: p.description ?? null,
      status: (p.status as OnboardingPackageSummary['status']),
      owners: owners.join(', '), taskCount: roles.length, handoffCount: handoffCount.get(p.id) ?? 0,
      workerTypes, defaultSlaDays: p.default_sla_days, defaultOwnerRole: p.default_owner_role ?? null,
      versionNo: p.version_no, probationDays: probationMap.get(p.id) ?? null, match,
    };
  });
  return facts
    ? summaries.filter(p => p.match?.eligible).sort((a, b) => (b.match?.rank ?? 0) - (a.match?.rank ?? 0) || a.label.localeCompare(b.label))
    : summaries;
}

/** The single compatibility authority consumed by intake preview and launch. */
export async function requireCompatiblePackage(employeeId: string, packageKey: string): Promise<OnboardingPackageMatch> {
  const matches = await listPackageSummaries(false, employeeId);
  const found = matches.find(p => p.key === packageKey);
  if (!found?.match?.eligible) {
    throw err(400, 'This package is not active and compatible with the employee’s current Employee Master assignment. Refresh package selection.');
  }
  return found.match;
}

/** key → label for the cases list (avoids per-row package reads). */
export async function packageLabelMap(): Promise<Record<string, string>> {
  const { data } = await sb.from('hr_onboarding_packages').select('package_key, package_name');
  return Object.fromEntries(((data ?? []) as { package_key: string; package_name: string }[]).map(p => [p.package_key, p.package_name]));
}

// ════════════════════════════════════════════════════════════════════════════════
// Package Manager — package CRUD
// ════════════════════════════════════════════════════════════════════════════════

/** Package + its task/handoff templates (ids included) for the Package Detail page. */
export async function getPackageDetail(packageKey: string): Promise<OnboardingPackageDetail | null> {
  const { data: pkg } = await sb.from('hr_onboarding_packages')
    .select('id, package_key, package_name, description, worker_types, default_sla_days, default_owner_role, applies_to_departments, applies_to_sites, status, version_no')
    .eq('package_key', packageKey).maybeSingle<{
      id: string; package_key: string; package_name: string; description: string | null; worker_types: unknown;
      default_sla_days: number; default_owner_role: string | null; applies_to_departments: unknown; applies_to_sites: unknown;
      status: string; version_no: number;
    }>();
  if (!pkg) return null;

  const [{ data: tasks }, { data: handoffs }] = await Promise.all([
    sb.from('hr_onboarding_task_templates')
      .select('id, task_key, task_title, owner_role, module_key, is_blocking, requires_evidence, dependency_keys, sort_order')
      .eq('package_id', pkg.id).order('sort_order'),
    sb.from('hr_onboarding_handoff_templates')
      .select('id, handoff_key, target_module, handoff_type, is_required, sort_order, payload_template')
      .eq('package_id', pkg.id).order('sort_order'),
  ]);

  return {
    id: pkg.id, key: pkg.package_key, label: pkg.package_name, description: pkg.description ?? null,
    workerTypes: asStrArr(pkg.worker_types), defaultSlaDays: pkg.default_sla_days, defaultOwnerRole: pkg.default_owner_role ?? null,
    appliesToDepartments: asStrArr(pkg.applies_to_departments), appliesToSites: asStrArr(pkg.applies_to_sites),
    status: pkg.status as OnboardingPackageDetail['status'], versionNo: pkg.version_no,
    probationDays: await (async () => {
      const { data: r, error: probErr } = await sb.from('hr_onboarding_packages').select('probation_days').eq('id', pkg.id).maybeSingle<{ probation_days: number | null }>();
      return (!probErr && r?.probation_days != null) ? r.probation_days : null;
    })(),
    taskTemplates: ((tasks ?? []) as { id: string; task_key: string; task_title: string; owner_role: string; module_key: string | null; is_blocking: boolean | null; requires_evidence: boolean | null; dependency_keys: unknown; sort_order: number }[]).map(t => ({
      id: t.id, taskKey: t.task_key, taskTitle: t.task_title, ownerRole: t.owner_role, moduleKey: t.module_key ?? null,
      isBlocking: !!t.is_blocking, requiresEvidence: !!t.requires_evidence, dependencyKeys: asStrArr(t.dependency_keys), sortOrder: t.sort_order,
    })) satisfies OnboardingTaskTemplateRow[],
    handoffTemplates: ((handoffs ?? []) as { id: string; handoff_key: string; target_module: string; handoff_type: string; is_required: boolean | null; sort_order: number; payload_template: unknown }[]).map(h => ({
      id: h.id, handoffKey: h.handoff_key, targetModule: h.target_module, handoffType: h.handoff_type,
      isRequired: !!h.is_required, sortOrder: h.sort_order,
      payloadTemplate: (h.payload_template && typeof h.payload_template === 'object' ? h.payload_template : {}) as Record<string, unknown>,
    })) satisfies OnboardingHandoffTemplateRow[],
  };
}

export async function createPackage(actorId: string, a: CreatePackageArgs): Promise<{ id: string; key: string }> {
  const key = slugify(a.label);
  const { data, error } = await sb.from('hr_onboarding_packages').insert({
    package_key: key, package_name: a.label, description: a.description ?? null,
    worker_types: a.workerTypes ?? [], default_sla_days: a.defaultSlaDays ?? 10, default_owner_role: a.defaultOwnerRole ?? null,
    applies_to_departments: a.appliesToDepartments ?? [], applies_to_sites: a.appliesToSites ?? [],
    ...(a.probationDays !== undefined ? { probation_days: a.probationDays } : {}),
    status: 'draft', created_by: actorId,
  }).select('id, package_key').single<{ id: string; package_key: string }>();
  if (error) {
    if (isUniqueViolation(error)) throw err(409, `A package already exists with the key "${key}" — choose a different label.`);
    throw err(500, error.message);
  }
  void emitAppEvent({ eventType: 'onboarding.package.created', sourceModule: 'hr', sourceEntityType: 'onboarding_package', sourceEntityId: data.id, actorUserId: actorId, severity: 'info', payload: { packageKey: data.package_key, label: a.label } });
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: data.id, actorId, action: 'hr.onboarding.package_created', newState: { packageKey: data.package_key, label: a.label } });
  return { id: data.id, key: data.package_key };
}

export async function updatePackage(actorId: string, a: UpdatePackageArgs): Promise<{ id: string }> {
  await requireDraftPackageById(a.id);
  const patch: Record<string, unknown> = { updated_by: actorId, updated_at: nowISO() };
  const set = (k: string, v: unknown) => { if (v !== undefined) patch[k] = v; };
  set('package_name', a.label); set('description', a.description);
  set('worker_types', a.workerTypes); set('default_sla_days', a.defaultSlaDays); set('default_owner_role', a.defaultOwnerRole);
  set('applies_to_departments', a.appliesToDepartments); set('applies_to_sites', a.appliesToSites);
  set('probation_days', a.probationDays);
  const { error } = await sb.from('hr_onboarding_packages').update(patch).eq('id', a.id);
  if (error) throw err(500, error.message);
  void emitAppEvent({ eventType: 'onboarding.package.updated', sourceModule: 'hr', sourceEntityType: 'onboarding_package', sourceEntityId: a.id, actorUserId: actorId, severity: 'info', payload: { packageId: a.id } });
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: a.id, actorId, action: 'hr.onboarding.package_updated', newState: patch });
  return { id: a.id };
}

export async function setPackageStatus(actorId: string, a: SetPackageStatusArgs): Promise<{ id: string; status: string }> {
  const { data: pkg, error: packageError } = await sb.from('hr_onboarding_packages').select('id, status, package_key').eq('id', a.id).maybeSingle<{ id: string; status: string; package_key: string }>();
  if (packageError) throw err(500, packageError.message);
  if (!pkg) throw err(404, 'Onboarding package not found.');
  const allowed = (pkg.status === 'draft' && a.status === 'active') || (pkg.status === 'active' && a.status === 'retired');
  if (!allowed) throw err(409, `Package lifecycle cannot move from ${pkg.status} to ${a.status}.`);
  if (a.status === 'active') {
    const [{ count: taskCount, error: taskError }, { count: handoffCount, error: handoffError }] = await Promise.all([
      sb.from('hr_onboarding_task_templates').select('id', { count: 'exact', head: true }).eq('package_id', pkg.id),
      sb.from('hr_onboarding_handoff_templates').select('id', { count: 'exact', head: true }).eq('package_id', pkg.id),
    ]);
    if (taskError) throw err(500, taskError.message);
    if (handoffError) throw err(500, handoffError.message);
    if (!taskCount) throw err(409, 'Add at least one task before publishing this package.');
    if (!handoffCount) throw err(409, 'Add at least one accountable handoff before publishing this package.');
  }
  const { error } = await sb.from('hr_onboarding_packages').update({ status: a.status, updated_by: actorId, updated_at: nowISO() }).eq('id', pkg.id);
  if (error) throw err(500, error.message);
  void emitAppEvent({ eventType: 'onboarding.package.status_changed', sourceModule: 'hr', sourceEntityType: 'onboarding_package', sourceEntityId: pkg.id, actorUserId: actorId, severity: 'info', payload: { packageKey: pkg.package_key, from: pkg.status, to: a.status } });
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: pkg.id, actorId, action: 'hr.onboarding.package_status_changed', previousState: { status: pkg.status }, newState: { status: a.status } });
  return { id: pkg.id, status: a.status };
}

// ── Task templates ────────────────────────────────────────────────────────────--
export async function createTaskTemplate(actorId: string, a: CreateTaskTemplateArgs): Promise<{ id: string }> {
  await requireDraftPackageById(a.packageId);
  const { data, error } = await sb.from('hr_onboarding_task_templates').insert({
    package_id: a.packageId, task_key: a.taskKey, task_title: a.taskTitle, owner_role: a.ownerRole, module_key: a.moduleKey ?? null,
    is_blocking: a.isBlocking ?? false, requires_evidence: a.requiresEvidence ?? false, dependency_keys: a.dependencyKeys ?? [], sort_order: a.sortOrder ?? 100,
  }).select('id').single<{ id: string }>();
  if (error) {
    if (isUniqueViolation(error)) throw err(409, `A task template with the key "${a.taskKey}" already exists in this package.`);
    throw err(500, error.message);
  }
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: a.packageId, actorId, action: 'hr.onboarding.task_template_created', newState: { taskKey: a.taskKey } });
  return { id: data.id };
}

export async function updateTaskTemplate(actorId: string, a: UpdateTaskTemplateArgs): Promise<{ id: string }> {
  const patch: Record<string, unknown> = {};
  const set = (k: string, v: unknown) => { if (v !== undefined) patch[k] = v; };
  set('task_title', a.taskTitle); set('owner_role', a.ownerRole); set('module_key', a.moduleKey);
  set('is_blocking', a.isBlocking); set('requires_evidence', a.requiresEvidence); set('dependency_keys', a.dependencyKeys); set('sort_order', a.sortOrder);
  const { data: tpl } = await sb.from('hr_onboarding_task_templates').select('id, package_id').eq('id', a.id).maybeSingle<{ id: string; package_id: string }>();
  if (!tpl) throw err(404, 'Task template not found.');
  await requireDraftPackageById(tpl.package_id);
  const { error } = await sb.from('hr_onboarding_task_templates').update(patch).eq('id', a.id);
  if (error) throw err(500, error.message);
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: tpl.package_id, actorId, action: 'hr.onboarding.task_template_updated', newState: { id: a.id, ...patch } });
  return { id: a.id };
}

export async function deleteTaskTemplate(actorId: string, a: { id: string }): Promise<{ id: string }> {
  const { data: tpl } = await sb.from('hr_onboarding_task_templates').select('id, package_id, task_key').eq('id', a.id).maybeSingle<{ id: string; package_id: string; task_key: string }>();
  if (!tpl) throw err(404, 'Task template not found.');
  await requireDraftPackageById(tpl.package_id);
  const { error } = await sb.from('hr_onboarding_task_templates').delete().eq('id', a.id);
  if (error) throw err(500, error.message);
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: tpl.package_id, actorId, action: 'hr.onboarding.task_template_deleted', previousState: { taskKey: tpl.task_key } });
  return { id: a.id };
}

// ── Handoff templates ─────────────────────────────────────────────────────────--
export async function createHandoffTemplate(actorId: string, a: CreateHandoffTemplateArgs): Promise<{ id: string }> {
  await requireDraftPackageById(a.packageId);
  const { data, error } = await sb.from('hr_onboarding_handoff_templates').insert({
    package_id: a.packageId, handoff_key: a.handoffKey, target_module: a.targetModule, handoff_type: a.handoffType,
    is_required: a.isRequired ?? true, sort_order: a.sortOrder ?? 100, payload_template: a.payloadTemplate ?? {},
  }).select('id').single<{ id: string }>();
  if (error) {
    if (isUniqueViolation(error)) throw err(409, `A handoff template with the key "${a.handoffKey}" already exists in this package.`);
    throw err(500, error.message);
  }
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: a.packageId, actorId, action: 'hr.onboarding.handoff_template_created', newState: { handoffKey: a.handoffKey } });
  return { id: data.id };
}

export async function updateHandoffTemplate(actorId: string, a: UpdateHandoffTemplateArgs): Promise<{ id: string }> {
  const patch: Record<string, unknown> = {};
  const set = (k: string, v: unknown) => { if (v !== undefined) patch[k] = v; };
  set('target_module', a.targetModule); set('handoff_type', a.handoffType);
  set('is_required', a.isRequired); set('sort_order', a.sortOrder); set('payload_template', a.payloadTemplate);
  const { data: tpl } = await sb.from('hr_onboarding_handoff_templates').select('id, package_id').eq('id', a.id).maybeSingle<{ id: string; package_id: string }>();
  if (!tpl) throw err(404, 'Handoff template not found.');
  await requireDraftPackageById(tpl.package_id);
  const { error } = await sb.from('hr_onboarding_handoff_templates').update(patch).eq('id', a.id);
  if (error) throw err(500, error.message);
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: tpl.package_id, actorId, action: 'hr.onboarding.handoff_template_updated', newState: { id: a.id, ...patch } });
  return { id: a.id };
}

export async function deleteHandoffTemplate(actorId: string, a: { id: string }): Promise<{ id: string }> {
  const { data: tpl } = await sb.from('hr_onboarding_handoff_templates').select('id, package_id, handoff_key').eq('id', a.id).maybeSingle<{ id: string; package_id: string; handoff_key: string }>();
  if (!tpl) throw err(404, 'Handoff template not found.');
  await requireDraftPackageById(tpl.package_id);
  const { error } = await sb.from('hr_onboarding_handoff_templates').delete().eq('id', a.id);
  if (error) throw err(500, error.message);
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: tpl.package_id, actorId, action: 'hr.onboarding.handoff_template_deleted', previousState: { handoffKey: tpl.handoff_key } });
  return { id: a.id };
}
