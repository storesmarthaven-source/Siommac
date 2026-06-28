// src/ui/widgets/registry.test.ts — guards the self-registration: every registry.<name>.tsx
// package must be auto-collected via import.meta.glob (a broken glob would silently empty the
// library). Also asserts the format invariants (unique ids, page filtering).
import { describe, it, expect } from 'vitest';
import { WIDGET_REGISTRY, findWidgetDef, getWidgetsForPage } from './registry';

describe('widget registry self-registration', () => {
  it('auto-collects every registry.<name>.tsx package', () => {
    expect(WIDGET_REGISTRY.length).toBeGreaterThan(0);
    // a widget from registry.hr.tsx AND one from registry.hrEmployees.tsx → both packages loaded
    expect(findWidgetDef('hr.onboarding.activeCases')).toBeTruthy();
    expect(findWidgetDef('hr.employees.activeWorkforce')).toBeTruthy();
  });

  it('has unique widget ids', () => {
    const ids = WIDGET_REGISTRY.map(w => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('filters widgets by supported page', () => {
    const onb = getWidgetsForPage('hr.onboarding.overview').map(w => w.id);
    expect(onb).toContain('hr.onboarding.activeCases');
    expect(onb).not.toContain('hr.employees.activeWorkforce');
  });
});

describe('declarative widgets', () => {
  it('registers declarative sample widgets via the adapter', () => {
    // proves declarativeToWidgetDef produces valid WidgetDefs that self-register
    expect(findWidgetDef('custom.sample.metric')).toBeTruthy();
    const list = findWidgetDef('custom.sample.list');
    expect(list).toBeTruthy();
    expect(list?.chrome).toBe('standard'); // list = framed
    expect(findWidgetDef('custom.sample.metric')?.chrome).toBe('none'); // metric brings its own card
  });
});
