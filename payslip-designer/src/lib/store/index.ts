import { LocalTemplateStore } from './localTemplateStore';
// import { ApiTemplateStore } from './apiTemplateStore';
import type { TemplateStore } from './types';

/**
 * The active template store.
 *
 * Standalone studio → LocalTemplateStore (localStorage).
 * Inside Siomac    → swap to `new ApiTemplateStore()`. Nothing else changes;
 *                    the whole UI depends only on the TemplateStore interface.
 */
export const templateStore: TemplateStore = new LocalTemplateStore();

export type { StoredTemplate, TemplateStore } from './types';
