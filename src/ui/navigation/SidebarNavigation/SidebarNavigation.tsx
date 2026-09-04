import { type VNode } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { LucideIcon } from '../../LucideIcon';
import { Button } from '../../primitives/Button';
import { SearchInput } from '../../primitives/TextInput';
import { Popover } from '../../overlays/Popover';
import './sidebarNavigation.recipe.css';

export type SidebarNavigationDensity = 'compact' | 'comfortable';
export type SidebarNavigationNotificationTone = 'danger' | 'warning' | 'info' | 'neutral';

export interface SidebarNavigationNotification {
  /** Omit count and set dot for an attention indicator without a disclosed total. */
  count?: number;
  dot?: boolean;
  tone?: SidebarNavigationNotificationTone;
  /** Describes the indicator to assistive technology, for example “3 pending approvals”. */
  label: string;
  /** Change this value to replay the notification entrance animation. */
  revision?: string | number;
}

export interface SidebarNavigationItem {
  id: string;
  label: string;
  description?: string;
  icon?: VNode;
  notification?: SidebarNavigationNotification;
  children?: readonly SidebarNavigationItem[];
  /** A structural parent expands its children and is not itself a destination. */
  groupOnly?: boolean;
}

export interface SidebarNavigationGroup {
  id: string;
  label?: string;
  items: readonly SidebarNavigationItem[];
}

export interface SidebarNavigationContext {
  label: string;
  backLabel?: string;
  onBack: () => void;
}

export interface SidebarNavigationProps {
  groups: readonly SidebarNavigationGroup[];
  activeId?: string;
  label?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  density?: SidebarNavigationDensity;
  showChildIcons?: boolean;
  /** Render the desktop sidebar as an icon rail. Parents open a nested-destination flyout. */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  defaultExpandedGroupIds?: readonly string[];
  defaultExpandedItemIds?: readonly string[];
  expandedGroupIds?: readonly string[];
  expandedItemIds?: readonly string[];
  onExpandedGroupsChange?: (ids: string[]) => void;
  onExpandedItemsChange?: (ids: string[]) => void;
  onNavigate?: (id: string) => void;
  onCustomize?: () => void;
  context?: SidebarNavigationContext;
  /** Optional host integration attribute. Set null when navigation is callback-only. */
  destinationAttribute?: string | null;
  class?: string;
}

function includesItem(item: SidebarNavigationItem, query: string): boolean {
  if (!query) return true;
  if (`${item.label} ${item.description ?? ''}`.toLocaleLowerCase().includes(query)) return true;
  return item.children?.some(child => includesItem(child, query)) ?? false;
}

function toggleSet(current: readonly string[], id: string): string[] {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return [...next];
}

function displayNotificationCount(count: number | undefined): string {
  if (count === undefined) return '';
  return count > 99 ? '99+' : String(Math.max(0, Math.floor(count)));
}

function NotificationIndicator({ notification }: { notification?: SidebarNavigationNotification }): VNode | null {
  if (!notification || (!notification.dot && (notification.count ?? 0) <= 0)) return null;
  return (
    <span
      key={notification.revision}
      class={`ui-sidebar-nav__notification ui-sidebar-nav__notification--${notification.tone ?? 'danger'}${notification.dot ? ' is-dot' : ''}`}
      role="status"
      aria-label={notification.label}
    >
      <span aria-hidden="true">{notification.dot ? '' : displayNotificationCount(notification.count)}</span>
    </span>
  );
}

function NavigationItem({
  item,
  activeId,
  child,
  collapsed,
  expanded,
  showChildIcons,
  openFlyoutId,
  onFlyoutChange,
  onToggle,
  onNavigate,
  destinationAttribute,
}: {
  item: SidebarNavigationItem;
  activeId?: string;
  child?: boolean;
  collapsed: boolean;
  expanded: boolean;
  showChildIcons: boolean;
  openFlyoutId: string | null;
  onFlyoutChange: (id: string | null) => void;
  onToggle: (id: string) => void;
  onNavigate?: (id: string) => void;
  destinationAttribute: string | null;
}): VNode {
  const hasChildren = Boolean(item.children?.length);
  const active = item.id === activeId;
  const descendantActive = item.children?.some(entry => entry.id === activeId) ?? false;
  const [flyoutAnchor, setFlyoutAnchor] = useState<HTMLButtonElement | null>(null);
  const flyoutOpen = openFlyoutId === item.id && Boolean(flyoutAnchor);

  useEffect(() => {
    if (!collapsed || openFlyoutId !== item.id) setFlyoutAnchor(null);
  }, [collapsed, item.id, openFlyoutId]);

  const closeFlyout = (): void => {
    setFlyoutAnchor(null);
    if (openFlyoutId === item.id) onFlyoutChange(null);
  };

  const mainAttrs = collapsed && hasChildren && !child
    ? {
        onClick: (event: MouseEvent) => {
          if (flyoutOpen) closeFlyout();
          else {
            setFlyoutAnchor(event.currentTarget as HTMLButtonElement);
            onFlyoutChange(item.id);
          }
        },
        'aria-expanded': flyoutOpen,
        'aria-haspopup': 'dialog' as const,
      }
    : item.groupOnly
    ? { onClick: () => onToggle(item.id), 'aria-expanded': expanded }
    : {
        onClick: () => onNavigate?.(item.id),
        'aria-current': active ? 'page' as const : undefined,
        ...(destinationAttribute ? { [destinationAttribute]: item.id } : {}),
      };

  return (
    <li class={`ui-sidebar-nav__item${child ? ' ui-sidebar-nav__item--child' : ''}${hasChildren ? ' ui-sidebar-nav__item--parent' : ''}${expanded ? ' is-open' : ''}`}>
      <div class="ui-sidebar-nav__item-row">
        <button
          type="button"
          class={`ui-sidebar-nav__link${active || descendantActive ? ' is-active active' : ''}`}
          title={item.label}
          {...mainAttrs}
        >
          {item.icon && (!child || showChildIcons) && <span class="ui-sidebar-nav__icon">{item.icon}</span>}
          <span class="ui-sidebar-nav__label">{item.label}</span>
          <NotificationIndicator notification={item.notification} />
          {collapsed && hasChildren && !child && (
            <span class="ui-sidebar-nav__submenu-indicator" aria-hidden="true">
              <LucideIcon name="ChevronRight" size={10} />
            </span>
          )}
        </button>
        {hasChildren && !item.groupOnly && !collapsed && (
          <button
            type="button"
            class="ui-sidebar-nav__item-toggle"
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${item.label}`}
            aria-expanded={expanded}
            onClick={() => onToggle(item.id)}
          >
            <LucideIcon name="ChevronDown" size={15} />
          </button>
        )}
      </div>
      {hasChildren && (
        <div class="ui-sidebar-nav__reveal" data-expanded={expanded ? 'true' : 'false'}>
          <ul class="ui-sidebar-nav__children">
            {item.children!.map(childItem => (
              <NavigationItem
                key={childItem.id}
                item={childItem}
                activeId={activeId}
                child
                collapsed={collapsed}
                expanded={false}
                showChildIcons={showChildIcons}
                openFlyoutId={openFlyoutId}
                onFlyoutChange={onFlyoutChange}
                onToggle={onToggle}
                onNavigate={onNavigate}
                destinationAttribute={destinationAttribute}
              />
            ))}
          </ul>
        </div>
      )}
      {hasChildren && !child && (
        <Popover
          open={flyoutOpen}
          anchor={flyoutAnchor}
          onClose={closeFlyout}
          label={`${item.label} Navigation`}
          class="ui-sidebar-nav-flyout"
          placement="right"
          align="start"
          offset={10}
          maxHeight={420}
        >
          <header class="ui-sidebar-nav-flyout__head">
            {item.icon && <span>{item.icon}</span>}
            <div><strong>{item.label}</strong><small>{item.children!.length} {item.children!.length === 1 ? 'Section' : 'Sections'}</small></div>
            <Button class="ui-sidebar-nav-flyout__close" variant="ghost" size="sm" iconOnly aria-label={`Close ${item.label} Navigation`} onClick={closeFlyout} iconLeft={<LucideIcon name="X" />} />
          </header>
          <div class="ui-sidebar-nav-flyout__list">
            {!item.groupOnly && (
              <button
                type="button"
                class={`ui-sidebar-nav-flyout__item${active ? ' is-active' : ''}`}
                onClick={() => { onNavigate?.(item.id); closeFlyout(); }}
                {...(destinationAttribute ? { [destinationAttribute]: item.id } : {})}
              >
                {item.icon && <span class="ui-sidebar-nav-flyout__icon">{item.icon}</span>}
                <span class="ui-sidebar-nav-flyout__copy"><strong>Open {item.label}</strong><small>{item.description ?? 'Open the main destination'}</small></span>
                <span class="ui-sidebar-nav-flyout__trailing"><NotificationIndicator notification={item.notification} /><LucideIcon name="ChevronRight" size={12} /></span>
              </button>
            )}
            {item.children!.map(childItem => (
              <button
                key={childItem.id}
                type="button"
                class={`ui-sidebar-nav-flyout__item${childItem.id === activeId ? ' is-active' : ''}`}
                aria-current={childItem.id === activeId ? 'page' : undefined}
                onClick={() => { onNavigate?.(childItem.id); closeFlyout(); }}
                {...(destinationAttribute ? { [destinationAttribute]: childItem.id } : {})}
              >
                {childItem.icon && <span class="ui-sidebar-nav-flyout__icon">{childItem.icon}</span>}
                <span class="ui-sidebar-nav-flyout__copy"><strong>{childItem.label}</strong>{childItem.description && <small>{childItem.description}</small>}</span>
                <span class="ui-sidebar-nav-flyout__trailing"><NotificationIndicator notification={childItem.notification} /><LucideIcon name="ChevronRight" size={12} /></span>
              </button>
            ))}
          </div>
        </Popover>
      )}
    </li>
  );
}

export function SidebarNavigation({
  groups,
  activeId,
  label = 'Primary navigation',
  searchable = true,
  searchPlaceholder = 'Search navigation',
  density = 'comfortable',
  showChildIcons = false,
  collapsed = false,
  onCollapsedChange,
  defaultExpandedGroupIds = groups.map(group => group.id),
  defaultExpandedItemIds = groups.flatMap(group => group.items.filter(item => item.children?.length).map(item => item.id)),
  expandedGroupIds,
  expandedItemIds,
  onExpandedGroupsChange,
  onExpandedItemsChange,
  onNavigate,
  onCustomize,
  context,
  destinationAttribute = 'data-section',
  class: extra,
}: SidebarNavigationProps): VNode {
  const [query, setQuery] = useState('');
  const [ownExpandedGroups, setOwnExpandedGroups] = useState<string[]>([...defaultExpandedGroupIds]);
  const [ownExpandedItems, setOwnExpandedItems] = useState<string[]>([...defaultExpandedItemIds]);
  const [openFlyoutId, setOpenFlyoutId] = useState<string | null>(null);
  const groupState = expandedGroupIds ?? ownExpandedGroups;
  const itemState = expandedItemIds ?? ownExpandedItems;
  const normalizedQuery = query.trim().toLocaleLowerCase();

  useEffect(() => {
    if (!collapsed) setOpenFlyoutId(null);
  }, [collapsed]);

  const visibleGroups = useMemo(() => groups.map(group => ({
    ...group,
    items: group.items
      .filter(item => includesItem(item, normalizedQuery))
      .map(item => normalizedQuery && item.children
        ? { ...item, children: item.children.filter(child => includesItem(child, normalizedQuery)) }
        : item),
  })).filter(group => group.items.length), [groups, normalizedQuery]);

  function updateGroups(id: string): void {
    const next = toggleSet(groupState, id);
    if (expandedGroupIds === undefined) setOwnExpandedGroups(next);
    onExpandedGroupsChange?.(next);
  }

  function updateItems(id: string): void {
    const next = toggleSet(itemState, id);
    if (expandedItemIds === undefined) setOwnExpandedItems(next);
    onExpandedItemsChange?.(next);
  }

  return (
    <nav class={`ui-sidebar-nav ui-sidebar-nav--${density}${collapsed ? ' ui-sidebar-nav--collapsed' : ''}${extra ? ` ${extra}` : ''}`} aria-label={label}>
      {context && (
        <div class="ui-sidebar-nav__context">
          <button type="button" class="ui-sidebar-nav__context-back" onClick={context.onBack} aria-label={context.backLabel ?? 'Back'} title={context.backLabel ?? 'Back'}>
            <LucideIcon name="ArrowLeft" size={17} />
          </button>
          <span>{context.label}</span>
        </div>
      )}
      {searchable && !collapsed && (
        <div class="ui-sidebar-nav__search">
          <SearchInput
            value={query}
            onInput={setQuery}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            size="sm"
            clearable
          />
          {onCustomize && (
            <button type="button" class="ui-sidebar-nav__customize" onClick={onCustomize} aria-label="Customize Navigation" title="Customize Navigation">
              <LucideIcon name="Settings2" size={16} />
            </button>
          )}
          {onCollapsedChange && (
            <button type="button" class="ui-sidebar-nav__collapse" onClick={() => onCollapsedChange(true)} aria-label="Collapse Navigation" title="Collapse Navigation">
              <LucideIcon name="PanelLeftClose" size={16} />
            </button>
          )}
        </div>
      )}
      {collapsed && onCollapsedChange && (
        <div class="ui-sidebar-nav__collapsed-tools">
          <button type="button" class="ui-sidebar-nav__collapse" onClick={() => onCollapsedChange(false)} aria-label="Expand Navigation" title="Expand Navigation">
            <LucideIcon name="PanelLeftOpen" size={17} />
          </button>
        </div>
      )}
      <ul class="ui-sidebar-nav__groups">
        {visibleGroups.map(group => {
          const open = normalizedQuery ? true : groupState.includes(group.id);
          return (
            <li class={`ui-sidebar-nav__group${group.label ? '' : ' ui-sidebar-nav__group--flat'}`} key={group.id}>
              {group.label && (
                <div class="ui-sidebar-nav__group-head">
                  <button
                    type="button"
                    class="ui-sidebar-nav__group-toggle"
                    onClick={() => updateGroups(group.id)}
                    aria-expanded={open}
                  >
                    <span>{group.label}</span>
                    <span class="ui-sidebar-nav__count">{group.items.length}</span>
                    <LucideIcon name="ChevronDown" size={14} />
                  </button>
                </div>
              )}
              <div class="ui-sidebar-nav__reveal" data-expanded={open ? 'true' : 'false'}>
                <ul class="ui-sidebar-nav__items">
                  {group.items.map(item => (
                    <NavigationItem
                      key={item.id}
                      item={item}
                      activeId={activeId}
                      collapsed={collapsed}
                      expanded={normalizedQuery ? true : itemState.includes(item.id)}
                      showChildIcons={showChildIcons}
                      openFlyoutId={openFlyoutId}
                      onFlyoutChange={setOpenFlyoutId}
                      onToggle={updateItems}
                      onNavigate={onNavigate}
                      destinationAttribute={destinationAttribute}
                    />
                  ))}
                </ul>
              </div>
            </li>
          );
        })}
      </ul>
      {visibleGroups.length === 0 && <p class="ui-sidebar-nav__empty">No navigation items match “{query}”.</p>}
    </nav>
  );
}
