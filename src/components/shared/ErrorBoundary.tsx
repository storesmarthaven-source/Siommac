/**
 * src/components/shared/ErrorBoundary.tsx
 *
 * Class-based error boundary (Preact / React API).
 * Catches synchronous render errors in the subtree and renders a fallback
 * instead of crashing the entire app.
 *
 * Enterprise guarantees:
 *   ✓ Logs every caught error through logger.ts (→ Sentry in production)
 *   ✓ Provides a retry button that resets the error state
 *   ✓ Accepts a custom `fallback` render prop for section-specific UI
 *   ✓ `onError` callback for parent-level error reporting hooks
 *   ✓ `resetKeys` prop — automatically retries when a key changes
 *     (e.g. when the user navigates to a different section)
 *
 * Usage:
 *   // Wrap every routed section:
 *   <ErrorBoundary sectionName="Attendance">
 *     <AttendanceSection />
 *   </ErrorBoundary>
 *
 *   // Custom fallback:
 *   <ErrorBoundary fallback={({ error, retry }) => <MyFallback error={error} onRetry={retry} />}>
 *     <HeavyComponent />
 *   </ErrorBoundary>
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { Component, type ComponentChildren, type VNode } from 'preact';
import { logger } from '@lib/logger';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FallbackProps {
  error:      Error;
  retry:      () => void;
  sectionName?: string;
}

export interface ErrorBoundaryProps {
  children:     ComponentChildren;
  /** Custom fallback UI.  Defaults to the built-in error card. */
  fallback?:    (props: FallbackProps) => VNode | null;
  /** Human-readable name shown in the default fallback card and in logs. */
  sectionName?: string;
  /**
   * When any value in this array changes, the boundary resets automatically.
   * Useful when the parent re-mounts (e.g. navigating away and back).
   */
  resetKeys?:   unknown[];
  /** Called whenever an error is caught — use for metrics / parent state. */
  onError?:     (error: Error, info: { componentStack: string }) => void;
}

interface ErrorBoundaryState {
  hasError:   boolean;
  error:      Error | null;
  errorId:    string | null;   // stable ID for deduplication in Sentry
}

// ── Component ─────────────────────────────────────────────────────────────────

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null, errorId: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
      errorId:  `eb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    };
  }

  componentDidCatch(error: Error, info: { componentStack: string }): void {
    logger.error(
      `ErrorBoundary caught in "${this.props.sectionName ?? 'unknown'}"`,
      error,
      { componentStack: info.componentStack, sectionName: this.props.sectionName },
    );
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    // Auto-reset when resetKeys change (e.g. section navigation)
    if (
      this.state.hasError &&
      this.props.resetKeys &&
      prevProps.resetKeys &&
      this.props.resetKeys.some((k, i) => k !== prevProps.resetKeys![i])
    ) {
      this._reset();
    }
  }

  private _reset = (): void => {
    this.setState({ hasError: false, error: null, errorId: null });
  };

  render(): ComponentChildren {
    const { hasError, error } = this.state;
    const { children, fallback, sectionName } = this.props;

    if (!hasError || !error) return children;

    if (fallback) {
      return fallback({ error, retry: this._reset, sectionName });
    }

    return <DefaultFallback error={error} retry={this._reset} sectionName={sectionName} />;
  }
}

// ── Default fallback UI ───────────────────────────────────────────────────────

function DefaultFallback({ error, retry, sectionName }: FallbackProps): VNode {
  return (
    <div
      role="alert"
      style={{
        padding:      '32px 24px',
        margin:       '16px',
        borderRadius: '8px',
        border:       '1px solid #f5c2c7',
        background:   '#fff5f5',
        color:        '#842029',
        fontFamily:   'system-ui, sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
        <i class="fas fa-exclamation-triangle" style={{ fontSize: '20px' }} aria-hidden="true" />
        <strong style={{ fontSize: '16px' }}>
          {sectionName ? `Error in ${sectionName}` : 'Something went wrong'}
        </strong>
      </div>

      <p style={{ margin: '0 0 8px', fontSize: '14px', color: '#6c757d' }}>
        An unexpected error occurred. The rest of the application is unaffected.
      </p>

      {import.meta.env.DEV && (
        <pre
          style={{
            margin:       '12px 0',
            padding:      '10px',
            background:   '#f8d7da',
            borderRadius: '4px',
            fontSize:     '12px',
            whiteSpace:   'pre-wrap',
            wordBreak:    'break-word',
            maxHeight:    '200px',
            overflow:     'auto',
          }}
        >
          {error.message}
          {error.stack ? `\n\n${error.stack}` : ''}
        </pre>
      )}

      <button
        type="button"
        onClick={retry}
        style={{
          marginTop:    '12px',
          padding:      '8px 20px',
          background:   '#842029',
          color:        '#fff',
          border:       'none',
          borderRadius: '6px',
          cursor:       'pointer',
          fontSize:     '14px',
          fontWeight:   '500',
        }}
      >
        Try again
      </button>
    </div>
  );
}
