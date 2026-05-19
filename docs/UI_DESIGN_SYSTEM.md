# UI Design System

> **Governing doc for:** all visual components, CSS, theming, layout, and UX patterns in Siomac.
> Every component file must carry `@see docs/UI_DESIGN_SYSTEM.md` in its JSDoc header.
> See `docs/CODING_STANDARDS.md` for coding rules and `docs/ARCHITECTURE.md` for system context.

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Color System](#2-color-system)
3. [Typography](#3-typography)
4. [Spacing & Layout](#4-spacing--layout)
5. [Shell Layout](#5-shell-layout)
6. [Component Library](#6-component-library)
7. [Icon System](#7-icon-system)
8. [Theming & Palettes](#8-theming--palettes)
9. [Motion & Animation](#9-motion--animation)
10. [Responsive Design](#10-responsive-design)
11. [Form Patterns](#11-form-patterns)
12. [Data Display Patterns](#12-data-display-patterns)
13. [Feedback Patterns](#13-feedback-patterns)
14. [Accessibility Requirements](#14-accessibility-requirements)
15. [CSS Architecture](#15-css-architecture)

---

## 1. Design Philosophy

Siomac targets enterprise HR / workforce management. The visual language must communicate:

| Principle | What it means in practice |
|-----------|--------------------------|
| **Trustworthy** | Dense, functional layouts — no decorative elements that don't carry meaning |
| **Efficient** | Data-first — employees complete tasks in ≤3 clicks |
| **Adaptive** | Works on a manager's desktop (1920px) and a site-worker's phone (375px) |
| **Branded** | 8 colour palettes, light/dark mode — company identity stays intact |
| **Accessible** | WCAG AA as minimum; keyboard-navigable for power users |

**Anti-patterns to avoid:**
- Animations that delay access to information
- Empty states with large illustrations (a brief message is enough)
- Multiple confirmation dialogs in a single workflow
- Colour as the only signal for status (always pair with text or icon)

---

## 2. Color System

### 2.1 CSS custom properties (design tokens)

All colours flow through CSS custom properties defined on `:root` (or `[data-theme="dark"]`).
**Never hardcode** hex values in component CSS — always reference tokens.

```css
:root {
  /* ── Brand / palette (overridden per-palette by JS) ─────────────── */
  --c-primary:   #001f3f;   /* sidebar background, buttons */
  --c-dark:      #001529;   /* sidebar header, deeper bg  */
  --c-light:     #003366;   /* hover states               */
  --c-accent:    #0074D9;   /* links, active states, badges */
  --c-hover:     #002a52;   /* sidebar item hover         */

  /* ── Semantic surface colours (light mode defaults) ─────────────── */
  --c-bg:        #f4f6fb;   /* page background            */
  --c-surface:   #ffffff;   /* card / panel background    */
  --c-border:    #e5e7eb;   /* table borders, dividers    */
  --c-shadow:    rgba(0, 0, 0, 0.08);

  /* ── Text ────────────────────────────────────────────────────────── */
  --c-text:      #1f2937;   /* primary body text          */
  --c-text-sub:  #6b7280;   /* secondary / muted text     */
  --c-text-inv:  #ffffff;   /* text on dark backgrounds   */

  /* ── Semantic status ─────────────────────────────────────────────── */
  --c-success:   #16a34a;
  --c-warning:   #d97706;
  --c-error:     #dc2626;
  --c-info:      #2563eb;

  /* ── Status backgrounds (tinted) ────────────────────────────────── */
  --c-success-bg: #dcfce7;
  --c-warning-bg: #fef3c7;
  --c-error-bg:   #fee2e2;
  --c-info-bg:    #dbeafe;

  /* ── Sidebar ─────────────────────────────────────────────────────── */
  --sidebar-width:         260px;
  --sidebar-width-collapsed: 0px;
  --topbar-height:         60px;
}

[data-theme="dark"] {
  --c-bg:       #111827;
  --c-surface:  #1f2937;
  --c-border:   #374151;
  --c-shadow:   rgba(0, 0, 0, 0.4);
  --c-text:     #f9fafb;
  --c-text-sub: #9ca3af;
}
```

### 2.2 Palette switching

The active palette is applied by `applyPalette()` in `attSystem.ts`, which sets:
```js
document.documentElement.style.setProperty('--c-primary', palette.primary);
// …etc for each token
```

`src/config/index.ts` contains the `PALETTES` array (authoritative list).
Components never reference palette IDs directly — they reference tokens.

### 2.3 Status colours usage

| Colour | Use for |
|--------|---------|
| `--c-success` | Present, Approved, Active, Online |
| `--c-warning` | Late, Pending, Needs Attention |
| `--c-error` | Absent, Rejected, Error, Overdue |
| `--c-info` | Half-day, Info, In Progress |
| `--c-text-sub` | Inactive, Archived, Unknown |

Always pair colour with a label — never colour alone.

---

## 3. Typography

### 3.1 Font stack

```css
font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
```

Inter is loaded from Google Fonts (weight 300–700). System fallbacks ensure render without FOUC.

### 3.2 Type scale

| Token | Size | Weight | Line-height | Usage |
|-------|------|--------|------------|-------|
| `--fs-xs`  | 11px | 400 | 1.4 | Labels, badges, helper text |
| `--fs-sm`  | 13px | 400 | 1.5 | Table cells, form inputs |
| `--fs-base`| 14px | 400 | 1.6 | Body copy, default UI text |
| `--fs-md`  | 16px | 500 | 1.4 | Section headings, card titles |
| `--fs-lg`  | 18px | 600 | 1.3 | Page titles, modal headings |
| `--fs-xl`  | 22px | 700 | 1.2 | Dashboard KPI numbers |
| `--fs-2xl` | 28px | 700 | 1.2 | Large stat displays |

### 3.3 Hierarchy rules

- One `h1` (or visually equivalent) per section panel — the section title.
- Table column headers use `<th>` with `--fs-xs`, uppercase, `--c-text-sub`.
- Numbers and codes use `font-variant-numeric: tabular-nums` to prevent column shifting.

---

## 4. Spacing & Layout

### 4.1 Spacing scale (4px base grid)

```css
--sp-1:  4px
--sp-2:  8px
--sp-3:  12px
--sp-4:  16px
--sp-5:  20px
--sp-6:  24px
--sp-8:  32px
--sp-10: 40px
--sp-12: 48px
--sp-16: 64px
```

All padding, margin, and gap values must be multiples of 4px.

### 4.2 Border radius

```css
--radius-sm:  4px   /* inputs, small badges */
--radius-md:  8px   /* cards, modals, buttons */
--radius-lg:  12px  /* drawers, large panels  */
--radius-full: 9999px /* pills, avatars        */
```

### 4.3 Elevation / shadow

```css
--shadow-sm:  0 1px  2px  var(--c-shadow);          /* card resting  */
--shadow-md:  0 4px  8px  var(--c-shadow);          /* card hover    */
--shadow-lg:  0 8px  24px var(--c-shadow);          /* modal / drawer*/
--shadow-xl:  0 16px 40px rgba(0,0,0,0.16);         /* overlay       */
```

---

## 5. Shell Layout

### 5.1 Two layout modes

Siomac supports two layout modes, selected by the user in Settings:

#### Sidebar mode (default)
```
┌──────────────────────────────────────────────────────────┐
│  SIDEBAR (260px, fixed)  │  MAIN AREA (flex-1)           │
│  ┌──────────────────┐   │  ┌────────────────────────┐  │
│  │  Company logo     │   │  │  Topbar (60px)         │  │
│  │  User avatar      │   │  ├────────────────────────┤  │
│  │  Nav items        │   │  │  Section panel         │  │
│  │  …                │   │  │  (scrollable)          │  │
│  │  Logout           │   │  └────────────────────────┘  │
│  └──────────────────┘   │                               │
└──────────────────────────────────────────────────────────┘
```

#### Tab mode
```
┌──────────────────────────────────────────────────────────┐
│  TOPBAR (60px, fixed)                                     │
│  [Logo] [Tab1] [Tab2] [Tab3] … [Avatar] [Logout]         │
├──────────────────────────────────────────────────────────┤
│  Section panel (full-width, scrollable)                   │
└──────────────────────────────────────────────────────────┘
```

### 5.2 Shell component tree

```
AppShell
├── Sidebar (mode === 'sidebar')
│   ├── SidebarHeader (logo + company name)
│   ├── SidebarNav (section links)
│   └── SidebarFooter (user avatar + logout)
├── MainArea
│   ├── Topbar
│   │   ├── BurgerButton (mobile, sidebar mode)
│   │   ├── TabsNav (mode === 'tabs')
│   │   ├── NotificationBell
│   │   ├── MessageBell
│   │   └── SessionTimer
│   └── ContentPanel
│       ├── LoginShell (pre-auth)
│       └── SectionPanels (post-auth, one active at a time)
└── Overlays (portal-rendered)
    ├── NotificationModal
    ├── MessageModal
    ├── TicketModal
    ├── EmployeeDrawer
    ├── AddEmployeeModal
    └── ProjectSiteModal
```

### 5.3 Section panels

Section panels occupy the full `ContentPanel` area. Only one is visible at a time (CSS `display: none` / `display: block` — no unmounting, to preserve scroll position and form state).

```css
.section-panel {
  display: none;
  padding: var(--sp-6);
  max-width: 1400px;   /* never stretch too wide on ultrawide */
  margin: 0 auto;
}
.section-panel.active {
  display: block;
}
```

### 5.4 Mobile behaviour

Below `768px`:
- Sidebar slides in as an overlay (drawer pattern) triggered by the burger button.
- Tables switch to a card-per-row layout (CSS media query on `.responsive-table`).
- Modals go full-screen.

---

## 6. Component Library

All shared components live in `src/components/shared/` and are imported via `@shared/ComponentName`.

### 6.1 `<Modal>` (`@shared/Modal`)

```tsx
<Modal
  id="add-employee-modal"
  title="Add Employee"
  size="lg"           // sm | md | lg | xl | full
  onClose={handleClose}
  footer={<>
    <Button variant="ghost" onClick={handleClose}>Cancel</Button>
    <Button variant="primary" onClick={handleSubmit} loading={isSubmitting}>Save</Button>
  </>}
>
  {/* modal body */}
</Modal>
```

**Rules:**
- Modals are portal-rendered — never place inside a section panel.
- `id` matches the legacy HTML ID (e.g. `add-employee-modal`) for backwards compatibility with `attSystem.ts` `.style.display` toggling during Phase 1.
- Focus is trapped inside the modal when open.
- Escape key closes the modal.
- Background click closes when `dismissible={true}` (default).

### 6.2 `<Toast>` / `toast.*` (`@shared/Toast`)

```tsx
import { toast } from '@store';

toast.success('Employee saved');
toast.error('Failed to load', { duration: 8000 });
toast.warning('Pending items need attention');
toast.info('Payroll export started');
toast.loading('Uploading…', { id: 'upload' });
toast.dismiss('upload');
```

**Do not** use `alert()`, `showPopup()` (legacy), or custom inline banners for transient feedback. Route everything through `toast.*`.

### 6.3 `<Spinner>` (`@shared/Spinner`)

```tsx
<Spinner />                // default size (24px)
<Spinner size="sm" />     // 16px — for inline use inside buttons
<Spinner size="lg" />     // 48px — for full-panel loading state
<Spinner overlay />       // full-panel dimmed overlay
```

### 6.4 `<Badge>` (`@shared/Badge`)

```tsx
<Badge variant="success">Present</Badge>
<Badge variant="warning">Late</Badge>
<Badge variant="error">Absent</Badge>
<Badge variant="info">Half Day</Badge>
<Badge variant="default">Unknown</Badge>
```

Always use `<Badge>` for status display. Never write `<span class="badge …">` by hand.

### 6.5 `<Avatar>` (`@shared/Avatar`)

```tsx
<Avatar
  name="Juan dela Cruz"
  src={employee.photoUrl}   // optional — falls back to initials
  size="md"                 // xs | sm | md | lg | xl
/>
```

### 6.6 `<ConfirmDialog>` (`@shared/ConfirmDialog`)

```tsx
const { confirm } = useConfirmDialog();
const ok = await confirm({
  title:   'Delete Employee',
  message: `Remove ${employee.name} from the system? This cannot be undone.`,
  variant: 'danger',
  confirmLabel: 'Delete',
});
if (ok) await deleteEmployee(employee.id);
```

Never use `window.confirm()`. Route all destructive confirmations through `<ConfirmDialog>`.

### 6.7 `<DataTable>` (`@shared/DataTable`)

```tsx
<DataTable
  columns={EMPLOYEE_COLUMNS}
  data={employees}
  loading={isLoading}
  emptyMessage="No employees found"
  onRowClick={row => goTo('employee-detail', { id: row.id })}
  sortable
  filterable
/>
```

**Column definition:**
```ts
interface Column<T> {
  key:      keyof T | string;
  header:   string;
  width?:   string;             // CSS width (e.g. '120px', '10%')
  render?:  (value: T[keyof T], row: T) => VNode;
  sortable?: boolean;
  align?:   'left' | 'center' | 'right';
}
```

### 6.8 `<ErrorBoundary>` (`@shared/ErrorBoundary`)

```tsx
<ErrorBoundary
  fallback={<p className="error-state">Failed to load this section.</p>}
  onError={err => logger.error('section crash', err)}
>
  <EmployeesSection />
</ErrorBoundary>
```

---

## 7. Icon System

Icons are sourced from **Font Awesome 5 Free** (CSS loaded globally).

```tsx
// In TSX — use classname
<i className="fas fa-users" aria-hidden="true" />

// Always set aria-hidden on decorative icons
// Add aria-label when the icon IS the label (icon-only buttons)
<button aria-label="Close">
  <i className="fas fa-times" aria-hidden="true" />
</button>
```

**Standard icons for Siomac:**

| Concept | Icon class |
|---------|-----------|
| Dashboard | `fa-tachometer-alt` |
| Employees | `fa-users` |
| Attendance | `fa-calendar-check` |
| Leave | `fa-umbrella-beach` |
| Payroll | `fa-file-invoice-dollar` |
| Project Sites | `fa-map-marker-alt` |
| Live Map | `fa-map-marked-alt` |
| Notifications | `fa-bell` |
| Messages | `fa-envelope` |
| Tickets | `fa-ticket-alt` |
| Settings | `fa-palette` |
| Profile | `fa-user-circle` |
| Departments | `fa-building` |
| Hourly Rates | `fa-money-bill-wave` |
| Add | `fa-plus` |
| Edit | `fa-edit` |
| Delete | `fa-trash-alt` |
| Search | `fa-search` |
| Filter | `fa-filter` |
| Export | `fa-download` |
| Refresh | `fa-sync-alt` |
| Close | `fa-times` |
| Check | `fa-check` |
| Warning | `fa-exclamation-triangle` |
| Error | `fa-times-circle` |
| Info | `fa-info-circle` |
| Clock-in | `fa-sign-in-alt` |
| Clock-out | `fa-sign-out-alt` |
| Phone | `fa-phone` |
| Location | `fa-map-pin` |

---

## 8. Theming & Palettes

### 8.1 Palette list (from `src/config/index.ts`)

| ID | Name | Primary |
|----|------|---------|
| `navy` | Navy Blue | `#001f3f` |
| `royal` | Royal Purple | `#3a0ca3` |
| `forest` | Forest Green | `#1a4d2e` |
| `sunset` | Sunset Orange | `#bf3a00` |
| `crimson` | Crimson Red | `#7d0000` |
| `slate` | Slate Dark | `#1f2937` |
| `ocean` | Ocean Teal | `#003049` |
| `rose` | Rose Pink | `#7d2c5c` |

### 8.2 Dark mode

Dark mode is activated by `document.documentElement.setAttribute('data-theme', 'dark')`.
Components use semantic tokens (`--c-bg`, `--c-surface`, `--c-text`) — they automatically respect dark mode without any component-level code.

**Never** write `body.dark .my-component { … }` — always use CSS custom property references.

### 8.3 User preference persistence

Theme and palette are saved to `localStorage` under:
```
siomac_theme    → 'light' | 'dark'
siomac_palette  → palette ID string
siomac_layout   → 'sidebar' | 'tabs'
```

These are applied by `attSystem.ts` `loadSession()` before the first render to avoid FOUC.

---

## 9. Motion & Animation

### 9.1 Guiding principles

- Animations communicate state change, not decorate.
- Duration: 100–200ms for micro-interactions; 200–300ms for panels/modals.
- Always respect `prefers-reduced-motion`.

### 9.2 Standard transitions

```css
/* Page panel switch */
.section-panel { transition: opacity 150ms ease; }

/* Modal */
.modal         { transition: transform 200ms ease, opacity 200ms ease; }
.modal-enter   { transform: translateY(-12px); opacity: 0; }

/* Sidebar drawer (mobile) */
.sidebar       { transition: transform 250ms ease; }

/* Skeleton shimmer */
@keyframes shimmer {
  from { background-position: -200% 0; }
  to   { background-position:  200% 0; }
}

/* Respect motion preferences */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration:   0.01ms !important;
    transition-duration:  0.01ms !important;
  }
}
```

### 9.3 Loading states

Always use skeleton loaders (not spinners) for content that occupies a known layout space:

```tsx
{isLoading
  ? <TableSkeleton rows={10} cols={6} />
  : <DataTable data={employees} columns={COLS} />
}
```

Use `<Spinner>` only for:
- Button loading state (small, inline)
- Full-page initial load before any layout is known
- Overlay when a blocking action is in progress

---

## 10. Responsive Design

### 10.1 Breakpoints

```css
/* Mobile first */
--bp-sm:   480px   /* large phones */
--bp-md:   768px   /* tablets (sidebar collapses) */
--bp-lg:  1024px   /* laptops */
--bp-xl:  1280px   /* desktops */
--bp-2xl: 1536px   /* ultrawide */
```

### 10.2 Table responsiveness

Tables switch to card layout below `--bp-md`:

```css
@media (max-width: 768px) {
  .responsive-table thead { display: none; }
  .responsive-table td    { display: flex; }
  .responsive-table td::before {
    content: attr(data-label);
    font-weight: 600;
    min-width: 120px;
  }
}
```

Each `<td>` must carry `data-label="Column Name"` for this to work.

### 10.3 Touch targets

Minimum interactive element size: **44px × 44px** (Apple HIG / WCAG 2.5.5).
Buttons in data tables are exempt at 32px if there is adequate spacing.

---

## 11. Form Patterns

### 11.1 Input anatomy

```tsx
<div className="form-field">
  <label htmlFor="emp-name" className="form-label">
    Full Name <span className="required" aria-hidden="true">*</span>
  </label>
  <input
    id="emp-name"
    type="text"
    className={`form-input ${errors.name ? 'is-invalid' : ''}`}
    value={values.name}
    onInput={handleInput}
    aria-required="true"
    aria-describedby={errors.name ? 'emp-name-error' : undefined}
  />
  {errors.name && (
    <span id="emp-name-error" className="form-error" role="alert">
      {errors.name}
    </span>
  )}
</div>
```

### 11.2 Form layout

```
Single column  → always (mobile default, also used for modals)
Two columns    → for dense forms on desktop (md+ breakpoint), using CSS grid
Three columns  → maximum (date + shift + hours in attendance forms)
```

### 11.3 Validation

- Validate on submit + re-validate on blur for touched fields.
- Show errors inline below the field (not in a banner at the top).
- Required fields: mark with `*` in the label (not in the placeholder).
- Placeholder text is hint text, not a label substitute.

### 11.4 Phone number input

Phone fields use the `setPhone()` / `readPhone()` functions from `@lib/attSystem` for masking. Never raw `<input type="tel">` without the mask.

---

## 12. Data Display Patterns

### 12.1 Empty states

```tsx
{employees.length === 0 && (
  <div className="empty-state">
    <i className="fas fa-users empty-state__icon" aria-hidden="true" />
    <p className="empty-state__title">No employees found</p>
    <p className="empty-state__sub">Adjust filters or add a new employee.</p>
    <Button variant="primary" onClick={handleAdd}>Add Employee</Button>
  </div>
)}
```

Keep empty states short. No large illustrations — this is an enterprise tool.

### 12.2 KPI / stat cards

```tsx
<StatCard
  label="Present Today"
  value={attendanceStats.present}
  total={attendanceStats.total}
  icon="fa-calendar-check"
  variant="success"
/>
```

Stat numbers use `--fs-xl` or `--fs-2xl`, `tabular-nums`.

### 12.3 Status badges in tables

All status values in table cells use `<Badge>` — never raw `<span>` with ad hoc classes.

### 12.4 Dates and times

- Display dates in `DD MMM YYYY` format (e.g. `15 Jan 2025`).
- Display times in `HH:MM` 24-hour format unless the locale is explicitly 12-hour.
- Use `fmtLocalTime()` from `@lib/attSystem` for time formatting with timezone awareness.
- Never display UTC timestamps directly to users.

### 12.5 Pagination

Tables with > 50 rows must paginate. Use server-side pagination for tables with > 500 rows.

```tsx
<Pagination
  page={page}
  pageSize={20}
  total={totalCount}
  onChange={setPage}
/>
```

---

## 13. Feedback Patterns

### 13.1 Decision matrix

| Situation | Pattern |
|-----------|---------|
| Action succeeded (save, delete, approve) | `toast.success()` |
| Action failed (network, validation) | `toast.error()` |
| Pending / slow operation | `toast.loading()` + replace with success/error |
| Blocking confirmation needed | `<ConfirmDialog>` |
| Form validation error | Inline field error |
| Section-level data error (load failed) | Inline error message in the section, with Retry button |
| Full app crash | `<ErrorBoundary>` fallback |

### 13.2 Button loading states

```tsx
<Button
  variant="primary"
  loading={isSubmitting}
  disabled={isSubmitting}
  onClick={handleSubmit}
>
  {isSubmitting ? 'Saving…' : 'Save Employee'}
</Button>
```

Always disable the button during async operations. Never allow double-submission.

---

## 14. Accessibility Requirements

See `docs/CODING_STANDARDS.md §15` for the full accessibility rules.

### Keyboard navigation map

| Key | Action |
|-----|--------|
| `Tab` | Move to next interactive element |
| `Shift+Tab` | Move to previous interactive element |
| `Enter` / `Space` | Activate button or checkbox |
| `Escape` | Close modal / dropdown / sidebar drawer |
| `Arrow` keys | Navigate within a menu or date picker |
| `Home` / `End` | Jump to first / last row in a table |

### Focus management rules

- When a modal opens, focus moves to the first focusable element inside it.
- When a modal closes, focus returns to the element that triggered it.
- Skeleton loaders do not trap focus.

---

## 15. CSS Architecture

### 15.1 File structure

```
src/
  styles/
    tokens.css          ← design tokens (custom properties)
    base.css            ← reset, html/body defaults
    layout.css          ← shell layout (sidebar, topbar, content)
    components.css      ← shared component styles (buttons, inputs, tables)
    utilities.css       ← single-purpose utility classes (text alignment, display)
    animations.css      ← keyframes, transition helpers
    themes/
      dark.css          ← [data-theme="dark"] overrides
```

### 15.2 Class naming — BEM-lite

```css
/* Block */
.employee-card { … }

/* Element */
.employee-card__avatar { … }
.employee-card__name   { … }

/* Modifier */
.employee-card--selected { … }
.employee-card--skeleton { … }
```

Do not use `!important` except in utility overrides with the `u-` prefix:
```css
.u-hidden     { display: none !important; }
.u-text-right { text-align: right !important; }
```

### 15.3 No CSS Modules (current approach)

CSS is global for now (required for legacy compatibility). In Phase 2+, new components may use CSS Modules by appending `.module.css`. Do not mix approaches within a single component.

### 15.4 Vendor prefix rule

Do not write vendor prefixes by hand. Vite + PostCSS Autoprefixer handles this automatically.

---

*Last updated: Phase 1b — Shell Split & Documentation*
*Owner: Engineering Lead / Design Lead*
*Next review: Phase 2a kickoff*
