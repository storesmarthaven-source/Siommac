/**
 * LeaveSection.tsx
 *
 * Leave management for all roles:
 *   - Employee: view own leaves, submit/edit/delete pending requests
 *   - Manager:  view department leaves, approve/reject pending requests
 *   - Admin:    view all leaves, approve/reject any, filter by type/search
 *
 * Replaces: loadLeaveRequests, loadManagerLeaveApplications, loadAdminLeaves,
 *           submitLeaveRequest, approveLeave, rejectLeave, and all _lv* helpers.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { type VNode }                               from 'preact';
import { useState, useMemo, useCallback }            from 'preact/hooks';
import { Modal }                                     from '@shared/Modal';
import { Spinner }                                   from '@shared/Spinner';
import { confirm }                                   from '@shared/ConfirmDialog';
import type { LeaveRequest, LeaveType, UserRole }    from './types';
import {
  useMyLeaves, useManagerLeaves, useAdminLeaves,
  useSubmitLeave, useUpdateLeave, useDeleteLeave,
  useApproveLeave, useRejectLeave,
} from './hooks';
import { StatCard }  from './StatCard';
import {
  fmtDate, todayISO,
  LEAVE_STATUS_COLOR, LEAVE_STATUS_LABEL,
  LEAVE_TYPE_COLOR, LEAVE_TYPE_LABEL,
} from './utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LeaveSectionProps {
  currentRole:     UserRole;
  currentUsername: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LeaveSection({ currentRole, currentUsername }: LeaveSectionProps): VNode {
  // Load the right data set based on role
  const empQuery  = useMyLeaves();
  const mgrQuery  = useManagerLeaves(currentRole === 'manager' ? currentUsername : null);
  const admQuery  = useAdminLeaves();

  const query = currentRole === 'admin' ? admQuery
              : currentRole === 'manager' ? mgrQuery
              : empQuery;

  const leaves: LeaveRequest[] = (query.data ?? []) as LeaveRequest[];

  // ── UI state ──────────────────────────────────────────────────────────────
  const [tab,        setTab]       = useState<string>('all');
  const [search,     setSearch]    = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | LeaveType>('');
  const [modalLeave, setModalLeave] = useState<LeaveRequest | null | undefined>(undefined);
  // undefined = closed, null = new, LeaveRequest = edit

  const isModalOpen = modalLeave !== undefined;

  // ── Mutations ─────────────────────────────────────────────────────────────
  const submitMutation  = useSubmitLeave();
  const updateMutation  = useUpdateLeave();
  const deleteMutation  = useDeleteLeave();
  const approveMutation = useApproveLeave(currentRole === 'manager' ? currentUsername : undefined);
  const rejectMutation  = useRejectLeave(currentRole === 'manager' ? currentUsername : undefined);

  // ── Tabs ──────────────────────────────────────────────────────────────────
  const TABS = useMemo(() => {
    if (currentRole === 'employee') {
      return [
        { id: 'all',      label: 'All' },
        { id: 'pending',  label: 'Pending' },
        { id: 'approved', label: 'Approved' },
        { id: 'rejected', label: 'Rejected' },
      ];
    }
    return [
      { id: 'all',      label: 'All' },
      { id: 'pending',  label: 'Pending' },
      { id: 'approved', label: 'Approved' },
      { id: 'rejected', label: 'Rejected' },
    ];
  }, [currentRole]);

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return leaves.filter(r => {
      if (tab !== 'all' && r.status !== tab) return false;
      if (typeFilter && r.type !== typeFilter) return false;
      if (q && ![ r.type, r.reason, r.status, r.from, r.to, r.employee ]
        .some(v => String(v || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [leaves, tab, search, typeFilter]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total:    leaves.length,
    pending:  leaves.filter(r => r.status === 'pending').length,
    approved: leaves.filter(r => r.status === 'approved').length,
    rejected: leaves.filter(r => r.status === 'rejected').length,
  }), [leaves]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleApprove = useCallback(async (id: string) => {
    const ok = await confirm({ title: 'Approve Leave?', message: 'Mark this request as approved.', variant: 'info', confirmLabel: 'Approve' });
    if (ok) approveMutation.mutate(id);
  }, [approveMutation]);

  const handleReject = useCallback(async (id: string) => {
    const ok = await confirm({ title: 'Reject Leave?', message: 'Mark this request as rejected.', variant: 'warning', confirmLabel: 'Reject' });
    if (ok) rejectMutation.mutate(id);
  }, [rejectMutation]);

  const handleDelete = useCallback(async (leave: LeaveRequest) => {
    const ok = await confirm({ title: 'Delete Request?', message: 'Delete this leave request permanently.', variant: 'danger', confirmLabel: 'Delete' });
    if (ok) deleteMutation.mutate(leave.id);
  }, [deleteMutation]);

  const showEmployee = currentRole !== 'employee';
  const canSubmit    = currentRole === 'employee';

  return (
    <div style={{ padding: '24px' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: '700', color: '#111827' }}>
            {currentRole === 'employee' ? 'My Leave Requests' : 'Leave Management'}
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#6b7280' }}>
            {currentRole === 'employee' ? 'View and manage your leave applications.' : 'Review and process leave requests.'}
          </p>
        </div>
        {canSubmit && (
          <button
            type="button"
            onClick={() => setModalLeave(null)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '9px 18px', background: '#2563eb', color: '#fff',
              border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '500',
            }}
          >
            <i class="fas fa-plus" aria-hidden="true" /> Request Leave
          </button>
        )}
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '24px' }}>
        <StatCard icon="fa-calendar-alt"   label="Total"    value={stats.total}    color="#2563eb" loading={query.isLoading} />
        <StatCard icon="fa-clock"          label="Pending"  value={stats.pending}  color="#d97706" loading={query.isLoading} />
        <StatCard icon="fa-check-circle"   label="Approved" value={stats.approved} color="#16a34a" loading={query.isLoading} />
        <StatCard icon="fa-times-circle"   label="Rejected" value={stats.rejected} color="#dc2626" loading={query.isLoading} />
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px', alignItems: 'center' }}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: '4px', background: '#f3f4f6', borderRadius: '8px', padding: '3px' }}>
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              style={{
                padding:      '5px 14px',
                borderRadius: '6px',
                border:       'none',
                background:   tab === t.id ? '#fff' : 'transparent',
                color:        tab === t.id ? '#111827' : '#6b7280',
                fontWeight:   tab === t.id ? '600' : '400',
                fontSize:     '13px',
                cursor:       'pointer',
                boxShadow:    tab === t.id ? '0 1px 3px rgba(0,0,0,.1)' : 'none',
              }}
            >
              {t.label}
              {t.id !== 'all' && (
                <span style={{ marginLeft: '5px', fontSize: '11px', opacity: 0.7 }}>
                  ({leaves.filter(r => r.status === t.id).length})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <div style={{ position: 'relative', flex: '1 1 200px' }}>
          <i class="fas fa-search" style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', fontSize: '12px' }} />
          <input
            type="search"
            value={search}
            onInput={e => setSearch((e.target as HTMLInputElement).value)}
            placeholder="Search…"
            aria-label="Search leave requests"
            style={{ width: '100%', padding: '7px 10px 7px 30px', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '13px', boxSizing: 'border-box' }}
          />
        </div>

        {/* Type filter */}
        <select
          value={typeFilter}
          onChange={e => setTypeFilter((e.target as HTMLSelectElement).value as '' | LeaveType)}
          aria-label="Filter by leave type"
          style={{ padding: '7px 10px', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '13px', background: '#fff', cursor: 'pointer' }}
        >
          <option value="">All Types</option>
          <option value="sick">Sick</option>
          <option value="casual">Casual</option>
          <option value="annual">Annual</option>
          <option value="medical">Medical</option>
        </select>
      </div>

      {/* Table */}
      {query.isLoading ? (
        <div style={{ padding: '60px', display: 'flex', justifyContent: 'center' }}>
          <Spinner size={36} label="Loading leave requests…" />
        </div>
      ) : query.error ? (
        <div style={{ padding: '32px', textAlign: 'center', color: '#dc2626' }}>
          Failed to load leave requests.
          <button type="button" onClick={() => void query.refetch()} style={{ marginLeft: '10px', color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer' }}>
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '60px', textAlign: 'center', color: '#6b7280' }}>
          <i class="fas fa-calendar-check" style={{ fontSize: '32px', display: 'block', marginBottom: '12px', opacity: 0.4 }} />
          <div style={{ fontWeight: '600' }}>No leave requests found</div>
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: '10px', boxShadow: '0 1px 3px rgba(0,0,0,.06)', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '1px solid #f3f4f6' }}>
                  {showEmployee && <Th>Employee</Th>}
                  <Th>Type</Th>
                  <Th>From</Th>
                  <Th>To</Th>
                  <Th>Days</Th>
                  {!showEmployee && <Th>Reason</Th>}
                  {!showEmployee && <Th>Applied</Th>}
                  <Th>Status</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const isPending = r.status === 'pending';
                  const typeMeta  = LEAVE_TYPE_COLOR[r.type as LeaveType] ?? { bg: '#f3f4f6', text: '#374151' };
                  const statusMeta = LEAVE_STATUS_COLOR[r.status as LeaveStatus] ?? { bg: '#f3f4f6', text: '#374151' };
                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid #f9fafb' }}>
                      {showEmployee && (
                        <Td>
                          <div style={{ fontWeight: '600' }}>{r.employee ?? '—'}</div>
                          <div style={{ fontSize: '11px', color: '#9ca3af' }}>{r.department ?? ''}</div>
                        </Td>
                      )}
                      <Td>
                        <span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: '600', background: typeMeta.bg, color: typeMeta.text }}>
                          {LEAVE_TYPE_LABEL[r.type as LeaveType] ?? r.type}
                        </span>
                      </Td>
                      <Td>{fmtDate(r.from ?? r.fromDate)}</Td>
                      <Td>{fmtDate(r.to ?? r.toDate)}</Td>
                      <Td><span style={{ padding: '2px 8px', background: '#f3f4f6', borderRadius: '999px', fontSize: '12px' }}>{r.days ?? '?'}d</span></Td>
                      {!showEmployee && <Td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.reason || '—'}</Td>}
                      {!showEmployee && <Td>{fmtDate(r.appliedOn)}</Td>}
                      <Td>
                        <span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: '600', background: statusMeta.bg, color: statusMeta.text }}>
                          {LEAVE_STATUS_LABEL[r.status]}
                        </span>
                      </Td>
                      <Td>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {/* Manager / Admin: approve / reject */}
                          {(currentRole === 'manager' || currentRole === 'admin') && isPending && (
                            <>
                              <ActionBtn color="#16a34a" icon="fa-check" label="Approve" onClick={() => void handleApprove(r.id)} />
                              <ActionBtn color="#dc2626" icon="fa-times" label="Reject"  onClick={() => void handleReject(r.id)} />
                            </>
                          )}
                          {/* Employee: edit / delete own pending leaves */}
                          {currentRole === 'employee' && isPending && (
                            <>
                              <ActionBtn color="#2563eb" icon="fa-edit"  label="Edit"   onClick={() => setModalLeave(r)} />
                              <ActionBtn color="#dc2626" icon="fa-trash" label="Delete" onClick={() => void handleDelete(r)} />
                            </>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Submit / Edit leave modal */}
      <LeaveRequestModal
        open={isModalOpen}
        leave={modalLeave === null ? undefined : modalLeave ?? undefined}
        onClose={() => setModalLeave(undefined)}
        onSubmit={async (payload) => {
          if (modalLeave) {
            await updateMutation.mutateAsync({ id: modalLeave.id, ...payload });
          } else {
            await submitMutation.mutateAsync(payload);
          }
          setModalLeave(undefined);
        }}
        isSubmitting={submitMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}

// ── LeaveRequestModal ─────────────────────────────────────────────────────────

interface LeaveFormState {
  type:     LeaveType;
  fromDate: string;
  toDate:   string;
  reason:   string;
}

function LeaveRequestModal({
  open, leave, onClose, onSubmit, isSubmitting,
}: {
  open:        boolean;
  leave?:      LeaveRequest;
  onClose:     () => void;
  onSubmit:    (payload: { type: LeaveType; fromDate: string; toDate: string; reason: string }) => Promise<void>;
  isSubmitting: boolean;
}): VNode {
  const today = todayISO();
  const [form,   setForm]   = useState<LeaveFormState>({ type: 'annual', fromDate: today, toDate: today, reason: '' });
  const [errors, setErrors] = useState<Partial<LeaveFormState>>({});

  // Populate when editing
  useState(() => {
    if (leave) {
      setForm({
        type:     leave.type,
        fromDate: leave.from ?? leave.fromDate ?? today,
        toDate:   leave.to ?? leave.toDate ?? today,
        reason:   leave.reason,
      });
    } else {
      setForm({ type: 'annual', fromDate: today, toDate: today, reason: '' });
    }
    setErrors({});
  });

  const set = <K extends keyof LeaveFormState>(key: K, value: string) => {
    setForm(f => ({ ...f, [key]: value }));
    setErrors(e => ({ ...e, [key]: undefined }));
  };

  const handleSubmit = async () => {
    const errs: Partial<LeaveFormState> = {};
    if (!form.fromDate) errs.fromDate = 'Required';
    if (!form.toDate)   errs.toDate   = 'Required';
    if (!form.reason.trim()) errs.reason = 'Reason is required.';
    if (form.fromDate && form.toDate && form.toDate < form.fromDate) errs.toDate = 'End date must be on or after start date.';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    await onSubmit({ type: form.type, fromDate: form.fromDate, toDate: form.toDate, reason: form.reason.trim() });
  };

  const footer = (
    <>
      <button type="button" onClick={onClose} disabled={isSubmitting} style={{ padding: '8px 18px', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}>
        Cancel
      </button>
      <button type="button" onClick={() => void handleSubmit()} disabled={isSubmitting} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 18px', background: isSubmitting ? '#9ca3af' : '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: isSubmitting ? 'not-allowed' : 'pointer', fontSize: '14px', minWidth: '120px', justifyContent: 'center' }}>
        {isSubmitting ? <Spinner size={14} color="#fff" label="Saving…" /> : (leave ? 'Save Changes' : 'Submit Request')}
      </button>
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title={leave ? 'Edit Leave Request' : 'Request Leave'} size="sm" footer={footer} closeOnBackdrop={!isSubmitting} closeOnEscape={!isSubmitting}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

        <div>
          <label style={lbl}>Leave Type <span style={{ color: '#dc2626' }}>*</span></label>
          <select value={form.type} onChange={e => set('type', (e.target as HTMLSelectElement).value)} disabled={isSubmitting} style={inp(false)}>
            <option value="annual">Annual</option>
            <option value="sick">Sick</option>
            <option value="casual">Casual</option>
            <option value="medical">Medical</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <div style={{ flex: 1 }}>
            <label style={lbl}>From <span style={{ color: '#dc2626' }}>*</span></label>
            <input type="date" value={form.fromDate} min={today} onInput={e => set('fromDate', (e.target as HTMLInputElement).value)} disabled={isSubmitting} style={inp(!!errors.fromDate)} />
            {errors.fromDate && <Err>{errors.fromDate}</Err>}
          </div>
          <div style={{ flex: 1 }}>
            <label style={lbl}>To <span style={{ color: '#dc2626' }}>*</span></label>
            <input type="date" value={form.toDate} min={form.fromDate || today} onInput={e => set('toDate', (e.target as HTMLInputElement).value)} disabled={isSubmitting} style={inp(!!errors.toDate)} />
            {errors.toDate && <Err>{errors.toDate}</Err>}
          </div>
        </div>

        <div>
          <label style={lbl}>Reason <span style={{ color: '#dc2626' }}>*</span></label>
          <textarea
            value={form.reason}
            onInput={e => set('reason', (e.target as HTMLTextAreaElement).value)}
            disabled={isSubmitting}
            placeholder="Brief reason for leave…"
            rows={3}
            style={{ ...inp(!!errors.reason), resize: 'vertical', minHeight: '80px' }}
          />
          {errors.reason && <Err>{errors.reason}</Err>}
        </div>

      </div>
    </Modal>
  );
}

// ── Table helpers ─────────────────────────────────────────────────────────────

function Th({ children }: { children: string }): VNode {
  return (
    <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6b7280', whiteSpace: 'nowrap' }}>
      {children}
    </th>
  );
}

function Td({ children, style }: { children: VNode | VNode[] | string | null; style?: Record<string, string> }): VNode {
  return (
    <td style={{ padding: '10px 14px', verticalAlign: 'middle', ...style }}>
      {children}
    </td>
  );
}

function ActionBtn({ color, icon, label, onClick }: { color: string; icon: string; label: string; onClick: () => void }): VNode {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        padding: '4px 10px', background: `${color}12`, color,
        border: `1px solid ${color}30`, borderRadius: '5px',
        cursor: 'pointer', fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px',
      }}
    >
      <i class={`fas ${icon}`} aria-hidden="true" />
      {label}
    </button>
  );
}

// ── Inline form style helpers ─────────────────────────────────────────────────

const lbl: Record<string, string> = { display: 'block', fontSize: '12px', fontWeight: '500', color: '#374151', marginBottom: '4px' };
const inp = (err: boolean): Record<string, string> => ({
  width: '100%', padding: '8px 10px', fontSize: '13px', boxSizing: 'border-box',
  border: `1px solid ${err ? '#dc2626' : '#d1d5db'}`, borderRadius: '6px', color: '#111827', background: '#fff',
});
function Err({ children }: { children: string }): VNode {
  return <div role="alert" style={{ fontSize: '11px', color: '#dc2626', marginTop: '3px' }}>{children}</div>;
}
