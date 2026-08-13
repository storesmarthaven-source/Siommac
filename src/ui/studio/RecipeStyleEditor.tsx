import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { defaultProps, type ComponentDef, type StyleControl } from '../registry';
import { type UiState } from '../tokens';
import { type GalleryDraft } from '../gallery/galleryStore';
import usage from './generated/button-usage.json';
import { BUTTON_STATES, BUTTON_VARIANTS, type ButtonRecipeState, type CanonicalButtonVariant } from '../../../types/designSystem';
import { type DesignSystemRevision } from '../../../types/designSystem';
import { PreviewScope } from './PreviewScope';

type Scope = 'all' | 'variant' | 'variant-state' | 'composition';

function stateForPreview(state: ButtonRecipeState): UiState {
  return state === 'default' ? 'default' : state;
}

function belongs(control: StyleControl, scope: Scope, variant: CanonicalButtonVariant, state: ButtonRecipeState): boolean {
  const variantPrefix = `--ui-button-${variant}-`;
  if (scope === 'all') return control.scope === 'shared' || (!control.variant && !BUTTON_VARIANTS.some(v => control.name.startsWith(`--ui-button-${v}-`)) && control.scope !== 'state');
  if (scope === 'composition') return false;
  if (scope === 'variant') return control.name.startsWith(variantPrefix) && !control.name.includes('-hover') && !control.name.includes('-active');
  if (state === 'hover' || state === 'active') return control.name.startsWith(variantPrefix) && control.name.includes(`-${state}`);
  return control.state === state;
}

function valueType(control: StyleControl): string {
  return control.kind.startsWith('color') ? 'Colour token' : control.kind === 'size' ? 'Size token' : 'Token value';
}

function TokenControl({ control, studio }: { control: StyleControl; studio: GalleryDraft }): VNode {
  const overridden = Object.prototype.hasOwnProperty.call(studio.values, control.name);
  const inherited = studio.read(control.name);
  const value = inherited.length > 0 ? inherited : (control.linkedTo ?? '');
  return (
    <div class="sds-style-control">
      <div class="sds-style-control__head">
        <div><strong>{control.label}</strong><span>{valueType(control)}</span></div>
        <div class="sds-link-mode" role="group" aria-label={`${control.label} source`}>
          <button type="button" class={!overridden ? 'is-on' : ''} aria-pressed={!overridden}
            onClick={() => studio.link(control.name, control.linkedTo ?? 'initial')}>Linked</button>
          <button type="button" class={overridden ? 'is-on' : ''} aria-pressed={overridden}
            onClick={() => studio.set(control.name, value.length > 0 ? value : (control.linkedTo ?? 'initial'))}>Override</button>
        </div>
      </div>
      <div class="sds-style-control__field">
        {control.kind.startsWith('color') && /^#[0-9a-f]{6}$/i.test(value) && (
          <input type="color" value={value} disabled={!overridden} aria-label={`${control.label} colour`}
            onInput={event => studio.set(control.name, (event.target as HTMLInputElement).value)} />
        )}
        <input type="text" value={value} disabled={!overridden} aria-label={control.label}
          onInput={event => studio.set(control.name, (event.target as HTMLInputElement).value)} />
        {overridden && <button type="button" onClick={() => studio.link(control.name, control.linkedTo ?? 'initial')} aria-label={`Reset ${control.label}`}>Reset</button>}
      </div>
      <code>{control.name}</code>
      {control.help && <p>{control.help}</p>}
    </div>
  );
}

export function RecipeStyleEditor({ def, draft: studio }: { def: ComponentDef; draft: GalleryDraft }): VNode {
  const [scope, setScope] = useState<Scope>('all');
  const [variant, setVariant] = useState<CanonicalButtonVariant>('primary');
  const [state, setState] = useState<ButtonRecipeState>('default');
  const [summary, setSummary] = useState('Refine canonical Button recipe');
  const [review, setReview] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<DesignSystemRevision[] | null>(null);
  const controls = useMemo(() => (def.style ?? []).flatMap(group => group.controls)
    .filter(control => belongs(control, scope, variant, state)), [def, scope, variant, state]);
  const props = { ...defaultProps(def), variant };
  const totals = usage.totals as { canonicalSites: number; distinctShapes: number; legacyButtons: number; rawAppButtons: number };

  const act = (operation: () => Promise<unknown>, message: string): void => {
    setNotice(null);
    void operation().then(() => setNotice(message)).catch(() => undefined);
  };

  return (
    <section class="sds-style" aria-label={`${def.name} style editor`}>
      <header class="sds-style__top">
        <div><span>Recipe Studio</span><h3>Button Style</h3><p>Govern the real Button recipe. Preview props remain separate and are never published.</p></div>
        <div class="sds-style__version"><span>Published</span><strong>v{studio.publishedVersion}</strong><small>{studio.serverDraft ? `Draft r${studio.serverDraft.revision}` : 'No server draft'}</small></div>
      </header>

      <div class="sds-style__scope" role="tablist" aria-label="Recipe scope">
        {([
          ['all', 'All Button'], ['variant', 'Variant'], ['variant-state', 'Variant + state'], ['composition', 'Pattern / composition'],
        ] as const).map(([id, label]) => <button type="button" role="tab" aria-selected={scope === id} class={scope === id ? 'is-on' : ''} onClick={() => setScope(id)}>{label}</button>)}
      </div>

      {scope !== 'all' && <div class="sds-style__selectors">
        <label>Variant<select value={variant} onChange={event => setVariant((event.target as HTMLSelectElement).value as CanonicalButtonVariant)}>{BUTTON_VARIANTS.map(item => <option value={item}>{item}</option>)}</select></label>
        {scope === 'variant-state' && <label>State<select value={state} onChange={event => setState((event.target as HTMLSelectElement).value as ButtonRecipeState)}>{BUTTON_STATES.map(item => <option value={item}>{item}</option>)}</select></label>}
      </div>}

      <div class="sds-style__layout">
        <PreviewScope class="sds-style__preview" attach={studio.attachScope}>
          <span class="sds-style__eyebrow">Scoped live preview</span>
          <div class="sds-style__specimen">{def.render?.(props, stateForPreview(state))}</div>
          <div class="sds-style__matrix">
            {BUTTON_VARIANTS.map(item => <div><span>{item}</span>{def.render?.({ ...defaultProps(def), variant: item }, scope === 'variant-state' ? stateForPreview(state) : 'default')}</div>)}
          </div>
        </PreviewScope>

        <aside class="sds-style__inspector">
          {scope === 'composition' ? (
            <div class="sds-style__ownership"><strong>No Button-owned composition tokens</strong><p>Dropdown and Split Button compose the canonical Button with Menu. Their keyboard, ARIA and menu behaviour stay locked in their own component definitions; they inherit Button styling here.</p></div>
          ) : controls.length ? controls.map(control => <TokenControl key={control.name} control={control} studio={studio} />) : (
            <div class="sds-style__ownership"><strong>No override at this scope</strong><p>This state inherits its variant and shared recipe values. The behaviour remains locked.</p></div>
          )}
        </aside>
      </div>

      <section class="sds-impact">
        <div><span>Canonical consumers</span><strong>{totals.canonicalSites}</strong><small>{totals.distinctShapes} distinct prop shapes update on publish</small></div>
        <div><span>Legacy exposure</span><strong>{totals.legacyButtons}</strong><small>{totals.rawAppButtons} raw app buttons remain outside canonical impact</small></div>
        <div><span>Locked contract</span><strong>6 variants</strong><small>Semantics, keyboard, ARIA and behaviour cannot be edited</small></div>
      </section>

      {history && <section class="sds-history">
        <header><div><span>Review</span><h4>Published history &amp; rollback</h4></div><button type="button" onClick={() => setHistory(null)}>Close</button></header>
        <div class="sds-history__compare"><strong>Current draft comparison</strong><span>{studio.dirtyCount} token change{studio.dirtyCount === 1 ? '' : 's'} against published v{studio.publishedVersion}</span><code>{Object.keys(studio.values).length > 0 ? Object.keys(studio.values).join('\n') : 'Linked-mode removals only'}</code></div>
        <div class="sds-history__list">{history.map(item => <article key={item.version}><div><strong>v{item.version}</strong><span>{item.summary ?? 'No summary'}</span><small>{item.publishedAt ? new Date(item.publishedAt).toLocaleString() : 'Unknown date'}</small></div>{item.version !== studio.publishedVersion && <button type="button" onClick={() => act(() => studio.rollback(item.version, `Rollback to v${item.version} from Studio`), `Restored v${item.version} as a new published version.`)}>Restore as new version</button>}</article>)}</div>
      </section>}

      {studio.error && <p class="sds-style__error" role="alert">{studio.error}</p>}
      {notice && <p class="sds-style__notice" role="status">{notice}</p>}
      <footer class="sds-style__actions">
        <button type="button" onClick={studio.resetAll} disabled={!studio.dirtyCount}>Reset local changes</button>
        <button type="button" onClick={() => act(async () => { setHistory(await studio.history()); }, 'History loaded.')}>Compare &amp; history</button>
        <button type="button" onClick={() => act(studio.saveDraft, 'Draft saved and version-checked.')} disabled={studio.loading || studio.saving || !studio.dirtyCount}>Save draft</button>
        <button type="button" class="is-primary" onClick={() => setReview(true)} disabled={studio.loading || studio.saving || !studio.dirtyCount}>Review &amp; publish</button>
      </footer>

      {review && <div class="sds-review" role="dialog" aria-modal="true" aria-labelledby="sds-review-title">
        <div class="sds-review__card"><h3 id="sds-review-title">Publish Button recipe</h3>
          <p>{studio.dirtyCount} governed token override{studio.dirtyCount === 1 ? '' : 's'} will update {totals.canonicalSites} canonical consumers. Preview labels, icons and props are excluded.</p>
          <label>Change summary<input value={summary} onInput={event => setSummary((event.target as HTMLInputElement).value)} /></label>
          <div class="sds-review__checks"><span>✓ Schema v1</span><span>✓ Six canonical variants</span><span>✓ Accessibility contract locked</span><span>✓ Arbitrary CSS rejected</span></div>
          <div class="sds-style__actions"><button type="button" onClick={() => setReview(false)}>Cancel</button><button type="button" class="is-primary" disabled={summary.trim().length === 0 || studio.saving} onClick={() => { act(() => studio.publish(summary), 'Published successfully.'); setReview(false); }}>Publish v{studio.publishedVersion + 1}</button></div>
        </div>
      </div>}
    </section>
  );
}
