/**
 * tests/unit/auth.rbac.test.ts
 *
 * Enterprise RBAC unit tests — Role-Based Access Control matrix.
 *
 * Covers every route defined in netlify/functions/routes/*.ts and verifies:
 *   1. requireRole() grants access exactly as specified per route
 *   2. superadmin bypasses ALL role checks (never appears in allow-lists)
 *   3. Unprivileged roles are denied (403 Forbidden) on elevated routes
 *   4. Unauthenticated requests are denied (401 Unauthorized) on all protected routes
 *   5. Revoked JTIs are rejected with 401
 *   6. Inactive users are rejected with 401
 *
 * Strategy: mock the Supabase client and JWT module so tests are fully offline
 * and deterministic.  requireUser/requireRole are called with fake Hono context
 * objects — no HTTP server, no real DB, no network.
 *
 * Role hierarchy (matches types/db.ts):
 *   superadmin > admin > manager > employee
 *
 * @see netlify/functions/lib/auth.ts
 */

// ── Mocks — declared before imports so Jest hoists them ───────────────────────

jest.mock('jsonwebtoken', () => ({
  sign:   jest.fn(() => 'mock.jwt.token'),
  verify: jest.fn(),
}));

jest.mock('../../netlify/functions/lib/db', () => ({
  sb: { from: jest.fn() },
}));

// ── Static imports (mocks already in effect) ──────────────────────────────────

import jwt from 'jsonwebtoken';
import type { Context } from 'hono';
import type { AppUser, UserRole } from '../../types/db';

type AnyRole = UserRole; // superadmin is now part of UserRole
import type { HonoVariables } from '../../types/api';
import { requireUser, requireRole } from '../../netlify/functions/lib/auth';

const { sb } = jest.requireMock<{ sb: { from: jest.Mock } }>('../../netlify/functions/lib/db');

// ── Types ─────────────────────────────────────────────────────────────────────

type Guard = 'user' | string[];

interface RouteSpec {
  route: string;
  guard: Guard;
}

// ── Route access matrix ───────────────────────────────────────────────────────
//
// guard: 'user'    → requireUser (any authenticated user)
//        string[]  → requireRole(c, roles) — those roles + superadmin always passes

const ROUTE_MATRIX: RouteSpec[] = [
  // Attendance
  { route: 'POST /markAttendance',             guard: 'user'                  },
  { route: 'POST /getMyStatus',                guard: 'user'                  },
  { route: 'POST /getMyHistory',               guard: 'user'                  },
  { route: 'POST /getMyChart',                 guard: 'user'                  },
  { route: 'POST /getAdminStats',              guard: ['admin', 'manager']    },
  { route: 'POST /getRecentAttendance',        guard: ['admin', 'manager']    },
  { route: 'POST /listAttendance',             guard: ['admin', 'manager']    },
  { route: 'POST /listDailyLog',               guard: ['admin', 'manager']    },
  { route: 'POST /getLiveAttendance',          guard: ['admin', 'manager']    },
  { route: 'POST /getDashboardCharts',         guard: ['admin', 'manager']    },
  { route: 'POST /getDeptStats',               guard: ['manager', 'admin']    },
  { route: 'POST /getDeptEmployees',           guard: ['manager', 'admin']    },
  // Auth
  { route: 'POST /get2faStatus',               guard: 'user'                  },
  { route: 'POST /disable2fa',                 guard: 'user'                  },
  { route: 'POST /logout',                     guard: 'user'                  },
  { route: 'POST /updateColorScheme',          guard: 'user'                  },
  { route: 'POST /updateLayoutMode',           guard: 'user'                  },
  { route: 'POST /updateMyProfile',            guard: 'user'                  },
  { route: 'POST /verifyPassword',             guard: 'user'                  },
  // Departments
  { route: 'POST /listDepartments',            guard: 'user'                  },
  { route: 'POST /addDepartment',              guard: ['admin']               },
  { route: 'POST /updateDepartment',           guard: ['admin']               },
  { route: 'POST /deleteDepartment',           guard: ['admin']               },
  // Employees
  { route: 'POST /listEmployees',              guard: ['admin', 'manager']    },
  { route: 'POST /addEmployee',                guard: ['admin']               },
  { route: 'POST /updateEmployee',             guard: ['admin']               },
  { route: 'POST /deleteEmployee',             guard: ['admin']               },
  { route: 'POST /getEmployeeByUsername',      guard: 'user'                  },
  { route: 'POST /listManagers',               guard: ['admin']               },
  // Leaves
  { route: 'POST /submitLeave',                guard: 'user'                  },
  { route: 'POST /getMyLeaves',                guard: 'user'                  },
  { route: 'POST /getLeaveById',               guard: 'user'                  },
  { route: 'POST /updateLeave',                guard: 'user'                  },
  { route: 'POST /deleteLeave',                guard: 'user'                  },
  { route: 'POST /approveLeave',               guard: ['admin', 'manager']    },
  { route: 'POST /rejectLeave',                guard: ['admin', 'manager']    },
  { route: 'POST /listAllLeaves',              guard: ['admin']               },
  { route: 'POST /getPendingLeavesForManager', guard: ['manager', 'admin']    },
  // Messages
  { route: 'POST /sendMessage',                guard: 'user'                  },
  { route: 'POST /getMessages',                guard: 'user'                  },
  { route: 'POST /replyMessage',               guard: 'user'                  },
  { route: 'POST /markMessageRead',            guard: 'user'                  },
  { route: 'POST /deleteMessage',              guard: 'user'                  },
  { route: 'POST /getEmployeesForMsg',         guard: 'user'                  },
  // Notifications
  { route: 'POST /getNotifications',           guard: 'user'                  },
  { route: 'POST /markNotificationsRead',      guard: 'user'                  },
  { route: 'POST /getHeaderCounts',            guard: 'user'                  },
  // Payroll
  { route: 'POST /listHourlyRates',            guard: ['admin']               },
  { route: 'POST /updateHourlyRate',           guard: ['admin']               },
  { route: 'POST /bulkImportRates',            guard: ['admin']               },
  { route: 'POST /getPayrollEmployees',        guard: ['admin', 'manager']    },
  { route: 'POST /getPayroll',                 guard: ['admin', 'manager']    },
  { route: 'POST /listPayrollRun',             guard: ['admin', 'manager']    },
  { route: 'POST /approvePayroll',             guard: ['admin', 'manager']    },
  { route: 'POST /getMyPayslips',              guard: 'user'                  },
  { route: 'POST /getPayrollConstants',        guard: ['admin']               },
  { route: 'POST /savePayrollConstants',       guard: ['admin']               },
  { route: 'POST /updateEmployeePayroll',      guard: ['admin']               },
  // Settings
  { route: 'POST /getSettings',               guard: 'user'                  },
  { route: 'POST /updateSetting',             guard: ['admin']               },
  { route: 'POST /getWorkHours',              guard: 'user'                  },
  { route: 'POST /saveWorkHours',             guard: ['admin']               },
  { route: 'POST /uploadLogo',                guard: ['admin']               },
  // getSignedUrls / getUploadUrl removed — unused generic storage endpoints with
  // no path/bucket scoping (IDOR risk). See settings.ts.
  // Project Sites
  { route: 'POST /listProjectSites',          guard: 'user'                  },
  { route: 'POST /addProjectSite',            guard: ['admin']               },
  { route: 'POST /updateProjectSite',         guard: ['admin']               },
  { route: 'POST /deleteProjectSite',         guard: ['admin']               },
  { route: 'POST /assignSiteEmployees',       guard: ['admin']               },
  // Tickets
  { route: 'POST /createTicket',              guard: 'user'                  },
  { route: 'POST /getTickets',                guard: 'user'                  },
  { route: 'POST /replyTicket',               guard: 'user'                  },
  { route: 'POST /updateTicketStatus',        guard: 'user'                  },
  { route: 'POST /deleteTicket',              guard: 'user'                  },
  { route: 'POST /clearClosedTickets',        guard: 'user'                  },
];

const NON_SUPER_ROLES: AnyRole[] = ['admin', 'manager', 'employee'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeUser(role: AnyRole): AppUser {
  return {
    id:                          `user-${role}`,
    username:                    role,
    role,
    status:                      'active',
    full_name:                   `Test ${role}`,
    department_id:               null,
    password_hash:               'hashed',
    position:                    null,
    email:                       `${role}@test.com`,
    phone:                       null,
    employee_number:             null,
    profile_image:               null,
    signed_url:                  null,
    signed_url_expires_at:       null,
    color_scheme:                null,
    layout_mode:                 null,
    totp_secret:                 null,
    totp_enabled:                false,
    totp_enrolled_at:            null,
    backup_codes:                null,
    pay_cycle:                   null,
    pay_basis:                   null,
    hourly_rate:                 null,
    monthly_salary:              null,
    standard_hours_per_day:      null,
    nis_applicable:              null,
    health_surcharge_applicable: null,
    tax_resident:                null,
    created_at:                  new Date().toISOString(),
    updated_at:                  null,
  } as unknown as AppUser;
}

/** Build a minimal Hono-like context with the given auth payload. */
function makeCtx(auth: Record<string, unknown> | null): Context<{ Variables: HonoVariables }> {
  const store: Record<string, unknown> = { auth, body: {} };
  return {
    get:  (key: string) => store[key],
    set:  (key: string, val: unknown) => { store[key] = val; },
    req:  { header: () => null },
  } as unknown as Context<{ Variables: HonoVariables }>;
}

/** Wire Supabase mock: token_revocations returns no hit; app_users returns the given user. */
function mockDb(user: AppUser | null, revokedJti?: string): void {
  sb.from.mockImplementation((table: string) => {
    if (table === 'token_revocations') {
      return {
        select: () => ({
          eq: (_col: string, val: string) => ({
            maybeSingle: async () => ({
              data: revokedJti && val === revokedJti ? { jti: revokedJti } : null,
            }),
          }),
        }),
      };
    }
    if (table === 'app_users') {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: user, error: user ? null : new Error('not found') }),
          }),
        }),
      };
    }
    return {};
  });
}

/** Set up JWT mock and DB for a role; return the fake context. */
function setupForRole(role: AnyRole): Context<{ Variables: HonoVariables }> {
  const user = makeUser(role);
  const authPayload = {
    sub: user.id, username: user.username, role: user.role,
    jti: 'test-jti-uuid',
    exp: Math.floor(Date.now() / 1000) + 900,
  };
  mockDb(user);
  (jwt.verify as jest.Mock).mockReturnValue(authPayload);
  return makeCtx(authPayload);
}

/** Attempt a guarded call; never throws — returns { granted, status?, message? }. */
async function attempt(
  guard: Guard,
  ctx: Context<{ Variables: HonoVariables }>,
): Promise<{ granted: boolean; status?: number; message?: string }> {
  try {
    if (guard === 'user') await requireUser(ctx);
    else                  await requireRole(ctx, guard as string[]);
    return { granted: true };
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    return { granted: false, status: e.status, message: e.message };
  }
}

// ── Reset mocks between tests ─────────────────────────────────────────────────

beforeEach(() => jest.clearAllMocks());

// ── 1. Core requireRole logic ─────────────────────────────────────────────────

describe('requireRole — core logic', () => {

  it('grants access when role is in the allowed list', async () => {
    const ctx = setupForRole('admin');
    expect((await attempt(['admin'], ctx)).granted).toBe(true);
  });

  it('denies (403) when role is NOT in the allowed list', async () => {
    const ctx = setupForRole('employee');
    const res = await attempt(['admin'], ctx);
    expect(res.granted).toBe(false);
    expect(res.status).toBe(403);
    expect(res.message).toBe('Forbidden');
  });

  it('superadmin bypasses a single-role restriction', async () => {
    const ctx = setupForRole('superadmin');
    expect((await attempt(['admin'],    ctx)).granted).toBe(true);
    expect((await attempt(['manager'],  ctx)).granted).toBe(true);
    expect((await attempt(['employee'], ctx)).granted).toBe(true);
  });

  it('superadmin passes multi-role restrictions', async () => {
    const ctx = setupForRole('superadmin');
    expect((await attempt(['admin', 'manager'], ctx)).granted).toBe(true);
  });

  it('manager passes [admin, manager] routes', async () => {
    const ctx = setupForRole('manager');
    expect((await attempt(['admin', 'manager'], ctx)).granted).toBe(true);
  });

  it('employee is blocked on admin-only routes', async () => {
    const ctx = setupForRole('employee');
    const res = await attempt(['admin'], ctx);
    expect(res.granted).toBe(false);
    expect(res.status).toBe(403);
  });

  it('employee is blocked on manager+admin routes', async () => {
    const ctx = setupForRole('employee');
    const res = await attempt(['admin', 'manager'], ctx);
    expect(res.granted).toBe(false);
    expect(res.status).toBe(403);
  });
});

// ── 2. Unauthenticated requests ───────────────────────────────────────────────

describe('requireUser / requireRole — unauthenticated', () => {

  it('requireUser returns 401 when auth context is null', async () => {
    const res = await attempt('user', makeCtx(null));
    expect(res.granted).toBe(false);
    expect(res.status).toBe(401);
    expect(res.message).toBe('Unauthorized');
  });

  it('requireRole returns 401 when auth context is null', async () => {
    const res = await attempt(['admin'], makeCtx(null));
    expect(res.granted).toBe(false);
    expect(res.status).toBe(401);
  });
});

// ── 3. Token revocation ───────────────────────────────────────────────────────

describe('Token revocation', () => {

  it('revoked JTI is rejected with 401', async () => {
    const user = makeUser('admin');
    const REVOKED_JTI = 'revoked-jti-abc';
    mockDb(user, REVOKED_JTI);
    (jwt.verify as jest.Mock).mockReturnValue({
      sub: user.id, username: user.username, role: user.role,
      jti: REVOKED_JTI,
      exp: Math.floor(Date.now() / 1000) + 900,
    });
    const ctx = makeCtx({ sub: user.id, username: user.username, role: user.role, jti: REVOKED_JTI });
    const res = await attempt('user', ctx);
    expect(res.granted).toBe(false);
    expect(res.status).toBe(401);
  });
});

// ── 4. Inactive user ──────────────────────────────────────────────────────────

describe('User status', () => {

  it('inactive user is rejected with 401', async () => {
    const user = { ...makeUser('admin'), status: 'inactive' } as unknown as AppUser;
    mockDb(user);
    (jwt.verify as jest.Mock).mockReturnValue({
      sub: user.id, username: user.username, role: user.role,
      jti: 'test-jti', exp: Math.floor(Date.now() / 1000) + 900,
    });
    const ctx = makeCtx({ sub: user.id, username: user.username, role: user.role, jti: 'test-jti' });
    const res = await attempt('user', ctx);
    expect(res.granted).toBe(false);
    expect(res.status).toBe(401);
  });
});

// ── 5. Full role × route matrix ───────────────────────────────────────────────

describe('Role × Route access matrix', () => {
  for (const { route, guard } of ROUTE_MATRIX) {
    describe(route, () => {

      it('UNAUTHENTICATED → 401', async () => {
        const res = await attempt(guard, makeCtx(null));
        expect(res.granted).toBe(false);
        expect(res.status).toBe(401);
      });

      it('superadmin → GRANTED', async () => {
        const ctx = setupForRole('superadmin');
        expect((await attempt(guard, ctx)).granted).toBe(true);
      });

      for (const role of NON_SUPER_ROLES) {
        const shouldGrant = guard === 'user' || (guard as string[]).includes(role);
        const label       = shouldGrant ? 'GRANTED' : 'DENIED (403)';

        it(`${role} → ${label}`, async () => {
          const ctx = setupForRole(role);
          const res = await attempt(guard, ctx);
          if (shouldGrant) {
            expect(res.granted).toBe(true);
          } else {
            expect(res.granted).toBe(false);
            expect(res.status).toBe(403);
          }
        });
      }
    });
  }
});

// ── 6. Role escalation prevention ────────────────────────────────────────────

describe('Role escalation — lower roles cannot access admin-only routes', () => {

  const adminOnly = ROUTE_MATRIX.filter(r =>
    Array.isArray(r.guard) && r.guard.length === 1 && r.guard[0] === 'admin',
  );

  it.each(adminOnly.flatMap(({ route, guard }) => [
    [`employee`, route, guard],
    [`manager`,  route, guard],
  ]))('%s cannot access %s', async (role, _route, guard) => {
    const ctx = setupForRole(role as AnyRole);
    const res = await attempt(guard as Guard, ctx);
    expect(res.granted).toBe(false);
    expect(res.status).toBe(403);
  });
});
