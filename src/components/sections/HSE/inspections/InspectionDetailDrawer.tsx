/**
 * src/components/sections/HSE/inspections/InspectionDetailDrawer.tsx
 *
 * Detail drawer for a single inspection: Overview · Checklist (live execution) ·
 * Findings · Timeline, with lifecycle action buttons. Wired to the live API.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { Drawer, DetailGrid, Tabs, type TabDef } from '@ui';
import {
  useInspection, useInspectionTransition, useSaveResponse, useCreateFinding,
  type ResponseStatus, type ChecklistItem, type InspectionResponse,
} from '@api/hse/inspections';
import { hsePill } from '../types';

type TabKey = 'overview' | 'checklist' | 'findings' | 'timeline';
const TABS: TabDef<TabKey>[] = [
  { key: 'overview',  label: 'Overview' },
  { key: 'checklist', label: 'Checklist' },
  { key: 'findings',  label: 'Findings' },
  { key: 'timeline',  label: 'Timeline' },
];

const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

const RESP_LABEL: Record<string, string> = { passed: 'Pass', failed: 'Fail', not_applicable: 'N/A', requires_follow_up: 'Follow-up', unanswered: '—' };

export function InspectionDetailDrawer({ inspectionId, onClose }: { inspectionId: string | null; onClose: () => void }): VNode {
  const { data, isLoading } = useInspection(inspectionId);
  const transition = useInspectionTransition();
  const saveResponse = useSaveResponse();
  const createFinding = useCreateFinding();
  const [tab, setTab] = useState<TabKey>('overview');

  const d = data?.data;
  const insp = d?.inspection;
  const status = insp?.status ?? '';

  const act = (action: 'start' | 'submit' | 'review' | 'cancel') => {
    if (!inspectionId) return;
    transition.mutate({ action, inspectionId });
  };

  const answer = (item: ChecklistItem, responseStatus: ResponseStatus) => {
    if (!inspectionId) return;
    saveResponse.mutate({ inspectionId, templateItemId: item.id, responseStatus });
  };

  const respFor = (itemId: string): InspectionResponse | undefined =>
    (d?.responses ?? []).find(r => r.template_item_id === itemId);

  const foot = (
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
      {status === 'scheduled' || status === 'due_soon' || status === 'overdue' || status === 'rescheduled'
        ? <button class="hse-btn primary" disabled={transition.isPending} onClick={() => act('start')}><i class="fas fa-play" /> Start</button> : null}
      {status === 'in_progress'
        ? <button class="hse-btn primary" disabled={transition.isPending} onClick={() => act('submit')}><i class="fas fa-paper-plane" /> Submit</button> : null}
      {status === 'submitted' || status === 'under_review'
        ? <button class="hse-btn primary" disabled={transition.isPending} onClick={() => act('review')}><i class="fas fa-clipboard-check" /> Complete Review</button> : null}
      {!['completed', 'cancelled'].includes(status)
        ? <button class="hse-btn" disabled={transition.isPending} onClick={() => act('cancel')}><i class="fas fa-ban" /> Cancel</button> : null}
      <button class="hse-btn" onClick={onClose}>Close</button>
    </div>
  );

  return (
    <Drawer
      open={!!inspectionId}
      onClose={onClose}
      title={insp?.title ?? (isLoading ? 'Loading…' : 'Inspection')}
      sub={insp?.inspection_no ?? insp?.ref ?? undefined}
      foot={foot}
    >
      <div style={{ marginBottom: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
        <span class={hsePill(status)}>{status.replace(/_/g, ' ')}</span>
        {insp?.priority ? <span class="vt-pill is-info">{insp.priority}</span> : null}
      </div>

      <Tabs<TabKey> tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'overview' && insp && (
        <div style={{ marginTop: '12px' }}>
          <DetailGrid items={[
            { icon: 'fa-hashtag',         label: 'Reference',  value: insp.inspection_no ?? insp.ref ?? '—' },
            { icon: 'fa-tag',             label: 'Type',       value: insp.inspection_type ?? insp.type ?? '—' },
            { icon: 'fa-flag',            label: 'Priority',   value: insp.priority ?? '—' },
            { icon: 'fa-location-dot',    label: 'Site',       value: insp.site_name ?? insp.site_id ?? '—' },
            { icon: 'fa-map-pin',         label: 'Area',       value: insp.area ?? '—' },
            { icon: 'fa-user',            label: 'Assignee',   value: insp.assignee_id ?? '—' },
            { icon: 'fa-user-check',      label: 'Reviewer',   value: insp.reviewer_id ?? '—' },
            { icon: 'fa-calendar',        label: 'Due',        value: fmt(insp.due_at) },
            { icon: 'fa-play',            label: 'Started',    value: fmt(insp.started_at) },
            { icon: 'fa-flag-checkered',  label: 'Completed',  value: fmt(insp.completed_at) },
          ]} hideEmpty />
          {insp.description ? <p style={{ marginTop: '12px', fontSize: '0.82rem', color: 'var(--text-muted)' }}>{String(insp.description)}</p> : null}
        </div>
      )}

      {tab === 'checklist' && (
        <div style={{ marginTop: '12px', display: 'grid', gap: '8px' }}>
          {(d?.checklist ?? []).length === 0 && <div class="hse-muted">No checklist template attached.</div>}
          {(d?.checklist ?? []).map(item => {
            const r = respFor(item.id);
            const canAnswer = status === 'in_progress';
            return (
              <div key={item.id} class="vt-table-card" style={{ padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'start' }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 500 }}>
                    {item.is_critical ? <i class="fas fa-triangle-exclamation" style={{ color: '#ef4444', marginRight: '5px' }} /> : null}
                    {item.question}{item.is_required ? <span style={{ color: '#ef4444' }}> *</span> : null}
                  </div>
                  {r?.response_status ? <span class={`vt-pill ${r.response_status === 'passed' ? 'is-on' : r.response_status === 'failed' ? 'is-critical' : 'is-off'}`}>{RESP_LABEL[r.response_status] ?? r.response_status}</span> : null}
                </div>
                {canAnswer && (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                    <button class="hse-btn" disabled={saveResponse.isPending} onClick={() => answer(item, 'passed')}>Pass</button>
                    <button class="hse-btn" disabled={saveResponse.isPending} onClick={() => answer(item, 'failed')}>Fail</button>
                    <button class="hse-btn" disabled={saveResponse.isPending} onClick={() => answer(item, 'not_applicable')}>N/A</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'findings' && (
        <div style={{ marginTop: '12px', display: 'grid', gap: '8px' }}>
          {inspectionId && (
            <button class="hse-btn primary" style={{ justifySelf: 'start' }} disabled={createFinding.isPending}
              onClick={() => createFinding.mutate({ inspectionId, title: 'New finding', severity: 'medium' })}>
              <i class="fas fa-plus" /> Add Finding
            </button>
          )}
          {(d?.findings ?? []).length === 0 && <div class="hse-muted">No findings raised.</div>}
          {(d?.findings ?? []).map(f => (
            <div key={f.id} class="vt-table-card" style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 500 }}>{f.title ?? f.description}</div>
                <div class="vt-cell-subtext">{f.finding_no} · {f.severity}</div>
              </div>
              <span class={hsePill(f.status)}>{f.status.replace(/_/g, ' ')}</span>
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
