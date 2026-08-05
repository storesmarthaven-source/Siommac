/**
 * src/components/sections/HR/StartOnboardingWizard.tsx
 *
 * HR ▸ Onboarding ▸ Start Onboarding — the full-PAGE case-intake wizard (replaces the modal
 * OnboardingWizard). Faithful port of the `start-onboarding` mockup (scoped `.mock-onboarding-start`,
 * StartOnboarding.css), wired end-to-end:
 *   Employee & Timing → Package → Optional Work → Documents → Review & Launch.
 * Live panels (verification · documents · duplicate · task/handoff preview) come from ONE read,
 * `useOnboardingIntakePreview(employeeId, packageKey)`; launch calls `hrOnboardingApi.start`.
 */
import { type JSX, type VNode } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { useQueryClient } from '@tanstack/preact-query';
import { hrOnboardingApi, useOnboardingPackages, useOnboardingActionTemplates, useOnboardingIntakePreview, useOnboardingAccountPreflight, useOnboardingLaunchPreflight } from '@api/hr/onboarding';
import { useHrEmployees, type HrEmployeeRow } from '@api/hr/employees';
import { hrEmployeeKeys } from '@api/queryKeys';
import { toast } from '@store';
import { dialog } from '@lib/dialog';
import { can } from '@lib/permissions';
import { PersonSearchSelect, type PersonSearchOption, EmptyState, Modal, ModalSection } from '@ui';
import { rowName } from './shared';
import { humanize } from './onboardingStatus';
import type { OnboardingDocumentLaunchSelection, OnboardingIntakeDocument, OnboardingLaunchOneOffAction } from '../../../../types/hrOnboarding';
import './StartOnboarding.css';

type IconName =
  | 'arrowLeft' | 'archive' | 'briefcase' | 'calendar' | 'check' | 'chevronRight' | 'clock' | 'copy' | 'documents' | 'file'
  | 'gate' | 'handoff' | 'idCard' | 'launch' | 'lock' | 'package' | 'people' | 'review' | 'save' | 'search'
  | 'shield' | 'task' | 'user' | 'warning';

function Icon({ name, className = '' }: { name: IconName; className?: string }): VNode {
  const paths: Record<IconName, JSX.Element> = {
    arrowLeft: <><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></>,
    archive: <><path d="M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8" /><path d="M1 3h22v5H1z" /><path d="M10 12h4" /></>,
    briefcase: <><path d="M3 8h18v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z" /><path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M3 13h18" /></>,
    calendar: <><path d="M8 2v4" /><path d="M16 2v4" /><path d="M3 10h18" /><path d="M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" /></>,
    check: <path d="m20 6-11 11-5-5" />,
    chevronRight: <path d="m9 18 6-6-6-6" />,
    clock: <><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z" /><path d="M12 6v6l4 2" /></>,
    copy: <><path d="M9 9h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2Z" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
    documents: <><path d="M8 3h8l4 4v14H8V3Z" /><path d="M16 3v5h4" /><path d="M4 7v14h4" /><path d="M11 13h6" /><path d="M11 17h4" /></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /><path d="M9 15h6" /></>,
    gate: <><path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z" /><path d="m9 12 2 2 4-5" /></>,
    handoff: <><path d="M7 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /><path d="M17 21a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /><path d="M11 7h4a2 2 0 0 1 2 2v4" /><path d="m14 10 3 3 3-3" /></>,
    idCard: <><path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" /><path d="M8 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" /><path d="M5 16a4 4 0 0 1 6 0" /><path d="M14 10h5" /><path d="M14 14h4" /></>,
    launch: <><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09Z" /><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2Z" /><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" /><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" /></>,
    lock: <><path d="M6 10V7a6 6 0 0 1 12 0v3" /><path d="M5 10h14v10H5Z" /></>,
    package: <><path d="m21 8-9-5-9 5 9 5 9-5Z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></>,
    people: <><path d="M16 11a4 4 0 1 0-8 0" /><path d="M6 21a6 6 0 0 1 12 0" /><path d="M20 8a3 3 0 0 1 0 6" /><path d="M22 21a5 5 0 0 0-4-5" /></>,
    review: <><path d="M9 11l2 2 4-5" /><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v6h-6" /></>,
    save: <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" /><path d="M17 21v-8H7v8" /><path d="M7 3v5h8" /></>,
    search: <><path d="m21 21-4.3-4.3" /><path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" /></>,
    shield: <><path d="M12 3 5 6v5c0 5 3.4 8.5 7 10 3.6-1.5 7-5 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-5" /></>,
    task: <><path d="M9 6h11" /><path d="M9 12h11" /><path d="M9 18h11" /><path d="m3 6 1 1 2-2" /><path d="m3 12 1 1 2-2" /><path d="m3 18 1 1 2-2" /></>,
    user: <><path d="M20 21a8 8 0 0 0-16 0" /><path d="M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /></>,
    warning: <><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></>,
  };
  return <svg class={`ob-icon ${className}`.trim()} viewBox="0 0 24 24" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

function initialsOf(name: string): string {
  return name ? name.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() : '—';
}

type StepKey = 'worker' | 'package' | 'optional' | 'documents' | 'review';
const STEPS: { no: number; key: StepKey; label: string; description: string; icon: IconName }[] = [
  { no: 1, key: 'worker',    label: 'Employee & Timing', description: 'Select the employee and first day', icon: 'user' },
  { no: 2, key: 'package',   label: 'Package',           description: 'Choose the matched package',       icon: 'package' },
  { no: 3, key: 'optional',  label: 'Optional Work',     description: 'Add non-required work',            icon: 'task' },
  { no: 4, key: 'documents', label: 'Documents',         description: 'Resolve required documents',       icon: 'documents' },
  { no: 5, key: 'review',    label: 'Review & Launch',   description: 'Validate and create the case',      icon: 'review' },
];

const REASONS = ['New hire', 'Rehire', 'Role change', 'Contract conversion', 'Transfer in'];
const PRIORITIES = ['Normal', 'High', 'Urgent'];

export function StartOnboardingWizard(
  { employeeId: preset, onBack }:
  { employeeId?: string | null; onBack: () => void },
): VNode {
  const qc = useQueryClient();
  const canWaiveDocuments = can('hr.onboarding.documents.waive');
  const canCreateOneOff = can('hr.onboarding.custom_actions.create');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [ownerSearch, setOwnerSearch] = useState('');
  const empQ = useHrEmployees({ search: employeeSearch || undefined, limit: 25 });
  const ownerQ = useHrEmployees({ search: ownerSearch || undefined, limit: 25 });
  const employees: HrEmployeeRow[] = useMemo(() => empQ.data ?? [], [empQ.data]);
  const owners: HrEmployeeRow[] = useMemo(() => ownerQ.data ?? [], [ownerQ.data]);
  const [employeeId, setEmployeeId] = useState(preset ?? '');
  const [selectedEmployee, setSelectedEmployee] = useState<HrEmployeeRow | null>(null);
  const [requestId] = useState(() => crypto.randomUUID());
  // Package eligibility and rank are server-owned and evaluated against the selected Employee
  // Master assignment. The browser never invents or widens the compatible package set.
  const { data: packages = [] } = useOnboardingPackages(false, employeeId || null);

  const [step, setStepRaw] = useState<StepKey>('worker');
  // Worker step gets its own validation trigger — set true when the user tries to advance/launch
  // with a required field empty, so each offending input can show an inline error (not just a toast).
  const [triedWorker, setTriedWorker] = useState(false);
  // Which steps the user has actually opened — drives the "complete" checkmark for the pure-info
  // tabs (Tasks/Handoffs/Documents), which have no real form and would otherwise show as done the
  // instant their data loads rather than once the user has actually looked at them.
  const [visitedSteps, setVisitedSteps] = useState<Set<StepKey>>(() => new Set<StepKey>(['worker']));
  function setStep(key: StepKey): void {
    setStepRaw(key);
    setVisitedSteps(prev => (prev.has(key) ? prev : new Set(prev).add(key)));
  }
  const [packageKey, setPackageKey] = useState('');
  const [reason, setReason] = useState('New hire');
  const [priority, setPriority] = useState('Normal');
  const [targetStartDate, setTargetStartDate] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [includedActionIds, setIncludedActionIds] = useState<Set<string>>(new Set());
  const [oneOffActions, setOneOffActions] = useState<OnboardingLaunchOneOffAction[]>([]);
  const [oneOffOpen, setOneOffOpen] = useState(false);
  const [documentSelections, setDocumentSelections] = useState<Record<string, OnboardingDocumentLaunchSelection>>({});
  const [busy, setBusy] = useState(false);
  // Employee Master is authoritative for worker category; the launch wizard never offers
  // a second, conflicting worker-type control.
  const workerType = selectedEmployee?.workerType ?? 'employee';
  const [done, setDone] = useState<{ caseNo: string; taskCount: number } | null>(null);
  const selectedEmp = employees.find(e => e.id === employeeId) ?? selectedEmployee ?? undefined;
  const empName = selectedEmp ? rowName(selectedEmp) : '';
  const pkg = packages.find(p => p.key === packageKey);
  /** Derived probation end date (client-side, mirrors what the backend computes).
   *  Shown read-only in the Review step and the Case Preview card. */
  const probationEndDate: string | null = (() => {
    if (!targetStartDate || !pkg?.probationDays) return null;
    const start = new Date(targetStartDate);
    if (isNaN(start.getTime())) return null;
    start.setDate(start.getDate() + pkg.probationDays);
    return start.toISOString().slice(0, 10); // 'YYYY-MM-DD'
  })();
  // The 4th preview/review "end date" fact adapts to the case type so it always maps to a real
  // input: Employee → package-derived probation; Contractor → contract end; Temporary → assignment end.
  const endFact: { label: string; value: string | null } = { label: 'Probation Ends', value: probationEndDate };
  const { data: actionTemplates = [] } = useOnboardingActionTemplates(packageKey);
  const intakeQ = useOnboardingIntakePreview(employeeId || null, packageKey || null, targetStartDate || null);
  const intake = intakeQ.data;
  const accountPreflightQ = useOnboardingAccountPreflight(employeeId || null, packageKey || null, ownerId || null);
  const accountPreflight = accountPreflightQ.data;
  const launchPayload = useMemo(() => employeeId && packageKey ? ({
    employeeId, packageKey, ownerId: ownerId || null, targetStartDate: targetStartDate || null,
    includeActionTemplateIds: Array.from(includedActionIds), oneOffActions,
    documentSelections: Object.values(documentSelections),
  }) : null, [employeeId, packageKey, ownerId, targetStartDate, includedActionIds, oneOffActions, documentSelections]);
  const launchPreflightQ = useOnboardingLaunchPreflight(launchPayload);
  const launchPreflight = launchPreflightQ.data;

  // The server returns eligible packages in specificity order, so the first option is the honest
  // recommendation. Changing employee clears any selection no longer returned by the server.
  useEffect(() => {
    if (packageKey || !packages.length) return;
    setPackageKey(packages[0]!.key);
  }, [packages, packageKey]);
  useEffect(() => {
    if (packageKey && !packages.some(p => p.key === packageKey)) setPackageKey('');
  }, [packages, packageKey]);
  useEffect(() => {
    if (!selectedEmp) return;
    setSelectedEmployee(selectedEmp);
  }, [selectedEmp]);
  // Optional work is opt-in. Required actions are deliberately absent from this control and
  // are enforced by the launch command even if a client omits them.
  useEffect(() => { setIncludedActionIds(new Set()); setOneOffActions([]); }, [packageKey]);
  function toggleAction(id: string, isRequired: boolean): void {
    if (isRequired) return;
    setIncludedActionIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  const preview = intake?.preview ?? null;
  const verification = intake?.verification ?? [];
  const documents = intake?.documents;
  const duplicate = intake?.duplicate;

  function setDocumentSelection(requirementId: string, sel: OnboardingDocumentLaunchSelection): void {
    setDocumentSelections(prev => ({ ...prev, [requirementId]: sel }));
  }

  // Launch gate (critical verification items) + overall readiness (verification checks + documents
  // collected) — surfaced in the right-rail "Worker Verification" panel, not a wizard step.
  const criticalPending = verification.filter(v => v.critical && v.status !== 'verified');

  const unresolvedDocumentDecisions = (documents?.items ?? []).filter(d =>
    d.state !== 'present_verified' && !documentSelections[d.requirementId]);

  // A blocking document requires verified evidence or an authorised waiver. Requesting
  // it from the worker creates follow-up work but cannot satisfy the launch gate.
  const blockingDocFailures = (documents?.items ?? []).filter(d => {
    if (!d.isBlocking) return false;
    if (d.state === 'present_verified') return false;
    const sel = documentSelections[d.requirementId];
    if (sel?.action === 'waive') return false;
    return true;
  });
  const hasBlockingLaunchFailure = !employeeId || !targetStartDate || !packageKey || criticalPending.length > 0
    || blockingDocFailures.length > 0 || !!duplicate?.hasDuplicate
    || (!!accountPreflight?.required && !accountPreflight.ready)
    || (!!employeeId && !!packageKey && (!launchPreflight || !launchPreflight.ready));

  // Visible pass/fail list on the Review step — every condition `launch()` itself enforces,
  // surfaced so the user can see exactly why the button is disabled before clicking it.
  const launchChecks: { label: string; passed: boolean }[] = [
    { label: 'Worker selected', passed: !!employeeId },
    { label: 'Package selected', passed: !!packageKey },
    { label: 'Target start date set', passed: !!targetStartDate },
    { label: 'Critical verification complete', passed: criticalPending.length === 0 },
    { label: 'No active duplicate case', passed: !duplicate?.hasDuplicate },
    { label: 'Blocking documents resolved', passed: blockingDocFailures.length === 0 },
    { label: 'Account setup policy resolved', passed: !accountPreflight?.required || accountPreflight.ready },
  ];
  const docsTotal = documents?.requiredCount ?? 0;
  const docsCollected = documents ? documents.requiredCount - documents.missingCount : 0;
  // Per-field validity for the Worker step — the required set depends on the case type. Drives both
  // the inline error state on each input (once `triedWorker`) and the step-completion gate.
  const workerFieldErrors = {
    employeeId:        !employeeId,
    targetStartDate:   !targetStartDate,
  };
  const workerDetailsReady = !Object.values(workerFieldErrors).some(Boolean);
  /** Show an inline error on a field only after the user has tried to advance/launch. */
  const fieldErr = (k: keyof typeof workerFieldErrors): boolean => triedWorker && workerFieldErrors[k];

  // Only Worker and Package are real forms/gates — the rest (Tasks/Handoffs/Documents) are
  // pure-info tabs generated from the package with nothing for the user to fill in, so they can't
  // be "done" the moment their data loads. `stepDone` drives whether Continue may advance past a
  // step; `reachableIndex` drives which stepper tabs are clickable — once Package passes, every
  // info tab + Review is reachable (there's no meaningful order to enforce between them).
  const stepDone: Record<StepKey, boolean> = {
    worker: workerDetailsReady,
    package: !!packageKey,
    optional: true,
    documents: unresolvedDocumentDecisions.length === 0,
    review: true,
  };
  const reachableIndex = !stepDone.worker ? 0 : !stepDone.package ? 1 : STEPS.length - 1;
  // The stepper's checkmark reflects real progress on Worker/Package, and "the user has actually
  // opened this tab" for the info-only steps — not "the data happens to be loaded".
  const stepStatus = (key: StepKey): 'active' | 'complete' | 'pending' => {
    if (step === key) return 'active';
    if (key === 'worker') return stepDone.worker ? 'complete' : 'pending';
    if (key === 'package') return stepDone.package ? 'complete' : 'pending';
    if (key === 'review') return 'pending';
    return visitedSteps.has(key) ? 'complete' : 'pending';
  };

  async function launch(): Promise<void> {
    if (!employeeId) { setTriedWorker(true); toast.warning('Select the worker to onboard.'); setStep('worker'); return; }
    if (!targetStartDate) { setTriedWorker(true); toast.warning('Set the target start date.'); setStep('worker'); return; }
    if (!packageKey) { toast.warning('Choose an onboarding package.'); setStep('package'); return; }
    if (criticalPending.length) { toast.warning('Resolve the critical verification items before launching.'); setStep('worker'); return; }
    if (duplicate?.hasDuplicate) { toast.warning('This worker already has an active onboarding case.'); setStep('worker'); return; }
    if (unresolvedDocumentDecisions.length > 0) {
      toast.warning(`Choose what to do with ${unresolvedDocumentDecisions.length} outstanding document requirement(s).`);
      setStep('documents');
      return;
    }
    if (blockingDocFailures.length > 0) {
      toast.warning(`${blockingDocFailures.length} blocking document(s) must be attached or waived before launch.`);
      setStep('documents');
      return;
    }
    if (accountPreflight?.required && !accountPreflight.ready) {
      toast.warning(accountPreflight.blockers[0] ?? 'Resolve the account setup policy before launch.');
      setStep('optional');
      return;
    }
    setBusy(true);
    try {
      const fresh = await launchPreflightQ.refetch();
      if (!fresh.data?.ready) {
        const blocker = fresh.data?.blockers[0];
        if (blocker) setStep(blocker.step);
        toast.warning(blocker?.message ?? 'The launch preflight is not ready.');
        return;
      }
      const r = await hrOnboardingApi.start({ requestId, ...launchPayload!, reason, priority });
      setDone({ caseNo: r.caseNo, taskCount: r.taskCount });
      void qc.invalidateQueries({ queryKey: hrEmployeeKeys.all });
      void qc.invalidateQueries({ queryKey: ['hr', 'onboarding'] });
      toast.success(`Onboarding started — ${r.caseNo} (${r.taskCount} tasks)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }

  const stepIndex = STEPS.findIndex(s => s.key === step);
  const goNext = (): void => {
    // On the Worker step, a Continue click with missing required fields flips on inline errors
    // instead of silently doing nothing (the button stays enabled so the user gets feedback).
    if (step === 'worker' && !workerDetailsReady) {
      setTriedWorker(true);
      toast.warning('Complete the required worker details before continuing.');
      return;
    }
    const n = STEPS[stepIndex + 1]; if (n) setStep(n.key);
  };
  const goPrev = (): void => { const p = STEPS[stepIndex - 1]; if (p) setStep(p.key); };

  const summaryMetrics = [
    { id: 'tasks', label: 'Tasks', value: preview ? String(preview.taskCount) : '—', icon: 'task' as IconName },
    { id: 'documents', label: 'Documents', value: documents ? String(documents.requiredCount) : '—', icon: 'documents' as IconName },
    { id: 'handoffs', label: 'Handoffs', value: preview ? String(preview.handoffCount) : '—', icon: 'handoff' as IconName },
    { id: 'duration', label: 'Estimated Duration', value: pkg ? `${pkg.defaultSlaDays} days` : '—', icon: 'clock' as IconName },
  ];

  return (
    <div class="mock-onboarding-start">
      <div class="ob-title-row">
        <div class="ob-title-copy">
          <h1>Start Onboarding</h1>
          <p>Create a new onboarding case and launch the worker successfully.</p>
        </div>
        <div class="ob-page-actions" aria-label="Page actions">
          <button class="ob-action-button ob-action-button-ghost" type="button" onClick={onBack}>
            <Icon name="arrowLeft" />Back to Board
          </button>
        </div>
      </div>

      {done && <div class="ob-banner ob-banner-success">Onboarding case <strong>{done.caseNo}</strong> created with {done.taskCount} tasks. <button class="ob-link-button" type="button" onClick={onBack}>Back to board</button></div>}

      {/* ── horizontal step nav ── */}
      <nav class="ob-stepper" aria-label="Onboarding steps">
        {STEPS.map((s, i) => {
          const status = stepStatus(s.key);
          const reachable = i <= reachableIndex;
          return (
            <button
              class={`ob-stepper-step is-${status}${reachable ? '' : ' is-locked'}`}
              type="button" key={s.key}
              disabled={!reachable}
              onClick={() => setStep(s.key)}
              aria-current={status === 'active' ? 'step' : undefined}
              title={reachable ? undefined : 'Complete the previous steps first'}
            >
              <span class="ob-stepper-marker">{status === 'complete' ? <Icon name="check" /> : s.no}</span>
              <span class="ob-stepper-copy"><strong>{s.label}</strong><span>{s.description}</span></span>
            </button>
          );
        })}
      </nav>

      <div class="ob-page-grid">
        {/* ── left: the current step's workspace ── */}
        <main class="ob-workspace-card">
          <section class="ob-worker-section">
            <div class="ob-step-indicator-row">
              <div class="ob-step-progress">
                <span class="ob-step-progress-track"><span class="ob-step-progress-fill" style={`width:${((stepIndex + 1) / STEPS.length) * 100}%`} /></span>
                <span class="ob-step-progress-text"><strong>Step {stepIndex + 1} of {STEPS.length}</strong> — {STEPS[stepIndex]?.label}</span>
              </div>
            </div>

            <div class="ob-step-panel" key={step}>
            {step === 'worker' && (
              <>
                <StepHeader icon="user" title="Employee & Timing" desc="Choose an existing Employee Master record, confirm ownership, and set the employee's first day." />

                <div class="ob-worker-form-grid">
                  <label class={`ob-field${fieldErr('employeeId') ? ' is-error' : ''}`}>
                    <span class="ob-field-label">Search Worker<span class="ob-required">*</span></span>
                    <WorkerSearchField
                      employees={employees} value={employeeId} onChange={setEmployeeId}
                      onSearch={setEmployeeSearch} loading={empQ.isFetching}
                      error={empQ.error instanceof Error ? empQ.error.message : null}
                    />
                    {fieldErr('employeeId') ? <span class="ob-field-error">Select a worker</span> : null}
                  </label>
                  {/* Employee-record read-only context — only the fields relevant to the case type.
                      Employee shows the full record; Contractor shows just Site; Temporary shows
                      Department/Site/Manager (its worker-record context), then its own block below. */}
                  {workerType === 'employee' && <Fld label="Worker ID" value={selectedEmp?.employee_number ?? '—'} readOnly />}
                  {workerType === 'employee' && <Fld label="Email" value={selectedEmp?.email ?? selectedEmp?.personal_email ?? '—'} readOnly />}
                  {workerType !== 'contractor' && <Fld label="Department" value={selectedEmp?.departmentName ?? '—'} readOnly />}
                  {workerType === 'employee' && <Fld label="Job Title" value={selectedEmp?.position ?? '—'} readOnly />}
                  <Fld label="Site / Location" value={selectedEmp?.siteName ?? '—'} readOnly />
                  {workerType !== 'contractor' && <Fld label="Manager / Supervisor" value={selectedEmp?.supervisorName ?? '—'} readOnly />}
                  <Fld label="Worker Category" value={humanize(workerType)} readOnly />
                  <Fld label="Employment Type" value={selectedEmp?.employment_type ? humanize(selectedEmp.employment_type) : '—'} readOnly />
                  <SelFld label="Onboarding Reason" value={reason} options={REASONS} onInput={setReason} />
                  <SelFld label="Priority" value={priority} options={PRIORITIES} onInput={setPriority} />
                  <label class="ob-field">
                    <span class="ob-field-label">Case Owner</span>
                    <PersonSearchSelect
                      options={owners.map(e => ({ id: e.id, name: rowName(e), subtitle: [e.employee_number, e.position, e.departmentName].filter(Boolean).join(' · '), photoUrl: e.profile_image_url }))}
                      value={ownerId} onChange={setOwnerId} onSearch={setOwnerSearch}
                      loading={ownerQ.isFetching} error={ownerQ.error instanceof Error ? ownerQ.error.message : null}
                      minimumQueryLength={2} placeholder="Search an accountable owner…" emptyLabel="No eligible owner found"
                    />
                    {!ownerId ? <small class="ob-field-hint">Leave empty to assign the signed-in HR coordinator.</small> : null}
                  </label>
                  <DateFld label="Target Start Date" value={targetStartDate} onInput={setTargetStartDate} required error={fieldErr('targetStartDate')} />
                </div>

              </>
            )}

            {step === 'package' && (
              <>
                <StepHeader icon="package" title="Onboarding Package" desc="Sets the tasks, owners, handoffs & documents for this case." />
                <p class="ob-package-filter-note">Matched from the selected employee's worker category, employment type, department, site and role.</p>
                {packages.length === 0
                  ? (
                    <div class="ob-empty-package-state">
                      <span class="ob-empty-package-icon"><Icon name="package" /></span>
                      <strong>No packages available for {humanize(workerType)}</strong>
                      <p>Create or activate an onboarding package that supports this case type in Package Manager before launching.</p>
                    </div>
                  )
                  : (
                    <div class="ob-package-grid">
                    {packages.map((p, packageIndex) => (
                      <button class={`ob-package-card ${packageKey === p.key ? 'is-selected' : ''}`} type="button" key={p.key} onClick={() => setPackageKey(p.key)}>
                        {packageIndex === 0 ? <span class="ob-recommended-badge">Recommended</span> : null}
                        <div class="ob-package-card-head">
                          <span class="ob-package-card-icon"><Icon name="package" /></span>
                          <div class="ob-package-card-title"><h3>{p.label}</h3><p>{p.description ?? p.owners}</p></div>
                          <span class="ob-package-card-radio" aria-hidden="true">{packageKey === p.key ? <Icon name="check" /> : null}</span>
                        </div>
                        <div class="ob-package-stats">
                          <div class="ob-package-stat"><strong>{p.taskCount}</strong><small>Tasks</small></div>
                          <div class="ob-package-stat"><strong>{p.handoffCount}</strong><small>Handoffs</small></div>
                          <div class="ob-package-stat"><strong>{p.defaultSlaDays}d</strong><small>Duration</small></div>
                        </div>
                        <div class="ob-package-tags">
                          <span class="ob-package-tag">Version {p.versionNo}</span>
                          {(p.match?.reasons ?? []).map(reasonText => <span class="ob-package-tag" key={reasonText}>{reasonText}</span>)}
                        </div>
                      </button>
                    ))}
                    </div>
                  )}
                <div class="ob-subsection">
                  <div class="ob-subsection-head"><span class="ob-subsection-icon"><Icon name="archive" /></span><h3>What SIOMAC Will Create</h3></div>
                  <div class="ob-doc-summary">
                    <span class="ob-doc-summary-chip"><strong>{preview?.taskCount ?? 0}</strong> Required Tasks</span>
                    <span class="ob-doc-summary-chip"><strong>{preview?.handoffCount ?? 0}</strong> Team Handoffs</span>
                    <span class="ob-doc-summary-chip"><strong>{documents?.requiredCount ?? 0}</strong> Documents</span>
                    <span class="ob-doc-summary-chip"><strong>{pkg?.defaultSlaDays ?? 0}</strong> Day Plan</span>
                  </div>
                </div>
              </>
            )}

            {step === 'optional' && (
              <>
                <StepHeader icon="task" title="Optional Work" desc="Required package work is locked. Add only the extra actions needed for this employee." />
                <div class="ob-subsection">
                  <div class="ob-subsection-head"><span class="ob-subsection-icon"><Icon name="gate" /></span><h3>Available Add-ons</h3><span>{includedActionIds.size + oneOffActions.length} selected</span></div>
                  {actionTemplates.filter(t => !t.isRequired).length === 0
                    ? <p class="ob-flow-note-plain">This package has no optional work. Continue to documents.</p>
                    : <div class="ob-action-list">
                        {actionTemplates.filter(t => !t.isRequired).map(t => (
                          <label class={`ob-action-row ${includedActionIds.has(t.id) ? 'is-on' : ''}`} key={t.id}>
                            <input type="checkbox" checked={includedActionIds.has(t.id)} onChange={() => toggleAction(t.id, false)} />
                            <span class="ob-action-copy"><strong>{t.actionName}</strong><small>{humanize(t.actionType)} · {humanize(t.ownerType)}{t.ownerRole ? ` (${t.ownerRole})` : ''}</small></span>
                            {t.blocksOnboarding ? <span class="ob-tag ob-tag-warn">Blocking</span> : null}
                          </label>
                        ))}
                      </div>}
                  {canCreateOneOff ? <button class="ob-action-button ob-action-button-ghost" type="button" onClick={() => setOneOffOpen(true)}><Icon name="task" />Create One-Off Action</button> : null}
                  {oneOffActions.map((action, index) => (
                    <div class="ob-action-row is-on" key={`${action.actionName}-${index}`}>
                      <span class="ob-action-copy"><strong>{action.actionName}</strong><small>{humanize(action.actionType)} · {humanize(action.ownerRole ?? 'queue')}</small></span>
                      <button type="button" class="ob-link-button" onClick={() => setOneOffActions(current => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
                    </div>
                  ))}
                </div>
                {accountPreflight?.required ? (
                  <div class="ob-subsection">
                    <div class="ob-subsection-head">
                      <span class="ob-subsection-icon"><Icon name="lock" /></span>
                      <h3>Account Setup Policy</h3>
                      <span class={`ob-tag ${accountPreflight.ready ? 'ob-tag-ok' : 'ob-tag-warn'}`}>{accountPreflight.ready ? 'Policy resolved' : 'Configuration required'}</span>
                    </div>
                    <div class="ob-review-list">
                      <div class="ob-review-row"><span>Operating model</span><strong>HR managed</strong></div>
                      <div class="ob-review-row"><span>Owning team</span><strong>{accountPreflight.owningTeam.label}</strong></div>
                      <div class="ob-review-row"><span>Accountable person</span><strong>{accountPreflight.accountablePerson?.name ?? 'Assigned case owner after launch'}</strong></div>
                      <div class="ob-review-row"><span>Access profile</span><strong>{accountPreflight.accessProfile}</strong></div>
                      <div class="ob-review-row"><span>Proposed work email</span><strong>{accountPreflight.proposedWorkEmail ?? 'Not configured'}</strong></div>
                      <div class="ob-review-row"><span>Invitation</span><strong>After account handoff</strong></div>
                    </div>
                    {accountPreflight.blockers.map(blocker => <p class="ob-flow-note-plain" key={blocker}>{blocker}</p>)}
                  </div>
                ) : null}
              </>
            )}

            {step === 'documents' && (
              <>
                <StepHeader
                  icon="documents"
                  title="Required Documents"
                  desc="Resolve each required document — attach one already on file, request it from the worker, or waive it where allowed."
                />
                {documents && documents.items.length > 0 && (
                  <div class="ob-doc-summary">
                    <span class="ob-doc-summary-chip"><strong>{documents.requiredCount}</strong> Required</span>
                    <span class={`ob-doc-summary-chip ${documents.missingCount ? 'is-warn' : 'is-ok'}`}><strong>{documents.missingCount}</strong> Outstanding</span>
                    <span class={`ob-doc-summary-chip ${documents.blockingMissingCount ? 'is-danger' : 'is-ok'}`}><strong>{documents.blockingMissingCount}</strong> Blocking</span>
                  </div>
                )}
                {(documents?.items.length ?? 0) === 0 && (
                  <div class="ob-flow-empty"><Icon name="documents" /><span>{employeeId ? 'No document requirements apply to this worker.' : 'Select a worker to resolve required documents.'}</span></div>
                )}
                <div class="ob-doc-req-list">
                  {(documents?.items ?? []).map(d => (
                    <DocumentRequirementCard
                      key={d.requirementId}
                      doc={d}
                      canWaive={canWaiveDocuments}
                      selection={documentSelections[d.requirementId] ?? null}
                      onSelect={(sel) => setDocumentSelection(d.requirementId, sel)}
                    />
                  ))}
                </div>
                {blockingDocFailures.length > 0 && (
                  <div class="ob-doc-blocking-alert">
                    <Icon name="warning" />
                    <span><strong>{blockingDocFailures.length} blocking document{blockingDocFailures.length === 1 ? '' : 's'}</strong> must be attached or waived before launch.</span>
                  </div>
                )}
              </>
            )}

            {step === 'review' && (
              <>
                <StepHeader icon="review" title="Review & Launch" desc="Creates the onboarding case, its tasks, the handoff intents, and any included custom actions." />
                <div class="ob-subsection">
                  <div class={`ob-doc-blocking-alert ${launchPreflight?.ready ? 'is-ready' : ''}`}>
                    <Icon name={launchPreflight?.ready ? 'check' : 'warning'} />
                    <span><strong>{launchPreflightQ.isFetching ? 'Validating launch' : launchPreflight?.ready ? 'Ready to launch' : 'Launch blocked'}</strong>{launchPreflight?.blockers[0] ? ` — ${launchPreflight.blockers[0].message}` : ''}</span>
                  </div>
                  <div class="ob-subsection-head"><span class="ob-subsection-icon"><Icon name="idCard" /></span><h3>Case Summary</h3></div>
                  <div class="ob-review-list">
                    <div class="ob-review-row"><span>Worker</span><strong>{empName || '—'}</strong></div>
                    <div class="ob-review-row"><span>Case Type</span><strong>{humanize(workerType)}</strong></div>
                    <div class="ob-review-row"><span>Reason · Priority</span><strong>{reason} · {priority}</strong></div>
                    <div class="ob-review-row"><span>Package</span><strong>{pkg?.label ?? '—'}</strong></div>
                    <div class="ob-review-row"><span>Tasks · Handoffs</span><strong>{launchPreflight ? `${launchPreflight.counts.tasks} · ${launchPreflight.counts.handoffs}` : '—'}</strong></div>
                    <div class="ob-review-row"><span>Optional work</span><strong>{includedActionIds.size} package add-ons · {oneOffActions.length} one-off</strong></div>
                    <div class="ob-review-row"><span>Documents outstanding</span><strong>{documents ? documents.missingCount : '—'}</strong></div>
                    <div class="ob-review-row"><span>{endFact.label}</span><strong>{endFact.value ?? '—'}</strong></div>
                    <div class="ob-review-row"><span>Launch</span><strong>Immediately after confirmation</strong></div>
                  </div>
                </div>

                <div class="ob-subsection">
                  <div class="ob-subsection-head"><span class="ob-subsection-icon"><Icon name="gate" /></span><h3>Launch Readiness</h3><span class={`ob-launch-tally ${hasBlockingLaunchFailure ? 'is-fail' : 'is-pass'}`}>{launchChecks.filter(c => c.passed).length}/{launchChecks.length}</span></div>
                  <div class="ob-launch-checklist">
                    {launchChecks.map(chk => (
                      <div class={`ob-launch-check ${chk.passed ? 'is-pass' : 'is-fail'}`} key={chk.label}>
                        <span class="ob-launch-check-mark"><Icon name={chk.passed ? 'check' : 'warning'} /></span>
                        <span>{chk.label}</span>
                        <strong>{chk.passed ? 'Passed' : 'Blocking'}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
            </div>

            <div class="ob-step-nav">
              <button class="ob-action-button ob-action-button-ghost" type="button" disabled={stepIndex === 0} onClick={goPrev}><Icon name="arrowLeft" />Back</button>
              {step === 'review'
                ? <button class="ob-action-button ob-action-button-primary" type="button" disabled={busy || !!done || hasBlockingLaunchFailure} onClick={() => void launch()}><Icon name="launch" />{busy ? 'Launching…' : 'Launch Case'}</button>
                : <button class="ob-action-button ob-action-button-secondary" type="button" disabled={step !== 'worker' && !stepDone[step]} onClick={goNext}>Continue<Icon name="chevronRight" /></button>}
            </div>
          </section>
        </main>

        {/* ── right: status rail ── */}
        <aside class="ob-side-stack" aria-label="Onboarding case status">
          <section class="ob-preview-card ob-preview-ring-card">
            <div class="ob-preview-kicker"><Icon name="idCard" />Case Preview</div>
            <div class="ob-ring-hero ob-profile-hero">
              <div class="ob-ring-access-row">
                <div class="ob-ring-wrap">
                  <span class="ob-ring-photo">
                    {selectedEmp?.profile_image_url
                      ? <img src={selectedEmp.profile_image_url} alt="" />
                      : empName
                        ? initialsOf(empName)
                        : <Icon name="user" />}
                  </span>
                </div>
                <div class="ob-ring-access-copy">
                  <strong>{empName || 'No worker selected'}</strong>
                  {employeeId
                    ? <span class="ob-ring-role-tag"><Icon name="briefcase" />{selectedEmp?.position ?? humanize(workerType)}</span>
                    : <small>Select a worker to preview</small>}
                </div>
              </div>
            </div>
            <div class="ob-preview-facts">
              <div class="ob-preview-fact ob-preview-fact-package">
                <span class="ob-preview-fact-disc"><Icon name="package" /></span>
                <small>Package</small>
                <strong>{pkg?.label ?? '—'}</strong>
              </div>
              <div class={`ob-preview-fact ob-preview-fact-documents ${documents && docsTotal > 0 && docsCollected === docsTotal ? 'is-complete' : ''}`}>
                <span class="ob-preview-fact-disc"><Icon name="documents" /></span>
                <small>Documents</small>
                <strong>{documents ? `${docsCollected}/${docsTotal}` : '—'}</strong>
              </div>
              <div class="ob-preview-fact ob-preview-fact-date">
                <span class="ob-preview-fact-disc"><Icon name="calendar" /></span>
                <small>Start Date</small>
                <strong>{targetStartDate || '—'}</strong>
              </div>
              <div class="ob-preview-fact ob-preview-fact-probation">
                <span class="ob-preview-fact-disc"><Icon name="clock" /></span>
                <small>{endFact.label}</small>
                <strong>{endFact.value ?? '—'}</strong>
              </div>
            </div>
          </section>

          <section class="ob-railverify-card">
            <div class="ob-railverify-head">
              <StepHeader icon="shield" title="Worker Verification" />
              {employeeId ? <span class={`ob-railverify-count ${criticalPending.length ? 'is-warn' : 'is-ok'}`}>{verification.filter(v => v.status === 'verified').length}/{verification.length}</span> : null}
            </div>
            {!employeeId
              ? <EmptyState icon="fa-user-shield" title="No worker selected" text="Select a worker to run verification checks." tone="gray" />
              : (
                <div class="ob-railverify-list">
                  {verification.map(v => (
                    <div class={`ob-railverify-item is-${v.status}`} key={v.id}>
                      <span class="ob-railverify-dot"><Icon name={v.status === 'verified' ? 'check' : 'warning'} /></span>
                      <span class="ob-railverify-name">{v.label}</span>
                      {v.critical && v.status !== 'verified' ? <span class="ob-railverify-req">Required</span> : null}
                    </div>
                  ))}
                </div>
              )}
          </section>

          <section class="ob-duplicate-card">
            <StepHeader icon="copy" title="Duplicate Check" />
            {!employeeId
              ? <EmptyState icon="fa-clone" title="No worker selected" text="Select a worker to check for duplicates." tone="gray" />
              : duplicate?.hasDuplicate
                ? (
                  <EmptyState
                    icon="fa-triangle-exclamation"
                    title={`${duplicate.cases.length} active case${duplicate.cases.length === 1 ? '' : 's'} found`}
                    text={`${duplicate.cases.map(c => c.caseNo).join(', ')} — this worker already has onboarding in progress.`}
                    tone="amber"
                  />
                )
                : <EmptyState icon="fa-circle-check" title="No duplicates found" text="This worker has no active onboarding cases." tone="green" />}
          </section>

          <section class="ob-documents-card">
            <div class="ob-section-header-row">
              <StepHeader icon="documents" title={`Required Documents (${documents?.requiredCount ?? 0})`} />
              <button class="ob-link-button" type="button" onClick={() => setStep('documents')}>View all</button>
            </div>
            <div class="ob-document-list">
              {(documents?.items ?? []).slice(0, 4).map(d => (
                <div class="ob-document-row" key={d.requirementId}>
                  <Icon name="file" /><span>{d.label}</span>
                  <strong class={`ob-document-state is-${d.collected ? 'complete' : 'missing'}`}><Icon name={d.collected ? 'check' : 'warning'} />{d.collected ? '' : 'Missing'}</strong>
                </div>
              ))}
              {!documents?.items.length
                ? (
                  <EmptyState
                    icon="fa-folder-open"
                    title={employeeId ? 'No documents required' : 'No worker selected'}
                    text={employeeId ? 'This worker has no required documents.' : 'Select a worker to resolve documents.'}
                    tone="gray"
                  />
                )
                : null}
            </div>
          </section>

          <section class="ob-summary-card">
            <StepHeader icon="archive" title="Generated Summary" />
            <div class="ob-summary-list">
              {summaryMetrics.map(m => (
                <div class="ob-summary-row" key={m.id}><span><Icon name={m.icon} /> {m.label}</span><strong>{m.value}</strong></div>
              ))}
            </div>
          </section>
        </aside>
      </div>
      {oneOffOpen ? <OneOffActionDialog onClose={() => setOneOffOpen(false)} onAdd={action => { setOneOffActions(current => [...current, action]); setOneOffOpen(false); }} /> : null}
    </div>
  );
}

// Step-workspace header — icon badge (relevant to the section) + title + description, matching the
// obv-activation-title-row pattern from the Onboarding Command Center dashboard.
function OneOffActionDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (action: OnboardingLaunchOneOffAction) => void }): VNode {
  const [name, setName] = useState('');
  const [actionType, setActionType] = useState<OnboardingLaunchOneOffAction['actionType']>('custom_task');
  const [ownerRole, setOwnerRole] = useState('hr');
  const [instructions, setInstructions] = useState('');
  const [dueOffset, setDueOffset] = useState('0');
  const [blocks, setBlocks] = useState(false);
  const [evidence, setEvidence] = useState(false);
  const submit = (): void => {
    if (!name.trim()) { toast.warning('Enter a name for the one-off action.'); return; }
    if (!ownerRole) { toast.warning('Choose the owning team.'); return; }
    const parsedOffset = Number(dueOffset);
    if (!Number.isInteger(parsedOffset) || parsedOffset < -365 || parsedOffset > 365) {
      toast.warning('Due offset must be a whole number from -365 to 365.'); return;
    }
    onAdd({
      actionName: name.trim(), actionType, ownerRole,
      instructions: instructions.trim() || null, dueOffsetDays: parsedOffset,
      blocksOnboarding: blocks, requiresEvidence: evidence,
    });
  };
  return (
    <Modal open title="Create One-Off Action" sub="Adds work to this case only. The reusable package is not changed." icon="fa-list-check" size="lg" onClose={onClose} onSubmit={submit} submitLabel="Add Action">
      <ModalSection title="Action" desc="Describe the operational result and assign its accountable queue.">
        <div class="ob-worker-form-grid">
          <Fld label="Action Name" value={name} onInput={setName} required placeholder="e.g. Arrange specialist access" />
          <SelFld label="Creates" value={actionType} onInput={value => setActionType(value as OnboardingLaunchOneOffAction['actionType'])}
            options={['custom_task','custom_checklist_item','custom_handoff','custom_notification']} />
          <SelFld label="Owning Team" value={ownerRole} onInput={setOwnerRole}
            options={['hr','supervisor','it','hse','training','payroll','facilities']} />
          <Fld label="Due Offset (days from start)" value={dueOffset} onInput={setDueOffset} type="number" />
          <label class="ob-action-row"><input type="checkbox" checked={blocks} onChange={event => setBlocks((event.target as HTMLInputElement).checked)} /><span class="ob-action-copy"><strong>Blocks Day One</strong><small>Keep off for follow-up work that may continue after launch.</small></span></label>
          <label class="ob-action-row"><input type="checkbox" checked={evidence} onChange={event => setEvidence((event.target as HTMLInputElement).checked)} /><span class="ob-action-copy"><strong>Evidence required</strong><small>Completion requires approved supporting evidence.</small></span></label>
        </div>
        <label class="ob-field"><span class="ob-field-label">Instructions</span><textarea class="ob-control" value={instructions} onInput={event => setInstructions((event.target as HTMLTextAreaElement).value)} rows={4} placeholder="What must be completed?" /></label>
      </ModalSection>
    </Modal>
  );
}

function StepHeader({ icon, title, desc }: { icon: IconName; title: string; desc?: string | VNode }): VNode {
  return (
    <div class="ob-worker-header">
      <span class="ob-worker-header-icon"><Icon name={icon} /></span>
      <div><h2>{title}</h2>{desc && <p>{desc}</p>}</div>
    </div>
  );
}

/** Text field. Read-only when no `onInput` (displays an employee-derived value); editable
 *  otherwise. `required` adds the `*`, `error` shows the red state + message once validated. */
function Fld(
  { label, value, readOnly, onInput, required, error, placeholder, type }:
  { label: string; value: string; readOnly?: boolean; onInput?: (v: string) => void; required?: boolean; error?: boolean; placeholder?: string; type?: string },
): VNode {
  return (
    <label class={`ob-field${error ? ' is-error' : ''}`}>
      <span class="ob-field-label">{label}{required ? <span class="ob-required">*</span> : null}</span>
      <span class="ob-control ob-control-text">
        <input value={value} readOnly={readOnly ?? !onInput} type={type ?? 'text'} placeholder={placeholder}
          onInput={onInput ? e => onInput((e.target as HTMLInputElement).value) : undefined} />
      </span>
      {error ? <span class="ob-field-error">This field is required</span> : null}
    </label>
  );
}
function SelFld(
  { label, value, options, onInput, required, error, placeholder }:
  { label: string; value: string; options: string[]; onInput: (v: string) => void; required?: boolean; error?: boolean; placeholder?: string },
): VNode {
  return (
    <label class={`ob-field${error ? ' is-error' : ''}`}>
      <span class="ob-field-label">{label}{required ? <span class="ob-required">*</span> : null}</span>
      <span class="ob-control ob-control-select">
        <select value={value} onChange={e => onInput((e.target as HTMLSelectElement).value)}>
          {placeholder ? <option value="">{placeholder}</option> : null}
          {options.map(o => <option value={o} key={o}>{o}</option>)}
        </select>
        <Icon name="chevronRight" className="ob-control-icon ob-control-chevron" />
      </span>
      {error ? <span class="ob-field-error">This field is required</span> : null}
    </label>
  );
}
/** Date field with the calendar glyph + inline error support. */
function DateFld(
  { label, value, onInput, required, error }:
  { label: string; value: string; onInput: (v: string) => void; required?: boolean; error?: boolean },
): VNode {
  return (
    <label class={`ob-field${error ? ' is-error' : ''}`}>
      <span class="ob-field-label">{label}{required ? <span class="ob-required">*</span> : null}</span>
      <span class="ob-control ob-control-date">
        <Icon name="calendar" className="ob-control-icon" />
        <input type="date" value={value} onInput={e => onInput((e.target as HTMLInputElement).value)} />
      </span>
      {error ? <span class="ob-field-error">This field is required</span> : null}
    </label>
  );
}

// Searchable worker field — thin adapter over the UI-kit's PersonSearchSelect
// (filters by name/ID, shows each match's profile photo/initials).
function WorkerSearchField(
  { employees, value, onChange, onSearch, loading, error }:
  { employees: HrEmployeeRow[]; value: string; onChange: (id: string) => void; onSearch: (query: string) => void; loading: boolean; error: string | null },
): VNode {
  const options: PersonSearchOption[] = useMemo(() => employees.map(e => ({
    id: e.id,
    name: rowName(e),
    subtitle: [e.employee_number, e.position].filter(Boolean).join(' · ') || null,
    photoUrl: e.profile_image_url,
  })), [employees]);

  return (
    <PersonSearchSelect
      options={options}
      value={value}
      onChange={onChange}
      onSearch={onSearch}
      loading={loading}
      error={error}
      minimumQueryLength={2}
      placeholder="Search by name, employee number or work email…"
      emptyLabel="No workers found"
    />
  );
}

// One required-document row in the Documents step: shows its current compliance state and lets
// the wizard record how it will be satisfied at launch (use the doc already on file, request the
// worker upload one, or — where the requirement allows it — waive it with a reason). The
// selection here is what `documentSelections` sends to hr/onboarding/start; blocking documents
// with no satisfying selection are what `blockingDocFailures` uses to gate the Launch button.
function DocumentRequirementCard(
  { doc, selection, canWaive, onSelect }:
  { doc: OnboardingIntakeDocument; selection: OnboardingDocumentLaunchSelection | null; canWaive: boolean; onSelect: (sel: OnboardingDocumentLaunchSelection) => void },
): VNode {
  const stateLabel: Record<OnboardingIntakeDocument['state'], string> = {
    present_verified: 'Verified', present_unverified: 'Pending verification', expired: 'Expired', missing: 'Missing',
  };
  const satisfied = doc.state === 'present_verified'
    || selection?.action === 'waive' || (!doc.isBlocking && selection?.action === 'request_from_worker');

  async function handleWaive(): Promise<void> {
    const reason = await dialog.prompt({ title: `Waive ${doc.label}`, text: 'Why is this document being waived?', placeholder: 'Waiver reason' });
    if (reason === null) return;
    if (!reason.trim()) { toast.warning('Enter a reason for the document waiver.'); return; }
    onSelect({ requirementId: doc.requirementId, action: 'waive', waiverReason: reason.trim() });
  }

  const alreadyOnFile = doc.state === 'present_verified';
  const statusText = alreadyOnFile ? 'On file'
    : selection?.action === 'use_existing' ? 'Will attach'
    : selection?.action === 'waive' ? 'Waived'
    : selection?.action === 'request_from_worker' ? 'Requested'
    : stateLabel[doc.state];

  return (
    <div class={`ob-doc-card ${satisfied ? 'is-satisfied' : 'is-outstanding'}`}>
      <div class="ob-doc-card-main">
        <span class="ob-doc-card-tile"><Icon name="documents" /></span>
        <div class="ob-doc-card-copy">
          <strong>{doc.label}</strong>
          <div class="ob-doc-card-tags">
            {doc.isBlocking ? <span class="ob-chip is-danger">Blocking</span> : <span class="ob-chip">Required</span>}
            {doc.requiresExpiry ? <span class="ob-chip is-info">Verification</span> : null}
            {doc.expiresAt ? <span class="ob-chip">Expires {doc.expiresAt}</span> : null}
          </div>
        </div>
        <span class={`ob-doc-card-status ${satisfied ? 'is-ok' : 'is-warn'}`}>
          <Icon name={satisfied ? 'check' : 'warning'} />{statusText}
        </span>
      </div>
      {!alreadyOnFile && (
        <div class="ob-doc-card-actions">
          <button type="button" class={selection?.action === 'request_from_worker' ? 'is-active' : ''}
            onClick={() => onSelect({ requirementId: doc.requirementId, action: 'request_from_worker' })}>
            Request from worker
          </button>
          {doc.canWaive && canWaive ? (
            <button type="button" class={selection?.action === 'waive' ? 'is-active' : ''} onClick={() => void handleWaive()}>
              Waive
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
