/**
 * src/components/sections/HSE/risk-jsa/shared/RiskMiniBar.tsx
 *
 * A compact low/medium/high/critical distribution bar — shows the spread of risk
 * without a full chart. Used inside insight cards and table cells.
 */

import { type VNode } from 'preact';

export interface RiskMiniBarProps {
  low?: number;
  medium?: number;
  high?: number;
  critical?: number;
  /** Show the numeric legend beneath the bar. */
  legend?: boolean;
}

const SEGMENTS = [
  { key: 'critical', color: '#dc2626', label: 'Critical' },
  { key: 'high',     color: '#ef4444', label: 'High' },
  { key: 'medium',   color: '#f59e0b', label: 'Medium' },
  { key: 'low',      color: '#16a34a', label: 'Low' },
] as const;

export function RiskMiniBar({ low = 0, medium = 0, high = 0, critical = 0, legend }: RiskMiniBarProps): VNode {
  const counts: Record<string, number> = { low, medium, high, critical };
  const total = low + medium + high + critical;
  return (
    <div>
      <div style={{ display: 'flex', height: '8px', borderRadius: '99px', overflow: 'hidden', gap: total > 0 ? '2px' : 0, background: total > 0 ? 'transparent' : 'var(--border)' }}>
        {SEGMENTS.map(s => {
          const v = counts[s.key] ?? 0;
          return v > 0 ? <div key={s.key} style={{ flex: v, background: s.color }} title={`${s.label}: ${v}`} /> : null;
        })}
      </div>
      {legend && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: '8px' }}>
          {SEGMENTS.slice().reverse().map(s => {
            const v = counts[s.key] ?? 0;
            return (
              <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.66rem', color: 'var(--text-muted)' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: s.color, flexShrink: 0 }} />
                {v} {s.label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
