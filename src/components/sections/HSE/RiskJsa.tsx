/**
 * src/components/sections/HSE/RiskJsa.tsx
 *
 * Risk & JSA Management — real-data wired.
 * Three-tab structure: Hazard Register · Risk Assessments · JSA Library
 * Right-side: High Risk Queue + Overdue Assessments (from backend summary)
 */

import { type VNode }   from 'preact';
import { useState } from 'preact/hooks';
import {
  PageHeader, TabBar, withCounts, SectionHead,
  type AreaTab,
} from '@ui';
import { HSE_SITES, riskRating, hsePill } from './types';
import {
  useRiskJsaSummary,
  useHazards,
  useAssessments,
  useJsaList,
  useSubmitAssessment,
  useSubmitJsa,
  type HazardRow,
  type AssessmentRow,
  type JsaRow,
  type RiskLevel,
} from '@api/hse/riskJsa';
import { NewHazardDialog }     from './risk-jsa/dialogs/NewHazardDialog';
import { NewAssessmentWizard } from './risk-jsa/dialogs/NewAssessmentWizard';
import { NewJsaWizard }        from './risk-jsa/dialogs/NewJsaWizard';
import { HazardDrawer }        from './risk-jsa/drawers/HazardDrawer';
import { RiskAssessmentDrawer } from './risk-jsa/drawers/RiskAssessmentDrawer';
import { JsaDrawer }           from './risk-jsa/drawers/JsaDrawer';
import { RiskJsaInsightCards } from './risk-jsa/RiskJsaInsightCards';
import { RiskJsaRightPanel }  from './risk-jsa/RiskJsaRightPanel';

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
  const [newMenuOpen,     setNewMenuOpen]     = useState(false);

  const { data: summaryRes, isLoading: summaryLoading } = useRiskJsaSummary();
  const summary = summaryRes?.data;

  const totalHazards       = summary?.totalHazards           ?? 0;
  const highCritical       = summary?.highCriticalHazards    ?? 0;
  const openAssessments    = summary?.openAssessments        ?? 0;
  const openJsa            = summary?.openJsa                ?? 0;
  const riskReductionPct   = summary?.riskReductionPct       ?? 0;
  const overdueAssessments = summary?.overdueAssessments     ?? 0;

  const tabsWithCounts = withCounts(TABS, {
    hazards:     totalHazards,
    assessments: openAssessments,
    jsa:         openJsa,
  });

  return (
    <div class="hse-tab hse-dash">
      <PageHeader
        icon="fa-radiation"
        module="HSE"
        title="Risk & JSA"
        sub="Hazard register, risk assessments, and job safety analyses — identify, rate, and control workplace risk."
        meta={[
          { icon: 'fa-radiation', label: `${totalHazards} hazards` },
          { icon: 'fa-triangle-exclamation', label: `${highCritical} high / critical` },
          { icon: 'fa-table-cells-large', label: '5×5 matrix' },
          ...(overdueAssessments > 0 ? [{ icon: 'fa-clock', label: `${overdueAssessments} overdue` }] : []),
        ]}
        actions={
          <div style={{ position: 'relative' }}>
            <button class="hse-btn primary" onClick={() => setNewMenuOpen(o => !o)}>
              <i class="fas fa-circle-plus" /> New <i class="fas fa-chevron-down" style={{ fontSize: '0.6rem', marginLeft: '2px' }} />
            </button>
            {newMenuOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setNewMenuOpen(false)} />
                <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 41, minWidth: '210px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--elev-4)', overflow: 'hidden', display: 'grid' }}>
                  {[
                    { label: 'New Hazard', icon: 'fa-radiation', act: () => setHazardFormOpen(true) },
                    { label: 'New Risk Assessment', icon: 'fa-table-cells-large', act: () => setRaFormOpen(true) },
                    { label: 'New JSA', icon: 'fa-list-ol', act: () => setJsaFormOpen(true) },
                  ].map(it => (
                    <button key={it.label} onClick={() => { it.act(); setNewMenuOpen(false); }}
                      style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left', fontSize: '0.82rem', color: 'var(--siomac-navy)', fontWeight: 600 }}>
                      <i class={`fas ${it.icon}`} style={{ width: '16px', color: 'var(--siomac-red)' }} /> {it.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        }
      />

      <RiskJsaInsightCards activeTab={active as 'hazards' | 'assessments' | 'jsa'} />

      <div class="hse-main-grid">
        <div class="hse-left-col">
          <TabBar tabs={tabsWithCounts} active={active} onSelect={setActive} />

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

        {/* Right-side supporting panel — changes by tab */}
        <div class="hse-right-col">
          <RiskJsaRightPanel
            activeTab={active as 'hazards' | 'assessments' | 'jsa'}
            onHazard={setSelectedHazard}
            onAssessment={setSelectedRa}
            onJsa={setSelectedJsa}
          />
        </div>
      </div>

      {/* Dialogs */}
      <NewHazardDialog open={hazardFormOpen} onClose={() => setHazardFormOpen(false)} />
      <NewAssessmentWizard open={raFormOpen} onClose={() => setRaFormOpen(false)} />
      <NewJsaWizard open={jsaFormOpen} onClose={() => setJsaFormOpen(false)} />

      {/* Drawers */}
      {selectedHazard && (
        <HazardDrawer hazard={selectedHazard} onClose={() => setSelectedHazard(null)} />
      )}
      {selectedRa && (
        <RiskAssessmentDrawer assessment={selectedRa} onClose={() => setSelectedRa(null)} />
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
