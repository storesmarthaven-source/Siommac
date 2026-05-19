# SIOMAC — System Architecture

> **Mandatory first read** for every developer and AI session before touching this codebase.
> Every structural decision is recorded here. If something contradicts this doc, this doc wins
> — update the code, not the doc, unless you are intentionally changing the architecture,
> in which case update both with a clear rationale.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Technology Stack](#2-technology-stack)
3. [Repository Layout](#3-repository-layout)
4. [Module Boundaries & Import Rules](#4-module-boundaries--import-rules)
5. [Boot Sequence](#5-boot-sequence)
6. [Data Flow](#6-data-flow)
7. [State Management](#7-state-management)
8. [API Layer](#8-api-layer)
9. [Authentication & Session](#9-authentication--session)
10. [Realtime](#10-realtime)
11. [Backend — Netlify Edge Functions](#11-backend--netlify-edge-functions)
12. [Database — Supabase PostgreSQL](#12-database--supabase-postgresql)
13. [Phase Map](#13-phase-map)
14. [Architecture Decision Records](#14-architecture-decision-records)

---

## 1. System Overview

SIOMAC is a workforce management platform for field operations teams. It provides:

- GPS-verified selfie check-in / check-out with geofencing
- Real-time live operations map (Leaflet + Supabase Realtime)
- Multi-level leave management (employee → manager → admin)
- Payroll calculation with hourly rates and payslip generation
- Per-role dashboards (employee / manager / admin / super-admin)
- In-app notifications, messages, and support tickets *(Phase 2)*

**Deployment:** Netlify (frontend static + edge functions)  
**Backend API:** Netlify Edge Functions (Hono) — proxied at `/api`  
**Database:** Supabase PostgreSQL with Row Level Security (RLS)  
**Realtime:** Supabase Realtime (WebSockets over PostgreSQL changes)  
**Storage:** Supabase Storage (profile photos, logos, attachments)  
**Region:** Trinidad & Tobago (AST, UTC−4)

---

## 2. Technology Stack

| Layer | Technology | Version | Notes |
|---|---|---|---|
| UI Framework | Preact | 10.29.2 | React-compatible, 3 KB runtime |
| Data Fetching | TanStack Query | 5.100.10 | Single source of truth for server state |
| Global State | Zustand | 5.0.13 | Session, UI, derived data caches |
| Backend Client | Supabase JS | 2.45.0 | Auth + Realtime + Storage |
| Edge Functions | Hono | 4.7.10 | Netlify Edge runtime |
| Bundler | Vite | 8.0.13 | ESM, code splitting per section |
| Language | TypeScript | 5.9.3 | Strict + `noUncheckedIndexedAccess` |
| CSS | Vanilla CSS | — | Design tokens in `assets/styles/base.css` |
| Maps | Leaflet | 1.9.4 | CDN + MarkerCluster |
| Charts | Chart.js | Latest CDN | Wrapped by `SiomacCharts` |
| Date Picker | Flatpickr | 4.6.13 | CDN |
| Tables | DataTables | 1.13.7 | CDN, Bootstrap 5 skin |
| Drag & Drop | SortableJS | 1.15.2 | CDN, dashboard layout editor only |
| Testing | Vitest | 4.1.6 | Frontend unit + component tests |
| PWA | vite-plugin-pwa | — | Service worker, offline app shell |

**React compat rule:** `react` and `react-dom` are aliased to `preact/compat` in
both `vite.config.ts` and `vitest.config.ts`. **Never import directly from `react`.**

---

## 3. Repository Layout

```
siomac/
│
├── docs/                          ← READ THESE FIRST — authoritative standards
│   ├── ARCHITECTURE.md            ← this file — system structure, decisions
│   ├── CODING_STANDARDS.md        ← TypeScript patterns, file rules, naming
│   ├── UI_DESIGN_SYSTEM.md        ← CSS variables, components, spacing
│   ├── PHASE_PLAN.md              ← what is done, in progress, and next
│   ├── SHELL_STRUCTURE.md         ← app shell split rationale + mount registry
│   └── (legacy docs kept for ADR history — see bottom of this file)
│
├── src/                           ← All frontend source
│   ├── main.tsx                   ← Entry point: boot sequence only, no logic
│   │
│   ├── shell/                     ← App shell HTML as Preact components
│   │   ├── AppShell.tsx           ← Root: sidebar + main + modal overlays
│   │   ├── LoginShell.tsx         ← Login + 2FA panel structure
│   │   ├── sections/              ← Section wrappers (static mount points)
│   │   │   ├── EmployeeSections.tsx
│   │   │   ├── ManagerSections.tsx
│   │   │   ├── AdminSections.tsx
│   │   │   └── SharedSections.tsx
│   │   └── modals/                ← Modal HTML (Preact in Phase 2)
│   │       ├── NotificationModal.tsx
│   │       ├── MessageModal.tsx
│   │       ├── TicketModal.tsx
│   │       ├── EmployeeModals.tsx
│   │       └── ProjectSiteModal.tsx
│   │
│   ├── components/
│   │   ├── auth/                  ← Login page + 2FA (full Preact)
│   │   ├── nav/                   ← Sidebar, badges, modal controllers
│   │   ├── realtime/              ← Supabase Realtime subscription manager
│   │   ├── livemap/               ← Leaflet map module (window.LiveMap)
│   │   ├── sections/              ← Feature domains (one folder per domain)
│   │   │   ├── AdminLeave/
│   │   │   ├── Attendance/
│   │   │   ├── AttendanceDashboard/
│   │   │   ├── Dashboard/
│   │   │   ├── Employees/
│   │   │   ├── HourlyRates/
│   │   │   ├── LiveMap/
│   │   │   ├── Payroll/
│   │   │   ├── Profile/
│   │   │   ├── ProjectSites/
│   │   │   └── Settings/
│   │   └── shared/                ← Reusable UI primitives (no section deps)
│   │       ├── Avatar.tsx
│   │       ├── Badge.tsx
│   │       ├── ConfirmDialog.tsx
│   │       ├── DataTable.tsx
│   │       ├── ErrorBoundary.tsx
│   │       ├── Modal.tsx
│   │       ├── Spinner.tsx
│   │       └── Toast.tsx
│   │
│   ├── api/                       ← Typed Supabase API layer (Phase 2a+)
│   │   ├── index.ts               ← Public barrel (@api alias)
│   │   ├── queryKeys.ts           ← Global TanStack Query key registry
│   │   ├── employees.ts           ← Employee + department CRUD
│   │   ├── attendance.ts          ← Attendance reads + check-in/out
│   │   ├── leave.ts               ← Leave request CRUD + review
│   │   ├── payroll.ts             ← Payroll runs, entries, hourly rates
│   │   ├── sites.ts               ← Project sites + live map data
│   │   ├── settings.ts            ← Company settings + statutory rates
│   │   └── schemas/               ← Zod schemas for validation + inferred types
│   │       ├── attendance.ts
│   │       ├── employee.ts
│   │       ├── leave.ts
│   │       ├── payroll.ts
│   │       ├── site.ts
│   │       └── settings.ts
│   │
│   ├── lib/                       ← Services and utilities
│   │   ├── api.ts                 ← Typed fetch wrapper (legacy backend calls)
│   │   ├── apiLegacy.ts           ← Legacy window.api shim (being retired)
│   │   ├── appState.ts            ← window.AppState bridge
│   │   ├── attSystem.ts           ← Core attendance orchestrator
│   │   ├── cache.ts               ← IndexedDB SWR write-through
│   │   ├── charts.ts              ← window.SiomacCharts (Chart.js wrapper)
│   │   ├── env.ts                 ← VITE_* validation (throws on bad config)
│   │   ├── logger.ts              ← Structured logging → Sentry in prod
│   │   ├── popup.ts               ← window.cpop / window.Swal shim
│   │   ├── queryClient.ts         ← TanStack QueryClient singleton
│   │   ├── session.ts             ← JWT helpers, localStorage session
│   │   └── supabase.ts            ← Supabase client singleton (npm package)
│   │
│   ├── store/                     ← Zustand stores (client state only)
│   │   ├── session.ts             ← Who is logged in
│   │   ├── ui.ts                  ← What the UI is showing
│   │   ├── data.ts                ← Derived employee/dept/site cache
│   │   └── realtime.ts            ← Realtime subscription state
│   │
│   ├── config/
│   │   └── index.ts               ← SECTION_DEFS, PALETTES, LAYOUTS
│   │
│   ├── hooks/                     ← Shared custom hooks
│   └── types/                     ← Shared TypeScript interfaces
│
├── assets/
│   ├── styles/                    ← All CSS — see UI_DESIGN_SYSTEM.md
│   └── images/
│
├── netlify/
│   └── functions/                 ← Hono edge functions (backend)
│       ├── api.ts                 ← Entry point (Hono app)
│       ├── routes/                ← One file per route group
│       └── lib/                   ← Shared backend utilities
│
├── index.html                     ← Shell HTML inlined (no runtime fetch)
├── vite.config.ts
├── vitest.config.ts
└── tsconfig.frontend.json
```

---

## 4. Module Boundaries & Import Rules

### The Golden Rule: modules do not reach into each other's internals

```typescript
// ✅ correct — use the public surface (index.ts)
import { mountAttendanceSection } from '@sections/Attendance';

// ❌ wrong — never import private internals
import { _renderRows } from '@sections/Attendance/AttendanceSection';
```

Each section folder exposes exactly one public surface: its `index.ts`.
Everything else inside the folder is private to that section.

### Dependency directions (no upward or circular imports)

```
shell/            →  components/sections  →  lib, store, shared
                  →  components/shared    →  lib, store
                  →  lib                  →  store
                  →  store                →  (nothing from src/)
```

- `shared/` components **never** import from `sections/`
- `lib/` modules **never** import from `components/`
- `store/` modules **never** import from `components/`

### Import alias reference

| Alias | Resolves to | Use for |
|---|---|---|
| `@lib/foo` | `src/lib/foo` | Services, utilities |
| `@store/foo` | `src/store/foo` | Zustand stores |
| `@shared/Foo` | `src/components/shared/Foo` | UI primitives |
| `@sections/Foo` | `src/components/sections/Foo` | Feature sections |
| `@components/auth` | `src/components/auth` | Login / 2FA |
| `@components/nav` | `src/components/nav` | Nav controller |
| `@components/realtime` | `src/components/realtime` | Realtime controller |
| `@components/livemap` | `src/components/livemap` | Live map module |
| `@cfg/index` | `src/config/index` | App constants |
| `@api` | `src/api/index.ts` | Typed Supabase API layer + query keys |
| `@api/foo` | `src/api/foo` | Domain-specific API module |
| `@shell` | `src/shell/index.ts` | App shell components |
| `@` | `src/` | Fallback root |

Aliases are defined in `vite.config.ts`, `vitest.config.ts`, **and** `tsconfig.frontend.json`.
When you add a new alias, update **all three** files.

---

## 5. Boot Sequence

`index.html` → `src/main.tsx` → `bootApp()`

```
Import-time (module graph resolution — order is critical):
  1. @lib/env            → validate VITE_* vars (throws immediately if missing)
  2. @cfg/index          → register window.SiomacConfig
  3. @lib/popup          → register window.cpop / window.Swal
  4. @lib/charts         → register window.SiomacCharts
  5. @lib/appState       → register window.AppState
  6. @lib/apiLegacy      → register window.api / window.swr  ← MUST be before cache
  7. @lib/cache          → register SiomacDB, patch window.swr write-through
  8. @components/realtime → register window._initRealtime / _teardownRealtime
  9. @components/livemap  → register window.LiveMap
  10. @lib/attSystem      → register window.AttendanceSystem   ← MUST be last

bootApp() — runs after all imports resolve:
  ├── Render <AppShell /> into #app-root        (replaces old fetch + innerHTML)
  ├── Warm IndexedDB SWR cache (SiomacDB.warmSwr)
  ├── AttendanceSystem.init()
  ├── Mount all Preact section controllers
  └── document.body.style.visibility = ''      (removes FOUC guard)
```

**Critical ordering rules — do not change without understanding these:**
- `apiLegacy` BEFORE `cache` — cache.ts monkey-patches the `swr` object that
  apiLegacy creates; if cache runs first, the patch target doesn't exist yet
- `attSystem` LAST — it calls `window.cpop`, `window.AppState`, `window.api`,
  `window.SiomacConfig`; all of those must be registered before it runs
- `body { visibility: hidden }` is set in `index.html` and cleared at the end
  of `bootApp()` — never remove this guard, it prevents login-flash on refresh

---

## 6. Data Flow

### Server data — TanStack Query (use for all new code)

```
User action
  → Preact component calls useQuery / useMutation
  → TanStack Query checks cache  (staleTime: 60 000 ms)
  → Cache miss / stale → section's api.ts function
  → api.ts calls apiFetch() from @lib/api
  → apiFetch() POSTs to /api  { action, args, token }
  → Netlify Edge Function (Hono) handles request
  → Response normalised to typed result
  → TanStack Query caches, re-renders all subscribers
  → On mutation success → queryClient.invalidateQueries([key])
```

### Legacy data — SWR cache (do not use for new code; being retired in Phase 2)

```
Legacy caller → window.api(action, args)
  → apiLegacy.ts → _rawApi()
  → SWR in-memory Map<string, SwrEntry>  (TTL: 60 000 ms)
  → IndexedDB write-through  (cache.ts monkey-patch)
  → Subscribers notified via _swrFire()
```

### Realtime data — Supabase Realtime (Phase 2 target)

```
Supabase DB row change
  → Realtime WebSocket pushes event to client
  → RealtimeController receives payload
  → queryClient.invalidateQueries([relevant key])
  → TanStack Query refetches, components re-render
```

---

## 7. State Management

Three layers — each with a distinct, non-overlapping responsibility:

| Layer | Technology | Responsibility |
|---|---|---|
| Server state | TanStack Query | All data fetched from /api or Supabase |
| Client state | Zustand stores | Auth session, UI state, derived caches |
| Legacy bridge | window.AppState | Bridge for legacy JS (transitional, retire in Ph2) |

### Zustand store responsibilities

**`store/session.ts`** — Who is logged in  
Fields: `userId, username, fullName, role, departmentId, token, expiresAt`  
Selectors: `selectIsAdmin`, `selectIsManager`, `selectUserId`, `selectRole`

**`store/ui.ts`** — What the UI is showing  
Fields: `activeSection, sectionLoading, theme, sidebarOpen, toasts`  
Helpers: `toast.success()`, `toast.error()`, `toast.warning()`, `toast.info()`

**`store/data.ts`** — Derived entity cache  
Fields: `employees[], departments[], projectSites[], totalActiveEmployees`  
Populated by TanStack mutations via `registerQueryClient()`

**`store/realtime.ts`** — Realtime subscription tracking  
Fields: `connectedChannels[], lastEventAt`

### Store write rule

Write through actions, never directly to state:
```typescript
// ✅
toast.success('Saved');

// ❌
useUiStore.setState({ toasts: [...toasts, newToast] });
```

---

## 8. API Layer

### New layer — use for all Phase 2+ features

`src/lib/api.ts` provides typed helpers:

```typescript
import { apiGet, apiPost } from '@lib/api';

const employees = await apiGet<Employee[]>('/api', { action: 'listEmployees' });
const result    = await apiPost<ApiResult>('/api', { action: 'addEmployee', args: { ... } });
```

- Auth token attached automatically from session store
- Errors normalised to `ApiError { code, message, status }`
- 401 responses trigger `handleSessionExpired()`

### Section-scoped API modules — never call /api from a component directly

Each section owns its API calls in `<Section>/api.ts`:

```
src/components/sections/Employees/api.ts    — listEmployees, addEmployee, ...
src/components/sections/Attendance/api.ts   — listDailyLog, getStats, ...
src/components/sections/Payroll/api.ts      — runPayroll, getPayslip, ...
```

Components call the typed function from their section's `api.ts`. They never
call `apiFetch()`, `window.api()`, or `fetch()` directly.

### Legacy layer — do not use for new code

`src/lib/apiLegacy.ts` exports `window.api()` / `window.apiSwr()` shims used
by `attSystem.ts` and other legacy callers. Will be retired in Phase 2a.

---

## 9. Authentication & Session

### Current (Phase 1 — transitional)

- Token stored in `localStorage` key `siomac_session_v1`
- Payload: `{ userId, username, fullName, role, token, expiresAt, rememberMe, ... }`
- Session durations: 8 h normal / 7 days rememberMe
- 5-minute expiry warning via `cpop` toast
- `attSystem.ts` owns session timer, warning, and expiry logic
- Every API call attaches `Authorization: Bearer <token>` header

### Auth-gate contract — non-negotiable rules

**Rule 1 — All authenticated queries must be gated on `isAuthenticated`.**

Every `useQuery` or `useInfiniteQuery` call that touches an authenticated endpoint
**must** include `enabled: isAuthenticated` (or a stricter condition that implies it):

```typescript
// ✅ Required pattern — read isAuthenticated from session store
const isAuthenticated = useSessionStore(s => s.isAuthenticated);
useQuery({
  queryKey: employeeKeys.list(),
  queryFn:  ({ signal }) => listEmployees(signal),
  staleTime: 60_000,
  enabled:  isAuthenticated,   // ← MANDATORY
});

// ❌ Forbidden — query fires before login, causing 401 noise and logout loop
useQuery({
  queryKey: employeeKeys.list(),
  queryFn:  ({ signal }) => listEmployees(signal),
  staleTime: 60_000,
  // no enabled: ... → fires on page load before user logs in
});
```

Additional param guards (e.g. `enabled: isAuthenticated && !!username`) are fine
and encouraged, but `isAuthenticated` must be part of the condition on every
authenticated query. Never hard-code `enabled: true` on an authenticated query.

**Rule 2 — `apiFetch` only triggers session expiry when a session exists.**

A 401 response means different things depending on context:
- **No session exists** → caller is unauthenticated (e.g. a query that fired on
  the login screen). Return `{ success: false, message: 'Unauthorized' }` silently.
  Do NOT call `_onAuthExpired()`. Do NOT show a logout or expiry message.
- **A session exists and the 401 is unexpected** → the token genuinely expired or
  was revoked. Attempt one silent refresh; if that fails, call `_onAuthExpired()`.

This contract is enforced in `src/lib/api.ts`. Do not bypass it.

**Rule 3 — Boot-time API calls must check session presence first.**

`attSystem.init()` and any other code that runs at page load **must not** call
authenticated API endpoints unless `loadSession()` returns a non-null value.
Pre-login fetches must be either:
- Public endpoints (no auth needed), or
- Deferred until `store/session.ts` emits `isAuthenticated = true`

**Rationale:** Before these rules were codified, every pre-login query returned
401, which triggered `_onAuthExpired()`, which triggered `expire()` in the session
store, which logged the user out before they could log in — a self-reinforcing loop
visible as repeated "Session expired — forcing logout" warnings in the console.

### Target (Phase 2b)

- Auth token → Supabase session cookie (httpOnly, managed by Supabase JS client)
- User preferences → `localStorage` only (theme, palette, layout — non-sensitive)
- `store/session.ts` reads from `supabase.auth.getSession()` instead of localStorage
- Permission overrides stored in `user_permissions` DB table (super-admin can set)
- `can('permission.key')` helper resolves: role defaults → per-user overrides

### Roles

| Role | Access |
|---|---|
| `superadmin` | Full access + user permission management |
| `admin` | Full operational access |
| `manager` | Department-scoped; capabilities customisable by superadmin |
| `employee` | Self-service only |

---

## 10. Realtime

### Current (Phase 1)

`src/components/realtime/RealtimeController.ts` registers:
- `window._initRealtime(userId)` — called by attSystem on login
- `window._teardownRealtime()` — called by attSystem on logout

### Target (Phase 2c–e)

Supabase Realtime channels per domain:

| Channel | Trigger | Client action |
|---|---|---|
| `notifications:userId` | New notification row | Invalidate notifications query, update bell badge |
| `messages:userId` | New message | Invalidate messages query, update message badge |
| `tickets:userId` | Ticket update | Invalidate tickets query, update ticket badge |
| `attendance` | Check-in / out | Invalidate live attendance query, refresh map |

All channels are subscribed in `RealtimeController` on login and torn down on logout.
If the WebSocket drops, fall back to 30-second polling automatically.

---

## 11. Backend — Netlify Edge Functions

```
netlify/functions/
├── api.ts              ← Hono app entry point; all routes registered here
├── routes/             ← One file per domain
│   ├── auth.ts
│   ├── employees.ts
│   ├── attendance.ts
│   ├── leave.ts
│   ├── payroll.ts
│   ├── settings.ts
│   ├── notifications.ts   (Phase 2c)
│   ├── messages.ts        (Phase 2d)
│   └── tickets.ts         (Phase 2e)
└── lib/
    ├── auth.ts         ← JWT verify (RS256), session helpers
    ├── db.ts           ← Supabase client, typed query helpers
    ├── rbac.ts         ← Permission resolution (Phase 2b)
    └── notify.ts       ← Notification creation + delivery stub (Phase 2c)
```

**Auth:** RS256 JWT. Private key signs (backend). Public key verifies. Both stored
as Netlify env vars. bcrypt cost factor 12 for all password hashes.

**Every route handler pattern:**
```typescript
async function myAction(args: MyArgs, ctx: HonoContext): Promise<ApiResult> {
  const user = requireAuth(ctx);          // throws 401 if no valid token
  requireRole(user, ['admin', 'manager']); // throws 403 if wrong role
  // ... business logic
  return { success: true, data: result };
}
```

---

## 12. Database — Supabase PostgreSQL

See `docs/DATA_DICTIONARY.md` for full schema.

**Phase 1 tables (current):**

| Table | Purpose |
|---|---|
| `users` | Employee accounts, roles, departments |
| `attendance_logs` | Check-in / check-out records + selfie URLs |
| `project_sites` | Geofenced site definitions |
| `site_assignments` | Employee ↔ site links |
| `leave_requests` | Leave applications + approval status |
| `payroll_runs` | Payroll periods + calculated results |
| `hourly_rates` | Per-employee rate overrides |
| `departments` | Department definitions |
| `settings` | Company-wide settings key/value store |

**Phase 2 additions (planned):**

| Table | Purpose |
|---|---|
| `notifications` | In-app notification records |
| `notification_preferences` | Per-user channel preferences |
| `conversations` | Message threads (DM / group / broadcast) |
| `conversation_participants` | Thread membership + last_read_at |
| `messages` | Message content + attachments |
| `tickets` | Support ticket records |
| `ticket_categories` | Category definitions with routing + SLA |
| `ticket_comments` | Ticket reply thread |
| `user_permissions` | Per-user permission overrides (superadmin sets) |

**RLS:** All tables have Row Level Security enabled. Every query runs through
the service role key server-side; the anon key is never used for data queries.

---

## 13. Phase Map

| Phase | Description | Status |
|---|---|---|
| 1 | Port all vanilla JS → TypeScript / Preact | ✅ Complete |
| 1b | App shell split + inline into `index.html` | 🔄 In Progress |
| 2a | Typed API layer (Supabase-native endpoints) | ⬜ Next |
| 2b | Auth (Supabase session + RBAC permissions) | ⬜ Pending |
| 2c | Notifications (DB + Realtime + bell UI) | ⬜ Pending |
| 2d | Messages (full inbox + Realtime) | ⬜ Pending |
| 2e | Tickets (HR + general, category routing, SLA) | ⬜ Pending |
| 2f | External delivery (email + WhatsApp — provider stub) | ⬜ Pending |
| 2g | Performance (optimistic updates, prefetch, virtual scroll) | ⬜ Pending |

See `docs/PHASE_PLAN.md` for detailed task breakdown per phase.

---

## 14. Architecture Decision Records

ADRs document irreversible decisions. Changing a decision requires a new ADR,
not editing an existing one.

### ADR-001 — Hono for Netlify Edge Functions
**Status:** Implemented  
Single `api.ts` entry, one file per route group in `routes/`. Chosen over Express
(too heavy) and raw handlers (no middleware composition).

### ADR-002 — RS256 JWT (replacing HS256)
**Status:** Implemented  
Private key signs, public key verifies. Leaked public key cannot mint tokens.
HS256 shared-secret model fails this property.

### ADR-003 — bcrypt cost factor 12
**Status:** Implemented  
Meets OWASP minimum. Existing hashes re-hashed transparently on login.

### ADR-004 — Preact over React
**Status:** Implemented  
3 KB vs 45 KB runtime. Full React API compatibility via `preact/compat`. Aliases
in `vite.config.ts` and `vitest.config.ts` make this transparent to all code.

### ADR-005 — TanStack Query as single server-state source of truth
**Status:** Implemented  
Replaces the legacy SWR in-memory cache. Provides deduplication, background
refetch, stale-while-revalidate, and optimistic update support out of the box.
Legacy SWR retained during Phase 1 transition; retired in Phase 2a.

### ADR-006 — Supabase as primary backend (not abstracted)
**Status:** Implemented  
Supabase JS client used directly — no adapter layer. If migration to Laravel is
needed in future, it will be a targeted rewrite of `netlify/functions/lib/db.ts`
and the Realtime subscription in `RealtimeController.ts`. Frontend code does not
import Supabase directly; all Supabase calls stay in `lib/` and `functions/`.

### ADR-007 — App shell inlined into index.html (not fetched at runtime)
**Status:** In Progress (Phase 1b)  
The `fetch('assets/partials/app-shell.html')` round-trip added 1 network request
to every page load and prevented prerendering. Shell HTML is split into typed
Preact components under `src/shell/` and composed into `index.html` at build time.

### ADR-008 — Split app-shell.html into src/shell/ components
**Status:** In Progress (Phase 1b)  
2,234-line monolithic HTML partial split into logical components by concern:
LoginShell, section groups, and modal panels. Each modal (Notification, Message,
Ticket) is its own file because Phase 2 will convert them to full Preact
components — the split makes that a surgical replacement, not a large-file edit.
See `docs/SHELL_STRUCTURE.md` for the complete mount-point registry.
