/**
 * tests/unit/loadRenderTemplate.test.ts
 *
 * P0 boundary guard (financial-correctness): the payslip template resolver must
 * NEVER hand a Payslip Studio design to the renderer unless the studio is
 * explicitly enabled AND the run carries an explicit, still-active template.
 * There is deliberately no fall-through to an "active default" template — that
 * fall-through was the bug that could print a seeded demo template's static
 * figures on a real employee's payslip.
 *
 * `payslipStudioEnabled` is captured from the environment at import time, so each
 * case resets the module registry and re-imports with the env set for that case.
 */

// Mock the DB client and the template loader so the resolver never touches a
// real Supabase instance. Factories re-run on jest.resetModules() → fresh mocks.
jest.mock('../../netlify/functions/lib/db', () => ({ sb: { from: jest.fn() } }));
jest.mock('../../netlify/functions/lib/finance/payslipTemplates', () => ({
  getTemplate: jest.fn(),
}));

// The module-under-test pulls in heavy siblings only its OTHER functions use
// (event/notify/audit/PDF/employer). loadRenderTemplate touches none of them, so
// stub them out — this also avoids requiring the appEvents→communications→upload
// chain (upload.ts uses an es2018 regex flag ts-jest's default target rejects).
jest.mock('../../netlify/functions/lib/appEvents', () => ({ emitAppEvent: jest.fn() }));
jest.mock('../../netlify/functions/lib/notify', () => ({ notifyMany: jest.fn() }));
jest.mock('../../netlify/functions/lib/hr/employeeCore', () => ({ writeHrAudit: jest.fn() }));
jest.mock('../../netlify/functions/lib/finance/payslipPdf', () => ({
  buildPayslipSnapshot: jest.fn(), renderPayslipPdf: jest.fn(), renderPayslipPdfWithDesign: jest.fn(),
}));
jest.mock('../../netlify/functions/lib/finance/employerProfile', () => ({ getEmployerProfile: jest.fn() }));

type MaybeSingle = { data: unknown; error: unknown };

/** Chainable stub mirroring sb.from(...).select(...).eq(...).maybeSingle(). */
function runRow(result: MaybeSingle): unknown {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = async () => result;
  return chain;
}

interface Loaded {
  loadRenderTemplate: (runId: string) => Promise<unknown | null>;
  payslipStudioEnabled: boolean;
  sbFrom: jest.Mock;
  getTemplate: jest.Mock;
}

function load(flag: string | undefined): Loaded {
  jest.resetModules();
  if (flag === undefined) delete process.env.PAYSLIP_STUDIO_ENABLED;
  else process.env.PAYSLIP_STUDIO_ENABLED = flag;

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const db = require('../../netlify/functions/lib/db') as { sb: { from: jest.Mock } };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const tmpl = require('../../netlify/functions/lib/finance/payslipTemplates') as { getTemplate: jest.Mock };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('../../netlify/functions/lib/finance/payrollPayslips') as {
    loadRenderTemplate: (runId: string) => Promise<unknown | null>;
    payslipStudioEnabled: boolean;
  };
  db.sb.from.mockReset();
  tmpl.getTemplate.mockReset();
  return {
    loadRenderTemplate: mod.loadRenderTemplate,
    payslipStudioEnabled: mod.payslipStudioEnabled,
    sbFrom: db.sb.from,
    getTemplate: tmpl.getTemplate,
  };
}

describe('loadRenderTemplate — P0 studio boundary', () => {
  it('is DISABLED by default (env unset) and never queries the run', async () => {
    const t = load(undefined);
    expect(t.payslipStudioEnabled).toBe(false);
    await expect(t.loadRenderTemplate('run-1')).resolves.toBeNull();
    expect(t.sbFrom).not.toHaveBeenCalled();
    expect(t.getTemplate).not.toHaveBeenCalled();
  });

  it('stays disabled for any non-"true" value (e.g. "false", "1")', async () => {
    for (const v of ['false', '1', 'yes', '']) {
      const t = load(v);
      expect(t.payslipStudioEnabled).toBe(false);
      await expect(t.loadRenderTemplate('run-1')).resolves.toBeNull();
      expect(t.sbFrom).not.toHaveBeenCalled();
    }
  });

  it('enabled + run has NO template_id → null (no fall-through to a default)', async () => {
    const t = load('true');
    expect(t.payslipStudioEnabled).toBe(true);
    t.sbFrom.mockReturnValue(runRow({ data: { template_id: null }, error: null }));
    await expect(t.loadRenderTemplate('run-1')).resolves.toBeNull();
    // The default-template list is never consulted.
    expect(t.getTemplate).not.toHaveBeenCalled();
  });

  it('enabled + explicit active template → returns that template design', async () => {
    const t = load('true');
    const design = { page: { size: 'a4' }, elements: [] };
    t.sbFrom.mockReturnValue(runRow({ data: { template_id: 'tmpl-9' }, error: null }));
    t.getTemplate.mockResolvedValue({ id: 'tmpl-9', design });
    await expect(t.loadRenderTemplate('run-1')).resolves.toBe(design);
    expect(t.getTemplate).toHaveBeenCalledWith('tmpl-9');
  });

  it('enabled + explicit template that is archived/missing → null (no silent substitute)', async () => {
    const t = load('true');
    t.sbFrom.mockReturnValue(runRow({ data: { template_id: 'gone' }, error: null }));
    t.getTemplate.mockResolvedValue(null);
    await expect(t.loadRenderTemplate('run-1')).resolves.toBeNull();
    expect(t.getTemplate).toHaveBeenCalledWith('gone');
  });

  it('enabled + run lookup error → throws (never falls back to a template)', async () => {
    const t = load('true');
    t.sbFrom.mockReturnValue(runRow({ data: null, error: { message: 'db down' } }));
    await expect(t.loadRenderTemplate('run-1')).rejects.toThrow(/loadRenderTemplate\/run/);
  });
});
