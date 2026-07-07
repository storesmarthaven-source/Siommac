// Onboarding Command Center — CommandCenterHealthBanner (byte-identical JSX from the original monolith).
import { type VNode } from 'preact';
import type { BlockerRow, CaseRow, DashboardMode, DeadlineRow, TaskRow } from '../../OnboardingCommandCenter.helpers';
import { Icon } from '../primitives';

function CommandCenterHealthBanner({
  mode,
  cases,
  tasks,
  blockers,
  failedHandoffsCount,
  deadlines,
  onOpenRisks,
  onOpenWork,
}: {
  mode: DashboardMode;
  cases: CaseRow[];
  tasks: TaskRow[];
  blockers: BlockerRow[];
  failedHandoffsCount: number;
  deadlines: DeadlineRow[];
  onOpenRisks: () => void;
  onOpenWork: () => void;
}): VNode {
  const blockedCases = cases.filter(row => row.status === 'blocked' || row.activeBlockers > 0).length;
  const blockedTasks = tasks.filter(row => row.status === 'blocked' || row.isBlocking).length;
  const evidenceTasks = tasks.filter(row => row.requiresEvidence && row.status !== 'completed').length;
  const dueToday = deadlines.filter(row => row.dueLabel.toLowerCase().includes('today')).length;
  const readyCases = cases.filter(row => row.ready).length;
  const riskLevel = failedHandoffsCount || blockedCases > 0 ? 'At Risk' : blockedTasks > 0 ? 'Watch' : 'Good';
  const riskTone = riskLevel === 'At Risk' ? 'danger' : riskLevel === 'Watch' ? 'warning' : 'success';
  const nextAction = failedHandoffsCount
    ? 'Review failed handoffs'
    : blockers.length
      ? 'Resolve active blockers'
      : 'Open today work queue';
  const isStaff = mode === 'staff';
  const bannerLabel = isStaff ? 'My Work Queue' : 'Onboarding Health';
  const headline = isStaff ? (blockedTasks ? 'Action Needed' : 'On Track') : riskLevel;
  const summary = isStaff
    ? `${blockedTasks} blocking task${blockedTasks === 1 ? '' : 's'}, ${evidenceTasks} evidence request${evidenceTasks === 1 ? '' : 's'}, ${dueToday} due today.`
    : `${blockedCases} blocked case${blockedCases === 1 ? '' : 's'}, ${failedHandoffsCount} failed handoff${failedHandoffsCount === 1 ? '' : 's'}, ${blockedTasks} blocking task${blockedTasks === 1 ? '' : 's'}.`;
  const staffNextAction = blockedTasks ? 'Clear assigned blockers' : evidenceTasks ? 'Request missing evidence' : 'Open today work queue';

  return (
    <section class={`obv-command-health-banner tone-${riskTone}`} aria-label="Onboarding command center health">
      <div class="obv-command-health-main">
        <span class="obv-command-health-icon"><Icon name={riskLevel === 'Good' ? 'check' : 'alert'} /></span>
        <div>
          <span class="obv-command-kicker">{bannerLabel}</span>
          <strong>{headline}</strong>
          <p>{summary}</p>
        </div>
      </div>

      <div class="obv-command-health-grid">
        <button type="button" onClick={onOpenRisks}>
          <strong>{blockers.length}</strong>
          <span>Open Blockers</span>
        </button>
        <button type="button" onClick={onOpenWork}>
          <strong>{dueToday}</strong>
          <span>Due Today</span>
        </button>
        <button type="button" onClick={onOpenWork}>
          <strong>{evidenceTasks}</strong>
          <span>Need Evidence</span>
        </button>
        <button type="button" onClick={onOpenRisks}>
          <strong>{readyCases}</strong>
          <span>Ready</span>
        </button>
      </div>

      <button class="obv-command-next-action" type="button" onClick={failedHandoffsCount || blockers.length ? onOpenRisks : onOpenWork}>
        <span>Next Action</span>
        <strong>{isStaff ? staffNextAction : nextAction}</strong>
      </button>
    </section>
  );
}

export { CommandCenterHealthBanner };
