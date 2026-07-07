// Onboarding Command Center — CasePerformanceCard (byte-identical JSX from the original monolith).
import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { EmptyState } from '@ui';
import { humanize, type CaseRow, type DashboardMode } from '../../OnboardingCommandCenter.helpers';
import { Icon, InsightGlyph, PersonAvatar } from '../primitives';

function CasePerformanceCard({
  cases, mode, currentUserId, onOpenCases, onOpenCase,
}: {
  cases: CaseRow[];
  mode: DashboardMode;
  currentUserId: string | null;
  onOpenCases: () => void;
  onOpenCase: (caseId: string) => void;
}): VNode {
  const [page, setPage] = useState(0);
  const [slideDirection, setSlideDirection] = useState<'next' | 'previous'>('next');

  const displayCases = mode === 'staff'
    ? cases.filter(row => row.ownerId === currentUserId)
    : [...cases].sort((a, b) => (b.activeBlockers + b.blockingTasks + b.openTasks) - (a.activeBlockers + a.blockingTasks + a.openTasks));
  const pageSize = 3;
  const pageCount = Math.max(1, Math.ceil(displayCases.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const featured = displayCases.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const movePage = (direction: -1 | 1): void => {
    setSlideDirection(direction > 0 ? 'next' : 'previous');
    setPage(current => (current + direction + pageCount) % pageCount);
  };

  return (
    <article class="obv-health-card obv-case-performance-card obv-priority-case-work-card">
      <div class="obv-health-head obv-priority-work-head">
        <div>
          <h2>{mode === 'staff' ? 'My Case Work' : 'Priority Case Work'}</h2>
          <p>Cases, task planner, evidence, and next actions</p>
        </div>
        <div class="obv-health-actions obv-priority-work-actions">
          <button class="obv-health-circle-btn" type="button" aria-label="Previous cases" onClick={() => movePage(-1)}><InsightGlyph kind="chevronLeft" /></button>
          <button class="obv-health-circle-btn" type="button" aria-label="Next cases" onClick={() => movePage(1)}><InsightGlyph kind="chevronRight" /></button>
          <button class="obv-health-viewall" type="button" onClick={onOpenCases}>View All</button>
        </div>
      </div>

      <section class="obv-priority-cases-panel" aria-label="Priority cases">
        <div class="obv-priority-panel-head">
          <em>{displayCases.length} active</em>
        </div>
        <div class={`obv-case-performance-grid obv-priority-case-list slide-${slideDirection}`} key={`${safePage}-${slideDirection}`}>
          {featured.map(row => (
            <button class="obv-case-performance-item obv-priority-case-item" type="button" key={row.caseId} onClick={() => onOpenCase(row.caseId)}>
              <div class="obv-doctor-head">
                <PersonAvatar name={row.employeeName} img={row.employeePhotoUrl} size="md" />
                <div class="obv-doctor-copy">
                  <strong>{row.employeeName}</strong>
                  <span>{row.packageLabel}</span>
                </div>
              </div>
              <div class="obv-doctor-divider" />
              <dl class="obv-doctor-stats">
                <div><dt>Progress</dt><dd>{row.progressPercent}%</dd></div>
                <div><dt>Tasks</dt><dd>{row.openTasks}</dd></div>
                <div><dt>Status</dt><dd><span class={`obv-case-status-text status-${row.status}`}>{humanize(row.status)}</span></dd></div>
              </dl>
            </button>
          ))}
          {!featured.length ? (
            <EmptyState
              icon="fa-user-group"
              title={mode === 'staff' ? 'No assigned cases' : 'No active cases'}
              text={mode === 'staff' ? 'You have no onboarding cases assigned right now.' : 'No onboarding cases match the current view.'}
              tone="gray"
              note="New hire, transfer, and contractor onboarding cases will show up here."
            />
          ) : null}
        </div>
      </section>

      <button class="obv-case-insight-mini obv-case-insight-simple obv-priority-work-insight" type="button" onClick={onOpenCases}>
        <span class="obv-case-insight-purple-icon"><Icon name="play" /></span>
        <span class="obv-case-insight-purple-copy">
          <strong>Risk-ranked cases with the full task planner in one container</strong>
          <em>{mode === 'staff' ? 'See assigned cases, dated tasks, evidence, and HR-owned next actions' : 'Review blockers, open work, dated tasks, and ownership without leaving this case container'}</em>
        </span>
        <span class="obv-case-insight-purple-action">Open Workbench <Icon name="arrow" /></span>
      </button>
    </article>
  );
}

export { CasePerformanceCard };
