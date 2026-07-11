import type { Design } from '@/types';
import { prolasTemplate } from './prolas';
import { siomacTemplate } from './siomac';
import { incorrtechTemplate } from './incorrtech';

export interface TemplateDef {
  id: string;
  label: string;
  build: () => Design;
}

/** Registry — add new templates here; the toolbar dropdown is generated from it. */
export const TEMPLATES: readonly TemplateDef[] = [
  { id: 'siomac', label: 'SIOMAC Ltd. (A4 landscape)', build: siomacTemplate },
  { id: 'prolas', label: 'PROLAS Homes Ltd. (A4 landscape)', build: prolasTemplate },
  { id: 'incorrtech', label: 'In-Corr-Tech Limited (A4 landscape)', build: incorrtechTemplate },
];

export const DEFAULT_TEMPLATE_ID = 'siomac';

export function buildTemplate(id: string): Design | null {
  return TEMPLATES.find((t) => t.id === id)?.build() ?? null;
}
