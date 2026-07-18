# Messenger Compliance V1 - Build-Ready Technical Implementation

Status: APPROVED V1 DELIVERY CONTRACT

Scope: A deliberately small, secure compliance workflow for approved,
time-limited access to specific conversations and basic evidence export.

This document replaces the earlier broad compliance design. Build only this V1.
Features listed under Explicit Deferrals are not part of this release.

## 1. V1 Outcome

Deliver a practical compliance feature containing:

1. Fail-closed `communications.compliance_read` and
   `communications.compliance_export` permissions.
2. Simple approved investigation cases.
3. Time-limited access to explicitly selected conversations.
4. A read-only conversation viewer.
5. An immutable access log.
6. Manual revocation and automatic expiry.
7. Basic PDF and JSON exports with SHA-256 checksums.
8. Access Control management with maker-checker approval.
9. Focused live E2E coverage.

This is not a general administrator chat viewer. A role name, including
`superadmin`, must not independently grant compliance access.

## 2. Security Model

### 2.1 Two authorization layers

Every compliance read requires both:

1. An active per-user critical permission grant for
   `communications.compliance_read`.
2. An approved, non-expired case grant for the actor and conversation.

Every export additionally requires an active per-user critical permission grant
for `communications.compliance_export`.

The backend checks both layers on every read and export. The frontend is not the
security boundary.

### 2.2 Maker-checker

Use the existing Access Control critical-permission approval system.

- A requester cannot approve their own critical permission.
- Critical grants have explicit validity dates.
- Pending, rejected, expired, and revoked grants do not authorize access.
- Superadmin does not bypass this process.

Investigation cases also require a second actor to approve them. The case
requester cannot approve their own case. The approver must independently hold
an active `communications.compliance_read` grant; V1 does not add a separate
case-approver permission.

### 2.3 Step-up

Require fresh step-up authentication for:

- approving an investigation case;
- exporting a conversation;
- authorizing every export download;
- revoking another investigator's active case grant.

Reuse:

- `netlify/functions/lib/stepUp.ts`
- `src/hooks/useStepUp.tsx`

Do not create a second step-up implementation.

### 2.4 Fail-closed behavior

Critical permission resolution must behave as follows:

- successful DB lookup: use the effective DB result;
- missing grant rows: deny;
- permission query failure: deny;
- expired or revoked grant: deny;
- explicit user deny: deny;
- role fallback: never restore a critical permission.

Remove `communications.compliance_read` and
`communications.compliance_export` from every static role allow-all fallback.

## 3. Ownership Boundary

### 3.1 Access Control

Access Control owns:

- critical capability requests;
- maker-checker approval;
- grant validity and expiry;
- explicit revocation;
- holder and approval history.

Access Control must not display message content, conversation previews,
attachments, investigation findings, or export contents.

### 3.2 Messenger Compliance

Messenger owns:

- investigation cases;
- conversation selection;
- case approval;
- time-limited case grants;
- read-only evidence viewing;
- access history;
- basic exports.

## 4. Current Problems V1 Must Remove

The current implementation is not acceptable until:

1. Superadmin no longer receives compliance permissions from static fallback.
2. `requestThreadAccess` cannot immediately self-grant access.
3. A compliance read requires an approved case and active case grant.
4. Grant, revoke, read, and export evidence is not best-effort.
5. Authenticated users cannot directly read all access-grant rows through RLS.
6. `recordThreadExport` cannot report success without creating a real export.
7. Compliance backend errors are not converted into successful empty results.
8. Compliance endpoints are removed from E2E coverage waivers.

## 5. V1 Data Model

Create migrations with `supabase migration new <descriptive-name>`. Do not
invent migration numbers.

All browser access goes through authenticated Netlify APIs. New tables enable
RLS and grant no browser mutation access. `app_users.id` references are TEXT.

### 5.1 `message_compliance_cases`

Purpose: the approved reason and validity window for an investigation.

Required columns:

- `id uuid primary key default gen_random_uuid()`
- `case_no text not null unique`
- `title text not null`
- `case_type text not null`
- `reason text not null`
- `status text not null`
- `requested_by text not null references app_users(id)`
- `requested_at timestamptz not null default now()`
- `approved_by text references app_users(id)`
- `approved_at timestamptz`
- `rejected_by text references app_users(id)`
- `rejected_at timestamptz`
- `decision_reason text`
- `valid_from timestamptz`
- `valid_until timestamptz not null`
- `closed_by text references app_users(id)`
- `closed_at timestamptz`
- `close_reason text`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Allowed types:

- `hr_investigation`
- `safety_investigation`
- `legal_request`
- `security_investigation`
- `other_formal_investigation`

Allowed statuses:

- `pending_approval`
- `approved`
- `rejected`
- `closed`

Invariants:

- requester and approver differ;
- `valid_until` is in the future at approval;
- rejected and closed cases cannot be reopened in V1;
- closing a case revokes all active grants in the same transaction;
- case validity cannot exceed 30 days;
- extension is not supported in V1; create a new case if further access is
  required.

Indexes:

- `(status, valid_until)`
- `(requested_by, created_at desc)`
- `(approved_by, approved_at desc)`

### 5.2 `message_compliance_case_threads`

Purpose: conversations explicitly requested under a case.

Required columns:

- `id uuid primary key default gen_random_uuid()`
- `case_id uuid not null references message_compliance_cases(id)`
- `thread_id uuid not null references message_threads(id)`
- `relevance_note text not null`
- `added_by text not null references app_users(id)`
- `created_at timestamptz not null default now()`

Constraints:

- unique `(case_id, thread_id)`;
- no message body is copied into this table.

Indexes:

- `(thread_id, case_id)`

### 5.3 `message_thread_access_grants`

Harden the existing table instead of creating another grant system.

Required V1 columns:

- existing primary key;
- `case_id uuid not null references message_compliance_cases(id)`
- `case_thread_id uuid not null references message_compliance_case_threads(id)`
- `thread_id uuid not null references message_threads(id)`
- `user_id text not null references app_users(id)`
- `granted_by text not null references app_users(id)`
- `granted_at timestamptz not null default now()`
- `expires_at timestamptz not null`
- `revoked_by text references app_users(id)`
- `revoked_at timestamptz`
- `revoke_reason text`
- `last_accessed_at timestamptz`

Invariants:

- one active grant per `(case_id, thread_id, user_id)`;
- expiry cannot exceed the case expiry;
- expiry cannot exceed seven days from approval;
- `revoked_at` immediately invalidates reads and exports;
- no authenticated-wide RLS SELECT policy;
- service-role APIs return only actor-authorized grant rows.

### 5.4 `message_compliance_access_events`

Purpose: immutable evidence of sensitive access.

Required columns:

- `id uuid primary key default gen_random_uuid()`
- `case_id uuid not null`
- `grant_id uuid`
- `thread_id uuid not null`
- `actor_user_id text not null`
- `event_type text not null`
- `occurred_at timestamptz not null default now()`
- `request_id text not null`
- `ip_hash text`
- `user_agent_hash text`
- `hash_key_version text`
- `details jsonb not null default '{}'::jsonb`

Allowed event types:

- `case_requested`
- `case_approved`
- `case_rejected`
- `conversation_opened`
- `page_read`
- `grant_revoked`
- `export_requested`
- `export_generated`
- `export_downloaded`
- `case_closed`

Rules:

- append-only;
- UPDATE and DELETE blocked;
- no message bodies;
- no raw IP addresses or user agents;
- hash evidence with the dedicated, versioned
  `COMPLIANCE_EVIDENCE_PEPPER_V1`; never fall back to another feature's key;
- index `(case_id, occurred_at desc)`;
- index `(actor_user_id, occurred_at desc)`;
- index `(thread_id, occurred_at desc)`.

### 5.5 `message_compliance_exports`

Purpose: one immutable record per generated evidence artifact.

Required columns:

- `id uuid primary key default gen_random_uuid()`
- `export_no text not null unique`
- `case_id uuid not null`
- `grant_id uuid not null`
- `thread_id uuid not null`
- `requested_by text not null`
- `format text not null check (format in ('pdf','json'))`
- `range_from timestamptz`
- `range_to timestamptz`
- `purpose text not null`
- `status text not null`
- `message_count integer`
- `storage_path text`
- `file_size bigint`
- `sha256 text`
- `serializer_version text`
- `snapshot_at timestamptz`
- `upload_started_at timestamptz`
- `requested_at timestamptz not null default now()`
- `generated_at timestamptz`
- `failure_code text`

Allowed statuses:

- `requested`
- `uploading`
- `ready`
- `failed`

Rules:

- no UPDATE after `ready`, except through the controlled download evidence path;
- no DELETE through application APIs;
- one idempotent result per request key;
- same key with different inputs returns 409;
- `requested -> uploading` persists immutable artifact identity before storage
  is touched, so a crash cannot leave an untracked object;
- a stale `uploading` retry verifies the tracked object and either finalizes it
  or records a durable failure;
- exports contain messages only, not attachment files;
- maximum 5,000 messages per export;
- signed download URLs expire after five minutes.

## 6. Transactional Operations

Use transactional RPCs for state plus access event plus `app_events` plus audit.
Do not reproduce these operations as multiple best-effort Supabase calls.

Every RPC:

- is `SECURITY INVOKER`;
- has a fixed safe search path;
- fully qualifies objects;
- revokes PUBLIC, anon, and authenticated;
- grants execute only to service role;
- validates actor and current state under row locks;
- accepts an idempotency key for mutations;
- records and replays identical requests;
- rejects divergent key reuse with 409.

### 6.1 `message_compliance_case_request_tx`

Creates:

- pending case;
- explicitly requested case-thread rows;
- case-requested access event;
- app event;
- audit record.

Validates:

- actor has active `communications.compliance_read`;
- at least one and at most 20 thread IDs;
- every thread exists;
- metadata discovery was authorized;
- title, type, reason, relevance notes, and validity are valid.

This operation does not grant message access.

### 6.2 `message_compliance_case_decide_tx`

Approves or rejects a pending case.

Validates:

- route has verified fresh step-up;
- actor independently holds active `communications.compliance_read`;
- actor differs from requester;
- case remains pending;
- requested threads still exist;
- validity has not elapsed.

On approval:

- mark case approved;
- create one time-limited grant for the requester per case thread;
- write case-approved access event;
- write app event and audit.

On rejection:

- mark case rejected;
- create no grants;
- write case-rejected access event;
- write app event and audit.

### 6.3 `message_compliance_thread_read_tx`

Returns one bounded message page and records the access in the same transaction.

Validates:

- actor currently holds `communications.compliance_read`;
- case is approved and unexpired;
- grant belongs to actor and thread;
- grant is not revoked or expired;
- cursor and limit are valid.

Writes:

- `conversation_opened` for the first page or `page_read` for later pages;
- app event;
- audit;
- grant `last_accessed_at`.

Returns:

- case and grant summary;
- at most 100 messages;
- opaque next cursor;
- author display data;
- edit and soft-delete indicators;
- attachment metadata only.

It does not return signed attachment URLs.

### 6.4 `message_compliance_grant_revoke_tx`

Revokes one grant immediately.

Validates:

- actor is the grantee revoking their own access, or is the actor who approved
  the case;
- fresh step-up when revoking another actor;
- grant is active;
- reason is present.

Writes grant state, access event, app event, and audit atomically.

### 6.5 `message_compliance_case_close_tx`

Closes a case and revokes every active grant under it in one transaction.

Requires:

- case requester or the actor who approved the case;
- fresh step-up;
- reason;
- row locks on case and active grants.

### 6.6 Basic export flow

V1 uses one synchronous authenticated route with durable DB states. It does not
introduce a background worker.

Flow:

1. `message_compliance_export_request_tx` validates permission, case, grant,
   step-up, range, format, purpose, and idempotency; creates a `requested` row.
2. `message_compliance_export_snapshot` reads the export scope and all bounded
   messages in one SQL statement, yielding a real MVCC snapshot timestamp.
3. The backend generates PDF or canonical JSON.
4. `message_compliance_export_prepare_upload_tx` atomically changes the row to
   `uploading` and persists path, size, checksum, serializer, message count, and
   snapshot timestamp before storage is touched.
5. The backend uploads once to the private, deterministic export-ID path, or
   verifies identical existing bytes during crash recovery.
6. `message_compliance_export_finalize_tx` records ready state, access event,
   app event, and audit.
7. On generation failure, a failure RPC records a safe failure code.

If upload succeeds but finalization fails, retry with the same request key. The
tracked `uploading` state verifies the existing bytes and resumes finalization
using the same export ID and object path. Do not create a second export.

Download:

- requires a fresh step-up token;
- verifies active export permission and case grant;
- verifies stored object checksum before issuing a URL;
- records `export_downloaded` atomically;
- returns a five-minute signed URL only after evidence logging succeeds.

The URL may remain usable for its remaining five-minute lifetime after a later
grant revocation. That bounded storage-token lifetime is an accepted V1
constraint; every URL issuance still requires live authorization, step-up, and
fresh immutable evidence.

## 7. Backend Routes

Add:

- `communications/compliance/summary/get`
- `communications/compliance/cases/list`
- `communications/compliance/cases/get`
- `communications/compliance/cases/request`
- `communications/compliance/cases/decide`
- `communications/compliance/cases/close`
- `communications/compliance/conversations/search`
- `communications/compliance/conversations/read`
- `communications/compliance/grants/revoke`
- `communications/compliance/access-events/list`
- `communications/compliance/exports/list`
- `communications/compliance/exports/create`
- `communications/compliance/exports/download`

Remove after cutover:

- `messages/requestThreadAccess`
- `messages/recordExport`
- `messages/compliance/search`

Every route:

- is POST-only;
- uses `requirePermission`;
- validates with Zod;
- returns real HTTP status codes;
- returns safe errors;
- never accepts and drops fields;
- never falls back to ordinary participant message reads.

Conversation discovery searches metadata only:

- thread title;
- exact participant;
- source module/entity;
- created date.

V1 does not search message bodies.

## 8. Shared Contracts

Create `types/messagingCompliance.ts`.

Required DTO groups:

- `ComplianceSummary`
- `ComplianceCaseSummary`
- `ComplianceCaseDetail`
- `ComplianceCaseThread`
- `ComplianceGrant`
- `ComplianceMessagePage`
- `ComplianceAccessEvent`
- `ComplianceExport`
- request and response DTOs for every route.

Server-authored capabilities:

- `canRequestCase`
- `canApproveCase`
- `canReadConversation`
- `canRevokeGrant`
- `canExport`
- `canViewAccessLog`

The UI must use these flags and must not infer authority from role names.

No message body appears in list, case, grant, export-list, or access-log DTOs.

## 9. UI Scope

### 9.1 Access Control

Add a compact `Sensitive Access` section using the existing Access Control
design language.

Display:

- user;
- compliance permission;
- grant source;
- status;
- requested by;
- approved by;
- valid from/until;
- revoke action.

Commands:

- Request Grant
- Approve / Reject
- Revoke

Do not display cases or conversations here.

### 9.2 Messenger Compliance

Keep the existing Compliance entry and provide three views:

1. Cases
2. Conversations
3. Access Log

Exports appear inside the selected case instead of requiring a fourth V1 page.

This is a dense operational surface, not a widget board. No charts.

The Cases view begins with the four compact operational cards shown in the
approved mockup. They are supplied only by
`communications/compliance/summary/get`; the frontend must not derive them
from a paginated case list:

- Active Cases: approved cases whose validity has not expired.
- Pending Approval: cases currently awaiting an independent decision.
- Expiring Within 24h: active cases expiring after the summary snapshot and
  within the following 24 hours.
- Exports This Month: ready exports generated in the current UTC month.

The response includes `asOf` so the UI can identify the snapshot time.

### 9.3 Cases view

Table columns:

- case number;
- title;
- type;
- requester;
- status;
- requested conversation count;
- valid until;
- last activity.

Commands:

- New Case
- Open
- Approve / Reject when authorized
- Close

New Case dialog:

- title;
- type;
- formal reason;
- validity up to 30 days;
- conversation metadata search;
- selected conversations;
- relevance note per conversation;
- review summary.

### 9.4 Conversations view

Left rail:

- approved case selector;
- selected conversations;
- grant status and expiry.

Center:

- read-only paginated message timeline;
- author and timestamp;
- edited/deleted indicators;
- attachment name/type/size metadata;
- no composer or message actions.

Right rail:

- case summary;
- grant expiry;
- access reason;
- Revoke Access;
- Export Conversation;
- recent access events.

Do not expose reactions, replies, forwarding, participant editing, pinning,
deletion, or attachment download in V1 compliance mode.

### 9.5 Export dialog

Fields:

- case and conversation, read-only;
- format: PDF or JSON;
- optional date range;
- purpose, required;
- estimated message count;
- expiry warning;
- acknowledgement.

The action requires step-up. Success uses an action toast linking back to the
case export list.

### 9.6 Access Log

Filters:

- case;
- actor;
- event type;
- conversation;
- date range.

Display immutable metadata only. Do not display message content.

### 9.7 UI states

Every view provides:

- initial loading;
- empty;
- permission denied;
- expired grant;
- revoked grant;
- case pending approval;
- server error with retry;
- export generating;
- export failed;
- export ready.

Use the existing standard, rich, and action toast system. A toast is never the
only confirmation for approval, revocation, case closure, or export.

## 10. Notifications

V1 notifications:

- case submitted: eligible approvers;
- case approved/rejected: requester;
- grant revoked: grantee;
- export ready/failed: requester.

Notifications contain only case number, safe status, and route. They contain no
participant names, message excerpts, attachment names, or findings.

Conversation participants are not notified of compliance access in V1.

## 11. Focused E2E Suite

Create `scripts/e2e/suites/communicationsCompliance.mjs`.

The suite uses the live HTTP stack and real database. It must pass twice
consecutively with complete cleanup.

### 11.1 Critical permission behavior

- unauthenticated returns 401;
- ordinary user returns 403;
- superadmin without explicit grant returns 403;
- requester cannot approve their own permission;
- approved active grant permits the route;
- expired and revoked grants return 403;
- simulated permission lookup failure denies critical permissions.

### 11.2 Case workflow

- investigator requests a case with two conversations;
- request creates no access grants;
- requester cannot approve own case;
- authorized second actor approves;
- approval creates exactly two scoped grants;
- rejection creates no grants;
- expired/closed case cannot be read;
- closing revokes all active grants.

### 11.3 Read behavior

- unrelated conversation is denied;
- another investigator is denied;
- ordinary participant route remains independent;
- approved investigator reads first and subsequent pages;
- every successful page delivery writes a fresh access event, app event, and
  audit record, including an identical client-key replay;
- revoked and expired grants fail immediately;
- response contains no signed attachment URL.

### 11.4 Export behavior

- read-only grant without export permission is denied;
- export creation and every download require fresh step-up;
- PDF and JSON exports are valid and non-trivial;
- exported message range matches request;
- SHA-256 matches downloaded bytes;
- same-key retry returns the original export;
- divergent reuse returns 409;
- every successful signed-URL issuance writes a fresh access event, app event,
  and audit, including an identical client-key replay;
- revoked or expired grant cannot download;
- more than 5,000 messages is rejected.

### 11.5 Privacy and RLS

- authenticated browser role cannot enumerate grant rows;
- case lists contain no message bodies;
- access logs contain no message bodies;
- exports use private storage and short-lived URLs.

### 11.6 Cleanup

Delete:

- generated export storage objects;
- exports;
- access events;
- grants;
- case-thread rows;
- cases;
- permission requests and test grants;
- tagged app events, audits, and notifications.

Run the suite twice to prove idempotency and cleanup isolation.

Also run:

- `communications`
- `rbacConsole`
- `accountSecurity`
- every suite discovered by scanning critical-permission call sites.

## 12. Unit and Component Tests

Backend/unit:

- permission fail-closed matrix;
- case state transitions;
- case expiry;
- grant expiry and revocation;
- cursor validation;
- export canonical JSON;
- SHA-256 verification;
- idempotency hash behavior.

Frontend/component:

- capability-driven controls;
- pending/approved/rejected/expired states;
- no composer in compliance view;
- revoked grant state;
- export validation;
- access-log filters;
- safe API errors.

## 13. Delivery Slices

### Slice 1: Permission hardening

- remove critical static fallback;
- harden access-grant RLS;
- add resolver tests;
- update E2E grant provisioning helper.

### Slice 2: Cases and scoped grants

- case and case-thread migrations;
- grant hardening;
- request and decision RPCs/routes;
- case list/detail UI.

### Slice 3: Audited read and revocation

- access-event migration;
- transactional read/revoke/close RPCs;
- read-only conversation UI;
- access log.

### Slice 4: Basic export

- export migration;
- synchronous PDF/JSON generation;
- checksum verification;
- private storage and signed download;
- export dialog and list.

### Slice 5: Cutover and verification

- remove legacy compliance routes;
- remove E2E waivers;
- run focused suite twice;
- run affected regressions;
- independent adversarial review.

Do not begin the next slice until the current slice is green.

## 14. Explicit Deferrals

Not part of V1:

- legal hold;
- retention-engine integration;
- attachment evidence downloads or evidence ZIP packages;
- background export workers;
- scheduled exports;
- ticket-system linking;
- advanced case workflow configuration;
- case extensions;
- message-body search;
- cross-case analytics and charts;
- AI classification, sentiment, or surveillance;
- participant disclosure workflow;
- external legal portal;
- cross-tenant e-discovery;
- mobile-specific redesign.

Do not add hidden placeholders or accept inputs for deferred features.

## 15. Definition of Done

V1 is done only when:

- critical permissions fail closed;
- superadmin requires explicit approved grants;
- case requester cannot approve their own case;
- every read has an approved case and active scoped grant;
- revocation and expiry stop access immediately;
- every read and export produces immutable evidence;
- PDF and JSON checksums verify;
- Access Control manages capability holders;
- Messenger provides cases, read-only conversations, and access log;
- no deferred feature appears as a fake control;
- legacy self-grant and fake-export routes are removed;
- no relevant E2E waiver remains;
- the focused suite passes twice;
- affected security and communications regressions pass;
- an independent review reports no P0/P1 finding.
