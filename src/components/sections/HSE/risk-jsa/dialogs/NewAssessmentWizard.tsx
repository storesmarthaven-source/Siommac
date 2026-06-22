/**
 * src/components/sections/HSE/risk-jsa/dialogs/NewAssessmentWizard.tsx
 *
 * Multi-step wizard for creating a new Risk Assessment. Six steps:
 *   1. Assessment Type — selectable card grid
 *   2. Scope           — title, description, site, department, location, review cycle / due
 *   3. Hazards         — editable list with RiskMatrixPicker per entry
 *   4. Controls        — per-hazard notes (controls added after creation)
 *   5. Residual Risk   — per-hazard optional residual L×S + RiskScorePill
 *   6. Review & Submit — summary + "Save as Draft" submission
 */

import { useState } from 'preact/hooks';
import type { VNode } from 'preact';
import {
  Wizard, Field, TextInput, SelectInput, TextareaInput, FormGrid,
  Button, StatusPill,
} from '@ui';
import { RiskScorePill } from '../shared/RiskScorePill';
import { RiskMatrixPicker } from '../shared/RiskMatrixPicker';
import { useCreateAssessment } from '@api/hse/riskJsa';
import { HSE_SITES } from '../../types';

// ── Constants ──────────────────────────────────────────────────────────────────

const ASSESSMENT_TYPES = [
  { value: 'general',       label: 'General Risk Assessment' },
  { value: 'task',          label: 'Task Risk Assessment' },
  { value: 'area',          label: 'Area Risk Assessment' },
  { value: 'equipment',     label: 'Equipment Risk Assessment' },
  { value: 'chemical',      label: 'Chemical Risk Assessment' },
  { value: 'permit_linked', label: 'Permit-Linked Assessment' },
  { value: 'change',        label: 'Change / Non-Routine Work' },
] as const;

const HAZARD_CATEGORIES = [
  'Safety', 'Health', 'Environmental', 'Chemical', 'Biological',
  'Ergonomic', 'Mechanical', 'Electrical', 'Fire', 'Security', 'Process', 'Other',
] as const;

const REVIEW_CYCLES = [
  { value: 'monthly',   label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'biannual',  label: 'Bi-Annual' },
  { value: 'annual',    label: 'Annual' },
  { value: 'on_change', label: 'On Change' },
] as const;

const SITE_OPTIONS = HSE_SITES.map(s => ({ value: s, label: s }));

const WIZARD_STEPS = [
  'Assessment Type',
  'Scope',
  'Hazards',
  'Controls',
  'Residual Risk',
  'Review & Submit',
] as const;

// ── Hazard entry shape used locally ───────────────────────────────────────────

interface HazardEntry {
  hazardDescription: string;
  category:          string;
  initialLikelihood: number;
  initialSeverity:   number;
  controlsNote:      string;
  residualLikelihood: number | undefined;
  residualSeverity:   number | undefined;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function TypeCard({ value, label, selected, onSelect }: {
  value:    string;
  label:    string;
  selected: boolean;
  onSelect: () => void;
}): VNode {
  return (
    <label
      style={{
        display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 14px',
        border: `2px solid ${selected ? 'var(--siomac-navy)' : 'var(--border)'}`,
        borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem',
        background: selected ? 'rgba(27,45,84,.07)' : 'transparent',
        transition: 'border-color .15s, background .15s',
        fontWeight: selected ? 600 : 400,
      }}
    >
      <input
        type="radio"
        name="atype"
        value={value}
        checked={selected}
        onChange={onSelect}
        style={{ accentColor: 'var(--siomac-navy)', margin: 0 }}
      />
      {label}
    </label>
  );
}

function HazardRow({ hazard, index, onChange, onRemove }: {
  hazard:   HazardEntry;
  index:    number;
  onChange: (patch: Partial<HazardEntry>) => void;
  onRemove: () => void;
}): VNode {
  return (
    <div style={{
      padding: '14px', background: 'var(--surface-alt)', borderRadius: '10px',
      display: 'grid', gap: '10px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--siomac-navy)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Hazard {index + 1}
        </span>
        <button
          type="button"
          onClick={onRemove}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px 6px' }}
          aria-label="Remove hazard"
        >
          <i class="fas fa-times" />
        </button>
      </div>

      <FormGrid>
        <Field label="Description" wide>
          <TextInput
            value={hazard.hazardDescription}
            onInput={v => onChange({ hazardDescription: v })}
            placeholder="Describe the hazard…"
          />
        </Field>
        <Field label="Category">
          <SelectInput
            value={hazard.category}
            onInput={v => onChange({ category: v })}
            options={HAZARD_CATEGORIES.map(c => ({ value: c, label: c }))}
          />
        </Field>
      </FormGrid>

      <div>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
          Initial Risk — click a cell to set Likelihood × Severity
        </span>
        <RiskMatrixPicker
          likelihood={hazard.initialLikelihood}
          severity={hazard.initialSeverity}
          onChange={(l, s) => onChange({ initialLikelihood: l, initialSeverity: s })}
        />
        <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <RiskScorePill likelihood={hazard.initialLikelihood} severity={hazard.initialSeverity} />
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            {hazard.initialLikelihood} × {hazard.initialSeverity} = {hazard.initialLikelihood * hazard.initialSeverity}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function NewAssessmentWizard({ open, onClose }: { open: boolean; onClose: () => void }): VNode {
  const [step,        setStep]        = useState(0);
  const [assessType,  setAssessType]  = useState('general');
  const [title,       setTitle]       = useState('');
  const [description, setDescription] = useState('');
  const [siteId,      setSiteId]      = useState('');
  const [department,  setDepartment]  = useState('');
  const [location,    setLocation]    = useState('');
  const [reviewCycle, setReviewCycle] = useState('annual');
  const [reviewDue,   setReviewDue]   = useState('');
  const [hazards,     setHazards]     = useState<HazardEntry[]>([]);
  const [error,       setError]       = useState('');

  const create = useCreateAssessment();

  function addHazard() {
    setHazards(prev => [...prev, {
      hazardDescription:  '',
      category:           'Safety',
      initialLikelihood:  3,
      initialSeverity:    3,
      controlsNote:       '',
      residualLikelihood: undefined,
      residualSeverity:   undefined,
    }]);
  }

  function patchHazard(i: number, patch: Partial<HazardEntry>) {
    setHazards(prev => prev.map((h, j) => j === i ? { ...h, ...patch } : h));
  }

  function removeHazard(i: number) {
    setHazards(prev => prev.filter((_, j) => j !== i));
  }

  function canAdvance(from: number): boolean {
    setError('');
    if (from === 1 && !title.trim()) {
      setError('Assessment title is required.');
      return false;
    }
    return true;
  }

  async function handleSubmit() {
    if (!title.trim()) { setError('Assessment title is required.'); return; }
    setError('');
    try {
      await create.mutateAsync({
        assessmentType: assessType,
        title,
        description: description || undefined,
        siteId:      siteId      || null,
        departmentId: department || undefined,
        locationText: location   || undefined,
        reviewCycle,
        reviewDueAt: reviewDue   || null,
        hazards: hazards.map(h => ({
          hazardDescription:  h.hazardDescription || undefined,
          category:           h.category          || undefined,
          initialLikelihood:  h.initialLikelihood,
          initialSeverity:    h.initialSeverity,
          residualLikelihood: h.residualLikelihood ?? undefined,
          residualSeverity:   h.residualSeverity   ?? undefined,
          notes:              h.controlsNote        || undefined,
        })),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create assessment.');
    }
  }

  // ── Per-step derived values ──────────────────────────────────────────────────

  const highCriticalCount = hazards.filter(h => {
    const score = h.initialLikelihood * h.initialSeverity;
    return score >= 10;
  }).length;

  const selectedTypeLabel = ASSESSMENT_TYPES.find(t => t.value === assessType)?.label ?? assessType;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <Wizard
      open={open}
      title="New Risk Assessment"
      sub="Formal risk evaluation — scope, hazards, controls and residual-risk scoring through to approval."
      icon="fa-table-cells-large"
      steps={[...WIZARD_STEPS]}
      step={step}
      onStepChange={s => { setError(''); setStep(s); }}
      onClose={onClose}
      onSubmit={() => { void handleSubmit(); }}
      submitLabel={create.isPending ? 'Saving…' : 'Save as Draft'}
      submitDisabled={create.isPending}
      canAdvance={canAdvance}
      size="lg"
    >
      {/* ── Step 0: Assessment Type ─────────────────────────────────────────── */}
      {step === 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          {ASSESSMENT_TYPES.map(at => (
            <TypeCard
              key={at.value}
              value={at.value}
              label={at.label}
              selected={assessType === at.value}
              onSelect={() => setAssessType(at.value)}
            />
          ))}
        </div>
      )}

      {/* ── Step 1: Scope ───────────────────────────────────────────────────── */}
      {step === 1 && (
        <FormGrid>
          <Field label="Title *" wide>
            <TextInput
              value={title}
              onInput={setTitle}
              placeholder="e.g. Chemical storage area risk assessment"
            />
          </Field>
          <Field label="Description" wide>
            <TextareaInput
              value={description}
              onInput={setDescription}
              placeholder="Describe the scope and purpose of this assessment…"
              rows={3}
            />
          </Field>
          <Field label="Site">
            <SelectInput
              value={siteId}
              onInput={setSiteId}
              options={SITE_OPTIONS}
              placeholder="All sites"
            />
          </Field>
          <Field label="Department">
            <TextInput
              value={department}
              onInput={setDepartment}
              placeholder="e.g. Operations"
            />
          </Field>
          <Field label="Location" wide>
            <TextInput
              value={location}
              onInput={setLocation}
              placeholder="e.g. Building 3 — Chemical store, Bay 2"
            />
          </Field>
          <Field label="Review Cycle">
            <SelectInput
              value={reviewCycle}
              onInput={setReviewCycle}
              options={[...REVIEW_CYCLES]}
            />
          </Field>
          <Field label="Review Due Date">
            <TextInput
              type="date"
              value={reviewDue}
              onInput={setReviewDue}
            />
          </Field>
          {error && (
            <div style={{ gridColumn: '1 / -1', color: 'var(--color-danger)', fontSize: '0.8rem' }}>
              <i class="fas fa-exclamation-triangle" /> {error}
            </div>
          )}
        </FormGrid>
      )}

      {/* ── Step 2: Hazards ─────────────────────────────────────────────────── */}
      {step === 2 && (
        <div style={{ display: 'grid', gap: '12px' }}>
          {hazards.length === 0 && (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', padding: '20px 0' }}>
              No hazards added yet. Click "Add Hazard" to begin.
            </p>
          )}
          {hazards.map((h, i) => (
            <HazardRow
              key={i}
              hazard={h}
              index={i}
              onChange={patch => patchHazard(i, patch)}
              onRemove={() => removeHazard(i)}
            />
          ))}
          <Button variant="outline" icon="fa-plus" onClick={addHazard}>Add Hazard</Button>
        </div>
      )}

      {/* ── Step 3: Controls ────────────────────────────────────────────────── */}
      {step === 3 && (
        <div style={{ display: 'grid', gap: '12px' }}>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
            Controls are formally added to each hazard after the assessment is created and approved.
            You can capture preliminary control notes here.
          </p>
          {hazards.length === 0 && (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', padding: '20px 0' }}>
              No hazards defined — go back to Step 3 to add hazards.
            </p>
          )}
          {hazards.map((h, i) => (
            <div key={i} style={{ padding: '14px', background: 'var(--surface-alt)', borderRadius: '10px', display: 'grid', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--siomac-navy)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Hazard {i + 1}
                </span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-body)' }}>
                  {h.hazardDescription || '(no description)'}
                </span>
                <RiskScorePill likelihood={h.initialLikelihood} severity={h.initialSeverity} />
              </div>
              <Field label="Control Notes (optional)">
                <TextareaInput
                  value={h.controlsNote}
                  onInput={v => patchHazard(i, { controlsNote: v })}
                  placeholder="Describe planned control measures…"
                  rows={2}
                />
              </Field>
            </div>
          ))}
        </div>
      )}

      {/* ── Step 4: Residual Risk ────────────────────────────────────────────── */}
      {step === 4 && (
        <div style={{ display: 'grid', gap: '12px' }}>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
            After controls are applied, estimate the residual risk for each hazard. This is optional at creation.
          </p>
          {hazards.length === 0 && (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', padding: '20px 0' }}>
              No hazards defined — go back to Step 3 to add hazards.
            </p>
          )}
          {hazards.map((h, i) => {
            const resL = h.residualLikelihood ?? h.initialLikelihood;
            const resS = h.residualSeverity   ?? h.initialSeverity;
            const resScore = resL * resS;
            const isHighOrCrit = resScore >= 10;
            return (
              <div key={i} style={{ padding: '14px', background: 'var(--surface-alt)', borderRadius: '10px', display: 'grid', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--siomac-navy)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Hazard {i + 1}
                  </span>
                  <span style={{ fontSize: '0.8rem' }}>{h.hazardDescription || '(no description)'}</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Initial:</span>
                  <RiskScorePill likelihood={h.initialLikelihood} severity={h.initialSeverity} />
                </div>
                <div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                    Residual Risk (after controls) — click a cell
                  </span>
                  <RiskMatrixPicker
                    likelihood={resL}
                    severity={resS}
                    onChange={(l, s) => patchHazard(i, { residualLikelihood: l, residualSeverity: s })}
                  />
                  <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <RiskScorePill likelihood={resL} severity={resS} />
                    {isHighOrCrit && (
                      <span style={{ fontSize: '0.72rem', color: 'var(--color-danger)' }}>
                        <i class="fas fa-triangle-exclamation" /> Residual risk remains high / critical — additional controls required.
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Step 5: Review & Submit ─────────────────────────────────────────── */}
      {step === 5 && (
        <div style={{ display: 'grid', gap: '14px' }}>
          <div style={{ padding: '16px', background: 'var(--surface-alt)', borderRadius: '10px', display: 'grid', gap: '8px', fontSize: '0.82rem' }}>
            <div style={{ fontWeight: 700, marginBottom: '4px', fontSize: '0.88rem' }}>Assessment Summary</div>
            <div><strong style={{ color: 'var(--text-muted)' }}>Type:</strong> {selectedTypeLabel}</div>
            <div><strong style={{ color: 'var(--text-muted)' }}>Title:</strong> {title || <em style={{ color: 'var(--text-muted)' }}>—</em>}</div>
            <div><strong style={{ color: 'var(--text-muted)' }}>Site:</strong> {siteId || 'All sites'}</div>
            {department && <div><strong style={{ color: 'var(--text-muted)' }}>Department:</strong> {department}</div>}
            {location   && <div><strong style={{ color: 'var(--text-muted)' }}>Location:</strong> {location}</div>}
            <div><strong style={{ color: 'var(--text-muted)' }}>Review Cycle:</strong> {REVIEW_CYCLES.find(r => r.value === reviewCycle)?.label ?? reviewCycle}</div>
            {reviewDue  && <div><strong style={{ color: 'var(--text-muted)' }}>Review Due:</strong> {new Date(reviewDue).toLocaleDateString()}</div>}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px', marginTop: '4px' }}>
              <strong style={{ color: 'var(--text-muted)' }}>Hazards Identified:</strong> {hazards.length}
              {highCriticalCount > 0 && (
                <span style={{ marginLeft: '10px', color: 'var(--color-danger)', fontSize: '0.78rem' }}>
                  <i class="fas fa-triangle-exclamation" /> {highCriticalCount} high / critical
                </span>
              )}
            </div>
          </div>
          {hazards.length > 0 && (
            <div style={{ display: 'grid', gap: '6px' }}>
              {hazards.map((h, i) => {
                const resL = h.residualLikelihood ?? h.initialLikelihood;
                const resS = h.residualSeverity   ?? h.initialSeverity;
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'var(--surface-alt)', borderRadius: '6px', fontSize: '0.78rem' }}>
                    <span style={{ flex: 1 }}>{h.hazardDescription || `Hazard ${i + 1}`}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>Initial:</span>
                    <RiskScorePill likelihood={h.initialLikelihood} severity={h.initialSeverity} hideScore />
                    {(h.residualLikelihood != null || h.residualSeverity != null) && (
                      <>
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>Residual:</span>
                        <RiskScorePill likelihood={resL} severity={resS} hideScore />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {error && (
            <p style={{ color: 'var(--color-danger)', fontSize: '0.8rem', margin: 0 }}>
              <i class="fas fa-exclamation-triangle" /> {error}
            </p>
          )}
          <StatusPill status="draft">Will be saved as Draft</StatusPill>
        </div>
      )}
    </Wizard>
  );
}
