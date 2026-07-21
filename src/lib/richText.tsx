// Shared rich-text layer for note/message editors (Messenger + Ticket Center).
//
// One sanitizer + one renderer + one legacy detector, so both surfaces store and
// display the SAME safe subset of HTML: bold / italic / underline, links,
// headings, paragraphs, bulleted + numbered lists, and block text-alignment
// (left / center / right / justify). contentEditable + document.execCommand
// produce this HTML directly; we sanitize it on the way in (compose) and again
// on the way out (render) — defence in depth against a poisoned stored body.
//
// Storage format is sanitized HTML. The Ticket Center historically stored a
// markdown-ish string; `looksLikeHtml()` lets its renderer fall back to the
// legacy markdown parser for pre-existing rows without rewriting stored data.
import type { ComponentChildren, VNode } from 'preact';

// ── Allow-list ──────────────────────────────────────────────────────────────
const INLINE_TAGS = new Set(['STRONG', 'B', 'EM', 'I', 'U', 'BR', 'A']);
const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'UL', 'OL', 'LI']);
// Removed entirely (element AND text), never unwrapped — unwrapping would leak
// their raw text (e.g. a <script> body) into the sanitized output.
const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED']);
const ALIGNABLE = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'LI']);
const ALIGN_VALUES = new Set(['left', 'center', 'right', 'justify']);

function isSafeHref(value: string): boolean {
  return /^(https?:|mailto:)/i.test(value.trim());
}

/** The single safe text-align for a block element, or null. Reads either the
 *  inline `text-align` style (styleWithCSS execCommand) or a legacy `align`
 *  attribute, and only ever returns a value from the fixed allow-list. */
function alignOf(element: Element): string | null {
  const styleAlign = element.getAttribute('style')?.match(/text-align\s*:\s*(left|center|right|justify)/i)?.[1];
  const attrAlign = element.getAttribute('align');
  const value = (styleAlign ?? attrAlign ?? '').toLowerCase();
  return ALIGN_VALUES.has(value) ? value : null;
}

/** The link target for an <a>: its href, or its text when the editor produced a
 *  bare-URL link with no href. Validated by the caller via isSafeHref. */
function hrefOf(element: Element): string {
  const href = (element.getAttribute('href') ?? '').trim();
  // Element.textContent is a string (only Document/DocType nodes return null),
  // so no nullish guard is needed here.
  return href || element.textContent.trim();
}

function parse(html: string): Element | null {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  return doc.body.firstElementChild;
}

// ── Sanitize (compose-side, before persisting) ──────────────────────────────
/**
 * Reduce arbitrary editor HTML to the safe rich-text subset. Disallowed
 * elements are unwrapped (their text is kept), every attribute is stripped
 * except a validated `href`/`target`/`rel` on <a> and a single normalized
 * `text-align` style on block elements. Returns sanitized innerHTML.
 */
export function sanitizeRichHtml(html: string): string {
  const root = parse(html);
  if (!root) return '';
  // Snapshot first: removing/unwrapping mutates the live tree as we iterate.
  Array.from(root.querySelectorAll('*')).forEach((element) => {
    if (!element.isConnected) return;   // already removed with a dropped ancestor
    const tag = element.tagName;
    if (DROP_TAGS.has(tag)) { element.remove(); return; }
    if (!INLINE_TAGS.has(tag) && !BLOCK_TAGS.has(tag)) {
      element.replaceWith(...Array.from(element.childNodes));
      return;
    }
    // Capture href/alignment BEFORE stripping attributes (the strip would erase them).
    const align = ALIGNABLE.has(tag) ? alignOf(element) : null;
    const href = tag === 'A' ? hrefOf(element) : '';
    Array.from(element.attributes).forEach((attribute) => element.removeAttribute(attribute.name));
    if (tag === 'A') {
      if (isSafeHref(href)) {
        element.setAttribute('href', href);
        element.setAttribute('target', '_blank');
        element.setAttribute('rel', 'noreferrer');
      } else {
        element.replaceWith(...Array.from(element.childNodes));
      }
      return;
    }
    if (align) element.setAttribute('style', `text-align: ${align}`);
  });
  return root.innerHTML;
}

// ── Render (read-side, before display) ──────────────────────────────────────
function renderNode(node: Node, key: number): ComponentChildren {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (!(node instanceof Element)) return null;
  const children = Array.from(node.childNodes).map((child, index) => renderNode(child, index));
  const tag = node.tagName;
  if (tag === 'STRONG' || tag === 'B') return <strong key={key}>{children}</strong>;
  if (tag === 'EM' || tag === 'I') return <em key={key}>{children}</em>;
  if (tag === 'U') return <u key={key}>{children}</u>;
  if (tag === 'BR') return <br key={key} />;
  if (tag === 'A') {
    const href = node.getAttribute('href') ?? '';
    return isSafeHref(href) ? <a key={key} href={href} target="_blank" rel="noreferrer">{children}</a> : <>{children}</>;
  }
  const align = ALIGNABLE.has(tag) ? alignOf(node) : null;
  const style = align ? { textAlign: align as 'left' | 'center' | 'right' | 'justify' } : undefined;
  if (tag === 'H1') return <h1 key={key} style={style}>{children}</h1>;
  if (tag === 'H2') return <h2 key={key} style={style}>{children}</h2>;
  if (tag === 'H3') return <h3 key={key} style={style}>{children}</h3>;
  if (tag === 'UL') return <ul key={key}>{children}</ul>;
  if (tag === 'OL') return <ol key={key}>{children}</ol>;
  if (tag === 'LI') return <li key={key} style={style}>{children}</li>;
  if (tag === 'P' || tag === 'DIV') return <p key={key} style={style}>{children}</p>;
  return <>{children}</>;
}

/** Render a sanitized rich-text HTML string to Preact nodes (no innerHTML). The
 *  input is re-sanitized here too, so a stored body that bypassed the composer
 *  cannot inject unsafe markup. */
export function renderRichHtml(html: string): VNode {
  const root = parse(sanitizeRichHtml(html));
  return <>{root ? Array.from(root.childNodes).map((node, index) => renderNode(node, index)) : null}</>;
}

/** True when a stored body is HTML (this rich-text format) rather than plain
 *  text or the Ticket Center's legacy markdown. Used to pick the renderer. */
export function looksLikeHtml(value: string): boolean {
  return /<\/?(strong|b|em|i|u|br|a|p|div|h[1-3]|ul|ol|li)\b[^>]*>/i.test(value);
}
