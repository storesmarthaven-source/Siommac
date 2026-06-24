/**
 * src/components/sections/HSE/inspections/InspectionDialogs.tsx
 *
 * The Inspections dialog suite (spec §7): Record Finding, Assign Corrective
 * Action, Close Inspection, Close Finding, Reschedule, and a Template builder.
 * All wired to the live API.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { HseModal, Field, SelectInput, TextInput, TextareaInput } from '@ui';
import {
  useCreateFinding, useAssignFindingAction, useFindingTransition,
  useInspectionTransition, useRescheduleInspection, useInspection,
  useCreateTemplate, type FindingSeverity,
} from '@api/hse/inspections';
import { useEmployeeOptions } from './useEmployeeOptions';

const SEVERITIES: FindingSeverity[] = ['critical', 'high', 'medium', 'low', 'observation'];
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── Record Finding ──────────────────────────────────────────────────────────────
export function RecordFindingDialog({ inspectionId, open, onClose }: { inspectionId: string; open: boolean; onClose: () => void }): VNode {
  const create = useCreateFinding();
  const users = useEmployeeOptions();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<FindingSeverity>('medium');
  const [category, setCategory] = useState('');
  const [area, setArea] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [dueAt, setDueAt] = useState('');

  const reset = () => { setTitle(''); setDescription(''); setSeverity('medium'); setCategory(''); setArea(''); setOwnerId(''); setDueAt(''); };
  const submit = () => {
    if (!title.trim()) return;
    create.mutate({
      inspectionId, title: title.trim(), description: description || null, severity,
      category: category || null, area: area || null, ownerId: ownerId || null,
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
    }, { onSuccess: () => { reset(); onClose(); } });
  };

  return (
    <HseModal open={open} onClose={onClose} title="Record Finding" sub="Raise a non-conformance or observation from this inspection."
      submitLabel={create.isPending ? 'Saving…' : 'Save Finding'} onSubmit={submit}>
      <div class="hse-form-grid">
        <Field label="Finding title" wide><TextInput value={title} onInput={setTitle} placeholder="e.g. Emergency exit blocked by pallets" /></Field>
        <Field label="Severity"><SelectInput value={severity} onInput={v => setSeverity(v as FindingSeverity)} options={SEVERITIES.map(s => ({ value: s, label: titleCase(s) }))} /></Field>
        <Field label="Category"><TextInput value={category} onInput={setCategory} placeholder="e.g. Housekeeping" /></Field>
        <Field label="Location / area"><TextInput value={area} onInput={setArea} placeholder="e.g. Bay 3" /></Field>
        <Field label="Owner"><SelectInput value={ownerId} onInput={setOwnerId} options={[{ value: '', label: 'Unassigned' }, ...users]} /></Field>
        <Field label="Due date"><input class="ui-input" type="date" value={dueAt} onInput={e => setDueAt((e.target as HTMLInputElement).value)} /></Field>
        <Field label="Description" wide><TextareaInput value={description} onInput={setDescription} placeholder="What was observed?" /></Field>
      </div>
    </HseModal>
  );
}

// ── Assign Corrective Action ─────────────────────────────────────────────────────
export function AssignActionDialog({ findingId, open, onClose }: { findingId: string; open: boolean; onClose: () => void }): VNode {
  const assign = useAssignFindingAction();
  const users = useEmployeeOptions();
  const [desc, setDesc] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [dueAt, setDueAt] = useState('');

  const reset = () => { setDesc(''); setOwnerId(''); setDueAt(''); };
  const submit = () => {
    if (!desc.trim()) return;
    assign.mutate({ findingId, actionDescription: desc.trim(), ownerId: ownerId || null, dueAt: dueAt ? new Date(dueAt).toISOString() : null },
      { onSuccess: () => { reset(); onClose(); } });
  };

  return (
    <HseModal open={open} onClose={onClose} title="Assign Corrective Action" sub="Add a corrective action and assign an owner."
      submitLabel={assign.isPending ? 'Assigning…' : 'Assign Action'} onSubmit={submit}>
      <div class="hse-form-grid">
        <Field label="Corrective action" wide><TextareaInput value={desc} onInput={setDesc} placeholder="What needs to be done?" /></Field>
        <Field label="Owner"><SelectInput value={ownerId} onInput={setOwnerId} options={[{ value: '', label: 'Unassigned' }, ...users]} /></Field>
        <Field label="Due date"><input class="ui-input" type="date" value={dueAt} onInput={e => setDueAt((e.target as HTMLInputElement).value)} /></Field>
      </div>
    </HseModal>
  );
}

// ── Close Inspection ─────────────────────────────────────────────────────────────
export function CloseInspectionDialog({ inspectionId, open, onClose }: { inspectionId: string; open: boolean; onClose: () => void }): VNode {
  const { data } = useInspection(open ? inspectionId : null);
  const review = useInspectionTransition();
  const [notes, setNotes] = useState('');
  const [ack, setAck] = useState(false);

  const openCritical = (data?.data?.findings ?? []).filter(f => f.severity === 'critical' && !['closed', 'cancelled'].includes(f.status));
  const blocked = openCritical.length > 0 && !ack;

  const submit = () => {
    if (blocked) return;
    review.mutate({ action: 'review', inspectionId, note: notes || undefined }, { onSuccess: () => { setNotes(''); setAck(false); onClose(); } });
  };

  return (
    <HseModal open={open} onClose={onClose} title="Complete Inspection" sub="Review and complete this inspection."
      submitLabel={review.isPending ? 'Completing…' : 'Complete Inspection'} onSubmit={submit}>
      <div class="hse-form-grid">
        <Field label="Completion notes" wide><TextareaInput value={notes} onInput={setNotes} placeholder="Summary / reviewer comments" /></Field>
        {openCritical.length > 0 && (
          <Field label="" wide>
            <label style={{ display: 'flex', gap: '8px', alignItems: 'start', fontSize: '0.8rem', color: 'var(--siomac-red)' }}>
              <input type="checkbox" checked={ack} onInput={e => setAck((e.target as HTMLInputElement).checked)} />
              <span>{openCritical.length} open critical finding(s) remain. I acknowledge completing with critical findings open.</span>
            </label>
          </Field>
        )}
      </div>
    </HseModal>
  );
}

// ── Close Finding ────────────────────────────────────────────────────────────────
export function CloseFindingDialog({ findingId, open, onClose }: { findingId: string; open: boolean; onClose: () => void }): VNode {
  const close = useFindingTransition();
  const [notes, setNotes] = useState('');
  const submit = () => close.mutate({ action: 'close', findingId, note: notes || undefined }, { onSuccess: () => { setNotes(''); onClose(); } });
  return (
    <HseModal open={open} onClose={onClose} title="Close Finding" sub="Confirm the corrective action is complete and close this finding."
      submitLabel={close.isPending ? 'Closing…' : 'Close Finding'} onSubmit={submit}>
      <div class="hse-form-grid">
        <Field label="Closure notes" wide><TextareaInput value={notes} onInput={setNotes} placeholder="How was it resolved / verified?" /></Field>
      </div>
    </HseModal>
  );
}

// ── Reschedule ───────────────────────────────────────────────────────────────────
export function RescheduleDialog({ inspectionId, open, onClose }: { inspectionId: string; open: boolean; onClose: () => void }): VNode {
  const reschedule = useRescheduleInspection();
  const [newDue, setNewDue] = useState('');
  const [reason, setReason] = useState('');
  const submit = () => {
    if (!newDue || !reason.trim()) return;
    reschedule.mutate({ inspectionId, newDueAt: new Date(newDue).toISOString(), reason: reason.trim() },
      { onSuccess: () => { setNewDue(''); setReason(''); onClose(); } });
  };
  return (
    <HseModal open={open} onClose={onClose} title="Reschedule Inspection" sub="Set a new due date for this inspection."
      submitLabel={reschedule.isPending ? 'Rescheduling…' : 'Reschedule'} onSubmit={submit}>
      <div class="hse-form-grid">
        <Field label="New due date"><input class="ui-input" type="date" value={newDue} onInput={e => setNewDue((e.target as HTMLInputElement).value)} /></Field>
        <Field label="Reason" wide><TextInput value={reason} onInput={setReason} placeholder="Why is it being rescheduled?" /></Field>
      </div>
    </HseModal>
  );
}

// ── Template builder ─────────────────────────────────────────────────────────────
interface DraftItem { question: string; responseType: string; isRequired: boolean; isCritical: boolean; autoCreateFindingOnFail: boolean }

export function TemplateBuilderDialog({ open, onClose }: { open: boolean; onClose: () => void }): VNode {
  const create = useCreateTemplate();
  const [name, setName] = useState('');
  const [type, setType] = useState('housekeeping');
  const [items, setItems] = useState<DraftItem[]>([{ question: '', responseType: 'pass_fail_na', isRequired: true, isCritical: false, autoCreateFindingOnFail: false }]);

  const setItem = (i: number, patch: Partial<DraftItem>) => setItems(items.map((it, idx) => idx === i ? { ...it, ...patch } : it));
  const addItem = () => setItems([...items, { question: '', responseType: 'pass_fail_na', isRequired: true, isCritical: false, autoCreateFindingOnFail: false }]);
  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i));
  const reset = () => { setName(''); setType('housekeeping'); setItems([{ question: '', responseType: 'pass_fail_na', isRequired: true, isCritical: false, autoCreateFindingOnFail: false }]); };

  const submit = () => {
    const valid = items.filter(i => i.question.trim());
    if (!name.trim() || valid.length === 0) return;
    create.mutate({ name: name.trim(), inspectionType: type, items: valid }, { onSuccess: () => { reset(); onClose(); } });
  };

  const RESP_TYPES = ['pass_fail_na', 'yes_no_na', 'numeric', 'text', 'photo_required', 'signature'];

  return (
    <HseModal open={open} onClose={onClose} title="New Checklist Template" sub="Build a reusable inspection checklist."
      submitLabel={create.isPending ? 'Saving…' : 'Create Template'} onSubmit={submit}>
      <div class="hse-form-grid">
        <Field label="Template name"><TextInput value={name} onInput={setName} placeholder="e.g. Monthly Housekeeping Audit" /></Field>
        <Field label="Inspection type"><TextInput value={type} onInput={setType} placeholder="housekeeping" /></Field>
      </div>
      <div style={{ marginTop: '12px', display: 'grid', gap: '8px' }}>
        {items.map((it, i) => (
          <div key={i} class="vt-table-card" style={{ padding: '10px 12px', display: 'grid', gap: '8px' }}>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input class="ui-input" style={{ flex: 1 }} placeholder={`Question ${i + 1}`} value={it.question} onInput={e => setItem(i, { question: (e.target as HTMLInputElement).value })} />
              {items.length > 1 && <button type="button" class="hse-btn" onClick={() => removeItem(i)}><i class="fas fa-trash" /></button>}
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '0.74rem', alignItems: 'center' }}>
              <select class="emp-filter-select" value={it.responseType} onChange={e => setItem(i, { responseType: (e.target as HTMLSelectElement).value })}>
                {RESP_TYPES.map(rt => <option key={rt} value={rt}>{rt.replace(/_/g, ' ')}</option>)}
              </select>
              <label style={{ display: 'flex', gap: '4px' }}><input type="checkbox" checked={it.isRequired} onInput={e => setItem(i, { isRequired: (e.target as HTMLInputElement).checked })} /> Required</label>
              <label style={{ display: 'flex', gap: '4px' }}><input type="checkbox" checked={it.isCritical} onInput={e => setItem(i, { isCritical: (e.target as HTMLInputElement).checked })} /> Critical</label>
              <label style={{ display: 'flex', gap: '4px' }}><input type="checkbox" checked={it.autoCreateFindingOnFail} onInput={e => setItem(i, { autoCreateFindingOnFail: (e.target as HTMLInputElement).checked })} /> Auto-finding on fail</label>
            </div>
          </div>
        ))}
        <button type="button" class="hse-btn" style={{ justifySelf: 'start' }} onClick={addItem}><i class="fas fa-plus" /> Add Question</button>
      </div>
    </HseModal>
  );
}
