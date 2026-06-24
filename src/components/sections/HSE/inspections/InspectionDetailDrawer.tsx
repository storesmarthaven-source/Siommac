/**
 * src/components/sections/HSE/inspections/InspectionDetailDrawer.tsx
 *
 * Detail drawer for a single inspection: Overview · Checklist (live execution,
 * all response types + comments + progress) · Findings · Evidence · Timeline,
 * with lifecycle actions and the dialog suite.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { Drawer, DetailGrid, Tabs, type TabDef } from '@ui';
import {
  useInspection, useInspectionTransition, useSaveResponse,
  type ResponseStatus, type ChecklistItem, type InspectionResponse,
} from '@api/hse/inspections';
import { hsePill } from '../types';
import { RecordFindingDialog, CloseInspectionDialog, RescheduleDialog } from './InspectionDialogs';

type TabKey = 'overview' | 'checklist' | 'findings' | 'evidence' | 'timeline';
const TABS: TabDef<TabKey>[] = [
  { key: 'overview',  label: 'Overview' },
  { key: 'checklist', label: 'Checklist' },
  { key: 'findings',  label: 'Findings' },
  { key: 'evidence',  label: 'Evidence' },
  { key: 'timeline',  label: 'Timeline' },
];

const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const RESP_LABEL: Record<string, string> = { passed: 'Pass', failed: 'Fail', not_applicable: 'N/A', requires_follow_up: 'Follow-up', unanswered: '—' };
const RESP_PILL: Record<string, string> = { passed: 'is-on', failed: 'is-critical', not_applicable: 'is-off', requires_follow_up: 'is-warn' };

/** One checklist row — renders by response_type, keeps local comment/value, saves on action. */
function ChecklistRow({ item, response, canAnswer, saving, onSave }: {
  item: ChecklistItem; response?: InspectionResponse; canAnswer: boolean; saving: boolean;
  onSave: (status: ResponseStatus, value: string | null, comment: string | null) => void;
}): VNode {
  const [comment, setComment] = useState(response?.comment ?? '');
  const [value, setValue] = useState(response?.response_value ?? '');
  const cur = response?.response_status ?? null;

  const choiceBtns = (labels: [string, ResponseStatus][]) => (
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
      {labels.map(([lab, st]) => (
        <button key={st} class={`hse-btn${cur === st ? ' primary' : ''}`} disabled={saving} onClick={() => onSave(st, value || null, comment || null)}>{lab}</button>
      ))}
    </div>
  );

  return (
    <div class="vt-table-card" style={{ padding: '10px 12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'start' }}>
        <div style={{ fontSize: '0.82rem', fontWeight: 500 }}>
          {item.is_critical ? <i class="fas fa-triangle-exclamation" style={{ color: '#ef4444', marginRight: '5px' }} /> : null}
          {item.question}{item.is_required ? <span style={{ color: '#ef4444' }}> *</span> : null}
        </div>
        {cur ? <span class={`vt-pill ${RESP_PILL[cur] ?? 'is-off'}`}>{RESP_LABEL[cur] ?? cur}</span> : null}
      </div>
      {(item.requires_evidence_on_fail || item.response_type === 'photo_required' || item.response_type === 'signature') && (
        <div class="vt-cell-subtext" style={{ marginTop: '4px' }}><i class="fas fa-paperclip" /> Evidence may be required — attach via the Evidence tab.</div>
      )}
      {canAnswer && (
        <div style={{ marginTop: '8px', display: 'grid', gap: '8px' }}>
          {(item.response_type === 'pass_fail_na' || item.response_type === 'photo_required' || item.response_type === 'signature' || item.response_type === 'multi_select') &&
            choiceBtns([['Pass', 'passed'], ['Fail', 'failed'], ['N/A', 'not_applicable']])}
          {item.response_type === 'yes_no_na' &&
            choiceBtns([['Yes', 'passed'], ['No', 'failed'], ['N/A', 'not_applicable']])}
          {(item.response_type === 'numeric' || item.response_type === 'text') && (
            <div style={{ display: 'flex', gap: '6px' }}>
              <input class="ui-input" style={{ flex: 1 }} type={item.response_type === 'numeric' ? 'number' : 'text'}
                value={value} onInput={e => setValue((e.target as HTMLInputElement).value)} placeholder="Enter value…" />
              <button class="hse-btn primary" disabled={saving || !value} onClick={() => onSave('passed', value, comment || null)}>Save</button>
            </div>
          )}
          <input class="ui-input" placeholder="Comment (optional)" value={comment} onInput={e => setComment((e.target as HTMLInputElement).value)}
            onBlur={() => { if (cur) onSave(cur, value || null, comment || null); }} />
        </div>
      )}
      {!canAnswer && response?.comment ? <div class="vt-cell-subtext" style={{ marginTop: '4px' }}>{response.comment}</div> : null}
    </div>
  );
}

export function InspectionDetailDrawer({ inspectionId, onClose }: { inspectionId: string | null; onClose: () => void }): VNode {
  const { data, isLoading } = useInspection(inspectionId);
  const transition = useInspectionTransition();
  const saveResponse = useSaveResponse();
  const [tab, setTab] = useState<TabKey>('overview');
  const [findingOpen, setFindingOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [reschedOpen, setReschedOpen] = useState(false);

  const d = data?.data;
  const insp = d?.inspection;
  const status = insp?.status ?? '';
  const responses = d?.responses ?? [];
  const checklist = d?.checklist ?? [];

  const respFor = (itemId: string) => responses.find(r => r.template_item_id === itemId);
  const answered = responses.filter(r => r.response_status && r.response_status !== 'unanswered').length;
  const progress = checklist.length ? Math.round((answered / checklist.length) * 100) : 0;

  const act = (action: 'start' | 'submit' | 'cancel') => { if (inspectionId) transition.mutate({ action, inspectionId }); };

  const foot = (
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
      {['scheduled', 'due_soon', 'overdue', 'rescheduled'].includes(status)
        ? <button class="hse-btn primary" disabled={transition.isPending} onClick={() => act('start')}><i class="fas fa-play" /> Start</button> : null}
      {status === 'in_progress'
        ? <button class="hse-btn primary" disabled={transition.isPending} onClick={() => act('submit')}><i class="fas fa-paper-plane" /> Submit</button> : null}
      {['submitted', 'under_review'].includes(status)
        ? <button class="hse-btn primary" onClick={() => setCloseOpen(true)}><i class="fas fa-clipboard-check" /> Complete</button> : null}
      {!['completed', 'cancelled'].includes(status)
        ? <button class="hse-btn" onClick={() => setReschedOpen(true)}><i class="fas fa-calendar" /> Reschedule</button> : null}
      {!['completed', 'cancelled'].includes(status)
        ? <button class="hse-btn" disabled={transition.isPending} onClick={() => act('cancel')}><i class="fas fa-ban" /> Cancel</button> : null}
      <button class="hse-btn" onClick={onClose}>Close</button>
    </div>
  );

  return (
    <>
      <Drawer open={!!inspectionId} onClose={onClose}
        title={insp?.title ?? (isLoading ? 'Loading…' : 'Inspection')}
        sub={insp?.inspection_no ?? insp?.ref ?? undefined} foot={foot}>
        <div style={{ marginBottom: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span class={hsePill(status)}>{status.replace(/_/g, ' ')}</span>
          {insp?.priority ? <span class="vt-pill is-info">{insp.priority}</span> : null}
        </div>

        <Tabs<TabKey> tabs={TABS} active={tab} onChange={setTab} />

        {tab === 'overview' && insp && (
          <div style={{ marginTop: '12px' }}>
            <DetailGrid items={[
              { icon: 'fa-hashtag',        label: 'Reference', value: insp.inspection_no ?? insp.ref ?? '—' },
              { icon: 'fa-tag',            label: 'Type',      value: insp.inspection_type ?? insp.type ?? '—' },
              { icon: 'fa-flag',           label: 'Priority',  value: insp.priority ?? '—' },
              { icon: 'fa-location-dot',   label: 'Site',      value: insp.site_name ?? insp.site_id ?? '—' },
              { icon: 'fa-map-pin',        label: 'Area',      value: insp.area ?? '—' },
              { icon: 'fa-user',           label: 'Assignee',  value: insp.assignee_id ?? '—' },
              { icon: 'fa-user-check',     label: 'Reviewer',  value: insp.reviewer_id ?? '—' },
              { icon: 'fa-calendar',       label: 'Due',       value: fmt(insp.due_at) },
              { icon: 'fa-play',           label: 'Started',   value: fmt(insp.started_at) },
              { icon: 'fa-flag-checkered', label: 'Completed', value: fmt(insp.completed_at) },
            ]} hideEmpty />
            {insp.description ? <p style={{ marginTop: '12px', fontSize: '0.82rem', color: 'var(--text-muted)' }}>{String(insp.description)}</p> : null}
          </div>
        )}

        {tab === 'checklist' && (
          <div style={{ marginTop: '12px', display: 'grid', gap: '8px' }}>
            {checklist.length === 0 && <div class="hse-muted">No checklist template attached.</div>}
            {checklist.length > 0 && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                  <span>Progress</span><span>{answered}/{checklist.length}</span>
                </div>
                <div style={{ height: '6px', borderRadius: '999px', background: 'var(--bg-subtle, #e2e8f0)' }}>
                  <div style={{ width: `${progress}%`, height: '100%', borderRadius: '999px', background: progress === 100 ? '#22c55e' : '#60a5fa' }} />
                </div>
              </div>
            )}
            {checklist.map(item => (
              <ChecklistRow key={item.id} item={item} response={respFor(item.id)} canAnswer={status === 'in_progress'} saving={saveResponse.isPending}
                onSave={(st, value, comment) => inspectionId && saveResponse.mutate({ inspectionId, templateItemId: item.id, responseStatus: st, responseValue: value, comment })} />
            ))}
          </div>
        )}

        {tab === 'findings' && (
          <div style={{ marginTop: '12px', display: 'grid', gap: '8px' }}>
            {inspectionId && <button class="hse-btn primary" style={{ justifySelf: 'start' }} onClick={() => setFindingOpen(true)}><i class="fas fa-plus" /> Record Finding</button>}
            {(d?.findings ?? []).length === 0 && <div class="hse-muted">No findings raised.</div>}
            {(d?.findings ?? []).map(f => (
              <div key={f.id} class="vt-table-card" style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <div><div style={{ fontSize: '0.82rem', fontWeight: 500 }}>{f.title ?? f.description}</div><div class="vt-cell-subtext">{f.finding_no} · {f.severity}</div></div>
                <span class={hsePill(f.status)}>{f.status.replace(/_/g, ' ')}</span>
              </div>
            ))}
          </div>
        )}

        {tab === 'evidence' && (
          <div style={{ marginTop: '12px', display: 'grid', gap: '6px' }}>
            {(d?.evidence ?? []).length === 0 && <div class="hse-muted">No evidence attached.</div>}
            {(d?.evidence ?? []).map(ev => (
              <div key={ev.id} class="vt-table-card" style={{ padding: '8px 12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                <i class="fas fa-paperclip" style={{ color: 'var(--text-muted)' }} />
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: '0.8rem' }}>{ev.file_name}</div><div class="vt-cell-subtext">{ev.evidence_type} · {fmt(ev.uploaded_at)}</div></div>
              </div>
            ))}
          </div>
        )}

        {tab === 'timeline' && (
          <div style={{ marginTop: '12px', display: 'grid', gap: '6px' }}>
            {(d?.audit ?? []).length === 0 && <div class="hse-muted">No activity yet.</div>}
            {(d?.audit ?? []).map(e => (
              <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ textTransform: 'capitalize' }}>{e.action.replace(/_/g, ' ')}</span><span class="hse-muted">{fmt(e.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </Drawer>

      {inspectionId && <RecordFindingDialog inspectionId={inspectionId} open={findingOpen} onClose={() => setFindingOpen(false)} />}
      {inspectionId && <CloseInspectionDialog inspectionId={inspectionId} open={closeOpen} onClose={() => setCloseOpen(false)} />}
      {inspectionId && <RescheduleDialog inspectionId={inspectionId} open={reschedOpen} onClose={() => setReschedOpen(false)} />}
    </>
  );
}
