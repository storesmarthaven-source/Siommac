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

export type CalendarItemType   = 'deadline' | 'task' | 'activity';
export type CalendarItemOrigin = 'calendar' | 'module' | 'workflow';
/** Task lifecycle (overdue is DERIVED from the due date, never stored). */
export type CalendarTaskStatus = 'not_started' | 'in_progress' | 'in_review' | 'blocked' | 'done' | 'cancelled';
export type CalendarTaskPriority = 'low' | 'medium' | 'high';
export type CalendarVisibility = 'personal' | 'team' | 'org';

/** One normalized dated item. Deadlines are projected by source adapters; tasks
 *  and activities are native `calendar_entries`. Recurrence occurrences are
 *  expanded server-side and carry `occurrenceDate` + a compound `id`. */
export interface CalendarItemDTO {
  /** Native entry id, or `${entryId}::${occurrenceDate}` for a recurrence
   *  occurrence, or `${sourceModule}:${sourceRef}` for a projected deadline. */
  id:                 string;
  type:               CalendarItemType;
  origin:             CalendarItemOrigin;
  title:              string;
  notes:              string | null;

  allDay:             boolean;
  startsOn:           string | null;   // 'YYYY-MM-DD' (all-day)
  endsOn:             string | null;   // 'YYYY-MM-DD'
  startsAt:           string | null;   // ISO timestamptz (timed)
  endsAt:             string | null;   // ISO timestamptz

  status:             CalendarTaskStatus | null;   // tasks only
  priority:           CalendarTaskPriority | null;  // tasks only
  ownerUserId:        string | null;
  ownerName:          string | null;
  assigneeUserId:     string | null;
  assigneeName:       string | null;
  attendeeCount:      number;
  visibility:         CalendarVisibility | null;

  // Source link (deadlines + optionally tasks/activities that reference a record).
  sourceModule:       string | null;
  sourceRef:          string | null;
  sourceRoute:        string | null;   // drill-through target (section id / route)
  sourceLabel:        string | null;

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
  sourceModules?: string[];
  ownerUserId?:   string;
  assigneeUserId?: string;
  statuses?:      CalendarTaskStatus[];
  priorities?:    CalendarTaskPriority[];
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
  title:          string;
  notes?:         string | null;
  allDay?:        boolean;
  startsOn?:      string | null;
  startsAt?:      string | null;
  endsAt?:        string | null;
  assigneeUserId?: string | null;   // requires calendar.task.assign; validated server-side
  priority?:      CalendarTaskPriority;   // defaults to 'medium'
  visibility?:    CalendarVisibility;
  recurrenceRule?: string | null;
}

export interface CreateActivityRequest {
  title:          string;
  notes?:         string | null;
  allDay?:        boolean;
  startsOn?:      string | null;
  endsOn?:        string | null;
  startsAt?:      string | null;
  endsAt?:        string | null;
  visibility?:    CalendarVisibility;
  attendeeUserIds?: string[];
  recurrenceRule?: string | null;
}

export interface UpdateEntryRequest {
  id:             string;
  scope?:         RecurrenceScope;   // for recurring items; default 'series'
  occurrenceDate?: string;           // required when scope = 'occurrence'
  patch: {
    title?:       string;
    notes?:       string | null;
    allDay?:      boolean;
    startsOn?:    string | null;
    endsOn?:      string | null;
    startsAt?:    string | null;
    endsAt?:      string | null;
    assigneeUserId?: string | null;
    priority?:    CalendarTaskPriority;
    visibility?:  CalendarVisibility;
  };
}

export interface TaskStatusRequest {
  id:             string;
  scope?:         RecurrenceScope;
  occurrenceDate?: string;
}
