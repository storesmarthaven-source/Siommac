/**
 * src/components/sections/AdminLeave/AdminLeaveSection.tsx
 *
 * Admin view of all leave applications (section id: s-adm-leaves).
 * Replaces leave.js — admin side only.
 * Employee-/manager-leave (LeaveSection.tsx) was ported separately in Phase 4.
 *
 * Reskinned to use the branded `.lv-*` design system from assets/styles/leaves.css
 * (stat cards, filter bar, table, type/status badges, action pills, empty row)
 * plus the shared `.btn`/`.page-header` classes — instead of ad-hoc inline styles.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { type VNode }      from 'preact';
import { useState, useMemo, useCallback } from 'preact/hooks';
import { useQueryClient }  from '@tanstack/preact-query';
import { useAdminLeaveData } from './hooks';
import { getLeaveById, deleteLeaveApi } from './api';
import { LeaveDocModal }   from './LeaveDocModal';
import { ConfirmDialog }   from '@shared/ConfirmDialog';
import { toast }           from '@store';
import {
  fmtLeaveDate,
  capStr,
} from './utils';
import type { LeaveDetail, LeaveRecord, LeaveTabFilter, LeaveType } from './types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Branded type-badge class from leaves.css. */
function lvTypeClass(type: string): string {
  const map: Record<string, string> = {
    sick:    'lv-type-sick',
    casual:  'lv-type-casual',
    annual:  'lv-type-annual',
    medical: 'lv-type-medical',
  };
  return map[type.toLowerCase()] ?? 'lv-type-casual';
}

/** Branded status-badge class from leaves.css. */
function lvStatusClass(status: string): string {
  const map: Record<string, string> = {
    pending:  'lv-status-pending',
    approved: 'lv-status-approved',
    rejected: 'lv-status-rejected',
  };
  return map[status.toLowerCase()] ?? 'lv-status-pending';
}

const LEAVE_TYPES: { value: string; label: string }[] = [
  { value: 'all',     label: 'All Types' },
  { value: 'sick',    label: 'Sick'      },
  { value: 'casual',  label: 'Casual'    },
  { value: 'annual',  label: 'Annual'    },
  { value: 'medical', label: 'Medical'   },
];

const TAB_LABELS: { id: LeaveTabFilter; label: string }[] = [
  { id: 'all',      label: 'All'      },
  { id: 'pending',  label: 'Pending'  },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
];

// ── Stat cards ────────────────────────────────────────────────────────────────

interface StatCardsProps {
  pending:  number;
  approved: number;
  rejected: number;
  total:    number;
  loading:  boolean;
}

function LeaveStatCards({ pending, approved, rejected, total, loading }: StatCardsProps): VNode {
  const cards = [
    { label: 'Pending',  value: pending,  icon: 'fas fa-clock',        tone: 'medical' },
    { label: 'Approved', value: approved, icon: 'fas fa-check-circle', tone: 'green'   },
    { label: 'Rejected', value: rejected, icon: 'fas fa-times-circle', tone: 'red'     },
    { label: 'Total',    value: total,    icon: 'fas fa-chart-line',   tone: 'navy'    },
  ];

  return (
    <div class="lv-stats-row">
      {cards.map(c => (
        <div key={c.label} class="lv-stat-card">
          <div class={`lv-stat-icon ${c.tone}`}>
            <i class={c.icon} aria-hidden="true" />
          </div>
          <div class="lv-stat-body">
            <div class="lv-stat-value">{loading ? '—' : c.value}</div>
            <div class="lv-stat-label">{c.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Leave row ─────────────────────────────────────────────────────────────────

interface LeaveRowProps {
  record:    LeaveRecord;
  onView:    (id: string) => void;
  onPrint:   (id: string) => void;
  onDelete:  (id: string, name: string) => void;
}

function LeaveRow({ record, onView, onPrint, onDelete }: LeaveRowProps): VNode {
  return (
    <tr>
      {/* Employee */}
      <td>
        <div class="lv-emp-name">{esc(record.employee)}</div>
      </td>
      {/* Department */}
      <td>
        <span class="lv-dept-label">{esc(record.department)}</span>
      </td>
      {/* Leave Type */}
      <td>
        <span class={`lv-type-badge ${lvTypeClass(record.type)}`}>{capStr(record.type)}</span>
      </td>
      {/* From */}
      <td>{fmtLeaveDate(record.fromDate)}</td>
      {/* To */}
      <td>{fmtLeaveDate(record.toDate)}</td>
      {/* Days */}
      <td>
        <span class="lv-days-pill">{record.days}d</span>
      </td>
      {/* Status */}
      <td>
        <span class={`lv-status-badge ${lvStatusClass(record.status)}`}>{record.status.toUpperCase()}</span>
      </td>
      {/* Actions */}
      <td>
        <div class="lv-action-btns">
          <button type="button" class="lv-act-btn lv-act-view" onClick={() => onView(record.id)}>
            <i class="fas fa-eye" aria-hidden="true" /> View
          </button>
          <button type="button" class="lv-act-btn lv-act-print" onClick={() => onPrint(record.id)}>
            <i class="fas fa-print" aria-hidden="true" /> Print
          </button>
          <button
            type="button"
            class="lv-act-btn lv-act-delete"
            aria-label="Delete"
            title="Delete"
            onClick={() => onDelete(record.id, record.employee)}
          >
            <i class="fas fa-trash" aria-hidden="true" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function AdminLeaveSection(): VNode {
  const queryClient = useQueryClient();

  // ── Filter state ──────────────────────────────────────────────────────────
  const [search,    setSearch]    = useState<string>('');
  const [tab,       setTab]       = useState<LeaveTabFilter>('all');
  const [leaveType, setLeaveType] = useState<string>('all');

  // ── Modal / dialog state ──────────────────────────────────────────────────
  const [viewDetail,  setViewDetail]  = useState<LeaveDetail | null>(null);
  const [loadingDoc,  setLoadingDoc]  = useState<boolean>(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleting,    setDeleting]    = useState<boolean>(false);

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data, isLoading, refetch } = useAdminLeaveData();

  // ── Derived rows ──────────────────────────────────────────────────────────
  const filteredRows = useMemo<LeaveRecord[]>(() => {
    const records = data?.records ?? [];
    const q = search.toLowerCase();
    return records.filter(r => {
      const matchSearch = q === '' || r.employee.toLowerCase().includes(q);
      const matchTab    = tab === 'all' || r.status === tab;
      const matchType   = leaveType === 'all' || r.type === (leaveType as LeaveType);
      return matchSearch && matchTab && matchType;
    });
  }, [data?.records, search, tab, leaveType]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleView = useCallback(async (id: string, autoPrint = false) => {
    setLoadingDoc(true);
    try {
      const detail = await getLeaveById(id);
      if (autoPrint) {
        // open print window directly without showing modal
        const { buildLeaveDocHtml: build, PRINT_CSS: css } = await import('./utils');
        const docHtml = build(detail);
        const win = window.open('', '_blank', 'width=900,height=1000');
        if (!win) { toast.error('Allow popups for this site to print.'); return; }
        win.document.write(
          `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Leave Application</title><style>${css}</style></head><body>${docHtml}</body></html>`,
        );
        win.document.close();
        win.focus();
        setTimeout(() => { try { win.print(); } catch (_) { /* noop */ } }, 300);
      } else {
        setViewDetail(detail);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load leave');
    } finally {
      setLoadingDoc(false);
    }
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteLeaveApi(deleteTarget.id);
      toast.success('Leave application deleted.');
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'leaves'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, queryClient]);

  const handleRefresh = useCallback(() => { void refetch(); }, [refetch]);

  // ── Tab counts ────────────────────────────────────────────────────────────
  const stats = data?.stats;

  return (
    <div class="admin-leave-section">

      {/* Stat cards */}
      <LeaveStatCards
        pending={stats?.pending   ?? 0}
        approved={stats?.approved ?? 0}
        rejected={stats?.rejected ?? 0}
        total={stats?.total       ?? 0}
        loading={isLoading}
      />

      {/* Filters bar */}
      <div class="lv-filters-bar">
        {/* Status tabs */}
        <div class="lv-tabs">
          {TAB_LABELS.map(t => (
            <button
              key={t.id}
              type="button"
              class={`lv-tab-btn${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div class="lv-bar-actions">
          {/* Search */}
          <div class="lv-search-box">
            <i class="fas fa-search" aria-hidden="true" />
            <input
              type="text"
              value={search}
              onInput={e => setSearch((e.target as HTMLInputElement).value)}
              placeholder="Search employee…"
              aria-label="Search by employee"
            />
          </div>

          {/* Leave type filter */}
          <select
            class="lv-filter-select"
            value={leaveType}
            onChange={e => setLeaveType((e.target as HTMLSelectElement).value)}
            aria-label="Filter by leave type"
          >
            {LEAVE_TYPES.map(lt => (
              <option key={lt.value} value={lt.value}>{lt.label}</option>
            ))}
          </select>

          {/* Refresh */}
          <button
            type="button"
            class="btn btn-outline-secondary"
            onClick={handleRefresh}
            disabled={isLoading}
            title="Refresh"
            aria-label="Refresh"
          >
            <i class={`fas fa-sync-alt${isLoading ? ' fa-spin' : ''}`} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Table card */}
      <div class="lv-table-container">
        <table class="lv-table">
          <thead>
            <tr>
              {['Employee', 'Department', 'Leave Type', 'From', 'To', 'Days', 'Status', 'Actions'].map(h => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} class="lv-empty-row">
                  <i class="fas fa-spinner fa-spin" aria-hidden="true" />
                  <p>Loading leave applications…</p>
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={8} class="lv-empty-row">
                  <i class="fas fa-calendar-check" aria-hidden="true" />
                  <p>No leave applications found.</p>
                </td>
              </tr>
            ) : (
              filteredRows.map(r => (
                <LeaveRow
                  key={r.id}
                  record={r}
                  onView={id => void handleView(id, false)}
                  onPrint={id => void handleView(id, true)}
                  onDelete={(id, name) => setDeleteTarget({ id, name })}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Loading overlay for doc fetch */}
      {loadingDoc && (
        <div
          style={{
            position:       'fixed',
            inset:          0,
            background:     'rgba(0,0,0,0.25)',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            zIndex:         9998,
          }}
        >
          <div
            style={{
              background:   'var(--bg-card)',
              borderRadius: '12px',
              padding:      '24px 32px',
              fontSize:     '14px',
              color:        'var(--text-primary)',
              display:      'flex',
              alignItems:   'center',
              gap:          '12px',
            }}
          >
            <i class="fas fa-spinner fa-spin" style={{ color: 'var(--siomac-navy)' }} aria-hidden="true" />
            Loading document…
          </div>
        </div>
      )}

      {/* Leave document modal */}
      <LeaveDocModal
        detail={viewDetail}
        onClose={() => setViewDetail(null)}
      />

      {/* Delete confirm dialog */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Leave Application"
        message={
          deleteTarget
            ? `Delete ${deleteTarget.name}'s leave application? This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        variant="danger"
        loading={deleting}
        onConfirm={() => void handleDeleteConfirm()}
        onClose={() => setDeleteTarget(null)}
      />

    </div>
  );
}
