# Crew Payroll — E2E Acceptance Matrix

Derived from spec **§14.9**. Every case has a stable ID and a target live test in
`scripts/e2e/suites/crewPayroll.mjs` (+ `crewAssignments.mjs` / `crewMovements.mjs` if split),
run on `:8888`. Rows tagged `h.TAG`, cleaned up in `h.onCleanup`. "Designed" until the test
exists AND passes live. Access negatives use a REAL provisioned user of the role (not the
superadmin harness).

| ID | Case (§14.9) | Slice | Type of assertion |
|----|--------------|-------|-------------------|
| CPE-01 | Assignment create/update/end happy path | CP4 | business row + exact app_events/audit (1 each) |
| CPE-02 | Assignment overlap (simultaneous asset where policy disallows) → exact blocker contract | CP4 | 422 + typed error; no row |
| CPE-03 | Assignment endpoints — unauthorized/non-participant denied | CP4 | 401 + 403 |
| CPE-04 | Movement record happy path | CP5 | row + 1 app_event + 1 audit |
| CPE-05 | Movement import **idempotent** (same source business key) ⇒ no duplicate | CP5 | replay ⇒ +0 rows/events |
| CPE-06 | Movement **correct** preserves the original approved event (reversal/correction relationship) | CP5 | original untouched; correction linked |
| CPE-07 | Movement endpoints — access negatives | CP5 | 401 + 403 |
| CPE-08 | Draft create/update/resume/copy/version-compare (policy) | existing F-01 + CP2 | reuse; unauthorized denied |
| CPE-09 | Unknown rule types / invalid parameter combos rejected | CP2/CP7 | 422 at API boundary + activation tx |
| CPE-10 | Submission rejected for missing component/statutory/source-owner/costing/payment config | CP2 | typed blockers |
| CPE-11 | Concurrent activation ⇒ one winner + one 409; no overlapping active versions | existing | 409 exactly once |
| CPE-12 | Activation writes business state + workflow decision + event + audit + notifications atomically | existing | exact-count side effects |
| CPE-13 | Pay-group assignment cannot overlap / cannot reference unapproved version | existing | 422 |
| CPE-14 | Pay date resolves the correct policy version at an effective boundary | existing | resolved version id |
| CPE-15 | Existing run keeps its policy checksum after a later version activates (snapshot immutability) | CP6 | checksum unchanged |
| CPE-16 | Run preflight: **roster without movement** → exact blocker | CP6 | typed blocker field |
| CPE-17 | Run preflight: **movement without assignment** → exact blocker | CP6 | typed blocker field |
| CPE-18 | Run preflight: **overlapping assignments** → exact blocker | CP6 | typed blocker field |
| CPE-19 | Unapproved overtime excluded ⇒ configured review finding | CP7 | finding materialized |
| CPE-20 | Cross-midnight shift + mobilize/demobilize do NOT double-count a qualifying day | CP7 | exact qualifying-day count |
| CPE-21 | Employee without complete local PAYE/NIS/Health Surcharge → HR-owned finding, blocked | CP7 | finding + no calc line |
| CPE-22 | Missing approved TTD payment destination blocks release, appears in exact preflight fields | CP6 | typed preflight field |
| CPE-23 | Client/asset/work-order totals reconcile to gross payroll + GL output | CP7 | balanced totals |
| CPE-24 | HSE advisory alone does NOT remove already-earned pay | CP7 | review finding; pay retained |
| CPE-25 | Calc reads only frozen snapshots (live policy/calendar change after lock doesn't alter pins) | CP7 | pins + numbers unchanged |
| CPE-26 | Per-line crew evidence present (roster/movement/asset ids, rate source/version) | CP7 | evidence fields |
| CPE-27 | Run-workspace READ surfaces crew fields ONLY when policy capability enables (non-crew ⇒ absent) | CP6 | conditional shape |
| CPE-28 | Policy + movement mutations assert ALL required app_events/audit_logs/workflow/notifications/outbox | CP4/CP5/CP7 | exact-count side effects |
| CPE-29 | Cleanup removes policy drafts/versions, assignments, movements, snapshots, findings + platform side effects tagged `h.TAG` | all | zero residue |

## Deferred (traced, NOT live here)
- Expat/foreign-worker, foreign-currency, split-currency — out of scope (§14.1); no tests until approved.
- 2000-employee lock-inputs perf benchmark — DB/bench level, not this live suite.
- Browser-QA of the rendered conditional crew sections — UI gate after the data routes are green.
