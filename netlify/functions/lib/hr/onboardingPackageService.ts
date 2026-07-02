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
  OnboardingPackageSummary, OnboardingPackageDetail, OnboardingTaskTemplateRow, OnboardingHandoffTemplateRow,
  CreatePackageArgs, UpdatePackageArgs, SetPackageStatusArgs,
  CreateTaskTemplateArgs, UpdateTaskTemplateArgs, CreateHandoffTemplateArgs, UpdateHandoffTemplateArgs,
} from '../../../../types/hrOnboarding';

const err = (status: number, message: string): Error => Object.assign(new Error(message), { status });
const nowISO = (): string => new Date().toISOString();
const isUniqueViolation = (e: unknown): boolean => (e as { code?: string } | null)?.code === '23505';
const slugify = (s: string): string => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'package';

export interface PackageTaskTemplate { taskKey: string; taskTitle: string; ownerRole: string; moduleKey: string | null; isBlocking: boolean; requiresEvidence: boolean; dependencyKeys: string[]; sortOrder: number }
export interface PackageHandoffTemplate { handoffKey: string; targetModule: string; handoffType: string; payloadTemplate: Record<string, unknown> }
export interface PackagePlan { id: string; key: string; label: string; status: string; tasks: PackageTaskTemplate[]; handoffs: PackageHandoffTemplate[] }

interface PkgDB { id: string; package_key: string; package_name: string; status: string }
interface TaskTplDB { task_key: string; task_title: string; owner_role: string; module_key: string | null; is_blocking: boolean | null; requires_evidence: boolean | null; dependency_keys: unknown; sort_order: number }
interface HandoffTplDB { handoff_key: string; target_module: string; handoff_type: string; payload_template: unknown }

const ROLE_LABEL: Record<string, string> = { hr: 'HR', supervisor: 'Supervisor', it: 'IT', hse: 'HSE', training: 'Training', payroll: 'Payroll', security: 'Security', facilities: 'Facilities', finance: 'Finance' };
const asStrArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** The instantiation plan for a package, or null if it doesn't exist / is retired. */
export async function loadPackagePlan(packageKey: string): Promise<PackagePlan | null> {
  const { data: pkg } = await sb.from('hr_onboarding_packages').select('id, package_key, package_name, status').eq('package_key', packageKey).maybeSingle<PkgDB>();
  if (!pkg || pkg.status === 'retired') return null;
  const [{ data: tasks }, { data: handoffs }] = await Promise.all([
    sb.from('hr_onboarding_task_templates').select('task_key, task_title, owner_role, module_key, is_blocking, requires_evidence, dependency_keys, sort_order').eq('package_id', pkg.id).order('sort_order'),
    sb.from('hr_onboarding_handoff_templates').select('handoff_key, target_module, handoff_type, payload_template').eq('package_id', pkg.id).order('sort_order'),
  ]);
  return {
    id: pkg.id, key: pkg.package_key, label: pkg.package_name, status: pkg.status,
    tasks: ((tasks ?? []) as TaskTplDB[]).map(t => ({
      taskKey: t.task_key, taskTitle: t.task_title, ownerRole: t.owner_role, moduleKey: t.module_key ?? null,
      isBlocking: !!t.is_blocking, requiresEvidence: !!t.requires_evidence, dependencyKeys: asStrArr(t.dependency_keys), sortOrder: t.sort_order,
    })),
    handoffs: ((handoffs ?? []) as HandoffTplDB[]).map(h => ({
      handoffKey: h.handoff_key, targetModule: h.target_module, handoffType: h.handoff_type,
      payloadTemplate: (h.payload_template && typeof h.payload_template === 'object' ? h.payload_template : {}) as Record<string, unknown>,
    })),
  };
}

/** Package summaries for the wizard picker + package manager (owners derived from task roles). */
export async function listPackageSummaries(includeRetired = false): Promise<OnboardingPackageSummary[]> {
  let q = sb.from('hr_onboarding_packages').select('id, package_key, package_name, description, status, worker_types, default_sla_days, default_owner_role, version_no').order('package_name');
  if (!includeRetired) q = q.neq('status', 'retired');
  const { data: pkgs } = await q;
  const list = (pkgs ?? []) as { id: string; package_key: string; package_name: string; description: string | null; status: string; worker_types: unknown; default_sla_days: number; default_owner_role: string | null; version_no: number }[];
  if (!list.length) return [];
  const ids = list.map(p => p.id);
  const [{ data: tasks }, { data: handoffs }] = await Promise.all([
    sb.from('hr_onboarding_task_templates').select('package_id, owner_role, sort_order').in('package_id', ids).order('sort_order'),
    sb.from('hr_onboarding_handoff_templates').select('package_id').in('package_id', ids),
  ]);
  const tasksByPkg = new Map<string, string[]>();   // package_id → owner roles in order
  for (const t of (tasks ?? []) as { package_id: string; owner_role: string }[]) { const l = tasksByPkg.get(t.package_id) ?? []; l.push(t.owner_role); tasksByPkg.set(t.package_id, l); }
  const handoffCount = new Map<string, number>();
  for (const h of (handoffs ?? []) as { package_id: string }[]) handoffCount.set(h.package_id, (handoffCount.get(h.package_id) ?? 0) + 1);
  return list.map(p => {
    const roles = tasksByPkg.get(p.id) ?? [];
    const owners: string[] = [];
    for (const r of roles) { const lbl = ROLE_LABEL[r] ?? r; if (!owners.includes(lbl)) owners.push(lbl); }
    return {
      id: p.id, key: p.package_key, label: p.package_name, description: p.description ?? null,
      status: (p.status as OnboardingPackageSummary['status']),
      owners: owners.join(', '), taskCount: roles.length, handoffCount: handoffCount.get(p.id) ?? 0,
      workerTypes: asStrArr(p.worker_types), defaultSlaDays: p.default_sla_days, defaultOwnerRole: p.default_owner_role ?? null, versionNo: p.version_no,
    };
  });
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
  const patch: Record<string, unknown> = { updated_by: actorId, updated_at: nowISO() };
  const set = (k: string, v: unknown) => { if (v !== undefined) patch[k] = v; };
  set('package_name', a.label); set('description', a.description);
  set('worker_types', a.workerTypes); set('default_sla_days', a.defaultSlaDays); set('default_owner_role', a.defaultOwnerRole);
  set('applies_to_departments', a.appliesToDepartments); set('applies_to_sites', a.appliesToSites);
  const { error } = await sb.from('hr_onboarding_packages').update(patch).eq('id', a.id);
  if (error) throw err(500, error.message);
  void emitAppEvent({ eventType: 'onboarding.package.updated', sourceModule: 'hr', sourceEntityType: 'onboarding_package', sourceEntityId: a.id, actorUserId: actorId, severity: 'info', payload: { packageId: a.id } });
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: a.id, actorId, action: 'hr.onboarding.package_updated', newState: patch });
  return { id: a.id };
}

export async function setPackageStatus(actorId: string, a: SetPackageStatusArgs): Promise<{ id: string; status: string }> {
  const { data: pkg } = await sb.from('hr_onboarding_packages').select('id, status, package_key').eq('id', a.id).maybeSingle<{ id: string; status: string; package_key: string }>();
  if (!pkg) throw err(404, 'Onboarding package not found.');
  const { error } = await sb.from('hr_onboarding_packages').update({ status: a.status, updated_by: actorId, updated_at: nowISO() }).eq('id', pkg.id);
  if (error) throw err(500, error.message);
  void emitAppEvent({ eventType: 'onboarding.package.status_changed', sourceModule: 'hr', sourceEntityType: 'onboarding_package', sourceEntityId: pkg.id, actorUserId: actorId, severity: 'info', payload: { packageKey: pkg.package_key, from: pkg.status, to: a.status } });
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: pkg.id, actorId, action: 'hr.onboarding.package_status_changed', previousState: { status: pkg.status }, newState: { status: a.status } });
  return { id: pkg.id, status: a.status };
}

// ── Task templates ────────────────────────────────────────────────────────────--
export async function createTaskTemplate(actorId: string, a: CreateTaskTemplateArgs): Promise<{ id: string }> {
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
  const { error } = await sb.from('hr_onboarding_task_templates').update(patch).eq('id', a.id);
  if (error) throw err(500, error.message);
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: tpl.package_id, actorId, action: 'hr.onboarding.task_template_updated', newState: { id: a.id, ...patch } });
  return { id: a.id };
}

export async function deleteTaskTemplate(actorId: string, a: { id: string }): Promise<{ id: string }> {
  const { data: tpl } = await sb.from('hr_onboarding_task_templates').select('id, package_id, task_key').eq('id', a.id).maybeSingle<{ id: string; package_id: string; task_key: string }>();
  if (!tpl) throw err(404, 'Task template not found.');
  const { error } = await sb.from('hr_onboarding_task_templates').delete().eq('id', a.id);
  if (error) throw err(500, error.message);
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: tpl.package_id, actorId, action: 'hr.onboarding.task_template_deleted', previousState: { taskKey: tpl.task_key } });
  return { id: a.id };
}

// ── Handoff templates ─────────────────────────────────────────────────────────--
export async function createHandoffTemplate(actorId: string, a: CreateHandoffTemplateArgs): Promise<{ id: string }> {
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
  const { error } = await sb.from('hr_onboarding_handoff_templates').update(patch).eq('id', a.id);
  if (error) throw err(500, error.message);
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: tpl.package_id, actorId, action: 'hr.onboarding.handoff_template_updated', newState: { id: a.id, ...patch } });
  return { id: a.id };
}

export async function deleteHandoffTemplate(actorId: string, a: { id: string }): Promise<{ id: string }> {
  const { data: tpl } = await sb.from('hr_onboarding_handoff_templates').select('id, package_id, handoff_key').eq('id', a.id).maybeSingle<{ id: string; package_id: string; handoff_key: string }>();
  if (!tpl) throw err(404, 'Handoff template not found.');
  const { error } = await sb.from('hr_onboarding_handoff_templates').delete().eq('id', a.id);
  if (error) throw err(500, error.message);
  await writeHrAudit({ submoduleKey: 'onboarding', recordId: tpl.package_id, actorId, action: 'hr.onboarding.handoff_template_deleted', previousState: { handoffKey: tpl.handoff_key } });
  return { id: a.id };
}
