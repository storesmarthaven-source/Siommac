/**
 * src/components/sections/HSE/risk-jsa/dialogs/LinkCapaDialog.tsx
 *
 * Raise a CAPA action and link it to a hazard / assessment / JSA. Reuses the
 * canonical /capa/create endpoint (module-service-adapter: writes the record,
 * emits the event, assigns the owner, opens the closure workflow).
 */

import { useState } from 'preact/hooks';
import { type VNode } from 'preact';
import { Modal, FormGrid, Field, TextInput, SelectInput, TextareaInput } from '@ui';
import { useLinkCapa } from '@api/hse/riskJsa';
import { DialogError, type WorkflowEntity } from './SubmitForReviewDialog';

export interface LinkCapaDialogProps {
  open: boolean;
  onClose: () => void;
  entityType: WorkflowEntity;
  /** CAPA source_id is the business ref (e.g. HAZ-2026-0001). */
  entityRef: string;
  entityTitle: string;
}

const PRIORITIES = [
  { value: 'low',      label: 'Low' },
  { value: 'medium',   label: 'Medium' },
  { value: 'high',     label: 'High' },
  { value: 'critical', label: 'Critical' },
];

export function LinkCapaDialog({
  open, onClose, entityType, entityRef, entityTitle,
}: LinkCapaDialogProps): VNode | null {
  const [title,       setTitle]       = useState('');
  const [description, setDescription] = useState('');
  const [priority,    setPriority]    = useState('medium');
  const [dueAt,       setDueAt]       = useState('');
  const [error,       setError]       = useState('');

  const linkCapa = useLinkCapa();
  const isValid  = title.trim().length > 0 && description.trim().length > 0;

  function handleClose() {
    setTitle(''); setDescription(''); setPriority('medium'); setDueAt(''); setError('');
    onClose();
  }

  async function handleSubmit() {
    if (!isValid) { setError('Title and description are required.'); return; }
    setError('');
    try {
      await linkCapa.mutateAsync({
        sourceType:  entityType,
        sourceId:    entityRef,
        title:       title.trim(),
        description: description.trim(),
        priority:    priority as 'low' | 'medium' | 'high' | 'critical',
        dueAt:       dueAt ? new Date(dueAt).toISOString() : undefined,
      });
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to raise CAPA. Please try again.');
    }
  }

  return (
    <Modal
      open={open}
      title="Raise & Link CAPA"
      icon="fa-list-check"
      size="md"
      onClose={handleClose}
      onSubmit={() => void handleSubmit()}
      submitLabel="Raise CAPA"
      submitDisabled={linkCapa.isPending || !isValid}
    >
      <FormGrid>
        <Field label="Linked to" wide>
          <p style={{ margin: 0, fontSize: '0.85rem' }}><strong>{entityRef}</strong> — {entityTitle}</p>
        </Field>

        <Field label="CAPA Title *" wide>
          <TextInput value={title} onInput={setTitle} placeholder="e.g. Install fixed guard at conveyor nip point" />
        </Field>

        <Field label="Description *" wide>
          <TextareaInput value={description} onInput={setDescription} rows={3}
            placeholder="What corrective / preventive action is required…" />
        </Field>

        <Field label="Priority *">
          <SelectInput value={priority} onInput={setPriority} options={PRIORITIES} />
        </Field>

        <Field label="Due date">
          <TextInput value={dueAt} onInput={setDueAt} type="date" />
        </Field>

        {error && <DialogError message={error} />}
      </FormGrid>
    </Modal>
  );
}
