/**
 * src/components/sections/HSE/ptw/dialogs/NewPermitWizard.tsx
 *
 * New Permit-to-Work wizard — 5 steps:
 *   1. Permit Type   — select from usePermitTypes(), shows requires_* flags
 *   2. Work Scope    — title, description, site/location, start/end datetimes, supervisor
 *   3. Link Risk/JSA — optional linked JSA reference
 *   4. Hazards & Controls — simple optional list
 *   5. Review & Submit — summary; Save Draft or Submit
 *
 * Mirrors NewAssessmentWizard.tsx for UI-kit usage:
 *   Wizard > FormGrid + Field + TextInput / SelectInput / TextareaInput + Button
 */

import { useState } from 'preact/hooks';
import type { VNode } from 'preact';
import {
  Wizard, Field, TextInput, SelectInput, TextareaInput, FormGrid, Button, StatusPill,
} from '@ui';
import {
  useCreatePermit,
  usePermitTypes,
  type PermitTypeConfig,
  type PermitRiskLevel,
} from '@api/hse/ptw';
import { HSE_SITES } from '../../types';

// ── Constants ──────────────────────────────────────────────────────────────────

const WIZARD_STEPS = [
  { label: 'Permit Type',        sub: 'Work type & requirements' },
  { label: 'Work Scope',         sub: 'Location, dates & team' },
  { label: 'Link Risk/JSA',      sub: 'Optional — attach existing' },
  { label: 'Hazards & Controls', sub: 'Optional — brief list' },
  { label: 'Review & Submit',    sub: 'Confirm & create' },
] as const;

const SITE_OPTIONS = HSE_SITES.map(s => ({ value: s, label: s }));

const RISK_LEVEL_OPTIONS = [
  { value: '',         label: 'Not yet rated' },
  { value: 'low',      label: 'Low' },
  { value: 'medium',   label: 'Medium' },
  { value: 'high',     label: 'High' },
  { value: 'critical', label: 'Critical' },
];

// ── Sub-components ──────────────────────────────────────────────────────────────

/** Selectable permit type card — mirrors TypeCard from NewAssessmentWizard. */
function TypeCard({ cfg, selected, onSelect }: {
  cfg:      PermitTypeConfig;
  selected: boolean;
  onSelect: () => void;
}): VNode {
  const flags: string[] = [];
  if (cfg.requires_jsa)               flags.push('JSA');
  if (cfg.requires_isolation)         flags.push('Isolation');
  if (cfg.requires_gas_test)          flags.push('Gas Test');
  if (cfg.requires_simops_check)      flags.push('SIMOPS');
  if (cfg.requires_height_plan)       flags.push('Height Plan');
  if (cfg.requires_hot_work_cert)     flags.push('Hot Work Cert');
  if (cfg.requires_confined_space_cert) flags.push('Confined Space Cert');
  if (cfg.requires_radiation_badge)   flags.push('Radiation Badge');
  if (cfg.requires_excavation_survey) flags.push('Excavation Survey');
  if (cfg.requires_lifting_plan)      flags.push('Lifting Plan');
  if (cfg.requires_line_break_cert)   flags.push('Line Break Cert');
  if (cfg.requires_energized_cert)    flags.push('Energized Cert');

  return (
    <label
      style={{
        display: 'flex', flexDirection: 'column', gap: '6px',
        padding: '12px 14px',
        border: `2px solid ${selected ? 'var(--siomac-navy)' : 'var(--border)'}`,
        borderRadius: '8px', cursor: 'pointer',
        background: selected ? 'rgba(27,45,84,.07)' : 'transparent',
        transition: 'border-color .15s, background .15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <input
          type="radio"
          name="ptype"
          value={cfg.permit_type}
          checked={selected}
          onChange={onSelect}
          style={{ accentColor: 'var(--siomac-navy)', margin: 0 }}
        />
        <span style={{ fontWeight: selected ? 700 : 500, fontSize: '0.83rem' }}>
          {cfg.display_name}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          Max {cfg.max_duration_hours}h
        </span>
      </div>
      {flags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', paddingLeft: '22px' }}>
          {flags.map(f => (
            <span
              key={f}
              style={{
                fontSize: '0.65rem', fontWeight: 600,
                padding: '1px 6px', borderRadius: '4px',
                background: 'rgba(27,45,84,.1)', color: 'var(--siomac-navy)',
                textTransform: 'uppercase', letterSpacing: '0.04em',
              }}
            >
              {f}
            </span>
          ))}
        </div>
      )}
    </label>
  );
}

/** Simple hazard entry row for step 4. */
interface HazardEntry { description: string; control: string; }

function HazardEntryRow({ hazard, index, onChange, onRemove }: {
  hazard:   HazardEntry;
  index:    number;
  onChange: (patch: Partial<HazardEntry>) => void;
  onRemove: () => void;
}): VNode {
  return (
    <div style={{ padding: '12px 14px', background: 'var(--surface-alt)', borderRadius: '8px', display: 'grid', gap: '8px' }}>
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
        <Field label="Hazard description" wide>
          <TextInput
            value={hazard.description}
            onInput={v => onChange({ description: v })}
            placeholder="Describe the hazard…"
          />
        </Field>
        <Field label="Control measure" wide>
          <TextInput
            value={hazard.control}
            onInput={v => onChange({ control: v })}
            placeholder="Describe the control…"
          />
        </Field>
      </FormGrid>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function NewPermitWizard({ open, onClose }: { open: boolean; onClose: () => void }): VNode {
  const [step,        setStep]       = useState(0);
  const [permitType,  setPermitType] = useState('');
  const [title,       setTitle]      = useState('');
  const [description, setDesc]       = useState('');
  const [siteId,      setSiteId]     = useState('');
  const [location,    setLocation]   = useState('');
  const [riskLevel,   setRiskLevel]  = useState('');
  const [startDt,     setStartDt]    = useState('');
  const [endDt,       setEndDt]      = useState('');
  const [supervisor,  setSupervisor] = useState('');
  const [linkedJsa,   setLinkedJsa]  = useState('');
  const [linkedRa,    setLinkedRa]   = useState('');
  const [hazards,     setHazards]    = useState<HazardEntry[]>([]);
  const [error,       setError]      = useState('');

  const { data: typesRes, isLoading: typesLoading } = usePermitTypes();
  const typeConfigs = typesRes?.data ?? [];
  const create = useCreatePermit();

  /** Resolve the display name for the currently selected type. */
  const selectedTypeCfg = typeConfigs.find(t => t.permit_type === permitType) ?? null;

  function addHazard() {
    setHazards(prev => [...prev, { description: '', control: '' }]);
  }

  function patchHazard(i: number, patch: Partial<HazardEntry>) {
    setHazards(prev => prev.map((h, j) => j === i ? { ...h, ...patch } : h));
  }

  function removeHazard(i: number) {
    setHazards(prev => prev.filter((_, j) => j !== i));
  }

  function canAdvance(from: number): boolean {
    setError('');
    if (from === 0 && !permitType) {
      setError('Please select a permit type.');
      return false;
    }
    if (from === 1) {
      if (!title.trim()) { setError('Permit title is required.'); return false; }
      if (!siteId)       { setError('Site is required.'); return false; }
      if (!startDt)      { setError('Planned start date/time is required.'); return false; }
      if (!endDt)        { setError('Planned end date/time is required.'); return false; }
      if (endDt <= startDt) { setError('End date/time must be after start date/time.'); return false; }
    }
    return true;
  }

  async function handleSaveDraft() {
    if (!permitType) { setError('Please select a permit type first.'); return; }
    if (!title.trim()) { setError('Permit title is required.'); return; }
    setError('');
    try {
      await create.mutateAsync({
        permitType,
        title,
        description:      description || undefined,
        siteId:           siteId      || null,
        specificLocation: location    || null,
        riskLevel:        (riskLevel  || null) as PermitRiskLevel | null,
        startDatetime:    startDt     || null,
        endDatetime:      endDt       || null,
        workSupervisorId: supervisor  || null,
        linkedJsaId:      linkedJsa   || null,
        linkedRiskAssessmentId: linkedRa || null,
        submitImmediately: false,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save draft.');
    }
  }

  async function handleSubmit() {
    if (!canAdvance(0) || !canAdvance(1)) return;
    setError('');
    try {
      await create.mutateAsync({
        permitType,
        title,
        description:      description || undefined,
        siteId:           siteId      || null,
        specificLocation: location    || null,
        riskLevel:        (riskLevel  || null) as PermitRiskLevel | null,
        startDatetime:    startDt     || null,
        endDatetime:      endDt       || null,
        workSupervisorId: supervisor  || null,
        linkedJsaId:      linkedJsa   || null,
        linkedRiskAssessmentId: linkedRa || null,
        submitImmediately: true,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create permit.');
    }
  }

  function reset() {
    setStep(0);
    setPermitType(''); setTitle(''); setDesc(''); setSiteId('');
    setLocation(''); setRiskLevel(''); setStartDt(''); setEndDt('');
    setSupervisor(''); setLinkedJsa(''); setLinkedRa('');
    setHazards([]); setError('');
  }

  function handleClose() { reset(); onClose(); }

  // ── Side panel: type requirements summary ───────────────────────────────────

  const sidePanelFlags = selectedTypeCfg
    ? [
        selectedTypeCfg.requires_jsa               && 'Linked JSA required',
        selectedTypeCfg.requires_isolation          && 'Isolation verification',
        selectedTypeCfg.requires_gas_test           && 'Gas test (passing result)',
        selectedTypeCfg.requires_simops_check       && 'SIMOPS conflict check',
        selectedTypeCfg.requires_height_plan        && 'Work-at-height plan',
        selectedTypeCfg.requires_hot_work_cert      && 'Hot work certificate',
        selectedTypeCfg.requires_confined_space_cert && 'Confined space certificate',
        selectedTypeCfg.requires_radiation_badge    && 'Radiation badge',
        selectedTypeCfg.requires_excavation_survey  && 'Excavation survey',
        selectedTypeCfg.requires_lifting_plan       && 'Lifting plan',
        selectedTypeCfg.requires_line_break_cert    && 'Line break certificate',
        selectedTypeCfg.requires_energized_cert     && 'Energized work certificate',
      ].filter(Boolean) as string[]
    : [];

  const side = selectedTypeCfg ? (
    <div style={{ display: 'grid', gap: '8px' }}>
      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'rgba(255,255,255,.6)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
        {selectedTypeCfg.display_name}
      </div>
      <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,.5)', marginBottom: '8px' }}>
        Max duration: {selectedTypeCfg.max_duration_hours}h
      </div>
      {sidePanelFlags.length > 0 && (
        <>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'rgba(255,255,255,.55)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>
            Pre-activation requirements
          </div>
          {sidePanelFlags.map(f => (
            <div key={f} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.74rem', color: 'rgba(255,255,255,.75)' }}>
              <i class="fas fa-circle-check" style={{ color: '#f59e0b', fontSize: '0.7rem', flexShrink: 0 }} />
              {f}
            </div>
          ))}
        </>
      )}
      {sidePanelFlags.length === 0 && (
        <div style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,.5)' }}>No special pre-activation requirements.</div>
      )}
    </div>
  ) : undefined;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <Wizard
      open={open}
      title="New Permit to Work"
      sub="Request a permit for high-risk work — select the type, define the scope, then submit for area authority review."
      icon="fa-file-shield"
      steps={[...WIZARD_STEPS]}
      step={step}
      onStepChange={s => { setError(''); setStep(s); }}
      onClose={handleClose}
      onSubmit={() => { void handleSubmit(); }}
      submitLabel={create.isPending ? 'Creating…' : 'Submit Permit'}
      submitDisabled={create.isPending}
      canAdvance={canAdvance}
      side={side}
      size="lg"
    >
      {/* ── Step 0: Permit Type ──────────────────────────────────────────────── */}
      {step === 0 && (
        <div style={{ display: 'grid', gap: '8px' }}>
          {typesLoading && (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', padding: '20px 0' }}>
              Loading permit types…
            </p>
          )}
          {!typesLoading && typeConfigs.length === 0 && (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', padding: '20px 0' }}>
              No active permit types configured. Contact your HSE Administrator.
            </p>
          )}
          {typeConfigs.map(cfg => (
            <TypeCard
              key={cfg.permit_type}
              cfg={cfg}
              selected={permitType === cfg.permit_type}
              onSelect={() => { setPermitType(cfg.permit_type); setError(''); }}
            />
          ))}
          {error && (
            <div style={{ color: 'var(--color-danger)', fontSize: '0.8rem' }}>
              <i class="fas fa-exclamation-triangle" /> {error}
            </div>
          )}
        </div>
      )}

      {/* ── Step 1: Work Scope ───────────────────────────────────────────────── */}
      {step === 1 && (
        <FormGrid>
          <Field label="Permit title *" wide>
            <TextInput
              value={title}
              onInput={setTitle}
              placeholder="e.g. Confined space entry — Vessel V-102"
            />
          </Field>
          <Field label="Description" wide>
            <TextareaInput
              value={description}
              onInput={setDesc}
              placeholder="Describe the work to be performed, equipment involved, and isolation requirements…"
              rows={3}
            />
          </Field>
          <Field label="Site *">
            <SelectInput
              value={siteId}
              onInput={setSiteId}
              options={SITE_OPTIONS}
              placeholder="Select site…"
            />
          </Field>
          <Field label="Specific location">
            <TextInput
              value={location}
              onInput={setLocation}
              placeholder="e.g. Unit 3 — Bay 2, Vessel V-102"
            />
          </Field>
          <Field label="Risk level">
            <SelectInput
              value={riskLevel}
              onInput={setRiskLevel}
              options={RISK_LEVEL_OPTIONS}
            />
          </Field>
          <Field label="Planned start *">
            <TextInput
              type="datetime-local"
              value={startDt}
              onInput={setStartDt}
            />
          </Field>
          <Field label="Planned end *">
            <TextInput
              type="datetime-local"
              value={endDt}
              onInput={setEndDt}
            />
          </Field>
          <Field label="Work supervisor (name / ID)">
            <TextInput
              value={supervisor}
              onInput={setSupervisor}
              placeholder="e.g. T. Baptiste / EMP-0344"
            />
          </Field>
          {error && (
            <div style={{ gridColumn: '1 / -1', color: 'var(--color-danger)', fontSize: '0.8rem' }}>
              <i class="fas fa-exclamation-triangle" /> {error}
            </div>
          )}
        </FormGrid>
      )}

      {/* ── Step 2: Link Risk/JSA ────────────────────────────────────────────── */}
      {step === 2 && (
        <div style={{ display: 'grid', gap: '14px' }}>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
            Optionally link an approved JSA or risk assessment to this permit.
            The linked JSA will be verified as part of the pre-activation gate.
          </p>
          <FormGrid>
            <Field label="Linked JSA ID (UUID)" wide>
              <TextInput
                value={linkedJsa}
                onInput={setLinkedJsa}
                placeholder="Paste the JSA record ID (optional)"
              />
            </Field>
            <Field label="Linked Risk Assessment ID (UUID)" wide>
              <TextInput
                value={linkedRa}
                onInput={setLinkedRa}
                placeholder="Paste the Risk Assessment record ID (optional)"
              />
            </Field>
          </FormGrid>
          {selectedTypeCfg?.requires_jsa && (
            <div style={{ padding: '10px 14px', background: 'rgba(245,158,11,.1)', borderRadius: '8px', border: '1px solid rgba(245,158,11,.3)', fontSize: '0.8rem', color: '#b45309' }}>
              <i class="fas fa-triangle-exclamation" style={{ marginRight: '6px' }} />
              This permit type requires a linked, approved JSA before it can be activated.
            </div>
          )}
        </div>
      )}

      {/* ── Step 3: Hazards & Controls ──────────────────────────────────────── */}
      {step === 3 && (
        <div style={{ display: 'grid', gap: '12px' }}>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
            Optionally identify the key hazards and planned controls for this work.
            Formal risk assessments and hazard registers are managed in the Risk & JSA module.
          </p>
          {hazards.length === 0 && (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', padding: '20px 0' }}>
              No hazards added. This step is optional — click "Add Hazard" to begin.
            </p>
          )}
          {hazards.map((h, i) => (
            <HazardEntryRow
              key={i}
              hazard={h}
              index={i}
              onChange={patch => patchHazard(i, patch)}
              onRemove={() => removeHazard(i)}
            />
          ))}
          <div>
            <Button variant="outline" icon="fa-plus" onClick={addHazard}>Add Hazard</Button>
          </div>
        </div>
      )}

      {/* ── Step 4: Review & Submit ─────────────────────────────────────────── */}
      {step === 4 && (
        <div style={{ display: 'grid', gap: '14px' }}>
          <div style={{ padding: '16px', background: 'var(--surface-alt)', borderRadius: '10px', display: 'grid', gap: '8px', fontSize: '0.82rem' }}>
            <div style={{ fontWeight: 700, marginBottom: '4px', fontSize: '0.88rem' }}>Permit Summary</div>
            <div><strong style={{ color: 'var(--text-muted)' }}>Type:</strong> {selectedTypeCfg?.display_name ?? permitType}</div>
            <div><strong style={{ color: 'var(--text-muted)' }}>Title:</strong> {title || <em style={{ color: 'var(--text-muted)' }}>—</em>}</div>
            <div><strong style={{ color: 'var(--text-muted)' }}>Site:</strong> {siteId || '—'}</div>
            {location   && <div><strong style={{ color: 'var(--text-muted)' }}>Location:</strong> {location}</div>}
            {riskLevel  && <div><strong style={{ color: 'var(--text-muted)' }}>Risk Level:</strong> {riskLevel.charAt(0).toUpperCase() + riskLevel.slice(1)}</div>}
            {startDt    && <div><strong style={{ color: 'var(--text-muted)' }}>Start:</strong> {new Date(startDt).toLocaleString()}</div>}
            {endDt      && <div><strong style={{ color: 'var(--text-muted)' }}>End:</strong> {new Date(endDt).toLocaleString()}</div>}
            {supervisor && <div><strong style={{ color: 'var(--text-muted)' }}>Supervisor:</strong> {supervisor}</div>}
            {linkedJsa  && <div><strong style={{ color: 'var(--text-muted)' }}>Linked JSA:</strong> <span style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{linkedJsa}</span></div>}
            {linkedRa   && <div><strong style={{ color: 'var(--text-muted)' }}>Linked RA:</strong> <span style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{linkedRa}</span></div>}
            {hazards.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px', marginTop: '4px' }}>
                <strong style={{ color: 'var(--text-muted)' }}>Hazards Identified:</strong> {hazards.length}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <StatusPill status="submitted">
              Submitting will route to the area authority for review
            </StatusPill>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>
              Use "Save Draft" to save without submitting — you can submit later from the Permits register.
            </p>
          </div>

          {/* Save Draft button (available only on review step) */}
          <div>
            <button
              type="button"
              class="hse-btn"
              disabled={create.isPending}
              onClick={() => { void handleSaveDraft(); }}
              style={{ marginRight: '8px' }}
            >
              <i class="fas fa-floppy-disk" /> Save Draft
            </button>
          </div>

          {error && (
            <p style={{ color: 'var(--color-danger)', fontSize: '0.8rem', margin: 0 }}>
              <i class="fas fa-exclamation-triangle" /> {error}
            </p>
          )}
        </div>
      )}
    </Wizard>
  );
}
