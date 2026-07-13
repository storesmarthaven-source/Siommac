/**
 * src/components/sections/HSE/training/TrainingDialogs.tsx
 * Dialog suite for the Training module: Add Certificate, Renew, Assign Training,
 * Create Role Requirement. Wired to the live API.
 */

import { type VNode } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { HseModal, Field, SelectInput, TextInput } from '@ui';
import {
  useCreateCertificate, useRenewCertificate, useAssignTraining, useCreateRequirement,
  useCompetencies, useCourses,
} from '@api/hse/training';
import { useEmployeeOptions } from '../inspections/useEmployeeOptions';

const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// ── Add Certificate ──────────────────────────────────────────────────────────────
export function AddCertificateDialog({ open, onClose, presetWorkerId }: { open: boolean; onClose: () => void; presetWorkerId?: string }): VNode {
  const create = useCreateCertificate();
  const users = useEmployeeOptions();
  const comps = useCompetencies().data?.data ?? [];
  const [workerId, setWorkerId] = useState(presetWorkerId ?? '');
  const [competencyId, setCompetencyId] = useState('');
  const courses = useCourses(competencyId || undefined).data?.data ?? [];
  const [courseId, setCourseId] = useState('');
  const [courseName, setCourseName] = useState('');
  const [provider, setProvider] = useState('');
  const [certNumber, setCertNumber] = useState('');
  const [issuedAt, setIssuedAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [verify, setVerify] = useState(true);

  useEffect(() => { if (open) setWorkerId(presetWorkerId ?? ''); }, [open, presetWorkerId]);

  const reset = () => { setCompetencyId(''); setCourseId(''); setCourseName(''); setProvider(''); setCertNumber(''); setIssuedAt(''); setExpiresAt(''); setVerify(true); };
  const submit = () => {
    const name = courseName.trim() || (comps.find(c => c.id === competencyId)?.name ?? '');
    if (!workerId || !name || !issuedAt || !expiresAt) return;
    create.mutate({
      workerId, competencyId: competencyId || null, courseId: courseId || null, courseName: name,
      provider: provider || null, certificateNumber: certNumber || null,
      issuedAt: new Date(issuedAt).toISOString().slice(0, 10), expiresAt: new Date(expiresAt).toISOString().slice(0, 10),
      verificationRequired: verify,
    }, { onSuccess: () => { reset(); onClose(); } });
  };

  return (
    <HseModal open={open} onClose={onClose} title="Add Certificate" sub="Record and verify a worker training certificate."
      submitLabel={create.isPending ? 'Saving…' : 'Add Certificate'} onSubmit={submit}>
      <div class="hse-form-grid">
        <Field label="Worker"><SelectInput value={workerId} onInput={setWorkerId} options={[{ value: '', label: 'Select worker' }, ...users]} /></Field>
        <Field label="Competency"><SelectInput value={competencyId} onInput={setCompetencyId} options={[{ value: '', label: 'None' }, ...comps.map(c => ({ value: c.id, label: c.name }))]} /></Field>
        <Field label="Course"><SelectInput value={courseId} onInput={v => { setCourseId(v); const c = courses.find(x => x.id === v); if (c) setCourseName(c.name); }} options={[{ value: '', label: 'None / free text' }, ...courses.map(c => ({ value: c.id, label: c.name }))]} /></Field>
        <Field label="Course name"><TextInput value={courseName} onInput={setCourseName} placeholder="e.g. Confined Space Entry L1" /></Field>
        <Field label="Provider"><TextInput value={provider} onInput={setProvider} placeholder="Training provider" /></Field>
        <Field label="Certificate number"><TextInput value={certNumber} onInput={setCertNumber} placeholder="Optional" /></Field>
        <Field label="Issued date"><input class="ui-input" type="date" value={issuedAt} onInput={e => setIssuedAt((e.target as HTMLInputElement).value)} /></Field>
        <Field label="Expiry date"><input class="ui-input" type="date" value={expiresAt} onInput={e => setExpiresAt((e.target as HTMLInputElement).value)} /></Field>
        <Field label="" wide>
          <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.8rem' }}>
            <input type="checkbox" checked={verify} onInput={e => setVerify((e.target as HTMLInputElement).checked)} />
            <span>Requires verification before it counts toward compliance</span>
          </label>
        </Field>
      </div>
    </HseModal>
  );
}

// ── Renew Certificate ────────────────────────────────────────────────────────────
export function RenewCertificateDialog({ certificateId, open, onClose }: { certificateId: string; open: boolean; onClose: () => void }): VNode {
  const renew = useRenewCertificate();
  const [issuedAt, setIssuedAt] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [certNumber, setCertNumber] = useState('');
  const submit = () => {
    if (!issuedAt || !expiresAt) return;
    renew.mutate({ certificateId, issuedAt: new Date(issuedAt).toISOString().slice(0, 10), expiresAt: new Date(expiresAt).toISOString().slice(0, 10), certificateNumber: certNumber || null },
      { onSuccess: () => { setIssuedAt(''); setExpiresAt(''); setCertNumber(''); onClose(); } });
  };
  return (
    <HseModal open={open} onClose={onClose} title="Renew Certificate" sub="Issue a new version; the previous is archived."
      submitLabel={renew.isPending ? 'Renewing…' : 'Renew'} onSubmit={submit}>
      <div class="hse-form-grid">
        <Field label="New issued date"><input class="ui-input" type="date" value={issuedAt} onInput={e => setIssuedAt((e.target as HTMLInputElement).value)} /></Field>
        <Field label="New expiry date"><input class="ui-input" type="date" value={expiresAt} onInput={e => setExpiresAt((e.target as HTMLInputElement).value)} /></Field>
        <Field label="Certificate number" wide><TextInput value={certNumber} onInput={setCertNumber} placeholder="Optional" /></Field>
      </div>
    </HseModal>
  );
}

// ── Assign Training ──────────────────────────────────────────────────────────────
export function AssignTrainingDialog({ open, onClose, presetWorkerId, presetCompetencyId }: { open: boolean; onClose: () => void; presetWorkerId?: string; presetCompetencyId?: string }): VNode {
  const assign = useAssignTraining();
  const users = useEmployeeOptions();
  const comps = useCompetencies().data?.data ?? [];
  const [workerId, setWorkerId] = useState(presetWorkerId ?? '');
  const [competencyId, setCompetencyId] = useState(presetCompetencyId ?? '');
  const [reason, setReason] = useState('');
  const [priority, setPriority] = useState('medium');
  const [dueAt, setDueAt] = useState('');
  useEffect(() => { if (open) { setWorkerId(presetWorkerId ?? ''); setCompetencyId(presetCompetencyId ?? ''); } }, [open, presetWorkerId, presetCompetencyId]);
  const submit = () => {
    if (!workerId || !dueAt) return;
    assign.mutate({ workerId, competencyId: competencyId || null, reason: reason || null, priority, dueAt: new Date(dueAt).toISOString() },
      { onSuccess: () => { setReason(''); setDueAt(''); onClose(); } });
  };
  return (
    <HseModal open={open} onClose={onClose} title="Assign Training" sub="Assign training to close a competency gap."
      submitLabel={assign.isPending ? 'Assigning…' : 'Assign Training'} onSubmit={submit}>
      <div class="hse-form-grid">
        <Field label="Worker"><SelectInput value={workerId} onInput={setWorkerId} options={[{ value: '', label: 'Select worker' }, ...users]} /></Field>
        <Field label="Competency"><SelectInput value={competencyId} onInput={setCompetencyId} options={[{ value: '', label: 'None' }, ...comps.map(c => ({ value: c.id, label: c.name }))]} /></Field>
        <Field label="Priority"><SelectInput value={priority} onInput={setPriority} options={['low', 'medium', 'high', 'critical'].map(p => ({ value: p, label: titleCase(p) }))} /></Field>
        <Field label="Due date"><input class="ui-input" type="date" value={dueAt} onInput={e => setDueAt((e.target as HTMLInputElement).value)} /></Field>
        <Field label="Reason" wide><TextInput value={reason} onInput={setReason} placeholder="e.g. expired Confined Space cert" /></Field>
      </div>
    </HseModal>
  );
}

// ── Create Role Requirement ──────────────────────────────────────────────────────
export function CreateRequirementDialog({ open, onClose }: { open: boolean; onClose: () => void }): VNode {
  const create = useCreateRequirement();
  const comps = useCompetencies().data?.data ?? [];
  const [competencyId, setCompetencyId] = useState('');
  const [roleName, setRoleName] = useState('');
  const [level, setLevel] = useState('required');
  const submit = () => {
    if (!competencyId || !roleName) return;
    create.mutate({ competencyId, roleName, requirementLevel: level }, { onSuccess: () => { setRoleName(''); onClose(); } });
  };
  return (
    <HseModal open={open} onClose={onClose} title="Create Role Requirement" sub="Define a competency required for a role."
      submitLabel={create.isPending ? 'Saving…' : 'Create Requirement'} onSubmit={submit}>
      <div class="hse-form-grid">
        <Field label="Competency"><SelectInput value={competencyId} onInput={setCompetencyId} options={[{ value: '', label: 'Select competency' }, ...comps.map(c => ({ value: c.id, label: c.name }))]} /></Field>
        <Field label="Role"><SelectInput value={roleName} onInput={setRoleName} options={[{ value: '', label: 'Select role' }, ...['employee', 'manager', 'admin'].map(r => ({ value: r, label: titleCase(r) }))]} /></Field>
        <Field label="Requirement level"><SelectInput value={level} onInput={setLevel} options={['required', 'recommended', 'optional', 'site_specific', 'task_specific'].map(l => ({ value: l, label: titleCase(l) }))} /></Field>
      </div>
    </HseModal>
  );
}
