/**
 * src/components/sections/Finance/FinanceSection.tsx
 *
 * Single-panel router for the Finance module. Listens to the app-wide
 * `siomac:section` nav event and swaps between the Statutory Configuration,
 * Payroll, Remittances, and My Payslips overviews.
 * Mirrors HRSection's pattern (localStorage-persisted active id).
 */

import { type VNode } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { FinanceOverview }         from './FinanceOverview';
import { StatutoryConfigOverview } from './StatutoryConfigOverview';
import { PayrollOverview }          from './PayrollOverview';
import { PayrollSetupOverview }     from './PayrollSetupOverview';
import { RemittancesOverview }      from './RemittancesOverview';
import { MyPayslipsOverview }       from './MyPayslipsOverview';
import { ExpensesOverview }         from './ExpensesOverview';
import { BudgetsOverview }          from './BudgetsOverview';
import { DisbursementsOverview }   from './DisbursementsOverview';
import { PayablesOverview }        from './PayablesOverview';

const OVERVIEW_ID      = 's-finance-overview';
const PAYABLES_ID      = 's-finance-payables';
const STATUTORY_ID    = 's-finance-statutory';
const PAYROLL_ID       = 's-finance-payroll';
const PAYROLL_SETUP_ID = 's-finance-payroll-setup';
const REMITTANCES_ID   = 's-finance-remittances';
const MY_PAYSLIPS_ID   = 's-finance-my-payslips';
const EXPENSES_ID      = 's-finance-expenses';
const BUDGETS_ID       = 's-finance-budgets';
const DISBURSEMENTS_ID  = 's-finance-disbursements';

function isFinanceSection(id: string): boolean {
  return id === OVERVIEW_ID
    || id === STATUTORY_ID
    || id === PAYROLL_ID
    || id === PAYROLL_SETUP_ID
    || id === REMITTANCES_ID
    || id === EXPENSES_ID
    || id === MY_PAYSLIPS_ID
    || id === BUDGETS_ID
    || id === DISBURSEMENTS_ID
    || id === PAYABLES_ID
   ;
}

export function FinanceSection(): VNode {
  const [sectionId, setSectionId] = useState<string>(() => {
    try { return localStorage.getItem('siomac_finance_section') ?? OVERVIEW_ID; } catch { return OVERVIEW_ID; }
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

  if (sectionId === STATUTORY_ID)    return <StatutoryConfigOverview />;
  if (sectionId === EXPENSES_ID)     return <ExpensesOverview />;
  if (sectionId === PAYROLL_ID)      return <PayrollOverview />;
  if (sectionId === PAYROLL_SETUP_ID) return <PayrollSetupOverview />;
  if (sectionId === REMITTANCES_ID)  return <RemittancesOverview />;
  if (sectionId === MY_PAYSLIPS_ID)  return <MyPayslipsOverview />;
  if (sectionId === BUDGETS_ID)       return <BudgetsOverview />;
  if (sectionId === DISBURSEMENTS_ID) return <DisbursementsOverview />;
  if (sectionId === PAYABLES_ID)      return <PayablesOverview />;
  return <FinanceOverview />;
}
