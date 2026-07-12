import type { Design } from '@payslip/types';

export type TemplateStatus = 'draft' | 'pending_approval' | 'changes_requested' | 'approved' | 'archived';

/** A persisted, named payslip template. `id` is the store's stable key. */
export interface StoredTemplate {
  id:               string;
  name:             string;
  isDefault:        boolean;
  updatedAt:        number; // epoch ms
  design:           Design;
  status:           TemplateStatus;
  version:          number;
  parentTemplateId: string | null;
  createdBy:        string | null;
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
  // Maker-checker lifecycle
  submit(id: string): Promise<StoredTemplate>;
  approve(id: string, comment?: string): Promise<StoredTemplate>;
  requestChanges(id: string, comment: string): Promise<StoredTemplate>;
  createVersion(id: string): Promise<StoredTemplate>;
}
