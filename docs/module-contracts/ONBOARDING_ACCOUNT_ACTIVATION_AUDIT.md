# Onboarding Account Activation Audit

## Product decision

Account activation belongs in onboarding while the case is open. After the employee
activates the account, ongoing access health and support move to Employee Record →
Access.

Account setup must not assume that every organisation has an IT department. The
organisation chooses an operating model in Settings:

| Operating model | Onboarding behaviour |
| --- | --- |
| HR managed | An authorised HR user provisions the SIOMAC identity and sends the invitation. |
| IT/Admin managed | HR requests account setup; the configured IT/Admin owner completes it. |
| Shared | HR prepares and submits the request; IT/Admin completes the technical steps. |

The setting controls routing. Permissions still control whether the current user may
perform the action. A department name must never grant authority by itself.

## Responsibility split

### SIOMAC owns

- Generating a unique work-email address from the configured domain and naming rule.
- Creating the SIOMAC/Supabase Auth sign-in identity.
- Issuing a single-use activation invitation to the verified personal email.
- Recording invitation, expiry, activation, event and audit state.
- Showing the assigned access profile and security requirements.

### The organisation or directory provider owns

- Creating the real Microsoft 365, Google Workspace or other work mailbox.
- Assigning licences, groups, equipment and external directory access.
- Confirming those actions through the onboarding handoff.

If no directory integration exists, the configured HR/Admin owner completes and
confirms the mailbox task manually. SIOMAC must not imply that setting a `work_email`
field created a real mailbox.

## Access profile

The access profile is selected and approved before provisioning. The activation dialog
shows it read-only.

Changing the profile is a separate, elevated access-assignment action with its own
permission and audit trail. Provisioning must not silently change an employee's access
because somebody selected a different option in the invitation dialog.

## Correct dialog states

### 1. Account setup overview

- Operating model and accountable owner
- Proposed work email
- Assigned access profile
- Mailbox provider/status
- Verified personal-email destination
- Invitation expiry and MFA requirement, both read-only from policy

Primary action:

- **Provision and invite** when the actor is authorised and the model is HR managed.
- **Request account setup** when IT/Admin owns execution.
- **Submit for completion** in the shared model.

### 2. Request or provisioning receipt

- SIOMAC identity created / requested
- Mailbox handoff state
- Invitation delivery state
- Accountable owner and due date
- One clear next action

### 3. Invitation pending

- Destination (masked personal email)
- Sent and expiry times
- Resend action, capability gated
- Copy-link fallback only when delivery failed; one-time reveal and audited

### 4. Activated

- Activation time
- MFA enrolment state
- Assigned access profile
- Link to Employee Record → Access

The onboarding widget disappears after case completion, but its history remains in the
case timeline and audit trail.

## Current mockup/backend gaps

1. The dialog's editable work-email local part is not accepted by the provisioning API;
   the server generates the address.
2. The Access Profile dropdown is not accepted by the provisioning API and should be
   read-only.
3. “Personal email + SMS” is shown, but the backend currently sends personal email only.
4. The dialog offers 72-hour and 7-day expiry, but the backend uses a fixed seven days.
5. The dialog offers security-policy choices, but MFA belongs to the assigned access
   profile/security policy.
6. `account_default_credential_method` advertises invite link, temporary password and
   passkey, but provisioning currently implements invite link only.
7. `auto_provision_account_on_start` is declared in Settings but is not consumed.
8. There is no onboarding account-provisioning ownership setting. Account-support
   ownership exists, but that governs support requests after provisioning and must not
   be reused as if it were the same workflow.
9. The current service creates an IT mailbox handoff even when the organisation has no
   IT operating model.
10. The handoff write and event emission must be checked as part of the provisioning
    outcome; partial success must not leave an account without its required work item
    or audit/event record.

## Settings required

These controls belong in the existing global settings catalog at
**Settings → Module Policy → HR Onboarding → Account Setup**. They are not a
separate onboarding administration page. Packages decide whether and when an
account is required; the organisation-level settings below decide who may perform
the work and how it is routed.

- Account provisioning operating model: `hr_managed`, `it_admin_managed`, `shared`
- Accountable user or role for IT/Admin-managed and shared modes
- Fallback owner when the configured person is inactive
- Work-email domain and naming rule
- Directory/mailbox mode: integration, manual confirmation, or SIOMAC-only sign-in
- Invitation method (only methods with a real implementation may be offered)
- Invitation expiry
- Provision timing: manual, case start, or after configured readiness gate
- Whether activation is required for Day-One Ready

## Recommended implementation order

1. Add and resolve the provisioning ownership settings.
2. Make the service return a preflight/read model for the dialog.
3. Remove unsupported inputs from the request contract and mockup.
4. Route direct provisioning or a governed handoff from the operating model.
5. Harden provisioning so every required write is checked and recoverable.
6. Rebuild the dialog around the four states above.
7. Cover HR-managed, IT/Admin-managed, shared, delivery-failure and activation flows in
   the live onboarding E2E suite.
