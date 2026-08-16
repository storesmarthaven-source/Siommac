import { type ComponentType, type SVGAttributes } from 'preact';
import * as CircularCountryFlags from '@untitledui/country-flags';
import * as RectangularCountryFlags from 'country-flag-icons/react/3x2';
import * as SquareCountryFlags from 'country-flag-icons/react/1x1';

type FlagSvgProps = SVGAttributes<SVGSVGElement> & { size?: number };
type FlagMap = Record<string, ComponentType<FlagSvgProps>>;

const CIRCLE_FLAGS = CircularCountryFlags as unknown as FlagMap;
const RECTANGLE_FLAGS = RectangularCountryFlags as unknown as FlagMap;
const SQUARE_FLAGS = SquareCountryFlags as unknown as FlagMap;

const REGIONAL_CODES = ['TT', 'GY', 'JM', 'BB', 'GD', 'LC', 'VC', 'BS', 'BZ', 'KN', 'DM', 'AG', 'US', 'CA', 'GB'] as const;
const EXPORTED_CODES = Object.keys(RECTANGLE_FLAGS).filter(name => /^[A-Z]{2}$/.test(name));
const DISPLAY_NAMES = typeof Intl.DisplayNames === 'function'
  ? new Intl.DisplayNames(['en'], { type: 'region' })
  : null;

/** All official flags, with SIOMAC's Caribbean operating region first. */
export const COUNTRY_FLAG_CODES = Object.freeze([
  ...REGIONAL_CODES.filter(code => EXPORTED_CODES.includes(code)),
  ...EXPORTED_CODES.filter(code => !(REGIONAL_CODES as readonly string[]).includes(code)).sort((a, b) => a.localeCompare(b)),
]);

export const COUNTRY_FLAG_OPTIONS = Object.freeze(COUNTRY_FLAG_CODES.map(code => ({
  code,
  name: DISPLAY_NAMES?.of(code) ?? code,
})));

export type CountryFlagCode = string;
export type CountryFlagShape = 'rectangle' | 'square' | 'circle';

export interface CountryFlagProps {
  /** ISO-style country code, for example `TT`, `JM`, or `US`. */
  code: CountryFlagCode;
  shape?: CountryFlagShape;
  size?: number;
  /** Omit when a nearby country name already provides the same information. */
  label?: string;
  class?: string;
}

function circleExportName(code: string): string {
  const normalized = code.trim().toLowerCase();
  return `Flag${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

/**
 * Canonical, locally bundled flag renderer used by both the app and Studio.
 */
export function CountryFlag({ code, shape = 'rectangle', size = 32, label, class: className }: CountryFlagProps) {
  const normalized = code.trim().toUpperCase();
  const Flag = shape === 'circle'
    ? CIRCLE_FLAGS[circleExportName(normalized)] ?? CIRCLE_FLAGS.FlagEarth
    : shape === 'square'
      ? SQUARE_FLAGS[normalized]
      : RECTANGLE_FLAGS[normalized];
  if (!Flag) return null;

  const width = shape === 'rectangle' ? Math.round(size * 1.5) : size;
  return (
    <Flag
      width={width}
      height={size}
      class={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    />
  );
}
