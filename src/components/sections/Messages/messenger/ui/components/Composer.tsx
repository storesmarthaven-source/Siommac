// Ported from the bundle (ui/components/Composer.tsx). SIOMAC deltas:
//   • typing is LIVE: input publishes a throttled typing=true broadcast on the
//     active thread (participant-gated private channel); send/clear stops it;
//   • the attach dialog is upload-only: the bundle's "Document Vault" and
//     "Shared media" tabs fabricated demo files and are NOT ported (a real
//     vault picker is its own future slice).
/* eslint-disable react-hooks/immutability, react-hooks/purity --
   The composer's helpers (typing throttle, draft debounce, upload registry,
   contenteditable reads) mutate their own refs and call Date.now exclusively
   from event handlers/effects; the compiler rules cannot prove event-only
   execution for plain component-body functions shared across handlers. */
import { CheckCircle2, FileUp, Link, Send, Smile, Trash2, UploadCloud, X } from "./icons";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Attachment, LinkPreview, Message, MessageDraft } from "../../domain/models";
import { linkPreviewFromUrl, sanitizeComposerHtml } from "../../domain/format";
import { TYPING_REFRESH_MS } from "../../adapters/siomacRealtime";
import { useMessaging } from "../../app/MessagingProvider";
import { AttachmentCard, LinkCard } from "./MessageCards";
import { Dialog } from "./Dialog";

const emojis = ["👍", "✅", "📌", "⚠️", "📄", "💬", "🙂", "🎉", "👀", "🙏", "❤️", "👏"];
const urlPattern = /(?:https?:\/\/|www\.)[^\s<]+/i;
type FormatCommand = "bold" | "italic" | "underline";
// eslint-disable-next-line @typescript-eslint/no-deprecated -- queryCommandState/execCommand remain the ONLY synchronous contenteditable formatting API; no replacement exists
const commandState = (command: FormatCommand) => typeof document.queryCommandState === "function" && document.queryCommandState(command);

export function Composer({ threadId, replyTo, onClearReply, onRestoreReply, onSent }: {
  threadId: string;
  replyTo: Message | null;
  onClearReply: () => void;
  /** Re-arm the reply target after a FAILED send (the optimistic clear already
   *  dismissed it — the user's reply context must not be lost). */
  onRestoreReply: (message: Message) => void;
  onSent: () => void;
}) {
  const { actions } = useMessaging();
  const editorRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploads = useRef(new Map<string, AbortController>());
  const attachmentBaseline = useRef(new Set<string>());
  const [body, setBody] = useState("");
  const [html, setHtml] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [link, setLink] = useState<LinkPreview | undefined>();
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [sending, setSending] = useState(false);
  // Draft persistence (slice 3): last body saved to the server, the pending
  // debounce timer, and a body mirror the unmount/switch flush can read.
  const draftSaved = useRef("");
  const draftTimer = useRef<number | null>(null);
  const bodyRef = useRef("");
  const [attachOpen, setAttachOpen] = useState(false);
  const [activeFormats, setActiveFormats] = useState({ bold: false, italic: false, underline: false });
  const isUploading = attachments.some((attachment) => attachment.transferState !== "available");
  const canSend = (body.trim().length > 0 || attachments.length > 0 || link) && !sending && !isUploading;

  useEffect(() => () => { uploads.current.forEach((controller) => controller.abort()); }, []);

  // Typing broadcast: at most one typing=true per TYPING_REFRESH_MS while the
  // user keeps writing (receivers TTL past the last refresh); a stop is sent on
  // clear/send/unmount/thread-switch so the indicator drops promptly.
  const lastTypingSent = useRef(0);
  const typingActive = useRef(false);
  function publishTyping() {
    const now = Date.now();
    if (now - lastTypingSent.current < TYPING_REFRESH_MS) return;
    lastTypingSent.current = now;
    typingActive.current = true;
    actions.setTyping(threadId, true);
  }
  function stopTyping() {
    if (!typingActive.current) return;
    typingActive.current = false;
    lastTypingSent.current = 0;
    actions.setTyping(threadId, false);
  }
  useEffect(() => stopTyping, [threadId]);   // stop on unmount / thread switch

  // Load the server draft when the thread opens (seed ONLY an empty editor —
  // never clobber text already typed). On switch/unmount, FLUSH any unsaved
  // body to the OLD thread first (last-write-wins per user+thread).
  useEffect(() => {
    let cancelled = false;
    // RESET first: the composer is one instance across threads — without this,
    // text typed in the previous thread stayed visible in (and could be saved
    // against) the newly-opened one.
    setBody(""); setHtml(""); setAttachments([]); setLink(undefined);
    if (editorRef.current) editorRef.current.innerHTML = "";
    void actions.getDraft(threadId).then((draft) => {
      if (cancelled || !draft?.body) return;
      if (bodyRef.current.trim()) return;   // user is already typing
      setBody(draft.body); setHtml(draft.body);
      bodyRef.current = draft.body;
      draftSaved.current = draft.body;
      if (editorRef.current) editorRef.current.textContent = draft.body;
    });
    return () => {
      cancelled = true;
      if (draftTimer.current !== null) { window.clearTimeout(draftTimer.current); draftTimer.current = null; }
      const unsaved = bodyRef.current;
      if (unsaved !== draftSaved.current) {
        void actions.saveDraft(threadId, unsaved.trim() ? unsaved : null, null).catch(() => { /* best-effort */ });
      }
      bodyRef.current = ""; draftSaved.current = "";
    };
  }, [actions, threadId]);

  function scheduleDraftSave(nextBody: string) {
    bodyRef.current = nextBody;
    if (draftTimer.current !== null) window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => {
      draftTimer.current = null;
      if (bodyRef.current === draftSaved.current) return;
      const value = bodyRef.current;
      draftSaved.current = value;
      // Empty body = server-side delete (the API's own semantics).
      void actions.saveDraft(threadId, value.trim() ? value : null, replyTo?.id ?? null).catch(() => { /* best-effort */ });
    }, 800);
  }

  useEffect(() => {
    const update = () => {
      const selection = window.getSelection();
      const editor = editorRef.current;
      if (!editor || !selection?.anchorNode || !editor.contains(selection.anchorNode)) return;
      setActiveFormats({ bold: commandState("bold"), italic: commandState("italic"), underline: commandState("underline") });
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, []);

  function readEditor() {
    const editor = editorRef.current;
    if (!editor) return;
    const cleanHtml = sanitizeComposerHtml(editor.innerHTML).replace(/\u200B/g, "");
    const text = editor.innerText.replace(/\u00A0/g, " ").replace(/\u200B/g, "");
    setBody(text); setHtml(cleanHtml);
    scheduleDraftSave(text);
    if (text.trim()) publishTyping(); else stopTyping();
    const pastedUrl = urlPattern.exec(text)?.[0];
    if (pastedUrl && !link) { try { setLink(linkPreviewFromUrl(pastedUrl)); } catch { /* Invalid URLs remain plain text. */ } }
  }

  function format(command: FormatCommand) {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    editor.focus();
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- see commandState note: no non-deprecated contenteditable formatting API exists
    if (document.execCommand(command, false)) {
      setActiveFormats({ bold: commandState("bold"), italic: commandState("italic"), underline: commandState("underline") });
      readEditor();
      return;
    }
    const wrapper = document.createElement(command === "bold" ? "strong" : command === "italic" ? "em" : "u");
    if (range.collapsed) {
      wrapper.append(document.createTextNode("\u200B"));
      range.insertNode(wrapper);
      range.selectNodeContents(wrapper);
      range.collapse(false);
    } else {
      wrapper.append(range.extractContents());
      range.insertNode(wrapper);
      range.selectNodeContents(wrapper);
    }
    selection.removeAllRanges(); selection.addRange(range);
    readEditor();
  }

  function insertEmoji(emoji: string) {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (range && editor.contains(range.commonAncestorContainer)) {
      range.deleteContents();
      const node = document.createTextNode(emoji);
      range.insertNode(node); range.setStartAfter(node); range.collapse(true);
      selection?.removeAllRanges(); selection?.addRange(range);
    } else editor.append(emoji);
    readEditor(); setEmojiOpen(false);
  }

  function addFiles(files: FileList | File[] | null): void {
    if (!files) return;
    for (const file of Array.from(files)) {
      const draftId = crypto.randomUUID();
      const controller = new AbortController();
      uploads.current.set(draftId, controller);
      const queued: Attachment = { id: draftId, kind: "generic", name: file.name, mimeType: file.type, sizeBytes: file.size, transferState: "queued", progress: 0 };
      setAttachments((current) => [...current, queued]);
      void actions.upload(file, (progress) => {
        setAttachments((current) => current.map((item) => item.id === draftId ? { ...progress, id: draftId } : item));
      }, controller.signal).then((uploaded) => {
        setAttachments((current) => current.map((item) => item.id === draftId ? { ...uploaded } : item));
        uploads.current.delete(draftId);
      }).catch((cause: unknown) => {
        if ((cause as DOMException).name !== "AbortError") {
          setAttachments((current) => current.map((item) => item.id === draftId ? { ...item, transferState: "failed" } : item));
        }
      });
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function removeAttachment(id: string) {
    uploads.current.get(id)?.abort(); uploads.current.delete(id);
    setAttachments((current) => current.filter((item) => item.id !== id));
  }

  function openAttachmentDialog() {
    attachmentBaseline.current = new Set(attachments.map((attachment) => attachment.id));
    setAttachOpen(true);
  }

  function cancelAttachmentDialog() {
    attachments.filter((attachment) => !attachmentBaseline.current.has(attachment.id)).forEach((attachment) => removeAttachment(attachment.id));
    setAttachOpen(false);
  }

  function addLink() {
    try { setLink(linkPreviewFromUrl(linkValue)); setLinkValue(""); setLinkOpen(false); }
    catch { /* Keep the inline field open for correction. */ }
  }

  async function send() {
    if (!canSend) return;
    setSending(true);
    const draft: MessageDraft = {
      body: body.trim(), html: html || body.trim(), attachments,
      ...(replyTo ? { replyToId: replyTo.id } : {}), ...(link ? { link } : {}),
    };
    stopTyping();
    // A send supersedes the draft cycle: cancel the pending debounce so it
    // cannot resurrect the text server-side after the message commits.
    if (draftTimer.current !== null) { window.clearTimeout(draftTimer.current); draftTimer.current = null; }
    // Clear IMMEDIATELY — the optimistic bubble is already in the thread, so
    // the composer must not hold the text through the server round-trip. On
    // failure the draft is restored verbatim (nothing the user typed is lost).
    const restore = { body, html, attachments, link, replyTo };
    setBody(""); setHtml(""); setAttachments([]); setLink(undefined);
    bodyRef.current = "";
    if (editorRef.current) editorRef.current.innerHTML = "";
    onClearReply(); onSent();
    try {
      await actions.send(threadId, draft);
      draftSaved.current = "";   // provider deleted the server draft
    } catch {
      // The provider already removed the pending bubble and toasted the error.
      setBody(restore.body); setHtml(restore.html); setAttachments(restore.attachments); setLink(restore.link);
      if (restore.replyTo) onRestoreReply(restore.replyTo);
      if (editorRef.current) editorRef.current.innerHTML = restore.html || restore.body;
      scheduleDraftSave(restore.body);   // the draft must survive the failure
    } finally { setSending(false); }
  }

  const placeholderVisible = useMemo(() => body.length === 0, [body]);
  return (
    <footer className="sm-composer">
      {replyTo ? <div className="sm-composer__reply"><span><b>Replying to message</b><em>{replyTo.body || replyTo.attachments[0]?.name}</em></span><button className="sm-icon-button" type="button" aria-label="Cancel reply" onClick={onClearReply}><X /></button></div> : null}
      {attachments.length > 0 ? <div className="sm-composer__attachments">{attachments.map((attachment) => <div className="sm-composer__attachment" key={attachment.id}><AttachmentCard attachment={attachment} interactive={false} /><button className="sm-icon-button" type="button" aria-label={`Remove ${attachment.name}`} onClick={() => removeAttachment(attachment.id)}><X /></button></div>)}</div> : null}
      {link ? <div className="sm-composer__link"><LinkCard link={link} /><button className="sm-icon-button" type="button" aria-label="Remove link" onClick={() => setLink(undefined)}><X /></button></div> : null}
      {emojiOpen ? <div className="sm-emoji-popover" role="dialog" aria-label="Choose an emoji">{emojis.map((emoji) => <button type="button" key={emoji} onClick={() => insertEmoji(emoji)}>{emoji}</button>)}</div> : null}
      {linkOpen ? <div className="sm-link-entry"><Link /><input autoFocus type="url" value={linkValue} placeholder="Paste a link" onInput={(event) => setLinkValue(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") addLink(); }} /><button type="button" onClick={addLink}>Add</button></div> : null}
      <div className="sm-composer__surface">
        <div className="sm-composer__tabs"><span>Reply</span></div>
        <div className={`sm-rich-editor-wrap ${placeholderVisible ? "is-empty" : ""}`} data-placeholder="Type your message...">
          {/* isComposing guard: Enter that CONFIRMS an IME composition (CJK and
              other composed input) must not send the half-typed message. */}
          <div ref={editorRef} className="sm-rich-editor" role="textbox" aria-label="Message" aria-multiline="true" contentEditable onInput={readEditor} onPaste={() => window.setTimeout(readEditor)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); void send(); } }} />
        </div>
        <div className="sm-composer__toolbar">
          <span>
            <button className="sm-icon-button" type="button" aria-label="Choose emoji" aria-expanded={emojiOpen} onClick={() => setEmojiOpen((value) => !value)}><Smile /></button>
            <button className={`sm-icon-button sm-format-button ${activeFormats.bold ? "is-active" : ""}`} type="button" aria-label="Bold" aria-pressed={activeFormats.bold} title="Bold" onMouseDown={(event) => event.preventDefault()} onClick={() => format("bold")}><span className="sm-format-glyph is-bold" aria-hidden="true">B</span></button>
            <button className={`sm-icon-button sm-format-button ${activeFormats.italic ? "is-active" : ""}`} type="button" aria-label="Italic" aria-pressed={activeFormats.italic} title="Italic" onMouseDown={(event) => event.preventDefault()} onClick={() => format("italic")}><span className="sm-format-glyph is-italic" aria-hidden="true">I</span></button>
            <button className={`sm-icon-button sm-format-button ${activeFormats.underline ? "is-active" : ""}`} type="button" aria-label="Underline" aria-pressed={activeFormats.underline} title="Underline" onMouseDown={(event) => event.preventDefault()} onClick={() => format("underline")}><span className="sm-format-glyph is-underline" aria-hidden="true">U</span></button>
            <button className="sm-icon-button" type="button" aria-label="Attach files" onClick={openAttachmentDialog}><FileUp /></button>
            <button className="sm-icon-button" type="button" aria-label="Insert link" aria-expanded={linkOpen} onClick={() => setLinkOpen((value) => !value)}><Link /></button>
          </span>
          <button className="sm-send-button" type="button" disabled={!canSend} aria-label={isUploading ? "Wait for uploads to finish" : "Send message"} onClick={() => void send()}><Send /></button>
        </div>
      </div>
      <Dialog open={attachOpen} title="Attach files" description="Upload files from your device." icon={<UploadCloud />} onClose={cancelAttachmentDialog}>
        <div className="sm-attach-dialog">
          <button className="sm-upload-dropzone" type="button" onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (event.dataTransfer) addFiles(event.dataTransfer.files); }}><span><FileUp /></span><strong>Drop files here or browse from device</strong><small>Documents, archives, images, video, audio, HTML, CSS, or JSON up to 25 MB.</small></button>
          <input ref={inputRef} hidden type="file" multiple accept="image/*,video/*,audio/*,.pdf,.zip,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.html,.htm,.css,.txt,.md,.json" onChange={(event) => addFiles(event.currentTarget.files)} />
          {attachments.length ? <div className="sm-attach-queue" aria-label="Selected files">{attachments.map((attachment) => <article key={attachment.id}><span className={`sm-file-chip sm-file-chip--${attachment.kind}`}>{attachment.name.split(".").pop()?.toUpperCase()}</span><div><strong>{attachment.name}</strong><small>{attachment.transferState === "available" ? "Ready to attach" : attachment.transferState === "failed" ? "Upload failed" : `Uploading ${attachment.progress}%`}</small>{attachment.transferState !== "available" && attachment.transferState !== "failed" ? <span className="sm-attach-progress"><i style={{ width: `${attachment.progress}%` }} /></span> : null}</div><button className="sm-icon-button" type="button" aria-label={`Remove ${attachment.name}`} onClick={() => removeAttachment(attachment.id)}><Trash2 /></button></article>)}</div> : <p className="sm-attach-empty">No files selected.</p>}
          <footer className="sm-attach-footer"><button type="button" onClick={cancelAttachmentDialog}>Cancel</button><button type="button" disabled={!attachments.length || isUploading} onClick={() => setAttachOpen(false)}><CheckCircle2 />{isUploading ? "Uploading..." : attachments.length ? `Attach ${attachments.length} selected` : "Attach selected"}</button></footer>
        </div>
      </Dialog>
    </footer>
  );
}
