import type { Design } from '@payslip/types';

/** A persisted, named payslip template. `id` is the store's stable key. */
export interface StoredTemplate {
  id: string;
  name: string;
  isDefault: boolean;
  updatedAt: number; // epoch ms
  design: Design;
}

/**
 * Storage boundary for named templates. All methods are async so the
 * localStorage implementation and the Siomac API implementation are
 * interchangeable without touching the UI.
 */
export interface TemplateStore {
  list(): Promise<StoredTemplate[]>;
  get(id: string): Promise<StoredTemplate | null>;
  create(name: string, design: Design): Promise<StoredTemplate>;
  update(id: string, patch: { name?: string; design?: Design }): Promise<StoredTemplate | null>;
  remove(id: string): Promise<void>;
  setDefault(id: string): Promise<void>;
}
