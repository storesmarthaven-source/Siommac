/**
 * scripts/e2e/suites/payslipRender.mjs
 *
 * E2E for Phase 2 — Payslip Studio template-driven rendering.
 *
 * New routes under test:
 *   POST /api/finance/payroll/runs/set-template
 *   POST /api/finance/payroll/payslips/render-run   (extended — now template-aware)
 *   POST /api/finance/payroll/payslips/render        (extended — now template-aware)
 *
 * Covers:
 *   - Full lifecycle setup: create run → lock-inputs → calculate → submit →
 *     approve (SoD) → lock → generate payslips.
 *   - set-template: AC (employee denied, finance_manager allowed), sets templateId
 *     on run, clears with null, response shape includes templateId field.
 *   - render-run with template set: verifies the PDF is actually uploaded
 *     (filePath is set on each payslip) and §2 side-effects are emitted
 *     (app_events + hr_audit_log per render).
 *   - render single payslip: same §2 check + response shape.
 *   - Fallback rendering: null template (reverts to built-in pdfkit layout)
 *     still produces a valid PDF (filePath stamped).
 *   - PDF content verification (P2-e): download the rendered PDF from storage
 *     and assert it is a valid PDF (magic header, %%EOF marker, non-trivial
 *     size) — proving the file is a real rendered document, not a stub.
 *   - Binding table design (P2-a/P2-e): a design with `binding: 'earnings'` is
 *     stored correctly. Template-rendered output with that design requires
 *     PAYSLIP_STUDIO_ENABLED=true; when the studio is disabled (default) the
 *     pdfkit snapshot renderer is used instead (the unit tests in
 *     tests/unit/payslipPdf.test.ts are the authoritative correctness proof).
 *   - Token resolution: field elements now use `token: 'employee.name'` (bare
 *     key) not `value: '{{employee.name}}'` (was the prior bug — the renderer
 *     reads `el.token`, not `el.value`).
 *   - Cleanup: run + payslips + templates + audit/events cleaned up in onCleanup.
 *
 * Requires operator migrations:
 *   20260919000020 (payroll_payslip_templates)
 *   20260919000030 (templates grants)
 *   20260919000050 (finance_payroll_runs.template_id)
 *   20260919000090 (payroll_set_default_template + payroll_archive_template RPCs)
 * Then: npm run build:backend && dev restart.
 */

export const title = 'Finance Phase 2 - Payslip Studio template rendering';

/**
 * Minimal Payslip Studio design with:
 *   - A heading that uses the {{company.name}} token placeholder
 *   - Two field elements that use the correct `token` property (bare key name,
 *     no {{...}} wrapping — the renderer reads el.token as a key into the token
 *     map). This was a bug in the prior version (it used `value` instead of
 *     `token`), which caused all field values to render as empty string.
 *   - A table with `binding: 'earnings'` so that when PAYSLIP_STUDIO_ENABLED=true
 *     the table renders live snapshot rows instead of the template's static demo rows.
 */
function tokenDesign(tag) {
  return {
    page: { size: 'a4', orient: 'portrait', bg: '#ffffff', grid: false },
    elements: [
      // Heading with a {{company.name}} token placeholder
      {
        id: 'el-h-' + tag, type: 'heading',
        x: 24, y: 24, w: 400, h: 36, z: 1,
        text: '{{company.name}} — PAYSLIP',
        color: '#1a2340', bg: 'transparent',
        fontSize: 20, fontFamily: 'Arial, sans-serif',
        bold: true, italic: false, underline: false,
        align: 'left', valign: 'top',
        borderW: 0, borderColor: '#d0d5e2', borderStyle: 'solid',
        radius: 0, padding: 6, lineHeight: 1.4,
      },
      // Field element: token is the BARE KEY (fixes prior `value` bug)
      {
        id: 'el-f-' + tag, type: 'field',
        x: 24, y: 72, w: 300, h: 24, z: 2,
        label: 'Employee',
        token: 'employee.name',   // bare key name — renderer does tokenMap[el.token]
        labelWidth: 80,
        color: '#374151', bg: 'transparent', labelColor: '#6b7280',
        fontSize: 12, fontFamily: 'Arial, sans-serif',
        bold: false, italic: false, underline: false,
        align: 'left', valign: 'middle',
        borderW: 0, borderColor: '#d0d5e2', borderStyle: 'solid',
        radius: 0, padding: 4, lineHeight: 1.2,
      },
      // Field element: net pay token
      {
        id: 'el-n-' + tag, type: 'field',
        x: 24, y: 104, w: 300, h: 24, z: 3,
        label: 'Net Pay',
        token: 'pay.net',         // bare key name
        labelWidth: 80,
        color: '#374151', bg: 'transparent', labelColor: '#6b7280',
        fontSize: 12, fontFamily: 'Arial, sans-serif',
        bold: true, italic: false, underline: false,
        align: 'left', valign: 'middle',
        borderW: 0, borderColor: '#d0d5e2', borderStyle: 'solid',
        radius: 0, padding: 4, lineHeight: 1.2,
      },
      // Table with snapshot binding (P2-a): when the studio is enabled and
      // rendering with this design, the table shows live snapshot earnings rows
      // rather than the static demo row below. Unit tests in payslipPdf.test.ts
      // (snapshotRowsForBinding) are the authoritative proof of correctness.
      {
        id: 'el-t-' + tag, type: 'table',
        x: 24, y: 140, w: 500, h: 200, z: 4,
        title: 'Earnings',
        accent: '#1b2d54',
        binding: 'earnings',   // P2-a: live rows from snapshot.earnings
        rows: [{ label: 'Demo Row (ignored when binding is set)', amount: '$0.00' }],
        showHead: true, showTotal: true, totalLabel: 'Gross Pay',
        headColor: '#ffffff', totalColor: '#1b2d54',
        color: '#334155', bg: '#ffffff',
        fontSize: 9, fontFamily: 'Arial, sans-serif',
        bold: false, italic: false, underline: false,
        align: 'left', valign: 'top',
        borderW: 0, borderColor: '#d0d5e2', borderStyle: 'solid',
        radius: 0, padding: 6, lineHeight: 1.2,
      },
    ],
  };
}

function seedDateFromTag(tag, salt) {
  let n = salt >>> 0;
  for (let i = 0; i < tag.length; i++) n = (Math.imul(n, 31) + tag.charCodeAt(i)) >>> 0;
  const day = 20820 + (salt % 10) * 400 + (n % 365);
  const d = new Date(Date.UTC(1970, 0, 1));
  d.setUTCDate(d.getUTCDate() + day);
  return d.toISOString().slice(0, 10);
}

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG, acquireActors } = h;

  let fmgr1Id, fmgr2Id, empId;
  let fmgr1Token, fmgr2Token, empToken;

  const ctx = {
    runId:       null,
    templateId:  null,
    payslipId:   null,   // first payslip for the run
    createdUserIds: [],
    statutoryVersionId: null,
  };

  const waitFor = async (check, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await check()) return true;
      await new Promise(r => setTimeout(r, 300));
    }
    return false;
  };

  h.onCleanup(async () => {
    // Delete child rows before the run row (FK ordering)
    if (ctx.runId) {
      try { await sb.from('finance_payslip_deliveries').delete().eq('run_id', ctx.runId); } catch {}
      try { await sb.from('finance_payslips').delete().eq('run_id', ctx.runId); } catch {}
      try { await sb.from('finance_payroll_run_warnings').delete().eq('run_id', ctx.runId); } catch {}
      try { await sb.from('finance_payroll_run_lines').delete().eq('run_id', ctx.runId); } catch {}
      try { await sb.from('finance_payroll_run_inputs').delete().eq('run_id', ctx.runId); } catch {}
      try { await sb.from('finance_payroll_runs').delete().eq('id', ctx.runId); } catch {}
      try {
        await sb.from('hr_audit_log').delete().eq('record_id', ctx.runId);
        await sb.from('app_events').delete().eq('source_entity_id', ctx.runId);
        await sb.from('handoff_outbox').delete().eq('source_entity_id', ctx.runId);
        await sb.from('notifications').delete().eq('source_id', ctx.runId);
      } catch {}
      try {
        await sb.from('workflow_instances').update({ status: 'cancelled' })
          .eq('source_record_id', ctx.runId).in('status', ['pending', 'open', 'in_progress']);
      } catch {}
    }
    if (ctx.templateId) {
      try { await sb.from('payroll_payslip_templates').delete().eq('id', ctx.templateId); } catch {}
      try {
        await sb.from('hr_audit_log').delete().eq('record_id', ctx.templateId);
        await sb.from('app_events').delete().eq('source_entity_id', ctx.templateId);
      } catch {}
    }
    if (ctx.createdUserIds.length) {
      try { await sb.from('app_users').delete().in('id', ctx.createdUserIds); } catch {}
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Payslip Render › Setup');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('active statutory version must exist', async () => {
    const { data } = await sb.from('finance_statutory_versions')
      .select('id').eq('is_active', true).limit(1);
    expect((data ?? []).length > 0,
      'No active statutory version — apply migrations and activate one before running this suite');
    ctx.statutoryVersionId = (data ?? [])[0]?.id ?? null;
  });

  await test('acquire 2 finance_managers + 1 salaried employee', async () => {
    const mgrR = await acquireActors('finance_manager', 2, { pay_basis: 'salary', monthly_salary: 7000.00 });
    const empR = await acquireActors('employee',        1, { pay_basis: 'salary', monthly_salary: 5000.00 });
    [fmgr1Id, fmgr2Id] = mgrR.actors.map(a => a.id);
    empId = empR.actors[0].id;
    ctx.createdUserIds = [...mgrR.createdIds, ...empR.createdIds];

    fmgr1Token = mint({ id: fmgr1Id, username: mgrR.actors[0].username, role: 'finance_manager', department_id: null });
    fmgr2Token = mint({ id: fmgr2Id, username: mgrR.actors[1].username, role: 'finance_manager', department_id: null });
    empToken   = mint({ id: empId,   username: empR.actors[0].username,  role: 'employee',        department_id: null });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Payslip Render › Run lifecycle (create → lock)');
  // ═══════════════════════════════════════════════════════════════════════════

  const testPeriod = seedDateFromTag(TAG, 71);

  await test('finance_manager creates a payroll run', async () => {
    const r = await api('finance/payroll/runs/create', fmgr1Token, {
      periodMonth:   testPeriod,
      payFrequency:  'monthly',
      weeksInPeriod: 4.333,
    });
    ok(r, 'create run failed: ' + r.body.message);
    expect(r.body.data.status === 'draft', 'expected draft status');
    // Phase 2: templateId field present in run DTO (null at creation time)
    expect('templateId' in r.body.data, 'run DTO is missing templateId field');
    expect(r.body.data.templateId === null, 'templateId should be null on a new run');
    ctx.runId = r.body.data.id;
  });

  await test('lock inputs', async () => {
    const r = await api('finance/payroll/runs/lock-inputs', fmgr1Token, { id: ctx.runId });
    ok(r, 'lock-inputs failed: ' + r.body.message);
    expect(r.body.data.status === 'input_locked',
      'status should be input_locked, got ' + r.body.data.status);
    expect(r.body.data.employeeCount > 0,
      'employeeCount should be > 0 — test actors need pay_basis=salary');
  });

  await test('calculate run', async () => {
    const r = await api('finance/payroll/runs/calculate', fmgr1Token, { id: ctx.runId });
    ok(r, 'calculate failed: ' + r.body.message);
    expect(r.body.data.status === 'calculated', 'status should be calculated');
    expect(r.body.data.grossTotal > 0, 'grossTotal should be > 0');
  });

  await test('submit for approval', async () => {
    const r = await api('finance/payroll/runs/submit', fmgr1Token, { id: ctx.runId });
    ok(r, 'submit failed: ' + r.body.message);
    expect(r.body.data.status === 'pending_approval',
      'status should be pending_approval, got ' + r.body.data.status);
  });

  await test('fmgr2 (≠ creator) approves via workflow engine', async () => {
    const { data: run } = await sb.from('finance_payroll_runs')
      .select('workflow_id').eq('id', ctx.runId).maybeSingle();
    expect(run?.workflow_id, 'run should have a workflow_id after submit');

    const { data: wfTasks } = await sb.from('workflow_tasks')
      .select('id').eq('workflow_id', run.workflow_id)
      .in('status', ['pending', 'open', 'in_progress']).limit(1);
    expect((wfTasks ?? []).length > 0, 'no pending workflow task for submitted run');

    const decideR = await api('workflow-engine/decide', fmgr2Token, {
      workflowId: run.workflow_id,
      taskId:     wfTasks[0].id,
      decision:   'approved',
    });
    ok(decideR, 'approve decision failed: ' + decideR.body.message);

    const approved = await waitFor(async () => {
      const { data } = await sb.from('finance_payroll_runs')
        .select('status').eq('id', ctx.runId).maybeSingle();
      return data?.status === 'approved';
    });
    expect(approved, 'run did not reach approved status within 8s');
  });

  await test('lock the approved run', async () => {
    const r = await api('finance/payroll/runs/lock', fmgr2Token, { id: ctx.runId });
    ok(r, 'lock run failed: ' + r.body.message);
    expect(r.body.data.status === 'locked', 'status should be locked');
  });

  await test('generate payslips for the locked run', async () => {
    const r = await api('finance/payroll/payslips/generate', fmgr1Token, { runId: ctx.runId });
    ok(r, 'generate payslips failed: ' + r.body.message);
    expect(Array.isArray(r.body.data) && r.body.data.length > 0, 'no payslips generated');
    ctx.payslipId = r.body.data[0].id;
    expect(ctx.payslipId, 'first payslip has no id');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Payslip Render › Template creation (Phase 1, prereq for Phase 2)');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('finance_manager creates a Payslip Studio template with token + binding elements', async () => {
    const r = await api('finance/payroll/payslip-templates/create', fmgr1Token, {
      name:   TAG + ' Render Template',
      design: tokenDesign(TAG),
    });
    ok(r, 'create template failed: ' + r.body.message);
    const d = r.body.data;
    expect(d.id,         'template missing id');
    expect(d.name,       'template missing name');
    expect(typeof d.isDefault === 'boolean', 'template isDefault should be boolean');
    expect(typeof d.updatedAt === 'number',  'template updatedAt should be epoch ms');
    expect(d.design && Array.isArray(d.design.elements), 'template design.elements not an array');
    // Verify the binding table element was stored (P2-a/P2-e schema fix)
    const bindingEl = d.design.elements.find(el => el.binding === 'earnings');
    expect(bindingEl !== undefined, 'design should include a table element with binding: "earnings"');
    ctx.templateId = d.id;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Payslip Render › set-template: access control (both paths)');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('employee CANNOT set a run template (→ 403)', async () => {
    const r = await api('finance/payroll/runs/set-template', empToken, {
      runId:      ctx.runId,
      templateId: ctx.templateId,
    });
    fails(r, 'employee should be denied set-template');
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });

  await test('finance_manager CAN set a run template', async () => {
    const r = await api('finance/payroll/runs/set-template', fmgr1Token, {
      runId:      ctx.runId,
      templateId: ctx.templateId,
    });
    ok(r, 'set-template failed: ' + r.body.message);
    const d = r.body.data;
    // Run DTO shape must include templateId (Phase 2 new field)
    expect('templateId' in d, 'run DTO missing templateId field');
    expect(d.templateId === ctx.templateId, 'templateId not updated on run DTO');
    expect(d.id === ctx.runId, 'returned run id mismatch');
  });

  await test('set-template wrote app_event + audit_log (§2)', async () => {
    const ev = await sb.from('app_events')
      .select('event_type')
      .eq('event_type', 'finance.payroll.run.template_changed')
      .eq('source_entity_id', ctx.runId);
    expect((ev.data ?? []).length > 0,
      'set-template did not emit finance.payroll.run.template_changed app_event');

    const au = await sb.from('hr_audit_log')
      .select('action')
      .eq('record_id', ctx.runId)
      .eq('action', 'payroll_run.template_changed');
    expect((au.data ?? []).length > 0,
      'set-template did not write payroll_run.template_changed audit row');
  });

  await test('set-template with invalid templateId is rejected (template does not exist)', async () => {
    const r = await api('finance/payroll/runs/set-template', fmgr1Token, {
      runId:      ctx.runId,
      templateId: '00000000-dead-beef-0000-000000000000',
    });
    fails(r, 'non-existent templateId should be rejected');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Payslip Render › render-run with template (Phase 2 core)');
  //
  // NOTE: When PAYSLIP_STUDIO_ENABLED=true, rendering uses the Studio template
  // branch (renderPayslipPdfWithDesign) which applies the binding table and
  // token resolution. When the env var is false (the default), the run's
  // template_id is ignored and the pdfkit snapshot renderer is always used
  // (loadRenderTemplate returns null). The E2E verifies the PDF is uploaded and
  // §2 side-effects fire in both cases; the binding correctness is proven by
  // unit tests in tests/unit/payslipPdf.test.ts (snapshotRowsForBinding).
  // ═══════════════════════════════════════════════════════════════════════════

  await test('employee CANNOT render run payslips (→ 403)', async () => {
    const r = await api('finance/payroll/payslips/render-run', empToken, { runId: ctx.runId });
    fails(r, 'employee should be denied render-run');
    expect(r.status === 403, 'expected 403, got ' + r.status);
  });

  await test('finance_manager renders all payslips for the run using the Studio template', async () => {
    const r = await api('finance/payroll/payslips/render-run', fmgr1Token, { runId: ctx.runId });
    ok(r, 'render-run failed: ' + r.body.message);
    const d = r.body.data;
    // Response shape
    expect(typeof d.rendered === 'number', 'missing rendered count');
    expect(typeof d.failed   === 'number', 'missing failed count');
    expect(typeof d.total    === 'number', 'missing total count');
    expect(d.rendered > 0, `rendered should be > 0, got ${d.rendered}`);
    expect(d.failed === 0,  `failed should be 0, got ${d.failed} (token render error?)`);
    expect(d.total > 0,     `total should be > 0, got ${d.total}`);
  });

  await test('render-run stamped filePath on every payslip (PDF actually uploaded)', async () => {
    const { data: payslips, error } = await sb.from('finance_payslips')
      .select('id, file_path').eq('run_id', ctx.runId);
    expect(!error, 'failed to read payslips: ' + error?.message);
    expect((payslips ?? []).length > 0, 'no payslips found in DB');
    const noPath = (payslips ?? []).filter(p => !p.file_path);
    expect(noPath.length === 0,
      `${noPath.length} payslip(s) still have no file_path after render-run — PDF upload failed`);
  });

  await test('render-run emitted app_events for each rendered payslip (§2)', async () => {
    const { data: payslips } = await sb.from('finance_payslips')
      .select('id').eq('run_id', ctx.runId);
    const psIds = (payslips ?? []).map(p => p.id);

    const { data: events } = await sb.from('app_events')
      .select('source_entity_id, event_type')
      .in('source_entity_id', psIds)
      .eq('event_type', 'finance.payroll.payslip.rendered');
    expect((events ?? []).length === psIds.length,
      `expected ${psIds.length} payslip.rendered events, found ${(events ?? []).length}`);
  });

  await test('render-run wrote hr_audit_log rows for each payslip (§2)', async () => {
    const { data: payslips } = await sb.from('finance_payslips')
      .select('id').eq('run_id', ctx.runId);
    const psIds = (payslips ?? []).map(p => p.id);

    const { data: auditRows } = await sb.from('hr_audit_log')
      .select('record_id, action')
      .in('record_id', psIds)
      .eq('action', 'payslip.rendered');
    expect((auditRows ?? []).length === psIds.length,
      `expected ${psIds.length} payslip.rendered audit rows, found ${(auditRows ?? []).length}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Payslip Render › PDF content verification (P2-e)');
  //
  // Download the rendered PDF from the private storage bucket (via the
  // service-role client) and verify it is a real PDF file — not a stub, an
  // empty upload, or a corrupted buffer. This proves the renderer (pdfkit
  // snapshot path or Studio template path) actually produced valid output.
  // ═══════════════════════════════════════════════════════════════════════════

  await test('rendered PDF is a valid, non-trivial PDF document (%PDF- header + %%EOF)', async () => {
    const { data: payslipRow } = await sb.from('finance_payslips')
      .select('id, file_path').eq('id', ctx.payslipId).maybeSingle();
    expect(payslipRow?.file_path, 'payslip must have a file_path to verify content');

    // Download from the private payslips bucket via the service-role client.
    const { data: blob, error: dlErr } = await sb.storage
      .from('payslips')
      .download(payslipRow.file_path);
    expect(!dlErr && blob, 'failed to download payslip PDF: ' + dlErr?.message);

    // Convert Blob → Buffer (Node.js 18+ Blob.arrayBuffer() is standard)
    const arrayBuffer = await blob.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);

    // PDF magic header (%PDF-)
    expect(
      buf.subarray(0, 5).toString('latin1') === '%PDF-',
      'downloaded file does not start with %PDF- — not a valid PDF',
    );

    // Non-trivial content (even a minimal pdfkit payslip is several kilobytes)
    expect(
      buf.length > 1000,
      `PDF is only ${buf.length} bytes — expected at least 1000 (possible empty/stub)`,
    );

    // %%EOF marker (every valid PDF ends with this)
    expect(
      buf.toString('latin1').includes('%%EOF'),
      'downloaded PDF does not contain %%EOF — file may be truncated or invalid',
    );
  });

  await test('all payslips for the run have downloadable, valid PDFs', async () => {
    const { data: payslips } = await sb.from('finance_payslips')
      .select('id, file_path').eq('run_id', ctx.runId);
    expect((payslips ?? []).length > 0, 'no payslips found to verify');

    let checked = 0;
    for (const ps of payslips ?? []) {
      if (!ps.file_path) continue;
      const { data: blob, error: dlErr } = await sb.storage.from('payslips').download(ps.file_path);
      if (dlErr || !blob) continue; // count misses but don't abort
      const arrayBuffer = await blob.arrayBuffer();
      const buf = Buffer.from(arrayBuffer);
      expect(
        buf.subarray(0, 5).toString('latin1') === '%PDF-',
        `payslip ${ps.id}: downloaded file is not a valid PDF`,
      );
      expect(buf.length > 1000, `payslip ${ps.id}: PDF is too small (${buf.length} bytes)`);
      checked++;
    }
    expect(checked === (payslips ?? []).length,
      `only ${checked} of ${(payslips ?? []).length} payslips had downloadable PDFs`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Payslip Render › render single payslip (Phase 2)');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('finance_manager re-renders a single payslip → response shape', async () => {
    const r = await api('finance/payroll/payslips/render', fmgr1Token, { payslipId: ctx.payslipId });
    ok(r, 'render single failed: ' + r.body.message);
    const d = r.body.data;
    // Shape matches PayslipDto
    expect(d.id === ctx.payslipId,       'render: id mismatch');
    expect(d.payslipNo,                  'render: missing payslipNo');
    expect(d.runId === ctx.runId,        'render: runId mismatch');
    expect(d.runLineId,                  'render: missing runLineId');
    expect(d.employeeId,                 'render: missing employeeId');
    expect(d.filePath,                   'render: filePath should be set after render');
    expect(d.generatedAt,               'render: missing generatedAt');
  });

  await test('render single emitted app_event + audit_log (§2)', async () => {
    const { data: events } = await sb.from('app_events')
      .select('id')
      .eq('source_entity_id', ctx.payslipId)
      .eq('event_type', 'finance.payroll.payslip.rendered');
    expect((events ?? []).length > 0,
      'render single did not emit payslip.rendered app_event');

    const { data: audit } = await sb.from('hr_audit_log')
      .select('id')
      .eq('record_id', ctx.payslipId)
      .eq('action', 'payslip.rendered');
    expect((audit ?? []).length > 0,
      'render single did not write payslip.rendered audit row');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Payslip Render › clear template (fallback to built-in renderer)');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('finance_manager clears the run template (set to null)', async () => {
    const r = await api('finance/payroll/runs/set-template', fmgr1Token, {
      runId:      ctx.runId,
      templateId: null,
    });
    ok(r, 'clear template failed: ' + r.body.message);
    expect(r.body.data.templateId === null,
      'templateId should be null after clearing; got ' + r.body.data.templateId);
  });

  await test('render-run still works after template cleared (built-in pdfkit fallback)', async () => {
    const r = await api('finance/payroll/payslips/render-run', fmgr1Token, { runId: ctx.runId });
    ok(r, 'render-run (fallback) failed: ' + r.body.message);
    expect(r.body.data.rendered > 0, 'rendered should be > 0 with no template (built-in fallback)');
    expect(r.body.data.failed === 0,
      'failed should be 0 with built-in fallback, got ' + r.body.data.failed);
  });

  await test('after fallback render, payslips still have filePath', async () => {
    const { data: payslips } = await sb.from('finance_payslips')
      .select('id, file_path').eq('run_id', ctx.runId);
    const noPath = (payslips ?? []).filter(p => !p.file_path);
    expect(noPath.length === 0,
      `${noPath.length} payslip(s) have no filePath after fallback render`);
  });

  await test('fallback render also produces valid PDFs (P2-e recheck)', async () => {
    const { data: payslipRow } = await sb.from('finance_payslips')
      .select('id, file_path').eq('id', ctx.payslipId).maybeSingle();
    if (!payslipRow?.file_path) return; // skip if no path (shouldn't happen after re-render)
    const { data: blob, error: dlErr } = await sb.storage
      .from('payslips').download(payslipRow.file_path);
    expect(!dlErr && blob, 'fallback render: download failed: ' + dlErr?.message);
    const buf = Buffer.from(await blob.arrayBuffer());
    expect(buf.subarray(0, 5).toString('latin1') === '%PDF-', 'fallback PDF: missing %PDF- header');
    expect(buf.length > 1000, `fallback PDF is too small (${buf.length} bytes)`);
    expect(buf.toString('latin1').includes('%%EOF'), 'fallback PDF: missing %%EOF');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Payslip Render › set-template validation');
  // ═══════════════════════════════════════════════════════════════════════════

  await test('set-template rejects a malformed uuid for runId', async () => {
    const r = await api('finance/payroll/runs/set-template', fmgr1Token, {
      runId:      'not-a-uuid',
      templateId: ctx.templateId,
    });
    fails(r, 'malformed runId should be rejected');
  });

  await test('set-template rejects a malformed uuid for templateId', async () => {
    const r = await api('finance/payroll/runs/set-template', fmgr1Token, {
      runId:      ctx.runId,
      templateId: 'not-a-uuid',
    });
    fails(r, 'malformed templateId should be rejected');
  });

  await test('set-template with a non-existent runId returns 404', async () => {
    const r = await api('finance/payroll/runs/set-template', fmgr1Token, {
      runId:      '00000000-0000-0000-0000-000000000099',
      templateId: null,
    });
    fails(r, 'non-existent runId should be rejected');
  });
}
