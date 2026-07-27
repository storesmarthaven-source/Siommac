import { fireEvent, render, screen } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';
import { WidgetCatalog } from './WidgetCatalog';
import type { WidgetDef } from './types';

function catalogueWidget(id: string, title: string, category: string): WidgetDef {
  return {
    id, module: 'hr', area: 'Employee Master', title, description: `${title} description`,
    icon: 'fa-chart-line', category, tags: [], previewVariant: 'metric', supportedPages: ['hr.employees.overview'],
    supportedZones: ['main'], defaultSize: 'standard', allowedSizes: [{ key: 'standard', label: 'Standard', grid: { w: 4, h: 4 } }],
    defaultConfig: {}, configSchema: [], dataSource: { sourceKey: 'preview', label: 'Preview', permissions: [] },
    runtimeState: 'static-preview', governance: { state: 'preview', discoverable: true },
    render: () => <div>{title} content</div>, renderPreview: () => <div>{title} preview</div>,
  };
}

const widgets = [
  catalogueWidget('hr.alpha', 'Weekly activity', 'Activity & trends'),
  catalogueWidget('hr.beta', 'Workload', 'Work management'),
];

describe('widget catalogue actions and grouping', () => {
  it('shows per-card preview/add actions without normal-mode selection controls', () => {
    const onPreview = vi.fn();
    const onAdd = vi.fn();
    render(<WidgetCatalog widgets={widgets} pageKey="hr.employees.overview" selectedWidgetId={null}
      placedIds={new Set()} lockedIds={new Set()} onSelect={vi.fn()} onToggleMulti={vi.fn()}
      onPreview={onPreview} onAdd={onAdd} />);

    expect(screen.getByRole('button', { name: /human resources/i })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Preview on board' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Add widget' })).toHaveLength(2);
    expect(screen.queryByLabelText('Select Weekly activity')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Preview on board' })[0]!);
    fireEvent.click(screen.getAllByRole('button', { name: 'Add widget' })[1]!);
    expect(onPreview).toHaveBeenCalledWith(widgets[0]);
    expect(onAdd).toHaveBeenCalledWith(widgets[1]);
  });

  it('replaces card actions with explicit selection controls in multi-select mode', () => {
    const onToggleMulti = vi.fn();
    render(<WidgetCatalog widgets={widgets} pageKey="hr.employees.overview" selectedWidgetId={null}
      placedIds={new Set()} lockedIds={new Set()} multiSelect multiSelectedIds={new Set(['hr.alpha'])}
      onSelect={vi.fn()} onToggleMulti={onToggleMulti} onPreview={vi.fn()} onAdd={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Preview on board' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add widget' })).toBeNull();
    expect(screen.getByLabelText('Deselect Weekly activity').getAttribute('aria-pressed')).toBe('true');
    const workloadSelector = screen.getAllByLabelText('Select Workload').find(element => element.tagName === 'BUTTON');
    expect(workloadSelector).toBeTruthy();
    fireEvent.click(workloadSelector!);
    expect(onToggleMulti).toHaveBeenCalledWith(widgets[1]);
  });

  it('keeps the module group collapsible with its widget count', () => {
    render(<WidgetCatalog widgets={widgets} pageKey="hr.employees.overview" selectedWidgetId={null}
      placedIds={new Set()} lockedIds={new Set()} onSelect={vi.fn()} onToggleMulti={vi.fn()}
      onPreview={vi.fn()} onAdd={vi.fn()} />);
    const moduleButton = screen.getByRole('button', { name: /human resources/i });
    expect(moduleButton.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(moduleButton);
    expect(moduleButton.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Weekly activity preview')).toBeNull();
  });

  it('uses preview shape rather than board area for compact catalogue placement', () => {
    const compact = { ...catalogueWidget('hr.compact', 'Compact', 'Health'), previewAspect: 1.1,
      allowedSizes: [{ key: 'standard' as const, label: 'Standard', grid: { w: 16, h: 6 } }] };
    const wide = { ...catalogueWidget('hr.wide', 'Wide', 'Health'), previewAspect: 2.1 };
    const { container } = render(<WidgetCatalog widgets={[compact, wide]} pageKey="hr.employees.overview" selectedWidgetId={null}
      placedIds={new Set()} lockedIds={new Set()} onSelect={vi.fn()} onToggleMulti={vi.fn()}
      onPreview={vi.fn()} onAdd={vi.fn()} />);
    expect(container.querySelector('[data-widget-id="hr.compact"]')?.classList.contains('catalogue-compact')).toBe(true);
    expect(container.querySelector('[data-widget-id="hr.wide"]')?.classList.contains('catalogue-wide')).toBe(true);
  });
});
