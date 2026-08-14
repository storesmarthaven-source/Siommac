/**
 * src/ui/registry/forms.defs.tsx — registry entries for the Forms wave.
 *
 * Choice controls, the typed-input family, date/time, file/code entry and
 * MultiSelect. Each entry moved OUT of `planned.ts` when the component was
 * built, so the coverage report's "missing" count fell by exactly the number
 * built — the two files are the same list, split by whether it exists.
 */

import { FormField } from '../forms/FormField';
import { TextInput, SearchInput as SearchField } from '../primitives/TextInput';
import { Checkbox, Switch, CheckboxGroup, RadioGroup } from '../primitives/choice';
import {
  PasswordInput, NumberInput, CurrencyInput, PercentageInput,
  EmailInput, UrlInput, PhoneInput, Textarea,
} from '../forms/inputs';
import { DateInput, TimeInput, DateTimeInput, DateRangeInput } from '../forms/dateInputs';
import { FileInput, OtpInput } from '../forms/FileInput';
import { ColorPicker } from '../forms/ColorPicker';
import { ThemeModeSwitch, type ThemeMode } from '../patterns/ThemeModeSwitch';
import { MultiSelect } from '../forms/MultiSelect';
import { Select } from '../forms/Select';
import { Combobox } from '../forms/Combobox';
import { type ComponentDef, type PropValues } from './types';
import { type ControlSize, type ValidationState } from '../tokens';
import { LucideIcon } from '../LucideIcon';
import { useEffect, useState } from 'preact/hooks';

const s = (v: PropValues[string] | undefined, f = ''): string => (typeof v === 'string' ? v : f);
const b = (v: PropValues[string] | undefined): boolean => v === true;
const n = (v: PropValues[string] | undefined, f = 0): number => (typeof v === 'number' ? v : f);
const size = (v: PropValues[string] | undefined): ControlSize => (v === 'sm' || v === 'lg' ? v : 'md');
const val = (v: PropValues[string] | undefined): ValidationState =>
  (v === 'error' || v === 'warning' || v === 'success' ? v : 'none');

const noop = (): void => { /* preview */ };

interface OtpPreviewProps {
  initialValue: string;
  length: number;
  disabled: boolean;
  validation: ValidationState;
  forceFocus: boolean;
}

function OtpPreview({ initialValue, length, disabled, validation, forceFocus }: OtpPreviewProps) {
  const normalizedInitialValue = initialValue.replace(/\D/g, '').slice(0, length);
  const [value, setValue] = useState(normalizedInitialValue);

  useEffect(() => setValue(normalizedInitialValue), [normalizedInitialValue, length]);

  return (
    <OtpInput
      value={value}
      onChange={setValue}
      length={length}
      disabled={disabled}
      validation={validation}
      class={forceFocus ? 'is-force-focus' : undefined}
    />
  );
}

function ThemeModePreview({ initialTheme, disabled, pending, forceFocus }: {
  initialTheme: ThemeMode;
  disabled: boolean;
  pending: boolean;
  forceFocus: boolean;
}) {
  const [theme, setTheme] = useState<ThemeMode>(initialTheme);
  useEffect(() => setTheme(initialTheme), [initialTheme]);
  return <ThemeModeSwitch theme={theme} onChange={setTheme} disabled={disabled} pending={pending} forceFocus={forceFocus} />;
}

const CHOICE_STYLE = [
  { label: 'Box', controls: [
    { name: '--ui-choice-size',          label: 'Size', kind: 'size' as const },
    { name: '--ui-choice-radius',        label: 'Corner radius', kind: 'size' as const },
    { name: '--ui-choice-border',        label: 'Border', kind: 'color' as const },
    { name: '--ui-choice-bg-checked',    label: 'Checked fill', kind: 'color' as const },
    { name: '--ui-choice-mark',          label: 'Mark', kind: 'color' as const },
    { name: '--ui-choice-gap',           label: 'Label gap', kind: 'size' as const },
  ] },
];

const CONTROL_STYLE = [
  { label: 'Control', controls: [
    { name: '--ui-control-md',           label: 'Height (md)', kind: 'size' as const },
    { name: '--ui-control-radius',       label: 'Corner radius', kind: 'size' as const },
    { name: '--ui-control-border',       label: 'Border', kind: 'color' as const },
    { name: '--ui-control-border-focus', label: 'Border — focus', kind: 'color' as const },
    { name: '--ui-control-icon',         label: 'Icons', kind: 'color' as const },
  ] },
];

/* ── Checkbox ──────────────────────────────────────────────────────────────*/

export const checkboxDef: ComponentDef = {
  id: 'checkbox',
  name: 'Checkbox',
  category: 'selection',
  description: 'A boolean you are editing and will submit. Wraps a real native input, so keyboard, form participation and the indeterminate property come for free.',
  status: 'stable',
  componentPath: 'src/ui/primitives/choice.tsx',
  importFrom: '@ui',
  migration: {
    rawPatterns: ['type="checkbox"'],
    nextSurface: 'Menu',
    notes: [
      'Calendar create-item is the clean form migration: its all-day value now uses canonical Checkbox and the raw input sizing rule is deleted.',
      'Remaining raw checkboxes are named consumer debt; broad form sweeps stop after this family.',
    ],
  },

  props: {
    label:         { type: 'text',    label: 'Label', default: 'Include archived records' },
    description:   { type: 'text',    label: 'Description', default: 'Adds terminated employees to the result set.' },
    checked:       { type: 'boolean', label: 'Checked', default: true },
    indeterminate: { type: 'boolean', label: 'Indeterminate', default: false, help: '"Some but not all" — for a select-all over a partial selection.' },
    error:         { type: 'boolean', label: 'Error', default: false },
    disabled:      { type: 'boolean', label: 'Disabled', default: false },
    readOnly:      { type: 'boolean', label: 'Read-only', default: false },
  },
  style: CHOICE_STYLE,
  states: ['default', 'selected', 'hover', 'focus', 'disabled', 'error'],
  compare: ['default', 'selected', 'hover', 'focus', 'disabled', 'error'],
  a11y: {
    role: null,
    name: 'The visible label, or `aria-label` when there is none.',
    keyboard: [{ keys: 'Space', does: 'Toggles. Native behaviour — not reimplemented.' }],
    focus: 'The native input holds focus; the ring is drawn on the visible box via :focus-visible on the sibling.',
    notes: [
      '`indeterminate` is a DOM property with no HTML attribute, so it is set imperatively. It is the most-missed part of a hand-built checkbox.',
      'Read-only has no native equivalent on a checkbox — the attribute is ignored — so it is enforced by refusing the change.',
    ],
  },
  render: (p, st) => (
    <Checkbox
      checked={b(p.checked) || st === 'selected'}
      onChange={noop}
      label={s(p.label, 'Checkbox')}
      description={s(p.description) || undefined}
      indeterminate={b(p.indeterminate)}
      error={b(p.error) || st === 'error'}
      disabled={b(p.disabled) || st === 'disabled'}
      readOnly={b(p.readOnly)}
      forceState={st}
    />
  ),
  code: p => `<Checkbox
  checked={includeArchived}
  onChange={setIncludeArchived}
  label="${s(p.label, 'Label')}"${s(p.description) ? `\n  description="${s(p.description)}"` : ''}
/>`,
  examples: [
    {
      id: 'select-all',
      title: 'Select-all with a partial selection',
      description: 'Indeterminate is a third state, not a styling of checked — it says "some", where checked says "all".',
      render: () => (
        <CheckboxGroup
          label="Modules"
          selectAllLabel="All modules"
          values={['hr']}
          onChange={noop}
          options={[
            { value: 'hr', label: 'Human Resources' },
            { value: 'hse', label: 'HSE' },
            { value: 'fin', label: 'Finance', disabled: true },
          ]}
        />
      ),
    },
  ],
};

/* ── Radio group ───────────────────────────────────────────────────────────*/

export const radioGroupDef: ComponentDef = {
  id: 'radio-group',
  name: 'RadioGroup',
  category: 'selection',
  description: 'One value from a small, always-visible set. Native radios supply roving focus and arrow movement, so none of it is reimplemented.',
  status: 'stable',
  componentPath: 'src/ui/primitives/choice.tsx',
  importFrom: '@ui',
  migration: {
    rawPatterns: ['type="radio"'],
    nextSurface: 'Menu',
    notes: [
      'The clean governed pay-policy and segregation-of-duties choice-card flows now compose canonical Radio while preserving their domain card layouts.',
      'Dirty wizard/dialog radios remain exact consumer debt.',
    ],
  },

  props: {
    value:    { type: 'select',  label: 'Selected', options: ['weekly', 'fortnightly', 'monthly'], default: 'fortnightly' },
    inline:   { type: 'boolean', label: 'Inline layout', default: false },
    withDesc: { type: 'boolean', label: 'Show descriptions', default: true },
    error:    { type: 'boolean', label: 'Error', default: false },
    disabled: { type: 'boolean', label: 'Disabled', default: false },
  },
  style: CHOICE_STYLE,
  states: ['default', 'hover', 'focus', 'disabled', 'error'],
  a11y: {
    role: 'radiogroup + radio',
    name: 'The mandatory `label` prop.',
    keyboard: [
      { keys: '↑ / ↓ / ← / →', does: 'Moves and selects within the group — native, from the shared `name`.' },
      { keys: 'Tab', does: 'Skips the whole group; only the selected radio is tabbable.' },
    ],
    focus: 'Native roving focus. No custom key handling, deliberately.',
    notes: ['Prefer a Select above ~6 options — a radio group is for choices worth reading all of.'],
  },
  render: (p, st) => (
    <RadioGroup
      label="Pay frequency"
      value={s(p.value, 'fortnightly')}
      onChange={noop}
      inline={b(p.inline)}
      error={b(p.error) || st === 'error'}
      disabled={b(p.disabled) || st === 'disabled'}
      options={[
        { value: 'weekly',      label: 'Weekly',      description: b(p.withDesc) ? 'Paid every Friday.' : undefined },
        { value: 'fortnightly', label: 'Fortnightly', description: b(p.withDesc) ? 'Paid every second Friday.' : undefined },
        { value: 'monthly',     label: 'Monthly',     description: b(p.withDesc) ? 'Paid on the last working day.' : undefined },
      ]}
    />
  ),
  code: () => `<RadioGroup
  label="Pay frequency"
  value={frequency}
  onChange={setFrequency}
  options={FREQUENCIES}
/>`,
};

/* ── Switch ────────────────────────────────────────────────────────────────*/

export const switchDef: ComponentDef = {
  id: 'switch',
  name: 'Switch',
  category: 'selection',
  description: 'A setting that takes effect IMMEDIATELY. Not a Checkbox with different styling — using one inside a form with a Save button lies about when the change lands.',
  status: 'stable',
  componentPath: 'src/ui/primitives/choice.tsx',
  importFrom: '@ui',
  migration: {
    deprecatedImports: ['NavCustomizer Switch'],
    nextSurface: 'Menu',
    notes: [
      'The only module-local Switch, in NavCustomizer, is deleted with all .navcust-switch CSS; visibility still applies immediately.',
      'NotificationPreferences has a second Toggle-shaped local control but is deferred because the file has an existing lint blocker.',
    ],
  },

  props: {
    label:       { type: 'text',    label: 'Label', default: 'Require MFA for admins' },
    description: { type: 'text',    label: 'Description', default: 'Applies at the next sign-in.' },
    checked:     { type: 'boolean', label: 'On', default: true },
    pending:     { type: 'boolean', label: 'Pending', default: false, help: 'While the change is being persisted. Sets aria-busy and blocks re-toggling.' },
    disabled:    { type: 'boolean', label: 'Disabled', default: false },
  },
  style: [
    { label: 'Track', controls: [
      { name: '--ui-switch-w',     label: 'Width', kind: 'size' },
      { name: '--ui-switch-h',     label: 'Height', kind: 'size' },
      { name: '--ui-switch-bg',    label: 'Off fill', kind: 'color' },
      { name: '--ui-switch-bg-on', label: 'On fill', kind: 'color' },
      { name: '--ui-switch-knob',  label: 'Knob', kind: 'color' },
    ] },
  ],
  states: ['default', 'selected', 'focus', 'disabled', 'loading'],
  compare: ['default', 'selected', 'focus', 'disabled'],
  a11y: {
    role: 'switch',
    name: 'The visible label, or `aria-label`.',
    keyboard: [{ keys: 'Space', does: 'Toggles.' }],
    focus: 'Ring on the track via :focus-visible on the native input.',
    notes: ['role="switch" is announced "on/off"; a plain checkbox is announced "checked" — which is the difference between a live setting and a pending form value.'],
  },
  render: (p, st) => (
    <Switch
      checked={b(p.checked) || st === 'selected'}
      onChange={noop}
      label={s(p.label, 'Setting')}
      description={s(p.description) || undefined}
      pending={b(p.pending) || st === 'loading'}
      disabled={b(p.disabled) || st === 'disabled'}
      forceState={st}
    />
  ),
  code: p => `<Switch
  checked={requireMfa}
  onChange={setRequireMfa}
  label="${s(p.label, 'Setting')}"
/>`,
};

/* ── TextInput ─────────────────────────────────────────────────────────────*/

/**
 * ONE text control. `type` is a prop, not a component.
 *
 * Password, number, currency, percentage, email, URL, phone and textarea were a
 * second card called "Typed inputs" sitting beside TextInput — two entries for
 * the same box. They are presets: same shell, same validation, same disabled and
 * read-only treatment. What differs is `inputMode`, `autoComplete` and how the
 * value is parsed, and none of that is a reason for a second card.
 *
 * The three numeric presets DO keep their own exports, because their value
 * contract differs from a string: currency stores minor units, percentage stores
 * a ratio. That is an API difference, not a styling one.
 */
export const textInputDef: ComponentDef = {
  id: 'text-input',
  name: 'TextInput',
  category: 'forms',
  description: 'One text control for every kind of text. Password, number, currency, percentage, email, URL, phone and multi-line are TYPES of it, not separate components.',
  status: 'stable',
  componentPath: 'src/ui/primitives/TextInput.tsx',
  importFrom: '@ui',
  previewAxis: 'type',
  previewSamples: [
    { value: 'Text', title: 'Text', description: 'Names and short answers', props: { type: 'Text' } },
    { value: 'Search', title: 'Search', description: 'Find and filter records', props: { type: 'Search', iconLeft: 'Search' } },
    { value: 'Password', title: 'Password', description: 'Protected entry', props: { type: 'Password', iconLeft: 'LockKeyhole' } },
    { value: 'Number', title: 'Number', description: 'Measured quantities', props: { type: 'Number' } },
    { value: 'Currency', title: 'Currency', description: 'Money in minor units', props: { type: 'Currency' } },
    { value: 'Percentage', title: 'Percentage', description: 'Rates stored as ratios', props: { type: 'Percentage' } },
    { value: 'Email', title: 'Email', description: 'Validated email entry', props: { type: 'Email', iconLeft: 'Mail' } },
    { value: 'URL', title: 'URL', description: 'Web addresses', props: { type: 'URL', iconLeft: 'Link' } },
    { value: 'Phone', title: 'Phone', description: 'Dial code and number', props: { type: 'Phone' } },
    { value: 'Multi-line', title: 'Multi-line', description: 'Notes and longer context', props: { type: 'Multi-line' } },
  ],
  migration: {
    replaces: ['.ui-input', '.ui-textarea'],
    rawPatterns: ['<input', '<textarea', 'type="password"', 'type="number"', 'type="tel"'],
    nextSurface: 'Select / Combobox',
    notes: [
      'Prefix and suffix are persistent value context; iconLeft/iconRight are affordances. Validation, clear and loading may replace an icon but never a unit affix.',
      'Uncontrolled mode is reserved for native-form or retained DOM integration. Application state should continue to use value + onInput.',
    ],
  },

  props: {
    type:       { type: 'select',    label: 'Type', options: ['Text', 'Search', 'Password', 'Number', 'Currency', 'Percentage', 'Email', 'URL', 'Phone', 'Multi-line'], default: 'Text',
                  help: 'Chooses inputMode, autoComplete and how the value is parsed. Not a styling switch.' },
    label:      { type: 'text',      label: 'Field label', default: 'Employee name' },
    placeholder:{ type: 'text',      label: 'Placeholder', default: 'e.g. Sarah James' },
    iconLeft:   { type: 'icon',      label: 'Leading icon', default: 'None', recommendations: ['Search', 'User', 'Mail', 'Phone', 'LockKeyhole', 'Link'],
                  help: 'Choose from the full Lucide library. Recommended field icons appear first.' },
    tooltipEnabled: { type: 'boolean', label: 'Field tooltip', default: false, help: 'Adds keyboard-accessible guidance inside the field.' },
    tooltipText: { type: 'text', label: 'Tooltip text', default: 'This is a hint to help the user complete this field.' },
    prefix:     { type: 'text',      label: 'Prefix affix', default: '' },
    suffix:     { type: 'text',      label: 'Suffix affix', default: '' },
    helpText:   { type: 'text',      label: 'Help text', default: 'Shown under the label — always visible, never a tooltip.' },
    size:       { type: 'segmented', label: 'Size', options: ['sm', 'md', 'lg'], default: 'md' },
    validation: { type: 'select',    label: 'Validation', options: ['none', 'error', 'warning', 'success'], default: 'none' },
    message:    { type: 'text',      label: 'Validation message', default: 'This field is required.' },
    required:   { type: 'boolean',   label: 'Required', default: true },
    clearable:  { type: 'boolean',   label: 'Clearable', default: false },
    charCount:  { type: 'boolean',   label: 'Character count', default: false },
    loading:    { type: 'boolean',   label: 'Loading', default: false },
    disabled:   { type: 'boolean',   label: 'Disabled', default: false },
    readOnly:   { type: 'boolean',   label: 'Read-only', default: false, help: 'A DIFFERENT state from disabled — the value stays legible and copyable.' },
  },

  style: [
    { label: 'Control', controls: [
      { name: '--ui-control-md',          label: 'Height (md)', kind: 'size' },
      { name: '--ui-control-pad-md',      label: 'Padding X (md)', kind: 'size' },
      { name: '--ui-control-radius',      label: 'Corner radius', kind: 'size' },
      { name: '--ui-control-font-size',   label: 'Font size', kind: 'size' },
      { name: '--ui-control-bg',          label: 'Resting background', kind: 'color' },
      { name: '--ui-control-border',      label: 'Border', kind: 'color' },
      { name: '--ui-control-placeholder', label: 'Placeholder text', kind: 'color' },
      { name: '--ui-control-icon',        label: 'Icons', kind: 'color' },
    ] },
    { label: 'Hover & focus', controls: [
      { name: '--ui-control-border-hover',     label: 'Hover border', kind: 'color' },
      { name: '--ui-control-border-focus',     label: 'Focus border', kind: 'color' },
      { name: '--ui-control-focus-ring-color', label: 'Focus halo', kind: 'color' },
      { name: '--ui-control-focus-ring-width', label: 'Focus halo width', kind: 'size' },
    ] },
    { label: 'Label & help', controls: [
      { name: '--ui-label-fg',          label: 'Label colour', kind: 'color' },
      { name: '--ui-label-font-size',   label: 'Label size', kind: 'size' },
      { name: '--ui-label-required-fg', label: 'Required marker', kind: 'color' },
      { name: '--ui-help-fg',           label: 'Help text', kind: 'color' },
      { name: '--ui-field-gap',         label: 'Field row gap', kind: 'size' },
    ] },
    { label: 'Validation', controls: [
      { name: '--ui-validation-error-border',   label: 'Error — border', kind: 'color' },
      { name: '--ui-validation-error-fg',       label: 'Error — text', kind: 'color' },
      { name: '--ui-validation-warning-border', label: 'Warning — border', kind: 'color' },
      { name: '--ui-validation-success-border', label: 'Success — border', kind: 'color' },
    ] },
    { label: 'Disabled & read-only', controls: [
      { name: '--ui-disabled-bg',     label: 'Disabled — background', kind: 'color' },
      { name: '--ui-disabled-fg',     label: 'Disabled — text', kind: 'color' },
      { name: '--ui-readonly-bg',     label: 'Read-only — background', kind: 'color' },
      { name: '--ui-readonly-fg',     label: 'Read-only — text', kind: 'color' },
    ] },
  ],

  states: ['default', 'hover', 'focus', 'disabled', 'readonly', 'loading', 'error', 'warning', 'success'],
  compare: ['default', 'focus', 'error', 'disabled', 'readonly'],

  a11y: {
    role: null,
    name: 'The FormField label, wired via for/id. Standalone, pass aria-label.',
    keyboard: [
      { keys: 'Tab',   does: 'Focuses the field. A read-only field is still reachable so its value can be copied.' },
      { keys: 'Enter', does: 'Submits the surrounding form (native behaviour).' },
    ],
    focus: 'The ring is drawn on the wrapper via :focus-within, so it surrounds the whole control including its icons.',
    notes: [
      'aria-invalid is set for `error` only — a warning is advisory and must not mark the field invalid.',
      'aria-describedby references only elements that actually render; a dangling id silences the whole field.',
      'Trailing affordances have a fixed priority (spinner → clear → validation icon → field help → custom), enforced in TS, so two can never overlap.',
      'Currency stores MINOR units and percentage stores a RATIO. Each holds the in-progress TEXT locally, so a half-typed "12." is not round-tripped through a number and truncated.',
    ],
  },

  render: (p, st) => {
    const v = val(p.validation) === 'none' && (st === 'error' || st === 'warning' || st === 'success') ? st : val(p.validation);
    const msg = s(p.message);
    const disabled = b(p.disabled) || st === 'disabled';
    const readOnly = b(p.readOnly) || st === 'readonly';
    const type = s(p.type, 'Text');
    const iconName = s(p.iconLeft, 'None');
    const leadingIcon = iconName === 'None' ? null : <LucideIcon name={iconName as never} />;
    const helpTooltip = b(p.tooltipEnabled) ? s(p.tooltipText, 'This is a hint to help the user complete this field.') : undefined;
    const common = {
      size: size(p.size),
      loading: b(p.loading) || st === 'loading',
      forceState: st,
      iconLeft: leadingIcon,
      helpTooltip,
    };

    const shell = (node: preact.JSX.Element, label?: string, help?: string, defaultSuccess?: string): preact.JSX.Element => (
      <FormField
        label={label ?? s(p.label, 'Label')}
        required={b(p.required)}
        helpText={help ?? (s(p.helpText) || undefined)}
        error={v === 'error' ? msg : undefined}
        warning={v === 'warning' ? msg : undefined}
        success={v === 'success' ? msg : (v === 'none' ? defaultSuccess : undefined)}
        disabled={disabled}
        readOnly={readOnly}
        charCount={b(p.charCount) ? { value: 0, max: 120 } : undefined}
      >{node}</FormField>
    );

    switch (type) {
      case 'Password':   return shell(<PasswordInput value="correct-horse" onInput={noop} disabled={disabled} readOnly={readOnly} {...common} />, 'Password', undefined, 'Must be at least 8 characters.');
      case 'Number':     return shell(<NumberInput value={100} onChange={noop} min={0} disabled={disabled} readOnly={readOnly} {...common} />, 'Number', 'This is a hint text to help the user.');
      case 'Currency':   return shell(<CurrencyInput {...common} valueMinor={100000} onChange={noop} currency="USD" currencies={['USD', 'TTD', 'EUR']} onCurrencyChange={noop} helpTooltip={helpTooltip ?? 'Choose the currency for this amount.'} disabled={disabled} readOnly={readOnly} />, 'Sale amount', 'This is a hint text to help the user.');
      case 'Percentage': return shell(<PercentageInput value={0.0825} onChange={noop} disabled={disabled} readOnly={readOnly} {...common} />, 'NIS rate', 'Stored as a ratio (0.0825), displayed as a percentage.');
      case 'Email':      return shell(<EmailInput value="sarah.james@siomac.com" onInput={noop} disabled={disabled} readOnly={readOnly} {...common} />, 'Work email');
      case 'URL':        return shell(<UrlInput value="https://siomac.com/policy" onInput={noop} disabled={disabled} readOnly={readOnly} {...common} />, 'Policy link');
      case 'Phone':      return shell(<PhoneInput {...common} value="(555) 000-0000" onInput={noop} country="US" dialCode="+1" countries={[{ code: 'US', dialCode: '+1' }, { code: 'TT', dialCode: '+1 868' }]} onCountryChange={noop} helpTooltip={helpTooltip ?? 'Include the country code.'} disabled={disabled} readOnly={readOnly} />, 'Phone number', 'This is a hint text to help the user.');
      case 'Multi-line': return shell(<Textarea value="" onInput={noop} placeholder="Add context for the approver..." rows={3} disabled={disabled} readOnly={readOnly} {...common} />, 'Notes');
      case 'Search':     return shell(<SearchField value="" onInput={noop} disabled={disabled} readOnly={readOnly} {...common} />, 'Search');
      default:
        return shell(
          <TextInput
            value=""
            onInput={noop}
            placeholder={s(p.placeholder)}
            prefix={s(p.prefix) || undefined}
            suffix={s(p.suffix) || undefined}
            clearable={b(p.clearable)}
            disabled={disabled}
            readOnly={readOnly}
            {...common}
          />,
        );
    }
  },

  code: p => {
    const type = s(p.type, 'Text');
    const chosenIcon = s(p.iconLeft, 'None');
    const iconProp = chosenIcon === 'None' ? '' : ` iconLeft={<LucideIcon name="${chosenIcon}" />}`;
    const tooltipProp = b(p.tooltipEnabled) ? ` helpTooltip=${JSON.stringify(s(p.tooltipText, 'This is a hint to help the user complete this field.'))}` : '';
    const extras = `${iconProp}${tooltipProp}`;
    if (type === 'Currency') return `<FormField label="Gross pay">\n  <CurrencyInput valueMinor={grossCents} onChange={setGrossCents} currency="TTD"${extras} />\n</FormField>`;
    if (type === 'Percentage') return `<FormField label="NIS rate">\n  <PercentageInput value={rate} onChange={setRate}${extras} />\n</FormField>`;
    if (type === 'Number') return `<FormField label="Notice period">\n  <NumberInput value={days} onChange={setDays} unit="days" min={0}${extras} />\n</FormField>`;
    if (type === 'Multi-line') return `<FormField label="Notes">\n  <Textarea value={notes} onInput={setNotes} rows={3}${extras} />\n</FormField>`;
    if (type === 'Password') return `<FormField label="Password">\n  <PasswordInput value={pw} onInput={setPw}${extras} />\n</FormField>`;
    if (type === 'Search') return `<SearchField value={q} onInput={setQ} aria-label="Search employees"${extras} />`;
    if (type === 'Text') return `<FormField label="Employee name" required error={errors.name}>\n  <TextInput value={name} onInput={setName} placeholder="e.g. Sarah James"${extras} />\n</FormField>`;
    return `<FormField label="${type}">\n  <${type}Input value={v} onInput={set}${extras} />\n</FormField>`;
  },

  examples: [
    {
      id: 'employee-name',
      title: 'Employee record',
      description: 'A required identity field with visible guidance.',
      render: () => <FormField label="Employee name" required helpText="As shown on government ID"><TextInput value="Sarah James" onInput={noop} /></FormField>,
    },
    {
      id: 'register-search',
      title: 'Register search',
      description: 'Search remains a TextInput type rather than a separate visual system.',
      render: () => <FormField label="Search employees"><SearchField value="Sarah" onInput={noop} /></FormField>,
    },
    {
      id: 'payroll-amount',
      title: 'Payroll amount',
      description: 'Currency keeps money in minor units while displaying a familiar value.',
      render: () => <FormField label="Gross pay"><CurrencyInput valueMinor={845000} onChange={noop} currency="TTD" /></FormField>,
    },
  ],

  presets: [
    { label: 'Required text',  props: { type: 'Text', label: 'Employee name', placeholder: 'e.g. Sarah James', helpText: '', size: 'md', validation: 'none', message: '', required: true, clearable: false, charCount: false, loading: false, disabled: false, readOnly: false } },
    { label: 'Invalid email',  props: { type: 'Email', label: 'Work email', placeholder: '', helpText: '', size: 'md', validation: 'error', message: 'Enter a valid email address.', required: true, clearable: false, charCount: false, loading: false, disabled: false, readOnly: false } },
    { label: 'Money',          props: { type: 'Currency', label: 'Gross pay', placeholder: '', helpText: '', size: 'md', validation: 'none', message: '', required: true, clearable: false, charCount: false, loading: false, disabled: false, readOnly: false } },
    { label: 'Read-only ref',  props: { type: 'Text', label: 'Reference', placeholder: '', helpText: 'System generated — cannot be changed.', size: 'md', validation: 'none', message: '', required: false, clearable: false, charCount: false, loading: false, disabled: false, readOnly: true } },
    { label: 'Notes',          props: { type: 'Multi-line', label: 'Notes', placeholder: '', helpText: '', size: 'md', validation: 'none', message: '', required: false, clearable: false, charCount: true, loading: false, disabled: false, readOnly: false } },
  ],
};

/* ── Date & time ───────────────────────────────────────────────────────────*/

export const dateInputDef: ComponentDef = {
  id: 'date-input',
  name: 'DateInput',
  category: 'forms',
  description: 'Date, time and datetime entry in the kit control shell. Built on the native input, so locale, keyboard and the mobile picker are the platform’s — what the app lacked was the shell.',
  status: 'stable',
  componentPath: 'src/ui/forms/dateInputs.tsx',
  importFrom: '@ui',
  migration: { rawPatterns: ['type="date"', 'type="time"'], nextSurface: 'HR Onboarding' },

  props: {
    which:      { type: 'select',    label: 'Control', options: ['Date', 'Time', 'DateTime', 'Range'], default: 'Date' },
    size:       { type: 'segmented', label: 'Size', options: ['sm', 'md', 'lg'], default: 'md' },
    clearable:  { type: 'boolean',   label: 'Clearable', default: true },
    validation: { type: 'select',    label: 'Validation', options: ['none', 'error', 'warning', 'success'], default: 'none' },
    disabled:   { type: 'boolean',   label: 'Disabled', default: false },
    readOnly:   { type: 'boolean',   label: 'Read-only', default: false },
    invertRange:{ type: 'boolean',   label: 'Range: end before start', default: false, help: 'Shows the built-in cross-field error.' },
  },
  style: CONTROL_STYLE,
  states: ['default', 'hover', 'focus', 'disabled', 'readonly', 'error'],
  compare: ['default', 'focus', 'error', 'disabled', 'readonly'],
  a11y: {
    role: null,
    name: 'The FormField label.',
    keyboard: [
      { keys: '↑ / ↓', does: 'Steps the focused segment (day, month, year) — native.' },
      { keys: 'Typing', does: 'Enters the date directly, in the user’s locale format.' },
    ],
    focus: 'Ring on the control box via :focus-within.',
    notes: [
      'Values are ISO strings (YYYY-MM-DD, HH:mm) — what the native control emits and what the API expects, so nothing parses a locale string.',
      'DateRangeInput constrains each picker with the other’s value as well as reporting the error, so an inverted range is hard to enter in the first place.',
    ],
  },
  render: (p, st) => {
    const common = {
      size: size(p.size),
      clearable: b(p.clearable),
      disabled: b(p.disabled) || st === 'disabled',
      readOnly: b(p.readOnly) || st === 'readonly',
      validation: val(p.validation) === 'none' && st === 'error' ? ('error' as const) : val(p.validation),
      forceState: st,
    };
    const which = s(p.which, 'Date');
    if (which === 'Range') {
      return (
        <DateRangeInput
          value={b(p.invertRange) ? { from: '2026-08-28', to: '2026-08-01' } : { from: '2026-08-01', to: '2026-08-28' }}
          onChange={noop}
          size={size(p.size)}
          maxSpanDays={366}
          disabled={common.disabled}
          readOnly={common.readOnly}
        />
      );
    }
    if (which === 'Time') {
      return <FormField label="Shift start" disabled={common.disabled} readOnly={common.readOnly}><TimeInput value="08:30" onChange={noop} step={900} {...common} /></FormField>;
    }
    if (which === 'DateTime') {
      return <FormField label="Incident at" disabled={common.disabled} readOnly={common.readOnly}><DateTimeInput value="2026-08-09T14:20" onChange={noop} {...common} /></FormField>;
    }
    return (
      <FormField label="Date" required helpText="This is a hint text to help the user." disabled={common.disabled} readOnly={common.readOnly}>
        <DateInput value="" onChange={noop} min="2026-01-01" helpTooltip="Choose a date from the calendar." {...common} />
      </FormField>
    );
  },
  code: p => s(p.which) === 'Range'
    ? `<DateRangeInput value={range} onChange={setRange} maxSpanDays={366} />`
    : `<FormField label="Start date" required>\n  <DateInput value={startDate} onChange={setStartDate} min={today} />\n</FormField>`,
};

/* ── File & OTP ────────────────────────────────────────────────────────────*/

export const fileInputDef: ComponentDef = {
  id: 'file-input',
  name: 'FileInput',
  category: 'forms',
  description: 'File selection with drag-drop, type/size validation and a removable list. Validates BEFORE handing anything to the caller — a silent drop is the worst outcome for an evidence upload.',
  status: 'stable',
  componentPath: 'src/ui/forms/FileInput.tsx',
  importFrom: '@ui',
  migration: { rawPatterns: ['type="file"'], nextSurface: 'HR Onboarding' },

  props: {
    accept:     { type: 'text',    label: 'Accept', default: '.pdf,.png,.jpg' },
    multiple:   { type: 'boolean', label: 'Multiple', default: true },
    maxSizeMb:  { type: 'number',  label: 'Max size (MB)', default: 10, min: 1, max: 100 },
    maxFiles:   { type: 'number',  label: 'Max files', default: 5, min: 1, max: 20 },
    validation: { type: 'select',  label: 'Validation', options: ['none', 'error', 'warning', 'success'], default: 'none' },
    disabled:   { type: 'boolean', label: 'Disabled', default: false },
    trigger:    { type: 'boolean', label: 'Compact trigger', default: false },
    size:       { type: 'select',  label: 'Trigger size', options: ['sm', 'md', 'lg'], default: 'md' },
  },
  style: [
    { label: 'Drop zone', controls: [
      { name: '--ui-file-bg',            label: 'Background', kind: 'color' },
      { name: '--ui-file-border',        label: 'Border', kind: 'color' },
      { name: '--ui-file-border-active', label: 'Border — hover/drag', kind: 'color' },
      { name: '--ui-file-radius',        label: 'Corner radius', kind: 'size' },
      { name: '--ui-file-pad',           label: 'Padding', kind: 'size' },
    ] },
    /* The trigger has no tokens of its own ON PURPOSE — it is drawn entirely
       from `--ui-button-*`, so re-theming Button re-themes it and the two can
       never drift. Edit it on the Button entry. */
  ],
  states: ['default', 'hover', 'focus', 'disabled', 'error'],
  a11y: {
    role: null,
    name: 'The FormField label; the accepted types and limits are wired as the description.',
    keyboard: [{ keys: 'Enter / Space', does: 'Opens the OS picker — the input is real and focusable, just visually hidden.' }],
    focus: 'The drop zone shows focus via :focus-within.',
    notes: [
      'Selection only — it does not upload. Progress belongs to whoever owns the request; baking a transport in would make it unusable for the app’s three upload paths.',
      'The native input is reset after each pick so choosing the SAME file again still fires a change.',
      'The compact trigger is a <label> wrapping the real input, NOT a Button. Activating a file picker is native label behaviour; Button renders <button>/<a> and does not take a polymorphic escape hatch. It borrows the --ui-button-* tokens so the two stay visually identical without sharing an element.',
    ],
  },
  render: (p, st) => b(p.trigger) ? (
    <FileInput
      files={[]}
      onChange={noop}
      accept={s(p.accept, '.pdf')}
      multiple={b(p.multiple)}
      maxSizeMb={n(p.maxSizeMb, 10)}
      triggerLabel="Attach file"
      size={s(p.size, 'md') as 'sm' | 'md' | 'lg'}
      disabled={b(p.disabled) || st === 'disabled'}
      forceState={st}
      aria-label="Attach file"
    />
  ) : (
    <FormField label="Evidence" helpText="Attached to the requirement and recorded on the audit trail." disabled={b(p.disabled) || st === 'disabled'}>
      <FileInput
        files={[]}
        onChange={noop}
        accept={s(p.accept, '.pdf')}
        multiple={b(p.multiple)}
        maxSizeMb={n(p.maxSizeMb, 10)}
        maxFiles={n(p.maxFiles, 5)}
        validation={val(p.validation) === 'none' && st === 'error' ? 'error' : val(p.validation)}
        disabled={b(p.disabled) || st === 'disabled'}
        forceState={st}
      />
    </FormField>
  ),
  code: p => b(p.trigger) ? `<FileInput
  files={files}
  onChange={setFiles}
  accept="${s(p.accept, '.pdf')}"
  triggerLabel="Attach file"
  size="${s(p.size, 'md')}"
/>` : `<FormField label="Evidence">
  <FileInput
    files={files}
    onChange={setFiles}
    accept="${s(p.accept, '.pdf')}"${b(p.multiple) ? '\n    multiple' : ''}
    maxSizeMb={${n(p.maxSizeMb, 10)}}
    onReject={r => toast.error(r[0].message)}
  />
</FormField>`,
};

export const themeModeSwitchDef: ComponentDef = {
  id: 'theme-mode-switch',
  name: 'Theme Mode Switch',
  category: 'selection',
  description: 'The app appearance control for switching immediately between light and dark mode. Its consumer owns authenticated preference persistence.',
  status: 'stable',
  componentPath: 'src/ui/patterns/ThemeModeSwitch.tsx',
  importFrom: '@ui',
  props: {
    theme: { type: 'select', label: 'Theme', options: ['light', 'dark'], default: 'light' },
    pending: { type: 'boolean', label: 'Saving', default: false },
    disabled: { type: 'boolean', label: 'Disabled', default: false },
  },
  style: [
    { label: 'Track', controls: [
      { name: '--ui-theme-switch-width', label: 'Width', kind: 'size' },
      { name: '--ui-theme-switch-height', label: 'Height', kind: 'size' },
      { name: '--ui-theme-switch-light-bg', label: 'Light fill', kind: 'color' },
      { name: '--ui-theme-switch-dark-bg', label: 'Dark fill', kind: 'color' },
      { name: '--ui-theme-switch-knob', label: 'Knob', kind: 'color' },
    ] },
    { label: 'Icons', controls: [
      { name: '--ui-theme-switch-sun', label: 'Sun', kind: 'color' },
      { name: '--ui-theme-switch-moon', label: 'Moon', kind: 'color' },
    ] },
  ],
  states: ['default', 'selected', 'focus', 'disabled', 'loading'],
  compare: ['default', 'selected', 'focus', 'disabled'],
  a11y: {
    role: 'switch',
    name: 'Dark mode by default; consumers may supply a context-specific label.',
    keyboard: [{ keys: 'Space / Enter', does: 'Toggles the appearance preference using native button behaviour.' }],
    focus: 'A visible focus ring surrounds the whole track.',
    notes: ['Animation is disabled when the user prefers reduced motion.', 'Use role="menuitemcheckbox" when this control appears inside an ARIA menu.'],
  },
  render: (p, st) => (
    <ThemeModePreview
      initialTheme={st === 'selected' ? 'dark' : s(p.theme, 'light') === 'dark' ? 'dark' : 'light'}
      pending={b(p.pending) || st === 'loading'}
      disabled={b(p.disabled) || st === 'disabled'}
      forceFocus={st === 'focus'}
    />
  ),
  code: () => `<ThemeModeSwitch
  theme={theme}
  onChange={setTheme}
  label="Dark mode"
/>`,
};

export const colorPickerDef: ComponentDef = {
  id: 'color-picker',
  name: 'ColorPicker',
  category: 'forms',
  description: 'Accessible spectrum, hue, opacity and a user-curated saved-color palette for styling workflows.',
  status: 'stable',
  componentPath: 'src/ui/forms/ColorPicker.tsx',
  importFrom: '@ui',
  props: {
    defaultValue: { type: 'text', label: 'Starting color', default: '#7f56d9' },
    alpha: { type: 'boolean', label: 'Opacity control', default: true },
    disabled: { type: 'boolean', label: 'Disabled', default: false },
  },
  style: [{ label: 'Picker surface', controls: [
    { name: '--ui-picker-bg', label: 'Background', kind: 'color', linkedTo: 'var(--ui-color-surface-default)' },
    { name: '--ui-picker-border', label: 'Border', kind: 'color', linkedTo: 'var(--ui-color-border-default)' },
    { name: '--ui-picker-radius', label: 'Corner radius', kind: 'size' },
    { name: '--ui-picker-focus', label: 'Focus color', kind: 'color', linkedTo: 'var(--ui-color-selection-border)' },
  ] }],
  states: ['default', 'focus', 'disabled'],
  a11y: {
    role: 'group',
    name: 'Required aria-label identifies the color purpose.',
    keyboard: [
      { keys: 'Tab', does: 'Moves through the spectrum, sliders, value field and saved colors.' },
      { keys: 'Arrow keys', does: 'Adjusts the focused hue or opacity range control.' },
    ],
    focus: 'Every interactive control has a visible focus treatment; disabled removes the spectrum from the tab order.',
    notes: ['The component is controlled or uncontrolled. Preview content is never part of published styling configuration.'],
  },
  render: (p, state) => <ColorPicker defaultValue={s(p.defaultValue, '#7f56d9')} alpha={b(p.alpha)}
    disabled={b(p.disabled) || state === 'disabled'} class={state === 'focus' ? 'is-force-focus' : undefined}
    aria-label="Color picker" />,
  code: p => `<ColorPicker\n  value={selectedColor}\n  onChange={setSelectedColor}\n  savedColors={savedColors}\n  onSaveColor={saveColor}\n  onRemoveSavedColor={removeColor}${b(p.alpha) ? '\n  alpha' : ''}\n  aria-label="Choose color"\n/>`,
};

export const otpInputDef: ComponentDef = {
  id: 'otp-input',
  name: 'OtpInput',
  category: 'forms',
  description: 'Segmented one-time-code entry. Pasting a whole code fills every box, and Backspace on an empty box steps back — the two things that make or break these.',
  status: 'stable',
  componentPath: 'src/ui/forms/FileInput.tsx',
  importFrom: '@ui',

  props: {
    length:     { type: 'number', label: 'Length', default: 6, min: 4, max: 8 },
    value:      { type: 'text',   label: 'Value', default: '1234' },
    validation: { type: 'select', label: 'Validation', options: ['none', 'error', 'success'], default: 'none' },
    disabled:   { type: 'boolean', label: 'Disabled', default: false },
  },
  style: [
    { label: 'Boxes', controls: [
      { name: '--ui-otp-size',   label: 'Box size', kind: 'size' },
      { name: '--ui-otp-gap',    label: 'Gap', kind: 'size' },
      { name: '--ui-otp-radius', label: 'Corner radius', kind: 'size' },
      { name: '--ui-otp-bg', label: 'Field background', kind: 'color' },
      { name: '--ui-otp-border', label: 'Field border', kind: 'color' },
      { name: '--ui-otp-active-bg', label: 'Active background', kind: 'color' },
      { name: '--ui-otp-caret', label: 'Caret color', kind: 'color' },
    ] },
  ],
  states: ['default', 'focus', 'disabled', 'error'],
  a11y: {
    role: 'group',
    name: 'Defaults to "N-digit code"; override with aria-label.',
    keyboard: [
      { keys: '← / →',     does: 'Moves between boxes.' },
      { keys: 'Backspace', does: 'Clears, or steps back when the box is already empty.' },
      { keys: 'Paste',     does: 'Fills every box from one paste.' },
    ],
    focus: 'Focus advances automatically as digits are entered.',
    notes: ['The first box carries autoComplete="one-time-code" so the OS can offer the SMS code.'],
  },
  render: (p, st) => (
    <OtpPreview
      initialValue={s(p.value, '1234')}
      length={n(p.length, 6)}
      disabled={b(p.disabled) || st === 'disabled'}
      validation={st === 'error' ? 'error' : (s(p.validation, 'none') as never)}
      forceFocus={st === 'focus'}
    />
  ),
  code: p => `<OtpInput value={code} onChange={setCode} length={${n(p.length, 6)}} onComplete={verify} />`,
};

/* ── Select ────────────────────────────────────────────────────────────────*/

const DEPARTMENTS = [
  { value: 'ops',   label: 'Operations',  subtitle: '148 employees' },
  { value: 'eng',   label: 'Engineering', subtitle: '62 employees' },
  { value: 'hse',   label: 'HSE',         subtitle: '19 employees' },
  { value: 'fin',   label: 'Finance',     subtitle: '24 employees' },
  { value: 'hr',    label: 'People',      subtitle: '11 employees' },
  { value: 'legal', label: 'Legal',       subtitle: 'Vacant', disabled: true },
];

const GROUPED_DEPARTMENTS = [
  { group: 'Operational', options: DEPARTMENTS.slice(0, 3) },
  { group: 'Corporate',   options: DEPARTMENTS.slice(3) },
];

/**
 * ONE entry for "choose from a list", with four MODES.
 *
 * Single, searchable, async and multiple were three cards. They share one
 * keyboard core (`useListboxKeyboard`), one popup (`AnchoredPopup`), one option
 * list and one recipe — so presenting them as separate components told the
 * reader there were three things to learn when there is one.
 *
 * The three EXPORTS remain, because their interaction genuinely differs
 * (press-to-open vs type-to-filter; commit vs toggle) and so do their value
 * contracts (T vs T[]). That is the bar for a separate primitive; being a
 * different colour is not.
 */
export const selectDef: ComponentDef = {
  id: 'select',
  name: 'Select',
  category: 'selection',
  description: 'Choosing from a list — ONE control, four modes. Single, searchable, async and multiple share one keyboard core, one popup, one option list and one recipe.',
  status: 'stable',
  componentPath: 'src/ui/forms/Select.tsx',
  importFrom: '@ui',
  migration: {
    replaces: ['.ui-select'],
    deprecatedImports: ['SelectInput', 'EntityPicker'],
    rawPatterns: ['<select'],
    nextSurface: 'Card',
    notes: [
      'Three exports (Select / Combobox / MultiSelect) for four modes. They are NOT three implementations — the keyboard model, popup, option list and CSS are shared. They stay separate only because press-to-open and type-to-filter are different interactions, and T vs T[] is a different contract.',
    ],
  },

  props: {
    mode:       { type: 'select',    label: 'Mode', options: ['Single', 'Searchable', 'Async', 'Multiple'], default: 'Single',
                  help: 'Single = Select · Searchable/Async = Combobox · Multiple = MultiSelect. Same core, different interaction.' },
    grouped:    { type: 'boolean',   label: 'Grouped options', default: true },
    clearable:  { type: 'boolean',   label: 'Clearable', default: true },
    size:       { type: 'segmented', label: 'Size', options: ['sm', 'md', 'lg'], default: 'md' },
    validation: { type: 'select',    label: 'Validation', options: ['none', 'error', 'warning', 'success'], default: 'none' },
    required:   { type: 'boolean',   label: 'Required', default: false },
    loading:    { type: 'boolean',   label: 'Loading', default: false },
    disabled:   { type: 'boolean',   label: 'Disabled', default: false },
    readOnly:   { type: 'boolean',   label: 'Read-only', default: false },
  },

  style: [
    { label: 'Trigger', controls: [
      { name: '--ui-control-md',           label: 'Height (md)', kind: 'size' },
      { name: '--ui-control-radius',       label: 'Corner radius', kind: 'size' },
      { name: '--ui-control-border',       label: 'Border', kind: 'color' },
      { name: '--ui-control-border-focus', label: 'Border — focus', kind: 'color' },
    ] },
    { label: 'Dropdown surface', controls: [
      { name: '--ui-popup-bg',     label: 'Background', kind: 'color' },
      { name: '--ui-popup-border', label: 'Border', kind: 'color' },
      { name: '--ui-popup-radius', label: 'Corner radius', kind: 'size' },
      { name: '--ui-popup-pad',    label: 'Padding', kind: 'size' },
    ] },
    { label: 'Options', controls: [
      { name: '--ui-option-height',      label: 'Row height', kind: 'size' },
      { name: '--ui-option-pad-x',       label: 'Row padding X', kind: 'size' },
      { name: '--ui-option-bg-active',   label: 'Keyboard cursor fill', kind: 'color' },
      { name: '--ui-option-bg-selected', label: 'Selected fill', kind: 'color-alpha' },
      { name: '--ui-option-subtitle-fg', label: 'Subtitle text', kind: 'color' },
      { name: '--ui-option-group-fg',    label: 'Group header', kind: 'color' },
    ] },
    { label: 'Multiple — chips', controls: [
      { name: '--ui-ms-chip-bg',     label: 'Chip fill', kind: 'color' },
      { name: '--ui-ms-chip-border', label: 'Chip border', kind: 'color' },
      { name: '--ui-ms-chip-radius', label: 'Chip radius', kind: 'size' },
      { name: '--ui-ms-tick-size',   label: 'Tick size', kind: 'size' },
    ] },
  ],

  states: ['default', 'hover', 'focus', 'open', 'disabled', 'readonly', 'error'],
  compare: ['default', 'focus', 'error', 'disabled', 'readonly'],

  a11y: {
    role: 'combobox (trigger) + listbox (surface) + option (rows)',
    name: 'The FormField label. Standalone, pass aria-label.',
    keyboard: [
      { keys: 'Enter / arrows', does: 'Opens the list, positioned on the current value.' },
      { keys: 'Down / Up',      does: 'Moves the cursor, skipping disabled options and wrapping at the ends.' },
      { keys: 'Home / End',     does: 'First / last selectable option.' },
      { keys: 'a-z',            does: 'Typeahead in Single mode; filters in Searchable mode.' },
      { keys: 'Enter',          does: 'Commits (single) or toggles and stays open (multiple).' },
      { keys: 'Escape',         does: 'Closes without changing the value. Does NOT bubble to a parent dialog.' },
      { keys: 'Tab',            does: 'Closes and lets focus continue.' },
    ],
    focus: 'DOM focus stays on the trigger; the cursor is expressed with aria-activedescendant, and returns to the trigger on commit.',
    notes: [
      'The list is portalled to <body> - a fixed surface inside a transformed ancestor (any board tile) would be clipped by it.',
      'Active (keyboard cursor) and selected (current value) are styled differently on purpose, or arrowing looks like it is changing the value.',
      'Multiple uses aria-selected, not aria-checked, and does NOT close on pick - five departments one dropdown-open at a time is miserable.',
      'Async responses are sequence-checked, so a slow early request can never overwrite a fast later one.',
    ],
  },

  render: (p, st) => {
    const mode = s(p.mode, 'Single');
    const opts = b(p.grouped) ? GROUPED_DEPARTMENTS : DEPARTMENTS;
    const common = {
      size: size(p.size),
      disabled: b(p.disabled) || st === 'disabled',
      readOnly: b(p.readOnly) || st === 'readonly',
      validation: val(p.validation) === 'none' && st === 'error' ? ('error' as const) : val(p.validation),
      forceState: st,
    };

    if (mode === 'Multiple') {
      return (
        <FormField label="Departments" required={b(p.required)} helpText="Restricts the report to these departments." disabled={common.disabled} readOnly={common.readOnly}>
          <MultiSelect values={['ops', 'hse', 'fin', 'hr']} onChange={noop} options={DEPARTMENTS} maxChips={3} {...common} />
        </FormField>
      );
    }
    if (mode === 'Async') {
      const search = (q: string): Promise<typeof DEPARTMENTS> => new Promise(res =>
        setTimeout(() => res(DEPARTMENTS.filter(o => o.label.toLowerCase().includes(q.toLowerCase()))), 400));
      return (
        <FormField label="Department" required={b(p.required)} helpText="Debounced lookup with real loading and error states." disabled={common.disabled} readOnly={common.readOnly}>
          <Combobox value="" onChange={noop} search={search} placeholder="Type to search..." clearable={b(p.clearable)} {...common} />
        </FormField>
      );
    }
    if (mode === 'Searchable') {
      return (
        <FormField label="Department" required={b(p.required)} disabled={common.disabled} readOnly={common.readOnly}>
          <Combobox value="" onChange={noop} options={DEPARTMENTS} placeholder="Type to filter..." clearable={b(p.clearable)} {...common} />
        </FormField>
      );
    }
    return (
      <FormField label="Department" required={b(p.required)} disabled={common.disabled} readOnly={common.readOnly}>
        <Select value="ops" onChange={noop} options={opts} placeholder="Select a department..." clearable={b(p.clearable)} loading={b(p.loading)} {...common} />
      </FormField>
    );
  },

  code: p => {
    const mode = s(p.mode, 'Single');
    if (mode === 'Multiple') return '<FormField label="Departments">\n  <MultiSelect values={deptIds} onChange={setDeptIds} options={DEPARTMENTS} maxChips={3} />\n</FormField>';
    if (mode === 'Async') return '<FormField label="Department">\n  <Combobox value={deptId} onChange={setDeptId} search={q => api.searchDepartments(q)} />\n</FormField>';
    if (mode === 'Searchable') return '<FormField label="Department">\n  <Combobox value={deptId} onChange={setDeptId} options={DEPARTMENTS} />\n</FormField>';
    return '<FormField label="Department">\n  <Select value={deptId} onChange={setDeptId} options={DEPARTMENTS} clearable />\n</FormField>';
  },
};

export const FORM_DEFS: readonly ComponentDef[] = [
  textInputDef,
  dateInputDef,
  fileInputDef,
  colorPickerDef,
  otpInputDef,
  checkboxDef,
  radioGroupDef,
  switchDef,
  themeModeSwitchDef,
  selectDef,
];
