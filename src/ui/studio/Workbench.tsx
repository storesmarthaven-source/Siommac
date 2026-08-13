/**
 * src/ui/studio/Workbench.tsx — the generic component workbench.
 *
 * Button is its first CONSUMER, not its subject. There is nothing
 * Button-specific in this file: every tab reads the `ComponentDef` it is handed,
 * so adding Badge, TextInput or DataTable to the Studio is adding nothing here.
 *
 * ⭐ NO second registry, and no new `workbench` metadata field. The registry
 * already carries everything the five tabs need — `props` (Playground),
 * `render`/`code` (Preview, Code), `presets` + `examples` + `states` (Overview),
 * `a11y` (Accessibility), `migration` + prop `help` (Usage). Adding a parallel
 * shape would have re-created the drift the registry exists to prevent.
 *
 * ⭐ The specimen is the REAL component. `def.render(props, state)` calls the
 * canonical implementation, so editing `Button.recipe.css` changes what the
 * Studio shows, with no approximation to keep in sync. That is the whole point;
 * a `<div class="studio-button-demo">` would make this furniture.
 *
 * The canvas sits inside `data-ui-preview-scope`; the tabs, controls and
 * viewport buttons stay outside it. Phase 3 can then push a draft theme into the
 * specimen without touching Studio chrome, and none of this needs revisiting.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import {
  defaultProps, CATEGORY_LABELS, COMPOUND_OF, findComponent,
  type ComponentDef, type ComponentFamily, type PropValues, type PropControl,
} from '../registry';
import { type UiState } from '../tokens';
import { SpecialTreatments } from '../special/SpecialTreatments';
import { type GalleryDraft } from '../gallery/galleryStore';
import { RecipeStyleEditor } from './RecipeStyleEditor';

type Tab = 'overview' | 'style' | 'usage' | 'accessibility' | 'code';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview',      label: 'Overview' },   // specimen + inspector + reference
  { id: 'style',         label: 'Style' },
  { id: 'usage',         label: 'Usage' },
  { id: 'accessibility', label: 'Accessibility' },
  { id: 'code',          label: 'Code' },
];

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
  { title: 'Appearance', names: ['variant', 'tone', 'size', 'contrast', 'shape', 'density', 'accent'] },
  { title: 'Content',    names: ['label', 'text', 'placeholder', 'iconLeft', 'iconRight', 'icon', 'iconSide', 'iconOnly', 'helpText', 'suffix', 'prefix'] },
  { title: 'State',      names: ['disabled', 'loading', 'loadingText', 'pressed', 'readOnly', 'required', 'error', 'checked', 'selected'] },
  { title: 'Behaviour',  names: ['action', 'href', 'fullWidth', 'clearable', 'multiline', 'rows'] },
];

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
        {control.help && <p class="sds-ctl__help">{control.help}</p>}
      </>
    );
  }

  return (
    <div class="sds-ctl">
      <label class="sds-ctl__label" for={id}>{control.label}</label>

      {control.type === 'select' && (
        <select id={id} class="sds-ctl__input" value={String(value)} disabled={disabled}
          onChange={e => onChange((e.target as HTMLSelectElement).value)}>
          {control.options.map(o => <option value={o} key={o}>{o}</option>)}
        </select>
      )}

      {control.type === 'segmented' && (
        <div class="sds-seg sds-seg--wide" role="group" aria-label={control.label}>
          {control.options.map(o => (
            <button type="button" key={o} disabled={disabled}
              class={`sds-seg__btn${String(value) === o ? ' is-on' : ''}`}
              aria-pressed={String(value) === o}
              onClick={() => onChange(o)}>{o}</button>
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

      {control.help && <p class="sds-ctl__help">{control.help}</p>}
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
function symbolOf(def: ComponentDef): string {
  const snippet = def.code?.(defaultProps(def), 'default') ?? '';
  return /<([A-Z][A-Za-z0-9]*)/.exec(snippet)?.[1] ?? def.name.replace(/\s+/g, '');
}

/* ── Workbench ─────────────────────────────────────────────────────────────── */

export interface WorkbenchProps {
  def: ComponentDef;
  /** Set when `def` belongs to a family — renders the subtype selector. */
  family?: ComponentFamily;
  onSelectMember?: (componentId: string) => void;
  onBack: () => void;
  draft: GalleryDraft;
}

export function Workbench({ def, family, onSelectMember, onBack, draft }: WorkbenchProps): VNode {
  const [tab, setTab] = useState<Tab>('overview');

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

  /* Canonical mode shows the component at its DECLARED defaults with the
     inspector locked. Edits are kept, not discarded, so switching back restores
     what you were driving. */
  const [canonical, setCanonical] = useState(false);
  const shown = canonical ? defaultProps(def) : values;

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

  const codeSnippet = useMemo(
    () => (def.code ? def.code(shown, 'default') : ''),
    [def, shown],
  );

  return (
    <div class="sds-wb">
      <button type="button" class="sds-wb__back" onClick={onBack}>
        ← Components
      </button>

      {/* On a family page the heading is the FAMILY. The selector names the
          subtype, and the description below it follows the selection — so the
          page says what "Buttons" contains before it says what one of them does. */}
      <header class={`sds-wb__head${family ? ' sds-wb__head--family' : ''}`}>
        <div>
          <h2>{family ? family.name : def.name}</h2>
          <p>{family ? family.description : def.description}</p>
        </div>
        {family && <span class="sds-family-chip">{members.length} button types</span>}
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
              <span class="sds-family__preview">{m.render?.(defaultProps(m), 'default')}</span>
              <span class="sds-family__copy">
                <strong>{m.name}</strong>
                <small>{family.roles[m.id] ?? CATEGORY_LABELS[m.category]}</small>
              </span>
              <span class="sds-family__state">{COMPOUND_OF[m.id] ?? 'Canonical'}</span>
            </button>
          ))}
        </div>
      )}

      <div class="sds-wb__tabs" role="tablist" aria-label={`${def.name} workbench`}>
        {TABS.map(t => (
          <button type="button" key={t.id} role="tab"
            aria-selected={t.id === tab}
            class={`sds-wb__tab${t.id === tab ? ' is-on' : ''}`}
            onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {/* ── Overview: one page, live specimen first, reference below ──────────
          Overview and Playground were two tabs asking the same question — "what
          does this component do?" — and answering half of it each. You had to
          leave the specimen you were driving to see the variant matrix, and
          leave the matrix to try anything.

          Now: a driveable specimen with its inspector docked right, then the
          reference sections beneath it. The inspector is sticky, so the props
          stay reachable while you read down the matrix. One canvas, one set of
          props, one scroll. */}
      {tab === 'overview' && (
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
                <span class="sds-preview-block__meta">
                  {COMPOUND_OF[def.id]
                    ? `Compound control · ${COMPOUND_OF[def.id]}`
                    : `Canonical component · ${CATEGORY_LABELS[def.category]}`}
                </span>
              </header>

              <div class="sds-canvas sds-canvas--hero sds-tech-canvas">
                {/* Measurement guides. Decoration with a job: a centred rule and
                    corner nodes give the eye a reference, so a control that is
                    off-centre or the wrong height is visible without a ruler. */}
                <div class="sds-tech-canvas__guides" aria-hidden="true">
                  <i class="v" /><i class="h" />
                  <i class="n n1" /><i class="n n2" /><i class="n n3" /><i class="n n4" />
                </div>
                {/* ONE specimen. The hero answers "what is this control", and a
                    row of six answers a different question — which is what the
                    Variants section below is for. */}
                <div class="sds-canvas__single">{specimen(shown)}</div>
              </div>
              <p class="sds-wb__note">
                Live {def.name} — driven by the inspector, and the same component the app renders.
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
                  <strong>{def.name}</strong>
                  <span>
                    {COMPOUND_OF[def.id]
                      ? `Compound control · uses ${COMPOUND_OF[def.id]}`
                      : `Canonical component · ${CATEGORY_LABELS[def.category]}`}
                  </span>
                </div>
                {/* The SYMBOL, so a catalogue rename can never leave someone
                    guessing what to import. "Action Button" is the card; this
                    says the code is still <Button>. */}
                <span class="sds-who-badge">{symbolOf(def)}</span>
              </header>
              {/*
                Editing mode. A REAL control, not the mockup's placeholder:
                "Canonical defaults" renders the component at its declared
                defaults and locks the inspector, so you can see what a developer
                gets by writing the component with no props — then switch back
                and your edits are still there. It does NOT publish anything,
                which is exactly what the caption says.
              */}
              <section class="sds-pg__mode">
                <div class="sds-pg__modehead">
                  <strong>Editing mode</strong>
                  <span>{canonical ? 'Read-only' : 'Preview only'}</span>
                </div>
                <div class="sds-seg sds-seg--wide" role="group" aria-label="Editing mode">
                  <button type="button" class={`sds-seg__btn${canonical ? '' : ' is-on'}`}
                    aria-pressed={!canonical} onClick={() => setCanonical(false)}>Preview</button>
                  <button type="button" class={`sds-seg__btn${canonical ? ' is-on' : ''}`}
                    aria-pressed={canonical} onClick={() => setCanonical(true)}>Canonical defaults</button>
                </div>
                <p>Preview changes affect this specimen only. App-wide publishing is a separate workflow.</p>
              </section>

              {groupControls(def).map(group => (
                <section class="sds-pg__grp" key={group.title}>
                  <h4>{group.title}</h4>
                  {group.entries.map(([name, control]) => (
                    <Control key={name} name={name} control={control} disabled={canonical}
                      value={shown[name] ?? ''} onChange={v => set(name, v)} />
                  ))}
                </section>
              ))}

              <button type="button" class="sds-pg__reset"
                onClick={() => setValues(defaultProps(def))}>Reset preview</button>
            </aside>
          </div>

        </div>
      )}

      {tab === 'style' && (def.style?.length
        ? <RecipeStyleEditor def={def} draft={draft} />
        : <section class="sds-wb__panel"><p>This definition has no governed recipe controls yet. Add them to the canonical registry definition to generate this inspector.</p></section>)}

      {tab === 'code' && (
        <div class="sds-canvas-wrap">
          <div class="sds-canvas" data-ui-preview-scope>
            <div class="sds-canvas__single">{specimen(shown)}</div>
          </div>
        </div>
      )}

      {tab === 'usage' && <UsageTab def={def} />}
      {tab === 'accessibility' && <A11yTab def={def} specimen={specimen} />}

      {tab === 'code' && (
        <section class="sds-wb__panel">
          <p class="sds-wb__note">Generated from the current playground state — it reflects the props above exactly.</p>
          <pre class="sds-code">{codeSnippet}</pre>
          <p class="sds-wb__note">Import from <code>{def.importFrom ?? '@ui'}</code></p>
        </section>
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
function OverviewSpecimens({ def, specimen }: {
  def: ComponentDef;
  specimen: (p: PropValues, s?: UiState) => VNode | null;
}): VNode {
  const base = defaultProps(def);
  const variantCtl = def.props?.variant;
  const variants = variantCtl && (variantCtl.type === 'select' || variantCtl.type === 'segmented')
    ? variantCtl.options : [];

  return (
    <div class="sds-ov">
      {variants.length > 0 && (
        <Block title="Variants" hint="The canonical appearances. All of them still belong to the same component — these are values of the `variant` prop, not separate components.">
          <div class="sds-axis">
            {variants.map(v => (
              <div class="sds-axis__cell" key={v}>
                <div class="sds-axis__spec">{specimen({ ...base, variant: v })}</div>
                <code>{v}</code>
              </div>
            ))}
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
                ? 'The same Button recipe every time — only the menu behaviour changes.'
                : 'Context owns the action. The component still owns its visual and interaction contract.'}
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

/* ── Usage ─────────────────────────────────────────────────────────────────── */

/**
 * Usage is assembled from what the definition already states — the prop `help`
 * text and the migration notes — rather than a second prose source that would
 * drift from the component the moment either changed.
 */
function UsageTab({ def }: { def: ComponentDef }): VNode {
  const helps = Object.entries(def.props ?? {})
    .filter(([, c]) => Boolean(c.help))
    .map(([name, c]) => ({ name, label: c.label, help: c.help! }));

  return (
    <section class="sds-wb__panel">
      <p class="sds-wb__lead">{def.description}</p>

      {helps.length > 0 && (
        <div class="sds-use">
          <h4>Choosing props</h4>
          <dl>
            {helps.map(h => (
              <div key={h.name}>
                <dt><code>{h.name}</code> — {h.label}</dt>
                <dd>{h.help}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {def.migration?.notes && def.migration.notes.length > 0 && (
        <div class="sds-use">
          <h4>Migration rules</h4>
          <ul>{def.migration.notes.map(n => <li key={n}>{n}</li>)}</ul>
        </div>
      )}

      {def.migration?.replaces && def.migration.replaces.length > 0 && (
        <div class="sds-use">
          <h4>Replaces</h4>
          <p class="sds-use__classes">{def.migration.replaces.join(' · ')}</p>
        </div>
      )}
    </section>
  );
}

/* ── Accessibility ─────────────────────────────────────────────────────────── */

function A11yTab({ def, specimen }: {
  def: ComponentDef; specimen: (p: PropValues, s?: UiState) => VNode | null;
}): VNode {
  const a = def.a11y;
  if (!a) return <section class="sds-wb__panel"><p>No accessibility contract recorded.</p></section>;
  const base = defaultProps(def);

  return (
    <section class="sds-wb__panel">
      <div class="sds-use">
        <h4>Contract</h4>
        <dl>
          <div><dt>Role</dt><dd>{a.role ?? 'native element — no explicit role'}</dd></div>
          <div><dt>Accessible name</dt><dd>{a.name}</dd></div>
          <div><dt>Focus</dt><dd>{a.focus}</dd></div>
        </dl>
      </div>

      {a.keyboard.length > 0 && (
        <div class="sds-use">
          <h4>Keyboard</h4>
          <dl>{a.keyboard.map(k => (
            <div key={k.keys}><dt><kbd>{k.keys}</kbd></dt><dd>{k.does}</dd></div>
          ))}</dl>
        </div>
      )}

      {a.notes && a.notes.length > 0 && (
        <div class="sds-use"><h4>Must-know</h4>
          <ul>{a.notes.map(n => <li key={n}>{n}</li>)}</ul>
        </div>
      )}

      {/* Live, not described: the states most often got wrong. */}
      <div class="sds-use">
        <h4>Live cases</h4>
        <div class="sds-canvas" data-ui-preview-scope>
          <div class="sds-ov__inline">
            {def.props?.disabled && <div>{specimen({ ...base, disabled: true })}</div>}
            {def.props?.loading && <div>{specimen({ ...base, loading: true })}</div>}
            {def.props?.pressed && <div>{specimen({ ...base, pressed: true })}</div>}
            {def.props?.iconOnly && <div>{specimen({ ...base, iconOnly: true })}</div>}
          </div>
        </div>
      </div>
    </section>
  );
}
