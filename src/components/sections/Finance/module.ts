/**
 * src/components/sections/Finance/module.ts
 *
 * Finance feature module (ModuleDefinition). Declares the "Finance" sidebar group
 * and its sub-modules — Statutory Configuration, Payroll, Statutory Remittances,
 * and My Payslips (employee self-service, F3) — then self-registers at import.
 * Finance owns the statutory treatment (NIS / PAYE / Health Surcharge versions),
 * the pay-component catalogue, payroll runs / payslips / exports, and remittances.
 */

import { registerModule, type ModuleDefinition, type ModuleNavItem } from '@lib/moduleRegistry';
import { mountFinanceSection, unmountFinanceSection } from './mount';

const FINANCE_ROOT_ID = 'preact-finance-root';

const OVERVIEW_ITEM: ModuleNavItem = {
  id: 's-finance-overview',
  label: 'Overview',
  icon: 'fa-sack-dollar',
  sub: 'Finance dashboard — remittances, expenses, budgets & disbursements (customizable board)',
};

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

const MY_PAYSLIPS_ITEM: ModuleNavItem = {
  id: 's-finance-my-payslips',
  label: 'My Payslips',
  icon: 'fa-file-invoice',
  sub: 'View and download your own payslips (employee self-service)',
};
const EXPENSES_ITEM: ModuleNavItem = {
  id: 's-finance-expenses',
  label: 'Expense Claims',
  icon: 'fa-receipt',
  sub: 'Employee expense claims with cost-centre allocation and reimbursement tracking',
};

const BUDGETS_ITEM: ModuleNavItem = {
  id: 's-finance-budgets',
  label: 'Budgeting',
  icon: 'fa-chart-pie',
  sub: 'Budget lines per cost centre / fiscal year, Budget-vs-Actual variance tracking',
};

const DISBURSEMENTS_ITEM: ModuleNavItem = {
  id: 's-finance-disbursements',
  label: 'Bank Disbursements',
  icon: 'fa-building-columns',
  sub: 'EFT bank file generation and net-pay disbursements from approved payroll runs',
};

export const financeModule: ModuleDefinition = {
  id: 'finance',
  navGroup: { id: 'finance', label: 'Finance' },
  navItems: [OVERVIEW_ITEM, STATUTORY_ITEM, PAYROLL_ITEM, REMITTANCES_ITEM, DISBURSEMENTS_ITEM, MY_PAYSLIPS_ITEM, EXPENSES_ITEM, BUDGETS_ITEM],
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
