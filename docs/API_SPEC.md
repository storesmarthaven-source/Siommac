# API_SPEC.md — Complete API Reference

> **Machine-executable reference.**  
> All routes use `POST /.netlify/functions/api`.  
> Request body: `{ "action": "<routeName>", "token": "<JWT>", "args": { ... } }`  
> Response always: `{ "success": true|false, "data": ..., "message": "..." }`

---

## Transport

| Property | Value |
|---|---|
| Method | `POST` only |
| URL | `/.netlify/functions/api` |
| Content-Type | `application/json` |
| Auth | JWT in body: `token` field (Phase 2: `Authorization: Bearer <JWT>`) |
| Error format | `{ "success": false, "message": "<reason>" }` |
| Success format | `{ "success": true, "data": <payload> }` or merged into root |

---

## Auth Levels

| Level | Meaning |
|---|---|
| `public` | No token required |
| `authenticated` | Valid JWT, any active role |
| `manager+` | Role must be `manager` or `admin` |
| `admin` | Role must be `admin` |
| `own` | Authenticated; can only access own resource unless admin |

---

## Routes

---

### `ping`
**Auth:** public  
**Purpose:** Health check  
**Args:** none  
**Response:**
```json
{ "ok": true, "ts": "2026-01-01T00:00:00.000Z" }
```

---

### `login`
**Auth:** public  
**Purpose:** Authenticate user, return JWT and profile data  
**Rate limit:** 5 req/min per IP (Phase 2)  
**Args:**
```json
{
  "username": "john_doe",
  "password": "secret123"
}
```
**Success response:**
```json
{
  "success": true,
  "token": "<JWT>",
  "userId": "USR-001",
  "username": "john_doe",
  "fullName": "John Doe",
  "role": "employee",
  "departmentId": "DEPT-001",
  "position": "Worker",
  "colorScheme": "navy",
  "layoutMode": "sidebar",
  "profileImage": "https://...supabase.co/storage/v1/...signed...",
  "companyLogoUrl": "https://...supabase.co/storage/v1/...",
  "companyName": "Siomac Ltd"
}
```
**Errors:**
| Message | Cause |
|---|---|
| `Missing credentials` | username or password empty |
| `Invalid username or password` | No match or account inactive |

---

### `logout`
**Auth:** authenticated  
**Purpose:** Write logout audit log  
**Args:** none  
**Response:** `{ "success": true }`

---

### `verifyPassword`
**Auth:** authenticated  
**Purpose:** Gate for sensitive admin actions (payroll constants)  
**Args:**
```json
{ "password": "current_password" }
```
**Response:** `{ "success": true }` or `{ "success": false, "message": "Incorrect password." }`

---

### `updateColorScheme`
**Auth:** authenticated (own)  
**Args:**
```json
{ "username": "john_doe", "scheme": "green" }
```
**Response:** `{ "success": true }`

---

### `updateLayoutMode`
**Auth:** authenticated (own)  
**Args:**
```json
{ "username": "john_doe", "mode": "topbar" }
```
**Response:** `{ "success": true }`

---

## Employees

### `listEmployees`
**Auth:** admin  
**Args:** none  
**Response:** Array of employee objects:
```json
[{
  "idx": 1,
  "id": "USR-001",
  "username": "john_doe",
  "fullName": "John Doe",
  "employeeNumber": "EMP-0001",
  "department": "Operations",
  "departmentId": "DEPT-001",
  "position": "Worker",
  "role": "employee",
  "status": "Active",
  "email": "john@example.com",
  "phone": "+18681234567",
  "payCycle": "monthly",
  "todayStatus": "checkedin",
  "profileImage": "https://..."
}]
```
`todayStatus` values: `"notchecked"` | `"checkedin"` | `"checkedout"`

---

### `addEmployee`
**Auth:** admin  
**Args:**
```json
{
  "username": "jane_doe",
  "password": "TempPass123!",
  "fullName": "Jane Doe",
  "role": "employee",
  "department": "DEPT-001",
  "position": "Technician",
  "email": "jane@example.com",
  "phone": "+18681234567",
  "employeeNumber": "EMP-0005",
  "payCycle": "monthly",
  "payBasis": "salary",
  "monthlySalary": 5000,
  "hourlyRate": 0,
  "standardHoursPerDay": 8,
  "nisApplicable": true,
  "healthSurchargeApplicable": true,
  "taxResident": true
}
```
`role` values: `"employee"` | `"manager"` | `"admin"`  
`payCycle` values: `"daily"` | `"weekly"` | `"fortnightly"` | `"monthly"`  
`payBasis` values: `"hourly"` | `"salary"`  
**Response:**
```json
{ "success": true, "id": "uuid", "employeeNumber": "EMP-0005" }
```
**Errors:**
| Message | Cause |
|---|---|
| `Username "x" is already taken.` | Duplicate username |
| `Employee ID "x" is already in use.` | Duplicate employee number |

---

### `updateEmployee`
**Auth:** admin  
**Args:** Same fields as `addEmployee` plus `"username"` (target), all fields optional except `username`. Also supports:
- `"removeProfileImage": true` — clears photo  
- `"profileImageBase64": "data:image/jpeg;base64,..."` — uploads new photo  
- `"status": "inactive"` — deactivate  
**Response:** `{ "success": true }`

---

### `deleteEmployee`
**Auth:** admin  
**Args:**
```json
{ "username": "jane_doe" }
```
**Errors:**
| Message | Cause |
|---|---|
| `You cannot delete your own account` | Self-delete attempt |
| `Cannot delete the last admin account` | Would orphan system |
| `Employee not found` | Unknown username |

---

### `getEmployeeByUsername`
**Auth:** authenticated (own, or admin/manager)  
**Args:**
```json
{ "username": "john_doe" }
```
**Response:**
```json
{
  "success": true,
  "data": {
    "id": "USR-001",
    "username": "john_doe",
    "fullName": "John Doe",
    "role": "employee",
    "employeeNumber": "EMP-0001",
    "departmentId": "DEPT-001",
    "department": "Operations",
    "position": "Worker",
    "status": "active",
    "email": "john@example.com",
    "phone": "+18681234567",
    "colorScheme": "navy",
    "layoutMode": "sidebar",
    "hourlyRate": 25.00,
    "profileImage": "https://...",
    "payCycle": "monthly",
    "payBasis": "salary",
    "monthlySalary": 5000,
    "standardHoursPerDay": 8,
    "nisApplicable": true,
    "healthSurchargeApplicable": true,
    "taxResident": true
  }
}
```

---

### `listManagers`
**Auth:** admin  
**Args:** none  
**Response:** `[{ "id": "USR-001", "name": "John Doe" }]`

---

## Departments

### `listDepartments`
**Auth:** authenticated  
**Args:** none  
**Response:**
```json
[{
  "id": "DEPT-001",
  "name": "Operations",
  "description": "Field operations team",
  "managerId": "USR-002",
  "manager": "Project Manager",
  "employeeCount": 12
}]
```

### `addDepartment`
**Auth:** admin  
**Args:** `{ "name": "HR", "description": "...", "manager": "USR-002" }`  
**Response:** `{ "success": true, "id": "uuid" }`

### `updateDepartment`
**Auth:** admin  
**Args:** `{ "id": "DEPT-001", "name": "HR", "description": "...", "manager": "USR-002" }`  
**Response:** `{ "success": true }`

### `deleteDepartment`
**Auth:** admin  
**Args:** `{ "id": "DEPT-001" }`  
**Response:** `{ "success": true }`

---

## Project Sites

### `listProjectSites`
**Auth:** authenticated  
**Args:** none  
**Response:**
```json
{
  "success": true,
  "data": [{
    "id": "SITE-001",
    "name": "Main Yard",
    "address": "123 Main St, Port of Spain",
    "latitude": 10.6549,
    "longitude": -61.5019,
    "radius": 200,
    "description": "Primary work site",
    "assignedEmployees": [{
      "id": "USR-001",
      "name": "John Doe",
      "photoUrl": "https://..."
    }]
  }],
  "totalActiveEmployees": 20,
  "employees": [{ "id": "USR-001", "name": "John Doe", "photoUrl": "..." }]
}
```

### `addProjectSite`
**Auth:** admin  
**Args:**
```json
{
  "name": "North Site",
  "address": "456 North Ave",
  "latitude": 10.7000,
  "longitude": -61.5500,
  "radius": 150,
  "description": "Northern operations base"
}
```
**Response:** `{ "success": true, "id": "uuid" }`

### `updateProjectSite`
**Auth:** admin  
**Args:** Same as `addProjectSite` plus `"id"`  
**Response:** `{ "success": true }`

### `deleteProjectSite`
**Auth:** admin  
**Args:** `{ "id": "SITE-001" }`  
**Response:** `{ "success": true }`

### `assignSiteEmployees`
**Auth:** admin  
**Purpose:** Replace all assignments for a site atomically  
**Args:**
```json
{ "siteId": "SITE-001", "userIds": ["USR-001", "USR-003"] }
```
**Response:** `{ "success": true }`

---

## Attendance

### `markAttendance`
**Auth:** authenticated (own, or admin for any)  
**Purpose:** Check in or check out  
**Args:**
```json
{
  "username": "john_doe",
  "action": "CheckIn",
  "siteId": "SITE-001",
  "location": {
    "latitude": 10.6549,
    "longitude": -61.5019,
    "accuracy": 15
  },
  "photoBase64": "data:image/jpeg;base64,/9j/..."
}
```
`action` values: `"CheckIn"` | `"Project"` (check-in) | `"CheckOut"`  
**Success response (check-in):**
```json
{
  "success": true,
  "time": "2026-01-01T08:05:00.000Z",
  "action": "CheckIn",
  "message": "Checked in",
  "site": "Main Yard",
  "outsideRadius": false
}
```
**Success response (check-out):**
```json
{
  "success": true,
  "time": "2026-01-01T17:00:00.000Z",
  "action": "CheckOut",
  "totalHours": 8.92,
  "message": "Checked out",
  "outsideRadius": false
}
```
**Errors:**
| Message | Cause |
|---|---|
| `Please select a project site before checking in.` | siteId missing on check-in |
| `Selected project site not found.` | Invalid siteId |
| `You are not assigned to "X". Your assigned site(s): Y.` | Employee not assigned to chosen site |
| `You are not assigned to "X". Contact your administrator...` | Employee has no assignments |
| `You are Xm away from "Y" (radius: Zm). Move closer...` | Outside geofence |
| `Your location could not be determined...` | lat/lng null |
| `Check-in is only allowed between HH:MM and HH:MM.` | Outside work hours |
| `Already checked in today` | Duplicate check-in |
| `Check in first` | Check-out without check-in |
| `Already checked out today` | Duplicate check-out |

---

### `getMyStatus`
**Auth:** authenticated  
**Args:** `{}` or `{ "username": "other_user" }` (admin only for other user)  
**Response:**
```json
{
  "success": true,
  "data": {
    "hasCheckedIn": true,
    "hasCheckedOut": false,
    "checkInTime": "2026-01-01T08:05:00.000Z",
    "checkOutTime": null,
    "location": "Main Yard",
    "checkInPhotoUrl": "https://...",
    "checkOutPhotoUrl": ""
  }
}
```

### `getMyHistory`
**Auth:** authenticated  
**Args:** `{ "days": 30 }` (max 365)  
**Response:** Array:
```json
[{
  "date": "2026-01-01",
  "checkIn": "2026-01-01T08:05:00.000Z",
  "checkOut": "2026-01-01T17:00:00.000Z",
  "hours": 8.92,
  "status": "present",
  "checkInPhotoUrl": "https://...",
  "checkOutPhotoUrl": "https://..."
}]
```

### `getMyChart`
**Auth:** authenticated  
**Args:** `{ "year": 2026, "month": 0 }` (month: 0-indexed)  
**Response:**
```json
{ "present": 18, "absent": 3, "sundays": 4 }
```

### `listAttendance`
**Auth:** admin  
**Args:** `{ "year": 2026, "month": 0 }` (0-indexed month)  
**Response:** Array of per-user attendance summaries with `todayStatus`, `checkIn`, `checkOut`, `totalDays`, `present`, `absent`, `checkInPhotoUrl`, `checkOutPhotoUrl`.

### `listDailyLog`
**Auth:** manager+  
**Args:**
```json
{ "dateFrom": "2026-01-01", "dateTo": "2026-01-31" }
```
OR `{ "month": 0, "year": 2026 }`  
**Response:**
```json
{
  "success": true,
  "data": {
    "rows": [{
      "id": "uuid",
      "username": "john_doe",
      "name": "John Doe",
      "department": "Operations",
      "date": "2026-01-01",
      "checkIn": "2026-01-01T08:05:00.000Z",
      "checkOut": "2026-01-01T17:00:00.000Z",
      "hours": 8.9,
      "status": "Present",
      "checkInPhotoUrl": "https://...",
      "checkOutPhotoUrl": "https://..."
    }],
    "dateRange": { "start": "2026-01-01", "end": "2026-01-31", "days": 23 },
    "stats": { "present": 18, "late": 2, "absent": 3, "rate": 87 },
    "dailyTrend": [{ "date": "2026-01-01", "present": 12, "late": 1, "absent": 3 }],
    "consistency": [{ "username": "john_doe", "name": "John Doe", "department": "Operations",
      "presentDays": 20, "lateDays": 1, "absentDays": 3, "attendanceRate": 87, "avgHours": 8.5 }]
  }
}
```

### `getLiveAttendance`
**Auth:** manager+  
**Args:** `{ "scope": "DEPT-001" }` (admin can pass `"all"`)  
**Response:** Array of live check-in records with GPS coords, photos, site name.

---

## Leave

### `submitLeave`
**Auth:** authenticated  
**Args:**
```json
{
  "type": "sick",
  "fromDate": "2026-02-10",
  "toDate": "2026-02-12",
  "reason": "Medical appointment"
}
```
`type` values: `"sick"` | `"casual"` | `"annual"` | `"medical"`  
**Response:** `{ "success": true, "id": "uuid" }`

### `getMyLeaves`
**Auth:** authenticated  
**Args:** none  
**Response:** Array: `[{ "id", "type", "from", "to", "days", "reason", "status", "appliedOn" }]`  
`status` values: `"pending"` | `"approved"` | `"rejected"`

### `getLeaveById`
**Auth:** authenticated (own, manager for dept, admin for all)  
**Args:** `{ "leaveId": "uuid" }`  
**Response:** Full leave detail including employee info, company branding for print.

### `updateLeave`
**Auth:** authenticated (own pending only, or admin)  
**Args:** `{ "id": "uuid", "type": "annual", "fromDate": "...", "toDate": "...", "reason": "..." }`  
**Response:** `{ "success": true }`

### `deleteLeave`
**Auth:** authenticated (own pending only, or admin)  
**Args:** `{ "leaveId": "uuid" }`  
**Response:** `{ "success": true }`

### `approveLeave`
**Auth:** manager+  
**Args:** `{ "leaveId": "uuid", "notes": "Approved." }`  
**Response:** `{ "success": true }`

### `rejectLeave`
**Auth:** manager+  
**Args:** `{ "leaveId": "uuid", "notes": "Insufficient leave balance." }`  
**Response:** `{ "success": true }`

### `listAllLeaves`
**Auth:** admin  
**Args:** none  
**Response:** `{ "success": true, "data": [{ "id", "employee", "type", "from", "to", "days", "status", "reason" }] }`

### `getPendingLeavesForManager`
**Auth:** manager+  
**Args:** none  
**Response:** Array of pending leave requests (manager: own dept only).

---

## Dashboard & Stats

### `getAdminStats`
**Auth:** admin  
**Args:** none  
**Response:**
```json
{
  "totalEmployees": 20,
  "presentToday": 15,
  "absentToday": 3,
  "onLeaveToday": 2,
  "activeLocations": 3,
  "lateToday": 1
}
```

### `getDashboardCharts`
**Auth:** admin  
**Args:** none  
**Response:**
```json
{
  "dailyTrend": [{ "date": "2026-01-01", "present": 15, "late": 1 }],
  "deptDistribution": [{ "name": "Operations", "count": 10 }],
  "statusBreakdown": { "present": 14, "late": 1, "absent": 3, "onLeave": 2 },
  "leaveTypes": { "sick": 3, "casual": 1, "annual": 2, "medical": 0 }
}
```

### `getDeptStats`
**Auth:** manager+  
**Args:** `{ "departmentId": "DEPT-001" }` (admin only; manager uses own dept)  
**Response:** `{ "total", "present", "onLeave", "late" }`

### `getDeptEmployees`
**Auth:** manager+  
**Args:** `{ "departmentId": "DEPT-001" }` (admin only; manager uses own dept)  
**Response:** Array of `{ "name", "position", "status", "lastActivity", "location" }`

### `getRecentAttendance`
**Auth:** manager+  
**Args:** `{ "limit": 10 }` (max 50)  
**Response:** `{ "success": true, "data": [{ "name", "department", "checkIn", "checkOut", "status", "workDate" }] }`

### `getHeaderCounts`
**Auth:** authenticated  
**Args:** `{ "ticketSeenSince": "ISO date" }` (optional)  
**Response:**
```json
{
  "success": true,
  "data": {
    "notificationIds": ["leave_uuid", "checkin_john_doe_2026-01-01"],
    "messages": 2,
    "tickets": 1,
    "pendingLeaves": 3,
    "activeSites": 2
  }
}
```

---

## Settings

### `getSettings`
**Auth:** public (no token check in current implementation)  
**Args:** none  
**Response:** Key-value object of all settings rows.

### `updateSetting`
**Auth:** admin  
**Args:** `{ "key": "companyName", "value": "Siomac Ltd" }`  
**Response:** `{ "success": true }`

### `getWorkHours`
**Auth:** public  
**Args:** none  
**Response:** `{ "success": true, "data": { "start": "08:00", "end": "17:00" } }`

### `saveWorkHours`
**Auth:** admin  
**Args:** `{ "start": "08:00", "end": "17:00" }`  
**Errors:**
| Message | Cause |
|---|---|
| `Invalid time format. Use HH:MM.` | Not matching `^\d{2}:\d{2}$` |
| `Work start must be before end time.` | start >= end |

---

## Profile & Media

### `updateMyProfile`
**Auth:** authenticated (own only)  
**Args:**
```json
{
  "username": "john_doe",
  "fullName": "John A. Doe",
  "email": "new@email.com",
  "phone": "+18681234567",
  "oldPassword": "current_pass",
  "newPassword": "new_pass",
  "profileImageBase64": "data:image/jpeg;base64,...",
  "removeProfileImage": false
}
```
All fields optional except `username`.  
**Response:** `{ "success": true, "profileImage": "https://...", "fullName": "...", "email": "...", "phone": "..." }`

### `uploadLogo`
**Auth:** admin  
**Args:** `{ "base64": "data:image/png;base64,..." }`  
**Response:** `{ "success": true, "url": "https://..." }`

---

## Payroll

### `listPayrollRun`
**Auth:** manager+  
**Purpose:** Calculate payroll for a date range (NOT persisted — calculation only)  
**Args:**
```json
{
  "dateFrom": "2026-01-01",
  "dateTo": "2026-01-31",
  "cycle": "monthly",
  "overrides": { "USR-001": 160 }
}
```
`cycle` values: `"all"` | `"daily"` | `"weekly"` | `"fortnightly"` | `"monthly"`  
`overrides`: map of `userId → hoursWorked` (optional, overrides auto-calculated hours)  
**Response:**
```json
{
  "success": true,
  "data": {
    "rows": [{
      "userId": "USR-001",
      "username": "john_doe",
      "name": "John Doe",
      "department": "Operations",
      "position": "Worker",
      "payCycle": "monthly",
      "payBasis": "salary",
      "hourlyRate": 0,
      "monthlySalary": 5000,
      "stdHours": 8,
      "nisApplicable": true,
      "hsApplicable": true,
      "taxResident": true,
      "autoHours": 168,
      "hoursWorked": 160,
      "overridden": true,
      "daysWorked": 21,
      "grossPay": 5000.00,
      "paye": 208.33,
      "nis": 300.00,
      "healthSurcharge": 33.00,
      "totalDeductions": 541.33,
      "netPay": 4458.67
    }],
    "totals": {
      "grossPay": 95000.00,
      "paye": 4166.67,
      "nis": 5700.00,
      "healthSurcharge": 627.00,
      "totalDeductions": 10493.67,
      "netPay": 84506.33
    },
    "dateFrom": "2026-01-01",
    "dateTo": "2026-01-31",
    "cycleFilter": "monthly"
  }
}
```

### `approvePayroll`
**Auth:** manager+  
**Purpose:** Persist approved payslips to `payroll_approvals` table  
**Args:**
```json
{
  "rows": [ /* same row objects as listPayrollRun response */ ],
  "dateFrom": "2026-01-01",
  "dateTo": "2026-01-31",
  "cycleFilter": "monthly",
  "approvedBy": "admin"
}
```
**Response:** `{ "success": true, "count": 20 }`  
**Note:** Idempotent — upserts on `(user_id, date_from, date_to, pay_cycle)`.

### `getMyPayslips`
**Auth:** authenticated  
**Args:** none  
**Response:** `{ "success": true, "data": [{ payroll_approvals columns }] }` (last 24)

### `getPayroll`
**Auth:** manager+  
**Purpose:** Individual employee payroll detail for a month  
**Args:** `{ "username": "john_doe", "year": 2026, "month": 0 }`  
**Response:** Full payroll breakdown with daily attendance, totals, late penalties.

### `getPayrollEmployees`
**Auth:** manager+  
**Args:** none  
**Response:** `{ "success": true, "data": [{ "username", "fullName", "department", "position" }] }`

### `getPayrollConstants`
**Auth:** admin  
**Args:** none  
**Response:** `{ "success": true, "data": { "PERSONAL_ALLOWANCE_ANNUAL": 90000, "PAYE_RATE_LOW": 0.25, ... } }`

### `savePayrollConstants`
**Auth:** admin  
**Args:**
```json
{
  "constants": {
    "personal_allowance_annual": 90000,
    "paye_rate_low": 0.25,
    "paye_rate_high": 0.30,
    "paye_high_threshold_annual": 1000000,
    "nis_rate": 0.06,
    "nis_monthly_cap": 13600,
    "hs_high_monthly": 33.00,
    "hs_low_monthly": 6.00,
    "hs_threshold_weekly": 469.99
  }
}
```
**Response:** `{ "success": true }`

### `updateEmployeePayroll`
**Auth:** admin  
**Args:**
```json
{
  "userId": "USR-001",
  "payCycle": "monthly",
  "payBasis": "salary",
  "hourlyRate": 0,
  "monthlySalary": 5000,
  "standardHoursPerDay": 8,
  "nisApplicable": true,
  "healthSurchargeApplicable": true,
  "taxResident": true
}
```

### `listHourlyRates`
**Auth:** admin  
**Args:** none  
**Response:** Array of `{ "username", "fullName", "role", "department", "position", "hourlyRate" }`

### `updateHourlyRate`
**Auth:** admin  
**Args:** `{ "username": "john_doe", "rate": 25.50 }`

### `bulkImportRates`
**Auth:** admin  
**Args:** `{ "rows": [{ "username": "john_doe", "rate": 25.50 }] }`  
**Response:** `{ "success": true, "updated": 18, "skipped": 2, "total": 20, "skippedNames": [] }`

---

## Notifications

### `getNotifications`
**Auth:** authenticated  
**Args:** none  
**Response:**
```json
{
  "success": true,
  "data": [{
    "id": "leave_uuid",
    "type": "leave",
    "icon": "fa-calendar-check",
    "color": "blue",
    "title": "Leave request pending approval",
    "sub": "John Doe · Sick · 3 days · 2026-01-10 – 2026-01-12",
    "time": "2026-01-09T14:00:00.000Z",
    "photoUrl": "https://...",
    "priority": 1
  }]
}
```
Notification `type` values: `leave` | `late` | `checkin` | `checkout` | `absent` | `my_checkin` | `my_checkout` | `reminder` | `myleave` | `pending` | `payslip` | `upcoming` | `msgreply` | `ticketreply` | `ticketstatus`

---

## Messages

### `sendMessage`
**Auth:** authenticated  
**Args:** `{ "toUsername": "jane_doe", "subject": "Re: Site visit", "body": "..." }` (admin/manager must provide `toUsername`; employee sends to admin automatically)

### `getMessages`
**Auth:** authenticated  
**Args:** none  
**Response:** `{ "success": true, "data": [thread objects], "unreadCount": 2 }`

### `replyMessage`
**Auth:** authenticated  
**Args:** `{ "messageId": "uuid", "body": "..." }`

### `markMessageRead`
**Auth:** authenticated  
**Args:** `{ "messageId": "uuid" }`

### `deleteMessage`
**Auth:** manager+  
**Args:** `{ "messageId": "uuid" }`

### `getEmployeesForMsg`
**Auth:** manager+  
**Args:** none  
**Response:** `{ "success": true, "data": [{ "id", "username", "fullName", "role" }] }`

---

## Support Tickets

### `createTicket`
**Auth:** employee only (admin/manager forbidden)  
**Args:**
```json
{
  "category": "payroll",
  "subject": "Missing overtime pay",
  "body": "My January overtime was not included..."
}
```
`category` values: `"general"` | `"payroll"` | `"attendance"` | `"leave"` | `"it"` | `"hr"`  
**Response:** `{ "success": true, "id": "uuid", "ticketNumber": "TKT-0042" }`

### `getTickets`
**Auth:** authenticated  
**Args:** none  
**Response:** `{ "success": true, "data": [ticket objects with replies], "openCount": 3 }`  
Admin sees all (not cleared). Employee sees own (not cleared).

### `replyTicket`
**Auth:** authenticated  
**Args:** `{ "ticketId": "uuid", "body": "..." }`  
**Error:** Cannot reply to closed/resolved ticket.

### `updateTicketStatus`
**Auth:** manager+  
**Args:** `{ "ticketId": "uuid", "status": "resolved" }`  
`status` values: `"open"` | `"in_progress"` | `"resolved"` | `"closed"`

### `deleteTicket`
**Auth:** employee (own open/in_progress tickets only)  
**Args:** `{ "ticketId": "uuid" }`

### `clearClosedTickets`
**Auth:** authenticated  
**Purpose:** Soft-hide resolved/closed tickets from the caller's view  
**Args:** none  
**Response:** `{ "success": true, "count": 5 }`

---

## Error Response Reference

All errors follow this shape:
```json
{ "success": false, "message": "<human readable reason>" }
```

| HTTP Status | When |
|---|---|
| 200 | Always (even for business-logic errors — legacy behaviour) |
| 204 | OPTIONS preflight |
| 400 | Invalid JSON body |
| 405 | Non-POST method |

> **Phase 2:** Business-logic errors should return 4xx. Login failure → 401. Forbidden → 403. Not found → 404. Validation → 422.
