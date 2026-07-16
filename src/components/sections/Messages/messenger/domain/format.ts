// Ported verbatim from the Messenger port bundle (src/domain/format.ts).
// Pure presentation helpers used by the UI + the attachment adapter.
import type { AttachmentKind } from "./models";

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function formatRelativeTime(value: string): string {
  const delta = Date.now() - new Date(value).getTime();
  if (delta < 60_000) return "Now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  return `${Math.floor(delta / 86_400_000)}d`;
}

export function attachmentKind(fileName: string): AttachmentKind {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "pdf") return "pdf";
  if (["zip", "rar", "7z"].includes(extension)) return "zip";
  if (["doc", "docx"].includes(extension)) return "word";
  if (["xls", "xlsx", "csv"].includes(extension)) return "excel";
  if (["ppt", "pptx"].includes(extension)) return "powerpoint";
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(extension)) return "image";
  if (["mp4", "mov", "avi", "webm"].includes(extension)) return "video";
  if (["mp3", "wav", "aac", "m4a"].includes(extension)) return "audio";
  if (["html", "htm"].includes(extension)) return "html";
  if (extension === "css") return "css";
  if (extension === "json") return "json";
  if (["txt", "md"].includes(extension)) return "text";
  return "generic";
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

export function renderComposerMarkup(value: string): string {
  const escaped = escapeHtml(value);
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/\n/g, "<br>");
}

export function sanitizeComposerHtml(value: string): string {
  const documentNode = new DOMParser().parseFromString(`<div>${value}</div>`, "text/html");
  const root = documentNode.body.firstElementChild;
  if (!root) return "";
  const allowed = new Set(["STRONG", "B", "EM", "I", "U", "BR", "A"]);
  Array.from(root.querySelectorAll("*")).forEach((element) => {
    if (!allowed.has(element.tagName)) { element.replaceWith(...Array.from(element.childNodes)); return; }
    Array.from(element.attributes).forEach((attribute) => element.removeAttribute(attribute.name));
    if (element.tagName === "A") {
      const raw = (element.textContent ?? "").trim();
      if (/^https?:\/\//i.test(raw)) { element.setAttribute("href", raw); element.setAttribute("target", "_blank"); element.setAttribute("rel", "noreferrer"); }
      else element.replaceWith(...Array.from(element.childNodes));
    }
  });
  return root.innerHTML;
}

export function linkPreviewFromUrl(raw: string) {
  const value = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(value);
  const segment = url.pathname.split("/").filter(Boolean).at(-1)?.replace(/[-_]/g, " ");
  return {
    url: url.toString(),
    hostname: url.hostname.replace(/^www\./, ""),
    title: segment ? segment.replace(/\b\w/g, (letter) => letter.toUpperCase()) : url.hostname,
    description: "Open this link to view the referenced SIOMAC resource.",
  };
}
