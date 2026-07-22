// src/ui/widgets/registry.test.ts — guards the registry mechanics (self-registration via
// import.meta.glob, uniqueness, page filtering) and the declarative adapter.
import { describe, it, expect } from 'vitest';
import { WIDGET_REGISTRY, getWidgetsForPage } from './registry';
import { declarativeToWidgetDef } from './declarative/declarativeToWidgetDef';
import type { DeclarativeWidgetSpec } from './declarative/types';

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
      'hr.employeeMaster.workforceTrend',
      'hr.employeeMaster.workforceDistribution',
      'hr.employeeMaster.lifecycleMovement',
      'hr.employeeMaster.masterDataWorkload',
      'hr.employeeMaster.blockedActions',
      'hr.employeeMaster.readinessGoal',
      'hr.employeeMaster.quickContact',
      'hr.employeeMaster.recordHealth',
      'hr.employeeMaster.recordRisk',
      'hr.employeeMaster.weeklyActivity',
      'hr.employeeMaster.changeTrend',
      'hr.employeeMaster.lifecycleActivity',
      'hr.employeeMaster.adminWorkload',
    ]);
  });

  it('registers the nine approved Employee Master design previews', () => {
    const employeeMaster = WIDGET_REGISTRY.filter(widget => widget.area === 'Employee Master' && widget.runtimeState === 'static-preview');
    expect(employeeMaster).toHaveLength(9);
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
      'hr.employeeMaster.workforceTrend', 'hr.employeeMaster.workforceDistribution',
      'hr.employeeMaster.lifecycleMovement', 'hr.employeeMaster.masterDataWorkload',
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
      expect(widget.recommendedFor).toEqual(['hr.employees.overview']);
    }
    const kpis = live.filter(widget => widget.category === 'Key metrics');
    expect(kpis).toHaveLength(4);
    for (const widget of kpis) {
      expect(widget.resizable).toBe(false);
      expect(widget.allowedSizes).toEqual([{ key: 'compact', label: 'Fixed', grid: { w: 6, h: 2 }, min: { w: 6, h: 2 }, max: { w: 6, h: 2 }, description: 'Uniform Employee Master KPI tile' }]);
      expect(widget.sizeConstraints).toMatchObject({ defaultColumns: 6, defaultRows: 2, minColumns: 6, minRows: 2, resizeStrategy: 'fixed-minimum' });
    }
    const trend = live.find(widget => widget.id === 'hr.employeeMaster.workforceTrend');
    expect(trend?.resizable).toBe(true);
    expect(trend?.allowedSizes).toHaveLength(3);
    expect(trend?.sizeConstraints).toMatchObject({ defaultColumns: 12, defaultRows: 4, minColumns: 8, minRows: 4, resizeStrategy: 'content-measured' });
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
        actions: { createPersonalTask: 'calendar.task.manage_own', completeTask: 'calendar.task.manage_own' },
      },
    });
    expect(deadlines?.sizeConstraints).toMatchObject({ defaultColumns: 7, defaultRows: 4, minColumns: 6, minRows: 4, minWidth: 285, minHeight: 380 });
    expect(deadlines?.allowedSizes.find(size => size.key === 'standard')?.grid).toEqual({ w: 7, h: 4 });
    expect(deadlines?.renderPreview).not.toBe(deadlines?.render);
    expect(tasks?.renderPreview).not.toBe(tasks?.render);
  });

  it('declares a content-safe floor for Data Change Trend and uses it for its default placement', () => {
    const widget = WIDGET_REGISTRY.find(candidate => candidate.id === 'hr.employeeMaster.changeTrend');
    expect(widget?.sizeConstraints).toEqual({
      defaultColumns: 10, defaultRows: 4, minColumns: 6, minRows: 4,
      minWidth: 280, minHeight: 350, resizeStrategy: 'content-measured',
    });
    expect(widget?.allowedSizes.find(size => size.key === widget.defaultSize)?.grid).toEqual({ w: 10, h: 4 });
  });

  it('keeps Record risk monitor compact and resizable on the 24-column Employee Master board', () => {
    const widget = WIDGET_REGISTRY.find(candidate => candidate.id === 'hr.employeeMaster.recordRisk');
    expect(widget?.sizeConstraints).toEqual({
      defaultColumns: 7, defaultRows: 3, minColumns: 5, minRows: 3,
      minWidth: 240, minHeight: 260, resizeStrategy: 'content-measured',
    });
    expect(widget?.allowedSizes.find(size => size.key === 'standard')?.grid).toEqual({ w: 7, h: 3 });
  });

  it('keeps Record health and Task planner compact on the 24-column Employee Master board', () => {
    const health = WIDGET_REGISTRY.find(candidate => candidate.id === 'hr.employeeMaster.recordHealth');
    const tasks = WIDGET_REGISTRY.find(candidate => candidate.id === 'enterprise.calendar.taskPlanner');
    expect(health?.sizeConstraints).toMatchObject({ defaultColumns: 8, defaultRows: 4, minColumns: 5, minRows: 3, minHeight: 270 });
    expect(health?.allowedSizes.find(size => size.key === 'standard')?.grid).toEqual({ w: 8, h: 4 });
    expect(tasks?.defaultSize).toBe('standard');
    expect(tasks?.sizeConstraints).toMatchObject({ defaultColumns: 8, defaultRows: 4, minColumns: 6, minRows: 4, minHeight: 340 });
    expect(tasks?.allowedSizes.find(size => size.key === 'standard')?.grid).toEqual({ w: 8, h: 4 });
  });

  it('groups the catalogue and curates a smaller recommended starting set', () => {
    const categories = new Set(WIDGET_REGISTRY.map(widget => widget.category));
    expect(categories).toEqual(new Set(['Calendar & deadlines', 'Actions & workload', 'Health & readiness', 'People & contact', 'Activity & trends', 'Work management', 'Workforce overview', 'Key metrics']));
    expect(WIDGET_REGISTRY.filter(widget => widget.recommendedFor?.includes('hr.employees.overview')).map(widget => widget.id)).toEqual([
      'enterprise.calendar.upcomingDeadlines',
      'hr.employeeMaster.activeWorkforce',
      'hr.employeeMaster.recordReadiness',
      'hr.employeeMaster.hrWorkQueue',
      'hr.employeeMaster.exceptions',
      'hr.employeeMaster.workforceTrend',
      'hr.employeeMaster.workforceDistribution',
      'hr.employeeMaster.lifecycleMovement',
      'hr.employeeMaster.masterDataWorkload',
    ]);
  });

  it('keeps both-axis board resizing with a content-safe size for every widget', () => {
    for (const widget of WIDGET_REGISTRY) {
      const size = widget.allowedSizes.find(candidate => candidate.key === widget.defaultSize);
      expect(widget.sizeToContent).toBe(false);
      expect(widget.previewAspect).toBeGreaterThan(0);
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
