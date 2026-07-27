import { fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  status: vi.fn(),
  cancel: vi.fn(),
  can: vi.fn(),
}));

vi.mock('@api/calendar', () => ({
  useCalendarList: (request: unknown) => H.list(request),
  useCreateTask: () => ({ mutateAsync: H.create, isPending: false }),
  useTaskStatus: () => ({ mutateAsync: H.status, isPending: false }),
  useCancelEntry: () => ({ mutateAsync: H.cancel, isPending: false }),
}));
vi.mock('@lib/permissions', () => ({ can: (permission: string) => H.can(permission) }));
vi.mock('@components/nav/navCore', () => ({ showSection: vi.fn() }));

import { WIDGET_REGISTRY } from './registry';
import type { WidgetRenderProps } from './types';

const props: WidgetRenderProps = {
  widgetId: 'test', instanceId: 'instance', pageKey: 'hr.employees.overview', zoneId: 'main', sizeKey: 'standard', config: {},
};

describe('calendar planning widgets', () => {
  beforeEach(() => {
    H.list.mockReset();
    H.create.mockReset();
    H.status.mockReset();
    H.cancel.mockReset();
    H.can.mockReset();
    H.can.mockReturnValue(true);
    H.list.mockReturnValue({ data: [], isLoading: false, isError: false, error: null });
    H.create.mockResolvedValue({ success: true, id: 'task-1' });
    H.status.mockResolvedValue({ success: true });
    H.cancel.mockResolvedValue({ success: true });
  });

  it('loads deadlines only from the authenticated Calendar list and fails closed', () => {
    H.list.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error('Unauthorized') });
    const definition = WIDGET_REGISTRY.find(widget => widget.id === 'enterprise.calendar.upcomingDeadlines')!;
    const Live = definition.render;
    render(<Live {...props} widgetId={definition.id} />);
    expect(H.list).toHaveBeenCalledWith(expect.objectContaining({ types: ['deadline', 'activity'] }));
    expect(screen.getByRole('alert').textContent).toContain('Unauthorized');
    expect(screen.queryByText('NIS Contribution Remittance')).toBeNull();
  });

  it('keeps catalogue previews representative and independent of live API state', () => {
    const definition = WIDGET_REGISTRY.find(widget => widget.id === 'enterprise.calendar.upcomingDeadlines')!;
    const Preview = definition.renderPreview!;
    const { container } = render(<Preview widgetId={definition.id} sizeKey="standard" config={{}} />);
    expect(screen.getByText('NIS Contribution Remittance')).toBeTruthy();
    expect(container.querySelector('.sdb-card.sdb-ch.sdb-cal.sdb-wgt-fill')).toBeTruthy();
    expect(container.querySelector('.sdb-cal-strip')).toBeTruthy();
    expect(container.querySelector('.sdb-cal-list-tabs')).toBeTruthy();
    expect(container.querySelector('.dsn-rows .dsn-row')).toBeTruthy();
    expect(H.list).not.toHaveBeenCalled();
  });

  it('switches the deadline layout from the widget config (design setting)', () => {
    const definition = WIDGET_REGISTRY.find(widget => widget.id === 'enterprise.calendar.upcomingDeadlines')!;
    const Preview = definition.renderPreview!;
    const { container } = render(<Preview widgetId={definition.id} sizeKey="standard" config={{ design: 'summary' }} />);
    expect(container.querySelector('.dsn-stats')).toBeTruthy();
    const design = definition.configSchema.find(field => field.key === 'design');
    expect(design?.options?.every(option => typeof option.description === 'string' && option.description.length > 0)).toBe(true);
  });

  it('creates a personal calendar task from the preserved task-planner composer', async () => {
    const definition = WIDGET_REGISTRY.find(widget => widget.id === 'enterprise.calendar.taskPlanner')!;
    const Live = definition.render;
    render(<Live {...props} widgetId={definition.id} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add Task' }));
    fireEvent.input(screen.getByPlaceholderText('Task title'), { target: { value: 'Call employee' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(H.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Call employee', visibility: 'personal', allDay: true })));
  });

  it('fails closed when authorised task data cannot be loaded', () => {
    H.list.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: new Error('Forbidden') });
    const definition = WIDGET_REGISTRY.find(widget => widget.id === 'enterprise.calendar.taskPlanner')!;
    const Live = definition.render;
    render(<Live {...props} widgetId={definition.id} />);
    expect(H.list).toHaveBeenCalledWith(expect.objectContaining({ types: ['task', 'deadline'] }));
    expect(screen.getByRole('alert').textContent).toContain('Forbidden');
    expect(screen.queryByText('Nothing scheduled for this date.')).toBeNull();
  });

  it('hides the personal-task action when its capability is absent', () => {
    H.can.mockReturnValue(false);
    const definition = WIDGET_REGISTRY.find(widget => widget.id === 'enterprise.calendar.taskPlanner')!;
    const Live = definition.render;
    render(<Live {...props} widgetId={definition.id} />);
    expect(screen.queryByRole('button', { name: 'Add Task' })).toBeNull();
  });
});
