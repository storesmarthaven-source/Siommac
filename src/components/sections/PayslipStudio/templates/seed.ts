import { templateStore } from '@payslip/lib/store';
import { TEMPLATES } from './index';

let done = false;

/**
 * On first run (empty store), copy the built-in templates into the Designs store
 * so they become editable, updatable records — the first one becomes the default.
 * After this, "update a default template" = open it in Designs → edit → Update.
 * Re-runs only if the store is emptied (defaults come back).
 */
export async function seedBuiltInTemplates(): Promise<void> {
  if (done) return;
  done = true;
  const existing = await templateStore.list();
  if (existing.length) return;
  for (const t of TEMPLATES) {
    const name = t.label.replace(/\s*\(.*\)\s*$/, '').replace(/^★\s*/, '').trim();
    await templateStore.create(name, t.build());
  }
}
