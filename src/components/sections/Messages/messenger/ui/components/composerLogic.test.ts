import { describe, expect, it } from "vitest";
import type { Message } from "../../domain/models";
import { isSendKey, shouldRestoreReply } from "./composerLogic";

// Reply targets are compared by reference/nullness only, so a minimal stub is
// sufficient — the guard never reads message fields.
const msg = (id: string): Message => ({ id } as Message);

describe("isSendKey — Enter sends only when it is a plain, non-IME Enter", () => {
  it("plain Enter sends", () => {
    expect(isSendKey({ key: "Enter", shiftKey: false, isComposing: false })).toBe(true);
  });

  it("Shift+Enter does NOT send (it inserts a newline)", () => {
    expect(isSendKey({ key: "Enter", shiftKey: true, isComposing: false })).toBe(false);
  });

  it("Enter that CONFIRMS an IME composition does NOT send", () => {
    expect(isSendKey({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
  });

  it("non-Enter keys never send", () => {
    expect(isSendKey({ key: "a", shiftKey: false, isComposing: false })).toBe(false);
    expect(isSendKey({ key: "Tab", shiftKey: false, isComposing: false })).toBe(false);
  });

  it("composition sequence: every Enter while composing is suppressed, the Enter after commit sends", () => {
    // Models a CJK sequence: keystrokes carry isComposing=true until the IME
    // commits, after which a plain Enter finally sends. (Browser-level: the UA
    // sets isComposing between compositionstart/compositionend — that flag's
    // wiring is verified in a manual browser pass, see the release evidence;
    // jsdom does not auto-set it, so we assert the decision, not the flag.)
    const composing = [true, true, true].map((c) => isSendKey({ key: "Enter", shiftKey: false, isComposing: c }));
    expect(composing).toEqual([false, false, false]);
    expect(isSendKey({ key: "Enter", shiftKey: false, isComposing: false })).toBe(true);
  });
});

describe("shouldRestoreReply — a failed send must not clobber a newer reply target", () => {
  const a = msg("MSG-A");
  const b = msg("MSG-B");

  it("restores the captured target when the field is still empty (normal failure)", () => {
    expect(shouldRestoreReply(a, null)).toBe(true);
  });

  it("does NOT restore when the user picked a DIFFERENT target meanwhile (the race)", () => {
    expect(shouldRestoreReply(a, b)).toBe(false);
  });

  it("does NOT restore when the same target was re-picked (already shown)", () => {
    expect(shouldRestoreReply(a, a)).toBe(false);
  });

  it("nothing to restore when the send had no reply target", () => {
    expect(shouldRestoreReply(null, null)).toBe(false);
    expect(shouldRestoreReply(null, b)).toBe(false);
  });
});
