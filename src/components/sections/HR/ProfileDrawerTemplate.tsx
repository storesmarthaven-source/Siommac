import { type VNode } from 'preact';
import { EmptyState } from '../../../ui/components/EmptyState';
import { Illustration } from '../../../ui/feedback/Illustration';
import { Button } from '../../../ui/primitives/Button';
import { Badge } from '../../../ui/primitives/Badge';
import { Avatar } from '../../../ui/people/Avatar';
import { LucideIcon } from '../../../ui/LucideIcon';
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

const OVERVIEW_TAB = 'overview';
const TEMPLATE_TAB_ITEMS: readonly TabItem[] = [{
  id: OVERVIEW_TAB,
  label: 'Overview',
  icon: <LucideIcon name="LayoutDashboard" />,
}];

/**
 * Canonical Employee Master drawer shell.
 *
 * The frame owns the approved profile hero, facts, one Overview panel, and pinned
 * footer. The drawer is deliberately a quick summary; Employment, Documents,
 * Readiness, Access, and Activity belong to the full employee record page.
 */
export function ProfileDrawerTemplate({
  open,
  onClose,
  facts = true,
  tabs = true,
  footer = true,
}: ProfileDrawerTemplateProps): VNode | null {
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

        {tabs && <Tabs id="profile-drawer-template" items={TEMPLATE_TAB_ITEMS} value={OVERVIEW_TAB} onChange={() => undefined} label="Profile drawer overview" variant="underline" size="sm" class="epd-drawer-tabs" />}

        <div class="scroll">
          <TabPanel tabsId="profile-drawer-template" tabId={OVERVIEW_TAB} value={OVERVIEW_TAB} class="panel active sds-profile-drawer-template__empty">
            <EmptyState
              headingLevel={3}
              size="compact"
              visual={<Illustration variant="profile" treatment="soft" />}
              title="No profile summary yet"
              text="Employee highlights and key profile information will appear here. Open the full record for complete employee details."
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
