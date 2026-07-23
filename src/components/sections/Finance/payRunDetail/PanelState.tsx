/**
 * PayrollPanelState (certification WP-4, P1-7) — the ONE state wrapper for every
 * query-backed payroll panel. Four truthful states:
 *   loading → accessible skeleton (fixed min-height so content doesn't shift)
 *   error   → visually distinct band with the typed code + correlation id + Retry
 *             (NEVER rendered as an empty state — an outage must not look like
 *             "No warnings" / "No data")
 *   empty   → truthful empty, shown ONLY after a successful empty response
 *   content → children, with a stale-data hint while a background refetch runs
 */
import type { ComponentChildren, VNode } from 'preact';
import { PayrollApiError } from '@api/finance/payroll';

export interface PanelStateProps {
  /** Initial load (no data yet). Background refetches do NOT re-skeleton. */
  loading: boolean;
  /** The query error (if any) — typed PayrollApiError renders code + correlation id. */
  error?: unknown;
  /** Retry callback (query refetch). */
  onRetry?: () => void;
  /** True when the query SUCCEEDED and returned nothing. */
  empty?: boolean;
  /** What is being loaded / what is empty, e.g. "run lines". */
  label: string;
  /** Empty-state message (defaults to a truthful generic). */
  emptyText?: string;
  /** True while a background refetch is running with stale data on screen. */
  stale?: boolean;
  children?: ComponentChildren;
}

export function PayrollPanelState({ loading, error, onRetry, empty, label, emptyText, stale, children }: PanelStateProps): VNode {
  if (loading) {
    return (
      <div class="prw-panel-skel" role="status" aria-busy="true" aria-label={`Loading ${label}`}>
        <span class="prw-panel-skel-bar" /><span class="prw-panel-skel-bar" /><span class="prw-panel-skel-bar" />
      </div>
    );
  }
  if (error != null) {
    const typed = error instanceof PayrollApiError ? error : null;
    const message = error instanceof Error ? error.message : `Could not load ${label}.`;
    return (
      <div class="prw-panel-error" role="alert">
        <i class="fa-solid fa-triangle-exclamation" aria-hidden="true" />
        <div class="prw-panel-error-copy">
          <strong>Couldn’t load {label}</strong>
          <small>{message}</small>
          {typed?.correlationId && (
            <small class="prw-panel-error-meta">
              {typed.code} · ref {typed.correlationId}
            </small>
          )}
        </div>
        {onRetry && <button type="button" class="btn" onClick={onRetry}>Retry</button>}
      </div>
    );
  }
  if (empty) {
    return <div class="prw-panel-empty">{emptyText ?? `No ${label} yet.`}</div>;
  }
  return (
    <>
      {stale && (
        <div class="prw-panel-stale" role="status">
          <i class="fa-solid fa-rotate fa-spin" aria-hidden="true" /> Refreshing {label}…
        </div>
      )}
      {children}
    </>
  );
}
