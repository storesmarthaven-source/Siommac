import type { Design } from '@/types';
import type { SavedRef } from '@/state/reducer';

const KEY = 'payslip-studio.autosave';
const REF_KEY = 'payslip-studio.openref';

function isDesign(d: unknown): d is Design {
  return !!d && Array.isArray((d as Design).elements) && !!(d as Design).page;
}

export function setAutosave(design: Design): void {
  localStorage.setItem(KEY, JSON.stringify(design));
}

export function getAutosave(): Design | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? 'null') as unknown;
    return isDesign(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Remember which saved design is currently open, so a reload keeps the link. */
export function setOpenRef(ref: SavedRef | null): void {
  if (ref) localStorage.setItem(REF_KEY, JSON.stringify(ref));
  else localStorage.removeItem(REF_KEY);
}

export function getOpenRef(): SavedRef | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(REF_KEY) ?? 'null') as SavedRef | null;
    return parsed && parsed.id ? parsed : null;
  } catch {
    return null;
  }
}
