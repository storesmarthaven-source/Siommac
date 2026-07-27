import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { useCalendarList, useCancelEntry, useCreateTask, useTaskStatus, type CalendarItemDTO, type CalendarTaskPriority } from '@api/calendar';
import { can } from '@lib/permissions';
import { dialog } from '@lib/dialog';
import { showSection } from '@components/nav/navCore';
import { DeadlineCard, type DesignDeadline, type DesignTone, type DeadlineDesign } from './deadlineDesignCard';
import { LucideIcon, type LucideName } from '../LucideIcon';
import { defineWidget } from './defineWidget';
import { findWidgetDataSource, registerWidgetDataSource } from './dataSources';
import type { WidgetDef, WidgetRenderProps, WidgetSizeDef } from './types';
import './calendarPlanningWidgets.css';

const RECOMMENDED_PAGES = ['hr.employees.overview', 'hr.employees.overview.v2', 'hr.employees.overview.v3', 'finance.statutory.v2'];
// These widgets are `supportedPages: ['*']` — placeable on ANY board — so their heights MUST be
// in the canonical unit (18h − 12 px; see CANONICAL_CELL_HEIGHT). They were left in the old
// coarse 88px units, which rendered them ~5× too short on every board that had already moved.
const PLANNING_SIZES: WidgetSizeDef[] = [
  { key: 'standard', label: 'Standard', grid: { w: 10, h: 28 }, min: { w: 7, h: 12 }, description: 'Focused weekly view' },
  { key: 'wide', label: 'Wide', grid: { w: 14, h: 28 }, min: { w: 8, h: 12 }, description: 'Expanded weekly view' },
  { key: 'large', label: 'Large', grid: { w: 18, h: 33 }, min: { w: 10, h: 12 }, description: 'Full task workspace' },
];
// Upcoming deadlines is placed on the Employee Master board, whose units are cellHeight 6
// + a 12px gap (tile = `18h − 12` px). Heights below are in those units. (These `min`
// values are inert while the widget declares sizeConstraints — widgetMinGrid prefers
// constraints outright — but they must stay in the same unit system to remain coherent.)
const DEADLINE_SIZES: WidgetSizeDef[] = [
  // 'standard' is the defaultSize, so this grid IS the placed size. w6 × h24 == 332 × 420px:
  // the smallest height that shows three whole cards with NO scrollbar (measured 183px available
  // against 175px of content). Operator picked h23 (402px); that falls 10px short. See the
  // `overflow: hidden auto` note in deadlineDesigns.css — a horizontal scrollbar used to eat a
  // further 10px of height here, which is what made the third card look cut off.
  { key: 'standard', label: 'Standard', grid: { w: 6, h: 24 }, min: { w: 4, h: 12 }, description: 'Statutory calendar card' },
  { key: 'wide', label: 'Wide', grid: { w: 10, h: 28 }, min: { w: 4, h: 12 }, description: 'Expanded deadline detail' },
  { key: 'large', label: 'Large', grid: { w: 14, h: 39 }, min: { w: 4, h: 12 }, description: 'Large deadline calendar' },
];
const TASK_SIZES: WidgetSizeDef[] = [
  { key: 'standard', label: 'Standard', grid: { w: 7, h: 22 }, min: { w: 6, h: 12 }, description: 'Compact personal planner' },
  { key: 'wide', label: 'Wide', grid: { w: 10, h: 22 }, min: { w: 6, h: 12 }, description: 'Expanded task list' },
  { key: 'large', label: 'Large', grid: { w: 14, h: 28 }, min: { w: 6, h: 12 }, description: 'Full task workspace' },
];
const CALENDAR_SOURCE = {
  sourceKey: 'platform.calendar',
  label: 'Calendar & Tasks API',
  refreshIntervalMs: 60_000,
  permissions: ['calendar.view'],
};
const TASK_THEMES = ['siomac-blue', 'navy', 'indigo', 'violet', 'teal', 'emerald', 'amber', 'coral', 'rose', 'graphite'] as const;
type TaskPlannerTheme = typeof TASK_THEMES[number];
const TASK_THEME_OPTIONS = [
  { value: 'siomac-blue', label: 'SIOMAC Blue' },
  { value: 'navy', label: 'Midnight Navy' },
  { value: 'indigo', label: 'Indigo' },
  { value: 'violet', label: 'Violet' },
  { value: 'teal', label: 'Teal' },
  { value: 'emerald', label: 'Emerald' },
  { value: 'amber', label: 'Amber' },
  { value: 'coral', label: 'Coral' },
  { value: 'rose', label: 'Rose' },
  { value: 'graphite', label: 'Graphite' },
];
function taskTheme(value: unknown): TaskPlannerTheme {
  return typeof value === 'string' && TASK_THEMES.includes(value as TaskPlannerTheme) ? value as TaskPlannerTheme : 'siomac-blue';
}
if (!findWidgetDataSource(CALENDAR_SOURCE.sourceKey)) {
  registerWidgetDataSource({
    key: CALENDAR_SOURCE.sourceKey,
    label: CALENDAR_SOURCE.label,
    endpoint: '/api/calendar/list',
    permission: 'calendar.view',
    scope: 'user',
    refresh: { mode: 'interval', intervalMs: CALENDAR_SOURCE.refreshIntervalMs },
    authenticated: true,
  });
}

function startOfDay(value = new Date()): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}
function addDays(value: Date, count: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + count);
  return next;
}
function dateKey(value: Date): string {
  const y = value.getFullYear();
  const m = `${value.getMonth() + 1}`.padStart(2, '0');
  const d = `${value.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function itemDateKey(item: CalendarItemDTO): string {
  return item.startsOn ?? item.startsAt?.slice(0, 10) ?? '';
}
function sameDay(left: Date, right: Date): boolean {
  return dateKey(left) === dateKey(right);
}
function weekDays(start: Date): Date[] {
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}
function departmentKeyFromLabel(label: string): CalendarItemDTO['sourceDepartment'] {
  const value = label.trim().toLowerCase();
  if (value.includes('finance')) return 'finance';
  if (value.includes('payroll')) return 'payroll';
  if (value.includes('hse') || value.includes('safety')) return 'hse';
  if (value.includes('human') || value === 'hr' || value.includes('people')) return 'human_resource';
  if (value === 'it' || value.includes('information technology') || value.includes('technology')) return 'it';
  if (value.includes('operation')) return 'operations';
  return 'department';
}
const previewDeadlines: CalendarItemDTO[] = [
  { id: 'preview-deadline', type: 'deadline', origin: 'module', title: 'NIS Contribution Remittance', notes: 'Monthly payment to NIBTT', allDay: true, startsOn: dateKey(startOfDay()), endsOn: null, startsAt: null, endsAt: null, status: 'not_started', priority: 'medium', sourcePriority: 'medium', ownerUserId: null, ownerName: null, assigneeUserId: null, assigneeName: null, departmentId: null, departmentName: null, attendeeCount: 0, visibility: 'org', sourceModule: 'finance', sourceRef: 'preview', sourceRoute: null, sourceLabel: 'Finance', sourceDepartment: 'finance', sourceDepartmentLabel: 'Finance', recurrenceSeriesId: null, recurrenceRule: null, occurrenceDate: null, editable: false, completable: false, assignable: false, cancelable: false, drillThrough: false },
  { id: 'preview-deadline-two', type: 'deadline', origin: 'module', title: 'Complete statutory readiness review', notes: 'Validate NIS, BIR, TD1, and payroll handoff fields before payroll activation.', allDay: true, startsOn: dateKey(addDays(startOfDay(), 2)), endsOn: null, startsAt: null, endsAt: null, status: 'in_progress', priority: 'high', sourcePriority: 'high', ownerUserId: null, ownerName: null, assigneeUserId: null, assigneeName: null, departmentId: null, departmentName: null, attendeeCount: 0, visibility: 'org', sourceModule: 'hr', sourceRef: 'preview-two', sourceRoute: null, sourceLabel: 'Payroll', sourceDepartment: 'payroll', sourceDepartmentLabel: 'Payroll', recurrenceSeriesId: null, recurrenceRule: null, occurrenceDate: null, editable: false, completable: false, assignable: false, cancelable: false, drillThrough: false },
  { id: 'preview-deadline-three', type: 'deadline', origin: 'module', title: 'Schedule site induction', notes: 'Book HSE induction and attach attendance evidence.', allDay: true, startsOn: dateKey(addDays(startOfDay(), 5)), endsOn: null, startsAt: null, endsAt: null, status: 'not_started', priority: 'high', sourcePriority: 'critical', ownerUserId: null, ownerName: null, assigneeUserId: 'preview', assigneeName: 'HSE Team', departmentId: null, departmentName: null, attendeeCount: 0, visibility: 'org', sourceModule: 'hr', sourceRef: 'preview-three', sourceRoute: null, sourceLabel: 'HSE', sourceDepartment: 'hse', sourceDepartmentLabel: 'HSE', recurrenceSeriesId: null, recurrenceRule: null, occurrenceDate: null, editable: false, completable: false, assignable: false, cancelable: false, drillThrough: false },
];
// ── Real Calendar DTO → the unified DeadlineCard's row model ──────
function moduleVisual(dept: CalendarItemDTO['sourceDepartment']): { icon: LucideName; tone: DesignTone } {
  switch (dept) {
    case 'human_resource': return { icon: 'Users', tone: 'hr' };
    case 'finance':        return { icon: 'Briefcase', tone: 'finance' };
    case 'payroll':        return { icon: 'Coins', tone: 'payroll' };
    case 'hse':            return { icon: 'ShieldCheck', tone: 'hse' };
    case 'it':             return { icon: 'Cpu', tone: 'it' };
    case 'operations':     return { icon: 'Building2', tone: 'operations' };
    default:               return { icon: 'CalendarDays', tone: 'calendar' };
  }
}
function daysUntil(today: Date, due: Date): number {
  return Math.round((startOfDay(due).getTime() - today.getTime()) / 86_400_000);
}
function designStatus(days: number): { statusLabel: string; statusTone: DesignTone } {
  if (days < 0)   return { statusLabel: days === -1 ? 'Overdue by 1 day' : `Overdue by ${-days} days`, statusTone: 'red' };
  if (days === 0) return { statusLabel: 'Due today', statusTone: 'green' };
  if (days === 1) return { statusLabel: 'Due tomorrow', statusTone: 'green' };
  if (days <= 5)  return { statusLabel: `Due in ${days} days`, statusTone: 'orange' };
  return { statusLabel: `Due in ${days} days`, statusTone: 'blue' };
}
function toDesignDeadline(item: CalendarItemDTO, day: Date, today: Date): DesignDeadline {
  const dept = item.departmentName ? departmentKeyFromLabel(item.departmentName) : item.sourceDepartment;
  const vis = moduleVisual(dept);
  const status = designStatus(daysUntil(today, day));
  // Timed calendar events show their real clock time; all-day deadlines show the
  // end-of-day cutoff (they are due BY 11:59 PM on the due date) — accurate, not invented.
  const timed = !item.allDay && !!item.startsAt;
  const whenLabel = timed
    ? new Date(item.startsAt!).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })
    : '11:59 PM';
  return {
    id: item.id,
    title: item.title,
    sub: item.sourceDepartmentLabel ?? item.sourceLabel ?? item.notes ?? (item.type === 'activity' ? 'Calendar event' : 'Deadline'),
    icon: item.type === 'activity' ? 'CalendarClock' : vis.icon,
    tone: vis.tone,
    statusLabel: status.statusLabel,
    statusTone: status.statusTone,
    whenLabel,
    timed,
    dueDate: day,
    onOpen: () => item.sourceRoute ? showSection(item.sourceRoute) : showSection('s-calendar'),
  };
}
function designDeadlinesOn(items: CalendarItemDTO[], today: Date): (day: Date) => DesignDeadline[] {
  return (day: Date) => items.filter(item => itemDateKey(item) === dateKey(day)).map(item => toDesignDeadline(item, day, today));
}
const DEADLINE_LAYOUT_OPTIONS: { value: DeadlineDesign; label: string; description: string }[] = [
  { value: 'keyDates', label: 'Key upcoming dates', description: 'Deadline rows for the selected day, with a rich “all caught up” summary and the next key dates whenever a day is clear. (Default)' },
  { value: 'list', label: 'Simple list', description: 'A clean list of deadline rows for the selected day, or the whole week on the Upcoming tab.' },
  { value: 'timeline', label: 'Timeline', description: 'The day’s deadlines on a connected vertical timeline, in chronological order.' },
  { value: 'summary', label: 'Summary + list', description: 'Due Today / This Week / Overdue counters above a compact list of deadlines.' },
  { value: 'agenda', label: 'Agenda + guidance', description: 'Deadline rows plus a filing-guidance panel (NIS/PAYE on the 15th, TD4 by 28 Feb).' },
  { value: 'checklist', label: 'Checklist', description: 'Deadlines as a tick-box checklist, flagging anything due today.' },
];
const DEADLINE_DEFAULT_CONFIG: Record<string, unknown> = { design: 'keyDates', showStatus: false };
const DEADLINE_CONFIG_SCHEMA: WidgetDef['configSchema'] = [
  { key: 'design', label: 'Layout', type: 'select', defaultValue: 'keyDates', required: true, options: DEADLINE_LAYOUT_OPTIONS.map(({ value, label, description }) => ({ value, label, description })), helpText: 'Choose how this card presents deadlines. Every layout keeps the Today/Upcoming tabs and week strip.' },
  { key: 'showStatus', label: 'Show urgency status', type: 'boolean', defaultValue: false, helpText: 'Show the "Due in N days" pill on each row. Off by default.' },
];
function deadlineDesign(config: Record<string, unknown> | undefined): DeadlineDesign {
  const value = config?.design;
  return DEADLINE_LAYOUT_OPTIONS.some(option => option.value === value) ? value as DeadlineDesign : 'keyDates';
}
function DeadlineWidget({ config }: WidgetRenderProps): VNode {
  const today = useMemo(() => startOfDay(), []);
  const from = useMemo(() => addDays(today, -14), [today]);
  const to = useMemo(() => addDays(today, 62), [today]);
  const query = useCalendarList({ from: dateKey(from), to: dateKey(to), types: ['deadline', 'activity'] });
  const items = query.data ?? [];
  const overdue = items.filter(item => { const key = itemDateKey(item); return item.type === 'deadline' && !!key && key < dateKey(today); }).length;
  return <DeadlineCard design={deadlineDesign(config)} deadlinesOn={designDeadlinesOn(items, today)} overdueCount={overdue}
    showStatus={config.showStatus === true}
    loading={query.isLoading && !query.data}
    error={query.isError ? (query.error instanceof Error ? query.error.message : 'The authorised Calendar API is unavailable.') : null}
    onViewCalendar={() => showSection('s-calendar')} />;
}
function DeadlinePreview({ config }: { config: Record<string, unknown> }): VNode {
  const today = startOfDay();
  return <DeadlineCard design={deadlineDesign(config)} deadlinesOn={designDeadlinesOn(previewDeadlines, today)} overdueCount={1} />;
}

function TaskPlannerView({ items, loading = false, loadError = null, live = false, theme = 'siomac-blue' }: { items: CalendarItemDTO[]; loading?: boolean; loadError?: string | null; live?: boolean; theme?: TaskPlannerTheme }): VNode {
  const today = useMemo(() => startOfDay(), []);
  const [windowStart, setWindowStart] = useState(today);
  const [selectedDate, setSelectedDate] = useState(today);
  const [activeScope, setActiveScope] = useState<'personal' | 'team'>('personal');
  const [composerOpen, setComposerOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<CalendarTaskPriority>('medium');
  const [error, setError] = useState<string | null>(null);
  const createTask = useCreateTask();
  const setStatus = useTaskStatus();
  const cancelEntry = useCancelEntry();
  const days = useMemo(() => weekDays(windowStart), [windowStart]);
  const canCreate = live && can('calendar.task.manage_own');
  const dated = items.filter(item => item.status !== 'cancelled' && !!itemDateKey(item));
  const selected = dated.filter(item => itemDateKey(item) === dateKey(selectedDate));
  const personal = selected.filter(item => (item.visibility ?? 'personal') === 'personal');
  const team = selected.filter(item => item.visibility === 'team' || item.visibility === 'org');
  const visible = activeScope === 'personal' ? personal : team;
  const selectedDateLabel = selectedDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const shift = (direction: -1 | 1): void => { const next = addDays(windowStart, direction * 7); setWindowStart(next); setSelectedDate(next); };
  const save = async (): Promise<void> => {
    if (!title.trim()) return;
    setError(null);
    try {
      const response = await createTask.mutateAsync({ title: title.trim(), startsOn: dateKey(selectedDate), allDay: true, priority, visibility: 'personal' });
      if (!response.success) { setError(response.message ?? 'Task could not be created.'); return; }
      setTitle(''); setComposerOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Task could not be created.'); }
  };
  const complete = async (item: CalendarItemDTO): Promise<void> => {
    if (!item.completable) return;
    await setStatus.mutateAsync({ id: item.id, status: 'done', ...(item.occurrenceDate ? { scope: 'occurrence', occurrenceDate: item.occurrenceDate } : {}) });
  };
  const remove = async (item: CalendarItemDTO): Promise<void> => {
    if (!item.cancelable) return;
    const confirmed = await dialog.confirm({ title: `Remove “${item.title}”?`, text: 'This removes the task from your active calendar while retaining its audit history.', confirmText: 'Remove Task', danger: true });
    if (!confirmed) return;
    await cancelEntry.mutateAsync({ id: item.id, ...(item.occurrenceDate ? { scope: 'occurrence', occurrenceDate: item.occurrenceDate } : {}) });
  };
  return (
    <article class={`cpw-task-planner theme-${theme} obv-priority-work-panel obv-priority-task-planner-panel obv-habits-card`} data-widget-content-root aria-label="Task planner">
      <div class="sdb-ch-hd cpw-task-card-head" data-widget-fit-required>
        <LucideIcon name="ListChecks" size={18} class="cpw-task__icon" />
        <h2>Task Planner</h2>
        <div class="sdb-ch-tools">
          <button class="sdb-ready-nav" type="button" aria-label="Previous dates" onClick={() => shift(-1)}><LucideIcon name="ChevronLeft" size={14} /></button>
          <button class="sdb-ready-nav" type="button" aria-label="Next dates" onClick={() => shift(1)}><LucideIcon name="ChevronRight" size={14} /></button>
          {canCreate ? <button class="obv-add-task-btn" type="button" aria-label="Add Task" onClick={() => setComposerOpen(true)}><LucideIcon name="Plus" size={13} /><span>Add Task</span></button> : null}
        </div>
      </div>
      <div class="cpw-task-period" data-widget-fit-required>{windowStart.toLocaleDateString('en-US', { month: 'long' })}, {windowStart.getFullYear()}</div>
      <div class="obv-habit-days" data-widget-fit-required>{days.map(day => <button class={`obv-habit-day${sameDay(day, selectedDate) ? ' active' : ''}${sameDay(day, today) ? ' today' : ''}`} type="button" key={day.toISOString()} onClick={() => setSelectedDate(day)}><span>{sameDay(day, today) ? 'Today' : day.toLocaleDateString('en-US', { weekday: 'short' })}</span><strong>{day.getDate()}</strong></button>)}</div>
      <nav class="cpw-task-scope-tabs" aria-label="Task scope" data-widget-fit-required><button type="button" class={activeScope === 'personal' ? 'active' : ''} onClick={() => setActiveScope('personal')}>Personal <span>{personal.length}</span></button><button type="button" class={activeScope === 'team' ? 'active' : ''} onClick={() => setActiveScope('team')}>Team <span>{team.length}</span></button></nav>
      {composerOpen ? <form class="obv-task-composer" onSubmit={event => { event.preventDefault(); void save(); }}><div class="obv-task-composer-head"><strong>Personal task · {selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</strong><button type="button" aria-label="Cancel task" onClick={() => setComposerOpen(false)}><LucideIcon name="X" size={14} /></button></div>{error ? <div class="cpw-task-error" role="alert">{error}</div> : null}<div class="cpw-task-fields"><label class="obv-task-field"><span>Task</span><input autoFocus value={title} maxLength={200} placeholder="Task title" onInput={event => setTitle(event.currentTarget.value)} /></label><label class="obv-task-field"><span>Priority</span><select value={priority} onChange={event => setPriority(event.currentTarget.value as CalendarTaskPriority)}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label></div><div class="obv-task-composer-actions"><button class="obv-task-cancel-btn" type="button" onClick={() => setComposerOpen(false)}>Cancel</button><button class="obv-task-save-btn" type="submit" disabled={!title.trim() || createTask.isPending}>{createTask.isPending ? 'Saving…' : 'Save'}</button></div></form> : null}
      <div class="obv-habit-grid obv-habit-grid-single" data-widget-fit-required><div class="obv-habit-col">{loading ? <div class="obv-habit-empty">Loading your calendar tasks…</div> : loadError ? <div class="obv-habit-empty" role="alert"><LucideIcon name="TriangleAlert" size={28} /><span>Tasks could not be loaded.</span><small>{loadError}</small></div> : visible.length ? visible.map(item => <div class={`obv-habit-row${item.status === 'done' ? ' is-complete' : ''}`} key={item.id}>{item.status === 'done' ? <span class="cpw-task-checkbox is-checked" aria-label={`${item.title} completed`}><LucideIcon name="Check" size={12} /></span> : item.completable ? <button class="cpw-task-checkbox" type="button" aria-label={`Mark ${item.title} complete`} disabled={setStatus.isPending} onClick={() => void complete(item)}><LucideIcon name="Check" size={12} /></button> : <span class="cpw-task-checkbox is-disabled" aria-hidden="true" />}<button class="cpw-task-open" type="button" onClick={() => item.sourceRoute ? showSection(item.sourceRoute) : showSection('s-calendar')} aria-label={`Open ${item.title}`}><span class={`obv-habit-icon accent-${item.priority === 'high' || item.status === 'blocked' ? 'rose' : 'mint'}`}><LucideIcon name={item.type === 'deadline' ? 'CalendarClock' : 'ListChecks'} size={15} /></span><span class="obv-habit-copy"><strong class={item.status === 'done' ? 'struck' : ''}>{item.title}</strong><span>{activeScope === 'team' ? item.assigneeName ?? item.ownerName ?? item.sourceLabel ?? 'Team task' : item.assigneeName ?? item.sourceLabel ?? 'Personal task'}</span></span></button><div class="cpw-task-row-actions"><span class={`cpw-task-state${item.status === 'done' ? ' is-done' : ''}`}>{item.status === 'done' ? 'Done' : 'Open'}</span>{item.cancelable ? <button class="cpw-task-remove" type="button" aria-label={`Remove ${item.title}`} disabled={cancelEntry.isPending} onClick={() => void remove(item)}><LucideIcon name="Trash2" size={13} /></button> : null}</div></div>) : <div class="obv-habit-empty sdb-cal-empty"><LucideIcon name="ListChecks" size={52} strokeWidth={1.5} class="sdb-cal-empty-ic" /><div class="sdb-cal-empty-t">No Tasks Due on {selectedDateLabel}</div><div class="sdb-cal-empty-s">Calendar and authorised module tasks will appear here.</div></div>}</div></div>
    </article>
  );
}

function TaskPlannerWidget(props: WidgetRenderProps): VNode {
  const today = useMemo(() => startOfDay(), []);
  const from = useMemo(() => addDays(today, -7), [today]);
  const to = useMemo(() => addDays(today, 62), [today]);
  const query = useCalendarList({ from: dateKey(from), to: dateKey(to), types: ['task', 'deadline'] });
  return <TaskPlannerView items={query.data ?? []} loading={query.isLoading && !query.data} loadError={query.isError ? (query.error instanceof Error ? query.error.message : 'The authorised Calendar API is unavailable.') : null} theme={taskTheme(props.config.theme)} live />;
}
function TaskPlannerPreview(props: { config: Record<string, unknown> }): VNode {
  const today = startOfDay();
  const item = (id: string, title: string, offset: number, status: CalendarItemDTO['status'], visibility: CalendarItemDTO['visibility'], assigneeName: string): CalendarItemDTO => ({ id, type: 'task', origin: 'calendar', title, notes: null, allDay: true, startsOn: dateKey(addDays(today, offset)), endsOn: null, startsAt: null, endsAt: null, status, priority: 'medium', ownerUserId: 'preview', ownerName: visibility === 'personal' ? 'You' : 'HR Team', assigneeUserId: 'preview', assigneeName, departmentId: null, departmentName: null, attendeeCount: 0, visibility, sourceModule: null, sourceRef: null, sourceRoute: null, sourceLabel: null, sourceDepartment: 'calendar', sourceDepartmentLabel: 'Calendar', recurrenceSeriesId: null, recurrenceRule: null, occurrenceDate: null, editable: true, completable: status !== 'done', assignable: false, cancelable: true, drillThrough: false });
  return <TaskPlannerView items={[item('one','Review employee records',0,'not_started','personal','You'),item('two','Confirm onboarding documents',0,'not_started','team','Amara Diallo'),item('three','Complete training review',0,'done','team','Camille Rampersad')]} theme={taskTheme(props.config.theme)} />;
}

function liveDefinition(input: { id: string; title: string; description: string; icon: string; category: string; defaultSize: WidgetDef['defaultSize']; render: WidgetDef['render']; renderPreview: NonNullable<WidgetDef['renderPreview']>; actions?: Record<string,string>; recommended?: boolean; allowedSizes?: WidgetSizeDef[]; sizeConstraints?: WidgetDef['sizeConstraints']; previewAspect?: number; defaultConfig?: Record<string, unknown>; configSchema?: WidgetDef['configSchema'] }): WidgetDef {
  return defineWidget({ id: input.id, module: 'enterprise', area: 'Personal Productivity', title: input.title, description: input.description, longDescription: `${input.description} Reads the shared authorised Calendar DTO, where server-computed scope and capabilities remain authoritative.`, icon: input.icon, category: input.category, tags: ['calendar','planning','personal productivity'], previewVariant: input.id.includes('deadlines') ? 'timeline' : 'task-board', chrome: 'none', sizeToContent: false, supportedPages: ['*'], supportedZones: ['main'], defaultSize: input.defaultSize, allowedSizes: input.allowedSizes ?? PLANNING_SIZES, sizeConstraints: input.sizeConstraints ?? { defaultColumns: input.defaultSize === 'large' ? 18 : 10, defaultRows: input.defaultSize === 'large' ? 33 : 28, minColumns: input.defaultSize === 'large' ? 10 : 7, minRows: 12, minWidth: input.defaultSize === 'large' ? 480 : 350, minHeight: 390, resizeStrategy: 'content-measured' }, previewAspect: input.previewAspect ?? (input.defaultSize === 'large' ? 1.8 : 1.08), defaultConfig: input.defaultConfig ?? {}, configSchema: input.configSchema ?? [], dataSource: CALENDAR_SOURCE, dataSourceKey: 'platform.calendar', governance: { state: 'enabled', discoverable: true, requiredCapabilities: ['calendar.view'] }, permissions: { requiredPermissions: ['calendar.view'], ...(input.actions ? { actions: input.actions } : {}) }, runtimeState: input.actions ? 'action-gated' : 'live-api', motion: { kind: 'sequence', durationMs: 540, reducedMotion: 'static' }, ...(input.recommended ? { recommendedFor: RECOMMENDED_PAGES } : {}), render: input.render, renderPreview: input.renderPreview });
}

export const widgets: WidgetDef[] = [
  liveDefinition({ id: 'enterprise.calendar.upcomingDeadlines', title: 'Schedule & Deadlines', description: 'Authorised Statutory, Onboarding, and module deadlines with Today/Upcoming tabs, a week strip, and a selectable layout (Key dates, list, timeline, summary, agenda, checklist).', icon: 'fa-calendar-days', category: 'Calendar & deadlines', defaultSize: 'standard', recommended: true, allowedSizes: DEADLINE_SIZES, sizeConstraints: { defaultColumns: 6, defaultRows: 24, minColumns: 4, minRows: 12, minWidth: 332, minHeight: 420, resizeStrategy: 'content-measured' }, previewAspect: 0.92, defaultConfig: DEADLINE_DEFAULT_CONFIG, configSchema: DEADLINE_CONFIG_SCHEMA, render: DeadlineWidget, renderPreview: p => <DeadlinePreview config={p.config} /> }),
  liveDefinition({ id: 'enterprise.calendar.taskPlanner', title: 'Task Planner', description: 'Calendar tasks and authorised module work with personal-task creation.', icon: 'fa-list-check', category: 'Calendar & deadlines', defaultSize: 'standard', allowedSizes: TASK_SIZES, sizeConstraints: { defaultColumns: 7, defaultRows: 22, minColumns: 6, minRows: 12, minWidth: 285, minHeight: 280, resizeStrategy: 'content-measured' }, previewAspect: 1.08, defaultConfig: { theme: 'siomac-blue' }, configSchema: [{ key: 'theme', label: 'Colour Theme', type: 'select', defaultValue: 'siomac-blue', required: true, options: TASK_THEME_OPTIONS, helpText: 'Select the accent palette used by this Task Planner instance.' }], actions: { createPersonalTask: 'calendar.task.manage_own', completeTask: 'calendar.task.manage_own', removeTask: 'calendar.task.manage_own' }, render: TaskPlannerWidget, renderPreview: TaskPlannerPreview }),
];
