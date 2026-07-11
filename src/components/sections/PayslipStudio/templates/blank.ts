import type { Design } from '@payslip/types';
import { page } from './builder';

export function blankTemplate(): Design {
  return { page: page(), elements: [] };
}
