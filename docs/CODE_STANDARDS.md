# CODE_STANDARDS.md — Coding Standards & Conventions

> **Machine-executable reference.**  
> Rules are enforced at code review. "Should" = strong preference. "Must" = non-negotiable.

---

## 1. File & Module Naming

| Context | Convention | Example |
|---------|------------|---------|
| Netlify functions | `kebab-case.js` | `auto-checkout.js` |
| Frontend JS modules | `camelCase.js` | `cache.js`, `api.js` |
| CSS files | `kebab-case.css` | `views.css`, `responsive.css` |
| HTML partials | `kebab-case.html` | `app-shell.html` |
| SQL migrations | `YYYYMMDDHHMMSS_description.sql` | `20260510190000_add_payroll_fields.sql` |
| Docs | `UPPER_SNAKE.md` | `API_SPEC.md` |

**Must not** use spaces or special characters in any file name.

---

## 2. Backend — `netlify/functions/api.js`

### 2.1 Route Handler Signature

Every handler is an `async function` that receives `(args, ctx)` and returns a plain object:

```js
async function myAction(args, ctx) {
  const user = await requireRole(ctx, ['admin']);   // throws if unauthorized
  // ... logic ...
  return { success: true, data: result };
}
```

- `args` — the parsed `args` object from the request body (already validated for existence)
- `ctx` — `{ auth }` where `auth` is the decoded JWT payload (or `null` if unauthenticated)
- **Must** return `{ success: true, data: ... }` on success
- **Must** return `{ success: false, message: "..." }` on failure (not throw, unless using the role guards)
- **Must not** return HTTP status codes directly — use the `ok()` / `fail()` helpers

### 2.2 Authorization Guard Pattern

```js
// Require any authenticated user
const user = await requireUser(ctx);

// Require specific role(s)
const user = await requireRole(ctx, ['admin']);
const user = await requireRole(ctx, ['admin', 'manager']);
```

**Must** call one of these at the top of every route that touches user data.  
**Must not** check `ctx.auth.role` directly — `requireRole` also validates the DB record is still active.

### 2.3 Database Queries

```js
// Good — explicit column selection
const { data, error } = await sb.from('app_users').select('id, username, role').eq('id', userId).single();

// Bad — never use select('*') on tables with sensitive columns (password_hash, signed_url)
const { data } = await sb.from('app_users').select('*');  // ❌
```

- **Must** select only the columns the handler actually uses
- **Must** check `error` before using `data` — Supabase returns both even on partial failures
- **Should** use `.maybeSingle()` instead of `.single()` when zero rows is a valid outcome (`.single()` throws on zero rows)
- **Must not** construct raw SQL strings with user input — use Supabase query builder throughout

### 2.4 Input Validation

```js
// Normalise and validate at the top of the handler
const username = String(args.username || '').trim().toLowerCase();
if (!username) return { success: false, message: 'Username is required' };
const rate = Number(args.rate);
if (!Number.isFinite(rate) || rate < 0) return { success: false, message: 'Invalid rate' };
```

- **Must** sanitise all string inputs with `String(...).trim()`
- **Must** use `Number(...)` + `Number.isFinite()` for numeric fields — never trust `parseFloat`
- **Must** validate ranges (e.g. dates: `startDate <= endDate`)
- **Must not** use `eval`, `Function()`, or dynamic property access on user-supplied keys

### 2.5 Error Handling

```js
// Good — caught at handler level, log but don't expose stack
try {
  const result = await riskyOperation();
  return { success: true, data: result };
} catch (err) {
  console.error('myAction failed:', err.message);
  return { success: false, message: err.message || 'Unexpected error' };
}
```

- **Must** wrap Supabase storage operations in try/catch — they throw on network errors
- **Must not** return `err.stack` to the client
- **Should** log the full error server-side with `console.error` for debugging
- Role guard errors (`Unauthorized`, `Forbidden`) **must** propagate — they are caught by the router

### 2.6 Activity Logging

```js
await log_(user, 'action_name', 'entity_type', entityId, 'Human-readable detail');
```

Call `log_()` after every write operation (add, update, delete, approve, reject).  
**Must not** `await` it in the happy path where the result doesn't matter — let it run silently.

### 2.7 Route Registration

Add new routes to the router object at the bottom of `api.js`:

```js
const ROUTES = {
  // ...existing routes...
  myAction: { fn: myAction, auth: true },
};
```

- `auth: true` — token required (most routes)
- `auth: false` — public (only `login`, `ping`, `setupDemoUsers`)
- **Must** add the route name in `API_SPEC.md` with full documentation before merging

---

## 3. Frontend — `assets/app.js`

### 3.1 Module Variables

All module-level state lives at the top of the IIFE, declared with `let`:

```js
let currentUser     = '';
let currentRole     = '';
let _companyInfo    = { name:'', address:'', phone:'', email:'', nis:'', bir:'', logoUrl:'' };
let _empAllList     = [];
```

- **Must** prefix private variables with `_`
- **Must not** put state on `window` unless it must be callable from inline HTML (e.g. `window._printPayslip`)
- **Should** initialise arrays as `[]` and objects as `{}` — never `null` for collections

### 3.2 API Calls

```js
// Read — use apiSwr (cache + dedup)
apiSwr('listEmployees', {}, {
  onData: res => {
    if (!res || !res.success) return;
    _empAllList = res.data;
    _renderEmployees();
  }
});

// Write — use api() (busts cache automatically)
api('updateEmployee', { username, position }).then(res => {
  if (!res.success) { showNotification(res.message, 'error'); return; }
  showNotification('Saved', 'success');
  loadEmployeeList(true);
});
```

- **Must** use `apiSwr` for all reads (GET-equivalent actions)
- **Must** use `api()` for all writes (mutations) — it clears the SWR cache
- **Must** check `res.success` before using `res.data`
- **Must not** call `_rawApi` directly in feature code — only in infrastructure (e.g. live attendance polling)

### 3.3 DOM Rendering

```js
// Good — escape all user data
element.innerHTML = `<span>${escapeHtml(emp.fullName)}</span>`;

// Bad — XSS risk
element.innerHTML = `<span>${emp.fullName}</span>`;  // ❌
```

- **Must** pass all user-supplied strings through `escapeHtml()` before inserting into innerHTML
- **Should** use `textContent` for plain-text values (faster, auto-safe)
- **Must not** use `document.write` in feature code — only in the print window builder
- **Should** build large HTML strings in a single template literal and set `innerHTML` once — not append child-by-child

### 3.4 SWR / Caching Pattern

```js
function loadSomething(force = false) {
  _skelOnce('s-section-id', () => setSkel('containerId', skelCards(3)));
  apiSwr('actionName', args, {
    force,
    onData: res => {
      _markLoaded('s-section-id');
      if (!res || !res.success) return;
      renderData(res.data);
    }
  });
}
```

- **Must** call `_skelOnce` before `apiSwr` so skeleton shows only on first load
- **Must** call `_markLoaded` inside `onData` after confirming success
- Pass `force: true` only after a mutation that should invalidate stale cache

### 3.5 Event Delegation

All click/input/change handlers use a single delegated listener per event type:

```js
document.addEventListener('click', function(event) {
  if (event.target.closest('.my-button')) {
    const id = event.target.closest('.my-button').dataset.id;
    doSomething(id);
  }
});
```

- **Must** use `event.target.closest()` — not `event.target.matches()` — so clicks on child elements (icons) are caught
- **Must not** add per-element `addEventListener` inside render loops — it leaks memory on re-render
- **Should** chain conditions with `else if` so at most one handler fires per click

### 3.6 Notification Pattern

```js
showNotification('Employee saved', 'success');  // green
showNotification('Something went wrong', 'error');  // red
showNotification('No changes found', 'info');  // blue/grey
```

- **Must** use `showNotification` for transient feedback, not `alert()`
- **Must** use `cpop.fire(...)` (SweetAlert2-compatible) for confirmation dialogs and rich modals
- **Must not** use `confirm()` or `prompt()` — they block the main thread

---

## 4. CSS — `assets/styles/`

### 4.1 File Organisation

| File | Responsibility |
|------|---------------|
| `base.css` | CSS variables, reset, typography, layout shell |
| `views.css` | All section-specific component styles |
| `responsive.css` | Mobile breakpoints only — never add layout here |
| `popup.css` | `cpop-*` dialog and modal styles |

- **Must not** add new files without updating this table
- **Must** keep `responsive.css` override-only — no new selectors that don't exist in another file

### 4.2 Variable Usage

```css
/* Good */
border: 1px solid var(--border);
color: var(--text-muted);

/* Bad — hardcoded that won't respect theme changes */
border: 1px solid #e5e7eb;   /* ❌ */
```

- **Must** use CSS variables for colours, borders, and spacing that appear more than once
- CSS variables are defined in `base.css` under `:root`
- **Must not** use `!important` except for print media overrides and explicit `.hidden` utilities

### 4.3 Print Styles

All print-specific CSS lives **inside `window._printPayslip`** as an inlined string, not in a `@media print` block in any external file. This is because the print window is a self-contained `window.open()` document.

Exception: `.pr-payslip-brand` show/hide on screen vs print is handled in `views.css` with `@media print`.

### 4.4 Naming Convention

- Component root: `.pr-payslip`, `.ps-card`, `.emp-card`
- Child elements: `.pr-payslip-header`, `.ps-card-body`, `.emp-card-footer`
- Modifiers: `.ps-card--inactive`, `.emp-status-badge--active`
- State: `.is-active`, `.is-loading`, `.hidden`
- JS hooks: `data-id`, `data-username`, `data-filter` — never style off `data-*` attributes

---

## 5. Git Conventions

### 5.1 Commit Message Format

```
<type>: <short imperative description>

- bullet detail 1
- bullet detail 2

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

Types:

| Type | When to use |
|------|-------------|
| `feat` | New user-visible feature |
| `fix` | Bug fix |
| `style` | CSS/layout changes only, no logic |
| `refactor` | Code restructure, no behaviour change |
| `docs` | Documentation only |
| `chore` | Config, deps, migrations |

- **Must** use imperative mood: "add employee filter" not "added employee filter"
- **Must not** commit directly to `main` — use a feature branch + merge

### 5.2 Branch Naming

```
feat/description
fix/description
docs/description
claude/worktree-name     ← Claude-managed worktrees only
```

### 5.3 What Not to Commit

- `.env` files or any file containing secrets
- `node_modules/`
- `supabase/.temp/`
- `dashboard - Copy.html` or other scratch files
- Binary assets > 1 MB (use Supabase Storage instead)

---

## 6. Code Review Checklist

Before merging any PR, verify:

**Security**
- [ ] All user input passed through `escapeHtml()` before innerHTML
- [ ] No `select('*')` on tables with sensitive columns
- [ ] All new routes call `requireUser` or `requireRole` at the top
- [ ] No secrets, tokens, or passwords in any committed file

**Correctness**
- [ ] `apiSwr` used for reads, `api()` for writes
- [ ] `res.success` checked before using `res.data`
- [ ] Date arithmetic uses the `TZ` timezone — not local server time
- [ ] Image uploads validate MIME type and size before calling `uploadBase64`

**UX**
- [ ] Loading states handled with skeleton or spinner
- [ ] Error states surface a message via `showNotification` or inline text
- [ ] No flicker on re-render (SWR dedup hash prevents unnecessary re-renders)
- [ ] Print receipt includes Font Awesome link in print window head

**Performance**
- [ ] No `addEventListener` inside render loops
- [ ] Large lists rendered in a single `innerHTML` assignment
- [ ] `_skelOnce` called before `apiSwr` so skeleton appears only once

**Accessibility**
- [ ] Buttons have `title` attributes where label is icon-only
- [ ] Form inputs have associated `<label>` elements
- [ ] Colour is not the only differentiator for status (icon + colour)
