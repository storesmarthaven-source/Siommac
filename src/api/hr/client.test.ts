import { describe, expect, it } from 'vitest';
import { HrApiError, requireHrSuccess, withContentIdempotencyKey } from './client';

describe('HR API envelope handling', () => {
  it('returns successful envelopes unchanged', () => {
    const response = { success: true, data: { id: 'employee-1' } };
    expect(requireHrSuccess(response, 'hr/employees/get')).toBe(response);
  });

  it('rejects application-level failures instead of exposing absent data', () => {
    expect(() => requireHrSuccess(
      { success: false, message: 'Not permitted' },
      'hr/employees/list',
    )).toThrow('Not permitted');
  });

  it('classifies stale writes as conflicts', () => {
    try {
      requireHrSuccess({ success: false, message: 'Version mismatch', code: 'stale_write' }, 'hr/organization/unit/update');
      throw new Error('expected requireHrSuccess to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(HrApiError);
      expect((error as HrApiError).isConflict).toBe(true);
    }
  });
});

describe('HR mutation idempotency', () => {
  it('derives the same key from the same business content regardless of property order', () => {
    const first = withContentIdempotencyKey('org-unit-update', { unitId: 'u1', patch: { name: 'People', active: true } });
    const retry = withContentIdempotencyKey('org-unit-update', { patch: { active: true, name: 'People' }, unitId: 'u1' });
    expect(retry.idempotencyKey).toBe(first.idempotencyKey);
  });

  it('supports DTOs that do not declare an idempotency field and preserves an explicit key', () => {
    const generated = withContentIdempotencyKey('position-retire', { positionId: 'p1' });
    expect(generated).toMatchObject({ positionId: 'p1' });
    expect(generated.idempotencyKey).toMatch(/^hr-position-retire-/);

    expect(withContentIdempotencyKey('position-retire', {
      positionId: 'p1', idempotencyKey: 'caller-retry-key',
    }).idempotencyKey).toBe('caller-retry-key');
  });
});
