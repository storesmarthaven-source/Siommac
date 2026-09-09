import type { CalendarItemDTO } from '@api/calendar';
import { monthGrid, toLocalDateKey, weekDays } from '@lib/calendar/date';
import {
  EMPTY_FILTERS,
  activeFilterCount,
  calendarCategory,
  calendarItemHasAction,
  filterCalendarItems,
  groupItemsByDate,
  upcomingActionItems,
} from './calendarViewModel';

function item(overrides: Partial<CalendarItemDTO> = {}): CalendarItemDTO {
  const base: CalendarItemDTO = {
    id: 'item-1',
    type: 'task',
    kind: 'task',
    categoryId: 'category-finance',
    categoryKey: 'finance_payroll',
    categoryName: 'Finance & Payroll',
    categoryIcon: 'BadgeDollarSign',
    availability: null,
    origin: 'calendar',
    title: 'Prepare payroll',
    notes: null,
    colorKey: null,
    customColor: null,
    locationLabel: null,
    allDay: true,
    startsOn: '2026-07-21',
    endsOn: null,
    startsAt: null,
    endsAt: null,
    status: 'not_started',
    priority: 'high',
    ownerUserId: 'user-1',
    ownerName: 'Asha Singh',
    assigneeUserId: 'user-1',
    assigneeName: 'Asha Singh',
    departmentId: null,
    departmentName: null,
    attendeeCount: 0,
    visibility: 'personal',
    sourceModule: null,
    sourceRef: null,
    sourceRoute: null,
    sourceLabel: null,
    sourceDepartment: 'calendar',
    sourceDepartmentLabel: 'Calendar',
    recurrenceSeriesId: null,
    recurrenceRule: null,
    occurrenceDate: null,
    editable: true,
    completable: true,
    assignable: false,
    cancelable: true,
    drillThrough: false,
  };
  return {
    ...base,
    ...overrides,
    sourceDepartment: overrides.sourceDepartment ?? base.sourceDepartment,
    sourceDepartmentLabel: overrides.sourceDepartmentLabel ?? base.sourceDepartmentLabel,
    departmentId: overrides.departmentId ?? base.departmentId,
    departmentName: overrides.departmentName ?? base.departmentName,
  };
}

describe('calendar view model', () => {
  it('keeps active and archived scopes separate', () => {
    const active = item();
    const done = item({ id: 'done', status: 'done' });

    expect(filterCalendarItems([done, active], {
      scope: 'all',
      search: '',
      filters: EMPTY_FILTERS,
      userId: 'user-1',
    })).toEqual([active]);
    expect(filterCalendarItems([active, done], {
      scope: 'archived',
      search: '',
      filters: EMPTY_FILTERS,
      userId: 'user-1',
    })).toEqual([done]);
  });

  it('applies visibility, source, assignment and search filters together', () => {
    const matching = item({
      id: 'finance-deadline',
      type: 'deadline',
      origin: 'module',
      title: 'PAYE monthly return',
      visibility: 'org',
      sourceModule: 'finance-statutory',
      sourceLabel: 'Statutory deadline',
    });
    const personal = item({ id: 'personal', title: 'Private reminder' });
    const filters = {
      ...EMPTY_FILTERS,
      type: 'deadline' as const,
      source: 'finance-statutory',
      assignment: 'me' as const,
      visibility: 'org' as const,
    };

    expect(filterCalendarItems([personal, matching], {
      scope: 'public',
      search: 'PAYE',
      filters,
      userId: 'user-1',
    })).toEqual([matching]);
    expect(activeFilterCount(filters)).toBe(4);
  });

  it('groups chronologically and sorts all-day items before timed items', () => {
    const later = item({
      id: 'later',
      allDay: false,
      startsOn: null,
      startsAt: '2026-07-22T14:00:00-04:00',
      title: 'Afternoon review',
    });
    const allDay = item({ id: 'all-day', startsOn: '2026-07-22', title: 'Closure' });
    const earlier = item({ id: 'earlier', startsOn: '2026-07-21' });

    const groups = groupItemsByDate([later, allDay, earlier]);
    expect(groups.map(group => group.key)).toEqual(['2026-07-21', '2026-07-22']);
    expect(groups[1]?.items.map(grouped => grouped.id)).toEqual(['all-day', 'later']);
  });

  it('separates meeting-backed activities from ordinary events', () => {
    const meeting = item({ id: 'meeting', type: 'activity', kind: 'meeting', sourceModule: 'meetings' });
    const event = item({ id: 'event', type: 'activity', kind: 'event', sourceModule: null });

    expect(filterCalendarItems([meeting, event], {
      scope: 'all', search: '', filters: { ...EMPTY_FILTERS, type: 'meeting' }, userId: 'user-1',
    })).toEqual([meeting]);
    expect(filterCalendarItems([meeting, event], {
      scope: 'all', search: '', filters: { ...EMPTY_FILTERS, type: 'event' }, userId: 'user-1',
    })).toEqual([event]);
  });

  it('filters every user-facing kind without confusing storage families', () => {
    const deadline = item({ id: 'deadline', type: 'task', kind: 'deadline' });
    const reminder = item({ id: 'reminder', type: 'activity', kind: 'reminder' });
    const task = item({ id: 'task', type: 'task', kind: 'task' });

    expect(filterCalendarItems([deadline, reminder, task], {
      scope: 'all', search: '', filters: { ...EMPTY_FILTERS, type: 'deadline' }, userId: 'user-1',
    })).toEqual([deadline]);
    expect(filterCalendarItems([deadline, reminder, task], {
      scope: 'all', search: '', filters: { ...EMPTY_FILTERS, type: 'reminder' }, userId: 'user-1',
    })).toEqual([reminder]);
    expect(filterCalendarItems([deadline, reminder, task], {
      scope: 'all', search: '', filters: { ...EMPTY_FILTERS, type: 'task' }, userId: 'user-1',
    })).toEqual([task]);
  });

  it('classifies calendar categories and filters the personal scope', () => {
    const reminder = item({ type: 'activity', kind: 'reminder', categoryKey: 'general', sourceLabel: 'Reminder', sourceRef: 'REM-100' });
    const meeting = item({ type: 'activity', kind: 'meeting', categoryKey: 'general', sourceModule: 'meetings' });
    const deadline = item({ type: 'deadline', kind: 'deadline', categoryKey: 'compliance', origin: 'module' });
    expect(calendarCategory(reminder)).toBe('general');
    expect(calendarCategory(meeting)).toBe('general');
    expect(calendarCategory(deadline)).toBe('compliance');

    const mine = item({ id: 'mine', ownerUserId: 'user-1' });
    const theirs = item({ id: 'theirs', ownerUserId: 'user-2', assigneeUserId: 'user-2', visibility: 'org' });
    expect(filterCalendarItems([theirs, mine], { scope: 'mine', search: '', filters: EMPTY_FILTERS, userId: 'user-1' })).toEqual([mine]);
  });

  it('returns only the next incomplete tasks and deadlines, within the limit', () => {
    const values = [
      item({ id: 'activity', type: 'activity' }),
      item({ id: 'past', startsOn: '2026-07-19' }),
      item({ id: 'done', startsOn: '2026-07-20', status: 'done' }),
      item({ id: 'task', startsOn: '2026-07-20' }),
      item({ id: 'deadline', type: 'deadline', origin: 'module', startsOn: '2026-07-21' }),
    ];

    expect(upcomingActionItems(values, '2026-07-20', 2).map(value => value.id))
      .toEqual(['task', 'deadline']);
  });

  it('keeps ordinary events out of the action preview', () => {
    const ordinary = item({ id: 'event', type: 'activity', status: null, attendeeCount: 0, completable: false, assignable: false });
    const invited = item({ id: 'invite', type: 'activity', status: null, ownerUserId: 'user-2', attendeeCount: 3, completable: false });
    const linked = item({ id: 'linked', type: 'deadline', origin: 'module', sourceRoute: 's-payroll', drillThrough: true, completable: false });

    expect(calendarItemHasAction(ordinary, 'user-1')).toBe(false);
    expect(calendarItemHasAction(invited, 'user-1')).toBe(true);
    expect(calendarItemHasAction(linked, 'user-1')).toBe(true);
  });
});

describe('calendar local-date grids', () => {
  it('builds a fixed six-week Monday-first month grid', () => {
    const grid = monthGrid(new Date(2026, 6, 1));
    expect(grid).toHaveLength(42);
    expect(toLocalDateKey(grid[0]!)).toBe('2026-06-29');
    expect(grid[0]!.getDay()).toBe(1);
    expect(grid[41]!.getDay()).toBe(0);
  });

  it('returns the Monday-first week containing a date', () => {
    const week = weekDays(new Date(2026, 6, 22));
    expect(week.map(toLocalDateKey)).toEqual([
      '2026-07-20',
      '2026-07-21',
      '2026-07-22',
      '2026-07-23',
      '2026-07-24',
      '2026-07-25',
      '2026-07-26',
    ]);
  });
});
