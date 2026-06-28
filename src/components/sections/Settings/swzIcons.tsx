/**
 * src/components/sections/Settings/swzIcons.tsx
 *
 * Inline Lucide-style SVG icons ported verbatim from the "Enterprise Clean v5"
 * Settings design — used for the module header (.module-icon) and per-card icons
 * (.card-icon). Sized by CSS (settingsV2.css), so the SVGs carry no width/height.
 */
import { type VNode } from 'preact';

export const SWZ_ICONS: Record<string, string> = {
  USER:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/></svg>',
  BUILDING:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/></svg>',
  CLOCK:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></svg>',
  LAYOUT:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>',
  PEOPLE:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/></svg>',
  GRAD:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m22 10-10-5-10 5 10 5 10-5Z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/></svg>',
  PERMIT:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M8 2v4M16 2v4"/><rect x="4" y="4" width="16" height="18" rx="2"/><path d="M8 12h8M8 16h5"/></svg>',
  FLASK:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M10 2v6L4 20a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2L14 8V2"/><path d="M8 2h8"/></svg>',
  ALERT:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m12 2 10 18H2L12 2Z"/><path d="M12 8v5"/><path d="M12 17h.01"/></svg>',
  SHIELD:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>',
  BOX:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 7h18"/><path d="M3 7l2-4h14l2 4"/><path d="M5 7v13h14V7"/></svg>',
  BELL:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  MSG:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/></svg>',
  FILE:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>',
  FLOW:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3v6M12 15v6M5 9h14M5 15h14"/><circle cx="7" cy="9" r="2"/><circle cx="17" cy="15" r="2"/></svg>',
  GEAR:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.38 1.05V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 8.6 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1.05-.38H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 8.6a1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 7.04 3.9l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .38-1.05V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15.4 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.28.35.7.56 1.15.6H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.4Z"/></svg>',
  LOCK:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  CHECK:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  GLOBE:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 0 20"/><path d="M12 2a15 15 0 0 0 0 20"/></svg>',
  SAVE:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>',
};

/** Render an inline SVG icon by key. `display:contents` so CSS sizes the <svg> directly. */
export function SwzIcon({ name }: { name: string }): VNode {
  return <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: SWZ_ICONS[name] ?? SWZ_ICONS['GEAR']! }} />;
}

/** Per-card icon — cycles a small set like the design's iconFor(i). */
const CARD_CYCLE = ['USER', 'SHIELD', 'FLOW', 'BELL', 'GEAR', 'FILE'];
export function swzCardIconName(i: number): string {
  return CARD_CYCLE[i % CARD_CYCLE.length]!;
}
