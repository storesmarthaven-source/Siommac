// Onboarding Command Center — MorningGoalCard (byte-identical JSX from the original monolith).
import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { EmptyState } from '@ui';
import { derivePrioritySnapshot } from '../../OnboardingCommandCenter.adapters';
import { fmtDate, humanize, type BlockerRow, type CaseRow, type DashboardMode } from '../../OnboardingCommandCenter.helpers';
import { Icon, InsightGlyph, PersonAvatar } from '../primitives';

function MorningGoalCard({ mode, blockers, cases, onOpenTasks }: {
  mode: DashboardMode;
  blockers: BlockerRow[];
  cases: CaseRow[];
  onOpenTasks: () => void;
}): VNode {
  type CriticalAction = 'evidence' | 'escalate';
  const priorityBlockers = blockers.slice(0, 4);
  const [priorityIndex, setPriorityIndex] = useState(0);
  const isStaff = mode === 'staff';
  const [selectedAction, setSelectedAction] = useState<CriticalAction>('evidence');
  const [completedActionsByBlocker, setCompletedActionsByBlocker] = useState<Record<string, Record<CriticalAction, boolean>>>({});

  if (!priorityBlockers.length) {
    return (
      <article class="obv-collab-card obv-goal-card obv-daily-goal-card obv-activation-goal-card obv-critical-path-card obv-critical-path-card-empty">
        <EmptyState
          icon="fa-shield-halved"
          title="No active blockers"
          text={isStaff ? 'Nothing in your queue is blocking activation right now.' : 'Nothing is blocking activation right now.'}
          tone="gray"
        />
      </article>
    );
  }

  const focusBlocker = priorityBlockers[priorityIndex % priorityBlockers.length]!;
  const snapshot = derivePrioritySnapshot(focusBlocker, cases);
  const readinessPercent = snapshot.readinessPercent;
  const blockedPercent = 100 - readinessPercent;
  const actionCopy: Record<CriticalAction, {
    eyebrow: string;
    title: string;
    detail: string;
    cta: string;
    doneTitle: string;
    doneDetail: string;
  }> = {
    evidence: {
      eyebrow: 'Evidence workflow',
      title: 'Notify the blocker owner',
      detail: `${focusBlocker.ownerName} will be notified to submit the missing evidence for this gate.`,
      cta: 'Notify Owner',
      doneTitle: 'Owner notified',
      doneDetail: `${focusBlocker.ownerName} has been notified about this blocker.`,
    },
    escalate: {
      eyebrow: 'Escalation path',
      title: 'Escalate this blocker',
      detail: `Route to the HR owner since this remains open past ${fmtDate(focusBlocker.dueAt)}.`,
      cta: 'Escalate Blocker',
      doneTitle: 'Blocker escalated',
      doneDetail: `The blocker is flagged for ${focusBlocker.ownerName} follow-up.`,
    },
  };
  const selectedActionCopy = actionCopy[selectedAction];
  const completedActions = completedActionsByBlocker[focusBlocker.blockerId] ?? { evidence: false, escalate: false };
  const actionComplete = completedActions[selectedAction];
  const selectAction = (action: CriticalAction): void => setSelectedAction(action);
  const movePriority = (direction: -1 | 1): void => {
    setPriorityIndex(current => (current + direction + priorityBlockers.length) % priorityBlockers.length);
    setSelectedAction('evidence');
  };
  const runSelectedAction = (): void => {
    setCompletedActionsByBlocker(current => ({
      ...current,
      [focusBlocker.blockerId]: {
        ...(current[focusBlocker.blockerId] ?? { evidence: false, escalate: false }),
        [selectedAction]: true,
      },
    }));
    onOpenTasks();
  };

  return (
    <article class="obv-collab-card obv-goal-card obv-daily-goal-card obv-activation-goal-card obv-critical-path-card">
      <div class="obv-critical-top">
        <div class="obv-critical-status-line">
          <span>{isStaff ? 'My queue' : `Blocked by ${focusBlocker.blockingModule}`}</span>
          <time>Due {fmtDate(focusBlocker.dueAt)}</time>
        </div>
        <button class="obv-critical-open" type="button" onClick={onOpenTasks}>Open</button>
      </div>
      <div class="obv-critical-profile">
        <PersonAvatar name={focusBlocker.employeeName} img={focusBlocker.employeePhotoUrl} size="md" />
        <div class="obv-critical-person">
          <strong>{focusBlocker.employeeName}</strong>
          <em>{snapshot.packageLabel} &middot; {snapshot.stage}</em>
        </div>
        <div class="obv-critical-profile-nav">
          <button class="obv-critical-nav" type="button" aria-label="Previous priority employee" onClick={() => movePriority(-1)}>
            <InsightGlyph kind="chevronLeft" />
          </button>
          <button class="obv-critical-nav" type="button" aria-label="Next priority employee" onClick={() => movePriority(1)}>
            <InsightGlyph kind="chevronRight" />
          </button>
        </div>
      </div>
      <div class="obv-critical-identity">
        <span>{focusBlocker.caseNo} &middot; {snapshot.stage}</span>
        <strong>{focusBlocker.blockerTitle}</strong>
      </div>
      <div class="obv-critical-facts" aria-label="Critical path details">
        <button type="button" onClick={() => setSelectedAction('evidence')}>
          <span>Owner</span>
          <strong>{focusBlocker.ownerName}</strong>
        </button>
        <button type="button" onClick={() => setSelectedAction('escalate')}>
          <span>Gate</span>
          <strong>{focusBlocker.blockingModule}</strong>
        </button>
        <button type="button" onClick={() => setSelectedAction('escalate')}>
          <span>Age</span>
          <strong>{focusBlocker.ageDays} day{focusBlocker.ageDays === 1 ? '' : 's'}</strong>
        </button>
      </div>

      <div class="obv-critical-readiness">
        <div class="obv-critical-readiness-head">
          <div class="obv-critical-score">
            <span>Day-1 ready</span>
            <strong>{readinessPercent}%</strong>
          </div>
          <div>
            <span>Readiness impact</span>
            <small>{blockedPercent}% blocked by this gate &middot; {humanize(focusBlocker.status)}</small>
          </div>
        </div>
        <em><i style={{ width: `${readinessPercent}%` }} /></em>
      </div>

      <div class="obv-critical-actions" role="group" aria-label="Critical path actions">
        <button class={selectedAction === 'evidence' ? 'is-active' : ''} type="button" onClick={() => selectAction('evidence')}>
          <Icon name="mail" />
          <span>{completedActions.evidence ? 'Notified' : 'Notify Owner'}</span>
        </button>
        <button class={selectedAction === 'escalate' ? 'is-active' : ''} type="button" onClick={() => selectAction('escalate')}>
          <Icon name="alert" />
          <span>{completedActions.escalate ? 'Escalated' : 'Escalate'}</span>
        </button>
      </div>

      <div class={`obv-critical-action-panel action-${selectedAction} ${actionComplete ? 'is-complete' : ''}`}>
        <div class="obv-critical-action-main">
          <span class="obv-critical-action-eyebrow">{selectedActionCopy.eyebrow}</span>
          <strong>{actionComplete ? selectedActionCopy.doneTitle : selectedActionCopy.title}</strong>
          <p>{actionComplete ? selectedActionCopy.doneDetail : selectedActionCopy.detail}</p>
        </div>
        <div class="obv-critical-action-side">
          <button type="button" onClick={runSelectedAction}>{actionComplete ? 'Open Workflow' : selectedActionCopy.cta}</button>
        </div>
      </div>
    </article>
  );
}

export { MorningGoalCard };
