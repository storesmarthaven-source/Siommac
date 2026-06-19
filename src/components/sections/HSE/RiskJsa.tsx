/**
 * src/components/sections/HSE/RiskJsa.tsx
 *
 * Risk & JSA area. In-page tabs:
 *   • Hazard Register  — KPI strip + split: hazard table (left) + risk
 *                        distribution sidebar (right: by category + high-risk list)
 *   • Risk Assessments — split: assessment table (left) + live 5×5 risk matrix
 *                        + new-assessment modal with live rating preview
 *   • JSA Library      — KPI strip + split: JSA table (left) + JSA detail aside
 *
 * UI/mock only; the new-assessment form adds to a local list.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import {
  AreaHero, AreaTabs, HseModal, SectionHead, Field,
  TextInput, SelectInput,
  type AreaTab,
} from './_shared';
import {
  mockHazards, mockRiskAssessments, mockJsas, riskRating, hsePill, HSE_SITES,
  type RiskAssessmentRow, type JsaRow,
} from './types';

const TABS: AreaTab[] = [
  { key: 'hazards',     label: 'Hazard Register',  icon: 'fa-radiation' },
  { key: 'assessments', label: 'Risk Assessments', icon: 'fa-table-cells-large' },
  { key: 'jsa',         label: 'JSA Library',      icon: 'fa-list-ol' },
];

const SCALE = [1, 2, 3, 4, 5];

function ratingPill(likelihood: number, severity: number): VNode {
  const r = riskRating(likelihood, severity);
  const cls = r.severity === 'danger' ? 'is-off' : r.severity === 'warning' ? 'is-warn' : 'is-on';
  return <span class={`vt-pill ${cls}`}>{r.band} · {r.score}</span>;
}

export function RiskJsaArea({ tab }: { tab: string }): VNode {
  const [active, setActive]           = useState(tab);
  const [assessments, setAssessments] = useState<RiskAssessmentRow[]>(mockRiskAssessments);
  const [formOpen, setFormOpen]       = useState(false);
  const [openJsa, setOpenJsa]         = useState<JsaRow | null>(null);

  const highRisk = mockHazards.filter(h => riskRating(h.likelihood, h.severity).score >= 10).length;

  const stats = [
    { icon: 'fa-radiation',           label: 'Hazards',          value: mockHazards.length,   color: 'blue' },
    { icon: 'fa-table-cells-large',   label: 'Assessments',      value: assessments.length,   color: 'gold' },
    { icon: 'fa-triangle-exclamation',label: 'High / Critical',  value: highRisk,             color: 'red' },
    { icon: 'fa-list-ol',             label: 'JSAs',             value: mockJsas.length,      color: 'green' },
  ];

  const acceptableRisk = mockHazards.filter(h => riskRating(h.likelihood, h.severity).score < 6).length;
  const overdue        = assessments.filter(a => /overdue/i.test(a.status ?? '')).length;

  return (
    <div class="hse-tab hse-dash">
      <AreaHero
        icon="fa-radiation"
        areaIcon="fa-shield-halved"
        title="Risk & JSA"
        crumb="Risk & JSA"
        context={['Hazard Register · Risk Assessments · JSA Library', 'Trinidad & Tobago Operations']}
        badges={[
          { icon: 'fa-calendar', label: 'Jan – Jun 2026' },
          { icon: 'fa-location-dot', label: '5 Active Sites' },
          { icon: 'fa-scale-balanced', label: 'Risk Matrix 5×5' },
        ]}
        stats={stats}
        metrics={[
          { label: 'High / critical risks', value: String(highRisk) },
          { label: 'Acceptable risk', value: `${acceptableRisk} hazards` },
          { label: 'Assessments overdue', value: String(overdue) },
          { label: 'JSAs reviewed YTD', value: String(mockJsas.length) },
        ]}
      />
      <AreaTabs tabs={TABS} active={active} onSelect={setActive} />

      {active === 'hazards' && <HazardTab />}
      {active === 'assessments' && (
        <AssessmentsTab
          assessments={assessments}
          onNew={() => setFormOpen(true)}
        />
      )}
      {active === 'jsa' && <JsaTab openJsa={openJsa} onOpen={setOpenJsa} />}

      <NewAssessmentModal
        open={formOpen} onClose={() => setFormOpen(false)}
        onSubmit={(a) => { setAssessments([a, ...assessments]); setFormOpen(false); }}
      />
    </div>
  );
}

// ── Hazard Register tab ────────────────────────────────────────────────────────

function HazardTab(): VNode {
  const highRisk = mockHazards.filter(h => riskRating(h.likelihood, h.severity).score >= 10);
  const byCategory = mockHazards.reduce<Record<string, number>>((acc, h) => {
    acc[h.category] = (acc[h.category] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div class="hse-area-split">
        <div class="hse-area-main">
          <SectionHead icon="fa-radiation" title="Hazard Register" sub="Identified hazards with likelihood × severity risk ratings." actions={
            <button class="hse-btn primary"><i class="fas fa-circle-plus" /> New Hazard</button>
          } />
          <div class="vt-toolbar">
            <div class="vt-search" style={{ flex: '1 1 200px' }}><i class="fas fa-search" /><input type="search" placeholder="Search hazards…" /></div>
            <select class="emp-filter-select"><option>All categories</option>{Object.keys(byCategory).map(c => <option key={c}>{c}</option>)}</select>
            <select class="emp-filter-select"><option>All sites</option>{HSE_SITES.map(s => <option key={s}>{s}</option>)}</select>
          </div>
          <div class="vt-table-card">
            <div class="vt-table-scroll">
              <table class="vt-table">
                <thead><tr><th>Ref</th><th>Hazard</th><th>Category</th><th>Site</th><th>L × S</th><th>Risk</th><th>Controls</th></tr></thead>
                <tbody>
                  {mockHazards.map(h => (
                    <tr key={h.ref} style={{ cursor: 'pointer' }}>
                      <td><span class="vt-cell-mono">{h.ref}</span></td>
                      <td><span class="vt-cell-name">{h.hazard}</span></td>
                      <td>{h.category}</td>
                      <td class="hse-muted">{h.site}</td>
                      <td class="hse-muted">{h.likelihood} × {h.severity}</td>
                      <td>{ratingPill(h.likelihood, h.severity)}</td>
                      <td class="hse-muted" style={{ maxWidth: '240px' }}>{h.controls}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <aside class="hse-area-aside">
          {/* High-risk callout */}
          {highRisk.length > 0 && (
            <div class="hse-aside-card hse-aside-alert">
              <div class="hse-aside-head is-danger"><i class="fas fa-triangle-exclamation" /><span>{highRisk.length} High / Critical Hazards</span></div>
              <div class="hse-aside-list">
                {highRisk.map(h => (
                  <div class="hse-aside-row" key={h.ref}>
                    <i class="fas fa-circle hse-aside-dot is-danger" />
                    <div class="hse-aside-text">
                      <strong>{h.hazard}</strong>
                      <span>{h.site} · Score {riskRating(h.likelihood, h.severity).score}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Distribution by category */}
          <div class="hse-aside-card">
            <div class="hse-aside-head"><i class="fas fa-chart-bar" /><span>By Category</span></div>
            {Object.entries(byCategory).map(([cat, count]) => (
              <div class="hse-priority-bar" key={cat}>
                <div class="hse-priority-label"><span class="hse-priority-name">{cat}</span><span>{count}</span></div>
                <div class="hse-progress"><i style={{ width: `${Math.round((count / mockHazards.length) * 100)}%`, background: 'var(--siomac-navy)' }} /></div>
              </div>
            ))}
          </div>
        </aside>
    </div>
  );
}

// ── Risk Assessments tab ───────────────────────────────────────────────────────

function AssessmentsTab({ assessments, onNew }: { assessments: RiskAssessmentRow[]; onNew: () => void }): VNode {
  return (
    <div class="hse-area-split">
      <div class="hse-area-main">
        <SectionHead icon="fa-table-cells-large" title="Risk Assessments" sub="Formal risk assessments with likelihood × severity matrix scoring." actions={
          <button class="hse-btn primary" onClick={onNew}><i class="fas fa-circle-plus" /> New Assessment</button>
        } />
        <div class="vt-toolbar">
          <div class="vt-search" style={{ flex: '1 1 200px' }}><i class="fas fa-search" /><input type="search" placeholder="Search assessments…" /></div>
          <select class="emp-filter-select"><option>All sites</option>{HSE_SITES.map(s => <option key={s}>{s}</option>)}</select>
        </div>
        <div class="vt-table-card">
          <div class="vt-table-scroll">
            <table class="vt-table">
              <thead><tr><th>Ref</th><th>Title</th><th>Site</th><th>Risk Rating</th><th>Status</th><th>Assessor</th></tr></thead>
              <tbody>
                {assessments.map(a => (
                  <tr key={a.ref} style={{ cursor: 'pointer' }}>
                    <td><span class="vt-cell-mono">{a.ref}</span></td>
                    <td><span class="vt-cell-name">{a.title}</span></td>
                    <td class="hse-muted">{a.site}</td>
                    <td>{ratingPill(a.likelihood, a.severity)}</td>
                    <td><span class={hsePill(a.status)}>{a.status}</span></td>
                    <td class="hse-muted">{a.assessor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Risk matrix side panel */}
      <aside class="hse-area-aside">
        <RiskMatrix assessments={assessments} />
        <div class="hse-aside-card hse-aside-stats">
          <div class="hse-aside-stat">
            <strong>{assessments.filter(a => riskRating(a.likelihood, a.severity).score >= 10).length}</strong>
            <span>High / Critical</span>
          </div>
          <div class="hse-aside-stat">
            <strong>{assessments.filter(a => /active/i.test(a.status)).length}</strong>
            <span>Active</span>
          </div>
          <div class="hse-aside-stat">
            <strong>{assessments.filter(a => /review/i.test(a.status)).length}</strong>
            <span>Under Review</span>
          </div>
        </div>
      </aside>
    </div>
  );
}

// ── JSA Library tab ────────────────────────────────────────────────────────────

function JsaTab({ openJsa, onOpen }: { openJsa: JsaRow | null; onOpen: (j: JsaRow) => void }): VNode {
  return (
    <>
      <div class="hse-area-split">
        <div class="hse-area-main">
          <SectionHead icon="fa-list-ol" title="JSA Library" sub="Job Safety Analyses — step-by-step hazard identification per task." actions={
            <button class="hse-btn primary"><i class="fas fa-circle-plus" /> New JSA</button>
          } />
          <div class="vt-toolbar">
            <div class="vt-search" style={{ flex: '1 1 200px' }}><i class="fas fa-search" /><input type="search" placeholder="Search JSAs…" /></div>
            <select class="emp-filter-select"><option>All sites</option>{HSE_SITES.map(s => <option key={s}>{s}</option>)}</select>
          </div>
          <div class="vt-table-card">
            <div class="vt-table-scroll">
              <table class="vt-table">
                <thead><tr><th>Ref</th><th>Task</th><th>Site</th><th>Steps</th><th>Status</th><th>Reviewed</th></tr></thead>
                <tbody>
                  {mockJsas.map(j => (
                    <tr key={j.ref} onClick={() => onOpen(j)} style={{ cursor: 'pointer' }}
                        class={openJsa?.ref === j.ref ? 'vt-row-active' : ''}>
                      <td><span class="vt-cell-mono">{j.ref}</span></td>
                      <td><span class="vt-cell-name">{j.task}</span></td>
                      <td class="hse-muted">{j.site}</td>
                      <td class="hse-muted">{j.steps} steps</td>
                      <td><span class={hsePill(j.status)}>{j.status}</span></td>
                      <td class="hse-muted">{j.reviewed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <aside class="hse-area-aside">
          {openJsa ? (
            <div class="hse-aside-card">
              <div class="hse-aside-head"><i class="fas fa-list-ol" /><span>{openJsa.ref}</span></div>
              <div class="hse-aside-meta">
                <span class={hsePill(openJsa.status)}>{openJsa.status}</span>
                <span class="hse-muted">Reviewed: {openJsa.reviewed}</span>
              </div>
              <div style={{ padding: '10px 0 4px', display: 'grid', gap: '8px' }}>
                <div class="hse-aside-detail-row"><i class="fas fa-tasks" /><div><strong>Task</strong><span>{openJsa.task}</span></div></div>
                <div class="hse-aside-detail-row"><i class="fas fa-map-marker-alt" /><div><strong>Site</strong><span>{openJsa.site}</span></div></div>
                <div class="hse-aside-detail-row"><i class="fas fa-list-ol" /><div><strong>Steps documented</strong><span>{openJsa.steps} steps</span></div></div>
              </div>
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
              <div class="hse-aside-stat"><strong>{mockJsas.filter(j => /approved/i.test(j.status)).length}</strong><span>Approved</span></div>
              <div class="hse-aside-stat"><strong>{mockJsas.filter(j => /review/i.test(j.status)).length}</strong><span>In Review</span></div>
              <div class="hse-aside-stat"><strong>{mockJsas.filter(j => /draft/i.test(j.status)).length}</strong><span>Draft</span></div>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

// ── 5×5 risk matrix (shared across Assessments tab and modal) ─────────────────

function RiskMatrix({ assessments }: { assessments: RiskAssessmentRow[] }): VNode {
  const counts = new Map<string, number>();
  for (const a of assessments) {
    const k = `${a.likelihood}-${a.severity}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
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

// ── New assessment modal ───────────────────────────────────────────────────────

function NewAssessmentModal({ open, onClose, onSubmit }: {
  open: boolean; onClose: () => void; onSubmit: (a: RiskAssessmentRow) => void;
}): VNode | null {
  const [title, setTitle]           = useState('');
  const [site, setSite]             = useState<string>(HSE_SITES[0]);
  const [likelihood, setLikelihood] = useState('3');
  const [severity, setSeverity]     = useState('3');

  const L = parseInt(likelihood, 10), S = parseInt(severity, 10);

  function submit() {
    const ref = `RA-2026-${Math.floor(15 + Math.random() * 80)}`;
    onSubmit({ ref, title: title || 'New Risk Assessment', site, likelihood: L, severity: S, status: 'Active', assessor: 'S. Chen' });
    setTitle('');
  }

  return (
    <HseModal open={open} title="New Risk Assessment" sub="Rate likelihood × severity; the band is derived live." onClose={onClose} onSubmit={submit} submitLabel="Create">
      <div class="hse-form-grid">
        <Field label="Title" wide><TextInput value={title} onInput={setTitle} placeholder="e.g. Transfer-line cleanup" /></Field>
        <Field label="Site"><SelectInput value={site} onInput={setSite} options={[...HSE_SITES]} /></Field>
        <Field label="Likelihood (1–5)"><SelectInput value={likelihood} onInput={setLikelihood} options={SCALE.map(String)} /></Field>
        <Field label="Severity (1–5)"><SelectInput value={severity} onInput={setSeverity} options={SCALE.map(String)} /></Field>
        <Field label="Derived risk rating">
          <div class="hse-rating-preview">{ratingPill(L, S)}</div>
        </Field>
      </div>
    </HseModal>
  );
}
