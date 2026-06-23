/**
 * src/components/sections/HSE/risk-jsa/dialogs/LibraryDrawers.tsx
 *
 * Pick-from-library pickers for the standard hazard / control banks.
 *   • HazardLibraryDrawer  — multi-select standard hazards into an assessment.
 *   • ControlLibraryDrawer — pick a standard control into a hazard's controls.
 */

import { type VNode } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import { Modal, Field, TextInput, SelectInput } from '@ui';
import {
  useHazardLibrary, useControlLibrary,
  type HazardLibraryItem, type ControlLibraryItem,
} from '@api/hse/riskJsa';
import { RiskScorePill } from '../shared/RiskScorePill';
import { CONTROL_TYPES } from '../shared/ControlsTable';

// ── Hazard library (multi-select) ──────────────────────────────────────────────

export function HazardLibraryDrawer({ open, onClose, onInsert }: {
  open: boolean;
  onClose: () => void;
  onInsert: (items: HazardLibraryItem[]) => void;
}): VNode {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading } = useHazardLibrary({ search: search || undefined }, open);
  const all = data?.data ?? [];
  const items = category ? all.filter(h => h.category === category) : all;
  const categories = useMemo(() => [...new Set(all.map(h => h.category))].sort(), [all]);

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const close = () => { setSelected(new Set()); setSearch(''); setCategory(''); onClose(); };
  const insert = () => { onInsert(all.filter(h => selected.has(h.id))); close(); };

  return (
    <Modal
      open={open}
      title="Hazard Library"
      sub="Select standard hazards to add to this assessment."
      icon="fa-radiation"
      size="lg"
      onClose={close}
      onSubmit={insert}
      submitLabel={`Insert ${selected.size || ''}`.trim()}
      submitDisabled={selected.size === 0}
    >
      <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
        <div style={{ flex: 1 }}>
          <Field label="Search"><TextInput value={search} onInput={setSearch} placeholder="Search hazards…" /></Field>
        </div>
        <div style={{ width: '200px' }}>
          <Field label="Category">
            <SelectInput value={category} onInput={setCategory} placeholder="All categories"
              options={categories.map(c => ({ value: c, label: c }))} />
          </Field>
        </div>
      </div>

      <div style={{ display: 'grid', gap: '8px', maxHeight: '420px', overflowY: 'auto', paddingRight: '4px' }}>
        {isLoading && <div style={{ color: 'var(--text-muted)', padding: '20px', textAlign: 'center' }}>Loading library…</div>}
        {!isLoading && items.length === 0 && <div style={{ color: 'var(--text-muted)', padding: '20px', textAlign: 'center' }}>No matching hazards.</div>}
        {items.map(h => {
          const on = selected.has(h.id);
          return (
            <label key={h.id} style={{
              display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px 12px',
              border: `1px solid ${on ? 'var(--siomac-navy)' : 'var(--border)'}`, borderRadius: '10px',
              background: on ? 'rgba(27,45,85,0.04)' : 'var(--bg-card)', cursor: 'pointer',
            }}>
              <input type="checkbox" checked={on} onChange={() => toggle(h.id)} style={{ marginTop: '3px' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 600, color: 'var(--siomac-navy)', fontSize: '0.84rem' }}>{h.title}</span>
                  {h.default_likelihood != null && h.default_severity != null && (
                    <RiskScorePill likelihood={h.default_likelihood} severity={h.default_severity} compact />
                  )}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>{h.category} · {h.typical_consequence}</div>
              </div>
            </label>
          );
        })}
      </div>
    </Modal>
  );
}

// ── Control library (single pick) ──────────────────────────────────────────────

export function ControlLibraryDrawer({ open, onClose, onInsert }: {
  open: boolean;
  onClose: () => void;
  onInsert: (item: ControlLibraryItem) => void;
}): VNode {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');

  const { data, isLoading } = useControlLibrary({ search: search || undefined }, open);
  const all = data?.data ?? [];
  const items = type ? all.filter(ctl => ctl.control_type === type) : all;

  const close = () => { setSearch(''); setType(''); onClose(); };
  const pick = (item: ControlLibraryItem) => { onInsert(item); close(); };

  return (
    <Modal
      open={open}
      title="Control Library"
      sub="Pick a standard control to add."
      icon="fa-shield-halved"
      size="lg"
      onClose={close}
    >
      <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
        <div style={{ flex: 1 }}>
          <Field label="Search"><TextInput value={search} onInput={setSearch} placeholder="Search controls…" /></Field>
        </div>
        <div style={{ width: '200px' }}>
          <Field label="Type">
            <SelectInput value={type} onInput={setType} placeholder="All types"
              options={CONTROL_TYPES.map(t => ({ value: t.value, label: t.label }))} />
          </Field>
        </div>
      </div>

      <div style={{ display: 'grid', gap: '8px', maxHeight: '420px', overflowY: 'auto', paddingRight: '4px' }}>
        {isLoading && <div style={{ color: 'var(--text-muted)', padding: '20px', textAlign: 'center' }}>Loading library…</div>}
        {!isLoading && items.length === 0 && <div style={{ color: 'var(--text-muted)', padding: '20px', textAlign: 'center' }}>No matching controls.</div>}
        {items.map(ctl => (
          <button key={ctl.id} type="button" onClick={() => pick(ctl)} style={{
            display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px',
            border: '1px solid var(--border)', borderRadius: '10px', background: 'var(--bg-card)', cursor: 'pointer',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600, color: 'var(--siomac-navy)', fontSize: '0.84rem' }}>{ctl.title}</span>
              <span class="vt-pill is-info">{CONTROL_TYPES.find(t => t.value === ctl.control_type)?.label ?? ctl.control_type}</span>
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>{ctl.description}</div>
          </button>
        ))}
      </div>
    </Modal>
  );
}
