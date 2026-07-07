// src/ui/widgets/registry.test.ts — guards the registry mechanics (self-registration via
// import.meta.glob, uniqueness, page filtering) and the declarative adapter, independent
// of any specific widget content. The catalogue was cleared for a rebuild (no
// registry.<name>.tsx content packages exist yet) — these tests hold trivially for an
// empty registry and will keep holding once real widgets are authored again.
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
    // No widgets declare this page (catalogue is empty), so the filter must return [].
    expect(getWidgetsForPage('hr.employees.overview')).toEqual([]);
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
