import { type ComponentChildren, type VNode } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { useCalendarList, type CalendarItemDTO } from '@api/calendar';
import { useSessionStore } from '@store/session';
import { addDays, endOfMonth, itemDateKey, monthGrid, monthLabel, parseLocalDate, startOfMonth, toLocalDateKey, weekDays } from '@lib/calendar/date';
import { can } from '@lib/permissions';
import { MonthView } from './MonthView';
import { AgendaView } from './AgendaView';
import { TimeGridView } from './TimeGridView';
import { CalendarRail } from './CalendarRail';
import { CalendarItemDialog } from './CalendarItemDialog';
import { CreateCalendarItemDialog } from './CreateCalendarItemDialog';
import {
  EMPTY_FILTERS,
  activeFilterCount,
  calendarSource,
  filterCalendarItems,
  type CalendarFilters,
  type CalendarScope,
  type CalendarViewMode,
} from './calendarViewModel';
import './calendar.css';

const SCOPES: Array<{ key: CalendarScope; label: string }> = [
  { key: 'all', label: 'All events' },
  { key: 'shared', label: 'Shared' },
  { key: 'public', label: 'Public' },
  { key: 'archived', label: 'Archived' },
];

function formatPeriodRange(month: Date): string {
  const start = startOfMonth(month);
  const end = endOfMonth(month);
  const year = start.getFullYear();
  return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${year} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${year}`;
}

function Select({ label, value, onChange, children }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ComponentChildren;
}): VNode {
  return <label>{label}<select value={value} onChange={event => onChange(event.currentTarget.value)}>{children}</select></label>;
}
function FilterPanel({ filters, sources, onChange, onClear, onClose }: {
  filters: CalendarFilters;
  sources: string[];
  onChange: (filters: CalendarFilters) => void;
  onClear: () => void;
  onClose: () => void;
}): VNode {
  const patch = <K extends keyof CalendarFilters>(key: K, value: CalendarFilters[K]): void => onChange({ ...filters, [key]: value });
  return (
    <section class="cal-filter-panel" aria-label="Calendar filters">
      <div class="cal-filter-grid">
        <Select label="Item type" value={filters.type} onChange={value => patch('type', value as CalendarFilters['type'])}>
          <option value="all">All types</option><option value="deadline">Deadlines</option><option value="task">Tasks</option><option value="activity">Activities</option>
        </Select>
        <Select label="Source module" value={filters.source} onChange={value => patch('source', value)}>
          <option value="all">All sources</option>
          {sources.map(source => <option value={source} key={source}>{source === 'calendar' ? 'Calendar' : source.split(/[-_]/g).map(p => `${p.slice(0, 1).toUpperCase()}${p.slice(1)}`).join(' ')}</option>)}
        </Select>
        <Select label="Status" value={filters.status} onChange={value => patch('status', value as CalendarFilters['status'])}>
          <option value="all">All statuses</option><option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="in_review">In review</option><option value="blocked">Blocked</option><option value="done">Done</option><option value="cancelled">Cancelled</option>
        </Select>
        <Select label="Priority" value={filters.priority} onChange={value => patch('priority', value as CalendarFilters['priority'])}>
          <option value="all">All priorities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </Select>
        <Select label="Assignment" value={filters.assignment} onChange={value => patch('assignment', value as CalendarFilters['assignment'])}>
          <option value="all">Anyone</option><option value="me">Assigned to me</option><option value="owned">Owned by me</option>
        </Select>
        <Select label="Visibility" value={filters.visibility} onChange={value => patch('visibility', value as CalendarFilters['visibility'])}>
          <option value="all">All visibility</option><option value="personal">Personal</option><option value="team">Team</option><option value="org">Organisation</option>
        </Select>
      </div>
      <footer><span>Filters apply to Month, Agenda and the selected-day panel.</span><button type="button" onClick={onClear}>Clear</button><button type="button" class="primary" onClick={onClose}>Apply filters</button></footer>
    </section>
  );
}

export function CalendarPage(): VNode {
  const userId = useSessionStore(state => state.userId);
  const canCreate = can('calendar.task.manage_own') || can('calendar.activity.manage_own');
  const [viewMonth, setViewMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [view, setView] = useState<CalendarViewMode>('month');
  const [scope, setScope] = useState<CalendarScope>('all');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<CalendarFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string>(() => toLocalDateKey(new Date()));
  const [selectedItem, setSelectedItem] = useState<CalendarItemDTO | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDate, setCreateDate] = useState(() => toLocalDateKey(new Date()));
  const searchRef = useRef<HTMLInputElement>(null);

  const grid = useMemo(() => monthGrid(viewMonth), [viewMonth]);
  const from = toLocalDateKey(grid[0]!);
  const to = toLocalDateKey(grid[grid.length - 1]!);
  const todayKey = toLocalDateKey(new Date());
  const upcomingTo = toLocalDateKey(addDays(new Date(), 45));
  const listQ = useCalendarList({ from, to });
  const upcomingQ = useCalendarList({ from: todayKey, to: upcomingTo });
  const rawItems = listQ.data ?? [];
  const cold = listQ.isLoading && !listQ.data;

  const visibleItems = useMemo(() => filterCalendarItems(rawItems, { scope, search, filters, userId }), [rawItems, scope, search, filters, userId]);
  const selectedItems = useMemo(() => visibleItems.filter(item => itemDateKey(item) === selectedKey), [visibleItems, selectedKey]);
  const sources = useMemo(() => [...new Set(rawItems.map(calendarSource))].sort(), [rawItems]);
  const selectedDate = useMemo(() => parseLocalDate(selectedKey), [selectedKey]);
  const gridDays = useMemo(() => view === 'week' ? weekDays(selectedDate) : view === 'day' ? [selectedDate] : [], [view, selectedDate]);

  const shiftMonth = (delta: number): void => setViewMonth(month => new Date(month.getFullYear(), month.getMonth() + delta, 1));
  const step = (delta: number): void => {
    if (view === 'month' || view === 'agenda') { shiftMonth(delta); return; }
    const next = addDays(selectedDate, delta * (view === 'week' ? 7 : 1));
    setSelectedKey(toLocalDateKey(next));
    setViewMonth(startOfMonth(next));
  };
  const periodTitle = view === 'day'
    ? selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    : view === 'week'
      ? `${gridDays[0]!.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${gridDays[6]!.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      : monthLabel(viewMonth);
  const periodSub = view === 'day'
    ? String(selectedDate.getFullYear())
    : view === 'week'
      ? `Week of ${gridDays[0]!.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
      : formatPeriodRange(viewMonth);
  const goToday = (): void => {
    const now = new Date();
    setViewMonth(startOfMonth(now));
    setSelectedKey(toLocalDateKey(now));
  };
  const openCreate = (key = selectedKey): void => {
    setCreateDate(key);
    setCreateOpen(true);
  };
  const refresh = (): void => {
    void listQ.refetch();
    void upcomingQ.refetch();
  };

  return (
    <div class="cal-root">
      <header class="cal-page-head">
        <div class="cal-heading">
          <span class="cal-heading-icon"><i class="fas fa-calendar-days" /></span>
          <div>
            <div class="cal-crumbs">Workspace <span>›</span> <strong>Calendar &amp; Tasks</strong></div>
            <h1>Calendar &amp; Tasks</h1>
            <p>One authorised view of deadlines, holidays, closures, tasks and activities across SIOMAC.</p>
          </div>
        </div>
        <div class="cal-page-actions">
          {canCreate && <button type="button" class="primary" onClick={() => openCreate()}><i class="fas fa-plus" /> New</button>}
          <button type="button" onClick={refresh} disabled={listQ.isFetching || upcomingQ.isFetching}><i class={`fas fa-rotate${listQ.isFetching || upcomingQ.isFetching ? ' fa-spin' : ''}`} /> Refresh</button>
        </div>
      </header>

      <div class="cal-scope-row">
        <div class="cal-scope-tabs" role="tablist" aria-label="Calendar scope">
          {SCOPES.map(option => <button type="button" role="tab" aria-selected={scope === option.key} class={scope === option.key ? 'active' : ''} key={option.key} onClick={() => setScope(option.key)}>{option.label}</button>)}
        </div>
        <label class="cal-search"><i class="fas fa-magnifying-glass" /><input ref={searchRef} type="search" value={search} onInput={event => setSearch(event.currentTarget.value)} placeholder="Search calendar" /></label>
        <button type="button" class={`cal-filter-button${filtersOpen ? ' active' : ''}`} onClick={() => setFiltersOpen(open => !open)}><i class="fas fa-sliders" /> Filters <span>{activeFilterCount(filters)}</span></button>
      </div>

      {filtersOpen ? <FilterPanel filters={filters} sources={sources} onChange={setFilters} onClear={() => setFilters(EMPTY_FILTERS)} onClose={() => setFiltersOpen(false)} /> : null}

      <div class="cal-workspace">
        <section class="cal-calendar-card">
          <header class="cal-calendar-toolbar">
            <time class="cal-date-tile" dateTime={selectedKey}><span>{viewMonth.toLocaleDateString('en-US', { month: 'short' })}</span><strong>{parseInt(selectedKey.slice(-2), 10)}</strong></time>
            <div class="cal-period"><strong>{periodTitle}</strong><small>{periodSub}</small></div>
            <span class="grow" />
            <button type="button" class="cal-icon-button" onClick={() => searchRef.current?.focus()} aria-label="Search calendar"><i class="fas fa-magnifying-glass" /></button>
            <div class="cal-period-nav">
              <button type="button" onClick={() => step(-1)} aria-label={`Previous ${view === 'day' ? 'day' : view === 'week' ? 'week' : 'month'}`}><i class="fas fa-arrow-left" /></button>
              <button type="button" onClick={goToday}>Today</button>
              <button type="button" onClick={() => step(1)} aria-label={`Next ${view === 'day' ? 'day' : view === 'week' ? 'week' : 'month'}`}><i class="fas fa-arrow-right" /></button>
            </div>
            <select class="cal-view-select" value={view} onChange={event => setView(event.currentTarget.value as CalendarViewMode)} aria-label="Calendar view">
              <option value="month">Month view</option><option value="week">Week view</option><option value="day">Day view</option><option value="agenda">Agenda view</option>
            </select>
            {canCreate && <button type="button" class="cal-add-button" onClick={() => openCreate()}><i class="fas fa-plus" /> Add event</button>}
          </header>

          {listQ.isError ? <div class="cal-load-error"><div><strong>Calendar could not be loaded</strong><span>{listQ.error instanceof Error ? listQ.error.message : 'The authorised calendar service is unavailable.'}</span></div><button type="button" onClick={() => void listQ.refetch()}>Try again</button></div>
            : view === 'month' ? <MonthView month={viewMonth} items={visibleItems} selectedKey={selectedKey} loading={cold} onSelectDay={setSelectedKey} onOpenItem={setSelectedItem} />
            : view === 'week' || view === 'day' ? <TimeGridView days={gridDays} items={visibleItems} loading={cold} onOpenItem={setSelectedItem} onCreateForDay={openCreate} />
            : <AgendaView items={visibleItems} loading={cold} onOpenItem={setSelectedItem} />}
        </section>

        <CalendarRail selectedKey={selectedKey} todayKey={todayKey} selectedItems={selectedItems} upcomingItems={upcomingQ.data ?? []} allItems={rawItems} loading={cold}
          canCreate={canCreate} onOpenItem={setSelectedItem} onCreateForDay={openCreate} onOpenAgenda={() => setView('agenda')} />
      </div>

      <CalendarItemDialog item={selectedItem} onClose={() => setSelectedItem(null)} />
      {canCreate && <CreateCalendarItemDialog open={createOpen} initialDate={createDate} onClose={() => setCreateOpen(false)} />}
    </div>
  );
}
