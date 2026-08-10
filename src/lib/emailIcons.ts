/**
 * lib/emailIcons.ts — the ONE place that decides how an email icon is drawn.
 *
 * ⭐⭐ THE DEFECT THIS MODULE EXISTS TO FIX: Gmail strips inline `<svg>`. Proven against a real
 * delivered message — SIOMAC sent 9 inline SVGs and 2 `<img>`, Gmail rendered 0 SVGs and both
 * images, leaving seven empty bordered chips where the icons should have been. MJML never caught
 * it because MJML builds layout and passes raw markup through untouched, and our own parity check
 * compared `renderEmailPreview` against `renderEmailMjml` — two renderers that agreed with each
 * other precisely BECAUSE both emitted the unsupported construct.
 *
 * ⭐ So preview and production deliberately use DIFFERENT PRIMITIVES for the same visual
 * definition:
 *   canvas → inline Lucide SVG   (crisp, themeable, zero network cost, and a browser renders it)
 *   email  → hosted PNG `<img>`  (the only icon primitive a mail client is guaranteed to draw)
 * This is not duplication. It is one definition — `name` + semantic `color` — rendered through the
 * primitive each target actually supports.
 *
 * ⛔ Infrastructure never leaks into the document model. A template stores `{ icon: 'CalendarDays',
 * iconColor: 'navy' }` and NEVER a URL: baking today's bucket hostname into saved content is how a
 * CDN move silently breaks every template ever authored. The authored path produced here is
 * rewritten to its public URL server-side at send time by `emailAssetResolver`.
 */

import * as lucide from 'lucide';
import type { EmailIconColor } from '../../types/emailTemplates';

/**
 * The closed set of icon colours.
 *
 * ⭐ Closed BECAUSE the email primitive is a raster: colour is baked into the published file, so
 * every colour an author can pick must have a real asset behind it. An arbitrary hex picker would
 * let someone choose a colour that has no PNG — a broken image in a real inbox, which is exactly
 * the failure mode this whole change removes. 34 icons x 7 colours is 238 small files; an open
 * picker is unbounded.
 */
export const EMAIL_ICON_COLORS: Readonly<Record<EmailIconColor, string>> = {
  navy: '#173f76',
  blue: '#2563eb',
  green: '#0f8a4d',
  amber: '#b45309',
  red: '#b42318',
  slate: '#64748b',
  white: '#ffffff',
};

/** Palette order + labels for the Studio control. */
export const EMAIL_ICON_COLOR_CHOICES: ReadonlyArray<{ value: EmailIconColor; label: string }> = [
  { value: 'navy', label: 'Navy' },
  { value: 'blue', label: 'Blue' },
  { value: 'green', label: 'Green' },
  { value: 'amber', label: 'Amber' },
  { value: 'red', label: 'Red' },
  { value: 'slate', label: 'Slate' },
  { value: 'white', label: 'White' },
];

export const DEFAULT_EMAIL_ICON_COLOR: EmailIconColor = 'navy';

const COLOR_TOKENS = Object.keys(EMAIL_ICON_COLORS) as EmailIconColor[];

const isEmailIconColor = (value: unknown): value is EmailIconColor =>
  typeof value === 'string' && (COLOR_TOKENS as string[]).includes(value);

type Rgb = [number, number, number];

/** `#abc` / `#aabbcc` -> channels. Anything else is not a colour we can reason about. */
function parseHex(value: string): Rgb | null {
  const hex = value.trim().replace(/^#/, '');
  const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

const PALETTE_RGB: ReadonlyArray<{ token: EmailIconColor; rgb: Rgb }> = COLOR_TOKENS.map(token => ({
  token,
  // Every palette entry is a literal 6-digit hex above, so this cannot be null.
  rgb: parseHex(EMAIL_ICON_COLORS[token]) as Rgb,
}));

/**
 * Coerce any stored `iconColor` to a palette token.
 *
 * ⭐ Legacy hex resolves to the NEAREST palette colour rather than collapsing to the default:
 * documents authored before the palette existed carry real design intent (`#173f76` is the brand
 * navy, `#0f8a4d` the success green), and snapping each to its closest token preserves that intent
 * instead of repainting a whole library one colour. A value that is not a colour at all cannot
 * express intent, so it takes the default.
 *
 * ⛔ This runs in `normalizeEmailDocument`, so the MODEL is migrated and the editor then shows the
 * resolved token. Resolving only at render time would leave the editor showing a colour the
 * delivered email could never use.
 */
export function normalizeEmailIconColor(value: unknown): EmailIconColor {
  if (isEmailIconColor(value)) return value;
  const rgb = typeof value === 'string' ? parseHex(value) : null;
  if (!rgb) return DEFAULT_EMAIL_ICON_COLOR;
  let best = PALETTE_RGB[0] as { token: EmailIconColor; rgb: Rgb };
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entry of PALETTE_RGB) {
    const distance =
      (entry.rgb[0] - rgb[0]) ** 2 + (entry.rgb[1] - rgb[1]) ** 2 + (entry.rgb[2] - rgb[2]) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry;
    }
  }
  return best.token;
}

/** Resolve a semantic token to the hex the canvas and the raster generator both draw with. */
export const emailIconHex = (color: EmailIconColor): string => EMAIL_ICON_COLORS[color];

type LucideIconNode = [string, Record<string, string | number>][];

const lucideNode = (name: string): LucideIconNode | null => {
  const candidate = (lucide as unknown as Record<string, unknown>)[name];
  return Array.isArray(candidate) ? (candidate as LucideIconNode) : null;
};

/** Icons offered by the picker. Every one renders in both surfaces AND has published assets. */
export const EMAIL_ICON_CHOICES: readonly string[] = [
  'CalendarDays', 'Clock3', 'MapPin', 'UserRound', 'Users', 'Mail', 'Phone', 'Globe',
  'Briefcase', 'Building2', 'Laptop', 'Key', 'FileText', 'BookOpen', 'GraduationCap', 'Award',
  'HardHat', 'ShieldCheck', 'CheckCircle', 'Info', 'Bell', 'Star', 'Target', 'Heart',
  'Coffee', 'Gift', 'Home', 'Car', 'Truck', 'Package', 'CreditCard', 'Wallet',
  'Lock', 'Wifi',
].filter(name => lucideNode(name) !== null);

/** Substituted for an unrecognised icon name. Must itself be a published choice. */
export const FALLBACK_EMAIL_ICON = 'CheckCircle';

/**
 * Coerce an authored icon name to one that is definitely published.
 *
 * ⛔ Load-bearing for the email target: an unknown name would otherwise produce a URL for an asset
 * that was never generated, and a mail client renders that as a broken image. The canvas can
 * tolerate a miss (it just draws nothing); an inbox cannot. Both targets resolve through here so
 * the two surfaces cannot disagree about which glyph a name means.
 */
export function normalizeEmailIconName(name: string): string {
  const trimmed = (name ?? '').trim();
  if (EMAIL_ICON_CHOICES.includes(trimmed)) return trimmed;
  return EMAIL_ICON_CHOICES.includes(FALLBACK_EMAIL_ICON)
    ? FALLBACK_EMAIL_ICON
    : (EMAIL_ICON_CHOICES[0] ?? FALLBACK_EMAIL_ICON);
}

/** `CalendarDays` -> `calendar-days`, `Clock3` -> `clock-3`. Matches Lucide's own kebab naming. */
export const emailIconFileName = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([a-zA-Z])([0-9])/g, '$1-$2')
    .toLowerCase();

/** Prefix the Studio authors against and `emailAssetResolver` rewrites. */
export const EMAIL_ICON_ASSET_PREFIX = '/assets/images/email/icons';

/** Authored (repo-relative) path for a published icon raster. */
export const emailIconAssetPath = (name: string, color: EmailIconColor): string =>
  `${EMAIL_ICON_ASSET_PREFIX}/${color}/${emailIconFileName(normalizeEmailIconName(name))}.png`;

/**
 * Published at 3x the largest glyph the Studio can produce, so a tile icon stays crisp on a
 * high-DPI phone. The `<img>` carries the display size; the file carries the detail.
 */
export const EMAIL_ICON_RASTER_SIZE = 96;

/** Lucide's own icon data -> SVG markup. One source of truth for the glyph in both targets. */
export function renderEmailIconSvg(name: string, color: string, size: number): string {
  const node = lucideNode(normalizeEmailIconName(name));
  const inner = (node ?? [])
    .map(([tag, attrs]) => {
      const parts = Object.entries(attrs)
        .filter(([key]) => key !== 'key')
        .map(([key, value]) => `${key}="${escapeAttribute(String(value))}"`)
        .join(' ');
      return `<${tag} ${parts}/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${escapeAttribute(color)}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type EmailRenderTarget = 'canvas' | 'email';

export interface EmailIconRequest {
  name: string;
  color: EmailIconColor;
  size: number;
  target: EmailRenderTarget;
}

/**
 * Draw one icon for the given target.
 *
 * ⭐ Email icons are DECORATIVE: every one sits beside its own label ("Start date", "Report to",
 * the support address). `alt=""` + `role="presentation"` keeps a screen reader from announcing
 * "calendar icon Start date Monday 17 August" — the icon adds nothing a reader has not already
 * been told.
 */
export function renderEmailIcon({ name, color, size, target }: EmailIconRequest): string {
  if (target === 'canvas') return renderEmailIconSvg(name, emailIconHex(color), size);
  const src = emailIconAssetPath(name, color);
  return `<img src="${src}" width="${size}" height="${size}" alt="" role="presentation" style="display:inline-block;width:${size}px;height:${size}px;border:0;outline:none;text-decoration:none;vertical-align:middle">`;
}
