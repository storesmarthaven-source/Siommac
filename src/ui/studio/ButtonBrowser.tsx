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

export interface ButtonBrowserProps {
  family: ComponentFamily;
  selectedPattern?: ButtonPattern;
  onOpenComponent: (componentId: string) => void;
  onOpenPattern: (patternId: string) => void;
  onBack: () => void;
}

function PatternControl({ pattern, control, values, onChange }: {
  pattern: ButtonPattern;
  control: ButtonPatternControl;
  values: ButtonPatternValues;
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
      onChange={next => onChange(control.name, next)} /></div>;
  }
  if (control.type === 'boolean') {
    return <label class="sds-pattern-toggle" for={id}><span>{control.label}</span><input id={id} aria-label={control.label} type="checkbox" checked={value === true}
      onChange={event => onChange(control.name, (event.target as HTMLInputElement).checked)} /></label>;
  }
  return <label class="sds-pattern-field" for={id}><span>{control.label}</span><select id={id} aria-label={control.label} value={String(value)}
    onChange={event => onChange(control.name, (event.target as HTMLSelectElement).value)}>
    {control.options.map(option => <option value={option.value}>{option.label}</option>)}
  </select></label>;
}

function ButtonPatternEditor({ pattern, onBack, onEditFoundation }: { pattern: ButtonPattern; onBack: () => void; onEditFoundation: () => void }): VNode {
  const [values, setValues] = useState<ButtonPatternValues>({ ...pattern.defaults });
  const set = (name: string, value: string | boolean): void => setValues(previous => ({ ...previous, [name]: value }));

  return (
    <div class="sds-button-pattern sds-owned-button" data-ui-preview-scope>
      <button type="button" class="sds-wb__back" onClick={onBack}>← All buttons</button>
      <header class="sds-button-pattern__head">
        <div><span>{pattern.badge}</span><h2>{pattern.name}</h2><p>{pattern.description}</p></div>
      </header>
      <section class="sds-owned-button__editor" aria-label={`${pattern.name} editor`}>
        <div class="sds-owned-button__stage">
          <header><div><span>Live preview</span><strong>{pattern.name}</strong></div><small>Updates instantly</small></header>
          <div class="sds-owned-button__canvas"><div class="sds-owned-button__specimen">{pattern.preview(values)}</div></div>
          <aside><strong>How it is governed</strong><p>{pattern.guidance}</p><span>Inherits the published Action Button recipe</span></aside>
        </div>
        <aside class="sds-owned-button__settings" aria-label={`${pattern.name} settings`}>
          <header><div><span>Preview settings</span><strong>Try the {pattern.name}</strong></div><button type="button" onClick={() => setValues({ ...pattern.defaults })}>Reset</button></header>
          <div class="sds-owned-button__controls"><section class="sds-button-pattern__controls">
            <h4>Preview options</h4>
            {pattern.controls.map(control => <PatternControl key={control.name} pattern={pattern} control={control} values={values} onChange={set} />)}
          </section></div>
          <footer><LucideIcon name="Link2" size={15} /><p><strong>Shape and colors</strong><small>Change them in Action Button. The settings above only change this preview.</small></p><button type="button" onClick={onEditFoundation}>Change shape and colors</button></footer>
        </aside>
      </section>
      <section class="sds-button-pattern__examples" aria-labelledby="pattern-examples-title">
        <header><h3 id="pattern-examples-title">Approved examples</h3><p>Use these patterns consistently; labels and actions still belong to the application.</p></header>
        <div>{pattern.examples.map(example => <article key={example.id}><span>{example.label}</span><div>{example.render()}</div></article>)}</div>
      </section>
    </div>
  );
}

export function ButtonBrowser({ family, selectedPattern, onOpenComponent, onOpenPattern, onBack }: ButtonBrowserProps): VNode {
  const members = family.componentIds
    .map(findComponent)
    .filter((component): component is ComponentDef => component !== undefined);

  if (selectedPattern) {
    return <ButtonPatternEditor pattern={selectedPattern} onBack={() => onOpenPattern(family.id)}
      onEditFoundation={() => onOpenComponent(selectedPattern.foundationComponentId)} />;
  }

  return (
    <div class="sds-button-browser">
      <button type="button" class="sds-wb__back" onClick={onBack}>← Components</button>
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
            <button type="button" class="sds-button-browser__card sds-button-browser__card--pattern" key={pattern.id} onClick={() => onOpenPattern(pattern.id)}>
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
