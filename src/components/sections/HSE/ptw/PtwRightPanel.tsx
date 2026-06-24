/**
 * src/components/sections/HSE/ptw/PtwRightPanel.tsx
 *
 * The navy signals right-rail for Permit to Work — the restored "navy blue nav
 * bar" from the original PTW design, rebuilt LIVE on the real permit list (the
 * old one was a static mock). Uses the standard HSE `ppe-signals-panel` look,
 * mirroring RiskJsaRightPanel. Clicking a signal opens that permit's drawer.
 *
 * Sections: Awaiting Approval · Expiring Soon · Suspended / Blocked.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { usePermits, type PermitListRow } from '@api/hse/ptw';

const ACTIVE = new Set(['active', 'approved']);
function hoursUntil(iso?: string | null): number | null {
  if (!iso) return null;
  return (new Date(iso).getTime() - Date.now()) / 3_600_000;
}
const typeLabel = (t: string) => t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

type IconTone = 'is-danger' | 'is-warn' | 'is-ok' | 'is-info';
type TagTone  = 'is-high' | 'is-due' | 'is-ok' | 'is-info';

function Signal({ icon, iconTone, title, sub, tag, tagTone, onClick }: {
  icon: string; iconTone: IconTone; title: string; sub: string; tag: string; tagTone: TagTone; onClick: () => void;
}): VNode {
  return (
    <div class="ppe-signal" onClick={onClick}>
      <i class={`fas ${icon} ${iconTone}`} />
      <div class="ppe-signal-text">
        <strong>{title}</strong>
        <span>{sub}</span>
      </div>
      <span class={`ppe-signal-tag ${tagTone}`}>{tag}</span>
    </div>
  );
}

function Section({ icon, title, count, empty, children }: {
  icon: string; title: string; count: number; empty: string; children: ComponentChildren;
}): VNode {
  return (
    <>
      <h4><i class={`fas ${icon}`} /> {title}{count > 0 ? ` · ${count}` : ''}</h4>
      <div class="ppe-signals-list">
        {count > 0 ? children : <div class="ppe-signal-empty">{empty}</div>}
      </div>
    </>
  );
}

/** Shared signal groups used by every PTW signals layout variant. */
export function usePtwSignals() {
  const all = usePermits({}).data?.data ?? [];
  const awaiting  = all.filter(p => p.status === 'awaiting_approval');
  const expiring  = all.filter(p => { if (!ACTIVE.has(p.status)) return false; const h = hoursUntil(p.end_datetime); return h !== null && h >= 0 && h <= 8; })
                       .sort((a, b) => (hoursUntil(a.end_datetime) ?? 0) - (hoursUntil(b.end_datetime) ?? 0));
  const suspended = all.filter(p => p.status === 'suspended');
  return { awaiting, expiring, suspended };
}

export function PtwRightPanel({ onOpenPermit }: { onOpenPermit: (p: PermitListRow) => void }): VNode {
  const { awaiting, expiring, suspended } = usePtwSignals();

  return (
    <aside class="ppe-signals-panel">
      <Section icon="fa-clipboard-check" title="Awaiting Approval" count={awaiting.length} empty="Approval queue is clear">
        {awaiting.slice(0, 5).map(p => (
          <Signal key={p.id} icon="fa-clipboard-check" iconTone="is-info"
            title={`${p.permit_number ?? '—'} · ${typeLabel(p.permit_type)}`} sub={p.title}
            tag="Review" tagTone="is-info" onClick={() => onOpenPermit(p)} />
        ))}
      </Section>

      <div class="hse-panel-divider" />

      <Section icon="fa-clock" title="Expiring Soon" count={expiring.length} empty="None expiring within 8h">
        {expiring.slice(0, 4).map(p => {
          const h = Math.max(0, Math.round(hoursUntil(p.end_datetime) ?? 0));
          const crit = (hoursUntil(p.end_datetime) ?? 99) <= 2;
          return <Signal key={p.id} icon="fa-clock" iconTone={crit ? 'is-danger' : 'is-warn'}
            title={p.permit_number ?? p.title} sub={p.title}
            tag={`${h}h`} tagTone={crit ? 'is-high' : 'is-due'} onClick={() => onOpenPermit(p)} />;
        })}
      </Section>

      <div class="hse-panel-divider" />

      <Section icon="fa-circle-pause" title="Suspended / Blocked" count={suspended.length} empty="No suspended permits">
        {suspended.slice(0, 4).map(p => (
          <Signal key={p.id} icon="fa-circle-pause" iconTone="is-warn"
            title={p.permit_number ?? p.title} sub={p.title}
            tag="Suspended" tagTone="is-due" onClick={() => onOpenPermit(p)} />
        ))}
      </Section>
    </aside>
  );
}

// ── Option A: horizontal triage strip (full-width, above the register) ──────────

function GroupCard({ icon, accent, label, items, empty, onOpenPermit }: {
  icon: string; accent: string; label: string; items: PermitListRow[]; empty: string;
  onOpenPermit: (p: PermitListRow) => void;
}): VNode {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderLeft: `3px solid ${accent}`,
      borderRadius: '0 12px 12px 0', padding: '11px 13px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <i class={`fas ${icon}`} style={{ color: accent, fontSize: '0.85rem' }} />
        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--siomac-navy)' }}>{label}</span>
        <span style={{ marginLeft: 'auto', fontSize: '1.05rem', fontWeight: 800, color: items.length ? accent : 'var(--text-muted)' }}>{items.length}</span>
      </div>
      {items.length === 0
        ? <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{empty}</div>
        : items.slice(0, 3).map(p => (
            <button key={p.id} type="button" onClick={() => onOpenPermit(p)}
              style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '3px 0',
                cursor: 'pointer', font: 'inherit', color: 'var(--text-body)', fontSize: '0.74rem',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <strong style={{ fontWeight: 700 }}>{p.permit_number ?? '—'}</strong> · {p.title}
            </button>
          ))}
    </div>
  );
}

export function PtwSignalsStrip({ onOpenPermit }: { onOpenPermit: (p: PermitListRow) => void }): VNode {
  const { awaiting, expiring, suspended } = usePtwSignals();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '12px' }}>
      <GroupCard icon="fa-clipboard-check" accent="#2563eb" label="Awaiting Approval" items={awaiting}  empty="Approval queue is clear" onOpenPermit={onOpenPermit} />
      <GroupCard icon="fa-clock"           accent="#f59e0b" label="Expiring Soon"     items={expiring}  empty="None expiring within 8h" onOpenPermit={onOpenPermit} />
      <GroupCard icon="fa-circle-pause"    accent="#ef4444" label="Suspended / Blocked" items={suspended} empty="No suspended permits"  onOpenPermit={onOpenPermit} />
    </div>
  );
}

// ── Option D: filter chips (full-width, above the register) ─────────────────────

export type PtwChipKey = 'awaiting_approval' | 'expiring' | 'suspended';

export function PtwSignalsChips({ active, onPick }: {
  active: PtwChipKey | null; onPick: (k: PtwChipKey | null) => void;
}): VNode {
  const { awaiting, expiring, suspended } = usePtwSignals();
  const chip = (key: PtwChipKey, label: string, n: number, bg: string, fg: string) => (
    <button type="button" onClick={() => onPick(active === key ? null : key)}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 11px', borderRadius: '999px',
        border: `1px solid ${active === key ? fg : 'transparent'}`, background: bg, color: fg,
        fontSize: '0.74rem', fontWeight: 700, cursor: 'pointer' }}>
      {label} <span style={{ fontWeight: 800 }}>{n}</span>
    </button>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-muted)', fontWeight: 700 }}>Needs attention</span>
      {chip('awaiting_approval', 'Awaiting',  awaiting.length,  'rgba(37,99,235,.10)', '#2563eb')}
      {chip('expiring',          'Expiring',  expiring.length,  'rgba(245,158,11,.12)', '#b45309')}
      {chip('suspended',         'Suspended', suspended.length, 'rgba(239,68,68,.10)',  '#dc2626')}
      {active && <button type="button" onClick={() => onPick(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.72rem' }}>Clear</button>}
    </div>
  );
}
