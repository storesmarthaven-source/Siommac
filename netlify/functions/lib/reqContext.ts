/**
 * netlify/functions/lib/reqContext.ts
 *
 * Request-scoped context using AsyncLocalStorage. Lets cross-cutting helpers
 * (notably the audit logger `log_`) read the caller's IP and user-agent without
 * threading the Hono context through every call site.
 *
 * Set once per request in a middleware (see api.ts); read anywhere downstream.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface ReqContext {
  ip?:        string;
  userAgent?: string;
  /**
   * Per-request correlation / trace ID. Generated once in the reqContext
   * middleware (api.ts) and automatically injected into audit_logs.changes,
   * app_events.payload, and handoff_outbox.payload by their respective helpers
   * (writePlatformAudit, emitAppEvent, createHandoff) so every side-effect from
   * a single request shares the same ID.
   *
   * Echoed back to callers as the `X-Request-Id` response header so clients can
   * include it in support requests.
   */
  reqId?:     string;
}

const _store = new AsyncLocalStorage<ReqContext>();

/** Run `fn` with the given request context bound for its async lifetime. */
export function runWithReqContext<T>(ctx: ReqContext, fn: () => T): T {
  return _store.run(ctx, fn);
}

/** Read the current request context (empty object if outside a request). */
export function getReqContext(): ReqContext {
  return _store.getStore() ?? {};
}
