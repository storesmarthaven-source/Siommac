# Messenger Compliance V1 - Frontend Implementation Handoff

Status: BUILD-READY FRONTEND HANDOFF
Parent contract: `docs/module-contracts/MESSENGER_COMPLIANCE_IMPLEMENTATION.md`
Visual reference: `mockups/messenger-compliance-v1/index.html`

## 1. Objective

Build the approved Messenger Compliance V1 UI inside the existing Messenger
workspace. The frontend must expose:

1. Cases
2. Conversations
3. Access Log
4. Case-scoped PDF/JSON exports

The implementation must preserve the current Messenger shell, queue header,
navigation, typography, theme behavior, and read-only message renderer. It must
not create a second compliance application or a separate left navigation.

This handoff is frontend-only. The backend implementation, migrations,
permission hardening, shared DTO definitions, route behavior, and backend E2E
suite are owned by the backend agent.

## 2. Mandatory Read Order

Before editing:

1. `AGENTS.md`
2. `docs/module-contracts/MESSENGER_COMPLIANCE_IMPLEMENTATION.md`
3. This document
4. `mockups/messenger-compliance-v1/index.html`
5. Current integration files:
   - `src/components/sections/Messages/messenger/ui/components/MessagesWorkspace.tsx`
   - `src/components/sections/Messages/messenger/ui/components/ThreadSidebar.tsx`
   - `src/components/sections/Messages/messenger/ui/components/ComplianceView.tsx`
   - `src/components/sections/Messages/ComplianceBrowser.tsx`
   - `src/components/sections/Messages/AccessThreadDialog.tsx`
   - `src/components/sections/Messages/messenger/ui/components/MessageThread.tsx`
   - `src/components/sections/Messages/messenger/ui/styles/messenger.css`
   - `src/api/communications.ts`
   - `src/lib/toast.ts` and the actual toast entry points discovered from code

Do not copy old behavior merely because it already exists. In particular, the
current self-requested `AccessThreadDialog` flow is being removed by V1.

## 3. Parallel-Work Boundary

### Backend agent owns

- `types/messagingCompliance.ts`
- Supabase migrations and RPCs
- Netlify route and service files
- permission resolution and step-up enforcement
- export generation and download signing
- backend unit tests
- `scripts/e2e/suites/communicationsCompliance.mjs`

### Frontend agent owns

- `src/api/communicationsCompliance.ts`
- Compliance UI components under the Messenger component tree
- compliance-specific styles in the Messenger stylesheet family
- frontend fixtures used only by component tests or an explicit development
  fixture adapter
- frontend unit/component tests
- removal of the legacy compliance UI only after the new UI is integrated

### Shared-file rule

`types/messagingCompliance.ts` has one owner: the backend agent. The frontend
agent may import it but must not edit it. If a required DTO or capability is
missing, report the mismatch to the parent agent. Do not create a competing
frontend DTO and do not cast around the mismatch.

The backend agent must publish the shared DTO file and exact route envelopes
before the frontend replaces fixtures with live hooks. UI layout work may begin
against typed fixtures after that contract commit is available.

## 4. Current-to-Target Cutover

### Keep

- `MessagesWorkspace`
- `QueueHeader`
- the existing `compliance` queue
- `useCan("communications.compliance_read")` as the entry visibility gate
- Messenger avatar, message body, attachment metadata, empty-state, dialog,
  button, icon, and toast primitives
- the current rich-message safe renderer

### Replace

- `ComplianceBrowser` metadata-only free search
- `AccessThreadDialog` self-request/self-grant flow
- direct use of the normal `loadThreadDetail` participant read path from
  compliance mode
- old compliance search and export hooks in `src/api/communications.ts`

### Target integration

`MessagesWorkspace` continues to render:

```tsx
<QueueHeader ... />
<ComplianceView />
```

`ComplianceView` becomes the V1 compliance workspace orchestrator. It owns the
selected subview and selected case/conversation identifiers, but not server
data duplication.

## 5. Proposed Frontend File Map

Use this structure unless current local conventions require a small naming
adjustment:

```text
src/api/
  communicationsCompliance.ts

src/components/sections/Messages/messenger/ui/compliance/
  ComplianceWorkspace.tsx
  ComplianceSubnav.tsx
  ComplianceCasesView.tsx
  ComplianceCaseTable.tsx
  ComplianceCaseDetail.tsx
  ComplianceConversationsView.tsx
  ComplianceConversationRail.tsx
  ComplianceMessageTimeline.tsx
  ComplianceContextRail.tsx
  ComplianceAccessLogView.tsx
  NewComplianceCaseDialog.tsx
  DecideComplianceCaseDialog.tsx
  CloseComplianceCaseDialog.tsx
  RevokeComplianceGrantDialog.tsx
  ComplianceExportDialog.tsx
  ComplianceState.tsx
  complianceFixtures.ts
  index.ts
```

Keep `ComplianceView.tsx` as the stable shell import and have it render
`ComplianceWorkspace`. This limits churn in `MessagesWorkspace.tsx`.

Do not put cards inside cards. The workspace is a dense operational surface:
subnavigation, tables, rails, timeline, dialogs, and status bands.

## 6. View Architecture

### 6.1 Workspace shell

The shell contains:

- compact heading: `Compliance Workspace`
- supporting text: `Approved investigations, scoped access and immutable evidence`
- segmented subnavigation: `Cases`, `Conversations`, `Access Log`
- a context-sensitive primary action:
  - Cases: `New Case`
  - Conversations: `Export` only when the server says `canExport`
  - Access Log: no creation command

The top-level Messenger `QueueHeader` remains visible above this shell.

Directly below the shell header, render the mockup's four compact operational
summary cards. Their only data source is
`communications/compliance/summary/get`; never calculate these values from the
paginated case/export lists:

- `Active Cases` -> `activeCases`
- `Pending Approval` -> `pendingApprovalCases`
- `Expiring Within 24h` -> `expiringWithin24Hours`
- `Exports This Month` -> `exportsThisMonth`

Use `asOf` as the snapshot timestamp. Loading, unavailable, and retry states
apply to the entire four-card band so cards never display a mixed snapshot.

### 6.2 Cases

Use the mockup's case register as the visual baseline.

Columns:

- case number
- title
- type
- requester
- status
- conversations
- valid until
- last activity
- command menu

Required behaviors:

- server pagination or cursor behavior from the shared contract
- filters for status and case type
- search only fields supported by the backend
- open selected case
- request case
- approve/reject only when `capabilities.canApproveCase`
- close only when the case DTO capability permits it
- visible pending, approved, rejected, expired, closed states
- no message content in the case table or case detail metadata

The case detail surface shows:

- purpose and formal reason
- requester and independent approver
- validity
- selected conversations and relevance notes
- grant status
- exports generated for the case
- immutable recent case events

Approval, rejection, closure, and revocation require explicit confirmation and
must remain visible in the page after the toast disappears.

### 6.3 New Case dialog

Use a three-step dialog or compact wizard:

1. Case details
2. Select conversations
3. Review and submit

Fields:

- title
- case type
- formal reason
- valid until, maximum 30 days
- metadata-only conversation search
- selected conversations
- required relevance note for every selected conversation

Validation:

- no submit without all required fields
- no validity beyond the server maximum
- no conversation body or preview in discovery results
- duplicate selection prevented
- remove selection available before submit
- server validation errors map to fields or a persistent error band

The UI sends one idempotency key per deliberate user submission. It must retain
that key while retrying the same logical request and generate a new key only
after a successful request or a materially new submission.

### 6.4 Conversations

The desktop layout is a three-column operational workspace:

1. Case/conversation rail
2. Read-only message timeline
3. Case/access context rail

Left rail:

- approved case selector
- only conversations explicitly attached to that case
- grant state and expiry
- selected state

Center:

- selected conversation title and metadata
- read-only paginated timeline
- author
- timestamp
- edited/deleted marker
- attachment name/type/size metadata
- previous/next page or cursor loading

Forbidden in compliance mode:

- composer
- reactions
- replies
- forwarding
- pinning
- delete
- participant editing
- attachment download
- ordinary thread action menu

The read request must use the compliance read endpoint. Never call the ordinary
participant `loadThreadDetail` path as a fallback.

Right rail:

- case number, title, type, status
- formal access reason
- grant validity and expiry
- selected-conversation relevance
- `Revoke Access` when `canRevokeGrant`
- `Export Conversation` when `canExport`
- recent access events

The rail must clearly show pending, expired, revoked, or rejected access without
revealing message content.

### 6.5 Access Log

Filters:

- case
- actor
- event type
- conversation
- date range

Columns:

- timestamp
- actor
- event
- case
- conversation metadata
- outcome
- reference/export identifier where applicable

This view displays immutable metadata only. Never show message body, attachment
content, or message previews.

### 6.6 Export dialog

Fields:

- selected case, read-only
- selected conversation, read-only
- PDF or JSON
- optional date range
- required purpose
- estimated message count
- expiry warning
- acknowledgement checkbox

The backend owns step-up enforcement. The frontend handles the step-up-required
response using the application's existing step-up flow; it must not invent a
local password or bypass.

Success:

- action toast with `View Exports`
- export row remains visible in the case detail
- requested/uploading render as generating; ready, failed, and expired states
  remain distinct
- download invokes the existing step-up flow, then calls the dedicated download
  endpoint to obtain a short-lived URL
- no direct storage path is placed in the DOM or DTO

## 7. API Layer

Create `src/api/communicationsCompliance.ts`. Import request/response DTOs from
`types/messagingCompliance.ts`. Use the existing `apiPost` and TanStack Query
patterns.

Required operations:

| Hook/function | Route |
| --- | --- |
| `useComplianceSummary` | `communications/compliance/summary/get` |
| `useComplianceCases` | `communications/compliance/cases/list` |
| `useComplianceCase` | `communications/compliance/cases/get` |
| `useRequestComplianceCase` | `communications/compliance/cases/request` |
| `useDecideComplianceCase` | `communications/compliance/cases/decide` |
| `useCloseComplianceCase` | `communications/compliance/cases/close` |
| `useComplianceConversationSearch` | `communications/compliance/conversations/search` |
| `useComplianceConversation` | `communications/compliance/conversations/read` |
| `useRevokeComplianceGrant` | `communications/compliance/grants/revoke` |
| `useComplianceAccessEvents` | `communications/compliance/access-events/list` |
| `useComplianceExports` | `communications/compliance/exports/list` |
| `useCreateComplianceExport` | `communications/compliance/exports/create` |
| `downloadComplianceExport` | `communications/compliance/exports/download` |

Suggested query keys:

```ts
const complianceKeys = {
  all: ["communications", "compliance"] as const,
  summary: () => [...complianceKeys.all, "summary"] as const,
  cases: (filters: ComplianceCaseListRequest) =>
    [...complianceKeys.all, "cases", filters] as const,
  case: (caseId: string) =>
    [...complianceKeys.all, "case", caseId] as const,
  conversation: (caseId: string, threadId: string, cursor?: string | null) =>
    [...complianceKeys.all, "conversation", caseId, threadId, cursor ?? null] as const,
  events: (filters: ComplianceAccessEventListRequest) =>
    [...complianceKeys.all, "events", filters] as const,
  exports: (caseId: string) =>
    [...complianceKeys.all, "exports", caseId] as const,
};
```

Mutation invalidation:

- request case: cases list + returned case
- decide case: cases list + case + relevant grants/conversations
- close case: cases list + case + selected conversation
- revoke grant: case + conversation + access events
- create export: exports + case + access events

Do not invalidate the entire communications snapshot after every compliance
mutation. Keep invalidation scoped to compliance query keys.

Rules:

- mutations do not auto-retry
- queries may use the repo's standard retry policy
- keep the same idempotency key for an explicit retry
- surface 401, 403, 404, 409, 410, 422, and step-up-required distinctly
- never convert a permission denial into an empty success state

## 8. Server-Authored Capabilities

Render commands from DTO capabilities only:

- `canRequestCase`
- `canApproveCase`
- `canReadConversation`
- `canRevokeGrant`
- `canExport`
- `canViewAccessLog`

Do not infer authority from:

- `superadmin`
- role names
- requester identity
- case status alone
- possession of the Compliance tab

The page-level entry permission is necessary but not sufficient for commands.

## 9. UI State Matrix

Every major surface must implement:

| State | Required treatment |
| --- | --- |
| Initial loading | stable skeleton matching final geometry |
| Empty cases | explanation + New Case only if capable |
| Empty case conversations | explanation, no fake rows |
| Permission denied | persistent restricted state, no sensitive residue |
| Pending approval | case metadata only, no message content |
| Expired grant | expiry state + no timeline |
| Revoked grant | revoked state + no timeline |
| Server error | persistent error band + retry |
| Export generating | status row and disabled duplicate command |
| Export failed | failure reason safe for UI + retry where allowed |
| Export ready | checksum/status metadata + download command |

On case/conversation changes, clear previous message data immediately before
loading the next scope. Stale content from one case must never remain visible
under another case header.

## 10. Styling Requirements

- Desktop first; target 1440, 1600, and 1920 widths.
- Do not redesign the overall Messenger shell.
- Keep body text at least 14px; metadata at least 12px.
- Use stable grid tracks so rail content cannot overlap the timeline.
- Recommended three-column tracks:
  `minmax(250px, 0.78fr) minmax(520px, 1.65fr) minmax(280px, 0.9fr)`.
- Use the existing semantic tokens and theme mechanism.
- No hard-coded dark-only surface.
- Cards use 8px radius or less.
- Use Lucide/current Messenger icons, not Font Awesome additions or hand SVGs.
- No charts, decorative gradients, nested cards, or oversized marketing
  headings. The four approved operational summary cards are the only KPI band.
- Commands use icons where a familiar icon exists, with tooltips for unfamiliar
  icons.
- Focus-visible, hover, selected, disabled, loading, empty, and error states
  must be visually distinct.

The mockup establishes information architecture and density. Match the product
theme and component library during implementation rather than copying its CSS
blindly.

## 11. Accessibility

- Subnavigation uses tabs with `role="tablist"`, `role="tab"`, and associated
  panels, or the repo's established equivalent.
- Tables retain semantic table markup.
- Dialog focus is trapped and returned to the invoking control.
- Escape closes non-destructive dialogs.
- Destructive confirmations require an explicit button.
- Status never relies on color alone.
- Timeline loading is announced politely.
- Error summaries receive focus after failed submission.
- No inaccessible clickable `div`; rows use buttons/links or keyboard handlers
  with the correct semantics.

## 12. Frontend Tests

Add focused component/unit tests following repository conventions.

Minimum coverage:

1. Compliance tab remains hidden without `communications.compliance_read`.
2. Cases/Conversations/Access Log navigation.
3. Capability-denied commands are absent, not merely disabled.
4. New Case validation and relevance-note requirement.
5. Maker cannot approve own request when backend capability is false.
6. Pending/expired/revoked grants never render message content.
7. Conversation change clears old content before new data appears.
8. Timeline pagination appends/replaces exactly as the contract specifies.
9. Export dialog validates purpose and acknowledgement.
10. Step-up-required response invokes the established step-up flow.
11. Export generating/ready/failed states.
12. Revoke confirmation and query invalidation.
13. Access Log renders metadata but never message body fields.
14. Server error and retry.
15. Keyboard navigation and dialog focus for critical flows.

Do not weaken test assertions to accommodate incomplete backend envelopes.

## 13. Verification Gate

During implementation:

- run the frontend TypeScript typecheck
- run lint only for touched files if the repo supports scoped lint
- use component tests only for focused feedback

At the final gate, after backend integration:

1. backend and frontend typechecks
2. frontend test suite required by the repo
3. `npm run test:e2e -- communications`
4. `npm run test:e2e -- messagingCompliance`
5. repeat `messagingCompliance` once for isolation/idempotency
6. browser verification at 1440, 1600, and 1920
7. light and dark theme verification if the Messenger theme slice is present
8. verify no message body appears in list/access-log network responses
9. verify expired/revoked/pending navigation leaves no prior message content

Do not call the frontend done while it is still using fixture data.

## 14. Integration Order

1. Backend agent commits frozen shared DTOs and route envelopes.
2. Frontend agent rebases onto that commit.
3. Frontend builds the shell and views with typed fixtures.
4. Frontend builds hooks against the frozen DTOs.
5. Backend completes routes.
6. Frontend removes fixture adapter and connects live hooks.
7. Remove legacy `ComplianceBrowser`, `AccessThreadDialog`, and old compliance
   API hooks only when grep proves no remaining callers.
8. Run the complete verification gate.
9. Update `docs/REPO_MAP.md`.

## 15. Stop Conditions

Stop and report to the parent agent if:

- shared DTOs are missing or change after freeze;
- route response envelopes differ from the approved contract;
- the UI would need to infer a permission;
- the backend returns message bodies in list/access-log responses;
- ordinary participant reads are required as a fallback;
- a mutation lacks idempotency or returns a fake success;
- export download exposes a permanent storage URL;
- another agent edits the same frontend files.

Do not work around these conditions.

## 16. Definition of Frontend Done

The frontend is done only when:

- it is inside the existing Messenger shell;
- Cases, Conversations, and Access Log are complete;
- case-scoped export is complete;
- all commands use server-authored capabilities;
- the old self-grant flow is removed;
- no compliance view includes a composer or message actions;
- every required UI state is implemented;
- fixtures are removed from production code;
- focused tests and live compliance E2E pass;
- desktop browser verification is complete;
- the implementation matches the parent contract and contains no deferred V2
  feature disguised as a V1 control.
