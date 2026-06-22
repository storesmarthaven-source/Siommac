/**
 * src/components/sections/HSE/risk-jsa/dialogs/NewHazardDialog.tsx
 *
 * 4-step Wizard for creating a new hazard in the Risk & JSA module.
 * Steps: Hazard Details → Initial Risk Rating → Controls → Review.
 * Submits via useCreateHazard() with full payload including controls and
 * optional residual risk rating.
 */

import { useState } from 'preact/hooks';
import { type VNode } from 'preact';
import { Wizard, FormGrid, Field, TextInput, SelectInput, TextareaInput } from '@ui';
import { RiskScorePill, calculateRiskBand } from '../shared/RiskScorePill';
import { RiskMatrixPicker } from '../shared/RiskMatrixPicker';
import { ControlsTable, type ControlDraft, emptyControl } from '../shared/ControlsTable';
import { useCreateHazard } from '@api/hse/riskJsa';
import { HSE_SITES } from '../../types';

// ── Constants ─────────────────────────────────────────────────────────────────

const STEPS = ['Hazard Details', 'Initial Risk Rating', 'Controls', 'Review'];

const HAZARD_CATEGORIES = [
  'Safety', 'Health', 'Environmental', 'Chemical', 'Biological',
  'Ergonomic', 'Mechanical', 'Electrical', 'Fire', 'Security', 'Process', 'Other',
] as const;

const SITE_OPTIONS = HSE_SITES.map(s => ({ value: s, label: s }));

// ── Component ─────────────────────────────────────────────────────────────────

export interface NewHazardDialogProps {
  open: boolean;
  onClose: () => void;
}

export function NewHazardDialog({ open, onClose }: NewHazardDialogProps): VNode | null {
  // ── Wizard step state
  const [step, setStep] = useState(0);

  // ── Step 1: Hazard Details
  const [title,        setTitle]        = useState('');
  const [description,  setDescription]  = useState('');
  const [category,     setCategory]     = useState('');
  const [site,         setSite]         = useState('');
  const [department,   setDepartment]   = useState('');
  const [location,     setLocation]     = useState('');

  // ── Step 2: Initial Risk Rating
  const [likelihood,   setLikelihood]   = useState(3);
  const [severity,     setSeverity]     = useState(3);

  // ── Step 3: Controls + optional residual rating
  const [controls,            setControls]            = useState<ControlDraft[]>([emptyControl()]);
  const [residualLikelihood,  setResidualLikelihood]  = useState<number | null>(null);
  const [residualSeverity,    setResidualSeverity]    = useState<number | null>(null);

  // ── Step 4: error state
  const [error, setError] = useState('');

  const createHazard = useCreateHazard();

  // ── Derived values
  const initialScore = likelihood * severity;
  const initialBand  = calculateRiskBand(initialScore);
  const isHighRisk   = initialBand === 'high' || initialBand === 'critical';

  const hasResidual = residualLikelihood !== null && residualSeverity !== null;

  // ── Validation gate for Wizard canAdvance
  function canAdvance(from: number): boolean {
    if (from === 0) {
      return title.trim().length >= 3 && description.trim().length >= 10 && category !== '' && site !== '';
    }
    return true;
  }

  // ── Reset all state when closing
  function handleClose() {
    setStep(0);
    setTitle(''); setDescription(''); setCategory(''); setSite('');
    setDepartment(''); setLocation('');
    setLikelihood(3); setSeverity(3);
    setControls([emptyControl()]);
    setResidualLikelihood(null); setResidualSeverity(null);
    setError('');
    onClose();
  }

  // ── Submit handler
  async function handleSubmit() {
    if (!title.trim()) { setError('Title is required'); return; }
    setError('');

    // Filter out empty controls
    const filledControls = controls
      .filter(c => c.description.trim().length > 0)
      .map(c => ({
        description:  c.description,
        controlType:  c.controlType,
        ownerUserId:  c.ownerUserId ?? undefined,
        dueAt:        c.dueAt ?? undefined,
      }));

    try {
      await createHazard.mutateAsync({
        title:                title.trim(),
        description:          description.trim(),
        category,
        siteId:               site,
        departmentId:         department.trim() || undefined,
        locationText:         location.trim() || undefined,
        initialLikelihood:    likelihood,
        initialSeverity:      severity,
        residualLikelihood:   residualLikelihood ?? undefined,
        residualSeverity:     residualSeverity   ?? undefined,
        controls:             filledControls,
      });
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create hazard. Please try again.');
    }
  }

  return (
    <Wizard
      open={open}
      title="New Hazard"
      sub="Identify, rate and control a workplace hazard — details, risk rating, controls and review."
      icon="fa-radiation"
      steps={STEPS}
      step={step}
      onStepChange={setStep}
      onClose={handleClose}
      onSubmit={() => void handleSubmit()}
      submitLabel="Create Hazard"
      submitDisabled={createHazard.isPending}
      canAdvance={canAdvance}
      size="lg"
    >
      {/* ── Step 1: Hazard Details ── */}
      {step === 0 && (
        <FormGrid>
          <Field label="Hazard Title *">
            <TextInput
              value={title}
              onInput={setTitle}
              placeholder="e.g. Confined space atmosphere risk"
            />
          </Field>
          <Field label="Description *" wide>
            <TextareaInput
              value={description}
              onInput={setDescription}
              placeholder="Describe the hazard and where it occurs (min. 10 characters)"
              rows={3}
            />
          </Field>
          <Field label="Category *">
            <SelectInput
              value={category}
              onInput={setCategory}
              options={HAZARD_CATEGORIES.map(c => ({ value: c, label: c }))}
              placeholder="Select category…"
            />
          </Field>
          <Field label="Site *">
            <SelectInput
              value={site}
              onInput={setSite}
              options={SITE_OPTIONS}
              placeholder="Select site…"
            />
          </Field>
          <Field label="Department (optional)">
            <TextInput
              value={department}
              onInput={setDepartment}
              placeholder="e.g. Operations"
            />
          </Field>
          <Field label="Location (optional)">
            <TextInput
              value={location}
              onInput={setLocation}
              placeholder="e.g. Bay 3, Warehouse A"
            />
          </Field>
          {/* Step 1 inline validation hint */}
          {(title.trim().length > 0 && title.trim().length < 3) && (
            <div class="ui-field ui-field--wide">
              <p style={{ color: 'var(--color-danger)', fontSize: '0.78rem', margin: 0 }}>
                <i class="fas fa-triangle-exclamation" /> Title must be at least 3 characters.
              </p>
            </div>
          )}
          {(description.trim().length > 0 && description.trim().length < 10) && (
            <div class="ui-field ui-field--wide">
              <p style={{ color: 'var(--color-danger)', fontSize: '0.78rem', margin: 0 }}>
                <i class="fas fa-triangle-exclamation" /> Description must be at least 10 characters.
              </p>
            </div>
          )}
        </FormGrid>
      )}

      {/* ── Step 2: Initial Risk Rating ── */}
      {step === 1 && (
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <div>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
              Click a cell in the matrix to set the likelihood (rows) and severity (columns) for this hazard.
            </p>
            <RiskMatrixPicker
              likelihood={likelihood}
              severity={severity}
              onChange={(l, s) => { setLikelihood(l); setSeverity(s); }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <RiskScorePill likelihood={likelihood} severity={severity} />
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Score: {likelihood} × {severity} = {initialScore}
            </span>
          </div>

          {isHighRisk && (
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0, padding: '8px 12px', background: 'var(--bg-subtle)', borderRadius: 'var(--radius-sm)', borderLeft: '3px solid var(--color-danger)' }}>
              <i class="fas fa-circle-info" style={{ marginRight: '6px' }} />
              High and Critical hazards will trigger an HSE review and approval workflow upon creation.
            </p>
          )}
        </div>
      )}

      {/* ── Step 3: Controls ── */}
      {step === 2 && (
        <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
          <div>
            <h4 style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
              Existing / Required Controls
            </h4>
            <ControlsTable controls={controls} onChange={setControls} />
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-4)' }}>
            <h4 style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
              Residual Risk Rating (optional)
            </h4>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
              Set the expected risk rating after controls are applied. If not set, residual risk defaults to the initial rating and status will remain <em>pending controls</em>.
            </p>

            {hasResidual ? (
              <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
                <RiskMatrixPicker
                  likelihood={residualLikelihood!}
                  severity={residualSeverity!}
                  onChange={(l, s) => { setResidualLikelihood(l); setResidualSeverity(s); }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                  <RiskScorePill likelihood={residualLikelihood!} severity={residualSeverity!} />
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    Residual: {residualLikelihood} × {residualSeverity} = {residualLikelihood! * residualSeverity!}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setResidualLikelihood(null); setResidualSeverity(null); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.75rem', padding: '2px 6px' }}
                  >
                    <i class="fas fa-times" /> Clear
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: 'var(--space-2)' }}>
                  Residual risk = initial; status = pending controls.
                </p>
                <button
                  type="button"
                  class="ui-btn ui-btn--outline"
                  onClick={() => { setResidualLikelihood(3); setResidualSeverity(3); }}
                >
                  <i class="fas fa-plus" /> Set Residual Risk
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Step 4: Review ── */}
      {step === 3 && (
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', background: 'var(--bg-subtle)' }}>
            <h4 style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
              <i class="fas fa-radiation" style={{ marginRight: '8px', color: 'var(--siomac-navy)' }} />
              Hazard Summary
            </h4>
            <div style={{ display: 'grid', gap: 'var(--space-2)', fontSize: '0.82rem' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <span style={{ color: 'var(--text-muted)', minWidth: '120px' }}>Title</span>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{title}</span>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <span style={{ color: 'var(--text-muted)', minWidth: '120px' }}>Category</span>
                <span>{category}</span>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <span style={{ color: 'var(--text-muted)', minWidth: '120px' }}>Site</span>
                <span>{site || '—'}</span>
              </div>
              {department && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <span style={{ color: 'var(--text-muted)', minWidth: '120px' }}>Department</span>
                  <span>{department}</span>
                </div>
              )}
              {location && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <span style={{ color: 'var(--text-muted)', minWidth: '120px' }}>Location</span>
                  <span>{location}</span>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: 'var(--text-muted)', minWidth: '120px' }}>Initial Risk</span>
                <RiskScorePill likelihood={likelihood} severity={severity} />
                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>({likelihood} × {severity} = {initialScore})</span>
              </div>
              {hasResidual && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: 'var(--text-muted)', minWidth: '120px' }}>Residual Risk</span>
                  <RiskScorePill likelihood={residualLikelihood!} severity={residualSeverity!} />
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                    ({residualLikelihood} × {residualSeverity} = {residualLikelihood! * residualSeverity!})
                  </span>
                </div>
              )}
              <div style={{ display: 'flex', gap: '8px' }}>
                <span style={{ color: 'var(--text-muted)', minWidth: '120px' }}>Controls</span>
                <span>{controls.filter(c => c.description.trim().length > 0).length} defined</span>
              </div>
            </div>
          </div>

          {createHazard.isPending && (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0, textAlign: 'center' }}>
              <i class="fas fa-spinner fa-spin" style={{ marginRight: '6px' }} />
              Creating hazard…
            </p>
          )}

          {error && (
            <div style={{
              padding: '10px 14px', borderRadius: 'var(--radius-sm)',
              background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)',
              color: 'var(--color-danger)', fontSize: '0.8rem',
            }}>
              <i class="fas fa-exclamation-triangle" style={{ marginRight: '6px' }} />
              {error}
            </div>
          )}
        </div>
      )}
    </Wizard>
  );
}
