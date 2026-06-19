/**
 * src/components/sections/HSE/HSESection.tsx
 *
 * HSE module shell. One panel serves every HSE nav item: the active section id
 * (broadcast by the sidebar via 'siomac:section') selects the page — the HSE
 * Dashboard, one of the functional areas (Incidents, Risk, Permits, …), or a
 * PPE Manager tab. Navigation lives entirely in the sidebar, so there is no
 * in-page tab bar. The area resolver is data-driven (HSE_AREAS in nav.ts), so a
 * new area needs no edits here.
 */

import { type VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { HSEDashboard } from './HSEDashboard';
import { PpeBody } from './PPEManager';
import { AreaRouter } from './AreaRouter';
import { ppeTabForSection, PPE_PARENT_ID, sectionToArea } from './nav';
import './HSE.css';

const HSE_DASHBOARD_ID = 's-hse-dashboard';

type Page =
  | { kind: 'dashboard' }
  | { kind: 'ppe'; tab: string }
  | { kind: 'area'; area: string; tab: string };

/** Resolve which page to show from a logical section id. */
function pageFor(sectionId: string): Page {
  const ppeTab = ppeTabForSection(sectionId);
  if (ppeTab) return { kind: 'ppe', tab: ppeTab };
  if (sectionId === PPE_PARENT_ID) return { kind: 'ppe', tab: 'dashboard' };
  const area = sectionToArea(sectionId);
  if (area) return { kind: 'area', area: area.area.key, tab: area.tab };
  return { kind: 'dashboard' };
}

/** True if a section id belongs to the HSE module (any page). */
function isHseSection(id: string): boolean {
  return id === HSE_DASHBOARD_ID || id === PPE_PARENT_ID || !!ppeTabForSection(id) || !!sectionToArea(id);
}

export function HSESection(): VNode {
  const [sectionId, setSectionId] = useState<string>(() => {
    try { return localStorage.getItem('siomac_hse_section') ?? HSE_DASHBOARD_ID; } catch { return HSE_DASHBOARD_ID; }
  });

  useEffect(() => {
    function onSection(e: Event) {
      const id = (e as CustomEvent<string>).detail;
      if (isHseSection(id)) {
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
      {page.kind === 'dashboard' ? <HSEDashboard />
        : page.kind === 'ppe'    ? <PpeBody tab={page.tab} />
        :                          <AreaRouter area={page.area} tab={page.tab} />}
    </div>
  );
}
