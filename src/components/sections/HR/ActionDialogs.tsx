/**
 * src/components/sections/HR/ActionDialogs.tsx
 *
 * HR ▸ Employee Master — the write-action dialogs invoked from the register kebab
 * and the profile drawer (v36 ContactDialog / StatusDialog / Offboarding /
 * ChangeRequest / Document), wired to the real endpoints:
 *   Contact        → useUpdateHrContact (direct + maker-checker request)
 *   Change Status  → useChangeHrStatus
 *   Offboarding    → useChangeHrStatus (newStatus = terminated)
 *   Request Change → useCreateHrChangeRequest (maker side of maker-checker)
 *   Document       → useUploadHrDocument
 *
 * The dialog SHELL keeps the v36 modal look (scoped `.hr-emp-master .modal*`);
 * the CONTENT is composed from the shared @ui dialog primitives — <ModalSection>,
 * <SystemActionsPanel>, `.ui-note`/`.ui-warn` — so the structure is reusable and
 * the look is faithful to the mockup.
 *
 * NOTE (task #33): the v36 "Approval Route / Workflow Route" selects are NOT
 * rendered — they would be dead routing controls until HR is wired onto the
 * central workflow engine. The <SystemActionsPanel> is informational/view-only:
 * it describes what the engine WILL do after approval, never runs anything.
 */

import { type VNode } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { ModalSection, SystemActionsPanel } from '@ui';
import {
  useUpdateHrContact, useChangeHrStatus, useCreateHrChangeRequest, useUploadHrDocument,
  useUpdateHrStatutory, useHrOrgUnits, useHrSites, useHrEmployees, useHrEmployee,
} from '@api/hr/employees';
import { rowName } from './shared';

const HR_STATUSES = ['draft', 'pending_onboarding', 'active', 'probation', 'on_leave', 'suspended', 'inactive', 'terminated', 'archived'];
const NIS_STATUSES = ['registered', 'pending', 'exempt', 'not_applicable'];
const ROLES = ['employee', 'supervisor', 'manager', 'hr_manager', 'hr_staff', 'hse_staff'];
const EMPLOYMENT_TYPES = ['employee', 'contractor', 'intern', 'temporary', 'consultant', 'seconded'];
const CHANGE_TYPES = ['department_transfer', 'site_transfer', 'supervisor_change', 'role_change', 'employment_type_change', 'status_change'];
const cap = (s: string) => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// Downstream actions the Workflow Engine performs once a request is approved
// (informational — see the file header note on task #33).
const STATUS_SYS_ACTIONS = ['Disable login if inactive / terminated', 'Start offboarding if terminated', 'Flag open workflow tasks for reassignment', 'Notify supervisor, HR and Admin'];
const CHANGE_SYS_ACTIONS = ['Apply approved value to app_users or the HR extension table', 'Close the previous assignment and create assignment history', 'Recalculate Training & Competency requirements', 'Send required notifications and write the HR audit event'];
const OFFBOARD_SYS_ACTIONS = ['Disable login and revoke access', 'Recover assigned assets', 'Reassign open workflow tasks', 'Notify Finance, Admin and Operations'];

// ── shared modal shell + tiny controls (faithful v36 modal) ─────────────────────

function Modal(
  { title, onClose, footer, children, size = 'sm' }:
  { title: string; onClose: () => void; footer: VNode; children: VNode | (VNode | null)[]; size?: 'sm' | 'lg' },
): VNode {
  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div class={`modal ${size}`} onClick={e => e.stopPropagation()}>
        <div class="modal-head"><h3>{title}</h3><button class="modal-close" type="button" onClick={onClose} aria-label="Close">×</button></div>
        <div class="modal-body"><div class="ui-dialog-stack">{children}</div></div>
        <div class="modal-foot">{footer}</div>
      </div>
    </div>
  );
}
function L({ label, value, onInput, type = 'text', full = false }: { label: string; value: string; onInput: (v: string) => void; type?: string; full?: boolean }): VNode {
  return <div class={`form-field ${full ? 'full' : ''}`}><label>{label}</label><input type={type} value={value} onInput={e => onInput(e.currentTarget.value)} /></div>;
}
function S(
  { label, value, onInput, options, idOptions, placeholder, full = false }:
  { label: string; value: string; onInput: (v: string) => void; options?: string[]; idOptions?: { id: string; name: string }[]; placeholder?: string; full?: boolean },
): VNode {
  return (
    <div class={`form-field ${full ? 'full' : ''}`}>
      <label>{label}</label>
      <select value={value} onChange={e => onInput(e.currentTarget.value)}>
        {idOptions && <option value="">{placeholder ?? '—'}</option>}
        {options ? options.map(o => <option value={o}>{cap(o)}</option>) : (idOptions ?? []).map(o => <option value={o.id}>{o.name}</option>)}
      </select>
    </div>
  );
}
function C({ label, checked, onInput }: { label: string; checked: boolean; onInput: (v: boolean) => void }): VNode {
  return <label class="checkbox-row"><input type="checkbox" checked={checked} onChange={e => onInput(e.currentTarget.checked)} /> {label}</label>;
}
function Err({ m }: { m: string | null }): VNode | null { return m ? <div class="ui-warn">{m}</div> : null; }

const footBtns = (onClose: () => void, label: string, pending: boolean, pendingLabel: string, submit: () => void, note?: string): VNode => (
  <>
    {note ? <span class="ui-foot-note">{note}</span> : null}
    <button class="ui-btn-secondary" type="button" onClick={onClose}>Cancel</button>
    <button class="ui-btn-primary" type="button" disabled={pending} onClick={submit}>{pending ? pendingLabel : label}</button>
  </>
);

interface DialogProps { employeeId: string; onClose: () => void; onToast: (m: string) => void }

// ── Contact ──────────────────────────────────────────────────────────────────────

export function ContactDialog({ employeeId, onClose, onToast }: DialogProps): VNode {
  const detailQ = useHrEmployee(employeeId);
  const [mode, setMode] = useState<'direct' | 'request'>('direct');
  const [f, setF] = useState({ email: '', phone: '', personalEmail: '', emName: '', emPhone: '', emRel: '', reason: '' });
  const [err, setErr] = useState<string | null>(null);
  const m = useUpdateHrContact();
  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }));
  // Pre-fill current values once the profile loads (emergency_contact_* in the get select).
  useEffect(() => {
    const e = detailQ.data?.employee;
    if (e) setF(p => ({
      ...p, email: e.email ?? '', phone: e.phone ?? '', personalEmail: e.personal_email ?? '',
      emName: e.emergency_contact_name ?? '', emPhone: e.emergency_contact_phone ?? '', emRel: e.emergency_contact_relationship ?? '',
    }));
  }, [detailQ.data]);
  function submit() {
    if (mode === 'request' && !f.reason.trim()) { setErr('A reason is required for a change request.'); return; }
    m.mutate({
      employeeId, mode,
      work: { email: f.email.trim() || undefined, phone: f.phone.trim() || undefined },
      personal: { personalEmail: f.personalEmail.trim() || undefined },
      emergency: { name: f.emName.trim() || undefined, phone: f.emPhone.trim() || undefined, relationship: f.emRel.trim() || undefined },
      reason: f.reason.trim() || undefined,
    }, {
      onSuccess: () => { onToast(mode === 'request' ? 'Contact change request submitted' : 'Contact updated'); onClose(); },
      onError: e => setErr(e instanceof Error ? e.message : 'Update failed.'),
    });
  }
  return (
    <Modal title="Edit Contact" size="lg" onClose={onClose}
      footer={footBtns(onClose, mode === 'request' ? 'Submit Request' : 'Save', m.isPending, 'Saving…', submit,
        'Contact changes are audited. Personal/emergency may require HR review per policy.')}>
      <div class="ui-note">Contact updates are audited. With the request path, this saves an employee change request instead of a direct update.</div>
      <Err m={err} />
      {detailQ.isLoading ? <div class="ui-panel-empty">Loading current contact…</div> : null}
      <ModalSection title="Contact Details" desc="Work, personal and emergency contact fields used by HR, Notifications and self-service.">
        <div class="form-grid">
          <L label="Work Email" value={f.email} onInput={v => set('email', v)} />
          <L label="Work Phone" value={f.phone} onInput={v => set('phone', v)} />
          <L label="Personal Email" value={f.personalEmail} onInput={v => set('personalEmail', v)} full />
          <L label="Emergency Contact Name" value={f.emName} onInput={v => set('emName', v)} />
          <L label="Emergency Contact Phone" value={f.emPhone} onInput={v => set('emPhone', v)} />
          <L label="Emergency Relationship" value={f.emRel} onInput={v => set('emRel', v)} full />
        </div>
      </ModalSection>
      <ModalSection title="Change Control" desc="Required for audit and sensitive field governance.">
        <div class="form-grid">
          <S label="Update Path" value={mode} onInput={v => setMode(v as 'direct' | 'request')} options={['direct', 'request']} />
          <L label={mode === 'request' ? 'Reason *' : 'Reason'} value={f.reason} onInput={v => set('reason', v)} />
        </div>
      </ModalSection>
    </Modal>
  );
}

// ── Change Status ─────────────────────────────────────────────────────────────────

export function StatusDialog({ employeeId, onClose, onToast }: DialogProps): VNode {
  const detailQ = useHrEmployee(employeeId);
  const [newStatus, setNewStatus] = useState('active');
  const [reason, setReason] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const m = useChangeHrStatus();
  const current = detailQ.data?.employee.status;
  function submit() {
    m.mutate({ employeeId, newStatus, reason: reason.trim() || undefined, effectiveDate: effectiveDate || undefined }, {
      onSuccess: () => { onToast(`Status changed to ${cap(newStatus)}`); onClose(); },
      onError: e => setErr(e instanceof Error ? e.message : 'Status change failed.'),
    });
  }
  return (
    <Modal title="Change Status" onClose={onClose}
      footer={footBtns(onClose, 'Apply Status', m.isPending, 'Saving…', submit)}>
      <div class="ui-warn">Critical statuses (Suspended, Inactive, Terminated) disable new assignments and may trigger offboarding / access removal.</div>
      <Err m={err} />
      <ModalSection title="Status Change" desc="Controls employee lifecycle and access eligibility.">
        <div class="form-grid">
          {current ? <L label="Current Status" value={cap(current)} onInput={() => { /* noop */ }} /> : null}
          <S label="New Status" value={newStatus} onInput={setNewStatus} options={HR_STATUSES} />
          <L label="Effective Date" type="date" value={effectiveDate} onInput={setEffectiveDate} />
          <L label="Reason" value={reason} onInput={setReason} full />
        </div>
      </ModalSection>
      <SystemActionsPanel actions={STATUS_SYS_ACTIONS} />
    </Modal>
  );
}

// ── Offboarding (terminate) ────────────────────────────────────────────────────────

export function OffboardingDialog({ employeeId, onClose, onToast }: DialogProps): VNode {
  const [lastDay, setLastDay] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const m = useChangeHrStatus();
  function submit() {
    if (!reason.trim()) { setErr('A reason is required to start offboarding.'); return; }
    m.mutate({ employeeId, newStatus: 'terminated', reason: reason.trim(), effectiveDate: lastDay || undefined }, {
      onSuccess: () => { onToast('Offboarding started — status set to Terminated'); onClose(); },
      onError: e => setErr(e instanceof Error ? e.message : 'Offboarding failed.'),
    });
  }
  return (
    <Modal title="Start Offboarding" onClose={onClose}
      footer={footBtns(onClose, 'Terminate', m.isPending, 'Working…', submit)}>
      <div class="ui-warn">This sets the employee to <strong>Terminated</strong> and disables their login. Audited and reversible only via a new status change.</div>
      <Err m={err} />
      <ModalSection title="Offboarding Case" desc="Starts the controlled offboarding workflow.">
        <div class="form-grid">
          <L label="Last Working Day" type="date" value={lastDay} onInput={setLastDay} />
          <L label="Reason *" value={reason} onInput={setReason} full />
        </div>
      </ModalSection>
      <SystemActionsPanel actions={OFFBOARD_SYS_ACTIONS} />
    </Modal>
  );
}

// ── Request Change (maker) ──────────────────────────────────────────────────────────

export function ChangeRequestDialog({ employeeId, onClose, onToast }: DialogProps): VNode {
  const [changeType, setChangeType] = useState('department_transfer');
  const [val, setVal] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const m = useCreateHrChangeRequest();
  const orgQ = useHrOrgUnits();
  const siteQ = useHrSites();
  const supQ = useHrEmployees({ limit: 500 });
  const set = (k: string, v: string) => setVal(p => ({ ...p, [k]: v }));

  function fields(): VNode {
    switch (changeType) {
      case 'department_transfer': return <><S label="Department" value={val.departmentId ?? ''} onInput={v => set('departmentId', v)} idOptions={(orgQ.data ?? []).map(o => ({ id: o.id, name: o.name }))} placeholder="Select department" /><S label="Site" value={val.siteId ?? ''} onInput={v => set('siteId', v)} idOptions={(siteQ.data ?? []).map(s => ({ id: s.id, name: s.name }))} placeholder="No change" /></>;
      case 'site_transfer': return <S label="Site" value={val.siteId ?? ''} onInput={v => set('siteId', v)} idOptions={(siteQ.data ?? []).map(s => ({ id: s.id, name: s.name }))} placeholder="Select site" full />;
      case 'supervisor_change': return <S label="New Supervisor" value={val.supervisorId ?? ''} onInput={v => set('supervisorId', v)} idOptions={(supQ.data ?? []).map(r => ({ id: r.id, name: rowName(r) }))} placeholder="Select supervisor" full />;
      case 'role_change': return <S label="New Role" value={val.role ?? ''} onInput={v => set('role', v)} options={ROLES} full />;
      case 'employment_type_change': return <S label="New Employment Type" value={val.employmentType ?? ''} onInput={v => set('employmentType', v)} options={EMPLOYMENT_TYPES} full />;
      case 'status_change': return <S label="Requested Status" value={val.status ?? ''} onInput={v => set('status', v)} options={HR_STATUSES} full />;
      default: return <div class="form-field full" />;
    }
  }
  function requestedValue(): Record<string, unknown> {
    const v = val;
    switch (changeType) {
      case 'department_transfer': return { departmentId: v.departmentId, siteId: v.siteId || undefined };
      case 'site_transfer': return { siteId: v.siteId };
      case 'supervisor_change': return { supervisorId: v.supervisorId };
      case 'role_change': return { role: v.role };
      case 'employment_type_change': return { employmentType: v.employmentType };
      case 'status_change': return { status: v.status };
      default: return {};
    }
  }
  function submit() {
    const rv = requestedValue();
    if (!Object.values(rv).some(Boolean)) { setErr('Select the requested value.'); return; }
    m.mutate({ employeeId, changeType, requestedValue: rv, reason: reason.trim() || undefined }, {
      onSuccess: (res) => { onToast(`Change request ${res.data.change_no} submitted`); onClose(); },
      onError: e => setErr(e instanceof Error ? e.message : 'Request failed.'),
    });
  }
  return (
    <Modal title="Request Change" size="lg" onClose={onClose}
      footer={footBtns(onClose, 'Submit Request', m.isPending, 'Submitting…', submit, 'Routed through maker-checker')}>
      <div class="ui-note">This creates a change request and routes the approval through Workflow before applying changes to app_users or the HR extension tables.</div>
      <Err m={err} />
      <ModalSection title="Requested Change" desc="Select the sensitive employee record change being requested.">
        <div class="form-grid">
          <S label="Change Type" value={changeType} onInput={v => { setChangeType(v); setVal({}); }} options={CHANGE_TYPES} full />
          {fields()}
          <L label="Business Reason" value={reason} onInput={setReason} full />
        </div>
      </ModalSection>
      <SystemActionsPanel actions={CHANGE_SYS_ACTIONS} />
    </Modal>
  );
}

// ── Upload Document ──────────────────────────────────────────────────────────────

const DOC_TYPES = ['government_id', 'contract', 'certificate', 'medical_clearance', 'qualification', 'letter', 'other'];
const CONFIDENTIALITY = ['internal', 'confidential', 'restricted_hr', 'legal', 'medical'];

export function DocumentDialog({ employeeId, onClose, onToast }: DialogProps): VNode {
  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState('government_id');
  const [title, setTitle] = useState('');
  const [confidentiality, setConfidentiality] = useState('internal');
  const [expiryDate, setExpiryDate] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const m = useUploadHrDocument();
  function submit() {
    if (!file) { setErr('Choose a file to upload.'); return; }
    if (!title.trim()) { setErr('A document title is required.'); return; }
    m.mutate({ employeeId, file, documentType, title: title.trim(), confidentiality, expiryDate: expiryDate || undefined }, {
      onSuccess: () => { onToast('Document uploaded'); onClose(); },
      onError: e => setErr(e instanceof Error ? e.message : 'Upload failed.'),
    });
  }
  return (
    <Modal title="Upload Document" onClose={onClose}
      footer={footBtns(onClose, 'Upload', m.isPending, 'Uploading…', submit, 'Restricted tiers need elevated permission')}>
      <div class="ui-note">HR employee documents are private and audited.</div>
      <Err m={err} />
      <ModalSection title="Document Details" desc="The file plus the metadata used to file and govern it.">
        <div class="form-grid">
          <div class="form-field full"><label>File</label><input type="file" onChange={e => setFile(e.currentTarget.files?.[0] ?? null)} /></div>
          <L label="Title" value={title} onInput={setTitle} full />
          <S label="Document Type" value={documentType} onInput={setDocumentType} options={DOC_TYPES} />
          <S label="Confidentiality" value={confidentiality} onInput={setConfidentiality} options={CONFIDENTIALITY} />
          <L label="Expiry Date" type="date" value={expiryDate} onInput={setExpiryDate} full />
        </div>
      </ModalSection>
    </Modal>
  );
}

// ── Edit Statutory Profile (Trinidad & Tobago) ──────────────────────────────────

export function StatutoryDialog({ employeeId, onClose, onToast }: DialogProps): VNode {
  const detailQ = useHrEmployee(employeeId);
  const m = useUpdateHrStatutory();
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    nisNumber: '', nisStatus: 'pending', nisEffectiveDate: '', birFileNumber: '',
    payeApplicable: true, td1Received: false, td1EffectiveYear: '',
    hsApplicable: true, hsExemptionReason: '', markVerified: false,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(p => ({ ...p, [k]: v }));
  useEffect(() => {
    const s = detailQ.data?.statutory;
    if (s) setF(p => ({
      ...p,
      nisNumber: s.nis_number ?? '', nisStatus: s.nis_status || 'pending', nisEffectiveDate: s.nis_effective_date ?? '',
      birFileNumber: s.bir_file_number ?? '', payeApplicable: s.paye_applicable, td1Received: s.td1_received,
      td1EffectiveYear: s.td1_effective_year != null ? String(s.td1_effective_year) : '',
      hsApplicable: s.hs_applicable, hsExemptionReason: s.hs_exemption_reason ?? '',
    }));
  }, [detailQ.data]);
  function submit() {
    m.mutate({
      employeeId,
      nisNumber: f.nisNumber.trim() || null, nisStatus: f.nisStatus, nisEffectiveDate: f.nisEffectiveDate || null,
      birFileNumber: f.birFileNumber.trim() || null, payeApplicable: f.payeApplicable, td1Received: f.td1Received,
      td1EffectiveYear: f.td1EffectiveYear ? Number(f.td1EffectiveYear) : null,
      hsApplicable: f.hsApplicable, hsExemptionReason: f.hsExemptionReason.trim() || null,
      markVerified: f.markVerified,
    }, {
      onSuccess: () => { onToast('Statutory profile updated'); onClose(); },
      onError: e => setErr(e instanceof Error ? e.message : 'Update failed.'),
    });
  }
  return (
    <Modal title="Edit Statutory Profile" size="lg" onClose={onClose}
      footer={footBtns(onClose, 'Save Statutory', m.isPending, 'Saving…', submit, 'Payroll stays blocked until NIS, BIR/TD1 and Health Surcharge pass.')}>
      <div class="ui-note">Trinidad &amp; Tobago statutory profile. Changes are audited and recompute payroll readiness.</div>
      <Err m={err} />
      {detailQ.isLoading ? <div class="ui-panel-empty">Loading current statutory profile…</div> : null}
      <ModalSection title="NIS" desc="National Insurance registration.">
        <div class="form-grid">
          <L label="NIS Number" value={f.nisNumber} onInput={v => set('nisNumber', v)} />
          <S label="NIS Status" value={f.nisStatus} onInput={v => set('nisStatus', v)} options={NIS_STATUSES} />
          <L label="NIS Effective Date" type="date" value={f.nisEffectiveDate} onInput={v => set('nisEffectiveDate', v)} full />
        </div>
      </ModalSection>
      <ModalSection title="BIR / PAYE & TD1" desc="Income-tax registration and declarations.">
        <div class="form-grid">
          <L label="BIR File Number" value={f.birFileNumber} onInput={v => set('birFileNumber', v)} />
          <L label="TD1 Effective Year" value={f.td1EffectiveYear} onInput={v => set('td1EffectiveYear', v)} />
          <C label="PAYE applicable" checked={f.payeApplicable} onInput={v => set('payeApplicable', v)} />
          <C label="TD1 received" checked={f.td1Received} onInput={v => set('td1Received', v)} />
        </div>
      </ModalSection>
      <ModalSection title="Health Surcharge" desc="Standard deduction unless exempt.">
        <div class="form-grid">
          <C label="HS applicable" checked={f.hsApplicable} onInput={v => set('hsApplicable', v)} />
          <C label="Mark statutory profile verified" checked={f.markVerified} onInput={v => set('markVerified', v)} />
          <L label="HS Exemption Reason" value={f.hsExemptionReason} onInput={v => set('hsExemptionReason', v)} full />
        </div>
      </ModalSection>
    </Modal>
  );
}
