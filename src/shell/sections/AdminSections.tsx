/**
 * src/shell/sections/AdminSections.tsx
 *
 * HTML shells for admin-role section panels:
 *   • s-adm-dashboard    — rich inline dashboard (stat cards, charts, widget grid)
 *   • s-adm-employees    — employees CRUD (profile pill + Preact mount)
 *   • s-adm-projects     — project sites (profile pill + Preact mount)
 *   • s-adm-attendance   — attendance records (profile pill + Preact mount)
 *   • s-adm-leaves       — leave applications (profile pill + Preact mount)
 *   • s-adm-rates        — hourly rates (profile pill + Preact mount)
 *
 * The Statutory Rates Modal (#prConstantsModal) and Payroll Settings Modal
 * (#prSettingsModal) are included here as they are tightly coupled to admin
 * section functionality (both are wired by the HourlyRates / Payroll sections).
 *
 * IDs are preserved exactly as in assets/partials/app-shell.html.
 *
 * @see docs/SHELL_STRUCTURE.md §sections/AdminSections
 * @see docs/UI_DESIGN_SYSTEM.md §5
 * @see docs/CODING_STANDARDS.md
 */

import { AdminStatCards, AdminRecentTable } from '@sections/AdminDashboard';
import { ProfilePill } from '@shared/ProfilePill';

// ── Admin profile pill — thin right-aligned wrapper over the reusable pill ────
// (the `ids` arg is ignored; the shared ProfilePill is self-populating + id-free)

interface AdminPillIds { [k: string]: string }

function AdminProfilePill(_props: { ids?: AdminPillIds }) {
  return (
    <div style="display:flex;justify-content:flex-end;margin-bottom:20px;">
      <ProfilePill />
    </div>
  );
}

// ── Statutory Rates Modal (wired by HourlyRates / Payroll sections) ──────────

function StatutoryRatesModal() {
  return (
    <div id="prConstantsModal" class="prs-overlay">
      <div class="prc-modal">

        <div class="prc-modal-header">
          <div class="prc-modal-header-icon"><i class="fas fa-scale-balanced" /></div>
          <div class="prc-modal-header-text">
            <div class="prc-modal-title">Statutory Rate Configuration</div>
            <div class="prc-modal-sub">Trinidad &amp; Tobago &nbsp;·&nbsp; Effective rates used in all payroll calculations</div>
          </div>
          <button class="prc-modal-close" id="prcCloseBtn"><i class="fas fa-times" /></button>
        </div>

        {/* Password gate */}
        <div id="prcGate" class="prc-gate">
          <div class="prc-gate-graphic">
            <div class="prc-gate-ring"><i class="fas fa-shield-halved" /></div>
          </div>
          <div class="prc-gate-title">Authorisation Required</div>
          <div class="prc-gate-desc">Statutory rates affect all payroll calculations. Confirm your identity to proceed.</div>
          <div class="prc-gate-input-wrap">
            <i class="fas fa-lock prc-gate-input-icon" />
            <input
              type="password"
              id="prcPassword"
              class="prc-gate-input"
              placeholder="Enter your admin password"
              autocomplete="current-password"
            />
          </div>
          <div id="prcGateError" class="prc-gate-error" style="display:none;" />
          <button class="prc-btn-primary" id="prcVerifyBtn" style="width:100%;justify-content:center;margin-top:4px;">
            <i class="fas fa-arrow-right" /> Continue
          </button>
        </div>

        {/* Constants form */}
        <div id="prcForm" style="display:none;">
          <div class="prc-tabs">
            <button class="prc-tab active" data-prc-tab="nis">
              <i class="fas fa-shield-halved" /> NIS
            </button>
            <button class="prc-tab" data-prc-tab="hs">
              <i class="fas fa-heart-pulse" /> Health Surcharge
            </button>
            <button class="prc-tab" data-prc-tab="paye">
              <i class="fas fa-file-invoice-dollar" /> PAYE
            </button>
          </div>

          {/* NIS Panel */}
          <div class="prc-panel active" id="prc-nis">
            <div class="prc-panel-intro">
              <div class="prc-panel-intro-icon" style="background:rgba(27,45,84,.08);">
                <i class="fas fa-shield-halved" style="color:var(--siomac-navy);" />
              </div>
              <div>
                <div class="prc-panel-intro-title">National Insurance Scheme</div>
                <div class="prc-panel-intro-desc">Employee contribution deducted each pay period, capped at the monthly insurable earnings ceiling set by the NIS.</div>
              </div>
            </div>
            <div class="prc-fields-grid">
              <div class="prc-field-block">
                <div class="prc-field-label">
                  Employee Contribution Rate
                  <span class="prc-tooltip" data-tip="Current statutory rate is 6% of insurable earnings. Set by the National Insurance Act.">
                    <i class="fas fa-circle-info" />
                  </span>
                </div>
                <div class="prc-input-row">
                  <div class="prc-input-box prc-input-pct">
                    <input type="number" id="prcNisRate" step="0.01" min="0" max="100" placeholder="6" />
                    <span class="prc-input-badge">%</span>
                  </div>
                </div>
                <div class="prc-field-hint">Enter as a percentage — e.g. <strong>6</strong> for 6%</div>
              </div>
              <div class="prc-field-block">
                <div class="prc-field-label">
                  Monthly Insurable Earnings Ceiling
                  <span class="prc-tooltip" data-tip="NIS contributions are capped once monthly earnings reach this ceiling. Currently TTD 13,600.">
                    <i class="fas fa-circle-info" />
                  </span>
                </div>
                <div class="prc-input-row">
                  <div class="prc-input-box">
                    <span class="prc-input-pre">TTD</span>
                    <input type="number" id="prcNisMonthlyCap" step="1" min="0" placeholder="13600" />
                  </div>
                </div>
                <div class="prc-field-hint">Maximum monthly earnings subject to NIS contributions</div>
              </div>
            </div>
            <div class="prc-notice">
              <i class="fas fa-circle-info" />
              NIS is deducted from gross pay each cycle. The monthly cap is prorated automatically for weekly, fortnightly, and daily pay cycles.
            </div>
          </div>

          {/* Health Surcharge Panel */}
          <div class="prc-panel" id="prc-hs">
            <div class="prc-panel-intro">
              <div class="prc-panel-intro-icon" style="background:rgba(124,58,237,.08);">
                <i class="fas fa-heart-pulse" style="color:#7c3aed;" />
              </div>
              <div>
                <div class="prc-panel-intro-title">Health Surcharge</div>
                <div class="prc-panel-intro-desc">A fixed flat amount deducted per pay period. The rate applied depends on whether weekly earnings exceed the threshold.</div>
              </div>
            </div>
            <div class="prc-field-block" style="margin-bottom:20px;">
              <div class="prc-field-label">
                Weekly Earnings Threshold
                <span class="prc-tooltip" data-tip="Employees earning above TTD 469.99 per week pay the higher surcharge rate.">
                  <i class="fas fa-circle-info" />
                </span>
              </div>
              <div class="prc-input-row">
                <div class="prc-input-box" style="max-width:200px;">
                  <span class="prc-input-pre">TTD</span>
                  <input type="number" id="prcHsThreshold" step="0.01" min="0" placeholder="469.99" />
                </div>
              </div>
              <div class="prc-field-hint">Compared against the employee's annualised weekly equivalent earnings</div>
            </div>
            <div class="prc-hs-rates-grid">
              <div class="prc-hs-rate-card prc-hs-high">
                <div class="prc-hs-rate-header">
                  <i class="fas fa-arrow-trend-up" />
                  <div>
                    <div class="prc-hs-rate-title">High Rate</div>
                    <div class="prc-hs-rate-sub">Earnings above threshold</div>
                  </div>
                </div>
                <div class="prc-hs-rate-fields">
                  {(['Daily', 'Weekly', 'Fortnightly', 'Monthly'] as const).map((cycle, i) => {
                    const ids = ['prcHsHighDaily', 'prcHsHighWeekly', 'prcHsHighFortnightly', 'prcHsHighMonthly'] as const;
                    const placeholders = ['1.65', '8.25', '16.50', '33.00'] as const;
                    return (
                      <div class="prc-hs-cell" key={cycle}>
                        <div class="prc-hs-cycle-label">{cycle}</div>
                        <div class="prc-input-box prc-input-sm">
                          <span class="prc-input-pre">$</span>
                          <input type="number" id={ids[i]} step="0.01" min="0" placeholder={placeholders[i]} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div class="prc-hs-rate-card prc-hs-low">
                <div class="prc-hs-rate-header">
                  <i class="fas fa-arrow-trend-down" />
                  <div>
                    <div class="prc-hs-rate-title">Low Rate</div>
                    <div class="prc-hs-rate-sub">Earnings at or below threshold</div>
                  </div>
                </div>
                <div class="prc-hs-rate-fields">
                  {(['Daily', 'Weekly', 'Fortnightly', 'Monthly'] as const).map((cycle, i) => {
                    const ids = ['prcHsLowDaily', 'prcHsLowWeekly', 'prcHsLowFortnightly', 'prcHsLowMonthly'] as const;
                    const placeholders = ['0.30', '1.50', '3.00', '6.00'] as const;
                    return (
                      <div class="prc-hs-cell" key={cycle}>
                        <div class="prc-hs-cycle-label">{cycle}</div>
                        <div class="prc-input-box prc-input-sm">
                          <span class="prc-input-pre">$</span>
                          <input type="number" id={ids[i]} step="0.01" min="0" placeholder={placeholders[i]} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div class="prc-notice">
              <i class="fas fa-circle-info" />
              Health Surcharge is a fixed flat deduction — not percentage-based. Set each cycle's amount directly as prescribed by the Health Surcharge Act.
            </div>
          </div>

          {/* PAYE Panel */}
          <div class="prc-panel" id="prc-paye">
            <div class="prc-panel-intro">
              <div class="prc-panel-intro-icon" style="background:rgba(202,138,4,.08);">
                <i class="fas fa-file-invoice-dollar" style="color:#ca8a04;" />
              </div>
              <div>
                <div class="prc-panel-intro-title">Pay As You Earn (PAYE)</div>
                <div class="prc-panel-intro-desc">Income tax withheld from salary. Calculated on chargeable income after the personal allowance. Two bands apply.</div>
              </div>
            </div>
            <div class="prc-fields-grid">
              <div class="prc-field-block">
                <div class="prc-field-label">
                  Personal Allowance (Annual)
                  <span class="prc-tooltip" data-tip="The first TTD 90,000 of annual chargeable income is exempt from income tax.">
                    <i class="fas fa-circle-info" />
                  </span>
                </div>
                <div class="prc-input-row">
                  <div class="prc-input-box">
                    <span class="prc-input-pre">TTD</span>
                    <input type="number" id="prcAllowanceAnnual" step="1" min="0" placeholder="90000" />
                  </div>
                </div>
                <div class="prc-field-hint">Subtracted from gross annual earnings before tax is applied</div>
              </div>
              <div class="prc-field-block">
                <div class="prc-field-label">
                  High-Rate Threshold (Annual)
                  <span class="prc-tooltip" data-tip="Chargeable income above TTD 1,000,000 per year is taxed at the high PAYE rate.">
                    <i class="fas fa-circle-info" />
                  </span>
                </div>
                <div class="prc-input-row">
                  <div class="prc-input-box">
                    <span class="prc-input-pre">TTD</span>
                    <input type="number" id="prcPayeHighThreshold" step="1" min="0" placeholder="1000000" />
                  </div>
                </div>
                <div class="prc-field-hint">Chargeable income above this amount is taxed at the high rate</div>
              </div>
            </div>
            <div class="prc-paye-bands">
              <div class="prc-paye-band prc-paye-low">
                <div class="prc-paye-band-header">
                  <div class="prc-paye-band-dot" />
                  <div>
                    <div class="prc-paye-band-title">Standard Rate</div>
                    <div class="prc-paye-band-sub">Applied to chargeable income up to the high-rate threshold</div>
                  </div>
                </div>
                <div class="prc-input-box prc-input-pct" style="max-width:140px;">
                  <input type="number" id="prcPayeRateLow" step="0.01" min="0" max="100" placeholder="25" />
                  <span class="prc-input-badge">%</span>
                </div>
                <div class="prc-field-hint">Enter as a percentage — e.g. <strong>25</strong> for 25%</div>
              </div>
              <div class="prc-paye-band prc-paye-high">
                <div class="prc-paye-band-header">
                  <div class="prc-paye-band-dot" />
                  <div>
                    <div class="prc-paye-band-title">Higher Rate</div>
                    <div class="prc-paye-band-sub">Applied to chargeable income exceeding the threshold</div>
                  </div>
                </div>
                <div class="prc-input-box prc-input-pct" style="max-width:140px;">
                  <input type="number" id="prcPayeRateHigh" step="0.01" min="0" max="100" placeholder="30" />
                  <span class="prc-input-badge">%</span>
                </div>
                <div class="prc-field-hint">Enter as a percentage — e.g. <strong>30</strong> for 30%</div>
              </div>
            </div>
            <div class="prc-notice">
              <i class="fas fa-circle-info" />
              PAYE is calculated annually then prorated to the pay cycle. The personal allowance is applied before either band is assessed.
            </div>
          </div>

          <div class="prc-modal-footer">
            <button class="prc-btn-ghost" id="prcRestoreBtn"><i class="fas fa-rotate-left" /> Restore Defaults</button>
            <div style="display:flex;gap:10px;">
              <button class="prc-btn-outline" id="prcCancelBtn">Cancel</button>
              <button class="prc-btn-primary" id="prcSaveBtn"><i class="fas fa-check" /> Save Changes</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Payroll Settings Modal (wired by Payroll section) ─────────────────────────

function PayrollSettingsModal() {
  return (
    <div id="prSettingsModal" class="prs-overlay">
      <div class="prs-container">
        <div class="prs-header">
          <div class="prs-header-left">
            <div class="prs-avatar" id="prsAvatar" />
            <div>
              <div class="prs-name" id="prsName">Employee Name</div>
              <div class="prs-meta" id="prsMeta">Department · Position</div>
            </div>
          </div>
          <button class="prs-close" id="prsCloseBtn" aria-label="Close"><i class="fas fa-times" /></button>
        </div>

        <div class="prs-body">
          {/* LEFT: Pay configuration */}
          <div class="prs-section">
            <div class="prs-section-title"><i class="fas fa-coins" /> Pay Configuration</div>

            <div class="prs-field-label">Pay Cycle</div>
            <div class="prs-pill-group" id="prsCycleGroup">
              <button class="prs-pill" data-val="daily">Daily</button>
              <button class="prs-pill" data-val="weekly">Weekly</button>
              <button class="prs-pill" data-val="fortnightly">Fortnightly</button>
              <button class="prs-pill active" data-val="monthly">Monthly</button>
            </div>
            <input type="hidden" id="prsPayCycle" value="monthly" />

            <div class="prs-field-label" style="margin-top:20px;">Pay Basis</div>
            <div class="prs-pill-group" id="prsBasisGroup">
              <button class="prs-pill active" data-val="salary"><i class="fas fa-building" /> Salary</button>
              <button class="prs-pill" data-val="hourly"><i class="fas fa-clock" /> Hourly</button>
            </div>
            <input type="hidden" id="prsPayBasis" value="salary" />

            <div class="prs-rate-row" id="prsSalaryRow">
              <div class="prs-field-label">Monthly Salary</div>
              <div class="prs-money-input">
                <span class="prs-currency">TTD</span>
                <input type="number" id="prsMonthlySalary" min="0" step="0.01" placeholder="0.00" />
              </div>
            </div>
            <div class="prs-rate-row" id="prsHourlyRow" style="display:none;">
              <div class="prs-field-label">Hourly Rate</div>
              <div class="prs-money-input">
                <span class="prs-currency">TTD</span>
                <input type="number" id="prsHourlyRate" min="0" step="0.01" placeholder="0.00" />
              </div>
            </div>

            <div class="prs-rate-row">
              <div class="prs-field-label">Standard Hours / Day</div>
              <div class="prs-hours-input-wrap">
                <input type="number" id="prsStdHours" min="1" max="24" step="0.5" placeholder="8" />
                <span class="prs-hours-unit">hrs</span>
              </div>
            </div>
          </div>

          {/* RIGHT: Deductions + live preview */}
          <div class="prs-section">
            <div class="prs-section-title"><i class="fas fa-shield-halved" /> Deduction Rules</div>

            <div class="prs-toggle-list">
              <label class="prs-toggle-row">
                <div class="prs-toggle-info">
                  <span class="prs-toggle-name">NIS Contribution</span>
                  <span class="prs-toggle-desc">6% of gross, capped at $13,600/month</span>
                </div>
                <div class="prs-switch-wrap">
                  <input type="checkbox" id="prsNis" class="prs-switch-input" />
                  <span class="prs-switch" />
                </div>
              </label>
              <label class="prs-toggle-row">
                <div class="prs-toggle-info">
                  <span class="prs-toggle-name">Health Surcharge</span>
                  <span class="prs-toggle-desc">Fixed rate based on weekly earnings</span>
                </div>
                <div class="prs-switch-wrap">
                  <input type="checkbox" id="prsHs" class="prs-switch-input" />
                  <span class="prs-switch" />
                </div>
              </label>
              <label class="prs-toggle-row">
                <div class="prs-toggle-info">
                  <span class="prs-toggle-name">Tax Resident (PAYE)</span>
                  <span class="prs-toggle-desc">25% up to $1M, 30% above — $90k personal allowance</span>
                </div>
                <div class="prs-switch-wrap">
                  <input type="checkbox" id="prsTax" class="prs-switch-input" />
                  <span class="prs-switch" />
                </div>
              </label>
            </div>

            <div class="prs-estimate">
              <div class="prs-estimate-title">Monthly Estimate</div>
              <div class="prs-estimate-grid">
                <div class="prs-est-row prs-est-gross"><span>Gross Pay</span><span id="prsEstGross">—</span></div>
                <div class="prs-est-row prs-est-ded"><span>NIS</span><span id="prsEstNis">—</span></div>
                <div class="prs-est-row prs-est-ded"><span>Health Surcharge</span><span id="prsEstHs">—</span></div>
                <div class="prs-est-row prs-est-ded"><span>PAYE</span><span id="prsEstPaye">—</span></div>
                <div class="prs-est-row prs-est-net"><span>Net Pay</span><span id="prsEstNet">—</span></div>
              </div>
            </div>
          </div>
        </div>

        <div class="prs-footer">
          <button class="prs-btn-cancel" id="prsCancelBtn">Cancel</button>
          <button class="prs-btn-save" id="prsSaveBtn"><i class="fas fa-check" /> Save Changes</button>
        </div>
      </div>
    </div>
  );
}

// ── Admin Dashboard (rich inline content) ─────────────────────────────────────

function AdminDashboardSection() {
  return (
    <section class="app-section" id="s-adm-dashboard" data-role="admin">

      <div class="dash-overview-panel">
        <div class="dash-panel-content">
          <div class="overview-top-bar">
            <div class="overview-title-section">
              <i class="fas fa-chart-pie" />
              <h2>Today's Overview</h2>
            </div>
            {/* Admin profile + notification pill (reusable, self-populating) */}
            <ProfilePill />
          </div>

          {/* Stat cards — live data from AdminStatCards Preact component */}
          <div class="dash-stats-row">
            <AdminStatCards />
          </div>
        </div>

        <div class="dash-panel-footer">
          <div class="overview-date-badge">
            <div class="odb-icon"><i class="fas fa-calendar-day" /></div>
            <span class="odb-text">
              <span class="odb-day" id="dashTodayDay">Tuesday</span>
              <span class="odb-sep">·</span>
              <span class="odb-date" id="dashTodayDate">May 12, 2026</span>
            </span>
          </div>
          <div id="dashHiddenWidgets" class="dash-hidden-list" style="display:none;" />
          <div style="display:flex;align-items:center;gap:8px;">
            <div class="dash-theme-toggle">
              <button class="dash-theme-btn" id="dashThemeLight" title="Light mode"><i class="fas fa-sun" /></button>
              <button class="dash-theme-btn" id="dashThemeDark" title="Dark mode"><i class="fas fa-moon" /></button>
            </div>
            <button class="dash-layout-btn admin-only" id="dashEditBtn">
              <i class="fas fa-edit" /> Edit Layout
            </button>
            <button class="dash-layout-btn dash-layout-btn-primary" id="dashResetBtn" style="display:none;">
              <i class="fas fa-undo-alt" /> Reset
            </button>
          </div>
        </div>
      </div>

      {/* DashboardController — headless */}
      <div id="preact-dashboard-ctrl" style="display:none" aria-hidden="true" />

      {/* Widget grid */}
      <div class="dash-widget-grid" id="dashWidgetGrid">

        <div class="data-section chart-card-section dash-widget" data-widget-id="trend" data-widget-title="Weekly Attendance Trend">
          <div class="chart-card-header">
            <h3><i class="fas fa-chart-line" style="color:var(--siomac-red);margin-right:8px;" />Weekly Attendance Trend</h3>
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="chart-badge" id="trendBadge">Last 30 days</span>
              <button class="dash-hide-btn" data-widget-id="trend" title="Hide widget"><i class="fas fa-eye-slash" /></button>
            </div>
          </div>
          <div class="chart-container-md"><canvas id="trendLineChart" /></div>
        </div>

        <div class="data-section chart-card-section dash-widget" data-widget-id="dept" data-widget-title="Department Distribution">
          <div class="chart-card-header">
            <h3><i class="fas fa-building" style="color:var(--siomac-red);margin-right:8px;" />Department Distribution</h3>
            <button class="dash-hide-btn" data-widget-id="dept" title="Hide widget"><i class="fas fa-eye-slash" /></button>
          </div>
          <div class="dash-chart-split">
            <div class="dash-chart-stats" id="deptStatsList" />
            <div class="chart-container-md"><canvas id="deptDistChart" /></div>
          </div>
        </div>

        <div class="data-section chart-card-section dash-widget" data-widget-id="status" data-widget-title="Today's Status">
          <div class="chart-card-header">
            <h3><i class="fas fa-users" style="color:var(--siomac-red);margin-right:8px;" />Today's Status</h3>
            <button class="dash-hide-btn" data-widget-id="status" title="Hide widget"><i class="fas fa-eye-slash" /></button>
          </div>
          <div class="dash-chart-split">
            <div class="dash-chart-stats">
              <div class="dash-chart-stat-item"><span class="dash-stat-dot" style="background:#2E7D32" /><span class="dash-stat-label">Present</span><span class="dash-stat-val" id="statusStatPresent">—</span></div>
              <div class="dash-chart-stat-item"><span class="dash-stat-dot" style="background:#FFB712" /><span class="dash-stat-label">Late</span><span class="dash-stat-val" id="statusStatLate">—</span></div>
              <div class="dash-chart-stat-item"><span class="dash-stat-dot" style="background:#E40C0C" /><span class="dash-stat-label">Absent</span><span class="dash-stat-val" id="statusStatAbsent">—</span></div>
              <div class="dash-chart-stat-item"><span class="dash-stat-dot" style="background:#1B2D55" /><span class="dash-stat-label">On Leave</span><span class="dash-stat-val" id="statusStatLeave">—</span></div>
              <div class="dash-stat-divider" />
              <div class="dash-chart-stat-item dash-stat-summary"><span class="dash-stat-label">Total</span><span class="dash-stat-val" id="statusStatTotal">—</span></div>
              <div class="dash-chart-stat-item dash-stat-summary"><span class="dash-stat-label">Attendance Rate</span><span class="dash-stat-val dash-stat-rate" id="statusStatRate">—</span></div>
            </div>
            <div class="chart-container-md"><canvas id="statusBarChart" /></div>
          </div>
        </div>

        <div class="data-section chart-card-section dash-widget" data-widget-id="leave" data-widget-title="Leave Types · This Month">
          <div class="chart-card-header">
            <h3><i class="fas fa-calendar-day" style="color:var(--siomac-red);margin-right:8px;" />Leave Types · This Month</h3>
            <button class="dash-hide-btn" data-widget-id="leave" title="Hide widget"><i class="fas fa-eye-slash" /></button>
          </div>
          <div class="dash-chart-split">
            <div class="dash-chart-stats">
              <div class="dash-chart-stat-item"><span class="dash-stat-dot" style="background:#E40C0C" /><span class="dash-stat-label">Sick</span><span class="dash-stat-val" id="leaveStatSick">—</span></div>
              <div class="dash-chart-stat-item"><span class="dash-stat-dot" style="background:#1B2D55" /><span class="dash-stat-label">Casual</span><span class="dash-stat-val" id="leaveStatCasual">—</span></div>
              <div class="dash-chart-stat-item"><span class="dash-stat-dot" style="background:#2E7D32" /><span class="dash-stat-label">Annual</span><span class="dash-stat-val" id="leaveStatAnnual">—</span></div>
              <div class="dash-chart-stat-item"><span class="dash-stat-dot" style="background:#FFB712" /><span class="dash-stat-label">Medical</span><span class="dash-stat-val" id="leaveStatMedical">—</span></div>
              <div class="dash-stat-divider" />
              <div class="dash-chart-stat-item dash-stat-summary"><span class="dash-stat-label">Total Leaves</span><span class="dash-stat-val" id="leaveStatTotal">—</span></div>
            </div>
            <div class="chart-container-md"><canvas id="leaveTypesChart" /></div>
          </div>
        </div>

        <div class="data-section recent-activity-section dash-widget dash-widget-full" data-widget-id="activity" data-widget-title="Recent Activity">
          <div class="section-header">
            <h2><i class="fas fa-history" /> Recent Attendance Activity</h2>
            <div style="display:flex;align-items:center;gap:8px;">
              {/* INTENTIONAL: onclick inline — navigates to attendance section via window global */}
              <button
                class="btn btn-sm btn-outline-primary"
                onClick={() => { (window as unknown as Record<string, Record<string, (s: string) => void>>)['AttendanceSystem']?.['goTo']?.('s-adm-attendance'); }}
              >
                <i class="fas fa-arrow-right" /> View All
              </button>
              <button class="dash-hide-btn" data-widget-id="activity" title="Hide widget"><i class="fas fa-eye-slash" /></button>
            </div>
          </div>
          <div class="table-responsive" id="recentAttendanceWrapper">
            <table class="recent-att-table" id="recentAttendanceTable">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Check In</th>
                  <th>Check Out</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody id="recentAttendanceTbody">
                <AdminRecentTable />
              </tbody>
            </table>
          </div>
        </div>

      </div>{/* /.dash-widget-grid */}
    </section>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function AdminSections() {
  return (
    <>
      <AdminDashboardSection />

      {/* Admin — Employees CRUD */}
      <section class="app-section" id="s-adm-employees" data-role="admin">
        <AdminProfilePill ids={{ profileBtn: 'admEmpProfileBtn', avatar: 'admEmpProfileAvatar', profileName: 'admEmpProfileName', profileRole: 'admEmpProfileRole', notifBtn: 'admEmpNotifBtn', notifBadge: 'admEmpNotifBadge', msgBtn: 'admEmpMsgBtn', msgBadge: 'admEmpMsgBadge', ticketBtn: 'admEmpTicketBtn', ticketBadge: 'admEmpTicketBadge' }} />
        <div id="preact-adm-employees-root" />
      </section>

      {/* Departments CRUD — superadmin only (nav entry only in superadmin SECTION_DEFS) */}
      <section class="app-section" id="s-adm-departments" data-role="superadmin">
        <AdminProfilePill ids={{ profileBtn: 'admDeptProfileBtn', avatar: 'admDeptProfileAvatar', profileName: 'admDeptProfileName', profileRole: 'admDeptProfileRole', notifBtn: 'admDeptNotifBtn', notifBadge: 'admDeptNotifBadge', msgBtn: 'admDeptMsgBtn', msgBadge: 'admDeptMsgBadge', ticketBtn: 'admDeptTicketBtn', ticketBadge: 'admDeptTicketBadge' }} />
        <div id="preact-adm-departments-root" />
      </section>

      {/* Admin — Project Sites CRUD */}
      <section class="app-section" id="s-adm-projects" data-role="admin">
        <AdminProfilePill ids={{ profileBtn: 'admProjProfileBtn', avatar: 'admProjProfileAvatar', profileName: 'admProjProfileName', profileRole: 'admProjProfileRole', notifBtn: 'admProjNotifBtn', notifBadge: 'admProjNotifBadge', msgBtn: 'admProjMsgBtn', msgBadge: 'admProjMsgBadge', ticketBtn: 'admProjTicketBtn', ticketBadge: 'admProjTicketBadge' }} />
        <div id="preact-project-sites-root" />
      </section>

      {/* HSE — incidents + PPE Manager (admin/manager/superadmin). The HSE module
          renders the profile pill inside its own page header (hse* ids). */}
      <section class="app-section" id="s-hse" data-role="admin">
        <div id="preact-hse-root" />
      </section>

      {/* Admin — Attendance Records */}
      <section class="app-section" id="s-adm-attendance" data-role="admin">
        <AdminProfilePill ids={{ profileBtn: 'admAttProfileBtn', avatar: 'admAttProfileAvatar', profileName: 'admAttProfileName', profileRole: 'admAttProfileRole', notifBtn: 'admAttNotifBtn', notifBadge: 'admAttNotifBadge', msgBtn: 'admAttMsgBtn', msgBadge: 'admAttMsgBadge', ticketBtn: 'admAttTicketBtn', ticketBadge: 'admAttTicketBadge' }} />
        <div id="preact-attendance-root" />
      </section>

      {/* Admin — Leave Applications */}
      <section class="app-section" id="s-adm-leaves" data-role="admin">
        <AdminProfilePill ids={{ profileBtn: 'admLvProfileBtn', avatar: 'admLvProfileAvatar', profileName: 'admLvProfileName', profileRole: 'admLvProfileRole', notifBtn: 'admLvNotifBtn', notifBadge: 'admLvNotifBadge', msgBtn: 'admLvMsgBtn', msgBadge: 'admLvMsgBadge', ticketBtn: 'admLvTicketBtn', ticketBadge: 'admLvTicketBadge' }} />
        <div id="preact-admin-leave-root" />
      </section>

      {/* Admin — Hourly Rates */}
      <section class="app-section" id="s-adm-rates" data-role="admin">
        <AdminProfilePill ids={{ profileBtn: 'admRatesProfileBtn', avatar: 'admRatesProfileAvatar', profileName: 'admRatesProfileName', profileRole: 'admRatesProfileRole', notifBtn: 'admRatesNotifBtn', notifBadge: 'admRatesNotifBadge', msgBtn: 'admRatesMsgBtn', msgBadge: 'admRatesMsgBadge', ticketBtn: 'admRatesTicketBtn', ticketBadge: 'admRatesTicketBadge' }} />
        <div id="preact-hourly-rates-root" />
      </section>

      {/* Payroll-related modals — included here as they are wired by admin sections */}
      <StatutoryRatesModal />
      <PayrollSettingsModal />
    </>
  );
}
