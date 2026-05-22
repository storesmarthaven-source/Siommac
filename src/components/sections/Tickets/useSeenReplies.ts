/**
 * src/components/sections/Tickets/useSeenReplies.ts
 *
 * Tracks which ticket reply IDs the current user has seen.
 * Persists to localStorage under 'siomac_seen_reply_ids_<username>'.
 *
 * Replaces the _seenReplyIds Set + loadSeenIds() + persistSeen() helpers
 * from TicketsPanel.ts.
 */

import { useState, useCallback }  from 'preact/hooks';
import { useSessionStore }         from '@store/session';

function storageKey(username: string): string {
  return 'siomac_seen_reply_ids_' + username;
}

function loadIds(username: string): Set<string> {
  try {
    return new Set(
      JSON.parse(localStorage.getItem(storageKey(username)) ?? '[]') as string[],
    );
  } catch {
    return new Set();
  }
}

function saveIds(username: string, ids: Set<string>): void {
  try {
    localStorage.setItem(storageKey(username), JSON.stringify([...ids]));
  } catch { /* ignore — private mode */ }
}

export function useSeenReplies() {
  const username = useSessionStore(s => s.username) ?? '';
  const [seenIds, setSeenIds] = useState<Set<string>>(() => loadIds(username));

  const markAllSeen = useCallback((ids: string[]) => {
    setSeenIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.add(id));
      saveIds(username, next);
      return next;
    });
  }, [username]);

  return { seenIds, markAllSeen };
}
