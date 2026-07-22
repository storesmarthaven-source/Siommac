# Payroll Reports Center — E2E Traceability Matrix (Phase A, rev 7)

**Contract:** `docs/module-contracts/PAYROLL_REPORTS_DELIVERY_CONTRACT.md`
**API/RPC suite:** `scripts/e2e/suites/payrollReports.mjs` (new; option-b — written AND run live)
**Browser suite:** `PayrollReportsPage.loadingGate.test.tsx` (component) + a browser journey.

Every API/MUT/FSM/UI/AUTH/FAIL id in the contract appears here. Every **bold** §13 invariant maps to a named test.

## 1. API behavior

| API ID | Endpoint | Happy | No token | No perm | Bad input | Bounds | Not found | Invalid state | Exact response | Tests |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| API-RPT-001 | catalog | [ ] | [ ] | [ ] | n/a | n/a | n/a | n/a | [ ] 9 keys+meta, filtered | `RPT-CAT-01..04` |
| API-RPT-002 | summary | [ ] | [ ] | [ ] | n/a | n/a | n/a | n/a | [ ] 5 tiles `{value,available}` | `RPT-SUM-01 formulas`, `RPT-SUM-02 denied→available:false`, `RPT-SUM-03 403`, `RPT-SUM-04 materialVariances always available:false (Phase A)` |
| API-RPT-003 | run | [ ] preview+file | [ ] | [ ] additive gates | [ ] unknown/missing-key/blank-key 400; **format-matrix 400** (audit preview/non-zip, non-audit zip); **mutual-excl 422** | [ ] period>24m 422 | [ ] run 404 | [ ] ineligible 422 | [ ] §5A2 params + §5B DTO | `RPT-RUN-01..12`, `RPT-FMT-01 audit-preview 400 **+0 job/event/audit/storage**`, `RPT-FMT-02 audit-xlsx 400 +0 side-effects`, `RPT-FMT-03 register-zip 400 +0 side-effects`, `RPT-PARAM-01 nis scope excl`, `RPT-PARAM-02 variance same-run 422`, `RPT-DISC-01 no outer report field **+0 side-effects**` |
| API-RPT-004 | status | [ ] | [ ] | [ ] owner-or-reviewer + gates | n/a | [ ] 404 unknown | n/a | [ ] **state-discriminated union** (queued/running/succeeded/failed) | `RPT-STA-01..04`, **`RPT-STA-08 owner+all-gates polls`**, **`RPT-STA-09 non-owner reports.export reviewer+all-gates polls`**, `RPT-STA-05 non-owner→404`, `RPT-STA-06 revoked-owner→404`, `RPT-STA-07 union shape per state` |
| API-RPT-005 | history/list | [ ] | [ ] | [ ] | n/a | [ ] keyset ≤100 | n/a | n/a | [ ] rows carry requiresViewAll/requiresExport; **class-filtered** | `RPT-HIS-01..04`, `RPT-HIS-05 omits rows missing view_all`, `RPT-HIS-06 omits rows missing export` |
| API-RPT-006 | artifacts/download | [ ] | [ ] | [ ] every gate | n/a | n/a | [ ] 404 | [ ] 410 purged/expired | [ ] url+bytes+sha256 + audit; **TTL=120s (±2s)** | `RPT-DL-01 bytes+checksum+audit`, `RPT-DL-02 gate 403`, `RPT-DL-03 purged 410`, `RPT-DL-04 fresh-url re-request`, `RPT-DL-05 expiresAt=issue+120s` |

## 2. Read behavior & per-report shape (§5B, exact)

| Key | Exact typed DTO | Chart scopeId+unit | No decorative series | Precondition (state) | Money=MoneyValue | Stable sort | Tests |
|---|---|---:|---:|---|---:|---:|---|
| payroll_register | RegisterRow[]+totals | n/a | [ ] | 1 run (locked/released/exported) | [ ] | [ ] employeeId | `RPT-SHP-01`, `RPT-ELIG-01 accepts released` |
| net_pay_summary | NetPaySummaryRow[]+totals | n/a | [ ] | 1 run | [ ] | [ ] group | `RPT-SHP-02` |
| payroll_cost_analysis | CostRow[]+chart+totals | [ ] +unit | n/a | period | [ ] | [ ] | `RPT-SHP-03` |
| gross_to_net_reconciliation | ReconciliationResult (no `tolerance`; `matched` per source) | n/a | [ ] | 1 run | [ ] | n/a | `RPT-SHP-04`, `RPT-REC-01 not-balanced when ANY diff≠0`, `RPT-REC-02 balanced ONLY when every diff=0 (exact, zero-tolerance)` |
| variance_analysis | VarianceRow[] (VarianceValue money=MoneyValue) + chart | [ ] +unit | n/a | 2 runs | [ ] discriminated | [ ] | `RPT-SHP-05`, `RPT-SHP-05b variance money is MoneyValue`, `RPT-SHP-05c series carry unit` |
| overtime_allowance_analysis | OvertimeRow[]+chart | [ ] +unit | n/a | period | [ ] | [ ] | `RPT-SHP-06` |
| population_movements | PopulationMovementRow[] | n/a | [ ] | period | [ ] | [ ] effectiveDate,employeeId | `RPT-SHP-07` |
| nis_exceptions | NisExceptionRow[] | n/a | [ ] | run/all | n/a | [ ] | `RPT-SHP-08` |
| export_audit_package | ZIP artifact (queued) | n/a | [ ] | 1 run | n/a | n/a | `RPT-SHP-09` |

Ineligibility: `RPT-ELIG-02 draft/approved run → 422`.

## 3. Mutation integrity

| Mutation ID | Row | Event x1 | Audit x1 | Atomic (RPC) | Same/same | Same/diff | Concurrent | Failure | Tests |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| MUT-RPT-001 enqueue | [ ] job (requires_* derived server-side) | [ ] enqueued | [ ] | [ ] event-fail→no job | [ ] original | [ ] 409 | [ ] one | [ ] | `RPT-IDEM-01/02/03`, `RPT-REQ-01 requires_* server-derived not client`, `FAIL-RPT-001` |
| MUT-RPT-007 register upload | [ ] ledger row **before upload** | none | n/a (op) | [ ] running-token only | n/a | n/a | [ ] unique(job,token) | [ ] stale-token reject | `RPT-LEDGER-01 registered before upload`, `RPT-LEDGER-02 stale-token reject` |
| MUT-RPT-002 complete | [ ] artifact+job+**ledger committed** | [ ] completed | [ ] | [ ] all-or-nothing | [ ] identical→original | [ ] divergent→409 | n/a | [ ] upload-fail→remove own path | `RPT-WRK-01`, `RPT-WRK-06 dup identical→one`, `RPT-WRK-10 divergent→409`, `RPT-WRK-12 ledger committed`, `FAIL-RPT-002/005` |
| MUT-RPT-003 fail/requeue | [ ] state | [ ] failed/requeued | [ ] | [ ] | n/a | n/a | n/a | [ ] boundary | `RPT-WRK-03 requeue<max`, `RPT-WRK-04 fail at max` |
| MUT-RPT-004 preview | none (read) | **no event** | [ ] audit only | [ ] single insert | n/a | n/a | n/a | n/a | `RPT-LOG-01 audit-only` |
| MUT-RPT-005 download | none | **no event** | [ ] audit x1 | [ ] single insert | n/a | n/a | n/a | n/a | `RPT-DL-01 asserts 1 audit row` |
| MUT-RPT-006 purge | [ ] purged_at | [ ] `payroll.report.purged` | [ ] | [ ] finalize token+idempotent | [ ] same-token→original | [ ] stale/diff-token reject (even after purged) | n/a | [ ] finalize-retry safe | `RPT-PURGE-01 purged_at+event+audit+410`, `RPT-PURGE-02 finalize-retry→ONE event`, `RPT-PURGE-04 stale-token reject`, `RPT-PURGE-06 stale-token rejected even after purged` |

## 4. State-machine coverage (queued→running→terminal)

| FSM ID | From | Action | To/expected | Auth | Idempotent | Stale/concurrent | Tests |
|---|---|---|---|---:|---:|---:|---|
| FSM-RPT-001 | (none) | run file | queued | [ ] | [ ] same→original | n/a | `RPT-RUN-02` |
| FSM-RPT-002 | queued/running(expired) | claim | running | [ ] worker | [ ] reclaim expired | [ ] SKIP LOCKED one | `RPT-WRK-02`, `RPT-WRK-05` |
| FSM-RPT-006 | running | heartbeat | running(lease++) | [ ] token | n/a | [ ] stale reject | `RPT-WRK-08/09` |
| FSM-RPT-003 | running | complete | succeeded | [ ] token+ledger | [ ] identical→original | n/a | `RPT-WRK-01` |
| FSM-RPT-004 | running | error, nextAttempts<max | queued | [ ] token | [ ] attempts++ | n/a | `RPT-WRK-03` |
| FSM-RPT-005 | running | error, nextAttempts≥max | failed | [ ] token | n/a | n/a | `RPT-WRK-04` |
| FSM-RPT-101 | succeeded | re-run same+hash | original | [ ] | [ ] no new row | n/a | `RPT-IDEM-01` |
| FSM-RPT-102 | succeeded | complete again | identical→original / **divergent→409** | [ ] | [ ] one artifact | n/a | `RPT-WRK-06`, `RPT-WRK-10` |
| FSM-RPT-103 | running(reclaimed) | old-token complete/fail | rejected | [ ] | n/a | [ ] unchanged | `RPT-WRK-07` |
| FSM-RPT-104 | any | status | read-only | [ ] | [ ] unchanged | n/a | `RPT-STA-02` |
| FSM-PRG-01 | active | purge_claim | purging | [ ] worker | [ ] reclaim expired-purging | [ ] SKIP LOCKED one | `RPT-PURGE-05 crashed-worker reclaim` |
| FSM-PRG-02 | purging | purge_fail | purging(lease expired) | [ ] token | n/a | [ ] stale reject | `RPT-PURGE-07 purge_fail token-checked→re-claimable` |

## 5. UI control coverage (browser/component)

UI-RPT-001..012 → BUI-RPT-001..012: KPI-board atomic reveal; 5 tiles (skeleton, never fake 0, denied hidden); catalog
filtered; params pickers + per-field validation; Run dialog (required blocks, no double-submit, pending lockout,
400/422/409/403 field, focus trap→return); table/chart(scopeId+unit)/reconciliation(not-balanced)/queued(no fake
rows); history keyset; download (403 gate, 410 purged, **fresh 120s URL, memory-only, re-requested each action**);
denied access-restricted. `BUI-RPT-005` covers §15.8 dialog/failure.

## 6. Cross-module & operational (workers + storage)

| ID | Scenario | Durable | Processing | Retry | Duplicate effect | Operator view | Tests |
|---|---|---:|---:|---:|---:|---:|---|
| INT-RPT-001 | file enqueue→worker→artifact | [ ] tx | [ ] completes | [ ] attempts boundary | [ ] one artifact | [ ] failed visible | `RPT-WRK-01/02/03/04` |
| INT-RPT-002 | stale-lease reclaim (running) | [ ] expired | [ ] re-queued | [ ] | n/a | [ ] | `RPT-WRK-05` |
| INT-RPT-003 | stale-worker write | n/a | [ ] token-checked | n/a | [ ] rejected | [ ] no corruption | `RPT-WRK-07` |
| INT-RPT-004 | **crash after upload / before commit** | [ ] ledger row uncommitted | [ ] discoverable (no bucket list) | n/a | [ ] winner path untouched | n/a | `RPT-LEDGER-03 uncommitted row discoverable`, `RPT-ORPHAN-01 reconciler removes it` |
| INT-RPT-008 | **late stale upload (24h quarantine)** | [ ] ledger retained | [ ] re-removed after late upload | [ ] cleanup_attempts++ | [ ] committed-artifact path never removed | n/a | `RPT-ORPHAN-02 late-upload removed in quarantine`, `RPT-ORPHAN-03 committed path never deleted` |
| INT-RPT-009 | **concurrent reconcilers (SKIP LOCKED)** | [ ] two workers, bounded pages | [ ] **disjoint claims** | n/a | [ ] no duplicate terminal cleanup; committed path untouched | n/a | `RPT-ORPHAN-04 two-worker disjoint claims + no double-cleanup + committed-path safe` |
| INT-RPT-005 | purge saga | [ ] mark purging (token+lease) | [ ] storage.remove | [ ] finalize-retry | [ ] missing-object=removed | [ ] purged_at | `RPT-PURGE-01/02`, `RPT-PURGE-03 missing-object` |
| INT-RPT-007 | purge crash recovery | [ ] stranded purging lease expired | [ ] re-claimed | [ ] purge_attempts++ | [ ] exactly one event after retry | [ ] purge_error recorded | `RPT-PURGE-05`, `RPT-PURGE-07`, `RPT-PURGE-02` |
| INT-RPT-006 | download authz + bytes + TTL | n/a | [ ] signed url 120s | n/a | n/a | n/a | `RPT-DL-01..05` |

## 7. Cleanup coverage

FK contract (frozen §6): `upload_attempts.job_id → jobs.id ON DELETE CASCADE`, `artifacts.job_id → jobs.id ON
DELETE CASCADE`, `jobs.artifact_id → artifacts.id ON DELETE SET NULL`. **Cleanup procedure:** (1) remove every
Storage object first (all `<job_id>/*` prefixes — artifact + any upload-attempt paths); (2) `h.mustDelete` the
**job** row — CASCADE clears `payroll_report_upload_attempts` + `payroll_report_artifacts`; (3) **assert both child
tables have zero rows for the job** (`RPT-CLEAN-01`). No FK cycle (artifact_id is SET NULL). Seeded run via
`payrollRun` helper (salt group). `h.TAG` on all three tables; sweeper BUSINESS_TAGGED += `payroll_report_jobs`,
`payroll_report_upload_attempts`, `payroll_report_artifacts`.

## 8. Coverage reconciliation

- [ ] Every API (001..006), mutation (001..007), transition (001..006 + 101..104 + PRG-01/02).
- [ ] Idempotency: same→original, divergent-enqueue→409, missing/blank key→400, concurrent→one.
- [ ] **One report discriminant** (`RPT-DISC-01`); **exact format matrix** (audit preview/non-zip, non-audit zip → 400).
- [ ] **Additive gates — negatives**: server-derived `requires_*` (`RPT-REQ-01`); export-only denied employee export
  (`AUTH-006`); view_all-only denied every file (`AUTH-007`).
- [ ] **Additive gates — positives**: register XLSX succeeds with **both** view_all + export (`RPT-AUTH-09`); aggregate
  CSV succeeds with export and **no** view_all (`RPT-AUTH-10`); register PREVIEW succeeds with view_all and **no**
  export (`RPT-AUTH-11`).
- [ ] **Status — positives + negatives**: state-discriminated union; owner+all-gates polls (`RPT-STA-08`); non-owner
  `reports.export` reviewer+all-gates polls (`RPT-STA-09`); non-owner→404 (`RPT-STA-05`); **revoked-owner→404**
  (`RPT-STA-06/07`, `AUTH-008`).
- [ ] **History**: row-filtered by both requirements (`RPT-HIS-05/06`).
- [ ] Worker exactly-once: reclaim, heartbeat, stale-token, divergent-completion→409, ledger commit.
- [ ] **Upload ledger**: registered before upload; uncommitted-crash discoverable; orphan reconciler removes it;
  **late stale upload removed during 24h quarantine**; committed-artifact path never deleted; **concurrent
  reconcilers claim disjoint (SKIP LOCKED), no duplicate terminal cleanup** (`RPT-ORPHAN-04`).
- [ ] **Cleanup FK**: Storage objects removed first, then job delete CASCADEs both child tables; both asserted empty
  (`RPT-CLEAN-01`); `jobs.artifact_id` SET NULL breaks the cycle.
- [ ] **Purge**: claim(active|expired-purging)→remove→finalize(token,idempotent)→one event after retry; same-token
  replay→original; **stale/diff token rejects even after purged**; `purge_fail` token-checked→re-claimable; missing-object.
- [ ] Retry boundary (nextAttempts) exact.
- [ ] Reconciliation: **EXACT match** — `balanced` iff every source diff=0; not-balanced when any diff≠0; `matched`
  per source; **no tolerance param, no policy table, no missing-policy 422** (`RPT-REC-01/02`).
- [ ] KPI: formulas + denied→available:false; **materialVariances always `available:false` in Phase A**
  (no materiality/escalation threshold seeded) (`RPT-SUM-04`).
- [ ] Eligibility: locked/released/exported accepted; draft/approved→422.
- [ ] Download: bytes+checksum+audit + 410 + **signed-URL TTL=120s (±2s)** + fresh-per-request.
- [ ] Output units: variance money=MoneyValue; every ChartSeries carries `unit`.
- [ ] Legacy cutover grep gate; 6 routes off `coverage-waivers.json`; no `.skip/.todo/.only`; every row names a test.
