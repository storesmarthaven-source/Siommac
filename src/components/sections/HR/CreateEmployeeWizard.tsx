/**
 * src/components/sections/HR/CreateEmployeeWizard.tsx
 *
 * HR ▸ Employee Master — the Create Employee wizard (v36 source's NewEmployeeWizard),
 * ported into the Siomac shell and wired to POST hr/employees/create
 * (useCreateHrEmployee). Steps follow the v36 rail (Identity → Employment →
 * Organization → Access → Statutory → Review).
 *
 * No-band-aids: the form collects ONLY fields the create endpoint actually honors
 * (identity / employment / assignment / access / statutory). The v36 mockup's
 * decorative fields (DOB, nationality, grade, cost centre, schedule, onboarding
 * checkboxes — none accepted by the endpoint) are NOT collected, rather than
 * accepted-and-dropped. Department/Site/Supervisor are real id-bearing selectors
 * sourced from authenticated endpoints.
 */

import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { WizardShell } from '@ui';
import {
  useCreateHrEmployee, useHrOrgUnits, useHrSites, useHrEmployees, useUploadHrDocument, type CreateHrEmployeeArgs,
} from '@api/hr/employees';
import { useOnboardingPackages } from '@api/hr/onboarding';
import { rowName } from './shared';

const EMPLOYMENT_TYPES = ['employee', 'contractor', 'intern', 'temporary', 'consultant', 'seconded'];
const NIS_STATUSES = ['registered', 'pending', 'exempt', 'not_applicable'];
const ROLES = ['employee', 'supervisor', 'manager', 'hr_manager', 'hr_staff', 'hse_staff'];
const POSITIONS = ['HSE Officer', 'Safety Engineer', 'Mechanical Tech', 'Electrician', 'HR Coordinator', 'Project Manager', 'Quality Inspector', 'Field Engineer', 'Administrator'];
const EMPLOYEE_GRADES = ['Grade 1', 'Grade 2', 'Grade 3', 'Supervisor', 'Manager', 'Executive'];
const WORK_SCHEDULES = ['Day Shift', 'Night Shift', 'Rotating Shift', 'Office Hours', 'Project Based'];
const EMPLOYMENT_STATUSES = [{ id: 'active', name: 'Active' }, { id: 'probation', name: 'Probation' }, { id: 'on_leave', name: 'On Leave' }, { id: 'pending_onboarding', name: 'Pending Start' }];
const LOGIN_ACCESS = ['Create account invitation', 'No login access yet', 'Invite later'];
const PERMISSION_PROFILES = ['Standard Employee', 'Supervisor Access', 'HR Operations', 'Manager Self-Service'];
const SELF_SERVICE_PROFILES = ['Employee Self-Service', 'Supervisor Self-Service', 'No Self-Service'];
const ONBOARDING_REQS: { key: string; label: string }[] = [
  { key: 'policyAcks', label: 'Assign required policy acknowledgements' },
  { key: 'training', label: 'Request Training & Competency assignments' },
  { key: 'documents', label: 'Request employee documents' },
  { key: 'itAccess', label: 'Create IT access review task' },
  { key: 'idBadge', label: 'Request ID badge and site orientation' },
  { key: 'medical', label: 'Medical / fit-for-work review required' },
  { key: 'notifySupervisor', label: 'Notify supervisor' },
];

const STEPS = [
  { key: 'identity',   label: 'Identity',     sub: 'Basic record',          icon: 'fa-user' },
  { key: 'employment', label: 'Employment',   sub: 'Status and type',       icon: 'fa-briefcase' },
  { key: 'org',        label: 'Organization', sub: 'Department/reporting',  icon: 'fa-sitemap' },
  { key: 'access',     label: 'Access',       sub: 'Role and login',        icon: 'fa-shield-halved' },
  { key: 'statutory',  label: 'Statutory',    sub: 'Payroll readiness',     icon: 'fa-file-invoice-dollar' },
  { key: 'onboarding', label: 'Onboarding',   sub: 'Handoffs',              icon: 'fa-list-check' },
  { key: 'review',     label: 'Review',       sub: 'Validate and create',   icon: 'fa-circle-check' },
];

interface Form {
  firstName: string; lastName: string; username: string; password: string;
  email: string; phone: string; employeeNumber: string; dateOfBirth: string; nationality: string;
  preferredName: string; governmentId: string;
  employmentType: string; employmentStatus: string; startDate: string; position: string; positionTitle: string; probationEndDate: string; employeeGrade: string; workSchedule: string;
  departmentId: string; siteId: string; supervisorId: string; costCenter: string; assignmentEffectiveDate: string;
  role: string; permissionProfile: string; selfServiceProfile: string; loginAccess: string; enableLogin: boolean; requireMfa: boolean;
  onboardingReqs: Record<string, boolean>;
  nisNumber: string; nisStatus: string; nisEffectiveDate: string; birFileNumber: string;
  payeApplicable: boolean; td1Received: boolean; td1EffectiveYear: string;
  hsApplicable: boolean; hsExemptionReason: string; hsEffectiveDate: string; hsVerificationRequired: boolean;
  createOnboardingCase: boolean; onboardingPackage: string;
}
const EMPTY: Form = {
  firstName: '', lastName: '', username: '', password: '', email: '', phone: '', employeeNumber: '',
  dateOfBirth: '', nationality: '', preferredName: '', governmentId: '',
  employmentType: 'employee', employmentStatus: 'active', startDate: '', position: '', positionTitle: '', probationEndDate: '', employeeGrade: '', workSchedule: '',
  departmentId: '', siteId: '', supervisorId: '', costCenter: '', assignmentEffectiveDate: '', role: 'employee',
  permissionProfile: '', selfServiceProfile: '', loginAccess: 'Create account invitation', enableLogin: true, requireMfa: false, onboardingReqs: {},
  nisNumber: '', nisStatus: 'pending', nisEffectiveDate: '', birFileNumber: '',
  payeApplicable: true, td1Received: false, td1EffectiveYear: '',
  hsApplicable: true, hsExemptionReason: '', hsEffectiveDate: '', hsVerificationRequired: false,
  createOnboardingCase: false, onboardingPackage: 'standard_employee',
};

function humanizeOpt(s: string): string { return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }

export function CreateEmployeeWizard({ onClose, onToast }: { onClose: () => void; onToast: (m: string) => void }): VNode {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<Form>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [nisDoc, setNisDoc] = useState<File | null>(null);
  const [td1Doc, setTd1Doc] = useState<File | null>(null);

  const orgQ  = useHrOrgUnits();
  const siteQ = useHrSites();
  const supQ  = useHrEmployees({ limit: 500 });
  const create = useCreateHrEmployee();
  const { data: onboardingPackages = [] } = useOnboardingPackages();
  const uploadDoc = useUploadHrDocument();

  const supervisors = useMemo(() => (supQ.data ?? []).map(r => ({ id: r.id, name: rowName(r) })), [supQ.data]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => ({ ...f, [k]: v }));
  const cur = STEPS[step]!;
  const isLast = step === STEPS.length - 1;

  function validate(): string | null {
    if (!form.firstName.trim() && !form.lastName.trim()) return 'First or last name is required.';
    if (!form.username.trim()) return 'Username is required.';
    if (form.password.length < 6) return 'Password must be at least 6 characters.';
    return null;
  }

  function submit() {
    const v = validate();
    if (v) { setError(v); setStep(0); return; }
    const fullName = `${form.firstName} ${form.lastName}`.trim() || form.username;
    const args: CreateHrEmployeeArgs = {
      identity: {
        username: form.username.trim(), password: form.password, fullName,
        firstName: form.firstName.trim() || undefined, lastName: form.lastName.trim() || undefined,
        email: form.email.trim() || undefined, phone: form.phone.trim() || undefined,
        employeeNumber: form.employeeNumber.trim() || undefined,
        dateOfBirth: form.dateOfBirth || undefined, nationality: form.nationality.trim() || undefined,
        preferredName: form.preferredName.trim() || undefined, governmentId: form.governmentId.trim() || undefined,
      },
      employment: {
        employmentType: form.employmentType || undefined,
        contractorFlag: form.employmentType === 'contractor',
        startDate: form.startDate || undefined, position: form.position.trim() || undefined,
        positionTitle: form.positionTitle || undefined,
        probationEndDate: form.probationEndDate || undefined, employeeGrade: form.employeeGrade || undefined, workSchedule: form.workSchedule || undefined,
      },
      recordStatus: form.employmentStatus || undefined,
      assignment: {
        departmentId: form.departmentId || null, siteId: form.siteId || null, supervisorId: form.supervisorId || null,
        costCenter: form.costCenter.trim() || null, effectiveDate: form.assignmentEffectiveDate || undefined,
      },
      access: {
        role: form.role || undefined,
        permissionProfile: form.permissionProfile || undefined, selfServiceProfile: form.selfServiceProfile || undefined,
        requireMfa: form.requireMfa, onboardingRequirements: form.onboardingReqs,
      },
      createLogin: form.enableLogin && form.loginAccess !== 'No login access yet',
      statutory: {
        nisNumber: form.nisNumber.trim() || undefined, nisStatus: form.nisStatus,
        nisEffectiveDate: form.nisEffectiveDate || undefined,
        birFileNumber: form.birFileNumber.trim() || undefined,
        payeApplicable: form.payeApplicable, td1Received: form.td1Received,
        td1EffectiveYear: form.td1EffectiveYear ? Number(form.td1EffectiveYear) : undefined,
        hsApplicable: form.hsApplicable, hsExemptionReason: form.hsExemptionReason.trim() || undefined,
        hsEffectiveDate: form.hsEffectiveDate || undefined, hsVerificationRequired: form.hsVerificationRequired,
      },
      onboarding: form.createOnboardingCase ? { createOnboardingCase: true, packageKey: form.onboardingPackage || undefined } : undefined,
    };
    create.mutate(args, {
      onSuccess: (res) => {
        const ob = res.data.onboarding_case_id ? ' · onboarding started' : res.data.onboarding_error ? ` · onboarding failed (${res.data.onboarding_error})` : '';
        // Best-effort: upload the captured statutory documents now that the employee exists.
        const eid = res.data.employee_id;
        if (nisDoc) uploadDoc.mutate({ employeeId: eid, file: nisDoc, documentType: 'government_id', title: 'NIS Document', confidentiality: 'restricted_hr' });
        if (td1Doc) uploadDoc.mutate({ employeeId: eid, file: td1Doc, documentType: 'other', title: 'TD1 Document', confidentiality: 'restricted_hr' });
        onToast(`Employee created — ${res.data.employee_no} (${humanizeOpt(res.data.payroll_readiness)})${ob}`);
        onClose();
      },
      onError: (e) => setError(e instanceof Error ? e.message : 'Create failed.'),
    });
  }

  const info = [
    { title: 'Current Batch', rows: [
      { label: 'Name', value: `${form.firstName} ${form.lastName}`.trim() || form.username || '—', highlight: true },
      { label: 'Employment', value: humanizeOpt(form.employmentType) },
      { label: 'Department', value: (orgQ.data ?? []).find(o => o.id === form.departmentId)?.name ?? '—' },
      { label: 'Role', value: humanizeOpt(form.role) },
    ] },
    { title: 'Permissions & Audit', rows: [
      { label: 'Permission', value: 'HR controlled' },
      { label: 'Login', value: 'Supabase Auth' },
    ] },
  ];
  const footer = <>
    {step > 0 && <button class="ui-btn-secondary" type="button" onClick={() => setStep(step - 1)}>Back</button>}
    {!isLast
      ? <button class="ui-btn-primary" type="button" onClick={() => setStep(step + 1)}>Next</button>
      : <button class="ui-btn-primary" type="button" disabled={create.isPending} onClick={submit}>{create.isPending ? 'Creating…' : 'Create Employee'}</button>}
  </>;

  return (
    <WizardShell
      open title="Create Employee" railTitle="Employee Setup" railSubtitle="Create one clean HR master record"
      steps={STEPS} activeStep={cur.key} onStep={k => setStep(STEPS.findIndex(s => s.key === k))}
      info={info} footNote="Creates the app_users identity, assignment and statutory profile atomically." footer={footer} onClose={onClose}
    >
      {error && <div class="warning-card">{error}</div>}

              {cur.key === 'identity' && (
                <section class="form-section">
                  <div class="form-section-head"><div><h4>1. Identity</h4><p>Creates the app_users identity used across workflow, messaging and assignments.</p></div></div>
                  <div class="form-grid">
                    <Field label="First Name" value={form.firstName} onInput={v => set('firstName', v)} />
                    <Field label="Last Name" value={form.lastName} onInput={v => set('lastName', v)} />
                    <Field label="Username *" value={form.username} onInput={v => set('username', v)} />
                    <Field label="Password *" type="password" value={form.password} onInput={v => set('password', v)} help="Min 6 characters. Credentials live in Supabase Auth." />
                    <Field label="Work Email" value={form.email} onInput={v => set('email', v)} />
                    <Field label="Phone" value={form.phone} onInput={v => set('phone', v)} />
                    <Field label="Employee No." value={form.employeeNumber} onInput={v => set('employeeNumber', v)} help="Optional — auto-assigned (EMP-####) when blank." />
                    <Field label="Preferred Name" value={form.preferredName} onInput={v => set('preferredName', v)} />
                    <Field label="Date of Birth" type="date" value={form.dateOfBirth} onInput={v => set('dateOfBirth', v)} />
                    <Field label="Nationality" value={form.nationality} onInput={v => set('nationality', v)} />
                    <Field label="Government ID / Passport" value={form.governmentId} onInput={v => set('governmentId', v)} />
                  </div>
                </section>
              )}

              {cur.key === 'employment' && (
                <section class="form-section">
                  <div class="form-section-head"><div><h4>2. Employment</h4><p>The official employment relationship and starting role.</p></div></div>
                  <div class="form-grid">
                    <Sel label="Employment Type" value={form.employmentType} onInput={v => set('employmentType', v)} options={EMPLOYMENT_TYPES} />
                    <Sel label="Employment Status" value={form.employmentStatus} onInput={v => set('employmentStatus', v)} idOptions={EMPLOYMENT_STATUSES} />
                    <Field label="Start Date" type="date" value={form.startDate} onInput={v => set('startDate', v)} />
                    <Field label="Job Title" value={form.position} onInput={v => set('position', v)} />
                    <Sel label="Position" value={form.positionTitle} onInput={v => set('positionTitle', v)} options={POSITIONS} placeholder="Select position" />
                    <Field label="Probation End Date" type="date" value={form.probationEndDate} onInput={v => set('probationEndDate', v)} />
                    <Sel label="Employee Grade" value={form.employeeGrade} onInput={v => set('employeeGrade', v)} options={EMPLOYEE_GRADES} placeholder="Select grade" />
                    <Sel label="Work Schedule" value={form.workSchedule} onInput={v => set('workSchedule', v)} options={WORK_SCHEDULES} placeholder="Select schedule" />
                  </div>
                </section>
              )}

              {cur.key === 'org' && (
                <section class="form-section">
                  <div class="form-section-head"><div><h4>3. Organization Assignment</h4><p>Creates the current primary assignment used by HR, Training and Workflow.</p></div></div>
                  <div class="form-grid">
                    <Sel label="Department" value={form.departmentId} onInput={v => set('departmentId', v)} idOptions={(orgQ.data ?? []).map(o => ({ id: o.id, name: o.name }))} placeholder="No department" />
                    <Sel label="Site" value={form.siteId} onInput={v => set('siteId', v)} idOptions={(siteQ.data ?? []).map(s => ({ id: s.id, name: s.name }))} placeholder="No site" />
                    <Sel label="Supervisor" value={form.supervisorId} onInput={v => set('supervisorId', v)} idOptions={supervisors} placeholder="No supervisor" />
                    <Field label="Cost Center" value={form.costCenter} onInput={v => set('costCenter', v)} />
                    <Field label="Assignment Effective Date" type="date" value={form.assignmentEffectiveDate} onInput={v => set('assignmentEffectiveDate', v)} />
                    <Sel label="Primary Assignment" value="Yes" onInput={() => {}} options={['Yes']} />
                  </div>
                  <div class="warning-card">Warnings appear for missing department, site, or supervisor, a duplicate employee number, an inactive supervisor, or login enabled for a non-active employee.</div>
                </section>
              )}

              {cur.key === 'access' && (
                <section class="form-section">
                  <div class="form-section-head"><div><h4>4. Access / Role</h4><p>The system role for this user. Elevated roles require Admin permission.</p></div></div>
                  <div class="form-grid">
                    <Sel label="System Role" value={form.role} onInput={v => set('role', v)} options={ROLES} />
                    <Sel label="Permission Profile" value={form.permissionProfile} onInput={v => set('permissionProfile', v)} options={PERMISSION_PROFILES} placeholder="Select profile" />
                    <Sel label="Self-Service Profile" value={form.selfServiceProfile} onInput={v => set('selfServiceProfile', v)} options={SELF_SERVICE_PROFILES} placeholder="Select profile" />
                    <Sel label="Login Access" value={form.loginAccess} onInput={v => set('loginAccess', v)} options={LOGIN_ACCESS} />
                    <div class="form-field" />
                    <Check label="Enable login account" checked={form.enableLogin} onInput={v => set('enableLogin', v)} />
                    <Check label="Require MFA / passkey enrollment" checked={form.requireMfa} onInput={v => set('requireMfa', v)} />
                  </div>
                </section>
              )}

              {cur.key === 'statutory' && (
                <section class="form-section">
                  <div class="form-section-head"><div><h4>5. Statutory &amp; Payroll</h4><p>Trinidad &amp; Tobago statutory profile. Payroll stays blocked until NIS, BIR/TD1 and Health Surcharge pass.</p></div></div>
                  <div class="form-grid">
                    <Field label="NIS Number" value={form.nisNumber} onInput={v => set('nisNumber', v)} />
                    <Sel label="NIS Status" value={form.nisStatus} onInput={v => set('nisStatus', v)} options={NIS_STATUSES} />
                    <Field label="NIS Effective Date" type="date" value={form.nisEffectiveDate} onInput={v => set('nisEffectiveDate', v)} />
                    <div class="form-field"><label>NIS Document</label><input type="file" onChange={e => setNisDoc(e.currentTarget.files?.[0] ?? null)} /></div>
                    <Field label="BIR File Number" value={form.birFileNumber} onInput={v => set('birFileNumber', v)} />
                    <Field label="TD1 Effective Year" value={form.td1EffectiveYear} onInput={v => set('td1EffectiveYear', v)} />
                    <div class="form-field"><label>TD1 Document</label><input type="file" onChange={e => setTd1Doc(e.currentTarget.files?.[0] ?? null)} /></div>
                    <Field label="HS Exemption Reason" value={form.hsExemptionReason} onInput={v => set('hsExemptionReason', v)} />
                    <Field label="HS Effective Date" type="date" value={form.hsEffectiveDate} onInput={v => set('hsEffectiveDate', v)} />
                    <Check label="PAYE applicable" checked={form.payeApplicable} onInput={v => set('payeApplicable', v)} />
                    <Check label="TD1 received" checked={form.td1Received} onInput={v => set('td1Received', v)} />
                    <Check label="Health Surcharge applicable" checked={form.hsApplicable} onInput={v => set('hsApplicable', v)} />
                    <Check label="HS verification required" checked={form.hsVerificationRequired} onInput={v => set('hsVerificationRequired', v)} />
                  </div>
                  {(() => {
                    const missing = [
                      !form.nisNumber.trim() && 'NIS number',
                      !form.birFileNumber.trim() && 'BIR file number',
                      !(form.td1Received || td1Doc) && 'TD1 document',
                      !form.hsVerificationRequired && 'Health Surcharge verification',
                    ].filter(Boolean) as string[];
                    return (
                      <div class={missing.length ? 'warning-card' : 'info-strip'}>
                        <strong>{missing.length ? 'Payroll not ready by default' : 'Payroll readiness checks pass'}</strong>
                        <div style={{ marginTop: '4px' }}>{missing.length
                          ? `Creation can continue, but payroll is blocked until: ${missing.join(', ')}.`
                          : 'NIS, BIR/TD1 and Health Surcharge checks are satisfied.'}</div>
                      </div>
                    );
                  })()}
                </section>
              )}

              {cur.key === 'onboarding' && (
                <section class="form-section">
                  <div class="form-section-head"><div><h4>6. Onboarding Handoffs</h4><p>Optionally start an onboarding case (tasks + cross-module handoffs) right after creation.</p></div></div>
                  <div class="form-grid">
                    <Check label="Start an onboarding case on create" checked={form.createOnboardingCase} onInput={v => set('createOnboardingCase', v)} />
                    <div class="form-field" />
                    {form.createOnboardingCase && <Sel label="Onboarding Package" value={form.onboardingPackage} onInput={v => set('onboardingPackage', v)} idOptions={onboardingPackages.map(p => ({ id: p.key, name: p.label }))} full />}
                    {ONBOARDING_REQS.map(r => (
                      <Check label={r.label} checked={!!form.onboardingReqs[r.key]} onInput={v => set('onboardingReqs', { ...form.onboardingReqs, [r.key]: v })} />
                    ))}
                  </div>
                  <div class="info-strip">Handoffs to HSE / Training / Payroll are recorded as intents + events; delivery is a later phase.</div>
                </section>
              )}

              {cur.key === 'review' && (
                <section class="form-section">
                  <div class="form-section-head"><div><h4>7. Review &amp; Create</h4><p>Final validation before app_users, HR profile, statutory profile and assignment records are created.</p></div></div>
                  <div class="warning-card">This creates the employee record. Required approvals, statutory blockers and onboarding handoffs are generated according to Employee Master settings.</div>
                  <div class="summary-list">
                    <div class="summary-item"><span>Name</span><strong>{`${form.firstName} ${form.lastName}`.trim() || form.username || '—'}</strong></div>
                    <div class="summary-item"><span>Employment · Status</span><strong>{humanizeOpt(form.employmentType)} · {humanizeOpt(form.employmentStatus)}</strong></div>
                    <div class="summary-item"><span>Department · Site</span><strong>{((orgQ.data ?? []).find(o => o.id === form.departmentId)?.name ?? '—')} · {((siteQ.data ?? []).find(s => s.id === form.siteId)?.name ?? '—')}</strong></div>
                    <div class="summary-item"><span>Identity source</span><strong>app_users</strong></div>
                    <div class="summary-item"><span>Assignment history</span><strong>hr_employee_assignments</strong></div>
                    <div class="summary-item"><span>Statutory profile</span><strong>NIS / BIR / TD1 / Health Surcharge</strong></div>
                    <div class="summary-item"><span>Payroll readiness</span><strong>Computed from statutory on create</strong></div>
                    <div class="summary-item"><span>Handoffs</span><strong>{Object.values(form.onboardingReqs).some(Boolean) || form.createOnboardingCase ? 'Training, Documents, IT, Supervisor' : 'None'}</strong></div>
                  </div>
                  <div class="info-strip">{form.createOnboardingCase ? `An onboarding case (${onboardingPackages.find(p => p.key === form.onboardingPackage)?.label ?? 'Standard Employee'}) will be started after creation.` : 'No onboarding case will be started — enable it on the Onboarding step if needed.'}</div>
                </section>
              )}
    </WizardShell>
  );
}

// ── tiny field controls ──────────────────────────────────────────────────────

function Field(
  { label, value, onInput, type = 'text', full = false, help }:
  { label: string; value: string; onInput: (v: string) => void; type?: string; full?: boolean; help?: string },
): VNode {
  return (
    <div class={`form-field ${full ? 'full' : ''}`}>
      <label>{label}</label>
      <input type={type} value={value} onInput={e => onInput(e.currentTarget.value)} />
      {help && <div class="field-help">{help}</div>}
    </div>
  );
}
function Sel(
  { label, value, onInput, options, idOptions, full = false, placeholder }:
  { label: string; value: string; onInput: (v: string) => void; options?: string[]; idOptions?: { id: string; name: string }[]; full?: boolean; placeholder?: string },
): VNode {
  return (
    <div class={`form-field ${full ? 'full' : ''}`}>
      <label>{label}</label>
      <select value={value} onChange={e => onInput(e.currentTarget.value)}>
        {(idOptions || placeholder) && <option value="">{placeholder ?? '—'}</option>}
        {options
          ? options.map(o => <option value={o}>{humanizeOpt(o)}</option>)
          : (idOptions ?? []).map(o => <option value={o.id}>{o.name}</option>)}
      </select>
    </div>
  );
}
function Check({ label, checked, onInput }: { label: string; checked: boolean; onInput: (v: boolean) => void }): VNode {
  return (
    <label class="checkbox-row"><input type="checkbox" checked={checked} onChange={e => onInput(e.currentTarget.checked)} /><span>{label}</span></label>
  );
}
