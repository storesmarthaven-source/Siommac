# Phase Plan

> **Governing doc for:** project roadmap, feature sequencing, and milestone definitions.
> See `docs/ARCHITECTURE.md` for the technical decisions behind each phase.
> See `docs/CODING_STANDARDS.md` for the standards that apply throughout.

---

## Overview

Siomac is migrating from a legacy jQuery + Google Apps Script stack to a modern, enterprise-grade Preact + Supabase architecture. Work is sequenced into phases — each phase must complete (all tests passing, `tsc --noEmit` clean) before the next begins.

| Phase | Name | Status |
|-------|------|--------|
| 1     | Port all vanilla JS → TypeScript/Preact | ✅ Complete |
| 1b    | App shell split + inline into index.html | ✅ Complete |
| 2a    | Typed Supabase API layer | ✅ Complete |
| 2b    | Auth (Supabase session + RBAC) | ✅ Complete |
| 2c    | Notifications | ⬜ Pending |
| 2d    | Messages (full inbox + Realtime) | ⬜ Pending |
| 2e    | Support Tickets | ⬜ Pending |
| 2f    | External delivery (email + WhatsApp stub) | ⬜ Pending |
| 2g    | Performance pass | ⬜ Pending |

---

## Phase 1 — Vanilla JS → TypeScript/Preact Port ✅

**Goal:** Zero legacy `.js` files. All logic in typed, testable TypeScript modules.

**Completed:**
- `assets/js/config.js` → `src/config/index.ts`
- `assets/js/nav.js` → `src/components/nav/` (Preact)
- `assets/js/appState.js` → `src/lib/appState.ts` + `src/store/`
- `assets/js/api.js` → `src/lib/apiLegacy.ts`
- `assets/js/cache.js` → `src/lib/cache.ts`
- `assets/js/logger.js` → `src/lib/logger.ts`
- `assets/js/session.js` → `src/lib/session.ts`
- `assets/js/popup.js` → `src/lib/popup.ts`
- `assets/js/charts.js` → `src/lib/charts.ts`
- `assets/app.js` (1,111 lines) → `src/lib/attSystem.ts` ← **Final port**
- `src/main.tsx` updated: SCRIPTS array emptied, `AttendanceSystem.init()` called in `bootApp()`
- All section components ported to Preact under `src/components/sections/`
- Toast, Modal, Spinner, Avatar, Badge, ConfirmDialog, DataTable shared components created
- Test suite: 8 files / 50+ tests, all passing
- `tsc --noEmit` clean with `strict: true` + `noUncheckedIndexedAccess: true`

**Acceptance criteria (all met):**
- [ x ] No `.js` files in `assets/js/` (pending: delete after Phase 1b)
- [ x ] `tsc --noEmit` exits with 0 errors
- [ x ] `vitest run` exits with 0 failures
- [ x ] Coverage ≥ 70% lines, ≥ 70% functions, ≥ 60% branches
- [ x ] Application boots and all sections load in browser

---

## Phase 1b — App Shell Split + Inline ⬜ In Progress

**Goal:** Eliminate the runtime fetch of `assets/partials/app-shell.html`. Instead, the shell HTML is inlined directly in `index.html` (built at compile time from typed Preact components). This removes a network round-trip and a FOUC on every load.

### Why split first, then inline?

Splitting now means Phase 2 features (MessageModal, TicketModal) become surgical file replacements rather than large-file surgery. See ADR-008 in `docs/ARCHITECTURE.md`.

### Deliverables

#### 1. Documentation (write first, build second)
- [x] `docs/ARCHITECTURE.md` — rewritten with current state
- [x] `docs/CODING_STANDARDS.md` — new
- [x] `docs/UI_DESIGN_SYSTEM.md` — new
- [x] `docs/PHASE_PLAN.md` — new (this file)
- [ ] `docs/SHELL_STRUCTURE.md` — shell component guide
- [ ] `ONBOARDING.md` — root-level developer onboarding

#### 2. Shell components (`src/shell/`)

| File | Contents | Status |
|------|----------|--------|
| `AppShell.tsx` | Root compositor — sidebar + main + overlays | ⬜ |
| `LoginShell.tsx` | Login card + 2FA panels | ⬜ |
| `sections/EmployeeSections.tsx` | `s-emp-attendance`, `s-emp-leave`, `s-emp-history`, `s-emp-payroll` | ⬜ |
| `sections/ManagerSections.tsx` | `s-mgr-overview`, `s-mgr-employees`, `s-mgr-leaves` | ⬜ |
| `sections/AdminSections.tsx` | `s-adm-dashboard` through `s-adm-rates` | ⬜ |
| `sections/SharedSections.tsx` | `s-projectMap`, `s-payroll`, `s-profile`, `s-settings`, `s-about` | ⬜ |
| `modals/NotificationModal.tsx` | Notification bell panel | ⬜ |
| `modals/MessageModal.tsx` | Message inbox panel (stub for Phase 2d) | ⬜ |
| `modals/TicketModal.tsx` | Ticket panel (stub for Phase 2e) | ⬜ |
| `modals/EmployeeModals.tsx` | Employee drawer + add/edit modal | ⬜ |
| `modals/ProjectSiteModal.tsx` | Project site add/edit modal | ⬜ |

#### 3. `index.html` update
- Remove runtime fetch of `app-shell.html`
- Inline shell HTML directly at `<div id="app-root">`
- Alternatively: mount `<AppShell />` from `main.tsx` (preferred — full Preact)

#### 4. `main.tsx` update
- Mount `<AppShell />` at `#app-root` instead of fetching HTML

#### 5. Alias registration
- Add `@shell` alias in both `vite.config.ts` and `vitest.config.ts`

#### 6. JSDoc `@see` headers
- All source files get `@see docs/` references per `docs/CODING_STANDARDS.md §11.1`

#### 7. Legacy file deletion
- `assets/js/*.js` — all now ported
- `assets/app.js` — ported to `attSystem.ts`
- `assets/partials/app-shell.html` — inlined

**Acceptance criteria:**
- [ ] `tsc --noEmit` exits with 0 errors
- [ ] `vitest run` exits with 0 failures
- [ ] No runtime fetch of `app-shell.html`
- [ ] Application boots with full shell in ≤ 1 network round-trip (HTML + assets)
- [ ] All sections load and function identically to Phase 1
- [ ] `assets/js/`, `assets/app.js`, `assets/partials/app-shell.html` deleted
- [ ] All source files have `@see docs/` JSDoc headers

---

## Phase 2a — Typed Supabase API Layer ⬜

**Goal:** Replace the legacy `api()` / `apiSwr()` pattern (POST to `/api` with `action` strings) with a typed Supabase client layer, co-located query hooks, and TanStack Query as the server-state cache.

### Architecture decisions (captured in ADR-001 through ADR-006 in ARCHITECTURE.md)
- Supabase client (not server-side proxy) as primary data source
- TanStack Query replaces SWR cache
- Zod schemas validate all data at the API boundary
- Query key factories centralised in `src/lib/queryKeys.ts`
- Supabase Realtime for live feeds; TanStack Query invalidation for triggered refreshes

### Deliverables

| # | Deliverable |
|---|------------|
| 2a-1 | Install: `@supabase/supabase-js`, `@tanstack/react-query`, `zod` |
| 2a-2 | `src/lib/supabase.ts` — typed Supabase client singleton |
| 2a-3 | `src/lib/queryKeys.ts` — centralised query key factory |
| 2a-4 | `src/types/domain.ts` — full TypeScript domain model (inferred from Zod schemas) |
| 2a-5 | `src/types/supabase.ts` — generated Supabase database types (via `supabase gen types typescript`) |
| 2a-6 | `src/lib/api/employees.ts` — typed employee CRUD + query hooks |
| 2a-7 | `src/lib/api/attendance.ts` — typed attendance queries |
| 2a-8 | `src/lib/api/leaves.ts` — typed leave management |
| 2a-9 | `src/lib/api/payroll.ts` — typed payroll queries |
| 2a-10 | `src/lib/api/departments.ts` — departments + project sites |
| 2a-11 | `src/lib/api/index.ts` — public API surface |
| 2a-12 | `<QueryClientProvider>` mounted in `main.tsx` |
| 2a-13 | Sections migrated from `api()` calls to TanStack Query hooks |
| 2a-14 | `docs/API_SPEC.md` updated with Supabase RLS rules and table access patterns |

**Acceptance criteria:**
- [ ] Zero uses of `api()` / `apiSwr()` in section components (only in `attSystem.ts` during transition)
- [ ] All queries typed end-to-end (input → Supabase → Zod → TypeScript type)
- [ ] TanStack Query DevTools available in `DEV` mode
- [ ] Offline / error states handled gracefully

---

## Phase 2b — Auth (Supabase Session + RBAC) ⬜

**Goal:** Replace the current token-in-localStorage pattern with Supabase Auth (httpOnly cookies via Netlify Edge Function) and a role-based access control (RBAC) system with per-user permission overrides.

### Roles
- `superadmin` — full access + can override per-user permissions
- `admin` — full HR access
- `manager` — read all, write for own department
- `employee` — own data only

### Deliverables

| # | Deliverable |
|---|------------|
| 2b-1 | Netlify Edge Function: `auth/login` — exchanges credentials for Supabase session, sets httpOnly cookie |
| 2b-2 | Netlify Edge Function: `auth/refresh` — silent token refresh before expiry |
| 2b-3 | Netlify Edge Function: `auth/logout` — clears httpOnly cookie |
| 2b-4 | `src/lib/auth.ts` — `signIn`, `signOut`, `refreshSession`, session state |
| 2b-5 | `src/lib/permissions.ts` — `can(permission: string): boolean` helper + role defaults + DB overrides |
| 2b-6 | `src/store/session.ts` updated — Supabase session shape |
| 2b-7 | Supabase RLS policies on all tables aligned with role matrix |
| 2b-8 | `database/migrations/xxx_user_permissions.sql` — per-user permission overrides table |
| 2b-9 | `<AuthGate>` component — redirects to login if no valid session |
| 2b-10 | All section nav items filtered through `can()` before rendering |
| 2b-11 | `docs/SECURITY.md` updated with new auth flow |

**Permission key format:** `resource.action` (e.g. `employees.view`, `leaves.approve`, `payroll.export`)

**Acceptance criteria:**
- [ ] No auth token in localStorage
- [ ] Session survives page refresh without re-login (httpOnly cookie)
- [ ] Unauthorised RLS queries return empty sets, not errors
- [ ] `can()` helper correctly resolves role defaults + user overrides
- [ ] All sections inaccessible without valid session

---

## Phase 2c — Notifications ✅ Complete

**Goal:** A real-time notification system — bell icon with unread count, notification panel, and persistence across sessions.

### Notification types
- Attendance alerts (late, absent, missed clock-out)
- Leave approvals / rejections
- Payroll published
- System announcements
- Direct mentions

### Deliverables

| # | Deliverable | Status |
|---|------------|--------|
| 2c-1 | `database/migrations/002_notifications.sql` — notifications + notification_preferences tables, indexes, 90-day cleanup trigger | ✅ |
| 2c-2 | Supabase Realtime subscription on `notifications` (filtered to current user) via `initNotificationsRealtime()` in `src/lib/notifications.ts`; wired into `src/lib/auth.ts` `_applyFullSession` | ✅ |
| 2c-3 | `src/store/notifications.ts` — Zustand store: unreadCount, panelOpen, items, onNewNotification (optimistic), onPanelOpen (markAllAsRead fire-and-forget), reset | ✅ |
| 2c-4 | `src/lib/notifications.ts` — TanStack Query hooks: useMyNotifications, useUnreadCount, useMyNotificationPreferences, useMarkAsRead, useMarkAllAsRead, useDeleteNotification, useClearAllNotifications, useUpdateNotificationPreference | ✅ |
| 2c-5 | `src/api/schemas/notification.ts` — Zod schemas: NotificationRowSchema, NotificationPreferenceSchema, SendNotificationSchema, UpdatePreferenceSchema; NOTIFICATION_TYPE_LABELS | ✅ |
| 2c-6 | `src/api/notifications.ts` — Supabase read/write functions: getMyNotifications (PAGE_SIZE=50), getUnreadCount (graceful 0 on error), markAsRead, markAllAsRead, deleteNotification, clearAllNotifications, sendNotification (Netlify delegate), getMyPreferences, updateMyPreference | ✅ |
| 2c-7 | `src/components/nav/NotificationsPanel.ts` upgraded — uses Supabase direct reads + real mark-as-read/delete mutations; Zustand store subscription drives badge updates; polling removed in favour of Realtime | ✅ |
| 2c-8 | `src/components/notifications/NotificationPreferences.tsx` — per-type in-app toggle with TanStack Query + optimistic updates; email/WhatsApp "Coming soon" stubs for Phase 2f; wired into Settings section "notifications" tab | ✅ |
| 2c-9 | `src/lib/notifications.test.ts` — 31 tests: schema validation, store actions, Realtime lifecycle, queryKeys, type labels | ✅ |
| 2c-10 | Netlify Edge Function `notifications/send` — delegates via existing `sendNotification()` → `apiPost('sendNotification', payload)` | Phase 2f |

**Acceptance criteria:**
- [x] New notification appears ≤ 2s after the triggering event (Supabase Realtime INSERT → `onNewNotification()` → optimistic badge update + invalidate)
- [x] Unread count resets when panel is opened (`onPanelOpen` calls `markAllAsRead` fire-and-forget + sets `unreadCount: 0`)
- [x] Notifications persist across logout/login (stored in `notifications` table with RLS)
- [x] Works with browser tab inactive (60s `refetchInterval` poll fallback in `useUnreadCount`)

---

## Phase 2d — Messages (Full Inbox) ⬜

**Goal:** An internal messaging system with DMs, group conversations, and broadcast channels. Real-time delivery via Supabase Realtime.

### Message types
- **DM** — one-to-one between employees
- **Group** — many-to-many, created by managers/admins
- **Broadcast** — admin-to-all, read-only for recipients

### Deliverables

| # | Deliverable |
|---|------------|
| 2d-1 | `database/migrations/xxx_messages.sql` — conversations + messages + participants tables |
| 2d-2 | Supabase Realtime subscription on `messages` (filtered to user's conversations) |
| 2d-3 | `src/lib/messages.ts` — query hooks + send/read functions |
| 2d-4 | `MessageBell.tsx` — unread count badge in topbar |
| 2d-5 | `InboxPanel.tsx` — conversation list |
| 2d-6 | `ConversationView.tsx` — message thread with virtual scroll |
| 2d-7 | `ComposeModal.tsx` — new DM / group / broadcast |
| 2d-8 | `src/shell/modals/MessageModal.tsx` upgraded from stub to full UI |
| 2d-9 | Message search (full-text, Supabase `pg_trgm`) |
| 2d-10 | Read receipts + typing indicator (Presence channel) |

**Acceptance criteria:**
- [ ] Message delivered ≤ 1s after send (Realtime)
- [ ] Inbox loads in ≤ 500ms (paginated, TanStack Query)
- [ ] Virtual scroll handles 1,000+ messages without jank
- [ ] Unread count accurate across devices (Supabase session state)

---

## Phase 2e — Support Tickets ⬜

**Goal:** An internal ticketing system for HR queries and general IT/ops requests. Categories route to the right team; SLA timers enforce response targets.

### Ticket types
- **HR** — leave disputes, payroll questions, contract enquiries
- **General** — IT, facilities, equipment

### Deliverables

| # | Deliverable |
|---|------------|
| 2e-1 | `database/migrations/xxx_tickets.sql` — tickets + comments + SLA rules tables |
| 2e-2 | `src/lib/tickets.ts` — query hooks + create/update/close functions |
| 2e-3 | `NewTicketModal.tsx` — category selection + form |
| 2e-4 | `TicketList.tsx` — employee view: own tickets |
| 2e-5 | `TicketQueue.tsx` — admin/HR view: all tickets, filter by status/category/SLA |
| 2e-6 | `TicketDetail.tsx` — thread, internal notes, status transitions |
| 2e-7 | SLA timer: warn at 75%, breach at 100% (Supabase scheduled functions) |
| 2e-8 | `src/shell/modals/TicketModal.tsx` upgraded from stub to full UI |
| 2e-9 | Realtime updates for ticket status changes |

**Acceptance criteria:**
- [ ] Ticket creation ≤ 3 clicks
- [ ] SLA breach notification sent to assignee and their manager
- [ ] Admin can add internal notes (not visible to the employee who filed)
- [ ] Closed tickets archived after 90 days (soft-delete)

---

## Phase 2f — External Delivery (Email + WhatsApp Stub) ⬜

**Goal:** Notifications and ticket alerts can be delivered outside the app. Implement as a provider abstraction so the real provider (SendGrid, Twilio, etc.) can be swapped in without touching business logic.

### Deliverables

| # | Deliverable |
|---|------------|
| 2f-1 | `netlify/functions/delivery/provider.ts` — `DeliveryProvider` interface |
| 2f-2 | `netlify/functions/delivery/console.ts` — dev stub (logs to console) |
| 2f-3 | `netlify/functions/delivery/email.ts` — SendGrid adapter (env-configured) |
| 2f-4 | `netlify/functions/delivery/whatsapp.ts` — Twilio WhatsApp adapter (env-configured, stubbed until account approved) |
| 2f-5 | `netlify/functions/deliver.ts` — webhook called by `notifications/send`, dispatches to configured provider |
| 2f-6 | User preference: which channel to use (none / email / WhatsApp / both) |
| 2f-7 | `docs/ENV_REGISTRY.md` updated with provider env vars |

**Provider interface:**
```ts
interface DeliveryProvider {
  send(payload: DeliveryPayload): Promise<DeliveryResult>;
}
interface DeliveryPayload {
  to:      string;    // email address or phone number
  subject: string;
  body:    string;    // plain text
  html?:   string;    // optional HTML for email
}
```

**Acceptance criteria:**
- [ ] Switching provider = changing one env var, no code change
- [ ] Stub provider used in all test environments
- [ ] Delivery failures do not crash the notification pipeline (dead-letter queue pattern)

---

## Phase 2g — Performance Pass ⬜

**Goal:** Measure and optimise. No premature optimisation — this phase runs after 2f with real production data.

### Areas

| Area | Target metric |
|------|--------------|
| Initial load (LCP) | ≤ 2.5s on 4G |
| Interaction to next paint (INP) | ≤ 200ms |
| Dashboard query time | ≤ 500ms P95 |
| Attendance table (1,000 rows) | ≤ 1s initial render |
| Bundle: main chunk | ≤ 150kB gzip |

### Planned optimisations
- Virtual scroll for tables > 100 rows (`@tanstack/react-virtual`)
- Supabase `select()` field projection — never `select('*')` in hot paths
- Route-level code splitting (already stubbed with `lazy()`)
- Prefetch next-page queries on hover / scroll proximity
- Service Worker for offline shell (optional — post-2g)
- Supabase connection pooling (PgBouncer) configured in production

---

## Cross-cutting Concerns (all phases)

### Documentation mandate
Every new feature must update at least one `docs/` file before merging. The PR description must link to the updated doc.

### Test mandate
No feature ships without tests. Coverage thresholds must not decrease.

### Enterprise readiness checklist
Before each phase closes, run through:
```
[ ] tsc --noEmit passes
[ ] vitest run passes, coverage thresholds met
[ ] No console.log in production paths
[ ] All public functions have JSDoc with @see docs/ references
[ ] Error states handled (network error, empty data, loading)
[ ] Accessibility: keyboard navigable, ARIA correct
[ ] Responsive: tested at 375px, 768px, 1280px
[ ] Security: no sensitive data in localStorage, no XSS vectors
[ ] Performance: no N+1 queries, no blocking renders
[ ] Docs updated
```

---

*Last updated: Phase 1b — Shell Split & Documentation*
*Owner: Engineering Lead*
*Next phase start: Phase 1b completion → Phase 2a*
