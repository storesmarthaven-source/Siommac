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
  defaultProps, CATEGORY_LABELS, COMPOUND_OF, findComponent,
  propsForVariant,
  type ComponentDef, type ComponentFamily, type PropValues, type PropControl,
} from '../registry';
import { type UiState } from '../tokens';
import { SpecialTreatments } from '../special/SpecialTreatments';
import { type GalleryDraft } from '../gallery/galleryStore';
import { IconPicker, RecipeStyleEditor, StudioColorControl } from './RecipeStyleEditor';
import { LUCIDE_NAMES, type LucideName } from '../LucideIcon';

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
  { title: 'Content', names: ['label', 'text', 'placeholder', 'iconLeft', 'iconRight', 'icon', 'iconSide', 'iconOnly', 'helpText', 'suffix', 'prefix'] },
  { title: 'Appearance', names: ['variant', 'tone', 'size', 'contrast', 'shape', 'density', 'accent'] },
  { title: 'States', names: ['disabled', 'loading', 'loadingText', 'pressed', 'readOnly', 'required', 'error', 'checked', 'selected'] },
  { title: 'More options', names: ['action', 'href', 'fullWidth', 'clearable', 'multiline', 'rows'] },
];

const FRIENDLY_VALUES: Record<string, string> = {
  sm: 'Small', md: 'Medium', lg: 'Large',
  None: 'No icon', Trash2: 'Trash', ArrowRight: 'Arrow right', ChevronRight: 'Chevron right',
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
  const all = Object.entries(def.props ?? {}).filter(([n]) => !omit.includes(n));
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
        <input id={id} type="text" class="sds-ctl__input" value={String(value)} disabled={disabled}
          onInput={e => onChange((e.target as HTMLInputElement).value)} />
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
  onBack: () => void;
  backLabel?: string;
  draft: GalleryDraft;
}

interface CompoundButtonEditorProps {
  def: ComponentDef;
  shown: PropValues;
  specimen: (props: PropValues, state?: UiState) => VNode | null;
  onSet: (name: string, value: string | number | boolean) => void;
  onReset: () => void;
  onEditFoundation?: () => void;
}

/**
 * Dropdown and Split Button are separate interaction contracts, but they are
 * still members of the Button family. Keep their focused editing experience in
 * the same preview-first shell as the governed Button patterns instead of
 * falling back to the catalogue's generic component page.
 */
function CompoundButtonEditor({ def, shown, specimen, onSet, onReset, onEditFoundation }: CompoundButtonEditorProps): VNode {
  const ownership = COMPOUND_OF[def.id] ?? 'Button family';
  const [previewState, setPreviewState] = useState<UiState>('default');
  const [iconTreatment, setIconTreatment] = useState('outline');
  const [iconColor, setIconColor] = useState('#1b2d54');
  const variantControl = def.props?.variant;
  const variants = variantControl && (variantControl.type === 'select' || variantControl.type === 'segmented')
    ? variantControl.options : [];
  const iconControl = def.props?.iconLeft;
  const recommendedIcons = iconControl && (iconControl.type === 'select' || iconControl.type === 'segmented')
    ? iconControl.options.filter((option): option is LucideName =>
      option !== 'None' && LUCIDE_NAMES.includes(option as LucideName)) : [];
  const previewProps: PropValues = { ...shown, iconTreatment, iconColor };

  const reset = (): void => {
    onReset();
    setPreviewState('default');
    setIconTreatment('outline');
    setIconColor('#1b2d54');
  };

  return (
    <div class="sds-owned-button" data-ui-preview-scope>
      <section class="sds-owned-button__editor" aria-label={`${def.name} editor`}>
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
                    <div class="sds-owned-button__variant-preview">{specimen({ ...previewProps, variant, size: 'md' }, 'default')}</div>
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

        <aside class="sds-owned-button__settings" aria-label={`${def.name} settings`}>
          <header>
            <div><span>Preview settings</span><strong>Try the {def.name}</strong></div>
            <button type="button" onClick={reset}>Reset</button>
          </header>
          <div class="sds-owned-button__controls">
            <section class="sds-owned-button__preview-options">
              <h4>Preview</h4>
              <label class="sds-ctl" for={`${def.id}-state`}>
                <span class="sds-ctl__label">State</span>
                <select id={`${def.id}-state`} class="sds-ctl__input" value={previewState}
                  onChange={event => setPreviewState((event.target as HTMLSelectElement).value as UiState)}>
                  {(def.states ?? ['default']).map(state => <option value={state}>{friendlyValue(state)}</option>)}
                </select>
              </label>
              <div class="sds-owned-button__icon-picker">
                <span>Leading icon</span>
                <IconPicker id={`${def.id}-leading-icon`} label="Leading icon"
                  value={String(shown.iconLeft ?? 'None')} variant={String(shown.variant ?? 'primary') as never}
                  position="leading" recommendations={recommendedIcons}
                  onChange={value => onSet('iconLeft', value)} />
              </div>
              <div class="sds-owned-button__icon-style">
                <span>Icon treatment</span>
                <div role="radiogroup" aria-label="Icon treatment">
                  {['outline', 'circle', 'filled-circle'].map(treatment => (
                    <button type="button" role="radio" aria-checked={iconTreatment === treatment}
                      class={iconTreatment === treatment ? 'is-on' : ''} onClick={() => setIconTreatment(treatment)}>
                      {friendlyValue(treatment)}
                    </button>
                  ))}
                </div>
              </div>
              <StudioColorControl id={`${def.id}-icon-color`} label="Icon"
                value={iconColor} onChange={setIconColor} />
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
                    value={shown[name] ?? ''} onChange={value => onSet(name, value)} />
                ))}
              </section>
            ))}
          </div>
          <footer>
            <span aria-hidden="true">↳</span>
            <p><strong>Linked to Action Button</strong><small>Shape, color and states come from the published Button recipe.</small></p>
            {onEditFoundation && <button type="button" onClick={onEditFoundation}>Edit button appearance</button>}
          </footer>
        </aside>
      </section>

      <section class="sds-owned-button__reference" aria-label={`${def.name} examples`}>
        <OverviewSpecimens def={def} specimen={specimen} hideVariants />
      </section>
    </div>
  );
}

export function Workbench({ def, family, onSelectMember, onBack, backLabel = 'Components', draft }: WorkbenchProps): VNode {
  /*
    Prop values are kept PER COMPONENT, not reset on every switch.
    `useState(() => defaultProps(def))` would keep the first subtype's values
    when `def` changed — Action Button's `iconSide` surviving into Split Button.
    Remounting on `key={def.id}` would fix that but throw away the tab, so
    switching subtype while reading Accessibility would bounce you to Overview.
    Keying by id gives each subtype its own complete schema AND its own edits.
  */
  const [valuesById, setValuesById] = useState<Record<string, PropValues>>({});
  const values = valuesById[def.id] ?? defaultProps(def);

  const shown = values;

  const setValues = (next: PropValues): void =>
    setValuesById(prev => ({ ...prev, [def.id]: next }));

  const set = (k: string, v: string | number | boolean): void =>
    setValuesById(prev => ({
      ...prev,
      [def.id]: { ...(prev[def.id] ?? defaultProps(def)), [k]: v },
    }));

  const members = family
    ? family.componentIds
      .map(id => findComponent(id))
      .filter((d): d is ComponentDef => d !== undefined)
    : [];

  /** One specimen renderer for every tab, so no tab can drift from another. */
  const specimen = (props: PropValues, state: UiState = 'default'): VNode | null =>
    def.render ? def.render(props, state) : null;

  return (
    <div class={`sds-wb sds-wb--${def.id}`}>
      <button type="button" class="sds-wb__back" onClick={onBack}>
        ← {backLabel}
      </button>

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
              <span class="sds-family__preview">{m.render?.(
                m.id === 'button'
                  ? { ...defaultProps(m), label: 'Button', iconLeft: 'None', iconRight: 'None' }
                  : defaultProps(m),
                'default',
              )}</span>
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
          onSet={set} onReset={() => setValues(defaultProps(def))}
          onEditFoundation={onSelectMember ? () => onSelectMember('button') : undefined} />
      ) : (
        <div data-ui-preview-scope>
          <div class="sds-pg">
            <div class="sds-pg__stage">
              <section class="sds-preview-block">
              {/* Names the specimen and its ownership right above the canvas.
                  On a family page the page heading is the family, so without
                  this the viewport would show an unlabelled control. */}
              <header class="sds-preview-block__head">
                <div>
                  <span class="sds-preview-block__eyebrow">Live preview</span>
                  <strong>{def.name}</strong>
                </div>
                <span class="sds-preview-block__meta">Preview updates instantly</span>
              </header>

              <div class="sds-canvas sds-canvas--hero">
                {/* ONE specimen. The hero answers "what is this control", and a
                    row of six answers a different question — which is what the
                    Variants section below is for. */}
                <div class="sds-canvas__single">{specimen(shown)}</div>
              </div>
              <p class="sds-wb__note">
                Use the settings on the right to try this component. Preview changes never affect the app.
              </p>
              </section>

              {/* Reference sections live in the STAGE column, beside the sticky
                  Properties rail — not full-width beneath it. A variant strip that
                  runs under the inspector reads as page content rather than as
                  documentation of the specimen above it. */}
              <div class="sds-wb__rule" />
              <OverviewSpecimens def={def} specimen={specimen} />
            </div>

            <aside class="sds-pg__panel" aria-label={`${def.name} properties`}>
              {/* Say what is being configured. Without this the panel reads as a
                  generic box of controls, and "Continue", "Cancel" and "Save"
                  start to look like they might be different components. They are
                  not: they are this one, with different props. */}
              {/* Ownership, not just a name. "Compound control · uses Button +
                  Menu" is what stops someone reading DropdownButton as a third
                  kind of button rather than a composition of two things they
                  already know. */}
              <header class="sds-pg__who">
                <div>
                  <span class="sds-pg__eyebrow">Preview settings</span>
                  <strong>Try the {def.name}</strong>
                  <p>These choices only change the example.</p>
                </div>
                <button type="button" class="sds-pg__clear"
                  onClick={() => setValues(defaultProps(def))}>Reset</button>
              </header>
              {/*
                Editing mode. A REAL control, not the mockup's placeholder:
                "Canonical defaults" renders the component at its declared
                defaults and locks the inspector, so you can see what a developer
                gets by writing the component with no props — then switch back
                and your edits are still there. It does NOT publish anything,
                which is exactly what the caption says.
              */}
              {groupControls(def).map(group => (
                <section class="sds-pg__grp" key={group.title}>
                  <h4>{group.title}</h4>
                  {group.entries.map(([name, control]) => (
                    <Control key={name} name={name} control={control}
                      value={shown[name] ?? ''} onChange={v => set(name, v)} />
                  ))}
                </section>
              ))}
            </aside>
          </div>

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
    <section class="sds-ov__sec">
      <div class="sds-ov__hd">
        <h4>{title}</h4>
        <p>{hint}</p>
      </div>
      <div class="sds-ov__surface">{children}</div>
    </section>
  );
}

/**
 * The variant × size matrix is derived from the definition's own `select` and
 * `segmented` options, so it cannot list a variant the component does not have.
 */
function OverviewSpecimens({ def, specimen, hideVariants = false }: {
  def: ComponentDef;
  specimen: (p: PropValues, s?: UiState) => VNode | null;
  hideVariants?: boolean;
}): VNode {
  const variantCtl = def.props?.variant;
  const variants = variantCtl && (variantCtl.type === 'select' || variantCtl.type === 'segmented')
    ? variantCtl.options : [];

  return (
    <div class="sds-ov">
      {!hideVariants && variants.length > 0 && (
        <Block title="Variants" hint="Choose the amount of emphasis that matches the action. The labels below show typical uses.">
          <div class="sds-axis">
            {variants.map(v => {
              const sample = def.variantSamples?.find(item => item.value === v);
              return (
                <div class="sds-axis__cell" key={v}>
                  <div class="sds-axis__spec">{specimen(propsForVariant(def, v))}</div>
                  <strong>{sample?.title ?? friendlyValue(v)}</strong>
                  {sample?.description && <span>{sample.description}</span>}
                </div>
              );
            })}
          </div>
        </Block>
      )}

      {def.examples && def.examples.length > 0 && (
        /* A compound's examples are PATTERNS ("Export menu", "Row actions") —
           each is a whole control with a caption. A canonical component's are
           CONTEXTS ("Dialog footer") — a row of controls in a situation. Same
           data, two layouts, chosen from what the component is rather than from
           a flag someone has to remember to set. */
        <section class="sds-ov__sec">
          <div class="sds-ov__hd">
            <h4>{COMPOUND_OF[def.id] ? 'Typical patterns' : 'Common application use'}</h4>
            <p>
              {COMPOUND_OF[def.id]
                ? 'The button keeps the same look; only the menu choices change.'
                : 'See how the same button works in familiar product moments.'}
            </p>
          </div>
          <div class={COMPOUND_OF[def.id]
            ? `sds-pattern-grid${def.examples.length === 2 ? ' sds-pattern-grid--two' : ''}`
            : 'sds-use-context'}>
            {def.examples.map(ex => (
              <article key={ex.id}>
                <span class="ctx-kicker">{ex.title}</span>
                <div>{ex.render()}</div>
                {ex.description && <small>{ex.description}</small>}
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Explicitly outside the variant axis and the canonical registry. The
          special-treatment owner decides whether this component has any. */}
      <SpecialTreatments componentId={def.id} />
    </div>
  );
}
