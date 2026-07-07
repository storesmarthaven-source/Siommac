/**
 * src/ui/hrfin/icon.tsx
 *
 * The Aurora line-icon set — ported verbatim from the approved Codex mockups'
 * inline SVGs (siomac-finance-pages) so icons render identical to the design
 * (the rest of the app uses FontAwesome; this scoped set keeps the Finance
 * pages pixel-faithful). Stroked, 24×24 viewBox, `currentColor`.
 */

import { type VNode } from 'preact';

export type HrfinIconName =
  | 'grid' | 'plus' | 'download' | 'upload' | 'alert' | 'check' | 'calendar' | 'receipt'
  | 'filter' | 'more' | 'bank' | 'user' | 'trend' | 'file' | 'asset' | 'refresh' | 'clock'
  | 'close' | 'send' | 'gavel' | 'book' | 'users';

const PATHS: Record<HrfinIconName, string> = {
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  upload: '<path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/>',
  alert: '<path d="M10.3 3.7 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  check: '<path d="m20 6-11 11-5-5"/>',
  calendar: '<path d="M8 2v4M16 2v4"/><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/>',
  receipt: '<path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2Z"/><path d="M8 7h8M8 11h8M8 15h5"/>',
  filter: '<path d="M3 5h18l-7 8v5l-4 2v-7L3 5Z"/>',
  more: '<path d="M12 12h.01M19 12h.01M5 12h.01"/>',
  bank: '<path d="M3 10h18"/><path d="M5 10v9M9 10v9M15 10v9M19 10v9"/><path d="M2 19h20"/><path d="M12 3 3 8h18L12 3Z"/>',
  user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
  asset: '<path d="M4 21V9l8-6 8 6v12"/><path d="M9 21v-7h6v7"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2"/><path d="M3 12A9 9 0 0 1 18.5 5.8"/><path d="M18 2v4h-4"/><path d="M6 22v-4h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7Z"/>',
  gavel: '<path d="m14 13-8.5 8.5a2.12 2.12 0 0 1-3-3L11 10"/><path d="m16 16 6-6"/><path d="m8 8 6-6"/><path d="m9 7 8 8"/><path d="m21 11-8-8"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
};

export function HrfinIcon({ name }: { name: HrfinIconName }): VNode {
  return (
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: PATHS[name] ?? PATHS.grid }} />
  );
}
