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
  let map = null;
  let userMarker = null;
  let attendanceZones = [];
  let projectSites = [];
  let userLocation = null;
  let liveMarkers = []; // leaflet markers for active employees on the live map
  let _liveClusterGroup = null; // markercluster group for employee markers
  let liveData    = []; // last-fetched live attendance rows (for sidebar panel + map sync)
  // ─── Section load registry ───────────────────────────────────────────────────
  // Tracks whether each section has ever successfully received data this session.
  // Skeleton loaders only fire on the very first load; background refreshes are
  // always silent. No global "syncing" flag — each loader decides independently.
  const _sectionLoaded = {};
  function _markLoaded(sectionId)   { _sectionLoaded[sectionId] = true; }
  function _isLoaded(sectionId)     { return !!_sectionLoaded[sectionId]; }
  function _resetLoadedState()      { Object.keys(_sectionLoaded).forEach(k => delete _sectionLoaded[k]); }

  // Convenience: show skeleton only on first visit (before data ever arrived)
  function _skelOnce(sectionId, fn) { if (!_isLoaded(sectionId)) fn(); }

  // ─── Session (1-hour timeout) ───
  // frontend-driven session: payload + expiresAt in localStorage. auto-restore on reload, auto-logout at expiry.
  const SESSION_KEY           = 'siomac_session_v1';
  const SESSION_DURATION      = 8 * 60 * 60 * 1000;    // 8 hours (default)
  const SESSION_DURATION_LONG = 7 * 24 * 60 * 60 * 1000; // 7 days (remember me)
  const SESSION_WARN_AT       = 5 * 60 * 1000;         // warn 5 min before expiry
  let _sessExpTimer  = null; // auto-logout timer
  let _sessWarnTimer = null; // 5-min warning timer
  let _sessTickTimer = null; // 30s tick for sidebar countdown
  let _sessWarned    = false; // prevent duplicate warnings

  const CONFIG = {
    WORKING_HOURS: { start: 6, end: 22 },
    MAX_DISTANCE: 200
  };

  // Format an ISO timestamp string in the browser's local timezone (always correct for the user)
  function fmtLocalTime(iso) {
    if (!iso) return '--:--';
    try {
      return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    } catch (_) { return '--:--'; }
  }

  // Translation dictionary
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

  // Utility functions — all popups go through the custom cpop module (no SweetAlert2)
  const showSpinner = (msg) => cpop.fire({ loading: true, title: msg || 'Loading...', allowOutsideClick: false, showConfirmButton: false });
  const hideSpinner = () => cpop.close();
  const showPopup = (type, title, text) => {
    return cpop.fire({ icon: type, title, text, showConfirmButton: true });
  };

  // ─── Inline field validation ───────────────────────────────────────────────
  // _fieldError(id, msg) — marks a field invalid with a message below it
  // _fieldOk(id)         — clears the error state
  // _validate(rules)     — runs all rules, marks fields, returns true if all pass
  //
  // Rule shape: { id, label, rules: ['required','email','phone','min:N','max:N','numeric','positive'] }
  // Also supports: { id, check: fn, msg }  for custom one-off checks

  function _fieldError(id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('field-invalid');
    let err = el.parentElement.querySelector('.field-error-msg');
    if (!err) {
      err = document.createElement('div');
      err.className = 'field-error-msg';
      el.parentElement.appendChild(err);
    }
    err.textContent = msg;
  }

  function _fieldOk(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('field-invalid');
    const err = el.parentElement && el.parentElement.querySelector('.field-error-msg');
    if (err) err.remove();
  }

  function _clearErrors(ids) {
    ids.forEach(_fieldOk);
  }

  function _validate(rules) {
    let valid = true;
    rules.forEach(rule => {
      // Custom check
      if (typeof rule.check === 'function') {
        const msg = rule.check();
        if (msg) { _fieldError(rule.id, msg); valid = false; }
        else _fieldOk(rule.id);
        return;
      }
      const el = document.getElementById(rule.id);
      const raw = el ? el.value : '';
      const val = raw.trim();
      let msg = null;

      for (const r of (rule.rules || [])) {
        if (r === 'required' && !val) {
          msg = `${rule.label} is required.`; break;
        }
        if (r === 'email' && val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
          msg = `Enter a valid email address.`; break;
        }
        if (r === 'phone' && val) {
          const digits = val.replace(/\D/g, '');
          // Expect (868) xxx-xxxx = 10 digits total (868 + 7)
          if (digits.length !== 10 || !digits.startsWith('868')) {
            msg = `Phone must be a complete (868) xxx-xxxx number.`; break;
          }
        }
        if (r === 'numeric' && val && isNaN(Number(val))) {
          msg = `${rule.label} must be a number.`; break;
        }
        if (r === 'positive' && val && Number(val) <= 0) {
          msg = `${rule.label} must be greater than 0.`; break;
        }
        if (typeof r === 'string' && r.startsWith('min:')) {
          const n = parseInt(r.split(':')[1]);
          if (val && val.length < n) { msg = `${rule.label} must be at least ${n} characters.`; break; }
          if (r === 'min:' + n && !val) { /* required handles empty */ }
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
      if (msg) { _fieldError(rule.id, msg); valid = false; }
      else _fieldOk(rule.id);
    });
    return valid;
  }

  // Clear field errors on any input/change inside a form
  document.addEventListener('input', e => {
    if (e.target instanceof Element && e.target.id) _fieldOk(e.target.id);
  }, true);
  document.addEventListener('change', e => {
    if (e.target instanceof Element && e.target.id) _fieldOk(e.target.id);
  }, true);

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

      // CartoDB Positron — clean light style matching design spec
      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> &amp; CartoDB',
        subdomains: 'abcd',
        maxZoom: 19
      }).addTo(map);

      // Fetch project sites from DB, draw zones, THEN set final view — no double-pan
      api('listProjectSites', {}).then(res => {
        const sites = (res && res.success && res.data) || [];
        attendanceZones.forEach(z => { try { map.removeLayer(z); } catch (_) {} });
        attendanceZones = [];

        sites.forEach(site => {
          if (!site.latitude || !site.longitude) return;

          const popupHtml = `
            <div class="lm-site-popup-card">
              <div class="lm-site-popup-banner">
                <div class="lm-site-popup-building-icon"><i class="fas fa-building"></i></div>
                <div>
                  <div class="lm-site-popup-name">${site.name}</div>
                  ${site.address ? `<div class="lm-site-popup-addr">${site.address}</div>` : ''}
                </div>
              </div>
              <div class="lm-site-popup-footer">
                <i class="fas fa-ruler-horizontal"></i> ${site.radius || 200}m radius
              </div>
            </div>`;

          // Radius circle
          const zone = L.circle([site.latitude, site.longitude], {
            color: '#1b2d54', fillColor: '#1b2d54',
            fillOpacity: 0.08, radius: site.radius || 200, weight: 2,
            dashArray: '6 4'
          }).addTo(map);
          zone.bindPopup(popupHtml, { className: 'siomac-popup', maxWidth: 240, minWidth: 200 });
          attendanceZones.push(zone);

          // Building marker at center
          const buildingMarker = L.marker([site.latitude, site.longitude], {
            icon: L.divIcon({
              className: 'lm-building-marker',
              html: `<div class="lm-building-pin"><i class="fas fa-building"></i></div>`,
              iconSize: [36, 36],
              iconAnchor: [18, 18]
            })
          }).addTo(map);
          buildingMarker.bindPopup(popupHtml, {
            className: 'siomac-popup',
            maxWidth: 240, minWidth: 200,
            offset: L.point(-130, 0), // open to the left of the marker
            autoPan: false
          });
          attendanceZones.push(buildingMarker);
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
  let _liveDataHash = ''; // fingerprint of last-rendered live data
  function loadLiveAttendance() {
    _skelOnce('s-projectMap', () => setSkel('liveEmployeesList', skelList(3)));
    const scope = currentRole === 'admin' ? 'all' : (currentDeptId || 'all');
    apiSwr('getLiveAttendance', { scope }, {
      onData: res => {
      const fresh = (res && res.success && res.data) || [];
      // Build a lightweight fingerprint: id + lat/lng + status per row
      const hash = fresh.map(r => `${r.id}|${r.checkInLat}|${r.checkInLng}|${r.checkOutLat}|${r.checkOutLng}|${r.status}|${r.isCheckedOut}`).join(';');
      const markersNeedUpdate = hash !== _liveDataHash;
      liveData = fresh;
      _markLoaded('s-projectMap');
      if (markersNeedUpdate) {
        _liveDataHash = hash;
        // Preload all profile photos before rendering markers + panel — no flash
        const _livePhotoUrls = liveData.map(r => r.profileImage || r.checkInPhotoUrl).filter(Boolean);
        _preloadThenRender(_livePhotoUrls, () => {
          plotLiveEmployees(liveData);
          renderLivePanel(liveData);
        });
      }
      }
    });
  }

  function clearLiveMarkers_() {
    if (_liveClusterGroup) { try { map.removeLayer(_liveClusterGroup); } catch (_) {} }
    _liveClusterGroup = null;
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
      });

      // Selfie = attendance check-in/out photo; profile = employee profile photo
      const selfie  = row.checkOutPhotoUrl || row.checkInPhotoUrl || '';
      const profile = row.profileImage || '';
      const statusCls   = row.isCheckedOut ? 'out' : (row.status === 'late' ? 'late' : 'in');
      const statusLabel = row.isCheckedOut ? 'Checked Out' : (row.status === 'late' ? 'Late Arrival' : 'Checked In');
      const statusIcon  = row.isCheckedOut ? 'fa-sign-out-alt' : (row.status === 'late' ? 'fa-clock' : 'fa-check-circle');
      const statusColor = row.isCheckedOut ? '#546E7A' : (row.status === 'late' ? '#E65100' : '#2E7D32');
      const statusBg    = row.isCheckedOut ? '#ECEFF4'  : (row.status === 'late' ? '#FFF3E0'  : '#E8F5E9');

      // Profile photo or initial circle
      const avatarHtml = profile
        ? `<img src="${profile}" alt="${initial}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;border:3px solid rgba(255,255,255,0.35);flex-shrink:0;" onerror="this.outerHTML='<div style=\\'width:48px;height:48px;border-radius:50%;background:var(--siomac-red);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:white;flex-shrink:0;\\'>${initial}</div>'">`
        : `<div style="width:48px;height:48px;border-radius:50%;background:var(--siomac-red);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:white;flex-shrink:0;">${initial}</div>`;

      // Nav link
      const navLat = row.checkInLat || row.checkOutLat || '';
      const navLng = row.checkInLng || row.checkOutLng || '';
      const navBtn = (navLat && navLng)
        ? `<a href="https://www.google.com/maps?q=${navLat},${navLng}" target="_blank" class="lm-popup-btn lm-popup-btn-outline"><i class="fas fa-directions"></i> Navigate</a>`
        : `<span class="lm-popup-btn lm-popup-btn-outline" style="opacity:.45;pointer-events:none;"><i class="fas fa-directions"></i> Navigate</span>`;

      marker.bindPopup(`
        <div class="lm-popup-card">

          <!-- Building banner -->
          <div class="lm-popup-site-banner">
            <div class="lm-popup-building-icon"><i class="fas fa-building"></i></div>
            <div class="lm-popup-site-info">
              <div class="lm-popup-site-name">${row.siteName ? row.siteName : 'On Site'}</div>
              ${row.distanceM != null ? `<div class="lm-popup-site-dist"><i class="fas fa-ruler-horizontal"></i> ${row.distanceM}m from site</div>` : ''}
            </div>
            <span class="lm-popup-status-pill" style="background:${statusBg};color:${statusColor};">
              <i class="fas ${statusIcon}"></i> ${statusLabel}
            </span>
          </div>

          <!-- Employee row -->
          <div class="lm-popup-emp-row">
            ${avatarHtml}
            <div class="lm-popup-emp-info">
              <div class="lm-popup-emp-name">${row.fullName}</div>
              <div class="lm-popup-emp-meta">${[row.position, row.department].filter(Boolean).join(' · ') || 'Employee'}</div>
              ${row.employeeId ? `<div class="lm-popup-emp-meta"><i class="fas fa-id-badge" style="margin-right:3px;"></i>${row.employeeId}</div>` : ''}
            </div>
          </div>

          <!-- Time row -->
          <div class="lm-popup-times">
            <div class="lm-popup-time-cell">
              <i class="fas fa-sign-in-alt"></i>
              <span class="lm-popup-time-label">In</span>
              <span class="lm-popup-time-val">${row.checkInTime ? fmtLocalTime(row.checkInTime) : '—'}</span>
            </div>
            <div class="lm-popup-time-divider"></div>
            <div class="lm-popup-time-cell">
              <i class="fas fa-sign-out-alt"></i>
              <span class="lm-popup-time-label">Out</span>
              <span class="lm-popup-time-val">${row.checkOutTime ? fmtLocalTime(row.checkOutTime) : '—'}</span>
            </div>
          </div>

          ${selfie ? `<div class="lm-popup-selfie"><img src="${selfie}" alt="Selfie" onerror="this.parentElement.style.display='none'"></div>` : ''}

          <!-- Footer -->
          <div class="lm-popup-footer">
            ${navBtn}
            <button class="lm-popup-btn lm-popup-btn-primary" onclick="document.getElementById('liveEmployeesList').querySelector('[data-uid=\\'${row.userId}\\']')?.scrollIntoView({behavior:'smooth',block:'nearest'})"><i class="fas fa-user"></i> View</button>
          </div>
        </div>
      `, { maxWidth: 310, minWidth: 270, className: 'siomac-popup' });
      marker._liveUserId = row.userId; // for sidebar click → marker open
      liveMarkers.push(marker);
    });

    // Add all markers into a cluster group so overlapping pins merge
    _liveClusterGroup = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 50,
      iconCreateFunction: function (cluster) {
        return L.divIcon({
          html: `<div class="lm-cluster-icon">${cluster.getChildCount()}</div>`,
          className: 'lm-cluster',
          iconSize: [40, 40]
        });
      }
    });
    liveMarkers.forEach(m => _liveClusterGroup.addLayer(m));
    map.addLayer(_liveClusterGroup);

    // fit map bounds to markers if any
    if (liveMarkers.length) {
      try { map.fitBounds(_liveClusterGroup.getBounds().pad(0.2)); } catch (_) {}
    }
  }

  function renderLivePanel(rows) {
    const checkedIn  = rows.filter(r => !r.isCheckedOut).length;
    const late       = rows.filter(r => r.status === 'late' && !r.isCheckedOut).length;
    const onSite     = rows.filter(r => (r.checkInLat || r.checkOutLat) != null).length;

    document.getElementById('liveActiveCount').textContent     = rows.length;
    document.getElementById('liveCheckedInCount').textContent  = checkedIn;
    document.getElementById('liveLateCount').textContent       = late;
    document.getElementById('liveOnSiteCount').textContent     = onSite;

    const sorted = rows.slice().sort((a, b) => String(b.lastSeen || '').localeCompare(String(a.lastSeen || '')));

    if (!sorted.length) {
      document.getElementById('liveEmployeesList').innerHTML =
        '<div class="lm-emp-empty"><i class="fas fa-users-slash"></i>No check-ins yet today</div>';
      return;
    }

    // Render initial letter avatars immediately — no flash waiting on images
    const listEl = document.getElementById('liveEmployeesList');
    listEl.innerHTML = sorted.map(r => {
      const initial   = (r.fullName || '?').charAt(0).toUpperCase();
      const dotCls    = r.isCheckedOut ? 'lm-dot-gray' : (r.status === 'late' ? 'lm-dot-orange' : 'lm-dot-green');
      const statusTxt = r.isCheckedOut ? 'Checked Out' : (r.status === 'late' ? 'Late' : 'Checked In');
      const meta      = r.lastSeen ? `${statusTxt} · ${fmtLocalTime(r.lastSeen)}` : statusTxt;
      return `<div class="lm-emp-item" data-userid="${r.userId}">
        <div class="lm-emp-avatar" data-uid="${r.userId}">${escapeHtml(initial)}</div>
        <div class="lm-emp-info">
          <div class="lm-emp-name">${escapeHtml(r.fullName || '—')}</div>
          <div class="lm-emp-status"><span class="lm-dot ${dotCls}"></span> ${meta}</div>
        </div>
        <i class="fas fa-chevron-right lm-emp-chevron"></i>
      </div>`;
    }).join('');

    // Preload profile photo into each avatar — off-screen decode, no flash
    sorted.forEach(r => {
      const src = r.profileImage || r.checkInPhotoUrl || '';
      if (!src) return;
      const avatarEl = listEl.querySelector(`.lm-emp-avatar[data-uid="${r.userId}"]`);
      if (!avatarEl) return;
      const img = new Image();
      img.onload = () => {
        // image ready — replace letter with photo in one paint, no layout shift
        avatarEl.textContent = '';
        avatarEl.style.padding = '0';
        const el = document.createElement('img');
        el.src = src;
        el.alt = (r.fullName || '?').charAt(0).toUpperCase();
        el.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;';
        avatarEl.appendChild(el);
      };
      // onerror: keep the letter — no action needed
      img.src = src;
    });
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
    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'info', title: t.title, text: t.text, showConfirmButton: true });
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
    const totalMins = Math.floor(msLeft / 60000);
    const secs = Math.floor((msLeft % 60000) / 1000);
    let txt;
    if (totalMins >= 60) {
      const h = Math.floor(totalMins / 60);
      const m = totalMins % 60;
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
    if (typeof window._refreshNavBadges === 'function') window._refreshNavBadges();
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
    if (typeof window._refreshNavBadges === 'function') window._refreshNavBadges();
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
    if (document.getElementById('s-adm-dashboard') && document.getElementById('s-adm-dashboard').classList.contains('active')) loadDashboardCharts(true);
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

  // ─── Skeleton helpers ───
  // Set a header badge value (CSS animation fires naturally on show)
  function _setHdrBadge(badge, count) {
    if (!badge) return;
    badge.textContent = count > 0 ? (count > 99 ? '99+' : count) : '';
    badge.style.display = count > 0 ? '' : 'none';
  }

  // Debounced combined badge refresh — all three header badges update together
  // from a single getHeaderCounts call so they always animate in simultaneously.
  let _hdrBadgeSyncTimer = null;
  function _scheduleHdrBadgeSync() {
    clearTimeout(_hdrBadgeSyncTimer);
    _hdrBadgeSyncTimer = setTimeout(() => {
      _rawApi('getHeaderCounts', { managerUsername: currentUser, role: currentRole }).then(res => {
        if (!res || !res.success) return;
        const c = res.data || {};
        const storedReadIds = (() => { try { return new Set(JSON.parse(localStorage.getItem('siomac_read_notifs_v1') || '[]')); } catch { return new Set(); } })();
        const unreadNotifs = (c.notificationIds || []).filter(id => !storedReadIds.has(id)).length;
        _setHdrBadge(document.getElementById('hdrNotifBadge'),   unreadNotifs);
        _setHdrBadge(document.getElementById('hdrMsgBadge'),     c.messages || 0);
        _setHdrBadge(document.getElementById('hdrTicketBadge'),  c.tickets  || 0);
        if (typeof window._refreshNavBadges === 'function') window._refreshNavBadges(c.pendingLeaves || 0);
      }).catch(() => {});
    }, 80); // 80ms debounce — collapses concurrent triggers into one request
  }

  function setSkel(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }
  function skelStatValues(ids) {
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
    // If leaving the dashboard while in edit mode, exit cleanly so the final order is saved
    if (id !== 's-adm-dashboard' && _dashEditMode) _dashToggleEditMode();

    document.querySelectorAll('.app-section').forEach(s => s.classList.remove('active'));
    const sec = document.getElementById(id);
    if (sec) sec.classList.add('active');
    try { localStorage.setItem('siomac_last_section_' + currentRole, id); } catch(e) {}
    document.querySelectorAll('.sidebar-menu button').forEach(b => b.classList.toggle('active', b.dataset.section === id));
    document.querySelectorAll('#topTabs button').forEach(b => b.classList.toggle('active', b.dataset.section === id));

    // page-header shows on all pages including live map

    // page header title + subtitle
    const item = allSectionItems().find(x => x.id === id);
    if (item) {
      document.getElementById('pageTitleIcon').className = 'fas ' + item.icon;
      document.getElementById('pageTitleText').textContent = item.label;
      const sub = document.getElementById('pageTitleSub');
      if (sub) sub.textContent = item.sub || '';
    }

    // close mobile drawer + backdrop after click
    document.getElementById('sidebar').classList.remove('mobile-open');
    document.getElementById('sidebarBackdrop').classList.remove('active');

    refreshSection(id);
  }

  function refreshSection(id) {
    switch (id) {
      case 's-settings':
        // Default tab: Security & Privacy for employees/managers; Company for admins
        document.querySelectorAll('.stg-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.stg-tab-pane').forEach(p => p.classList.remove('active'));
        { const defaultTab = currentRole === 'admin' ? 'company' : 'security';
          const defBtn = document.querySelector(`.stg-tab-btn[data-stg-tab="${defaultTab}"]`);
          const defPane = document.getElementById('stg-' + defaultTab);
          if (defBtn) defBtn.classList.add('active');
          if (defPane) defPane.classList.add('active'); }
        renderPalettes(); renderLayouts(); loadAdminBrandingSettings();
        break;
      case 's-profile':
        // Reset to Personal Info tab
        document.querySelectorAll('.ep-tab-btn').forEach((b,i) => b.classList.toggle('active', i===0));
        document.querySelectorAll('.ep-tab-pane').forEach((p,i) => p.classList.toggle('active', i===0));
        loadMyProfile();
        break;
      case 's-emp-attendance':  checkStatus(); loadChart(); loadTrendChart(); break;
      case 's-emp-history':     loadHistoryInline(); break;
      case 's-projectMap':
        // Only init/invalidate when user navigates to the map (first load).
        // Background syncs skip this — map viewport must not reset mid-use.
        if (!_isLoaded('s-projectMap')) {
          setTimeout(() => { if (!map) initializeMap(); else map.invalidateSize(); }, 80);
        }
        loadLiveAttendance();
        if (typeof window._clearMapBadge === 'function') window._clearMapBadge();
        break;
      case 's-emp-leave':       loadLeaveRequests(); break;
      case 's-mgr-overview':    loadDepartmentData(); break;
      case 's-mgr-employees':   loadDepartmentEmployees(); break;
      case 's-mgr-leaves':      loadManagerLeaveApplications(); break;
      case 's-adm-dashboard':   loadDashboardData(); loadDashboardCharts(); initDashboardLayoutEditor(); break;
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

    // ── Header icon modals (notifications / messages / tickets / user) ──
    (function () {
      const pairs = [
        { btn: 'hdrNotifBtn',  modal: 'hdrNotifModal'  },
        { btn: 'hdrMsgBtn',    modal: 'hdrMsgModal'    },
        { btn: 'hdrTicketBtn', modal: 'hdrTicketModal' },
      ];
      function closeAll() {
        pairs.forEach(p => {
          const m = document.getElementById(p.modal);
          const b = document.getElementById(p.btn);
          if (m) m.classList.remove('open');
          if (b) b.classList.remove('active');
        });
      }
      pairs.forEach(({ btn, modal }) => {
        const b = document.getElementById(btn);
        const m = document.getElementById(modal);
        if (!b || !m) return;
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          const isOpen = m.classList.contains('open');
          closeAll();
          if (!isOpen) {
            m.classList.add('open'); b.classList.add('active');
            // When ticket modal opens, always show the list view
            if (btn === 'hdrTicketBtn' && typeof window._startTicketSystem === 'function') {
              setTimeout(() => {
                const tl = document.getElementById('ticketList');
                if (tl) tl.style.display = '';
                const tf = document.getElementById('ticketModalFoot');
                if (tf) tf.style.display = '';
                const td = document.getElementById('ticketDetailPane');
                if (td) td.style.display = 'none';
                const tc = document.getElementById('ticketComposePane');
                if (tc) tc.style.display = 'none';
              }, 0);
            }
          }
        });
      });
      // Close on X button or clicking outside the icon group / modal
      document.addEventListener('click', (e) => {
        if (e.target.closest('.hdr-modal-close')) { closeAll(); return; }
        if (!e.target.closest('.hdr-icon-group') && !e.target.closest('.hdr-modal')) closeAll();
      });
    })();

    // ── Notification system ──────────────────────────────────────────────────
    (function () {
      const STORAGE_KEY = 'siomac_read_notifs_v1';
      let _notifData   = [];
      let _pollTimer   = null;
      let _seenIds     = new Set(); // tracks IDs we've already displayed

      function _readIds() {
        try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')); } catch { return new Set(); }
      }
      function _saveReadIds(set) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...set].slice(-200))); } catch {}
      }

      function _timeAgo(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d)) return '';
        const diff = Math.floor((Date.now() - d) / 1000);
        if (diff < 60) return 'Just now';
        if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
        return Math.floor(diff / 86400) + 'd ago';
      }

      // Map notification type → section to navigate to
      const NOTIF_SECTION = {
        // Admin / Manager
        leave:      () => currentRole === 'admin' ? 's-adm-leaves'      : currentRole === 'manager' ? 's-mgr-leaves'    : null,
        late:       () => currentRole === 'admin' ? 's-adm-attendance'  : currentRole === 'manager' ? 's-mgr-overview'  : null,
        checkin:    () => currentRole === 'admin' ? 's-adm-attendance'  : currentRole === 'manager' ? 's-mgr-overview'  : null,
        checkout:   () => currentRole === 'admin' ? 's-adm-attendance'  : currentRole === 'manager' ? 's-mgr-overview'  : null,
        absent:     () => currentRole === 'admin' ? 's-adm-attendance'  : currentRole === 'manager' ? 's-mgr-overview'  : null,
        // Employee
        my_checkin:  () => 's-emp-attendance',
        my_checkout: () => 's-emp-attendance',
        reminder:    () => 's-emp-attendance',
        myleave:     () => 's-emp-leave',
        pending:     () => 's-emp-leave',
        upcoming:    () => 's-emp-leave',
      };

      // Section IDs that carry nav badges
      const LEAVE_SECTION_IDS = ['s-adm-leaves', 's-mgr-leaves', 's-emp-leave'];
      const MAP_SECTION_IDS   = ['s-projectMap'];

      function _setBadge(btn, count) {
        let b = btn.querySelector('.sb-nav-badge');
        if (count > 0) {
          const label = count > 99 ? '99+' : String(count);
          if (!b) {
            b = document.createElement('span');
            b.className = 'sb-nav-badge';
            btn.appendChild(b);
          }
          if (b.textContent !== label) {
            b.textContent = label;
            b.style.animation = 'none';
            b.offsetWidth; // reflow to restart animation
            b.style.animation = '';
            b.classList.remove('sb-badge-bounce');
            void b.offsetWidth;
            b.classList.add('sb-badge-bounce');
          }
        } else {
          if (b) b.remove();
        }
      }

      function _updateNavBadges(unreadLeaveCount, checkedInCount) {
        const ci = checkedInCount || 0;
        ['#sidebarMenu', '#topTabs'].forEach(sel => {
          document.querySelectorAll(`${sel} button[data-section]`).forEach(btn => {
            const sec = btn.dataset.section;
            if (LEAVE_SECTION_IDS.includes(sec)) _setBadge(btn, unreadLeaveCount);
            if (MAP_SECTION_IDS.includes(sec))   _setBadge(btn, ci);
          });
        });
      }

      function _render(newIds) {
        const list = document.getElementById('notifList');
        if (!list) return;
        const readIds = _readIds();
        const unread  = _notifData.filter(n => !readIds.has(n.id));

        // Refresh all header badges together so they appear simultaneously
        _scheduleHdrBadgeSync();

        // Sidebar / top-tab badges — use actual pending leave count, not unread notifications
        _updateNavBadges(_getPendingLeaveCount(), _newCheckinCount());

        if (!_notifData.length) {
          list.innerHTML = '<div class="hdr-notif-empty"><i class="fas fa-bell-slash"></i><p>No notifications</p></div>';
          return;
        }

        list.innerHTML = _notifData.map(n => {
          const isRead = readIds.has(n.id);
          const resolver = NOTIF_SECTION[n.type];
          const section  = resolver ? resolver() : null;
          const iconEl = n.photoUrl
            ? `<div class="hdr-notif-icon ${escapeHtml(n.color)}" style="padding:0;overflow:hidden;"><img src="${escapeHtml(n.photoUrl)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;" onerror="this.parentElement.innerHTML='<i class=\\'fas ${escapeHtml(n.icon)}\\'></i>'"></div>`
            : `<div class="hdr-notif-icon ${escapeHtml(n.color)}"><i class="fas ${escapeHtml(n.icon)}"></i></div>`;
          return `
            <div class="hdr-notif-item${isRead ? ' read' : ' unread'}" data-notif-id="${escapeHtml(n.id)}"${section ? ` data-notif-section="${escapeHtml(section)}"` : ''} style="cursor:${section ? 'pointer' : 'default'}">
              ${iconEl}
              <div class="hdr-notif-text" style="flex:1;min-width:0;">
                <div class="hdr-notif-title">${escapeHtml(n.title)}</div>
                <div class="hdr-notif-sub">${n.rawTime ? `At ${fmtLocalTime(n.rawTime)}${n.sub && n.sub !== 'Check-in recorded' && n.sub !== 'Check-out recorded' ? ' · ' + escapeHtml(n.sub) : ''}` : escapeHtml(n.sub)}</div>
                <div class="hdr-notif-sub" style="margin-top:2px;opacity:.7">${_timeAgo(n.time)}</div>
              </div>
              ${!isRead ? '<div class="hdr-notif-dot"></div>' : ''}
            </div>`;
        }).join('');
      }

      function _fetch() {
        api('getNotifications', {}).then(res => {
          if (res && res.success) {
            const incoming = res.data || [];
            const newIds = new Set(incoming.map(n => n.id).filter(id => !_seenIds.has(id)));
            incoming.forEach(n => _seenIds.add(n.id));
            _notifData = incoming;
            _render(newIds);
            // Pulse bell if there are genuinely new notifications
            if (newIds.size > 0 && _seenIds.size > newIds.size) {
              const bell = document.getElementById('hdrNotifBtn');
              if (bell) { bell.classList.add('notif-bell-pulse'); setTimeout(() => bell.classList.remove('notif-bell-pulse'), 1000); }
            }
          }
        }).catch(() => {});
      }

      function _startPolling() {
        _fetch();
        clearInterval(_pollTimer);
        _pollTimer = setInterval(_fetch, 5 * 1000); // every 5 sec for near-instant delivery
      }

      // Mark all as read (clears bell badge + leave nav badge)
      const markAllBtn = document.getElementById('notifMarkAllBtn');
      if (markAllBtn) {
        markAllBtn.addEventListener('click', () => {
          const readIds = _readIds();
          _notifData.forEach(n => readIds.add(n.id));
          _saveReadIds(readIds);
          _render();
        });
      }

      // Clear all — removes all notifications from view and marks them read
      const clearAllBtn = document.getElementById('notifClearAllBtn');
      if (clearAllBtn) {
        clearAllBtn.addEventListener('click', () => {
          const readIds = _readIds();
          _notifData.forEach(n => readIds.add(n.id));
          _saveReadIds(readIds);
          _notifData = [];
          _render();
        });
      }

      // Refresh button
      const refreshBtn = document.getElementById('notifRefreshBtn');
      if (refreshBtn) refreshBtn.addEventListener('click', _fetch);

      // Mark as read + navigate on item click
      document.addEventListener('click', e => {
        const item = e.target.closest('.hdr-notif-item[data-notif-id]');
        if (!item) return;
        const id      = item.dataset.notifId;
        const section = item.dataset.notifSection;
        // Mark read
        const readIds = _readIds();
        readIds.add(id);
        _saveReadIds(readIds);
        _render();
        // Close the notification dropdown
        const modal = document.getElementById('hdrNotifModal');
        const btn   = document.getElementById('hdrNotifBtn');
        if (modal) modal.classList.remove('open');
        if (btn)   btn.classList.remove('active');
        // Navigate to the relevant section
        if (section) showSection(section);
      });

      // Timestamp of the last time the user visited Live Map — persisted across refreshes
      const _MAP_VISITED_KEY = 'siomac_map_last_visited';
      function _getMapLastVisited() {
        try { return parseInt(localStorage.getItem(_MAP_VISITED_KEY) || '0', 10) || 0; } catch { return 0; }
      }
      function _saveMapLastVisited(ts) {
        try { localStorage.setItem(_MAP_VISITED_KEY, String(ts)); } catch {}
      }

      function _newCheckinCount() {
        const lastVisited = _getMapLastVisited();
        return _notifData.filter(n =>
          (n.type === 'checkin' || n.type === 'late') &&
          new Date(n.time).getTime() > lastVisited
        ).length;
      }

      // Feed data directly from getHeaderData combined call
      window._applyNotifData = (res) => {
        if (!res || !res.success) return;
        const incoming = res.data || [];
        const newIds = new Set(incoming.map(n => n.id).filter(id => !_seenIds.has(id)));
        incoming.forEach(n => _seenIds.add(n.id));
        _notifData = incoming;
        _render(newIds);
      };

      // Expose so init() can kick it off after login
      window._startNotifPolling  = _startPolling;
      window._stopNotifPolling   = () => { clearInterval(_pollTimer); _updateNavBadges(0, 0); _saveMapLastVisited(0); };
      window._renderNotifs       = _render;
      window._clearMapBadge      = () => {
        _saveMapLastVisited(Date.now());
        ['#sidebarMenu', '#topTabs'].forEach(sel => {
          document.querySelectorAll(`${sel} button[data-section="s-projectMap"]`).forEach(btn => _setBadge(btn, 0));
        });
      };
      // leaveCount is optional — if supplied, uses actual pending leave count instead of unread notifications
      window._refreshNavBadges = (leaveCount) => {
        const count = (leaveCount != null) ? leaveCount : (() => {
          const readIds = _readIds();
          return _notifData.filter(n => n.type === 'leave' && !readIds.has(n.id)).length;
        })();
        _updateNavBadges(count, _newCheckinCount());
      };
    })();

    // ── Messages system ──────────────────────────────────────────────────────
    (function () {
      let _msgs      = [];
      let _empList   = [];   // for admin compose: list of employees to pick from
      let _currentMsgId = null;
      let _pollTimer    = null;

      function _timeAgoShort(iso) {
        if (!iso) return '';
        const d = new Date(iso); if (isNaN(d)) return '';
        const s = Math.floor((Date.now() - d) / 1000);
        if (s < 60) return 'Just now';
        if (s < 3600) return Math.floor(s / 60) + 'm ago';
        if (s < 86400) return Math.floor(s / 3600) + 'h ago';
        return Math.floor(s / 86400) + 'd ago';
      }
      function _initials(name) {
        return (name || '?').trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      }
      const _isAdmin = () => currentRole === 'admin' || currentRole === 'manager';

      function _showList() {
        document.getElementById('msgList').style.display       = '';
        document.getElementById('msgDetailPane').style.display = 'none';
        document.getElementById('msgComposePane').style.display= 'none';
        document.getElementById('msgModalFoot').style.display  = '';
        _currentMsgId = null;
      }

      function _showCompose(replyToUsername) {
        document.getElementById('msgList').style.display       = 'none';
        document.getElementById('msgDetailPane').style.display = 'none';
        document.getElementById('msgComposePane').style.display= 'flex';
        document.getElementById('msgModalFoot').style.display  = 'none';
        document.getElementById('msgComposeSubject').value     = '';
        document.getElementById('msgComposeBody').value        = '';

        // Admin: show recipient selector; employee: hide it
        const toWrap = document.getElementById('msgToWrap');
        const toSel  = document.getElementById('msgToSelect');
        if (_isAdmin()) {
          if (toWrap) toWrap.style.display = '';
          if (toSel) {
            toSel.innerHTML = '<option value="">— Select employee —</option>'
              + _empList.map(e => `<option value="${escapeHtml(e.username)}">${escapeHtml(e.fullName)} (${escapeHtml(e.role)})</option>`).join('');
            if (replyToUsername) toSel.value = replyToUsername;
          }
        } else {
          if (toWrap) toWrap.style.display = 'none';
        }
        document.getElementById('msgComposeSubject').focus();
      }

      function _renderList() {
        const list = document.getElementById('msgList');
        if (!list) return;
        if (!_msgs.length) {
          list.innerHTML = '<div class="hdr-notif-empty"><i class="fas fa-inbox"></i><p>No messages yet</p></div>';
          return;
        }
        list.innerHTML = _msgs.map(m => {
          const isSentByMe = m.fromUsername === currentUser;
          const otherName  = isSentByMe ? m.toName    : m.fromName;
          const otherPhoto = isSentByMe ? m.toPhoto   : m.fromPhoto;
          const initials   = _initials(otherName);
          const dirLabel   = isSentByMe ? `→ ${escapeHtml(m.toName)}` : `← ${escapeHtml(m.fromName)}`;
          const unread     = m.isUnread;
          const replyCount = m.replies.length;
          const avatarHtml = otherPhoto
            ? `<img src="${escapeHtml(otherPhoto)}" alt="${escapeHtml(initials)}" style="width:38px;height:38px;border-radius:50%;object-fit:cover;flex-shrink:0;border:2px solid var(--border,#eee);">`
            : `<div class="hdr-msg-avatar" style="${isSentByMe ? 'background:var(--siomac-navy,#001f3f);color:#fff' : ''}">${escapeHtml(initials)}</div>`;
          return `<div class="hdr-msg-item${unread ? ' unread' : ''}" data-msg-id="${escapeHtml(String(m.id))}" style="cursor:pointer;display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);">
            ${avatarHtml}
            <div class="hdr-msg-text" style="flex:1;min-width:0;">
              <div class="hdr-msg-name">${dirLabel} <span class="hdr-msg-time">${_timeAgoShort(m.createdAt)}</span></div>
              <div style="font-size:0.78rem;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(m.subject)}</div>
              <div class="hdr-msg-preview">${escapeHtml(m.body)}</div>
              ${replyCount ? `<div style="font-size:0.7rem;color:var(--siomac-red);margin-top:2px;"><i class="fas fa-reply"></i> ${replyCount} repl${replyCount !== 1 ? 'ies' : 'y'}</div>` : ''}
            </div>
          </div>`;
        }).join('');
      }

      function _bubble(isMe, senderName, body, time, photoUrl) {
        const name     = senderName || (isMe ? 'You' : 'Admin');
        const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
        const align    = isMe ? 'flex-end' : 'flex-start';
        const bubbleBg    = isMe ? 'var(--siomac-primary, #001f3f)' : 'var(--bg-subtle, #f0f2f5)';
        const bubbleColor = isMe ? '#fff' : 'var(--text-primary)';
        const avatarBg    = isMe ? 'var(--siomac-accent, #0074D9)' : 'var(--border-strong, #bbb)';
        const avatar = photoUrl
          ? `<img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(name)}" style="width:30px;height:30px;border-radius:50%;object-fit:cover;flex-shrink:0;border:2px solid ${isMe ? 'var(--siomac-accent,#0074D9)' : 'var(--border,#ddd)'};">`
          : `<div style="width:30px;height:30px;border-radius:50%;background:${avatarBg};color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.65rem;font-weight:700;flex-shrink:0;">${escapeHtml(initials)}</div>`;
        const bubble = `<div style="max-width:75%;background:${bubbleBg};color:${bubbleColor};padding:8px 12px;border-radius:${isMe ? '14px 14px 4px 14px' : '14px 14px 14px 4px'};font-size:0.82rem;white-space:pre-wrap;line-height:1.4;">${escapeHtml(body)}</div>`;
        const meta   = `<div style="font-size:0.68rem;color:var(--text-muted);margin-top:3px;text-align:${isMe ? 'right' : 'left'};">${escapeHtml(isMe ? 'You' : name)} · ${_timeAgoShort(time)}</div>`;
        return `<div style="display:flex;flex-direction:column;align-items:${align};margin-bottom:12px;">
          <div style="display:flex;align-items:flex-end;gap:6px;flex-direction:${isMe ? 'row-reverse' : 'row'};">${avatar}${bubble}</div>
          ${meta}
        </div>`;
      }

      function _showDetail(msgId) {
        const m = _msgs.find(x => String(x.id) === String(msgId));
        if (!m) return;
        _currentMsgId = msgId;
        document.getElementById('msgList').style.display       = 'none';
        document.getElementById('msgComposePane').style.display= 'none';
        document.getElementById('msgModalFoot').style.display  = 'none';
        document.getElementById('msgDetailPane').style.display = 'flex';

        // Subject header
        const otherName = m.fromUsername === currentUser ? m.toName : m.fromName;
        const header = `<div style="padding:10px 16px;border-bottom:1px solid var(--border);background:var(--bg-subtle,#f8fafe);">
          <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:2px;">${escapeHtml(m.fromUsername === currentUser ? 'To' : 'From')}: <strong>${escapeHtml(otherName)}</strong></div>
          <div style="font-size:0.88rem;font-weight:700;color:var(--text-primary);">${escapeHtml(m.subject)}</div>
        </div>`;

        // Opening message bubble — pick the right photo for each side
        const isMeFirst = m.fromUsername === currentUser;
        const myPhoto    = isMeFirst ? m.fromPhoto : m.toPhoto;
        const otherPhoto = isMeFirst ? m.toPhoto   : m.fromPhoto;
        const thread = _bubble(isMeFirst, m.fromName, m.body, m.createdAt, isMeFirst ? myPhoto : otherPhoto)
          + (m.replies || []).map(r => {
            const rIsMe = r.fromUsername === currentUser;
            return _bubble(rIsMe, r.fromName, r.body, r.createdAt, rIsMe ? myPhoto : otherPhoto);
          }).join('');

        document.getElementById('msgDetailBody').innerHTML = header
          + `<div style="padding:14px 16px;display:flex;flex-direction:column;">${thread}</div>`;

        // Scroll to bottom of thread
        const body = document.getElementById('msgDetailBody');
        body.scrollTop = body.scrollHeight;

        // Mark as read for the recipient
        if (m.isUnread) {
          api('markMessageRead', { messageId: msgId }).then(() => { m.isUnread = false; _renderList(); _updateMsgBadge(); }).catch(() => {});
        }
      }

      function _updateMsgBadge() {
        // Trigger combined sync so all badges refresh together
        _scheduleHdrBadgeSync();
      }

      function _fetch(keepDetail) {
        api('getMessages', {}).then(res => {
          if (!res || !res.success) return;
          _msgs = res.data || [];
          _updateMsgBadge();
          if (keepDetail && _currentMsgId) {
            _showDetail(_currentMsgId);
          } else {
            _renderList();
          }
        }).catch(() => {});
      }

      function _start() {
        const isAdmin = _isAdmin();
        document.getElementById('msgModalTitle').textContent       = isAdmin ? 'Messages' : 'My Messages';
        document.getElementById('msgComposeBtnLabel').textContent  = 'New Message';
        document.getElementById('msgMarkAllReadBtn').style.display = isAdmin ? '' : 'none';
        // Pre-load employee list for admin compose dropdown
        if (isAdmin) {
          api('getEmployeesForMsg', {}).then(res => { _empList = (res && res.data) || []; }).catch(() => {});
        }
        _fetch();
        clearInterval(_pollTimer);
        _pollTimer = setInterval(_fetch, 60 * 1000); // every 60 sec
      }

      // New Message button (both roles)
      document.getElementById('msgComposeBtn').addEventListener('click', () => _showCompose());
      document.getElementById('msgCancelComposeBtn').addEventListener('click', _showList);
      document.getElementById('msgDetailBackBtn').addEventListener('click', () => { _showList(); _renderList(); });

      // Send new message
      document.getElementById('msgSendBtn').addEventListener('click', () => {
        const subject    = (document.getElementById('msgComposeSubject').value || '').trim();
        const body       = (document.getElementById('msgComposeBody').value    || '').trim();
        const toUsername = _isAdmin() ? (document.getElementById('msgToSelect')?.value || '') : '';
        if (_isAdmin() && !toUsername) { showPopup('error', 'Missing', 'Please select a recipient.'); return; }
        if (!subject) { document.getElementById('msgComposeSubject').focus(); return; }
        if (!body)    { document.getElementById('msgComposeBody').focus();    return; }
        document.getElementById('msgSendBtn').disabled = true;
        api('sendMessage', { subject, body, toUsername }).then(res => {
          document.getElementById('msgSendBtn').disabled = false;
          if (!res.success) { showPopup('error', 'Failed', res.message); return; }
          const target = _isAdmin() ? 'employee' : 'admin';
          showPopup('success', 'Sent!', `Your message has been sent.`).then(() => { _showList(); _fetch(); });
        }).catch(() => { document.getElementById('msgSendBtn').disabled = false; });
      });

      // Mark all as read
      document.getElementById('msgMarkAllReadBtn').addEventListener('click', () => {
        _msgs.filter(m => m.isUnread).forEach(m => {
          api('markMessageRead', { messageId: m.id }).catch(() => {});
          m.isUnread = false;
        });
        _renderList(); _updateMsgBadge();
      });

      document.getElementById('msgRefreshBtn').addEventListener('click', _fetch);

      // Send reply (both sides)
      document.getElementById('msgReplySendBtn').addEventListener('click', () => {
        const body = (document.getElementById('msgReplyInput').value || '').trim();
        if (!body) return;
        const btn = document.getElementById('msgReplySendBtn');
        btn.disabled = true;
        document.getElementById('msgReplyInput').value = '';
        api('replyMessage', { messageId: _currentMsgId, body }).then(res => {
          btn.disabled = false;
          if (!res.success) { showPopup('error', 'Failed', res.message); return; }
          _fetch(true); // refresh but stay in detail view
        }).catch(() => { btn.disabled = false; });
      });

      // Click message row → open detail
      document.addEventListener('click', e => {
        const row = e.target.closest('.hdr-msg-item[data-msg-id]');
        if (!row) return;
        _showDetail(row.dataset.msgId);
      });

      window._applyMsgData = (res) => {
        if (!res || !res.success) return;
        _msgs = res.data || [];
        _updateMsgBadge();
        _renderList();
      };
      window._startMsgSystem = _start;
      window._stopMsgSystem  = () => clearInterval(_pollTimer);
    })();

    // ── Support Tickets system ───────────────────────────────────────────────
    (function () {
      let _tickets = [];
      let _currentTicketId = null;
      let _pollTimer = null;

      const STATUS_LABEL = { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved', closed: 'Closed' };
      const STATUS_CSS   = { open: 'open', in_progress: 'pending', resolved: 'closed', closed: 'closed' };

      function _initials(name) {
        return (name || '?').trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      }

      function _timeAgoShort(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d)) return '';
        const diff = Math.floor((Date.now() - d) / 1000);
        if (diff < 60) return 'Just now';
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
        return Math.floor(diff / 86400) + 'd ago';
      }

      function _showList() {
        document.getElementById('ticketList').style.display = '';
        document.getElementById('ticketDetailPane').style.display = 'none';
        document.getElementById('ticketComposePane').style.display = 'none';
        document.getElementById('ticketModalFoot').style.display = '';
        _currentTicketId = null;
      }

      function _showCompose() {
        document.getElementById('ticketList').style.display = 'none';
        document.getElementById('ticketDetailPane').style.display = 'none';
        document.getElementById('ticketComposePane').style.display = 'flex';
        document.getElementById('ticketModalFoot').style.display = 'none';
        document.getElementById('ticketCategory').value = 'general';
        document.getElementById('ticketSubject').value = '';
        document.getElementById('ticketBody').value = '';
        document.getElementById('ticketSubject').focus();
      }

      function _renderList() {
        const list = document.getElementById('ticketList');
        if (!list) return;
        if (!_tickets.length) {
          list.innerHTML = '<div class="hdr-notif-empty"><i class="fas fa-ticket-alt" style="opacity:.3"></i><p>No tickets yet</p></div>';
          return;
        }
        const isAdminView = currentRole === 'admin' || currentRole === 'manager';
        list.innerHTML = _tickets.map(t => {
          const css      = STATUS_CSS[t.status] || 'open';
          const lbl      = STATUS_LABEL[t.status] || t.status;
          const initials = _initials(t.fromName || 'U');
          const avatarStyle = 'width:36px;height:36px;border-radius:50%;flex-shrink:0;object-fit:cover;';
          const avatarHtml = t.fromPhoto
            ? `<img src="${escapeHtml(t.fromPhoto)}" alt="${escapeHtml(initials)}" style="${avatarStyle}border:2px solid var(--border,#eee);">`
            : `<div style="${avatarStyle}background:var(--siomac-primary,#001f3f);color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:700;">${escapeHtml(initials)}</div>`;
          const sub = isAdminView
            ? `${escapeHtml(t.fromName || '—')} · ${_timeAgoShort(t.createdAt)}`
            : `${escapeHtml(t.category || 'General')} · ${_timeAgoShort(t.createdAt)}`;
          return `<div class="hdr-ticket-item ${css}" data-ticket-id="${escapeHtml(String(t.id))}">
            ${avatarHtml}
            <div style="flex:1;min-width:0;">
              <div class="hdr-ticket-top">
                <span class="hdr-ticket-id">#${escapeHtml(t.ticketNumber)}</span>
                <span class="hdr-ticket-status ${css}">${escapeHtml(lbl)}</span>
              </div>
              <div class="hdr-ticket-title">${escapeHtml(t.subject)}</div>
              <div class="hdr-ticket-sub">${sub}${t.replies.length ? ` · ${t.replies.length} repl${t.replies.length !== 1 ? 'ies' : 'y'}` : ''}</div>
            </div>
          </div>`;
        }).join('');
      }

      function _showDetail(ticketId) {
        const t = _tickets.find(x => String(x.id) === String(ticketId));
        if (!t) return;
        _currentTicketId = ticketId;
        document.getElementById('ticketList').style.display = 'none';
        document.getElementById('ticketComposePane').style.display = 'none';
        document.getElementById('ticketModalFoot').style.display = 'none';
        const pane = document.getElementById('ticketDetailPane');
        pane.style.display = 'flex';
        const isAdminView = currentRole === 'admin' || currentRole === 'manager';
        // Show status controls for admin
        document.getElementById('ticketStatusSelect').style.display = isAdminView ? '' : 'none';
        document.getElementById('ticketStatusSaveBtn').style.display = isAdminView ? '' : 'none';
        if (isAdminView) {
          document.getElementById('ticketStatusSelect').value = t.status;
        }
        const replies = t.replies.map(r => `
          <div style="padding:10px 16px;border-bottom:1px solid var(--border);background:${r.fromUsername === currentUser ? 'rgba(228,12,12,.04)' : 'var(--bg-subtle,#f8fafe)'};">
            <div style="font-size:0.75rem;font-weight:700;color:var(--text-muted);margin-bottom:4px;">${escapeHtml(r.fromName)} · ${_timeAgoShort(r.createdAt)}</div>
            <div style="font-size:0.83rem;color:var(--text-primary);white-space:pre-wrap;">${escapeHtml(r.body)}</div>
          </div>`).join('');
        const css = STATUS_CSS[t.status] || 'open';
        const lbl = STATUS_LABEL[t.status] || t.status;
        document.getElementById('ticketDetailBody').innerHTML = `
          <div style="padding:14px 16px;border-bottom:1px solid var(--border);">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
              <span class="hdr-ticket-id">#${escapeHtml(t.ticketNumber)}</span>
              <span class="hdr-ticket-status ${css}">${escapeHtml(lbl)}</span>
              <span style="font-size:0.72rem;color:var(--text-muted);margin-left:auto;">${_timeAgoShort(t.createdAt)}</span>
            </div>
            <div style="font-size:0.88rem;font-weight:700;margin-bottom:6px;">${escapeHtml(t.subject)}</div>
            ${isAdminView ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:6px;">Reported by ${escapeHtml(t.fromName)}</div>` : ''}
            <div style="font-size:0.83rem;color:var(--text-primary);white-space:pre-wrap;">${escapeHtml(t.body)}</div>
          </div>
          ${replies}`;
        document.getElementById('ticketReplyInput').value = '';
      }

      function _updateTicketBadge() {
        const isAdminView = currentRole === 'admin' || currentRole === 'manager';
        const openCount = isAdminView ? _tickets.filter(t => t.status === 'open').length : 0;
        // Trigger combined sync so all badges refresh together
        _scheduleHdrBadgeSync();
        const countEl = document.getElementById('ticketOpenCount');
        if (countEl) countEl.textContent = openCount ? `${openCount} Open Ticket${openCount !== 1 ? 's' : ''}` : '';
      }

      function _fetch(keepDetail) {
        api('getTickets', {}).then(res => {
          if (!res || !res.success) return;
          _tickets = res.data || [];
          _updateTicketBadge();
          if (keepDetail && _currentTicketId) {
            _showDetail(_currentTicketId);
          } else {
            _showList();
            _renderList();
          }
        }).catch(() => {});
      }

      function _start() {
        const isAdminView = currentRole === 'admin' || currentRole === 'manager';
        document.getElementById('ticketModalTitle').textContent = isAdminView ? 'Support Tickets' : 'My Tickets';
        _fetch();
        clearInterval(_pollTimer);
        _pollTimer = setInterval(_fetch, 60 * 1000); // every 60 sec
      }

      // New ticket button
      document.getElementById('ticketNewBtn').addEventListener('click', _showCompose);
      document.getElementById('ticketCancelBtn').addEventListener('click', _showList);
      document.getElementById('ticketDetailBackBtn').addEventListener('click', () => { _showList(); _renderList(); });

      // Submit ticket
      document.getElementById('ticketSubmitBtn').addEventListener('click', () => {
        const category = document.getElementById('ticketCategory').value;
        const subject  = (document.getElementById('ticketSubject').value || '').trim();
        const body     = (document.getElementById('ticketBody').value || '').trim();
        if (!subject) { document.getElementById('ticketSubject').focus(); return; }
        if (!body)    { document.getElementById('ticketBody').focus(); return; }
        document.getElementById('ticketSubmitBtn').disabled = true;
        api('createTicket', { category, subject, body }).then(res => {
          document.getElementById('ticketSubmitBtn').disabled = false;
          if (!res.success) { showPopup('error', 'Failed', res.message); return; }
          showPopup('success', 'Ticket Submitted', `Your ticket ${res.ticketNumber} has been submitted.`).then(() => { _showList(); _fetch(); });
        }).catch(() => { document.getElementById('ticketSubmitBtn').disabled = false; });
      });

      // Send reply
      document.getElementById('ticketReplySendBtn').addEventListener('click', () => {
        const body = (document.getElementById('ticketReplyInput').value || '').trim();
        if (!body) return;
        const btn = document.getElementById('ticketReplySendBtn');
        btn.disabled = true;
        document.getElementById('ticketReplyInput').value = '';
        api('replyTicket', { ticketId: _currentTicketId, body }).then(res => {
          btn.disabled = false;
          if (!res.success) { showPopup('error', 'Failed', res.message); return; }
          _fetch(true); // refresh but stay in detail view
        }).catch(() => { btn.disabled = false; });
      });

      // Update ticket status (admin)
      document.getElementById('ticketStatusSaveBtn').addEventListener('click', () => {
        const status = document.getElementById('ticketStatusSelect').value;
        api('updateTicketStatus', { ticketId: _currentTicketId, status }).then(res => {
          if (!res.success) { showPopup('error', 'Failed', res.message); return; }
          const t = _tickets.find(x => String(x.id) === String(_currentTicketId));
          if (t) { t.status = status; _showDetail(_currentTicketId); _renderList(); _updateTicketBadge(); }
        }).catch(() => {});
      });

      document.getElementById('ticketRefreshBtn').addEventListener('click', _fetch);

      // Click ticket row → open detail
      document.addEventListener('click', e => {
        const row = e.target.closest('.hdr-ticket-item[data-ticket-id]');
        if (!row) return;
        _showDetail(row.dataset.ticketId);
      });

      window._applyTicketData = (res) => {
        if (!res || !res.success) return;
        _tickets = res.data || [];
        _updateTicketBadge();
        _showList();
        _renderList();
      };
      window._startTicketSystem = _start;
      window._stopTicketSystem  = () => clearInterval(_pollTimer);
    })();

    // ── Profile icon button → go to profile section ──
    const hdrProfileBtn = document.getElementById('hdrProfileBtn');
    if (hdrProfileBtn) {
      hdrProfileBtn.addEventListener('click', () => showSection('s-profile'));
    }

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

  // ─── Phone mask: enforces (868) xxx-xxxx on every .phone-mask input ──────────
  // Prefix "(868) " is always present and locked; user types only 7 local digits.
  // Auto-inserts "-" after the 3rd local digit: (868) 123-4567
  const PREFIX = '(868) ';
  const PREFIX_LEN = PREFIX.length; // 6

  // Build masked string from local digits only (0–7 chars, no prefix, no dash)
  function _buildMasked(localDigits) {
    const d = localDigits.slice(0, 7);
    if (d.length === 0) return PREFIX;
    if (d.length <= 3) return PREFIX + d;
    return PREFIX + d.slice(0, 3) + '-' + d.slice(3);
  }

  // Extract the 7 local digits from any phone string (strips prefix, dashes, spaces)
  function _localDigits(raw) {
    if (!raw) return '';
    // Remove all non-digits, then strip leading 868 if present (from pasted full number)
    const all = raw.replace(/\D/g, '');
    return (all.startsWith('868') ? all.slice(3) : all).slice(0, 7);
  }

  // Set a phone-mask input's value programmatically (applies mask)
  function setPhone(idOrEl, value) {
    const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
    if (!el) return;
    el.value = value ? _buildMasked(_localDigits(value)) : '';
  }

  // Read the formatted value; returns '' if nothing was typed beyond the prefix
  function readPhone(idOrEl) {
    const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
    if (!el) return '';
    const digits = _localDigits(el.value);
    if (!digits) return '';
    return _buildMasked(digits);
  }

  (function setupPhoneMask() {
    function onInput(e) {
      const el = e.target;
      if (!(el instanceof Element) || !el.classList.contains('phone-mask')) return;

      // Snapshot digits before the cursor BEFORE rewriting the value
      const rawValue   = el.value;
      const cursorPos  = el.selectionStart;
      const beforeCursor = rawValue.slice(0, cursorPos);
      // Count local digits (non-868-prefix) that were before the cursor
      const digitsBeforeCursor = _localDigits(beforeCursor);

      // Rebuild the masked value
      const digits = _localDigits(rawValue);
      const masked = _buildMasked(digits);
      el.value = masked;

      // Place cursor after the same number of local digits in the new masked string
      const target = digitsBeforeCursor.length;
      let count = 0, newPos = PREFIX_LEN;
      for (let i = PREFIX_LEN; i < masked.length; i++) {
        if (masked[i] === '-') continue; // skip the dash character
        if (count === target) { newPos = i; break; }
        count++;
        newPos = masked.length; // ran out — put at end
      }
      if (count < target) newPos = masked.length; // typed past all digits → end
      newPos = Math.max(newPos, PREFIX_LEN);
      el.setSelectionRange(newPos, newPos);
    }

    function onFocus(e) {
      const el = e.target;
      if (!(el instanceof Element) || !el.classList.contains('phone-mask')) return;
      if (!_localDigits(el.value)) el.value = PREFIX;
      setTimeout(() => {
        if (el.selectionStart < PREFIX_LEN) el.setSelectionRange(PREFIX_LEN, PREFIX_LEN);
      }, 0);
    }

    function onKeydown(e) {
      const el = e.target;
      if (!(el instanceof Element) || !el.classList.contains('phone-mask')) return;
      const pos = el.selectionStart;
      const selEnd = el.selectionEnd;
      // Block backspace/delete from eating into the prefix (when no selection)
      if (e.key === 'Backspace' && pos <= PREFIX_LEN && pos === selEnd) { e.preventDefault(); return; }
      if (e.key === 'Delete'    && pos < PREFIX_LEN  && pos === selEnd) { e.preventDefault(); return; }
      // Block cursor from moving before the prefix
      if ((e.key === 'ArrowLeft' || e.key === 'Home') && pos <= PREFIX_LEN) {
        e.preventDefault();
        el.setSelectionRange(PREFIX_LEN, PREFIX_LEN);
      }
    }

    function onBlur(e) {
      const el = e.target;
      if (!(el instanceof Element) || !el.classList.contains('phone-mask')) return;
      if (!_localDigits(el.value)) el.value = ''; // clear prefix so placeholder shows
    }

    document.addEventListener('input',   onInput,   true);
    document.addEventListener('focus',   onFocus,   true);
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('blur',    onBlur,    true);
  })();

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
      // Employee modal close/cancel/save
      } else if (event.target.matches('#closeAddEmpModalBtn, #closeAddEmpModalBtn *')) {
        closeAddEmpModal();
      } else if (event.target.matches('#cancelAddEmpBtn, #cancelAddEmpBtn *')) {
        closeAddEmpModal();
      } else if (event.target.matches('#saveEmployeeBtn, #saveEmployeeBtn *')) {
        addEmployee();
      } else if (event.target.matches('#closeEditEmpModalBtn, #closeEditEmpModalBtn *')) {
        closeEditEmpModal();
      } else if (event.target.matches('#cancelEditEmpBtn, #cancelEditEmpBtn *')) {
        closeEditEmpModal();
      } else if (event.target.matches('#updateEmployeeBtn, #updateEmployeeBtn *')) {
        updateEmployee();
      // Employee profile drawer
      } else if (event.target.matches('#closeEmpDrawerBtn, #closeEmpDrawerBtn *')) {
        closeEmpDrawer();
      } else if (event.target.matches('#empProfileDrawer') && !event.target.closest('.emp-drawer')) {
        closeEmpDrawer();
      } else if (event.target.matches('#empDrawerEditBtn, #empDrawerEditBtn *')) {
        const u = document.getElementById('empProfileDrawer').dataset.username;
        closeEmpDrawer();
        if (u) setTimeout(() => editEmployee(u), 300);
      } else if (event.target.matches('#empDrawerDeleteBtn, #empDrawerDeleteBtn *')) {
        const u = document.getElementById('empProfileDrawer').dataset.username;
        closeEmpDrawer();
        if (u) setTimeout(() => deleteEmployee(u), 300);
      // Employee view toggle
      } else if (event.target.matches('#empCardViewBtn, #empCardViewBtn *')) {
        _empCardView = true;
        document.getElementById('empCardView').style.display = '';
        document.getElementById('empTableView').style.display = 'none';
        document.getElementById('empCardViewBtn').classList.add('active');
        document.getElementById('empTableViewBtn').classList.remove('active');
        _renderEmployees();
      } else if (event.target.matches('#empTableViewBtn, #empTableViewBtn *')) {
        _empCardView = false;
        document.getElementById('empCardView').style.display = 'none';
        document.getElementById('empTableView').style.display = '';
        document.getElementById('empTableViewBtn').classList.add('active');
        document.getElementById('empCardViewBtn').classList.remove('active');
        _renderEmployees();
      } else if (event.target.matches('#deptCardViewBtn, #deptCardViewBtn *')) {
        _deptListView = false; _applyDeptView();
      } else if (event.target.matches('#deptListViewBtn, #deptListViewBtn *')) {
        _deptListView = true; _applyDeptView();
      } else if (event.target.matches('#addDepartmentBtn, #addDepartmentBtn *')) {
        showAddDepartmentModal();
      } else if (event.target.matches('#closeDeptModalBtn, #closeDeptModalBtn *')) {
        closeDeptModal();
      } else if (event.target.matches('#cancelDeptModalBtn, #cancelDeptModalBtn *')) {
        closeDeptModal();
      } else if (event.target.matches('#saveDepartmentBtn, #saveDepartmentBtn *')) {
        addDepartment();
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
    
    // Department search — live filter as user types
    document.addEventListener('input', function(event) {
      if (event.target.matches('#deptSearchInput')) {
        displayDepartments(departments);
      }
      // Employee search live filter
      if (event.target.matches('#empSearchInput')) {
        _renderEmployees();
      }
      // Attendance search / dept filter — client-side re-render
      if (event.target.matches('#attSearchInput') || event.target.matches('#attDeptFilter')) {
        _renderAttTable();
      }
      if (event.target.matches('#projectSearchInput')) {
        displayProjectSites(projectSites);
      }
      if (event.target.matches('#leaveSearchInput')) {
        _lvAdmSearch = event.target.value;
        _renderAdmLeaves();
      }
      if (event.target.matches('#empLeaveSearch')) {
        _renderEmpLeaves();
      }
      if (event.target.matches('#leaveTypeFilter')) {
        _lvAdmTypeFilter = event.target.value;
        _renderAdmLeaves();
      }
      if (event.target.matches('#hrSearchInput')) {
        _hrSearch = event.target.value;
        renderHourlyRates();
      }
    });

    // Attendance month/year selects — reload from API
    document.addEventListener('change', function(event) {
      if (event.target.matches('#attendanceMonth') || event.target.matches('#attendanceYear')) {
        loadAttendanceData();
      }
      // Employee role/status filter
      if (event.target.matches('#empRoleFilter') || event.target.matches('#empStatusFilter')) {
        _renderEmployees();
      }
      // Hourly rates dept/role filter
      if (event.target.matches('#hrDeptFilter')) { _hrDept = event.target.value; renderHourlyRates(); }
      if (event.target.matches('#hrRoleFilter')) { _hrRole = event.target.value; renderHourlyRates(); }
      // Hourly rates CSV file picker
      if (event.target.matches('#hrFileInput')) {
        const f = event.target.files && event.target.files[0];
        event.target.value = '';
        if (f) _hrHandleFile(f);
      }
    });

    // Export attendance (CSV via DataTables built-in)
    document.addEventListener('click', function(event) {
      if (event.target.matches('#exportAttendanceBtn, #exportAttendanceBtn *')) {
        const btn = document.querySelector('.dt-button.buttons-csv, .dt-button.buttons-excel');
        if (btn) btn.click();
        else showPopup('info', 'Export', 'Use the DataTable export buttons to download.');
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
      } else if (event.target.closest('.emp-card') && !event.target.closest('.emp-card-footer')) {
        // Click anywhere on card (outside action buttons) → open profile drawer
        const card = event.target.closest('.emp-card');
        const username = card.querySelector('.btn-edit-employee') && card.querySelector('.btn-edit-employee').dataset.username;
        if (username) openEmpDrawer(username);
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

      // Live map: center map button
      if (event.target.closest('#centerMapBtn')) {
        if (map) {
          if (liveMarkers.length) {
            try { map.fitBounds(L.featureGroup(liveMarkers).getBounds().pad(0.2)); } catch (_) {}
          } else if (attendanceZones.length) {
            try { map.fitBounds(L.featureGroup(attendanceZones).getBounds().pad(0.25)); } catch (_) {}
          } else {
            map.setView([10.6549, -61.5019], 12);
          }
        }
      }

      // Live map: click employee item → focus marker
      const liveCard = event.target.closest('.lm-emp-item') || event.target.closest('.live-emp-card');
      if (liveCard) focusLiveEmployee(liveCard.dataset.userid);

      // Hourly rates — action buttons
      if (event.target.closest('#refreshRatesBtn')) loadHourlyRates();
      if (event.target.closest('#saveAllRatesBtn')) _hrSaveAll();
      if (event.target.closest('#exportRatesCsvBtn')) _hrExportCsv();
      if (event.target.closest('#importRatesCsvBtn')) _hrOpenModal();
      if (event.target.closest('#hrCloseModalBtn') || event.target.closest('#hrCancelModalBtn')) _hrCloseModal();
      if (event.target.closest('#hrConfirmImportBtn')) _hrConfirmImport();
      if (event.target.closest('#hrFileDrop') || event.target.closest('#hrFileDrop label')) {
        document.getElementById('hrFileInput')?.click();
      }
      if (event.target.closest('#hrResetFiltersBtn')) {
        _hrSearch = ''; _hrDept = 'all'; _hrRole = 'all';
        const si = document.getElementById('hrSearchInput');
        const df = document.getElementById('hrDeptFilter');
        const rf = document.getElementById('hrRoleFilter');
        if (si) si.value = ''; if (df) df.value = 'all'; if (rf) rf.value = 'all';
        renderHourlyRates();
      }
      const saveBtn = event.target.closest('.btn-save-rate');
      if (saveBtn) saveHourlyRate(saveBtn.dataset.username, saveBtn);

      // Payroll — generate + print
      if (event.target.closest('#generatePayrollBtn')) generatePayroll();
      if (event.target.closest('#printPayrollBtn'))    printPayroll();

      // My Profile
      if (event.target.closest('#pickProfileImageBtn'))    pickProfileImage();
      if (event.target.closest('#editAvatarBtn'))          pickProfileImage();
      if (event.target.closest('#removeProfileImageBtn')) removeProfileImage();
      if (event.target.closest('#saveProfileBtn'))        saveMyProfile();
      if (event.target.closest('#updateSecurityBtn'))    _updateSecurityOnly();
      if (event.target.closest('#uploadDocBtn'))         _profileToast('Document upload coming soon.', false);

      // Admin: branding + payroll rules
      if (event.target.closest('#pickLogoBtn'))             pickLogo();
      if (event.target.closest('#saveLogoBtn'))             saveLogo();
      if (event.target.closest('#savePayrollSettingsBtn'))  savePayrollSettings();

      // Leave tabs
      const lvTab = event.target.closest('.lv-tab-btn');
      if (lvTab) {
        const id = lvTab.dataset.lvTab;
        const section = lvTab.closest('.app-section');
        section.querySelectorAll('.lv-tab-btn').forEach(b => b.classList.remove('active'));
        lvTab.classList.add('active');
        if (id.startsWith('emp-')) { _lvEmpTab = id; _renderEmpLeaves(); }
        else if (id.startsWith('mgr-')) { _lvMgrTab = id; _renderMgrLeaves(); }
        else if (id.startsWith('adm-')) { _lvAdmTab = id; _renderAdmLeaves(); }
      }

      // Settings tabs
      const stgTab = event.target.closest('.stg-tab-btn');
      if (stgTab) {
        document.querySelectorAll('.stg-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.stg-tab-pane').forEach(p => p.classList.remove('active'));
        stgTab.classList.add('active');
        const pane = document.getElementById('stg-' + stgTab.dataset.stgTab);
        if (pane) pane.classList.add('active');
      }

      // Profile tabs
      const epTab = event.target.closest('.ep-tab-btn');
      if (epTab) {
        document.querySelectorAll('.ep-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.ep-tab-pane').forEach(p => p.classList.remove('active'));
        epTab.classList.add('active');
        const pane = document.getElementById('ep-tab-' + epTab.dataset.epTab);
        if (pane) pane.classList.add('active');
      }

      // Settings: Save All (only fires payroll save for admin; palette/layout save on click)
      if (event.target.closest('#saveAllSettingsBtn')) savePayrollSettings();

      // Settings: Reset to Defaults
      if (event.target.closest('#resetDefaultsBtn')) _stgResetDefaults();

      // Settings: Clear Cache — wipes SW caches + IndexedDB + in-memory SWR + localStorage
      if (event.target.closest('#clearCacheBtn')) {
        if (typeof SwCacheManager !== 'undefined') SwCacheManager.clearAll();
        localStorage.clear();
        cpop.fire({ icon: 'success', title: 'Cache cleared', text: 'Page will reload.', showConfirmButton: true })
          .then(() => location.reload());
      }
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

  // Real-time clock — header shows "HH:MM:SS AM/PM · Mon DD, YYYY"
  function updateClock() {
    const now = new Date();
    // Header pill: "01:31:46 AM · May 7, 2026"
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const isoDate = now.toISOString().slice(0, 10); // YYYY-MM-DD for employee section

    const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    set('isoClock',  `${timeStr} · ${dateStr}`);
    set('currentTime', now.toTimeString().slice(0, 8)); // employee big clock HH:MM:SS
    set('currentDate', isoDate);                        // employee section date row
  }

  function switchLanguage() { /* removed — English only */ }

  function updateLanguageUI() {
    const t = translations.en;
    Object.keys(t).forEach(key => {
      const element = document.getElementById(key);
      // Only update elements explicitly marked as translation targets.
      // Stat value divs share IDs with translation keys but must not be overwritten.
      if (element && element.dataset.i18n === key) element.textContent = t[key];
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
    const errBanner = document.getElementById('loginErrorBanner');
    if (errBanner) { errBanner.style.display = 'none'; errBanner.textContent = ''; }
    
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

    // Wipe any existing session immediately so a refresh mid-login
    // doesn't restore the previous user
    clearSession();

    showSpinner('Authenticating...');

    api('login', { username, password }).then(handleLoginSuccess);
  }

  function handleLoginSuccess(result) {
    hideSpinner();

    if (!result.success) {
      const msg = result.message || 'Invalid username or password.';
      // Show inline error banner
      const errBanner = document.getElementById('loginErrorBanner');
      if (errBanner) { errBanner.textContent = msg; errBanner.style.display = 'flex'; }
      // Shake + highlight both fields
      const uEl = document.getElementById('username');
      const pEl = document.getElementById('password');
      if (uEl) { uEl.classList.add('is-invalid'); }
      if (pEl) { pEl.classList.add('is-invalid'); pEl.value = ''; pEl.focus(); }
      return;
    }

    // Clear any previous session before writing the new one so a refresh
    // never restores a different user's session
    clearSession();
    currentUser = null; currentUserId = null; currentFullName = null;
    currentDeptId = null; currentRole = null;

    const rememberMe = document.getElementById('rememberMe').checked;
    if (rememberMe) {
      localStorage.setItem('rememberedUser', result.username);
    } else {
      localStorage.removeItem('rememberedUser');
    }

    // persist session — 7 days if remember me, 1 hour otherwise
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

    // populate header profile avatar — use preloaded image if ready, else probe
    const hdrAvatarEl = document.getElementById('hdrProfileAvatar');
    if (hdrAvatarEl) {
      const initial = (currentFullName || currentUser || '?').trim().charAt(0).toUpperCase();
      if (result.profileImage) {
        _swapAvatarImg(hdrAvatarEl, result.profileImage, initial, 'hdr');
      } else {
        hdrAvatarEl.textContent = initial;
      }
    }

    // Seed the profile photo from the session so opening My Profile never
    // shows the red-circle fallback while waiting for getEmployeeByUsername.
    // This is always up-to-date: saved at login and patched on every profile save.
    if (result.profileImage !== undefined) {
      _currentProfileImage = result.profileImage || '';
    }

    // company logo (if admin uploaded one) — apply to login screen + sidebar brand
    if (result.companyLogoUrl) applyCompanyLogo(result.companyLogoUrl);

    // company name — sidebar brand + About header (set everywhere from Settings)
    applyCompanyName(result.companyName || 'My Company');
    refreshCompanySettings();

    // gate admin-only Settings cards and tabs
    document.querySelectorAll('.admin-only').forEach(el => {
      el.style.display = currentRole === 'admin' ? '' : 'none';
    });
    document.querySelectorAll('.non-admin-only').forEach(el => {
      el.style.display = currentRole !== 'admin' ? '' : 'none';
    });
    // For admins, activate Company tab; for others Security is already default
    if (currentRole === 'admin') {
      document.querySelectorAll('.stg-tab-btn').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.stg-tab-pane').forEach(pane => pane.classList.remove('active'));
      const companyBtn = document.querySelector('.stg-tab-btn[data-stg-tab="company"]');
      if (companyBtn) companyBtn.classList.add('active');
      const companyPane = document.getElementById('stg-company');
      if (companyPane) companyPane.classList.add('active');
    }

    // build per-role menu and always open the dashboard on login
    buildSidebar(currentRole);
    buildTopTabs(currentRole);
    const def = (SECTION_DEFS[currentRole] || [ABOUT_ITEM])[0];
    // Clear any stored last-section so refreshing after logout also goes to dashboard
    try { localStorage.removeItem('siomac_last_section_' + currentRole); } catch(e) {}
    showSection(def.id);

    // employee-only setup (welcome card + location tracking)
    if (currentRole === 'employee') {
      _setAttendanceAvatar(result.profileImage || '', currentFullName);
      document.getElementById('displayNameText').textContent = currentFullName;
      // Role + department subtitle
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

    // Single lightweight call — gets all badge counts at once so all badges
    // appear simultaneously on login, then each system polls independently
    _rawApi('getHeaderCounts', { managerUsername: currentUser, role: currentRole }).then(res => {
      if (!res || !res.success) return;
      const c = res.data || {};
      // Bell badge — cross-reference returned IDs with locally-stored read IDs
      const _storedReadIds = (() => { try { return new Set(JSON.parse(localStorage.getItem('siomac_read_notifs_v1') || '[]')); } catch { return new Set(); } })();
      const unreadNotifs = (c.notificationIds || []).filter(id => !_storedReadIds.has(id)).length;
      const notifBadge = document.getElementById('hdrNotifBadge');
      _setHdrBadge(document.getElementById('hdrNotifBadge'), unreadNotifs);
      // Messages badge
      _setHdrBadge(document.getElementById('hdrMsgBadge'), c.messages || 0);
      // Tickets badge
      _setHdrBadge(document.getElementById('hdrTicketBadge'), c.tickets || 0);
      // Sidebar leave badge
      if (typeof window._refreshNavBadges === 'function') window._refreshNavBadges(c.pendingLeaves || 0);
    }).catch(() => {});

    // Start full polling (fetches complete data for each system independently)
    if (typeof window._startNotifPolling  === 'function') window._startNotifPolling();
    if (typeof window._startMsgSystem     === 'function') window._startMsgSystem();
    if (typeof window._startTicketSystem  === 'function') window._startTicketSystem();

    // No login success popup — dashboard loads immediately
  }

  function startAutoSync() {
    // Single interval — refreshes the active section every 60s.
    // No immediate fire on login (section just loaded). No indicator —
    // apiSwr dedup means re-renders only happen when data actually changed,
    // so there's nothing disruptive to signal to the user.
    syncInterval = setInterval(syncData, 60000);
  }

  function stopAutoSync() {
    if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
  }

  function syncData() {
    lastSyncTime = new Date().toISOString();
    refreshCurrentView();
  }

  // Sections that have no live data — skip on background sync
  const _noSyncSections = new Set(['s-settings', 's-profile', 's-payroll', 's-adm-rates']);

  // Returns true if the user is actively typing, has a dropdown open, a modal is visible,
  // or the dashboard layout editor is open. In any of these cases background sync skips.
  function _userIsInteracting() {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (document.querySelector('.modal.show')) return true;
    if (_dashEditMode) return true;
    return false;
  }

  // refresh the currently-visible section (called every 60s by syncData)
  function refreshCurrentView() {
    if (_userIsInteracting()) return;
    const active = document.querySelector('.app-section.active');
    if (active && !_noSyncSections.has(active.id)) refreshSection(active.id);
  }

  function handleLogout() {
    if (currentUser) api('logout', { userId: currentUserId, username: currentUser });

    stopCamera();
    stopAutoSync();
    clearSession();
    if (locationWatchId && navigator.geolocation) navigator.geolocation.clearWatch(locationWatchId);

    currentUser = null;
    currentUserId = null;
    currentFullName = null;
    currentDeptId = null;
    currentRole = null;
    cameraStream = null;
    _currentProfileImage = null; // reset so next login fetches fresh from DB
    _resetLoadedState();        // reset so all sections show skeletons again on next login
    locationWatchId = null;
    syncInterval = null;
    if (typeof window._stopNotifPolling  === 'function') window._stopNotifPolling();
    if (typeof window._stopMsgSystem     === 'function') window._stopMsgSystem();
    if (typeof window._stopTicketSystem  === 'function') window._stopTicketSystem();

    // hide app shell, surface login
    document.getElementById('appShell').classList.add('hidden');
    document.getElementById('loginPage').classList.remove('hidden');
    document.querySelectorAll('.app-section').forEach(s => s.classList.remove('active'));
    document.getElementById('sidebarMenu').innerHTML = '';
    document.getElementById('password').value = '';
    document.getElementById('loginForm').reset();
  }

  function checkStatus() {
    _skelOnce('s-emp-attendance', () => {
      const sb = document.getElementById('statusBadge');
      if (sb) sb.innerHTML = '<div class="skeleton skel-pill"></div>';
    });
    apiSwr('getMyStatus', { username: currentUser }, {
      onData: res => {
        const status = (res && res.success && res.data) || { hasCheckedIn:false, hasCheckedOut:false, checkInTime:null, checkOutTime:null, location:'' };
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
      checkInBtn.classList.add('hidden');
      checkOutBtn.classList.remove('hidden');
      checkOutBtn.disabled = false;
    } else if (status.hasCheckedIn && status.hasCheckedOut) {
      statusBadge.innerHTML = '<i class="fas fa-sign-out-alt"></i> Checked Out';
      statusBadge.className = 'ea-status-badge ea-status-out';
      checkOutBtn.classList.add('hidden');
      checkInBtn.classList.remove('hidden');
      checkInBtn.disabled = true;
      checkInBtn.style.opacity = '';
      checkInBtn.style.cursor = 'default';
      checkInBtn.className = 'ea-action-btn ea-action-btn-complete';
      checkInBtn.innerHTML = '<i class="fas fa-calendar-check"></i> Attendance Complete';
    } else {
      statusBadge.innerHTML = '<i class="fas fa-clock"></i> Not Checked In';
      statusBadge.className = 'ea-status-badge ea-status-none';
      checkInBtn.classList.remove('hidden');
      checkInBtn.disabled = false;
      checkInBtn.style.opacity = '';
      checkInBtn.style.cursor = '';
      checkInBtn.innerHTML = '<i class="fas fa-camera"></i> <span id="checkInText">Check In</span>';
      checkOutBtn.classList.add('hidden');
    }

    document.getElementById('checkInTime').textContent  = status.checkInTime  ? fmtLocalTime(status.checkInTime)  : '--:--';
    document.getElementById('checkOutTime').textContent = status.checkOutTime ? fmtLocalTime(status.checkOutTime) : '--:--';
    if (status.location) document.getElementById('currentLocation').textContent = status.location;

    // Live hours counter while checked in
    const hoursEl = document.getElementById('todayHoursDisplay');
    if (hoursEl) {
      if (status.hasCheckedIn && !status.hasCheckedOut && status.checkInTime) {
        const diff = (Date.now() - new Date(status.checkInTime).getTime()) / 3600000;
        hoursEl.textContent = Math.max(0, diff).toFixed(1) + ' hrs';
      } else if (status.hasCheckedIn && status.checkInTime && status.checkOutTime) {
        const diff = (new Date(status.checkOutTime).getTime() - new Date(status.checkInTime).getTime()) / 3600000;
        hoursEl.textContent = Math.max(0, diff).toFixed(1) + ' hrs';
      } else {
        hoursEl.textContent = '0.0 hrs';
      }
    }
  }

  function openCameraModal(action) {
    currentAttendanceAction = action;
    capturedPhotoData = null;
    currentLocationData = null;

    // Reset to initial state
    document.getElementById('captureBtn').classList.remove('d-none');
    document.getElementById('retakeBtn').classList.add('d-none');
    document.getElementById('confirmBtn').classList.add('d-none');
    document.getElementById('capturedPhoto').classList.add('d-none');
    document.querySelector('.cm-camera-area').classList.remove('d-none');
    document.getElementById('cameraPreview').classList.remove('d-none');
    document.getElementById('photoCanvas').classList.add('d-none');

    // Title
    const isCheckIn = action === 'CheckIn';
    const titleEl = document.getElementById('cameraModalTitle');
    titleEl.innerHTML = `<i class="fas fa-camera"></i> ${isCheckIn ? 'Check In' : 'Check Out'} · Selfie Verification`;

    // Confirm text
    document.getElementById('confirmText').textContent = isCheckIn ? 'Confirm Check In' : 'Confirm Check Out';

    // Site selector — only for check-in
    const siteWrap = document.getElementById('cmSiteWrap');
    const siteSelect = document.getElementById('cmSiteSelect');
    const siteStatus = document.getElementById('cmSiteStatus');
    if (isCheckIn) {
      siteWrap.style.display = '';
      siteSelect.innerHTML = '<option value="">— Choose a site —</option>';
      siteStatus.textContent = '';
      document.getElementById('confirmBtn').disabled = true;
      // Populate from already-loaded projectSites, or fetch fresh
      const populate = (sites) => {
        siteSelect.innerHTML = '<option value="">— Choose a site —</option>'
          + sites.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
      };
      if (projectSites && projectSites.length) {
        populate(projectSites);
      } else {
        api('listProjectSites', {}).then(res => {
          projectSites = (res && res.success && res.data) || [];
          populate(projectSites);
        });
      }
    } else {
      siteWrap.style.display = 'none';
    }

    // Location — start pending
    const locEl = document.getElementById('locationValidation');
    locEl.className = 'cm-location cm-location--pending';
    locEl.innerHTML = '<i class="fas fa-spinner fa-pulse fa-fw"></i><span>Verifying your location…</span>';

    getCurrentLocation().then(location => {
      currentLocationData = location;
      const accuracy = location.fallback ? 'Approximate location' : `Accuracy: ${Math.round(location.accuracy)}m`;
      locEl.className = 'cm-location cm-location--valid';
      locEl.innerHTML = `<i class="fas fa-check-circle fa-fw"></i><span>Location verified · ${accuracy}</span>`;
      // For check-in, confirm stays disabled until a site is selected
      if (!isCheckIn) document.getElementById('confirmBtn').disabled = false;
    }).catch(() => {
      locEl.className = 'cm-location cm-location--valid';
      locEl.innerHTML = '<i class="fas fa-check-circle fa-fw"></i><span>Location available</span>';
      if (!isCheckIn) document.getElementById('confirmBtn').disabled = false;
    });

    startCamera();
    const cameraModal = new bootstrap.Modal(document.getElementById('cameraModal'));
    cameraModal.show();
  }

  // Site select change handler — enable confirm only when a site is chosen
  document.getElementById('cmSiteSelect').addEventListener('change', function () {
    const confirmBtn = document.getElementById('confirmBtn');
    const siteStatus = document.getElementById('cmSiteStatus');
    if (this.value) {
      confirmBtn.disabled = false;
      siteStatus.innerHTML = `<span style="color:green;"><i class="fas fa-check-circle"></i> ${escapeHtml(this.options[this.selectedIndex].text)} selected</span>`;
    } else {
      confirmBtn.disabled = true;
      siteStatus.textContent = '';
    }
  });

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
    document.querySelector('.cm-camera-area').classList.add('d-none');
    document.getElementById('cameraPreview').classList.add('d-none');
    // Update title to "Verify Selfie"
    document.getElementById('cameraModalTitle').innerHTML = '<i class="fas fa-check-circle"></i> Verify Selfie';
    stopCamera();
  }

  function retakePhoto() {
    document.getElementById('captureBtn').classList.remove('d-none');
    document.getElementById('retakeBtn').classList.add('d-none');
    document.getElementById('confirmBtn').classList.add('d-none');
    document.getElementById('capturedPhoto').classList.add('d-none');
    document.querySelector('.cm-camera-area').classList.remove('d-none');
    document.getElementById('cameraPreview').classList.remove('d-none');
    capturedPhotoData = null;
    const action = currentAttendanceAction;
    document.getElementById('cameraModalTitle').innerHTML = `<i class="fas fa-camera"></i> ${action === 'CheckIn' ? 'Check In' : 'Check Out'} · Selfie Verification`;
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

    const siteSelect = document.getElementById('cmSiteSelect');
    const siteId = (currentAttendanceAction === 'CheckIn' && siteSelect) ? (siteSelect.value || '') : '';

    api('markAttendance', {
      username: currentUser,
      action: currentAttendanceAction,
      photoBase64: capturedPhotoData,
      location: loc,
      siteId
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


  function loadChart() {
    const today = new Date();
    apiSwr('getMyChart', { username: currentUser, year: today.getFullYear(), month: today.getMonth() }, {
      onData: res => { if (res && res.success) displayChart(res.data); }
    });
  }

  // Populate monthly summary cards + hidden donut chart
  function displayChart(stats) {
    SiomacCharts.displayAttendanceChart(stats);
    _countUp(document.getElementById('empPresentDays'), stats.present);
    _countUp(document.getElementById('empLateDays'),    stats.late ?? 0);
    _countUp(document.getElementById('empAbsentDays'),  stats.absent);
    _countUp(document.getElementById('empSundayDays'),  stats.sundays);
    _countUp(document.getElementById('empTotalDays'),   (stats.present ?? 0) + (stats.absent ?? 0));
  }

  // Admin dashboard charts — full render on first load, silent in-place update on revisits
  function loadDashboardCharts(forceReload) {
    apiSwr('getDashboardCharts', {}, {
      force: !!forceReload,
      onData: res => {
        if (!res || !res.success) return;
        if (_isLoaded('s-adm-dashboard-charts') && !forceReload) {
          SiomacCharts.updateDashboardCharts(res.data); // silent patch, no flicker
        } else {
          SiomacCharts.renderDashboardCharts(res.data); // full render on first load
          _markLoaded('s-adm-dashboard-charts');
        }
      }
    });
  }

  // ─── Dashboard layout editor ───
  const DASH_LAYOUT_KEY = 'siomac_dash_layout_v1';
  const DASH_WIDGETS = [
    { id: 'trend',    title: 'Weekly Attendance Trend' },
    { id: 'dept',     title: 'Department Distribution' },
    { id: 'status',   title: "Today's Status" },
    { id: 'leave',    title: 'Leave Types · This Month' },
    { id: 'activity', title: 'Recent Activity' },
  ];
  let _dashSortable  = null;
  let _dashEditMode  = false;
  let _dashInitDone  = false;

  function _dashLoadLayout() {
    try { return JSON.parse(localStorage.getItem(DASH_LAYOUT_KEY)) || {}; } catch { return {}; }
  }
  let _dashSaveTimer = null;
  function _dashSaveLayout(immediate) {
    // Write current widget order + hidden state to localStorage.
    // Use a short debounce to coalesce rapid onEnd events from fast drags.
    // Pass immediate=true (e.g. on Done / navigate away) to flush synchronously.
    clearTimeout(_dashSaveTimer);
    const doSave = () => {
      const grid  = document.getElementById('dashWidgetGrid');
      const order = [];
      // All widgets live inside dashWidgetGrid — just read their DOM order directly.
      if (grid) grid.querySelectorAll('.dash-widget').forEach(w => order.push(w.dataset.widgetId));
      const hidden = DASH_WIDGETS.filter(w => {
        const el = document.querySelector(`.dash-widget[data-widget-id="${w.id}"]`);
        return el && el.classList.contains('dash-widget-hidden');
      }).map(w => w.id);
      localStorage.setItem(DASH_LAYOUT_KEY, JSON.stringify({ order, hidden }));
    };
    if (immediate) { doSave(); }
    else { _dashSaveTimer = setTimeout(doSave, 80); }
  }
  function _dashApplyLayout() {
    const { order = [], hidden = [] } = _dashLoadLayout();
    const grid = document.getElementById('dashWidgetGrid');
    if (!grid) return;

    // Restore widget order — all widgets are direct children of dashWidgetGrid
    if (order.length) {
      const allWidgets = {};
      grid.querySelectorAll('.dash-widget').forEach(w => {
        allWidgets[w.dataset.widgetId] = w;
      });
      order.forEach(id => {
        const el = allWidgets[id];
        if (el) grid.appendChild(el); // appendChild moves it to end in saved order
      });
    }

    // Apply hidden state
    DASH_WIDGETS.forEach(({ id }) => {
      const el = document.querySelector(`#s-adm-dashboard .dash-widget[data-widget-id="${id}"]`);
      if (!el) return;
      if (hidden.includes(id)) el.classList.add('dash-widget-hidden');
      else el.classList.remove('dash-widget-hidden');
    });

    _dashUpdateHiddenPanel(hidden);
  }
  function _dashUpdateHiddenPanel(hidden) {
    const container = document.getElementById('dashHiddenWidgets');
    if (!container) return;
    if (!hidden || hidden.length === 0) {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }
    container.style.display = 'flex';
    container.innerHTML = hidden.map(id => {
      const w = DASH_WIDGETS.find(x => x.id === id);
      return w ? `<button class="dash-restore-btn" data-widget-id="${id}"><i class="fas fa-plus-circle"></i> ${w.title}</button>` : '';
    }).join('');
    container.querySelectorAll('.dash-restore-btn').forEach(btn => {
      btn.addEventListener('click', () => _dashShowWidget(btn.dataset.widgetId));
    });
  }
  function _dashHideWidget(id) {
    const el = document.querySelector(`.dash-widget[data-widget-id="${id}"]`);
    if (el) el.classList.add('dash-widget-hidden');
    _dashSaveLayout(true);
    const { hidden = [] } = _dashLoadLayout();
    _dashUpdateHiddenPanel(hidden);
  }
  function _dashShowWidget(id) {
    const el = document.querySelector(`.dash-widget[data-widget-id="${id}"]`);
    if (el) el.classList.remove('dash-widget-hidden');
    _dashSaveLayout(true);
    const { hidden = [] } = _dashLoadLayout();
    _dashUpdateHiddenPanel(hidden);
  }
  function _dashToggleEditMode() {
    const section   = document.getElementById('s-adm-dashboard');
    const editBtn   = document.getElementById('dashEditBtn');
    const resetBtn  = document.getElementById('dashResetBtn');
    const grid      = document.getElementById('dashWidgetGrid');
    if (!section || !grid) return;

    _dashEditMode = !_dashEditMode;
    section.classList.toggle('dash-edit-mode', _dashEditMode);

    if (_dashEditMode) {
      editBtn.classList.add('active');
      editBtn.innerHTML = '<i class="fas fa-check"></i> Done';
      resetBtn.style.display = '';
      _dashSortable = Sortable.create(grid, {
        animation: 250,
        ghostClass: 'dash-sortable-ghost',
        dragClass: 'dash-sortable-drag',
        filter: 'button, a, input, select, canvas',
        preventOnFilter: false,
        onEnd: () => requestAnimationFrame(() => _dashSaveLayout()),
      });
    } else {
      editBtn.classList.remove('active');
      editBtn.innerHTML = '<i class="fas fa-edit"></i> Edit Layout';
      resetBtn.style.display = 'none';
      if (_dashSortable) { _dashSortable.destroy(); _dashSortable = null; }
      _dashSaveLayout(true); // flush immediately on Done
    }
  }
  function _dashReset() {
    localStorage.removeItem(DASH_LAYOUT_KEY);
    // Restore default order inside grid
    const grid = document.getElementById('dashWidgetGrid');
    if (grid) {
      ['trend','dept','status','leave','activity'].forEach(id => {
        const el = grid.querySelector(`.dash-widget[data-widget-id="${id}"]`);
        if (el) grid.appendChild(el);
      });
    }
    document.querySelectorAll('.dash-widget').forEach(el => el.classList.remove('dash-widget-hidden'));
    _dashUpdateHiddenPanel([]);
    if (_dashEditMode) _dashToggleEditMode();
  }
  function initDashboardLayoutEditor() {
    // Only re-apply layout when not in edit mode (edit mode already has live Sortable)
    if (!_dashEditMode) _dashApplyLayout();
    if (_dashInitDone) return;
    _dashInitDone = true;
    const editBtn  = document.getElementById('dashEditBtn');
    const resetBtn = document.getElementById('dashResetBtn');
    if (editBtn)  editBtn.addEventListener('click', _dashToggleEditMode);
    if (resetBtn) resetBtn.addEventListener('click', _dashReset);
    // Hide buttons — event delegation on the section
    const section = document.getElementById('s-adm-dashboard');
    if (section) {
      section.addEventListener('click', e => {
        const btn = e.target.closest('.dash-hide-btn');
        if (btn && _dashEditMode) _dashHideWidget(btn.dataset.widgetId);
      });
    }
  }

  // Last 7 days hours bar chart — pulls from the same getMyHistory endpoint
  function loadTrendChart() {
    apiSwr('getMyHistory', { username: currentUser, days: 7 }, {
      onData: res => { displayTrendChart((res && res.success && res.data) || []); }
    });
  }

  function displayTrendChart(records) {
    SiomacCharts.displayTrendChart(records);
  }

  // ─── Employee History ───
  let _historyRawData = [];
  let _historySearch  = '';
  let _historyStatus  = 'all';

  function loadHistoryInline() {
    const args = { username: currentUser, days: 30 };
    _skelOnce('s-emp-history', () => setSkel('historyTableBody', skelTableRows(7, 8)));
    apiSwr('getMyHistory', args, {
      onData: res => {
        _markLoaded('s-emp-history');
        _historyRawData = (res && res.success && res.data) || [];
        _renderHistoryPage();
        _bindHistoryControls();
      }
    });
  }

  function _bindHistoryControls() {
    const search = document.getElementById('histSearchInput');
    const filter = document.getElementById('histStatusFilter');
    const reset  = document.getElementById('histResetBtn');
    const exportBtn = document.getElementById('exportHistoryBtn');
    if (search && !search._ehBound) {
      search._ehBound = true;
      search.addEventListener('input', e => { _historySearch = e.target.value; _renderHistoryPage(); });
    }
    if (filter && !filter._ehBound) {
      filter._ehBound = true;
      filter.addEventListener('change', e => { _historyStatus = e.target.value; _renderHistoryPage(); });
    }
    if (reset && !reset._ehBound) {
      reset._ehBound = true;
      reset.addEventListener('click', () => {
        _historySearch = ''; _historyStatus = 'all';
        if (search) search.value = '';
        if (filter) filter.value = 'all';
        _renderHistoryPage();
      });
    }
    if (exportBtn && !exportBtn._ehBound) {
      exportBtn._ehBound = true;
      exportBtn.addEventListener('click', _exportHistoryCSV);
    }
  }

  function _renderHistoryPage() {
    let data = _historyRawData;

    // Filter
    if (_historySearch) {
      const q = _historySearch.toLowerCase();
      data = data.filter(r => (r.date || '').includes(q) ||
        new Date(r.date).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase().includes(q));
    }
    if (_historyStatus !== 'all') {
      data = data.filter(r => (r.status || '').toLowerCase() === _historyStatus);
    }

    // Stats from full dataset (not filtered)
    const all = _historyRawData;
    const present = all.filter(r => r.status === 'present').length;
    const late    = all.filter(r => r.status === 'late').length;
    const withHours = all.filter(r => Number(r.hours) > 0);
    const avg = withHours.length ? (withHours.reduce((s, r) => s + Number(r.hours), 0) / withHours.length).toFixed(1) : '0';
    _countUp(document.getElementById('histTotalDays'),    all.length);
    _countUp(document.getElementById('histPresentCount'), present);
    _countUp(document.getElementById('histLateCount'),    late);
    const avgEl = document.getElementById('histAvgHours'); if (avgEl) avgEl.textContent = avg;

    // Render rows
    const photoThumb = (url, label) => url
      ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="eh-photo-thumb"><img src="${escapeHtml(url)}" alt="${label}" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-camera-slash\\' style=\\'color:var(--text-muted)\\'></i>'"></a>`
      : `<span class="eh-photo-thumb" style="cursor:default"><i class="fas fa-camera-slash" style="color:var(--text-muted);font-size:13px;"></i></span>`;

    const statusBadge = s => {
      const cls = s === 'late' ? 'eh-status-late' : s === 'absent' ? 'eh-status-absent' : 'eh-status-present';
      return `<span class="ea-status-badge ${cls}">${s ? s.charAt(0).toUpperCase() + s.slice(1) : '—'}</span>`;
    };

    const rows = data.length ? data.map(rec => {
      const dow = rec.date ? new Date(rec.date).toLocaleDateString('en-US', { weekday: 'short' }) : '—';
      return `<tr>
        <td><strong>${escapeHtml(rec.date || '—')}</strong></td>
        <td style="color:var(--text-muted)">${dow}</td>
        <td>${rec.checkIn  ? fmtLocalTime(rec.checkIn)  : '—'}</td>
        <td>${rec.checkOut ? fmtLocalTime(rec.checkOut) : '—'}</td>
        <td>${rec.hours ? Number(rec.hours).toFixed(1) + 'h' : '—'}</td>
        <td>${statusBadge(rec.status)}</td>
        <td>${photoThumb(rec.checkInPhotoUrl,  'Check-in selfie')}</td>
        <td>${photoThumb(rec.checkOutPhotoUrl, 'Check-out selfie')}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="8" class="eh-empty-row"><i class="fas fa-inbox"></i><p>No attendance records found</p></td></tr>`;

    destroyDataTable('historyTable');
    document.getElementById('historyTableBody').innerHTML = rows;
    // Remove min-width when empty so the empty state fills the container
    const tbl = document.getElementById('historyTable');
    if (tbl) tbl.style.minWidth = data.length ? '' : '0';
    if (data.length) {
      initDataTable('historyTable', {
        columnDefs: [{ targets: [6, 7], orderable: false, searchable: false, className: 'text-center' }]
      });
    }
  }

  function _exportHistoryCSV() {
    const data = _historyRawData;
    if (!data.length) { showPopup('warning', 'No Data', 'No history to export.'); return; }
    const rows = [['Date', 'Day', 'Check In', 'Check Out', 'Hours', 'Status']];
    data.forEach(r => {
      const dow = r.date ? new Date(r.date).toLocaleDateString('en-US', { weekday: 'long' }) : '';
      rows.push([r.date || '', dow, r.checkIn ? fmtLocalTime(r.checkIn) : '', r.checkOut ? fmtLocalTime(r.checkOut) : '', r.hours || 0, r.status || '']);
    });
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `attendance_${currentUser}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  function displayHistoryInline(history) {
    _historyRawData = history;
    _renderHistoryPage();
    _bindHistoryControls();
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
        <td>${rec.checkIn ? fmtLocalTime(rec.checkIn) : '—'}</td>
        <td>${photoTd(rec.checkInPhotoUrl)}</td>
        <td>${rec.checkOut ? fmtLocalTime(rec.checkOut) : '—'}</td>
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
    
    const ok = _validate([
      { id: 'leaveType',   label: 'Leave Type', rules: ['required'] },
      { id: 'fromDate',    label: 'From Date',  rules: ['required'] },
      { id: 'toDate',      label: 'To Date',    rules: ['required'] },
      { id: 'leaveReason', label: 'Reason',     rules: ['required'] },
      { id: 'toDate', check: () => fromDate && toDate && new Date(toDate) < new Date(fromDate) ? 'End date must be on or after the start date.' : null },
    ]);
    if (!ok) return;

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
        showPopup('success', 'Updated', 'Leave application updated.').then(() => {
          loadLeaveApplications();
          if (typeof loadLeaveRequests === 'function') loadLeaveRequests();
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
        showPopup('success', 'Leave Request Submitted', 'Your leave request has been submitted for approval.').then(() => loadLeaveRequests());
      } else {
        showPopup('error', 'Failed', res.message || 'Could not submit leave');
      }
    }).catch(err => { hideSpinner(); showPopup('error', 'Error', err.message || 'Network error'); });
  }

  // ── Shared leave card builder ──────────────────────────────────
  function _lvTypeBadge(type) {
    const map = { sick: 'lv-type-sick', casual: 'lv-type-casual', annual: 'lv-type-annual', medical: 'lv-type-medical' };
    return `<span class="lv-type-badge ${map[String(type).toLowerCase()] || 'lv-type-casual'}">${String(type).charAt(0).toUpperCase() + String(type).slice(1)}</span>`;
  }
  function _lvStatusBadge(status) {
    const map = { pending: 'lv-status-pending', approved: 'lv-status-approved', rejected: 'lv-status-rejected' };
    return `<span class="lv-status-badge ${map[String(status).toLowerCase()] || 'lv-status-pending'}">${String(status).toUpperCase()}</span>`;
  }
  function _lvFmtDate(d) {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch(e) { return d; }
  }
  function _lvCard(r, { showEmployee = false, showApproveReject = false, showEdit = false, showDelete = false, showView = false } = {}) {
    const id = escapeHtml(r.id);
    const isPending = String(r.status).toLowerCase() === 'pending';
    const empCell = showEmployee
      ? `<td><div class="lv-emp-name">${escapeHtml(r.employee || '—')}</div></td><td><span class="lv-dept-label">${escapeHtml(r.department || '—')}</span></td>`
      : '';
    const reasonTitle = escapeHtml(r.reason || '');
    return `<tr>
      ${empCell}
      <td>${_lvTypeBadge(r.type)}</td>
      <td>${_lvFmtDate(r.from || r.fromDate)}</td>
      <td>${_lvFmtDate(r.to || r.toDate)}</td>
      <td><span class="lv-days-pill">${r.days || '?'}d</span></td>
      ${!showEmployee ? `<td class="lv-reason-cell" title="${reasonTitle}">${escapeHtml((r.reason || '—').substring(0, 40))}${(r.reason || '').length > 40 ? '…' : ''}</td>` : ''}
      ${!showEmployee ? `<td>${_lvFmtDate(r.appliedOn)}</td>` : ''}
      <td>${_lvStatusBadge(r.status)}</td>
      <td>
        <div class="lv-action-btns">
          ${showView ? `<button class="lv-act-btn lv-act-view btn-view-leave" data-id="${id}" title="View document"><i class="fas fa-eye"></i> View</button>` : ''}
          ${showView ? `<button class="lv-act-btn lv-act-print btn-print-leave" data-id="${id}" title="Print"><i class="fas fa-print"></i> Print</button>` : ''}
          ${showApproveReject && isPending ? `<button class="lv-act-btn lv-act-approve btn-approve" data-id="${id}" title="Approve"><i class="fas fa-check"></i> Approve</button>` : ''}
          ${showApproveReject && isPending ? `<button class="lv-act-btn lv-act-reject btn-reject" data-id="${id}" title="Reject"><i class="fas fa-times"></i> Reject</button>` : ''}
          ${showEdit && isPending ? `<button class="lv-act-btn lv-act-edit btn-edit-leave" data-id="${id}" title="Edit"><i class="fas fa-edit"></i> Edit</button>` : ''}
          ${showDelete ? `<button class="lv-act-btn lv-act-delete btn-delete-leave" data-id="${id}" title="Delete"><i class="fas fa-trash"></i> Delete</button>` : ''}
        </div>
      </td>
    </tr>`;
  }
  function _lvEmpty(msg, colspan = 8) {
    return `<tr><td colspan="${colspan}" class="lv-empty-row"><i class="fas fa-calendar-check"></i><p>${msg}</p></td></tr>`;
  }
  function _lvUpdateStats(prefix, list) {
    _countUp(document.getElementById(prefix + 'Pending'),  list.filter(r => String(r.status).toLowerCase() === 'pending').length);
    _countUp(document.getElementById(prefix + 'Approved'), list.filter(r => String(r.status).toLowerCase() === 'approved').length);
    _countUp(document.getElementById(prefix + 'Rejected'), list.filter(r => String(r.status).toLowerCase() === 'rejected').length);
    _countUp(document.getElementById(prefix + 'Total'),    list.length);
  }

  // active tab filter state per section
  let _lvEmpTab  = 'emp-all';
  let _lvMgrTab  = 'mgr-pending';
  let _lvAdmTab  = 'adm-all';
  let _lvAdmSearch = '';
  let _lvAdmTypeFilter = 'all';
  let _lvEmpList = [], _lvMgrList = [], _lvAdmList = [];

  // Returns the number of pending leave requests for the sidebar badge
  function _getPendingLeaveCount() {
    const list = currentRole === 'admin' ? _lvAdmList : currentRole === 'manager' ? _lvMgrList : [];
    return list.filter(r => String(r.status).toLowerCase() === 'pending').length;
  }

  function loadLeaveRequests() {
    _skelOnce('s-emp-leave', () => setSkel('leaveRequestsList', skelTableRows(8, 3)));
    apiSwr('getMyLeaves', { username: currentUser }, {
      onData: res => {
        const list = Array.isArray(res) ? res : ((res && res.success && res.data) || []);
        _markLoaded('s-emp-leave');
        _lvEmpList = list;
        _lvUpdateStats('empLv', list);
        _renderEmpLeaves();
      }
    });
  }

  function _renderEmpLeaves() {
    const tab = _lvEmpTab;
    const q = (document.getElementById('empLeaveSearch')?.value || '').toLowerCase().trim();
    const filtered = _lvEmpList.filter(r => {
      const s = String(r.status).toLowerCase();
      if (tab === 'emp-pending')  { if (s !== 'pending')  return false; }
      else if (tab === 'emp-approved') { if (s !== 'approved') return false; }
      else if (tab === 'emp-rejected') { if (s !== 'rejected') return false; }
      if (!q) return true;
      return [r.type, r.reason, r.status, r.from, r.to, r.appliedOn]
        .some(v => String(v || '').toLowerCase().includes(q));
    });
    const lvTbl = document.querySelector('#s-emp-leave .lv-table');
    if (lvTbl) lvTbl.style.minWidth = filtered.length ? '' : '0';
    document.getElementById('leaveRequestsList').innerHTML = filtered.length
      ? filtered.map(r => _lvCard(r, { showEmployee: false, showEdit: true, showDelete: false })).join('')
      : _lvEmpty('No leave requests found.', 8);
  }

  function displayLeaveRequests(list) {
    _lvEmpList = list;
    _lvUpdateStats('empLv', list);
    _renderEmpLeaves();
  }

  // (no-op now — old IDs lived in the employee project map which has moved.
  // live counts now render via renderLivePanel for admin/manager only.)
  function updateRealTimeStats() { /* deprecated */ }

  // Manager Dashboard Functions
  function loadDepartmentData() {
    _skelOnce('s-mgr-overview', () => skelStatValues(['departmentEmployees','presentDepartment','onLeaveDepartment','lateDepartment']));
    apiSwr('getDeptStats', { managerUsername: currentUser }, {
      onData: res => {
        _markLoaded('s-mgr-overview');
        displayDepartmentStats((res && res.success && res.data) || { total:0, present:0, onLeave:0, late:0 });
      }
    });
  }

  function displayDepartmentStats(stats) {
    _countUp(document.getElementById('departmentEmployees'), stats.total);
    _countUp(document.getElementById('presentDepartment'),   stats.present);
    _countUp(document.getElementById('onLeaveDepartment'),   stats.onLeave);
    _countUp(document.getElementById('lateDepartment'),      stats.late);
  }

  function loadDepartmentEmployees() {
    const args = { managerUsername: currentUser };
    _skelOnce('s-mgr-employees', () => setSkel('departmentEmployeesTable', skelTableRows(5, 4)));
    apiSwr('getDeptEmployees', args, {
      onData: res => { _markLoaded('s-mgr-employees'); displayDepartmentEmployees((res && res.success && res.data) || []); }
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
          <td data-label="Last Activity">${emp.lastActivity ? fmtLocalTime(emp.lastActivity) : '—'}</td>
          <td data-label="Location"><small class="text-muted">${emp.location}</small></td>
        </tr>
      `;
    });
    
    document.getElementById('departmentEmployeesTable').innerHTML = html;
  }

  function loadManagerLeaveApplications() {
    const args = { managerUsername: currentUser };
    _skelOnce('s-mgr-leaves', () => setSkel('managerPendingLeaves', skelTableRows(8, 3)));
    apiSwr('getPendingLeavesForManager', args, {
      onData: res => { _markLoaded('s-mgr-leaves'); displayManagerLeaveApplications((res && res.success && res.data) || []); }
    });
  }

  function displayManagerLeaveApplications(list) {
    _lvMgrList = list;
    _lvUpdateStats('mgrLv', list);
    _renderMgrLeaves();
    if (typeof window._refreshNavBadges === 'function') window._refreshNavBadges(_getPendingLeaveCount());
  }

  function _renderMgrLeaves() {
    const tab = _lvMgrTab;
    const filtered = _lvMgrList.filter(r => {
      const s = String(r.status).toLowerCase();
      if (tab === 'mgr-pending')  return s === 'pending';
      if (tab === 'mgr-approved') return s === 'approved';
      if (tab === 'mgr-rejected') return s === 'rejected';
      return true;
    });
    document.getElementById('managerPendingLeaves').innerHTML = filtered.length
      ? filtered.map(r => _lvCard(r, { showEmployee: true, showApproveReject: true, showDelete: false, showView: true })).join('')
      : _lvEmpty('No leave requests in this category.', 8);
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
        _refreshLeavesAfterDecision();
        showPopup('success', 'Leave Approved', 'The leave request has been approved.');
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
        _refreshLeavesAfterDecision();
        showPopup('success', 'Leave Rejected', 'The leave request has been rejected.');
      }).catch(err => { hideSpinner(); showPopup('error', 'Error', err.message || 'Network error'); });
    });
  }

  // reload whichever leaves list the current role is looking at — bypasses SWR entirely
  function _refreshLeavesAfterDecision() {
    swr.clear();
    swr._inflight.clear();
    _swrLastHash.clear();
    if (currentRole === 'admin') {
      _rawApi('listAllLeaves', {}).then(res => {
        displayLeaveApplications((res && res.success && res.data) || []);
      });
    } else if (currentRole === 'manager') {
      _rawApi('getPendingLeavesForManager', { managerUsername: currentUser }).then(res => {
        displayManagerLeaveApplications((res && res.success && res.data) || []);
      });
    }
  }

  // Admin Dashboard Functions
  function loadDashboardData() {
    _skelOnce('s-adm-dashboard', () => skelStatValues(['totalEmployees','presentToday','absentToday','onLeaveToday','activeLocations','lateToday']));
    apiSwr('getAdminStats', {}, {
      onData: res => {
        _markLoaded('s-adm-dashboard');
        displayAdminStats((res && res.success && res.data) || { totalEmployees:0, presentToday:0, absentToday:0, onLeaveToday:0, activeLocations:0, lateToday:0 });
      }
    });
    loadRecentAttendance();
  }

  function _countUp(el, target) {
    if (!el) return;
    const current = parseInt(el.textContent, 10);
    const hasSkeleton = el.querySelector('.skeleton') !== null;
    const from = isNaN(current) ? 0 : current;
    const to = Number(target) || 0;
    // Skip only if value is already correct AND no skeleton is showing
    if (from === to && !hasSkeleton) { el.textContent = to; return; }
    el.innerHTML = ''; // clear skeleton if present
    const steps = 30;
    const stepTime = 600 / steps;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      el.textContent = Math.round(from + (to - from) * (step / steps));
      if (step >= steps) { el.textContent = to; clearInterval(timer); }
    }, stepTime);
  }

  function displayAdminStats(stats) {
    // Animate all cards in together on first load
    document.querySelectorAll('.dash-stats-row .stat-card').forEach(card => {
      card.classList.remove('stat-card-animate');
      void card.offsetWidth; // reflow to restart animation
      card.classList.add('stat-card-animate');
    });
    _countUp(document.getElementById('totalEmployees'),  stats.totalEmployees);
    _countUp(document.getElementById('presentToday'),    stats.presentToday);
    _countUp(document.getElementById('absentToday'),     stats.absentToday);
    _countUp(document.getElementById('onLeaveToday'),    stats.onLeaveToday);
    _countUp(document.getElementById('activeLocations'), stats.activeLocations);
    _countUp(document.getElementById('lateToday'),       stats.lateToday);
  }

  function loadRecentAttendance() {
    const tbody = document.getElementById('recentAttendanceTbody');
    if (!tbody) return;
    _skelOnce('s-adm-dashboard-rat', () => {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted" style="padding:28px;"><i class="fas fa-spinner fa-spin"></i> Loading…</td></tr>';
    });
    apiSwr('getRecentAttendance', { limit: 10 }, {
      onData: res => {
      _markLoaded('s-adm-dashboard-rat');
      if (!res || !res.success || !res.data || res.data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="padding:48px 20px;text-align:center;color:var(--text-muted);"><div style="display:flex;flex-direction:column;align-items:center;gap:10px;"><i class="fas fa-inbox" style="font-size:2rem;opacity:0.4;"></i><span style="font-size:0.88rem;">No attendance records for today yet.</span></div></td></tr>';
        return;
      }
      tbody.innerHTML = res.data.map(row => {
        const statusClass = row.status === 'Present'     ? 'rat-badge rat-present'
                          : row.status === 'Checked Out' ? 'rat-badge rat-out'
                          : row.status === 'Late'        ? 'rat-badge rat-late'
                          :                               'rat-badge rat-absent';
        const statusIcon  = row.status === 'Present'     ? 'fa-user-check'
                          : row.status === 'Checked Out' ? 'fa-sign-out-alt'
                          : row.status === 'Late'        ? 'fa-clock'
                          :                               'fa-user-times';
        const checkIn  = row.checkIn  ? fmtLocalTime(row.checkIn)  : '—';
        const checkOut = row.checkOut ? fmtLocalTime(row.checkOut) : '—';
        return `<tr>
          <td><span class="rat-name">${escapeHtml(row.name)}</span></td>
          <td style="text-align:center;"><span class="rat-dept">${escapeHtml(row.department)}</span></td>
          <td class="rat-time" style="text-align:center;">${checkIn}</td>
          <td class="rat-time" style="text-align:center;">${checkOut}</td>
          <td style="text-align:center;"><span class="${statusClass}"><i class="fas ${statusIcon}"></i> ${row.status}</span></td>
        </tr>`;
      }).join('');
      },
      onError: () => {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted" style="padding:20px;">Failed to load recent activity.</td></tr>';
      }
    });
  }

  // expose goTo so the "View All" button in the recent activity section can navigate
  function goTo(sectionId) {
    const btn = document.querySelector(`.sidebar-menu button[data-target="${sectionId}"]`);
    if (btn) { btn.click(); return; }
    // fallback: manually activate section
    document.querySelectorAll('.app-section').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(sectionId);
    if (target) target.classList.add('active');
  }

  // ─── Employee modal helpers ───
  function openAddEmpModal() {
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
    document.getElementById('addEmployeeModal').classList.add('active');
  }

  function closeAddEmpModal() {
    document.getElementById('addEmployeeModal').classList.remove('active');
    document.getElementById('addEmployeeForm').reset();
  }

  function closeEditEmpModal() {
    document.getElementById('editEmployeeModal').classList.remove('active');
  }

  // ─── Employee Profile Drawer ───────────────────────────────────────────────

  function closeEmpDrawer() {
    const drawer = document.getElementById('empProfileDrawer');
    if (drawer) { drawer.classList.remove('active'); drawer.dataset.username = ''; }
  }

  function openEmpDrawer(username) {
    const drawer = document.getElementById('empProfileDrawer');
    if (!drawer) return;
    // Find employee in the already-loaded list (instant, no API call)
    const emp = _empAllList.find(e => e.username === username);
    if (!emp) return;

    drawer.dataset.username = username;

    // Avatar
    const avatarEl = document.getElementById('empDrawerAvatar');
    const initial  = (emp.fullName || emp.username || '?').charAt(0).toUpperCase();
    if (emp.profileImage) {
      avatarEl.innerHTML = `<img src="${escapeHtml(emp.profileImage)}" alt="">`;
    } else {
      avatarEl.textContent = initial;
    }

    // Status dot
    const dot = document.getElementById('empDrawerStatusDot');
    const isActive = emp.status === 'Active';
    dot.className = 'emp-drawer-status-dot ' + (isActive ? 'is-active' : 'is-inactive');

    // Header text
    document.getElementById('empDrawerName').textContent  = emp.fullName || emp.username;
    document.getElementById('empDrawerPos').textContent   = [emp.position, emp.department].filter(Boolean).join(' · ') || '—';
    document.getElementById('empDrawerEmpId').textContent = emp.employeeNumber || 'No ID';

    // Helper: set a drawer row value
    function setRow(id, value, isMuted) {
      const row = document.getElementById(id);
      if (!row) return;
      row.querySelector('span').textContent = value || '—';
      row.classList.toggle('muted', !value || isMuted === true);
    }

    // Contact
    setRow('empDrawerEmail', emp.email);
    setRow('empDrawerPhone', emp.phone);

    // Details
    setRow('empDrawerUsername', '@' + emp.username);
    setRow('empDrawerDept', emp.department);
    const roleCap = emp.role ? emp.role.charAt(0).toUpperCase() + emp.role.slice(1) : '—';
    setRow('empDrawerRole', roleCap);
    setRow('empDrawerStatus', isActive ? 'Active' : 'Inactive');

    // Today status
    const todayLabels = { checkedin: 'Checked In', checkedout: 'Checked Out', notchecked: 'Not Checked In' };
    setRow('empDrawerToday', todayLabels[emp.todayStatus] || 'Not Checked In');

    drawer.classList.add('active');
  }

  // Keep old name as alias for event delegation
  function showAddEmployeeModal() { openAddEmpModal(); }

  function addEmployee() {
    const username = document.getElementById('newUsername').value.trim();
    const password = document.getElementById('newPassword').value;
    const fullName = document.getElementById('newFullName').value.trim();
    const department = document.getElementById('newDepartment').value;
    const position = document.getElementById('newPosition').value.trim();
    const role = document.getElementById('newRole').value;
    const email = document.getElementById('newEmail').value.trim();
    const phone = readPhone('newPhone');
    // Employee number is always auto-assigned on create (field is readonly)
    const employeeNumber = undefined;

    const ok = _validate([
      { id: 'newUsername',   label: 'Username',    rules: ['required'] },
      { id: 'newPassword',   label: 'Password',    rules: ['required', 'min:6'] },
      { id: 'newFullName',   label: 'Full Name',   rules: ['required'] },
      { id: 'newDepartment', label: 'Department',  rules: ['required'] },
      { id: 'newPosition',   label: 'Position',    rules: ['required'] },
      { id: 'newRole',       label: 'Role',        rules: ['required'] },
      { id: 'newEmail',      label: 'Email',       rules: ['email'] },
      { id: 'newPhone',      label: 'Phone',       rules: ['phone'] },
    ]);
    if (!ok) return;
    showSpinner('Adding employee...');
    api('addEmployee', { username, password, fullName, department, position, role, employeeNumber, email, phone, actorId: currentUserId, actorUsername: currentUser }).then(res => {
      hideSpinner();
      if (res.success) {
        closeAddEmpModal();
        showPopup('success', 'Employee Added', `New employee added${res.employeeNumber ? ' as ' + res.employeeNumber : ''}.`).then(() => loadEmployeeList());
      } else {
        showPopup('error', 'Failed', res.message || 'Could not add employee');
      }
    }).catch(err => { hideSpinner(); showPopup('error', 'Error', err.message || 'Network error'); });
  }

  // ─── Employee list state ───
  let _empAllList = [];   // raw API data
  let _empCardView = true; // true = cards, false = table

  function loadEmployeeList() {
    _skelOnce('s-adm-employees', () => {
      if (_empCardView) {
        const g = document.getElementById('empCardView');
        if (g) g.innerHTML = '<div class="emp-loading"><i class="fas fa-spinner fa-spin"></i> Loading employees…</div>';
      } else {
        destroyDataTable('employeesTable');
        setSkel('employeesTableBody', skelTableRows(8, 5));
      }
    });
    apiSwr('listEmployees', {}, {
      onData: res => {
        if (!res || !res.success) {
          const msg = `<div class="emp-err">Error: ${escapeHtml((res && res.message) || 'Failed to load employees')}</div>`;
          if (_empCardView) { const g = document.getElementById('empCardView'); if (g) g.innerHTML = msg; }
          else document.getElementById('employeesTableBody').innerHTML = `<tr><td colspan="8">${msg}</td></tr>`;
          return;
        }
        _markLoaded('s-adm-employees');
        _empAllList = res.data || [];
        _renderEmpStats();
        const _empPhotoUrls = _empAllList.map(e => e.profileImage).filter(Boolean);
        _preloadThenRender(_empPhotoUrls, _renderEmployees);
      },
      onError: err => {
        const msg = `Network error: ${escapeHtml(err.message || 'Could not connect')}`;
        if (_empCardView) { const g = document.getElementById('empCardView'); if (g) g.innerHTML = `<div class="emp-err">${msg}</div>`; }
        else document.getElementById('employeesTableBody').innerHTML = `<tr><td colspan="8" class="emp-err">${msg}</td></tr>`;
      }
    });
  }

  function _renderEmpStats() {
    _countUp(document.getElementById('empStatTotal'),     _empAllList.length);
    _countUp(document.getElementById('empStatActive'),    _empAllList.filter(e => e.status === 'Active').length);
    _countUp(document.getElementById('empStatCheckedIn'), _empAllList.filter(e => e.todayStatus === 'checkedin').length);
    _countUp(document.getElementById('empStatDepts'),     [...new Set(_empAllList.map(e => e.department).filter(Boolean))].length);
  }

  function _getFilteredEmpList() {
    const role   = (document.getElementById('empRoleFilter')   || {}).value || 'all';
    const status = (document.getElementById('empStatusFilter') || {}).value || 'all';
    const search = ((document.getElementById('empSearchInput') || {}).value || '').toLowerCase();
    return _empAllList.filter(e => {
      if (role   !== 'all' && e.role   !== role)   return false;
      if (status !== 'all' && e.status !== status) return false;
      if (search && !e.fullName.toLowerCase().includes(search) && !(e.position||'').toLowerCase().includes(search) && !(e.department||'').toLowerCase().includes(search)) return false;
      return true;
    });
  }

  function _renderEmployees() {
    const filtered = _getFilteredEmpList();
    if (_empCardView) _renderEmpCards(filtered);
    else              _renderEmpTable(filtered);
  }

  function _empInitials(name) {
    return (name || '').split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || '?';
  }

  // Preload an array of image URLs into the browser decode cache.
  // Calls render() once all images are decoded OR after maxWaitMs (default 400ms),
  // whichever comes first. This guarantees photos are ready before cards paint.
  function _preloadThenRender(urls, render, maxWaitMs) {
    const unique = [...new Set(urls.filter(Boolean))];
    if (!unique.length) { render(); return; }
    maxWaitMs = maxWaitMs || 400;
    let done = 0;
    let called = false;
    const finish = () => { if (!called) { called = true; render(); } };
    const timer = setTimeout(finish, maxWaitMs);
    unique.forEach(url => {
      const img = new Image();
      img.onload = img.onerror = () => { if (++done >= unique.length) { clearTimeout(timer); finish(); } };
      img.src = url;
    });
  }

  function _renderEmpCards(list) {
    const grid = document.getElementById('empCardView');
    if (!grid) return;
    if (!list.length) {
      grid.innerHTML = '<div class="emp-empty"><i class="fas fa-users-slash"></i><p>No employees match your filters.</p></div>';
      return;
    }
    const todayMap = {
      checkedin:  { cls: 'emp-today-in',  icon: 'fa-check-circle', text: 'Checked In' },
      checkedout: { cls: 'emp-today-out', icon: 'fa-sign-out-alt', text: 'Checked Out' },
      notchecked: { cls: 'emp-today-no',  icon: 'fa-clock',        text: 'Not In' }
    };
    grid.innerHTML = list.map(emp => {
      const t = todayMap[emp.todayStatus] || todayMap.notchecked;
      const isActive = emp.status === 'Active';
      const roleCap = emp.role ? emp.role.charAt(0).toUpperCase() + emp.role.slice(1) : '—';
      const initial = escapeHtml((emp.fullName || emp.username || '?').charAt(0).toUpperCase());
      // Photos are pre-decoded by _preloadThenRender — render directly, no flash
      const avatarInner = emp.profileImage
        ? `<img src="${escapeHtml(emp.profileImage)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
        : `<span>${initial}</span>`;
      return `
      <div class="emp-card">
        <div class="emp-card-header ${isActive ? 'emp-card-header--active' : 'emp-card-header--inactive'}">
          <div class="emp-card-avatar">${avatarInner}</div>
          <div class="emp-card-title-block">
            <div class="emp-card-name">${escapeHtml(emp.fullName)}</div>
            <div class="emp-card-pos">${escapeHtml(emp.position || '—')} &middot; ${escapeHtml(emp.department || '—')}</div>
          </div>
          <span class="emp-card-empid">${emp.employeeNumber ? escapeHtml(emp.employeeNumber) : 'No ID'}</span>
        </div>
        <div class="emp-card-body">
          <div class="emp-detail-row"><i class="fas fa-briefcase"></i><span>${roleCap}</span></div>
          <div class="emp-detail-row"><i class="fas fa-sitemap"></i><span>${escapeHtml(emp.department || '—')}</span></div>
          <div class="emp-detail-row"><i class="fas fa-id-badge"></i><span>${escapeHtml(emp.position || '—')}</span></div>
          <div class="emp-detail-row"><i class="fas fa-at"></i><span class="emp-username">${escapeHtml(emp.username)}</span></div>
          ${emp.email ? `<div class="emp-detail-row"><i class="fas fa-envelope"></i><span>${escapeHtml(emp.email)}</span></div>` : ''}
          ${emp.phone ? `<div class="emp-detail-row"><i class="fas fa-phone"></i><span>${escapeHtml(emp.phone)}</span></div>` : ''}
          <div class="emp-today-row">
            <span class="emp-today-badge ${t.cls}"><i class="fas ${t.icon}"></i> Today: ${t.text}</span>
          </div>
        </div>
        <div class="emp-card-footer">
          <button class="emp-icon-btn edit btn-edit-employee" data-username="${escapeHtml(emp.username)}"><i class="fas fa-edit"></i> Edit</button>
          <button class="emp-icon-btn delete btn-delete-employee" data-username="${escapeHtml(emp.username)}"><i class="fas fa-trash"></i> Delete</button>
        </div>
      </div>`;
    }).join('');

  }

  function _renderEmpTable(list) {
    const todayMap = {
      checkedin:  { cls: 'emp-today-in',  icon: 'fa-check-circle', text: 'Checked In' },
      checkedout: { cls: 'emp-today-out', icon: 'fa-sign-out-alt', text: 'Checked Out' },
      notchecked: { cls: 'emp-today-no',  icon: 'fa-clock',        text: 'Not In' }
    };
    const html = list.map((emp, i) => {
      const t = todayMap[emp.todayStatus] || todayMap.notchecked;
      const isActive = emp.status === 'Active';
      return `<tr>
        <td style="font-family:monospace;font-size:12px;font-weight:600;color:var(--siomac-navy);white-space:nowrap">${escapeHtml(emp.employeeNumber || '—')}</td>
        <td>
          <div style="display:flex;align-items:center;gap:10px;">
            <div class="emp-table-avatar">${_empInitials(emp.fullName)}</div>
            <div>
              <div style="font-weight:600;color:var(--siomac-navy)">${escapeHtml(emp.fullName)}</div>
              <div style="font-size:11px;color:var(--text-muted)">@${escapeHtml(emp.username)}</div>
              ${emp.email ? `<div style="font-size:11px;color:var(--text-muted)"><i class="fas fa-envelope" style="width:11px"></i> ${escapeHtml(emp.email)}</div>` : ''}
              ${emp.phone ? `<div style="font-size:11px;color:var(--text-muted)"><i class="fas fa-phone" style="width:11px"></i> ${escapeHtml(emp.phone)}</div>` : ''}
            </div>
          </div>
        </td>
        <td>${escapeHtml(emp.department || '—')}</td>
        <td>${escapeHtml(emp.position || '—')}</td>
        <td><span style="text-transform:capitalize">${escapeHtml(emp.role)}</span></td>
        <td><span class="emp-status-badge ${isActive ? 'emp-active' : 'emp-inactive'}">${isActive ? 'Active' : 'Inactive'}</span></td>
        <td><span class="emp-today-badge ${t.cls}"><i class="fas ${t.icon}"></i> ${t.text}</span></td>
        <td style="white-space:nowrap;">
          <button class="att-action-btn btn-edit-employee" data-username="${escapeHtml(emp.username)}" title="Edit"><i class="fas fa-pen"></i></button>
          <button class="att-action-btn btn-delete-employee" data-username="${escapeHtml(emp.username)}" title="Delete"><i class="fas fa-trash"></i></button>
        </td>
      </tr>`;
    }).join('') || `<tr><td colspan="8" class="att-empty">No employees match your filters.</td></tr>`;

    destroyDataTable('employeesTable');
    document.getElementById('employeesTableBody').innerHTML = html;
    initDataTable('employeesTable', {
      searching: false,
      dom: "<'dt-export-bar'B>rt<'dt-foot'<'dt-len'l><'dt-info'i><'dt-page'p>>",
      columnDefs: [{ targets: -1, orderable: false, searchable: false, className: 'text-center dt-no-export' }]
    });
  }

  // kept as alias — called from delegated click handler
  function displayEmployeeList(list) { _empAllList = list; _renderEmpStats(); _renderEmployees(); }

  // Tracks pending photo changes for the edit employee modal
  let _editEmpPhotoBase64 = null;   // new photo to upload (base64 string)
  let _editEmpRemovePhoto = false;  // flag to remove existing photo

  function _resetEditEmpPhoto(emp) {
    _editEmpPhotoBase64 = null;
    _editEmpRemovePhoto = false;
    const preview  = document.getElementById('editEmpPhotoPreview');
    const initials = document.getElementById('editEmpPhotoInitials');
    const removeBtn = document.getElementById('editEmpRemovePhotoBtn');
    const inp = document.getElementById('editEmpPhotoInput');
    if (inp) inp.value = '';
    const name = emp ? (emp.fullName || emp.username || '') : '';
    const ini  = name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
    if (initials) initials.textContent = ini;
    if (emp && emp.profileImage) {
      preview.src = emp.profileImage;
      preview.style.display = '';
      if (initials) initials.style.display = 'none';
      if (removeBtn) removeBtn.style.display = '';
    } else {
      preview.src = '';
      preview.style.display = 'none';
      if (initials) initials.style.display = '';
      if (removeBtn) removeBtn.style.display = 'none';
    }
  }

  function editEmployee(username) {
    showSpinner('Loading employee...');
    Promise.all([
      api('getEmployeeByUsername', { username }),
      api('listDepartments')
    ]).then(([empRes, deptRes]) => {
      hideSpinner();
      if (!empRes.success || !empRes.data) { showPopup('error', 'Not Found', 'Employee not found'); return; }
      const emp = empRes.data;
      document.getElementById('editUsername').value = emp.username;
      document.getElementById('editEmployeeNumber').value = emp.employeeNumber || '';
      document.getElementById('editFullName').value = emp.fullName;
      document.getElementById('editPosition').value = emp.position || '';
      document.getElementById('editRole').value = emp.role;
      // status from getEmployeeByUsername is raw DB value (lowercase)
      const statusVal = (emp.status || '').toLowerCase();
      document.getElementById('editStatus').value = statusVal === 'active' ? 'active' : 'inactive';
      document.getElementById('editEmail').value = emp.email || '';
      setPhone('editPhone', emp.phone || '');

      const deptSelect = document.getElementById('editDepartment');
      deptSelect.innerHTML = '<option value="">Select Department</option>';
      ((deptRes.success && deptRes.data) || []).forEach(d => {
        const o = document.createElement('option');
        o.value = d.id; o.textContent = d.name;
        if (d.id === emp.departmentId) o.selected = true;
        deptSelect.appendChild(o);
      });

      // Set up photo picker
      _resetEditEmpPhoto(emp);

      document.getElementById('editEmployeeModal').classList.add('active');
    }).catch(err => {
      hideSpinner();
      showPopup('error', 'Error', err.message || 'Could not load employee');
    });
  }

  // Edit employee photo file input change
  document.getElementById('editEmpPhotoInput').addEventListener('change', function () {
    const file = this.files && this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const base64 = e.target.result;
      _editEmpPhotoBase64 = base64;
      _editEmpRemovePhoto = false;
      const preview  = document.getElementById('editEmpPhotoPreview');
      const initials = document.getElementById('editEmpPhotoInitials');
      const removeBtn = document.getElementById('editEmpRemovePhotoBtn');
      preview.src = base64;
      preview.style.display = '';
      if (initials) initials.style.display = 'none';
      if (removeBtn) removeBtn.style.display = '';
    };
    reader.readAsDataURL(file);
  });

  // Remove photo button in edit employee modal
  document.getElementById('editEmpRemovePhotoBtn').addEventListener('click', function () {
    _editEmpPhotoBase64 = null;
    _editEmpRemovePhoto = true;
    const preview  = document.getElementById('editEmpPhotoPreview');
    const initials = document.getElementById('editEmpPhotoInitials');
    preview.src = '';
    preview.style.display = 'none';
    if (initials) initials.style.display = '';
    this.style.display = 'none';
    document.getElementById('editEmpPhotoInput').value = '';
  });

  function updateEmployee() {
    const username       = document.getElementById('editUsername').value;
    const fullName       = document.getElementById('editFullName').value.trim();
    const department     = document.getElementById('editDepartment').value;
    const position       = document.getElementById('editPosition').value.trim();
    const role           = document.getElementById('editRole').value;
    const status         = document.getElementById('editStatus').value;
    const employeeNumber = (document.getElementById('editEmployeeNumber').value || '').trim().toUpperCase();
    const email          = document.getElementById('editEmail').value.trim();
    const phone          = readPhone('editPhone');

    const ok = _validate([
      { id: 'editFullName',   label: 'Full Name',  rules: ['required'] },
      { id: 'editDepartment', label: 'Department', rules: ['required'] },
      { id: 'editPosition',   label: 'Position',   rules: ['required'] },
      { id: 'editRole',       label: 'Role',       rules: ['required'] },
      { id: 'editEmail',      label: 'Email',      rules: ['email'] },
      { id: 'editPhone',      label: 'Phone',      rules: ['phone'] },
    ]);
    if (!ok) return;
    showSpinner('Updating employee...');
    const updateArgs = { username, fullName, department, position, role, status, employeeNumber, email, phone, actorId: currentUserId, actorUsername: currentUser };
    if (_editEmpRemovePhoto) updateArgs.removeProfileImage = true;
    else if (_editEmpPhotoBase64) updateArgs.profileImageBase64 = _editEmpPhotoBase64;
    api('updateEmployee', updateArgs).then(res => {
      hideSpinner();
      if (res.success) {
        closeEditEmpModal();
        showPopup('success', 'Employee Updated', `${fullName} has been updated.`).then(() => loadEmployeeList());
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
            showPopup('success', 'Deleted', 'Employee has been deleted.').then(() => loadEmployeeList());
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
    document.getElementById('deptModalTitle').textContent = dept ? 'Edit Department' : 'Add New Department';
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

    document.getElementById('addDepartmentModal').classList.add('active');
  }

  function closeDeptModal() {
    document.getElementById('addDepartmentModal').classList.remove('active');
    editingDeptId = null;
  }

  function addDepartment() {
    const name = document.getElementById('departmentName').value.trim();
    const description = document.getElementById('departmentDescription').value.trim();
    const manager = document.getElementById('departmentManager').value;
    
    const ok = _validate([
      { id: 'departmentName',    label: 'Department Name', rules: ['required'] },
      { id: 'departmentManager', label: 'Manager',         rules: ['required'] },
    ]);
    if (!ok) return;

    const action = editingDeptId ? 'updateDepartment' : 'addDepartment';
    const args = { name, description, manager, actorId: currentUserId, actorUsername: currentUser };
    if (editingDeptId) args.id = editingDeptId;

    showSpinner('Saving department...');
    api(action, args).then(res => {
      hideSpinner();
      if (res.success) {
        closeDeptModal();
        document.getElementById('addDepartmentForm').reset();
        showPopup('success', 'Saved', 'Department saved successfully.').then(() => loadDepartments());
      } else {
        showPopup('error', 'Failed', res.message || 'Could not save department');
      }
    }).catch(err => { hideSpinner(); showPopup('error', 'Error', err.message || 'Network error'); });
  }

  function loadDepartments() {
    const container = document.getElementById('departmentsContainer');
    _skelOnce('s-adm-departments', () => {
      if (container) container.innerHTML = '<div class="dept-loading"><i class="fas fa-spinner fa-spin"></i> Loading departments…</div>';
    });
    apiSwr('listDepartments', {}, {
      onData: res => {
        if (!res || !res.success) {
          if (container) container.innerHTML = `<div class="dept-empty"><i class="fas fa-exclamation-circle"></i><p>${(res && res.message) || 'Failed to load departments'}</p></div>`;
          return;
        }
        const list = Array.isArray(res.data) ? res.data : [];
        departments = list;
        _markLoaded('s-adm-departments');
        displayDepartments(list);
      },
      onError: err => {
        if (container) container.innerHTML = `<div class="dept-empty"><i class="fas fa-wifi"></i><p>Network error: ${err.message || 'Could not connect'}</p></div>`;
      }
    });
  }

  // Dept icons map by keyword
  function _deptIcon(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('civil') || n.includes('construct'))  return 'fa-hard-hat';
    if (n.includes('mech'))                              return 'fa-gear';
    if (n.includes('electr') || n.includes('instrum'))  return 'fa-bolt';
    if (n.includes('hse') || n.includes('safety') || n.includes('health')) return 'fa-shield-alt';
    if (n.includes('admin') || n.includes('hr'))        return 'fa-file-signature';
    if (n.includes('log') || n.includes('supply') || n.includes('warehouse')) return 'fa-truck';
    if (n.includes('it') || n.includes('tech'))         return 'fa-laptop-code';
    if (n.includes('finance') || n.includes('account')) return 'fa-coins';
    return 'fa-building';
  }

  let _deptListView = true; // list view default

  function displayDepartments(departmentList) {
    // Update stat badges
    _countUp(document.getElementById('deptStatTotal'),     departmentList.length);
    _countUp(document.getElementById('deptStatEmployees'), departmentList.reduce((s, d) => s + (d.employeeCount || 0), 0));
    _countUp(document.getElementById('deptStatHeads'),     departmentList.filter(d => d.manager && d.manager !== '—').length);

    const search = (document.getElementById('deptSearchInput') || {}).value || '';
    const filtered = search
      ? departmentList.filter(d =>
          d.name.toLowerCase().includes(search.toLowerCase()) ||
          (d.description || '').toLowerCase().includes(search.toLowerCase()))
      : departmentList;

    // Render card view
    const cardView = document.getElementById('deptCardView');
    if (cardView) {
      if (filtered.length === 0) {
        cardView.innerHTML = `<div class="dept-empty"><i class="fas fa-building"></i><p>No departments found. Create a new one.</p></div>`;
      } else {
        cardView.innerHTML = filtered.map(dept => `
          <div class="dept-card">
            <div class="dept-card-header">
              <div class="dept-card-icon"><i class="fas ${_deptIcon(dept.name)}"></i></div>
              <div class="dept-card-title-block">
                <div class="dept-card-name">${escapeHtml(dept.name)}</div>
                <div class="dept-card-id-tag">ID #${dept.id}</div>
              </div>
            </div>
            <div class="dept-card-body">
              ${dept.description ? `<div class="dept-info-row"><i class="fas fa-align-left"></i><span>${escapeHtml(dept.description)}</span></div>` : ''}
              <div class="dept-info-row"><i class="fas fa-user-circle"></i><span><strong>Manager:</strong> ${escapeHtml(dept.manager || '—')}</span></div>
              <div class="dept-stats-badges">
                <span class="dept-badge blue"><i class="fas fa-users"></i> ${dept.employeeCount || 0} Employees</span>
              </div>
            </div>
            <div class="dept-card-actions">
              <button class="btn btn-outline-primary btn-sm btn-edit-department" data-id="${dept.id}"><i class="fas fa-pen"></i> Edit</button>
              <button class="btn btn-outline-danger btn-sm btn-delete-department" data-id="${dept.id}"><i class="fas fa-trash"></i> Delete</button>
            </div>
          </div>`).join('');
      }
    }

    // Render list / table view
    const tbody = document.getElementById('deptTableBody');
    if (tbody) {
      if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--text-muted);">No departments found.</td></tr>`;
      } else {
        tbody.innerHTML = filtered.map(dept => `
          <tr>
            <td>
              <div class="dept-table-name-cell">
                <div class="dept-table-icon"><i class="fas ${_deptIcon(dept.name)}"></i></div>
                <div>
                  <div class="dept-table-name">${escapeHtml(dept.name)}</div>
                  <div class="dept-table-id">ID #${dept.id}</div>
                </div>
              </div>
            </td>
            <td>${escapeHtml(dept.manager || '—')}</td>
            <td><span class="dept-table-badge"><i class="fas fa-users"></i> ${dept.employeeCount || 0}</span></td>
            <td style="color:var(--text-muted);font-size:12.5px;">${escapeHtml(dept.description || '—')}</td>
            <td>
              <div class="dept-table-actions">
                <button class="dept-table-btn edit btn-edit-department" data-id="${dept.id}"><i class="fas fa-pen"></i> Edit</button>
                <button class="dept-table-btn delete btn-delete-department" data-id="${dept.id}"><i class="fas fa-trash"></i> Delete</button>
              </div>
            </td>
          </tr>`).join('');
      }
    }

    // Apply current view mode
    _applyDeptView();
  }

  function _applyDeptView() {
    const cardView = document.getElementById('deptCardView');
    const listView = document.getElementById('deptListView');
    const cardBtn  = document.getElementById('deptCardViewBtn');
    const listBtn  = document.getElementById('deptListViewBtn');
    if (!cardView || !listView) return;
    if (_deptListView) {
      cardView.style.display = 'none';
      listView.style.display = '';
      if (cardBtn) cardBtn.classList.remove('active');
      if (listBtn) listBtn.classList.add('active');
    } else {
      cardView.style.display = '';
      listView.style.display = 'none';
      if (cardBtn) cardBtn.classList.add('active');
      if (listBtn) listBtn.classList.remove('active');
    }
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
          showPopup('success', 'Deleted', 'Department has been deleted.').then(() => loadDepartments());
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

    // Update coordinate display
    document.getElementById('siteLatDisplay').textContent = site ? Number(site.latitude).toFixed(6)  : '—';
    document.getElementById('siteLngDisplay').textContent = site ? Number(site.longitude).toFixed(6) : '—';

    // Reset map picker state
    document.getElementById('sitePickerMapWrap').style.display = 'none';
    if (window._sitePickerMap) {
      window._sitePickerMap.remove();
      window._sitePickerMap = null;
      window._sitePickerMarker = null;
      window._sitePickerCircle = null;
    }

    new bootstrap.Modal(document.getElementById('addProjectModal')).show();
  }

  // ── Project site map picker ─────────────────────────────────────────────────
  function _spSetCoords(lat, lng) {
    document.getElementById('projectLatitude').value  = lat.toFixed(6);
    document.getElementById('projectLongitude').value = lng.toFixed(6);
    document.getElementById('siteLatDisplay').textContent = lat.toFixed(6);
    document.getElementById('siteLngDisplay').textContent = lng.toFixed(6);
  }

  function _spUpdateCircle(lat, lng) {
    const radius = parseInt(document.getElementById('projectRadius').value) || 200;
    if (window._sitePickerCircle) {
      window._sitePickerCircle.setLatLng([lat, lng]);
      window._sitePickerCircle.setRadius(radius);
    } else if (window._sitePickerMap) {
      window._sitePickerCircle = L.circle([lat, lng], {
        radius, color: '#0074D9', fillColor: '#0074D9', fillOpacity: 0.15, weight: 2
      }).addTo(window._sitePickerMap);
    }
  }

  document.getElementById('pickOnMapBtn').addEventListener('click', function () {
    const wrap = document.getElementById('sitePickerMapWrap');
    const isOpen = wrap.style.display !== 'none';
    wrap.style.display = isOpen ? 'none' : '';
    if (isOpen) return;

    setTimeout(() => {
      if (window._sitePickerMap) {
        window._sitePickerMap.invalidateSize();
        return;
      }

      const existingLat = parseFloat(document.getElementById('projectLatitude').value);
      const existingLng = parseFloat(document.getElementById('projectLongitude').value);
      const center = (existingLat && existingLng)
        ? [existingLat, existingLng]
        : (map ? map.getCenter() : [10.6549, -61.5019]);

      const pickerMap = L.map('sitePickerMap', { zoomControl: true }).setView(center, 15);
      window._sitePickerMap = pickerMap;
      window._sitePickerMarker = null;
      window._sitePickerCircle = null;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors', maxZoom: 19
      }).addTo(pickerMap);

      // Place marker + circle at existing coords if editing
      if (existingLat && existingLng) {
        window._sitePickerMarker = L.marker([existingLat, existingLng], { draggable: true }).addTo(pickerMap);
        _spUpdateCircle(existingLat, existingLng);
        window._sitePickerMarker.on('dragend', function (e) {
          const ll = e.target.getLatLng();
          _spSetCoords(ll.lat, ll.lng);
          _spUpdateCircle(ll.lat, ll.lng);
        });
      }

      // Click to place / move marker + circle
      pickerMap.on('click', function (e) {
        const { lat, lng } = e.latlng;
        _spSetCoords(lat, lng);
        if (window._sitePickerMarker) {
          window._sitePickerMarker.setLatLng([lat, lng]);
        } else {
          window._sitePickerMarker = L.marker([lat, lng], { draggable: true }).addTo(pickerMap);
          window._sitePickerMarker.on('dragend', function (ev) {
            const ll = ev.target.getLatLng();
            _spSetCoords(ll.lat, ll.lng);
            _spUpdateCircle(ll.lat, ll.lng);
          });
        }
        _spUpdateCircle(lat, lng);
      });
    }, 80);
  });

  // Live-update circle when radius field changes
  document.getElementById('projectRadius').addEventListener('input', function () {
    const lat = parseFloat(document.getElementById('projectLatitude').value);
    const lng = parseFloat(document.getElementById('projectLongitude').value);
    if (window._sitePickerCircle && lat && lng) _spUpdateCircle(lat, lng);
  });

  // Destroy picker map when project modal closes so it reinits cleanly next time
  document.getElementById('addProjectModal').addEventListener('hidden.bs.modal', function () {
    document.getElementById('sitePickerMapWrap').style.display = 'none';
    if (window._sitePickerMap) {
      window._sitePickerMap.remove();
      window._sitePickerMap = null;
      window._sitePickerMarker = null;
      window._sitePickerCircle = null;
    }
  });

  function addProjectSite() {
    const name = document.getElementById('projectName').value.trim();
    const address = document.getElementById('projectAddress').value.trim();
    const latitude = parseFloat(document.getElementById('projectLatitude').value);
    const longitude = parseFloat(document.getElementById('projectLongitude').value);
    const radius = parseInt(document.getElementById('projectRadius').value);
    const description = document.getElementById('projectDescription').value.trim();
    
    const ok = _validate([
      { id: 'projectName',    label: 'Project Name', rules: ['required'] },
      { id: 'projectAddress', label: 'Address',      rules: ['required'] },
      { id: 'projectRadius',  label: 'Radius',       rules: ['required', 'numeric', 'positive'] },
    ]);
    if (!ok) return;
    if (!latitude || isNaN(latitude) || latitude < -90  || latitude > 90)  { showPopup('error', 'Missing Location', 'Please use "Set Location on Map" to place the site pin.'); return; }
    if (!longitude || isNaN(longitude) || longitude < -180 || longitude > 180) { showPopup('error', 'Missing Location', 'Please use "Set Location on Map" to place the site pin.'); return; }
    
    const action = editingSiteId ? 'updateProjectSite' : 'addProjectSite';
    const args = { name, address, latitude, longitude, radius, description, actorId: currentUserId, actorUsername: currentUser };
    if (editingSiteId) args.id = editingSiteId;

    showSpinner('Saving project site...');
    api(action, args).then(res => {
      hideSpinner();
      if (res.success) {
        const modal = bootstrap.Modal.getInstance(document.getElementById('addProjectModal'));
        if (modal) modal.hide();
        document.getElementById('addProjectForm').reset();
        editingSiteId = null;
        showPopup('success', 'Saved', 'Project site saved successfully.').then(() => loadProjectSites());
      } else {
        showPopup('error', 'Failed', res.message || 'Could not save site');
      }
    }).catch(err => { hideSpinner(); showPopup('error', 'Error', err.message || 'Network error'); });
  }

  function loadProjectSites() {
    _skelOnce('s-adm-projects', () => setSkel('projectsContainer', skelCards(3)));
    apiSwr('listProjectSites', {}, {
      onData: res => {
        if (!res || !res.success) {
          document.getElementById('projectsContainer').innerHTML = `<p style="color:#b00;padding:16px;font-weight:600;">Error: ${(res && res.message) || 'Failed to load project sites'}</p>`;
          return;
        }
        projectSites = Array.isArray(res.data) ? res.data : [];
        _markLoaded('s-adm-projects');
        displayProjectSites(projectSites);
      },
      onError: err => {
        document.getElementById('projectsContainer').innerHTML = `<p style="color:#b00;padding:16px;font-weight:600;">Network error: ${err.message || 'Could not connect'}</p>`;
      }
    });
  }

  let _psMiniMaps = {}; // track leaflet instances to avoid double-init

  function displayProjectSites(sites) {
    // Update stats
    _countUp(document.getElementById('psTotalSites'),  sites.length);
    _countUp(document.getElementById('psActiveZones'), sites.length);

    const search = (document.getElementById('projectSearchInput')?.value || '').toLowerCase();
    const filtered = search
      ? sites.filter(s => s.name.toLowerCase().includes(search) || (s.address || '').toLowerCase().includes(search))
      : sites;

    if (!filtered.length) {
      document.getElementById('projectsContainer').innerHTML =
        `<div class="ps-empty"><i class="fas fa-map-marked-alt"></i><p>No project sites found. Click <strong>Add Project Site</strong> to create one.</p></div>`;
      return;
    }

    const html = filtered.map(site => {
      const lat = Number(site.latitude)  || 0;
      const lng = Number(site.longitude) || 0;
      const rad = Number(site.radius)    || 200;
      return `<div class="ps-card">
        <div class="ps-card-header">
          <h3><i class="fas fa-hard-hat"></i> ${escapeHtml(site.name)}</h3>
          <div class="ps-card-actions">
            <button class="ps-card-btn btn-edit-project" data-id="${site.id}" title="Edit"><i class="fas fa-edit"></i></button>
            <button class="ps-card-btn btn-delete-project" data-id="${site.id}" title="Delete"><i class="fas fa-trash"></i></button>
          </div>
        </div>
        <div class="ps-card-body">
          <div class="ps-detail-row"><i class="fas fa-location-dot"></i><span>${escapeHtml(site.address || '—')}</span></div>
          <div class="ps-detail-row"><i class="fas fa-crosshairs"></i><span>${lat.toFixed(5)}, ${lng.toFixed(5)} · Radius: ${rad}m</span></div>
          <div class="ps-detail-row"><i class="fas fa-align-left"></i><span>${escapeHtml(site.description || '—')}</span></div>
          <div class="ps-mini-map" id="ps-map-${site.id}"></div>
        </div>
      </div>`;
    }).join('');

    document.getElementById('projectsContainer').innerHTML = html;

    // Init mini-maps after render — destroy old instances first
    filtered.forEach(site => {
      const mapId = `ps-map-${site.id}`;
      if (_psMiniMaps[mapId]) { _psMiniMaps[mapId].remove(); delete _psMiniMaps[mapId]; }
      setTimeout(() => {
        const el = document.getElementById(mapId);
        if (!el || el._leaflet_id) return;
        const lat = Number(site.latitude) || 0;
        const lng = Number(site.longitude) || 0;
        const rad = Number(site.radius) || 200;
        const m = L.map(mapId, { zoomControl: false, dragging: false, scrollWheelZoom: false, attributionControl: false }).setView([lat, lng], 14);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 19 }).addTo(m);
        L.marker([lat, lng]).addTo(m);
        L.circle([lat, lng], { radius: rad, color: '#E40C0C', fillColor: '#FFB712', fillOpacity: 0.2, weight: 2 }).addTo(m);
        _psMiniMaps[mapId] = m;
      }, 80);
    });
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
          showPopup('success', 'Deleted', 'Project site has been deleted.').then(() => loadProjectSites());
        } else {
          showPopup('error', 'Failed', res.message || 'Could not delete');
        }
      }).catch(err => { hideSpinner(); showPopup('error', 'Error', err.message || 'Network error'); });
    });
  }

  // ─── Attendance Overview charts (local instances, destroyed on reload) ───
  let _attTrendChart = null;
  let _attStatusChart = null;
  let _attAllRows = [];   // raw rows for client-side dept filter
  let _attDepts  = [];    // list of dept names for populating the filter select

  function loadAttendanceData() {
    const month = parseInt(document.getElementById('attendanceMonth').value, 10);
    const year  = parseInt(document.getElementById('attendanceYear').value, 10);
    _skelOnce('s-adm-attendance', () => {
      destroyDataTable('attendanceTable');
      setSkel('attendanceTableBody', skelTableRows(9, 6));
    });
    apiSwr('listDailyLog', { month, year }, {
      onData: res => {
        if (!res || !res.success) {
          document.getElementById('attendanceTableBody').innerHTML =
            `<tr><td colspan="9" class="att-err">Error: ${escapeHtml((res && res.message) || 'Failed to load attendance')}</td></tr>`;
          return;
        }
        destroyDataTable('attendanceTable'); // destroy before re-init on data change
        _markLoaded('s-adm-attendance');
        _attAllRows = (res.data && res.data.rows) || [];
        _attDepts   = [...new Set(_attAllRows.map(r => r.department).filter(Boolean))].sort();
        _populateAttDeptFilter();
        _renderAttStats(res.data && res.data.stats);
        _renderAttTable();
        // Double rAF: first frame makes section visible, second has real container dimensions
        requestAnimationFrame(() => requestAnimationFrame(() => {
          _renderAttCharts(res.data && res.data.dailyTrend);
        }));
      },
      onError: err => {
        document.getElementById('attendanceTableBody').innerHTML =
          `<tr><td colspan="9" class="att-err">Network error: ${escapeHtml(err.message || 'Could not connect')}</td></tr>`;
      }
    });
  }

  function _populateAttDeptFilter() {
    const sel = document.getElementById('attDeptFilter');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="all">All Departments</option>' +
      _attDepts.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
    if (_attDepts.includes(cur)) sel.value = cur;
  }

  function _renderAttStats(stats) {
    if (!stats) return;
    _countUp(document.getElementById('attStatPresent'), stats.present);
    _countUp(document.getElementById('attStatLate'),    stats.late);
    _countUp(document.getElementById('attStatAbsent'),  stats.absent);
    const rateEl = document.getElementById('attStatRate'); if (rateEl) rateEl.textContent = (stats.rate || 0) + '%';
  }

  function _renderAttCharts(trend) {
    const pin = typeof SiomacCharts !== 'undefined' ? SiomacCharts.pinCanvas : function(){};

    // Trend line
    if (_attTrendChart) { _attTrendChart.destroy(); _attTrendChart = null; }
    const tc = document.getElementById('attTrendChart');
    if (tc && trend && trend.length) {
      pin(tc, 600, 240);
      _attTrendChart = new Chart(tc.getContext('2d'), {
        type: 'line',
        data: {
          labels: trend.map(d => String(d.date).slice(5)),
          datasets: [
            {
              label: 'Present',
              data: trend.map(d => d.present),
              borderColor: '#E40C0C',
              backgroundColor: 'rgba(228,12,12,0.06)',
              borderWidth: 2, tension: 0.3, fill: true,
              pointBackgroundColor: '#E40C0C', pointBorderColor: 'white',
              pointBorderWidth: 2, pointRadius: 3, pointHoverRadius: 5
            },
            {
              label: 'Late',
              data: trend.map(d => d.late),
              borderColor: '#FFB712',
              backgroundColor: 'transparent',
              borderWidth: 2, borderDash: [5, 5], tension: 0.3, fill: false,
              pointRadius: 3, pointHoverRadius: 5, pointBackgroundColor: '#FFB712'
            }
          ]
        },
        options: {
          responsive: false, maintainAspectRatio: false,
          animation: { duration: 1000, easing: 'easeOutCubic' },
          plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 }, padding: 16 } } },
          scales: {
            y: { beginAtZero: true, grid: { color: '#E9EEF3' }, ticks: { font: { size: 10 } } },
            x: { grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } }
          }
        }
      });
    }

    // Status distribution doughnut
    if (_attStatusChart) { _attStatusChart.destroy(); _attStatusChart = null; }
    const sc = document.getElementById('attStatusChart');
    if (sc && _attAllRows.length) {
      pin(sc, 240, 240);
      const counts = { Present: 0, Late: 0, Absent: 0 };
      _attAllRows.forEach(r => { if (counts[r.status] !== undefined) counts[r.status]++; });
      _attStatusChart = new Chart(sc.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: ['Present', 'Late', 'Absent'],
          datasets: [{
            data: [counts.Present, counts.Late, counts.Absent],
            backgroundColor: ['#2E7D32', '#FFB712', '#E40C0C'],
            borderWidth: 0, hoverOffset: 8
          }]
        },
        options: {
          responsive: false, maintainAspectRatio: false,
          cutout: '65%',
          animation: { duration: 900, easing: 'easeOutQuart' },
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 }, padding: 12 } } }
        }
      });
    }
  }

  function _renderAttTable() {
    const dept   = (document.getElementById('attDeptFilter') || {}).value || 'all';
    const search = ((document.getElementById('attSearchInput') || {}).value || '').toLowerCase();

    let rows = _attAllRows;
    if (dept !== 'all') rows = rows.filter(r => r.department === dept);
    if (search)         rows = rows.filter(r => r.name.toLowerCase().includes(search) || r.department.toLowerCase().includes(search));

    const countEl = document.getElementById('attLogCount');
    if (countEl) countEl.textContent = rows.length + ' record' + (rows.length !== 1 ? 's' : '');

    const thumb = (inUrl, outUrl) => {
      if (inUrl) return `<a href="${inUrl}" target="_blank" rel="noopener" class="att-selfie-thumb" title="View check-in selfie"><img src="${inUrl}" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-camera-slash\\'></i>'"></a>`;
      return `<div class="att-selfie-thumb att-no-photo"><i class="fas fa-user-slash"></i></div>`;
    };

    const statusBadge = s => {
      if (s === 'Present') return `<span class="att-badge att-present"><i class="fas fa-circle"></i> Present</span>`;
      if (s === 'Late')    return `<span class="att-badge att-late"><i class="fas fa-circle"></i> Late</span>`;
      return                      `<span class="att-badge att-absent"><i class="fas fa-circle"></i> Absent</span>`;
    };

    const html = rows.map(r => `
      <tr>
        <td><strong class="att-name">${escapeHtml(r.name)}</strong></td>
        <td><span class="att-dept-pill">${escapeHtml(r.department)}</span></td>
        <td class="att-date">${r.date}</td>
        <td class="att-time">${r.checkIn  ? fmtLocalTime(r.checkIn)  : '—'}</td>
        <td class="att-time">${r.checkOut ? fmtLocalTime(r.checkOut) : '—'}</td>
        <td class="att-hours">${r.hours > 0 ? r.hours + 'h' : '—'}</td>
        <td>${statusBadge(r.status)}</td>
        <td>${thumb(r.checkInPhotoUrl, r.checkOutPhotoUrl)}</td>
        <td>
          <button class="att-action-btn btn-view-att"
            data-in="${escapeHtml(r.checkInPhotoUrl || '')}"
            data-out="${escapeHtml(r.checkOutPhotoUrl || '')}"
            data-name="${escapeHtml(r.name)}"
            title="View photos"><i class="fas fa-chevron-right"></i></button>
        </td>
      </tr>`).join('') || `<tr><td colspan="9" class="att-empty">No records match your filters.</td></tr>`;

    destroyDataTable('attendanceTable');
    document.getElementById('attendanceTableBody').innerHTML = html;
    initDataTable('attendanceTable', {
      searching: false,
      dom: "<'dt-export-bar'B>rt<'dt-foot'<'dt-len'l><'dt-info'i><'dt-page'p>>",
      columnDefs: [{ targets: -1, orderable: false, searchable: false, className: 'text-center dt-no-export' }],
      initComplete: function() {
        // Move dt-buttons group into the section-header
        const btnContainer = document.getElementById('attTableBtns');
        const dtBtns = document.querySelector('#attendanceTable_wrapper .dt-buttons');
        if (btnContainer && dtBtns) btnContainer.appendChild(dtBtns);
      }
    });
  }

  function displayAttendanceData() {} // kept for any legacy callers

  function viewAttendancePhotos(inUrl, outUrl, name) {
    const slot = (url, label) => url
      ? `<div class="text-center mx-2"><div class="fw-bold mb-1" style="color:var(--siomac-navy)">${label}</div><a href="${url}" target="_blank"><img src="${url}" style="max-width:240px;max-height:320px;border-radius:12px;border:2px solid var(--siomac-red);" onerror="this.replaceWith(Object.assign(document.createElement('div'),{textContent:'Image unavailable',className:'text-muted'}))"></a></div>`
      : `<div class="text-center mx-2"><div class="fw-bold mb-1" style="color:var(--siomac-navy)">${label}</div><div class="text-muted" style="width:200px;padding:48px 0;border:1px dashed #ccc;border-radius:12px;">No selfie</div></div>`;
    Swal.fire({
      title: `<span style="color:var(--siomac-navy);font-weight:700">${name}</span>`,
      html: `<div style="display:flex;justify-content:center;flex-wrap:wrap;gap:16px;padding:8px 0">${slot(inUrl, 'Check In')}${slot(outUrl, 'Check Out')}</div>`,
      width: '620px',
      background: 'rgba(255,255,255,0.97)',
      showConfirmButton: false,
      showCloseButton: true
    });
  }

  function loadLeaveApplications() {
    _skelOnce('s-adm-leaves', () => setSkel('leavesTableBody', skelTableRows(8, 4)));
    apiSwr('listAllLeaves', {}, {
      onData: res => { _markLoaded('s-adm-leaves'); displayLeaveApplications((res && res.success && res.data) || []); }
    });
  }

  function displayLeaveApplications(leaves) {
    _lvAdmList = leaves;
    _lvUpdateStats('admLv', leaves);
    _renderAdmLeaves();
    if (typeof window._refreshNavBadges === 'function') window._refreshNavBadges(_getPendingLeaveCount());
  }

  function _renderAdmLeaves() {
    const tab    = _lvAdmTab;
    const search = _lvAdmSearch.toLowerCase();
    const typeF  = _lvAdmTypeFilter;
    let filtered = _lvAdmList.filter(r => {
      const s = String(r.status).toLowerCase();
      if (tab === 'adm-pending')  { if (s !== 'pending')  return false; }
      if (tab === 'adm-approved') { if (s !== 'approved') return false; }
      if (tab === 'adm-rejected') { if (s !== 'rejected') return false; }
      if (typeF !== 'all' && String(r.type).toLowerCase() !== typeF) return false;
      if (search) {
        const name = (r.employee || '').toLowerCase();
        const dept = (r.department || '').toLowerCase();
        if (!name.includes(search) && !dept.includes(search)) return false;
      }
      return true;
    });
    document.getElementById('leavesTableBody').innerHTML = filtered.length
      ? filtered.map(r => _lvCard(r, { showEmployee: true, showApproveReject: true, showEdit: true, showDelete: true, showView: true })).join('')
      : _lvEmpty('No leave requests found.', 8);
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
        showPopup('success', 'Deleted', 'Leave application removed.').then(() => loadLeaveApplications());
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
        { extend: 'csv',   text: '<i class="fas fa-file-csv"></i> CSV',   className: 'buttons-csv',   exportOptions: { columns: ':not(.dt-no-export)' } },
        { extend: 'pdf',   text: '<i class="fas fa-file-pdf"></i> PDF',   className: 'buttons-pdf',   exportOptions: { columns: ':not(.dt-no-export)' } },
        { extend: 'print', text: '<i class="fas fa-print"></i> Print',    className: 'buttons-print', exportOptions: { columns: ':not(.dt-no-export)' } }
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
  let _hrSearch = '', _hrDept = 'all', _hrRole = 'all';

  function loadHourlyRates() {
    const tbody = document.getElementById('ratesTableBody');
    if (!tbody) return;
    _skelOnce('s-adm-rates', () => { tbody.innerHTML = skelTableRows(6, 6); });
    // SWR both calls in parallel — currency from settings is small + cached separately
    apiSwr('listHourlyRates', {}, {
      onData: res => {
        _markLoaded('s-adm-rates');
        _ratesData = (res && res.success && res.data) || [];
        _populateHrDeptFilter();
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

  function _populateHrDeptFilter() {
    const sel = document.getElementById('hrDeptFilter');
    if (!sel) return;
    const depts = [...new Set(_ratesData.map(r => r.department).filter(Boolean))].sort();
    const current = sel.value;
    sel.innerHTML = '<option value="all">All Departments</option>'
      + depts.map(d => `<option value="${escapeHtml(d)}"${d === current ? ' selected' : ''}>${escapeHtml(d)}</option>`).join('');
  }

  function _hrUpdateStats(list) {
    const total = list.length;
    const rates = list.map(r => r.hourlyRate || 0);
    const avg   = total ? (rates.reduce((s, v) => s + v, 0) / total) : 0;
    const max   = total ? Math.max(...rates) : 0;
    const monthly = list.reduce((s, r) => s + (r.hourlyRate || 0) * 160, 0);
    const cur = _payCurrency + '$';
    const el = id => document.getElementById(id);
    _countUp(el('hrTotalEmployees'), total);
    if (el('hrAvgRate'))        el('hrAvgRate').textContent        = cur + ' ' + avg.toFixed(2);
    if (el('hrMonthlyPayroll')) el('hrMonthlyPayroll').textContent = cur + ' ' + Math.round(monthly).toLocaleString();
    if (el('hrHighestRate'))    el('hrHighestRate').textContent    = cur + ' ' + max.toFixed(2);
  }

  function renderHourlyRates() {
    const tbody = document.getElementById('ratesTableBody');
    if (!tbody) return;

    // client-side filter
    const search = _hrSearch.toLowerCase();
    const filtered = _ratesData.filter(r => {
      if (search && !String(r.fullName || '').toLowerCase().includes(search) && !String(r.department || '').toLowerCase().includes(search)) return false;
      if (_hrDept !== 'all' && r.department !== _hrDept) return false;
      if (_hrRole !== 'all' && r.role !== _hrRole) return false;
      return true;
    });

    _hrUpdateStats(filtered);

    if (!filtered.length) {
      tbody.innerHTML = `<tr class="hr-empty-row"><td colspan="6"><i class="fas fa-users-slash"></i>${_ratesData.length ? 'No employees match your filters' : 'No employees yet'}</td></tr>`;
      return;
    }

    const roleCls = r => r === 'admin' ? 'hr-role-admin' : r === 'manager' ? 'hr-role-manager' : 'hr-role-employee';
    const cur = escapeHtml(_payCurrency) + '$';

    tbody.innerHTML = filtered.map(r => `
      <tr>
        <td class="hr-emp-name">${escapeHtml(r.fullName)}</td>
        <td>${escapeHtml(r.department)}</td>
        <td>${escapeHtml(r.position)}</td>
        <td class="hr-td-center"><span class="hr-role-badge ${roleCls(r.role)}">${escapeHtml(r.role)}</span></td>
        <td class="hr-td-center">
          <div class="hr-rate-cell">
            <span class="hr-currency">${cur}</span>
            <input type="number" class="hr-rate-input rate-input" min="0" step="0.50"
              data-username="${escapeHtml(r.username)}"
              data-original="${r.hourlyRate}"
              value="${r.hourlyRate}">
          </div>
        </td>
        <td class="hr-td-center">
          <button class="hr-save-btn btn-save-rate" data-username="${escapeHtml(r.username)}">
            <i class="fas fa-save"></i> Save
          </button>
        </td>
      </tr>
    `).join('');

    // mark dirty on input change
    tbody.querySelectorAll('.hr-rate-input').forEach(inp => {
      inp.addEventListener('input', function () {
        this.classList.toggle('dirty', parseFloat(this.value) !== parseFloat(this.dataset.original));
      });
    });
  }

  // ── New rates action helpers ──────────────────────────────────
  function _hrSaveAll() {
    const inputs = document.querySelectorAll('#ratesTableBody .hr-rate-input.dirty');
    if (!inputs.length) { showNotification('No changes to save', 'info'); return; }
    let done = 0;
    inputs.forEach(inp => {
      const username = inp.dataset.username;
      const rate = Number(inp.value);
      if (!username || isNaN(rate) || rate < 0) return;
      api('updateHourlyRate', { username, rate, actorId: currentUserId, actorUsername: currentUser }).then(res => {
        if (!res.success) return;
        inp.dataset.original = String(rate);
        inp.classList.remove('dirty');
        const emp = _ratesData.find(r => r.username === username);
        if (emp) emp.hourlyRate = rate;
        done++;
        if (done === inputs.length) {
          _hrUpdateStats(_ratesData);
          showNotification(`Saved ${done} rate update${done > 1 ? 's' : ''}`, 'success');
        }
      });
    });
  }

  function _hrExportCsv() {
    let csv = 'Username,Name,Department,Position,Role,Hourly Rate\n';
    _ratesData.forEach(r => {
      csv += `"${r.username}","${r.fullName}","${r.department}","${r.position}","${r.role}",${r.hourlyRate}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `siomac_hourly_rates_${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    showNotification('CSV exported', 'success');
  }

  function _hrOpenModal() {
    const m = document.getElementById('hrImportModal');
    if (m) m.classList.add('active');
  }
  function _hrCloseModal() {
    const m = document.getElementById('hrImportModal');
    if (m) { m.classList.remove('active'); }
    const ta = document.getElementById('hrCsvPasteArea');
    if (ta) ta.value = '';
    const fi = document.getElementById('hrFileInput');
    if (fi) fi.value = '';
  }

  function _hrHandleFile(file) {
    const reader = new FileReader();
    reader.onload = e => {
      const ta = document.getElementById('hrCsvPasteArea');
      if (ta) ta.value = e.target.result;
    };
    reader.readAsText(file);
  }

  function _hrConfirmImport() {
    const raw = (document.getElementById('hrCsvPasteArea') || {}).value || '';
    if (!raw.trim()) { showNotification('Paste CSV data or select a file', 'warning'); return; }
    let parsed;
    try { parsed = parseRatesCsv(raw); }
    catch (err) { showNotification('CSV parse error: ' + err.message, 'error'); return; }
    if (!parsed.length) { showNotification('No valid rows found. Format: username,rate', 'warning'); return; }
    api('bulkImportRates', { rows: parsed, actorId: currentUserId, actorUsername: currentUser }).then(r => {
      _hrCloseModal();
      if (!r.success) { showNotification(r.message || 'Import failed', 'error'); return; }
      showNotification(`Imported ${r.updated} rate${r.updated !== 1 ? 's' : ''}${r.skipped ? ` · ${r.skipped} skipped` : ''}`, 'success');
      loadHourlyRates();
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
        Swal.fire({ icon: 'success', title: 'Rate Saved', toast: true, position: 'top-end', timer: 2500, showConfirmButton: false, timerProgressBar: true });
      }
    });
  }

  // ─── Payroll: generator + printable doc (admin + manager) ───
  let _payrollData = null;

  let _payrollInitDone = false;

  function initPayrollSection() {
    // populate year dropdown once
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
    // default month = current month (only on first open)
    const monthSel = document.getElementById('payrollMonth');
    if (monthSel && !_payrollInitDone) monthSel.value = String(new Date().getMonth());

    // populate employees only once (avoid blank flash on revisit)
    const empSel = document.getElementById('payrollEmployee');
    if (empSel && !_payrollInitDone) {
      empSel.innerHTML = '<option value="">Loading employees…</option>';
      api('getPayrollEmployees', { requesterUsername: currentUser }).then(res => {
        const list = (res.success && res.data) || [];
        empSel.innerHTML = list.length
          ? list.map(e => '<option value="' + escapeHtml(e.username) + '">' + escapeHtml(e.fullName) + ' — ' + escapeHtml(e.department) + '</option>').join('')
          : '<option value="">No employees available</option>';
      });
    }

    // pull currency from settings once
    if (!_payrollInitDone) {
      api('getSettings').then(res => {
        if (res && res.data && res.data.currency) _payCurrency = res.data.currency;
      });
    }

    _payrollInitDone = true;
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
          const cls = (!day.checkOut && day.checkIn) ? 'row-no-checkout'
                    : (day.status === 'late') ? 'row-late' : '';
          return '<tr class="' + cls + '">'
            + '<td class="num">' + (i + 1) + '</td>'
            + '<td>' + escapeHtml(day.date) + '</td>'
            + '<td class="center">' + (day.checkIn  ? fmtLocalTime(day.checkIn)  : '—') + '</td>'
            + '<td class="center">' + (day.checkOut ? fmtLocalTime(day.checkOut) : '—') + '</td>'
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

  // In-memory photo state — set after every save so sync never overwrites it
  let _currentProfileImage = null; // null = "not yet loaded from DB"; '' = "no photo"; url = signed url

  function _profileToast(msg, isError) {
    const el = document.getElementById('profileToast');
    if (!el) return;
    el.className = 'profile-toast' + (isError ? ' error' : '');
    el.innerHTML = `<i class="fas fa-${isError ? 'exclamation-circle' : 'check-circle'}"></i> ${msg}`;
    el.style.display = 'flex';
    clearTimeout(_profileToast._t);
    _profileToast._t = setTimeout(() => { el.style.display = 'none'; }, 3500);
  }

  function _updateProfileDisplayUI(u) {
    const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v || '—'; };
    setEl('profileDisplayName', u.fullName);
    setEl('profileDisplayRole', u.role ? u.role.charAt(0).toUpperCase() + u.role.slice(1) : '—');
    setEl('profileDisplayDept', u.department);
    setEl('profileDisplayUsername', u.username);
    setEl('profileDisplayPosition', u.position);
    // Contact row chips
    setEl('profileContactEmail', u.email);
    setEl('profileContactPhone', u.phone);
    // Employee ID field (readonly input in personal tab)
    const empNumInput = document.getElementById('profileEmployeeNumber');
    if (empNumInput && empNumInput.tagName === 'INPUT') empNumInput.value = u.employeeNumber || '';
  }

  function loadMyProfile() {
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    setVal('profileUsername', currentUser);
    setVal('profileFullName', currentFullName);
    setVal('profilePosition', '');
    setVal('profileOldPwd', '');
    setVal('profileNewPwd', '');
    setVal('profileConfirmPwd', '');

    _updateProfileDisplayUI({ fullName: currentFullName, username: currentUser, role: currentRole });

    if (_currentProfileImage !== null) {
      _profileImageBase64 = '';
      _removeProfileImage  = false;
      _setProfilePhotoUI(_currentProfileImage, currentFullName);
    }

    api('getEmployeeByUsername', { username: currentUser }).then(res => {
      if (res && res.success && res.data) {
        const u = res.data;
        setVal('profileFullName', u.fullName);
        setVal('profilePosition', u.position);
        setVal('profileDept', u.department);
        setVal('profileEmail', u.email);
        setPhone('profilePhone', u.phone);
        _profileImageBase64 = '';
        _removeProfileImage  = false;
        _updateProfileDisplayUI({ ...u, username: currentUser });
        if (_currentProfileImage === null) {
          _currentProfileImage = u.profileImage || '';
          _setProfilePhotoUI(_currentProfileImage, u.fullName);
        }
      }
    });

    // Load activity timeline
    _loadProfileActivity();

    // Load dummy documents (employee only)
    if (currentRole === 'employee') _loadProfileDocuments();
  }

  function _loadProfileActivity() {
    const container = document.getElementById('profileActivityList');
    if (!container) return;

    const fmtDate = d => {
      if (!d) return '';
      const dt = new Date(d);
      return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
             ' · ' + dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    };

    Promise.all([
      api('getMyHistory', {}).catch(() => null),
      api('getMyLeaves',  {}).catch(() => null)
    ]).then(([attRows, leaveRows]) => {
      if (!container) return;
      const events = [];

      // getMyHistory returns an array directly (not wrapped in {success, data})
      const attData = Array.isArray(attRows) ? attRows : (attRows && Array.isArray(attRows.data) ? attRows.data : []);
      attData.slice(0, 15).forEach(r => {
        // r = { date: "2025-05-07", checkIn: ISO|null, checkOut: ISO|null, hours, status }
        if (r.checkIn)  events.push({ icon: 'fa-sign-in-alt',  title: 'Clocked In',  date: r.date + ', ' + fmtLocalTime(r.checkIn),  raw: new Date(r.checkIn) });
        if (r.checkOut) events.push({ icon: 'fa-sign-out-alt', title: 'Clocked Out', date: r.date + ', ' + fmtLocalTime(r.checkOut), raw: new Date(r.checkOut) });
      });

      // getMyLeaves also returns array directly
      const leaveData = Array.isArray(leaveRows) ? leaveRows : (leaveRows && Array.isArray(leaveRows.data) ? leaveRows.data : []);
      leaveData.slice(0, 10).forEach(r => {
        // r = { id, type, from, to, days, reason, status, appliedOn }
        const status = r.status || '';
        const label  = status === 'Approved' ? 'Leave Approved' : status === 'Rejected' ? 'Leave Rejected' : 'Leave Requested';
        const icon   = status === 'Approved' ? 'fa-check-circle' : status === 'Rejected' ? 'fa-times-circle' : 'fa-calendar-plus';
        const dateRaw = r.appliedOn || r.from || '';
        events.push({ icon, title: label + (r.type ? ` (${r.type})` : ''), date: dateRaw, raw: new Date(dateRaw) });
      });

      // Sort newest first
      events.sort((a, b) => b.raw - a.raw);

      if (!events.length) {
        container.innerHTML = '<div class="ep-timeline-empty"><i class="fas fa-history"></i><p>No recent activity</p></div>';
        return;
      }

      container.innerHTML = events.slice(0, 15).map(e => `
        <div class="ep-timeline-item">
          <div class="ep-timeline-icon"><i class="fas ${e.icon}"></i></div>
          <div class="ep-timeline-body">
            <div class="ep-timeline-title">${e.title}</div>
            <div class="ep-timeline-date">${fmtDate(e.date)}</div>
          </div>
        </div>
      `).join('');
    });
  }

  function _loadProfileDocuments() {
    const container = document.getElementById('profileDocList');
    if (!container) return;
    const docs = [
      { icon: 'fa-file-pdf',  name: 'Employment Contract.pdf',       size: '1.2 MB' },
      { icon: 'fa-id-card',   name: 'ID_Card_Scan.pdf',              size: '0.8 MB' },
      { icon: 'fa-file-alt',  name: 'Performance_Review_2024.pdf',   size: '2.1 MB' },
    ];
    container.innerHTML = docs.map(d => `
      <div class="ep-doc-item">
        <div class="ep-doc-icon"><i class="fas ${d.icon}"></i></div>
        <div class="ep-doc-body">
          <div class="ep-doc-name">${d.name}</div>
          <div class="ep-doc-size">${d.size}</div>
        </div>
        <button class="ep-doc-download"><i class="fas fa-download"></i> Download</button>
      </div>
    `).join('');
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

  // Central avatar swap — checks window._preloadedProfileImage first.
  // If the image for this URL was preloaded in <head> and is already decoded
  // (complete === true), applies it instantly with zero delay.
  // Otherwise falls back to a probe Image() — shows initial until ready.
  // target variants:
  //   'hdr'        → el is the hdrProfileAvatar div
  //   'attendance' → el is the .user-avatar div
  //   'profile'    → el is { _profileEl, imgEl, emptyEl, removeBtn }
  function _swapAvatarImg(el, url, initial, variant) {
    const preloaded = window._preloadedProfileImage;
    const isReady   = preloaded && window._preloadedProfileUrl === url && preloaded.complete && preloaded.naturalWidth > 0;

    function applyImg() {
      if (variant === 'hdr') {
        el.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
      } else if (variant === 'attendance') {
        el.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
      } else if (variant === 'profile') {
        el.imgEl.src           = url;
        el.imgEl.style.display = 'block';
        el.emptyEl.style.display = 'none';
        if (el.removeBtn) el.removeBtn.style.display = '';
      }
    }

    function applyFallback() {
      if (variant === 'profile') {
        el.imgEl.src             = '';
        el.imgEl.style.display   = 'none';
        el.emptyEl.style.display = 'flex';
        el.emptyEl.textContent   = initial;
        if (el.removeBtn) el.removeBtn.style.display = 'none';
      }
      // hdr and attendance already show initial before this call
    }

    if (isReady) {
      // Image already decoded — apply instantly, no flash
      applyImg();
      return;
    }

    // Not yet ready — probe; show initial in the meantime
    if (variant === 'hdr')        el.textContent = initial;
    if (variant === 'attendance') el.innerHTML   = `<span>${initial}</span>`;

    const probe = new Image();
    probe.onload  = applyImg;
    probe.onerror = applyFallback;
    probe.src = url;
  }

  function _setAttendanceAvatar(imgUrl, fullName) {
    const avatarDiv = document.querySelector('.user-avatar');
    if (!avatarDiv) return;
    const initial = (fullName || currentFullName || '?').charAt(0).toUpperCase();
    if (imgUrl) {
      _swapAvatarImg(avatarDiv, imgUrl, initial, 'attendance');
    } else {
      avatarDiv.innerHTML = `<span>${initial}</span>`;
    }
  }

  function _setProfilePhotoUI(imgUrl, fullName) {
    // also sync the attendance welcome card avatar
    _setAttendanceAvatar(imgUrl, fullName);
    const imgEl     = document.getElementById('profilePhotoPreview');
    const emptyEl   = document.getElementById('profilePhotoEmpty');
    const removeBtn = document.getElementById('removeProfileImageBtn');
    const initial   = (fullName || currentFullName || '?').trim().charAt(0).toUpperCase();

    if (imgUrl) {
      // Start with initials visible
      imgEl.style.display = 'none';
      emptyEl.style.display = 'flex';
      emptyEl.textContent = initial;
      if (removeBtn) removeBtn.style.display = 'none';

      _swapAvatarImg({ _profileEl: true, imgEl, emptyEl, removeBtn }, imgUrl, initial, 'profile');
    } else {
      imgEl.src = '';
      imgEl.style.display = 'none';
      emptyEl.style.display = 'flex';
      emptyEl.textContent = initial;
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
    const fullName    = (document.getElementById('profileFullName')?.value || '').trim();
    const email       = (document.getElementById('profileEmail')?.value || '').trim();
    const phone       = readPhone('profilePhone');
    const oldPwd      = document.getElementById('profileOldPwd')?.value || '';
    const newPwd      = document.getElementById('profileNewPwd')?.value || '';
    const confirmPwd  = document.getElementById('profileConfirmPwd')?.value || '';

    const profileOk = _validate([
      { id: 'profileFullName', label: 'Full Name', rules: ['required'] },
      { id: 'profileEmail',    label: 'Email',     rules: ['email'] },
      { id: 'profilePhone',    label: 'Phone',     rules: ['phone'] },
      { id: 'profileNewPwd',   check: () => newPwd && newPwd.length < 6 ? 'Password must be at least 6 characters.' : null },
      { id: 'profileConfirmPwd', check: () => newPwd && newPwd !== confirmPwd ? 'Passwords do not match.' : null },
      { id: 'profileOldPwd',   check: () => newPwd && !oldPwd ? 'Enter your current password to change it.' : null },
    ]);
    if (!profileOk) return;

    const btn = document.getElementById('saveProfileBtn');
    const orig = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

    api('updateMyProfile', {
      username: currentUser,
      fullName,
      email,
      phone,
      profileImageBase64: _profileImageBase64 || '',
      removeProfileImage: _removeProfileImage || false,
      oldPassword: oldPwd,
      newPassword: newPwd
    }).then(res => {
      btn.disabled = false; btn.innerHTML = orig;
      if (!res.success) { _profileToast(res.message || 'Update failed.', true); return; }

      currentFullName = res.fullName || fullName;

      const newPhoto = res.profileImage || '';
      // Evict old photo URL from SW photo cache before setting the new one
      if (_currentProfileImage && _currentProfileImage !== newPhoto) {
        if (typeof SwCacheManager !== 'undefined') SwCacheManager.evictPhoto(_currentProfileImage);
      }
      _currentProfileImage = newPhoto;
      // Update header profile avatar
      const hdrAv = document.getElementById('hdrProfileAvatar');
      if (hdrAv) {
        const initial = (currentFullName || currentUser || '?').trim().charAt(0).toUpperCase();
        if (newPhoto) {
          // Update the preload reference so _swapAvatarImg picks it up immediately next time
          window._preloadedProfileUrl = newPhoto;
          window._preloadedProfileImage = new Image();
          window._preloadedProfileImage.src = newPhoto;
          _swapAvatarImg(hdrAv, newPhoto, initial, 'hdr');
        } else {
          hdrAv.textContent = initial;
        }
      }
      _setProfilePhotoUI(newPhoto, currentFullName);
      updateStoredSession({ profileImage: newPhoto });
      _updateProfileDisplayUI({ fullName: currentFullName, username: currentUser, role: currentRole, email, phone });

      _profileImageBase64 = '';
      _removeProfileImage  = false;
      const clr = id => { const el = document.getElementById(id); if (el) el.value = ''; };
      clr('profileOldPwd'); clr('profileNewPwd'); clr('profileConfirmPwd');
      swr.clear();
      _profileToast('Profile updated successfully!');
    }).catch(err => { btn.disabled = false; btn.innerHTML = orig; _profileToast(err.message || 'Network error', true); });
  }

  function _updateSecurityOnly() {
    const oldPwd     = (document.getElementById('profileOldPwd')?.value || '');
    const newPwd     = (document.getElementById('profileNewPwd')?.value || '').trim();
    const confirmPwd = (document.getElementById('profileConfirmPwd')?.value || '').trim();
    if (!newPwd) { _profileToast('Enter a new password.', true); return; }
    if (newPwd.length < 6) { _profileToast('New password must be at least 6 characters.', true); return; }
    if (newPwd !== confirmPwd) { _profileToast('Passwords do not match.', true); return; }
    if (!oldPwd) { _profileToast('Enter your current password.', true); return; }

    const btn = document.getElementById('updateSecurityBtn');
    const orig = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';

    api('updateMyProfile', {
      username: currentUser, fullName: currentFullName,
      profileImageBase64: '', removeProfileImage: false,
      oldPassword: oldPwd, newPassword: newPwd
    }).then(res => {
      btn.disabled = false; btn.innerHTML = orig;
      if (!res.success) { _profileToast(res.message || 'Update failed.', true); return; }
      const clr = id => { const el = document.getElementById(id); if (el) el.value = ''; };
      clr('profileOldPwd'); clr('profileNewPwd'); clr('profileConfirmPwd');
      _profileToast('Password updated successfully!');
    }).catch(err => { btn.disabled = false; btn.innerHTML = orig; _profileToast(err.message || 'Network error', true); });
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
      if (!res.success) { btn.disabled = false; showPopup('error', 'Upload Failed', res.message || 'Could not save logo'); return; }
      _logoBase64 = '';
      applyCompanyLogo(res.url);
      updateStoredSession({ companyLogoUrl: res.url || '' });
      showPopup('success', 'Logo Updated', 'Login + sidebar now show the new logo.');
    }).catch(err => { btn.disabled = false; btn.innerHTML = orig; showPopup('error', 'Upload Failed', err.message || 'Network error'); });
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

  function _stgResetDefaults() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('setCompanyName',  'My Company');
    set('setLatePenalty',  '0');
    set('setLeaveFine',    '0');
    set('setLateThreshold','09:00');
    set('setMaxDistance',  '200');
    cpop.fire({ icon: 'info', title: 'Reset to defaults', text: 'Fields reset. Click Save Settings to apply.', showConfirmButton: true });
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
    const aboutLogoFallback = document.getElementById('aboutLogoFallback');
    if (aboutLogo) {
      if (url) {
        aboutLogo.src = url;
        aboutLogo.style.display = 'block';
        if (aboutLogoFallback) aboutLogoFallback.style.display = 'none';
      } else {
        aboutLogo.style.display = 'none';
        if (aboutLogoFallback) aboutLogoFallback.style.display = '';
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
        img.style.cssText = 'height:72px; max-width:180px; width:auto; object-fit:contain; display:block;';
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
    deleteEmployee: deleteEmployee,
    goTo: goTo
  };
})();

// Initialize after index.html has loaded the app shell partial.
// Warm the in-memory SWR from IndexedDB first so first renders are instant,
// then init the app. warmSwr() is non-blocking and degrades gracefully.
function _safeInit() {
  const doInit = () => {
    try {
      AttendanceSystem.init();
    } catch (e) {
      console.error('AttendanceSystem.init() threw:', e);
      throw e;
    }
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
