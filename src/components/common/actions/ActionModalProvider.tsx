/**
 * src/components/common/actions/ActionModalProvider.tsx
 *
 * Imperative host for the ActionModal, mirroring the @lib/dialog ergonomics:
 *
 *   const res = await openActionModal({ title: 'Reject pay item', record, reason: { required: true } });
 *   if (res.confirmed) await reject(res.reason);
 *
 * Mount <ActionModalHost/> ONCE (AppShell). A module-level store holds the pending
 * request; the host renders it via a body portal. Framework-imperative so it works
 * from components, hooks, and plain handlers.
 */

import { type VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { ActionModal } from './ActionModal';
import type { ActionModalConfig, ActionModalResult } from './actionModalTypes';

interface Pending { config: ActionModalConfig; resolve: (r: ActionModalResult) => void }

let pending: Pending | null = null;
const listeners = new Set<() => void>();
function emit(): void { for (const l of listeners) l(); }

/** Open the action modal and resolve with the user's decision (+ reason). */
export function openActionModal(config: ActionModalConfig): Promise<ActionModalResult> {
  if (pending) { pending.resolve({ confirmed: false }); pending = null; }
  return new Promise<ActionModalResult>((resolve) => { pending = { config, resolve }; emit(); });
}

function settle(result: ActionModalResult): void {
  const p = pending;
  pending = null;
  emit();
  p?.resolve(result);
}

export function ActionModalHost(): VNode | null {
  const [, force] = useState(0);
  useEffect(() => {
    const l = (): void => force((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);

  if (!pending) return null;
  const { config } = pending;
  return createPortal(
    <ActionModal
      open
      config={config}
      onCancel={() => settle({ confirmed: false })}
      onConfirm={(reason) => settle({ confirmed: true, reason })}
    />,
    document.body,
  );
}
