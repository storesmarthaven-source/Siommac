import { applyCalendarStagingPatch, CALENDAR_STAGING_CALENDARS, calendarStagingDetail, calendarStagingHolidays, calendarStagingItems, calendarStagingPeople, calendarStagingReminderOffsets } from './calendarStaging';
import { toLocalDateKey } from '@lib/calendar/date';

describe('calendar staged workspace', () => {
  it('provides the same complete, varied showcase on every day of the editable preview week', () => {
    const start = new Date(2026, 8, 6, 12);
    const items = calendarStagingItems(start);

    expect(new Set(items.map(item => item.type))).toEqual(new Set(['activity', 'task', 'deadline']));
    expect(items.some(item => item.sourceRoute)).toBe(true);
    expect(items.some(item => item.attendeeCount > 0)).toBe(true);
    expect(items.filter(item => item.kind === 'meeting').every(item => item.colorKey === 'blue')).toBe(true);
    expect(items.every(item => item.editable && !item.completable && !item.assignable && item.cancelable)).toBe(true);
    for (let offset = 0; offset < 7; offset += 1) {
      const key = toLocalDateKey(new Date(2026, 8, 6 + offset, 12));
      const dayItems = items.filter(item => (item.startsOn ?? item.startsAt?.slice(0, 10)) === key);
      expect(dayItems).toHaveLength(10);
      expect(dayItems.filter(item => item.allDay)).toHaveLength(2);
      expect(new Set(dayItems.map(item => item.kind))).toEqual(new Set(['event', 'meeting', 'task', 'deadline', 'reminder']));
      expect(new Set(dayItems.map(item => item.titleIconType).filter(Boolean))).toEqual(new Set(['emoji', 'lucide']));
      expect(new Set(dayItems.filter(item => item.startsAt).map(item => Math.round((Date.parse(item.endsAt!) - Date.parse(item.startsAt!)) / 60_000)))).toEqual(new Set([30, 45, 75, 90, 105, 150]));
    }
    expect(new Set(items.map(item => item.colorKey))).toEqual(new Set(['blue', 'teal', 'amber', 'purple', 'coral', 'mint', 'slate']));
    expect(items.map(item => item.sourceLabel).filter(Boolean)).toEqual(expect.arrayContaining(['Meeting', 'Task', 'Deadline', 'Reminder', 'Event', 'Field Operation', 'Safety Inspection']));
  });

  it('stages varied card lengths and a deliberate same-time split', () => {
    const start = new Date(2026, 8, 6, 12);
    const items = calendarStagingItems(start).filter(item => item.startsAt?.slice(0, 10) === toLocalDateKey(start));
    const durations = items.map(item => Math.round((Date.parse(item.endsAt!) - Date.parse(item.startsAt!)) / 60_000));
    const meeting = items.find(item => item.title === 'Sunday Readiness Huddle')!;
    const sameTimeItems = items.filter(item => item.startsAt === meeting.startsAt && item.endsAt === meeting.endsAt);

    expect([...new Set(durations)]).toEqual(expect.arrayContaining([30, 45, 75, 90, 105, 150]));
    expect(sameTimeItems).toHaveLength(2);
    expect(new Set(sameTimeItems.map(item => item.kind))).toEqual(new Set(['event', 'meeting']));
  });

  it('stages one SIOMAC calendar plus connected providers without orphaning preview entries', () => {
    const items = calendarStagingItems(new Date(2026, 8, 6, 12));
    const calendarIds = new Set(CALENDAR_STAGING_CALENDARS.map(calendar => calendar.id));

    expect(CALENDAR_STAGING_CALENDARS.map(calendar => calendar.name)).toEqual([
      'My Calendar',
      'Google Calendar',
      'Outlook Work',
      'iCloud Personal',
      'Exchange Operations',
    ]);
    expect(CALENDAR_STAGING_CALENDARS.filter(calendar => calendar.provider).map(calendar => calendar.provider)).toEqual([
      'google',
      'microsoft',
      'apple',
      'exchange',
    ]);
    expect(new Set(items.map(item => item.calendarId))).toEqual(new Set([CALENDAR_STAGING_CALENDARS[0]!.id]));
    expect(items.every(item => item.calendarId != null && calendarIds.has(item.calendarId))).toBe(true);
  });

  it('stages reminders and meeting agendas explicitly instead of applying them to every card', () => {
    const items = calendarStagingItems(new Date(2026, 8, 6, 12));
    const meeting = items.find(item => item.sourceRef === 'STG-SUN-MORNING-MEETING')!;
    const event = items.find(item => item.sourceRef === 'STG-SUN-PAIRED-EVENT')!;

    expect(calendarStagingReminderOffsets(meeting)).toEqual([15]);
    expect(calendarStagingReminderOffsets(event)).toEqual([]);
    expect(calendarStagingDetail(meeting)?.agenda).toEqual(expect.arrayContaining(['Review the day’s readiness constraints']));
    expect(calendarStagingDetail(event)).toBeNull();
  });

  it('applies staged schedule and colour changes without creating a second record', () => {
    const original = calendarStagingItems(new Date(2026, 8, 6, 12))[0]!;
    const updated = applyCalendarStagingPatch(original, {
      title: 'Edited staged card',
      startsAt: '2026-09-06T13:00:00.000Z',
      endsAt: '2026-09-08T17:00:00.000Z',
      colorKey: null,
      customColor: '#2a8f64',
      categoryId: 'calendar-demo-category-general',
      availability: 'free',
      recurrenceRule: 'FREQ=WEEKLY',
    });

    expect(updated.id).toBe(original.id);
    expect(updated.title).toBe('Edited staged card');
    expect(updated.endsAt).toBe('2026-09-08T17:00:00.000Z');
    expect(updated.colorKey).toBeNull();
    expect(updated.customColor).toBe('#2a8f64');
    expect(updated.categoryId).toBe('calendar-demo-category-general');
    expect(updated.availability).toBe('free');
    expect(updated.recurrenceRule).toBe('FREQ=WEEKLY');
  });

  it('uses unique fresh records while retaining the same staging roles on each day', () => {
    const items = calendarStagingItems(new Date(2026, 8, 6, 12));
    const rolesByDay = Array.from({ length: 7 }, (_, offset) => items
      .filter(item => (item.startsOn ?? item.startsAt?.slice(0, 10)) === `2026-09-${String(6 + offset).padStart(2, '0')}`)
      .map(item => item.sourceRef?.replace(/^STG-[A-Z]{3}-/, '')));

    expect(new Set(items.map(item => item.id)).size).toBe(items.length);
    for (const roles of rolesByDay.slice(1)) expect(roles).toEqual(rolesByDay[0]);
  });

  it('stages four researched Trinidad and Tobago holiday treatments on the visible days', () => {
    const days = Array.from({ length: 4 }, (_, offset) => new Date(2026, 8, 7 + offset, 12));
    const holidays = calendarStagingHolidays(days);

    expect(holidays.map(holiday => holiday.name)).toEqual([
      'Independence Day',
      'African Emancipation Day',
      'Divali',
      'Eid-ul-Fitr',
    ]);
    expect(holidays.map(holiday => holiday.date)).toEqual(days.map(toLocalDateKey));
    expect(holidays.every(holiday => holiday.calendarName.includes('Design preview'))).toBe(true);
  });

  it('supplies portraits only for meeting cards', () => {
    const items = calendarStagingItems(new Date(2026, 8, 6, 12));
    const permitHandover = items.find(item => item.title === 'Close Permit Actions')!;
    const mobilisation = items.find(item => item.title === 'Marine Logistics Window')!;
    const meeting = items.find(item => item.sourceRef === 'STG-SUN-MORNING-MEETING')!;
    const upcomingDeadline = items.find(item => item.title === 'Overtime Approval Cutoff')!;
    expect(calendarStagingPeople(permitHandover)).toEqual([]);
    expect(calendarStagingPeople(mobilisation)).toEqual([]);
    expect(calendarStagingPeople(meeting).map(person => person.name)).toEqual([
      'Marcus Allen',
      'Alicia Moore',
      'Darius King',
      'Jordan Peters',
    ]);
    expect(calendarStagingPeople(upcomingDeadline)).toEqual([]);
  });
});
