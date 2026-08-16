import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { EmptyState } from '../../../ui/components/EmptyState';
import { Illustration, type IllustrationVariant } from '../../../ui/feedback/Illustration';
import { Button } from '../../../ui/primitives/Button';
import { Badge } from '../../../ui/primitives/Badge';
import { Avatar } from '../../../ui/people/Avatar';
import { LucideIcon, type LucideName } from '../../../ui/LucideIcon';
import { Tabs, TabPanel, type TabItem } from '../../../ui/navigation/Tabs';
import avatarSarah from '../../../assets/avatars/untitled-ui/Sarah Page.jpg';
import { EmployeeSideDrawerFrame } from './EmployeeSideDrawerFrame';
import { Icon } from './profile/ProfileIconSprite';

export interface ProfileDrawerTemplateProps {
  open: boolean;
  onClose: () => void;
  facts?: boolean;
  tabs?: boolean;
  footer?: boolean;
}

const TEMPLATE_TABS = ['Overview', 'Employment', 'Documents', 'Readiness', 'Access', 'Activity'] as const;
type TemplateTab = (typeof TEMPLATE_TABS)[number];

const TAB_EMPTY_STATE: Record<TemplateTab, { icon: LucideName; illustration: IllustrationVariant; title: string; text: string }> = {
  Overview: { icon: 'LayoutDashboard', illustration: 'profile', title: 'No profile summary yet', text: 'Employee highlights and key profile information will appear here.' },
  Employment: { icon: 'BriefcaseBusiness', illustration: 'people', title: 'No employment details yet', text: 'Assignment, employment terms, payroll, and work history will appear here.' },
  Documents: { icon: 'FileText', illustration: 'documents', title: 'No employee documents yet', text: 'Uploaded documents, verification status, and expiry dates will appear here.' },
  Readiness: { icon: 'ShieldCheck', illustration: 'workflow', title: 'No readiness workflow yet', text: 'Required checks, owners, and follow-up steps will appear here.' },
  Access: { icon: 'KeyRound', illustration: 'search', title: 'No access assignments yet', text: 'System access, roles, and support assignments will appear here.' },
  Activity: { icon: 'History', illustration: 'schedule', title: 'No recent activity yet', text: 'Employee changes and scheduled events will appear here.' },
};

const TEMPLATE_TAB_ITEMS: readonly TabItem[] = TEMPLATE_TABS.map(tab => ({
  id: tab,
  label: tab,
  icon: <LucideIcon name={TAB_EMPTY_STATE[tab].icon} />,
}));

/**
 * Canonical Employee Master drawer shell.
 *
 * The frame owns the approved profile hero, facts, navigation, empty body slot,
 * and pinned footer. Domain information is composed into the active panel by a
 * consumer; it is intentionally absent from this reusable shell.
 */
export function ProfileDrawerTemplate({
  open,
  onClose,
  facts = true,
  tabs = true,
  footer = true,
}: ProfileDrawerTemplateProps): VNode | null {
  const [activeTab, setActiveTab] = useState<TemplateTab>('Overview');
  const emptyState = TAB_EMPTY_STATE[activeTab];

  return (
    <EmployeeSideDrawerFrame open={open} onClose={onClose} label="Profile drawer modal template" className="sds-employee-side-drawer-preview">
      <main class="drawer sds-employee-slideout" aria-label="Profile drawer modal template">
        <section class="identity">
          <div class="identity-grid">
            <Avatar name="Sarah Page" src={avatarSarah} seed="EMP-0097" size={84} class="portrait-shell" />
            <div>
              <div class="name-line"><h1>Sarah Page</h1><Badge tone="success" contrast="inverse" size="sm" dot>Active</Badge></div>
              <div class="employee-no">EMP-0097</div>
              <div class="identity-lines">
                <span><Icon id="briefcase" />HR Business Partner</span>
                <span><Icon id="building" />People &amp; Culture · Head Office</span>
              </div>
            </div>
          </div>
          {facts && <div class="facts">
            <div class="fact"><Icon id="shield" /><span>Employment Type</span><strong>Permanent</strong></div>
            <div class="fact"><Icon id="clock" /><span>Work Schedule</span><strong>Full-Time</strong></div>
            <div class="fact"><Icon id="calendar" /><span>Start Date</span><strong>12 Mar 2021</strong></div>
            <div class="fact"><Icon id="clock" /><span>Tenure</span><strong>5 years</strong></div>
          </div>}
        </section>

        {tabs && <Tabs id="profile-drawer-template" items={TEMPLATE_TAB_ITEMS} value={activeTab} onChange={id => setActiveTab(id as TemplateTab)} label="Profile drawer sections" variant="underline" size="sm" class="epd-drawer-tabs" />}

        <div class="scroll">
          <TabPanel tabsId="profile-drawer-template" tabId={activeTab} value={activeTab} class="panel active sds-profile-drawer-template__empty">
            <EmptyState
              headingLevel={3}
              size="compact"
              visual={<Illustration variant={emptyState.illustration} treatment="soft" />}
              title={emptyState.title}
              text={emptyState.text}
            />
          </TabPanel>
        </div>

        {footer && <footer class="footer">
          <div class="left-actions"><Button variant="outline" onClick={onClose}>View Full Employee Record</Button></div>
          <div class="right-actions"><Button variant="primary">Request Change</Button></div>
        </footer>}
      </main>
    </EmployeeSideDrawerFrame>
  );
}
