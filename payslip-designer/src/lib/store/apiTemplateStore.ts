import type { Design } from '@/types';
import type { StoredTemplate, TemplateStore } from './types';

/**
 * Siomac-backed store. Talks to the authenticated payslip-template routes.
 *
 * On integration, replace `call` with the app's real `apiPost` helper — which
 * injects the Netlify JWT and wraps the body as `{ args: payload }` (every
 * Siomac route validates `body.args ?? body`). The route names below match the
 * reference routes in `siomac-integration/`.
 */
async function call<T>(route: string, args: unknown): Promise<T> {
  const res = await fetch(`/api/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ args }),
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`${route} failed: ${res.status}`);
  return (await res.json()) as T;
}

export class ApiTemplateStore implements TemplateStore {
  list(): Promise<StoredTemplate[]> {
    return call<StoredTemplate[]>('payslipTemplates.list', {});
  }
  get(id: string): Promise<StoredTemplate | null> {
    return call<StoredTemplate | null>('payslipTemplates.get', { id });
  }
  create(name: string, design: Design): Promise<StoredTemplate> {
    return call<StoredTemplate>('payslipTemplates.create', { name, design });
  }
  update(id: string, patch: { name?: string; design?: Design }): Promise<StoredTemplate | null> {
    return call<StoredTemplate | null>('payslipTemplates.update', { id, ...patch });
  }
  remove(id: string): Promise<void> {
    return call<unknown>('payslipTemplates.delete', { id }).then(() => undefined);
  }
  setDefault(id: string): Promise<void> {
    return call<unknown>('payslipTemplates.setDefault', { id }).then(() => undefined);
  }
}
