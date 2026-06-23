/**
 * src/components/sections/HSE/ptw/dialogs/CustomHazardDialog.tsx
 *
 * Dialog for adding a custom hazard to a PTW permit.
 * Fields: hazard name*, category*, description*, consequence*,
 *         initial risk level, controls* (one per line),
 *         responsible person, verification required, evidence required.
 *
 * If the user has hse.risk.manage permission the dialog optionally
 * offers "Save to hazard library" — gated on a library CREATE route
 * existing. The route /api/hse/risk-jsa/library/hazards/create does NOT
 * currently exist, so the checkbox is rendered as disabled with an
 * explanatory note.
 */

import { useState } from 'preact/hooks';
import type { VNode } from 'preact';
import { Modal, Field, TextInput, TextareaInput, SelectInput, FormGrid } from '@ui';
import { useCan } from '@lib/permissions';
import { useCreateLibraryHazard } from '@api/hse/riskJsa';
import type { HazardCategory } from '../ptwHazardProfiles';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CustomHazard {
  name:               string;
  category:           HazardCategory;
  description:        string;
  consequence:        string;
  riskLevel:          'low' | 'medium' | 'high' | 'critical' | '';
  controls:           string[];   // one entry per control line
  responsiblePerson:  string;
  verificationRequired: boolean;
  evidenceRequired:   boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_OPTIONS: { value: HazardCategory; label: string }[] = [
  { value: 'Fire & Explosion', label: 'Fire & Explosion' },
  { value: 'Atmosphere',       label: 'Atmosphere' },
  { value: 'Chemical',         label: 'Chemical' },
  { value: 'Electrical',       label: 'Electrical' },
  { value: 'Mechanical',       label: 'Mechanical' },
  { value: 'Physical',         label: 'Physical' },
  { value: 'Ergonomic',        label: 'Ergonomic' },
  { value: 'Structural',       label: 'Structural' },
  { value: 'Environmental',    label: 'Environmental' },
  { value: 'Biological',       label: 'Biological' },
  { value: 'Radiation',        label: 'Radiation' },
  { value: 'Gravity',          label: 'Gravity' },
  { value: 'Pressure',         label: 'Pressure' },
  { value: 'Thermal',          label: 'Thermal' },
  { value: 'Other',            label: 'Other' },
];

const RISK_LEVEL_OPTIONS = [
  { value: '',         label: 'Not yet rated' },
  { value: 'low',      label: 'Low' },
  { value: 'medium',   label: 'Medium' },
  { value: 'high',     label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const EMPTY: CustomHazard = {
  name: '',
  category: 'Physical',
  description: '',
  consequence: '',
  riskLevel: '',
  controls: [''],
  responsiblePerson: '',
  verificationRequired: false,
  evidenceRequired: false,
};

// ── Toggle pill ───────────────────────────────────────────────────────────────

function TogglePill({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }): VNode {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}>
      <span
        role="switch"
        aria-checked={on}
        style={{
          display: 'inline-flex', width: '36px', height: '20px', borderRadius: '10px',
          background: on ? 'var(--siomac-navy)' : 'var(--border)',
          transition: 'background .15s', position: 'relative', flexShrink: 0,
        }}
        onClick={() => onChange(!on)}
      >
        <span style={{
          position: 'absolute', top: '3px', left: on ? '19px' : '3px',
          width: '14px', height: '14px', borderRadius: '50%',
          background: '#fff', transition: 'left .15s',
        }} />
      </span>
      <span style={{ fontSize: '0.82rem', color: 'var(--text)' }}>{label}</span>
    </label>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function CustomHazardDialog({ open, onClose, onAdd }: {
  open:    boolean;
  onClose: () => void;
  onAdd:   (h: CustomHazard) => void;
}): VNode {
  const [form, setForm] = useState<CustomHazard>(EMPTY);
  const [controlsText, setControlsText] = useState('');
  const [saveToLibrary, setSaveToLibrary] = useState(false);
  const [error, setError] = useState('');

  const canManageLibrary = useCan('hse.risk.library.manage');
  const libraryCreate = useCreateLibraryHazard();

  function patch(p: Partial<CustomHazard>) {
    setForm(prev => ({ ...prev, ...p }));
  }

  function validate(): boolean {
    if (!form.name.trim())        { setError('Hazard name is required.'); return false; }
    if (!form.category)           { setError('Category is required.'); return false; }
    if (!form.description.trim()) { setError('Description is required.'); return false; }
    if (!form.consequence.trim()) { setError('Potential consequence is required.'); return false; }
    const controls = controlsText.split('\n').map(l => l.trim()).filter(Boolean);
    if (controls.length === 0)    { setError('At least one control is required.'); return false; }
    return true;
  }

  function handleAdd() {
    setError('');
    if (!validate()) return;
    const controls = controlsText.split('\n').map(l => l.trim()).filter(Boolean);
    onAdd({ ...form, controls });

    // HSE/admin may also promote this hazard into the master library.
    if (saveToLibrary && canManageLibrary) {
      libraryCreate.mutate({
        category:           form.category,
        title:              form.name.trim(),
        description:        form.description.trim(),
        typicalConsequence: form.consequence.trim(),
        workTypes:          [],
      });
    }

    setForm(EMPTY);
    setControlsText('');
    setSaveToLibrary(false);
    onClose();
  }

  function handleClose() {
    setForm(EMPTY);
    setControlsText('');
    setSaveToLibrary(false);
    setError('');
    onClose();
  }

  return (
    <Modal
      open={open}
      title="Add Custom Hazard"
      sub="Define a hazard specific to this permit. It will be added to this permit only."
      icon="fa-triangle-exclamation"
      size="lg"
      onClose={handleClose}
      onSubmit={handleAdd}
      submitLabel="Add Hazard"
    >
      <FormGrid>
        {/* Hazard name */}
        <Field label="Hazard name *" wide>
          <TextInput
            value={form.name}
            onInput={v => patch({ name: v })}
            placeholder="e.g. Pressurised steam line in work area"
          />
        </Field>

        {/* Category */}
        <Field label="Category *">
          <SelectInput
            value={form.category}
            onInput={v => patch({ category: v as HazardCategory })}
            options={CATEGORY_OPTIONS}
          />
        </Field>

        {/* Risk level */}
        <Field label="Initial risk level">
          <SelectInput
            value={form.riskLevel}
            onInput={v => patch({ riskLevel: v as CustomHazard['riskLevel'] })}
            options={RISK_LEVEL_OPTIONS}
          />
        </Field>

        {/* Description */}
        <Field label="Description *" wide>
          <TextareaInput
            value={form.description}
            onInput={v => patch({ description: v })}
            placeholder="Describe how and where this hazard is present…"
            rows={2}
          />
        </Field>

        {/* Consequence */}
        <Field label="Potential consequence *" wide>
          <TextareaInput
            value={form.consequence}
            onInput={v => patch({ consequence: v })}
            placeholder="e.g. Burns, scalds, loss of life if steam contacts personnel"
            rows={2}
          />
        </Field>

        {/* Controls */}
        <Field label="Controls required * (one per line)" wide>
          <TextareaInput
            value={controlsText}
            onInput={setControlsText}
            placeholder={"Steam line isolated and locked out\nPersonnel barriers erected\nHeat-resistant PPE worn"}
            rows={4}
          />
        </Field>

        {/* Responsible person */}
        <Field label="Responsible person" wide>
          <TextInput
            value={form.responsiblePerson}
            onInput={v => patch({ responsiblePerson: v })}
            placeholder="Name or role (e.g. Site HSE Officer)"
          />
        </Field>

        {/* Toggle row */}
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '24px', flexWrap: 'wrap', padding: '4px 0' }}>
          <TogglePill
            on={form.verificationRequired}
            label="Verification required"
            onChange={v => patch({ verificationRequired: v })}
          />
          <TogglePill
            on={form.evidenceRequired}
            label="Evidence required"
            onChange={v => patch({ evidenceRequired: v })}
          />
        </div>

        {/* Save to master library — HSE/admin only (hse.risk.library.manage) */}
        {canManageLibrary && (
          <div style={{
            gridColumn: '1 / -1',
            padding: '10px 12px',
            background: 'var(--surface-alt)',
            borderRadius: '8px',
            border: '1px solid var(--border)',
          }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={saveToLibrary}
                onChange={e => setSaveToLibrary((e.target as HTMLInputElement).checked)}
                style={{ marginTop: '2px' }}
              />
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text)' }}>
                  Also save to the master hazard library
                </div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Makes this hazard reusable across future permits and assessments.
                  It is always added to this permit regardless of this option.
                </div>
              </div>
            </label>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ gridColumn: '1 / -1', color: 'var(--color-danger)', fontSize: '0.8rem' }}>
            <i class="fas fa-exclamation-triangle" /> {error}
          </div>
        )}
      </FormGrid>
    </Modal>
  );
}
