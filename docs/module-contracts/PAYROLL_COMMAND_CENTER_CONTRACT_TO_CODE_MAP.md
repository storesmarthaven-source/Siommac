# Payroll Command Center — Contract-to-Code Map (pre-implementation)

Branch `payroll/command-center` @ `824f6b4f`. Authority: `PAYROLL_COMMAND_CENTER_IMPLEMENTATION.md`
(approved) + the user's restart directives. **This is a design map produced BEFORE code; flagged
decisions in §D must be reviewed before backend implementation.** Every source below was verified
against the applied backend on this HEAD.

## A. Authoritative sources (verified)

| Concern | Table / function | Key columns |
|---|---|---|
| Runs (spine) | `finance_payroll_runs` | `id, run_no, run_type, status, pay_group(name, denorm), pay_group_id, period_start, period_end, pay_date, cut_off_date, employee_count, gross_total, net_total, nis_employer_total, workflow_id, current_input_snapshot_id, current_calculation_version_id, statutory_version_id, updated_at` |
| **Effective** totals (current calc version) | `finance_payroll_calculation_versions` | `id, run_id, employee_count, gross_total, net_total, nis_employer_total` — override legacy run totals when `runs.current_calculation_version_id` is set |
| Current-version findings | `finance_payroll_control_findings` | `calculation_version_id, state ∈ (open,in_progress), severity ∈ (info,warning,blocker), domain, due_at, title` |
| Funding confirmations | `finance_payroll_funding_confirmations` | `calculation_version_id, confirmation_no (latest=current), confirmed_amount` |
| Certification | `finance_payroll_certifications` | `calculation_version_id` (presence) |
| Release evidence | `finance_payroll_release_certificates` | `run_id` (presence) |
| Approval task | `workflow_tasks` | `workflow_id (=runs.workflow_id), assigned_to, assigned_role, status ∈ (open,pending,in_progress), due_at, created_at, step_name` |
| Recent activity | `app_events` | `source_module='finance_payroll', event_type (allowlist), actor_user_id, source_entity_id, created_at` — never raw `payload` |
| Names/photos | `app_users` | `id (TEXT), full_name, profile_image_thumb_url, profile_image_url` |
| Next-run readiness | RPC `finance_payroll_release_preflight(uuid)` | `ready, blockers[], glJournalId, invalidGlAccountCount, missingBankAccountCount, netPayroll, employeeCount` — **called ONCE for the selected next run only** |
| Capabilities | `userCan(actor, key)` | `finance.payroll.{run.manage, approve, funding.approve, release, export}`; gate = `finance.payroll.view_all` |
| Real approval lifecycle | `submitRun` → RPC `workflow_submit_for_record_tx` | binding `finance_payroll_approval`, trigger `finance.payroll.run.submitted`; task → `finance_manager` role |

## B. Window scope (user-decided, applied to KPIs + health + register + tab counts CONSISTENTLY)

A run is **in window** when `pay_date BETWEEN from AND to`; **fallback** when `pay_date IS NULL`:
period overlap `period_start <= to AND period_end >= from`. Same predicate everywhere.
`payGroupIds` (≤25) further scopes when present. **No 500-row cap** — full dataset aggregated in SQL.

## C. Field-by-field map

### capabilities (route-authored)
| Field | Source | Strategy | E2E |
|---|---|---|---|
| canCreateRun / canManageRun | `userCan(run.manage)` | route computes | superadmin ⇒ all true; plain employee ⇒ 403 before body |
| canApprove / canConfirmFunding / canRelease / canExport | `userCan(approve/funding.approve/release/export)` | route computes | capabilities match actor perms |

### portfolioHealth  (score formula = approved §4; **near-due-funding = ONE portfolio −10**, user-decided)
| Field | Source | Strategy | E2E |
|---|---|---|---|
| score | derived | `100 − min(20·blockerRuns,60) − min(10·overdueActorTasks,20) − (anyFundableRunDueWithin3dUnfunded ? 10 : 0)`, clamp 0..100 | unit + endpoint reconcile |
| state | derived | `<50 critical, <70 at_risk, <90 attention, else healthy` | unit + endpoint |
| openBlockerCount | findings (blocker, current version) | SQL count of runs with ≥1 open blocker | seeded blocker run ⇒ 1 |
| overdueActionCount | `workflow_tasks` (actor, overdue) | SQL count | **[D1]** actor-scoped |
| criticalCount / atRiskCount | derived | **[D2]** proposed defs below | assert per seed |
| primaryIntervention | findings/tasks/funding | SQL: pick 1 (overdue approval → blocker → funding), stable `targetId` | assert kind+targetId |

### kpis (all scoped to window+payGroupIds; active = status ∉ released/exported/cancelled)
| Field | Source | Strategy | E2E |
|---|---|---|---|
| nextPayDate {date,runId,runNo} | runs | earliest `pay_date >= from` among active scheduled | **[D3]** vs nextScheduledRun |
| activeRuns | runs | SQL count active-in-window | exact |
| employeesDue | effective calc-version `employee_count` | SQL SUM over active-in-window | exact (calc-version, not run) |
| grossPayroll / netPayroll | effective `gross_total/net_total` | SQL SUM (COALESCE calc-version, else run) | exact; released/cancelled excluded |
| funding.required | effective `net_total` of fundable (calc-version present, net>0) active | SQL SUM | **[D4]** fundable def |
| funding.confirmed | latest `confirmed_amount` per current version | SQL SUM | exact |
| funding.gap / state | derived | `max(0,req−conf)`; not_required/unconfirmed/partial/confirmed | exact |

### assignedToYou (actor's highest-priority OPEN payroll approval task; else null)
| Field | Source | Strategy | E2E |
|---|---|---|---|
| taskId/workflowId/runId/runNo/title/dueAt/isOverdue | `workflow_tasks` ⋈ runs, `app_users` | bounded: 1 task (overdue→due asc→created asc) assigned to actor | **real lifecycle** create→…→submit ⇒ finance_manager sees it; another user ⇒ null |
| assignee {id,displayName,photoUrl} | `app_users` | 1 lookup | photo nullable |

### recentActivity (≤3, allowlisted, display-safe)
| Field | Source | Strategy | E2E |
|---|---|---|---|
| eventId/eventType/label/occurredAt/runId/runNo/actor | `app_events` (allowlist) ⋈ runs/app_users | `ORDER BY created_at DESC LIMIT 3`; label projected | **[D5]** allowlist set; no raw payload |

### upcomingDeadlines (≤5, persisted dates only)
| Field | Source | Strategy | E2E |
|---|---|---|---|
| id/kind/runId/runNo/title/dueAt/state | `cut_off_date`,`pay_date`,task `due_at`,finding `due_at` | union; classify overdue/today/upcoming; order overdue→dueAt→runId→id; LIMIT 5 | absent dates ⇒ no invented deadline |

### nextScheduledRun (single preflight)
| Field | Source | Strategy | E2E |
|---|---|---|---|
| run | shared run read model | earliest non-cancelled/non-released scheduled `pay_date>=from`; tie pay_date,period_start,id | deterministic tie-break |
| readiness {state,percent,passed,applicable,gates[7]} | preflight + current-version findings/cert/funding | 7 gates (**[D6]** mapping) via ONE preflight | agrees with preflight |
| releaseImpact {employees,gross,net,employerNis,fundingGap} | effective totals + funding | derived | exact |

### runRegister (keyset; shared read model)
| Field | Source | Strategy | E2E |
|---|---|---|---|
| items[] (PayrollRunRegisterItem) | runs + effective totals + finding counts | SQL page, order `pay_date DESC NULLS LAST, period_end DESC, run_no DESC, id DESC` | shape/IDs/TTD |
| items[].readiness {state, percent, blockerCount, warningCount} | findings + status | blocker/warning = SQL counts; **[D7]** percent = null on register rows (real % only on nextScheduledRun) | current-version-only |
| nextCursor | derived | opaque base64 {order-tuple, filter-fingerprint}; mismatch/malformed → 422 | 422 cases |
| total / tabCounts | derived | SQL counts over full filtered set (all/attention/approval/ready/released) | exact per tab |

## D. FLAGGED DECISIONS — review before I write backend code (I will not silently interpret)

- **[D0] Aggregation mechanism (material).** Complete-dataset aggregation of *effective* totals +
  joined blocker/funding/tab classification at 10k+ runs is **not** expressible via PostgREST
  aggregates. I propose **one read-only `STABLE` SQL function** (e.g.
  `finance_payroll_control_center(p_from,p_to,p_pay_group_ids,p_actor_id,p_actor_role,p_tab,p_search,p_cursor,p_limit)`)
  returning KPIs+health+tabCounts+register-page as JSONB, then the TS service does the single
  preflight + bounded detail/name resolution. **This adds a migration** (~`20260919000430`,
  read-only, `grant execute … service_role`) — a **deviation from contract §5 "no migration
  automatically required."** Your step 6 ("complete-dataset database aggregation") appears to
  authorize it. Confirm: SQL function (proposed) vs a DB view + PostgREST vs other.
- **[D1] overdueActionCount** = overdue OPEN `workflow_tasks` assigned to the **actor** (matches the
  score's "overdue assigned workflow task"). Portfolio-wide alternative possible. → propose actor-scoped.
- **[D2] criticalCount / atRiskCount** (contract lists, doesn't define). Propose: `criticalCount` =
  active runs with `calculation_failed` OR (open blocker AND due within 3 days); `atRiskCount` =
  active runs with an open blocker not already critical.
- **[D3] nextPayDate** — propose it is the KPI's own earliest-active-`pay_date` and MAY differ from
  `nextScheduledRun` (which is scheduled-only with tie-breaks). Confirm they can diverge.
- **[D4] funding.required scope** — propose: active-in-window runs with a current calc version and
  `net>0` (i.e., calculated and needing money). Draft/pre-calc runs excluded.
- **[D5] recentActivity allowlist** — propose: `finance.payroll.run.{certified, calculated,
  funding_confirmed, released, submitted, approved, rejected, reopened, locked}`.
- **[D6] readiness gate→state mapping** — 7 gates (`inputs_locked, calculation_current,
  findings_clear, approval_certified, funding_confirmed, journal_posted, bank_accounts_ready`);
  blocking gates (findings blocker, invalid GL, missing bank) derive `fail` from preflight so
  readiness **agrees with** preflight; incomplete-not-blocking → `warning`; pre-stage → `not_applicable`.
  Detailed pass/warn/fail table to follow in code + unit tests.
- **[D7] register-row readiness.percent = null** (only `nextScheduledRun` gets a real gate %). Avoids
  a per-row fabricated score; contract allows `number|null`. Confirm, or you want an evidence ladder.

## E. E2E strategy (real lifecycle, no guessed schema)

- Fixture via the **real API lifecycle** (financePayroll.mjs pattern): provision finance_manager +
  finance_staff + employees w/ bank + statutory profiles; `create → lock-inputs → calculate →
  certify → submit` to reach `pending_approval` with a **real** workflow task (assigned to
  finance_manager) → covers assignedToYou/approval-tab/overdue authentically.
- Direct-seed only immutable *evidence* rows the lifecycle doesn't need for a given assertion
  (released/cancelled runs, a stale-version finding) — never workflow tasks.
- Deterministic year window (my exclusive period salts) for exact KPI/health reconciliation.
- Cover §9 in full; run twice (cleanup+isolation); record 10k-scale dataset + latency.

## F. Migration numbering
Latest applied ≈ `…429` (payroll) / `…401-404` (main) / `…410` (messaging). Next free ≈
`20260919000430`. Finalize only after **[D0]** is confirmed.
