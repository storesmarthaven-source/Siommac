import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('employee full-record read model', () => {
  it('defines a distinct mobile contact field without repurposing work phone', () => {
    const migration = read('supabase/migrations/20260927000001_hr_employee_mobile_contact.sql');
    const route = read('netlify/functions/routes/hr.ts');

    expect(migration).toMatch(/add column if not exists mobile_phone text/i);
    expect(route).toContain("'phone, mobile_phone, employee_number");
    expect(route).toContain('patch.mobile_phone');
    expect(route).toContain('mobilePhone: optionalTrinidadPhone');
  });

  it('returns the authoritative deep-work sources used by the full employee page', () => {
    const route = read('netlify/functions/routes/hr.ts');

    expect(route).toContain('assignmentHistory,');
    expect(route).toContain('currentAssignment: assignmentHistory.find');
    expect(route).toContain('payGroup,');
    expect(route).toContain('accessProfile,');
    expect(route).toContain('accountStatus: emp.status');
  });

  it('does not guess an access profile when a system role maps to multiple profiles', () => {
    const route = read('netlify/functions/routes/hr.ts');

    expect(route).toContain('const profile = typedProfiles.length === 1 ? typedProfiles[0] : null;');
    expect(route).not.toMatch(/\.eq\('system_role',[^\n]+\)[\s\S]{0,160}\.limit\(1\)/);
  });

  it('supports employee-scoped offboarding reads for the employee record', () => {
    const queries = read('netlify/functions/lib/hr/offboardingQueries.ts');
    const route = read('netlify/functions/routes/hrOffboarding.ts');

    expect(route).toContain('employeeId: z.string().min(1).optional()');
    expect(queries).toContain("q = q.eq('employee_id', filters.employeeId)");
  });
});
