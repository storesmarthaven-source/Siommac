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
import { toast } from '@store';
import { can } from '@lib/permissions';
import { PageHeader, Field, FormGrid, SelectInput, TextInput, EmptyState } from '@ui';
import {
  useTransfers, useTransfersMutation, hrTransfersApi,
} from '@api/hr/transfers';
import { useHrEmployees } from '@api/hr/employees';
import type { TransferRequestRow } from '../../../../types/hrTransfers';
import { openActionModal, toActionRecord, statusBadge } from '@/components/common/actions';
import { EnterpriseFormModal, type DialogContextPanelConfig } from '@/components/common/dialogs';
import './onboardingCase.css';

const STATUS_FILTERS = ['all', 'submitted', 'in_review', 'returned', 'applied', 'rejected', 'cancelled'] as const;

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
  if ('departmentId'  in rv && rv.departmentId  != null) parts.push('Dept');
  if ('siteId'        in rv && rv.siteId        != null) parts.push('Site');
  if ('positionId'    in rv && rv.positionId    != null) parts.push('Position');
  if ('supervisorId'  in rv && rv.supervisorId  != null) parts.push('Supervisor');
  if ('role'          in rv && rv.role          != null) parts.push('Role');
  if ('monthlySalary' in rv && rv.monthlySalary != null) parts.push('Salary');
  if ('hourlyRate'    in rv && rv.hourlyRate    != null) parts.push('Rate');
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

  const empName = peopleOpts.find(o => o.value === f.employeeId)?.label;
  const changes: { label: string; value: string }[] = [];
  if (f.departmentId)  changes.push({ label: 'Department', value: f.departmentId });
  if (f.siteId)        changes.push({ label: 'Site', value: f.siteId });
  if (f.positionId)    changes.push({ label: 'Position', value: f.positionId });
  if (f.supervisorId)  changes.push({ label: 'Supervisor', value: peopleOpts.find(o => o.value === f.supervisorId)?.label ?? f.supervisorId });
  if (f.role)          changes.push({ label: 'Role', value: f.role });
  if (f.monthlySalary) changes.push({ label: 'Monthly salary', value: f.monthlySalary });
  if (f.hourlyRate)    changes.push({ label: 'Hourly rate', value: f.hourlyRate });
  const noChange = changes.length === 0;
  const context: DialogContextPanelConfig = {
    eyebrow: 'HR · Transfers', title: 'Change Preview', description: 'Review the requested change before submitting for approval.',
    preview: {
      icon: 'TR', title: empName ?? 'Select employee', subtitle: f.effectiveDate ? `Effective ${f.effectiveDate}` : 'Set effective date',
      badges: [{ label: 'Maker-checker', tone: 'warning' }],
    },
    metrics: [{ label: 'Fields changing', value: changes.length, tone: changes.length ? 'info' : 'muted' }],
    derived: changes.length ? { title: 'Requested changes', fields: changes } : undefined,
    validation: [
      ...(!f.employeeId ? [{ message: 'Select an employee.', tone: 'danger' as const }] : []),
      ...(!f.effectiveDate ? [{ message: 'Effective date is required.', tone: 'danger' as const }] : []),
      ...(noChange && f.employeeId ? [{ message: 'Select at least one field to change.', tone: 'warning' as const }] : []),
    ],
    approval: { required: true, risk: 'medium', message: 'Submitted as a maker-checker request — you cannot approve your own request.' },
    whatNext: [
      { label: 'Routes for approval', description: 'An approver (not the creator) reviews the change.' },
      { label: 'Applied on approval', description: 'The change is written to the employee record + status history.' },
    ],
  };

  return (
    <EnterpriseFormModal open
      title="New Transfer / Promotion Request"
      subtitle="Request a dept / site / role / pay change — routed through maker-checker approval."
      icon={<i class="fas fa-right-left" />}
      context={context}
      primaryLabel="Submit Request"
      loading={submitMut.isPending}
      disabled={!f.employeeId || !f.effectiveDate || noChange}
      onCancel={onClose}
      onSubmit={() => void submit()}>
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
    </EnterpriseFormModal>
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

  const transferRecord = (r: TransferRequestRow) => toActionRecord({
    title: `${r.changeNo} · ${r.employeeName ?? '—'}`, subtitle: r.effectiveDate ? `Effective ${r.effectiveDate}` : undefined, icon: 'fa-right-left',
    badges: [statusBadge(r.status)],
    fields: [
      { label: 'Change', value: summarizeChanges(r) },
      r.requestedByName ? { label: 'Requested by', value: r.requestedByName } : null,
    ],
  });
  async function decide(decision: 'approve' | 'reject' | 'return'): Promise<void> {
    if (!req) return;
    const isApprove = decision === 'approve';
    const res = await openActionModal({
      title: isApprove ? 'Approve request' : decision === 'reject' ? 'Reject request' : 'Return request',
      icon: isApprove ? 'fa-check' : decision === 'reject' ? 'fa-ban' : 'fa-rotate-left',
      tone: isApprove ? 'success' : decision === 'reject' ? 'danger' : 'warning',
      record: transferRecord(req),
      warning: isApprove ? 'You cannot approve a request you created (separation of duties).' : undefined,
      reason: isApprove ? undefined : { required: true, label: decision === 'reject' ? 'Reason for rejection' : 'Reason for returning', type: 'textarea', placeholder: 'Explain…' },
      whatNext: isApprove ? ['The change is approved and applied to the employee record.'] : decision === 'reject' ? ['The request is rejected; no change is applied.'] : ['The request is returned to the requester for edits.'],
      confirmLabel: isApprove ? 'Approve' : decision === 'reject' ? 'Reject' : 'Return',
    });
    if (!res.confirmed) return;
    try {
      const out = await decideMut.mutateAsync({ requestId: req.id, decision, comment: res.reason ?? undefined });
      toast(`Request ${humanize(out.status)}`);
      onBack();
    } catch (e) { toast(e instanceof Error ? e.message : 'Action failed'); }
  }

  async function onCancel(): Promise<void> {
    if (!req) return;
    const res = await openActionModal({
      title: 'Cancel request', icon: 'fa-xmark', tone: 'danger', record: transferRecord(req),
      warning: 'The transfer/promotion request will be cancelled. This cannot be undone.',
      whatNext: ['Status → cancelled; no change is applied.'],
      confirmLabel: 'Cancel request',
    });
    if (!res.confirmed) return;
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
                  <td class="obx-meta">{String((pv[key] ?? '—') as string | number | boolean)}</td>
                  <td>{String((rv[key] ?? '—') as string | number | boolean)}</td>
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
