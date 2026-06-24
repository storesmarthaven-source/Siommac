/**
 * src/components/sections/HSE/inspections/FindingDetailDrawer.tsx
 *
 * Detail drawer for a single inspection finding: Overview · Corrective Actions ·
 * Timeline, with assign-action / close / reopen / escalate. Wired to the live API.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { Drawer, DetailGrid, Tabs, type TabDef } from '@ui';
import {
  useFinding, useFindingTransition, useAssignFindingAction, useUpdateFindingAction,
} from '@api/hse/inspections';
import { hsePill } from '../types';

type TabKey = 'overview' | 'actions' | 'timeline';
const TABS: TabDef<TabKey>[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'actions',  label: 'Actions' },
  { key: 'timeline', label: 'Timeline' },
];

const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

export function FindingDetailDrawer({ findingId, onClose }: { findingId: string | null; onClose: () => void }): VNode {
  const { data, isLoading } = useFinding(findingId);
  const transition = useFindingTransition();
  const assign = useAssignFindingAction();
  const updateAction = useUpdateFindingAction();
  const [tab, setTab] = useState<TabKey>('overview');
  const [actionText, setActionText] = useState('');

  const d = data?.data;
  const f = d?.finding;
  const status = f?.status ?? '';

  const foot = (
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
      {!['closed', 'cancelled'].includes(status)
        ? <button class="hse-btn primary" disabled={transition.isPending} onClick={() => findingId && transition.mutate({ action: 'close', findingId })}><i class="fas fa-check" /> Close</button> : null}
      {status === 'closed'
        ? <button class="hse-btn" disabled={transition.isPending} onClick={() => findingId && transition.mutate({ action: 'reopen', findingId })}><i class="fas fa-rotate-left" /> Reopen</button> : null}
      {f?.severity !== 'critical' && !['closed', 'cancelled'].includes(status)
        ? <button class="hse-btn" disabled={transition.isPending} onClick={() => findingId && transition.mutate({ action: 'escalate', findingId })}><i class="fas fa-arrow-up" /> Escalate</button> : null}
      <button class="hse-btn" onClick={onClose}>Close</button>
    </div>
  );

  return (
    <Drawer
      open={!!findingId}
      onClose={onClose}
      title={f?.title ?? (isLoading ? 'Loading…' : 'Finding')}
      sub={f?.finding_no ?? undefined}
      foot={foot}
    >
      <div style={{ marginBottom: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
        <span class={hsePill(status)}>{status.replace(/_/g, ' ')}</span>
        {f?.severity ? <span class={`vt-pill ${f.severity === 'critical' ? 'is-critical' : f.severity === 'high' ? 'is-warn' : 'is-info'}`}>{f.severity}</span> : null}
      </div>

      <Tabs<TabKey> tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'overview' && f && (
        <div style={{ marginTop: '12px' }}>
          <DetailGrid items={[
            { icon: 'fa-hashtag',      label: 'Reference', value: f.finding_no ?? '—' },
            { icon: 'fa-layer-group',  label: 'Category',  value: f.category ?? '—' },
            { icon: 'fa-gauge-high',   label: 'Severity',  value: f.severity ?? '—' },
            { icon: 'fa-location-dot', label: 'Site',      value: f.site_name ?? '—' },
            { icon: 'fa-map-pin',      label: 'Area',      value: f.area ?? '—' },
            { icon: 'fa-user',         label: 'Owner',     value: f.owner_id ?? '—' },
            { icon: 'fa-calendar',     label: 'Due',       value: fmt(f.due_at) },
            { icon: 'fa-flag-checkered', label: 'Closed',  value: fmt(f.closed_at) },
          ]} hideEmpty />
          {f.description ? <p style={{ marginTop: '12px', fontSize: '0.82rem', color: 'var(--text-muted)' }}>{String(f.description)}</p> : null}
        </div>
      )}

      {tab === 'actions' && (
        <div style={{ marginTop: '12px', display: 'grid', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input class="ui-input" style={{ flex: 1 }} placeholder="New corrective action…" value={actionText}
              onInput={e => setActionText((e.target as HTMLInputElement).value)} />
            <button class="hse-btn primary" disabled={!actionText.trim() || assign.isPending}
              onClick={() => { if (findingId && actionText.trim()) { assign.mutate({ findingId, actionDescription: actionText.trim() }); setActionText(''); } }}>
              <i class="fas fa-plus" /> Assign
            </button>
          </div>
          {(d?.actions ?? []).length === 0 && <div class="hse-muted">No corrective actions yet.</div>}
          {(d?.actions ?? []).map(a => (
            <div key={a.id} class="vt-table-card" style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 500 }}>{a.action_description}</div>
                <div class="vt-cell-subtext">{a.owner_id ?? 'Unassigned'} · due {fmt(a.due_at)}</div>
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span class={hsePill(a.status)}>{a.status.replace(/_/g, ' ')}</span>
                {a.status !== 'completed' && (
                  <button class="hse-btn" disabled={updateAction.isPending} onClick={() => updateAction.mutate({ actionId: a.id, status: 'completed' })}>Done</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'timeline' && (
        <div style={{ marginTop: '12px', display: 'grid', gap: '6px' }}>
          {(d?.audit ?? []).length === 0 && <div class="hse-muted">No activity yet.</div>}
          {(d?.audit ?? []).map(e => (
            <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ textTransform: 'capitalize' }}>{e.action.replace(/_/g, ' ')}</span>
              <span class="hse-muted">{fmt(e.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );
}
