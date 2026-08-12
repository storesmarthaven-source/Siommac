/**
 * src/ui/registry/comparisons — existing-implementation comparisons.
 *
 * One file per component FAMILY, kept out of the component definitions because
 * a comparison is longer than the definition it belongs to and has a different
 * lifetime: it is written before a family is consolidated and deleted after.
 *
 * A family with no entry here has not been reviewed. That is deliberately
 * visible in the Gallery rather than implied by absence.
 */

export { BUTTON_COMPARISON } from './button.cmp';
export { DATA_TABLE_COMPARISON } from './dataTable.cmp';
export { CARD_COMPARISON } from './card.cmp';
export { TABS_COMPARISON } from './tabs.cmp';
