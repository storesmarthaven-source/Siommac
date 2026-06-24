/**
 * src/components/sections/HSE/ptw/PtwRightPanel.tsx
 *
 * The PTW right-side signals rail — now built on the shared @ui SidePanel
 * (owq-panel) navy variant, with the owq-panel-header (title + count + tabs).
 * Tabs: All · Awaiting · Expiring · Suspended; clicking a row opens the permit.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { SidePanel, SidePanelItem, type SidePanelTone } from '@ui';
import { usePermits, type PermitListRow } from '@api/hse/ptw';

const ACTIVE = new Set(['active', 'approved']);
function hoursUntil(iso?: string | null): number | null {
  if (!iso) return null;
  return (new Date(iso).getTime() - Date.now()) / 3_600_000;
}
const typeLabel = (t: string) => t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

/** Shared signal groups used by the PTW rail. */
export function usePtwSignals() {
  const all = usePermits({}).data?.data ?? [];
  const awaiting  = all.filter(p => p.status === 'awaiting_approval');
  const expiring  = all.filter(p => { if (!ACTIVE.has(p.status)) return false; const h = hoursUntil(p.end_datetime); return h !== null && h >= 0 && h <= 8; })
                       .sort((a, b) => (hoursUntil(a.end_datetime) ?? 0) - (hoursUntil(b.end_datetime) ?? 0));
  const suspended = all.filter(p => p.status === 'suspended');
  return { awaiting, expiring, suspended };
}

type Cat = 'awaiting' | 'expiring' | 'suspended';
interface Row { p: PermitListRow; cat: Cat; }

const CAT_META: Record<Cat, { icon: string; tone: SidePanelTone; accent: 'critical' | 'overdue' | 'normal' }> = {
  awaiting:  { icon: 'fa-clipboard-check', tone: 'invest',   accent: 'normal'   },
  expiring:  { icon: 'fa-clock',           tone: 'overdue',  accent: 'overdue'  },
  suspended: { icon: 'fa-circle-pause',    tone: 'critical', accent: 'critical' },
};

function actionFor(r: Row): string {
  if (r.cat === 'awaiting')  return 'Review';
  if (r.cat === 'suspended') return 'Suspended';
  return `${Math.max(0, Math.round(hoursUntil(r.p.end_datetime) ?? 0))}h`;
}

export function PtwRightPanel({ onOpenPermit }: { onOpenPermit: (p: PermitListRow) => void }): VNode {
  const { awaiting, expiring, suspended } = usePtwSignals();
  const [tab, setTab] = useState<'all' | Cat>('all');

  const rows: Row[] = [
    ...awaiting.map(p => ({ p, cat: 'awaiting' as const })),
    ...expiring.map(p => ({ p, cat: 'expiring' as const })),
    ...suspended.map(p => ({ p, cat: 'suspended' as const })),
  ];
  const total = rows.length;
  const shown = tab === 'all' ? rows : rows.filter(r => r.cat === tab);

  return (
    <SidePanel
      navy
      title="Signals"
      icon="fa-bell"
      count={total}
      tabs={[
        { key: 'all',       label: 'All',       count: total },
        { key: 'awaiting',  label: 'Awaiting',  count: awaiting.length },
        { key: 'expiring',  label: 'Expiring',  count: expiring.length },
        { key: 'suspended', label: 'Suspended', count: suspended.length },
      ]}
      activeTab={tab}
      onTab={k => setTab(k as 'all' | Cat)}
    >
      {shown.length === 0
        ? <div class="owq-panel-empty">Nothing needs attention</div>
        : shown.map(r => {
            const m = CAT_META[r.cat];
            return (
              <SidePanelItem
                key={r.p.id}
                icon={m.icon}
                iconTone={m.tone}
                accent={m.accent}
                refLabel={r.p.permit_number ?? undefined}
                title={r.p.title}
                meta={[{ icon: 'fa-tag', text: typeLabel(r.p.permit_type) }]}
                action={actionFor(r)}
                onClick={() => onOpenPermit(r.p)}
              />
            );
          })}
    </SidePanel>
  );
}
