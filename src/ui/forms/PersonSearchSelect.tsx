/**
 * src/ui/forms/PersonSearchSelect.tsx — the canonical person / employee picker.
 *
 * Replaces `src/ui/components/PersonSearchSelect.tsx` and `hrfin/EntityPicker`.
 * The old one had no keyboard navigation, no combobox ARIA, no clear button, no
 * loading, error, disabled or read-only state, closed its list on a 150ms blur
 * timer, and required the caller to have pre-fetched every possible person.
 *
 * This is a thin composition over `Combobox` — the search, keyboard model,
 * popup positioning, dismissal and validation all come from there. What this
 * adds is the person RENDERING and the domain shape:
 *
 *     [Avatar] Sarah James
 *              EMP-00484 · Safety Officer · HSE
 *
 * and, once chosen:
 *
 *     [Avatar] Sarah James
 *              EMP-00484 · HSE                    ×
 *
 * Use this ANYWHERE a person or employee FK is selected. Free text for employee
 * ownership is a data-integrity bug, not a UI shortcut.
 */

import { type VNode } from 'preact';
import { useCallback, useMemo } from 'preact/hooks';
import { type ControlSize, type UiState, type ValidationState } from '../tokens';
import { type Option, type OptionsInput } from './options';
import { Combobox } from './Combobox';
import './listbox.recipe.css';

export interface PersonOption {
  id: string;
  name: string;
  employeeNo?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  site?: string | null;
  photoUrl?: string | null;
  /** Short status chips — "On leave", "Probation", "Contractor". */
  badges?: readonly string[];
  disabled?: boolean;
}

export interface PersonSearchSelectProps {
  value: string | null;
  onChange: (id: string | null) => void;

  /** Static roster — filtered locally. */
  people?: readonly PersonOption[];
  /** Async lookup. Preferred for anything larger than a single team. */
  search?: (query: string) => Promise<readonly PersonOption[]>;
  minChars?: number;

  placeholder?: string;
  emptyLabel?: string;
  size?: ControlSize;
  clearable?: boolean;

  disabled?: boolean;
  readOnly?: boolean;
  validation?: ValidationState;
  showBadges?: boolean;

  id?: string;
  name?: string;
  'aria-label'?: string;
  forceState?: UiState;
  class?: string;
}

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map(w => (w[0] ?? '').toUpperCase()).join('') || '?';
}

/** The meta line under the name. Empty segments are dropped, never rendered as "· ·". */
function metaLine(p: PersonOption, parts: (keyof PersonOption)[]): string {
  return parts
    .map(k => p[k])
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join(' · ');
}

function Avatar({ person, large = false }: { person: PersonOption; large?: boolean }): VNode {
  return (
    <span class={`ui-person-avatar${large ? ' ui-person-avatar--lg' : ''}`} aria-hidden="true">
      {person.photoUrl
        ? <img src={person.photoUrl} alt="" loading="lazy" />
        : <span>{initialsOf(person.name)}</span>}
    </span>
  );
}

/** Carry the person record through the generic Option shape. */
function toOption(p: PersonOption): Option {
  return {
    value: p.id,
    label: p.name,
    subtitle: metaLine(p, ['employeeNo', 'jobTitle', 'department']),
    disabled: p.disabled,
    data: p,
  };
}

export function PersonSearchSelect({
  value, onChange, people, search, minChars = 0,
  placeholder = 'Search by name…', emptyLabel = 'No matching people',
  size = 'md', clearable = true,
  disabled, readOnly, validation, showBadges = true,
  id, name, forceState, class: extra,
  ...aria
}: PersonSearchSelectProps): VNode {
  const options = useMemo<OptionsInput>(
    () => (people ?? []).map(toOption),
    [people],
  );

  const asyncSearch = useMemo(
    () => (search ? async (q: string): Promise<OptionsInput> => (await search(q)).map(toOption) : undefined),
    [search],
  );

  const renderOption = useCallback((opt: Option, selected: boolean): VNode => {
    const p = opt.data as PersonOption;
    return (
      <>
        <Avatar person={p} />
        <span class="ui-option-copy">
          <span class="ui-option-label">{p.name}</span>
          {opt.subtitle && <span class="ui-option-subtitle">{opt.subtitle}</span>}
        </span>
        {showBadges && p.badges && p.badges.length > 0 && (
          <span class="ui-person-badges">
            {p.badges.map(b => <span key={b} class="ui-person-badge">{b}</span>)}
          </span>
        )}
        {selected && <span class="ui-option-check" aria-hidden="true">✓</span>}
      </>
    );
  }, [showBadges]);

  const renderSelected = useCallback((opt: Option): VNode => {
    const p = opt.data as PersonOption;
    // The resolved chip shows a SHORTER meta line than the list row — the list
    // is for telling two similar people apart, the chip is for confirming which
    // one is set. Repeating the full line just truncates.
    const meta = metaLine(p, ['employeeNo', 'department']);
    return (
      <span class="ui-person-selected">
        <Avatar person={p} large />
        <span class="ui-person-selected-copy">
          <span class="ui-person-selected-name">{p.name}</span>
          {meta && <span class="ui-person-selected-meta">{meta}</span>}
        </span>
      </span>
    );
  }, []);

  return (
    <Combobox
      value={value ?? ''}
      onChange={v => onChange(v === '' ? null : v)}
      options={asyncSearch ? undefined : options}
      search={asyncSearch}
      minChars={minChars}
      placeholder={placeholder}
      emptyLabel={emptyLabel}
      size={size}
      clearable={clearable}
      disabled={disabled}
      readOnly={readOnly}
      validation={validation}
      renderOption={renderOption}
      renderSelected={renderSelected}
      id={id}
      name={name}
      forceState={forceState}
      class={extra}
      aria-label={aria['aria-label']}
    />
  );
}
