/**
 * tabs/AuditLogTab.tsx
 *
 * Enterprise audit-log viewer (v2 Settings design). Reads activity_logs with
 * filters (search / action / entity / date range), pagination, and CSV export.
 */

import { type VNode } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import { toast } from '@store/ui';
import { downloadCsv } from '@lib/csv';
import { getAuditLogsApi, type AuditLogRow, type AuditLogFilters } from '@lib/superadminApi';
import { useAuditLogs } from '../hooks';
import { SwzStat } from '@/components/sections/Settings/swzPrimitives';

const PAGE_SIZE = 50;

function fmtWhen(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

/** Map an action verb to a v2 status-pill tone. */
function actionPill(action: string): string {
  if (/delete|revoke|deny|reject/.test(action))              return 'swz-pill red';
  if (/create|add|grant|approve|login|checkin/.test(action)) return 'swz-pill green';
  if (/update|change|edit|reset|checkout/.test(action))      return 'swz-pill amber';
  return 'swz-pill navy';
}

export function AuditLogTab(): VNode {
  const [search,    setSearch]    = useState('');
  const [action,    setAction]    = useState('');
  const [entity,    setEntity]    = useState('');
  const [from,      setFrom]      = useState('');
  const [to,        setTo]        = useState('');
  const [page,      setPage]      = useState(0);
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

  const onFilter = (setter: (v: string) => void) => (v: string) => { setter(v); setPage(0); };

  async function handleExport() {
    setExporting(true);
    try {
      const res = await getAuditLogsApi({ ...filters, limit: 500, offset: 0 });
      let rows: AuditLogRow[] = res.logs ?? [];
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
      <div class="swz-stats">
        <SwzStat ico="fa-clipboard-list" color="#2563eb" val={data.total}           label="Total Events" />
        <SwzStat ico="fa-bolt"           color="#d97706" val={data.actions.length}  label="Action Types" />
        <SwzStat ico="fa-cubes"          color="#7c3aed" val={data.entities.length} label="Entity Types" />
      </div>

      <div class="swz-toolbar">
        <div class="swz-search">
          <i class="fas fa-search" aria-hidden="true" />
          <input type="search" value={search} onInput={e => onFilter(setSearch)((e.target as HTMLInputElement).value)} placeholder="Search details, user, ID…" aria-label="Search audit log" />
        </div>
        <select class="swz-select" value={action} onChange={e => onFilter(setAction)((e.target as HTMLSelectElement).value)} aria-label="Filter by action">
          <option value="">All actions</option>
          {data.actions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select class="swz-select" value={entity} onChange={e => onFilter(setEntity)((e.target as HTMLSelectElement).value)} aria-label="Filter by entity">
          <option value="">All entities</option>
          {data.entities.map(en => <option key={en} value={en}>{en}</option>)}
        </select>
        <input type="date" class="swz-select" value={from} title="From date" onInput={e => onFilter(setFrom)((e.target as HTMLInputElement).value)} aria-label="From date" />
        <input type="date" class="swz-select" value={to} title="To date" onInput={e => onFilter(setTo)((e.target as HTMLInputElement).value)} aria-label="To date" />
        <div class="swz-toolbar-spacer" />
        <button type="button" class="action-btn sm" disabled={exporting} onClick={() => void handleExport()}>
          <i class={exporting ? 'fas fa-spinner fa-spin' : 'fas fa-file-csv'} /> Export CSV
        </button>
      </div>

      {q.isLoading ? (
        <div class="swz-loading"><i class="fas fa-spinner fa-spin" /> Loading audit log…</div>
      ) : q.isError ? (
        <div class="swz-empty"><i class="fas fa-triangle-exclamation" /> Failed to load. <button type="button" class="action-btn sm" style={{ marginTop: '10px' }} onClick={() => void q.refetch()}>Retry</button></div>
      ) : data.logs.length === 0 ? (
        <div class="swz-empty"><i class="fas fa-clipboard-list" /> No audit records match the current filters.</div>
      ) : (
        <div class="swz-tablecard">
          <table class="swz-table">
            <thead><tr>{['When', 'User', 'Action', 'Entity', 'Details', 'IP'].map(h => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {data.logs.map(r => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap', color: '#7a8597' }}>{fmtWhen(r.created_at)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}><b>{r.username || '—'}</b></td>
                  <td><span class={actionPill(r.action)}>{r.action}</span></td>
                  <td style={{ color: '#7a8597' }}>{r.entity}{r.entity_id ? <span class="swz-mono" style={{ marginLeft: '6px' }}>{r.entity_id}</span> : null}</td>
                  <td style={{ maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.details}>{r.details}</td>
                  <td class="swz-mono" style={{ whiteSpace: 'nowrap' }}>{r.ip_address ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div class="swz-pagination">
            <span style={{ color: '#687386', fontSize: '12.5px' }}>{data.total.toLocaleString()} record{data.total === 1 ? '' : 's'}</span>
            <span class="pg">
              <button type="button" disabled={page === 0 || q.isFetching} onClick={() => setPage(p => Math.max(0, p - 1))}><i class="fas fa-chevron-left" /> Previous</button>
              <span><span class="pgnum">{page + 1}</span> <span style={{ color: '#687386' }}>of {totalPages}</span></span>
              <button type="button" disabled={page >= totalPages - 1 || q.isFetching} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}>Next <i class="fas fa-chevron-right" /></button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
