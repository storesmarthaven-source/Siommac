/**
 * src/ui/widgets/declarative/types.ts — the DECLARATIVE widget format (data, no code).
 *
 * A declarative widget describes WHAT to show as data — `view: { kind, … }` — instead of a
 * render function. A generic engine (DeclarativeWidgetView) renders it onto our existing
 * primitives, and an adapter (declarativeToWidgetDef) turns it into a normal WidgetDef so it
 * behaves like any registry widget. This is the format that backs installable .zip packages;
 * for now the view carries embedded sample values (great for mocking designs). Live data
 * binding (a data-source registry) is a later phase.
 */
import type { WidgetSizeKey } from '../types';
import type { RowTone } from '../inlinePrimitives';

export interface DeclMetric { kind: 'metric'; metric: string | number; supporting?: string; footer?: string }
export interface DeclDonut  { kind: 'donut';  percent: number; supporting?: string; footer?: string }
export interface DeclTrend  { kind: 'trend';  points: number[]; footer?: string }
export interface DeclBars   { kind: 'bars';   rows: { label: string; count: number }[]; footer?: string }
export interface DeclList   { kind: 'list';   rows: { primary: string; secondary?: string; right?: string; tone?: RowTone }[] }
/** A bespoke HTML+CSS(+JS) design card (rendered in a sandboxed, locked-down iframe). Static/mock.
 *  Must be authored FLUID — the card fills its cell (width/height:100%) and reflows; no fixed size.
 *  `js` runs inside the sandbox (animations/interactivity only — CSP blocks all network/app access). */
export interface DeclHtml   { kind: 'html';   html: string; css?: string; js?: string }

export type DeclarativeView = DeclMetric | DeclDonut | DeclTrend | DeclBars | DeclList | DeclHtml;

export interface DeclarativeWidgetSpec {
  id: string;
  title: string;
  description: string;
  icon: string;          // Font Awesome class
  category: string;
  tags?: string[];
  defaultSize?: WidgetSizeKey;
  allowedSizes?: WidgetSizeKey[];
  view: DeclarativeView;
}

/** A .zip package's manifest.json shape (Phase 2 install reads this). */
export interface DeclarativePackageManifest {
  name: string;
  version: string;
  widgets: DeclarativeWidgetSpec[];
}
