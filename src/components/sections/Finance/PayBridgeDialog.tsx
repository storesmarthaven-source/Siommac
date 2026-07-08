/**
 * src/components/sections/Finance/PayBridgeDialog.tsx
 *
 * Dialog for creating cross-module bridges from a locked/approved payroll run:
 *   1. Create Disbursement — POST /api/finance/bridges/create-disbursement
 *   2. Create Remittance  — POST /api/finance/bridges/create-remittance (per authority)
 *
 * Both bridges are idempotent: a second call returns `reusedExisting: true`
 * with the existing record rather than creating a duplicate.
 * Wired via the shared bridges hooks from @api/finance/bridges.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { toast } from '@store';
import { HrfinWizardModal, HrfinPill } from '@ui';
import { useCreateDisbursementFromRun, useCreateRemittanceFromRun } from '@api/finance/bridges';
import { AuthorityPicker } from './_shared/pickers';
import { fmtMoney, fmtDate } from './financeShared';
import type { PayrollRun } from '@api/finance/payroll';

// ── Create Disbursement ────────────────────────────────────────────────────────

export function PayCreateDisbursementDialog({
  run,
  onClose,
  onCreated,
}: {
  run:       PayrollRun;
  onClose:   () => void;
  onCreated: (reused: boolean) => void;
}): VNode {
  const createMut = useCreateDisbursementFromRun();

  async function submit(): Promise<void> {
    try {
      const res = await createMut.mutateAsync({ payrollRunId: run.id });
      if (res.reusedExisting) {
        toast('Disbursement already exists — opened existing record.');
      } else {
        toast('Disbursement created from payroll run.');
      }
      onCreated(res.reusedExisting);
    } catch (e) {
      toast((e as Error).message ?? 'Failed to create disbursement.');
    }
  }

  return (
    <HrfinWizardModal
      open
      title="Create Disbursement from Run"
      stepCount={1}
      activeStep={0}
      onClose={onClose}
      primaryLabel={createMut.isPending ? 'Creating…' : 'Create Disbursement'}
      onPrimary={() => void submit()}
      primaryDisabled={createMut.isPending}
      primaryLoading={createMut.isPending}
    >
      <div class="hrfin" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div class="hrfin-metric-list">
          <div class="hrfin-metric-row">
            <span>Run</span><b>{run.runNo}</b>
          </div>
          <div class="hrfin-metric-row">
            <span>Period</span><b>{run.periodMonth.slice(0,7)}</b>
          </div>
          <div class="hrfin-metric-row">
            <span>Net payroll</span><b>{fmtMoney(run.netTotal)}</b>
          </div>
          <div class="hrfin-metric-row">
            <span>Employees</span><b>{run.employeeCount}</b>
          </div>
          <div class="hrfin-metric-row">
            <span>Status</span>
            <HrfinPill tone="ok">{run.status}</HrfinPill>
          </div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--hrfin-text-secondary)', margin: 0 }}>
          Creates a draft disbursement record for this payroll run. The disbursement
          will include all net-pay lines and bank file details. This action is idempotent
          — calling it again returns the existing disbursement.
        </p>
      </div>
    </HrfinWizardModal>
  );
}

// ── Create Remittance ──────────────────────────────────────────────────────────

const AUTHORITIES = [
  { value: 'paye_bir',         label: 'PAYE / BIR' },
  { value: 'nis_nibtt',        label: 'NIS / NIBTT' },
  { value: 'health_surcharge', label: 'Health Surcharge' },
];

export function PayCreateRemittanceDialog({
  run,
  onClose,
  onCreated,
}: {
  run:       PayrollRun;
  onClose:   () => void;
  onCreated: (reused: boolean) => void;
}): VNode {
  const [authority, setAuthority] = useState<string | null>(null);
  const [dueDate,   setDueDate]   = useState('');
  const createMut = useCreateRemittanceFromRun();

  const errors: Record<string, string> = {};
  if (!authority) errors['authority'] = 'Select an authority.';

  async function submit(): Promise<void> {
    if (Object.keys(errors).length) return;
    try {
      const res = await createMut.mutateAsync({
        payrollRunId: run.id,
        authority:    authority as 'paye_bir' | 'nis_nibtt' | 'health_surcharge',
        dueDate:      dueDate || null,
      });
      if (res.reusedExisting) {
        toast('Remittance already exists for this run and authority — opened existing record.');
      } else {
        toast('Remittance created from payroll run.');
      }
      onCreated(res.reusedExisting);
    } catch (e) {
      toast((e as Error).message ?? 'Failed to create remittance.');
    }
  }

  return (
    <HrfinWizardModal
      open
      title="Create Remittance from Run"
      stepCount={1}
      activeStep={0}
      onClose={onClose}
      primaryLabel={createMut.isPending ? 'Creating…' : 'Create Remittance'}
      onPrimary={() => void submit()}
      primaryDisabled={createMut.isPending || !authority}
      primaryLoading={createMut.isPending}
    >
      <div class="hrfin" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div class="hrfin-metric-list">
          <div class="hrfin-metric-row">
            <span>Run</span><b>{run.runNo}</b>
          </div>
          <div class="hrfin-metric-row">
            <span>Period</span><b>{run.periodMonth.slice(0,7)}</b>
          </div>
        </div>

        <AuthorityPicker
          label="Authority *"
          value={authority}
          onChange={setAuthority}
          error={authority === null ? undefined : errors['authority']}
          required
        />

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--hrfin-text-secondary)' }}>
            Due date <em>(optional — defaults to authority schedule)</em>
          </span>
          <input
            type="date"
            value={dueDate}
            onInput={e => setDueDate((e.currentTarget as HTMLInputElement).value)}
            style={{ width: '100%', fontSize: 13, padding: '8px 10px',
                     background: 'var(--hrfin-surface-2)', border: '1px solid var(--hrfin-border)',
                     borderRadius: 6, color: 'var(--hrfin-text-primary)' }}
          />
        </label>

        <p style={{ fontSize: 12, color: 'var(--hrfin-text-secondary)', margin: 0 }}>
          Creates a draft remittance for the selected statutory authority from this payroll run.
          Idempotent — a second call for the same (run, authority) pair returns the existing record.
        </p>
      </div>
    </HrfinWizardModal>
  );
}
