/**
 * src/components/sections/AdminLeave/AdminLeaveSection.tsx
 *
 * Admin view of all leave applications (section id: s-adm-leaves).
 * Replaces leave.js — admin side only.
 * Employee-/manager-leave (LeaveSection.tsx) was ported separately in Phase 4.
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
  leaveTypeBg,
  leaveTypeFg,
  leaveStatusBg,
  leaveStatusFg,
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

const LEAVE_TYPES: Array<{ value: string; label: string }> = [
  { value: 'all',     label: 'All Types' },
  { value: 'sick',    label: 'Sick'      },
  { value: 'casual',  label: 'Casual'    },
  { value: 'annual',  label: 'Annual'    },
  { value: 'medical', label: 'Medical'   },
];

const TAB_LABELS: Array<{ id: LeaveTabFilter; label: string }> = [
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
    { label: 'Pending',  value: pending,  icon: 'fas fa-clock',        bg: '#FFFBEB', fg: '#B45309', iconBg: '#FEF3C7' },
    { label: 'Approved', value: approved, icon: 'fas fa-check-circle', bg: '#F0FDF4', fg: '#15803D', iconBg: '#DCFCE7' },
    { label: 'Rejected', value: rejected, icon: 'fas fa-times-circle', bg: '#FFF1F2', fg: '#BE123C', iconBg: '#FFE4E6' },
    { label: 'Total',    value: total,    icon: 'fas fa-chart-line',    bg: '#EFF6FF', fg: '#1E40AF', iconBg: '#DBEAFE' },
  ];

  return (
    <div
      style={{
        display:             'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap:                 '16px',
        marginBottom:        '24px',
      }}
    >
      {cards.map(c => (
        <div
          key={c.label}
          style={{
            background:   '#fff',
            borderRadius: '12px',
            boxShadow:    '0 1px 4px rgba(0,0,0,0.08)',
            padding:      '20px',
            display:      'flex',
            alignItems:   'center',
            gap:          '14px',
          }}
        >
          <div
            style={{
              width:        '44px',
              height:       '44px',
              borderRadius: '10px',
              background:   c.iconBg,
              display:      'flex',
              alignItems:   'center',
              justifyContent: 'center',
              flexShrink:   0,
            }}
          >
            <i class={c.icon} style={{ fontSize: '18px', color: c.fg }} />
          </div>
          <div>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#111827', lineHeight: 1 }}>
              {loading ? (
                <div style={{ width: '40px', height: '24px', background: '#f3f4f6', borderRadius: '4px' }} />
              ) : (
                c.value
              )}
            </div>
            <div style={{ fontSize: '12px', color: '#6B7280', marginTop: '4px' }}>{c.label}</div>
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
  const typeBg  = leaveTypeBg(record.type);
  const typeFg  = leaveTypeFg(record.type);
  const statBg  = leaveStatusBg(record.status);
  const statFg  = leaveStatusFg(record.status);

  const badgeStyle = (bg: string, fg: string) => ({
    display:      'inline-block',
    padding:      '2px 10px',
    borderRadius: '999px',
    fontSize:     '11px',
    fontWeight:   '600' as const,
    background:   bg,
    color:        fg,
    whiteSpace:   'nowrap' as const,
  });

  const btnStyle = (primary?: boolean) => ({
    padding:      '4px 10px',
    border:       primary ? 'none' : '1px solid #e5e7eb',
    borderRadius: '6px',
    background:   primary ? '#1B2D55' : '#fff',
    color:        primary ? '#fff'    : '#374151',
    cursor:       'pointer',
    fontSize:     '11px',
    fontWeight:   '500' as const,
    display:      'flex' as const,
    alignItems:   'center',
    gap:          '4px',
  });

  return (
    <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
      {/* Employee */}
      <td style={{ padding: '12px 16px', fontWeight: '600', color: '#111827', fontSize: '13px' }}>
        {esc(record.employee)}
      </td>
      {/* Department */}
      <td style={{ padding: '12px 16px' }}>
        <span style={{ ...badgeStyle('#EFF6FF', '#1E40AF') }}>{esc(record.department)}</span>
      </td>
      {/* Leave Type */}
      <td style={{ padding: '12px 16px' }}>
        <span style={{ ...badgeStyle(typeBg, typeFg) }}>{capStr(record.type)}</span>
      </td>
      {/* From */}
      <td style={{ padding: '12px 16px', color: '#374151', fontSize: '13px' }}>
        {fmtLeaveDate(record.fromDate)}
      </td>
      {/* To */}
      <td style={{ padding: '12px 16px', color: '#374151', fontSize: '13px' }}>
        {fmtLeaveDate(record.toDate)}
      </td>
      {/* Days */}
      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
        <span
          style={{
            display:      'inline-block',
            padding:      '2px 10px',
            borderRadius: '999px',
            background:   '#F3F4F6',
            color:        '#374151',
            fontSize:     '12px',
            fontWeight:   '600',
          }}
        >
          {record.days}d
        </span>
      </td>
      {/* Status */}
      <td style={{ padding: '12px 16px' }}>
        <span style={{ ...badgeStyle(statBg, statFg) }}>{record.status.toUpperCase()}</span>
      </td>
      {/* Actions */}
      <td style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <button type="button" style={btnStyle(true)} onClick={() => onView(record.id)}>
            <i class="fas fa-eye" /> View
          </button>
          <button type="button" style={btnStyle()} onClick={() => onPrint(record.id)}>
            <i class="fas fa-print" /> Print
          </button>
          <button
            type="button"
            style={{ ...btnStyle(), color: '#BE123C', borderColor: '#fecdd3' }}
            onClick={() => onDelete(record.id, record.employee)}
          >
            <i class="fas fa-trash" />
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
    <div style={{ padding: '24px' }}>

      {/* Stat cards */}
      <LeaveStatCards
        pending={stats?.pending   ?? 0}
        approved={stats?.approved ?? 0}
        rejected={stats?.rejected ?? 0}
        total={stats?.total       ?? 0}
        loading={isLoading}
      />

      {/* Filters bar */}
      <div
        style={{
          display:        'flex',
          alignItems:     'center',
          gap:            '12px',
          flexWrap:       'wrap',
          marginBottom:   '20px',
          background:     '#fff',
          borderRadius:   '10px',
          padding:        '12px 16px',
          boxShadow:      '0 1px 4px rgba(0,0,0,0.06)',
        }}
      >
        {/* Search */}
        <div style={{ position: 'relative', flexGrow: 1, minWidth: '180px' }}>
          <i
            class="fas fa-search"
            style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#9CA3AF', fontSize: '13px' }}
          />
          <input
            type="text"
            value={search}
            onInput={e => setSearch((e.target as HTMLInputElement).value)}
            placeholder="Search employee…"
            style={{
              paddingLeft:  '32px',
              paddingRight: '10px',
              paddingTop:   '7px',
              paddingBottom:'7px',
              border:       '1px solid #e5e7eb',
              borderRadius: '7px',
              fontSize:     '13px',
              width:        '100%',
              outline:      'none',
            }}
          />
        </div>

        {/* Status tabs */}
        <div style={{ display: 'flex', gap: '4px', background: '#f3f4f6', borderRadius: '8px', padding: '3px' }}>
          {TAB_LABELS.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              style={{
                padding:      '5px 14px',
                border:       'none',
                borderRadius: '6px',
                fontSize:     '12px',
                fontWeight:   '600',
                cursor:       'pointer',
                background:   tab === t.id ? '#1B2D55' : 'transparent',
                color:        tab === t.id ? '#fff'    : '#6B7280',
                transition:   'background 0.15s',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Leave type filter */}
        <select
          value={leaveType}
          onChange={e => setLeaveType((e.target as HTMLSelectElement).value)}
          style={{
            padding:      '7px 10px',
            border:       '1px solid #e5e7eb',
            borderRadius: '7px',
            fontSize:     '13px',
            background:   '#fff',
            cursor:       'pointer',
            outline:      'none',
          }}
        >
          {LEAVE_TYPES.map(lt => (
            <option key={lt.value} value={lt.value}>{lt.label}</option>
          ))}
        </select>

        {/* Refresh */}
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isLoading}
          style={{
            padding:      '7px 12px',
            border:       '1px solid #e5e7eb',
            borderRadius: '7px',
            background:   '#fff',
            cursor:       isLoading ? 'not-allowed' : 'pointer',
            color:        '#374151',
            fontSize:     '13px',
          }}
          title="Refresh"
        >
          <i class={`fas fa-sync-alt${isLoading ? ' fa-spin' : ''}`} />
        </button>
      </div>

      {/* Table card */}
      <div
        style={{
          background:   '#fff',
          borderRadius: '12px',
          boxShadow:    '0 1px 4px rgba(0,0,0,0.08)',
          overflow:     'hidden',
        }}
      >
        {/* Card header */}
        <div
          style={{
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'space-between',
            padding:        '16px 20px',
            borderBottom:   '1px solid #f3f4f6',
          }}
        >
          <span style={{ fontWeight: '600', fontSize: '15px', color: '#111827' }}>
            Leave Applications
          </span>
          {!isLoading && (
            <span
              style={{
                padding:      '2px 10px',
                borderRadius: '999px',
                background:   '#EFF6FF',
                color:        '#1E40AF',
                fontSize:     '12px',
                fontWeight:   '600',
              }}
            >
              {filteredRows.length} {filteredRows.length === 1 ? 'record' : 'records'}
            </span>
          )}
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width:           '100%',
              borderCollapse:  'collapse',
              fontSize:        '13px',
            }}
          >
            <thead>
              <tr style={{ background: '#F9FAFB' }}>
                {['Employee', 'Department', 'Leave Type', 'From', 'To', 'Days', 'Status', 'Actions'].map(h => (
                  <th
                    key={h}
                    style={{
                      padding:     '10px 16px',
                      textAlign:   h === 'Days' ? 'center' : 'left',
                      fontWeight:  '600',
                      fontSize:    '12px',
                      color:       '#6B7280',
                      borderBottom:'1px solid #f3f4f6',
                      whiteSpace:  'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }, (_, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    {Array.from({ length: 8 }, (__, j) => (
                      <td key={j} style={{ padding: '14px 16px' }}>
                        <div
                          style={{
                            height:      '14px',
                            background:  '#f3f4f6',
                            borderRadius:'3px',
                            width:       j === 7 ? '80px' : '100%',
                            animation:   'pulse 1.5s ease-in-out infinite',
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    style={{
                      textAlign:  'center',
                      padding:    '48px 24px',
                      color:      '#9CA3AF',
                      fontSize:   '14px',
                    }}
                  >
                    <i class="fas fa-calendar-check" style={{ fontSize: '32px', marginBottom: '12px', display: 'block', color: '#D1D5DB' }} />
                    No leave applications found.
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
              background:   '#fff',
              borderRadius: '12px',
              padding:      '24px 32px',
              fontSize:     '14px',
              color:        '#374151',
              display:      'flex',
              alignItems:   'center',
              gap:          '12px',
            }}
          >
            <i class="fas fa-spinner fa-spin" style={{ color: '#1B2D55' }} />
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
