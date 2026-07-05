/**
 * src/components/sections/HR/OnboardingAddTaskModal.tsx
 *
 * Shared "Add Task" modal — extracted from OnboardingCaseDetail so the Command Center
 * (which has no single case in scope) can reuse the exact same real create-task flow.
 * When `caseId` is null, a case picker is shown first (cross-case usage); when a caseId
 * is supplied, the picker is skipped (single-case usage, matches the original behavior).
 */
import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { Modal, Field, FormGrid, TextInput, SelectInput } from '@ui';
import { useHrEmployees } from '@api/hr/employees';
import { useOnboardingAddTask, useOnboardingCases } from '@api/hr/onboarding';

export interface OnboardingAddTaskModalProps {
  open: boolean;
  /** Fixed case to add the task to. Pass null to show a case picker (cross-case usage). */
  caseId: string | null;
  onClose: () => void;
  onToast: (message: string) => void;
  onAdded?: () => void;
}

const EMPTY_FORM = { taskTitle: '', assignedTo: '', dueAt: '', priority: 'normal', isBlocking: false, requiresEvidence: false };

export function OnboardingAddTaskModal({ open, caseId, onClose, onToast, onAdded }: OnboardingAddTaskModalProps): VNode {
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const needsCasePicker = !caseId;

  const empsQ = useHrEmployees({ limit: 500 });
  const employees = empsQ.data ?? [];
  const casesQ = useOnboardingCases(
    { statuses: ['not_started', 'in_progress', 'blocked'], pageSize: 100, sort: { field: 'due_at', direction: 'asc' } },
    { enabled: open && needsCasePicker },
  );
  const cases = casesQ.data?.rows ?? [];
  const addTaskMut = useOnboardingAddTask();

  function handleClose(): void {
    setForm(EMPTY_FORM);
    setSelectedCaseId('');
    onClose();
  }

  async function submit(): Promise<void> {
    const targetCaseId = caseId ?? selectedCaseId;
    if (needsCasePicker && !targetCaseId) { onToast('Select a case first.'); return; }
    if (!form.taskTitle.trim()) { onToast('Task title is required.'); return; }
    try {
      await addTaskMut.mutateAsync({
        caseId: targetCaseId, taskTitle: form.taskTitle.trim(), assignedTo: form.assignedTo || null,
        dueAt: form.dueAt || null, priority: form.priority, isBlocking: form.isBlocking, requiresEvidence: form.requiresEvidence,
      });
      onToast('Task added');
      onAdded?.();
      handleClose();
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Failed to add task');
    }
  }

  return (
    <Modal
      open={open} title="Add Task" icon="fa-list-check" onClose={handleClose}
      onSubmit={() => void submit()} submitLabel="Add Task" submitDisabled={addTaskMut.isPending}
    >
      <FormGrid>
        {needsCasePicker && (
          <Field label="Case" wide>
            <select class="ui-select" value={selectedCaseId} onChange={e => setSelectedCaseId((e.target as HTMLSelectElement).value)}>
              <option value="">{casesQ.isLoading ? 'Loading cases…' : 'Select a case…'}</option>
              {cases.map(c => <option key={c.caseId} value={c.caseId}>{c.caseNo} · {c.employeeName ?? '—'}</option>)}
            </select>
          </Field>
        )}
        <Field label="Task title" wide><TextInput value={form.taskTitle} onInput={v => setForm(f => ({ ...f, taskTitle: v }))} placeholder="e.g. Collect signed contract" /></Field>
        <Field label="Assignee">
          <select class="ui-select" value={form.assignedTo} onChange={e => setForm(f => ({ ...f, assignedTo: (e.target as HTMLSelectElement).value }))}>
            <option value="">Unassigned</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.full_name ?? e.email ?? e.id}</option>)}
          </select>
        </Field>
        <Field label="Due date"><TextInput type="date" value={form.dueAt} onInput={v => setForm(f => ({ ...f, dueAt: v }))} /></Field>
        <Field label="Priority">
          <SelectInput value={form.priority} onInput={v => setForm(f => ({ ...f, priority: v }))} options={['low', 'normal', 'high', 'critical']} />
        </Field>
      </FormGrid>
      <label class="obx-checkline"><input type="checkbox" checked={form.isBlocking} onChange={e => setForm(f => ({ ...f, isBlocking: (e.target as HTMLInputElement).checked }))} /> Blocks activation until complete</label>
      <label class="obx-checkline"><input type="checkbox" checked={form.requiresEvidence} onChange={e => setForm(f => ({ ...f, requiresEvidence: (e.target as HTMLInputElement).checked }))} /> Requires evidence to complete</label>
    </Modal>
  );
}
