/**
 * tabs/DepartmentsTab.tsx
 *
 * Department management, relocated into the Console as a governance area
 * (departments define org structure — the "where", complementing roles' "what").
 * Reuses the existing DepartmentsSection component unchanged (same .dept-card
 * design and CRUD), just hosted here instead of inside the Employees section.
 */

import { type VNode } from 'preact';
import { DepartmentsSection } from '@sections/Employees/DepartmentsSection';

export function DepartmentsTab(): VNode {
  return <DepartmentsSection />;
}
