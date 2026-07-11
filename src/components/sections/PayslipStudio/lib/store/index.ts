import { ApiTemplateStore } from './apiTemplateStore';
import type { TemplateStore } from './types';

/**
 * The active template store.
 *
 * Embedded in Siomac → ApiTemplateStore: named templates persist to
 * `payroll_payslip_templates` through the authenticated finance routes. The
 * whole studio UI depends only on the TemplateStore interface, so nothing else
 * changes. (Autosave stays local — see lib/store/autosave.ts.)
 * LocalTemplateStore is retained for the standalone/offline studio build.
 */
export const templateStore: TemplateStore = new ApiTemplateStore();

export type { StoredTemplate, TemplateStore } from './types';
