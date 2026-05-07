// ─── Custom popup (replaces SweetAlert2) ──────────────────────
// Promise-based modal + toast + spinner. Compatible with the Swal.fire(opts) API.
const cpop = (function () {
  let ready = false, modal, iconEl, titleEl, textEl, progEl, progBar, okBtn, cancelBtn, toastsEl;
  let activeResolve = null, activeTimer = null, escHandler = null;

  const ICONS = {
    success:  '<circle cx="26" cy="26" r="22"/><path class="check" d="M14 27 l8 7 16-18" stroke-linecap="round" stroke-linejoin="round"/>',
    error:    '<circle cx="26" cy="26" r="22"/><path class="x1" d="M16 16 L36 36" stroke-linecap="round"/><path class="x2" d="M36 16 L16 36" stroke-linecap="round"/>',
    warning:  '<path d="M26 6 L46 42 L6 42 Z" stroke-linejoin="round"/><line x1="26" y1="20" x2="26" y2="32" stroke-linecap="round"/><circle cx="26" cy="38" r="2" fill="currentColor" stroke="none"/>',
    info:     '<circle cx="26" cy="26" r="22"/><circle cx="26" cy="16" r="1.5" fill="currentColor" stroke="none"/><line x1="26" y1="22" x2="26" y2="38" stroke-linecap="round"/>',
    question: '<circle cx="26" cy="26" r="22"/><path d="M20 20 a6 6 0 1 1 8 5 l-2 2 v3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="26" cy="38" r="2" fill="currentColor" stroke="none"/>'
  };

  function svg(icon) {
    return '<svg viewBox="0 0 52 52" xmlns="http://www.w3.org/2000/svg">' + (ICONS[icon] || ICONS.info) + '</svg>';
  }

  function ensureDOM() {
    if (ready) return;
    ready = true;
    modal = document.createElement('div');
    modal.className = 'cpop cpop-hidden';
    modal.innerHTML =
      '<div class="cpop-backdrop"></div>' +
      '<div class="cpop-box" role="dialog" aria-modal="true">' +
        '<div class="cpop-icon"></div>' +
        '<h2 class="cpop-title"></h2>' +
        '<div class="cpop-text"></div>' +
        '<div class="cpop-progress" style="display:none;"><span></span></div>' +
        '<div class="cpop-actions">' +
          '<button class="cpop-btn cpop-btn-cancel hidden" type="button">Cancel</button>' +
          '<button class="cpop-btn cpop-btn-ok" type="button">OK</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    iconEl = modal.querySelector('.cpop-icon');
    titleEl = modal.querySelector('.cpop-title');
    textEl = modal.querySelector('.cpop-text');
    progEl = modal.querySelector('.cpop-progress');
    progBar = progEl.querySelector('span');
    okBtn = modal.querySelector('.cpop-btn-ok');
    cancelBtn = modal.querySelector('.cpop-btn-cancel');
    okBtn.addEventListener('click', () => close(true));
    cancelBtn.addEventListener('click', () => close(false));
    modal.querySelector('.cpop-backdrop').addEventListener('click', () => {
      if (modal.dataset.dismiss !== 'false') close(false);
    });
    toastsEl = document.createElement('div');
    toastsEl.className = 'cpop-toasts';
    toastsEl.setAttribute('data-pos', 'top-end');
    document.body.appendChild(toastsEl);
  }

  function close(confirmed) {
    if (!ready || modal.classList.contains('cpop-hidden')) return;
    if (activeTimer)  { clearTimeout(activeTimer);  activeTimer = null; }
    if (escHandler)   { document.removeEventListener('keydown', escHandler); escHandler = null; }
    modal.classList.add('cpop-closing');
    const r = activeResolve; activeResolve = null;
    setTimeout(() => {
      modal.classList.add('cpop-hidden');
      modal.classList.remove('cpop-closing');
      if (r) r({ isConfirmed: !!confirmed, isDismissed: !confirmed, isDenied: false, value: !!confirmed });
    }, 180);
  }

  function fire(opts) {
    ensureDOM();
    opts = opts || {};
    if (opts.toast) return showToast(opts);

    if (opts.loading) {
      iconEl.className = 'cpop-icon';
      iconEl.innerHTML = '<div class="cpop-loading"></div>';
    } else {
      const icon = opts.icon || 'info';
      iconEl.className = 'cpop-icon cpop-icon-' + icon;
      iconEl.innerHTML = svg(icon);
    }

    titleEl.textContent = opts.title || '';
    if (opts.html) textEl.innerHTML = opts.html;
    else textEl.textContent = opts.text || '';

    const showCancel = opts.showCancelButton === true;
    const showConfirm = opts.showConfirmButton !== false && !opts.loading;
    okBtn.classList.toggle('hidden', !showConfirm);
    cancelBtn.classList.toggle('hidden', !showCancel);
    okBtn.innerHTML     = opts.confirmButtonText || 'OK';
    cancelBtn.innerHTML = opts.cancelButtonText  || 'Cancel';
    okBtn.classList.remove('cpop-btn-success', 'cpop-btn-danger', 'cpop-btn-warning');
    if      (opts.icon === 'warning' || opts.icon === 'error') okBtn.classList.add('cpop-btn-danger');
    else if (opts.icon === 'success')                          okBtn.classList.add('cpop-btn-success');

    if (opts.timer && opts.timerProgressBar) {
      progEl.style.display = 'block';
      progBar.style.transition = 'none';
      progBar.style.width = '100%';
      void progBar.offsetWidth;
      progBar.style.transition = 'width ' + opts.timer + 'ms linear';
      progBar.style.width = '0%';
    } else {
      progEl.style.display = 'none';
    }

    modal.dataset.dismiss = (opts.allowOutsideClick === false || opts.loading) ? 'false' : 'true';
    modal.classList.remove('cpop-hidden', 'cpop-closing');

    if (opts.timer) activeTimer = setTimeout(() => close(false), opts.timer);

    escHandler = (e) => {
      if (e.key === 'Escape' && modal.dataset.dismiss !== 'false') close(false);
      else if (e.key === 'Enter' && !okBtn.classList.contains('hidden') && !opts.loading) close(true);
    };
    document.addEventListener('keydown', escHandler);

    if (typeof opts.didOpen === 'function') setTimeout(() => { try { opts.didOpen(); } catch (_) {} }, 50);

    return new Promise(resolve => { activeResolve = resolve; });
  }

  function showToast(opts) {
    ensureDOM();
    const t = document.createElement('div');
    const icon = opts.icon || 'info';
    t.className = 'cpop-toast cpop-toast-' + icon;
    toastsEl.setAttribute('data-pos', opts.position || 'top-end');
    t.innerHTML =
      '<div class="cpop-toast-icon">' + svg(icon) + '</div>' +
      '<div class="cpop-toast-body">' +
        (opts.title ? '<div class="cpop-toast-title"></div>' : '') +
        (opts.text  ? '<div class="cpop-toast-text"></div>'  : '') +
      '</div>' +
      (opts.timerProgressBar ? '<div class="cpop-toast-bar"></div>' : '');
    if (opts.title) t.querySelector('.cpop-toast-title').textContent = opts.title;
    if (opts.text)  t.querySelector('.cpop-toast-text').textContent  = opts.text;
    toastsEl.appendChild(t);
    requestAnimationFrame(() => t.classList.add('cpop-toast-in'));

    const dur = opts.timer || 3000;
    if (opts.timerProgressBar) {
      const bar = t.querySelector('.cpop-toast-bar');
      if (bar) {
        bar.style.transition = 'width ' + dur + 'ms linear';
        requestAnimationFrame(() => { bar.style.width = '0%'; });
      }
    }
    setTimeout(() => {
      t.classList.add('cpop-toast-out');
      setTimeout(() => t.remove(), 300);
    }, dur);
    return Promise.resolve({ isConfirmed: false, isDismissed: true, isDenied: false });
  }

  function showLoading() {
    fire({ loading: true, allowOutsideClick: false, showConfirmButton: false });
  }

  return { fire, close: () => close(false), showLoading };
})();

// Drop-in shim: any existing Swal.fire / Swal.close / Swal.showLoading call routes to cpop
window.Swal = cpop;

// ─── Backend API ──────────────────────────────────────────
const API = '/api';

// text/plain content-type avoids CORS preflight that Apps Script can't answer
function getSessionToken() {
  try {
    const raw = localStorage.getItem('zkb_session_v1');
    return raw ? (JSON.parse(raw).token || '') : '';
  } catch (_) {
    return '';
  }
}

async function _rawApi(action, args = {}) {
  // 1) sanity-check the API URL before firing
  if (!API || /PASTE_YOUR_EXEC_URL_HERE/i.test(API)) {
    return { success: false, message: 'API URL not set. Open index.html, replace the API constant with your Apps Script /exec URL, save, redeploy.' };
  }
  if (false && !/^https:\/\/script\.google\.com\/.*\/exec$/.test(API)) {
    return { success: false, message: 'API URL is malformed. It must end with /exec — e.g. https://script.google.com/macros/s/<id>/exec' };
  }

  let r;
  try {
    r = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, args, token: getSessionToken() }),
      redirect: 'follow'
    });
  } catch (e) {
    console.error('api fetch fail', action, e);
    return { success: false, message: 'Network error: ' + (e.message || 'unreachable') + '. Check internet + API URL.' };
  }

  // 2) read as text first so we can show a meaningful error if it's HTML (login page, deploy issue)
  const text = await r.text().catch(() => '');
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('api parse fail', action, 'status:', r.status, 'preview:', String(text).slice(0, 200));
    const isHtml = /^\s*</.test(text);
    if (isHtml) {
      // Apps Script returned an HTML page — almost always a deployment / access issue
      return {
        success: false,
        message:
          'Apps Script returned an HTML page instead of JSON. Likely cause:\n\n' +
          '1. Web App access is NOT set to "Anyone". Fix: Apps Script → Deploy → Manage deployments → ✏️ pencil → Who has access: Anyone → Save.\n' +
          '2. Code.gs was edited but no NEW VERSION was published. Fix: Deploy → Manage deployments → ✏️ pencil → Version: New version → Save.\n' +
          '3. Wrong URL. The /exec URL must come from a deployed Web App, not the editor URL.\n\n' +
          'Tip: open the API URL directly in a private window — it should return JSON, not a Google login page.'
      };
    }
    return { success: false, message: 'Server returned non-JSON (HTTP ' + r.status + '): ' + String(text).slice(0, 140) };
  }
}

// Quick connection check — call from the browser console: pingApi()
async function pingApi() {
  const out = await _rawApi('ping', {});
  console.log('pingApi →', out);
  return out;
}
window.pingApi = pingApi;

// ─── SWR-style cache (stale-while-revalidate) ────────────────
// Read calls hit cache first, return instantly if fresh; if stale, serve stale + revalidate.
// Mutations bust the cache. In-flight requests are deduped. Optional revalidate-on-focus.
const swr = (function () {
  const cache    = new Map();  // key → { data, ts }
  const inflight = new Map();  // key → Promise
  const subs     = new Map();  // key → Set<callback>
  const DEFAULT_TTL = 60 * 1000;

  function get(key)            { return cache.get(key); }
  function set(key, data)      { cache.set(key, { data, ts: Date.now() }); fire(key, data); }
  function clear(key)          { if (key == null) cache.clear(); else cache.delete(key); }
  function clearByPrefix(pfx)  { for (const k of cache.keys()) if (k.indexOf(pfx) === 0) cache.delete(k); }
  function on(key, cb)         { if (!subs.has(key)) subs.set(key, new Set()); subs.get(key).add(cb); return () => subs.get(key) && subs.get(key).delete(cb); }
  function fire(key, data)     { if (subs.has(key)) subs.get(key).forEach(cb => { try { cb(data); } catch (_) {} }); }

  // SWR core: emit cache (if any) immediately, then fetch + emit fresh
  function fetch(key, fetcher, opts) {
    opts = opts || {};
    const ttl   = opts.ttl != null ? opts.ttl : DEFAULT_TTL;
    const force = !!opts.force;
    const cached = cache.get(key);
    const isFresh = cached && (Date.now() - cached.ts) < ttl;

    // 1) deliver cached synchronously-via-microtask if available
    if (cached && opts.onData) {
      Promise.resolve().then(() => { try { opts.onData(cached.data, /*isStale*/ !isFresh, /*fromCache*/ true); } catch (_) {} });
    }
    // fresh + not forced → no revalidation
    if (cached && isFresh && !force) return Promise.resolve(cached.data);

    // 2) dedupe in-flight
    if (inflight.has(key)) {
      const p = inflight.get(key);
      if (opts.onData) p.then(d => { try { opts.onData(d, false, false); } catch (_) {} });
      return p;
    }

    // 3) fetch + emit
    const p = fetcher().then(data => {
      cache.set(key, { data, ts: Date.now() });
      inflight.delete(key);
      if (opts.onData) { try { opts.onData(data, false, false); } catch (_) {} }
      fire(key, data);
      return data;
    }).catch(err => {
      inflight.delete(key);
      if (opts.onError) { try { opts.onError(err); } catch (_) {} }
      throw err;
    });
    inflight.set(key, p);
    return p;
  }

  // mutate(): write to cache directly (e.g. optimistic UI)
  function mutate(key, dataOrFetcher, revalidate) {
    if (typeof dataOrFetcher === 'function') return fetch(key, dataOrFetcher, { force: true });
    if (dataOrFetcher === undefined) return clear(key);
    cache.set(key, { data: dataOrFetcher, ts: Date.now() });
    fire(key, dataOrFetcher);
    if (revalidate) clear(key); // force refetch on next read
  }

  // revalidate-on-focus: when user returns to the tab, refetch any subscribed keys
  let _focusInstalled = false;
  function focusRevalidate(enable) {
    if (enable && !_focusInstalled) {
      _focusInstalled = true;
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        // bump ttl by clearing — next fetch will refetch
        // (only keys with active subscribers are worth revalidating; skip the rest)
        subs.forEach((set, key) => { if (set.size) cache.delete(key); });
      });
    }
  }

  return { get, set, clear, clearByPrefix, on, fetch, mutate, focusRevalidate, _cache: cache, _inflight: inflight };
})();

// last-served hash per key — skip re-render when fresh data == cached data (avoids flicker)
const _swrLastHash = new Map();

// SWR-aware api wrapper: cache + dedupe + emit to onData callback
function apiSwr(action, args, opts) {
  opts = opts || {};
  const key = opts.key || (action + ':' + JSON.stringify(args || {}));
  return swr.fetch(key, () => _rawApi(action, args), {
    ttl:   opts.ttl,
    force: opts.force,
    onData: function (data, isStale, fromCache) {
      // skip render if same payload as last delivered
      const hash = JSON.stringify(data);
      if (_swrLastHash.get(key) === hash) return;
      _swrLastHash.set(key, hash);
      if (opts.onData) opts.onData(data, isStale, fromCache);
    },
    onError: opts.onError
  });
}

// Mutations that should bust the read cache. Match by action prefix or exact name.
const SWR_MUTATIONS = /^(add|update|delete|bulk|upload|approve|reject|submit|setup|login|logout)/i;

// Wrap api() so successful mutations auto-invalidate the entire SWR cache.
// Reads (list*, get*) pass through unchanged.
async function api(action, args = {}) {
  const result = await _rawApi(action, args);
  if (result && result.success && SWR_MUTATIONS.test(action)) {
    swr.clear();           // wipe everything — next reads refetch
    _swrLastHash.clear();
  }
  return result;
}

swr.focusRevalidate(true); // re-pull data when user returns to tab

// Explicit "Refresh" buttons must bypass cache. Capture-phase wipes cache before
// the existing bubble-phase loaders run, so they always see a miss.
document.addEventListener('click', function (e) {
  const btn = e.target.closest && e.target.closest('[id^="refresh"]');
  if (btn) { swr.clear(); _swrLastHash.clear(); }
}, true);

// Attendance System Main Object
const AttendanceSystem = (function() {
  // Global variables
  let currentUser = null;
  let currentUserId = null;
  let currentFullName = null;
  let currentDeptId = null;
  let currentRole = null;
  // currentLanguage removed — app is English-only now
  let currentColorScheme = 'navy';
  let currentLayoutMode = 'sidebar';
  let cameraStream = null;
  let currentAttendanceAction = null;
  let capturedPhotoData = null;
  let currentLocationData = null;
  let locationWatchId = null;
  let departments = [];
  let employees = [];
  let lastSyncTime = null;
  let syncInterval = null;
  let dashboardRefreshInterval = null;
  let map = null;
  let userMarker = null;
  let attendanceZones = [];
  let projectSites = [];
  let userLocation = null;
  let attendanceChartInstance = null;
  let trendChartInstance = null;
  let liveMarkers = []; // leaflet markers for active employees on the live map
  let liveData    = []; // last-fetched live attendance rows (for sidebar panel + map sync)
  let _isSyncing = false; // when true, suppress skeleton injection (background refresh shouldn't flash)

  // ─── Session (1-hour timeout) ───
  // frontend-driven session: payload + expiresAt in localStorage. auto-restore on reload, auto-logout at expiry.
  const SESSION_KEY      = 'zkb_session_v1';
  const SESSION_DURATION = 60 * 60 * 1000; // 1 hour
  const SESSION_WARN_AT  = 5  * 60 * 1000; // warn 5 min before expiry
  let _sessExpTimer  = null; // auto-logout timer
  let _sessWarnTimer = null; // 5-min warning timer
  let _sessTickTimer = null; // 30s tick for sidebar countdown
  let _sessWarned    = false; // prevent duplicate warnings

  // Moro to Ranipur specific configuration
  const CONFIG = {
    PROJECT_AREA: {
      center: [26.6814598463, 68.0169318169],
      bounds: [
        [26.67, 68.00],
        [26.73, 68.06]
      ]
    },
    ATTENDANCE_ZONES: [
      { name: "Moro Starting Point", coords: [26.6814598463, 68.0169318169], radius: 150 },
      { name: "Section A - Bridge Construction", coords: [26.6885305450, 68.0231489403], radius: 200 },
      { name: "Section B - Road Work", coords: [26.6954443820, 68.0296018956], radius: 180 },
      { name: "Section C - Earthwork", coords: [26.7024535367, 68.0359368316], radius: 220 },
      { name: "Section D - Drainage", coords: [26.7094487711, 68.0422911191], radius: 160 },
      { name: "Section E - Pavement", coords: [26.7164584161, 68.0486261814], radius: 190 },
      { name: "Ranipur End Point", coords: [26.7234578251, 68.0549755997], radius: 150 }
    ],
    WORKING_HOURS: { start: 6, end: 22 },
    MAX_DISTANCE: 200
  };

  // Translation dictionary
  const translations = {
    en: {
      companyName: "Rameez Scripts",
      loginTitle: "Attendance System Login", loginSubtitle: "Access your dashboard",
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

  // Utility functions — all popups go through the custom cpop module (no SweetAlert2)
  const showSpinner = (msg) => cpop.fire({ loading: true, title: msg || 'Loading...', allowOutsideClick: false, showConfirmButton: false });
  const hideSpinner = () => cpop.close();
  const showPopup = (type, title, text) => cpop.fire({ icon: type, title, text, timer: 4000, timerProgressBar: true });

  // Get current location (simplified)
  const getCurrentLocation = () => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        // Default location for testing
        resolve({
          latitude: 26.6814598463,
          longitude: 68.0169318169,
          accuracy: 100,
          timestamp: new Date().toISOString(),
          address: 'Moro, Pakistan'
        });
        return;
      }

      const options = { 
        enableHighAccuracy: true, 
        timeout: 10000, 
        maximumAge: 0 
      };

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: new Date().toISOString()
          });
        },
        (error) => {
          // Fallback to default location
          resolve({
            latitude: 26.6814598463,
            longitude: 68.0169318169,
            accuracy: 500,
            timestamp: new Date().toISOString(),
            fallback: true,
            address: 'Moro, Pakistan'
          });
        },
        options
      );
    });
  };

  // Simple location check - always return true for testing
  const verifyLocation = (userLocation) => {
    // For testing, always verify location
    return {
      verified: true,
      distance: 50,
      nearestLocation: { name: "Test Location" },
      message: "Location verified successfully"
    };
  };

  // Map Functions
  function initializeMap() {
    try {
      const mapElement = document.getElementById('map');
      if (!mapElement) return;

      // Check if map already exists and remove it
      if (map && map._container) {
        map.remove();
        map = null;
      }

      map = L.map('map').setView(CONFIG.PROJECT_AREA.center, 13);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(map);

      map.setMaxBounds(CONFIG.PROJECT_AREA.bounds);
      
      // Draw project route
      const routeCoordinates = [
        [26.6814598463, 68.0169318169],
        [26.6841112323, 68.0193544282],
        [26.6869719621, 68.0221006435],
        [26.6898440363, 68.0245246711],
        [26.6926442352, 68.0270632216],
        [26.6954443820, 68.0296018956],
        [26.6982488508, 68.0321347155],
        [26.7010535807, 68.0346672441],
        [26.7038522565, 68.0372081289],
        [26.7066425513, 68.0397604354],
        [26.7094487711, 68.0422911191],
        [26.7122443471, 68.0448319262],
        [26.7150575661, 68.0473576609],
        [26.7178581819, 68.0498962095],
        [26.7206539461, 68.0524441672],
        [26.7234578251, 68.0549755997]
      ];

      const route = L.polyline(routeCoordinates, {
        color: '#e74c3c',
        weight: 6,
        opacity: 0.8,
        lineJoin: 'round'
      }).addTo(map);

      // Add attendance zones
      CONFIG.ATTENDANCE_ZONES.forEach(location => {
        const zone = L.circle(location.coords, {
          color: '#3498db',
          fillColor: '#2980b9',
          fillOpacity: 0.3,
          radius: location.radius
        }).addTo(map);
        
        zone.bindPopup(`
          <div style="text-align: center; padding: 10px;">
            <h4 style="margin: 0 0 10px 0; color: #2c3e50;">${location.name}</h4>
            <p style="margin: 5px 0;">📍 Attendance Zone</p>
            <p style="margin: 5px 0;">📏 Radius: ${location.radius}m</p>
          </div>
        `);
        attendanceZones.push(zone);
      });

      // Add markers
      L.marker(routeCoordinates[0]).addTo(map)
        .bindPopup(`<div style="text-align: center;"><h4>🚩 Moro Starting Point</h4><p>Project Start Location</p></div>`);
        
      L.marker(routeCoordinates[routeCoordinates.length - 1]).addTo(map)
        .bindPopup(`<div style="text-align: center;"><h4>🏁 Ranipur End Point</h4><p>Project End Location</p></div>`);

      if (userLocation) updateUserLocationOnMap();
      // re-plot live employee markers if we already have data (race-safe)
      if (liveData && liveData.length) plotLiveEmployees(liveData);
      console.log('Map initialized successfully');
    } catch (error) {
      console.error('Error initializing map:', error);
    }
  }

  function updateUserLocationOnMap() {
    if (!userLocation || !map) return;
    if (userMarker) map.removeLayer(userMarker);
    userMarker = L.marker([userLocation.lat, userLocation.lng], {
      icon: L.divIcon({
        className: 'user-location-marker',
        html: `<div style="background: #2ecc71; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);"></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      })
    }).addTo(map).bindPopup('Your current location').openPopup();
    map.setView([userLocation.lat, userLocation.lng], 13);
  }

  function showNotification(message, type) {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = `notification ${type} show`;
    setTimeout(() => notification.classList.remove('show'), 5000);
  }

  // ─── Live Project Map (admin/manager) ───
  function loadLiveAttendance() {
    if (!_isSyncing) setSkel('liveEmployeesList', skelList(3));
    const scope = currentRole === 'admin' ? 'all' : (currentDeptId || 'all');
    api('getLiveAttendance', { scope }).then(res => {
      liveData = (res.success && res.data) || [];
      plotLiveEmployees(liveData);
      renderLivePanel(liveData);
    });
  }

  function clearLiveMarkers_() {
    liveMarkers.forEach(m => { try { map.removeLayer(m); } catch (_) {} });
    liveMarkers = [];
  }

  function plotLiveEmployees(rows) {
    if (!map) return;
    clearLiveMarkers_();
    rows.forEach(row => {
      const lat = row.checkOutLat || row.checkInLat;
      const lng = row.checkOutLng || row.checkInLng;
      if (lat == null || lng == null) return;

      const color = row.isCheckedOut ? '#6c757d' : (row.status === 'late' ? '#fbbc04' : '#34a853');
      const initial = (row.fullName || '?').charAt(0).toUpperCase();
      const marker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: 'live-emp-marker',
          html: `<div style="background:${color}; width:32px; height:32px; border-radius:50%; border:3px solid white; box-shadow:0 2px 6px rgba(0,0,0,.35); display:flex; align-items:center; justify-content:center; color:white; font-weight:700; font-size:13px;">${initial}</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16]
        })
      }).addTo(map);

      const photo = row.checkOutPhotoUrl || row.checkInPhotoUrl;
      marker.bindPopup(`
        <div class="live-popup">
          ${photo ? `<img src="${photo}" onerror="this.style.display='none'">` : ''}
          <div class="name">${row.fullName}</div>
          <div class="row"><i class="fas fa-building" style="width:14px;"></i> ${row.department || '—'}</div>
          <div class="row"><i class="fas fa-sign-in-alt" style="width:14px;"></i> Check In: ${row.checkInTime || '—'}</div>
          <div class="row"><i class="fas fa-sign-out-alt" style="width:14px;"></i> Check Out: ${row.checkOutTime || '— still in'}</div>
          ${row.siteName ? `<div class="row"><i class="fas fa-map-marker-alt" style="width:14px;"></i> ${row.siteName}${row.distanceM != null ? ` · ${row.distanceM}m` : ''}</div>` : ''}
          <div class="row" style="margin-top:6px;"><span class="status-badge ${row.isCheckedOut ? 'inactive' : 'active'}">${row.isCheckedOut ? 'Checked Out' : (row.status === 'late' ? 'Late' : 'Checked In')}</span></div>
        </div>
      `);
      marker._liveUserId = row.userId; // for sidebar click → marker open
      liveMarkers.push(marker);
    });

    // fit map bounds to markers if any
    if (liveMarkers.length) {
      const group = L.featureGroup(liveMarkers);
      try { map.fitBounds(group.getBounds().pad(0.2)); } catch (_) {}
    }
  }

  function renderLivePanel(rows) {
    const checkedIn = rows.filter(r => !r.isCheckedOut).length;
    const late = rows.filter(r => r.status === 'late' && !r.isCheckedOut).length;
    const checkedOut = rows.filter(r => r.isCheckedOut).length;
    document.getElementById('liveActiveCount').textContent      = rows.length;
    document.getElementById('liveCheckedInCount').textContent   = checkedIn;
    document.getElementById('liveLateCount').textContent        = late;
    document.getElementById('liveCheckedOutCount').textContent  = checkedOut;

    const sorted = rows.slice().sort((a, b) => String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')));
    const html = sorted.map(r => {
      const cls = r.isCheckedOut ? 'out' : (r.status === 'late' ? 'late' : '');
      const initial = (r.fullName || '?').charAt(0).toUpperCase();
      const thumb = r.checkInPhotoUrl
        ? `<img class="live-emp-thumb" src="${r.checkInPhotoUrl}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'live-emp-thumb-fallback',textContent:'${initial}'}))">`
        : `<div class="live-emp-thumb-fallback">${initial}</div>`;
      return `<div class="live-emp-card ${cls}" data-userid="${r.userId}">
        ${thumb}
        <div class="live-emp-info">
          <div class="live-emp-name">${r.fullName}</div>
          <div class="live-emp-meta"><i class="fas fa-clock" style="width:11px;"></i> ${r.lastSeen || '—'} · ${r.department || ''}</div>
        </div>
      </div>`;
    }).join('');

    document.getElementById('liveEmployeesList').innerHTML = html ||
      '<div class="live-emp-empty"><i class="fas fa-users-slash" style="font-size:24px; color:#ccc; margin-bottom:8px;"></i><br>No check-ins yet today</div>';
  }

  function focusLiveEmployee(userId) {
    const marker = liveMarkers.find(m => m._liveUserId === userId);
    if (marker && map) {
      map.setView(marker.getLatLng(), 15);
      marker.openPopup();
    }
  }

  function markProjectAttendance() {
    const loc = userLocation ? { latitude: userLocation.lat, longitude: userLocation.lng, accuracy: userLocation.accuracy } : null;
    api('markAttendance', { username: currentUser, action: 'Project', photoBase64: '', location: loc }).then(res => {
      if (res.success) {
        showNotification('Project attendance marked successfully! ✅', 'success');
        checkStatus();
      } else {
        showNotification(res.message || 'Failed to mark attendance', 'error');
      }
      updateRealTimeStats();
    });
  }

  // ─── Session helpers (1-hour timeout) ───
  function saveSession(payload) {
    try {
      const data = Object.assign({}, payload, { expiresAt: Date.now() + SESSION_DURATION });
      localStorage.setItem(SESSION_KEY, JSON.stringify(data));
    } catch (_) {}
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !s.expiresAt || s.expiresAt < Date.now()) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
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
      handleSessionWarning(); // <5 min already — warn now
    }
    updateSessionWidget();
    _sessTickTimer = setInterval(updateSessionWidget, 30000);
  }

  function handleSessionWarning() {
    if (_sessWarned) return;
    _sessWarned = true;
    const t = { title: 'Session Expiring', text: 'Your session will end in 5 minutes. Save your work.' };
    if (typeof Swal !== 'undefined') {
      Swal.fire({ icon: 'warning', title: t.title, text: t.text, timer: 6000, timerProgressBar: true, toast: true, position: 'top-end', showConfirmButton: false });
    }
  }

  function handleSessionExpired() {
    const t = { title: 'Session Expired', text: 'Please log in again.' };
    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'info', title: t.title, text: t.text, timer: 2500, showConfirmButton: false });
    handleLogout();
  }

  // formats minutes/seconds left and updates the sidebar widget — called every 30s + on demand
  function updateSessionWidget() {
    const widget = document.getElementById('sessionTimer');
    if (!widget) return;
    const s = loadSession();
    if (!s) { widget.classList.add('hidden'); return; }
    widget.classList.remove('hidden');
    const msLeft = s.expiresAt - Date.now();
    if (msLeft <= 0) { handleSessionExpired(); return; }
    const mins = Math.floor(msLeft / 60000);
    const secs = Math.floor((msLeft % 60000) / 1000);
    const txt = mins >= 1 ? mins + 'm' : secs + 's';
    const danger = msLeft <= SESSION_WARN_AT;
    const txtEl = document.getElementById('sessionTimerText');
    if (txtEl) txtEl.textContent = txt;
    widget.classList.toggle('warn', danger);
  }

  // ─── Sidebar + section navigation ───
  // role → ordered list of sections shown in the sidebar
  const SECTION_DEFS = {
    employee: [
      { id: 's-emp-attendance', label: 'Attendance',    icon: 'fa-calendar-check' },
      { id: 's-emp-history',    label: 'My History',    icon: 'fa-history' },
      { id: 's-emp-leave',      label: 'My Leaves',     icon: 'fa-calendar-day' }
    ],
    manager: [
      { id: 's-mgr-overview',  label: 'Overview',        icon: 'fa-chart-pie' },
      { id: 's-mgr-employees', label: 'My Team',         icon: 'fa-users' },
      { id: 's-projectMap',    label: 'Live Map',        icon: 'fa-map-marked-alt' },
      { id: 's-mgr-leaves',    label: 'Leave Requests',  icon: 'fa-calendar-day' },
      { id: 's-payroll',       label: 'Payroll',         icon: 'fa-file-invoice-dollar' }
    ],
    admin: [
      { id: 's-adm-dashboard',   label: 'Dashboard',     icon: 'fa-tachometer-alt' },
      { id: 's-adm-employees',   label: 'Employees',     icon: 'fa-users' },
      { id: 's-adm-departments', label: 'Departments',   icon: 'fa-building' },
      { id: 's-adm-projects',    label: 'Project Sites', icon: 'fa-map-marker-alt' },
      { id: 's-projectMap',      label: 'Live Map',      icon: 'fa-map-marked-alt' },
      { id: 's-adm-attendance',  label: 'Attendance',    icon: 'fa-calendar-check' },
      { id: 's-adm-leaves',      label: 'Leaves',        icon: 'fa-calendar-day' },
      { id: 's-adm-rates',       label: 'Hourly Rates',  icon: 'fa-money-bill-wave' },
      { id: 's-payroll',         label: 'Payroll',       icon: 'fa-file-invoice-dollar' }
    ]
  };
  // shared items appended to every role's sidebar (Profile + Settings + About)
  const COMMON_ITEMS = [
    { id: 's-profile',  label: 'My Profile', icon: 'fa-user-circle' },
    { id: 's-settings', label: 'Settings',   icon: 'fa-palette' },
    { id: 's-about',    label: 'About',      icon: 'fa-info-circle' }
  ];
  // backward compat for handleLoginSuccess default-section lookup
  const ABOUT_ITEM = COMMON_ITEMS[1];

  function allSectionItems() {
    return [].concat(...Object.values(SECTION_DEFS), COMMON_ITEMS);
  }

  function buildSidebar(role) {
    const main   = SECTION_DEFS[role] || [];
    const common = COMMON_ITEMS;
    const renderItem = it => `
      <li><button data-section="${it.id}" title="${it.label}">
        <i class="fas ${it.icon}"></i><span>${it.label}</span>
      </button></li>`;
    const html = main.map(renderItem).join('')
               + (main.length ? '<li class="sidebar-menu-divider" aria-hidden="true"></li>' : '')
               + common.map(renderItem).join('');
    document.getElementById('sidebarMenu').innerHTML = html;
  }

  // ─── Color palettes (CSS-variable overrides applied to :root) ───
  const PALETTES = [
    { id: 'navy',    name: 'Navy Blue',    primary: '#001f3f', dark: '#001529', light: '#003366', accent: '#0074D9', hover: '#002a52' },
    { id: 'royal',   name: 'Royal Purple', primary: '#3a0ca3', dark: '#22075a', light: '#5b21b6', accent: '#7209b7', hover: '#2d0880' },
    { id: 'forest',  name: 'Forest Green', primary: '#1a4d2e', dark: '#0d2e1a', light: '#2d6a4f', accent: '#52b788', hover: '#143d24' },
    { id: 'sunset',  name: 'Sunset Orange',primary: '#bf3a00', dark: '#7d2500', light: '#e85d04', accent: '#ff7e30', hover: '#992e00' },
    { id: 'crimson', name: 'Crimson Red',  primary: '#7d0000', dark: '#4d0000', light: '#a30000', accent: '#d40000', hover: '#5a0000' },
    { id: 'slate',   name: 'Slate Dark',   primary: '#1f2937', dark: '#111827', light: '#374151', accent: '#6b7280', hover: '#0f172a' },
    { id: 'ocean',   name: 'Ocean Teal',   primary: '#003049', dark: '#001d2e', light: '#005f73', accent: '#00afb9', hover: '#002337' },
    { id: 'rose',    name: 'Rose Pink',    primary: '#7d2c5c', dark: '#4d1837', light: '#a83a72', accent: '#e91e63', hover: '#5e1f44' }
  ];

  function applyPalette(id) {
    const p = PALETTES.find(x => x.id === id) || PALETTES[0];
    const root = document.documentElement.style;
    root.setProperty('--navy-primary', p.primary);
    root.setProperty('--navy-dark',    p.dark);
    root.setProperty('--navy-light',   p.light);
    root.setProperty('--navy-accent',  p.accent);
    root.setProperty('--navy-hover',   p.hover);
    try { localStorage.setItem('colorScheme', p.id); } catch (_) {}
  }

  function renderPalettes() {
    const current = (currentColorScheme || 'navy');
    const html = PALETTES.map(p => `
      <div class="palette-card ${p.id === current ? 'active' : ''}" data-palette="${p.id}">
        <div class="palette-name">${p.name}</div>
        <div class="palette-swatches">
          <div class="palette-swatch" style="background:${p.primary};"></div>
          <div class="palette-swatch" style="background:${p.dark};"></div>
          <div class="palette-swatch" style="background:${p.light};"></div>
          <div class="palette-swatch" style="background:${p.accent};"></div>
          <div class="palette-swatch" style="background:${p.hover};"></div>
        </div>
        <div class="palette-preview" style="background: linear-gradient(135deg, ${p.primary} 0%, ${p.accent} 100%);"></div>
      </div>`).join('');
    document.getElementById('paletteGrid').innerHTML = html;
  }

  // ─── Layout modes ───
  const LAYOUTS = [
    { id: 'sidebar', name: 'Sidebar',  desc: 'Vertical menu on left',   icon: 'fa-bars' },
    { id: 'tabs',    name: 'Top Tabs', desc: 'Horizontal tabs on top',  icon: 'fa-grip-lines' }
  ];

  function applyLayout(mode) {
    const valid = LAYOUTS.find(l => l.id === mode) ? mode : 'sidebar';
    document.body.classList.remove('layout-sidebar', 'layout-tabs');
    document.body.classList.add('layout-' + valid);
    try { localStorage.setItem('layoutMode', valid); } catch (_) {}
    // refresh top-tab content if we just flipped to tabs after login
    if (valid === 'tabs' && currentRole) buildTopTabs(currentRole);
  }

  function buildTopTabs(role) {
    const items = (SECTION_DEFS[role] || []).concat(COMMON_ITEMS);
    document.getElementById('topTabs').innerHTML = items.map(it => `
      <button data-section="${it.id}" title="${it.label}">
        <i class="fas ${it.icon}"></i><span>${it.label}</span>
      </button>`).join('');
  }

  function renderLayouts() {
    const html = LAYOUTS.map(l => `
      <div class="layout-card ${l.id === currentLayoutMode ? 'active' : ''}" data-layout="${l.id}">
        <div class="layout-icon"><i class="fas ${l.icon}"></i></div>
        <div class="layout-name">${l.name}</div>
        <div class="layout-desc">${l.desc}</div>
      </div>`).join('');
    document.getElementById('layoutGrid').innerHTML = html;
  }

  function saveLayout(mode) {
    if (mode === currentLayoutMode) return;
    const prev = currentLayoutMode;
    currentLayoutMode = mode;
    applyLayout(mode);
    renderLayouts();
    api('updateLayoutMode', { username: currentUser, mode }).then(res => {
      if (!res.success) {
        currentLayoutMode = prev;
        applyLayout(prev);
        renderLayouts();
        showPopup('error', 'Failed to save', res.message || 'Could not switch layout');
      } else {
        showPopup('success', 'Layout Saved', `${(LAYOUTS.find(l => l.id === mode) || {}).name} layout active.`);
      }
    });
  }

  function savePalette(id) {
    const prev = currentColorScheme;
    currentColorScheme = id;
    applyPalette(id);                      // optimistic local apply
    renderPalettes();                      // refresh checkmarks
    // re-render any open charts so their hardcoded color choices follow the new palette
    if (document.getElementById('s-adm-dashboard') && document.getElementById('s-adm-dashboard').classList.contains('active')) loadDashboardCharts();
    if (attendanceChartInstance) loadChart();
    if (trendChartInstance) loadTrendChart();
    api('updateColorScheme', { username: currentUser, scheme: id }).then(res => {
      if (!res.success) {
        currentColorScheme = prev;
        applyPalette(prev);
        renderPalettes();
        showPopup('error', 'Failed to save', res.message || 'Could not persist theme');
      } else {
        showPopup('success', 'Theme Saved', `${(PALETTES.find(p => p.id === id) || {}).name} applied.`);
      }
    });
  }

  // ─── Skeleton helpers (skip during background sync) ───
  function setSkel(id, html) {
    if (_isSyncing) return;
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }
  function skelStatValues(ids) {
    if (_isSyncing) return;
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<div class="skeleton skel-text-lg" style="width:60px; margin:0 auto;"></div>';
    });
  }
  function skelTableRows(cols, rows) {
    let html = '';
    for (let r = 0; r < rows; r++) {
      html += '<tr>';
      for (let c = 0; c < cols; c++) html += `<td><div class="skeleton skel-text" style="width:${50 + Math.floor(Math.random() * 40)}%;"></div></td>`;
      html += '</tr>';
    }
    return html;
  }
  function skelStatCards(n) {
    let html = '';
    for (let i = 0; i < n; i++) html += `<div class="skel-stat-card"><div class="skeleton skel-icon"></div><div class="skeleton skel-text-lg" style="width:50%;"></div><div class="skeleton skel-text" style="width:75%;"></div></div>`;
    return html;
  }
  function skelCards(n) {
    let html = '';
    for (let i = 0; i < n; i++) html += `<div class="skel-card"><div class="skeleton skel-text-lg" style="width:55%;"></div><div class="skeleton skel-text" style="width:90%;"></div><div class="skeleton skel-text" style="width:65%;"></div><div class="skeleton skel-text" style="width:80%;"></div></div>`;
    return html;
  }
  function skelList(n) {
    let html = '';
    for (let i = 0; i < n; i++) html += `<div class="leave-request-item"><div class="skeleton skel-text" style="width:25%;"></div><div class="skeleton skel-text" style="width:55%; margin-top:8px;"></div><div class="skeleton skel-text-sm" style="width:75%; margin-top:6px;"></div></div>`;
    return html;
  }

  function showSection(id) {
    document.querySelectorAll('.app-section').forEach(s => s.classList.remove('active'));
    const sec = document.getElementById(id);
    if (sec) sec.classList.add('active');
    document.querySelectorAll('.sidebar-menu button').forEach(b => b.classList.toggle('active', b.dataset.section === id));
    document.querySelectorAll('#topTabs button').forEach(b => b.classList.toggle('active', b.dataset.section === id));

    // page header title
    const item = allSectionItems().find(x => x.id === id);
    if (item) {
      document.getElementById('pageTitleIcon').className = 'fas ' + item.icon;
      document.getElementById('pageTitleText').textContent = item.label;
    }

    // close mobile drawer + backdrop after click
    document.getElementById('sidebar').classList.remove('mobile-open');
    document.getElementById('sidebarBackdrop').classList.remove('active');

    refreshSection(id);
  }

  function refreshSection(id) {
    switch (id) {
      case 's-settings':        renderPalettes(); renderLayouts(); loadAdminBrandingSettings(); break;
      case 's-profile':         loadMyProfile(); break;
      case 's-emp-attendance':  checkStatus(); loadChart(); loadTrendChart(); break;
      case 's-emp-history':     loadHistoryInline(); break;
      case 's-projectMap':      setTimeout(initializeMap, 80); loadLiveAttendance(); break;
      case 's-emp-leave':       loadLeaveRequests(); break;
      case 's-mgr-overview':    loadDepartmentData(); break;
      case 's-mgr-employees':   loadDepartmentEmployees(); break;
      case 's-mgr-leaves':      loadManagerLeaveApplications(); break;
      case 's-adm-dashboard':   loadDashboardData(); loadDashboardCharts(); break;
      case 's-adm-employees':   loadEmployeeList(); break;
      case 's-adm-departments': loadDepartments(); break;
      case 's-adm-projects':    loadProjectSites(); break;
      case 's-adm-attendance':  loadAttendanceData(); break;
      case 's-adm-leaves':      loadLeaveApplications(); break;
      case 's-adm-rates':       loadHourlyRates(); break;
      case 's-payroll':         initPayrollSection(); break;
    }
  }

  function setupSidebar() {
    const sidebar   = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebarToggleBtn');
    const toggleIcon = document.getElementById('sidebarToggleIcon');

    // restore collapsed state from localStorage
    if (localStorage.getItem('sb_collapsed') === '1') {
      sidebar.classList.add('collapsed');
      toggleIcon.className = 'fas fa-chevron-right';
    }

    toggleBtn.addEventListener('click', () => {
      const collapsed = sidebar.classList.toggle('collapsed');
      toggleIcon.className = 'fas fa-chevron-' + (collapsed ? 'right' : 'left');
      localStorage.setItem('sb_collapsed', collapsed ? '1' : '0');
      updateSessionWidget(); // repaint the timer for the new layout
    });

    const backdrop = document.getElementById('sidebarBackdrop');
    const setMobileOpen = (open) => {
      sidebar.classList.toggle('mobile-open', open);
      backdrop.classList.toggle('active', open);
    };

    document.getElementById('mobileMenuBtn').addEventListener('click', () => {
      setMobileOpen(!sidebar.classList.contains('mobile-open'));
    });
    backdrop.addEventListener('click', () => setMobileOpen(false));

    document.getElementById('sidebarMenu').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-section]');
      if (btn) {
        showSection(btn.dataset.section);
        setMobileOpen(false); // close drawer on selection
      }
    });
  }

  // Initialize the application
  function init() {
    // restore prefs from last session before any UI paints
    try {
      const savedPalette = localStorage.getItem('colorScheme');
      if (savedPalette) { currentColorScheme = savedPalette; applyPalette(savedPalette); }
      const savedLayout = localStorage.getItem('layoutMode');
      if (savedLayout) { currentLayoutMode = savedLayout; applyLayout(savedLayout); }
    } catch (_) {}

    // Set up event listeners
    setupEventListeners();
    setupSidebar();

    // Check for remembered user
    if (localStorage.getItem('rememberedUser')) {
      document.getElementById('username').value = localStorage.getItem('rememberedUser');
      document.getElementById('rememberMe').checked = true;
    }

    // Initialize
    updateClock();
    setInterval(updateClock, 1000);
    initializeDateSelectors();
    updateLanguageUI();

    // 1-hour session auto-restore — if a valid session exists, skip login
    const sess = loadSession();
    if (sess) applySession(sess, /*announce*/ false);
  }

  function setupEventListeners() {
    // Login form
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    // language switch removed — English only now
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);
    
    // Employee Dashboard buttons using event delegation
    document.addEventListener('click', function(event) {
      if (event.target.matches('#checkInBtn, #checkInBtn *')) {
        openCameraModal('CheckIn');
      } else if (event.target.matches('#checkOutBtn, #checkOutBtn *')) {
        openCameraModal('CheckOut');
      } else if (event.target.matches('#viewHistoryBtn, #viewHistoryBtn *')) {
        viewHistory();
      } else if (event.target.matches('#refreshHistoryBtn, #refreshHistoryBtn *')) {
        loadHistoryInline();
      } else if (event.target.matches('#requestLeaveBtn, #requestLeaveBtn *')) {
        openLeaveRequestModal();
      } else if (event.target.matches('#markAttendanceBtn, #markAttendanceBtn *')) {
        markProjectAttendance();
      }
    });
    
    // Camera modal buttons using event delegation
    document.addEventListener('click', function(event) {
      if (event.target.matches('#captureBtn, #captureBtn *')) {
        capturePhoto();
      } else if (event.target.matches('#retakeBtn, #retakeBtn *')) {
        retakePhoto();
      } else if (event.target.matches('#confirmBtn, #confirmBtn *')) {
        confirmAttendance();
      }
    });
    
    // Leave request modal
    document.getElementById('submitLeaveBtn').addEventListener('click', submitLeaveRequest);
    
    // Admin buttons using event delegation
    document.addEventListener('click', function(event) {
      if (event.target.matches('#addEmployeeBtn, #addEmployeeBtn *')) {
        showAddEmployeeModal();
      } else if (event.target.matches('#refreshEmployeesBtn, #refreshEmployeesBtn *')) {
        loadEmployeeList();
      } else if (event.target.matches('#addDepartmentBtn, #addDepartmentBtn *')) {
        showAddDepartmentModal();
      } else if (event.target.matches('#refreshDepartmentsBtn, #refreshDepartmentsBtn *')) {
        loadDepartments();
      } else if (event.target.matches('#refreshAttendanceBtn, #refreshAttendanceBtn *')) {
        loadAttendanceData();
      } else if (event.target.matches('#refreshLeavesBtn, #refreshLeavesBtn *')) {
        loadLeaveApplications();
      } else if (event.target.matches('#addProjectBtn, #addProjectBtn *')) {
        showAddProjectModal();
      } else if (event.target.matches('#refreshProjectsBtn, #refreshProjectsBtn *')) {
        loadProjectSites();
      }
    });
    
    // Manager buttons using event delegation
    document.addEventListener('click', function(event) {
      if (event.target.matches('#refreshDeptEmployeesBtn, #refreshDeptEmployeesBtn *')) {
        loadDepartmentEmployees();
      } else if (event.target.matches('#refreshManagerLeavesBtn, #refreshManagerLeavesBtn *')) {
        loadManagerLeaveApplications();
      }
    });
    
    // Modal save buttons using event delegation
    document.addEventListener('click', function(event) {
      if (event.target.matches('#saveEmployeeBtn, #saveEmployeeBtn *')) {
        addEmployee();
      } else if (event.target.matches('#saveDepartmentBtn, #saveDepartmentBtn *')) {
        addDepartment();
      } else if (event.target.matches('#updateEmployeeBtn, #updateEmployeeBtn *')) {
        updateEmployee();
      } else if (event.target.matches('#saveProjectBtn, #saveProjectBtn *')) {
        addProjectSite();
      }
    });
    
    // login-screen language switch

    // Camera modal close
    document.getElementById('cameraModal').addEventListener('hidden.bs.modal', function () {
      stopCamera();
      capturedPhotoData = null;
      currentLocationData = null;
      currentAttendanceAction = null;
    });

    // Reset leave-request modal back to "create" mode whenever it closes
    document.getElementById('leaveRequestModal').addEventListener('hidden.bs.modal', function () {
      if (_editingLeaveId) {
        _editingLeaveId = null;
        document.getElementById('leaveRequestModalTitle').textContent = 'Request Leave';
        document.getElementById('submitLeaveBtn').innerHTML = 'Submit Request';
      }
    });
    
    // Event delegation for dynamic buttons
    document.addEventListener('click', function(event) {
      // Manager leave approval
      if (event.target.closest('.btn-approve')) {
        const leaveId = event.target.closest('.btn-approve').dataset.id;
        approveLeave(leaveId);
      } else if (event.target.closest('.btn-reject')) {
        const leaveId = event.target.closest('.btn-reject').dataset.id;
        rejectLeave(leaveId);
      }

      // Admin leave actions: view / print / edit / delete
      if (event.target.closest('.btn-view-leave'))   viewLeaveDoc(event.target.closest('.btn-view-leave').dataset.id, false);
      if (event.target.closest('.btn-print-leave')) viewLeaveDoc(event.target.closest('.btn-print-leave').dataset.id, true);
      if (event.target.closest('.btn-edit-leave'))   openEditLeaveModal(event.target.closest('.btn-edit-leave').dataset.id);
      if (event.target.closest('.btn-delete-leave')) deleteLeaveRecord(event.target.closest('.btn-delete-leave').dataset.id);
      
      // Admin employee actions
      if (event.target.closest('.btn-edit-employee')) {
        const username = event.target.closest('.btn-edit-employee').dataset.username;
        editEmployee(username);
      } else if (event.target.closest('.btn-delete-employee')) {
        const username = event.target.closest('.btn-delete-employee').dataset.username;
        deleteEmployee(username);
      }
      
      // Admin department actions
      if (event.target.closest('.btn-edit-department')) {
        const deptId = event.target.closest('.btn-edit-department').dataset.id;
        editDepartment(deptId);
      } else if (event.target.closest('.btn-delete-department')) {
        const deptId = event.target.closest('.btn-delete-department').dataset.id;
        deleteDepartment(deptId);
      }
      
      // Admin project site actions
      if (event.target.closest('.btn-edit-project')) {
        const projectId = event.target.closest('.btn-edit-project').dataset.id;
        editProjectSite(projectId);
      } else if (event.target.closest('.btn-delete-project')) {
        const projectId = event.target.closest('.btn-delete-project').dataset.id;
        deleteProjectSite(projectId);
      }

      // Admin attendance — view selfies
      if (event.target.closest('.btn-view-att')) {
        const btn = event.target.closest('.btn-view-att');
        viewAttendancePhotos(btn.dataset.in, btn.dataset.out, btn.dataset.name);
      }

      // Settings — palette card click
      const pCard = event.target.closest('.palette-card');
      if (pCard) savePalette(pCard.dataset.palette);

      // Settings — layout card click
      const lCard = event.target.closest('.layout-card');
      if (lCard) saveLayout(lCard.dataset.layout);

      // Top tabs — same data-section pattern as sidebar
      const tabBtn = event.target.closest('#topTabs button[data-section]');
      if (tabBtn) showSection(tabBtn.dataset.section);

      // Live map: refresh button
      if (event.target.closest('#refreshLiveMapBtn')) loadLiveAttendance();

      // Live map: click employee card → focus marker
      const liveCard = event.target.closest('.live-emp-card');
      if (liveCard) focusLiveEmployee(liveCard.dataset.userid);

      // Hourly rates — refresh + save row
      if (event.target.closest('#refreshRatesBtn')) loadHourlyRates();
      const saveBtn = event.target.closest('.btn-save-rate');
      if (saveBtn) saveHourlyRate(saveBtn.dataset.username, saveBtn);

      // Payroll — generate + print
      if (event.target.closest('#generatePayrollBtn')) generatePayroll();
      if (event.target.closest('#printPayrollBtn'))    printPayroll();

      // My Profile
      if (event.target.closest('#pickProfileImageBtn')) pickProfileImage();
      if (event.target.closest('#saveProfileBtn'))      saveMyProfile();

      // Admin: branding + payroll rules
      if (event.target.closest('#pickLogoBtn'))             pickLogo();
      if (event.target.closest('#saveLogoBtn'))             saveLogo();
      if (event.target.closest('#savePayrollSettingsBtn'))  savePayrollSettings();
    });

    // file inputs (logo + profile photo) — change events
    document.addEventListener('change', function (event) {
      if (event.target.id === 'logoFileInput')         onLogoPicked(event.target.files && event.target.files[0]);
      if (event.target.id === 'profileImageInput')     onProfileImagePicked(event.target.files && event.target.files[0]);
    });

    // Mark rate inputs dirty on edit (visual hint that Save is needed)
    document.addEventListener('input', function(event) {
      const inp = event.target.closest('.rate-input');
      if (!inp) return;
      inp.classList.toggle('dirty', String(inp.value) !== String(inp.dataset.original));
    });
  }

  // ISO 8601 everywhere — "2025-12-08T18:40:21Z"
  function updateClock() {
    const now = new Date();
    const isoFull = now.toISOString().slice(0, 19) + 'Z';      // 2025-12-08T18:40:21Z
    const localTime = now.toTimeString().slice(0, 8);          // HH:MM:SS local
    const isoDate = now.toISOString().slice(0, 10);            // YYYY-MM-DD

    const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    set('isoClock', isoFull);     // page header
    set('currentTime', localTime); // employee "Today's Status" big clock
    set('currentDate', isoDate);   // employee section date row
  }

  function switchLanguage() { /* removed — English only */ }

  function updateLanguageUI() {
    const t = translations.en;
    Object.keys(t).forEach(key => {
      const element = document.getElementById(key);
      if (element) element.textContent = t[key];
    });
  }

  function initializeDateSelectors() {
    const currentYear = new Date().getFullYear();
    const yearSelect = document.getElementById('attendanceYear');
    if (yearSelect) {
      yearSelect.innerHTML = '';
      for (let i = currentYear - 2; i <= currentYear; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = i;
        if (i === currentYear) option.selected = true;
        yearSelect.appendChild(option);
      }
    }
    
    const currentMonth = new Date().getMonth();
    const monthSelect = document.getElementById('attendanceMonth');
    if (monthSelect) monthSelect.value = currentMonth;
  }

  function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    
    document.getElementById('username').classList.remove('is-invalid');
    document.getElementById('password').classList.remove('is-invalid');
    
    let isValid = true;
    if (!username || username.length < 3) {
      document.getElementById('username').classList.add('is-invalid');
      document.getElementById('usernameError').textContent = 
        'Username must be at least 3 characters';
      isValid = false;
    }
    
    if (!password || password.length < 1) {
      document.getElementById('password').classList.add('is-invalid');
      document.getElementById('passwordError').textContent = 
        'Password is required';
      isValid = false;
    }
    
    if (!isValid) return;
    
    showSpinner('Authenticating...');

    api('login', { username, password }).then(handleLoginSuccess);
  }

  function handleLoginSuccess(result) {
    hideSpinner();

    if (!result.success) {
      showPopup('error',
        'Login Failed',
        result.message || ('Invalid username or password.'));
      return;
    }

    if (document.getElementById('rememberMe').checked) {
      localStorage.setItem('rememberedUser', result.username);
    } else {
      localStorage.removeItem('rememberedUser');
    }

    // persist 1-hour session for auto-restore on reload
    saveSession({
      userId: result.userId, username: result.username, fullName: result.fullName,
      role: result.role, departmentId: result.departmentId || '', position: result.position || '',
      colorScheme: result.colorScheme || 'navy', layoutMode: result.layoutMode || 'sidebar',
      token: result.token || ''
    });

    applySession(result, /*announce*/ true);
  }

  // shared post-login UI hydration — used by handleLoginSuccess AND auto-restore on reload
  function applySession(result, announce) {
    currentUser     = result.username;
    currentUserId   = result.userId;
    currentFullName = result.fullName || result.username;
    currentDeptId   = result.departmentId || '';
    currentRole     = result.role;
    currentColorScheme = result.colorScheme || 'navy';
    applyPalette(currentColorScheme);
    currentLayoutMode = result.layoutMode || 'sidebar';
    applyLayout(currentLayoutMode);

    // swap login → app shell
    document.getElementById('loginPage').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');

    // populate sidebar identity (incl. avatar initials or photo)
    document.getElementById('sidebarUserName').textContent = currentFullName;
    document.getElementById('sidebarUserRole').textContent = currentRole;
    const avatarEl = document.getElementById('sidebarAvatar');
    if (avatarEl) {
      const img = result.profileImage || '';
      if (img) {
        avatarEl.innerHTML = '<img src="' + img + '" style="width:100%; height:100%; border-radius:50%; object-fit:cover;" alt="Profile">';
      } else {
        avatarEl.textContent = (currentFullName || '?').trim().charAt(0).toUpperCase();
      }
    }

    // company logo (if admin uploaded one) — apply to login screen + sidebar brand
    if (result.companyLogoUrl) applyCompanyLogo(result.companyLogoUrl);

    // company name — sidebar brand + About header (set everywhere from Settings)
    applyCompanyName(result.companyName || 'Rameez Scripts');

    // gate admin-only Settings cards (branding + payroll rules)
    document.querySelectorAll('.admin-only').forEach(el => {
      el.style.display = currentRole === 'admin' ? '' : 'none';
    });

    // build per-role menu and open the default section (both renderers — CSS shows whichever layout is active)
    buildSidebar(currentRole);
    buildTopTabs(currentRole);
    const def = (SECTION_DEFS[currentRole] || [ABOUT_ITEM])[0];
    showSection(def.id);

    // employee-only setup (welcome card + location tracking)
    if (currentRole === 'employee') {
      document.getElementById('userInitial').textContent = currentFullName.charAt(0).toUpperCase();
      document.getElementById('displayNameText').textContent = currentFullName;
      startLocationTracking();
      startDashboardRefresh();
    }

    startAutoSync();
    startSessionTimer();
    updateLanguageUI();

    if (announce) {
      showPopup('success',
        'Login Successful',
        `${'Welcome'}, ${currentFullName}!`);
    }
  }

  function startAutoSync() {
    syncInterval = setInterval(() => {
      syncData();
    }, 30000);
    setTimeout(syncData, 1000);
  }

  function stopAutoSync() {
    if (syncInterval) {
      clearInterval(syncInterval);
      syncInterval = null;
    }
  }

  function syncData() {
    const indicator = document.getElementById('syncIndicator');
    indicator.innerHTML = `<i class="fas fa-sync fa-spin"></i> <span id="syncStatusText">${translations.en.syncStatusText}</span>`;
    indicator.classList.remove('hidden');

    setTimeout(() => {
      lastSyncTime = new Date().toISOString();
      setTimeout(() => indicator.classList.add('hidden'), 2000);
      _isSyncing = true;
      refreshCurrentView();
      setTimeout(() => { _isSyncing = false; }, 800);
    }, 1000);
  }

  // refresh the currently-visible section (called every 30s by syncData)
  function refreshCurrentView() {
    const active = document.querySelector('.app-section.active');
    if (active) refreshSection(active.id);
  }

  function handleLogout() {
    if (currentUser) api('logout', { userId: currentUserId, username: currentUser });

    stopCamera();
    stopAutoSync();
    stopDashboardRefresh();
    clearSession();
    if (locationWatchId && navigator.geolocation) navigator.geolocation.clearWatch(locationWatchId);

    currentUser = null;
    currentUserId = null;
    currentFullName = null;
    currentDeptId = null;
    currentRole = null;
    cameraStream = null;
    locationWatchId = null;
    syncInterval = null;
    dashboardRefreshInterval = null;

    // hide app shell, surface login
    document.getElementById('appShell').classList.add('hidden');
    document.getElementById('loginPage').classList.remove('hidden');
    document.querySelectorAll('.app-section').forEach(s => s.classList.remove('active'));
    document.getElementById('sidebarMenu').innerHTML = '';
    document.getElementById('password').value = '';
    document.getElementById('loginForm').reset();
  }

  function checkStatus() {
    if (!_isSyncing) {
      const sb = document.getElementById('statusBadge');
      if (sb) sb.innerHTML = '<div class="skeleton skel-pill"></div>';
    }
    api('getMyStatus', { username: currentUser }).then(res => {
      const status = (res.success && res.data) || { hasCheckedIn:false, hasCheckedOut:false, checkInTime:null, checkOutTime:null, location:'' };
      updateDashboardUI(status);
    });
  }

  function updateDashboardUI(status) {
    const statusBadge = document.getElementById('statusBadge');
    const checkInBtn  = document.getElementById('checkInBtn');
    const checkOutBtn = document.getElementById('checkOutBtn');
    if (!statusBadge || !checkInBtn || !checkOutBtn) return; // employee section not in DOM

    if (status.hasCheckedIn && !status.hasCheckedOut) {
      statusBadge.innerHTML = '<i class="fas fa-check-circle"></i> Checked In';
      statusBadge.className = 'status-badge active';
      checkInBtn.classList.add('hidden');
      checkOutBtn.classList.remove('hidden');
    } else if (status.hasCheckedIn && status.hasCheckedOut) {
      statusBadge.innerHTML = '<i class="fas fa-sign-out-alt"></i> Checked Out';
      statusBadge.className = 'status-badge inactive';
      checkInBtn.classList.add('hidden');
      checkOutBtn.classList.add('hidden');
    } else {
      statusBadge.innerHTML = '<i class="fas fa-clock"></i> Not Checked In';
      statusBadge.className = 'status-badge inactive';
      checkInBtn.classList.remove('hidden');
      checkOutBtn.classList.add('hidden');
    }

    document.getElementById('checkInTime').textContent  = status.checkInTime  || '--:--:--';
    document.getElementById('checkOutTime').textContent = status.checkOutTime || '--:--:--';
    if (status.location) document.getElementById('currentLocation').textContent = status.location;
  }

  function openCameraModal(action) {
    currentAttendanceAction = action;
    capturedPhotoData = null;
    currentLocationData = null;
    
    document.getElementById('captureBtn').classList.remove('d-none');
    document.getElementById('retakeBtn').classList.add('d-none');
    document.getElementById('confirmBtn').classList.add('d-none');
    document.getElementById('capturedPhoto').classList.add('d-none');
    document.getElementById('cameraPreview').classList.remove('d-none');
    document.getElementById('photoCanvas').classList.add('d-none');
    document.getElementById('locationValidation').classList.add('hidden');
    
    const modalTitle = document.getElementById('cameraModalTitle');
    modalTitle.textContent = (action === 'CheckIn' ? 'Take Selfie for Check In' : 'Take Selfie for Check Out');
    
    // Get location but don't do strict verification
    getCurrentLocation().then(location => {
      currentLocationData = location;
      
      const accuracyInfo = location.fallback ? 
        (' (Using approximate location)') : 
        (` (Accuracy: ${Math.round(location.accuracy)}m)`);
      
      // Always show location as verified for testing
      document.getElementById('locationValidation').innerHTML = 
        `<i class="fas fa-map-marker-alt me-1"></i> ${'Location ready for attendance'}${accuracyInfo}`;
      document.getElementById('locationValidation').className = 'location-validation location-valid';
      document.getElementById('locationValidation').classList.remove('hidden');
      document.getElementById('confirmBtn').disabled = false;
      
    }).catch(error => {
      document.getElementById('locationValidation').innerHTML = 
        `<i class="fas fa-map-marker-alt me-1"></i> ${'Location available'}`;
      document.getElementById('locationValidation').className = 'location-validation location-valid';
      document.getElementById('locationValidation').classList.remove('hidden');
      document.getElementById('confirmBtn').disabled = false;
    });
    
    startCamera();
    const cameraModal = new bootstrap.Modal(document.getElementById('cameraModal'));
    cameraModal.show();
  }

  function startCamera() {
    stopCamera();
    navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } 
    })
    .then(stream => {
      cameraStream = stream;
      const video = document.getElementById('cameraPreview');
      video.srcObject = stream;
    })
    .catch(error => {
      console.error('Camera error:', error);
      showPopup('error', 'Camera Error', 'Could not access camera. Please ensure camera permissions are granted.');
    });
  }

  function stopCamera() {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => {
        track.stop();
      });
      cameraStream = null;
    }
  }

  function capturePhoto() {
    const video = document.getElementById('cameraPreview');
    const canvas = document.getElementById('photoCanvas');
    const photoPreview = document.getElementById('photoPreview');

    if (!video || video.readyState !== 4) {
      showPopup('error', 'Camera Error', 'Camera is not ready.');
      return;
    }

    const maxDim = 640;
    let vw = video.videoWidth;
    let vh = video.videoHeight;
    let scale = Math.min(1, maxDim / Math.max(vw, vh));
    const w = Math.round(vw * scale);
    const h = Math.round(vh * scale);

    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();

    try {
      capturedPhotoData = canvas.toDataURL('image/jpeg', 0.7);
    } catch (e) {
      capturedPhotoData = canvas.toDataURL();
    }

    photoPreview.src = capturedPhotoData;
    document.getElementById('captureBtn').classList.add('d-none');
    document.getElementById('retakeBtn').classList.remove('d-none');
    document.getElementById('confirmBtn').classList.remove('d-none');
    document.getElementById('capturedPhoto').classList.remove('d-none');
    document.getElementById('cameraPreview').classList.add('d-none');
    stopCamera();
  }

  function retakePhoto() {
    document.getElementById('captureBtn').classList.remove('d-none');
    document.getElementById('retakeBtn').classList.add('d-none');
    document.getElementById('confirmBtn').classList.add('d-none');
    document.getElementById('capturedPhoto').classList.add('d-none');
    document.getElementById('cameraPreview').classList.remove('d-none');
    capturedPhotoData = null;
    startCamera();
  }

  function confirmAttendance() {
    if (!capturedPhotoData) {
      showPopup('error', 'No Photo', 'Please capture a photo before confirming.');
      return;
    }

    showSpinner('Processing attendance...');

    const loc = currentLocationData ? {
      latitude: currentLocationData.latitude,
      longitude: currentLocationData.longitude,
      accuracy: currentLocationData.accuracy
    } : null;

    api('markAttendance', {
      username: currentUser,
      action: currentAttendanceAction,
      photoBase64: capturedPhotoData,
      location: loc
    }).then(handleAttendanceSuccess);
  }

  function handleAttendanceSuccess(result) {
    hideSpinner();

    if (result.success) {
      const actionText = currentAttendanceAction === 'CheckIn'
        ? ('Check In')
        : ('Check Out');

      showPopup('success', `${actionText} Successful!`,
        `${'Recorded at'} ${result.time || ''}${result.site ? ' — ' + result.site : ''}`);

      const cameraModal = bootstrap.Modal.getInstance(document.getElementById('cameraModal'));
      if (cameraModal) cameraModal.hide();

      checkStatus();
      if (currentAttendanceAction === 'CheckIn') loadChart();
    } else {
      showPopup('error',
        'Attendance Failed',
        result.message || ('Unknown error occurred'));
    }
  }

  function startLocationTracking() {
    if (navigator.geolocation) {
      const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
      locationWatchId = navigator.geolocation.watchPosition(
        updateLocationInfo,
        handleLocationError,
        options
      );
      
      getCurrentLocation().then(location => {
        updateLocationInfo({
          coords: {
            latitude: location.latitude,
            longitude: location.longitude,
            accuracy: location.accuracy
          }
        });
      });
    } else {
      document.getElementById('currentLocation').textContent = 'Geolocation is not supported by this browser.';
    }
  }

  function updateLocationInfo(position) {
    const latitude = position.coords.latitude;
    const longitude = position.coords.longitude;
    const accuracy = position.coords.accuracy;
    
    userLocation = { lat: latitude, lng: longitude, accuracy: accuracy };
    
    const locationElement = document.getElementById('currentLocation');
    locationElement.innerHTML = `
      <a href="https://maps.google.com/?q=${latitude},${longitude}" target="_blank" class="location-map-link">
        <i class="fas fa-external-link-alt me-1"></i>
        ${'View on Map'} (${latitude.toFixed(6)}, ${longitude.toFixed(6)})
      </a>
    `;
    
    if (accuracy) {
      document.getElementById('locationAccuracy').textContent = 
        `${'Accuracy'}: ${Math.round(accuracy)} ${'meters'}`;
      
      if (accuracy > 100) {
        document.getElementById('locationAccuracy').style.color = '#ef4444';
      } else if (accuracy > 50) {
        document.getElementById('locationAccuracy').style.color = '#f59e0b';
      } else {
        document.getElementById('locationAccuracy').style.color = '#10b981';
      }
    }
    
    if (map && userMarker) {
      userMarker.setLatLng([latitude, longitude]);
    } else if (map && !userMarker) {
      updateUserLocationOnMap();
    }
  }

  function handleLocationError(error) {
    let message = '';
    switch(error.code) {
      case error.PERMISSION_DENIED:
        message = 'Location access denied. Please enable location permissions.';
        break;
      case error.POSITION_UNAVAILABLE:
        message = 'Location information unavailable.';
        break;
      case error.TIMEOUT:
        message = 'Location request timed out.';
        break;
      default:
        message = 'An unknown location error occurred.';
        break;
    }
    document.getElementById('currentLocation').textContent = message;
    document.getElementById('locationAccuracy').textContent = '';
  }

  function startDashboardRefresh() {
    dashboardRefreshInterval = setInterval(() => {
      if (currentUser && currentRole === 'employee') checkStatus();
    }, 30000);
  }

  function stopDashboardRefresh() {
    if (dashboardRefreshInterval) {
      clearInterval(dashboardRefreshInterval);
      dashboardRefreshInterval = null;
    }
  }

  function loadChart() {
    const today = new Date();
    api('getMyChart', { username: currentUser, year: today.getFullYear(), month: today.getMonth() }).then(res => {
      if (res.success) displayChart(res.data);
    });
  }

  // small donut — capped via .chart-wrap canvas CSS (max-height 200px)
  function displayChart(stats) {
    const canvas = document.getElementById('attendanceChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (attendanceChartInstance) attendanceChartInstance.destroy();

    attendanceChartInstance = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: [
          'Present',
          'Absent',
          'Sundays'
        ],
        datasets: [{
          data: [stats.present, stats.absent, stats.sundays],
          backgroundColor: ['#34a853', '#ea4335', '#0074D9'],
          borderWidth: 2,
          borderColor: '#fff',
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { padding: 10, usePointStyle: true, font: { size: 11 } } }
        },
        cutout: '60%'
      }
    });
  }

  // ─── Admin dashboard charts (2x2) ───
  const dashCharts = {};
  function destroyDash_(key) { if (dashCharts[key]) { dashCharts[key].destroy(); delete dashCharts[key]; } }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function hexAlpha(hex, alpha) {
    const m = hex.replace('#', '');
    const v = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
    const r = parseInt(v.substr(0, 2), 16), g = parseInt(v.substr(2, 2), 16), b = parseInt(v.substr(4, 2), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function loadDashboardCharts() {
    api('getDashboardCharts').then(res => {
      if (!res.success) return;
      const d = res.data;
      renderTrendLine(d.dailyTrend);
      renderDeptDist(d.deptDistribution);
      renderStatusBars(d.statusBreakdown);
      renderLeaveTypes(d.leaveTypes);
    });
  }

  function renderTrendLine(data) {
    destroyDash_('trend');
    const canvas = document.getElementById('trendLineChart');
    if (!canvas) return;
    const accent = cssVar('--navy-accent') || '#0074D9';
    dashCharts.trend = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: data.map(d => String(d.date).slice(5)),
        datasets: [{
          label: 'Present',
          data: data.map(d => d.present),
          borderColor: accent,
          backgroundColor: hexAlpha(accent, 0.18),
          borderWidth: 2,
          fill: true,
          tension: 0.35,
          pointRadius: 2,
          pointHoverRadius: 5,
          pointBackgroundColor: accent
        }, {
          label: 'Late',
          data: data.map(d => d.late),
          borderColor: '#fbbc04',
          backgroundColor: hexAlpha('#fbbc04', 0.10),
          borderWidth: 2,
          fill: false,
          tension: 0.35,
          pointRadius: 2,
          pointHoverRadius: 5,
          borderDash: [4, 4]
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 14, font: { size: 11 } } } },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 } }, grid: { color: '#f0f0f0' } },
          x: { ticks: { font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }, grid: { display: false } }
        }
      }
    });
  }

  function renderDeptDist(data) {
    destroyDash_('dept');
    const canvas = document.getElementById('deptDistChart');
    if (!canvas) return;
    const palette = [cssVar('--navy-primary'), cssVar('--navy-accent'), '#34a853', '#fbbc04', '#ea4335', '#8b5cf6', '#00afb9', '#e91e63'];
    dashCharts.dept = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: data.map(d => d.name),
        datasets: [{
          data: data.map(d => d.count),
          backgroundColor: data.map((_, i) => palette[i % palette.length]),
          borderWidth: 2,
          borderColor: '#fff',
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 }, padding: 8 } } },
        cutout: '58%'
      }
    });
  }

  function renderStatusBars(stats) {
    destroyDash_('status');
    const canvas = document.getElementById('statusBarChart');
    if (!canvas) return;
    dashCharts.status = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: ['Present', 'Late', 'Absent', 'On Leave'],
        datasets: [{
          data: [stats.present, stats.late, stats.absent, stats.onLeave],
          backgroundColor: ['#34a853', '#fbbc04', '#ea4335', cssVar('--navy-accent') || '#0074D9'],
          borderRadius: 6,
          maxBarThickness: 56
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.parsed.y + ' people' } } },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 } }, grid: { color: '#f0f0f0' } },
          x: { ticks: { font: { size: 11 } }, grid: { display: false } }
        }
      }
    });
  }

  function renderLeaveTypes(types) {
    destroyDash_('leaves');
    const canvas = document.getElementById('leaveTypesChart');
    if (!canvas) return;
    dashCharts.leaves = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: ['Sick', 'Casual', 'Annual', 'Medical'],
        datasets: [{
          data: [types.sick, types.casual, types.annual, types.medical],
          backgroundColor: ['#ea4335', cssVar('--navy-accent') || '#0074D9', '#34a853', '#fbbc04'],
          borderWidth: 2,
          borderColor: '#fff',
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 }, padding: 8 } } },
        cutout: '58%'
      }
    });
  }

  // Last 7 days hours bar chart — pulls from the same getMyHistory endpoint
  function loadTrendChart() {
    api('getMyHistory', { username: currentUser, days: 7 }).then(res => {
      displayTrendChart((res.success && res.data) || []);
    });
  }

  function displayTrendChart(records) {
    const canvas = document.getElementById('attendanceTrendChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (trendChartInstance) trendChartInstance.destroy();

    // backend returns newest-first → reverse for chronological x-axis
    const sorted = records.slice().reverse();
    const labels = sorted.map(r => String(r.date).slice(5)); // MM-DD
    const data   = sorted.map(r => Number(r.hours) || 0);

    trendChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Hours',
          data,
          backgroundColor: 'rgba(0,116,217,0.75)',
          borderColor: '#0074D9',
          borderWidth: 1,
          borderRadius: 4,
          maxBarThickness: 28
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.parsed.y + ' h' } } },
        scales: {
          y: { beginAtZero: true, suggestedMax: 10, ticks: { stepSize: 2, font: { size: 10 } }, grid: { color: '#f0f0f0' } },
          x: { ticks: { font: { size: 10 } }, grid: { display: false } }
        }
      }
    });
  }

  // ─── My History sidebar section (inline last 20) ───
  function loadHistoryInline() {
    const args = { username: currentUser, days: 20 };
    if (!swr.get('getMyHistory:' + JSON.stringify(args))) {
      destroyDataTable('historyTable');
      setSkel('historyTableBody', skelTableRows(7, 5));
    }
    apiSwr('getMyHistory', args, {
      onData: res => displayHistoryInline((res && res.success && res.data) || [])
    });
  }

  function displayHistoryInline(history) {
    const photoTd = url => url
      ? `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;border:2px solid var(--navy-accent);" onerror="this.style.display='none'"></a>`
      : '<span class="text-muted">—</span>';
    const statusBadge = s => {
      const cls = s === 'late' ? 'inactive' : s === 'absent' ? 'inactive' : 'active';
      const label = s ? s.charAt(0).toUpperCase() + s.slice(1) : '—';
      return `<span class="status-badge ${cls}">${label}</span>`;
    };

    const rows = history.slice(0, 20).map(rec => `
      <tr>
        <td data-label="Date"><strong>${rec.date}</strong></td>
        <td data-label="Check In">${rec.checkIn || '--:--'}</td>
        <td data-label="In Selfie">${photoTd(rec.checkInPhotoUrl)}</td>
        <td data-label="Check Out">${rec.checkOut || '--:--'}</td>
        <td data-label="Out Selfie">${photoTd(rec.checkOutPhotoUrl)}</td>
        <td data-label="Hours">${rec.hours || 0}</td>
        <td data-label="Status">${statusBadge(rec.status)}</td>
      </tr>`).join('');

    document.getElementById('historyTableBody').innerHTML = rows;
    initDataTable('historyTable', {
      columnDefs: [
        { targets: [2, 4], orderable: false, searchable: false, className: 'text-center' }
      ]
    });
  }

  function viewHistory() {
    showSpinner('Loading your history...');
    api('getMyHistory', { username: currentUser, days: 30 }).then(res => {
      displayHistory((res.success && res.data) || []);
    });
  }

  function displayHistory(history) {
    hideSpinner();
    const photoTd = url => url
      ? `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid #6366f1;" onerror="this.style.display='none'"></a>`
      : '<span class="text-muted">—</span>';

    let tableHtml = `<div class="table-responsive" style="max-height: 400px; overflow-y: auto;">
      <table class="table table-striped">
        <thead class="table-dark" style="position: sticky; top: 0;">
          <tr>
            <th>${'Date'}</th>
            <th>${'Check In'}</th>
            <th>${'In Selfie'}</th>
            <th>${'Check Out'}</th>
            <th>${'Out Selfie'}</th>
            <th>${'Hours'}</th>
          </tr>
        </thead>
        <tbody>`;

    history.forEach(rec => {
      tableHtml += `<tr>
        <td>${rec.date}</td>
        <td>${rec.checkIn}</td>
        <td>${photoTd(rec.checkInPhotoUrl)}</td>
        <td>${rec.checkOut}</td>
        <td>${photoTd(rec.checkOutPhotoUrl)}</td>
        <td>${rec.hours}</td>
      </tr>`;
    });

    tableHtml += '</tbody></table></div>';

    Swal.fire({
      title: 'Attendance History (Last 30 Days)',
      html: tableHtml,
      width: '900px',
      background: 'rgba(255,255,255,0.9)',
      backdrop: 'rgba(0,0,0,0.5)'
    });
  }

  function openLeaveRequestModal() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('fromDate').min = today;
    document.getElementById('toDate').min = today;
    const leaveModal = new bootstrap.Modal(document.getElementById('leaveRequestModal'));
    leaveModal.show();
  }

  function submitLeaveRequest() {
    const leaveType = document.getElementById('leaveType').value;
    const fromDate = document.getElementById('fromDate').value;
    const toDate = document.getElementById('toDate').value;
    const reason = document.getElementById('leaveReason').value.trim();
    
    if (!leaveType || !fromDate || !toDate || !reason) {
      showPopup('warning', 'Incomplete', 'Please fill all required fields.');
      return;
    }
    
    if (new Date(toDate) < new Date(fromDate)) {
      showPopup('warning', 'Invalid Dates', 'End date must be after start date.');
      return;
    }

    // edit mode: same modal, but call updateLeave instead of submitLeave
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
        showPopup('success', 'Updated', 'Leave application updated.');
        loadLeaveApplications();
        if (typeof loadLeaveRequests === 'function') loadLeaveRequests();
      });
      return;
    }

    showSpinner('Submitting leave request...');

    api('submitLeave', { username: currentUser, type: leaveType, fromDate, toDate, reason }).then(res => {
      hideSpinner();
      if (res.success) {
        showPopup('success',
          'Leave Request Submitted',
          'Your leave request has been submitted for approval.');
        const modal = bootstrap.Modal.getInstance(document.getElementById('leaveRequestModal'));
        if (modal) modal.hide();
        document.getElementById('leaveRequestForm').reset();
        loadLeaveRequests();
      } else {
        showPopup('error', 'Failed', res.message || 'Could not submit leave');
      }
    });
  }

  function loadLeaveRequests() {
    setSkel('leaveRequestsList', skelList(3));
    api('getMyLeaves', { username: currentUser }).then(res => {
      displayLeaveRequests((res.success && res.data) || []);
    });
  }

  function displayLeaveRequests(leaveRequests) {
    let html = '';
    if (leaveRequests.length === 0) {
      html = `<div class="text-center text-muted py-3">${'No leave requests found.'}</div>`;
    } else {
      leaveRequests.forEach(request => {
        let statusClass = '';
        let statusText = '';
        
        switch(request.status) {
          case 'approved':
            statusClass = 'text-success';
            statusText = 'Approved';
            break;
          case 'rejected':
            statusClass = 'text-danger';
            statusText = 'Rejected';
            break;
          default:
            statusClass = 'text-warning';
            statusText = 'Pending';
        }
        
        html += `
          <div class="leave-request-item p-3 border-bottom">
            <div class="d-flex justify-content-between align-items-center">
              <div>
                <span class="leave-badge ${request.type}">${request.type.charAt(0).toUpperCase() + request.type.slice(1)} ${'Leave'}</span>
                <div class="mt-1">
                  <small class="text-muted">${request.from} ${'to'} ${request.to} (${request.days} ${'day'}${request.days > 1 ? 's' : ''})</small>
                </div>
                <div class="mt-1">
                  <small>${request.reason}</small>
                </div>
              </div>
              <div class="${statusClass} fw-bold">${statusText}</div>
            </div>
          </div>
        `;
      });
    }
    
    document.getElementById('leaveRequestsList').innerHTML = html;
  }

  // (no-op now — old IDs lived in the employee project map which has moved.
  // live counts now render via renderLivePanel for admin/manager only.)
  function updateRealTimeStats() { /* deprecated */ }

  // Manager Dashboard Functions
  function loadDepartmentData() {
    skelStatValues(['departmentEmployees','presentDepartment','onLeaveDepartment','lateDepartment']);
    api('getDeptStats', { managerUsername: currentUser }).then(res => {
      displayDepartmentStats((res.success && res.data) || { total:0, present:0, onLeave:0, late:0 });
    });
  }

  function displayDepartmentStats(stats) {
    document.getElementById('departmentEmployees').textContent = stats.total;
    document.getElementById('presentDepartment').textContent = stats.present;
    document.getElementById('onLeaveDepartment').textContent = stats.onLeave;
    document.getElementById('lateDepartment').textContent = stats.late;
  }

  function loadDepartmentEmployees() {
    const args = { managerUsername: currentUser };
    if (!swr.get('getDeptEmployees:' + JSON.stringify(args))) {
      setSkel('departmentEmployeesTable', skelTableRows(5, 4));
    }
    apiSwr('getDeptEmployees', args, {
      onData: res => displayDepartmentEmployees((res && res.success && res.data) || [])
    });
  }

  function displayDepartmentEmployees(employees) {
    let html = '';
    employees.forEach(emp => {
      let statusClass = '';
      let statusText = '';
      let statusIcon = '';
      
      if (emp.status === 'checkedin') {
        statusClass = 'status-checkedin';
        statusText = 'Checked In';
        statusIcon = '<i class="fas fa-check-circle"></i>';
      } else if (emp.status === 'checkedout') {
        statusClass = 'status-checkedout';
        statusText = 'Checked Out';
        statusIcon = '<i class="fas fa-sign-out-alt"></i>';
      } else {
        statusClass = 'status-notchecked';
        statusText = 'Not Checked In';
        statusIcon = '<i class="fas fa-clock"></i>';
      }
      
      html += `
        <tr>
          <td data-label="Name">${emp.name}</td>
          <td data-label="Position">${emp.position}</td>
          <td data-label="Status"><span class="employee-status ${statusClass}">${statusIcon} ${statusText}</span></td>
          <td data-label="Last Activity">${emp.lastActivity}</td>
          <td data-label="Location"><small class="text-muted">${emp.location}</small></td>
        </tr>
      `;
    });
    
    document.getElementById('departmentEmployeesTable').innerHTML = html;
  }

  function loadManagerLeaveApplications() {
    const args = { managerUsername: currentUser };
    if (!swr.get('getPendingLeavesForManager:' + JSON.stringify(args))) {
      setSkel('managerPendingLeaves', skelList(3));
    }
    apiSwr('getPendingLeavesForManager', args, {
      onData: res => displayManagerLeaveApplications((res && res.success && res.data) || [])
    });
  }

  function displayManagerLeaveApplications(pendingLeaves) {
    let html = '';
    if (pendingLeaves.length === 0) {
      html = `<div class="text-center text-muted py-3">${'No pending leave requests.'}</div>`;
    } else {
      pendingLeaves.forEach(leave => {
        html += `
          <div class="leave-request-item p-3 border-bottom">
            <div class="d-flex justify-content-between align-items-start">
              <div>
                <h6 class="mb-1">${leave.employee}</h6>
                <span class="leave-badge ${leave.type}">${leave.type.charAt(0).toUpperCase() + leave.type.slice(1)} ${'Leave'}</span>
                <div class="mt-1">
                  <small class="text-muted">${leave.from} ${'to'} ${leave.to} (${leave.days} ${'day'}${leave.days > 1 ? 's' : ''})</small>
                </div>
                <div class="mt-1">
                  <small>${'Applied on'}: ${leave.appliedOn}</small>
                </div>
                <div class="mt-1">
                  <small><strong>${'Reason'}:</strong> ${leave.reason}</small>
                </div>
              </div>
              <div class="btn-group">
                <button class="btn btn-sm btn-success btn-approve" data-id="${leave.id}">${'Approve'}</button>
                <button class="btn btn-sm btn-danger btn-reject" data-id="${leave.id}">${'Reject'}</button>
              </div>
            </div>
          </div>
        `;
      });
    }
    
    document.getElementById('managerPendingLeaves').innerHTML = html;
  }

  // shared approve / reject — works for admin (s-adm-leaves) and manager (s-mgr-leaves)
  function approveLeave(leaveId) {
    cpop.fire({
      icon: 'question', title: 'Approve Leave?', text: 'Mark this request as approved.',
      showCancelButton: true, confirmButtonText: 'Approve', cancelButtonText: 'Cancel'
    }).then(c => {
      if (!c.isConfirmed) return;
      showSpinner('Approving leave request...');
      api('approveLeave', { leaveId, reviewerId: currentUserId, reviewerUsername: currentUser }).then(res => {
        hideSpinner();
        if (!res.success) { showPopup('error', 'Failed', res.message || 'Could not approve'); return; }
        showPopup('success', 'Leave Approved', 'The leave request has been approved.');
        _refreshLeavesAfterDecision();
      });
    });
  }

  function rejectLeave(leaveId) {
    cpop.fire({
      icon: 'warning', title: 'Reject Leave?', text: 'Mark this request as rejected.',
      showCancelButton: true, confirmButtonText: 'Reject', cancelButtonText: 'Cancel'
    }).then(c => {
      if (!c.isConfirmed) return;
      showSpinner('Rejecting leave request...');
      api('rejectLeave', { leaveId, reviewerId: currentUserId, reviewerUsername: currentUser }).then(res => {
        hideSpinner();
        if (!res.success) { showPopup('error', 'Failed', res.message || 'Could not reject'); return; }
        showPopup('success', 'Leave Rejected', 'The leave request has been rejected.');
        _refreshLeavesAfterDecision();
      });
    });
  }

  // reload whichever leaves list the current role is looking at
  function _refreshLeavesAfterDecision() {
    if (currentRole === 'admin') {
      loadLeaveApplications();
    } else if (currentRole === 'manager') {
      loadManagerLeaveApplications();
      if (typeof loadDepartmentData === 'function') loadDepartmentData();
    }
  }

  // Admin Dashboard Functions
  function loadDashboardData() {
    skelStatValues(['totalEmployees','presentToday','absentToday','onLeaveToday','activeLocations','lateToday']);
    api('getAdminStats').then(res => {
      displayAdminStats((res.success && res.data) || { totalEmployees:0, presentToday:0, absentToday:0, onLeaveToday:0, activeLocations:0, lateToday:0 });
    });
  }

  function displayAdminStats(stats) {
    document.getElementById('totalEmployees').textContent = stats.totalEmployees;
    document.getElementById('presentToday').textContent = stats.presentToday;
    document.getElementById('absentToday').textContent = stats.absentToday;
    document.getElementById('onLeaveToday').textContent = stats.onLeaveToday;
    document.getElementById('activeLocations').textContent = stats.activeLocations;
    document.getElementById('lateToday').textContent = stats.lateToday;
  }

  function showAddEmployeeModal() {
    const deptSelect = document.getElementById('newDepartment');
    deptSelect.innerHTML = '<option value="">Select Department</option>';
    api('listDepartments').then(res => {
      if (res.success) res.data.forEach(d => {
        const o = document.createElement('option');
        o.value = d.id; o.textContent = d.name;
        deptSelect.appendChild(o);
      });
    });
    document.getElementById('addEmployeeForm').reset();
    const modal = new bootstrap.Modal(document.getElementById('addEmployeeModal'));
    modal.show();
  }

  function addEmployee() {
    const username = document.getElementById('newUsername').value.trim();
    const password = document.getElementById('newPassword').value;
    const fullName = document.getElementById('newFullName').value.trim();
    const department = document.getElementById('newDepartment').value;
    const position = document.getElementById('newPosition').value.trim();
    const role = document.getElementById('newRole').value;
    
    if (!username || !password || !fullName || !department || !position || !role) {
      showPopup('warning', 'Incomplete', 'Please fill all required fields.');
      return;
    }
    
    if (password.length < 6) {
      showPopup('warning', 'Weak Password', 'Password must be at least 6 characters.');
      return;
    }
    
    showSpinner('Adding employee...');

    api('addEmployee', { username, password, fullName, department, position, role, actorId: currentUserId, actorUsername: currentUser }).then(res => {
      hideSpinner();
      if (res.success) {
        showPopup('success',
          'Employee Added',
          'New employee has been added successfully.');
        const modal = bootstrap.Modal.getInstance(document.getElementById('addEmployeeModal'));
        modal.hide();
        document.getElementById('addEmployeeForm').reset();
        loadEmployeeList();
      } else {
        showPopup('error', 'Failed', res.message || 'Could not add employee');
      }
    });
  }

  function loadEmployeeList() {
    if (!swr.get('listEmployees:{}')) {
      destroyDataTable('employeesTable');
      setSkel('employeesTableBody', skelTableRows(7, 5));
    }
    apiSwr('listEmployees', {}, {
      onData: res => displayEmployeeList((res && res.success && res.data) || [])
    });
  }

  function displayEmployeeList(employees) {
    let html = '';
    const statusMap = {
      checkedin:  { class: 'status-checkedin',  text: 'Checked In', icon: '<i class="fas fa-check-circle"></i>' },
      checkedout: { class: 'status-checkedout', text: 'Checked Out', icon: '<i class="fas fa-sign-out-alt"></i>' },
      notchecked: { class: 'status-notchecked', text: 'Not Checked In',    icon: '<i class="fas fa-clock"></i>' }
    };
    employees.forEach((emp, index) => {
      const todayStatus = statusMap[emp.todayStatus] || statusMap.notchecked;
      
      html += `
        <tr>
          <td data-label="ID">${index + 1}</td>
          <td data-label="Name">${emp.fullName}</td>
          <td data-label="Department">${emp.department}</td>
          <td data-label="Position">${emp.position}</td>
          <td data-label="Status"><span class="status-badge ${emp.status === 'Active' ? 'active' : 'inactive'}">${emp.status}</span></td>
          <td data-label="Today"><span class="employee-status ${todayStatus.class}">${todayStatus.icon} ${todayStatus.text}</span></td>
          <td data-label="Actions" style="white-space:nowrap;">
            <button class="action-icon edit-icon btn-edit-employee" data-username="${emp.username}" title="${'Edit'}"><i class="fas fa-edit"></i></button>
            <button class="action-icon delete-icon btn-delete-employee" data-username="${emp.username}" title="${'Delete'}"><i class="fas fa-trash"></i></button>
          </td>
        </tr>
      `;
    });
    
    document.getElementById('employeesTableBody').innerHTML = html;
    initDataTable('employeesTable', {
      columnDefs: [
        { targets: -1, orderable: false, searchable: false, className: 'text-center dt-no-export' }
      ]
    });
  }

  function editEmployee(username) {
    Promise.all([
      api('getEmployeeByUsername', { username }),
      api('listDepartments')
    ]).then(([empRes, deptRes]) => {
      if (!empRes.success || !empRes.data) {
        showPopup('error', 'Not Found', 'Employee not found');
        return;
      }
      const emp = empRes.data;
      document.getElementById('editUsername').value = emp.username;
      document.getElementById('editFullName').value = emp.fullName;
      document.getElementById('editPosition').value = emp.position;
      document.getElementById('editRole').value = emp.role;
      document.getElementById('editStatus').value = emp.status;

      const deptSelect = document.getElementById('editDepartment');
      deptSelect.innerHTML = '';
      ((deptRes.success && deptRes.data) || []).forEach(d => {
        const o = document.createElement('option');
        o.value = d.id; o.textContent = d.name;
        if (d.id === emp.departmentId) o.selected = true;
        deptSelect.appendChild(o);
      });

      new bootstrap.Modal(document.getElementById('editEmployeeModal')).show();
    });
  }

  function updateEmployee() {
    const username = document.getElementById('editUsername').value;
    const fullName = document.getElementById('editFullName').value;
    const department = document.getElementById('editDepartment').value;
    const position = document.getElementById('editPosition').value;
    const role = document.getElementById('editRole').value;
    const status = document.getElementById('editStatus').value;

    showSpinner('Updating employee...');
    api('updateEmployee', { username, fullName, department, position, role, status, actorId: currentUserId, actorUsername: currentUser }).then(res => {
      hideSpinner();
      if (res.success) {
        showPopup('success',
          'Employee Updated',
          `Employee ${fullName} has been updated successfully.`);
        const modal = bootstrap.Modal.getInstance(document.getElementById('editEmployeeModal'));
        modal.hide();
        loadEmployeeList();
      } else {
        showPopup('error', 'Failed', res.message || 'Could not update');
      }
    });
  }

  function deleteEmployee(username) {
    Swal.fire({
      title: 'Are you sure?',
      text: `Do you want to delete employee ${username}?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'Yes, delete it!'
    }).then((result) => {
      if (result.isConfirmed) {
        showSpinner('Deleting employee...');
        api('deleteEmployee', { username, actorId: currentUserId, actorUsername: currentUser }).then(res => {
          hideSpinner();
          if (res.success) {
            showPopup('success',
              'Deleted',
              'Employee has been deleted.');
            loadEmployeeList();
          } else {
            showPopup('error', 'Failed', res.message || 'Could not delete');
          }
        });
      }
    });
  }

  let editingDeptId = null;

  function showAddDepartmentModal(dept) {
    editingDeptId = dept ? dept.id : null;
    document.querySelector('#addDepartmentModal .modal-title').textContent = dept
      ? ('Edit Department')
      : ('Add New Department');
    document.getElementById('saveDepartmentBtn').textContent = dept
      ? ('Update Department')
      : ('Add Department');

    document.getElementById('departmentName').value = dept ? dept.name : '';
    document.getElementById('departmentDescription').value = dept ? (dept.description || '') : '';

    const managerSelect = document.getElementById('departmentManager');
    managerSelect.innerHTML = '<option value="">Select Manager</option>';
    api('listManagers').then(res => {
      ((res.success && res.data) || []).forEach(m => {
        const o = document.createElement('option');
        o.value = m.id; o.textContent = m.name;
        if (dept && dept.managerId === m.id) o.selected = true;
        managerSelect.appendChild(o);
      });
    });

    new bootstrap.Modal(document.getElementById('addDepartmentModal')).show();
  }

  function addDepartment() {
    const name = document.getElementById('departmentName').value.trim();
    const description = document.getElementById('departmentDescription').value.trim();
    const manager = document.getElementById('departmentManager').value;
    
    if (!name || !manager) {
      showPopup('warning', 'Incomplete', 'Please fill all required fields.');
      return;
    }
    
    const action = editingDeptId ? 'updateDepartment' : 'addDepartment';
    const args = { name, description, manager, actorId: currentUserId, actorUsername: currentUser };
    if (editingDeptId) args.id = editingDeptId;

    showSpinner('Saving department...');
    api(action, args).then(res => {
      hideSpinner();
      if (res.success) {
        showPopup('success',
          'Saved',
          'Department saved successfully.');
        const modal = bootstrap.Modal.getInstance(document.getElementById('addDepartmentModal'));
        modal.hide();
        document.getElementById('addDepartmentForm').reset();
        editingDeptId = null;
        loadDepartments();
      } else {
        showPopup('error', 'Failed', res.message || 'Could not save department');
      }
    });
  }

  function loadDepartments() {
    if (!swr.get('listDepartments:{}')) setSkel('departmentsContainer', skelCards(3));
    apiSwr('listDepartments', {}, {
      onData: res => {
        const list = (res && res.success && res.data) || [];
        departments = list;
        displayDepartments(list);
      }
    });
  }

  function displayDepartments(departmentList) {
    const html = departmentList.map(dept => `
      <div class="department-card">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px; gap:8px;">
          <div class="card-title">${dept.name}</div>
          <div class="department-actions">
            <button class="action-icon edit-icon btn-edit-department" data-id="${dept.id}" title="Edit"><i class="fas fa-edit"></i></button>
            <button class="action-icon delete-icon btn-delete-department" data-id="${dept.id}" title="Delete"><i class="fas fa-trash"></i></button>
          </div>
        </div>
        <p style="color:#666; font-size:13px; margin-bottom:10px;">${dept.description || ''}</p>
        <div class="department-info">
          <div><i class="fas fa-user" style="color:var(--navy-accent); width:18px;"></i> ${'Manager'}: <strong>${dept.manager}</strong></div>
          <div><i class="fas fa-users" style="color:var(--navy-accent); width:18px;"></i> ${'Employees'}: <strong>${dept.employeeCount}</strong></div>
        </div>
      </div>`).join('');
    document.getElementById('departmentsContainer').innerHTML = html;
  }

  function editDepartment(id) {
    const dept = departments.find(d => String(d.id) === String(id));
    if (dept) showAddDepartmentModal(dept);
  }

  function deleteDepartment(id) {
    const dept = departments.find(d => String(d.id) === String(id));
    if (!dept) return;
    Swal.fire({
      title: 'Are you sure?',
      text: `Do you want to delete department ${dept.name}?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'Yes, delete it!'
    }).then(result => {
      if (!result.isConfirmed) return;
      showSpinner('Deleting...');
      api('deleteDepartment', { id, actorId: currentUserId, actorUsername: currentUser }).then(res => {
        hideSpinner();
        if (res.success) {
          showPopup('success',
            'Deleted',
            'Department has been deleted.');
          loadDepartments();
        } else {
          showPopup('error', 'Failed', res.message || 'Could not delete');
        }
      });
    });
  }

  let editingSiteId = null;

  function showAddProjectModal(site) {
    editingSiteId = site ? site.id : null;
    document.querySelector('#addProjectModal .modal-title').textContent = site
      ? ('Edit Project Site')
      : ('Add Project Site');
    document.getElementById('saveProjectBtn').textContent = site
      ? ('Update Site')
      : ('Add Project Site');

    document.getElementById('projectName').value        = site ? site.name : '';
    document.getElementById('projectAddress').value     = site ? site.address : '';
    document.getElementById('projectLatitude').value    = site ? site.latitude : '';
    document.getElementById('projectLongitude').value   = site ? site.longitude : '';
    document.getElementById('projectRadius').value      = site ? site.radius : 200;
    document.getElementById('projectDescription').value = site ? (site.description || '') : '';

    new bootstrap.Modal(document.getElementById('addProjectModal')).show();
  }

  function addProjectSite() {
    const name = document.getElementById('projectName').value.trim();
    const address = document.getElementById('projectAddress').value.trim();
    const latitude = parseFloat(document.getElementById('projectLatitude').value);
    const longitude = parseFloat(document.getElementById('projectLongitude').value);
    const radius = parseInt(document.getElementById('projectRadius').value);
    const description = document.getElementById('projectDescription').value.trim();
    
    if (!name || !address || isNaN(latitude) || isNaN(longitude) || isNaN(radius)) {
      showPopup('warning', 'Incomplete', 'Please fill all required fields.');
      return;
    }
    
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      showPopup('warning', 'Invalid Coordinates', 'Please enter valid latitude and longitude values.');
      return;
    }
    
    const action = editingSiteId ? 'updateProjectSite' : 'addProjectSite';
    const args = { name, address, latitude, longitude, radius, description, actorId: currentUserId, actorUsername: currentUser };
    if (editingSiteId) args.id = editingSiteId;

    showSpinner('Saving project site...');
    api(action, args).then(res => {
      hideSpinner();
      if (res.success) {
        showPopup('success',
          'Saved',
          'Project site saved successfully.');
        const modal = bootstrap.Modal.getInstance(document.getElementById('addProjectModal'));
        modal.hide();
        document.getElementById('addProjectForm').reset();
        editingSiteId = null;
        loadProjectSites();
      } else {
        showPopup('error', 'Failed', res.message || 'Could not save site');
      }
    });
  }

  function loadProjectSites() {
    if (!swr.get('listProjectSites:{}')) setSkel('projectsContainer', skelCards(3));
    apiSwr('listProjectSites', {}, {
      onData: res => {
        projectSites = (res && res.success && res.data) || [];
        displayProjectSites(projectSites);
      }
    });
  }

  function displayProjectSites(sites) {
    const html = sites.map(site => `
      <div class="project-zone">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px; gap:8px;">
          <div class="card-title">${site.name}</div>
          <div class="department-actions">
            <button class="action-icon edit-icon btn-edit-project" data-id="${site.id}" title="Edit"><i class="fas fa-edit"></i></button>
            <button class="action-icon delete-icon btn-delete-project" data-id="${site.id}" title="Delete"><i class="fas fa-trash"></i></button>
          </div>
        </div>
        <p style="color:#666; font-size:13px; margin-bottom:10px;">${site.description || ''}</p>
        <div class="project-info">
          <div><i class="fas fa-map-marker-alt" style="color:var(--navy-accent); width:18px;"></i> ${site.address}</div>
          <div><i class="fas fa-crosshairs" style="color:var(--navy-accent); width:18px;"></i> ${site.latitude.toFixed(6)}, ${site.longitude.toFixed(6)}</div>
          <div><i class="fas fa-ruler-combined" style="color:var(--navy-accent); width:18px;"></i> Radius: ${site.radius}m</div>
        </div>
      </div>`).join('');
    document.getElementById('projectsContainer').innerHTML = html;
  }

  function editProjectSite(id) {
    const site = projectSites.find(s => String(s.id) === String(id));
    if (site) showAddProjectModal(site);
  }

  function deleteProjectSite(id) {
    Swal.fire({
      title: 'Are you sure?',
      text: 'Do you want to delete this project site?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'Yes, delete it!'
    }).then(result => {
      if (!result.isConfirmed) return;
      showSpinner('Deleting...');
      api('deleteProjectSite', { id, actorId: currentUserId, actorUsername: currentUser }).then(res => {
        hideSpinner();
        if (res.success) {
          showPopup('success',
            'Deleted',
            'Project site has been deleted.');
          loadProjectSites();
        } else {
          showPopup('error', 'Failed', res.message || 'Could not delete');
        }
      });
    });
  }

  function loadAttendanceData() {
    const month = parseInt(document.getElementById('attendanceMonth').value, 10);
    const year  = parseInt(document.getElementById('attendanceYear').value, 10);
    const args = { month, year };
    if (!swr.get('listAttendance:' + JSON.stringify(args))) {
      destroyDataTable('attendanceTable');
      setSkel('attendanceTableBody', skelTableRows(9, 5));
    }
    apiSwr('listAttendance', args, {
      onData: res => displayAttendanceData((res && res.success && res.data) || [])
    });
  }

  function displayAttendanceData(data) {
    const thumb = url => url
      ? `<a href="${url}" target="_blank" rel="noopener" class="ms-1"><img src="${url}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;vertical-align:middle;border:1px solid #ddd;" title="View selfie" onerror="this.style.display='none'"></a>`
      : '';
    const badge = s => s === 'Late' ? 'bg-warning text-dark' : s === 'Absent' ? 'bg-danger' : s === 'Checked Out' ? 'bg-secondary' : 'bg-success';

    let html = '';
    data.forEach(item => {
      html += `
        <tr>
          <td data-label="Name">${item.name}</td>
          <td data-label="Department">${item.department}</td>
          <td data-label="Today"><span class="badge ${badge(item.todayStatus)}">${item.todayStatus}</span></td>
          <td data-label="Check In">${item.checkIn}${thumb(item.checkInPhotoUrl)}</td>
          <td data-label="Check Out">${item.checkOut}${thumb(item.checkOutPhotoUrl)}</td>
          <td data-label="Total Days">${item.totalDays}</td>
          <td data-label="Present">${item.present}</td>
          <td data-label="Absent">${item.absent}</td>
          <td data-label="Actions"><button class="btn btn-sm btn-info btn-view-att" data-in="${item.checkInPhotoUrl||''}" data-out="${item.checkOutPhotoUrl||''}" data-name="${(item.name||'').replace(/"/g,'&quot;')}">View</button></td>
        </tr>
      `;
    });

    document.getElementById('attendanceTableBody').innerHTML = html;
    initDataTable('attendanceTable', {
      columnDefs: [
        { targets: -1, orderable: false, searchable: false, className: 'text-center dt-no-export' }
      ]
    });
  }

  function viewAttendancePhotos(inUrl, outUrl, name) {
    const slot = (url, label) => url
      ? `<div class="text-center mx-2"><div class="fw-bold mb-1">${label}</div><a href="${url}" target="_blank"><img src="${url}" style="max-width:240px;max-height:320px;border-radius:8px;border:2px solid #6366f1;" onerror="this.replaceWith(Object.assign(document.createElement('div'),{textContent:'Image unavailable',className:'text-muted'}))"></a></div>`
      : `<div class="text-center mx-2"><div class="fw-bold mb-1">${label}</div><div class="text-muted" style="width:240px;padding:60px 0;border:1px dashed #ccc;border-radius:8px;">No selfie</div></div>`;
    Swal.fire({
      title: name,
      html: `<div class="d-flex justify-content-center flex-wrap">${slot(inUrl, 'Check In')}${slot(outUrl, 'Check Out')}</div>`,
      width: '600px',
      background: 'rgba(255,255,255,0.95)'
    });
  }

  function loadLeaveApplications() {
    if (!swr.get('listAllLeaves:{}')) {
      destroyDataTable('leavesTable');
      setSkel('leavesTableBody', skelTableRows(7, 4));
    }
    apiSwr('listAllLeaves', {}, {
      onData: res => displayLeaveApplications((res && res.success && res.data) || [])
    });
  }

  function displayLeaveApplications(leaves) {
    let html = '';
    leaves.forEach(leave => {
      const statusClass = leave.status === 'Approved' ? 'badge bg-success' :
                          leave.status === 'Rejected' ? 'badge bg-danger'  : 'badge bg-warning';
      const isPending = String(leave.status).toLowerCase() === 'pending';
      const id = escapeHtml(leave.id);

      html += `
        <tr>
          <td data-label="Employee">${escapeHtml(leave.employee)}</td>
          <td data-label="Type">${escapeHtml(leave.type)}</td>
          <td data-label="From">${escapeHtml(leave.from)}</td>
          <td data-label="To">${escapeHtml(leave.to)}</td>
          <td data-label="Days">${leave.days}</td>
          <td data-label="Status"><span class="${statusClass}">${escapeHtml(leave.status)}</span></td>
          <td data-label="Actions" style="white-space:nowrap;">
            <button class="action-icon btn-view-leave"   data-id="${id}" title="View"   style="color: var(--navy-accent);"><i class="fas fa-eye"></i></button>
            <button class="action-icon btn-print-leave"  data-id="${id}" title="Print"  style="color: var(--navy-primary);"><i class="fas fa-print"></i></button>
            ${isPending ? `
              <button class="action-icon btn-approve" data-id="${id}" title="Approve" style="color: var(--success);"><i class="fas fa-check-circle"></i></button>
              <button class="action-icon btn-reject"  data-id="${id}" title="Reject"  style="color: var(--danger);"><i class="fas fa-times-circle"></i></button>
              <button class="action-icon edit-icon btn-edit-leave" data-id="${id}" title="Edit"><i class="fas fa-edit"></i></button>
            ` : ''}
            <button class="action-icon delete-icon btn-delete-leave" data-id="${id}" title="Delete"><i class="fas fa-trash"></i></button>
          </td>
        </tr>
      `;
    });

    document.getElementById('leavesTableBody').innerHTML = html;
    initDataTable('leavesTable', {
      columnDefs: [
        { targets: -1, orderable: false, searchable: false, className: 'text-center dt-no-export' }
      ]
    });
  }

  // ─── Leave: view / print / edit / delete ─────────────────────
  let _editingLeaveId = null;
  let _lastLeaveData  = null;

  function viewLeaveDoc(leaveId, autoPrint) {
    api('getLeaveById', { leaveId, requesterUsername: currentUser }).then(res => {
      if (!res.success) { showPopup('error', 'Cannot Open', res.message); return; }
      if (autoPrint) printLeaveInNewWindow(res.data);
      else           openLeaveViewModal(res.data);
    });
  }

  function _capStr(s) { return s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : ''; }

  function buildLeaveDocHtml(d) {
    const today = new Date().toISOString().slice(0, 10);
    const status = String(d.status || 'pending').toLowerCase();
    const statusBadge = ({
      approved: '<span style="color:#1a8a3a; font-weight:700;">APPROVED</span>',
      rejected: '<span style="color:#c1272d; font-weight:700;">REJECTED</span>',
      pending:  '<span style="color:#b8860b; font-weight:700;">PENDING</span>'
    })[status] || '—';
    const reviewedDate = d.reviewedAt ? String(d.reviewedAt).slice(0, 10) : '____________';

    return ''
      + '<div class="leave-doc">'
      +   '<div class="leave-doc-header">'
      +     (d.companyLogoUrl ? '<img src="' + escapeHtml(d.companyLogoUrl) + '" alt="Logo" class="leave-doc-logo">' : '')
      +     '<h1>' + escapeHtml(d.companyName || 'Company') + '</h1>'
      +     '<h2>Leave Application</h2>'
      +   '</div>'

      +   '<div class="leave-doc-meta">'
      +     '<div><strong>Date:</strong> ' + escapeHtml(String(d.appliedAt || today).slice(0, 10)) + '</div>'
      +     '<div><strong>Application No.:</strong> ' + escapeHtml(d.id || '') + '</div>'
      +   '</div>'

      +   '<div class="leave-doc-to"><strong>To,</strong><br>The HR Manager,<br>' + escapeHtml(d.companyName || 'Company') + '</div>'

      +   '<div class="leave-doc-subject"><strong>Subject:</strong> Application for ' + escapeHtml(_capStr(d.type)) + ' Leave</div>'

      +   '<div>Respected Sir/Madam,</div>'

      +   '<p class="leave-doc-body-text">'
      +     'I, <strong>' + escapeHtml(d.employee.fullName) + '</strong>, working as <strong>' + escapeHtml(d.employee.position || '—')
      +     '</strong> in the <strong>' + escapeHtml(d.employee.department || '—')
      +     '</strong> department, would like to request <strong>' + escapeHtml(_capStr(d.type)) + ' Leave</strong> '
      +     'from <strong>' + escapeHtml(d.fromDate) + '</strong> to <strong>' + escapeHtml(d.toDate) + '</strong>, '
      +     'totaling <strong>' + d.days + ' day' + (d.days === 1 ? '' : 's') + '</strong>.'
      +   '</p>'

      +   '<p class="leave-doc-body-text"><strong>Reason:</strong> ' + escapeHtml(d.reason || '—') + '</p>'

      +   '<p class="leave-doc-body-text">I will ensure that all my pending tasks are handed over before my leave begins. Kindly approve my application.</p>'

      +   '<p class="leave-doc-body-text">Thank you for your kind consideration.</p>'

      +   '<div class="leave-doc-sign">'
      +     '<div>Yours sincerely,</div>'
      +     '<div class="leave-doc-sign-line">_____________________________</div>'
      +     '<div><strong>' + escapeHtml(d.employee.fullName) + '</strong></div>'
      +     '<div>' + escapeHtml(d.employee.position || '') + '</div>'
      +     '<div>' + escapeHtml(d.employee.username) + '</div>'
      +   '</div>'

      +   '<div class="leave-doc-hr">'
      +     '<div class="leave-doc-hr-title">For HR / Manager Use Only</div>'
      +     '<table>'
      +       '<tr><td>Status</td><td>' + statusBadge + '</td></tr>'
      +       '<tr><td>Reviewed By</td><td>' + escapeHtml(d.reviewedBy || '____________') + '</td></tr>'
      +       '<tr><td>Date</td><td>' + escapeHtml(reviewedDate) + '</td></tr>'
      +       '<tr><td>Notes</td><td>' + escapeHtml(d.reviewNotes || '—') + '</td></tr>'
      +     '</table>'
      +     '<div class="leave-doc-sign-line" style="margin-top:36px;">_____________________________</div>'
      +     '<div>Authorized Signature</div>'
      +   '</div>'
      + '</div>';
  }

  function openLeaveViewModal(d) {
    let modal = document.getElementById('leaveViewModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'leaveViewModal';
      modal.className = 'leave-view-modal';
      modal.innerHTML =
        '<div class="leave-view-shell">'
        +   '<div class="leave-view-toolbar">'
        +     '<button class="btn btn-primary"   id="leaveViewPrintBtn"><i class="fas fa-print"></i> Print A4</button>'
        +     '<button class="btn btn-secondary" id="leaveViewCloseBtn"><i class="fas fa-times"></i> Close</button>'
        +   '</div>'
        +   '<div class="leave-view-content"></div>'
        + '</div>';
      document.body.appendChild(modal);
      modal.querySelector('#leaveViewCloseBtn').addEventListener('click', closeLeaveViewModal);
      modal.querySelector('#leaveViewPrintBtn').addEventListener('click', () => printLeaveInNewWindow(_lastLeaveData));
      modal.addEventListener('click', e => { if (e.target === modal) closeLeaveViewModal(); });
    }
    _lastLeaveData = d;
    modal.querySelector('.leave-view-content').innerHTML = buildLeaveDocHtml(d);
    modal.classList.add('show');
  }

  function closeLeaveViewModal() {
    const modal = document.getElementById('leaveViewModal');
    if (modal) modal.classList.remove('show');
  }

  // open a fresh window with just the leave doc and trigger print — keeps the main page clean
  function printLeaveInNewWindow(d) {
    if (!d) return;
    const docHtml = buildLeaveDocHtml(d);
    const css = ''
      + '@page { size: A4; margin: 14mm; }'
      + 'body { font-family: "Times New Roman", Times, serif; color: #000; line-height: 1.6; font-size: 12pt; margin: 0; padding: 0; }'
      + '.leave-doc { padding: 0; max-width: 100%; min-height: auto; }'
      + '.leave-doc-header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 22px; }'
      + '.leave-doc-header h1 { font-size: 22pt; margin: 6px 0 4px; font-weight: 700; }'
      + '.leave-doc-header h2 { font-size: 14pt; margin: 0; text-transform: uppercase; letter-spacing: 3px; font-weight: 700; color: #333; }'
      + '.leave-doc-logo { max-height: 64px; max-width: 120px; object-fit: contain; margin-bottom: 6px; }'
      + '.leave-doc-meta { display: flex; justify-content: space-between; margin-bottom: 22px; font-size: 11pt; }'
      + '.leave-doc-to { margin-bottom: 18px; }'
      + '.leave-doc-subject { margin-bottom: 18px; padding-bottom: 4px; border-bottom: 1px solid #444; }'
      + '.leave-doc-body-text { margin: 12px 0; text-align: justify; text-indent: 30px; }'
      + '.leave-doc-sign { margin-top: 36px; }'
      + '.leave-doc-sign-line { margin-top: 50px; margin-bottom: 4px; }'
      + '.leave-doc-hr { margin-top: 40px; border-top: 2px solid #000; padding-top: 16px; }'
      + '.leave-doc-hr-title { text-align: center; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 14px; }'
      + '.leave-doc-hr table { width: 100%; border-collapse: collapse; font-size: 11pt; }'
      + '.leave-doc-hr table td { padding: 6px 8px; border: 1px solid #000; }'
      + '.leave-doc-hr table td:first-child { background: #f0f0f0; font-weight: 600; width: 28%; }';
    const win = window.open('', '_blank', 'width=900,height=1000');
    if (!win) { showPopup('error', 'Popup Blocked', 'Allow popups for this site to print.'); return; }
    win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Leave Application — ' + escapeHtml(d.employee.fullName) + '</title><style>' + css + '</style></head><body>' + docHtml + '</body></html>');
    win.document.close();
    win.focus();
    setTimeout(() => { try { win.print(); } catch (_) {} }, 300);
  }

  function openEditLeaveModal(leaveId) {
    api('getLeaveById', { leaveId, requesterUsername: currentUser }).then(res => {
      if (!res.success) { showPopup('error', 'Cannot Edit', res.message); return; }
      const d = res.data;
      if (String(d.status).toLowerCase() !== 'pending') {
        showPopup('warning', 'Cannot Edit', 'Only pending leaves can be edited.');
        return;
      }
      document.getElementById('leaveType').value   = d.type;
      document.getElementById('fromDate').value    = d.fromDate;
      document.getElementById('toDate').value      = d.toDate;
      document.getElementById('leaveReason').value = d.reason || '';
      _editingLeaveId = leaveId;
      document.getElementById('leaveRequestModalTitle').textContent = 'Edit Leave Request';
      document.getElementById('submitLeaveBtn').innerHTML = '<i class="fas fa-save"></i> Update Request';
      new bootstrap.Modal(document.getElementById('leaveRequestModal')).show();
    });
  }

  function deleteLeaveRecord(leaveId) {
    cpop.fire({
      icon: 'warning',
      title: 'Delete Leave?',
      text: 'This cannot be undone.',
      showCancelButton: true,
      confirmButtonText: 'Delete',
      cancelButtonText: 'Cancel'
    }).then(c => {
      if (!c.isConfirmed) return;
      api('deleteLeave', { leaveId, actorId: currentUserId, actorUsername: currentUser }).then(res => {
        if (!res.success) { showPopup('error', 'Failed', res.message); return; }
        showPopup('success', 'Deleted', 'Leave application removed.');
        loadLeaveApplications();
      });
    });
  }

  // ─── DataTables helper: 10/page, CSV/PDF/Print, responsive, search ───
  function initDataTable(tableId, opts) {
    if (!window.$ || !$.fn || !$.fn.DataTable) return null; // CDN not loaded
    const sel = '#' + tableId;
    if ($.fn.dataTable.isDataTable(sel)) {
      $(sel).DataTable().clear().destroy();
    }
    return $(sel).DataTable(Object.assign({
      pageLength: 10,
      lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, 'All']],
      responsive: true,
      autoWidth: false,
      order: [],
      dom: "<'dt-toolbar'<'dt-btns'B><'dt-search'f>>rt<'dt-foot'<'dt-len'l><'dt-info'i><'dt-page'p>>",
      buttons: [
        { extend: 'csv',   text: '<i class="fas fa-file-csv"></i> CSV',   className: 'btn btn-sm btn-success', exportOptions: { columns: ':not(.dt-no-export)' } },
        { extend: 'pdf',   text: '<i class="fas fa-file-pdf"></i> PDF',   className: 'btn btn-sm btn-danger',  exportOptions: { columns: ':not(.dt-no-export)' } },
        { extend: 'print', text: '<i class="fas fa-print"></i> Print',    className: 'btn btn-sm btn-info',    exportOptions: { columns: ':not(.dt-no-export)' } }
      ],
      language: { searchPlaceholder: 'Search...', search: '', lengthMenu: '_MENU_ rows', info: '_START_–_END_ of _TOTAL_', infoEmpty: '0 rows', emptyTable: 'No data' }
    }, opts || {}));
  }

  function destroyDataTable(tableId) {
    const sel = '#' + tableId;
    if (window.$ && $.fn && $.fn.dataTable && $.fn.dataTable.isDataTable(sel)) {
      $(sel).DataTable().clear().destroy();
    }
  }

  // ─── Payroll: hourly rates table (admin) ───
  let _ratesData = []; // last-fetched rates for diff/comparison
  let _payCurrency = 'Rs.';
  let _ratesFileInput = null;

  function loadHourlyRates() {
    const tbody = document.getElementById('ratesTableBody');
    if (!tbody) return;
    const ratesCached = swr.get('listHourlyRates:{}');
    if (!ratesCached) {
      destroyDataTable('ratesTable');
      tbody.innerHTML = skelTableRows(6, 6);
    }
    // SWR both calls in parallel — currency from settings is small + cached separately
    apiSwr('listHourlyRates', {}, {
      onData: res => {
        _ratesData = (res && res.success && res.data) || [];
        renderHourlyRates();
      }
    });
    apiSwr('getSettings', {}, {
      onData: res => {
        if (res && res.data && res.data.currency) {
          _payCurrency = res.data.currency;
          if (_ratesData.length) renderHourlyRates(); // re-render currency prefix
        }
      }
    });
  }

  function renderHourlyRates() {
    const tbody = document.getElementById('ratesTableBody');
    destroyDataTable('ratesTable');
    if (!_ratesData.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:24px; color:#999;"><i class="fas fa-users-slash"></i> No employees yet</td></tr>';
      return;
    }
    tbody.innerHTML = _ratesData.map(r => `
      <tr>
        <td data-label="Name"><strong>${escapeHtml(r.fullName)}</strong></td>
        <td data-label="Department">${escapeHtml(r.department)}</td>
        <td data-label="Position">${escapeHtml(r.position)}</td>
        <td data-label="Role"><span class="badge" style="background:var(--navy-accent); color:#fff; padding:3px 8px; border-radius:4px; font-size:11px; text-transform:capitalize;">${escapeHtml(r.role)}</span></td>
        <td data-label="Hourly Rate" data-order="${r.hourlyRate}" data-search="${r.hourlyRate}">
          <div class="rate-cell">
            <span class="rate-currency">${escapeHtml(_payCurrency)}</span>
            <input type="number" class="rate-input" min="0" step="0.01" data-username="${escapeHtml(r.username)}" data-original="${r.hourlyRate}" value="${r.hourlyRate}" />
          </div>
        </td>
        <td data-label="Action" class="dt-no-export">
          <button class="btn btn-sm btn-primary btn-save-rate" data-username="${escapeHtml(r.username)}"><i class="fas fa-save"></i> Save</button>
        </td>
      </tr>
    `).join('');

    // export formatter: pull current input value for the rate column instead of the input HTML
    const ratesExportFormat = {
      body: function (data, row, col, node) {
        if (!node) return data;
        const inp = node.querySelector && node.querySelector('input.rate-input');
        if (inp) return inp.value;
        return (node.textContent || '').trim();
      }
    };

    initDataTable('ratesTable', {
      columnDefs: [
        { targets: 4, orderable: true,  className: 'text-end' }, // Hourly Rate (sorted via data-order)
        { targets: 5, orderable: false, searchable: false, className: 'text-center dt-no-export' }
      ],
      buttons: [
        { extend: 'csv',   text: '<i class="fas fa-file-csv"></i> CSV',   className: 'btn btn-sm btn-success', exportOptions: { columns: ':not(.dt-no-export)', format: ratesExportFormat } },
        { extend: 'pdf',   text: '<i class="fas fa-file-pdf"></i> PDF',   className: 'btn btn-sm btn-danger',  exportOptions: { columns: ':not(.dt-no-export)', format: ratesExportFormat }, title: 'Hourly Rates' },
        { extend: 'print', text: '<i class="fas fa-print"></i> Print',   className: 'btn btn-sm btn-info',    exportOptions: { columns: ':not(.dt-no-export)', format: ratesExportFormat }, title: 'Hourly Rates' },
        { text: '<i class="fas fa-file-import"></i> Import CSV', className: 'btn btn-sm btn-warning', action: function () { triggerRatesImport(); } }
      ]
    });
  }

  // ── CSV import for hourly rates (admin only) ─────────────────
  function triggerRatesImport() {
    if (!_ratesFileInput) {
      _ratesFileInput = document.createElement('input');
      _ratesFileInput.type = 'file';
      _ratesFileInput.accept = '.csv,text/csv';
      _ratesFileInput.style.display = 'none';
      _ratesFileInput.addEventListener('change', e => {
        const f = e.target.files && e.target.files[0];
        e.target.value = ''; // reset so picking the same file again still fires
        if (f) handleRatesImport(f);
      });
      document.body.appendChild(_ratesFileInput);
    }
    _ratesFileInput.click();
  }

  function handleRatesImport(file) {
    const reader = new FileReader();
    reader.onload = e => {
      let parsed;
      try { parsed = parseRatesCsv(e.target.result); }
      catch (err) { showPopup('error', 'Parse Error', err.message); return; }
      if (!parsed.length) { showPopup('warning', 'Empty CSV', 'No valid rows found.'); return; }

      Swal.fire({
        title: 'Import Hourly Rates',
        html: '<p>Found <strong>' + parsed.length + '</strong> rows.</p>'
            + '<p style="font-size:13px; color:#555;">Existing rates for matching usernames will be replaced. Unknown usernames will be skipped.</p>',
        icon: 'question',
        showCancelButton: true,
        confirmButtonText: '<i class="fas fa-check"></i> Import',
        cancelButtonText: 'Cancel'
      }).then(c => {
        if (!c.isConfirmed) return;
        api('bulkImportRates', { rows: parsed, actorId: currentUserId, actorUsername: currentUser }).then(r => {
          if (!r.success) { showPopup('error', 'Import Failed', r.message); return; }
          const skippedHtml = r.skipped
            ? '<p style="color:#d33; margin-top:8px;"><strong>' + r.skipped + '</strong> skipped — usernames not found.</p>'
            : '';
          Swal.fire({
            icon: 'success',
            title: 'Import Complete',
            html: '<p><strong>' + r.updated + '</strong> rates updated of ' + r.total + ' rows.</p>' + skippedHtml
          });
          loadHourlyRates();
        });
      });
    };
    reader.readAsText(file);
  }

  // RFC-4180-ish CSV parser — handles quoted fields w/ commas + escaped quotes
  function parseRatesCsv(text) {
    const rows = []; let i = 0, inQuote = false, field = '', row = [];
    const push = () => { row.push(field); field = ''; };
    const eol  = () => { push(); rows.push(row); row = []; };
    while (i < text.length) {
      const c = text[i];
      if (inQuote) {
        if (c === '"' && text[i+1] === '"') { field += '"'; i += 2; continue; }
        if (c === '"') { inQuote = false; i++; continue; }
        field += c; i++; continue;
      }
      if (c === '"')  { inQuote = true; i++; continue; }
      if (c === ',')  { push(); i++; continue; }
      if (c === '\n') { eol();  i++; continue; }
      if (c === '\r') { i++; continue; }
      field += c; i++;
    }
    if (field.length || row.length) eol();
    while (rows.length && rows[rows.length-1].every(c => !c.trim())) rows.pop();
    if (rows.length < 2) throw new Error('CSV needs a header row + at least one data row');

    const header = rows[0].map(s => s.trim().toLowerCase());
    const userIdx = header.findIndex(h => /^(user|username|emp|employee)$/.test(h));
    const rateIdx = header.findIndex(h => /^(rate|hourly|hourlyrate|hourly_rate|amount)$/.test(h));
    if (userIdx < 0 || rateIdx < 0) throw new Error('CSV must have "username" and "rate" columns (case-insensitive)');

    return rows.slice(1).map(r => ({
      username: (r[userIdx] || '').trim(),
      rate: Number(String(r[rateIdx] || '').replace(/[^\d.\-]/g, ''))
    })).filter(r => r.username);
  }

  function saveHourlyRate(username, btn) {
    const input = document.querySelector('.rate-input[data-username="' + cssEscape(username) + '"]');
    if (!input) return;
    const rate = Number(input.value);
    if (isNaN(rate) || rate < 0) {
      showPopup('error', 'Invalid Rate', 'Rate must be a non-negative number');
      return;
    }
    const orig = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
    api('updateHourlyRate', { username, rate, actorId: currentUserId, actorUsername: currentUser }).then(res => {
      if (btn) { btn.disabled = false; btn.innerHTML = orig || '<i class="fas fa-save"></i> Save'; }
      if (!res.success) {
        showPopup('error', 'Failed', res.message || 'Could not update rate');
        return;
      }
      input.dataset.original = String(rate);
      input.classList.remove('dirty');
      if (typeof Swal !== 'undefined') {
        Swal.fire({ icon: 'success', title: 'Rate Saved', toast: true, position: 'top-end', timer: 1600, showConfirmButton: false, timerProgressBar: true });
      }
    });
  }

  // ─── Payroll: generator + printable doc (admin + manager) ───
  let _payrollData = null;

  function initPayrollSection() {
    // populate year dropdown if empty (current year - 2 → current year)
    const yearSel = document.getElementById('payrollYear');
    if (yearSel && !yearSel.options.length) {
      const yr = new Date().getFullYear();
      for (let y = yr - 2; y <= yr; y++) {
        const opt = document.createElement('option');
        opt.value = String(y); opt.textContent = String(y);
        if (y === yr) opt.selected = true;
        yearSel.appendChild(opt);
      }
    }
    // default month = current month
    const monthSel = document.getElementById('payrollMonth');
    if (monthSel) monthSel.value = String(new Date().getMonth());

    // populate employees scoped to role (admin → all, manager → own dept)
    api('getPayrollEmployees', { requesterUsername: currentUser }).then(res => {
      const list = (res.success && res.data) || [];
      const sel = document.getElementById('payrollEmployee');
      if (!sel) return;
      sel.innerHTML = list.length
        ? list.map(e => '<option value="' + escapeHtml(e.username) + '">' + escapeHtml(e.fullName) + ' — ' + escapeHtml(e.department) + '</option>').join('')
        : '<option value="">No employees available</option>';
    });

    // pull currency from settings (used by both rates UI and payroll doc)
    api('getSettings').then(res => {
      if (res && res.data && res.data.currency) _payCurrency = res.data.currency;
    });
  }

  function generatePayroll() {
    const username = document.getElementById('payrollEmployee').value;
    const year     = Number(document.getElementById('payrollYear').value);
    const month    = Number(document.getElementById('payrollMonth').value);
    if (!username) { showPopup('warning', 'Select Employee', 'Pick an employee first.'); return; }
    const btn = document.getElementById('generatePayrollBtn');
    const orig = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
    api('getPayroll', { username, year, month, requesterUsername: currentUser }).then(res => {
      btn.disabled = false; btn.innerHTML = orig;
      if (!res.success) { showPopup('error', 'Failed', res.message || 'Could not generate payroll'); return; }
      _payrollData = res.data;
      renderPayrollDoc(_payrollData);
      document.getElementById('printPayrollBtn').disabled = false;
    });
  }

  function renderPayrollDoc(d) {
    const empty = document.getElementById('payrollEmpty');
    const cont  = document.getElementById('payrollContent');
    if (empty) empty.style.display = 'none';
    cont.style.display = 'block';

    const cur = d.currency || 'Rs.';
    _payCurrency = cur;
    const fmt = n => Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const capStatus = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '—';

    const rows = !d.days.length
      ? '<tr><td colspan="7" style="text-align:center; padding:18px; color:#888;">No attendance records for this period</td></tr>'
      : d.days.map((day, i) => {
          const cls = (day.checkOut === '—' && day.checkIn !== '—') ? 'row-no-checkout'
                    : (day.status === 'late') ? 'row-late' : '';
          return '<tr class="' + cls + '">'
            + '<td class="num">' + (i + 1) + '</td>'
            + '<td>' + escapeHtml(day.date) + '</td>'
            + '<td class="center">' + escapeHtml(day.checkIn) + '</td>'
            + '<td class="center">' + escapeHtml(day.checkOut) + '</td>'
            + '<td class="num">' + day.hours.toFixed(2) + '</td>'
            + '<td class="center">' + escapeHtml(capStatus(day.status)) + '</td>'
            + '<td class="num">' + fmt(day.earnings) + '</td>'
            + '</tr>';
        }).join('');

    cont.innerHTML =
      '<div class="payroll-doc">'
      + '<div class="payroll-doc-header">'
      +   '<h1>' + escapeHtml(d.companyName) + '</h1>'
      +   '<h2>Payroll Statement</h2>'
      +   '<div class="payroll-period">' + escapeHtml(d.period.label) + ' &nbsp;·&nbsp; ' + escapeHtml(d.period.start) + ' to ' + escapeHtml(d.period.end) + '</div>'
      + '</div>'
      + '<table class="meta">'
      +   '<tr><td class="label">Employee</td><td>' + escapeHtml(d.employee.fullName) + '</td>'
      +       '<td class="label">Position</td><td>' + escapeHtml(d.employee.position) + '</td></tr>'
      +   '<tr><td class="label">Department</td><td>' + escapeHtml(d.employee.department) + '</td>'
      +       '<td class="label">Hourly Rate</td><td>' + cur + ' ' + fmt(d.employee.hourlyRate) + '</td></tr>'
      +   '<tr><td class="label">Username</td><td>' + escapeHtml(d.employee.username) + '</td>'
      +       '<td class="label">Generated</td><td>' + escapeHtml((d.generatedAt || '').slice(0, 19).replace('T', ' ')) + '</td></tr>'
      + '</table>'
      + '<table class="days">'
      +   '<thead><tr>'
      +     '<th class="num" style="width:32px;">#</th>'
      +     '<th style="width:88px;">Date</th>'
      +     '<th class="center" style="width:78px;">Check In</th>'
      +     '<th class="center" style="width:78px;">Check Out</th>'
      +     '<th class="num" style="width:60px;">Hours</th>'
      +     '<th class="center" style="width:74px;">Status</th>'
      +     '<th class="num">Earnings (' + cur + ')</th>'
      +   '</tr></thead>'
      +   '<tbody>' + rows + '</tbody>'
      +   '<tfoot><tr>'
      +     '<td colspan="4" style="text-align:right;">Totals →</td>'
      +     '<td class="num">' + d.totals.totalHours.toFixed(2) + '</td>'
      +     '<td class="center">' + d.totals.totalDays + ' day' + (d.totals.totalDays === 1 ? '' : 's') + '</td>'
      +     '<td class="num">' + fmt(d.totals.totalEarnings) + '</td>'
      +   '</tr></tfoot>'
      + '</table>'
      + '<div class="payroll-summary-grid">'
      +   '<div class="cell"><span class="lbl">Working Days (Mon–Sat)</span><span class="val">' + (d.totals.workingDays || 0) + '</span></div>'
      +   '<div class="cell"><span class="lbl">Present Days</span><span class="val">' + d.totals.presentDays + '</span></div>'
      +   '<div class="cell"><span class="lbl">Late Days</span><span class="val">' + d.totals.lateDays + '</span></div>'
      +   '<div class="cell"><span class="lbl">Absent Days</span><span class="val">' + (d.totals.absentDays || 0) + '</span></div>'
      +   '<div class="cell"><span class="lbl">Total Hours</span><span class="val">' + d.totals.totalHours.toFixed(2) + '</span></div>'
      +   '<div class="cell"><span class="lbl">Hourly Rate</span><span class="val">' + cur + ' ' + fmt(d.employee.hourlyRate) + '</span></div>'
      +   '<div class="cell"><span class="lbl">Gross Earnings</span><span class="val">' + cur + ' ' + fmt(d.totals.grossEarnings || d.totals.totalEarnings) + '</span></div>'
      +   '<div class="cell"><span class="lbl">Late Penalty (' + d.totals.lateDays + ' × ' + cur + ' ' + fmt(d.totals.latePenaltyPerDay || 0) + ')</span><span class="val" style="color:#c1272d;">- ' + cur + ' ' + fmt(d.totals.latePenalty || 0) + '</span></div>'
      +   '<div class="cell"><span class="lbl">Leave Fine (' + (d.totals.absentDays || 0) + ' × ' + cur + ' ' + fmt(d.totals.leaveFinePerDay || 0) + ')</span><span class="val" style="color:#c1272d;">- ' + cur + ' ' + fmt(d.totals.leaveFine || 0) + '</span></div>'
      +   '<div class="cell grand"><span class="lbl">NET PAYABLE</span><span class="val">' + cur + ' ' + fmt(d.totals.netEarnings != null ? d.totals.netEarnings : d.totals.totalEarnings) + '</span></div>'
      + '</div>'
      + '<div class="payroll-signatures">'
      +   '<div class="sig"><div class="line"></div><div class="label">Employee Signature</div></div>'
      +   '<div class="sig"><div class="line"></div><div class="label">Authorized Signature</div></div>'
      + '</div>'
      + '<div class="payroll-doc-footer">This is a computer-generated payroll statement.</div>'
      + '</div>';
  }

  function printPayroll() {
    if (!_payrollData) { showPopup('warning', 'Nothing to Print', 'Generate a payroll first.'); return; }
    window.print();
  }

  // ─── My Profile (self-update: name, image, pwd) ─────────────
  function loadMyProfile() {
    document.getElementById('profileUsername').value = currentUser || '';
    document.getElementById('profileFullName').value = currentFullName || '';
    document.getElementById('profilePosition').value = ''; // populated from getEmployeeByUsername
    document.getElementById('profileOldPwd').value = '';
    document.getElementById('profileNewPwd').value = '';

    api('getEmployeeByUsername', { username: currentUser }).then(res => {
      if (res && res.success && res.data) {
        const u = res.data;
        document.getElementById('profileFullName').value = u.fullName || '';
        document.getElementById('profilePosition').value = u.position || '';
        const img = u.profileImage || '';
        const imgEl = document.getElementById('profilePhotoPreview');
        const emptyEl = document.getElementById('profilePhotoEmpty');
        if (img) {
          imgEl.src = img; imgEl.style.display = 'block'; emptyEl.style.display = 'none';
        } else {
          imgEl.style.display = 'none'; emptyEl.style.display = 'flex';
          emptyEl.textContent = (u.fullName || '?').charAt(0).toUpperCase();
        }
      }
    });
  }

  let _profileImageBase64 = '';
  function pickProfileImage() {
    document.getElementById('profileImageInput').click();
  }
  function onProfileImagePicked(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      _profileImageBase64 = e.target.result;
      const imgEl = document.getElementById('profilePhotoPreview');
      imgEl.src = _profileImageBase64;
      imgEl.style.display = 'block';
      document.getElementById('profilePhotoEmpty').style.display = 'none';
    };
    reader.readAsDataURL(file);
  }
  function saveMyProfile() {
    const fullName = document.getElementById('profileFullName').value.trim();
    const oldPwd = document.getElementById('profileOldPwd').value;
    const newPwd = document.getElementById('profileNewPwd').value;
    if (!fullName) { showPopup('warning', 'Name Required', 'Full name cannot be empty.'); return; }
    if (newPwd && newPwd.length < 6) { showPopup('warning', 'Weak Password', 'New password must be at least 6 characters.'); return; }

    const btn = document.getElementById('saveProfileBtn');
    const orig = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    api('updateMyProfile', {
      username: currentUser,
      fullName,
      profileImageBase64: _profileImageBase64 || '',
      oldPassword: oldPwd,
      newPassword: newPwd
    }).then(res => {
      btn.disabled = false; btn.innerHTML = orig;
      if (!res.success) { showPopup('error', 'Update Failed', res.message); return; }
      currentFullName = res.fullName || fullName;
      document.getElementById('sidebarUserName').textContent = currentFullName;
      const av = document.getElementById('sidebarAvatar');
      if (av) av.textContent = (currentFullName || '?').charAt(0).toUpperCase();
      _profileImageBase64 = '';
      document.getElementById('profileOldPwd').value = '';
      document.getElementById('profileNewPwd').value = '';
      showPopup('success', 'Profile Updated', 'Your changes have been saved.');
    });
  }

  // ─── Admin branding + payroll-rule settings ─────────────────
  let _logoBase64 = '';
  function loadAdminBrandingSettings() {
    if (currentRole !== 'admin') return;
    api('getSettings').then(res => {
      const s = (res && res.data) || {};
      document.getElementById('setCompanyName').value  = s.companyName        || 'Rameez Scripts';
      document.getElementById('setCurrency').value     = s.currency           || 'Rs.';
      document.getElementById('setLatePenalty').value  = s.latePenaltyPerDay  || '0';
      document.getElementById('setLeaveFine').value    = s.leaveFinePerDay    || '0';
      const url = s.companyLogoUrl || '';
      const img = document.getElementById('logoPreview');
      const empty = document.getElementById('logoPreviewEmpty');
      if (url) { img.src = url; img.style.display = 'block'; empty.style.display = 'none'; }
      else     { img.style.display = 'none'; empty.style.display = 'flex'; }
    });
  }
  function pickLogo() {
    document.getElementById('logoFileInput').click();
  }
  function onLogoPicked(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      _logoBase64 = e.target.result;
      const img = document.getElementById('logoPreview');
      img.src = _logoBase64; img.style.display = 'block';
      document.getElementById('logoPreviewEmpty').style.display = 'none';
      document.getElementById('logoFileName').textContent = file.name;
      document.getElementById('saveLogoBtn').disabled = false;
    };
    reader.readAsDataURL(file);
  }
  function saveLogo() {
    if (!_logoBase64) return;
    const btn = document.getElementById('saveLogoBtn');
    const orig = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    api('uploadLogo', { base64: _logoBase64, actorId: currentUserId, actorUsername: currentUser }).then(res => {
      btn.innerHTML = orig;
      if (!res.success) { btn.disabled = false; showPopup('error', 'Upload Failed', res.message); return; }
      _logoBase64 = '';
      applyCompanyLogo(res.url);
      showPopup('success', 'Logo Updated', 'Login + sidebar now show the new logo.');
    });
  }
  function savePayrollSettings() {
    const name    = document.getElementById('setCompanyName').value.trim() || 'Rameez Scripts';
    const cur     = document.getElementById('setCurrency').value.trim() || 'Rs.';
    const late    = String(Math.max(0, Number(document.getElementById('setLatePenalty').value) || 0));
    const leaveF  = String(Math.max(0, Number(document.getElementById('setLeaveFine').value)   || 0));
    const btn = document.getElementById('savePayrollSettingsBtn');
    const orig = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    Promise.all([
      api('updateSetting', { key: 'companyName',       value: name,   actorId: currentUserId, actorUsername: currentUser }),
      api('updateSetting', { key: 'currency',          value: cur,    actorId: currentUserId, actorUsername: currentUser }),
      api('updateSetting', { key: 'latePenaltyPerDay', value: late,   actorId: currentUserId, actorUsername: currentUser }),
      api('updateSetting', { key: 'leaveFinePerDay',   value: leaveF, actorId: currentUserId, actorUsername: currentUser })
    ]).then(rs => {
      btn.disabled = false; btn.innerHTML = orig;
      const failed = rs.find(r => !r.success);
      if (failed) { showPopup('error', 'Save Failed', failed.message || 'Could not save'); return; }
      _payCurrency = cur;
      applyCompanyName(name); // live-update sidebar + About without reload
      showPopup('success', 'Settings Saved', name + ' · ' + cur + ' · Late: ' + late + ' · Leave fine: ' + leaveF);
    });
  }

  // apply company name to sidebar brand + About header
  function applyCompanyName(name) {
    const safe = name && String(name).trim() ? String(name).trim() : 'Rameez Scripts';
    const sb = document.getElementById('companyName');
    const ab = document.getElementById('aboutCompanyName');
    if (sb) sb.textContent = safe;
    if (ab) ab.textContent = safe;
  }

  // apply logo URL to login screen + sidebar brand
  function applyCompanyLogo(url) {
    const loginLogo = document.getElementById('loginLogo');
    const brand = document.querySelector('.sidebar-brand');
    if (loginLogo && url) loginLogo.src = url;
    if (brand) {
      // replace the FA icon with an <img> when a logo is set; keep brand text
      const existingImg = brand.querySelector('img.sb-brand-img');
      if (url) {
        if (existingImg) existingImg.src = url;
        else {
          const i = brand.querySelector('i');
          if (i) i.remove();
          const im = document.createElement('img');
          im.className = 'sb-brand-img';
          im.src = url;
          im.alt = 'Logo';
          im.style.cssText = 'width:32px; height:32px; border-radius:6px; object-fit:cover;';
          brand.insertBefore(im, brand.firstChild);
        }
      }
    }
    // also update the preview in admin settings if it's open
    const previewImg = document.getElementById('logoPreview');
    const previewEmpty = document.getElementById('logoPreviewEmpty');
    if (previewImg && url) { previewImg.src = url; previewImg.style.display = 'block'; if (previewEmpty) previewEmpty.style.display = 'none'; }
  }

  // small html-escape + CSS.escape fallback (rate-input data-username may contain quotes)
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function cssEscape(s) {
    return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/(["\\])/g, '\\$1');
  }

  // Initialize real-time stats
  setInterval(updateRealTimeStats, 10000);
  updateRealTimeStats();

  // Public API
  return {
    init: init,
    approveLeave: approveLeave,
    rejectLeave: rejectLeave,
    editDepartment: editDepartment,
    deleteDepartment: deleteDepartment,
    editProjectSite: editProjectSite,
    deleteProjectSite: deleteProjectSite,
    editEmployee: editEmployee,
    deleteEmployee: deleteEmployee
  };
})();

// Initialize after index.html has loaded the app shell partial.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() {
    AttendanceSystem.init();
  });
} else {
  AttendanceSystem.init();
}
