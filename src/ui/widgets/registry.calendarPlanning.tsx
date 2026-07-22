import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { useCalendarList, useCreateTask, useTaskStatus, type CalendarItemDTO, type CalendarTaskPriority } from '@api/calendar';
import { can } from '@lib/permissions';
import { showSection } from '@components/nav/navCore';
import { UpcomingDeadlinesCard, type UpcomingDeadlineCardItem } from '@components/shared/UpcomingDeadlinesCard';
import { LucideIcon } from '../LucideIcon';
import { defineWidget } from './defineWidget';
import { findWidgetDataSource, registerWidgetDataSource } from './dataSources';
import type { WidgetDef, WidgetRenderProps, WidgetSizeDef } from './types';
import './calendarPlanningWidgets.css';

const PAGE = 'hr.employees.overview';
const PLANNING_SIZES: WidgetSizeDef[] = [
  { key: 'standard', label: 'Standard', grid: { w: 10, h: 5 }, min: { w: 7, h: 5 }, description: 'Focused weekly view' },
  { key: 'wide', label: 'Wide', grid: { w: 14, h: 5 }, min: { w: 8, h: 5 }, description: 'Expanded weekly view' },
  { key: 'large', label: 'Large', grid: { w: 18, h: 6 }, min: { w: 10, h: 5 }, description: 'Full task workspace' },
];
const DEADLINE_SIZES: WidgetSizeDef[] = [
  { key: 'standard', label: 'Standard', grid: { w: 7, h: 4 }, min: { w: 6, h: 4 }, description: 'Statutory calendar card' },
  { key: 'wide', label: 'Wide', grid: { w: 10, h: 4 }, min: { w: 6, h: 4 }, description: 'Expanded deadline detail' },
  { key: 'large', label: 'Large', grid: { w: 14, h: 5 }, min: { w: 6, h: 4 }, description: 'Large deadline calendar' },
];
const TASK_SIZES: WidgetSizeDef[] = [
  { key: 'standard', label: 'Standard', grid: { w: 8, h: 4 }, min: { w: 6, h: 4 }, description: 'Compact personal planner' },
  { key: 'wide', label: 'Wide', grid: { w: 12, h: 4 }, min: { w: 6, h: 4 }, description: 'Expanded task list' },
  { key: 'large', label: 'Large', grid: { w: 16, h: 5 }, min: { w: 6, h: 4 }, description: 'Full task workspace' },
];
const CALENDAR_SOURCE = {
  sourceKey: 'platform.calendar',
  label: 'Calendar & Tasks API',
  refreshIntervalMs: 60_000,
  permissions: ['calendar.view'],
};
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
function sourceTag(item: CalendarItemDTO): { label: string; tone: UpcomingDeadlineCardItem['tagCls'] } {
  if (item.sourceModule === 'finance') return { label: 'Finance', tone: 'sdb-tag--upcoming' };
  if (item.sourceModule === 'hr') return { label: 'HR', tone: 'sdb-tag--pending' };
  return { label: item.sourceLabel ?? 'Calendar', tone: 'sdb-tag--planned' };
}

function UpcomingDeadlinesView({ items, loading = false, error = null }: { items: CalendarItemDTO[]; loading?: boolean; error?: string | null }): VNode {
  const deadlinesOn = (day: Date): UpcomingDeadlineCardItem[] => items
    .filter(item => itemDateKey(item) === dateKey(day))
    .map(item => {
      const tag = sourceTag(item);
      return {
        id: item.id,
        title: item.title,
        note: item.notes ?? item.sourceLabel ?? 'Calendar deadline',
        tagLabel: tag.label,
        tagCls: tag.tone,
        onOpen: () => item.sourceRoute ? showSection(item.sourceRoute) : showSection('s-calendar'),
      };
    });
  return <UpcomingDeadlinesCard className="cpw-deadlines" deadlinesOn={deadlinesOn} loading={loading} error={error}
    emptyTitle={day => `No Deadlines Due on ${day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
    emptyDescription="Calendar and authorised module deadlines will appear here." />;
}

function UpcomingDeadlinesWidget(_props: WidgetRenderProps): VNode {
  const today = useMemo(() => startOfDay(), []);
  const rangeEnd = useMemo(() => addDays(today, 62), [today]);
  const query = useCalendarList({ from: dateKey(today), to: dateKey(rangeEnd), types: ['deadline'] });
  return <UpcomingDeadlinesView items={query.data ?? []} loading={query.isLoading && !query.data} error={query.isError ? (query.error instanceof Error ? query.error.message : 'The authorised Calendar API is unavailable.') : null} />;
}

const previewDeadlines: CalendarItemDTO[] = [
  { id: 'preview-deadline', type: 'deadline', origin: 'module', title: 'NIS Contribution Remittance', notes: 'Monthly payment to NIBTT', allDay: true, startsOn: dateKey(startOfDay()), endsOn: null, startsAt: null, endsAt: null, status: 'not_started', priority: null, ownerUserId: null, ownerName: null, assigneeUserId: null, assigneeName: null, attendeeCount: 0, visibility: 'org', sourceModule: 'finance', sourceRef: 'preview', sourceRoute: null, sourceLabel: 'NIS', recurrenceSeriesId: null, recurrenceRule: null, occurrenceDate: null, editable: false, completable: false, assignable: false, cancelable: false, drillThrough: false },
];
function UpcomingDeadlinesPreview(): VNode { return <UpcomingDeadlinesView items={previewDeadlines} />; }

function TaskPlannerView({ items, loading = false, loadError = null, live = false }: { items: CalendarItemDTO[]; loading?: boolean; loadError?: string | null; live?: boolean }): VNode {
  const today = useMemo(() => startOfDay(), []);
  const [windowStart, setWindowStart] = useState(today);
  const [selectedDate, setSelectedDate] = useState(today);
  const [composerOpen, setComposerOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<CalendarTaskPriority>('medium');
  const [error, setError] = useState<string | null>(null);
  const createTask = useCreateTask();
  const setStatus = useTaskStatus();
  const days = useMemo(() => weekDays(windowStart), [windowStart]);
  const canCreate = live && can('calendar.task.manage_own');
  const dated = items.filter(item => !!itemDateKey(item));
  const selected = dated.filter(item => itemDateKey(item) === dateKey(selectedDate));
  const visible = selected.length ? selected : dated.filter(item => itemDateKey(item) >= dateKey(selectedDate)).slice(0, 4);
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
  return (
    <article class="cpw-task-planner obv-priority-work-panel obv-priority-task-planner-panel obv-habits-card" data-widget-content-root aria-label="Task planner">
      <div class="obv-habit-top" data-widget-fit-required><div><h2><span>{windowStart.toLocaleDateString('en-US', { month: 'long' })},</span> {windowStart.getFullYear()}</h2><p>Task planner, evidence tracking, and daily next actions</p></div>{canCreate ? <button class="obv-add-task-btn" type="button" aria-label="Add Task" onClick={() => setComposerOpen(true)}><LucideIcon name="Plus" size={13} /><span>Add Task</span></button> : null}</div>
      <div class="obv-habit-days" data-widget-fit-required><button class="obv-health-ghost-btn" type="button" aria-label="Previous dates" onClick={() => shift(-1)}><LucideIcon name="ChevronLeft" size={15} /></button>{days.map(day => <button class={`obv-habit-day${sameDay(day, selectedDate) ? ' active' : ''}${sameDay(day, today) ? ' today' : ''}`} type="button" key={day.toISOString()} onClick={() => setSelectedDate(day)}><span>{day.toLocaleDateString('en-US', { weekday: 'short' })}</span><strong>{day.getDate()}</strong></button>)}<button class="obv-health-ghost-btn" type="button" aria-label="Next dates" onClick={() => shift(1)}><LucideIcon name="ChevronRight" size={15} /></button></div>
      {composerOpen ? <form class="obv-task-composer" onSubmit={event => { event.preventDefault(); void save(); }}><div class="obv-task-composer-head"><strong>Personal task · {selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</strong><button type="button" aria-label="Cancel task" onClick={() => setComposerOpen(false)}><LucideIcon name="X" size={14} /></button></div>{error ? <div class="cpw-task-error" role="alert">{error}</div> : null}<div class="cpw-task-fields"><label class="obv-task-field"><span>Task</span><input autoFocus value={title} maxLength={200} placeholder="Task title" onInput={event => setTitle(event.currentTarget.value)} /></label><label class="obv-task-field"><span>Priority</span><select value={priority} onChange={event => setPriority(event.currentTarget.value as CalendarTaskPriority)}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label></div><div class="obv-task-composer-actions"><button class="obv-task-cancel-btn" type="button" onClick={() => setComposerOpen(false)}>Cancel</button><button class="obv-task-save-btn" type="submit" disabled={!title.trim() || createTask.isPending}>{createTask.isPending ? 'Saving…' : 'Save'}</button></div></form> : null}
      <div class="obv-habit-grid obv-habit-grid-single" data-widget-fit-required><div class="obv-habit-col">{loading ? <div class="obv-habit-empty">Loading your calendar tasks…</div> : loadError ? <div class="obv-habit-empty" role="alert"><LucideIcon name="TriangleAlert" size={28} /><span>Tasks could not be loaded.</span><small>{loadError}</small></div> : visible.length ? visible.map(item => <div class="obv-habit-row" key={item.id}><button class="cpw-task-open" type="button" onClick={() => item.sourceRoute ? showSection(item.sourceRoute) : showSection('s-calendar')} aria-label={`Open ${item.title}`}><span class={`obv-habit-icon accent-${item.priority === 'high' || item.status === 'blocked' ? 'rose' : 'mint'}`}><LucideIcon name={item.type === 'deadline' ? 'CalendarClock' : 'ListChecks'} size={15} /></span><span class="obv-habit-copy"><strong class={item.status === 'done' ? 'struck' : ''}>{item.title}</strong><span>{item.assigneeName ?? item.sourceLabel ?? (item.visibility === 'personal' ? 'Personal task' : 'Calendar task')}</span></span></button>{item.status === 'done' ? <span class="obv-habit-done status-ready"><LucideIcon name="Check" size={12} />Done</span> : item.completable ? <button class="obv-habit-done status-pending" type="button" disabled={setStatus.isPending} onClick={() => void complete(item)}>Complete</button> : <span class="obv-habit-done status-pending">Open</span>}</div>) : <div class="obv-habit-empty"><LucideIcon name="CalendarCheck" size={28} /><span>Nothing scheduled for this date.</span></div>}</div></div>
    </article>
  );
}

function TaskPlannerWidget(_props: WidgetRenderProps): VNode {
  const today = useMemo(() => startOfDay(), []);
  const from = useMemo(() => addDays(today, -7), [today]);
  const to = useMemo(() => addDays(today, 62), [today]);
  const query = useCalendarList({ from: dateKey(from), to: dateKey(to), types: ['task', 'deadline'] });
  return <TaskPlannerView items={query.data ?? []} loading={query.isLoading && !query.data} loadError={query.isError ? (query.error instanceof Error ? query.error.message : 'The authorised Calendar API is unavailable.') : null} live />;
}
function TaskPlannerPreview(): VNode {
  const today = startOfDay();
  const item = (id: string, title: string, offset: number, status: CalendarItemDTO['status']): CalendarItemDTO => ({ id, type: 'task', origin: 'calendar', title, notes: null, allDay: true, startsOn: dateKey(addDays(today, offset)), endsOn: null, startsAt: null, endsAt: null, status, priority: 'medium', ownerUserId: 'preview', ownerName: 'You', assigneeUserId: 'preview', assigneeName: 'You', attendeeCount: 0, visibility: 'personal', sourceModule: null, sourceRef: null, sourceRoute: null, sourceLabel: null, recurrenceSeriesId: null, recurrenceRule: null, occurrenceDate: null, editable: true, completable: status !== 'done', assignable: false, cancelable: true, drillThrough: false });
  return <TaskPlannerView items={[item('one','Review employee records',0,'not_started'),item('two','Confirm onboarding documents',1,'not_started'),item('three','Complete training review',2,'done')]} />;
}

function liveDefinition(input: { id: string; title: string; description: string; icon: string; category: string; defaultSize: WidgetDef['defaultSize']; render: WidgetDef['render']; renderPreview: NonNullable<WidgetDef['renderPreview']>; actions?: Record<string,string>; recommended?: boolean; allowedSizes?: WidgetSizeDef[]; sizeConstraints?: WidgetDef['sizeConstraints']; previewAspect?: number }): WidgetDef {
  return defineWidget({ id: input.id, module: 'enterprise', area: 'Personal Productivity', title: input.title, description: input.description, longDescription: `${input.description} Reads the shared authorised Calendar DTO, where server-computed scope and capabilities remain authoritative.`, icon: input.icon, category: input.category, tags: ['calendar','planning','personal productivity'], previewVariant: input.id.includes('deadlines') ? 'timeline' : 'task-board', chrome: 'none', sizeToContent: false, supportedPages: [PAGE], supportedZones: ['main'], defaultSize: input.defaultSize, allowedSizes: input.allowedSizes ?? PLANNING_SIZES, sizeConstraints: input.sizeConstraints ?? { defaultColumns: input.defaultSize === 'large' ? 18 : 10, defaultRows: input.defaultSize === 'large' ? 6 : 5, minColumns: input.defaultSize === 'large' ? 10 : 7, minRows: 5, minWidth: input.defaultSize === 'large' ? 480 : 350, minHeight: 390, resizeStrategy: 'content-measured' }, previewAspect: input.previewAspect ?? (input.defaultSize === 'large' ? 1.8 : 1.08), defaultConfig: {}, configSchema: [], dataSource: CALENDAR_SOURCE, dataSourceKey: 'platform.calendar', governance: { state: 'enabled', discoverable: true, allowedPages: [PAGE], requiredCapabilities: ['calendar.view'] }, permissions: { requiredPermissions: ['calendar.view'], ...(input.actions ? { actions: input.actions } : {}) }, runtimeState: input.actions ? 'action-gated' : 'live-api', motion: { kind: 'sequence', durationMs: 540, reducedMotion: 'static' }, ...(input.recommended ? { recommendedFor: [PAGE] } : {}), render: input.render, renderPreview: input.renderPreview });
}

export const widgets: WidgetDef[] = [
  liveDefinition({ id: 'enterprise.calendar.upcomingDeadlines', title: 'Upcoming deadlines', description: 'Authorised Statutory, Onboarding, and module deadlines in a weekly calendar.', icon: 'fa-calendar-days', category: 'Calendar & deadlines', defaultSize: 'standard', recommended: true, allowedSizes: DEADLINE_SIZES, sizeConstraints: { defaultColumns: 7, defaultRows: 4, minColumns: 6, minRows: 4, minWidth: 285, minHeight: 380, resizeStrategy: 'content-measured' }, previewAspect: 1.08, render: UpcomingDeadlinesWidget, renderPreview: UpcomingDeadlinesPreview }),
  liveDefinition({ id: 'enterprise.calendar.taskPlanner', title: 'Task planner', description: 'Calendar tasks and authorised module work with personal-task creation.', icon: 'fa-list-check', category: 'Calendar & deadlines', defaultSize: 'standard', allowedSizes: TASK_SIZES, sizeConstraints: { defaultColumns: 8, defaultRows: 4, minColumns: 6, minRows: 4, minWidth: 300, minHeight: 340, resizeStrategy: 'content-measured' }, previewAspect: 1.05, actions: { createPersonalTask: 'calendar.task.manage_own', completeTask: 'calendar.task.manage_own' }, render: TaskPlannerWidget, renderPreview: TaskPlannerPreview }),
];
