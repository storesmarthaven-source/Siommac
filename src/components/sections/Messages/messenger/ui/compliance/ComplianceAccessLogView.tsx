/**
 * ComplianceAccessLogView.tsx
 *
 * The Access Log subview: the immutable chain-of-custody ledger. Filters +
 * a metadata-only table. NEVER renders message body, attachment content, or
 * previews (handoff §6.5).
 */

import { useMemo, useState } from 'preact/hooks';
import { useComplianceAccessEvents } from '@api/communicationsCompliance';
import type { ComplianceAccessEvent, ComplianceAccessEventType } from '../../../../../../../types/messagingCompliance';
import {
  Eye, CheckCircle2, FilePlus2, FileText, Download, ShieldX, ScrollText,
} from '../components/icons';

const EVENT_META: Record<ComplianceAccessEventType, { label: string; tone: string; icon: (p: { className?: string }) => preact.VNode }> = {
  case_requested:      { label: 'Case Requested',      tone: 'warn',  icon: FilePlus2 },
  case_approved:       { label: 'Case Approved',       tone: 'ok',    icon: CheckCircle2 },
  case_rejected:       { label: 'Case Rejected',       tone: 'bad',   icon: ShieldX },
  conversation_opened: { label: 'Conversation Opened', tone: 'info',  icon: Eye },
  page_read:           { label: 'Page Read',           tone: 'info',  icon: FileText },
  grant_revoked:       { label: 'Grant Revoked',       tone: 'bad',   icon: ShieldX },
  export_requested:    { label: 'Export Requested',    tone: 'warn',  icon: FileText },
  export_generated:    { label: 'Export Generated',    tone: 'ok',    icon: FileText },
  export_downloaded:   { label: 'Export Downloaded',   tone: 'info',  icon: Download },
  case_closed:         { label: 'Case Closed',         tone: 'muted', icon: ScrollText },
};

const EVENT_FILTERS: { value: '' | ComplianceAccessEventType; label: string }[] = [
  { value: '', label: 'All Event Types' },
  { value: 'conversation_opened', label: 'Conversation Opened' },
  { value: 'case_approved',       label: 'Case Approved' },
  { value: 'case_requested',      label: 'Case Requested' },
  { value: 'export_generated',    label: 'Export Generated' },
  { value: 'export_downloaded',   label: 'Export Downloaded' },
  { value: 'grant_revoked',       label: 'Grant Revoked' },
];

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

export function ComplianceAccessLogView() {
  const [search, setSearch] = useState('');
  const [eventType, setEventType] = useState<'' | ComplianceAccessEventType>('');
  const [caseFilter, setCaseFilter] = useState('');
  const { data, isLoading, isError, refetch } = useComplianceAccessEvents({});

  const events = data?.items ?? [];
  const caseOptions = useMemo(
    () => [...new Set(events.map(e => e.caseNo))].sort(),
    [events],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter(e => {
      if (eventType && e.eventType !== eventType) return false;
      if (caseFilter && e.caseNo !== caseFilter) return false;
      if (q && !(e.caseNo.toLowerCase().includes(q)
        || (e.actor.displayName ?? '').toLowerCase().includes(q)
        || (e.threadSubject ?? '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [events, search, eventType, caseFilter]);

  return (
    <div className="smc-accesslog">
      <div className="smc-filters">
        <label className="smc-search">
          <input
            type="search"
            placeholder="Search case, actor or conversation"
            value={search}
            onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
            aria-label="Search access log"
          />
        </label>
        <select aria-label="Event type" value={eventType} onChange={(e) => setEventType((e.target as HTMLSelectElement).value as '' | ComplianceAccessEventType)}>
          {EVENT_FILTERS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select aria-label="Case" value={caseFilter} onChange={(e) => setCaseFilter((e.target as HTMLSelectElement).value)}>
          <option value="">All Cases</option>
          {caseOptions.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <section className="smc-panel">
        {isError ? (
          <div className="smc-state smc-state--error">
            <strong>Could not load the access log.</strong>
            <button type="button" onClick={() => void refetch()}>Retry</button>
          </div>
        ) : isLoading ? (
          <div className="smc-skeleton">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="smc-skeleton__row" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="smc-state">
            <strong>No events</strong>
            <span>No access events match the current filters.</span>
          </div>
        ) : (
          <table className="smc-table smc-table--log">
            <thead>
              <tr><th>Time</th><th>Event</th><th>Actor</th><th>Case</th><th>Conversation</th><th>Details</th></tr>
            </thead>
            <tbody>
              {filtered.map(ev => <AccessEventRow key={ev.id} ev={ev} />)}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function fmtDetails(details: Record<string, unknown>): string {
  const entries = Object.entries(details);
  if (entries.length === 0) return '—';
  return entries.map(([k, v]) => `${k}: ${String(v)}`).join(' · ');
}

function AccessEventRow({ ev }: { ev: ComplianceAccessEvent }) {
  const meta = EVENT_META[ev.eventType];
  const Icon = meta.icon;
  return (
    <tr className="smc-row smc-row--static">
      <td className="smc-muted">{fmtDateTime(ev.occurredAt)}</td>
      <td><span className={`smc-evpill smc-evpill--${meta.tone}`}><Icon /> {meta.label}</span></td>
      <td>{ev.actor.displayName ?? '—'}</td>
      <td>{ev.caseNo}</td>
      <td>{ev.threadSubject ?? '—'}</td>
      <td className="smc-muted">{fmtDetails(ev.details)}</td>
    </tr>
  );
}
