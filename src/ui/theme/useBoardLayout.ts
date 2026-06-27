/**
 * src/ui/theme/useBoardLayout.ts
 *
 * Widget-board geometry state (the gridstack counterpart of useModuleLayout).
 * Resolves effective layout as user override → org default → page defaults,
 * persists to the backend (ui_layout, jsonb card_order) and caches in localStorage
 * for instant paint. Admins can publish the current board as the org default.
 *
 * @see docs/WIDGET_BOARD_SPEC.md
 */

import { useState, useEffect, useCallback } from 'preact/hooks';
import { useSessionStore, selectIsAdmin } from '@store/session';
import {
  getBoardLayout, saveBoardOverride, saveBoardDefault, resetLayoutOverride, type BoardItem,
} from '@api/layout';

const LS = (pageKey: string) => `siomac.board.${pageKey}`;

const pick = (saved: BoardItem[] | null | undefined, defaults: BoardItem[]): BoardItem[] =>
  saved && saved.length ? saved : defaults;

export interface BoardLayout {
  items: BoardItem[];
  /** Local only (no persist) — used while reconciling defaults. */
  setItems: (next: BoardItem[]) => void;
  /** Commit + save the user's personal override. */
  persistMine: (next: BoardItem[]) => void;
  /** Admin: publish the current board as the org default. */
  saveAsDefault: () => Promise<void>;
  /** Clear the personal override → revert to org/page default. */
  resetMine: () => Promise<void>;
  hasOverride: boolean;
  canSetDefault: boolean;
}

export function useBoardLayout(pageKey: string, defaults: BoardItem[]): BoardLayout {
  const isAdmin = useSessionStore(selectIsAdmin);
  const [items, setItemsState] = useState<BoardItem[]>(defaults);
  const [orgDefault, setOrgDefault] = useState<BoardItem[] | null>(null);
  const [hasOverride, setHasOverride] = useState(false);
  const defKey = defaults.map(d => d.id).join('|');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS(pageKey));
      if (raw) setItemsState(pick(JSON.parse(raw) as BoardItem[], defaults));
    } catch { /* ignore */ }

    let alive = true;
    getBoardLayout(pageKey).then(({ default: d, override }) => {
      if (!alive) return;
      setOrgDefault(d);
      setHasOverride(!!override);
      const eff = pick(override ?? d, defaults);
      setItemsState(eff);
      try { localStorage.setItem(LS(pageKey), JSON.stringify(eff)); } catch { /* ignore */ }
    }).catch(() => { /* offline / not signed in — page defaults stand */ });

    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey, defKey]);

  const persistMine = useCallback((next: BoardItem[]) => {
    setItemsState(next);
    setHasOverride(true);
    try { localStorage.setItem(LS(pageKey), JSON.stringify(next)); } catch { /* ignore */ }
    void saveBoardOverride(pageKey, next).catch(err =>
      console.warn('[board] could not persist layout to the server:', err?.message ?? err));
  }, [pageKey]);

  const saveAsDefault = useCallback(async () => {
    await saveBoardDefault(pageKey, items);
    setOrgDefault(items);
  }, [pageKey, items]);

  const resetMine = useCallback(async () => {
    await resetLayoutOverride(pageKey);
    setHasOverride(false);
    const eff = pick(orgDefault, defaults);
    setItemsState(eff);
    try { localStorage.setItem(LS(pageKey), JSON.stringify(eff)); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey, orgDefault, defKey]);

  return { items, setItems: setItemsState, persistMine, saveAsDefault, resetMine, hasOverride, canSetDefault: isAdmin };
}
