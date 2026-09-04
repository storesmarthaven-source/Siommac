/**
 * src/ui/components/Skeleton.tsx
 *
 * Site-wide loading placeholders. Composable: one atomic shimmer block plus
 * presets for the common content shapes (text, table body, avatar+text list,
 * label/value fields, stat-card grid).
 *
 * USE ONLY ON THE COLD PATH — when there is genuinely NO data to show yet. Where
 * cached or placeholder data exists, render the REAL data instead; never hide
 * real content behind a shimmer, and never show a fabricated value (a "0") while
 * loading. Gate with `loading={q.isLoading && !q.data}` (or the record-id gate
 * from useRecordQuery for detail surfaces).
 *
 *   <Skeleton />                        one shimmer block (defaults 100% × 12)
 *   <Skeleton circle width={38}/>       avatar placeholder
 *   <SkeletonText lines={3}/>           stacked text lines (last one shorter)
 *   <TableSkeleton rows={8} cols={5}/>  table body (<tr><td>…) — drops into <tbody>
 *   <TableSkeleton firstCellAvatar/>    first cell mimics an avatar+two-line cell
 *   <ListSkeleton rows={6}/>            avatar + two-line rows
 *   <SkeletonFields rows={4}/>          label/value field rows (FieldList/DetailGrid)
 *   <SkeletonStatGrid count={4}/>       N stat-card shells (KPI rows)
 *   <WorkspaceSkeleton columns={7}/>    full command-bar + grid + inspector page
 *
 * Styled by `.ui-skeleton*` in assets/styles/uikit-layout.css. Honours
 * prefers-reduced-motion (swaps the sweep for a gentle pulse). aria-hidden — the
 * loading state is announced by the region's own aria-busy/status, not each block.
 */

import { type VNode, type CSSProperties } from 'preact';

type SizeValue = number | string;

const dim = (v: SizeValue | undefined): string | undefined =>
  v === undefined ? undefined : typeof v === 'number' ? `${v}px` : v;

export interface SkeletonProps {
  width?:  SizeValue;
  height?: SizeValue;
  radius?: SizeValue;
  /** Render a circle (avatar). Uses `width` (or `height`, default 38px) as the diameter. */
  circle?: boolean;
  class?:  string;
  style?:  CSSProperties;
}

// `width`/`height` are deliberately NOT defaulted in the signature: defaulting `width` to
// '100%' made the documented circle fallback ("uses `width`, or `height`, default 38px")
// unreachable, because `width ?? height ?? 38` could never get past the first operand. The
// defaults belong to the branch that actually wants them.
export function Skeleton({ width, height, radius, circle, class: cls, style }: SkeletonProps): VNode {
  const s: CSSProperties = Object.assign({}, style);
  if (circle) {
    const d = dim(width ?? height ?? 38);
    s.width = d; s.height = d;
  } else {
    s.width  = dim(width ?? '100%');
    s.height = dim(height ?? 12);
    if (radius !== undefined) s.borderRadius = dim(radius);
  }
  return <span class={`ui-skeleton${circle ? ' ui-skeleton--circle' : ''}${cls ? ` ${cls}` : ''}`} style={s} aria-hidden="true" />;
}

export interface SkeletonTextProps {
  lines?:     number;
  /** Width of the full-length lines. */
  width?:     SizeValue;
  /** Width of the last (shorter) line — gives the "paragraph" look. */
  lastWidth?: SizeValue;
  gap?:       number;
}

export function SkeletonText({ lines = 3, width = '100%', lastWidth = '60%', gap = 8 }: SkeletonTextProps): VNode {
  return (
    <span class="ui-skeleton-text" style={{ display: 'flex', flexDirection: 'column', gap: `${gap}px` }}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={12} radius={999} width={lines > 1 && i === lines - 1 ? lastWidth : width} />
      ))}
    </span>
  );
}

export interface TableSkeletonProps {
  rows?: number;
  cols:  number;
  /** First cell mimics an avatar + two text lines (matches register rows with avatars). */
  firstCellAvatar?: boolean;
}

/** Table-body placeholder — emits <tr><td><Skeleton/></td>… so it drops straight
 *  into an existing <tbody> in place of the real rows. */
export function TableSkeleton({ rows = 8, cols, firstCellAvatar = false }: TableSkeletonProps): VNode {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} class="ui-skeleton-row" aria-hidden="true">
          {Array.from({ length: cols }, (_, c) => (
            <td key={c}>
              {firstCellAvatar && c === 0 ? (
                <div class="ui-skeleton-cell--avatar">
                  <Skeleton circle width={34} />
                  <div class="ui-skeleton-avatar-lines">
                    <Skeleton width="70%" height={11} radius={999} />
                    <Skeleton width="46%" height={10} radius={999} />
                  </div>
                </div>
              ) : (
                <Skeleton width={c === cols - 1 ? 32 : '70%'} height={12} radius={999} />
              )}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export interface ListSkeletonProps {
  rows?:   number;
  avatar?: boolean;
}

/** Avatar + two-line rows — for feeds, recipient lists, message/notification rows. */
export function ListSkeleton({ rows = 6, avatar = true }: ListSkeletonProps): VNode {
  return (
    <div class="ui-skeleton-list" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} class="ui-skeleton-list-row">
          {avatar && <Skeleton circle width={36} />}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
            <Skeleton height={12} width="45%" radius={999} />
            <Skeleton height={10} width="72%" radius={999} />
          </div>
        </div>
      ))}
    </div>
  );
}

export interface SkeletonFieldsProps {
  rows?: number;
  class?: string;
}

/** Label/value field rows — for FieldList / DetailGrid / drawer overview loading. */
export function SkeletonFields({ rows = 4, class: cls }: SkeletonFieldsProps): VNode {
  return (
    <div class={`ui-skeleton-fields${cls ? ` ${cls}` : ''}`} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} class="ui-skeleton-field-row">
          <Skeleton width={96} height={11} radius={999} />
          <Skeleton width={i % 2 === 0 ? '72%' : '54%'} height={12} radius={999} />
        </div>
      ))}
    </div>
  );
}

export interface SkeletonStatGridProps {
  count?: number;
  class?: string;
}

export interface WorkspaceSkeletonProps {
  /** Include the page-header placeholder. Set false when the owning page can
   *  keep its real, static PageHeader visible during the cold data load. */
  pageHeader?: boolean;
  /** Number of repeated data columns after the identity column. */
  columns?: number;
  /** Number of visually separated row groups. */
  groups?: number;
  /** Rows rendered inside each group. */
  rowsPerGroup?: number;
  /** Compact controls rendered beside the search field. */
  filters?: number;
  inspector?: boolean;
  footer?: boolean;
  /** Number of actions in the sticky/footer action group. */
  footerActions?: number;
  class?: string;
}

/**
 * Full cold-state for dense operational pages. Unlike a stack of arbitrary
 * grey rectangles, this preserves the geometry of the page header, command
 * scope, toolbar, grouped data grid, contextual inspector and action bar.
 * Pages configure density; they do not maintain a second skeleton engine.
 */
export function WorkspaceSkeleton({
  pageHeader = true,
  columns = 7,
  groups = 3,
  rowsPerGroup = 1,
  filters = 3,
  inspector = true,
  footer = true,
  footerActions = 4,
  class: cls,
}: WorkspaceSkeletonProps): VNode {
  return (
    <section
      class={`ui-workspace-skeleton${inspector ? ' ui-workspace-skeleton--inspector' : ''}${cls ? ` ${cls}` : ''}`}
      role="status"
      aria-busy="true"
      aria-label="Loading workspace"
      style={{
        '--ui-skeleton-columns': Math.max(1, columns),
        '--ui-skeleton-filter-count': Math.max(1, filters),
      }}
    >
      <span class="sr-only">Loading workspace…</span>
      {pageHeader && <PageHeaderSkeleton />}
      <div class="ui-workspace-skeleton__scope">
        <div class="ui-workspace-skeleton__scope-intro">
          <Skeleton width={38} height={38} radius={9} class="ui-skeleton--navy" />
          <span>
            <Skeleton width="42%" height={13} class="ui-skeleton--navy" />
            <Skeleton width="76%" height={10} class="ui-skeleton--navy" />
            <Skeleton width="58%" height={9} class="ui-skeleton--navy" />
          </span>
        </div>
        <div class="ui-workspace-skeleton__scope-controls">
          <Skeleton class="ui-workspace-skeleton__search" height={40} />
          {Array.from({ length: filters }, (_, index) => <Skeleton key={index} height={40} />)}
        </div>
      </div>
      <div class="ui-workspace-skeleton__frame">
        <div class="ui-workspace-skeleton__main">
          <div class="ui-workspace-skeleton__toolbar"><Skeleton width={34} height={34} radius={9} /><Skeleton width="min(360px, 62%)" height={42} radius={10} /><Skeleton width={34} height={34} radius={9} /></div>
          <div class="ui-workspace-skeleton__grid">
            <div class="ui-workspace-skeleton__grid-head"><Skeleton width="48%" height={12} />{Array.from({ length: columns }, (_, index) => <span key={index}><Skeleton width={30} height={10} /><Skeleton width={20} height={14} /></span>)}</div>
            {Array.from({ length: groups }, (_, groupIndex) => (
              <div class="ui-workspace-skeleton__group" key={groupIndex}>
                <div class="ui-workspace-skeleton__group-label"><Skeleton width={`${42 + (groupIndex % 3) * 8}%`} height={12} /></div>
                {Array.from({ length: rowsPerGroup }, (_, rowIndex) => (
                  <div class="ui-workspace-skeleton__row" key={rowIndex}>
                    <div class="ui-workspace-skeleton__person"><Skeleton circle width={34} /><span><Skeleton width={`${72 - groupIndex * 3}%`} height={11} /><Skeleton width={`${88 - groupIndex * 8}%`} height={9} /></span></div>
                    {Array.from({ length: columns }, (_, columnIndex) => <div class="ui-workspace-skeleton__cell" key={columnIndex}><Skeleton /></div>)}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        {inspector && <aside class="ui-workspace-skeleton__inspector">
          <div class="ui-workspace-skeleton__inspector-head"><Skeleton class="ui-skeleton--navy" width="48%" height={13} /></div>
          <div class="ui-workspace-skeleton__inspector-body">
            <div class="ui-workspace-skeleton__inspector-hero"><Skeleton class="ui-skeleton--navy" width="46%" height={11} /><Skeleton class="ui-skeleton--navy" width="72%" height={16} /><Skeleton class="ui-skeleton--navy" width="58%" height={10} /></div>
            <div class="ui-workspace-skeleton__inspector-fields">
              {[
                [72, 116],
                [58, 92],
                [66, 98],
              ].map(([labelWidth, valueWidth], index) => (
                <div class="ui-workspace-skeleton__inspector-field" key={index}>
                  <Skeleton width={labelWidth} height={11} />
                  <Skeleton width={valueWidth} height={12} />
                </div>
              ))}
            </div>
            <div class="ui-workspace-skeleton__inspector-card"><Skeleton width="52%" height={13} /><Skeleton height={9} /><Skeleton height={9} /><Skeleton width="78%" height={9} /></div>
          </div>
        </aside>}
      </div>
      {footer && <div class="ui-workspace-skeleton__footer">
        <span class="ui-workspace-skeleton__footer-state"><Skeleton circle width={30} /><span><Skeleton width={132} height={11} /><Skeleton width={208} height={9} /></span></span>
        <span class="ui-workspace-skeleton__footer-actions">
          {Array.from({ length: Math.max(1, footerActions) }, (_, index) => <Skeleton key={index} width={index === 1 ? 116 : index === 2 ? 104 : 82} height={36} radius={9} />)}
        </span>
      </div>}
    </section>
  );
}

/** A KPI / stat-card row placeholder — N card shells matching the page stat row. */
export function SkeletonStatGrid({ count = 4, class: cls }: SkeletonStatGridProps): VNode {
  return (
    <div class={`ui-skeleton-stat-grid${cls ? ` ${cls}` : ''}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} class="ui-skeleton-stat-card">
          <Skeleton width="52%" height={13} radius={999} />
          <Skeleton width="36%" height={30} radius={8} />
          <SkeletonText lines={2} width="82%" lastWidth="58%" />
        </div>
      ))}
    </div>
  );
}

/** Information-density shapes a widget's cold state can take. A widget declares its
 *  own via `WidgetDef.skeletonVariant` / `LocalWidget.skeletonVariant`, otherwise it
 *  is derived from the registered `previewVariant` — see widgets/skeletonVariant.ts. */
export type WidgetSkeletonVariant = 'metric' | 'card' | 'chart' | 'list' | 'table';

export interface WidgetSkeletonProps {
  class?: string;
  variant?: WidgetSkeletonVariant;
}

/** Standard cold-state for any widget. It fills the widget cell and mirrors the
 * widget's information density without fabricating values. */
export function WidgetSkeleton({ class: cls, variant = 'card' }: WidgetSkeletonProps): VNode {
  return (
    <article
      class={`ui-widget-skeleton ui-widget-skeleton--${variant}${cls ? ` ${cls}` : ''}`}
      data-widget-content-root
      role="status"
      aria-busy="true"
    >
      <span class="sr-only">Loading widget data…</span>
      <header>
        <Skeleton circle width={34} />
        <Skeleton width="42%" height={13} radius={999} />
      </header>
      {variant === 'metric' ? (
        <>
          <Skeleton width="34%" height={34} radius={8} />
          <Skeleton width="66%" height={11} radius={999} />
        </>
      ) : variant === 'list' ? (
        <ListSkeleton rows={4} avatar={false} />
      ) : variant === 'chart' ? (
        <>
          <Skeleton width="62%" height={16} radius={999} />
          <Skeleton class="ui-widget-skeleton-chart" width="100%" height={128} radius={10} />
        </>
      ) : variant === 'table' ? (
        <div class="ui-widget-skeleton-table">
          <table><tbody><TableSkeleton rows={7} cols={6} firstCellAvatar /></tbody></table>
        </div>
      ) : (
        <SkeletonText lines={4} width="88%" lastWidth="58%" />
      )}
    </article>
  );
}

/** The page-header cold state (icon, module kicker, title, sub, primary action).
 *  Pairs with a layout-driven board skeleton to form a whole dashboard page. */
export function PageHeaderSkeleton(): VNode {
  return (
    <header class="ui-dashboard-skeleton-head" aria-hidden="true">
      <span><Skeleton circle width={42} /></span>
      <div>
        <Skeleton width={120} height={10} radius={999} />
        <Skeleton width={250} height={24} radius={8} />
        <Skeleton width={430} height={11} radius={999} />
      </div>
      <Skeleton width={150} height={38} radius={9} />
    </header>
  );
}
