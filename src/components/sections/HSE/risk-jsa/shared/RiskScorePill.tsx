/**
 * src/components/sections/HSE/risk-jsa/shared/RiskScorePill.tsx
 *
 * The canonical risk-score pill + band helpers, shared by every Risk & JSA form,
 * dialog and drawer. Band thresholds follow the spec:
 *   1–5 Low · 6–9 Medium · 10–16 High · 17–25 Critical
 */

import { type VNode } from 'preact';

export type RiskBand = 'low' | 'medium' | 'high' | 'critical';

export function calculateRiskScore(likelihood: number, severity: number): number {
  return likelihood * severity;
}

export function calculateRiskBand(score: number): RiskBand {
  if (score <= 5) return 'low';
  if (score <= 9) return 'medium';
  if (score <= 16) return 'high';
  return 'critical';
}

const BAND_PILL: Record<RiskBand, string> = {
  low: 'is-on', medium: 'is-amber', high: 'is-warn', critical: 'is-off',
};
const BAND_LABEL: Record<RiskBand, string> = {
  low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical',
};

export interface RiskScorePillProps {
  /** Provide either likelihood+severity, or an explicit score. */
  likelihood?: number;
  severity?: number;
  score?: number;
  band?: RiskBand;
  /** Hide the numeric score (show band only). */
  hideScore?: boolean;
}

export function RiskScorePill({ likelihood, severity, score, band, hideScore }: RiskScorePillProps): VNode {
  const s = score ?? (likelihood != null && severity != null ? likelihood * severity : 0);
  const b = band ?? calculateRiskBand(s);
  return (
    <span class={`vt-pill ${BAND_PILL[b]}`}>
      {BAND_LABEL[b]}{!hideScore && s > 0 ? ` · ${s}` : ''}
    </span>
  );
}
