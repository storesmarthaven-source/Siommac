import type { Design } from '@/types';
import { page } from './builder';

export function blankTemplate(): Design {
  return { page: page(), elements: [] };
}
