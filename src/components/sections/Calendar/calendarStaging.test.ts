import { applyCalendarStagingPatch, CALENDAR_STAGING_CALENDARS, calendarStagingDetail, calendarStagingHolidays, calendarStagingItems, calendarStagingPeople, calendarStagingReminderOffsets } from './calendarStaging';
import { toLocalDateKey } from '@lib/calendar/date';

describe('calendar staged workspace', () => {
  it('provides a varied editable preview week with local-only staged actions', () => {
    const start = new Date(2026, 8, 6, 12);
    const items = calendarStagingItems(start);

    expect(new Set(items.map(item => item.type))).toEqual(new Set(['activity', 'task', 'deadline']));
    expect(items.some(item => item.sourceRoute)).toBe(true);
    expect(items.some(item => item.attendeeCount > 0)).toBe(true);
    expect(items.filter(item => item.allDay && item.startsOn === toLocalDateKey(start))).toHaveLength(2);
    const todayItems = items.filter(item => (item.startsOn ?? item.startsAt?.slice(0, 10)) === toLocalDateKey(start));
    expect(new Set(todayItems.map(item => item.kind))).toEqual(new Set(['event', 'meeting', 'task', 'deadline', 'reminder']));
    expect(new Set(todayItems.map(item => item.titleIconType).filter(Boolean))).toEqual(new Set(['emoji', 'lucide']));
    expect(items.filter(item => item.kind === 'meeting').every(item => item.colorKey === 'blue')).toBe(true);
    expect(items.every(item => item.editable && !item.completable && !item.assignable && item.cancelable)).toBe(true);
    expect(items.filter(item => (item.startsOn ?? item.startsAt?.slice(0, 10)) === toLocalDateKey(start)).length).toBeGreaterThanOrEqual(3);
    for (let offset = 0; offset < 7; offset += 1) {
      const key = toLocalDateKey(new Date(2026, 8, 6 + offset, 12));
      expect(items.filter(item => (item.startsOn ?? item.startsAt?.slice(0, 10)) === key).length).toBeGreaterThanOrEqual(3);
    }
    expect(items.map(item => item.sourceLabel).filter(Boolean)).toEqual(expect.arrayContaining(['Meeting', 'Task', 'Deadline', 'Reminder', 'Milestone', 'Toolbox Talk']));
  });

  it('stages varied card lengths and a deliberate same-time split', () => {
    const start = new Date(2026, 8, 6, 12);
    const items = calendarStagingItems(start).filter(item => item.startsAt?.slice(0, 10) === toLocalDateKey(start));
    const durations = items.map(item => Math.round((Date.parse(item.endsAt!) - Date.parse(item.startsAt!)) / 60_000));
    const meeting = items.find(item => item.title === 'Site Readiness Sync')!;
    const sameTimeItems = items.filter(item => item.startsAt === meeting.startsAt && item.endsAt === meeting.endsAt);

    expect([...new Set(durations)]).toEqual(expect.arrayContaining([30, 45, 75, 120]));
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
    const meeting = items.find(item => item.sourceRef === 'MTG-DEMO-TODAY')!;
    const event = items.find(item => item.sourceRef === 'EVT-DEMO-VENDOR')!;

    expect(calendarStagingReminderOffsets(meeting)).toEqual([15]);
    expect(calendarStagingReminderOffsets(event)).toEqual([]);
    expect(calendarStagingDetail(meeting)?.agenda).toEqual(expect.arrayContaining(['Confirm site access and permit status']));
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
    });

    expect(updated.id).toBe(original.id);
    expect(updated.title).toBe('Edited staged card');
    expect(updated.endsAt).toBe('2026-09-08T17:00:00.000Z');
    expect(updated.colorKey).toBeNull();
    expect(updated.customColor).toBe('#2a8f64');
  });

  it('includes one overnight multi-day record for lane and continuation staging', () => {
    const items = calendarStagingItems(new Date(2026, 8, 6, 12));
    const multiDay = items.find(item => item.title === 'Offshore Mobilisation Window');

    expect(multiDay?.startsAt?.slice(0, 10)).toBe('2026-09-07');
    expect(multiDay?.endsAt?.slice(0, 10)).toBe('2026-09-08');
    expect(items.filter(item => item.id === multiDay?.id)).toHaveLength(1);
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
    const permitHandover = items.find(item => item.title === 'Permit Handover')!;
    const mobilisation = items.find(item => item.title === 'North Field Mobilisation')!;
    const meeting = items.find(item => item.sourceRef === 'MTG-DEMO-TODAY')!;
    const upcomingDeadline = items.find(item => item.title === 'Payroll Variance Submission')!;
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
