/**
 * src/components/sections/HR/HRSection.tsx
 *
 * HR module shell. One panel serves every HR nav item: the active section id
 * (broadcast by the sidebar via 'siomac:section') selects the page — Employee
 * Master or the Onboarding Overview board. Mirrors the HSE shell pattern.
 *
 * Also listens for the dedicated 'siomac:hr-onboarding-open-case' event (dispatched
 * by the Employee Profile Drawer's "View Full Case" button) — a SEPARATE event from
 * 'siomac:section' because that one is a generic app-wide nav switch whose `detail`
 * is always a plain section-id string; overloading it with a nested payload would
 * change a contract other module shells rely on too.
 */

import { type VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useAnyCan } from '@lib/permissions';
import { EmployeeMaster } from './EmployeeMaster';
import { OnboardingOverview } from './OnboardingOverview';
import { OrgStructureOverview } from './OrgStructureOverview';
import { HRDocumentsOverview } from './HRDocumentsOverview';
import { OffboardingOverview } from './OffboardingOverview';
import { LeaveOverview }      from './LeaveOverview';
import { TransfersOverview }   from './TransfersOverview';
import { HRRequestsOverview }  from './HRRequestsOverview';
import { AttendanceOverview }  from './AttendanceOverview';
import { RosterOverview }      from './RosterOverview';
import { CompensationOverview } from './CompensationOverview';
import { OvertimeOverview }     from './OvertimeOverview';
import { WorkCalendarPage }     from '../Finance/payroll/setup/WorkCalendarSetup';

const EMP_ID       = 's-hr-employees';
const ONB_ID       = 's-hr-onboarding';
const ORG_ID       = 's-hr-organization';
const DOC_ID       = 's-hr-documents';
const OFF_ID       = 's-hr-offboarding';
const LEAVE_ID     = 's-hr-leave';
const TRANSFERS_ID = 's-hr-transfers';
const REQ_ID       = 's-hr-requests';
const ATTENDANCE_ID = 's-hr-attendance';
const ROSTER_ID    = 's-hr-roster';
const COMP_ID      = 's-hr-compensation';
const OT_ID        = 's-hr-overtime';
const WORKCAL_ID   = 's-hr-work-calendar';

const HR_PAGE_PERMISSIONS: Record<string, readonly string[]> = {
  [EMP_ID]:        ['hr.employees.view'],
  [ONB_ID]:        ['hr.onboarding.view'],
  [ORG_ID]:        ['hr.organization.view'],
  [DOC_ID]:        ['hr.employee_documents.view'],
  [OFF_ID]:        ['hr.offboarding.view'],
  [LEAVE_ID]:      ['hr.leave.view'],
  [TRANSFERS_ID]:  ['hr.transfers.view'],
  [REQ_ID]:        ['hr.requests.submit_own', 'hr.requests.manage'],
  [ATTENDANCE_ID]: ['hr.attendance.view'],
  [ROSTER_ID]:     ['hr.roster.view'],
  [COMP_ID]:       ['hr.compensation.view'],
  [OT_ID]:         ['hr.overtime.view', 'hr.overtime.submit'],
  [WORKCAL_ID]:    ['hr.work_calendar.view'],
};

function PermissionDenied({ permissions }: { permissions: readonly string[] }): VNode {
  return (
    <div class="hr-offboarding fin-page" data-testid="hr-permission-denied" role="alert">
      <div class="obx-section">
        <div class="obx-section-body obx-empty">
          <i class="fas fa-lock" aria-hidden="true" />
          <h2>Permission required</h2>
          <p>You do not have a required capability for this HR page: <code>{permissions.join(' or ')}</code>.</p>
          <p>Ask an administrator to review your role or access grant.</p>
        </div>
      </div>
    </div>
  );
}

function isHrSection(id: string): boolean {
  return id === EMP_ID || id === ONB_ID || id === ORG_ID || id === DOC_ID || id === OFF_ID || id === LEAVE_ID || id === TRANSFERS_ID || id === REQ_ID || id === ATTENDANCE_ID || id === ROSTER_ID || id === COMP_ID || id === OT_ID || id === WORKCAL_ID;
}

export function HRSection(): VNode {
  const [sectionId, setSectionId] = useState<string>(() => {
    try { return localStorage.getItem('siomac_hr_section') ?? EMP_ID; } catch { return EMP_ID; }
  });
  const [pendingCaseId, setPendingCaseId] = useState<string | null>(null);
  const requiredPermissions = HR_PAGE_PERMISSIONS[sectionId] ?? ['hr.view'];
  const permitted = useAnyCan(requiredPermissions);

  useEffect(() => {
    function onSection(e: Event): void {
      const id = (e as CustomEvent<string>).detail;
      if (isHrSection(id)) {
        setSectionId(id);
        try { localStorage.setItem('siomac_hr_section', id); } catch (_) { /* ignore */ }
      }
    }
    function onOpenCase(e: Event): void {
      const caseId = (e as CustomEvent<{ caseId?: string } | undefined>).detail?.caseId;
      if (!caseId) return;
      setSectionId(ONB_ID);
      try { localStorage.setItem('siomac_hr_section', ONB_ID); } catch (_) { /* ignore */ }
      setPendingCaseId(caseId);
    }
    window.addEventListener('siomac:section', onSection);
    window.addEventListener('siomac:hr-onboarding-open-case', onOpenCase);
    return () => {
      window.removeEventListener('siomac:section', onSection);
      window.removeEventListener('siomac:hr-onboarding-open-case', onOpenCase);
    };
  }, []);

  if (!permitted) return <PermissionDenied permissions={requiredPermissions} />;

  if (sectionId === LEAVE_ID)     return <LeaveOverview />;
  if (sectionId === ORG_ID)      return <OrgStructureOverview />;
  if (sectionId === DOC_ID)      return <HRDocumentsOverview />;
  if (sectionId === OFF_ID)      return <OffboardingOverview />;
  if (sectionId === TRANSFERS_ID) return <TransfersOverview />;
  if (sectionId === REQ_ID)       return <HRRequestsOverview />;
  if (sectionId === ATTENDANCE_ID) return <AttendanceOverview />;
  if (sectionId === ROSTER_ID)     return <RosterOverview />;
  if (sectionId === COMP_ID)       return <CompensationOverview />;
  if (sectionId === OT_ID)         return <OvertimeOverview />;
  if (sectionId === WORKCAL_ID)    return <WorkCalendarPage />;
  return sectionId === ONB_ID
    ? <OnboardingOverview initialCaseId={pendingCaseId} />
    : <EmployeeMaster />;
}
