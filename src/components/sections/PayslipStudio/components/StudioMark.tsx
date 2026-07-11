import { type VNode } from 'preact';

/**
 * Payslip Studio logo mark — a custom, purpose-built glyph (NOT the app's shared
 * "AI sparkle"). Reads as a payslip: a document with a folded corner, a couple of
 * text rows, and a highlighted "net pay" total bar. Single-colour (currentColor)
 * so it inherits the surrounding theme (white on the dark toolbar / loading badge).
 * Shared by the toolbar and the loading page so the brand is consistent.
 */
export function StudioMark({ class: cls }: { class?: string }): VNode {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* document body + folded top-right corner */}
      <path
        d="M13.4 2.75H6.75A2 2 0 0 0 4.75 4.75v14.5a2 2 0 0 0 2 2h10.5a2 2 0 0 0 2-2V8.75z"
        fill="currentColor" opacity="0.16"
      />
      <path
        d="M13.4 2.75H6.75A2 2 0 0 0 4.75 4.75v14.5a2 2 0 0 0 2 2h10.5a2 2 0 0 0 2-2V8.75l-5.85-6z"
        stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"
      />
      <path d="M13.2 2.9V8.9h5.85" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
      {/* earnings row */}
      <path d="M8.1 12.4h7.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
      {/* net-pay total bar (the accent) */}
      <rect x="8.1" y="15.1" width="7.8" height="2.7" rx="1.35" fill="currentColor" />
    </svg>
  );
}
