// Onboarding Command Center — BlockedCasesCard (byte-identical JSX from the original monolith).
import { type VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { EmptyState } from '@ui';
import { blockerMeta, fmtDate, humanize, type BlockerRow, type OnboardingSurfaceFilters } from '../../OnboardingCommandCenter.helpers';
import { Icon, InsightGlyph, PersonAvatar } from '../primitives';

function BlockedCasesCard({ blockers, onOpenBlocked }: { blockers: BlockerRow[]; onOpenBlocked: (filters?: OnboardingSurfaceFilters) => void }): VNode {
  const pageSize = 3;
  const [activeIndex, setActiveIndex] = useState(0);
  const [slideDirection, setSlideDirection] = useState<'next' | 'previous'>('next');
  const blockerCount = blockers.length;
  const canScroll = blockerCount > pageSize;
  const visibleBlockers = blockerCount
    ? Array.from({ length: Math.min(pageSize, blockerCount) }, (_, offset) => blockers[(activeIndex + offset) % blockerCount]!)
    : [];

  useEffect(() => {
    if (blockerCount && activeIndex >= blockerCount) setActiveIndex(0);
  }, [activeIndex, blockerCount]);

  const moveBlockers = (direction: -1 | 1): void => {
    if (!canScroll) return;
    setSlideDirection(direction > 0 ? 'next' : 'previous');
    setActiveIndex(current => (current + direction + blockerCount) % blockerCount);
  };

  return (
    <article class="obx-section obv-card obv-blocked-card obv-blocked-board-compact obv-blocked-condensed-card">
      <div class="obv-health-head obv-blocked-condensed-head">
        <div class="obv-blocked-title-group">
          <span class="obv-blocked-alert-dot" />
          <h2>Blocked Cases</h2>
          <em>{blockers.length}</em>
        </div>
        <div class="obv-health-actions obv-blocked-nav-actions">
          <button class="obv-health-circle-btn" type="button" aria-label="Previous blocked cases" onClick={() => moveBlockers(-1)} disabled={!canScroll}><InsightGlyph kind="chevronLeft" /></button>
          <button class="obv-health-circle-btn" type="button" aria-label="Next blocked cases" onClick={() => moveBlockers(1)} disabled={!canScroll}><InsightGlyph kind="chevronRight" /></button>
          <button class="obv-health-viewall" type="button" onClick={() => onOpenBlocked()}>View All</button>
        </div>
      </div>

      <div class={`obv-blocked-condensed-list slide-${slideDirection}`} key={`${activeIndex}-${slideDirection}`}>
        {visibleBlockers.map(item => {
          const meta = blockerMeta(item);
          return (
            <button
              class={`obv-blocked-condensed-item severity-${item.severity} status-${item.status}`}
              type="button"
              onClick={() => onOpenBlocked({
                blockerId: item.blockerId,
                caseId: item.caseId,
                severity: item.severity,
                status: item.status,
              })}
              key={item.blockerId}
              title={`${meta.links} linked record${meta.links === 1 ? '' : 's'}`}
            >
              <div class="obv-blocked-condensed-main">
                <span class={`obv-blocker-chip blocker-chip-${item.severity}`}><i />{humanize(item.severity)}</span>
                <div class="obv-blocked-condensed-copy">
                  <strong>{item.blockerTitle}</strong>
                  <p>{item.employeeName} · {item.caseNo}</p>
                </div>
              </div>
              <div class="obv-blocked-condensed-side obv-blocked-condensed-assignee">
                <PersonAvatar name={item.ownerName} size="sm" />
                <span class="obv-blocked-owner">{item.ownerName}</span>
              </div>
              <div class="obv-blocked-condensed-meta obv-blocked-essential-meta">
                <span class="obv-blocked-due">Due {fmtDate(item.dueAt)}</span>
              </div>
            </button>
          );
        })}
        {!visibleBlockers.length ? (
          <EmptyState
            icon="fa-circle-check"
            title="No blocked cases"
            tone="gray"
            note="New blockers raised by HR, IT, or HSE will show up here."
          />
        ) : null}
      </div>
    </article>
  );
}

export { BlockedCasesCard };
