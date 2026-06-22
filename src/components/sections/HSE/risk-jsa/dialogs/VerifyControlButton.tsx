/**
 * src/components/sections/HSE/risk-jsa/dialogs/VerifyControlButton.tsx
 *
 * Inline "Verify" action for a control row in a drawer's Controls tab. Opens a
 * small modal to record an effectiveness rating; submits via useVerifyControl.
 * Renders nothing once the control is already verified / ineffective.
 */

import { useState } from 'preact/hooks';
import { type VNode } from 'preact';
import { Modal, FormGrid, Field, SelectInput, TextareaInput } from '@ui';
import { useVerifyControl } from '@api/hse/riskJsa';

const EFFECTIVENESS = [
  { value: 'effective',           label: 'Effective' },
  { value: 'partially_effective', label: 'Partially effective' },
  { value: 'ineffective',         label: 'Ineffective' },
];

export function VerifyControlButton({ controlId, status, label }: {
  controlId: string;
  status: string;
  label: string;
}): VNode | null {
  const [open,          setOpen]          = useState(false);
  const [effectiveness, setEffectiveness] = useState('effective');
  const [note,          setNote]          = useState('');
  const verify = useVerifyControl();

  // Already-verified or superseded controls have nothing to verify.
  if (['verified', 'ineffective', 'superseded'].includes(status)) return null;

  async function handleSubmit() {
    try {
      await verify.mutateAsync({
        controlId,
        effectiveness: effectiveness as 'effective' | 'partially_effective' | 'ineffective',
        note: note || undefined,
      });
      setOpen(false); setNote('');
    } catch { /* surfaced by mutation state */ }
  }

  return (
    <>
      <button class="hse-btn" style={{ padding: '3px 10px', fontSize: '0.72rem' }} onClick={() => setOpen(true)}>
        <i class="fas fa-circle-check" /> Verify
      </button>
      <Modal open={open} title="Verify Control" icon="fa-circle-check" size="sm"
        onClose={() => setOpen(false)} onSubmit={() => void handleSubmit()}
        submitLabel="Record Verification" submitDisabled={verify.isPending}>
        <FormGrid>
          <Field label="Control" wide>
            <p style={{ margin: 0, fontSize: '0.83rem' }}>{label}</p>
          </Field>
          <Field label="Effectiveness *">
            <SelectInput value={effectiveness} onInput={setEffectiveness} options={EFFECTIVENESS} />
          </Field>
          <Field label="Verification note (optional)" wide>
            <TextareaInput value={note} onInput={setNote} rows={2}
              placeholder="Evidence checked, residual risk confirmed…" />
          </Field>
        </FormGrid>
      </Modal>
    </>
  );
}
