import { ApiTemplateStore } from './apiTemplateStore';
import type { TemplateStore } from './types';

/**
 * The active template store.
 *
 * Embedded in Siomac → ApiTemplateStore: named templates persist to
 * `payroll_payslip_templates` through the authenticated finance routes. The
 * whole studio UI depends only on the TemplateStore interface. The per-user
 * autosave draft + open-ref are ALSO DB-backed (see lib/store/autosave.ts), so
 * nothing the studio persists is browser-only.
 */
export const templateStore: TemplateStore = new ApiTemplateStore();

export type { StoredTemplate, TemplateStore } from './types';
