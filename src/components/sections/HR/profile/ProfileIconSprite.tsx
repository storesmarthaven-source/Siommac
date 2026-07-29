/**
 * ProfileIconSprite — the LOCKED mockups' icon sprite, reproduced verbatim.
 *
 * Both employee-profile mockups reference their icons as
 * `<svg class="icon"><use href="#i-name"/></svg>` against an inline `<symbol>`
 * sheet. The symbols ARE the Lucide glyphs the spec calls for; reproducing the
 * sheet exactly is what makes the rendered geometry identical to the reference,
 * where re-drawing the same icons through a component wrapper would change
 * stroke width, viewBox and optical size.
 *
 * The sheet is emitted ONCE per surface. `.icon` in the ported stylesheet sets
 * `fill:none; stroke:currentColor; stroke-width:1.85`, so the symbols carry
 * geometry only and inherit colour from their container — which is why icons
 * centre themselves in their containers with no per-icon offset.
 *
 * Do not add, rename or restyle a symbol here: this file is a transcription of
 * a locked reference, and the mockups are the acceptance baseline.
 */
import type { VNode } from 'preact';

/** Every icon id the two locked profile mockups reference. */
export type ProfileIconId =
  | 'more' | 'close' | 'sun' | 'briefcase' | 'building' | 'shield' | 'clock'
  | 'calendar' | 'pin' | 'chevron' | 'bell' | 'alert' | 'file' | 'folder'
  | 'user' | 'mail' | 'phone' | 'mobile' | 'lock' | 'key' | 'headset'
  | 'check' | 'login';

/**
 * Render one sprite reference.
 *
 * `class="icon"` is the mockup's own sizing hook — callers add extra classes
 * only where the reference does (e.g. `doc-file-icon`).
 */
export function Icon({ id, class: className }: { id: ProfileIconId; class?: string }): VNode {
  return (
    <svg class={className ? `icon ${className}` : 'icon'} aria-hidden="true">
      <use href={`#i-${id}`} />
    </svg>
  );
}

/**
 * The symbol sheet plus the readiness gauge gradient.
 *
 * Rendered inside the profile root so the whole block unmounts with the surface
 * and cannot leak ids into the rest of the application.
 */
export function ProfileIconSprite(): VNode {
  return (
    <svg aria-hidden="true" width="0" height="0" style="position:absolute">
      <defs>
        <linearGradient id="readiness-gradient" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#d84b3f" />
          <stop offset=".52" stop-color="#e8a11c" />
          <stop offset="1" stop-color="#23a566" />
        </linearGradient>
        <symbol id="i-more" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></symbol>
        <symbol id="i-close" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18" /></symbol>
        <symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></symbol>
        <symbol id="i-briefcase" viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2" /></symbol>
        <symbol id="i-building" viewBox="0 0 24 24"><path d="M4 21V3h12v18M16 9h4v12M8 7h4M8 11h4M8 15h4M2 21h20" /></symbol>
        <symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-5" /></symbol>
        <symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></symbol>
        <symbol id="i-calendar" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></symbol>
        <symbol id="i-pin" viewBox="0 0 24 24"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2" /></symbol>
        <symbol id="i-chevron" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></symbol>
        <symbol id="i-bell" viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></symbol>
        <symbol id="i-alert" viewBox="0 0 24 24"><path d="M10.3 3.5 2.4 18a2 2 0 0 0 1.8 3h15.6a2 2 0 0 0 1.8-3L13.7 3.5a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></symbol>
        <symbol id="i-file" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6" /></symbol>
        <symbol id="i-folder" viewBox="0 0 24 24"><path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></symbol>
        <symbol id="i-user" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" /><path d="M4 22a8 8 0 0 1 16 0" /></symbol>
        <symbol id="i-mail" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></symbol>
        <symbol id="i-phone" viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.4 2.1L8 9.7a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.7.5 2.6.6a2 2 0 0 1 2 2.3Z" /></symbol>
        <symbol id="i-mobile" viewBox="0 0 24 24"><rect x="6" y="2" width="12" height="20" rx="2" /><path d="M11 18h2" /></symbol>
        <symbol id="i-lock" viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></symbol>
        <symbol id="i-key" viewBox="0 0 24 24"><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9m-3 3 3 3m-6 0 3 3" /></symbol>
        <symbol id="i-headset" viewBox="0 0 24 24"><path d="M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H5a1 1 0 0 1-1-1v-5ZM20 14h-3v6h2a1 1 0 0 0 1-1v-5Z" /></symbol>
        <symbol id="i-check" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></symbol>
        <symbol id="i-login" viewBox="0 0 24 24"><path d="M10 17l5-5-5-5M15 12H3M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /></symbol>
      </defs>
    </svg>
  );
}
