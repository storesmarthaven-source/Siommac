/**
 * src/components/sections/HSE/risk-jsa/shared/RiskMatrixSnapshot.tsx
 *
 * A compact before/after risk view: initial risk → residual risk + the % risk
 * reduction. Used in assessment/hazard drawers and as an insight-card variant.
 */

import { type VNode } from 'preact';
import { RiskScorePill } from './RiskScorePill';

export interface RiskMatrixSnapshotProps {
  initialScore: number;
  residualScore?: number | null;
}

export function RiskMatrixSnapshot({ initialScore, residualScore }: RiskMatrixSnapshotProps): VNode {
  const residual = residualScore ?? initialScore;
  const reduction = initialScore > 0 ? Math.round(((initialScore - residual) / initialScore) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '4px' }}>Before</div>
        <RiskScorePill score={initialScore} />
      </div>
      <i class="fas fa-arrow-right" style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '4px' }}>After</div>
        <RiskScorePill score={residual} />
      </div>
      <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: reduction > 0 ? '#16a34a' : 'var(--text-muted)', lineHeight: 1 }}>{reduction}%</div>
        <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)' }}>reduction</div>
      </div>
    </div>
  );
}
