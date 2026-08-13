import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import {
  BUTTON_PATTERNS, COMPOUND_OF, defaultProps, findComponent,
  type ButtonPattern, type ButtonPatternControl, type ButtonPatternValues,
  type ComponentDef, type ComponentFamily,
} from '../registry';
import { LucideIcon } from '../LucideIcon';
import { IconPicker, StudioColorControl } from './RecipeStyleEditor';

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
  if (control.type === 'text') {
    return <label class="sds-pattern-field" for={id}><span>{control.label}</span><input id={id} aria-label={control.label} value={String(value)}
      onInput={event => onChange(control.name, (event.target as HTMLInputElement).value)} />{control.help && <small>{control.help}</small>}</label>;
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
    <div class="sds-button-pattern">
      <button type="button" class="sds-wb__back" onClick={onBack}>← All buttons</button>
      <header class="sds-button-pattern__head">
        <div><span>{pattern.badge}</span><h2>{pattern.name}</h2><p>{pattern.description}</p></div>
        <button type="button" onClick={onEditFoundation}>Edit button appearance <LucideIcon name="ArrowRight" size={15} /></button>
      </header>
      <section class="sds-button-pattern__editor" aria-label={`${pattern.name} editor`}>
        <div class="sds-button-pattern__stage">
          <header><div><span>Live preview</span><strong>{pattern.name}</strong></div><small>Preview only</small></header>
          <div>{pattern.preview(values)}</div>
          <aside><strong>How it is governed</strong><p>{pattern.guidance}</p><span>Inherits the published Action Button recipe</span></aside>
        </div>
        <aside class="sds-button-pattern__settings" aria-label={`${pattern.name} settings`}>
          <header><div><span>Editing</span><strong>{pattern.name}</strong></div><button type="button" onClick={() => setValues({ ...pattern.defaults })}>Reset</button></header>
          <div>{pattern.controls.map(control => <PatternControl key={control.name} pattern={pattern} control={control} values={values} onChange={set} />)}</div>
          <footer><LucideIcon name="Link2" size={15} /><p><strong>Linked to Action Button</strong><span>Geometry, states and accessibility stay inherited. These preview choices are not published.</span></p></footer>
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
              <div class="sds-button-browser__specimen">{component.render?.(defaultProps(component), 'default')}</div>
              <div class="sds-button-browser__copy"><strong>{component.name}</strong><p>{family.roles[component.id]}</p><span>Open editor <LucideIcon name="ArrowRight" size={14} /></span></div>
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
              <div class="sds-button-browser__specimen">{pattern.preview()}</div>
              <div class="sds-button-browser__copy"><strong>{pattern.name}</strong><p>{pattern.role}</p><span>View pattern <LucideIcon name="ArrowRight" size={14} /></span></div>
            </button>
          ))}
        </div>
      </section>

      <footer class="sds-button-browser__guardrail"><LucideIcon name="ShieldCheck" size={18} /><div><strong>Need something new?</strong><p>Start from Action Button or request a named governed pattern. Do not add an unowned variant.</p></div></footer>
    </div>
  );
}
