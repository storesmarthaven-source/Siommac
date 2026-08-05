# Probation pre-image + correction — verified baseline (2026-08-05)

Recorded because the live schema was found to contain both migrations **without an attributable
apply event**. No active Supabase CLI, `psql`, migration runner or E2E process was applying SQL;
Vite and Netlify cannot apply migrations; a Notepad++ window had the atomic migration open but
cannot execute it. The live schema is therefore treated as **externally changed, unattributed**.

**Neither migration is to be re-applied.** This document is the baseline the live database is
verified against instead.

## Migration + source file hashes (SHA-256)

| File | SHA-256 |
|---|---|
| `supabase/migrations/20260804024501_hr_onboarding_atomic_launch.sql` | `0f92dc0be9737775d1ce79a2f365ab8ed93c620093498226ee26b0e5d23c71e7` |
| `supabase/migrations/20261004000000_hr_employee_probation_correction.sql` | `bdb2d64e0211085fc1eed21dfcaa7bdaa85d45d1ddbce25b65d5c1a804414e25` |
| `scripts/e2e/suites/hrOnboarding.mjs` | `faf27a8f5525368e0cc09dde7b035795c40f45e56bfbacddeee6f66cc917addc` |
| `netlify/functions/routes/hr.ts` | `bc442f76bcadd88942a8bd691071bed4499de3355107f0b3f5fa42c823f82a8b` |
| `netlify/functions/lib/hr/employmentDetail.ts` | `890ee1038673e8b1adc9e4996de0128ae4580aa2ae2831269092ff2ac6fe226c` |

`hrOnboarding.mjs` covers the `api()` contract fix and the in-test probe-case cleanup.

## Live function baseline (behavioural, not a text dump)

`supabase db dump` requires Docker, which is not installed here, and PostgREST cannot run
arbitrary SQL — so the definitions are pinned **behaviourally**. Per the repository's RPC-probe
rule this is the stronger evidence anyway: a wrong-arity probe returns `PGRST202` and is
indistinguishable from a missing function, so only a probe that reaches the function **body**
proves presence. Both probes below reach the body.

| Function | anon | service_role |
|---|---|---|
| `hr_onboarding_launch_tx` | `42501 permission denied` | `22023: request id is required` (body reached) |
| `hr_employee_probation_correct_tx` | `42501 permission denied` | `23503: employee BASELINE-NO-SUCH does not exist` (body reached) |

Both `SECURITY DEFINER` functions are correctly **not** executable by `anon` — the failure mode
the dashboard SQL editor produces when it silently drops a trailing `REVOKE`.

### Pre-image behaviour, verified against the live function

A probe launch on a synthetic employee seeded at `probation_end_date = 2027-02-20`, supplying
`2027-08-31`:

```
hr_audit_log.previous_state              = {"probationEndDate":"2027-02-20"}
hr_audit_log.new_state.probationEndDate  = "2027-08-31"   changed = true
audit_logs.changes.probationEndDate      = {"previous":"2027-02-20","new":"2027-08-31","changed":true}
```

### Correction endpoint, verified end to end

`POST /api/hr/employees/probation/correct` on a synthetic employee at `2027-07-07`, clearing it:

```
200 { previousProbationEndDate: "2027-07-07", probationEndDate: null, changed: true, eventId: … }
```

Negative paths return `400 validation.failed`: a sub-10-character `reason`, and an omitted
`probationEndDate` (clearing must be stated, never inferred).

### Grants

```
role_permissions['hr.employee.probation.correct'] = admin, hr_manager
```

## Retained QA case — untouched

```
ONB-2026-0645  status=in_progress  employee=USR-40397F16  launch_request_id=3e6bb4de-…
USR-40397F16   probation_end_date = 2026-12-14   updated_at = 2026-07-30T00:08:26.458+00:00
```

Both values are as they were before this slice and must stay that way. The case predates the
pre-image fix, so its `hr_audit_log.previous_state` is `null` and the employee's prior
`probation_end_date` is unknown — `updated_at` is **not** reliable evidence the field was
untouched. See `docs/ONBOARDING_IMPLEMENTATION_REFERENCE.md` for the retention rationale and the
conditions under which the case may later be removed.

## Open

Until the unattributed schema change is explained, treat "applied" state in this environment as
unverified: re-run the probes in this document rather than trusting migration history.
`supabase migration list` shows almost every local migration as absent remotely, so
`supabase db push` would replay hundreds of unrelated migrations — do not run it.
