# Coding Standards

> **Governing doc for:** every `.ts` / `.tsx` file in `src/`.
> Every source file must carry a JSDoc block referencing the docs it is governed by.
> See `docs/ARCHITECTURE.md` for system-level rules and `docs/UI_DESIGN_SYSTEM.md` for component patterns.

---

## Table of Contents

1. [Core Principles](#1-core-principles)
2. [TypeScript Rules](#2-typescript-rules)
3. [File & Module Structure](#3-file--module-structure)
4. [Naming Conventions](#4-naming-conventions)
5. [Import Ordering](#5-import-ordering)
6. [Component Rules (Preact / TSX)](#6-component-rules-preact--tsx)
7. [State Management Rules](#7-state-management-rules)
8. [API & Data Fetching Rules](#8-api--data-fetching-rules)
9. [Error Handling](#9-error-handling)
10. [Testing Standards](#10-testing-standards)
11. [Documentation & JSDoc](#11-documentation--jsdoc)
12. [Git & Commit Conventions](#12-git--commit-conventions)
13. [Performance Rules](#13-performance-rules)
14. [Security Rules](#14-security-rules)
15. [Accessibility Rules](#15-accessibility-rules)
16. [Enforcement Checklist](#16-enforcement-checklist)

---

## 1. Core Principles

These are non-negotiable. Every PR is reviewed against them.

| # | Principle | Practical meaning |
|---|-----------|-------------------|
| P1 | **Correctness first** | Type-safe, tested, no `any` without explicit justification |
| P2 | **Explicit over implicit** | Name things clearly; avoid clever tricks that need a comment to understand |
| P3 | **One responsibility** | Each file, each function, each hook has exactly one job |
| P4 | **Fail loudly in dev, gracefully in prod** | `throw` in `import.meta.env.DEV`, `logger.error` + fallback in prod |
| P5 | **Document at the boundary** | Public functions, types, hooks — all have JSDoc; internals may have inline comments |
| P6 | **No magic numbers / strings** | Named constants in `src/config/` or at the top of the file |
| P7 | **Enterprise scale** | If a solution won't work at 10 × current load, flag it before implementing |

---

## 2. TypeScript Rules

### 2.1 Strict mode is mandatory

The project compiles with `strict: true` **plus** `noUncheckedIndexedAccess: true`.
Never disable a strict flag with a comment; fix the underlying type instead.

```ts
// ❌ Wrong
const name = users[0].name;        // TS error with noUncheckedIndexedAccess

// ✅ Correct
const name = users[0]?.name ?? 'Unknown';
```

### 2.2 No `any` without annotation

Every `any` usage must carry an inline comment explaining why it cannot be typed:

```ts
// ❌ Wrong
const data: any = await res.json();

// ✅ Correct — third-party library returns untyped runtime data
const raw = await res.json() as unknown;
const data = parseEmployeeList(raw);   // validated by Zod schema
```

Prefer `unknown` → narrow with Zod or type guard.

### 2.3 `noUncheckedIndexedAccess` idioms

```ts
// Map / Record access
const val = myMap.get(key);          // T | undefined — handle both paths
const rec = obj[key];                // T | undefined — check before use

// Array access
const first = arr[0];                // T | undefined
const first = arr.at(0);            // same — T | undefined

// Narrowing patterns
if (val === undefined) return;
const safe = val ?? defaultValue;
const safe = val!;                   // only when control-flow PROVES it's set
```

### 2.4 Type imports

Always use `import type` for type-only imports to keep the runtime bundle clean:

```ts
import type { Employee, AttendanceRecord } from '@/types/domain';
import { useEmployeeStore } from '@store/data';
```

### 2.5 Avoid enums — use `as const` unions

```ts
// ❌ Wrong — enums compile to objects with reverse mapping
enum Status { Active = 'active', Inactive = 'inactive' }

// ✅ Correct
export const STATUS = { ACTIVE: 'active', INACTIVE: 'inactive' } as const;
export type Status = typeof STATUS[keyof typeof STATUS];
```

### 2.6 Return types on public functions

Public functions (exported or used by multiple callers) must declare their return type:

```ts
// ❌ Wrong
export function parseDate(raw: string) { ... }

// ✅ Correct
export function parseDate(raw: string): Date | null { ... }
```

---

## 3. File & Module Structure

### 3.1 File size limits

| Zone | Soft limit | Hard limit | Action when breached |
|------|-----------|-----------|---------------------|
| Library (`src/lib/`) | 300 lines | 500 lines | Split into sub-modules |
| Store slice (`src/store/`) | 200 lines | 350 lines | Split slice |
| Section component (`src/components/sections/`) | 400 lines | 600 lines | Extract sub-components |
| Shell component (`src/shell/`) | 250 lines | 400 lines | Split panel |
| Test file | 300 lines | 500 lines | Split by concern |

### 3.2 Section module boundary rule

Each section folder exposes **only** its `index.ts`. All internal files are private:

```
src/components/sections/Employees/
  index.ts          ← public API (re-exports)
  EmployeeList.tsx  ← private
  EmployeeRow.tsx   ← private
  useEmployeeQuery.ts ← private
```

**Never** import `src/components/sections/Employees/EmployeeList.tsx` from outside the folder.
Import only from `@sections/Employees`.

### 3.3 Dependency direction (enforced)

```
shell → sections → shared components
                → lib (api, logger, env, attSystem …)
                → store (data, ui, session, realtime)
lib → (nothing in src/)
store → lib
```

**Violations:**
- `lib` importing from components → **forbidden**
- `store` importing from components → **forbidden**
- circular imports → **forbidden** (use events or store as the bridge)

### 3.4 One component per file (TSX rule)

One exported default component per `.tsx` file. Helper sub-components in the same file are acceptable if under 50 lines; otherwise extract.

---

## 4. Naming Conventions

### 4.1 Files

| Type | Convention | Example |
|------|-----------|---------|
| Preact component | `PascalCase.tsx` | `EmployeeRow.tsx` |
| Hook | `useCamelCase.ts` | `useAttendanceFeed.ts` |
| Store slice | `camelCase.ts` | `data.ts` |
| Library module | `camelCase.ts` | `attSystem.ts` |
| Test | `<same-name>.test.ts(x)` | `attSystem.test.ts` |
| Type-only file | `camelCase.types.ts` | `employee.types.ts` |

### 4.2 Identifiers

```ts
// Components — PascalCase
function EmployeeRow({ employee }: Props) { ... }

// Hooks — useCamelCase
function useEmployeeQuery(id: string) { ... }

// Constants — SCREAMING_SNAKE_CASE
const MAX_RETRY_COUNT = 3;

// Private module-level symbols — _prefixedCamelCase
function _parseRawEmployee(raw: unknown): Employee { ... }

// Zustand store actions — verbNoun camelCase
actions: { setSelectedEmployee, toggleSidebar, resetFilters }

// Event handlers — handle prefix
const handleRowClick = (id: string) => { ... };

// Boolean variables — is/has/can prefix
const isLoading = true;
const hasPermission = can('employees.view');
```

### 4.3 DOM IDs / CSS classes

IDs and class names follow the existing HTML conventions in `app-shell.html`:
- Section wrappers: `s-<section-name>` (e.g. `s-emp-attendance`)
- Modal wrappers: `modal-<name>` or `<name>-modal`
- JS-hooks: `js-<purpose>` prefix for elements targeted by JS only (not styled)

Do not rename existing IDs — they are referenced by `attSystem.ts` and legacy event handlers.

---

## 5. Import Ordering

Imports within each file must follow this order with blank lines between groups:

```ts
// 1. Node built-ins (if used in tooling files)
import { resolve } from 'path';

// 2. Framework / runtime
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';

// 3. Third-party libraries
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

// 4. Alias imports — lib
import { logger }     from '@lib/logger';
import { attSystem }  from '@lib/attSystem';

// 5. Alias imports — store
import { useDataStore } from '@store/data';

// 6. Alias imports — config / env
import { cfg } from '@cfg/index';

// 7. Alias imports — shared components
import { Modal }   from '@shared/Modal';
import { Spinner } from '@shared/Spinner';

// 8. Alias imports — sections / shell
import { EmployeeRow } from '@sections/Employees';

// 9. Relative imports (same folder or child)
import { EmployeeFilters } from './EmployeeFilters';
import type { EmployeeProps } from './employee.types';
```

**Critical boot-order imports** in `main.tsx` are the only exception — they must appear in a specific sequence with a comment explaining why (see `docs/ARCHITECTURE.md §5`).

---

## 6. Component Rules (Preact / TSX)

### 6.1 Function components only

No class components. No `createClass`. Hooks everywhere.

### 6.2 Props interface before the component

```tsx
/**
 * EmployeeRow — renders a single employee in the list table.
 * @see docs/UI_DESIGN_SYSTEM.md §Tables
 * @see docs/ARCHITECTURE.md §Module-Boundaries
 */
interface Props {
  employee:    Employee;
  isSelected?: boolean;
  onSelect:    (id: string) => void;
}

export default function EmployeeRow({ employee, isSelected = false, onSelect }: Props) {
  // ...
}
```

### 6.3 Hooks order (enforced by eslint-plugin-react-hooks)

```ts
// 1. Context hooks
// 2. Store hooks
// 3. Query hooks (TanStack)
// 4. Local state (useState, useReducer)
// 5. Derived values (useMemo, useCallback)
// 6. Side effects (useEffect, useLayoutEffect)
// 7. Event handlers
// 8. Render helpers
// return JSX
```

### 6.4 No inline object / function creation in JSX (that causes re-renders)

```tsx
// ❌ Wrong — new array reference every render
<Select options={['a', 'b', 'c']} />

// ✅ Correct
const OPTIONS = ['a', 'b', 'c'] as const;
<Select options={OPTIONS} />

// ❌ Wrong — new function reference every render
<Button onClick={() => doThing(id)} />

// ✅ Correct
const handleClick = useCallback(() => doThing(id), [id]);
<Button onClick={handleClick} />
```

**Exception:** event handlers where the function body is 1–2 lines and `id` is stable may stay inline — use judgment.

### 6.5 Conditional rendering

```tsx
// ✅ Short-circuit for single element
{isLoading && <Spinner />}

// ✅ Ternary for two branches
{isLoading ? <Spinner /> : <EmployeeList />}

// ✅ Early return for complex guard
if (!employee) return null;
```

### 6.6 Key prop

Always provide a stable `key` when rendering lists. Never use array index as key unless items are static and never reordered.

```tsx
// ❌ Wrong
{employees.map((e, i) => <EmployeeRow key={i} employee={e} />)}

// ✅ Correct
{employees.map(e => <EmployeeRow key={e.id} employee={e} />)}
```

---

## 7. State Management Rules

See `docs/ARCHITECTURE.md §7` for the full state inventory.

### 7.1 What goes where

| Data | Where |
|------|-------|
| Server data (lists, records) | TanStack Query cache |
| Optimistic mutations | TanStack Query `useMutation` |
| Global UI state (sidebar, modal open) | `@store/ui` (Zustand) |
| Auth / session | `@store/session` (Zustand) |
| Realtime subscriptions | `@store/realtime` (Zustand) |
| Component-local ephemeral state | `useState` |
| Derived / computed values | `useMemo` (never store derived state in Zustand) |

### 7.2 Zustand slice rules

```ts
// ✅ State and actions co-located in the slice
interface UISlice {
  sidebarOpen:    boolean;
  activeSection:  string;
  setSidebarOpen: (open: boolean) => void;
  setSection:     (section: string) => void;
}
```

- Slices must not import other slices directly — use the combined store or pass data via component props.
- `immer` middleware is available — use it for deeply nested state mutations.
- Never call a Zustand setter inside a `useEffect` without a dependency guard; it causes infinite loops.

### 7.3 TanStack Query rules (Phase 2+)

```ts
// Query key factory — centralised in src/lib/queryKeys.ts
export const employeeKeys = {
  all:    ['employees']              as const,
  list:   (filters: EmployeeFilter) => [...employeeKeys.all, 'list', filters] as const,
  detail: (id: string)              => [...employeeKeys.all, 'detail', id]    as const,
};

// staleTime — always set explicitly
useQuery({
  queryKey: employeeKeys.list(filters),
  queryFn:  () => fetchEmployees(filters),
  staleTime: 30_000,   // 30 s — appropriate for list data
});
```

- Never pass `queryFn: async () => { ... }` inline for production queries; extract to a named fetcher.
- Invalidate by key hierarchy, not by clearing the whole cache.

### 7.4 Authentication guard on every query — mandatory

**Every `useQuery` call for an authenticated endpoint must include `enabled: isAuthenticated`.**
Read it from the session store, not from a prop or a local variable that could be undefined:

```ts
// ✅ Correct — query is dormant until the user is logged in
export function useEmployeeList() {
  const isAuthenticated = useSessionStore(s => s.isAuthenticated);
  return useQuery({
    queryKey: employeeKeys.list(),
    queryFn:  ({ signal }) => listEmployees(signal),
    staleTime: 60_000,
    enabled:  isAuthenticated,   // ← always required
  });
}

// ❌ Wrong — fires on the login screen, generates 401s, triggers logout loop
export function useEmployeeList() {
  return useQuery({
    queryKey: employeeKeys.list(),
    queryFn:  ({ signal }) => listEmployees(signal),
    staleTime: 60_000,
    // missing enabled: isAuthenticated
  });
}

// ❌ Wrong — hardcoded true is equivalent to no guard
useQuery({ ..., enabled: true });

// ✅ Acceptable — additional param guard is fine as long as isAuthenticated is included
useQuery({ ..., enabled: isAuthenticated && !!username });
```

This rule exists because TanStack Query starts all queries as soon as the
component mounts — which on the login screen means before any session exists.
A 401 from an unauthenticated request triggers the session-expiry handler,
which logs the user out before they can log in. See `docs/ARCHITECTURE.md §9`
for the full auth-gate contract.

**Checklist when writing a new `useQuery`:**
1. Is this endpoint authenticated? → add `enabled: isAuthenticated`
2. Does the query also require a specific value (username, id, etc.)? → `enabled: isAuthenticated && !!value`
3. Is it a truly public endpoint (e.g. `/auth/login`, `/api/ping`)? → no guard needed, but mark with a comment: `// public endpoint — no auth guard required`

---

## 8. API & Data Fetching Rules

### 8.1 Phase 1 — legacy `api()` wrapper

```ts
// ✅ Correct — typed result handling
const result = await api('getEmployees', { departmentId });
if (!result.success) {
  logger.error('getEmployees failed', { message: result.message });
  return;
}
const employees = result.data as Employee[];
```

Never cast `result.data` without first checking `result.success`.

### 8.2 Phase 2 — Supabase client (see `docs/ARCHITECTURE.md §8`)

```ts
// ✅ Correct
const { data, error } = await supabase
  .from('employees')
  .select('*')
  .eq('department_id', departmentId);

if (error) {
  logger.error('supabase employees fetch', error);
  throw error;   // let TanStack Query handle retry
}
```

Never use `.throwOnError()` without a corresponding error boundary — it will crash the component tree.

### 8.3 No raw `fetch()` in component files

All network calls go through:
- `@lib/api` (Supabase client abstraction, Phase 2)
- `@lib/apiLegacy` (legacy `api()` / `apiSwr()`, Phase 1)
- Supabase Realtime (subscriptions only)

Components never call `fetch()` directly.

### 8.4 The 401 / session-expiry contract

`apiFetch` (in `@lib/api`) handles 401 responses according to a strict contract.
**Do not add ad-hoc 401 handling in components or hooks.** Let the fetch layer own it.

The contract:

| Situation | What `apiFetch` does | What it does NOT do |
|---|---|---|
| 401 and no session in localStorage | Returns `{ success: false, message: 'Unauthorized' }` | Does NOT call `_onAuthExpired()` |
| 401 and a session exists | Attempts one silent token refresh | Calls `_onAuthExpired()` only if refresh also fails |
| Legacy JSON `{ success: false, message: 'Unauthorized' }` | Same as above — checks session first | Same |
| Network error (no response) | Retries up to 2× with back-off | Does NOT treat as 401 |

**Why this matters:** Without the session check, a 401 on the login screen
(e.g. a background query that fired before the user logged in) would call
`_onAuthExpired()` → `useSessionStore.expire()` → wipe session → show login screen
even though the user was already on the login screen. This is a self-amplifying
loop that produces repeated "Session expired — forcing logout" console warnings.

**Boot-time calls** (anything in `attSystem.init()` or module-level code) must
check `loadSession() !== null` before calling any authenticated endpoint:

```ts
// ✅ Correct — skip if no session
const _hasSession = !!loadSession();
if (rawApi && _hasSession) {
  rawApi('getSettings', {}).then(res => { ... });
}

// ❌ Wrong — fires unconditionally, 401 on login screen triggers expiry loop
rawApi('getSettings', {}).then(res => { ... });
```

---

## 9. Error Handling

### 9.1 Logging levels

```ts
import { logger } from '@lib/logger';

logger.debug('…');    // dev-only, stripped in prod build
logger.info('…');     // operational events (user actions, route changes)
logger.warn('…');     // degraded-but-recoverable (stale cache, retry)
logger.error('…');    // actual failures requiring attention
```

Never use `console.log` in production paths. `console.error` is acceptable in catch blocks when a logger call would create a circular dependency.

### 9.2 Error boundaries

Every route-level section must be wrapped in `<ErrorBoundary>`:

```tsx
<ErrorBoundary fallback={<SectionError />}>
  <EmployeesSection />
</ErrorBoundary>
```

Modals get their own boundary so a modal crash doesn't kill the rest of the shell.

### 9.3 Async error pattern

```ts
// ✅ Correct — explicit error shape
async function loadSection(): Promise<void> {
  try {
    const result = await api('getSectionData', {});
    if (!result.success) throw new Error(result.message ?? 'Unknown error');
    setState(result.data as SectionData);
  } catch (err) {
    logger.error('loadSection', err);
    setError(err instanceof Error ? err.message : String(err));
  }
}
```

---

## 10. Testing Standards

### 10.1 Coverage thresholds (enforced by CI)

| Metric | Threshold |
|--------|-----------|
| Lines | 70 % |
| Functions | 70 % |
| Branches | 60 % |
| Statements | 70 % |

New code must not reduce coverage below these thresholds.

### 10.2 Test file colocation

Tests live alongside their source file:

```
src/lib/attSystem.ts
src/lib/attSystem.test.ts     ← colocated
src/components/sections/Employees/
  index.ts
  EmployeeList.tsx
  EmployeeList.test.tsx        ← colocated
```

### 10.3 Test naming

```ts
describe('attSystem', () => {
  describe('fmtLocalTime', () => {
    it('formats ISO string to locale-aware HH:MM', () => { ... });
    it('returns empty string for invalid input', () => { ... });
  });
});
```

Describe block = module or function name. `it()` sentence = what the function does in plain English.

### 10.4 Mocking rules

- Mock at the module boundary, not inside the function under test.
- Use `vi.mock('@lib/apiLegacy', ...)` not `vi.mock('./someInternalHelper')`.
- Every mock must be reset in `afterEach` (or use `vi.restoreAllMocks()` in setup).
- DOM-manipulating tests use `jsdom` (already configured in `vitest.config.ts`).

### 10.5 No snapshot tests for logic

Snapshot tests are acceptable for stable, simple UI output (e.g. a Badge rendering variants). They are **not** acceptable as a substitute for logic assertions.

---

## 11. Documentation & JSDoc

### 11.1 File header (required on every source file)

```ts
/**
 * src/lib/attSystem.ts
 *
 * <One-paragraph description of what this module does.>
 *
 * @see docs/ARCHITECTURE.md        — system-level context
 * @see docs/CODING_STANDARDS.md    — coding rules
 * @see docs/PHASE_PLAN.md          — which phase this belongs to
 */
```

The `@see` references are the link between code and the governing documentation.
Choose the most relevant docs — you don't need to cite all six for every file.

### 11.2 Public function JSDoc

```ts
/**
 * Formats an ISO 8601 datetime string into a localised HH:MM string.
 *
 * @param iso  - ISO 8601 string (e.g. "2025-01-15T08:30:00Z")
 * @param tz   - IANA timezone (defaults to browser timezone)
 * @returns    Formatted time string, or empty string on invalid input
 *
 * @example
 * fmtLocalTime('2025-01-15T08:30:00Z', 'Asia/Manila') // → '08:30'
 */
export function fmtLocalTime(iso: string, tz?: string): string { ... }
```

### 11.3 Inline comments

- Explain **why**, not **what**. The code already shows what.
- Mark tech-debt with `// TODO(phase-X): description` — never plain `// TODO`.
- Mark known quirks with `// NOTE: explanation`.
- Mark intentional non-obvious choices with `// INTENTIONAL: reason`.

```ts
// INTENTIONAL: re-evaluated each call so late-registered globals are visible
function _Nav() { return (w())['Nav'] as NavModule | undefined; }

// TODO(phase-2b): replace with Supabase session check
const token = _getSessionToken();
```

---

## 12. Git & Commit Conventions

### 12.1 Commit message format (Conventional Commits)

```
<type>(<scope>): <imperative summary>

<optional body — wrap at 72 chars>

<optional footer — BREAKING CHANGE, closes #issue>
```

**Types:**
| Type | When |
|------|------|
| `feat` | New feature visible to users |
| `fix` | Bug fix |
| `refactor` | Code change with no behaviour change |
| `perf` | Performance improvement |
| `test` | Adding or updating tests |
| `docs` | Documentation only |
| `chore` | Build, config, dependency updates |
| `style` | Formatting only (no logic) |

**Scopes:** `attSystem`, `shell`, `employees`, `auth`, `notifications`, `messages`, `tickets`, `api`, `store`, `docs`, `config`, `tests`

**Examples:**
```
feat(shell): split app-shell HTML into typed Preact components
fix(attSystem): read rememberMe from DOM instead of removed _tfa ref
docs(arch): document Phase 2 enterprise feature plan
refactor(api): replace window.api with typed Supabase client
```

### 12.2 Branch naming

```
feat/<scope>/<short-description>   →  feat/shell/split-app-shell
fix/<scope>/<short-description>    →  fix/att-system/rememberme-dom-read
docs/<description>                 →  docs/enterprise-architecture
```

### 12.3 PR requirements

- `tsc --noEmit` passes with zero errors
- `vitest run` passes with zero failures
- Coverage does not decrease
- At least one reviewer approval
- PR description links to the relevant `docs/` file

---

## 13. Performance Rules

### 13.1 Bundle size budget

| Chunk | Soft limit | Hard limit |
|-------|-----------|-----------|
| Initial JS (main chunk) | 150 kB gzip | 200 kB gzip |
| Per-section lazy chunk | 40 kB gzip | 80 kB gzip |
| Total CSS | 30 kB gzip | 50 kB gzip |

Use `vite build --report` to inspect chunk sizes. Violations must be resolved before merging.

### 13.2 Lazy loading

Section components loaded by route must be `lazy()`:

```tsx
const EmployeesSection = lazy(() => import('@sections/Employees'));
```

Never statically import a section from `AppShell.tsx`.

### 13.3 Memoization discipline

- `useMemo` for expensive derivations (filtering/sorting large arrays).
- `useCallback` for stable function references passed to child components.
- `memo()` for components that re-render often with same props.
- **Do not** apply these pre-emptively — profile first, optimise second.

### 13.4 Realtime over polling

For live data (notifications, attendance map, messages): Supabase Realtime only.
No `setInterval` polling unless the Realtime subscription is explicitly unavailable (offline fallback).

---

## 14. Security Rules

See `docs/SECURITY.md` for full security policy.

### 14.1 Never store sensitive data in localStorage

| Allowed in localStorage | Forbidden in localStorage |
|------------------------|--------------------------|
| UI preferences (theme, palette, sidebar state) | Auth tokens |
| Non-sensitive cached blobs | User passwords |
| Last-selected section | PII beyond the user's own name/email |

Auth tokens → httpOnly cookie (managed by Supabase / Netlify Edge Function).

### 14.2 XSS prevention

- Never use `dangerouslySetInnerHTML` except in `attSystem.ts` for legacy HTML payslips (already audited).
- Use `escapeHtml()` from `@lib/attSystem` for any dynamic content inserted via `.innerHTML` in legacy code.
- Template literals building HTML must always escape user-provided values.

### 14.3 API secrets

Environment variables with real secrets live in `.env.local` (gitignored). Only `VITE_` prefixed vars that are safe to expose in the browser bundle go in `.env`.

---

## 15. Accessibility Rules

### 15.1 Minimum requirements

- All interactive elements reachable by keyboard (`Tab`, `Enter`, `Space`, `Escape`).
- All images have meaningful `alt` text (or `alt=""` if decorative).
- Form inputs have associated `<label>` elements.
- Error messages are announced to screen readers (`aria-live="polite"` or `role="alert"`).
- Colour contrast meets WCAG AA (4.5:1 for normal text, 3:1 for large text).

### 15.2 ARIA

Use native HTML semantics first. Add ARIA only when a native element cannot fulfil the role:

```tsx
// ✅ Correct — native button
<button onClick={handleClick}>Submit</button>

// ❌ Wrong — div pretending to be a button
<div role="button" onClick={handleClick}>Submit</div>
```

---

## 16. Enforcement Checklist

Use this when reviewing a PR:

```
[ ] File header JSDoc with @see docs/ references present
[ ] No `any` without inline justification comment
[ ] Return types declared on public functions
[ ] No component imports from outside the section's index.ts
[ ] Import order follows §5
[ ] No inline object/function creation causing unnecessary re-renders
[ ] Error handling uses logger, not console.log
[ ] Tests added / updated for changed logic
[ ] tsc --noEmit passes
[ ] vitest run passes
[ ] Coverage thresholds maintained
[ ] Commit message follows Conventional Commits format
[ ] PR description links to governing docs/

Authentication-specific checks (§7.4, §8.4, docs/ARCHITECTURE.md §9):
[ ] Every new useQuery on an authenticated endpoint has enabled: isAuthenticated
[ ] No useQuery has enabled: true on an authenticated endpoint
[ ] No boot-time / module-level code calls authenticated endpoints without
    first checking loadSession() !== null
[ ] No ad-hoc 401 handling in components — let apiFetch own it
```

---

*Last updated: Phase 1b — Shell Split & Documentation*
*Owner: Engineering Lead*
*Next review: Phase 2a kickoff*
