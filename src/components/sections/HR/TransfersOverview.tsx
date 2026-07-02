/**
 * src/components/sections/HR/TransfersOverview.tsx
 *
 * HR ▸ Transfers & Promotions — functional-only page.
 * Submit a bundled dept/site/position/supervisor/role/salary change request;
 * view the register; approve / return / reject / cancel via the existing
 * generic decide + cancel routes (routed by CHANGE_PERM on the backend).
 *
 * No widget board — plain .obx-* tables / @ui components, mirroring
 * OffboardingOverview.tsx house style.
 */
import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { dialog } from '@lib/dialog';
import { can } from '@lib/permissions';
import { PageHeader, Modal, Field, FormGrid, SelectInput, TextInput, EmptyState } from '@ui';
import {
  useTransfers, useTransfersMutation, hrTransfersApi,
} from '@api/hr/transfers';
import { useHrEmployees } from '@api/hr/employees';
import type { TransferRequestRow } from '../../../../types/hrTransfers';
import './onboardingCase.css';

const STATUS_FILTERS = ['all', 'submitted', 'in_review', 'returned', 'applied', 'rejected', 'cancelled'] as const;

const toast = (m: string): void => { void dialog.toast({ title: m }); };
function humanize(s: string): string { return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
function statusTone(s: string): 'green' | 'gray' | 'red' {
  if (s === 'applied')   return 'green';
  if (s === 'rejected' || s === 'cancelled') return 'red';
  return 'gray';
}

export function TransfersOverview(): VNode {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedId, setSelectedId]     = useState<string | null>(null);
  const [newOpen, setNewOpen]           = useState(false);

  const transfersQ = useTransfers(statusFilter === 'all' ? undefined : statusFilter);
  const canRequest = can('hr.transfers.request');

  if (selectedId) return <RequestDetail requestId={selectedId} onBack={() => setSelectedId(null)} rows={transfersQ.data ?? []} />;

  const rows = transfersQ.data ?? [];
  const pending  = rows.filter(r => r.status === 'submitted' || r.status === 'in_review' || r.status === 'returned').length;
  const applied  = rows.filter(r => r.status === 'applied').length;

  return (
    <div class="hr-transfers">
      <PageHeader
        icon="fa-right-left"
        module="HR · Transfers"
        title="Transfers &amp; Promotions"
        sub="Bundled dept / site / position / role / pay changes — submitted, approved &amp; applied via workflow."
        meta={[
          { icon: 'fa-clock',  label: `${pending} pending` },
          { icon: 'fa-check',  label: `${applied} applied` },
        ]}
        actions={canRequest
          ? <button class="obx-btn primary" onClick={() => setNewOpen(true)}>+ New Request</button>
          : undefined}
      />

      <div style={{ display: 'flex', gap: 10, margin: '10px 0' }}>
        <select
          class="ui-select" style={{ width: 180 }}
          value={statusFilter}
          onChange={e => setStatusFilter((e.target as HTMLSelectElement).value)}
        >
          {STATUS_FILTERS.map(f =>
            <option key={f} value={f}>{f === 'all' ? 'All statuses' : humanize(f)}</option>,
          )}
        </select>
      </div>

      <div class="obx-section"><div class="obx-section-body">
        {transfersQ.isLoading && !transfersQ.data
          ? <div class="obx-empty">Loading…</div>
          : !rows.length
            ? <EmptyState icon="fa-right-left" title="No transfer requests" text={canRequest ? 'Submit a transfer or promotion request to get started.' : 'No requests match this filter.'} />
            : (
              <table class="obx-table">
                <thead>
                  <tr>
                    <th>Ref</th>
                    <th>Employee</th>
                    <th>Effective</th>
                    <th>Requested by</th>
                    <th>Changes</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedId(r.id)}>
                      <td><b>{r.changeNo}</b></td>
                      <td>{r.employeeName ?? r.employeeId}</td>
                      <td class="obx-meta">{r.effectiveDate ?? '—'}</td>
                      <td class="obx-meta">{r.requestedByName ?? r.requestedBy}</td>
                      <td class="obx-meta" style={{ fontSize: 12 }}>{summarizeChanges(r)}</td>
                      <td><span class={`obx-pill ${statusTone(r.status)}`}>{humanize(r.status)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
      </div></div>

      {newOpen && (
        <NewRequestModal
          onClose={() => setNewOpen(false)}
          onCreated={id => { setNewOpen(false); setSelectedId(id); }}
        />
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function summarizeChanges(r: TransferRequestRow): string {
  const rv = r.requestedValue as unknown as Record<string, unknown>;
  const parts: string[] = [];
  if ('departmentId'  in rv && rv['departmentId']  != null) parts.push('Dept');
  if ('siteId'        in rv && rv['siteId']        != null) parts.push('Site');
  if ('positionId'    in rv && rv['positionId']    != null) parts.push('Position');
  if ('supervisorId'  in rv && rv['supervisorId']  != null) parts.push('Supervisor');
  if ('role'          in rv && rv['role']          != null) parts.push('Role');
  if ('monthlySalary' in rv && rv['monthlySalary'] != null) parts.push('Salary');
  if ('hourlyRate'    in rv && rv['hourlyRate']    != null) parts.push('Rate');
  return parts.length ? parts.join(', ') : '—';
}

// ── New Request Modal ─────────────────────────────────────────────────────────

function NewRequestModal({
  onClose, onCreated,
}: { onClose: () => void; onCreated: (id: string) => void }): VNode {
  const peopleQ = useHrEmployees({});
  const submitMut = useTransfersMutation(hrTransfersApi.submit);

  const [f, setF] = useState({
    employeeId:    '',
    departmentId:  '',
    siteId:        '',
    positionId:    '',
    supervisorId:  '',
    role:          '',
    monthlySalary: '',
    hourlyRate:    '',
    effectiveDate: '',
    reason:        '',
  });

  const peopleOpts = useMemo(
    () => (peopleQ.data ?? []).map(e => ({ value: e.id, label: e.full_name ?? e.id })),
    [peopleQ.data],
  );

  async function submit(): Promise<void> {
    if (!f.employeeId)    { toast('Select an employee'); return; }
    if (!f.effectiveDate) { toast('Effective date is required'); return; }

    const args: Parameters<typeof hrTransfersApi.submit>[0] = {
      employeeId:    f.employeeId,
      effectiveDate: f.effectiveDate,
      reason:        f.reason || null,
    };
    if (f.departmentId)  args.departmentId  = f.departmentId;
    if (f.siteId)        args.siteId        = f.siteId;
    if (f.positionId)    args.positionId    = f.positionId;
    if (f.supervisorId)  args.supervisorId  = f.supervisorId;
    if (f.role)          args.role          = f.role;
    if (f.monthlySalary) args.monthlySalary = parseFloat(f.monthlySalary);
    if (f.hourlyRate)    args.hourlyRate    = parseFloat(f.hourlyRate);

    const hasChange = f.departmentId || f.siteId || f.positionId || f.supervisorId || f.role || f.monthlySalary || f.hourlyRate;
    if (!hasChange) { toast('Select at least one field to change'); return; }

    try {
      const r = await submitMut.mutateAsync(args);
      toast(`Transfer request submitted (${r.changeNo})`);
      onCreated(r.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to submit request');
    }
  }

  return (
    <Modal
      open title="New Transfer / Promotion Request" icon="fa-right-left"
      onClose={onClose} onSubmit={() => void submit()}
      submitLabel="Submit" submitDisabled={submitMut.isPending}
    >
      <FormGrid>
        <Field label="Employee" wide>
          <SelectInput value={f.employeeId} onInput={v => setF(s => ({ ...s, employeeId: v }))} options={peopleOpts} placeholder="Select employee…" />
        </Field>
        <Field label="Effective date">
          <TextInput type="date" value={f.effectiveDate} onInput={v => setF(s => ({ ...s, effectiveDate: v }))} />
        </Field>
        <Field label="New department">
          <TextInput value={f.departmentId} onInput={v => setF(s => ({ ...s, departmentId: v }))} placeholder="Department ID (leave blank to keep)" />
        </Field>
        <Field label="New site">
          <TextInput value={f.siteId} onInput={v => setF(s => ({ ...s, siteId: v }))} placeholder="Site ID (leave blank to keep)" />
        </Field>
        <Field label="New supervisor">
          <SelectInput value={f.supervisorId} onInput={v => setF(s => ({ ...s, supervisorId: v }))} options={peopleOpts} placeholder="— Unchanged —" />
        </Field>
        <Field label="New role">
          <TextInput value={f.role} onInput={v => setF(s => ({ ...s, role: v }))} placeholder="e.g. manager (leave blank to keep)" />
        </Field>
        <Field label="Monthly salary">
          <TextInput type="number" value={f.monthlySalary} onInput={v => setF(s => ({ ...s, monthlySalary: v }))} placeholder="Leave blank to keep" />
        </Field>
        <Field label="Hourly rate">
          <TextInput type="number" value={f.hourlyRate} onInput={v => setF(s => ({ ...s, hourlyRate: v }))} placeholder="Leave blank to keep" />
        </Field>
        <Field label="Reason" wide>
          <TextInput value={f.reason} onInput={v => setF(s => ({ ...s, reason: v }))} placeholder="Optional context for approvers" />
        </Field>
      </FormGrid>
    </Modal>
  );
}

// ── Request Detail ─────────────────────────────────────────────────────────────

function RequestDetail({
  requestId, onBack, rows,
}: { requestId: string; onBack: () => void; rows: TransferRequestRow[] }): VNode {
  const req = rows.find(r => r.id === requestId);
  const canApprove = can('hr.transfers.approve');
  const canCancel  = can('hr.transfers.cancel');

  const decideMut = useTransfersMutation(hrTransfersApi.decide);
  const cancelMut = useTransfersMutation(hrTransfersApi.cancel);

  async function decide(decision: 'approve' | 'reject' | 'return'): Promise<void> {
    if (!req) return;
    let comment: string | null = null;
    if (decision !== 'approve') {
      const r = await dialog.prompt({ title: `Reason for ${decision}ing this request?` });
      if (r === null) return;
      comment = r || undefined as unknown as string;
    }
    try {
      const r = await decideMut.mutateAsync({ requestId: req.id, decision, comment: comment ?? undefined });
      toast(`Request ${humanize(r.status)}`);
      onBack();
    } catch (e) { toast(e instanceof Error ? e.message : 'Action failed'); }
  }

  async function onCancel(): Promise<void> {
    if (!req) return;
    if (!await dialog.confirm({ title: 'Cancel this request?', text: 'The transfer/promotion request will be cancelled.' })) return;
    try {
      await cancelMut.mutateAsync({ requestId: req.id });
      toast('Request cancelled');
      onBack();
    } catch (e) { toast(e instanceof Error ? e.message : 'Cancel failed'); }
  }

  if (!req) return (
    <div class="hr-transfers">
      <button class="obx-back" onClick={onBack}>← Transfers</button>
      <div class="obx-empty">Request not found.</div>
    </div>
  );

  const rv = req.requestedValue as unknown as Record<string, unknown>;
  const pv = req.previousValue as unknown as Record<string, unknown>;
  const terminal = req.status === 'applied' || req.status === 'rejected' || req.status === 'cancelled';

  return (
    <div class="hr-transfers">
      <button class="obx-back" onClick={onBack}>← Transfers</button>
      <PageHeader
        icon="fa-right-left"
        module="HR · Transfers"
        title={`${req.changeNo} · ${req.employeeName ?? '—'}`}
        sub={`${humanize(req.status)}${req.effectiveDate ? ` · effective ${req.effectiveDate}` : ''}`}
        actions={!terminal ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {canApprove && (
              <>
                <button class="obx-mini" onClick={() => void decide('approve')}>Approve</button>
                <button class="obx-mini" onClick={() => void decide('return')}>Return</button>
                <button class="obx-mini danger" onClick={() => void decide('reject')}>Reject</button>
              </>
            )}
            {canCancel && (
              <button class="obx-mini" onClick={() => void onCancel()}>Cancel</button>
            )}
          </div>
        ) : undefined}
      />

      {/* Change summary */}
      <div class="obx-section">
        <div class="obx-section-head">Change Details</div>
        <div class="obx-section-body">
          <table class="obx-table">
            <thead><tr><th>Field</th><th>Before</th><th>After (requested)</th></tr></thead>
            <tbody>
              {FIELD_LABELS.filter(([key]) => key in rv).map(([key, label]) => (
                <tr key={key}>
                  <td class="obx-meta">{label}</td>
                  <td class="obx-meta">{String(pv[key] ?? '—')}</td>
                  <td>{String(rv[key] ?? '—')}</td>
                </tr>
              ))}
              <tr>
                <td class="obx-meta">Effective date</td>
                <td class="obx-meta">—</td>
                <td>{req.effectiveDate ?? '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Metadata */}
      <div class="obx-section">
        <div class="obx-section-head">Request Info</div>
        <div class="obx-section-body">
          <table class="obx-table">
            <tbody>
              <tr><td class="obx-meta">Requested by</td><td>{req.requestedByName ?? req.requestedBy}</td></tr>
              <tr><td class="obx-meta">Submitted</td><td>{req.requestedAt}</td></tr>
              {req.reason && <tr><td class="obx-meta">Reason</td><td>{req.reason}</td></tr>}
              {req.decidedAt && <tr><td class="obx-meta">Decided</td><td>{req.decidedAt}</td></tr>}
              {req.appliedAt && <tr><td class="obx-meta">Applied</td><td>{req.appliedAt}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const FIELD_LABELS: [string, string][] = [
  ['departmentId',  'Department'],
  ['siteId',        'Site'],
  ['positionId',    'Position'],
  ['supervisorId',  'Supervisor'],
  ['role',          'Role'],
  ['monthlySalary', 'Monthly Salary'],
  ['hourlyRate',    'Hourly Rate'],
];
