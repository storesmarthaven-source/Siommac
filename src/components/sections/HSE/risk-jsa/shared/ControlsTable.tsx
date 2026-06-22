/**
 * src/components/sections/HSE/risk-jsa/shared/ControlsTable.tsx
 *
 * The shared controls editor — an add/edit/remove list of control measures used
 * by New Hazard, New Assessment, New JSA and the Add Control dialog. Each row:
 * description · type · owner · due date · verification required.
 */

import { type VNode } from 'preact';
import { Button } from '@ui';

export const CONTROL_TYPES = [
  { value: 'elimination',        label: 'Elimination' },
  { value: 'substitution',       label: 'Substitution' },
  { value: 'engineering',        label: 'Engineering' },
  { value: 'administrative',     label: 'Administrative' },
  { value: 'ppe',                label: 'PPE' },
  { value: 'emergency_response', label: 'Emergency Response' },
] as const;

export interface ControlDraft {
  description: string;
  controlType: string;
  ownerUserId?: string | null;
  dueAt?: string | null;
  verificationRequired: boolean;
}

export function emptyControl(): ControlDraft {
  return { description: '', controlType: 'administrative', ownerUserId: null, dueAt: null, verificationRequired: false };
}

export interface ControlsTableProps {
  controls: ControlDraft[];
  onChange: (next: ControlDraft[]) => void;
}

export function ControlsTable({ controls, onChange }: ControlsTableProps): VNode {
  const update = (i: number, patch: Partial<ControlDraft>) =>
    onChange(controls.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const remove = (i: number) => onChange(controls.filter((_, j) => j !== i));
  const add = () => onChange([...controls, emptyControl()]);
  const duplicate = (i: number) => {
    const src = controls[i];
    if (!src) return;
    const copy = { ...src };
    onChange([...controls.slice(0, i + 1), copy, ...controls.slice(i + 1)]);
  };

  return (
    <div>
      {controls.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center', padding: '16px 0' }}>
          No controls added yet.
        </p>
      )}
      <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
        {controls.map((c, i) => (
          <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px', background: 'var(--bg-subtle)' }}>
            <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
              <input class="ui-input" style={{ flex: 2 }} placeholder="Control description…"
                value={c.description} onInput={e => update(i, { description: (e.target as HTMLInputElement).value })} />
              <select class="ui-select" style={{ width: '170px' }}
                value={c.controlType} onChange={e => update(i, { controlType: (e.target as HTMLSelectElement).value })}>
                {CONTROL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <button type="button" title="Duplicate" onClick={() => duplicate(i)}
                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-xs)', width: '32px', height: '32px', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <i class="fas fa-copy" />
              </button>
              <button type="button" title="Remove" onClick={() => remove(i)}
                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-xs)', width: '32px', height: '32px', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <i class="fas fa-trash" />
              </button>
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '6px' }}>
              <input class="ui-input" type="date" style={{ width: '160px' }}
                value={c.dueAt ?? ''} onInput={e => update(i, { dueAt: (e.target as HTMLInputElement).value || null })} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.74rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <input type="checkbox" checked={c.verificationRequired}
                  onChange={e => update(i, { verificationRequired: (e.target as HTMLInputElement).checked })}
                  style={{ accentColor: 'var(--siomac-navy)' }} />
                Verification required
              </label>
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 'var(--space-2)' }}>
        <Button variant="secondary" icon="fa-plus" onClick={add}>Add Control</Button>
      </div>
    </div>
  );
}
