# TEST_PLAN.md — Test Strategy & Test Cases

> **Machine-executable reference.**  
> Every test case has exact inputs and expected outputs. Run them in order — later cases depend on state created by earlier ones.

---

## 1. Testing Philosophy

This codebase has no automated test runner today. Tests are described here as:
1. **Unit** — pure-function logic, runnable with `node` directly, no network
2. **Integration** — API routes against a real Supabase test project (not production)
3. **End-to-End (E2E)** — browser-driven flows against a Netlify Dev local server

All integration and E2E tests require:
- A dedicated **test Supabase project** (never run against production)
- `netlify dev` running on `localhost:8888`
- Demo users seeded via `setupDemoUsers`

---

## 2. Unit Tests — Payroll Engine

These functions are pure and can be extracted and tested with `node -e`.

### 2.1 `haversine` — Distance Calculation

**Location:** `netlify/functions/api.js` — `haversine(lat1, lng1, lat2, lng2)`

| # | lat1 | lng1 | lat2 | lng2 | Expected (metres) | Tolerance |
|---|------|------|------|------|-------------------|-----------|
| U1 | 10.6549 | -61.5019 | 10.6549 | -61.5019 | 0 | 0 |
| U2 | 10.6549 | -61.5019 | 10.6559 | -61.5019 | ~111 | ±5 |
| U3 | 0 | 0 | 0 | 1 | ~111 195 | ±100 |
| U4 | 10.0 | -61.0 | 10.0 | -62.0 | ~109 958 | ±200 |

**Pass criteria:** returned integer within tolerance for each row.

---

### 2.2 `today()` — Timezone-Aware Date

**Location:** `netlify/functions/api.js` — `today()`  
**Env var dependency:** `APP_TZ`

| # | APP_TZ | System UTC time | Expected `today()` |
|---|--------|-----------------|-------------------|
| U5 | `America/Port_of_Spain` | 2026-01-15T03:59:59Z | `2026-01-14` |
| U6 | `America/Port_of_Spain` | 2026-01-15T04:00:01Z | `2026-01-15` |
| U7 | `Asia/Karachi` | 2026-01-15T18:59:59Z | `2026-01-15` |
| U8 | `Asia/Karachi` | 2026-01-15T19:00:01Z | `2026-01-16` |

**Pass criteria:** returned string matches `YYYY-MM-DD` exactly.

---

### 2.3 Payroll Arithmetic

**Location:** Payroll calculation logic in `runPayroll` / `getPayslip` routes.

Inputs (hourly employee):
```
hourly_rate = 50.00
hours_worked = 80
gross_pay = hourly_rate × hours_worked = 4000.00
health_surcharge = gross_pay > 469.99/week → 8.25, else 4.80 (weekly equivalent)
nis = min(gross_pay × 0.06, 414.30)   // NIS cap = TTD 414.30/month
paye = max((gross_pay − personal_allowance_monthly) × 0.25, 0)
       where personal_allowance_monthly = 84000 / 12 = 7000.00
net_pay = gross_pay − health_surcharge − nis − paye
```

| # | hourly_rate | hours | gross_pay | nis | paye | net_pay |
|---|------------|-------|-----------|-----|------|---------|
| U9 | 50.00 | 80 | 4 000.00 | 240.00 | 0.00 | 3 751.75 |
| U10 | 200.00 | 80 | 16 000.00 | 414.30 | 2 250.00 | 13 327.45 |
| U11 | 10.00 | 40 | 400.00 | 24.00 | 0.00 | 371.75 |

*Health surcharge for U9–U11 assumed 8.25 (gross > weekly threshold).*

**Pass criteria:** `net_pay` matches within ±0.01 TTD.

---

## 3. Integration Tests — API Routes

Base URL: `http://localhost:8888/api`  
Content-Type: `text/plain;charset=utf-8`  
Body format: `{"action":"<action>","args":{...},"token":"<jwt>"}`

### 3.1 Auth — `login`

| # | args | Expected response |
|---|------|-------------------|
| I1 | `{username:"admin", password:"admin123"}` | `{success:true, token:"<jwt>", role:"admin"}` |
| I2 | `{username:"employee1", password:"emp123"}` | `{success:true, role:"employee"}` |
| I3 | `{username:"admin", password:"wrong"}` | `{success:false, message:"Invalid username or password"}` |
| I4 | `{username:"", password:""}` | `{success:false, message:"Missing credentials"}` |
| I5 | `{username:"ADMIN", password:"admin123"}` | `{success:true}` — username match is case-insensitive |

---

### 3.2 Auth — Token Verification

| # | Token | Action | Expected |
|---|-------|--------|----------|
| I6 | None | `getAdminStats` | `{success:false, message:"Unauthorized"}` |
| I7 | Expired JWT (manually crafted) | `getAdminStats` | `{success:false, message:"Unauthorized"}` |
| I8 | Employee token | `getAdminStats` | `{success:false, message:"Forbidden"}` |
| I9 | Manager token | `getAdminStats` | `{success:true, ...}` — manager allowed |
| I10 | Admin token | `getAdminStats` | `{success:true, ...}` |

---

### 3.3 Check-In — `markAttendance`

**Precondition:** employee1 is NOT checked in. GPS coordinates are inside a registered project site (radius ≥ 50 m).

| # | args | Expected |
|---|------|----------|
| I11 | `{action:"checkin", latitude:10.655, longitude:-61.502, username:"employee1"}` | `{success:true, status:"checkedin"}` |
| I12 | Same args immediately after I11 | `{success:false, message:"Already checked in"}` or `{status:"checkedin", alreadyIn:true}` |
| I13 | Check-out: `{action:"checkout", username:"employee1"}` | `{success:true, status:"checkedout"}` |
| I14 | Check-out again after I13 | `{success:false}` — cannot check out if already out |
| I15 | Check-in with GPS 500 m outside all sites | `{success:true}` but `siteId:null` — off-site allowed, recorded |

---

### 3.4 Leave — `submitLeave`

| # | args | Expected |
|---|------|----------|
| I16 | `{leaveType:"Sick", startDate:"2026-06-01", endDate:"2026-06-01", reason:"Flu"}` (employee token) | `{success:true}` — status = `pending` |
| I17 | `{leaveType:"", startDate:"2026-06-01", endDate:"2026-06-01"}` | `{success:false}` — missing type |
| I18 | `{startDate:"2026-06-05", endDate:"2026-06-01"}` | `{success:false}` — end before start |

---

### 3.5 Leave — Admin Approve/Reject

**Precondition:** leave record created in I16 (get its `id`).

| # | action | args | Expected |
|---|--------|------|----------|
| I19 | `approveLeave` (admin token) | `{id:"<leave_id>"}` | `{success:true}` — status → `approved` |
| I20 | `rejectLeave` (admin token) | `{id:"<leave_id>", reason:"No cover"}` | `{success:true}` — status → `rejected` |
| I21 | `approveLeave` (employee token) | `{id:"<leave_id>"}` | `{success:false, message:"Forbidden"}` |

---

### 3.6 Employee CRUD

| # | action | args | Expected |
|---|--------|------|----------|
| I22 | `addEmployee` (admin) | `{username:"testuser99", password:"Test@123", fullName:"Test User", department:"Engineering", role:"employee"}` | `{success:true}` |
| I23 | `addEmployee` (admin) | Same username as I22 | `{success:false}` — duplicate username |
| I24 | `updateEmployee` (admin) | `{username:"testuser99", position:"QA Tester"}` | `{success:true}` |
| I25 | `deleteEmployee` (admin) | `{username:"testuser99"}` | `{success:true}` |
| I26 | `deleteEmployee` (employee token) | any | `{success:false, message:"Forbidden"}` |

---

### 3.7 Settings — `updateSetting` / `getSettings`

| # | action | args | Expected |
|---|--------|------|----------|
| I27 | `updateSetting` (admin) | `{key:"companyName", value:"Acme Corp"}` | `{success:true}` |
| I28 | `getSettings` (any auth) | `{}` | response includes `companyName:"Acme Corp"` |
| I29 | `updateSetting` (employee token) | `{key:"companyName", value:"Hack"}` | `{success:false, message:"Forbidden"}` |

---

### 3.8 Photo Upload — `updateProfileImage`

| # | args | Expected |
|---|------|----------|
| I30 | Valid base64 JPEG < 6 MB (employee token, own username) | `{success:true, profileImage:"<signed_url>"}` |
| I31 | Base64 PNG > 6 MB | `{success:false, message:"Image too large"}` |
| I32 | `data:image/svg+xml;base64,...` | `{success:false, message:"Unsupported image type"}` |
| I33 | Employee token, other employee's username | `{success:false, message:"Forbidden"}` — can only update own photo |

---

### 3.9 Auto-Checkout Function

**Precondition:** employee1 is checked in. Set `workHours.end` to 1 minute in the past.

| # | trigger | Expected |
|---|---------|----------|
| I34 | Call `auto-checkout` handler directly | Returns 200. Attendance row for employee1 has `check_out_time` set to `workHours.end`. `status = "checkedout"`. |
| I35 | Call again (employee already checked out) | Returns 200. No duplicate checkout. `check_out_time` unchanged. |

---

## 4. End-to-End Tests — Browser Flows

Run against `netlify dev` (`localhost:8888`). Use Chrome with DevTools open.

### 4.1 Login Flow

| # | Steps | Expected |
|---|-------|----------|
| E1 | Open app → submit admin/admin123 | Dashboard loads. Sidebar shows: Dashboard, Employees, Departments, Project Sites, Live Map, Attendance, Leaves, Hourly Rates, Payroll |
| E2 | Open app → submit manager1/manager123 | Dashboard loads. Sidebar shows: Dashboard, Employees, Project Sites, Live Map, Attendance only. No edit buttons visible anywhere. |
| E3 | Open app → submit employee1/emp123 | Employee dashboard. Sidebar shows: Attendance, My History, My Leaves, My Payslips |
| E4 | Submit wrong password 3× | Each attempt shows error. No lockout (no rate-limiting currently). |
| E5 | Close tab → reopen | Session restored from `localStorage`. User is still logged in. |

---

### 4.2 Check-In / Check-Out (Employee)

| # | Steps | Expected |
|---|-------|----------|
| E6 | Employee login → Attendance tab → click Check In | Browser prompts for geolocation. On allow: status updates to "Checked In". Timer starts. |
| E7 | Click Check Out | Status → "Checked Out". Duration shown. |
| E8 | Deny geolocation permission → attempt check-in | Error message shown. No attendance record created. |

---

### 4.3 Admin — Employee Management

| # | Steps | Expected |
|---|-------|----------|
| E9 | Admin → Employees → Add Employee → fill form → Save | New employee card appears. No page reload. |
| E10 | Click employee card | Profile drawer opens from right. Shows photo, name, role, department, today's status. |
| E11 | Edit employee → change position → Save | Drawer re-opens with updated position. |
| E12 | Delete employee → confirm | Card removed. Cannot log in with deleted credentials. |
| E13 | Manager login → Employees page | Cards visible. No Edit/Delete buttons. Clicking card opens read-only drawer. No Edit/Delete in drawer footer. |

---

### 4.4 Payslip — Print Receipt

| # | Steps | Expected |
|---|-------|----------|
| E14 | Admin → Payroll → Run Payroll → click View on a payslip | Payslip dialog opens. Header shows employee name + role. Brand section hidden on screen. |
| E15 | Click Print | New window opens. Print preview shows: dark header with employee name left, company info centre, logo right. Gross Pay row is green. Deductions row is red. NIS Reg and BIR File rows visible with dotted separator between them. Font Awesome icons render (not boxes). |
| E16 | Check print preview in Chrome | Page fits A4 landscape at 257 mm width. No content overflow. |

---

### 4.5 Settings — Branding

| # | Steps | Expected |
|---|-------|----------|
| E17 | Admin → Settings → Company → change Company Name → Save | Sidebar brand name updates immediately. |
| E18 | Upload logo image (PNG < 6 MB) → Save | Logo appears in Settings preview. Payslip print header shows logo. |
| E19 | Enter NIS Reg + BIR File → Save | Values persist on reload. Appear in payslip meta grid. |

---

### 4.6 Project Sites — Map & Cards

| # | Steps | Expected |
|---|-------|----------|
| E20 | Admin → Project Sites | Cards animate in once (not twice). Active sites have green header. Inactive sites have grey header at 0.82 opacity. |
| E21 | Navigate away → return to Project Sites | Cards render instantly from cache. No animation replay. |
| E22 | Manager → Project Sites | Cards visible. No Edit/Delete buttons on cards. |
| E23 | Click a card | Selection highlight applied. Right-side stats update to show per-site figures. |

---

## 5. Regression Checklist

Run after every merge to `main`:

- [ ] Login works for admin, manager, employee roles
- [ ] Check-in creates attendance record with correct `work_date`
- [ ] Auto-checkout does not create duplicate rows
- [ ] Payslip print dialog opens and shows correct employee data
- [ ] Project site cards animate only once on first load
- [ ] Manager cannot see edit/delete buttons anywhere
- [ ] Settings save persists across page reload
- [ ] Photo upload rejects SVG and files > 6 MB
- [ ] Leave submission requires future dates with end ≥ start
- [ ] Signed photo URLs load within 3 seconds on cold start
