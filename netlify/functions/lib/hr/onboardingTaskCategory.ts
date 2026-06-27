// lib/hr/onboardingTaskCategory.ts — shared onboarding task categoriser.
//
// One source of truth for mapping an onboarding task to a readiness/activation
// category, used by the dashboard/cases queries (readiness %) AND the activation
// gates in the mutations (block ready until a category is complete). Pure function.

export type TaskCategory = 'profile' | 'documents' | 'training' | 'access' | 'payroll' | 'hse' | 'other';

/** Categories the activation gates + readiness card track. */
export const READINESS_CATS: TaskCategory[] = ['profile', 'documents', 'training', 'access'];

export function taskCategory(t: { task_key: string; module_key: string | null; owner_role: string | null }): TaskCategory {
  const k = t.task_key.toLowerCase();
  const m = (t.module_key ?? '').toLowerCase();
  const r = (t.owner_role ?? '').toLowerCase();
  if (m === 'training' || k.includes('training') || k.includes('competen')) return 'training';
  if (m === 'payroll' || k.includes('payroll') || k.includes('statutory') || k.includes('pay_group')) return 'payroll';
  if (m === 'hse' || k.includes('induction') || k.includes('ppe') || k.includes('hse') || k.includes('medical')) return 'hse';
  if (k.includes('document') || k.includes('contract')) return 'documents';
  if (r === 'it' || k.includes('account') || k.includes('access') || k.includes('mfa') || k.includes('equipment')) return 'access';
  if (k.includes('profile') || k.includes('emergency')) return 'profile';
  return 'other';
}
