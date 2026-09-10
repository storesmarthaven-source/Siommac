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

interface DailyStagingContent {
  code: string;
  allDayEvent: string;
  allDayTask: string;
  longEvent: string;
  morningMeeting: string;
  pairedEvent: string;
  task: string;
  deadline: string;
  afternoonEvent: string;
  reminder: string;
  eveningMeeting: string;
  location: string;
}

interface DailyStagingPalette {
  allDayEvent: NonNullable<CalendarItemDTO['colorKey']>;
  allDayTask: NonNullable<CalendarItemDTO['colorKey']>;
  longEvent: NonNullable<CalendarItemDTO['colorKey']>;
  pairedEvent: NonNullable<CalendarItemDTO['colorKey']>;
  deadline: NonNullable<CalendarItemDTO['colorKey']>;
  afternoonEvent: NonNullable<CalendarItemDTO['colorKey']>;
  reminder: NonNullable<CalendarItemDTO['colorKey']>;
}

const DAILY_STAGING_CONTENT: readonly DailyStagingContent[] = [
  { code: 'SUN', allDayEvent: 'Marine Operations Day', allDayTask: 'Validate Weekend Access', longEvent: 'Marine Logistics Window', morningMeeting: 'Sunday Readiness Huddle', pairedEvent: 'Visitor Escort Coordination', task: 'Close Permit Actions', deadline: 'Crew Manifest Cutoff', afternoonEvent: 'Equipment Readiness Walk', reminder: 'Send Access Reminder', eveningMeeting: 'Night Operations Handoff', location: 'Marine Base · Operations Desk' },
  { code: 'MON', allDayEvent: 'Contractor Induction Day', allDayTask: 'Reconcile Training Records', longEvent: 'Warehouse Dispatch Window', morningMeeting: 'Monday Mobilisation Sync', pairedEvent: 'Forklift Route Inspection', task: 'Review Isolation Pack', deadline: 'Vendor Documents Due', afternoonEvent: 'Quayside Safety Walk', reminder: 'Confirm Shuttle Roster', eveningMeeting: 'Evening Shift Handoff', location: 'Central Warehouse · Dispatch Bay' },
  { code: 'TUE', allDayEvent: 'Field Assurance Day', allDayTask: 'Validate Equipment Register', longEvent: 'North Compound Access Window', morningMeeting: 'Contractor Delivery Sync', pairedEvent: 'Temporary Works Review', task: 'Approve Relief Roster', deadline: 'Insurance Evidence Cutoff', afternoonEvent: 'Laydown Yard Inspection', reminder: 'Notify Delivery Leads', eveningMeeting: 'Site Coverage Handoff', location: 'North Compound · Gate 4' },
  { code: 'WED', allDayEvent: 'Compliance Review Day', allDayTask: 'Verify Certification Records', longEvent: 'Lifting Equipment Window', morningMeeting: 'Corrective Action Review', pairedEvent: 'Evidence Quality Check', task: 'Prepare Audit Responses', deadline: 'Certification Evidence Due', afternoonEvent: 'Supplier Mobilisation Review', reminder: 'Upload Inspection Evidence', eveningMeeting: 'Midweek Control Handoff', location: 'Operations Centre · Assurance Room' },
  { code: 'THU', allDayEvent: 'Permit Coordination Day', allDayTask: 'Publish Control Register', longEvent: 'Simultaneous Operations Window', morningMeeting: 'SIMOPS Coordination', pairedEvent: 'Workfront Sequencing Review', task: 'Issue Inspection Summary', deadline: 'Permit Activation Cutoff', afternoonEvent: 'Leadership Controls Review', reminder: 'Confirm Permit Owners', eveningMeeting: 'Late Shift Readiness Handoff', location: 'South Field · Permit Office' },
  { code: 'FRI', allDayEvent: 'Weekly Assurance Day', allDayTask: 'Close Outstanding Findings', longEvent: 'Payroll Review Window', morningMeeting: 'Friday Assurance Forum', pairedEvent: 'Training Completion Review', task: 'Distribute Safety Bulletin', deadline: 'Overtime Approval Cutoff', afternoonEvent: 'Weekly Control Closeout', reminder: 'Send Action Digest', eveningMeeting: 'Weekend Coverage Handoff', location: 'Head Office · Assurance Suite' },
  { code: 'SAT', allDayEvent: 'Weekend Logistics Day', allDayTask: 'Archive Compliance Records', longEvent: 'Workshop Maintenance Window', morningMeeting: 'Weekend Coordination Huddle', pairedEvent: 'Supply Delivery Window', task: 'Reconcile Maintenance Log', deadline: 'Service Report Cutoff', afternoonEvent: 'Stores Inventory Review', reminder: 'Confirm Monday Deliveries', eveningMeeting: 'Weekend Operations Handoff', location: 'Maintenance Hub · Workshop 2' },
];

const DAILY_STAGING_PALETTES: readonly DailyStagingPalette[] = [
  { allDayEvent: 'teal', allDayTask: 'amber', longEvent: 'amber', pairedEvent: 'coral', deadline: 'coral', afternoonEvent: 'mint', reminder: 'slate' },
  { allDayEvent: 'mint', allDayTask: 'purple', longEvent: 'coral', pairedEvent: 'teal', deadline: 'amber', afternoonEvent: 'slate', reminder: 'teal' },
  { allDayEvent: 'purple', allDayTask: 'coral', longEvent: 'mint', pairedEvent: 'amber', deadline: 'coral', afternoonEvent: 'teal', reminder: 'slate' },
  { allDayEvent: 'amber', allDayTask: 'slate', longEvent: 'purple', pairedEvent: 'mint', deadline: 'amber', afternoonEvent: 'coral', reminder: 'teal' },
  { allDayEvent: 'teal', allDayTask: 'purple', longEvent: 'slate', pairedEvent: 'coral', deadline: 'mint', afternoonEvent: 'amber', reminder: 'slate' },
  { allDayEvent: 'coral', allDayTask: 'mint', longEvent: 'amber', pairedEvent: 'purple', deadline: 'amber', afternoonEvent: 'teal', reminder: 'slate' },
  { allDayEvent: 'slate', allDayTask: 'amber', longEvent: 'mint', pairedEvent: 'coral', deadline: 'purple', afternoonEvent: 'amber', reminder: 'teal' },
];

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
 * browser-local preview state and never mutate operational records. */
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
  const values: StagedItem[] = DAILY_STAGING_CONTENT.flatMap((content, dayOffset) => {
    const day = addDays(today, dayOffset);
    const palette = DAILY_STAGING_PALETTES[dayOffset]!;
    const ref = (role: string) => `STG-${content.code}-${role}`;
    return [
      { ...common, ...people.alicia, day, type: 'activity', title: content.allDayEvent, titleIconType: 'emoji', titleIconValue: '📅', notes: 'An all-day operational window for coordinated work, access and handoffs.', colorKey: palette.allDayEvent, locationLabel: content.location, sourceModule: 'operations', sourceRef: ref('ALL-DAY-EVENT'), sourceLabel: 'Event', sourceDepartment: 'operations', sourceDepartmentLabel: 'Operations' },
      { ...common, ...people.darius, day, type: 'task', title: content.allDayTask, titleIconType: 'lucide', titleIconValue: 'ClipboardCheck', notes: 'Complete the scheduled assurance action before the end of the day.', status: 'not_started', priority: 'high', colorKey: palette.allDayTask, assigneeUserId: 'demo-darius', assigneeName: 'Darius King', sourceModule: 'calendar', sourceRef: ref('ALL-DAY-TASK'), sourceLabel: 'Task', sourceDepartment: 'calendar', sourceDepartmentLabel: 'Calendar' },
      { ...common, ...people.alicia, day, startHour: 6, startMinute: 30, durationMinutes: 150, type: 'activity', title: content.longEvent, titleIconType: 'lucide', titleIconValue: 'MapPin', notes: 'A longer operational window staged to demonstrate full-height and full-width calendar cards.', colorKey: palette.longEvent, locationLabel: content.location, sourceModule: 'operations', sourceRef: ref('LONG-EVENT'), sourceLabel: 'Field Operation', sourceDepartment: 'operations', sourceDepartmentLabel: 'Operations' },
      { ...common, ...people.marcus, day, startHour: 9, startMinute: 30, durationMinutes: 105, type: 'activity', title: content.morningMeeting, titleIconType: 'lucide', titleIconValue: 'Video', notes: 'Review readiness, assign owners and confirm the day’s operational handoffs.', attendeeCount: 5, colorKey: 'blue', locationLabel: content.location, sourceModule: 'meetings', sourceRef: ref('MORNING-MEETING'), sourceRoute: 's-meetings', sourceLabel: 'Meeting', sourceDepartment: 'operations', sourceDepartmentLabel: 'Operations' },
      { ...common, ...people.alicia, day, startHour: 9, startMinute: 30, durationMinutes: 105, type: 'activity', title: content.pairedEvent, titleIconType: 'emoji', titleIconValue: '👋', notes: 'A same-start event staged beside the meeting to demonstrate overlap and card stacking.', colorKey: palette.pairedEvent, locationLabel: content.location, sourceModule: 'calendar', sourceRef: ref('PAIRED-EVENT'), sourceLabel: 'Event', sourceDepartment: 'calendar', sourceDepartmentLabel: 'Calendar' },
      { ...common, ...people.darius, day, startHour: 11, startMinute: 45, durationMinutes: 45, type: 'task', title: content.task, titleIconType: 'lucide', titleIconValue: 'ListChecks', notes: 'Complete and record the assigned operational action.', status: 'in_progress', priority: 'high', colorKey: 'purple', assigneeUserId: 'demo-darius', assigneeName: 'Darius King', sourceModule: 'calendar', sourceRef: ref('TASK'), sourceLabel: 'Task', sourceDepartment: 'calendar', sourceDepartmentLabel: 'Calendar' },
      { ...common, ...people.jordan, day, startHour: 12, startMinute: 45, durationMinutes: 30, type: 'deadline', origin: 'workflow', title: content.deadline, titleIconType: 'lucide', titleIconValue: 'Flag', notes: 'A time-bound submission point staged as the shortest supported card.', colorKey: palette.deadline, sourcePriority: 'high', sourceModule: 'compliance', sourceRef: ref('DEADLINE'), sourceLabel: 'Deadline', sourceDepartment: 'operations', sourceDepartmentLabel: 'Operations' },
      { ...common, ...people.alicia, day, startHour: 14, durationMinutes: 75, type: 'activity', title: content.afternoonEvent, titleIconType: 'emoji', titleIconValue: '🦺', notes: 'A medium-length field activity for demonstrating varied card color and size.', colorKey: palette.afternoonEvent, locationLabel: content.location, sourceModule: 'hse', sourceRef: ref('AFTERNOON-EVENT'), sourceLabel: 'Safety Inspection', sourceDepartment: 'hse', sourceDepartmentLabel: 'HSE' },
      { ...common, ...people.marcus, day, startHour: 16, durationMinutes: 30, type: 'activity', title: content.reminder, titleIconType: 'lucide', titleIconValue: 'Bell', notes: 'A concise reminder staged without meeting actions or attendee avatars.', colorKey: palette.reminder, sourceModule: 'calendar', sourceRef: ref('REMINDER'), sourceLabel: 'Reminder', sourceDepartment: 'calendar', sourceDepartmentLabel: 'Calendar' },
      { ...common, ...people.jordan, day, startHour: 18, startMinute: 30, durationMinutes: 90, type: 'activity', title: content.eveningMeeting, titleIconType: 'emoji', titleIconValue: '🌙', notes: 'Confirm completed work, outstanding exceptions and overnight coverage.', attendeeCount: 4, colorKey: 'blue', locationLabel: content.location, sourceModule: 'meetings', sourceRef: ref('EVENING-MEETING'), sourceRoute: 's-meetings', sourceLabel: 'Meeting', sourceDepartment: 'operations', sourceDepartmentLabel: 'Operations' },
    ];
  });
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
    availability: patch.availability !== undefined ? patch.availability : item.availability,
    assigneeUserId: patch.assigneeUserId !== undefined ? patch.assigneeUserId : item.assigneeUserId,
    departmentId: patch.departmentId !== undefined ? patch.departmentId : item.departmentId,
    locationLabel: patch.locationLabel !== undefined ? patch.locationLabel : item.locationLabel,
    calendarId: patch.calendarId !== undefined ? patch.calendarId : item.calendarId,
    categoryId: patch.categoryId !== undefined ? patch.categoryId : item.categoryId,
    recurrenceRule: patch.recurrenceRule !== undefined ? patch.recurrenceRule : item.recurrenceRule,
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
  const isEveningHandoff = item.sourceRef?.endsWith('-EVENING-MEETING');
  const agenda = isEveningHandoff
    ? ['Review completed work and open exceptions', 'Confirm overnight coverage and escalation contacts', 'Assign owners for carry-over actions']
    : ['Review the day’s readiness constraints', 'Confirm accountable owners and due times', 'Agree operational handoffs and escalation points'];
  return {
    agenda,
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
  if (item.sourceRef?.endsWith('-MORNING-MEETING')) return [15];
  if (item.sourceRef?.endsWith('-EVENING-MEETING')) return [30];
  if (item.sourceRef?.endsWith('-DEADLINE')) return [60];
  return [];
}
