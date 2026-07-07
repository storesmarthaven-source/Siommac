// Onboarding Command Center — UpcomingDeadlinesCard (byte-identical JSX from the original monolith).
import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { EmptyState } from '@ui';
import { addDays, isSameCalendarDay, weekWindow, type DeadlineRow } from '../../OnboardingCommandCenter.helpers';
import { Icon, InsightGlyph, PersonAvatar } from '../primitives';

function UpcomingDeadlinesCard({ deadlines, onOpenDeadlines }: { deadlines: DeadlineRow[]; onOpenDeadlines: () => void }): VNode {
  const today = useMemo(() => new Date(), []);
  const [windowStart, setWindowStart] = useState(today);
  const [selectedDate, setSelectedDate] = useState(today);
  const [slideDirection, setSlideDirection] = useState<'next' | 'previous'>('next');
  const days = useMemo(() => weekWindow(windowStart), [windowStart]);
  const monthLabel = windowStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const selectedDeadlines = deadlines.filter(item => isSameCalendarDay(item.date, selectedDate));
  const upcomingDeadlines = selectedDeadlines.length ? selectedDeadlines : deadlines.filter(item => item.date >= selectedDate).slice(0, 3);

  const moveDateWindow = (direction: -1 | 1): void => {
    const nextStart = addDays(windowStart, direction * 7);
    setSlideDirection(direction > 0 ? 'next' : 'previous');
    setWindowStart(nextStart);
    setSelectedDate(nextStart);
  };

  return (
    <article class="obv-health-card obv-deadlines-card obv-appointments-style-card">
      <div class="obv-health-head">
        <div class="obv-appointments-title"><span class="obv-appointments-title-icon"><Icon name="calendar" /></span><h2>Upcoming Deadlines</h2></div>
        <div class="obv-health-actions compact">
          <button class="obv-health-ghost-btn" type="button" aria-label="Previous dates" onClick={() => moveDateWindow(-1)}><InsightGlyph kind="chevronLeft" /></button>
          <button class="obv-health-ghost-btn" type="button" aria-label="Next dates" onClick={() => moveDateWindow(1)}><InsightGlyph kind="chevronRight" /></button>
        </div>
      </div>
      <div class="obv-deadline-month-label">{monthLabel}</div>
      <div class={`obv-appointments-calendar obv-deadline-calendar slide-${slideDirection}`} key={windowStart.toISOString()}>
        {days.map(day => {
          const hasDeadline = deadlines.some(item => isSameCalendarDay(item.date, day));
          return (
            <button
              class={`obv-appointments-day ${isSameCalendarDay(day, selectedDate) ? 'active' : ''} ${isSameCalendarDay(day, today) ? 'today' : ''} ${hasDeadline ? 'has-deadline' : ''}`}
              type="button"
              key={day.toISOString()}
              onClick={() => setSelectedDate(day)}
            >
              <span>{day.toLocaleDateString('en-US', { weekday: 'short' })}</span>
              <strong>{day.getDate()}</strong>
            </button>
          );
        })}
      </div>
      <div class="obv-appointment-list obv-deadline-appointment-list">
        {upcomingDeadlines.map(item => (
          <button class="obv-appointment-item obv-deadline-appointment" type="button" key={item.id} onClick={onOpenDeadlines}>
            <p style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.month} {item.day} · {item.dueLabel}</p>
            <div class="obv-appointment-main">
              <div class="obv-appointment-copy">
                <span class={`obv-deadline-soft-icon obv-deadline-avatar-chip ${item.tone ? `tone-${item.tone}` : ''}`}>
                  <PersonAvatar name={item.employeeName} img={item.employeePhotoUrl} size="sm" />
                </span>
                <div>
                  <strong>{item.taskTitle}</strong>
                  <span>{item.employeeName}</span>
                </div>
              </div>
              <span class="obv-appointment-chat"><Icon name="arrow" /></span>
            </div>
          </button>
        ))}
        {!upcomingDeadlines.length ? (
          <EmptyState
            icon="fa-calendar"
            title="No deadlines"
            tone="gray"
            note="Pick another day on the calendar above to check for deadlines."
          />
        ) : null}
      </div>
    </article>
  );
}

export { UpcomingDeadlinesCard };
