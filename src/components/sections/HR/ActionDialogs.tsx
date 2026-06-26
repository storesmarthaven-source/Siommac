/**
 * src/components/sections/HR/ActionDialogs.tsx
 *
 * HR ▸ Employee Master — the write-action dialogs invoked from the register kebab
 * and the profile drawer (v36 ContactDialog / StatusDialog / Offboarding /
 * ChangeRequest), ported into the Siomac shell and wired to the real endpoints:
 *   Contact        → useUpdateHrContact (direct + maker-checker request)
 *   Change Status  → useChangeHrStatus
 *   Offboarding    → useChangeHrStatus (newStatus = terminated)
 *   Request Change → useCreateHrChangeRequest (maker side of maker-checker)
 *
 * Styling reuses the modal/form CSS in ./HR.css (scoped .hr-emp-master).
 */

import { type VNode } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import {
  useUpdateHrContact, useChangeHrStatus, useCreateHrChangeRequest, useUploadHrDocument,
  useHrOrgUnits, useHrSites, useHrEmployees, useHrEmployee,
} from '@api/hr/employees';
import { rowName } from './shared';

const HR_STATUSES = ['draft', 'pending_onboarding', 'active', 'probation', 'on_leave', 'suspended', 'inactive', 'terminated', 'archived'];
const ROLES = ['employee', 'supervisor', 'manager', 'hr_manager'];
const EMPLOYMENT_TYPES = ['employee', 'contractor', 'intern', 'temporary', 'consultant', 'seconded'];
const CHANGE_TYPES = ['department_transfer', 'site_transfer', 'supervisor_change', 'role_change', 'employment_type_change', 'status_change'];
const cap = (s: string) => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// ── shared modal shell + tiny controls ──────────────────────────────────────────

function Modal(
  { title, onClose, footer, children, size = 'sm' }:
  { title: string; onClose: () => void; footer: VNode; children: VNode | (VNode | null)[]; size?: 'sm' | 'lg' },
): VNode {
  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div class={`modal ${size}`} onClick={e => e.stopPropagation()}>
        <div class="modal-head"><h3>{title}</h3><button class="modal-close" type="button" onClick={onClose} aria-label="Close">×</button></div>
        <div class="modal-body"><section class="form-section">{children}</section></div>
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
function Err({ m }: { m: string | null }): VNode | null { return m ? <div class="warning-card">{m}</div> : null; }

interface DialogProps { employeeId: string; onClose: () => void; onToast: (m: string) => void }

// ── Contact ──────────────────────────────────────────────────────────────────────

const SUBHEAD = { margin: '2px 0 0', fontSize: '13px', color: '#0f172a', fontWeight: 700 } as const;

export function ContactDialog({ employeeId, onClose, onToast }: DialogProps): VNode {
  const detailQ = useHrEmployee(employeeId);
  const [mode, setMode] = useState<'direct' | 'request'>('direct');
  const [f, setF] = useState({ email: '', phone: '', personalEmail: '', emName: '', emPhone: '', emRel: '', reason: '' });
  const [err, setErr] = useState<string | null>(null);
  const m = useUpdateHrContact();
  const set = (k: keyof typeof f, v: string) => setF(p => ({ ...p, [k]: v }));
  // Pre-fill current values once the profile loads (emergency_contact_* now in the get select).
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
    <Modal title="Edit Contact" size="lg" onClose={onClose} footer={
      <><span class="left-note">Contact changes are audited. Personal/emergency may require HR review per policy.</span>
      <button class="secondary-btn" type="button" onClick={onClose}>Cancel</button>
      <button class="primary-btn" type="button" disabled={m.isPending} onClick={submit}>{m.isPending ? 'Saving…' : mode === 'request' ? 'Submit Request' : 'Save'}</button></>
    }>
      <Err m={err} />
      {detailQ.isLoading ? <div class="em-empty">Loading current contact…</div> : null}
      <h4 style={SUBHEAD}>Work Contact</h4>
      <div class="form-grid">
        <L label="Work Email" value={f.email} onInput={v => set('email', v)} />
        <L label="Work Phone" value={f.phone} onInput={v => set('phone', v)} />
      </div>
      <h4 style={SUBHEAD}>Personal Contact</h4>
      <div class="form-grid">
        <L label="Personal Email" value={f.personalEmail} onInput={v => set('personalEmail', v)} full />
      </div>
      <h4 style={SUBHEAD}>Emergency Contact <span style={{ fontWeight: 500, color: '#94a3b8', fontSize: '11px' }}>· restricted · audited</span></h4>
      <div class="form-grid">
        <L label="Name" value={f.emName} onInput={v => set('emName', v)} />
        <L label="Phone" value={f.emPhone} onInput={v => set('emPhone', v)} />
        <L label="Relationship" value={f.emRel} onInput={v => set('emRel', v)} full />
      </div>
      <h4 style={SUBHEAD}>Change Control</h4>
      <div class="form-grid">
        <S label="Update Path" value={mode} onInput={v => setMode(v as 'direct' | 'request')} options={['direct', 'request']} />
        <L label={mode === 'request' ? 'Reason *' : 'Reason'} value={f.reason} onInput={v => set('reason', v)} />
      </div>
    </Modal>
  );
}

// ── Change Status ─────────────────────────────────────────────────────────────────

export function StatusDialog({ employeeId, onClose, onToast }: DialogProps): VNode {
  const [newStatus, setNewStatus] = useState('active');
  const [reason, setReason] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const m = useChangeHrStatus();
  function submit() {
    m.mutate({ employeeId, newStatus, reason: reason.trim() || undefined, effectiveDate: effectiveDate || undefined }, {
      onSuccess: () => { onToast(`Status changed to ${cap(newStatus)}`); onClose(); },
      onError: e => setErr(e instanceof Error ? e.message : 'Status change failed.'),
    });
  }
  return (
    <Modal title="Change Status" onClose={onClose} footer={
      <><button class="secondary-btn" type="button" onClick={onClose}>Cancel</button>
      <button class="primary-btn" type="button" disabled={m.isPending} onClick={submit}>{m.isPending ? 'Saving…' : 'Apply Status'}</button></>
    }>
      <Err m={err} />
      <div class="form-grid">
        <S label="New Status" value={newStatus} onInput={setNewStatus} options={HR_STATUSES} />
        <L label="Effective Date" type="date" value={effectiveDate} onInput={setEffectiveDate} />
        <L label="Reason" value={reason} onInput={setReason} full />
      </div>
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
    <Modal title="Start Offboarding" onClose={onClose} footer={
      <><button class="secondary-btn" type="button" onClick={onClose}>Cancel</button>
      <button class="primary-btn" type="button" disabled={m.isPending} onClick={submit}>{m.isPending ? 'Working…' : 'Terminate'}</button></>
    }>
      <Err m={err} />
      <div class="warning-card">This sets the employee to <strong>Terminated</strong> and disables their login. Audited and reversible only via a new status change.</div>
      <div class="form-grid">
        <L label="Last Working Day" type="date" value={lastDay} onInput={setLastDay} />
        <L label="Reason *" value={reason} onInput={setReason} full />
      </div>
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
    <Modal title="Request Change" onClose={onClose} footer={
      <><span class="left-note">Routed through maker-checker</span>
      <button class="secondary-btn" type="button" onClick={onClose}>Cancel</button>
      <button class="primary-btn" type="button" disabled={m.isPending} onClick={submit}>{m.isPending ? 'Submitting…' : 'Submit Request'}</button></>
    }>
      <Err m={err} />
      <div class="form-grid">
        <S label="Change Type" value={changeType} onInput={v => { setChangeType(v); setVal({}); }} options={CHANGE_TYPES} full />
        {fields()}
        <L label="Reason" value={reason} onInput={setReason} full />
      </div>
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
    <Modal title="Upload Document" onClose={onClose} footer={
      <><span class="left-note">Restricted tiers need elevated permission</span>
      <button class="secondary-btn" type="button" onClick={onClose}>Cancel</button>
      <button class="primary-btn" type="button" disabled={m.isPending} onClick={submit}>{m.isPending ? 'Uploading…' : 'Upload'}</button></>
    }>
      <Err m={err} />
      <div class="form-grid">
        <div class="form-field full"><label>File</label><input type="file" onChange={e => setFile(e.currentTarget.files?.[0] ?? null)} /></div>
        <L label="Title" value={title} onInput={setTitle} full />
        <S label="Document Type" value={documentType} onInput={setDocumentType} options={DOC_TYPES} />
        <S label="Confidentiality" value={confidentiality} onInput={setConfidentiality} options={CONFIDENTIALITY} />
        <L label="Expiry Date" type="date" value={expiryDate} onInput={setExpiryDate} full />
      </div>
    </Modal>
  );
}
