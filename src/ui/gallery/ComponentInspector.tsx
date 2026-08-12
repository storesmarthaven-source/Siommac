/**
 * src/ui/gallery/ComponentInspector.tsx — the right-hand pane.
 *
 * PROPS · STYLE · STATES · A11Y · CODE
 *
 * Renders itself entirely from the component's registry definition. There is no
 * per-component inspector code and there must never be — adding a component to
 * the workbench has to stay "write a definition", or the Gallery becomes another
 * thing to maintain per component.
 *
 * Every control here does something. A decorative slider in a design-system
 * workbench is worse than no slider: it teaches the team that the tool lies.
 */

import { type VNode } from 'preact';
import { LucideIcon } from '../LucideIcon';
import { Button } from '../primitives/Button';
import { TextInput } from '../primitives/TextInput';
import { type UiState } from '../tokens';
import {
  type ComponentDef, type PropControl, type PropValues, type StyleControl,
} from '../registry';
import { type GalleryDraft } from './galleryStore';

export type InspectorTab = 'props' | 'style' | 'states' | 'a11y' | 'code' | 'migration';

export const INSPECTOR_TABS: readonly { key: InspectorTab; label: string }[] = [
  { key: 'props',  label: 'Props' },
  { key: 'style',  label: 'Style' },
  { key: 'states', label: 'States' },
  { key: 'a11y',   label: 'A11Y' },
  { key: 'code',   label: 'Code' },
  { key: 'migration', label: 'Migr.' },
];

export interface ComponentInspectorProps {
  def: ComponentDef;
  tab: InspectorTab;
  onTab: (t: InspectorTab) => void;
  props: PropValues;
  onProp: (key: string, value: string | number | boolean) => void;
  onPreset: (values: PropValues) => void;
  onResetProps: () => void;
  state: UiState;
  onState: (s: UiState) => void;
  draft: GalleryDraft;
  /** Pinned action row (Reset / Export / Apply). */
  footer?: VNode;
}

export function ComponentInspector({
  def, tab, onTab, props, onProp, onPreset, onResetProps, state, onState, draft, footer,
}: ComponentInspectorProps): VNode {
  return (
    <aside class="ui-gallery-inspector" aria-label="Component inspector">
      <div class="ui-gallery-tabs" role="tablist" aria-label="Inspector sections">
        {INSPECTOR_TABS.map(t => (
          <button
            key={t.key}
            type="button"
            role="tab"
            class="ui-gallery-tab"
            aria-selected={tab === t.key}
            onClick={() => onTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div class="ui-gallery-panel" role="tabpanel">
        {tab === 'props'  && <PropsTab def={def} props={props} onProp={onProp} onPreset={onPreset} onReset={onResetProps} />}
        {tab === 'style'  && <StyleTab def={def} draft={draft} />}
        {tab === 'states' && <StatesTab def={def} state={state} onState={onState} />}
        {tab === 'a11y'   && <A11yTab def={def} />}
        {tab === 'code'   && <CodeTab def={def} props={props} state={state} />}
        {tab === 'migration' && <MigrationTab def={def} />}
      </div>

      {footer}
    </aside>
  );
}

/* ── PROPS ─────────────────────────────────────────────────────────────────*/

function PropsTab(
  { def, props, onProp, onPreset, onReset }:
  { def: ComponentDef; props: PropValues; onProp: (k: string, v: string | number | boolean) => void; onPreset: (v: PropValues) => void; onReset: () => void },
): VNode {
  return (
    <>
      {def.presets && def.presets.length > 0 && (
        <div class="ui-gallery-control">
          <div class="ui-gallery-section-title">Presets</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            {def.presets.map(p => (
              <Button key={p.label} variant="outline" size="sm" onClick={() => onPreset(p.props)}>{p.label}</Button>
            ))}
          </div>
        </div>
      )}

      <div class="ui-gallery-section-title">Props</div>
      {Object.entries(def.props ?? {}).map(([key, control]) => (
        <PropRow key={key} name={key} control={control} value={props[key]} onChange={v => onProp(key, v)} />
      ))}

      <Button variant="ghost" size="sm" iconLeft={<LucideIcon name="RotateCcw" />} onClick={onReset}>
        Reset props
      </Button>
    </>
  );
}

function PropRow(
  { name, control, value, onChange }:
  { name: string; control: PropControl; value: PropValues[string] | undefined; onChange: (v: string | number | boolean) => void },
): VNode {
  if (control.type === 'boolean') {
    return (
      <div class="ui-gallery-control">
        <label class="ui-gallery-check">
          <input type="checkbox" checked={value === true} onChange={e => onChange((e.target as HTMLInputElement).checked)} />
          <span>{control.label}</span>
        </label>
        {control.help && <div class="ui-gallery-control-help">{control.help}</div>}
      </div>
    );
  }

  if (control.type === 'segmented') {
    return (
      <div class="ui-gallery-control">
        <div class="ui-gallery-control-label">{control.label}</div>
        <div class="ui-gallery-seg" role="group" aria-label={control.label}>
          {control.options.map(o => (
            <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(o)}>{o}</button>
          ))}
        </div>
        {control.help && <div class="ui-gallery-control-help">{control.help}</div>}
      </div>
    );
  }

  if (control.type === 'select' || control.type === 'icon') {
    const options = control.type === 'select' ? control.options : [];
    return (
      <div class="ui-gallery-control">
        <label class="ui-gallery-control-label" for={`p-${name}`}>{control.label}</label>
        <select
          id={`p-${name}`}
          class="ui-ctrl-input"
          style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-xs)', padding: '6px 8px', background: '#fff' }}
          value={String(value ?? '')}
          onChange={e => onChange((e.target as HTMLSelectElement).value)}
        >
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        {control.help && <div class="ui-gallery-control-help">{control.help}</div>}
      </div>
    );
  }

  if (control.type === 'number') {
    return (
      <div class="ui-gallery-control">
        <label class="ui-gallery-control-label" for={`p-${name}`}>{control.label}</label>
        <TextInput
          id={`p-${name}`}
          size="sm"
          type="number"
          value={String(value ?? control.default)}
          min={control.min}
          max={control.max}
          step={control.step}
          onInput={v => onChange(Number(v))}
          aria-label={control.label}
        />
        {control.help && <div class="ui-gallery-control-help">{control.help}</div>}
      </div>
    );
  }

  return (
    <div class="ui-gallery-control">
      <label class="ui-gallery-control-label" for={`p-${name}`}>{control.label}</label>
      <TextInput
        id={`p-${name}`}
        size="sm"
        value={String(value ?? '')}
        placeholder={control.placeholder}
        onInput={onChange}
        aria-label={control.label}
      />
      {control.help && <div class="ui-gallery-control-help">{control.help}</div>}
    </div>
  );
}

/* ── STYLE ─────────────────────────────────────────────────────────────────*/

function StyleTab({ def, draft }: { def: ComponentDef; draft: GalleryDraft }): VNode {
  return (
    <>
      <div class="ui-gallery-note">
        <LucideIcon name="Info" size={13} />
        <span>
          These are <strong>{def.name}</strong> recipe variables. Changes apply to the preview only
          until you press Apply. Global colours and spacing live under Foundations.
        </span>
      </div>

      {(def.style ?? []).map(group => (
        <div key={group.label} style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <div class="ui-gallery-section-title">{group.label}</div>
          {group.controls.map(c => (
            <StyleRow key={c.name} control={c} draft={draft} />
          ))}
        </div>
      ))}
    </>
  );
}

function StyleRow({ control, draft }: { control: StyleControl; draft: GalleryDraft }): VNode {
  const dirty = control.name in draft.values;
  const value = draft.read(control.name);

  return (
    <div class={`ui-gallery-control${dirty ? ' ui-gallery-control--dirty' : ''}`}>
      <div class="ui-gallery-control-label">
        <span>{control.label}</span>
        {dirty && (
          <button type="button" class="ui-gallery-revert" title="Revert to published value" aria-label={`Revert ${control.label}`} onClick={() => draft.revert(control.name)}>
            <LucideIcon name="RotateCcw" />
          </button>
        )}
      </div>

      {control.kind === 'color' || control.kind === 'color-alpha'
        ? (
          <div class="ui-gallery-swatch-row">
            {/* A native colour input cannot express rgba(), so the text field
                stays authoritative and the swatch is a convenience. Hiding the
                text field would make every translucent token uneditable. */}
            <input
              class="ui-gallery-swatch"
              type="color"
              value={toHex(value)}
              aria-label={`${control.label} colour`}
              onInput={e => draft.set(control.name, (e.target as HTMLInputElement).value)}
            />
            <TextInput size="sm" value={value} onInput={v => draft.set(control.name, v)} aria-label={control.label} />
          </div>
        )
        : control.kind === 'select'
          ? (
            <select
              class="ui-ctrl-input"
              style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-xs)', padding: '6px 8px', background: '#fff' }}
              value={value}
              aria-label={control.label}
              onChange={e => draft.set(control.name, (e.target as HTMLSelectElement).value)}
            >
              {control.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )
          : <TextInput size="sm" value={value} onInput={v => draft.set(control.name, v)} aria-label={control.label} />}

      {control.help && <div class="ui-gallery-control-help">{control.help}</div>}
      <div class="ui-gallery-var">{control.name}</div>
    </div>
  );
}

/** Best-effort hex for the native colour swatch. Non-hex values fall back to black. */
function toHex(value: string): string {
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(v);
  if (m) {
    const hex = (n: string): string => Number(n).toString(16).padStart(2, '0');
    return `#${hex(m[1]!)}${hex(m[2]!)}${hex(m[3]!)}`;
  }
  return '#000000';
}

/* ── STATES ────────────────────────────────────────────────────────────────*/

const STATE_NOTE: Partial<Record<UiState, string>> = {
  hover:    'Forced with data-ui-state — the recipe pairs every :hover rule with the same attribute selector.',
  focus:    'Forced. The real component uses :focus-visible, so a mouse click leaves no ring.',
  active:   'Forced. Shown while the control is being pressed.',
  disabled: 'Real prop, not forced. A real treatment, never opacity: .5.',
  readonly: 'Real prop. A DIFFERENT state from disabled — the value stays legible and copyable.',
  loading:  'Real prop. Sets aria-busy and blocks activation without leaving the tab order.',
  error:    'Real prop. Sets aria-invalid and swaps the border and focus ring.',
  warning:  'Real prop. Advisory only — does NOT set aria-invalid.',
  success:  'Real prop.',
  open:     'Real state. The dropdown surface is portalled to <body>.',
};

function StatesTab({ def, state, onState }: { def: ComponentDef; state: UiState; onState: (s: UiState) => void }): VNode {
  return (
    <>
      <div class="ui-gallery-section-title">Preview state</div>
      <div style={{ display: 'grid', gap: '6px' }}>
        {(def.states ?? []).map(sKey => (
          <label key={sKey} class="ui-gallery-check">
            <input type="radio" name="ui-state" checked={state === sKey} onChange={() => onState(sKey)} />
            <span>{sKey}</span>
          </label>
        ))}
      </div>
      {STATE_NOTE[state] && (
        <div class="ui-gallery-note">
          <LucideIcon name="Info" size={13} />
          <span>{STATE_NOTE[state]}</span>
        </div>
      )}
      <div class="ui-gallery-control-help">
        Compare mode shows every state at once — use it to check they stay visually distinct.
      </div>
    </>
  );
}

/* ── A11Y ──────────────────────────────────────────────────────────────────*/

function A11yTab({ def }: { def: ComponentDef }): VNode {
  if (!def.a11y) {
    return <div class="ui-gallery-control-help">No accessibility contract recorded yet.</div>;
  }
  return (
    <>
      <div class="ui-gallery-kv">
        <div class="ui-gallery-kv-key">Role</div>
        <div class="ui-gallery-kv-val">{def.a11y.role ?? 'Native element — no explicit role'}</div>
      </div>

      <div class="ui-gallery-kv">
        <div class="ui-gallery-kv-key">Accessible name</div>
        <div class="ui-gallery-kv-val">{def.a11y.name}</div>
      </div>

      <div class="ui-gallery-kv">
        <div class="ui-gallery-kv-key">Focus</div>
        <div class="ui-gallery-kv-val">{def.a11y.focus}</div>
      </div>

      <div>
        <div class="ui-gallery-kv-key" style={{ marginBottom: '6px' }}>Keyboard</div>
        <div class="ui-gallery-keys">
          {def.a11y.keyboard.map(k => (
            <div key={k.keys} class="ui-gallery-key-row">
              <kbd class="ui-gallery-kbd">{k.keys}</kbd>
              <span class="ui-gallery-kv-val">{k.does}</span>
            </div>
          ))}
        </div>
      </div>

      {def.a11y.notes?.map(n => (
        <div key={n} class="ui-gallery-note">
          <LucideIcon name="Info" size={13} />
          <span>{n}</span>
        </div>
      ))}
    </>
  );
}

/* ── CODE ──────────────────────────────────────────────────────────────────*/

function CodeTab({ def, props, state }: { def: ComponentDef; props: PropValues; state: UiState }): VNode {
  const snippet = def.code?.(props, state) ?? def.plannedApi ?? '// Not built yet.';
  const importLine = `import { ${def.name.replace(/\s/g, '')} } from '${def.importFrom ?? '@ui'}';`;
  return (
    <>
      <div class="ui-gallery-section-title">Usage</div>
      <pre class="ui-gallery-code">{`${importLine}\n\n${snippet}`}</pre>
      <Button
        variant="outline"
        size="sm"
        iconLeft={<LucideIcon name="Copy" />}
        onClick={() => { void navigator.clipboard.writeText(`${importLine}\n\n${snippet}`); }}
      >
        Copy
      </Button>
      <div class="ui-gallery-control-help">
        Generated from the props above — change a control and this updates with it.
      </div>
    </>
  );
}

/* ── MIGRATION ─────────────────────────────────────────────────────────────
   The tab that turns the Gallery into the migration control centre: what this
   component supersedes, and what is queued next. Counts across the codebase are
   produced by `npm run ui:coverage` rather than at runtime — the browser has no
   business grepping the repo, and a number computed two different ways would
   eventually disagree with itself. */

function MigrationTab({ def }: { def: ComponentDef }): VNode {
  const m = def.migration;

  return (
    <>
      <div class="ui-gallery-kv">
        <div class="ui-gallery-kv-key">Canonical implementation</div>
        <div class="ui-gallery-kv-val">
          <code>{def.componentPath ?? 'not built yet'}</code>
        </div>
      </div>

      <div class="ui-gallery-kv">
        <div class="ui-gallery-kv-key">Status</div>
        <div class="ui-gallery-kv-val">{def.status}</div>
      </div>

      {m?.replaces?.length ? (
        <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
          <div class="ui-gallery-kv-key">Replaces (legacy classes)</div>
          <div class="ui-gal-chiplist">
            {m.replaces.map(c => <span key={c} class="ui-gal-chip">{c}</span>)}
          </div>
        </div>
      ) : null}

      {m?.deprecatedImports?.length ? (
        <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
          <div class="ui-gallery-kv-key">Deprecated imports</div>
          <div class="ui-gal-chiplist">
            {m.deprecatedImports.map(c => <span key={c} class="ui-gal-chip ui-gal-chip--danger">{c}</span>)}
          </div>
        </div>
      ) : null}

      {m?.rawPatterns?.length ? (
        <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
          <div class="ui-gallery-kv-key">Unmanaged raw markup</div>
          <div class="ui-gal-chiplist">
            {m.rawPatterns.map(c => <span key={c} class="ui-gal-chip">{c}</span>)}
          </div>
        </div>
      ) : null}

      {m?.nextSurface ? (
        <div class="ui-gallery-kv">
          <div class="ui-gallery-kv-key">Next migration</div>
          <div class="ui-gallery-kv-val">{m.nextSurface}</div>
        </div>
      ) : null}

      {m?.notes?.map(n => (
        <div key={n} class="ui-gallery-note">
          <LucideIcon name="Info" size={13} />
          <span>{n}</span>
        </div>
      ))}

      <div class="ui-gallery-note ui-gallery-note--warn">
        <LucideIcon name="TriangleAlert" size={13} />
        <span>
          A surface is <strong>not</strong> migrated just because <code>&lt;{def.name} /&gt;</code> appears in
          its JSX. If module CSS still overrides the recipe, the migration is unfinished — the
          legacy rules have to be <strong>deleted</strong>. See <code>src/ui/RECIPES.md</code> §4.
        </span>
      </div>

      <div class="ui-gallery-control-help">
        Live counts across the codebase: <code>npm run ui:coverage</code>.
        The ratchet that stops new legacy being added: <code>npm run ui:coverage:check</code>.
      </div>
    </>
  );
}
