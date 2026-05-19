# Siomac — Developer Onboarding

> Welcome to the Siomac codebase. This document gets you from zero to a running dev environment and oriented in the codebase in under an hour.
> See `docs/ARCHITECTURE.md` for the full system architecture and `docs/PHASE_PLAN.md` for what's being built next.

---

## What Is Siomac?

Siomac is an enterprise HR and workforce management platform for field operations. It handles:
- **Attendance** — geofenced clock-in/out, live map of who's on site
- **Leave management** — employee requests, manager/admin approvals
- **Payroll** — hourly rate config, payslip generation and export
- **Project sites** — GPS boundary management
- **Notifications, messages, tickets** — (Phase 2, in progress)

**Target users:** employees on mobile, managers and admins on desktop. Multiple company deployments (white-labelled with custom palettes and logos).

---

## Tech Stack (quick reference)

| Layer | Technology |
|-------|-----------|
| Frontend framework | Preact 10 (React-compatible, ~3kB) |
| Language | TypeScript 5 (strict + noUncheckedIndexedAccess) |
| State | Zustand 5 (UI/session), TanStack Query (server data — Phase 2) |
| Build | Vite 8 |
| Tests | Vitest + jsdom + @testing-library/preact |
| Backend | Netlify Edge Functions (Hono router) |
| Database | Supabase (PostgreSQL + Realtime + Auth) |
| Deploy | Netlify (CDN + Functions) |
| CSS | Plain CSS with custom properties (no CSS-in-JS) |
| Icons | Font Awesome 5 Free |

---

## Prerequisites

| Tool | Minimum version | Install |
|------|----------------|---------|
| Node.js | 20 LTS | https://nodejs.org |
| npm | 10+ | (bundled with Node) |
| Git | 2.40+ | https://git-scm.com |
| Netlify CLI | latest | `npm i -g netlify-cli` |

Optional but recommended:
- VS Code with the **ESLint** and **TypeScript** extensions
- Supabase CLI (`npm i -g supabase`) for local DB development

---

## First-time Setup

```bash
# 1. Clone the repository
git clone <repo-url> siomac
cd siomac

# 2. Install dependencies
npm install

# 3. Create your local environment file
cp .env.example .env
# Edit .env and fill in:
#   VITE_SUPABASE_URL=...
#   VITE_SUPABASE_ANON_KEY=...
# (Get these from your Supabase project dashboard)

# 4. Start the dev server
npm run dev
# → Opens at http://localhost:5173
```

The app should load the login page. If you see a Vite error about missing env vars, check your `.env` file.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | ✅ | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Supabase anon public key |
| `VITE_API_BASE` | ❌ | API prefix (empty = same-origin `/api`) |
| `VITE_APP_NAME` | ❌ | App title (default: `Siomac`) |
| `VITE_SENTRY_DSN` | ❌ | Sentry error tracking DSN |

For Netlify Functions, add the same vars to `netlify.toml` `[build.environment]` or the Netlify dashboard.

---

## Running With Netlify Functions (full stack)

```bash
# Build the Netlify functions first, then serve locally via Netlify CLI
npm run dev:netlify
# → http://localhost:8888 (with /api/* routed to functions)
```

This is required when testing login, attendance clock-in, or any feature that calls the backend API.

---

## Common Dev Commands

```bash
npm run dev              # Frontend only (Vite dev server, hot reload)
npm run dev:netlify      # Full stack (Vite + Netlify functions)
npm run build            # Full production build
npm run typecheck        # TypeScript check (both frontend + backend)
npm run typecheck:frontend  # Frontend only: tsc --noEmit -p tsconfig.frontend.json
npm run test:frontend    # Vitest test suite
npm run test:frontend:ui # Vitest with interactive UI
npm run lint:frontend    # ESLint
```

---

## Project Structure (key directories)

```
siomac/
├── src/                      ← Frontend source (TypeScript/Preact)
│   ├── main.tsx              ← Entry point — boot sequence
│   ├── lib/                  ← Pure utility modules (no components)
│   │   ├── attSystem.ts      ← Core app logic (port of legacy app.js)
│   │   ├── apiLegacy.ts      ← Legacy SWR + api() wrapper
│   │   ├── session.ts        ← Auth session management
│   │   ├── logger.ts         ← Structured logger
│   │   ├── env.ts            ← Env var validation
│   │   └── …
│   ├── store/                ← Zustand state slices
│   │   ├── data.ts           ← Employee / attendance / leave data
│   │   ├── ui.ts             ← Sidebar, modals, toasts, theme
│   │   ├── session.ts        ← Auth session state
│   │   └── realtime.ts       ← Supabase Realtime subscriptions
│   ├── config/
│   │   └── index.ts          ← App-wide constants (sections, palettes, layouts)
│   ├── components/
│   │   ├── shared/           ← Reusable components (Modal, Toast, Badge, …)
│   │   ├── sections/         ← Route-level section components
│   │   ├── auth/             ← Login Preact controller
│   │   ├── nav/              ← Navigation Preact controller
│   │   └── realtime/         ← Realtime connection indicator
│   └── shell/                ← App shell (Phase 1b — in progress)
│       ├── AppShell.tsx      ← Root compositor
│       ├── LoginShell.tsx    ← Login / 2FA panels
│       ├── sections/         ← Section panel HTML shells
│       └── modals/           ← Modal HTML shells
├── netlify/
│   └── functions/            ← Backend API (Hono router, TypeScript)
│       ├── api.ts            ← Main function entry point
│       ├── routes/           ← Route handlers (auth, employees, attendance, …)
│       └── lib/              ← Backend utilities (db, auth, session, …)
├── docs/                     ← Architecture and design documentation
│   ├── ARCHITECTURE.md       ← System overview, ADRs, boot sequence
│   ├── CODING_STANDARDS.md   ← TypeScript, naming, testing rules
│   ├── UI_DESIGN_SYSTEM.md   ← Colours, layout, components
│   ├── PHASE_PLAN.md         ← Roadmap and milestone definitions
│   └── SHELL_STRUCTURE.md    ← src/shell/ component guide
├── supabase/                 ← Database migrations and seeds
│   └── migrations/
├── assets/                   ← Legacy assets (being phased out in Phase 1b)
│   ├── css/                  ← Global stylesheets
│   ├── partials/             ← app-shell.html (being replaced by src/shell/)
│   └── js/                   ← Legacy JS (all ported — deletion pending)
├── index.html                ← App entry HTML
├── vite.config.ts            ← Vite config (aliases, plugins)
├── vitest.config.ts          ← Test config
├── tsconfig.frontend.json    ← TypeScript config for frontend
└── ONBOARDING.md             ← This file
```

---

## Import Aliases (quick reference)

| Alias | Resolves to |
|-------|------------|
| `@lib/attSystem` | `src/lib/attSystem.ts` |
| `@lib/apiLegacy` | `src/lib/apiLegacy.ts` |
| `@lib/logger` | `src/lib/logger.ts` |
| `@lib/session` | `src/lib/session.ts` |
| `@lib/env` | `src/lib/env.ts` |
| `@store/data` | `src/store/data.ts` |
| `@store/ui` | `src/store/ui.ts` |
| `@store/session` | `src/store/session.ts` |
| `@store/realtime` | `src/store/realtime.ts` |
| `@store` | `src/store/index.ts` |
| `@cfg/index` | `src/config/index.ts` |
| `@cfg` | `src/config/index.ts` |
| `@shared/Modal` | `src/components/shared/Modal.tsx` |
| `@shared/Toast` | `src/components/shared/Toast.tsx` |
| `@shared/…` | `src/components/shared/…` |
| `@sections/Employees` | `src/components/sections/Employees/` |
| `@sections/…` | `src/components/sections/…` |
| `@shell` | `src/shell/index.ts` |
| `@` | `src/` |

React → Preact: all `react` and `react-dom` imports resolve to `preact/compat` automatically (configured in Vite aliases).

---

## Architecture in 5 Minutes

### Boot sequence (`main.tsx`)

1. Validate env vars (`@lib/env`) — throws fast if misconfigured
2. Mount Preact app (components register globally via `window.*`)
3. Import `@lib/apiLegacy` (creates SWR cache, registers `window.api`)
4. Import `@lib/cache` (monkey-patches SWR for IndexedDB write-through)
5. Import `@lib/attSystem` (main app logic, registers `window.AttendanceSystem`)
6. `bootApp()`: warm SWR cache → call `AttendanceSystem.init()`
7. `AttendanceSystem.init()`: restore session, apply theme/palette, show correct section
8. Clear FOUC guard (`body.visibility = 'visible'`)

**Import order matters.** See `docs/ARCHITECTURE.md §5` for the critical ordering rules.

### State layers

| Layer | Technology | What it holds |
|-------|-----------|--------------|
| Server state | TanStack Query (Phase 2) / legacy SWR | Lists, records from backend |
| Global UI state | Zustand `@store/ui` | Sidebar open, active modal, toasts, theme |
| Session state | Zustand `@store/session` | Current user, token, role |
| Realtime | Zustand `@store/realtime` | Supabase Realtime subscriptions |
| Component local | `useState` | Form values, hover state, pagination |

### Module boundaries

```
shell → sections → shared components
                → lib (attSystem, apiLegacy, logger, …)
                → store (data, ui, session, realtime)
lib → (nothing from src/)     ← lib is dependency-free within the app
store → lib                   ← stores may use lib
```

Never import a section's internals from outside that section — only import from its `index.ts`.

---

## Testing

```bash
npm run test:frontend        # Run all tests once
npm run test:frontend -- --watch   # Watch mode
npm run test:frontend -- --coverage  # With coverage report
```

**Where tests live:** colocated with source files as `<name>.test.ts(x)`.

**Coverage thresholds** (enforced in CI):
- Lines: 70%, Functions: 70%, Branches: 60%, Statements: 70%

**Key mocking pattern:**
```ts
import { vi, describe, it, expect, beforeEach } from 'vitest';
vi.mock('@lib/apiLegacy', () => ({ api: vi.fn(), apiSwr: vi.fn() }));
```

---

## TypeScript Notes

The project uses `strict: true` + `noUncheckedIndexedAccess: true`. This means:

```ts
// Array / Map access returns T | undefined — always guard it:
const first = arr[0]?.name ?? 'Unknown';

// Use `import type` for type-only imports:
import type { Employee } from '@/types/domain';

// No `any` without a comment explaining why
```

Run the type checker:
```bash
npm run typecheck:frontend   # Must exit 0 before any PR merges
```

---

## Documentation

All docs live in `docs/`. Every source file must reference the governing doc in its JSDoc header:

```ts
/**
 * src/lib/attSystem.ts
 *
 * Core attendance system — port of legacy app.js.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */
```

| Doc | Purpose |
|-----|---------|
| `docs/ARCHITECTURE.md` | System overview, tech stack, boot sequence, ADRs |
| `docs/CODING_STANDARDS.md` | TypeScript rules, naming, imports, testing |
| `docs/UI_DESIGN_SYSTEM.md` | Colours, layout, component library, accessibility |
| `docs/PHASE_PLAN.md` | Roadmap, milestones, acceptance criteria |
| `docs/SHELL_STRUCTURE.md` | `src/shell/` component guide |
| `docs/API_SPEC.md` | Backend API endpoints and contracts |
| `docs/SECURITY.md` | Auth, RLS, secrets management |
| `docs/DATA_DICTIONARY.md` | Database table and field definitions |
| `docs/ENV_REGISTRY.md` | All environment variables |

---

## Making Your First Change

1. **Find the right file.** Use `@sections/<SectionName>` for section UI, `@lib/` for pure logic, `@store/` for state.
2. **Check the governing doc.** Look at the `@see docs/` in the file header and read the relevant section.
3. **Write the code.** Follow `docs/CODING_STANDARDS.md`.
4. **Write a test.** Colocate it as `<file>.test.ts(x)`.
5. **Run checks:**
   ```bash
   npm run typecheck:frontend
   npm run test:frontend
   ```
6. **Commit** using Conventional Commits format: `feat(scope): imperative description`
7. **PR** — description must link to the relevant doc.

---

## Frequently Asked Questions

**Q: Why Preact instead of React?**
A: Bundle size. Preact is ~3kB vs React's ~45kB. With `preact/compat`, the API is 99% identical. All React third-party libraries work via the alias in `vite.config.ts`.

**Q: Why does `main.tsx` import things in a specific order?**
A: `@lib/cache` monkey-patches the SWR object that `@lib/apiLegacy` creates. If cache loads before apiLegacy, the object doesn't exist yet. `@lib/attSystem` must be last because it depends on all window globals. See `docs/ARCHITECTURE.md §5`.

**Q: Why are section panels all in the DOM at once?**
A: To preserve scroll position and form state when switching sections. Only one is visible (CSS `display`). In Phase 2 we may move to proper routing with Preact Router, but Phase 1 maintains the existing UX.

**Q: Why `noUncheckedIndexedAccess`?**
A: It forces you to handle the case where an array index or map key might be undefined. This catches an entire class of runtime null errors. See `docs/CODING_STANDARDS.md §2.3`.

**Q: I'm getting a TypeScript error about `Record<string, unknown>`.**
A: The project avoids `Record<string, string>` for dynamic objects because the index signature conflicts with `unknown` values under `strict`. Use `Record<string, unknown>` and cast on access: `value as string`.

**Q: Where does the legacy `api()` call go in Phase 2?**
A: It gets replaced by typed Supabase client calls in `src/lib/api/` + TanStack Query hooks. The legacy `api()` stays in `attSystem.ts` until Phase 2b when the auth flow is also replaced.

**Q: How do I add a new section?**
A: 1) Create `src/components/sections/MySection/` with `index.ts` as the public export. 2) Add the section ID to `src/config/index.ts` `SECTION_DEFS`. 3) Add a panel `<div id="s-my-section">` in the appropriate shell sections file. 4) Add the `@sections/MySection` alias to both `vite.config.ts` and `vitest.config.ts`.

---

## Getting Help

- **Architecture questions:** `docs/ARCHITECTURE.md`
- **How to write code:** `docs/CODING_STANDARDS.md`
- **UI components:** `docs/UI_DESIGN_SYSTEM.md`
- **What to build next:** `docs/PHASE_PLAN.md`
- **Shell structure:** `docs/SHELL_STRUCTURE.md`
- **Existing issue/PR tracker:** GitHub Issues

---

*Last updated: Phase 1b — Shell Split & Documentation*
*Next update: Phase 2a kickoff*
