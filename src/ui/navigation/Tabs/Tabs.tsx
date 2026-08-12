/**
 * src/ui/navigation/Tabs/Tabs.tsx — the ONE tab component.
 *
 * Five overlapping APIs existed: `Tabs` (`.inv-tab-btn`, drawer tabs),
 * `ModuleTabs`/`AreaTabs` (`.hse-tabs-*`, header card + bar), `TabBar` (the bare
 * `.hse-tabs-bar`), `PanelTabs` (`.ui-panel-tab*` with a "More" overflow) and a
 * per-page handful of hand-rolled `role="tablist"` divs. Between them they
 * disagreed on prop names (`tabs`/`items`, `active`/`value`, `onChange`/`onSelect`),
 * on whether a tab had an icon, a sublabel or a count, and — the part that
 * actually hurt users — on the keyboard model. Three of the five had NO keyboard
 * model at all: they were plain buttons in a row, so a screen-reader user got a
 * list of unrelated buttons instead of a tablist, and Tab walked through every
 * single tab instead of jumping past the set.
 *
 * Orientation, appearance, size, counts, icons and overflow are CONFIGURATION.
 * `VerticalTabs` is `orientation="vertical"`; a contained pill bar is
 * `variant="contained"`; a "More" menu is `maxVisible`. None of them is a
 * component (RECIPES.md §7).
 *
 * ── The accessibility contract, owned here ──────────────────────────────────
 *   role="tablist" / role="tab" / role="tabpanel"   `TabPanel` renders the panel
 *   aria-selected, aria-controls, aria-labelledby   wired from the required `id`
 *   roving tabindex                                 exactly ONE tab stop for the set
 *   ← → (horizontal) · ↑ ↓ (vertical)               move, skipping disabled, wrapping
 *   Home / End                                      first / last enabled tab
 *   Enter / Space                                   select, in manual-activation mode
 *
 * `TabPanel` is not optional decoration. `aria-controls` on every tab points at
 * the panel `TabPanel` renders; swapping content with a bare conditional leaves
 * those references dangling, which is worse than having none.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { useCallback, useMemo, useRef, useState } from 'preact/hooks';
import { DropdownMenu } from '../../overlays/DropdownMenu';
import { LucideIcon } from '../../LucideIcon';
import { type UiState } from '../../tokens';
import './tabs.recipe.css';

export type TabsOrientation = 'horizontal' | 'vertical';
export type TabsVariant = 'underline' | 'contained' | 'subtle';
export type TabsSize = 'sm' | 'md' | 'lg';
/**
 * `automatic` selects as focus moves — the WAI-ARIA default, right when panels
 * are cheap. `manual` moves focus only and waits for Enter/Space, which is what
 * a panel that fires a network request needs.
 */
export type TabsActivation = 'automatic' | 'manual';

export interface TabItem {
  id: string;
  label: string;
  /** A NODE, not a FontAwesome class string — the kit sizes icons from `--ui-icon-*`. */
  icon?: ComponentChildren;
  /** One supporting line under the label. `ModuleTabs`' `sublabel`. */
  description?: string;
  /**
   * A count or short status. `0` renders — "0 open" is information, and hiding
   * it is why several pages silently showed nothing where a zero belonged.
   * Use `undefined` for "no badge".
   */
  badge?: number | string;
  disabled?: boolean;
  /** Why it is disabled. Rendered as the tab's title so the reason is reachable. */
  disabledReason?: string;
}

export interface TabsProps {
  /**
   * Base id for the set. REQUIRED: every tab's `aria-controls` and every panel's
   * `aria-labelledby` are derived from it, so the relationship cannot be
   * half-wired. Must be unique on the page.
   */
  id: string;
  items: readonly TabItem[];
  value: string;
  onChange: (id: string) => void;

  orientation?: TabsOrientation;
  variant?: TabsVariant;
  size?: TabsSize;
  activation?: TabsActivation;

  /** Accessible name for the set, e.g. "Employee record sections". */
  label: string;

  /**
   * Collapse everything after the first N tabs into a "More" menu, which shows
   * the active tab's label when the active tab is one of the hidden ones. This
   * is `PanelTabs`' primary/`more` split, expressed as a number instead of two
   * arrays — and it is deterministic, unlike width measurement.
   */
  maxVisible?: number;
  /** Right-aligned content in the bar (a filter, a count, an action). */
  actions?: ComponentChildren;
  /** Forced visual state — Gallery preview only (RECIPES.md §5). Never in app code. */
  forceState?: UiState;
  class?: string;
}

export const tabDomId = (id: string, tabId: string): string => `${id}-tab-${tabId}`;
export const panelDomId = (id: string, tabId: string): string => `${id}-panel-${tabId}`;

export function Tabs({
  id, items, value, onChange, label,
  orientation = 'horizontal', variant = 'underline', size = 'md',
  activation = 'automatic', maxVisible, actions, forceState, class: extra,
}: TabsProps): VNode {
  /**
   * Tab elements by id, for moving focus.
   *
   * A ref map rather than a `#id` query: tab ids come from application data and
   * may contain characters a CSS selector must escape, and `CSS.escape` is not
   * universally present (jsdom does not ship it). Looking the element up by
   * identity has neither problem.
   */
  const tabRefs = useRef<Map<string, HTMLElement>>(new Map());
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const { visible, overflow } = useMemo(() => {
    if (maxVisible === undefined || maxVisible >= items.length) {
      return { visible: items, overflow: [] as readonly TabItem[] };
    }
    return { visible: items.slice(0, maxVisible), overflow: items.slice(maxVisible) };
  }, [items, maxVisible]);

  const activeInOverflow = overflow.some(t => t.id === value);

  /**
   * Which tab holds the set's single tab stop.
   *
   * Normally the selected one — but the selected tab can be COLLAPSED into the
   * More menu, and then no visible tab is selected. Without this fallback the
   * whole tablist drops out of the tab order and a keyboard user cannot reach
   * the tabs at all, only the More trigger. Falls back to the first enabled
   * visible tab, which is what the roving-tabindex pattern specifies.
   */
  const tabStopId = visible.some(t => t.id === value && !t.disabled)
    ? value
    : visible.find(t => !t.disabled)?.id;

  /**
   * Arrow navigation walks the VISIBLE tabs only. The overflow menu has its own
   * keyboard model (DropdownMenu's), and pretending hidden items are part of
   * this roving group would move focus to an element that is not on screen.
   */
  const focusTab = useCallback((tabId: string): void => {
    tabRefs.current.get(tabId)?.focus();
  }, []);

  const step = useCallback((from: number, dir: 1 | -1): TabItem | undefined => {
    const n = visible.length;
    for (let i = 1; i <= n; i++) {
      const item = visible[(((from + dir * i) % n) + n) % n];
      if (item && !item.disabled) return item;
    }
    return undefined;
  }, [visible]);

  const edge = useCallback((dir: 1 | -1): TabItem | undefined => (
    dir === 1
      ? visible.find(t => !t.disabled)
      : [...visible].reverse().find(t => !t.disabled)
  ), [visible]);

  const onKeyDown = (event: KeyboardEvent, index: number): void => {
    const prevKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
    const nextKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';

    let target: TabItem | undefined;
    if (event.key === nextKey) target = step(index, 1);
    else if (event.key === prevKey) target = step(index, -1);
    else if (event.key === 'Home') target = edge(1);
    else if (event.key === 'End') target = edge(-1);
    else if (event.key === 'Enter' || event.key === ' ') {
      // Only meaningful under manual activation; under automatic the tab is
      // already selected, and a native <button> would fire onClick anyway.
      const current = visible[index];
      if (activation === 'manual' && current && !current.disabled) {
        event.preventDefault();
        onChange(current.id);
      }
      return;
    } else return;

    event.preventDefault();
    if (!target) return;
    focusTab(target.id);
    if (activation === 'automatic') onChange(target.id);
  };

  const cls = [
    'ui-tabs',
    `ui-tabs--${variant}`,
    `ui-tabs--${orientation}`,
    size !== 'md' ? `ui-tabs--${size}` : '',
    extra ?? '',
  ].filter(Boolean).join(' ');

  const renderTab = (item: TabItem, index: number): VNode => {
    const selected = item.id === value;
    /**
     * The accessible name is built explicitly when a tab carries a description
     * or a badge. Left to the DOM, adjacent inline spans concatenate with no
     * separator and a screen reader announces "Tasks4" — the count reads as
     * part of the word. It still STARTS with the visible label, so voice
     * control ("click Tasks") keeps working (WCAG 2.5.3).
     */
    const parts = [item.label, item.description, item.badge === undefined ? undefined : String(item.badge)]
      .filter((p): p is string => p !== undefined && p !== '');
    const a11yName = parts.join(', ');
    return (
      <button
        key={item.id}
        id={tabDomId(id, item.id)}
        type="button"
        role="tab"
        class={`ui-tab${selected ? ' is-selected' : ''}`}
        aria-selected={selected}
        aria-label={a11yName === item.label ? undefined : a11yName}
        aria-controls={panelDomId(id, item.id)}
        aria-disabled={item.disabled ? 'true' : undefined}
        title={item.disabled ? item.disabledReason : undefined}
        /* Roving tabindex: the SET is one tab stop (see `tabStopId`). A disabled
           tab stays in the DOM and keeps aria-disabled — removing it from the
           list would change the tab count a screen reader announces. */
        tabIndex={item.id === tabStopId ? 0 : -1}
        ref={el => { if (el) tabRefs.current.set(item.id, el); else tabRefs.current.delete(item.id); }}
        disabled={item.disabled}
        onClick={() => { if (!item.disabled) onChange(item.id); }}
        onKeyDown={e => onKeyDown(e, index)}
      >
        {item.icon != null && <span class="ui-tab-icon" aria-hidden="true">{item.icon}</span>}
        <span class="ui-tab-text">
          <span class="ui-tab-label">{item.label}</span>
          {item.description !== undefined && <span class="ui-tab-desc">{item.description}</span>}
        </span>
        {item.badge !== undefined && <span class="ui-tab-badge">{item.badge}</span>}
      </button>
    );
  };

  return (
    <div class={cls} data-ui-state={forceState}>
      <div
        class="ui-tabs-list"
        role="tablist"
        aria-label={label}
        aria-orientation={orientation}
      >
        {visible.map(renderTab)}

        {overflow.length > 0 && (
          <>
            <button
              type="button"
              /* NOT role="tab": it opens a menu, it does not select a panel.
                 Labelling a menu trigger as a tab is how a screen reader ends
                 up announcing "selected" for something that selects nothing. */
              class={`ui-tab ui-tab--more${activeInOverflow ? ' is-selected' : ''}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              ref={setMenuAnchor}
              onClick={() => setMenuOpen(o => !o)}
            >
              <span class="ui-tab-text">
                <span class="ui-tab-label">
                  {activeInOverflow ? overflow.find(t => t.id === value)?.label : 'More'}
                </span>
              </span>
              <LucideIcon name="ChevronDown" size={13} />
            </button>
            <DropdownMenu
              open={menuOpen}
              anchor={menuAnchor}
              onClose={() => setMenuOpen(false)}
              label={`${label} — more`}
              items={overflow.map(t => ({
                id: t.id,
                label: t.label,
                disabled: t.disabled,
                onSelect: () => { onChange(t.id); setMenuOpen(false); },
              }))}
            />
          </>
        )}
      </div>

      {actions != null && <div class="ui-tabs-actions">{actions}</div>}
    </div>
  );
}

export interface TabPanelProps {
  /** The `id` given to the `Tabs` this panel belongs to. */
  tabsId: string;
  /** The `TabItem.id` this panel is the content for. */
  tabId: string;
  /** The currently selected tab. The panel renders only when it matches. */
  value: string;
  children: ComponentChildren;
  class?: string;
}

/**
 * The panel half of the contract.
 *
 * It is `tabIndex={0}` because a panel whose content has no focusable element
 * would otherwise be unreachable by keyboard — you could select the tab and
 * never get to what it revealed.
 *
 * It unmounts when not selected rather than hiding: SIOMAC panels hold live
 * queries and tables, and keeping seven of them mounted behind `display:none`
 * is how a "tab switch" ends up firing seven requests.
 */
export function TabPanel({ tabsId, tabId, value, children, class: extra }: TabPanelProps): VNode | null {
  if (value !== tabId) return null;
  return (
    <div
      id={panelDomId(tabsId, tabId)}
      role="tabpanel"
      aria-labelledby={tabDomId(tabsId, tabId)}
      tabIndex={0}
      class={`ui-tab-panel${extra ? ` ${extra}` : ''}`}
    >
      {children}
    </div>
  );
}
