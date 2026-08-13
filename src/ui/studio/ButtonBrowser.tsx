import { type VNode } from 'preact';
import {
  BUTTON_PATTERNS, COMPOUND_OF, defaultProps, findComponent,
  type ButtonPattern, type ComponentDef, type ComponentFamily,
} from '../registry';
import { LucideIcon } from '../LucideIcon';

export interface ButtonBrowserProps {
  family: ComponentFamily;
  selectedPattern?: ButtonPattern;
  onOpenComponent: (componentId: string) => void;
  onOpenPattern: (patternId: string) => void;
  onBack: () => void;
}

export function ButtonBrowser({ family, selectedPattern, onOpenComponent, onOpenPattern, onBack }: ButtonBrowserProps): VNode {
  const members = family.componentIds
    .map(findComponent)
    .filter((component): component is ComponentDef => component !== undefined);

  if (selectedPattern) {
    return (
      <div class="sds-button-pattern">
        <button type="button" class="sds-wb__back" onClick={() => onOpenPattern(family.id)}>← All buttons</button>
        <header class="sds-button-pattern__head">
          <div><span>{selectedPattern.badge}</span><h2>{selectedPattern.name}</h2><p>{selectedPattern.description}</p></div>
          <button type="button" onClick={() => onOpenComponent(selectedPattern.foundationComponentId)}>Edit Action Button foundation <LucideIcon name="ArrowRight" size={15} /></button>
        </header>
        <section class="sds-button-pattern__hero" aria-label={`${selectedPattern.name} preview`}>
          <div>{selectedPattern.preview()}</div>
          <aside><strong>How it is governed</strong><p>{selectedPattern.guidance}</p><span>Inherits the published Action Button recipe</span></aside>
        </section>
        <section class="sds-button-pattern__examples" aria-labelledby="pattern-examples-title">
          <header><h3 id="pattern-examples-title">Approved examples</h3><p>Use these patterns consistently; labels and actions still belong to the application.</p></header>
          <div>{selectedPattern.examples.map(example => <article key={example.id}><span>{example.label}</span><div>{example.render()}</div></article>)}</div>
        </section>
      </div>
    );
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
