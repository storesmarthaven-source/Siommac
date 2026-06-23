/**
 * src/components/sections/HSE/risk-jsa/dialogs/GenerateJsaDialog.tsx
 *
 * "Generate JSA from Risk Assessment" (spec §15). Pick an approved/active risk
 * assessment; on confirm we fetch its prefill (header + suggested hazards) and
 * hand it to the JSA wizard, which finalises the job-step breakdown.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { Modal, Field, SelectInput } from '@ui';
import { useAssessments, useGenerateJsaFromAssessment, type JsaPrefill } from '@api/hse/riskJsa';
import { RiskScorePill } from '../shared/RiskScorePill';

export function GenerateJsaDialog({ open, onClose, onGenerated }: {
  open: boolean;
  onClose: () => void;
  onGenerated: (prefill: JsaPrefill) => void;
}): VNode {
  const { data, isLoading } = useAssessments({});
  const assessments = data?.data ?? [];
  const generate = useGenerateJsaFromAssessment();
  const [raId, setRaId] = useState('');
  const [error, setError] = useState('');

  const selected = assessments.find(a => a.id === raId) ?? null;

  async function handleGenerate() {
    if (!raId) { setError('Select a risk assessment'); return; }
    setError('');
    try {
      const res = await generate.mutateAsync(raId);
      onGenerated(res.data);
      setRaId('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate JSA');
    }
  }

  return (
    <Modal
      open={open}
      title="Generate JSA from Risk Assessment"
      sub="Carry the assessment's scope and hazards into a new JSA draft."
      icon="fa-wand-magic-sparkles"
      onClose={() => { setRaId(''); setError(''); onClose(); }}
      onSubmit={() => { void handleGenerate(); }}
      submitLabel={generate.isPending ? 'Generating…' : 'Generate JSA'}
      submitDisabled={generate.isPending || !raId}
    >
      <Field label="Source Risk Assessment *" wide>
        <SelectInput
          value={raId}
          onInput={setRaId}
          placeholder={isLoading ? 'Loading assessments…' : 'Select an assessment…'}
          options={assessments.map(a => ({ value: a.id, label: `${a.ref} — ${a.title}` }))}
        />
      </Field>

      {selected && (
        <div style={{ marginTop: '14px', padding: '12px', background: 'var(--bg-subtle, #f8fafe)', border: '1px solid var(--border)', borderRadius: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
            <div style={{ fontWeight: 600, color: 'var(--siomac-navy)', fontSize: '0.86rem' }}>{selected.title}</div>
            <RiskScorePill level={selected.risk_level} hideScore />
          </div>
          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            {selected.assessment_type} · {selected.site_id ?? selected.location_text ?? 'No site'} · status {selected.status.replace(/_/g, ' ')}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '8px' }}>
            <i class="fas fa-circle-info" style={{ marginRight: '6px' }} />
            Its hazards become suggested steps you can drop into the JSA's job breakdown.
          </div>
        </div>
      )}

      {error && <div style={{ marginTop: '10px', color: 'var(--siomac-red)', fontSize: '0.78rem' }}>{error}</div>}
    </Modal>
  );
}
