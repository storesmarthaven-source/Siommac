// Unit tests for payslipDesignSchema.ts (Phase 2 P2-b)
// Pure module — no DB, no supabase. Importable in ts-jest without stubs.
//
// Covers: valid designs pass, missing/malformed required fields are rejected with
// a descriptive error message, the binding enum is validated, unknown fields are
// preserved (not an error), and design shape requirements for every element type.

import { validateDesign } from '../../netlify/functions/lib/finance/payslipDesignSchema';

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** A complete, valid minimal design with one heading element. */
function validDesign(overrides: Record<string, unknown> = {}) {
  return {
    page: { size: 'a4', orient: 'portrait', bg: '#ffffff' },
    elements: [
      {
        id: 'el-1', type: 'heading', x: 10, y: 10, w: 200, h: 30, z: 1,
        text: 'PAYSLIP',
        color: '#000000', bg: 'transparent',
        fontSize: 16, fontFamily: 'Helvetica',
        bold: true, italic: false,
        borderW: 0, borderColor: '#000', borderStyle: 'solid',
        padding: 4, lineHeight: 1.2,
      },
    ],
    ...overrides,
  };
}

/** Build a valid table element (all required fields). */
function tableEl(extras: Record<string, unknown> = {}) {
  return {
    id: 'tbl-1', type: 'table', x: 10, y: 50, w: 400, h: 200, z: 2,
    title: 'Earnings', accent: '#1b2d54',
    rows: [{ label: 'Basic Salary', amount: '$5,000.00' }],
    showHead: true, showTotal: true, totalLabel: 'Gross Pay',
    headColor: '#ffffff', totalColor: '#1b2d54',
    color: '#334155', bg: '#ffffff',
    fontSize: 9, fontFamily: 'Helvetica',
    bold: false, italic: false,
    borderW: 0, borderColor: '#000', borderStyle: 'solid',
    padding: 6, lineHeight: 1.2,
    ...extras,
  };
}

// ── Valid designs ──────────────────────────────────────────────────────────────

describe('validateDesign — valid designs', () => {
  it('returns null for a minimal valid design', () => {
    expect(validateDesign(validDesign())).toBeNull();
  });

  it('returns null for all supported page sizes', () => {
    for (const size of ['a4', 'letter', 'legal', 'a5', 'half']) {
      const d = validDesign({ page: { size, orient: 'portrait', bg: '#fff' } });
      expect(validateDesign(d)).toBeNull();
    }
  });

  it('returns null for both orientations', () => {
    for (const orient of ['portrait', 'landscape']) {
      const d = validDesign({ page: { size: 'a4', orient, bg: '#fff' } });
      expect(validateDesign(d)).toBeNull();
    }
  });

  it('returns null for an empty elements array', () => {
    const d = validDesign({ elements: [] });
    expect(validateDesign(d)).toBeNull();
  });

  it('returns null for a table with valid binding enum', () => {
    for (const binding of ['earnings', 'deductions', 'employer_contributions']) {
      const d = { page: { size: 'a4', orient: 'portrait', bg: '#ffffff' }, elements: [tableEl({ binding })] };
      expect(validateDesign(d)).toBeNull();
    }
  });

  it('preserves unknown extra fields without error', () => {
    const d = validDesign({ _custom_field: 'hello', page: { size: 'a4', orient: 'portrait', bg: '#fff', grid: true } });
    expect(validateDesign(d)).toBeNull();
  });

  it('returns null for all supported element types with required fields', () => {
    const elements = [
      // heading
      { id: 'h1', type: 'heading', x: 0, y: 0, w: 100, h: 20, z: 1, text: 'H', color: '#000', bg: 'transparent', fontSize: 12, fontFamily: 'Helvetica', bold: false, italic: false, borderW: 0, borderColor: '#000', borderStyle: 'solid', padding: 0, lineHeight: 1 },
      // text
      { id: 't1', type: 'text', x: 0, y: 30, w: 100, h: 20, z: 2, text: 'T', color: '#000', bg: 'transparent', fontSize: 10, fontFamily: 'Helvetica', bold: false, italic: false, borderW: 0, borderColor: '#000', borderStyle: 'solid', padding: 0, lineHeight: 1 },
      // field
      { id: 'f1', type: 'field', x: 0, y: 60, w: 200, h: 20, z: 3, label: 'Employee', token: 'employee.name', color: '#000', bg: 'transparent', fontSize: 10, fontFamily: 'Helvetica', bold: false, italic: false, borderW: 0, borderColor: '#000', borderStyle: 'solid', padding: 0, lineHeight: 1 },
      // summary
      { id: 's1', type: 'summary', x: 0, y: 90, w: 200, h: 40, z: 4, label: 'Net Pay', token: 'pay.net', sub: 'Take-home', accent: '#1b2d54', value: '', color: '#fff', bg: '#1b2d54', fontSize: 14, fontFamily: 'Helvetica', bold: true, italic: false, borderW: 0, borderColor: '#000', borderStyle: 'solid', padding: 8, lineHeight: 1 },
      // box
      { id: 'b1', type: 'box', x: 0, y: 140, w: 100, h: 30, z: 5, color: '#000', bg: '#eee', fontSize: 10, fontFamily: 'Helvetica', bold: false, italic: false, borderW: 1, borderColor: '#ccc', borderStyle: 'dashed', padding: 4, lineHeight: 1 },
      // divider
      { id: 'd1', type: 'divider', x: 0, y: 180, w: 400, h: 2, z: 6, color: '#ccc', thickness: 1, style: 'solid' },
      // image
      { id: 'i1', type: 'image', x: 0, y: 190, w: 80, h: 80, z: 7, src: 'data:image/png;base64,AAAA' },
    ];
    const d = { page: { size: 'a4', orient: 'portrait', bg: '#fff' }, elements };
    expect(validateDesign(d)).toBeNull();
  });
});

// ── Top-level shape ───────────────────────────────────────────────────────────

describe('validateDesign — top-level shape', () => {
  it('rejects null', () => {
    expect(validateDesign(null)).not.toBeNull();
  });

  it('rejects a string', () => {
    expect(validateDesign('{}')). not.toBeNull();
  });

  it('rejects an array', () => {
    expect(validateDesign([])).not.toBeNull();
  });

  it('rejects a design without page', () => {
    expect(validateDesign({ elements: [] })).toMatch(/page/i);
  });

  it('rejects a design without elements', () => {
    expect(validateDesign({ page: { size: 'a4', orient: 'portrait', bg: '#fff' } })).toMatch(/elements/i);
  });

  it('rejects elements that is not an array', () => {
    expect(validateDesign({ page: { size: 'a4', orient: 'portrait', bg: '#fff' }, elements: 'bad' })).toMatch(/elements/i);
  });
});

// ── Page validation ───────────────────────────────────────────────────────────

describe('validateDesign — page', () => {
  it('rejects invalid page.size', () => {
    const d = validDesign({ page: { size: 'tabloid', orient: 'portrait', bg: '#fff' } });
    expect(validateDesign(d)).toMatch(/size/i);
  });

  it('rejects invalid page.orient', () => {
    const d = validDesign({ page: { size: 'a4', orient: 'sideways', bg: '#fff' } });
    expect(validateDesign(d)).toMatch(/orient/i);
  });

  it('rejects non-string page.bg', () => {
    const d = validDesign({ page: { size: 'a4', orient: 'portrait', bg: 123 } });
    expect(validateDesign(d)).toMatch(/bg/i);
  });

  it('rejects page that is not an object', () => {
    const d = validDesign({ page: 'a4' });
    expect(validateDesign(d)).toMatch(/page/i);
  });
});

// ── Base element validation ───────────────────────────────────────────────────

describe('validateDesign — base element fields', () => {
  function withEl(el: Record<string, unknown>) {
    return { page: { size: 'a4', orient: 'portrait', bg: '#fff' }, elements: [el] };
  }

  const baseEl = { id: 'e1', type: 'heading', x: 10, y: 10, w: 100, h: 20, z: 1, text: 'X', color: '#000', bg: '#fff', fontSize: 10, fontFamily: 'Helvetica', bold: false, italic: false, borderW: 0, borderColor: '#000', borderStyle: 'solid', padding: 0, lineHeight: 1 };

  it('rejects an element without id', () => {
    const { id: _id, ...el } = baseEl;
    expect(validateDesign(withEl(el))).toMatch(/id/i);
  });

  it('rejects an element with empty-string id', () => {
    expect(validateDesign(withEl({ ...baseEl, id: '' }))).toMatch(/id/i);
  });

  it('rejects non-number x', () => {
    expect(validateDesign(withEl({ ...baseEl, x: 'left' }))).toMatch(/x/i);
  });

  it('rejects negative x', () => {
    expect(validateDesign(withEl({ ...baseEl, x: -1 }))).toMatch(/x/i);
  });

  it('rejects negative y', () => {
    expect(validateDesign(withEl({ ...baseEl, y: -5 }))).toMatch(/y/i);
  });

  it('rejects zero width', () => {
    expect(validateDesign(withEl({ ...baseEl, w: 0 }))).toMatch(/w/i);
  });

  it('rejects negative width', () => {
    expect(validateDesign(withEl({ ...baseEl, w: -10 }))).toMatch(/w/i);
  });

  it('rejects zero height', () => {
    expect(validateDesign(withEl({ ...baseEl, h: 0 }))).toMatch(/h/i);
  });

  it('rejects an unknown element type', () => {
    expect(validateDesign(withEl({ ...baseEl, type: 'chart' }))).toMatch(/type/i);
  });
});

// ── Style element validation ──────────────────────────────────────────────────

describe('validateDesign — style element fields', () => {
  function withEl(el: Record<string, unknown>) {
    return { page: { size: 'a4', orient: 'portrait', bg: '#fff' }, elements: [el] };
  }

  const styleBase = { id: 'e1', type: 'text', x: 0, y: 0, w: 100, h: 20, z: 1, text: 'X', color: '#000', bg: '#fff', fontSize: 10, fontFamily: 'Helvetica', bold: false, italic: false, borderW: 0, borderColor: '#000', borderStyle: 'solid', padding: 0, lineHeight: 1 };

  it('rejects zero fontSize', () => {
    expect(validateDesign(withEl({ ...styleBase, fontSize: 0 }))).toMatch(/fontSize/i);
  });

  it('rejects negative fontSize', () => {
    expect(validateDesign(withEl({ ...styleBase, fontSize: -1 }))).toMatch(/fontSize/i);
  });

  it('rejects non-boolean bold', () => {
    expect(validateDesign(withEl({ ...styleBase, bold: 1 }))).toMatch(/bold/i);
  });

  it('rejects negative borderW', () => {
    expect(validateDesign(withEl({ ...styleBase, borderW: -1 }))).toMatch(/borderW/i);
  });

  it('rejects invalid borderStyle', () => {
    expect(validateDesign(withEl({ ...styleBase, borderStyle: 'wavy' }))).toMatch(/borderStyle/i);
  });

  it('rejects negative padding', () => {
    expect(validateDesign(withEl({ ...styleBase, padding: -2 }))).toMatch(/padding/i);
  });

  it('rejects zero lineHeight', () => {
    expect(validateDesign(withEl({ ...styleBase, lineHeight: 0 }))).toMatch(/lineHeight/i);
  });
});

// ── Field element ─────────────────────────────────────────────────────────────

describe('validateDesign — field element', () => {
  function withEl(el: Record<string, unknown>) {
    return { page: { size: 'a4', orient: 'portrait', bg: '#fff' }, elements: [el] };
  }

  const fieldBase = { id: 'f1', type: 'field', x: 0, y: 0, w: 200, h: 20, z: 1, label: 'Name', token: 'employee.name', color: '#000', bg: '#fff', fontSize: 10, fontFamily: 'Helvetica', bold: false, italic: false, borderW: 0, borderColor: '#000', borderStyle: 'solid', padding: 0, lineHeight: 1 };

  it('rejects empty token', () => {
    expect(validateDesign(withEl({ ...fieldBase, token: '' }))).toMatch(/token/i);
  });

  it('rejects non-string token', () => {
    expect(validateDesign(withEl({ ...fieldBase, token: 42 }))).toMatch(/token/i);
  });

  it('rejects negative labelWidth', () => {
    expect(validateDesign(withEl({ ...fieldBase, labelWidth: -10 }))).toMatch(/labelWidth/i);
  });

  it('accepts missing labelWidth (optional field)', () => {
    const { ...el } = fieldBase;
    expect(validateDesign(withEl(el))).toBeNull();
  });
});

// ── Table element + binding ───────────────────────────────────────────────────

describe('validateDesign — table element + binding', () => {
  function withEl(el: Record<string, unknown>) {
    return { page: { size: 'a4', orient: 'portrait', bg: '#fff' }, elements: [el] };
  }

  it('rejects non-array rows', () => {
    expect(validateDesign(withEl(tableEl({ rows: 'bad' })))).toMatch(/rows/i);
  });

  it('rejects a row without label', () => {
    expect(validateDesign(withEl(tableEl({ rows: [{ amount: '$0' }] })))).toMatch(/label/i);
  });

  it('rejects a row without amount', () => {
    expect(validateDesign(withEl(tableEl({ rows: [{ label: 'X' }] })))).toMatch(/amount/i);
  });

  it('rejects invalid binding value', () => {
    expect(validateDesign(withEl(tableEl({ binding: 'revenue' })))).toMatch(/binding/i);
  });

  it('accepts null binding (field is optional)', () => {
    expect(validateDesign(withEl(tableEl({ binding: null })))).toBeNull();
  });

  it('accepts undefined binding (field is optional)', () => {
    const el = tableEl();
    delete (el as Record<string, unknown>)['binding'];
    expect(validateDesign(withEl(el))).toBeNull();
  });

  it('rejects non-boolean showHead', () => {
    expect(validateDesign(withEl(tableEl({ showHead: 'yes' })))).toMatch(/showHead/i);
  });
});

// ── Divider element ───────────────────────────────────────────────────────────

describe('validateDesign — divider element', () => {
  function withEl(el: Record<string, unknown>) {
    return { page: { size: 'a4', orient: 'portrait', bg: '#fff' }, elements: [el] };
  }

  const divEl = { id: 'd1', type: 'divider', x: 0, y: 0, w: 400, h: 2, z: 1, color: '#ccc', thickness: 1, style: 'solid' };

  it('rejects zero thickness', () => {
    expect(validateDesign(withEl({ ...divEl, thickness: 0 }))).toMatch(/thickness/i);
  });

  it('rejects invalid divider style', () => {
    expect(validateDesign(withEl({ ...divEl, style: 'wavy' }))).toMatch(/style/i);
  });
});

// ── Image element ─────────────────────────────────────────────────────────────

describe('validateDesign — image element', () => {
  function withEl(el: Record<string, unknown>) {
    return { page: { size: 'a4', orient: 'portrait', bg: '#fff' }, elements: [el] };
  }

  it('rejects missing src', () => {
    const el = { id: 'i1', type: 'image', x: 0, y: 0, w: 80, h: 80, z: 1 };
    expect(validateDesign(withEl(el))).toMatch(/src/i);
  });

  it('accepts an image with src (empty string is allowed — renderer skips it gracefully)', () => {
    const el = { id: 'i1', type: 'image', x: 0, y: 0, w: 80, h: 80, z: 1, src: '' };
    expect(validateDesign(withEl(el))).toBeNull();
  });
});

// ── Resource limits (P2-b) ───────────────────────────────────────────────────────

describe('validateDesign — resource limits', () => {
  it('rejects more than 300 elements', () => {
    const el = validDesign().elements[0];
    const many = Array.from({ length: 301 }, (_, i) => ({ ...el, id: `e${i}` }));
    expect(validateDesign(validDesign({ elements: many }))).toMatch(/element limit/i);
  });

  it('accepts exactly 300 elements', () => {
    const el = validDesign().elements[0];
    const many = Array.from({ length: 300 }, (_, i) => ({ ...el, id: `e${i}` }));
    expect(validateDesign(validDesign({ elements: many }))).toBeNull();
  });

  it('rejects a coordinate above the 20000px limit', () => {
    const el = { ...validDesign().elements[0], w: 20001 };
    expect(validateDesign(validDesign({ elements: [el] }))).toMatch(/limit/i);
  });

  it('rejects text longer than 10000 chars', () => {
    const el = { ...validDesign().elements[0], text: 'x'.repeat(10_001) };
    expect(validateDesign(validDesign({ elements: [el] }))).toMatch(/character limit/i);
  });

  it('rejects a table with more than 300 rows', () => {
    const rows = Array.from({ length: 301 }, () => ({ label: 'a', amount: '1' }));
    expect(validateDesign(validDesign({ elements: [tableEl({ rows })] }))).toMatch(/row limit/i);
  });

  it('rejects an image src over ~2 MB', () => {
    const el = { id: 'i1', type: 'image', x: 0, y: 0, w: 80, h: 80, z: 1, src: 'x'.repeat(3_000_001) };
    expect(validateDesign(validDesign({ elements: [el] }))).toMatch(/2 MB|limit/i);
  });

  it('rejects a total payload over 4 MB', () => {
    const big = validDesign({ junk: 'x'.repeat(4_000_001) });
    expect(validateDesign(big)).toMatch(/byte limit/i);
  });
});
