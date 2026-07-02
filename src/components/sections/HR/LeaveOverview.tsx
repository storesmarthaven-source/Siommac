/**
 * src/components/sections/HR/LeaveOverview.tsx
 *
 * HR Leave and Absence management page.
 * Stats row + requests table (status/type filter) + submit modal.
 * Approve / Reject / Cancel inline. Gated by hr.leave.* permissions.
 */
import { type VNode } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import { dialog } from '@lib/dialog';
import { can } from '@lib/permissions';
import { useSessionStore } from '@store/session';
import { PageHeader, Modal, Field, SelectInput, TextInput, EmptyState } from '@ui';
import {
  useMyLeaveRequests, useAllLeaveRequests, useLeaveTypes, useLeaveStats,
  useSubmitLeave, useApproveLeave, useRejectLeave, useCancelLeave,
} from '@api/hr/leave';
import type { LeaveRequest, LeaveStatus, LeaveListArgs } from '../../../../types/hrLeave';
import './onboardingCase.css';

const STATUS_OPTIONS: Array<{ v: LeaveStatus | 'all'; label: string }> = [
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
  return str.replace(/_/g, ' ').replace(/\w/g, c => c.toUpperCase());
}

const toast = (m: string): void => { void dialog.toast({ title: m }); };

// -- Submit Leave Dialog
interface SubmitDialogProps { onClose: () => void; }

function SubmitLeaveDialog({ onClose }: SubmitDialogProps): VNode {
  const myId   = useSessionStore(s => s.userId ?? '');
  const typesQ = useLeaveTypes();
  const submit = useSubmitLeave();
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [fromDate,    setFromDate]    = useState('');
  const [toDate,      setToDate]      = useState('');
  const [reason,      setReason]      = useState('');
  const types = typesQ.data ?? [];
  const canSubmitForm = leaveTypeId && fromDate && toDate;
  async function handleSubmit() {
    if (!canSubmitForm) return;
    try {
      await submit.mutateAsync({ employeeId: myId, leaveTypeId, fromDate, toDate, reason: reason || null });
      toast('Leave request submitted.');
      onClose();
    } catch (e) { toast((e as Error).message); }
  }

  return (
    <Modal open title='Submit Leave Request' onClose={onClose}
      footer={(
        <>
          <button class='obx-btn' onClick={onClose}>Cancel</button>
          <button class='obx-btn primary' disabled={!canSubmitForm || submit.isPending} onClick={handleSubmit}>
            {submit.isPending ? 'Submitting…' : 'Submit Request'}
          </button>
        </>
      )}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label='Leave Type'>
            <SelectInput value={leaveTypeId} onInput={setLeaveTypeId}
              options={[{ value: '', label: 'Select type…' }, ...types.map(t => ({ value: t.id, label: t.label }))]}
            />
          </Field>
        </div>
        <Field label='From Date'>
          <TextInput type='date' value={fromDate} onInput={setFromDate} />
        </Field>
        <Field label='To Date'>
          <TextInput type='date' value={toDate} onInput={setToDate} />
        </Field>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label='Reason (optional)'>
            <TextInput value={reason} onInput={setReason} placeholder='Optional reason…' />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

// -- Review Dialog
interface ReviewDialogProps { requestId: string; action: 'approve' | 'reject'; onClose: () => void; }

function ReviewDialog({ requestId, action, onClose }: ReviewDialogProps): VNode {
  const [notes, setNotes] = useState('');
  const approve = useApproveLeave();
  const reject  = useRejectLeave();
  const busy    = approve.isPending || reject.isPending;

  async function handleConfirm() {
    try {
      if (action === 'approve') {
        await approve.mutateAsync({ requestId, reviewNotes: notes || null });
        toast('Leave request approved.');
      } else {
        if (!notes.trim()) { toast('Review notes are required for rejection.'); return; }
        await reject.mutateAsync({ requestId, reviewNotes: notes });
        toast('Leave request rejected.');
      }
      onClose();
    } catch (e) { toast((e as Error).message); }
  }
  return (
    <Modal open title={action === 'approve' ? 'Approve Leave' : 'Reject Leave'} onClose={onClose}
      footer={(
        <>
          <button class='obx-btn' onClick={onClose}>Cancel</button>
          <button class={'obx-btn ' + (action === 'reject' ? 'danger' : 'primary')} disabled={busy} onClick={handleConfirm}>
            {busy ? 'Saving…' : action === 'approve' ? 'Approve' : 'Reject'}
          </button>
        </>
      )}
    >
      <Field label={action === 'approve' ? 'Notes (optional)' : 'Reason for rejection (required)'}>
        <TextInput value={notes} onInput={setNotes} placeholder='Add review notes…' />
      </Field>
    </Modal>
  );
}

// -- Main Component
export function LeaveOverview(): VNode {
  const [statusFilter, setStatusFilter] = useState<LeaveStatus | 'all'>('all');
  const [submitOpen,   setSubmitOpen]   = useState(false);
  const [reviewTarget, setReviewTarget] = useState<{ id: string; action: 'approve' | 'reject' } | null>(null);
  const cancelMut = useCancelLeave();

  const isAdmin    = can('hr.leave.view_all');
  const canApprove = can('hr.leave.approve');
  const canSubmit  = can('hr.leave.submit');

  const listArgs: LeaveListArgs = useMemo(() => ({
    statuses: statusFilter === 'all' ? undefined : [statusFilter as LeaveStatus],
    pageSize: 50,
  }), [statusFilter]);

  const myQ    = useMyLeaveRequests(isAdmin ? undefined : listArgs);
  const allQ   = useAllLeaveRequests(isAdmin ? listArgs : undefined);
  const statsQ = useLeaveStats();

  const rows: LeaveRequest[] = isAdmin ? (allQ.data?.rows ?? []) : (myQ.data?.rows ?? []);
  const isLoading = isAdmin ? (allQ.isLoading && !allQ.data) : (myQ.isLoading && !myQ.data);
  const stats = statsQ.data;

  const statCells: Array<[string, number]> = isAdmin ? [
    ['My Pending', stats?.myPending ?? 0],
    ['Pending Approvals', stats?.pendingApprovals ?? 0],
    ['Team Pending', stats?.teamPending ?? 0],
    ['My Days (yr)', stats?.totalDaysThisYear ?? 0],
  ] : [
    ['Pending', stats?.myPending ?? 0],
    ['Approved', stats?.myApproved ?? 0],
    ['Days taken (yr)', stats?.totalDaysThisYear ?? 0],
  ];

  async function handleCancel(requestId: string) {
    const confirmed = await dialog.confirm({
      title: 'Cancel leave request?',
      text:  'This will release the reserved balance.',
    });
    if (!confirmed) return;
    try {
      await cancelMut.mutateAsync({ requestId });
      toast('Leave request cancelled.');
    } catch (e) { toast((e as Error).message); }
  }
  return (
    <div class='hr-leave'>
      <PageHeader
        icon='fa-calendar-minus' module='HR · Leave' title='Leave & Absence'
        sub='Submit, track and approve employee leave requests.'
        meta={[{ icon: 'fa-list', label: rows.length + ' requests' }]}
        actions={canSubmit ? (
          <button class='obx-btn primary' onClick={() => setSubmitOpen(true)}>
            + Request Leave
          </button>
        ) : undefined}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '14px 0' }}>
        {statCells.map(([label, val]) => (
          <div key={label} style={{ flex: '1 1 140px', border: '1px solid var(--border,#e2e8f0)', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{val}</div>
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
                        <button class='obx-btn small' onClick={() => setReviewTarget({ id: row.id, action: 'approve' })}>Approve</button>
                        <button class='obx-btn small danger' onClick={() => setReviewTarget({ id: row.id, action: 'reject' })}>Reject</button>
                      </span>
                    )}
                    {(['pending_approval', 'approved'] as LeaveStatus[]).includes(row.status) && (
                      <button class='obx-btn small' onClick={() => { void handleCancel(row.id); }}>Cancel</button>
                    )}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div></div>

      {submitOpen && <SubmitLeaveDialog onClose={() => setSubmitOpen(false)} />}
      {reviewTarget && (
        <ReviewDialog requestId={reviewTarget.id} action={reviewTarget.action}
          onClose={() => setReviewTarget(null)} />
      )}
    </div>
  );
}
