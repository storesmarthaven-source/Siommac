# Ticket Center — Creation Permissions & Lifecycle: Implementation Handoff

**Purpose:** resume the large Ticket Center creation-permissions feature (spec requirements
#15–#22) cleanly in a fresh session, **using this same worktree**. The unread/design work is
already committed and applied; nothing in this feature has been started (no permissions or
schema changes made). Build strictly to the No-Band-Aids, Feature-Completeness, §2 side-effect,
and Testing-Standard rules in `CLAUDE.md`.

---

## 0. Branch / HEAD / working-tree state

- **Branch:** `main` (worktree `C:\Users\MSI Laptop\Desktop\Siomac`).
- **HEAD:** `5884522a fix(tickets): unread badge/dropdown/summary + optimistic mark-read`
  - parent `713c052d feat(tickets): rework ticket center workspace UI`
  - parent `73d8e3a8 fix(toast): restore coalesce bypass reverted by stale ticket-center merge`
- **Working tree:** clean **except** untracked `artifacts/apply-messenger-compliance-v1.sql`
  (UNRELATED — do **not** stage/commit/delete it).
- **Codex work:** ignore all `codex/*` branches and `stash@{0}` ("On Codex/…"). Reimplement
  cleanly; do not cherry-pick.
- **Commit discipline:** no `git add -A`; stage only relevant ticket/permission/migration/test
  files; regen index (`npm run repo:index`) — the pre-commit hook runs `repo:index:check` and
  can false-positive "stale" on CRLF, so after a manual `npm run repo:index:check` passes it is
  safe to `git commit --no-verify`; trailer `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`.

## 1. Already done (committed + operator-applied) — do NOT redo

Unread fixes (message-1 root causes 1–4 + spec §8) and the design:

- **Top-bar badge → `ticketsUnread`** — `src/components/nav/badgeSync.ts:72` **and**
  `src/components/sections/Tickets/TicketDropdown.tsx` effect.
- **Dropdown loads `scope:'all'`** (participant OR queue-handler; `ticket_list_for_actor`
  already gates it) — `TicketDropdown.tsx`. Unread tab still filters `unreadCount > 0`.
- **Optimistic `useMarkTicketRead`** — `src/api/communications.ts`: clears unread in all list
  caches + detail, decrements `ticketsUnread`, rolls back on error, always invalidates
  `ticketKeys.all` + detail + `communicationKeys.summary()`.
- **`ticket_summary_for_actor`** (mig 440) — `open` counts only active statuses; `unread` counts
  unread on any **non-archived** ticket (resolved included, closed/cancelled excluded). **This
  function has been applied to the shared DB already** (operator ran the delta).
- Dropdown `openCenter(ticketId, status)` now emits `siomac:openTicket` detail `{ ticketId, status }`
  — the TicketCenter side of Resolved-section routing is still TODO (see §7).
- Design commit `713c052d`: header-into-top-bar band, KPI strip, per-status avatar corner dots
  (resolved = green), no selected left-accent, resolved-row green wash + fade, restored scope
  tabs, 6-per-page windowed pager, message-center text scale.

## 2. Requirements still to build (#15–#22)

| # | Layer | Summary |
|---|-------|---------|
| 15 | Permissions | 4 create keys across 5 surfaces + `role_permissions` + drift-guard (§4) |
| 16 | Schema | mig 440 `tickets`/`ticket_request_types` columns + classification, **idempotent** (§5) |
| 17 | RPC | `ticket_create_tx` modes + in-RPC enforcement + atomic side-effects (§6) |
| 19 | APIs | create(+mode/requester/reason), requester-search, request-types-by-mode (§7) |
| 20 | Dialog | `TicketCreateDialog` modes/pickers/reason/internal-types/priority-gating/gated buttons (§7) |
| 21 | Lifecycle | Active/Resolved/Archived, resolved read-only, composer gating, resolved-nav (§7) |
| 22 | Tests | component + `ticketCenter.mjs` E2E with run-id cleanup (§8) |

## 3. Key file map (current shapes)

- **Schema:** `tickets` table created in `supabase/migrations/20260621100001_erp_communications_core.sql:113`;
  **altered** by `supabase/migrations/20260919000440_ticket_center_backend.sql:133-142` (add your
  columns to THAT alter block). `ticket_request_types` table at `440:30`.
- **RPCs (all in 440):** `ticket_create_tx` @565 (sig already has `p_requester_id`,
  `p_idempotency_key`, advisory lock, `command_receipts` idempotency, active-actor/requester
  checks); `ticket_comment_tx` @757; `ticket_command_tx` @953; `ticket_mark_read_tx` @1286;
  `ticket_request_types_for_actor` @1459; `ticket_list_for_actor` @1490; `ticket_get_for_actor`
  @1593; `ticket_summary_for_actor` @1722 (already fixed); grants @1814-1868.
- **Helpers (440):** `ticket_internal.user_has_permission` @330 (reads DB `role_permissions`),
  `handler_user_ids` @370, `record_event` @388, `notify_users` @459.
- **Routes:** `netlify/functions/routes/communications.ts` (ticket create/list/get/command/
  comment/mark-read); lib `netlify/functions/lib/tickets/ticketRpc.ts`.
- **FE:** `src/api/communications.ts` (`useCreateTicket` @851 `CreateTicketArgs`, `useMyTickets`,
  `useTicketRequestTypes`, `useTicket`, `useMarkTicketRead`); `src/api/queryKeys.ts`
  (`ticketKeys` @193: `all`/`list(args)`/`detail(id)`/`requestTypes()`);
  `src/components/sections/Tickets/{TicketCenter,TicketCreateDialog,TicketDropdown}.tsx`.
- **Permission catalogues:** FE `src/lib/permissions.ts` (`PermissionKey` list; `EMPLOYEE_BASELINE`
  Set ~L584; `ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<PermissionKey>>` @609 — roles seen:
  employee@792, manager@824, admin@883, superadmin@1089, hr_manager@623, finance_manager@692;
  **verify the full `UserRole` union**); FE meta `src/lib/permissionMeta.ts` (@859 `tickets.manage`,
  drift-guard lives here); BE `netlify/functions/lib/modulePermissions.ts` (`PermissionKey` union
  @16-17, `ROLE_PERMISSIONS` map: employee/hse_staff/hse_manager/manager/admin/payroll_staff/
  finance_staff/operations_staff/hr_staff); BE `netlify/functions/lib/permissions.ts` (list @96 +
  role Sets).

## 4. Four-key role-grant matrix × five permission surfaces (#15)

**Keys:** `tickets.create_self`, `tickets.create_team`, `tickets.create_on_behalf`, `tickets.create_internal`.

**Grant matrix** (✅ = granted; superadmin is allow-all so explicit adds are belt-and-braces):

| Role | create_self | create_team | create_on_behalf | create_internal |
|------|:--:|:--:|:--:|:--:|
| every authenticated role (via `EMPLOYEE_BASELINE`) | ✅ | | | |
| manager | ✅ | ✅ | | |
| admin | ✅ | ✅ | ✅ | ✅ |
| superadmin | ✅ | ✅ | ✅ | ✅ |
| hr_manager / hr_staff | ✅ | | | ✅ |
| finance_manager / finance_staff | ✅ | | | ✅ |
| payroll_staff | ✅ | | | ✅ |
| hse_manager / hse_staff | ✅ | | | ✅ |
| operations_staff | ✅ | | | ✅ |

> A handler who is also a manager inherits `create_team` from the manager role. Do **not**
> hard-code UI from role names — resolve permissions (`can(...)` FE, `requirePermission`/RPC BE).

**Five surfaces to edit (all must agree, or the drift-guard/enforcement diverges):**

1. **FE `src/lib/permissions.ts`** — add 4 to the `PermissionKey` list (Tickets block near L292);
   put `tickets.create_self` in `EMPLOYEE_BASELINE` (every role inherits it); `+create_team` in
   `manager`; all four in `admin` and `superadmin`; `+create_internal` in each handler role
   (hr_*, finance_*, payroll_*, hse_*, operations_*).
2. **FE `src/lib/permissionMeta.ts`** — 4 meta entries (`module:'Tickets', group:'Tickets'`, label
   + description; risk: `low` for self/team, `medium` for on_behalf/internal). REQUIRED for the
   drift-guard (enforced keys must be catalogued).
3. **BE `netlify/functions/lib/modulePermissions.ts`** — add 4 to the `PermissionKey` union AND the
   `ROLE_PERMISSIONS` map (no superadmin key there — allow-all is elsewhere).
4. **BE `netlify/functions/lib/permissions.ts`** — add 4 to the list + role Sets (mirror FE).
5. **DB `role_permissions`** — seed the grants. **Recommendation:** add an **idempotent** seed block
   inside mig 440 (`insert into public.role_permissions (role, permission) select … on conflict do
   nothing`) so it reapplies with the rest of the ticket-center source. First **verify the
   `role_permissions` schema** (role column type/name, whether a `permissions` catalogue table also
   needs the key rows) — grep `20260621100003_erp_hr_payroll_finance_ops_core.sql` and
   `20260626200000_permission_catalogue_reconcile.sql` for the existing `tickets.create/manage`
   grant pattern and match it exactly.

**Enforcement note:** the RPC (`ticket_internal.user_has_permission`) reads DB `role_permissions`;
routes use `requirePermission` (DB-resolved role). The static FE/BE maps drive UI + route gating +
drift-guard. All five must carry the keys.

## 5. Migration 440 source changes + reapply (#16)

Edit the **authoritative source** `supabase/migrations/20260919000440_ticket_center_backend.sql`
in place (NO second corrective migration). Everything must be **idempotent / rerunnable** because
440 is already applied.

**`tickets`** (extend the alter block @133-142):
```sql
alter table public.tickets
  add column if not exists created_by_user_id text references public.app_users(id),
  add column if not exists creation_mode text not null default 'self',
  add column if not exists creation_reason text;
-- guarded constraint adds (constraint add is not idempotent by itself):
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tickets_creation_mode_chk') then
    alter table public.tickets add constraint tickets_creation_mode_chk
      check (creation_mode in ('self','team','on_behalf','internal'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tickets_on_behalf_reason_chk') then
    alter table public.tickets add constraint tickets_on_behalf_reason_chk
      check (creation_mode <> 'on_behalf' or (creation_reason is not null and btrim(creation_reason) <> ''));
  end if;
end $$;
```
> `default 'self'` backfills existing rows so `not null` + the check pass on rerun.

**`ticket_request_types`** (extend the create-table @30 with add-column-if-not-exists, then seed
classification):
```sql
alter table public.ticket_request_types
  add column if not exists is_employee_requestable boolean not null default false,
  add column if not exists is_internal_requestable boolean not null default false;
-- classification (UPDATE is idempotent):
update public.ticket_request_types set is_employee_requestable = true where code in
  ('employment_letter','payslip_query','attendance_correction','leave_assistance',
   'employee_record_correction','benefits_statutory_assistance','facilities_issue',
   'technical_support','general_hr','confidential_hse_concern');   -- VERIFY exact codes in 440 seed
update public.ticket_request_types set is_internal_requestable = true where code in
  ('expense_receipt','finance_administration','compliance','finance_compliance','general_support'); -- VERIFY codes
```
> Classification per spec §3. Cross-check every `code` against the actual `insert into
> ticket_request_types` seed in 440 (@~72+) — the handoff codes are the spec labels, not verified
> keys. Internal types must NOT be exposed to ordinary staff (enforced in
> `ticket_request_types_for_actor`, §6/§7).

**Reapply procedure (operator):** re-run the changed statements from 440 against the shared DB in
this order — (1) the `tickets` alter + guarded constraints; (2) the `ticket_request_types` alters +
classification UPDATEs; (3) the `role_permissions` idempotent seed (§4.5); (4) `create or replace`
of `ticket_create_tx` and `ticket_request_types_for_actor` (§6); (5) re-grant execute on the new
`ticket_create_tx` signature. All are idempotent; safe to re-run the whole file too. Deliver this as
one copy-paste SQL block at the end (like the summary-fix delta already delivered).

## 6. Transactional RPC design — `ticket_create_tx` (#17)

**Signature:** add `p_creation_mode text` and `p_creation_reason text` (place before
`p_idempotency_key`; update the `grant execute` @1841 + `revoke` @1814 to the new signature).
Existing params/behaviour (advisory lock, `command_receipts` idempotency replay, active checks)
stay. `v_requester_id := coalesce(p_requester_id, p_actor_id)`.

**In-RPC enforcement (authoritative; API/UI are supplementary):**
- `self`: `v_requester_id = p_actor_id`.
- `team`: requester is an **active direct report** — `exists (select 1 from app_users where
  id = v_requester_id and supervisor_id = p_actor_id and status='active')`; actor has
  `tickets.create_team`.
- `on_behalf`: `v_requester_id <> p_actor_id`; `btrim(p_creation_reason) <> ''` (else TK422);
  actor has `tickets.create_on_behalf` **and** the target queue's `handler_permission`
  (`user_has_permission(p_actor_id, v_type.queue_code→queue.handler_permission)`).
- `internal`: actor is creator **and** requester (`v_requester_id = p_actor_id`); target request
  type has `is_internal_requestable = true`; actor has `tickets.create_internal`. (Employee is not
  impersonated.)
- All-mode: request type must be allowed for the mode — self/team/on_behalf ⇒
  `is_employee_requestable = true`; internal ⇒ `is_internal_requestable = true`. Raise `TK403`
  on any permission failure, `TK422` on invalid requester/reason/type. Use the existing errcode
  convention (`TK400/403/422`).

**One transaction creates (atomic; §2 side-effects):**
1. ticket row (`created_by_user_id = p_actor_id`, `requester_user_id = v_requester_id`,
   `creation_mode`, `creation_reason`, priority = `coalesce(p_priority, v_type.default_priority)`).
2. requester participant (`ticket_participants`, role e.g. `requester`).
3. system tags (from `v_type.system_tags`).
4. ticket event (`ticket_internal.record_event`).
5. `app_events` row.
6. `audit_logs` row.
7. handler notifications + deliveries (`handler_user_ids` → `notify_users`).
8. **employee notification** for `team`/`on_behalf` (notify `v_requester_id` that a ticket was
   raised for them).
9. idempotency receipt (`command_receipts`) — the returned jsonb.

**Event/audit payloads must include:** `requesterUserId`, `createdByUserId`, `creationMode`,
`creationReason`.

**Realtime:** the RPC only writes rows; the **route** emits realtime signals AFTER the RPC commits
(follow the existing post-RPC signal pattern in `communications.ts`).

**`ticket_request_types_for_actor` (@1459):** add a `p_creation_mode` param; return only types
allowed for that mode (`is_employee_requestable` for self/team/on_behalf, `is_internal_requestable`
for internal) AND only queues the actor may use (internal ⇒ actor must hold `create_internal`;
never expose internal types to ordinary staff).

## 7. API / dialog / lifecycle flow (#19, #20, #21)

**APIs (`communications.ts` routes; keep all IDs `TEXT`; no direct browser Supabase reads):**
- `POST /communications/tickets/create` — accept `creationMode`, `requesterId`, `creationReason`
  (extend `CreateTicketArgs` in `src/api/communications.ts:841` + the route body schema); pass to
  `ticket_create_tx`. Keep caller-owned `idempotencyKey`.
- **New** `POST /communications/tickets/requester-search` (authenticated) — `mode` + `query`;
  team ⇒ only active direct reports (`supervisor_id = actor`); on_behalf ⇒ active users only, and
  only if actor has `tickets.create_on_behalf`; server-side `ilike` search + hard result limit
  (e.g. 20). Returns `{id, displayName, …}` (never raw dumps).
- `POST /communications/tickets/request-types` — accept `creationMode`; call
  `ticket_request_types_for_actor(actor, mode)`.

**Dialog `TicketCreateDialog.tsx` (#20):**
- Resolve permissions (not role names). Modes offered = intersection of {self, team, on_behalf,
  internal} with the user's granted create_* keys. Default **For myself**.
  - manager ⇒ self + team; admin/super ⇒ all four.
- team/on_behalf ⇒ authenticated employee **picker** (calls requester-search; not free-text).
- on_behalf ⇒ **visible required reason**; internal ⇒ only internal request types.
- **Reload request types when mode changes**; reset invalid requester/type selections on change.
- Hide manual priority for ordinary self-service (use request-type `default_priority`); show
  priority control only to authorised handlers.
- **New Ticket buttons permission-gated** (hide if the user has no create_* key) — both the
  TicketCenter band button and the `TicketDropdown` footer button.

**Lifecycle `TicketCenter.tsx` (#21) — build on the committed design:**
- Sections: **Active** (open, assigned, in_progress, waiting_requester, reopened) / **Resolved**
  (resolved) / **Archived** (closed, cancelled). Preserve audit access to archived.
- Resolved/closed/cancelled ⇒ **read-only**; the composer must **not render** for these; reopen
  restores the composer.
- **Resolved-nav:** the `siomac:openTicket` handler already receives `{ ticketId, status }` from
  the dropdown — route `status==='resolved'` to the Resolved section; wire the same for in-page
  opens.

## 8. E2E matrix + cleanup (#22)

Extend `scripts/e2e/suites/ticketCenter.mjs` (+ `communications.mjs`) and component tests
(`TicketCenter.test.tsx`). Reference impl: `communications.mjs`. Cover:
- Self creation; manager direct-report (team) creation; **manager blocked** from unrelated
  employee; admin on_behalf creation; **missing on_behalf reason rejected**; internal creation;
  **staff blocked from internal types**; **unauthorised modes rejected at the RPC boundary**.
- Exact side-effects via service-role client: ticket, participants, system tags, ticket event,
  `app_events`, `audit_logs`, handler notifications (+employee notification for team/on_behalf),
  idempotency receipt; payload has requesterUserId/createdByUserId/creationMode/creationReason.
- **Idempotent replay** (same idempotencyKey ⇒ `replayed:true`, no dup rows).
- Unread badge optimistic update + rollback; queue-visible unread ticket for an authorised
  handler; non-handler denied; clicking unread decrements badge + removes from Unread; repeat
  mark-read idempotent.
- Resolved unread counted + opens Resolved section; resolved read-only; reopen restores composer;
  Active/Resolved/Archived separation.
- **Run-id cleanup:** every E2E ticket carries an explicit source/run identifier (e.g.
  `metadata.e2e_run_id` + `h.TAG`); cleanup deletes **only** that run's tickets and their
  notifications, audit_logs, app_events and storage attachments; confirm **zero residual rows**
  for the run id. Add safe cleanup of abandoned tagged rows after interrupted runs. **Do not
  delete real tickets.**

## 9. Operator steps (cannot run in-session)

1. Apply the mig-440 reapply SQL block (§5) to the shared DB.
2. `npm run build:backend` + restart `dev:netlify` (:8888 serves compiled `dist/`; route/RPC
   changes 404 until rebuilt).
3. `npm run test:e2e -- ticketCenter` (and `communications`) against the live server — green.
4. Component tests (vitest) green; full `tsc` FE+BE green.
5. Browser QA (passkey login) of the four creation modes + lifecycle.
6. Confirm E2E residual-row count = 0 for the run id.

## 10. Unresolved risks / decisions to confirm

- **`role_permissions` schema unknown** — verify column names/types and whether a separate
  `permissions` catalogue table needs the 4 key rows before granting (grep the two seed migrations
  in §4.5). Getting this wrong silently breaks RPC enforcement.
- **Full `UserRole` union** (FE + BE) not fully enumerated here — enumerate before editing role
  Sets so no handler role is missed for `create_internal`.
- **Request-type `code`s in §5 are spec labels, not verified keys** — reconcile against the actual
  440 seed before writing the classification UPDATEs (a wrong code silently leaves a type
  unclassified → hidden from its mode).
- **Superadmin** is allow-all (not in BE `modulePermissions` map); explicit FE grants are
  belt-and-braces only.
- **`ticket_create_tx` blast radius** — it is the sole atomic create path; a bad rewrite breaks all
  ticket creation on the shared DB. Build the RPC + reapply SQL, have the operator apply to a
  disposable/copy DB first if available, and gate on the E2E before trusting.
- **Resolved-unread archived exclusion** — `ticket_summary_for_actor` (already applied) counts
  unread on non-archived only (closed/cancelled excluded). If product wants archived unread too,
  revisit that one `filter`.
- **Pre-commit CRLF** — `repo:index:check` in the hook can false-flag stale; verify manually then
  `--no-verify`.
- **Messenger internal-notes** (a *separate* deferred request) is NOT part of this feature; its
  audience model was left open (`build it for real` chosen but paused).

---
*Handoff written 2026-07-20 at HEAD `5884522a`. No permissions/schema/RPC changes were made in the
session that produced this file.*
