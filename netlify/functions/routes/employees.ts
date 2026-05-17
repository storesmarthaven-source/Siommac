import { Hono }  from 'hono';
import bcrypt     from 'bcryptjs';
import { sb }     from '../lib/db';
import { requireUser, requireRole, log_ } from '../lib/auth';
import { getProfileSignedUrl } from '../lib/photos';
import { uploadBase64 }        from '../lib/upload';
import { today, dateOnly }     from '../lib/helpers';
import { zv, AddEmployeeSchema, UpdateEmployeeSchema, DeleteEmployeeSchema, GetEmployeeSchema } from '../lib/validate';
import type { HonoVariables }  from '../../../types/api';
import type { AppUser }        from '../../../types/db';

const router = new Hono<{ Variables: HonoVariables }>();

async function _nextEmployeeNumber(): Promise<string> {
  const { data } = await sb.from('app_users')
    .select('employee_number').like('employee_number', 'EMP-%')
    .order('employee_number', { ascending: false }).limit(1);
  if (data && data.length && (data[0] as { employee_number: string }).employee_number) {
    const n = parseInt(String((data[0] as { employee_number: string }).employee_number).replace('EMP-', ''), 10);
    return `EMP-${String(n + 1).padStart(4, '0')}`;
  }
  return 'EMP-0001';
}

router.post('/listEmployees', async c => {
  await requireRole(c, ['admin', 'manager']);
  const t = today();
  const [{ data: users, error: uErr }, { data: depts, error: dErr }, { data: att }] = await Promise.all([
    sb.from('app_users').select('*').order('full_name'),
    sb.from('departments').select('id,name'),
    sb.from('attendance').select('*').eq('work_date', t),
  ]);
  if (uErr) throw new Error('Failed to load employees: ' + uErr.message);
  if (dErr) throw new Error('Failed to load departments: ' + dErr.message);

  const deptMap = Object.fromEntries(((depts ?? []) as { id: string; name: string }[]).map(d => [d.id, d.name]));
  const attMap  = Object.fromEntries(((att   ?? []) as AppUser[]).map((a: any) => [a.username, a]));
  const usersArr = (users ?? []) as AppUser[];

  const profileImages = await Promise.all(usersArr.map(u => getProfileSignedUrl(u.id, u.profile_image)));

  return c.json({ success: true, data: usersArr.map((u, i) => {
    const a = attMap[u.username] as any;
    const todayStatus = a?.check_out_time ? 'checkedout' : a?.check_in_time ? 'checkedin' : 'notchecked';
    return {
      idx: i + 1, id: u.id, username: u.username, fullName: u.full_name,
      employeeNumber: u.employee_number ?? '',
      department: deptMap[u.department_id ?? ''] ?? '', departmentId: u.department_id ?? '',
      position: u.position ?? '', role: u.role,
      status: u.status === 'active' ? 'Active' : 'Inactive',
      email: u.email ?? '', phone: u.phone ?? '',
      payCycle: u.pay_cycle ?? '',
      todayStatus, profileImage: profileImages[i] ?? '',
    };
  }) });
});

router.post('/addEmployee', async c => {
  const actor = await requireRole(c, ['admin']);
  const v = zv(c, AddEmployeeSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const args = v.data;

  const password_hash = await bcrypt.hash(args.password, 12);
  const employee_number = args.employeeNumber
    ? args.employeeNumber.trim().toUpperCase()
    : await _nextEmployeeNumber();

  if (employee_number) {
    const { data: existing } = await sb.from('app_users').select('id').eq('employee_number', employee_number).maybeSingle();
    if (existing) return c.json({ success: false, message: `Employee ID "${employee_number}" is already in use.` });
  }

  const { data, error } = await sb.from('app_users').insert({
    username: args.username, password_hash, full_name: args.fullName, role: args.role,
    department_id: args.department ?? null, position: args.position ?? null, status: 'active',
    employee_number,
    email:  args.email   ? args.email.trim()   : null,
    phone:  args.phone   ? args.phone.trim()   : null,
    pay_cycle:                   args.payCycle                  ?? 'monthly',
    pay_basis:                   args.payBasis                  ?? 'salary',
    hourly_rate:                 args.hourlyRate                ?? 0,
    monthly_salary:              args.monthlySalary             ?? 0,
    standard_hours_per_day:      args.standardHoursPerDay       ?? 8,
    nis_applicable:              args.nisApplicable             !== false,
    health_surcharge_applicable: args.healthSurchargeApplicable !== false,
    tax_resident:                args.taxResident               !== false,
  }).select('id').single<{ id: string }>();

  if (error) {
    if (error.code === '23505') {
      if (error.message.includes('username'))        return c.json({ success: false, message: `Username "${args.username}" is already taken.` });
      if (error.message.includes('employee_number')) return c.json({ success: false, message: `Employee ID "${employee_number}" is already in use.` });
    }
    return c.json({ success: false, message: error.message });
  }

  await log_(actor, 'create', 'user', data.id, args.fullName);
  return c.json({ success: true, id: data.id, employeeNumber: employee_number });
});

router.post('/updateEmployee', async c => {
  const actor = await requireRole(c, ['admin']);
  const v = zv(c, UpdateEmployeeSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const args = v.data;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (args.fullName  !== undefined) patch.full_name     = args.fullName;
  if (args.department !== undefined) patch.department_id = args.department || null;
  if (args.position   !== undefined) patch.position      = args.position || null;
  if (args.role       !== undefined) patch.role          = args.role;
  if (args.status     !== undefined) patch.status        = args.status;
  if (args.email      !== undefined) patch.email         = args.email?.trim() || null;
  if (args.phone      !== undefined) patch.phone         = args.phone?.trim() || null;
  if (args.payCycle   !== undefined) patch.pay_cycle     = args.payCycle;
  if (args.payBasis   !== undefined) patch.pay_basis     = args.payBasis;
  if (args.hourlyRate !== undefined) patch.hourly_rate   = args.hourlyRate;
  if (args.monthlySalary            !== undefined) patch.monthly_salary              = args.monthlySalary;
  if (args.standardHoursPerDay      !== undefined) patch.standard_hours_per_day      = args.standardHoursPerDay;
  if (args.nisApplicable            !== undefined) patch.nis_applicable              = args.nisApplicable;
  if (args.healthSurchargeApplicable !== undefined) patch.health_surcharge_applicable = args.healthSurchargeApplicable;
  if (args.taxResident              !== undefined) patch.tax_resident                = args.taxResident;

  if (args.password) patch.password_hash = await bcrypt.hash(args.password, 12);

  if (args.removeProfileImage) {
    patch.profile_image = '__removed__';
  } else if (args.profileImageBase64) {
    patch.profile_image = await uploadBase64('profile-photos', args.profileImageBase64, `profile_${args.username}`);
  }

  if (args.employeeNumber !== undefined) {
    const empNum = args.employeeNumber?.trim().toUpperCase() ?? '';
    if (empNum) {
      const { data: existing } = await sb.from('app_users').select('id').eq('employee_number', empNum).neq('username', args.username).maybeSingle();
      if (existing) return c.json({ success: false, message: `Employee ID "${empNum}" is already in use.` });
      patch.employee_number = empNum;
    } else {
      patch.employee_number = null;
    }
  }

  const { error } = await sb.from('app_users').update(patch).eq('username', args.username);
  if (error) {
    if (error.code === '23505' && error.message.includes('employee_number'))
      return c.json({ success: false, message: `Employee ID "${patch.employee_number}" is already in use.` });
    return c.json({ success: false, message: error.message });
  }
  await log_(actor, 'update', 'user', args.username, args.fullName ?? args.username);
  return c.json({ success: true });
});

router.post('/deleteEmployee', async c => {
  const actor = await requireRole(c, ['admin']);
  const v = zv(c, DeleteEmployeeSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { username } = v.data;

  if (actor.username === username) return c.json({ success: false, message: 'You cannot delete your own account' });

  const { data: target } = await sb.from('app_users').select('id,role').eq('username', username).maybeSingle<Pick<AppUser, 'id' | 'role'>>();
  if (!target) return c.json({ success: false, message: 'Employee not found' });

  if (target.role === 'admin') {
    const { count } = await sb.from('app_users').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('status', 'active') as unknown as { count: number };
    if (count <= 1) return c.json({ success: false, message: 'Cannot delete the last admin account' });
  }

  await Promise.all([
    sb.from('attendance').delete().eq('user_id', target.id),
    sb.from('attendance').delete().eq('username', username),
    sb.from('leave_requests').delete().eq('user_id', target.id),
    sb.from('leave_requests').delete().eq('username', username),
  ]);

  const { error } = await sb.from('app_users').delete().eq('id', target.id);
  if (error) return c.json({ success: false, message: error.message });

  await log_(actor, 'delete', 'user', username, username);
  return c.json({ success: true });
});

router.post('/getEmployeeByUsername', async c => {
  const actor = await requireUser(c);
  const v = zv(c, GetEmployeeSchema, c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const { username } = v.data;
  if (actor.role === 'employee' && actor.username !== username) return c.json(null);

  const { data: u } = await sb.from('app_users').select('*').eq('username', username).maybeSingle<AppUser>();
  if (!u) return c.json({ success: false, message: 'User not found' });

  const [profileImage, deptRow] = await Promise.all([
    getProfileSignedUrl(u.id, u.profile_image),
    u.department_id
      ? sb.from('departments').select('name').eq('id', u.department_id).maybeSingle<{ name: string }>().then(r => r.data)
      : Promise.resolve(null),
  ]);

  return c.json({ success: true, data: {
    id: u.id, username: u.username, fullName: u.full_name, role: u.role,
    employeeNumber: u.employee_number ?? '',
    departmentId: u.department_id ?? '', department: deptRow?.name ?? '',
    position: u.position ?? '', status: u.status,
    email: u.email ?? '', phone: u.phone ?? '',
    colorScheme: u.color_scheme ?? 'navy', layoutMode: u.layout_mode ?? 'sidebar',
    hourlyRate: Number(u.hourly_rate) || 0, profileImage,
    payCycle:                  u.pay_cycle                  ?? 'monthly',
    payBasis:                  u.pay_basis                  ?? 'salary',
    monthlySalary:             Number(u.monthly_salary)     || 0,
    standardHoursPerDay:       Number(u.standard_hours_per_day) || 8,
    nisApplicable:             u.nis_applicable             !== false,
    healthSurchargeApplicable: u.health_surcharge_applicable !== false,
    taxResident:               u.tax_resident               !== false,
  } });
});

router.post('/listManagers', async c => {
  await requireRole(c, ['admin']);
  const { data } = await sb.from('app_users').select('id,full_name').in('role', ['admin', 'manager']).eq('status', 'active').order('full_name');
  return c.json({ success: true, data: ((data ?? []) as { id: string; full_name: string }[]).map(u => ({ id: u.id, name: u.full_name })) });
});

export default router;
