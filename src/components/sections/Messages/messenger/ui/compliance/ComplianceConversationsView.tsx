/**
 * ComplianceConversationsView.tsx
 *
 * The Conversations subview: a 3-column read-only operational workspace —
 *   1. approved-case selector + its scoped conversations
 *   2. the audited read-only message timeline (the ONLY place body text appears)
 *   3. the case / grant / recent-access context rail
 *
 * No composer, reactions, replies, forwarding, pinning, delete, participant
 * editing, or attachment download (contract §6.4). Reads use the compliance read
 * hook only. Export/Revoke are gated by server-authored capabilities.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  useComplianceCases, useComplianceCase, useComplianceConversation, useComplianceAccessEvents,
} from '@api/communicationsCompliance';
import type { ComplianceMessage } from '../../../../../../../types/messagingCompliance';
import { useComplianceState } from './ComplianceState';
import { ComplianceExportDialog, RevokeComplianceGrantDialog } from './ComplianceActionDialogs';
import {
  LockKeyhole, Download, MessageSquare, Clock3, CheckCircle2, ShieldX, Eye, ArrowUpRight, Search, Paperclip,
} from '../components/icons';

function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}
function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}
function fmtExpiry(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}
function fmtSize(bytes: number | null): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ComplianceConversationsView() {
  const { selectedCaseId, setSelectedCaseId, selectedThreadId, setSelectedThreadId } = useComplianceState();
  const { data: casesData } = useComplianceCases({});
  const [exportOpen, setExportOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);

  // Only cases whose capability says at least one thread is readable.
  const openCases = useMemo(
    () => (casesData?.items ?? []).filter(c => c.status === 'approved' && c.capabilities.canReadConversation),
    [casesData],
  );

  // Auto-select the first readable case when arriving without a selection.
  useEffect(() => {
    if (!selectedCaseId && openCases.length > 0) setSelectedCaseId(openCases[0]!.id);
  }, [selectedCaseId, openCases, setSelectedCaseId]);

  const { data: detail } = useComplianceCase(selectedCaseId);
  const threads = detail?.threads ?? [];

  // A thread is readable only when ITS grant carries canReadConversation. A
  // case-level capability just means SOME grant exists, not one per thread.
  const readableThreadIds = useMemo(
    () => threads
      .filter(t => detail?.grants.find(g => g.threadId === t.threadId)?.capabilities.canReadConversation)
      .map(t => t.threadId),
    [detail, threads],
  );

  // Auto-select the first READABLE conversation once a case's detail loads.
  useEffect(() => {
    if (detail && readableThreadIds.length > 0 && !(selectedThreadId && readableThreadIds.includes(selectedThreadId))) {
      setSelectedThreadId(readableThreadIds[0]!);
    }
  }, [detail, readableThreadIds, selectedThreadId, setSelectedThreadId]);

  // Never attempt a read on a locked/revoked thread — it would 403.
  const readableSelected = selectedThreadId && readableThreadIds.includes(selectedThreadId) ? selectedThreadId : null;
  const { data: page, isLoading: pageLoading } = useComplianceConversation(readableSelected ? selectedCaseId : null, readableSelected);
  const { data: eventsData } = useComplianceAccessEvents(selectedCaseId ? { caseId: selectedCaseId } : {});
  const activeThread = threads.find(t => t.threadId === selectedThreadId) ?? null;
  const activeTitle = page?.thread.subject ?? activeThread?.subject ?? 'Conversation';

  if (openCases.length === 0) {
    return (
      <div className="smc-placeholder">
        <span className="smc-placeholder__icon"><LockKeyhole /></span>
        <strong>No approved investigations</strong>
        <span>Approve a case in the Cases view to read its scoped conversations here.</span>
      </div>
    );
  }

  return (
    <div className="smc-conv">
      {/* ── Left rail ── */}
      <aside className="smc-conv__rail" aria-label="Approved investigation">
        <span className="smc-conv__raillabel">Approved Investigation</span>
        <select
          className="smc-conv__caseselect"
          aria-label="Select investigation"
          value={selectedCaseId ?? ''}
          onChange={(e) => { setSelectedCaseId((e.target as HTMLSelectElement).value); setSelectedThreadId(null); }}
        >
          {openCases.map(c => <option key={c.id} value={c.id}>{c.caseNo} — {c.title}</option>)}
        </select>
        {detail ? (
          <div className="smc-conv__grantline">
            <span className="smc-muted">Expires {fmtExpiry(detail.validUntil)}</span>
          </div>
        ) : null}
        <label className="smc-search smc-conv__search"><Search /><input type="search" placeholder="Search selected conversations" aria-label="Search conversations" /></label>
        <span className="smc-conv__raillabel">Scoped Conversations</span>
        <ul className="smc-conv__list">
          {threads.map(t => {
            const grant = detail?.grants.find(g => g.threadId === t.threadId);
            const readable = readableThreadIds.includes(t.threadId);
            return (
              <ConversationRailItem
                key={t.id}
                title={t.subject ?? 'Untitled conversation'}
                subtitle={[t.threadType, t.sourceModule].filter(Boolean).join(' · ')}
                grantStatus={grant?.status ?? 'none'}
                readable={readable}
                active={t.threadId === selectedThreadId}
                onSelect={() => { if (readable) setSelectedThreadId(t.threadId); }}
              />
            );
          })}
        </ul>
      </aside>

      {/* ── Center: read-only timeline ── */}
      <section className="smc-conv__main" aria-label="Audited conversation">
        <header className="smc-conv__header">
          <div className="smc-conv__title">
            <span className="smc-conv__avatar"><MessageSquare /></span>
            <div>
              <strong>{activeTitle}</strong>
              <span>{page ? `${page.thread.threadType} · read-only evidence view` : 'read-only evidence view'}</span>
            </div>
          </div>
          <div className="smc-conv__headeractions">
            <span className="smc-conv__audited"><LockKeyhole /> Audited Access</span>
            <button type="button" className="smc-btn smc-btn--primary smc-btn--sm" disabled={!page?.capabilities.canExport} onClick={() => setExportOpen(true)}>
              <Download /> Export
            </button>
          </div>
        </header>

        <div className="smc-conv__banner">
          <CheckCircle2 />
          <span>Access granted under {detail?.caseNo ?? '—'}. Every page view is recorded.</span>
          <span className="smc-conv__remaining">{page?.grant.expiresAt ? `Expires ${fmtExpiry(page.grant.expiresAt)}` : ''}</span>
        </div>

        <div className="smc-conv__timeline" aria-live="polite">
          {pageLoading ? (
            <div className="smc-skeleton">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="smc-skeleton__row" style="height:64px" />)}</div>
          ) : !page ? (
            <div className="smc-state"><strong>No readable content</strong><span>This conversation has no messages in the granted scope.</span></div>
          ) : (
            <ComplianceTimeline messages={page.messages} />
          )}
        </div>

        <footer className="smc-conv__footer">
          <span><Eye /> Read-only compliance view · no replies or message actions</span>
          {page ? <span className="smc-muted">{page.messages.length} message{page.messages.length === 1 ? '' : 's'}{page.nextCursor ? ' · more available' : ''}</span> : null}
        </footer>
      </section>

      {/* ── Right rail: case + grant + recent access ── */}
      <aside className="smc-conv__context" aria-label="Case and access context">
        <div className="smc-conv__ctxhead">
          <h4>Investigation Case</h4>
          {detail ? <span className={`smc-pill smc-pill--${detail.status === 'rejected' ? 'bad' : detail.status === 'pending_approval' ? 'warn' : 'ok'}`}>{detail.status === 'approved' ? 'Approved' : detail.status}</span> : null}
        </div>
        {detail ? (
          <>
            <dl className="smc-kv">
              <dt>Case</dt><dd>{detail.caseNo}</dd>
              <dt>Type</dt><dd>{detail.caseType.replace(/_/g, ' ')}</dd>
              <dt>Requested By</dt><dd>{detail.requestedBy.displayName ?? '—'}</dd>
              <dt>Approved By</dt><dd>{detail.approvedBy?.displayName ?? '—'}</dd>
              <dt>Reason</dt><dd>{detail.reason}</dd>
            </dl>

            <section className="smc-detail__block">
              <h4>Access Grant</h4>
              <div className="smc-conv__grantcard">
                <strong><CheckCircle2 /> Active Until {fmtExpiry(page?.grant.expiresAt ?? detail.validUntil)}</strong>
                <span>Granted for this case and conversation only. Access expires automatically.</span>
              </div>
            </section>

            <section className="smc-detail__block">
              <div className="smc-conv__ctxhead"><h4>Recent Access</h4><ArrowUpRight /></div>
              <ul className="smc-conv__events">
                {(eventsData?.items ?? []).slice(0, 4).map(ev => (
                  <li key={ev.id}>
                    <span className="smc-conv__evic"><Eye /></span>
                    <span className="smc-conv__evmain"><strong>{ev.eventType.replace(/_/g, ' ')}</strong><small>{ev.actor.displayName ?? '—'}</small></span>
                  </li>
                ))}
              </ul>
            </section>

            <button type="button" className="smc-btn smc-btn--danger smc-conv__revoke" disabled={!page?.grant.capabilities.canRevokeGrant} onClick={() => setRevokeOpen(true)}>
              <ShieldX /> Revoke Access
            </button>
          </>
        ) : (
          <div className="smc-state"><span>Loading case…</span></div>
        )}
      </aside>

      {selectedCaseId && selectedThreadId ? (
        <>
          <ComplianceExportDialog open={exportOpen} caseId={selectedCaseId} caseNo={detail?.caseNo ?? ''} threadId={selectedThreadId} conversationTitle={activeTitle} onClose={() => setExportOpen(false)} />
          <RevokeComplianceGrantDialog open={revokeOpen} grantId={page?.grant.id ?? ''} conversationTitle={activeTitle} onClose={() => setRevokeOpen(false)} />
        </>
      ) : null}
    </div>
  );
}

function ConversationRailItem(
  { title, subtitle, grantStatus, readable, active, onSelect }:
  { title: string; subtitle: string; grantStatus: string; readable: boolean; active: boolean; onSelect: () => void },
) {
  const state = !readable ? 'Locked' : grantStatus === 'active' ? 'Access active' : grantStatus === 'expired' ? 'Expired' : grantStatus === 'revoked' ? 'Revoked' : 'No grant';
  const tone = !readable ? 'muted' : grantStatus === 'active' ? 'ok' : grantStatus === 'expired' ? 'warn' : 'muted';
  return (
    <li>
      <button
        type="button"
        className={`smc-conv__listitem${active ? ' is-active' : ''}${readable ? '' : ' is-locked'}`}
        onClick={onSelect}
        disabled={!readable}
        aria-current={active}
        title={readable ? undefined : 'No active grant for this conversation'}
      >
        <span className="smc-conv__listic">{readable ? <MessageSquare /> : <LockKeyhole />}</span>
        <span className="smc-conv__listmain">
          <strong>{title}</strong>
          <small>{subtitle}</small>
          <span className={`smc-gpill smc-gpill--${tone}`}>
            {!readable ? <LockKeyhole /> : grantStatus === 'active' ? <CheckCircle2 /> : <Clock3 />} {state}
          </span>
        </span>
      </button>
    </li>
  );
}

function ComplianceTimeline({ messages }: { messages: ComplianceMessage[] }) {
  return (
    <>
      {messages.map((m, i) => {
        const day = fmtDay(m.createdAt);
        const showDivider = i === 0 || fmtDay(messages[i - 1]!.createdAt) !== day;
        return (
          <div key={m.id}>
            {showDivider ? <div className="smc-conv__divider"><span>{day}</span></div> : null}
            <ComplianceMessageRow m={m} />
          </div>
        );
      })}
    </>
  );
}

function ComplianceMessageRow({ m }: { m: ComplianceMessage }) {
  const authorName = m.isSystem ? 'System' : (m.author?.displayName ?? 'Unknown');
  if (m.deletedAt) {
    return (
      <article className="smc-conv__msg">
        <span className="smc-conv__msgav">{authorName.charAt(0)}</span>
        <div className="smc-conv__msgbody"><div className="smc-conv__deleted">This message was deleted.</div></div>
      </article>
    );
  }
  return (
    <article className="smc-conv__msg">
      <span className="smc-conv__msgav">{authorName.charAt(0)}</span>
      <div className="smc-conv__msgbody">
        <header><strong>{authorName}</strong><time>{fmtClock(m.createdAt)}</time>{m.editedAt ? <em className="smc-conv__edited">· edited</em> : null}</header>
        {m.body ? <div className="smc-conv__bubble">{m.body}</div> : null}
        {m.attachments.map((a, i) => (
          <div key={i} className="smc-conv__attach">
            <span className="smc-conv__attachic"><Paperclip /></span>
            <span className="smc-conv__attachmain"><strong>{a.fileName}</strong><small>{[a.contentType?.split('/').pop()?.toUpperCase(), fmtSize(a.sizeBytes), 'metadata only in compliance view'].filter(Boolean).join(' · ')}</small></span>
          </div>
        ))}
      </div>
    </article>
  );
}
