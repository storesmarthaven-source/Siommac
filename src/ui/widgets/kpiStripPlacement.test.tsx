/**
 * src/ui/widgets/kpiStripPlacement.test.tsx
 *
 * The Employee Master KPI strip is a SEPARATE WidgetBoard from the main board below it, so no
 * tile can be dragged between them, which is why the single widget library has to route an added
 * widget to the right board by itself. These tests pin that routing, the strip's slot arithmetic
 * (a double-wide tile takes two), and the fact that a KPI tile is plain and carries no settings.
 */

import { render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { WIDGET_REGISTRY } from './registry';
import { isKpiTileWidget, kpiSlotsUsed, kpiStripMaxRows, kpiTileSlots, placeKpiTiles } from '@sections/HR/EmployeeMaster';
import type { WidgetInstance } from './types';

const KPI_PAGE_KEY = 'hr.employees.overview.kpis.v2';
/** A real single-slot KPI tile, used as the stand-in for one-slot placement. */
const SINGLE = 'hr.employeeMaster.activeWorkforce';

function inst(widgetId: string, x = 0, y = 0, w = 4, h = 6): WidgetInstance {
  return { instanceId: `${widgetId}#${x}-${y}`, widgetId, pageKey: KPI_PAGE_KEY, zoneId: 'main', x, y, w, h, sizeKey: 'compact', config: {} };
}
const strip = (n: number): WidgetInstance[] =>
  Array.from({ length: n }, (_, i) => inst(`kpi.${i}`, i * 4, 0));

describe('KPI strip placement', () => {
  it('fills the row left to right, then wraps to a second tile row', () => {
    // 24 columns / w4 == 6 slots per row.
    const placed = placeKpiTiles(strip(4), [inst(SINGLE)]);
    expect(placed[0]).toMatchObject({ x: 16, y: 0, w: 4, h: 6 });

    const seventh = placeKpiTiles(strip(6), [inst(SINGLE)]);
    expect(seventh[0]).toMatchObject({ x: 0, y: 6 });

    const eighth = placeKpiTiles(strip(7), [inst(SINGLE)]);
    expect(eighth[0]).toMatchObject({ x: 4, y: 6 });
  });

  it('normalises an addition to the uniform tile size', () => {
    // The library hands over an instance sized from the widget's defaultSize; the strip is
    // uniform, so placement pins w/h rather than trusting whatever arrived.
    const placed = placeKpiTiles(strip(1), [{ ...inst(SINGLE), w: 10, h: 22 }]);
    expect(placed[0]).toMatchObject({ w: 4, h: 6 });
  });

  it('places several additions into consecutive free slots', () => {
    const placed = placeKpiTiles(strip(5), [inst('a'), inst('b'), inst('c')]);
    expect(placed.map(p => [p.x, p.y])).toEqual([[20, 0], [0, 6], [4, 6]]);
  });

  it('keeps the strip one tile row until a seventh tile needs a second', () => {
    // Pinned at 6 the strip was exactly full, so an added 7th tile had nowhere to land and the
    // library would have been a control that silently did nothing.
    for (const count of [0, 1, 5, 6]) expect(kpiStripMaxRows(count), String(count)).toBe(6);
    expect(kpiStripMaxRows(7)).toBe(12);
    expect(kpiStripMaxRows(12)).toBe(12);
    expect(kpiStripMaxRows(13)).toBe(18);
  });
});

describe('a single-slot KPI tile', () => {
  const widget = WIDGET_REGISTRY.find(candidate => candidate.id === SINGLE)!;

  it('declares the uniform fixed KPI geometry the strip routes on', () => {
    // EmployeeMaster's library routing derives the destination board from exactly these three
    // facts, so a change here silently sends the tile to the wrong board.
    expect(widget.resizable).toBe(false);
    expect(widget.sizeConstraints).toMatchObject({ defaultColumns: 4, defaultRows: 6 });
    expect(widget.category).toBe('Key metrics');
  });

  it('renders a KPI tile rather than a pulse card', () => {
    const { container } = render(widget.renderPreview!({ widgetId: SINGLE, sizeKey: 'compact', config: widget.defaultConfig }));
    expect(container.querySelector('.hrew-kpi-shell')).not.toBeNull();
    expect(container.querySelector('.hrew-workplace-pulse')).toBeNull();
  });
});

describe('KPI tiles carry no settings', () => {
  const widget = WIDGET_REGISTRY.find(candidate => candidate.id === SINGLE)!;
  const shell = (config: Record<string, unknown>): HTMLElement | null =>
    render(widget.renderPreview!({ widgetId: SINGLE, sizeKey: 'compact', config }))
      .container.querySelector<HTMLElement>('.hrew-kpi-shell');

  it('declares no configurable options, so the tile shows no settings gear', () => {
    // WidgetFrame renders the gear only for `configSchema.length` — an empty schema removes the
    // control rather than hiding one that exists.
    expect(widget.configSchema).toEqual([]);
    expect(widget.defaultConfig).toEqual({});
  });

  it('renders the plain KPI shell, whatever config an old instance carries', () => {
    // A tile saved while the gradient existed can still hold gradient keys. They must not revive
    // it: the card is a plain white KPI tile like every other one on the strip.
    for (const stale of [{}, { gradient: true }, { gradientColor: '#7c3aed' }]) {
      const el = shell(stale);
      expect(el, JSON.stringify(stale)).not.toBeNull();
      expect(el?.classList.contains('is-gradient'), JSON.stringify(stale)).toBe(false);
      expect(el?.getAttribute('style'), JSON.stringify(stale)).toBeNull();
    }
  });
});

const WIDE = 'hr.employeeMaster.payrollReadinessWide';

describe('double-wide strip tiles', () => {
  it('reports slot width from the declared widget geometry', () => {
    expect(kpiTileSlots(SINGLE)).toBe(1);
    expect(kpiTileSlots(WIDE)).toBe(2);
    // Not a strip tile: resizable, or not exactly one tile row tall.
    expect(kpiTileSlots('hr.employeeMaster.lifecycleActivity')).toBe(0);
    expect(kpiTileSlots('nope.missing')).toBe(0);
    expect(isKpiTileWidget(WIDE)).toBe(true);
  });

  it('counts a double-wide tile as two slots, not one', () => {
    expect(kpiSlotsUsed([inst(SINGLE)])).toBe(1);
    expect(kpiSlotsUsed([inst(WIDE, 0, 0, 8, 6)])).toBe(2);
    expect(kpiSlotsUsed([inst(SINGLE), inst(WIDE, 4, 0, 8, 6)])).toBe(3);
  });

  it('places a double-wide tile across two slots at its declared width', () => {
    const placed = placeKpiTiles(strip(2), [inst(WIDE)]);
    expect(placed[0]).toMatchObject({ x: 8, y: 0, w: 8, h: 6 });
  });

  it('never straddles the row break — it starts the next row instead', () => {
    // Five single slots used, so only one is left in row 0. A w8 tile cannot fit there; splitting it
    // across x=20 and x=0 would make react-grid-layout shove the other tiles around.
    const placed = placeKpiTiles(strip(5), [inst(WIDE)]);
    expect(placed[0]).toMatchObject({ x: 0, y: 6, w: 8, h: 6 });
  });

  it('keeps packing after a wide tile', () => {
    const placed = placeKpiTiles(strip(2), [inst(WIDE), inst(SINGLE)]);
    expect(placed.map(p => [p.x, p.y, p.w])).toEqual([[8, 0, 8], [16, 0, 4]]);
  });

  it('grows the strip by slots, so two wide tiles plus four singles need a second row', () => {
    const items = [inst(WIDE, 0, 0, 8, 6), inst(WIDE, 8, 0, 8, 6), ...strip(4)];
    expect(kpiSlotsUsed(items)).toBe(8);
    expect(kpiStripMaxRows(kpiSlotsUsed(items))).toBe(12);
  });
});
