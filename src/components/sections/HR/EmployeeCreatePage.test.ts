/**
 * src/components/sections/HR/EmployeeCreatePage.test.ts
 *
 * Unit tests for the pure logic exported from EmployeeCreatePage:
 *   • reqStr / validEmail / validDate — field-level validators
 *   • validateStep — per-step validation (steps 0, 1, 3)
 *   • formToArgs — FormState → CreateHrEmployeeArgsV2 mapping
 *
 * Also includes the CSS regression guard: asserts that every emp-wiz-*
 * class used in the component has a matching rule in the stylesheet.
 * Prevents the "45 classes, 0 rules" defect from recurring silently.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import {
  reqStr, validEmail, validDate,
  validateStep, formToArgs,
  EMPTY_FORM, type FormState,
} from './EmployeeCreatePage';

// ── Primitive validators ──────────────────────────────────────────────────────

describe('reqStr', () => {
  it('returns null for non-empty strings', () => {
    expect(reqStr('Alice', 'First name')).toBeNull();
    expect(reqStr('  x  ', 'X')).toBeNull();
  });
  it('returns an error message for blank strings', () => {
    expect(reqStr('', 'First name')).toBe('First name is required.');
    expect(reqStr('   ', 'Last name')).toBe('Last name is required.');
  });
});

describe('validEmail', () => {
  it('returns null for empty/omitted values', () => {
    expect(validEmail('')).toBeNull();
    expect(validEmail('   ')).toBeNull();
  });
  it('accepts well-formed email addresses', () => {
    expect(validEmail('alice@example.com')).toBeNull();
    expect(validEmail('a.b+tag@sub.domain.org')).toBeNull();
  });
  it('rejects addresses missing @ or domain', () => {
    expect(validEmail('notanemail')).toBe('Invalid email address.');
    expect(validEmail('missing@')).toBe('Invalid email address.');
    expect(validEmail('@nodomain.com')).toBe('Invalid email address.');
  });
});

describe('validDate', () => {
  it('returns null for empty/omitted values (date is optional)', () => {
    expect(validDate('', 'DOB')).toBeNull();
    expect(validDate('   ', 'Start date')).toBeNull();
  });
  it('accepts ISO 8601 YYYY-MM-DD dates', () => {
    expect(validDate('2026-01-15', 'Start date')).toBeNull();
    expect(validDate('2000-12-31', 'DOB')).toBeNull();
  });
  it('rejects non-ISO or partial date strings', () => {
    expect(validDate('01/15/2026', 'Start date')).toBe('Start date: use YYYY-MM-DD format.');
    expect(validDate('2026-1-5', 'DOB')).toBe('DOB: use YYYY-MM-DD format.');
    expect(validDate('2026/01/15', 'X')).toBe('X: use YYYY-MM-DD format.');
    expect(validDate('not-a-date', 'X')).toBe('X: use YYYY-MM-DD format.');
  });
});

// ── validateStep ──────────────────────────────────────────────────────────────

describe('validateStep — step 0 (Personal & Identity)', () => {
  it('passes with all required fields present', () => {
    const f: FormState = { ...EMPTY_FORM, firstName: 'Alice', lastName: 'Smith', username: 'alice.smith' };
    expect(validateStep(0, f)).toEqual({});
  });
  it('fails when firstName is missing', () => {
    const f: FormState = { ...EMPTY_FORM, lastName: 'Smith', username: 'alice' };
    const errs = validateStep(0, f);
    expect(errs['firstName']).toBeDefined();
    expect(errs['lastName']).toBeUndefined();
  });
  it('fails when lastName is missing', () => {
    const f: FormState = { ...EMPTY_FORM, firstName: 'Alice', username: 'alice' };
    expect(validateStep(0, f)['lastName']).toBeDefined();
  });
  it('fails when username is missing', () => {
    const f: FormState = { ...EMPTY_FORM, firstName: 'Alice', lastName: 'Smith' };
    expect(validateStep(0, f)['username']).toBeDefined();
  });
  it('rejects usernames with invalid characters', () => {
    const f: FormState = { ...EMPTY_FORM, firstName: 'Alice', lastName: 'Smith', username: 'alice smith!' };
    expect(validateStep(0, f)['username']).toMatch(/letters/i);
  });
  it('accepts username with dots and hyphens', () => {
    const f: FormState = { ...EMPTY_FORM, firstName: 'Alice', lastName: 'Smith', username: 'alice.smith-01' };
    expect(validateStep(0, f)['username']).toBeUndefined();
  });
  it('validates email format when provided', () => {
    const f: FormState = { ...EMPTY_FORM, firstName: 'A', lastName: 'B', username: 'ab', email: 'notvalid' };
    expect(validateStep(0, f)['email']).toBeDefined();
  });
  it('validates personalEmail format when provided', () => {
    const f: FormState = { ...EMPTY_FORM, firstName: 'A', lastName: 'B', username: 'ab', personalEmail: 'bad@@' };
    expect(validateStep(0, f)['personalEmail']).toBeDefined();
  });
  it('validates dateOfBirth format when provided', () => {
    const f: FormState = { ...EMPTY_FORM, firstName: 'A', lastName: 'B', username: 'ab', dateOfBirth: '15-01-2000' };
    expect(validateStep(0, f)['dateOfBirth']).toBeDefined();
  });
  it('allows optional fields to be blank', () => {
    const f: FormState = { ...EMPTY_FORM, firstName: 'Alice', lastName: 'Smith', username: 'alice',
      email: '', personalEmail: '', dateOfBirth: '' };
    expect(validateStep(0, f)).toEqual({});
  });
});

describe('validateStep — step 1 (Employment)', () => {
  it('passes when startDate is blank (optional)', () => {
    expect(validateStep(1, { ...EMPTY_FORM, startDate: '' })).toEqual({});
  });
  it('passes with valid ISO start date', () => {
    expect(validateStep(1, { ...EMPTY_FORM, startDate: '2026-03-01' })).toEqual({});
  });
  it('fails with a non-ISO start date', () => {
    const errs = validateStep(1, { ...EMPTY_FORM, startDate: '01/03/2026' });
    expect(errs['startDate']).toBeDefined();
  });
});

describe('validateStep — step 2 (Assignment)', () => {
  it('always passes (all fields optional)', () => {
    expect(validateStep(2, EMPTY_FORM)).toEqual({});
    expect(validateStep(2, { ...EMPTY_FORM, departmentId: 'some-uuid' })).toEqual({});
  });
});

describe('validateStep — step 3 (Statutory)', () => {
  it('passes when all statutory date/year fields are blank', () => {
    expect(validateStep(3, EMPTY_FORM)).toEqual({});
  });
  it('fails with non-ISO NIS effective date', () => {
    const errs = validateStep(3, { ...EMPTY_FORM, nisEffectiveDate: '01-01-2026' });
    expect(errs['nisEffectiveDate']).toBeDefined();
  });
  it('fails with non-ISO HS effective date', () => {
    const errs = validateStep(3, { ...EMPTY_FORM, hsEffectiveDate: 'Jan 2026' });
    expect(errs['hsEffectiveDate']).toBeDefined();
  });
  it('fails with a non-four-digit TD1 year', () => {
    const errs = validateStep(3, { ...EMPTY_FORM, td1Received: true, td1EffectiveYear: '26' });
    expect(errs['td1EffectiveYear']).toBeDefined();
  });
  it('passes with valid four-digit TD1 year', () => {
    const errs = validateStep(3, { ...EMPTY_FORM, td1Received: true, td1EffectiveYear: '2026' });
    expect(errs['td1EffectiveYear']).toBeUndefined();
  });
  it('passes with all statutory fields correctly filled', () => {
    const f: FormState = {
      ...EMPTY_FORM,
      nisEffectiveDate: '2026-01-01', hsEffectiveDate: '2026-01-01',
      td1EffectiveYear: '2026',
    };
    expect(validateStep(3, f)).toEqual({});
  });
});

describe('validateStep — steps 4 and 5', () => {
  it('step 4 always passes (no server-side validation in FE)', () => {
    expect(validateStep(4, EMPTY_FORM)).toEqual({});
  });
  it('step 5 (review) always passes', () => {
    expect(validateStep(5, EMPTY_FORM)).toEqual({});
  });
  it('unknown step index returns empty errors', () => {
    expect(validateStep(99, EMPTY_FORM)).toEqual({});
  });
});

// ── formToArgs ────────────────────────────────────────────────────────────────

describe('formToArgs', () => {
  it('sends first and last name separately (the contract has no fullName)', () => {
    const args = formToArgs({ ...EMPTY_FORM, firstName: 'Alice', lastName: 'Smith', username: 'alice' });
    expect(args.identity.firstName).toBe('Alice');
    expect(args.identity.lastName).toBe('Smith');
  });

  it('derives a content-based requestKey so a retry cannot double-create', () => {
    const form = { ...EMPTY_FORM, firstName: 'Alice', lastName: 'Smith', username: 'alice', startDate: '2026-01-05' };
    expect(formToArgs(form).requestKey).toBe(formToArgs(form).requestKey);
    expect(formToArgs(form).requestKey).not.toBe(
      formToArgs({ ...form, username: 'bob' }).requestKey,
    );
  });
  it('trims whitespace from all identity fields', () => {
    const args = formToArgs({ ...EMPTY_FORM, firstName: '  Alice  ', lastName: '  Smith  ', username: '  alice  ' });
    expect(args.identity.username).toBe('alice');
    expect(args.identity.firstName).toBe('Alice');
    expect(args.identity.lastName).toBe('Smith');
  });
  it('omits optional identity fields when blank', () => {
    const args = formToArgs({ ...EMPTY_FORM, firstName: 'Alice', lastName: 'Smith', username: 'alice',
      email: '', personalEmail: '', phone: '', employeeNumber: '' });
    expect(args.identity.email).toBeUndefined();
    expect(args.identity.personalEmail).toBeUndefined();
    expect(args.identity.phone).toBeUndefined();
    expect(args.identity.employeeNumber).toBeUndefined();
  });
  it('includes email and phone when present', () => {
    const args = formToArgs({ ...EMPTY_FORM, firstName: 'A', lastName: 'B', username: 'ab',
      email: 'alice@example.com', phone: '+1-868-555-0100' });
    expect(args.identity.email).toBe('alice@example.com');
    expect(args.identity.phone).toBe('+1-868-555-0100');
  });
  it('sends employmentType, which now carries the contractor distinction', () => {
    const args = formToArgs({ ...EMPTY_FORM, firstName: 'A', lastName: 'B', username: 'ab', employmentType: 'contractor' });
    expect(args.employment.employmentType).toBe('contractor');
  });
  it('maps accessProfileId and accountMode', () => {
    const args = formToArgs({ ...EMPTY_FORM, firstName: 'A', lastName: 'B', username: 'ab',
      accessProfileId: 'some-uuid' });
    expect(args.access.accessProfileId).toBe('some-uuid');
    // The contract accepts exactly one mode — no login is ever created here.
    expect(args.access.accountMode).toBe('no_login');
  });
  it('maps statutory boolean flags correctly', () => {
    const args = formToArgs({ ...EMPTY_FORM, firstName: 'A', lastName: 'B', username: 'ab',
      payeApplicable: false, hsApplicable: false, td1Received: true });
    expect(args.statutory?.payeApplicable).toBe(false);
    expect(args.statutory?.hsApplicable).toBe(false);
    expect(args.statutory?.td1Received).toBe(true);
  });
  it('converts td1EffectiveYear string to number', () => {
    const args = formToArgs({ ...EMPTY_FORM, firstName: 'A', lastName: 'B', username: 'ab', td1EffectiveYear: '2026' });
    expect(args.statutory?.td1EffectiveYear).toBe(2026);
  });
  it('sets td1EffectiveYear to null when blank', () => {
    const args = formToArgs({ ...EMPTY_FORM, firstName: 'A', lastName: 'B', username: 'ab', td1EffectiveYear: '' });
    expect(args.statutory?.td1EffectiveYear).toBeNull();
  });
  it('maps nisNumber to null when blank', () => {
    const args = formToArgs({ ...EMPTY_FORM, firstName: 'A', lastName: 'B', username: 'ab', nisNumber: '' });
    expect(args.statutory?.nisNumber).toBeNull();
  });
  it('maps the onboarding request and packageKey', () => {
    const args = formToArgs({ ...EMPTY_FORM, firstName: 'A', lastName: 'B', username: 'ab',
      createOnboardingCase: true, packageKey: 'standard_employee' });
    expect(args.onboarding?.prepareOnboarding).toBe(true);
    expect(args.onboarding?.packageKey).toBe('standard_employee');
  });
  it('uses recordStatus as-is', () => {
    const args = formToArgs({ ...EMPTY_FORM, firstName: 'A', lastName: 'B', username: 'ab', recordStatus: 'probation' });
    expect(args.recordStatus).toBe('probation');
  });
});

// ── CSS regression guards ─────────────────────────────────────────────────────
// The component adopts the APPROVED MOCKUP's class vocabulary (docs/mockups/
// employee-create-wizard-selected.css), scoped under `.emp-create-page` so the
// generic names (.card/.btn/.field/.control) cannot leak into the rest of the app.
//
// Two guards, because the first alone is not sufficient: a component that invents
// its own namespace and styles it consistently passes "every class has a rule"
// while looking nothing like the approved design. That is exactly how a previous
// build shipped 45 bespoke classes with ZERO overlap with the artifact.

function readSrc(name: string): string {
  return fs.readFileSync(path.join(__dirname, name), 'utf8');
}

/** Classes rendered by the component (from `class="…"` attributes). */
function usedClasses(tsxSrc: string): Set<string> {
  const out = new Set<string>();
  for (const attr of tsxSrc.matchAll(/class=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    const body = attr[1] ?? attr[2] ?? '';
    // Strip ${…} interpolations, then split on whitespace.
    for (const token of body.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
      if (/^[a-z][a-z0-9-]*$/.test(token)) out.add(token);
    }
  }
  return out;
}

/** Class selectors defined in a stylesheet. */
function definedClasses(cssSrc: string): Set<string> {
  const out = new Set<string>();
  for (const m of cssSrc.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)) out.add(m[1]!);
  return out;
}

describe('CSS coverage regression guard', () => {
  it('every class rendered by EmployeeCreatePage has a rule in EmployeeCreatePage.css', () => {
    const used    = usedClasses(readSrc('EmployeeCreatePage.tsx'));
    const defined = definedClasses(readSrc('EmployeeCreatePage.css'));

    const missing = [...used].filter(c => !defined.has(c));
    expect(missing, `Rendered with no CSS rule: ${missing.join(', ')}`).toEqual([]);
  });

  it('renders no bespoke emp-wiz-* namespace — the mockup vocabulary is authoritative', () => {
    const tsx = readSrc('EmployeeCreatePage.tsx');
    const css = readSrc('EmployeeCreatePage.css');
    expect(tsx.includes('emp-wiz-')).toBe(false);
    expect(css.includes('emp-wiz-')).toBe(false);
  });

  it('scopes every stylesheet rule under .emp-create-page so generic names cannot leak', () => {
    const css = readSrc('EmployeeCreatePage.css');
    // Strip comments, then every rule block's selector must be scoped (or be the root
    // itself, an @media/@keyframes wrapper, or a nested block inside one).
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = withoutComments
      .split('}')
      .map(chunk => chunk.split('{')[0]?.trim() ?? '')
      .filter(sel => sel && !sel.startsWith('@') && !sel.startsWith('--'));

    const unscoped = selectors.filter(sel =>
      sel.split(',').some(part => {
        const s = part.trim();
        return s.length > 0 && !s.startsWith('.emp-create-page');
      }),
    );
    expect(unscoped, `Unscoped selectors would leak globally: ${unscoped.join(' | ')}`).toEqual([]);
  });

  it('uses the approved mockup vocabulary, not an invented one', () => {
    const used = usedClasses(readSrc('EmployeeCreatePage.tsx'));
    // A representative set of structural classes from the approved artifact. If the
    // component stops rendering these, it has drifted away from the design again.
    const required = [
      'page', 'page-head', 'page-actions', 'card', 'panel', 'panel-title',
      'field', 'control', 'grid-2', 'grid-3', 'grid-3-1', 'grid-7-3',
      'dossier-head', 'dossier-section', 'avatar', 'identity-meta',
      'side-stack', 'side-panel', 'mini-row', 'section-box', 'section-box-head',
      'choice-grid', 'choice', 'choice-body', 'outcome-list', 'outcome', 'outcome-tail',
      'blockers', 'blockers-head', 'check-list', 'check-row', 'check-icon',
      'summary-grid', 'summary-card', 'summary-row', 'metric-grid', 'metric',
      'draft-list', 'draft-row', 'draft-mark', 'draft-actions',
      'success-shell', 'success-hero', 'success-icon', 'receipt-id', 'receipt-actions',
      'sticky-actions', 'badge', 'notice', 'btn',
    ];
    const absent = required.filter(c => !used.has(c));
    expect(absent, `Approved-design classes not rendered: ${absent.join(', ')}`).toEqual([]);
  });
});
