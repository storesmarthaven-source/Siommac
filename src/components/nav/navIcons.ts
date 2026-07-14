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
  'fa-user-lock':           'UserRoundCog',
  'fa-user-tie':            'UserCog',
  'fa-hard-hat':            'HardHat',
  // HSE / PPE Manager sub-items
  'fa-gauge-high':              'Gauge',
  'fa-boxes-stacked':           'Boxes',
  'fa-user-plus':               'UserPlus',
  'fa-table-cells':             'Table',
  'fa-clock-rotate-left':       'RotateCcw',
  'fa-rotate-left':             'Undo2',
  'fa-clipboard-list':          'ClipboardList',
  'fa-magnifying-glass-chart':  'ScanSearch',
  'fa-lungs':                   'Wind',
  'fa-cart-shopping':           'ShoppingCart',
  'fa-briefcase-medical':       'BriefcaseMedical',
  'fa-chart-simple':            'ChartColumn',
  'fa-sliders':                 'Sliders',
  // HSE functional areas
  'fa-triangle-exclamation':    'TriangleAlert',
  'fa-circle-plus':             'CirclePlus',
  'fa-list-check':              'ListChecks',
  'fa-radiation':               'Radiation',
  'fa-table-cells-large':       'Grid2x2',
  'fa-list-ol':                 'ListOrdered',
  'fa-id-badge':                'IdCard',
  'fa-clipboard-check':         'ClipboardCheck',
  'fa-flag':                    'Flag',
  'fa-graduation-cap':          'GraduationCap',
  'fa-certificate':             'Award',
  'fa-people-group':            'UsersRound',
  'fa-folder-open':             'FolderOpen',
  'fa-file-lines':              'FileText',
  'fa-flask':                   'FlaskConical',
  // Settings nav (v2) — keep the sidebar's Lucide line-icon style
  'fa-user':                    'User',
  'fa-clock':                   'Clock',
  'fa-table-columns':           'PanelLeft',
  'fa-bell':                    'Bell',
  'fa-comments':                'MessageSquare',
  'fa-file-shield':             'FileText',
  'fa-diagram-project':         'Workflow',
  'fa-gear':                    'Settings',
  'fa-lock':                    'Lock',
  'fa-arrow-left':              'ArrowLeft',
  // HR sub-modules (were falling back to the generic Circle)
  'fa-rocket':                  'Rocket',
  'fa-sitemap':                 'Network',
  'fa-door-open':               'DoorOpen',
  'fa-right-left':              'ArrowRightLeft',
  'fa-inbox':                   'Inbox',
  // Other nav icons missing from the map
  'fa-bolt':                    'Zap',
  'fa-camera':                  'Camera',
  'fa-code-branch':             'GitBranch',
  'fa-database':                'Database',
  'fa-globe':                   'Globe',
  'fa-map-pin':                 'MapPin',
  'fa-shield-alt':              'Shield',
  'fa-user-check':              'UserCheck',
  'fa-bars':                    'Menu',
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
