/**
 * src/shell/sections/EmployeeSections.tsx
 *
 * HTML shells for employee-role section panels:
 *   • s-emp-attendance — attendance home (rich inline content, populated by attSystem + Preact)
 *   • s-emp-leave      — leave section (Preact mount point)
 *   • s-emp-history    — attendance history (Preact mount point)
 *   • s-emp-payroll    — payslips (Preact mount point)
 *
 * IDs are preserved exactly as in assets/partials/app-shell.html.
 * Section panels are shown/hidden via CSS by attSystem.ts — do NOT add
 * conditional rendering that would unmount them (this destroys form state).
 *
 * @see docs/SHELL_STRUCTURE.md §sections/EmployeeSections
 * @see docs/UI_DESIGN_SYSTEM.md §5
 * @see docs/CODING_STANDARDS.md
 */

import { ProfilePill } from '@shared/ProfilePill';

/** Right-aligned wrapper over the reusable, self-populating pill. */
function EmpProfilePill() {
  return (
    <div style="display:flex;justify-content:flex-end;margin-bottom:20px;">
      <ProfilePill />
    </div>
  );
}

/** Employee attendance home — the main employee dashboard. */
function EmpAttendanceSection() {
  return (
    <section class="app-section" id="s-emp-attendance" data-role="employee">

      {/* AttendanceDashboard Preact controller — headless */}
      <div id="preact-att-dashboard-ctrl" style="display:none;" aria-hidden="true" />

      <EmpProfilePill />

      {/* Welcome + Timeline row */}
      <div class="ea-top-row">

        {/* Welcome Card */}
        <div class="ea-welcome-card">
          <div class="user-avatar"><span id="userInitial">U</span></div>
          <h2 id="displayNameText">User</h2>
          <div class="ea-role-text" id="ea-role-dept">—</div>

          <div class="ea-status-wrapper">
            <div id="statusBadge" class="ea-status-badge ea-status-none">
              <i class="fas fa-clock" /> Not Checked In
            </div>
          </div>

          <button id="checkInBtn" class="ea-action-btn hidden">
            <i class="fas fa-camera" /> <span id="checkInText">Check In</span>
          </button>
          <button id="checkOutBtn" class="ea-action-btn ea-action-btn-out hidden">
            <i class="fas fa-camera" /> <span id="checkOutText">Check Out</span>
          </button>
        </div>

        {/* Today's Timeline */}
        <div class="ea-today-card">
          <div class="ea-section-title"><i class="fas fa-clock" /> Today's Timeline</div>
          <div class="ea-clock-display" id="currentTime">--:--:--</div>
          <div class="iso-date" id="currentDate" style="text-align:center;margin-bottom:18px;" />
          <div class="ea-info-grid">
            <div class="ea-info-row">
              <i class="fas fa-sign-in-alt" style="color:var(--success)" />
              <span>
                <strong id="checkInTimeLabel">Check In</strong>
                <span id="checkInTime" class="ea-info-value">--:--</span>
              </span>
            </div>
            <div class="ea-info-row">
              <i class="fas fa-sign-out-alt" style="color:var(--siomac-red)" />
              <span>
                <strong id="checkOutTimeLabel">Check Out</strong>
                <span id="checkOutTime" class="ea-info-value">--:--</span>
              </span>
            </div>
            <div class="ea-info-row">
              <i class="fas fa-chart-line" style="color:var(--siomac-navy)" />
              <span>
                <strong>Hours Today</strong>
                <span id="todayHoursDisplay" class="ea-info-value">0.0 hrs</span>
              </span>
            </div>
            <div class="ea-info-row">
              <i class="fas fa-map-marker-alt" style="color:var(--siomac-red)" />
              <span>
                <strong id="currentLocationLabel">Location</strong>
                <span id="currentLocation" class="ea-info-value" style="font-size:0.88rem;">Getting location...</span>
                <span id="locationAccuracy" class="location-info" />
                <span id="locationAddress" class="location-info" />
              </span>
            </div>
          </div>
        </div>

      </div>{/* /ea-top-row */}

      {/* Charts Row */}
      <div class="ea-charts-row">
        {/* This Month's Summary */}
        <div class="ea-chart-card">
          <div class="ea-section-title">
            <i class="fas fa-calendar-alt" /> <span id="monthlySummaryText">This Month's Summary</span>
          </div>
          <div class="ea-summary-grid">
            <div class="ea-summary-stat">
              <div class="ea-summary-icon" style="background:rgba(46,125,50,0.1)">
                <i class="fas fa-check-circle" style="color:#2E7D32" />
              </div>
              <div class="ea-summary-value" id="empPresentDays">—</div>
              <div class="ea-summary-label">Present</div>
            </div>
            <div class="ea-summary-stat">
              <div class="ea-summary-icon" style="background:rgba(255,183,18,0.1)">
                <i class="fas fa-clock" style="color:#c67c00" />
              </div>
              <div class="ea-summary-value" id="empLateDays">—</div>
              <div class="ea-summary-label">Late</div>
            </div>
            <div class="ea-summary-stat">
              <div class="ea-summary-icon" style="background:rgba(228,12,12,0.1)">
                <i class="fas fa-user-slash" style="color:var(--siomac-red)" />
              </div>
              <div class="ea-summary-value" id="empAbsentDays">—</div>
              <div class="ea-summary-label">Absent</div>
            </div>
            <div class="ea-summary-stat">
              <div class="ea-summary-icon" style="background:rgba(27,45,85,0.08)">
                <i class="fas fa-sun" style="color:var(--siomac-navy)" />
              </div>
              <div class="ea-summary-value" id="empSundayDays">—</div>
              <div class="ea-summary-label">Sundays</div>
            </div>
          </div>
          <div class="ea-total-days-bar">
            <span style="font-size:0.72rem;opacity:0.8">Total Working Days (Mon–Sat)</span>
            <span class="ea-total-days-value" id="empTotalDays">—</span>
          </div>
        </div>

        {/* Last 7 Days bar chart */}
        <div class="ea-chart-card">
          <div class="ea-section-title">
            <i class="fas fa-chart-bar" /> Last 7 Days · Hours Worked
          </div>
          <div style="position:relative;flex:1;min-height:220px;">
            <canvas
              id="attendanceTrendChart"
              style="position:absolute;inset:0;width:100%!important;height:100%!important;"
            />
          </div>
        </div>
      </div>

      {/* Hidden canvas — kept for JS compatibility */}
      <canvas id="attendanceChart" style="display:none;" />

      {/* View history link */}
      <div style="text-align:center;margin-top:4px;">
        <button id="viewHistoryBtn" class="btn btn-secondary btn-sm">
          <i class="fas fa-history" /> <span id="viewHistoryText">View My Full History</span>
        </button>
      </div>

    </section>
  );
}

export default function EmployeeSections() {
  return (
    <>
      <EmpAttendanceSection />

      {/* Employee — Leave */}
      <section class="app-section" id="s-emp-leave" data-role="employee">
        <div id="preact-emp-leave-root" />
      </section>

      {/* Employee — My History */}
      <section class="app-section" id="s-emp-history" data-role="employee">
        <div id="preact-emp-history-root" />
      </section>

      {/* Employee — My Payslips */}
      <section class="app-section" id="s-emp-payroll" data-role="employee">
        <div id="preact-emp-payroll-root" />
      </section>
    </>
  );
}
