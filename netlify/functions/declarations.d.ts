// @hono/node-server ships its own types but the /netlify subpath
// may not be declared in older versions. This shim covers the gap.
declare module '@hono/node-server/netlify' {
  import type { Hono } from 'hono';
  export function handle(app: Hono<any>): (event: unknown, context: unknown) => Promise<unknown>;
}
