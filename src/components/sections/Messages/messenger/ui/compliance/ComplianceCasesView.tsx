/**
 * ComplianceCasesView.tsx
 *
 * The Cases subview: the four operational summary cards (backend summary/get) +
 * the Investigation Cases register on the left, and the selected-case detail rail
 * on the right. Metadata only — no message content. Commands are gated by
 * server-authored capabilities (never inferred).
 */

import { useMemo, useState } from 'preact/hooks';
import { useComplianceCases, useComplianceCase, useComplianceSummary } from '@api/communicationsCompliance';
import type { ComplianceCaseSummary, ComplianceCaseStatus, ComplianceCaseType } from '../../../../../../../types/messagingCompliance';
import { KpiTile } from '@ui';
import { useComplianceState } from './ComplianceState';
import { DecideComplianceCaseDialog, CloseComplianceCaseDialog } from './ComplianceActionDialogs';
import { Search, MessageSquare, Clock3, CheckCircle2, ShieldCheck, ShieldX, LockKeyhole, X, type IconProps } from '../components/icons';

type StatusFilter = 'all' | 'pending' | 'approved' | 'expiring';
const STATUS_FILTER_LABEL: Record<Exclude<StatusFilter, 'all'>, string> = {
  pending: 'Pending approval', approved: 'Approved', expiring: 'Expiring soon',
};

const TYPE_LABEL: Record<ComplianceCaseType, string> = {
  hr_investigation:           'HR Investigation',
  safety_investigation:       'Safety Investigation',
  legal_request:              'Legal / Regulatory',
  security_investigation:     'Security Investigation',
  other_formal_investigation: 'Other Investigation',
};

const STATUS_LABEL: Record<ComplianceCaseStatus, string> = {
  pending_approval: 'Pending', approved: 'Approved', rejected: 'Rejected', closed: 'Closed',
};

const STATUS_ICON: Record<ComplianceCaseStatus, (props: IconProps) => preact.VNode> = {
  pending_approval: Clock3, approved: CheckCircle2, rejected: ShieldX, closed: LockKeyhole,
};

function statusTone(s: ComplianceCaseStatus): string {
  if (s === 'approved') return 'ok';
  if (s === 'pending_approval') return 'warn';
  if (s === 'rejected') return 'bad';
  return 'muted';
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function relShort(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'Now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Grant considered "expiring" within 24h. Kept out of render (impure `Date.now`). */
function isExpiringSoon(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() - Date.now() < 24 * 3600_000;
}

function isExpired(validUntil: string): boolean {
  return new Date(validUntil).getTime() <= Date.now();
}

export function ComplianceCasesView() {
  const { selectedCaseId, setSelectedCaseId, setSubview } = useComplianceState();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const { data, isLoading, isError, refetch } = useComplianceCases({});
  const { data: summary, isLoading: summaryLoading } = useComplianceSummary();

  const cases = data?.items ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cases.filter(c => {
      const matchesText = !q || c.caseNo.toLowerCase().includes(q) || c.title.toLowerCase().includes(q);
      const matchesStatus =
        statusFilter === 'pending'  ? c.status === 'pending_approval' :
        // "Active Cases" KPI semantics: approved AND unexpired (server counts the
        // full dataset; this client filter only sees the loaded page — see #6).
        statusFilter === 'approved' ? (c.status === 'approved' && !isExpired(c.validUntil)) :
        statusFilter === 'expiring' ? (c.status === 'approved' && isExpiringSoon(c.validUntil)) :
        true;
      return matchesText && matchesStatus;
    });
  }, [cases, search, statusFilter]);

  const selected = filtered.find(c => c.id === selectedCaseId)
    ?? cases.find(c => c.id === selectedCaseId)
    ?? null;

  const kpiLoading = summaryLoading && !summary;

  return (
    <div className="smc-cases">
      <div className="smc-cases__main">
        <div className="smc-stats">
          <KpiTile icon="fa-folder-open" tone="blue" label="Active Cases" value={summary?.activeCases ?? 0} sub="Approved & active" loading={kpiLoading}
            link={{ label: 'View active', onClick: () => setStatusFilter('approved') }} />
          <KpiTile icon="fa-clock" tone="amber" label="Pending Approval" value={summary?.pendingApprovalCases ?? 0} sub="Awaiting decision" loading={kpiLoading}
            link={{ label: 'Review pending', onClick: () => setStatusFilter('pending') }} />
          <KpiTile icon="fa-triangle-exclamation" tone="coral" label="Expiring Within 24h" value={summary?.expiringWithin24Hours ?? 0} sub="Grants ending soon" loading={kpiLoading}
            link={{ label: 'View expiring', onClick: () => setStatusFilter('expiring') }} />
          <KpiTile icon="fa-file-export" tone="teal" label="Exports This Month" value={summary?.exportsThisMonth ?? 0} sub="Evidence generated" loading={kpiLoading}
            link={{ label: 'View access log', onClick: () => setSubview('access-log') }} />
        </div>

        <section className="smc-panel">
          <header className="smc-panel__head">
            <div>
              <strong>Investigation Cases</strong>
              <span>Formal cases requesting access to selected conversations.</span>
            </div>
            <div className="smc-panel__tools">
              {statusFilter !== 'all' ? (
                <button type="button" className="smc-filterchip" onClick={() => setStatusFilter('all')} aria-label="Clear status filter">
                  {STATUS_FILTER_LABEL[statusFilter]} <X />
                </button>
              ) : null}
              <label className="smc-search">
                <Search />
                <input
                  type="search"
                  placeholder="Search case number or title"
                  value={search}
                  onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
                  aria-label="Search cases"
                />
              </label>
            </div>
          </header>

          {isError ? (
            <div className="smc-state smc-state--error">
              <strong>Could not load cases.</strong>
              <button type="button" onClick={() => void refetch()}>Retry</button>
            </div>
          ) : isLoading ? (
            <CaseTableSkeleton />
          ) : filtered.length === 0 ? (
            <div className="smc-state">
              <strong>No cases</strong>
              <span>{search || statusFilter !== 'all' ? 'No cases match the current filter.' : 'No investigation cases yet.'}</span>
            </div>
          ) : (
            <table className="smc-table">
              <thead>
                <tr>
                  <th>Case</th><th>Type</th><th>Requester</th><th>Status</th>
                  <th className="smc-num">Conversations</th><th>Valid Until</th><th>Last Activity</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr
                    key={c.id}
                    tabIndex={0}
                    aria-selected={c.id === selectedCaseId}
                    className={`smc-row${c.id === selectedCaseId ? ' is-selected' : ''}`}
                    onClick={() => setSelectedCaseId(c.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedCaseId(c.id); } }}
                  >
                    <td>
                      <div className="smc-cell-case"><strong>{c.caseNo}</strong><span>{c.title}</span></div>
                    </td>
                    <td>{TYPE_LABEL[c.caseType]}</td>
                    <td>{c.requestedBy.displayName ?? '—'}</td>
                    <td><StatusPill status={c.status} /></td>
                    <td className="smc-num">{c.conversationCount}</td>
                    <td>{fmtDate(c.validUntil)}</td>
                    <td className="smc-muted">{relShort(c.lastActivityAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <ComplianceCaseDetailRail summary={selected} />
    </div>
  );
}

function StatusPill({ status }: { status: ComplianceCaseStatus }) {
  const Icon = STATUS_ICON[status];
  return <span className={`smc-pill smc-pill--${statusTone(status)}`}><Icon /> {STATUS_LABEL[status]}</span>;
}

function CaseTableSkeleton() {
  return (
    <div className="smc-skeleton" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => <div key={i} className="smc-skeleton__row" />)}
    </div>
  );
}

// ── Detail rail ─────────────────────────────────────────────────────────────

function ComplianceCaseDetailRail({ summary }: { summary: ComplianceCaseSummary | null }) {
  const { openConversations } = useComplianceState();
  const { data: detail } = useComplianceCase(summary?.id ?? null);
  const [decideOpen, setDecideOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);

  if (!summary) {
    return (
      <aside className="smc-detail smc-detail--empty" aria-label="Case detail">
        <span className="smc-detail__emptyicon"><ShieldCheck /></span>
        <strong>Select a case</strong>
        <span>Choose an investigation to view its approval, scope, and access.</span>
      </aside>
    );
  }

  // Commands are derived from server-authored capabilities + status only.
  const caps = summary.capabilities;
  const canApprove = caps.canApproveCase && summary.status === 'pending_approval';
  const canClose = caps.canApproveCase && summary.status === 'approved';
  const canOpen = caps.canReadConversation && summary.status === 'approved';

  return (
    <aside className="smc-detail" aria-label={`Case ${summary.caseNo}`}>
      <StatusPill status={summary.status} />
      <h3 className="smc-detail__no">{summary.caseNo}</h3>
      <p className="smc-detail__summary">{detail?.reason ?? summary.title}</p>

      <section className="smc-detail__block">
        <h4>Approval</h4>
        <dl className="smc-kv">
          <dt>Requested By</dt><dd>{summary.requestedBy.displayName ?? '—'}</dd>
          <dt>Approved By</dt><dd>{summary.approvedBy?.displayName ?? '—'}</dd>
          <dt>Valid Until</dt><dd>{fmtDate(summary.validUntil)}</dd>
        </dl>
      </section>

      <section className="smc-detail__block">
        <h4>Scoped Conversations</h4>
        {detail
          ? (detail.threads.length === 0
              ? <p className="smc-muted">No conversations attached.</p>
              : <ul className="smc-scoped">
                  {detail.threads.map(t => {
                    const grant = detail.grants.find(g => g.threadId === t.threadId);
                    return (
                      <li key={t.id}>
                        <span className="smc-scoped__ic"><MessageSquare /></span>
                        <strong className="smc-scoped__title">{t.subject ?? 'Untitled conversation'}</strong>
                        <GrantPill status={grant?.status ?? 'none'} expiresAt={grant?.expiresAt ?? null} />
                      </li>
                    );
                  })}
                </ul>)
          : <p className="smc-muted">{summary.conversationCount} scoped conversation(s).</p>}
      </section>

      <div className="smc-detail__actions">
        {canApprove ? (
          <button type="button" className="smc-btn smc-btn--primary" onClick={() => setDecideOpen(true)}>Approve / Reject</button>
        ) : null}
        {canOpen ? (
          <button type="button" className="smc-btn smc-btn--primary smc-detail__open" onClick={() => openConversations(summary.id)}>
            <MessageSquare /> Open Conversations
          </button>
        ) : null}
        {canClose ? (
          <button type="button" className="smc-btn smc-btn--danger" onClick={() => setCloseOpen(true)}>Close case</button>
        ) : null}
      </div>

      <DecideComplianceCaseDialog open={decideOpen} caseId={summary.id} caseNo={summary.caseNo} onClose={() => setDecideOpen(false)} />
      <CloseComplianceCaseDialog open={closeOpen} caseId={summary.id} caseNo={summary.caseNo} onClose={() => setCloseOpen(false)} />
    </aside>
  );
}

function GrantPill({ status, expiresAt }: { status: string; expiresAt: string | null }) {
  if (status === 'active') {
    const soon = isExpiringSoon(expiresAt);
    return soon
      ? <span className="smc-gpill smc-gpill--warn"><Clock3 /> Expiring</span>
      : <span className="smc-gpill smc-gpill--ok"><CheckCircle2 /> Active</span>;
  }
  if (status === 'expired') return <span className="smc-gpill smc-gpill--muted"><Clock3 /> Expired</span>;
  if (status === 'revoked') return <span className="smc-gpill smc-gpill--bad">Revoked</span>;
  return <span className="smc-gpill smc-gpill--muted">None</span>;
}
