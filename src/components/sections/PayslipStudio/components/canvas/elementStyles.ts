import type { CSSProperties } from 'preact';
import type { Align, VAlign } from '@payslip/types';
import type { StyledElement } from '@payslip/model/guards';

export function fontCss(el: StyledElement): CSSProperties {
  return {
    fontSize: `${el.fontSize}px`,
    fontFamily: el.fontFamily,
    fontWeight: el.bold ? 700 : 400,
    fontStyle: el.italic ? 'italic' : 'normal',
    textDecoration: el.underline ? 'underline' : 'none',
    textAlign: el.align,
    lineHeight: el.lineHeight,
    color: el.color,
  };
}

/** Fill / border / radius / padding applied to an element's content wrapper. */
export function boxCss(el: StyledElement, withPadding: boolean): CSSProperties {
  const css: CSSProperties = {};
  if (el.bg && el.bg !== 'transparent') css.background = el.bg;
  if (el.borderW) css.border = `${el.borderW}px ${el.borderStyle} ${el.borderColor}`;
  if (el.radius) css.borderRadius = `${el.radius}px`;
  if (withPadding && el.padding != null) css.padding = `${el.padding}px`;
  if (el.color) css.color = el.color;
  return css;
}

export const justifyFor = (a: Align): string =>
  a === 'center' ? 'center' : a === 'right' ? 'flex-end' : 'flex-start';

export const alignFor = (v: VAlign): string =>
  v === 'middle' ? 'center' : v === 'bottom' ? 'flex-end' : 'flex-start';
