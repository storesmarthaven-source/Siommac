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
import {
  useCreateHrEmployee, useHrOrgUnits, useHrSites, useHrEmployees, type CreateHrEmployeeArgs,
} from '@api/hr/employees';
import { ONBOARDING_PACKAGES } from '@api/hr/onboarding';
import { rowName } from './shared';

const EMPLOYMENT_TYPES = ['employee', 'contractor', 'intern', 'temporary', 'consultant', 'seconded'];
const NIS_STATUSES = ['registered', 'pending', 'exempt', 'not_applicable'];
const ROLES = ['employee', 'supervisor', 'manager', 'hr_manager'];

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
  email: string; phone: string; employeeNumber: string;
  employmentType: string; startDate: string; position: string;
  departmentId: string; siteId: string; supervisorId: string;
  role: string;
  nisNumber: string; nisStatus: string; nisEffectiveDate: string; birFileNumber: string;
  payeApplicable: boolean; td1Received: boolean; td1EffectiveYear: string;
  hsApplicable: boolean; hsExemptionReason: string; hsEffectiveDate: string; hsVerificationRequired: boolean;
  createOnboardingCase: boolean; onboardingPackage: string;
}
const EMPTY: Form = {
  firstName: '', lastName: '', username: '', password: '', email: '', phone: '', employeeNumber: '',
  employmentType: 'employee', startDate: '', position: '',
  departmentId: '', siteId: '', supervisorId: '', role: 'employee',
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

  const orgQ  = useHrOrgUnits();
  const siteQ = useHrSites();
  const supQ  = useHrEmployees({ limit: 500 });
  const create = useCreateHrEmployee();

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
      },
      employment: {
        employmentType: form.employmentType || undefined,
        contractorFlag: form.employmentType === 'contractor',
        startDate: form.startDate || undefined, position: form.position.trim() || undefined,
      },
      assignment: {
        departmentId: form.departmentId || null, siteId: form.siteId || null, supervisorId: form.supervisorId || null,
      },
      access: { role: form.role || undefined },
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
        onToast(`Employee created — ${res.data.employee_no} (${humanizeOpt(res.data.payroll_readiness)})${ob}`);
        onClose();
      },
      onError: (e) => setError(e instanceof Error ? e.message : 'Create failed.'),
    });
  }

  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div class="modal lg employee-wizard-modal" onClick={e => e.stopPropagation()}>
        <div class="modal-head"><h3>Create Employee</h3><button class="modal-close" type="button" onClick={onClose} aria-label="Close">×</button></div>
        <div class="modal-body wizard-body">
          <div class="wizard-shell">
            <aside class="wizard-rail">
              <div class="wizard-rail-head"><span class="wizard-head-dot" /><div><strong>Employee Setup</strong><span>One clean HR master record</span></div></div>
              <div class="wizard-rail-menu">
                {STEPS.map((s, i) => (
                  <button type="button" class={`wizard-step ${step === i ? 'active' : ''}`} onClick={() => setStep(i)}>
                    <span class="wizard-step-ico"><i class={`fas ${s.icon}`} /></span>
                    <div><strong>{s.label}</strong><span>{s.sub}</span></div>
                  </button>
                ))}
              </div>
            </aside>

            <div class="wizard-content">
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
                  </div>
                </section>
              )}

              {cur.key === 'employment' && (
                <section class="form-section">
                  <div class="form-section-head"><div><h4>2. Employment</h4><p>The official employment relationship and starting role.</p></div></div>
                  <div class="form-grid">
                    <Sel label="Employment Type" value={form.employmentType} onInput={v => set('employmentType', v)} options={EMPLOYMENT_TYPES} />
                    <Field label="Start Date" type="date" value={form.startDate} onInput={v => set('startDate', v)} />
                    <Field label="Position / Job Title" value={form.position} onInput={v => set('position', v)} full />
                  </div>
                </section>
              )}

              {cur.key === 'org' && (
                <section class="form-section">
                  <div class="form-section-head"><div><h4>3. Organization Assignment</h4><p>Creates the current primary assignment used by HR, Training and Workflow.</p></div></div>
                  <div class="form-grid">
                    <Sel label="Department" value={form.departmentId} onInput={v => set('departmentId', v)} idOptions={(orgQ.data ?? []).map(o => ({ id: o.id, name: o.name }))} placeholder="No department" />
                    <Sel label="Site" value={form.siteId} onInput={v => set('siteId', v)} idOptions={(siteQ.data ?? []).map(s => ({ id: s.id, name: s.name }))} placeholder="No site" />
                    <Sel label="Supervisor" value={form.supervisorId} onInput={v => set('supervisorId', v)} idOptions={supervisors} placeholder="No supervisor" full />
                  </div>
                </section>
              )}

              {cur.key === 'access' && (
                <section class="form-section">
                  <div class="form-section-head"><div><h4>4. Access / Role</h4><p>The system role for this user. Elevated roles require Admin permission.</p></div></div>
                  <div class="form-grid">
                    <Sel label="System Role" value={form.role} onInput={v => set('role', v)} options={ROLES} />
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
                    <Field label="BIR File Number" value={form.birFileNumber} onInput={v => set('birFileNumber', v)} />
                    <Field label="TD1 Effective Year" value={form.td1EffectiveYear} onInput={v => set('td1EffectiveYear', v)} />
                    <Field label="HS Exemption Reason" value={form.hsExemptionReason} onInput={v => set('hsExemptionReason', v)} />
                    <Field label="HS Effective Date" type="date" value={form.hsEffectiveDate} onInput={v => set('hsEffectiveDate', v)} />
                    <div class="form-field" />
                    <Check label="PAYE applicable" checked={form.payeApplicable} onInput={v => set('payeApplicable', v)} />
                    <Check label="TD1 received" checked={form.td1Received} onInput={v => set('td1Received', v)} />
                    <Check label="Health Surcharge applicable" checked={form.hsApplicable} onInput={v => set('hsApplicable', v)} />
                    <Check label="HS verification required" checked={form.hsVerificationRequired} onInput={v => set('hsVerificationRequired', v)} />
                  </div>
                </section>
              )}

              {cur.key === 'onboarding' && (
                <section class="form-section">
                  <div class="form-section-head"><div><h4>6. Onboarding Handoffs</h4><p>Optionally start an onboarding case (tasks + cross-module handoffs) right after creation.</p></div></div>
                  <div class="form-grid">
                    <Check label="Start an onboarding case on create" checked={form.createOnboardingCase} onInput={v => set('createOnboardingCase', v)} />
                    <div class="form-field" />
                    {form.createOnboardingCase && <Sel label="Onboarding Package" value={form.onboardingPackage} onInput={v => set('onboardingPackage', v)} idOptions={ONBOARDING_PACKAGES.map(p => ({ id: p.key, name: p.label }))} full />}
                  </div>
                  <div class="info-strip">Handoffs to HSE / Training / Payroll are recorded as intents + events; delivery is a later phase.</div>
                </section>
              )}

              {cur.key === 'review' && (
                <section class="form-section">
                  <div class="form-section-head"><div><h4>7. Review &amp; Create</h4><p>Creates the app_users identity, primary assignment and statutory profile (atomically), emits the create event and audit.</p></div></div>
                  <div class="summary-list">
                    <div class="summary-item"><span>Name</span><strong>{`${form.firstName} ${form.lastName}`.trim() || form.username || '—'}</strong></div>
                    <div class="summary-item"><span>Username</span><strong>{form.username || '—'}</strong></div>
                    <div class="summary-item"><span>Employment</span><strong>{humanizeOpt(form.employmentType)}</strong></div>
                    <div class="summary-item"><span>Department</span><strong>{(orgQ.data ?? []).find(o => o.id === form.departmentId)?.name ?? '—'}</strong></div>
                    <div class="summary-item"><span>Site</span><strong>{(siteQ.data ?? []).find(s => s.id === form.siteId)?.name ?? '—'}</strong></div>
                    <div class="summary-item"><span>Supervisor</span><strong>{supervisors.find(s => s.id === form.supervisorId)?.name ?? '—'}</strong></div>
                    <div class="summary-item"><span>Role</span><strong>{humanizeOpt(form.role)}</strong></div>
                    <div class="summary-item"><span>Payroll readiness</span><strong>Computed from statutory on create</strong></div>
                  </div>
                  <div class="info-strip">{form.createOnboardingCase ? `An onboarding case (${ONBOARDING_PACKAGES.find(p => p.key === form.onboardingPackage)?.label ?? 'Standard Employee'}) will be started after creation.` : 'No onboarding case will be started — enable it on the Onboarding step if needed.'}</div>
                </section>
              )}
            </div>
          </div>
        </div>
        <div class="modal-foot">
          <span class="left-note">{`Step ${step + 1} of ${STEPS.length}`}</span>
          {step > 0 && <button class="secondary-btn" type="button" onClick={() => setStep(step - 1)}>Back</button>}
          {!isLast
            ? <button class="primary-btn" type="button" onClick={() => setStep(step + 1)}>Next</button>
            : <button class="primary-btn" type="button" disabled={create.isPending} onClick={submit}>{create.isPending ? 'Creating…' : 'Create Employee'}</button>}
        </div>
      </div>
    </div>
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
        {idOptions && <option value="">{placeholder ?? '—'}</option>}
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
