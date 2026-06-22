/**
 * src/components/sections/HSE/RiskJsa.tsx
 *
 * Risk & JSA Management — real-data wired.
 * Three-tab structure: Hazard Register · Risk Assessments · JSA Library
 * Right-side: High Risk Queue + Overdue Assessments (from backend summary)
 */

import { type VNode }   from 'preact';
import { useState, useCallback } from 'preact/hooks';
import {
  AreaHero, AreaTabs, withCounts, SparkCard, SectionHead,
  type AreaTab, type SparkDef,
} from '@ui';
import { HSE_SITES, riskRating, hsePill } from './types';
import {
  useRiskJsaSummary,
  useHazards,
  useHazardDetail,
  useAssessments,
  useAssessmentDetail,
  useJsaList,
  useJsaDetail,
  useCreateHazard,
  useCreateAssessment,
  useCreateJsa,
  useSubmitAssessment,
  useSubmitJsa,
  useCreateControl,
  type HazardRow,
  type AssessmentRow,
  type JsaRow,
  type RiskLevel,
  type JsaStep,
} from '@api/hse/riskJsa';

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS: AreaTab[] = [
  { key: 'hazards',     label: 'Hazard Register',  sublabel: 'All hazards',       icon: 'fa-radiation' },
  { key: 'assessments', label: 'Risk Assessments', sublabel: 'Matrix & controls',  icon: 'fa-table-cells-large' },
  { key: 'jsa',         label: 'JSA Library',      sublabel: 'Task analysis',     icon: 'fa-list-ol' },
];

const SCALE = [1, 2, 3, 4, 5] as const;

const HAZARD_CATEGORIES = [
  'Safety','Health','Environmental','Chemical','Biological',
  'Ergonomic','Mechanical','Electrical','Fire','Security','Process','Other',
] as const;

const ASSESSMENT_TYPES = [
  { value: 'general',      label: 'General Risk Assessment' },
  { value: 'task',         label: 'Task Risk Assessment' },
  { value: 'area',         label: 'Area Risk Assessment' },
  { value: 'equipment',    label: 'Equipment Risk Assessment' },
  { value: 'chemical',     label: 'Chemical Risk Assessment' },
  { value: 'permit_linked',label: 'Permit-Linked Assessment' },
  { value: 'change',       label: 'Change / Non-Routine Work' },
] as const;

const CONTROL_TYPES = [
  { value: 'elimination',       label: 'Elimination' },
  { value: 'substitution',      label: 'Substitution' },
  { value: 'engineering',       label: 'Engineering' },
  { value: 'administrative',    label: 'Administrative' },
  { value: 'ppe',               label: 'PPE' },
  { value: 'emergency_response',label: 'Emergency Response' },
] as const;

const PPE_ITEMS = [
  'Hard hat','Safety glasses','Gloves','Safety boots','Hearing protection',
  'Respirator','Face shield','Harness','High visibility vest','Chemical apron',
] as const;

// ── Risk helpers ──────────────────────────────────────────────────────────────

function riskLevelFrom(score: number): RiskLevel {
  if (score >= 20) return 'critical';
  if (score >= 10) return 'high';
  if (score >= 6)  return 'medium';
  return 'low';
}

function riskPill(likelihood: number, severity: number): VNode {
  const score = likelihood * severity;
  const level = riskLevelFrom(score);
  const cls   = level === 'critical' ? 'is-off'
              : level === 'high'     ? 'is-warn'
              : level === 'medium'   ? 'is-amber'
              : 'is-on';
  const band  = level === 'critical' ? 'Critical'
              : level === 'high'     ? 'High'
              : level === 'medium'   ? 'Medium'
              : 'Low';
  return <span class={`vt-pill ${cls}`}>{band} · {score}</span>;
}

function riskPillFromLevel(level: RiskLevel, score?: number | null): VNode {
  const cls  = level === 'critical' ? 'is-off'
             : level === 'high'     ? 'is-warn'
             : level === 'medium'   ? 'is-amber'
             : 'is-on';
  const band = level.charAt(0).toUpperCase() + level.slice(1);
  return <span class={`vt-pill ${cls}`}>{band}{score != null ? ` · ${score}` : ''}</span>;
}

// ── Root component ────────────────────────────────────────────────────────────

export function RiskJsaArea({ tab }: { tab: string }): VNode {
  const [active,          setActive]          = useState(tab);
  const [hazardFormOpen,  setHazardFormOpen]  = useState(false);
  const [raFormOpen,      setRaFormOpen]      = useState(false);
  const [jsaFormOpen,     setJsaFormOpen]     = useState(false);
  const [selectedHazard,  setSelectedHazard]  = useState<HazardRow | null>(null);
  const [selectedRa,      setSelectedRa]      = useState<AssessmentRow | null>(null);
  const [selectedJsa,     setSelectedJsa]     = useState<JsaRow | null>(null);

  const { data: summaryRes, isLoading: summaryLoading } = useRiskJsaSummary();
  const summary = summaryRes?.data;

  const totalHazards       = summary?.totalHazards           ?? 0;
  const highCritical       = summary?.highCriticalHazards    ?? 0;
  const openAssessments    = summary?.openAssessments        ?? 0;
  const openJsa            = summary?.openJsa                ?? 0;
  const riskReductionPct   = summary?.riskReductionPct       ?? 0;
  const overdueAssessments = summary?.overdueAssessments     ?? 0;

  const stats: SparkDef['label'] extends string ? Array<{ icon: string; label: string; value: number | string; sub: string; color: 'blue' | 'gold' | 'red' | 'green' }> : never = [
    { icon: 'fa-radiation',            label: 'Hazards',          value: totalHazards,    sub: 'on register',   color: 'blue'  },
    { icon: 'fa-table-cells-large',    label: 'Assessments',      value: openAssessments, sub: 'open',          color: 'gold'  },
    { icon: 'fa-triangle-exclamation', label: 'High / Critical',  value: highCritical,    sub: 'need controls', color: 'red'   },
    { icon: 'fa-list-ol',              label: 'JSAs',             value: openJsa,         sub: 'active',        color: 'green' },
  ] as const;

  const sparks: SparkDef[] = [
    {
      label: 'Hazard Register', value: String(totalHazards), sub: 'Total hazards on file',
      delta: `${highCritical} high/critical`, deltaUp: highCritical > 0, color: '#60a5fa',
      sparkPoints: [0, 0, 0, 0, 0, totalHazards], sparkColor: '#60a5fa',
    },
    {
      label: 'High / Critical Risk', value: String(highCritical), sub: `${totalHazards > 0 ? Math.round((highCritical / totalHazards) * 100) : 0}% of register`,
      delta: overdueAssessments > 0 ? `${overdueAssessments} overdue` : 'All reviewed',
      deltaUp: overdueAssessments > 0, color: highCritical > 0 ? '#ef4444' : '#4ade80',
      sparkPoints: [0, 0, 0, 0, 0, highCritical], sparkColor: '#ef4444',
    },
    {
      label: 'Risk Reduction', value: `${riskReductionPct}%`, sub: 'Hazards at acceptable level',
      progress: { pct: riskReductionPct, color: '#22c55e', target: 'Target: 80%' },
    },
    {
      label: 'Open JSAs', value: String(openJsa), sub: 'Active / under review',
      delta: openAssessments > 0 ? `${openAssessments} assessments open` : 'All current',
      deltaUp: false, color: '#4ade80',
      sparkPoints: [0, 0, 0, 0, 0, openJsa], sparkColor: '#4ade80',
    },
  ];

  const tabsWithCounts = withCounts(TABS, {
    hazards:     totalHazards,
    assessments: openAssessments,
    jsa:         openJsa,
  });

  const handleTabAction = useCallback(() => {
    if (active === 'hazards')     setHazardFormOpen(true);
    if (active === 'assessments') setRaFormOpen(true);
    if (active === 'jsa')         setJsaFormOpen(true);
  }, [active]);

  const actionLabel = active === 'hazards'     ? 'New Hazard'
                    : active === 'assessments' ? 'New Assessment'
                    : 'New JSA';

  return (
    <div class="hse-tab hse-dash">
      <AreaHero
        icon="fa-radiation"
        areaIcon="fa-shield-halved"
        title="Risk & JSA"
        watermarkClass="hse-wm-risk"
        stats={stats as never}
        footerItems={[
          { icon: 'fa-scale-balanced', label: 'Risk Matrix', value: '5×5 Standard', pill: '● Active', pillVariant: 'green' },
          { icon: 'fa-triangle-exclamation', label: 'High / Critical Risks', value: String(highCritical), sub: ' hazards', trend: overdueAssessments > 0 ? `${overdueAssessments} overdue` : undefined, trendUp: false },
          { icon: 'fa-chart-bar', label: 'Risk Reduction', value: `${riskReductionPct}% acceptable`, progress: riskReductionPct },
          { icon: 'fa-calendar-alt', label: 'Review Cycle', value: 'Annual / On Change', pill: '● Monitoring', pillVariant: 'amber' },
        ]}
      />

      <div class="hse-spark-grid">
        {sparks.map((s, i) => <SparkCard key={i} spark={s} />)}
      </div>

      <div class="hse-main-grid">
        <div class="hse-left-col">
          <AreaTabs
            icon="fa-shield-halved"
            title="Risk & JSA Management"
            sub="Hazard register, risk assessments, and job safety analyses"
            tabs={tabsWithCounts} active={active} onSelect={setActive}
            actionLabel={actionLabel} onAction={handleTabAction}
          />

          {active === 'hazards' && (
            <HazardTab
              onNewHazard={() => setHazardFormOpen(true)}
              onSelect={setSelectedHazard}
              selected={selectedHazard}
            />
          )}
          {active === 'assessments' && (
            <AssessmentsTab
              onNew={() => setRaFormOpen(true)}
              onSelect={setSelectedRa}
              selected={selectedRa}
              onSubmit={(id) => { setSelectedRa(null); void id; }}
            />
          )}
          {active === 'jsa' && (
            <JsaTab
              onNew={() => setJsaFormOpen(true)}
              onSelect={setSelectedJsa}
              selected={selectedJsa}
            />
          )}
        </div>

        {/* Right-side risk queue */}
        <div class="hse-right-col">
          <RiskQueuePanel
            highRisk={summary?.highRiskQueue ?? []}
            overdueDetail={summary?.overdueAssessmentsDetail ?? []}
            loading={summaryLoading}
            onHazardClick={setSelectedHazard}
          />
        </div>
      </div>

      {/* Dialogs */}
      {hazardFormOpen && (
        <NewHazardDialog onClose={() => setHazardFormOpen(false)} />
      )}
      {raFormOpen && (
        <NewAssessmentWizard onClose={() => setRaFormOpen(false)} />
      )}
      {jsaFormOpen && (
        <NewJsaWizard onClose={() => setJsaFormOpen(false)} />
      )}

      {/* Drawers */}
      {selectedHazard && (
        <HazardDrawer hazard={selectedHazard} onClose={() => setSelectedHazard(null)} />
      )}
      {selectedRa && (
        <AssessmentDrawer assessment={selectedRa} onClose={() => setSelectedRa(null)} />
      )}
      {selectedJsa && (
        <JsaDrawer jsa={selectedJsa} onClose={() => setSelectedJsa(null)} />
      )}
    </div>
  );
}

// ── Right-side queue panel ─────────────────────────────────────────────────────

function RiskQueuePanel({
  highRisk, overdueDetail, loading, onHazardClick,
}: {
  highRisk:       HazardRow[];
  overdueDetail:  Array<{ id: string; ref: string; title: string; review_due_at: string; status: string }>;
  loading:        boolean;
  onHazardClick:  (h: HazardRow) => void;
}): VNode {
  return (
    <div class="oq-dark-card">
      <div class="oq-dark-header">
        <i class="fas fa-exclamation-circle" />
        <span>High Risk Queue</span>
        <span class="oq-dark-count">{highRisk.length}</span>
      </div>
      <div class="oq-dark-vertical">
        {loading && <div style={{ padding: '16px 0', textAlign: 'center', color: 'rgba(241,245,249,.4)', fontSize: '0.75rem' }}>Loading…</div>}
        {!loading && highRisk.length === 0 && (
          <div style={{ padding: '16px 0', textAlign: 'center', color: 'rgba(241,245,249,.4)', fontSize: '0.75rem' }}>No high-risk hazards</div>
        )}
        {highRisk.slice(0, 5).map(h => (
          <button key={h.id} class="oq-dark-item" onClick={() => onHazardClick(h)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer' }}>
            <div class="icon-badge red"><i class="fas fa-radiation" /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#f1f5f9' }}>{h.ref} — {h.category}</div>
              <div style={{ fontSize: '0.65rem', color: 'rgba(241,245,249,.55)', marginTop: '2px' }}>{h.title.slice(0, 48)}{h.title.length > 48 ? '…' : ''}</div>
            </div>
            <span class={`oq-dark-tag ${h.risk_level === 'critical' ? 'danger' : 'warning'}`}>
              {h.risk_level.charAt(0).toUpperCase() + h.risk_level.slice(1)}
            </span>
          </button>
        ))}
      </div>
      <div class="oq-dark-header" style={{ marginTop: '12px' }}>
        <i class="fas fa-clock" />
        <span>Overdue Assessments</span>
        <span class="oq-dark-count">{overdueDetail.length}</span>
      </div>
      <div class="oq-dark-vertical">
        {!loading && overdueDetail.length === 0 && (
          <div style={{ padding: '12px 0', textAlign: 'center', color: 'rgba(241,245,249,.4)', fontSize: '0.75rem' }}>All assessments current</div>
        )}
        {overdueDetail.slice(0, 4).map(a => (
          <div class="oq-dark-item" key={a.id}>
            <div class="icon-badge amber"><i class="fas fa-clock" /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#f1f5f9' }}>{a.ref}</div>
              <div style={{ fontSize: '0.65rem', color: 'rgba(241,245,249,.55)', marginTop: '2px' }}>{a.title.slice(0, 40)}</div>
            </div>
            <span class="oq-dark-tag warning">Overdue</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Hazard Register tab ───────────────────────────────────────────────────────

function HazardTab({
  onNewHazard, onSelect, selected,
}: {
  onNewHazard: () => void;
  onSelect:    (h: HazardRow) => void;
  selected:    HazardRow | null;
}): VNode {
  const [search,    setSearch]    = useState('');
  const [category,  setCategory]  = useState('');
  const [siteId,    setSiteId]    = useState('');
  const [riskLevel, setRiskLevel] = useState('');

  const { data, isLoading } = useHazards({
    search:    search || undefined,
    category:  category  || undefined,
    siteId:    siteId    || undefined,
    riskLevel: riskLevel || undefined,
  });
  const hazards = data?.data ?? [];

  const byCategory = hazards.reduce<Record<string, number>>((acc, h) => {
    acc[h.category] = (acc[h.category] ?? 0) + 1;
    return acc;
  }, {});
  const highRisk = hazards.filter(h => h.risk_level === 'high' || h.risk_level === 'critical');

  return (
    <div class="hse-area-split">
      <div class="hse-area-main">
        <SectionHead icon="fa-radiation" title="Hazard Register" sub="Identified hazards with likelihood × severity risk ratings." actions={
          <button class="hse-btn primary" onClick={onNewHazard}><i class="fas fa-circle-plus" /> New Hazard</button>
        } />
        <div class="vt-toolbar">
          <div class="vt-search" style={{ flex: '1 1 200px' }}>
            <i class="fas fa-search" />
            <input type="search" placeholder="Search hazards…" value={search} onInput={e => setSearch((e.target as HTMLInputElement).value)} />
          </div>
          <select class="emp-filter-select" value={category} onChange={e => setCategory((e.target as HTMLSelectElement).value)}>
            <option value="">All categories</option>
            {HAZARD_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select class="emp-filter-select" value={siteId} onChange={e => setSiteId((e.target as HTMLSelectElement).value)}>
            <option value="">All sites</option>
            {HSE_SITES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select class="emp-filter-select" value={riskLevel} onChange={e => setRiskLevel((e.target as HTMLSelectElement).value)}>
            <option value="">All risk levels</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
        <div class="vt-table-card">
          <div class="vt-table-scroll">
            <table class="vt-table">
              <thead>
                <tr>
                  <th>Ref</th><th>Hazard</th><th>Category</th><th>Site</th>
                  <th>L × S</th><th>Risk</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>Loading hazards…</td></tr>
                )}
                {!isLoading && hazards.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>No hazards found</td></tr>
                )}
                {hazards.map(h => (
                  <tr key={h.id} onClick={() => onSelect(h)} style={{ cursor: 'pointer' }}
                      class={selected?.id === h.id ? 'vt-row-active' : ''}>
                    <td><span class="vt-cell-mono">{h.ref}</span></td>
                    <td><span class="vt-cell-name">{h.title}</span></td>
                    <td>{h.category}</td>
                    <td class="hse-muted">{h.site_id ?? '—'}</td>
                    <td class="hse-muted">{h.initial_likelihood} × {h.initial_severity}</td>
                    <td>{riskPill(h.initial_likelihood, h.initial_severity)}</td>
                    <td><span class={hsePill(h.status)}>{h.status.replace(/_/g, ' ')}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <aside class="hse-area-aside">
        {highRisk.length > 0 && (
          <div class="hse-aside-card hse-aside-alert">
            <div class="hse-aside-head is-danger"><i class="fas fa-triangle-exclamation" /><span>{highRisk.length} High / Critical Hazards</span></div>
            <div class="hse-aside-list">
              {highRisk.slice(0, 6).map(h => (
                <div class="hse-aside-row" key={h.id}>
                  <i class="fas fa-circle hse-aside-dot is-danger" />
                  <div class="hse-aside-text">
                    <strong>{h.title}</strong>
                    <span>{h.site_id ?? 'All sites'} · Score {h.initial_score}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div class="hse-aside-card">
          <div class="hse-aside-head"><i class="fas fa-chart-bar" /><span>By Category</span></div>
          {Object.entries(byCategory).map(([cat, count]) => (
            <div class="hse-priority-bar" key={cat}>
              <div class="hse-priority-label"><span class="hse-priority-name">{cat}</span><span>{count}</span></div>
              <div class="hse-progress"><i style={{ width: `${hazards.length > 0 ? Math.round((count / hazards.length) * 100) : 0}%`, background: 'var(--siomac-navy)' }} /></div>
            </div>
          ))}
          {Object.keys(byCategory).length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', padding: '8px 0' }}>No hazards registered</p>}
        </div>
      </aside>
    </div>
  );
}

// ── Risk Assessments tab ──────────────────────────────────────────────────────

function AssessmentsTab({
  onNew, onSelect, selected, onSubmit,
}: {
  onNew:    () => void;
  onSelect: (a: AssessmentRow) => void;
  selected: AssessmentRow | null;
  onSubmit: (id: string) => void;
}): VNode {
  const [siteId, setSiteId] = useState('');
  const [status, setStatus] = useState('');
  const submitAssessment    = useSubmitAssessment();

  const { data, isLoading } = useAssessments({ siteId: siteId || undefined, status: status || undefined });
  const assessments = data?.data ?? [];

  const highCrit   = assessments.filter(a => a.risk_level === 'high' || a.risk_level === 'critical').length;
  const underRev   = assessments.filter(a => a.status === 'under_review' || a.status === 'submitted').length;
  const approved   = assessments.filter(a => a.status === 'approved' || a.status === 'active').length;

  return (
    <div class="hse-area-split">
      <div class="hse-area-main">
        <SectionHead icon="fa-table-cells-large" title="Risk Assessments" sub="Formal risk assessments with likelihood × severity matrix scoring." actions={
          <button class="hse-btn primary" onClick={onNew}><i class="fas fa-circle-plus" /> New Assessment</button>
        } />
        <div class="vt-toolbar">
          <select class="emp-filter-select" value={status} onChange={e => setStatus((e.target as HTMLSelectElement).value)}>
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="under_review">Under Review</option>
            <option value="approved">Approved</option>
            <option value="returned">Returned</option>
          </select>
          <select class="emp-filter-select" value={siteId} onChange={e => setSiteId((e.target as HTMLSelectElement).value)}>
            <option value="">All sites</option>
            {HSE_SITES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div class="vt-table-card">
          <div class="vt-table-scroll">
            <table class="vt-table">
              <thead>
                <tr><th>Ref</th><th>Title</th><th>Type</th><th>Site</th><th>Risk</th><th>Status</th><th>Review Due</th></tr>
              </thead>
              <tbody>
                {isLoading && <tr><td colSpan={7} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>Loading…</td></tr>}
                {!isLoading && assessments.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>No assessments found</td></tr>
                )}
                {assessments.map(a => (
                  <tr key={a.id} onClick={() => onSelect(a)} style={{ cursor: 'pointer' }}
                      class={selected?.id === a.id ? 'vt-row-active' : ''}>
                    <td><span class="vt-cell-mono">{a.ref}</span></td>
                    <td><span class="vt-cell-name">{a.title}</span></td>
                    <td class="hse-muted" style={{ fontSize: '0.72rem' }}>{a.assessment_type.replace(/_/g, ' ')}</td>
                    <td class="hse-muted">{a.site_id ?? '—'}</td>
                    <td>{riskPillFromLevel(a.risk_level, a.initial_score)}</td>
                    <td><span class={hsePill(a.status)}>{a.status.replace(/_/g, ' ')}</span></td>
                    <td class="hse-muted" style={{ fontSize: '0.72rem' }}>
                      {a.review_due_at ? new Date(a.review_due_at).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <aside class="hse-area-aside">
        <RiskMatrixPanel assessments={assessments} />
        <div class="hse-aside-card hse-aside-stats">
          <div class="hse-aside-stat"><strong>{highCrit}</strong><span>High / Critical</span></div>
          <div class="hse-aside-stat"><strong>{underRev}</strong><span>Under Review</span></div>
          <div class="hse-aside-stat"><strong>{approved}</strong><span>Approved</span></div>
        </div>
        {selected?.status === 'draft' && (
          <div class="hse-aside-card">
            <div class="hse-aside-head"><i class="fas fa-paper-plane" /><span>Submit {selected.ref}</span></div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '4px 0 10px' }}>Send for HSE review and approval.</p>
            <button
              class="hse-btn primary"
              style={{ width: '100%' }}
              disabled={submitAssessment.isPending}
              onClick={() => submitAssessment.mutate({ assessmentId: selected.id })}
            >
              {submitAssessment.isPending ? 'Submitting…' : 'Submit for Review'}
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}

// ── JSA Library tab ───────────────────────────────────────────────────────────

function JsaTab({
  onNew, onSelect, selected,
}: {
  onNew:    () => void;
  onSelect: (j: JsaRow) => void;
  selected: JsaRow | null;
}): VNode {
  const [siteId, setSiteId] = useState('');
  const [status, setStatus] = useState('');
  const submitJsa           = useSubmitJsa();

  const { data, isLoading } = useJsaList({ siteId: siteId || undefined, status: status || undefined });
  const jsas = data?.data ?? [];

  const approvedCount = jsas.filter(j => j.status === 'approved' || j.status === 'active').length;
  const reviewCount   = jsas.filter(j => j.status === 'submitted' || j.status === 'hse_review').length;
  const draftCount    = jsas.filter(j => j.status === 'draft').length;

  return (
    <div class="hse-area-split">
      <div class="hse-area-main">
        <SectionHead icon="fa-list-ol" title="JSA Library" sub="Job Safety Analyses — step-by-step hazard identification per task." actions={
          <button class="hse-btn primary" onClick={onNew}><i class="fas fa-circle-plus" /> New JSA</button>
        } />
        <div class="vt-toolbar">
          <select class="emp-filter-select" value={status} onChange={e => setStatus((e.target as HTMLSelectElement).value)}>
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
            <option value="active">Active</option>
          </select>
          <select class="emp-filter-select" value={siteId} onChange={e => setSiteId((e.target as HTMLSelectElement).value)}>
            <option value="">All sites</option>
            {HSE_SITES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div class="vt-table-card">
          <div class="vt-table-scroll">
            <table class="vt-table">
              <thead>
                <tr><th>Ref</th><th>Job / Task</th><th>Site</th><th>Steps</th><th>Risk</th><th>Status</th><th>Review Due</th></tr>
              </thead>
              <tbody>
                {isLoading && <tr><td colSpan={7} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>Loading…</td></tr>}
                {!isLoading && jsas.length === 0 && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>No JSAs found</td></tr>
                )}
                {jsas.map(j => (
                  <tr key={j.id} onClick={() => onSelect(j)} style={{ cursor: 'pointer' }}
                      class={selected?.id === j.id ? 'vt-row-active' : ''}>
                    <td><span class="vt-cell-mono">{j.ref}</span></td>
                    <td><span class="vt-cell-name">{j.title}</span></td>
                    <td class="hse-muted">{j.site_id ?? '—'}</td>
                    <td class="hse-muted">{j.stepCount} steps</td>
                    <td>{riskPillFromLevel(j.risk_level)}</td>
                    <td><span class={hsePill(j.status)}>{j.status.replace(/_/g, ' ')}</span></td>
                    <td class="hse-muted" style={{ fontSize: '0.72rem' }}>
                      {j.review_due_at ? new Date(j.review_due_at).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <aside class="hse-area-aside">
        {selected ? (
          <div class="hse-aside-card">
            <div class="hse-aside-head"><i class="fas fa-list-ol" /><span>{selected.ref}</span></div>
            <div class="hse-aside-meta">
              <span class={hsePill(selected.status)}>{selected.status.replace(/_/g, ' ')}</span>
              {selected.review_due_at && <span class="hse-muted">Due: {new Date(selected.review_due_at).toLocaleDateString()}</span>}
            </div>
            <div style={{ padding: '10px 0 4px', display: 'grid', gap: '8px' }}>
              <div class="hse-aside-detail-row"><i class="fas fa-tasks" /><div><strong>Task</strong><span>{selected.title}</span></div></div>
              <div class="hse-aside-detail-row"><i class="fas fa-map-marker-alt" /><div><strong>Site</strong><span>{selected.site_id ?? '—'}</span></div></div>
              <div class="hse-aside-detail-row"><i class="fas fa-list-ol" /><div><strong>Steps</strong><span>{selected.stepCount} documented</span></div></div>
              <div class="hse-aside-detail-row"><i class="fas fa-shield-alt" /><div><strong>Risk Level</strong><span>{selected.risk_level}</span></div></div>
            </div>
            {selected.status === 'draft' && (
              <button
                class="hse-btn primary"
                style={{ width: '100%', marginTop: '10px' }}
                disabled={submitJsa.isPending}
                onClick={() => submitJsa.mutate({ jsaId: selected.id })}
              >
                {submitJsa.isPending ? 'Submitting…' : 'Submit for Review'}
              </button>
            )}
          </div>
        ) : (
          <div class="hse-aside-card hse-aside-hint">
            <i class="fas fa-arrow-pointer" />
            <strong>Select a JSA</strong>
            <p>Click a row to view the JSA detail in this panel.</p>
          </div>
        )}
        <div class="hse-aside-card">
          <div class="hse-aside-head"><i class="fas fa-chart-pie" /><span>JSA Status Summary</span></div>
          <div class="hse-aside-stats">
            <div class="hse-aside-stat"><strong>{approvedCount}</strong><span>Approved</span></div>
            <div class="hse-aside-stat"><strong>{reviewCount}</strong><span>In Review</span></div>
            <div class="hse-aside-stat"><strong>{draftCount}</strong><span>Draft</span></div>
          </div>
        </div>
      </aside>
    </div>
  );
}

// ── 5×5 Risk Matrix panel ─────────────────────────────────────────────────────

function RiskMatrixPanel({ assessments }: { assessments: AssessmentRow[] }): VNode {
  const counts = new Map<string, number>();
  for (const a of assessments) {
    if (a.initial_score) {
      const r = riskRating(Math.ceil(Math.sqrt(a.initial_score)), Math.ceil(Math.sqrt(a.initial_score)));
      const l = Math.ceil(Math.sqrt(a.initial_score));
      const s = a.initial_score > 0 ? Math.ceil(a.initial_score / l) : 1;
      const k = `${l}-${s}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return (
    <div class="hse-aside-card hse-matrix-card">
      <div class="hse-aside-head"><i class="fas fa-table-cells-large" /><span>Risk Matrix · L × S</span></div>
      <div class="hse-matrix">
        <div class="hse-matrix-corner">L \ S</div>
        {SCALE.map(s => <div class="hse-matrix-axis" key={`s${s}`}>{s}</div>)}
        {[...SCALE].reverse().map(l => (
          <>
            <div class="hse-matrix-axis" key={`l${l}`}>{l}</div>
            {SCALE.map(s => {
              const r = riskRating(l, s);
              const n = counts.get(`${l}-${s}`) ?? 0;
              return (
                <div class={`hse-matrix-cell tone-${r.severity}`} key={`${l}-${s}`} title={`${r.band} (${r.score})`}>
                  {n > 0 ? <span class="hse-matrix-dot">{n}</span> : ''}
                </div>
              );
            })}
          </>
        ))}
      </div>
      <div class="hse-matrix-legend">
        <span><i class="tone-success" /> Low</span>
        <span><i class="tone-warning" /> Medium</span>
        <span><i class="tone-danger" /> High / Critical</span>
      </div>
    </div>
  );
}

// ── New Hazard Dialog ─────────────────────────────────────────────────────────

function NewHazardDialog({ onClose }: { onClose: () => void }): VNode {
  const [step,      setStep]      = useState(0);
  const [title,     setTitle]     = useState('');
  const [desc,      setDesc]      = useState('');
  const [category,  setCategory]  = useState<string>(HAZARD_CATEGORIES[0]!);
  const [site,      setSite]      = useState('');
  const [likelihood,setLikelihood]= useState(3);
  const [severity,  setSeverity]  = useState(3);
  const [controls,  setControls]  = useState<Array<{ description: string; controlType: string }>>([]);
  const [ctrlInput, setCtrlInput] = useState('');
  const [ctrlType,  setCtrlType]  = useState('administrative');
  const [error,     setError]     = useState('');

  const createHazard = useCreateHazard();
  const score  = likelihood * severity;
  const level  = riskLevelFrom(score);

  const steps = ['Hazard Details', 'Initial Risk Rating', 'Controls', 'Review'];

  function addControl() {
    if (!ctrlInput.trim()) return;
    setControls([...controls, { description: ctrlInput.trim(), controlType: ctrlType }]);
    setCtrlInput('');
  }

  async function submit() {
    if (!title.trim()) { setError('Title is required'); return; }
    setError('');
    try {
      await createHazard.mutateAsync({
        title, description: desc, category,
        siteId: site || null,
        initialLikelihood: likelihood,
        initialSeverity:   severity,
        controls,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create hazard');
    }
  }

  return (
    <div class="hse-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="hse-modal hse-modal-lg">
        <div class="hse-modal-header">
          <div>
            <h3 class="hse-modal-title">New Hazard</h3>
            <p class="hse-modal-sub">Step {step + 1} of {steps.length} — {steps[step]}</p>
          </div>
          <button class="hse-modal-close" onClick={onClose}><i class="fas fa-times" /></button>
        </div>

        {/* Step indicators */}
        <div style={{ display: 'flex', gap: '6px', padding: '0 20px 16px' }}>
          {steps.map((s, i) => (
            <div key={i} style={{
              flex: 1, height: '4px', borderRadius: '2px',
              background: i <= step ? 'var(--siomac-navy)' : 'var(--border)',
              transition: 'background .2s',
            }} />
          ))}
        </div>

        <div class="hse-modal-body">
          {step === 0 && (
            <div class="hse-form-grid">
              <div class="hse-form-field" style={{ gridColumn: '1 / -1' }}>
                <label class="hse-form-label">Hazard Title *</label>
                <input class="hse-form-input" value={title} onInput={e => setTitle((e.target as HTMLInputElement).value)} placeholder="e.g. Confined space atmosphere risk" />
              </div>
              <div class="hse-form-field" style={{ gridColumn: '1 / -1' }}>
                <label class="hse-form-label">Description</label>
                <textarea class="hse-form-input" rows={3} value={desc} onInput={e => setDesc((e.target as HTMLTextAreaElement).value)} placeholder="Describe the hazard and where it occurs" />
              </div>
              <div class="hse-form-field">
                <label class="hse-form-label">Category *</label>
                <select class="hse-form-input" value={category} onChange={e => setCategory((e.target as HTMLSelectElement).value)}>
                  {HAZARD_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div class="hse-form-field">
                <label class="hse-form-label">Site</label>
                <select class="hse-form-input" value={site} onChange={e => setSite((e.target as HTMLSelectElement).value)}>
                  <option value="">All sites / General</option>
                  {HSE_SITES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          )}

          {step === 1 && (
            <div class="hse-form-grid">
              <div class="hse-form-field">
                <label class="hse-form-label">Likelihood (1–5)</label>
                <select class="hse-form-input" value={String(likelihood)} onChange={e => setLikelihood(Number((e.target as HTMLSelectElement).value))}>
                  {SCALE.map(n => <option key={n} value={n}>{n} — {['Remote','Unlikely','Possible','Likely','Almost Certain'][n - 1]}</option>)}
                </select>
              </div>
              <div class="hse-form-field">
                <label class="hse-form-label">Severity (1–5)</label>
                <select class="hse-form-input" value={String(severity)} onChange={e => setSeverity(Number((e.target as HTMLSelectElement).value))}>
                  {SCALE.map(n => <option key={n} value={n}>{n} — {['Insignificant','Minor','Moderate','Major','Catastrophic'][n - 1]}</option>)}
                </select>
              </div>
              <div class="hse-form-field" style={{ gridColumn: '1 / -1' }}>
                <label class="hse-form-label">Derived Risk Rating</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0' }}>
                  {riskPill(likelihood, severity)}
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Score: {score} = {likelihood} × {severity}</span>
                </div>
                {(level === 'high' || level === 'critical') && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--color-danger)', margin: '4px 0 0' }}>
                    <i class="fas fa-triangle-exclamation" /> This hazard will require HSE review and approval workflow.
                  </p>
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                <input class="hse-form-input" style={{ flex: 1 }} value={ctrlInput}
                  onInput={e => setCtrlInput((e.target as HTMLInputElement).value)}
                  placeholder="Describe a control measure…" />
                <select class="hse-form-input" style={{ width: '180px' }} value={ctrlType}
                  onChange={e => setCtrlType((e.target as HTMLSelectElement).value)}>
                  {CONTROL_TYPES.map(ct => <option key={ct.value} value={ct.value}>{ct.label}</option>)}
                </select>
                <button class="hse-btn secondary" onClick={addControl}><i class="fas fa-plus" /></button>
              </div>
              {controls.length === 0 && (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center', padding: '20px 0' }}>No controls added yet</p>
              )}
              <div style={{ display: 'grid', gap: '6px' }}>
                {controls.map((c, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'var(--surface-alt)', borderRadius: '6px', fontSize: '0.8rem' }}>
                    <span style={{ flex: 1 }}>{c.description}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{c.controlType}</span>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                      onClick={() => setControls(controls.filter((_, j) => j !== i))}>
                      <i class="fas fa-times" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div style={{ display: 'grid', gap: '12px' }}>
              <div class="hse-aside-card" style={{ margin: 0 }}>
                <div class="hse-aside-head"><i class="fas fa-radiation" /><span>Hazard Summary</span></div>
                <div style={{ display: 'grid', gap: '8px', padding: '8px 0', fontSize: '0.82rem' }}>
                  <div><strong>Title:</strong> {title}</div>
                  <div><strong>Category:</strong> {category}</div>
                  <div><strong>Site:</strong> {site || 'All sites'}</div>
                  <div><strong>Risk Score:</strong> {likelihood} × {severity} = {score} {riskPill(likelihood, severity)}</div>
                  <div><strong>Controls:</strong> {controls.length} defined</div>
                </div>
              </div>
              {error && <p style={{ color: 'var(--color-danger)', fontSize: '0.8rem' }}><i class="fas fa-exclamation-triangle" /> {error}</p>}
            </div>
          )}
        </div>

        <div class="hse-modal-footer">
          {step > 0 && <button class="hse-btn secondary" onClick={() => setStep(step - 1)}>Back</button>}
          <div style={{ flex: 1 }} />
          <button class="hse-btn ghost" onClick={onClose}>Cancel</button>
          {step < steps.length - 1 && (
            <button class="hse-btn primary" onClick={() => {
              if (step === 0 && !title.trim()) { setError('Title is required'); return; }
              setError('');
              setStep(step + 1);
            }}>Next</button>
          )}
          {step === steps.length - 1 && (
            <button class="hse-btn primary" disabled={createHazard.isPending} onClick={() => void submit()}>
              {createHazard.isPending ? 'Creating…' : 'Create Hazard'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── New Risk Assessment Wizard ────────────────────────────────────────────────

function NewAssessmentWizard({ onClose }: { onClose: () => void }): VNode {
  const [step,         setStep]         = useState(0);
  const [assessType,   setAssessType]   = useState('general');
  const [title,        setTitle]        = useState('');
  const [desc,         setDesc]         = useState('');
  const [site,         setSite]         = useState('');
  const [reviewCycle,  setReviewCycle]  = useState('annual');
  const [reviewDue,    setReviewDue]    = useState('');
  const [likelihood,   setLikelihood]   = useState(3);
  const [severity,     setSeverity]     = useState(3);
  const [hazardDesc,   setHazardDesc]   = useState('');
  const [hazardCat,    setHazardCat]    = useState<string>(HAZARD_CATEGORIES[0]!);
  const [hazards,      setHazards]      = useState<Array<{ hazardDescription: string; category: string; initialLikelihood: number; initialSeverity: number }>>([]);
  const [error,        setError]        = useState('');

  const createAssessment = useCreateAssessment();
  const steps = ['Assessment Type', 'Scope', 'Hazards', 'Review & Submit'];

  function addHazard() {
    if (!hazardDesc.trim()) return;
    setHazards([...hazards, { hazardDescription: hazardDesc, category: hazardCat, initialLikelihood: likelihood, initialSeverity: severity }]);
    setHazardDesc('');
    setLikelihood(3);
    setSeverity(3);
  }

  async function submit() {
    if (!title.trim()) { setError('Title is required'); return; }
    setError('');
    try {
      await createAssessment.mutateAsync({
        assessmentType: assessType,
        title, description: desc,
        siteId: site || null,
        reviewCycle,
        reviewDueAt: reviewDue || null,
        hazards,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create assessment');
    }
  }

  return (
    <div class="hse-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="hse-modal hse-modal-lg">
        <div class="hse-modal-header">
          <div>
            <h3 class="hse-modal-title">New Risk Assessment</h3>
            <p class="hse-modal-sub">Step {step + 1} of {steps.length} — {steps[step]}</p>
          </div>
          <button class="hse-modal-close" onClick={onClose}><i class="fas fa-times" /></button>
        </div>

        <div style={{ display: 'flex', gap: '6px', padding: '0 20px 16px' }}>
          {steps.map((_, i) => (
            <div key={i} style={{ flex: 1, height: '4px', borderRadius: '2px', background: i <= step ? 'var(--siomac-navy)' : 'var(--border)', transition: 'background .2s' }} />
          ))}
        </div>

        <div class="hse-modal-body">
          {step === 0 && (
            <div class="hse-form-grid">
              <div class="hse-form-field" style={{ gridColumn: '1 / -1' }}>
                <label class="hse-form-label">Assessment Type *</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }}>
                  {ASSESSMENT_TYPES.map(at => (
                    <label key={at.value} style={{
                      display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px',
                      border: `2px solid ${assessType === at.value ? 'var(--siomac-navy)' : 'var(--border)'}`,
                      borderRadius: '8px', cursor: 'pointer', fontSize: '0.8rem', transition: 'border-color .15s',
                    }}>
                      <input type="radio" name="atype" value={at.value} checked={assessType === at.value}
                        onChange={() => setAssessType(at.value)} style={{ accentColor: 'var(--siomac-navy)' }} />
                      {at.label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div class="hse-form-grid">
              <div class="hse-form-field" style={{ gridColumn: '1 / -1' }}>
                <label class="hse-form-label">Assessment Title *</label>
                <input class="hse-form-input" value={title} onInput={e => setTitle((e.target as HTMLInputElement).value)} placeholder="e.g. Chemical storage area risk assessment" />
              </div>
              <div class="hse-form-field" style={{ gridColumn: '1 / -1' }}>
                <label class="hse-form-label">Description</label>
                <textarea class="hse-form-input" rows={2} value={desc} onInput={e => setDesc((e.target as HTMLTextAreaElement).value)} />
              </div>
              <div class="hse-form-field">
                <label class="hse-form-label">Site</label>
                <select class="hse-form-input" value={site} onChange={e => setSite((e.target as HTMLSelectElement).value)}>
                  <option value="">All sites</option>
                  {HSE_SITES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div class="hse-form-field">
                <label class="hse-form-label">Review Cycle</label>
                <select class="hse-form-input" value={reviewCycle} onChange={e => setReviewCycle((e.target as HTMLSelectElement).value)}>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="biannual">Bi-Annual</option>
                  <option value="annual">Annual</option>
                  <option value="on_change">On Change</option>
                </select>
              </div>
              <div class="hse-form-field">
                <label class="hse-form-label">Review Due Date</label>
                <input class="hse-form-input" type="date" value={reviewDue} onInput={e => setReviewDue((e.target as HTMLInputElement).value)} />
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <div class="hse-form-grid" style={{ marginBottom: '12px', padding: '12px', background: 'var(--surface-alt)', borderRadius: '8px' }}>
                <div class="hse-form-field" style={{ gridColumn: '1 / -1' }}>
                  <label class="hse-form-label">Hazard Description</label>
                  <input class="hse-form-input" value={hazardDesc} onInput={e => setHazardDesc((e.target as HTMLInputElement).value)} placeholder="Describe the hazard…" />
                </div>
                <div class="hse-form-field">
                  <label class="hse-form-label">Category</label>
                  <select class="hse-form-input" value={hazardCat} onChange={e => setHazardCat((e.target as HTMLSelectElement).value)}>
                    {HAZARD_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div class="hse-form-field">
                  <label class="hse-form-label">Likelihood</label>
                  <select class="hse-form-input" value={String(likelihood)} onChange={e => setLikelihood(Number((e.target as HTMLSelectElement).value))}>
                    {SCALE.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div class="hse-form-field">
                  <label class="hse-form-label">Severity</label>
                  <select class="hse-form-input" value={String(severity)} onChange={e => setSeverity(Number((e.target as HTMLSelectElement).value))}>
                    {SCALE.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div class="hse-form-field">
                  <label class="hse-form-label">Score</label>
                  <div style={{ paddingTop: '8px' }}>{riskPill(likelihood, severity)}</div>
                </div>
                <div class="hse-form-field" style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
                  <button class="hse-btn secondary" onClick={addHazard}><i class="fas fa-plus" /> Add Hazard</button>
                </div>
              </div>
              {hazards.length === 0 && <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '16px 0', fontSize: '0.78rem' }}>No hazards added yet</p>}
              <div style={{ display: 'grid', gap: '6px' }}>
                {hazards.map((h, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'var(--surface-alt)', borderRadius: '6px', fontSize: '0.8rem' }}>
                    <span style={{ flex: 1 }}>{h.hazardDescription}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{h.category}</span>
                    {riskPill(h.initialLikelihood, h.initialSeverity)}
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                      onClick={() => setHazards(hazards.filter((_, j) => j !== i))}>
                      <i class="fas fa-times" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div style={{ display: 'grid', gap: '12px' }}>
              <div class="hse-aside-card" style={{ margin: 0 }}>
                <div class="hse-aside-head"><i class="fas fa-table-cells-large" /><span>Assessment Summary</span></div>
                <div style={{ display: 'grid', gap: '8px', padding: '8px 0', fontSize: '0.82rem' }}>
                  <div><strong>Type:</strong> {ASSESSMENT_TYPES.find(t => t.value === assessType)?.label}</div>
                  <div><strong>Title:</strong> {title}</div>
                  <div><strong>Site:</strong> {site || 'All sites'}</div>
                  <div><strong>Review Cycle:</strong> {reviewCycle}</div>
                  <div><strong>Hazards:</strong> {hazards.length} identified</div>
                </div>
              </div>
              {error && <p style={{ color: 'var(--color-danger)', fontSize: '0.8rem' }}><i class="fas fa-exclamation-triangle" /> {error}</p>}
            </div>
          )}
        </div>

        <div class="hse-modal-footer">
          {step > 0 && <button class="hse-btn secondary" onClick={() => setStep(step - 1)}>Back</button>}
          <div style={{ flex: 1 }} />
          <button class="hse-btn ghost" onClick={onClose}>Cancel</button>
          {step < steps.length - 1 && (
            <button class="hse-btn primary" onClick={() => {
              if (step === 1 && !title.trim()) { setError('Title is required'); return; }
              setError('');
              setStep(step + 1);
            }}>Next</button>
          )}
          {step === steps.length - 1 && (
            <button class="hse-btn primary" disabled={createAssessment.isPending} onClick={() => void submit()}>
              {createAssessment.isPending ? 'Creating…' : 'Save as Draft'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── New JSA Wizard ────────────────────────────────────────────────────────────

function NewJsaWizard({ onClose }: { onClose: () => void }): VNode {
  const [step,      setStep]      = useState(0);
  const [title,     setTitle]     = useState('');
  const [desc,      setDesc]      = useState('');
  const [site,      setSite]      = useState('');
  const [reviewDue, setReviewDue] = useState('');
  const [steps,     setSteps]     = useState<JsaStep[]>([{ stepNumber: 1, taskStep: '' }]);
  const [ppe,       setPpe]       = useState<string[]>([]);
  const [error,     setError]     = useState('');

  const createJsa   = useCreateJsa();
  const wizardSteps = ['Job Details', 'Job Steps', 'PPE', 'Review & Submit'];

  function addStep() {
    setSteps([...steps, { stepNumber: steps.length + 1, taskStep: '' }]);
  }

  function updateStep(i: number, patch: Partial<JsaStep>) {
    setSteps(steps.map((s, j) => j === i ? { ...s, ...patch } : s));
  }

  function removeStep(i: number) {
    setSteps(steps.filter((_, j) => j !== i).map((s, j) => ({ ...s, stepNumber: j + 1 })));
  }

  function togglePpe(item: string) {
    setPpe(prev => prev.includes(item) ? prev.filter(p => p !== item) : [...prev, item]);
  }

  async function submit() {
    const validSteps = steps.filter(s => s.taskStep.trim());
    if (!title.trim() || validSteps.length === 0) { setError('Title and at least one step are required'); return; }
    setError('');
    try {
      await createJsa.mutateAsync({
        title, description: desc,
        siteId: site || null,
        reviewDueAt: reviewDue || null,
        steps: validSteps,
        ppeItems: ppe.map(p => ({ ppeItem: p, required: true })),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create JSA');
    }
  }

  return (
    <div class="hse-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="hse-modal hse-modal-lg">
        <div class="hse-modal-header">
          <div>
            <h3 class="hse-modal-title">New JSA</h3>
            <p class="hse-modal-sub">Step {step + 1} of {wizardSteps.length} — {wizardSteps[step]}</p>
          </div>
          <button class="hse-modal-close" onClick={onClose}><i class="fas fa-times" /></button>
        </div>

        <div style={{ display: 'flex', gap: '6px', padding: '0 20px 16px' }}>
          {wizardSteps.map((_, i) => (
            <div key={i} style={{ flex: 1, height: '4px', borderRadius: '2px', background: i <= step ? 'var(--siomac-navy)' : 'var(--border)', transition: 'background .2s' }} />
          ))}
        </div>

        <div class="hse-modal-body">
          {step === 0 && (
            <div class="hse-form-grid">
              <div class="hse-form-field" style={{ gridColumn: '1 / -1' }}>
                <label class="hse-form-label">Job / Task Title *</label>
                <input class="hse-form-input" value={title} onInput={e => setTitle((e.target as HTMLInputElement).value)} placeholder="e.g. High-pressure line maintenance" />
              </div>
              <div class="hse-form-field" style={{ gridColumn: '1 / -1' }}>
                <label class="hse-form-label">Description</label>
                <textarea class="hse-form-input" rows={2} value={desc} onInput={e => setDesc((e.target as HTMLTextAreaElement).value)} />
              </div>
              <div class="hse-form-field">
                <label class="hse-form-label">Site</label>
                <select class="hse-form-input" value={site} onChange={e => setSite((e.target as HTMLSelectElement).value)}>
                  <option value="">Select site…</option>
                  {HSE_SITES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div class="hse-form-field">
                <label class="hse-form-label">Review Due Date</label>
                <input class="hse-form-input" type="date" value={reviewDue} onInput={e => setReviewDue((e.target as HTMLInputElement).value)} />
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <div style={{ display: 'grid', gap: '8px', maxHeight: '340px', overflowY: 'auto' }}>
                {steps.map((s, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '32px 1fr auto', gap: '8px', alignItems: 'start', padding: '10px', background: 'var(--surface-alt)', borderRadius: '8px' }}>
                    <span style={{ fontWeight: 700, color: 'var(--siomac-navy)', paddingTop: '8px', fontSize: '0.85rem' }}>{i + 1}</span>
                    <div style={{ display: 'grid', gap: '6px' }}>
                      <input class="hse-form-input" placeholder="Describe task step…" value={s.taskStep}
                        onInput={e => updateStep(i, { taskStep: (e.target as HTMLInputElement).value })} />
                      <input class="hse-form-input" placeholder="Hazard (optional)…" value={s.hazardDescription ?? ''}
                        onInput={e => updateStep(i, { hazardDescription: (e.target as HTMLInputElement).value || null })} />
                      <input class="hse-form-input" placeholder="Controls summary…" value={s.controlsSummary ?? ''}
                        onInput={e => updateStep(i, { controlsSummary: (e.target as HTMLInputElement).value || null })} />
                    </div>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '8px' }}
                      onClick={() => removeStep(i)} disabled={steps.length === 1}>
                      <i class="fas fa-trash" />
                    </button>
                  </div>
                ))}
              </div>
              <button class="hse-btn secondary" style={{ marginTop: '12px', width: '100%' }} onClick={addStep}>
                <i class="fas fa-plus" /> Add Step
              </button>
            </div>
          )}

          {step === 2 && (
            <div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '12px' }}>Select all PPE required for this job.</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {PPE_ITEMS.map(item => (
                  <label key={item} style={{
                    display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px',
                    border: `2px solid ${ppe.includes(item) ? 'var(--siomac-navy)' : 'var(--border)'}`,
                    borderRadius: '8px', cursor: 'pointer', fontSize: '0.8rem', transition: 'border-color .15s',
                  }}>
                    <input type="checkbox" checked={ppe.includes(item)} onChange={() => togglePpe(item)}
                      style={{ accentColor: 'var(--siomac-navy)' }} />
                    {item}
                  </label>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div style={{ display: 'grid', gap: '12px' }}>
              <div class="hse-aside-card" style={{ margin: 0 }}>
                <div class="hse-aside-head"><i class="fas fa-list-ol" /><span>JSA Summary</span></div>
                <div style={{ display: 'grid', gap: '8px', padding: '8px 0', fontSize: '0.82rem' }}>
                  <div><strong>Title:</strong> {title}</div>
                  <div><strong>Site:</strong> {site || 'Not specified'}</div>
                  <div><strong>Steps:</strong> {steps.filter(s => s.taskStep.trim()).length} documented</div>
                  <div><strong>PPE:</strong> {ppe.length > 0 ? ppe.join(', ') : 'None selected'}</div>
                </div>
              </div>
              {error && <p style={{ color: 'var(--color-danger)', fontSize: '0.8rem' }}><i class="fas fa-exclamation-triangle" /> {error}</p>}
            </div>
          )}
        </div>

        <div class="hse-modal-footer">
          {step > 0 && <button class="hse-btn secondary" onClick={() => setStep(step - 1)}>Back</button>}
          <div style={{ flex: 1 }} />
          <button class="hse-btn ghost" onClick={onClose}>Cancel</button>
          {step < wizardSteps.length - 1 && (
            <button class="hse-btn primary" onClick={() => {
              if (step === 0 && !title.trim()) { setError('Title is required'); return; }
              setError('');
              setStep(step + 1);
            }}>Next</button>
          )}
          {step === wizardSteps.length - 1 && (
            <button class="hse-btn primary" disabled={createJsa.isPending} onClick={() => void submit()}>
              {createJsa.isPending ? 'Creating…' : 'Save Draft'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Hazard Drawer ─────────────────────────────────────────────────────────────

type HazardTab2 = 'overview' | 'controls' | 'capa' | 'workflow' | 'timeline';

const HAZARD_DRAWER_TABS: Array<{ key: HazardTab2; icon: string; label: string }> = [
  { key: 'overview',  icon: 'fa-circle-info',  label: 'Overview'  },
  { key: 'controls',  icon: 'fa-shield-alt',   label: 'Controls'  },
  { key: 'capa',      icon: 'fa-wrench',        label: 'CAPA'      },
  { key: 'workflow',  icon: 'fa-diagram-project', label: 'Workflow' },
  { key: 'timeline',  icon: 'fa-clock-rotate-left', label: 'Timeline' },
];

function HazardDrawer({ hazard, onClose }: { hazard: HazardRow; onClose: () => void }): VNode {
  const [activeTab, setActiveTab] = useState<HazardTab2>('overview');
  const { data: detailRes } = useHazardDetail(hazard.id);
  const detail = (detailRes?.data as Record<string, unknown> | undefined);
  const controls = (detail?.controls as unknown[]) ?? [];
  const capa     = (detail?.capa     as unknown[]) ?? [];
  const timeline = (detail?.timeline as unknown[]) ?? [];
  const workflow = detail?.workflow as Record<string, unknown> | null ?? null;

  return (
    <div class={`hse-drawer hse-drawer--rich`}>
      <div class="hse-drawer-header">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,.55)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Hazard</span>
          <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#fff' }}>{hazard.ref}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {riskPillFromLevel(hazard.risk_level, hazard.initial_score)}
          <button class="hse-drawer-close" onClick={onClose}><i class="fas fa-times" /></button>
        </div>
      </div>

      <div class="hse-idrawer-tabbar" style={{ display: 'grid', gridTemplateColumns: `repeat(${HAZARD_DRAWER_TABS.length}, 1fr)` }}>
        {HAZARD_DRAWER_TABS.map(t => (
          <button key={t.key} class={`hse-idrawer-tab${activeTab === t.key ? ' active' : ''}`} onClick={() => setActiveTab(t.key)}>
            <i class={`fas ${t.icon}`} />{t.label}
          </button>
        ))}
      </div>

      <div class="hse-drawer-body">
        {activeTab === 'overview' && (
          <div style={{ padding: '16px', display: 'grid', gap: '12px' }}>
            <div><strong style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>Title</strong><span>{hazard.title}</span></div>
            <div><strong style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>Category</strong><span>{hazard.category}</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div><strong style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>Initial Risk</strong>
                {riskPill(hazard.initial_likelihood, hazard.initial_severity)}</div>
              {hazard.residual_likelihood && hazard.residual_severity && (
                <div><strong style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>Residual Risk</strong>
                  {riskPill(hazard.residual_likelihood, hazard.residual_severity)}</div>
              )}
            </div>
            <div><strong style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>Status</strong>
              <span class={hsePill(hazard.status)}>{hazard.status.replace(/_/g, ' ')}</span></div>
            {hazard.review_due_at && (
              <div><strong style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>Review Due</strong>
                <span>{new Date(hazard.review_due_at).toLocaleDateString()}</span></div>
            )}
          </div>
        )}

        {activeTab === 'controls' && (
          <div style={{ padding: '16px' }}>
            {controls.length === 0
              ? <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0', fontSize: '0.8rem' }}>No controls recorded</p>
              : (controls as Array<Record<string, unknown>>).map((c, i) => (
                <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{c['description'] as string}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {(c['control_type'] as string).replace(/_/g, ' ')} · {c['status'] as string}
                  </div>
                </div>
              ))
            }
          </div>
        )}

        {activeTab === 'capa' && (
          <div style={{ padding: '16px' }}>
            {capa.length === 0
              ? <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0', fontSize: '0.8rem' }}>No CAPA actions linked</p>
              : (capa as Array<Record<string, unknown>>).map((a, i) => (
                <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{a['ref'] as string} — {a['title'] as string}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {a['priority'] as string} priority · {a['status'] as string}
                  </div>
                </div>
              ))
            }
          </div>
        )}

        {activeTab === 'workflow' && (
          <div style={{ padding: '16px' }}>
            {!workflow
              ? <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0', fontSize: '0.8rem' }}>No workflow active</p>
              : (
                <div>
                  <div style={{ fontWeight: 600, marginBottom: '4px' }}>{workflow['ref'] as string}</div>
                  <span class={hsePill(workflow['status'] as string)}>{(workflow['status'] as string).replace(/_/g, ' ')}</span>
                </div>
              )
            }
          </div>
        )}

        {activeTab === 'timeline' && (
          <div style={{ padding: '16px' }}>
            {timeline.length === 0
              ? <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0', fontSize: '0.8rem' }}>No timeline events yet</p>
              : (timeline as Array<Record<string, unknown>>).map((e, i) => (
                <div key={i} style={{ display: 'flex', gap: '10px', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <i class="fas fa-circle-dot" style={{ color: 'var(--siomac-navy)', marginTop: '3px', fontSize: '0.7rem' }} />
                  <div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{(e['event_type'] as string).replace(/\./g, ' ')}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{new Date(e['created_at'] as string).toLocaleString()}</div>
                  </div>
                </div>
              ))
            }
          </div>
        )}
      </div>
    </div>
  );
}

// ── Assessment Drawer (compact) ───────────────────────────────────────────────

function AssessmentDrawer({ assessment, onClose }: { assessment: AssessmentRow; onClose: () => void }): VNode {
  const { data: detailRes } = useAssessmentDetail(assessment.id);
  const detail = (detailRes?.data as Record<string, unknown> | undefined);
  const hazards  = (detail?.hazards  as unknown[]) ?? [];
  const controls = (detail?.controls as unknown[]) ?? [];
  const timeline = (detail?.timeline as unknown[]) ?? [];
  const [tab, setTab] = useState<'overview' | 'hazards' | 'controls' | 'timeline'>('overview');

  const TABS2 = [
    { key: 'overview' as const,  icon: 'fa-circle-info',   label: 'Overview'  },
    { key: 'hazards'  as const,  icon: 'fa-radiation',      label: 'Hazards'   },
    { key: 'controls' as const,  icon: 'fa-shield-alt',     label: 'Controls'  },
    { key: 'timeline' as const,  icon: 'fa-clock-rotate-left', label: 'Timeline' },
  ];

  return (
    <div class="hse-drawer hse-drawer--rich">
      <div class="hse-drawer-header">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,.55)', fontWeight: 500, textTransform: 'uppercase' }}>Risk Assessment</span>
          <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#fff' }}>{assessment.ref}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {riskPillFromLevel(assessment.risk_level, assessment.initial_score)}
          <button class="hse-drawer-close" onClick={onClose}><i class="fas fa-times" /></button>
        </div>
      </div>

      <div class="hse-idrawer-tabbar" style={{ display: 'grid', gridTemplateColumns: `repeat(${TABS2.length}, 1fr)` }}>
        {TABS2.map(t => (
          <button key={t.key} class={`hse-idrawer-tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
            <i class={`fas ${t.icon}`} />{t.label}
          </button>
        ))}
      </div>

      <div class="hse-drawer-body" style={{ padding: '16px', overflowY: 'auto' }}>
        {tab === 'overview' && (
          <div style={{ display: 'grid', gap: '12px' }}>
            <div><strong style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Title</strong>{assessment.title}</div>
            <div><strong style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Type</strong>{assessment.assessment_type.replace(/_/g, ' ')}</div>
            <div><strong style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Status</strong>
              <span class={hsePill(assessment.status)}>{assessment.status.replace(/_/g, ' ')}</span></div>
            <div><strong style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Risk Level</strong>
              {riskPillFromLevel(assessment.risk_level, assessment.initial_score)}</div>
            {assessment.review_due_at && (
              <div><strong style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Review Due</strong>{new Date(assessment.review_due_at).toLocaleDateString()}</div>
            )}
          </div>
        )}
        {tab === 'hazards' && (
          <div style={{ display: 'grid', gap: '8px' }}>
            {hazards.length === 0 && <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0', fontSize: '0.8rem' }}>No hazards linked</p>}
            {(hazards as Array<Record<string, unknown>>).map((h, i) => (
              <div key={i} style={{ padding: '10px', background: 'var(--surface-alt)', borderRadius: '8px' }}>
                <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{h['hazard_description'] as string ?? 'Hazard'}</div>
                <div style={{ marginTop: '4px' }}>{riskPill(h['initial_likelihood'] as number, h['initial_severity'] as number)}</div>
              </div>
            ))}
          </div>
        )}
        {tab === 'controls' && (
          <div style={{ display: 'grid', gap: '8px' }}>
            {controls.length === 0 && <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0', fontSize: '0.8rem' }}>No controls recorded</p>}
            {(controls as Array<Record<string, unknown>>).map((c, i) => (
              <div key={i} style={{ padding: '10px', background: 'var(--surface-alt)', borderRadius: '8px', fontSize: '0.8rem' }}>
                <div style={{ fontWeight: 600 }}>{c['description'] as string}</div>
                <div style={{ color: 'var(--text-muted)', marginTop: '2px' }}>{(c['control_type'] as string).replace(/_/g, ' ')} · {c['status'] as string}</div>
              </div>
            ))}
          </div>
        )}
        {tab === 'timeline' && (
          <div>
            {timeline.length === 0 && <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0', fontSize: '0.8rem' }}>No events yet</p>}
            {(timeline as Array<Record<string, unknown>>).map((e, i) => (
              <div key={i} style={{ display: 'flex', gap: '10px', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <i class="fas fa-circle-dot" style={{ color: 'var(--siomac-navy)', marginTop: '3px', fontSize: '0.7rem' }} />
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{(e['event_type'] as string).replace(/\./g, ' ')}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{new Date(e['created_at'] as string).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── JSA Drawer (compact) ──────────────────────────────────────────────────────

function JsaDrawer({ jsa, onClose }: { jsa: JsaRow; onClose: () => void }): VNode {
  const { data: detailRes } = useJsaDetail(jsa.id);
  const detail  = (detailRes?.data as Record<string, unknown> | undefined);
  const steps   = (detail?.steps    as unknown[]) ?? [];
  const ppe     = (detail?.ppe      as unknown[]) ?? [];
  const timeline = (detail?.timeline as unknown[]) ?? [];
  const [tab, setTab] = useState<'overview' | 'steps' | 'ppe' | 'timeline'>('overview');

  const TABS3 = [
    { key: 'overview' as const,  icon: 'fa-circle-info',   label: 'Overview' },
    { key: 'steps'    as const,  icon: 'fa-list-ol',        label: 'Steps'    },
    { key: 'ppe'      as const,  icon: 'fa-hard-hat',       label: 'PPE'      },
    { key: 'timeline' as const,  icon: 'fa-clock-rotate-left', label: 'Timeline' },
  ];

  return (
    <div class="hse-drawer hse-drawer--rich">
      <div class="hse-drawer-header">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,.55)', fontWeight: 500, textTransform: 'uppercase' }}>JSA</span>
          <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#fff' }}>{jsa.ref}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {riskPillFromLevel(jsa.risk_level)}
          <button class="hse-drawer-close" onClick={onClose}><i class="fas fa-times" /></button>
        </div>
      </div>

      <div class="hse-idrawer-tabbar" style={{ display: 'grid', gridTemplateColumns: `repeat(${TABS3.length}, 1fr)` }}>
        {TABS3.map(t => (
          <button key={t.key} class={`hse-idrawer-tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
            <i class={`fas ${t.icon}`} />{t.label}
          </button>
        ))}
      </div>

      <div class="hse-drawer-body" style={{ padding: '16px', overflowY: 'auto' }}>
        {tab === 'overview' && (
          <div style={{ display: 'grid', gap: '12px' }}>
            <div><strong style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Job / Task</strong>{jsa.title}</div>
            <div><strong style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Status</strong>
              <span class={hsePill(jsa.status)}>{jsa.status.replace(/_/g, ' ')}</span></div>
            <div><strong style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Risk Level</strong>{riskPillFromLevel(jsa.risk_level)}</div>
            <div><strong style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Steps Documented</strong>{jsa.stepCount}</div>
            {jsa.review_due_at && (
              <div><strong style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>Review Due</strong>{new Date(jsa.review_due_at).toLocaleDateString()}</div>
            )}
          </div>
        )}
        {tab === 'steps' && (
          <div style={{ display: 'grid', gap: '10px' }}>
            {steps.length === 0 && <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0', fontSize: '0.8rem' }}>No steps recorded</p>}
            {(steps as Array<Record<string, unknown>>).map((s, i) => (
              <div key={i} style={{ padding: '10px', background: 'var(--surface-alt)', borderRadius: '8px' }}>
                <div style={{ fontWeight: 700, fontSize: '0.75rem', color: 'var(--siomac-navy)', marginBottom: '4px' }}>Step {s['step_number'] as number}</div>
                <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{s['task_step'] as string}</div>
                {s['hazard_description'] && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>Hazard: {s['hazard_description'] as string}</div>}
                {s['controls_summary']   && <div style={{ fontSize: '0.75rem', color: 'var(--color-success)', marginTop: '2px' }}>Controls: {s['controls_summary'] as string}</div>}
              </div>
            ))}
          </div>
        )}
        {tab === 'ppe' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {ppe.length === 0 && <p style={{ gridColumn: '1 / -1', color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0', fontSize: '0.8rem' }}>No PPE specified</p>}
            {(ppe as Array<Record<string, unknown>>).map((p, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: 'var(--surface-alt)', borderRadius: '8px', fontSize: '0.8rem' }}>
                <i class="fas fa-check-circle" style={{ color: 'var(--color-success)' }} />
                {p['ppe_item'] as string}
              </div>
            ))}
          </div>
        )}
        {tab === 'timeline' && (
          <div>
            {timeline.length === 0 && <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0', fontSize: '0.8rem' }}>No events yet</p>}
            {(timeline as Array<Record<string, unknown>>).map((e, i) => (
              <div key={i} style={{ display: 'flex', gap: '10px', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <i class="fas fa-circle-dot" style={{ color: 'var(--siomac-navy)', marginTop: '3px', fontSize: '0.7rem' }} />
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{(e['event_type'] as string).replace(/\./g, ' ')}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{new Date(e['created_at'] as string).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
