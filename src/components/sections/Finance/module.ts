/**
 * src/components/sections/Finance/module.ts
 *
 * Finance feature module (ModuleDefinition). Declares the "Finance" sidebar group
 * and its two sub-modules — Statutory Configuration and Payroll — then self-registers
 * at import. Surfaces the finance backend (routes/financeStatutory + financeNis +
 * financePayroll) that previously had no UI. Finance owns the statutory treatment
 * (NIS / PAYE / Health Surcharge versions), the pay-component catalogue, and payroll
 * runs / payslips / exports.
 */

import { registerModule, type ModuleDefinition, type ModuleNavItem } from '@lib/moduleRegistry';
import { mountFinanceSection, unmountFinanceSection } from './mount';

const FINANCE_ROOT_ID = 'preact-finance-root';

const STATUTORY_ITEM: ModuleNavItem = {
  id: 's-finance-statutory',
  label: 'Statutory Configuration',
  icon: 'fa-file-shield',
  sub: 'NIS / PAYE / Health Surcharge rate versions, pay components & NIS verification',
};

const PAYROLL_ITEM: ModuleNavItem = {
  id: 's-finance-payroll',
  label: 'Payroll',
  icon: 'fa-money-check-dollar',
  sub: 'Pay runs, calculation, approval, payslips & statutory export',
};

const REMITTANCES_ITEM: ModuleNavItem = {
  id: 's-finance-remittances',
  label: 'Statutory Remittances',
  icon: 'fa-file-invoice-dollar',
  sub: 'PAYE/BIR, NIS/NIBTT and Health Surcharge remittances & filing',
};

export const financeModule: ModuleDefinition = {
  id: 'finance',
  navGroup: { id: 'finance', label: 'Finance' },
  navItems: [STATUTORY_ITEM, PAYROLL_ITEM, REMITTANCES_ITEM],
  roles: ['admin', 'superadmin'],
  mount: {
    sectionId: 's-finance',
    rootId: FINANCE_ROOT_ID,
    mount:   (root, ctx) => mountFinanceSection(root, { queryClient: ctx.queryClient as never }),
    unmount: (root) => unmountFinanceSection(root),
  },
  visibilityNamespace: 'finance',
};

registerModule(financeModule);
