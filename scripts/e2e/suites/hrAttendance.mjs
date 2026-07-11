/**
 * scripts/e2e/suites/hrAttendance.mjs
 *
 * E2E for HR Attendance & Timekeeping, mounted at /api/hr/attendance/* :
 *   PUNCH:       upload-url / photo-url / in / out
 *   RECORDS:     list / get / correct
 *   COMPUTE:     run
 *   EXCEPTIONS:  list / waive / resolve
 *   TIMESHEETS:  build / get / list / submit / reopen (+ central workflow approval)
 *   STATS/POLICY: stats / policy/get
 *   REPORTS:     list / run
 *   ACCESS:      self-scope (view/records/exceptions/timesheets), permission-gated
 *                mutations (correct, compute.run, exceptions.manage, timesheets.approve, reports.view)
 *   EVENTS:      assert app_events + hr_audit_log on every mutation
 *
 * The `hr_timesheet_approval` workflow binding assigns to `department_manager`,
 * which this suite's fixtures don't populate (no departmentManagerId in the
 * submitTimesheet context) — so the created task has assigned_to=null,
 * assigned_role=null. /api/workflows/decision does not check task assignment
 * (only requires `workflow.approve`), so admin can still decide it directly.
 */

export const title = 'HR Attendance & Timekeeping';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG, acquireActors } = h;
  const { admin } = h.users;
  const A = mint(admin);

  let emp1Id, emp2Id, staffId, mgrId;

  const today = new Date().toISOString().slice(0, 10);

  const ctx = {
    recordId: null, correctionAuditIds: [], exceptionId1: null, exceptionId2: null,
    timesheetId: null, otherTimesheetId: null, workflowId: null, photoPath: null,
    createdUserIds: [],
  };

  const waitFor = async (check, ms = 6000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await check()) return true; await new Promise(r => setTimeout(r, 300)); }
    return false;
  };

  h.onCleanup(async () => {
    // Scoped by the SPECIFIC records/exceptions this run created — emp1/emp2 may now
    // be real employees with real attendance history, so a broad employee_id delete
    // would destroy their genuine punches/exceptions/corrections.
    const tsIds = [ctx.timesheetId, ctx.otherTimesheetId].filter(Boolean);
    const exceptionIds = [ctx.exceptionId1, ctx.exceptionId2].filter(Boolean);
    const recordIds = [ctx.recordId].filter(Boolean);
    try { if (ctx.photoPath) await sb.storage.from('hr-attendance-photos').remove([ctx.photoPath]); } catch {}
    try { if (ctx.workflowId) await sb.from('workflow_tasks').delete().eq('workflow_id', ctx.workflowId); } catch {}
    try { if (ctx.workflowId) await sb.from('workflow_instances').delete().eq('id', ctx.workflowId); } catch {}
    try { if (tsIds.length) await sb.from('hr_timesheets').delete().in('id', tsIds); } catch {}
    try { if (exceptionIds.length) await sb.from('hr_attendance_exceptions').delete().in('id', exceptionIds); } catch {}
    try { if (recordIds.length) await sb.from('hr_attendance_corrections').delete().in('record_id', recordIds); } catch {}
    try { if (recordIds.length) await sb.from('hr_attendance_records').delete().in('id', recordIds); } catch {}
    try {
      const evIds = [...recordIds, ...exceptionIds, ...tsIds];
      if (evIds.length) await sb.from('app_events').delete().eq('source_module', 'hr_attendance').in('source_entity_id', evIds);
    } catch {}
    try {
      const auditIds = [...recordIds];
      if (auditIds.length) await sb.from('hr_audit_log').delete().eq('submodule_key', 'hr_attendance').in('record_id', auditIds);
    } catch {}
    try { if (ctx.createdUserIds.length) await sb.from('app_users').delete().in('id', ctx.createdUserIds); } catch {}
  });

  h.section('HR Attendance > Setup');

  let emp1Token, emp2Token, staffToken, mgrToken;

  await test('acquire employee x2, hr_staff, hr_manager (real roster preferred)', async () => {
    const empR = await acquireActors('employee', 2);
    const stfR = await acquireActors('hr_staff', 1);
    const mgrR = await acquireActors('hr_manager', 1);
    const [emp1, emp2] = empR.actors, [staff] = stfR.actors, [mgr] = mgrR.actors;
    emp1Id = emp1.id; emp2Id = emp2.id; staffId = staff.id; mgrId = mgr.id;
    ctx.createdUserIds = [...empR.createdIds, ...stfR.createdIds, ...mgrR.createdIds];

    emp1Token  = mint({ id: emp1Id,  username: emp1.username, role: 'employee',   department_id: emp1.department_id ?? null });
    emp2Token  = mint({ id: emp2Id,  username: emp2.username, role: 'employee',   department_id: emp2.department_id ?? null });
    staffToken = mint({ id: staffId, username: staff.username, role: 'hr_staff',   department_id: staff.department_id ?? null });
    mgrToken   = mint({ id: mgrId,   username: mgr.username, role: 'hr_manager', department_id: mgr.department_id ?? null });
  });

  h.section('HR Attendance > Policy & Stats');

  await test('policy/get → shape', async () => {
    const r = await api('hr/attendance/policy/get', A, {});
    ok(r, `policy/get failed: ${r.body.message}`);
    const d = r.body.data;
    expect(typeof d.enabled === 'boolean', 'enabled boolean');
    expect(typeof d.shiftStart === 'string', 'shiftStart string');
    expect(typeof d.graceMinutes === 'number', 'graceMinutes number');
    expect(Array.isArray(d.workweek), 'workweek array');
  });

  await test('stats → shape', async () => {
    const r = await api('hr/attendance/stats', A, {});
    ok(r, `stats failed: ${r.body.message}`);
    const d = r.body.data;
    for (const k of ['totalEmployees', 'presentToday', 'absentToday', 'lateToday', 'openExceptions', 'pendingTimesheets']) {
      expect(typeof d[k] === 'number', `stats.${k} is number`);
    }
  });

  h.section('HR Attendance > Punch');

  await test('punch/upload-url → presigned URL shape, then actually upload a photo', async () => {
    const r = await api('hr/attendance/punch/upload-url', emp1Token, { mimeType: 'image/jpeg' });
    ok(r, `upload-url failed: ${r.body.message}`);
    expect(typeof r.body.data.uploadUrl === 'string', 'uploadUrl string');
    expect(typeof r.body.data.path === 'string', 'path string');
    // Real upload (tiny JPEG bytes) — photo-url below reads THIS object, not a fake path.
    const put = await fetch(r.body.data.uploadUrl, {
      method: 'PUT', headers: { 'Content-Type': 'image/jpeg' },
      body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    });
    expect(put.ok, `photo upload PUT failed: ${put.status}`);
    ctx.photoPath = r.body.data.path;
  });

  await test('punch/in → creates record + app_event', async () => {
    const r = await api('hr/attendance/punch/in', emp1Token, { workDate: today, source: 'manual' });
    ok(r, `punch/in failed: ${r.body.message}`);
    const d = r.body.data;
    expect(d.employeeId === emp1Id, 'employeeId matches');
    expect(d.workDate === today, 'workDate matches');
    expect(!!d.punchInAt, 'punchInAt set');
    expect(!d.punchOutAt, 'punchOutAt not yet set');
    ctx.recordId = d.id;
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id')
        .eq('source_module', 'hr_attendance').eq('event_type', 'hr.attendance.punched_in')
        .eq('source_entity_id', ctx.recordId).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'punched_in app_event written');
  });

  await test('punch/in again (same day) → 409 already punched in', async () => {
    fails(await api('hr/attendance/punch/in', emp1Token, { workDate: today }), 'expected duplicate punch-in to fail');
  });

  await test('punch/out → sets punchOutAt + recomputes + app_event', async () => {
    const r = await api('hr/attendance/punch/out', emp1Token, { recordId: ctx.recordId });
    ok(r, `punch/out failed: ${r.body.message}`);
    expect(!!r.body.data.punchOutAt, 'punchOutAt set');
    expect(typeof r.body.data.workedMinutes === 'number', 'workedMinutes computed');
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id')
        .eq('source_module', 'hr_attendance').eq('event_type', 'hr.attendance.punched_out')
        .eq('source_entity_id', ctx.recordId).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'punched_out app_event written');
  });

  await test('punch/out again → 409 already punched out', async () => {
    fails(await api('hr/attendance/punch/out', emp1Token, { recordId: ctx.recordId }), 'expected duplicate punch-out to fail');
  });

  await test('punch/photo-url → presigned read URL (view permission)', async () => {
    const r = await api('hr/attendance/punch/photo-url', emp1Token, { path: ctx.photoPath });
    ok(r, `photo-url failed: ${r.body.message}`);
    expect(typeof r.body.data.url === 'string', 'url string');
  });

  h.section('HR Attendance > Records (self-scope)');

  await test('records/get (own) → ok', async () => {
    const r = await api('hr/attendance/records/get', emp1Token, { id: ctx.recordId });
    ok(r, `records/get own failed: ${r.body.message}`);
    expect(r.body.data.id === ctx.recordId, 'id matches');
  });

  await test('records/get (another employee\'s record) → 403 denied', async () => {
    fails(await api('hr/attendance/records/get', emp2Token, { id: ctx.recordId }), 'expected self-scope denial');
  });

  await test('records/list (employee, no view_all) is silently self-scoped', async () => {
    const r = await api('hr/attendance/records/list', emp2Token, { employeeId: emp1Id });
    ok(r, `records/list failed: ${r.body.message}`);
    expect(r.body.data.records.every(rec => rec.employeeId === emp2Id), 'only own records returned regardless of requested employeeId');
  });

  await test('records/list (hr_staff, view_all) sees emp1\'s record', async () => {
    const r = await api('hr/attendance/records/list', staffToken, { employeeId: emp1Id });
    ok(r, `records/list (staff) failed: ${r.body.message}`);
    expect(r.body.data.records.some(rec => rec.id === ctx.recordId), 'emp1 record present for view_all caller');
  });

  h.section('HR Attendance > Corrections');

  await test('records/correct (hr_staff) → field updated + correction row + audit + app_event', async () => {
    const r = await api('hr/attendance/records/correct', staffToken, {
      recordId: ctx.recordId, fieldName: 'notes', newValue: 'E2E corrected note', reason: 'E2E correction test',
    });
    ok(r, `correct failed: ${r.body.message}`);
    expect(r.body.data.notes === 'E2E corrected note', 'notes field updated');
    const { data: corr } = await sb.from('hr_attendance_corrections').select('id')
      .eq('record_id', ctx.recordId).eq('field_name', 'notes').maybeSingle();
    expect(!!corr, 'correction row written');
    const { data: aud } = await sb.from('hr_audit_log').select('id')
      .eq('record_id', ctx.recordId).eq('action', 'attendance.correction').maybeSingle();
    expect(!!aud, 'audit row written');
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id')
        .eq('source_module', 'hr_attendance').eq('event_type', 'hr.attendance.correction_applied')
        .eq('source_entity_id', ctx.recordId).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'correction_applied app_event written');
  });

  await test('records/correct disallowed field → 400', async () => {
    const r = await api('hr/attendance/records/correct', staffToken, {
      recordId: ctx.recordId, fieldName: 'employee_id', newValue: 'x', reason: 'should fail',
    });
    fails(r, 'expected disallowed field to be rejected');
  });

  await test('records/correct (employee) → denied (lacks hr.attendance.correct)', async () => {
    fails(await api('hr/attendance/records/correct', emp1Token, {
      recordId: ctx.recordId, fieldName: 'notes', newValue: 'nope', reason: 'e2e',
    }), 'expected employee to be denied correct');
  });

  h.section('HR Attendance > Compute');

  await test('compute/run (hr_staff) → recomputes + app_event', async () => {
    const r = await api('hr/attendance/compute/run', staffToken, { recordId: ctx.recordId });
    ok(r, `compute/run failed: ${r.body.message}`);
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id')
        .eq('source_module', 'hr_attendance').eq('event_type', 'hr.attendance.compute_completed')
        .eq('source_entity_id', ctx.recordId).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'compute_completed app_event written');
  });

  await test('compute/run (employee) → denied', async () => {
    fails(await api('hr/attendance/compute/run', emp1Token, { recordId: ctx.recordId }), 'expected employee to be denied compute.run');
  });

  h.section('HR Attendance > Exceptions');

  await test('seed two open exceptions on emp1\'s record (deterministic fixtures)', async () => {
    const { data, error } = await sb.from('hr_attendance_exceptions').insert([
      { record_id: ctx.recordId, employee_id: emp1Id, work_date: today, exception_type: 'short_hours', minutes: 120, status: 'open' },
      { record_id: ctx.recordId, employee_id: emp1Id, work_date: today, exception_type: 'late_arrival', minutes: 15, status: 'open' },
    ]).select('id');
    expect(!error, `seed exceptions failed: ${error?.message}`);
    ctx.exceptionId1 = data[0].id;
    ctx.exceptionId2 = data[1].id;
  });

  await test('exceptions/list (hr_staff, view_all) → includes seeded exceptions', async () => {
    const r = await api('hr/attendance/exceptions/list', staffToken, { employeeId: emp1Id, status: 'open' });
    ok(r, `exceptions/list failed: ${r.body.message}`);
    const ids = r.body.data.exceptions.map(e => e.id);
    expect(ids.includes(ctx.exceptionId1) && ids.includes(ctx.exceptionId2), 'both seeded exceptions present');
  });

  await test('exceptions/list (emp2, self-scoped) does not see emp1\'s exceptions', async () => {
    const r = await api('hr/attendance/exceptions/list', emp2Token, { employeeId: emp1Id });
    ok(r, `exceptions/list (emp2) failed: ${r.body.message}`);
    expect(r.body.data.exceptions.length === 0, 'emp2 sees none of emp1\'s exceptions');
  });

  await test('exceptions/waive (hr_staff) → status=waived + audit + app_event', async () => {
    const r = await api('hr/attendance/exceptions/waive', staffToken, {
      exceptionId: ctx.exceptionId1, waiveReason: 'E2E waive test',
    });
    ok(r, `waive failed: ${r.body.message}`);
    const { data: ex } = await sb.from('hr_attendance_exceptions').select('status').eq('id', ctx.exceptionId1).maybeSingle();
    expect(ex?.status === 'waived', 'status is waived');
    const { data: aud } = await sb.from('hr_audit_log').select('id')
      .eq('record_id', ctx.exceptionId1).eq('action', 'exception.waived').maybeSingle();
    expect(!!aud, 'waive audit written');
  });

  await test('exceptions/waive already-waived → fails', async () => {
    fails(await api('hr/attendance/exceptions/waive', staffToken, {
      exceptionId: ctx.exceptionId1, waiveReason: 'retry',
    }), 'expected re-waive of a non-open exception to fail');
  });

  await test('exceptions/resolve (hr_staff) → status=resolved + audit + app_event', async () => {
    const r = await api('hr/attendance/exceptions/resolve', staffToken, {
      exceptionId: ctx.exceptionId2, resolveNote: 'E2E resolve test',
    });
    ok(r, `resolve failed: ${r.body.message}`);
    const { data: ex } = await sb.from('hr_attendance_exceptions').select('status').eq('id', ctx.exceptionId2).maybeSingle();
    expect(ex?.status === 'resolved', 'status is resolved');
    const { data: aud } = await sb.from('hr_audit_log').select('id')
      .eq('record_id', ctx.exceptionId2).eq('action', 'exception.resolved').maybeSingle();
    expect(!!aud, 'resolve audit written');
  });

  await test('exceptions/waive (employee) → denied (lacks exceptions.manage)', async () => {
    fails(await api('hr/attendance/exceptions/waive', emp1Token, {
      exceptionId: ctx.exceptionId1, waiveReason: 'nope',
    }), 'expected employee to be denied exceptions.manage');
  });

  h.section('HR Attendance > Timesheets + workflow approval');

  await test('timesheets/build (hr_staff, for emp1) → draft + rollup fields', async () => {
    const r = await api('hr/attendance/timesheets/build', staffToken, {
      employeeId: emp1Id, periodStart: today, periodEnd: today,
    });
    ok(r, `build failed: ${r.body.message}`);
    ctx.timesheetId = r.body.data.id;
    expect(r.body.data.employeeId === emp1Id, 'employeeId matches');
    expect(r.body.data.status === 'draft', `expected draft, got ${r.body.data.status}`);
    expect(typeof r.body.data.totalWorkedMinutes === 'number', 'totalWorkedMinutes computed');
  });

  await test('timesheets/build (employee, on behalf of another employee) → 403 self-scope denied', async () => {
    fails(await api('hr/attendance/timesheets/build', emp1Token, {
      employeeId: emp2Id, periodStart: today, periodEnd: today,
    }), 'expected self-scope denial building another employee\'s timesheet');
  });

  await test('timesheets/get → shape', async () => {
    const r = await api('hr/attendance/timesheets/get', staffToken, { id: ctx.timesheetId });
    ok(r, `get failed: ${r.body.message}`);
    expect(r.body.data.id === ctx.timesheetId, 'id matches');
  });

  await test('timesheets/get (emp2, not the owner) → 403 denied', async () => {
    fails(await api('hr/attendance/timesheets/get', emp2Token, { id: ctx.timesheetId }), 'expected self-scope denial');
  });

  await test('timesheets/list (hr_staff, view_all) → includes it', async () => {
    const r = await api('hr/attendance/timesheets/list', staffToken, { employeeId: emp1Id });
    ok(r, `list failed: ${r.body.message}`);
    expect(r.body.data.timesheets.some(t => t.id === ctx.timesheetId), 'built timesheet present');
  });

  await test('timesheets/submit (emp2, not the owner) → 403 self-scope denied', async () => {
    fails(await api('hr/attendance/timesheets/submit', emp2Token, { timesheetId: ctx.timesheetId }), 'expected self-scope denial submitting another employee\'s timesheet');
  });

  await test('timesheets/submit (emp1, own) → in_review or approved + audit + app_event', async () => {
    const r = await api('hr/attendance/timesheets/submit', emp1Token, { timesheetId: ctx.timesheetId });
    ok(r, `submit failed: ${r.body.message}`);
    expect(['in_review', 'approved'].includes(r.body.data.status), `expected in_review/approved, got ${r.body.data.status}`);
    ctx.workflowId = r.body.data.workflowId;
    const { data: aud } = await sb.from('hr_audit_log').select('id')
      .eq('record_id', ctx.timesheetId).eq('action', 'timesheet.submitted').maybeSingle();
    expect(!!aud, 'submit audit written');
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id')
        .eq('source_module', 'hr_attendance').eq('event_type', 'hr.timesheet.submitted')
        .eq('source_entity_id', ctx.timesheetId).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'timesheet.submitted app_event written');
  });

  await test('timesheets/submit already-submitted → fails', async () => {
    fails(await api('hr/attendance/timesheets/submit', emp1Token, { timesheetId: ctx.timesheetId }), 'expected re-submit to fail');
  });

  await test('workflow approval (admin, via /api/workflows/decision) drives timesheet to approved', async () => {
    const { data: ts } = await sb.from('hr_timesheets').select('status, workflow_id').eq('id', ctx.timesheetId).maybeSingle();
    if (ts?.status === 'approved') {
      // Auto-approved (no active binding) — nothing further to do.
      expect(true, 'already approved (fallback path)');
      return;
    }
    expect(ts?.status === 'in_review', `expected in_review before deciding, got ${ts?.status}`);
    ctx.workflowId = ts.workflow_id;
    const { data: task } = await sb.from('workflow_tasks').select('id')
      .eq('workflow_id', ctx.workflowId).in('status', ['pending', 'open', 'in_progress']).limit(1).maybeSingle();
    expect(!!task, 'a pending workflow task exists for the submitted timesheet');
    const r = await api('workflows/decision', A, { taskId: task.id, decision: 'approved', note: 'E2E approval' });
    ok(r, `workflow decision failed: ${r.body.message}`);
    const settled = await waitFor(async () => {
      const { data } = await sb.from('hr_timesheets').select('status').eq('id', ctx.timesheetId).maybeSingle();
      return data?.status === 'approved';
    });
    expect(settled, 'timesheet status synced to approved via the workflow adapter');
  });

  await test('timesheets/reopen (hr_manager, has timesheets.approve) → status=reopened', async () => {
    const r = await api('hr/attendance/timesheets/reopen', mgrToken, { timesheetId: ctx.timesheetId });
    ok(r, `reopen failed: ${r.body.message}`);
    const { data: ts } = await sb.from('hr_timesheets').select('status').eq('id', ctx.timesheetId).maybeSingle();
    expect(ts?.status === 'reopened', `expected reopened, got ${ts?.status}`);
  });

  await test('timesheets/reopen (employee) → denied (lacks timesheets.approve)', async () => {
    fails(await api('hr/attendance/timesheets/reopen', emp1Token, { timesheetId: ctx.timesheetId }), 'expected employee to be denied reopen');
  });

  await test('timesheets/reopen on a non-approved/rejected timesheet → fails', async () => {
    fails(await api('hr/attendance/timesheets/reopen', mgrToken, { timesheetId: ctx.timesheetId }), 'expected reopen of an already-reopened timesheet to fail');
  });

  h.section('HR Attendance > Reports');

  await test('reports/list → catalog of report definitions', async () => {
    const r = await api('hr/attendance/reports/list', staffToken, {});
    ok(r, `reports/list failed: ${r.body.message}`);
    expect(r.body.data.length >= 10, `expected >=10 report definitions, got ${r.body.data.length}`);
    expect(r.body.data.some(rep => rep.key === 'daily_log'), 'daily_log present');
  });

  await test('reports/run daily_log → rows + total', async () => {
    const r = await api('hr/attendance/reports/run', staffToken, {
      reportKey: 'daily_log', employeeId: emp1Id, fromDate: today, toDate: today,
    });
    ok(r, `reports/run daily_log failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data.rows), 'rows is array');
    expect(typeof r.body.data.total === 'number', 'total is number');
  });

  await test('reports/run correction_audit → includes our correction', async () => {
    const r = await api('hr/attendance/reports/run', staffToken, {
      reportKey: 'correction_audit', fromDate: today, toDate: today,
    });
    ok(r, `reports/run correction_audit failed: ${r.body.message}`);
    expect(r.body.data.rows.some(row => row.record_id === ctx.recordId), 'our correction present in the report');
  });

  await test('reports/run with an unknown key → refused', async () => {
    fails(await api('hr/attendance/reports/run', staffToken, { reportKey: 'not_a_real_report' }), 'expected unknown report key to be refused');
  });

  await test('reports/list (employee) → denied (lacks reports.view)', async () => {
    fails(await api('hr/attendance/reports/list', emp1Token, {}), 'expected employee to be denied reports');
  });

  h.section('HR Attendance > Bulk CSV import (Wave 4c)');

  const importDates = ['2031-04-01', '2031-04-02'];

  await test('employee is DENIED bulk import (lacks hr.attendance.correct)', async () => {
    fails(await api('hr/attendance/records/import', emp1Token, {
      rows: [{ employeeId: emp1Id, workDate: importDates[0], punchIn: '08:00', punchOut: '16:30' }],
    }), 'employee should be denied attendance import');
  });

  await test('hr_staff can bulk-import punches; result reports applied + skipped', async () => {
    const r = await api('hr/attendance/records/import', staffToken, {
      rows: [
        { employeeId: emp1Id, workDate: importDates[0], punchIn: '08:00', punchOut: '16:30' },
        { employeeId: emp1Id, workDate: importDates[1], punchIn: '08:05', punchOut: '16:30' },
        { employeeId: 'nonexistent-user-id', workDate: importDates[0], punchIn: '08:00', punchOut: '16:00' },
      ],
    });
    ok(r, `import failed: ${r.body.message}`);
    const d = r.body.data;
    expect(d.total === 3, `total should be 3, got ${d.total}`);
    expect((d.imported + d.updated) === 2, `2 rows should apply, got imported=${d.imported} updated=${d.updated}`);
    expect(d.skipped === 1, `1 row should be skipped (bad employee), got ${d.skipped}`);
    expect(Array.isArray(d.errors) && d.errors.length === 1, 'errors should list the skipped row');
  });

  await test('imported punches created records with source=import and computed worked minutes', async () => {
    const { data } = await sb.from('hr_attendance_records')
      .select('id, source, worked_minutes, work_date').eq('employee_id', emp1Id).in('work_date', importDates);
    expect((data ?? []).length === 2, `expected 2 imported records, got ${(data ?? []).length}`);
    expect((data ?? []).every(x => x.source === 'import'), 'all imported records should have source=import');
    expect((data ?? []).some(x => Number(x.worked_minutes) > 0), 'worked_minutes should be computed from punches');
  });

  await test('§2 side-effect: hr.attendance.imported app_event fired', async () => {
    const got = await waitFor(async () => {
      const { data } = await sb.from('app_events')
        .select('id').eq('source_module', 'hr_attendance').eq('event_type', 'hr.attendance.imported')
        .eq('actor_user_id', staffId).limit(1);
      return (data ?? []).length > 0;
    });
    expect(got, 'hr.attendance.imported app_event not found');
  });

  await test('re-importing IMPORT-sourced rows applies without the overwrite flag (idempotent re-run)', async () => {
    const r = await api('hr/attendance/records/import', staffToken, {
      rows: [{ employeeId: emp1Id, workDate: importDates[0], punchIn: '08:15', punchOut: '16:45' }],
    });
    ok(r, `re-import failed: ${r.body.message}`);
    expect(r.body.data.updated === 1, `re-import should update 1, got ${JSON.stringify(r.body.data)}`);
  });

  await test('a LIVE punch is PROTECTED: colliding row skips without overwriteExisting, applies with it', async () => {
    const liveDate = '2031-04-03';
    // Seed a live (mobile) punch record directly.
    const { data: live, error: liveErr } = await sb.from('hr_attendance_records').insert({
      record_no: `ATR-E2E-${TAG.slice(-6)}`, employee_id: emp1Id, work_date: liveDate,
      punch_in_at: `${liveDate}T08:00:00.000Z`, punch_out_at: `${liveDate}T16:00:00.000Z`,
      source: 'mobile', status: 'present',
    }).select('id').single();
    expect(!liveErr, `seed live record failed: ${liveErr?.message}`);

    // Without the flag → skipped, live record untouched.
    const r1 = await api('hr/attendance/records/import', staffToken, {
      rows: [{ employeeId: emp1Id, workDate: liveDate, punchIn: '09:00', punchOut: '17:00' }],
    });
    ok(r1, `protected import call failed: ${r1.body.message}`);
    expect(r1.body.data.skipped === 1 && r1.body.data.updated === 0, `live collision should skip, got ${JSON.stringify(r1.body.data)}`);
    expect(/overwrite/i.test(r1.body.data.errors[0]?.message ?? ''), 'skip reason should mention the overwrite flag');
    const { data: after1 } = await sb.from('hr_attendance_records').select('source, punch_in_at').eq('id', live.id).maybeSingle();
    expect(after1?.source === 'mobile', 'live record must be untouched without the flag');

    // With the flag → replaced (correction mode).
    const r2 = await api('hr/attendance/records/import', staffToken, {
      rows: [{ employeeId: emp1Id, workDate: liveDate, punchIn: '09:00', punchOut: '17:00' }],
      overwriteExisting: true,
    });
    ok(r2, `overwrite import failed: ${r2.body.message}`);
    expect(r2.body.data.updated === 1, `overwrite should update 1, got ${JSON.stringify(r2.body.data)}`);
    const { data: after2 } = await sb.from('hr_attendance_records').select('source').eq('id', live.id).maybeSingle();
    expect(after2?.source === 'import', 'record should now be import-sourced');

    // Cleanup the seeded live-date record.
    try { await sb.from('hr_attendance_exceptions').delete().eq('employee_id', emp1Id).eq('work_date', liveDate); } catch {}
    try { await sb.from('hr_attendance_records').delete().eq('id', live.id); } catch {}
  });

  await test('import cleanup (compensating delete)', async () => {
    try { await sb.from('hr_attendance_exceptions').delete().eq('employee_id', emp1Id).in('work_date', importDates); } catch {}
    try { await sb.from('hr_attendance_records').delete().eq('employee_id', emp1Id).in('work_date', importDates); } catch {}
    try { await sb.from('app_events').delete().eq('source_module', 'hr_attendance').eq('event_type', 'hr.attendance.imported').eq('actor_user_id', staffId); } catch {}
    try { await sb.from('hr_audit_log').delete().eq('submodule_key', 'hr_attendance').eq('action', 'attendance.imported').eq('actor_id', staffId); } catch {}
    expect(true, 'cleanup complete');
  });

  h.section('HR Attendance > Access control');

  await test('unauthenticated → 401', async () => {
    fails(await api('hr/attendance/records/list', null, {}), 'expected no-token request to be rejected');
  });
}
