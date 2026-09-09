import type { CalendarItemDTO } from '@api/calendar';
import {
  CALENDAR_STAGING_WORKSPACE_KEY,
  defaultCalendarStagingWorkspace,
  loadCalendarStagingWorkspace,
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

describe('calendar staged workspace persistence', () => {
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
});
