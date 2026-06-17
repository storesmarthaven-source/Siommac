/**
 * tabs/AuditLogTab.tsx
 *
 * Enterprise audit log viewer. Every privileged action is written to
 * activity_logs by the backend log_() helper (with IP + user-agent). This tab
 * reads them with filters (search / action / entity / user / date range),
 * pagination, and CSV export via the shared @lib/csv utility.
 */

import { type VNode } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import { toast } from '@store/ui';
import { downloadCsv } from '@lib/csv';
import { getAuditLogsApi, type AuditLogRow, type AuditLogFilters } from '@lib/superadminApi';
import { useAuditLogs } from '../hooks';

const PAGE_SIZE = 50;

function fmtWhen(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

/** A coloured chip for the action verb. */
function actionTone(action: string): { bg: string; color: string } {
  if (/delete|revoke|deny|reject/.test(action))        return { bg: 'rgba(228,12,12,0.10)', color: 'var(--siomac-red)' };
  if (/create|add|grant|approve|login|checkin/.test(action)) return { bg: 'rgba(46,125,50,0.12)', color: '#1b5e20' };
  if (/update|change|edit|reset|checkout/.test(action)) return { bg: 'rgba(255,183,18,0.16)', color: '#7a5900' };
  return { bg: 'var(--bg-subtle)', color: 'var(--text-muted)' };
}

export function AuditLogTab(): VNode {
  const [search,   setSearch]   = useState('');
  const [action,   setAction]   = useState('');
  const [entity,   setEntity]   = useState('');
  const [from,     setFrom]     = useState('');
  const [to,       setTo]       = useState('');
  const [page,     setPage]     = useState(0);
  const [exporting, setExporting] = useState(false);

  const filters: AuditLogFilters = useMemo(() => ({
    search: search || undefined,
    action: action || undefined,
    entity: entity || undefined,
    from:   from ? new Date(from).toISOString() : undefined,
    to:     to   ? new Date(`${to}T23:59:59`).toISOString() : undefined,
    limit:  PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }), [search, action, entity, from, to, page]);

  const q = useAuditLogs(filters, true);
  const data = q.data ?? { logs: [], total: 0, actions: [], entities: [] };
  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  // Reset to page 0 whenever a filter changes.
  function onFilter(setter: (v: string) => void) {
    return (v: string) => { setter(v); setPage(0); };
  }

  // Export the CURRENT filter set (up to 5000 rows) to CSV.
  async function handleExport() {
    setExporting(true);
    try {
      const res = await getAuditLogsApi({ ...filters, limit: 500, offset: 0 });
      let rows: AuditLogRow[] = res.logs ?? [];
      // Page through the rest up to a sane cap.
      let offset = 500;
      while ((res.total ?? 0) > offset && offset < 5000) {
        const more = await getAuditLogsApi({ ...filters, limit: 500, offset });
        rows = rows.concat(more.logs ?? []);
        offset += 500;
      }
      if (rows.length === 0) { toast.error('Nothing to export for this filter.'); return; }
      downloadCsv(`audit-log-${new Date().toISOString().slice(0, 10)}.csv`, rows, [
        { header: 'Timestamp', value: r => fmtWhen(r.created_at) },
        { header: 'User',      value: r => r.username },
        { header: 'Action',    value: r => r.action },
        { header: 'Entity',    value: r => r.entity },
        { header: 'Entity ID', value: r => r.entity_id },
        { header: 'Details',   value: r => r.details },
        { header: 'IP',        value: r => r.ip_address ?? '' },
        { header: 'User Agent',value: r => r.user_agent ?? '' },
      ]);
      toast.success(`Exported ${rows.length} record${rows.length === 1 ? '' : 's'}.`);
    } catch {
      toast.error('Export failed. Try again.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '14px' }}>
        <div class="emp-search-box" style={{ margin: 0, flex: '1 1 200px' }}>
          <i class="fas fa-search" aria-hidden="true" />
          <input type="search" value={search} onInput={e => onFilter(setSearch)((e.target as HTMLInputElement).value)} placeholder="Search details, user, ID…" aria-label="Search audit log" />
        </div>
        <select class="emp-filter-select" value={action} onChange={e => onFilter(setAction)((e.target as HTMLSelectElement).value)} aria-label="Filter by action">
          <option value="">All actions</option>
          {data.actions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select class="emp-filter-select" value={entity} onChange={e => onFilter(setEntity)((e.target as HTMLSelectElement).value)} aria-label="Filter by entity">
          <option value="">All entities</option>
          {data.entities.map(en => <option key={en} value={en}>{en}</option>)}
        </select>
        <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>From<br /><input type="date" value={from} onInput={e => onFilter(setFrom)((e.target as HTMLInputElement).value)} class="emp-filter-select" /></label>
        <label style={{ fontSize: '12px', color: 'var(--text-muted)' }}>To<br /><input type="date" value={to} onInput={e => onFilter(setTo)((e.target as HTMLInputElement).value)} class="emp-filter-select" /></label>
        <button type="button" class="btn btn-sm btn-outline-secondary has-label" disabled={exporting} onClick={() => void handleExport()}>
          <i class={exporting ? 'fas fa-spinner fa-spin' : 'fas fa-file-csv'} /> Export CSV
        </button>
      </div>

      {q.isLoading ? (
        <div class="emp-loading"><i class="fas fa-spinner fa-spin" /> Loading audit log…</div>
      ) : q.isError ? (
        <div class="emp-loading emp-err"><i class="fas fa-exclamation-triangle" /> Failed to load. <button type="button" onClick={() => void q.refetch()} style={{ color: 'var(--siomac-navy)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}>Retry</button></div>
      ) : data.logs.length === 0 ? (
        <div class="emp-empty"><i class="fas fa-clipboard-list" /><p>No audit records match the current filters.</p></div>
      ) : (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: 'var(--bg-subtle)', textAlign: 'left' }}>
                  {['When', 'User', 'Action', 'Entity', 'Details', 'IP'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.logs.map(r => {
                  const tone = actionTone(r.action);
                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '9px 14px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{fmtWhen(r.created_at)}</td>
                      <td style={{ padding: '9px 14px', whiteSpace: 'nowrap', fontWeight: '600' }}>{r.username || '—'}</td>
                      <td style={{ padding: '9px 14px' }}><span style={{ background: tone.bg, color: tone.color, padding: '2px 9px', borderRadius: '40px', fontSize: '11.5px', fontWeight: '600', whiteSpace: 'nowrap' }}>{r.action}</span></td>
                      <td style={{ padding: '9px 14px', color: 'var(--text-muted)' }}>{r.entity}{r.entity_id ? <span style={{ fontFamily: 'monospace', marginLeft: '6px', fontSize: '11px' }}>{r.entity_id}</span> : null}</td>
                      <td style={{ padding: '9px 14px', maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.details}>{r.details}</td>
                      <td style={{ padding: '9px 14px', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '11px' }}>{r.ip_address ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderTop: '1px solid var(--border)', background: 'var(--bg-subtle)' }}>
            <span class="stg-switch-desc" style={{ margin: 0 }}>
              {data.total.toLocaleString()} record{data.total === 1 ? '' : 's'} · page {page + 1} of {totalPages}
            </span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button type="button" class="btn btn-sm btn-outline-secondary" disabled={page === 0 || q.isFetching} onClick={() => setPage(p => Math.max(0, p - 1))} aria-label="Previous page"><i class="fas fa-chevron-left" /></button>
              <button type="button" class="btn btn-sm btn-outline-secondary" disabled={page >= totalPages - 1 || q.isFetching} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} aria-label="Next page"><i class="fas fa-chevron-right" /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
