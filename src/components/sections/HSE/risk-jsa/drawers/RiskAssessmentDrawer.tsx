/**
 * src/components/sections/HSE/risk-jsa/drawers/RiskAssessmentDrawer.tsx
 *
 * Right-side detail drawer for a Risk Assessment. Five tabs:
 *   Overview  — type, status, risk level, review due
 *   Hazards   — hazard list from detail endpoint
 *   Risk Matrix — read-only 5×5 picker for the highest hazard
 *   Controls  — control list from detail endpoint
 *   Timeline  — event log from detail endpoint
 */

import { useState } from 'preact/hooks';
import type { VNode } from 'preact';
import {
  Drawer, Tabs, StatusPill,
  type TabDef,
} from '@ui';
import { RiskScorePill } from '../shared/RiskScorePill';
import { RiskMatrixPicker } from '../shared/RiskMatrixPicker';
import { useAssessmentDetail, type AssessmentRow } from '@api/hse/riskJsa';
import { hsePill } from '../../types';
import { DrawerActions } from './DrawerActions';
import { AttachmentsPanel } from '../shared/AttachmentsPanel';
import { exportAssessmentPdf } from '../shared/exportPdf';
import { EditDetailsDialog } from '../dialogs/EditDetailsDialog';
import { VerifyControlButton } from '../dialogs/VerifyControlButton';

const EDITABLE = ['draft', 'registered', 'changes_requested', 'returned'];

// ── Tab definitions ────────────────────────────────────────────────────────────

type DrawerTab = 'overview' | 'hazards' | 'matrix' | 'controls' | 'files' | 'timeline';

const DRAWER_TABS: ReadonlyArray<TabDef<DrawerTab>> = [
  { key: 'overview',  label: 'Overview'     },
  { key: 'hazards',   label: 'Hazards'      },
  { key: 'matrix',    label: 'Risk Matrix'  },
  { key: 'controls',  label: 'Controls'     },
  { key: 'files',     label: 'Files'        },
  { key: 'timeline',  label: 'Timeline'     },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function DetailRow({ label, children }: { label: string; children: VNode | string | null | undefined }): VNode {
  return (
    <div style={{ display: 'grid', gap: '2px', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <div style={{ fontSize: '0.85rem' }}>{children ?? '—'}</div>
    </div>
  );
}

function EmptyState({ message }: { message: string }): VNode {
  return (
    <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', padding: '28px 0' }}>
      {message}
    </p>
  );
}

// ── Tab panels ─────────────────────────────────────────────────────────────────

function OverviewTab({ assessment }: { assessment: AssessmentRow }): VNode {
  return (
    <div style={{ display: 'grid', gap: '0' }}>
      <DetailRow label="Title">{assessment.title}</DetailRow>
      <DetailRow label="Assessment Type">
        {assessment.assessment_type.replace(/_/g, ' ')}
      </DetailRow>
      <DetailRow label="Status">
        <span class={hsePill(assessment.status)}>
          {assessment.status.replace(/_/g, ' ')}
        </span>
      </DetailRow>
      <DetailRow label="Risk Level">
        <RiskScorePill
          band={assessment.risk_level}
          score={assessment.initial_score ?? undefined}
        />
      </DetailRow>
      {assessment.residual_score != null && (
        <DetailRow label="Residual Risk Score">
          <RiskScorePill score={assessment.residual_score} />
        </DetailRow>
      )}
      <DetailRow label="Site">{assessment.site_id ?? 'All sites'}</DetailRow>
      <DetailRow label="Review Due">
        {assessment.review_due_at
          ? new Date(assessment.review_due_at).toLocaleDateString()
          : null}
      </DetailRow>
      <DetailRow label="Created">
        {new Date(assessment.created_at).toLocaleDateString()}
      </DetailRow>
    </div>
  );
}

function HazardsTab({ hazards }: { hazards: unknown[] }): VNode {
  if (hazards.length === 0) return <EmptyState message="No hazards linked to this assessment." />;
  return (
    <div style={{ display: 'grid', gap: '8px' }}>
      {(hazards as Array<Record<string, unknown>>).map((h, i) => {
        const l = (h['initial_likelihood'] as number | undefined) ?? 1;
        const s = (h['initial_severity']   as number | undefined) ?? 1;
        const desc = (h['hazard_description'] as string | undefined) ?? `Hazard ${i + 1}`;
        const category = h['category'] as string | undefined;
        return (
          <div
            key={i}
            style={{
              padding: '12px', background: 'var(--surface-alt)', borderRadius: '8px',
              display: 'grid', gap: '6px',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{desc}</div>
            {category && (
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{category}</div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Initial:</span>
              <RiskScorePill likelihood={l} severity={s} />
              {h['residual_likelihood'] != null && h['residual_severity'] != null && (
                <>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Residual:</span>
                  <RiskScorePill
                    likelihood={h['residual_likelihood'] as number}
                    severity={h['residual_severity'] as number}
                  />
                </>
              )}
            </div>
            {h['notes'] && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                {h['notes'] as string}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RiskMatrixTab({ hazards, assessment }: { hazards: unknown[]; assessment: AssessmentRow }): VNode {
  // Find the highest hazard (max initial score) to display in the read-only matrix
  let topL = 3;
  let topS = 3;

  if (hazards.length > 0) {
    let maxScore = 0;
    for (const h of hazards as Array<Record<string, unknown>>) {
      const l = (h['initial_likelihood'] as number | undefined) ?? 1;
      const s = (h['initial_severity']   as number | undefined) ?? 1;
      const score = l * s;
      if (score > maxScore) {
        maxScore = score;
        topL = l;
        topS = s;
      }
    }
  } else if (assessment.initial_score != null && assessment.initial_score > 0) {
    // Approximate L×S from score if no detail hazards loaded yet
    const sq = Math.round(Math.sqrt(assessment.initial_score));
    topL = Math.min(sq, 5);
    topS = Math.min(Math.ceil(assessment.initial_score / Math.max(topL, 1)), 5);
  }

  return (
    <div style={{ display: 'grid', gap: '14px' }}>
      <div>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '10px' }}>
          Highest Risk Cell — Read Only
        </span>
        <RiskMatrixPicker
          likelihood={topL}
          severity={topS}
          readonly
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', background: 'var(--surface-alt)', borderRadius: '8px' }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Overall Assessment Risk:</span>
        <RiskScorePill band={assessment.risk_level} score={assessment.initial_score ?? undefined} />
      </div>
      {hazards.length > 1 && (
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
          Showing position of highest-scoring hazard ({topL} × {topS} = {topL * topS}). {hazards.length} hazards total.
        </p>
      )}
    </div>
  );
}

function ControlsTab({ controls }: { controls: unknown[] }): VNode {
  if (controls.length === 0) return <EmptyState message="No controls recorded for this assessment." />;
  return (
    <div style={{ display: 'grid', gap: '8px' }}>
      {(controls as Array<Record<string, unknown>>).map((c, i) => {
        const desc        = (c['description']  as string | undefined) ?? '—';
        const controlType = (c['control_type'] as string | undefined) ?? '';
        const status      = (c['status']       as string | undefined) ?? '';
        return (
          <div
            key={i}
            style={{ padding: '12px', background: 'var(--surface-alt)', borderRadius: '8px', display: 'grid', gap: '4px' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start' }}>
              <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{desc}</div>
              <VerifyControlButton controlId={(c['id'] as string) ?? ''} status={status} label={desc} />
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '2px', flexWrap: 'wrap' }}>
              {controlType && (
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {controlType.replace(/_/g, ' ')}
                </span>
              )}
              {status && (
                <StatusPill status={status} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TimelineTab({ timeline }: { timeline: unknown[] }): VNode {
  if (timeline.length === 0) return <EmptyState message="No timeline events yet." />;
  return (
    <div>
      {(timeline as Array<Record<string, unknown>>).map((e, i) => {
        const eventType = (e['event_type'] as string | undefined) ?? 'event';
        const createdAt = (e['created_at'] as string | undefined);
        return (
          <div
            key={i}
            style={{ display: 'flex', gap: '10px', padding: '10px 0', borderBottom: '1px solid var(--border)' }}
          >
            <i
              class="fas fa-circle-dot"
              style={{ color: 'var(--siomac-navy)', marginTop: '3px', fontSize: '0.65rem', flexShrink: 0 }}
            />
            <div>
              <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>
                {eventType.replace(/[_.]/g, ' ')}
              </div>
              {createdAt && (
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {new Date(createdAt).toLocaleString()}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main drawer ────────────────────────────────────────────────────────────────

export function RiskAssessmentDrawer({
  assessment,
  onClose,
}: {
  assessment: AssessmentRow;
  onClose:    () => void;
}): VNode {
  const [activeTab, setActiveTab] = useState<DrawerTab>('overview');
  const [editOpen, setEditOpen] = useState(false);

  const { data: detailRes } = useAssessmentDetail(assessment.id);
  const detail   = detailRes?.data as Record<string, unknown> | undefined;
  const raRec    = (detail?.assessment as Record<string, unknown>) ?? undefined;
  const editable = EDITABLE.includes(assessment.status);
  const hazards  = (detail?.hazards  as unknown[]) ?? [];
  const controls = (detail?.controls as unknown[]) ?? [];
  const timeline = (detail?.timeline as unknown[]) ?? [];

  const headerSub = `${assessment.assessment_type.replace(/_/g, ' ')} · ${assessment.ref}`;

  return (
    <Drawer
      open
      title={assessment.title}
      sub={headerSub}
      onClose={onClose}
      foot={
        <DrawerActions
          entityType="assessment"
          entityId={assessment.id}
          entityRef={assessment.ref}
          entityTitle={assessment.title}
          status={assessment.status}
          onClose={onClose}
        />
      }
    >
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingBottom: '8px' }}>
        {editable && (
          <button class="inc-action-btn" onClick={() => setEditOpen(true)}><i class="fas fa-pen" /> Edit</button>
        )}
        <button class="inc-action-btn" onClick={() => exportAssessmentPdf(assessment as unknown as Record<string, unknown>, detail)}>
          <i class="fas fa-file-pdf" /> Export PDF
        </button>
      </div>

      <EditDetailsDialog open={editOpen} onClose={() => setEditOpen(false)}
        entityType="assessment" entityId={assessment.id} entityRef={assessment.ref}
        initial={{ title: assessment.title, description: (raRec?.description as string) ?? '', reviewDueAt: assessment.review_due_at, version: raRec?.version as number | undefined }} />

      <Tabs<DrawerTab>
        tabs={DRAWER_TABS}
        active={activeTab}
        onChange={setActiveTab}
      />

      <div style={{ padding: '16px 0' }}>
        {activeTab === 'overview' && <OverviewTab assessment={assessment} />}
        {activeTab === 'hazards'  && <HazardsTab  hazards={hazards} />}
        {activeTab === 'matrix'   && <RiskMatrixTab hazards={hazards} assessment={assessment} />}
        {activeTab === 'controls' && <ControlsTab controls={controls} />}
        {activeTab === 'files' && <AttachmentsPanel entityType="assessment" entityId={assessment.id} />}
        {activeTab === 'timeline' && <TimelineTab timeline={timeline} />}
      </div>
    </Drawer>
  );
}
