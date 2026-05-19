# Shell Structure

> **Governing doc for:** `src/shell/` — the app shell components that replace the runtime-fetched `assets/partials/app-shell.html`.
> Every shell file must carry `@see docs/SHELL_STRUCTURE.md` in its JSDoc header.
> See `docs/ARCHITECTURE.md §ADR-007, ADR-008` for the decisions behind inlining and splitting.
> See `docs/UI_DESIGN_SYSTEM.md §5` for the visual layout specification.

---

## Why This Exists

Previously, `assets/partials/app-shell.html` (2,234 lines) was fetched at runtime after login. This caused:
- An extra network round-trip before any UI appeared
- A flash of blank content between login and shell render
- A monolithic file that was difficult to evolve without regressions

The shell split + inline replaces the fetch with a compile-time composition:
- `src/shell/` contains typed Preact components that own their slice of the HTML
- `main.tsx` mounts `<AppShell />` directly — no fetch, no FOUC
- Future Phase 2 features (full Message inbox, Ticket system) replace individual files rather than editing a 2,000-line blob

---

## Directory Layout

```
src/shell/
  AppShell.tsx                 ← Root compositor — mounts sidebar + main + overlays
  LoginShell.tsx               ← Login page + 2FA verify + 2FA setup panels
  index.ts                     ← Barrel — exports AppShell (only public export)
  sections/
    EmployeeSections.tsx       ← s-emp-attendance, s-emp-leave, s-emp-history, s-emp-payroll
    ManagerSections.tsx        ← s-mgr-overview, s-mgr-employees, s-mgr-leaves
    AdminSections.tsx          ← s-adm-dashboard, s-adm-employees, s-adm-departments,
                               ← s-adm-projects, s-adm-attendance, s-adm-leaves, s-adm-rates
    SharedSections.tsx         ← s-projectMap, s-payroll, s-profile, s-settings, s-about
  modals/
    NotificationModal.tsx      ← #hdrNotifModal — notification bell panel
    MessageModal.tsx           ← #hdrMsgModal — message inbox panel (stub → full in Phase 2d)
    TicketModal.tsx            ← #hdrTicketModal — ticket panel (stub → full in Phase 2e)
    EmployeeModals.tsx         ← #employeeDrawer + #addEmployeeModal + #editEmployeeModal
    ProjectSiteModal.tsx       ← #projectSiteModal — add/edit project site
```

---

## Component Responsibilities

### `AppShell.tsx`

The root compositor. Renders the full shell and passes no props down (everything is read from stores).

**What it renders:**
```tsx
export default function AppShell() {
  return (
    <>
      {/* FOUC guard — removed from body by bootApp() */}
      <div id="notification" className="notification" />

      {/* Mobile sidebar backdrop */}
      <div id="sidebarBackdrop" className="sidebar-backdrop" />

      {/* Login / 2FA — hidden post-auth */}
      <LoginShell />

      {/* Headless Preact controllers (mount points for legacy Preact components) */}
      <div id="preact-login-ctrl" style={{ display: 'none' }} aria-hidden="true" />
      <div id="preact-nav-ctrl"   style={{ display: 'none' }} aria-hidden="true" />

      {/* App shell — hidden until auth */}
      <div id="appShell" className="app-container hidden">
        <Sidebar />
        <main className="main-content">
          <PageHeader />
          <NotificationModal />
          <MessageModal />
          <TicketModal />
          <SectionPanels />
        </main>
      </div>

      {/* Floating modals (portal-anchored) */}
      <EmployeeModals />
      <ProjectSiteModal />
    </>
  );
}
```

**Rules:**
- `AppShell` imports nothing from `@sections/*` — section panels are in `SectionPanels`
- `AppShell` does not manage any local state — all state in stores
- `AppShell` is the only component in `src/shell/index.ts`

---

### `LoginShell.tsx`

Contains the three login panels. Uses `display:none` toggling (driven by `attSystem.ts`) to switch between panels — same as the original HTML.

**Panels:**
1. `#loginPage` — username/password form with rememberMe checkbox
2. `#twoFaPanel` — TOTP 6-digit input
3. `#twoFaSetupPanel` — first-time 2FA setup (QR code → verify → backup codes)

**Critical IDs** (must be preserved exactly — referenced by `attSystem.ts`):

| ID | Used by | Purpose |
|----|---------|---------|
| `loginPage` | `attSystem.ts` | Show/hide login container |
| `loginForm` | `attSystem.ts` | Submit event listener |
| `username` | `attSystem.ts` | Read username value |
| `password` | `attSystem.ts` | Read password value |
| `rememberMe` | `attSystem.ts` `_completeLogin()` | Read checkbox for session persistence |
| `loginBtn` | `attSystem.ts` | Disable during login fetch |
| `loginErrorBanner` | `attSystem.ts` | Show login error messages |
| `twoFaPanel` | `attSystem.ts` | Show/hide TOTP panel |
| `tfaOtpRow` | `attSystem.ts` | TOTP digit inputs container |
| `tfaSubmitBtn` | `attSystem.ts` | Verify TOTP button |
| `tfaBackupToggle` | `attSystem.ts` | Toggle backup code input |
| `tfaBackupCode` | `attSystem.ts` | Backup code text input |
| `tfaBackupSubmit` | `attSystem.ts` | Submit backup code |
| `tfaBackBtn` | `attSystem.ts` | Return to login panel |
| `tfaErrorBanner` | `attSystem.ts` | Show TOTP error messages |
| `twoFaSetupPanel` | `attSystem.ts` | Show/hide setup panel |
| `setupQrImg` | `attSystem.ts` | QR code image src |
| `setupManualCode` | `attSystem.ts` | Manual TOTP secret display |
| `setupQrNextBtn` | `attSystem.ts` | Advance to confirm step |
| `setupOtpRow` | `attSystem.ts` | Setup verification OTP inputs |
| `setupConfirmBtn` | `attSystem.ts` | Submit setup verification |
| `setupBackupList` | `attSystem.ts` | Backup codes display |
| `setupBackupCopy` | `attSystem.ts` | Copy backup codes |
| `setupDoneBtn` | `attSystem.ts` | Complete setup |
| `setupErrorBanner` | `attSystem.ts` | Setup error messages |
| `loginLogo` | `attSystem.ts` `applyCompanyLogo()` | Company logo |
| `loginTitle` | Translation system | Login title text |
| `loginSubtitle` | Translation system | Login subtitle text |

---

### `sections/EmployeeSections.tsx`

Static HTML wrappers for employee-role section panels. Content is populated by the existing `@sections/*` Preact components — these shells just provide the `<div id="s-*">` mount points.

**Section IDs:**

| ID | Label | Populated by |
|----|-------|-------------|
| `s-emp-attendance` | Attendance | `@sections/Attendance` |
| `s-emp-leave` | My Leaves | `@sections/AdminLeave` (employee view) |
| `s-emp-history` | My History | `@sections/Attendance` (history view) |
| `s-emp-payroll` | My Payslips | `@sections/Payroll` (employee view) |

---

### `sections/ManagerSections.tsx`

Section wrappers for manager-role panels.

| ID | Label | Populated by |
|----|-------|-------------|
| `s-mgr-overview` | Overview | `@sections/Dashboard` |
| `s-mgr-employees` | Employees | `@sections/Employees` (read-only) |
| `s-mgr-leaves` | Leaves | `@sections/AdminLeave` |

---

### `sections/AdminSections.tsx`

Section wrappers for admin/superadmin panels.

| ID | Label | Populated by |
|----|-------|-------------|
| `s-adm-dashboard` | Dashboard | `@sections/Dashboard` |
| `s-adm-employees` | Employees | `@sections/Employees` |
| `s-adm-departments` | Departments | `@sections/Employees` (dept tab) |
| `s-adm-projects` | Project Sites | `@sections/ProjectSites` |
| `s-adm-attendance` | Attendance | `@sections/Attendance` |
| `s-adm-leaves` | Leaves | `@sections/AdminLeave` |
| `s-adm-rates` | Hourly Rates | `@sections/HourlyRates` |

---

### `sections/SharedSections.tsx`

Sections available to all roles.

| ID | Label | Populated by |
|----|-------|-------------|
| `s-projectMap` | Live Map | `@sections/LiveMap` |
| `s-payroll` | Payroll | `@sections/Payroll` |
| `s-profile` | My Profile | `@sections/Profile` |
| `s-settings` | Settings | `@sections/Settings` |
| `s-about` | About | Inline (static content) |

---

### `modals/NotificationModal.tsx`

**ID:** `hdrNotifModal`

The notification bell panel — opens/closes via `attSystem.ts` click handlers.
Phase 1b: HTML parity with `app-shell.html`.
Phase 2c: Upgraded to pull live data from `@store/realtime`.

**Critical IDs:**

| ID | Purpose |
|----|---------|
| `hdrNotifModal` | Panel container (show/hide) |
| `notifList` | Notification items render target |
| `notifMarkAllBtn` | Mark all read |
| `notifClearAllBtn` | Clear all notifications |
| `notifRefreshBtn` | Force refresh |

---

### `modals/MessageModal.tsx`

**ID:** `hdrMsgModal`

The message inbox panel. Includes three sub-panes:
- `#msgList` — conversation list (default view)
- `#msgDetailPane` — conversation thread + reply box
- `#msgComposePane` — compose new message

Phase 1b: HTML parity with `app-shell.html`.
Phase 2d: Replaced with full `InboxPanel` + `ConversationView` + `ComposeModal` backed by Supabase.

**Critical IDs:**

| ID | Purpose |
|----|---------|
| `hdrMsgModal` | Panel container |
| `msgModalTitle` | Dynamic title (updated by attSystem) |
| `msgComposeBtn` | New message / broadcast button |
| `msgComposeBtnLabel` | Button label (role-dependent text) |
| `msgList` | Message thread list |
| `msgDetailPane` | Thread detail + reply |
| `msgDetailBody` | Thread content |
| `msgReplyInput` | Reply textarea |
| `msgReplySendBtn` | Send reply button |
| `msgDetailBackBtn` | Back to list |
| `msgComposePane` | Compose new message pane |
| `msgToWrap` | Recipient selector wrapper (admin/manager only) |
| `msgToSelect` | Recipient `<select>` |
| `msgComposeSubject` | Subject input |
| `msgComposeBody` | Message body textarea |
| `msgSendBtn` | Send composed message |
| `msgCancelComposeBtn` | Cancel compose |
| `msgMarkAllReadBtn` | Mark all read |
| `msgRefreshBtn` | Force refresh |
| `msgModalFoot` | Footer bar |

---

### `modals/TicketModal.tsx`

**ID:** `hdrTicketModal`

Support ticket panel. Three sub-panes:
- `#ticketList` — ticket list (default)
- `#ticketDetailPane` — ticket thread + reply + status controls
- Compose new ticket (inline in list pane via `ticketNewBtn`)

Phase 1b: HTML parity with `app-shell.html`.
Phase 2e: Replaced with full `TicketQueue` + `TicketDetail` backed by Supabase.

**Critical IDs:**

| ID | Purpose |
|----|---------|
| `hdrTicketModal` | Panel container |
| `ticketModalTitle` | Dynamic title |
| `ticketClearClosedBtn` | Clear closed tickets |
| `ticketNewBtn` | Open new ticket form |
| `ticketList` | Ticket list render target |
| `ticketDetailPane` | Ticket thread + reply |
| `ticketDetailBody` | Thread content |
| `ticketReplyInput` | Reply textarea |
| `ticketStatusSelect` | Status dropdown (admin/manager only) |
| `ticketDetailBackBtn` | Back to list |

---

### `modals/EmployeeModals.tsx`

Contains two related modals:

**1. Employee Drawer** (`#employeeDrawer`)
- A side drawer with full employee detail (photo, contact, attendance summary)
- Opened by clicking a row in the employee table
- Contains tabs: Overview, Attendance, Leave, Documents

**2. Add/Edit Employee Modal** (`#addEmployeeModal` / `#editEmployeeModal`)
- Multi-section form: personal info, employment, contact, emergency contact, payroll config
- Phone number field uses `setPhone()` / `readPhone()` from `@lib/attSystem`

**Critical IDs:**

| ID | Purpose |
|----|---------|
| `employeeDrawer` | Drawer container |
| `drawerOverlay` | Backdrop |
| `employeeDrawerClose` | Close button |
| `addEmployeeModal` | Add modal container |
| `editEmployeeModal` | Edit modal container |
| `addEmpForm` | Add employee form |
| `editEmpForm` | Edit employee form |

---

### `modals/ProjectSiteModal.tsx`

**ID:** `projectSiteModal`

Add/edit project site form. Contains:
- Site name, address, geofence radius
- Map picker for lat/lng (uses Leaflet / `@sections/LiveMap` utilities)

**Critical IDs:**

| ID | Purpose |
|----|---------|
| `projectSiteModal` | Modal container |
| `projectSiteForm` | Form element |
| `siteName` | Site name input |
| `siteAddress` | Address input |
| `siteLatLng` | Hidden lat/lng value |
| `siteRadius` | Geofence radius |

---

## Critical Rules

### 1. Preserve all IDs exactly

Every `id="..."` in the original `app-shell.html` is referenced by:
- `attSystem.ts` — via `document.getElementById()`
- Existing section Preact components — via mount target selectors
- CSS — via `#id` selectors

**Any ID rename will silently break runtime behaviour.** If you need to rename an ID for a Phase 2 upgrade, search the entire codebase first and update all references atomically.

### 2. Display toggling is still by CSS / JS in Phase 1b

Section panels are shown/hidden by `attSystem.ts` adding/removing the `active` class and using `display:none`/`display:block`. The `AppShell` renders all panels — only one is visible at a time. Do not add `v-if` / conditional rendering that would unmount panels — this would destroy form state and scroll position.

### 3. Shell components contain only HTML structure

Shell components (`src/shell/**`) must not contain business logic, API calls, or event handlers. They are structural containers. Business logic lives in:
- `@lib/attSystem` (legacy, Phase 1)
- Section Preact components under `@sections/*` (current)
- `@store/*` (state)
- `@lib/api/*` (Phase 2)

### 4. Modal overlays are NOT portal-rendered in Phase 1b

In Phase 1b, modals remain in the DOM as children of `#appShell` (same as the original HTML). Portal rendering is a Phase 2 improvement. Do not add `createPortal()` calls in Phase 1b — it changes stacking context and would require CSS updates.

### 5. The `@shell` alias

The `@shell` alias resolves to `src/shell/`. Only `AppShell` is publicly exported. Import as:

```ts
import AppShell from '@shell';
// or
import { AppShell } from '@shell';
```

Never import shell internals from outside `src/shell/`:
```ts
// ❌ Wrong
import LoginShell from '@shell/LoginShell';

// ✅ Correct
import AppShell from '@shell';   // AppShell composes LoginShell internally
```

---

## Migration Path from `app-shell.html`

### Step-by-step

1. **Read** `assets/partials/app-shell.html` section by section
2. **Port** each section to its corresponding shell component (exact HTML parity)
3. **Mount** `<AppShell />` from `main.tsx` at `#app-root`
4. **Remove** the runtime fetch of `app-shell.html` from `main.tsx`
5. **Verify** in browser: all sections load, all modals open, all IDs resolve
6. **Run** `tsc --noEmit` + `vitest run` — must pass clean
7. **Delete** `assets/partials/app-shell.html`

### What changes in `main.tsx`

```tsx
// Before (Phase 1)
const res  = await fetch('/assets/partials/app-shell.html');
const html = await res.text();
document.getElementById('app-root')!.innerHTML = html;

// After (Phase 1b)
import { render } from 'preact';
import AppShell   from '@shell';
render(<AppShell />, document.getElementById('app-root')!);
```

### What stays the same

- `AttendanceSystem.init()` is still called after the shell mounts
- All DOM IDs remain identical
- All CSS classes remain identical
- All `attSystem.ts` and section component logic is unchanged
- The FOUC guard (`body { visibility: hidden }`) is still cleared at end of `bootApp()`

---

## Future Evolution (Phase 2)

### Phase 2c — Notifications

`NotificationModal.tsx` gets replaced with a fully reactive component that:
- Subscribes to `@store/realtime` notification slice
- Renders notification items from TanStack Query data
- Marks read via Supabase mutation

### Phase 2d — Messages

`MessageModal.tsx` gets replaced with:
- `InboxPanel.tsx` — conversation list (TanStack Query, paginated)
- `ConversationView.tsx` — thread (TanStack Query + Realtime)
- `ComposeModal.tsx` — new DM / group / broadcast

### Phase 2e — Tickets

`TicketModal.tsx` gets replaced with:
- `TicketQueue.tsx` — ticket list with filters
- `TicketDetail.tsx` — thread + status controls

### Phase 2b — Auth

`LoginShell.tsx` gets replaced with a fully Preact-controlled login flow:
- State managed in `@store/session`
- Form submission via `@lib/auth.signIn()`
- No `attSystem.ts` involvement for auth after Phase 2b

---

*Last updated: Phase 1b — Shell Split & Documentation*
*Owner: Engineering Lead*
*Next review: Phase 2c (Notifications)*
