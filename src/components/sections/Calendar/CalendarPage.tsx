import { type VNode } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useCalendarCategories, useCalendarCollections, useCalendarDayContext, useCalendarItem, useCalendarList, useCalendarReminders, useCompleteCalendarOAuth, useRespondToCalendarActivity, useUpdateEntry, type CalendarAttendeeResponse, type CalendarCategoryDTO, type CalendarCollectionDTO, type CalendarColorKey, type CalendarItemDTO, type CalendarTitleIconType, type UpdateEntryRequest } from '@api/calendar';
import { useMessageRecipients } from '@api/communications';
import { useWeatherSnapshot } from '@api/weather';
import { getUiPreference, saveUiPreference } from '@api/uiPreferences';
import { Button, DropdownMenu, FormField, LucideIcon, SearchField, SegmentedControl, Select, SwitchArtwork, TextInput, type MenuGroup, type PersonOption } from '@ui';
import { useSessionStore } from '@store/session';
import { toast } from '@store/ui';
import { useDemoMode } from '@lib/demoMode';
import { dialog } from '@lib/dialog';
import { addDays, itemDateKey, itemEndDateKey, itemOccursOnDate, localTimestamp, monthGrid, monthLabel, parseLocalDate, startOfMonth, toLocalDateKey, weekDays } from '@lib/calendar/date';
import { can } from '@lib/permissions';
import { DemoLandingPage } from '@/components/demo/DemoLandingPage';
import { showSection } from '@components/nav/navCore';
import { MonthView } from './MonthView';
import { AgendaView } from './AgendaView';
import { TasksView } from './TasksView';
import { TimeGridView, type CalendarDraftSelection, type CalendarWeekLayout } from './TimeGridView';
import { CalendarItemActionDialog, type CalendarItemAction } from './CalendarItemActionDialog';
import { CalendarSettingsDialog } from './CalendarSettingsDialog';
import { CalendarManagementDialog } from './CalendarManagementDialog';
import { CreateCalendarItemDialog, type CalendarCreateType, type CalendarPreviewCreateDraft } from './CreateCalendarItemDialog';
import { applyCalendarStagingPatch, CALENDAR_STAGING_CALENDARS, calendarStagingDetail, calendarStagingDirectory, calendarStagingHolidays, calendarStagingPeople, calendarStagingReminderOffsets, type CalendarStagedAttendee } from './calendarStaging';
import {
  applyCalendarStagingTemplate,
  createCalendarStagingTemplate,
  defaultCalendarStagingWorkspace,
  loadCalendarStagingDefaults,
  loadCalendarStagingWorkspace,
  saveCalendarStagingDefaults,
  saveCalendarStagingWorkspace,
  type CalendarStagingTemplateScope,
  type CalendarStagingWorkspace,
} from './calendarStagingWorkspace';
import { CalendarDashboardRail } from './CalendarDashboardRail';
import { CalendarItemEditor, type CalendarEditorDraftPreview, type CalendarPreviewEditorDetails } from './CalendarItemEditor';
import { CalendarItemPreview } from './CalendarItemPreview';
import { CalendarCollectionDialog } from './CalendarCollectionDialog';
import {
  CALENDAR_NAVIGATOR_PREFERENCE_KEY,
  CALENDAR_NAVIGATOR_PREFERENCE_VERSION,
  CALENDAR_WEATHER_LOCATIONS,
  type CalendarDefaultDuration,
  type CalendarMonthEventLimit,
  type CalendarSnapMinutes,
  type CalendarNavigatorPreference,
  type CalendarNavigatorSection,
  type CalendarWeatherLocation,
  type CalendarWeekStart,
} from '../../../../types/uiPreferences';
import {
  EMPTY_FILTERS,
  activeFilterCount,
  calendarCategory,
  calendarItemHasAction,
  calendarSource,
  filterCalendarItems,
  type CalendarFilters,
  type CalendarCategory,
  type CalendarScope,
  type CalendarViewMode,
} from './calendarViewModel';
import './calendar.css';

const CALENDAR_ZOOM_KEY = 'siomac.calendar.zoom.v2';
const CALENDAR_ALL_DAY_KEY = 'siomac.calendar.show-all-day.v3';
const CALENDAR_VIEW_KEY = 'siomac.calendar.view.v1';
const CALENDAR_WEEK_LAYOUT_KEY = 'siomac.calendar.week-layout.v3';
const CALENDAR_WEEK_TIMELINE_ZOOM_KEY = 'siomac.calendar.week-timeline-zoom.v3';
const CALENDAR_SCOPE_KEY = 'siomac.calendar.scope.v1';
const CALENDAR_HIDDEN_SOURCES_KEY = 'siomac.calendar.hidden-sources.v1';
const CALENDAR_STAGED_PREVIEW_KEY = 'siomac.calendar.staged-preview.v2';
const CALENDAR_WEEK_START_KEY = 'siomac.calendar.week-start.v1';
const CALENDAR_SNAP_MINUTES_KEY = 'siomac.calendar.snap-minutes.v1';
const CALENDAR_CURRENT_TIME_KEY = 'siomac.calendar.show-current-time.v1';
const CALENDAR_AUTO_FOCUS_KEY = 'siomac.calendar.auto-focus-timeline.v1';
const CALENDAR_WEATHER_LOCATION_META: Record<CalendarWeatherLocation, { label: string; latitude: number; longitude: number }> = {
  'port-of-spain': { label: 'Port of Spain', latitude: 10.67, longitude: -61.52 },
  'san-fernando': { label: 'San Fernando', latitude: 10.28, longitude: -61.47 },
  scarborough: { label: 'Scarborough', latitude: 11.18, longitude: -60.74 },
};

function initialCalendarZoom(): number {
  if (typeof window === 'undefined') return 1.2;
  const stored = Number(window.localStorage.getItem(CALENDAR_ZOOM_KEY));
  return Number.isFinite(stored) && stored >= .75 && stored <= 1.4 ? stored : 1.2;
}

function initialAllDayVisibility(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(CALENDAR_ALL_DAY_KEY) !== 'false';
}

function initialCalendarView(): CalendarViewMode {
  if (typeof window === 'undefined') return 'week';
  const stored = window.localStorage.getItem(CALENDAR_VIEW_KEY);
  return stored === 'day' || stored === 'week' || stored === 'month' ? stored : 'week';
}

function primaryCalendarView(view: CalendarViewMode): CalendarViewMode {
  return view === 'agenda' || view === 'tasks' ? 'week' : view;
}

function initialCalendarWeekLayout(): CalendarWeekLayout {
  if (typeof window === 'undefined') return 'timeline';
  return window.localStorage.getItem(CALENDAR_WEEK_LAYOUT_KEY) === 'columns' ? 'columns' : 'timeline';
}

function initialCalendarWeekTimelineZoom(): number {
  if (typeof window === 'undefined') return 1.6;
  const stored = Number(window.localStorage.getItem(CALENDAR_WEEK_TIMELINE_ZOOM_KEY));
  return Number.isFinite(stored) && stored >= .35 && stored <= 1.6 ? stored : 1.6;
}

function initialCalendarWeekStart(): CalendarWeekStart {
  if (typeof window === 'undefined') return 'sunday';
  return window.localStorage.getItem(CALENDAR_WEEK_START_KEY) === 'monday' ? 'monday' : 'sunday';
}

function initialCalendarSnapMinutes(): CalendarSnapMinutes {
  if (typeof window === 'undefined') return 15;
  const stored = Number(window.localStorage.getItem(CALENDAR_SNAP_MINUTES_KEY));
  return stored === 30 || stored === 60 ? stored : 15;
}

function initialCurrentTimeVisibility(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(CALENDAR_CURRENT_TIME_KEY) !== 'false';
}

function initialAutoFocusTimeline(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(CALENDAR_AUTO_FOCUS_KEY) !== 'false';
}

function initialCalendarScope(): CalendarScope {
  if (typeof window === 'undefined') return 'all';
  const stored = window.localStorage.getItem(CALENDAR_SCOPE_KEY);
  return stored === 'mine' || stored === 'shared' || stored === 'public' || stored === 'archived' ? stored : 'all';
}

function initialHiddenSources(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const stored = JSON.parse(window.localStorage.getItem(CALENDAR_HIDDEN_SOURCES_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(stored) ? stored.filter((source): source is string => typeof source === 'string' && source.length > 0) : []);
  } catch {
    return new Set();
  }
}

function initialStagedPreview(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  // Authenticated Calendar always opens on governed API data. The staged board
  // remains an explicit developer opt-in from the overflow menu.
  return window.localStorage.getItem(CALENDAR_STAGED_PREVIEW_KEY) === 'true';
}

function reminderText(offsets: number[]): string | null {
  const offset = [...offsets].sort((a, b) => a - b)[0];
  if (offset === undefined) return null;
  if (offset === 0) return 'At start';
  if (offset < 60) return `${offset} min before`;
  if (offset < 1440) return `${offset / 60} hr before`;
  return `${offset / 1440} day${offset === 1440 ? '' : 's'} before`;
}

function timeInputValue(iso: string | null | undefined, fallback: string): string {
  if (!iso) return fallback;
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return fallback;
  return `${`${value.getHours()}`.padStart(2, '0')}:${`${value.getMinutes()}`.padStart(2, '0')}`;
}

function endTimeAfter(startTime: string, durationMinutes: CalendarDefaultDuration): string {
  const [hours = 0, minutes = 0] = startTime.split(':').map(Number);
  const endMinutes = Math.min((24 * 60) - 1, (hours * 60) + minutes + durationMinutes);
  return `${`${Math.floor(endMinutes / 60)}`.padStart(2, '0')}:${`${endMinutes % 60}`.padStart(2, '0')}`;
}

function FilterPanel({ filters, sources, scope, query, onChange, onScopeChange, onQueryChange, onClear, onClose }: {
  filters: CalendarFilters;
  sources: string[];
  scope: CalendarScope;
  query: string;
  onChange: (filters: CalendarFilters) => void;
  onScopeChange: (scope: CalendarScope) => void;
  onQueryChange: (query: string) => void;
  onClear: () => void;
  onClose: () => void;
}): VNode {
  const patch = <K extends keyof CalendarFilters>(key: K, value: CalendarFilters[K]): void => onChange({ ...filters, [key]: value });
  return (
    <section class="cal-filter-panel" aria-label="Calendar filters">
      <div class="cal-filter-grid">
        <FormField label="Search this calendar"><TextInput type="search" value={query} onInput={onQueryChange} placeholder="Find a scheduled item" clearable aria-label="Search this calendar" /></FormField>
        <FormField label="Item type"><Select value={filters.type} onChange={value => patch('type', value as CalendarFilters['type'])} options={[{ value: 'all', label: 'All items' }, { value: 'event', label: 'Events' }, { value: 'meeting', label: 'Meetings' }, { value: 'task', label: 'Tasks' }, { value: 'deadline', label: 'Deadlines' }, { value: 'reminder', label: 'Reminders' }]} /></FormField>
        <FormField label="Source module"><Select value={filters.source} onChange={value => patch('source', value)} options={[{ value: 'all', label: 'All sources' }, ...sources.map(source => ({ value: source, label: source === 'calendar' ? 'Calendar' : source.split(/[-_]/g).map(part => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(' ') }))]} searchable={sources.length > 7} /></FormField>
        <FormField label="Status"><Select value={filters.status} onChange={value => patch('status', value as CalendarFilters['status'])} options={[{ value: 'all', label: 'All statuses' }, { value: 'not_started', label: 'Not started' }, { value: 'in_progress', label: 'In progress' }, { value: 'in_review', label: 'In review' }, { value: 'blocked', label: 'Blocked' }, { value: 'done', label: 'Done' }, { value: 'cancelled', label: 'Cancelled' }]} /></FormField>
        <FormField label="Priority"><Select value={filters.priority} onChange={value => patch('priority', value as CalendarFilters['priority'])} options={[{ value: 'all', label: 'All priorities' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }]} /></FormField>
        <FormField label="Assignment"><Select value={filters.assignment} onChange={value => patch('assignment', value as CalendarFilters['assignment'])} options={[{ value: 'all', label: 'Anyone' }, { value: 'me', label: 'Assigned to me' }, { value: 'owned', label: 'Owned by me' }]} /></FormField>
        <FormField label="Visibility"><Select value={filters.visibility} onChange={value => patch('visibility', value as CalendarFilters['visibility'])} options={[{ value: 'all', label: 'All visibility' }, { value: 'personal', label: 'Personal' }, { value: 'team', label: 'Team' }, { value: 'org', label: 'Organisation' }]} /></FormField>
        <FormField label="People & departments"><Select value={scope} onChange={value => onScopeChange(value as CalendarScope)} options={[{ value: 'all', label: 'All scheduled' }, { value: 'mine', label: 'My schedule' }, { value: 'shared', label: 'Shared with me' }, { value: 'public', label: 'Organisation' }, { value: 'archived', label: 'Completed' }]} /></FormField>
      </div>
      <footer><span>Filters apply to every calendar view.</span><Button variant="ghost" size="sm" onClick={onClear}>Clear</Button><Button variant="primary" size="sm" onClick={onClose}>Apply filters</Button></footer>
    </section>
  );
}

export function CalendarPage(): VNode {
  const userId = useSessionStore(state => state.userId);
  const demoMode = useDemoMode();
  const demoPage = demoMode.pages.calendar;
  const [enteredDemo, setEnteredDemo] = useState(false);
  const canCreateTask = demoMode.enabled ? demoPage.useStagedData : can('calendar.task.manage_own');
  const canCreateActivity = demoMode.enabled ? demoPage.useStagedData : can('calendar.activity.manage_own');
  const canCreate = canCreateTask || canCreateActivity;
  const canCreateMeeting = demoMode.enabled ? demoPage.useStagedData : can('meetings.create');
  const [viewMonth, setViewMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [view, setView] = useState<CalendarViewMode>(initialCalendarView);
  const [weekLayout, setWeekLayout] = useState<CalendarWeekLayout>(initialCalendarWeekLayout);
  const [calendarZoom, setCalendarZoom] = useState(initialCalendarZoom);
  const [weekTimelineZoom, setWeekTimelineZoom] = useState(initialCalendarWeekTimelineZoom);
  const [weekStartsOn, setWeekStartsOn] = useState<CalendarWeekStart>(initialCalendarWeekStart);
  const [snapMinutes, setSnapMinutes] = useState<CalendarSnapMinutes>(initialCalendarSnapMinutes);
  const [showAllDay, setShowAllDay] = useState(initialAllDayVisibility);
  const [showCurrentTime, setShowCurrentTime] = useState(initialCurrentTimeVisibility);
  const [autoFocusTimeline, setAutoFocusTimeline] = useState(initialAutoFocusTimeline);
  const [defaultDurationMinutes, setDefaultDurationMinutes] = useState<CalendarDefaultDuration>(60);
  const [showWeekends, setShowWeekends] = useState(true);
  const [dimPastEvents, setDimPastEvents] = useState(false);
  const [showCardLocations, setShowCardLocations] = useState(true);
  const [showCardAttendees, setShowCardAttendees] = useState(true);
  const [showCardIcons, setShowCardIcons] = useState(true);
  const [monthEventLimit, setMonthEventLimit] = useState<CalendarMonthEventLimit>(3);
  const [showWeather, setShowWeather] = useState(true);
  const [showHolidays, setShowHolidays] = useState(false);
  const [weatherLocation, setWeatherLocation] = useState<CalendarWeatherLocation>('port-of-spain');
  const [titleIconType, setTitleIconType] = useState<CalendarTitleIconType>('emoji');
  const [scope, setScope] = useState<CalendarScope>(initialCalendarScope);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<CalendarFilters>(EMPTY_FILTERS);
  const [hiddenSources, setHiddenSources] = useState<Set<string>>(initialHiddenSources);
  const [hiddenCategories, setHiddenCategories] = useState<Set<CalendarCategory>>(new Set());
  const [hiddenCalendarIds, setHiddenCalendarIds] = useState<Set<string>>(new Set());
  const [expandedNavigatorSections, setExpandedNavigatorSections] = useState<CalendarNavigatorSection[]>(['navigator']);
  const [navigatorPreferenceReady, setNavigatorPreferenceReady] = useState(false);
  const navigatorSaveErrorShown = useRef(false);
  const calendarFrameRef = useRef<HTMLElement | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string>(() => toLocalDateKey(new Date()));
  const [selectedItem, setSelectedItem] = useState<CalendarItemDTO | null>(null);
  const [itemAction, setItemAction] = useState<{ item: CalendarItemDTO; action: CalendarItemAction } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDate, setCreateDate] = useState(() => toLocalDateKey(new Date()));
  const [createTime, setCreateTime] = useState('09:00');
  const [createEndTime, setCreateEndTime] = useState<string | undefined>(undefined);
  const [createDraftSelection, setCreateDraftSelection] = useState<CalendarDraftSelection | null>(null);
  const [createLiveDraft, setCreateLiveDraft] = useState<CalendarDraftSelection | null>(null);
  const [createPreviewSessionId, setCreatePreviewSessionId] = useState(0);
  const [createTitle, setCreateTitle] = useState('');
  const [createType, setCreateType] = useState<CalendarCreateType>('event');
  const [createColorKey, setCreateColorKey] = useState<CalendarColorKey>('blue');
  const [createCustomColor, setCreateCustomColor] = useState<string | null>(null);
  const [createCalendarId, setCreateCalendarId] = useState<string | null>(null);
  const [createDuplicateSource, setCreateDuplicateSource] = useState<CalendarItemDTO | null>(null);
  const [editorItem, setEditorItem] = useState<CalendarItemDTO | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorPreviewSessionId, setEditorPreviewSessionId] = useState(0);
  const editorEnterFrame = useRef<number | null>(null);
  const editorExitTimer = useRef<number | null>(null);
  const [editorDraftPreview, setEditorDraftPreview] = useState<CalendarEditorDraftPreview | null>(null);
  const [previewItem, setPreviewItem] = useState<CalendarItemDTO | null>(null);
  const [previewPoint, setPreviewPoint] = useState<{ x: number; y: number } | null>(null);
  const [previewAnchor, setPreviewAnchor] = useState<HTMLElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [calendarManagerOpen, setCalendarManagerOpen] = useState(false);
  const oauthCallbackHandled = useRef(false);
  const completeCalendarOAuth = useCompleteCalendarOAuth();
  const moveEntry = useUpdateEntry({ announceSuccess: false });
  const [collectionDialog, setCollectionDialog] = useState<{ open: boolean; calendar: CalendarCollectionDTO | null }>({ open: false, calendar: null });
  const [returnToCalendarManager, setReturnToCalendarManager] = useState(false);
  const [viewMenuAnchor, setViewMenuAnchor] = useState<HTMLElement | null>(null);
  const [weekLayoutMenuAnchor, setWeekLayoutMenuAnchor] = useState<HTMLElement | null>(null);
  const [createMenuAnchor, setCreateMenuAnchor] = useState<HTMLElement | null>(null);
  const [enteringItemId, setEnteringItemId] = useState<string | null>(null);
  const [initialStagingWorkspace] = useState(loadCalendarStagingWorkspace);
  const [stagedAnchorDate, setStagedAnchorDate] = useState(initialStagingWorkspace.anchorDate);
  const [stagingDefaults, setStagingDefaults] = useState(loadCalendarStagingDefaults);
  const [stagedResponses, setStagedResponses] = useState<Record<string, Exclude<CalendarAttendeeResponse, 'invited'>>>(initialStagingWorkspace.responses);
  const [stagedPreview, setStagedPreview] = useState(initialStagedPreview);
  const [stagedItems, setStagedItems] = useState<CalendarItemDTO[]>(initialStagingWorkspace.items);
  const [stagedPeopleByItem, setStagedPeopleByItem] = useState<Record<string, CalendarStagedAttendee[]>>(initialStagingWorkspace.peopleByItem);
  const [stagedReminderOffsetsByItem, setStagedReminderOffsetsByItem] = useState<Record<string, number[]>>(initialStagingWorkspace.reminderOffsetsByItem);

  const grid = useMemo(() => monthGrid(viewMonth, weekStartsOn), [viewMonth, weekStartsOn]);
  const from = toLocalDateKey(grid[0]!);
  const to = toLocalDateKey(grid[grid.length - 1]!);
  const usingStagedData = (demoMode.enabled && demoPage.useStagedData) || stagedPreview;
  const listQ = useCalendarList({ from, to }, !usingStagedData);
  const collectionsQ = useCalendarCollections(!usingStagedData);
  const categoriesQ = useCalendarCategories(!usingStagedData);
  const stagedAttendeePeople = useMemo(() => Object.fromEntries(stagedItems.map(item => {
    const people = stagedPeopleByItem[item.id] ?? calendarStagingPeople(item);
    return [item.id, people.map(person => ({ id: person.userId, name: person.name, src: person.profileImage }))];
  })), [stagedItems, stagedPeopleByItem]);
  const liveItems = listQ.data ?? [];
  const rawItems = usingStagedData ? stagedItems : liveItems;
  const calendars = usingStagedData ? CALENDAR_STAGING_CALENDARS : collectionsQ.data ?? [];
  const writableCalendars = useMemo(() => calendars.filter(calendar => !calendar.readOnly), [calendars]);
  const cold = !usingStagedData && listQ.isLoading && !listQ.data;

  useEffect(() => {
    if (typeof window === 'undefined' || window.location.pathname !== '/calendar/oauth/callback' || oauthCallbackHandled.current) return;
    oauthCallbackHandled.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const providerError = params.get('error_description') ?? params.get('error');
    showSection('s-calendar');
    setCalendarManagerOpen(true);
    const finish = (): void => window.history.replaceState({}, document.title, `/${window.location.hash}`);
    if (providerError) {
      toast.error(providerError);
      finish();
      return;
    }
    if (!code || !state) {
      toast.error('The calendar provider did not return a complete authorisation.');
      finish();
      return;
    }
    void completeCalendarOAuth.mutateAsync({ code, state }).finally(finish);
  }, []);

  const visibleItems = useMemo(() => filterCalendarItems(rawItems, { scope, search, filters, userId })
    .filter(item => !hiddenSources.has(calendarSource(item)) && !hiddenCategories.has(calendarCategory(item)) && (!item.calendarId || !hiddenCalendarIds.has(item.calendarId))), [rawItems, scope, search, filters, userId, hiddenSources, hiddenCategories, hiddenCalendarIds]);
  const displayedItems = useMemo(() => editorDraftPreview
    ? visibleItems.map(item => item.id === editorDraftPreview.item.id ? editorDraftPreview.item : item)
    : visibleItems, [visibleItems, editorDraftPreview]);
  const displayedAttendeePeople = useMemo(() => {
    const base = usingStagedData ? stagedAttendeePeople : {};
    if (!editorDraftPreview) return usingStagedData ? base : undefined;
    return {
      ...base,
      [editorDraftPreview.item.id]: editorDraftPreview.details.people.map(person => ({ id: person.id, name: person.name, src: person.photoUrl })),
    };
  }, [editorDraftPreview, stagedAttendeePeople, usingStagedData]);
  const miniMonthEventDateKeys = useMemo(() => new Set(grid
    .filter(day => visibleItems.some(item => itemOccursOnDate(item, toLocalDateKey(day))))
    .map(toLocalDateKey)), [grid, visibleItems]);
  const selectedItems = useMemo(() => visibleItems.filter(item => itemOccursOnDate(item, selectedKey)), [visibleItems, selectedKey]);
  const selectedActionItems = useMemo(() => selectedItems.filter(item => calendarItemHasAction(item, userId)), [selectedItems, userId]);
  const sources = useMemo(() => [...new Set(rawItems.map(calendarSource))].sort(), [rawItems]);
  const categories = useMemo<CalendarCategoryDTO[]>(() => {
    if (!usingStagedData) return categoriesQ.data ?? [];
    const byKey = new Map<string, CalendarCategoryDTO>();
    rawItems.forEach((item, index) => {
      if (!item.categoryKey || byKey.has(item.categoryKey)) return;
      byKey.set(item.categoryKey, {
        id: item.categoryId ?? `calendar-demo-category-${item.categoryKey}`,
        key: item.categoryKey,
        name: item.categoryName ?? item.categoryKey,
        iconName: item.categoryIcon ?? 'CalendarDays',
        scope: 'system',
        sortOrder: index,
        active: true,
        canManage: false,
      });
    });
    return [...byKey.values()];
  }, [categoriesQ.data, rawItems, usingStagedData]);
  const toggleSource = (source: string): void => setHiddenSources(current => {
    const next = new Set(current);
    if (next.has(source)) next.delete(source);
    else next.add(source);
    return next;
  });
  const toggleCategory = (category: CalendarCategory): void => setHiddenCategories(current => {
    const next = new Set(current);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    return next;
  });
  const toggleCalendar = (id: string): void => setHiddenCalendarIds(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const selectedDate = useMemo(() => parseLocalDate(selectedKey), [selectedKey]);
  const gridDays = useMemo(() => {
    if (view === 'day') return [selectedDate];
    if (view !== 'week') return [];
    const days = weekDays(selectedDate, weekStartsOn);
    return showWeekends ? days : days.filter(day => day.getDay() !== 0 && day.getDay() !== 6);
  }, [view, selectedDate, weekStartsOn, showWeekends]);
  const gridFrom = gridDays[0] ? toLocalDateKey(gridDays[0]) : null;
  const gridTo = gridDays.length ? toLocalDateKey(gridDays[gridDays.length - 1]!) : null;
  const stagedHolidays = useMemo(() => calendarStagingHolidays(gridDays), [gridDays]);
  const dayContextQ = useCalendarDayContext(showHolidays && !usingStagedData && gridFrom && gridTo ? { from: gridFrom, to: gridTo, jurisdiction: 'TT' } : null);
  const visibleHolidays = usingStagedData ? stagedHolidays : dayContextQ.data ?? [];
  const weatherMeta = CALENDAR_WEATHER_LOCATION_META[weatherLocation];
  const weatherQ = useWeatherSnapshot(showWeather && gridDays.length ? { latitude: weatherMeta.latitude, longitude: weatherMeta.longitude, name: weatherMeta.label } : null);
  const focusedItem = useMemo(() => selectedActionItems.find(item => item.id === selectedItem?.id)
    ?? selectedActionItems.find(item => item.sourceModule === 'meetings')
    ?? selectedActionItems[0]
    ?? null, [selectedItem, selectedActionItems]);
  const focusedIndex = focusedItem ? Math.max(0, selectedActionItems.findIndex(item => item.id === focusedItem.id)) : 0;
  const cycleFocusedItem = (delta: number): void => {
    if (!selectedActionItems.length) return;
    const nextIndex = (focusedIndex + delta + selectedActionItems.length) % selectedActionItems.length;
    setSelectedItem(selectedActionItems[nextIndex] ?? null);
  };
  const focusedNativeId = !usingStagedData && focusedItem?.origin === 'calendar' ? focusedItem.id.split('::')[0] ?? null : null;
  const focusedDetailQ = useCalendarItem(focusedNativeId);
  const focusedRemindersQ = useCalendarReminders(focusedNativeId);
  const focusedDirectoryQ = useMessageRecipients('', { enabled: Boolean(focusedNativeId && focusedItem?.type === 'activity') });
  const focusedRespond = useRespondToCalendarActivity();
  const focusedStagedPeople = usingStagedData && focusedItem ? (stagedPeopleByItem[focusedItem.id] ?? calendarStagingPeople(focusedItem)) : null;
  const focusedStagedBaseDetail = usingStagedData && focusedItem ? calendarStagingDetail(focusedItem) : null;
  const focusedStagedDetail = focusedStagedBaseDetail ? { ...focusedStagedBaseDetail, attendees: focusedStagedPeople ?? [] } : null;
  const peopleById = useMemo(() => new Map((focusedDirectoryQ.data ?? []).map(person => [person.userId, person])), [focusedDirectoryQ.data]);
  const focusedPeople = useMemo(() => focusedStagedPeople
    ? focusedStagedPeople.map(person => ({ id: person.userId, name: person.name, src: person.profileImage }))
    : (focusedDetailQ.data?.attendees ?? []).map(attendee => {
      const person = peopleById.get(attendee.userId);
      return { id: attendee.userId, name: person?.displayName ?? person?.username ?? 'SIOMAC employee', src: person?.profileImage ?? null };
    }), [focusedDetailQ.data?.attendees, focusedStagedPeople, peopleById]);
  const liveResponse = focusedDetailQ.data?.attendees.find(attendee => attendee.userId === userId)?.responseStatus ?? null;
  const stagedResponse = focusedItem ? stagedResponses[focusedItem.id] ?? focusedStagedDetail?.myResponse ?? null : null;
  const focusedResponse = usingStagedData ? stagedResponse : liveResponse;
  const focusedStatuses = focusedStagedDetail?.attendees.map(attendee => attendee.responseStatus) ?? focusedDetailQ.data?.attendees.map(attendee => attendee.responseStatus) ?? [];
  const focusedAcceptedCount = focusedStatuses.filter(status => status === 'accepted').length + (focusedStagedDetail && focusedResponse === 'accepted' ? 1 : 0);
  const focusedAwaitingCount = focusedStatuses.filter(status => status === 'invited').length + (focusedStagedDetail && focusedResponse === 'invited' ? 1 : 0);
  const focusedReminderLabel = reminderText(usingStagedData && focusedItem ? stagedReminderOffsetsByItem[focusedItem.id] ?? calendarStagingReminderOffsets(focusedItem) : focusedRemindersQ.data ?? []);

  useEffect(() => {
    if (selectedItem && !visibleItems.some(item => item.id === selectedItem.id)) setSelectedItem(null);
  }, [selectedItem, visibleItems]);
  useEffect(() => {
    window.localStorage.setItem(CALENDAR_ZOOM_KEY, `${calendarZoom}`);
  }, [calendarZoom]);
  useEffect(() => {
    window.localStorage.setItem(CALENDAR_ALL_DAY_KEY, `${showAllDay}`);
  }, [showAllDay]);
  useEffect(() => {
    window.localStorage.setItem(CALENDAR_VIEW_KEY, view);
  }, [view]);
  useEffect(() => {
    window.localStorage.setItem(CALENDAR_WEEK_LAYOUT_KEY, weekLayout);
  }, [weekLayout]);
  useEffect(() => {
    window.localStorage.setItem(CALENDAR_WEEK_TIMELINE_ZOOM_KEY, `${weekTimelineZoom}`);
  }, [weekTimelineZoom]);
  useEffect(() => {
    window.localStorage.setItem(CALENDAR_WEEK_START_KEY, weekStartsOn);
  }, [weekStartsOn]);
  useEffect(() => {
    window.localStorage.setItem(CALENDAR_SNAP_MINUTES_KEY, `${snapMinutes}`);
  }, [snapMinutes]);
  useEffect(() => {
    window.localStorage.setItem(CALENDAR_CURRENT_TIME_KEY, `${showCurrentTime}`);
  }, [showCurrentTime]);
  useEffect(() => {
    window.localStorage.setItem(CALENDAR_AUTO_FOCUS_KEY, `${autoFocusTimeline}`);
  }, [autoFocusTimeline]);
  useEffect(() => {
    window.localStorage.setItem(CALENDAR_SCOPE_KEY, scope);
  }, [scope]);
  useEffect(() => {
    window.localStorage.setItem(CALENDAR_HIDDEN_SOURCES_KEY, JSON.stringify([...hiddenSources]));
  }, [hiddenSources]);
  useEffect(() => {
    saveCalendarStagingWorkspace({
      version: 1,
      anchorDate: stagedAnchorDate,
      items: stagedItems,
      peopleByItem: stagedPeopleByItem,
      reminderOffsetsByItem: stagedReminderOffsetsByItem,
      responses: stagedResponses,
    });
  }, [stagedAnchorDate, stagedItems, stagedPeopleByItem, stagedReminderOffsetsByItem, stagedResponses]);
  useEffect(() => {
    let active = true;
    if (!userId || demoMode.enabled) {
      setNavigatorPreferenceReady(true);
      return () => { active = false; };
    }
    setNavigatorPreferenceReady(false);
    void getUiPreference(CALENDAR_NAVIGATOR_PREFERENCE_KEY)
      .then(saved => {
        if (!active || !saved) return;
        const preference = saved.value;
        const usePresentationDefaults = saved.version < CALENDAR_NAVIGATOR_PREFERENCE_VERSION;
        setView(primaryCalendarView(preference.view));
        setScope(preference.scope);
        setCalendarZoom(usePresentationDefaults ? 1.2 : preference.zoom);
        setWeekLayout(usePresentationDefaults ? 'timeline' : preference.weekLayout);
        setWeekTimelineZoom(usePresentationDefaults ? 1.6 : preference.weekTimelineZoom);
        setWeekStartsOn(preference.weekStartsOn);
        setSnapMinutes(preference.snapMinutes);
        // v6 restores the redesigned all-day lane as the calendar default. Earlier
        // versions persisted the former hidden-by-default behaviour, so they
        // migrate once; users can still turn the lane off in Calendar Settings.
        setShowAllDay(saved.version >= 6 ? preference.showAllDay : true);
        setShowCurrentTime(preference.showCurrentTime);
        setAutoFocusTimeline(preference.autoFocusTimeline);
        setDefaultDurationMinutes(preference.defaultDurationMinutes);
        setShowWeekends(preference.showWeekends);
        setDimPastEvents(preference.dimPastEvents);
        setShowCardLocations(preference.showCardLocations);
        setShowCardAttendees(preference.showCardAttendees);
        setShowCardIcons(preference.showCardIcons);
        setMonthEventLimit(preference.monthEventLimit);
        setShowWeather(preference.showWeather ?? true);
        // Holiday artwork was introduced in v3. The v4 calendar-visibility field
        // must not reset an explicit v3 holiday choice during migration.
        setShowHolidays(saved.version >= 3 ? preference.showHolidays ?? false : false);
        setWeatherLocation(CALENDAR_WEATHER_LOCATIONS.includes(preference.weatherLocation) ? preference.weatherLocation : 'port-of-spain');
        setTitleIconType(preference.titleIconType ?? 'emoji');
        setHiddenSources(new Set(preference.hiddenSources));
        setHiddenCategories(new Set(preference.hiddenCategories));
        setHiddenCalendarIds(new Set(preference.hiddenCalendarIds ?? []));
        setExpandedNavigatorSections(preference.expandedSections);
      })
      .catch((error: unknown) => {
        if (active) console.error('[calendar] navigator preference load failed:', error);
      })
      .finally(() => { if (active) setNavigatorPreferenceReady(true); });
    return () => { active = false; };
  }, [userId, demoMode.enabled]);
  useEffect(() => {
    if (!navigatorPreferenceReady || !userId || demoMode.enabled) return;
    const preference: CalendarNavigatorPreference = {
      view,
      scope,
      zoom: calendarZoom,
      weekLayout,
      weekTimelineZoom,
      weekStartsOn,
      snapMinutes,
      showAllDay,
      showCurrentTime,
      autoFocusTimeline,
      defaultDurationMinutes,
      showWeekends,
      dimPastEvents,
      showCardLocations,
      showCardAttendees,
      showCardIcons,
      monthEventLimit,
      showWeather,
      showHolidays,
      weatherLocation,
      titleIconType,
      hiddenSources: [...hiddenSources].sort(),
      hiddenCategories: [...hiddenCategories],
      hiddenCalendarIds: [...hiddenCalendarIds].sort(),
      expandedSections: expandedNavigatorSections,
    };
    const timer = window.setTimeout(() => {
      void saveUiPreference(CALENDAR_NAVIGATOR_PREFERENCE_KEY, preference)
        .then(() => { navigatorSaveErrorShown.current = false; })
        .catch((error: unknown) => {
          if (navigatorSaveErrorShown.current) return;
          navigatorSaveErrorShown.current = true;
          console.error('[calendar] navigator preference save failed:', error);
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [navigatorPreferenceReady, userId, demoMode.enabled, view, scope, calendarZoom, weekLayout, weekTimelineZoom, weekStartsOn, snapMinutes, showAllDay, showCurrentTime, autoFocusTimeline, defaultDurationMinutes, showWeekends, dimPastEvents, showCardLocations, showCardAttendees, showCardIcons, monthEventLimit, showWeather, showHolidays, weatherLocation, titleIconType, hiddenSources, hiddenCategories, hiddenCalendarIds, expandedNavigatorSections]);
  useEffect(() => {
    if (import.meta.env.DEV) window.localStorage.setItem(CALENDAR_STAGED_PREVIEW_KEY, `${stagedPreview}`);
  }, [stagedPreview]);
  useEffect(() => () => {
    if (editorEnterFrame.current !== null) window.cancelAnimationFrame(editorEnterFrame.current);
    if (editorExitTimer.current !== null) window.clearTimeout(editorExitTimer.current);
  }, []);
  useEffect(() => {
    if (!enteringItemId) return;
    const isVisible = visibleItems.some(item => item.id === enteringItemId || item.id.startsWith(`${enteringItemId}::`));
    const timer = window.setTimeout(() => {
      setEnteringItemId(current => current === enteringItemId ? null : current);
    }, isVisible ? 1_200 : 10_000);
    return () => window.clearTimeout(timer);
  }, [enteringItemId, visibleItems]);

  const shiftMonth = (delta: number): void => {
    const nextMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + delta, 1);
    const selectedDay = parseLocalDate(selectedKey).getDate();
    const lastDay = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate();
    const nextSelected = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), Math.min(selectedDay, lastDay));
    setViewMonth(nextMonth);
    setSelectedKey(toLocalDateKey(nextSelected));
    setSelectedItem(null);
  };
  const step = (delta: number): void => {
    if (view === 'month' || view === 'agenda' || view === 'tasks') { shiftMonth(delta); return; }
    const next = addDays(selectedDate, delta * (view === 'week' ? 7 : 1));
    setSelectedKey(toLocalDateKey(next));
    setViewMonth(startOfMonth(next));
  };
  const periodTitle = view === 'day'
    ? selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    : view === 'week'
      ? `${gridDays[0]!.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${gridDays[gridDays.length - 1]!.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      : monthLabel(viewMonth);
  const goToday = (): void => {
    const now = new Date();
    setViewMonth(startOfMonth(now));
    setSelectedKey(toLocalDateKey(now));
    setSelectedItem(null);
  };
  const dismissItemEditorImmediately = (): void => {
    if (editorEnterFrame.current !== null) window.cancelAnimationFrame(editorEnterFrame.current);
    if (editorExitTimer.current !== null) window.clearTimeout(editorExitTimer.current);
    editorEnterFrame.current = null;
    editorExitTimer.current = null;
    setEditorOpen(false);
    setEditorItem(null);
    setEditorDraftPreview(null);
  };
  const showItemEditor = (item: CalendarItemDTO): void => {
    setEditorPreviewSessionId(current => current + 1);
    if (editorExitTimer.current !== null) window.clearTimeout(editorExitTimer.current);
    if (editorEnterFrame.current !== null) window.cancelAnimationFrame(editorEnterFrame.current);
    editorExitTimer.current = null;
    setEditorItem(item);
    if (editorOpen) return;
    setEditorOpen(false);
    editorEnterFrame.current = window.requestAnimationFrame(() => {
      editorEnterFrame.current = null;
      setEditorOpen(true);
    });
  };
  const closeItemEditor = (): void => {
    if (editorEnterFrame.current !== null) window.cancelAnimationFrame(editorEnterFrame.current);
    if (editorExitTimer.current !== null) window.clearTimeout(editorExitTimer.current);
    editorEnterFrame.current = null;
    setEditorOpen(false);
    setEditorDraftPreview(null);
    editorExitTimer.current = window.setTimeout(() => {
      editorExitTimer.current = null;
      setEditorItem(null);
    }, 230);
  };
  const openCreate = (key = selectedKey, startTime = '09:00', type: CalendarCreateType = 'event', _point?: { x: number; y: number }, endTime?: string): void => {
    const defaultCalendar = writableCalendars.find(calendar => calendar.isDefault) ?? writableCalendars[0] ?? null;
    setCreateDate(key);
    setCreateTime(startTime);
    setCreateEndTime(endTime ?? (type === 'event' || type === 'meeting' ? endTimeAfter(startTime, defaultDurationMinutes) : undefined));
    setCreateDraftSelection(endTime ? { key, startTime, endTime } : null);
    setCreateLiveDraft(null);
    setCreatePreviewSessionId(current => current + 1);
    setCreateTitle('');
    setCreateType(type);
    setCreateColorKey(defaultCalendar?.colorKey ?? 'blue');
    setCreateCustomColor(defaultCalendar?.customColor ?? null);
    setCreateCalendarId(defaultCalendar?.id ?? null);
    setCreateDuplicateSource(null);
    setPreviewItem(null);
    dismissItemEditorImmediately();
    setCreateMenuAnchor(null);
    setCreateOpen(true);
  };
  const openDuplicate = (item: CalendarItemDTO): void => {
    const key = itemDateKey(item) ?? selectedKey;
    const endKey = itemEndDateKey(item) ?? key;
    const kind: CalendarCreateType = item.kind === 'meeting' || item.kind === 'task' || item.kind === 'reminder' ? item.kind : 'event';
    setCreateDate(key);
    setCreateTime(timeInputValue(item.startsAt, '09:00'));
    setCreateEndTime(timeInputValue(item.endsAt, '10:00'));
    setCreateDraftSelection(null);
    setCreateLiveDraft(null);
    setCreatePreviewSessionId(current => current + 1);
    setCreateTitle(`${item.title} copy`);
    setCreateType(kind);
    setCreateColorKey(item.colorKey ?? 'blue');
    setCreateCustomColor(item.customColor);
    setCreateCalendarId(item.calendarId ?? null);
    setCreateDuplicateSource({ ...item, startsOn: item.allDay ? key : item.startsOn, endsOn: item.allDay ? endKey : item.endsOn });
    setPreviewItem(null);
    setPreviewPoint(null);
    dismissItemEditorImmediately();
    setCreateMenuAnchor(null);
    setCreateOpen(true);
  };
  const openCalendarManager = (): void => {
    setCalendarManagerOpen(true);
  };
  const openCollectionFromManager = (calendar: CalendarCollectionDTO | null): void => {
    setCalendarManagerOpen(false);
    setReturnToCalendarManager(true);
    setCollectionDialog({ open: true, calendar });
  };
  const closeCollectionDialog = (): void => {
    setCollectionDialog({ open: false, calendar: null });
    if (!returnToCalendarManager) return;
    setReturnToCalendarManager(false);
    setCalendarManagerOpen(true);
  };
  const chooseDate = (key: string): void => {
    setSelectedKey(key);
    setViewMonth(startOfMonth(parseLocalDate(key)));
    setSelectedItem(null);
  };
  const refresh = (): void => {
    if (demoMode.enabled) return;
    void listQ.refetch();
  };
  const selectCalendarItem = (item: CalendarItemDTO, point?: { x: number; y: number }): void => {
    const key = itemDateKey(item);
    if (key) {
      setSelectedKey(key);
      setViewMonth(startOfMonth(parseLocalDate(key)));
    }
    setSelectedItem(item);
    dismissItemEditorImmediately();
    setCreateOpen(false);
    setCreateDraftSelection(null);
    setPreviewPoint(point ?? { x: Math.max(24, window.innerWidth / 2 - 170), y: Math.min(window.innerHeight - 260, 180) });
    setPreviewItem(item);
  };
  const respondToFocusedItem = (responseStatus: Exclude<CalendarAttendeeResponse, 'invited'>): void => {
    if (!focusedItem) return;
    if (usingStagedData) {
      setStagedResponses(current => ({ ...current, [focusedItem.id]: responseStatus }));
      return;
    }
    if (focusedNativeId) void focusedRespond.mutateAsync({ id: focusedNativeId, responseStatus });
  };
  const openFocusedItem = (): void => {
    if (!focusedItem) return;
    if (focusedItem.sourceRoute && (focusedItem.sourceModule === 'meetings' || focusedItem.origin !== 'calendar')) {
      showSection(focusedItem.sourceRoute);
      return;
    }
    if (!focusedItem.editable) return;
    setEditorDraftPreview(null);
    setSelectedItem(focusedItem);
    showItemEditor(focusedItem);
    setPreviewItem(null);
    setCreateOpen(false);
    setCreateDraftSelection(null);
  };
  const openItemEditor = (item: CalendarItemDTO, _origin?: HTMLElement | { x: number; y: number }): void => {
    setEditorDraftPreview(null);
    setSelectedItem(item);
    showItemEditor(item);
    setPreviewItem(null);
    setCreateOpen(false);
    setCreateDraftSelection(null);
  };
  const markCalendarEntryCreated = (id: string): void => {
    setCreateDraftSelection(null);
    setCreateLiveDraft(null);
    setEnteringItemId(id);
    void listQ.refetch();
  };
  const finishCalendarEntryAnimation = (id: string): void => {
    const nativeId = id.split('::')[0] ?? id;
    setEnteringItemId(current => current === nativeId ? null : current);
  };
  const saveStagedItem = (item: CalendarItemDTO, patch: UpdateEntryRequest['patch'], details?: CalendarPreviewEditorDetails): void => {
    const people = details?.people;
    const patchedItem = applyCalendarStagingPatch(item, patch);
    const calendar = calendars.find(value => value.id === patchedItem.calendarId);
    const category = categories.find(value => value.id === patchedItem.categoryId);
    const updatedItem: CalendarItemDTO = {
      ...patchedItem,
      ...(calendar ? { calendarName: calendar.name } : {}),
      ...(category ? {
        categoryKey: category.key,
        categoryName: category.name,
        categoryIcon: category.iconName,
      } : {}),
      ...(people && item.type === 'activity' ? { attendeeCount: people.length } : {}),
      ...(people && item.type === 'task' ? { assigneeName: people[0]?.name ?? null } : {}),
    };
    setStagedItems(current => current.map(candidate => candidate.id === item.id ? updatedItem : candidate));
    setSelectedItem(current => current?.id === item.id ? updatedItem : current);
    setPreviewItem(current => current?.id === item.id ? updatedItem : current);
    if (people) {
      setStagedPeopleByItem(current => {
        const previous = current[item.id] ?? calendarStagingPeople(item);
        return {
          ...current,
          [item.id]: people.map(person => ({
            userId: person.id,
            name: person.name,
            role: person.jobTitle ?? person.department ?? 'Employee',
            profileImage: person.photoUrl ?? null,
            responseStatus: previous.find(value => value.userId === person.id)?.responseStatus ?? 'invited',
          })),
        };
      });
    }
    if (details) {
      setStagedReminderOffsetsByItem(current => ({ ...current, [item.id]: [...details.reminderOffsets] }));
    }
  };
  const createStagedItem = (draft: CalendarPreviewCreateDraft): string => {
    const id = `calendar-preview-${crypto.randomUUID()}`;
    const calendar = writableCalendars.find(value => value.id === draft.calendarId) ?? null;
    const category = categories.find(value => value.id === draft.categoryId) ?? null;
    const taskFamily = draft.kind === 'task';
    const item: CalendarItemDTO = {
      id,
      type: taskFamily ? 'task' : 'activity',
      kind: draft.kind,
      origin: 'calendar',
      title: draft.title,
      titleIconType: draft.titleIconType,
      titleIconValue: draft.titleIconValue,
      notes: draft.notes,
      colorKey: draft.colorKey,
      customColor: draft.customColor,
      locationLabel: draft.locationLabel,
      categoryId: draft.categoryId,
      categoryKey: category?.key ?? 'general',
      categoryName: category?.name ?? 'General',
      categoryIcon: category?.iconName ?? 'CalendarDays',
      availability: taskFamily ? null : draft.availability,
      calendarId: draft.calendarId,
      calendarName: calendar?.name ?? 'My Calendar',
      allDay: draft.allDay,
      startsOn: draft.startsOn,
      endsOn: draft.endsOn,
      startsAt: draft.startsAt,
      endsAt: draft.endsAt,
      deadlineAt: draft.deadlineAt,
      status: taskFamily ? 'not_started' : null,
      priority: taskFamily ? draft.priority : null,
      ownerUserId: userId,
      ownerName: 'You',
      assigneeUserId: taskFamily ? draft.assigneeUserId : null,
      assigneeName: taskFamily ? draft.assignee?.name ?? null : null,
      departmentId: draft.departmentId,
      departmentName: null,
      attendeeCount: taskFamily ? 0 : draft.attendeeUserIds.length,
      visibility: draft.visibility,
      sourceModule: null,
      sourceRef: null,
      sourceRoute: null,
      sourceLabel: draft.kind === 'meeting' ? 'Meeting' : draft.kind === 'reminder' ? 'Reminder' : draft.kind === 'task' ? 'Task' : 'Event',
      sourceDepartment: 'calendar',
      sourceDepartmentLabel: 'Calendar',
      recurrenceSeriesId: null,
      recurrenceRule: draft.recurrenceRule,
      occurrenceDate: null,
      editable: true,
      completable: taskFamily,
      assignable: taskFamily,
      cancelable: true,
      drillThrough: false,
    };
    const people = taskFamily ? (draft.assignee ? [draft.assignee] : []) : draft.attendeePeople;
    setStagedItems(current => [...current, item]);
    setStagedPeopleByItem(current => ({
      ...current,
      [id]: people.map(person => ({ userId: person.id, name: person.name, role: person.jobTitle ?? person.department ?? (taskFamily ? 'Assignee' : 'Invitee'), profileImage: person.photoUrl ?? null, responseStatus: 'invited' })),
    }));
    setStagedReminderOffsetsByItem(current => ({ ...current, [id]: draft.reminderOffsets }));
    return id;
  };
  const moveCalendarItem = async (item: CalendarItemDTO, key: string, startTime: string, durationMinutes: number): Promise<void> => {
    const startsAt = localTimestamp(key, startTime);
    const endsAt = new Date(new Date(startsAt).getTime() + durationMinutes * 60_000).toISOString();
    const patch: UpdateEntryRequest['patch'] = { allDay: false, startsOn: null, endsOn: null, startsAt, endsAt };
    if (usingStagedData) {
      saveStagedItem(item, patch);
      return;
    }
    const nativeId = item.id.split('::')[0] ?? item.id;
    const recurrence = Boolean(item.recurrenceSeriesId || item.recurrenceRule || item.occurrenceDate);
    try {
      await moveEntry.mutateAsync({
        id: nativeId,
        ...(recurrence ? item.occurrenceDate ? { scope: 'occurrence', occurrenceDate: item.occurrenceDate } : { scope: 'series' } : {}),
        patch,
      });
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : 'The calendar item could not be moved.');
    }
  };
  const deleteStagedItem = (item: CalendarItemDTO): void => {
    setStagedItems(current => current.filter(candidate => candidate.id !== item.id));
    setStagedPeopleByItem(current => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    setSelectedItem(current => current?.id === item.id ? null : current);
    setPreviewItem(current => current?.id === item.id ? null : current);
    setPreviewPoint(null);
    toast.success('Calendar item removed from the staged preview.');
  };
  const stagingWorkspaceSnapshot = (): CalendarStagingWorkspace => ({
    version: 1,
    anchorDate: stagedAnchorDate,
    items: stagedItems,
    peopleByItem: stagedPeopleByItem,
    reminderOffsetsByItem: stagedReminderOffsetsByItem,
    responses: stagedResponses,
  });
  const replaceStagingWorkspace = (workspace: CalendarStagingWorkspace): void => {
    setStagedAnchorDate(workspace.anchorDate);
    setStagedItems(workspace.items);
    setStagedPeopleByItem(workspace.peopleByItem);
    setStagedReminderOffsetsByItem(workspace.reminderOffsetsByItem);
    setStagedResponses(workspace.responses);
    setSelectedItem(null);
    setPreviewItem(null);
    setPreviewPoint(null);
    setEditorItem(null);
    setEditorOpen(false);
    setEditorDraftPreview(null);
  };
  const saveStagingDefault = async (scope: CalendarStagingTemplateScope): Promise<void> => {
    const label = scope === 'day' ? 'Day' : 'Week';
    if (stagingDefaults[scope]) {
      const confirmed = await dialog.confirm({
        title: `Replace ${label} staging default?`,
        text: `The saved ${label.toLocaleLowerCase()} layout will be replaced with the cards currently shown, including their times, colours, people and reminders.`,
        confirmText: 'Replace default',
        panelClass: 'cal-delete-confirm',
      });
      if (!confirmed) return;
    }
    const template = createCalendarStagingTemplate(stagingWorkspaceSnapshot(), scope, selectedDate);
    const nextDefaults = { ...stagingDefaults, version: 1 as const, [scope]: template };
    saveCalendarStagingDefaults(nextDefaults);
    setStagingDefaults(nextDefaults);
    toast.success(`${label} staging default saved.`);
  };
  const applyStagingDefault = async (scope: CalendarStagingTemplateScope): Promise<void> => {
    const template = stagingDefaults[scope];
    if (!template) return;
    const label = scope === 'day' ? 'Day' : 'Week';
    const confirmed = await dialog.confirm({
      title: `Apply ${label} staging default?`,
        text:
          scope === 'day'
            ? 'The selected day will be replaced with your saved staging layout. Other days in this staged week will keep their layouts.'
            : 'The complete selected week will be replaced with your saved staging layout.',
      confirmText: 'Apply default',
      panelClass: 'cal-delete-confirm',
    });
    if (!confirmed) return;
    replaceStagingWorkspace(applyCalendarStagingTemplate(stagingWorkspaceSnapshot(), template, selectedDate));
    toast.success(`${label} staging default applied.`);
  };
  const resetStagedCalendar = async (): Promise<void> => {
    const confirmed = await dialog.confirm({
      title: 'Reset staged calendar?',
      text: 'This restores the complete seven-day staging showcase. Your staged edits, colour changes and deletions will be removed.',
      danger: true,
      confirmText: 'Reset calendar',
      panelClass: 'cal-delete-confirm',
    });
    if (!confirmed) return;
    const defaults = defaultCalendarStagingWorkspace();
    replaceStagingWorkspace(defaults);
    toast.success('Seven-day staging showcase restored.');
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'Escape') {
        if (previewItem) { setPreviewItem(null); return; }
        if (createMenuAnchor) { setCreateMenuAnchor(null); return; }
        if (weekLayoutMenuAnchor) { setWeekLayoutMenuAnchor(null); return; }
        if (filtersOpen) { setFiltersOpen(false); return; }
        return;
      }
      if (event.key === 'Delete' && previewItem?.cancelable && !itemAction && !editorItem && !createOpen) {
        event.preventDefault();
        setPreviewItem(null);
        setPreviewPoint(null);
        setItemAction({ item: previewItem, action: 'delete' });
        return;
      }
      if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); step(-1); return; }
      if (event.altKey && event.key === 'ArrowRight') { event.preventDefault(); step(1); return; }
      if (!event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLocaleLowerCase() === 't') { event.preventDefault(); goToday(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [createMenuAnchor, createOpen, editorItem, filtersOpen, itemAction, previewItem, selectedDate, view, viewMonth, weekLayoutMenuAnchor]);

  if (demoMode.enabled && (!demoPage.useStagedData || (demoPage.showLandingPage && !enteredDemo))) {
    return <DemoLandingPage page="calendar" stagedEnabled={demoPage.useStagedData} onEnter={() => setEnteredDemo(true)} />;
  }

  const usingWeekTimeline = view === 'week' && weekLayout === 'timeline';
  const activeCalendarZoom = usingWeekTimeline ? weekTimelineZoom : calendarZoom;
  const setActiveCalendarZoom = usingWeekTimeline ? setWeekTimelineZoom : setCalendarZoom;
  const activeStagingScope: CalendarStagingTemplateScope | null = view === 'day' || view === 'week' ? view : null;
  const stagingMenuGroup: MenuGroup | null = import.meta.env.DEV ? {
    label: 'Staging options',
    items: [{
      id: 'staged-preview',
      label: 'Staged preview',
      icon: <LucideIcon name="GalleryVerticalEnd" />,
      control: ({ ref, tabIndex }) => (
        <button ref={ref} type="button" role="menuitemcheckbox" tabIndex={tabIndex} aria-checked={stagedPreview} aria-label="Show staged calendar" class={`cal-board-menu-switch ui-choice${stagedPreview ? ' is-on' : ''}`} data-ui-state={stagedPreview ? 'selected' : undefined} onClick={() => setStagedPreview(value => !value)}>
          <SwitchArtwork size="sm" />
        </button>
      ),
    }, ...(usingStagedData && activeStagingScope ? [{
      id: 'save-staging-default',
      label: 'Set current staging as default',
      description: 'Capture cards, times, colours, people and reminders',
      icon: <LucideIcon name="Save" />,
      trailing: stagingDefaults[activeStagingScope] ? <LucideIcon name="Check" size={14} /> : undefined,
      onSelect: () => { void saveStagingDefault(activeStagingScope); },
    }, {
      id: 'apply-staging-default',
      label: 'Apply saved staging default',
      description: stagingDefaults[activeStagingScope] ? `Replace this ${activeStagingScope} with the saved layout` : `No ${activeStagingScope} default has been saved`,
      icon: <LucideIcon name="CopyCheck" />,
      disabled: !stagingDefaults[activeStagingScope],
      onSelect: () => { void applyStagingDefault(activeStagingScope); },
    }, {
      id: 'reset-staged-calendar',
      label: 'Restore factory staging',
      description: 'Replace staged edits with the seven-day showcase',
      icon: <LucideIcon name="RotateCcw" />,
      danger: true,
      onSelect: () => { void resetStagedCalendar(); },
    }] : [])],
  } : null;

  const calendarToolbar = (
    <header class="cal-board-main-head">
        <SegmentedControl
          class="cal-board-view-tabs"
          size="sm"
          value={view}
          onChange={value => { setWeekLayoutMenuAnchor(null); setView(value); }}
          label="Calendar view"
          options={[
            { value: 'day', label: 'Day', icon: <LucideIcon name="CalendarDays" size={14} /> },
            { value: 'week', label: 'Week', icon: <LucideIcon name="CalendarRange" size={14} /> },
            { value: 'month', label: 'Month', icon: <LucideIcon name="Calendar" size={14} /> },
          ]}
        />
        <SearchField class="cal-board-search" value={search} onInput={setSearch} aria-label="Search task, event, or people" placeholder="Search task, event, or people…" />
        {view === 'week' ? <>
          <Button
            class="cal-week-layout-trigger"
            variant="secondary"
            size="sm"
            iconOnly
            title="Change Week view layout"
            aria-label={`Week view layout: ${weekLayout === 'columns' ? 'Columns' : 'Timeline'}`}
            aria-haspopup="menu"
            aria-expanded={Boolean(weekLayoutMenuAnchor)}
            iconLeft={<LucideIcon name={weekLayout === 'columns' ? 'Columns3' : 'MoveHorizontal'} size={14} />}
            onClick={event => {
              setViewMenuAnchor(null);
              setCreateMenuAnchor(null);
              setWeekLayoutMenuAnchor(current => current ? null : event.currentTarget as HTMLElement);
            }}
          />
          <DropdownMenu
            open={Boolean(weekLayoutMenuAnchor)}
            anchor={weekLayoutMenuAnchor}
            onClose={() => setWeekLayoutMenuAnchor(null)}
            align="start"
            placement="bottom"
            label="Week view layout"
            items={[
              { id: 'columns', label: 'Columns', description: 'Days across the top with time down the left', icon: <LucideIcon name="Columns3" size={15} />, trailing: weekLayout === 'columns' ? <LucideIcon name="Check" size={14} /> : undefined, onSelect: () => setWeekLayout('columns') },
              { id: 'timeline', label: 'Timeline', description: 'Days down the left with time across the top', icon: <LucideIcon name="MoveHorizontal" size={15} />, trailing: weekLayout === 'timeline' ? <LucideIcon name="Check" size={14} /> : undefined, onSelect: () => setWeekLayout('timeline') },
            ]}
          />
        </> : null}
        <Button variant="secondary" size="sm" iconLeft={<LucideIcon name="ListFilter" size={15} />} onClick={() => {
          setViewMenuAnchor(null);
          setWeekLayoutMenuAnchor(null);
          setFiltersOpen(value => !value);
        }}>Filter{activeFilterCount(filters) ? ` · ${activeFilterCount(filters)}` : ''}</Button>
        <Button variant="secondary" size="sm" iconOnly aria-label="Calendar settings" aria-haspopup="menu" aria-expanded={Boolean(viewMenuAnchor)} iconLeft={<LucideIcon name="Ellipsis" size={16} />} onClick={event => {
          const nextAnchor = viewMenuAnchor ? null : event.currentTarget as HTMLElement;
          setFiltersOpen(false);
          setWeekLayoutMenuAnchor(null);
          setViewMenuAnchor(nextAnchor);
        }} />
        <Button class="cal-board-add" variant="primary" size="md" iconLeft={<LucideIcon name="Plus" size={16} />} aria-haspopup="menu" aria-expanded={Boolean(createMenuAnchor)} disabled={!canCreate && !canCreateMeeting} onClick={event => {
          setViewMenuAnchor(null);
          setWeekLayoutMenuAnchor(null);
          setFiltersOpen(false);
          setCreateMenuAnchor(current => current ? null : event.currentTarget as HTMLElement);
        }}>Create</Button>
        <DropdownMenu open={Boolean(viewMenuAnchor)} anchor={viewMenuAnchor} onClose={() => setViewMenuAnchor(null)} align="end" label="Calendar settings" items={[
          {
            label: 'Calendar',
            items: [
              { id: 'today', label: 'Go to today', shortcut: 'T', icon: <LucideIcon name="CalendarCheck" />, onSelect: goToday },
              { id: 'manage-calendars', label: 'Manage calendars', icon: <LucideIcon name="CalendarCog" />, onSelect: openCalendarManager },
              { id: 'settings', label: 'Calendar settings', icon: <LucideIcon name="Settings2" />, onSelect: () => setSettingsOpen(true) },
              { id: 'refresh', label: 'Refresh calendar', icon: <LucideIcon name="RefreshCw" />, disabled: usingStagedData, onSelect: refresh },
            ],
          },
          ...(stagingMenuGroup ? [stagingMenuGroup] : []),
        ]} />
        <DropdownMenu open={Boolean(createMenuAnchor)} anchor={createMenuAnchor} onClose={() => setCreateMenuAnchor(null)} align="end" label="Create calendar item" items={[
          ...(canCreateActivity ? [{ id: 'event', label: 'Event', description: 'Schedule an activity or appointment', icon: <LucideIcon name="CalendarDays" />, onSelect: () => openCreate(selectedKey, '09:00', 'event') }] : []),
          ...(canCreateMeeting ? [{ id: 'meeting', label: 'Meeting', description: 'Invite people and add conferencing', icon: <LucideIcon name="Video" />, onSelect: () => openCreate(selectedKey, '09:00', 'meeting') }] : []),
          ...(canCreateTask ? [{ id: 'task', label: 'Task', description: 'Assign work with ownership and an optional deadline', icon: <LucideIcon name="ListChecks" />, onSelect: () => openCreate(selectedKey, '09:00', 'task') }] : []),
          ...(canCreateActivity ? [{ id: 'reminder', label: 'Reminder', description: 'Add a standalone personal reminder', icon: <LucideIcon name="BellRing" />, onSelect: () => openCreate(selectedKey, '09:00', 'reminder') }] : []),
        ]} />
    </header>
  );

  return (
    <div class="cal-root">
      <section class="cal-board-shell cal-ledger-shell">
        <div class="cal-board-layout cal-workspace">
          <CalendarDashboardRail month={viewMonth} selectedKey={selectedKey} weekStartsOn={weekStartsOn} eventDateKeys={miniMonthEventDateKeys} focusedItem={focusedItem} focusedPeople={focusedPeople} responseStatus={focusedResponse} acceptedCount={focusedAcceptedCount} awaitingCount={focusedAwaitingCount} reminderLabel={focusedReminderLabel} responsePending={focusedRespond.isPending} focusedIndex={focusedIndex} focusedCount={selectedActionItems.length} categories={categories} hiddenCategories={hiddenCategories} calendars={calendars} hiddenCalendarIds={hiddenCalendarIds} expandedSections={expandedNavigatorSections} onPreviousMonth={() => shiftMonth(-1)} onNextMonth={() => shiftMonth(1)} onSelectDate={chooseDate} onRespond={respondToFocusedItem} onOpenFocusedItem={focusedItem && (focusedItem.editable || Boolean(focusedItem.sourceRoute)) ? openFocusedItem : undefined} onPreviousFocusedItem={() => cycleFocusedItem(-1)} onNextFocusedItem={() => cycleFocusedItem(1)} onToggleCategory={toggleCategory} onToggleCalendar={toggleCalendar} onExpandedSectionsChange={sections => setExpandedNavigatorSections(sections.filter((section): section is CalendarNavigatorSection => section === 'navigator'))} />

          <main class="cal-board-main cal-calendar-card" ref={calendarFrameRef}>
            {calendarToolbar}
            {filtersOpen ? <FilterPanel filters={filters} sources={sources} scope={scope} query={search} onQueryChange={setSearch} onChange={setFilters} onScopeChange={setScope} onClear={() => { setFilters(EMPTY_FILTERS); setSearch(''); setScope('all'); }} onClose={() => setFiltersOpen(false)} /> : null}

            <section class="cal-board-canvas" aria-label={`Calendar ${periodTitle}`}>
              {!usingStagedData && listQ.isError ? <div class="cal-load-error"><div><strong>Calendar could not be loaded</strong><span>{listQ.error instanceof Error ? listQ.error.message : 'The authorised calendar service is unavailable.'}</span></div><Button variant="secondary" size="sm" onClick={() => void listQ.refetch()}>Try again</Button></div>
                : view === 'month' ? <MonthView month={viewMonth} items={displayedItems} selectedKey={selectedKey} loading={cold} weekStartsOn={weekStartsOn} showWeekends={showWeekends} eventLimit={monthEventLimit} dimPastEvents={dimPastEvents} showCardIcons={showCardIcons} enteringItemId={enteringItemId} onSelectDay={chooseDate} onOpenItem={selectCalendarItem} onEntryAnimationEnd={finishCalendarEntryAnimation} />
                : view === 'week' || view === 'day' ? <TimeGridView mode={view} weekLayout={weekLayout} days={gridDays} items={displayedItems} holidays={showHolidays ? visibleHolidays : []} weatherDays={showWeather ? weatherQ.data?.daily ?? [] : []} weatherLocationLabel={weatherMeta.label} loading={cold} zoom={activeCalendarZoom} showAllDay={showAllDay} showCurrentTime={showCurrentTime} autoFocusTimeline={autoFocusTimeline} snapMinutes={snapMinutes} dimPastEvents={dimPastEvents} showCardLocations={showCardLocations} showCardAttendees={showCardAttendees} showCardIcons={showCardIcons} enteringItemId={enteringItemId} draftSelection={createOpen ? createLiveDraft ?? createDraftSelection : null} onZoomChange={setActiveCalendarZoom} onOpenItem={selectCalendarItem} onEditItem={openItemEditor} onOpenSource={item => { if (item.sourceRoute) showSection(item.sourceRoute); }} onSetReminder={!usingStagedData ? item => setItemAction({ item, action: 'reminder' }) : undefined} onDeleteItem={item => setItemAction({ item, action: 'delete' })} onMoveItem={moveCalendarItem} onCreateForDay={canCreate ? openCreate : undefined} onCreateMeeting={canCreateMeeting ? (key, startTime) => openCreate(key, startTime, 'meeting') : undefined} onPrevious={() => step(-1)} onNext={() => step(1)} onEntryAnimationEnd={finishCalendarEntryAnimation} attendeePeople={displayedAttendeePeople} />
                : view === 'agenda' ? <AgendaView items={displayedItems} loading={cold} enteringItemId={enteringItemId} onOpenItem={selectCalendarItem} onEntryAnimationEnd={finishCalendarEntryAnimation} />
                : <TasksView items={displayedItems} loading={cold} enteringItemId={enteringItemId} onOpenItem={selectCalendarItem} onEntryAnimationEnd={finishCalendarEntryAnimation} />}
            </section>
            {previewPoint ? <span class="cal-preview-anchor" ref={setPreviewAnchor} style={`left:${previewPoint.x}px;top:${previewPoint.y}px`} aria-hidden="true" /> : null}
            <CalendarItemPreview item={previewItem} anchor={previewAnchor} boundary={calendarFrameRef.current} people={previewItem && focusedItem?.id === previewItem.id ? focusedPeople : []} agenda={previewItem?.kind === 'meeting' && previewItem.id === focusedItem?.id ? focusedStagedDetail?.agenda ?? [] : []} reminderLabel={previewItem && focusedItem?.id === previewItem.id ? focusedReminderLabel : null} onEdit={openItemEditor} onDuplicate={previewItem?.editable ? openDuplicate : undefined} onDelete={previewItem?.cancelable ? item => setItemAction({ item, action: 'delete' }) : undefined} onSetReminder={!usingStagedData && previewItem?.origin === 'calendar' && previewItem.status !== 'done' && previewItem.status !== 'cancelled' ? item => setItemAction({ item, action: 'reminder' }) : undefined} onOpenSource={previewItem?.sourceRoute ? item => { if (item.sourceRoute) showSection(item.sourceRoute); } : undefined} onClose={() => { setPreviewItem(null); setPreviewPoint(null); }} />
            <CalendarItemEditor open={editorOpen} item={editorItem} calendars={calendars} preview={usingStagedData} titleIconMode={titleIconType} previewSessionId={editorPreviewSessionId} previewPeople={usingStagedData && editorItem ? (stagedPeopleByItem[editorItem.id] ?? calendarStagingPeople(editorItem)).map(person => ({ id: person.userId, name: person.name, jobTitle: person.role, photoUrl: person.profileImage })) : []} previewDirectory={usingStagedData ? calendarStagingDirectory().map(person => ({ id: person.userId, name: person.name, jobTitle: person.role, photoUrl: person.profileImage })) : []} previewCategories={usingStagedData ? categories : []} previewReminderOffset={usingStagedData && editorItem ? (stagedReminderOffsetsByItem[editorItem.id] ?? calendarStagingReminderOffsets(editorItem))[0] ?? null : null} onPreviewSave={saveStagedItem} onDraftPreview={setEditorDraftPreview} onClose={closeItemEditor} />
            {(canCreate || canCreateMeeting) ? <CreateCalendarItemDialog open={createOpen} calendars={calendars} categoriesOverride={usingStagedData ? categories : undefined} preview={usingStagedData} titleIconMode={titleIconType} previewSessionId={createPreviewSessionId} initialCalendarId={createCalendarId} initialDate={createDate} initialTime={createTime} initialEndTime={createEndTime} initialTitle={createTitle} initialType={createType} initialColorKey={createColorKey} initialCustomColor={createCustomColor} initialItem={createDuplicateSource} initialPeople={createDuplicateSource && focusedItem?.id === createDuplicateSource.id ? focusedPeople.map(person => ({ id: person.id, name: person.name, photoUrl: person.src })) : []} initialReminderOffsets={createDuplicateSource && focusedItem?.id === createDuplicateSource.id ? (usingStagedData ? stagedReminderOffsetsByItem[createDuplicateSource.id] ?? calendarStagingReminderOffsets(createDuplicateSource) : focusedRemindersQ.data ?? []) : []} canCreateMeeting={canCreateMeeting} onPreviewCreate={usingStagedData ? createStagedItem : undefined} onDraftChange={setCreateLiveDraft} onClose={() => { setCreateOpen(false); setCreateDraftSelection(null); setCreateLiveDraft(null); setCreateDuplicateSource(null); }} onCreated={markCalendarEntryCreated} /> : null}
          </main>
        </div>
      </section>

      <CalendarItemActionDialog item={itemAction?.item ?? null} action={itemAction?.action ?? null} preview={usingStagedData} onPreviewDelete={deleteStagedItem} onClose={() => setItemAction(null)} />
      <CalendarSettingsDialog open={settingsOpen} view={view} weekLayout={weekLayout} columnZoom={calendarZoom} weekTimelineZoom={weekTimelineZoom} weekStartsOn={weekStartsOn} snapMinutes={snapMinutes} showAllDay={showAllDay} showCurrentTime={showCurrentTime} autoFocusTimeline={autoFocusTimeline} defaultDurationMinutes={defaultDurationMinutes} showWeekends={showWeekends} dimPastEvents={dimPastEvents} showCardLocations={showCardLocations} showCardAttendees={showCardAttendees} showCardIcons={showCardIcons} monthEventLimit={monthEventLimit} showWeather={showWeather} showHolidays={showHolidays} weatherLocation={weatherLocation} titleIconType={titleIconType} scope={scope} sources={sources} hiddenSources={hiddenSources} onViewChange={setView} onWeekLayoutChange={setWeekLayout} onColumnZoomChange={setCalendarZoom} onWeekTimelineZoomChange={setWeekTimelineZoom} onWeekStartsOnChange={setWeekStartsOn} onSnapMinutesChange={setSnapMinutes} onShowAllDayChange={setShowAllDay} onShowCurrentTimeChange={setShowCurrentTime} onAutoFocusTimelineChange={setAutoFocusTimeline} onDefaultDurationMinutesChange={setDefaultDurationMinutes} onShowWeekendsChange={setShowWeekends} onDimPastEventsChange={setDimPastEvents} onShowCardLocationsChange={setShowCardLocations} onShowCardAttendeesChange={setShowCardAttendees} onShowCardIconsChange={setShowCardIcons} onMonthEventLimitChange={setMonthEventLimit} onShowWeatherChange={setShowWeather} onShowHolidaysChange={setShowHolidays} onWeatherLocationChange={setWeatherLocation} onTitleIconTypeChange={setTitleIconType} onScopeChange={setScope} onToggleSource={toggleSource} onClose={() => setSettingsOpen(false)} />
      <CalendarManagementDialog open={calendarManagerOpen} calendars={calendars} connectionsEnabled={!usingStagedData} onCreateCalendar={!usingStagedData && canCreate ? () => openCollectionFromManager(null) : undefined} onClose={() => setCalendarManagerOpen(false)} />
      <CalendarCollectionDialog open={collectionDialog.open} calendar={collectionDialog.calendar} onClose={closeCollectionDialog} />
    </div>
  );
}
