import { type ComponentChildren, type VNode } from 'preact';
import { useId, useState } from 'preact/hooks';
import { LucideIcon } from '../LucideIcon';
import './Accordion.recipe.css';

export interface AccordionItem {
  id: string;
  title: string;
  content: ComponentChildren;
  description?: string;
  icon?: VNode;
  disabled?: boolean;
}

export interface AccordionProps {
  items: readonly AccordionItem[];
  multiple?: boolean;
  expanded?: readonly string[];
  defaultExpanded?: readonly string[];
  onChange?: (expanded: readonly string[]) => void;
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  keepMounted?: boolean;
  class?: string;
}

export function Accordion({
  items, multiple = false, expanded, defaultExpanded = [], onChange,
  headingLevel = 3, keepMounted = false, class: extra,
}: AccordionProps): VNode {
  const uid = useId();
  const [internal, setInternal] = useState<readonly string[]>(() => multiple ? defaultExpanded : defaultExpanded.slice(0, 1));
  const openIds = expanded ?? internal;
  const Heading = `h${headingLevel}` as keyof preact.JSX.IntrinsicElements;

  function toggle(id: string): void {
    const isOpen = openIds.includes(id);
    const next = isOpen ? openIds.filter(value => value !== id) : multiple ? [...openIds, id] : [id];
    if (expanded === undefined) setInternal(next);
    onChange?.(next);
  }

  return (
    <div class={`ui-accordion${extra ? ` ${extra}` : ''}`}>
      {items.map(item => {
        const open = openIds.includes(item.id);
        const triggerId = `${uid}-${item.id}-trigger`;
        const panelId = `${uid}-${item.id}-panel`;
        return (
          <section class="ui-accordion__item" data-open={open ? 'true' : undefined} key={item.id}>
            <Heading class="ui-accordion__heading">
              <button
                id={triggerId}
                class="ui-accordion__trigger"
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                disabled={item.disabled}
                onClick={() => toggle(item.id)}
              >
                {item.icon && <span class="ui-accordion__icon" aria-hidden="true">{item.icon}</span>}
                <span class="ui-accordion__copy">
                  <span class="ui-accordion__title">{item.title}</span>
                  {item.description && <span class="ui-accordion__description">{item.description}</span>}
                </span>
                <LucideIcon name="ChevronDown" class="ui-accordion__chevron" />
              </button>
            </Heading>
            {(open || keepMounted) && (
              <div id={panelId} class="ui-accordion__panel" role="region" aria-labelledby={triggerId} hidden={!open}>
                <div class="ui-accordion__content">{item.content}</div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

