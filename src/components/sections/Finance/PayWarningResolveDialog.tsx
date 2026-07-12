/**
 * src/components/sections/Finance/PayWarningResolveDialog.tsx
 *
 * Modal dialog for resolving a payroll run warning.
 * Shows warning details + optional resolution note field.
 * Calls /api/finance/payroll/warnings/resolve and emits backbone side-effects.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { toast } from '@store';
import { HrfinWizardModal, HrfinPill } from '@ui';
import { useResolveWarning, type PayrollRunWarning } from '@api/finance/payroll';

function severityTone(s: string): import('@ui').HrfinTone {
  if (s === 'blocker' || s === 'error') return 'bad';
  if (s === 'warning') return 'wn';
  return 'nu';
}

export function PayWarningResolveDialog({
  warning,
  onClose,
  onResolved,
}: {
  warning:    PayrollRunWarning;
  onClose:    () => void;
  onResolved: () => void;
}): VNode {
  const [note, setNote] = useState('');
  const resolveMut = useResolveWarning();

  async function submit(): Promise<void> {
    try {
      await resolveMut.mutateAsync({ warningId: warning.id, note: note.trim() || undefined });
      toast('Warning resolved.');
      onResolved();
    } catch (e) {
      toast((e as Error).message ?? 'Failed to resolve warning.');
    }
  }

  return (
    <HrfinWizardModal
      open
      title="Resolve Warning"
      stepCount={1}
      activeStep={0}
      onClose={onClose}
      primaryLabel={resolveMut.isPending ? 'Resolving…' : 'Resolve Warning'}
      onPrimary={() => void submit()}
      primaryDisabled={resolveMut.isPending}
      primaryLoading={resolveMut.isPending}
    >
      <div class="hrfin" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <HrfinPill tone={severityTone(warning.severity)}>
            {warning.severity.toUpperCase()}
          </HrfinPill>
          <span style={{ fontWeight: 600, fontSize: 14 }}>
            {warning.warningType.replace(/_/g, ' ')}
          </span>
        </div>

        <p style={{ fontSize: 13, color: 'var(--hrfin-text-secondary)', margin: 0 }}>
          {warning.message}
        </p>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--hrfin-text-secondary)' }}>
            Resolution note <em>(optional)</em>
          </span>
          <textarea
            value={note}
            onInput={e => setNote((e.currentTarget).value)}
            placeholder="Describe how this warning was resolved…"
            maxLength={500}
            rows={4}
            style={{ width: '100%', resize: 'vertical', fontSize: 13, padding: '8px 10px',
                     background: 'var(--hrfin-surface-2)', border: '1px solid var(--hrfin-border)',
                     borderRadius: 6, color: 'var(--hrfin-text-primary)', fontFamily: 'inherit' }}
          />
          <span style={{ fontSize: 11, color: 'var(--hrfin-text-secondary)', alignSelf: 'flex-end' }}>
            {note.length}/500
          </span>
        </label>

        <p style={{ fontSize: 12, color: 'var(--hrfin-text-secondary)', margin: 0 }}>
          Resolving this warning records your decision in the audit log and notifies the
          payroll admin.
        </p>
      </div>
    </HrfinWizardModal>
  );
}
