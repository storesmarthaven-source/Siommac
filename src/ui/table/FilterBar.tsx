// src/ui/table/FilterBar.tsx — the SHARED table filter toolbar, lifted from Employee
// Master into reusable components: a search box, multi-select basic-filter dropdowns, a
// generic config-driven advanced-filter panel, and an active-filter chip bar. One
// source of truth for every register/table in the app. See filterBar.css.
import type { VNode, ComponentChildren } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { LucideIcon } from '../LucideIcon';
import './filterBar.css';

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter(x => x !== v) : [...list, v];
}

/** Marks the root element that owns an open dropdown. A click landing inside the root whose
 *  value equals the open id is an INSIDE click and must not close the panel. */
export const FILTER_DROPDOWN_ATTR = 'data-filter-dropdown';

/** Manage which single dropdown is open (one at a time), closing on outside-click / Escape.
 *
 *  Closing is containment-based: the document listener walks up from the click target and
 *  only closes when the click landed outside the open dropdown's root. The previous contract
 *  was the inverse — close on ANY document click unless a descendant called stopPropagation()
 *  — which meant a single un-stopped click inside a panel (a group header, the panel padding,
 *  a checkbox row) closed it mid-selection. */
export function useFilterDropdowns(): { openId: string | null; setOpenId: (v: string | null) => void } {
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    if (openId == null) return;
    const close = (e: MouseEvent): void => {
      const target = e.target instanceof Element ? e.target : null;
      // A click inside ANY dropdown root is that root's business: inside the open panel it must
      // not close, and on another trigger the trigger's own handler already sets the new openId
      // (this listener runs afterwards, so closing here would immediately undo it).
      if (target?.closest(`[${FILTER_DROPDOWN_ATTR}]`)) return;
      setOpenId(null);
    };
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpenId(null); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', onKey); };
  }, [openId]);
  return { openId, setOpenId };
}

// ── Search ──────────────────────────────────────────────────────────────────
export function TableSearch(
  { value, onChange, placeholder, ariaLabel }:
  { value: string; onChange: (v: string) => void; placeholder?: string; ariaLabel?: string },
): VNode {
  return (
    <div class={`tf-search ${value ? 'has-value' : ''}`}>
      <span class="tf-magnify" aria-hidden="true"><LucideIcon name="Search" size={16} strokeWidth={2} /></span>
      <input
        type="search" value={value} placeholder={placeholder ?? 'Search…'}
        aria-label={ariaLabel ?? placeholder ?? 'Search'}
        onInput={e => onChange((e.currentTarget).value)}
      />
      {/* Visible affordance rather than the browser's native `type=search` cross, which is
          hidden in filterBar.css so the two never stack. Clearing goes through the same
          onChange as typing, so the caller's debounce and server-side search still apply. */}
      {value && (
        <button type="button" class="tf-search-clear" aria-label="Clear search"
          onClick={e => { e.stopPropagation(); onChange(''); }}>
          <LucideIcon name="X" size={13} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

// ── Basic filter — multi-select dropdown ─────────────────────────────────────
export interface FilterDropdownProps {
  id: string;
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  openId: string | null;
  setOpenId: (v: string | null) => void;
  labelFn?: (o: string) => string;
}
export function FilterDropdown(
  { id, label, options, selected, onChange, openId, setOpenId, labelFn = o => o }: FilterDropdownProps,
): VNode {
  const isOpen = openId === id;
  const value = selected.length
    ? selected.slice(0, 2).map(labelFn).join(', ') + (selected.length > 2 ? ` +${selected.length - 2}` : '')
    : 'All';
  return (
    <div class="tf-wrap" {...{ [FILTER_DROPDOWN_ATTR]: id }}>
      <button type="button" class="tf-select" aria-haspopup="menu" aria-expanded={isOpen}
        onClick={e => { e.stopPropagation(); setOpenId(isOpen ? null : id); }}>
        <span class="tf-select-text"><span class="tf-select-label">{label}</span><span class="tf-select-value">{value}</span></span>
        {selected.length
          ? <span class="tf-select-count">{selected.length}</span>
          : <span class="tf-caret" aria-hidden="true"><LucideIcon name="ChevronDown" size={15} /></span>}
      </button>
      {isOpen && (
        <div class="tf-menu" role="menu" aria-label={label}>
          <div class="tf-menu-head"><strong>{label}</strong><span>Select one or more values.</span></div>
          <div class="tf-menu-list">
            {options.length ? options.map(opt => (
              <button key={opt} type="button" role="menuitemcheckbox" aria-checked={selected.includes(opt)}
                class={`tf-check ${selected.includes(opt) ? 'active' : ''}`} onClick={() => onChange(toggle(selected, opt))}>
                <span class="tf-checkbox" aria-hidden="true">{selected.includes(opt) ? <LucideIcon name="Check" size={12} strokeWidth={3} /> : ''}</span>
                <span>{labelFn(opt)}</span>
              </button>
            )) : <div class="tf-menu-empty">No values</div>}
          </div>
          <div class="tf-menu-foot">
            <button type="button" onClick={() => onChange([])}>Clear</button>
            <button type="button" class="tf-apply" onClick={() => setOpenId(null)}>Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Advanced filter — generic, config-driven ─────────────────────────────────
export type AdvSection =
  | { type: 'checklist'; title: string; options: string[]; selected: string[]; onChange: (v: string[]) => void; labelFn?: (o: string) => string; hint?: string }
  | { type: 'dateRange'; title: string; from: string; to: string; onChange: (from: string, to: string) => void; hint?: string }
  | { type: 'numberRange'; title: string; min: string; max: string; unit?: string; step?: string; onChange: (min: string, max: string) => void; hint?: string };

export interface AdvTab { name: string; blurb?: string; sections: AdvSection[] }

function sectionActive(s: AdvSection): number {
  if (s.type === 'checklist') return s.selected.length ? 1 : 0;
  if (s.type === 'dateRange') return (s.from || s.to) ? 1 : 0;
  return (s.min || s.max) ? 1 : 0;
}

function AdvSectionView({ section }: { section: AdvSection }): VNode {
  const count = section.type === 'checklist' ? section.selected.length : sectionActive(section);
  return (
    <div>
      <div class="tf-section-title"><strong>{section.title}</strong><span>{count ? `${count} selected` : 'Any'}</span></div>
      {section.type === 'checklist' && (
        <div class="tf-checks">
          {section.options.length ? section.options.map(opt => {
            const on = section.selected.includes(opt);
            return (
              <button key={opt} type="button" role="menuitemcheckbox" aria-checked={on}
                class={`tf-check ${on ? 'active' : ''}`} onClick={() => section.onChange(toggle(section.selected, opt))}>
                <span class="tf-checkbox" aria-hidden="true">{on ? <LucideIcon name="Check" size={12} strokeWidth={3} /> : ''}</span>
                <span>{(section.labelFn ?? (o => o))(opt)}</span>
              </button>
            );
          }) : <div class="tf-menu-empty">No values</div>}
        </div>
      )}
      {section.type === 'dateRange' && (
        <div class="tf-range">
          <input type="date" value={section.from} aria-label={`${section.title} from`} onInput={e => section.onChange((e.currentTarget).value, section.to)} />
          <span>to</span>
          <input type="date" value={section.to} aria-label={`${section.title} to`} onInput={e => section.onChange(section.from, (e.currentTarget).value)} />
        </div>
      )}
      {section.type === 'numberRange' && (
        <div class="tf-range">
          <input type="number" step={section.step ?? 'any'} value={section.min} placeholder={`Min${section.unit ? ` (${section.unit})` : ''}`} aria-label={`${section.title} minimum`} onInput={e => section.onChange((e.currentTarget).value, section.max)} />
          <span>to</span>
          <input type="number" step={section.step ?? 'any'} value={section.max} placeholder={`Max${section.unit ? ` (${section.unit})` : ''}`} aria-label={`${section.title} maximum`} onInput={e => section.onChange(section.min, (e.currentTarget).value)} />
        </div>
      )}
    </div>
  );
}

export interface AdvancedFilterProps {
  tabs: AdvTab[];
  onReset: () => void;
  openId: string | null;
  setOpenId: (v: string | null) => void;
  id?: string;
  /** Small uppercase kicker above the trigger's title. `null` hides it. */
  kicker?: string | null;
  /** Trigger + panel title, shown when no filter is active. */
  title?: string;
  /** Panel sub-heading. */
  hint?: string;
  resetLabel?: string;
  /** Footer confirm button. `null` removes it — for panels whose selections apply immediately. */
  doneLabel?: string | null;
}
export function AdvancedFilter({
  tabs, onReset, openId, setOpenId, id = 'advanced',
  kicker = 'Advanced', title = 'Advanced Filters',
  hint = 'Refine by the fields below.', resetLabel = 'Reset Advanced', doneLabel = 'Apply Filters',
}: AdvancedFilterProps): VNode {
  const isOpen = openId === id;
  const [tab, setTab] = useState(0);
  const count = tabs.reduce((n, t) => n + t.sections.reduce((m, s) => m + sectionActive(s), 0), 0);
  const active = tabs[Math.min(tab, tabs.length - 1)];
  return (
    <div class="tf-wrap" {...{ [FILTER_DROPDOWN_ATTR]: id }}>
      <button type="button" class="tf-adv-btn" aria-haspopup="menu" aria-expanded={isOpen}
        onClick={() => setOpenId(isOpen ? null : id)}>
        <span class="tf-adv-left">
          <span class="tf-sliders" aria-hidden="true"><LucideIcon name="SlidersHorizontal" size={18} strokeWidth={2} /></span>
          <span>{kicker ? <small>{kicker}</small> : null}<strong>{count ? `${count} Filters Active` : title}</strong></span>
        </span>
        <span class="tf-adv-right">
          {count ? <span class="tf-adv-count">{count}</span> : null}
          <span class="tf-adv-caret" aria-hidden="true"><LucideIcon name="ChevronDown" size={12} strokeWidth={2.5} /></span>
        </span>
      </button>
      {isOpen && (
        <div class="tf-menu tf-adv-menu tf-right" role="menu" aria-label={title}>
          <div class="tf-menu-head"><strong>{title}</strong><span>{hint}</span></div>
          <div class="tf-adv-panel">
            <div class="tf-adv-tabs" role="tablist">
              {tabs.map((t, i) => (
                <button key={t.name} type="button" role="tab" aria-selected={i === tab} class={`tf-adv-tab ${i === tab ? 'active' : ''}`} onClick={() => setTab(i)}>{t.name}</button>
              ))}
            </div>
            <div class="tf-adv-body" role="tabpanel">
              {active && (
                <>
                  <div class="tf-adv-title"><div><strong>{active.name}</strong>{active.blurb ? <span>{active.blurb}</span> : null}</div></div>
                  {active.sections.map((s, i) => <AdvSectionView key={i} section={s} />)}
                </>
              )}
            </div>
            <div class="tf-adv-footer">
              <button type="button" onClick={onReset}>{resetLabel}</button>
              {doneLabel === null ? null : <button type="button" class="tf-apply" onClick={() => setOpenId(null)}>{doneLabel}</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Active-filter chips ───────────────────────────────────────────────────────
export interface ActiveChip { label: string; onRemove: () => void }
export function ActiveFilters(
  { chips, onClearAll, extra }: { chips: ActiveChip[]; onClearAll?: () => void; extra?: ComponentChildren },
): VNode | null {
  if (!chips.length) return null;
  return (
    <div class="tf-active">
      <strong>Active filters:</strong>
      {chips.map(c => (
        <button key={c.label} type="button" class="tf-chip" onClick={c.onRemove}>{c.label} <LucideIcon name="X" size={12} strokeWidth={2.5} /></button>
      ))}
      {extra}
      {onClearAll && <button type="button" class="tf-clear" onClick={onClearAll}>Clear all</button>}
    </div>
  );
}
