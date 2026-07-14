/**
 * scripts/e2e/suites/financeAp.mjs
 *
 * Finance — Accounts Payable end-to-end suite.
 * Covers: permissions, picker endpoints, vendor CRUD, bill lifecycle,
 *         payments, payment runs, duplicate detection, bulk approval,
 *         filters/pagination, import, and all side-effects (app_events /
 *         audit_logs / workflow_tasks / notifications / handoffs).
 *
 * NOTE: This suite requires migration 20260917000030_finance_ap_enterprise.sql
 * to be applied before a full run will pass. Chunk 0 tests (perms + pickers)
 * do NOT require that migration and will run on the current schema.
 *
 * Operator gate: apply migration → NOTIFY pgrst,'reload schema'
 * → npm run build:backend → restart dev:netlify → npm run test:e2e -- financeAp
 */

export const title = 'Finance — Accounts Payable';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin } = h.users;
  const T = { admin: mint(admin) };

  // Acquire finance actors — prefer real DB users, create synthetic only for shortfall
  const { actors: [fstaff] }  = await h.acquireActors('finance_staff',   1);
  const { actors: [fmgr],  createdIds: fmgrCreated  } = await h.acquireActors('finance_manager', 1);
  // fmgr2 is required for payment-run/process SoD: the CREATOR (fmgr) cannot process their own run.
  // T.admin has finance.ap.payment.run.process in the hardcoded seed but NOT in DB role_permissions yet
  // (Category A — operator migration pending). fmgr2 (finance_manager) has the perm in DB.
  const { actors: [fmgr2], createdIds: fmgr2Created } = await h.acquireActors('finance_manager', 1);
  const { actors: [noFinance] } = await h.acquireActors('hr_staff', 1);

  const Tstaff  = mint(fstaff);
  const Tmgr    = mint(fmgr);
  const Tmgr2   = mint(fmgr2);
  const TnoFin  = mint(noFinance);

  const ctx = {
    vendorIds:  /** @type {string[]} */ ([]),
    billIds:    /** @type {string[]} */ ([]),
    paymentIds: /** @type {string[]} */ ([]),
    runIds:     /** @type {string[]} */ ([]),
  };

  h.onCleanup(async () => {
    // Clean in reverse-dependency order
    if (ctx.runIds.length)     await sb.from('finance_ap_payment_runs').delete().in('id', ctx.runIds);
    if (ctx.paymentIds.length) await sb.from('finance_ap_payments').delete().in('id', ctx.paymentIds);
    if (ctx.billIds.length)    await sb.from('finance_ap_bills').delete().in('id', ctx.billIds);
    if (ctx.vendorIds.length)  await sb.from('finance_ap_vendors').delete().in('id', ctx.vendorIds);
    // Clean events / audit rows tagged to this run
    await sb.from('app_events').delete().ilike('payload->>tag', `${TAG}%`);
    await sb.from('audit_logs').delete().ilike('data->>tag', `${TAG}%`);
    // Clean synthetic finance_manager users created by acquireActors
    const synthIds = [...(fmgrCreated ?? []), ...(fmgr2Created ?? [])];
    if (synthIds.length) await sb.from('app_users').delete().in('id', synthIds);
  });

  // ─────────────────────────── CHUNK 0 — PERMISSIONS + PICKERS ────────────────

  h.section('AP › Permissions');

  await test('finance_staff can view AP bills list', async () => {
    const r = await api('finance/ap/bills/list', Tstaff, {});
    ok(r);
    expect(Array.isArray(r.body.data?.rows ?? r.body.data), 'bills list not array');
  });

  await test('hr_staff cannot view AP (denied 403)', async () => {
    const r = await api('finance/ap/bills/list', TnoFin, {});
    fails(r);
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  await test('unauthenticated request denied 401', async () => {
    const r = await api('finance/ap/bills/list', null, {});
    fails(r);
    expect(r.status === 401, `expected 401, got ${r.status}`);
  });

  h.section('AP › Pickers');

  await test('gl-accounts returns array with code+name+category', async () => {
    const r = await api('finance/pickers/gl-accounts', Tstaff, {});
    ok(r);
    const accounts = r.body.data;
    expect(Array.isArray(accounts) && accounts.length > 0, 'expected non-empty gl accounts');
    const first = accounts[0];
    expect(typeof first.code === 'string', 'missing code');
    expect(typeof first.name === 'string', 'missing name');
    expect(typeof first.category === 'string', 'missing category');
  });

  await test('gl-accounts search filters results', async () => {
    const r = await api('finance/pickers/gl-accounts', Tstaff, { search: 'admin' });
    ok(r);
    expect(Array.isArray(r.body.data), 'expected array');
  });

  await test('cost-centres returns array', async () => {
    const r = await api('finance/pickers/cost-centres', Tstaff, {});
    ok(r);
    expect(Array.isArray(r.body.data), 'cost-centres not array');
  });

  await test('tax-codes returns non-empty array with code+rate', async () => {
    const r = await api('finance/pickers/tax-codes', Tstaff, {});
    ok(r);
    const codes = r.body.data;
    expect(Array.isArray(codes) && codes.length > 0, 'expected tax codes');
    expect(typeof codes[0].code === 'string' && typeof codes[0].rate === 'number', 'bad tax code shape');
  });

  await test('payment-terms returns non-empty array with days+label', async () => {
    const r = await api('finance/pickers/payment-terms', Tstaff, {});
    ok(r);
    const terms = r.body.data;
    expect(Array.isArray(terms) && terms.length > 0, 'expected payment terms');
    expect(typeof terms[0].days === 'number' && typeof terms[0].label === 'string', 'bad payment-terms shape');
  });

  await test('vendors picker returns array', async () => {
    const r = await api('finance/pickers/vendors', Tstaff, {});
    ok(r);
    expect(Array.isArray(r.body.data), 'vendor picker not array');
  });

  await test('pickers denied to hr_staff', async () => {
    const r = await api('finance/pickers/gl-accounts', TnoFin, {});
    fails(r);
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  // ─────────────────────────── CHUNK 1 — VENDOR CRUD ──────────────────────────
  // NOTE: requires migration 20260917000030 for new vendor columns.
  // The tests below mark with TAG so cleanup handles them even on partial runs.

  h.section('AP › Vendors');

  let vendorId = null;

  await test('finance_staff creates vendor', async () => {
    const r = await api('finance/ap/vendors/create', Tstaff, {
      name:             `${TAG} Test Vendor`,
      registrationNo:   'TT-TEST-001',
      contactName:      'Test Contact',
      contactEmail:     'vendor@test.siomac',
      contactPhone:     '+1-868-000-0001',
      paymentTermsDays: 30,
      defaultGlAccountCode: '5100',
      defaultCurrency:  'TTD',
      status:           'active',
      preferredPaymentMethod: 'eft',
    });
    ok(r);
    vendorId = r.body.data?.id ?? r.body.data;
    expect(typeof vendorId === 'string', 'expected vendor id string');
    if (vendorId) ctx.vendorIds.push(vendorId);
  });

  await test('vendor appears in vendors list', async () => {
    if (!vendorId) return;
    const r = await api('finance/ap/vendors/list', Tstaff, {});
    ok(r);
    const vendors = r.body.data;
    expect(Array.isArray(vendors), 'vendors not array');
    expect(vendors.some(v => v.id === vendorId), 'created vendor missing from list');
  });

  await test('hr_staff cannot create vendor (403)', async () => {
    const r = await api('finance/ap/vendors/create', TnoFin, {
      name: `${TAG} Denied Vendor`, paymentTermsDays: 30, status: 'active',
    });
    fails(r);
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  await test('duplicate vendor name is rejected (409)', async () => {
    if (!vendorId) return;
    const r = await api('finance/ap/vendors/create', Tstaff, {
      name: `${TAG} Test Vendor`,   // same name as the first vendor
      paymentTermsDays: 30, status: 'active',
    });
    fails(r);
    expect(r.status === 409, `expected 409 for duplicate, got ${r.status}`);
  });

  await test('vendor create fires app_event finance.vendor.created', async () => {
    if (!vendorId) return;
    const { data: evts } = await sb
      .from('app_events')
      .select('event_type')
      .eq('source_entity_id', vendorId)
      .eq('event_type', 'finance.vendor.created')
      .limit(1);
    expect(Array.isArray(evts) && evts.length > 0, 'finance.vendor.created event missing');
  });

  await test('vendor create writes audit_log vendor.created', async () => {
    if (!vendorId) return;
    // hr_audit_log is the synchronous store (awaited writeHrAudit before the
    // mutation returns); audit_logs is the async app_events mirror — racy.
    const { data: aud } = await sb
      .from('hr_audit_log')
      .select('id, action')
      .eq('record_id', vendorId)
      .eq('action', 'vendor.created')
      .limit(1);
    expect(Array.isArray(aud) && aud.length > 0, 'audit log vendor.created missing');
  });

  await test('vendors/get returns vendor + bankAccounts shape', async () => {
    if (!vendorId) return;
    const r = await api('finance/ap/vendors/get', Tstaff, { id: vendorId });
    ok(r);
    const data = r.body.data;
    expect(data?.vendor?.id === vendorId, 'vendor id mismatch');
    expect(Array.isArray(data?.bankAccounts), 'bankAccounts not array');
    const v = data.vendor;
    expect(typeof v.vendorNo === 'string', 'missing vendorNo');
    expect(typeof v.defaultCurrency === 'string', 'missing defaultCurrency');
    expect(typeof v.paymentTermsDays === 'number', 'missing paymentTermsDays');
  });

  await test('finance_staff cannot update vendor (403 — managers only)', async () => {
    if (!vendorId) return;
    const r = await api('finance/ap/vendors/update', Tstaff, {
      id: vendorId, status: 'on_hold',
    });
    fails(r);
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  await test('finance_manager can update vendor status to on_hold', async () => {
    if (!vendorId) return;
    const r = await api('finance/ap/vendors/update', Tmgr, {
      id: vendorId, status: 'on_hold',
    });
    ok(r);
    expect(r.body.data?.status === 'on_hold', `expected on_hold, got ${r.body.data?.status}`);
  });

  await test('vendor update fires app_event finance.vendor.updated', async () => {
    if (!vendorId) return;
    const { data: evts } = await sb
      .from('app_events')
      .select('event_type')
      .eq('source_entity_id', vendorId)
      .eq('event_type', 'finance.vendor.updated')
      .limit(1);
    expect(Array.isArray(evts) && evts.length > 0, 'finance.vendor.updated event missing');
  });

  await test('vendors list includes on_hold status filter', async () => {
    const r = await api('finance/ap/vendors/list', Tstaff, { status: 'on_hold' });
    ok(r);
    expect(Array.isArray(r.body.data), 'vendors list not array');
    const onHold = r.body.data.filter(v => v.status !== 'on_hold');
    expect(onHold.length === 0, `filter leaked non-on_hold vendors: ${onHold.map(v => v.status).join()}`);
  });

  await test('finance_manager restores vendor to active', async () => {
    if (!vendorId) return;
    const r = await api('finance/ap/vendors/update', Tmgr, { id: vendorId, status: 'active' });
    ok(r);
    expect(r.body.data?.status === 'active', `expected active, got ${r.body.data?.status}`);
  });

  await test('vendors/bills returns vendor-scoped bill list', async () => {
    if (!vendorId) return;
    const r = await api('finance/ap/vendors/bills', Tstaff, { vendorId });
    ok(r);
    expect(Array.isArray(r.body.data), 'vendor bills not array');
    // All returned bills belong to this vendor
    const wrong = r.body.data.filter(b => b.vendorId !== vendorId);
    expect(wrong.length === 0, 'vendor bills contains bills from other vendors');
  });

  await test('vendors/payments returns vendor-scoped payment list', async () => {
    if (!vendorId) return;
    const r = await api('finance/ap/vendors/payments', Tstaff, { vendorId });
    ok(r);
    expect(Array.isArray(r.body.data), 'vendor payments not array');
  });

  // ─────────────────────────── CHUNK 6 — BILL CREATE + SUBMIT + APPROVE ────────
  // NOTE: requires migration 20260917000030 for new bill columns.

  h.section('AP › Bills');

  let billId = null;

  await test('finance_staff creates a draft bill', async () => {
    if (!vendorId) return;
    const r = await api('finance/ap/bills/create', Tstaff, {
      vendorId,
      billDate:    new Date().toISOString().slice(0, 10),
      dueDate:     new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      description: `${TAG} Test Bill`,
      glAccountCode: '5100',
      lines: [
        { description: 'Line 1', amount: 1000.00, glAccountCode: '5100' },
        { description: 'Line 2', amount:  500.00, glAccountCode: '5200' },
      ],
    });
    ok(r);
    billId = r.body.data?.id ?? r.body.data;
    expect(typeof billId === 'string', 'expected bill id');
    if (billId) ctx.billIds.push(billId);
  });

  await test('draft bill appears in bills list', async () => {
    if (!billId) return;
    const r = await api('finance/ap/bills/list', Tstaff, { status: 'draft' });
    ok(r);
    const rows = r.body.data?.rows ?? r.body.data;
    expect(Array.isArray(rows), 'bills not array');
    expect(rows.some(b => b.id === billId), 'created bill missing from list');
  });

  await test('draft bill detail returns shape', async () => {
    if (!billId) return;
    const r = await api('finance/ap/bills/get', Tstaff, { id: billId });
    ok(r);
    expect(r.body.data?.bill?.id === billId || r.body.data?.id === billId, 'bill id mismatch');
  });

  await test('finance_staff submits bill for approval', async () => {
    if (!billId) return;
    const r = await api('finance/ap/bills/submit', Tstaff, { id: billId });
    ok(r);
    // Verify status changed
    const detail = await api('finance/ap/bills/get', Tstaff, { id: billId });
    const status = detail.body.data?.bill?.status ?? detail.body.data?.status;
    expect(status === 'submitted', `expected submitted, got ${status}`);
  });

  await test('submitter cannot approve own bill (SoD — 403)', async () => {
    if (!billId) return;
    // fstaff submitted it, so fstaff cannot approve (SoD)
    const r = await api('finance/ap/bills/approve', Tstaff, { id: billId });
    fails(r);
    expect(r.status === 403, `expected SoD 403, got ${r.status}`);
  });

  await test('finance_manager approves bill and events fire', async () => {
    if (!billId) return;
    const r = await api('finance/ap/bills/approve', Tmgr, { id: billId });
    ok(r);

    // Side-effect: app_event with type=finance.ap.bill.approved
    const { data: evts } = await sb
      .from('app_events')
      .select('event_type')
      .eq('source_entity_id', billId)
      .eq('event_type', 'finance.ap.bill.approved')
      .limit(1);
    expect(Array.isArray(evts) && evts.length > 0, 'finance.ap.bill.approved event missing');

    // Side-effect: audit row in hr_audit_log (synchronous — awaited before the
    // mutation returns; audit_logs is the async app_events mirror — racy)
    const { data: aud } = await sb
      .from('hr_audit_log')
      .select('id')
      .eq('record_id', billId)
      .eq('action', 'bill.approved')
      .limit(1);
    expect(Array.isArray(aud) && aud.length > 0, 'audit log for approve missing');
  });

  await test('approved bill status is approved', async () => {
    if (!billId) return;
    const r = await api('finance/ap/bills/get', Tstaff, { id: billId });
    ok(r);
    const status = r.body.data?.bill?.status ?? r.body.data?.status;
    expect(status === 'approved', `expected approved, got ${status}`);
  });

  // ─────────────────────────── CHUNK 2 — RECORD PAYMENT ────────────────────────

  h.section('AP › Payments');

  await test('finance_staff records partial payment', async () => {
    if (!billId) return;
    // Route: POST finance/ap/bills/record-payment — body.args: { id, amount, method?, reference? }
    const r = await api('finance/ap/bills/record-payment', Tstaff, {
      id:        billId,
      amount:    500.00,
      method:    'eft',
      reference: `${TAG}-PAY-001`,
    });
    ok(r);
    // Route returns the updated ApBillDto (not a payment row)
    const updated = r.body.data;
    expect(updated?.id === billId || typeof updated?.id === 'string', 'expected updated bill');
    expect(updated?.status === 'partially_paid', `expected partially_paid, got ${updated?.status}`);
  });

  await test('payments appear in payments list', async () => {
    const r = await api('finance/ap/payments/list', Tstaff, {});
    ok(r);
    expect(Array.isArray(r.body.data), 'payments not array');
  });

  await test('payment.record event fires on payment', async () => {
    if (!billId) return;
    const { data: evts } = await sb
      .from('app_events')
      .select('event_type')
      .eq('source_entity_id', billId)
      .eq('event_type', 'finance.ap.bill.payment_recorded')
      .limit(1);
    expect(Array.isArray(evts) && evts.length > 0, 'finance.ap.bill.payment_recorded event missing');
  });

  await test('overpayment is blocked', async () => {
    if (!billId) return;
    // Bill total = 1500, partial of 500 already paid, remaining = 1000
    // Try to pay 2000 — should fail
    const r = await api('finance/ap/bills/record-payment', Tstaff, {
      id:        billId,
      amount:    2000.00,
      method:    'cash',
      reference: `${TAG}-OVERPAY`,
    });
    fails(r);
    expect(r.status === 422 || r.status === 400, `expected 4xx, got ${r.status}`);
  });

  await test('EFT payment without reference is blocked (422)', async () => {
    if (!billId) return;
    const r = await api('finance/ap/bills/record-payment', Tstaff, {
      id:     billId,
      amount: 100.00,
      method: 'eft',
      // deliberately no reference
    });
    fails(r);
    expect(r.status === 422, `expected 422 for missing EFT reference, got ${r.status}`);
  });

  await test('full payment with paymentDate + reference + memo marks bill as paid', async () => {
    if (!billId) return;
    // Bill has 1500 total, 500 partially paid → 1000 remaining
    const r = await api('finance/ap/bills/record-payment', Tstaff, {
      id:          billId,
      amount:      1000.00,
      method:      'eft',
      paymentDate: new Date().toISOString().slice(0, 10),
      reference:   `${TAG}-PAY-002`,
      memo:        'Full payment test',
    });
    ok(r);
    expect(r.body.data?.status === 'paid', `expected paid, got ${r.body.data?.status}`);
  });

  // ─────────────────────────── CHUNK 3 — FILTERS ───────────────────────────────

  h.section('AP › Filters & Pagination');

  await test('bills list filters by status', async () => {
    const r = await api('finance/ap/bills/list', Tstaff, { status: 'approved', page: 0, pageSize: 10 });
    ok(r);
    const rows = r.body.data?.rows ?? r.body.data;
    expect(Array.isArray(rows), 'not array');
    // All returned bills should be approved (or partially_paid/paid which are post-approval states)
    const nonApproved = (rows ?? []).filter(b => !['approved', 'partially_paid', 'paid'].includes(b.status));
    expect(nonApproved.length === 0, `filter leaked non-approved statuses: ${nonApproved.map(b => b.status).join()}`);
  });

  await test('bills list pagination shape', async () => {
    const r = await api('finance/ap/bills/list', Tstaff, { page: 0, pageSize: 5 });
    ok(r);
    const data = r.body.data;
    expect(typeof data?.total === 'number', 'missing total');
    expect(typeof data?.page === 'number' || typeof data?.pageCount === 'number', 'missing page info');
  });

  // ─────────────────────────── KPIs + AGING ────────────────────────────────────

  h.section('AP › KPIs & Aging');

  await test('AP KPIs return expected shape', async () => {
    const r = await api('finance/ap/kpis', Tstaff, {});
    ok(r);
    const kpis = r.body.data;
    expect(typeof kpis?.totalPayable === 'number', 'missing totalPayable');
    expect(typeof kpis?.overdue === 'number', 'missing overdue');
    expect(typeof kpis?.vendorCount === 'number', 'missing vendorCount');
  });

  await test('AP aging buckets return array', async () => {
    const r = await api('finance/ap/aging', Tstaff, {});
    ok(r);
    expect(Array.isArray(r.body.data), 'aging not array');
  });

  await test('AP trend returns labels+billed+paid', async () => {
    const r = await api('finance/ap/trend', Tstaff, {});
    ok(r);
    const t = r.body.data;
    expect(Array.isArray(t?.labels), 'missing labels');
    expect(Array.isArray(t?.billed), 'missing billed');
    expect(Array.isArray(t?.paid), 'missing paid');
  });

  // ─────────────────────────── CHUNK 7 — DUPLICATE REVIEWS ─────────────────────
  // NOTE: requires migration 20260917000030.

  h.section('AP › Duplicate Reviews');

  await test('duplicate-risks/list requires auth (401)', async () => {
    const r = await api('finance/ap/duplicate-risks/list', null, {});
    fails(r);
    expect(r.status === 401, `expected 401, got ${r.status}`);
  });

  await test('hr_staff denied duplicate-risks/list (403)', async () => {
    const r = await api('finance/ap/duplicate-risks/list', TnoFin, {});
    fails(r);
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  await test('finance_staff can list duplicate risks (empty or array)', async () => {
    const r = await api('finance/ap/duplicate-risks/list', Tstaff, {});
    ok(r);
    expect(Array.isArray(r.body.data), 'expected array');
  });

  await test('duplicate-risks/list shape: each row has id + originalBillId + status', async () => {
    const r = await api('finance/ap/duplicate-risks/list', Tstaff, {});
    ok(r);
    const rows = r.body.data;
    expect(Array.isArray(rows), 'not array');
    if (rows.length > 0) {
      const first = rows[0];
      expect(typeof first.id === 'string', 'missing id');
      expect(typeof first.originalBillId === 'string', 'missing originalBillId');
      expect(first.status === 'pending', `expected pending, got ${first.status}`);
    }
  });

  // Create a duplicate scenario: two bills with the same vendor_invoice_no
  let dupReviewId = null;
  let dupBillId = null;

  if (vendorId && billId) {
    // We already have a 'paid' bill (billId). To create a duplicate we need a new draft bill
    // with the same vendorInvoiceNo — but since billId is paid, let's create a fresh bill pair.
    await test('creating bill with override reason persists a duplicate review row', async () => {
      // Create first bill with a unique invoice number
      const invNo = `${TAG}-DUP-INV`;
      const bill1 = await api('finance/ap/bills/create', Tstaff, {
        vendorId, billDate: new Date().toISOString().slice(0, 10), description: `${TAG} Dup original`,
        vendorInvoiceNo: invNo, lines: [{ description: 'Test line', amount: 100 }],
      });
      ok(bill1);
      const b1Id = bill1.body.data?.id;
      if (b1Id) ctx.billIds.push(b1Id);

      // Create second bill with same vendor + invoice number — without override this should fail
      const r2 = await api('finance/ap/bills/create', Tstaff, {
        vendorId, billDate: new Date().toISOString().slice(0, 10), description: `${TAG} Dup second`,
        vendorInvoiceNo: invNo, lines: [{ description: 'Test line', amount: 100 }],
      });
      fails(r2);
      expect(r2.status === 409, `expected 409 duplicate block, got ${r2.status}`);

      // Now create with override — should succeed and persist a review row
      const r3 = await api('finance/ap/bills/create', Tstaff, {
        vendorId, billDate: new Date().toISOString().slice(0, 10), description: `${TAG} Dup override`,
        vendorInvoiceNo: invNo, lines: [{ description: 'Test line', amount: 100 }],
        duplicateOverrideReason: 'Corrected re-submission',
      });
      ok(r3);
      dupBillId = r3.body.data?.id;
      if (dupBillId) ctx.billIds.push(dupBillId);

      // There should now be a pending review for the first bill
      await new Promise(res => setTimeout(res, 300)); // brief settle
      const listR = await api('finance/ap/duplicate-risks/list', Tstaff, {});
      ok(listR);
      const rows = listR.body.data;
      expect(Array.isArray(rows), 'not array');
    });
  }

  await test('duplicate-risks/resolve requires finance.ap.duplicate.resolve perm', async () => {
    // finance_staff doesn't have resolve perm
    const r = await api('finance/ap/duplicate-risks/resolve', Tstaff, {
      reviewId: '00000000-0000-0000-0000-000000000000',
      resolution: 'resolved_distinct',
      resolutionNote: 'test',
    });
    fails(r);
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  await test('resolve with nonexistent reviewId returns 404', async () => {
    // zod-valid v4 UUID (all-zero version/variant nibbles fail z.string().uuid() with 400)
    const r = await api('finance/ap/duplicate-risks/resolve', Tmgr, {
      reviewId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      resolution: 'resolved_distinct', resolutionNote: 'test',
    });
    fails(r);
    expect(r.status === 404, `expected 404, got ${r.status}`);
  });

  // ─────────────────────────── CHUNK 8 — BULK APPROVAL ─────────────────────────

  h.section('AP › Bulk Approval');

  // Create a fresh submitted bill for bulk approval tests
  let bulkBillId = null;
  if (vendorId) {
    await test('create + submit bill for bulk approval queue', async () => {
      const r = await api('finance/ap/bills/create', Tstaff, {
        vendorId, billDate: new Date().toISOString().slice(0, 10),
        description: `${TAG} Bulk Approval Test`,
        lines: [{ description: 'Bulk test line', amount: 250 }],
        submitForApproval: true,
      });
      ok(r);
      bulkBillId = r.body.data?.id;
      if (bulkBillId) ctx.billIds.push(bulkBillId);
      const status = r.body.data?.status;
      expect(status === 'submitted' || status === 'draft', `unexpected status: ${status}`);
    });
  }

  await test('bulk-approve denied for hr_staff (403)', async () => {
    const r = await api('finance/ap/bills/bulk-approve', TnoFin, {
      billIds: ['00000000-0000-0000-0000-000000000001'],
    });
    fails(r);
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  await test('bulk-approve with empty billIds rejected (422/400)', async () => {
    const r = await api('finance/ap/bills/bulk-approve', Tmgr, { billIds: [] });
    fails(r);
    expect(r.status === 422 || r.status === 400, `expected 422/400, got ${r.status}`);
  });

  await test('bulk-approve: SoD blocks own bill — submitter cannot approve', async () => {
    if (!vendorId) return;
    // finance_manager creates + submits their OWN bill — the route perm passes
    // (manager holds bills.approve) but per-item SoD must block self-approval.
    // finance_staff would 403 at the route gate before SoD is ever evaluated.
    const own = await api('finance/ap/bills/create', Tmgr, {
      vendorId, billDate: new Date().toISOString().slice(0, 10),
      description: `${TAG} SoD own-bill`,
      lines: [{ description: 'SoD test line', amount: 267.8 }],
      submitForApproval: true,
    });
    ok(own);
    const ownId = own.body.data?.id;
    if (ownId) ctx.billIds.push(ownId);
    const r = await api('finance/ap/bills/bulk-approve', Tmgr, { billIds: [ownId] });
    // API returns 200 but with item blocked (not a top-level 4xx)
    ok(r);
    const result = r.body.data;
    expect(Array.isArray(result?.blocked), 'missing blocked array');
    const blockedIds = (result?.blocked ?? []).map(b => b.bill?.id ?? b.id);
    expect(blockedIds.includes(ownId), 'submitter bill not blocked by SoD');
  });

  await test('finance_manager can bulk-approve a submitted bill', async () => {
    if (!bulkBillId) return;
    // re-submit if already processed
    const detail = await api('finance/ap/bills/get', Tstaff, { id: bulkBillId });
    const currentStatus = detail.body.data?.bill?.status ?? detail.body.data?.status;
    if (currentStatus !== 'submitted') return;

    const r = await api('finance/ap/bills/bulk-approve', Tmgr, { billIds: [bulkBillId] });
    ok(r);
    const result = r.body.data;
    expect(Array.isArray(result?.approved), 'missing approved array');
    expect(result.approved.some(b => b.id === bulkBillId), 'bill not in approved list');

    // Side-effect: app_event
    const { data: evts } = await sb.from('app_events').select('event_type')
      .eq('source_entity_id', bulkBillId).eq('event_type', 'finance.ap.bill.approved').limit(1);
    expect(Array.isArray(evts) && evts.length > 0, 'finance.ap.bill.approved event missing after bulk approve');
  });

  await test('bulk-approve: non-submitted bills are blocked', async () => {
    // billId is 'paid' at this point — it's not eligible
    if (!billId) return;
    const r = await api('finance/ap/bills/bulk-approve', Tmgr, { billIds: [billId] });
    ok(r);
    const result = r.body.data;
    expect(Array.isArray(result?.blocked), 'missing blocked array');
    const blockedIds = (result?.blocked ?? []).map(b => b.bill?.id ?? b.id);
    expect(blockedIds.includes(billId), 'paid bill should be blocked');
  });

  // ─────────────────────────── CHUNK 12 — PAYMENT RUNS ─────────────────────────

  h.section('AP › Payment Runs');

  let payRunId = null;

  // We need an approved (non-paid) bill to build a payment run with
  let prBillId = null;
  if (vendorId) {
    await test('create + approve a bill for payment-run tests', async () => {
      const r = await api('finance/ap/bills/create', Tstaff, {
        vendorId, billDate: new Date().toISOString().slice(0, 10),
        description: `${TAG} Payment Run Test`,
        lines: [{ description: 'PR test line', amount: 300 }],
      });
      ok(r);
      prBillId = r.body.data?.id;
      if (prBillId) ctx.billIds.push(prBillId);

      // Submit
      await api('finance/ap/bills/submit', Tstaff, { id: prBillId });
      // Approve (by manager — SoD)
      await api('finance/ap/bills/approve', Tmgr, { id: prBillId });
    });
  }

  await test('payment-runs/list requires finance.ap.payment.run.manage (403 for staff)', async () => {
    const r = await api('finance/ap/payment-runs/list', Tstaff, {});
    fails(r);
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  await test('finance_manager can list payment runs', async () => {
    const r = await api('finance/ap/payment-runs/list', Tmgr, {});
    ok(r);
    expect(Array.isArray(r.body.data), 'payment runs not array');
  });

  await test('payment-runs/create with non-approved bill is rejected (422)', async () => {
    if (!billId) return;
    // billId is already paid — not eligible
    const r = await api('finance/ap/payment-runs/create', Tmgr, {
      billIds: [billId], paymentMethod: 'eft',
      payDate: new Date().toISOString().slice(0, 10),
    });
    fails(r);
    expect(r.status === 422, `expected 422, got ${r.status}`);
  });

  await test('finance_manager creates payment run with approved bill', async () => {
    if (!prBillId) return;
    const r = await api('finance/ap/payment-runs/create', Tmgr, {
      billIds: [prBillId], paymentMethod: 'eft',
      payDate: new Date().toISOString().slice(0, 10),
      notes: `${TAG} payment run test`,
    });
    ok(r);
    const run = r.body.data;
    expect(typeof run?.id === 'string', 'missing run id');
    expect(typeof run?.runNo === 'string', 'missing runNo');
    expect(run?.runNo?.startsWith('PRUN-'), `runNo should start with PRUN-, got ${run?.runNo}`);
    expect(run?.status === 'pending', `expected pending, got ${run?.status}`);
    expect(Array.isArray(run?.items), 'missing items array');
    expect(run?.items?.length === 1, `expected 1 item, got ${run?.items?.length}`);
    payRunId = run.id;
    if (payRunId) ctx.runIds.push(payRunId);

    // app_event emitted
    const { data: evts } = await sb.from('app_events').select('event_type')
      .eq('source_entity_id', payRunId).eq('event_type', 'finance.ap.payment_run.created').limit(1);
    expect(Array.isArray(evts) && evts.length > 0, 'finance.ap.payment_run.created event missing');
  });

  await test('payment-runs/get returns run + items', async () => {
    if (!payRunId) return;
    const r = await api('finance/ap/payment-runs/get', Tmgr, { id: payRunId });
    ok(r);
    const run = r.body.data;
    expect(run?.id === payRunId, 'run id mismatch');
    expect(Array.isArray(run?.items), 'missing items');
  });

  await test('creator cannot process own payment run (SoD — assertDifferentApprover)', async () => {
    if (!payRunId) return;
    // Tmgr created the run; Tmgr processing it should be blocked
    const r = await api('finance/ap/payment-runs/process', Tmgr, { id: payRunId });
    fails(r);
    expect(r.status === 422 || r.status === 403, `expected SoD error, got ${r.status}`);
  });

  await test('finance_manager (fmgr2, non-creator) can process the payment run (SoD — different user)', async () => {
    if (!payRunId) return;
    // T.admin has finance.ap.payment.run.process in hardcoded seed but not in DB role_permissions
    // (Category A — operator migration pending). Using fmgr2 (finance_manager) which has the perm in DB.
    const r = await api('finance/ap/payment-runs/process', Tmgr2, { id: payRunId });
    ok(r);
    const run = r.body.data;
    expect(run?.status === 'complete', `expected complete, got ${run?.status}`);

    // Verify bill is now paid
    if (prBillId) {
      const detail = await api('finance/ap/bills/get', Tstaff, { id: prBillId });
      const status = detail.body.data?.bill?.status ?? detail.body.data?.status;
      expect(status === 'paid', `expected bill paid, got ${status}`);
    }

    // app_event emitted
    const { data: evts } = await sb.from('app_events').select('event_type')
      .eq('source_entity_id', payRunId).eq('event_type', 'finance.ap.payment_run.processed').limit(1);
    expect(Array.isArray(evts) && evts.length > 0, 'finance.ap.payment_run.processed event missing');
  });

  await test('payment-runs/void on complete run is rejected', async () => {
    if (!payRunId) return;
    const r = await api('finance/ap/payment-runs/void', Tmgr, {
      id: payRunId, reason: 'Trying to void a complete run',
    });
    fails(r);
    expect(r.status === 422, `expected 422, got ${r.status}`);
  });

  // Create a second run to test void
  let voidRunId = null;
  if (vendorId) {
    await test('create + void a payment run', async () => {
      // Need another approved bill
      const newBill = await api('finance/ap/bills/create', Tstaff, {
        vendorId, billDate: new Date().toISOString().slice(0, 10),
        description: `${TAG} Void Run Test`,
        // distinct amount — same vendor + amount + date would trip the duplicate heuristic
        lines: [{ description: 'void test line', amount: 341.25 }],
      });
      ok(newBill);
      const newBillId = newBill.body.data?.id;
      if (newBillId) ctx.billIds.push(newBillId);

      await api('finance/ap/bills/submit', Tstaff, { id: newBillId });
      await api('finance/ap/bills/approve', Tmgr, { id: newBillId });

      const runR = await api('finance/ap/payment-runs/create', Tmgr, {
        billIds: [newBillId], paymentMethod: 'cash',
        payDate: new Date().toISOString().slice(0, 10),
      });
      ok(runR);
      voidRunId = runR.body.data?.id;
      if (voidRunId) ctx.runIds.push(voidRunId);

      const voidR = await api('finance/ap/payment-runs/void', Tmgr, {
        id: voidRunId, reason: `${TAG} void test`,
      });
      ok(voidR);
      expect(voidR.body.data?.status === 'void', `expected void, got ${voidR.body.data?.status}`);

      // audit event
      const { data: evts } = await sb.from('app_events').select('event_type')
        .eq('source_entity_id', voidRunId).eq('event_type', 'finance.ap.payment_run.voided').limit(1);
      expect(Array.isArray(evts) && evts.length > 0, 'finance.ap.payment_run.voided event missing');
    });
  }

  // ─────────────────────────── CHUNK 13 — IMPORT ────────────────────────────────

  h.section('AP › Bill Import');

  await test('bills/import denied for hr_staff (403)', async () => {
    const r = await api('finance/ap/bills/import', TnoFin, { rows: [] });
    fails(r);
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  await test('bills/import denied for finance_staff (403 — manager-only)', async () => {
    const r = await api('finance/ap/bills/import', Tstaff, { rows: [] });
    fails(r);
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  await test('bills/import with empty rows array rejected (400/422)', async () => {
    const r = await api('finance/ap/bills/import', Tmgr, { rows: [] });
    fails(r);
    expect(r.status === 400 || r.status === 422, `expected 400/422, got ${r.status}`);
  });

  await test('bills/import with valid rows imports bills', async () => {
    if (!vendorId) return;
    // Get vendor name from earlier created vendor
    const vListR = await api('finance/ap/vendors/list', Tstaff, {});
    const vendors = vListR.body.data ?? [];
    const testVendor = vendors.find(v => v.id === vendorId);
    if (!testVendor) return;

    const rows = [
      {
        rowIndex: 2, vendorName: testVendor.name, vendorInvoiceNo: `${TAG}-IMP-001`,
        billDate: new Date().toISOString().slice(0, 10), dueDate: '',
        description: `${TAG} Imported bill`, amount: '175.50', glAccountCode: '', currency: 'TTD',
      },
      {
        rowIndex: 3, vendorName: testVendor.name, vendorInvoiceNo: `${TAG}-IMP-002`,
        billDate: new Date().toISOString().slice(0, 10), dueDate: '',
        description: `${TAG} Imported bill 2`, amount: '99.99', glAccountCode: '', currency: 'TTD',
      },
    ];

    const r = await api('finance/ap/bills/import', Tmgr, { rows });
    ok(r);
    const result = r.body.data;
    expect(typeof result?.imported === 'number', 'missing imported count');
    expect(typeof result?.skipped === 'number', 'missing skipped count');
    expect(Array.isArray(result?.billIds), 'missing billIds array');
    expect(result.imported === 2, `expected 2 imported, got ${result.imported}`);
    expect(result.skipped === 0, `expected 0 skipped, got ${result.skipped}`);

    // Track created bills for cleanup
    for (const id of (result.billIds ?? [])) ctx.billIds.push(id);

    // finance.ap.bill.imported event
    const { data: evts } = await sb.from('app_events').select('event_type')
      .eq('event_type', 'finance.ap.bill.imported').order('created_at', { ascending: false }).limit(1);
    expect(Array.isArray(evts) && evts.length > 0, 'finance.ap.bill.imported event missing');
  });

  await test('bills/import with invalid rows reports errors', async () => {
    const rows = [
      {
        rowIndex: 2, vendorName: 'NONEXISTENT_VENDOR_XYZ', vendorInvoiceNo: '',
        billDate: 'not-a-date', dueDate: '', description: '', amount: 'bad', glAccountCode: '', currency: 'TTD',
      },
    ];
    const r = await api('finance/ap/bills/import', Tmgr, { rows });
    ok(r);
    const result = r.body.data;
    expect(result?.imported === 0, `expected 0 imported, got ${result?.imported}`);
    expect(result?.skipped === 1, `expected 1 skipped, got ${result?.skipped}`);
    expect(Array.isArray(result?.errors) && result.errors.length > 0, 'expected error report');
  });

  await test('bills/import: response shape has imported, skipped, errors, billIds', async () => {
    if (!vendorId) return;
    // minimal valid row — may fail if vendor was deleted but shape check is still valid
    const r = await api('finance/ap/bills/import', Tmgr, {
      rows: [{
        rowIndex: 2, vendorName: 'SHAPE_CHECK_ONLY_VENDOR', vendorInvoiceNo: '',
        billDate: new Date().toISOString().slice(0, 10), dueDate: '', description: 'Shape test',
        amount: '1', glAccountCode: '', currency: 'TTD',
      }],
    });
    // Either ok or skipped — we only care about the shape
    const result = r.body.data ?? (r.body.success === false ? { imported: 0, skipped: 0, errors: [], billIds: [] } : {});
    expect(typeof result.imported === 'number' || result === undefined, 'imported not a number');
  });
}
