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
import { EmployeeMaster } from './EmployeeMaster';
import { OnboardingOverview } from './OnboardingOverview';
import { OrgStructureOverview } from './OrgStructureOverview';
import { HRDocumentsOverview } from './HRDocumentsOverview';
import { OffboardingOverview } from './OffboardingOverview';
import { LeaveOverview }      from './LeaveOverview';
import { TransfersOverview }   from './TransfersOverview';
import { HRRequestsOverview }  from './HRRequestsOverview';
import { AttendanceOverview }  from './AttendanceOverview';

const EMP_ID       = 's-hr-employees';
const ONB_ID       = 's-hr-onboarding';
const ORG_ID       = 's-hr-organization';
const DOC_ID       = 's-hr-documents';
const OFF_ID       = 's-hr-offboarding';
const LEAVE_ID     = 's-hr-leave';
const TRANSFERS_ID = 's-hr-transfers';
const REQ_ID       = 's-hr-requests';
const ATTENDANCE_ID = 's-hr-attendance';

function isHrSection(id: string): boolean {
  return id === EMP_ID || id === ONB_ID || id === ORG_ID || id === DOC_ID || id === OFF_ID || id === LEAVE_ID || id === TRANSFERS_ID || id === REQ_ID || id === ATTENDANCE_ID;
}

export function HRSection(): VNode {
  const [sectionId, setSectionId] = useState<string>(() => {
    try { return localStorage.getItem('siomac_hr_section') ?? EMP_ID; } catch { return EMP_ID; }
  });
  const [pendingCaseId, setPendingCaseId] = useState<string | null>(null);

  useEffect(() => {
    function onSection(e: Event): void {
      const id = (e as CustomEvent<string>).detail;
      if (isHrSection(id)) {
        setSectionId(id);
        try { localStorage.setItem('siomac_hr_section', id); } catch (_) { /* ignore */ }
      }
    }
    function onOpenCase(e: Event): void {
      const caseId = (e as CustomEvent<{ caseId: string }>).detail?.caseId;
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

  if (sectionId === LEAVE_ID)     return <LeaveOverview />;
  if (sectionId === ORG_ID)      return <OrgStructureOverview />;
  if (sectionId === DOC_ID)      return <HRDocumentsOverview />;
  if (sectionId === OFF_ID)      return <OffboardingOverview />;
  if (sectionId === TRANSFERS_ID) return <TransfersOverview />;
  if (sectionId === REQ_ID)       return <HRRequestsOverview />;
  if (sectionId === ATTENDANCE_ID) return <AttendanceOverview />;
  return sectionId === ONB_ID
    ? <OnboardingOverview initialCaseId={pendingCaseId} />
    : <EmployeeMaster />;
}
