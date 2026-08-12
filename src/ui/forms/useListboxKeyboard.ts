/**
 * src/ui/forms/useListboxKeyboard.ts — the shared keyboard core.
 *
 * ONE implementation of listbox navigation, consumed by Select, Combobox,
 * MultiSelect and PersonSearchSelect. Before this, the only selection control in
 * the kit (`PersonSearchSelect`) had no keyboard support at all and closed its
 * list on a 150ms blur timer.
 *
 * Implements the WAI-ARIA combobox/listbox pattern:
 *
 *   closed  ArrowDown / ArrowUp / Enter / Alt+ArrowDown  open the list
 *   open    ArrowDown / ArrowUp                          move the active option
 *           Home / End                                   first / last option
 *           Enter                                        commit the active option
 *           Escape                                       close, keep focus, no change
 *           Tab                                          close and let focus leave
 *           printable keys (typeahead mode)              jump to a matching option
 *
 * Disabled options are skipped in every direction, so a run of them can never
 * trap the cursor.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { type Option } from './options';

export interface ListboxKeyboard {
  open: boolean;
  setOpen: (open: boolean) => void;
  activeIndex: number;
  setActiveIndex: (i: number) => void;
  /** id of the active option, for `aria-activedescendant`. */
  activeId: string | undefined;
  optionId: (index: number) => string;
  onKeyDown: (e: KeyboardEvent) => void;
  /**
   * Ref CALLBACK for the scrolling list element, used to keep the active option
   * in view. A callback rather than a mutable ref object so consumers never
   * assign to it during render.
   */
  setListEl: (el: HTMLElement | null) => void;
}

interface Params<T extends string> {
  options: readonly Option<T>[];
  /** Called when the user commits an option (Enter, or click). */
  onCommit: (option: Option<T>) => void;
  /** Currently selected value — the list opens focused on it. */
  value?: T | '';
  /** Enable letter-key jump-to-option. Off for Combobox, where typing filters. */
  typeahead?: boolean;
  disabled?: boolean;
  /** Unique prefix for generated option ids. */
  idPrefix: string;
  /** Notified when the list closes, so the trigger can restore focus. */
  onClose?: () => void;
}

/** Next selectable index in `dir`, skipping disabled entries. Returns -1 if none. */
function step<T extends string>(options: readonly Option<T>[], from: number, dir: 1 | -1): number {
  const n = options.length;
  if (n === 0) return -1;
  for (let i = 1; i <= n; i++) {
    // Wrap, so ArrowDown on the last option returns to the first — a long list
    // otherwise dead-ends and the user has to reach for the mouse.
    const idx = (((from + dir * i) % n) + n) % n;
    if (!options[idx]?.disabled) return idx;
  }
  return -1;
}

/** First selectable index scanning from `start` inclusive. */
function firstEnabled<T extends string>(options: readonly Option<T>[], start = 0, dir: 1 | -1 = 1): number {
  for (let i = start; i >= 0 && i < options.length; i += dir) {
    if (!options[i]?.disabled) return i;
  }
  return -1;
}

export function useListboxKeyboard<T extends string>({
  options, onCommit, value = '', typeahead = false, disabled = false, idPrefix, onClose,
}: Params<T>): ListboxKeyboard {
  const [open, setOpenRaw] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [listEl, setListEl] = useState<HTMLElement | null>(null);
  const typeBuffer = useRef({ text: '', at: 0 });

  const selectedIndex = useMemo(
    () => (value ? options.findIndex(o => o.value === value) : -1),
    [options, value],
  );

  const setOpen = useCallback((next: boolean) => {
    setOpenRaw(prev => {
      if (prev === next) return prev;
      if (!next) onClose?.();
      return next;
    });
  }, [onClose]);

  // Opening lands on the selected option, or the first selectable one. Starting
  // at -1 would make the first ArrowDown a no-op that the user has to press twice.
  useEffect(() => {
    if (!open) { setActiveIndex(-1); return; }
    setActiveIndex(selectedIndex >= 0 && !options[selectedIndex]?.disabled
      ? selectedIndex
      : firstEnabled(options));
  }, [open]);

  // The active option must stay visible when the cursor moves by keyboard —
  // otherwise navigating a long list scrolls nothing and the user is blind.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const list = listEl;
    const el = list?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    if (!list || !el) return;
    const above = el.offsetTop < list.scrollTop;
    const below = el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight;
    // eslint-disable-next-line react-hooks/immutability -- scrolling a DOM node is the effect's whole purpose; nothing React owns is mutated
    if (above) list.scrollTop = el.offsetTop;
    // eslint-disable-next-line react-hooks/immutability -- as above
    else if (below) list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight;
  }, [activeIndex, open, listEl]);

  // Filtering can shrink the list out from under the cursor.
  useEffect(() => {
    if (open && activeIndex >= options.length) setActiveIndex(firstEnabled(options));
  }, [options.length]);

  const optionId = useCallback((index: number) => `${idPrefix}-opt-${index}`, [idPrefix]);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (disabled) return;

    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || (e.altKey && e.key === 'ArrowDown')) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex(i => step(options, i < 0 ? -1 : i, 1));
        return;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex(i => step(options, i < 0 ? 0 : i, -1));
        return;
      case 'Home':
        e.preventDefault();
        setActiveIndex(firstEnabled(options, 0, 1));
        return;
      case 'End':
        e.preventDefault();
        setActiveIndex(firstEnabled(options, options.length - 1, -1));
        return;
      case 'Enter': {
        const opt = activeIndex >= 0 ? options[activeIndex] : undefined;
        if (opt && !opt.disabled) {
          // Prevent the Enter from also submitting the surrounding form — the
          // user meant "choose this option", not "save the record".
          e.preventDefault();
          onCommit(opt);
          setOpen(false);
        }
        return;
      }
      case 'Escape':
        // stopPropagation so an Escape that closes a dropdown does not also
        // close the dialog the dropdown is sitting in.
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        return;
      case 'Tab':
        setOpen(false);
        return;
      default:
        break;
    }

    if (!typeahead) return;
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;

    // Buffer keystrokes for a second so "ma" finds "Marketing", not "Admin".
    const now = e.timeStamp || 0;
    const buf = typeBuffer.current;
    /* eslint-disable react-hooks/immutability -- a typeahead buffer is exactly what a ref is for: it must survive renders and must NOT cause one */
    buf.text = now - buf.at < 1000 ? buf.text + e.key : e.key;
    buf.at = now;
    /* eslint-enable react-hooks/immutability */

    const q = buf.text.toLowerCase();
    const found = options.findIndex(o => !o.disabled && o.label.toLowerCase().startsWith(q));
    if (found >= 0) { e.preventDefault(); setActiveIndex(found); }
  }, [open, options, activeIndex, onCommit, typeahead, disabled, setOpen]);

  return {
    open,
    setOpen,
    activeIndex,
    setActiveIndex,
    activeId: open && activeIndex >= 0 ? optionId(activeIndex) : undefined,
    optionId,
    onKeyDown,
    setListEl,
  };
}
