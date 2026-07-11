import type { Design } from '@payslip/types';
import type { StoredTemplate, TemplateStore } from './types';

const KEY = 'payslip-studio.templates';

function read(): StoredTemplate[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? (parsed as StoredTemplate[]) : [];
  } catch {
    return [];
  }
}

function write(list: StoredTemplate[]): void {
  localStorage.setItem(KEY, JSON.stringify(list));
}

function genId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `tpl_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  }
}

/** localStorage-backed template store (default for the standalone studio). */
export class LocalTemplateStore implements TemplateStore {
  async list(): Promise<StoredTemplate[]> {
    return read().sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<StoredTemplate | null> {
    return read().find((t) => t.id === id) ?? null;
  }

  async create(name: string, design: Design): Promise<StoredTemplate> {
    const list = read();
    const entry: StoredTemplate = {
      id: genId(),
      name: name.trim() || 'Untitled',
      isDefault: list.length === 0, // first template becomes the default
      updatedAt: Date.now(),
      design,
    };
    list.push(entry);
    write(list);
    return entry;
  }

  async update(id: string, patch: { name?: string; design?: Design }): Promise<StoredTemplate | null> {
    const list = read();
    const entry = list.find((t) => t.id === id);
    if (!entry) return null;
    if (patch.name !== undefined) entry.name = patch.name.trim() || entry.name;
    if (patch.design !== undefined) entry.design = patch.design;
    entry.updatedAt = Date.now();
    write(list);
    return entry;
  }

  async remove(id: string): Promise<void> {
    const list = read().filter((t) => t.id !== id);
    if (!list.some((t) => t.isDefault) && list[0]) list[0].isDefault = true; // keep a default
    write(list);
  }

  async setDefault(id: string): Promise<void> {
    write(read().map((t) => ({ ...t, isDefault: t.id === id })));
  }
}
