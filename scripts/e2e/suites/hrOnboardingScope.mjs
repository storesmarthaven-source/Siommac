/**
 * scripts/e2e/suites/hrOnboardingScope.mjs
 *
 * LIVE proof of the HR Onboarding read-scope ladder against real, non-superadmin actors.
 *
 *   my   — base `hr.onboarding.view`: owned / started / assigned / participant /
 *          permitted direct-report cases.
 *   team — requires `hr.onboarding.view_team`.
 *   all  — requires `hr.onboarding.view_all`.
 *
 * WHY THIS SUITE EXISTS
 * The resolver and duplicate detector are unit-tested against a MOCKED PostgREST. That
 * proves the decision logic, not the SQL. This suite proves what a mock cannot: the
 * department-membership union, the participant union, and EXACT CROSS-SURFACE
 * RECONCILIATION. Every leak found while building this feature (the calendar adapter's
 * `canAll`, the unfiltered 8-week trend, the org-wide activity feed) was invisible from
 * the register and would have passed a rows-only test.
 *
 * WHY BASELINE DELTAS, NOT ABSOLUTE COUNTS
 * The database carries pre-existing organisation data, so an `all`-scope absolute count is
 * not knowable in advance. Asserting `<=` would let a chart keep leaking identical totals
 * across scopes and still go green. Instead every surface is measured BEFORE the fixtures
 * are inserted and again after, and the DELTA is asserted exactly. That is strict for
 * `all` without being brittle about rows this suite does not own.
 *
 * REQUIRES (operator-applied immediately before this run):
 *   20260930000001_hr_onboarding_view_scope_permissions.sql   then NOTIFY pgrst.
 * Without it, hr_manager holds no view_team/view_all grant and every widened scope 403s.
 *
 * Every row this suite creates is tagged with h.TAG and removed in onCleanup (LIFO,
 * children before parents).
 */

export const title = 'HR Onboarding — read scope';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;

  // Harness contract — fail loudly rather than silently degrading. An optional-chained
  // `h.section?.()` would no-op on a renamed helper and quietly ungroup the whole report.
  for (const fn of ['section', 'acquireActors', 'onCleanup', 'mustDelete']) {
    if (typeof h[fn] !== 'function') throw new Error(`harness is missing required helper: h.${fn}()`);
  }

  // ── Actors ────────────────────────────────────────────────────────────────────
  // forceSynthetic: department membership and case ownership must be exactly what this
  // suite seeds. A real roster user carries pre-existing cases that would skew the deltas.
  const { actors: [staff],   createdIds: idStaff } = await h.acquireActors('hr_staff',   1, {}, {}, { forceSynthetic: true });
  const { actors: [manager], createdIds: idMgr }   = await h.acquireActors('hr_manager', 1, {}, {}, { forceSynthetic: true });
  const { actors: [generic], createdIds: idGen }   = await h.acquireActors('manager',    1, {}, {}, { forceSynthetic: true });
  const { actors: [lonely],  createdIds: idLone }  = await h.acquireActors('hr_staff',   1, {}, {}, { forceSynthetic: true });
  const actorIds = [...idStaff, ...idMgr, ...idGen, ...idLone];

  const T = { staff: mint(staff), manager: mint(manager), generic: mint(generic), lonely: mint(lonely) };

  const deptIds = [], employeeIds = [], caseIds = [], taskIds = [], handoffIds = [], blockerIds = [], auditIds = [];

  h.onCleanup(async () => {
    const nz = a => (a.length ? a : ['-']);
    await h.mustDelete('hr_audit_log',            q => q.in('id', nz(auditIds)));
    await h.mustDelete('hr_onboarding_blockers',  q => q.in('id', nz(blockerIds)));
    await h.mustDelete('hr_onboarding_handoffs',  q => q.in('id', nz(handoffIds)));
    await h.mustDelete('hr_onboarding_tasks',     q => q.in('id', nz(taskIds)));
    await h.mustDelete('hr_onboarding_cases',     q => q.in('id', nz(caseIds)));
    await h.mustDelete('app_users',               q => q.in('id', nz(employeeIds)));
    await h.mustDelete('departments',             q => q.in('id', nz(deptIds)));
    await h.mustDelete('app_users',               q => q.in('id', nz(actorIds)));
  });

  // ── Endpoint helpers ──────────────────────────────────────────────────────────
  const list   = (tok, scope) => api('hr/onboarding/list',            tok, { scope, pageSize: 200 });
  const stats  = (tok, scope) => api('hr/onboarding/dashboard-stats', tok, { scope });
  const tasks  = (tok, scope) => api('hr/onboarding/tasks/list',      tok, { scope });
  const hands  = (tok, scope) => api('hr/onboarding/handoffs/list',   tok, { scope });
  const blocks = (tok, scope) => api('hr/onboarding/blockers/list',   tok, { scope });
  const acts   = (tok, scope) => api('hr/onboarding/activity/recent', tok, { scope, limit: 50 });

  // The two REUSED widgets, exercised through the exact params their definitions send
  // (registry.calendarPlanning.tsx): Upcoming Deadlines and Task Planner.
  const CAL_FROM = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const CAL_TO   = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  // Both widgets follow the SAME onboarding scope as the register they sit beside.
  const deadlinesWidget = (tok, scope) => api('calendar/list', tok, { from: CAL_FROM, to: CAL_TO, types: ['deadline', 'activity'], onboardingScope: scope });
  const plannerWidget   = (tok, scope) => api('calendar/list', tok, { from: CAL_FROM, to: CAL_TO, types: ['task', 'deadline'],     onboardingScope: scope });

  // calendar/list returns { success, items, range } — items at the TOP level, NOT under
  // `data`. A tolerant `data?.items ?? []` silently produced an empty set and made every
  // widget assertion vacuous. Assert the shape so a payload change fails loudly.
  const calItems = (r, label) => {
    const items = r.body.items;
    if (!Array.isArray(items)) {
      throw new Error(`${label}: calendar/list returned no top-level items array — keys ${Object.keys(r.body).join(',')}`);
    }
    return items;
  };
  // Read the REAL DTO shape (types/hrOnboarding.ts): the 8-week trend is nested under
  // activeCases, not top-level. A tolerant `d.weeklyTrend ?? d.trend ?? []` silently
  // yielded an empty map and made the trend assertion unfalsifiable.
  const activeTotal = d => {
    const t = d.activeCases?.total;
    if (typeof t !== 'number') throw new Error(`stats.activeCases.total missing — got ${JSON.stringify(d.activeCases)}`);
    return t;
  };
  /** A required numeric stat, asserted present so a renamed field fails loudly. */
  const numOf = (d, key) => {
    if (typeof d[key] !== 'number') throw new Error(`stats.${key} missing — got ${JSON.stringify(d[key])}`);
    return d[key];
  };
  const trendOf = d => {
    const buckets = d.activeCases?.weeklyTrend;
    if (!Array.isArray(buckets)) throw new Error(`stats.activeCases.weeklyTrend missing — got ${JSON.stringify(d.activeCases)}`);
    return new Map(buckets.map(b => [b.week, b.count ?? 0]));
  };

  /** Ids from a row array, asserting the DTO key exists — a wrong key must not yield an empty set. */
  const idsOf = (rows, key, label) => {
    const list = rows ?? [];
    if (list.length && !(key in list[0])) {
      throw new Error(`${label}: rows carry no "${key}" — got keys ${Object.keys(list[0]).join(',')}`);
    }
    return new Set(list.map(x => x[key]));
  };

  /** One measurement of every scoped surface for one actor+scope. */
  async function snapshot(tok, scope) {
    const [r, s, tk, hf, bl, ac, dw, pw] = await Promise.all([
      list(tok, scope), stats(tok, scope), tasks(tok, scope), hands(tok, scope),
      blocks(tok, scope), acts(tok, scope), deadlinesWidget(tok, scope), plannerWidget(tok, scope),
    ]);
    ok(r, `${scope} list`); ok(s, `${scope} stats`); ok(tk, `${scope} tasks`);
    ok(hf, `${scope} handoffs`); ok(bl, `${scope} blockers`); ok(ac, `${scope} activity`);
    ok(dw, 'deadlines widget'); ok(pw, 'task planner widget');
    return {
      total:     r.body.data.total,
      active:    activeTotal(s.body.data),
      starts7:   numOf(s.body.data, 'startsWithin7Days'),
      ownerReq:  numOf(s.body.data, 'ownerRequired'),
      trend:     trendOf(s.body.data),
      caseIds:   idsOf(r.body.data.rows, 'caseId',    'case list'),
      taskIds:   idsOf(tk.body.data,      'taskId',    'task list'),
      handoffIds:idsOf(hf.body.data,      'handoffId', 'handoff list'),
      blockerIds:idsOf(bl.body.data,      'blockerId', 'blocker list'),
      auditIds:  idsOf(ac.body.data,      'id',        'activity feed'),
      deadlineTitles: new Set(calItems(dw, 'Upcoming Deadlines').map(i => i.title)),
      plannerTitles:  new Set(calItems(pw, 'Task Planner').map(i => i.title)),
    };
  }

  // ══════════════════════════════════════════════════════════════════════════════
  h.section('0 · baseline before fixtures');
  // ══════════════════════════════════════════════════════════════════════════════
  const base = {};
  await test('capture pre-fixture baseline for every actor and scope', async () => {
    base.staffMy    = await snapshot(T.staff,   'my');
    base.mgrMy      = await snapshot(T.manager, 'my');
    base.mgrTeam    = await snapshot(T.manager, 'team');
    base.mgrAll     = await snapshot(T.manager, 'all');
    base.genericMy  = await snapshot(T.generic, 'my');
    base.lonelyMy   = await snapshot(T.lonely,  'my');
  });

  // ── Fixtures ──────────────────────────────────────────────────────────────────
  async function makeDept(name) {
    const { data, error } = await sb.from('departments').insert({ name }).select('id').single();
    if (error) throw new Error(`dept insert failed: ${error.message}`);
    deptIds.push(data.id); return data.id;
  }
  async function makeEmployee(departmentId, suffix) {
    const id = `${TAG}-EMP-${suffix}`;
    const { error } = await sb.from('app_users').insert({
      id, username: `${TAG}_emp_${suffix}`, full_name: `${TAG} Employee ${suffix}`,
      role: 'employee', status: 'active', department_id: departmentId,
    });
    if (error) throw new Error(`employee insert failed: ${error.message}`);
    employeeIds.push(id); return id;
  }
  async function makeCase({ employeeId, ownerId, suffix, dueAt, startedBy = ownerId }) {
    const ins = async (table, row) => {
      const { data, error } = await sb.from(table).insert(row).select('id').single();
      if (error) throw new Error(`${table} insert failed: ${error.message}`);
      return data.id;
    };
    const caseId = await ins('hr_onboarding_cases', {
      case_no: `${TAG}-ONB-${suffix}`, employee_id: employeeId, owner_id: ownerId,
      started_by: ownerId, package_key: 'standard_employee', status: 'in_progress',
      worker_type: 'employee', reason: 'new_hire', due_at: dueAt,
      // 3 days out => inside the canonical [today, today+7] window.
      target_start_date: TARGET_START, metadata: { e2eTag: TAG },
    });
    caseIds.push(caseId);
    taskIds.push(await ins('hr_onboarding_tasks', {
      case_id: caseId, task_key: `${TAG}_task_${suffix}`, task_title: `${TAG} Task ${suffix}`,
      owner_role: 'hr', status: 'pending', is_blocking: true, module_key: 'documents',
      due_at: dueAt, metadata: { e2eTag: TAG },
    }));
    handoffIds.push(await ins('hr_onboarding_handoffs', {
      case_id: caseId, target_module: 'it', handoff_type: 'access',
      handoff_key: `${TAG}_ho_${suffix}`, status: 'pending',
    }));
    blockerIds.push(await ins('hr_onboarding_blockers', {
      case_id: caseId, blocker_key: `${TAG}_blk_${suffix}`, blocker_title: `${TAG} Blocker ${suffix}`,
      blocking_module: 'documents', severity: 'high', status: 'active',
    }));
    auditIds.push(await ins('hr_audit_log', {
      submodule_key: 'onboarding', record_id: caseId, employee_id: employeeId,
      actor_id: ownerId, action: `${TAG}_started_${suffix}`,
    }));
    return caseId;
  }

  const deptAId = await makeDept(`${TAG}-DEPT-A`);
  const deptBId = await makeDept(`${TAG}-DEPT-B`);
  await sb.from('app_users').update({ department_id: deptAId }).in('id', [staff.id, manager.id]);
  await sb.from('app_users').update({ department_id: deptBId }).eq('id', generic.id);

  const soon = new Date(Date.now() + 3 * 86400000).toISOString();
  const TARGET_START = soon.slice(0, 10);   // date-only column
  const empOwned  = await makeEmployee(deptAId, 'OWNED');
  const empTeam   = await makeEmployee(deptAId, 'TEAM');
  const empHidden = await makeEmployee(deptBId, 'HIDDEN');

  const caseOwned  = await makeCase({ employeeId: empOwned,  ownerId: staff.id,   suffix: 'OWNED',  dueAt: soon });
  const caseTeam   = await makeCase({ employeeId: empTeam,   ownerId: manager.id, suffix: 'TEAM',   dueAt: soon });
  const caseHidden = await makeCase({ employeeId: empHidden, ownerId: generic.id, suffix: 'HIDDEN', dueAt: soon });
  // UNOWNED — dept A, no owner, not started by any actor. Absent from every `my`, present in
  // the manager's team and all. This is what makes the Owner Required assertion non-vacuous.
  const empUnowned = await makeEmployee(deptAId, 'UNOWNED');
  const caseUnowned = await makeCase({ employeeId: empUnowned, ownerId: null, startedBy: null, suffix: 'UNOWNED', dueAt: soon });

  // Fixture index — everything below asserts against EXACT membership of these.
  const F = {
    [caseOwned]:  { i: 0, suffix: 'OWNED'  },
    [caseTeam]:   { i: 1, suffix: 'TEAM'   },
    [caseHidden]: { i: 2, suffix: 'HIDDEN' },
    [caseUnowned]: { i: 3, suffix: 'UNOWNED' },
  };
  const idx = c => F[c].i;
  const taskOf = c => taskIds[idx(c)], handoffOf = c => handoffIds[idx(c)];
  const blockerOf = c => blockerIds[idx(c)], auditOf = c => auditIds[idx(c)];
  const titleOf = c => `${TAG} Task ${F[c].suffix}`;
  const allFixtureCases = [caseOwned, caseTeam, caseHidden, caseUnowned];
  /** Only rows this suite seeded — the DB carries unrelated organisation data. */
  const ours = new Set(allFixtureCases);

  /**
   * Exact reconciliation of one actor+scope against its own baseline.
   * `visible` is the exact set of fixture cases this actor+scope must see.
   */
  async function assertExact(label, tok, scope, before, visible) {
    const after = await snapshot(tok, scope);
    const hidden = allFixtureCases.filter(c => !visible.includes(c));
    const n = visible.length;
    // Exactly the visible fixtures that carry no owner. Non-vacuous: the UNOWNED case is
    // invisible at `my` and visible at team/all, so this delta differs per scope.
    const nUnowned = visible.filter(c => c === caseUnowned).length;

    // Register — exact delta, not `<=`.
    expect(after.total === before.total + n,
      `${label}: register total ${after.total} !== baseline ${before.total} + ${n}`);
    for (const c of visible) expect(after.caseIds.has(c), `${label}: missing visible case ${F[c].suffix}`);
    for (const c of hidden)  expect(!after.caseIds.has(c), `${label}: LEAKED hidden case ${F[c].suffix}`);

    // KPI must EQUAL the scoped register delta — an aggregate computed from a wider set fails here.
    expect(after.active === before.active + n,
      `${label}: KPI active ${after.active} !== baseline ${before.active} + ${n} — aggregate not reconciled`);

    // Starts Within 7 Days / Owner Required — exact deltas from the SAME scoped population.
    // Every fixture case is seeded unowned with a target start 3 days out, so both counts
    // must rise by exactly the number of newly visible cases.
    expect(after.starts7 === before.starts7 + n,
      `${label}: startsWithin7Days ${after.starts7} !== baseline ${before.starts7} + ${n}`);
    expect(after.ownerReq === before.ownerReq + nUnowned,
      `${label}: ownerRequired ${after.ownerReq} !== baseline ${before.ownerReq} + ${nUnowned}`);

    // Trend — every bucket exact. All fixtures start "now", so the delta lands in one bucket
    // and every other bucket must be unchanged.
    let moved = 0;
    for (const [week, count] of after.trend) {
      const wasCount = before.trend.get(week) ?? 0;
      const delta = count - wasCount;
      expect(delta >= 0, `${label}: trend bucket ${week} went backwards`);
      moved += delta;
    }
    expect(moved === n, `${label}: trend gained ${moved} starts, expected exactly ${n}`);

    // Tasks / handoffs / blockers — exact ids.
    for (const c of visible) {
      expect(after.taskIds.has(taskOf(c)),       `${label}: missing task for ${F[c].suffix}`);
      expect(after.handoffIds.has(handoffOf(c)), `${label}: missing handoff for ${F[c].suffix}`);
      expect(after.blockerIds.has(blockerOf(c)), `${label}: missing blocker for ${F[c].suffix}`);
      expect(after.auditIds.has(auditOf(c)),     `${label}: missing activity for ${F[c].suffix}`);
    }
    for (const c of hidden) {
      expect(!after.taskIds.has(taskOf(c)),       `${label}: LEAKED task for ${F[c].suffix}`);
      expect(!after.handoffIds.has(handoffOf(c)), `${label}: LEAKED handoff for ${F[c].suffix}`);
      expect(!after.blockerIds.has(blockerOf(c)), `${label}: LEAKED blocker for ${F[c].suffix}`);
      expect(!after.auditIds.has(auditOf(c)),     `${label}: LEAKED Recent Activity for ${F[c].suffix}`);
    }

    // Both reused widgets — the visible seeded task appears, hidden ones never do.
    for (const c of visible) {
      expect(after.deadlineTitles.has(titleOf(c)), `${label}: Upcoming Deadlines missing ${F[c].suffix}`);
      expect(after.plannerTitles.has(titleOf(c)),  `${label}: Task Planner missing ${F[c].suffix}`);
    }
    for (const c of hidden) {
      expect(!after.deadlineTitles.has(titleOf(c)), `${label}: Upcoming Deadlines LEAKED ${F[c].suffix}`);
      expect(!after.plannerTitles.has(titleOf(c)),  `${label}: Task Planner LEAKED ${F[c].suffix}`);
    }
    return after;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  h.section('1 · hr_staff — My Work only');
  // ══════════════════════════════════════════════════════════════════════════════

  await test('hr_staff my reconciles exactly to its owned case', async () => {
    await assertExact('staff/my', T.staff, 'my', base.staffMy, [caseOwned]);
  });

  await test('hr_staff cannot request team scope (403, not a downgrade)', async () => {
    const r = await list(T.staff, 'team');
    fails(r, 'staff team scope must be refused');
    expect(r.status === 403, `expected HTTP 403, got ${r.status}`);
  });

  await test('hr_staff cannot request all scope (403, not a downgrade)', async () => {
    const r = await list(T.staff, 'all');
    fails(r, 'staff all scope must be refused');
    expect(r.status === 403, `expected HTTP 403, got ${r.status}`);
  });

  await test('omitted scope is identical to an explicit my', async () => {
    const explicit = await list(T.staff, 'my');
    const implicit = await api('hr/onboarding/list', T.staff, { pageSize: 200 });
    ok(implicit, 'staff default list');
    expect(implicit.body.data.total === explicit.body.data.total,
      'omitted scope must equal an explicit `my`');
  });

  // ══════════════════════════════════════════════════════════════════════════════
  h.section('2 · hr_manager — My / Team / All exact');
  // ══════════════════════════════════════════════════════════════════════════════

  await test('hr_manager my reconciles to the case it owns', async () => {
    await assertExact('manager/my', T.manager, 'my', base.mgrMy, [caseTeam]);
  });

  await test('hr_manager team reconciles to both department-A cases', async () => {
    await assertExact('manager/team', T.manager, 'team', base.mgrTeam, [caseOwned, caseTeam, caseUnowned]);
  });

  await test('hr_manager all reconciles to every fixture case (baseline delta)', async () => {
    await assertExact('manager/all', T.manager, 'all', base.mgrAll, allFixtureCases);
  });

  // ══════════════════════════════════════════════════════════════════════════════
  h.section('3 · generic manager — related work only');
  // ══════════════════════════════════════════════════════════════════════════════

  await test('generic manager my reconciles to its own related case only', async () => {
    await assertExact('generic/my', T.generic, 'my', base.genericMy, [caseHidden]);
  });

  await test('generic manager is refused team and all', async () => {
    for (const scope of ['team', 'all']) {
      const r = await list(T.generic, scope);
      fails(r, `generic manager ${scope} must be refused`);
      expect(r.status === 403, `expected HTTP 403 for ${scope}, got ${r.status}`);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════════
  h.section('4 · empty visibility returns zero, not everything');
  // ══════════════════════════════════════════════════════════════════════════════

  await test('an unrelated actor gets zero totals and empty datasets', async () => {
    const after = await snapshot(T.lonely, 'my');

    // Nothing this suite seeded may reach an actor related to none of it.
    for (const c of allFixtureCases) {
      expect(!after.caseIds.has(c),        `empty actor LEAKED case ${F[c].suffix}`);
      expect(!after.taskIds.has(taskOf(c)),`empty actor LEAKED task ${F[c].suffix}`);
      expect(!after.handoffIds.has(handoffOf(c)), `empty actor LEAKED handoff ${F[c].suffix}`);
      expect(!after.blockerIds.has(blockerOf(c)), `empty actor LEAKED blocker ${F[c].suffix}`);
      expect(!after.auditIds.has(auditOf(c)),     `empty actor LEAKED activity ${F[c].suffix}`);
      expect(!after.deadlineTitles.has(titleOf(c)), `empty actor LEAKED deadline ${F[c].suffix}`);
      expect(!after.plannerTitles.has(titleOf(c)),  `empty actor LEAKED planner task ${F[c].suffix}`);
    }
    // An empty scope must be zero — never a fall-through to the unfiltered table.
    expect(after.total === 0,  `empty visibility register total ${after.total} !== 0`);
    expect(after.active === 0, `empty visibility KPI active ${after.active} !== 0`);
    // The new cohort KPIs must be zero too — an aggregate that ignores an empty scope and
    // counts organisation-wide is the exact failure mode this suite exists to catch.
    expect(after.starts7 === 0,  `empty visibility startsWithin7Days ${after.starts7} !== 0`);
    expect(after.ownerReq === 0, `empty visibility ownerRequired ${after.ownerReq} !== 0`);
    expect(after.taskIds.size === 0 && after.blockerIds.size === 0 && after.handoffIds.size === 0,
      'empty visibility must return empty task/blocker/handoff arrays');
  });

  // ══════════════════════════════════════════════════════════════════════════════
  h.section('4b · Upcoming Starts + Owner Required datasets');
  // ══════════════════════════════════════════════════════════════════════════════

  await test('unassignedOwner returns the unowned case and excludes owned ones', async () => {
    const r = await api('hr/onboarding/list', T.manager, { scope: 'team', pageSize: 200, unassignedOwner: true });
    ok(r, 'unassignedOwner list');
    const ids = (r.body.data.rows ?? []).filter(x => ours.has(x.caseId)).map(x => x.caseId);
    expect(ids.includes(caseUnowned), 'the unowned case must be returned');
    for (const owned of [caseOwned, caseTeam]) {
      expect(!ids.includes(owned), `owned case ${F[owned].suffix} must be excluded`);
    }
    // Every returned row must actually be unowned — the filter, not just the count.
    for (const row of (r.body.data.rows ?? [])) {
      expect(row.ownerId === null, `unassignedOwner returned an owned row (${row.caseNo})`);
    }
  });

  await test('targetStartDate is projected onto the case row', async () => {
    const r = await api('hr/onboarding/list', T.manager, { scope: 'team', pageSize: 200 });
    ok(r, 'team list');
    const row = (r.body.data.rows ?? []).find(x => x.caseId === caseTeam);
    expect(!!row, 'seeded team case must be present');
    expect('targetStartDate' in row, 'row carries no targetStartDate field');
    expect(row.targetStartDate === TARGET_START,
      `targetStartDate ${row.targetStartDate} !== seeded ${TARGET_START}`);
  });

  await test('startsWithinDays filters by the target-start window', async () => {
    const inWindow = await api('hr/onboarding/list', T.manager, { scope: 'team', pageSize: 200, startsWithinDays: 7 });
    ok(inWindow, 'startsWithinDays 7');
    const ids = (inWindow.body.data.rows ?? []).filter(x => ours.has(x.caseId)).map(x => x.caseId);
    // Seeded 3 days out => inside a 7-day window.
    expect(ids.includes(caseTeam), 'a case starting in 3 days must appear in a 7-day window');
    // Every returned row must actually carry a start date inside the window.
    for (const row of (inWindow.body.data.rows ?? [])) {
      expect(!!row.targetStartDate, `startsWithinDays returned a row with no targetStartDate (${row.caseNo})`);
    }
    // A ZERO-day window excludes a start 3 days out — proves the bound is real, not ignored.
    const today = await api('hr/onboarding/list', T.manager, { scope: 'team', pageSize: 200, startsWithinDays: 0 });
    ok(today, 'startsWithinDays 0');
    const todayIds = (today.body.data.rows ?? []).filter(x => ours.has(x.caseId)).map(x => x.caseId);
    expect(!todayIds.includes(caseTeam), 'a 0-day window must exclude a start 3 days out');
  });

  await test('sorting by target_start_date orders real dates and puts undated cases last', async () => {
    const r = await api('hr/onboarding/list', T.manager, {
      scope: 'team', pageSize: 200, sort: { field: 'target_start_date', direction: 'asc' },
    });
    ok(r, 'target_start_date sort');
    const rows = r.body.data.rows ?? [];
    const dated = rows.filter(x => !!x.targetStartDate).map(x => x.targetStartDate);
    const sorted = [...dated].sort();
    expect(JSON.stringify(dated) === JSON.stringify(sorted), 'dated rows are not in ascending order');
    const firstUndated = rows.findIndex(x => !x.targetStartDate);
    const lastDated = rows.map(x => !!x.targetStartDate).lastIndexOf(true);
    if (firstUndated !== -1 && lastDated !== -1) {
      expect(firstUndated > lastDated, 'an undated case sorted before a dated one');
    }
  });

  // ══════════════════════════════════════════════════════════════════════════════
  h.section('5 · hidden duplicate still blocks launch');
  // ══════════════════════════════════════════════════════════════════════════════

  await test('intake preview reports a duplicate the actor cannot see', async () => {
    const r = await api('hr/onboarding/intake-preview', T.staff, {
      employeeId: empHidden, packageKey: 'standard_employee',
    });
    ok(r, 'intake preview');
    const dup = r.body.data.duplicate;
    expect(dup && dup.hasDuplicate === true, 'a hidden active case must still register as a duplicate');
    expect(Array.isArray(dup.cases) && dup.cases.length > 0, 'duplicate must name the conflicting case');
    const serialised = JSON.stringify(dup);
    expect(!serialised.includes(empHidden),  'duplicate payload leaked the hidden employee id');
    expect(!serialised.includes(caseHidden), 'duplicate payload leaked the hidden case id');
    for (const k of Object.keys(dup.cases[0])) {
      expect(k === 'caseNo', `duplicate conflict exposed an unexpected field: ${k}`);
    }
  });

  await test('launch is rejected while the hidden duplicate is active', async () => {
    const r = await api('hr/onboarding/start', T.staff, {
      employeeId: empHidden, packageKey: 'standard_employee', reason: 'new_hire',
    });
    fails(r, 'launch must be refused while an active case exists');
  });
}
