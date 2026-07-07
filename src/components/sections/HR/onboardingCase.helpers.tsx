/**
 * src/components/sections/HR/onboardingCase.helpers.tsx
 *
 * Shared logic + tiny self-contained chart primitives for the onboarding case-detail
 * page — task matchers, status buckets, date math, and the SVG viz (sparkline / progress
 * ring / gauge arc / bars). No fabricated data: callers pass real values. (The case KPI/chart
 * widgets that also used these were removed when the widget catalogue was cleared for the v2
 * rebuild; the primitives stay for when they're re-authored.)
 */
import { type VNode } from 'preact';
import type { OnboardingCaseStatus, OnboardingTaskRow } from '../../../../types/hrOnboarding';

// ── stage tracker ────────────────────────────────────────────────────────────────
export const STAGE_NAMES = ['Created', 'Documents', 'IT Setup', 'Training', 'Approvals', 'Activation', 'Complete'];

export const STAGE_RANK: Record<OnboardingCaseStatus, number> = {
  draft: 0, open: 0, in_progress: 1, blocked: 1, paused: 1,
  ready_for_activation: 5, completed: 6, cancelled: 6,
};

// ── small data helpers ───────────────────────────────────────────────────────────
export const initials = (n: string | null | undefined): string =>
  (n ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map(s => (s[0] ?? '').toUpperCase()).join('') || '?';

export const pctOf = (num: number, den: number): number => (den > 0 ? Math.round((num / den) * 100) : 0);

export const daysUntil = (iso: string | null | undefined): number | null =>
  iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000) : null;

export const isOpen = (s: string): boolean => !['completed', 'cancelled', 'skipped'].includes(s);

// ── task keyword matchers (derived metric categories) ─────────────────────────────
const txt = (t: OnboardingTaskRow): string =>
  `${t.moduleKey ?? ''} ${t.ownerRole ?? ''} ${t.taskTitle}`.toLowerCase();

export const matchDocs = (t: OnboardingTaskRow): boolean =>
  /doc|policy|agreement|consent|form|i-9|w-4|handbook|acknowledg|tax|deposit|offer letter/.test(txt(t));
export const matchTraining = (t: OnboardingTaskRow): boolean =>
  /train|course|induction|learn|orientation/.test(txt(t));
export const matchProvision = (t: OnboardingTaskRow): boolean =>
  /account|email|provision|mailbox|365|\bad\b|login|credential/.test(txt(t));
export const matchIT = (t: OnboardingTaskRow): boolean =>
  /\bit\b|access|equipment|laptop|hardware|system|device|software|badge/.test(txt(t));

export interface StatusBucket { done: number; prog: number; fail: number; none: number; total: number }
export function bucket(rows: { status: string }[]): StatusBucket {
  const b: StatusBucket = { done: 0, prog: 0, fail: 0, none: 0, total: rows.length };
  for (const r of rows) {
    if (['completed', 'delivered', 'accepted', 'received'].includes(r.status)) b.done++;
    else if (['in_progress', 'sent', 'acknowledged'].includes(r.status)) b.prog++;
    else if (['blocked', 'failed', 'escalated'].includes(r.status)) b.fail++;
    else b.none++;
  }
  return b;
}

export const pctChange = (pts: number[]): number => {
  const first = pts[0], last = pts[pts.length - 1];
  if (first === undefined || last === undefined || first === 0) return 0;
  return Math.round(((last - first) / first) * 1000) / 10;
};

// ── sparkline (area + line) ──────────────────────────────────────────────────────
function sparkPath(points: number[], w = 120, h = 56, pad = 5): { line: string; area: string } {
  if (points.length < 2) return { line: '', area: '' };
  const min = Math.min(...points), max = Math.max(...points), span = max - min || 1;
  const stepX = (w - pad * 2) / (points.length - 1);
  const xy = points.map((p, i) => [pad + i * stepX, pad + (h - pad * 2) * (1 - (p - min) / span)] as const);
  const first = xy[0]!, last = xy[xy.length - 1]!;
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${last[0].toFixed(1)} ${h} L${first[0].toFixed(1)} ${h} Z`;
  return { line, area };
}

export function Spark({ points, color }: { points: number[]; color: string }): VNode {
  const { line, area } = sparkPath(points);
  const gid = `ocwspark-${color.replace('#', '')}`;
  return (
    <div class="ocw-spark">
      <svg viewBox="0 0 120 56" preserveAspectRatio="none">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop stop-color={color} stop-opacity=".22" /><stop offset="1" stop-color={color} stop-opacity="0" />
          </linearGradient>
        </defs>
        {line && <path d={area} fill={`url(#${gid})`} />}
        {line && <path d={line} fill="none" stroke={color} stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />}
      </svg>
    </div>
  );
}

// ── circular progress ring (with optional centre content) ─────────────────────────
export function Ring(
  { percent, color, size = 96, track = '#eaf0f7', children }:
  { percent: number; color: string; size?: number; track?: string; children?: VNode | VNode[] },
): VNode {
  const r = 38, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, percent));
  const dash = (p / 100) * c;
  return (
    <div class="ocw-ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} fill="none" stroke={track} stroke-width="10" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={color} stroke-width="10" stroke-linecap="round"
          stroke-dasharray={`${dash.toFixed(1)} ${(c - dash).toFixed(1)}`} transform="rotate(-90 50 50)" />
      </svg>
      <div class="ocw-ring-mid">{children}</div>
    </div>
  );
}

// ── 180° gauge arc (value 0-100), gradient track + colored progress ──────────────
export function GaugeArc({ percent, color }: { percent: number; color: string }): VNode {
  const p = Math.max(0, Math.min(100, percent));
  // semicircle path from (10,90) to (190,90), radius 90
  const a = Math.PI * (1 - p / 100);
  const x = 100 + 90 * Math.cos(a), y = 90 - 90 * Math.sin(a);
  const big = p > 50 ? 1 : 0;
  return (
    <div class="ocw-gauge">
      <svg viewBox="0 0 200 104" preserveAspectRatio="xMidYMid meet">
        <path d="M10 90 A90 90 0 0 1 190 90" fill="none" stroke="#eaf0f7" stroke-width="14" stroke-linecap="round" />
        <path d={`M10 90 A90 90 0 ${big} 1 ${x.toFixed(1)} ${y.toFixed(1)}`} fill="none" stroke={color} stroke-width="14" stroke-linecap="round" />
        <circle cx={x.toFixed(1)} cy={y.toFixed(1)} r="9" fill="#fff" stroke={color} stroke-width="5" />
      </svg>
    </div>
  );
}

// ── vertical bars (Workout-style) ────────────────────────────────────────────────
export function Bars({ values, color }: { values: number[]; color: string }): VNode {
  const max = Math.max(1, ...values);
  return (
    <div class="ocw-bars">
      {values.map((v, i) => (
        <i key={i} style={{ height: `${Math.max(6, Math.round((v / max) * 100))}%`, background: color }}>
          <b>{v}</b>
        </i>
      ))}
    </div>
  );
}
