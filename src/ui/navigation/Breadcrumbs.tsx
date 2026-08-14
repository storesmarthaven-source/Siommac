import { Fragment, type ComponentChildren, type VNode } from 'preact';
import { useId, useState } from 'preact/hooks';
import { LucideIcon } from '../LucideIcon';
import { Popover } from '../overlays/Popover';
import './Breadcrumbs.recipe.css';

export interface BreadcrumbItem {
  label: string;
  href?: string;
  onSelect?: () => void;
  icon?: VNode;
  /** Keep the accessible label while showing only the icon. */
  iconOnly?: boolean;
}

export interface BreadcrumbsProps {
  items: readonly BreadcrumbItem[];
  /** Includes the overflow trigger. Minimum 3; default 4. */
  maxVisible?: number;
  label?: string;
  separator?: ComponentChildren;
  class?: string;
}

function Crumb({ item, current, onSelect }: { item: BreadcrumbItem; current: boolean; onSelect?: () => void }): VNode {
  const copy = <>{item.icon}<span class={item.iconOnly ? 'ui-breadcrumbs__sr-only' : undefined}>{item.label}</span></>;
  if (current) return <span class="ui-breadcrumbs__current" aria-current="page">{copy}</span>;
  if (item.href) return <a class="ui-breadcrumbs__link" href={item.href} onClick={onSelect}>{copy}</a>;
  if (item.onSelect) return <button class="ui-breadcrumbs__link" type="button" onClick={() => { onSelect?.(); item.onSelect?.(); }}>{copy}</button>;
  return <span class="ui-breadcrumbs__label">{copy}</span>;
}

export function Breadcrumbs({ items, maxVisible = 4, label = 'Breadcrumb', separator = <LucideIcon name="ChevronRight" size={17} strokeWidth={2.25} />, class: extra }: BreadcrumbsProps): VNode | null {
  const uid = useId();
  const [overflowAnchor, setOverflowAnchor] = useState<HTMLElement | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  if (items.length === 0) return null;

  const limit = Math.max(3, maxVisible);
  const collapsed = items.length > limit;
  const tailCount = limit - 2;
  const hidden = collapsed ? items.slice(1, items.length - tailCount) : [];
  const visible = collapsed ? [items[0]!, ...items.slice(items.length - tailCount)] : [...items];

  return (
    <nav class={`ui-breadcrumbs${extra ? ` ${extra}` : ''}`} aria-label={label}>
      <ol class="ui-breadcrumbs__list">
        {visible.map((item, index) => {
          const actualIndex = collapsed && index > 0 ? items.length - tailCount + index - 1 : index;
          const current = actualIndex === items.length - 1;
          return (
            <Fragment key={`${actualIndex}-${item.label}`}>
              {collapsed && index === 1 && (
                <li class="ui-breadcrumbs__item" key={`${uid}-overflow`}>
                  <span class="ui-breadcrumbs__separator" aria-hidden="true">{separator}</span>
                  <button
                    type="button"
                    class="ui-breadcrumbs__overflow"
                    aria-label={`${hidden.length} hidden breadcrumb${hidden.length === 1 ? '' : 's'}`}
                    aria-haspopup="dialog"
                    aria-expanded={overflowOpen}
                    onClick={(e) => { setOverflowAnchor(e.currentTarget); setOverflowOpen(value => !value); }}
                  >
                    <LucideIcon name="Ellipsis" size={16} />
                  </button>
                  <Popover
                    open={overflowOpen}
                    anchor={overflowAnchor}
                    onClose={() => setOverflowOpen(false)}
                    label="Hidden breadcrumb ancestors"
                    class="ui-breadcrumbs__popover"
                  >
                    <ol class="ui-breadcrumbs__hidden-list">
                      {hidden.map(hiddenItem => (
                        <li key={hiddenItem.label}>
                          <Crumb item={hiddenItem} current={false} onSelect={() => setOverflowOpen(false)} />
                        </li>
                      ))}
                    </ol>
                  </Popover>
                </li>
              )}
              <li class="ui-breadcrumbs__item">
                {actualIndex > 0 && !(collapsed && index === 1) && <span class="ui-breadcrumbs__separator" aria-hidden="true">{separator}</span>}
                <Crumb item={item} current={current} />
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
