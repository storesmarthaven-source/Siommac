import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { vi } from 'vitest';
import type { CalendarItemDTO, UpdateEntryRequest } from '@api/calendar';
import { localTimestamp } from '@lib/calendar/date';
import { CalendarItemEditor, type CalendarEditorDraftPreview } from './CalendarItemEditor';
import { TimeGridView } from './TimeGridView';

const CALENDARS = [{ id: '00000000-0000-4000-8000-000000000001', name: 'My Calendar', description: null, ownerUserId: 'user-1', ownerName: 'User', visibility: 'personal' as const, departmentId: null, departmentName: null, colorKey: 'blue' as const, customColor: null, isDefault: true, status: 'active' as const, canEdit: true, canArchive: false, provider: null, readOnly: false }];
const CATEGORIES = [
  { id: '00000000-0000-4000-8000-000000000099', key: 'operations', name: 'Operations', iconName: 'BriefcaseBusiness', scope: 'system' as const, sortOrder: 1, active: true, canManage: false },
  { id: '00000000-0000-4000-8000-000000000100', key: 'general', name: 'General', iconName: 'CalendarDays', scope: 'system' as const, sortOrder: 2, active: true, canManage: false },
];
const DEPARTMENTS = [{ id: 'dept-1', name: 'Operations' }];
const EMPTY_REMINDERS: number[] = [];
const EMPTY_RECIPIENTS: never[] = [];

const update = vi.hoisted(() => vi.fn());
const setReminders = vi.hoisted(() => vi.fn());

vi.mock('@api/calendar', async importOriginal => {
  const original = await importOriginal<typeof import('@api/calendar')>();
  return {
    ...original,
    useCalendarItem: () => ({ data: undefined, isLoading: false }),
    useCalendarDepartments: () => ({ data: DEPARTMENTS, isLoading: false }),
    useCalendarCategories: () => ({ data: CATEGORIES, isLoading: false, isError: false }),
    useCalendarReminders: () => ({ data: EMPTY_REMINDERS, isLoading: false }),
    useSetCalendarReminders: () => ({ mutateAsync: setReminders, isPending: false }),
    useUpdateEntry: () => ({ mutateAsync: update, isPending: false }),
  };
});

vi.mock('@api/communications', () => ({
  useMessageRecipients: () => ({ data: EMPTY_RECIPIENTS, isFetching: false, isError: false }),
}));

const item: CalendarItemDTO = {
  id: 'task-1', type: 'task', kind: 'task', categoryId: '00000000-0000-4000-8000-000000000099', categoryKey: 'operations', categoryName: 'Operations', categoryIcon: 'BriefcaseBusiness', availability: null, origin: 'calendar', title: 'Review roster', notes: 'Confirm coverage',
  colorKey: 'amber', customColor: null, locationLabel: null, allDay: false, startsOn: null, endsOn: null,
  startsAt: '2026-09-07T09:00:00-04:00', endsAt: '2026-09-07T10:00:00-04:00', status: 'not_started', priority: 'medium',
  ownerUserId: 'owner-1', ownerName: 'Owner', assigneeUserId: null, assigneeName: null, departmentId: 'dept-1', departmentName: 'Operations', attendeeCount: 0,
  visibility: 'team', sourceModule: null, sourceRef: null, sourceRoute: null, sourceLabel: null, sourceDepartment: 'calendar', sourceDepartmentLabel: 'Calendar',
  recurrenceSeriesId: null, recurrenceRule: null, occurrenceDate: null, editable: true, completable: true, assignable: true, cancelable: true, drillThrough: false,
};
const TOOLBOX_ITEM: CalendarItemDTO = { ...item, type: 'activity', kind: 'event', sourceLabel: 'Toolbox Talk' };

function LiveCardColourHarness({ preview }: { preview: boolean }) {
  const [draft, setDraft] = useState<CalendarEditorDraftPreview | null>(null);
  return <>
    <TimeGridView mode="day" days={[new Date(2026, 8, 7, 12)]} items={[draft?.item ?? TOOLBOX_ITEM]} onOpenItem={vi.fn()} />
    <CalendarItemEditor item={TOOLBOX_ITEM} calendars={CALENDARS} preview={preview} previewCategories={preview ? CATEGORIES : []} onDraftPreview={setDraft} onPreviewSave={preview ? vi.fn() : undefined} onClose={vi.fn()} />
  </>;
}

describe('CalendarItemEditor', () => {
  beforeEach(() => {
    update.mockReset().mockResolvedValue({ success: true });
    setReminders.mockReset().mockResolvedValue({ success: true });
  });

  it('uses the governed editor drawer and saves core card fields', async () => {
    const close = vi.fn();
    const draftPreview = vi.fn();
    render(<CalendarItemEditor item={item} calendars={CALENDARS} onDraftPreview={draftPreview} onClose={close} />);

    expect(screen.getByRole('dialog', { name: 'Edit task' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'All Day' })).toBeTruthy();
    expect(screen.getByText('All-Day Event')).toBeTruthy();
    expect(screen.getByText('Schedule this item across one or more dates without assigning specific start or end times.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Assignment & Visibility' })).toBeTruthy();
    expect(screen.getByText('Assign responsibility and control who can access this task.')).toBeTruthy();
    expect(screen.getByLabelText('Repeat')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Appearance/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Recurrence & Reminders/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /People & Access/ })).toBeNull();
    expect(screen.queryByText('Department · Operations')).toBeNull();
    fireEvent.input(screen.getByLabelText(/^Title/), { target: { value: 'Review final roster' } });
    fireEvent.input(screen.getByLabelText(/^Start Time/), { target: { value: '10:15' } });
    fireEvent.input(screen.getByLabelText(/^End Time/), { target: { value: '11:45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Choose emoji' }));
    fireEvent.click(screen.getByRole('button', { name: 'Objects' }));
    fireEvent.click(screen.getByRole('gridcell', { name: 'bar chart' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Violet' }));
    await waitFor(() => expect(draftPreview).toHaveBeenLastCalledWith(expect.objectContaining({
      item: expect.objectContaining({
        id: item.id,
        title: 'Review final roster',
        titleIconType: 'emoji',
        titleIconValue: '📊',
        colorKey: 'purple',
        startsAt: localTimestamp('2026-09-07', '10:15'),
        endsAt: localTimestamp('2026-09-07', '11:45'),
      }),
    })));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const request = update.mock.calls[0]?.[0] as unknown as UpdateEntryRequest | undefined;
    expect(request?.id).toBe('task-1');
    expect(request?.patch).toMatchObject({
      title: 'Review final roster', titleIconType: 'emoji', titleIconValue: '📊', priority: 'medium', colorKey: 'purple', customColor: null,
      startsAt: localTimestamp('2026-09-07', '10:15'), endsAt: localTimestamp('2026-09-07', '11:45'),
    });
    expect(close).toHaveBeenCalled();
  });

  it('edits staged cards without calling the live mutation', async () => {
    const savePreview = vi.fn();
    const draftPreview = vi.fn();
    render(<CalendarItemEditor item={item} calendars={CALENDARS} preview previewCategories={CATEGORIES} onPreviewSave={savePreview} onDraftPreview={draftPreview} onClose={vi.fn()} />);
    fireEvent.input(screen.getByLabelText(/^Title/), { target: { value: 'Staged editor update' } });
    await waitFor(() => expect(draftPreview).toHaveBeenLastCalledWith(expect.objectContaining({ item: expect.objectContaining({ title: 'Staged editor update' }) })));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(savePreview).toHaveBeenCalledWith(item, expect.objectContaining({ title: 'Staged editor update' }), { people: [], reminderOffsets: [] }));
    expect(update).not.toHaveBeenCalled();
  });

  it.each([false, true])('updates a %s card colour on the grid before save', async preview => {
    const { container } = render(<LiveCardColourHarness preview={preview} />);
    const card = () => container.querySelector<HTMLElement>('[data-calendar-item-id="task-1"]')!;

    expect(card().classList.contains('tone-amber')).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Violet' }));

    await waitFor(() => expect(card().classList.contains('tone-purple')).toBe(true));
    expect(card().classList.contains('tone-navy')).toBe(false);
  });

  it('keeps a staged draft intact across parent renders and saves its category and reminder', async () => {
    const savePreview = vi.fn();
    const people = [{ id: 'person-1', name: 'Alicia Moore' }];
    const view = render(<CalendarItemEditor item={item} calendars={CALENDARS} preview previewCategories={CATEGORIES} previewPeople={people} previewReminderOffset={15} onPreviewSave={savePreview} onClose={vi.fn()} />);

    fireEvent.input(screen.getByLabelText(/^Title/), { target: { value: 'Day view staged update' } });
    view.rerender(<CalendarItemEditor item={item} calendars={CALENDARS} preview previewCategories={CATEGORIES} previewPeople={[...people]} previewReminderOffset={15} onPreviewSave={savePreview} onClose={vi.fn()} />);
    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe('Day view staged update');

    fireEvent.click(screen.getByLabelText(/^Category/));
    fireEvent.pointerDown(screen.getByRole('option', { name: 'General' }));
    fireEvent.click(screen.getByLabelText('Reminder'));
    fireEvent.pointerDown(screen.getByRole('option', { name: '1 hour before' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(savePreview).toHaveBeenCalledWith(
      item,
      expect.objectContaining({ title: 'Day view staged update', categoryId: CATEGORIES[1]!.id }),
      { people: [], reminderOffsets: [60] },
    ));
  });

  it('uses an agenda-oriented field only for meetings', () => {
    render(<CalendarItemEditor item={{ ...item, type: 'activity', kind: 'meeting' }} calendars={CALENDARS} preview onPreviewSave={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByLabelText(/^What we’ll cover/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Description/)).toBeNull();
  });

  it('sends only occurrence-owned fields when editing one recurrence', async () => {
    render(<CalendarItemEditor
      item={{ ...item, recurrenceRule: 'FREQ=WEEKLY', recurrenceSeriesId: 'series-1', occurrenceDate: '2026-09-07' }}
      calendars={CALENDARS}
      onClose={vi.fn()}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'This occurrence' }));
    fireEvent.input(screen.getByLabelText(/^Title/), { target: { value: 'One-off roster review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const request = update.mock.calls[0]?.[0] as unknown as UpdateEntryRequest | undefined;
    expect(request).toMatchObject({ id: 'task-1', scope: 'occurrence', occurrenceDate: '2026-09-07' });
    expect(request?.patch).toMatchObject({ title: 'One-off roster review' });
    expect(request?.patch).not.toHaveProperty('priority');
    expect(request?.patch).not.toHaveProperty('visibility');
    expect(request?.patch).not.toHaveProperty('departmentId');
    expect(request?.patch).not.toHaveProperty('calendarId');
    expect(request?.patch).not.toHaveProperty('categoryId');
    expect(setReminders).not.toHaveBeenCalled();
  });
});
