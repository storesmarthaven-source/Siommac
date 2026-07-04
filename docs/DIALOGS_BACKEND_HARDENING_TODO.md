# Backend hardening TODO (deferred — NOT part of Phase A dialog migration)

The ActionModal migration (Phase A) enforces some rules **client-side only**. These are the
server-side gaps found in [SIOMAC_FORMS_DIALOGS_BACKEND_MAPPING.md](docs/SIOMAC_FORMS_DIALOGS_BACKEND_MAPPING.md) §13.
Do NOT change Zod schemas / routes during Phase A. Track here for a later hardening task.

- [x] **Enforce reason server-side on reject/cancel where the UI already requires it.** DONE (policy =
      the shipped ActionModal `reason.required` flags, per user direction). Rule: enforce ONLY where the UI
      requires a reason AND the route already accepts a reason/note/comment field — no invented fields, no
      touching confirm-only routes. Flipped `.optional()` → `.trim().min(1).max(N)` on: offboarding **cancel**;
      onboarding **cancel**, **task/block** (`reason`), **blocker/resolve** + **blocker/escalate** (`note`),
      **actions/case/cancel**; overtime **reject**; compensation pay-item **reject**; finance statutory version
      **reject**; requests **cancel**. Requests **decide** uses a `.superRefine` so `comment` is required only
      when decision ∈ {rejected, returned} (approve stays comment-free, matching the UI). Leave **cancel** gets
      a manual `!b.reason` guard (its route uses `body()`, not zod; the service already persists the reason).
      ALREADY enforced (no change): leave **reject** (`reviewNotes`), NIS **reject** + payroll (financeNis:92,
      financePayroll:208), attendance waive/resolve/correct, onboarding blocker **waive** + task **add-note**.
      NOT touched (confirm-only backend / no required-reason UI): roster **reopen**, onboarding **pause**,
      offboarding **pause**, documents **verify**, Transfers `employee-change-requests/*` (separate endpoints).
      E2E: fixed calls that passed no reason (hrLeave cancel ×2, hrRequests cancel ×2) + added negative
      "reject/cancel without reason → refused" tests (overtime, compensation, finance version, onboarding cancel).
      **Follow-up:** add negative-path tests for the remaining flipped actions (offboarding cancel, leave cancel,
      requests decide-reject, onboarding block/resolve/escalate/case-cancel) — validate on the live E2E gate.
- [x] **Enforce document upload file-size server-side.** DONE. Root-cause fix: bucket `file_size_limit`
      on `hr-employee-documents` = 15 MB (migration `20260804000000_hr_documents_storage_limit.sql`), which
      Supabase Storage enforces on the object PUT regardless of the client-reported size. Plus a friendly
      early-reject on `hr/employees/documents/commit` via `HR_DOC_MAX_BYTES` (`documentsCore.ts`). The bucket
      limit is authoritative; the commit check is defense-in-depth. **Migration needs operator apply + `NOTIFY pgrst`.**
- [ ] **Enforce pay-item effective-date overlap server-side** (`compensationMutations.createPayItem`).
      **BLOCKED on a policy decision.** Attempted a create-time guard, but the existing green `hrCompensation.mjs`
      suite deliberately creates THREE overlapping open-ended items for the SAME employee+component and approves
      two of them to `active` simultaneously — i.e. the product currently *allows* concurrent same-component items.
      Adding a naive overlap guard would regress that suite AND encode an unconfirmed rule. Need the business
      semantics before implementing: (a) is overlap of the *same component* actually disallowed, or only across a
      resolved value? (b) block at create-time or only at approve-time (when `is_active` flips)? (c) does the suite
      data need to change to non-overlapping ranges? Reverted; left OPEN.
- [x] **Document-requirement duplicate guard** for `(documentType, appliesToScope, appliesToValue)`.
      ALREADY ENFORCED — `documentsRequirements.createRequirement` maps a DB unique-constraint violation
      (`23505`) to a 409 ("A requirement for this document type and scope already exists."). Verified; no change needed.

Also outstanding (discovery, not hardening): resolve the few remaining UNKNOWN audit-action strings in
BACKEND_MAPPING §14 by reading the specific `lib/*` mutations, and the Transfers from→to diff payload shape.

## Cleanup dependency (separate from forms migration)

- [x] **Repoint HSE inspections employee picker off legacy `@api/employees`.** DONE.
      `useEmployeeOptions.ts` now sources from `useHrEmployees` (`@api/hr/employees`). This was the last live
      frontend consumer of `@api/employees` (only a doc-comment reference remains in `src/api/index.ts`), so the
      legacy Employees API is now import-dead from the app — ready for the legacy-removal pass.
