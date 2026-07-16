/**
 * src/components/sections/HR/LeaveOverview.tsx
 *
 * HR Leave and Absence management page.
 * Stats row + requests table (status/type filter) + submit modal.
 * Approve / Reject / Cancel inline. Gated by hr.leave.* permissions.
 */
import { type VNode } from 'preact';
import { useState, useMemo, useRef } from 'preact/hooks';
import { openActionModal, toActionRecord, statusBadge } from '@/components/common/actions';
import { EnterpriseFormModal, type DialogContextPanelConfig } from '@/components/common/dialogs';
import { toast } from '@store';
import { can } from '@lib/permissions';
import { useSessionStore } from '@store/session';
import { PageHeader, Field, FormGrid, SelectInput, TextInput, EmptyState } from '@ui';
import {
  useMyLeaveRequests, useAllLeaveRequests, useLeaveTypes, useLeaveStats, useLeaveBalances,
  useSubmitLeave, useApproveLeave, useRejectLeave, useCancelLeave,
} from '@api/hr/leave';
import type { LeaveRequest, LeaveStatus, LeaveListArgs } from '../../../../types/hrLeave';
import './onboardingCase.css';

const STATUS_OPTIONS: { v: LeaveStatus | 'all'; label: string }[] = [
  { v: 'all', label: 'All statuses' },
  { v: 'pending_approval', label: 'Pending' },
  { v: 'approved', label: 'Approved' },
  { v: 'rejected', label: 'Rejected' },
  { v: 'cancelled', label: 'Cancelled' },
];

function statusTone(s: LeaveStatus): 'green' | 'orange' | 'red' | 'gray' {
  if (s === 'approved')         return 'green';
  if (s === 'pending_approval') return 'orange';
  if (s === 'rejected')         return 'red';
  return 'gray';
}

function humanize(str: string): string {
  return str.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}


// -- Submit Leave Dialog
interface SubmitDialogProps { onClose: () => void; }

/** Working days (Mon–Fri) inclusive between two ISO dates; 0 if invalid/reversed. */
function workingDays(from: string, to: string): number {
  if (!from || !to) return 0;
  const a = new Date(from), b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 0;
  let n = 0; const d = new Date(a);
  while (d <= b) { const wd = d.getDay(); if (wd !== 0 && wd !== 6) n++; d.setDate(d.getDate() + 1); }
  return n;
}

function SubmitLeaveDialog({ onClose }: SubmitDialogProps): VNode {
  const myId    = useSessionStore(s => s.userId ?? '');
  const typesQ  = useLeaveTypes();
  const balQ    = useLeaveBalances(myId || undefined);
  const myReqQ  = useMyLeaveRequests();
  const submit  = useSubmitLeave();
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [fromDate,    setFromDate]    = useState('');
  const [toDate,      setToDate]      = useState('');
  const [reason,      setReason]      = useState('');
  // Stable per-attempt idempotency key — reused on retry, regenerated after success.
  const submitKeyRef = useRef<string | null>(null);
  const types = typesQ.data ?? [];

  const days      = workingDays(fromDate, toDate);
  const typeLabel = types.find(t => t.id === leaveTypeId)?.label ?? 'Leave';
  const bal       = (balQ.data ?? []).find(b => b.leaveTypeId === leaveTypeId);
  const dateError = !!(fromDate && toDate && toDate < fromDate);
  const exceeds   = !!(bal && days > bal.available);
  const overlaps  = (myReqQ.data?.rows ?? []).filter(r =>
    (r.status === 'pending_approval' || r.status === 'approved') && !!fromDate && !!toDate && r.fromDate <= toDate && r.toDate >= fromDate);
  const canSubmitForm = !!(leaveTypeId && fromDate && toDate) && !dateError;

  async function handleSubmit() {
    if (!canSubmitForm) return;
    if (!submitKeyRef.current) submitKeyRef.current = crypto.randomUUID();
    try {
      await submit.mutateAsync({
        employeeId: myId, leaveTypeId, fromDate, toDate, reason: reason || null,
        idempotencyKey: submitKeyRef.current,
      });
      submitKeyRef.current = null;
      toast('Leave request submitted.');
      onClose();
    } catch (e) { toast((e as Error).message); }
  }

  const context: DialogContextPanelConfig = {
    eyebrow: 'HR · Leave', title: 'Leave Preview', description: 'Preview balance impact and conflicts before submitting.',
    preview: {
      icon: 'LV', title: typeLabel, subtitle: fromDate && toDate ? `${fromDate} → ${toDate}` : 'Select dates',
      meta: [{ label: 'Working days', value: days || '—' }],
    },
    metrics: bal ? [
      { label: 'Requested', value: days, tone: 'info' },
      { label: 'Available', value: bal.available, tone: bal.available > 0 ? 'success' : 'warning' },
      { label: 'After', value: bal.available - days, tone: bal.available - days < 0 ? 'danger' : 'muted' },
    ] : [{ label: 'Requested', value: days, tone: 'info' }],
    validation: [
      ...(dateError ? [{ message: 'End date is before the start date.', tone: 'danger' as const }] : []),
      ...(exceeds ? [{ message: `Requested ${days} day(s) exceeds your available ${bal.available}.`, tone: 'warning' as const }] : []),
      ...(overlaps.length ? [{ message: `Overlaps ${overlaps.length} existing request(s) in this range.`, tone: 'warning' as const }] : []),
    ],
    approval: { required: true, risk: 'low', message: 'Submitting sends this to your manager / HR for approval.' },
    whatNext: [
      { label: 'Reserved from balance', description: 'The requested days are held as pending while awaiting approval.' },
      { label: 'Approval routing', description: 'Your manager or HR reviews and approves or rejects.' },
    ],
  };

  return (
    <EnterpriseFormModal open
      title='Submit Leave Request'
      subtitle='Request leave — the panel previews your balance and any conflicts.'
      icon={<i class='fas fa-calendar-plus' />}
      context={context}
      primaryLabel='Submit Request'
      loading={submit.isPending}
      disabled={!canSubmitForm}
      onCancel={onClose}
      onSubmit={() => void handleSubmit()}>
      <FormGrid>
        <Field label='Leave Type' wide>
          <SelectInput value={leaveTypeId} onInput={setLeaveTypeId}
            options={[{ value: '', label: 'Select type…' }, ...types.map(t => ({ value: t.id, label: t.label }))]} />
        </Field>
        <Field label='From Date'><TextInput type='date' value={fromDate} onInput={setFromDate} /></Field>
        <Field label='To Date'><TextInput type='date' value={toDate} onInput={setToDate} /></Field>
        <Field label='Reason (optional)' wide><TextInput value={reason} onInput={setReason} placeholder='Optional reason…' /></Field>
      </FormGrid>
    </EnterpriseFormModal>
  );
}

// -- Review Dialog
// -- Main Component
export function LeaveOverview(): VNode {
  const [statusFilter, setStatusFilter] = useState<LeaveStatus | 'all'>('all');
  const [submitOpen,   setSubmitOpen]   = useState(false);
  const cancelMut  = useCancelLeave();
  const approveMut = useApproveLeave();
  const rejectMut  = useRejectLeave();

  const leaveRecord = (row: LeaveRequest) => toActionRecord({
    title: `${row.caseNo} · ${row.leaveType?.label ?? row.leaveTypeId}`,
    subtitle: isAdmin ? (row.employeeName ?? row.employeeId) : undefined, icon: 'fa-calendar-minus',
    badges: [statusBadge(row.status)],
    fields: [{ label: 'Dates', value: `${row.fromDate} → ${row.toDate}` }, { label: 'Days', value: row.days ?? '—' }],
  });
  async function onReview(row: LeaveRequest, action: 'approve' | 'reject'): Promise<void> {
    const res = await openActionModal({
      title: action === 'approve' ? 'Approve leave' : 'Reject leave',
      icon: action === 'approve' ? 'fa-calendar-check' : 'fa-ban',
      tone: action === 'approve' ? 'success' : 'danger',
      record: leaveRecord(row),
      reason: { required: action === 'reject', label: action === 'approve' ? 'Notes (optional)' : 'Reason for rejection', type: 'textarea', placeholder: 'Add review notes…' },
      whatNext: action === 'approve' ? ['The leave is approved; the reserved balance is confirmed.'] : ['The leave is rejected; the reserved balance is released.'],
      confirmLabel: action === 'approve' ? 'Approve' : 'Reject',
    });
    if (!res.confirmed) return;
    try {
      if (action === 'approve') { await approveMut.mutateAsync({ requestId: row.id, reviewNotes: res.reason ?? null }); toast('Leave request approved.'); }
      else { await rejectMut.mutateAsync({ requestId: row.id, reviewNotes: res.reason ?? '' }); toast('Leave request rejected.'); }
    } catch (e) { toast((e as Error).message); }
  }

  const isAdmin    = can('hr.leave.view_all');
  const canApprove = can('hr.leave.approve');
  const canSubmit  = can('hr.leave.submit');

  const listArgs: LeaveListArgs = useMemo(() => ({
    statuses: statusFilter === 'all' ? undefined : [statusFilter],
    pageSize: 50,
  }), [statusFilter]);

  const myQ    = useMyLeaveRequests(isAdmin ? undefined : listArgs);
  const allQ   = useAllLeaveRequests(isAdmin ? listArgs : undefined);
  const statsQ = useLeaveStats();

  const rows: LeaveRequest[] = isAdmin ? (allQ.data?.rows ?? []) : (myQ.data?.rows ?? []);
  const isLoading = isAdmin ? (allQ.isLoading && !allQ.data) : (myQ.isLoading && !myQ.data);
  const stats = statsQ.data;

  const statCells: [string, number][] = isAdmin ? [
    ['My Pending', stats?.myPending ?? 0],
    ['Pending Approvals', stats?.pendingApprovals ?? 0],
    ['Team Pending', stats?.teamPending ?? 0],
    ['My Days (yr)', stats?.totalDaysThisYear ?? 0],
  ] : [
    ['Pending', stats?.myPending ?? 0],
    ['Approved', stats?.myApproved ?? 0],
    ['Days taken (yr)', stats?.totalDaysThisYear ?? 0],
  ];

  async function handleCancel(row: LeaveRequest) {
    const res = await openActionModal({
      title: 'Cancel leave request', icon: 'fa-calendar-xmark', tone: 'danger', record: leaveRecord(row),
      warning: 'This will release the reserved balance.',
      reason: { required: true, label: 'Reason for cancelling', type: 'textarea', placeholder: 'Why is this being cancelled?' },
      whatNext: ['Status → cancelled; the reserved balance is released.'],
      confirmLabel: 'Cancel request',
    });
    if (!res.confirmed) return;
    try {
      await cancelMut.mutateAsync({ requestId: row.id, reason: res.reason ?? null });
      toast('Leave request cancelled.');
    } catch (e) { toast((e as Error).message); }
  }
  return (
    <div class='hr-leave'>
      <PageHeader
        icon='fa-calendar-minus' module='HR · Leave' title='Leave & Absence'
        sub='Submit, track and approve employee leave requests.'
        actions={canSubmit ? (
          <button class='obx-btn primary' onClick={() => setSubmitOpen(true)}>
            + Request Leave
          </button>
        ) : undefined}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '14px 0' }}>
        {statCells.map(([label, val]) => (
          <div key={label} style={{ flex: '1 1 140px', border: '1px solid var(--border,#e2e8f0)', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 22, fontWeight: 500 }}>{val}</div>
            <div class='obx-meta' style={{ fontSize: 12 }}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, margin: '10px 0' }}>
        <select class='ui-select' style={{ width: 200 }}
          value={statusFilter}
          onChange={e => setStatusFilter((e.target as HTMLSelectElement).value as never)}
        >
          {STATUS_OPTIONS.map(opt => <option key={opt.v} value={opt.v}>{opt.label}</option>)}
        </select>
      </div>

      <div class='obx-section'><div class='obx-section-body'>
        {isLoading ? (
          <div class='obx-empty'>Loading…</div>
        ) : !rows.length ? (
          <EmptyState icon='fa-calendar' title='No leave requests'
            text={canSubmit ? 'Submit a leave request to get started.' : 'No leave requests found.'} />
        ) : (
          <table class='obx-table'>
            <thead><tr>
              <th>Case</th>
              {isAdmin && <th>Employee</th>}
              <th>Type</th><th>From</th><th>To</th>
              <th style={{ textAlign: 'center' }}>Days</th>
              <th>Status</th><th>Actions</th>
            </tr></thead>
            <tbody>{rows.map(row => {
              const tone = statusTone(row.status);
              return (
                <tr key={row.id}>
                  <td><b>{row.caseNo}</b></td>
                  {isAdmin && <td>{row.employeeName ?? row.employeeId}</td>}
                  <td>{row.leaveType?.label ?? row.leaveTypeId}</td>
                  <td>{row.fromDate}</td><td>{row.toDate}</td>
                  <td style={{ textAlign: 'center' }}>{row.days ?? '—'}</td>
                  <td><span class={'obx-pill ' + tone}>{humanize(row.status)}</span></td>
                  <td>
                    {canApprove && row.status === 'pending_approval' && (
                      <span style={{ display: 'inline-flex', gap: 4 }}>
                        <button class='obx-btn small' onClick={() => { void onReview(row, 'approve'); }}>Approve</button>
                        <button class='obx-btn small danger' onClick={() => { void onReview(row, 'reject'); }}>Reject</button>
                      </span>
                    )}
                    {(['pending_approval', 'approved'] as LeaveStatus[]).includes(row.status) && (
                      <button class='obx-btn small' onClick={() => { void handleCancel(row); }}>Cancel</button>
                    )}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div></div>

      {submitOpen && <SubmitLeaveDialog onClose={() => setSubmitOpen(false)} />}
    </div>
  );
}
