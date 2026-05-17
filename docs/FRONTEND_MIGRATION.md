# Siomac Frontend — Vite + TypeScript Migration Plan

> **Status:** Planned — not yet started  
> **Scope:** Full rewrite of `assets/` from serial-loaded vanilla JS to a typed,
> tree-shaken ESM bundle built by Vite  
> **Backend:** Unchanged — `netlify/functions/` stays as TypeScript/Hono

---

## 1. Why This Migration

The current frontend is a 11 000-line serial-script codebase with the following
confirmed production defects discovered during pre-migration audit:

| # | Defect | Symptom |
|---|---|---|
| 1 | `loadLiveAttendance` called as bare name in `realtime.js` | Realtime map refresh silently fails |
| 2 | `_attFpFrom` / `_attFpTo` inaccessible from `attendance-view.js` | Date-range filter falls back to month mode |
| 3 | `showSection` bare name in `sites.js` | Site popup navigation may throw |
| 4 | `_selectLiveSite`, `liveData`, `map`, `_siteLayerMap` bare names in `sites.js` | Live site selection broken |
| 5 | `showNotification` undefined in `payroll.js` | Payroll save notifications silent |
| 6 | `_scheduleHdrBadgeSync` bare name in `realtime.js` | Header badge count stale after realtime events |
| 7 | `displayLeaveApplications` bare name in `leave.js` | Leave list does not refresh after manager action |
| 8 | `_getPendingLeaveCount` bare name in `nav.js` | Leave badge count always 0 |
| 9 | `swr._inflight` private access in `employees.js` | Fragile — breaks if SWR internals change |
| 10 | `_buildPayslipHtml` duplicated between `app.js` + `employees.js` | Payslip formatting diverges silently |
| 11 | `initDataTable` / `destroyDataTable` duplicated in `employees.js` + `payroll.js` + `attendance-view.js` | Bug fixes must be applied 3× |
| 12 | `_lvCard` and 6 other leave helpers duplicated in `employees.js` + `leave.js` | UI diverges between manager and admin views |
| 13 | Supabase anon key hard-coded in source | Key rotation requires source change + deploy |
| 14 | `base target="_top"` in `index.html` | Google Apps Script relic — no longer needed |
| 15 | jQuery loaded for `$.ajax()` only | 90 KB dead weight; native `fetch` covers this |
| 16 | `app-shell.html` fetched at runtime | Extra serial round-trip before first JS |
| 17 | Notification polling at 5 s interval alongside Supabase Realtime | Redundant bandwidth |
| 18 | SW registered twice (inline + `SwCacheManager`) | SW lifecycle management is ambiguous |
| 19 | `text/plain` AJAX workaround from Google Apps Script era | Sends wrong Content-Type to Hono |

Beyond bugs, there is zero type safety on the frontend despite `types/api.ts`
and `types/db.ts` already existing.

---

## 2. Target Architecture

```
src/
├── main.ts                   ← single entry point; wires everything together
├── globals.d.ts              ← declare CDN globals that stay on the CDN
│
├── config/
│   └── index.ts              ← SECTION_DEFS, PALETTES, LAYOUTS, COMMON_ITEMS
│
├── lib/                      ← pure utilities, no DOM side-effects on import
│   ├── api.ts                ← fetch-based api(), apiSwr(), swr store
│   ├── state.ts              ← AppState reactive store (typed)
│   ├── session.ts            ← saveSession, loadSession, clearSession, timers
│   ├── format.ts             ← fmtLocalTime, escapeHtml, cssEscape, fmtCurrency
│   ├── validation.ts         ← _validate(), _fieldError(), _fieldOk()
│   ├── skeleton.ts           ← setSkel, skelTableRows, skelStatValues, etc.
│   ├── photo.ts              ← _swapAvatarImg, _setAttendanceAvatar, _patchPhotoCache
│   ├── payslip.ts            ← _buildPayslipHtml (single canonical copy)
│   ├── leave-card.ts         ← _lvCard, _lvTypeBadge, _lvStatusBadge, etc. (single copy)
│   ├── datatable.ts          ← initDataTable, destroyDataTable (single copy)
│   ├── phone.ts              ← phone mask, setPhone, readPhone
│   └── spinbtn.ts            ← _spinBtn, _countUp
│
├── cache/
│   ├── idb.ts                ← SiomacDB (IndexedDB wrapper)
│   └── sw-manager.ts         ← SwCacheManager (Service Worker messaging)
│
├── popup/
│   └── index.ts              ← cpop (custom alert/confirm/toast), showSpinner, hideSpinner
│
├── realtime/
│   └── index.ts              ← Supabase Realtime subscription (no polling fallback)
│
├── modules/                  ← feature modules; one file per section
│   ├── auth.ts               ← handleLogin, 2FA flow, applySession, handleLogout
│   ├── nav.ts                ← Nav object, sidebar, header badges, messages, tickets
│   ├── dashboard.ts          ← Dashboard charts and edit mode
│   ├── live-map.ts           ← LiveMap (Leaflet, cluster markers)
│   ├── employees.ts          ← Employees CRUD, leave management, payslips
│   ├── sites.ts              ← Sites CRUD, map picker
│   ├── attendance.ts         ← AttendanceView (admin/manager daily log)
│   ├── leave.ts              ← LeaveView (admin leave document viewer)
│   ├── payroll.ts            ← Payroll runs, hourly rates
│   ├── profile.ts            ← Profile (my account, photo, password)
│   ├── settings.ts           ← SettingsView (branding, work hours, statutory rates)
│   ├── camera.ts             ← camera modal, selfie capture, geo attendance
│   └── charts.ts             ← SiomacCharts (Chart.js wrappers)
│
└── types/                    ← symlinked or re-exported from ../../types/
    ├── api.ts
    └── db.ts
```

**Build output:**
```
dist/
├── index.html                ← processed by Vite (inlines Vite module tag)
├── assets/
│   ├── bundle.[hash].js      ← our code (tree-shaken, minified)
│   └── styles.[hash].css     ← all CSS bundled (optional; CDN links preserved)
└── sw.js                     ← generated by vite-plugin-pwa
```

---

## 3. Third-Party Library Strategy

Libraries stay on CDN if:
- They are large (> 50 KB minified)
- They are already cached across sites (Bootstrap, Leaflet, jQuery)
- They have non-standard build requirements (DataTables + jQuery coupling)

Libraries move into the bundle if:
- They are small
- They have no CDN cache benefit
- They have TypeScript types already available

| Library | Strategy | Reason |
|---|---|---|
| Bootstrap 5 CSS + JS | **CDN** | Universal CDN cache; large bundle |
| jQuery | **Remove** | Only used for `$.ajax` — replaced by native `fetch` |
| Leaflet + markercluster | **CDN** | 145 KB + map tiles; standard CDN |
| DataTables + Buttons | **CDN** | Requires jQuery; keep together |
| flatpickr | **Bundle** | 17 KB; `import flatpickr from 'flatpickr'` |
| Chart.js | **CDN** | 200 KB; already CDN-cached |
| SortableJS | **Bundle** | 9 KB; `import Sortable from 'sortablejs'` |
| JSZip | **CDN** | Used transitively by DataTables only |
| pdfMake | **CDN** | Used transitively by DataTables only |
| Supabase JS | **CDN** | Used for Realtime only; service-role on backend |
| Font Awesome | **CDN** | CSS icon font |
| Inter font | **CDN** | Google Fonts |

CDN globals declared in `src/globals.d.ts`:
```ts
declare const bootstrap: typeof import('bootstrap');
declare const L: typeof import('leaflet');
declare const Chart: typeof import('chart.js').Chart;
declare const $: JQueryStatic;
declare const supabase: ReturnType<typeof import('@supabase/supabase-js').createClient>;
// DataTables declared via @types/datatables.net (installed as devDependency)
```

---

## 4. Key Design Decisions

### 4.1 State management: keep `AppState`, add types

`AppState` is already a good reactive store pattern. We keep it but:
- Add full TypeScript types to every key
- Move the store definition into `src/lib/state.ts`
- Expose typed getters/setters instead of string keys where possible

```ts
// Before
AppState.get('currentUser') as string | null

// After — same API, but typed
AppState.get('currentUser')   // inferred as string | null
```

### 4.2 API layer: drop jQuery, add types

Replace `$.ajax()` with native `fetch`. The `text/plain` content-type workaround
is also removed — the backend (Hono) accepts `application/json`.

```ts
// src/lib/api.ts
export async function api<T = unknown>(action: string, args?: Record<string, unknown>): Promise<T>
export async function apiSwr<T>(action: string, args: Record<string, unknown>, opts: SwrOpts<T>): Promise<T>
```

### 4.3 Eliminate all bare-name cross-module references

Every function that was previously called by bare name becomes an explicit
import. The 19 bare-name bugs listed in Section 1 are all fixed as a direct
consequence of this.

```ts
// Before (sites.js — broken)
showSection('s-projectMap');

// After (src/modules/sites.ts — correct)
import { showSection } from './nav';
showSection('s-projectMap');
```

### 4.4 Deduplicate shared logic

Every duplicated function gets a single canonical home in `src/lib/`:

| Function | Canonical location | Removed from |
|---|---|---|
| `_buildPayslipHtml` | `src/lib/payslip.ts` | `app.js`, `employees.js` |
| `initDataTable` / `destroyDataTable` | `src/lib/datatable.ts` | `employees.js`, `payroll.js`, `attendance-view.js` |
| `_lvCard` + 6 leave helpers | `src/lib/leave-card.ts` | `employees.js`, `leave.js` |
| `_countUp` | `src/lib/spinbtn.ts` | `app.js`, `employees.js` |
| `_swapAvatarImg` | `src/lib/photo.ts` | `app.js`, `profile.js` |

### 4.5 Remove Google Apps Script legacy

- Remove `<base target="_top">` from `index.html`
- Remove `text/plain` Content-Type from API calls; use `application/json`
- Remove `// avoids CORS preflight that Apps Script can't answer` comments
- Remove the `const API = '/api'` indirection; use a Vite env var `VITE_API_BASE`

### 4.6 Environment variables via Vite

```ts
// src/lib/api.ts
const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

// src/realtime/index.ts
const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
```

```
# .env (gitignored)
VITE_API_BASE=/api
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
```

### 4.7 `app-shell.html` inlined at build time

Currently fetched at runtime (extra round-trip). With Vite:

```ts
// src/main.ts
import shellHtml from './shell.html?raw';   // Vite raw import
document.getElementById('app-root')!.innerHTML = shellHtml;
```

This eliminates the fetch waterfall and puts the HTML into the bundle.

### 4.8 Service Worker via `vite-plugin-pwa`

`vite-plugin-pwa` generates `sw.js` and handles registration. The inline SW
registration in `index.html` and `SwCacheManager.register()` in `cache.js` are
both removed. The plugin handles registration lifecycle including `SKIP_WAITING`.

### 4.9 Realtime: remove 5-second polling

`nav.js` polls notifications every 5 seconds even when Supabase Realtime is
connected. The migration removes the interval and drives badge updates purely
from Realtime events, with a single manual refresh on reconnect.

### 4.10 Notification content type fix

The API currently sends `text/plain` and the client parses the JSON body
manually. After migration, both sides use `application/json`:

```ts
// Backend (already correct — Hono returns application/json)
// Frontend (src/lib/api.ts)
const res = await fetch(`${API_BASE}/${action}`, {
  method:  'POST',
  headers: { 'Content-Type': 'application/json', ...authHeader },
  body:    JSON.stringify(args),
});
return res.json() as Promise<T>;
```

---

## 5. Module Dependency Graph (post-migration)

```
main.ts
  ├── lib/state.ts          (no deps on other src files)
  ├── lib/api.ts            ← lib/state.ts (for token)
  ├── lib/session.ts        ← lib/state.ts, lib/api.ts
  ├── lib/format.ts         (no deps)
  ├── lib/validation.ts     (no deps)
  ├── lib/skeleton.ts       (no deps)
  ├── lib/photo.ts          ← lib/format.ts
  ├── lib/payslip.ts        ← lib/format.ts
  ├── lib/leave-card.ts     ← lib/format.ts
  ├── lib/datatable.ts      (declares $ as global CDN)
  ├── lib/phone.ts          (no deps)
  ├── lib/spinbtn.ts        (no deps)
  ├── cache/idb.ts          ← lib/api.ts (swr patch)
  ├── cache/sw-manager.ts   (no deps)
  ├── popup/index.ts        (declares bootstrap as global CDN)
  ├── config/index.ts       (no deps)
  │
  ├── modules/auth.ts       ← lib/session.ts, lib/api.ts, lib/state.ts,
  │                            lib/validation.ts, lib/photo.ts, popup/
  │
  ├── modules/nav.ts        ← lib/state.ts, lib/api.ts, lib/format.ts,
  │                            lib/skeleton.ts, config/, popup/,
  │                            modules/dashboard.ts, modules/live-map.ts,
  │                            modules/employees.ts, modules/sites.ts,
  │                            modules/attendance.ts, modules/leave.ts,
  │                            modules/payroll.ts, modules/profile.ts,
  │                            modules/settings.ts
  │
  ├── modules/dashboard.ts  ← lib/state.ts, lib/api.ts, lib/spinbtn.ts,
  │                            lib/skeleton.ts, modules/charts.ts
  │
  ├── modules/live-map.ts   ← lib/state.ts, lib/api.ts, lib/format.ts,
  │                            lib/skeleton.ts (declares L as global CDN)
  │
  ├── modules/employees.ts  ← lib/state.ts, lib/api.ts, lib/format.ts,
  │                            lib/validation.ts, lib/skeleton.ts,
  │                            lib/payslip.ts, lib/leave-card.ts,
  │                            lib/datatable.ts, lib/spinbtn.ts,
  │                            popup/
  │
  ├── modules/sites.ts      ← lib/state.ts, lib/api.ts, lib/validation.ts,
  │                            lib/skeleton.ts, lib/spinbtn.ts, popup/,
  │                            modules/nav.ts (showSection),
  │                            modules/live-map.ts (_selectLiveSite)
  │                            (declares L as global CDN)
  │
  ├── modules/attendance.ts ← lib/state.ts, lib/api.ts, lib/format.ts,
  │                            lib/skeleton.ts, lib/datatable.ts,
  │                            modules/charts.ts, popup/
  │
  ├── modules/leave.ts      ← lib/state.ts, lib/api.ts, lib/format.ts,
  │                            lib/leave-card.ts, lib/skeleton.ts, popup/
  │
  ├── modules/payroll.ts    ← lib/state.ts, lib/api.ts, lib/format.ts,
  │                            lib/validation.ts, lib/skeleton.ts,
  │                            lib/datatable.ts, lib/spinbtn.ts, popup/
  │
  ├── modules/profile.ts    ← lib/state.ts, lib/api.ts, lib/validation.ts,
  │                            lib/phone.ts, lib/photo.ts, lib/format.ts,
  │                            cache/sw-manager.ts, popup/
  │
  ├── modules/settings.ts   ← lib/state.ts, lib/api.ts, lib/session.ts, popup/
  │
  ├── modules/camera.ts     ← lib/state.ts, lib/api.ts, lib/format.ts, popup/
  │
  ├── modules/charts.ts     ← (declares Chart as global CDN)
  │
  └── realtime/index.ts     ← lib/state.ts, modules/nav.ts,
                               modules/live-map.ts
                               (declares supabase as global CDN)
```

**Circular dependency resolution:**
`nav.ts` imports from `modules/` for `refreshSection()`. Those modules import
from `nav.ts` for `showSection()`. This is a real circular dependency.

**Resolution:** Extract `showSection` into a lightweight `modules/router.ts`
module that both `nav.ts` and the feature modules import, breaking the cycle:

```
modules/router.ts  ← lib/state.ts, config/
modules/nav.ts     ← modules/router.ts, modules/* (for refreshSection)
modules/sites.ts   ← modules/router.ts  (not modules/nav.ts)
```

---

## 6. File-by-File Migration Map

| Current file | New file(s) | Notes |
|---|---|---|
| `assets/js/state.js` | `src/lib/state.ts` | Add full type annotations |
| `assets/js/config.js` | `src/config/index.ts` | Pure constants, direct exports |
| `assets/js/api.js` | `src/lib/api.ts` | Replace `$.ajax` with `fetch`; remove `text/plain` |
| `assets/js/cache.js` | `src/cache/idb.ts` + `src/cache/sw-manager.ts` | Split IndexedDB from SW; SWR patch moves to `api.ts` init |
| `assets/js/popup.js` | `src/popup/index.ts` | Drop `window.Swal` alias; export `cpop`, `showSpinner`, `hideSpinner` |
| `assets/js/realtime.js` | `src/realtime/index.ts` | Fix bare-name `loadLiveAttendance` bug; remove 5s polling |
| `assets/js/charts.js` | `src/modules/charts.ts` | Direct port; Chart CDN global declared |
| `assets/js/dashboard.js` | `src/modules/dashboard.ts` | Bundle SortableJS |
| `assets/js/nav.js` | `src/modules/nav.ts` + `src/modules/router.ts` | Fix circular dep; extract `showSection`; fix `SECTION_DEFS` access |
| `assets/js/live-map.js` | `src/modules/live-map.ts` | Export `loadLiveAttendance` properly; fix `showNotification` |
| `assets/js/employees.js` | `src/modules/employees.ts` | Remove duplicate `_lvCard*`, `initDataTable`, `_buildPayslipHtml`, `_countUp` |
| `assets/js/sites.js` | `src/modules/sites.ts` | Fix all 5 bare-name bugs; move load-time listeners into init fn |
| `assets/js/attendance-view.js` | `src/modules/attendance.ts` | Fix `_attFpFrom`/`_attFpTo`; fix `initDataTable` bare name |
| `assets/js/leave.js` | `src/modules/leave.ts` | Fix `displayLeaveApplications` bare name; remove duplicate `_lvCard*` |
| `assets/js/payroll.js` | `src/modules/payroll.ts` | Fix `showNotification` bare name; remove duplicate `initDataTable` |
| `assets/js/profile.js` | `src/modules/profile.ts` | Fix `readPhone`/`setPhone`/`updateStoredSession`/`_patchPhotoCache` imports |
| `assets/js/settings-view.js` | `src/modules/settings.ts` | Fix `updateStoredSession` import |
| `assets/app.js` (utils block) | `src/lib/format.ts`, `src/lib/validation.ts`, `src/lib/skeleton.ts`, `src/lib/photo.ts`, `src/lib/phone.ts`, `src/lib/spinbtn.ts`, `src/lib/payslip.ts` | Extract each logical group |
| `assets/app.js` (session block) | `src/lib/session.ts` | `saveSession`, `loadSession`, `clearSession`, timers |
| `assets/app.js` (auth + 2FA block) | `src/modules/auth.ts` | `handleLogin`, `handleLoginSuccess`, `_tfa*`, `_wireOtpRow*` |
| `assets/app.js` (camera block) | `src/modules/camera.ts` | `openCameraModal`, `startCamera`, `capturePhoto`, `confirmAttendance` |
| `assets/app.js` (init + events block) | `src/main.ts` | `init()`, `setupEventListeners()`, `applySession()` |
| `assets/partials/app-shell.html` | `src/shell.html` | Imported via `?raw`; eliminates runtime fetch |
| `index.html` | `index.html` (modified) | Remove CDN scripts that are bundled; add `<script type="module" src="/src/main.ts">` |

---

## 7. New `lib/` Modules — API Contracts

### `src/lib/api.ts`
```ts
export function api<T = ApiResponse>(action: string, args?: Record<string, unknown>): Promise<T>
export function apiSwr<T>(action: string, args: Record<string, unknown>, opts: SwrOpts<T>): Promise<T>
export const swr: SwrStore
```

### `src/lib/state.ts`
```ts
export const AppState: {
  get<K extends keyof AppStateMap>(key: K): AppStateMap[K]
  set<K extends keyof AppStateMap>(key: K, val: AppStateMap[K]): void
  on<K extends keyof AppStateMap>(key: K, fn: (val: AppStateMap[K]) => void): () => void
  seed(obj: Partial<AppStateMap>): void
  reset(): void
}

// Typed state shape
interface AppStateMap {
  currentUser:            string | null
  currentUserId:          string | null
  currentFullName:        string | null
  currentDeptId:          string | null
  currentRole:            UserRole | null
  currentColorScheme:     string
  currentLayoutMode:      LayoutMode
  // ... all other keys typed
}
```

### `src/lib/format.ts`
```ts
export function fmtLocalTime(iso: string | null | undefined): string
export function fmtCurrency(amount: number, currency?: string): string
export function escapeHtml(s: string): string
export function cssEscape(s: string): string
```

### `src/lib/validation.ts`
```ts
export interface ValidationRule {
  id: string
  check: (val: string) => boolean
  message: string
}
export function _validate(rules: ValidationRule[]): boolean
export function _fieldError(id: string, msg: string): void
export function _fieldOk(id: string): void
```

### `src/modules/router.ts`
```ts
export function showSection(id: string): void
export function refreshSection(id: string): void
export function markLoaded(sectionId: string): void
export function isLoaded(sectionId: string): boolean
export function resetLoadedState(): void
```

---

## 8. Phases

Each phase produces a working, deployable app at the end. No phase breaks
anything in production.

---

### Phase 1 — Tooling & Scaffold
**Goal:** Get Vite running alongside the existing code.  
**Deliverable:** `npm run dev` serves the app identically to the current version.

Tasks:
1. Install: `vite`, `typescript`, `vite-plugin-pwa`, `sortablejs`, `flatpickr`,
   `@types/sortablejs`, `@types/flatpickr`, `@types/leaflet`,
   `@types/datatables.net`, `@types/jquery`
2. Create `vite.config.ts` (see Section 9)
3. Create `src/globals.d.ts` — declare all CDN globals
4. Create `src/main.ts` — thin shim that loads the old files via dynamic import
   (temporary; replaced in later phases)
5. Create `tsconfig.frontend.json` (separate from backend tsconfig)
6. Create `.env.example` with all `VITE_*` variables
7. Update `index.html` to use `<script type="module" src="/src/main.ts">`
8. Add `"build:frontend": "vite build"`, `"dev": "vite"` to `package.json`
9. Verify `npm run dev` and `npm run build:frontend` succeed

---

### Phase 2 — Foundation Libraries
**Goal:** Convert the zero-dependency utility modules to typed ESM.  
**Deliverable:** `src/lib/*.ts` all clean, type-checked.

Tasks:
1. `src/lib/state.ts` — typed `AppState` (keep same API, add `AppStateMap`)
2. `src/config/index.ts` — typed constants (`SectionDef`, `Palette`, `Layout`)
3. `src/lib/format.ts` — `fmtLocalTime`, `escapeHtml`, `cssEscape`, `fmtCurrency`
4. `src/lib/validation.ts` — `_validate`, `_fieldError`, `_fieldOk`
5. `src/lib/skeleton.ts` — all `skel*` helpers, `setSkel`
6. `src/lib/spinbtn.ts` — `_countUp`, `_spinBtn`
7. `src/lib/phone.ts` — phone mask, `setPhone`, `readPhone`
8. `src/lib/photo.ts` — `_swapAvatarImg`, `_setAttendanceAvatar`, `_patchPhotoCache`
9. `src/lib/payslip.ts` — single canonical `buildPayslipHtml`
10. `src/lib/leave-card.ts` — single canonical `lvCard`, `lvTypeBadge`, etc.
11. `src/lib/datatable.ts` — single canonical `initDataTable`, `destroyDataTable`
12. `src/popup/index.ts` — `cpop`, `showSpinner`, `hideSpinner`, `showPopup`
13. `src/lib/api.ts` — replace `$.ajax` with `fetch`; typed `api<T>()`, `apiSwr<T>()`
14. `src/cache/idb.ts` + `src/cache/sw-manager.ts`
15. `src/shell.html` — move `app-shell.html` to `src/`, import via `?raw` in `main.ts`
16. Update `src/main.ts` to use all the above; verify app still works

---

### Phase 3 — Core Shell Modules
**Goal:** Convert the shell: auth, router, nav, realtime.  
**Deliverable:** Login, 2FA, sidebar, section routing, notifications all working.

Tasks:
1. `src/lib/session.ts` — `saveSession`, `loadSession`, `clearSession`, timers, `updateStoredSession`
2. `src/modules/router.ts` — `showSection`, `refreshSection`, `markLoaded`, `isLoaded`
3. `src/modules/auth.ts` — `handleLogin`, `handleLoginSuccess`, `_completeLogin`,
   all `_tfa*` and `_wireOtpRow*` functions, `applySession`, `handleLogout`
4. `src/modules/nav.ts` — sidebar, header badges, messages, tickets, notifications;
   fix `SECTION_DEFS` bare-name access; remove 5 s polling interval
5. `src/realtime/index.ts` — fix `loadLiveAttendance` bare-name bug;
   fix `_scheduleHdrBadgeSync` bare-name bug; replace with proper imports
6. `src/main.ts` — `init()`, `setupEventListeners()`, full DOMContentLoaded bootstrap
7. `src/globals.d.ts` — complete with all CDN types

---

### Phase 4 — Feature Modules
**Goal:** Convert all feature modules. Fix all known bugs.  
**Deliverable:** Every section of the app works fully, now with type safety.

Tasks:
1. `src/modules/charts.ts` — Chart CDN global; Chart.defaults init
2. `src/modules/dashboard.ts` — bundle SortableJS; import from `charts.ts`
3. `src/modules/live-map.ts` — Leaflet CDN; export `loadLiveAttendance` properly;
   fix `showNotification` (move into module or into `popup/`)
4. `src/modules/employees.ts` — import from `lib/` (remove duplicates);
   fix `swr._inflight` private access; import `_getPendingLeaveCount` properly
5. `src/modules/sites.ts` — fix all 5 bare-name bugs via imports;
   move load-time event listeners into an exported `initSites()` function
6. `src/modules/attendance.ts` — import `flatpickr`; fix `_attFpFrom`/`_attFpTo`
   (pass as arguments or store in AppState); fix `initDataTable` import
7. `src/modules/leave.ts` — import from `lib/leave-card.ts`; fix `displayLeaveApplications`
8. `src/modules/payroll.ts` — import `flatpickr`; fix `showNotification`; import `initDataTable`
9. `src/modules/profile.ts` — import `setPhone`, `readPhone`, `_patchPhotoCache`,
   `updateStoredSession` (now from `lib/session.ts`)
10. `src/modules/settings.ts` — import `updateStoredSession` from `lib/session.ts`
11. `src/modules/camera.ts` — extract camera + attendance confirmation logic from `app.js`

---

### Phase 5 — Cleanup & Optimization
**Goal:** Remove all old files; verify production build; update Netlify config.

Tasks:
1. Delete `assets/app.js`, `assets/js/*.js`, `assets/partials/app-shell.html`
2. Remove legacy CDN `<script>` tags for bundled libraries (SortableJS, flatpickr)
3. Remove `<base target="_top">` from `index.html`
4. Move `VITE_SUPABASE_ANON_KEY` to Netlify environment variables panel
5. Update `netlify.toml`:
   ```toml
   [build]
     command   = "npm run build:frontend && npm run build:functions"
     publish   = "dist"
   ```
6. `npm run build:frontend` — verify zero TS errors, bundle < 300 KB (our code only)
7. Deploy to Netlify preview; smoke test every section
8. Run Lighthouse: target LCP < 2 s, no accessibility regressions
9. Enable vite-plugin-pwa with Workbox — offline support for the app shell

---

## 9. Vite Configuration

```ts
// vite.config.ts
import { defineConfig }    from 'vite';
import { viteSingleFile }  from 'vite-plugin-singlefile';  // optional
import { VitePWA }         from 'vite-plugin-pwa';

export default defineConfig({
  root: '.',
  publicDir: 'public',      // sw.js, icons, etc.

  build: {
    outDir:        'dist',
    emptyOutDir:   true,
    target:        'es2020',
    sourcemap:     true,
    rollupOptions: {
      input: 'index.html',
      output: {
        entryFileNames: 'assets/bundle.[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]',
        // Keep CDN libraries as externals — NOT bundled
        globals: {
          bootstrap:  'bootstrap',
          leaflet:    'L',
          'chart.js': 'Chart',
          jquery:     '$',
        },
      },
      external: ['bootstrap', 'leaflet', 'chart.js', 'jquery'],
    },
  },

  resolve: {
    alias: {
      '@lib':     '/src/lib',
      '@modules': '/src/modules',
      '@cache':   '/src/cache',
      '@config':  '/src/config',
      '@types':   '/types',   // shared with backend
    },
  },

  plugins: [
    VitePWA({
      registerType:   'autoUpdate',
      filename:       'sw.js',
      manifest: {
        name:             'Siomac',
        short_name:       'Siomac',
        theme_color:      '#1B2D55',
        background_color: '#1B2D55',
        display:          'standalone',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // Cache app shell + our bundle; never cache CDN scripts
        globPatterns:  ['**/*.{js,css,html,woff2}'],
        runtimeCaching: [{
          urlPattern: /^https:\/\/cdnjs\.cloudflare\.com\//,
          handler:    'CacheFirst',
          options:    { cacheName: 'cdn-cache', expiration: { maxAgeSeconds: 60 * 60 * 24 * 30 } },
        }],
      },
    }),
  ],

  server: {
    port: 5173,
    proxy: {
      '/api': {
        target:    'http://localhost:8888',  // Netlify Dev
        changeOrigin: true,
      },
    },
  },
});
```

---

## 10. TypeScript Configuration

```jsonc
// tsconfig.frontend.json
{
  "compilerOptions": {
    "target":            "ES2020",
    "module":            "ESNext",
    "moduleResolution":  "bundler",
    "lib":               ["ES2020", "DOM", "DOM.Iterable"],
    "strict":            true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns":  true,
    "noFallthroughCasesInSwitch": true,
    "useDefineForClassFields": true,
    "skipLibCheck":      true,
    "sourceMap":         true,
    "outDir":            "dist",
    "rootDir":           ".",
    "paths": {
      "@lib/*":     ["./src/lib/*"],
      "@modules/*": ["./src/modules/*"],
      "@cache/*":   ["./src/cache/*"],
      "@config/*":  ["./src/config/*"],
      "@types/*":   ["./types/*"]
    }
  },
  "include": ["src/**/*.ts", "src/**/*.d.ts", "types/**/*.ts"],
  "exclude": ["node_modules", "dist", "netlify"]
}
```

---

## 11. Linting & Formatting

```jsonc
// .eslintrc.frontend.json
{
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/strict-type-checked",
    "plugin:@typescript-eslint/stylistic-type-checked"
  ],
  "parser": "@typescript-eslint/parser",
  "parserOptions": { "project": "./tsconfig.frontend.json" },
  "rules": {
    "@typescript-eslint/no-explicit-any":          "error",
    "@typescript-eslint/no-non-null-assertion":    "warn",
    "@typescript-eslint/consistent-type-imports":  "error",
    "no-console":                                  ["warn", { "allow": ["warn", "error"] }]
  }
}
```

Prettier configuration (shared with backend):
```json
{ "singleQuote": true, "semi": true, "printWidth": 100, "trailingComma": "all" }
```

---

## 12. Testing Strategy

Unit tests for pure functions (no DOM required):
- `src/lib/format.ts` — `fmtLocalTime`, `fmtCurrency`, `escapeHtml`
- `src/lib/validation.ts` — all rules
- `src/lib/payslip.ts` — payslip calculation (numbers must match backend)
- `src/lib/api.ts` — SWR cache hit/miss/dedup behaviour
- `src/lib/session.ts` — token TTL, expiry detection

Tool: **Vitest** (already aligned with Vite, zero-config, same tsconfig).

```ts
// Example: src/lib/format.test.ts
import { fmtLocalTime, escapeHtml } from './format';
describe('fmtLocalTime', () => {
  it('formats ISO timestamp to local time', () => { ... });
  it('returns — for null', () => { ... });
});
```

E2E tests: **Playwright** (Phase 5, after full migration) — smoke test login,
attendance check-in, payslip view.

---

## 13. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| DOM event listener ordering broken after removing load-time IIFE side effects in `sites.js` | Medium | Wrap in `initSites()` called from `main.ts` after DOM ready |
| DataTables + jQuery coupling breaks when `$` is removed from bundle | Low | jQuery stays on CDN; DataTables declared as external; `initDataTable` still uses CDN `$` |
| `app-shell.html` `?raw` import adds HTML to bundle; CSS classes may conflict | Low | HTML is self-contained; test in Vite dev mode before Phase 3 |
| Leaflet or markercluster type definitions incomplete | Medium | Use `@types/leaflet`; for markercluster use `declare module` shim if needed |
| SWR `._inflight` private access in `employees.ts` — need to expose properly | Low | Expose `clearInflight()` as a named export from `api.ts` |
| Circular import `nav.ts ↔ modules/*` | High (known) | Resolved by `router.ts` extraction (Section 5) |
| Phase 3/4 are large; if one session stalls, app is half-migrated | Medium | Each phase works independently; old files deleted only in Phase 5 |
| `flatpickr` types mismatch with usage | Low | `@types/flatpickr` covers the API used |

---

## 14. Session Breakdown

| Session | Phase | Key output |
|---|---|---|
| 1 | Phase 1 | Vite running, `npm run dev` works, no production changes |
| 2 | Phase 2 (part 1) | `lib/state.ts`, `lib/api.ts`, `lib/format.ts`, `lib/validation.ts`, `popup/` |
| 3 | Phase 2 (part 2) | All remaining `lib/` modules, `cache/`, `shell.html` |
| 4 | Phase 3 | `auth.ts`, `session.ts`, `router.ts`, `nav.ts`, `realtime.ts`, `main.ts` |
| 5 | Phase 4 (part 1) | `charts.ts`, `dashboard.ts`, `live-map.ts`, `employees.ts` |
| 6 | Phase 4 (part 2) | `sites.ts`, `attendance.ts`, `leave.ts`, `payroll.ts`, `profile.ts`, `settings.ts`, `camera.ts` |
| 7 | Phase 5 | Delete old files, Netlify config, production build, Playwright smoke tests |

Each session ends with `tsc --noEmit` passing and the app deployable.

---

## 15. Definition of Done

- [ ] `npm run build:frontend` exits 0 with zero TypeScript errors
- [ ] `npm run lint:frontend` exits 0
- [ ] All 19 known bugs listed in Section 1 fixed
- [ ] No `window.*` assignments in new code (only CDN globals in `globals.d.ts`)
- [ ] No `any` types (enforced by ESLint rule)
- [ ] No duplicated logic (single canonical `lib/` for all shared functions)
- [ ] Unit tests pass (`npm run test`)
- [ ] Lighthouse Performance ≥ 85, Accessibility ≥ 90
- [ ] Bundle size (our code only) < 300 KB minified + gzipped
- [ ] All CDN libraries loaded via `<link rel="preload">` for performance
- [ ] Supabase anon key in Netlify environment, not source
- [ ] `<base target="_top">` removed
- [ ] `text/plain` Content-Type removed; API uses `application/json`
- [ ] SW managed entirely by vite-plugin-pwa
- [ ] Realtime notification polling interval removed
