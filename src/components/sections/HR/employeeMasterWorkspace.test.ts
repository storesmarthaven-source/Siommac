import { describe, expect, it } from 'vitest';
import { defaultEmployeeLayout } from './EmployeeMaster';
import { WIDGET_BUNDLES } from '@ui/widgets/bundles';

const EXPECTED_WIDGETS = [
  'hr.employeeMaster.activeWorkforce',
  'hr.employeeMaster.recordReadiness',
  'hr.employeeMaster.hrWorkQueue',
  'hr.employeeMaster.exceptions',
  'hr.employeeMaster.newStarters',
  'hr.employeeMaster.departures',
  'hr.employeeMaster.workforceTrend',
  'hr.employeeMaster.workforceDistribution',
  'hr.employeeMaster.lifecycleMovement',
  'enterprise.calendar.upcomingDeadlines',
  'hr.employeeMaster.masterDataWorkload',
];

describe('Employee Master default workspace', () => {
  it('composes the approved live overview on the 24-column grid above the register', () => {
    const layout = defaultEmployeeLayout();
    const widgets = layout.zones.main ?? [];
    expect(layout.columns).toBe(24);
    expect(widgets.map(widget => widget.widgetId)).toEqual([...EXPECTED_WIDGETS, 'hr.employees.register']);
    expect(widgets.slice(0, 6).map(widget => ({ x: widget.x, y: widget.y, w: widget.w, h: widget.h }))).toEqual([
      { x: 0, y: 0, w: 4, h: 1 }, { x: 4, y: 0, w: 4, h: 1 },
      { x: 8, y: 0, w: 4, h: 1 }, { x: 12, y: 0, w: 4, h: 1 },
      { x: 16, y: 0, w: 4, h: 1 }, { x: 20, y: 0, w: 4, h: 1 },
    ]);
    expect(widgets[widgets.length - 1]).toMatchObject({ widgetId: 'hr.employees.register', x: 0, y: 10, w: 24, h: 9 });
  });

  it('ships a bundle containing only registered production workspace widgets', () => {
    const bundle = WIDGET_BUNDLES.find(candidate => candidate.id === 'bundle.hr.employees.essentials');
    expect(bundle?.widgetIds).toEqual([
      ...EXPECTED_WIDGETS.slice(0, 6),
      'hr.employeeMaster.recordQuality',
      ...EXPECTED_WIDGETS.slice(6),
    ]);
  });
});
