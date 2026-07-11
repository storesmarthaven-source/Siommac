/**
 * src/components/sections/AccessControl/AccessControlSection.tsx
 *
 * Sub-view router for the Access Control section. One panel serves all 7 nav
 * items; it swaps the page on the `siomac:section` nav event (same pattern as
 * FinanceSection). The last sub-view is persisted so re-entry lands where you left.
 *
 * Overview is the new mockup-faithful page. Users / Roles / Module Coverage /
 * Approvals / Audit / Sessions currently render the existing wired console tabs
 * (fully functional) and are being reskinned to their mockups in place.
 */

import { type VNode } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { AcOverviewPage }  from './pages/AcOverviewPage';
import { AcUsersPage }     from './pages/AcUsersPage';
import { AcRolesPage }     from './pages/AcRolesPage';
import { AcCoveragePage }  from './pages/AcCoveragePage';
import { AcApprovalsPage } from './pages/AcApprovalsPage';
import { AcAuditPage }     from './pages/AcAuditPage';
import { AcSessionsPage }  from './pages/AcSessionsPage';
import { PayslipStudioSection } from '../PayslipStudio/PayslipStudioSection';
import './accessControl.css';

const OVERVIEW = 's-ac-overview';
const PAYSLIP_DESIGNER = 's-ac-payslip-designer';
const IDS = new Set([OVERVIEW, 's-ac-users', 's-ac-roles', 's-ac-coverage', 's-ac-approvals', 's-ac-audit', 's-ac-sessions', PAYSLIP_DESIGNER]);

export function AccessControlSection(): VNode {
  const [sectionId, setSectionId] = useState<string>(() => {
    try { return localStorage.getItem('siomac_ac_section') ?? OVERVIEW; } catch { return OVERVIEW; }
  });

  useEffect(() => {
    function onSection(e: Event): void {
      const id = (e as CustomEvent<string>).detail;
      if (IDS.has(id)) {
        setSectionId(id);
        try { localStorage.setItem('siomac_ac_section', id); } catch (_) { /* ignore */ }
      }
    }
    window.addEventListener('siomac:section', onSection);
    return () => window.removeEventListener('siomac:section', onSection);
  }, []);

  if (sectionId === 's-ac-users')     return <AcUsersPage />;
  if (sectionId === 's-ac-roles')     return <AcRolesPage />;
  if (sectionId === 's-ac-coverage')  return <AcCoveragePage />;
  if (sectionId === 's-ac-approvals') return <AcApprovalsPage />;
  if (sectionId === 's-ac-audit')     return <AcAuditPage />;
  if (sectionId === 's-ac-sessions')  return <AcSessionsPage />;
  if (sectionId === PAYSLIP_DESIGNER) return <PayslipStudioSection />;
  return <AcOverviewPage />;
}
