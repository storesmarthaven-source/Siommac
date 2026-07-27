/**
 * src/components/sections/HR/EmployeeCreatePage.tsx
 *
 * HR ▸ Employee Master ▸ Create Employee — FULL-PAGE PRODUCTION WIZARD (v2).
 *
 * Replaces the legacy modal `CreateEmployeeWizard` which had:
 *   • password field (HR should never set passwords)
 *   • raw role picker (exposure of internal role strings)
 *   • best-effort onboarding (no preflight, failed silently)
 *   • statutory writes to hr_employee_statutory (legacy table)
 *
 * Steps:
 *   1. Personal & Identity   — name, contact, employee number, government IDs
 *   2. Employment            — type, start date, grade, probation
 *   3. Assignment            — department, site, supervisor, position
 *   4. Statutory & Payroll   — NIS, BIR, PAYE, TD1, Health Surcharge
 *   5. Account & Onboarding  — access profile, account mode, onboarding package
 *   6. Review & Create       — summary + submission receipt
 *
 * Draft auto-save persists on every step advance. On mount, if a draft exists the
 * page offers to resume it before showing the blank form.
 *
 * MARKUP CONTRACT: the DOM structure and class vocabulary come from the approved
 * mockups (docs/mockups/employee-create-wizard-*). Every class here is defined in
 * EmployeeCreatePage.css, which scopes the mockup's generic names (.card, .btn,
 * .field, .control…) under the `.emp-create-page` root so they cannot leak into the
 * rest of the app. Step navigation uses the SIOMAC UI-kit <Stepper>.
 */

import { type VNode } from 'preact';
import { useState, useEffect, useMemo, useCallback, useId, useRef } from 'preact/hooks';
import { Stepper, LucideIcon, type StepperStep } from '@ui';
import './EmployeeCreatePage.css';
import { toast } from '@store';
import {
  useHrOrgUnits, useHrSites, useHrEmployees,
  useHrAccessProfiles, useCreateHrEmployeeV2,
  useWizardDraftGet, useWizardDraftSave, useWizardDraftDelete,
  type CreateHrEmployeeArgsV2, type WizardAccountMode,
  type CreateEmployeeReceiptV2,
} from '@api/hr/employees';
import { useOnboardingPackages } from '@api/hr/onboarding';
import { rowName } from './shared';

// ── Step definitions ──────────────────────────────────────────────────────────

const WIZARD_STEPS: StepperStep[] = [
  { key: 'identity',   label: 'Personal & Identity',  description: 'Name, contact, IDs' },
  { key: 'employment', label: 'Employment',           description: 'Type & start date' },
  { key: 'assignment', label: 'Assignment',           description: 'Department & reporting' },
  { key: 'statutory',  label: 'Statutory & Payroll',  description: 'NIS, BIR, PAYE, HS' },
  { key: 'account',    label: 'Account & Onboarding', description: 'Access & invite' },
  { key: 'review',     label: 'Review & Create',      description: 'Confirm and submit' },
];

const STEP_INTRO: { title: string; blurb: string; icon: 'IdCard' | 'BriefcaseBusiness' | 'Building2' | 'BadgeDollarSign' | 'ShieldCheck' | 'ClipboardCheck' }[] = [
  { title: 'Personal & Identity',           blurb: 'Who this person is. Identity fields are audited and restricted.',            icon: 'IdCard' },
  { title: 'Employment',                    blurb: 'Engagement type, start date and probation terms.',                          icon: 'BriefcaseBusiness' },
  { title: 'Organisational Assignment',     blurb: 'Where they report. Assignment can be updated after creation.',              icon: 'Building2' },
  { title: 'Statutory & Payroll Readiness', blurb: 'Written to the canonical statutory profile. Finance verifies separately.',  icon: 'BadgeDollarSign' },
  { title: 'Account & Onboarding',          blurb: 'How access is granted and whether an onboarding draft is prepared.',                 icon: 'ShieldCheck' },
  { title: 'Review & Create',               blurb: 'Confirm every value before the record is created.',                          icon: 'ClipboardCheck' },
];

const EMPLOYMENT_TYPES = [
  { id: 'employee',   label: 'Permanent Employee' },
  { id: 'contractor', label: 'Contractor' },
  { id: 'intern',     label: 'Intern' },
  { id: 'temporary',  label: 'Temporary' },
  { id: 'consultant', label: 'Consultant' },
  { id: 'seconded',   label: 'Seconded' },
];

const NIS_STATUSES = [
  { id: 'pending',        label: 'Pending Registration' },
  { id: 'registered',     label: 'Registered' },
  { id: 'exempt',         label: 'Exempt' },
  { id: 'not_applicable', label: 'Not Applicable' },
];

const RECORD_STATUSES = [
  { id: 'active',             label: 'Active' },
  { id: 'probation',          label: 'Probation' },
  { id: 'pending_onboarding', label: 'Pending Start' },
  { id: 'draft',              label: 'Draft (not yet active)' },
];

// Only the modes the CREATE CONTRACT actually accepts. The backend schema is
// `accountMode: z.literal('no_login')` — offering an invite option here would be a
// control that the server rejects. Additional modes return when account provisioning
// is wired end to end (governed invite, never an HR-set password).
// Only the modes the CREATE CONTRACT actually accepts. The backend schema is
// `accountMode: z.literal('no_login')` — offering an invite option here would be a
// control the server rejects. More modes return when governed account provisioning
// is wired end to end (invite-based, never an HR-set password).
// ── Draft shape (matches form state for serialisation) ────────────────────────

export interface FormState {
  // Step 1 — Personal & Identity
  firstName: string; lastName: string; preferredName: string;
  username: string; employeeNumber: string;
  email: string; personalEmail: string; phone: string;
  dateOfBirth: string; nationality: string; governmentId: string;
  // Step 2 — Employment
  employmentType: string; startDate: string; position: string;
  probationEndDate: string; employeeGrade: string; workSchedule: string;
  recordStatus: string;
  // Step 3 — Assignment
  departmentId: string; siteId: string; supervisorId: string;
  effectiveDate: string;
  // Step 4 — Statutory
  nisNumber: string; nisStatus: string; nisEffectiveDate: string;
  birFileNumber: string; payeApplicable: boolean;
  td1Received: boolean; td1EffectiveYear: string;
  hsApplicable: boolean; hsExemptionReason: string;
  hsEffectiveDate: string; hsVerificationRequired: boolean;
  // Step 5 — Account & Onboarding
  accessProfileId: string; accountMode: WizardAccountMode;
  prepareOnboarding: boolean; packageKey: string;
}

export const EMPTY_FORM: FormState = {
  firstName: '', lastName: '', preferredName: '', username: '', employeeNumber: '',
  email: '', personalEmail: '', phone: '', dateOfBirth: '', nationality: '', governmentId: '',
  employmentType: 'employee', startDate: '', position: '', probationEndDate: '',
  employeeGrade: '', workSchedule: '', recordStatus: 'active',
  departmentId: '', siteId: '', supervisorId: '', effectiveDate: '',
  nisNumber: '', nisStatus: 'pending', nisEffectiveDate: '', birFileNumber: '',
  payeApplicable: true, td1Received: false, td1EffectiveYear: '',
  hsApplicable: true, hsExemptionReason: '', hsEffectiveDate: '', hsVerificationRequired: false,
  accessProfileId: '', accountMode: 'no_login',
  prepareOnboarding: false, packageKey: '',
};

// ── Validation helpers (exported for unit tests) ──────────────────────────────

export function reqStr(v: string, label: string): string | null {
  return v.trim() ? null : `${label} is required.`;
}
export function validEmail(v: string): string | null {
  if (!v.trim()) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? null : 'Invalid email address.';
}
export function validDate(v: string, label: string): string | null {
  if (!v.trim()) return null;
  const value = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${label}: use YYYY-MM-DD format.`;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? null
    : `${label}: enter a real calendar date.`;
}

export function validateStep(step: number, f: FormState): Record<string, string> {
  const errs: Record<string, string> = {};
  const add = (k: string, v: string | null) => { if (v) errs[k] = v; };
  if (step === 0) {
    add('firstName', reqStr(f.firstName, 'First name'));
    add('lastName',  reqStr(f.lastName,  'Last name'));
    add('username',  reqStr(f.username,  'Username'));
    if (f.username.trim() && !/^[\w.-]{1,80}$/.test(f.username.trim())) errs['username'] = 'Username: letters, digits, dots, hyphens only (max 80).';
    add('email',         validEmail(f.email));
    add('personalEmail', validEmail(f.personalEmail));
    add('dateOfBirth',   validDate(f.dateOfBirth, 'Date of birth'));
    if (f.dateOfBirth && f.dateOfBirth >= new Date().toISOString().slice(0, 10)) {
      errs['dateOfBirth'] = 'Date of birth must be before today.';
    }
  }
  if (step === 1) {
    add('startDate', reqStr(f.startDate, 'Start date'));
    add('startDate', validDate(f.startDate, 'Start date'));
    add('probationEndDate', validDate(f.probationEndDate, 'Probation end date'));
    if (f.startDate && f.probationEndDate && f.probationEndDate < f.startDate) {
      errs['probationEndDate'] = 'Probation end date cannot be before the start date.';
    }
  }
  if (step === 2) {
    add('effectiveDate', validDate(f.effectiveDate, 'Assignment effective date'));
    if (f.startDate && f.effectiveDate && f.effectiveDate < f.startDate) {
      errs['effectiveDate'] = 'Assignment effective date cannot be before the start date.';
    }
  }
  if (step === 4) {
    // Fail closed. `access.accessProfileId` is REQUIRED by the create contract, so a
    // blank selection (including when the profile registry is unreachable and the list
    // is empty) must block here rather than be rejected by the server or, worse,
    // silently defaulted to some role.
    add('accessProfileId', reqStr(f.accessProfileId, 'Access profile'));
  }
  if (step === 3) {
    add('nisEffectiveDate', validDate(f.nisEffectiveDate, 'NIS effective date'));
    add('hsEffectiveDate',  validDate(f.hsEffectiveDate,  'HS effective date'));
    if (f.td1EffectiveYear.trim() && !/^\d{4}$/.test(f.td1EffectiveYear.trim())) errs['td1EffectiveYear'] = 'TD1 effective year: four-digit year.';
    if (f.nisStatus === 'registered' && !f.nisNumber.trim()) errs['nisNumber'] = 'NIS number is required when status is Registered.';
  }
  if (step === 4 && f.prepareOnboarding) add('packageKey', reqStr(f.packageKey, 'Onboarding package'));
  return errs;
}

/** Statutory completeness, mirrored from the backend readiness rules — drives the
 *  step-4 progress line and blockers panel. Exported for unit tests. */
export function statutoryBlockers(f: FormState): string[] {
  const out: string[] = [];
  if (f.nisStatus === 'pending' || !f.nisNumber.trim()) out.push('NIS registration number is not on file.');
  if (f.payeApplicable && !f.birFileNumber.trim())      out.push('BIR file number is required when PAYE applies.');
  if (f.payeApplicable && !f.td1Received)               out.push('TD1 declaration has not been received.');
  if (f.hsApplicable && !f.hsEffectiveDate.trim())      out.push('Health Surcharge effective date is missing.');
  return out;
}

// ── Small field widgets (mockup vocabulary: .field / .control) ─────────────────

function Field({ label, value, onInput, error, type = 'text', placeholder, required, hint }: {
  label: string; value: string; onInput: (v: string) => void;
  error?: string | null; type?: string; placeholder?: string; required?: boolean; hint?: string;
}): VNode {
  const id = useId();
  const helpId = `${id}-help`;
  return (
    <div class="field">
      <label htmlFor={id}>{label}{required && <em aria-hidden="true"> *</em>}</label>
      <input
        id={id}
        type={type} value={value} placeholder={placeholder ?? ''}
        class={`control${error ? ' is-error' : ''}`}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error || hint ? helpId : undefined}
        onInput={e => onInput((e.target as HTMLInputElement).value)}
      />
      {error ? <span id={helpId} class="field-error" role="alert">{error}</span> : hint ? <small id={helpId}>{hint}</small> : null}
    </div>
  );
}

function SelectField({ label, value, onInput, options, placeholder, error, required, hint }: {
  label: string; value: string; onInput: (v: string) => void;
  options: { id: string; label?: string; name?: string }[];
  placeholder?: string; error?: string | null; required?: boolean; hint?: string;
}): VNode {
  const id = useId();
  const helpId = `${id}-help`;
  return (
    <div class="field">
      <label htmlFor={id}>{label}{required && <em aria-hidden="true"> *</em>}</label>
      <select id={id} class={`control${error ? ' is-error' : ''}`} value={value}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error || hint ? helpId : undefined}
        onChange={e => onInput((e.target as HTMLSelectElement).value)}>
        <option value="">{placeholder ?? `— Select ${label} —`}</option>
        {options.map(o => <option key={o.id} value={o.id}>{o.label ?? o.name ?? o.id}</option>)}
      </select>
      {error ? <span id={helpId} class="field-error" role="alert">{error}</span> : hint ? <small id={helpId}>{hint}</small> : null}
    </div>
  );
}

/** Toggle row using the mockup's .check-row grid (icon · body · tail). */
function CheckRow({ label, checked, onChange, description }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; description?: string;
}): VNode {
  return (
    <label class="check-row">
      <span class={`check-icon${checked ? '' : ' warn'}`}>
        <input type="checkbox" checked={checked}
          onChange={e => onChange((e.target as HTMLInputElement).checked)} />
      </span>
      <span>
        <strong>{label}</strong>
        {description && <p>{description}</p>}
      </span>
      <span class={`badge ${checked ? 'green' : ''}`}>{checked ? 'Yes' : 'No'}</span>
    </label>
  );
}

function SectionBox({ title, icon, children }: {
  title: string; icon: 'ShieldCheck' | 'BadgeDollarSign' | 'HeartPulse' | 'UserRoundCog' | 'ListChecks';
  children: VNode | (VNode | null | false)[];
}): VNode {
  return (
    <div class="section-box">
      <div class="section-box-head">
        <LucideIcon name={icon} size={18} />
        <h3>{title}</h3>
      </div>
      {children}
    </div>
  );
}

// ── Build API args from form (exported for unit tests) ───────────────────────

export function formToArgs(f: FormState, requestKey: string): CreateHrEmployeeArgsV2 {
  return {
    requestKey,
    identity: {
      username:       f.username.trim(),
      firstName:      f.firstName.trim(),
      lastName:       f.lastName.trim(),
      email:          f.email.trim()          || undefined,
      personalEmail:  f.personalEmail.trim()  || undefined,
      phone:          f.phone.trim()          || undefined,
      employeeNumber: f.employeeNumber.trim() || undefined,
      dateOfBirth:    f.dateOfBirth.trim()    || undefined,
      nationality:    f.nationality.trim()    || undefined,
      preferredName:  f.preferredName.trim()  || undefined,
      governmentId:   f.governmentId.trim()   || undefined,
    },
    employment: {
      employmentType:   f.employmentType,
      startDate:        f.startDate.trim(),
      position:         f.position.trim()         || undefined,
      probationEndDate: f.probationEndDate.trim() || undefined,
      employeeGrade:    f.employeeGrade.trim()    || undefined,
      workSchedule:     f.workSchedule.trim()     || undefined,
    },
    assignment: {
      departmentId:  f.departmentId || null,
      siteId:        f.siteId       || null,
      supervisorId:  f.supervisorId || null,
      effectiveDate: f.effectiveDate.trim() || undefined,
    },
    access: {
      accessProfileId: f.accessProfileId,
      accountMode:     f.accountMode,
    },
    recordStatus: f.recordStatus || 'active',
    statutory: {
      nisNumber:              f.nisNumber.trim()        || null,
      nisStatus:              f.nisStatus               || undefined,
      nisApplicable:          f.nisStatus !== 'not_applicable',
      nisEffectiveDate:       f.nisEffectiveDate.trim() || null,
      birFileNumber:          f.birFileNumber.trim()    || null,
      payeApplicable:         f.payeApplicable,
      td1Received:            f.td1Received,
      td1EffectiveYear:       f.td1EffectiveYear.trim() ? parseInt(f.td1EffectiveYear.trim(), 10) : null,
      hsApplicable:           f.hsApplicable,
      hsExemptionReason:      f.hsExemptionReason.trim() || null,
      hsEffectiveDate:        f.hsEffectiveDate.trim()   || null,
      hsVerificationRequired: f.hsVerificationRequired,
    },
    onboarding: {
      prepareOnboarding: f.prepareOnboarding,
      packageKey:        f.prepareOnboarding ? (f.packageKey || undefined) : undefined,
    },
  };
}

// ── Review + receipt rows ─────────────────────────────────────────────────────

function SummaryRow({ label, value }: { label: string; value: string | null | undefined }): VNode | null {
  if (!value) return null;
  return <div class="summary-row"><span>{label}</span><strong>{value}</strong></div>;
}

function SummaryCard({ title, icon, children }: {
  title: string; icon: 'IdCard' | 'BriefcaseBusiness' | 'Building2' | 'BadgeDollarSign' | 'ShieldCheck';
  children: (VNode | null)[];
}): VNode {
  return (
    <div class="summary-card">
      <div class="summary-card-head"><LucideIcon name={icon} size={19} /><h3>{title}</h3></div>
      {children}
    </div>
  );
}

// ── Submission Receipt (full-page state) ──────────────────────────────────────

function SubmissionReceipt({ receipt, onClose }: { receipt: CreateEmployeeReceiptV2; onClose: () => void }): VNode {
  return (
    <div class="success-shell">
      <div class="card success-hero">
        <div class="success-icon"><LucideIcon name="CircleCheck" size={34} /></div>
        <h1>Employee Created</h1>
        <p>The employee record has been created and every downstream effect below has been recorded.</p>
        <div class="receipt-id">{receipt.employee_no}</div>

        <div class="metric-grid" style={{ marginTop: '22px', textAlign: 'left' }}>
          <div class="metric"><span>Employee No.</span><strong>{receipt.employee_no}</strong></div>
          <div class="metric"><span>Record Status</span><strong>{receipt.status}</strong></div>
          <div class="metric"><span>Payroll Readiness</span><strong>{receipt.payroll_readiness}</strong></div>
          <div class="metric"><span>Onboarding</span><strong>{receipt.onboarding_status === 'draft_prepared' ? 'Draft prepared' : 'Not started'}</strong></div>
        </div>

        <div class="outcome-list" style={{ marginTop: '18px', textAlign: 'left' }}>
          <div class="outcome">
            <span class="status-icon"><LucideIcon name="IdCard" size={20} /></span>
            <span><strong>Employee record</strong><p>Created and audited.</p></span>
            <span class="outcome-tail"><span class="badge green">Done</span></span>
          </div>
          <div class="outcome">
            <span class="status-icon"><LucideIcon name="Mail" size={20} /></span>
            <span><strong>Account</strong><p>No login created — request access separately</p></span>
            <span class="outcome-tail"><span class="badge">{receipt.account_status === 'not_requested' ? 'Not requested' : receipt.account_status}</span></span>
          </div>
          <div class="outcome">
            <span class="status-icon"><LucideIcon name="ListChecks" size={20} /></span>
            <span><strong>Onboarding</strong><p>{receipt.onboarding_case_no ?? 'Not requested'}</p></span>
            <span class="outcome-tail">
              <span class={`badge ${receipt.onboarding_status === 'draft_prepared' ? 'blue' : ''}`}>
                {receipt.onboarding_status === 'draft_prepared' ? 'Draft prepared' : 'Not requested'}
              </span>
            </span>
          </div>
        </div>

        <div class="receipt-actions">
          <button type="button" class="btn primary" onClick={onClose}>Back to Employee Register</button>
        </div>
      </div>
    </div>
  );
}

// ── Draft Recovery (full-page state) ──────────────────────────────────────────

function DraftRecovery({ label, savedAt, stepIndex, onResume, onDiscard }: {
  label: string | null; savedAt: string | null; stepIndex: number;
  onResume: () => void; onDiscard: () => void;
}): VNode {
  const stepLabel = WIZARD_STEPS[Math.min(stepIndex, WIZARD_STEPS.length - 1)]?.label ?? 'Personal & Identity';
  return (
    <div class="card panel" style={{ marginBottom: '18px' }}>
      <div class="panel-title">
        <span class="section-icon"><LucideIcon name="RotateCcw" size={22} /></span>
        <div>
          <h2>Resume your unfinished draft?</h2>
          <p>An employee record was started but never submitted. Nothing has been created yet.</p>
        </div>
      </div>
      <div class="draft-list">
        <div class="draft-row">
          <span class="draft-mark"><LucideIcon name="FileText" size={20} /></span>
          <div>
            <strong>{label?.trim() || 'Unnamed draft'}</strong>
            <p>Draft — not yet submitted</p>
          </div>
          <div>
            <strong>{stepLabel}</strong>
            <p>Last step reached</p>
          </div>
          <div>
            <strong>{savedAt ? new Date(savedAt).toLocaleString() : '—'}</strong>
            <p>Last saved</p>
          </div>
          <div class="draft-actions">
            <button type="button" class="btn ghost" onClick={onDiscard}>Start Fresh</button>
            <button type="button" class="btn primary" onClick={onResume}>Resume</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function EmployeeCreatePage({ onClose }: { onClose: () => void }): VNode {
  const requestKey = useRef(crypto.randomUUID());
  const [step, setStep]               = useState(0);
  const [maxStep, setMaxStep]         = useState(0);
  const [form, setForm]               = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors]           = useState<Record<string, string>>({});
  const [touched, setTouched]         = useState<Set<string>>(new Set());
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Draft state machine: 'checking' → 'has_draft' | 'none' | 'dismissed'
  type DraftState = 'checking' | 'has_draft' | 'none' | 'dismissed';
  const [draftState, setDraftState]   = useState<DraftState>('checking');
  const [receipt, setReceipt]         = useState<CreateEmployeeReceiptV2 | null>(null);

  // Queries
  const orgQ      = useHrOrgUnits();
  const siteQ     = useHrSites();
  const supQ      = useHrEmployees({ limit: 500 });
  const profilesQ = useHrAccessProfiles();
  const packagesQ = useOnboardingPackages(false);
  const draftGetQ = useWizardDraftGet();
  const draftSave = useWizardDraftSave();
  const draftDel  = useWizardDraftDelete();
  const createMut = useCreateHrEmployeeV2();

  // Draft recovery — on first load, if draft exists offer to resume
  useEffect(() => {
    if (draftGetQ.isLoading) return;
    setDraftState(draftGetQ.data ? 'has_draft' : 'none');
  }, [draftGetQ.isLoading, draftGetQ.data]);

  const resumeDraft = useCallback(() => {
    const d = draftGetQ.data;
    if (!d?.draft_data) return;
    if (typeof d.draft_data !== 'object' || Array.isArray(d.draft_data)) {
      toast.error('This draft is corrupt and cannot be resumed. Discard it to start again.');
      return;
    }
    const saved = d.draft_data as Partial<FormState>;
    setForm(f => ({ ...f, ...saved }));
    setStep(d.step_index ?? 0);
    setMaxStep(d.step_index ?? 0);
    setDraftState('dismissed');
  }, [draftGetQ.data]);

  const discardDraft = useCallback(async () => {
    try {
      await draftDel.mutateAsync();
      setDraftState('dismissed');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not discard the draft.');
    }
  }, [draftDel]);

  // Memoised lookup lists
  const departments = useMemo(() =>
    (orgQ.data ?? []).map(u => ({ id: u.id, label: u.name })), [orgQ.data]);
  const sites = useMemo(() =>
    (siteQ.data ?? []).map(s => ({ id: s.id, label: s.name })), [siteQ.data]);
  const supervisors = useMemo(() =>
    (supQ.data ?? []).map(r => ({ id: r.id, label: rowName(r) })), [supQ.data]);
  const profiles = useMemo(() =>
    (profilesQ.data ?? []).filter(p => p.is_active).map(p => ({ id: p.id, label: p.label, code: p.code })), [profilesQ.data]);
  const packages = useMemo(() =>
    (packagesQ.data ?? []).filter(p => p.status === 'active').map(p => ({ id: p.key, label: p.label })), [packagesQ.data]);

  // Form field setter — touch the field so its error becomes visible
  const setField = useCallback(<K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm(f => ({ ...f, [k]: v }));
    setTouched(t => { const n = new Set(t); n.add(k); return n; });
  }, []);

  // Step completion — a step is "complete" when it has no validation errors
  const stepErrors = useMemo(() => WIZARD_STEPS.map((_, i) => validateStep(i, form)), [form]);
  const completed  = useMemo(() => stepErrors.map(e => Object.keys(e).length === 0), [stepErrors]);

  // Inline errors for the current step (show only touched fields unless submit attempted)
  const visibleErrors = useMemo(() => {
    if (submitAttempted) return errors;
    return Object.fromEntries(Object.entries(errors).filter(([k]) => touched.has(k)));
  }, [errors, touched, submitAttempted]);

  useEffect(() => { setErrors(validateStep(step, form)); }, [step, form]);

  const registryBlocked = step === 4 && (profilesQ.isError || (form.prepareOnboarding && packagesQ.isError));
  const canAdvance = Object.keys(validateStep(step, form)).length === 0 && !registryBlocked;

  useEffect(() => {
    if (form.accessProfileId || !profiles.length) return;
    const employeeProfile = profiles.find(profile => profile.code === 'employee') ?? profiles[0];
    if (employeeProfile) setForm(current => ({ ...current, accessProfileId: employeeProfile.id }));
  }, [form.accessProfileId, profiles]);

  const goTo = async (i: number) => {
    const revalidated = validateStep(step, form);
    if (Object.keys(revalidated).length > 0) {
      setErrors(revalidated);
      setSubmitAttempted(true);
      return;
    }
    const label = `${form.firstName.trim()} ${form.lastName.trim()}`.trim() || form.username.trim() || undefined;
    try {
      await draftSave.mutateAsync({ draftData: form, stepIndex: i, label });
      setStep(i);
      setMaxStep(m => Math.max(m, i));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the employee draft.');
    }
  };

  const next = () => { if (step < WIZARD_STEPS.length - 1) void goTo(step + 1); };
  const back = () => {
    if (step > 0) { setStep(s => s - 1); setSubmitAttempted(false); }
  };

  const handleCreate = async () => {
    const allErrs: Record<string, string> = {};
    WIZARD_STEPS.forEach((_, i) => { Object.assign(allErrs, validateStep(i, form)); });
    if (Object.keys(allErrs).length > 0) {
      setErrors(allErrs);
      setSubmitAttempted(true);
      toast.error('Please fix the validation errors before creating.');
      return;
    }
    setSubmitAttempted(true);
    try {
      const data = await createMut.mutateAsync(formToArgs(form, requestKey.current));
      try {
        await draftDel.mutateAsync();
      } catch {
        toast.error('Employee created, but the saved draft could not be removed. It can be discarded from the register.');
      }
      toast(`Employee ${data.data.employee_no} created successfully.`);
      setReceipt(data.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create employee.');
    }
  };

  // ── Render: receipt state ──────────────────────────────────────────────────
  if (receipt) {
    return (
      <div class="emp-create-page">
        <div class="page">
          <SubmissionReceipt receipt={receipt} onClose={onClose} />
        </div>
      </div>
    );
  }

  const err = (k: string) => visibleErrors[k] ?? null;
  const initials = [form.firstName, form.lastName].map(s => s.trim().charAt(0).toUpperCase()).filter(Boolean).join('') || '—';
  const displayName = [form.preferredName.trim() || form.firstName.trim(), form.lastName.trim()].filter(Boolean).join(' ');
  const blockers = statutoryBlockers(form);
  const readyPercent = Math.round(((4 - blockers.length) / 4) * 100);
  const intro = STEP_INTRO[step]!;

  // ── Step bodies ───────────────────────────────────────────────────────────

  const identityStep = (
    <div class="grid-3-1">
      <div class="card panel">
        <div class="dossier-head">
          <div class="avatar" aria-hidden="true">{initials}</div>
          <div>
            <h2>{displayName || 'New employee'}</h2>
            <div class="identity-meta">
              <span><LucideIcon name="AtSign" size={14} />{form.username.trim() || 'username pending'}</span>
              <span><LucideIcon name="Hash" size={14} />{form.employeeNumber.trim() || 'auto-assigned'}</span>
              <span><LucideIcon name="Mail" size={14} />{form.email.trim() || 'no work email'}</span>
            </div>
          </div>
          <span class="restricted"><LucideIcon name="LockKeyhole" size={13} />Restricted — audited</span>
        </div>

        <div class="dossier-section">
          <h3>Legal name</h3>
          <div class="grid-3">
            <Field label="First Name" value={form.firstName} onInput={v => setField('firstName', v)} error={err('firstName')} required />
            <Field label="Last Name"  value={form.lastName}  onInput={v => setField('lastName',  v)} error={err('lastName')}  required />
            <Field label="Preferred Name" value={form.preferredName} onInput={v => setField('preferredName', v)} placeholder="Display name (optional)" />
          </div>
        </div>

        <div class="dossier-section">
          <h3>Identifiers</h3>
          <div class="grid-3">
            <Field label="Username" value={form.username} onInput={v => setField('username', v)} error={err('username')} required placeholder="login handle" />
            <Field label="Employee Number" value={form.employeeNumber} onInput={v => setField('employeeNumber', v)} placeholder="Auto-assigned if blank" />
            <Field label="Government ID" value={form.governmentId} onInput={v => setField('governmentId', v)} placeholder="National ID / Passport" />
          </div>
        </div>

        <div class="dossier-section">
          <h3>Contact</h3>
          <div class="grid-3">
            <Field label="Work Email"     value={form.email}         onInput={v => setField('email',         v)} error={err('email')}         type="email" placeholder="Optional" />
            <Field label="Personal Email" value={form.personalEmail} onInput={v => setField('personalEmail', v)} error={err('personalEmail')} type="email" placeholder="Optional" />
            <Field label="Phone"          value={form.phone}         onInput={v => setField('phone',         v)} placeholder="Optional" />
          </div>
        </div>

        <div class="dossier-section">
          <h3>Personal</h3>
          <div class="grid-2">
            <Field label="Date of Birth" value={form.dateOfBirth} onInput={v => setField('dateOfBirth', v)} error={err('dateOfBirth')} type="date" />
            <Field label="Nationality"   value={form.nationality} onInput={v => setField('nationality',   v)} placeholder="Optional" />
          </div>
        </div>
      </div>

      <div class="side-stack">
        <div class="card side-panel readiness-list">
          <h3>Record readiness</h3>
          <div class={`readiness-row${form.firstName.trim() && form.lastName.trim() ? '' : ' pending'}`}>
            <LucideIcon name={form.firstName.trim() && form.lastName.trim() ? 'CircleCheck' : 'CircleAlert'} size={20} />
            <div><strong>Legal name</strong><span>{form.firstName.trim() && form.lastName.trim() ? 'Captured' : 'Required'}</span></div>
          </div>
          <div class={`readiness-row${form.username.trim() ? '' : ' pending'}`}>
            <LucideIcon name={form.username.trim() ? 'CircleCheck' : 'CircleAlert'} size={20} />
            <div><strong>Username</strong><span>{form.username.trim() ? 'Captured' : 'Required'}</span></div>
          </div>
          <div class={`readiness-row${form.email.trim() || form.personalEmail.trim() ? '' : ' pending'}`}>
            <LucideIcon name={form.email.trim() || form.personalEmail.trim() ? 'CircleCheck' : 'CircleAlert'} size={20} />
            <div><strong>Contact</strong><span>{form.email.trim() || form.personalEmail.trim() ? 'Reachable' : 'No email on file'}</span></div>
          </div>
          <div class="readiness-row locked">
            <LucideIcon name="LockKeyhole" size={20} />
            <div><strong>Account</strong><span>Set in step 5</span></div>
          </div>
        </div>
        <div class="card side-panel">
          <h3>Why this matters</h3>
          <div class="mini-row">
            <LucideIcon name="ShieldCheck" size={20} />
            <div><strong>Identity is audited</strong><span>Every change is written to the HR audit log.</span></div>
          </div>
          <div class="mini-row">
            <LucideIcon name="KeyRound" size={20} />
            <div><strong>No passwords here</strong><span>HR never sets or sees a password.</span></div>
          </div>
        </div>
      </div>
    </div>
  );

  const employmentStep = (
    <div class="card panel">
      <div class="grid-2">
        <SelectField label="Employment Type" value={form.employmentType} onInput={v => setField('employmentType', v)} options={EMPLOYMENT_TYPES} />
        <SelectField label="Initial Status"  value={form.recordStatus}   onInput={v => setField('recordStatus', v)}  options={RECORD_STATUSES} />
        <Field label="Start Date"          value={form.startDate}        onInput={v => setField('startDate',        v)} error={err('startDate')} type="date" required />
        <Field label="Probation End Date"  value={form.probationEndDate} onInput={v => setField('probationEndDate', v)} error={err('probationEndDate')} type="date" hint="Optional" />
        <Field label="Position / Job Title" value={form.position}        onInput={v => setField('position',      v)} placeholder="e.g. HSE Officer" />
        <Field label="Employee Grade"       value={form.employeeGrade}   onInput={v => setField('employeeGrade', v)} placeholder="e.g. Grade 3" />
        <Field label="Work Schedule"        value={form.workSchedule}    onInput={v => setField('workSchedule',  v)} placeholder="e.g. Day Shift" />
      </div>
    </div>
  );

  const assignmentStep = (
    <div class="grid-7-3">
      <div class="card panel">
        <div class="grid-2">
          <SelectField label="Department" value={form.departmentId} onInput={v => setField('departmentId', v)} options={departments}  placeholder="— No department —" />
          <SelectField label="Site"       value={form.siteId}       onInput={v => setField('siteId',       v)} options={sites}        placeholder="— No site —" />
          <SelectField label="Supervisor" value={form.supervisorId} onInput={v => setField('supervisorId', v)} options={supervisors}  placeholder="— No supervisor —" />
          <Field label="Effective Date" value={form.effectiveDate} onInput={v => setField('effectiveDate', v)} error={err('effectiveDate')} type="date" hint="Defaults to the start date" />
        </div>
        <div class="notice info">
          <LucideIcon name="Info" size={18} />
          <span>Assignment is optional at creation and can be changed later — every change opens a new assignment record with its own effective date.</span>
        </div>
      </div>
      <div class="side-stack">
        <div class="card side-panel">
          <h3>Reporting line</h3>
          {form.supervisorId ? (
            <div class="owner">
              <span class="owner-mark">{(supervisors.find(s => s.id === form.supervisorId)?.label ?? '?').charAt(0).toUpperCase()}</span>
              <div>
                <strong>{supervisors.find(s => s.id === form.supervisorId)?.label}</strong>
                <span>Supervisor</span>
              </div>
            </div>
          ) : (
            <div class="mini-row warn">
              <LucideIcon name="CircleAlert" size={20} />
              <div><strong>No supervisor</strong><span>The record will show as an assignment exception.</span></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const statutoryStep = (
    <div class="grid-7-3">
      <div class="card panel">
        <SectionBox title="NIS — National Insurance" icon="ShieldCheck">
          <div class="grid-3">
            <SelectField label="Registration Status" value={form.nisStatus} onInput={v => setField('nisStatus', v)} options={NIS_STATUSES} />
            <Field label="NIS Number"          value={form.nisNumber}        onInput={v => setField('nisNumber',        v)} error={err('nisNumber')} placeholder="e.g. 12345678" />
            <Field label="NIS Effective Date"  value={form.nisEffectiveDate} onInput={v => setField('nisEffectiveDate', v)} error={err('nisEffectiveDate')} type="date" />
          </div>
        </SectionBox>

        <SectionBox title="BIR / PAYE" icon="BadgeDollarSign">
          <div class="grid-2">
            <Field label="BIR File Number" value={form.birFileNumber} onInput={v => setField('birFileNumber', v)} placeholder="Required when PAYE applies" />
            {form.td1Received
              ? <Field label="TD1 Effective Year" value={form.td1EffectiveYear} onInput={v => setField('td1EffectiveYear', v)} error={err('td1EffectiveYear')} placeholder="e.g. 2026" />
              : <div />}
          </div>
          <div class="check-list" style={{ marginTop: '12px' }}>
            <CheckRow label="PAYE applicable" checked={form.payeApplicable} onChange={v => setField('payeApplicable', v)}
              description="Employee is subject to PAYE deductions." />
            <CheckRow label="TD1 received" checked={form.td1Received} onChange={v => setField('td1Received', v)}
              description="Signed TD1 declaration is on file." />
          </div>
        </SectionBox>

        <SectionBox title="Health Surcharge" icon="HeartPulse">
          <div class="check-list">
            <CheckRow label="Health Surcharge applicable" checked={form.hsApplicable} onChange={v => setField('hsApplicable', v)} />
            <CheckRow label="Verification required" checked={form.hsVerificationRequired} onChange={v => setField('hsVerificationRequired', v)}
              description="Finance must verify before payroll runs." />
          </div>
          {form.hsApplicable && (
            <div class="grid-2" style={{ marginTop: '12px' }}>
              <Field label="HS Effective Date"   value={form.hsEffectiveDate}   onInput={v => setField('hsEffectiveDate',   v)} error={err('hsEffectiveDate')} type="date" />
              <Field label="HS Exemption Reason" value={form.hsExemptionReason} onInput={v => setField('hsExemptionReason', v)} placeholder="If exempt, state reason" />
            </div>
          )}
        </SectionBox>

        <div class="notice">
          <LucideIcon name="TriangleAlert" size={18} />
          <span>These values are written to the canonical statutory profile and submitted for Finance verification. They are not used to calculate payroll here.</span>
        </div>
      </div>

      <div class="side-stack">
        <div class="card side-panel">
          <h3>Payroll readiness</h3>
          <strong style={{ fontSize: '24px' }}>{readyPercent}%</strong>
          <div class="progress-line"><span style={{ width: `${readyPercent}%` }} /></div>
          {blockers.length > 0 ? (
            <div class="blockers">
              <div class="blockers-head"><strong>{blockers.length} blocker{blockers.length === 1 ? '' : 's'}</strong></div>
              <ul>{blockers.map(b => <li key={b}>{b}</li>)}</ul>
            </div>
          ) : (
            <div class="mini-row">
              <LucideIcon name="CircleCheck" size={20} />
              <div><strong>Ready for Finance</strong><span>No statutory blockers.</span></div>
              <span class="tail">Ready</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const accountStep = (
    <div class="grid-7-3">
      <div class="card panel">
        <SectionBox title="Access profile" icon="UserRoundCog">
          <div class="grid-2">
            <SelectField label="Access Profile" value={form.accessProfileId} onInput={v => setField('accessProfileId', v)}
              options={profiles} placeholder="— Select an access profile —" required error={err('accessProfileId')}
              hint="Determines the system role. HR cannot assign a raw role." />
          </div>
          {profilesQ.isError && (
            <div class="notice">
              <LucideIcon name="TriangleAlert" size={18} />
              <span>Access profiles could not be loaded, so this employee cannot be created yet. Access is never assigned by fallback — retry once the registry is reachable.</span>
            </div>
          )}
        </SectionBox>

        <SectionBox title="Account mode" icon="ShieldCheck">
          <div class="choice selected">
            <span class="choice-body">
              <LucideIcon name="UserRoundX" size={26} />
              <strong>No Login Created</strong>
              <p>Employee access can be activated later from the profile or reviewed onboarding case.</p>
            </span>
          </div>
          <div class="notice info">
            <LucideIcon name="Info" size={18} />
            <span>This wizard never sets a password, creates an Auth user, or sends an invitation.</span>
          </div>
        </SectionBox>

        <SectionBox title="Onboarding" icon="ListChecks">
          <div class="check-list">
            <CheckRow label="Prepare an onboarding case" checked={form.prepareOnboarding}
              onChange={v => setField('prepareOnboarding', v)}
              description="Prepares an onboarding case draft. It is launched separately from the Onboarding workspace." />
          </div>
          {form.prepareOnboarding && (
            <div class="grid-2" style={{ marginTop: '12px' }}>
              <SelectField label="Onboarding Package" value={form.packageKey} onInput={v => setField('packageKey', v)}
                options={packages} placeholder="— Select an onboarding package —" required error={err('packageKey')} />
            </div>
          )}
          {form.prepareOnboarding && packagesQ.isError && (
            <div class="notice">
              <LucideIcon name="TriangleAlert" size={18} />
              <span>Onboarding packages could not be loaded. Retry before preparing an onboarding draft.</span>
            </div>
          )}
        </SectionBox>
      </div>

      <div class="side-stack">
        <div class="card side-panel">
          <h3>What will happen</h3>
          <div class="outcome-list">
            <div class="outcome">
              <span class="status-icon"><LucideIcon name="IdCard" size={20} /></span>
              <span><strong>Employee record</strong><p>Created and audited</p></span>
              <span class="outcome-tail"><span class="badge blue">Always</span></span>
            </div>
            <div class="outcome">
              <span class="status-icon"><LucideIcon name="Mail" size={20} /></span>
              <span><strong>Account</strong><p>No login is created — access is requested separately</p></span>
              <span class="outcome-tail"><span class="badge">Later</span></span>
            </div>
            <div class={`outcome${form.prepareOnboarding ? '' : ''}`}>
              <span class="status-icon"><LucideIcon name="ListChecks" size={20} /></span>
              <span><strong>Onboarding</strong><p>{form.prepareOnboarding ? (packages.find(p => p.id === form.packageKey)?.label ?? 'Standard package') : 'Not started'}</p></span>
              <span class="outcome-tail">
                <span class={`badge ${form.prepareOnboarding ? 'green' : ''}`}>{form.prepareOnboarding ? 'Draft' : 'Skip'}</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const reviewStep = (() => {
    const profileLabel = profiles.find(p => p.id === form.accessProfileId)?.label ?? 'Employee (default)';
    const deptLabel    = departments.find(d => d.id === form.departmentId)?.label;
    const siteLabel    = sites.find(s => s.id === form.siteId)?.label;
    const supLabel     = supervisors.find(s => s.id === form.supervisorId)?.label;
    const pkgLabel     = packages.find(p => p.id === form.packageKey)?.label;
    const allValid     = WIZARD_STEPS.every((_, i) => Object.keys(validateStep(i, form)).length === 0);

    return (
      <div class="card panel">
        {!allValid && (
          <div class="notice" role="alert">
            <LucideIcon name="TriangleAlert" size={18} />
            <span>Some steps still have validation errors. Go back and fix them before creating.</span>
          </div>
        )}
        <div class="summary-grid">
          <SummaryCard title="Identity" icon="IdCard">
            <SummaryRow label="Full Name"      value={[form.firstName, form.lastName].filter(Boolean).join(' ')} />
            <SummaryRow label="Username"       value={form.username} />
            <SummaryRow label="Employee No."   value={form.employeeNumber || '(auto)'} />
            <SummaryRow label="Work Email"     value={form.email} />
            <SummaryRow label="Personal Email" value={form.personalEmail} />
            <SummaryRow label="Phone"          value={form.phone} />
          </SummaryCard>
          <SummaryCard title="Employment" icon="BriefcaseBusiness">
            <SummaryRow label="Type"       value={EMPLOYMENT_TYPES.find(t => t.id === form.employmentType)?.label ?? form.employmentType} />
            <SummaryRow label="Status"     value={RECORD_STATUSES.find(s => s.id === form.recordStatus)?.label ?? form.recordStatus} />
            <SummaryRow label="Start Date" value={form.startDate} />
            <SummaryRow label="Position"   value={form.position} />
            <SummaryRow label="Grade"      value={form.employeeGrade} />
          </SummaryCard>
          <SummaryCard title="Assignment" icon="Building2">
            <SummaryRow label="Department" value={deptLabel} />
            <SummaryRow label="Site"       value={siteLabel} />
            <SummaryRow label="Supervisor" value={supLabel} />
          </SummaryCard>
          <SummaryCard title="Statutory" icon="BadgeDollarSign">
            <SummaryRow label="NIS Status"       value={NIS_STATUSES.find(s => s.id === form.nisStatus)?.label} />
            <SummaryRow label="NIS Number"       value={form.nisNumber} />
            <SummaryRow label="PAYE"             value={form.payeApplicable ? 'Applicable' : 'Not applicable'} />
            <SummaryRow label="TD1 Received"     value={form.td1Received ? `Yes (${form.td1EffectiveYear || 'year TBD'})` : 'No'} />
            <SummaryRow label="Health Surcharge" value={form.hsApplicable ? 'Applicable' : 'Not applicable'} />
          </SummaryCard>
          <SummaryCard title="Account & Onboarding" icon="ShieldCheck">
            <SummaryRow label="Access Profile" value={profileLabel} />
            <SummaryRow label="Account"        value="No login created" />
            <SummaryRow label="Onboarding"     value={form.prepareOnboarding ? (pkgLabel ?? (form.packageKey || 'Standard package')) : 'Not started'} />
          </SummaryCard>
        </div>

        {blockers.length > 0 && (
          <div class="blockers">
            <div class="blockers-head">
              <strong>Payroll readiness — {blockers.length} blocker{blockers.length === 1 ? '' : 's'}</strong>
              <button type="button" onClick={() => setStep(3)}>Review statutory</button>
            </div>
            <ul>{blockers.map(b => <li key={b}>{b}</li>)}</ul>
          </div>
        )}
      </div>
    );
  })();

  const stepBody = [identityStep, employmentStep, assignmentStep, statutoryStep, accountStep, reviewStep][step];

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div class="emp-create-page">
      <div class="page">
        <div class="page-head">
          <span class="section-icon"><LucideIcon name="UserPlus" size={24} /></span>
          <div>
            <h1>Add Employee</h1>
            <p>Create a workforce record, capture statutory readiness, and decide how access and onboarding begin.</p>
          </div>
          <div class="page-actions">
            <button type="button" class="btn ghost" onClick={onClose}>Cancel</button>
          </div>
        </div>

        {draftState === 'has_draft' && (
          <DraftRecovery
            label={draftGetQ.data?.label ?? null}
            savedAt={draftGetQ.data?.updated_at ?? null}
            stepIndex={draftGetQ.data?.step_index ?? 0}
            onResume={resumeDraft}
            onDiscard={discardDraft}
          />
        )}

        <Stepper
          steps={WIZARD_STEPS}
          activeIndex={step}
          onStep={i => { void goTo(i); }}
          reachableIndex={maxStep}
          completed={completed}
          ariaLabel="Employee creation steps"
        />

        <div class="panel-title">
          <span class="section-icon"><LucideIcon name={intro.icon} size={22} /></span>
          <div>
            <h2>{intro.title}</h2>
            <p>{intro.blurb}</p>
          </div>
        </div>

        {stepBody}

        {/* In-flow sticky footer — sits INSIDE .page so it pins to the content
            column rather than the viewport (a fixed bar runs under the sidebar). */}
        <div class="sticky-actions">
          <button type="button" class="btn ghost" onClick={onClose}>Cancel</button>
          {step > 0 && (
            <button type="button" class="btn ghost" onClick={back} disabled={createMut.isPending}>Back</button>
          )}
          <span class="push" />
          <span class="badge">Step {step + 1} of {WIZARD_STEPS.length}</span>
          {step < WIZARD_STEPS.length - 1 ? (
            <button type="button" class="btn primary" onClick={next} disabled={!canAdvance}>Continue</button>
          ) : (
            <button type="button" class="btn primary" onClick={() => { void handleCreate(); }} disabled={createMut.isPending}>
              {createMut.isPending ? 'Creating…' : 'Create Employee'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
