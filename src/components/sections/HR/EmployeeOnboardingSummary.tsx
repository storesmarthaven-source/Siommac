/**
 * src/components/sections/HR/EmployeeOnboardingSummary.tsx
 *
 * Employee Master must only LAUNCH onboarding and SHOW status — the full onboarding
 * module (task completion, blockers, handoffs, custom actions) is managed on the
 * dedicated Onboarding page. This is the summary-only read surface for the Employee
 * Profile Drawer's "Onboarding" tab: no task actions, no cancel — just the case's
 * current state and a link to the real case-management workspace.
 *
 * Uses the same rich, computed OnboardingCaseRow the Onboarding Overview cases table
 * uses (progress/openTasks/blockingTasks/ownerName all pre-computed server-side) via
 * the employeeIds filter, rather than the older employee-scoped hr/onboarding/get
 * endpoint (which returns raw uncomputed rows and is retained only for its existing
 * E2E coverage, not used by any hook anymore).
 */
import { type VNode } from 'preact';
import { InfoCard, FieldList, FieldRow, Pill, EmptyState, SkeletonText, type PillTone } from '@ui';
import { useOnboardingCases, useOnboardingHandoffsList, useOnboardingAudit } from '@api/hr/onboarding';
import { humanize } from './shared';

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
function relativeTime(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}
const STATUS_TONE: Record<string, PillTone> = {
  draft: 'gray', open: 'gray', in_progress: 'blue', blocked: 'red',
  paused: 'amber', ready_for_activation: 'green', completed: 'green', cancelled: 'gray',
};

export interface EmployeeOnboardingSummaryProps {
  employeeId: string;
  onOpenCase?: (caseId: string) => void;
}

export function EmployeeOnboardingSummary({ employeeId, onOpenCase }: EmployeeOnboardingSummaryProps): VNode {
  const casesQ = useOnboardingCases({ employeeIds: [employeeId] }, { enabled: !!employeeId });
  const row = casesQ.data?.rows[0] ?? null;
  const handoffsQ = useOnboardingHandoffsList({ caseId: row?.caseId }, { enabled: !!row?.caseId });
  const auditQ = useOnboardingAudit(row?.caseId ?? null);

  if (casesQ.isLoading && !casesQ.data) {
    return <InfoCard title="Onboarding"><SkeletonText lines={5} /></InfoCard>;
  }
  if (!row) {
    return (
      <InfoCard title="Onboarding">
        <EmptyState icon="fa-list-check" title="No onboarding case"
          text="This employee has no active onboarding case."
          note="Start onboarding from the Create Employee wizard, or from the Onboarding page." />
      </InfoCard>
    );
  }

  const handoffs = handoffsQ.data ?? [];
  const handoffsDone = handoffs.filter(h => ['delivered', 'completed', 'accepted'].includes(h.status)).length;
  const recent = (auditQ.data ?? []).slice(0, 3);

  return (
    <InfoCard title="Onboarding Summary"
      action={<button class="ui-mini-btn" type="button" onClick={() => onOpenCase?.(row.caseId)}>View Full Case</button>}>
      <FieldList>
        <FieldRow label="Case" value={row.caseNo} />
        <FieldRow label="Status" value={<Pill tone={STATUS_TONE[row.status] ?? 'gray'}>{humanize(row.status)}</Pill>} />
        <FieldRow label="Package" value={row.packageLabel} />
        <FieldRow label="Progress" value={`${row.progressPercent}%`} />
        <FieldRow label="Due" value={fmtDate(row.dueAt)} />
        <FieldRow label="Owner" value={row.ownerName ?? 'Unassigned'} />
        <FieldRow label="Open tasks" value={String(row.openTasks)} />
        <FieldRow label="Blocking tasks" value={row.blockingTasks > 0 ? <Pill tone="red">{row.blockingTasks}</Pill> : '0'} />
        <FieldRow label="Handoffs" value={handoffs.length ? `${handoffsDone} of ${handoffs.length} delivered` : 'None'} />
      </FieldList>
      {recent.length > 0 && (
        <div class="ui-field-list" style={{ marginTop: 10 }}>
          <div class="ui-field-row-label" style={{ marginBottom: 6 }}>Recent activity</div>
          {recent.map(a => (
            <div key={a.id} style={{ fontSize: 12, color: 'var(--ui-muted, #64748b)', padding: '3px 0' }}>
              {humanize(a.action)} — {a.actorName ?? 'System'} · {relativeTime(a.createdAt)}
            </div>
          ))}
        </div>
      )}
    </InfoCard>
  );
}
