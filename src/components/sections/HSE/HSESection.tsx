/**
 * src/components/sections/HSE/HSESection.tsx
 *
 * HSE module shell. One panel serves every HSE nav item: the active section id
 * (broadcast by the sidebar via the 'siomac:section' event) selects the page —
 * the HSE Dashboard or one of the PPE Manager tabs. Navigation lives entirely in
 * the sidebar (HSE group → Dashboard + collapsible PPE Manager → sub-items), so
 * there is no in-page tab bar.
 */

import { type VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { HSEDashboard } from './HSEDashboard';
import { PpeBody } from './PPEManager';
import { ppeTabForSection, PPE_PARENT_ID } from './nav';
import './HSE.css';

const HSE_DASHBOARD_ID = 's-hse-dashboard';

/** Resolve which page to show from a logical section id. */
function pageFor(sectionId: string): { kind: 'dashboard' } | { kind: 'ppe'; tab: string } {
  const tab = ppeTabForSection(sectionId);
  if (tab) return { kind: 'ppe', tab };
  if (sectionId === PPE_PARENT_ID) return { kind: 'ppe', tab: 'dashboard' };
  return { kind: 'dashboard' };
}

export function HSESection(): VNode {
  // Seed from the persisted last section so a reload lands on the right page.
  const [sectionId, setSectionId] = useState<string>(() => {
    try { return localStorage.getItem('siomac_hse_section') ?? HSE_DASHBOARD_ID; } catch { return HSE_DASHBOARD_ID; }
  });

  useEffect(() => {
    function onSection(e: Event) {
      const id = (e as CustomEvent<string>).detail;
      // Only react to HSE sections.
      if (id === HSE_DASHBOARD_ID || id === PPE_PARENT_ID || ppeTabForSection(id)) {
        setSectionId(id);
        try { localStorage.setItem('siomac_hse_section', id); } catch (_) {}
      }
    }
    window.addEventListener('siomac:section', onSection);
    return () => window.removeEventListener('siomac:section', onSection);
  }, []);

  const page = pageFor(sectionId);

  return (
    <div class="hse-module">
      {/* Both pages render their own dark hero (with the profile pill inside). */}
      {page.kind === 'dashboard' ? <HSEDashboard /> : <PpeBody tab={page.tab} />}
    </div>
  );
}
