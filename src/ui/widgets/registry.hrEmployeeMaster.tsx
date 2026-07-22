import type { VNode } from 'preact';
import type { WidgetDef, WidgetSizeConstraints, WidgetSizeDef } from './types';
import { LucideIcon, type LucideName } from '../LucideIcon';
import { defineWidget } from './defineWidget';
import './employeeMasterWidgets.css';

const PAGE = 'hr.employees.overview';
const SIZES: WidgetSizeDef[] = [
  { key: 'standard', label: 'Standard', grid: { w: 10, h: 4 }, min: { w: 4, h: 3 }, description: 'Compact dashboard card' },
  { key: 'wide', label: 'Wide', grid: { w: 12, h: 4 }, min: { w: 4, h: 3 }, description: 'Full visual detail' },
  { key: 'large', label: 'Large', grid: { w: 16, h: 5 }, min: { w: 6, h: 3 }, description: 'Expanded dashboard card' },
];
const DESIGN_SIZES: WidgetSizeDef[] = [
  { key: 'standard', label: 'Standard', grid: { w: 10, h: 5 }, min: { w: 7, h: 5 }, description: 'Full design detail' },
  { key: 'wide', label: 'Wide', grid: { w: 14, h: 5 }, min: { w: 8, h: 5 }, description: 'Expanded design detail' },
  { key: 'large', label: 'Large', grid: { w: 16, h: 5 }, min: { w: 8, h: 5 }, description: 'Wide dashboard card' },
];
const RISK_SIZES: WidgetSizeDef[] = [
  { key: 'standard', label: 'Standard', grid: { w: 7, h: 3 }, min: { w: 5, h: 3 }, description: 'Compact risk monitor' },
  { key: 'wide', label: 'Wide', grid: { w: 12, h: 4 }, min: { w: 5, h: 3 }, description: 'Expanded trend detail' },
  { key: 'large', label: 'Large', grid: { w: 16, h: 5 }, min: { w: 5, h: 3 }, description: 'Large risk monitor' },
];
const HEALTH_SIZES: WidgetSizeDef[] = [
  { key: 'standard', label: 'Standard', grid: { w: 8, h: 4 }, min: { w: 5, h: 3 }, description: 'Compact record health' },
  { key: 'wide', label: 'Wide', grid: { w: 12, h: 4 }, min: { w: 5, h: 3 }, description: 'Expanded category detail' },
  { key: 'large', label: 'Large', grid: { w: 16, h: 5 }, min: { w: 5, h: 3 }, description: 'Large record health card' },
];
const PREVIEW_SOURCE = {
  sourceKey: 'hr.employee-master.selection-preview',
  label: 'Employee Master approved design preview',
  permissions: ['hr.employees.view'],
};

function Header({ title }: { title: string }): VNode {
  return (
    <header class="em-widget__header" data-widget-fit-required data-widget-fit-group>
      <h3 data-widget-fit-no-overlap data-widget-fit-full-text>{title}</h3>
      <div class="em-widget__controls" data-widget-fit-no-overlap aria-hidden="true"><span class="em-widget__menu"><LucideIcon name="MoreHorizontal" size={18} /></span></div>
    </header>
  );
}

function WeeklyEmployeeActivity(): VNode {
  const bars = [45, 62, 30, 80, 57, 40, 55];
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <article class="em-widget em-widget--weekly" data-widget-content-root aria-label="Weekly employee activity preview">
      <Header title="Weekly employee activity" />
      <div class="em-widget__metric-line" data-widget-fit-required>
        <div class="em-widget__metric"><strong>57</strong><span>updates</span></div>
        <div class="em-widget__gain"><strong>↑18%</strong><span>vs last week</span></div>
      </div>
      <div class="em-weekly-chart" data-widget-fit-required data-widget-min-height="140" aria-label="Employee updates from Monday to Sunday">
        {bars.map((value, index) => (
          <div class="em-weekly-chart__column" key={days[index]}>
            <b>{value}</b>
            <i style={`--em-bar-height:${value}%;--em-bar-delay:${index * 65}ms`} />
            <span>{days[index]}</span>
          </div>
        ))}
      </div>
      <footer class="em-widget__legend" data-widget-fit-required>
        <span><i class="em-dot em-dot--green" />Profile edits</span>
        <span><i class="em-dot em-dot--blue" />Status changes</span>
        <span><i class="em-dot em-dot--purple" />Documents</span>
      </footer>
    </article>
  );
}

function DataChangeTrend(): VNode {
  return (
    <article class="em-widget em-widget--trend" data-widget-content-root aria-label="Data change trend preview">
      <Header title="Data change trend" />
      <div class="em-trend__metric" data-widget-fit-required><strong>68</strong><span>changes</span></div>
      <span class="em-trend__period">Last 7 days</span>
      <div class="em-trend__status" data-widget-fit-required><b>Stable</b><strong>↑ 8%</strong><span>vs baseline</span></div>
      <div class="em-trend__chart" data-widget-fit-required data-widget-min-height="120" aria-label="Stable seven-day upward data change trend">
        <svg viewBox="0 0 420 160" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="em-purple-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8153f4" stop-opacity=".26" /><stop offset="1" stop-color="#8153f4" stop-opacity=".03" /></linearGradient></defs>
          <path class="em-chart-area" d="M8 128 C40 112 55 82 88 80 C120 79 130 110 161 104 C190 99 199 69 225 56 C251 43 266 83 294 71 C321 60 324 26 350 18 C370 12 389 9 412 2 L412 148 L8 148 Z" fill="url(#em-purple-area)" />
          <path class="em-chart-line em-chart-line--purple" pathLength="1" d="M8 128 C40 112 55 82 88 80 C120 79 130 110 161 104 C190 99 199 69 225 56 C251 43 266 83 294 71 C321 60 324 26 350 18 C370 12 389 9 412 2" />
          <g class="em-chart-points em-chart-points--purple"><circle cx="8" cy="128" r="5" /><circle cx="88" cy="80" r="5" /><circle cx="161" cy="104" r="5" /><circle cx="225" cy="56" r="5" /><circle cx="294" cy="71" r="5" /><circle cx="350" cy="18" r="5" /><circle cx="412" cy="2" r="5" /></g>
        </svg>
        <div class="em-chart-days"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>
      </div>
      <footer class="em-trend__summary" data-widget-fit-required>
        <div><span>Personal</span><strong><i class="em-dot em-dot--green" />28</strong></div>
        <div><span>Employment</span><strong><i class="em-dot em-dot--blue" />22</strong></div>
        <div><span>Assignment</span><strong><i class="em-dot em-dot--purple-light" />18</strong></div>
      </footer>
    </article>
  );
}

function LifecycleActivity(): VNode {
  return (
    <article class="em-widget em-widget--lifecycle" data-widget-content-root aria-label="Lifecycle activity preview">
      <Header title="Lifecycle activity" />
      <div class="em-lifecycle__main" data-widget-fit-required>
        <div class="em-lifecycle__metric">
          <strong>185</strong><span>changes today</span>
          <div class="em-progress-ring" aria-label="74 percent reviewed"><div><b>74<small>%</small></b><span>reviewed</span></div></div>
        </div>
        <div class="em-lifecycle__chart" aria-label="Lifecycle changes from Monday to Friday">
          <svg viewBox="0 0 440 180" preserveAspectRatio="none" aria-hidden="true">
            <defs><linearGradient id="em-orange-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8513" stop-opacity=".24" /><stop offset="1" stop-color="#ff8513" stop-opacity=".03" /></linearGradient></defs>
            <path class="em-grid-line" d="M0 28 H440 M0 82 H440 M0 136 H440" />
            <path class="em-chart-area" d="M0 144 C29 128 30 96 58 97 C89 100 91 49 126 47 C158 46 166 90 199 86 C234 82 245 17 284 14 C324 12 338 81 371 91 C403 100 414 124 426 124 L426 150 L0 150 Z" fill="url(#em-orange-area)" />
            <path class="em-chart-line em-chart-line--orange" pathLength="1" d="M0 144 C29 128 30 96 58 97 C89 100 91 49 126 47 C158 46 166 90 199 86 C234 82 245 17 284 14 C324 12 338 81 371 91 C403 100 414 124 426 124" />
            <circle class="em-chart-end" cx="426" cy="124" r="5" />
          </svg>
          <div class="em-chart-days"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span></div>
        </div>
      </div>
      <footer class="em-lifecycle__summary" data-widget-fit-required>
        <div><i aria-hidden="true"><LucideIcon name="UserPlus" size={20} /></i><strong>32</strong><span>New hires</span></div>
        <div><i aria-hidden="true"><LucideIcon name="ArrowLeftRight" size={20} /></i><strong>18</strong><span>Transfers</span></div>
        <div><i aria-hidden="true"><LucideIcon name="UserMinus" size={20} /></i><strong>6</strong><span>Exits</span></div>
        <div><i aria-hidden="true"><LucideIcon name="FileText" size={20} /></i><strong>103</strong><span>Records updated</span></div>
      </footer>
    </article>
  );
}

function WorkloadRing({ value, tone }: { value: number; tone: 'green' | 'orange' }): VNode {
  return <div class={`em-workload-ring em-workload-ring--${tone}`} style={`--em-progress:${value * 3.6}deg`} aria-label={`${value} percent`}><div><strong>{value}<small>%</small></strong></div></div>;
}

function MasterDataWorkload(): VNode {
  return (
    <article class="em-widget em-widget--workload" data-widget-content-root aria-label="Master data workload preview">
      <Header title="Master data workload" />
      <div class="em-workload__rows" data-widget-fit-required>
        <div class="em-workload__row"><WorkloadRing value={72} tone="green" /><div><span>Pending corrections</span><strong>18</strong></div></div>
        <div class="em-workload__row"><WorkloadRing value={35} tone="orange" /><div><span>Pending approvals</span><strong>9</strong></div></div>
      </div>
      <footer class="em-workload__footer" data-widget-fit-required><span><i aria-hidden="true"><LucideIcon name="Clock3" size={18} /></i>Oldest item: 3 days</span><span class="em-workload__link">Open work queue <b aria-hidden="true">›</b></span></footer>
    </article>
  );
}

function BlockedEmployeeActions(): VNode {
  const actions = [
    { title: 'Missing work permit', employee: 'Claudia Pierre · EMP-0008', due: 'Due Jul 24', owner: 'HR Team', initials: 'CP', priority: 'High', tone: 'red' },
    { title: 'Work email setup', employee: 'Amara Diallo · EMP-0010', due: 'Due Jul 25', owner: 'IT Team', initials: 'AD', priority: 'High', tone: 'red' },
    { title: 'Medical clearance', employee: 'Damani Baptiste · EMP-0007', due: 'Due Jul 26', owner: 'HSE Team', initials: 'DB', priority: 'Medium', tone: 'amber' },
  ];
  return (
    <article class="em-widget em-widget--blocked" data-widget-content-root aria-label="Blocked employee actions preview">
      <Header title="Blocked employee actions" />
      <div class="em-blocked__list" data-widget-fit-required>
        {actions.map(action => (
          <div class="em-blocked__item" key={action.title}>
            <span class={`em-blocked__signal is-${action.tone}`} />
            <div class="em-blocked__copy"><strong>{action.title}</strong><span>{action.employee}</span></div>
            <span class={`em-blocked__priority is-${action.tone}`}>{action.priority}</span>
            <span class="em-blocked__due"><LucideIcon name="CalendarDays" size={14} />{action.due}</span>
            <span class={`em-avatar em-avatar--${action.tone}`}>{action.initials}</span>
            <span class="em-blocked__owner">{action.owner}</span>
          </div>
        ))}
      </div>
      <footer class="em-widget__action"><span>View all</span><LucideIcon name="ChevronRight" size={17} /></footer>
    </article>
  );
}

function TeamReadinessGoal(): VNode {
  return (
    <article class="em-widget em-widget--goal" data-widget-content-root aria-label="Team readiness goal preview">
      <Header title="Team readiness goal" />
      <div class="em-goal__body" data-widget-fit-required>
        <span class="em-goal__icon"><LucideIcon name="BookOpenCheck" size={31} /></span>
        <div class="em-goal__copy"><strong>Complete employee records</strong><span>Close readiness gaps this month</span></div>
        <div class="em-goal__ring" aria-label="76 percent complete"><span>76%</span></div>
        <div class="em-goal__people" aria-label="Six team members"><span>AD</span><span>CP</span><span>DB</span><b>+3</b></div>
        <div class="em-goal__meta"><span><LucideIcon name="MessageCircle" size={18} /><b>12</b><small>Comments</small></span><span><LucideIcon name="Link2" size={18} /><b>2</b><small>Workflows</small></span></div>
      </div>
      <footer class="em-widget__action"><span>View all</span><LucideIcon name="ChevronRight" size={17} /></footer>
    </article>
  );
}

function EmployeeQuickContact(): VNode {
  return (
    <article class="em-widget em-widget--contact" data-widget-content-root aria-label="Employee quick contact preview">
      <Header title="Employee quick contact" />
      <div class="em-contact__person" data-widget-fit-required>
        <span class="em-contact__avatar">AD<i /></span>
        <div><strong>Amara Diallo</strong><span>EMP-0010</span><a href="mailto:amara.diallo@siomac.com">amara.diallo@siomac.com</a></div>
      </div>
      <div class="em-contact__facts" data-widget-fit-required>
        <div><i><LucideIcon name="Contact" size={20} /></i><span>Employee No.</span><strong>EMP-0010</strong></div>
        <div><i><LucideIcon name="Building2" size={20} /></i><span>Department</span><strong>Operations</strong></div>
        <div><i><LucideIcon name="MapPin" size={20} /></i><span>Site</span><strong>Head Office</strong></div>
      </div>
      <button class="em-contact__message" type="button"><LucideIcon name="MessageCircle" size={18} />Message Amara Diallo</button>
    </article>
  );
}

function RecordHealth(): VNode {
  const segments = Array.from({ length: 13 }, (_, index) => index < 6 ? 'green' : index < 11 ? 'blue' : 'muted');
  const facts: Array<{ icon: LucideName; label: string; value: string; tone: string }> = [
    { icon: 'ShieldCheck', label: 'Identity', value: '100%', tone: 'green' },
    { icon: 'BriefcaseBusiness', label: 'Employment', value: '96%', tone: 'green' },
    { icon: 'FileText', label: 'Documents', value: '78%', tone: 'blue' },
    { icon: 'LockKeyhole', label: 'Access', value: '58%', tone: 'amber' },
  ];
  return (
    <article class="em-widget em-widget--health" data-widget-content-root aria-label="Employee record health preview">
      <Header title="Employee record health" />
      <div class="em-health__gauge" data-widget-fit-required aria-label="Record health 83 out of 100">
        <div class="sdb-gauge">
          <svg viewBox="0 0 118 78" role="presentation">
            {segments.map((tone, index) => <line key={index} class={`is-${tone}`} x1="59" y1="31" x2="59" y2="20"
              stroke-width="5.6" stroke-linecap="round" transform={`rotate(${-90 + index * 15} 59 62)`} pathLength="1" style={`--em-health-index:${index}`} />)}
          </svg>
        </div>
        <div><strong>83</strong><span>/100</span><b><i />Good</b></div>
      </div>
      <div class="em-health__facts" data-widget-fit-required>
        {facts.map(fact => <div key={fact.label}><i><LucideIcon name={fact.icon} size={20} /></i><span>{fact.label}</span><strong class={`is-${fact.tone}`}>{fact.value}</strong></div>)}
      </div>
    </article>
  );
}

function RecordRiskMonitor(): VNode {
  return (
    <article class="em-widget em-widget--risk" data-widget-content-root aria-label="Record risk monitor preview">
      <Header title="Record risk monitor" />
      <div class="em-risk__gauge" data-widget-fit-required>
        <svg viewBox="0 0 360 158" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <defs><linearGradient id="em-risk-arc" x1="0" x2="1"><stop offset="0" stop-color="#20b75d"/><stop offset=".48" stop-color="#f2c83f"/><stop offset=".75" stop-color="#ff8b24"/><stop offset="1" stop-color="#ee2e24"/></linearGradient></defs>
          <path class="em-risk__arc" pathLength="1" d="M34 132 A146 146 0 0 1 326 132" fill="none" stroke="url(#em-risk-arc)" stroke-width="13" stroke-linecap="round" />
          <g class="em-risk__needle">
            <path d="M180 132 L92 50" fill="none" stroke="#79c885" stroke-width="2" />
            <circle cx="92" cy="50" r="10" fill="#57bd64" stroke="#fff" stroke-width="4" />
            <circle cx="180" cy="132" r="4" fill="#79c885" />
          </g>
        </svg>
        <div><strong>32<small>%</small></strong><span>Elevated risk</span></div>
      </div>
      <div class="em-risk__spark" aria-label="Current record-risk trend"><svg viewBox="0 0 360 54" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="em-risk-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22b45d" stop-opacity=".28"/><stop offset="1" stop-color="#22b45d" stop-opacity="0"/></linearGradient></defs><path class="em-risk__spark-area" d="M0 38 C10 8 23 13 32 35 C42 52 53 17 67 31 C81 46 91 45 103 31 C116 12 130 7 143 22 C155 37 166 12 180 13 C197 15 204 31 217 23 C232 14 240 18 250 10 C266 -3 277 2 285 20 C297 43 308 35 320 30 C333 23 344 31 360 29 L360 54 L0 54 Z" fill="url(#em-risk-fill)"/><path class="em-risk__spark-line" pathLength="1" d="M0 38 C10 8 23 13 32 35 C42 52 53 17 67 31 C81 46 91 45 103 31 C116 12 130 7 143 22 C155 37 166 12 180 13 C197 15 204 31 217 23 C232 14 240 18 250 10 C266 -3 277 2 285 20 C297 43 308 35 320 30 C333 23 344 31 360 29" fill="none" stroke="#18ad53" stroke-width="2"/><circle class="em-risk__spark-dot" cx="360" cy="29" r="5" fill="#fff" stroke="#18ad53" stroke-width="2"/></svg></div>
      <footer class="em-risk__summary" data-widget-fit-required><div><span>Highest risk</span><strong>58%</strong></div><div><span>Average risk</span><strong>35%</strong></div></footer>
    </article>
  );
}

function previewDefinition(input: {
  id: string; title: string; description: string; icon: string; tags: string[];
  category: string; recommended?: boolean; defaultSize: WidgetDef['defaultSize']; previewAspect: number; sizeConstraints: WidgetSizeConstraints;
  previewVariant: WidgetDef['previewVariant']; motion: NonNullable<WidgetDef['motion']>; component: () => VNode; allowedSizes?: WidgetSizeDef[];
}): WidgetDef {
  return defineWidget({
    id: input.id, module: 'hr', area: 'Employee Master', title: input.title, description: input.description,
    longDescription: `${input.description} This approved visual is ready for placement testing; live figures will be connected only through an authenticated Employee Master API.`,
    icon: input.icon, category: input.category, tags: ['hr', 'employee master', ...input.tags], previewVariant: input.previewVariant,
    // These cards fill their grid tile and resize on both axes. The content-measured validator
    // enforces the safe floor; size-to-content would take height ownership away from the user and
    // leave the southeast grip below shorter card content on a coarse board grid.
    chrome: 'none', sizeToContent: false, supportedPages: [PAGE], supportedZones: ['main'], defaultSize: input.defaultSize, allowedSizes: input.allowedSizes ?? SIZES, sizeConstraints: input.sizeConstraints,
    previewAspect: input.previewAspect, defaultConfig: {}, configSchema: [], dataSource: PREVIEW_SOURCE,
    governance: { state: 'preview', discoverable: true, allowedPages: [PAGE], requiredCapabilities: ['hr.employees.view'] },
    permissions: { requiredPermissions: ['hr.employees.view'] }, runtimeState: 'static-preview', motion: input.motion,
    ...(input.recommended ? { recommendedFor: [PAGE] } : {}), render: input.component, renderPreview: input.component,
  });
}

export const widgets: WidgetDef[] = [
  previewDefinition({ id: 'hr.employeeMaster.blockedActions', title: 'Blocked employee actions', description: 'Employee record actions currently blocked or approaching their due dates.', icon: 'fa-circle-exclamation', category: 'Actions & workload', defaultSize: 'standard', previewAspect: 1.08, sizeConstraints: { defaultColumns: 10, defaultRows: 5, minColumns: 7, minRows: 5, minWidth: 350, minHeight: 390, resizeStrategy: 'content-measured' }, tags: ['blocked actions', 'deadlines', 'selection a'], previewVariant: 'task-board', motion: { kind: 'sequence', durationMs: 640, reducedMotion: 'static' }, component: BlockedEmployeeActions, allowedSizes: DESIGN_SIZES }),
  previewDefinition({ id: 'hr.employeeMaster.readinessGoal', title: 'Team readiness goal', description: 'Shared progress toward complete employee records.', icon: 'fa-bullseye', category: 'Health & readiness', defaultSize: 'large', previewAspect: 2.1, sizeConstraints: { defaultColumns: 16, defaultRows: 5, minColumns: 8, minRows: 5, minWidth: 390, minHeight: 330, resizeStrategy: 'content-measured' }, tags: ['team readiness', 'goal', 'selection d'], previewVariant: 'people', motion: { kind: 'progress', durationMs: 760, reducedMotion: 'static' }, component: TeamReadinessGoal, allowedSizes: DESIGN_SIZES }),
  previewDefinition({ id: 'hr.employeeMaster.quickContact', title: 'Employee quick contact', description: 'Selected employee context with a direct messaging action.', icon: 'fa-address-card', category: 'People & contact', defaultSize: 'large', previewAspect: 2.1, sizeConstraints: { defaultColumns: 16, defaultRows: 5, minColumns: 8, minRows: 5, minWidth: 390, minHeight: 330, resizeStrategy: 'content-measured' }, tags: ['employee contact', 'message', 'selection e'], previewVariant: 'people', motion: { kind: 'none', reducedMotion: 'static' }, component: EmployeeQuickContact, allowedSizes: DESIGN_SIZES }),
  previewDefinition({ id: 'hr.employeeMaster.recordHealth', title: 'Employee record health', description: 'Completeness across identity, employment, documents, and access.', icon: 'fa-shield-heart', category: 'Health & readiness', defaultSize: 'standard', previewAspect: 1.08, sizeConstraints: { defaultColumns: 8, defaultRows: 4, minColumns: 5, minRows: 3, minWidth: 250, minHeight: 270, resizeStrategy: 'content-measured' }, tags: ['record health', 'completeness', 'selection f'], previewVariant: 'donut', motion: { kind: 'sequence', durationMs: 780, reducedMotion: 'static' }, component: RecordHealth, allowedSizes: HEALTH_SIZES }),
  previewDefinition({ id: 'hr.employeeMaster.recordRisk', title: 'Record risk monitor', description: 'Employee-record risk level and recent movement.', icon: 'fa-gauge-high', category: 'Health & readiness', defaultSize: 'standard', previewAspect: 1.2, sizeConstraints: { defaultColumns: 7, defaultRows: 3, minColumns: 5, minRows: 3, minWidth: 240, minHeight: 260, resizeStrategy: 'content-measured' }, tags: ['record risk', 'risk monitor', 'selection h'], previewVariant: 'risk', motion: { kind: 'chart-draw', durationMs: 820, reducedMotion: 'static' }, component: RecordRiskMonitor, allowedSizes: RISK_SIZES }),
  previewDefinition({ id: 'hr.employeeMaster.weeklyActivity', title: 'Weekly employee activity', description: 'Employee Master updates across the current week.', icon: 'fa-chart-column', category: 'Activity & trends', defaultSize: 'standard', previewAspect: 1.25, sizeConstraints: { defaultColumns: 10, defaultRows: 4, minColumns: 4, minRows: 4, minWidth: 240, minHeight: 330, resizeStrategy: 'content-measured' }, tags: ['weekly activity', 'bar chart', 'selection l'], previewVariant: 'trend', motion: { kind: 'sequence', durationMs: 760, reducedMotion: 'static' }, component: WeeklyEmployeeActivity }),
  previewDefinition({ id: 'hr.employeeMaster.changeTrend', title: 'Data change trend', description: 'Seven-day trend for Employee Master data changes.', icon: 'fa-chart-line', category: 'Activity & trends', defaultSize: 'standard', previewAspect: 1.25, sizeConstraints: { defaultColumns: 10, defaultRows: 4, minColumns: 6, minRows: 4, minWidth: 280, minHeight: 350, resizeStrategy: 'content-measured' }, tags: ['change trend', 'line chart', 'selection m'], previewVariant: 'trend', motion: { kind: 'chart-draw', durationMs: 820, reducedMotion: 'static' }, component: DataChangeTrend }),
  previewDefinition({ id: 'hr.employeeMaster.lifecycleActivity', title: 'Lifecycle activity', description: 'Daily employee lifecycle changes and review progress.', icon: 'fa-rotate', category: 'Activity & trends', defaultSize: 'large', previewAspect: 2, sizeConstraints: { defaultColumns: 16, defaultRows: 5, minColumns: 6, minRows: 4, minWidth: 280, minHeight: 340, resizeStrategy: 'content-measured' }, tags: ['lifecycle', 'review progress', 'selection n'], previewVariant: 'trend', motion: { kind: 'chart-draw', durationMs: 880, reducedMotion: 'static' }, component: LifecycleActivity }),
  previewDefinition({ id: 'hr.employeeMaster.adminWorkload', title: 'Master data workload', description: 'Pending Employee Master corrections and approvals.', icon: 'fa-list-check', category: 'Work management', defaultSize: 'large', previewAspect: 2, sizeConstraints: { defaultColumns: 16, defaultRows: 5, minColumns: 4, minRows: 4, minWidth: 240, minHeight: 330, resizeStrategy: 'content-measured' }, tags: ['workload', 'corrections', 'approvals', 'selection o'], previewVariant: 'status-stack', motion: { kind: 'progress', durationMs: 720, reducedMotion: 'static' }, component: MasterDataWorkload }),
];
