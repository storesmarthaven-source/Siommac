# Finance Module Map

Current scope is governed by
`docs/module-contracts/FINANCE_PRODUCT_SCOPE.md`.

## Active modules

| Capability | Primary surfaces | Dependencies |
|---|---|---|
| Payroll operations | Command centre, runs, approvals, exceptions, payslips, reports | HR employee/pay data, workflow, audit, events |
| Payroll setup | Pay groups, components, overtime rules, employee loans | HR roster, statutory configuration |
| Payslip design and ESS | Template studio, batches, My Payslips | Locked payroll runs, document storage, notifications |
| Statutory configuration | PAYE, NIS/NIBTT, Health Surcharge versions | Maker-checker workflow, audit |
| Statutory remittances and forms | Filing, receipts, TD4, NI184, NI187 | Locked payroll results, statutory versions |
| Bank disbursements | Bank readiness, export, outcome evidence | Approved payroll, employee bank accounts |
| Expense claims | Submission, approval, receipts, reimbursement handoff | Cost centres, workflow, payroll handoff |

## Shared foundations

- `finance_cost_centers` remains the shared allocation registry.
- `finance.overview.view` remains a legacy-named permission for bounded shared
  employee and cost-centre references only.
- Finance mutations use authenticated Netlify APIs, app events, audit records,
  workflow tasks, and handoff/notification side effects where required.
- `app_users.id` is TEXT.
- Creator/approver segregation of duties is enforced for financial approvals.

## Retired and out of scope

Accounts Payable, Budgeting, Budget-vs-Actual, and the old combined Finance Overview
are retired product surfaces. General ledger, Accounts Receivable, fixed assets,
cash reconciliation, and financial statements belong in dedicated accounting
software.

Historical schemas and migrations remain for audit and data migration. They are not
runtime modules and must not be mounted, linked, granted, or extended.

## Build sequence

1. Complete the payroll page slices and their read models.
2. Complete statutory remittances, filing, and statutory forms.
3. Complete payroll bank disbursement workflows.
4. Complete payslip distribution and employee self-service.
5. Complete expense-claim reimbursement integration where it benefits payroll.
6. Build an external-accounting integration contract only when a target accounting
   product and exchange format are approved.

Every active slice requires a frozen API contract, permission matrix, workflow and
side-effect ownership, live E2E coverage, and repository-map updates.
