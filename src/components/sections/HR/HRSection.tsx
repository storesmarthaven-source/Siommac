/**
 * src/components/sections/HR/HRSection.tsx
 *
 * HR module shell. One sidebar group ("HR") today with a single sub-module
 * (Employee Master); future sub-modules (Onboarding, Import, Contractor Workers)
 * route here too. With one page, it renders Employee Master directly.
 */

import { type VNode } from 'preact';
import { EmployeeMaster } from './EmployeeMaster';

export function HRSection(): VNode {
  return <EmployeeMaster />;
}
