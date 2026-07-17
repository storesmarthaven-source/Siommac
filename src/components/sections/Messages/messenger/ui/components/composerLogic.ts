// Pure composer decisions — extracted so the send/keyboard guards are unit-
// testable without mounting the whole Composer (matches typingState.ts /
// threadDisplay.ts). The Composer wires these; the logic lives here.
import type { Message } from "../../domain/models";

/** The keyboard fields the send-gate reads (a structural subset of
 *  KeyboardEvent so tests need not fabricate a full event). */
export interface SendKeyEvent {
  key: string;
  shiftKey: boolean;
  /** True while an IME composition is in progress (CJK and other composed
   *  input). The browser sets this on the keydown that CONFIRMS the
   *  composition — that Enter must NOT send. */
  isComposing: boolean;
}

/**
 * Enter sends ONLY when it is a plain Enter that is neither confirming an IME
 * composition nor a Shift+Enter newline. This is the single source of truth for
 * "did the user mean to send"; the editor's onKeyDown defers to it.
 */
export function isSendKey(event: SendKeyEvent): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing;
}

/**
 * On a FAILED send, restore the reply target captured when the send began —
 * but ONLY if the user has not picked a newer one in the meantime. A send
 * optimistically clears the reply chip; if the send then fails slowly while the
 * user has already started replying to a DIFFERENT message, blindly restoring
 * the old target would clobber their newer choice.
 *
 * @param captured the reply target at send-time (null if the send had none)
 * @param current  the reply target NOW, at failure-time (null once cleared and
 *                 not re-picked; non-null if the user picked another meanwhile)
 */
export function shouldRestoreReply(captured: Message | null, current: Message | null): boolean {
  // Restore only when the field is empty; any current target (the same message
  // re-picked, or a newer one) is already what the user wants shown.
  return captured !== null && current === null;
}
