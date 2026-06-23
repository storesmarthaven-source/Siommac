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
  PageHeader, TabBar, withCounts, NewMenu,
  type AreaTab,
} from '@ui';
import { HSE_SITES, hsePill } from './types';
import {
  useRiskJsaSummary,
  useHazards,
  useAssessments,
  useJsaList,
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
import { ExportDialog }       from './risk-jsa/dialogs/ExportDialog';
import { TemplateDialog }     from './risk-jsa/dialogs/TemplateDialog';
import { type CsvColumn }     from '@ui/lib/exportCsv';

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS: AreaTab[] = [
  { key: 'hazards',     label: 'Hazard Register',  sublabel: 'All hazards',       icon: 'fa-radiation' },
  { key: 'assessments', label: 'Risk Assessments', sublabel: 'Matrix & controls',  icon: 'fa-table-cells-large' },
  { key: 'jsa',         label: 'JSA Library',      sublabel: 'Task analysis',     icon: 'fa-list-ol' },
];

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

/** Residual-risk pill from a residual score (L×S). Muted dash when not yet scored. */
function residualPill(score: number | null | undefined): VNode {
  if (score == null) return <span class="hse-muted">—</span>;
  return riskPill2(riskLevelFrom(score), score);
}
function riskPill2(level: RiskLevel, score: number): VNode {
  const cls = level === 'critical' ? 'is-off' : level === 'high' ? 'is-warn' : level === 'medium' ? 'is-amber' : 'is-on';
  const band = level.charAt(0).toUpperCase() + level.slice(1);
  return <span class={`vt-pill ${cls}`}>{band} · {score}</span>;
}

/** Short locale date, or em-dash. */
function fmtDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' }) : '—';
}

/** Operating-site label: explicit site_id wins, else the seeded location_text. */
function siteLabel(row: { site_id: string | null; location_text?: string | null }): string {
  return row.site_id ?? row.location_text ?? '—';
}

/** True when the row's site/location matches the selected site filter. */
function matchesSite(row: { site_id: string | null; location_text?: string | null }, site: string): boolean {
  if (!site) return true;
  const hay = `${row.site_id ?? ''} ${row.location_text ?? ''}`.toLowerCase();
  return hay.includes(site.toLowerCase());
}

/** Review-due SLA chip: overdue (red), due-soon (amber), or the date. */
function reviewSla(due: string | null | undefined): VNode {
  if (!due) return <span class="hse-muted">—</span>;
  const days = Math.ceil((new Date(due).getTime() - Date.now()) / 86_400_000);
  if (days < 0)  return <span class="days-open overdue">{Math.abs(days)}d over</span>;
  if (days <= 30) return <span class="days-open">{days}d</span>;
  return <span class="hse-muted" style={{ fontSize: '0.72rem' }}>{fmtDate(due)}</span>;
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
  const [templatesOpen,   setTemplatesOpen]   = useState(false);

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
      />

      <RiskJsaInsightCards activeTab={active as 'hazards' | 'assessments' | 'jsa'} />

      <div class="hse-main-grid">
        <div class="hse-left-col">
          <TabBar tabs={tabsWithCounts} active={active} onSelect={setActive} />

          <div class="hse-spark-row">
            <div class="hse-spark">
              <div class="hse-spark-header"><span class="hse-spark-label">Total Hazards</span><i class="fas fa-radiation" /></div>
              <div class="hse-spark-val">{totalHazards}</div>
              <div class="hse-spark-sub">On the live register</div>
            </div>
            <div class="hse-spark">
              <div class="hse-spark-header"><span class="hse-spark-label">High / Critical</span><i class="fas fa-triangle-exclamation" /></div>
              <div class="hse-spark-val" style={{ color: '#ef4444' }}>{highCritical}</div>
              <div class="hse-spark-sub">Priority for control</div>
            </div>
            <div class="hse-spark">
              <div class="hse-spark-header"><span class="hse-spark-label">Open Assessments</span><i class="fas fa-table-cells-large" /></div>
              <div class="hse-spark-val" style={{ color: '#f59e0b' }}>{openAssessments}</div>
              <div class="hse-spark-sub">{overdueAssessments > 0 ? `${overdueAssessments} overdue review` : 'All reviews current'}</div>
            </div>
            <div class="hse-spark">
              <div class="hse-spark-header"><span class="hse-spark-label">Risk Reduction</span><i class="fas fa-arrow-down-wide-short" /></div>
              <div class="hse-spark-val" style={{ color: '#22c55e' }}>{riskReductionPct}%</div>
              <div class="hse-spark-sub">Initial → residual, controlled</div>
              <div class="hse-spark-bar-track"><div class="hse-spark-bar-fill" style={{ width: `${Math.min(100, riskReductionPct)}%`, background: riskReductionPct >= 50 ? '#22c55e' : '#f59e0b' }} /></div>
            </div>
          </div>

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
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '14px' }}>
            <NewMenu align="right" items={[
              { label: 'New Hazard',          icon: 'fa-radiation',         sub: 'Identify & rate a hazard', onSelect: () => setHazardFormOpen(true) },
              { label: 'New Risk Assessment', icon: 'fa-table-cells-large', sub: '5×5 matrix scoring',        onSelect: () => setRaFormOpen(true) },
              { label: 'New JSA',             icon: 'fa-list-ol',           sub: 'Job safety analysis',       onSelect: () => setJsaFormOpen(true) },
              { label: 'Workflow Templates',  icon: 'fa-diagram-project',   divider: true,                    onSelect: () => setTemplatesOpen(true) },
            ]} />
          </div>
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
      <TemplateDialog open={templatesOpen} onClose={() => setTemplatesOpen(false)} />

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

// ── Hazard Register tab ───────────────────────────────────────────────────────

// ── Export column specs (shared by the tab Export dialogs) ─────────────────────

const HAZARD_EXPORT_COLS: CsvColumn<HazardRow>[] = [
  { header: 'Ref',            value: h => h.ref },
  { header: 'Hazard',         value: h => h.title },
  { header: 'Category',       value: h => h.category },
  { header: 'Site',           value: h => siteLabel(h) },
  { header: 'Initial L×S',    value: h => `${h.initial_likelihood} × ${h.initial_severity}` },
  { header: 'Initial Score',  value: h => h.initial_score },
  { header: 'Residual Score', value: h => h.residual_score ?? '' },
  { header: 'Risk Level',     value: h => h.risk_level },
  { header: 'Status',         value: h => h.status },
  { header: 'Review Due',     value: h => h.review_due_at ? fmtDate(h.review_due_at) : '' },
];

const ASSESSMENT_EXPORT_COLS: CsvColumn<AssessmentRow>[] = [
  { header: 'Ref',            value: a => a.ref },
  { header: 'Title',          value: a => a.title },
  { header: 'Type',           value: a => a.assessment_type },
  { header: 'Site',           value: a => siteLabel(a) },
  { header: 'Initial Score',  value: a => a.initial_score ?? '' },
  { header: 'Residual Score', value: a => a.residual_score ?? '' },
  { header: 'Risk Level',     value: a => a.risk_level },
  { header: 'Status',         value: a => a.status },
  { header: 'Review Due',     value: a => a.review_due_at ? fmtDate(a.review_due_at) : '' },
];

const JSA_EXPORT_COLS: CsvColumn<JsaRow>[] = [
  { header: 'Ref',        value: j => j.ref },
  { header: 'Job / Task', value: j => j.title },
  { header: 'Site',       value: j => siteLabel(j) },
  { header: 'Steps',      value: j => j.stepCount },
  { header: 'Risk Level', value: j => j.risk_level },
  { header: 'Status',     value: j => j.status },
  { header: 'Review Due', value: j => j.review_due_at ? fmtDate(j.review_due_at) : '' },
];

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
  const [exportOpen, setExportOpen] = useState(false);

  const { data, isLoading } = useHazards({
    search:    search || undefined,
    category:  category  || undefined,
    riskLevel: riskLevel || undefined,
  });
  const all      = data?.data ?? [];
  const hazards  = all.filter(h => matchesSite(h, siteId));

  return (
    <div class="hse-area-main">
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)}
        registerLabel="Hazard Register" rows={hazards} columns={HAZARD_EXPORT_COLS} filenameBase="hazard-register" />
      <div class="hse-table-card">
        <div class="hse-table-card-top">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <div class="vt-section-titlewrap">
              <span class="vt-section-icon"><i class="fas fa-radiation" /></span>
              <div>
                <div class="vt-section-title">Hazard Register</div>
                <div class="vt-section-sub">Identified hazards with initial and residual likelihood × severity ratings.</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
              <button class="inc-action-btn primary" onClick={onNewHazard}><i class="fas fa-circle-plus" /> New Hazard</button>
            </div>
          </div>
          <div class="vt-toolbar" style={{ marginBottom: 0, marginTop: '12px' }}>
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
            <button class="inc-action-btn blue" onClick={() => setExportOpen(true)}><i class="fas fa-download" /> Export</button>
          </div>
        </div>
        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead>
              <tr>
                <th style={{ width: '120px' }}>Ref / Logged</th>
                <th>Hazard</th>
                <th style={{ width: '110px' }}>Category</th>
                <th style={{ width: '92px' }}>Initial</th>
                <th style={{ width: '92px' }}>Residual</th>
                <th style={{ width: '120px' }}>Status</th>
                <th style={{ width: '70px' }}>Review</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>Loading hazards…</td></tr>
              )}
              {!isLoading && hazards.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>No hazards match.</td></tr>
              )}
              {hazards.map(h => (
                <tr key={h.id} onClick={() => onSelect(h)} style={{ cursor: 'pointer' }}
                    class={selected?.id === h.id ? 'vt-row-active' : ''}>
                  <td>
                    <span class="vt-cell-mono">{h.ref}</span>
                    <div class="vt-cell-subtext">{fmtDate(h.created_at)}</div>
                  </td>
                  <td>
                    <span class="vt-cell-name">{h.title}</span>
                    <div class="vt-cell-subtext">{siteLabel(h)}</div>
                  </td>
                  <td>{h.category}</td>
                  <td>{riskPill(h.initial_likelihood, h.initial_severity)}</td>
                  <td>{residualPill(h.residual_score)}</td>
                  <td><span class={hsePill(h.status)}>{h.status.replace(/_/g, ' ')}</span></td>
                  <td>{reviewSla(h.review_due_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div class="vt-table-foot">
          <span>Showing {hazards.length} of {all.length} hazards</span>
          <span>Click any row to open detail · Esc to close</span>
        </div>
      </div>
    </div>
  );
}

// ── Risk Assessments tab ──────────────────────────────────────────────────────

function AssessmentsTab({
  onNew, onSelect, selected,
}: {
  onNew:    () => void;
  onSelect: (a: AssessmentRow) => void;
  selected: AssessmentRow | null;
  onSubmit?: (id: string) => void;
}): VNode {
  const [siteId, setSiteId] = useState('');
  const [status, setStatus] = useState('');
  const [exportOpen, setExportOpen] = useState(false);

  const { data, isLoading } = useAssessments({ status: status || undefined });
  const all         = data?.data ?? [];
  const assessments = all.filter(a => matchesSite(a, siteId));

  return (
    <div class="hse-area-main">
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)}
        registerLabel="Risk Assessments" rows={assessments} columns={ASSESSMENT_EXPORT_COLS} filenameBase="risk-assessments" />
      <div class="hse-table-card">
        <div class="hse-table-card-top">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <div class="vt-section-titlewrap">
              <span class="vt-section-icon"><i class="fas fa-table-cells-large" /></span>
              <div>
                <div class="vt-section-title">Risk Assessments</div>
                <div class="vt-section-sub">Formal assessments scored on the 5×5 matrix — initial through residual risk.</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
              <button class="inc-action-btn primary" onClick={onNew}><i class="fas fa-circle-plus" /> New Assessment</button>
            </div>
          </div>
          <div class="vt-toolbar" style={{ marginBottom: 0, marginTop: '12px' }}>
            <select class="emp-filter-select" value={status} onChange={e => setStatus((e.target as HTMLSelectElement).value)}>
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="submitted">Submitted</option>
              <option value="under_review">Under Review</option>
              <option value="returned">Returned</option>
              <option value="approved">Approved</option>
              <option value="active">Active</option>
            </select>
            <select class="emp-filter-select" value={siteId} onChange={e => setSiteId((e.target as HTMLSelectElement).value)}>
              <option value="">All sites</option>
              {HSE_SITES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button class="inc-action-btn blue" style={{ marginLeft: 'auto' }} onClick={() => setExportOpen(true)}><i class="fas fa-download" /> Export</button>
          </div>
        </div>
        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead>
              <tr>
                <th style={{ width: '120px' }}>Ref / Created</th>
                <th>Assessment</th>
                <th style={{ width: '110px' }}>Type</th>
                <th style={{ width: '92px' }}>Initial</th>
                <th style={{ width: '92px' }}>Residual</th>
                <th style={{ width: '120px' }}>Status</th>
                <th style={{ width: '70px' }}>Review</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={7} style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>Loading…</td></tr>}
              {!isLoading && assessments.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>No assessments match.</td></tr>
              )}
              {assessments.map(a => (
                <tr key={a.id} onClick={() => onSelect(a)} style={{ cursor: 'pointer' }}
                    class={selected?.id === a.id ? 'vt-row-active' : ''}>
                  <td>
                    <span class="vt-cell-mono">{a.ref}</span>
                    <div class="vt-cell-subtext">{fmtDate(a.created_at)}</div>
                  </td>
                  <td>
                    <span class="vt-cell-name">{a.title}</span>
                    <div class="vt-cell-subtext">{siteLabel(a)}</div>
                  </td>
                  <td class="hse-muted" style={{ fontSize: '0.72rem' }}>{a.assessment_type.replace(/_/g, ' ')}</td>
                  <td>{riskPillFromLevel(a.risk_level, a.initial_score)}</td>
                  <td>{residualPill(a.residual_score)}</td>
                  <td><span class={hsePill(a.status)}>{a.status.replace(/_/g, ' ')}</span></td>
                  <td>{reviewSla(a.review_due_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div class="vt-table-foot">
          <span>Showing {assessments.length} of {all.length} assessments</span>
          <span>Click any row to open detail · Esc to close</span>
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
  const [exportOpen, setExportOpen] = useState(false);

  const { data, isLoading } = useJsaList({ status: status || undefined });
  const all  = data?.data ?? [];
  const jsas = all.filter(j => matchesSite(j, siteId));

  return (
    <div class="hse-area-main">
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)}
        registerLabel="JSA Library" rows={jsas} columns={JSA_EXPORT_COLS} filenameBase="jsa-library" />
      <div class="hse-table-card">
        <div class="hse-table-card-top">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <div class="vt-section-titlewrap">
              <span class="vt-section-icon"><i class="fas fa-list-ol" /></span>
              <div>
                <div class="vt-section-title">JSA Library</div>
                <div class="vt-section-sub">Job Safety Analyses — step-by-step hazard identification and controls per task.</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
              <button class="inc-action-btn primary" onClick={onNew}><i class="fas fa-circle-plus" /> New JSA</button>
            </div>
          </div>
          <div class="vt-toolbar" style={{ marginBottom: 0, marginTop: '12px' }}>
            <select class="emp-filter-select" value={status} onChange={e => setStatus((e.target as HTMLSelectElement).value)}>
              <option value="">All statuses</option>
              <option value="draft">Draft</option>
              <option value="submitted">Submitted</option>
              <option value="hse_review">HSE Review</option>
              <option value="approved">Approved</option>
              <option value="active">Active</option>
            </select>
            <select class="emp-filter-select" value={siteId} onChange={e => setSiteId((e.target as HTMLSelectElement).value)}>
              <option value="">All sites</option>
              {HSE_SITES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button class="inc-action-btn blue" style={{ marginLeft: 'auto' }} onClick={() => setExportOpen(true)}><i class="fas fa-download" /> Export</button>
          </div>
        </div>
        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead>
              <tr>
                <th style={{ width: '120px' }}>Ref / Created</th>
                <th>Job / Task</th>
                <th style={{ width: '70px' }}>Steps</th>
                <th style={{ width: '92px' }}>Risk</th>
                <th style={{ width: '120px' }}>Status</th>
                <th style={{ width: '70px' }}>Review</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={6} style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>Loading…</td></tr>}
              {!isLoading && jsas.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '28px', color: 'var(--text-muted)' }}>No JSAs match.</td></tr>
              )}
              {jsas.map(j => (
                <tr key={j.id} onClick={() => onSelect(j)} style={{ cursor: 'pointer' }}
                    class={selected?.id === j.id ? 'vt-row-active' : ''}>
                  <td>
                    <span class="vt-cell-mono">{j.ref}</span>
                    <div class="vt-cell-subtext">{fmtDate(j.created_at)}</div>
                  </td>
                  <td>
                    <span class="vt-cell-name">{j.title}</span>
                    <div class="vt-cell-subtext">{siteLabel(j)}</div>
                  </td>
                  <td class="hse-muted">{j.stepCount}</td>
                  <td>{riskPillFromLevel(j.risk_level)}</td>
                  <td><span class={hsePill(j.status)}>{j.status.replace(/_/g, ' ')}</span></td>
                  <td>{reviewSla(j.review_due_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div class="vt-table-foot">
          <span>Showing {jsas.length} of {all.length} JSAs</span>
          <span>Click any row to open detail · Esc to close</span>
        </div>
      </div>
    </div>
  );
}
