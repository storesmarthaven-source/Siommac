/**
 * src/components/nav/CommandPalette.tsx
 *
 * ⌘K / Ctrl+K command palette — keyboard-first "jump to anything" overlay
 * (Meridian-style). Lists every nav section available to the current role,
 * grouped by accordion group, with fuzzy filtering and arrow-key navigation.
 * Enter routes via Nav.showSection. This pass is jump-to-section only — no
 * live record search (deferred to a follow-up).
 *
 * Mounting: mountCommandPalette() renders into a dedicated root and exposes
 * window.openCommandPalette() so the sidebar search button can open it too.
 *
 * @see docs/UI_DESIGN_SYSTEM.md §Navigation
 */

import { h, render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { SiomacConfig, SectionItem, NavGroupItem } from './types';
import './CommandPalette.css';

// ── Data ──────────────────────────────────────────────────────────────────────

interface PaletteEntry {
  id:        string;
  label:     string;
  icon:      string;
  sub:       string;
  groupLabel: string;
}

function cfg(): SiomacConfig | undefined {
  return (window as unknown as { SiomacConfig?: SiomacConfig }).SiomacConfig;
}

function appState(): { get: (k: string) => unknown } | undefined {
  return (window as unknown as { AppState?: { get: (k: string) => unknown } }).AppState;
}

/** Build the flat, role-scoped list of jump targets, tagged with their group label. */
function buildEntries(): PaletteEntry[] {
  const c = cfg();
  if (!c) return [];
  const role = String(appState()?.get('currentRole') ?? '');
  const isEmployee = appState()?.get('currentIsEmployee') !== false;

  const groupLabels = new Map<string, string>(
    (c.NAV_GROUPS as NavGroupItem[]).map(g => [g.id, g.label || 'General']),
  );

  const main     = c.SECTION_DEFS[role] ?? [];
  const personal = isEmployee ? c.BASELINE_SECTIONS : [];
  const all: SectionItem[] = ([] as SectionItem[]).concat(main, personal, c.COMMON_ITEMS);

  return all.map(it => ({
    id:    it.id,
    label: it.label,
    icon:  it.icon,
    sub:   it.sub ?? '',
    groupLabel: groupLabels.get(it.group ?? 'overview') ?? 'General',
  }));
}

/** Simple subsequence fuzzy match — returns true if all query chars appear in order. */
function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

// ── Component ───────────────────────────────────────────────────────────────

function CommandPalette() {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef  = useRef<HTMLDivElement>(null);

  // Build entries fresh each open (role/permissions may have changed).
  const entries = useMemo(() => (open ? buildEntries() : []), [open]);

  const filtered = useMemo(() => {
    const q = query.trim();
    return entries.filter(e => fuzzyMatch(q, e.label) || fuzzyMatch(q, e.sub) || fuzzyMatch(q, e.groupLabel));
  }, [entries, query]);

  // Group filtered results by groupLabel, preserving order.
  const grouped = useMemo(() => {
    const out: { label: string; items: PaletteEntry[] }[] = [];
    const idx = new Map<string, PaletteEntry[]>();
    for (const e of filtered) {
      let bucket = idx.get(e.groupLabel);
      if (!bucket) { bucket = []; idx.set(e.groupLabel, bucket); out.push({ label: e.groupLabel, items: bucket }); }
      bucket.push(e);
    }
    return out;
  }, [filtered]);

  // Flat list (matches DOM order) for keyboard navigation.
  const flat = filtered;

  function close() { setOpen(false); setQuery(''); setActive(0); }

  function choose(id: string) {
    close();
    const nav = (window as unknown as { Nav?: { showSection?: (id: string) => void } }).Nav;
    nav?.showSection?.(id);
  }

  // Global ⌘K / Ctrl+K + window.openCommandPalette()
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        // Only when authenticated (sidebar present).
        if (!document.getElementById('appShell') || document.getElementById('appShell')!.classList.contains('hidden')) return;
        e.preventDefault();
        setOpen(o => !o);
      }
    }
    window.addEventListener('keydown', onKey);
    (window as unknown as Record<string, unknown>)['openCommandPalette'] = () => setOpen(true);
    return () => {
      window.removeEventListener('keydown', onKey);
      delete (window as unknown as Record<string, unknown>)['openCommandPalette'];
    };
  }, []);

  // Focus input on open; reset active.
  useEffect(() => {
    if (open) { setActive(0); setTimeout(() => inputRef.current?.focus(), 0); }
  }, [open]);

  // Keep active index in range as the filtered set changes.
  useEffect(() => { if (active >= flat.length) setActive(Math.max(0, flat.length - 1)); }, [flat.length, active]);

  // Scroll active row into view.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-pi="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  if (!open) return null;

  function onInputKey(e: KeyboardEvent) {
    if (e.key === 'Escape')      { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(flat.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === 'Enter')     { e.preventDefault(); const sel = flat[active]; if (sel) choose(sel.id); }
  }

  let runningIndex = -1;

  return (
    <div class="cmdk-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div class="cmdk-panel" role="dialog" aria-modal="true" aria-label="Command palette">
        <div class="cmdk-input-row">
          <i class="fas fa-search cmdk-input-icon" />
          <input
            ref={inputRef}
            class="cmdk-input"
            type="text"
            placeholder="Jump to a section…"
            value={query}
            onInput={(e) => { setQuery((e.target as HTMLInputElement).value); setActive(0); }}
            onKeyDown={onInputKey}
          />
          <kbd class="cmdk-esc">esc</kbd>
        </div>

        <div class="cmdk-list" ref={listRef}>
          {flat.length === 0 && <div class="cmdk-empty">No matching sections</div>}
          {grouped.map(group => (
            <div class="cmdk-group" key={group.label}>
              <div class="cmdk-group-label">{group.label}</div>
              {group.items.map(item => {
                runningIndex += 1;
                const i = runningIndex;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-pi={i}
                    class={`cmdk-item${i === active ? ' active' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(item.id)}
                  >
                    <span class="cmdk-item-icon"><i class={`fas ${item.icon}`} /></span>
                    <span class="cmdk-item-text">
                      <span class="cmdk-item-label">{item.label}</span>
                      {item.sub && <span class="cmdk-item-sub">{item.sub}</span>}
                    </span>
                    {i === active && <i class="fas fa-level-down-alt cmdk-item-enter" style="transform:rotate(90deg)" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div class="cmdk-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

// ── Mount ─────────────────────────────────────────────────────────────────────

export function mountCommandPalette(root: HTMLElement): void {
  render(h(CommandPalette, null), root);
}
