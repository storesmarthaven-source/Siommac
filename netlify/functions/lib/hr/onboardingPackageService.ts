// lib/hr/onboardingPackageService.ts — DB-backed onboarding packages (Phase 4).
//
// Replaces the former code constant lib/hr/onboardingPackages.ts (DELETED). Packages
// + their task/handoff templates live in hr_onboarding_packages / _task_templates /
// _handoff_templates. `loadPackagePlan` is the SINGLE instantiation source used by
// startOnboardingCase + preview-package; `listPackageSummaries` powers the wizard
// picker + package manager; `packageLabelMap` resolves labels for the cases list.

import { sb } from '../db';
import type { OnboardingPackageSummary } from '../../../../types/hrOnboarding';

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
      key: p.package_key, label: p.package_name, description: p.description ?? null,
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
