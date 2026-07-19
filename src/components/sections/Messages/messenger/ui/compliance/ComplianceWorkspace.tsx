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
import { useComplianceCases, complianceKeys } from '@api/communicationsCompliance';
import { ComplianceCasesView } from './ComplianceCasesView';
import { ComplianceConversationsView } from './ComplianceConversationsView';
import { ComplianceAccessLogView } from './ComplianceAccessLogView';
import { NewComplianceCaseDialog } from './NewComplianceCaseDialog';
import {
  ShieldCheck, FolderLock, MessageSquareText, ScrollText, RotateCcw, Plus,
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
  const tabs = TABS.filter(t => !t.gated || Boolean(caps?.[t.gated]));

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
  const { data } = useComplianceCases({});
  const caps = data?.capabilities;
  const [newCaseOpen, setNewCaseOpen] = useState(false);

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
          {subview === 'cases' && caps?.canRequestCase ? (
            <button type="button" className="smc-btn smc-btn--primary smc-btn--sm" onClick={() => setNewCaseOpen(true)}>
              <Plus /> New Case
            </button>
          ) : null}
          <button
            type="button"
            className="smc-icon-btn"
            title="Refresh"
            aria-label="Refresh compliance data"
            onClick={() => void qc.invalidateQueries({ queryKey: complianceKeys.all })}
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
        {subview === 'cases' ? <ComplianceCasesView /> : null}
        {subview === 'conversations' ? <ComplianceConversationsView /> : null}
        {subview === 'access-log' ? <ComplianceAccessLogView /> : null}
      </div>
    </div>
  );
}
