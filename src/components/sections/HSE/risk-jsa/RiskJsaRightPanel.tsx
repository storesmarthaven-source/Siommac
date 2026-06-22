/**
 * src/components/sections/HSE/risk-jsa/RiskJsaRightPanel.tsx
 *
 * The right-side supporting panel — it CHANGES by active tab (spec §5.3, §6.3, §7.3):
 *   Hazard Register   → High Risk Queue · Overdue Reviews · Control Gaps
 *   Risk Assessments  → Approval Queue · Residual Risk Watch · Expiring Assessments
 *   JSA Library       → Expiring JSAs · Permit Required · Training / PPE Gaps
 *
 * Clicking an item opens the matching drawer. Computed from the live lists;
 * fields not yet in the lists (permit links, training gaps) use proxies until
 * /summary is extended.
 */

import { type VNode, type ComponentChildren } from 'preact';
import {
  useHazards, useAssessments, useJsaList,
  type HazardRow, type AssessmentRow, type JsaRow,
} from '@api/hse/riskJsa';
import { QueueItem } from './shared/QueueItem';

function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  return Math.round((new Date(iso).getTime() - Date.now()) / 86400000);
}
const isHighRisk = (lvl: string) => lvl === 'high' || lvl === 'critical';

function Panel({ icon, title, count, empty, children }: {
  icon: string; title: string; count?: number; empty?: string; children: ComponentChildren;
}): VNode {
  const has = Array.isArray(children) ? children.filter(Boolean).length > 0 : !!children;
  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: 'rgba(255,255,255,.85)' }}>
        <i class={`fas ${icon}`} style={{ fontSize: '0.8rem' }} />
        <span style={{ fontSize: '0.74rem', fontWeight: 700, flex: 1 }}>{title}</span>
        {count !== undefined && (
          <span style={{ fontSize: '0.62rem', fontWeight: 700, background: 'rgba(255,255,255,.14)', borderRadius: '99px', padding: '1px 8px' }}>{count}</span>
        )}
      </div>
      <div style={{ display: 'grid', gap: '6px' }}>
        {has ? children : <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,.4)', padding: '8px 0' }}>{empty}</div>}
      </div>
    </div>
  );
}

function Shell({ children }: { children: ComponentChildren }): VNode {
  return (
    <div style={{ background: '#1b2d54', borderRadius: '16px', padding: '16px', boxShadow: '0 4px 14px rgba(15,23,42,.1)' }}>
      {children}
    </div>
  );
}

export function RiskJsaRightPanel({ activeTab, onHazard, onAssessment, onJsa }: {
  activeTab: 'hazards' | 'assessments' | 'jsa';
  onHazard:     (h: HazardRow) => void;
  onAssessment: (a: AssessmentRow) => void;
  onJsa:        (j: JsaRow) => void;
}): VNode {
  if (activeTab === 'assessments') return <AssessmentPanel onAssessment={onAssessment} />;
  if (activeTab === 'jsa')         return <JsaPanel onJsa={onJsa} />;
  return <HazardPanel onHazard={onHazard} />;
}

// ── Hazard ────────────────────────────────────────────────────────────────────

function HazardPanel({ onHazard }: { onHazard: (h: HazardRow) => void }): VNode {
  const hz = useHazards({}).data?.data ?? [];
  const highRisk = hz.filter(h => isHighRisk(h.risk_level));
  const overdue = hz.filter(h => { const d = daysUntil(h.review_due_at); return d !== null && d < 0; });
  const gaps = hz.filter(h => h.status !== 'approved' && h.status !== 'monitoring');
  return (
    <Shell>
      <Panel icon="fa-circle-exclamation" title="High Risk Queue" count={highRisk.length} empty="No high-risk hazards">
        {highRisk.slice(0, 5).map(h => (
          <QueueItem key={h.id} onDark icon="fa-radiation" ref={h.ref} category={h.category} title={h.title}
            tag={h.risk_level === 'critical' ? 'Critical' : 'High'} tagTone={h.risk_level === 'critical' ? 'danger' : 'warning'}
            onClick={() => onHazard(h)} />
        ))}
      </Panel>
      <Panel icon="fa-clock" title="Overdue Reviews" count={overdue.length} empty="All reviews current">
        {overdue.slice(0, 4).map(h => (
          <QueueItem key={h.id} onDark icon="fa-clock" ref={h.ref} title={h.title}
            tag={`${Math.abs(daysUntil(h.review_due_at) ?? 0)}d overdue`} tagTone="danger" onClick={() => onHazard(h)} />
        ))}
      </Panel>
      <Panel icon="fa-shield-halved" title="Control Gaps" count={gaps.length} empty="All hazards have controls">
        {gaps.slice(0, 3).map(h => (
          <QueueItem key={h.id} onDark icon="fa-triangle-exclamation" ref={h.ref} title={h.title}
            tag="No controls" tagTone="warning" onClick={() => onHazard(h)} />
        ))}
      </Panel>
    </Shell>
  );
}

// ── Assessments ─────────────────────────────────────────────────────────────────

function AssessmentPanel({ onAssessment }: { onAssessment: (a: AssessmentRow) => void }): VNode {
  const list = useAssessments({}).data?.data ?? [];
  const approval = list.filter(a => a.status === 'under_review' || a.status === 'submitted');
  const residual = list.filter(a => isHighRisk(a.risk_level));
  const expiring = list.filter(a => { const d = daysUntil(a.review_due_at); return a.status === 'expired' || (d !== null && d >= 0 && d <= 7); });
  return (
    <Shell>
      <Panel icon="fa-clipboard-check" title="Approval Queue" count={approval.length} empty="Nothing awaiting review">
        {approval.slice(0, 5).map(a => (
          <QueueItem key={a.id} onDark icon="fa-clipboard-check" ref={a.ref} title={a.title}
            tag="Under review" tagTone="info" onClick={() => onAssessment(a)} />
        ))}
      </Panel>
      <Panel icon="fa-arrow-down-wide-short" title="Residual Risk Watch" count={residual.length} empty="No high residual risk">
        {residual.slice(0, 4).map(a => (
          <QueueItem key={a.id} onDark icon="fa-triangle-exclamation" ref={a.ref} title={a.title}
            tag={a.risk_level === 'critical' ? 'Critical' : 'High'} tagTone={a.risk_level === 'critical' ? 'danger' : 'warning'}
            onClick={() => onAssessment(a)} />
        ))}
      </Panel>
      <Panel icon="fa-hourglass-half" title="Expiring Assessments" count={expiring.length} empty="None expiring soon">
        {expiring.slice(0, 4).map(a => {
          const d = daysUntil(a.review_due_at);
          return <QueueItem key={a.id} onDark icon="fa-hourglass-half" ref={a.ref} title={a.title}
            tag={a.status === 'expired' ? 'Expired' : `${d}d`} tagTone="warning" onClick={() => onAssessment(a)} />;
        })}
      </Panel>
    </Shell>
  );
}

// ── JSA ─────────────────────────────────────────────────────────────────────────

function JsaPanel({ onJsa }: { onJsa: (j: JsaRow) => void }): VNode {
  const list = useJsaList({}).data?.data ?? [];
  const expiring = list.filter(j => { const d = daysUntil(j.review_due_at); return d !== null && d >= 0 && d <= 7; });
  const permitReq = list.filter(j => isHighRisk(j.risk_level) && j.status === 'active'); // proxy: high-risk active jobs likely need a permit
  const trainingGaps = list.filter(j => j.status === 'draft' || j.status === 'returned');  // proxy until training links land
  return (
    <Shell>
      <Panel icon="fa-hourglass-half" title="Expiring JSAs" count={expiring.length} empty="None expiring soon">
        {expiring.slice(0, 4).map(j => {
          const d = daysUntil(j.review_due_at);
          return <QueueItem key={j.id} onDark icon="fa-hourglass-half" ref={j.ref} title={j.title}
            tag={`${d}d`} tagTone="warning" onClick={() => onJsa(j)} />;
        })}
      </Panel>
      <Panel icon="fa-file-shield" title="Permit Required" count={permitReq.length} empty="All permits linked">
        {permitReq.slice(0, 4).map(j => (
          <QueueItem key={j.id} onDark icon="fa-file-shield" ref={j.ref} title={j.title}
            tag="Check permit" tagTone="warning" onClick={() => onJsa(j)} />
        ))}
      </Panel>
      <Panel icon="fa-user-graduate" title="Training / PPE Gaps" count={trainingGaps.length} empty="No training gaps">
        {trainingGaps.slice(0, 4).map(j => (
          <QueueItem key={j.id} onDark icon="fa-user-graduate" ref={j.ref} title={j.title}
            tag="Review" tagTone="neutral" onClick={() => onJsa(j)} />
        ))}
      </Panel>
    </Shell>
  );
}
