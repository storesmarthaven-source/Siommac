// Onboarding Command Center — RecentActivityCard (byte-identical JSX from the original monolith).
import { type VNode } from 'preact';
import { EmptyState } from '@ui';
import type { ActivityRow } from '../../OnboardingCommandCenter.helpers';
import { Icon } from '../primitives';

function RecentActivityCard({ activity, onOpenActivity }: { activity: ActivityRow[]; onOpenActivity: () => void }): VNode {
  // Matches the reference mockup's exact visual system (rotating icon set + the
  // complete/pending status dot on the first few rows) — the mockup used position-based
  // fake icons/status here rather than deriving them from the activity data itself.
  // Kept as-is for now on the user's explicit direction; will be reconciled to fully
  // real, derived icon/status semantics in a follow-up pass.
  const activityDayIcons = ['document', 'handoffComplete', 'people', 'medicalClearance'] as const;

  return (
    <article class="obx-section obv-card obv-activity-card obv-activity-day-card">
      <div class="obv-health-head obv-activity-day-head">
        <div>
          <h2>Recent Activity</h2>
          <p>Live onboarding movement</p>
        </div>
        <div class="obv-health-actions">
          <button class="obv-health-viewall" type="button" onClick={onOpenActivity}>View All</button>
        </div>
      </div>

      {activity.length ? (
        <div class="obv-activity-day-timeline">
          {activity.slice(0, 4).map((item, index) => {
            const isCurrent = index === 2;
            const isCompleted = index < 2;
            return (
              <button
                class={`obv-activity-day-item activity-${item.tone}${isCurrent ? ' is-current' : ''}${isCompleted ? ' is-complete' : ' is-pending'}`}
                type="button"
                key={item.id}
                onClick={onOpenActivity}
              >
                <span class="obv-activity-day-icon-wrap">
                  <span class={`obv-activity-day-icon icon-${item.tone}`}><Icon name={activityDayIcons[index] ?? item.icon} /></span>
                </span>

                <span class="obv-activity-day-content">
                  <span class="obv-activity-day-time">
                    <span class={`obv-activity-day-status ${isCompleted ? 'status-complete' : 'status-pending'}`}>
                      {isCompleted ? <Icon name="check" /> : <Icon name="clock" />}
                    </span>
                    <time>{item.occurredAt}</time>
                  </span>

                  <span class="obv-activity-day-card-row">
                    <strong>{item.title}</strong>
                    <span>{item.actorName}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon="fa-clock-rotate-left"
          title="No recent activity"
          text="Nothing has happened yet."
          tone="gray"
          note="Task completions, blockers, and case updates are logged here automatically."
        />
      )}
    </article>
  );
}

export { RecentActivityCard };
