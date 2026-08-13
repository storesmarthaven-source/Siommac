import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { defaultProps, propsForVariant, type ComponentDef, type StyleControl } from '../registry';
import { type GalleryDraft } from '../gallery/galleryStore';
import usage from './generated/button-usage.json';
import {
  BUTTON_STATES, BUTTON_VARIANTS, type ButtonRecipeState, type CanonicalButtonVariant,
  type DesignSystemRevision,
} from '../../../types/designSystem';
import { PreviewScope } from './PreviewScope';

type Target = 'all' | CanonicalButtonVariant;

function friendly(value: string): string {
  return value.replace(/[-_]/g, ' ').replace(/^./, first => first.toUpperCase());
}

function friendlyGroup(value: string): string {
  if (value === 'Geometry') return 'Size and shape';
  if (value === 'Interaction states') return 'States';
  if (value === 'Danger, link & toggle') return 'Special styles';
  return value;
}

function belongs(control: StyleControl, target: Target, state: ButtonRecipeState): boolean {
  if (target === 'all') {
    return control.scope === 'shared' || (
      !control.variant &&
      !BUTTON_VARIANTS.some(variant => control.name.startsWith(`--ui-button-${variant}-`)) &&
      control.scope !== 'state'
    );
  }

  const prefix = `--ui-button-${target}-`;
  if (state === 'default') return control.name.startsWith(prefix) && !control.name.includes('-hover') && !control.name.includes('-active');
  if (state === 'hover' || state === 'active') return control.name.startsWith(prefix) && control.name.includes(`-${state}`);
  return control.state === state;
}

function friendlyError(error: string): string {
  return /unauthorized/i.test(error)
    ? 'Sign in with Design System permissions to save or publish changes.'
    : error;
}

function TokenControl({ control, studio }: { control: StyleControl; studio: GalleryDraft }): VNode {
  const custom = Object.prototype.hasOwnProperty.call(studio.values, control.name);
  const read = studio.read(control.name);
  const value = read.length > 0 ? read : (control.linkedTo ?? '');

  return (
    <div class="sds-edit-field">
      <div class="sds-edit-field__head">
        <label for={`style-${control.name}`}>{control.label}</label>
        <label class="sds-theme-switch">
          <input type="checkbox" checked={!custom} onChange={() => {
            if (custom) studio.link(control.name, control.linkedTo ?? 'initial');
            else studio.set(control.name, value.length > 0 ? value : (control.linkedTo ?? 'initial'));
          }} />
          <span>Use theme</span>
        </label>
      </div>
      {custom ? (
        <div class="sds-edit-field__control">
          {control.kind.startsWith('color') && /^#[0-9a-f]{6}$/i.test(value) && (
            <input type="color" value={value} aria-label={`${control.label} colour`}
              onInput={event => studio.set(control.name, (event.target as HTMLInputElement).value)} />
          )}
          <input id={`style-${control.name}`} type="text" value={value}
            onInput={event => studio.set(control.name, (event.target as HTMLInputElement).value)} />
        </div>
      ) : (
        <div class="sds-edit-field__theme"><span>Theme value</span><strong>{value.length > 0 ? value : 'Default'}</strong></div>
      )}
    </div>
  );
}

export function RecipeStyleEditor({ def, draft: studio }: { def: ComponentDef; draft: GalleryDraft }): VNode {
  const [target, setTarget] = useState<Target>('primary');
  const [state, setState] = useState<ButtonRecipeState>('default');
  const [summary, setSummary] = useState('Update Button styling');
  const [review, setReview] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<DesignSystemRevision[] | null>(null);
  const groups = useMemo(() => (def.style ?? []).map(group => ({
    ...group,
    controls: group.controls.filter(control => belongs(control, target, state)),
  })).filter(group => group.controls.length > 0), [def, target, state]);
  const totals = usage.totals as { canonicalSites: number };
  const selectedSample = target === 'all' ? undefined : def.variantSamples?.find(sample => sample.value === target);
  const previewProps = target === 'all' ? defaultProps(def) : propsForVariant(def, target);

  const act = (operation: () => Promise<unknown>, message: string): void => {
    setNotice(null);
    void operation().then(() => setNotice(message)).catch(() => undefined);
  };

  return (
    <section class="sds-button-editor" aria-label="Button editor">
      <div class="sds-button-editor__main">
        <header class="sds-button-editor__intro">
          <div><h3>Choose a button to edit</h3><p>Select one style, then change its settings on the right.</p></div>
          <span>Published v{studio.publishedVersion}</span>
        </header>

        <div class="sds-button-picker" role="radiogroup" aria-label="Button to edit">
          <button type="button" role="radio" aria-checked={target === 'all'} class={target === 'all' ? 'is-on' : ''}
            onClick={() => { setTarget('all'); setState('default'); }}>
            <span class="sds-button-picker__all" aria-hidden="true"><i /><i /><i /></span>
            <strong>All buttons</strong><small>Shared size and shape</small>
          </button>
          {BUTTON_VARIANTS.map(variant => {
            const sample = def.variantSamples?.find(item => item.value === variant);
            return (
              <button type="button" role="radio" aria-checked={target === variant} class={target === variant ? 'is-on' : ''}
                onClick={() => { setTarget(variant); setState('default'); }}>
                <span class={`ui-btn ui-btn--${variant}`} aria-hidden="true">{sample?.props.label ?? friendly(variant)}</span>
                <strong>{sample?.title ?? friendly(variant)}</strong><small>{sample?.description ?? 'Button style'}</small>
              </button>
            );
          })}
        </div>

        <PreviewScope class="sds-button-preview" attach={studio.attachScope}>
          <header><div><span>Preview</span><strong>{target === 'all' ? 'All buttons' : `${selectedSample?.title ?? friendly(target)} button`}</strong></div><small>Draft preview</small></header>
          {target === 'all' ? (
            <div class="sds-button-preview__all">{BUTTON_VARIANTS.map(variant => def.render?.(propsForVariant(def, variant), 'default'))}</div>
          ) : (
            <div class="sds-button-preview__single">{def.render?.(previewProps, state === 'default' ? 'default' : state)}</div>
          )}
        </PreviewScope>
      </div>

      <aside class="sds-button-settings" aria-label="Button settings">
        <header class="sds-button-settings__head">
          <div><span>Editing</span><strong>{target === 'all' ? 'All buttons' : `${selectedSample?.title ?? friendly(target)} button`}</strong></div>
          <button type="button" onClick={() => act(async () => { setHistory(await studio.history()); }, 'Version history loaded.')}>History</button>
        </header>

        {target !== 'all' && (
          <div class="sds-button-settings__state">
            <label for="button-state">State</label>
            <select id="button-state" value={state} onChange={event => setState((event.target as HTMLSelectElement).value as ButtonRecipeState)}>
              {BUTTON_STATES.map(item => <option value={item}>{friendly(item)}</option>)}
            </select>
          </div>
        )}

        <div class="sds-button-settings__body">
          {groups.length ? groups.map(group => (
            <section key={group.label}><h4>{friendlyGroup(group.label)}</h4>{group.controls.map(control => <TokenControl key={control.name} control={control} studio={studio} />)}</section>
          )) : <div class="sds-button-settings__empty"><strong>This state uses the default style</strong><p>There is nothing extra to change here.</p></div>}
        </div>

        <p class="sds-button-settings__inherit">Dropdown and Split Button use these styles automatically.</p>
        {studio.error && <p class="sds-style__error" role="alert">{friendlyError(studio.error)}</p>}
        {notice && <p class="sds-style__notice" role="status">{notice}</p>}
        <footer class="sds-button-settings__actions">
          <span>{studio.dirtyCount ? `${studio.dirtyCount} unsaved` : 'Up to date'}</span>
          <div><button type="button" onClick={studio.resetAll} disabled={!studio.dirtyCount}>Discard</button><button type="button" onClick={() => act(studio.saveDraft, 'Draft saved.')} disabled={studio.loading || studio.saving || !studio.dirtyCount}>Save draft</button><button type="button" class="is-primary" onClick={() => setReview(true)} disabled={studio.loading || studio.saving || !studio.dirtyCount}>Publish</button></div>
        </footer>
      </aside>

      {history && <div class="sds-review" role="dialog" aria-modal="true" aria-labelledby="history-title"><div class="sds-review__card"><h3 id="history-title">Version history</h3><div class="sds-history__list">{history.map(item => <article key={item.version}><div><strong>v{item.version}</strong><span>{item.summary ?? 'No summary'}</span><small>{item.publishedAt ? new Date(item.publishedAt).toLocaleString() : 'Unknown date'}</small></div>{item.version !== studio.publishedVersion && <button type="button" onClick={() => act(() => studio.rollback(item.version, `Rollback to v${item.version} from Studio`), `Restored v${item.version}.`)}>Restore</button>}</article>)}</div><div class="sds-style__dialog-actions"><button type="button" onClick={() => setHistory(null)}>Close</button></div></div></div>}

      {review && <div class="sds-review" role="dialog" aria-modal="true" aria-labelledby="publish-title"><div class="sds-review__card"><h3 id="publish-title">Publish Button styles?</h3><p>{studio.dirtyCount} style change{studio.dirtyCount === 1 ? '' : 's'} will update {totals.canonicalSites} Button uses. Preview labels and content are not included.</p><label>Describe this change<input value={summary} onInput={event => setSummary((event.target as HTMLInputElement).value)} /></label><div class="sds-style__dialog-actions"><button type="button" onClick={() => setReview(false)}>Cancel</button><button type="button" class="is-primary" disabled={summary.trim().length === 0 || studio.saving} onClick={() => { act(() => studio.publish(summary), 'Published successfully.'); setReview(false); }}>Publish v{studio.publishedVersion + 1}</button></div></div></div>}
    </section>
  );
}
