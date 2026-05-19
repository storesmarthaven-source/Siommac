/**
 * src/components/sections/Attendance/index.ts
 *
 * Public entry point for the Attendance feature module.
 *
 * Usage:
 *   import { mountAttendanceSection, unmountAttendanceSection } from '@sections/Attendance';
 *   mountAttendanceSection(document.getElementById('s-adm-attendance'), { queryClient });
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

export { AttendanceSection }                              from './AttendanceSection';
export { mountAttendanceSection, unmountAttendanceSection } from './mount';
export type { AttendanceMountOptions }                    from './mount';
