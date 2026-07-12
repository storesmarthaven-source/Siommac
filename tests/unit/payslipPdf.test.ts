// Unit test for the payslip PDF renderer — verifies pdfkit produces a valid PDF buffer
// in our Node runtime (no DB / no server). Guards the reconciliation invariant used by
// the renderer's inputs (gross - totalDeductions = net).
//
// Extended in Phase 2:
//   P2-a — snapshot binding: snapshotRowsForBinding / snapshotTotalForBinding return
//           the snapshot's actual line items and authoritative totals. The pure helpers
//           are tested directly because PDFKit compresses content streams (the text is
//           not visible as plain bytes in the PDF buffer).
//   P2-c — image decode: decodeDataUri validates and decodes base64 PNG/JPEG data-URIs;
//           renderPayslipPdfWithDesign embeds images without crashing.

import {
  renderPayslipPdf,
  renderPayslipPdfWithDesign,
  decodeDataUri,
  snapshotRowsForBinding,
  snapshotTotalForBinding,
  type PayslipSnapshot,
} from '../../netlify/functions/lib/finance/payslipPdf';
import type { PayslipEmployerSource } from '../../netlify/functions/lib/finance/payslipTokens';

// ── Shared fixtures ───────────────────────────────────────────────────────────

const snapshot: PayslipSnapshot = {
  payslipId: '00000000-0000-0000-0000-000000000001',
  payslipNo: 'PSL-0001',
  runId: '00000000-0000-0000-0000-0000000000aa',
  runNo: 'PAY-0007',
  periodLabel: 'July 2026',
  periodMonth: '2026-07-01',
  payFrequency: 'monthly',
  payDate: '2026-07-25',
  currency: 'TTD',
  employer: { name: 'Acme T&T Ltd.' },
  employee: {
    id: 'emp-1', name: 'Jane Doe', employeeNumber: 'E-1042',
    department: 'Operations', position: 'Analyst',
    nisNumberMasked: '***-1234', nisClassNo: 12,
  },
  bank: { bankName: 'Republic Bank', accountType: 'chequing', accountMasked: '****6789' },
  earnings: [
    { label: 'Basic Salary', amount: 9000 },
    { label: 'Housing Allowance', amount: 1000 },
    { label: 'Overtime', amount: 500 },
  ],
  deductions: [
    { label: 'PAYE (Income Tax)', amount: 1200.5 },
    { label: 'NIS (Employee)', amount: 414.6 },
    { label: 'Health Surcharge', amount: 35.75 },
    { label: 'Credit Union', amount: 250 },
  ],
  employerContributions: [{ label: 'NIS (Employer)', amount: 829.2 }],
  gross: 10500,
  totalDeductions: 1900.85,
  net: 8599.15,
  ytd: { gross: 73500, paye: 8403.5, nisEmployee: 2902.2, healthSurcharge: 250.25, net: 60193.05 },
  generatedAt: '2026-07-20T14:15:00.000Z',
};

const employer: PayslipEmployerSource = {
  legalName:         'Acme T&T Limited',
  tradingName:       null,
  birFileNumber:     '12345678',
  nisEmployerNumber: 'ER-99999',
  addressLine1:      '10 Main Street',
  addressLine2:      null,
  city:              'Port of Spain',
  country:           'Trinidad and Tobago',
  phone:             null,
  email:             null,
};

// ── renderPayslipPdf (built-in layout) ───────────────────────────────────────

describe('renderPayslipPdf', () => {
  it('renders a valid, non-trivial PDF buffer', async () => {
    const buf = await renderPayslipPdf(snapshot);
    expect(Buffer.isBuffer(buf)).toBe(true);
    // A real PDF starts with the %PDF- magic header and ends with %%EOF.
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(1000);
    expect(buf.toString('latin1')).toContain('%%EOF');
  });

  it('reconciles: gross - totalDeductions = net', () => {
    expect(Math.round((snapshot.gross - snapshot.totalDeductions) * 100) / 100).toBe(snapshot.net);
  });

  it('handles a minimal snapshot (no bank, no items) without throwing', async () => {
    const minimal: PayslipSnapshot = {
      ...snapshot, bank: null, earnings: [{ label: 'Basic Salary', amount: 5000 }],
      deductions: [], employerContributions: [], gross: 5000, totalDeductions: 0, net: 5000,
    };
    const buf = await renderPayslipPdf(minimal);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

// ── snapshotRowsForBinding — P2-a pure function tests ────────────────────────
//
// PDFKit compresses content streams, so we cannot search for plain text in the
// raw PDF buffer. Instead we test the pure binding helpers directly — these are
// the functions that decide WHICH data rows the table renderer uses.

describe('snapshotRowsForBinding — P2-a', () => {
  it('earnings binding returns snapshot earnings (label + formatted amount)', () => {
    const rows = snapshotRowsForBinding(snapshot, 'earnings');
    expect(rows).toHaveLength(3);
    expect(rows[0]?.label).toBe('Basic Salary');
    expect(rows[0]?.amount).toMatch(/\$9[,.]?000\.00/);
    expect(rows[1]?.label).toBe('Housing Allowance');
    expect(rows[1]?.amount).toMatch(/\$1[,.]?000\.00/);
    expect(rows[2]?.label).toBe('Overtime');
    expect(rows[2]?.amount).toMatch(/\$500\.00/);
  });

  it('deductions binding returns snapshot deductions', () => {
    const rows = snapshotRowsForBinding(snapshot, 'deductions');
    expect(rows).toHaveLength(4);
    expect(rows[0]?.label).toBe('PAYE (Income Tax)');
    expect(rows[0]?.amount).toMatch(/\$1[,.]?200\.50/);
    expect(rows[1]?.label).toBe('NIS (Employee)');
    expect(rows[2]?.label).toBe('Health Surcharge');
    expect(rows[3]?.label).toBe('Credit Union');
  });

  it('employer_contributions binding returns employer contributions', () => {
    const rows = snapshotRowsForBinding(snapshot, 'employer_contributions');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe('NIS (Employer)');
    expect(rows[0]?.amount).toMatch(/\$829\.20/);
  });

  it('unknown binding returns empty array (safe fallback)', () => {
    const rows = snapshotRowsForBinding(snapshot, 'unknown_binding');
    expect(rows).toHaveLength(0);
  });

  it('earnings binding does NOT include the deductions rows', () => {
    const rows = snapshotRowsForBinding(snapshot, 'earnings');
    const labels = rows.map(r => r.label);
    expect(labels).not.toContain('PAYE (Income Tax)');
    expect(labels).not.toContain('NIS (Employee)');
  });

  it('snapshot with no earnings returns empty rows for earnings binding', () => {
    const noEarnings: PayslipSnapshot = { ...snapshot, earnings: [] };
    expect(snapshotRowsForBinding(noEarnings, 'earnings')).toHaveLength(0);
  });
});

// ── snapshotTotalForBinding — P2-a ───────────────────────────────────────────

describe('snapshotTotalForBinding — P2-a', () => {
  it('earnings binding returns snapshot.gross (authoritative total)', () => {
    expect(snapshotTotalForBinding(snapshot, 'earnings')).toBe(snapshot.gross);
  });

  it('deductions binding returns snapshot.totalDeductions', () => {
    expect(snapshotTotalForBinding(snapshot, 'deductions')).toBe(snapshot.totalDeductions);
  });

  it('employer_contributions binding returns sum of employer contributions', () => {
    const expected = snapshot.employerContributions.reduce((s, ec) => s + ec.amount, 0);
    expect(snapshotTotalForBinding(snapshot, 'employer_contributions')).toBeCloseTo(expected, 2);
  });

  it('unknown binding returns null (caller falls back to accumulated row sum)', () => {
    expect(snapshotTotalForBinding(snapshot, 'anything_else')).toBeNull();
  });
});

// ── renderPayslipPdfWithDesign — snapshot binding renders without crash (P2-a) ─

describe('renderPayslipPdfWithDesign — P2-a binding integration', () => {
  /** Builds a design with one table element using the given binding. */
  function bindingDesign(binding: 'earnings' | 'deductions' | 'employer_contributions') {
    return {
      page: { size: 'a4' as const, orient: 'portrait' as const, bg: '#ffffff' },
      elements: [{
        id: 'tbl-' + binding,
        type: 'table' as const,
        x: 40, y: 40, w: 400, h: 300, z: 1,
        title: 'Test Table',
        accent: '#1b2d54',
        rows: [{ label: 'STATIC DEMO ROW', amount: '$999,999.99' }],
        showHead: true, showTotal: true, totalLabel: 'Total',
        headColor: '#ffffff', totalColor: '#1b2d54',
        color: '#334155', bg: '#ffffff',
        fontSize: 9, fontFamily: 'Helvetica',
        bold: false, italic: false,
        borderW: 0, borderColor: '#000', borderStyle: 'solid' as const,
        padding: 6, lineHeight: 1.2,
        binding,
      }],
    };
  }

  for (const binding of ['earnings', 'deductions', 'employer_contributions'] as const) {
    it(`renders a valid PDF with binding="${binding}" without crashing`, async () => {
      const buf = await renderPayslipPdfWithDesign(snapshot, bindingDesign(binding), employer);
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(buf.toString('latin1')).toContain('%%EOF');
      expect(buf.length).toBeGreaterThan(200);
    });
  }

  it('falls back to built-in renderer when design is null', async () => {
    const buf = await renderPayslipPdfWithDesign(snapshot, null, employer);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(1000);
  });

  it('falls back to built-in renderer when design has no elements', async () => {
    const emptyDesign = { page: { size: 'a4' as const, orient: 'portrait' as const, bg: '#ffffff' }, elements: [] };
    const buf = await renderPayslipPdfWithDesign(snapshot, emptyDesign, employer);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('renders a table without binding (static rows) without crashing', async () => {
    const design = {
      page: { size: 'a4' as const, orient: 'portrait' as const, bg: '#ffffff' },
      elements: [{
        id: 'tbl-static', type: 'table' as const,
        x: 40, y: 40, w: 400, h: 300, z: 1,
        title: 'Items', accent: '#1b2d54',
        rows: [{ label: 'Custom Row Label', amount: '$777.00' }],
        showHead: true, showTotal: true, totalLabel: 'Total',
        headColor: '#ffffff', totalColor: '#1b2d54',
        color: '#334155', bg: '#ffffff',
        fontSize: 9, fontFamily: 'Helvetica',
        bold: false, italic: false,
        borderW: 0, borderColor: '#000', borderStyle: 'solid' as const,
        padding: 6, lineHeight: 1.2,
        // NO binding property
      }],
    };
    const buf = await renderPayslipPdfWithDesign(snapshot, design, employer);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.toString('latin1')).toContain('%%EOF');
  });
});

// ── decodeDataUri — P2-c ─────────────────────────────────────────────────────

// Minimal 1×1 black pixel PNG (valid, well under 2 MB)
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// Minimal valid JPEG (1×1 pixel)
const TINY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwg' +
  'JC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAEDASIAAhEBAxEB/8QAFgABAQEAAAAA' +
  'AAAAAAAAAAAABgUEB/8QAIhAAAQQCAgMBAAAAAAAAAAAAAQIDBBEhMQUSBhP/xAAUAQEAAAAAAAAAAAAA' +
  'AAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8Atx5Wbc21RwY3qSRQtXXNqjFV' +
  'VS7r1KkP6TZbVAAAAA//2Q==';

describe('decodeDataUri — P2-c', () => {
  it('decodes a valid PNG data-URI', () => {
    const result = decodeDataUri('data:image/png;base64,' + TINY_PNG_B64);
    expect(result).not.toBeNull();
    expect(result?.mimeType).toBe('image/png');
    expect(result?.data).toBeInstanceOf(Buffer);
    expect((result?.data?.length ?? 0) > 0).toBe(true);
  });

  it('decodes a valid JPEG data-URI', () => {
    const result = decodeDataUri('data:image/jpeg;base64,' + TINY_JPEG_B64);
    expect(result).not.toBeNull();
    expect(result?.mimeType).toBe('image/jpeg');
  });

  it('returns null for an http:// URL (server-side inaccessible)', () => {
    expect(decodeDataUri('https://example.com/logo.png')).toBeNull();
  });

  it('returns null for a non-base64 data-URI', () => {
    expect(decodeDataUri('data:image/png,rawtext')).toBeNull();
  });

  it('returns null for unsupported MIME type (SVG)', () => {
    expect(decodeDataUri('data:image/svg+xml;base64,PHN2Zy8+')).toBeNull();
  });

  it('returns null for unsupported MIME type (WebP)', () => {
    expect(decodeDataUri('data:image/webp;base64,AAAA')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(decodeDataUri('')).toBeNull();
  });

  it('returns null for a data-URI with no comma', () => {
    expect(decodeDataUri('data:image/png;base64')).toBeNull();
  });

  it('returns null for a data-URI with zero-length payload', () => {
    expect(decodeDataUri('data:image/png;base64,')).toBeNull();
  });

  it('returns null when the decoded buffer exceeds 2 MB', () => {
    // Build a payload that decodes to > 2MB of zeros
    const oversized = Buffer.alloc(2 * 1024 * 1024 + 1, 0).toString('base64');
    expect(decodeDataUri('data:image/png;base64,' + oversized)).toBeNull();
  });
});

// ── renderPayslipPdfWithDesign — image embedding (P2-c) ──────────────────────

describe('renderPayslipPdfWithDesign — P2-c image embedding', () => {
  function imageDesign(src: string) {
    return {
      page: { size: 'a4' as const, orient: 'portrait' as const, bg: '#ffffff' },
      elements: [{
        id: 'img-1', type: 'image' as const,
        x: 10, y: 10, w: 80, h: 80, z: 1,
        src,
      }],
    };
  }

  it('renders a valid PDF when image is a data-URI PNG (embedded without crashing)', async () => {
    const buf = await renderPayslipPdfWithDesign(
      snapshot, imageDesign('data:image/png;base64,' + TINY_PNG_B64), employer,
    );
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.toString('latin1')).toContain('%%EOF');
    // An embedded image adds content — the PDF should be larger than a blank fallback
    expect(buf.length).toBeGreaterThan(500);
  });

  it('renders a valid PDF when image src is an http:// URL (skipped silently)', async () => {
    const buf = await renderPayslipPdfWithDesign(
      snapshot, imageDesign('https://example.com/logo.png'), employer,
    );
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('renders a valid PDF when image src is empty (skipped silently)', async () => {
    const buf = await renderPayslipPdfWithDesign(
      snapshot, imageDesign(''), employer,
    );
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('renders a valid PDF when image data-URI has unsupported MIME (skipped silently)', async () => {
    const buf = await renderPayslipPdfWithDesign(
      snapshot, imageDesign('data:image/svg+xml;base64,PHN2Zy8+'), employer,
    );
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
