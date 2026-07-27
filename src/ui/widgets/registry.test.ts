// src/ui/widgets/registry.test.ts — guards the registry mechanics (self-registration via
// import.meta.glob, uniqueness, page filtering) and the declarative adapter.
import { cleanup, render, screen } from '@testing-library/preact';
import { QueryClient, QueryClientProvider } from '@tanstack/preact-query';
import { h } from 'preact';
import { afterEach, describe, it, expect } from 'vitest';
import { WIDGET_REGISTRY, getWidgetsForPage } from './registry';
import { normalizePageKey } from './governance';
import { declarativeToWidgetDef } from './declarative/declarativeToWidgetDef';
import type { DeclarativeWidgetSpec } from './declarative/types';

afterEach(() => cleanup());

describe('widget registry mechanics', () => {
  it('collects widgets via import.meta.glob into an array', () => {
    expect(Array.isArray(WIDGET_REGISTRY)).toBe(true);
  });

  it('has unique widget ids', () => {
    const ids = WIDGET_REGISTRY.map(w => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('filters widgets by supported page', () => {
    expect(getWidgetsForPage('hr.employees.overview').map(widget => widget.id)).toEqual([
      'enterprise.calendar.upcomingDeadlines',
      'enterprise.calendar.taskPlanner',
      'hr.employeeMaster.activeWorkforce',
      'hr.employeeMaster.recordReadiness',
      'hr.employeeMaster.hrWorkQueue',
      'hr.employeeMaster.exceptions',
      'hr.employeeMaster.newStarters',
      'hr.employeeMaster.departures',
      'hr.employeeMaster.recordQuality',
      'hr.employeeMaster.employeeAttentionNeutral',
      'hr.employeeMaster.monthlyHiresCard',
      'hr.employeeMaster.internalMovesCard',
      'hr.employeeMaster.promotionsCard',
      'hr.employeeMaster.readinessRadar',
      'hr.employeeMaster.lifecycleOutcomes',
      'hr.employeeMaster.blockedActions',
      'hr.employeeMaster.recordHealth',
      'hr.employeeMaster.recordRisk',
      'hr.employeeMaster.weeklyActivity',
      'hr.employeeMaster.changeTrend',
      'hr.employeeMaster.lifecycleActivity',
      'hr.employeeMaster.adminWorkload',
      // supportedPages:['*'] — offered on every board, like the calendar widgets above.
      'platform.weather.current',
      'platform.weather.strip',
      'platform.weather.precipitation',
      'platform.weather.uv',
      'platform.weather.wind',
    ]);
  });

  it('keeps versioned page keys and application-wide calendar widgets discoverable', () => {
    expect(getWidgetsForPage('hr.employees.overview.v2').map(widget => widget.id)).toContain('hr.employeeMaster.activeWorkforce');
    expect(getWidgetsForPage('hr.employees.overview.kpis.v2').map(widget => widget.id)).toContain('hr.employeeMaster.recordReadiness');
    expect(getWidgetsForPage('finance.statutory.v2').map(widget => widget.id)).toContain('enterprise.calendar.upcomingDeadlines');
  });

  // Six: `lifecycleActivity` was promoted from a static preview to a live-api widget, and
  // `readinessGoal` + `quickContact` were retired from the catalogue.
  it('registers the six approved Employee Master design previews', () => {
    const employeeMaster = WIDGET_REGISTRY.filter(widget => widget.area === 'Employee Master' && widget.runtimeState === 'static-preview');
    expect(employeeMaster).toHaveLength(6);
    for (const widget of employeeMaster) {
      expect(widget.runtimeState).toBe('static-preview');
      expect(widget.governance).toMatchObject({ state: 'preview', discoverable: true });
      expect(widget.permissions?.requiredPermissions).toEqual(['hr.employees.view']);
      expect(widget.motion).toMatchObject({ reducedMotion: 'static' });
      expect(widget.renderPreview).toBeTypeOf('function');
      expect(widget.renderPreview).toBe(widget.render);
      expect(widget.contentPriorityRules?.length).toBeGreaterThan(0);
      expect(widget.densityRules).toBeDefined();
      expect(widget.sizeConstraints).toMatchObject({ resizeStrategy: 'content-measured' });
      expect(widget.sizeConstraints?.minColumns).toBeGreaterThanOrEqual(2);
      expect(widget.sizeConstraints?.minRows).toBeGreaterThanOrEqual(3);
      expect(widget.sizeConstraints?.minWidth).toBeGreaterThanOrEqual(240);
      expect(widget.sizeConstraints?.minHeight).toBeGreaterThanOrEqual(260);
    }
  });

  it('registers the live Employee Master workspace against one authenticated API contract', () => {
    const ids = [
      'hr.employeeMaster.activeWorkforce', 'hr.employeeMaster.recordReadiness',
      'hr.employeeMaster.hrWorkQueue', 'hr.employeeMaster.exceptions',
      'hr.employeeMaster.newStarters', 'hr.employeeMaster.departures',
      'hr.employeeMaster.recordQuality',
      'hr.employeeMaster.monthlyHiresCard',
      'hr.employeeMaster.internalMovesCard', 'hr.employeeMaster.promotionsCard',
    ];
    const live = WIDGET_REGISTRY.filter(widget => ids.includes(widget.id));
    expect(live).toHaveLength(ids.length);
    for (const widget of live) {
      expect(widget).toMatchObject({
        runtimeState: 'live-api', dataSourceKey: 'hr.employee-master.dashboard',
        governance: { state: 'enabled', discoverable: true, requiredCapabilities: ['hr.employees.view'] },
        permissions: { requiredPermissions: ['hr.employees.view'] },
      });
      expect(widget.renderPreview).not.toBe(widget.render);
      // Compare NORMALISED: the board's layout version (`.v3`) is not part of a widget's identity,
      // and asserting the literal would make every future version bump a test failure.
      expect(widget.recommendedFor?.map(normalizePageKey)).toEqual(['hr.employees.overview']);
    }
    const kpis = live.filter(widget => widget.category === 'Key metrics');
    expect(kpis).toHaveLength(4);
    for (const widget of kpis) {
      expect(widget.resizable).toBe(false);
      expect(widget.previewAspect).toBeUndefined();
      expect(widget.allowedSizes).toEqual([{ key: 'compact', label: 'Fixed', grid: { w: 4, h: 6 }, min: { w: 4, h: 6 }, max: { w: 4, h: 6 }, description: 'Statutory-size Employee Master KPI tile' }]);
      expect(widget.sizeConstraints).toMatchObject({ defaultColumns: 4, defaultRows: 6, minColumns: 4, minRows: 6, minWidth: 180, minHeight: 84, resizeStrategy: 'fixed-minimum' });
    }
  });

  it('registers the reference-derived Employee Master widgets with live sources and responsive floors', () => {
    // Two DIFFERENT size families — they were previously asserted with one shared expectation,
    // which cannot hold: a KPI tile is FIXED (one preset, min == max, so `resizable: false` is
    // legal), whereas a pulse card offers three presets and therefore must stay resizable —
    // defineWidget rejects a non-resizable widget that does not pin min and max (FIXED_WIDGET_UNPINNED_SIZE).
    const kpiIds = ['hr.employeeMaster.activeWorkforce', 'hr.employeeMaster.recordReadiness', 'hr.employeeMaster.hrWorkQueue', 'hr.employeeMaster.exceptions', 'hr.employeeMaster.newStarters', 'hr.employeeMaster.departures'];
    const pulseIds = ['hr.employeeMaster.monthlyHiresCard', 'hr.employeeMaster.internalMovesCard', 'hr.employeeMaster.promotionsCard'];
    const largeStatsIds = ['hr.employeeMaster.recordQuality', 'hr.employeeMaster.readinessRadar', 'hr.employeeMaster.lifecycleOutcomes'];
    const statsIds = [...kpiIds, ...pulseIds, ...largeStatsIds];
    for (const id of statsIds) expect(WIDGET_REGISTRY.find(widget => widget.id === id), id).toMatchObject({ runtimeState: 'live-api', dataSourceKey: 'hr.employee-master.dashboard' });
    for (const id of kpiIds) {
      const widget = WIDGET_REGISTRY.find(candidate => candidate.id === id)!;
      expect(widget).toMatchObject({ resizable: false, sizeConstraints: { defaultColumns: 4, defaultRows: 6, minColumns: 4, minRows: 6, minWidth: 180, minHeight: 84, resizeStrategy: 'fixed-minimum' } });
      expect(widget.previewAspect).toBeUndefined();
    }
    for (const id of pulseIds) {
      const widget = WIDGET_REGISTRY.find(candidate => candidate.id === id)!;
      expect(widget).toMatchObject({ resizable: true, sizeConstraints: { defaultColumns: 4, defaultRows: 6, minColumns: 3, minRows: 6, minWidth: 160, minHeight: 84, resizeStrategy: 'fixed-minimum' } });
      expect(widget.allowedSizes).toHaveLength(3);
      expect(widget.previewAspect).toBeUndefined();
    }
    for (const id of largeStatsIds) expect(WIDGET_REGISTRY.find(widget => widget.id === id)?.resizable, id).toBe(true);
    for (const id of ['hr.employeeMaster.employeeAttentionNeutral']) {
      const widget = WIDGET_REGISTRY.find(candidate => candidate.id === id);
      expect(widget).toMatchObject({ runtimeState: 'live-api', dataSourceKey: 'hr.employee-master.directory', category: 'Actions & workload', permissions: { requiredPermissions: ['hr.employees.view'] } });
      expect(widget?.recommendedFor).toBeUndefined();
    }
    expect(WIDGET_REGISTRY.find(widget => widget.id === 'hr.employeeMaster.readinessRadar')?.sizeConstraints).toMatchObject({ defaultColumns: 7, minColumns: 5, minRows: 12, minWidth: 275, minHeight: 388, resizeStrategy: 'fixed-minimum' });
  });


  it('renders the supplied neutral employee attention design', () => {
    const widget = WIDGET_REGISTRY.find(candidate => candidate.id === 'hr.employeeMaster.employeeAttentionNeutral')!;
    expect(widget).toMatchObject({ resizable: true, previewAspect: .62, sizeConstraints: { defaultColumns: 7, defaultRows: 30, minColumns: 6, minRows: 12, minWidth: 389, minHeight: 528 } });
    const { container } = render(widget.renderPreview!({ widgetId: widget.id, sizeKey: 'standard', config: {} }));
    expect(container.querySelector('.hrew-attention-reference.is-neutral')).toBeTruthy();
    expect(screen.getByLabelText('Neutral employee attention card')).toBeTruthy();
    expect(screen.getByText('Camille Rampersad')).toBeTruthy();
    expect(container.querySelector('.hrew-ar-ready-gauge')?.getAttribute('aria-label')).toBe('Record ready 0%');
    expect(screen.getByText('3 Readiness Controls Need Review')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Review Employee Record' })).toBeTruthy();
  });

  it('renders the three Workplace pulse designs as individual animated white cards', () => {
    const expected = [
      { id: 'hr.employeeMaster.monthlyHiresCard', chart: 'bars', title: 'Hires This Month', marks: 5 },
      { id: 'hr.employeeMaster.internalMovesCard', chart: 'ranges', title: 'Internal Moves', marks: 6 },
      { id: 'hr.employeeMaster.promotionsCard', chart: 'line', title: 'Promotions', marks: 6 },
    ];
    expect(WIDGET_REGISTRY.filter(widget => widget.category === 'Workforce pulse')).toHaveLength(3);
    for (const item of expected) {
      const widget = WIDGET_REGISTRY.find(candidate => candidate.id === item.id)!;
      expect(widget).toMatchObject({ title: item.title, category: 'Workforce pulse', resizable: true });
      const { container } = render(widget.renderPreview!({ widgetId: item.id, sizeKey: 'compact', config: {} }));
      const card = container.querySelector<HTMLElement>(`.hrew-workplace-pulse[data-pulse-chart="${item.chart}"]`);
      expect(card).toBeTruthy();
      expect(card?.classList.contains('hrew-workplace-pulse')).toBe(true);
      if (item.chart === 'bars') expect(container.querySelectorAll('.hrew-pulse-bars rect')).toHaveLength(item.marks);
      if (item.chart === 'ranges') expect(container.querySelectorAll('.hrew-pulse-range-values rect')).toHaveLength(item.marks);
      if (item.chart === 'line') expect(container.querySelectorAll('.hrew-pulse-points circle')).toHaveLength(item.marks);
      cleanup();
    }
  });

  it('adapts the reference scorecard into a live, resizable Record quality widget', () => {
    const widget = WIDGET_REGISTRY.find(candidate => candidate.id === 'hr.employeeMaster.recordQuality')!;
    expect(widget).toMatchObject({ category: 'Health & readiness', runtimeState: 'live-api', resizable: true, previewAspect: .78 });
    expect(widget.sizeConstraints).toMatchObject({ defaultColumns: 7, defaultRows: 28, minColumns: 6, minRows: 12, minWidth: 280, minHeight: 360, resizeStrategy: 'content-measured' });
    const { container } = render(widget.renderPreview!({ widgetId: widget.id, sizeKey: 'standard', config: {} }));
    expect(screen.getByText('Record quality')).toBeTruthy();
    expect(screen.getByText('Good records')).toBeTruthy();
    expect(container.querySelectorAll('.hrew-quality-measures > div')).toHaveLength(3);
  });

  it('renders Statutory-style drill footers on every Employee Master KPI preview', () => {
    const expected = new Map([
      // Labels name the FILTER each action applies to the register, not a vague destination —
      // clicking the count and landing on those exact rows is the point.
      ['hr.employeeMaster.activeWorkforce', 'View Active Employees'],
      ['hr.employeeMaster.recordReadiness', 'View Training Gaps'],
      ['hr.employeeMaster.hrWorkQueue', 'View Register'],
      ['hr.employeeMaster.exceptions', 'View Missing Assignments'],
    ]);
    for (const [id, label] of expected) {
      const widget = WIDGET_REGISTRY.find(candidate => candidate.id === id);
      render(widget!.renderPreview!({ widgetId: id, sizeKey: 'compact', config: {} }));
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
      cleanup();
    }
  });

  it('registers calendar-backed deadlines and task planning with separate action gates', () => {
    const deadlines = WIDGET_REGISTRY.find(widget => widget.id === 'enterprise.calendar.upcomingDeadlines');
    const tasks = WIDGET_REGISTRY.find(widget => widget.id === 'enterprise.calendar.taskPlanner');
    expect(deadlines).toMatchObject({ runtimeState: 'live-api', dataSourceKey: 'platform.calendar' });
    expect(tasks).toMatchObject({
      runtimeState: 'action-gated',
      dataSourceKey: 'platform.calendar',
      permissions: {
        requiredPermissions: ['calendar.view'],
        actions: { createPersonalTask: 'calendar.task.manage_own', completeTask: 'calendar.task.manage_own', removeTask: 'calendar.task.manage_own' },
      },
    });
    expect(deadlines?.sizeConstraints).toMatchObject({ defaultColumns: 6, defaultRows: 24, minColumns: 4, minRows: 12, minWidth: 332, minHeight: 420 });
    expect(deadlines?.allowedSizes.find(size => size.key === 'standard')?.grid).toEqual({ w: 6, h: 24 });
    expect(deadlines?.renderPreview).not.toBe(deadlines?.render);
    expect(tasks?.renderPreview).not.toBe(tasks?.render);
    expect(tasks?.defaultConfig).toEqual({ theme: 'siomac-blue' });
    expect(tasks?.configSchema.find(field => field.key === 'theme')?.options).toHaveLength(10);
  });

  it('declares a content-safe floor for Data Change Trend and uses it for its default placement', () => {
    const widget = WIDGET_REGISTRY.find(candidate => candidate.id === 'hr.employeeMaster.changeTrend');
    expect(widget?.sizeConstraints).toEqual({
      defaultColumns: 10, defaultRows: 22, minColumns: 6, minRows: 12,
      minWidth: 280, minHeight: 350, resizeStrategy: 'content-measured',
    });
    expect(widget?.allowedSizes.find(size => size.key === widget.defaultSize)?.grid).toEqual({ w: 10, h: 22 });
  });

  it('keeps Record risk monitor compact and resizable on the 24-column Employee Master board', () => {
    const widget = WIDGET_REGISTRY.find(candidate => candidate.id === 'hr.employeeMaster.recordRisk');
    expect(widget?.sizeConstraints).toEqual({
      defaultColumns: 7, defaultRows: 17, minColumns: 5, minRows: 12,
      minWidth: 240, minHeight: 260, resizeStrategy: 'content-measured',
    });
    expect(widget?.allowedSizes.find(size => size.key === 'standard')?.grid).toEqual({ w: 7, h: 17 });
  });

  it('keeps Record health and Task planner compact on the 24-column Employee Master board', () => {
    const health = WIDGET_REGISTRY.find(candidate => candidate.id === 'hr.employeeMaster.recordHealth');
    const tasks = WIDGET_REGISTRY.find(candidate => candidate.id === 'enterprise.calendar.taskPlanner');
    expect(health?.sizeConstraints).toMatchObject({ defaultColumns: 8, defaultRows: 22, minColumns: 5, minRows: 12, minHeight: 270 });
    expect(health?.allowedSizes.find(size => size.key === 'standard')?.grid).toEqual({ w: 8, h: 22 });
    expect(tasks?.defaultSize).toBe('standard');
    expect(tasks?.sizeConstraints).toMatchObject({ defaultColumns: 7, defaultRows: 22, minColumns: 6, minRows: 12, minWidth: 285, minHeight: 280 });
    expect(tasks?.allowedSizes.find(size => size.key === 'standard')?.grid).toEqual({ w: 7, h: 22 });
  });

  it('renders an accessible daily completion control in the compact task planner', () => {
    const tasks = WIDGET_REGISTRY.find(candidate => candidate.id === 'enterprise.calendar.taskPlanner');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(h(QueryClientProvider, { client }, tasks!.renderPreview!({ widgetId: tasks!.id, sizeKey: 'standard', config: {} })));
    expect(screen.getByRole('button', { name: 'Mark Review employee records complete' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Review employee records' })).toBeTruthy();
    expect(screen.getByText('Review employee records')).toBeTruthy();
  });

  it('groups the catalogue and curates a smaller recommended starting set', () => {
    const categories = new Set(WIDGET_REGISTRY.map(widget => widget.category));
    expect(categories).toEqual(new Set(['Calendar & deadlines', 'Actions & workload', 'Health & readiness', 'Activity & trends', 'Work management', 'Key metrics', 'Workforce pulse', 'Site Conditions']));
    expect(WIDGET_REGISTRY.filter(widget => widget.recommendedFor?.some(page => normalizePageKey(page) === 'hr.employees.overview')).map(widget => widget.id)).toEqual([
      'enterprise.calendar.upcomingDeadlines',
      'hr.employeeMaster.activeWorkforce',
      'hr.employeeMaster.recordReadiness',
      'hr.employeeMaster.hrWorkQueue',
      'hr.employeeMaster.exceptions',
      'hr.employeeMaster.newStarters',
      'hr.employeeMaster.departures',
      'hr.employeeMaster.recordQuality',
      'hr.employeeMaster.monthlyHiresCard',
      'hr.employeeMaster.internalMovesCard',
      'hr.employeeMaster.promotionsCard',
      'hr.employeeMaster.readinessRadar',
      'hr.employeeMaster.lifecycleOutcomes',
      // Promoted from a static design preview to a recommended live-api widget.
      'hr.employeeMaster.lifecycleActivity',
    ]);
  });

  it('keeps both-axis board resizing with a content-safe size for every widget', () => {
    for (const widget of WIDGET_REGISTRY) {
      const size = widget.allowedSizes.find(candidate => candidate.key === widget.defaultSize);
      expect(widget.sizeToContent).toBe(false);
      if (widget.previewAspect !== undefined) expect(widget.previewAspect).toBeGreaterThan(0);
      expect(size?.grid.w).toBe(widget.sizeConstraints?.defaultColumns);
      expect(size?.grid.h).toBe(widget.sizeConstraints?.defaultRows);
      expect(widget.sizeConstraints?.minColumns).toBeLessThanOrEqual(size?.grid.w ?? 0);
      expect(widget.sizeConstraints?.minRows).toBeLessThanOrEqual(size?.grid.h ?? 0);
    }
  });
});

describe('declarative adapter', () => {
  const spec: DeclarativeWidgetSpec = {
    id: 'test.declarative.metric',
    title: 'Test Metric', description: 'Adapter unit test fixture.', icon: 'fa-gauge',
    category: 'Test', tags: ['test'],
    defaultSize: 'compact', allowedSizes: ['compact', 'standard'],
    view: { kind: 'metric', metric: 42, supporting: 'test value' },
  };

  it('produces a valid WidgetDef from a declarative spec', () => {
    const def = declarativeToWidgetDef(spec);
    expect(def.id).toBe(spec.id);
    expect(def.defaultSize).toBe('compact');
    expect(def.allowedSizes.map(s => s.key)).toEqual(['compact', 'standard']);
    expect(typeof def.render).toBe('function');
  });

  it('picks chrome by view kind (metric brings its own card, list is framed)', () => {
    expect(declarativeToWidgetDef(spec).chrome).toBe('none');
    const listSpec: DeclarativeWidgetSpec = { ...spec, id: 'test.declarative.list', view: { kind: 'list', rows: [] } };
    expect(declarativeToWidgetDef(listSpec).chrome).toBe('standard');
  });
});
