/**
 * ComplianceWorkspace.tsx
 *
 * V1 Messenger Compliance workspace. The subview tablist (ComplianceSubnav) is
 * lifted into the Messenger topbar band — rendered by MessagesWorkspace, which
 * owns the ComplianceStateProvider so the band tabs and this body share one
 * selection. This component renders the active subview's body plus the workspace
 * title/actions. Commands are gated by server-authored capabilities only.
 */

import { useState } from 'preact/hooks';
import { useQueryClient } from '@tanstack/preact-query';
import { useComplianceState, type ComplianceSubview } from './ComplianceState';
import { useComplianceCases, complianceKeys, asComplianceAccessError, type ComplianceAccessError } from '@api/communicationsCompliance';
import { refreshPermissionOverrides } from '@lib/auth';
import { ComplianceCasesView } from './ComplianceCasesView';
import { ComplianceConversationsView } from './ComplianceConversationsView';
import { ComplianceAccessLogView } from './ComplianceAccessLogView';
import { NewComplianceCaseDialog } from './NewComplianceCaseDialog';
import {
  ShieldCheck, LockKeyhole, FolderLock, MessageSquareText, ScrollText, RotateCcw, Plus,
  type IconProps,
} from '../components/icons';

const TABS: { id: ComplianceSubview; label: string; icon: (props: IconProps) => preact.VNode; gated?: 'canViewAccessLog' }[] = [
  { id: 'cases',         label: 'Cases',         icon: FolderLock },
  { id: 'conversations', label: 'Conversations', icon: MessageSquareText },
  { id: 'access-log',    label: 'Access Log',    icon: ScrollText, gated: 'canViewAccessLog' },
];

/**
 * The compliance subview tablist, rendered in the Messenger topbar band's middle
 * column (where a thread header sits for the message queues). Shares selection
 * with the workspace body via the ComplianceStateProvider owned upstream by
 * MessagesWorkspace — context flows through the band's portal.
 */
export function ComplianceSubnav() {
  const { subview, setSubview } = useComplianceState();
  const { data } = useComplianceCases({});
  const caps = data?.capabilities;
  // No capabilities means access is denied or still resolving — render no tabs so
  // the topbar doesn't advertise Cases/Conversations the actor can't open. The
  // workspace body shows the access gate / loading state instead.
  if (!caps) return null;
  const tabs = TABS.filter(t => !t.gated || caps[t.gated]);

  return (
    <nav className="sm-band-compliance-nav" role="tablist" aria-label="Compliance views">
      {tabs.map(tab => {
        const Icon = tab.icon;
        const active = subview === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`smc-tab-${tab.id}`}
            aria-selected={active}
            aria-controls={`smc-panel-${tab.id}`}
            className={`app-topbar-nav-btn${active ? ' active' : ''}`}
            onClick={() => setSubview(tab.id)}
          >
            <Icon /> {tab.label}
          </button>
        );
      })}
    </nav>
  );
}

export function ComplianceWorkspace() {
  const qc = useQueryClient();
  const { subview } = useComplianceState();
  const { data, isError, error, isLoading } = useComplianceCases({});
  const caps = data?.capabilities;
  const [newCaseOpen, setNewCaseOpen] = useState(false);

  // Every compliance route requires an active `communications.compliance_read`
  // grant, so a refused read means the actor has no access to the whole workspace.
  // Show an explicit access gate rather than silently emptying every subview.
  const accessError = isError && !data ? asComplianceAccessError(error) : null;
  // Hold the body on a neutral loading state until the gating read settles, so we
  // don't flash the subviews (and their own skeletons) before the gate appears.
  // (TanStack v5: isLoading ⟺ first fetch in flight — implies no data yet, no error.)
  const gateLoading = isLoading;
  // Re-pull the permission snapshot (a grant may have just been approved) AND the
  // compliance data, so a newly-granted user leaves the gate without a full reload.
  const refresh = () => {
    void refreshPermissionOverrides();
    void qc.invalidateQueries({ queryKey: complianceKeys.all });
  };

  return (
    <div className="smc-workspace" data-theme-scope="adaptive">
      <header className="smc-header">
        <div className="smc-header__brand">
          <span className="smc-header__badge"><ShieldCheck /></span>
          <span className="smc-header__titles">
            <strong>Compliance Workspace</strong>
            <span>Approved investigations, scoped access and immutable evidence</span>
          </span>
        </div>

        <div className="smc-header__actions">
          {!accessError && subview === 'cases' && caps?.canRequestCase ? (
            <button type="button" className="smc-btn smc-btn--primary smc-btn--sm" onClick={() => setNewCaseOpen(true)}>
              <Plus /> New Case
            </button>
          ) : null}
          <button
            type="button"
            className="smc-icon-btn"
            title="Refresh"
            aria-label="Refresh compliance data"
            onClick={refresh}
          >
            <RotateCcw />
          </button>
        </div>
      </header>

      <NewComplianceCaseDialog open={newCaseOpen} onClose={() => setNewCaseOpen(false)} />

      <div
        className="smc-body"
        role="tabpanel"
        id={`smc-panel-${subview}`}
        aria-labelledby={`smc-tab-${subview}`}
      >
        {accessError ? (
          <ComplianceAccessGate error={accessError} onRetry={refresh} />
        ) : gateLoading ? (
          <div className="smc-gate smc-gate--checking" role="status">
            <span className="smc-gate__spinner" aria-hidden="true" />
            <span className="smc-gate__body">Checking compliance access…</span>
          </div>
        ) : (
          <>
            {subview === 'cases' ? <ComplianceCasesView /> : null}
            {subview === 'conversations' ? <ComplianceConversationsView /> : null}
            {subview === 'access-log' ? <ComplianceAccessLogView /> : null}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Access-required gate. Compliance access is an explicit, time-boxed, grant-required
 * capability (`communications.compliance_read`) — required for everyone, including
 * superadmins. When the read is refused we explain how to obtain access instead of
 * hiding the workspace controls with no reason.
 */
function ComplianceAccessGate({
  error,
  onRetry,
}: {
  error: ComplianceAccessError;
  onRetry: () => void;
}) {
  const grantRequired = error.isGrantRequired;
  return (
    <div className="smc-gate" role="status">
      <div className={`smc-gate__panel${grantRequired ? '' : ' smc-gate__panel--warn'}`}>
        <span className="smc-gate__icon">
          <LockKeyhole />
        </span>
        <strong className="smc-gate__title">
          {grantRequired ? 'Compliance access required' : 'Compliance access is temporarily unavailable'}
        </strong>
        {grantRequired ? (
          <p className="smc-gate__body">
            Viewing compliance cases and conversations needs an active
            {' '}<code>communications.compliance_read</code> grant. This permission is
            explicit, time-boxed, and required for every user — including superadmins.
          </p>
        ) : (
          <p className="smc-gate__body">
            The permission service could not be reached, so access can’t be confirmed
            right now. This is usually temporary — retry in a moment.
          </p>
        )}
        {grantRequired ? (
          <ol className="smc-gate__steps">
            <li>Ask an administrator to grant you <code>communications.compliance_read</code> in <strong>Access Control</strong>.</li>
            <li>The grant must have a valid start and end time and be approved through maker-checker (a different person approves).</li>
            <li>Once it is active, reload this page.</li>
          </ol>
        ) : null}
        <div className="smc-gate__footer">
          <button type="button" className="smc-btn smc-btn--primary smc-btn--sm" onClick={onRetry}>
            <RotateCcw /> {grantRequired ? 'Reload' : 'Retry'}
          </button>
        </div>
      </div>
    </div>
  );
}
