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
  defaultProps, type ComponentDef, type PropValues, type PropControl,
} from '../registry';
import { type UiState } from '../tokens';
import { InAppUsage } from './InAppUsage';

type Tab = 'overview' | 'usage' | 'accessibility' | 'code';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview',      label: 'Overview' },   // specimen + inspector + reference
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
  { title: 'Content',    names: ['label', 'text', 'placeholder', 'icon', 'iconSide', 'iconOnly', 'helpText', 'suffix', 'prefix'] },
  { title: 'State',      names: ['disabled', 'loading', 'loadingText', 'pressed', 'readOnly', 'required', 'error', 'checked', 'selected'] },
  { title: 'Behaviour',  names: ['href', 'fullWidth', 'clearable', 'multiline', 'rows'] },
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

function Control({ name, control, value, onChange }: {
  name: string; control: PropControl; value: string | number | boolean;
  onChange: (v: string | number | boolean) => void;
}): VNode {
  const id = `wb-${name}`;
  return (
    <div class="sds-ctl">
      <label class="sds-ctl__label" for={id}>{control.label}</label>

      {control.type === 'select' && (
        <select id={id} class="sds-ctl__input" value={String(value)}
          onChange={e => onChange((e.target as HTMLSelectElement).value)}>
          {control.options.map(o => <option value={o} key={o}>{o}</option>)}
        </select>
      )}

      {control.type === 'segmented' && (
        <div class="sds-seg" role="group" aria-label={control.label}>
          {control.options.map(o => (
            <button type="button" key={o}
              class={`sds-seg__btn${String(value) === o ? ' is-on' : ''}`}
              aria-pressed={String(value) === o}
              onClick={() => onChange(o)}>{o}</button>
          ))}
        </div>
      )}

      {control.type === 'boolean' && (
        <input id={id} type="checkbox" class="sds-ctl__check" checked={Boolean(value)}
          onChange={e => onChange((e.target as HTMLInputElement).checked)} />
      )}

      {control.type === 'text' && (
        <input id={id} type="text" class="sds-ctl__input" value={String(value)}
          placeholder={control.placeholder}
          onInput={e => onChange((e.target as HTMLInputElement).value)} />
      )}

      {control.type === 'number' && (
        <input id={id} type="number" class="sds-ctl__input" value={Number(value)}
          min={control.min} max={control.max} step={control.step}
          onInput={e => onChange(Number((e.target as HTMLInputElement).value))} />
      )}

      {control.type === 'icon' && (
        <input id={id} type="text" class="sds-ctl__input" value={String(value)}
          onInput={e => onChange((e.target as HTMLInputElement).value)} />
      )}

      {control.help && <p class="sds-ctl__help">{control.help}</p>}
    </div>
  );
}

/* ── Workbench ─────────────────────────────────────────────────────────────── */

export function Workbench({ def, onBack }: { def: ComponentDef; onBack: () => void }): VNode {
  const [tab, setTab] = useState<Tab>('overview');
  const [values, setValues] = useState<PropValues>(() => defaultProps(def));

  const set = (k: string, v: string | number | boolean): void =>
    setValues(prev => ({ ...prev, [k]: v }));

  /** One specimen renderer for every tab, so no tab can drift from another. */
  const specimen = (props: PropValues, state: UiState = 'default'): VNode | null =>
    def.render ? def.render(props, state) : null;

  const codeSnippet = useMemo(
    () => (def.code ? def.code(values, 'default') : ''),
    [def, values],
  );

  /**
   * The variant axis, when this component opts in. Empty for everything else,
   * which is what keeps DataTable and Dialog rendering a single specimen.
   */
  const axis = useMemo((): readonly string[] => {
    if (def.previewAxis !== 'variant') return [];
    const ctl = def.props?.variant;
    return ctl && (ctl.type === 'select' || ctl.type === 'segmented') ? ctl.options : [];
  }, [def]);

  return (
    <div class="sds-wb">
      <button type="button" class="sds-wb__back" onClick={onBack}>
        ← Components
      </button>

      <header class="sds-wb__head">
        <h2>{def.name}</h2>
        <p>{def.description}</p>
      </header>

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
              <div class="sds-canvas sds-canvas--hero">
                {axis.length > 0
                  /* Every variant at once, driven together by the other props:
                     toggle `loading` and all of them enter loading, change size
                     and the whole rhythm shifts. One row answers "what does this
                     component do" better than any single specimen, and it
                     replaces the Variants block rather than adding to it. */
                  ? (
                    <div class="sds-axis">
                      {axis.map(v => (
                        <div class="sds-axis__cell" key={v}>
                          <div class="sds-axis__spec">{specimen({ ...values, variant: v })}</div>
                          <code>{v}</code>
                        </div>
                      ))}
                    </div>
                  )
                  : <div class="sds-canvas__single">{specimen(values)}</div>}
              </div>
              <p class="sds-wb__note">
                {axis.length > 0
                  ? `All ${axis.length} ${def.name} variants, live — every control below drives them together.`
                  : `Live ${def.name} — driven by the inspector, and the same component the app renders.`}
              </p>
            </div>

            <aside class="sds-pg__panel" aria-label={`${def.name} properties`}>
              {def.presets && def.presets.length > 0 && (
                <section class="sds-pg__grp">
                  <h4>Presets</h4>
                  <div class="sds-presets">
                    {def.presets.map(p => (
                      <button type="button" key={p.label} class="sds-preset"
                        onClick={() => setValues({ ...defaultProps(def), ...p.props })}>{p.label}</button>
                    ))}
                  </div>
                </section>
              )}

              {groupControls(def, axis.length > 0 ? ['variant'] : []).map(group => (
                <section class="sds-pg__grp" key={group.title}>
                  <h4>{group.title}</h4>
                  {group.entries.map(([name, control]) => (
                    <Control key={name} name={name} control={control}
                      value={values[name] ?? ''} onChange={v => set(name, v)} />
                  ))}
                </section>
              ))}

              <button type="button" class="sds-pg__reset"
                onClick={() => setValues(defaultProps(def))}>Reset to defaults</button>
            </aside>
          </div>

          <div class="sds-wb__rule" />
          <OverviewSpecimens def={def} specimen={specimen} hideVariants={axis.length > 0} />
          <InAppUsage def={def} />
        </div>
      )}

      {tab === 'code' && (
        <div class="sds-canvas-wrap">
          <div class="sds-canvas" data-ui-preview-scope>
            <div class="sds-canvas__single">{specimen(values)}</div>
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
function OverviewSpecimens({ def, specimen, hideVariants = false }: {
  def: ComponentDef;
  specimen: (p: PropValues, s?: UiState) => VNode | null;
  /** The preview is already showing the variant axis — do not state it twice. */
  hideVariants?: boolean;
}): VNode {
  const base = defaultProps(def);
  const variantCtl = def.props?.variant;
  const sizeCtl = def.props?.size;
  const variants = variantCtl && (variantCtl.type === 'select' || variantCtl.type === 'segmented')
    ? variantCtl.options : [];
  const sizes = sizeCtl && (sizeCtl.type === 'select' || sizeCtl.type === 'segmented')
    ? sizeCtl.options : [];

  return (
    <div class="sds-ov">
      {variants.length > 0 && !hideVariants && (
        <Block title="Variants" hint="How loud the control is. One component — these are values of the `variant` prop, not separate components.">
          <dl class="sds-ov__rows">
            {variants.map(v => (
              <div class="sds-ov__row" key={v}>
                <dt><code>{v}</code></dt>
                <dd>{specimen({ ...base, variant: v })}</dd>
              </div>
            ))}
          </dl>
        </Block>
      )}

      {sizes.length > 0 && (
        <Block title="Sizes" hint="The same control at each supported size, side by side so the rhythm is comparable.">
          <div class="sds-ov__inline">
            {sizes.map(s => (
              <div class="sds-ov__chip" key={s}>
                <span>{s}</span>
                {specimen({ ...base, size: s })}
              </div>
            ))}
          </div>
        </Block>
      )}

      {def.presets && def.presets.length > 0 && (
        <Block title="Key combinations" hint="The configurations worth knowing — each is a real preset you can load in the Playground.">
          <dl class="sds-ov__rows">
            {def.presets.map(p => (
              <div class="sds-ov__row" key={p.label}>
                <dt><code>{p.label}</code></dt>
                <dd>{specimen({ ...base, ...p.props })}</dd>
              </div>
            ))}
          </dl>
        </Block>
      )}

      {def.states && def.states.length > 0 && (
        <Block title="States" hint="Every state the component can be previewed in. Listing one here is a promise that render() honours it.">
          <dl class="sds-ov__rows">
            {def.states.map(s => (
              <div class="sds-ov__row" key={s}>
                <dt><code>{s}</code></dt>
                <dd>{specimen(base, s)}</dd>
              </div>
            ))}
          </dl>
        </Block>
      )}

      {def.examples && def.examples.length > 0 && (
        <section class="sds-ov__sec">
          <div class="sds-ov__hd">
            <h4>In context</h4>
            <p>Real compositions, not isolated specimens — where this component actually appears.</p>
          </div>
          {def.examples.map(ex => (
            <article class="sds-ov__example" key={ex.id}>
              <header>
                <strong>{ex.title}</strong>
                {ex.description && <p>{ex.description}</p>}
              </header>
              <div class="sds-ov__surface">{ex.render()}</div>
            </article>
          ))}
        </section>
      )}
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
