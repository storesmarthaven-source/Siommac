# SIOMAC ERP — Platform Overview

**What is SIOMAC?**

SIOMAC is an all-in-one business management platform built for companies that employ people in the field — construction, energy, facilities management, manufacturing, and similar industries. It brings Human Resources, Health & Safety, Finance, and day-to-day operations into a single connected system, so nothing falls through the cracks when an employee starts a new job, a safety incident happens, or payroll is due.

Everything in SIOMAC is connected. When a new hire joins, their onboarding automatically triggers tasks for IT to set up accounts and Safety to issue PPE. When payroll is approved, the deductions flow straight into statutory remittance filings. When an incident is investigated, findings link directly to corrective actions and the permit system. You manage the whole picture from one place, with one login.

---

## Table of Contents

1. [Human Resources](#1-human-resources)
2. [Health, Safety & Environment (HSE)](#2-health-safety--environment-hse)
3. [Finance & Payroll](#3-finance--payroll)
4. [Communications & Collaboration](#4-communications--collaboration)
5. [Approval Workflows](#5-approval-workflows)
6. [Scalability](#6-scalability)
7. [Personalized Dashboard & Widgets](#7-personalized-dashboard--widgets)
8. [Settings & Configuration](#8-settings--configuration)
9. [AI Integration & Future Integrations](#9-ai-integration--future-integrations)
10. [Security & Compliance](#10-security--compliance)

---

## 1. Human Resources

The HR module is the largest part of SIOMAC. It covers the full employee lifecycle from the day someone is hired to the day they leave.

### Employee Master

The single record of truth for every person in your organisation.

- Full employee profiles: personal details, contact information, nationality, emergency contacts, and employment history.
- Track employment status over time — active, probation, suspended, terminated.
- Upload and manage employee documents (contracts, certifications, ID) directly on the profile with expiry tracking and renewal alerts.
- Maker-checker change requests: any sensitive change (salary, department, role) goes through a reviewer before it takes effect, with a full audit trail of who changed what and when.
- Bulk import employees from a spreadsheet when you are getting started.

### Organization Structure

A clear picture of how your company is organised.

- Departments and sub-departments, with managers and reporting lines.
- Positions and job titles with defined levels.
- Cost centres for financial tracking and reporting.
- Visual org chart so anyone can see who reports to whom.
- Changes to the org structure (moving a department, changing a reporting line) go through a risk-checked approval before they take effect.

### Onboarding Command Center

Onboarding a new employee is a coordinated effort across multiple teams. The Command Center gives HR a single dashboard that shows every new hire's progress at a glance: what tasks are done, what is overdue, and what is blocking someone from starting work.

- Onboarding cases automatically generate task lists based on the employee's role (standard hire, safety-critical, supervisor, contractor, and more).
- Tasks are assigned to specific people — HR, IT, Safety, Finance — and each person sees their own to-do list.
- Blockers can be logged when something is genuinely stuck, so nothing silently stalls.
- Handoffs between departments are tracked: when IT finishes account setup, Finance is automatically notified to process the bank details.
- The Package Manager lets HR build and maintain custom onboarding templates, including company-specific task lists and custom sign-off requirements.
- Reports workspace shows completion rates, case duration, and how long each stage takes — so you can spot where onboarding reliably gets stuck.

### Offboarding

The mirror image of onboarding — a structured checklist that ensures nothing is missed when someone leaves.

- Offboarding cases cover clearance (equipment returned, access cards collected), access removal (system accounts closed), exit interviews, and final pay documentation.
- Handles both resignations and terminations with appropriate task sets for each.
- Access removal is a tracked handoff to IT so it cannot be forgotten.
- Timeline and audit log prove every step was completed, for legal and compliance purposes.

### Leave & Absence

A self-service leave system that replaces paper forms and chased-down approvals.

- Employees submit leave requests from their own profile — annual leave, sick leave, maternity/paternity leave, and more.
- Leave balances and accruals are tracked automatically so employees always know what they have left.
- Managers get a queue of pending requests for their team, and approve or decline with a reason.
- HR sees the organisation-wide leave calendar to spot coverage gaps.
- Policy rules (notice period, maximum consecutive days, blackout periods) are configured in one place and enforced automatically.

### Attendance & Timekeeping

GPS-verified check-in and check-out for field teams, with a full review and approval layer for managers.

- Employees check in and out via their phone. The system records their location at the time.
- Daily attendance log shows who is on site, who is late, and who has not shown up.
- Attendance exceptions (late arrivals, early departures, missing punches) are flagged automatically so managers only review the exceptions, not every record.
- Timesheets are submitted for manager approval at the end of the period.
- Attendance corrections can be submitted with a reason when something needs to be fixed after the fact.
- Live view shows who is currently checked in, useful for safety headcounts.

### Transfers & Promotions

Bundled change requests for when an employee moves departments, gets promoted, or has their pay adjusted.

- A single request captures all the related changes together: new department, new job title, new manager, new salary — so they all go through one approval and take effect at the same time.
- Effective-date scheduling means you can approve a transfer today and set it to apply on a future date.
- Full change history on the employee record.

### HR Requests (Self-Service)

An employee-facing request centre for anything that does not fit neatly into another process.

- Employees submit requests for things like reference letters, schedule changes, document copies, or profile corrections.
- HR triages and fulfils each request, with status updates visible to the employee.
- Approval routing for requests that need a manager's sign-off before HR can act.

### Shift Roster

Shift planning and scheduling for teams that work in rotations.

- Build shift schedules by site, department, or team. Assign employees to shifts.
- Rotation patterns handle teams on regular cycles without re-entering the same schedule every week.
- Coverage-gap detection highlights days or shifts that are under-staffed before the schedule is published.
- Employees are notified when a schedule is published.

### Compensation

The record of what each employee earns, separate from the payroll run itself.

- Salary and pay-component records per employee (base pay, allowances, recurring deductions).
- Overtime submissions go through an approval workflow before feeding into payroll.
- NIS (statutory) profiles are maintained here and verified by Finance before payroll is processed.

### HR Documents

A standalone document library across all employees, separate from the per-profile view.

- Filter and search across all employee documents by type, status, expiry date, or department.
- Expiry alerts and renewal reminders are sent automatically when documents (certifications, contracts, IDs) are approaching their expiry date.
- Documents can be marked as required — the system tracks whether each employee has supplied what is expected.

---

## 2. Health, Safety & Environment (HSE)

The HSE module covers every aspect of workplace safety and environmental compliance. It is built around the principle that safety events should be reported quickly, investigated thoroughly, and never repeat.

### Incidents

The starting point for any safety event.

- Report an incident quickly: capture what happened, where, who was involved, the injury or environmental impact, and the immediate response.
- The incident register shows all events with their current status — open, under investigation, closed.
- Incidents automatically trigger an investigation workflow when they require a formal review.

### Investigations

Turning an incident into a root-cause finding.

- Each investigation is linked to its parent incident and walks through a structured review: timeline, contributing factors, root cause analysis, and findings.
- Evidence attachments (photos, witness statements, documents) are stored directly on the investigation record.
- Completed investigations produce formal findings that feed into CAPA actions.

### Corrective & Preventive Actions (CAPA)

Ensuring findings are acted on, not forgotten.

- Each CAPA action has an owner, a due date, a description of the corrective measure, and a verification step.
- Overdue actions are automatically flagged and escalated.
- CAPA actions can be linked back to the incident and investigation that created them, so the full chain — event, investigation, fix — is traceable.

### Permits to Work (PTW)

A control gate for high-risk activities like working at height, confined space entry, hot work, and electrical isolation.

- Permits are created using templates for each work type. Each template includes the required hazard controls, safety checks, and sign-off steps.
- A permit goes through defined approval steps before work can begin, and is closed out when work is complete.
- Custom hazard profiles can be added to any permit.
- Automated sweeps flag permits that are approaching expiry or have not been closed out, and alert the relevant supervisor.

### Risk Assessments & Job Safety Analysis (JSA)

Proactive risk identification before work starts.

- Risk assessments document the hazards for a task or location, rate each hazard's likelihood and severity, and record the controls in place.
- Once a risk assessment is approved, you can generate a Job Safety Analysis directly from it — the hazards carry across, so you are not starting from scratch.
- JSAs walk through each job step, the hazards at each step, and the required controls.
- Both can be exported as a PDF.
- A hazard register keeps track of all identified hazards across the organisation.

### Inspections

Scheduled safety inspections with a formal findings process.

- Set up inspection schedules by site, area, or asset type.
- Record findings during an inspection, including photos and descriptions.
- Findings with corrective actions are tracked to closure, similar to CAPA.
- Insight cards show inspection completion rates and outstanding findings at a glance.

### Training & Competency

Tracking who is qualified to do what.

- A competency matrix shows which roles require which training or certifications.
- Individual employee certification records are stored with expiry dates.
- Alerts fire when a certification is approaching expiry, so you are not caught with an unqualified worker.

### Toolbox Talks

Daily safety briefings for field teams.

- Log each toolbox talk — the topic covered, the date, the site, and who attended.
- Attendance is recorded so you have a record of who has received each safety briefing.

### PPE Manager

End-to-end management of personal protective equipment.

- Inventory: track what PPE stock you have, by type and location.
- Assign PPE to individual employees and record when it was issued.
- Role matrix: define which PPE each role requires so there is a clear standard.
- Track renewals and returns. Flag items that are overdue for replacement.
- Requests from employees for new or replacement PPE.
- Inspections of PPE condition.
- Fit testing records for equipment like respirators.
- Procurement tracking for ordering new stock.
- Site kits: pre-defined PPE sets for specific sites or tasks.

### Contractor Management

Managing the safety obligations for contractors who work on your sites.

- Contractor register: a record of every contractor company you work with.
- Induction log: who has completed the site safety induction, when, and which version of the induction they received.
- HSE files: the contractor's safety documentation (insurance, safety plans, certifications).
- Site access control: gate site access based on whether the contractor's files are current.

### Legal & Compliance

Staying on top of regulatory obligations.

- OSH obligations register: the legal duties your organisation must meet, with due dates and status.
- EMA permit register for environmental permits.
- Breach log for recording regulatory notices or violations.
- Regulatory calendar for upcoming deadlines.

### Emergency Response

Planning and readiness for emergency situations.

- Emergency plans by site or scenario.
- Muster points: where people should gather if an alarm sounds.
- Drill log: record of every emergency drill conducted.
- Emergency Response Team (ERT) register: who is trained and responsible for emergency response.

### Environmental Management

Tracking environmental incidents and compliance.

- Spill register for recording any spills, their containment, and clean-up.
- Waste manifests for tracking controlled waste from creation to disposal.
- EMA notification records for incidents that must be reported to the environmental authority.
- Environmental monitoring log for ongoing data collection (water, air, noise).

### Documents & Safety Data Sheets

A central library for all HSE documentation.

- Store and search HSE policies, procedures, risk registers, and safety plans.
- Safety Data Sheet (SDS) library for all hazardous substances on site.

### HSE Workflows

HSE uses the same central approval engine as every other module, with a dedicated view inside the HSE area for seeing approvals, workflow history, and audit logs without leaving HSE.

---

## 3. Finance & Payroll

The Finance module handles everything from calculating pay to filing statutory deductions with the government.

### Statutory Configuration

Setting the rules before payroll runs.

- Manage rate versions for each statutory deduction type — income tax (PAYE), National Insurance (NIS), and Health Surcharge — for each jurisdiction.
- Each version goes through an approval workflow before it becomes active, with segregation of duties enforced (the person who creates the rate cannot also approve it).
- Only one rate version is active at a time, preventing accidental double-counting.
- Pay components catalogue: define the earnings and deductions that apply to your payroll (basic salary, housing allowance, pension, union dues, and so on).

### Payroll

The full payroll run lifecycle, end to end.

- Create a payroll run for a period. The system locks employee pay inputs (rate, hours, components) so nothing changes mid-calculation.
- Calculation step produces a line-by-line result for every employee — gross pay, each deduction, net pay, and any warnings (missing hours, missing bank details).
- The run is submitted for approval. Approvers cannot be the same person who created the run.
- Once approved, the run is locked and payslips are generated automatically.
- Exports package the payroll data for handoff to bank disbursement or external reporting.

### Statutory Remittances

Paying the government what is owed.

- Once payroll is approved, remittance totals for PAYE, NIS, and Health Surcharge are calculated from the deduction lines.
- Remittances go through their own approval before they are filed.
- Filing and receipt tracking so you have a record of when each remittance was submitted and confirmed.

### Bank Disbursements

Paying employees.

- Generate an EFT bank file from an approved payroll run, ready to submit to your bank.
- Disbursement status tracks whether the bank file has been sent and whether payment has been confirmed.

### Expense Claims

Letting employees claim back money they have spent for work.

- Employees submit expense claims with a category, amount, description, and receipt attachment.
- Each claim is allocated to a cost centre.
- Claims go through an approval workflow before reimbursement.
- Finance tracks which claims have been reimbursed and which are outstanding.

### External Accounting Boundary

Accounts Payable, Budgeting, General Ledger, and financial statements belong in
dedicated accounting software. SIOMAC may exchange approved payroll, remittance,
disbursement, and reimbursable-expense data with that system, but does not duplicate
its accounting modules.

### Employee Self-Service (My Payslips)

Employees can view and download their own payslips any time.

- Payslip history by pay period.
- Secure download link for each payslip PDF.
- A notification is sent when a new payslip is ready.

### NIS Profile Verification

A cross-module check to make sure employees are correctly set up for statutory deductions.

- HR captures each employee's statutory profile (NIS number, contribution class, applicability).
- Finance verifies the profile before it feeds into payroll, with a dedicated approval workflow.

---

## 4. Communications & Collaboration

Everything in SIOMAC is connected to a shared communications layer. This means that conversations, notifications, and support requests all live alongside the records they relate to, rather than scattered across email inboxes.

### Notifications

- Every significant event in the system generates a notification for the people it affects.
- Notifications are grouped and can be marked as read or dismissed.
- Preferences let users control which events they want to be notified about and how.

### Message Threads

- Direct conversations between employees and managers or HR, visible to both parties.
- Threads can be linked to a specific record (an incident, a leave request, an onboarding case) so context is never lost.
- Read receipts show when a message has been seen.

### Support Tickets

- Employees can raise a support ticket for any HR, IT, or operational issue.
- Tickets have a status (open, in progress, resolved, closed) and a response thread.
- Managers and HR see all tickets assigned to them in one queue.

### File Attachments

- Documents and photos can be attached to any record — incidents, investigations, permits, change requests, tickets, and more.
- Files are stored securely. Sensitive files use secure, time-limited download links.

---

## 5. Approval Workflows

One of the most important parts of SIOMAC is the central workflow engine. Rather than every module having its own bespoke approval process, every major action across every module routes through the same engine.

**What this means in practice:**

- A payroll approval, a transfer approval, and a permit-to-work approval all follow the same pattern: someone creates a request, it moves through defined approval steps, and the approver sees it in their Approvals inbox.
- Approval steps can be sequential (one person at a time) or parallel (multiple people simultaneously).
- Each module defines its own approval rules — who needs to approve what — and those rules are versioned so changes are tracked.
- Segregation of duties is enforced wherever required: the person who initiates a payroll run cannot approve it.
- Every approval decision is recorded in the audit log.
- The Approval Inbox is a single place where any user can see everything waiting for their review, regardless of which module it came from.

Handoffs are the companion concept: when a task in one module needs action from a different team, the workflow engine creates a handoff — a trackable, owned item that moves from the originating team to the receiving team. For example, when a new employee's onboarding case reaches the "IT setup" stage, a handoff is created for IT, who then complete the task and mark it done, at which point the case moves forward automatically.

---

## 6. Scalability

SIOMAC is built to grow with your business, not be rebuilt when you grow.

**One shared platform, new modules plug in:** Every module — HR, HSE, Finance — is built on the same shared backbone. Approvals, notifications, audit logging, document storage, and inter-department handoffs are platform capabilities, not per-module custom code. Adding a new module means it automatically inherits all of these capabilities on day one.

**Event-driven design:** When something significant happens in the system (a payroll is approved, an incident is reported, an employee is offboarded), an event is recorded centrally. Other parts of the system react to that event independently — Finance sees a payroll event and prepares the disbursement; Safety sees an onboarding event and schedules a PPE issue. This means modules can be added or extended without rewiring everything else.

**Handles field scale:** The attendance system was designed for large, distributed field teams. Geo-verified check-ins, live operations views, and automated exception detection are built to work at high volume without administrators manually reviewing every record.

**Multi-site architecture:** Departments, cost centres, project sites, and reporting lines are all modelled as first-class concepts. The system can support multiple physical locations, each with their own rules, managers, and compliance requirements.

**Role-scoped data:** Managers see their own department's data; employees see only their own records. This is enforced at the data level, not just in the interface, so it scales without creating an administrative burden on access management.

---

## 7. Personalized Dashboard & Widgets

Every user in SIOMAC gets a personalised dashboard — a board of cards and charts that they arrange to show the information most relevant to their role.

**How it works:**

- Open the Widget Library and browse hundreds of available insight cards — KPI counters, trend charts, status summaries, task boards, and timelines — drawn from every module you have access to.
- Drag them onto your board, resize them, and arrange them however you like.
- Your layout is saved automatically and follows you between devices.
- Each widget shows live data from the underlying module, refreshed on a regular schedule.

**What kinds of widgets are available:**

- HR: headcount, open onboarding cases, employees by department, leave requests pending, overdue offboarding items.
- HSE: open incidents, overdue CAPA actions, permit status, inspection completion rate, expiring certifications.
- Finance: payroll runs in progress, remittances due, expense claims pending approval, budget-vs-actual summary.
- Operations: attendance live view, shift coverage.

**Customisation:**

- Each widget can be configured individually — for example, a "leave pending" widget can be scoped to a specific department.
- The board has pre-built default layouts for common roles, so a new user is not starting with an empty screen.
- Administrators can install additional widget packages — a collection of pre-built widgets in a file — to extend the library without a software release.

---

## 8. Settings & Configuration

SIOMAC is highly configurable, but configuration is governed — it is not a free-for-all.

- All configurable settings (approval thresholds, leave policy rules, notification preferences, payroll constants, PTW requirements) are defined in a catalogue.
- Each setting has a name, description, data type, and the minimum role required to change it.
- Changes to settings go through a review process so no one person can silently alter a business rule.
- Settings are versioned. You can see who changed a setting, when, and what the previous value was.
- Each module ships with its own settings section, so HSE settings are in the HSE area, leave policy is in the HR area, and so on — you do not need to dig through a single enormous settings page.

---

## 9. AI Integration & Future Integrations

**Current status — designed for integration, not yet integrated:**

SIOMAC does not currently ship with live AI or machine learning features. The platform has been built with integration in mind — its event backbone, structured data model, and clean API layer make it well-suited to add AI capabilities without rearchitecting anything.

**Where AI integration is a natural fit (on the roadmap):**

- **Incident analysis:** The system captures structured data on every incident — type, location, time, contributing factors, root cause category. This data set is ready to surface patterns (which site has the most near-misses, which job type generates the most injuries) with an AI-assisted analysis layer.
- **Document intelligence:** HR and HSE generate a significant volume of documents. An AI layer could assist with classifying, summarising, or extracting key information from uploads.
- **Natural language search:** The rich data across employees, incidents, permits, and payroll could support a plain-English query interface, letting managers ask questions like "how many overtime hours did the maintenance team work in Q2?" without building a custom report.
- **Workflow recommendations:** The workflow engine already has rich data on how long each approval step takes and how often requests are rejected at each step. AI could surface recommendations to streamline approval chains.
- **Predictive alerts:** Attendance patterns, leave trends, and safety incident data could be used to flag emerging risks before they become problems.

**Third-party integrations (roadmap):**

The platform's event-driven backbone means external systems can react to events happening inside SIOMAC. Planned integration points include:

- Bank EFT file formats for net-pay disbursements (already built for the bank disbursement module).
- Government statutory filing portals (PAYE, NIS, Health Surcharge) for direct submission rather than manual filing.
- Biometric clocking devices for attendance capture as an alternative to phone check-in.
- Single sign-on (SSO) for organisations that want employees to use their existing company login.

---

## 10. Security & Compliance

Security is not an afterthought in SIOMAC — it is built into every layer of the platform.

### Multi-Factor Authentication

Every user can secure their account with a second factor beyond their password.

- **Authenticator app (TOTP):** the user scans a QR code into any authenticator app (Google Authenticator, Authy, and so on) and enters a six-digit code at each login.
- **Passkeys:** a modern, phishing-resistant alternative — the user authenticates with their device's biometrics (fingerprint, face) or PIN, and no password is transmitted.
- **Backup codes:** one-time codes stored securely by the user, for when their primary device is unavailable.
- Administrators can require MFA for specific roles.

### Trusted Devices

Once a user has logged in and verified their second factor on a device, they can mark that device as trusted. Future logins from the same device skip the second-factor prompt for a configurable period.

### Step-Up Authentication

Certain high-risk actions — changing a password, viewing sensitive payroll data, modifying security settings — require the user to re-verify their identity before proceeding, even if they are already logged in. This limits the damage if a session is accidentally left open.

### Role-Based Access Control

Every piece of functionality in SIOMAC is protected by a permission. Permissions are organised into a master catalogue, and each role (employee, manager, HR staff, HR manager, finance staff, finance manager, admin, super-admin) has a defined set of permissions by default.

- Permissions can be granted or revoked per individual user for fine-grained control.
- The permission catalogue is the single source of truth — there are no hidden access shortcuts.
- Any new feature ships with its permissions defined in the catalogue before it is released.

### Rate Limiting

Repeated failed login attempts are automatically blocked. The rate limiter is distributed — it works correctly even when the system is handling high traffic across multiple servers.

### Full Audit Logging

Every action that changes data in SIOMAC is recorded in an immutable audit log: who did it, when, from where, and what changed. This covers:

- Employee record changes.
- Payroll operations (run creation, approval, export).
- Safety events (incident reporting, permit issuance, CAPA decisions).
- Access and security events (logins, failed logins, MFA changes, trusted-device registration).
- Settings changes.

Audit logs are accessible to authorised administrators without requiring database access.

### Data Scoping

Employees only see their own records. Managers see their own department. No one sees data outside their scope unless an administrator has explicitly granted access.

### Secure File Handling

Sensitive documents (payslips, employee records, safety evidence) use short-lived, secure download links. The file is never publicly accessible — each download link expires after a short window.

### Data Retention

Each data type has a defined retention period based on legal and regulatory requirements. Personal location data (GPS check-ins), attendance photos, and similar sensitive records are subject to automatic expiry. Payroll and financial records are retained for the period required by tax law.

---

*SIOMAC is a continuously evolving platform. New modules and capabilities are added in a structured sequence, with each module proven end-to-end before the next is built.*
