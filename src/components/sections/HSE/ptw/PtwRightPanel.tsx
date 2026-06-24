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

export function PtwRightPanel({ onOpenPermit }: { onOpenPermit: (p: PermitListRow) => void }): VNode {
  const all = usePermits({}).data?.data ?? [];

  const awaiting  = all.filter(p => p.status === 'awaiting_approval');
  const expiring  = all.filter(p => { if (!ACTIVE.has(p.status)) return false; const h = hoursUntil(p.end_datetime); return h !== null && h >= 0 && h <= 8; })
                       .sort((a, b) => (hoursUntil(a.end_datetime) ?? 0) - (hoursUntil(b.end_datetime) ?? 0));
  const suspended = all.filter(p => p.status === 'suspended');

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
