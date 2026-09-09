/**
 * types/calendar.ts
 *
 * THE shared Calendar contract — one camelCase DTO imported by BOTH the backend
 * (netlify/functions/routes/calendar.ts + adapters) and the frontend (calendar
 * page, widgets, api client). Single source of truth: do NOT define a second
 * per-endpoint shape or a dual alias (that was the root cause of the messaging
 * "lists but won't open" bug — see types/messaging.ts).
 *
 * The read model is deliberately view-agnostic: the full Calendar page, the
 * Upcoming-Deadlines widget, and the Tasks widget all render CalendarItemDTO.
 * AUTHZ IS SERVER-COMPUTED: the client must never infer what it can do from
 * ownership, type, role, source module, or visibility — it reads the explicit
 * capability booleans the server returns.
 */

import type { OnboardingReadScope } from './hrOnboarding';

export type CalendarItemType   = 'deadline' | 'task' | 'activity';
export type CalendarEntryKind  = 'event' | 'meeting' | 'task' | 'deadline' | 'reminder';
export type CalendarAvailability = 'busy' | 'free' | 'tentative' | 'out_of_office';
export type CalendarItemOrigin = 'calendar' | 'module' | 'workflow';
/** Task lifecycle (overdue is DERIVED from the due date, never stored). */
export type CalendarTaskStatus = 'not_started' | 'in_progress' | 'in_review' | 'blocked' | 'done' | 'cancelled';
export type CalendarTaskPriority = 'low' | 'medium' | 'high';
/** User-selected visual identity. `null` lets the client derive a source-aware tone. */
export const CALENDAR_COLOR_KEYS = ['blue', 'indigo', 'purple', 'rose', 'coral', 'amber', 'lime', 'mint', 'teal', 'slate'] as const;
export type CalendarColorKey = (typeof CALENDAR_COLOR_KEYS)[number];
export const CALENDAR_TITLE_ICON_TYPES = ['emoji', 'lucide'] as const;
export type CalendarTitleIconType = (typeof CALENDAR_TITLE_ICON_TYPES)[number];
/** Curated, calendar-appropriate icons exposed by the editor. Keeping this
 * allowlist in the shared contract prevents persisted names from drifting away
 * from the UI kit's supported Lucide set. */
export const CALENDAR_LUCIDE_TITLE_ICONS = [
  'CalendarDays', 'Video', 'ListChecks', 'Bell', 'Flag', 'MapPin',
  'BriefcaseBusiness', 'Users', 'Presentation', 'ClipboardCheck',
  'ShieldCheck', 'Wrench', 'Building2', 'Plane', 'CakeSlice', 'Sparkles',
] as const;
export type CalendarLucideTitleIcon = (typeof CALENDAR_LUCIDE_TITLE_ICONS)[number];
/** Priority supplied by a module-owned deadline. Native calendar tasks use CalendarTaskPriority. */
export type CalendarSourcePriority = 'low' | 'normal' | 'medium' | 'high' | 'critical';
export type CalendarSourceDepartment = 'calendar' | 'finance' | 'human_resource' | 'payroll' | 'hse' | 'it' | 'operations' | 'department';
export type CalendarVisibility = 'personal' | 'team' | 'org';
export type CalendarAttendeeResponse = 'invited' | 'accepted' | 'declined' | 'tentative';
export type CalendarProvider = 'google' | 'microsoft' | 'apple' | 'exchange';

export interface CalendarCategoryDTO {
  id: string;
  key: string;
  name: string;
  iconName: string;
  scope: 'system' | 'organisation';
  sortOrder: number;
  active: boolean;
  canManage: boolean;
}

/** A durable calendar container shown under My Calendars. Categories and source
 * modules are filters, not calendars, and therefore never use this contract. */
export interface CalendarCollectionDTO {
  id: string;
  name: string;
  description: string | null;
  ownerUserId: string;
  ownerName: string | null;
  visibility: CalendarVisibility;
  departmentId: string | null;
  departmentName: string | null;
  colorKey: CalendarColorKey | null;
  customColor: string | null;
  isDefault: boolean;
  status: 'active' | 'archived';
  canEdit: boolean;
  canArchive: boolean;
  /** External calendars are imported read-only; null identifies a native SIOMAC calendar. */
  provider: CalendarProvider | null;
  readOnly: boolean;
}

export interface ExternalCalendarDTO {
  id: string;
  providerCalendarId: string;
  name: string;
  description: string | null;
  providerColor: string | null;
  timeZone: string | null;
  accessRole: string | null;
  isPrimary: boolean;
  enabled: boolean;
  collectionId: string | null;
}

export interface CalendarConnectionDTO {
  id: string;
  provider: CalendarProvider;
  displayName: string;
  accountEmail: string | null;
  status: 'active' | 'error';
  syncDirection: 'import';
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  calendars: ExternalCalendarDTO[];
  canSync: boolean;
  canDisconnect: boolean;
}

export interface CalendarProviderAvailabilityDTO {
  provider: CalendarProvider;
  configured: boolean;
  connectionMethod: 'oauth' | 'credentials';
  configurationMessage: string | null;
}

export interface CalendarConnectionsResponse {
  success: boolean;
  providers: CalendarProviderAvailabilityDTO[];
  connections: CalendarConnectionDTO[];
  message?: string;
}

export interface StartCalendarOAuthRequest {
  provider: Extract<CalendarProvider, 'google' | 'microsoft'>;
}

export interface CompleteCalendarOAuthRequest {
  code: string;
  state: string;
}

export interface ConnectCalendarCredentialsRequest {
  provider: Extract<CalendarProvider, 'apple' | 'exchange'>;
  username: string;
  password: string;
  /** Required for an on-premises Exchange Server EWS endpoint. */
  serverUrl?: string;
}

export interface ToggleExternalCalendarRequest {
  externalCalendarId: string;
  enabled: boolean;
  colorKey?: CalendarColorKey;
  idempotencyKey: string;
}

export interface CalendarAttendeeDTO {
  userId:         string;
  responseStatus: CalendarAttendeeResponse;
  respondedAt:    string | null;
}

/** One normalized dated item. Deadlines are projected by source adapters; tasks
 *  and activities are native `calendar_entries`. Recurrence occurrences are
 *  expanded server-side and carry `occurrenceDate` + a compound `id`. */
export interface CalendarItemDTO {
  /** Native entry id, or `${entryId}::${occurrenceDate}` for a recurrence
   *  occurrence, or `${sourceModule}:${sourceRef}` for a projected deadline. */
  id:                 string;
  type:               CalendarItemType;
  /** Honest user-facing workflow. `type` remains the storage/behaviour family. */
  kind:               CalendarEntryKind;
  origin:             CalendarItemOrigin;
  title:              string;
  /** Optional user-selected glyph shown immediately before the title. */
  titleIconType?:     CalendarTitleIconType | null;
  titleIconValue?:    string | null;
  notes:              string | null;
  colorKey:           CalendarColorKey | null;
  /** Validated six-digit hex override selected with the Custom colour control. */
  customColor:        string | null;
  /** Human-readable physical destination. Only populated for on-site work. */
  locationLabel:      string | null;
  categoryId:         string | null;
  categoryKey:        string | null;
  categoryName:       string | null;
  categoryIcon:       string | null;
  availability:       CalendarAvailability | null;
  /** Native entries belong to one real calendar collection. Projected module
   * deadlines may be null because their source module remains authoritative. */
  calendarId?:        string | null;
  calendarName?:      string | null;

  allDay:             boolean;
  startsOn:           string | null;   // 'YYYY-MM-DD' (all-day)
  endsOn:             string | null;   // 'YYYY-MM-DD'
  startsAt:           string | null;   // ISO timestamptz (timed)
  endsAt:             string | null;   // ISO timestamptz

  /** Optional accountability point independent of the item's scheduled span.
   * Events use it for registration, RSVP, or required actions; tasks use it
   * for completion. Legacy/module `kind: 'deadline'` projections remain
   * supported, but new native deadlines are stored on an event or task. */
  deadlineAt?:        string | null;   // ISO timestamptz

  status:             CalendarTaskStatus | null;   // tasks only
  priority:           CalendarTaskPriority | null;  // tasks only
  /** Optional source-record priority for projected module deadlines. */
  sourcePriority?:     CalendarSourcePriority | null;
  ownerUserId:        string | null;
  ownerName:          string | null;
  assigneeUserId:     string | null;
  assigneeName:       string | null;
  /** Native calendar-entry department scope. Module deadlines use sourceDepartment instead. */
  departmentId:       string | null;
  departmentName:     string | null;
  attendeeCount:      number;
  visibility:         CalendarVisibility | null;

  // Source link (deadlines + optionally tasks/activities that reference a record).
  sourceModule:       string | null;
  sourceRef:          string | null;
  sourceRoute:        string | null;   // drill-through target (section id / route)
  sourceLabel:        string | null;
  /** Department ownership for events/deadlines, used for source tags and filters. */
  sourceDepartment:   CalendarSourceDepartment | null;
  sourceDepartmentLabel: string | null;

  // Recurrence.
  recurrenceSeriesId: string | null;
  recurrenceRule:     string | null;   // RRULE string on the master
  occurrenceDate:     string | null;   // 'YYYY-MM-DD' for an expanded occurrence

  // Server-computed capabilities — the ONLY authz the client may trust.
  editable:           boolean;
  completable:        boolean;
  assignable:         boolean;
  cancelable:         boolean;
  drillThrough:       boolean;
}

// ── Request / response envelopes ────────────────────────────────────────────

export interface CalendarListRequest {
  /** Inclusive local-date window, 'YYYY-MM-DD'. Recurrence is expanded within it. */
  from:           string;
  to:             string;
  types?:         CalendarItemType[];
  kinds?:         CalendarEntryKind[];
  categoryIds?:   string[];
  sourceModules?: string[];
  ownerUserId?:   string;
  assigneeUserId?: string;
  statuses?:      CalendarTaskStatus[];
  priorities?:    CalendarTaskPriority[];
  /** Applies only to onboarding-backed deadline projections; resolved and enforced server-side. */
  onboardingScope?: OnboardingReadScope;
}

export interface CalendarListResponse {
  success: boolean;
  items:   CalendarItemDTO[];
  range:   { from: string; to: string };
  message?: string;
}

/** How a recurrence edit/cancel applies. */
export type RecurrenceScope = 'occurrence' | 'series';

export interface CreateTaskRequest {
  calendarId:     string;
  kind?:           Extract<CalendarEntryKind, 'task'>;
  categoryId?:     string;
  title:          string;
  titleIconType?: CalendarTitleIconType | null;
  titleIconValue?: string | null;
  notes?:         string | null;
  allDay?:        boolean;
  startsOn?:      string | null;
  endsOn?:        string | null;
  startsAt?:      string | null;
  endsAt?:        string | null;
  deadlineAt?:    string | null;
  assigneeUserId?: string | null;   // requires calendar.task.assign; validated server-side
  departmentId?:   string | null;   // department-scoped task; requires calendar.manage
  priority?:      CalendarTaskPriority;   // defaults to 'medium'
  visibility?:    CalendarVisibility;
  recurrenceRule?: string | null;
  colorKey?:       CalendarColorKey | null;
  customColor?:    string | null;
  locationLabel?:  string | null;
  reminderOffsets?: number[];
}

/** Read-only day metadata shown in the calendar header. Holidays are not
 * calendar entries: they never occupy a timeline lane or behave like events. */
export interface CalendarHolidayMarkerDTO {
  id: string;
  date: string;
  name: string;
  statutoryName: string;
  holidayType: 'statutory' | 'proclaimed' | 'movable';
  dayFraction: number;
  calendarName: string;
  sourceReference: string;
}

export interface CalendarDayContextRequest {
  from: string;
  to: string;
  jurisdiction: 'TT';
}

export interface CalendarDayContextResponse {
  success: boolean;
  holidays: CalendarHolidayMarkerDTO[];
  range: { from: string; to: string };
  message?: string;
}

export interface CreateActivityRequest {
  calendarId:     string;
  kind?:           Extract<CalendarEntryKind, 'event' | 'reminder'>;
  categoryId?:     string;
  availability?:   CalendarAvailability;
  title:          string;
  titleIconType?: CalendarTitleIconType | null;
  titleIconValue?: string | null;
  notes?:         string | null;
  allDay?:        boolean;
  startsOn?:      string | null;
  endsOn?:        string | null;
  startsAt?:      string | null;
  endsAt?:        string | null;
  deadlineAt?:    string | null;
  visibility?:    CalendarVisibility;
  departmentId?:  string | null;    // department-scoped activity; requires calendar.manage
  attendeeUserIds?: string[];
  recurrenceRule?: string | null;
  colorKey?:       CalendarColorKey | null;
  customColor?:    string | null;
  locationLabel?:  string | null;
  reminderOffsets?: number[];
}

export interface UpdateEntryRequest {
  id:             string;
  scope?:         RecurrenceScope;   // for recurring items; default 'series'
  occurrenceDate?: string;           // required when scope = 'occurrence'
  patch: {
    title?:       string;
    titleIconType?: CalendarTitleIconType | null;
    titleIconValue?: string | null;
    notes?:       string | null;
    allDay?:      boolean;
    startsOn?:    string | null;
    endsOn?:      string | null;
    startsAt?:    string | null;
    endsAt?:      string | null;
    deadlineAt?:  string | null;
    assigneeUserId?: string | null;
    attendeeUserIds?: string[];
    departmentId?:   string | null;
    priority?:    CalendarTaskPriority;
    visibility?:  CalendarVisibility;
    colorKey?:    CalendarColorKey | null;
    customColor?: string | null;
    locationLabel?: string | null;
    calendarId?:  string;
    categoryId?:  string;
    availability?: CalendarAvailability;
    recurrenceRule?: string | null;
  };
}

export interface CalendarCategoriesResponse {
  success: boolean;
  categories: CalendarCategoryDTO[];
  message?: string;
}

export interface CalendarCollectionsResponse {
  success: boolean;
  calendars: CalendarCollectionDTO[];
  message?: string;
}

export interface CreateCalendarCollectionRequest {
  idempotencyKey: string;
  name: string;
  description?: string | null;
  visibility: CalendarVisibility;
  departmentId?: string | null;
  colorKey?: CalendarColorKey | null;
  customColor?: string | null;
  makeDefault?: boolean;
}

export interface UpdateCalendarCollectionRequest extends CreateCalendarCollectionRequest {
  id: string;
}

export interface ArchiveCalendarCollectionRequest {
  id: string;
  idempotencyKey: string;
}

export interface TaskStatusRequest {
  id:             string;
  scope?:         RecurrenceScope;
  occurrenceDate?: string;
}

export interface CalendarRemindersResponse {
  success:       boolean;
  entryId:       string;
  offsetMinutes: number[];
  message?:      string;
}

export interface SetCalendarRemindersRequest {
  id:            string;
  offsetMinutes: number[];
}

export interface CalendarAttendeeResponseRequest {
  id:             string;
  responseStatus: Exclude<CalendarAttendeeResponse, 'invited'>;
}
