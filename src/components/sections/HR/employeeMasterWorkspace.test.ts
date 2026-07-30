import { describe, expect, it } from 'vitest';
import { defaultEmployeeKpiLayout, defaultEmployeeLayout } from './EmployeeMaster';
import { WIDGET_BUNDLES } from '@ui/widgets/bundles';
import { getWidgetsForPage } from '@ui/widgets';

const EXPECTED_WIDGETS = [
  'hr.employeeMaster.activeWorkforce',
  'hr.employeeMaster.recordReadiness',
  'hr.employeeMaster.hrWorkQueue',
  'hr.employeeMaster.exceptions',
  'hr.employeeMaster.departures',
  'hr.employeeMaster.lifecycleActivity',
  // Master Data Workload is NOT here any more: it became a fixed double-wide KPI strip tile, so
  // the main board's default no longer places it and Upcoming Deadlines takes the freed width.
  'enterprise.calendar.upcomingDeadlines',
];

describe('Employee Master default workspace', () => {
  it('composes fixed KPI cards on a separate 24-column board', () => {
    const layout = defaultEmployeeKpiLayout();
    const widgets = layout.zones.main ?? [];
    expect(layout.pageKey).toBe('hr.employees.overview.kpis.v2');
    expect(layout.columns).toBe(24);
    expect(widgets.map(widget => widget.widgetId)).toEqual(EXPECTED_WIDGETS.slice(0, 5));
    expect(widgets.map(widget => ({ x: widget.x, y: widget.y, w: widget.w, h: widget.h }))).toEqual([
      { x: 0, y: 0, w: 4, h: 6 }, { x: 4, y: 0, w: 4, h: 6 },
      { x: 8, y: 0, w: 4, h: 6 }, { x: 12, y: 0, w: 4, h: 6 },
      { x: 16, y: 0, w: 4, h: 6 },
    ]);
  });

  it('composes the approved live overview on the 24-column main grid above the register', () => {
    const layout = defaultEmployeeLayout();
    const widgets = layout.zones.main ?? [];
    expect(layout.pageKey).toBe('hr.employees.overview.v3');
    expect(layout.columns).toBe(24);
    expect(widgets.map(widget => widget.widgetId)).toEqual([...EXPECTED_WIDGETS.slice(5), 'hr.employees.register']);
    // Geometry is in the board's Statutory-parity units (cellHeight 6 + 12px gap → 18h − 12 px).
    // Pinned in full: a widget authored in another board's units is the exact defect this board
    // was rebuilt to remove, and only a whole-layout assertion catches it.
    expect(widgets.map(widget => ({ x: widget.x, y: widget.y, w: widget.w, h: widget.h }))).toEqual([
      { x: 0, y: 0, w: 12, h: 28 }, { x: 12, y: 0, w: 12, h: 28 },
      { x: 0, y: 28, w: 24, h: 50 },
    ]);
  });

  it('lays the main board out without overlapping tiles or overflowing 24 columns', () => {
    const widgets = defaultEmployeeLayout().zones.main ?? [];
    for (const widget of widgets) expect(widget.x + widget.w).toBeLessThanOrEqual(24);
    for (const a of widgets) {
      for (const b of widgets) {
        if (a === b) continue;
        const overlaps = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlaps, `${a.widgetId} overlaps ${b.widgetId}`).toBe(false);
      }
    }
  });

  // Asserts the INVARIANT, not a frozen list. This previously pinned an exact 12-id array, so it
  // failed every time the Essentials bundle gained a widget — which says nothing about correctness.
  // What actually matters is that a bundle never ships a dangling id: every widget it offers must
  // be registered and available on this page, or "Add N widgets" silently adds fewer than it says.
  it('ships a bundle whose every widget is registered and available on the Employee Master board', () => {
    const bundle = WIDGET_BUNDLES.find(candidate => candidate.id === 'bundle.hr.employees.essentials');
    expect(bundle).toBeDefined();
    expect(bundle!.widgetIds.length).toBeGreaterThanOrEqual(EXPECTED_WIDGETS.length);
    expect(new Set(bundle!.widgetIds).size).toBe(bundle!.widgetIds.length);   // no duplicates

    const availableIds = new Set(getWidgetsForPage(defaultEmployeeLayout().pageKey).map(w => w.id));
    expect(bundle!.widgetIds.filter(id => !availableIds.has(id))).toEqual([]);

    // The board's own default widgets must be offered by the bundle — a user who resets and then
    // adds the bundle should get at least the standard workspace back.
    expect(EXPECTED_WIDGETS.filter(id => !bundle!.widgetIds.includes(id))).toEqual([]);
  });
});
