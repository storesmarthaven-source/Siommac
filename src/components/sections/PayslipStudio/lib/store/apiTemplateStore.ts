import type { Design } from '@payslip/types';
import type { StoredTemplate, TemplateStore } from './types';
import { apiPost } from '@lib/api';

/**
 * Siomac ERP-backed store. Talks to the authenticated payslip-template routes
 * (`/api/finance/payroll/payslip-templates/*`) via the ERP `apiPost` helper,
 * which injects the Netlify JWT and wraps the body as `{ args }` (every route
 * validates `body.args ?? body`). The response envelope is `{ success, data }`;
 * `data` is EXACTLY the studio's StoredTemplate DTO, so this is a drop-in
 * replacement for LocalTemplateStore.
 */
async function call<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T; message?: string }>(
    `finance/payroll/payslip-templates/${op}`,
    args,
  );
  if (!res.success) throw new Error(res.message ?? `Payslip template "${op}" failed.`);
  return res.data;
}

export class ApiTemplateStore implements TemplateStore {
  list(): Promise<StoredTemplate[]> {
    return call<StoredTemplate[]>('list');
  }
  get(id: string): Promise<StoredTemplate | null> {
    return call<StoredTemplate | null>('get', { id });
  }
  create(name: string, design: Design): Promise<StoredTemplate> {
    return call<StoredTemplate>('create', { name, design });
  }
  update(id: string, patch: { name?: string; design?: Design }): Promise<StoredTemplate | null> {
    return call<StoredTemplate | null>('update', { id, ...patch });
  }
  remove(id: string): Promise<void> {
    return call<unknown>('delete', { id }).then(() => undefined);
  }
  setDefault(id: string): Promise<void> {
    return call<unknown>('set-default', { id }).then(() => undefined);
  }
}
