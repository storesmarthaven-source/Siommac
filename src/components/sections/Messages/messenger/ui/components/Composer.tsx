// Ported from the bundle (ui/components/Composer.tsx). SIOMAC deltas:
//   • typing indicators removed (hidden feature — nothing is published);
//   • the attach dialog is upload-only: the bundle's "Document Vault" and
//     "Shared media" tabs fabricated demo files and are NOT ported (a real
//     vault picker is its own future slice).
import { CheckCircle2, FileUp, Link, Send, Smile, Trash2, UploadCloud, X } from "./icons";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Attachment, LinkPreview, Message, MessageDraft } from "../../domain/models";
import { linkPreviewFromUrl, sanitizeComposerHtml } from "../../domain/format";
import { useMessaging } from "../../app/MessagingProvider";
import { AttachmentCard, LinkCard } from "./MessageCards";
import { Dialog } from "./Dialog";

const emojis = ["👍", "✅", "📌", "⚠️", "📄", "💬", "🙂", "🎉", "👀", "🙏", "❤️", "👏"];
const urlPattern = /(?:https?:\/\/|www\.)[^\s<]+/i;
type FormatCommand = "bold" | "italic" | "underline";
const commandState = (command: FormatCommand) => typeof document.queryCommandState === "function" && document.queryCommandState(command);

export function Composer({ threadId, replyTo, onClearReply, onSent }: {
  threadId: string;
  replyTo: Message | null;
  onClearReply(): void;
  onSent(): void;
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
  const [attachOpen, setAttachOpen] = useState(false);
  const [activeFormats, setActiveFormats] = useState({ bold: false, italic: false, underline: false });
  const isUploading = attachments.some((attachment) => attachment.transferState !== "available");
  const canSend = (body.trim().length > 0 || attachments.length > 0 || link) && !sending && !isUploading;

  useEffect(() => () => { uploads.current.forEach((controller) => controller.abort()); }, []);

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
    const cleanHtml = sanitizeComposerHtml(editor.innerHTML).replace(/​/g, "");
    const text = (editor.innerText ?? editor.textContent ?? "").replace(/ /g, " ").replace(/​/g, "");
    setBody(text); setHtml(cleanHtml);
    const pastedUrl = text.match(urlPattern)?.[0];
    if (pastedUrl && !link) { try { setLink(linkPreviewFromUrl(pastedUrl)); } catch { /* Invalid URLs remain plain text. */ } }
  }

  function format(command: FormatCommand) {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    editor.focus();
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    if (document.execCommand(command, false)) {
      setActiveFormats({ bold: commandState("bold"), italic: commandState("italic"), underline: commandState("underline") });
      readEditor();
      return;
    }
    const wrapper = document.createElement(command === "bold" ? "strong" : command === "italic" ? "em" : "u");
    if (range.collapsed) {
      wrapper.append(document.createTextNode("​"));
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

  async function addFiles(files: FileList | File[] | null) {
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
      }).catch((cause) => {
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
    try {
      await actions.send(threadId, draft);
      setBody(""); setHtml(""); setAttachments([]); setLink(undefined);
      if (editorRef.current) editorRef.current.innerHTML = "";
      onClearReply(); onSent();
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
          <div ref={editorRef} className="sm-rich-editor" role="textbox" aria-label="Message" aria-multiline="true" contentEditable onInput={readEditor} onPaste={() => window.setTimeout(readEditor)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} />
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
          <button className="sm-upload-dropzone" type="button" onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (event.dataTransfer) void addFiles(event.dataTransfer.files); }}><span><FileUp /></span><strong>Drop files here or browse from device</strong><small>Documents, archives, images, video, audio, HTML, CSS, or JSON up to 25 MB.</small></button>
          <input ref={inputRef} hidden type="file" multiple accept="image/*,video/*,audio/*,.pdf,.zip,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.html,.htm,.css,.txt,.md,.json" onChange={(event) => void addFiles(event.currentTarget.files)} />
          {attachments.length ? <div className="sm-attach-queue" aria-label="Selected files">{attachments.map((attachment) => <article key={attachment.id}><span className={`sm-file-chip sm-file-chip--${attachment.kind}`}>{attachment.name.split(".").pop()?.toUpperCase()}</span><div><strong>{attachment.name}</strong><small>{attachment.transferState === "available" ? "Ready to attach" : attachment.transferState === "failed" ? "Upload failed" : `Uploading ${attachment.progress}%`}</small>{attachment.transferState !== "available" && attachment.transferState !== "failed" ? <span className="sm-attach-progress"><i style={{ width: `${attachment.progress}%` }} /></span> : null}</div><button className="sm-icon-button" type="button" aria-label={`Remove ${attachment.name}`} onClick={() => removeAttachment(attachment.id)}><Trash2 /></button></article>)}</div> : <p className="sm-attach-empty">No files selected.</p>}
          <footer className="sm-attach-footer"><button type="button" onClick={cancelAttachmentDialog}>Cancel</button><button type="button" disabled={!attachments.length || isUploading} onClick={() => setAttachOpen(false)}><CheckCircle2 />{isUploading ? "Uploading..." : attachments.length ? `Attach ${attachments.length} selected` : "Attach selected"}</button></footer>
        </div>
      </Dialog>
    </footer>
  );
}
