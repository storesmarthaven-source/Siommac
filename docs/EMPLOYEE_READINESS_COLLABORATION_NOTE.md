# Employee Readiness Collaboration Note

## Purpose

Employee readiness is a shared operational workflow. HR owns the completeness of the employee record, while each specialist department owns the controls that require its authority or expertise.

The employee profile must therefore coordinate work without making HR responsible for Payroll, Learning, Account Support, statutory, or departmental decisions.

## Ownership Model

- **HR coordinator:** monitors overall readiness, assigns work, follows up, manages dates, and resolves HR-owned controls.
- **Department owner:** resolves or verifies controls in its domain.
- **Employee:** supplies information or evidence when requested.
- **Authorised reviewer:** approves the submitted result when a separate review is required.

Organisations may configure a domain as HR-managed, shared-services-managed, department-managed, or externally administered. The workflow remains the same; only the resolved owner and available capabilities change.

## Organisation Setting

Add a focused configuration under **Settings → Workforce → Readiness Ownership**.

Each readiness area has one operational owner:

| Readiness Area | Example Owner |
|---|---|
| Assignment | HR Operations |
| Payroll | Payroll Team |
| Training | Learning Team |
| Documents | HR Operations |
| Statutory | Payroll Team |
| Access | Account Support |

The owner selector uses existing organisation teams or authorised users. A small organisation can set **Payroll → HR Operations** when HR performs Payroll work. A larger organisation can set **Payroll → Payroll Team**.

This setting controls:

- where the work item is routed;
- who receives notifications and overdue reminders;
- which workspace the user opens;
- which capabilities are required to complete the control;
- whether HR sees coordination actions or specialist completion actions.

It does not grant authority by itself. The selected owner must still hold the required capability. If no valid owner exists, the blocker fails closed and appears as **Owner Required** for an administrator to configure.

## Canonical Lifecycle

1. `open`
2. `assigned`
3. `waiting_for_information`
4. `submitted_for_review`
5. `in_review`
6. `ready`

Exceptional terminal outcomes are `exception_approved` and `not_applicable`. Rejected evidence returns to `waiting_for_information` with a correction request; it is not a terminal state.

## Resolution Types

The system must not treat every blocker as a document-upload problem. A control definition declares one resolution type:

- `field_correction`
- `document_evidence`
- `training_completion`
- `department_verification`
- `support_request`
- `external_system_confirmation`

The work-item panel adapts its information and actions to the configured resolution type.

## Employee Profile UI

The Readiness tab contains:

- readiness coverage;
- shared-work explanation;
- unresolved blocking work;
- control matrix;
- recently resolved work and review history when implemented.

Employee tabs show indicators only for unresolved work:

- red count for blocked, overdue, missing, or critical items;
- amber count for pending review or expiring items;
- blue dot for an active informational workflow that does not require action;
- no indicator when the tab has no unresolved work.

Counts come from the underlying authorised work items and disappear when those items are completed. They are not manually maintained UI values.

Each blocker row shows:

- control and blocking reason;
- responsible department;
- the party expected to act now;
- status and ageing;
- one **Open Work Item** action.

The work-item panel provides the complete context, evidence or source record, collaboration history, internal notes, and only the actions authorised for the current user.

## Work-Item Dialog Plan

The dialog is a focused decision workspace, not another summary page. Its order is:

1. employee, department owner, HR coordinator, and the current user’s role;
2. the blocking outcome and current workflow stage;
3. the submitted source information or evidence;
4. the two or three valid next actions for that control and role;
5. an explicit explanation of what each submission will change;
6. a persistent footer with Cancel and one outcome-specific submission button.

The title uses the real task name, such as **Confirm Payroll Account Details**, rather than a generic “Resolve Control” label. The primary action label changes with the selected outcome.

For Payroll account confirmation, Employee Master does not duplicate Finance:

- HR sees the owner, stage, due status, and masked account context.
- HR can send an overdue reminder to Payroll.
- Payroll accepts the details or requests an employee correction from its authorised workspace.
- Payroll’s result updates the readiness control automatically.

The employee profile never exposes the protected Finance acceptance action. A Payroll user working in the authorised Payroll/Finance workspace sees **Review Bank Details**; an organisation that assigns Payroll to HR may expose that action only to HR users holding the required Payroll capability.

For Training evidence:

- **Return To Learning Team** reopens the department task with reviewer feedback.
- **Approve And Complete** accepts the evidence and makes the Training control ready.

Every outcome identifies who acts next. HR may coordinate, remind, reassign, or add notes without receiving specialist approval authority.

## Mutation Contract

Every readiness transition must atomically:

1. update the control instance;
2. record the state transition;
3. recalculate employee readiness;
4. emit the application event;
5. write the audit record;
6. create or complete workflow tasks;
7. notify affected participants;
8. create a handoff when another module owns the work.

No UI may offer a success action that the backend does not implement, and HR must not receive specialist resolution authority merely because it can view or coordinate a blocker.
