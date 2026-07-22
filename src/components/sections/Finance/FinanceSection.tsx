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
import { can } from '@lib/permissions';
import { showSection } from '@components/nav/navCore';
import { PayslipStudioSection }    from '../PayslipStudio/PayslipStudioSection';
import { FinanceOverview }         from './FinanceOverview';
import { StatutoryConfigOverview } from './StatutoryConfigOverview';
import { PayrollCommandCenter }     from './PayrollCommandCenter';
import { PayrollRunRegisterPage }   from './PayrollRunRegisterPage';
import { PayrollExceptionQueuePage } from './PayrollExceptionQueuePage';
import { PayrollPayslipBatchesPage } from './PayrollPayslipBatchesPage';
import { PayrollReportsPage }        from './PayrollReportsPage';
import { PayrollSetupOverview }     from './PayrollSetupOverview';
import { RemittancesOverview }      from './RemittancesOverview';
import { ExpensesOverview }         from './ExpensesOverview';
import { BudgetsOverview }          from './BudgetsOverview';
import { DisbursementsOverview }   from './DisbursementsOverview';
import { StatutoryFormsOverview }  from './StatutoryFormsOverview';
import { PayablesOverview }        from './PayablesOverview';

const OVERVIEW_ID      = 's-finance-overview';
const PAYABLES_ID      = 's-finance-payables';
const STATUTORY_ID    = 's-finance-statutory';
const PAYROLL_ID       = 's-finance-payroll';
const PAYROLL_RUNS_ID  = 's-finance-payroll-runs';
const PAYROLL_EXCEPTIONS_ID = 's-finance-payroll-exceptions';
const PAYSLIP_BATCHES_ID = 's-finance-payroll-payslips';
const PAYROLL_REPORTS_ID = 's-finance-payroll-reports';
const PAYROLL_SETUP_ID = 's-finance-payroll-setup';
const REMITTANCES_ID   = 's-finance-remittances';
const EXPENSES_ID      = 's-finance-expenses';
const BUDGETS_ID       = 's-finance-budgets';
const DISBURSEMENTS_ID  = 's-finance-disbursements';
const STATUTORY_FORMS_ID = 's-finance-statutory-forms';
const PAYSLIP_DESIGNER_ID = 's-finance-payslip-designer';

function isFinanceSection(id: string): boolean {
  return id === OVERVIEW_ID
    || id === STATUTORY_ID
    || id === PAYROLL_ID
    || id === PAYROLL_RUNS_ID
    || id === PAYROLL_EXCEPTIONS_ID
    || id === PAYSLIP_BATCHES_ID
    || id === PAYROLL_REPORTS_ID
    || id === PAYROLL_SETUP_ID
    || id === REMITTANCES_ID
    || id === EXPENSES_ID
    || id === BUDGETS_ID
    || id === DISBURSEMENTS_ID
    || id === STATUTORY_FORMS_ID
    || id === PAYSLIP_DESIGNER_ID
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
  if (sectionId === PAYROLL_ID)      return <PayrollCommandCenter />;
  if (sectionId === PAYROLL_RUNS_ID)  return <PayrollRunRegisterPage />;
  if (sectionId === PAYROLL_EXCEPTIONS_ID) return <PayrollExceptionQueuePage />;
  if (sectionId === PAYSLIP_BATCHES_ID) return <PayrollPayslipBatchesPage />;
  if (sectionId === PAYROLL_REPORTS_ID) return <PayrollReportsPage />;
  if (sectionId === PAYROLL_SETUP_ID) return <PayrollSetupOverview />;
  if (sectionId === REMITTANCES_ID)  return <RemittancesOverview />;
  if (sectionId === BUDGETS_ID)       return <BudgetsOverview />;
  if (sectionId === DISBURSEMENTS_ID) return <DisbursementsOverview />;
  if (sectionId === STATUTORY_FORMS_ID) return <StatutoryFormsOverview />;
  if (sectionId === PAYSLIP_DESIGNER_ID)
    return can('finance.payroll.templates.manage')
      ? <PayslipStudioSection onBack={() => showSection('s-finance-overview')} />
      : <div style="padding:48px;text-align:center;color:var(--muted,#8a93ab);font-size:14px;">
          You don't have permission to manage payslip templates.
        </div>;
  if (sectionId === PAYABLES_ID)      return <PayablesOverview />;
  return <FinanceOverview />;
}
