import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import {
  BUTTON_PATTERNS, COMPOUND_OF, findComponent,
  type ButtonPattern, type ButtonPatternControl, type ButtonPatternValues,
  type ComponentDef, type ComponentFamily,
} from '../registry';
import { LucideIcon } from '../LucideIcon';
import { IconPicker, StudioColorControl } from './RecipeStyleEditor';
import { buttonFamilyPreviewProps } from './buttonFamilyPreview';
import { type GalleryDraft } from '../gallery/galleryStore';

export interface ButtonBrowserProps {
  family: ComponentFamily;
  draft: GalleryDraft;
  selectedPattern?: ButtonPattern;
  onOpenComponent: (componentId: string) => void;
  onOpenPattern: (patternId: string) => void;
}

function PatternControl({ pattern, control, values, draft, onChange }: {
  pattern: ButtonPattern;
  control: ButtonPatternControl;
  values: ButtonPatternValues;
  draft: GalleryDraft;
  onChange: (name: string, value: string | boolean) => void;
}): VNode {
  const value = values[control.name];
  const id = `pattern-${pattern.id}-${control.name}`;

  if (control.type === 'icon') {
    return <div class="sds-pattern-field"><span>{control.label}</span><IconPicker
      id={`${pattern.id}-${control.name}`} label={control.label} value={String(value)}
      variant="outline" position="leading" recommendations={control.recommendations}
      onChange={next => onChange(control.name, next)} /></div>;
  }
  if (control.type === 'color') {
    return <div class="sds-pattern-field"><span>{control.label}</span><StudioColorControl
      id={`${pattern.id}-${control.name}`} label={control.label.replace(/ color$/i, '')} value={String(value)}
      savedColors={draft.savedColors} onSaveColor={draft.addSavedColor} onRemoveSavedColor={draft.removeSavedColor}
      onChange={next => onChange(control.name, next)} /></div>;
  }
  if (control.type === 'boolean') {
    return <label class="sds-pattern-toggle" for={id}><span>{control.label}</span><input id={id} aria-label={control.label} type="checkbox" checked={value === true}
      onChange={event => onChange(control.name, (event.target as HTMLInputElement).checked)} /></label>;
  }
  return <label class="sds-pattern-field" for={id}><span>{control.label}</span><select id={id} aria-label={control.label} value={String(value)}
    onInput={event => onChange(control.name, (event.target as HTMLSelectElement).value)}>
    {control.options.map(option => <option value={option.value}>{option.label}</option>)}
  </select></label>;
}

function ButtonPatternEditor({ pattern, draft, onEditFoundation }: { pattern: ButtonPattern; draft: GalleryDraft; onEditFoundation: () => void }): VNode {
  const [previewValues, setPreviewValues] = useState<ButtonPatternValues>({ ...pattern.defaults });
  const values = { ...previewValues };
  for (const control of pattern.controls) {
    if (!control.token) continue;
    const tokenValue = draft.values[control.token] ?? draft.read(control.token);
    if (!tokenValue) continue;
    values[control.name] = control.type === 'select' && control.tokenValues
      ? Object.entries(control.tokenValues).find(([, mapped]) => mapped === tokenValue)?.[0] ?? previewValues[control.name] ?? ''
      : tokenValue;
  }
  const set = (name: string, value: string | boolean): void => {
    const control = pattern.controls.find(item => item.name === name);
    setPreviewValues(previous => ({ ...previous, [name]: value, ...(name === 'icon' ? { iconSource: value === 'None' ? 'lucide' : 'lucide' } : {}) }));
    if (control?.token && typeof value === 'string') draft.set(control.token, control.type === 'select' ? control.tokenValues?.[value] ?? value : value);
  };
  const reset = (): void => {
    for (const control of pattern.controls) if (control.token) draft.revert(control.token);
    setPreviewValues({ ...pattern.defaults });
  };
  const applyPreset = (presetValues: ButtonPatternValues): void => {
    setPreviewValues(previous => ({ ...previous, ...presetValues }));
    const tokenValues: Record<string, string> = {};
    const ownedTokens: string[] = [];
    for (const [name, value] of Object.entries(presetValues)) {
      const control = pattern.controls.find(item => item.name === name);
      if (control?.token && typeof value === 'string') {
        ownedTokens.push(control.token);
        tokenValues[control.token] = value;
      }
    }
    draft.replaceGroup(ownedTokens, tokenValues);
  };
  const presetIsActive = (presetValues: ButtonPatternValues): boolean =>
    Object.entries(presetValues).every(([name, value]) => values[name] === value);

  return (
    <div class={`sds-button-pattern sds-owned-button${pattern.id === 'ai-action' ? ' sds-button-pattern--ai-action' : ''}`} data-ui-preview-scope>
      <header class="sds-button-pattern__head">
        <div><span>{pattern.badge}</span><h2>{pattern.name}</h2><p>{pattern.description}</p></div>
      </header>
      <section class="sds-owned-button__editor" aria-label={`${pattern.name} editor`}>
        <div class="sds-button-editor__main">
          <div class="sds-owned-button__stage">
            <header><div><span>Live preview</span><strong>{pattern.name}</strong></div><small>Updates instantly</small></header>
            <div class="sds-owned-button__canvas"><div class="sds-owned-button__specimen">{pattern.preview(values)}</div></div>
            <aside><strong>How it is governed</strong><p>{pattern.guidance}</p><span>{pattern.inheritance}</span></aside>
          </div>
          <section class="sds-button-use" aria-labelledby={`${pattern.id}-use-title`}>
            <header><h3 id={`${pattern.id}-use-title`}>Common application use</h3><p>Real examples of how this control appears in SIOMAC.</p></header>
            <div class="sds-use-context">
              {pattern.examples.map(example => <article key={example.id}><span class="ctx-kicker">{example.label}</span><div>{example.render()}</div></article>)}
            </div>
          </section>
        </div>
        <aside class="sds-owned-button__settings" aria-label={`${pattern.name} settings`}>
          <header><div><span>Preview settings</span><strong>Try the {pattern.name}</strong></div><button type="button" onClick={reset}>Reset</button></header>
          <div class="sds-owned-button__controls"><section class="sds-button-pattern__controls">
            <h4>Preview options</h4>
            {pattern.presets && <div class="sds-pattern-presets" aria-label={`${pattern.name} color presets`}>
              {pattern.presets.map(preset => <button type="button" key={preset.id} aria-pressed={presetIsActive(preset.values)} onClick={() => applyPreset(preset.values)}
                style={`--preset-start:${String(preset.values.surfaceStart)};--preset-end:${String(preset.values.surfaceEnd)};--preset-glow:${String(preset.values.glowColor)}`}>
                <i aria-hidden="true" /><span>{preset.label}</span>
              </button>)}
            </div>}
            {pattern.controls.filter(control => !(pattern.id === 'ai-action' && control.name === 'icon' && values.iconSource !== 'lucide'))
              .map(control => <PatternControl key={control.name} pattern={pattern} control={control} values={values} draft={draft} onChange={set} />)}
          </section></div>
          {pattern.id === 'ai-action'
            ? <footer><LucideIcon name="CloudCog" size={15} /><p><strong>AI Action draft</strong><small>Colors and shape stay in draft until the Design System is published. Icon choice remains specific to each use.</small></p></footer>
            : pattern.id === 'special-treatments'
              ? <footer><LucideIcon name="Palette" size={15} /><p><strong>Credits treatment</strong><small>Base and glow colors belong to Credits and do not change the canonical Action Button.</small></p></footer>
            : <footer><LucideIcon name="Link2" size={15} /><p><strong>Shape and colors</strong><small>Change them in Action Button. The settings above only change this preview.</small></p><button type="button" onClick={onEditFoundation}>Change shape and colors</button></footer>}
        </aside>
      </section>
    </div>
  );
}

export function ButtonBrowser({ family, draft, selectedPattern, onOpenComponent, onOpenPattern }: ButtonBrowserProps): VNode {
  const members = family.componentIds
    .map(findComponent)
    .filter((component): component is ComponentDef => component !== undefined);

  if (selectedPattern) {
    return <ButtonPatternEditor pattern={selectedPattern} draft={draft}
      onEditFoundation={() => onOpenComponent(selectedPattern.foundationComponentId)} />;
  }

  return (
    <div class="sds-button-browser">
      <header class="sds-button-browser__head">
        <span>Component family</span><h2>{family.name}</h2>
        <p>Choose what you need. Components have their own interaction contract; patterns reuse Action Button without adding variants.</p>
      </header>

      <section class="sds-button-browser__section" aria-labelledby="button-components-title">
        <header><div><h3 id="button-components-title">Button components</h3><p>Different behavior, built from the same visual foundation.</p></div><span>{members.length} components</span></header>
        <div class="sds-button-browser__grid">
          {members.map(component => (
            <button type="button" class="sds-button-browser__card" key={component.id} onClick={() => onOpenComponent(component.id)}>
              <span class="sds-button-browser__badge">{COMPOUND_OF[component.id] ?? 'Canonical'}</span>
              <div class="sds-button-browser__specimen">
                <span class="sds-button-browser__canvas-label" aria-hidden="true">Component preview</span>
                <span class="sds-button-browser__canvas-control">{component.render?.(buttonFamilyPreviewProps(component), 'default')}</span>
              </div>
              <div class="sds-button-browser__copy"><strong>{component.name}</strong><p>{family.roles[component.id]}</p></div>
            </button>
          ))}
        </div>
      </section>

      <section class="sds-button-browser__section" aria-labelledby="button-patterns-title">
        <header><div><h3 id="button-patterns-title">Governed patterns</h3><p>Approved uses of Action Button—not new variants.</p></div><span>{BUTTON_PATTERNS.length} patterns</span></header>
        <div class="sds-button-browser__grid">
          {BUTTON_PATTERNS.map(pattern => (
            <button type="button" class={`sds-button-browser__card sds-button-browser__card--pattern${pattern.id === 'ai-action' ? ' sds-button-browser__card--ai-action' : ''}`} key={pattern.id} onClick={() => onOpenPattern(pattern.id)}>
              <span class="sds-button-browser__badge">{pattern.badge}</span>
              <div class="sds-button-browser__specimen">
                <span class="sds-button-browser__canvas-label" aria-hidden="true">Pattern preview</span>
                <span class="sds-button-browser__canvas-control">{pattern.preview()}</span>
              </div>
              <div class="sds-button-browser__copy"><strong>{pattern.name}</strong><p>{pattern.role}</p></div>
            </button>
          ))}
        </div>
      </section>

      <footer class="sds-button-browser__guardrail"><LucideIcon name="ShieldCheck" size={18} /><div><strong>Need something new?</strong><p>Start from Action Button or request a named governed pattern. Do not add an unowned variant.</p></div></footer>
    </div>
  );
}
