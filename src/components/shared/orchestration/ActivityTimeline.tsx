/**
 * src/components/shared/orchestration/ActivityTimeline.tsx
 *
 * Reusable cross-module record timeline (design: siomac_activity_timeline v4).
 * Give it a record ({module, recordType, recordId}) and it renders that record's
 * unified feed (events + audit + handoffs + workflows + messages + tickets),
 * newest-first, from /api/orchestration/timeline. Themed for the navy rich drawer.
 *
 * Controls: a type filter (dropdown + tab strip, kept in sync), a free-text search,
 * client-side pagination, and a refresh. Severity drives the dot colour; the icon +
 * colour encode the item kind. Drops into any record drawer/page.
 */

import { type VNode } from 'preact';
import { useState, useRef, useEffect, useMemo } from 'preact/hooks';
import { useRecordTimeline } from '@api/orchestration';
import { relativeTime } from '@sections/NotificationCenter/notifMeta';

const ICON: Record<string, string> = {
  event:    'fa-bolt',
  audit:    'fa-clipboard-check',
  handoff:  'fa-right-left',
  workflow: 'fa-code-branch',
  message:  'fa-comment',
  ticket:   'fa-ticket',
};

type FilterKey = 'all' | 'event' | 'handoff' | 'workflow' | 'message' | 'ticket' | 'audit';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all',      label: 'All' },
  { key: 'event',    label: 'Events' },
  { key: 'handoff',  label: 'Handoffs' },
  { key: 'workflow', label: 'Workflows' },
  { key: 'message',  label: 'Messages' },
  { key: 'ticket',   label: 'Tickets' },
  { key: 'audit',    label: 'Audit' },
];

const PAGE_SIZE = 6;

/** Convert raw dot-notation event keys to readable titles (safety net). */
function formatTitle(title: string): string {
  if (!/^[a-z_]+(\.[a-z_]+)+$/.test(title)) return title;
  const parts = title.split('.');
  const rest = parts.length >= 2 ? parts.slice(1) : parts;
  return rest.join(' ').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
}

function pageWindow(cur: number, total: number): number[] {
  const pages: number[] = [];
  const from = Math.max(1, cur - 2);
  const to = Math.min(total, from + 4);
  for (let p = Math.max(1, to - 4); p <= to; p++) pages.push(p);
  return pages;
}

export function ActivityTimeline(
  { module, recordType, recordId }: { module: string; recordType: string; recordId: string },
): VNode {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const q = useRecordTimeline({ module, recordType, recordId, includeAudit: true });
  const all = useMemo(() => q.data ?? [], [q.data]);

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  const needle = search.trim().toLowerCase();
  const filtered = useMemo(() => all.filter(it => {
    if (filter !== 'all' && it.item_type !== filter) return false;
    if (!needle) return true;
    const text = `${it.title} ${it.description ?? ''} ${it.actor_name ?? ''} ${it.item_type}`.toLowerCase();
    return text.includes(needle);
  }), [all, filter, needle]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);

  const setType = (k: FilterKey) => { setFilter(k); setPage(1); setMenuOpen(false); };
  const activeLabel = FILTERS.find(f => f.key === filter)?.label ?? 'All';

  return (
    <section class="orch-tl-card">
      <div class="orch-tl-head">
        <div class="orch-tl-titlerow">
          <div class="orch-tl-titles">
            <h4>Activity Timeline</h4>
            <p>Unified cross-module activity for this {recordType}</p>
          </div>
          <div class="orch-tl-actions">
            <div class={`orch-tl-fwrap${menuOpen ? ' open' : ''}`} ref={menuRef}>
              <button type="button" class="orch-tl-filter" aria-haspopup="menu" aria-expanded={menuOpen}
                onClick={() => setMenuOpen(o => !o)}>
                <span>{activeLabel}</span>
                <i class="fas fa-chevron-down" aria-hidden="true" />
              </button>
              <div class="orch-tl-fmenu" role="menu">
                {FILTERS.map(f => (
                  <button key={f.key} type="button" role="menuitem"
                    class={`orch-tl-fopt${filter === f.key ? ' active' : ''}`}
                    onClick={() => setType(f.key)}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <button type="button" class="orch-tl-refresh" aria-label="Refresh activity"
              disabled={q.isFetching} onClick={() => void q.refetch()}>
              <i class={`fas fa-rotate-right${q.isFetching ? ' fa-spin' : ''}`} aria-hidden="true" />
            </button>
          </div>
        </div>

        <label class="orch-tl-search">
          <i class="fas fa-magnifying-glass" aria-hidden="true" />
          <input type="search" placeholder="Search activity…" value={search}
            onInput={e => { setSearch(e.currentTarget.value); setPage(1); }} />
        </label>

        <div class="orch-tl-tabs" role="tablist" aria-label="Activity type">
          {FILTERS.map(f => (
            <button key={f.key} type="button" role="tab" aria-selected={filter === f.key}
              class={`orch-tl-tab${filter === f.key ? ' active' : ''}`} onClick={() => setType(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div class="orch-tl-body">
        {q.isLoading && !q.data ? (
          <div class="orch-tl-list" aria-busy="true">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} class="orch-tl-item orch-tl-item--sk">
                <div class="orch-tl-rail"><span class="orch-tl-sk orch-tl-sk-circle" /></div>
                <div class="orch-tl-content">
                  <span class="orch-tl-sk" style={{ width: '55%', height: '12px' }} />
                  <span class="orch-tl-sk" style={{ width: '85%', height: '10px', marginTop: '8px' }} />
                </div>
              </div>
            ))}
          </div>
        ) : q.isError ? (
          <div class="orch-tl-empty">
            <strong>Couldn't load activity</strong>
            <span>{q.error instanceof Error ? q.error.message : 'Please try again.'}</span>
          </div>
        ) : !pageItems.length ? (
          <div class="orch-tl-empty">
            <strong>{filter === 'all' && !needle ? 'No activity yet' : 'No matching activity'}</strong>
            <span>{filter === 'all' && !needle
              ? 'Events, handoffs, approvals, messages and tickets for this record appear here.'
              : 'Try clearing the filter or search.'}</span>
          </div>
        ) : (
          <div class="orch-tl-list">
            {pageItems.map(it => (
              <article key={it.id} class="orch-tl-item">
                <div class="orch-tl-rail" aria-hidden="true">
                  <span class={`orch-tl-ico type-${it.item_type}`}>
                    <i class={`fas ${ICON[it.item_type] ?? 'fa-circle'}`} />
                  </span>
                </div>
                <div class="orch-tl-content">
                  <div class="orch-tl-line2">
                    <span class={`orch-tl-sev sev-${it.severity ?? 'info'}`} aria-hidden="true" />
                    <strong class="orch-tl-ttl">{formatTitle(it.title)}</strong>
                  </div>
                  {it.description && <p class="orch-tl-desc">{it.description}</p>}
                  <div class="orch-tl-meta">{it.item_type.toUpperCase()} &nbsp;·&nbsp; {it.actor_name ?? 'System'}</div>
                </div>
                <time class="orch-tl-time" dateTime={it.created_at}>{relativeTime(it.created_at)}</time>
              </article>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <nav class="orch-tl-pg" aria-label="Activity pages">
            <button type="button" class="orch-tl-pgbtn" disabled={curPage <= 1}
              onClick={() => setPage(curPage - 1)} aria-label="Previous page">‹</button>
            {pageWindow(curPage, totalPages).map(p => (
              <button key={p} type="button" class={`orch-tl-pgbtn${p === curPage ? ' active' : ''}`}
                onClick={() => setPage(p)} aria-label={`Page ${p}`}>{p}</button>
            ))}
            <button type="button" class="orch-tl-pgbtn" disabled={curPage >= totalPages}
              onClick={() => setPage(curPage + 1)} aria-label="Next page">›</button>
          </nav>
        )}
      </div>
    </section>
  );
}
