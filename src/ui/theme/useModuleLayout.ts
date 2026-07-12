/**
 * src/ui/theme/useModuleLayout.ts
 *
 * Card-order state for a module page hero. Resolves the effective order as
 * user override → org default → page-supplied order, persists changes to the
 * backend (ui_layout), and caches in localStorage for instant paint.
 *
 * `canSetDefault` is true for admins/superadmins, who can also publish the
 * current order as the org-wide default.
 */

import { useState, useEffect, useCallback } from 'preact/hooks';
import { useSessionStore, selectIsAdmin } from '@store/session';
import { getLayout, saveLayoutOverride, saveLayoutDefault, resetLayoutOverride } from '@api/layout';

const LS = (pageKey: string) => `siomac.layout.${pageKey}`;

/** Keep saved keys that still exist (in saved order), then append any new cards. */
function reconcile(saved: string[] | null | undefined, cards: string[]): string[] {
  if (!saved || saved.length === 0) return cards;
  const valid = new Set(cards);
  const ordered = saved.filter(k => valid.has(k));
  const seen = new Set(ordered);
  for (const c of cards) if (!seen.has(c)) ordered.push(c);
  return ordered;
}

export interface ModuleLayout {
  order:         string[];
  setOrder:      (next: string[]) => void;   // local only (during a drag)
  persistMine:   (next: string[]) => void;   // commit + save personal override
  saveAsDefault: () => Promise<void>;         // admin: publish current order as org default
  resetMine:     () => Promise<void>;         // clear personal override
  hasOverride:   boolean;
  canSetDefault: boolean;
  enabled:       boolean;
}

export function useModuleLayout(pageKey: string | undefined, cards: string[]): ModuleLayout {
  const isAdmin = useSessionStore(selectIsAdmin);
  const key = cards.join('|');
  const [order, setOrderState] = useState<string[]>(cards);
  const [orgDefault, setOrgDefault] = useState<string[] | null>(null);
  const [hasOverride, setHasOverride] = useState(false);

  useEffect(() => {
    if (!pageKey) { setOrderState(cards); return; }
    try {
      const raw = localStorage.getItem(LS(pageKey));
      if (raw) setOrderState(reconcile(JSON.parse(raw) as string[], cards));
    } catch { /* ignore */ }

    let alive = true;
    getLayout(pageKey).then(({ default: d, override }) => {
      if (!alive) return;
      setOrgDefault(d);
      setHasOverride(!!override);
      const eff = reconcile(override ?? d, cards);
      setOrderState(eff);
      try { localStorage.setItem(LS(pageKey), JSON.stringify(eff)); } catch { /* ignore */ }
    }).catch(() => { /* not signed in / offline — page default stands */ });

    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey, key]);

  const setOrder = useCallback((next: string[]) => setOrderState(next), []);

  const persistMine = useCallback((next: string[]) => {
    if (!pageKey) return;
    setOrderState(next);
    setHasOverride(true);
    try { localStorage.setItem(LS(pageKey), JSON.stringify(next)); } catch { /* ignore */ }
    void saveLayoutOverride(pageKey, next).catch((err: unknown) => {
      // Saved locally; the server write failed (e.g. ui_layout table missing).
      console.warn('[ui_layout] could not persist card order to the server:', err instanceof Error ? err.message : err);
    });
  }, [pageKey]);

  const saveAsDefault = useCallback(async () => {
    if (!pageKey) return;
    await saveLayoutDefault(pageKey, order);
    setOrgDefault(order);
  }, [pageKey, order]);

  const resetMine = useCallback(async () => {
    if (!pageKey) return;
    await resetLayoutOverride(pageKey);
    setHasOverride(false);
    const eff = reconcile(orgDefault, cards);
    setOrderState(eff);
    try { localStorage.setItem(LS(pageKey), JSON.stringify(eff)); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey, orgDefault, key]);

  return { order, setOrder, persistMine, saveAsDefault, resetMine, hasOverride, canSetDefault: isAdmin, enabled: !!pageKey };
}
