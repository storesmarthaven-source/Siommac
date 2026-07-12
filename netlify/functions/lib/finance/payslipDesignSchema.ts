// ============================================================================
// Payslip Studio -- Shared Design JSON schema + validation (Phase 2 P2-b)
// ============================================================================
// Pure module -- NO database imports. Importable from ts-jest without stubs.
//
// validateDesign(design) -- validates the complete Design JSON stored in
//   payroll_payslip_templates.design. Returns an error message string or null
//   (valid). Used by both create and update so the schema is enforced once
//   in a single shared function (no duplication between routes).
//
// Unknown / extra fields are preserved without error (future extensibility);
// only missing or malformed required fields are rejected.
//
// Binding enum values mirror what renderPayslipPdfWithDesign recognises:
//   'earnings' | 'deductions' | 'employer_contributions'
// ============================================================================

export type DesignPageSize = 'a4' | 'letter' | 'legal' | 'a5' | 'half';
export type DesignOrient   = 'portrait' | 'landscape';
export type TableBinding   = 'earnings' | 'deductions' | 'employer_contributions';
export type ElementType    = 'heading' | 'text' | 'field' | 'table' | 'summary' | 'image' | 'divider' | 'box';
export type BorderStyle    = 'solid' | 'dashed' | 'dotted';

const VALID_PAGE_SIZES   = new Set<string>(['a4', 'letter', 'legal', 'a5', 'half']);
const VALID_ORIENTS      = new Set<string>(['portrait', 'landscape']);
const VALID_EL_TYPES     = new Set<string>([
  'heading', 'text', 'field', 'table', 'summary', 'image', 'divider', 'box',
]);
const VALID_BINDINGS     = new Set<string>([
  'earnings', 'deductions', 'employer_contributions',
]);
const VALID_BORDER_STYLE = new Set<string>(['solid', 'dashed', 'dotted']);

// ── Resource limits (P2-b: reject abusive/oversized designs before storage) ────
// A payslip is one page of layout; these ceilings are far above any real design
// but bound memory/PDF work and storage. Image src is a data-URI: cap the base64
// so it can't exceed the renderer's 2 MB decoded limit (~1.37x inflation).
const MAX_JSON_BYTES  = 4_000_000;   // whole serialized design
const MAX_ELEMENTS    = 300;
const MAX_COORD       = 20_000;      // x/y/w/h upper bound (px in studio space)
const MAX_TEXT_LEN    = 10_000;      // heading/text body
const MAX_LABEL_LEN   = 1_000;       // labels/titles/tokens/values
const MAX_TABLE_ROWS  = 300;
const MAX_IMAGE_SRC   = 3_000_000;   // data-URI length (~2 MB decoded)

// ── Internal type guards ───────────────────────────────────────────────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function isStr(v: unknown, minLen = 0): v is string {
  return typeof v === 'string' && v.length >= minLen;
}
function isNum(v: unknown): v is number {
  return typeof v === 'number' && isFinite(v);
}
function isBool(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

// ── Base element validator (geometry; shared by all element types) ─────────────

function validateBaseEl(el: Record<string, unknown>, i: number): string | null {
  if (!isStr(el['id'], 1))
    return `element[${i}].id must be a non-empty string`;
  if (!isNum(el['x']))
    return `element[${i}].x must be a finite number`;
  if (!isNum(el['y']))
    return `element[${i}].y must be a finite number`;
  if (!isNum(el['w']) || (el['w'] as number) <= 0)
    return `element[${i}].w must be a positive number`;
  if (!isNum(el['h']) || (el['h'] as number) <= 0)
    return `element[${i}].h must be a positive number`;
  if (!isNum(el['z']))
    return `element[${i}].z must be a finite number`;
  if ((el['x'] as number) < 0)
    return `element[${i}].x must be >= 0`;
  if ((el['y'] as number) < 0)
    return `element[${i}].y must be >= 0`;
  for (const k of ['x', 'y', 'w', 'h'] as const) {
    if ((el[k] as number) > MAX_COORD)
      return `element[${i}].${k} exceeds the ${MAX_COORD}px limit`;
  }
  return null;
}

// ── Style element validator (visual props; shared by all elements except divider/image) ──

function validateStyleEl(el: Record<string, unknown>, i: number): string | null {
  if (!isStr(el['color']))
    return `element[${i}].color must be a string`;
  if (!isStr(el['bg']))
    return `element[${i}].bg must be a string`;
  if (!isNum(el['fontSize']) || (el['fontSize'] as number) <= 0)
    return `element[${i}].fontSize must be a positive number`;
  if (!isStr(el['fontFamily']))
    return `element[${i}].fontFamily must be a string`;
  if (!isBool(el['bold']))
    return `element[${i}].bold must be a boolean`;
  if (!isBool(el['italic']))
    return `element[${i}].italic must be a boolean`;
  if (!isNum(el['borderW']) || (el['borderW'] as number) < 0)
    return `element[${i}].borderW must be a non-negative number`;
  if (!isStr(el['borderColor']))
    return `element[${i}].borderColor must be a string`;
  if (!isStr(el['borderStyle']) || !VALID_BORDER_STYLE.has(el['borderStyle'] as string))
    return `element[${i}].borderStyle must be 'solid', 'dashed', or 'dotted'`;
  if (!isNum(el['padding']) || (el['padding'] as number) < 0)
    return `element[${i}].padding must be a non-negative number`;
  if (!isNum(el['lineHeight']) || (el['lineHeight'] as number) <= 0)
    return `element[${i}].lineHeight must be a positive number`;
  return null;
}

// ── Per-type validators ────────────────────────────────────────────────────────

function validateTextEl(el: Record<string, unknown>, i: number): string | null {
  if (!isStr(el['text']))
    return `element[${i}].text must be a string`;
  if ((el['text'] as string).length > MAX_TEXT_LEN)
    return `element[${i}].text exceeds the ${MAX_TEXT_LEN}-character limit`;
  return null;
}

function validateFieldEl(el: Record<string, unknown>, i: number): string | null {
  if (!isStr(el['label']))
    return `element[${i}].label must be a string`;
  if (!isStr(el['token'], 1))
    return `element[${i}].token must be a non-empty string`;
  if (el['labelWidth'] !== undefined && el['labelWidth'] !== null) {
    if (!isNum(el['labelWidth']) || (el['labelWidth'] as number) < 0)
      return `element[${i}].labelWidth must be a non-negative number`;
  }
  return null;
}

function validateSummaryEl(el: Record<string, unknown>, i: number): string | null {
  if (!isStr(el['label']))
    return `element[${i}].label must be a string`;
  if (!isStr(el['token']))
    return `element[${i}].token must be a string`;
  if (!isStr(el['sub']))
    return `element[${i}].sub must be a string`;
  if (!isStr(el['accent']))
    return `element[${i}].accent must be a string`;
  if (!isStr(el['value']))
    return `element[${i}].value must be a string`;
  return null;
}

function validateTableEl(el: Record<string, unknown>, i: number): string | null {
  if (!isStr(el['title']))
    return `element[${i}].title must be a string`;
  if (!isStr(el['accent']))
    return `element[${i}].accent must be a string`;
  if (!Array.isArray(el['rows']))
    return `element[${i}].rows must be an array`;
  if (!isBool(el['showHead']))
    return `element[${i}].showHead must be a boolean`;
  if (!isBool(el['showTotal']))
    return `element[${i}].showTotal must be a boolean`;
  if (!isStr(el['totalLabel']))
    return `element[${i}].totalLabel must be a string`;
  if (!isStr(el['headColor']))
    return `element[${i}].headColor must be a string`;
  if (!isStr(el['totalColor']))
    return `element[${i}].totalColor must be a string`;

  // Validate each static row. When binding is set the renderer ignores these
  // rows, but they must still have a valid shape so the stored JSON stays clean.
  const rows = el['rows'] as unknown[];
  if (rows.length > MAX_TABLE_ROWS)
    return `element[${i}].rows exceeds the ${MAX_TABLE_ROWS}-row limit`;
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    if (!isObj(row))
      return `element[${i}].rows[${ri}] must be an object`;
    const r = row as Record<string, unknown>;
    if (!isStr(r['label']) || (r['label'] as string).length > MAX_LABEL_LEN)
      return `element[${i}].rows[${ri}].label must be a string <= ${MAX_LABEL_LEN} chars`;
    if (!isStr(r['amount']) || (r['amount'] as string).length > MAX_LABEL_LEN)
      return `element[${i}].rows[${ri}].amount must be a string <= ${MAX_LABEL_LEN} chars`;
  }

  // Optional binding field: must be a recognised enum value when present.
  if (el['binding'] !== undefined && el['binding'] !== null) {
    if (!VALID_BINDINGS.has(el['binding'] as string)) {
      return (
        `element[${i}].binding must be one of: ` +
        `'earnings', 'deductions', 'employer_contributions'`
      );
    }
  }

  return null;
}

function validateDividerEl(el: Record<string, unknown>, i: number): string | null {
  if (!isStr(el['color']))
    return `element[${i}].color must be a string`;
  if (!isNum(el['thickness']) || (el['thickness'] as number) <= 0)
    return `element[${i}].thickness must be a positive number`;
  if (!isStr(el['style']) || !VALID_BORDER_STYLE.has(el['style'] as string))
    return `element[${i}].style must be 'solid', 'dashed', or 'dotted'`;
  return null;
}

function validateImageEl(el: Record<string, unknown>, i: number): string | null {
  if (!isStr(el['src']))
    return `element[${i}].src must be a string`;
  if ((el['src'] as string).length > MAX_IMAGE_SRC)
    return `element[${i}].src exceeds the ${MAX_IMAGE_SRC}-character (~2 MB) limit`;
  return null;
}

// ── Main exported validator ────────────────────────────────────────────────────

/**
 * Validate a Payslip Studio Design JSON object.
 *
 * Returns an error message (string) when invalid, or null when valid.
 * Unknown / extra fields are preserved without error.
 * Callers should throw a 422 with the returned message.
 */
export function validateDesign(design: unknown): string | null {
  if (!isObj(design))
    return 'Design must be a non-null JSON object.';

  // ── total payload size (bounds storage + downstream render work) ────────────
  let bytes = 0;
  try { bytes = JSON.stringify(design).length; }
  catch { return 'Design is not serializable JSON (circular reference?).'; }
  if (bytes > MAX_JSON_BYTES)
    return `Design payload (${bytes} bytes) exceeds the ${MAX_JSON_BYTES}-byte limit.`;

  // ── page ──────────────────────────────────────────────────────────────────
  const page = design['page'];
  if (!isObj(page))
    return 'Design.page must be an object.';
  if (!isStr(page['size']) || !VALID_PAGE_SIZES.has(page['size']))
    return `Design.page.size must be one of: ${[...VALID_PAGE_SIZES].join(', ')}.`;
  if (!isStr(page['orient']) || !VALID_ORIENTS.has(page['orient']))
    return `Design.page.orient must be 'portrait' or 'landscape'.`;
  if (!isStr(page['bg']))
    return 'Design.page.bg must be a string.';

  // ── elements ───────────────────────────────────────────────────────────────
  if (!Array.isArray(design['elements']))
    return 'Design.elements must be an array.';

  const elements = design['elements'] as unknown[];
  if (elements.length > MAX_ELEMENTS)
    return `Design.elements exceeds the ${MAX_ELEMENTS}-element limit (${elements.length}).`;
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    if (!isObj(el))
      return `element[${i}] must be an object.`;

    if (!isStr(el['type']) || !VALID_EL_TYPES.has(el['type'] as string))
      return `element[${i}].type must be one of: ${[...VALID_EL_TYPES].join(', ')}.`;

    const baseErr = validateBaseEl(el, i);
    if (baseErr) return baseErr;

    const t = el['type'] as ElementType;

    // Style properties are required on all element types except divider and image.
    if (t !== 'divider' && t !== 'image') {
      const styleErr = validateStyleEl(el, i);
      if (styleErr) return styleErr;
    }

    // Per-type validation.
    switch (t) {
      case 'heading':
      case 'text': {
        const err = validateTextEl(el, i);
        if (err) return err;
        break;
      }
      case 'field': {
        const err = validateFieldEl(el, i);
        if (err) return err;
        break;
      }
      case 'summary': {
        const err = validateSummaryEl(el, i);
        if (err) return err;
        break;
      }
      case 'table': {
        const err = validateTableEl(el, i);
        if (err) return err;
        break;
      }
      case 'divider': {
        const err = validateDividerEl(el, i);
        if (err) return err;
        break;
      }
      case 'image': {
        const err = validateImageEl(el, i);
        if (err) return err;
        break;
      }
      case 'box':
        // No additional required fields beyond base + style.
        break;
    }
  }

  return null;
}
