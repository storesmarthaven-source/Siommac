/**
 * src/components/sections/HSE/risk-jsa/shared/RiskMatrixPicker.tsx
 *
 * The shared 5×5 likelihood × severity matrix picker, used in every create flow
 * (New Hazard, New Assessment, New JSA). Click a cell to set likelihood +
 * severity; the selected cell is highlighted and the derived band/score shows
 * below. Read-only mode just renders the matrix with the current cell marked.
 */

import { type VNode } from 'preact';
import { calculateRiskBand, type RiskBand } from './RiskScorePill';

const SCALE = [1, 2, 3, 4, 5] as const;

const LIKELIHOOD_LABELS = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost Certain'];
const SEVERITY_LABELS   = ['Insignificant', 'Minor', 'Moderate', 'Major', 'Catastrophic'];

const BAND_BG: Record<RiskBand, string> = {
  low:      'rgba(22,163,74,.14)',
  medium:   'rgba(245,158,11,.16)',
  high:     'rgba(239,68,68,.16)',
  critical: 'rgba(220,38,38,.26)',
};
const BAND_TEXT: Record<RiskBand, string> = {
  low: '#15803d', medium: '#b45309', high: '#b91c1c', critical: '#7f1d1d',
};

export interface RiskMatrixPickerProps {
  likelihood: number;
  severity: number;
  onChange?: (likelihood: number, severity: number) => void;
  /** Read-only: render the matrix with the cell marked but not editable. */
  readonly?: boolean;
}

export function RiskMatrixPicker({ likelihood, severity, onChange, readonly }: RiskMatrixPickerProps): VNode {
  const cell = (l: number, s: number): VNode => {
    const score = l * s;
    const band = calculateRiskBand(score);
    const selected = l === likelihood && s === severity;
    return (
      <button
        key={`${l}-${s}`}
        type="button"
        disabled={readonly}
        onClick={() => onChange?.(l, s)}
        title={`L${l} × S${s} = ${score} (${band})`}
        style={{
          aspectRatio: '1', minWidth: '34px', border: selected ? '2px solid var(--siomac-navy)' : '1px solid var(--border)',
          borderRadius: 'var(--radius-xs)', background: BAND_BG[band], color: BAND_TEXT[band],
          fontWeight: selected ? 800 : 600, fontSize: '0.72rem', cursor: readonly ? 'default' : 'pointer',
          display: 'grid', placeItems: 'center', boxShadow: selected ? '0 0 0 3px rgba(27,45,84,.12)' : undefined,
          transition: 'border-color .12s, box-shadow .12s',
        }}
      >
        {score}
      </button>
    );
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto repeat(5, 1fr)', gap: '4px', alignItems: 'center' }}>
        <div />
        {SCALE.map(s => (
          <div key={`sh${s}`} style={{ textAlign: 'center', fontSize: '0.58rem', color: 'var(--text-muted)', fontWeight: 700 }}>{s}</div>
        ))}
        {[...SCALE].reverse().map(l => (
          <>
            <div key={`lh${l}`} style={{ fontSize: '0.58rem', color: 'var(--text-muted)', fontWeight: 700, textAlign: 'right', paddingRight: '6px' }}>{l}</div>
            {SCALE.map(s => cell(l, s))}
          </>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '0.6rem', color: 'var(--text-muted)' }}>
        <span>↑ Likelihood: {LIKELIHOOD_LABELS[likelihood - 1] ?? ''}</span>
        <span>Severity →: {SEVERITY_LABELS[severity - 1] ?? ''}</span>
      </div>
    </div>
  );
}
