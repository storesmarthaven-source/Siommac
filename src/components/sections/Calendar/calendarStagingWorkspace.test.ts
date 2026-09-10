import type { CalendarItemDTO } from '@api/calendar';
import { itemDateKey } from '@lib/calendar/date';
import { calendarStagingItems } from './calendarStaging';
import {
  CALENDAR_STAGING_DEFAULTS_KEY,
  CALENDAR_STAGING_WORKSPACE_KEY,
  applyCalendarStagingTemplate,
  createCalendarStagingTemplate,
  defaultCalendarStagingWorkspace,
  loadCalendarStagingDefaults,
  loadCalendarStagingWorkspace,
  saveCalendarStagingDefaults,
  saveCalendarStagingWorkspace,
} from './calendarStagingWorkspace';

function memoryStorage(initial: string | null = null): Pick<Storage, 'getItem' | 'setItem'> & { key: string | null; value: string | null } {
  return {
    key: initial === null ? null : CALENDAR_STAGING_WORKSPACE_KEY,
    value: initial,
    getItem(key: string) { return this.key === key ? this.value : null; },
    setItem(key: string, value: string) { this.key = key; this.value = value; },
  };
}

function multiKeyStorage(): Pick<Storage, 'getItem' | 'setItem'> & { values: Map<string, string> } {
  return {
    values: new Map(),
    getItem(key: string) { return this.values.get(key) ?? null; },
    setItem(key: string, value: string) { this.values.set(key, value); },
  };
}

describe('calendar staged workspace persistence', () => {
  it('anchors the default staging set to Sunday so every visible Week row is populated', () => {
    const wednesday = new Date(2026, 8, 9, 12);
    const workspace = defaultCalendarStagingWorkspace(wednesday);
    const populatedDates = new Set(workspace.items.map(itemDateKey));

    for (let offset = 0; offset < 7; offset += 1) {
      expect(populatedDates.has(`2026-09-${String(6 + offset).padStart(2, '0')}`)).toBe(true);
    }
  });

  it('round-trips edits, deletions, people, reminders and responses', () => {
    const storage = memoryStorage();
    const workspace = defaultCalendarStagingWorkspace(new Date(2026, 8, 6, 12));
    const retained = workspace.items[0]!;
    const edited: CalendarItemDTO = { ...retained, title: 'Persisted title', colorKey: 'teal' };
    const saved = {
      ...workspace,
      items: [edited],
      peopleByItem: { [edited.id]: [{ userId: 'person-1', name: 'Alicia Moore', role: 'Organizer', profileImage: null, responseStatus: 'accepted' as const }] },
      reminderOffsetsByItem: { [edited.id]: [15] },
      responses: { [edited.id]: 'tentative' as const },
    };

    saveCalendarStagingWorkspace(saved, storage);
    const loaded = loadCalendarStagingWorkspace(storage);

    expect(storage.key).toBe(CALENDAR_STAGING_WORKSPACE_KEY);
    expect(loaded.items).toHaveLength(1);
    expect(loaded.items[0]?.title).toBe('Persisted title');
    expect(loaded.items[0]?.colorKey).toBe('teal');
    expect(loaded.peopleByItem[edited.id]?.[0]?.name).toBe('Alicia Moore');
    expect(loaded.reminderOffsetsByItem[edited.id]).toEqual([15]);
    expect(loaded.responses[edited.id]).toBe('tentative');
  });

  it('falls back to a complete default workspace when stored data is invalid', () => {
    const storage = memoryStorage('{"version":1,"items":"broken"}');
    const loaded = loadCalendarStagingWorkspace(storage);

    expect(loaded.items.length).toBeGreaterThan(0);
    expect(loaded.peopleByItem).toEqual({});
    expect(loaded.reminderOffsetsByItem).toEqual({});
  });

  it('rebases an older saved preview to Sunday without discarding its edits or deletions', () => {
    const wednesday = new Date(2026, 8, 9, 12);
    const legacyItems = calendarStagingItems(wednesday)
      .filter(item => item.id !== 'calendar-demo-2')
      .map(item => item.id === 'calendar-demo-1' ? { ...item, title: 'Edited crew window', colorKey: 'purple' } : item);
    const storage = memoryStorage(JSON.stringify({
      version: 1,
      items: legacyItems,
      peopleByItem: {},
      reminderOffsetsByItem: { 'calendar-demo-1': [30] },
      responses: {},
    }));

    const loaded = loadCalendarStagingWorkspace(storage, wednesday);

    expect(loaded.anchorDate).toBe('2026-09-06');
    expect(itemDateKey(loaded.items.find(item => item.id === 'calendar-demo-1')!)).toBe('2026-09-06');
    expect(loaded.items.find(item => item.id === 'calendar-demo-1')).toMatchObject({ title: 'Edited crew window', colorKey: 'purple' });
    expect(loaded.items.some(item => item.id === 'calendar-demo-2')).toBe(false);
    expect(loaded.reminderOffsetsByItem['calendar-demo-1']).toEqual([30]);
  });

  it('captures a Day default and applies the complete layout to another day with unique ids', () => {
    const workspace = defaultCalendarStagingWorkspace(new Date(2026, 8, 6, 12));
    const sourceItem = workspace.items.find(item => itemDateKey(item) === '2026-09-06')!;
    workspace.peopleByItem[sourceItem.id] = [{ userId: 'person-1', name: 'Alicia Moore', role: 'Organizer', profileImage: null, responseStatus: 'accepted' }];
    workspace.reminderOffsetsByItem[sourceItem.id] = [15];
    workspace.responses[sourceItem.id] = 'accepted';

    const dayDefault = createCalendarStagingTemplate(workspace, 'day', new Date(2026, 8, 6, 12), new Date('2026-09-09T12:00:00Z'));
    const applied = applyCalendarStagingTemplate(workspace, dayDefault, new Date(2026, 8, 10, 12));
    const thursdayItems = applied.items.filter(item => itemDateKey(item) === '2026-09-10');

    expect(dayDefault.items).toHaveLength(10);
    expect(thursdayItems).toHaveLength(10);
    expect(new Set(applied.items.map(item => item.id)).size).toBe(applied.items.length);
    const copiedSource = thursdayItems.find(item => item.sourceRef === sourceItem.sourceRef)!;
    expect(applied.peopleByItem[copiedSource.id]?.[0]?.name).toBe('Alicia Moore');
    expect(applied.reminderOffsetsByItem[copiedSource.id]).toEqual([15]);
    expect(applied.responses[copiedSource.id]).toBe('accepted');
  });

  it('captures and reapplies a full Week default while preserving accurate relative dates and times', () => {
    const workspace = defaultCalendarStagingWorkspace(new Date(2026, 8, 6, 12));
    const weekDefault = createCalendarStagingTemplate(workspace, 'week', new Date(2026, 8, 9, 12));
    const applied = applyCalendarStagingTemplate(workspace, weekDefault, new Date(2026, 8, 16, 12));
    const populatedDates = new Set(applied.items.map(itemDateKey));

    expect(weekDefault.anchorDate).toBe('2026-09-06');
    expect(weekDefault.items).toHaveLength(70);
    expect(applied.anchorDate).toBe('2026-09-13');
    expect(applied.items).toHaveLength(70);
    for (let offset = 13; offset <= 19; offset += 1) {
      expect(populatedDates.has(`2026-09-${offset}`)).toBe(true);
    }
    const copiedMorning = applied.items.find(item => item.sourceRef === 'STG-SUN-LONG-EVENT');
    expect(copiedMorning?.startsAt).toContain('2026-09-13');
  });

  it('stores Day and Week defaults independently from the working staging workspace', () => {
    const storage = multiKeyStorage();
    const workspace = defaultCalendarStagingWorkspace(new Date(2026, 8, 6, 12));
    const defaults = {
      version: 1 as const,
      day: createCalendarStagingTemplate(workspace, 'day', new Date(2026, 8, 6, 12)),
      week: createCalendarStagingTemplate(workspace, 'week', new Date(2026, 8, 6, 12)),
    };

    saveCalendarStagingWorkspace(workspace, storage);
    saveCalendarStagingDefaults(defaults, storage);

    expect(storage.values.has(CALENDAR_STAGING_WORKSPACE_KEY)).toBe(true);
    expect(storage.values.has(CALENDAR_STAGING_DEFAULTS_KEY)).toBe(true);
    expect(loadCalendarStagingDefaults(storage).day?.items).toHaveLength(10);
    expect(loadCalendarStagingDefaults(storage).week?.items).toHaveLength(70);
  });
});
