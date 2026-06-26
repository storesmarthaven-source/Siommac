/**
 * src/components/sections/HR/EmployeeMaster.tsx
 *
 * HR ▸ Employee Master — a FAITHFUL port of the v36 source mockup's main page
 * (siomac-hr-employee-master-preact-v36-settings-wizard-leftbar.html): the page
 * header (Settings + New menu), the 4 one-line KPI stat cards with their charts,
 * the filter toolbar, the 10-column register, and pagination — rendered inside the
 * Siomac AppShell (the mockup's own hr-sidebar/topbar are dropped; Siomac provides
 * them). Styling lives in ./HR.css, scoped to `.hr-emp-master`.
 *
 * Wiring is real: KPIs ← useHrDashboardStats; the register ← useHrEmployees, whose
 * rows carry siteName (resolved from project_sites) and supervisorName (resolved
 * from app_users) server-side — "Site"/"Supervisor" show — only when genuinely
 * unassigned. Only filters backed by real data are wired (status, department,
 * employment type, training) — the v36 advanced panel's aspirational filters map to
 * features not yet in Siomac and are deferred to the Siomac-fit pass rather than
 * shipped as no-op filters.
 *
 * This is Phase A (read-side main page). The profile drawer, create/import/
 * onboarding wizards, and change/status/document/offboarding dialogs are the next
 * phases — their entry points here surface a "next phase" notice rather than a
 * dead click.
 */

import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import {
  useHrEmployees, useHrDashboardStats,
  type HrEmployeeRow, type HrDashboardStats, type TrainingStatus,
} from '@api/hr/employees';
import {
  humanize, rowName, statusTone, TRAINING_TONE, TRAINING_LABEL, Avatar, TinyAvatar,
} from './shared';
import { ProfileDrawer } from './ProfileDrawer';
import { CreateEmployeeWizard } from './CreateEmployeeWizard';
import { ContactDialog, StatusDialog, OffboardingDialog, ChangeRequestDialog, DocumentDialog } from './ActionDialogs';
import { ImportWizard } from './ImportWizard';
import { OnboardingWizard } from './OnboardingWizard';
import './HR.css';

// ── small helpers ─────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthLabel(p: string): string {
  const m = /^\d{4}-(\d{2})$/.exec(p);
  if (m) { const i = Number(m[1]) - 1; return MONTHS[i] ?? p; }
  return p.length > 3 ? p.slice(0, 3) : p;
}

// ── KPI stat icons (ported from v36 StatSvgIcon) ───────────────────────────────

function StatIcon({ type }: { type: 'users' | 'queue' | 'shield' | 'alert' }): VNode {
  if (type === 'users') return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
  if (type === 'queue') return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 11l2 2 4-4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      <path d="M17 3h4v4" />
      <path d="M16 8l5-5" />
    </svg>
  );
  if (type === 'shield') return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="M9 12l2 2 4-5" />
    </svg>
  );
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

// ── charts (wired to real dashboard-stats) ─────────────────────────────────────

function WorkforceTrendChart({ trend }: { trend: { period: string; count: number }[] }): VNode {
  const pts = trend.slice(-6);
  if (!pts.length) return <div class="em-stat-chart em-line-chart"><div class="em-chart-empty">No trend data</div></div>;
  const counts = pts.map(p => p.count);
  const max = Math.max(...counts), min = Math.min(...counts);
  const span = max - min || 1;
  const n = pts.length;
  const X = (i: number) => (n === 1 ? 210 : 18 + (i * (402 - 18)) / (n - 1));
  const Y = (c: number) => 132 - ((c - min) / span) * (132 - 24);
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${X(i).toFixed(1)} ${Y(p.count).toFixed(1)}`).join(' ');
  const area = `${line} L ${X(n - 1).toFixed(1)} 145 L ${X(0).toFixed(1)} 145 Z`;
  return (
    <div class="em-stat-chart em-line-chart">
      <svg viewBox="0 0 420 160" preserveAspectRatio="none" role="img" aria-label="Active workforce trend">
        <path d="M18 132 H402 M18 96 H402 M18 60 H402 M18 24 H402" fill="none" stroke="#e7edf6" stroke-width="1" />
        <path d={area} fill="#eff6ff" />
        <path d={line} fill="none" stroke="#0b5bd3" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
        {pts.map((p, i) => <circle cx={X(i)} cy={Y(p.count)} r={i === n - 1 ? 5 : 4} fill="#fff" stroke="#0b5bd3" stroke-width="3" />)}
        {pts.map((p, i) => <text x={X(i)} y="157" text-anchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{monthLabel(p.period)}</text>)}
      </svg>
    </div>
  );
}

function ChangeMixChart({ mix }: { mix: { type: string; count: number }[] }): VNode {
  const rows = mix.slice(0, 4);
  if (!rows.length) return <div class="em-stat-chart em-mini-bars"><div class="em-chart-empty">No open actions</div></div>;
  const max = Math.max(...rows.map(r => r.count), 1);
  return (
    <div class="em-stat-chart em-mini-bars">
      {rows.map(r => (
        <div class="em-mini-bar-row">
          <span>{humanize(r.type)}</span>
          <i><b style={{ width: `${Math.round((r.count / max) * 100)}%` }} /></i>
          <strong>{r.count}</strong>
        </div>
      ))}
    </div>
  );
}

function ReadinessChart(
  { percent, payrollReady, trainingCurrent, needReview }:
  { percent: number; payrollReady: number; trainingCurrent: number; needReview: number },
): VNode {
  const C = 2 * Math.PI * 50;
  const dash = (Math.max(0, Math.min(100, percent)) / 100) * C;
  return (
    <div class="em-stat-chart em-readiness-panel">
      <svg viewBox="0 0 210 150" role="img" aria-label={`Readiness ${percent} percent`}>
        <circle cx="75" cy="75" r="50" fill="none" stroke="#e7edf6" stroke-width="14" />
        <circle cx="75" cy="75" r="50" fill="none" stroke="#16a34a" stroke-width="14" stroke-linecap="round"
          stroke-dasharray={`${dash.toFixed(1)} ${(C - dash).toFixed(1)}`} transform="rotate(-90 75 75)" />
        <text x="75" y="70" text-anchor="middle" class="ring-score">{percent}%</text>
        <text x="75" y="91" text-anchor="middle" class="ring-sub">ready</text>
      </svg>
      <div class="em-readiness-list">
        <div><b>{payrollReady}</b><span>Payroll ready</span></div>
        <div><b>{trainingCurrent}</b><span>Training current</span></div>
        <div><b>{needReview}</b><span>Need HR review</span></div>
      </div>
    </div>
  );
}

const EXC_COLORS = ['red', 'amber', 'blue'];
function ExceptionChart({ items }: { items: { type: string; count: number }[] }): VNode {
  const rows = items.slice(0, 3);
  if (!rows.length) return <div class="em-stat-chart em-exception-chart"><div class="em-chart-empty">No exceptions</div></div>;
  const max = Math.max(...rows.map(r => r.count), 1);
  return (
    <div class="em-stat-chart em-exception-chart">
      {rows.map((r, i) => (
        <div class="exception-row">
          <span>{humanize(r.type)}</span>
          <i class={EXC_COLORS[i % 3]}><b style={{ width: `${Math.round((r.count / max) * 100)}%` }} /></i>
          <strong>{r.count}</strong>
        </div>
      ))}
    </div>
  );
}

// ── KPI cards ──────────────────────────────────────────────────────────────────

function EmStatChip({ value, label }: { value: string; label: string }): VNode {
  return <div class="em-stat-chip"><strong>{value}</strong><span>{label}</span></div>;
}

function EmStatCard(
  { tone, icon, title, value, label, state, chart, children }:
  { tone: string; icon: 'users' | 'queue' | 'shield' | 'alert'; title: string; value: string;
    label: string; state: string; chart: VNode; children: VNode | VNode[] },
): VNode {
  return (
    <section class={`em-stat-card em-stat-card-${tone}`}>
      <div class="em-stat-head">
        <div class="em-stat-title"><span class="em-stat-icon"><StatIcon type={icon} /></span><h3>{title}</h3></div>
        <span class="em-stat-state">{state}</span>
      </div>
      <div class="em-stat-main">
        <div class="em-stat-metric">
          <div class="em-stat-value">{value}</div>
          <div class="em-stat-label">{label}</div>
          <div class="em-stat-bottom">{children}</div>
        </div>
        {chart}
      </div>
    </section>
  );
}

function KpiGrid({ stats }: { stats?: HrDashboardStats }): VNode {
  const aw = stats?.active_workforce;
  const wq = stats?.hr_work_queue;
  const rd = stats?.readiness;
  const ex = stats?.exceptions;
  const trend = aw?.trend ?? [];
  const last = trend[trend.length - 1];
  const prev = trend[trend.length - 2];
  const net = last && prev ? last.count - prev.count : null;
  return (
    <div class="em-stat-grid">
      <EmStatCard tone="blue" icon="users" title="Active Workforce" value={String(aw?.total ?? 0)}
        label="Active people records across all sites"
        state={net != null ? `${net >= 0 ? '+' : ''}${net} net this month` : 'Active'}
        chart={<WorkforceTrendChart trend={trend} />}>
        <EmStatChip value={String(aw?.employees ?? 0)} label="Employees" />
        <EmStatChip value={String(aw?.contractors ?? 0)} label="Contractors" />
      </EmStatCard>

      <EmStatCard tone="amber" icon="queue" title="HR Work Queue" value={String(wq?.total ?? 0)}
        label="Open HR actions requiring review" state={`${wq?.urgent ?? 0} urgent`}
        chart={<ChangeMixChart mix={wq?.mix ?? []} />}>
        {(wq?.mix ?? []).slice(0, 2).map(m => <EmStatChip value={String(m.count)} label={humanize(m.type)} />)}
      </EmStatCard>

      <EmStatCard tone="green" icon="shield" title="Readiness" value={`${rd?.percent ?? 0}%`}
        label="Payroll, statutory and training readiness" state={`${rd?.blocked ?? 0} pending checks`}
        chart={<ReadinessChart percent={rd?.percent ?? 0} payrollReady={rd?.payroll_ready ?? 0}
          trainingCurrent={rd?.training_current ?? 0} needReview={rd?.blocked ?? 0} />}>
        <EmStatChip value={String(rd?.payroll_ready ?? 0)} label="Payroll ready" />
        <EmStatChip value={String(rd?.training_current ?? 0)} label="Training current" />
      </EmStatCard>

      <EmStatCard tone="red" icon="alert" title="Workforce Exceptions" value={String(ex?.total ?? 0)}
        label="Records blocking clean handoff or assignment"
        state={(ex?.total ?? 0) > 0 ? 'Needs action' : 'Clear'}
        chart={<ExceptionChart items={ex?.items ?? []} />}>
        {(ex?.items ?? []).slice(0, 2).map(i => <EmStatChip value={String(i.count)} label={humanize(i.type)} />)}
      </EmStatCard>
    </div>
  );
}

// ── toolbar ────────────────────────────────────────────────────────────────────

interface Filters { query: string; status: string[]; department: string[]; employmentType: string[]; training: string[]; }
const EMPTY_FILTERS: Filters = { query: '', status: [], department: [], employmentType: [], training: [] };

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter(x => x !== v) : [...list, v];
}

function MultiDropdown(
  { id, label, options, selected, onChange, openId, setOpenId, labelFn }:
  { id: string; label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void;
    openId: string | null; setOpenId: (v: string | null) => void; labelFn: (o: string) => string },
): VNode {
  const isOpen = openId === id;
  const value = selected.length
    ? selected.slice(0, 2).map(labelFn).join(', ') + (selected.length > 2 ? ` +${selected.length - 2}` : '')
    : 'All';
  return (
    <div class="dropdown-wrap">
      <button type="button" class="multi-select" onClick={e => { e.stopPropagation(); setOpenId(isOpen ? null : id); }}>
        <span class="multi-select-text"><span class="multi-select-label">{label}</span><span class="multi-select-value">{value}</span></span>
        {selected.length ? <span class="multi-select-count">{selected.length}</span> : <span>⌄</span>}
      </button>
      {isOpen && (
        <div class="dropdown-menu" onClick={e => e.stopPropagation()}>
          <div class="dropdown-head"><strong>{label}</strong><span>Select one or more values.</span></div>
          <div class="dropdown-list">
            {options.length ? options.map(opt => (
              <button type="button" class={`check-row ${selected.includes(opt) ? 'active' : ''}`} onClick={() => onChange(toggle(selected, opt))}>
                <span class="check-box">{selected.includes(opt) ? '✓' : ''}</span><span>{labelFn(opt)}</span>
              </button>
            )) : <div class="em-empty">No values</div>}
          </div>
          <div class="dropdown-foot">
            <button type="button" onClick={() => onChange([])}>Clear</button>
            <button type="button" class="apply" onClick={() => setOpenId(null)}>Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}

function OptionSet(
  { title, options, selected, onChange, labelFn }:
  { title: string; options: string[]; selected: string[]; onChange: (v: string[]) => void; labelFn: (o: string) => string },
): VNode {
  return (
    <div class="advanced-section">
      <div class="advanced-section-title"><strong>{title}</strong><span>{selected.length ? `${selected.length} selected` : 'All'}</span></div>
      <div class="compact-checks">
        {options.length ? options.map(opt => (
          <button type="button" class={`check-row ${selected.includes(opt) ? 'active' : ''}`}
            onClick={e => { e.stopPropagation(); onChange(toggle(selected, opt)); }}>
            <span class="check-box">{selected.includes(opt) ? '✓' : ''}</span><span>{labelFn(opt)}</span>
          </button>
        )) : <div class="em-empty">No values</div>}
      </div>
    </div>
  );
}

const ADV_TABS = ['Organization', 'Employment', 'Compliance'] as const;
type AdvTab = typeof ADV_TABS[number];

function AdvancedFilters(
  { filters, setFilters, openId, setOpenId, deptOptions, typeOptions, trainingOptions }:
  { filters: Filters; setFilters: (f: Filters) => void; openId: string | null; setOpenId: (v: string | null) => void;
    deptOptions: string[]; typeOptions: string[]; trainingOptions: string[] },
): VNode {
  const isOpen = openId === 'advanced-filters';
  const [tab, setTab] = useState<AdvTab>('Organization');
  const count = filters.department.length + filters.employmentType.length + filters.training.length;
  const clearAdvanced = () => setFilters({ ...filters, department: [], employmentType: [], training: [] });
  const trainingLabel = (t: string) => TRAINING_LABEL[t as TrainingStatus] ?? humanize(t);
  return (
    <div class="dropdown-wrap" onClick={e => e.stopPropagation()}>
      <button type="button" class="advanced-filter-btn" onClick={e => { e.stopPropagation(); setOpenId(isOpen ? null : 'advanced-filters'); }}>
        <span class="left">
          <span class="sliders">≡</span>
          <span><small>Advanced</small><strong>{count ? `${count} filters active` : 'Advanced filters'}</strong></span>
        </span>
        {count ? <span class="advanced-count">{count}</span> : <span>⌄</span>}
      </button>
      {isOpen && (
        <div class="dropdown-menu advanced-menu right" onClick={e => e.stopPropagation()}>
          <div class="dropdown-head"><strong>Advanced Filters</strong><span>Filters backed by real Employee Master data.</span></div>
          <div class="advanced-panel tabbed">
            <div class="advanced-tabs">
              {ADV_TABS.map(name => (
                <button type="button" class={`advanced-tab ${tab === name ? 'active' : ''}`} onClick={e => { e.stopPropagation(); setTab(name); }}>{name}</button>
              ))}
            </div>
            <div class="advanced-tab-body">
              {tab === 'Organization' && (
                <div>
                  <div class="advanced-tab-title">
                    <div><strong>Organization filters</strong><span>Filter by department assignment.</span></div>
                    <span class="setting-pill">Multi-select</span>
                  </div>
                  <div class="filter-tab-grid">
                    <OptionSet title="Department" options={deptOptions} selected={filters.department}
                      onChange={v => setFilters({ ...filters, department: v })} labelFn={humanize} />
                  </div>
                </div>
              )}
              {tab === 'Employment' && (
                <div>
                  <div class="advanced-tab-title">
                    <div><strong>Employment filters</strong><span>Filter by employee / worker type.</span></div>
                    <span class="setting-pill">Multi-select</span>
                  </div>
                  <div class="filter-tab-grid">
                    <OptionSet title="Employment Type" options={typeOptions} selected={filters.employmentType}
                      onChange={v => setFilters({ ...filters, employmentType: v })} labelFn={humanize} />
                  </div>
                </div>
              )}
              {tab === 'Compliance' && (
                <div>
                  <div class="advanced-tab-title">
                    <div><strong>Compliance filters</strong><span>Filter by training readiness.</span></div>
                    <span class="setting-pill">Multi-select</span>
                  </div>
                  <div class="filter-tab-grid">
                    <OptionSet title="Training Status" options={trainingOptions} selected={filters.training}
                      onChange={v => setFilters({ ...filters, training: v })} labelFn={trainingLabel} />
                  </div>
                </div>
              )}
            </div>
            <div class="advanced-footer">
              <button class="secondary-btn" type="button" onClick={clearAdvanced}>Reset Advanced</button>
              <button class="primary-btn" type="button" onClick={() => setOpenId(null)}>Apply Filters</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SavedViewsMenu(
  { openId, setOpenId, apply, statusOptions, typeOptions }:
  { openId: string | null; setOpenId: (v: string | null) => void; apply: (f: Filters) => void;
    statusOptions: string[]; typeOptions: string[] },
): VNode {
  const isOpen = openId === 'saved-views';
  const views: { label: string; build: () => Filters }[] = [
    { label: 'Active employees', build: () => ({ ...EMPTY_FILTERS, status: statusOptions.filter(s => /active/i.test(s) && !/inactive/i.test(s)) }) },
    { label: 'Contractors', build: () => ({ ...EMPTY_FILTERS, employmentType: typeOptions.filter(t => /contract/i.test(t)) }) },
    { label: 'Training expired', build: () => ({ ...EMPTY_FILTERS, training: ['expired'] }) },
    { label: 'Clear filters', build: () => ({ ...EMPTY_FILTERS }) },
  ];
  return (
    <div class="dropdown-wrap">
      <button type="button" class="advanced-filter-btn" title="Saved views" onClick={e => { e.stopPropagation(); setOpenId(isOpen ? null : 'saved-views'); }}>
        <span class="left"><span class="sliders">☷</span><span><small>Views</small><strong>Saved Views</strong></span></span>
        <span>⌄</span>
      </button>
      {isOpen && (
        <div class="dropdown-menu right" onClick={e => e.stopPropagation()}>
          <div class="dropdown-head"><strong>Saved Views</strong><span>Fast Employee Master presets.</span></div>
          <div class="dropdown-list">
            {views.map(v => (
              <button type="button" class="menu-row" onClick={() => { apply(v.build()); setOpenId(null); }}>
                <span class="menu-ico"><i class="fas fa-table-cells-large" /></span><span>{v.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── register table ─────────────────────────────────────────────────────────────

const TABLE_COLS = ['Employee', 'Employee No.', 'Position / Role', 'Department', 'Site', 'Supervisor', 'Employment Type', 'Status', 'Training Status', 'Actions'];

function EmployeeRow(
  { emp, supervisorName, selected, openId, setOpenId, onSelect, onAction }:
  { emp: HrEmployeeRow; supervisorName: string | null; selected: boolean; openId: string | null;
    setOpenId: (v: string | null) => void; onSelect: (id: string) => void; onAction: (label: string, id: string) => void },
): VNode {
  const name = rowName(emp);
  const type = emp.employment_type ?? emp.workerType;
  const kebabId = `row-${emp.id}`;
  const isOpen = openId === kebabId;
  return (
    <tr class={`employee-row ${selected ? 'selected' : ''}`} onClick={() => onSelect(emp.id)}>
      <td>
        <div class="employee-cell">
          <Avatar name={name} img={emp.profile_image_url} />
          <div style={{ minWidth: 0 }}>
            <div class="emp-name">{name}</div>
            <div class="emp-email">{emp.email ?? emp.personal_email ?? '—'}</div>
          </div>
        </div>
      </td>
      <td>{emp.employee_number ?? '—'}</td>
      <td>{emp.position ?? '—'}</td>
      <td>{emp.departmentName ?? '—'}</td>
      <td>{emp.siteName ?? '—'}</td>
      <td>{supervisorName
        ? <div class="supervisor-cell"><TinyAvatar name={supervisorName} />{supervisorName}</div>
        : <span style={{ color: '#94a3b8' }}>No supervisor</span>}</td>
      <td>{humanize(type)}</td>
      <td><span class={`pill ${statusTone(emp.status)}`}>{humanize(emp.status)}</span></td>
      <td><span class={`pill ${TRAINING_TONE[emp.trainingStatus]}`}>{TRAINING_LABEL[emp.trainingStatus]}</span></td>
      <td class="kebab" onClick={e => e.stopPropagation()}>
        <div class="dropdown-wrap">
          <button type="button" class="kebab-btn" onClick={e => { e.stopPropagation(); setOpenId(isOpen ? null : kebabId); }}>⋮</button>
          {isOpen && (
            <div class="dropdown-menu right" onClick={e => e.stopPropagation()}>
              <div class="dropdown-list">
                <button type="button" class="menu-row" onClick={() => { onSelect(emp.id); setOpenId(null); }}>
                  <span class="menu-ico"><i class="fas fa-eye" /></span>View Profile
                </button>
                <button type="button" class="menu-row" onClick={() => { onAction('Request Change', emp.id); setOpenId(null); }}>
                  <span class="menu-ico"><i class="fas fa-pen" /></span>Request Change
                </button>
                <button type="button" class="menu-row" onClick={() => { onAction('Change Status', emp.id); setOpenId(null); }}>
                  <span class="menu-ico"><i class="fas fa-shield-halved" /></span>Change Status
                </button>
                <button type="button" class="menu-row" onClick={() => { onAction('Upload Document', emp.id); setOpenId(null); }}>
                  <span class="menu-ico"><i class="fas fa-upload" /></span>Upload Document
                </button>
                <button type="button" class="menu-row danger" onClick={() => { onAction('Start Offboarding', emp.id); setOpenId(null); }}>
                  <span class="menu-ico"><i class="fas fa-triangle-exclamation" /></span>Start Offboarding
                </button>
              </div>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── pagination ──────────────────────────────────────────────────────────────────

function pageWindow(cur: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  const s = Math.max(2, cur - 1), e = Math.min(total - 1, cur + 1);
  if (s > 2) out.push('…');
  for (let i = s; i <= e; i++) out.push(i);
  if (e < total - 1) out.push('…');
  out.push(total);
  return out;
}

// ── page root ────────────────────────────────────────────────────────────────

export function EmployeeMaster(): VNode {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [openId, setOpenId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState<{ type: string; employeeId: string | null } | null>(null);

  const statsQ = useHrDashboardStats();
  const listQ = useHrEmployees({ limit: 500 });
  const rows = useMemo(() => listQ.data ?? [], [listQ.data]);

  const distinct = (vals: (string | null | undefined)[]) => Array.from(new Set(vals.filter((v): v is string => !!v))).sort();
  const statusOptions = useMemo(() => distinct(rows.map(r => r.status)), [rows]);
  const deptOptions = useMemo(() => distinct(rows.map(r => r.departmentName)), [rows]);
  const typeOptions = useMemo(() => distinct(rows.map(r => r.employment_type ?? r.workerType)), [rows]);
  const trainingOptions = useMemo(() => distinct(rows.map(r => r.trainingStatus)), [rows]);

  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(''), 2600); }
  function nextPhase(label: string) { notify(`${label} — UI ships in the next build phase`); }
  function openAction(label: string, employeeId: string | null) {
    const map: Record<string, string> = { 'Edit Contact': 'contact', 'Request Change': 'change', 'Change Status': 'status', 'Start Offboarding': 'offboard', 'Upload Document': 'document', 'Upload HR Document': 'document' };
    const type = map[label];
    if (type && employeeId) { setModal({ type, employeeId }); setOpenId(null); }
    else nextPhase(label);
  }

  const filtered = useMemo(() => {
    const q = filters.query.trim().toLowerCase();
    return rows.filter(r => {
      const name = rowName(r);
      const qOk = !q || [name, r.email, r.employee_number, r.position, r.departmentName, r.siteName, r.supervisorName]
        .some(v => String(v ?? '').toLowerCase().includes(q));
      const statusOk = !filters.status.length || filters.status.includes(r.status);
      const deptOk = !filters.department.length || (r.departmentName != null && filters.department.includes(r.departmentName));
      const typeOk = !filters.employmentType.length || filters.employmentType.includes(r.employment_type ?? r.workerType);
      const trainOk = !filters.training.length || filters.training.includes(r.trainingStatus);
      return qOk && statusOk && deptOk && typeOk && trainOk;
    });
  }, [rows, filters]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const curPage = Math.min(page, totalPages);
  const start = (curPage - 1) * pageSize;
  const paged = filtered.slice(start, start + pageSize);
  const activeChips = [...filters.status, ...filters.department, ...filters.employmentType,
    ...filters.training.map(t => TRAINING_LABEL[t as TrainingStatus] ?? t)];

  function setFiltersReset(f: Filters) { setFilters(f); setPage(1); }

  return (
    <div class="hr-emp-master" onClick={() => setOpenId(null)}>
      {/* Page header */}
      <div class="page-row">
        <div>
          <h1>Employee Master</h1>
          <div class="subtitle">Manage workforce records, employment status, assignments, and HR actions.</div>
        </div>
        <div class="page-actions">
          <button class="secondary-btn" type="button" onClick={e => { e.stopPropagation(); nextPhase('Settings'); }}>Settings</button>
          <div class="dropdown-wrap">
            <button class="primary-btn" type="button" onClick={e => { e.stopPropagation(); setOpenId(openId === 'new-menu' ? null : 'new-menu'); }}>
              + New Employee <span class="caret">⌄</span>
            </button>
            {openId === 'new-menu' && (
              <div class="dropdown-menu right" onClick={e => e.stopPropagation()}>
                <div class="dropdown-list">
                  <button type="button" class="menu-row" onClick={() => { setModal({ type: 'create', employeeId: null }); setOpenId(null); }}>
                    <span class="menu-ico"><i class="fas fa-user-plus" /></span>Create Employee
                  </button>
                  <button type="button" class="menu-row" onClick={() => { setModal({ type: 'import', employeeId: null }); setOpenId(null); }}>
                    <span class="menu-ico"><i class="fas fa-file-import" /></span>Import Employees
                  </button>
                  <button type="button" class="menu-row" onClick={() => { setModal({ type: 'onboarding', employeeId: null }); setOpenId(null); }}>
                    <span class="menu-ico"><i class="fas fa-list-check" /></span>Start Onboarding
                  </button>
                  <button type="button" class="menu-row" onClick={() => { nextPhase('Create Contractor Worker'); setOpenId(null); }}>
                    <span class="menu-ico"><i class="fas fa-helmet-safety" /></span>Create Contractor Worker
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <KpiGrid stats={statsQ.data} />

      {/* Toolbar */}
      <div class="employee-toolbar compact">
        <div class="table-search">
          <span class="magnify">⌕</span>
          <input value={filters.query} placeholder="Search employee, email, employee no, position, department…"
            onInput={e => setFiltersReset({ ...filters, query: e.currentTarget.value })} />
        </div>
        <MultiDropdown id="status-filter" label="Status" options={statusOptions} selected={filters.status}
          onChange={v => setFiltersReset({ ...filters, status: v })} openId={openId} setOpenId={setOpenId} labelFn={humanize} />
        <AdvancedFilters filters={filters} setFilters={setFiltersReset} openId={openId} setOpenId={setOpenId}
          deptOptions={deptOptions} typeOptions={typeOptions} trainingOptions={trainingOptions} />
        <SavedViewsMenu openId={openId} setOpenId={setOpenId} apply={setFiltersReset}
          statusOptions={statusOptions} typeOptions={typeOptions} />
      </div>

      {/* Active filter chips */}
      <div class="active-filter-bar">
        {activeChips.length ? <strong>Active filters:</strong> : null}
        {activeChips.map(c => <button class="chip-btn" type="button">{humanize(c)} ×</button>)}
        {(filters.query || activeChips.length)
          ? <button class="ghost-btn" type="button" onClick={() => setFiltersReset(EMPTY_FILTERS)}>Clear all</button>
          : null}
      </div>

      {/* Register */}
      <div class="table-card">
        <table>
          <thead><tr>{TABLE_COLS.map(c => <th>{c}</th>)}</tr></thead>
          <tbody>
            {listQ.isLoading
              ? <tr><td colSpan={TABLE_COLS.length}><div class="em-empty">Loading…</div></td></tr>
              : paged.length
                ? paged.map(emp => (
                  <EmployeeRow emp={emp}
                    supervisorName={emp.supervisorName}
                    selected={selectedId === emp.id} openId={openId} setOpenId={setOpenId}
                    onSelect={setSelectedId}
                    onAction={(label, id) => openAction(label, id)} />
                ))
                : <tr><td colSpan={TABLE_COLS.length}><div class="em-empty">No employees match these filters.</div></td></tr>}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div class="pagination">
        <div>{filtered.length
          ? `Showing ${start + 1} to ${Math.min(start + pageSize, filtered.length)} of ${filtered.length} results`
          : 'No results'}</div>
        <div class="pages">
          <button class="page-btn" type="button" disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}>‹</button>
          {pageWindow(curPage, totalPages).map(p => p === '…'
            ? <span>…</span>
            : <button type="button" class={`page-btn ${p === curPage ? 'active' : ''}`} onClick={() => setPage(p)}>{p}</button>)}
          <button class="page-btn" type="button" disabled={curPage >= totalPages} onClick={() => setPage(curPage + 1)}>›</button>
        </div>
        <div class="rows-select">Rows per page:
          <select value={String(pageSize)} onChange={e => { setPageSize(Number(e.currentTarget.value)); setPage(1); }}>
            <option value="25">25</option><option value="50">50</option><option value="100">100</option>
          </select>
        </div>
      </div>

      {/* Profile drawer */}
      <ProfileDrawer employeeId={selectedId} onClose={() => setSelectedId(null)} onAction={(label) => openAction(label, selectedId)} />

      {/* Modals */}
      {modal?.type === 'create'   && <CreateEmployeeWizard onClose={() => setModal(null)} onToast={notify} />}
      {modal?.type === 'import'   && <ImportWizard onClose={() => setModal(null)} onToast={notify} />}
      {modal?.type === 'onboarding' && <OnboardingWizard onClose={() => setModal(null)} onToast={notify} employeeId={modal.employeeId} />}
      {modal?.type === 'contact'  && modal.employeeId && <ContactDialog      employeeId={modal.employeeId} onClose={() => setModal(null)} onToast={notify} />}
      {modal?.type === 'status'   && modal.employeeId && <StatusDialog       employeeId={modal.employeeId} onClose={() => setModal(null)} onToast={notify} />}
      {modal?.type === 'offboard' && modal.employeeId && <OffboardingDialog  employeeId={modal.employeeId} onClose={() => setModal(null)} onToast={notify} />}
      {modal?.type === 'change'   && modal.employeeId && <ChangeRequestDialog employeeId={modal.employeeId} onClose={() => setModal(null)} onToast={notify} />}
      {modal?.type === 'document' && modal.employeeId && <DocumentDialog      employeeId={modal.employeeId} onClose={() => setModal(null)} onToast={notify} />}

      {/* Toast */}
      <div class={`toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  );
}
