/**
 * src/components/sections/HSE/risk-jsa/dialogs/AddControlDialog.tsx
 *
 * Single-step Modal for adding a control measure to an existing hazard,
 * risk assessment, JSA, or CAPA record. Submits via useCreateControl().
 */

import { useState } from 'preact/hooks';
import { type VNode } from 'preact';
import { Modal, FormGrid, Field, TextInput, SelectInput, TextareaInput } from '@ui';
import { CONTROL_TYPES } from '../shared/ControlsTable';
import { useCreateControl } from '@api/hse/riskJsa';

// ── Component ─────────────────────────────────────────────────────────────────

export interface AddControlDialogProps {
  open: boolean;
  onClose: () => void;
  sourceType: 'hazard' | 'assessment' | 'jsa' | 'capa';
  sourceId: string;
  hazardId?: string | null;
}

export function AddControlDialog({
  open,
  onClose,
  sourceType,
  sourceId,
  hazardId,
}: AddControlDialogProps): VNode | null {
  const [description,          setDescription]          = useState('');
  const [controlType,          setControlType]          = useState('administrative');
  const [dueAt,                setDueAt]                = useState('');
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [notes,                setNotes]                = useState('');
  const [error,                setError]                = useState('');

  const createControl = useCreateControl();

  // ── Validation
  const isValid = description.trim().length > 0;

  // ── Reset on close
  function handleClose() {
    setDescription('');
    setControlType('administrative');
    setDueAt('');
    setVerificationRequired(false);
    setNotes('');
    setError('');
    onClose();
  }

  // ── Submit
  async function handleSubmit() {
    if (!isValid) { setError('Control description is required.'); return; }
    setError('');
    try {
      await createControl.mutateAsync({
        sourceType,
        sourceId,
        hazardId:    hazardId ?? undefined,
        description: description.trim(),
        controlType: controlType as 'elimination' | 'substitution' | 'engineering' | 'administrative' | 'ppe' | 'emergency_response',
        dueAt:       dueAt || undefined,
      });
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save control. Please try again.');
    }
  }

  return (
    <Modal
      open={open}
      title="Add Control"
      icon="fa-shield-halved"
      size="md"
      onClose={handleClose}
      onSubmit={() => void handleSubmit()}
      submitLabel="Save Control"
      submitDisabled={createControl.isPending || !isValid}
    >
      <FormGrid>
        <Field label="Control Description *" wide>
          <TextareaInput
            value={description}
            onInput={setDescription}
            placeholder="Describe the control measure to be implemented…"
            rows={3}
          />
        </Field>

        <Field label="Control Type *">
          <SelectInput
            value={controlType}
            onInput={setControlType}
            options={CONTROL_TYPES.map(c => ({ value: c.value, label: c.label }))}
          />
        </Field>

        <Field label="Due Date">
          <TextInput
            value={dueAt}
            onInput={setDueAt}
            type="date"
          />
        </Field>

        <Field label="Verification Required">
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.83rem', color: 'var(--text-primary)', paddingTop: '6px' }}>
            <input
              type="checkbox"
              checked={verificationRequired}
              onChange={e => setVerificationRequired((e.target as HTMLInputElement).checked)}
              style={{ accentColor: 'var(--siomac-navy)', width: '16px', height: '16px', flexShrink: 0 }}
            />
            Require verification before closure
          </label>
        </Field>

        <Field label="Notes (optional)" wide>
          <TextareaInput
            value={notes}
            onInput={setNotes}
            placeholder="Additional notes or context for this control…"
            rows={2}
          />
        </Field>

        {error && (
          <div class="ui-field ui-field--wide">
            <p style={{
              color: 'var(--color-danger)', fontSize: '0.78rem', margin: 0,
              padding: '8px 12px', borderRadius: 'var(--radius-sm)',
              background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)',
            }}>
              <i class="fas fa-exclamation-triangle" style={{ marginRight: '6px' }} />
              {error}
            </p>
          </div>
        )}
      </FormGrid>
    </Modal>
  );
}
