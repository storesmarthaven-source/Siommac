/**
 * src/components/sections/Finance/FinanceSection.tsx
 *
 * Single-panel router for the Finance module. Listens to the app-wide
 * `siomac:section` nav event and swaps between the Statutory Configuration and
 * Payroll overviews. Mirrors HRSection's pattern (localStorage-persisted active id).
 */

import { type VNode } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { StatutoryConfigOverview } from './StatutoryConfigOverview';
import { PayrollOverview }          from './PayrollOverview';
import { RemittancesOverview }      from './RemittancesOverview';

const STATUTORY_ID   = 's-finance-statutory';
const PAYROLL_ID      = 's-finance-payroll';
const REMITTANCES_ID  = 's-finance-remittances';

function isFinanceSection(id: string): boolean {
  return id === STATUTORY_ID || id === PAYROLL_ID || id === REMITTANCES_ID;
}

export function FinanceSection(): VNode {
  const [sectionId, setSectionId] = useState<string>(() => {
    try { return localStorage.getItem('siomac_finance_section') ?? STATUTORY_ID; } catch { return STATUTORY_ID; }
  });

  useEffect(() => {
    function onSection(e: Event): void {
      const id = (e as CustomEvent<string>).detail;
      if (isFinanceSection(id)) {
        setSectionId(id);
        try { localStorage.setItem('siomac_finance_section', id); } catch (_) { /* ignore */ }
      }
    }
    window.addEventListener('siomac:section', onSection);
    return () => window.removeEventListener('siomac:section', onSection);
  }, []);

  if (sectionId === PAYROLL_ID)     return <PayrollOverview />;
  if (sectionId === REMITTANCES_ID) return <RemittancesOverview />;
  return <StatutoryConfigOverview />;
}
