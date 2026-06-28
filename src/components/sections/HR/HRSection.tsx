/**
 * src/components/sections/HR/HRSection.tsx
 *
 * HR module shell. One panel serves every HR nav item: the active section id
 * (broadcast by the sidebar via 'siomac:section') selects the page — Employee
 * Master or the Onboarding Overview board. Mirrors the HSE shell pattern.
 */

import { type VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { EmployeeMaster } from './EmployeeMaster';
import { OnboardingOverview } from './OnboardingOverview';

const EMP_ID = 's-hr-employees';
const ONB_ID = 's-hr-onboarding';

function isHrSection(id: string): boolean {
  return id === EMP_ID || id === ONB_ID;
}

export function HRSection(): VNode {
  const [sectionId, setSectionId] = useState<string>(() => {
    try { return localStorage.getItem('siomac_hr_section') ?? EMP_ID; } catch { return EMP_ID; }
  });

  useEffect(() => {
    function onSection(e: Event): void {
      const id = (e as CustomEvent<string>).detail;
      if (isHrSection(id)) {
        setSectionId(id);
        try { localStorage.setItem('siomac_hr_section', id); } catch (_) { /* ignore */ }
      }
    }
    window.addEventListener('siomac:section', onSection);
    return () => window.removeEventListener('siomac:section', onSection);
  }, []);

  return sectionId === ONB_ID ? <OnboardingOverview /> : <EmployeeMaster />;
}
