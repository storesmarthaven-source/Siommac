// src/ui/widgets/declarative/DeclarativeWidgetView.tsx — the generic engine: render a
// declarative spec's `view` onto our primitives, OR (kind:'html') a bespoke design card inside
// a locked-down sandboxed iframe (null-origin + CSP default-src 'none' → no network/app access).
import type { VNode } from 'preact';
import { StatsCard, Card, CardHeader } from '@ui';
import { DonutPct, TrendArea, MiniBars, ListRow, WidgetList } from '../inlinePrimitives';
import type { DeclHtml, DeclarativeWidgetSpec } from './types';

// Build the isolated document for an HTML design widget. The card FILLS the cell and reflows (it
// must be authored fluid — width/height:100% + relative/container units — exactly like the built-in
// widgets; see the widget template). No scaling, no letterbox: the card's own background fills the
// cell, text is selectable. Scripts allowed but sandboxed + network blocked (CSP default-src none).
function htmlDoc(view: DeclHtml): string {
  return `<!doctype html><html><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'unsafe-inline'">`
    // Author CSS FIRST; our wrapper rules LAST so the body stays transparent (a stray
    // `html,body{background:…}` in the design can't bleed a backdrop) and the card fills the cell.
    + `<style>${view.css ?? ''}</style>`
    + `<style>html,body{margin:0!important;padding:0!important;width:100%;height:100%;background:transparent!important}`
    + `body{display:flex}body>*{flex:1 1 auto;min-width:0;box-sizing:border-box}</style></head><body>`
    + view.html
    // Package JS runs sandboxed (allow-scripts) with CSP default-src 'none' — animations/interactivity
    // only; it cannot reach the network, the parent app, or storage. Inline only (no external src).
    + (view.js ? `<script>${view.js}</script>` : '')
    + `</body></html>`;
}

export function DeclarativeWidgetView({ spec }: { spec: DeclarativeWidgetSpec }): VNode {
  const v = spec.view;
  switch (v.kind) {
    case 'metric':
      return <StatsCard icon={spec.icon} title={spec.title} metric={v.metric} supporting={v.supporting} footer={v.footer} />;
    case 'donut':
      return <StatsCard icon={spec.icon} title={spec.title} metric={`${v.percent}%`} supporting={v.supporting} chart={<DonutPct percent={v.percent} />} footer={v.footer} />;
    // A titled visual is the canonical Card with a header — `ChartCard` was a
    // fixed-prop wrapper around `.hse-spark-card` and has been deleted. The
    // title is `level={null}`: a widget in a board cell is not a document
    // section, and emitting an <h3> per cell wrecks the page's heading outline.
    case 'trend':
      return (
        <Card variant="panel" density="compact" style={{ height: '100%' }}
          header={<CardHeader title={spec.title} level={null} />}>
          <TrendArea points={v.points} />
        </Card>
      );
    case 'bars':
      return (
        <Card variant="panel" density="compact" style={{ height: '100%' }}
          header={<CardHeader title={spec.title} level={null} />}>
          <MiniBars rows={v.rows} />
        </Card>
      );
    case 'list':
      return <WidgetList loading={false} empty="No data" rows={v.rows.map((r, i) => <ListRow key={i} primary={r.primary} secondary={r.secondary} right={r.right} tone={r.tone} />)} />;
    case 'html':
      return <iframe title={spec.title} sandbox="allow-scripts" srcdoc={htmlDoc(v)} style={{ width: '100%', height: '100%', border: 0, display: 'block', background: 'transparent' }} />;
  }
}
