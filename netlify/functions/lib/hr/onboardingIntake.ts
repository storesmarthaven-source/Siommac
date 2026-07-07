// netlify/functions/lib/hr/onboardingIntake.ts
//
// Start Onboarding wizard — intake preview. One read that aggregates everything the wizard's live
// panels need for a chosen worker + package, from data that already exists (no new tables):
//   • preview      ← loadPackagePlan (tasks + handoffs the package will generate)
//   • verification ← the worker's profile / employment / NIS / contact fields (derived, never set)
//   • documents    ← getComplianceForEmployee (required doc types × the worker's actual docs)
//   • duplicate    ← existing active onboarding case(s) for the worker
import { sb } from '../db';
import { loadPackagePlan } from './onboardingPackageService';
import { getComplianceForEmployee } from './documentsCompliance';
import { listRequirements } from './documentsRequirements';
import { listOnboardingCases } from './onboardingQueries';
import type {
  OnboardingCaseStatus, OnboardingIntakePreview, OnboardingIntakePreviewArgs,
  OnboardingDocumentState,
} from '../../../../types/hrOnboarding';

// A worker already has an in-flight case in any of these states (i.e. not completed/cancelled).
const ACTIVE_CASE_STATUSES: OnboardingCaseStatus[] = ['draft', 'open', 'in_progress', 'blocked', 'paused', 'ready_for_activation'];

export async function getOnboardingIntakePreview(args: OnboardingIntakePreviewArgs): Promise<OnboardingIntakePreview> {
  const { employeeId, packageKey } = args;

  const [empRes, statRes, plan, compliance, dup] = await Promise.all([
    sb.from('app_users')
      .select('id, email, phone, employment_type, department_id')
      .eq('id', employeeId)
      .maybeSingle<{ id: string; email: string | null; phone: string | null; employment_type: string | null; department_id: string | null }>(),
    sb.from('hr_employee_statutory')
      .select('nis_status, nis_number')
      .eq('employee_id', employeeId)
      .maybeSingle<{ nis_status: string | null; nis_number: string | null }>(),
    loadPackagePlan(packageKey),
    // canSeeSensitive: true — the route is HR-gated and we only surface required-type names + a
    // collected/missing flag here, never document contents.
    getComplianceForEmployee(true, employeeId),
    listOnboardingCases({ employeeIds: [employeeId], statuses: ACTIVE_CASE_STATUSES, page: 1, pageSize: 10 }),
  ]);

  const emp = empRes.data;
  const stat = statRes.data;

  // `critical` items gate case launch (right-to-work / a real worker record); the rest are advisory.
  const verification: OnboardingIntakePreview['verification'] = [
    { id: 'profile', label: 'Worker profile exists', status: emp ? 'verified' : 'pending', critical: true },
    { id: 'eligibility', label: 'Right to work verified', status: emp?.employment_type ? 'verified' : 'pending', critical: true },
    { id: 'nis', label: 'NIS number verified', status: stat?.nis_status === 'registered' && stat.nis_number ? 'verified' : 'pending', critical: false },
    { id: 'contact', label: 'Contact information verified', status: emp?.email || emp?.phone ? 'verified' : 'pending', critical: false },
  ];

  // Load the requirement rows so we can surface blocking/waive flags — the compliance
  // rows returned by getComplianceForEmployee don't carry those fields yet. We need the
  // full requirement list to cross-reference by id.
  const allReqs = await listRequirements(true);
  const reqById = new Map(allReqs.map(r => [r.id, r]));

  const items = compliance.map(r => {
    const req = reqById.get(r.requirementId);
    const state = r.state as OnboardingDocumentState;
    const collected = state === 'present_verified' || state === 'present_unverified';
    return {
      requirementId: r.requirementId,
      type: r.requiredType,
      label: r.label,
      state,
      collected,
      isRequired: true, // all items returned by getComplianceForEmployee are required
      isBlocking: req?.blocksOnboarding ?? false,
      canWaive:   req?.canWaive ?? false,
      requiresExpiry: req?.requiresExpiry ?? false,
      existingDocumentId: r.documentId ?? null,
      expiresAt: r.expiryDate ?? null,
    };
  });

  const blockingMissingCount = items.filter(i => i.isBlocking && (i.state === 'missing' || i.state === 'expired')).length;
  const pendingVerificationCount = items.filter(i => i.state === 'present_unverified').length;
  const expiredCount = items.filter(i => i.state === 'expired').length;

  return {
    preview: plan
      ? {
          package: plan.key,
          label: plan.label,
          tasks: plan.tasks.map(t => ({ taskKey: t.taskKey, taskTitle: t.taskTitle, ownerRole: t.ownerRole, moduleKey: t.moduleKey })),
          handoffs: plan.handoffs.map(h => ({ targetModule: h.targetModule, handoffType: h.handoffType })),
          taskCount: plan.tasks.length,
          handoffCount: plan.handoffs.length,
        }
      : null,
    verification,
    documents: {
      items,
      requiredCount: items.length,
      missingCount: items.filter(i => i.state === 'missing' || i.state === 'expired').length,
      blockingMissingCount,
      pendingVerificationCount,
      expiredCount,
    },
    duplicate: {
      hasDuplicate: dup.rows.length > 0,
      checkedAt: new Date().toISOString(),
      cases: dup.rows.map(c => ({ caseId: c.caseId, caseNo: c.caseNo, status: c.status })),
    },
  };
}
