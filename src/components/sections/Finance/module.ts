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

const PAYABLES_ITEM: ModuleNavItem = {
  id: 's-finance-payables',
  label: 'Accounts Payable',
  icon: 'fa-file-invoice-dollar',
  sub: 'Vendor bills, approvals and payments',
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

// F-14 — every payroll operational page nests under the "Payroll" parent
// (s-finance-payroll, which routes to the Command Center): Runs, Approvals &
// Exceptions, Payslip Batches, Reports, Payroll Setup, Payslip Designer, Bank
// Disbursements and Statutory Forms. The sub-menu is expanded by default (see
// navCore) so these are reachable out of the box.
const PAYROLL_RUNS_ITEM: ModuleNavItem = {
  id: 's-finance-payroll-runs',
  label: 'Payroll Runs',
  icon: 'fa-list-check',
  parent: 's-finance-payroll',
  sub: 'Operational register of every scheduled, off-cycle, correction and final-pay run + the pay-date calendar',
};

const PAYROLL_EXCEPTIONS_ITEM: ModuleNavItem = {
  id: 's-finance-payroll-exceptions',
  label: 'Approvals & Exceptions',
  icon: 'fa-user-check',
  parent: 's-finance-payroll',
  sub: 'One work queue for payroll approvals, blocking findings and warnings across every run',
};

const PAYSLIP_BATCHES_ITEM: ModuleNavItem = {
  id: 's-finance-payroll-payslips',
  label: 'Payslip Batches',
  icon: 'fa-file-invoice-dollar',
  parent: 's-finance-payroll',
  sub: 'Generation, rendering and protected delivery of payslips for every locked payroll run',
};

// F-12 — Reports Center: preview + export reports from locked, authorized runs.
const PAYROLL_REPORTS_ITEM: ModuleNavItem = {
  id: 's-finance-payroll-reports',
  label: 'Reports',
  icon: 'fa-chart-column',
  parent: 's-finance-payroll',
  sub: 'Payroll register, net-pay, cost, reconciliation, variance, overtime, movements & NIS reports',
  // Gate the nav item + direct route on the same permission the API enforces, so it
  // never appears (or opens) for a user whose calls would only 403.
  permission: 'finance.payroll.reports.view',
};

const PAYROLL_SETUP_ITEM: ModuleNavItem = {
  id: 's-finance-payroll-setup',
  label: 'Payroll Setup',
  icon: 'fa-sliders',
  parent: 's-finance-payroll',
  sub: 'Pay groups (frequency & population) and overtime rules that drive the pay-run engine',
};

const PAYSLIP_DESIGNER_ITEM: ModuleNavItem = {
  id: 's-finance-payslip-designer',
  label: 'Payslip Designer',
  icon: 'fa-file-invoice',
  parent: 's-finance-payroll',
  sub: 'Design payslip layout templates (employer block, logo, sections, footer) used when rendering payslips',
};

const REMITTANCES_ITEM: ModuleNavItem = {
  id: 's-finance-remittances',
  label: 'Statutory Remittances',
  icon: 'fa-file-invoice-dollar',
  sub: 'PAYE/BIR, NIS/NIBTT and Health Surcharge remittances & filing',
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
  parent: 's-finance-payroll',
  sub: 'EFT bank file generation and net-pay disbursements from approved payroll runs',
};

const STATUTORY_FORMS_ITEM: ModuleNavItem = {
  id: 's-finance-statutory-forms',
  label: 'Statutory Forms',
  icon: 'fa-file-contract',
  parent: 's-finance-payroll',
  sub: 'Year-end BIR TD4 + TD4 Summary and NIBTT NI184/NI187 generated from locked payroll runs',
};

export const financeModule: ModuleDefinition = {
  id: 'finance',
  navGroup: { id: 'finance', label: 'Finance' },
  navItems: [OVERVIEW_ITEM, PAYABLES_ITEM, STATUTORY_ITEM, PAYROLL_ITEM, PAYROLL_RUNS_ITEM, PAYROLL_EXCEPTIONS_ITEM, PAYSLIP_BATCHES_ITEM, PAYROLL_REPORTS_ITEM, PAYROLL_SETUP_ITEM, PAYSLIP_DESIGNER_ITEM, REMITTANCES_ITEM, STATUTORY_FORMS_ITEM, DISBURSEMENTS_ITEM, EXPENSES_ITEM, BUDGETS_ITEM],
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
