/**
 * src/ui/charts/ProgressBar.tsx
 *
 * A standalone horizontal progress bar with an optional 0% / target / 100%
 * label row. Same visual as the progress variant inside `SparkCard`.
 */

import { type VNode } from 'preact';

export interface ProgressBarProps {
  pct: number;
  color?: string;
  /** Optional centre label (e.g. "Target: 80%"). Shows the 0/target/100 row. */
  target?: string;
}

export function ProgressBar({ pct, color = '#22c55e', target }: ProgressBarProps): VNode {
  return (
    <>
      <div class="hse-spark-bar-track" style={{ marginTop: '4px' }}>
        <div class="hse-spark-bar-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
      </div>
      {target && (
        <div class="sc-progress-labels">
          <span>0%</span>
          <span style={{ color, fontWeight: 600 }}>{target}</span>
          <span>100%</span>
        </div>
      )}
    </>
  );
}
