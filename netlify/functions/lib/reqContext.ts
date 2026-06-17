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
