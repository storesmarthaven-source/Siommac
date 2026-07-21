import { describe, expect, it } from "vitest";
import type { Message } from "../../domain/models";
import { isSendKey, shouldRestoreReply, canSendInMode, swapModeText } from "./composerLogic";

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

describe("canSendInMode — an internal note is text-only; a reply is not", () => {
  const base = { hasAttachments: false, hasLink: false, sending: false, uploading: false };

  it("note enables purely on non-blank text", () => {
    expect(canSendInMode({ ...base, mode: "note", text: "hi" })).toBe(true);
    expect(canSendInMode({ ...base, mode: "note", text: "   " })).toBe(false);
    expect(canSendInMode({ ...base, mode: "note", text: "" })).toBe(false);
  });

  it("note IGNORES attachments/links/uploads (they are hidden in note mode)", () => {
    // An empty note with an orphaned attachment/upload flag still cannot send…
    expect(canSendInMode({ ...base, mode: "note", text: "", hasAttachments: true, hasLink: true })).toBe(false);
    // …and a text note is not blocked by an in-flight upload the way a reply is.
    expect(canSendInMode({ ...base, mode: "note", text: "note", uploading: true })).toBe(true);
  });

  it("reply enables on text OR an attachment OR a link", () => {
    expect(canSendInMode({ ...base, mode: "reply", text: "hi" })).toBe(true);
    expect(canSendInMode({ ...base, mode: "reply", text: "", hasAttachments: true })).toBe(true);
    expect(canSendInMode({ ...base, mode: "reply", text: "", hasLink: true })).toBe(true);
    expect(canSendInMode({ ...base, mode: "reply", text: "" })).toBe(false);
  });

  it("reply is blocked while an upload is in flight; a send in progress blocks both", () => {
    expect(canSendInMode({ ...base, mode: "reply", text: "hi", uploading: true })).toBe(false);
    expect(canSendInMode({ ...base, mode: "reply", text: "hi", sending: true })).toBe(false);
    expect(canSendInMode({ ...base, mode: "note", text: "hi", sending: true })).toBe(false);
  });
});

describe("swapModeText — switching modes preserves each draft independently", () => {
  it("stashes the source text and restores the destination's stashed text", () => {
    // Reply half-written, detour to note.
    const s1 = swapModeText("reply", "note", "half reply", { reply: "", note: "" });
    expect(s1.text).toBe("");                                  // note starts empty
    expect(s1.stash).toEqual({ reply: "half reply", note: "" });

    // Type a note, then go back to reply — the reply text is recovered intact.
    const s2 = swapModeText("note", "reply", "a private note", s1.stash);
    expect(s2.text).toBe("half reply");                        // reply restored
    expect(s2.stash).toEqual({ reply: "half reply", note: "a private note" });

    // Flip to the note again — the note text is recovered too.
    const s3 = swapModeText("reply", "note", "half reply", s2.stash);
    expect(s3.text).toBe("a private note");
  });

  it("does not mutate the caller's stash object", () => {
    const stash = { reply: "keep", note: "" };
    swapModeText("reply", "note", "changed", stash);
    expect(stash).toEqual({ reply: "keep", note: "" });        // original untouched
  });
});
