/**
 * LeaveSection.tsx
 *
 * Leave management for all roles:
 *   - Employee: view own leaves, submit/edit/delete pending requests
 *   - Manager:  view department leaves, approve/reject pending requests
 *   - Admin:    view all leaves, approve/reject any, filter by type/search
 *
 * Reskinned to use the branded `.lv-*` design system from assets/styles/leaves.css
 * (stat cards, filter bar, table, type/status badges, action pills) plus the shared
 * `.page-header`, `.btn` and `.form-*` classes — instead of ad-hoc inline styles.
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
import { useCan }                                     from '@lib/permissions';
import type { LeaveRequest, LeaveType, UserRole } from './types';
import {
  useMyLeaves, useManagerLeaves, useAdminLeaves,
  useSubmitLeave, useUpdateLeave, useDeleteLeave,
  useApproveLeave, useRejectLeave,
} from './hooks';
import {
  fmtDate, todayISO,
  LEAVE_STATUS_LABEL,
  LEAVE_TYPE_LABEL,
} from './utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface LeaveSectionProps {
  currentRole:     UserRole;
  currentUsername: string;
}

// ── Branded badge-class maps ──────────────────────────────────────────────────

const LV_TYPE_CLASS: Record<string, string> = {
  sick:    'lv-type-sick',
  casual:  'lv-type-casual',
  annual:  'lv-type-annual',
  medical: 'lv-type-medical',
};

const LV_STATUS_CLASS: Record<string, string> = {
  pending:  'lv-status-pending',
  approved: 'lv-status-approved',
  rejected: 'lv-status-rejected',
};

const LV_STAT_ICON_CLASS: Record<string, string> = {
  total:    'navy',
  pending:  'medical',
  approved: 'green',
  rejected: 'red',
};

// ── Component ─────────────────────────────────────────────────────────────────

export function LeaveSection({ currentRole, currentUsername }: LeaveSectionProps): VNode {
  // Load the right data set based on role
  const canApprove = useCan('leaves.approve');
  const empQuery  = useMyLeaves();
  const mgrQuery  = useManagerLeaves(currentRole === 'manager' ? currentUsername : null);
  const admQuery  = useAdminLeaves();

  const query = (currentRole === 'admin' || currentRole === 'superadmin') ? admQuery
              : currentRole === 'manager' ? mgrQuery
              : empQuery;

  const leaves: LeaveRequest[] = (query.data ?? []);

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
        .some(v => (v || '').toLowerCase().includes(q))) return false;
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

  // Column count for the empty-row colspan
  const colCount = 6 + (showEmployee ? 1 : 0) + (showEmployee ? 2 : 0);

  return (
    <div class="leave-section">

      {/* Header */}
      <div class="page-header" style={{ marginBottom: '24px' }}>
        <div class="page-header-left">
          <div id="pageTitleBlock">
            <h1>
              <i class="fas fa-calendar-alt" aria-hidden="true" />
              {currentRole === 'employee' ? 'My Leave Requests' : 'Leave Management'}
            </h1>
            <p id="pageTitleSub">
              {currentRole === 'employee' ? 'View and manage your leave applications.' : 'Review and process leave requests.'}
            </p>
          </div>
        </div>
        {canSubmit && (
          <div class="page-header-right">
            <button type="button" class="btn btn-primary" onClick={() => setModalLeave(null)}>
              <i class="fas fa-plus" aria-hidden="true" /> Request Leave
            </button>
          </div>
        )}
      </div>

      {/* Stats */}
      <div class="lv-stats-row">
        <StatCard icon="fa-calendar-alt" tone="navy"    label="Total"    value={stats.total}    loading={query.isLoading} />
        <StatCard icon="fa-clock"        tone="medical" label="Pending"  value={stats.pending}  loading={query.isLoading} />
        <StatCard icon="fa-check-circle" tone="green"   label="Approved" value={stats.approved} loading={query.isLoading} />
        <StatCard icon="fa-times-circle" tone="red"     label="Rejected" value={stats.rejected} loading={query.isLoading} />
      </div>

      {/* Toolbar */}
      <div class="lv-filters-bar">
        {/* Tabs */}
        <div class="lv-tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              class={`lv-tab-btn${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id !== 'all' && ` (${leaves.filter(r => r.status === t.id).length})`}
            </button>
          ))}
        </div>

        <div class="lv-bar-actions">
          {/* Search */}
          <div class="lv-search-box">
            <i class="fas fa-search" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onInput={e => setSearch((e.target as HTMLInputElement).value)}
              placeholder="Search…"
              aria-label="Search leave requests"
            />
          </div>

          {/* Type filter */}
          <select
            class="lv-filter-select"
            value={typeFilter}
            onChange={e => setTypeFilter((e.target as HTMLSelectElement).value as '' | LeaveType)}
            aria-label="Filter by leave type"
          >
            <option value="">All Types</option>
            <option value="sick">Sick</option>
            <option value="casual">Casual</option>
            <option value="annual">Annual</option>
            <option value="medical">Medical</option>
          </select>
        </div>
      </div>

      {/* Table */}
      {query.isLoading ? (
        <div class="lv-table-container">
          <div style={{ padding: '60px', display: 'flex', justifyContent: 'center' }}>
            <Spinner size={36} label="Loading leave requests…" />
          </div>
        </div>
      ) : query.error ? (
        <div class="lv-table-container">
          <div class="lv-empty-row" style={{ color: 'var(--danger)' }}>
            <i class="fas fa-triangle-exclamation" aria-hidden="true" />
            <p>Failed to load leave requests.</p>
            <button type="button" class="btn btn-outline-primary btn-sm" onClick={() => void query.refetch()}>
              Retry
            </button>
          </div>
        </div>
      ) : (
        <div class="lv-table-container">
          <table class="lv-table">
            <thead>
              <tr>
                {showEmployee && <th>Employee</th>}
                <th>Type</th>
                <th>From</th>
                <th>To</th>
                <th>Days</th>
                {!showEmployee && <th>Reason</th>}
                {!showEmployee && <th>Applied</th>}
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={colCount} class="lv-empty-row">
                    <i class="fas fa-calendar-check" aria-hidden="true" />
                    <p>No leave requests found</p>
                  </td>
                </tr>
              ) : (
                filtered.map(r => {
                  const isPending  = r.status === 'pending';
                  const typeClass  = LV_TYPE_CLASS[r.type] ?? 'lv-type-casual';
                  const statusClass = LV_STATUS_CLASS[r.status] ?? 'lv-status-pending';
                  return (
                    <tr key={r.id}>
                      {showEmployee && (
                        <td>
                          <div class="lv-emp-name">{r.employee ?? '—'}</div>
                          <div class="lv-dept-label">{r.department ?? ''}</div>
                        </td>
                      )}
                      <td>
                        <span class={`lv-type-badge ${typeClass}`}>
                          {LEAVE_TYPE_LABEL[r.type] ?? r.type}
                        </span>
                      </td>
                      <td>{fmtDate(r.from ?? r.fromDate)}</td>
                      <td>{fmtDate(r.to ?? r.toDate)}</td>
                      <td><span class="lv-days-pill">{r.days ?? '?'}d</span></td>
                      {!showEmployee && <td class="lv-reason-cell">{r.reason || '—'}</td>}
                      {!showEmployee && <td>{fmtDate(r.appliedOn)}</td>}
                      <td>
                        <span class={`lv-status-badge ${statusClass}`}>
                          {LEAVE_STATUS_LABEL[r.status]}
                        </span>
                      </td>
                      <td>
                        <div class="lv-action-btns">
                          {/* Approvers (manager / admin / superadmin via leaves.approve) */}
                          {canApprove && isPending && (
                            <>
                              <button type="button" class="lv-act-btn lv-act-approve" aria-label="Approve" title="Approve" onClick={() => void handleApprove(r.id)}>
                                <i class="fas fa-check" aria-hidden="true" /> Approve
                              </button>
                              <button type="button" class="lv-act-btn lv-act-reject" aria-label="Reject" title="Reject" onClick={() => void handleReject(r.id)}>
                                <i class="fas fa-times" aria-hidden="true" /> Reject
                              </button>
                            </>
                          )}
                          {/* Employee: edit / delete own pending leaves */}
                          {currentRole === 'employee' && isPending && (
                            <>
                              <button type="button" class="lv-act-btn lv-act-edit" aria-label="Edit" title="Edit" onClick={() => setModalLeave(r)}>
                                <i class="fas fa-edit" aria-hidden="true" /> Edit
                              </button>
                              <button type="button" class="lv-act-btn lv-act-delete" aria-label="Delete" title="Delete" onClick={() => void handleDelete(r)}>
                                <i class="fas fa-trash" aria-hidden="true" /> Delete
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
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

// ── Branded stat card (matches .lv-stat-card markup) ───────────────────────────

function StatCard({ icon, tone, label, value, loading }: {
  icon: string; tone: string; label: string; value: number; loading: boolean;
}): VNode {
  return (
    <div class="lv-stat-card">
      <div class={`lv-stat-icon ${tone}`}>
        <i class={`fas ${icon}`} aria-hidden="true" />
      </div>
      <div class="lv-stat-body">
        <div class="lv-stat-value">{loading ? '—' : value}</div>
        <div class="lv-stat-label">{label}</div>
      </div>
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
      <button type="button" class="btn btn-outline-secondary has-label" onClick={onClose} disabled={isSubmitting}>
        Cancel
      </button>
      <button type="button" class="btn btn-primary" onClick={() => void handleSubmit()} disabled={isSubmitting} style={{ minWidth: '120px' }}>
        {isSubmitting ? <Spinner size={14} color="#fff" label="Saving…" /> : (leave ? 'Save Changes' : 'Submit Request')}
      </button>
    </>
  );

  return (
    <Modal open={open} onClose={onClose} title={leave ? 'Edit Leave Request' : 'Request Leave'} size="sm" footer={footer} closeOnBackdrop={!isSubmitting} closeOnEscape={!isSubmitting}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

        <div class="form-group">
          <label class="form-label">Leave Type <span style={{ color: 'var(--danger)' }}>*</span></label>
          <select class="form-select" value={form.type} onChange={e => set('type', (e.target as HTMLSelectElement).value)} disabled={isSubmitting}>
            <option value="annual">Annual</option>
            <option value="sick">Sick</option>
            <option value="casual">Casual</option>
            <option value="medical">Medical</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <div class="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label class="form-label">From <span style={{ color: 'var(--danger)' }}>*</span></label>
            <input type="date" class={`form-control${errors.fromDate ? ' field-invalid' : ''}`} value={form.fromDate} min={today} onInput={e => set('fromDate', (e.target as HTMLInputElement).value)} disabled={isSubmitting} />
            {errors.fromDate && <div class="field-error-msg" role="alert">{errors.fromDate}</div>}
          </div>
          <div class="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label class="form-label">To <span style={{ color: 'var(--danger)' }}>*</span></label>
            <input type="date" class={`form-control${errors.toDate ? ' field-invalid' : ''}`} value={form.toDate} min={form.fromDate || today} onInput={e => set('toDate', (e.target as HTMLInputElement).value)} disabled={isSubmitting} />
            {errors.toDate && <div class="field-error-msg" role="alert">{errors.toDate}</div>}
          </div>
        </div>

        <div class="form-group" style={{ marginBottom: 0 }}>
          <label class="form-label">Reason <span style={{ color: 'var(--danger)' }}>*</span></label>
          <textarea
            class={`form-control${errors.reason ? ' field-invalid' : ''}`}
            value={form.reason}
            onInput={e => set('reason', (e.target as HTMLTextAreaElement).value)}
            disabled={isSubmitting}
            placeholder="Brief reason for leave…"
            rows={3}
            style={{ resize: 'vertical', minHeight: '80px' }}
          />
          {errors.reason && <div class="field-error-msg" role="alert">{errors.reason}</div>}
        </div>

      </div>
    </Modal>
  );
}
