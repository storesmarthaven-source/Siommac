/**
 * src/components/sections/HSE/risk-jsa/drawers/JsaDrawer.tsx
 *
 * Right-side detail drawer for a Job Safety Analysis record.
 * Tabs: Overview · Job Steps · PPE · Training · Timeline
 */

import { useState } from 'preact/hooks';
import { type VNode } from 'preact';
import { Drawer, Tabs, type TabDef } from '@ui';
import { RiskScorePill } from '../shared/RiskScorePill';
import { useJsaDetail, useAcknowledgeJsa, type JsaRow, type JsaCrewMember } from '@api/hse/riskJsa';
import { hsePill } from '../../types';
import { DrawerActions } from './DrawerActions';
import { AttachmentsPanel } from '../shared/AttachmentsPanel';
import { exportJsaPdf } from '../shared/exportPdf';

// ── Tab definitions ───────────────────────────────────────────────────────────

type JsaTabKey = 'overview' | 'steps' | 'ppe' | 'training' | 'crew' | 'files' | 'timeline';

const JSA_TABS: ReadonlyArray<TabDef<JsaTabKey>> = [
  { key: 'overview',  label: 'Overview'  },
  { key: 'steps',     label: 'Job Steps' },
  { key: 'ppe',       label: 'PPE'       },
  { key: 'training',  label: 'Training'  },
  { key: 'crew',      label: 'Crew'      },
  { key: 'files',     label: 'Files'     },
  { key: 'timeline',  label: 'Timeline'  },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function JsaDrawer({ jsa, onClose }: { jsa: JsaRow; onClose: () => void }): VNode {
  const [activeTab, setActiveTab] = useState<JsaTabKey>('overview');

  const { data: detailRes } = useJsaDetail(jsa.id);
  const detail   = detailRes?.data as Record<string, unknown> | undefined;
  const steps    = (detail?.steps    as unknown[]) ?? [];
  const ppe      = (detail?.ppe      as unknown[]) ?? [];
  const training = (detail?.training as unknown[]) ?? (detail?.trainingLinks as unknown[]) ?? [];
  const crew     = (detail?.crew     as JsaCrewMember[]) ?? [];
  const timeline = (detail?.timeline as unknown[]) ?? [];

  return (
    <Drawer
      open
      title={`${jsa.ref} — ${jsa.title}`}
      sub={jsa.site_id ?? undefined}
      onClose={onClose}
      foot={
        <DrawerActions
          entityType="jsa"
          entityId={jsa.id}
          entityRef={jsa.ref}
          entityTitle={jsa.title}
          status={jsa.status}
          onClose={onClose}
        />
      }
    >
      {/* Risk badge row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0 0 12px' }}>
        <RiskScorePill band={jsa.risk_level} hideScore />
        <span class={hsePill(jsa.status)} style={{ fontSize: '0.72rem' }}>
          {jsa.status.replace(/_/g, ' ')}
        </span>
        <button class="inc-action-btn" style={{ marginLeft: 'auto' }} onClick={() => exportJsaPdf(jsa as unknown as Record<string, unknown>, detail)}>
          <i class="fas fa-file-pdf" /> Export PDF
        </button>
      </div>

      {/* Tab bar */}
      <Tabs<JsaTabKey>
        tabs={JSA_TABS}
        active={activeTab}
        onChange={setActiveTab}
        barClass="hse-idrawer-tabbar"
        tabClass="hse-idrawer-tab"
      />

      {/* Tab bodies */}
      <div class="hse-drawer-tab-body" style={{ padding: '14px 0', overflowY: 'auto' }}>
        {activeTab === 'overview' && (
          <JsaOverviewTab jsa={jsa} />
        )}
        {activeTab === 'steps' && (
          <JsaStepsTab steps={steps} />
        )}
        {activeTab === 'ppe' && (
          <JsaPpeTab ppe={ppe} />
        )}
        {activeTab === 'training' && (
          <JsaTrainingTab training={training} />
        )}
        {activeTab === 'crew' && (
          <JsaCrewTab jsaId={jsa.id} crew={crew} />
        )}
        {activeTab === 'files' && (
          <AttachmentsPanel entityType="jsa" entityId={jsa.id} />
        )}
        {activeTab === 'timeline' && (
          <JsaTimelineTab timeline={timeline} />
        )}
      </div>
    </Drawer>
  );
}

// ── Tab panels ────────────────────────────────────────────────────────────────

function JsaOverviewTab({ jsa }: { jsa: JsaRow }): VNode {
  return (
    <div style={{ display: 'grid', gap: '12px' }}>
      <DetailRow label="Job / Task" value={jsa.title} />
      <DetailRow
        label="Status"
        value={
          <span class={hsePill(jsa.status)}>{jsa.status.replace(/_/g, ' ')}</span>
        }
      />
      <DetailRow
        label="Risk Level"
        value={<RiskScorePill band={jsa.risk_level} hideScore />}
      />
      <DetailRow label="Steps Documented" value={String(jsa.stepCount)} />
      {jsa.site_id && <DetailRow label="Site" value={jsa.site_id} />}
      {jsa.review_due_at && (
        <DetailRow
          label="Review Due"
          value={new Date(jsa.review_due_at).toLocaleDateString()}
        />
      )}
    </div>
  );
}

function JsaStepsTab({ steps }: { steps: unknown[] }): VNode {
  if (steps.length === 0) {
    return <EmptyState message="No steps recorded" />;
  }
  return (
    <div style={{ display: 'grid', gap: '10px' }}>
      {(steps as Array<Record<string, unknown>>).map((s, i) => (
        <div
          key={i}
          style={{
            padding: '10px 12px',
            background: 'var(--surface-alt)',
            borderRadius: '8px',
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: '0.72rem', color: 'var(--siomac-navy)', marginBottom: '4px' }}>
            Step {s['step_number'] as number}
          </div>
          <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
            {s['task_step'] as string}
          </div>
          {/* Nested per-step hazards (each with its controls) */}
          {((s['hazards'] as Array<Record<string, unknown>>) ?? []).map((h, hi) => (
            <div key={hi} style={{ marginTop: '6px', paddingLeft: '8px', borderLeft: '2px solid var(--border)' }}>
              <div style={{ fontSize: '0.76rem', color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <i class="fas fa-triangle-exclamation" />
                <span style={{ flex: 1 }}>{h['description'] as string}</span>
                {h['initial_score'] != null && <RiskScorePill score={h['initial_score'] as number} />}
              </div>
              {((h['controls'] as Array<Record<string, unknown>>) ?? []).map((c, ci) => (
                <div key={ci} style={{ fontSize: '0.73rem', color: 'var(--color-success)', marginTop: '2px', paddingLeft: '14px' }}>
                  <i class="fas fa-shield-halved" style={{ marginRight: '4px' }} />
                  {c['description'] as string} <span style={{ color: 'var(--text-muted)' }}>· {(c['control_type'] as string)?.replace(/_/g, ' ')}</span>
                </div>
              ))}
            </div>
          ))}
          {/* Legacy single-hazard fallback */}
          {!((s['hazards'] as unknown[])?.length) && s['hazard_description'] && (
            <div style={{ fontSize: '0.75rem', color: 'var(--color-danger)', marginTop: '3px' }}>
              <i class="fas fa-triangle-exclamation" style={{ marginRight: '4px' }} />
              {s['hazard_description'] as string}
            </div>
          )}
          {!((s['hazards'] as unknown[])?.length) && s['controls_summary'] && (
            <div style={{ fontSize: '0.75rem', color: 'var(--color-success)', marginTop: '3px' }}>
              <i class="fas fa-shield-alt" style={{ marginRight: '4px' }} />
              {s['controls_summary'] as string}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function JsaPpeTab({ ppe }: { ppe: unknown[] }): VNode {
  if (ppe.length === 0) {
    return <EmptyState message="No PPE specified" />;
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
      {(ppe as Array<Record<string, unknown>>).map((p, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 10px',
            background: 'var(--surface-alt)',
            borderRadius: '8px',
            fontSize: '0.8rem',
          }}
        >
          <i class="fas fa-check-circle" style={{ color: 'var(--color-success)', flexShrink: 0 }} />
          <span style={{ fontWeight: 500 }}>{p['ppe_item'] as string}</span>
        </div>
      ))}
    </div>
  );
}

function JsaTrainingTab({ training }: { training: unknown[] }): VNode {
  if (training.length === 0) {
    return <EmptyState message="No training requirements" />;
  }
  return (
    <div style={{ display: 'grid', gap: '8px' }}>
      {(training as Array<Record<string, unknown>>).map((t, i) => (
        <div
          key={i}
          style={{
            padding: '10px 12px',
            background: 'var(--surface-alt)',
            borderRadius: '8px',
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: '4px' }}>
            {(t['requirement_description'] ?? t['requirementDescription']) as string}
          </div>
          <div style={{ display: 'flex', gap: '10px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            {(t['certification_required'] ?? t['certificationRequired']) && (
              <span><i class="fas fa-certificate" style={{ marginRight: '3px' }} />Certification required</span>
            )}
            {(t['competency_verification'] ?? t['competencyVerification']) && (
              <span><i class="fas fa-clipboard-check" style={{ marginRight: '3px' }} />Competency verification</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function JsaCrewTab({ jsaId, crew }: { jsaId: string; crew: JsaCrewMember[] }): VNode {
  const ack = useAcknowledgeJsa();
  if (crew.length === 0) return <EmptyState message="No crew members listed" />;

  const acked = crew.filter(m => m.acknowledged).length;
  const required = crew.filter(m => m.required);
  const reqAcked = required.filter(m => m.acknowledged).length;

  return (
    <div style={{ display: 'grid', gap: '8px' }}>
      <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginBottom: '2px' }}>
        {acked}/{crew.length} acknowledged · {reqAcked}/{required.length} required complete
      </div>
      {crew.map(m => (
        <div key={m.id} style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg-card)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: 'var(--siomac-navy)', fontSize: '0.84rem' }}>
                {m.crew_name}{m.required && <span style={{ color: 'var(--siomac-red)', marginLeft: '4px' }}>*</span>}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {m.role_title ?? '—'} · competency {m.competency_verified ? 'verified' : 'unverified'}
              </div>
            </div>
            {m.acknowledged ? (
              <span class="vt-pill is-on"><i class="fas fa-check" /> Acknowledged</span>
            ) : (
              <button class="inc-action-btn primary" disabled={ack.isPending}
                onClick={() => ack.mutate({ jsaId, crewId: m.id })}>
                <i class="fas fa-signature" /> Acknowledge
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function JsaTimelineTab({ timeline }: { timeline: unknown[] }): VNode {
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
