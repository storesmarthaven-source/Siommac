# App-Wide Toast System — Build Spec (for Codex)

ONE app-wide toast system, three tiers (**normal · action · rich/full-card** + `loading`/`promise`), styled
like the session-expired notice, driven imperatively by any module AND by the realtime
notification/messages/tickets pipeline. **Decision locked: Path A — a Preact-native toaster.** Do NOT install
`sonner`/`shadcn`/Tailwind (this app is Preact + plain CSS + CSS-vars). Read `CLAUDE.md` first. §0 wins.

---

## 0. Verified corrections (checked against the codebase — these WIN on conflict)
1. **`CanonicalNotification` has NO `actor_id`.** (`src/api/communications.ts:56` — fields are `id, type,
   module, severity, title, body, source_type, source_id, action_route, metadata, is_read, action_required,
   action_status, due_at, created_at`.) The client self-toast guard cannot key on `notification.actor_id`.
   **Self-exclusion is the backend's job** — the recipient resolver already omits the actor from their own
   notifications, so drop the client `actor_id` check (or read `metadata.actorId` ONLY if you first confirm
   it's populated). Do not compile a reference to a non-existent field.
2. **Nav section ids:** there is **no `s-notifications` / `s-tickets`.** Real ids are **`s-notification-center`**
   and **`s-messages`**. **Tickets have no section** — they open the shared header ticket modal via the
   delegated `data-pill-action="ticket"` handler in `NavController`, not `showSection`. So
   `navigateToDomain('tickets')` must trigger that modal, not `showSection('s-tickets')`.
3. **`action_route` is not guaranteed to be a section id.** Guard before navigating: only
   `window.Nav?.showSection?.(route)` when `route` looks like a section id (`route?.startsWith('s-')`),
   else fall back to the domain center. Never pass an arbitrary route into `showSection`.
4. **Tokens exist — use them, don't invent:** `--siomac-blue` (#1a2c53), `--siomac-navy`, `--bg-card`,
   `--text-muted`, `--radius-md`, `--success`, `--warning`, `--siomac-red`. Visual source of truth is
   `.cpop-toast` in `assets/styles/popup.css`.
5. **`<Toaster/>` mounts once in `src/shell/AppShell.tsx`** (portal to `document.body`). REMOVE the stray
   `<ToastContainer/>` in `src/components/sections/Employees/index.tsx`. Never mount in a section.
6. **Migration gate is strict (CLAUDE.md no-dual-system):** the final build has EXACTLY ONE toast engine.
   Temporary delegation during the swap is fine; leaving the old store toast or `dialog.toast` alive as a
   second system is NOT. Grep-verify at the end.

## 1. File structure
```
src/ui/toast/
├─ index.ts          # public `toast` API (+ re-exports Toaster)
├─ toastStore.ts     # framework-free store: subscribe/getToasts/upsert/remove/update
├─ toastTypes.ts     # ToastVariant/Tier/Position/Action/Options/RichInput/Record
├─ Toaster.tsx       # portal container, MAX_VISIBLE + expand-on-hover
├─ ToastCard.tsx     # one card: pause-on-hover/focus, Esc, actions, close
├─ ToastProgress.tsx # timer bar (paused-aware)
├─ toastPromise.ts   # (optional split of promise())
└─ toast.css         # extends .cpop-toast tokens
src/components/realtime/notificationToasts.ts   # realtime→toast mapping (OUTSIDE @ui)
src/store/ui.ts       → `export { toast } from '@ui/toast'` (protects 192 call sites)
src/lib/dialog.ts     → drop `dialog.toast` (delegate during transition, delete after)
src/shell/AppShell.tsx→ mount <Toaster/>
```

## 2. Types (`toastTypes.ts`)
`ToastVariant = 'neutral'|'success'|'error'|'warning'|'info'|'critical'`;
`ToastTier = 'normal'|'action'|'rich'|'loading'`;
`ToastPosition = 'bottom-right'|…` (default `bottom-right`);
`ToastAction = { label; onClick?: () => void|boolean|Promise<void|boolean>; tone?: 'primary'|'secondary'|'danger' }`;
`ToastOptions = { id?; title?; duration?; position?; dismissible?; onDismiss? }`;
`RichToastInput = ToastOptions & { title; body?; icon?; avatarUrl?; variant?; meta?: string[]; actions?: ToastAction[]; onClick? }`;
`ToastRecord = { id; tier; variant; title?; message?; body?; icon?; avatarUrl?; meta?; actions?; duration; position; dismissible; createdAt; paused; remainingMs; onClick?; onDismiss? }`.
(Use the reference implementation the user supplied — it is the committed shape.)

## 3. Store (`toastStore.ts`)
Framework-free `Set<Listener>` + module-level `records: ToastRecord[]` with `subscribe`, `getToasts`,
`upsertToast` (de-dupe by `id` — existing id patches, new id appends), `removeToast(id?)` (no id = clear all),
`updateToast(id, patch)`. Callable from components, hooks, stores, plain modules. `Toaster` subscribes via
`useEffect`.

## 4. Public API (`index.ts`) — back-compatible
```
toast(message, opts?)                        // neutral
toast.success/error/warning/info(message, opts?)
toast.loading(message, opts?) → id           // duration 0
toast.action(message, { label, onClick, altLabel?, onAlt?, variant?, ...opts }) → id   // default 8s
toast.rich({ title, body?, icon?|avatarUrl?, variant?, meta?, actions?, onClick?, ...opts }) → id  // sticky by default
toast.promise(p, { loading, success, error }) → Promise<T>   // upgrades loading→success/error in place
toast.dismiss(id?)                           // one or all
```
Default durations: error/critical 6000, warning 5000, else 4000; `0` = sticky. Action `onClick` returning
`false` keeps the toast open; otherwise it dismisses after the handler. Every call returns the `id`.

## 5. Toaster + Card behaviour
- **Toaster:** `createPortal(..., document.body)`; `MAX_VISIBLE = 4`; when collapsed show `+N more` and the
  last N; `onMouseEnter`→expand (show all), `onMouseLeave`→collapse. `role`-less `<section aria-live="polite"
  aria-relevant="additions removals">`.
- **Card:** `role="alert"` for error/critical else `role="status"`; `tabIndex=0`; hover/focus **pauses** the
  dismiss timer AND the progress bar (track `remainingMs`); `Esc` dismisses; whole-card `onClick` (deep-link);
  action buttons `stopPropagation`; avatar OR variant icon chip; up to 2 actions; close button when
  `dismissible`. Respect `prefers-reduced-motion` (no slide/progress animation).

## 6. CSS (`toast.css`) — extend `.cpop-toast`, don't invent
Fixed `.siomac-toaster` bottom-right, `z-index` above modals, `pointer-events:none` (cards re-enable). Cards
= `var(--bg-card)`, `var(--radius-md)`, soft shadow, 30px round variant-tinted icon chip, title 13px/600
`--siomac-navy`, text 12px `--text-muted`, variant progress bar (success green, error `--siomac-red`, warning
`--warning`, info/neutral `--siomac-blue`), pill action buttons (primary = `--siomac-blue`), meta chips,
`+N more` pill. `@keyframes siomac-toast-in` / `siomac-toast-progress`; both disabled under
`prefers-reduced-motion`. (User's supplied `toast.css` is the committed baseline.)

## 7. Realtime notification mapping (`src/components/realtime/notificationToasts.ts` — OUTSIDE @ui)
`maybeToastNotification({ notification, domain })` (NO `actorUserId`/`actor_id` — see §0.1): ignore signals
older than page-load (`resetToastSessionClock()` on mount → no backfill storm); respect
`NotificationPreferences` mute/quiet-hours (`isMutedByPreferences`, wired to the prefs query cache — default
safe); **coalesce bursts** (queue 2s; if >1 → one `toast.rich({ title: 'N new <domain>' })`, else one rich
toast per notification). Deep-link via a **guarded** navigator:
```ts
function navigateToRoute(route?: string|null) {
  if (route && route.startsWith('s-')) window.Nav?.showSection?.(route);   // §0.3 guard
  else navigateToDomain(currentDomain);
}
function navigateToDomain(d: string) {
  if (d === 'messages') return window.Nav?.showSection?.('s-messages');
  if (d === 'tickets')  return openTicketPanel();                          // §0.2 — modal, not a section
  return window.Nav?.showSection?.('s-notification-center');              // §0.2 — not 's-notifications'
}
```
`rich` toast content: `title`/`body` from the notification, `variant` from `severity`
(`critical→critical, warning→warning, error→error, else info`), `meta = [module, source_type].filter(Boolean)`,
a primary "View" action + whole-card `onClick` both calling the guarded navigator, `duration: 0`. Hook it in
`useRealtimeSignals.ts` **after** the domain query invalidation. The `@ui` toaster stays notification-agnostic.

## 8. Migration (one engine at the end — strict)
1. Add `src/ui/toast/*` + `toast.css`; mount `<Toaster/>` in `AppShell.tsx`.
2. `src/store/ui.ts` → `export { toast } from '@ui/toast'` (192 `toast.*` sites keep working).
3. `src/lib/dialog.ts` → delegate `dialog.toast` to `@ui/toast` during transition, codemod the 27 sites to
   import `toast` from `@ui/toast`, then **delete** `dialog.toast` (keep `confirm/prompt/alert/loading`).
4. Remove `<ToastContainer/>` from `Employees/index.tsx`.
5. **Delete** `src/components/shared/Toast.tsx` + the legacy toast slice in `ui.ts` + any old `ToastContainer`
   importers.
6. Grep gate (must be empty): `grep -R "ToastContainer" src`, `grep -R "components/shared/Toast" src`,
   `grep -R "dialog.toast" src`. Result: toast resolves ONLY to `@ui/toast`.

## 9. Tests (rewrite `Toast.test.tsx`, keep the 229 count green)
normal renders; each variant renders; action button calls `onClick` + dismisses; `onClick`→`false` keeps
open; rich renders title/body/meta/actions; promise loading→success and loading→error; `dismiss(id)` removes
one, `dismiss()` all; duplicate id updates existing; hover/focus pauses dismissal; `Esc` dismisses; errors
`role="alert"`, others `role="status"`; reduced-motion doesn't break render.
**Manual:** single root mount (no duplicate stacks), bottom-right, progress bar, hover-pause, max-visible
collapse, rich realtime toast, deep-link action, quiet-hours/muted guard, no self-toast, coalesced burst.

## 10. Definition of done
One imperative `toast` API (normal/action/rich/loading/promise) mounted once at app root via body portal,
styled to the session-expired card with existing tokens; all 219 legacy sites (192 store + 27 dialog)
migrated and **both legacy systems deleted** (grep-clean); realtime notifications/messages/tickets raise rich
toasts through `useRealtimeSignals` with §0-correct navigation (guarded `action_route`, `s-notification-center`,
ticket modal), prefs/quiet-hours, burst coalescing, no-backfill, and backend-side self-exclusion; a11y +
reduced-motion honoured; `typecheck:frontend` + 229 tests green. No band-aids: no second toast engine, no
Tailwind/shadcn/sonner dependency, no reference to a non-existent notification field, notification mapping
lives outside `@ui`.
