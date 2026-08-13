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

import { type VNode } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import {
  defaultProps, type ComponentDef, type PropValues, type PropControl,
} from '../registry';
import { type UiState } from '../tokens';
import { CompareExisting } from '../gallery/CompareExisting';

type Tab = 'overview' | 'playground' | 'usage' | 'accessibility' | 'code' | 'compare';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview',      label: 'Overview' },
  { id: 'playground',    label: 'Playground' },
  { id: 'usage',         label: 'Usage' },
  { id: 'accessibility', label: 'Accessibility' },
  { id: 'code',          label: 'Code' },
  /* Kept from the retired Gallery: a family is not ready to consolidate until
     its existing implementations have been surveyed and one chosen. Drawer
     still has seven, so this tool has a live job. */
  { id: 'compare',       label: 'Compare' },
];

/**
 * Viewport presets CONSTRAIN the canvas rather than scaling the Studio with a
 * transform. A transform would lie: it shrinks pixels instead of changing the
 * width the component actually lays out in, so media queries never fire and a
 * responsive bug stays invisible — which is exactly the class of defect the
 * Phase 1 mobile overflow turned out to be.
 */
const VIEWPORTS: { id: string; label: string; width: number | null }[] = [
  { id: 'fill',    label: 'Fill',    width: null },
  { id: 'desktop', label: 'Desktop', width: 1280 },
  { id: 'tablet',  label: 'Tablet',  width: 768 },
  { id: 'mobile',  label: 'Mobile',  width: 375 },
];

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
  const [viewport, setViewport] = useState('fill');

  const vp = VIEWPORTS.find(v => v.id === viewport) ?? VIEWPORTS[0]!;
  const set = (k: string, v: string | number | boolean): void =>
    setValues(prev => ({ ...prev, [k]: v }));

  /** One specimen renderer for every tab, so no tab can drift from another. */
  const specimen = (props: PropValues, state: UiState = 'default'): VNode | null =>
    def.render ? def.render(props, state) : null;

  const codeSnippet = useMemo(
    () => (def.code ? def.code(values, 'default') : ''),
    [def, values],
  );

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

      {/* Preview — the canvas is the ONLY themed surface. */}
      {(tab === 'overview' || tab === 'playground' || tab === 'code') && (
        <>
          <div class="sds-canvas-wrap">
            <div class="sds-canvas" data-ui-preview-scope
              style={vp.width ? { maxWidth: `${vp.width}px` } : undefined}>
              {tab === 'overview'
                ? <OverviewSpecimens def={def} specimen={specimen} />
                : <div class="sds-canvas__single">{specimen(values)}</div>}
            </div>
          </div>
          <div class="sds-vps" role="group" aria-label="Preview width">
            {VIEWPORTS.map(v => (
              <button type="button" key={v.id}
                class={`sds-vp${v.id === viewport ? ' is-on' : ''}`}
                aria-pressed={v.id === viewport}
                onClick={() => setViewport(v.id)}>{v.label}</button>
            ))}
          </div>
        </>
      )}

      {tab === 'playground' && (
        <section class="sds-wb__panel">
          {def.presets && def.presets.length > 0 && (
            <div class="sds-presets">
              {def.presets.map(p => (
                <button type="button" key={p.label} class="sds-preset"
                  onClick={() => setValues({ ...defaultProps(def), ...p.props })}>{p.label}</button>
              ))}
            </div>
          )}
          <div class="sds-ctls">
            {Object.entries(def.props ?? {}).map(([name, control]) => (
              <Control key={name} name={name} control={control}
                value={values[name] ?? ''} onChange={v => set(name, v)} />
            ))}
          </div>
        </section>
      )}

      {tab === 'compare' && (
        <section class="sds-wb__panel"><CompareExisting def={def} /></section>
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
 * The variant × size matrix is derived from the definition's own `select` and
 * `segmented` options, so it cannot list a variant the component does not have.
 */
function OverviewSpecimens({ def, specimen }: {
  def: ComponentDef; specimen: (p: PropValues, s?: UiState) => VNode | null;
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
      {variants.length > 0 && (
        <div class="sds-ov__block">
          <h4>Variants</h4>
          <div class="sds-ov__rows">
            {variants.map(v => (
              <div class="sds-ov__row" key={v}>
                <code>{v}</code>
                <div>{specimen({ ...base, variant: v })}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {sizes.length > 0 && (
        <div class="sds-ov__block">
          <h4>Sizes</h4>
          <div class="sds-ov__inline">
            {sizes.map(s => <div key={s}>{specimen({ ...base, size: s })}</div>)}
          </div>
        </div>
      )}

      {def.presets && def.presets.length > 0 && (
        <div class="sds-ov__block">
          <h4>Key combinations</h4>
          <div class="sds-ov__rows">
            {def.presets.map(p => (
              <div class="sds-ov__row" key={p.label}>
                <code>{p.label}</code>
                <div>{specimen({ ...base, ...p.props })}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {def.states && def.states.length > 0 && (
        <div class="sds-ov__block">
          <h4>States</h4>
          <div class="sds-ov__rows">
            {def.states.map(s => (
              <div class="sds-ov__row" key={s}>
                <code>{s}</code>
                <div>{specimen(base, s)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {def.examples && def.examples.length > 0 && (
        <div class="sds-ov__block">
          <h4>In context</h4>
          {def.examples.map(ex => (
            <div class="sds-ov__example" key={ex.id}>
              <strong>{ex.title}</strong>
              {ex.description && <p>{ex.description}</p>}
              <div class="sds-ov__exrender">{ex.render()}</div>
            </div>
          ))}
        </div>
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
