// Shared Work Calendar (F-CAL) DTOs — the exact camelCase contract the backend lib
// (netlify/functions/lib/hr/workCalendar.ts) returns and the admin UI consumes.
// Contract: docs/module-contracts/shared-work-calendar-delivery-contract.md (Rev 5).

export type VersionStatus = 'draft' | 'published' | 'superseded';
export type HolidayType = 'statutory' | 'proclaimed' | 'movable';
export type AssignmentScope = 'pay_group' | 'organization';
export type AssignmentStatus = 'active' | 'cancelled';
export type CalendarProvenance = 'user' | 'system_seed';

export interface HolidayCalendarSummary {
  id: string;
  name: string;
  jurisdiction: string;
  lockVersion: number;
  createdAt: string;
}

export interface WorkCalendarSummary {
  id: string;
  name: string;
  lockVersion: number;
  createdAt: string;
}

export interface HolidayVersionDto {
  id: string;
  holidayCalendarId: string;
  versionNo: number;
  status: VersionStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  timezone: string;
  checksum: string | null;
  provenance: CalendarProvenance;
  lockVersion: number;
}

export interface WorkVersionDto {
  id: string;
  workCalendarId: string;
  versionNo: number;
  status: VersionStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  timezone: string;
  workingWeekdays: number[];
  weekdayFractions: Record<string, number>;
  holidayCalendarVersionId: string;
  checksum: string | null;
  provenance: CalendarProvenance;
  lockVersion: number;
}

export interface HolidayDateDto {
  id: string;
  holidayDate: string;
  observedDate: string | null;
  effectiveDate: string;
  dayFraction: number;
  year: number;
  jurisdiction: string;
  nameStatutory: string;
  nameCommon: string;
  holidayType: HolidayType;
  sourceReference: string;
  sourcePublishedDate: string;
  provenanceNote: string;
}

export interface AssignmentDto {
  id: string;
  scope: AssignmentScope;
  payGroupId: string | null;
  workCalendarVersionId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: AssignmentStatus;
}
export interface AssignmentRow extends AssignmentDto {
  payGroupName: string | null;
  payGroupCode: string | null;
}

// ── Holiday input (provenance-complete; contract §9.1 / §4.2) ─────────────────
export interface HolidayInput {
  holidayDate: string;
  observedDate?: string;
  dayFraction?: number;
  nameStatutory: string;
  nameCommon: string;
  holidayType: HolidayType;
  sourceReference: string;
  sourcePublishedDate: string;
  provenanceNote: string;
}

// ── Command results (contract §9.1–9.3) ───────────────────────────────────────
export interface HolidaySetCommandResult {
  calendar: HolidayCalendarSummary;
  version: HolidayVersionDto;
  holiday?: HolidayDateDto;
}
export interface WorkCalendarCommandResult {
  calendar: WorkCalendarSummary;
  version: WorkVersionDto;
}
export interface AssignmentCommandResult {
  assignment: AssignmentDto;
}

// ── Read results (contract §9.4) ──────────────────────────────────────────────
export interface Page<T> { items: T[]; nextCursor: string | null }
export interface HolidayCalendarDetail { calendar: HolidayCalendarSummary; versions: HolidayVersionDto[] }
export interface WorkCalendarDetail { calendar: WorkCalendarSummary; versions: WorkVersionDto[] }

export interface WorkingDayExclusion {
  date: string;
  reason: 'weekend' | 'partial' | 'holiday' | string;
  lostFraction: string;
  holidayName?: string;
}

// Resolve PREVIEW — raw resolution (IDs + checksums + path, consumed by F-02) enriched with
// resolved names + working-day evidence so the admin UI shows no raw UUIDs (contract §9.4, UT-CAL-U6).
export interface ResolvePreview {
  workCalendarId: string;
  workCalendarVersionId: string;
  workCalendarChecksum: string | null;
  holidayCalendarVersionId: string;
  holidayCalendarChecksum: string | null;
  resolutionPath: { scope: AssignmentScope; assignmentId: string };
  workCalendar: {
    id: string; name: string; versionNo: number | null; status: VersionStatus;
    effectiveFrom: string | null; effectiveTo: string | null; timezone: string;
    workingWeekdays: number[]; weekdayFractions: Record<string, number>;
  };
  holidayCalendar: {
    id: string; name: string; jurisdiction: string; versionNo: number | null; status: VersionStatus;
    effectiveFrom: string | null; effectiveTo: string | null;
  };
  payGroup: { id: string; code: string | null; name: string | null; statutoryCountry: string | null };
  workingDays: { count: string; excluded: WorkingDayExclusion[] };
}
