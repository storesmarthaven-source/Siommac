# Siomac Frontend — Preact + Zustand + Vite Architecture

> **Replaces:** `docs/FRONTEND_MIGRATION.md` (the DOM-manipulation plan)  
> **Approach:** Full rewrite to Preact + Zustand + Vite  
> **Backend:** Unchanged — `netlify/functions/` stays as TypeScript/Hono  
> **Branch strategy:** New branch off `claude/wonderful-panini-34b331` per phase

---

## 1. Technology Stack

| Concern | Choice | Why |
|---|---|---|
| UI framework | **Preact 10** | React-compatible API, 3 KB vs 45 KB, same JSX/hooks, zero migration cost if switching to React later |
| State management | **Zustand 4** | Same mental model as current `AppState` (get/set/subscribe), typed, no boilerplate, no Provider wrapping |
| Build tool | **Vite 5** | Already planned; first-class Preact plugin |
| Language | **TypeScript 5** (strict) | Consistent with backend; `types/db.ts` and `types/api.ts` reused directly |
| Routing | **Preact Router** (custom, no library) | The app is a single-page shell with role-gated section switching — no URL routing needed; a `useSection` hook handles this |
| Styling | **Existing CSS** (keep as-is) | All `assets/styles/*.css` stay; Vite imports them; no CSS framework change |
| Maps | **Leaflet** (CDN, `useRef` escape hatch) | Imperative map API; managed via `useEffect` + `ref` pattern |
| Tables | **DataTables** (CDN, wrapper component) | DataTables 1.x stays; a `<DataTable>` component manages lifecycle |
| Date picker | **flatpickr** (bundled) | 17 KB; `import flatpickr from 'flatpickr'` |
| Charts | **Chart.js** (CDN, `useRef` escape hatch) | Same as Leaflet — imperative; managed via `useEffect` + `ref` |
| Drag & drop | **SortableJS** (bundled) | 9 KB; used only in dashboard layout editor |
| HTTP | **Native `fetch`** | Replaces `$.ajax`; jQuery removed entirely |
| Service Worker | **vite-plugin-pwa** | Replaces double-registration; generates `sw.js` |
| Testing | **Vitest** + **Preact Testing Library** | Zero-config with Vite; same test runner as backend |
| E2E | **Playwright** (Phase 7) | Smoke tests for critical paths |

---

## 2. What Gets Fixed Automatically

Every one of the 19 confirmed production bugs is eliminated by switching to
explicit imports. The bare-name cross-module coupling that caused them cannot
exist in an ES module system.

Additionally, the Preact rewrite eliminates the entire category of
"DOM out of sync with data" bugs — the source of all rendering defects — because
the UI becomes a pure function of state.

---

## 3. Component Tree

```
<App>
├── <LoginPage>                    ← shown until authenticated
│   ├── <LoginForm>                ← username + password
│   ├── <TwoFaVerifyPanel>         ← 6-digit OTP entry
│   │   ├── <OtpInput>             ← reusable digit boxes
│   │   └── <BackupCodeInput>
│   └── <TwoFaSetupPanel>          ← first-time enrolment
│       ├── <QrCodeDisplay>
│       ├── <OtpInput>             ← same component, confirm step
│       └── <BackupCodeList>
│
└── <AppShell>                     ← shown after login
    ├── <Sidebar>
    │   ├── <SidebarBrand>
    │   ├── <SidebarMenu>
    │   │   └── <SidebarMenuItem>  × N
    │   ├── <SessionTimer>
    │   └── <LogoutButton>
    │
    ├── <Header>                   ← present on every section
    │   ├── <MobileMenuButton>
    │   └── <HeaderActions>        ← notification + message + ticket
    │       ├── <NotifButton>
    │       ├── <MessageButton>
    │       └── <TicketButton>
    │
    ├── <SectionHeaderPill>        ← profile pill, top of each section
    │   ├── <Avatar>
    │   ├── <NotifBadgeButton>
    │   ├── <MessageBadgeButton>
    │   └── <TicketBadgeButton>
    │
    ├── <NotifModal>               ← shared overlay, one instance
    ├── <MessageModal>             ← three-pane: list / compose / detail
    └── <TicketModal>              ← three-pane: list / compose / detail
    │
    └── <SectionRouter>            ← renders active section only
        │
        ├── <EmployeeAttendance>   (s-emp-attendance)
        │   ├── <AttendanceStatusCard>
        │   ├── <CheckInOutButtons>
        │   ├── <StatRow>
        │   ├── <ChartCard chartType="doughnut">
        │   └── <ChartCard chartType="bar">
        │
        ├── <EmployeeHistory>      (s-emp-history)
        │   ├── <StatRow>
        │   └── <DataTable>
        │
        ├── <EmployeeLeave>        (s-emp-leave)
        │   ├── <TabBar>
        │   ├── <StatRow>
        │   ├── <LeaveCard> × N
        │   └── <LeaveRequestModal>
        │
        ├── <EmployeePayslips>     (s-emp-payroll)
        │   ├── <StatRow>
        │   └── <PayslipCard> × N
        │
        ├── <Dashboard>            (s-adm-dashboard)
        │   ├── <StatRow>
        │   ├── <RecentAttendanceTable>
        │   └── <DashboardLayout>  ← SortableJS drag/drop
        │       └── <ChartCard> × 5
        │
        ├── <Employees>            (s-adm-employees)
        │   ├── <EmployeeSearch>
        │   └── <EmployeeCard> × N
        │
        ├── <Departments>          (s-adm-departments)
        │   └── <DeptCard> × N
        │
        ├── <ProjectSites>         (s-adm-projects)
        │   ├── <FilterBar>
        │   ├── <StatRow>
        │   └── <SiteCard> × N
        │       └── <MiniMap>      ← Leaflet escape hatch
        │
        ├── <LiveMap>              (s-projectMap)
        │   ├── <LeafletMap>       ← Leaflet escape hatch
        │   ├── <LiveStatRow>
        │   └── <LiveEmployeePanel>
        │
        ├── <AttendanceView>       (s-adm-attendance)
        │   ├── <AttendanceFilterBar>
        │   ├── <StatRow>
        │   ├── <DataTable>
        │   ├── <ChartCard chartType="line">
        │   └── <ChartCard chartType="doughnut">
        │
        ├── <LeaveView>            (s-adm-leaves)
        │   ├── <TabBar>
        │   ├── <StatRow>
        │   └── <LeaveCard> × N    ← same component, different props
        │
        ├── <HourlyRates>          (s-adm-rates)
        │   ├── <FilterBar>
        │   ├── <StatRow>
        │   └── <RatesTable>
        │
        ├── <Payroll>              (s-payroll)
        │   ├── <PayrollModeToggle>
        │   ├── <StatRow>
        │   ├── <DataTable>
        │   ├── <PayrollSettingsPanel>
        │   └── <PayrollConstantsPanel>
        │
        ├── <Profile>              (s-profile)
        │   ├── <TabBar>
        │   ├── <ProfileTab>
        │   │   ├── <Avatar size="lg">
        │   │   └── <ProfileForm>
        │   ├── <ActivityTab>
        │   │   └── <TimelineItem> × N
        │   └── <DocumentsTab>     (employee only)
        │
        ├── <Settings>             (s-settings)
        │   ├── <SettingsNav>
        │   ├── <CompanyPanel>
        │   ├── <LogoPanel>
        │   ├── <WorkHoursPanel>
        │   └── <AppearancePanel>
        │       ├── <PaletteGrid>
        │       └── <LayoutGrid>
        │
        └── <About>                (s-about)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Shared / reusable (used in 2+ sections):

<Avatar>              props: userId, name, url, size
<StatCard>            props: icon, label, value, sub
<StatRow>             props: stats[]  → renders <StatCard> × N
<TabBar>              props: tabs[], activeTab, onChange
<LeaveCard>           props: leave, actions (approve/reject/edit/delete/view)
<LeaveTypeBadge>      props: type
<LeaveStatusBadge>    props: status
<StatusBadge>         props: status (attendance)
<PayslipDocument>     props: payslip, company
<LeaveDocument>       props: leave, company
<DataTable>           props: id, columns, data, options  ← manages DT lifecycle
<MiniMap>             props: lat, lng, radius            ← Leaflet escape hatch
<LeafletMap>          props: onReady(map)                ← full map escape hatch
<ChartCard>           props: chartType, data, options    ← Chart.js escape hatch
<OtpInput>            props: length, onComplete
<FilterBar>           props: filters[], onChange
<PillGroup>           props: options[], value, onChange
<Skeleton>            props: variant, rows               ← skeleton loaders
<ConfirmDialog>       props: message, onConfirm          ← replaces cpop confirms
<CameraModal>         ← attendance selfie capture
<LeaveRequestModal>   ← create/edit leave request
<SitePickerModal>     ← add/edit project site
```

---

## 4. State Architecture

### 4.1 Store slices (Zustand)

Each slice is a separate `create()` call — they do not cross-reference each other.
The `useStore` hook in each component subscribes to only the slice it needs,
preventing unnecessary re-renders.

```ts
// src/store/session.ts
interface SessionStore {
  user:          AppUser | null
  token:         string | null
  refreshToken:  string | null
  expiresAt:     number | null
  isLoggedIn:    () => boolean
  login:         (result: LoginResponse) => void
  logout:        () => void
  refreshSession:(result: RefreshResponse) => void
}

// src/store/ui.ts
interface UiStore {
  activeSection:   string
  sidebarCollapsed: boolean
  activeModal:     'notif' | 'message' | 'ticket' | null
  colorScheme:     string
  layoutMode:      'sidebar' | 'topbar'
  setSection:      (id: string) => void
  openModal:       (id: UiStore['activeModal']) => void
  closeModal:      () => void
  setColorScheme:  (id: string) => void
  setLayoutMode:   (mode: string) => void
}

// src/store/realtime.ts
interface RealtimeStore {
  unreadNotifs:   number
  unreadMessages: number
  openTickets:    number
  liveAttendance: LiveAttendanceRow[]
  setUnread:      (key: keyof RealtimeStore, n: number) => void
  setLive:        (rows: LiveAttendanceRow[]) => void
}

// src/store/data.ts — shared lists, fetched once and reused
interface DataStore {
  employees:     AppUser[]
  departments:   Department[]
  projectSites:  ProjectSite[]
  companyName:   string
  companyLogo:   string
  currency:      string
  setEmployees:  (list: AppUser[]) => void
  setDepts:      (list: Department[]) => void
  setSites:      (list: ProjectSite[]) => void
}
```

### 4.2 Data fetching: TanStack Query

TanStack Query (formerly React Query — fully Preact-compatible) handles:
- Caching (replaces the hand-rolled `swr` store)
- Deduplication (replaces `inflight` map)
- Background revalidation (replaces `focusRevalidate`)
- Optimistic updates (replaces manual cache-bust after mutations)
- Loading / error states per query (replaces `_isLoaded` / skeleton guards)

```ts
// src/lib/queries.ts
export const employeeKeys = {
  all:    ()           => ['employees'] as const,
  list:   (filter: F)  => ['employees', 'list', filter] as const,
  detail: (id: string) => ['employees', 'detail', id] as const,
}

// In a component:
const { data, isLoading, isError } = useQuery({
  queryKey: employeeKeys.list({ dept, search }),
  queryFn:  () => api('listEmployees', { dept, search }),
  staleTime: 60_000,   // 60 s — matches current SWR TTL
})
```

Mutations:
```ts
const mutation = useMutation({
  mutationFn: (args) => api('updateEmployee', args),
  onSuccess:  () => queryClient.invalidateQueries({ queryKey: employeeKeys.all() }),
})
```

### 4.3 Session token management

The session store persists to `localStorage` (same key `siomac_session_v1`).
Token refresh is handled by a Zustand middleware that intercepts 401 responses
in the API layer and transparently calls `/refreshToken` before retrying.

### 4.4 What replaces `AppState`

| Current `AppState` key | New location |
|---|---|
| `currentUser`, `currentUserId`, `currentRole`, `currentFullName` | `session` store |
| `currentColorScheme`, `currentLayoutMode` | `ui` store |
| `departments`, `employees`, `projectSites` | TanStack Query cache |
| `cameraStream`, `capturedPhotoData`, `currentLocationData` | Component-local `useState` in `<CameraModal>` |
| `map`, `userMarker`, `liveMarkers`, `_liveClusterGroup` | `useRef` inside `<LeafletMap>` |
| `liveData`, `_selectedSiteId`, `_mapViewSet` | `realtime` store + component-local state |
| `unreadNotifs`, etc. | `realtime` store |
| `_photoCache` | TanStack Query (image URLs cached by query key) |
| `attendanceZones` | `data` store (fetched once on login) |

---

## 5. API Layer

```ts
// src/lib/api.ts

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

async function apiFetch<T>(action: string, args: Record<string, unknown> = {}): Promise<T> {
  const token = useSessionStore.getState().token;
  const res = await fetch(`${API_BASE}/${action}`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(args),
  });

  if (res.status === 401) {
    // Token refresh interceptor
    const refreshed = await tryRefreshToken();
    if (!refreshed) { useSessionStore.getState().logout(); throw new Error('Session expired'); }
    return apiFetch(action, args);   // retry once with new token
  }

  if (!res.ok) throw new Error(`API ${action} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export { apiFetch as api };
```

This replaces `$.ajax`, `_rawApi`, `api`, and the `handleSessionExpired` global
in a single typed function.

---

## 6. Escape Hatches for Imperative Libraries

Leaflet, Chart.js, DataTables, flatpickr, and SortableJS all require imperative
DOM access. In Preact, the pattern is:

```tsx
// src/components/shared/LeafletMap.tsx
export function LeafletMap({ onReady }: { onReady: (map: L.Map) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const map = L.map(ref.current, { /* options */ });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png').addTo(map);
    onReady(map);
    return () => { map.remove(); };
  }, []);   // empty dep array — run once, cleanup on unmount

  return <div ref={ref} style={{ width: '100%', height: '100%' }} />;
}
```

The `<LiveMap>` section component stores the `L.Map` instance in a `useRef` and
updates markers via imperative calls inside a `useEffect` that watches the
`liveAttendance` data from the store — Preact re-renders the wrapper but never
re-creates the map DOM node.

Same pattern for Chart.js (`useRef<Chart>`) and DataTables
(`useRef<DataTables.Api>`).

---

## 7. Routing

No URL-based router. Section switching is a Zustand state change:

```ts
// src/store/ui.ts
setSection: (id) => set({ activeSection: id })

// src/components/shell/SectionRouter.tsx
export function SectionRouter() {
  const section = useUiStore(s => s.activeSection);
  const role    = useSessionStore(s => s.user?.role);

  // Lazy-loaded — each section is a separate chunk
  const Section = useMemo(() => getSectionComponent(section, role), [section, role]);
  return <Suspense fallback={<SectionSkeleton />}><Section /></Suspense>;
}
```

Each section is loaded with `lazy()` — Vite code-splits them automatically.
Only the active section's JS is parsed and executed. This eliminates the
current load-all-upfront model.

---

## 8. Styling Strategy

All existing CSS stays. The class names stay the same. Preact components apply
the same classes that the old JS was setting via `className`:

```tsx
// Old JS
el.classList.add('is-invalid');

// Preact
<input className={`form-control ${hasError ? 'is-invalid' : ''}`} />
```

The CSS variables (palette theming) are applied by the `ui` store:

```ts
// src/store/ui.ts — setColorScheme action
setColorScheme: (id) => {
  const p = PALETTES.find(x => x.id === id) ?? PALETTES[0];
  const root = document.documentElement.style;
  root.setProperty('--navy-primary', p.primary);
  // ...
  set({ colorScheme: id });
}
```

This is intentionally imperative — CSS custom property updates on
`documentElement` are the correct pattern for theme switching even in React apps.

---

## 9. File Structure

```
src/
├── main.tsx                        ← entry: render <App />, init QueryClient
├── globals.d.ts                    ← CDN type declarations (L, Chart, $, bootstrap)
├── vite-env.d.ts                   ← import.meta.env types
│
├── app.tsx                         ← <App>: auth gate, LoginPage vs AppShell
│
├── store/
│   ├── session.ts                  ← Zustand: user, token, login/logout
│   ├── ui.ts                       ← Zustand: activeSection, modals, theme
│   ├── realtime.ts                 ← Zustand: unread counts, live attendance
│   └── data.ts                     ← Zustand: shared lists (employees, depts, sites)
│
├── lib/
│   ├── api.ts                      ← apiFetch(), token refresh interceptor
│   ├── queries.ts                  ← TanStack Query keys + queryFn factories
│   ├── format.ts                   ← fmtLocalTime, escapeHtml, fmtCurrency
│   ├── validation.ts               ← typed validation helpers
│   ├── payslip.ts                  ← buildPayslipHtml (single canonical copy)
│   ├── leave-doc.ts                ← buildLeaveDocHtml (single canonical copy)
│   ├── session-storage.ts          ← localStorage read/write (siomac_session_v1)
│   └── realtime-client.ts          ← Supabase Realtime subscription setup
│
├── config/
│   └── index.ts                    ← SECTION_DEFS, PALETTES, LAYOUTS, COMMON_ITEMS
│
├── components/
│   │
│   ├── auth/
│   │   ├── LoginPage.tsx
│   │   ├── LoginForm.tsx
│   │   ├── TwoFaVerifyPanel.tsx
│   │   ├── TwoFaSetupPanel.tsx
│   │   ├── OtpInput.tsx
│   │   ├── BackupCodeInput.tsx
│   │   └── BackupCodeList.tsx
│   │
│   ├── shell/
│   │   ├── AppShell.tsx
│   │   ├── Sidebar.tsx
│   │   ├── SidebarMenuItem.tsx
│   │   ├── Header.tsx
│   │   ├── SectionHeaderPill.tsx
│   │   ├── SessionTimer.tsx
│   │   └── SectionRouter.tsx
│   │
│   ├── modals/
│   │   ├── NotifModal.tsx
│   │   ├── MessageModal.tsx          ← list / compose / detail panes
│   │   ├── TicketModal.tsx           ← list / compose / detail panes
│   │   ├── CameraModal.tsx           ← attendance selfie + geo capture
│   │   ├── LeaveRequestModal.tsx
│   │   ├── SitePickerModal.tsx       ← add/edit project site + map picker
│   │   └── ConfirmDialog.tsx         ← replaces cpop confirms
│   │
│   ├── shared/                       ← used in 2+ sections
│   │   ├── Avatar.tsx
│   │   ├── StatCard.tsx
│   │   ├── StatRow.tsx
│   │   ├── TabBar.tsx
│   │   ├── LeaveCard.tsx
│   │   ├── LeaveTypeBadge.tsx
│   │   ├── LeaveStatusBadge.tsx
│   │   ├── StatusBadge.tsx
│   │   ├── PayslipDocument.tsx
│   │   ├── LeaveDocument.tsx
│   │   ├── DataTable.tsx             ← DataTables.js lifecycle wrapper
│   │   ├── MiniMap.tsx               ← small Leaflet instance (site cards)
│   │   ├── LeafletMap.tsx            ← full Leaflet instance (live map)
│   │   ├── ChartCard.tsx             ← Chart.js instance wrapper
│   │   ├── FilterBar.tsx
│   │   ├── PillGroup.tsx
│   │   ├── Skeleton.tsx
│   │   ├── AnimatedNumber.tsx        ← replaces _countUp
│   │   └── AsyncButton.tsx           ← replaces _spinBtn pattern
│   │
│   └── sections/                     ← lazy-loaded, one file per section
│       ├── EmployeeAttendance.tsx    (s-emp-attendance)
│       ├── EmployeeHistory.tsx       (s-emp-history)
│       ├── EmployeeLeave.tsx         (s-emp-leave)
│       ├── EmployeePayslips.tsx      (s-emp-payroll)
│       ├── Dashboard.tsx             (s-adm-dashboard)
│       ├── Employees.tsx             (s-adm-employees)
│       ├── Departments.tsx           (s-adm-departments)
│       ├── ProjectSites.tsx          (s-adm-projects)
│       ├── LiveMap.tsx               (s-projectMap)
│       ├── AttendanceView.tsx        (s-adm-attendance)
│       ├── LeaveView.tsx             (s-adm-leaves)
│       ├── HourlyRates.tsx           (s-adm-rates)
│       ├── Payroll.tsx               (s-payroll)
│       ├── Profile.tsx               (s-profile)
│       ├── Settings.tsx              (s-settings)
│       └── About.tsx                 (s-about)
│
└── types/                            ← symlinked from ../../types/
    ├── api.ts
    └── db.ts
```

---

## 10. Third-Party Library Strategy

| Library | How | Bundle impact |
|---|---|---|
| Preact 10 | `npm install preact` | +3 KB |
| Zustand 4 | `npm install zustand` | +2 KB |
| TanStack Query v5 (Preact adapter) | `npm install @tanstack/query-core @preact/query` | +13 KB |
| flatpickr | `npm install flatpickr` | +17 KB |
| SortableJS | `npm install sortablejs @types/sortablejs` | +9 KB |
| vite-plugin-pwa | `npm install -D vite-plugin-pwa` | build-only |
| Bootstrap 5 | **CDN** | 0 KB (cached) |
| Leaflet + markercluster | **CDN** | 0 KB (cached) |
| Chart.js | **CDN** | 0 KB (cached) |
| jQuery | **Removed** | -90 KB |
| DataTables | **CDN** (needs jQuery CDN too) | 0 KB (cached) |
| Supabase JS | **CDN** (for Realtime only) | 0 KB (cached) |
| JSZip + pdfMake | **CDN** (DataTables deps) | 0 KB (cached) |

**Our bundle target: < 150 KB minified + gzipped** (currently ~0 KB bundled — all CDN).
Preact (3) + Zustand (2) + TanStack Query (13) + flatpickr (17) + Sortable (9)
+ our code (~80 KB estimated) = ~124 KB. Well within budget.

---

## 11. Environment Variables

```bash
# .env (gitignored)
VITE_API_BASE=/api
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...

# .env.example (committed)
VITE_API_BASE=/api
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

---

## 12. Vite Configuration

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import preact           from '@preact/preset-vite';
import { VitePWA }      from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    preact(),   // JSX → Preact.h, fast-refresh, preact/compat alias
    VitePWA({
      registerType: 'autoUpdate',
      filename: 'sw.js',
      manifest: {
        name: 'Siomac', short_name: 'Siomac',
        theme_color: '#1B2D55', background_color: '#1B2D55',
        display: 'standalone',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2}'],
        runtimeCaching: [{
          urlPattern: /^https:\/\/(cdnjs|cdn\.datatables|unpkg|fonts\.googleapis)\.com\//,
          handler: 'CacheFirst',
          options: { cacheName: 'cdn-cache', expiration: { maxAgeSeconds: 2_592_000 } },
        }],
      },
    }),
  ],

  build: {
    outDir:   'dist',
    target:   'es2020',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Code-split each section into its own chunk
        manualChunks: (id) => {
          if (id.includes('/sections/'))    return 'sections';
          if (id.includes('tanstack'))      return 'query';
          if (id.includes('flatpickr'))     return 'flatpickr';
          if (id.includes('sortablejs'))    return 'sortable';
        },
      },
    },
  },

  resolve: {
    alias: {
      // Preact compat for any library that imports 'react'
      'react':     'preact/compat',
      'react-dom': 'preact/compat',
      // Path aliases
      '@':         '/src',
      '@store':    '/src/store',
      '@lib':      '/src/lib',
      '@shared':   '/src/components/shared',
      '@sections': '/src/components/sections',
      '@types':    '/types',
    },
  },

  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8888', changeOrigin: true } },
  },
});
```

---

## 13. TypeScript Configuration

```jsonc
// tsconfig.frontend.json
{
  "compilerOptions": {
    "target":                       "ES2020",
    "module":                       "ESNext",
    "moduleResolution":             "bundler",
    "lib":                          ["ES2020", "DOM", "DOM.Iterable"],
    "jsx":                          "react-jsx",
    "jsxImportSource":              "preact",
    "strict":                       true,
    "noUncheckedIndexedAccess":     true,
    "exactOptionalPropertyTypes":   true,
    "noImplicitReturns":            true,
    "noFallthroughCasesInSwitch":   true,
    "skipLibCheck":                 true,
    "sourceMap":                    true,
    "paths": {
      "@/*":        ["./src/*"],
      "@store/*":   ["./src/store/*"],
      "@lib/*":     ["./src/lib/*"],
      "@shared/*":  ["./src/components/shared/*"],
      "@sections/*":["./src/components/sections/*"],
      "@types/*":   ["./types/*"]
    }
  },
  "include": ["src/**/*.{ts,tsx}", "src/globals.d.ts", "types/**/*.ts"],
  "exclude": ["node_modules", "dist", "netlify"]
}
```

---

## 14. Linting & Formatting

```jsonc
// .eslintrc.frontend.json
{
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/strict-type-checked",
    "plugin:@typescript-eslint/stylistic-type-checked",
    "plugin:react-hooks/recommended"   // rules apply to Preact hooks too
  ],
  "plugins": ["react-hooks"],
  "parser": "@typescript-eslint/parser",
  "parserOptions": { "project": "./tsconfig.frontend.json" },
  "settings": { "react": { "version": "18" } },   // satisfies react-hooks plugin
  "rules": {
    "@typescript-eslint/no-explicit-any":         "error",
    "@typescript-eslint/no-non-null-assertion":   "warn",
    "@typescript-eslint/consistent-type-imports": "error",
    "no-console":                                 ["warn", { "allow": ["warn", "error"] }],
    "react-hooks/rules-of-hooks":                 "error",
    "react-hooks/exhaustive-deps":                "error"
  }
}
```

---

## 15. Testing

```ts
// vitest.frontend.config.ts
import { defineConfig } from 'vitest/config';
import preact           from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  test: {
    environment: 'jsdom',
    globals:     true,
    setupFiles:  ['./src/test-setup.ts'],
  },
});
```

**Unit tests** (pure functions — no DOM):
- `src/lib/format.ts` — all formatters
- `src/lib/validation.ts` — all rules
- `src/lib/payslip.ts` — payslip calculations (must match backend Payslip type)
- `src/lib/api.ts` — token refresh interceptor, 401 retry logic

**Component tests** (Preact Testing Library):
- `<OtpInput>` — auto-advance, paste, backspace, 6-digit complete callback
- `<LeaveCard>` — correct buttons shown per role + ownership
- `<Avatar>` — fallback to initials when no URL, swap on URL load
- `<DataTable>` — init on mount, destroy on unmount, reinit on data change
- `<SessionTimer>` — warning state at 5 min, expired callback

**E2E** (Playwright, Phase 7):
- Login → 2FA → dashboard
- Employee check-in flow (camera modal, geo capture)
- Admin approve leave → badge count updates
- Payroll run → payslip view

---

## 16. Phases

Each phase ends with the app fully functional and deployable.
Old files are deleted only in Phase 7.

---

### Phase 1 — Tooling & Scaffold *(1 session)*

Install all packages. Create Vite + Preact config. Create `src/main.tsx` as a
temporary shim that fetches `app-shell.html` and runs the old `loadScripts`
chain — the app looks and works identically, but now served through Vite.

Deliverables:
- `npm run dev` works on port 5173
- `npm run build` produces a `dist/` folder
- `tsc --noEmit -p tsconfig.frontend.json` passes
- `npm run lint:frontend` passes

---

### Phase 2 — Store + API Layer *(1 session)*

Build the foundation that all components will use. No UI changes.

Deliverables:
- `src/store/{session,ui,realtime,data}.ts` — all Zustand stores typed
- `src/lib/api.ts` — `fetch`-based, typed, token refresh interceptor, replaces `$.ajax`
- `src/lib/queries.ts` — all TanStack Query key factories
- `src/lib/format.ts`, `validation.ts`, `payslip.ts`, `leave-doc.ts`, `session-storage.ts`
- `src/config/index.ts` — typed `SECTION_DEFS`, `PALETTES`, `LAYOUTS`
- Unit tests for all `lib/` modules passing

---

### Phase 3 — Auth + Shell *(1 session)*

The login page and app shell in Preact. The old login form is replaced; the
old `app-shell.html` sidebar/header is replaced. Feature sections still render
placeholder content.

Deliverables:
- `<LoginPage>` with `<LoginForm>`, `<TwoFaVerifyPanel>`, `<TwoFaSetupPanel>`
- `<OtpInput>` — auto-advance, paste, backspace
- `<AppShell>` — sidebar, session timer, logout button
- `<SectionHeaderPill>` — avatar, notification/message/ticket badge buttons
- `<NotifModal>`, `<MessageModal>`, `<TicketModal>` — all three panes
- `src/lib/realtime-client.ts` — Supabase subscription, drives `realtime` store
- Session timer — warning at 5 min, auto-logout
- Notification polling **removed** (Realtime-only)
- `<SectionRouter>` — switches between section placeholders by `ui.activeSection`

---

### Phase 4 — Shared Components *(1 session)*

All reusable components built and tested before feature sections start.

Deliverables:
- `<Avatar>` — URL + initials fallback, 3 size variants
- `<StatCard>` + `<StatRow>` — `<AnimatedNumber>` inside
- `<TabBar>` — active state, badge support
- `<LeaveCard>` — role-gated buttons, single source replacing both duplicates
- `<LeaveTypeBadge>`, `<LeaveStatusBadge>`, `<StatusBadge>`
- `<PayslipDocument>` — single canonical component
- `<LeaveDocument>` — single canonical component
- `<DataTable>` — lifecycle wrapper (init/destroy/reinit)
- `<MiniMap>` + `<LeafletMap>` — Leaflet escape hatch
- `<ChartCard>` — Chart.js escape hatch
- `<FilterBar>`, `<PillGroup>`
- `<Skeleton>` — all variant types
- `<AsyncButton>` — replaces `_spinBtn`
- `<ConfirmDialog>` — replaces all `cpop.fire({ showConfirmButton })` calls
- `<CameraModal>` — camera, selfie capture, geo
- `<LeaveRequestModal>`, `<SitePickerModal>`
- Component tests for all of the above

---

### Phase 5 — Feature Sections (part 1) *(1 session)*

Employee-facing sections and admin sections with simpler data flows.

Deliverables:
- `<EmployeeAttendance>` — check-in/out, status card, charts
- `<EmployeeHistory>` — `<DataTable>` + stat row
- `<EmployeeLeave>` — tab filter, leave cards, `<LeaveRequestModal>`
- `<EmployeePayslips>` — payslip card grid
- `<Dashboard>` — 6 stats, recent attendance table, 5 `<ChartCard>` + SortableJS layout
- `<Employees>` — employee card grid, add/edit/delete
- `<Departments>` — dept cards
- `<About>` — static

---

### Phase 6 — Feature Sections (part 2) *(1 session)*

The heavier sections with complex data flows and imperative library usage.

Deliverables:
- `<ProjectSites>` — `<SiteCard>` with `<MiniMap>`, `<SitePickerModal>` with full Leaflet picker
- `<LiveMap>` — `<LeafletMap>`, live attendance from `realtime` store, stat row, employee panel
- `<AttendanceView>` — filters, `<DataTable>`, 2 `<ChartCard>` (trend + doughnut)
- `<LeaveView>` — tab filter, `<LeaveCard>` with admin actions
- `<HourlyRates>` — inline-edit table, CSV import modal, dirty tracking
- `<Payroll>` — `<DataTable>`, pay settings panel, constants panel (password-gated)
- `<Profile>` — 3-tab layout, photo upload, password change
- `<Settings>` — scrollspy nav, company fields, logo upload, appearance panels

---

### Phase 7 — Cleanup, Build & Deploy *(1 session)*

Deliverables:
- Delete: `assets/app.js`, `assets/js/*.js`, `assets/partials/app-shell.html`
- Remove: `<base target="_top">` from `index.html`
- Remove: jQuery CDN `<script>` tag
- Move: `VITE_SUPABASE_ANON_KEY` to Netlify environment variables panel
- Update: `netlify.toml` — `command = "npm run build"`, `publish = "dist"`
- `npm run build` — zero TS errors, zero lint errors
- Playwright smoke tests: login, 2FA, check-in, leave approval
- Lighthouse: Performance ≥ 85, Accessibility ≥ 90
- Deploy to Netlify preview → merge to main

---

## 17. Session Summary

| Session | Phase | Key output |
|---|---|---|
| 1 | Phase 1 | Vite + Preact running, old code still works |
| 2 | Phase 2 | Stores, API layer, lib utilities — no UI changes |
| 3 | Phase 3 | Login page + app shell in Preact, 2FA works |
| 4 | Phase 4 | All 22 shared components built and tested |
| 5 | Phase 5 | 8 simpler sections working |
| 6 | Phase 6 | 8 complex sections working — app fully functional |
| 7 | Phase 7 | Old files deleted, production build, deploy |

---

## 18. Definition of Done

- [ ] `npm run build` exits 0, zero TypeScript errors
- [ ] `npm run lint:frontend` exits 0, zero `any` types
- [ ] `npm run test` — all unit + component tests pass
- [ ] All 19 known bugs from audit fixed (automatic via explicit imports)
- [ ] No `window.*` assignments in application code
- [ ] No duplicated business logic (single canonical `lib/` + shared components)
- [ ] jQuery removed from the project entirely
- [ ] `text/plain` Content-Type removed; API uses `application/json`
- [ ] Supabase anon key in environment variables, not source
- [ ] `<base target="_top">` removed
- [ ] Notification polling replaced by Supabase Realtime
- [ ] Service Worker managed by vite-plugin-pwa
- [ ] Bundle size (our code) < 150 KB minified + gzipped
- [ ] Lighthouse Performance ≥ 85
- [ ] Lighthouse Accessibility ≥ 90
- [ ] Playwright smoke tests passing
- [ ] Deployed to production on Netlify
