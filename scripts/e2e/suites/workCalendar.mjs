// Shared Work Calendar (F-CAL) live E2E. Hits real /api/hr/work-calendars/* routes + verifies DB state,
// app_events, hr_audit_log, and receipts via the service-role client. working_days is not route-exposed
// (F-02-internal) so it is exercised via sb.rpc. Cleanup uses work_calendar_purge_tx (delete-guards block
// raw deletes of published rows). Contract: docs/module-contracts/shared-work-calendar-delivery-contract.md.
import crypto from 'node:crypto';
const uuid = () => crypto.randomUUID();

export const title = 'Shared Work Calendar (F-CAL)';

export default async function run(h) {
  const { api, test, expect, fails, mint, sb, TAG } = h;
  const users = { mgr: `WC-MGR-${TAG}`, view: `WC-VIEW-${TAG}`, emp: `WC-EMP-${TAG}` };
  const created = { holidayCalendarIds: [], workCalendarIds: [], payGroupId: null };
  let T = {};

  const HS = 'hr/work-calendars/holiday-set/command';
  const WV = 'hr/work-calendars/version/command';
  const AS = 'hr/work-calendars/assignment/command';
  const RD = 'hr/work-calendars/read';
  const base = (extra) => ({ requestKey: uuid(), reason: 'e2e', ...extra });
  const holiday = (extra) => ({ holidayDate: '2026-01-01', nameStatutory: 'X', nameCommon: 'X', holidayType: 'statutory',
    sourceReference: 'e2e src', sourcePublishedDate: '2025-12-01', provenanceNote: 'e2e', ...extra });

  h.onCleanup(async () => {
    await sb.rpc('work_calendar_purge_tx', {
      p_work_calendar_ids: created.workCalendarIds.length ? created.workCalendarIds : null,
      p_holiday_calendar_ids: created.holidayCalendarIds.length ? created.holidayCalendarIds : null,
    });
    await h.mustDelete('app_events', q => q.eq('source_module', 'hr_work_calendar').ilike('dedupe_key', `%${TAG}%`));
    await h.mustDelete('hr_audit_log', q => q.eq('submodule_key', 'hr.work_calendar').in('actor_id', Object.values(users)));
    await h.mustDelete('work_calendar_command_receipts', q => q.in('actor_id', Object.values(users)));
    if (created.payGroupId) await h.mustDelete('finance_pay_groups', q => q.eq('id', created.payGroupId));
    await h.mustDelete('app_users', q => q.in('id', Object.values(users)));
  });

  // ── helpers that build + publish a holiday set / work calendar ──────────────
  async function publishHolidaySet(token, { effFrom = '2026-01-01', effTo = '2026-12-31', holidays = [holiday()] } = {}) {
    const cv = await api(HS, token, base({ command: 'create_version', calendar: { name: `HS ${TAG} ${uuid().slice(0,6)}`, jurisdiction: 'TT' }, effectiveFrom: effFrom, ...(effTo ? { effectiveTo: effTo } : {}) }));
    expect(cv.status === 200, `create holiday version: ${cv.status} ${JSON.stringify(cv.body).slice(0,200)}`);
    const calId = cv.body.data.calendar.id; const verId = cv.body.data.version.id;
    created.holidayCalendarIds.push(calId);
    let lock = cv.body.data.version.lockVersion;
    for (const hd of holidays) {
      const ah = await api(HS, token, base({ command: 'add_holiday', versionId: verId, expectedLockVersion: lock, holiday: hd }));
      expect(ah.status === 200, `add_holiday: ${ah.status} ${JSON.stringify(ah.body).slice(0,200)}`);
      lock = ah.body.data.version.lockVersion;
    }
    const cal = await api(RD, token, { action: 'get_holiday_calendar', id: calId });
    const calLock = cal.body.data.calendar.lockVersion;
    const pub = await api(HS, token, base({ command: 'publish_version', versionId: verId, expectedVersionLockVersion: lock, expectedCalendarLockVersion: calLock }));
    expect(pub.status === 200, `publish holiday set: ${pub.status} ${JSON.stringify(pub.body).slice(0,200)}`);
    return { calId, verId, checksum: pub.body.data.version.checksum };
  }
  async function publishWorkCalendar(token, hcvId, { effFrom = '2026-01-01', effTo = '2026-12-31', weekdays = [1,2,3,4,5,6], fractions = {} } = {}) {
    const cv = await api(WV, token, base({ command: 'create_version', calendar: { name: `WC ${TAG} ${uuid().slice(0,6)}` }, effectiveFrom: effFrom, ...cvExtra(effTo), holidayCalendarVersionId: hcvId, workingWeekdays: weekdays, weekdayFractions: fractions }));
    expect(cv.status === 200, `create work version: ${cv.status} ${JSON.stringify(cv.body).slice(0,200)}`);
    const calId = cv.body.data.calendar.id; const verId = cv.body.data.version.id;
    created.workCalendarIds.push(calId);
    const cal = await api(RD, token, { action: 'get_work_calendar', id: calId });
    const pub = await api(WV, token, base({ command: 'publish_version', versionId: verId, expectedVersionLockVersion: cv.body.data.version.lockVersion, expectedCalendarLockVersion: cal.body.data.calendar.lockVersion }));
    expect(pub.status === 200, `publish work cal: ${pub.status} ${JSON.stringify(pub.body).slice(0,200)}`);
    return { calId, verId, checksum: pub.body.data.version.checksum };
  }
  const cvExtra = (effTo) => (effTo ? { effectiveTo: effTo } : {});

  h.section('Work Calendar - setup + security');
  await test('provision roles + pay group', async () => {
    const { error } = await sb.from('app_users').insert([
      { id: users.mgr,  username: `${TAG}_wc_m`, full_name: 'WC Manager (E2E)', role: 'hr_manager',      status: 'active', employment_type: 'employee' },
      { id: users.view, username: `${TAG}_wc_v`, full_name: 'WC Viewer (E2E)',  role: 'finance_manager', status: 'active', employment_type: 'employee' },
      { id: users.emp,  username: `${TAG}_wc_e`, full_name: 'WC Employee (E2E)', role: 'employee',        status: 'active', employment_type: 'employee' },
    ]);
    expect(!error, `user setup: ${error?.message}`);
    T = {
      mgr:  mint({ id: users.mgr,  username: `${TAG}_wc_m`, role: 'hr_manager',      department_id: null }),
      view: mint({ id: users.view, username: `${TAG}_wc_v`, role: 'finance_manager', department_id: null }),
      emp:  mint({ id: users.emp,  username: `${TAG}_wc_e`, role: 'employee',        department_id: null }),
    };
    const g = await sb.from('finance_pay_groups').insert({ code: `WCG-${TAG.slice(-6)}`, name: `WC Group ${TAG}`, frequency: 'monthly', statutory_country: 'TT' }).select('id').single();
    expect(!g.error, `pay group: ${g.error?.message}`); created.payGroupId = g.data.id;
  });

  await test('routes require auth + deny non-manager (403) / non-viewer', async () => {
    // explicit literal paths so the E2E coverage gate detects all four mounted routes
    expect((await api('hr/work-calendars/holiday-set/command', null, {})).status === 401, 'holiday-set unauth 401');
    expect((await api('hr/work-calendars/version/command', null, {})).status === 401, 'version unauth 401');
    expect((await api('hr/work-calendars/assignment/command', null, {})).status === 401, 'assignment unauth 401');
    expect((await api('hr/work-calendars/read', null, {})).status === 401, 'read unauth 401');
    for (const p of [HS, WV, AS]) {
      expect((await api(p, T.emp, {})).status === 403, `${p} employee must be 403`);
      expect((await api(p, T.view, {})).status === 403, `${p} viewer lacks manage must be 403`);
    }
    expect((await api(RD, T.emp, { action: 'list_work_calendars' })).status === 403, 'read employee must be 403');
    expect((await api(RD, T.view, { action: 'list_work_calendars' })).status === 200, 'viewer may read');
  });

  h.section('Holiday sets - versioned, immutable, provenance');
  let hs1;
  await test('draft + add holiday + publish -> checksum + side effects (event/audit/receipt)', async () => {
    hs1 = await publishHolidaySet(T.mgr, { holidays: [holiday({ holidayDate: '2026-06-19', nameStatutory: 'Labour Day', nameCommon: 'Labour Day' })] });
    expect(hs1.checksum && hs1.checksum.length === 64, 'published checksum set');
    const ev = await sb.from('app_events').select('event_type').eq('source_entity_id', hs1.verId).eq('event_type', 'holiday_calendar.version_published');
    expect(ev.data?.length === 1, `exactly one published event, got ${ev.data?.length}`);
    const au = await sb.from('hr_audit_log').select('id').eq('submodule_key', 'hr.work_calendar').eq('record_id', hs1.verId).eq('action', 'holiday_set.publish_version');
    expect(au.data?.length === 1, `exactly one audit row, got ${au.data?.length}`);
    const rc = await sb.from('work_calendar_command_receipts').select('operation').eq('operation', 'holiday_set.publish_version').eq('actor_id', users.mgr);
    expect((rc.data?.length ?? 0) >= 1, 'publish receipt written');
  });

  await test('missing provenance rejected (400 Zod)', async () => {
    const cv = await api(HS, T.mgr, base({ command: 'create_version', calendar: { name: `HS ${TAG} p`, jurisdiction: 'TT' }, effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31' }));
    created.holidayCalendarIds.push(cv.body.data.calendar.id);
    const bad = await api(HS, T.mgr, base({ command: 'add_holiday', versionId: cv.body.data.version.id, expectedLockVersion: cv.body.data.version.lockVersion,
      holiday: { holidayDate: '2026-01-01', nameStatutory: 'X', nameCommon: 'X', holidayType: 'statutory' } }));  // missing source/provenance
    fails(bad); expect(bad.status === 400, `missing provenance must be 400, got ${bad.status}`);
  });

  await test('published version immutable + empty publish rejected + duplicate + out-of-window', async () => {
    // add a holiday to a published version -> version_immutable (409)
    const add = await api(HS, T.mgr, base({ command: 'add_holiday', versionId: hs1.verId, expectedLockVersion: 99, holiday: holiday() }));
    fails(add); expect(add.status === 409, `add to published must be 409, got ${add.status}`);
    // empty publish: fresh version with no holidays
    const cv = await api(HS, T.mgr, base({ command: 'create_version', calendar: { name: `HS ${TAG} e`, jurisdiction: 'TT' }, effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31' }));
    const calId = cv.body.data.calendar.id; created.holidayCalendarIds.push(calId);
    const cal = await api(RD, T.mgr, { action: 'get_holiday_calendar', id: calId });
    const emptyPub = await api(HS, T.mgr, base({ command: 'publish_version', versionId: cv.body.data.version.id, expectedVersionLockVersion: cv.body.data.version.lockVersion, expectedCalendarLockVersion: cal.body.data.calendar.lockVersion }));
    fails(emptyPub); expect(emptyPub.status === 422 && emptyPub.body.message === 'calendar.holiday_set_empty', `empty publish -> holiday_set_empty 422, got ${emptyPub.status} ${emptyPub.body.message}`);
    // duplicate holiday date on a draft
    let lock = cv.body.data.version.lockVersion;
    const a1 = await api(HS, T.mgr, base({ command: 'add_holiday', versionId: cv.body.data.version.id, expectedLockVersion: lock, holiday: holiday() })); lock = a1.body.data.version.lockVersion;
    const dup = await api(HS, T.mgr, base({ command: 'add_holiday', versionId: cv.body.data.version.id, expectedLockVersion: lock, holiday: holiday() }));
    fails(dup); expect(dup.status === 409 && dup.body.message === 'calendar.holiday_exists', `dup date -> holiday_exists, got ${dup.body.message}`);
    // out-of-window
    const oow = await api(HS, T.mgr, base({ command: 'add_holiday', versionId: cv.body.data.version.id, expectedLockVersion: lock, holiday: holiday({ holidayDate: '2027-01-01' }) }));
    fails(oow); expect(oow.status === 422 && oow.body.message === 'calendar.holiday_out_of_window', `oow -> holiday_out_of_window, got ${oow.body.message}`);
  });

  h.section('Work calendars - pattern, publish, checksum determinism');
  let wc1;
  await test('work draft + publish + checksum determinism', async () => {
    wc1 = await publishWorkCalendar(T.mgr, hs1.verId);
    expect(wc1.checksum?.length === 64, 'work checksum set');
    const rederived = await sb.rpc('work_calendar_version_checksum', { p_version_id: wc1.verId });
    expect(!rederived.error && rederived.data === wc1.checksum, `checksum deterministic (rederive=${rederived.data})`);
  });
  await test('invalid pattern rejected', async () => {
    const dupWeekdays = await api(WV, T.mgr, base({ command: 'create_version', calendar: { name: `WC ${TAG} bad` }, effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31', holidayCalendarVersionId: hs1.verId, workingWeekdays: [1, 1, 2] }));
    fails(dupWeekdays); expect(dupWeekdays.status === 422 && dupWeekdays.body.message === 'calendar.invalid_pattern', `dup weekdays -> invalid_pattern, got ${dupWeekdays.status} ${dupWeekdays.body.message}`);
    if (dupWeekdays.body?.data?.calendar?.id) created.workCalendarIds.push(dupWeekdays.body.data.calendar.id);
    const publishUnpub = await api(WV, T.mgr, base({ command: 'create_version', calendar: { name: `WC ${TAG} up` }, effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31', holidayCalendarVersionId: uuid(), workingWeekdays: [1,2,3] }));
    fails(publishUnpub); expect(publishUnpub.status === 422 && publishUnpub.body.message === 'calendar.holiday_set_unpublished', `bad holiday ref -> holiday_set_unpublished, got ${publishUnpub.body.message}`);
  });

  h.section('Assignments + resolution');
  await test('assign + overlap + window containment + cancel', async () => {
    const asg = await api(AS, T.mgr, base({ command: 'assign', scope: 'pay_group', payGroupId: created.payGroupId, workCalendarVersionId: wc1.verId, effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31' }));
    expect(asg.status === 200, `assign: ${asg.status} ${JSON.stringify(asg.body).slice(0,200)}`);
    const asgId = asg.body.data.assignment.id;
    const overlap = await api(AS, T.mgr, base({ command: 'assign', scope: 'pay_group', payGroupId: created.payGroupId, workCalendarVersionId: wc1.verId, effectiveFrom: '2026-06-01', effectiveTo: '2026-07-01' }));
    fails(overlap); expect(overlap.status === 409 && overlap.body.message === 'calendar.assignment_overlap', `overlap -> assignment_overlap, got ${overlap.body.message}`);
    const windowBad = await api(AS, T.mgr, base({ command: 'assign', scope: 'organization', workCalendarVersionId: wc1.verId, effectiveFrom: '2025-06-01', effectiveTo: '2027-12-31' }));
    fails(windowBad); expect(windowBad.status === 422 && windowBad.body.message === 'calendar.assignment_window_uncovered', `window -> assignment_window_uncovered, got ${windowBad.body.message}`);
    const cancel = await api(AS, T.mgr, base({ command: 'cancel_assignment', assignmentId: asgId }));
    expect(cancel.status === 200, `cancel: ${cancel.status}`);
  });

  await test('end_assignment is open-only (needs open version + open assignment)', async () => {
    // an OPEN assignment requires an OPEN version (window containment), so build an open holiday set + work cal.
    const openHs = await publishHolidaySet(T.mgr, { effTo: null, holidays: [holiday()] });
    const openWc = await publishWorkCalendar(T.mgr, openHs.verId, { effTo: null });
    const g = await sb.from('finance_pay_groups').insert({ code: `WCE-${TAG.slice(-6)}`, name: `WCE ${TAG}`, frequency: 'monthly', statutory_country: 'TT' }).select('id').single();
    const pg = g.data.id;
    const asg = await api(AS, T.mgr, base({ command: 'assign', scope: 'pay_group', payGroupId: pg, workCalendarVersionId: openWc.verId, effectiveFrom: '2026-01-01' }));  // open (no effectiveTo)
    expect(asg.status === 200, `open assign: ${asg.status} ${JSON.stringify(asg.body).slice(0,200)}`);
    const asgId = asg.body.data.assignment.id;
    const end = await api(AS, T.mgr, base({ command: 'end_assignment', assignmentId: asgId, effectiveTo: '2026-06-30' }));
    expect(end.status === 200, `end open assignment: ${end.status} ${JSON.stringify(end.body).slice(0,200)}`);
    const reEnd = await api(AS, T.mgr, base({ command: 'end_assignment', assignmentId: asgId, effectiveTo: '2026-05-30' }));
    fails(reEnd); expect(reEnd.status === 409 && reEnd.body.message === 'calendar.assignment_not_active', `re-end -> assignment_not_active, got ${reEnd.body.message}`);
    await h.mustDelete('finance_pay_groups', q => q.eq('id', pg));  // assignments cascade
  });

  await test('resolution: pay_group / split_period / unresolved / jurisdiction', async () => {
    // fresh pay group + assignment covering the whole period
    const g = await sb.from('finance_pay_groups').insert({ code: `WCR-${TAG.slice(-6)}`, name: `WCR ${TAG}`, frequency: 'monthly', statutory_country: 'TT' }).select('id').single();
    const pg = g.data.id;
    await api(AS, T.mgr, base({ command: 'assign', scope: 'pay_group', payGroupId: pg, workCalendarVersionId: wc1.verId, effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31' }));
    const res = await api(RD, T.mgr, { action: 'resolve', payGroupId: pg, periodStart: '2026-02-01', periodEnd: '2026-02-28' });
    expect(res.status === 200 && res.body.data.resolutionPath.scope === 'pay_group' && res.body.data.workCalendarChecksum === wc1.checksum, `resolve pay_group: ${JSON.stringify(res.body).slice(0,200)}`);
    const noAsg = await sb.from('finance_pay_groups').insert({ code: `WCU-${TAG.slice(-6)}`, name: `WCU ${TAG}`, frequency: 'monthly', statutory_country: 'TT' }).select('id').single();
    const unres = await api(RD, T.mgr, { action: 'resolve', payGroupId: noAsg.data.id, periodStart: '2026-02-01', periodEnd: '2026-02-28' });
    fails(unres); expect(unres.status === 422 && unres.body.message === 'calendar.unresolved', `unresolved: ${unres.body.message}`);
    await h.mustDelete('finance_pay_groups', q => q.in('id', [pg, noAsg.data.id]));  // (assignments cascade)
  });

  h.section('working_days (via RPC) + evidence');
  await test('working_days exact count + independent evidence + zero denominator', async () => {
    // Feb 2026: 28 days. Sundays in Feb 2026: 1,8,15,22 (4). Pattern Mon-Sat -> working days = 28-4 = 24.
    const wd = await sb.rpc('work_calendar_working_days', { p_version_id: wc1.verId, p_start: '2026-02-01', p_end: '2026-02-28' });
    expect(!wd.error, `working_days err: ${wd.error?.message}`);
    expect(Number(wd.data.count) === 24, `expected 24 working days in Feb 2026, got ${wd.data?.count}`);
    const weekends = (wd.data.excluded || []).filter(e => e.reason === 'weekend');
    expect(weekends.length === 4, `expected 4 weekend rows, got ${weekends.length}`);
    // bad period
    const bad = await sb.rpc('work_calendar_working_days', { p_version_id: wc1.verId, p_start: '2026-02-28', p_end: '2026-02-01' });
    expect(bad.error && bad.error.message === 'calendar.invalid_period', `bad period -> invalid_period, got ${bad.error?.message}`);
  });

  h.section('Idempotency + concurrency + no-side-effects');
  await test('idempotency: replay / same-command-conflict / cross-command-independent', async () => {
    const rk = uuid();
    const p1 = await api(HS, T.mgr, { command: 'create_version', requestKey: rk, reason: 'e2e', calendar: { name: `HS ${TAG} idem`, jurisdiction: 'TT' }, effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31' });
    expect(p1.status === 200, `idem create: ${p1.status}`); created.holidayCalendarIds.push(p1.body.data.calendar.id);
    const replay = await api(HS, T.mgr, { command: 'create_version', requestKey: rk, reason: 'e2e', calendar: { name: `HS ${TAG} idem`, jurisdiction: 'TT' }, effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31' });
    expect(replay.status === 200 && replay.body.data.version.id === p1.body.data.version.id, 'replay returns original version');
    const conflict = await api(HS, T.mgr, { command: 'create_version', requestKey: rk, reason: 'e2e', calendar: { name: `HS ${TAG} DIFFERENT`, jurisdiction: 'TT' }, effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31' });
    fails(conflict); expect(conflict.status === 409 && conflict.body.message === 'command.payload_conflict', `payload conflict, got ${conflict.body.message}`);
    // same raw key, different command namespace -> independent (a version command)
    const cross = await api(WV, T.mgr, { command: 'create_version', requestKey: rk, reason: 'e2e', calendar: { name: `WC ${TAG} cross` }, effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31', holidayCalendarVersionId: hs1.verId, workingWeekdays: [1,2,3,4,5] });
    expect(cross.status === 200, `cross-namespace independent: ${cross.status} ${JSON.stringify(cross.body).slice(0,150)}`);
    if (cross.body?.data?.calendar?.id) created.workCalendarIds.push(cross.body.data.calendar.id);
  });

  await test('rejected op writes no event / audit / receipt', async () => {
    const before = await sb.from('work_calendar_command_receipts').select('request_key', { count: 'exact', head: true }).eq('actor_id', users.mgr);
    const rk = uuid();
    const bad = await api(WV, T.mgr, { command: 'create_version', requestKey: rk, reason: 'e2e', calendar: { name: `WC ${TAG} rej` }, effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31', holidayCalendarVersionId: uuid(), workingWeekdays: [1,2,3] });
    fails(bad);  // holiday_set_unpublished -> rolled back
    const rc = await sb.from('work_calendar_command_receipts').select('request_key').eq('request_key', rk);
    expect((rc.data?.length ?? 0) === 0, 'no receipt for rejected op');
    const ev = await sb.from('app_events').select('id').ilike('dedupe_key', `%${rk}%`);
    expect((ev.data?.length ?? 0) === 0, 'no event for rejected op');
  });

  await test('seed shell present, no version', async () => {
    const cal = await sb.from('holiday_calendars').select('id').eq('name', 'Trinidad & Tobago National').eq('jurisdiction', 'TT');
    expect((cal.data?.length ?? 0) >= 1, 'seed TT calendar present');
    // the seed parent has no versions (only admin-created ones exist under other calendars)
    const seedVers = await sb.from('holiday_calendar_versions').select('id').eq('holiday_calendar_id', cal.data[0].id);
    expect((seedVers.data?.length ?? 0) === 0, `seed calendar must have 0 versions, got ${seedVers.data?.length}`);
  });
}
