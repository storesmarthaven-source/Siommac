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
  PageHeader, TabBar, withCounts, NewMenu, Pagination, usePagination,
  type AreaTab,
} from '@ui';
import { HSE_SITES } from './types';
import {
  useRiskJsaSummary,
  useHazards,
  useAssessments,
  useJsaList,
  useRiskJsaQueue,
  type HazardRow,
  type AssessmentRow,
  type JsaRow,
  type RiskLevel,
  type JsaPrefill,
} from '@api/hse/riskJsa';
import { NewHazardDialog }     from './risk-jsa/dialogs/NewHazardDialog';
import { NewAssessmentWizard } from './risk-jsa/dialogs/NewAssessmentWizard';
import { NewJsaWizard }        from './risk-jsa/dialogs/NewJsaWizard';
import { HazardDrawer }        from './risk-jsa/drawers/HazardDrawer';
import { RiskAssessmentDrawer } from './risk-jsa/drawers/RiskAssessmentDrawer';
import { JsaDrawer }           from './risk-jsa/drawers/JsaDrawer';
import { RiskJsaInsightCards } from './risk-jsa/RiskJsaInsightCards';
import { RiskJsaRightPanel }  from './risk-jsa/RiskJsaRightPanel';
import { PendingApprovalTab, TemplatesTab, ArchiveTab } from './risk-jsa/RiskJsaQueueTabs';
import { ExportDialog }       from './risk-jsa/dialogs/ExportDialog';
import { TemplateDialog }     from './risk-jsa/dialogs/TemplateDialog';
import { GenerateJsaDialog }  from './risk-jsa/dialogs/GenerateJsaDialog';
import { calculateRiskBand }  from './risk-jsa/shared/RiskScorePill';
import { type CsvColumn }     from '@ui/lib/exportCsv';

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS: AreaTab[] = [
  { key: 'hazards',     label: 'Hazard Register',  sublabel: 'All hazards',        icon: 'fa-radiation' },
  { key: 'assessments', label: 'Risk Assessments', sublabel: 'Matrix & controls',  icon: 'fa-table-cells-large' },
  { key: 'jsa',         label: 'JSA Library',      sublabel: 'Task analysis',      icon: 'fa-list-ol' },
  { key: 'pending',     label: 'Pending Approval', sublabel: 'Awaiting decision',  icon: 'fa-clipboard-check' },
  { key: 'templates',   label: 'Templates',        sublabel: 'Workflow blueprints', icon: 'fa-diagram-project' },
  { key: 'archive',     label: 'Archive',          sublabel: 'Archived records',   icon: 'fa-box-archive' },
];

const ENTITY_TABS = ['hazards', 'assessments', 'jsa'];

const HAZARD_CATEGORIES = [
  'Safety','Health','Environmental','Chemical','Biological',
  'Ergonomic','Mechanical','Electrical','Fire','Security','Process','Other',
] as const;

// ── Risk helpers ──────────────────────────────────────────────────────────────

/** Canonical 5×5 band from an L×S score — delegates to the shared RiskScorePill helper. */
function riskLevelFrom(score: number): RiskLevel {
  return calculateRiskBand(score);
}

/** Per-risk colour map — each band reads as its own tag (Critical=red, not grey). */
const RISK_COLORS: Record<string, { bg: string; fg: string }> = {
  low:      { bg: '#e6f4dd', fg: '#3b6d11' },
  medium:   { bg: '#fbf3c0', fg: '#7a6212' },
  high:     { bg: '#fde0cf', fg: '#9a4516' },
  critical: { bg: '#fde7e7', fg: '#a32d2d' },
};

/** Per-status colour map — every lifecycle state gets a distinct tint (mirrors
 *  the PTW STATUS_COLORS approach). Covers hazard / assessment / JSA statuses. */
const RJ_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  draft:               { bg: '#eceff3', fg: '#5b6b7f' },
  registered:          { bg: '#e7edf6', fg: '#3d5573' },
  submitted:           { bg: '#e3eefb', fg: '#1d5fa5' },
  assessment_required: { bg: '#faf0c8', fg: '#7a6212' },
  controls_required:   { bg: '#fde7d6', fg: '#9a5b16' },
  under_review:        { bg: '#ece9fb', fg: '#5b4ab7' },
  hse_review:          { bg: '#e6e8fb', fg: '#43459e' },
  returned:            { bg: '#fdeadf', fg: '#9a4516' },
  changes_requested:   { bg: '#fdeede', fg: '#9a5a16' },
  approved:            { bg: '#e6f4dd', fg: '#3b6d11' },
  active:              { bg: '#dcf2e6', fg: '#0f7a48' },
  monitoring:          { bg: '#d9eff2', fg: '#0e6b75' },
  expired:             { bg: '#f7dede', fg: '#7d1d1d' },
  rejected:            { bg: '#fce8ee', fg: '#9b2d50' },
  closed:              { bg: '#e6eaf0', fg: '#42536b' },
  archived:            { bg: '#eef0f2', fg: '#76838f' },
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
function colorPill(label: string, c: { bg: string; fg: string }): VNode {
  return <span class="vt-pill" style={{ background: c.bg, color: c.fg }}>{label}</span>;
}
function riskColors(level: RiskLevel): { bg: string; fg: string } {
  return RISK_COLORS[level] ?? RISK_COLORS.low!;
}

/** Map a free-text risk/jsa status → its uniquely-coloured pill. */
function rjStatusPill(status: string): VNode {
  const c = RJ_STATUS_COLORS[status] ?? { bg: '#eef0f2', fg: '#5b6b7f' };
  return colorPill(status.replace(/_/g, ' '), c);
}

function riskPill(likelihood: number, severity: number): VNode {
  const score = likelihood * severity;
  const level = riskLevelFrom(score);
  return colorPill(`${cap(level)} · ${score}`, riskColors(level));
}

function riskPillFromLevel(level: RiskLevel, score?: number | null): VNode {
  return colorPill(`${cap(level)}${score != null ? ` · ${score}` : ''}`, riskColors(level));
}

/** Residual-risk pill from a residual score (L×S). Muted dash when not yet scored. */
function residualPill(score: number | null | undefined): VNode {
  if (score == null) return <span class="hse-muted">—</span>;
  const level = riskLevelFrom(score);
  return colorPill(`${cap(level)} · ${score}`, riskColors(level));
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
  const [generateOpen,    setGenerateOpen]    = useState(false);
  const [jsaPrefill,      setJsaPrefill]      = useState<JsaPrefill | null>(null);

  const { data: summaryRes, isLoading: summaryLoading } = useRiskJsaSummary();
  const summary = summaryRes?.data;

  const totalHazards       = summary?.totalHazards           ?? 0;
  const highCritical       = summary?.highCriticalHazards    ?? 0;
  const openAssessments    = summary?.openAssessments        ?? 0;
  const openJsa            = summary?.openJsa                ?? 0;
  const riskReductionPct   = summary?.riskReductionPct       ?? 0;
  const overdueAssessments = summary?.overdueAssessments     ?? 0;

  const { data: pendingRes } = useRiskJsaQueue('pending');
  const pendingCount = pendingRes?.data?.length ?? 0;

  const tabsWithCounts = withCounts(TABS, {
    hazards:     totalHazards,
    assessments: openAssessments,
    jsa:         openJsa,
    pending:     pendingCount,
  });

  const isEntityTab = ENTITY_TABS.includes(active);

  return (
    <div class="hse-tab hse-dash" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
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

      {/* ── Tab-aware summary cards (standard StatsCard row) — entity tabs only ── */}
      {isEntityTab && <RiskJsaInsightCards activeTab={active as 'hazards' | 'assessments' | 'jsa'} />}

      {/* ── Tab workspace — nav + standard New ▾ menu on the right ── */}
      <div style={{ display: 'flex', alignItems: 'stretch', gap: '12px', marginTop: '20px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <TabBar tabs={tabsWithCounts} active={active} onSelect={setActive} />
        </div>
        <div style={{ flexShrink: 0 }}>
          <NewMenu label="New" fill items={[
            { label: 'New Hazard',          icon: 'Radiation',    sub: 'Identify & rate a hazard', onSelect: () => setHazardFormOpen(true) },
            { label: 'New Risk Assessment', icon: 'LayoutGrid',   sub: '5×5 matrix scoring',        onSelect: () => setRaFormOpen(true) },
            { label: 'New JSA',             icon: 'ListOrdered',  sub: 'Job safety analysis',       onSelect: () => { setJsaPrefill(null); setJsaFormOpen(true); } },
            { label: 'Generate JSA from Risk Assessment', icon: 'WandSparkles', sub: 'Carry over scope & hazards', onSelect: () => setGenerateOpen(true) },
            { label: 'Workflow Templates',  icon: 'Workflow',     divider: true,                    onSelect: () => setTemplatesOpen(true) },
          ]} />
        </div>
      </div>

      {/* ── Quick KPI spark row — entity tabs only ── */}
      {isEntityTab && (
      <div style={{ marginTop: '16px' }}>
        <div class="hse-spark-row">
          <div class="hse-spark">
            <div class="hse-spark-header"><span class="hse-spark-label">Total Hazards</span></div>
            <div class="hse-spark-val">{totalHazards}</div>
            <div class="hse-spark-sub">On the live register</div>
          </div>
          <div class="hse-spark">
            <div class="hse-spark-header"><span class="hse-spark-label">High / Critical</span></div>
            <div class="hse-spark-val" style={{ color: '#ef4444' }}>{highCritical}</div>
            <div class="hse-spark-sub">Priority for control</div>
          </div>
          <div class="hse-spark">
            <div class="hse-spark-header"><span class="hse-spark-label">Open Assessments</span></div>
            <div class="hse-spark-val" style={{ color: '#f59e0b' }}>{openAssessments}</div>
            <div class="hse-spark-sub">{overdueAssessments > 0 ? `${overdueAssessments} overdue review` : 'All reviews current'}</div>
          </div>
          <div class="hse-spark">
            <div class="hse-spark-header"><span class="hse-spark-label">Risk Reduction</span></div>
            <div class="hse-spark-val" style={{ color: '#22c55e' }}>{riskReductionPct}%</div>
            <div class="hse-spark-sub">Initial → residual, controlled</div>
          </div>
        </div>
      </div>
      )}

      {/* ── Entity registers: table (left) + signals panel (right) ── */}
      {isEntityTab && (
      <div class="hse-main-grid">
        <div class="hse-left-col">
          {active === 'hazards' && (
            <HazardTab
              onSelect={setSelectedHazard}
              selected={selectedHazard}
            />
          )}
          {active === 'assessments' && (
            <AssessmentsTab
              onSelect={setSelectedRa}
              selected={selectedRa}
              onSubmit={(id) => { setSelectedRa(null); void id; }}
            />
          )}
          {active === 'jsa' && (
            <JsaTab
              onSelect={setSelectedJsa}
              selected={selectedJsa}
            />
          )}
        </div>

        <div class="hse-right-col">
          <RiskJsaRightPanel
            activeTab={active as 'hazards' | 'assessments' | 'jsa'}
            onHazard={setSelectedHazard}
            onAssessment={setSelectedRa}
            onJsa={setSelectedJsa}
          />
        </div>
      </div>
      )}

      {/* ── Cross-cutting tabs (full width) ── */}
      {active === 'pending'   && <PendingApprovalTab />}
      {active === 'templates' && <TemplatesTab />}
      {active === 'archive'   && <ArchiveTab />}

      {/* Dialogs */}
      <NewHazardDialog open={hazardFormOpen} onClose={() => setHazardFormOpen(false)} />
      <NewAssessmentWizard open={raFormOpen} onClose={() => setRaFormOpen(false)} />
      <NewJsaWizard open={jsaFormOpen} onClose={() => { setJsaFormOpen(false); setJsaPrefill(null); }} prefill={jsaPrefill} />
      <GenerateJsaDialog
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        onGenerated={(p) => { setGenerateOpen(false); setJsaPrefill(p); setJsaFormOpen(true); }}
      />
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
  onSelect, selected,
}: {
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
  const pg = usePagination(hazards);

  return (
    <div class="hse-area-main">
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)}
        registerLabel="Hazard Register" rows={hazards} columns={HAZARD_EXPORT_COLS} filenameBase="hazard-register" />
      <div class="hse-table-card">
        <div class="hse-table-card-top">
          <div class="vt-section-titlewrap">
            <span class="vt-section-icon"><i class="fas fa-radiation" /></span>
            <div>
              <div class="vt-section-title">Hazard Register</div>
              <div class="vt-section-sub">Identified hazards with initial and residual likelihood × severity ratings.</div>
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
              {pg.pageItems.map(h => (
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
                  <td>{rjStatusPill(h.status)}</td>
                  <td>{reviewSla(h.review_due_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={pg.page} pageCount={pg.pageCount} total={pg.total} pageSize={pg.pageSize} onPage={pg.setPage} noun="hazards" />
      </div>
    </div>
  );
}

// ── Risk Assessments tab ──────────────────────────────────────────────────────

function AssessmentsTab({
  onSelect, selected,
}: {
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
  const pg = usePagination(assessments);

  return (
    <div class="hse-area-main">
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)}
        registerLabel="Risk Assessments" rows={assessments} columns={ASSESSMENT_EXPORT_COLS} filenameBase="risk-assessments" />
      <div class="hse-table-card">
        <div class="hse-table-card-top">
          <div class="vt-section-titlewrap">
            <span class="vt-section-icon"><i class="fas fa-table-cells-large" /></span>
            <div>
              <div class="vt-section-title">Risk Assessments</div>
              <div class="vt-section-sub">Formal assessments scored on the 5×5 matrix — initial through residual risk.</div>
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
              {pg.pageItems.map(a => (
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
                  <td>{rjStatusPill(a.status)}</td>
                  <td>{reviewSla(a.review_due_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={pg.page} pageCount={pg.pageCount} total={pg.total} pageSize={pg.pageSize} onPage={pg.setPage} noun="assessments" />
      </div>
    </div>
  );
}

// ── JSA Library tab ───────────────────────────────────────────────────────────

function JsaTab({
  onSelect, selected,
}: {
  onSelect: (j: JsaRow) => void;
  selected: JsaRow | null;
}): VNode {
  const [siteId, setSiteId] = useState('');
  const [status, setStatus] = useState('');
  const [exportOpen, setExportOpen] = useState(false);

  const { data, isLoading } = useJsaList({ status: status || undefined });
  const all  = data?.data ?? [];
  const jsas = all.filter(j => matchesSite(j, siteId));
  const pg = usePagination(jsas);

  return (
    <div class="hse-area-main">
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)}
        registerLabel="JSA Library" rows={jsas} columns={JSA_EXPORT_COLS} filenameBase="jsa-library" />
      <div class="hse-table-card">
        <div class="hse-table-card-top">
          <div class="vt-section-titlewrap">
            <span class="vt-section-icon"><i class="fas fa-list-ol" /></span>
            <div>
              <div class="vt-section-title">JSA Library</div>
              <div class="vt-section-sub">Job Safety Analyses — step-by-step hazard identification and controls per task.</div>
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
              {pg.pageItems.map(j => (
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
                  <td>{rjStatusPill(j.status)}</td>
                  <td>{reviewSla(j.review_due_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={pg.page} pageCount={pg.pageCount} total={pg.total} pageSize={pg.pageSize} onPage={pg.setPage} noun="JSAs" />
      </div>
    </div>
  );
}
