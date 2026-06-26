/**
 * src/components/sections/HR/shared.tsx
 *
 * Shared formatting helpers + avatar components for the HR ▸ Employee Master views
 * (the register page and the profile drawer), so tone/label logic lives in one place.
 * Styling for `.avatar` / `.tiny-avatar` is in ./HR.css (scoped to `.hr-emp-master`).
 */

import { type VNode } from 'preact';
import { type TrainingStatus, type HrEmployeeRow } from '@api/hr/employees';

export type PillTone = 'green' | 'amber' | 'red' | 'purple' | 'blue' | 'gray';

/** "role_change" → "Role Change". */
export function humanize(s: string): string {
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
}

export function rowName(r: Pick<HrEmployeeRow, 'full_name' | 'display_name' | 'username'>): string {
  return r.full_name ?? r.display_name ?? r.username;
}

export function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map(w => (w[0] ?? '').toUpperCase()).join('') || '?';
}

export function statusTone(status: string): PillTone {
  const s = status.toLowerCase();
  if (s.includes('active') && !s.includes('inactive')) return 'green';
  if (s.includes('probation')) return 'blue';
  if (s.includes('leave')) return 'amber';
  if (s.includes('suspend')) return 'red';
  if (s.includes('terminat')) return 'red';
  return 'gray';
}

export const TRAINING_TONE: Record<TrainingStatus, PillTone> = {
  current: 'green', due_soon: 'amber', expired: 'red', none: 'gray',
};
export const TRAINING_LABEL: Record<TrainingStatus, string> = {
  current: 'Current', due_soon: 'Due Soon', expired: 'Expired', none: 'None',
};

export function Avatar({ name, img }: { name: string; img: string | null }): VNode {
  return <div class="avatar">{img ? <img src={img} alt={name} /> : initials(name)}</div>;
}
export function TinyAvatar({ name }: { name: string }): VNode {
  return <span class="tiny-avatar">{initials(name)}</span>;
}
