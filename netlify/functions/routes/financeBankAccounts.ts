// routes/financeBankAccounts.ts -- Finance: Employee Bank Accounts
// Mounted at /api/finance in api.ts. POST-only, JWT-gated.
// Envelope: body.args ?? {}.

import { Hono } from 'hono';
import { requirePermission } from '../lib/auth';
import { z, zv } from '../lib/validate';
import { listBankAccounts, getBankAccount, upsertBankAccount, deactivateBankAccount } from '../lib/finance/bankAccounts';
import type { HonoVariables } from '../../../types/api';

const router = new Hono<{ Variables: HonoVariables }>();
const b = (c: { get: (k: string) => unknown }) => (c.get('body') as Record<string, unknown>).args ?? {};
const FINANCE_ROLES = ['finance_staff', 'finance_manager', 'admin', 'superadmin'];
const MANAGE_ROLES = ['finance_manager', 'admin', 'superadmin'];

// POST /api/finance/bank-accounts/list
router.post('/bank-accounts/list', async c => {
  const actor = await requirePermission(c, 'finance.bank_accounts.view');
  const v = zv(c, z.object({ employeeId: z.string().optional(), includeInactive: z.boolean().optional() }), b(c));
  if (!v.ok) return v.response;
  const isFinance = FINANCE_ROLES.includes(actor.role);
  const employeeId = isFinance ? (v.data.employeeId ?? actor.id) : actor.id;
  try {
    const data = await listBankAccounts({ employeeId, includeInactive: v.data.includeInactive });
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
}); 

// POST /api/finance/bank-accounts/get
router.post('/bank-accounts/get', async c => {
  const actor = await requirePermission(c, 'finance.bank_accounts.view');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  const isFinance = FINANCE_ROLES.includes(actor.role);
  try {
    const data = await getBankAccount(v.data.id, isFinance ? undefined : actor.id);
    if (!data) return c.json({ success: false, message: 'Bank account not found.' }, 404 as 200);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
}); 

// POST /api/finance/bank-accounts/upsert
router.post('/bank-accounts/upsert', async c => {
  const actor = await requirePermission(c, 'finance.bank_accounts.manage');
  const v = zv(c, z.object({ id: z.string().uuid().optional(), employeeId: z.string().optional(), bankName: z.string().min(1).max(200), branch: z.string().max(200).nullable().optional(), accountType: z.enum(['savings', 'chequing']), accountNumber: z.string().min(4).max(50), isPrimary: z.boolean().optional(), metadata: z.record(z.string(), z.unknown()).optional() }), b(c));
  if (!v.ok) return v.response;
  const isFinance = MANAGE_ROLES.includes(actor.role);
  const employeeId = isFinance ? (v.data.employeeId ?? actor.id) : actor.id;
  try {
    const data = await upsertBankAccount({ id: v.data.id, employeeId, bankName: v.data.bankName, branch: v.data.branch ?? null, accountType: v.data.accountType, accountNumber: v.data.accountNumber, isPrimary: v.data.isPrimary, metadata: v.data.metadata, actorId: actor.id });
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
}); 

// POST /api/finance/bank-accounts/deactivate
router.post('/bank-accounts/deactivate', async c => {
  const actor = await requirePermission(c, 'finance.bank_accounts.manage');
  const v = zv(c, z.object({ id: z.string().uuid() }), b(c));
  if (!v.ok) return v.response;
  const isFinance = MANAGE_ROLES.includes(actor.role);
  try {
    const data = await deactivateBankAccount(v.data.id, actor.id, isFinance ? undefined : actor.id);
    return c.json({ success: true, data });
  } catch (e) { const er = e as { status?: number; message?: string }; return c.json({ success: false, message: er.message ?? 'Failed' }, (er.status ?? 500) as 200); }
}); 

export default router;
