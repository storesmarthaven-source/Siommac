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
  let liveMarkers = []; // leaflet markers for active employees on the live map
  let liveData    = []; // last-fetched live attendance rows (for sidebar panel + map sync)
  let _isSyncing = false; // when true, suppress skeleton injection (background refresh shouldn't flash)

  // ─── Session (1-hour timeout) ───
  // frontend-driven session: payload + expiresAt in localStorage. auto-restore on reload, auto-logout at expiry.
  const SESSION_KEY      = 'siomac_session_v1';
  const SESSION_DURATION = 60 * 60 * 1000; // 1 hour
  const SESSION_WARN_AT  = 5  * 60 * 1000; // warn 5 min before expiry
  let _sessExpTimer  = null; // auto-logout timer
  let _sessWarnTimer = null; // 5-min warning timer
  let _sessTickTimer = null; // 30s tick for sidebar countdown
  let _sessWarned    = false; // prevent duplicate warnings

  const CONFIG = {
    WORKING_HOURS: { start: 6, end: 22 },
    MAX_DISTANCE: 200
  };

  // Translation dictionary
  const translations = {
    en: {
      companyName: "My Company",
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

  const { SECTION_DEFS, COMMON_ITEMS, PALETTES, LAYOUTS } = window.SiomacConfig;
  const ABOUT_ITEM = COMMON_ITEMS[1];

  // Utility functions — all popups go through the custom cpop module (no SweetAlert2)
  const showSpinner = (msg) => cpop.fire({ loading: true, title: msg || 'Loading...', allowOutsideClick: false, showConfirmButton: false });
  const hideSpinner = () => cpop.close();
  const showPopup = (type, title, text) => cpop.fire({ icon: type, title, text, timer: 4000, timerProgressBar: true });

  // Get current location (simplified)
  const getCurrentLocation = () => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        resolve({ fallback: true, latitude: 10.6549, longitude: -61.5019, accuracy: 1000, timestamp: new Date().toISOString() });
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
          resolve({ fallback: true, latitude: 10.6549, longitude: -61.5019, accuracy: 1000, timestamp: new Date().toISOString() });
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

      // Destroy existing map instance before re-creating
      if (map && map._container) { map.remove(); map = null; }

      const defaultCenter = [10.6549, -61.5019]; // Trinidad & Tobago — used only if no sites/GPS

      // Request browser location permission as early as possible (triggers the prompt)
      if (navigator.geolocation && !userLocation) {
        navigator.geolocation.getCurrentPosition(
          pos => {
            userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
          },
          () => { /* denied — keep fallback */ },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      }

      // Create map without setting a view yet — avoids flash to default center
      map = L.map('map', { center: defaultCenter, zoom: 11, zoomAnimation: false });

      // OpenStreetMap tile layer — free, no API key, proper attribution
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
        maxZoom: 19
      }).addTo(map);

      // Fetch project sites from DB, draw zones, THEN set final view — no double-pan
      api('listProjectSites', {}).then(res => {
        const sites = (res && res.success && res.data) || [];
        attendanceZones.forEach(z => { try { map.removeLayer(z); } catch (_) {} });
        attendanceZones = [];

        sites.forEach(site => {
          if (!site.latitude || !site.longitude) return;
          const zone = L.circle([site.latitude, site.longitude], {
            color: '#0074D9', fillColor: '#0074D9',
            fillOpacity: 0.18, radius: site.radius || 200, weight: 2
          }).addTo(map);
          zone.bindPopup(`
            <div style="text-align:center; padding:8px;">
              <strong style="color:#001f3f;">${site.name}</strong><br>
              ${site.address ? `<span style="color:#666;font-size:12px;">${site.address}</span><br>` : ''}
              <span style="font-size:12px;">📏 Radius: ${site.radius || 200}m</span>
            </div>
          `);
          attendanceZones.push(zone);
        });

        // Single final view — prefer site bounds, else GPS, else default
        if (attendanceZones.length) {
          const group = L.featureGroup(attendanceZones);
          try { map.fitBounds(group.getBounds().pad(0.25), { animate: false }); } catch (_) {}
        } else if (userLocation) {
          map.setView([userLocation.lat, userLocation.lng], 13, { animate: false });
        }
        // else stays on defaultCenter set at map creation

        // Plot live employee markers after view is set
        if (liveData && liveData.length) plotLiveEmployees(liveData);

        // Now show user GPS marker (view already finalised above)
        if (userLocation) updateUserLocationOnMap();
      });

    } catch (error) {
      console.error('Error initializing map:', error);
    }
  }

  function updateUserLocationOnMap() {
    if (!userLocation || !map) return;
    if (!userLocation.lat || !userLocation.lng || userLocation.fallback) return; // no real GPS
    if (userMarker) map.removeLayer(userMarker);
    userMarker = L.marker([userLocation.lat, userLocation.lng], {
      icon: L.divIcon({
        className: 'user-location-marker',
        html: `<div style="background:#2ecc71;width:24px;height:24px;border-radius:50%;border:3px solid white;box-shadow:0 2px 5px rgba(0,0,0,0.3);"></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      })
    }).addTo(map).bindPopup('Your current location');
    // Don't call setView here — view is managed by initializeMap fitBounds
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
      // Use profile photo in marker if available, else fallback to coloured initial
      const markerHtml = row.profileImage
        ? `<div style="width:36px;height:36px;border-radius:50%;border:3px solid ${color};box-shadow:0 2px 6px rgba(0,0,0,.35);overflow:hidden;"><img src="${row.profileImage}" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.innerHTML='<div style=\\'width:36px;height:36px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:14px;\\'>${initial}</div>'"></div>`
        : `<div style="background:${color};width:36px;height:36px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:14px;">${initial}</div>`;

      const marker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: 'live-emp-marker',
          html: markerHtml,
          iconSize: [36, 36],
          iconAnchor: [18, 18]
        })
      }).addTo(map);

      // Best selfie to show: prefer check-out (more recent), fall back to check-in
      const selfie  = row.checkOutPhotoUrl || row.checkInPhotoUrl || '';
      const statusLabel = row.isCheckedOut ? 'Checked Out' : (row.status === 'late' ? '⚠ Late' : '✓ Checked In');
      const statusColor = row.isCheckedOut ? '#6c757d'    : (row.status === 'late' ? '#f59e0b' : '#34a853');
      marker.bindPopup(`
        <div class="live-popup">
          ${selfie
            ? `<img src="${selfie}" alt="Selfie" onerror="this.style.display='none'">`
            : (row.profileImage ? `<img src="${row.profileImage}" alt="${initial}" onerror="this.style.display='none'">` : '')}
          <div class="name">${row.fullName}</div>
          ${row.position  ? `<div class="row"><i class="fas fa-id-badge"       style="width:14px;color:#888;"></i> ${row.position}</div>` : ''}
          ${row.department? `<div class="row"><i class="fas fa-building"        style="width:14px;color:#888;"></i> ${row.department}</div>` : ''}
          <div class="row"><i class="fas fa-sign-in-alt"   style="width:14px;color:#888;"></i> In: <strong>${row.checkInTime  || '—'}</strong></div>
          <div class="row"><i class="fas fa-sign-out-alt"  style="width:14px;color:#888;"></i> Out: <strong>${row.checkOutTime || '—'}</strong></div>
          ${row.siteName  ? `<div class="row"><i class="fas fa-map-marker-alt" style="width:14px;color:#888;"></i> ${row.siteName}${row.distanceM != null ? ` <span style="color:#999;font-size:11px;">(${row.distanceM}m)</span>` : ''}</div>` : ''}
          ${row.lastSeen  ? `<div class="row"><i class="fas fa-clock"          style="width:14px;color:#888;"></i> Last seen: ${row.lastSeen}</div>` : ''}
          <div class="row" style="margin-top:7px;">
            <span style="display:inline-block;padding:3px 10px;border-radius:12px;background:${statusColor};color:#fff;font-size:11px;font-weight:700;">${statusLabel}</span>
          </div>
        </div>
      `, { maxWidth: 240 });
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
      // prefer check-in selfie, fall back to profile photo, then initial letter
      const thumbSrc = r.checkInPhotoUrl || r.profileImage || '';
      const thumb = thumbSrc
        ? `<img class="live-emp-thumb" src="${thumbSrc}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="live-emp-thumb-fallback" style="display:none;">${initial}</div>`
        : `<div class="live-emp-thumb-fallback">${initial}</div>`;
      const metaParts = [];
      if (r.lastSeen) metaParts.push(`<i class="fas fa-clock" style="width:11px;"></i> ${r.lastSeen}`);
      if (r.position) metaParts.push(`<i class="fas fa-id-badge" style="width:11px;"></i> ${r.position}`);
      else if (r.department) metaParts.push(`<i class="fas fa-building" style="width:11px;"></i> ${r.department}`);
      return `<div class="live-emp-card ${cls}" data-userid="${r.userId}">
        <div style="position:relative;flex-shrink:0;">${thumb}</div>
        <div class="live-emp-info">
          <div class="live-emp-name">${r.fullName}</div>
          <div class="live-emp-meta">${metaParts.join(' &middot; ') || (r.department || '—')}</div>
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
    }).catch(err => { showNotification(err.message || 'Network error', 'error'); });
  }

  // ─── Session helpers (1-hour timeout) ───
  function saveSession(payload) {
    try {
      const data = Object.assign({}, payload, { expiresAt: Date.now() + SESSION_DURATION });
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
  // shared items appended to every role's sidebar (Profile + Settings + About)

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
    if (SiomacCharts.hasAttendanceChart()) loadChart();
    if (SiomacCharts.hasTrendChart()) loadTrendChart();
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
      case 's-projectMap':      setTimeout(() => { if (!map) initializeMap(); else map.invalidateSize(); }, 80); loadLiveAttendance(); break;
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

    // apply cached company name & logo instantly — before any screen is revealed —
    // so neither the login page nor the app shell ever shows "My Company" as a flash
    try {
      const cached = loadSession();
      if (cached && cached.companyName) applyCompanyName(cached.companyName);
      if (cached && cached.companyLogoUrl) applyCompanyLogo(cached.companyLogoUrl);
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
      if (event.target.closest('#pickProfileImageBtn'))    pickProfileImage();
      if (event.target.closest('#removeProfileImageBtn')) removeProfileImage();
      if (event.target.closest('#saveProfileBtn'))        saveMyProfile();

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
      token: result.token || '',
      companyName: result.companyName || '', companyLogoUrl: result.companyLogoUrl || ''
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
    if (avatarEl) setSidebarAvatar(avatarEl, result.profileImage || '', currentFullName);

    // company logo (if admin uploaded one) — apply to login screen + sidebar brand
    if (result.companyLogoUrl) applyCompanyLogo(result.companyLogoUrl);

    // company name — sidebar brand + About header (set everywhere from Settings)
    applyCompanyName(result.companyName || 'My Company');
    refreshCompanySettings();

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
    }).then(handleAttendanceSuccess).catch(err => { hideSpinner(); showPopup('error', 'Network Error', err.message || 'Could not connect to server'); });
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

  // small donut - capped via .chart-wrap canvas CSS (max-height 200px)
  function displayChart(stats) {
    SiomacCharts.displayAttendanceChart(stats);
  }

  // Admin dashboard charts (2x2)
  function loadDashboardCharts() {
    api('getDashboardCharts').then(res => {
      if (res.success) SiomacCharts.renderDashboardCharts(res.data);
    });
  }

  // Last 7 days hours bar chart — pulls from the same getMyHistory endpoint
  function loadTrendChart() {
    api('getMyHistory', { username: currentUser, days: 7 }).then(res => {
      displayTrendChart((res.success && res.data) || []);
    });
  }

  function displayTrendChart(records) {
    SiomacCharts.displayTrendChart(records);
  }

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
        showPopup('success', 'Leave Request Submitted', 'Your leave request has been submitted for approval.');
        const modal = bootstrap.Modal.getInstance(document.getElementById('leaveRequestModal'));
        if (modal) modal.hide();
        document.getElementById('leaveRequestForm').reset();
        loadLeaveRequests();
      } else {
        showPopup('error', 'Failed', res.message || 'Could not submit leave');
      }
    }).catch(err => { hideSpinner(); showPopup('error', 'Error', err.message || 'Network error'); });
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
      }).catch(err => { hideSpinner(); showPopup('error', 'Error', err.message || 'Network error'); });
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
      }).catch(err => { hideSpinner(); showPopup('error', 'Error', err.message || 'Network error'); });
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
        showPopup('success', 'Employee Added', 'New employee has been added successfully.');
        const modal = bootstrap.Modal.getInstance(document.getElementById('addEmployeeModal'));
        if (modal) modal.hide();
        document.getElementById('addEmployeeForm').reset();
        loadEmployeeList();
      } else {
        showPopup('error', 'Failed', res.message || 'Could not add employee');
      }
    }).catch(err => { hideSpinner(); showPopup('error', 'Error', err.message || 'Network error'); });
  }

  function loadEmployeeList() {
    // On background sync, skip skeleton/destroy so the table doesn't flash empty
    if (!_isSyncing && !swr.get('listEmployees:{}')) {
      destroyDataTable('employeesTable');
      setSkel('employeesTableBody', skelTableRows(7, 5));
    }
    _rawApi('listEmployees', {}).then(res => {
      if (!res || !res.success) {
        if (!_isSyncing) document.getElementById('employeesTableBody').innerHTML = `<tr><td colspan="7" style="color:#b00;padding:16px;font-weight:600;">Error: ${(res && res.message) || 'Failed to load employees'}</td></tr>`;
        return;
      }
      swr.set('listEmployees:{}', res);
      displayEmployeeList(res.data || []);
    }).catch(err => {
      if (!_isSyncing) document.getElementById('employeesTableBody').innerHTML = `<tr><td colspan="7" style="color:#b00;padding:16px;font-weight:600;">Network error: ${err.message || 'Could not connect'}</td></tr>`;
    });
  }

  function displayEmployeeList(employees) {
    const statusMap = {
      checkedin:  { class: 'status-checkedin',  text: 'Checked In',     icon: '<i class="fas fa-check-circle"></i>' },
      checkedout: { class: 'status-checkedout', text: 'Checked Out',    icon: '<i class="fas fa-sign-out-alt"></i>' },
      notchecked: { class: 'status-notchecked', text: 'Not Checked In', icon: '<i class="fas fa-clock"></i>' }
    };
    const html = employees.map((emp, index) => {
      const todayStatus = statusMap[emp.todayStatus] || statusMap.notchecked;
      return `<tr>
        <td data-label="ID">${index + 1}</td>
        <td data-label="Name">${escapeHtml(emp.fullName)}</td>
        <td data-label="Department">${escapeHtml(emp.department)}</td>
        <td data-label="Position">${escapeHtml(emp.position)}</td>
        <td data-label="Status"><span class="status-badge ${emp.status === 'Active' ? 'active' : 'inactive'}">${emp.status}</span></td>
        <td data-label="Today"><span class="employee-status ${todayStatus.class}">${todayStatus.icon} ${todayStatus.text}</span></td>
        <td data-label="Actions" style="white-space:nowrap;">
          <button class="action-icon edit-icon btn-edit-employee" data-username="${escapeHtml(emp.username)}" title="Edit"><i class="fas fa-edit"></i></button>
          <button class="action-icon delete-icon btn-delete-employee" data-username="${escapeHtml(emp.username)}" title="Delete"><i class="fas fa-trash"></i></button>
        </td>
      </tr>`;
    }).join('');

    // Destroy old DataTable first, then set HTML, then re-init
    destroyDataTable('employeesTable');
    document.getElementById('employeesTableBody').innerHTML = html;
    initDataTable('employeesTable', {
      columnDefs: [{ targets: -1, orderable: false, searchable: false, className: 'text-center dt-no-export' }]
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
        showPopup('success', 'Employee Updated', `Employee ${fullName} has been updated successfully.`);
        const modal = bootstrap.Modal.getInstance(document.getElementById('editEmployeeModal'));
        if (modal) modal.hide();
        loadEmployeeList();
      } else {
        showPopup('error', 'Failed', res.message || 'Could not update');
      }
    }).catch(err => { hideSpinner(); showPopup('error', 'Error', err.message || 'Network error'); });
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
            showPopup('success', 'Deleted', 'Employee has been deleted.');
            loadEmployeeList();
          } else {
            showPopup('error', 'Failed', res.message || 'Could not delete');
          }
        }).catch(err => { hideSpinner(); showPopup('error', 'Error', err.message || 'Network error'); });
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
        showPopup('success', 'Saved', 'Department saved successfully.');
        const modal = bootstrap.Modal.getInstance(document.getElementById('addDepartmentModal'));
        if (modal) modal.hide();
        document.getElementById('addDepartmentForm').reset();
        editingDeptId = null;
        loadDepartments();
      } else {
        showPopup('error', 'Failed', res.message || 'Could not save department');
      }
    }).catch(err => { hideSpinner(); showPopup('error', 'Error', err.message || 'Network error'); });
  }

  function loadDepartments() {
    setSkel('departmentsContainer', skelCards(3));
    _rawApi('listDepartments', {}).then(res => {
      console.log('[loadDepartments] API response:', JSON.stringify(res));
      if (!res || !res.success) {
        document.getElementById('departmentsContainer').innerHTML = `<p style="color:#b00;padding:16px;font-weight:600;">Error: ${(res && res.message) || 'Failed to load departments'}</p>`;
        return;
      }
      const list = Array.isArray(res.data) ? res.data : [];
      console.log('[loadDepartments] list length:', list.length);
      departments = list;
      swr.set('listDepartments:{}', res);
      displayDepartments(list);
    }).catch(err => {
      console.error('[loadDepartments] catch:', err);
      document.getElementById('departmentsContainer').innerHTML = `<p style="color:#b00;padding:16px;font-weight:600;">Network error: ${err.message || 'Could not connect'}</p>`;
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
          showPopup('success', 'Deleted', 'Department has been deleted.');
          loadDepartments();
        } else {
          showPopup('error', 'Failed', res.message || 'Could not delete');
        }
      }).catch(err => { hideSpinner(); showPopup('error', 'Error', err.message || 'Network error'); });
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
        showPopup('success', 'Saved', 'Project site saved successfully.');
        const modal = bootstrap.Modal.getInstance(document.getElementById('addProjectModal'));
        if (modal) modal.hide();
        document.getElementById('addProjectForm').reset();
        editingSiteId = null;
        loadProjectSites();
      } else {
        showPopup('error', 'Failed', res.message || 'Could not save site');
      }
    }).catch(err => { hideSpinner(); showPopup('error', 'Error', err.message || 'Network error'); });
  }

  function loadProjectSites() {
    setSkel('projectsContainer', skelCards(3));
    _rawApi('listProjectSites', {}).then(res => {
      console.log('[loadProjectSites] API response:', JSON.stringify(res));
      if (!res || !res.success) {
        document.getElementById('projectsContainer').innerHTML = `<p style="color:#b00;padding:16px;font-weight:600;">Error: ${(res && res.message) || 'Failed to load project sites'}</p>`;
        return;
      }
      projectSites = Array.isArray(res.data) ? res.data : [];
      swr.set('listProjectSites:{}', res);
      displayProjectSites(projectSites);
    }).catch(err => {
      console.error('[loadProjectSites] catch:', err);
      document.getElementById('projectsContainer').innerHTML = `<p style="color:#b00;padding:16px;font-weight:600;">Network error: ${err.message || 'Could not connect'}</p>`;
    });
  }

  function displayProjectSites(sites) {
    if (!sites.length) {
      document.getElementById('projectsContainer').innerHTML = '<p style="color:#888;padding:16px;">No project sites yet. Click <strong>Add Project Site</strong> to create one.</p>';
      return;
    }
    const html = sites.map(site => {
      const lat = Number(site.latitude)  || 0;
      const lng = Number(site.longitude) || 0;
      const rad = Number(site.radius)    || 200;
      return `<div class="project-zone">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px; gap:8px;">
          <div class="card-title">${escapeHtml(site.name)}</div>
          <div class="department-actions">
            <button class="action-icon edit-icon btn-edit-project" data-id="${site.id}" title="Edit"><i class="fas fa-edit"></i></button>
            <button class="action-icon delete-icon btn-delete-project" data-id="${site.id}" title="Delete"><i class="fas fa-trash"></i></button>
          </div>
        </div>
        <p style="color:#666; font-size:13px; margin-bottom:10px;">${escapeHtml(site.description || '')}</p>
        <div class="project-info">
          <div><i class="fas fa-map-marker-alt" style="color:var(--navy-accent); width:18px;"></i> ${escapeHtml(site.address || '')}</div>
          <div><i class="fas fa-crosshairs" style="color:var(--navy-accent); width:18px;"></i> ${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
          <div><i class="fas fa-ruler-combined" style="color:var(--navy-accent); width:18px;"></i> Radius: ${rad}m</div>
        </div>
      </div>`;
    }).join('');
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
          showPopup('success', 'Deleted', 'Project site has been deleted.');
          loadProjectSites();
        } else {
          showPopup('error', 'Failed', res.message || 'Could not delete');
        }
      }).catch(err => { hideSpinner(); showPopup('error', 'Error', err.message || 'Network error'); });
    });
  }

  function loadAttendanceData() {
    const month = parseInt(document.getElementById('attendanceMonth').value, 10);
    const year  = parseInt(document.getElementById('attendanceYear').value, 10);
    const args = { month, year };
    if (!_isSyncing && !swr.get('listAttendance:' + JSON.stringify(args))) {
      destroyDataTable('attendanceTable');
      setSkel('attendanceTableBody', skelTableRows(9, 5));
    }
    _rawApi('listAttendance', args).then(res => {
      if (!res || !res.success) {
        if (!_isSyncing) document.getElementById('attendanceTableBody').innerHTML = `<tr><td colspan="9" style="color:#b00;padding:16px;font-weight:600;">Error: ${(res && res.message) || 'Failed to load attendance'}</td></tr>`;
        return;
      }
      if (!_isSyncing) displayAttendanceData(res.data || []);
    }).catch(err => {
      if (!_isSyncing) document.getElementById('attendanceTableBody').innerHTML = `<tr><td colspan="9" style="color:#b00;padding:16px;font-weight:600;">Network error: ${err.message || 'Could not connect'}</td></tr>`;
    });
  }

  function displayAttendanceData(data) {
    const thumb = url => url
      ? `<a href="${url}" target="_blank" rel="noopener" class="ms-1"><img src="${url}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;vertical-align:middle;border:1px solid #ddd;" title="View selfie" onerror="this.style.display='none'"></a>`
      : '';
    const badge = s => s === 'Late' ? 'bg-warning text-dark' : s === 'Absent' || s === 'Not Checked In' ? 'bg-danger' : s === 'Checked Out' ? 'bg-secondary' : 'bg-success';

    const html = data.map(item => `
      <tr>
        <td data-label="Name">${escapeHtml(item.name)}</td>
        <td data-label="Department">${escapeHtml(item.department)}</td>
        <td data-label="Today"><span class="badge ${badge(item.todayStatus)}">${escapeHtml(item.todayStatus)}</span></td>
        <td data-label="Check In">${escapeHtml(item.checkIn)}${thumb(item.checkInPhotoUrl)}</td>
        <td data-label="Check Out">${escapeHtml(item.checkOut)}${thumb(item.checkOutPhotoUrl)}</td>
        <td data-label="Total Days">${item.totalDays}</td>
        <td data-label="Present">${item.present}</td>
        <td data-label="Absent">${item.absent}</td>
        <td data-label="Actions"><button class="btn btn-sm btn-info btn-view-att" data-in="${item.checkInPhotoUrl||''}" data-out="${item.checkOutPhotoUrl||''}" data-name="${escapeHtml(item.name||'')}">View</button></td>
      </tr>`).join('');

    // Always destroy first, then set HTML, then init — prevents DataTable state conflicts
    destroyDataTable('attendanceTable');
    document.getElementById('attendanceTableBody').innerHTML = html;
    initDataTable('attendanceTable', {
      columnDefs: [{ targets: -1, orderable: false, searchable: false, className: 'text-center dt-no-export' }]
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
    if (!_isSyncing && !swr.get('listAllLeaves:{}')) {
      destroyDataTable('leavesTable');
      setSkel('leavesTableBody', skelTableRows(7, 4));
    }
    apiSwr('listAllLeaves', {}, {
      onData: res => { if (!_isSyncing) displayLeaveApplications((res && res.success && res.data) || []); }
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

    destroyDataTable('leavesTable');
    document.getElementById('leavesTableBody').innerHTML = html;
    initDataTable('leavesTable', {
      columnDefs: [{ targets: -1, orderable: false, searchable: false, className: 'text-center dt-no-export' }]
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
      }).catch(err => { showPopup('error', 'Error', err.message || 'Network error'); });
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
  let _payCurrency = 'TT';
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

    const cur = d.currency || 'TT';
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
        _profileImageBase64 = '';
        _removeProfileImage  = false;
        _setProfilePhotoUI(u.profileImage || '', u.fullName);
      }
    });
  }

  let _profileImageBase64 = '';
  let _removeProfileImage  = false; // flagged true when user clicks Remove

  // Shared helper — updates the sidebar circular avatar with photo or initial letter
  function setSidebarAvatar(el, imgUrl, name) {
    if (!el) return;
    const initial = (name || '?').trim().charAt(0).toUpperCase();
    if (imgUrl) {
      const img = document.createElement('img');
      img.style.cssText = 'width:100%;height:100%;border-radius:50%;object-fit:cover;';
      img.alt = 'Profile';
      img.onerror = () => { el.innerHTML = ''; el.textContent = initial; };
      img.src = imgUrl;
      el.innerHTML = '';
      el.appendChild(img);
    } else {
      el.innerHTML = '';
      el.textContent = initial;
    }
  }

  function _setProfilePhotoUI(imgUrl, fullName) {
    const imgEl   = document.getElementById('profilePhotoPreview');
    const emptyEl = document.getElementById('profilePhotoEmpty');
    const removeBtn = document.getElementById('removeProfileImageBtn');
    if (imgUrl) {
      imgEl.style.display = 'block';
      emptyEl.style.display = 'none';
      if (removeBtn) removeBtn.style.display = '';
      // If URL fails to load (expired signed URL), fall back to initials
      imgEl.onerror = () => {
        imgEl.style.display = 'none';
        emptyEl.style.display = 'flex';
        emptyEl.textContent = (fullName || currentFullName || '?').charAt(0).toUpperCase();
        if (removeBtn) removeBtn.style.display = 'none';
      };
      imgEl.src = imgUrl;
    } else {
      imgEl.src = '';
      imgEl.style.display = 'none';
      emptyEl.style.display = 'flex';
      emptyEl.textContent = (fullName || currentFullName || '?').charAt(0).toUpperCase();
      if (removeBtn) removeBtn.style.display = 'none';
    }
  }

  function pickProfileImage() {
    document.getElementById('profileImageInput').click();
  }
  function onProfileImagePicked(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      _profileImageBase64 = e.target.result;
      _removeProfileImage  = false;
      _setProfilePhotoUI(_profileImageBase64, currentFullName);
    };
    reader.readAsDataURL(file);
  }
  function removeProfileImage() {
    _profileImageBase64 = '';
    _removeProfileImage  = true;
    _setProfilePhotoUI('', currentFullName);
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
      removeProfileImage: _removeProfileImage || false,
      oldPassword: oldPwd,
      newPassword: newPwd
    }).then(res => {
      btn.disabled = false; btn.innerHTML = orig;
      if (!res.success) { showPopup('error', 'Update Failed', res.message); return; }

      currentFullName = res.fullName || fullName;
      document.getElementById('sidebarUserName').textContent = currentFullName;

      const newPhoto = res.profileImage || '';

      // update sidebar avatar — photo if available, else initial letter
      setSidebarAvatar(document.getElementById('sidebarAvatar'), newPhoto, currentFullName);

      // update profile photo preview — trust the response directly
      _setProfilePhotoUI(newPhoto, currentFullName);

      // persist in session cache so it survives a reload
      updateStoredSession({ profileImage: newPhoto });

      _profileImageBase64 = '';
      _removeProfileImage  = false;
      document.getElementById('profileOldPwd').value = '';
      document.getElementById('profileNewPwd').value = '';
      // Bust SWR so next visit to profile re-fetches fresh from DB
      swr.clear();
      showPopup('success', 'Profile Updated', 'Your changes have been saved.');
    }).catch(err => { btn.disabled = false; btn.innerHTML = orig; showPopup('error', 'Error', err.message || 'Network error'); });
  }

  // ─── Admin branding + payroll-rule settings ─────────────────
  let _logoBase64 = '';
  function loadAdminBrandingSettings() {
    if (currentRole !== 'admin') return;
    api('getSettings').then(res => {
      const s = (res && res.data) || {};
      document.getElementById('setCompanyName').value  = s.companyName        || 'My Company';
      document.getElementById('setCurrency').value     = s.currency           || 'TT';
      document.getElementById('setLatePenalty').value  = s.latePenaltyPerDay  || '0';
      document.getElementById('setLeaveFine').value    = s.leaveFinePerDay    || '0';
      // Late threshold — stored as "HH:MM" (24h), <input type="time"> expects "HH:MM"
      const ltEl = document.getElementById('setLateThreshold');
      if (ltEl) ltEl.value = s.lateThresholdHHMM || '09:00';
      const mdEl = document.getElementById('setMaxDistance');
      if (mdEl) mdEl.value = s.maxDistanceM != null ? s.maxDistanceM : '200';
      const url = s.companyLogoUrl || '';
      setLogoPreview(url);
    });
  }

  // shared helper: show logo preview with natural sizing + border shape matched to aspect ratio
  function setLogoPreview(url) {
    const img   = document.getElementById('logoPreview');
    const empty = document.getElementById('logoPreviewEmpty');
    if (!img) return;
    if (url) {
      img.src = url;
      img.style.display = 'block';
      if (empty) empty.style.display = 'none';
      // match the border/padding shape to the image's aspect ratio
      const applyShape = function () {
        const r = img.naturalWidth / (img.naturalHeight || 1);
        const radius = (r >= 0.85 && r <= 1.15) ? '50%' : '10px';
        img.style.borderRadius = radius;
      };
      if (img.complete && img.naturalWidth) applyShape();
      else img.onload = applyShape;
    } else {
      img.style.display = 'none';
      if (empty) { empty.style.display = 'flex'; empty.style.borderRadius = '12px'; }
    }
  }

  function pickLogo() {
    document.getElementById('logoFileInput').click();
  }
  function onLogoPicked(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      _logoBase64 = e.target.result;
      setLogoPreview(_logoBase64);
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
      updateStoredSession({ companyLogoUrl: res.url || '' });
      showPopup('success', 'Logo Updated', 'Login + sidebar now show the new logo.');
    });
  }
  function savePayrollSettings() {
    const name      = document.getElementById('setCompanyName').value.trim() || 'My Company';
    const late      = String(Math.max(0, Number(document.getElementById('setLatePenalty').value) || 0));
    const leaveF    = String(Math.max(0, Number(document.getElementById('setLeaveFine').value)   || 0));
    const lateThEl  = document.getElementById('setLateThreshold');
    const lateTh    = lateThEl ? (lateThEl.value || '09:00') : '09:00';
    const maxDistEl = document.getElementById('setMaxDistance');
    const maxDist   = maxDistEl ? String(Math.max(0, Number(maxDistEl.value) || 200)) : '200';
    const btn = document.getElementById('savePayrollSettingsBtn');
    const orig = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    Promise.all([
      api('updateSetting', { key: 'companyName',        value: name,    actorId: currentUserId, actorUsername: currentUser }),
      api('updateSetting', { key: 'latePenaltyPerDay',  value: late,    actorId: currentUserId, actorUsername: currentUser }),
      api('updateSetting', { key: 'leaveFinePerDay',    value: leaveF,  actorId: currentUserId, actorUsername: currentUser }),
      api('updateSetting', { key: 'lateThresholdHHMM',  value: lateTh,  actorId: currentUserId, actorUsername: currentUser }),
      api('updateSetting', { key: 'maxDistanceM',        value: maxDist, actorId: currentUserId, actorUsername: currentUser })
    ]).then(rs => {
      btn.disabled = false; btn.innerHTML = orig;
      const failed = rs.find(r => !r.success);
      if (failed) { showPopup('error', 'Save Failed', failed.message || 'Could not save'); return; }
      _payCurrency = 'TT';
      applyCompanyName(name);
      updateStoredSession({ companyName: name, currency: 'TT', latePenaltyPerDay: late, leaveFinePerDay: leaveF, lateThresholdHHMM: lateTh, maxDistanceM: maxDist });
      showPopup('success', 'Settings Saved', 'Company settings updated successfully.');
    }).catch(err => { btn.disabled = false; btn.innerHTML = orig; showPopup('error', 'Network Error', err.message || 'Could not connect'); });
  }

  function refreshCompanySettings() {
    api('getSettings').then(res => {
      const s = (res && res.success && res.data) || null;
      if (!s) return;
      if (s.companyName) applyCompanyName(s.companyName);
      if (s.companyLogoUrl) applyCompanyLogo(s.companyLogoUrl);
      if (s.currency) _payCurrency = s.currency;
      updateStoredSession({
        companyName: s.companyName || 'My Company',
        companyLogoUrl: s.companyLogoUrl || '',
        currency: s.currency || 'TT',
        latePenaltyPerDay: s.latePenaltyPerDay || '0',
        leaveFinePerDay: s.leaveFinePerDay || '0'
      });
    });
  }

  // apply company name to sidebar brand + About header
  function applyCompanyName(name) {
    const safe = name && String(name).trim() ? String(name).trim() : 'My Company';
    const sb = document.getElementById('companyName');
    const ab = document.getElementById('aboutCompanyName');
    if (sb) sb.textContent = safe;
    if (ab) ab.textContent = safe;
  }

  // shared shape-detection — applies border-radius to img elements based on aspect ratio.
  // squareRadius: corner radius to use when image is NOT square (default '8px')
  // apply logo URL to login screen, sidebar brand, and About section
  function applyCompanyLogo(url) {
    // ── login screen logo — custom logo or fallback to default ──
    const loginLogo = document.getElementById('loginLogo');
    if (loginLogo) {
      loginLogo.src = url || 'assets/images/logo.png';
      loginLogo.style.display = '';
      loginLogo.style.borderRadius = '';
    }

    // ── About section logo ──
    const aboutLogo = document.getElementById('aboutLogo');
    if (aboutLogo) {
      if (url) {
        aboutLogo.src = url;
        aboutLogo.style.display = 'block';
      } else {
        aboutLogo.style.display = 'none';
      }
    }

    // ── sidebar brand ──
    const brand = document.querySelector('.sidebar-brand');
    if (brand) {
      const icon      = brand.querySelector('i');
      const nameSpan  = brand.querySelector('#companyName');
      const existImg  = brand.querySelector('img.sb-brand-img');

      if (url) {
        // hide icon + text; show logo image only
        if (icon)     icon.style.display     = 'none';
        if (nameSpan) nameSpan.style.display = 'none';

        const img = existImg || document.createElement('img');
        img.className = 'sb-brand-img';
        img.alt = 'Logo';
        img.style.cssText = 'max-height:42px; max-width:160px; width:auto; height:auto; object-fit:contain; display:block;';
        img.src = url;

        if (!existImg) brand.insertBefore(img, brand.firstChild);
      } else {
        // no logo — restore icon + text, remove any old logo img
        if (icon)     icon.style.display     = '';
        if (nameSpan) nameSpan.style.display = '';
        if (existImg) existImg.remove();
      }
    }

    // also update the preview in admin settings if it's open
    setLogoPreview(url || '');
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
function _safeInit() {
  try {
    AttendanceSystem.init();
  } catch (e) {
    console.error('AttendanceSystem.init() threw:', e);
    throw e; // re-throw so window.onerror can display it
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _safeInit);
} else {
  _safeInit();
}
