// src/ui/widgets/size.ts — ordering/ranking helpers for the EXISTING WidgetSizeKey
// vocabulary (compact/standard/wide/large/tall/hero). Deliberately does NOT introduce
// a second size vocabulary — every widget def and board instance already speaks
// WidgetSizeKey, so responsive.ts and validation.ts build on this ranking instead.
import type { WidgetSizeKey } from './types';

// Roughly ascending by typical grid footprint. `wide`/`tall` are lateral variants of
// `standard`/`large` rather than strictly bigger — ranked alongside their peer so
// "at least X" comparisons behave sensibly for both axes.
export const SIZE_ORDER: WidgetSizeKey[] = ['compact', 'standard', 'wide', 'large', 'tall', 'hero'];

export function sizeRank(size: WidgetSizeKey): number {
  const i = SIZE_ORDER.indexOf(size);
  return i === -1 ? 0 : i;
}

export function isSizeAtLeast(current: WidgetSizeKey, minimum: WidgetSizeKey): boolean {
  return sizeRank(current) >= sizeRank(minimum);
}
