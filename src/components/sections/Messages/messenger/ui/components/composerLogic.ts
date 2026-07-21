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

/** Composer input mode: an ordinary reply, or an author-only internal note. */
export type ComposerMode = "reply" | "note";

export interface SendGateInput {
  mode: ComposerMode;
  /** Current editor text. */
  text: string;
  /** Reply-only affordances — an internal note is text-only and ignores both. */
  hasAttachments: boolean;
  hasLink: boolean;
  /** A send is already in flight. */
  sending: boolean;
  /** An attachment upload is still in progress (blocks a reply, irrelevant to a note). */
  uploading: boolean;
}

/**
 * Whether the Send control is enabled. An internal note is text-only: it enables
 * purely on non-blank text and ignores attachments/links/uploads (they are hidden
 * in note mode). A reply also enables on an attachment or link, but is blocked
 * while an upload is still in flight. Neither sends while a send is in progress.
 */
export function canSendInMode(i: SendGateInput): boolean {
  if (i.sending) return false;
  const hasText = i.text.trim().length > 0;
  if (i.mode === "note") return hasText;
  return (hasText || i.hasAttachments || i.hasLink) && !i.uploading;
}

export interface ModeStash { reply: string; note: string }
export interface ModeSwap {
  /** Text to load into the editor for the destination mode. */
  text: string;
  /** The stash after saving the source-mode text. */
  stash: ModeStash;
}

/**
 * Switch composer mode WITHOUT losing either draft. The source mode's current
 * text is stashed and the destination mode's previously-stashed text is restored,
 * so a half-written reply survives a detour into an internal note and vice-versa.
 */
export function swapModeText(
  from: ComposerMode, to: ComposerMode, currentText: string, stash: ModeStash,
): ModeSwap {
  const next: ModeStash = { ...stash, [from]: currentText };
  return { text: next[to], stash: next };
}
