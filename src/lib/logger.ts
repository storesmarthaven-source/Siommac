/**
 * src/lib/logger.ts  —  Structured application logger
 *
 * In development: pretty-prints to the console with level prefix + context.
 * In production:  sends structured events to Sentry (if configured) AND
 *                 console.error for critical/error levels only.
 *
 * Usage:
 *   import { logger } from '@lib/logger';
 *   logger.info('Employee loaded', { userId, count: employees.length });
 *   logger.error('Fetch failed', error, { action: 'listEmployees' });
 *
 * Sentry integration:
 *   Set VITE_SENTRY_DSN in your .env to activate.  The Sentry SDK is loaded
 *   lazily on first error so it never impacts cold-start time.
 *
 * Rules:
 *   - Never log PII (full names, emails, phone numbers).
 *   - Never log tokens or secrets — ids and roles are acceptable.
 *   - Always pass an Error object as the second arg when logging exceptions.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical';
type Context  = Record<string, unknown>;

const IS_DEV  = import.meta.env.DEV;
const IS_PROD = import.meta.env.PROD;

// Sentry DSN — optional.  If absent, Sentry is disabled.
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

// ── Sentry lazy loader ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sentry: any = null;
let _sentryLoading = false;

async function _loadSentry(): Promise<void> {
  if (_sentry || _sentryLoading || !SENTRY_DSN) return;
  _sentryLoading = true;
  try {
    // Dynamic import — Sentry is optional.  If the package is not installed
    // this catch block runs silently.  Install with: npm i @sentry/browser
    // The string variable form prevents TypeScript from resolving the module
    // at compile time while Vite's @vite-ignore comment suppresses the warning.
    const pkg = '@sentry/browser';
     
    const Sentry = await (
      // Vite resolves this as an external dynamic import at runtime
      import(/* @vite-ignore */ pkg)
    ) as {
      init:             (opts: Record<string, unknown>) => void;
      withScope:        (fn: (scope: { setLevel(l: string): void; setExtras(c: Context): void }) => void) => void;
      captureException: (err: unknown) => void;
      captureMessage:   (msg: string, level: string) => void;
    };
    Sentry.init({
      dsn:         SENTRY_DSN,
      environment: IS_PROD ? 'production' : 'development',
      // Strip PII from breadcrumbs automatically
      beforeBreadcrumb(breadcrumb: { category?: string } | null) {
        if (breadcrumb?.category === 'ui.click') return null;
        return breadcrumb;
      },
    });
    _sentry = Sentry;
  } catch {
    // Sentry load failure must never break the app
    _sentryLoading = false;
  }
}

// Kick off Sentry load in the background on first import (production only)
if (IS_PROD && SENTRY_DSN) {
  void _loadSentry();
}

// ── Formatters ────────────────────────────────────────────────────────────────

const LEVEL_STYLE: Record<LogLevel, string> = {
  debug:    'color:#6b7280',
  info:     'color:#0074D9',
  warn:     'color:#f59e0b;font-weight:bold',
  error:    'color:#b00020;font-weight:bold',
  critical: 'color:#fff;background:#b00020;font-weight:bold;padding:2px 6px',
};

// ── Core log function ─────────────────────────────────────────────────────────

function _log(
  level:   LogLevel,
  message: string,
  error?:  unknown,
  ctx?:    Context,
): void {
  const timestamp = new Date().toISOString();
  const entry     = { level, message, timestamp, ...ctx };

  // ── Console output ───────────────────────────────────────────────────────
  if (IS_DEV) {
    const style = LEVEL_STYLE[level];
    if (level === 'debug' || level === 'info') {
      console.warn(`%c[${level.toUpperCase()}]`, style, message, ctx ?? '');
    } else if (level === 'warn') {
      console.warn(`%c[WARN]`, style, message, ctx ?? '', error ?? '');
    } else {
      console.error(`%c[${level.toUpperCase()}]`, style, message, ctx ?? '', error ?? '');
    }
  } else {
    // Production: only surface warn+ to console (errors are sent to Sentry)
    if (level === 'warn') {
      console.warn('[siomac]', entry);
    } else if (level === 'error' || level === 'critical') {
      console.error('[siomac]', entry, error);
    }
  }

  // ── Sentry capture (production only, error/critical only) ────────────────
  if (IS_PROD && (level === 'error' || level === 'critical') && SENTRY_DSN) {
    void _loadSentry().then(() => {
      if (!_sentry) return;
      _sentry.withScope((scope: { setLevel: (l: string) => void; setExtras: (c: Context) => void }) => {
        scope.setLevel(level === 'critical' ? 'fatal' : 'error');
        if (ctx) scope.setExtras(ctx);
        if (error instanceof Error) {
          _sentry.captureException(error);
        } else {
          _sentry.captureMessage(message, level === 'critical' ? 'fatal' : 'error');
        }
      });
    });
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export const logger = {
  debug(message: string, ctx?: Context): void {
    if (IS_DEV) _log('debug', message, undefined, ctx);
  },
  info(message: string, ctx?: Context): void {
    _log('info', message, undefined, ctx);
  },
  warn(message: string, ctx?: Context): void {
    _log('warn', message, undefined, ctx);
  },
  error(message: string, error?: unknown, ctx?: Context): void {
    _log('error', message, error, ctx);
  },
  /** Use for unrecoverable failures that require immediate attention */
  critical(message: string, error?: unknown, ctx?: Context): void {
    _log('critical', message, error, ctx);
  },
};
