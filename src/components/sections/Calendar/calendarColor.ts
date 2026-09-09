const HEX_COLOR = /^#[0-9a-f]{6}$/i;

interface Rgb { red: number; green: number; blue: number }

function toRgb(hex: string): Rgb {
  return {
    red: Number.parseInt(hex.slice(1, 3), 16),
    green: Number.parseInt(hex.slice(3, 5), 16),
    blue: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function channelHex(value: number): string {
  return Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0');
}

function mix(base: Rgb, target: Rgb, baseWeight: number): string {
  const targetWeight = 1 - baseWeight;
  return `#${channelHex(base.red * baseWeight + target.red * targetWeight)}${channelHex(base.green * baseWeight + target.green * targetWeight)}${channelHex(base.blue * baseWeight + target.blue * targetWeight)}`;
}

function luminance(color: Rgb): number {
  const channel = (value: number): number => {
    const normalized = value / 255;
    return normalized <= .03928 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
  };
  return .2126 * channel(color.red) + .7152 * channel(color.green) + .0722 * channel(color.blue);
}

export function normalizeCalendarCustomColor(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? '';
  return HEX_COLOR.test(normalized) ? normalized : null;
}

/** Safe inline CSS variables for a validated custom card colour. */
export function calendarCustomColorVariables(value: string | null | undefined): string {
  const normalized = normalizeCalendarCustomColor(value);
  if (!normalized) return '';
  const base = toRgb(normalized);
  const white = toRgb('#ffffff');
  const navy = toRgb('#1b2d55');
  const charcoal = toRgb('#111827');
  const strongHead = mix(base, navy, .7);
  const onStrong = luminance(toRgb(strongHead)) > .46 ? '#182033' : '#ffffff';
  return [
    `--cal-custom-color:${normalized}`,
    `--cal-custom-border:${mix(base, navy, .66)}`,
    `--cal-custom-head-soft:${mix(base, white, .42)}`,
    `--cal-custom-head-strong:${strongHead}`,
    `--cal-custom-body:${mix(base, white, .1)}`,
    `--cal-custom-ink:${mix(base, charcoal, .28)}`,
    `--cal-custom-muted:${mix(base, charcoal, .42)}`,
    `--cal-custom-on-strong:${onStrong}`,
  ].join(';');
}
