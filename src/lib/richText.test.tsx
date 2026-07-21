import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/preact';
import { sanitizeRichHtml, renderRichHtml, looksLikeHtml } from './richText';

describe('sanitizeRichHtml — keeps the safe rich subset, strips everything else', () => {
  it('keeps inline marks, links, headings, paragraphs and lists', () => {
    const out = sanitizeRichHtml(
      '<h3>Title</h3><p>a <strong>b</strong> <em>c</em> <u>d</u></p><ul><li>one</li></ul><ol><li>two</li></ol>',
    );
    expect(out).toContain('<h3>Title</h3>');
    expect(out).toContain('<strong>b</strong>');
    expect(out).toContain('<em>c</em>');
    expect(out).toContain('<u>d</u>');
    expect(out).toContain('<ul><li>one</li></ul>');
    expect(out).toContain('<ol><li>two</li></ol>');
  });

  it('drops <script> and event-handler attributes but keeps the text', () => {
    const out = sanitizeRichHtml('<p onclick="steal()">hi</p><script>evil()</script>');
    expect(out).toBe('<p>hi</p>');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('script');
  });

  it('unwraps disallowed elements, preserving their text content', () => {
    expect(sanitizeRichHtml('<span style="color:red">x</span><table><tr><td>y</td></tr></table>'))
      .toBe('xy');
  });

  it('keeps only a whitelisted text-align on block elements', () => {
    expect(sanitizeRichHtml('<p style="text-align:center">c</p>')).toBe('<p style="text-align: center">c</p>');
    // A non-align style is discarded entirely.
    expect(sanitizeRichHtml('<p style="color:red;position:fixed">c</p>')).toBe('<p>c</p>');
    // An out-of-range alignment value is rejected.
    expect(sanitizeRichHtml('<p style="text-align:inherit">c</p>')).toBe('<p>c</p>');
    // Legacy align attribute is normalized to a style.
    expect(sanitizeRichHtml('<p align="right">c</p>')).toBe('<p style="text-align: right">c</p>');
  });

  it('keeps only safe http/https/mailto links and forces safe rel/target', () => {
    const ok = sanitizeRichHtml('<a href="https://siomac.test/x">link</a>');
    expect(ok).toContain('href="https://siomac.test/x"');
    expect(ok).toContain('rel="noreferrer"');
    expect(ok).toContain('target="_blank"');
    // javascript: URL is rejected — the anchor is unwrapped to plain text.
    expect(sanitizeRichHtml('<a href="javascript:alert(1)">x</a>')).toBe('x');
  });
});

describe('renderRichHtml — renders the subset as real nodes (no innerHTML)', () => {
  it('renders headings, lists and marks, and re-sanitizes unsafe input', () => {
    const { container } = render(
      <div>{renderRichHtml('<h3>H</h3><ul><li><strong>b</strong></li></ul><script>x()</script>')}</div>,
    );
    expect(container.querySelector('h3')?.textContent).toBe('H');
    expect(container.querySelector('ul li strong')?.textContent).toBe('b');
    expect(container.querySelector('script')).toBeNull();
  });

  it('applies a whitelisted alignment as an inline style', () => {
    const { container } = render(<div>{renderRichHtml('<p style="text-align:center">c</p>')}</div>);
    expect((container.querySelector('p') as HTMLElement).style.textAlign).toBe('center');
  });
});

describe('looksLikeHtml — distinguishes rich HTML from plain / legacy markdown', () => {
  it('is true for rich-text HTML', () => {
    expect(looksLikeHtml('<p>hi</p>')).toBe(true);
    expect(looksLikeHtml('a <strong>b</strong>')).toBe(true);
    expect(looksLikeHtml('<ul><li>x</li></ul>')).toBe(true);
  });

  it('is false for plain text and the legacy markdown format', () => {
    expect(looksLikeHtml('just text')).toBe(false);
    expect(looksLikeHtml('**bold** and _italic_')).toBe(false);
    expect(looksLikeHtml('- one\n- two')).toBe(false);
    expect(looksLikeHtml('[label](https://x.test)')).toBe(false);
  });
});
