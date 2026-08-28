import { type VNode } from 'preact';
import { COMPOUND_OF, findComponent, type ComponentDef, type ComponentFamily } from '../registry';
import { ComponentThumbnail } from './componentThumbnail';

export function FamilyBrowser({ family, onOpenComponent }: {
  family: ComponentFamily;
  onOpenComponent: (id: string) => void;
}): VNode {
  const members = family.componentIds.map(findComponent).filter((item): item is ComponentDef => item !== undefined);

  return (
    <div class="sds-button-browser">
      <header class="sds-button-browser__head">
        <span>Component family</span><h2>{family.name}</h2><p>{family.description}</p>
      </header>
      <section class="sds-button-browser__section" aria-labelledby={`${family.id}-components-title`}>
        <header><div><h3 id={`${family.id}-components-title`}>{family.name} components</h3><p>Choose the composition you need, then edit its live canonical preview.</p></div><span>{members.length} components</span></header>
        <div class="sds-button-browser__grid">
          {members.map(component => (
            <button type="button" class="sds-button-browser__card" key={component.id} onClick={() => onOpenComponent(component.id)}>
              <span class="sds-button-browser__badge">{COMPOUND_OF[component.id] ?? 'Canonical'}</span>
              <div class="sds-button-browser__specimen">
                <span class="sds-button-browser__canvas-label" aria-hidden="true">Component preview</span>
                <span class="sds-button-browser__canvas-control"><ComponentThumbnail kind={component.thumbnail} /></span>
              </div>
              <div class="sds-button-browser__copy"><strong>{component.name}</strong><p>{family.roles[component.id]}</p></div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
