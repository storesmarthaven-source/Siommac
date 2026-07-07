// routes/financeAccountsPayable.ts -- Finance: Accounts Payable
// Mounted at /api/finance. POST-only, JWT-gated. Envelope: body.args ?? {}.

import { Hono } from 'hono';
import { requirePermission } from '../lib/auth';
import { z, zv } from '../lib/validate';
import {
  listBills, getBillDetail, listVendors, listPayments, getApKpis, getAging, getApTrend,
  createVendor, updateVendor, getVendorDetail, listVendorBills, listVendorPayments,
  createBill, submitBill, approveBill, rejectBill, recordPayment, voidBill,
  type ApBillStatus,
} from '../lib/finance/accountsPayable';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();
const b = (c: { get: (k: string) => unknown }) => (c.get('body') as Record<string, unknown>).args ?? {};

const BILL_STATUS = ['draft', 'submitted', 'approved', 'partially_paid', 'paid', 'rejected', 'void'] as const;
const VENDOR_STATUS = ['active', 'inactive', 'on_hold'] as const;
const PAYMENT_METHOD = ['eft', 'ach', 'wire', 'cheque', 'cash', 'card'] as const;

const fail = (c: { json: (o: unknown, s?: number) => Response }, e: unknown) => {
  const er = e as { status?: number; message?: string };
  return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200);
};

// ── Reads ─────────────────────────────────────────────────────────────────────
router.post('/ap/bills/list', async c => {
  await requirePermission(c, 'finance.ap.view');
  const v = zv(c, z.object({ status: z.enum(BILL_STATUS).optional(), vendorId: z.string().uuid().optional(), search: z.string().optional(), page: z.number().int().min(0).optional(), pageSize: z.number().int().min(1).max(100).optional() }), b(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await listBills(v.data as { status?: ApBillStatus }) }); } catch (e) { return fail(c, e); }
});

router.post('/ap/bills/get', async c => {
  await requirePermission(c, 'finance.ap.view');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getBillDetail(v.data.id);
    if (!data) return c.json({ success: false, message: 'Bill not found.' }, 404 as 200);
    return c.json({ success: true, data });
  } catch (e) { return fail(c, e); }
});

router.post('/ap/vendors/list', async c => {
  await requirePermission(c, 'finance.ap.view');
  const v = zv(c, z.object({ status: z.enum(VENDOR_STATUS).optional() }), b(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await listVendors(v.data) }); } catch (e) { return fail(c, e); }
});

router.post('/ap/vendors/get', async c => {
  await requirePermission(c, 'finance.ap.view');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try {
    const data = await getVendorDetail(v.data.id);
    if (!data) return c.json({ success: false, message: 'Vendor not found.' }, 404 as 200);
    return c.json({ success: true, data });
  } catch (e) { return fail(c, e); }
});

router.post('/ap/vendors/bills', async c => {
  await requirePermission(c, 'finance.ap.view');
  const v = zv(c, z.object({ vendorId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await listVendorBills(v.data.vendorId) }); } catch (e) { return fail(c, e); }
});

router.post('/ap/vendors/payments', async c => {
  await requirePermission(c, 'finance.ap.view');
  const v = zv(c, z.object({ vendorId: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await listVendorPayments(v.data.vendorId) }); } catch (e) { return fail(c, e); }
});

router.post('/ap/payments/list', async c => {
  await requirePermission(c, 'finance.ap.view');
  try { return c.json({ success: true, data: await listPayments() }); } catch (e) { return fail(c, e); }
});

router.post('/ap/kpis', async c => {
  await requirePermission(c, 'finance.ap.view');
  try { return c.json({ success: true, data: await getApKpis() }); } catch (e) { return fail(c, e); }
});

router.post('/ap/aging', async c => {
  await requirePermission(c, 'finance.ap.view');
  try { return c.json({ success: true, data: await getAging() }); } catch (e) { return fail(c, e); }
});

router.post('/ap/trend', async c => {
  await requirePermission(c, 'finance.ap.view');
  try { return c.json({ success: true, data: await getApTrend() }); } catch (e) { return fail(c, e); }
});

// ── Vendors ─────────────────────────────────────────────────────────────────

const VendorCoreSchema = z.object({
  name:                    z.string().min(1).max(200),
  registrationNo:          z.string().max(80).optional(),
  contactName:             z.string().max(150).optional(),
  contactEmail:            z.string().email().optional(),
  contactPhone:            z.string().max(30).optional(),
  paymentTermsDays:        z.number().int().min(0).max(365).optional(),
  defaultGlAccountCode:    z.string().max(30).optional(),
  defaultCostCenterId:     z.string().uuid().optional(),
  defaultCurrency:         z.string().length(3).optional(),
  preferredPaymentMethod:  z.enum(PAYMENT_METHOD).optional(),
  status:                  z.enum(VENDOR_STATUS).optional(),
  bankAccount: z.object({
    bankName:      z.string().min(1).max(150),
    accountName:   z.string().min(1).max(150),
    accountNumber: z.string().min(1).max(50),
    routingCode:   z.string().max(30).optional(),
    iban:          z.string().max(40).optional(),
    swift:         z.string().max(15).optional(),
    currency:      z.string().length(3).optional(),
  }).optional(),
});

router.post('/ap/vendors/create', async c => {
  const actor = await requirePermission(c, 'finance.ap.vendors.create');
  const v = zv(c, VendorCoreSchema, b(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await createVendor({ ...v.data, actorId: actor.id }) }); } catch (e) { return fail(c, e); }
});

router.post('/ap/vendors/update', async c => {
  const actor = await requirePermission(c, 'finance.ap.vendors.update');
  const v = zv(c, VendorCoreSchema.partial().extend({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await updateVendor({ ...v.data, actorId: actor.id }) }); } catch (e) { return fail(c, e); }
});

// ── Bill lifecycle ────────────────────────────────────────────────────────────
router.post('/ap/bills/create', async c => {
  const actor = await requirePermission(c, 'finance.ap.bills.create');
  const v = zv(c, z.object({
    vendorId: z.string().uuid(),
    billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    dueDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    description: z.string().max(500).optional(),
    glAccountCode: z.string().optional(),
    lines: z.array(z.object({
      description: z.string().min(1).max(300),
      amount: z.number().positive(),
      glAccountCode: z.string().optional(),
      costCenterId: z.string().uuid().nullable().optional(),
    })).min(1, 'At least one line is required.'),
  }), b(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await createBill({ ...v.data, actorId: actor.id }) }); } catch (e) { return fail(c, e); }
});

router.post('/ap/bills/submit', async c => {
  const actor = await requirePermission(c, 'finance.ap.bills.submit');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await submitBill(v.data.id, actor.id) }); } catch (e) { return fail(c, e); }
});

router.post('/ap/bills/approve', async c => {
  const actor = await requirePermission(c, 'finance.ap.bills.approve');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await approveBill(v.data.id, actor.id) }); } catch (e) { return fail(c, e); }
});

router.post('/ap/bills/reject', async c => {
  const actor = await requirePermission(c, 'finance.ap.bills.approve');
  const v = zv(c, z.object({ id: z.string().uuid(), reason: z.string().trim().min(1).max(500) }), b(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await rejectBill(v.data.id, actor.id, v.data.reason) }); } catch (e) { return fail(c, e); }
});

router.post('/ap/bills/record-payment', async c => {
  const actor = await requirePermission(c, 'finance.ap.payment.record');
  const v = zv(c, z.object({
    id: z.string().uuid(),
    amount: z.number().positive(),
    method: z.enum(PAYMENT_METHOD).optional(),
    reference: z.string().max(120).optional(),
  }), b(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await recordPayment(v.data.id, actor.id, v.data) }); } catch (e) { return fail(c, e); }
});

router.post('/ap/bills/void', async c => {
  const actor = await requirePermission(c, 'finance.ap.bills.void');
  const v = zv(c, z.object({ id: z.string().uuid(), reason: z.string().trim().min(1).max(500) }), b(c));
  if (!v.ok) return v.response;
  try { return c.json({ success: true, data: await voidBill(v.data.id, actor.id, v.data.reason) }); } catch (e) { return fail(c, e); }
});

export default router;
