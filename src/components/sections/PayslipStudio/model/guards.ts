import type { DesignElement, StyleProps } from '@payslip/types';

/** Element types that carry the full StyleProps set. */
const STYLED_TYPES = new Set<DesignElement['type']>([
  'heading',
  'text',
  'field',
  'box',
  'summary',
  'table',
]);

export type StyledElement = Extract<
  DesignElement,
  { type: 'heading' | 'text' | 'field' | 'box' | 'summary' | 'table' }
>;

export function isStyled(el: DesignElement): el is StyledElement {
  return STYLED_TYPES.has(el.type);
}

export function hasStyleProp<K extends keyof StyleProps>(
  el: DesignElement,
  _key: K,
): el is StyledElement {
  return isStyled(el);
}
