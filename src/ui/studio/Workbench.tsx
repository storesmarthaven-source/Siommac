/**
 * src/ui/studio/Workbench.tsx — the generic component workbench.
 *
 * Button is the first complete editing experience. Other registered components
 * continue to use the generated overview until their recipe schemas are added.
 *
 * There is no second registry. The workbench reads the canonical ComponentDef,
 * including its render function, sample props and governed style schema.
 *
 * ⭐ The specimen is the REAL component. `def.render(props, state)` calls the
 * canonical implementation, so editing `Button.recipe.css` changes what the
 * Studio shows, with no approximation to keep in sync. That is the whole point;
 * a `<div class="studio-button-demo">` would make this furniture.
 *
 * The canvas sits inside `data-ui-preview-scope`; the editor controls and
 * viewport buttons stay outside it. Phase 3 can then push a draft theme into the
 * specimen without touching Studio chrome, and none of this needs revisiting.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import {
  CATEGORY_LABELS, COMPOUND_OF, findComponent,
  propsForAxis,
  type ComponentDef, type ComponentFamily, type PropValues, type PropControl,
} from '../registry';
import { type UiState } from '../tokens';
import { SpecialTreatments } from '../special/SpecialTreatments';
import { type GalleryDraft } from '../gallery/galleryStore';
import { GeneratedStyleControls, IconPicker, RecipeStyleEditor, StudioColorControl } from './RecipeStyleEditor';
import { LucideIcon, LUCIDE_NAMES, type LucideName } from '../LucideIcon';
import { buttonFamilyPreviewProps } from './buttonFamilyPreview';
import { PreviewScope } from './PreviewScope';

/**
 * Playground controls, grouped for a narrow inspector.
 *
 * The grouping is PRESENTATION ONLY — a control whose name is unrecognised lands
 * in "Options" rather than being hidden or mislabelled, so a new prop can never
 * disappear from the panel. Deliberately not stored in the registry: how to lay
 * out an inspector is not part of a component's contract, and adding a `group`
 * field would mean editing 23 definitions to describe a side panel.
 */
const CONTROL_GROUPS: { title: string; names: string[] }[] = [
  { title: 'Content', names: ['label', 'text', 'placeholder', 'iconLeft', 'iconRight', 'icon', 'iconSide', 'iconOnly', 'helpText', 'tooltipEnabled', 'tooltipText', 'suffix', 'prefix', 'required'] },
  { title: 'Appearance', names: ['variant', 'tone', 'size', 'contrast', 'shape', 'density', 'accent'] },
  { title: 'States', names: ['disabled', 'loading', 'loadingText', 'pressed', 'readOnly', 'error', 'checked', 'selected', 'validation'] },
  { title: 'More options', names: ['action', 'href', 'fullWidth', 'clearable', 'multiline', 'rows'] },
];

const FRIENDLY_VALUES: Record<string, string> = {
  sm: 'Small', md: 'Medium', lg: 'Large',
  None: 'No icon', Trash2: 'Trash', ArrowRight: 'Arrow right', ChevronRight: 'Chevron right',
};

const TEXT_INPUT_VARIANT_ICONS: Record<string, LucideName> = {
  Text: 'Type',
  Search: 'Search',
  Password: 'LockKeyhole',
  Number: 'Hash',
  Currency: 'BadgeDollarSign',
  Percentage: 'Percent',
  Email: 'Mail',
  URL: 'Link',
  Phone: 'Phone',
  'Multi-line': 'AlignLeft',
};

function friendlyValue(value: string): string {
  return FRIENDLY_VALUES[value] ?? value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/^./, first => first.toUpperCase());
}
function groupControls(
  def: ComponentDef,
  /** Props the preview already exposes as an axis — a control would fight it. */
  omit: readonly string[] = [],
): { title: string; entries: [string, PropControl][] }[] {
  const all = Object.entries(def.props ?? {}).filter(([n]) => n !== 'size' && !omit.includes(n));
  const taken = new Set<string>();
  const out = CONTROL_GROUPS.map(g => {
    const entries = all.filter(([n]) => g.names.includes(n));
    entries.forEach(([n]) => taken.add(n));
    return { title: g.title, entries };
  }).filter(g => g.entries.length > 0);

  const rest = all.filter(([n]) => !taken.has(n));
  if (rest.length > 0) out.push({ title: 'Options', entries: rest });
  return out;
}

function isStateControlCoveredByPreview(def: ComponentDef, name: string): boolean {
  const states = new Set(def.states ?? []);
  const representedState: Record<string, string> = {
    disabled: 'disabled',
    loading: 'loading',
    readOnly: 'readonly',
    error: 'error',
  };
  if (name === 'validation') {
    return ['error', 'warning', 'success'].some(state => states.has(state as UiState));
  }
  const state = representedState[name];
  return state ? states.has(state as UiState) : false;
}

function isRelevantPreviewControl(def: ComponentDef, shown: PropValues, previewState: UiState, name: string): boolean {
  if (name === 'label') return false;
  if (isStateControlCoveredByPreview(def, name)) return false;
  if (def.id !== 'text-input') return true;

  const type = String(shown.type ?? 'Text');
  if (name === 'message') return previewState === 'error' || previewState === 'warning' || previewState === 'success';
  if (name === 'charCount') return type === 'Multi-line';
  if (name === 'prefix') return type === 'Currency' || type === 'Phone';
  if (name === 'suffix') return type === 'Number' || type === 'Percentage';
  if (name === 'clearable') return type === 'Search';
  if (name === 'multiline' || name === 'rows') return type === 'Multi-line';
  return true;
}

/* ── Playground controls ───────────────────────────────────────────────────── */

function Control({ name, control, value, onChange, disabled = false }: {
  name: string; control: PropControl; value: string | number | boolean;
  onChange: (v: string | number | boolean) => void;
  /** Locked while the canvas shows canonical defaults. */
  disabled?: boolean;
}): VNode {
  const id = `wb-${name}`;

  if (control.type === 'boolean') {
    return (
      <>
        <label class="sds-toggle-row" for={id}>
          <span>{control.label}</span>
          <input id={id} type="checkbox" checked={Boolean(value)} disabled={disabled}
            onChange={e => onChange((e.target as HTMLInputElement).checked)} />
        </label>
        {control.help && <details class="sds-ctl__help"><summary>About this setting</summary><p>{control.help}</p></details>}
      </>
    );
  }

  return (
    <div class="sds-ctl">
      <label class="sds-ctl__label" for={id}>{control.label}</label>

      {control.type === 'select' && (
        <select id={id} class="sds-ctl__input" value={String(value)} disabled={disabled}
          onChange={e => onChange((e.target as HTMLSelectElement).value)}>
          {control.options.map(o => <option value={o} key={o}>{friendlyValue(o)}</option>)}
        </select>
      )}

      {control.type === 'segmented' && (
        <div class="sds-seg sds-seg--wide" role="group" aria-label={control.label}>
          {control.options.map(o => (
            <button type="button" key={o} disabled={disabled}
              class={`sds-seg__btn${String(value) === o ? ' is-on' : ''}`}
              aria-pressed={String(value) === o}
              onClick={() => onChange(o)}>{friendlyValue(o)}</button>
          ))}
        </div>
      )}


      {control.type === 'text' && (
        <input id={id} type="text" class="sds-ctl__input" value={String(value)} disabled={disabled}
          placeholder={control.placeholder}
          onInput={e => onChange((e.target as HTMLInputElement).value)} />
      )}

      {control.type === 'number' && (
        <input id={id} type="number" class="sds-ctl__input" value={Number(value)} disabled={disabled}
          min={control.min} max={control.max} step={control.step}
          onInput={e => onChange(Number((e.target as HTMLInputElement).value))} />
      )}

      {control.type === 'icon' && (
        <IconPicker
          id={id}
          label={control.label}
          value={String(value)}
          variant="outline"
          position="leading"
          recommendations={control.recommendations?.filter((name): name is LucideName => LUCIDE_NAMES.includes(name as LucideName))}
          onChange={onChange}
        />
      )}

      {control.help && <details class="sds-ctl__help"><summary>About this setting</summary><p>{control.help}</p></details>}
    </div>
  );
}

/**
 * The exported symbol, read from the definition's own code example.
 *
 * A catalogue name may differ from the import — Button is shown as "Action
 * Button" so it reads as a sibling of Dropdown and Split Button. Deriving the
 * symbol from `def.code` rather than from `def.name` means the badge and the
 * Code tab cannot disagree: they have one source. Falls back to the name with
 * spaces removed for a definition that ships no snippet.
 */
/* ── Workbench ─────────────────────────────────────────────────────────────── */

export interface WorkbenchProps {
  def: ComponentDef;
  /** Set when `def` belongs to a family — renders the subtype selector. */
  family?: ComponentFamily;
  onSelectMember?: (componentId: string) => void;
  draft: GalleryDraft;
}

interface CompoundButtonEditorProps {
  def: ComponentDef;
  shown: PropValues;
  specimen: (props: PropValues, state?: UiState) => VNode | null;
  onSet: (name: string, value: string | number | boolean) => void;
  onEditFoundation?: () => void;
}

/**
 * Dropdown and Split Button are separate interaction contracts, but they are
 * still members of the Button family. Keep their focused editing experience in
 * the same preview-first shell as the governed Button patterns instead of
 * falling back to the catalogue's generic component page.
 */
function CompoundButtonEditor({ def, shown, specimen, onSet, onEditFoundation }: CompoundButtonEditorProps): VNode {
  const ownership = COMPOUND_OF[def.id] ?? 'Button family';
  const [previewByVariant, setPreviewByVariant] = useState<Record<string, PropValues>>({});
  const [stateByVariant, setStateByVariant] = useState<Record<string, UiState>>({});
  const variantControl = def.props?.variant;
  const variants = variantControl && (variantControl.type === 'select' || variantControl.type === 'segmented')
    ? variantControl.options : [];
  const selectedVariant = String(shown.variant ?? variants[0] ?? 'primary');
  const defaultIconColor = selectedVariant === 'primary' || selectedVariant === 'danger' ? '#ffffff' : '#1b2d54';
  const previewState = stateByVariant[selectedVariant] ?? 'default';
  const previewPropsFor = (variant: string): PropValues => ({
    ...shown,
    variant,
    iconTreatment: 'outline',
    iconColor: variant === 'primary' || variant === 'danger' ? '#ffffff' : '#1b2d54',
    ...(previewByVariant[variant] ?? {}),
  });
  const previewProps = previewPropsFor(selectedVariant);
  const setPreviewProp = (name: string, value: string | number | boolean): void => {
    setPreviewByVariant(previous => ({
      ...previous,
      [selectedVariant]: { ...(previous[selectedVariant] ?? {}), [name]: value },
    }));
  };
  const iconControl = def.props?.iconLeft;
  const recommendedIcons = iconControl && (iconControl.type === 'select' || iconControl.type === 'segmented')
    ? iconControl.options.filter((option): option is LucideName =>
      option !== 'None' && LUCIDE_NAMES.includes(option as LucideName)) : [];
  const reset = (): void => {
    setPreviewByVariant(previous => {
      return Object.fromEntries(
        Object.entries(previous).filter(([variant]) => variant !== selectedVariant),
      );
    });
    setStateByVariant(previous => ({ ...previous, [selectedVariant]: 'default' }));
  };

  return (
    <div class="sds-owned-button" data-ui-preview-scope>
      <section class="sds-owned-button__editor" aria-label={`${def.name} editor`}>
        <div class="sds-button-editor__main">
          <div class="sds-owned-button__stage">
          <header>
            <div><span>Live preview</span><strong>{def.name}</strong></div>
            <small>Updates instantly</small>
          </header>
          <div class="sds-owned-button__canvas">
            <div class="sds-owned-button__specimen">{specimen(previewProps, previewState)}</div>
          </div>
          {variants.length > 0 && (
            <section class="sds-owned-button__variants" aria-labelledby={`${def.id}-variants-title`}>
              <header>
                <div><h3 id={`${def.id}-variants-title`}>Variants</h3><p>Select a style to preview it.</p></div>
                <span>{variants.length} available</span>
              </header>
              <div role="radiogroup" aria-label={`${def.name} variant`}>
                {variants.map(variant => (
                  <article key={variant} class={shown.variant === variant ? 'is-on' : ''}>
                    <div class="sds-owned-button__variant-preview">{specimen({ ...previewPropsFor(variant), size: 'md' }, 'default')}</div>
                    <footer><strong>{friendlyValue(variant)}</strong></footer>
                    <button type="button" role="radio" aria-checked={shown.variant === variant}
                      aria-label={`Select ${friendlyValue(variant)} variant`}
                      onClick={() => onSet('variant', variant)} />
                  </article>
                ))}
              </div>
            </section>
          )}
          <aside>
            <strong>{ownership}</strong>
            <p>
              This component inherits the published Action Button appearance and adds its own
              menu behaviour. Settings here only change this preview.
            </p>
            <span>Button styling stays linked</span>
          </aside>
          </div>

          {def.examples && def.examples.length > 0 && <section class="sds-button-use" aria-labelledby={`${def.id}-use-title`}>
            <header><h3 id={`${def.id}-use-title`}>Common application use</h3><p>Real examples of how this control appears in SIOMAC.</p></header>
            <div class="sds-use-context">
              {def.examples.map(example => <article key={example.id}><span class="ctx-kicker">{example.title}</span><div>{example.render()}</div></article>)}
            </div>
          </section>}
        </div>

        <aside class="sds-owned-button__settings" aria-label={`${def.name} settings`}>
          <header>
            <div><span>Preview settings</span><strong>Try the {def.name}</strong></div>
            <button type="button" onClick={reset}>Reset</button>
          </header>
          <div class="sds-owned-button__controls">
            <section class="sds-owned-button__preview-options">
              <h4>Preview options</h4>
              <label class="sds-ctl" for={`${def.id}-state`}>
                <span class="sds-ctl__label">State</span>
                <select id={`${def.id}-state`} class="sds-ctl__input" value={previewState}
                  onChange={event => setStateByVariant(previous => ({ ...previous, [selectedVariant]: (event.target as HTMLSelectElement).value as UiState }))}>
                  {(def.states ?? ['default']).map(state => <option value={state}>{friendlyValue(state)}</option>)}
                </select>
              </label>
              <div class="sds-owned-button__icon-picker">
                <span>Leading icon</span>
                <IconPicker id={`${def.id}-leading-icon`} label="Leading icon"
                  value={String(previewProps.iconLeft ?? 'None')} variant={selectedVariant as never}
                  position="leading" recommendations={recommendedIcons}
                  onChange={value => setPreviewProp('iconLeft', value)} />
              </div>
              <div class="sds-owned-button__icon-style">
                <span>Icon treatment</span>
                <div role="radiogroup" aria-label="Icon treatment">
                  {['outline', 'circle', 'filled-circle'].map(treatment => (
                    <button type="button" role="radio" aria-checked={previewProps.iconTreatment === treatment}
                      class={previewProps.iconTreatment === treatment ? 'is-on' : ''} onClick={() => setPreviewProp('iconTreatment', treatment)}>
                      {friendlyValue(treatment)}
                    </button>
                  ))}
                </div>
              </div>
              <StudioColorControl id={`${def.id}-icon-color`} label="Icon"
                value={String(previewProps.iconColor ?? defaultIconColor)} onChange={value => setPreviewProp('iconColor', value)} />
            </section>
            {groupControls(def)
              .map(group => ({
                ...group,
                entries: group.entries.filter(([name, control]) =>
                  name !== 'iconLeft' && name !== 'variant' && control.type !== 'text'),
              }))
              .filter(group => group.entries.length > 0)
              .map(group => (
              <section key={group.title}>
                <h4>{group.title}</h4>
                {group.entries.map(([name, control]) => (
                  <Control key={name} name={name} control={control}
                    value={previewProps[name] ?? ''} onChange={value => setPreviewProp(name, value)} />
                ))}
              </section>
            ))}
          </div>
          <footer>
            <span aria-hidden="true">↳</span>
            <p><strong>Shape and colors</strong><small>Change them in Action Button. The settings above only change this preview.</small></p>
            {onEditFoundation && <button type="button" onClick={onEditFoundation}>Change shape and colors</button>}
          </footer>
        </aside>
      </section>

    </div>
  );
}

export function Workbench({ def, family, onSelectMember, draft }: WorkbenchProps): VNode {
  /*
    Preview values are kept PER COMPONENT + PREVIEW VARIANT.
    `useState(() => defaultProps(def))` would keep the first subtype's values
    when `def` changed — Action Button's `iconSide` surviving into Split Button.
    A component-only key has the same defect one level down: Search input
    settings would leak into Email. The composite key gives every variant its
    own props and UI state without remounting the workbench.
  */
  const [valuesByPreview, setValuesByPreview] = useState<Record<string, PropValues>>({});
  const [stateByPreview, setStateByPreview] = useState<Record<string, UiState>>({});
  const [selectedAxisById, setSelectedAxisById] = useState<Record<string, string>>({});
  const previewAxis = def.previewAxis ?? (def.props?.variant ? 'variant' : undefined);
  const componentDefaults = buttonFamilyPreviewProps(def);
  const axisControl = previewAxis ? def.props?.[previewAxis] : undefined;
  const firstAxisValue = axisControl && (axisControl.type === 'select' || axisControl.type === 'segmented')
    ? axisControl.options[0]
    : undefined;
  const selectedAxis = previewAxis
    ? (selectedAxisById[def.id] ?? String(componentDefaults[previewAxis] ?? firstAxisValue ?? 'default'))
    : undefined;
  const previewKey = selectedAxis === undefined ? def.id : `${def.id}:${previewAxis}:${selectedAxis}`;
  const previewDefaults = previewAxis && selectedAxis !== undefined
    ? {
        ...propsForAxis(def, previewAxis, selectedAxis),
        ...((def.id === 'button' || def.id === 'split-button') ? componentDefaults : {}),
        [previewAxis]: selectedAxis,
      }
    : componentDefaults;
  const shown = valuesByPreview[previewKey] ?? previewDefaults;
  const previewState = stateByPreview[previewKey] ?? 'default';

  const set = (k: string, v: string | number | boolean): void => {
    if (k === previewAxis) {
      setSelectedAxisById(previous => ({ ...previous, [def.id]: String(v) }));
      return;
    }
    setValuesByPreview(previous => ({
      ...previous,
      [previewKey]: { ...(previous[previewKey] ?? previewDefaults), [k]: v },
    }));
  };

  const resetPreview = (): void => {
    setValuesByPreview(previous => Object.fromEntries(
      Object.entries(previous).filter(([key]) => key !== previewKey),
    ));
    setStateByPreview(previous => Object.fromEntries(
      Object.entries(previous).filter(([key]) => key !== previewKey),
    ));
  };

  const members = family
    ? family.componentIds
      .map(id => findComponent(id))
      .filter((d): d is ComponentDef => d !== undefined)
    : [];

  /** One specimen renderer for every tab, so no tab can drift from another. */
  const specimen = (props: PropValues, state: UiState = 'default'): VNode | null =>
    def.render ? def.render(props, state) : null;

  const previewGroups = groupControls(def, previewAxis ? [previewAxis] : [])
    .map(group => ({ ...group, entries: group.entries.filter(([name]) => isRelevantPreviewControl(def, shown, previewState, name)) }))
    .filter(group => group.entries.length > 0);

  return (
    <div class={`sds-wb sds-wb--${def.id}`}>
      {/* On a family page the heading is the FAMILY. The selector names the
          subtype, and the description below it follows the selection — so the
          page says what "Buttons" contains before it says what one of them does. */}
      <header class={`sds-wb__head${family ? ' sds-wb__head--family' : ''}`}>
        <div>
          <h2>{family ? family.name : def.name}</h2>
          <p>{family ? family.description : def.description}</p>
        </div>
      </header>

      {family && members.length > 0 && (
        /*
          Each option carries a live specimen, its role in the family and its
          ownership. That is the point of the family page: "Performs one action"
          beside "Reveals related actions" IS the distinction, and a user should
          not have to open all three to find it.

          `tablist`, not a radiogroup: these are three components, not three
          values of one setting. Each option swaps the subject of the panel below.
        */
        <div class="sds-family" role="tablist" aria-label={`${family.name} types`}>
          {members.map(m => (
            <button type="button" key={m.id} role="tab"
              aria-selected={m.id === def.id}
              class={`sds-family__type${m.id === def.id ? ' is-on' : ''}`}
              onClick={() => onSelectMember?.(m.id)}>
              {/* Pointer-events off in CSS — the specimen illustrates the
                  option; the option itself takes the click. */}
              <span class="sds-family__preview">{m.render?.(buttonFamilyPreviewProps(m), 'default')}</span>
              <span class="sds-family__copy">
                <strong>{m.name.replace(' Button', '')}</strong>
                <small>{family.roles[m.id] ?? CATEGORY_LABELS[m.category]}</small>
              </span>
              <span class="sds-family__state">{COMPOUND_OF[m.id] ?? 'Canonical'}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Overview: one page, live specimen first, reference below ──────────
          Overview and Playground were two tabs asking the same question — "what
          does this component do?" — and answering half of it each. You had to
          leave the specimen you were driving to see the variant matrix, and
          leave the matrix to try anything.

          Now: a driveable specimen with its inspector docked right, then the
          reference sections beneath it. The inspector is sticky, so the props
          stay reachable while you read down the matrix. One canvas, one set of
          props, one scroll. */}
      {def.id === 'button' && def.style?.length ? (
        <RecipeStyleEditor def={def} draft={draft} />
      ) : COMPOUND_OF[def.id] ? (
        <CompoundButtonEditor def={def} shown={shown} specimen={specimen}
          onSet={set}
          onEditFoundation={onSelectMember ? () => onSelectMember('button') : undefined} />
      ) : (
        <div class="sds-button-editor">
          <PreviewScope class="sds-button-editor__main" attach={draft.attachScope}>
            <section class="sds-button-preview sds-button-preview--with-variants">
              <header><div><span>Live preview</span><strong>{def.name}</strong></div><small>Updates instantly</small></header>
              <div class="sds-button-preview__single">{specimen(shown, previewState)}</div>
              <VariantSpecimens def={def} specimen={specimen} selected={selectedAxis ?? shown.variant}
                onSelect={(axis, value) => set(axis, value)} />
            </section>
            <UsageSpecimens def={def} />
          </PreviewScope>
          <aside class="sds-button-settings" aria-label={`${def.name} properties`}>
            <header class="sds-button-settings__head"><div><span>Preview settings</span><strong>Try the {def.name}</strong></div></header>
            <section class="sds-button-settings__example" aria-label="Preview options">
              <div class="sds-button-settings__example-head"><div><h4>Preview options</h4><p>Only this {selectedAxis ? friendlyValue(selectedAxis).toLowerCase() : 'example'} preview changes.</p></div><button type="button" onClick={resetPreview}>Reset</button></div>
              {def.states && def.states.length > 1 && <div class="sds-button-settings__state"><label for={`${def.id}-preview-state`}>State</label><select id={`${def.id}-preview-state`} value={previewState} onChange={event => setStateByPreview(previous => ({ ...previous, [previewKey]: (event.target as HTMLSelectElement).value as UiState }))}>{def.states.map(state => <option value={state}>{friendlyValue(state)}</option>)}</select></div>}
            </section>
            <div class="sds-button-settings__body">
              {previewGroups.map(group => <section key={group.title}><h4>{group.title}</h4>{group.entries.map(([name, control]) => <Control key={name} name={name} control={control} value={shown[name] ?? ''} onChange={value => set(name, value)} />)}</section>)}
              {def.style && def.style.length > 0 && <details class="sds-button-settings__style">
                <summary><span><strong>Component style</strong><small>Shape, colours and interaction states</small></span><em>{def.style.reduce((total, group) => total + group.controls.length, 0)} settings</em></summary>
                <div><GeneratedStyleControls def={def} draft={draft} /></div>
              </details>}
            </div>
          </aside>
        </div>
      )}

    </div>
  );
}

/* ── Overview ──────────────────────────────────────────────────────────────── */

/**
 * One labelled Overview section: heading, what it is FOR, then its own surface.
 *
 * Module scope, not defined inside the render: a component created during render
 * is a new type every pass, so Preact would unmount and remount its whole
 * subtree on every keystroke.
 */
function Block({ title, hint, children }: {
  title: string; hint: string; children: ComponentChildren;
}): VNode {
  return (
    <section class="sds-button-preview__variants">
      <header class="sds-button-editor__intro"><div><h3>{title}</h3><p>{hint}</p></div></header>
      <div class="sds-ov__surface">{children}</div>
    </section>
  );
}

/**
 * The variant × size matrix is derived from the definition's own `select` and
 * `segmented` options, so it cannot list a variant the component does not have.
 */
function VariantSpecimens({ def, specimen, selected, onSelect }: {
  def: ComponentDef;
  specimen: (p: PropValues, s?: UiState) => VNode | null;
  selected: string | number | boolean | undefined;
  onSelect: (axis: string, value: string) => void;
}): VNode {
  const axis = def.previewAxis ?? (def.props?.variant ? 'variant' : undefined);
  const axisControl = axis ? def.props?.[axis] : undefined;
  const values = axisControl && (axisControl.type === 'select' || axisControl.type === 'segmented')
    ? axisControl.options : [];
  const samples = def.previewSamples ?? def.variantSamples;

  return (
    <div class="sds-ov">
      {axis && values.length > 0 && (
        <Block title="Variants" hint="Choose a version to preview and edit.">
          {values.length > 6 ? <div class="sds-axis-icons" role="radiogroup" aria-label={`${def.name} variants`}>
              {values.map(v => {
                const sample = samples?.find(item => item.value === v);
                const title = sample?.title ?? friendlyValue(v);
                const icon = def.id === 'text-input' ? TEXT_INPUT_VARIANT_ICONS[v] : undefined;
                return <button type="button" role="radio" aria-checked={String(selected) === v}
                  class={String(selected) === v ? 'is-on' : ''} key={v} onClick={() => onSelect(axis, v)}>
                  {icon && <LucideIcon name={icon} size={17} strokeWidth={1.8} />}
                  <span>{title}</span>
                </button>;
              })}
            </div> : <div class="sds-axis" role="radiogroup" aria-label={`${def.name} ${axisControl?.label ?? 'variants'}`}>
              {values.map(v => {
                const sample = samples?.find(item => item.value === v);
                return (
                  <button type="button" role="radio" aria-checked={String(selected) === v}
                    class={`sds-axis__cell${String(selected) === v ? ' is-on' : ''}`} key={v}
                    onClick={() => onSelect(axis, v)}>
                    <div class="sds-axis__spec">{specimen(propsForAxis(def, axis, v))}</div>
                    <strong>{sample?.title ?? friendlyValue(v)}</strong>
                  </button>
                );
              })}
            </div>}
        </Block>
      )}

    </div>
  );
}

function UsageSpecimens({ def }: { def: ComponentDef }): VNode {
  return (
    <>
      {def.examples && def.examples.length > 0 && (
        <section class="sds-button-use" aria-labelledby={`${def.id}-use-title`}>
          <header><h3 id={`${def.id}-use-title`}>Common application use</h3><p>Real examples of how this control appears in SIOMAC.</p></header>
          <div class={COMPOUND_OF[def.id]
            ? `sds-pattern-grid${def.examples.length === 2 ? ' sds-pattern-grid--two' : ''}`
            : 'sds-use-context'}>
            {def.examples.map(example => <article key={example.id}>
              <span class="ctx-kicker">{example.title}</span><div>{example.render()}</div>
              {example.description && <small>{example.description}</small>}
            </article>)}
          </div>
        </section>
      )}
      <SpecialTreatments componentId={def.id} />
    </>
  );
}
