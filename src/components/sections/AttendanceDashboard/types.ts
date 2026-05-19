/**
 * src/components/sections/AttendanceDashboard/types.ts
 *
 * Shared types for the employee attendance dashboard + camera check-in modal.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

export interface AttendanceStatus {
  hasCheckedIn:  boolean;
  hasCheckedOut: boolean;
  checkInTime:   string | null;
  checkOutTime:  string | null;
  location:      string;
}

export interface ProjectSiteOption {
  id:       string | number;
  name:     string;
  latitude: number | string;
  longitude: number | string;
  radius:   number;
  assignedEmployees?: Array<{ id: string | number }>;
}

export interface LocationData {
  latitude:  number;
  longitude: number;
  accuracy:  number;
  fallback?: boolean;
  timestamp: string;
}

export interface MarkAttendanceResponse {
  success:  boolean;
  message?: string;
  time?:    string;
  site?:    string;
}

export type AttendanceAction = 'CheckIn' | 'CheckOut';

/** Camera modal state machine */
export type CameraPhase =
  | 'idle'        // modal closed
  | 'live'        // showing live video feed
  | 'captured'    // photo taken, awaiting confirm
  | 'submitting'; // API call in-flight
