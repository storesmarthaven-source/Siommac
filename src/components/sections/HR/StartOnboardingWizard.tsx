/**
 * src/components/sections/HR/StartOnboardingWizard.tsx
 *
 * HR ▸ Onboarding ▸ Start Onboarding — the full-PAGE case-intake wizard (replaces the modal
 * OnboardingWizard). Rebuilt against the APPROVED mockup
 * `docs/mockups/onboarding-start-implementation-ready.html`, whose stylesheet is ported
 * verbatim by scripts/port-mockup-css.mjs into StartOnboarding.mockup.css (scoped `.obs-root`).
 *   Employee & Timing → Package → Optional Work → Documents → Review & Launch.
 *
 * Two deliberate deviations from the mockup file, both mandated by
 * docs/ONBOARDING_IMPLEMENTATION_REFERENCE.md:
 *   • the STEPPER is the SIOMAC production stepper, not the mockup's own `.steps` nav;
 *   • the right-hand summary RAIL reuses the existing production composition and `ob-*`
 *     tokens verbatim. It keeps StartOnboarding.css; only the left workspace is mockup-classed.
 * The two stylesheets do not collide: the rail's classes are all `ob-`-prefixed and the
 * mockup's generic names (.section/.field/.control/.btn) only exist under `.obs-root`.
 *
 * Live panels (verification · documents · duplicate · task/handoff preview) come from ONE read,
 * `useOnboardingIntakePreview(employeeId, packageKey)`; launch calls `hrOnboardingApi.start`.
 */
import { type ComponentChildren, type JSX, type VNode } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useQueryClient } from '@tanstack/preact-query';
import { hrOnboardingApi, useOnboardingPackages, useOnboardingActionTemplates, useOnboardingIntakePreview, useOnboardingAccountPreflight, useOnboardingLaunchPreflight } from '@api/hr/onboarding';
import { useHrEmployees, useUploadHrDocument, type HrEmployeeRow } from '@api/hr/employees';
import { hrEmployeeKeys } from '@api/queryKeys';
import { toast } from '@store';
import { can } from '@lib/permissions';
import { PersonSearchSelect, type PersonSearchOption, LucideIcon } from '@ui';
import { rowName } from './shared';
import { openHrEmployeeRecord, openOnboardingPackages } from './hrDeepLink';
import { humanize } from './onboardingStatus';
import type { OnboardingActionTemplate, OnboardingDocumentLaunchSelection, OnboardingIntakeDocument, OnboardingLaunchOneOffAction } from '../../../../types/hrOnboarding';
import './StartOnboarding.css';
import './StartOnboarding.mockup.css';

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

/**
 * The seeded platform package that carries the enhanced HSE / medical / competency gates.
 * The approved mockup singles it out visually — a shield on an amber tile instead of the
 * blue package box (`.package-choice-icon.is-safety`) — so an HR coordinator can see at a
 * glance that this policy is the heavier, safety-gated one.
 *
 * Keying off the package KEY is deliberate and matches how the rest of the codebase treats
 * this row. It is not derivable from the DTO today: `owners` lists HSE for ordinary packages
 * too (Office / Admin also generates HSE work), so no existing field discriminates. If more
 * packages ever need this treatment the honest fix is a governed risk attribute on
 * `hr_onboarding_packages`, surfaced through the DTO — not another key string here.
 */
const SAFETY_CRITICAL_PACKAGE_KEY = 'safety_critical_employee';

/**
 * Per-module marks for the Generated Work Preview, taken from the approved mockup's own
 * rows (HR Setup → user, Documents → doc, IT & Access → shield, Training → task, Payroll →
 * handoff, Day One → check). The port collapsed all of them to a single list glyph, so every
 * row in the preview read identically and the reader lost the module at a glance.
 *
 * HSE is not modelled in the mockup — it takes the same shield the mockup gives the other
 * assurance module. Anything unmapped keeps the previous generic task glyph.
 */
const MODULE_ICONS: Record<string, IconName> = {
  hr: 'user', documents: 'documents', hse: 'shield', it: 'shield', access: 'shield',
  training: 'task', learning: 'task', payroll: 'handoff', finance: 'handoff',
  dayone: 'check', supervisor: 'check', facilities: 'package',
};
const moduleIcon = (key: string): IconName => MODULE_ICONS[key.toLowerCase()] ?? 'task';

/**
 * Optional-action marks, keyed off the governed `action_type` enum (migration
 * 20260714000004) rather than the mockup's illustrative examples — the enum is the real
 * discriminator and covers every action a package can publish. The port rendered one glyph
 * for all of them.
 *
 * `custom_external_action` also takes the mockup's amber `is-facilities` tile: that variant
 * marks the errands SIOMAC cannot complete itself (its examples are the welcome kit and the
 * workstation), which is exactly what an external action is.
 */
const ACTION_ICONS: Record<string, IconName> = {
  custom_task: 'task', custom_checklist_item: 'task',
  custom_handoff: 'handoff', custom_notification: 'handoff',
  custom_document_request: 'documents', custom_training_request: 'people',
  custom_external_action: 'package',
};
const actionIcon = (type: string | null | undefined): IconName => ACTION_ICONS[type ?? ''] ?? 'task';
const actionIconClass = (type: string | null | undefined): string =>
  `optional-action-icon${type === 'custom_external_action' ? ' is-facilities' : ''}`;

type StepKey = 'worker' | 'package' | 'optional' | 'documents' | 'review';
const STEPS: { no: number; key: StepKey; label: string; description: string; icon: IconName }[] = [
  // Labels AND descriptions are the approved mockup's stepper copy, verbatim.
  { no: 1, key: 'worker',    label: 'Employee & Timing', description: 'Identity and start context', icon: 'user' },
  { no: 2, key: 'package',   label: 'Package',           description: 'Rules and generated plan',   icon: 'package' },
  { no: 3, key: 'optional',  label: 'Optional Work',     description: 'Add approved extras',        icon: 'task' },
  { no: 4, key: 'documents', label: 'Documents',         description: 'Requirement decisions',      icon: 'documents' },
  { no: 5, key: 'review',    label: 'Review & Launch',   description: 'Validate generated work',    icon: 'review' },
];

/**
 * The mockup's `stepCopy` table, verbatim — [title, description, footer]. The mockup keys
 * step 3 as `exceptions`; production has always keyed it `optional`, so it is mapped by the
 * production key rather than renaming a state machine to match a mockup's variable name.
 */
const STEP_COPY: Record<StepKey, { title: string; description: string; footer: string }> = {
  worker: {
    title: 'Choose the employee and start timing',
    description: 'Select the Employee Master record and define only the case context HR controls.',
    footer: 'Complete the employee and timing fields.',
  },
  package: {
    title: 'Choose the onboarding package',
    description: 'Compare compatible packages and review the work SIOMAC will generate.',
    footer: 'The package owns required tasks, handoffs and lead-time rules.',
  },
  optional: {
    title: 'Add optional work',
    description: 'Choose approved extras for this employee. Ownership appears only when SIOMAC cannot resolve it.',
    footer: 'Select any additional work, or continue without adding anything.',
  },
  documents: {
    title: 'Resolve document requirements',
    description: 'Use existing records, upload, request from the employee, or waive with elevated authority.',
    footer: 'Record a clear decision for every document requirement.',
  },
  review: {
    title: 'Validate and launch',
    description: 'Review the frozen plan, accountable owners and real launch blockers.',
    footer: 'Launch remains disabled while a structural check fails.',
  },
};

/** One Generated Work Preview row — a module's generated work, grouped from the preview. */
interface GeneratedModuleRow { key: string; label: string; owner: string; count: number; unit: string; gates: number }

/**
 * Module and owner keys are lower-case slugs, and `humanize` title-cases them — which turned
 * the acronyms into "Hr" / "Hse" / "It". These read them the way the rest of the app writes
 * them, and singularise the unit so a single item is not "1 tasks".
 */
const MODULE_ACRONYMS: Record<string, string> = { hr: 'HR', hse: 'HSE', it: 'IT' };
const moduleLabel = (key: string): string => MODULE_ACRONYMS[key.toLowerCase()] ?? humanize(key);
const pluralise = (n: number, unit: string): string => `${n} ${n === 1 ? unit.replace(/s$/, '') : unit}`;

/** Owning queues an actor may route work to. Shared by the one-off form and the ownership
 *  assignment dialog so the two can never offer different queues for the same field. */
const ONE_OFF_OWNER_ROLES = ['hr', 'supervisor', 'it', 'hse', 'training', 'payroll', 'facilities'];

const REASONS = ['New hire', 'Rehire', 'Role change', 'Contract conversion', 'Transfer in'];
const PRIORITIES = ['Normal', 'High', 'Urgent'];

export function StartOnboardingWizard(
  { employeeId: preset, onBack }:
  { employeeId?: string | null; onBack: () => void },
): VNode {
  const qc = useQueryClient();
  const canWaiveDocuments = can('hr.onboarding.documents.waive');
  // The upload disposition goes through the Employee Master commit flow, so it is gated on
  // THAT permission — the one the server actually enforces on those two endpoints.
  const canUploadDocuments = can('hr.employee_documents.upload');
  const canCreateOneOff = can('hr.onboarding.custom_actions.create');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [ownerSearch, setOwnerSearch] = useState('');
  const empQ = useHrEmployees({ search: employeeSearch || undefined, limit: 25 });
  const ownerQ = useHrEmployees({ search: ownerSearch || undefined, limit: 25 });
  const employees: HrEmployeeRow[] = useMemo(() => empQ.data ?? [], [empQ.data]);
  const owners: HrEmployeeRow[] = useMemo(() => ownerQ.data ?? [], [ownerQ.data]);
  const [employeeId, setEmployeeId] = useState(preset ?? '');
  const [selectedEmployee, setSelectedEmployee] = useState<HrEmployeeRow | null>(null);
  /**
   * The launch idempotency key. STABLE for one onboarding journey: every retry of a failed or
   * timed-out submit must reuse it, so a request that actually committed server-side returns
   * the original case instead of creating a second one. It is regenerated ONLY when the user
   * begins an entirely new journey (`startAnother`) — never per attempt, and never on re-render.
   */
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
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
  const [actionLibraryOpen, setActionLibraryOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<{ id: string; name: string; index: number } | null>(null);
  const [workDetail, setWorkDetail] = useState<GeneratedModuleRow | null>(null);
  const [documentSelections, setDocumentSelections] = useState<Record<string, OnboardingDocumentLaunchSelection>>({});
  const [busy, setBusy] = useState(false);
  // Employee Master is authoritative for worker category; the launch wizard never offers
  // a second, conflicting worker-type control.
  const workerType = selectedEmployee?.workerType ?? 'employee';
  const [done, setDone] = useState<{ caseId: string; caseNo: string; taskCount: number; handoffCount: number; documentRequestCount: number } | null>(null);
  const selectedEmp = employees.find(e => e.id === employeeId) ?? selectedEmployee ?? undefined;
  const empName = selectedEmp ? rowName(selectedEmp) : '';
  const pkg = packages.find(p => p.key === packageKey);
  const { data: actionTemplates = [] } = useOnboardingActionTemplates(packageKey);
  const intakeQ = useOnboardingIntakePreview(employeeId || null, packageKey || null, targetStartDate || null);
  const intake = intakeQ.data;
  const accountPreflightQ = useOnboardingAccountPreflight(employeeId || null, packageKey || null, ownerId || null);
  const accountPreflight = accountPreflightQ.data;
  const launchPayload = useMemo(() => employeeId && packageKey ? ({
    employeeId, packageKey, ownerId: ownerId || null, reason: reason || null, targetStartDate: targetStartDate || null,
    includeActionTemplateIds: Array.from(includedActionIds), oneOffActions,
    documentSelections: Object.values(documentSelections),
  }) : null, [employeeId, packageKey, ownerId, reason, targetStartDate, includedActionIds, oneOffActions, documentSelections]);
  const launchPreflightQ = useOnboardingLaunchPreflight(launchPayload);
  const launchPreflight = launchPreflightQ.data;

  // The server returns eligible packages in specificity order, so the first option is the honest
  // recommendation. Changing employee clears any selection no longer returned by the server.
  useEffect(() => {
    // Requires an employee. The packages query runs unfiltered when none is selected, so
    // without this guard the wizard auto-committed packages[0] on mount — pre-choosing a
    // package that may not even be compatible with the employee picked later, and marking
    // the Package step complete before the user had done anything.
    if (!employeeId || packageKey || !packages.length) return;
    setPackageKey(packages[0]!.key);
  }, [employeeId, packages, packageKey]);
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
    || (!!employeeId && !!packageKey && !launchPreflight?.ready);

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
    // A step the user cannot reach yet is never "complete". Package auto-selects the
    // recommended option as soon as an employee is chosen, which used to render step 2 as
    // `is-complete is-locked` — a tick on a step the user had not been allowed to open.
    const reachable = STEPS.findIndex(s => s.key === key) <= reachableIndex;
    if (!reachable) return 'pending';
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
      setDone({
        caseId: r.caseId, caseNo: r.caseNo, taskCount: r.taskCount,
        handoffCount: r.handoffCount, documentRequestCount: r.documentRequestCount,
      });
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
  const stepHead = STEP_COPY[step];
  /** Work the server says will continue AFTER launch — it does not block the case starting. */
  const followUps = launchPreflight?.followUps ?? [];
  /** Resolved owner name for the receipt; an unset owner defaults server-side to the actor. */
  const launchOwnerName = ownerId
    ? (owners.find(o => o.id === ownerId) ? rowName(owners.find(o => o.id === ownerId)!) : 'Assigned')
    : 'You (creating actor)';

  /** Opens the case that was just created. Uses the same event the board and HR shell already
   *  listen for, so it works from either host without new navigation plumbing. */
  function openCreatedCase(caseId: string): void {
    window.dispatchEvent(new CustomEvent('siomac:hr-onboarding-open-case', { detail: { caseId } }));
  }

  /**
   * Begin an entirely NEW onboarding journey. This is the ONLY place `requestId` is
   * regenerated — resetting it anywhere else (per attempt, per step) would break safe retry
   * by letting a committed launch be submitted a second time under a fresh key.
   */
  function startAnother(): void {
    setRequestId(crypto.randomUUID());
    setDone(null);
    setEmployeeId('');
    setPackageKey('');
    setIncludedActionIds(new Set());
    setOneOffActions([]);
    setDocumentSelections({});
    setTriedWorker(false);
    setStep('worker');
  }
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

  /**
   * Lead-time fit for the package decision banner: days from today to the target start date
   * against the package's default SLA. Both values are already on screen, so this is a pure
   * client-side reading of them, not a new server decision — `packageMatch` remains the
   * authority on COMPATIBILITY, this only answers "is the date achievable".
   */
  const schedule = useMemo(() => {
    if (!targetStartDate) return null;
    const start = Date.parse(`${targetStartDate.slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(start)) return null;
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const days = Math.round((start - today) / 86_400_000);
    const lead = pkg?.defaultSlaDays ?? null;
    return { days, lead, meets: lead === null ? true : days >= lead };
  }, [targetStartDate, pkg]);

  /**
   * Generated Work Preview rows, grouped from the preview contract: tasks by `moduleKey`,
   * handoffs by `targetModule`, plus a Documents row from the document projection. The launch
   * condition counts BLOCKING tasks and blocking-missing documents — the mockup's "N gate(s)".
   */
  const generatedModules = useMemo<GeneratedModuleRow[]>(() => {
    if (!preview) return [];
    type Row = GeneratedModuleRow;
    const rows = new Map<string, Row>();
    const rowFor = (key: string, owner: string, unit: string): Row => {
      const existing = rows.get(key);
      if (existing) return existing;
      const created: Row = { key, label: moduleLabel(key), owner: moduleLabel(owner), count: 0, unit, gates: 0 };
      rows.set(key, created);
      return created;
    };
    for (const t of preview.tasks) {
      const row = rowFor(t.moduleKey ?? 'hr', t.ownerRole, 'tasks');
      row.count += 1;
      if (t.isBlocking) row.gates += 1;
    }
    for (const h of preview.handoffs) {
      const row = rowFor(h.targetModule, h.targetModule, 'tasks');
      row.count += 1;
    }
    const list = [...rows.values()];
    if (documents && documents.requiredCount > 0) {
      list.push({
        key: 'documents', label: 'Documents', owner: 'HR Operations',
        count: documents.requiredCount, unit: 'requirements', gates: documents.blockingMissingCount,
      });
    }
    return list;
  }, [preview, documents]);

  // Same fallback chain as the search results: several roster rows carry only one of the three.
  const railPhotoUrl = selectedEmp?.profile_image_thumb_url ?? selectedEmp?.profile_image_url ?? selectedEmp?.signed_url ?? null;

  const optionalTemplates = useMemo(() => actionTemplates.filter(t => !t.isRequired), [actionTemplates]);

  // Already-verified evidence is reused automatically and only needs to be shown, not decided.
  // Everything else is an explicit decision — the split the approved wizard makes.
  const readyDocuments = useMemo(() => (documents?.items ?? []).filter(d => d.state === 'present_verified'), [documents]);
  const attentionDocuments = useMemo(() => (documents?.items ?? []).filter(d => d.state !== 'present_verified'), [documents]);
  const undecidedCount = useMemo(
    () => attentionDocuments.filter(d => {
      const selected = documentSelections[d.requirementId];
      return !selected || selected.action === 'none';
    }).length,
    [attentionDocuments, documentSelections],
  );

  /**
   * Work with no accountable owner. Mirrors the SERVER's gate exactly
   * (onboardingLaunchPreflight: a one-off with no ownerRole / department / employee / external
   * key is a launch blocker), so the exception the wizard shows and the one the backend
   * refuses on can never disagree.
   */
  const unresolvedOwnership = useMemo(
    () => oneOffActions
      .map((action, index) => ({ action, index }))
      .filter(({ action }) => !action.ownerRole && !action.ownerDepartmentId && !action.ownerEmployeeId && !action.externalSystemKey)
      .map(({ action, index }) => ({ id: `one-off-${index}`, name: action.actionName, index })),
    [oneOffActions],
  );

  const summaryMetrics = [
    { id: 'tasks', label: 'Tasks', value: preview ? String(preview.taskCount) : '—', icon: 'task' as IconName },
    { id: 'documents', label: 'Documents', value: documents ? String(documents.requiredCount) : '—', icon: 'documents' as IconName },
    { id: 'handoffs', label: 'Handoffs', value: preview ? String(preview.handoffCount) : '—', icon: 'handoff' as IconName },
    { id: 'duration', label: 'Estimated Duration', value: pkg ? `${pkg.defaultSlaDays} days` : '—', icon: 'clock' as IconName },
  ];

  return (
    <div class="mock-onboarding-start obs-root">
      {/* The approved header: a compact icon-only back control to the LEFT of the title, and a
          "Protected HR workflow" indicator on the right — not a labelled Back button floated
          right, which is what this was. Copy is the mockup's, verbatim. */}
      <header class="top">
        <div class="title">
          <button class="back" type="button" onClick={onBack} aria-label="Back to Onboarding Command Centre">
            <Icon name="arrowLeft" />
          </button>
          <div>
            <h1>Start Onboarding</h1>
            <p>Create a governed onboarding case from an existing Employee Master record.</p>
          </div>
        </div>
        <div class="top-meta">
          <span class="secure"><Icon name="lock" />Protected HR workflow</span>
        </div>
      </header>

      {done ? (
        /* `active` is NOT decorative: the ported `.success-state` is `display: none` and only
           `.success-state.active` is `display: block` (the mockup toggles it from script). Without
           it the whole post-launch receipt mounted invisibly — the case launched and the screen
           went blank. It is rendered only when `done`, so the class is unconditional here. */
        <section class="success-state active" aria-live="polite">
          <div class="success-shell">
            <header class="success-launch-header">
              <span class="success-icon"><Icon name="check" /></span>
              <div class="success-launch-copy">
                <span>Case created successfully</span>
                <h2>{empName ? `${empName}'s onboarding is now active` : 'Onboarding is now active'}</h2>
                <p>{pkg ? `The frozen ${pkg.label} v${pkg.versionNo} plan has been assigned to the accountable teams.` : 'The frozen plan has been assigned to the accountable teams.'}</p>
              </div>
              <div class="success-reference">
                <small>Case reference</small>
                <strong>{done.caseNo}</strong>
                <span>Launched now</span>
              </div>
            </header>

            <section class="success-person-card">
              {selectedEmp?.profile_image_url
                ? <img src={selectedEmp.profile_image_url} alt="" />
                : <span class="ob-preview-photo">{empName ? initialsOf(empName) : <Icon name="user" />}</span>}
              <div class="success-person-copy">
                <strong>{empName || '—'}</strong>
                <span>{[selectedEmp?.employee_number, selectedEmp?.position, selectedEmp?.departmentName].filter(Boolean).join(' · ') || '—'}</span>
              </div>
              <span class="pill green">Active onboarding</span>
              <div class="success-person-fact"><small>Target start</small><strong>{targetStartDate || '—'}</strong></div>
              <div class="success-person-fact"><small>Case owner</small><strong>{launchOwnerName}</strong></div>
            </section>

            <section class="success-created">
              <div class="success-section-head">
                <div>
                  <span class="item-icon"><Icon name="archive" /></span>
                  <div>
                    <h3>Governed work created</h3>
                    <p>Committed from the frozen package plan.</p>
                  </div>
                </div>
                <span class="success-audit-state">Audited</span>
              </div>
              <div class="success-grid">
                <div class="success-metric"><strong>{done.taskCount}</strong><span>Required tasks</span></div>
                <div class="success-metric"><strong>{done.handoffCount}</strong><span>Team handoffs</span></div>
                <div class="success-metric"><strong>{done.documentRequestCount}</strong><span>Document requirements</span></div>
                <div class="success-metric is-followup"><strong>{followUps.length}</strong><span>Tracked follow-up</span></div>
              </div>
            </section>

            <div class="success-next-grid">
              <section class="success-followup">
                <div class="success-card-title">
                  <span class="item-icon"><Icon name="clock" /></span>
                  <div>
                    <h3>Follow-up already assigned</h3>
                    <p>This does not prevent the onboarding case from progressing.</p>
                  </div>
                  <span class={`pill ${followUps.length ? 'amber' : 'green'}`}>{followUps.length ? `${followUps.length} open` : 'None'}</span>
                </div>
                {followUps.length === 0
                  ? <div class="success-followup-row"><div><strong>Nothing outstanding</strong><span>Every requirement was resolved before launch.</span></div></div>
                  : followUps.map((f, i) => (
                    <div class="success-followup-row" key={`${f.label}-${i}`}>
                      <div><strong>{f.label}</strong><span>Secure upload request to employee</span></div>
                      <div><small>Accountable queue</small><strong>{f.owner}</strong></div>
                    </div>
                  ))}
              </section>

              <section class="success-routing">
                <div class="success-card-title">
                  <span class="item-icon"><Icon name="handoff" /></span>
                  <div>
                    <h3>What happens next</h3>
                    <p>SIOMAC has activated the operating workflow.</p>
                  </div>
                </div>
                <div class="success-routing-list">
                  <div>
                    <span><Icon name="check" /></span>
                    <p><strong>Owners notified</strong><small>Assigned teams can now see their work.</small></p>
                  </div>
                  <div>
                    <span><Icon name="check" /></span>
                    <p><strong>Handoffs queued</strong><small>{done.handoffCount} accountable queue{done.handoffCount === 1 ? '' : 's'} received work.</small></p>
                  </div>
                  <div>
                    <span><Icon name="check" /></span>
                    <p><strong>Readiness tracking started</strong><small>HR can monitor progress from Case Detail.</small></p>
                  </div>
                </div>
              </section>
            </div>

            <footer class="success-actions">
              <p>Case {done.caseNo} is live and auditable.</p>
              <div>
                <button class="btn" type="button" onClick={onBack}>Return to Command Centre</button>
                <button class="btn" type="button" onClick={startAnother}>Start Another</button>
                <button class="btn primary" type="button" onClick={() => openCreatedCase(done.caseId)}>
                  Open Case<Icon name="chevronRight" />
                </button>
              </div>
            </footer>
          </div>
        </section>
      ) : (
        <>
      {/* Step nav — the MOCKUP's stepper markup. It carries BOTH class sets
          (`step ui-stepper-step`, `step-no ui-stepper-marker`, `step-copy ui-stepper-copy`),
          i.e. it IS the SIOMAC Stepper with the mockup's styling layered on, so this satisfies
          the implementation reference and the approved design at once. The previous `ob-stepper-*`
          markup matched neither, which is why the steps were styled differently. */}
      <nav class="steps ui-stepper" aria-label="Onboarding steps">
        {STEPS.map((s, i) => {
          const status = stepStatus(s.key);
          const reachable = i <= reachableIndex;
          const stateClass = status === 'active' ? 'is-active' : status === 'complete' ? 'is-complete' : 'is-todo';
          return (
            <button
              class={`step ui-stepper-step ${stateClass}${reachable ? '' : ' is-locked'}`}
              type="button" key={s.key}
              disabled={!reachable}
              onClick={() => setStep(s.key)}
              aria-current={status === 'active' ? 'step' : undefined}
              title={reachable ? undefined : 'Complete the previous step first'}
            >
              <span class="step-no ui-stepper-marker">{status === 'complete' ? <Icon name="check" /> : s.no}</span>
              <span class="step-copy ui-stepper-copy"><strong>{s.label}</strong><span>{s.description}</span></span>
            </button>
          );
        })}
      </nav>

      {/* `.wizard > .wizard-body` IS the mockup's two-column shell (content + 390px rail) —
          the same job the old `ob-page-grid` did, so it replaces it rather than nesting. */}
      <section class="wizard">
        <div class="wizard-body">
          <div class="content">
            <div class="content-head">
              <div class="eyebrow">Step {stepIndex + 1} of {STEPS.length}</div>
              <h2>{stepHead.title}</h2>
              <p>{stepHead.description}</p>
            </div>

            <div class="panel-host" key={step}>
            {step === 'worker' && (
              <section class="panel active" data-panel="worker">
                <div class="section">
                  <div class="section-title"><h3>Select an employee</h3><span>Searches Employee Master</span></div>
                  <div class="employee-picker">
                    <div class="employee-search-label">
                      <strong>Employee name or number <span class="req">*</span></strong>
                      <span>Required before package matching</span>
                    </div>
                    <WorkerSearchField
                      employees={employees} value={employeeId} onChange={setEmployeeId}
                      onSearch={setEmployeeSearch} loading={empQ.isFetching}
                      error={empQ.error instanceof Error ? empQ.error.message : null}
                    />
                    {fieldErr('employeeId') ? <span class="obs-field-error">Select a worker</span> : null}
                  </div>
                </div>

                {/* The four facts the reference names, read-only, straight off the employee's
                    CURRENT Employee Master assignment. They decide package eligibility and are
                    deliberately not overridable here. */}
                <div class="section">
                  <div class="section-title"><h3>Employment facts used for package matching</h3><span>Read-only · Employee Master</span></div>
                  <div class="employment-source">
                    <div class="employment-source-head">
                      <div><Icon name="user" /><strong>Current employee record</strong></div>
                      <span>Automatically refreshed after selection</span>
                    </div>
                    <div class="employment-facts">
                      <div class="employment-fact"><span>Worker category</span><strong>{employeeId ? humanize(workerType) : '—'}</strong></div>
                      <div class="employment-fact"><span>Employment type</span><strong>{selectedEmp?.employment_type ? humanize(selectedEmp.employment_type) : '—'}</strong></div>
                      <div class="employment-fact"><span>Department</span><strong>{selectedEmp?.departmentName ?? '—'}</strong></div>
                      <div class="employment-fact"><span>Role</span><strong>{selectedEmp?.position ?? '—'}</strong></div>
                    </div>
                    <div class="employment-source-foot">
                      <p>These values come from the employee's current Employee Master assignment. They determine which onboarding packages are eligible and cannot be overridden in this wizard.</p>
                      <button
                        class="btn" type="button" disabled={!employeeId}
                        onClick={() => { if (employeeId) openHrEmployeeRecord(employeeId, 'employment'); }}
                      >Review in Employee Master</button>
                    </div>
                  </div>
                </div>

                {/* The mockup's own `.field/.control` markup rather than the `ob-`-classed
                    SelFld/DateFld helpers — those are still used by the one-off action dialog,
                    so re-classing them would restyle a surface this slice does not cover. */}
                <div class="section">
                  <div class="field-grid">
                    <div class="field">
                      <label for="obs-reason">Reason <span class="req">*</span></label>
                      <select id="obs-reason" class="control" value={reason} onInput={e => setReason((e.target as HTMLSelectElement).value)}>
                        {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div class={`field${fieldErr('targetStartDate') ? ' is-error' : ''}`}>
                      <label for="obs-start">Target start date <span class="req">*</span></label>
                      <input
                        id="obs-start" class="control" type="date" value={targetStartDate}
                        onInput={e => setTargetStartDate((e.target as HTMLInputElement).value)}
                        aria-invalid={fieldErr('targetStartDate') ? 'true' : undefined}
                      />
                      {fieldErr('targetStartDate') ? <span class="obs-field-error">Set the target start date</span> : null}
                    </div>
                    <div class="field">
                      <label for="obs-priority">Priority</label>
                      <select id="obs-priority" class="control" value={priority} onInput={e => setPriority((e.target as HTMLSelectElement).value)}>
                        {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                    <div class="field">
                      <label>Case owner</label>
                      <PersonSearchSelect
                        options={owners.map(e => ({ id: e.id, name: rowName(e), subtitle: [e.employee_number, e.position, e.departmentName].filter(Boolean).join(' · '), photoUrl: e.profile_image_url }))}
                        value={ownerId} onChange={setOwnerId} onSearch={setOwnerSearch}
                        loading={ownerQ.isFetching} error={ownerQ.error instanceof Error ? ownerQ.error.message : null}
                        minimumQueryLength={2} placeholder="Search an accountable owner…" emptyLabel="No eligible owner found"
                      />
                      {!ownerId ? <small class="hint">Leave empty to assign the signed-in HR coordinator.</small> : null}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {step === 'package' && (
              <section class="panel active" data-panel="package">
                {/* `is-tight` is the mockup's own attention variant for this banner (amber border,
                    icon, chip and copy). The class emitted here used to be `is-warn`, which nothing
                    styles — so "No compatible package" and a missed lead time both rendered in the
                    SUCCESS green chrome, with only the wording changing. */}
                <div class={`package-decision-banner${packages.length === 0 || (schedule && !schedule.meets) ? ' is-tight' : ''}`} aria-label="Package compatibility and schedule">
                  <div class="package-banner-top">
                    <span class="package-banner-icon"><Icon name={packages.length && (!schedule || schedule.meets) ? 'check' : 'warning'} /></span>
                    <div class="package-banner-copy">
                      <strong>{packages.length === 0 ? 'No compatible package' : 'Ready to choose a package'}</strong>
                      <small>
                        {packages.length === 0
                          ? `No active package accepts ${humanize(workerType)} onboarding`
                          : `${packages.length} compatible ${packages.length === 1 ? 'policy' : 'policies'}${schedule ? ` and ${schedule.meets ? 'an achievable' : 'a tight'} start date` : ''}`}
                      </small>
                    </div>
                    <div class="package-header-timing">
                      <strong>{schedule ? `${schedule.days} days available` : 'No start date'}</strong>
                      <small>
                        {schedule && schedule.lead !== null
                          ? schedule.meets ? `${schedule.lead}-day recommendation met` : `${schedule.lead}-day recommendation missed`
                          : 'Set a target start date'}
                      </small>
                    </div>
                    <span class="package-insight-state">{packages.length && schedule?.meets ? 'All checks passed' : 'Needs attention'}</span>
                  </div>
                </div>

                <div class="package-section-head">
                  <div>
                    <h3>Choose an onboarding package</h3>
                    <p>Select the policy SIOMAC will use to generate required work.</p>
                  </div>
                  <div class="package-section-actions">
                    <button class="quiet-link" type="button" onClick={openOnboardingPackages}>Manage Packages</button>
                  </div>
                </div>

                {packages.length === 0
                  ? (
                    <div class="obs-empty">
                      <span class="item-icon"><Icon name="package" /></span>
                      <strong>No packages available for {humanize(workerType)}</strong>
                      <p>Create or activate an onboarding package that supports this case type in Package Manager before launching.</p>
                    </div>
                  )
                  : (
                    <div class="package-policy-stack">
                      {packages.map((p, packageIndex) => (
                        <button
                          type="button" key={p.key}
                          class={`package-policy-row${packageKey === p.key ? ' is-selected' : ''}`}
                          aria-pressed={packageKey === p.key ? 'true' : 'false'}
                          onClick={() => setPackageKey(p.key)}
                        >
                          <span class={`package-choice-icon${p.key === SAFETY_CRITICAL_PACKAGE_KEY ? ' is-safety' : ''}`}>
                            <Icon name={p.key === SAFETY_CRITICAL_PACKAGE_KEY ? 'shield' : 'package'} />
                          </span>
                          <span class="package-policy-copy">
                            <span class="package-policy-title">
                              <strong>{p.label}</strong>
                              <span class={`package-choice-badge${packageIndex === 0 ? '' : ' is-alt'}`}>{packageIndex === 0 ? 'Recommended' : 'Alternative'}</span>
                            </span>
                            <small>Version {p.versionNo} · {p.description ?? p.owners}</small>
                            <span class="package-reasons">
                              {(p.match?.reasons ?? []).map(reasonText => <span key={reasonText}>{reasonText}</span>)}
                            </span>
                          </span>
                          <span class="package-policy-numbers">
                            <span><strong>{p.taskCount}</strong><small>Tasks</small></span>
                            <span><strong>{p.handoffCount}</strong><small>Handoffs</small></span>
                            {/* Document requirements are resolved per EMPLOYEE against the
                                package's gates, so only the selected package has a real count.
                                An unselected row shows "—" rather than a number we cannot stand behind. */}
                            <span><strong>{packageKey === p.key && documents ? documents.requiredCount : '—'}</strong><small>Docs</small></span>
                            <span><strong>{p.defaultSlaDays}d</strong><small>Lead</small></span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                <section class="generated-plan">
                  <div class="generated-plan-head">
                    <div>
                      <h3>Generated Work Preview</h3>
                      <p>{pkg ? `Required work and owners from ${pkg.label} v${pkg.versionNo}.` : 'Choose a package to preview the generated work.'}</p>
                    </div>
                    <span class="generated-plan-readonly">Read only</span>
                  </div>
                  {generatedModules.length === 0
                    ? <p class="hint">{packageKey ? 'This package generates no work yet.' : 'Select a package above.'}</p>
                    : (
                      <div class="generated-work-list">
                        {generatedModules.map(m => (
                          <button type="button" class="generated-work-row" key={m.key} onClick={() => setWorkDetail(m)}>
                            <span class="generated-module-icon"><Icon name={moduleIcon(m.key)} /></span>
                            <span>
                              <strong>{m.label}</strong>
                              <small>{m.owner === m.label ? <em>{pluralise(m.count, m.unit)}</em> : <>{m.owner} · <em>{pluralise(m.count, m.unit)}</em></>}</small>
                            </span>
                            <span class={`module-state${m.gates ? ' is-gate' : ''}`}>{m.gates ? `${m.gates} gate${m.gates === 1 ? '' : 's'}` : 'Ready'}</span>
                            <Icon name="chevronRight" className="row-arrow" />
                          </button>
                        ))}
                      </div>
                    )}
                  <div class="generated-plan-note">
                    <span>The selected package version and generated work are frozen when the case launches.</span>
                  </div>
                </section>
              </section>
            )}

            {step === 'optional' && (
              <section class="panel active" data-panel="exceptions">
                <div class="section">
                  <div class="exception-section-head">
                    <div class="exception-section-title">
                      <span><Icon name="task" /></span>
                      <div>
                        <h3>Optional work</h3>
                        <p>Add approved extras only when this employee needs them.</p>
                      </div>
                    </div>
                    <div class="exception-section-actions">
                      <span>{includedActionIds.size + oneOffActions.length} selected</span>
                      <button class="btn primary compact" type="button" onClick={() => setActionLibraryOpen(true)}>
                        <Icon name="task" />Add optional action
                      </button>
                    </div>
                  </div>

                  {optionalTemplates.length === 0 && oneOffActions.length === 0
                    ? <p class="hint">This package has no optional work. Continue to documents.</p>
                    : (
                      <div class="optional-action-list">
                        {optionalTemplates.map(t => {
                          const on = includedActionIds.has(t.id);
                          const ownerName = t.ownerRole ? moduleLabel(t.ownerRole) : humanize(t.ownerType);
                          return (
                            <label class={`optional-action${on ? ' is-selected' : ''}`} key={t.id}>
                              <input type="checkbox" checked={on} onChange={() => toggleAction(t.id, false)} />
                              <span class="optional-check"><Icon name="check" /></span>
                              <span class={actionIconClass(t.actionType)}><Icon name={actionIcon(t.actionType)} /></span>
                              <span class="optional-action-copy">
                                <strong>{t.actionName}</strong>
                                <small>{t.description ?? `Creates ${humanize(t.actionType).toLowerCase()} for ${ownerName}.`}</small>
                              </span>
                              <span class="optional-owner">
                                <strong>{ownerName}</strong>
                                <small>{t.blocksOnboarding ? 'Blocking · must resolve' : 'Queue owned · may resolve later'}</small>
                              </span>
                              <span class="outcome-tag">{humanize(t.actionType)}</span>
                            </label>
                          );
                        })}
                        {oneOffActions.map((action, index) => (
                          <label class="optional-action is-selected" key={`${action.actionName}-${index}`}>
                            <input type="checkbox" checked onChange={() => setOneOffActions(current => current.filter((_, i) => i !== index))} />
                            <span class="optional-check"><Icon name="check" /></span>
                            <span class={actionIconClass(action.actionType)}><Icon name={actionIcon(action.actionType)} /></span>
                            <span class="optional-action-copy">
                              <strong>{action.actionName}</strong>
                              <small>{action.description ?? 'Manager-created work for this case only.'}</small>
                            </span>
                            <span class="optional-owner">
                              <strong>{moduleLabel(action.ownerRole ?? 'queue')}</strong>
                              <small>Manager override · queue owned</small>
                            </span>
                            <span class="outcome-tag">{humanize(action.actionType)}</span>
                          </label>
                        ))}
                      </div>
                    )}
                </div>

                {/* Ownership appears ONLY when the server could not resolve an accountable
                    person — the reference is explicit that it is an exception, not a routine step. */}
                {unresolvedOwnership.length > 0 && (
                  <div class="section">
                    <div class="exception-section-head">
                      <div class="exception-section-title">
                        <span><Icon name="handoff" /></span>
                        <div>
                          <h3>Ownership exception</h3>
                          <p>SIOMAC could not resolve an accountable person for this work.</p>
                        </div>
                      </div>
                    </div>
                    {unresolvedOwnership.map(item => (
                      <div class="ownership-exception" key={item.id}>
                        <span class="item-icon"><Icon name="handoff" /></span>
                        <div class="ownership-copy">
                          <strong>{item.name}</strong>
                          <small>Optional work · does not block launch</small>
                        </div>
                        <div class="queue-owner">
                          <span class="owner-avatar">{initialsOf(item.name)}</span>
                          <div>
                            <strong>Unassigned queue</strong>
                            <small>No accountable person resolved</small>
                          </div>
                        </div>
                        <button class="btn compact" type="button" onClick={() => setAssignTarget(item)}>Assign person</button>
                      </div>
                    ))}
                  </div>
                )}

                {accountPreflight?.required ? (
                  <div class="section">
                    <div class="section-title">
                      <h3>Account setup</h3>
                      <span>{accountPreflight.ready ? 'Policy resolved' : 'Configuration required'}</span>
                    </div>
                    {/* The mockup's own account block: a fact GRID with a supporting line under
                        each value, not the launch-plan row list this previously reused. */}
                    <div class="account-policy">
                      <div class="account-policy-facts">
                        <div class="account-policy-fact">
                          <span>Operating model</span>
                          <strong>{humanize(accountPreflight.operatingModel)}</strong>
                          <small>{accountPreflight.owningTeam.label}{accountPreflight.accountablePerson?.name ? ` · ${accountPreflight.accountablePerson.name}` : ''}</small>
                        </div>
                        <div class="account-policy-fact">
                          <span>Access profile</span>
                          <strong>{accountPreflight.accessProfile}</strong>
                          <small>Applied after approval checks</small>
                        </div>
                        <div class="account-policy-fact">
                          <span>Proposed email</span>
                          <strong>{accountPreflight.proposedWorkEmail ?? 'Not configured'}</strong>
                          <small>Generated from naming policy</small>
                        </div>
                        <div class="account-policy-fact">
                          <span>Invitation</span>
                          <strong>After account handoff</strong>
                          <small>No account is created in this step</small>
                        </div>
                      </div>
                    </div>
                    {accountPreflight.blockers.map(blocker => <p class="hint" key={blocker}>{blocker}</p>)}
                  </div>
                ) : null}
              </section>
            )}

            {step === 'documents' && (
              <section class="panel active" data-panel="documents">
                <div class="document-overview">
                  <div class="document-overview-copy">
                    <span class="item-icon"><Icon name="documents" /></span>
                    <div>
                      <h3>Required documents</h3>
                      <p>Verified records are reused automatically. Decide only what needs attention.</p>
                    </div>
                  </div>
                  <div class="document-overview-stat"><strong>{documents?.requiredCount ?? 0}</strong><span>Required</span></div>
                  <div class="document-overview-stat is-ready"><strong>{readyDocuments.length}</strong><span>Ready</span></div>
                  <div class="document-overview-stat is-attention"><strong>{attentionDocuments.length}</strong><span>Needs action</span></div>
                </div>

                {(documents?.items.length ?? 0) === 0 && (
                  <div class="obs-empty">
                    <Icon name="documents" />
                    <span>{employeeId ? 'No document requirements apply to this worker.' : 'Select a worker to resolve required documents.'}</span>
                  </div>
                )}

                {readyDocuments.length > 0 && (
                  <div class="section">
                    <details class="ready-documents">
                      <summary>
                        <span class="item-icon"><Icon name="check" /></span>
                        <span class="ready-documents-summary">
                          <strong>{readyDocuments.length} document{readyDocuments.length === 1 ? '' : 's'} ready</strong>
                          <small>Verified Employee Master records will be linked to this case automatically.</small>
                        </span>
                        <span class="pill green">No action needed</span>
                        <Icon name="chevronRight" className="ready-documents-chevron" />
                      </summary>
                      <div class="ready-document-list">
                        {readyDocuments.map(d => (
                          <div class="ready-document-row" key={d.requirementId}>
                            <span class="item-icon"><Icon name="documents" /></span>
                            <span>
                              <strong>{d.label}</strong>
                              <small>Verified{d.expiresAt ? ` · expires ${d.expiresAt}` : ' · no expiry required'}</small>
                            </span>
                            <span class="pill green">Use existing</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  </div>
                )}

                {attentionDocuments.length > 0 && (
                  <div class="section">
                    <div class="document-attention-head">
                      <h3>Needs action</h3>
                      <span>{undecidedCount} decision{undecidedCount === 1 ? '' : 's'} required</span>
                    </div>
                    {attentionDocuments.map(d => (
                      <DocumentRequirementCard
                        key={d.requirementId}
                        doc={d}
                        employeeId={employeeId}
                        workerEmail={selectedEmp?.email ?? selectedEmp?.personal_email ?? '—'}
                        targetStartDate={targetStartDate}
                        packageLabel={pkg?.label ?? null}
                        canWaive={canWaiveDocuments}
                        canUpload={canUploadDocuments}
                        selection={documentSelections[d.requirementId] ?? null}
                        onSelect={(sel) => setDocumentSelection(d.requirementId, sel)}
                        // The upload changes the employee's compliance state server-side, so the
                        // intake preview is re-read rather than patched locally — the same reason
                        // verification elsewhere must not be mirrored into client state.
                        onUploaded={() => { void intakeQ.refetch(); }}
                        onReviewInEmployeeMaster={() => openHrEmployeeRecord(employeeId, 'documents')}
                      />
                    ))}
                  </div>
                )}

                {blockingDocFailures.length > 0 && (
                  <div class="launch-ready-banner">
                    <Icon name="warning" />
                    <span><strong>{blockingDocFailures.length} blocking document{blockingDocFailures.length === 1 ? '' : 's'}</strong> must be attached or waived before launch.</span>
                  </div>
                )}
              </section>
            )}

            {step === 'review' && (
              <section class="panel active" data-panel="review">
                <div class={`launch-ready-banner${launchPreflight?.ready ? '' : ' is-blocked'}`}>
                  <span class="launch-ready-icon"><Icon name={launchPreflight?.ready ? 'check' : 'warning'} /></span>
                  <div class="launch-ready-copy">
                    <strong>{launchPreflightQ.isFetching ? 'Validating launch' : launchPreflight?.ready ? 'Ready to launch' : 'Launch blocked'}</strong>
                    <span>
                      {launchPreflight?.ready
                        ? `${launchChecks.length} structural checks passed.${followUps.length ? ` ${followUps.length} governed follow-up${followUps.length === 1 ? '' : 's'} will continue after launch.` : ''}`
                        : `${launchPreflight?.blockers.length ?? 0} check${(launchPreflight?.blockers.length ?? 0) === 1 ? '' : 's'} must be resolved before this case can start.`}
                    </span>
                  </div>
                  <span class="launch-ready-state">{launchPreflightQ.isFetching ? 'Validating…' : 'Validated now'}</span>
                </div>

                <div class="launch-review-grid">
                  <section class="launch-plan-card">
                    <div class="launch-card-head">
                      <span class="item-icon"><Icon name="archive" /></span>
                      <div>
                        <h3>What SIOMAC will create</h3>
                        <p>{pkg ? `The frozen work plan generated from ${pkg.label} v${pkg.versionNo}.` : 'Choose a package to freeze the work plan.'}</p>
                      </div>
                      {pkg ? <span class="pill navy">Version {pkg.versionNo}</span> : null}
                    </div>
                    {/* Each row is `svg | copy | value` — the leading icon is a DIRECT child, which
                        is what `.launch-plan-row { grid-template-columns: 32px minmax(0,1fr) auto }`
                        and `.launch-plan-row > svg` expect. Omitting it did not just drop a glyph:
                        the copy fell into the 32px icon track and wrapped one word per line, while
                        the value took the 1fr track and the third collapsed to 0. */}
                    <div class="launch-plan-list">
                      <div class="launch-plan-row">
                        <Icon name="shield" />
                        <div><strong>Onboarding case</strong><small>{pkg ? `${pkg.label} policy snapshot` : 'No package selected'}</small></div>
                        <span>Frozen</span>
                      </div>
                      <div class="launch-plan-row">
                        <Icon name="task" />
                        <div><strong>Required work</strong><small>Generated from the package's task templates</small></div>
                        <span>{launchPreflight ? `${launchPreflight.counts.tasks} tasks` : '—'}</span>
                      </div>
                      <div class="launch-plan-row">
                        <Icon name="handoff" />
                        <div><strong>Team handoffs</strong><small>Routed to accountable operating teams</small></div>
                        <span>{launchPreflight ? `${launchPreflight.counts.handoffs} handoffs` : '—'}</span>
                      </div>
                      <div class="launch-plan-row">
                        <Icon name="people" />
                        <div><strong>Optional work</strong><small>Selected during intake</small></div>
                        <span>{includedActionIds.size + oneOffActions.length} actions</span>
                      </div>
                      <div class="launch-plan-row">
                        <Icon name="documents" />
                        <div><strong>Documents</strong><small>{documents ? `${documents.requiredCount - documents.missingCount} linked · ${documents.missingCount} outstanding` : 'Not resolved yet'}</small></div>
                        <span>{documents ? `${documents.requiredCount} requirements` : '—'}</span>
                      </div>
                      <div class="launch-plan-row">
                        <Icon name="lock" />
                        <div><strong>Account setup</strong><small>{accountPreflight?.owningTeam.label ?? 'Resolved at launch'}</small></div>
                        <span>{pkg?.label ?? '—'}</span>
                      </div>
                    </div>
                  </section>

                  <section class="launch-followup-card">
                    <div class="launch-card-head">
                      <span class="item-icon"><Icon name="clock" /></span>
                      <div>
                        <h3>Follow-up after launch</h3>
                        <p>Tracked work that does not prevent the case from starting.</p>
                      </div>
                      <span class={`pill ${followUps.length ? 'amber' : 'green'}`}>
                        {followUps.length ? `${followUps.length} follow-up${followUps.length === 1 ? '' : 's'}` : 'None'}
                      </span>
                    </div>
                    <div class="launch-followup-body">
                      {followUps.length === 0
                        ? <p class="launch-followup-message">Everything required is resolved — nothing will be left outstanding when this case launches.</p>
                        : followUps.map((followUp, index) => (
                          <div key={`${followUp.label}-${index}`}>
                            <div class="launch-followup-document">
                              <span class="launch-document-icon"><Icon name="documents" /></span>
                              <div><strong>{followUp.label}</strong><small>Employee document request</small></div>
                              <span class="pill amber">Queued on launch</span>
                            </div>
                            <div class="launch-followup-meta">
                              <div class="launch-followup-meta-item">
                                <span class="launch-meta-icon"><Icon name="people" /></span>
                                <div><small>Accountable queue</small><strong>{followUp.owner}</strong></div>
                              </div>
                              <div class="launch-followup-meta-item">
                                <span class="launch-meta-icon"><Icon name="calendar" /></span>
                                <div><small>Response due</small><strong>{followUp.dueAt ?? 'On launch'}</strong></div>
                              </div>
                            </div>
                          </div>
                        ))}
                      {followUps.length > 0 && (
                        <div class="launch-followup-action">
                          <button class="btn" type="button" onClick={() => setStep('documents')}>Review document decisions</button>
                        </div>
                      )}
                    </div>
                  </section>
                </div>

                {/* Preflight checks. Open by default while blocked so the failing check — and the
                    link back to the step that owns it — is visible without a click. */}
                <details class="final-checks" open={!launchPreflight?.ready}>
                  <summary>
                    <span class="mark"><Icon name={hasBlockingLaunchFailure ? 'warning' : 'check'} /></span>
                    <span class="final-checks-copy">
                      <strong>Preflight checks</strong>
                      <small>Employee, package, ownership, duplicate and account rules were revalidated.</small>
                    </span>
                    <span class="final-check-count">{launchChecks.filter(c => c.passed).length}/{launchChecks.length}</span>
                  </summary>
                  <div class="final-check-list">
                    {launchChecks.map(chk => (
                      <div class={`final-check-item${chk.passed ? '' : ' is-fail'}`} key={chk.label}>
                        <span><Icon name={chk.passed ? 'check' : 'warning'} /></span>
                        <div><strong>{chk.label}</strong><small>{chk.passed ? 'Passed' : 'Blocking — resolve before launch.'}</small></div>
                      </div>
                    ))}
                    {(launchPreflight?.blockers ?? []).map((blocker, index) => (
                      <button
                        type="button" class="final-check-item is-fail" key={`blocker-${index}`}
                        onClick={() => setStep(blocker.step)}
                      >
                        <span><Icon name="warning" /></span>
                        <div>
                          <strong>{blocker.message}</strong>
                          <small>Fix in {STEPS.find(s => s.key === blocker.step)?.label ?? humanize(blocker.step)}</small>
                        </div>
                      </button>
                    ))}
                  </div>
                </details>

                <div class="launch-submit-note">
                  <span>Launching creates the case and governed work in one transaction. If any required write or side effect fails, nothing is created.</span>
                </div>
              </section>
            )}
            </div>

            {/* Mockup footer: a per-step guidance line on the left, nav on the right. */}
            <div class="footer">
              <p class="footer-copy">{stepHead.footer}</p>
              <div class="footer-actions">
                <button class="btn" type="button" disabled={stepIndex === 0} onClick={goPrev}><Icon name="arrowLeft" />Back</button>
                {step === 'review'
                  ? <button class="btn primary" type="button" disabled={busy || hasBlockingLaunchFailure} onClick={() => void launch()}><Icon name="launch" />{busy ? 'Launching…' : 'Launch Case'}</button>
                  : <button class="btn" type="button" disabled={step !== 'worker' && !stepDone[step]} onClick={goNext}>Continue<Icon name="chevronRight" /></button>}
              </div>
            </div>
          </div>

        {/* ── right: status rail ── */}
        {/* Summary rail — rebuilt to the MOCKUP's rail markup.
            The mockup embeds this rail itself (`data-ui="WizardSummaryRail"`,
            `data-reference="production-start-onboarding:right-rail"`), but with its own
            vocabulary: `.ob-rail-card` / `.ob-rail-head` / `.ob-rail-title` / `.ob-rail-count`,
            `.ob-check-row`, `.ob-duplicate-ok`, `.ob-doc-row`, `.ob-total-row`, and an identity
            block of `.ob-ring-row > .ob-preview-photo + .ob-ring-copy (strong / .ob-ring-id /
            .ob-ring-role)`. The old production rail used a different set and added an icon disc
            to every preview fact, which the mockup does not have — that CSS was all dead. Data
            bindings are unchanged. */}
        <aside class="ob-side-stack" aria-label="Onboarding case status">
          <section class="ob-rail-card">
            <div class="ob-preview-kicker"><Icon name="idCard" />Case Preview</div>
            <div class="ob-ring-hero">
              <div class="ob-ring-row">
                <span class={`ob-preview-photo${!employeeId ? ' is-empty' : ''}`}>
                  {railPhotoUrl
                    ? <img src={railPhotoUrl} alt="" />
                    : empName
                      ? initialsOf(empName)
                      : <LucideIcon name="UserRound" size={20} />}
                </span>
                <div class="ob-ring-copy">
                  <strong>{empName || 'No worker selected'}</strong>
                  {employeeId
                    ? <>
                        <span class="ob-ring-id">{selectedEmp?.employee_number ?? '—'}</span>
                        <span class="ob-ring-role">{selectedEmp?.position ?? humanize(workerType)}</span>
                      </>
                    : <span class="ob-ring-role">Select a worker to preview</span>}
                </div>
              </div>
            </div>
            {/* Each fact leads with its own mark. The design has no icon DISCS here (an earlier
                revision added them and they were removed) — but it does carry a plain 16px glyph
                above the label, which `.ob-preview-fact svg { margin: 0 auto 8px }` styles. That
                rule was dead while the facts rendered label + value only. */}
            <div class="ob-preview-facts">
              <div class="ob-preview-fact"><Icon name="package" /><small>Package</small><strong>{pkg?.label ?? '—'}</strong></div>
              <div class="ob-preview-fact"><Icon name="documents" /><small>Documents</small><strong>{documents ? `${docsCollected} / ${docsTotal}` : '—'}</strong></div>
              <div class="ob-preview-fact"><Icon name="task" /><small>Start Date</small><strong>{targetStartDate || '—'}</strong></div>
              <div class="ob-preview-fact"><Icon name="handoff" /><small>Lead Time</small><strong>{pkg ? `${pkg.defaultSlaDays} days` : '—'}</strong></div>
            </div>
          </section>

          <section class="ob-rail-card ob-rail-section">
            <div class="ob-rail-head">
              <div class="ob-rail-title"><Icon name="shield" /><strong>Worker Verification</strong></div>
              {employeeId ? <span class="ob-rail-count">{verification.filter(v => v.status === 'verified').length} / {verification.length}</span> : null}
            </div>
            {!employeeId
              ? <p class="ob-rail-empty">Select a worker to run verification checks.</p>
              : (
                <div class="ob-check-list">
                  {verification.map(v => (
                    <div class={`ob-check-row is-${v.status}`} key={v.id}>
                      <span>{v.label}</span>
                      <strong>{v.status === 'verified' ? 'Ready' : v.critical ? 'Required' : 'Pending'}</strong>
                    </div>
                  ))}
                </div>
              )}
          </section>

          <section class="ob-rail-card ob-rail-section">
            <div class="ob-rail-head">
              <div class="ob-rail-title"><Icon name="copy" /><strong>Duplicate Check</strong></div>
            </div>
            {!employeeId
              ? <p class="ob-rail-empty">Select a worker to check for duplicates.</p>
              : (
            <div class={`ob-duplicate-ok${duplicate?.hasDuplicate ? ' is-warn' : ''}`}>
              <div>
                {duplicate?.hasDuplicate
                    ? <>
                        <strong>{duplicate.cases.length} active case{duplicate.cases.length === 1 ? '' : 's'} found</strong>
                        <span>{duplicate.cases.map(c => c.caseNo).join(', ')} — this worker already has onboarding in progress.</span>
                      </>
                  : <><strong>No duplicates found</strong><span>No active onboarding case exists for this employee.</span></>}
              </div>
            </div>
              )}
          </section>

          <section class="ob-rail-card ob-rail-section">
            <div class="ob-rail-head">
              <div class="ob-rail-title"><Icon name="documents" /><strong>Required Documents ({documents?.requiredCount ?? 0})</strong></div>
              {documents?.items.length ? <button class="doc-choice" type="button" onClick={() => setStep('documents')}>View all</button> : null}
            </div>
            {documents?.items.length
              ? (
                <div class="ob-doc-list">
                  {documents.items.slice(0, 4).map(d => (
                    <div class={`ob-doc-row${d.collected ? '' : ' is-missing'}`} key={d.requirementId}>
                      {/* The row's leading status mark. `.ob-doc-row svg` is green by default and
                          amber under `.is-missing`, so the icon carries the state alongside the
                          label — without it that CSS was dead and every row read the same. */}
                      <Icon name={d.collected ? 'check' : 'warning'} />
                      <span>{d.label}</span>
                      <strong>{d.collected ? 'Verified' : 'Follow-up'}</strong>
                    </div>
                  ))}
                </div>
              )
              : <p class="ob-rail-empty">{employeeId ? 'This worker has no required documents.' : 'Select a worker to resolve documents.'}</p>}
          </section>

          <section class="ob-rail-card ob-rail-section">
            <div class="ob-rail-head">
              <div class="ob-rail-title"><Icon name="archive" /><strong>Generated Summary</strong></div>
            </div>
            {summaryMetrics.map(m => (
              <div class="ob-total-row" key={m.id}><span>{m.label}</span><strong>{m.value}</strong></div>
            ))}
          </section>
        </aside>
        </div>
      </section>
        </>
      )}
      {oneOffOpen ? <OneOffActionDialog onClose={() => setOneOffOpen(false)} onAdd={action => { setOneOffActions(current => [...current, action]); setOneOffOpen(false); }} /> : null}
      {workDetail ? <GeneratedWorkDialog row={workDetail} packageLabel={pkg?.label ?? ''} onClose={() => setWorkDetail(null)} /> : null}
      {actionLibraryOpen ? (
        <ActionLibraryDialog
          templates={optionalTemplates}
          selected={includedActionIds}
          canCreateOneOff={canCreateOneOff}
          onToggle={id => toggleAction(id, false)}
          onCreateOneOff={() => { setActionLibraryOpen(false); setOneOffOpen(true); }}
          onClose={() => setActionLibraryOpen(false)}
        />
      ) : null}
      {assignTarget ? (
        <AssignOwnerDialog
          target={assignTarget}
          people={owners.map(o => ({ id: o.id, name: rowName(o), subtitle: [o.position, o.departmentName].filter(Boolean).join(' · ') || 'Employee' }))}
          onClose={() => setAssignTarget(null)}
          onAssign={(ownerRole, ownerEmployeeId) => {
            setOneOffActions(current => current.map((a, i) => i === assignTarget.index ? { ...a, ownerRole, ownerEmployeeId } : a));
            setAssignTarget(null);
            toast.success(
              ownerEmployeeId
                ? `${assignTarget.name} assigned to ${moduleLabel(ownerRole)} — ${owners.find(o => o.id === ownerEmployeeId) ? rowName(owners.find(o => o.id === ownerEmployeeId)!) : 'a named owner'}.`
                : `${assignTarget.name} left in the ${moduleLabel(ownerRole)} queue.`,
            );
          }}
        />
      ) : null}
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
    <ObsDialog className="action-library-dialog" labelledBy="obs-oneoff-title" onClose={onClose}>
      <div class="assignment-dialog-head">
        <span class="item-icon"><Icon name="task" /></span>
        <div>
          <h3 id="obs-oneoff-title">Create one-off action</h3>
          <p>Managers only — applies to this onboarding case and does not change the package library.</p>
        </div>
        <button type="button" class="work-dialog-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div class="assignment-dialog-body one-off-form">
        <div class="one-off-grid">
          <div class="assignment-field">
            <label for="obs-oneoff-name">Action name <span class="req">*</span></label>
            <input
              id="obs-oneoff-name" class="control" value={name} placeholder="e.g. Arrange specialist access"
              onInput={e => setName((e.target as HTMLInputElement).value)}
            />
          </div>
          <div class="assignment-field">
            <label for="obs-oneoff-outcome">Operational result</label>
            <select
              id="obs-oneoff-outcome" class="assignment-select" value={actionType}
              onInput={e => setActionType((e.target as HTMLSelectElement).value as OnboardingLaunchOneOffAction['actionType'])}
            >
              {['custom_task', 'custom_checklist_item', 'custom_handoff', 'custom_notification'].map(t => (
                <option key={t} value={t}>{humanize(t.replace('custom_', ''))}</option>
              ))}
            </select>
          </div>
          <div class="assignment-field">
            <label for="obs-oneoff-team">Owning team / queue</label>
            <select id="obs-oneoff-team" class="assignment-select" value={ownerRole} onInput={e => setOwnerRole((e.target as HTMLSelectElement).value)}>
              {ONE_OFF_OWNER_ROLES.map(r => <option key={r} value={r}>{moduleLabel(r)}</option>)}
            </select>
          </div>
          <div class="assignment-field">
            <label for="obs-oneoff-due">Due timing (days from start)</label>
            <input
              id="obs-oneoff-due" class="control" type="number" value={dueOffset} min={-365} max={365}
              onInput={e => setDueOffset((e.target as HTMLInputElement).value)}
            />
          </div>
        </div>
        <div class="assignment-field">
          <label for="obs-oneoff-instructions">Instructions</label>
          <textarea
            id="obs-oneoff-instructions" class="control" rows={3} value={instructions} placeholder="What must be completed?"
            onInput={e => setInstructions((e.target as HTMLTextAreaElement).value)}
          />
        </div>
        {/* `.obs-toggle-row`, not `.optional-action`: that class is a six-column grid built for
            the step-3 action list, and reusing it here crushed each label to one word per line.
            The mockup does not model these two toggles — they map real backend fields. */}
        <label class="obs-toggle-row">
          <input type="checkbox" checked={blocks} onChange={e => setBlocks((e.target as HTMLInputElement).checked)} />
          <span><strong>Blocks Day One</strong><small>Keep off for follow-up work that may continue after launch.</small></span>
        </label>
        <label class="obs-toggle-row">
          <input type="checkbox" checked={evidence} onChange={e => setEvidence((e.target as HTMLInputElement).checked)} />
          <span><strong>Evidence required</strong><small>Completion requires approved supporting evidence.</small></span>
        </label>
      </div>
      <div class="one-off-actions">
        <button class="btn compact" type="button" onClick={onClose}>Cancel</button>
        <button class="btn primary compact" type="button" onClick={submit}>Add one-off action</button>
      </div>
    </ObsDialog>
  );
}

/**
 * Native `<dialog>` shell for this page's dialogs.
 *
 * The approved mockup styles them as real `<dialog>` elements with `::backdrop` — using the
 * UI-kit `Modal` here rendered a generic app modal instead and left every ported
 * `.work-dialog-*` / `.action-library-*` / `.assignment-dialog-*` rule dead. `showModal()`
 * also gives the focus trap, Esc handling and inert background for free.
 *
 * It stays INSIDE `.obs-root` so the scoped CSS matches: the top layer changes where an
 * element PAINTS, not where it sits in the DOM tree.
 */
function ObsDialog(
  { className, labelledBy, onClose, children }:
  { className: string; labelledBy: string; onClose: () => void; children: ComponentChildren },
): VNode {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (!node.open) node.showModal();
    const onCancel = (e: Event) => { e.preventDefault(); onClose(); };
    node.addEventListener('cancel', onCancel);
    return () => node.removeEventListener('cancel', onCancel);
  }, [onClose]);
  return (
    <dialog
      ref={ref} class={className} aria-labelledby={labelledBy}
      // Clicking the backdrop closes: the click target is the dialog itself only when the
      // pointer is outside its padding box.
      onClick={e => { if (e.target === ref.current) onClose(); }}
    >
      {children}
    </dialog>
  );
}

/**
 * Read-only detail for one Generated Work Preview row. Everything shown is already in the
 * preview contract — the dialog explains WHERE the work comes from and what its launch
 * condition means; it never offers to edit package-owned work.
 */
function GeneratedWorkDialog(
  { row, packageLabel, onClose }: { row: GeneratedModuleRow; packageLabel: string; onClose: () => void },
): VNode {
  return (
    <ObsDialog className="work-preview-dialog" labelledBy="obs-work-dialog-title" onClose={onClose}>
      <div class="work-dialog-head">
        <span class="generated-module-icon"><Icon name={moduleIcon(row.key)} /></span>
        <div>
          <h3 id="obs-work-dialog-title">{row.label} — generated work</h3>
          <p>Read-only preview of the work SIOMAC will create when this case launches.</p>
        </div>
        <button type="button" class="work-dialog-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div class="work-dialog-body">
        <div class="work-dialog-facts">
          <span><small>Owner</small><strong>{row.owner}</strong></span>
          <span><small>Generated work</small><strong>{pluralise(row.count, row.unit)}</strong></span>
          <span><small>Launch condition</small><strong>{row.gates ? `${row.gates} gate${row.gates === 1 ? '' : 's'}` : 'Ready'}</strong></span>
        </div>
        <ul class="work-dialog-list">
          <li><Icon name="check" /><span>Work is generated from the selected published package version{packageLabel ? ` (${packageLabel})` : ''}.</span></li>
          <li><Icon name="check" /><span>Team ownership and due dates are resolved when the case launches.</span></li>
          <li><Icon name={row.gates ? 'warning' : 'check'} /><span>
            {row.gates
              ? `${row.gates} item${row.gates === 1 ? '' : 's'} gate Day One and must be resolved before the case can complete.`
              : 'Changes must be made in Package Management, not overridden here.'}
          </span></li>
        </ul>
      </div>
      <div class="work-dialog-foot">
        <button type="button" class="btn primary" onClick={onClose}>Done</button>
      </div>
    </ObsDialog>
  );
}

/**
 * The package's approved action library, searchable. Selecting here is the SAME toggle the
 * step-3 list uses, so the two views can never disagree about what is included.
 */
function ActionLibraryDialog(
  { templates, selected, canCreateOneOff, onToggle, onCreateOneOff, onClose }: {
    templates: OnboardingActionTemplate[];
    selected: Set<string>;
    canCreateOneOff: boolean;
    onToggle: (id: string) => void;
    onCreateOneOff: () => void;
    onClose: () => void;
  },
): VNode {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? templates.filter(t => `${t.actionName} ${t.description ?? ''} ${t.ownerRole ?? ''} ${t.actionType}`.toLowerCase().includes(needle))
    : templates;
  return (
    <ObsDialog className="action-library-dialog" labelledBy="obs-library-title" onClose={onClose}>
      <div class="assignment-dialog-head">
        <span class="item-icon"><Icon name="task" /></span>
        <div>
          <h3 id="obs-library-title">Add optional action</h3>
          <p>Choose approved work from the selected package's action library.</p>
        </div>
        <button type="button" class="work-dialog-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div class="assignment-dialog-body">
        <div class="action-library-search">
          <Icon name="search" />
          <input
            class="control" type="search" value={query} placeholder="Search approved actions, teams, or outcomes"
            onInput={e => setQuery((e.target as HTMLInputElement).value)}
          />
        </div>
        {shown.length === 0
          ? (
            <div class="library-empty">
              {templates.length === 0
                ? 'This package publishes no optional work.'
                : 'No approved action matches that search.'}
            </div>
          )
          : (
            <div class="action-library-list">
              {shown.map(t => (
                <label class={`library-action${selected.has(t.id) ? ' is-selected' : ''}`} key={t.id}>
                  <input type="checkbox" checked={selected.has(t.id)} onChange={() => onToggle(t.id)} />
                  <span class={actionIconClass(t.actionType)}><Icon name={actionIcon(t.actionType)} /></span>
                  <div class="library-action-copy">
                    <strong>{t.actionName}</strong>
                    <small>{t.description ?? 'Approved package action.'}</small>
                    <div class="library-action-meta">
                      <span>{t.ownerRole ? moduleLabel(t.ownerRole) : humanize(t.ownerType)}</span>
                      <span>Creates {humanize(t.actionType).toLowerCase()}</span>
                      <span>{t.blocksOnboarding ? 'Blocking' : 'Non-blocking'}</span>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
      </div>
      <div class="action-library-foot">
        {canCreateOneOff
          ? <button class="btn" type="button" onClick={onCreateOneOff}>Create one-off action</button>
          : <span />}
        <button class="btn primary" type="button" onClick={onClose}>Done</button>
      </div>
    </ObsDialog>
  );
}

/**
 * Names an accountable owner for work the server could not resolve one for. It sets the
 * OWNING QUEUE (`ownerRole`) — the same field the launch preflight checks — rather than
 * inventing a person-assignment the launch contract has nowhere to put.
 */
function AssignOwnerDialog(
  { target, people, onAssign, onClose }: {
    target: { name: string };
    people: { id: string; name: string; subtitle: string }[];
    onAssign: (ownerRole: string, ownerEmployeeId: string | null) => void;
    onClose: () => void;
  },
): VNode {
  const [ownerRole, setOwnerRole] = useState(ONE_OFF_OWNER_ROLES[0]!);
  const [assignee, setAssignee] = useState('');
  return (
    <ObsDialog className="assignment-dialog" labelledBy="obs-assign-title" onClose={onClose}>
      <div class="assignment-dialog-head">
        <span class="item-icon"><Icon name="handoff" /></span>
        <div>
          <h3 id="obs-assign-title">Assign {target.name}</h3>
          <p>Keep the work in its owning queue and name the team accountable for completing it.</p>
        </div>
        <button type="button" class="work-dialog-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div class="assignment-dialog-body">
        <div class="assignment-field">
          <label for="obs-assign-team">Owning team / queue</label>
          <select id="obs-assign-team" class="assignment-select" value={ownerRole} onInput={e => setOwnerRole((e.target as HTMLSelectElement).value)}>
            {ONE_OFF_OWNER_ROLES.map(r => <option key={r} value={r}>{moduleLabel(r)}</option>)}
          </select>
        </div>
        <div class="assignment-field">
          <label>Accountable person</label>
          {/* Optional by design: every item keeps its owning QUEUE, and naming a person is an
              addition to that, not a replacement — which is what the note below states. */}
          <div class="assignee-options">
            {people.slice(0, 4).map(person => (
              <label class={`assignee-option${assignee === person.id ? ' is-selected' : ''}`} key={person.id}>
                <input type="radio" name="obs-accountable" value={person.id} checked={assignee === person.id} onChange={() => setAssignee(person.id)} />
                <span class="owner-avatar">{initialsOf(person.name)}</span>
                <div><strong>{person.name}</strong><small>{person.subtitle}</small></div>
              </label>
            ))}
            <label class={`assignee-option${assignee === '' ? ' is-selected' : ''}`}>
              <input type="radio" name="obs-accountable" value="" checked={assignee === ''} onChange={() => setAssignee('')} />
              <span class="owner-avatar">{moduleLabel(ownerRole).slice(0, 2).toUpperCase()}</span>
              <div><strong>Leave in {moduleLabel(ownerRole)} queue</strong><small>Visible but not assigned to a person</small></div>
            </label>
          </div>
        </div>
        <div class="assignment-dialog-note">
          <span>The team remains responsible even when a person is assigned. Reassignment is recorded in the case audit trail.</span>
        </div>
      </div>
      <div class="assignment-dialog-foot">
        <button type="button" class="btn" onClick={onClose}>Cancel</button>
        <button type="button" class="btn primary" onClick={() => onAssign(ownerRole, assignee || null)}>Save assignment</button>
      </div>
    </ObsDialog>
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
    // Department included: the approved mockup's result line is
    // "EMP-0021 · Project Manager · Administration", and department is one of the four facts
    // that decides package eligibility — useful to see before picking, not after.
    subtitle: [e.employee_number, e.position, e.departmentName].filter(Boolean).join(' · ') || null,
    photoUrl: e.profile_image_thumb_url ?? e.profile_image_url ?? e.signed_url ?? null,
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
      // The approved mockup shows a "1 matching employee" line above the results.
      showResultCount
      resultCountNoun="employee"
    />
  );
}

// One required-document row in the Documents step: shows its current compliance state and lets
// the wizard record how it will be satisfied at launch (use the doc already on file, request the
// worker upload one, or — where the requirement allows it — waive it with a reason). The
// selection here is what `documentSelections` sends to hr/onboarding/start; blocking documents
// with no satisfying selection are what `blockingDocFailures` uses to gate the Launch button.
/**
 * One outstanding requirement and its explicit disposition.
 *
 * Offers the dispositions the launch contract can actually honour: request from employee, and
 * an authorised waiver. `use_existing` is NOT offered here — the launch preflight blocks it
 * unconditionally for a non-verified requirement (it only reaches this card when the evidence
 * is missing/unverified/expired), so a button for it would look like a resolution and leave
 * launch blocked. Verified evidence is reused automatically in the "ready" list above.
 *
 * The waiver reason is an INLINE required field, not a `dialog.prompt`: the approved wizard
 * shows it on the card, and the server rejects a blank reason, so the field has to be able to
 * show its own validation error.
 */
function DocumentRequirementCard(
  { doc, employeeId, workerEmail, targetStartDate, packageLabel, selection, canWaive, canUpload, onSelect, onUploaded, onReviewInEmployeeMaster }:
  {
    doc: OnboardingIntakeDocument;
    employeeId: string;
    workerEmail: string;
    targetStartDate: string;
    packageLabel: string | null;
    selection: OnboardingDocumentLaunchSelection | null;
    canWaive: boolean;
    canUpload: boolean;
    onSelect: (sel: OnboardingDocumentLaunchSelection) => void;
    onUploaded: () => void;
    onReviewInEmployeeMaster: () => void;
  },
): VNode {
  const [waiverDraft, setWaiverDraft] = useState(selection?.waiverReason ?? '');
  const [waiverTouched, setWaiverTouched] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [expiryDraft, setExpiryDraft] = useState('');
  const waiverInvalid = selection?.action === 'waive' && waiverTouched && !waiverDraft.trim();
  const waiveAllowed = doc.canWaive && canWaive;
  const upload = useUploadHrDocument();

  async function handleFile(file: File): Promise<void> {
    setUploadError(null);
    setUploadName(file.name);
    try {
      // The governed flow: presigned URL → direct PUT → commit. The wizard never holds bytes
      // and never invents a storage path; the committed id is what the launch validates.
      const committed = await upload.mutateAsync({
        employeeId, file, documentType: doc.type,
        title: doc.label, confidentiality: 'confidential',
        // Only sent when the requirement actually tracks expiry — an empty string would
        // otherwise be stored as a date the requirement never asked for.
        ...(doc.requiresExpiry && expiryDraft ? { expiryDate: expiryDraft } : {}),
      });
      onSelect({ requirementId: doc.requirementId, action: 'upload_now', uploadedDocumentId: committed.data.id });
      onUploaded();
      toast.success(`${doc.label} uploaded — awaiting verification.`);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Upload failed.';
      setUploadError(message);
      toast.error(message);
    }
  }
  const stateLabel: Record<OnboardingIntakeDocument['state'], string> = {
    present_verified: 'Verified', present_unverified: 'Pending verification', expired: 'Expired', missing: 'Missing',
  };
  const statusText = selection?.action === 'waive' ? 'Waiver selected'
    : selection?.action === 'request_from_worker' ? 'Follow-up selected'
    : `${stateLabel[doc.state]} · decision needed`;

  return (
    <article class="document-decision-card">
      <div class="document-decision-head">
        <span class="item-icon"><Icon name="documents" /></span>
        <div class="document-decision-copy">
          <strong>{doc.label}</strong>
          <small>
            {stateLabel[doc.state]} in Employee Master{packageLabel ? ` · required by ${packageLabel}` : ''}
          </small>
        </div>
        <span class="document-impact">{statusText}</span>
      </div>

      <div class="document-requirement-facts">
        <span>{doc.isBlocking ? 'Blocks Day One' : 'Does not block Day One'}</span>
        <span>{doc.requiresExpiry ? 'Expiry required' : 'No expiry required'}</span>
        <span>{doc.canWaive ? 'Waiver permitted' : 'Waiver not permitted'}</span>
      </div>

      <div class="document-decision-controls">
        <strong>How will this requirement be handled?</strong>
        <div class="document-actions">
          {canUpload ? (
            <button
              class={`doc-choice${selection?.action === 'upload_now' ? ' active' : ''}`} type="button"
              onClick={() => onSelect({ requirementId: doc.requirementId, action: 'upload_now', uploadedDocumentId: selection?.uploadedDocumentId ?? null })}
            >Upload document now</button>
          ) : null}
          <button
            class={`doc-choice${selection?.action === 'request_from_worker' ? ' active' : ''}`} type="button"
            onClick={() => onSelect({ requirementId: doc.requirementId, action: 'request_from_worker' })}
          >Request from employee</button>
          {waiveAllowed ? (
            <button
              class={`doc-choice${selection?.action === 'waive' ? ' active' : ''}`} type="button"
              onClick={() => onSelect({ requirementId: doc.requirementId, action: 'waive', waiverReason: waiverDraft.trim() || null })}
            >Authorised waiver</button>
          ) : null}
        </div>

        {selection?.action === 'upload_now' && (
          <div class="document-decision-panel">
            <div class="document-decision-panel-head">
              <div>
                <strong>Upload a valid record</strong>
                <small>The file is stored in Employee Master and linked to this onboarding requirement.</small>
              </div>
            </div>
            {doc.requiresExpiry ? (
              <div class="assignment-field">
                <label for={`obs-expiry-${doc.requirementId}`}>Expiry date</label>
                <input
                  id={`obs-expiry-${doc.requirementId}`} class="control" type="date" value={expiryDraft}
                  onInput={e => setExpiryDraft((e.target as HTMLInputElement).value)}
                />
                <small class="hint">This requirement tracks expiry — set it before choosing the file.</small>
              </div>
            ) : null}
            <label class="document-upload-zone">
              <span>
                <strong>{uploadName || 'Choose PDF, JPG or PNG'}</strong>
                <small>The record is filed against this employee and must be verified before it counts as evidence.</small>
              </span>
              <span class="btn compact">{upload.isPending ? 'Uploading…' : 'Choose file'}</span>
              <input
                type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                disabled={upload.isPending}
                onChange={e => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (file) void handleFile(file);
                }}
              />
            </label>
            {uploadError ? <span class="obs-field-error">{uploadError}</span> : null}
            {selection.uploadedDocumentId ? (
              <div class="document-upload-result">
                <span class={`pill ${doc.state === 'present_verified' ? 'green' : 'amber'}`}>
                  {doc.state === 'present_verified' ? 'Verified' : 'Awaiting verification'}
                </span>
                {doc.state !== 'present_verified' ? (
                  <>
                    <p class="hint">
                      {doc.isBlocking
                        ? 'This requirement blocks Day One, so launch stays blocked until the upload is verified.'
                        : 'Launch will create a linked review task; the document is verified after launch.'}
                    </p>
                    <button class="btn compact" type="button" onClick={onReviewInEmployeeMaster}>
                      Review in Employee Master
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        )}

        {selection?.action === 'request_from_worker' && (
          <div class="document-decision-panel">
            <div class="document-decision-panel-head">
              <div>
                <strong>Send a secure document request</strong>
                <small>The employee receives a single-use upload link after the case launches.</small>
              </div>
            </div>
            <div class="document-request-grid">
              <div class="assignment-field">
                <label for={`obs-req-to-${doc.requirementId}`}>Send to</label>
                {/* Read-only: the destination is the employee's own record, never free text —
                    a typo here would send a document request to a stranger. */}
                <input id={`obs-req-to-${doc.requirementId}`} class="control" value={workerEmail} readOnly />
              </div>
              <div class="assignment-field">
                <label for={`obs-req-due-${doc.requirementId}`}>Due date</label>
                <input id={`obs-req-due-${doc.requirementId}`} class="control" type="date" value={targetStartDate} readOnly />
              </div>
            </div>
            <div class="document-request-note">
              The request, due date and delivery status remain visible in Case Detail. The employee cannot browse any other employee documents.
            </div>
            {doc.isBlocking
              ? <p class="document-launch-impact">This requirement blocks Day One, so a follow-up alone will not clear the launch check — it needs verified evidence or an authorised waiver.</p>
              : null}
          </div>
        )}

        {selection?.action === 'waive' && (
          <div class="document-decision-panel">
            <div class="document-decision-panel-head">
              <div>
                <strong>Authorised waiver</strong>
                <small>Recorded against your name with a reason and an audit entry.</small>
              </div>
            </div>
            <div class={`assignment-field${waiverInvalid ? ' is-error' : ''}`}>
              <label for={`obs-waiver-${doc.requirementId}`}>Waiver reason <span class="req">*</span></label>
              <input
                id={`obs-waiver-${doc.requirementId}`} class="control" type="text" value={waiverDraft}
                placeholder="Why is this document being waived?"
                aria-invalid={waiverInvalid ? 'true' : undefined}
                onInput={e => {
                  const next = (e.target as HTMLInputElement).value;
                  setWaiverDraft(next);
                  onSelect({ requirementId: doc.requirementId, action: 'waive', waiverReason: next.trim() || null });
                }}
                onBlur={() => setWaiverTouched(true)}
              />
              {waiverInvalid ? <span class="obs-field-error">A waiver reason is required.</span> : null}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
