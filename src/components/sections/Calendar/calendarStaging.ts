import type { CalendarCollectionDTO, CalendarHolidayMarkerDTO, CalendarItemDTO, UpdateEntryRequest } from '@api/calendar';
import { addDays, toLocalDateKey } from '@lib/calendar/date';
import aliciaAvatar from '@/assets/avatars/roster-planner/alicia-moore.jpg';
import dariusAvatar from '@/assets/avatars/roster-planner/darius-king.jpg';
import jordanAvatar from '@/assets/avatars/roster-planner/jordan-peters.jpg';
import marcusAvatar from '@/assets/avatars/roster-planner/marcus-allen.jpg';

const STAGED_CALENDAR_IDS = {
  personal: '00000000-0000-4000-8000-000000000001',
} as const;

export const CALENDAR_STAGING_CALENDARS: readonly CalendarCollectionDTO[] = [
  {
    id: STAGED_CALENDAR_IDS.personal,
    name: 'My Calendar',
    description: 'Personal events, reminders and tasks.',
    ownerUserId: 'staged-owner',
    ownerName: 'You',
    visibility: 'personal',
    departmentId: null,
    departmentName: null,
    colorKey: 'blue',
    customColor: null,
    isDefault: true,
    status: 'active',
    canEdit: true,
    canArchive: false,
    provider: null,
    readOnly: false,
  },
  {
    id: '00000000-0000-4000-8000-000000000005',
    name: 'Google Calendar',
    description: 'Imported from your Google account.',
    ownerUserId: 'staged-owner',
    ownerName: 'you@gmail.com',
    visibility: 'personal',
    departmentId: null,
    departmentName: null,
    colorKey: 'blue',
    customColor: null,
    isDefault: false,
    status: 'active',
    canEdit: false,
    canArchive: false,
    provider: 'google',
    readOnly: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000006',
    name: 'Outlook Work',
    description: 'Imported from Microsoft 365.',
    ownerUserId: 'staged-owner',
    ownerName: 'you@company.com',
    visibility: 'personal',
    departmentId: null,
    departmentName: null,
    colorKey: 'coral',
    customColor: null,
    isDefault: false,
    status: 'active',
    canEdit: false,
    canArchive: false,
    provider: 'microsoft',
    readOnly: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000007',
    name: 'iCloud Personal',
    description: 'Imported from Apple Calendar.',
    ownerUserId: 'staged-owner',
    ownerName: 'you@icloud.com',
    visibility: 'personal',
    departmentId: null,
    departmentName: null,
    colorKey: 'slate',
    customColor: null,
    isDefault: false,
    status: 'active',
    canEdit: false,
    canArchive: false,
    provider: 'apple',
    readOnly: true,
  },
  {
    id: '00000000-0000-4000-8000-000000000008',
    name: 'Exchange Operations',
    description: 'Imported from the organisation Exchange server.',
    ownerUserId: 'staged-owner',
    ownerName: 'Operations Team',
    visibility: 'team',
    departmentId: 'demo-operations',
    departmentName: 'Operations',
    colorKey: 'mint',
    customColor: null,
    isDefault: false,
    status: 'active',
    canEdit: false,
    canArchive: false,
    provider: 'exchange',
    readOnly: true,
  },
];

type StagedItem = Omit<CalendarItemDTO,
  'id' | 'allDay' | 'startsOn' | 'endsOn' | 'startsAt' | 'endsAt' | 'recurrenceSeriesId' |
  'recurrenceRule' | 'occurrenceDate' | 'editable' | 'completable' | 'assignable' |
  'cancelable' | 'drillThrough' | 'kind' | 'availability' | 'categoryId' | 'categoryKey' |
  'categoryName' | 'categoryIcon'> & {
  day: Date;
  endDay?: Date;
  startHour?: number;
  startMinute?: number;
  endHour?: number;
  endMinute?: number;
  durationMinutes?: number;
};

export interface CalendarStagedAttendee {
  userId: string;
  name: string;
  role: string;
  profileImage: string | null;
  responseStatus: 'invited' | 'accepted' | 'declined' | 'tentative';
}

export interface CalendarStagedDetail {
  agenda: string[];
  attendees: CalendarStagedAttendee[];
  myResponse: CalendarStagedAttendee['responseStatus'];
  updatedLabel: string;
  joinAvailable: boolean;
  comments: { id: string; author: string; body: string; createdLabel: string }[];
}

const HOLIDAY_PREVIEW_SET = [
  {
    name: 'Independence Day',
    statutoryName: 'Independence Day',
    holidayType: 'statutory' as const,
    sourceReference: 'Public Holidays and Festivals Act, Chap. 19:05',
  },
  {
    name: 'African Emancipation Day',
    statutoryName: 'African Emancipation Day',
    holidayType: 'statutory' as const,
    sourceReference: 'Public Holidays and Festivals Act, Chap. 19:05',
  },
  {
    name: 'Divali',
    statutoryName: 'Divali',
    holidayType: 'movable' as const,
    sourceReference: 'Public Holidays and Festivals Act, Chap. 19:05',
  },
  {
    name: 'Eid-ul-Fitr',
    statutoryName: 'Eid-ul-Fitr',
    holidayType: 'movable' as const,
    sourceReference: 'Public Holidays and Festivals Act, Chap. 19:05',
  },
] as const;

/** Design-review markers for the visible staged period. Their dates deliberately
 * follow the preview columns so all four holiday treatments can be compared at
 * once; live mode continues to use only published jurisdiction data. */
export function calendarStagingHolidays(days: readonly Date[]): CalendarHolidayMarkerDTO[] {
  return days.slice(0, HOLIDAY_PREVIEW_SET.length).map((day, index) => ({
    id: `calendar-demo-holiday-${index + 1}`,
    date: toLocalDateKey(day),
    ...HOLIDAY_PREVIEW_SET[index]!,
    dayFraction: 1,
    calendarName: 'Trinidad & Tobago · Design preview',
  }));
}

function timed(day: Date, hour: number, minute = 0): string {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute).toISOString();
}

function stagedItem(value: StagedItem, index: number): CalendarItemDTO {
  const { day, endDay, startHour, startMinute = 0, endHour, endMinute = 0, durationMinutes = 45, ...item } = value;
  const allDay = startHour === undefined;
  const startsAt = allDay ? null : timed(day, startHour, startMinute);
  const endsAt = allDay
    ? null
    : endDay
      ? timed(endDay, endHour ?? startHour, endMinute)
      : new Date(new Date(startsAt!).getTime() + durationMinutes * 60_000).toISOString();
  const source = `${item.sourceModule ?? ''} ${item.sourceLabel ?? ''}`.toLocaleLowerCase();
  const kind = item.type === 'deadline' ? 'deadline'
    : item.type === 'task' ? 'task'
      : source.includes('meeting') ? 'meeting'
        : source.includes('reminder') ? 'reminder'
          : 'event';
  const category = source.includes('toolbox') ? { key: 'toolbox_talk', name: 'Toolbox Talk', icon: 'HardHat' }
    : source.includes('hse') || source.includes('safety') ? { key: 'safety_hse', name: 'Safety & HSE', icon: 'ShieldCheck' }
      : source.includes('payroll') ? { key: 'finance_payroll', name: 'Finance & Payroll', icon: 'BadgeDollarSign' }
        : source.includes('maintenance') ? { key: 'maintenance', name: 'Maintenance', icon: 'Wrench' }
          : source.includes('compliance') || item.type === 'deadline' ? { key: 'compliance', name: 'Compliance', icon: 'ClipboardCheck' }
            : source.includes('operation') || source.includes('planning') ? { key: 'operations', name: 'Operations', icon: 'BriefcaseBusiness' }
              : { key: 'general', name: 'General', icon: 'CalendarDays' };
  return {
    ...item,
    kind,
    availability: kind === 'reminder' ? 'free' : kind === 'task' || kind === 'deadline' ? null : 'busy',
    categoryId: `calendar-demo-category-${category.key}`,
    categoryKey: category.key,
    categoryName: category.name,
    categoryIcon: category.icon,
    id: `calendar-demo-${index + 1}`,
    allDay,
    startsOn: allDay ? toLocalDateKey(day) : null,
    endsOn: null,
    startsAt,
    endsAt,
    recurrenceSeriesId: null,
    recurrenceRule: null,
    occurrenceDate: null,
    editable: true,
    completable: false,
    assignable: false,
    cancelable: true,
    drillThrough: Boolean(item.sourceRoute),
  };
}

/** Isolated Calendar examples used only by governed Demo Mode. Edits are
 * session-local preview state and never mutate operational records. */
export function calendarStagingItems(today = new Date()): CalendarItemDTO[] {
  const people = {
    alicia: { ownerUserId: 'demo-alicia', ownerName: 'Alicia Moore' },
    marcus: { ownerUserId: 'demo-marcus', ownerName: 'Marcus Allen' },
    darius: { ownerUserId: 'demo-darius', ownerName: 'Darius King' },
    jordan: { ownerUserId: 'demo-jordan', ownerName: 'Jordan Peters' },
  } as const;
  const common = {
    origin: 'calendar' as const,
    status: null,
    priority: null,
    sourcePriority: null,
    assigneeUserId: null,
    assigneeName: null,
    departmentId: 'demo-operations',
    departmentName: 'Operations',
    attendeeCount: 0,
    visibility: 'team' as const,
    sourceModule: null,
    sourceRef: null,
    sourceRoute: null,
    sourceLabel: null,
    sourceDepartment: 'calendar' as const,
    sourceDepartmentLabel: 'Calendar',
    colorKey: null,
    customColor: null,
    locationLabel: null,
    calendarId: STAGED_CALENDAR_IDS.personal,
    calendarName: 'My Calendar',
  };
  const values: StagedItem[] = [
    { ...common, ...people.alicia, day: today, type: 'activity', title: 'Crew Change Window', titleIconType: 'emoji', titleIconValue: '🚢', notes: 'All-day coordination window for crew transfers, access and handover coverage.', colorKey: 'teal', locationLabel: 'Marine Base · Operations Desk', sourceModule: 'operations', sourceRef: 'EVT-DEMO-CREW-CHANGE', sourceLabel: 'Event', sourceDepartment: 'operations', sourceDepartmentLabel: 'Operations' },
    { ...common, ...people.darius, day: today, type: 'task', title: 'Permit Register Review', titleIconType: 'lucide', titleIconValue: 'ClipboardCheck', notes: 'Complete the daily permit register review before close of business.', status: 'not_started', priority: 'high', colorKey: 'amber', assigneeUserId: 'demo-darius', assigneeName: 'Darius King', sourceModule: 'calendar', sourceRef: 'TSK-DEMO-PERMIT-REGISTER', sourceLabel: 'Task', sourceDepartment: 'calendar', sourceDepartmentLabel: 'Calendar' },
    { ...common, ...people.alicia, day: today, startHour: 7, durationMinutes: 120, type: 'activity', title: 'North Field Mobilisation', titleIconType: 'lucide', titleIconValue: 'MapPin', notes: 'Field mobilisation and controlled site-access window.', colorKey: 'amber', locationLabel: 'North Field · Gate 2', sourceModule: 'operations', sourceLabel: 'Field Operation', sourceDepartment: 'operations', sourceDepartmentLabel: 'Operations' },
    { ...common, ...people.marcus, day: today, startHour: 9, durationMinutes: 120, type: 'activity', title: 'Site Readiness Sync', titleIconType: 'lucide', titleIconValue: 'Video', notes: 'Confirm access, permits and mobilisation readiness for today’s field work.', attendeeCount: 5, colorKey: 'blue', locationLabel: 'North Field · Control Room', sourceModule: 'meetings', sourceRef: 'MTG-DEMO-TODAY', sourceRoute: 's-meetings', sourceLabel: 'Meeting', sourceDepartment: 'operations', sourceDepartmentLabel: 'Operations' },
    { ...common, ...people.alicia, day: today, startHour: 9, durationMinutes: 120, type: 'activity', title: 'Vendor Access Briefing', titleIconType: 'emoji', titleIconValue: '👋', notes: 'Confirm visitor access, escort coverage and reception instructions.', colorKey: 'coral', locationLabel: 'Head Office · Reception', sourceModule: 'calendar', sourceRef: 'EVT-DEMO-VENDOR', sourceLabel: 'Event', sourceDepartment: 'calendar', sourceDepartmentLabel: 'Calendar' },
    { ...common, ...people.darius, day: today, startHour: 11, startMinute: 15, durationMinutes: 45, type: 'task', title: 'Permit Handover', titleIconType: 'lucide', titleIconValue: 'ListChecks', notes: 'Review and hand over the active work permits to the incoming supervisor.', status: 'in_progress', priority: 'high', colorKey: 'purple', assigneeUserId: 'demo-darius', assigneeName: 'Darius King', visibility: 'team' },
    { ...common, ...people.jordan, day: today, startHour: 12, startMinute: 15, durationMinutes: 30, type: 'deadline', origin: 'workflow', title: 'Mobilisation Pack Due', titleIconType: 'lucide', titleIconValue: 'Flag', notes: 'Submit the approved mobilisation pack before the noon control gate.', colorKey: 'coral', sourcePriority: 'high', sourceModule: 'compliance', sourceRef: 'DUE-DEMO-TODAY', sourceLabel: 'Deadline', sourceDepartment: 'operations', sourceDepartmentLabel: 'Operations' },
    { ...common, ...people.marcus, day: today, startHour: 13, durationMinutes: 75, type: 'activity', title: 'Pelican Platform Safety Review', titleIconType: 'emoji', titleIconValue: '🛡️', notes: 'Review corrective actions and completed deck-inspection evidence with the field team.', attendeeCount: 4, colorKey: 'blue', locationLabel: 'Pelican Platform · Bay 3', sourceModule: 'meetings', sourceRef: 'MTG-DEMO-SAFETY', sourceRoute: 's-meetings', sourceLabel: 'Meeting', sourceDepartment: 'hse', sourceDepartmentLabel: 'HSE' },
    { ...common, ...people.marcus, day: today, startHour: 15, startMinute: 30, durationMinutes: 30, type: 'activity', title: 'Submit Permit Pack', titleIconType: 'lucide', titleIconValue: 'Bell', notes: 'Reminder to submit the verified permit pack before the mobilisation gate closes.', colorKey: 'slate', sourceModule: 'calendar', sourceRef: 'REM-DEMO-001', sourceLabel: 'Reminder' },
    { ...common, ...people.jordan, day: today, startHour: 20, startMinute: 30, durationMinutes: 60, type: 'activity', title: 'Night Shift Coordination', titleIconType: 'emoji', titleIconValue: '🌙', notes: 'Confirm overnight priorities, coverage and escalation contacts.', attendeeCount: 4, colorKey: 'blue', sourceModule: 'meetings', sourceRef: 'MTG-DEMO-NIGHT', sourceRoute: 's-meetings', sourceLabel: 'Meeting', sourceDepartment: 'operations', sourceDepartmentLabel: 'Operations' },

    { ...common, ...people.darius, day: addDays(today, 1), startHour: 8, startMinute: 30, durationMinutes: 45, type: 'activity', title: 'Pre-job Safety Talk', notes: 'Field briefing covering controls and stop-work responsibilities.', colorKey: 'amber', sourceModule: 'hse', sourceRef: 'TBT-DEMO-001', sourceRoute: 's-hse-toolbox', sourceLabel: 'Toolbox Talk', sourceDepartment: 'hse', sourceDepartmentLabel: 'HSE' },
    { ...common, ...people.alicia, day: addDays(today, 1), startHour: 9, startMinute: 30, durationMinutes: 90, type: 'activity', title: 'Weekly Operations Briefing', notes: 'Review readiness, assign open actions and align mobilisation priorities.', attendeeCount: 6, colorKey: 'blue', sourceModule: 'meetings', sourceRef: 'MTG-DEMO-OPS', sourceRoute: 's-meetings', sourceLabel: 'Meeting', sourceDepartment: 'operations', sourceDepartmentLabel: 'Operations' },
    { ...common, ...people.jordan, day: addDays(today, 1), startHour: 14, durationMinutes: 75, type: 'task', title: 'Resolve Staffing Gaps', notes: 'Confirm relief coverage for the late and overnight rotations.', status: 'in_progress', priority: 'high', colorKey: 'coral', assigneeUserId: 'demo-jordan', assigneeName: 'Jordan Peters', sourceModule: 'planning', sourceRef: 'TSK-DEMO-STAFF', sourceLabel: 'Task', sourceDepartment: 'operations', sourceDepartmentLabel: 'Operations' },
    { ...common, ...people.marcus, day: addDays(today, 1), endDay: addDays(today, 2), startHour: 15, endHour: 10, endMinute: 30, type: 'activity', title: 'Offshore Mobilisation Window', notes: 'Coordinate the overnight mobilisation handoff and morning field-readiness checks.', attendeeCount: 5, colorKey: 'amber', locationLabel: 'North Field · Logistics Route', sourceModule: 'operations', sourceLabel: 'Field Operation', sourceDepartment: 'operations', sourceDepartmentLabel: 'Operations' },

    { ...common, ...people.marcus, day: addDays(today, 2), startHour: 9, durationMinutes: 60, type: 'activity', title: 'Contractor Kickoff', notes: 'Align the contractor leads on induction, permits and delivery sequencing.', attendeeCount: 5, colorKey: 'blue', sourceModule: 'meetings', sourceRef: 'MTG-DEMO-KICKOFF', sourceRoute: 's-meetings', sourceLabel: 'Meeting', sourceDepartment: 'operations', sourceDepartmentLabel: 'Operations' },
    { ...common, ...people.alicia, day: addDays(today, 2), startHour: 11, durationMinutes: 30, type: 'deadline', origin: 'module', title: 'Insurance Certificate Due', notes: 'Updated contractor insurance evidence must be on file before mobilisation.', colorKey: 'coral', sourcePriority: 'high', sourceModule: 'compliance', sourceRef: 'DUE-DEMO-001', sourceLabel: 'Deadline', sourceDepartment: 'operations', sourceDepartmentLabel: 'Operations' },
    { ...common, ...people.jordan, day: addDays(today, 2), startHour: 14, durationMinutes: 90, type: 'task', title: 'Approve September Crew Roster', notes: 'Validate coverage and submit the supervisor approval.', status: 'in_review', priority: 'high', colorKey: 'purple', assigneeUserId: 'demo-jordan', assigneeName: 'Jordan Peters', visibility: 'personal', sourceModule: 'planning', sourceRef: 'TSK-DEMO-ROSTER', sourceLabel: 'Task' },

    { ...common, ...people.darius, day: addDays(today, 3), type: 'deadline', origin: 'workflow', title: 'Equipment Certification Window', notes: 'Final day to validate certification evidence for mobilised equipment.', colorKey: 'amber', locationLabel: 'Operations Centre · Certification Desk', sourcePriority: 'critical', sourceModule: 'compliance', sourceRef: 'DUE-DEMO-EQUIPMENT', sourceLabel: 'Deadline', sourceDepartment: 'hse', sourceDepartmentLabel: 'HSE' },
    { ...common, ...people.alicia, day: addDays(today, 3), startHour: 9, startMinute: 30, durationMinutes: 75, type: 'activity', title: 'CAPA Owner Check-in', notes: 'Review evidence readiness and unblock overdue corrective actions.', attendeeCount: 5, colorKey: 'blue', sourceModule: 'meetings', sourceRef: 'MTG-DEMO-CAPA', sourceRoute: 's-meetings', sourceLabel: 'Meeting', sourceDepartment: 'hse', sourceDepartmentLabel: 'HSE' },
    { ...common, ...people.marcus, day: addDays(today, 3), startHour: 12, durationMinutes: 90, type: 'activity', title: 'Contractor Mobilisation Review', notes: 'Confirm induction completion and site-access readiness.', attendeeCount: 4, colorKey: 'blue', sourceModule: 'meetings', sourceRef: 'MTG-DEMO-MOB', sourceRoute: 's-meetings', sourceLabel: 'Meeting', sourceDepartment: 'operations', sourceDepartmentLabel: 'Operations' },
    { ...common, ...people.darius, day: addDays(today, 3), startHour: 15, startMinute: 15, durationMinutes: 30, type: 'activity', title: 'Upload CAPA Evidence', notes: 'Reminder to attach final photographs and owner sign-off.', colorKey: 'slate', sourceModule: 'calendar', sourceRef: 'REM-DEMO-CAPA', sourceLabel: 'Reminder', sourceDepartment: 'hse', sourceDepartmentLabel: 'HSE' },

    { ...common, ...people.marcus, day: addDays(today, 4), startHour: 8, startMinute: 45, durationMinutes: 60, type: 'activity', title: 'Permit-to-work Coordination', notes: 'Review simultaneous operations and confirm permit dependencies.', attendeeCount: 5, colorKey: 'blue', sourceModule: 'meetings', sourceRef: 'MTG-DEMO-PTW', sourceRoute: 's-meetings', sourceLabel: 'Meeting', sourceDepartment: 'operations', sourceDepartmentLabel: 'Operations' },
    { ...common, ...people.darius, day: addDays(today, 4), startHour: 10, durationMinutes: 75, type: 'task', title: 'Publish Field Inspection Pack', notes: 'Attach the final inspection pack to the linked incident.', status: 'in_progress', priority: 'medium', colorKey: 'purple', assigneeUserId: 'demo-darius', assigneeName: 'Darius King', sourceModule: 'hse', sourceRef: 'TSK-DEMO-PACK', sourceRoute: 's-hse-incidents', sourceLabel: 'Task', sourceDepartment: 'hse', sourceDepartmentLabel: 'HSE' },
    { ...common, ...people.alicia, day: addDays(today, 4), startHour: 13, durationMinutes: 90, type: 'activity', title: 'Leadership Risk Review', notes: 'Review material risks and confirm escalation and mitigation owners.', attendeeCount: 7, colorKey: 'blue', visibility: 'org', sourceModule: 'meetings', sourceRef: 'MTG-DEMO-RISK', sourceRoute: 's-meetings', sourceLabel: 'Meeting', sourceDepartment: 'operations', sourceDepartmentLabel: 'Operations' },
    { ...common, ...people.jordan, day: addDays(today, 4), startHour: 16, durationMinutes: 30, type: 'deadline', origin: 'workflow', title: 'Mobilisation Gate Ready', notes: 'Readiness milestone for access, permits and crew coverage.', colorKey: 'mint', sourcePriority: 'normal', sourceModule: 'planning', sourceRef: 'MS-DEMO-001', sourceLabel: 'Milestone', sourceDepartment: 'operations', sourceDepartmentLabel: 'Operations' },

    { ...common, ...people.marcus, day: addDays(today, 5), startHour: 9, durationMinutes: 30, type: 'deadline', origin: 'module', title: 'Payroll Variance Submission', notes: 'Final approved variance summary due to Payroll.', colorKey: 'amber', sourcePriority: 'high', sourceModule: 'payroll', sourceRef: 'PAY-2026-09', sourceRoute: 's-payroll', sourceLabel: 'Payroll Deadline', sourceDepartment: 'payroll', sourceDepartmentLabel: 'Payroll' },
    { ...common, ...people.jordan, day: addDays(today, 5), startHour: 11, durationMinutes: 60, type: 'activity', title: 'Monthly Compliance Forum', notes: 'Review regulatory commitments and outstanding audit evidence.', attendeeCount: 8, colorKey: 'blue', visibility: 'org', sourceModule: 'meetings', sourceRef: 'MTG-DEMO-COMPLIANCE', sourceRoute: 's-meetings', sourceLabel: 'Meeting', sourceDepartment: 'operations', sourceDepartmentLabel: 'Operations' },
    { ...common, ...people.alicia, day: addDays(today, 5), startHour: 14, durationMinutes: 60, type: 'task', title: 'Complete Incident Briefing', notes: 'Issue the approved incident brief and acknowledge distribution.', status: 'in_review', priority: 'medium', colorKey: 'blue', assigneeUserId: 'demo-alicia', assigneeName: 'Alicia Moore', sourceModule: 'hse', sourceRef: 'TSK-DEMO-BRIEF', sourceRoute: 's-hse-incidents', sourceLabel: 'Task', sourceDepartment: 'hse', sourceDepartmentLabel: 'HSE' },

    { ...common, ...people.alicia, day: addDays(today, 6), type: 'deadline', origin: 'workflow', title: 'Offshore Supply Arrival', notes: 'Planned supply-vessel arrival and controlled unloading window.', colorKey: 'blue', locationLabel: 'Marine Base · Berth 4', sourcePriority: 'normal', sourceModule: 'planning', sourceRef: 'MS-DEMO-SUPPLY', sourceLabel: 'Milestone', sourceDepartment: 'operations', sourceDepartmentLabel: 'Operations' },
    { ...common, ...people.darius, day: addDays(today, 6), startHour: 9, durationMinutes: 60, type: 'activity', title: 'Weekend Maintenance Window', notes: 'Planned isolation and preventive maintenance window.', colorKey: 'slate', sourceModule: 'calendar', sourceRef: 'EVT-DEMO-MAINT', sourceLabel: 'Maintenance', sourceDepartment: 'operations', sourceDepartmentLabel: 'Operations' },
    { ...common, ...people.marcus, day: addDays(today, 6), startHour: 12, durationMinutes: 60, type: 'activity', title: 'Weekly Closeout Review', notes: 'Close completed actions and carry forward controlled exceptions.', attendeeCount: 4, colorKey: 'blue', sourceModule: 'meetings', sourceRef: 'MTG-DEMO-CLOSE', sourceRoute: 's-meetings', sourceLabel: 'Meeting', sourceDepartment: 'operations', sourceDepartmentLabel: 'Operations' },
    { ...common, ...people.jordan, day: addDays(today, 6), startHour: 15, startMinute: 30, durationMinutes: 45, type: 'task', title: 'Archive Weekly Records', notes: 'File approved permits, briefings and inspection evidence.', status: 'not_started', priority: 'low', colorKey: 'purple', assigneeUserId: 'demo-jordan', assigneeName: 'Jordan Peters', sourceModule: 'calendar', sourceRef: 'TSK-DEMO-ARCHIVE', sourceLabel: 'Task' },
  ];
  const personalCalendar = CALENDAR_STAGING_CALENDARS[0]!;
  return values.map((value, index) => ({
    ...stagedItem(value, index),
    calendarId: personalCalendar.id,
    calendarName: personalCalendar.name,
  }));
}

/** Apply the same editable fields as the live update contract to one staged
 * card without pretending that the preview has a backend record. */
export function applyCalendarStagingPatch(item: CalendarItemDTO, patch: UpdateEntryRequest['patch']): CalendarItemDTO {
  let colorKey = patch.colorKey !== undefined ? patch.colorKey : item.colorKey;
  let customColor = patch.customColor !== undefined ? patch.customColor : item.customColor;
  if (patch.customColor) colorKey = null;
  else if (patch.colorKey) customColor = null;
  return {
    ...item,
    title: patch.title ?? item.title,
    titleIconType: patch.titleIconType !== undefined ? patch.titleIconType : item.titleIconType,
    titleIconValue: patch.titleIconValue !== undefined ? patch.titleIconValue : item.titleIconValue,
    notes: patch.notes !== undefined ? patch.notes : item.notes,
    allDay: patch.allDay ?? item.allDay,
    startsOn: patch.startsOn !== undefined ? patch.startsOn : item.startsOn,
    endsOn: patch.endsOn !== undefined ? patch.endsOn : item.endsOn,
    startsAt: patch.startsAt !== undefined ? patch.startsAt : item.startsAt,
    endsAt: patch.endsAt !== undefined ? patch.endsAt : item.endsAt,
    deadlineAt: patch.deadlineAt !== undefined ? patch.deadlineAt : item.deadlineAt,
    priority: patch.priority ?? item.priority,
    visibility: patch.visibility ?? item.visibility,
    assigneeUserId: patch.assigneeUserId !== undefined ? patch.assigneeUserId : item.assigneeUserId,
    departmentId: patch.departmentId !== undefined ? patch.departmentId : item.departmentId,
    locationLabel: patch.locationLabel !== undefined ? patch.locationLabel : item.locationLabel,
    calendarId: patch.calendarId !== undefined ? patch.calendarId : item.calendarId,
    colorKey,
    customColor,
  };
}

const DEMO_ATTENDEES: CalendarStagedAttendee[] = [
  { userId: 'demo-alicia', name: 'Alicia Moore', role: 'Organizer', profileImage: aliciaAvatar, responseStatus: 'accepted' },
  { userId: 'demo-marcus', name: 'Marcus Allen', role: 'Operations Supervisor', profileImage: marcusAvatar, responseStatus: 'accepted' },
  { userId: 'demo-darius', name: 'Darius King', role: 'HSE Lead', profileImage: dariusAvatar, responseStatus: 'tentative' },
  { userId: 'demo-jordan', name: 'Jordan Peters', role: 'Site Manager', profileImage: jordanAvatar, responseStatus: 'invited' },
];

/** Complete employee set available to Calendar's governed staging editor. */
export function calendarStagingDirectory(): CalendarStagedAttendee[] {
  return DEMO_ATTENDEES.map(person => ({ ...person }));
}

/** Representative SIOMAC employees only for staged meetings. Standard events,
 * tasks, deadlines and reminders stay icon-led even when they track attendance. */
export function calendarStagingPeople(item: CalendarItemDTO): CalendarStagedAttendee[] {
  const showsParticipants = item.kind === 'meeting' && item.attendeeCount > 0;
  if (!showsParticipants) return [];
  const requested = Math.max(1, Math.min(DEMO_ATTENDEES.length, item.attendeeCount || 1));
  const ownerIndex = DEMO_ATTENDEES.findIndex(person => person.userId === item.ownerUserId || person.userId === item.assigneeUserId);
  const ordered = ownerIndex < 0
    ? DEMO_ATTENDEES
    : [DEMO_ATTENDEES[ownerIndex]!, ...DEMO_ATTENDEES.filter((_, index) => index !== ownerIndex)];
  return ordered.slice(0, requested);
}

/** Rich, read-only detail used by governed Calendar staging. Operational data
 * continues to come from Calendar and Meetings APIs in standard mode. */
export function calendarStagingDetail(item: CalendarItemDTO): CalendarStagedDetail | null {
  if (item.sourceModule !== 'meetings') return null;
  const agendaBySourceRef: Readonly<Record<string, readonly string[]>> = {
    'MTG-DEMO-TODAY': ['Confirm site access and permit status', 'Review mobilisation blockers', 'Assign owners for today’s field actions'],
    'MTG-DEMO-SAFETY': ['Review open corrective actions', 'Verify deck-inspection evidence', 'Confirm field-team owners and due dates'],
    'MTG-DEMO-NIGHT': ['Confirm overnight priorities', 'Validate shift coverage', 'Review escalation contacts'],
    'MTG-DEMO-OPS': ['Review operational readiness', 'Assign owners for open actions', 'Align mobilisation priorities'],
    'MTG-DEMO-KICKOFF': ['Confirm contractor induction status', 'Review permit dependencies', 'Align delivery sequencing'],
    'MTG-DEMO-CAPA': ['Review evidence readiness', 'Identify overdue corrective actions', 'Confirm unblock owners'],
    'MTG-DEMO-MOB': ['Confirm induction completion', 'Review site-access readiness', 'Close mobilisation blockers'],
    'MTG-DEMO-PTW': ['Review simultaneous operations', 'Confirm permit dependencies', 'Assign coordination owners'],
    'MTG-DEMO-RISK': ['Review material risks', 'Confirm mitigation owners', 'Agree escalation thresholds'],
    'MTG-DEMO-COMPLIANCE': ['Review regulatory commitments', 'Check outstanding audit evidence', 'Confirm closeout owners'],
    'MTG-DEMO-CLOSE': ['Close completed actions', 'Review controlled exceptions', 'Agree next-week carryovers'],
  };
  return {
    agenda: item.sourceRef ? [...(agendaBySourceRef[item.sourceRef] ?? [item.notes ?? 'Review the scheduled meeting topic'])] : [item.notes ?? 'Review the scheduled meeting topic'],
    attendees: calendarStagingPeople(item),
    myResponse: 'invited',
    updatedLabel: '2 hours ago',
    joinAvailable: false,
    comments: [
      { id: 'demo-comment-1', author: 'Marcus Allen', body: 'I added the final crew coverage note for review.', createdLabel: '12 minutes ago' },
    ],
  };
}

/** Reminder examples are explicit so staged cards without a reminder never
 * imply that every SIOMAC calendar item is automatically notified. */
export function calendarStagingReminderOffsets(item: CalendarItemDTO): number[] {
  const offsetsBySourceRef: Readonly<Record<string, number>> = {
    'MTG-DEMO-TODAY': 15,
    'MTG-DEMO-SAFETY': 30,
    'MTG-DEMO-OPS': 15,
    'DUE-DEMO-001': 60,
    'MTG-DEMO-CAPA': 30,
  };
  const offset = item.sourceRef ? offsetsBySourceRef[item.sourceRef] : undefined;
  return offset === undefined ? [] : [offset];
}
