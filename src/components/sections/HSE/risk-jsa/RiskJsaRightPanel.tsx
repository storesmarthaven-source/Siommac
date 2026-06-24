/**
 * src/components/sections/HSE/risk-jsa/RiskJsaRightPanel.tsx
 *
 * The right-side supporting panel — it CHANGES by active tab (spec §5.3, §6.3, §7.3):
 *   Hazard Register   → High Risk Queue · Overdue Reviews · Control Gaps
 *   Risk Assessments  → Approval Queue · Residual Risk Watch · Expiring Assessments
 *   JSA Library       → Expiring JSAs · Permit Required · Training / PPE Gaps
 *
 * Uses the kit `SidePanel`: owq header + tab strip (All + one tab per section)
 * that filters the navy signals list. Clicking a signal opens the matching
 * drawer. Fields not yet in the lists (permit links, training gaps) use proxies
 * until /summary is extended.
 */

import { type VNode } from 'preact';
import {
  useHazards, useAssessments, useJsaList,
  type HazardRow, type AssessmentRow, type JsaRow,
} from '@api/hse/riskJsa';
import { SidePanel, type SidePanelSection } from '@ui';

function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  return Math.round((new Date(iso).getTime() - Date.now()) / 86400000);
}
const isHighRisk = (lvl: string) => lvl === 'high' || lvl === 'critical';

type IconTone = 'is-danger' | 'is-warn' | 'is-ok' | 'is-info';
type TagTone  = 'is-high' | 'is-due' | 'is-ok' | 'is-info';

/** One signal row: icon + title/sub + tag. */
function Signal({ icon, iconTone, title, sub, tag, tagTone, onClick }: {
  icon: string; iconTone: IconTone; title: string; sub: string;
  tag: string; tagTone: TagTone; onClick: () => void;
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
  const overdue  = hz.filter(h => { const d = daysUntil(h.review_due_at); return d !== null && d < 0; });
  const gaps     = hz.filter(h => h.status === 'controls_required' || h.status === 'assessment_required');

  const sections: SidePanelSection[] = [
    {
      id: 'high', label: 'High', icon: 'fa-circle-exclamation', title: 'High Risk Queue',
      count: highRisk.length, empty: 'No high-risk hazards',
      children: highRisk.slice(0, 5).map(h => (
        <Signal key={h.id} icon="fa-radiation" iconTone={h.risk_level === 'critical' ? 'is-danger' : 'is-warn'}
          title={`${h.ref} · ${h.category}`} sub={h.title}
          tag={h.risk_level === 'critical' ? 'Critical' : 'High'} tagTone={h.risk_level === 'critical' ? 'is-high' : 'is-due'}
          onClick={() => onHazard(h)} />
      )),
    },
    {
      id: 'overdue', label: 'Overdue', icon: 'fa-clock', title: 'Overdue Reviews',
      count: overdue.length, empty: 'All reviews current',
      children: overdue.slice(0, 4).map(h => (
        <Signal key={h.id} icon="fa-clock" iconTone="is-danger" title={h.ref} sub={h.title}
          tag={`${Math.abs(daysUntil(h.review_due_at) ?? 0)}d over`} tagTone="is-high" onClick={() => onHazard(h)} />
      )),
    },
    {
      id: 'gaps', label: 'Gaps', icon: 'fa-shield-halved', title: 'Control Gaps',
      count: gaps.length, empty: 'All hazards have controls',
      children: gaps.slice(0, 3).map(h => (
        <Signal key={h.id} icon="fa-triangle-exclamation" iconTone="is-warn" title={h.ref} sub={h.title}
          tag={h.status === 'controls_required' ? 'Controls due' : 'Assess'} tagTone="is-due" onClick={() => onHazard(h)} />
      )),
    },
  ];

  return <SidePanel title="Hazard Signals" icon="fa-bell" sections={sections} />;
}

// ── Assessments ─────────────────────────────────────────────────────────────────

function AssessmentPanel({ onAssessment }: { onAssessment: (a: AssessmentRow) => void }): VNode {
  const list = useAssessments({}).data?.data ?? [];
  const approval = list.filter(a => a.status === 'under_review' || a.status === 'submitted');
  const residual = list.filter(a => isHighRisk(a.risk_level));
  const expiring = list.filter(a => { const d = daysUntil(a.review_due_at); return a.status === 'expired' || (d !== null && d >= 0 && d <= 7); });

  const sections: SidePanelSection[] = [
    {
      id: 'approval', label: 'Approval', icon: 'fa-clipboard-check', title: 'Approval Queue',
      count: approval.length, empty: 'Nothing awaiting review',
      children: approval.slice(0, 5).map(a => (
        <Signal key={a.id} icon="fa-clipboard-check" iconTone="is-info" title={a.ref} sub={a.title}
          tag="Under review" tagTone="is-info" onClick={() => onAssessment(a)} />
      )),
    },
    {
      id: 'residual', label: 'Residual', icon: 'fa-arrow-down-wide-short', title: 'Residual Risk Watch',
      count: residual.length, empty: 'No high residual risk',
      children: residual.slice(0, 4).map(a => (
        <Signal key={a.id} icon="fa-triangle-exclamation" iconTone={a.risk_level === 'critical' ? 'is-danger' : 'is-warn'}
          title={a.ref} sub={a.title}
          tag={a.risk_level === 'critical' ? 'Critical' : 'High'} tagTone={a.risk_level === 'critical' ? 'is-high' : 'is-due'}
          onClick={() => onAssessment(a)} />
      )),
    },
    {
      id: 'expiring', label: 'Expiring', icon: 'fa-hourglass-half', title: 'Expiring Assessments',
      count: expiring.length, empty: 'None expiring soon',
      children: expiring.slice(0, 4).map(a => {
        const d = daysUntil(a.review_due_at);
        return <Signal key={a.id} icon="fa-hourglass-half" iconTone="is-warn" title={a.ref} sub={a.title}
          tag={a.status === 'expired' ? 'Expired' : `${d}d`} tagTone="is-due" onClick={() => onAssessment(a)} />;
      }),
    },
  ];

  return <SidePanel title="Assessment Signals" icon="fa-bell" sections={sections} />;
}

// ── JSA ─────────────────────────────────────────────────────────────────────────

function JsaPanel({ onJsa }: { onJsa: (j: JsaRow) => void }): VNode {
  const list = useJsaList({}).data?.data ?? [];
  const expiring     = list.filter(j => { const d = daysUntil(j.review_due_at); return d !== null && d >= 0 && d <= 7; });
  const permitReq    = list.filter(j => isHighRisk(j.risk_level) && j.status === 'active'); // proxy: high-risk active jobs likely need a permit
  const trainingGaps = list.filter(j => j.status === 'draft' || j.status === 'returned');   // proxy until training links land

  const sections: SidePanelSection[] = [
    {
      id: 'expiring', label: 'Expiring', icon: 'fa-hourglass-half', title: 'Expiring JSAs',
      count: expiring.length, empty: 'None expiring soon',
      children: expiring.slice(0, 4).map(j => {
        const d = daysUntil(j.review_due_at);
        return <Signal key={j.id} icon="fa-hourglass-half" iconTone="is-warn" title={j.ref} sub={j.title}
          tag={`${d}d`} tagTone="is-due" onClick={() => onJsa(j)} />;
      }),
    },
    {
      id: 'permit', label: 'Permit', icon: 'fa-file-shield', title: 'Permit Required',
      count: permitReq.length, empty: 'All permits linked',
      children: permitReq.slice(0, 4).map(j => (
        <Signal key={j.id} icon="fa-file-shield" iconTone="is-warn" title={j.ref} sub={j.title}
          tag="Check permit" tagTone="is-due" onClick={() => onJsa(j)} />
      )),
    },
    {
      id: 'training', label: 'Training', icon: 'fa-user-graduate', title: 'Training / PPE Gaps',
      count: trainingGaps.length, empty: 'No training gaps',
      children: trainingGaps.slice(0, 4).map(j => (
        <Signal key={j.id} icon="fa-user-graduate" iconTone="is-info" title={j.ref} sub={j.title}
          tag="Review" tagTone="is-info" onClick={() => onJsa(j)} />
      )),
    },
  ];

  return <SidePanel title="JSA Signals" icon="fa-bell" sections={sections} />;
}
