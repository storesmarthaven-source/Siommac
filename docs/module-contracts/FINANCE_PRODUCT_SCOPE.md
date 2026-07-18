# Finance Product Scope

Status: authoritative  
Decision date: 2026-07-18

## Product boundary

SIOMAC Finance is payroll- and workforce-finance software. It is not a general
accounting ledger.

Active product capabilities:

- Payroll command centre, payroll runs, approvals, exceptions, payslips, and reports
- Payroll setup, pay groups, pay components, overtime rules, and employee loans
- Payslip template design and employee self-service payslips
- Trinidad and Tobago statutory configuration, remittances, filing, and forms
- Payroll bank disbursements and employee bank-account readiness
- Employee expense claims and payroll reimbursement handoffs
- Shared cost-centre and employee reference data used by those workflows

Retired product capabilities:

- Accounts Payable, including suppliers, bills, duplicate detection, payment runs,
  and AP reporting
- Budgeting and Budget-vs-Actual
- The old combined Finance Overview dashboard, which was primarily an AP and budget
  aggregation surface

General ledger, Accounts Receivable, fixed assets, cash reconciliation, and financial
statements are also outside the SIOMAC product boundary. A future accounting-system
integration may exchange approved payroll journals, remittance liabilities,
disbursement outcomes, and reimbursable expenses. It must not recreate a second
accounting system inside SIOMAC.

## Runtime contract

Retired capabilities have no:

- Finance navigation entry or routable frontend page
- frontend API hook or query-key family
- mounted Netlify route
- active backend service
- workflow explicit-start registration
- permission-catalog or role-bundle entry
- active E2E suite or coverage waiver

`finance.overview.view` is retained as a legacy-named shared-reference permission.
It grants access only to bounded cost-centre and employee lookup endpoints used by
active Finance workflows. It does not expose a Finance Overview page.

## Data-retention contract

Historical Accounts Payable and Budgeting data is retained for audit, legal, and
migration purposes. Do not drop or rewrite:

- existing `finance_ap_*`, `finance_budget_*`, or related attachment tables
- historical migrations
- historical app events, audit rows, workflow records, messages, or attachments

No new business records may be created through those schemas. Legacy message cards
may remain readable as historical evidence, but no active resolver may create new AP
or budget collaboration records.

Before deploying this decommission to an environment with active AP workflows, an
operator must inventory and close or cancel those workflows using an approved
audited runbook. Do not silently delete in-flight work.

## Reintroduction rule

Reintroducing Accounts Payable or Budgeting requires a new approved product-scope
decision and a full contract-to-code review. Historical build documents are not
authorization to restore the modules.
