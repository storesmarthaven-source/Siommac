/**
 * src/components/sections/Messages/AccessThreadDialog.tsx
 *
 * "Access Employee Message Thread" — the controlled, AUDITED entry point for
 * compliance access to a private thread. Shown when the messaging read-gate
 * returns `compliance_required` and the user holds communications.compliance_read.
 *
 * Requires a reason; case reference + notes are optional. On submit it creates a
 * time-boxed access grant (POST /communications/messages/requestThreadAccess),
 * which writes an audit record (who / thread / when / reason / case / duration).
 * There is no silent read — every access passes through here.
 */

import { useState } from 'preact/hooks';
import type { VNode } from 'preact';
import { Modal, Field, TextInput, TextareaInput, SelectInput, FormGrid } from '@ui';
import { useRequestThreadAccess, COMPLIANCE_REASON_OPTIONS, type ComplianceReason } from '@api/communications';

export function AccessThreadDialog({ open, threadId, onClose, onGranted }: {
  open:      boolean;
  threadId:  string;
  onClose:   () => void;
  onGranted: () => void;
}): VNode {
  const [reason,  setReason]  = useState<ComplianceReason | ''>('');
  const [caseRef, setCaseRef] = useState('');
  const [notes,   setNotes]   = useState('');
  const [error,   setError]   = useState('');

  const request = useRequestThreadAccess();

  function reset() {
    setReason(''); setCaseRef(''); setNotes(''); setError('');
  }

  function handleClose() { reset(); onClose(); }

  function handleSubmit() {
    setError('');
    if (!reason) { setError('A reason for access is required.'); return; }
    request.mutate(
      { threadId, reason, caseRef: caseRef.trim() || null, notes: notes.trim() || null },
      {
        onSuccess: (raw: unknown) => {
          const res = raw as { success: boolean; message?: string };
          if (!res.success) { setError(res.message ?? 'Access request failed.'); return; }
          reset();
          onGranted();
          onClose();
        },
        onError: () => setError('Access request failed. Please try again.'),
      },
    );
  }

  return (
    <Modal
      open={open}
      title="Access Employee Message Thread"
      sub="This is a controlled, audited action. Your name, the thread, the time, and your stated reason are recorded."
      icon="fa-user-shield"
      size="md"
      onClose={handleClose}
      onSubmit={handleSubmit}
      submitLabel={request.isPending ? 'Requesting…' : 'Access Thread'}
    >
      <FormGrid>
        <Field label="Reason for access *" wide>
          <SelectInput
            value={reason}
            onInput={v => setReason(v as ComplianceReason)}
            options={[{ value: '', label: 'Select a reason…' }, ...COMPLIANCE_REASON_OPTIONS.map(o => ({ value: o.value, label: o.label }))]}
          />
        </Field>

        <Field label="Case / reference number" wide>
          <TextInput
            value={caseRef}
            onInput={setCaseRef}
            placeholder="e.g. INV-2026-0042 (optional)"
          />
        </Field>

        <Field label="Notes" wide>
          <TextareaInput
            value={notes}
            onInput={setNotes}
            placeholder="Why this access is necessary (optional, but recommended)…"
            rows={3}
          />
        </Field>

        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', alignItems: 'flex-start',
          padding: '10px 12px', borderRadius: '8px',
          background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.35)' }}>
          <i class="fas fa-triangle-exclamation" style={{ color: '#b45309', marginTop: '2px' }} />
          <div style={{ fontSize: '0.76rem', color: 'var(--text)' }}>
            Access is time-boxed and logged to the audit trail. Participants are not notified.
            Misuse of compliance access is itself an audited event.
          </div>
        </div>

        {error && (
          <div style={{ gridColumn: '1 / -1', color: 'var(--color-danger)', fontSize: '0.8rem' }}>
            <i class="fas fa-exclamation-triangle" /> {error}
          </div>
        )}
      </FormGrid>
    </Modal>
  );
}
