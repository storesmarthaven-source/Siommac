/**
 * src/ui/forms/OptionList.tsx — the list rendered inside a dropdown surface.
 *
 * Shared by Select, Combobox and PersonSearchSelect so groups, disabled options,
 * the active/selected distinction, and the empty/loading/error states are
 * implemented once.
 *
 * Options are rendered as `role="option"` DIVs, not buttons: in the
 * `aria-activedescendant` pattern DOM focus stays on the trigger, and a
 * focusable button inside the list would let Tab walk into a surface the
 * keyboard model says is not focusable.
 */

import { type VNode } from 'preact';
import { LucideIcon } from '../LucideIcon';
import { type Option, type OptionsInput, flattenOptions, toGroups, hasGroups } from './options';

export interface OptionListProps<T extends string> {
  options: OptionsInput<T>;
  value: T | '';
  activeIndex: number;
  optionId: (index: number) => string;
  onPick: (option: Option<T>) => void;
  onHover: (index: number) => void;

  loading?: boolean;
  error?: string | null;
  emptyLabel?: string;
  /** Custom row renderer — PersonSearchSelect uses this for avatar rows. */
  renderOption?: (option: Option<T>, selected: boolean) => VNode;
}

export function OptionList<T extends string>({
  options, value, activeIndex, optionId, onPick, onHover,
  loading = false, error = null, emptyLabel = 'No results',
  renderOption,
}: OptionListProps<T>): VNode {
  const flat = flattenOptions(options);

  if (loading) {
    return (
      <div class="ui-popup-state" role="status">
        <span class="ui-ctrl-spinner" />
        <span>Searching…</span>
      </div>
    );
  }

  // An error must be distinguishable from "no matches" — otherwise a failed
  // request reads as a legitimately empty result and the user retypes forever.
  if (error) {
    return (
      <div class="ui-popup-state ui-popup-state--error" role="alert">
        <LucideIcon name="CircleAlert" size={14} />
        <span>{error}</span>
      </div>
    );
  }

  if (flat.length === 0) {
    return <div class="ui-popup-state" role="status">{emptyLabel}</div>;
  }

  // Index into the FLAT list — keyboard navigation crosses group boundaries, so
  // the rendered index must match the one the keyboard hook is counting.
  //
  // Computed up front rather than incremented while rendering: a counter mutated
  // during render is order-dependent, and would silently desync from the
  // keyboard cursor if the tree were ever rendered out of order.
  const groups = toGroups(options);
  const grouped = hasGroups(options);
  const offsets: number[] = [];
  groups.reduce((acc, g) => { offsets.push(acc); return acc + g.options.length; }, 0);

  return (
    <>
      {groups.map((group, gi) => (
        <div key={group.group || '_'} role={grouped ? 'group' : undefined} aria-label={group.group || undefined}>
          {group.group && <div class="ui-option-group-label">{group.group}</div>}
          {group.options.map((opt, oi) => {
            const i = (offsets[gi] ?? 0) + oi;
            const selected = opt.value === value;
            return (
              <div
                key={opt.value}
                id={optionId(i)}
                data-index={i}
                data-active={i === activeIndex ? 'true' : 'false'}
                class="ui-option"
                role="option"
                aria-selected={selected}
                aria-disabled={opt.disabled ? 'true' : undefined}
                // pointerdown, not click: a click fires after blur, and on a
                // Combobox the blur would have closed the list first.
                onPointerDown={e => { e.preventDefault(); if (!opt.disabled) onPick(opt); }}
                onPointerEnter={() => { if (!opt.disabled) onHover(i); }}
              >
                {renderOption
                  ? renderOption(opt, selected)
                  : (
                    <>
                      <span class="ui-option-copy">
                        <span class="ui-option-label">{opt.label}</span>
                        {opt.subtitle && <span class="ui-option-subtitle">{opt.subtitle}</span>}
                      </span>
                      {selected && <span class="ui-option-check"><LucideIcon name="Check" /></span>}
                    </>
                  )}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
