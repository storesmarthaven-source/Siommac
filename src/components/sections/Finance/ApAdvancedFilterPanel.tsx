/**
 * src/components/sections/Finance/ApAdvancedFilterPanel.tsx
 *
 * Advanced filter drawer for the AP bills register — vendor, due-date range,
 * amount range, GL account. Vendor + GL are picker-backed (finance picker
 * endpoints), never free-text FKs. Draft state is local; Apply lifts it to the
 * caller which re-queries the server and resets pagination.
 */

import { type VNode } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { Drawer } from '@ui';
import { useVendorPicker, useGlAccounts } from '@api/finance/pickers';

export interface ApAdvFilters {
  vendorId?: string; dueFrom?: string; dueTo?: string;
  amountMin?: number; amountMax?: number; glAccountCode?: string;
}

/** Count of set advanced filters — drives the toolbar "Filters · N" badge. */
export function countAdvFilters(f: ApAdvFilters): number {
  return (['vendorId', 'dueFrom', 'dueTo', 'amountMin', 'amountMax', 'glAccountCode'] as const)
    .filter(k => f[k] !== undefined && f[k] !== '').length;
}

export function ApAdvancedFilterPanel({ open, value, onApply, onClear, onClose }: {
  open: boolean; value: ApAdvFilters;
  onApply: (f: ApAdvFilters) => void; onClear: () => void; onClose: () => void;
}): VNode {
  const [draft, setDraft] = useState<ApAdvFilters>(value);
  useEffect(() => { if (open) setDraft(value); }, [open]);

  const vendors = useVendorPicker();
  const glAccounts = useGlAccounts();
  const set = (patch: Partial<ApAdvFilters>): void => setDraft(d => ({ ...d, ...patch }));
  const numOrUndef = (v: string): number | undefined => (v === '' ? undefined : Number(v));
  const rangeInvalid = draft.dueFrom && draft.dueTo && draft.dueFrom > draft.dueTo;
  const amountInvalid = draft.amountMin != null && draft.amountMax != null && draft.amountMin > draft.amountMax;

  return (
    <Drawer
      open={open} onClose={onClose} panelClass="hrfin"
      title="Advanced filters" sub="Narrow the bills register"
      foot={
        <div style={{ display: 'flex', gap: 9, width: '100%' }}>
          <button type="button" class="hrfin-action" onClick={() => { setDraft({}); onClear(); }}>Clear all</button>
          <button type="button" class="hrfin-action is-primary" style={{ marginLeft: 'auto' }} disabled={!!rangeInvalid || !!amountInvalid} onClick={() => onApply(draft)}>Apply filters</button>
        </div>
      }
    >
      <div class="hrfin">
        <div class="hrfin-field"><label>Vendor</label>
          <select class="hrfin-input" value={draft.vendorId ?? ''} onChange={e => set({ vendorId: (e.target as HTMLSelectElement).value || undefined })}>
            <option value="">Any vendor</option>
            {(vendors.data ?? []).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>

        <div class="hrfin-field"><label>Due from</label><input class="hrfin-input" type="date" value={draft.dueFrom ?? ''} onInput={e => set({ dueFrom: (e.target as HTMLInputElement).value || undefined })} /></div>
        <div class="hrfin-field"><label>Due to</label><input class="hrfin-input" type="date" value={draft.dueTo ?? ''} onInput={e => set({ dueTo: (e.target as HTMLInputElement).value || undefined })} /></div>
        {rangeInvalid && <div class="hrfin-field-error" style={{ color: 'var(--danger, #d33)', fontSize: 12, marginTop: -6 }}>Due-from is after due-to.</div>}

        <div class="hrfin-field"><label>Amount from</label><input class="hrfin-input" type="number" min="0" step="0.01" placeholder="0" value={draft.amountMin ?? ''} onInput={e => set({ amountMin: numOrUndef((e.target as HTMLInputElement).value) })} /></div>
        <div class="hrfin-field"><label>Amount to</label><input class="hrfin-input" type="number" min="0" step="0.01" placeholder="Any" value={draft.amountMax ?? ''} onInput={e => set({ amountMax: numOrUndef((e.target as HTMLInputElement).value) })} /></div>
        {amountInvalid && <div class="hrfin-field-error" style={{ color: 'var(--danger, #d33)', fontSize: 12, marginTop: -6 }}>Amount-from is greater than amount-to.</div>}

        <div class="hrfin-field"><label>GL account</label>
          <select class="hrfin-input" value={draft.glAccountCode ?? ''} onChange={e => set({ glAccountCode: (e.target as HTMLSelectElement).value || undefined })}>
            <option value="">Any GL account</option>
            {(glAccounts.data ?? []).map(g => <option key={g.code} value={g.code}>{g.code} — {g.name}</option>)}
          </select>
        </div>
      </div>
    </Drawer>
  );
}
