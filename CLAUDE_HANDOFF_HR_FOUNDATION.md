# Claude Handoff — HR Foundation Item 1

- Branch/worktree: `codex/hr-foundation` in `C:\Users\MSI Laptop\.codex\worktrees\ccdf\Siomac`.
- Active scope: shared HR frontend foundation only — TypeScript contracts, capability-based navigation/page gates, fail-closed API envelopes, canonical HR surface cleanup, and common query-state behavior/tests.
- Ownership boundaries: preserve Payroll, Messenger, Ticket Center, notifications, and all unrelated work. Do not modify backend behavior/routes unless separately approved. Reuse existing realtime, notification, messaging, ticket, toast, and dialog infrastructure.
- Explicitly out of scope: Employee Master page delivery, Contracts, Reports Center, payroll work, and unrelated refactors.
- Next item: Employee Master. **Do not start it until Foundation Item 1 has been verified and committed.**

## Regression baseline supplied by the parent task

The main-derived HR E2E baseline was green: Employee Master + Organization 27/27; Attendance 50/50; Compensation 30/30; Documents 27/27; Employee Import 12/12; Employee Master 33/33; Settings 9/9; Leave 34/34; Offboarding 10/10; Onboarding 84/84; Package Manager 20/20; Organization 35/35 (one documented superadmin-only skip); Overtime 25/25; Request Center 25/25; Shift Roster 42/42; Statutory Profile 35/35; Transfers 12/12.

The 75 failures in that full run were outside HR and must remain outside this branch. One HR-owned audit cleanup warning was swept successfully; investigate only if the focused final HR gate reproduces a leak.
