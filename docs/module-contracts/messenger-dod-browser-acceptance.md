# Messenger — DoD browser acceptance record (Composer send-gate + reply-restore)

Focused browser-acceptance evidence for the messenger hardening DoD test items
(reply-restore race, IME composition-sequence, slice-6 markRead/scroll). Follows
the §7 "UX/browser evidence" section of
`docs/templates/MODULE_RELEASE_EVIDENCE_TEMPLATE.md`; the other sections do not
apply (this change adds pure-logic guards + tests, no schema/mutation/security
surface).

- **Branch/commit:** `claude/session-2026-07-17-codex-messenger` /
  `527e27f3` (DoD tests + reply-restore race fix), `2833443f` (slice 1–6).
- **Server origin / CWD:** `http://localhost:5173` (Vite) proxying `:8888`
  (netlify dev) / `C:\Users\MSI Laptop\Desktop\Siomac`.
- **Session:** 2026-07-17. In-app Chromium (Browser pane), superadmin
  (USR-9F174AB5) ↔ System Admin (USR-001) thread.

## §7 UX / browser evidence

| Journey | Method | Result |
|---|---|---|
| BUI-MSG-IME-01 — Enter that CONFIRMS an IME composition must NOT send | Faithful sequence in the live app: `compositionstart` → `compositionupdate` ("日本語テスト DoD-IME") → `keydown Enter {isComposing:true}` | **PASS** — text retained in the editor, no message posted |
| BUI-MSG-IME-02 — plain Enter AFTER the composition commits sends | `compositionend` → `keydown Enter {isComposing:false}` | **PASS** — message posted, editor cleared |
| BUI-MSG-SEND-01 — plain Enter sends; Shift/IME suppressed | `isSendKey` unit predicate + live `keydown Enter` (isComposing false→send, true→no-send) | **PASS** |
| BUI-MSG-MR-01 — markRead holds while pane unfocused, clears on real focus | slice-6 black-box: post as System Admin, badge held while `document.hasFocus()===false`, cleared + server unread cursor → 0 on real focus click | **PASS** |
| BUI-MSG-SCROLL-01 — scroll-to-latest chevron floats a constant gap above the composer at any composer height | measured chevron/composer rects vs. a simulated +106px composer growth | **PASS** — constant 14px gap |

- Console: no errors during any pass (`read_console_messages` errors-only → empty).
- Unit coverage: `composerLogic.test.ts` (9 cases) — `isSendKey` (plain/Shift/IME/
  non-Enter/sequence) and `shouldRestoreReply` (restore-when-empty, race-suppressed,
  same-target, no-target). Full frontend vitest **284/284**.

## Automation gap (stated explicitly, per the delivery standard)

- The repository has **no browser/e2e test runner** wired for the frontend
  (vitest is jsdom-only). The IME and markRead/scroll journeys above are
  **recorded manual browser passes**, not automated regression.
- jsdom does **not** auto-set `KeyboardEvent.isComposing` between
  `compositionstart`/`compositionend`; the live pass above drives that flag
  through dispatched events, but a **true hardware-IME sequence** (an actual
  CJK IME producing native composition + isComposing) can only be confirmed by
  a human on an IME keyboard. That remains the residual manual item.
- The reply-restore **race** is covered deterministically by the
  `shouldRestoreReply` unit test (a forced-failure + mid-flight re-pick is not
  reliably reproducible via synthetic events); the wiring (`replyToRef` mirror +
  guarded `onRestoreReply`) is verified by inspection against that predicate.
