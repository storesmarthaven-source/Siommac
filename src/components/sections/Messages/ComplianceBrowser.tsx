/**
 * src/components/sections/Messages/ComplianceBrowser.tsx
 *
 * Compliance thread browser — lets a holder of communications.compliance_read
 * DISCOVER threads they don't participate in (search by subject or participant).
 * Results are metadata only. Selecting a thread opens it in the conversation pane,
 * where the audited read-gate decides: participant/record → opens; otherwise the
 * "Request Access" compliance flow appears. Nothing here reveals message content.
 */

import { useState } from 'preact/hooks';
import type { VNode } from 'preact';
import { useComplianceThreadSearch, type ComplianceThreadRow, type MessageThreadListItem } from '@api/communications';

/** Synthesize a list-item shape from a compliance row so it can open in Conversation. */
export function complianceRowToThread(r: ComplianceThreadRow): MessageThreadListItem {
  return {
    id:               r.threadId,
    threadType:       r.threadType,
    subject:          r.subject,
    sourceModule:     r.sourceModule,
    sourceEntityType: r.sourceEntityType,
    sourceEntityId:   r.sourceEntityId,
    createdBy:        null,
    createdAt:        r.lastPostAt ?? '',
    lastPostAt:       r.lastPostAt,
    lastPostPreview:  null,
    lastPostBy:       null,
    unreadCount:      0,
    participantCount: r.participantCount,
    participants:     r.participantNames.map((n, i) => ({
      userId: `c-${i}`, displayName: n, email: null, role: 'participant',
    })),
    isArchived:       false,
    myRole:           r.isParticipant ? 'participant' : 'viewer',
  };
}

function typeLabel(t: string): string {
  return t === 'group' ? 'Group' : t === 'record' ? 'Record' : t === 'system' ? 'System' : 'Direct';
}

function relTime(iso: string | null): string {
  if (!iso) return '—';
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.round(d / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export function ComplianceBrowser({ selectedId, onSelect }: {
  selectedId: string | null;
  onSelect:   (t: MessageThreadListItem) => void;
}): VNode {
  const [q, setQ] = useState('');
  const { data: rows = [], isLoading } = useComplianceThreadSearch(q);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Banner */}
      <div style={{ margin: '12px 12px 8px', padding: '9px 11px', borderRadius: '9px', flexShrink: 0,
        background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.35)',
        display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
        <i class="fas fa-user-shield" style={{ color: '#b45309', marginTop: '1px' }} />
        <div style={{ fontSize: '0.72rem', color: 'var(--text)' }}>
          Compliance view. Opening a thread you're not part of requires audited access.
        </div>
      </div>

      {/* Search */}
      <div class="vt-search" style={{ margin: '0 12px 10px', flexShrink: 0 }}>
        <i class="fas fa-search" />
        <input type="search" placeholder="Search all threads — subject or person…" value={q}
          onInput={e => setQ((e.target as HTMLInputElement).value)} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {isLoading && (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>Searching…</div>
        )}
        {!isLoading && rows.length === 0 && (
          <div style={{ padding: '32px 16px', textAlign: 'center' }}>
            <i class="fas fa-magnifying-glass" style={{ fontSize: '1.5rem', color: 'var(--text-muted)', opacity: 0.4 }} />
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '10px' }}>
              {q ? 'No threads match this search.' : 'No threads found.'}
            </div>
          </div>
        )}
        {rows.map(r => {
          const isSelected = r.threadId === selectedId;
          const names = r.participantNames.length
            ? r.participantNames.slice(0, 3).join(', ') + (r.participantNames.length > 3 ? `, +${r.participantNames.length - 3}` : '')
            : '—';
          return (
            <div key={r.threadId} onClick={() => onSelect(complianceRowToThread(r))}
              style={{ padding: '11px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer',
                background: isSelected ? 'rgba(27,45,85,0.07)' : 'transparent',
                borderLeft: isSelected ? '3px solid var(--siomac-navy)' : '3px solid transparent' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: '0.83rem', fontWeight: 500, color: 'var(--siomac-navy)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.subject || '(no subject)'}
                </span>
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', flexShrink: 0 }}>{relTime(r.lastPostAt)}</span>
              </div>
              <div style={{ fontSize: '0.71rem', color: 'var(--text-muted)', marginTop: '3px',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {names}
              </div>
              <div style={{ display: 'flex', gap: '6px', marginTop: '6px', alignItems: 'center' }}>
                <span style={{ fontSize: '0.62rem', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.04em',
                  color: 'var(--text-muted)', background: 'var(--bg-subtle, #f4f5f7)', border: '1px solid var(--border)',
                  borderRadius: '5px', padding: '1px 6px' }}>
                  {typeLabel(r.threadType)}
                </span>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                  <i class="fas fa-user" style={{ fontSize: '0.6rem' }} /> {r.participantCount}
                </span>
                {r.isParticipant
                  ? <span style={{ marginLeft: 'auto', fontSize: '0.62rem', fontWeight: 500, color: '#15803d' }}>
                      <i class="fas fa-check" /> Participant
                    </span>
                  : <span style={{ marginLeft: 'auto', fontSize: '0.62rem', fontWeight: 500, color: '#b45309' }}>
                      <i class="fas fa-lock" /> Access required
                    </span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
