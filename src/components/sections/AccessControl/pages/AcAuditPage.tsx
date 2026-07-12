/**
 * src/components/sections/AccessControl/pages/AcAuditPage.tsx
 *
 * Access Control — Audit Log. Append-only record of privileged actions, in the
 * `.acx` design system. Filter (search / action / entity / date range), paginate,
 * and export the current view to CSV. Wired to useAuditLogs.
 */

import { type VNode } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import { useAuditLogs } from '@sections/SuperadminConsole/hooks';
import type { AuditLogFilters } from '@lib/superadminApi';

const PAGE = 25;
const dateLong = (iso: string) => new Date(iso).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function AcAuditPage(): VNode {
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);

  const filters: AuditLogFilters = useMemo(() => ({
    ...(search ? { search } : {}), ...(action ? { action } : {}), ...(entity ? { entity } : {}),
    ...(from ? { from } : {}), ...(to ? { to } : {}), limit: PAGE, offset: page * PAGE,
  }), [search, action, entity, from, to, page]);

  const q = useAuditLogs(filters, true);
  const logs = q.data?.logs ?? [];
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const hasFilter = !!(search || action || entity || from || to);

  const reset = () => { setSearch(''); setAction(''); setEntity(''); setFrom(''); setTo(''); setPage(0); };
  const exportCsv = () => {
    const head = ['Time', 'User', 'Action', 'Entity', 'Entity ID', 'Details', 'IP'].join(',');
    const rows = logs.map(l => [l.created_at, l.username, l.action, l.entity, l.entity_id, JSON.stringify(l.details ?? ''), l.ip_address ?? ''].map(v => `"${(v ?? '').replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[head, ...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'audit-log.csv'; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div class="acx">
      <div class="page-head between" style={{ alignItems: 'center' }}>
        <div><h1 class="page-title">Audit Log</h1><p class="page-sub">A tamper-evident, append-only record of every privileged action — who did what, when, and from where.</p></div>
        <button class="btn" onClick={exportCsv} disabled={!logs.length}><i class="fas fa-download" /> Export CSV</button>
      </div>

      <div class="toolbar">
        <div class="search"><i class="fas fa-magnifying-glass" /><input placeholder="Search details, user, entity id…" value={search} onInput={e => { setSearch((e.target as HTMLInputElement).value); setPage(0); }} /></div>
        <select class="select" style={{ width: '180px' }} value={action} onChange={e => { setAction((e.target as HTMLSelectElement).value); setPage(0); }}>
          <option value="">All actions</option>
          {(q.data?.actions ?? []).map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select class="select" style={{ width: '160px' }} value={entity} onChange={e => { setEntity((e.target as HTMLSelectElement).value); setPage(0); }}>
          <option value="">All entities</option>
          {(q.data?.entities ?? []).map(e2 => <option key={e2} value={e2}>{e2}</option>)}
        </select>
        <input class="input" type="date" style={{ width: '150px' }} value={from} onInput={e => { setFrom((e.target as HTMLInputElement).value); setPage(0); }} />
        <input class="input" type="date" style={{ width: '150px' }} value={to} onInput={e => { setTo((e.target as HTMLInputElement).value); setPage(0); }} />
        {hasFilter && <button class="btn sm ghost" onClick={reset}><i class="fas fa-xmark" /> Clear</button>}
      </div>

      <div class="card" style={{ overflow: 'hidden' }}>
        {q.isLoading && !q.data ? <div class="ac-loading">Loading…</div>
         : logs.length === 0 ? <div class="ac-empty">No audit records match.</div>
         : (
          <table class="tbl">
            <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>Record</th><th>Details</th><th>IP</th></tr></thead>
            <tbody>
              {(logs as { id: string; created_at: string; username: string; action: string; entity: string; entity_id: string; details: string; ip_address: string | null }[]).map(l => (
                <tr key={l.id}>
                  <td class="sub" style={{ whiteSpace: 'nowrap' }}>{dateLong(l.created_at)}</td>
                  <td style={{ fontWeight: 600 }}>{l.username || '—'}</td>
                  <td><span class="badge grey">{l.action}</span></td>
                  <td class="muted">{l.entity}</td>
                  <td class="mono sub">{l.entity_id}</td>
                  <td class="muted" style={{ maxWidth: '320px', whiteSpace: 'normal' }}>{l.details}</td>
                  <td class="sub mono">{l.ip_address ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div class="u-tbl-foot">
          <span class="muted" style={{ fontSize: '12px' }}>{total} record{total === 1 ? '' : 's'}</span>
          <span class="row" style={{ gap: '4px', marginLeft: 'auto' }}>
            <button class="u-pager-btn" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>‹</button>
            <span class="sub" style={{ padding: '0 8px' }}>Page {page + 1} of {pages}</span>
            <button class="u-pager-btn" disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}>›</button>
          </span>
        </div>
      </div>
    </div>
  );
}
