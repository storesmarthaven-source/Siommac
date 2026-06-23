/**
 * src/components/sections/HSE/risk-jsa/drawers/HazardDrawer.tsx
 *
 * Right-side detail drawer for a Hazard Register record.
 * Tabs: Overview · Controls · CAPA · Workflow · Timeline
 */

import { useState } from 'preact/hooks';
import { type VNode } from 'preact';
import { Drawer, Tabs, type TabDef } from '@ui';
import { RiskScorePill } from '../shared/RiskScorePill';
import { useHazardDetail, type HazardRow } from '@api/hse/riskJsa';
import { hsePill } from '../../types';
import { DrawerActions } from './DrawerActions';
import { VerifyControlButton } from '../dialogs/VerifyControlButton';
import { AttachmentsPanel } from '../shared/AttachmentsPanel';
import { EditDetailsDialog } from '../dialogs/EditDetailsDialog';

const EDITABLE = ['draft', 'registered', 'changes_requested', 'returned'];

// ── Tab definitions ───────────────────────────────────────────────────────────

type HazardTabKey = 'overview' | 'controls' | 'capa' | 'workflow' | 'files' | 'timeline';

const HAZARD_TABS: ReadonlyArray<TabDef<HazardTabKey>> = [
  { key: 'overview',  label: 'Overview'  },
  { key: 'controls',  label: 'Controls'  },
  { key: 'capa',      label: 'CAPA'      },
  { key: 'workflow',  label: 'Workflow'  },
  { key: 'files',     label: 'Files'     },
  { key: 'timeline',  label: 'Timeline'  },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function HazardDrawer({ hazard, onClose }: { hazard: HazardRow; onClose: () => void }): VNode {
  const [activeTab, setActiveTab] = useState<HazardTabKey>('overview');
  const [editOpen, setEditOpen] = useState(false);

  const { data: detailRes } = useHazardDetail(hazard.id);
  const detail   = detailRes?.data as Record<string, unknown> | undefined;
  const hzRec    = (detail?.hazard as Record<string, unknown>) ?? undefined;
  const editable = EDITABLE.includes(hazard.status);
  const controls = (detail?.controls as unknown[]) ?? [];
  const capa     = (detail?.capa     as unknown[]) ?? [];
  const timeline = (detail?.timeline as unknown[]) ?? [];
  const workflow = (detail?.workflow as Record<string, unknown> | null) ?? null;

  return (
    <Drawer
      open
      title={`${hazard.ref} — ${hazard.title}`}
      sub={hazard.category}
      onClose={onClose}
      foot={
        <DrawerActions
          entityType="hazard"
          entityId={hazard.id}
          entityRef={hazard.ref}
          entityTitle={hazard.title}
          status={hazard.status}
          onClose={onClose}
        />
      }
    >
      {/* Risk badge row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 0 12px' }}>
        <RiskScorePill likelihood={hazard.initial_likelihood} severity={hazard.initial_severity} />
        <span class={hsePill(hazard.status)} style={{ fontSize: '0.72rem' }}>
          {hazard.status.replace(/_/g, ' ')}
        </span>
        {editable && (
          <button class="inc-action-btn" style={{ marginLeft: 'auto' }} onClick={() => setEditOpen(true)}>
            <i class="fas fa-pen" /> Edit
          </button>
        )}
      </div>

      <EditDetailsDialog open={editOpen} onClose={() => setEditOpen(false)}
        entityType="hazard" entityId={hazard.id} entityRef={hazard.ref}
        initial={{ title: hazard.title, description: (hzRec?.description as string) ?? '', reviewDueAt: hazard.review_due_at, version: hzRec?.version as number | undefined }} />

      {/* Tab bar */}
      <Tabs<HazardTabKey>
        tabs={HAZARD_TABS}
        active={activeTab}
        onChange={setActiveTab}
        barClass="hse-idrawer-tabbar"
        tabClass="hse-idrawer-tab"
      />

      {/* Tab bodies */}
      <div class="hse-drawer-tab-body" style={{ padding: '14px 0', overflowY: 'auto' }}>
        {activeTab === 'overview' && (
          <HazardOverviewTab hazard={hazard} />
        )}
        {activeTab === 'controls' && (
          <HazardControlsTab controls={controls} />
        )}
        {activeTab === 'capa' && (
          <HazardCapaTab capa={capa} />
        )}
        {activeTab === 'workflow' && (
          <HazardWorkflowTab workflow={workflow} />
        )}
        {activeTab === 'files' && (
          <AttachmentsPanel entityType="hazard" entityId={hazard.id} />
        )}
        {activeTab === 'timeline' && (
          <HazardTimelineTab timeline={timeline} />
        )}
      </div>
    </Drawer>
  );
}

// ── Tab panels ────────────────────────────────────────────────────────────────

function HazardOverviewTab({ hazard }: { hazard: HazardRow }): VNode {
  return (
    <div style={{ display: 'grid', gap: '12px' }}>
      <DetailRow label="Title" value={hazard.title} />
      <DetailRow label="Category" value={hazard.category} />
      {hazard.site_id && <DetailRow label="Site" value={hazard.site_id} />}
      <DetailRow
        label="Initial Risk"
        value={
          <RiskScorePill
            likelihood={hazard.initial_likelihood}
            severity={hazard.initial_severity}
          />
        }
      />
      {hazard.residual_likelihood != null && hazard.residual_severity != null && (
        <DetailRow
          label="Residual Risk"
          value={
            <RiskScorePill
              likelihood={hazard.residual_likelihood}
              severity={hazard.residual_severity}
            />
          }
        />
      )}
      <DetailRow
        label="Status"
        value={
          <span class={hsePill(hazard.status)}>{hazard.status.replace(/_/g, ' ')}</span>
        }
      />
      {hazard.review_due_at && (
        <DetailRow
          label="Review Due"
          value={new Date(hazard.review_due_at).toLocaleDateString()}
        />
      )}
    </div>
  );
}

function HazardControlsTab({ controls }: { controls: unknown[] }): VNode {
  if (controls.length === 0) {
    return <EmptyState message="No controls recorded" />;
  }
  return (
    <div style={{ display: 'grid', gap: '8px' }}>
      {(controls as Array<Record<string, unknown>>).map((c, i) => (
        <div
          key={i}
          style={{
            padding: '10px 12px',
            background: 'var(--surface-alt)',
            borderRadius: '8px',
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start' }}>
            <div style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: '4px' }}>
              {c['description'] as string}
            </div>
            <VerifyControlButton
              controlId={c['id'] as string}
              status={c['status'] as string}
              label={c['description'] as string}
            />
          </div>
          <div style={{ display: 'flex', gap: '8px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            <span style={{ textTransform: 'capitalize' }}>
              {(c['control_type'] as string).replace(/_/g, ' ')}
            </span>
            <span>·</span>
            <span>{c['status'] as string}</span>
            {c['effectiveness'] != null && (<><span>·</span><span style={{ textTransform: 'capitalize' }}>{(c['effectiveness'] as string).replace(/_/g, ' ')}</span></>)}
          </div>
        </div>
      ))}
    </div>
  );
}

function HazardCapaTab({ capa }: { capa: unknown[] }): VNode {
  if (capa.length === 0) {
    return <EmptyState message="No CAPA actions linked" />;
  }
  return (
    <div style={{ display: 'grid', gap: '8px' }}>
      {(capa as Array<Record<string, unknown>>).map((a, i) => (
        <div
          key={i}
          style={{
            padding: '10px 12px',
            background: 'var(--surface-alt)',
            borderRadius: '8px',
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: '2px' }}>
            {a['ref'] as string} — {a['title'] as string}
          </div>
          <div style={{ display: 'flex', gap: '8px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            <span style={{ textTransform: 'capitalize' }}>{a['priority'] as string} priority</span>
            <span>·</span>
            <span>{a['status'] as string}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function HazardWorkflowTab({ workflow }: { workflow: Record<string, unknown> | null }): VNode {
  if (!workflow) {
    return <EmptyState message="No workflow active" />;
  }
  return (
    <div
      style={{
        padding: '12px',
        background: 'var(--surface-alt)',
        borderRadius: '8px',
        border: '1px solid var(--border)',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '6px' }}>
        {workflow['ref'] as string}
      </div>
      <span class={hsePill(workflow['status'] as string)}>
        {(workflow['status'] as string).replace(/_/g, ' ')}
      </span>
    </div>
  );
}

function HazardTimelineTab({ timeline }: { timeline: unknown[] }): VNode {
  if (timeline.length === 0) {
    return <EmptyState message="No timeline events yet" />;
  }
  return (
    <div>
      {(timeline as Array<Record<string, unknown>>).map((e, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            gap: '10px',
            padding: '8px 0',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <i
            class="fas fa-circle-dot"
            style={{ color: 'var(--siomac-navy)', marginTop: '3px', fontSize: '0.7rem', flexShrink: 0 }}
          />
          <div>
            <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>
              {(e['event_type'] as string).replace(/\./g, ' ')}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {new Date(e['created_at'] as string).toLocaleString()}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: VNode | string }): VNode {
  return (
    <div>
      <strong style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>
        {label}
      </strong>
      <span style={{ fontSize: '0.85rem' }}>{value}</span>
    </div>
  );
}

function EmptyState({ message }: { message: string }): VNode {
  return (
    <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '24px 0', fontSize: '0.8rem' }}>
      {message}
    </p>
  );
}
