/**
 * src/components/sections/HSE/risk-jsa/dialogs/NewJsaWizard.tsx
 *
 * Multi-step wizard for creating a new Job Safety Analysis.
 * Steps: Job Details → Job Steps → PPE → Training → Review & Submit
 */

import { useState, useEffect } from 'preact/hooks';
import { type VNode } from 'preact';
import {
  Wizard,
  Field,
  TextInput,
  SelectInput,
  TextareaInput,
  FormGrid,
} from '@ui';
import { RiskScorePill } from '../shared/RiskScorePill';
import {
  useCreateJsa,
  type JsaStep,
  type JsaPrefill,
} from '@api/hse/riskJsa';
import { HSE_SITES } from '../../types';

// ── Constants ─────────────────────────────────────────────────────────────────

const WIZARD_STEPS = [
  { label: 'Job Details',     sub: 'Task & site' },
  { label: 'Job Steps',       sub: 'Break down the task' },
  { label: 'PPE',             sub: 'Required equipment' },
  { label: 'Training',        sub: 'Competency needs' },
  { label: 'Crew',            sub: 'Team & acknowledgement' },
  { label: 'Review & Submit', sub: 'Confirm & submit' },
] as const;

const PPE_ITEMS = [
  'Hard hat',
  'Safety glasses',
  'Face shield',
  'Gloves',
  'Safety boots',
  'Hearing protection',
  'Respirator',
  'Harness',
  'High visibility vest',
  'Chemical apron',
  'Life jacket',
] as const;

const SCALE_OPTIONS = [
  { value: '1', label: '1 — Remote / Insignificant' },
  { value: '2', label: '2 — Unlikely / Minor' },
  { value: '3', label: '3 — Possible / Moderate' },
  { value: '4', label: '4 — Likely / Major' },
  { value: '5', label: '5 — Almost Certain / Catastrophic' },
] as const;

// ── Local types ───────────────────────────────────────────────────────────────

interface StepRow {
  stepNumber:        number;
  taskStep:          string;
  hazardDescription: string;
  likelihood:        string;
  severity:          string;
  controlsSummary:   string;
}

interface PpeRow {
  ppeItem:  string;
  required: boolean;
  notes:    string;
}

interface TrainingRow {
  requirementDescription: string;
  certificationRequired:  boolean;
  competencyVerification: boolean;
}

interface CrewRow {
  crewName:           string;
  roleTitle:          string;
  required:           boolean;
  competencyVerified: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptyStep(stepNumber: number): StepRow {
  return { stepNumber, taskStep: '', hazardDescription: '', likelihood: '', severity: '', controlsSummary: '' };
}

function highestRiskBand(rows: StepRow[]): string {
  let maxScore = 0;
  for (const r of rows) {
    const l = parseInt(r.likelihood, 10);
    const s = parseInt(r.severity, 10);
    if (!isNaN(l) && !isNaN(s)) maxScore = Math.max(maxScore, l * s);
  }
  if (maxScore === 0) return 'None';
  if (maxScore >= 17) return 'Critical';
  if (maxScore >= 10) return 'High';
  if (maxScore >= 6)  return 'Medium';
  return 'Low';
}

// ── Component ─────────────────────────────────────────────────────────────────

export function NewJsaWizard({ open, onClose, prefill }: { open: boolean; onClose: () => void; prefill?: JsaPrefill | null }): VNode | null {
  const [step,      setStep]      = useState(0);
  const [title,     setTitle]     = useState('');
  const [desc,      setDesc]      = useState('');
  const [site,      setSite]      = useState('');
  const [dept,      setDept]      = useState('');
  const [location,  setLocation]  = useState('');
  const [reviewDue, setReviewDue] = useState('');
  const [stepRows,  setStepRows]  = useState<StepRow[]>([emptyStep(1)]);
  const [ppeRows,   setPpeRows]   = useState<PpeRow[]>(
    PPE_ITEMS.map(item => ({ ppeItem: item, required: false, notes: '' })),
  );
  const [training,  setTraining]  = useState<TrainingRow[]>([]);
  const [crew,      setCrew]      = useState<CrewRow[]>([]);
  const [error,     setError]     = useState('');
  // Source RA when generated from a risk assessment + the unused suggested hazards.
  const [linkedRaId, setLinkedRaId] = useState<string | null>(null);
  const [sourceRef,  setSourceRef]  = useState<string | null>(null);
  const [suggested,  setSuggested]  = useState<JsaPrefill['suggestedHazards']>([]);

  const create = useCreateJsa();

  // Seed from a risk-assessment prefill when the wizard opens (spec §15).
  useEffect(() => {
    if (!open) return;
    if (prefill) {
      setTitle(prefill.title);
      setSite(prefill.siteId ?? '');
      setDept(prefill.departmentId ?? '');
      setLocation(prefill.locationText ?? '');
      setReviewDue(prefill.reviewDueAt ? prefill.reviewDueAt.slice(0, 10) : '');
      setLinkedRaId(prefill.linkedRiskAssessmentId);
      setSourceRef(prefill.sourceRef);
      setSuggested(prefill.suggestedHazards);
    }
  }, [open, prefill]);

  /** Add a suggested hazard from the source RA as a new (empty-task) job step. */
  function addSuggestedStep(idx: number) {
    const h = suggested[idx];
    if (!h) return;
    setStepRows(prev => [...prev, {
      stepNumber:        prev.length + 1,
      taskStep:          '',
      hazardDescription: h.description,
      likelihood:        h.initialLikelihood != null ? String(h.initialLikelihood) : '',
      severity:          h.initialSeverity   != null ? String(h.initialSeverity)   : '',
      controlsSummary:   h.notes ?? '',
    }]);
    setSuggested(prev => prev.filter((_, j) => j !== idx));
  }

  // ── Step row helpers ───────────────────────────────────────────────────────

  function addStepRow() {
    setStepRows(prev => [...prev, emptyStep(prev.length + 1)]);
  }

  function removeStepRow(i: number) {
    setStepRows(prev =>
      prev.filter((_, j) => j !== i).map((r, j) => ({ ...r, stepNumber: j + 1 })),
    );
  }

  function moveStepUp(i: number) {
    if (i === 0) return;
    setStepRows(prev => {
      const next = [...prev];
      const tmp  = next[i - 1]!;
      next[i - 1] = { ...next[i]!, stepNumber: i };
      next[i]     = { ...tmp,        stepNumber: i + 1 };
      return next;
    });
  }

  function moveStepDown(i: number) {
    setStepRows(prev => {
      if (i >= prev.length - 1) return prev;
      const next = [...prev];
      const tmp  = next[i + 1]!;
      next[i + 1] = { ...next[i]!, stepNumber: i + 2 };
      next[i]     = { ...tmp,        stepNumber: i + 1 };
      return next;
    });
  }

  function patchStep(i: number, patch: Partial<StepRow>) {
    setStepRows(prev => prev.map((r, j) => j === i ? { ...r, ...patch } : r));
  }

  // ── PPE helpers ────────────────────────────────────────────────────────────

  function togglePpe(i: number) {
    setPpeRows(prev => prev.map((r, j) => j === i ? { ...r, required: !r.required } : r));
  }

  function patchPpeNotes(i: number, notes: string) {
    setPpeRows(prev => prev.map((r, j) => j === i ? { ...r, notes } : r));
  }

  // ── Training helpers ───────────────────────────────────────────────────────

  function addTraining() {
    setTraining(prev => [...prev, { requirementDescription: '', certificationRequired: false, competencyVerification: false }]);
  }

  function removeTraining(i: number) {
    setTraining(prev => prev.filter((_, j) => j !== i));
  }

  function patchTraining(i: number, patch: Partial<TrainingRow>) {
    setTraining(prev => prev.map((r, j) => j === i ? { ...r, ...patch } : r));
  }

  // ── Crew helpers ─────────────────────────────────────────────────────────────

  function addCrew() {
    setCrew(prev => [...prev, { crewName: '', roleTitle: '', required: true, competencyVerified: false }]);
  }
  function removeCrew(i: number) {
    setCrew(prev => prev.filter((_, j) => j !== i));
  }
  function patchCrew(i: number, patch: Partial<CrewRow>) {
    setCrew(prev => prev.map((r, j) => j === i ? { ...r, ...patch } : r));
  }

  // ── Validation ─────────────────────────────────────────────────────────────

  function canAdvance(from: number): boolean {
    if (from === 0) return title.trim().length > 0;
    if (from === 1) return stepRows.some(r => r.taskStep.trim().length > 0);
    return true;
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (!title.trim()) { setError('Title is required'); return; }
    const validSteps = stepRows.filter(r => r.taskStep.trim());
    if (validSteps.length === 0) { setError('At least one job step is required'); return; }

    setError('');
    try {
      const jsaSteps: JsaStep[] = validSteps.map((r, idx) => ({
        stepNumber:         idx + 1,
        taskStep:           r.taskStep.trim(),
        hazardDescription:  r.hazardDescription.trim() || undefined,
        initialLikelihood:  r.likelihood ? parseInt(r.likelihood, 10) : undefined,
        initialSeverity:    r.severity   ? parseInt(r.severity, 10)   : undefined,
        controlsSummary:    r.controlsSummary.trim() || undefined,
      }));

      const ppeItems = ppeRows
        .filter(r => r.required)
        .map(r => ({ ppeItem: r.ppeItem, required: true, notes: r.notes.trim() || undefined }));

      const trainingLinks = training
        .filter(r => r.requirementDescription.trim())
        .map(r => ({
          requirementDescription: r.requirementDescription.trim(),
          certificationRequired:  r.certificationRequired,
          competencyVerification: r.competencyVerification,
        }));

      const crewMembers = crew
        .filter(r => r.crewName.trim())
        .map(r => ({
          crewName:           r.crewName.trim(),
          roleTitle:          r.roleTitle.trim() || undefined,
          required:           r.required,
          competencyVerified: r.competencyVerified,
        }));

      await create.mutateAsync({
        title:           title.trim(),
        description:     desc.trim() || undefined,
        siteId:          site   || null,
        departmentId:    dept   || null,
        locationText:    location.trim() || undefined,
        reviewDueAt:     reviewDue || null,
        linkedRiskAssessmentId: linkedRaId,
        steps:           jsaSteps,
        ppeItems:        ppeItems.length > 0 ? ppeItems : undefined,
        trainingLinks:   trainingLinks.length > 0 ? trainingLinks : undefined,
        crewMembers:     crewMembers.length > 0 ? crewMembers : undefined,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create JSA');
    }
  }

  const checkedPpe = ppeRows.filter(r => r.required);
  const highestRisk = highestRiskBand(stepRows);

  return (
    <Wizard
      open={open}
      title="New Job Safety Analysis"
      sub={sourceRef
        ? `Generated from risk assessment ${sourceRef} — break the work into steps and assign the suggested hazards.`
        : 'Task-based job safety analysis — job steps, hazards, controls, PPE and training requirements.'}
      icon="fa-list-ol"
      steps={[...WIZARD_STEPS]}
      step={step}
      onStepChange={setStep}
      onClose={onClose}
      onSubmit={() => { void handleSubmit(); }}
      submitLabel="Save Draft"
      submitDisabled={create.isPending}
      canAdvance={canAdvance}
      size="lg"
    >
      {/* ── Step 0: Job Details ── */}
      {step === 0 && (
        <FormGrid>
          <Field label="Job / Task Title *" wide>
            <TextInput
              value={title}
              onInput={setTitle}
              placeholder="e.g. High-pressure line maintenance"
            />
          </Field>
          <Field label="Description" wide>
            <TextareaInput
              value={desc}
              onInput={setDesc}
              placeholder="Describe the job or task being analysed…"
              rows={3}
            />
          </Field>
          <Field label="Site *">
            <SelectInput
              value={site}
              onInput={setSite}
              options={HSE_SITES}
              placeholder="Select site…"
            />
          </Field>
          <Field label="Department">
            <TextInput value={dept} onInput={setDept} placeholder="e.g. Operations" />
          </Field>
          <Field label="Location / Area">
            <TextInput value={location} onInput={setLocation} placeholder="e.g. Pump room 3" />
          </Field>
          <Field label="Review Due Date">
            <TextInput value={reviewDue} onInput={setReviewDue} type="date" />
          </Field>
        </FormGrid>
      )}

      {/* ── Step 1: Job Steps ── */}
      {step === 1 && (
        <div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
            Break the job into discrete steps. For each step, optionally add hazard details and risk scores.
          </p>

          {suggested.length > 0 && (
            <div style={{ marginBottom: '14px', padding: '12px', background: 'var(--bg-subtle, #f8fafe)', border: '1px solid var(--border)', borderRadius: '10px' }}>
              <div style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--siomac-navy)', marginBottom: '8px' }}>
                <i class="fas fa-wand-magic-sparkles" style={{ marginRight: '6px', color: 'var(--siomac-red)' }} />
                Suggested hazards from {sourceRef} — click to add as a step
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {suggested.map((h, i) => (
                  <button key={i} type="button" class="inc-action-btn" onClick={() => addSuggestedStep(i)}>
                    <i class="fas fa-plus" /> {h.description.length > 40 ? `${h.description.slice(0, 38)}…` : h.description}
                    {h.initialLikelihood != null && h.initialSeverity != null && (
                      <span style={{ marginLeft: '6px' }}><RiskScorePill likelihood={h.initialLikelihood} severity={h.initialSeverity} compact /></span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: 'grid', gap: '10px', maxHeight: '400px', overflowY: 'auto', paddingRight: '4px' }}>
            {stepRows.map((row, i) => {
              const l = row.likelihood ? parseInt(row.likelihood, 10) : 0;
              const s = row.severity   ? parseInt(row.severity, 10)   : 0;
              const showPill = l > 0 && s > 0;
              return (
                <div
                  key={i}
                  style={{
                    padding: '12px',
                    background: 'var(--surface-alt)',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 700, color: 'var(--siomac-navy)', fontSize: '0.85rem', minWidth: '20px' }}>
                      {row.stepNumber}
                    </span>
                    <div style={{ flex: 1 }}>
                      <input
                        class="ui-input"
                        placeholder="Task step description *"
                        value={row.taskStep}
                        onInput={e => patchStep(i, { taskStep: (e.target as HTMLInputElement).value })}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button
                        class="hse-btn ghost"
                        style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                        onClick={() => moveStepUp(i)}
                        disabled={i === 0}
                        title="Move up"
                      >
                        <i class="fas fa-arrow-up" />
                      </button>
                      <button
                        class="hse-btn ghost"
                        style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                        onClick={() => moveStepDown(i)}
                        disabled={i === stepRows.length - 1}
                        title="Move down"
                      >
                        <i class="fas fa-arrow-down" />
                      </button>
                      <button
                        class="hse-btn ghost"
                        style={{ padding: '4px 8px', fontSize: '0.75rem', color: 'var(--color-danger)' }}
                        onClick={() => removeStepRow(i)}
                        disabled={stepRows.length === 1}
                        title="Remove step"
                      >
                        <i class="fas fa-trash" />
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <input
                      class="ui-input"
                      placeholder="Hazard description (optional)"
                      value={row.hazardDescription}
                      onInput={e => patchStep(i, { hazardDescription: (e.target as HTMLInputElement).value })}
                    />
                    <input
                      class="ui-input"
                      placeholder="Controls summary (optional)"
                      value={row.controlsSummary}
                      onInput={e => patchStep(i, { controlsSummary: (e.target as HTMLInputElement).value })}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <select
                        class="ui-select"
                        value={row.likelihood}
                        onChange={e => patchStep(i, { likelihood: (e.target as HTMLSelectElement).value })}
                        style={{ flex: 1 }}
                        title="Likelihood"
                      >
                        <option value="">L (optional)</option>
                        {SCALE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <select
                        class="ui-select"
                        value={row.severity}
                        onChange={e => patchStep(i, { severity: (e.target as HTMLSelectElement).value })}
                        style={{ flex: 1 }}
                        title="Severity"
                      >
                        <option value="">S (optional)</option>
                        {SCALE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      {showPill && <RiskScorePill likelihood={l} severity={s} />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <button
            class="hse-btn secondary"
            style={{ marginTop: '12px', width: '100%' }}
            onClick={addStepRow}
          >
            <i class="fas fa-plus" /> Add Step
          </button>
        </div>
      )}

      {/* ── Step 2: PPE ── */}
      {step === 2 && (
        <div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
            Select all PPE required for this job. Add notes where needed.
          </p>
          <div style={{ display: 'grid', gap: '8px' }}>
            {ppeRows.map((row, i) => (
              <label
                key={row.ppeItem}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '24px 1fr auto',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 12px',
                  border: `2px solid ${row.required ? 'var(--siomac-navy)' : 'var(--border)'}`,
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '0.82rem',
                  transition: 'border-color .15s',
                  background: row.required ? 'var(--surface-alt)' : 'transparent',
                }}
              >
                <input
                  type="checkbox"
                  checked={row.required}
                  onChange={() => togglePpe(i)}
                  style={{ accentColor: 'var(--siomac-navy)', width: '16px', height: '16px' }}
                />
                <span style={{ fontWeight: row.required ? 600 : 400 }}>{row.ppeItem}</span>
                {row.required && (
                  <input
                    class="ui-input"
                    style={{ width: '160px', fontSize: '0.75rem' }}
                    placeholder="Notes…"
                    value={row.notes}
                    onInput={e => patchPpeNotes(i, (e.target as HTMLInputElement).value)}
                    onClick={e => e.stopPropagation()}
                  />
                )}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* ── Step 3: Training ── */}
      {step === 3 && (
        <div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
            Add any training requirements for personnel performing this job.
          </p>
          <div style={{ display: 'grid', gap: '10px', marginBottom: '12px' }}>
            {training.map((row, i) => (
              <div
                key={i}
                style={{
                  padding: '12px',
                  background: 'var(--surface-alt)',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  display: 'grid',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                  <input
                    class="ui-input"
                    style={{ flex: 1 }}
                    placeholder="Training requirement description *"
                    value={row.requirementDescription}
                    onInput={e => patchTraining(i, { requirementDescription: (e.target as HTMLInputElement).value })}
                  />
                  <button
                    class="hse-btn ghost"
                    style={{ padding: '6px 10px', color: 'var(--color-danger)', flexShrink: 0 }}
                    onClick={() => removeTraining(i)}
                    title="Remove"
                  >
                    <i class="fas fa-trash" />
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '16px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={row.certificationRequired}
                      onChange={e => patchTraining(i, { certificationRequired: (e.target as HTMLInputElement).checked })}
                      style={{ accentColor: 'var(--siomac-navy)' }}
                    />
                    Certification required
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={row.competencyVerification}
                      onChange={e => patchTraining(i, { competencyVerification: (e.target as HTMLInputElement).checked })}
                      style={{ accentColor: 'var(--siomac-navy)' }}
                    />
                    Competency verification
                  </label>
                </div>
              </div>
            ))}
            {training.length === 0 && (
              <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px 0', fontSize: '0.8rem' }}>
                No training requirements added
              </p>
            )}
          </div>
          <button class="hse-btn secondary" style={{ width: '100%' }} onClick={addTraining}>
            <i class="fas fa-plus" /> Add Training Requirement
          </button>
        </div>
      )}

      {/* ── Step 4: Crew ── */}
      {step === 4 && (
        <div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
            List the crew. Every <strong>required</strong> member must acknowledge the JSA before it can be activated;
            unverified competency blocks activation unless overridden.
          </p>
          <div style={{ display: 'grid', gap: '8px', maxHeight: '380px', overflowY: 'auto', paddingRight: '4px' }}>
            {crew.length === 0 && (
              <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', padding: '12px 0' }}>
                No crew added yet.
              </p>
            )}
            {crew.map((r, i) => (
              <div key={i} style={{ padding: '10px 12px', background: 'var(--surface-alt)', border: '1px solid var(--border)', borderRadius: '8px' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <TextInput value={r.crewName} onInput={v => patchCrew(i, { crewName: v })} placeholder="Crew member name" />
                  <TextInput value={r.roleTitle} onInput={v => patchCrew(i, { roleTitle: v })} placeholder="Role (e.g. Technician)" />
                  <button class="hse-btn-icon-remove" onClick={() => removeCrew(i)} aria-label="Remove"><i class="fas fa-trash" /></button>
                </div>
                <div style={{ display: 'flex', gap: '18px', marginTop: '8px', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={r.required} onChange={() => patchCrew(i, { required: !r.required })} /> Required
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={r.competencyVerified} onChange={() => patchCrew(i, { competencyVerified: !r.competencyVerified })} /> Competency verified
                  </label>
                </div>
              </div>
            ))}
          </div>
          <button class="hse-btn secondary" style={{ width: '100%', marginTop: '10px' }} onClick={addCrew}>
            <i class="fas fa-user-plus" /> Add Crew Member
          </button>
        </div>
      )}

      {/* ── Step 5: Review & Submit ── */}
      {step === 5 && (
        <div style={{ display: 'grid', gap: '12px' }}>
          <div
            style={{
              padding: '14px 16px',
              background: 'var(--surface-alt)',
              borderRadius: '8px',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: '10px', fontSize: '0.85rem' }}>JSA Summary</div>
            <div style={{ display: 'grid', gap: '8px', fontSize: '0.82rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '4px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Title</span>
                <strong>{title}</strong>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '4px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Site</span>
                <span>{site || 'Not specified'}</span>
              </div>
              {location && (
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '4px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Location</span>
                  <span>{location}</span>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '4px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Steps</span>
                <span>{stepRows.filter(r => r.taskStep.trim()).length} documented</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '4px', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)' }}>Highest Risk</span>
                <span>{highestRisk}</span>
              </div>
              {checkedPpe.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '4px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>PPE</span>
                  <span>{checkedPpe.map(r => r.ppeItem).join(', ')}</span>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '4px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Training</span>
                <span>{training.filter(r => r.requirementDescription.trim()).length} requirement(s)</span>
              </div>
              {reviewDue && (
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '4px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Review Due</span>
                  <span>{new Date(reviewDue).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          </div>
          {error && (
            <p style={{ color: 'var(--color-danger)', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <i class="fas fa-exclamation-triangle" /> {error}
            </p>
          )}
        </div>
      )}
    </Wizard>
  );
}
