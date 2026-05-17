// Attendance System Main Object — thin orchestrator
// Domain modules: Nav, Dashboard, LiveMap, Employees, Sites, AttendanceView,
//                 LeaveView, Payroll, Profile, SettingsView (all on window.*)
// Shared state:   AppState (window.AppState)
const AttendanceSystem = (function() {

  // ─── Local-only vars (not shared via AppState) ────────────────────────────
  let currentColorScheme = 'navy';
  let currentLayoutMode  = 'sidebar';
  let _currentProfileImage = null; // null = not yet loaded; '' = no photo; url = signed url

  // Attendance date-range flatpickr instances
  let _attFpFrom = null;
  let _attFpTo   = null;

  // History inline state
  let _historyRawData = [];
  let _historySearch  = '';
  let _historyStatus  = 'all';

  // Leave modal edit state
  let _editingLeaveId = null;

  // ─── Session timers (local only) ──────────────────────────────────────────
  let _sessExpTimer  = null;
  let _sessWarnTimer = null;
  let _sessTickTimer = null;
  let _sessWarned    = false;

  // ─── Section load registry ────────────────────────────────────────────────
  const _sectionLoaded = {};
  function _markLoaded(sectionId)   { _sectionLoaded[sectionId] = true; }
  function _isLoaded(sectionId)     { return !!_sectionLoaded[sectionId]; }
  function _resetLoadedState()      { Object.keys(_sectionLoaded).forEach(k => delete _sectionLoaded[k]); }
  function _skelOnce(sectionId, fn) { if (!_isLoaded(sectionId)) fn(); }

  // ─── Global photo cache ───────────────────────────────────────────────────
  const _photoCache = {};

  function _resolvePhoto(username, photoUrl) {
    if (!username) return photoUrl || '';
    if (photoUrl && !_photoCache[username]) _photoCache[username] = photoUrl;
    return _photoCache[username] || photoUrl || '';
  }

  function _seedPhotoCache() {
    const currentUser = AppState.get('currentUser');
    if (currentUser && _currentProfileImage) _photoCache[currentUser] = _currentProfileImage;
  }

  function _patchPhotoCache(username, photoUrl) {
    if (username) {
      _photoCache[username] = photoUrl || '';
      AppState._photoCache = _photoCache;
    }
  }

  function _clearPhotoCache() {
    Object.keys(_photoCache).forEach(k => delete _photoCache[k]);
    AppState._photoCache = _photoCache;
  }

  // ─── Session constants ────────────────────────────────────────────────────
  const SESSION_KEY           = 'siomac_session_v1';
  const SESSION_DURATION      = 8 * 60 * 60 * 1000;
  const SESSION_DURATION_LONG = 7 * 24 * 60 * 60 * 1000;
  const SESSION_WARN_AT       = 5 * 60 * 1000;

  // ─── CONFIG ───────────────────────────────────────────────────────────────
  const CONFIG = {
    WORKING_HOURS: { start: 6, end: 22 },
    MAX_DISTANCE: 200
  };

  // ─── Utility: fmtLocalTime ────────────────────────────────────────────────
  function fmtLocalTime(iso) {
    if (!iso) return '--:--';
    try {
      return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    } catch (_) { return '--:--'; }
  }

  // ─── Translation dictionary ───────────────────────────────────────────────
  const translations = {
    en: {
      companyName: "My Company",
      loginTitle: "Attendance System Login", loginSubtitle: "Sign in to manage attendance, track project sites, handle leave requests, and access real-time workforce insights.",
      username: "Username", password: "Password", rememberMe: "Remember Me", loginButton: "Log In",
      welcome: "Welcome", checkIn: "Check In with Selfie", checkOut: "Check Out with Selfie",
      viewHistory: "View My History", monthlySummary: "This Month's Summary", todayStatus: "Today's Status",
      leaveManagement: "Leave Management", requestLeave: "Request Leave", checkInTimeLabel: "Check In Time",
      checkOutTimeLabel: "Check Out Time", currentLocationLabel: "Current Location",
      managerDashboardTitle: "Manager Dashboard", managerDashboardSubtitle: "Manage department employees and leave requests",
      departmentEmployees: "Department Employees", presentDepartment: "Present Today",
      onLeaveDepartment: "On Leave", lateDepartment: "Late Today", departmentEmployeesTitle: "Department Employees",
      pendingLeaveRequestsTitle: "Pending Leave Requests", nameColumn: "Name", positionColumn: "Position",
      statusColumn: "Status", lastActivityColumn: "Last Activity", locationColumn: "Location",
      adminDashboardTitle: "Admin Dashboard", adminDashboardSubtitle: "Manage employees, attendance, and leave requests",
      totalEmployees: "Total Employees", presentToday: "Present Today", absentToday: "Absent Today",
      onLeaveToday: "On Leave Today", activeLocations: "Active Locations", lateToday: "Late Today",
      employeesTabText: "Employees", departmentsTabText: "Departments", attendanceTabText: "Attendance",
      leavesTabText: "Leave Management", projectsTabText: "Project Sites", allEmployeesTitle: "All Employees",
      addEmployeeText: "Add Employee", refreshText: "Refresh", idColumn: "ID", nameHeader: "Name",
      departmentHeader: "Department", positionHeader: "Position", statusHeader: "Status",
      attendanceHeader: "Today's Status", actionsHeader: "Actions", departmentsTitle: "Department Management",
      addDepartmentText: "Add Department", refreshDepartmentsText: "Refresh", attendanceRecordsTitle: "Attendance Records",
      refreshAttendanceText: "Refresh", employeeNameColumn: "Name", employeeDeptColumn: "Department",
      todayStatusColumn: "Today's Status", checkInTimeColumn: "Check In", checkOutTimeColumn: "Check Out",
      totalDaysColumn: "Total Days", presentColumn: "Present", absentColumn: "Absent",
      actionsAttendanceColumn: "Actions", leaveApplicationsTitle: "Leave Applications",
      refreshLeavesText: "Refresh", employeeLeaveColumn: "Employee", leaveTypeColumn: "Leave Type",
      fromDateColumn: "From", toDateColumn: "To", daysColumn: "Days", statusLeaveColumn: "Status",
      actionsLeaveColumn: "Actions", captureText: "Capture Photo", retakeText: "Retake",
      confirmText: "Confirm", gettingLocationText: "Getting location...",
      leaveRequestModalTitle: "Request Leave", leaveTypeLabel: "Leave Type",
      fromDateLabel: "From Date", toDateLabel: "To Date", reasonLabel: "Reason",
      cancelLeaveText: "Cancel", submitLeaveText: "Submit Request",
      syncStatusText: "Syncing...", logout: "Logout", languageText: ""
    }
  };

  const { SECTION_DEFS, COMMON_ITEMS, PALETTES, LAYOUTS } = window.SiomacConfig;
  const ABOUT_ITEM = COMMON_ITEMS[1];

  // ─── Popup helpers ────────────────────────────────────────────────────────
  const showSpinner = (msg) => cpop.fire({ loading: true, title: msg || 'Loading...', allowOutsideClick: false, showConfirmButton: false });
  const hideSpinner = () => cpop.close();
  const showPopup = (type, title, text) => {
    const isAlert = type === 'error' || type === 'warning';
    return cpop.fire({ icon: type, title, text, showConfirmButton: true, allowOutsideClick: !isAlert, timer: undefined });
  };

  // ─── Field validation ─────────────────────────────────────────────────────
  function _fieldError(id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('field-invalid');
    let err = el.parentElement.querySelector('.field-error-msg');
    if (!err) { err = document.createElement('div'); err.className = 'field-error-msg'; el.parentElement.appendChild(err); }
    err.textContent = msg;
  }

  function _fieldOk(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('field-invalid');
    const err = el.parentElement && el.parentElement.querySelector('.field-error-msg');
    if (err) err.remove();
  }

  function _validate(rules) {
    let valid = true;
    rules.forEach(rule => {
      if (typeof rule.check === 'function') {
        const msg = rule.check();
        if (msg) { _fieldError(rule.id, msg); valid = false; } else _fieldOk(rule.id);
        return;
      }
      const el  = document.getElementById(rule.id);
      const raw = el ? el.value : '';
      const val = raw.trim();
      let msg = null;
      for (const r of (rule.rules || [])) {
        if (r === 'required' && !val) { msg = `${rule.label} is required.`; break; }
        if (r === 'email' && val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) { msg = `Enter a valid email address.`; break; }
        if (r === 'phone' && val) {
          const digits = val.replace(/\D/g, '');
          if (digits.length !== 10 || !digits.startsWith('868')) { msg = `Phone must be a complete (868) xxx-xxxx number.`; break; }
        }
        if (r === 'numeric' && val && isNaN(Number(val))) { msg = `${rule.label} must be a number.`; break; }
        if (r === 'positive' && val && Number(val) <= 0) { msg = `${rule.label} must be greater than 0.`; break; }
        if (typeof r === 'string' && r.startsWith('min:')) {
          const n = parseInt(r.split(':')[1]);
          if (val && val.length < n) { msg = `${rule.label} must be at least ${n} characters.`; break; }
        }
        if (typeof r === 'string' && r.startsWith('minval:')) {
          const n = parseFloat(r.split(':')[1]);
          if (val && Number(val) < n) { msg = `${rule.label} must be at least ${n}.`; break; }
        }
        if (typeof r === 'string' && r.startsWith('maxval:')) {
          const n = parseFloat(r.split(':')[1]);
          if (val && Number(val) > n) { msg = `${rule.label} must be at most ${n}.`; break; }
        }
      }
      if (msg) { _fieldError(rule.id, msg); valid = false; } else _fieldOk(rule.id);
    });
    return valid;
  }

  document.addEventListener('input',  e => { if (e.target instanceof Element && e.target.id) _fieldOk(e.target.id); }, true);
  document.addEventListener('change', e => { if (e.target instanceof Element && e.target.id) _fieldOk(e.target.id); }, true);

  // ─── getCurrentLocation (local fallback) ──────────────────────────────────
  const getCurrentLocation = () => new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ fallback: true, latitude: 10.6549, longitude: -61.5019, accuracy: 1000, timestamp: new Date().toISOString() });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy, timestamp: new Date().toISOString() }),
      ()  => resolve({ fallback: true, latitude: 10.6549, longitude: -61.5019, accuracy: 1000, timestamp: new Date().toISOString() }),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });

  // ─── _countUp ─────────────────────────────────────────────────────────────
  function _countUp(el, target, suffix, prefix, thousands) {
    if (!el) return;
    const sfx = suffix || '';
    const pfx = prefix || '';
    const fmt = v => thousands ? Math.round(v).toLocaleString() : Math.round(v);
    const current = parseInt(el.textContent.replace(/[^0-9.-]/g, ''), 10);
    const hasSkeleton = el.querySelector('.skeleton') !== null;
    const from = isNaN(current) ? 0 : current;
    const to   = Number(target) || 0;
    if (from === to && !hasSkeleton) { el.textContent = pfx + fmt(to) + sfx; return; }
    el.innerHTML = '';
    const steps = 30;
    const stepTime = 600 / steps;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      el.textContent = pfx + fmt(from + (to - from) * (step / steps)) + sfx;
      if (step >= steps) { el.textContent = pfx + fmt(to) + sfx; clearInterval(timer); }
    }, stepTime);
  }

  // ─── _spinBtn ─────────────────────────────────────────────────────────────
  function _spinBtn(idOrEl) {
    const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
    if (!el) return;
    el.classList.add('btn-spinning');
    setTimeout(() => el.classList.remove('btn-spinning'), 1000);
  }

  // ─── _swapAvatarImg ───────────────────────────────────────────────────────
  function _swapAvatarImg(el, url, initial, variant) {
    const preloaded = window._preloadedProfileImage;
    const isReady   = preloaded && window._preloadedProfileUrl === url && preloaded.complete && preloaded.naturalWidth > 0;

    function applyImg() {
      if (variant === 'hdr' || variant === 'attendance') {
        el.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
      } else if (variant === 'profile') {
        el.imgEl.src = url; el.imgEl.style.display = 'block';
        el.emptyEl.style.display = 'none';
        if (el.removeBtn) el.removeBtn.style.display = '';
      }
    }
    function applyFallback() {
      if (variant === 'profile') {
        el.imgEl.src = ''; el.imgEl.style.display = 'none';
        el.emptyEl.style.display = 'flex'; el.emptyEl.textContent = initial;
        if (el.removeBtn) el.removeBtn.style.display = 'none';
      }
    }

    if (isReady) { applyImg(); return; }
    if (variant === 'hdr')        el.textContent = initial;
    if (variant === 'attendance') el.innerHTML   = `<span>${initial}</span>`;
    const probe = new Image();
    probe.onload  = applyImg;
    probe.onerror = applyFallback;
    probe.src = url;
  }

  // ─── _setAttendanceAvatar ─────────────────────────────────────────────────
  function _setAttendanceAvatar(imgUrl, fullName) {
    const avatarDiv = document.querySelector('.user-avatar');
    if (!avatarDiv) return;
    const initial = (fullName || AppState.get('currentFullName') || '?').charAt(0).toUpperCase();
    if (imgUrl) { _swapAvatarImg(avatarDiv, imgUrl, initial, 'attendance'); }
    else { avatarDiv.innerHTML = `<span>${initial}</span>`; }
  }

  // ─── _profileToast ────────────────────────────────────────────────────────
  function _profileToast(msg, isError) {
    const el = document.getElementById('profileToast');
    if (!el) return;
    el.className = 'profile-toast' + (isError ? ' error' : '');
    el.innerHTML = `<i class="fas fa-${isError ? 'exclamation-circle' : 'check-circle'}"></i> ${msg}`;
    el.style.display = 'flex';
    clearTimeout(_profileToast._t);
    _profileToast._t = setTimeout(() => { el.style.display = 'none'; }, 3500);
  }

  // ─── Phone mask helpers ───────────────────────────────────────────────────
  const PREFIX     = '(868) ';
  const PREFIX_LEN = PREFIX.length;

  function _buildMasked(localDigits) {
    const d = localDigits.slice(0, 7);
    if (d.length === 0) return PREFIX;
    if (d.length <= 3)  return PREFIX + d;
    return PREFIX + d.slice(0, 3) + '-' + d.slice(3);
  }

  function _localDigits(raw) {
    if (!raw) return '';
    const all = raw.replace(/\D/g, '');
    return (all.startsWith('868') ? all.slice(3) : all).slice(0, 7);
  }

  function setPhone(idOrEl, value) {
    const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
    if (!el) return;
    el.value = value ? _buildMasked(_localDigits(value)) : '';
  }

  function readPhone(idOrEl) {
    const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
    if (!el) return '';
    const digits = _localDigits(el.value);
    if (!digits) return '';
    return _buildMasked(digits);
  }

  // ─── Phone mask IIFE ──────────────────────────────────────────────────────
  (function setupPhoneMask() {
    function onInput(e) {
      const el = e.target;
      if (!(el instanceof Element) || !el.classList.contains('phone-mask')) return;
      const rawValue = el.value;
      const cursorPos = el.selectionStart;
      const beforeCursor = rawValue.slice(0, cursorPos);
      const digitsBeforeCursor = _localDigits(beforeCursor);
      const digits = _localDigits(rawValue);
      const masked = _buildMasked(digits);
      el.value = masked;
      const target = digitsBeforeCursor.length;
      let count = 0, newPos = PREFIX_LEN;
      for (let i = PREFIX_LEN; i < masked.length; i++) {
        if (masked[i] === '-') continue;
        if (count === target) { newPos = i; break; }
        count++;
        newPos = masked.length;
      }
      if (count < target) newPos = masked.length;
      newPos = Math.max(newPos, PREFIX_LEN);
      el.setSelectionRange(newPos, newPos);
    }
    function onFocus(e) {
      const el = e.target;
      if (!(el instanceof Element) || !el.classList.contains('phone-mask')) return;
      if (!_localDigits(el.value)) el.value = PREFIX;
      setTimeout(() => { if (el.selectionStart < PREFIX_LEN) el.setSelectionRange(PREFIX_LEN, PREFIX_LEN); }, 0);
    }
    function onKeydown(e) {
      const el = e.target;
      if (!(el instanceof Element) || !el.classList.contains('phone-mask')) return;
      const pos = el.selectionStart;
      const selEnd = el.selectionEnd;
      if (e.key === 'Backspace' && pos <= PREFIX_LEN && pos === selEnd) { e.preventDefault(); return; }
      if (e.key === 'Delete'    && pos <  PREFIX_LEN && pos === selEnd) { e.preventDefault(); return; }
      if ((e.key === 'ArrowLeft' || e.key === 'Home') && pos <= PREFIX_LEN) {
        e.preventDefault(); el.setSelectionRange(PREFIX_LEN, PREFIX_LEN);
      }
    }
    function onBlur(e) {
      const el = e.target;
      if (!(el instanceof Element) || !el.classList.contains('phone-mask')) return;
      if (!_localDigits(el.value)) el.value = '';
    }
    document.addEventListener('input',   onInput,   true);
    document.addEventListener('focus',   onFocus,   true);
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('blur',    onBlur,    true);
  })();

  // ─── _buildPayslipHtml ────────────────────────────────────────────────────
  function _buildPayslipHtml(d) {
    const fmt  = n => Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const cycleLabel = { daily: 'Daily', weekly: 'Weekly', fortnightly: 'Fortnightly', monthly: 'Monthly' };
    const rateStr = d.pay_basis === 'hourly'
      ? `TTD ${fmt(d.hourly_rate)} / hr`
      : `TTD ${fmt(d.monthly_salary)} / month`;
    const ci = (typeof SettingsView !== 'undefined' && SettingsView.getCompanyInfo && SettingsView.getCompanyInfo()) || {};
    const sr = (typeof SettingsView !== 'undefined' && SettingsView.getStatutoryRates && SettingsView.getStatutoryRates()) || { allowanceAnnual: 90000, nisRate: 6 };
    return `
      <div class="pr-payslip">
        <div class="pr-payslip-header">
          <div class="pr-payslip-header-icon"><i class="fas fa-file-invoice-dollar"></i></div>
          <div class="pr-payslip-header-info">
            <div class="pr-payslip-subtitle">${escapeHtml(d.name || '—')}</div>
            <div class="pr-payslip-period">${escapeHtml(d.position || '—')} &bull; ${escapeHtml(d.department || '—')}</div>
          </div>
          <button class="pr-payslip-print-btn no-print" onclick="window._printPayslip()"><i class="fas fa-print"></i> Print</button>
          <button class="pr-payslip-close-btn no-print" onclick="cpop.close()"><i class="fas fa-times"></i></button>
        </div>
        <div class="pr-payslip-brand">
          ${ci.logoUrl ? `<img src="${escapeHtml(ci.logoUrl)}" alt="Logo" class="pr-payslip-brand-logo">` : ''}
          <div class="pr-payslip-brand-contact">
            <div class="pr-payslip-brand-name">${escapeHtml(ci.name || 'My Company')}</div>
            ${ci.address ? `<div class="pr-payslip-brand-detail">${escapeHtml(ci.address)}</div>` : ''}
            ${ci.phone   ? `<div class="pr-payslip-brand-detail"><i class="fas fa-phone"></i> ${escapeHtml(ci.phone)}</div>` : ''}
            ${ci.email   ? `<div class="pr-payslip-brand-detail"><i class="fas fa-envelope"></i> ${escapeHtml(ci.email)}</div>` : ''}
            <div class="pr-payslip-brand-detail">NIS Reg: ${escapeHtml(ci.nis || '1234567')}</div>
            <div class="pr-payslip-brand-detail">BIR File: ${escapeHtml(ci.bir || '100123456')}</div>
          </div>
        </div>
        <div class="pr-payslip-meta">
          <div class="pr-payslip-meta-col">
            <div class="pr-payslip-meta-row"><span>Pay Period</span><strong>${escapeHtml(d.date_from)} — ${escapeHtml(d.date_to)}</strong></div>
            <div class="pr-payslip-meta-row"><span>Pay Cycle</span><strong>${cycleLabel[d.pay_cycle] || d.pay_cycle || '—'}</strong></div>
            <div class="pr-payslip-meta-row"><span>Pay Date</span><strong>${escapeHtml(d.pay_date || '—')}</strong></div>
            <div class="pr-payslip-meta-row"><span>Payroll Type</span><strong>Normal</strong></div>
          </div>
          <div class="pr-payslip-meta-col">
            <div class="pr-payslip-meta-row"><span>Rate</span><strong>${rateStr}</strong></div>
            <div class="pr-payslip-meta-row"><span>Hours Worked</span><strong>${d.hours_worked || d.hoursWorked || 0}h</strong></div>
            <div class="pr-payslip-meta-row"><span>Days Worked</span><strong>${d.days_worked || d.daysWorked || '—'}</strong></div>
            <div class="pr-payslip-meta-row"><span>Personal Allowance</span><strong>TTD ${fmt(sr.allowanceAnnual)} / yr</strong></div>
            <div class="pr-payslip-meta-row pr-payslip-meta-row--sep"><span>NIS Reg</span><strong>${escapeHtml(ci.nis || '1234567')}</strong></div>
            <div class="pr-payslip-meta-row"><span>BIR File</span><strong>${escapeHtml(ci.bir || '100123456')}</strong></div>
          </div>
        </div>
        <div class="pr-payslip-tables">
          <div class="pr-payslip-table-col">
            <div class="pr-payslip-section-title"><i class="fas fa-plus-circle"></i> Earnings</div>
            <table class="pr-payslip-tbl">
              <thead><tr><th>Description</th><th>Rate</th><th>Units</th><th>Amount</th></tr></thead>
              <tbody>
                <tr><td>${d.pay_basis === 'hourly' ? 'Straight Time' : 'Monthly Salary'}</td><td>${d.pay_basis === 'hourly' ? fmt(d.hourly_rate || d.hourlyRate) : '—'}</td><td>${d.hours_worked || d.hoursWorked || '—'}</td><td>TTD ${fmt(d.gross_pay || d.grossPay)}</td></tr>
              </tbody>
            </table>
            <div class="pr-payslip-subtotal"><span>Gross Pay</span><span>TTD ${fmt(d.gross_pay || d.grossPay)}</span></div>
          </div>
          <div class="pr-payslip-table-col">
            <div class="pr-payslip-section-title"><i class="fas fa-minus-circle"></i> Deductions</div>
            <table class="pr-payslip-tbl">
              <thead><tr><th>Description</th><th>Amount</th></tr></thead>
              <tbody>
                <tr><td>Health Surcharge</td><td>${(d.health_surcharge || d.healthSurcharge) > 0 ? 'TTD ' + fmt(d.health_surcharge || d.healthSurcharge) : 'N/A'}</td></tr>
                <tr><td>NIS (${sr.nisRate}%)</td><td>${(d.nis) > 0 ? 'TTD ' + fmt(d.nis) : 'N/A'}</td></tr>
                <tr><td>PAYE</td><td>TTD ${fmt(d.paye)}</td></tr>
              </tbody>
            </table>
            <div class="pr-payslip-subtotal pr-payslip-subtotal--ded"><span>Total Deductions</span><span>TTD ${fmt(d.total_deductions || d.totalDeductions)}</span></div>
          </div>
        </div>
        <div class="pr-payslip-net"><span>Net Pay</span><span>TTD ${fmt(d.net_pay || d.netPay)}</span></div>
        <div class="pr-payslip-ytd">
          <div class="pr-payslip-section-title"><i class="fas fa-calendar-alt"></i> Year to Date</div>
          <div class="pr-payslip-ytd-row">
            <div class="pr-payslip-ytd-item"><span>Earnings</span><strong>TTD ${fmt(d.gross_pay || d.grossPay)}</strong></div>
            <div class="pr-payslip-ytd-item"><span>Gross</span><strong>TTD ${fmt(d.gross_pay || d.grossPay)}</strong></div>
            <div class="pr-payslip-ytd-item"><span>PAYE</span><strong>TTD ${fmt(d.paye)}</strong></div>
            <div class="pr-payslip-ytd-item"><span>NIS</span><strong>TTD ${fmt(d.nis)}</strong></div>
            <div class="pr-payslip-ytd-item"><span>HS</span><strong>TTD ${fmt(d.health_surcharge || d.healthSurcharge)}</strong></div>
          </div>
        </div>
        <div class="pr-payslip-footer">This is a computer-generated payslip &mdash; Trinidad &amp; Tobago</div>
      </div>`;
  }

  // ─── escapeHtml / cssEscape ───────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function cssEscape(s) {
    return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/(["\\])/g, '\\$1');
  }

  // ─── Session management ───────────────────────────────────────────────────
  function saveSession(payload, rememberMe) {
    try {
      const duration = rememberMe ? SESSION_DURATION_LONG : SESSION_DURATION;
      const data = Object.assign({}, payload, { expiresAt: Date.now() + duration, rememberMe: !!rememberMe });
      localStorage.setItem(SESSION_KEY, JSON.stringify(data));
    } catch (_) {}
  }

  function updateStoredSession(patch) {
    try {
      const s = loadSession();
      if (!s) return;
      localStorage.setItem(SESSION_KEY, JSON.stringify(Object.assign({}, s, patch || {})));
    } catch (_) {}
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !s.expiresAt || s.expiresAt < Date.now()) { localStorage.removeItem(SESSION_KEY); return null; }
      return s;
    } catch (_) { return null; }
  }

  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
    if (_sessExpTimer)  { clearTimeout(_sessExpTimer);   _sessExpTimer  = null; }
    if (_sessWarnTimer) { clearTimeout(_sessWarnTimer);  _sessWarnTimer = null; }
    if (_sessTickTimer) { clearInterval(_sessTickTimer); _sessTickTimer = null; }
    _sessWarned = false;
  }

  function startSessionTimer() {
    const s = loadSession();
    if (!s) return;
    const msLeft = s.expiresAt - Date.now();
    if (msLeft <= 0) { handleSessionExpired(); return; }
    if (_sessExpTimer)  clearTimeout(_sessExpTimer);
    if (_sessWarnTimer) clearTimeout(_sessWarnTimer);
    if (_sessTickTimer) clearInterval(_sessTickTimer);
    _sessExpTimer = setTimeout(handleSessionExpired, msLeft);
    if (msLeft > SESSION_WARN_AT) {
      _sessWarnTimer = setTimeout(handleSessionWarning, msLeft - SESSION_WARN_AT);
    } else if (!_sessWarned) {
      handleSessionWarning();
    }
    updateSessionWidget();
    _sessTickTimer = setInterval(updateSessionWidget, 30000);
  }

  function stopSessionTimer() {
    if (_sessExpTimer)  { clearTimeout(_sessExpTimer);   _sessExpTimer  = null; }
    if (_sessWarnTimer) { clearTimeout(_sessWarnTimer);  _sessWarnTimer = null; }
    if (_sessTickTimer) { clearInterval(_sessTickTimer); _sessTickTimer = null; }
  }

  function handleSessionWarning() {
    if (_sessWarned) return;
    _sessWarned = true;
    if (typeof Swal !== 'undefined') {
      Swal.fire({ icon: 'warning', title: 'Session Expiring', text: 'Your session will end in 5 minutes. Save your work.', timer: 6000, timerProgressBar: true, toast: true, position: 'top-end', showConfirmButton: false });
    }
  }

  function handleSessionExpired() {
    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'info', title: 'Session Expired', text: 'Please log in again.', showConfirmButton: true });
    handleLogout();
  }

  function updateSessionWidget() {
    const widget = document.getElementById('sessionTimer');
    if (!widget) return;
    const s = loadSession();
    if (!s) { widget.classList.add('hidden'); return; }
    widget.classList.remove('hidden');
    const msLeft = s.expiresAt - Date.now();
    if (msLeft <= 0) { handleSessionExpired(); return; }
    const totalMins = Math.floor(msLeft / 60000);
    const secs = Math.floor((msLeft % 60000) / 1000);
    let txt;
    if (totalMins >= 60) {
      const h = Math.floor(totalMins / 60); const m = totalMins % 60;
      txt = m > 0 ? `${h}h ${m}m` : `${h}h`;
    } else if (totalMins >= 1) {
      txt = totalMins + 'm';
    } else {
      txt = secs + 's';
    }
    const danger = msLeft <= SESSION_WARN_AT;
    const txtEl = document.getElementById('sessionTimerText');
    if (txtEl) txtEl.textContent = txt;
    widget.classList.toggle('warn', danger);
  }

  // ─── Auth ─────────────────────────────────────────────────────────────────
  function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;

    document.getElementById('username').classList.remove('is-invalid');
    document.getElementById('password').classList.remove('is-invalid');
    const errBanner = document.getElementById('loginErrorBanner');
    if (errBanner) { errBanner.style.display = 'none'; errBanner.textContent = ''; }

    let isValid = true;
    if (!username || username.length < 3) {
      document.getElementById('username').classList.add('is-invalid');
      document.getElementById('usernameError').textContent = 'Username must be at least 3 characters';
      isValid = false;
    }
    if (!password || password.length < 1) {
      document.getElementById('password').classList.add('is-invalid');
      document.getElementById('passwordError').textContent = 'Password is required';
      isValid = false;
    }
    if (!isValid) return;

    clearSession();
    showSpinner('Authenticating...');
    api('login', { username, password }).then(handleLoginSuccess);
  }

  // ── 2FA state (lives only in memory, never persisted) ─────────────────────
  let _tfa = { preAuthToken: null, rememberMe: false };

  function handleLoginSuccess(result) {
    hideSpinner();
    if (!result.success) {
      const msg = result.message || 'Invalid username or password.';
      const errBanner = document.getElementById('loginErrorBanner');
      if (errBanner) { errBanner.textContent = msg; errBanner.style.display = 'flex'; }
      const uEl = document.getElementById('username');
      const pEl = document.getElementById('password');
      if (uEl) uEl.classList.add('is-invalid');
      if (pEl) { pEl.classList.add('is-invalid'); pEl.value = ''; pEl.focus(); }
      return;
    }

    // ── 2FA: must verify TOTP code ──────────────────────────────────────────
    if (result.requiresTwoFactor) {
      _tfa.preAuthToken = result.preAuthToken;
      _tfa.rememberMe   = document.getElementById('rememberMe').checked;
      _showTfaVerifyPanel();
      return;
    }

    // ── 2FA: mandatory role, must enrol first ───────────────────────────────
    if (result.requiresSetup) {
      _tfa.preAuthToken = result.preAuthToken;
      _tfa.rememberMe   = document.getElementById('rememberMe').checked;
      _startTfaSetup();
      return;
    }

    // ── No 2FA required — complete login ────────────────────────────────────
    _completeLogin(result);
  }

  function _completeLogin(result) {
    clearSession();
    AppState.set('currentUser',     null);
    AppState.set('currentUserId',   null);
    AppState.set('currentFullName', null);
    AppState.set('currentDeptId',   null);
    AppState.set('currentRole',     null);

    const rememberMe = _tfa.rememberMe || document.getElementById('rememberMe').checked;
    if (rememberMe) { localStorage.setItem('rememberedUser', result.username); }
    else            { localStorage.removeItem('rememberedUser'); }

    _tfa = { preAuthToken: null, rememberMe: false };   // clear state

    saveSession({
      userId: result.userId, username: result.username, fullName: result.fullName,
      role: result.role, departmentId: result.departmentId || '', position: result.position || '',
      colorScheme: result.colorScheme || 'navy', layoutMode: result.layoutMode || 'sidebar',
      token: result.token || '',
      companyName: result.companyName || '', companyLogoUrl: result.companyLogoUrl || '',
      profileImage: result.profileImage || ''
    }, rememberMe);

    applySession(result, /*announce*/ true);
  }

  // ── Panel helpers ──────────────────────────────────────────────────────────

  function _showLoginPanel() {
    document.getElementById('loginForm').style.display    = '';
    document.getElementById('twoFaPanel').style.display  = 'none';
    document.getElementById('twoFaSetupPanel').style.display = 'none';
    _tfa = { preAuthToken: null, rememberMe: false };
  }

  function _showTfaVerifyPanel() {
    document.getElementById('loginForm').style.display       = 'none';
    document.getElementById('twoFaSetupPanel').style.display = 'none';
    document.getElementById('twoFaPanel').style.display      = '';
    // Reset OTP inputs
    _tfaOtpClear('tfaOtpRow');
    document.getElementById('tfaErrorBanner').style.display = 'none';
    document.getElementById('tfaBackupSection').style.display = 'none';
    // Focus first digit
    const first = document.querySelector('#tfaOtpRow .tfa-otp-digit');
    if (first) first.focus();
  }

  // ── OTP digit-box wiring ───────────────────────────────────────────────────

  function _tfaOtpClear(rowId) {
    document.querySelectorAll(`#${rowId} .tfa-otp-digit`).forEach(el => {
      el.value = '';
      el.classList.remove('is-error');
    });
  }

  function _tfaOtpValue(rowId) {
    return [...document.querySelectorAll(`#${rowId} .tfa-otp-digit`)]
      .map(el => el.value).join('');
  }

  function _wireOtpRow(rowId, onComplete) {
    const digits = document.querySelectorAll(`#${rowId} .tfa-otp-digit`);
    digits.forEach((el, i) => {
      el.addEventListener('input', () => {
        // Only allow digits
        el.value = el.value.replace(/\D/g, '').slice(-1);
        if (el.value && i < digits.length - 1) digits[i + 1].focus();
        if (_tfaOtpValue(rowId).length === 6) onComplete();
      });
      el.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !el.value && i > 0) {
          digits[i - 1].value = '';
          digits[i - 1].focus();
        }
        if (e.key === 'ArrowLeft'  && i > 0) digits[i - 1].focus();
        if (e.key === 'ArrowRight' && i < digits.length - 1) digits[i + 1].focus();
      });
      // Handle paste of a full 6-digit code on the first box
      el.addEventListener('paste', e => {
        const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
        if (pasted.length >= 6) {
          e.preventDefault();
          digits.forEach((d, j) => { d.value = pasted[j] || ''; });
          onComplete();
        }
      });
    });
  }

  // ── TOTP verify flow ───────────────────────────────────────────────────────

  function _submitTfaCode(code) {
    if (!_tfa.preAuthToken) return;
    const errEl = document.getElementById('tfaErrorBanner');
    errEl.style.display = 'none';
    showSpinner('Verifying…');
    api('verify2fa', { preAuthToken: _tfa.preAuthToken, code })
      .then(result => {
        hideSpinner();
        if (!result.success) {
          errEl.textContent = result.message || 'Invalid code. Try again.';
          errEl.style.display = 'flex';
          _tfaOtpClear('tfaOtpRow');
          document.querySelector('#tfaOtpRow .tfa-otp-digit').focus();
          return;
        }
        _completeLogin(result);
      });
  }

  // ── 2FA Setup flow ─────────────────────────────────────────────────────────

  function _startTfaSetup() {
    showSpinner('Setting up 2FA…');
    api('setup2fa', { preAuthToken: _tfa.preAuthToken })
      .then(result => {
        hideSpinner();
        if (!result.success) {
          const errBanner = document.getElementById('loginErrorBanner');
          if (errBanner) { errBanner.textContent = result.message || 'Setup failed. Please log in again.'; errBanner.style.display = 'flex'; }
          _showLoginPanel();
          return;
        }
        // Show QR code panel
        document.getElementById('loginForm').style.display       = 'none';
        document.getElementById('twoFaPanel').style.display      = 'none';
        document.getElementById('twoFaSetupPanel').style.display = '';
        document.getElementById('setupStepQr').style.display      = '';
        document.getElementById('setupStepConfirm').style.display = 'none';
        document.getElementById('setupStepBackup').style.display  = 'none';

        document.getElementById('setupQrImg').src = result.qrCode || '';
        // Format manual code in groups of 4 for readability
        const raw = result.manualCode || '';
        document.getElementById('setupManualCode').textContent =
          raw.match(/.{1,4}/g)?.join(' ') || raw;
      });
  }

  function _showSetupConfirm() {
    document.getElementById('setupStepQr').style.display      = 'none';
    document.getElementById('setupStepConfirm').style.display = '';
    _tfaOtpClear('setupOtpRow');
    document.getElementById('setupErrorBanner').style.display = 'none';
    const first = document.querySelector('#setupOtpRow .tfa-otp-digit');
    if (first) first.focus();
  }

  function _submitSetupConfirm(code) {
    if (!_tfa.preAuthToken) return;
    const errEl = document.getElementById('setupErrorBanner');
    errEl.style.display = 'none';
    showSpinner('Enabling 2FA…');
    api('confirm2faSetup', { preAuthToken: _tfa.preAuthToken, code })
      .then(result => {
        hideSpinner();
        if (!result.success) {
          errEl.textContent = result.message || 'Invalid code. Try again.';
          errEl.style.display = 'flex';
          _tfaOtpClear('setupOtpRow');
          document.querySelector('#setupOtpRow .tfa-otp-digit').focus();
          return;
        }
        // Show backup codes
        _showBackupCodes(result.backupCodes || [], result);
      });
  }

  function _showBackupCodes(codes, sessionResult) {
    document.getElementById('setupStepConfirm').style.display = 'none';
    document.getElementById('setupStepBackup').style.display  = '';
    const list = document.getElementById('setupBackupList');
    list.innerHTML = codes.map(c =>
      `<code>${c.slice(0,4)}-${c.slice(4)}</code>`
    ).join('');
    // Copy button
    document.getElementById('setupBackupCopy').onclick = () => {
      navigator.clipboard.writeText(codes.map(c => `${c.slice(0,4)}-${c.slice(4)}`).join('\n'))
        .then(() => { document.getElementById('setupBackupCopy').innerHTML = '<i class="fas fa-check"></i> Copied!'; });
    };
    // Done button completes login
    document.getElementById('setupDoneBtn').onclick = () => _completeLogin(sessionResult);
  }

  function applySession(result, announce) {
    AppState.set('currentUser',     result.username);
    AppState.set('currentUserId',   result.userId);
    AppState.set('currentFullName', result.fullName || result.username);
    AppState.set('currentDeptId',   result.departmentId || '');
    AppState.set('currentRole',     result.role);

    currentColorScheme = result.colorScheme || 'navy';
    Nav.applyPalette(currentColorScheme);
    currentLayoutMode = result.layoutMode || 'sidebar';
    Nav.applyLayout(currentLayoutMode);

    document.getElementById('loginPage').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');
    document.documentElement.classList.add('app-active');
    document.body.classList.add('app-active');

    // Header profile avatar
    const hdrAvatarEl = document.getElementById('hdrProfileAvatar');
    if (hdrAvatarEl) {
      const initial = (AppState.get('currentFullName') || AppState.get('currentUser') || '?').trim().charAt(0).toUpperCase();
      if (result.profileImage) { _swapAvatarImg(hdrAvatarEl, result.profileImage, initial, 'hdr'); }
      else { hdrAvatarEl.textContent = initial; }
    }

    // Dashboard pill
    const dashAv = document.getElementById('dashProfileAvatar');
    if (dashAv) {
      const initial = (AppState.get('currentFullName') || '?').trim().charAt(0).toUpperCase();
      if (result.profileImage) { _swapAvatarImg(dashAv, result.profileImage, initial, 'hdr'); }
      else { dashAv.textContent = initial; }
    }
    const dashName = document.getElementById('dashProfileName');
    if (dashName) dashName.textContent = AppState.get('currentFullName') || AppState.get('currentUser') || 'Admin';
    const dashRole = document.getElementById('dashProfileRole');
    const role = AppState.get('currentRole') || 'admin';
    if (dashRole) dashRole.textContent = role.charAt(0).toUpperCase() + role.slice(1);

    // Employee pill
    const _empAv = document.getElementById('empProfileAvatar');
    if (_empAv) {
      const initial = (AppState.get('currentFullName') || '?').trim().charAt(0).toUpperCase();
      if (result.profileImage) { _swapAvatarImg(_empAv, result.profileImage, initial, 'hdr'); } else { _empAv.textContent = initial; }
    }
    const _empName = document.getElementById('empProfileName');
    if (_empName) _empName.textContent = AppState.get('currentFullName') || AppState.get('currentUser') || 'Employee';
    const _empRole = document.getElementById('empProfileRole');
    if (_empRole) _empRole.textContent = (AppState.get('currentRole') || 'employee').charAt(0).toUpperCase() + (AppState.get('currentRole') || 'employee').slice(1);

    // Manager pill
    const _mgrAv = document.getElementById('mgrProfileAvatar');
    if (_mgrAv) {
      const initial = (AppState.get('currentFullName') || '?').trim().charAt(0).toUpperCase();
      if (result.profileImage) { _swapAvatarImg(_mgrAv, result.profileImage, initial, 'hdr'); } else { _mgrAv.textContent = initial; }
    }
    const _mgrName = document.getElementById('mgrProfileName');
    if (_mgrName) _mgrName.textContent = AppState.get('currentFullName') || AppState.get('currentUser') || 'Manager';
    const _mgrRole = document.getElementById('mgrProfileRole');
    if (_mgrRole) _mgrRole.textContent = (AppState.get('currentRole') || 'manager').charAt(0).toUpperCase() + (AppState.get('currentRole') || 'manager').slice(1);

    // Admin section pills
    const _admPillPrefixes = ['admEmp','admDept','admProj','admAtt','admLv','admRates','admPay','admProf','admStg','admAbt'];
    _admPillPrefixes.forEach(pfx => {
      const _av = document.getElementById(pfx + 'ProfileAvatar');
      if (_av) {
        const initial = (AppState.get('currentFullName') || '?').trim().charAt(0).toUpperCase();
        if (result.profileImage) { _swapAvatarImg(_av, result.profileImage, initial, 'hdr'); } else { _av.textContent = initial; }
      }
      const _nm = document.getElementById(pfx + 'ProfileName');
      if (_nm) _nm.textContent = AppState.get('currentFullName') || AppState.get('currentUser') || 'Admin';
      const _rl = document.getElementById(pfx + 'ProfileRole');
      if (_rl) _rl.textContent = (AppState.get('currentRole') || 'admin').charAt(0).toUpperCase() + (AppState.get('currentRole') || 'admin').slice(1);
    });

    if (result.profileImage !== undefined) {
      _currentProfileImage = result.profileImage || '';
      _patchPhotoCache(AppState.get('currentUser'), _currentProfileImage);
    }

    if (result.companyLogoUrl) SettingsView.applyCompanyLogo(result.companyLogoUrl);
    SettingsView.applyCompanyName(result.companyName || 'My Company');
    if (typeof SettingsView !== 'undefined' && SettingsView.refreshCompanySettings) SettingsView.refreshCompanySettings();

    document.querySelectorAll('.admin-only').forEach(el => { el.style.display = AppState.get('currentRole') === 'admin' ? '' : 'none'; });
    document.querySelectorAll('.non-admin-only').forEach(el => { el.style.display = AppState.get('currentRole') !== 'admin' ? '' : 'none'; });
    if (typeof SettingsView !== 'undefined' && SettingsView._stgActivatePanel) SettingsView._stgActivatePanel(AppState.get('currentRole') === 'admin' ? 'company' : 'appearance');

    Nav.buildSidebar(AppState.get('currentRole'));
    Nav.buildTopTabs(AppState.get('currentRole'));
    const def = (SECTION_DEFS[AppState.get('currentRole')] || [ABOUT_ITEM])[0];
    if (announce) {
      try { localStorage.removeItem('siomac_last_section_' + AppState.get('currentRole')); } catch(e) {}
      Nav.showSection(def.id);
    } else {
      let lastSection = null;
      try { lastSection = localStorage.getItem('siomac_last_section_' + AppState.get('currentRole')); } catch(e) {}
      Nav.showSection((lastSection && document.getElementById(lastSection)) ? lastSection : def.id);
    }

    if (AppState.get('currentRole') === 'employee') {
      _setAttendanceAvatar(result.profileImage || '', AppState.get('currentFullName'));
      document.getElementById('displayNameText').textContent = AppState.get('currentFullName');
      const roleDept = document.getElementById('ea-role-dept');
      if (roleDept) {
        const pos  = result.position   || '';
        const dept = result.department || '';
        roleDept.textContent = pos && dept ? `${pos} · ${dept}` : pos || dept || '—';
      }
      startLocationTracking();
    }

    startAutoSync();
    startSessionTimer();
    updateLanguageUI();

    try {
      const _MAP_VISITED_KEY = 'siomac_map_last_visited';
      const lv = parseInt(localStorage.getItem(_MAP_VISITED_KEY) || '0', 10) || 0;
      if (!lv) localStorage.setItem(_MAP_VISITED_KEY, String(Date.now()));
    } catch (_) {}

    if (typeof Nav !== 'undefined' && Nav._doHdrBadgeSync) Nav._doHdrBadgeSync();
    if (typeof window._startNotifPolling === 'function') window._startNotifPolling();
    if (typeof window._startMsgSystem    === 'function') window._startMsgSystem();
    if (typeof window._startTicketSystem === 'function') window._startTicketSystem();
    if (typeof window._initRealtime      === 'function') window._initRealtime(AppState.get('currentUserId'));
    if (typeof Nav !== 'undefined' && Nav._scheduleHdrBadgeSync) setInterval(Nav._scheduleHdrBadgeSync, 30 * 1000);

    setTimeout(function _bulkPhotoPreload() {
      _rawApi('listEmployees', {}).then(function(res) {
        const employees = (res && res.data) || (Array.isArray(res) ? res : []);
        employees.forEach(function(e) { if (e.username && e.profileImage) _patchPhotoCache(e.username, e.profileImage); if (e.profileImage) { const img = new Image(); img.src = e.profileImage; } });
      }).catch(function() {});
    }, 1500);
  }

  function handleLogout() {
    const currentUser   = AppState.get('currentUser');
    const currentUserId = AppState.get('currentUserId');
    if (currentUser) api('logout', { userId: currentUserId, username: currentUser });

    stopCamera();
    stopAutoSync();
    clearSession();
    const locationWatchId = AppState.get('locationWatchId');
    if (locationWatchId && navigator.geolocation) navigator.geolocation.clearWatch(locationWatchId);

    AppState.set('currentUser',     null);
    AppState.set('currentUserId',   null);
    AppState.set('currentFullName', null);
    AppState.set('currentDeptId',   null);
    AppState.set('currentRole',     null);
    AppState.set('cameraStream',    null);
    AppState.set('locationWatchId', null);
    AppState.set('syncInterval',    null);
    AppState.set('mapViewSet',      false);
    AppState.set('selectedSiteId',  '');
    AppState.set('siteLayerMap',    {});
    AppState.set('activeEmpMarker', null);

    _currentProfileImage = null;
    _clearPhotoCache();
    _resetLoadedState();

    const _lmSelReset = document.getElementById('lmSiteSelect');
    if (_lmSelReset) { _lmSelReset.innerHTML = '<option value="">— Select a project site —</option>'; _lmSelReset.value = ''; }

    if (_attFpFrom) { _attFpFrom.destroy(); _attFpFrom = null; }
    if (_attFpTo)   { _attFpTo.destroy();   _attFpTo   = null; }

    if (typeof window._stopNotifPolling  === 'function') window._stopNotifPolling();
    if (typeof window._stopMsgSystem     === 'function') window._stopMsgSystem();
    if (typeof window._stopTicketSystem  === 'function') window._stopTicketSystem();
    if (typeof window._teardownRealtime  === 'function') window._teardownRealtime();

    document.getElementById('appShell').classList.add('hidden');
    document.getElementById('loginPage').classList.remove('hidden');
    document.documentElement.classList.remove('app-active');
    document.body.classList.remove('app-active');
    document.querySelectorAll('.app-section').forEach(s => s.classList.remove('active'));
    document.getElementById('sidebarMenu').innerHTML = '';
    document.getElementById('password').value = '';
    document.getElementById('loginForm').reset();
  }

  // ─── Camera & attendance ──────────────────────────────────────────────────
  function _updateCmLocationDisplay(location) {
    const locEl = document.getElementById('locationValidation');
    if (!locEl) return;
    const accuracy = location.fallback ? 'Approximate location' : `Accuracy: ${Math.round(location.accuracy)}m`;
    const siteSelect = document.getElementById('cmSiteSelect');
    const siteOpt = siteSelect && siteSelect.value ? siteSelect.options[siteSelect.selectedIndex] : null;
    const siteLat  = siteOpt ? parseFloat(siteOpt.dataset.lat  || '') : NaN;
    const siteLng  = siteOpt ? parseFloat(siteOpt.dataset.lng  || '') : NaN;
    const siteRad  = siteOpt ? parseInt(siteOpt.dataset.radius || '200') : 200;
    if (!location.fallback && siteOpt && !isNaN(siteLat) && !isNaN(siteLng)) {
      const R = 6371000;
      const toRad = d => d * Math.PI / 180;
      const dLat = toRad(siteLat - location.latitude);
      const dLng = toRad(siteLng - location.longitude);
      const a = Math.sin(dLat/2)**2 + Math.cos(toRad(location.latitude)) * Math.cos(toRad(siteLat)) * Math.sin(dLng/2)**2;
      const dist = Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
      const gpsAcc = Math.round(location.accuracy || 0);
      const allowedRadius = siteRad + gpsAcc;
      const insideFence = dist <= allowedRadius;
      locEl.className = 'cm-location ' + (insideFence ? 'cm-location--valid' : 'cm-location--warn');
      const distLabel = dist < 1000 ? `${dist}m away` : `${(dist/1000).toFixed(1)}km away`;
      const coordLabel = `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;
      locEl.innerHTML = `<i class="fas fa-${insideFence ? 'check-circle' : 'exclamation-triangle'} fa-fw"></i><span>${insideFence ? 'Within site · ' : 'Too far · '}${distLabel} · ${accuracy} · ${coordLabel}</span>`;
    } else {
      const coordLabel = (!location.fallback && location.latitude) ? ` · ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}` : '';
      locEl.className = 'cm-location cm-location--valid';
      locEl.innerHTML = `<i class="fas fa-check-circle fa-fw"></i><span>Location verified · ${accuracy}${coordLabel}</span>`;
    }
  }

  function openCameraModal(action) {
    AppState.set('currentAttendanceAction', action);
    AppState.set('capturedPhotoData',       null);
    AppState.set('currentLocationData',     null);

    document.getElementById('captureBtn').style.display = '';
    document.getElementById('captureBtn').disabled = false;
    document.getElementById('retakeBtn').style.display = 'none';
    document.getElementById('confirmBtn').style.display = 'none';
    document.getElementById('confirmBtn').disabled = true;
    document.getElementById('capturedPhoto').classList.add('d-none');
    document.querySelector('.cm-camera-area').classList.remove('d-none');
    document.getElementById('cameraPreview').classList.remove('d-none');
    document.getElementById('photoCanvas').classList.add('d-none');

    const isCheckIn = action === 'CheckIn';
    const titleEl = document.getElementById('cameraModalTitle');
    titleEl.innerHTML = `<i class="fas fa-camera"></i> ${isCheckIn ? 'Check In' : 'Check Out'} · Selfie Verification`;
    document.getElementById('confirmText').textContent = isCheckIn ? 'Confirm Check In' : 'Confirm Check Out';

    const siteWrap   = document.getElementById('cmSiteWrap');
    const siteSelect = document.getElementById('cmSiteSelect');
    const siteStatus = document.getElementById('cmSiteStatus');
    if (isCheckIn) {
      siteWrap.style.display = '';
      siteSelect.innerHTML = '<option value="">— Choose a project site —</option>';
      siteStatus.className = 'cm-site-status cm-site-status--required';
      siteStatus.innerHTML = '<i class="fas fa-exclamation-circle"></i> Required';
      document.getElementById('captureBtn').disabled = true;
      document.getElementById('confirmBtn').disabled = true;
      const populate = (sites) => {
        const currentRole   = AppState.get('currentRole');
        const currentUserId = AppState.get('currentUserId');
        let filtered = sites;
        if (currentRole === 'employee') {
          filtered = sites.filter(s => (s.assignedEmployees || []).some(e => e.id === currentUserId));
        }
        if (!filtered.length && currentRole === 'employee') {
          siteSelect.innerHTML = '<option value="">— No sites assigned to you —</option>';
        } else {
          siteSelect.innerHTML = '<option value="">— Choose a site —</option>'
            + filtered.map(s => `<option value="${escapeHtml(s.id)}" data-lat="${Number(s.latitude)||''}" data-lng="${Number(s.longitude)||''}" data-radius="${Number(s.radius)||200}">${escapeHtml(s.name)}</option>`).join('');
        }
      };
      const projectSites = AppState.get('projectSites') || [];
      if (projectSites && projectSites.length) {
        populate(projectSites);
      } else {
        api('listProjectSites', {}).then(res => {
          const sites = (res && res.success && res.data) || [];
          AppState.set('projectSites', sites);
          populate(sites);
        });
      }
    } else {
      siteWrap.style.display = 'none';
    }

    const locEl = document.getElementById('locationValidation');
    locEl.className = 'cm-location cm-location--pending';
    locEl.innerHTML = '<i class="fas fa-spinner fa-pulse fa-fw"></i><span>Verifying your location…</span>';

    getCurrentLocation().then(location => {
      AppState.set('currentLocationData', location);
      _updateCmLocationDisplay(location);
      if (!isCheckIn) document.getElementById('confirmBtn').disabled = false;
    }).catch(() => {
      const locEl2 = document.getElementById('locationValidation');
      locEl2.className = 'cm-location cm-location--valid';
      locEl2.innerHTML = '<i class="fas fa-check-circle fa-fw"></i><span>Location available</span>';
      if (!isCheckIn) document.getElementById('confirmBtn').disabled = false;
    });

    startCamera();
    const cameraModal = new bootstrap.Modal(document.getElementById('cameraModal'));
    cameraModal.show();
  }

  document.getElementById('cmSiteSelect').addEventListener('change', function () {
    const captureBtn = document.getElementById('captureBtn');
    const confirmBtn = document.getElementById('confirmBtn');
    const siteStatus = document.getElementById('cmSiteStatus');
    if (this.value) {
      captureBtn.disabled = false;
      if (AppState.get('capturedPhotoData')) confirmBtn.disabled = false;
      siteStatus.className = 'cm-site-status cm-site-status--ok';
      siteStatus.innerHTML = `<i class="fas fa-check-circle"></i> ${escapeHtml(this.options[this.selectedIndex].text)}`;
    } else {
      captureBtn.disabled = true;
      confirmBtn.disabled = true;
      siteStatus.className = 'cm-site-status cm-site-status--required';
      siteStatus.innerHTML = '<i class="fas fa-exclamation-circle"></i> Required';
    }
    const currentLocationData = AppState.get('currentLocationData');
    if (currentLocationData) _updateCmLocationDisplay(currentLocationData);
  });

  function startCamera() {
    stopCamera();
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } })
      .then(stream => {
        AppState.set('cameraStream', stream);
        const video = document.getElementById('cameraPreview');
        video.srcObject = stream;
      })
      .catch(error => {
        console.error('Camera error:', error);
        showPopup('error', 'Camera Error', 'Could not access camera. Please ensure camera permissions are granted.');
      });
  }

  function stopCamera() {
    const cameraStream = AppState.get('cameraStream');
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      AppState.set('cameraStream', null);
    }
  }

  function capturePhoto() {
    const video = document.getElementById('cameraPreview');
    const canvas = document.getElementById('photoCanvas');
    if (!video || video.readyState !== 4) { showPopup('error', 'Camera Error', 'Camera is not ready.'); return; }
    const maxDim = 640;
    let vw = video.videoWidth, vh = video.videoHeight;
    let scale = Math.min(1, maxDim / Math.max(vw, vh));
    const w = Math.round(vw * scale), h = Math.round(vh * scale);
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.save(); ctx.translate(w, 0); ctx.scale(-1, 1); ctx.drawImage(video, 0, 0, w, h); ctx.restore();
    let capturedPhotoData;
    try { capturedPhotoData = canvas.toDataURL('image/jpeg', 0.7); } catch(e) { capturedPhotoData = canvas.toDataURL(); }
    AppState.set('capturedPhotoData', capturedPhotoData);
    document.getElementById('photoPreview').src = capturedPhotoData;
    document.getElementById('captureBtn').style.display = 'none';
    const retakeBtn = document.getElementById('retakeBtn');
    const confirmBtn = document.getElementById('confirmBtn');
    retakeBtn.style.display = '';
    retakeBtn.classList.remove('cm-btn--animate','cm-btn--animate-delay');
    void retakeBtn.offsetWidth; retakeBtn.classList.add('cm-btn--animate');
    confirmBtn.style.display = '';
    confirmBtn.classList.remove('cm-btn--animate','cm-btn--animate-delay');
    void confirmBtn.offsetWidth; confirmBtn.classList.add('cm-btn--animate-delay');
    if (AppState.get('currentAttendanceAction') === 'CheckIn') {
      const siteVal = (document.getElementById('cmSiteSelect') || {}).value || '';
      confirmBtn.disabled = !siteVal;
    } else { confirmBtn.disabled = false; }
    document.getElementById('capturedPhoto').classList.remove('d-none');
    document.querySelector('.cm-camera-area').classList.add('d-none');
    document.getElementById('cameraPreview').classList.add('d-none');
    document.getElementById('cameraModalTitle').innerHTML = '<i class="fas fa-check-circle"></i> Verify Selfie';
    stopCamera();
  }

  function retakePhoto() {
    AppState.set('capturedPhotoData', null);
    document.getElementById('captureBtn').style.display = '';
    if (AppState.get('currentAttendanceAction') === 'CheckIn') {
      const siteVal = (document.getElementById('cmSiteSelect') || {}).value || '';
      document.getElementById('captureBtn').disabled = !siteVal;
    } else { document.getElementById('captureBtn').disabled = false; }
    const _rb = document.getElementById('retakeBtn');
    const _cb = document.getElementById('confirmBtn');
    _rb.style.display = 'none'; _rb.classList.remove('cm-btn--animate','cm-btn--animate-delay');
    _cb.style.display = 'none'; _cb.classList.remove('cm-btn--animate','cm-btn--animate-delay'); _cb.disabled = true;
    document.getElementById('capturedPhoto').classList.add('d-none');
    document.querySelector('.cm-camera-area').classList.remove('d-none');
    document.getElementById('cameraPreview').classList.remove('d-none');
    const action = AppState.get('currentAttendanceAction');
    document.getElementById('cameraModalTitle').innerHTML = `<i class="fas fa-camera"></i> ${action === 'CheckIn' ? 'Check In' : 'Check Out'} · Selfie Verification`;
    startCamera();
  }

  function confirmAttendance() {
    const capturedPhotoData     = AppState.get('capturedPhotoData');
    const currentAttendanceAction = AppState.get('currentAttendanceAction');
    const currentLocationData   = AppState.get('currentLocationData');
    const currentUser           = AppState.get('currentUser');
    if (!capturedPhotoData) { showPopup('error', 'No Photo', 'Please capture a photo before confirming.'); return; }
    const siteSelect = document.getElementById('cmSiteSelect');
    const siteId = (currentAttendanceAction === 'CheckIn' && siteSelect) ? (siteSelect.value || '') : '';
    if (currentAttendanceAction === 'CheckIn' && !currentLocationData) {
      showPopup('error', 'Location Required', 'Your location could not be determined. Please enable GPS and try again.'); return;
    }
    showSpinner('Processing attendance...');
    const loc = currentLocationData ? { latitude: currentLocationData.latitude, longitude: currentLocationData.longitude, accuracy: currentLocationData.accuracy } : null;
    api('markAttendance', { username: currentUser, action: currentAttendanceAction, photoBase64: capturedPhotoData, location: loc, siteId })
      .then(handleAttendanceSuccess)
      .catch(err => { hideSpinner(); showPopup('error', 'Network Error', err.message || 'Could not connect to server'); });
  }

  function handleAttendanceSuccess(result) {
    hideSpinner();
    if (result.success) {
      const currentAttendanceAction = AppState.get('currentAttendanceAction');
      const actionText = currentAttendanceAction === 'CheckIn' ? 'Check In' : 'Check Out';
      const timeDisplay = result.time ? fmtLocalTime(result.time) : '';
      showPopup('success', `${actionText} Successful!`, `${timeDisplay}${result.site ? ' · ' + result.site : ''}`);
      const cameraModal = bootstrap.Modal.getInstance(document.getElementById('cameraModal'));
      if (cameraModal) cameraModal.hide();
      const isCheckIn = currentAttendanceAction === 'CheckIn';
      updateDashboardUI({ hasCheckedIn: true, hasCheckedOut: !isCheckIn, checkInTime: isCheckIn ? result.time : null, checkOutTime: isCheckIn ? null : result.time, location: result.site || '' });
      ['getMyStatus:', 'getMyChart:', 'getMyHistory:', 'getLiveAttendance:'].forEach(pfx => {
        swr.clearByPrefix(pfx);
        for (const k of _swrLastHash.keys()) { if (k.indexOf(pfx) === 0) _swrLastHash.delete(k); }
      });
      checkStatus();
      if (currentAttendanceAction === 'CheckIn') Dashboard.loadChart();
      if (typeof Employees !== 'undefined' && Employees.loadEmployeeList) Employees.loadEmployeeList(true);
      if (typeof LiveMap   !== 'undefined' && LiveMap.loadLiveAttendance) LiveMap.loadLiveAttendance();
      if (typeof Nav !== 'undefined' && Nav._scheduleHdrBadgeSync) Nav._scheduleHdrBadgeSync();
    } else {
      showPopup('error', 'Attendance Failed', result.message || 'Unknown error occurred');
    }
  }

  // ─── Employee section ─────────────────────────────────────────────────────
  function checkStatus() {
    _skelOnce('s-emp-attendance', () => {
      const sb = document.getElementById('statusBadge');
      if (sb) sb.innerHTML = '<div class="skeleton skel-pill"></div>';
    });
    apiSwr('getMyStatus', { username: AppState.get('currentUser') }, {
      onData: res => {
        const status = (res && res.success && res.data) || { hasCheckedIn: false, hasCheckedOut: false, checkInTime: null, checkOutTime: null, location: '' };
        _markLoaded('s-emp-attendance');
        updateDashboardUI(status);
      }
    });
  }

  function updateDashboardUI(status) {
    const statusBadge = document.getElementById('statusBadge');
    const checkInBtn  = document.getElementById('checkInBtn');
    const checkOutBtn = document.getElementById('checkOutBtn');
    if (!statusBadge || !checkInBtn || !checkOutBtn) return;
    if (status.hasCheckedIn && !status.hasCheckedOut) {
      statusBadge.innerHTML = '<i class="fas fa-check-circle"></i> Checked In';
      statusBadge.className = 'ea-status-badge ea-status-in';
      checkInBtn.classList.add('hidden'); checkOutBtn.classList.remove('hidden'); checkOutBtn.disabled = false;
    } else if (status.hasCheckedIn && status.hasCheckedOut) {
      statusBadge.innerHTML = '<i class="fas fa-sign-out-alt"></i> Checked Out';
      statusBadge.className = 'ea-status-badge ea-status-out';
      checkOutBtn.classList.add('hidden'); checkInBtn.classList.remove('hidden');
      checkInBtn.disabled = true; checkInBtn.style.opacity = ''; checkInBtn.style.cursor = 'default';
      checkInBtn.className = 'ea-action-btn ea-action-btn-complete';
      checkInBtn.innerHTML = '<i class="fas fa-calendar-check"></i> Attendance Complete';
    } else {
      statusBadge.innerHTML = '<i class="fas fa-clock"></i> Not Checked In';
      statusBadge.className = 'ea-status-badge ea-status-none';
      checkInBtn.classList.remove('hidden'); checkInBtn.disabled = false;
      checkInBtn.style.opacity = ''; checkInBtn.style.cursor = '';
      checkInBtn.innerHTML = '<i class="fas fa-camera"></i> <span id="checkInText">Check In</span>';
      checkOutBtn.classList.add('hidden');
    }
    document.getElementById('checkInTime').textContent  = status.checkInTime  ? fmtLocalTime(status.checkInTime)  : '--:--';
    document.getElementById('checkOutTime').textContent = status.checkOutTime ? fmtLocalTime(status.checkOutTime) : '--:--';
    if (status.location) document.getElementById('currentLocation').textContent = status.location;
    const hoursEl = document.getElementById('todayHoursDisplay');
    if (hoursEl) {
      if (status.hasCheckedIn && !status.hasCheckedOut && status.checkInTime) {
        const diff = (Date.now() - new Date(status.checkInTime).getTime()) / 3600000;
        hoursEl.textContent = Math.max(0, diff).toFixed(1) + ' hrs';
      } else if (status.hasCheckedIn && status.checkInTime && status.checkOutTime) {
        const diff = (new Date(status.checkOutTime).getTime() - new Date(status.checkInTime).getTime()) / 3600000;
        hoursEl.textContent = Math.max(0, diff).toFixed(1) + ' hrs';
      } else { hoursEl.textContent = '0.0 hrs'; }
    }
  }

  function startLocationTracking() {
    if (navigator.geolocation) {
      const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
      const watchId = navigator.geolocation.watchPosition(updateLocationInfo, handleLocationError, options);
      AppState.set('locationWatchId', watchId);
      getCurrentLocation().then(location => {
        updateLocationInfo({ coords: { latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy } });
      });
    } else {
      document.getElementById('currentLocation').textContent = 'Geolocation is not supported by this browser.';
    }
  }

  function updateLocationInfo(position) {
    const { latitude, longitude, accuracy } = position.coords;
    AppState.set('userLocation', { lat: latitude, lng: longitude, accuracy });
    const locationElement = document.getElementById('currentLocation');
    locationElement.innerHTML = `<a href="https://maps.google.com/?q=${latitude},${longitude}" target="_blank" class="location-map-link"><i class="fas fa-external-link-alt me-1"></i>View on Map (${latitude.toFixed(6)}, ${longitude.toFixed(6)})</a>`;
    const accEl = document.getElementById('locationAccuracy');
    if (accuracy && accEl) {
      accEl.textContent = `Accuracy: ${Math.round(accuracy)} meters`;
      accEl.style.color = accuracy > 100 ? '#ef4444' : accuracy > 50 ? '#f59e0b' : '#10b981';
    }
    const map       = AppState.get('map');
    const userMarker = AppState.get('userMarker');
    if (map && userMarker) { userMarker.setLatLng([latitude, longitude]); }
    else if (map && !userMarker) { LiveMap.updateUserLocationOnMap(); }
  }

  function handleLocationError(error) {
    let message = '';
    switch(error.code) {
      case error.PERMISSION_DENIED:   message = 'Location access denied. Please enable location permissions.'; break;
      case error.POSITION_UNAVAILABLE: message = 'Location information unavailable.'; break;
      case error.TIMEOUT:             message = 'Location request timed out.'; break;
      default:                        message = 'An unknown location error occurred.'; break;
    }
    document.getElementById('currentLocation').textContent = message;
    document.getElementById('locationAccuracy').textContent = '';
  }

  function loadHistoryInline() { Employees.loadHistoryInline(); }

  function openLeaveRequestModal() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('fromDate').min = today;
    document.getElementById('toDate').min = today;
    const leaveModal = new bootstrap.Modal(document.getElementById('leaveRequestModal'));
    leaveModal.show();
  }

  function submitLeaveRequest() {
    const leaveType = document.getElementById('leaveType').value;
    const fromDate  = document.getElementById('fromDate').value;
    const toDate    = document.getElementById('toDate').value;
    const reason    = document.getElementById('leaveReason').value.trim();
    const ok = _validate([
      { id: 'leaveType',   label: 'Leave Type', rules: ['required'] },
      { id: 'fromDate',    label: 'From Date',  rules: ['required'] },
      { id: 'toDate',      label: 'To Date',    rules: ['required'] },
      { id: 'leaveReason', label: 'Reason',     rules: ['required'] },
      { id: 'toDate', check: () => fromDate && toDate && new Date(toDate) < new Date(fromDate) ? 'End date must be on or after the start date.' : null },
    ]);
    if (!ok) return;
    const currentUser   = AppState.get('currentUser');
    const currentUserId = AppState.get('currentUserId');
    if (_editingLeaveId) {
      const id = _editingLeaveId;
      showSpinner('Updating leave...');
      api('updateLeave', { id, type: leaveType, fromDate, toDate, reason, actorId: currentUserId, actorUsername: currentUser }).then(res => {
        hideSpinner();
        if (!res.success) { showPopup('error', 'Failed', res.message); return; }
        _editingLeaveId = null;
        document.getElementById('leaveRequestModalTitle').textContent = 'Request Leave';
        document.getElementById('submitLeaveBtn').innerHTML = 'Submit Request';
        const modal = bootstrap.Modal.getInstance(document.getElementById('leaveRequestModal'));
        if (modal) modal.hide();
        document.getElementById('leaveRequestForm').reset();
        showPopup('success', 'Updated', 'Leave application updated.').then(() => {
          LeaveView.loadLeaveApplications();
          Employees.loadLeaveRequests();
        });
      });
      return;
    }
    showSpinner('Submitting leave request...');
    api('submitLeave', { username: currentUser, type: leaveType, fromDate, toDate, reason }).then(res => {
      hideSpinner();
      if (res.success) {
        const modal = bootstrap.Modal.getInstance(document.getElementById('leaveRequestModal'));
        if (modal) modal.hide();
        document.getElementById('leaveRequestForm').reset();
        showPopup('success', 'Leave Request Submitted', 'Your leave request has been submitted for approval.').then(() => Employees.loadLeaveRequests());
      } else { showPopup('error', 'Failed', res.message || 'Could not submit leave'); }
    }).catch(err => { hideSpinner(); showPopup('error', 'Error', err.message || 'Network error'); });
  }

  // ─── Auto-sync ────────────────────────────────────────────────────────────
  const _noSyncSections = new Set(['s-settings', 's-profile', 's-payroll', 's-adm-rates']);

  function _userIsInteracting() {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (document.querySelector('.modal.show')) return true;
    if (typeof Dashboard !== 'undefined' && Dashboard.getDashEditMode && Dashboard.getDashEditMode()) return true;
    return false;
  }

  function startAutoSync() {
    const id = setInterval(syncData, 60000);
    AppState.set('syncInterval', id);
  }

  function stopAutoSync() {
    const syncInterval = AppState.get('syncInterval');
    if (syncInterval) { clearInterval(syncInterval); AppState.set('syncInterval', null); }
  }

  function syncData() {
    AppState.set('lastSyncTime', new Date().toISOString());
    refreshCurrentView();
  }

  function refreshCurrentView() {
    if (_userIsInteracting()) return;
    const active = document.querySelector('.app-section.active');
    if (active && !_noSyncSections.has(active.id)) Nav.refreshSection(active.id);
  }

  // ─── Clock ────────────────────────────────────────────────────────────────
  function updateClock() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const isoDate = now.toISOString().slice(0, 10);
    const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    set('isoClock',    `${timeStr} · ${dateStr}`);
    set('currentTime', now.toTimeString().slice(0, 8));
    set('currentDate', isoDate);
  }

  function initializeDateSelectors() {
    const now = new Date();
    const currentYear  = now.getFullYear();
    const currentMonth = now.getMonth();
    const yearSelect = document.getElementById('attendanceYear');
    if (yearSelect) {
      yearSelect.innerHTML = '';
      for (let i = currentYear - 2; i <= currentYear; i++) {
        const option = document.createElement('option');
        option.value = i; option.textContent = i;
        if (i === currentYear) option.selected = true;
        yearSelect.appendChild(option);
      }
    }
    const monthSelect = document.getElementById('attendanceMonth');
    if (monthSelect) monthSelect.value = currentMonth;
    const todayStr   = now.toISOString().slice(0, 10);
    const monthStart = new Date(currentYear, currentMonth, 1).toISOString().slice(0, 10);
    if (typeof flatpickr !== 'undefined') {
      const fromEl = document.getElementById('attDateFrom');
      const toEl   = document.getElementById('attDateTo');
      if (fromEl && fromEl._flatpickr) fromEl._flatpickr.destroy();
      if (toEl   && toEl._flatpickr)   toEl._flatpickr.destroy();
      _attFpFrom = flatpickr('#attDateFrom', {
        dateFormat: 'Y-m-d', maxDate: 'today', defaultDate: monthStart, allowInput: false, disableMobile: true,
        onChange: function(selectedDates, dateStr) {
          if (_attFpTo) _attFpTo.set('minDate', dateStr);
          if (_attFpTo && _attFpTo.selectedDates[0] && _attFpTo.selectedDates[0] < selectedDates[0]) _attFpTo.setDate(dateStr, false);
        }
      });
      _attFpTo = flatpickr('#attDateTo', { dateFormat: 'Y-m-d', maxDate: 'today', minDate: monthStart, defaultDate: todayStr, allowInput: false, disableMobile: true });
    }
  }

  function switchLanguage() { /* English only */ }

  function updateLanguageUI() {
    const t = translations.en;
    Object.keys(t).forEach(key => {
      const element = document.getElementById(key);
      if (element && element.dataset.i18n === key) element.textContent = t[key];
    });
  }

  // ─── setupEventListeners ──────────────────────────────────────────────────
  function setupEventListeners() {
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);

    // ── 2FA: verify panel ───────────────────────────────────────────────────
    _wireOtpRow('tfaOtpRow', () => {
      const code = _tfaOtpValue('tfaOtpRow');
      if (code.length === 6) _submitTfaCode(code);
    });
    document.getElementById('tfaSubmitBtn').addEventListener('click', () => {
      const code = _tfaOtpValue('tfaOtpRow');
      if (code.length === 6) _submitTfaCode(code);
      else {
        const errEl = document.getElementById('tfaErrorBanner');
        errEl.textContent = 'Please enter all 6 digits.';
        errEl.style.display = 'flex';
      }
    });
    document.getElementById('tfaBackupToggle').addEventListener('click', () => {
      const sec = document.getElementById('tfaBackupSection');
      sec.style.display = sec.style.display === 'none' ? '' : 'none';
      if (sec.style.display !== 'none') document.getElementById('tfaBackupCode').focus();
    });
    document.getElementById('tfaBackupSubmit').addEventListener('click', () => {
      const code = document.getElementById('tfaBackupCode').value.trim().toUpperCase().replace(/-/g, '');
      if (code.length < 6) {
        const errEl = document.getElementById('tfaErrorBanner');
        errEl.textContent = 'Please enter your backup code.';
        errEl.style.display = 'flex';
        return;
      }
      _submitTfaCode(code);
    });
    document.getElementById('tfaBackBtn').addEventListener('click', _showLoginPanel);

    // ── 2FA: setup panel ────────────────────────────────────────────────────
    document.getElementById('setupQrNextBtn').addEventListener('click', _showSetupConfirm);
    _wireOtpRow('setupOtpRow', () => {
      const code = _tfaOtpValue('setupOtpRow');
      if (code.length === 6) _submitSetupConfirm(code);
    });
    document.getElementById('setupConfirmBtn').addEventListener('click', () => {
      const code = _tfaOtpValue('setupOtpRow');
      if (code.length === 6) _submitSetupConfirm(code);
      else {
        const errEl = document.getElementById('setupErrorBanner');
        errEl.textContent = 'Please enter all 6 digits.';
        errEl.style.display = 'flex';
      }
    });

    // Employee Dashboard buttons
    document.addEventListener('click', function(event) {
      if (event.target.matches('#checkInBtn, #checkInBtn *'))       openCameraModal('CheckIn');
      else if (event.target.matches('#checkOutBtn, #checkOutBtn *')) openCameraModal('CheckOut');
      else if (event.target.matches('#viewHistoryBtn, #viewHistoryBtn *')) Nav.showSection('s-emp-history');
      else if (event.target.matches('#refreshHistoryBtn, #refreshHistoryBtn *')) { _spinBtn('refreshHistoryBtn'); loadHistoryInline(); }
      else if (event.target.matches('#requestLeaveBtn, #requestLeaveBtn *')) openLeaveRequestModal();
      else if (event.target.matches('#markAttendanceBtn, #markAttendanceBtn *')) LiveMap.markProjectAttendance();
    });

    // Camera modal buttons
    document.addEventListener('click', function(event) {
      if (event.target.matches('#captureBtn, #captureBtn *'))      capturePhoto();
      else if (event.target.matches('#retakeBtn, #retakeBtn *'))   retakePhoto();
      else if (event.target.matches('#confirmBtn, #confirmBtn *')) confirmAttendance();
    });

    document.getElementById('submitLeaveBtn').addEventListener('click', submitLeaveRequest);

    // Camera modal close
    document.getElementById('cameraModal').addEventListener('hidden.bs.modal', function () {
      stopCamera();
      AppState.set('capturedPhotoData',       null);
      AppState.set('currentLocationData',     null);
      AppState.set('currentAttendanceAction', null);
    });

    // Leave request modal reset on close
    document.getElementById('leaveRequestModal').addEventListener('hidden.bs.modal', function () {
      if (_editingLeaveId) {
        _editingLeaveId = null;
        document.getElementById('leaveRequestModalTitle').textContent = 'Request Leave';
        document.getElementById('submitLeaveBtn').innerHTML = 'Submit Request';
      }
    });

    // Admin buttons
    document.addEventListener('click', function(event) {
      if (event.target.matches('#addEmployeeBtn, #addEmployeeBtn *')) Employees.showAddEmployeeModal();
      else if (event.target.matches('#refreshEmployeesBtn, #refreshEmployeesBtn *')) { _spinBtn('refreshEmployeesBtn'); Employees.loadEmployeeList(); }
      else if (event.target.matches('#addDepartmentBtn, #addDepartmentBtn *')) Employees.showAddDepartmentModal();
      else if (event.target.matches('#refreshDepartmentsBtn, #refreshDepartmentsBtn *')) { _spinBtn('refreshDepartmentsBtn'); Employees.loadDepartments(); }
      else if (event.target.matches('#refreshAttendanceBtn, #refreshAttendanceBtn *')) { _spinBtn('refreshAttendanceBtn'); AttendanceView.loadAttendanceData(); }
      else if (event.target.matches('#refreshLeavesBtn, #refreshLeavesBtn *')) { _spinBtn('refreshLeavesBtn'); LeaveView.loadLeaveApplications(); }
      else if (event.target.matches('#addProjectBtn, #addProjectBtn *')) Sites.showAddProjectModal();
      else if (event.target.matches('#refreshProjectsBtn, #refreshProjectsBtn *')) {
        _spinBtn('refreshProjectsBtn');
        AppState.set('liveDataHash', '');
        LiveMap.loadLiveAttendance();
        Sites.loadProjectSites(false, true);
      }
      else if (event.target.matches('#s-adm-projects .lv-tab-btn')) {
        AppState.set('psSiteFilter', event.target.dataset.filter || 'all');
        document.querySelectorAll('#s-adm-projects .lv-tab-btn').forEach(t => t.classList.toggle('active', t.dataset.filter === (event.target.dataset.filter || 'all')));
        Sites.displayProjectSites(AppState.get('projectSites') || []);
      }
    });

    // Manager buttons
    document.addEventListener('click', function(event) {
      if (event.target.matches('#refreshDeptEmployeesBtn, #refreshDeptEmployeesBtn *')) { _spinBtn('refreshDeptEmployeesBtn'); Employees.loadDepartmentEmployees(); }
      else if (event.target.matches('#refreshManagerLeavesBtn, #refreshManagerLeavesBtn *')) { _spinBtn('refreshManagerLeavesBtn'); Employees.loadManagerLeaveApplications(); }
    });

    // Input filters
    document.addEventListener('input', function(event) {
      if (event.target.matches('#empSearchInput'))     Employees.displayEmployeeCards(null); // re-filter
      if (event.target.matches('#deptSearchInput'))    Employees.loadDepartments && Employees.loadDepartments();
      if (event.target.matches('#attSearchInput'))     AttendanceView.loadAttendanceData && window._renderAttTable && (_renderAttTable(), _renderAttConsistency && _renderAttConsistency());
      if (event.target.matches('#projectSearchInput')) Sites.displayProjectSites(AppState.get('projectSites') || []);
      if (event.target.matches('#leaveSearchInput'))   { AppState.set('lvAdmSearch', event.target.value); if (typeof _renderAdmLeaves === 'function') _renderAdmLeaves(); }
      if (event.target.matches('#empLeaveSearch'))     { if (typeof _renderEmpLeaves === 'function') _renderEmpLeaves(); }
      if (event.target.matches('#leaveTypeFilter'))    { AppState.set('lvAdmTypeFilter', event.target.value); if (typeof _renderAdmLeaves === 'function') _renderAdmLeaves(); }
      if (event.target.matches('#hrSearchInput'))      Payroll._hrSearch(event.target.value);
      if (event.target.matches('#prsMonthlySalary, #prsHourlyRate, #prsStdHours')) Payroll._prsRefreshEstimate();
    });

    // Change events
    document.addEventListener('change', function(event) {
      if (event.target.matches('#lmSiteSelect')) {
        const val = event.target.value;
        const siteLayerMap = AppState.get('siteLayerMap') || {};
        if (val) {
          const entry = siteLayerMap[val];
          LiveMap._selectLiveSite(val, entry ? entry.site.name : val);
          if (entry && entry.site) {
            const map = AppState.get('map');
            if (map) {
              const lat = Number(entry.site.latitude), lng = Number(entry.site.longitude), rad = Number(entry.site.radius) || 200;
              if (lat && lng) {
                const bounds = L.latLng(lat, lng).toBounds(rad * 4);
                map.fitBounds(bounds, { padding: [40, 40], animate: false });
                if (entry.marker) entry.marker.openPopup();
              }
            }
          }
        } else {
          LiveMap._clearLiveSite();
        }
      }
      if (event.target.matches('#attendanceMonth') || event.target.matches('#attendanceYear')) {
        if ((AppState.get('attFilterMode') || 'month') === 'month') AttendanceView.loadAttendanceData();
      }
      if (event.target.matches('#attDeptFilter'))     { if (typeof _renderAttTable === 'function') { _renderAttTable(); if (typeof _renderAttConsistency === 'function') _renderAttConsistency(); } }
      if (event.target.matches('#empRoleFilter') || event.target.matches('#empStatusFilter')) Employees.displayEmployeeCards(null);
      if (event.target.matches('#hrDeptFilter'))      Payroll._hrDept(event.target.value);
      if (event.target.matches('#hrRoleFilter'))      Payroll._hrRole(event.target.value);
      if (event.target.matches('#hrFileInput'))       { const f = event.target.files && event.target.files[0]; event.target.value = ''; if (f) Payroll._hrHandleFile(f); }
      if (event.target.matches('#prsNis, #prsHs, #prsTax')) Payroll._prsRefreshEstimate();
    });

    // Click delegation (large block)
    document.addEventListener('click', function(event) {
      // Attendance export
      if (event.target.matches('#exportAttendanceBtn, #exportAttendanceBtn *')) {
        const btn = document.querySelector('.dt-button.buttons-csv, .dt-button.buttons-excel');
        if (btn) btn.click(); else showPopup('info', 'Export', 'Use the DataTable export buttons to download.');
      }

      // Attendance mode toggle
      if (event.target.matches('.att-mode-btn')) {
        const mode = event.target.dataset.mode; if (!mode) return;
        AppState.set('attFilterMode', mode);
        document.querySelectorAll('.att-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
        document.getElementById('attMonthPickers').style.display = mode === 'month' ? '' : 'none';
        document.getElementById('attRangePickers').style.display = mode === 'range' ? '' : 'none';
        if (mode === 'month') {
          swr.clearByPrefix('listDailyLog:');
          for (const k of _swrLastHash.keys()) { if (k.startsWith('listDailyLog:')) _swrLastHash.delete(k); }
          AttendanceView.loadAttendanceData();
        }
      }

      // Date range apply
      if (event.target.matches('#attApplyRange, #attApplyRange *')) {
        const from = _attFpFrom && _attFpFrom.selectedDates[0] ? _attFpFrom.formatDate(_attFpFrom.selectedDates[0], 'Y-m-d') : '';
        if (!from) { showPopup('warning', 'Date Required', 'Please select a start date.'); return; }
        swr.clearByPrefix('listDailyLog:');
        for (const k of _swrLastHash.keys()) { if (k.startsWith('listDailyLog:')) _swrLastHash.delete(k); }
        AttendanceView.loadAttendanceData();
      }

      // Leave approve/reject
      if (event.target.closest('.btn-approve')) { const id = event.target.closest('.btn-approve').dataset.id; if (typeof approveLeave === 'function') approveLeave(id); }
      if (event.target.closest('.btn-reject'))  { const id = event.target.closest('.btn-reject').dataset.id;  if (typeof rejectLeave  === 'function') rejectLeave(id); }

      // Admin leave actions
      if (event.target.closest('.btn-view-leave'))   LeaveView.viewLeaveDoc(event.target.closest('.btn-view-leave').dataset.id, false);
      if (event.target.closest('.btn-print-leave'))  LeaveView.viewLeaveDoc(event.target.closest('.btn-print-leave').dataset.id, true);
      if (event.target.closest('.btn-edit-leave'))   { const id = event.target.closest('.btn-edit-leave').dataset.id; if (typeof openEditLeaveModal === 'function') openEditLeaveModal(id); }
      if (event.target.closest('.btn-delete-leave')) { const id = event.target.closest('.btn-delete-leave').dataset.id; if (typeof deleteLeaveRecord === 'function') deleteLeaveRecord(id); }

      // Employee card/table actions (delegate to embedded functions in Employees module)
      if (event.target.closest('.btn-edit-employee')) { const u = event.target.closest('.btn-edit-employee').dataset.username; if (typeof editEmployee === 'function') editEmployee(u); }
      else if (event.target.closest('.btn-delete-employee')) { const u = event.target.closest('.btn-delete-employee').dataset.username; if (typeof deleteEmployee === 'function') deleteEmployee(u); }
      else if (event.target.closest('.emp-card') && !event.target.closest('.emp-card-footer') && !event.target.closest('.card-overlay-actions')) {
        const card = event.target.closest('.emp-card'); if (card && card.dataset.id && typeof openEmpDrawer === 'function') openEmpDrawer(card.dataset.id);
      } else if (event.target.closest('#employeesTableBody tr') && !event.target.closest('.att-action-btn')) {
        const row = event.target.closest('#employeesTableBody tr'); if (row && row.dataset.username && typeof openEmpDrawer === 'function') openEmpDrawer(row.dataset.username);
      }

      // Emp drawer
      if (event.target.matches('#closeEmpDrawerBtn, #closeEmpDrawerBtn *') || (event.target.matches('#empProfileDrawer') && !event.target.closest('.emp-drawer'))) { if (typeof closeEmpDrawer === 'function') closeEmpDrawer(); }
      if (event.target.matches('#empDrawerEditBtn, #empDrawerEditBtn *')) { const u = document.getElementById('empProfileDrawer').dataset.username; if (typeof closeEmpDrawer === 'function') closeEmpDrawer(); if (u) setTimeout(() => editEmployee(u), 300); }
      if (event.target.matches('#empDrawerDeleteBtn, #empDrawerDeleteBtn *')) { const u = document.getElementById('empProfileDrawer').dataset.username; if (typeof closeEmpDrawer === 'function') closeEmpDrawer(); if (u) setTimeout(() => deleteEmployee(u), 300); }

      // Employee add/edit/save modals
      if (event.target.matches('#closeAddEmpModalBtn, #closeAddEmpModalBtn *') || event.target.matches('#cancelAddEmpBtn, #cancelAddEmpBtn *')) { if (typeof closeAddEmpModal === 'function') closeAddEmpModal(); }
      if (event.target.matches('#saveEmployeeBtn, #saveEmployeeBtn *'))   { if (typeof addEmployee    === 'function') addEmployee(); }
      if (event.target.matches('#closeEditEmpModalBtn, #closeEditEmpModalBtn *') || event.target.matches('#cancelEditEmpBtn, #cancelEditEmpBtn *')) { if (typeof closeEditEmpModal === 'function') closeEditEmpModal(); }
      if (event.target.matches('#updateEmployeeBtn, #updateEmployeeBtn *')) { if (typeof updateEmployee === 'function') updateEmployee(); }

      // View toggle
      if (event.target.matches('#empCardViewBtn, #empCardViewBtn *')) {
        document.getElementById('empCardView').style.display = '';
        document.getElementById('empTableView').style.display = 'none';
        document.getElementById('empCardViewBtn').classList.add('active');
        document.getElementById('empTableViewBtn').classList.remove('active');
        Employees.displayEmployeeCards(null);
      }
      if (event.target.matches('#empTableViewBtn, #empTableViewBtn *')) {
        document.getElementById('empCardView').style.display = 'none';
        document.getElementById('empTableView').style.display = '';
        document.getElementById('empTableViewBtn').classList.add('active');
        document.getElementById('empCardViewBtn').classList.remove('active');
        Employees.displayEmployeeCards(null);
      }

      // Dept card/list view
      if (event.target.matches('#deptCardViewBtn, #deptCardViewBtn *') || event.target.matches('#deptListViewBtn, #deptListViewBtn *')) {
        if (typeof _applyDeptView === 'function') _applyDeptView();
      }
      if (event.target.matches('#closeDeptModalBtn, #closeDeptModalBtn *') || event.target.matches('#cancelDeptModalBtn, #cancelDeptModalBtn *')) { if (typeof closeDeptModal === 'function') closeDeptModal(); }
      if (event.target.matches('#saveDepartmentBtn, #saveDepartmentBtn *')) { if (typeof addDepartment === 'function') addDepartment(); }

      // Dept actions
      if (event.target.closest('.btn-edit-department')) { const id = event.target.closest('.btn-edit-department').dataset.id; if (typeof editDepartment === 'function') editDepartment(id); }
      else if (event.target.closest('.btn-delete-department')) { const id = event.target.closest('.btn-delete-department').dataset.id; if (typeof deleteDepartment === 'function') deleteDepartment(id); }

      // Project site actions
      if (event.target.closest('.btn-edit-project'))   { const id = event.target.closest('.btn-edit-project').dataset.id;   if (typeof editProjectSite   === 'function') editProjectSite(id); }
      if (event.target.closest('.btn-delete-project')) { const id = event.target.closest('.btn-delete-project').dataset.id; if (typeof deleteProjectSite === 'function') deleteProjectSite(id); }
      const saveProjectBtn = event.target.matches('#saveProjectBtn, #saveProjectBtn *');
      if (saveProjectBtn) { if (typeof addProjectSite === 'function') addProjectSite(); }

      if (event.target.closest('.ps-card') && !event.target.closest('.ps-mini-map')) {
        const card = event.target.closest('.ps-card');
        if (card && !event.target.closest('.card-overlay-actions')) {
          const siteId = String(card.dataset.id);
          const projectSites = AppState.get('projectSites') || [];
          const site = projectSites.find(s => String(s.id) === siteId);
          if (site) {
            const prev = AppState.get('psSelectedSiteId');
            AppState.set('psSelectedSiteId', prev === siteId ? null : siteId);
            document.querySelectorAll('.ps-card').forEach(c => c.classList.toggle('ps-card--selected', String(c.dataset.id) === AppState.get('psSelectedSiteId')));
            if (typeof _updatePsSiteStats === 'function') _updatePsSiteStats(projectSites);
            if (site.isActive && typeof _showSitePopup === 'function') _showSitePopup(site);
          }
        }
      }

      // Attendance selfie + emp detail panel
      if (event.target.closest('.btn-view-att')) { const btn = event.target.closest('.btn-view-att'); if (typeof viewAttendancePhotos === 'function') viewAttendancePhotos(btn.dataset.in, btn.dataset.out, btn.dataset.name); }
      if (event.target.closest('.btn-view-emp-detail')) { const btn = event.target.closest('.btn-view-emp-detail'); if (typeof _openAttEmpPanel === 'function') _openAttEmpPanel(btn.dataset.username); }

      // Settings palette/layout
      const pCard = event.target.closest('.palette-card');
      if (pCard) Nav.savePalette(pCard.dataset.palette);
      const lCard = event.target.closest('.layout-card');
      if (lCard) Nav.saveLayout(lCard.dataset.layout);

      // Top tabs
      const tabBtn = event.target.closest('#topTabs button[data-section]');
      if (tabBtn) Nav.showSection(tabBtn.dataset.section);

      // Live map controls
      if (event.target.closest('#refreshLiveMapBtn')) { _spinBtn('refreshLiveMapBtn'); LiveMap.loadLiveAttendance(); }
      if (event.target.closest('#centerMapBtn')) {
        const map = AppState.get('map');
        const _activeEmpMarker = AppState.get('activeEmpMarker');
        const attendanceZones  = AppState.get('attendanceZones') || [];
        if (map) {
          if (_activeEmpMarker) map.setView(_activeEmpMarker.getLatLng(), 16, { animate: true });
          else if (attendanceZones.length) { try { map.fitBounds(L.featureGroup(attendanceZones).getBounds().pad(0.25)); } catch(_) {} }
          else map.setView([10.6549, -61.5019], 12);
        }
      }
      const liveCard = event.target.closest('.lm-emp-item') || event.target.closest('.live-emp-card');
      if (liveCard && event.target.closest('#s-projectMap')) LiveMap.focusLiveEmployee(String(liveCard.dataset.id || liveCard.dataset.userid || ''));

      // Hourly rates
      if (event.target.closest('#refreshRatesBtn'))   Payroll.loadHourlyRates();
      if (event.target.closest('#saveAllRatesBtn'))   Payroll._hrSaveAll();
      if (event.target.closest('#exportRatesCsvBtn')) Payroll._hrExportCsv();
      if (event.target.closest('#importRatesCsvBtn')) Payroll._hrOpenModal();
      if (event.target.closest('#hrCloseModalBtn') || event.target.closest('#hrCancelModalBtn')) Payroll._hrCloseModal();
      if (event.target.closest('#hrConfirmImportBtn')) Payroll._hrConfirmImport();
      if (event.target.closest('#hrFileDrop') || event.target.closest('#hrFileDrop label')) document.getElementById('hrFileInput')?.click();
      if (event.target.closest('#hrResetFiltersBtn')) { Payroll._hrSearch(''); Payroll._hrDept('all'); Payroll._hrRole('all'); const si = document.getElementById('hrSearchInput'); const df = document.getElementById('hrDeptFilter'); const rf = document.getElementById('hrRoleFilter'); if (si) si.value = ''; if (df) df.value = 'all'; if (rf) rf.value = 'all'; Payroll.renderHourlyRates(); }
      const saveBtn = event.target.closest('.btn-save-rate');
      if (saveBtn) Payroll.saveHourlyRate(saveBtn.dataset.username, saveBtn);

      // Payroll settings modal
      if (event.target.closest('#prsCloseBtn') || event.target.closest('#prsCancelBtn')) Payroll._prsClose();
      if (event.target.closest('#prsSaveBtn')) Payroll._prsSave();
      if (event.target.id === 'prSettingsModal') Payroll._prsClose();

      // Payroll constants modal
      if (event.target.closest('#prSettingsBtn')) Payroll._prcOpen();
      if (event.target.closest('#prcCloseBtn') || event.target.closest('#prcCancelBtn')) Payroll._prcClose();
      if (event.target.closest('#prcVerifyBtn')) Payroll._prcVerify();
      if (event.target.closest('#prcSaveBtn'))   Payroll._prcSave();
      if (event.target.closest('#prcRestoreBtn')) Payroll._prcRestoreDefaults();
      if (event.target.id === 'prConstantsModal') Payroll._prcClose();
      const prcTab = event.target.closest('.prc-tab');
      if (prcTab && prcTab.dataset.prcTab) {
        document.querySelectorAll('.prc-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.prc-panel').forEach(p => p.classList.remove('active'));
        prcTab.classList.add('active');
        const panel = document.getElementById('prc-' + prcTab.dataset.prcTab);
        if (panel) panel.classList.add('active');
      }

      // Pay cycle/basis pills
      const prsCyclePill = event.target.closest('#prsCycleGroup .prs-pill');
      if (prsCyclePill) { document.querySelectorAll('#prsCycleGroup .prs-pill').forEach(p => p.classList.remove('active')); prsCyclePill.classList.add('active'); document.getElementById('prsPayCycle').value = prsCyclePill.dataset.val; Payroll._prsRefreshEstimate(); }
      const prsBasisPill = event.target.closest('#prsBasisGroup .prs-pill');
      if (prsBasisPill) { document.querySelectorAll('#prsBasisGroup .prs-pill').forEach(p => p.classList.remove('active')); prsBasisPill.classList.add('active'); document.getElementById('prsPayBasis').value = prsBasisPill.dataset.val; Payroll._prsToggleRateRows(prsBasisPill.dataset.val); Payroll._prsRefreshEstimate(); }

      // Payroll filter panel toggle
      if (event.target.closest('#prFilterToggle')) { const toggle = document.getElementById('prFilterToggle'); const expand = document.getElementById('prFilterExpand'); if (toggle && expand) { const open = expand.classList.toggle('open'); toggle.classList.toggle('active', open); } }

      // Payroll mode + actions
      if (event.target.closest('#prReportBtn'))       Payroll._prToggleReportsMode();
      if (event.target.closest('#prApplyBtn'))        Payroll._prReportsMode ? Payroll._prRunReportsSearch() : Payroll._prRunPayroll();
      if (event.target.closest('#prSendApprovalBtn')) Payroll._prSendForApproval();
      const prPayslipBtn = event.target.closest('.pr-payslip-btn');
      if (prPayslipBtn) Payroll._prOpenPayslip(prPayslipBtn.dataset.uid);
      const prEditBtn = event.target.closest('.pr-edit-btn');
      if (prEditBtn) Payroll._prOpenEditPayroll(prEditBtn.dataset.uid);

      // Profile actions
      if (event.target.closest('#pickProfileImageBtn'))   { if (typeof pickProfileImage    === 'function') pickProfileImage(); }
      if (event.target.closest('#editAvatarBtn'))         { if (typeof pickProfileImage    === 'function') pickProfileImage(); }
      if (event.target.closest('#removeProfileImageBtn')) { if (typeof removeProfileImage  === 'function') removeProfileImage(); }
      if (event.target.closest('#saveProfileBtn'))        { if (typeof saveMyProfile       === 'function') saveMyProfile(); }
      if (event.target.closest('#updateSecurityBtn'))     { if (typeof _updateSecurityOnly === 'function') _updateSecurityOnly(); }
      if (event.target.closest('#uploadDocBtn'))          _profileToast('Document upload coming soon.', false);

      // Admin branding + payroll rules
      if (event.target.closest('#pickLogoBtn'))            { if (typeof pickLogo            === 'function') pickLogo(); }
      if (event.target.closest('#saveLogoBtn'))            { if (typeof saveLogo            === 'function') saveLogo(); }
      if (event.target.closest('#savePayrollSettingsBtn')) { if (typeof savePayrollSettings === 'function') savePayrollSettings(); }
      if (event.target.closest('#saveWorkHoursBtn'))       { if (typeof saveWorkHours       === 'function') saveWorkHours(); }

      // Leave tabs
      const lvTab = event.target.closest('.lv-tab-btn');
      if (lvTab) {
        const id = lvTab.dataset.lvTab;
        if (id) {
          const section = lvTab.closest('.app-section');
          section.querySelectorAll('.lv-tab-btn').forEach(b => b.classList.remove('active'));
          lvTab.classList.add('active');
          if (id.startsWith('emp-'))      { AppState.set('lvEmpTab', id);  if (typeof _renderEmpLeaves === 'function') _renderEmpLeaves(); }
          else if (id.startsWith('mgr-')) { AppState.set('lvMgrTab', id);  if (typeof _renderMgrLeaves === 'function') _renderMgrLeaves(); }
          else if (id.startsWith('adm-')) { AppState.set('lvAdmTab', id);  if (typeof _renderAdmLeaves === 'function') _renderAdmLeaves(); }
        }
      }

      // Settings nav
      const stgNav = event.target.closest('.stg-nav-item');
      if (stgNav && stgNav.dataset.stgTab) SettingsView._stgActivatePanel(stgNav.dataset.stgTab, true);

      // Profile tabs
      const epTab = event.target.closest('.ep-tab-btn');
      if (epTab) {
        document.querySelectorAll('.ep-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.ep-tab-pane').forEach(p => p.classList.remove('active'));
        epTab.classList.add('active');
        const pane = document.getElementById('ep-tab-' + epTab.dataset.epTab);
        if (pane) pane.classList.add('active');
      }

      // Settings save all / reset / clear cache
      if (event.target.closest('#saveAllSettingsBtn')) { if (typeof savePayrollSettings === 'function') savePayrollSettings(); }
      if (event.target.closest('#resetDefaultsBtn'))   { if (typeof _stgResetDefaults   === 'function') _stgResetDefaults(); }
      if (event.target.closest('#clearCacheBtn')) {
        if (typeof SwCacheManager !== 'undefined') SwCacheManager.clearAll();
        localStorage.clear();
        cpop.fire({ icon: 'success', title: 'Cache cleared', text: 'Page will reload.', showConfirmButton: true }).then(() => location.reload());
      }

      // hdrProfileBtn
      const hdrProfileBtn = document.getElementById('hdrProfileBtn');
      // (handled inline below via direct listener)
    });

    // Profile icon → profile section
    const hdrProfileBtn = document.getElementById('hdrProfileBtn');
    if (hdrProfileBtn) hdrProfileBtn.addEventListener('click', () => Nav.showSection('s-profile'));

    // Dashboard today date
    const _dashDate = document.getElementById('dashTodayDate');
    const _dashDay  = document.getElementById('dashTodayDay');
    if (_dashDate) {
      const _now = new Date();
      _dashDate.textContent = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(_now);
      if (_dashDay) _dashDay.textContent = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(_now);
    }

    // Dashboard theme toggle
    (function() {
      const btnLight = document.getElementById('dashThemeLight');
      const btnDark  = document.getElementById('dashThemeDark');
      if (!btnLight || !btnDark) return;
      function _applyTheme(t) {
        document.body.setAttribute('data-theme', t);
        btnLight.classList.toggle('active', t === 'light');
        btnDark.classList.toggle('active',  t === 'dark');
        localStorage.setItem('siomac-theme', t);
      }
      const saved = localStorage.getItem('siomac-theme') || 'light';
      _applyTheme(saved);
      btnLight.addEventListener('click', () => _applyTheme('light'));
      btnDark.addEventListener('click',  () => _applyTheme('dark'));
    })();

    document.getElementById('sidebarMenu').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-section]');
      if (btn) Nav.showSection(btn.dataset.section);
    });

    // File inputs for logo + profile photo
    document.addEventListener('change', function(event) {
      if (event.target.id === 'logoFileInput')     { if (typeof onLogoPicked         === 'function') onLogoPicked(event.target.files && event.target.files[0]); }
      if (event.target.id === 'profileImageInput') { if (typeof onProfileImagePicked === 'function') onProfileImagePicked(event.target.files && event.target.files[0]); }
    });

    // Rate inputs dirty + live stats
    document.addEventListener('input', function(event) {
      const inp = event.target.closest('.rate-input');
      if (!inp) return;
      inp.classList.toggle('dirty', String(inp.value) !== String(inp.dataset.original));
      if (typeof _ratesData !== 'undefined' && typeof Payroll.renderHourlyRates !== 'undefined') {
        const snapshot = _ratesData.map(r => {
          const liveInp = document.querySelector(`.rate-input[data-username="${CSS.escape(r.username)}"]`);
          const liveVal = liveInp ? parseFloat(liveInp.value) : NaN;
          return Object.assign({}, r, { hourlyRate: isNaN(liveVal) ? (r.hourlyRate || 0) : liveVal });
        });
        if (typeof _hrUpdateStats === 'function') _hrUpdateStats(snapshot);
      }
    });
  }

  // ─── init ─────────────────────────────────────────────────────────────────
  function init() {
    try {
      const savedPalette = localStorage.getItem('colorScheme');
      if (savedPalette) { currentColorScheme = savedPalette; Nav.applyPalette(savedPalette); }
      const savedLayout = localStorage.getItem('layoutMode');
      if (savedLayout)  { currentLayoutMode = savedLayout;   Nav.applyLayout(savedLayout); }
    } catch (_) {}

    try {
      const cached = loadSession();
      const branding = cached || JSON.parse(localStorage.getItem('siomac_branding') || 'null');
      if (branding && branding.companyName)   SettingsView.applyCompanyName(branding.companyName);
      if (branding && branding.companyLogoUrl) SettingsView.applyCompanyLogo(branding.companyLogoUrl);
      else SettingsView.applyCompanyLogo('');
    } catch (_) { SettingsView.applyCompanyLogo(''); }

    _rawApi('getSettings', {}).then(function(res) {
      const s = (res && res.data) || res || {};
      const logoUrl = s.companyLogoUrl || s.logoUrl || '';
      const name    = s.companyName || '';
      SettingsView.applyCompanyLogo(logoUrl);
      if (name) SettingsView.applyCompanyName(name);
      SettingsView.setCompanyInfo({ name, address: s.companyAddress || '', phone: s.companyPhone || '', email: s.companyEmail || '', nis: s.companyNIS || '', bir: s.companyBIR || '', logoUrl });
      const currentRole = AppState.get('currentRole');
      if (currentRole === 'admin' || currentRole === 'manager') {
        _rawApi('getPayrollConstants', {}).then(cr => {
          if (cr && cr.success && cr.data) {
            const d = cr.data;
            SettingsView.setStatutoryRates({ allowanceAnnual: d.PERSONAL_ALLOWANCE_ANNUAL || 90000, nisRate: Math.round((d.NIS_RATE || 0.06) * 100), payeRateLow: Math.round((d.PAYE_RATE_LOW || 0.25) * 100), payeRateHigh: Math.round((d.PAYE_RATE_HIGH || 0.30) * 100) });
          }
        }).catch(() => {});
      }
      try {
        const sess = loadSession();
        if (sess) updateStoredSession({ companyLogoUrl: logoUrl, companyName: name || sess.companyName });
        else localStorage.setItem('siomac_branding', JSON.stringify({ companyLogoUrl: logoUrl, companyName: name }));
      } catch (_) {}
    }).catch(function() {});

    setupEventListeners();
    Nav.setupSidebar();

    if (localStorage.getItem('rememberedUser')) {
      document.getElementById('username').value = localStorage.getItem('rememberedUser');
      document.getElementById('rememberMe').checked = true;
    }

    updateClock();
    setInterval(updateClock, 1000);
    initializeDateSelectors();
    updateLanguageUI();

    const sess = loadSession();
    if (sess) applySession(sess, /*announce*/ false);
  }

  // ─── updateRealTimeStats (no-op shim) ─────────────────────────────────────
  function updateRealTimeStats() { /* deprecated — live counts render via LiveMap.renderLivePanel */ }

  setInterval(updateRealTimeStats, 10000);
  updateRealTimeStats();

  return {
    init,
    goTo: function(sectionId) {
      const btn = document.querySelector(`.sidebar-menu button[data-section="${sectionId}"]`);
      if (btn) { btn.click(); return; }
      Nav.showSection(sectionId);
    },
    _buildPayslipHtml
  };
})();

// Expose payslip builder globally so payroll.js / employees.js can call it without module coupling
window._buildPayslipHtml = AttendanceSystem._buildPayslipHtml;

// Initialize after DOM is ready — warm IndexedDB SWR cache first for instant first renders
function _safeInit() {
  const doInit = () => {
    try { AttendanceSystem.init(); }
    catch(e) { console.error('AttendanceSystem.init() threw:', e); throw e; }
  };
  if (typeof SiomacDB !== 'undefined') {
    SiomacDB.warmSwr().then(doInit).catch(doInit);
  } else {
    doInit();
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _safeInit);
} else {
  _safeInit();
}
