import { Hono } from 'hono';
import { sb }   from '../lib/db';
import { requireUser, requireRole, log_ } from '../lib/auth';
import { deptScopeFilter, assertInScope }  from '../lib/permissions';
import { dateOnly, r2 }                   from '../lib/helpers';
import { setting, getAllSettings, invalidateSettingsCache } from '../lib/settings';
import { zv, z, zPayCycle, zPayBasis, zDateStr } from '../lib/validate';
import type { HonoVariables }             from '../../../types/api';
import type { Payslip }                   from '../../../types/api';
import type { AppUser, PayCycle, PayBasis } from '../../../types/db';

const router = new Hono<{ Variables: HonoVariables }>();

// ── Trinidad & Tobago Payroll Constants ───────────────────────────────────────
const TT_DEFAULTS = {
  PERSONAL_ALLOWANCE_ANNUAL:  90_000,
  PAYE_RATE_LOW:              0.25,
  PAYE_RATE_HIGH:             0.30,
  PAYE_HIGH_THRESHOLD_ANNUAL: 1_000_000,
  NIS_RATE:                   0.06,
  NIS_MONTHLY_CAP:            13_600,
  HS_HIGH_DAILY:              1.65,
  HS_HIGH_WEEKLY:             8.25,
  HS_HIGH_FORTNIGHTLY:        16.50,
  HS_HIGH_MONTHLY:            33.00,
  HS_LOW_DAILY:               0.30,
  HS_LOW_WEEKLY:              1.50,
  HS_LOW_FORTNIGHTLY:         3.00,
  HS_LOW_MONTHLY:             6.00,
  HS_THRESHOLD_WEEKLY:        469.99,
} as const;

interface TtPayroll {
  PERSONAL_ALLOWANCE_ANNUAL:  number;
  PAYE_RATE_LOW:              number;
  PAYE_RATE_HIGH:             number;
  PAYE_HIGH_THRESHOLD_ANNUAL: number;
  NIS_RATE:                   number;
  NIS_MONTHLY_CAP:            number;
  NIS_CAP:  Record<PayCycle, number>;
  ALLOWANCE: Record<PayCycle, number>;
  HS_HIGH:  Record<PayCycle, number>;
  HS_LOW:   Record<PayCycle, number>;
  HS_THRESHOLD_WEEKLY: number;
}

function _buildTtPayroll(settings: Record<string, string> | null): TtPayroll {
  const n = (key: string, def: number): number => {
    const v = settings?.['payroll_' + key.toLowerCase()];
    return (v !== undefined && v !== '') ? Number(v) : def;
  };
  const nisMonthly = n('nis_monthly_cap',              TT_DEFAULTS.NIS_MONTHLY_CAP);
  const nisRate    = n('nis_rate',                     TT_DEFAULTS.NIS_RATE);
  const hsThresh   = n('hs_threshold_weekly',          TT_DEFAULTS.HS_THRESHOLD_WEEKLY);
  const allowAnn   = n('personal_allowance_annual',    TT_DEFAULTS.PERSONAL_ALLOWANCE_ANNUAL);
  return {
    PERSONAL_ALLOWANCE_ANNUAL:  allowAnn,
    PAYE_RATE_LOW:              n('paye_rate_low',              TT_DEFAULTS.PAYE_RATE_LOW),
    PAYE_RATE_HIGH:             n('paye_rate_high',             TT_DEFAULTS.PAYE_RATE_HIGH),
    PAYE_HIGH_THRESHOLD_ANNUAL: n('paye_high_threshold_annual', TT_DEFAULTS.PAYE_HIGH_THRESHOLD_ANNUAL),
    NIS_RATE: nisRate,
    NIS_MONTHLY_CAP: nisMonthly,
    NIS_CAP: {
      daily:       r2(nisMonthly / (52 / 12) / 5),
      weekly:      r2(nisMonthly / (52 / 12)),
      fortnightly: r2(nisMonthly / (26 / 12)),
      monthly:     nisMonthly,
    },
    ALLOWANCE: {
      daily:       r2(allowAnn / 260),
      weekly:      r2(allowAnn / 52),
      fortnightly: r2(allowAnn / 26),
      monthly:     r2(allowAnn / 12),
    },
    HS_HIGH: {
      daily:       n('hs_high_daily',       TT_DEFAULTS.HS_HIGH_DAILY),
      weekly:      n('hs_high_weekly',      TT_DEFAULTS.HS_HIGH_WEEKLY),
      fortnightly: n('hs_high_fortnightly', TT_DEFAULTS.HS_HIGH_FORTNIGHTLY),
      monthly:     n('hs_high_monthly',     TT_DEFAULTS.HS_HIGH_MONTHLY),
    },
    HS_LOW: {
      daily:       n('hs_low_daily',       TT_DEFAULTS.HS_LOW_DAILY),
      weekly:      n('hs_low_weekly',      TT_DEFAULTS.HS_LOW_WEEKLY),
      fortnightly: n('hs_low_fortnightly', TT_DEFAULTS.HS_LOW_FORTNIGHTLY),
      monthly:     n('hs_low_monthly',     TT_DEFAULTS.HS_LOW_MONTHLY),
    },
    HS_THRESHOLD_WEEKLY: hsThresh,
  };
}

let TT_PAYROLL: TtPayroll = _buildTtPayroll(null);

function _hsThreshold(cycle: PayCycle): number {
  const w = TT_PAYROLL.HS_THRESHOLD_WEEKLY;
  const map: Record<PayCycle, number> = { daily: w / 5, weekly: w, fortnightly: w * 2, monthly: w * 4.333 };
  return map[cycle] ?? w;
}

interface PayrollEmp {
  pay_cycle:                   PayCycle | null;
  pay_basis:                   PayBasis | null;
  standard_hours_per_day:      number | null;
  nis_applicable:              boolean | null;
  health_surcharge_applicable: boolean | null;
  tax_resident:                boolean | null;
  hourly_rate:                 number | null;
  monthly_salary:              number | null;
}

function calcPayslip(emp: PayrollEmp, hoursWorked: number): Payslip {
  const cycle         = emp.pay_cycle  ?? 'monthly';
  const basis         = emp.pay_basis  ?? 'salary';
  const nisApplicable = emp.nis_applicable !== false;
  const hsApplicable  = emp.health_surcharge_applicable !== false;
  const taxResident   = emp.tax_resident !== false;

  let grossPay = 0;
  if (basis === 'hourly') {
    grossPay = r2(hoursWorked * (Number(emp.hourly_rate) || 0));
  } else {
    const s = Number(emp.monthly_salary) || 0;
    const map: Record<PayCycle, number> = { daily: s / 22, weekly: s / 4.333, fortnightly: s / 2.166, monthly: s };
    grossPay = r2(map[cycle] ?? s);
  }

  let paye = 0;
  if (taxResident) {
    const allowance  = TT_PAYROLL.ALLOWANCE[cycle] ?? 0;
    const taxablePay = Math.max(0, grossPay - allowance);
    if (taxablePay > 0) {
      const factorMap: Record<PayCycle, number> = { daily: 260, weekly: 52, fortnightly: 26, monthly: 12 };
      const annualFactor  = factorMap[cycle] ?? 12;
      const highThreshold = TT_PAYROLL.PAYE_HIGH_THRESHOLD_ANNUAL / annualFactor;
      paye = taxablePay <= highThreshold
        ? r2(taxablePay * TT_PAYROLL.PAYE_RATE_LOW)
        : r2(r2(highThreshold * TT_PAYROLL.PAYE_RATE_LOW) + r2((taxablePay - highThreshold) * TT_PAYROLL.PAYE_RATE_HIGH));
    }
  } else {
    paye = r2(grossPay * TT_PAYROLL.PAYE_RATE_LOW);
  }

  let nis = 0;
  if (nisApplicable) {
    const nisCap = TT_PAYROLL.NIS_CAP[cycle] ?? TT_PAYROLL.NIS_CAP.monthly;
    nis = r2(Math.min(grossPay, nisCap) * TT_PAYROLL.NIS_RATE);
  }

  let healthSurcharge = 0;
  if (hsApplicable) {
    healthSurcharge = grossPay > _hsThreshold(cycle) ? TT_PAYROLL.HS_HIGH[cycle] : TT_PAYROLL.HS_LOW[cycle];
  }

  const totalDeductions = r2(paye + nis + healthSurcharge);
  const netPay          = r2(Math.max(0, grossPay - totalDeductions));
  return { grossPay, paye, nis, healthSurcharge, totalDeductions, netPay };
}

function workingDaysInMonth(y: number, mo: number): number {
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  let count = 0;
  for (let d = 1; d <= last; d++) {
    const day = new Date(Date.UTC(y, mo, d)).getUTCDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.post('/listHourlyRates', async c => {
  await requireRole(c, ['admin']);
  const [{ data: users, error: uErr }, { data: depts, error: dErr }] = await Promise.all([
    sb.from('app_users').select('id,username,full_name,role,department_id,position,hourly_rate').eq('status', 'active').neq('role', 'admin').order('full_name'),
    sb.from('departments').select('id,name'),
  ]);
  if (uErr) throw new Error('Failed to load users: ' + uErr.message);
  if (dErr) throw new Error('Failed to load departments: ' + dErr.message);
  const deptMap = Object.fromEntries(((depts ?? []) as any[]).map(d => [d.id, d.name]));
  return c.json({ success: true, data: ((users ?? []) as any[]).map(u => ({
    username: u.username, fullName: u.full_name, role: u.role,
    department: (u.department_id && deptMap[u.department_id]) || '—',
    position: u.position || '—',
    hourlyRate: Number(u.hourly_rate) || 0,
  })) });
});

router.post('/updateHourlyRate', async c => {
  const actor = await requireRole(c, ['admin']);
  const { username, rate } = (c.get('body').args ?? {}) as Record<string, unknown>;
  await sb.from('app_users').update({ hourly_rate: Math.max(0, Number(rate) || 0), updated_at: new Date().toISOString() }).eq('username', username);
  await log_(actor, 'update', 'hourlyRate', String(username), String(rate ?? 0));
  return c.json({ success: true });
});

router.post('/bulkImportRates', async c => {
  const actor = await requireRole(c, ['admin']);
  const { rows } = (c.get('body').args ?? {}) as { rows?: Array<{ username?: string; rate?: unknown }> };

  const results = await Promise.allSettled(
    (rows ?? []).map(async row => {
      const username = String(row.username ?? '').trim();
      if (!username) throw new Error('empty username');
      const { error } = await sb.from('app_users').update({ hourly_rate: Math.max(0, Number(row.rate) || 0) }).eq('username', username);
      if (error) throw error;
    }),
  );

  const updated = results.filter(r => r.status === 'fulfilled').length;
  const skipped = results.filter(r => r.status === 'rejected').length;
  await log_(actor, 'bulkImport', 'hourlyRates', '', `${updated} updated, ${skipped} skipped`);
  return c.json({ success: true, updated, skipped, total: (rows ?? []).length, skippedNames: [] });
});

router.post('/getPayrollEmployees', async c => {
  const actor = await requireRole(c, ['admin', 'manager']);
  const [{ data: users, error: uErr }, { data: depts, error: dErr }] = await Promise.all([
    sb.from('app_users').select('id,username,full_name,department_id,position,status,role').eq('status', 'active').neq('role', 'admin').order('full_name'),
    sb.from('departments').select('id,name'),
  ]);
  if (uErr) throw new Error('Failed to load employees: ' + uErr.message);
  if (dErr) throw new Error('Failed to load departments: ' + dErr.message);
  const deptMap = Object.fromEntries(((depts ?? []) as any[]).map(d => [d.id, d.name]));
  const scope = await deptScopeFilter(actor);
  let list = (users ?? []) as any[];
  if (!scope.all) list = list.filter(u => u.department_id === scope.departmentId);
  return c.json({ success: true, data: list.map(u => ({ username: u.username, fullName: u.full_name, department: deptMap[u.department_id] || '—', position: u.position || '—' })) });
});

router.post('/getPayroll', async c => {
  const actor = await requireRole(c, ['admin', 'manager']);
  const { username, year, month } = (c.get('body').args ?? {}) as Record<string, unknown>;
  const { data: emp } = await sb.from('app_users').select('*').eq('username', username).single<AppUser>();
  if (!emp) return c.json({ success: false, message: 'Employee not found' });
  await assertInScope(actor, emp.department_id);

  const y  = Number(year), mo = Number(month);
  const start = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10);
  const end   = new Date(Date.UTC(y, mo + 1, 0)).toISOString().slice(0, 10);
  const label = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(new Date(Date.UTC(y, mo, 1)));

  const [{ data: recs }, deptRow, [latePerDay, finePerDay, currency, companyName]] = await Promise.all([
    sb.from('attendance').select('*').eq('user_id', emp.id).gte('work_date', start).lte('work_date', end).order('work_date'),
    emp.department_id ? sb.from('departments').select('name').eq('id', emp.department_id).maybeSingle<{ name: string }>().then(r => r.data) : Promise.resolve(null),
    Promise.all([
      setting('latePenaltyPerDay', '0'),
      setting('leaveFinePerDay',   '0'),
      setting('currency',          'TT'),
      setting('companyName',       'Company'),
    ]),
  ]);

  const rate       = Number(emp.hourly_rate)  || 0;
  const lateDeduct = Number(latePerDay)        || 0;
  const fineDeduct = Number(finePerDay)        || 0;

  const days = ((recs ?? []) as any[]).map(a => {
    const hours = Number(a.total_hours) || 0;
    return { date: dateOnly(a.work_date), checkIn: a.check_in_time ?? null, checkOut: a.check_out_time ?? null, hours, status: a.status ?? '—', earnings: r2(hours * rate) };
  });

  const totalHours    = r2(days.reduce((s, d) => s + d.hours,    0));
  const grossEarnings = r2(days.reduce((s, d) => s + d.earnings, 0));
  const workingDays   = workingDaysInMonth(y, mo);
  const presentDays   = days.filter(d => d.status === 'present' || d.status === 'late').length;
  const lateDays      = days.filter(d => d.status === 'late').length;
  const absentDays    = Math.max(0, workingDays - presentDays);
  const latePenalty   = r2(lateDays   * lateDeduct);
  const leaveFine     = r2(absentDays * fineDeduct);
  const netEarnings   = r2(Math.max(0, grossEarnings - latePenalty - leaveFine));

  return c.json({ success: true, data: {
    employee: { username: emp.username, fullName: emp.full_name, position: emp.position ?? '—', department: deptRow?.name ?? '—', hourlyRate: rate },
    period:   { year: y, month: mo, label, start, end },
    days,
    totals: { totalDays: days.length, workingDays, presentDays, absentDays, lateDays, totalHours, grossEarnings, latePenaltyPerDay: lateDeduct, latePenalty, leaveFinePerDay: fineDeduct, leaveFine, netEarnings, totalEarnings: grossEarnings },
    currency, companyName, generatedAt: new Date().toISOString(),
  } });
});

router.post('/listPayrollRun', async c => {
  const actor = await requireRole(c, ['admin', 'manager']);
  const scope = await deptScopeFilter(actor);
  const { dateFrom: rawFrom, dateTo: rawTo, cycle: cycleFilter = 'all', overrides = {} } = (c.get('body').args ?? {}) as Record<string, unknown>;
  const dateFrom = String(rawFrom ?? '').slice(0, 10);
  const dateTo   = String(rawTo   ?? '').slice(0, 10);
  if (!dateFrom || !dateTo) return c.json({ success: false, message: 'Missing dateFrom or dateTo' });

  const settingsMap = await getAllSettings();
  TT_PAYROLL = _buildTtPayroll(settingsMap);

  let empQuery = sb.from('app_users')
    .select('id, username, full_name, department_id, position, pay_cycle, pay_basis, hourly_rate, monthly_salary, standard_hours_per_day, nis_applicable, health_surcharge_applicable, tax_resident')
    .eq('status', 'active').neq('role', 'admin').order('full_name');
  if (cycleFilter !== 'all') empQuery = empQuery.eq('pay_cycle', cycleFilter);
  if (!scope.all) empQuery = empQuery.eq('department_id', scope.departmentId);

  const [{ data: emps }, { data: depts }, { data: attRecs }] = await Promise.all([
    empQuery,
    sb.from('departments').select('id,name'),
    sb.from('attendance').select('user_id, work_date, check_in_time, check_out_time, total_hours, status').gte('work_date', dateFrom).lte('work_date', dateTo),
  ]);
  const deptMap   = Object.fromEntries(((depts ?? []) as any[]).map(d => [d.id, d.name]));
  const attByUser: Record<string, any[]> = {};
  for (const a of (attRecs ?? []) as any[]) {
    if (!attByUser[a.user_id]) attByUser[a.user_id] = [];
    attByUser[a.user_id].push(a);
  }

  const overridesMap = overrides as Record<string, number>;
  const rows = ((emps ?? []) as (AppUser & PayrollEmp)[]).map(emp => {
    const recs       = attByUser[emp.id] ?? [];
    const autoHours  = r2(recs.reduce((s: number, a: any) => s + (Number(a.total_hours) || 0), 0));
    const hoursWorked = overridesMap[emp.id] != null ? Number(overridesMap[emp.id]) : autoHours;
    const calc        = calcPayslip(emp, hoursWorked);
    return {
      userId: emp.id, username: emp.username, name: emp.full_name,
      department: deptMap[emp.department_id ?? ''] ?? '—', position: emp.position ?? '—',
      payCycle: emp.pay_cycle ?? 'monthly', payBasis: emp.pay_basis ?? 'salary',
      hourlyRate: Number(emp.hourly_rate) || 0, monthlySalary: Number(emp.monthly_salary) || 0,
      stdHours: Number(emp.standard_hours_per_day) || 8,
      nisApplicable: emp.nis_applicable !== false, hsApplicable: emp.health_surcharge_applicable !== false, taxResident: emp.tax_resident !== false,
      autoHours, hoursWorked, overridden: overridesMap[emp.id] != null,
      daysWorked: recs.filter((a: any) => a.check_in_time).length,
      ...calc,
    };
  });

  const totals = rows.reduce((t, r) => {
    t.grossPay        = r2(t.grossPay        + r.grossPay);
    t.paye            = r2(t.paye            + r.paye);
    t.nis             = r2(t.nis             + r.nis);
    t.healthSurcharge = r2(t.healthSurcharge + r.healthSurcharge);
    t.totalDeductions = r2(t.totalDeductions + r.totalDeductions);
    t.netPay          = r2(t.netPay          + r.netPay);
    return t;
  }, { grossPay: 0, paye: 0, nis: 0, healthSurcharge: 0, totalDeductions: 0, netPay: 0 });

  return c.json({ success: true, data: { rows, totals, dateFrom, dateTo, cycleFilter } });
});

const ApprovePayrollSchema = z.object({
  dateFrom:    zDateStr,
  dateTo:      zDateStr,
  cycleFilter: zPayCycle.optional(),
  approvedBy:  z.string().max(128).optional(),
  rows: z.array(z.object({
    userId:        z.string().max(64),
    username:      z.string().max(64),
    payCycle:      zPayCycle.optional(),
    payBasis:      zPayBasis.optional(),
    grossPay:      z.number().nonnegative(),
    nis:           z.number().nonnegative(),
    healthSurcharge: z.number().nonnegative(),
    paye:          z.number().nonnegative(),
    totalDeductions: z.number().nonnegative(),
    netPay:        z.number().nonnegative(),
    hoursWorked:   z.number().nonnegative(),
    daysWorked:    z.number().int().nonnegative(),
    hourlyRate:    z.number().nonnegative().optional(),
    monthlySalary: z.number().nonnegative().optional(),
    department:    z.string().max(128).optional(),
    position:      z.string().max(128).optional(),
  })).min(1).max(1000),
});

router.post('/approvePayroll', async c => {
  await requireRole(c, ['admin', 'manager']);
  const v = zv(c, ApprovePayrollSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { rows, dateFrom, dateTo, cycleFilter, approvedBy } = v.data;

  const records = rows.map(r => ({
    user_id: r.userId, username: r.username,
    date_from: dateFrom, date_to: dateTo,
    pay_cycle: r.payCycle ?? cycleFilter ?? 'monthly',
    pay_basis: r.payBasis ?? 'salary',
    gross_pay: r.grossPay, nis: r.nis, health_surcharge: r.healthSurcharge,
    paye: r.paye, total_deductions: r.totalDeductions, net_pay: r.netPay,
    hours_worked: r.hoursWorked, days_worked: r.daysWorked,
    hourly_rate: r.hourlyRate ?? 0, monthly_salary: r.monthlySalary ?? 0,
    department: r.department ?? '', position: r.position ?? '',
    approved_by: approvedBy ?? 'admin', approved_at: new Date().toISOString(), status: 'approved',
  }));

  const { error } = await sb.from('payroll_approvals').upsert(records, { onConflict: 'user_id,date_from,date_to,pay_cycle' });
  if (error) return c.json({ success: false, message: error.message });
  return c.json({ success: true, count: records.length });
});

router.post('/getMyPayslips', async c => {
  const actor = await requireUser(c);
  const { data, error } = await sb.from('payroll_approvals').select('*').eq('user_id', actor.id).eq('status', 'approved').order('date_from', { ascending: false }).limit(24);
  if (error) return c.json({ success: false, message: error.message });
  return c.json({ success: true, data: data ?? [] });
});

router.post('/getPayrollConstants', async c => {
  await requireRole(c, ['admin']);
  const { data } = await sb.from('settings').select('key,value').like('key', 'payroll_%');
  const stored = Object.fromEntries(((data ?? []) as any[]).map(r => [r.key.replace('payroll_', ''), r.value]));
  const merged: Record<string, number> = {};
  Object.entries(TT_DEFAULTS).forEach(([k, v]) => {
    const dbKey = k.toLowerCase();
    merged[k] = stored[dbKey] !== undefined ? Number(stored[dbKey]) : Number(v);
  });
  return c.json({ success: true, data: merged });
});

router.post('/savePayrollConstants', async c => {
  await requireRole(c, ['admin']);
  const { constants } = (c.get('body').args ?? {}) as { constants?: Record<string, unknown> };
  const allowed = Object.keys(TT_DEFAULTS).map(k => k.toLowerCase());
  const upserts: { key: string; value: string; updated_at: string }[] = [];
  for (const [k, v] of Object.entries(constants ?? {})) {
    if (!allowed.includes(k.toLowerCase())) continue;
    upserts.push({ key: 'payroll_' + k.toLowerCase(), value: String(v), updated_at: new Date().toISOString() });
  }
  if (!upserts.length) return c.json({ success: false, message: 'No valid constants provided' });
  const { error } = await sb.from('settings').upsert(upserts, { onConflict: 'key' });
  if (error) return c.json({ success: false, message: error.message });
  invalidateSettingsCache();
  const settingsMap = await getAllSettings();
  TT_PAYROLL = _buildTtPayroll(settingsMap);
  return c.json({ success: true });
});

const UpdateEmployeePayrollSchema = z.object({
  userId:                    z.string().min(1).max(64),
  payCycle:                  zPayCycle.optional(),
  payBasis:                  zPayBasis.optional(),
  hourlyRate:                z.number().nonnegative().optional(),
  monthlySalary:             z.number().nonnegative().optional(),
  standardHoursPerDay:       z.number().min(1).max(24).optional(),
  nisApplicable:             z.boolean().optional(),
  healthSurchargeApplicable: z.boolean().optional(),
  taxResident:               z.boolean().optional(),
});

router.post('/updateEmployeePayroll', async c => {
  await requireRole(c, ['admin']);
  const v = zv(c, UpdateEmployeePayrollSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { userId, payCycle, payBasis, hourlyRate, monthlySalary, standardHoursPerDay, nisApplicable, healthSurchargeApplicable, taxResident } = v.data;
  const { error } = await sb.from('app_users').update({
    pay_cycle:                   payCycle               ?? 'monthly',
    pay_basis:                   payBasis               ?? 'salary',
    hourly_rate:                 hourlyRate             ?? 0,
    monthly_salary:              monthlySalary          ?? 0,
    standard_hours_per_day:      standardHoursPerDay    ?? 8,
    nis_applicable:              nisApplicable          !== false,
    health_surcharge_applicable: healthSurchargeApplicable !== false,
    tax_resident:                taxResident            !== false,
    updated_at:                  new Date().toISOString(),
  }).eq('id', userId);
  if (error) return c.json({ success: false, message: error.message });
  return c.json({ success: true });
});

export default router;
