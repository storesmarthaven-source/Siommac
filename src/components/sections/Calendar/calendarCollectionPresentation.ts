import type { CalendarCollectionDTO } from '@api/calendar';
import type { LucideName } from '@ui';

export interface CalendarCollectionPresentation {
  icon: LucideName;
  meta: string;
}

/** Shared presentation for a calendar collection wherever it appears. The
 * collection colour remains its visual identity; the icon explains its scope. */
export function calendarCollectionPresentation(calendar: CalendarCollectionDTO): CalendarCollectionPresentation {
  if (calendar.provider) {
    const provider = calendar.provider === 'microsoft'
      ? 'Outlook'
      : calendar.provider === 'exchange'
        ? 'Exchange'
        : `${calendar.provider.slice(0, 1).toUpperCase()}${calendar.provider.slice(1)}`;
    return { icon: 'Cloud', meta: `${provider} · Read-only` };
  }
  if (calendar.isDefault) return { icon: 'CalendarDays', meta: 'Personal · Default' };
  if (calendar.visibility === 'org') return { icon: 'Building2', meta: 'Organisation-wide' };
  if (calendar.visibility === 'team') {
    const departmentName = calendar.departmentName?.trim();
    const department = departmentName && departmentName.length > 0 ? departmentName : 'Department';
    const normalized = department.toLocaleLowerCase();
    const icon: LucideName = normalized.includes('hse') || normalized.includes('safety')
      ? 'ShieldCheck'
      : normalized.includes('operation')
        ? 'BriefcaseBusiness'
        : 'UsersRound';
    return { icon, meta: `${department} · Team` };
  }
  return { icon: 'UserRound', meta: 'Personal' };
}
