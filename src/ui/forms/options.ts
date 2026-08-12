/**
 * src/ui/forms/options.ts — the option model shared by Select, Combobox,
 * MultiSelect and PersonSearchSelect.
 *
 * One shape for all of them. The audit found four selection controls with four
 * different option types, which is why none of their keyboard behaviour could
 * be shared and only one of them had any.
 */

export interface Option<T extends string = string> {
  value: T;
  label: string;
  /** Second line in the list — employee number, department, hint. */
  subtitle?: string;
  disabled?: boolean;
  /** Arbitrary payload for custom renderers (e.g. a person record). */
  data?: unknown;
}

export interface OptionGroup<T extends string = string> {
  group: string;
  options: readonly Option<T>[];
}

export type OptionsInput<T extends string = string> =
  | readonly Option<T>[]
  | readonly OptionGroup<T>[];

function isGroup<T extends string>(o: Option<T> | OptionGroup<T>): o is OptionGroup<T> {
  return 'group' in o;
}

/** True when the input is grouped. Grouped lists render `role="group"` headers. */
export function hasGroups<T extends string>(input: OptionsInput<T>): boolean {
  const first = input[0];
  return first !== undefined && isGroup(first);
}

/**
 * Flatten to a single ordered list.
 *
 * Keyboard navigation MUST run over the flat list: arrow keys move between
 * options across group boundaries, and an index into a nested structure cannot
 * express "the next option after the last one in this group".
 */
export function flattenOptions<T extends string>(input: OptionsInput<T>): Option<T>[] {
  if (!hasGroups(input)) return [...(input as readonly Option<T>[])];
  return (input as readonly OptionGroup<T>[]).flatMap(g => g.options);
}

/** Groups in render order, with their options. Ungrouped input yields one anonymous group. */
export function toGroups<T extends string>(input: OptionsInput<T>): OptionGroup<T>[] {
  if (!hasGroups(input)) return [{ group: '', options: input as readonly Option<T>[] }];
  return [...(input as readonly OptionGroup<T>[])];
}

/** Case-insensitive match over label and subtitle. */
export function filterOptions<T extends string>(input: OptionsInput<T>, query: string): OptionsInput<T> {
  const q = query.trim().toLowerCase();
  if (!q) return input;
  const match = (o: Option<T>): boolean =>
    o.label.toLowerCase().includes(q) || (o.subtitle ?? '').toLowerCase().includes(q);

  if (!hasGroups(input)) return (input as readonly Option<T>[]).filter(match);
  return (input as readonly OptionGroup<T>[])
    .map(g => ({ group: g.group, options: g.options.filter(match) }))
    .filter(g => g.options.length > 0);
}

export function findOption<T extends string>(input: OptionsInput<T>, value: T | ''): Option<T> | undefined {
  if (!value) return undefined;
  return flattenOptions(input).find(o => o.value === value);
}
