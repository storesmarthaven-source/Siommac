import { type VNode } from 'preact';

/**
 * Payslip Studio logo mark — a custom, purpose-built glyph (NOT the app's shared
 * "AI sparkle"). A payslip document (folded corner, an earnings row and a bold
 * "net pay" total bar) with a paintbrush laid diagonally across the top-right —
 * payslip + studio. Single-colour (currentColor) so it inherits the surrounding
 * theme (white on the dark toolbar / loading badge). Shared by the toolbar and
 * the loading page so the brand stays consistent.
 */
export function StudioMark({ class: cls }: { class?: string }): VNode {
  return (
    <svg class={cls} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      {/* document body (soft fill) */}
      <path
        d="M13.4 2.75H6.75A2 2 0 0 0 4.75 4.75v14.5a2 2 0 0 0 2 2h10.5a2 2 0 0 0 2-2V8.75z"
        fill="currentColor" opacity="0.15"
      />
      <path
        d="M13.4 2.75H6.75A2 2 0 0 0 4.75 4.75v14.5a2 2 0 0 0 2 2h10.5a2 2 0 0 0 2-2V8.75l-6.85-6z"
        stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"
      />
      {/* earnings row + net-pay total bar */}
      <path d="M8 12.35h6.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
      <rect x="8" y="15.05" width="6.1" height="2.6" rx="1.3" fill="currentColor" />
      {/* paintbrush across the top-right — handle, ferrule, bristle tip */}
      <path
        d="M21.1 3.05a1.5 1.5 0 0 1 0 2.12l-5.03 5.03-2.12-2.12 5.03-5.03a1.5 1.5 0 0 1 2.12 0z"
        fill="currentColor"
      />
      <path d="M13.6 8.35l2.12 2.12-.83.83a1.5 1.5 0 0 1-2.12-2.12z" fill="currentColor" opacity="0.85" />
      <path
        d="M12.68 9.9c-1.02 1.02-1.16 2.86-1.2 3.72 .86-.04 2.7-.18 3.72-1.2z"
        fill="currentColor"
      />
    </svg>
  );
}
