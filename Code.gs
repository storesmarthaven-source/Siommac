/**
 * Developed by Mohammad Rameez Imdad (Rameez Scripts)
 * WhatsApp: https://wa.me/923224083545 (For Custom Projects)
 * YouTube: https://www.youtube.com/@rameezimdad (Subscribe for more!)
 */

// ───────────────────────── constants ─────────────────────────
const SS_NAME      = 'ZKB Attendance DB';
const PHOTOS_FOLDER = 'ZKB Attendance Photos';
const TZ           = 'Asia/Karachi';

// sheet names
const SH = {
  users:    'Users',
  depts:    'Departments',
  sites:    'ProjectSites',
  att:      'Attendance',
  leaves:   'LeaveRequests',
  logs:     'ActivityLogs',
  settings: 'Settings'
};

// schema — header rows live at row 1, data starts at row 2
const COLS = {
  users:    ['id','username','password','fullName','role','departmentId','position','status','createdAt','updatedAt','colorScheme','layoutMode','hourlyRate','profileImage'],
  depts:    ['id','name','description','managerId','createdAt','updatedAt'],
  sites:    ['id','name','address','latitude','longitude','radius','description','createdAt','updatedAt'],
  att:      ['id','userId','username','date','checkInTime','checkOutTime','checkInLat','checkInLng','checkInAccuracy','checkInPhotoUrl','checkInSiteId','checkInDistanceM','checkOutLat','checkOutLng','checkOutAccuracy','checkOutPhotoUrl','checkOutSiteId','checkOutDistanceM','totalHours','status','notes'],
  leaves:   ['id','userId','username','departmentId','type','fromDate','toDate','days','reason','status','reviewedBy','reviewedAt','reviewNotes','appliedAt'],
  logs:     ['id','timestamp','userId','username','action','entity','entityId','details'],
  settings: ['key','value','updatedAt']
};

// default settings
const DEFAULTS = {
  companyName:        'Rameez Scripts',
  workStartHour:      '6',
  workEndHour:        '22',
  lateThresholdHHMM:  '09:15',
  maxDistanceM:       '200',
  photosFolderId:     '',
  projectAreaCenter:  '26.6814598463,68.0169318169',
  currency:           'Rs.',
  companyLogoUrl:     '',
  latePenaltyPerDay:  '0',
  leaveFinePerDay:    '0'
};

// default zones (Moro → Ranipur) — seeded into ProjectSites on setup
const DEFAULT_ZONES = [
  { name: 'Moro Starting Point',          lat: 26.6814598463, lng: 68.0169318169, radius: 150 },
  { name: 'Section A - Bridge Construction', lat: 26.6885305450, lng: 68.0231489403, radius: 200 },
  { name: 'Section B - Road Work',        lat: 26.6954443820, lng: 68.0296018956, radius: 180 },
  { name: 'Section C - Earthwork',        lat: 26.7024535367, lng: 68.0359368316, radius: 220 },
  { name: 'Section D - Drainage',         lat: 26.7094487711, lng: 68.0422911191, radius: 160 },
  { name: 'Section E - Pavement',         lat: 26.7164584161, lng: 68.0486261814, radius: 190 },
  { name: 'Ranipur End Point',            lat: 26.7234578251, lng: 68.0549755997, radius: 150 }
];

// ───────────────────────── web entry (doPost router) ─────────────────────────
function doPost(e) {
  let action = '', args = {};
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    action = body.action || '';
    args = body.args || {};
  } catch (_) {
    return resp_({ success: false, message: 'Invalid JSON body' });
  }

  const fn = ROUTES[action];
  if (!fn) return resp_({ success: false, message: 'Unknown action: ' + action });

  try {
    const out = fn(args || {});
    // pass through {success,...} shapes; wrap raw data with {success:true,data}
    if (out && typeof out === 'object' && !Array.isArray(out) && 'success' in out) return resp_(out);
    return resp_({ success: true, data: out == null ? null : out });
  } catch (err) {
    console.error(action, err && err.stack ? err.stack : err);
    return resp_({ success: false, message: (err && err.message) || String(err) });
  }
}

// diagnostic — open the /exec URL in a browser to confirm the deployment is alive
function doGet() {
  return resp_({ ok: true, api: 'ZKB Attendance', ts: isoNow_(), routes: Object.keys(ROUTES) });
}

function resp_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// route → handler. Each line documents the args shape the caller must send.
const ROUTES = {
  ping:                       () => ({ ok: true, ts: isoNow_() }),

  // auth
  login:                      a => login(a.username, a.password),
  logout:                     a => logout(a.userId, a.username),
  updateColorScheme:          a => updateColorScheme(a.username, a.scheme),
  updateLayoutMode:           a => updateLayoutMode(a.username, a.mode),

  // employee
  getMyStatus:                a => getMyStatus(a.username),
  getMyHistory:               a => getMyHistory(a.username, a.days),
  getMyChart:                 a => getMyChart(a.username, a.year, a.month),
  getMyLeaves:                a => getMyLeaves(a.username),
  submitLeave:                a => submitLeave(a),
  markAttendance:             a => markAttendance(a),

  // manager
  getDeptStats:               a => getDeptStats(a.managerUsername),
  getDeptEmployees:           a => getDeptEmployees(a.managerUsername),
  getPendingLeavesForManager: a => getPendingLeavesForManager(a.managerUsername),
  approveLeave:               a => approveLeave(a.leaveId, a.reviewerId, a.reviewerUsername, a.notes),
  rejectLeave:                a => rejectLeave(a.leaveId, a.reviewerId, a.reviewerUsername, a.notes),
  getLeaveById:               a => getLeaveById(a.leaveId, a.requesterUsername),
  updateLeave:                a => updateLeave(a),
  deleteLeave:                a => deleteLeave(a.leaveId, a.actorId, a.actorUsername),

  // admin — read
  getAdminStats:              () => getAdminStats(),
  getDashboardCharts:         () => getDashboardCharts(),
  getLiveAttendance:          a => getLiveAttendance(a && a.scope),
  listEmployees:              () => listEmployees(),
  listDepartments:            () => listDepartments(),
  listManagers:               () => listManagers(),
  listProjectSites:           () => listProjectSites(),
  listAttendance:             a => listAttendance(a),
  listAllLeaves:              () => listAllLeaves(),
  getDropdowns:               () => getDropdowns(),
  getEmployeeByUsername:      a => getEmployeeByUsername(a.username),

  // admin — employee CRUD
  addEmployee:                a => addEmployee(a),
  updateEmployee:             a => updateEmployee(a),
  deleteEmployee:             a => deleteEmployee(a.username, a.actorId, a.actorUsername),

  // admin — department CRUD
  addDepartment:              a => addDepartment(a),
  updateDepartment:           a => updateDepartment(a),
  deleteDepartment:           a => deleteDepartment(a.id, a.actorId, a.actorUsername),

  // admin — site CRUD
  addProjectSite:             a => addProjectSite(a),
  updateProjectSite:          a => updateProjectSite(a),
  deleteProjectSite:          a => deleteProjectSite(a.id, a.actorId, a.actorUsername),

  // admin — system
  getRecentLogs:              a => getRecentLogs(a && a.limit),
  getSettings:                () => getSettings(),
  updateSetting:              a => updateSetting(a.key, a.value, a.actorId, a.actorUsername),

  // payroll (admin: write rates + run payroll on anyone; manager: payroll for own dept only)
  listHourlyRates:            () => listHourlyRates(),
  updateHourlyRate:           a => updateHourlyRate(a),
  bulkImportRates:            a => bulkImportRates(a),
  getPayrollEmployees:        a => getPayrollEmployees(a),
  getPayroll:                 a => getPayroll(a),

  // branding + self-service profile
  uploadLogo:                 a => uploadLogo(a),
  updateMyProfile:            a => updateMyProfile(a)
};

// ───────────────────────── setup / seed ─────────────────────────
function setup() {
  const ss = getOrCreateSS_();
  try { ss.setSpreadsheetTimeZone(TZ); } catch (_) {}
  Object.keys(SH).forEach(k => ensureSheet_(ss, SH[k], COLS[k]));
  seedSettings_();
  ensurePhotosFolder_();

  // seed default users / depts / sites only if empty
  if (rows_(SH.depts).length === 0)  seedDepartments_();
  if (rows_(SH.users).length === 0)  seedUsers_();
  if (rows_(SH.sites).length === 0)  seedSites_();

  return { ok: true, ssId: ss.getId(), ssUrl: ss.getUrl() };
}

function getOrCreateSS_() {
  const bound = SpreadsheetApp.getActiveSpreadsheet();
  if (bound) return bound;
  const id = PropertiesService.getScriptProperties().getProperty('SS_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (_) {} }
  const ss = SpreadsheetApp.create(SS_NAME);
  PropertiesService.getScriptProperties().setProperty('SS_ID', ss.getId());
  return ss;
}

function ensureSheet_(ss, name, cols) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#001f3f').setFontColor('#fff');
    sh.setFrozenRows(1);
  } else {
    // migrate: append any cols missing from the existing header (lets us add fields without wiping data)
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const missing = cols.filter(c => headers.indexOf(c) === -1);
    if (missing.length) {
      sh.getRange(1, sh.getLastColumn() + 1, 1, missing.length)
        .setValues([missing]).setFontWeight('bold').setBackground('#001f3f').setFontColor('#fff');
    }
  }
  // pin date-shaped columns to text — stops Sheets from auto-coercing YYYY-MM-DD strings to Date objects
  ['date', 'fromDate', 'toDate'].forEach(col => {
    const i = cols.indexOf(col);
    if (i > -1) sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat('@');
  });
  return sh;
}

function seedSettings_() {
  const sh = sheet_(SH.settings);
  const existing = rows_(SH.settings).reduce((m, r) => (m[r[0]] = true, m), {});
  const now = isoNow_();
  const adds = Object.keys(DEFAULTS).filter(k => !existing[k]).map(k => [k, DEFAULTS[k], now]);
  if (adds.length) sh.getRange(sh.getLastRow() + 1, 1, adds.length, 3).setValues(adds);
}

function seedDepartments_() {
  const sh = sheet_(SH.depts);
  const now = isoNow_();
  const data = [
    ['DEPT-001','Engineering','Engineering and technical projects','',now,now],
    ['DEPT-002','Construction','Construction and field operations','',now,now],
    ['DEPT-003','Administration','Office administration and HR','',now,now],
    ['DEPT-004','Finance','Accounts and finance','',now,now]
  ];
  sh.getRange(2, 1, data.length, data[0].length).setValues(data);
}

function seedUsers_() {
  // minimal first-run seed — generic names per docs/demo-data.md.
  // for a populated demo dataset use setupDemoData() instead.
  const sh = sheet_(SH.users);
  const now = isoNow_();
  const data = [
    ['USR-001','admin',    'admin123',   'Admin User', 'admin',    '',         'Administrator',     'active', now, now],
    ['USR-002','manager1', 'manager123', 'Manager 1',  'manager',  'DEPT-001', 'Engineering Manager','active', now, now],
    ['USR-003','employee1','emp123',     'Employee 1', 'employee', 'DEPT-001', 'Site Engineer',     'active', now, now]
  ];
  sh.getRange(2, 1, data.length, data[0].length).setValues(data);

  // wire DEPT-001 manager
  const dSh = sheet_(SH.depts);
  const dRows = rows_(SH.depts);
  const idx = dRows.findIndex(r => r[0] === 'DEPT-001');
  if (idx > -1) dSh.getRange(idx + 2, colIdx_(COLS.depts, 'managerId') + 1).setValue('USR-002');
}

function seedSites_() {
  const sh = sheet_(SH.sites);
  const now = isoNow_();
  const data = DEFAULT_ZONES.map((z, i) => [
    'SITE-' + pad_(i + 1, 3),
    z.name,
    'Moro to Ranipur Construction Route',
    z.lat, z.lng, z.radius,
    'Default attendance zone along Moro-Ranipur route',
    now, now
  ]);
  sh.getRange(2, 1, data.length, data[0].length).setValues(data);
}

function ensurePhotosFolder_() {
  let id = settingGet_('photosFolderId');
  if (id) { try { DriveApp.getFolderById(id); return id; } catch (_) {} }
  const folders = DriveApp.getFoldersByName(PHOTOS_FOLDER);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(PHOTOS_FOLDER);
  id = folder.getId();
  settingSet_('photosFolderId', id);
  return id;
}

// ───────────────────────── demo data (YouTube-policy friendly) ─────────────────────────
/**
 * setupDemoData — DESTRUCTIVELY replaces all data with demo records.
 * Run from the script editor when you want a populated dashboard for tutorials
 * or screen recordings. Names follow docs/demo-data.md — generic numbered
 * placeholders only, never real PII.
 *
 * Seeds:
 *   • 4 departments  (Engineering / Construction / Administration / Finance)
 *   • 11 users       (2 admin · 3 manager · 6 employee)
 *   • 7 project sites (Moro→Ranipur zones)
 *   • ~14 days of past attendance per employee — mix of present / late / absent
 *   • 8 leave requests across all states (pending / approved / rejected)
 *
 * Login accounts (all demo passwords):
 *   admin / admin123          admin2 / admin123
 *   manager1..3 / manager123  employee1..6 / emp123
 */
function setupDemoData() {
  const ss = getOrCreateSS_();

  // 1) create a temp sheet first — Sheets refuses to delete the last remaining tab,
  //    so we need a placeholder to live through the wipe step.
  const tempName = '__temp_rebuild__';
  let temp = ss.getSheetByName(tempName);
  if (!temp) temp = ss.insertSheet(tempName);

  // 2) drop every other sheet (full reset — schema, headers, and data all gone)
  ss.getSheets().forEach(s => {
    if (s.getSheetId() !== temp.getSheetId()) {
      try { ss.deleteSheet(s); } catch (_) {}
    }
  });

  // 3) recreate every schema sheet from COLS, fresh
  Object.keys(SH).forEach(k => ensureSheet_(ss, SH[k], COLS[k]));

  // 4) seed
  seedSettings_();
  ensurePhotosFolder_();
  seedDemoDepartments_();
  seedDemoUsers_();
  seedSites_();
  const attCount   = seedDemoAttendance_();
  const leaveCount = seedDemoLeaves_();

  // 5) drop the placeholder — clean spreadsheet, all real sheets in place
  try { ss.deleteSheet(temp); } catch (_) {}

  return {
    ok: true,
    message: 'Demo data seeded (clean rebuild via temp sheet)',
    summary: { departments: 4, users: 11, sites: DEFAULT_ZONES.length, attendance: attCount, leaves: leaveCount }
  };
}

function wipeData_(name) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, sh.getLastColumn()).clearContent();
}

function seedDemoDepartments_() {
  const sh = sheet_(SH.depts);
  const now = isoNow_();
  // managerId points at users seeded by seedDemoUsers_ — order doesn't matter, sheets don't enforce FKs
  const data = [
    ['DEPT-001','Engineering',    'Engineering and technical projects',  'USR-003', now, now],
    ['DEPT-002','Construction',   'Construction and field operations',   'USR-004', now, now],
    ['DEPT-003','Administration', 'Office administration and HR',        'USR-005', now, now],
    ['DEPT-004','Finance',        'Accounts and finance',                '',        now, now]
  ];
  sh.getRange(2, 1, data.length, data[0].length).setValues(data);
}

function seedDemoUsers_() {
  const sh = sheet_(SH.users);
  const now = isoNow_();
  const data = [
    // admins
    ['USR-001','admin',     'admin123',   'Admin User', 'admin',    '',         'Administrator',         'active', now, now],
    ['USR-002','admin2',    'admin123',   'Admin 2',    'admin',    '',         'Administrator',         'active', now, now],
    // managers
    ['USR-003','manager1',  'manager123', 'Manager 1',  'manager',  'DEPT-001', 'Engineering Manager',   'active', now, now],
    ['USR-004','manager2',  'manager123', 'Manager 2',  'manager',  'DEPT-002', 'Construction Manager',  'active', now, now],
    ['USR-005','manager3',  'manager123', 'Manager 3',  'manager',  'DEPT-003', 'Administration Manager','active', now, now],
    // employees
    ['USR-006','employee1', 'emp123',     'Employee 1', 'employee', 'DEPT-001', 'Site Engineer',         'active', now, now],
    ['USR-007','employee2', 'emp123',     'Employee 2', 'employee', 'DEPT-001', 'Junior Engineer',       'active', now, now],
    ['USR-008','employee3', 'emp123',     'Employee 3', 'employee', 'DEPT-002', 'Foreman',               'active', now, now],
    ['USR-009','employee4', 'emp123',     'Employee 4', 'employee', 'DEPT-002', 'Site Worker',           'active', now, now],
    ['USR-010','employee5', 'emp123',     'Employee 5', 'employee', 'DEPT-003', 'Office Assistant',      'active', now, now],
    ['USR-011','employee6', 'emp123',     'Employee 6', 'employee', 'DEPT-004', 'Accountant',            'active', now, now]
  ];
  sh.getRange(2, 1, data.length, data[0].length).setValues(data);
}

function seedDemoAttendance_() {
  const sh = sheet_(SH.att);
  const employees = [
    { id: 'USR-006', un: 'employee1' },
    { id: 'USR-007', un: 'employee2' },
    { id: 'USR-008', un: 'employee3' },
    { id: 'USR-009', un: 'employee4' },
    { id: 'USR-010', un: 'employee5' },
    { id: 'USR-011', un: 'employee6' }
  ];
  const sites = listProjectSites();
  const rows = [];
  let id = 1;

  // last 14 days, skip Sundays
  for (let dayOffset = 14; dayOffset >= 1; dayOffset--) {
    const date = new Date(); date.setDate(date.getDate() - dayOffset);
    if (date.getDay() === 0) continue;
    const dateStr = Utilities.formatDate(date, TZ, 'yyyy-MM-dd');

    employees.forEach((emp, i) => {
      // 10% absent
      if (Math.random() < 0.1) return;

      const site = sites[i % sites.length];
      const isLate = Math.random() < 0.2;

      // check-in: late→9:16-9:45, on-time→8:30-9:14
      const checkIn = new Date(date);
      if (isLate) checkIn.setHours(9, 16 + Math.floor(Math.random() * 30), 0, 0);
      else {
        const offMin = 30 + Math.floor(Math.random() * 45);
        checkIn.setHours(8 + Math.floor(offMin / 60), offMin % 60, 0, 0);
      }

      // check-out: 80% chance, between 17:00-18:30
      let checkOut = '', totalHours = 0;
      if (Math.random() < 0.8) {
        const offMin = Math.floor(Math.random() * 90);
        checkOut = new Date(date);
        checkOut.setHours(17 + Math.floor(offMin / 60), offMin % 60, 0, 0);
        totalHours = Math.round(((checkOut - checkIn) / 3600000) * 100) / 100;
      }

      // small geo jitter around site center
      const lat = site.latitude  + (Math.random() - 0.5) * 0.001;
      const lng = site.longitude + (Math.random() - 0.5) * 0.001;
      const dist = Math.floor(Math.random() * 80) + 10;

      rows.push([
        'ATT-' + pad_(id++, 4),
        emp.id, emp.un, dateStr,
        checkIn.toISOString(),
        checkOut ? checkOut.toISOString() : '',
        lat, lng, 30, '', site.id, dist,
        checkOut ? lat : '', checkOut ? lng : '', checkOut ? 30 : '', '', checkOut ? site.id : '', checkOut ? dist : '',
        totalHours, isLate ? 'late' : 'present', ''
      ]);
    });
  }

  if (rows.length) sh.getRange(2, 1, rows.length, COLS.att.length).setValues(rows);
  return rows.length;
}

function seedDemoLeaves_() {
  const sh = sheet_(SH.leaves);
  const today = new Date();
  const fmt = d => Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
  const off = (n) => { const x = new Date(today); x.setDate(x.getDate() + n); return x; };
  const now = isoNow_();

  const data = [
    // pending — show up in manager queues
    ['LV-001','USR-006','employee1','DEPT-001','sick',    fmt(off(3)),  fmt(off(4)),  2, 'Fever and rest',     'pending',  '',        '',  '',                    now],
    ['LV-002','USR-008','employee3','DEPT-002','casual',  fmt(off(7)),  fmt(off(7)),  1, 'Personal work',      'pending',  '',        '',  '',                    now],
    ['LV-003','USR-010','employee5','DEPT-003','annual',  fmt(off(10)), fmt(off(14)), 5, 'Family vacation',    'pending',  '',        '',  '',                    now],

    // approved historical
    ['LV-004','USR-007','employee2','DEPT-001','sick',    fmt(off(-5)), fmt(off(-4)), 2, 'Flu',                'approved', 'USR-003', now, 'Approved',            now],
    ['LV-005','USR-009','employee4','DEPT-002','annual',  fmt(off(-12)),fmt(off(-9)), 4, 'Family event',       'approved', 'USR-004', now, 'OK',                  now],

    // rejected
    ['LV-006','USR-011','employee6','DEPT-004','casual',  fmt(off(-3)), fmt(off(-3)), 1, 'Short notice',       'rejected', 'USR-001', now, 'Insufficient notice', now],

    // approved overlapping today — drives "On Leave Today" stat
    ['LV-007','USR-006','employee1','DEPT-001','medical', fmt(off(-1)), fmt(off(1)),  3, 'Medical procedure',  'approved', 'USR-003', now, '',                    now],
    ['LV-008','USR-008','employee3','DEPT-002','casual',  fmt(off(0)),  fmt(off(0)),  1, 'Personal',           'approved', 'USR-004', now, '',                    now]
  ];
  sh.getRange(2, 1, data.length, data[0].length).setValues(data);
  return data.length;
}

// ───────────────────────── sheet helpers ─────────────────────────
function sheet_(name) { return getOrCreateSS_().getSheetByName(name); }

function rows_(name) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
}

function colIdx_(cols, name) { return cols.indexOf(name); }

function rowToObj_(cols, row) {
  const o = {};
  cols.forEach((c, i) => o[c] = row[i]);
  return o;
}

function findRow_(name, predicate) {
  const data = rows_(name);
  for (let i = 0; i < data.length; i++) if (predicate(data[i])) return { rowIdx: i + 2, row: data[i] };
  return null;
}

function nextId_(prefix, sheetName) {
  const data = rows_(sheetName);
  let max = 0;
  data.forEach(r => {
    const m = String(r[0]).match(/-(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return prefix + '-' + pad_(max + 1, 3);
}

function pad_(n, w) { return String(n).padStart(w, '0'); }
function isoNow_() { return new Date().toISOString(); }
function todayStr_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function timeStr_(d) { return Utilities.formatDate(d, TZ, 'HH:mm:ss'); }

// normalize sheet date cells to YYYY-MM-DD — Sheets auto-converts date strings
// to Date objects on write, so r[col] may be a Date or a string. always compare
// via this helper to avoid silent equality failures.
function dateOnly_(v) {
  if (!v) return '';
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v).slice(0, 10);
}

function settingGet_(k) {
  const r = findRow_(SH.settings, x => x[0] === k);
  return r ? r.row[1] : '';
}

function settingSet_(k, v) {
  const sh = sheet_(SH.settings);
  const r = findRow_(SH.settings, x => x[0] === k);
  if (r) sh.getRange(r.rowIdx, 2, 1, 2).setValues([[v, isoNow_()]]);
  else   sh.appendRow([k, v, isoNow_()]);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ───────────────────────── auth ─────────────────────────
function login(username, password) {
  if (!username || !password) return { success: false, message: 'Missing credentials' };
  const r = findRow_(SH.users, u => String(u[1]).toLowerCase() === String(username).toLowerCase());
  if (!r) return { success: false, message: 'Invalid username or password' };
  const u = rowToObj_(COLS.users, r.row);
  if (u.status !== 'active')   return { success: false, message: 'Account is inactive' };
  if (String(u.password) !== String(password)) return { success: false, message: 'Invalid username or password' };

  log_(u.id, u.username, 'login', 'user', u.id, 'login ok');

  return {
    success: true,
    userId: u.id,
    username: u.username,
    fullName: u.fullName,
    role: u.role,
    departmentId: u.departmentId,
    position: u.position,
    colorScheme: u.colorScheme || 'navy',
    layoutMode: u.layoutMode || 'sidebar',
    profileImage: u.profileImage || '',
    companyLogoUrl: settingGet_('companyLogoUrl') || '',
    companyName:    settingGet_('companyName')    || 'Rameez Scripts'
  };
}

function updateUserPref_(username, colName, value) {
  return withLock_(() => {
    if (!username || !value) return { success: false, message: 'Missing fields' };
    const r = findRow_(SH.users, x => String(x[1]).toLowerCase() === String(username).toLowerCase());
    if (!r) return { success: false, message: 'User not found' };

    // ensure col exists even if user hasn't re-run setup() yet
    const sh = sheet_(SH.users);
    let colIdx = COLS.users.indexOf(colName) + 1;
    if (sh.getLastColumn() < colIdx) {
      sh.getRange(1, colIdx).setValue(colName).setFontWeight('bold').setBackground('#001f3f').setFontColor('#fff');
    }

    sh.getRange(r.rowIdx, colIdx).setValue(value);
    log_(r.row[0], username, 'update', colName, r.row[0], value);
    return { success: true };
  });
}

function updateColorScheme(username, scheme) { return updateUserPref_(username, 'colorScheme', scheme); }
function updateLayoutMode(username, mode)   { return updateUserPref_(username, 'layoutMode', mode); }

function logout(userId, username) {
  log_(userId || '', username || '', 'logout', 'user', userId || '', '');
  return { success: true };
}

// ───────────────────────── users CRUD ─────────────────────────
function listEmployees() {
  const today = todayStr_();
  const att = rows_(SH.att).filter(r => dateOnly_(r[3]) === today);
  const attMap = att.reduce((m, r) => (m[r[2]] = r, m), {}); // username → row
  const depts  = rows_(SH.depts).reduce((m, r) => (m[r[0]] = r[1], m), {});

  return rows_(SH.users).map((r, i) => {
    const u = rowToObj_(COLS.users, r);
    const att = attMap[u.username];
    let todayStatus = 'notchecked';
    if (att) {
      if (att[5]) todayStatus = 'checkedout';
      else if (att[4]) todayStatus = 'checkedin';
    }
    return {
      idx: i + 1,
      id: u.id,
      username: u.username,
      fullName: u.fullName,
      department: depts[u.departmentId] || '',
      departmentId: u.departmentId,
      position: u.position,
      role: u.role,
      status: u.status === 'active' ? 'Active' : 'Inactive',
      todayStatus
    };
  });
}

function addEmployee(payload) {
  return withLock_(() => {
    const { username, password, fullName, department, position, role } = payload || {};
    if (!username || !password || !fullName || !department || !position || !role) return { success: false, message: 'Missing fields' };
    if (password.length < 6) return { success: false, message: 'Password must be at least 6 characters' };

    if (findRow_(SH.users, u => String(u[1]).toLowerCase() === String(username).toLowerCase())) {
      return { success: false, message: 'Username already exists' };
    }

    const id = nextId_('USR', SH.users);
    const now = isoNow_();
    sheet_(SH.users).appendRow([id, username, password, fullName, role, department, position, 'active', now, now]);
    log_(payload.actorId || '', payload.actorUsername || '', 'create', 'user', id, fullName);
    return { success: true, id };
  });
}

function updateEmployee(payload) {
  return withLock_(() => {
    const { username, fullName, department, position, role, status, password, actorId, actorUsername } = payload || {};
    const r = findRow_(SH.users, u => String(u[1]).toLowerCase() === String(username).toLowerCase());
    if (!r) return { success: false, message: 'Employee not found' };

    const sh = sheet_(SH.users);
    const idx = r.rowIdx;
    const set = (col, val) => sh.getRange(idx, colIdx_(COLS.users, col) + 1).setValue(val);

    if (fullName)   set('fullName', fullName);
    if (department) set('departmentId', department);
    if (position)   set('position', position);
    if (role)       set('role', role);
    if (status)     set('status', status);
    if (password && String(password).length >= 6) set('password', password);
    set('updatedAt', isoNow_());

    log_(actorId || '', actorUsername || '', 'update', 'user', r.row[0], fullName || username);
    return { success: true };
  });
}

function deleteEmployee(username, actorId, actorUsername) {
  return withLock_(() => {
    const r = findRow_(SH.users, u => String(u[1]).toLowerCase() === String(username).toLowerCase());
    if (!r) return { success: false, message: 'Employee not found' };
    if (r.row[4] === 'admin' && countAdmins_() <= 1) return { success: false, message: 'Cannot delete last admin' };

    sheet_(SH.users).deleteRow(r.rowIdx);
    log_(actorId || '', actorUsername || '', 'delete', 'user', r.row[0], username);
    return { success: true };
  });
}

function countAdmins_() {
  return rows_(SH.users).filter(r => r[4] === 'admin' && r[7] === 'active').length;
}

function getEmployeeByUsername(username) {
  const r = findRow_(SH.users, u => String(u[1]).toLowerCase() === String(username).toLowerCase());
  if (!r) return null;
  const u = rowToObj_(COLS.users, r.row);
  delete u.password;
  return u;
}

// ───────────────────────── departments CRUD ─────────────────────────
function listDepartments() {
  const usersByDept = rows_(SH.users).reduce((m, r) => (m[r[5]] = (m[r[5]] || 0) + 1, m), {});
  const userMap = rows_(SH.users).reduce((m, r) => (m[r[0]] = r[3], m), {}); // id → fullName

  return rows_(SH.depts).map(r => {
    const d = rowToObj_(COLS.depts, r);
    return {
      id: d.id,
      name: d.name,
      description: d.description,
      managerId: d.managerId,
      manager: userMap[d.managerId] || '—',
      employeeCount: usersByDept[d.id] || 0
    };
  });
}

function addDepartment(payload) {
  return withLock_(() => {
    const { name, description, manager, actorId, actorUsername } = payload || {};
    if (!name || !manager) return { success: false, message: 'Missing fields' };
    if (findRow_(SH.depts, r => String(r[1]).toLowerCase() === String(name).toLowerCase())) return { success: false, message: 'Department already exists' };

    const id = nextId_('DEPT', SH.depts);
    const now = isoNow_();
    sheet_(SH.depts).appendRow([id, name, description || '', manager, now, now]);
    log_(actorId || '', actorUsername || '', 'create', 'department', id, name);
    return { success: true, id };
  });
}

function updateDepartment(payload) {
  return withLock_(() => {
    const { id, name, description, manager, actorId, actorUsername } = payload || {};
    const r = findRow_(SH.depts, x => x[0] === id);
    if (!r) return { success: false, message: 'Department not found' };

    const sh = sheet_(SH.depts);
    const set = (c, v) => sh.getRange(r.rowIdx, colIdx_(COLS.depts, c) + 1).setValue(v);
    if (name) set('name', name);
    if (description !== undefined) set('description', description);
    if (manager) set('managerId', manager);
    set('updatedAt', isoNow_());

    log_(actorId || '', actorUsername || '', 'update', 'department', id, name || id);
    return { success: true };
  });
}

function deleteDepartment(id, actorId, actorUsername) {
  return withLock_(() => {
    const inUse = rows_(SH.users).some(r => r[5] === id);
    if (inUse) return { success: false, message: 'Department has employees — reassign first' };
    const r = findRow_(SH.depts, x => x[0] === id);
    if (!r) return { success: false, message: 'Department not found' };
    sheet_(SH.depts).deleteRow(r.rowIdx);
    log_(actorId || '', actorUsername || '', 'delete', 'department', id, r.row[1]);
    return { success: true };
  });
}

function listManagers() {
  return rows_(SH.users)
    .filter(r => (r[4] === 'manager' || r[4] === 'admin') && r[7] === 'active')
    .map(r => ({ id: r[0], name: r[3] }));
}

function getDropdowns() {
  return {
    departments: listDepartments().map(d => ({ id: d.id, name: d.name })),
    managers: listManagers()
  };
}

// ───────────────────────── project sites CRUD ─────────────────────────
function listProjectSites() {
  return rows_(SH.sites).map(r => {
    const s = rowToObj_(COLS.sites, r);
    return {
      id: s.id,
      name: s.name,
      address: s.address,
      latitude: Number(s.latitude),
      longitude: Number(s.longitude),
      radius: Number(s.radius),
      description: s.description
    };
  });
}

function addProjectSite(payload) {
  return withLock_(() => {
    const { name, address, latitude, longitude, radius, description, actorId, actorUsername } = payload || {};
    if (!name || !address || isNaN(latitude) || isNaN(longitude) || isNaN(radius)) return { success: false, message: 'Missing or invalid fields' };
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return { success: false, message: 'Invalid coordinates' };

    const id = nextId_('SITE', SH.sites);
    const now = isoNow_();
    sheet_(SH.sites).appendRow([id, name, address, Number(latitude), Number(longitude), Number(radius), description || '', now, now]);
    log_(actorId || '', actorUsername || '', 'create', 'site', id, name);
    return { success: true, id };
  });
}

function updateProjectSite(payload) {
  return withLock_(() => {
    const { id, name, address, latitude, longitude, radius, description, actorId, actorUsername } = payload || {};
    const r = findRow_(SH.sites, x => x[0] === id);
    if (!r) return { success: false, message: 'Site not found' };

    const sh = sheet_(SH.sites);
    const set = (c, v) => sh.getRange(r.rowIdx, colIdx_(COLS.sites, c) + 1).setValue(v);
    if (name) set('name', name);
    if (address) set('address', address);
    if (!isNaN(latitude))  set('latitude', Number(latitude));
    if (!isNaN(longitude)) set('longitude', Number(longitude));
    if (!isNaN(radius))    set('radius', Number(radius));
    if (description !== undefined) set('description', description);
    set('updatedAt', isoNow_());

    log_(actorId || '', actorUsername || '', 'update', 'site', id, name || id);
    return { success: true };
  });
}

function deleteProjectSite(id, actorId, actorUsername) {
  return withLock_(() => {
    const r = findRow_(SH.sites, x => x[0] === id);
    if (!r) return { success: false, message: 'Site not found' };
    sheet_(SH.sites).deleteRow(r.rowIdx);
    log_(actorId || '', actorUsername || '', 'delete', 'site', id, r.row[1]);
    return { success: true };
  });
}

// ───────────────────────── geo helpers ─────────────────────────
function haversine_(lat1, lng1, lat2, lng2) {
  const R = 6371000; // meters
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function nearestSite_(lat, lng) {
  let best = null;
  listProjectSites().forEach(s => {
    const d = haversine_(lat, lng, s.latitude, s.longitude);
    if (!best || d < best.distance) best = { site: s, distance: d };
  });
  return best;
}

// ───────────────────────── attendance ─────────────────────────
function getMyStatus(username) {
  const today = todayStr_();
  const r = findRow_(SH.att, x => x[2] === username && dateOnly_(x[3]) === today);
  if (!r) return { hasCheckedIn: false, hasCheckedOut: false, checkInTime: null, checkOutTime: null, location: '' };
  const a = rowToObj_(COLS.att, r.row);
  return {
    hasCheckedIn: !!a.checkInTime,
    hasCheckedOut: !!a.checkOutTime,
    checkInTime:  a.checkInTime  ? timeStr_(new Date(a.checkInTime))  : null,
    checkOutTime: a.checkOutTime ? timeStr_(new Date(a.checkOutTime)) : null,
    location: siteName_(a.checkInSiteId) || ''
  };
}

function siteName_(id) {
  if (!id) return '';
  const r = findRow_(SH.sites, x => x[0] === id);
  return r ? r.row[1] : '';
}

function markAttendance(payload) {
  return withLock_(() => {
    const { username, action, photoBase64, location } = payload || {};
    if (!username || !action) return { success: false, message: 'Missing data' };
    if (!['CheckIn','CheckOut','Project'].includes(action)) return { success: false, message: 'Invalid action' };

    const u = findRow_(SH.users, x => String(x[1]).toLowerCase() === String(username).toLowerCase());
    if (!u) return { success: false, message: 'User not found' };
    if (u.row[7] !== 'active') return { success: false, message: 'Account inactive' };

    const userId = u.row[0];
    const today = todayStr_();
    const now = new Date();
    const lat = location && !isNaN(location.latitude)  ? Number(location.latitude)  : null;
    const lng = location && !isNaN(location.longitude) ? Number(location.longitude) : null;
    const acc = location && !isNaN(location.accuracy)  ? Number(location.accuracy)  : null;
    const near = (lat != null && lng != null) ? nearestSite_(lat, lng) : null;
    const photoUrl = photoBase64 ? savePhoto_(photoBase64, username, action, today) : '';

    const sh = sheet_(SH.att);
    let r = findRow_(SH.att, x => x[2] === username && dateOnly_(x[3]) === today);

    if (action === 'CheckIn' || action === 'Project') {
      if (r && r.row[4]) return { success: false, message: 'Already checked in today' };
      if (!r) {
        const id = nextId_('ATT', SH.att);
        const status = isLate_(now) ? 'late' : 'present';
        sh.appendRow([
          id, userId, username, today,
          now.toISOString(), '',
          lat, lng, acc, photoUrl, near ? near.site.id : '', near ? near.distance : '',
          '','','','', '', '',
          0, status, ''
        ]);
        log_(userId, username, 'checkin', 'attendance', id, near ? near.site.name : '');
      } else {
        const idx = r.rowIdx;
        const status = isLate_(now) ? 'late' : 'present';
        sh.getRange(idx, colIdx_(COLS.att, 'checkInTime') + 1).setValue(now.toISOString());
        sh.getRange(idx, colIdx_(COLS.att, 'checkInLat') + 1, 1, 6).setValues([[lat, lng, acc, photoUrl, near ? near.site.id : '', near ? near.distance : '']]);
        sh.getRange(idx, colIdx_(COLS.att, 'status') + 1).setValue(status);
        log_(userId, username, 'checkin', 'attendance', r.row[0], near ? near.site.name : '');
      }
      return { success: true, time: timeStr_(now), action, message: 'Checked in', site: near ? near.site.name : '' };
    }

    // CheckOut
    if (!r || !r.row[4]) return { success: false, message: 'Check in first' };
    if (r.row[5])         return { success: false, message: 'Already checked out today' };

    const idx = r.rowIdx;
    const checkInTime = new Date(r.row[4]);
    const totalHours = Math.round(((now - checkInTime) / 3600000) * 100) / 100;

    sh.getRange(idx, colIdx_(COLS.att, 'checkOutTime') + 1).setValue(now.toISOString());
    sh.getRange(idx, colIdx_(COLS.att, 'checkOutLat') + 1, 1, 6).setValues([[lat, lng, acc, photoUrl, near ? near.site.id : '', near ? near.distance : '']]);
    sh.getRange(idx, colIdx_(COLS.att, 'totalHours') + 1).setValue(totalHours);
    log_(userId, username, 'checkout', 'attendance', r.row[0], `${totalHours}h`);

    return { success: true, time: timeStr_(now), action, totalHours, message: 'Checked out' };
  });
}

function isLate_(d) {
  const [h, m] = String(settingGet_('lateThresholdHHMM') || '09:15').split(':').map(Number);
  const t = Utilities.formatDate(d, TZ, 'HH:mm').split(':').map(Number);
  return t[0] > h || (t[0] === h && t[1] > m);
}

// uploads selfie to Drive and returns lh3 URL (per CLAUDE.md rule 12).
// returns '' on failure — attendance isn't blocked, but failure is logged to ActivityLogs.
function savePhoto_(b64, username, action, dateStr) {
  if (!b64) return '';
  try {
    const folder = DriveApp.getFolderById(ensurePhotosFolder_());

    // parse data URL: "data:image/jpeg;base64,XXX" → grab MIME + raw bytes; fallback to raw base64
    let mime = 'image/jpeg', ext = 'jpg', data = String(b64);
    const m = data.match(/^data:(image\/[a-z]+);base64,(.+)$/i);
    if (m) { mime = m[1]; ext = mime.split('/')[1].replace('jpeg', 'jpg'); data = m[2]; }
    else if (data.indexOf('base64,') > -1) { data = data.split('base64,')[1]; }

    const fileName = `${username}_${action}_${dateStr}_${Date.now()}.${ext}`;
    const blob = Utilities.newBlob(Utilities.base64Decode(data), mime, fileName);
    const file = folder.createFile(blob);
    file.setDescription(`${action} selfie · ${username} · ${dateStr}`);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return 'https://lh3.google.com/u/0/d/' + file.getId();
  } catch (e) {
    console.error('savePhoto_ fail', e);
    log_('', username, 'photo_save_fail', 'attendance', '', String((e && e.message) || e));
    return '';
  }
}

// generic image upload — base64 → Drive folder (creates if missing) → lh3 URL
function saveImageToFolder_(b64, baseName, folderName) {
  if (!b64) return '';
  try {
    const folders = DriveApp.getFoldersByName(folderName);
    const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);

    let mime = 'image/jpeg', ext = 'jpg', data = String(b64);
    const m = data.match(/^data:(image\/[a-z]+);base64,(.+)$/i);
    if (m) { mime = m[1]; ext = mime.split('/')[1].replace('jpeg', 'jpg'); data = m[2]; }
    else if (data.indexOf('base64,') > -1) { data = data.split('base64,')[1]; }

    const fileName = (baseName || 'image') + '_' + Date.now() + '.' + ext;
    const blob = Utilities.newBlob(Utilities.base64Decode(data), mime, fileName);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return 'https://lh3.google.com/u/0/d/' + file.getId();
  } catch (e) {
    console.error('saveImageToFolder_ fail', e);
    return '';
  }
}

// admin-only: upload + replace company logo
function uploadLogo(payload) {
  const { base64, actorId, actorUsername } = payload || {};
  if (!base64) return { success: false, message: 'No image data' };
  const actor = findRow_(SH.users, x => String(x[1]).toLowerCase() === String(actorUsername || '').toLowerCase());
  if (!actor || actor.row[4] !== 'admin') return { success: false, message: 'Admins only' };

  const url = saveImageToFolder_(base64, 'company_logo', 'ZKB Company Branding');
  if (!url) return { success: false, message: 'Could not save logo to Drive' };
  settingSet_('companyLogoUrl', url);
  log_(actorId || '', actorUsername || '', 'update', 'companyLogoUrl', '', url);
  return { success: true, url };
}

// self-update: full name, profile image, password (with current-password check)
function updateMyProfile(payload) {
  const { username, fullName, profileImageBase64, oldPassword, newPassword } = payload || {};
  if (!username) return { success: false, message: 'Missing username' };

  return withLock_(() => {
    const r = findRow_(SH.users, x => String(x[1]).toLowerCase() === String(username).toLowerCase());
    if (!r) return { success: false, message: 'User not found' };

    // password change requires current password
    if (newPassword) {
      if (!oldPassword) return { success: false, message: 'Current password is required' };
      if (String(r.row[2]) !== String(oldPassword)) return { success: false, message: 'Current password is incorrect' };
      if (String(newPassword).length < 6) return { success: false, message: 'New password must be at least 6 characters' };
    }

    const sh = sheet_(SH.users);
    const idx = r.rowIdx;
    const set = (col, val) => sh.getRange(idx, colIdx_(COLS.users, col) + 1).setValue(val);

    if (fullName)    set('fullName', String(fullName).trim());
    if (newPassword) set('password', String(newPassword));

    let imageUrl = '';
    if (profileImageBase64) {
      // ensure profileImage column header exists for legacy sheets
      const col = COLS.users.indexOf('profileImage') + 1;
      if (sh.getLastColumn() < col) {
        sh.getRange(1, col).setValue('profileImage').setFontWeight('bold').setBackground('#001f3f').setFontColor('#fff');
      }
      imageUrl = saveImageToFolder_(profileImageBase64, 'profile_' + username, 'ZKB Profile Photos');
      if (imageUrl) sh.getRange(idx, col).setValue(imageUrl);
    }

    set('updatedAt', isoNow_());
    log_(r.row[0], username, 'update', 'profile', r.row[0], 'self update');
    return { success: true, profileImage: imageUrl || (r.row[13] || ''), fullName: fullName || r.row[3] };
  });
}

function getMyHistory(username, days) {
  const limit = Math.min(Number(days) || 30, 365);
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - limit);
  const cutStr = Utilities.formatDate(cutoff, TZ, 'yyyy-MM-dd');

  return rows_(SH.att)
    .filter(r => r[2] === username && dateOnly_(r[3]) >= cutStr)
    .sort((a, b) => dateOnly_(b[3]).localeCompare(dateOnly_(a[3])))
    .map(r => {
      const a = rowToObj_(COLS.att, r);
      return {
        date: dateOnly_(a.date),
        checkIn:  a.checkInTime  ? timeStr_(new Date(a.checkInTime))  : '--:--',
        checkOut: a.checkOutTime ? timeStr_(new Date(a.checkOutTime)) : '--:--',
        hours: a.totalHours || 0,
        status: a.status,
        checkInPhotoUrl:  a.checkInPhotoUrl  || '',
        checkOutPhotoUrl: a.checkOutPhotoUrl || ''
      };
    });
}

function getMyChart(username, year, month) {
  const y = Number(year)  || new Date().getFullYear();
  const m = Number(month); // 0-11
  const start = new Date(y, m, 1);
  const end   = new Date(y, m + 1, 0);
  const totalDays = end.getDate();

  const fmt = d => Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
  const startStr = fmt(start), endStr = fmt(end);

  const att = rows_(SH.att).filter(r => r[2] === username && dateOnly_(r[3]) >= startStr && dateOnly_(r[3]) <= endStr);
  const presentSet = new Set(att.filter(r => r[4]).map(r => dateOnly_(r[3])));

  let sundays = 0;
  for (let d = 1; d <= totalDays; d++) if (new Date(y, m, d).getDay() === 0) sundays++;

  // count working days (Mon-Sat) up to today
  const today = new Date();
  let working = 0;
  for (let d = 1; d <= totalDays; d++) {
    const date = new Date(y, m, d);
    if (date > today) break;
    if (date.getDay() !== 0) working++;
  }

  const present = presentSet.size;
  const absent  = Math.max(0, working - present);

  return { present, absent, sundays };
}

function getMyLeaves(username) {
  return rows_(SH.leaves)
    .filter(r => r[2] === username)
    .sort((a, b) => String(b[13]).localeCompare(String(a[13])))
    .map(r => {
      const l = rowToObj_(COLS.leaves, r);
      return { id: l.id, type: l.type, from: l.fromDate, to: l.toDate, days: l.days, reason: l.reason, status: l.status, appliedOn: String(l.appliedAt).slice(0,10) };
    });
}

// ───────────────────────── leaves ─────────────────────────
function submitLeave(payload) {
  return withLock_(() => {
    const { username, type, fromDate, toDate, reason } = payload || {};
    if (!username || !type || !fromDate || !toDate || !reason) return { success: false, message: 'Missing fields' };
    if (new Date(toDate) < new Date(fromDate)) return { success: false, message: 'End date before start date' };

    const u = findRow_(SH.users, x => String(x[1]).toLowerCase() === String(username).toLowerCase());
    if (!u) return { success: false, message: 'User not found' };

    const days = Math.ceil((new Date(toDate) - new Date(fromDate)) / 86400000) + 1;
    const id = nextId_('LV', SH.leaves);
    const now = isoNow_();

    sheet_(SH.leaves).appendRow([id, u.row[0], username, u.row[5], type, fromDate, toDate, days, reason, 'pending', '', '', '', now]);
    log_(u.row[0], username, 'create', 'leave', id, `${type} ${fromDate}→${toDate}`);
    return { success: true, id };
  });
}

function approveLeave(leaveId, reviewerId, reviewerUsername, notes) {
  return withLock_(() => decideLeave_(leaveId, 'approved', reviewerId, reviewerUsername, notes));
}

function rejectLeave(leaveId, reviewerId, reviewerUsername, notes) {
  return withLock_(() => decideLeave_(leaveId, 'rejected', reviewerId, reviewerUsername, notes));
}

function decideLeave_(leaveId, status, reviewerId, reviewerUsername, notes) {
  const r = findRow_(SH.leaves, x => x[0] === leaveId);
  if (!r) return { success: false, message: 'Leave not found' };
  if (r.row[9] !== 'pending') return { success: false, message: 'Already ' + r.row[9] };

  const sh = sheet_(SH.leaves);
  sh.getRange(r.rowIdx, colIdx_(COLS.leaves, 'status') + 1, 1, 4).setValues([[status, reviewerId || '', isoNow_(), notes || '']]);
  log_(reviewerId || '', reviewerUsername || '', status, 'leave', leaveId, r.row[2]);
  return { success: true };
}

// full leave detail for view/print — joins employee + dept + reviewer
function getLeaveById(leaveId, requesterUsername) {
  if (!leaveId) return { success: false, message: 'Missing leave id' };
  const r = findRow_(SH.leaves, x => x[0] === leaveId);
  if (!r) return { success: false, message: 'Leave not found' };
  const l = rowToObj_(COLS.leaves, r.row);

  const req = findRow_(SH.users, x => String(x[1]).toLowerCase() === String(requesterUsername || '').toLowerCase());
  if (!req) return { success: false, message: 'Unauthorized' };
  const reqRole = req.row[4], reqDept = req.row[5], reqId = req.row[0];
  const isOwner = String(l.userId) === String(reqId);
  const isMgr   = reqRole === 'manager' && String(l.departmentId) === String(reqDept);
  const isAdmin = reqRole === 'admin';
  if (!isOwner && !isMgr && !isAdmin) return { success: false, message: 'Not allowed' };

  const emp  = findRow_(SH.users, x => x[0] === l.userId);
  const dept = rows_(SH.depts).find(x => x[0] === l.departmentId);
  const rev  = l.reviewedBy ? findRow_(SH.users, x => x[0] === l.reviewedBy) : null;

  return {
    success: true,
    data: {
      id: l.id,
      employee: {
        username: l.username,
        fullName: emp ? emp.row[3] : l.username,
        position: emp ? (emp.row[6] || '') : '',
        department: dept ? dept[1] : ''
      },
      type: l.type,
      fromDate: l.fromDate,
      toDate: l.toDate,
      days: l.days,
      reason: l.reason,
      status: l.status,
      reviewedBy: rev ? rev.row[3] : '',
      reviewedAt: l.reviewedAt,
      reviewNotes: l.reviewNotes,
      appliedAt: l.appliedAt,
      companyName:    settingGet_('companyName')    || 'Company',
      companyLogoUrl: settingGet_('companyLogoUrl') || ''
    }
  };
}

// edit leave — only if status='pending', and only by owner or admin
function updateLeave(payload) {
  return withLock_(() => {
    const { id, type, fromDate, toDate, reason, actorId, actorUsername } = payload || {};
    if (!id) return { success: false, message: 'Missing leave id' };

    const r = findRow_(SH.leaves, x => x[0] === id);
    if (!r) return { success: false, message: 'Leave not found' };
    const l = rowToObj_(COLS.leaves, r.row);
    if (String(l.status).toLowerCase() !== 'pending') return { success: false, message: 'Only pending leaves can be edited' };

    const actor = findRow_(SH.users, x => String(x[1]).toLowerCase() === String(actorUsername || '').toLowerCase());
    if (!actor) return { success: false, message: 'Unauthorized' };
    const isOwner = String(actor.row[1]).toLowerCase() === String(l.username).toLowerCase();
    const isAdmin = actor.row[4] === 'admin';
    if (!isOwner && !isAdmin) return { success: false, message: 'Only the owner or admin can edit' };

    const sh = sheet_(SH.leaves);
    const set = (col, val) => sh.getRange(r.rowIdx, colIdx_(COLS.leaves, col) + 1).setValue(val);
    if (type)     set('type', type);
    if (fromDate) set('fromDate', fromDate);
    if (toDate)   set('toDate', toDate);
    if (reason)   set('reason', reason);

    if (fromDate && toDate) {
      const days = Math.max(1, Math.round((new Date(toDate) - new Date(fromDate)) / 86400000) + 1);
      set('days', days);
    }
    log_(actorId || '', actorUsername || '', 'update', 'leave', id, '');
    return { success: true };
  });
}

// delete leave — admin always; owner only if status='pending'
function deleteLeave(leaveId, actorId, actorUsername) {
  return withLock_(() => {
    if (!leaveId) return { success: false, message: 'Missing leave id' };
    const r = findRow_(SH.leaves, x => x[0] === leaveId);
    if (!r) return { success: false, message: 'Leave not found' };
    const l = rowToObj_(COLS.leaves, r.row);

    const actor = findRow_(SH.users, x => String(x[1]).toLowerCase() === String(actorUsername || '').toLowerCase());
    if (!actor) return { success: false, message: 'Unauthorized' };
    const isOwner = String(actor.row[1]).toLowerCase() === String(l.username).toLowerCase();
    const isAdmin = actor.row[4] === 'admin';
    if (!isAdmin && !(isOwner && String(l.status).toLowerCase() === 'pending')) {
      return { success: false, message: 'Cannot delete an approved/rejected leave' };
    }

    sheet_(SH.leaves).deleteRow(r.rowIdx);
    log_(actorId || '', actorUsername || '', 'delete', 'leave', leaveId, l.type);
    return { success: true };
  });
}

function listAllLeaves() {
  const userMap = rows_(SH.users).reduce((m, r) => (m[r[0]] = r[3], m), {});
  return rows_(SH.leaves)
    .sort((a, b) => String(b[13]).localeCompare(String(a[13])))
    .map(r => {
      const l = rowToObj_(COLS.leaves, r);
      return {
        id: l.id,
        employee: userMap[l.userId] || l.username,
        type: cap_(l.type) + ' Leave',
        from: l.fromDate, to: l.toDate, days: l.days,
        status: cap_(l.status), reason: l.reason
      };
    });
}

function cap_(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

// ───────────────────────── manager dashboard ─────────────────────────
function getDeptStats(managerUsername) {
  const m = findRow_(SH.users, x => String(x[1]).toLowerCase() === String(managerUsername).toLowerCase());
  if (!m) return { total: 0, present: 0, onLeave: 0, late: 0 };
  const deptId = m.row[5];
  if (!deptId) return { total: 0, present: 0, onLeave: 0, late: 0 };

  const today = todayStr_();
  const empUsers = rows_(SH.users).filter(r => r[5] === deptId && r[7] === 'active' && r[4] !== 'admin');
  const empSet = new Set(empUsers.map(r => r[1]));

  const todayAtt = rows_(SH.att).filter(r => dateOnly_(r[3]) === today && empSet.has(r[2]));
  const present = todayAtt.filter(r => r[4]).length;
  const late = todayAtt.filter(r => r[19] === 'late').length;
  const onLeave = rows_(SH.leaves).filter(r => r[3] === deptId && r[9] === 'approved' && today >= dateOnly_(r[5]) && today <= dateOnly_(r[6])).length;

  return { total: empUsers.length, present, onLeave, late };
}

function getDeptEmployees(managerUsername) {
  const m = findRow_(SH.users, x => String(x[1]).toLowerCase() === String(managerUsername).toLowerCase());
  if (!m) return [];
  const deptId = m.row[5];
  const today = todayStr_();
  const todayAtt = rows_(SH.att).filter(r => dateOnly_(r[3]) === today).reduce((acc, r) => (acc[r[2]] = r, acc), {});
  const sites = rows_(SH.sites).reduce((acc, r) => (acc[r[0]] = r[1], acc), {});

  return rows_(SH.users)
    .filter(r => r[5] === deptId && r[4] !== 'admin')
    .map(r => {
      const u = rowToObj_(COLS.users, r);
      const a = todayAtt[u.username];
      let status = 'notchecked', lastActivity = '—', loc = 'Not available';
      if (a) {
        const ai = rowToObj_(COLS.att, a);
        if (ai.checkOutTime) { status = 'checkedout'; lastActivity = timeStr_(new Date(ai.checkOutTime)); loc = sites[ai.checkOutSiteId] || 'Office'; }
        else if (ai.checkInTime) { status = 'checkedin'; lastActivity = timeStr_(new Date(ai.checkInTime)); loc = sites[ai.checkInSiteId] || 'Office'; }
      }
      return { name: u.fullName, position: u.position, status, lastActivity, location: loc };
    });
}

function getPendingLeavesForManager(managerUsername) {
  const m = findRow_(SH.users, x => String(x[1]).toLowerCase() === String(managerUsername).toLowerCase());
  if (!m) return [];
  const deptId = m.row[5];
  const userMap = rows_(SH.users).reduce((acc, r) => (acc[r[0]] = r[3], acc), {});

  return rows_(SH.leaves)
    .filter(r => r[3] === deptId && r[9] === 'pending')
    .sort((a, b) => String(b[13]).localeCompare(String(a[13])))
    .map(r => {
      const l = rowToObj_(COLS.leaves, r);
      return { id: l.id, employee: userMap[l.userId] || l.username, type: l.type, from: l.fromDate, to: l.toDate, days: l.days, appliedOn: String(l.appliedAt).slice(0,10), reason: l.reason };
    });
}

// ───────────────────────── admin dashboard ─────────────────────────
// today's attendance positions for the live project map.
// scope = 'all' → every active non-admin user; otherwise a departmentId for manager-scoped view.
function getLiveAttendance(scope) {
  const today = todayStr_();
  const userMap = rows_(SH.users).reduce((m, r) => {
    m[r[0]] = { id: r[0], username: r[1], fullName: r[3], role: r[4], deptId: r[5] };
    return m;
  }, {});
  const deptMap = rows_(SH.depts).reduce((m, r) => (m[r[0]] = r[1], m), {});
  const siteMap = rows_(SH.sites).reduce((m, r) => (m[r[0]] = r[1], m), {});

  return rows_(SH.att)
    .filter(r => dateOnly_(r[3]) === today)
    .filter(r => {
      const u = userMap[r[1]];
      if (!u || u.role === 'admin') return false;
      if (!scope || scope === 'all') return true;
      return u.deptId === scope;
    })
    .map(r => {
      const a = rowToObj_(COLS.att, r);
      const u = userMap[a.userId] || {};
      const lastTime = a.checkOutTime || a.checkInTime;
      return {
        userId: a.userId,
        username: a.username,
        fullName: u.fullName || a.username,
        department: deptMap[u.deptId] || '',
        checkInTime:   a.checkInTime  ? timeStr_(new Date(a.checkInTime))  : null,
        checkOutTime:  a.checkOutTime ? timeStr_(new Date(a.checkOutTime)) : null,
        lastSeen:      lastTime ? timeStr_(new Date(lastTime)) : null,
        checkInLat:    a.checkInLat  !== '' ? Number(a.checkInLat)  : null,
        checkInLng:    a.checkInLng  !== '' ? Number(a.checkInLng)  : null,
        checkOutLat:   a.checkOutLat !== '' ? Number(a.checkOutLat) : null,
        checkOutLng:   a.checkOutLng !== '' ? Number(a.checkOutLng) : null,
        checkInPhotoUrl:  a.checkInPhotoUrl  || '',
        checkOutPhotoUrl: a.checkOutPhotoUrl || '',
        status: a.status,
        siteId: a.checkInSiteId,
        siteName: siteMap[a.checkInSiteId] || '',
        distanceM: a.checkInDistanceM !== '' ? Number(a.checkInDistanceM) : null,
        isCheckedOut: !!a.checkOutTime
      };
    });
}

// aggregated chart datasets for the admin dashboard — one round-trip
function getDashboardCharts() {
  const today = todayStr_();
  const todayD = new Date();
  const cutoff = new Date(todayD); cutoff.setDate(todayD.getDate() - 30);
  const cutoffStr = Utilities.formatDate(cutoff, TZ, 'yyyy-MM-dd');

  // ── 1. last 30 days present-count trend ──
  const attRows = rows_(SH.att);
  const attRecent = attRows.filter(r => dateOnly_(r[3]) >= cutoffStr);
  const byDate = {};
  attRecent.forEach(r => {
    const d = dateOnly_(r[3]);
    if (!byDate[d]) byDate[d] = { date: d, present: 0, late: 0 };
    if (r[4]) byDate[d].present++;
    if (r[19] === 'late') byDate[d].late++;
  });
  const dailyTrend = [];
  for (let i = 30; i >= 0; i--) {
    const d = new Date(todayD); d.setDate(todayD.getDate() - i);
    const key = Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
    dailyTrend.push(byDate[key] || { date: key, present: 0, late: 0 });
  }

  // ── 2. department distribution ──
  const activeUsers = rows_(SH.users).filter(r => r[7] === 'active' && r[4] !== 'admin');
  const usersByDept = activeUsers.reduce((m, r) => (m[r[5]] = (m[r[5]] || 0) + 1, m), {});
  const deptMap = rows_(SH.depts).reduce((m, r) => (m[r[0]] = r[1], m), {});
  const deptDistribution = Object.keys(usersByDept).map(deptId => ({
    name: deptMap[deptId] || 'Unassigned',
    count: usersByDept[deptId]
  }));

  // ── 3. today's status breakdown ──
  const todayAtt = attRows.filter(r => dateOnly_(r[3]) === today);
  const totalActive = activeUsers.length;
  const presentRaw = todayAtt.filter(r => r[4]).length;
  const late = todayAtt.filter(r => r[19] === 'late').length;
  const onLeave = rows_(SH.leaves).filter(r => r[9] === 'approved' && today >= dateOnly_(r[5]) && today <= dateOnly_(r[6])).length;
  const absent = Math.max(0, totalActive - presentRaw - onLeave);
  const statusBreakdown = { present: Math.max(0, presentRaw - late), late, absent, onLeave };

  // ── 4. leave types — this month ──
  const monthStart = Utilities.formatDate(new Date(todayD.getFullYear(), todayD.getMonth(), 1), TZ, 'yyyy-MM-dd');
  const monthLeaves = rows_(SH.leaves).filter(r => dateOnly_(r[5]) >= monthStart);
  const leaveTypes = { sick: 0, casual: 0, annual: 0, medical: 0 };
  monthLeaves.forEach(r => {
    const t = String(r[4] || '').toLowerCase();
    if (leaveTypes.hasOwnProperty(t)) leaveTypes[t]++;
  });

  return { dailyTrend, deptDistribution, statusBreakdown, leaveTypes };
}

function getAdminStats() {
  const today = todayStr_();
  const users = rows_(SH.users).filter(r => r[7] === 'active' && r[4] !== 'admin');
  const totalEmployees = users.length;

  const todayAtt = rows_(SH.att).filter(r => dateOnly_(r[3]) === today);
  const presentToday = todayAtt.filter(r => r[4]).length;
  const lateToday    = todayAtt.filter(r => r[19] === 'late').length;
  const onLeaveToday = rows_(SH.leaves).filter(r => r[9] === 'approved' && today >= dateOnly_(r[5]) && today <= dateOnly_(r[6])).length;
  const absentToday  = Math.max(0, totalEmployees - presentToday - onLeaveToday);
  const activeLocations = new Set(todayAtt.map(r => r[10]).filter(Boolean)).size;

  return { totalEmployees, presentToday, absentToday, onLeaveToday, activeLocations, lateToday };
}

function listAttendance(filter) {
  filter = filter || {};
  const today = todayStr_();
  const userMap = rows_(SH.users).reduce((m, r) => (m[r[0]] = { name: r[3], dept: r[5] }, m), {});
  const deptMap = rows_(SH.depts).reduce((m, r) => (m[r[0]] = r[1], m), {});

  const month = filter.month != null ? Number(filter.month) : new Date().getMonth();
  const year  = filter.year  != null ? Number(filter.year)  : new Date().getFullYear();
  const start = Utilities.formatDate(new Date(year, month, 1), TZ, 'yyyy-MM-dd');
  const end   = Utilities.formatDate(new Date(year, month + 1, 0), TZ, 'yyyy-MM-dd');

  const monthAtt = rows_(SH.att).filter(r => dateOnly_(r[3]) >= start && dateOnly_(r[3]) <= end);
  const byUser = monthAtt.reduce((m, r) => { (m[r[1]] = m[r[1]] || []).push(r); return m; }, {});

  return rows_(SH.users)
    .filter(r => r[7] === 'active' && r[4] !== 'admin')
    .map(r => {
      const userId = r[0];
      const userInfo = userMap[userId];
      const recs = byUser[userId] || [];
      const todayRec = recs.find(x => dateOnly_(x[3]) === today);
      const present = recs.filter(x => x[4]).length;
      const totalDays = recs.length;
      const absent = Math.max(0, totalDays - present);

      let todayStatus = 'Absent';
      if (todayRec) {
        if (todayRec[5]) todayStatus = 'Checked Out';
        else if (todayRec[4]) todayStatus = todayRec[19] === 'late' ? 'Late' : 'Present';
      }

      return {
        username: r[1],
        name: userInfo.name,
        department: deptMap[userInfo.dept] || '—',
        todayStatus,
        checkIn:  todayRec && todayRec[4] ? timeStr_(new Date(todayRec[4])) : '—',
        checkOut: todayRec && todayRec[5] ? timeStr_(new Date(todayRec[5])) : '—',
        checkInPhotoUrl:  todayRec ? (todayRec[9]  || '') : '',
        checkOutPhotoUrl: todayRec ? (todayRec[15] || '') : '',
        totalDays, present, absent
      };
    });
}

// ───────────────────────── payroll / hourly rates ─────────────────────────
// admin-only; lazily ensures the hourlyRate column header exists for legacy sheets
function setHourlyRate_(username, rate) {
  return withLock_(() => {
    if (!username) return { success: false, message: 'Missing username' };
    const r = findRow_(SH.users, x => String(x[1]).toLowerCase() === String(username).toLowerCase());
    if (!r) return { success: false, message: 'Employee not found' };
    const sh = sheet_(SH.users);
    const col = COLS.users.indexOf('hourlyRate') + 1;
    if (sh.getLastColumn() < col) {
      sh.getRange(1, col).setValue('hourlyRate').setFontWeight('bold').setBackground('#001f3f').setFontColor('#fff');
    }
    const val = Math.max(0, Number(rate) || 0);
    sh.getRange(r.rowIdx, col).setValue(val);
    return { success: true, hourlyRate: val };
  });
}

function updateHourlyRate(payload) {
  const { username, rate, actorId, actorUsername } = payload || {};
  // permission: only admins can change rates
  const actor = findRow_(SH.users, x => String(x[1]).toLowerCase() === String(actorUsername || '').toLowerCase());
  if (!actor || actor.row[4] !== 'admin') return { success: false, message: 'Admins only' };
  const r = setHourlyRate_(username, rate);
  if (r.success) log_(actorId || '', actorUsername || '', 'update', 'hourlyRate', username, String(r.hourlyRate));
  return r;
}

// bulk-set hourly rates from CSV (admin only) — rows: [{username, rate}, ...]
function bulkImportRates(payload) {
  const { rows, actorId, actorUsername } = payload || {};
  if (!Array.isArray(rows)) return { success: false, message: 'Invalid rows' };

  const actor = findRow_(SH.users, x => String(x[1]).toLowerCase() === String(actorUsername || '').toLowerCase());
  if (!actor || actor.row[4] !== 'admin') return { success: false, message: 'Admins only' };

  return withLock_(() => {
    const sh = sheet_(SH.users);
    const col = COLS.users.indexOf('hourlyRate') + 1;
    if (sh.getLastColumn() < col) {
      sh.getRange(1, col).setValue('hourlyRate').setFontWeight('bold').setBackground('#001f3f').setFontColor('#fff');
    }
    let updated = 0, skipped = 0;
    const skippedNames = [];
    rows.forEach(r => {
      const username = String((r && r.username) || '').trim();
      const rate = Math.max(0, Number(r && r.rate) || 0);
      if (!username) { skipped++; return; }
      const found = findRow_(SH.users, x => String(x[1]).toLowerCase() === username.toLowerCase());
      if (!found) { skipped++; skippedNames.push(username); return; }
      sh.getRange(found.rowIdx, col).setValue(rate);
      updated++;
    });
    log_(actorId || '', actorUsername || '', 'bulkImport', 'hourlyRates', '', updated + ' updated, ' + skipped + ' skipped');
    return { success: true, updated, skipped, total: rows.length, skippedNames };
  });
}

function listHourlyRates() {
  const depts = rows_(SH.depts).reduce((m, r) => (m[r[0]] = r[1], m), {});
  return rows_(SH.users)
    .filter(r => r[7] === 'active' && r[4] !== 'admin')
    .map(r => ({
      username:    r[1],
      fullName:    r[3],
      role:        r[4],
      department:  depts[r[5]] || '—',
      position:    r[6] || '—',
      hourlyRate:  Number(r[12]) || 0
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

// returns the employees the requester is allowed to payroll: admin → all, manager → own dept
function getPayrollEmployees(args) {
  const { requesterUsername } = args || {};
  if (!requesterUsername) return { success: false, message: 'Missing requester' };
  const req = findRow_(SH.users, x => String(x[1]).toLowerCase() === String(requesterUsername).toLowerCase());
  if (!req) return { success: false, message: 'Requester not found' };
  const reqRole = req.row[4];
  const reqDept = req.row[5];
  if (reqRole !== 'admin' && reqRole !== 'manager') return { success: false, message: 'Unauthorized' };

  const depts = rows_(SH.depts).reduce((m, r) => (m[r[0]] = r[1], m), {});
  const list = rows_(SH.users)
    .filter(r => r[7] === 'active' && r[4] !== 'admin')
    .filter(r => reqRole === 'admin' || r[5] === reqDept)
    .map(r => ({
      username:   r[1],
      fullName:   r[3],
      department: depts[r[5]] || '—',
      position:   r[6] || '—'
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  return { success: true, data: list };
}

// the payroll math: pulls month attendance, multiplies totalHours by hourlyRate per row
function getPayroll(args) {
  const { username, year, month, requesterUsername } = args || {};
  if (!username || year == null || month == null) return { success: false, message: 'Missing fields' };

  const req = findRow_(SH.users, x => String(x[1]).toLowerCase() === String(requesterUsername || '').toLowerCase());
  if (!req) return { success: false, message: 'Unauthorized' };
  const reqRole = req.row[4], reqDept = req.row[5];
  if (reqRole !== 'admin' && reqRole !== 'manager') return { success: false, message: 'Unauthorized' };

  const emp = findRow_(SH.users, x => String(x[1]).toLowerCase() === String(username).toLowerCase());
  if (!emp) return { success: false, message: 'Employee not found' };
  if (reqRole === 'manager' && emp.row[5] !== reqDept) return { success: false, message: 'Employee not in your department' };

  const rate = Number(emp.row[12]) || 0;
  const userId = emp.row[0];
  const fullName = emp.row[3];
  const position = emp.row[6] || '—';
  const deptRow  = rows_(SH.depts).find(r => r[0] === emp.row[5]);
  const deptName = deptRow ? deptRow[1] : '—';

  const y = Number(year), mo = Number(month); // mo is 0-indexed (JS convention)
  const start = Utilities.formatDate(new Date(y, mo, 1),     TZ, 'yyyy-MM-dd');
  const end   = Utilities.formatDate(new Date(y, mo + 1, 0), TZ, 'yyyy-MM-dd');
  const label = Utilities.formatDate(new Date(y, mo, 1),     TZ, 'MMMM yyyy');

  const recs = rows_(SH.att)
    .filter(r => r[1] === userId && dateOnly_(r[3]) >= start && dateOnly_(r[3]) <= end)
    .sort((a, b) => String(dateOnly_(a[3])).localeCompare(String(dateOnly_(b[3]))));

  const days = recs.map(r => {
    const o = rowToObj_(COLS.att, r);
    const hrs = Number(o.totalHours) || 0;
    const earnings = Math.round(hrs * rate * 100) / 100;
    return {
      date:     dateOnly_(o.date),
      checkIn:  o.checkInTime  ? timeStr_(new Date(o.checkInTime))  : '—',
      checkOut: o.checkOutTime ? timeStr_(new Date(o.checkOutTime)) : '—',
      hours:    hrs,
      status:   o.status || '—',
      earnings: earnings
    };
  });

  const totalHours    = Math.round(days.reduce((s, d) => s + d.hours,    0) * 100) / 100;
  const grossEarnings = Math.round(days.reduce((s, d) => s + d.earnings, 0) * 100) / 100;
  const totalDays   = days.length;
  const presentDays = days.filter(d => d.status === 'present' || d.status === 'late').length;
  const lateDays    = days.filter(d => d.status === 'late').length;

  // deductions (Sundays excluded from working days — Pakistan standard)
  const workingDays = workingDaysInMonth_(y, mo);
  const absentDays  = Math.max(0, workingDays - presentDays);
  const latePerDay  = Number(settingGet_('latePenaltyPerDay')) || 0;
  const finePerDay  = Number(settingGet_('leaveFinePerDay'))   || 0;
  const latePenalty = Math.round(lateDays   * latePerDay  * 100) / 100;
  const leaveFine   = Math.round(absentDays * finePerDay  * 100) / 100;
  const netEarnings = Math.max(0, Math.round((grossEarnings - latePenalty - leaveFine) * 100) / 100);

  return {
    success: true,
    data: {
      employee: { username, fullName, position, department: deptName, hourlyRate: rate },
      period:   { year: y, month: mo, label, start, end },
      days,
      totals:   { totalDays, workingDays, presentDays, absentDays, lateDays, totalHours, grossEarnings, latePenalty, leaveFine, netEarnings,
                  latePenaltyPerDay: latePerDay, leaveFinePerDay: finePerDay,
                  totalEarnings: grossEarnings /* legacy alias */ },
      currency:    settingGet_('currency')    || 'Rs.',
      companyName: settingGet_('companyName') || 'Company',
      generatedAt: isoNow_()
    }
  };
}

// working days = Mon-Sat (Sunday off — Pakistan standard)
function workingDaysInMonth_(y, mo) {
  let count = 0;
  const lastDay = new Date(y, mo + 1, 0).getDate();
  for (let d = 1; d <= lastDay; d++) {
    if (new Date(y, mo, d).getDay() !== 0) count++;
  }
  return count;
}

// ───────────────────────── activity log ─────────────────────────
function log_(userId, username, action, entity, entityId, details) {
  try {
    sheet_(SH.logs).appendRow([
      Utilities.getUuid().split('-')[0],
      isoNow_(), userId || '', username || '', action || '', entity || '', entityId || '', details || ''
    ]);
  } catch (e) {
    console.warn('log fail', e);
  }
}

function getRecentLogs(limit) {
  const n = Math.min(Number(limit) || 50, 500);
  return rows_(SH.logs).slice(-n).reverse().map(r => rowToObj_(COLS.logs, r));
}

// ───────────────────────── settings api ─────────────────────────
function getSettings() {
  const out = {};
  rows_(SH.settings).forEach(r => out[r[0]] = r[1]);
  // never expose folderId to client unnecessarily
  delete out.photosFolderId;
  return out;
}

function updateSetting(key, value, actorId, actorUsername) {
  if (!key) return { success: false, message: 'Missing key' };
  settingSet_(key, value);
  log_(actorId || '', actorUsername || '', 'update', 'setting', key, String(value));
  return { success: true };
}
