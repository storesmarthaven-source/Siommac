/**
 * src/components/nav/navIcons.ts
 *
 * Sidebar nav icons in the Lucide line-icon style (the calm Meridian look).
 * The sidebar is rendered as DOM strings, so we emit inline SVG markup keyed by
 * each section's Font Awesome icon name (the config still uses `fa-*`). Only the
 * sidebar uses these — the rest of the app keeps Font Awesome.
 */

import * as lucide from 'lucide';

type IconNode = [string, Record<string, string | number>][];

/** Map each config `fa-*` icon to a Lucide icon name (PascalCase export). */
const FA_TO_LUCIDE: Record<string, keyof typeof lucide> = {
  'fa-tachometer-alt':      'LayoutDashboard',
  'fa-users':               'Users',
  'fa-building':            'Building2',
  'fa-calendar-check':      'CalendarCheck',
  'fa-history':             'History',
  'fa-umbrella-beach':      'Umbrella',
  'fa-file-invoice-dollar': 'FileText',
  'fa-money-bill-wave':     'Banknote',
  'fa-map-marker-alt':      'MapPin',
  'fa-map-marked-alt':      'Map',
  'fa-shield-halved':       'ShieldCheck',
  'fa-user-circle':         'CircleUser',
  'fa-palette':             'Palette',
  'fa-info-circle':         'Info',
  'fa-user-shield':         'ShieldCheck',
  'fa-user-tie':            'UserCog',
  'fa-hard-hat':            'HardHat',
};

const FALLBACK: keyof typeof lucide = 'Circle';

/** Render a Lucide icon (by config fa-name) to an inline SVG string. */
export function navIconSvg(faName: string): string {
  const lucideName = FA_TO_LUCIDE[faName] ?? FALLBACK;
  const node = lucide[lucideName] as unknown as IconNode | undefined;
  if (!node) return '';
  const children = node
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
      return `<${tag} ${a} />`;
    })
    .join('');
  // Lucide default attrs: 24x24, no fill, currentColor stroke, width 2, round caps/joins.
  return (
    `<svg class="sb-ico" xmlns="http://www.w3.org/2000/svg" width="24" height="24" ` +
    `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${children}</svg>`
  );
}
