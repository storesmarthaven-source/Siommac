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

## Phase 3+ (NOT done)

- Port `app/` (`MessagingProvider`/`selectors`) — **replace the eager fixture
  snapshot with cursor queries**: `load()` currently returns threads + users with an
  EMPTY message list; the app must call `repository.loadThread(threadId)` on select.
- Port `ui/components/` + `ui/styles/messenger.css` with SIOMAC-scoped classnames;
  wire `@ui/toast` + AppShell; drop the DO-NOT-PORT dev/fixture/browser adapters.
- Bridge SIOMAC realtime → `realtime.publish({ type:'snapshot-changed' })` from the
  app's realtime hook.
- Feature-flag mount alongside `MessageCenter`, reach parity, cut over, delete legacy.

## Known reconciliation points (documented in the code)

- `createGroup` sends an empty `body` (createThread requires body-or-attachment) —
  decide whether group creation requires a first message.
- Direct-thread name/avatar derived from the non-self participant.
- `listActivity` returns `[]` (no dedicated activity-log endpoint yet).
- `relatedRecord.type` mapped to `Document` pending per-module collaboration cards.
