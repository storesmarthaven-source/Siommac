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

/** Map an action verb to a VANTUS status-pill tone class. */
function actionPill(action: string): string {
  if (/delete|revoke|deny|reject/.test(action))              return 'vt-pill is-off';
  if (/create|add|grant|approve|login|checkin/.test(action)) return 'vt-pill is-on';
  if (/update|change|edit|reset|checkout/.test(action))      return 'vt-pill is-warn';
  return 'vt-pill is-info';
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
      {/* Toolbar */}
      <div class="vt-toolbar">
        <div class="vt-search" style={{ flex: '1 1 240px' }}>
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
        <div class="vt-table-card">
          <div class="vt-table-scroll">
            <table class="vt-table">
              <thead>
                <tr>
                  {['When', 'User', 'Action', 'Entity', 'Details', 'IP'].map(h => <th key={h}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.logs.map(r => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{fmtWhen(r.created_at)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}><span class="vt-cell-name">{r.username || '—'}</span></td>
                    <td><span class={actionPill(r.action)}>{r.action}</span></td>
                    <td style={{ color: 'var(--text-muted)' }}>{r.entity}{r.entity_id ? <span class="vt-cell-mono" style={{ marginLeft: '6px' }}>{r.entity_id}</span> : null}</td>
                    <td style={{ maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.details}>{r.details}</td>
                    <td class="vt-cell-mono" style={{ whiteSpace: 'nowrap' }}>{r.ip_address ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div class="vt-pagination" style={{ justifyContent: 'space-between', padding: '12px 16px', borderTop: '1px solid var(--border)', marginTop: 0 }}>
            <span class="vt-result-count" style={{ margin: 0 }}>
              {data.total.toLocaleString()} record{data.total === 1 ? '' : 's'}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '14px' }}>
              <button type="button" disabled={page === 0 || q.isFetching} onClick={() => setPage(p => Math.max(0, p - 1))}>
                <i class="fas fa-chevron-left" /> Previous
              </button>
              <span class="vt-pagination-page">{page + 1}</span>
              <span style={{ color: 'var(--text-muted)' }}>out of {totalPages}</span>
              <button type="button" disabled={page >= totalPages - 1 || q.isFetching} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}>
                Next <i class="fas fa-chevron-right" />
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
