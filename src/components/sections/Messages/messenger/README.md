# SIOMAC Messenger — port (Track-2)

Porting the clean-architecture Messenger (bundle at `Downloads/messenger-port2/`)
onto the existing SIOMAC messaging backbone. It will be feature-flag mounted
alongside `MessageCenter.tsx`, reach parity, then cut over.

## What's here (Phase 2 — adapters, DONE)

- **`domain/`** — the port's pure contract, ported verbatim: `models.ts`, `ports.ts`
  (the 3 boundaries), `preferences.ts`, `format.ts`. No external deps.
- **`adapters/`** — the SIOMAC implementations of the 3 ports, against the real
  `POST /api/communications/messages/*` routes + the shared `types/messaging.ts`
  DTO (auth JWT via `@lib/api`):
  - `mappers.ts` — the one place that maps our DTO → the port's domain models.
  - `siomacRepository.ts` — `MessagingRepository` (threads/posts/send/createGroup/
    delete/pin/markRead/mute/archive/invite/remove). Plus `loadThread(threadId)` for
    lazy per-thread messages.
  - `siomacAttachments.ts` — `AttachmentService` (presigned upload-url → PUT with
    progress → create row → signed download URL; mirrors `MessageCenter.uploadFile`).
  - `siomacRealtime.ts` — `RealtimeGateway`, a transport-agnostic local event bus
    (refetch-only; the app bridges SIOMAC's `communication_signals` refetch signal
    into it as `snapshot-changed`).
  - `index.ts` — `createSiomacMessagingAdapters()`.

Frontend `tsc` clean.

## Hidden features (no control rendered → their own future backend slices)

Reactions, favourites, and typing are hidden. `toggleReaction`/`setFavourite`
**throw** if called (they shouldn't be — the UI renders no control). The realtime
gateway ignores typing/presence publishes.

## Phase 3 + 4 flag-mount (DONE)

- **`app/`** — `MessagingProvider` reworked for LAZY loading: `load()` returns
  threads + users only; `actions.selectThread(id)` fetches messages via
  `repository.loadThread` and caches them; a realtime `snapshot-changed` reload
  refreshes the base + the ACTIVE thread and drops other cached threads.
  `markRead` is optimistic (local badge clear; realtime reconciles).
- **`ui/components/` + `ui/styles/messenger.css`** — ported with the `sm-`
  scoped classnames; the bundle's GLOBAL preamble (`:root`, element resets,
  `svg` sizing) is re-scoped under `.sm-workspace`. Icons render through the
  app-standard `lucide` + `@ui` LucideIcon via `ui/components/icons.tsx`
  (typed names — no `lucide-preact` dependency). Avatars fall back to initials.
- **Realtime bridge** — `useRealtimeSignals` (messages domain) →
  `integration/messengerSignalBus` → gateway `snapshot-changed`.
- **Toasts** — `integration/messagingNotifications.ts` uses `@ui/toast`.
- **Flag mount** — `MessagesSection.tsx` switches legacy `MessageCenter` ↔
  `MessengerWorkspace` per device (`localStorage siomac.messenger.v2`), default
  legacy. Cutover deletes MessageCenter + the switch.

## Deliberate scope decisions (Phase 3)

- Group creation has a REQUIRED "First message" field (createThread demands
  body-or-attachment; no fabricated body).
- Invite/group candidates come from the real `/communications/messages/recipients`
  directory (server-searchable), not the snapshot users.
- The **"Sent" queue is deferred** — with lazy loading its counts would only
  reflect opened threads (dishonest); needs a backend authored-by-me flag.
- Composer links are appended into the body when missing (persisted for real);
  link-preview cards are derived from the first URL in a body at map time.
- The attach dialog is **upload-only** — the bundle's Document Vault / Shared
  media tabs fabricated demo files and were not ported (future vault slice).
- The fixture date divider ("Today" regardless of dates) was dropped; real date
  dividers are a polish follow-up.
- Reactions / favourites / typing / presence-publishing remain hidden.

## Remaining before cutover (Phase 4 tail)

- Parity pass vs MessageCenter (compliance browser, drafts, pins browser, etc.),
  then delete `MessageCenter.tsx` + `MessagesSection` switch + legacy CSS.
- Direct-thread creation from the Messenger (today the legacy compose dialog /
  dropdown owns it; the get-or-create backend path is live).
- `listActivity` returns `[]` (no dedicated activity-log endpoint yet).
- `relatedRecord.type` mapped to `Document` pending per-module collaboration cards.
