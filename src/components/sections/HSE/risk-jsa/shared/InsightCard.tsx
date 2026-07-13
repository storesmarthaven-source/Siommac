/**
 * src/components/sections/HSE/risk-jsa/shared/InsightCard.tsx
 *
 * The reusable operational insight card for the Risk & JSA page (and reusable
 * elsewhere). One shell (the @ui Card), MANY layouts — the `variant` controls the
 * visual so the four cards on each tab look distinct, not generic:
 *   donut · bar · progress · queue · sparkline · matrix · status-grid
 *
 * Header (icon + title) → big value + subtitle → variant visual → footer/action.
 */

import { type VNode } from 'preact';
import { Card, Sparkline, BarRow, ProgressBar } from '@ui';
import { RiskMatrixSnapshot } from './RiskMatrixSnapshot';
import { QueueItem } from './QueueItem';

export type InsightCardVariant = 'donut' | 'bar' | 'progress' | 'queue' | 'sparkline' | 'matrix' | 'status-grid';
export type InsightTone = 'neutral' | 'navy' | 'danger' | 'warning' | 'success';

export interface InsightCardProps {
  title: string;
  icon: string;
  value: string | number;
  subtitle?: string;
  footer?: VNode | string;
  variant: InsightCardVariant;
  tone?: InsightTone;
  data?: unknown;
  actionLabel?: string;
  onAction?: () => void;
}

const TONE_VALUE: Record<InsightTone, string> = {
  neutral: 'var(--siomac-navy)', navy: '#fff',
  danger: '#dc2626', warning: '#b45309', success: '#16a34a',
};

function Donut({ segments, navy }: { segments: { value: number; color: string }[]; navy?: boolean }): VNode {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const R = 30, C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <svg width="72" height="72" viewBox="0 0 72 72">
      <circle cx="36" cy="36" r={R} fill="none" stroke={navy ? 'rgba(255,255,255,.12)' : '#eef0f5'} stroke-width="10" />
      {segments.filter(s => s.value > 0).map((s, i) => {
        const len = (s.value / total) * C;
        const dash = `${len} ${C - len}`;
        const rot = (offset / total) * 360 - 90;
        offset += s.value;
        return <circle key={i} cx="36" cy="36" r={R} fill="none" stroke={s.color} stroke-width="10" stroke-dasharray={dash} transform={`rotate(${rot} 36 36)`} />;
      })}
    </svg>
  );
}

function Visual({ variant, data, navy }: { variant: InsightCardVariant; data: unknown; navy: boolean }): VNode | null {
  const d = (data ?? {}) as Record<string, unknown>;
  switch (variant) {
    case 'donut':
      return <Donut navy={navy} segments={(d.segments as { value: number; color: string }[]) ?? []} />;
    case 'bar':
      return (
        <div style={{ display: 'grid', gap: '8px', width: '100%' }}>
          {((d.bars as { label: string; value: number; max?: number; color?: string }[]) ?? []).slice(0, 4).map((b, i) => (
            <BarRow key={i} label={b.label} value={b.value} max={b.max ?? Math.max(...(((d.bars as { value: number }[]) ?? []).map(x => x.value)), 1)} color={b.color} />
          ))}
        </div>
      );
    case 'progress':
      return <ProgressBar pct={Number(d.pct ?? 0)} color={(d.color as string) ?? '#22c55e'} target={d.target as string} />;
    case 'sparkline':
      return <Sparkline points={(d.points as number[]) ?? []} color={(d.color as string) ?? '#60a5fa'} />;
    case 'matrix':
      return <RiskMatrixSnapshot initialScore={Number(d.initial ?? 0)} residualScore={d.residual as number | undefined} />;
    case 'queue':
      return (
        <div style={{ display: 'grid', gap: '6px', width: '100%' }}>
          {((d.items as { ref?: string; title: string; tag?: string; tagTone?: 'danger' | 'warning' | 'info' | 'neutral' }[]) ?? []).slice(0, 2).map((it, i) => (
            <QueueItem key={i} ref={it.ref} title={it.title} tag={it.tag} tagTone={it.tagTone} onDark={navy} />
          ))}
        </div>
      );
    case 'status-grid':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px', width: '100%' }}>
          {((d.tiles as { value: number | string; label: string; tone?: string }[]) ?? []).slice(0, 4).map((t, i) => (
            <div key={i} style={{ padding: '8px', borderRadius: '8px', textAlign: 'center', background: navy ? 'rgba(255,255,255,.07)' : 'var(--bg-subtle)' }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 600, lineHeight: 1, color: t.tone ?? (navy ? '#fff' : 'var(--siomac-navy)') }}>{t.value}</div>
              <div style={{ fontSize: '0.56rem', color: navy ? 'rgba(255,255,255,.45)' : 'var(--text-muted)', marginTop: '3px' }}>{t.label}</div>
            </div>
          ))}
        </div>
      );
    default:
      return null;
  }
}

export function InsightCard({ title, icon, value, subtitle, footer, variant, tone = 'neutral', data, actionLabel, onAction }: InsightCardProps): VNode {
  const navy = tone === 'navy';
  const isDonut = variant === 'donut';
  return (
    <Card icon={icon} title={title} variant={navy ? 'navy' : 'default'} bodyStyle={{ display: 'flex', flexDirection: 'column', gap: '12px', minHeight: '120px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '1.8rem', fontWeight: 600, lineHeight: 1, letterSpacing: '-0.02em', color: TONE_VALUE[tone] }}>{value}</div>
          {subtitle && <div style={{ fontSize: '0.68rem', color: navy ? 'rgba(255,255,255,.55)' : 'var(--text-muted)', marginTop: '5px', lineHeight: 1.4 }}>{subtitle}</div>}
        </div>
        {isDonut && <Visual variant="donut" data={data} navy={navy} />}
      </div>

      {!isDonut && <Visual variant={variant} data={data} navy={navy} />}

      {(footer ?? actionLabel) && (
        <div style={{ marginTop: 'auto', paddingTop: '4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', fontSize: '0.66rem', color: navy ? 'rgba(255,255,255,.5)' : 'var(--text-muted)' }}>
          <span>{footer}</span>
          {actionLabel && onAction && (
            <button type="button" onClick={onAction} style={{ background: 'none', border: 'none', cursor: 'pointer', color: navy ? '#93c5fd' : 'var(--siomac-navy)', fontWeight: 'var(--font-weight-bold)', fontSize: '0.66rem', whiteSpace: 'nowrap' }}>
              {actionLabel} <i class="fas fa-arrow-right" style={{ fontSize: '0.56rem' }} />
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
